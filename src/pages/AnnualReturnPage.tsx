import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, ChevronLeft, ChevronRight, CloudUpload, History, Loader2, Lock, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useWorkspace, WorkspaceClient, WorkspaceProvider } from '@/components/gstr9/WorkspaceContext';
import { STEPS, stepByKey } from '@/components/gstr9/steps/registry';
import RevisionHistory from '@/components/gstr9/overview/RevisionHistory';

const FY_STORAGE_KEY = 'gstk_annual_return_fy';

/** The FY whose annual return is due: the last completed April–March year. */
const dueFY = (): string => {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() - 1 : now.getFullYear() - 2;
  return `${start}-${String(start + 1).slice(-2)}`;
};

const fyChoices = (): string[] => {
  const due = Number(dueFY().slice(0, 4));
  const out: string[] = [];
  for (let y = due + 1; y >= due - 4; y--) out.push(`${y}-${String(y + 1).slice(-2)}`);
  return out;
};

const readStoredFY = (): string => {
  // A shared link's ?fy= wins over this browser's last-used year.
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('fy');
    if (fromUrl && fyChoices().includes(fromUrl)) return fromUrl;
  } catch {
    /* no window */
  }
  try {
    const v = localStorage.getItem(FY_STORAGE_KEY);
    if (v && fyChoices().includes(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return dueFY();
};

/**
 * Annual Return (GSTR-9 / GSTR-9C) — a guided workspace that reproduces the
 * firm's MASTER_PMS.xlsx working step by step. See docs/GSTR9_9C_WORKINGS.md.
 */
const AnnualReturnPage: React.FC = () => {
  const { isStaffRole, user } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const isStaff = isStaffRole();
  const [clients, setClients] = useState<WorkspaceClient[]>([]);
  const [financialYear, setFinancialYear] = useState<string>(readStoredFY);
  const [params, setParams] = useSearchParams();
  const urlClient = params.get('client');

  useEffect(() => {
    let query = supabase.from('clients').select('id, name, gstin, regular_sub_type, builder_itc_type').order('name');
    if (user && !isStaff) query = query.eq('id', user.id);
    query.then(({ data, error }) => {
      if (error) { toast.error('Failed to fetch clients: ' + error.message); return; }
      const list = (data || []) as WorkspaceClient[];
      setClients(list);
      if (!isStaff && list.length && !selectedClientId) setSelectedClientId(list[0].id);
      // A link / reload with ?client= opens that client's working directly.
      else if (isStaff && urlClient && urlClient !== selectedClientId && list.some((c) => c.id === urlClient)) setSelectedClientId(urlClient);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff, user]);

  useEffect(() => {
    try { localStorage.setItem(FY_STORAGE_KEY, financialYear); } catch { /* storage unavailable */ }
  }, [financialYear]);

  // Keep the open client and FY in the URL so a reload or a shared link lands on the same working.
  useEffect(() => {
    const wantClient = selectedClientId || null;
    if (params.get('client') === wantClient && params.get('fy') === financialYear) return;
    if (!wantClient) return;
    const next = new URLSearchParams(params);
    next.set('client', wantClient);
    next.set('fy', financialYear);
    setParams(next, { replace: true });
  }, [selectedClientId, financialYear, params, setParams]);

  const client = clients.find((c) => c.id === selectedClientId) || null;
  const clientOptions = useMemo(() => clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin })), [clients]);

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Annual Return — GSTR-9 & 9C"
        subtitle="The firm's GSTR-9/9C working, step by step: books, portal data, reconciliation, the forms and the notice format."
        icon={<ScrollText className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="min-w-[220px] flex-1">
            <SearchableSelect
              options={clientOptions}
              value={selectedClientId}
              onValueChange={setSelectedClientId}
              placeholder="Select a client"
              searchPlaceholder="Search client or GSTIN…"
              disabled={!isStaff}
            />
          </div>
          <div className="w-40">
            <Select value={financialYear} onValueChange={setFinancialYear}>
              <SelectTrigger aria-label="Financial year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {fyChoices().map((fy) => (
                  <SelectItem key={fy} value={fy}>FY {fy}{fy === dueFY() ? ' (due)' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!client ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            Select a client to open their annual return working.
          </CardContent>
        </Card>
      ) : (
        <WorkspaceProvider key={`${client.id}|${financialYear}`} client={client} financialYear={financialYear}>
          <Workspace />
        </WorkspaceProvider>
      )}
    </div>
  );
};

