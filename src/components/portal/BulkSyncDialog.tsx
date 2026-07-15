import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MultiSelectPopover } from '@/components/ui/multi-select-popover';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import {
  enqueueBulkSync, getPortalJobsByIds, submitCaptcha, getAgentStatus,
  PortalJob, TERMINAL_STATUSES, AgentStatus,
} from '@/lib/portalJobs';
import { bulkSyncCaptcha } from './bulkSyncActive';
import { toast } from 'sonner';
import {
  Loader2, Check, X, AlertTriangle, User, Users, Globe, RefreshCw, CircleDot,
} from 'lucide-react';

interface ClientLite { id: string; name: string; gstin: string }
type Scope = 'current' | 'choose' | 'all';

// The four pulls a SYNC_ALL runs (one login -> everything). We read each one's
// success/failure out of job.result.sync[key].
const SYNC_STEPS: { key: string; label: string }[] = [
  { key: 'PULL_2B', label: '2B' },
  { key: 'PULL_LEDGERS', label: 'Ledger' },
  { key: 'PULL_GSTR1', label: 'GSTR-1' },
  { key: 'PULL_FILING_STATUS', label: 'Filing' },
];

const AUTO_CLOSE_SECS = 8;

export const BulkSyncDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => {
  const { user } = useAuth();
  const { selectedMonth } = useMonth();
  const { selectedClientId } = useClient();

  const [clients, setClients] = useState<ClientLite[]>([]);
  const [scope, setScope] = useState<Scope>('current');
  const [chosen, setChosen] = useState<string[]>([]);
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup');
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<PortalJob[]>([]);
  const [captchaText, setCaptchaText] = useState('');
  const [submittingCaptcha, setSubmittingCaptcha] = useState(false);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [autoClose, setAutoClose] = useState(true);
  const [countdown, setCountdown] = useState(AUTO_CLOSE_SECS);

  // This dialog owns the CAPTCHA surface while open (pauses the global watcher).
  useEffect(() => {
    bulkSyncCaptcha.setActive(open);
    return () => bulkSyncCaptcha.setActive(false);
  }, [open]);

  const loadClients = useCallback(async () => {
    const { data, error } = await supabase.from('clients').select('id, name, gstin').order('name');
    if (error) { toast.error('Failed to load clients'); return; }
    setClients((data as ClientLite[]) ?? []);
  }, []);

  const refreshAgent = useCallback(async () => {
    try { setAgent(await getAgentStatus()); } catch { setAgent({ online: false, lastSeen: null, agentId: null }); }
  }, []);

  // Fresh setup each time it opens.
  useEffect(() => {
    if (!open) return;
    setPhase('setup'); setJobs([]); setJobIds([]); setCaptchaText('');
    setAutoClose(true); setCountdown(AUTO_CLOSE_SECS);
    setScope(selectedClientId ? 'current' : 'all');
    setChosen(selectedClientId ? [selectedClientId] : []);
    loadClients(); refreshAgent();
  }, [open, selectedClientId, loadClients, refreshAgent]);

  // Poll our own jobs while running; flip to "done" when all are terminal.
  useEffect(() => {
    if (phase !== 'running' || jobIds.length === 0) return;
    let stop = false;
    const tick = async () => {
      try {
        const fresh = await getPortalJobsByIds(jobIds);
        if (stop) return;
        setJobs(fresh);
        if (fresh.length === jobIds.length && fresh.every((j) => TERMINAL_STATUSES.includes(j.status))) {
          setPhase('done');
        }
      } catch { /* table may not exist until migration applied */ }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { stop = true; clearInterval(t); };
  }, [phase, jobIds]);

  // Keep the agent-online indicator fresh while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(refreshAgent, 5000);
    return () => clearInterval(t);
  }, [open, refreshAgent]);

  // Auto-close countdown once everything is done.
  useEffect(() => {
    if (phase !== 'done' || !autoClose) return;
    if (countdown <= 0) { onOpenChange(false); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, autoClose, countdown, onOpenChange]);

  const clientName = useCallback(
    (id: string) => clients.find((c) => c.id === id)?.name ?? id.slice(0, 8),
    [clients],
  );

  const targetClientIds = useMemo((): string[] => {
    if (scope === 'current') return selectedClientId ? [selectedClientId] : [];
    if (scope === 'all') return clients.map((c) => c.id);
    return chosen;
  }, [scope, selectedClientId, clients, chosen]);

  const start = async () => {
    if (!targetClientIds.length) { toast.error('Pick at least one client to sync.'); return; }
    setStarting(true);
    try {
      const created = await enqueueBulkSync(targetClientIds, selectedMonth, user?.id ?? null);
      setJobIds(created.map((j) => j.id));
      setJobs(created);
      setPhase('running');
      toast.success(`Queued ${created.length} client${created.length > 1 ? 's' : ''} for sync.`);
    } catch (e: any) {
      toast.error(e?.message?.includes('portal_jobs')
        ? 'Portal queue not found — apply the portal-agent migration first.'
        : `Could not start sync: ${e?.message || e}`);
    } finally {
      setStarting(false);
    }
  };

  // The first job waiting on a human CAPTCHA — we surface one at a time.
  const captchaJob = useMemo(
    () => jobs.find((j) => j.status === 'needs_human' && j.human_prompt?.kind === 'captcha' && !j.human_response) ?? null,
    [jobs],
  );

  const submitCap = async () => {
    if (!captchaJob || !captchaText.trim()) return;
    setSubmittingCaptcha(true);
    try {
      await submitCaptcha(captchaJob.id, captchaText.trim());
      setCaptchaText('');
      // Optimistically mark it answered so the next pending captcha surfaces.
      setJobs((prev) => prev.map((j) => (j.id === captchaJob.id ? { ...j, human_response: { captcha: '…' } } : j)));
    } catch (e: any) {
      toast.error(`Could not submit CAPTCHA: ${e?.message || e}`);
    } finally {
      setSubmittingCaptcha(false);
    }
  };

  const stats = useMemo(() => {
    const done = jobs.filter((j) => TERMINAL_STATUSES.includes(j.status)).length;
    const ok = jobs.filter((j) => j.status === 'succeeded').length;
    const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'cancelled').length;
    return { done, ok, failed, total: jobIds.length || jobs.length };
  }, [jobs, jobIds]);

  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  // Keep rows in the order we enqueued them (the .in() query returns any order).
  const orderedJobs = useMemo(() => {
    if (!jobIds.length) return jobs;
    const idx = new Map(jobIds.map((id, i) => [id, i]));
    return [...jobs].sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0));
  }, [jobs, jobIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Sync from GST Portal
          </DialogTitle>
          <DialogDescription>
            One click pulls 2B, ledgers, GSTR-1 and filing status into your app for the selected
            clients. Type a client's CAPTCHA once when its login needs it — the rest runs on its own.
          </DialogDescription>
        </DialogHeader>

        {/* Agent status line */}
        <div className="flex items-center gap-2 text-xs">
          <CircleDot className={`h-3.5 w-3.5 ${agent?.online ? 'text-green-500' : 'text-muted-foreground'}`} />
          {agent?.online
            ? <span className="text-green-600 dark:text-green-400">Agent online — jobs will run now.</span>
            : <span className="text-amber-600 dark:text-amber-400">Agent offline — jobs will queue and run once the office agent is on.</span>}
          <span className="ml-auto text-muted-foreground">Period: <span className="font-medium text-foreground">{selectedMonth}</span></span>
        </div>

        {/* ---- SETUP ---- */}
        {phase === 'setup' && (
          <div className="space-y-4 py-2">
            <div>
              <div className="text-sm font-medium mb-2">Which clients?</div>
              <div className="grid grid-cols-3 gap-2">
                <ScopeButton active={scope === 'current'} onClick={() => setScope('current')} icon={<User className="h-4 w-4" />}
                  title="Current client" subtitle={selectedClientId ? clientName(selectedClientId) : 'None selected'} disabled={!selectedClientId} />
                <ScopeButton active={scope === 'choose'} onClick={() => setScope('choose')} icon={<Users className="h-4 w-4" />}
                  title="Choose clients" subtitle={chosen.length ? `${chosen.length} selected` : 'Pick from list'} />
                <ScopeButton active={scope === 'all'} onClick={() => setScope('all')} icon={<Globe className="h-4 w-4" />}
                  title="All clients" subtitle={`${clients.length} total`} />
              </div>
            </div>

            {scope === 'choose' && (
              <MultiSelectPopover
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                selectedValues={chosen}
                onSelectionChange={setChosen}
                placeholder="Select clients to sync"
                className="w-full"
                contentClassName="w-80"
                searchable
                showSelectAll
                searchPlaceholder="Search clients…"
              />
            )}

            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              About to sync <span className="font-semibold text-foreground">{targetClientIds.length}</span> client
              {targetClientIds.length === 1 ? '' : 's'} for <span className="font-semibold text-foreground">{selectedMonth}</span>.
              Each needs at most one CAPTCHA (one login pulls everything).
            </div>

            <Button className="w-full h-11 text-base" onClick={start} disabled={starting || !targetClientIds.length}>
              {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Import everything ({targetClientIds.length}) — 1 click
            </Button>
          </div>
        )}

        {/* ---- RUNNING / DONE ---- */}
        {phase !== 'setup' && (
          <div className="flex flex-col gap-3 overflow-hidden">
            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium">{stats.done} of {stats.total} clients done</span>
                <span className="text-muted-foreground">{stats.ok} ok · {stats.failed} failed</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>

            {/* CAPTCHA — one at a time */}
            {captchaJob && (
              <div className="rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300 mb-2">
                  <AlertTriangle className="h-4 w-4" />
                  Enter CAPTCHA for {clientName(captchaJob.client_id)}
                </div>
                <div className="flex items-center gap-3">
                  {captchaJob.human_prompt?.image
                    ? <img src={captchaJob.human_prompt.image} alt="CAPTCHA" className="rounded border bg-white p-1 h-12" />
                    : <div className="text-xs text-muted-foreground">Loading image…</div>}
                  <Input
                    value={captchaText}
                    onChange={(e) => setCaptchaText(e.target.value)}
                    placeholder="Type the CAPTCHA"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') submitCap(); }}
                    className="w-40 text-center tracking-widest"
                  />
                  <Button onClick={submitCap} disabled={submittingCaptcha || !captchaText.trim()}>
                    {submittingCaptcha ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit'}
                  </Button>
                </div>
              </div>
            )}

            {/* Per-client rows */}
            <div className="overflow-y-auto -mx-1 px-1 space-y-1.5" style={{ maxHeight: '40vh' }}>
              {orderedJobs.map((job) => (
                <ClientRow key={job.id} job={job} name={clientName(job.client_id)} />
              ))}
              {jobs.length === 0 && (
                <div className="text-sm text-muted-foreground py-6 text-center">Queuing…</div>
              )}
            </div>

            {/* DONE footer */}
            {phase === 'done' && (
              <div className="flex items-center justify-between border-t pt-3">
                <div className="text-sm">
                  <span className="font-semibold text-green-600 dark:text-green-400">{stats.ok} imported</span>
                  {stats.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {stats.failed} failed</span>}
                  {autoClose && <span className="text-muted-foreground ml-2">closing in {countdown}s…</span>}
                </div>
                <div className="flex gap-2">
                  {autoClose && <Button variant="outline" size="sm" onClick={() => setAutoClose(false)}>Keep open</Button>}
                  <Button size="sm" onClick={() => onOpenChange(false)}>Close now</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// --- small presentational helpers -------------------------------------------

const ScopeButton: React.FC<{
  active: boolean; onClick: () => void; icon: React.ReactNode; title: string; subtitle: string; disabled?: boolean;
}> = ({ active, onClick, icon, title, subtitle, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed
      ${active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50'}`}
  >
    <span className={`flex items-center gap-1.5 text-sm font-medium ${active ? 'text-primary' : ''}`}>{icon}{title}</span>
    <span className="text-xs text-muted-foreground truncate w-full">{subtitle}</span>
  </button>
);

const statusBadge = (job: PortalJob) => {
  switch (job.status) {
    case 'succeeded': return <Badge className="bg-green-500 hover:bg-green-500 text-white"><Check className="h-3 w-3 mr-1" />Done</Badge>;
    case 'failed': return <Badge variant="destructive"><X className="h-3 w-3 mr-1" />Failed</Badge>;
    case 'cancelled': return <Badge variant="secondary">Cancelled</Badge>;
    case 'needs_human': return <Badge className="bg-amber-500 hover:bg-amber-500 text-white"><AlertTriangle className="h-3 w-3 mr-1" />CAPTCHA</Badge>;
    case 'running':
    case 'claimed': return <Badge className="bg-blue-500 hover:bg-blue-500 text-white"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
    default: return <Badge variant="secondary">Queued</Badge>;
  }
};

const ClientRow: React.FC<{ job: PortalJob; name: string }> = ({ job, name }) => {
  const sync = job.result?.sync as Record<string, any> | undefined;
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{name}</div>
        <div className="flex flex-wrap gap-1 mt-1">
          {SYNC_STEPS.map((s) => {
            const r = sync?.[s.key];
            const ok = r && !r.error;
            const failed = r && r.error;
            return (
              <span key={s.key}
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  ok ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                  : failed ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                  : 'bg-muted text-muted-foreground'}`}
                title={failed ? String(r.error) : s.label}>
                {ok ? '✓' : failed ? '✗' : '·'} {s.label}
              </span>
            );
          })}
        </div>
      </div>
      {statusBadge(job)}
    </div>
  );
};
