import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, ChevronLeft, ChevronRight, CloudUpload, History, Loader2, Lock, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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
import ExportMenu from '@/components/gstr9/ExportMenu';

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
    <div className="space-y-3 animate-fade-in">
      {/* One compact row: what this is, which client, which year (the bell is fixed top-right). */}
      <div className="flex flex-wrap items-center gap-2 md:pr-12">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><ScrollText className="h-4 w-4" /></div>
          <h1 className="truncate font-heading text-lg font-bold leading-tight">
            Annual Return <span className="font-semibold text-muted-foreground">· GSTR-9 &amp; 9C</span>
          </h1>
        </div>
        <div className="w-full min-w-0 sm:w-[24rem] lg:w-[30rem]">
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
      </div>

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

/** Save state. `compact` shows only the icon below 2xl (the words are its tooltip), for the step bar. */
const SaveIndicator: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { saveState, lastSavedAt, locked, readOnly } = useWorkspace();
  const words = (text: string) => <span className={compact ? 'hidden 2xl:inline' : undefined}>{text}</span>;
  // An unsaved edit outranks the lock: someone may have locked the year while
  // this user's last change was still pending, and that change is not kept.
  if (saveState === 'error') return <span title="Not saved" className="inline-flex items-center gap-1 text-xs font-medium text-destructive-strong"><AlertCircle className="h-3.5 w-3.5" /> Not saved</span>;
  if (locked) return <span title="Locked" className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-foreground"><Lock className="h-3 w-3 text-success-strong" /> Locked</span>;
  if (readOnly) return <Badge variant="secondary">Read-only</Badge>;
  if (saveState === 'saving' || saveState === 'pending') {
    return <span title="Saving…" className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {words('Saving…')}</span>;
  }
  if (saveState === 'saved' && lastSavedAt) {
    const t = `Saved ${lastSavedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    return <span title={t} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5 text-success-strong" /> {words(t)}</span>;
  }
  return <span title="Autosave on — every change is saved as you type" className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CloudUpload className="h-3.5 w-3.5" /> {words('Autosave on')}</span>;
};

/** Every change to the working — who, when, where, before and after — in a side panel, from any step. */
const HistoryButton: React.FC = () => (
  <Sheet>
    <SheetTrigger asChild>
      <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs" aria-label="Revision history">
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
    <div className="space-y-3">
      {/* Step bar: pinned while scrolling, so every step is one click away and the content keeps the full width. */}
      <div className="sticky top-0 z-30 -mx-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
        <div className="flex items-center gap-1.5 py-1.5 md:pr-12">
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={idx === 0} onClick={() => go(STEPS[idx - 1].key)} aria-label={idx > 0 ? `Previous: ${STEPS[idx - 1].label}` : 'Previous step'}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <StepBar active={step.key} onGo={go} stepOpen={workings.stepOpen} phases={phases} />
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={idx === STEPS.length - 1} onClick={() => go(STEPS[idx + 1].key)} aria-label={idx < STEPS.length - 1 ? `Next: ${STEPS[idx + 1].label}` : 'Next step'}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Step heading: one line — what the step is, the sheet it reproduces, and export. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-heading text-lg font-semibold leading-tight">{idx}. {step.label}</h2>
        <p className="min-w-[14rem] flex-1 text-xs leading-snug text-muted-foreground">
          {step.intro} <span className="inline-block max-w-full break-words rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:whitespace-nowrap">Excel: {step.excel}</span>
        </p>
        <div className="flex items-center gap-2">
          <SaveIndicator />
          <HistoryButton />
          <ExportMenu />
        </div>
      </div>
      {period?.status === 'locked' && step.key !== 'review' && step.key !== 'payables' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" /> Locked{period.locked_by ? ` by ${period.locked_by}` : ''} — {client.name} FY {financialYear} is read-only until it is unlocked.
        </p>
      )}

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
  );
};

/** The steps as a row of chips grouped by phase (two rows on narrow screens). */
const StepBar: React.FC<{
  active: string;
  onGo: (key: string) => void;
  stepOpen: Record<string, number>;
  phases: readonly ('Collect' | 'Reconcile' | 'Returns' | 'Finish')[];
}> = ({ active, onGo, stepOpen, phases }) => {
  return (
    <nav aria-label="Annual return steps" className="min-w-0 flex-1">
      {/* Wraps onto a second row when the screen is narrow, so every step stays in sight. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        {phases.map((phase, pi) => (
          // `contents`: chips wrap one by one; a thin rule marks where a phase starts.
          <div key={phase} role="group" aria-label={phase} className="contents">
            {pi > 0 && <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />}
            {STEPS.filter((s) => s.phase === phase).map((s) => {
              const n = STEPS.indexOf(s);
              const open = s.key === 'overview' ? 0 : stepOpen[s.key] ?? 0;
              const on = s.key === active;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onGo(s.key)}
                  aria-current={on ? 'step' : undefined}
                  title={`${n}. ${s.label}${open ? ` — ${open} open` : ''}`}
                  className={cn(
                    'flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    on ? 'bg-primary font-medium text-primary-foreground' : 'text-foreground hover:bg-muted',
                  )}
                >
                  <span className={cn('flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-semibold', on ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground')}>{n}</span>
                  {s.short}
                  {open > 0 && (
                    <Badge variant="destructive" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none" aria-label={`${open} open`}>{open}</Badge>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
};

export default AnnualReturnPage;