const SaveIndicator: React.FC = () => {
  const { saveState, lastSavedAt, locked, readOnly } = useWorkspace();
  // An unsaved edit outranks the lock: someone may have locked the year while
  // this user's last change was still pending, and that change is not kept.
  if (saveState === 'error') return <span className="inline-flex items-center gap-1 text-xs text-destructive-strong"><AlertCircle className="h-3.5 w-3.5" /> Not saved</span>;
  if (locked) return <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-foreground"><Lock className="h-3 w-3 text-success-strong" /> Locked</span>;
  if (readOnly) return <Badge variant="secondary">Read-only</Badge>;
  if (saveState === 'saving' || saveState === 'pending') {
    return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>;
  }
  if (saveState === 'saved' && lastSavedAt) {
    return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5 text-success-strong" /> Saved {lastSavedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>;
  }
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CloudUpload className="h-3.5 w-3.5" /> Autosave on</span>;
};

/** Every change to the working — who, when, where, before and after — in a side panel, from any step. */
const HistoryButton: React.FC = () => (
  <Sheet>
    <SheetTrigger asChild>
      <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" aria-label="Revision history">
        <History className="h-3.5 w-3.5" /> <span className="hidden sm:inline">History</span>
      </Button>
    </SheetTrigger>
    <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
      <SheetHeader className="mb-3">
        <SheetTitle>Revision history</SheetTitle>
        <SheetDescription>Recorded by the database on every autosave. It cannot be edited or deleted.</SheetDescription>
      </SheetHeader>
      <RevisionHistory compact />
    </SheetContent>
  </Sheet>
);

const Workspace: React.FC = () => {
  const { workings, client, financialYear, period } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const step = stepByKey(params.get('step'));
  const idx = STEPS.findIndex((s) => s.key === step.key);
  const go = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('step', key);
    setParams(next, { replace: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const StepComponent = step.component;
  const phases = ['Collect', 'Reconcile', 'Returns', 'Finish'] as const;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
      {/* Step rail */}
      <nav aria-label="Annual return steps" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-3 lg:overflow-visible">
          {phases.map((phase) => (
            <div key={phase} className="flex gap-1 lg:flex-col">
              <div className="hidden px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:block">{phase}</div>
              {STEPS.filter((s) => s.phase === phase).map((s) => {
                const n = STEPS.indexOf(s);
                const open = workings.stepOpen[s.key] ?? 0;
                const activeStep = s.key === step.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => go(s.key)}
                    aria-current={activeStep ? 'step' : undefined}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      activeStep ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                    )}
                  >
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold', activeStep ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground')}>
                      {n}
                    </span>
                    <span className="whitespace-nowrap lg:whitespace-normal">{s.label}</span>
                    {open > 0 && s.key !== 'overview' && (
                      <Badge variant="destructive" className="ml-auto h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none">{open}</Badge>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      {/* Step body */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">
              {client.name} · {client.gstin} · FY {financialYear}
              {period?.status === 'locked' && period.locked_by ? ` · locked by ${period.locked_by}` : ''}
            </div>
            <h2 className="font-heading text-xl font-semibold">{idx}. {step.label}</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {step.intro} <span className="inline-block max-w-full break-words rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:whitespace-nowrap">Excel: {step.excel}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SaveIndicator />
            <HistoryButton />
          </div>
        </div>

        <StepComponent />

        <div className="flex items-center justify-between border-t pt-3">
          <Button variant="outline" size="sm" disabled={idx === 0} onClick={() => go(STEPS[idx - 1].key)}>
            <ChevronLeft className="mr-1 h-4 w-4" /> {idx > 0 ? STEPS[idx - 1].label : 'Back'}
          </Button>
          <Button size="sm" disabled={idx === STEPS.length - 1} onClick={() => go(STEPS[idx + 1].key)}>
            {idx < STEPS.length - 1 ? STEPS[idx + 1].label : 'Done'} <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AnnualReturnPage;
