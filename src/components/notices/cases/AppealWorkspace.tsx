// The Appeal view of a case (the firm's request of 25 October 2026): beside
// the Case view, the work on its appeal. One appeal at a time (a case can hold
// more than one: the order, then the appeal order to the Tribunal), its facts
// as the portal records them, and its three documents: the statement of facts,
// the grounds of appeal and the detailed written submission. Each is drafted or
// improved by the notice assistant from the case's evidence, the order as read,
// the firm's replies and its earlier appeals and replies on other cases
// (src/lib/noticeAppeals.ts), edited here, saved in versions and marked final.
// Nothing is filed by the app; a partner reviews every word. Only what can
// still be drafted is offered (supabase/functions/_shared/appealStage.ts): once
// the appeal is filed its statement of facts and grounds stand as filed with
// the APL 01 and only the written submission is drafted; a withdrawn or
// decided appeal, or an order past the time to appeal, keeps its drafts to read.
// Since 28 October 2026 the view is the one place for the appeal (the firm:
// "the user need not go anywhere"): where it stands and the next thing to do
// with its date, its road from the order to the order in appeal
// (src/lib/appealProgress.ts), and its own papers and dates (the order, APL 01,
// APL 02, hearing notices, adjournments, the pre deposit) with what the AI read
// in each and their PDFs. The refund page carries the same view for an appeal
// against a refund order.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, FileText, Loader2, RotateCcw, Save, Sparkles, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { SectionCard } from '@/components/notices/ui/Panel';
import { OrderCheckPanel } from '@/components/notices/cases/OrderCheckPanel';
import { CaseTimeline } from '@/components/notices/cases/CaseTimeline';
import { daysTo } from '@/components/notices/reports/ledgerStatus';
import { useAuth } from '@/contexts/AuthContext';
import {
  APPEAL_DOCS, appealDocLabel, appealDocState, appealPhase, type AppealPhase, appealDraftsKey, appealRunsKey, caseAppealsKey, downloadAppealDocx, loadAppealDrafts, runNotes,
  saveAppealDraft, saveTribunalAppeal, startAppealDraft, useAppealRuns, type AppealDocType, type AppealDraft, type CaseAppeal,
} from '@/lib/noticeAppeals';
import { appealKeyDates, appealNext, appealPapers, appealSteps, type AppealStep } from '@/lib/appealProgress';
import type { CaseItem, KeyDate } from '@/lib/noticeCases';
import { istToday } from '@/lib/noticeFacts';
import { dueWords, fmtDate, fmtDateTime, fmtInr } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const appealTitle = (a: CaseAppeal) => `${a.second_appeal ? 'Second appeal' : 'Appeal'} against ${a.order_form ? `${a.order_form} ` : ''}${a.order_ref ?? a.appeal_key}`;

const pendingText = (days: number) => {
  const m = Math.floor(days / 30.44);
  return m >= 1 ? `${m} month${m === 1 ? '' : 's'}${m >= 12 ? ' (decision due within a year, s.107(13))' : ''}` : `${days} day${days === 1 ? '' : 's'}`;
};

const PHASE_LINE: Record<AppealPhase, string> = {
  preparing: 'Not filed yet',
  late: 'Not filed yet; the three months are over, a delay can still be condoned',
  time_over: 'Not filed; the time to appeal is over',
  filed: 'Filed',
  withdrawn: 'Withdrawn',
  decided: 'Decided',
};

export const AppealWorkspace: React.FC<{
  clientId: string; caseKey: string; appeals: CaseAppeal[]; all?: CaseAppeal[]; clientName?: string | null;
  /** The case's papers and key dates, for the appeal's own (left out while they load). */
  items?: CaseItem[]; keyDates?: KeyDate[];
  /** The appeal picked (?appeal=<order reference>), and a pick reported back to the page's address. */
  selected?: string | null; onSelect?: (appealKey: string) => void;
}> = ({ clientId, caseKey, appeals, all, clientName, items, keyDates, selected, onSelect }) => {
  const [picked, setPicked] = useState<string | null>(selected ?? null);
  // Grounds the order check found, handed to the grounds' AI guidance.
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null);
  const key = (selected ?? picked ?? '').toUpperCase();
  const appeal = appeals.find((a) => a.appeal_key.toUpperCase() === key) ?? appeals[0];
  const phase = appeal ? appealPhase(appeal, all ?? appeals) : 'preparing';
  const papers = useMemo(() => (appeal && items ? appealPapers(appeal, items) : null), [appeal, items]);
  const dates = useMemo(() => (appeal && keyDates ? appealKeyDates(appeal, keyDates) : []), [appeal, keyDates]);
  if (!appeal) return <Note tone="info">No appeal is on record for this case, and no order of it can still be appealed.</Note>;
  const pick = (k: string) => { setPicked(k); setSeed(null); onSelect?.(k); };
  return (
    <div className="space-y-3">
      {appeals.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Appeals of the case">
          {appeals.map((a) => (
            <button key={a.appeal_key} type="button" aria-pressed={a.appeal_key === appeal.appeal_key} onClick={() => pick(a.appeal_key)}
              className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium',
                a.appeal_key === appeal.appeal_key ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
              {appealTitle(a)}
            </button>
          ))}
        </div>
      )}
      <AppealFacts appeal={appeal} phase={phase} />
      <AppealStatus key={`s-${appeal.appeal_key}`} appeal={appeal} phase={phase} papers={papers ?? []} dates={dates} all={all ?? appeals} />
      {(appeal.forum === 'tribunal' || appeal.order_form === 'APL-04') && (
        <TribunalAppealRecord key={`t-${appeal.appeal_key}`} clientId={clientId} caseKey={caseKey} appeal={appeal} />
      )}
      {appeal.order_notice_id && (appeal.order_form ?? 'DRC-07') === 'DRC-07' && (
        <OrderCheckPanel key={`c-${appeal.appeal_key}`} clientId={clientId} caseKey={caseKey} orderNoticeId={appeal.order_notice_id}
          onUseGrounds={appealDocState('grounds', phase).open ? (text) => setSeed((p) => ({ text, n: (p?.n ?? 0) + 1 })) : undefined} />
      )}
      <AppealDocuments key={appeal.appeal_key} clientId={clientId} caseKey={caseKey} appeal={appeal} phase={phase} clientName={clientName} groundsSeed={seed} />
      {papers && (
        <SectionCard title="Papers and dates of the appeal"
          description={`${papers.length} paper${papers.length === 1 ? '' : 's'}, ${dates.length} date${dates.length === 1 ? '' : 's'}${dates.some((k) => k.upcoming) ? ` (${dates.filter((k) => k.upcoming).length} upcoming)` : ''}`}
          info="The order appealed and every paper of the appeal's own portal case (the APL 01 as filed, the APL 02, hearing notices, adjournments, the order in appeal), each with what the AI read in it and its PDFs, and the dates the law attaches to them: the time to appeal, the pre deposit, hearings and adjournments. The rest of the case is on the Case view's timeline.">
          {/* The work on these papers is this view: no button leaves for a notice page. */}
          <CaseTimeline items={papers} keyDates={dates} order="oldest" workLink={() => null} />
        </SectionCard>
      )}
    </div>
  );
};

const STEP_STYLE: Record<AppealStep['state'], { dot: string; text: string; line: string }> = {
  done: { dot: 'border-success bg-success text-success-foreground', text: '', line: 'bg-success/50' },
  now: { dot: 'border-primary bg-primary/10 text-primary ring-4 ring-primary/15', text: 'text-primary', line: 'bg-border' },
  later: { dot: 'border-muted-foreground/30 bg-card text-muted-foreground', text: 'text-muted-foreground', line: 'bg-border' },
  missed: { dot: 'border-destructive bg-destructive text-destructive-foreground', text: 'text-destructive-strong', line: 'bg-destructive/40' },
};

/** Where the appeal stands: the next thing to do with its date, and its road from the order to the order in appeal. */
const AppealStatus: React.FC<{ appeal: CaseAppeal; phase: AppealPhase; papers: CaseItem[]; dates: KeyDate[]; all: CaseAppeal[] }> = ({ appeal, phase, papers, dates, all }) => {
  const today = istToday();
  const next = appealNext(appeal, phase, dates, today);
  const steps = appealSteps(appeal, phase, papers, dates, all, today);
  const d = daysTo(next.due, today);
  const late = d !== null && d < 0;
  return (
    <section aria-label="Where the appeal stands" className={cn('space-y-4 rounded-xl border-2 px-4 py-4 sm:px-5',
      next.tone === 'action' ? 'border-warning/50 bg-warning/[0.05]' : next.tone === 'wait' ? 'border-info/40 bg-info/[0.05]' : 'border-border bg-muted/30')}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{next.tone === 'done' ? 'Where it stands' : 'Next step'}</div>
          <div className="text-lg font-bold leading-snug sm:text-xl">{next.text}</div>
          {next.why && <p className="text-sm text-muted-foreground">{next.why}</p>}
        </div>
        {next.due && (
          <div className={cn('flex shrink-0 flex-col items-start rounded-lg border bg-card px-4 py-2.5 lg:items-end lg:text-right', late ? 'border-destructive/60' : 'border-border')}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">By</div>
            <div className={cn('text-xl font-bold tabular-nums leading-tight', late && 'text-destructive-strong')}>{fmtDate(next.due)}</div>
            <div className={cn('text-sm font-medium', late ? 'text-destructive-strong' : d !== null && d <= 7 ? 'text-warning' : 'text-muted-foreground')}>{dueWords(d).replace('due ', '')}</div>
          </div>
        )}
      </div>
      <ol className="grid gap-0 sm:flex sm:flex-wrap sm:items-start" aria-label="The appeal's steps">
        {steps.map((st, i) => {
          const t = STEP_STYLE[st.state];
          return (
            <li key={st.key} className="flex items-start gap-2 sm:min-w-[7rem] sm:flex-1 sm:flex-col sm:items-center sm:gap-1 sm:text-center">
              <div className="flex items-center sm:w-full">
                <span aria-hidden className={cn('hidden h-0.5 flex-1 sm:block', i === 0 ? 'bg-transparent' : t.line)} />
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2', t.dot)}>
                  {st.state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden /> : st.state === 'missed' ? <X className="h-3.5 w-3.5" aria-hidden /> : <span className="text-xs font-semibold">{i + 1}</span>}
                </span>
                <span aria-hidden className={cn('hidden h-0.5 flex-1 sm:block', i === steps.length - 1 ? 'bg-transparent' : steps[i + 1]?.state === 'done' ? STEP_STYLE.done.line : 'bg-border')} />
              </div>
              <div className="pb-2 sm:pb-0">
                <div className={cn('text-sm font-medium leading-tight', t.text)}>{st.label}<span className="sr-only"> ({st.state === 'now' ? 'now' : st.state})</span></div>
                {st.date && <div className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">{fmtDate(st.date)}</div>}
                {st.note && <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{st.note}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

/** The appeal as the portal records it, in one strip. */
const AppealFacts: React.FC<{ appeal: CaseAppeal; phase: AppealPhase }> = ({ appeal: a, phase }) => {
  const facts: [string, React.ReactNode][] = [
    ['Order', <>{a.order_form ? `${a.order_form} · ` : ''}<span className="font-mono text-[13px]">{a.order_ref ?? a.appeal_key}</span></>],
    ['Order dated', a.order_date ? fmtDate(a.order_date) : null],
    [a.status === 'filed' ? 'Three months ran to' : 'Last day to appeal', a.last_day ? fmtDate(a.last_day) : null],
    ['Appeal', a.arn ? <span className="font-mono text-[13px]">{a.arn}</span> : null],
    ['Filed on', a.filed_on ? fmtDate(a.filed_on) : null],
    // P5: s.107(13) asks for a decision within a year where possible.
    ['Pending for', phase === 'filed' && a.pending_days != null
      ? <span className={a.pending_days >= 365 ? 'text-warning' : undefined}>{pendingText(a.pending_days)}</span> : null],
    ['Refund claimed', a.refund_claimed ? fmtInr(a.refund_claimed) : null],
    ['Refund rejected', a.refund_rejected ? <span className="text-destructive-strong">{fmtInr(a.refund_rejected)}</span> : null],
    ['Tax in dispute', a.disputed_tax ? fmtInr(a.disputed_tax) : null],
    ['Total in dispute', a.disputed_total ? fmtInr(a.disputed_total) : a.demand && a.subject !== 'refund' ? fmtInr(a.demand) : null],
    ['Pre-deposit', a.predeposit ? `${fmtInr(a.predeposit)}${a.predeposit_pct ? ` (${a.predeposit_pct}%)` : ''}` : null],
  ];
  return (
    <SectionCard title={appealTitle(a)}
      description={a.status === 'filed' ? (a.portal_status ?? PHASE_LINE[phase]) : PHASE_LINE[phase]}
      info="What the portal records for the appeal and the order it is against. The documents below are drafted against this order, and stay with it once the appeal is filed."
      actions={<>
        <Badge variant={phase === 'filed' ? 'info' : phase === 'preparing' || phase === 'late' ? 'warning' : 'secondary'} className="text-xs">
          {phase === 'filed' ? 'Appeal filed' : phase === 'withdrawn' ? 'Appeal withdrawn' : phase === 'decided' ? 'Appeal decided' : phase === 'time_over' ? 'Time over' : 'To file'}
        </Badge>
        {a.order_notice_id && (
          <Button size="sm" variant="outline" className={WS_BTN} asChild><Link to={`/notices/${a.order_notice_id}`}>Open the order</Link></Button>
        )}
      </>}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
            <dd className="break-words text-sm font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {!!a.issues?.length && <p className="text-xs text-muted-foreground">Issue on the portal: {a.issues.join('; ')}</p>}
    </SectionCard>
  );
};

/**
 * A Tribunal appeal is filed on the GSTAT portal, which is not synced: staff
 * record it here once filed, so the timeline and the appeal clock know.
 */
const TribunalAppealRecord: React.FC<{ clientId: string; caseKey: string; appeal: CaseAppeal }> = ({ clientId, caseKey, appeal }) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filedOn, setFiledOn] = useState(appeal.filed_on ?? '');
  const [arn, setArn] = useState(appeal.arn && !appeal.arn.startsWith('GSTAT:') ? appeal.arn : '');
  const [deposit, setDeposit] = useState(appeal.predeposit ? String(appeal.predeposit) : '');
  const [busy, setBusy] = useState(false);
  const recorded = appeal.status === 'filed';
  const save = async () => {
    setBusy(true);
    try {
      await saveTribunalAppeal({
        clientId, orderRef: appeal.order_ref ?? appeal.appeal_key, filedOn, arn: arn.trim() || null,
        predeposit: deposit.trim() ? Number(deposit.replace(/[^\d.]/g, '')) : null, actor: user?.firstName ?? null,
      });
      toast.success('Tribunal appeal recorded');
      setOpen(false);
      qc.invalidateQueries({ queryKey: caseAppealsKey(clientId, caseKey) });
      qc.invalidateQueries({ queryKey: ['notice-case-key-dates'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the appeal');
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <Note tone="info">
        {recorded ? 'Tribunal appeal on record. ' : 'A Tribunal appeal is filed on the GSTAT portal, which is not synced. '}
        <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setOpen(true)}>
          {recorded ? 'Change it' : 'Record it once filed'}
        </button>
      </Note>
    );
  }
  return (
    <SectionCard title="Record the Tribunal appeal" description={`Against ${appeal.order_ref ?? appeal.appeal_key}`}
      info="The appeal then counts as filed on the case's timeline, its pre-deposit is checked, and the order's appeal clock is met.">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-medium text-muted-foreground">Filed on
          <Input type="date" value={filedOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setFiledOn(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-muted-foreground">Appeal number (optional)
          <Input value={arn} onChange={(e) => setArn(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-muted-foreground">Pre-deposit paid, ₹ (optional)
          <Input inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" className={WS_BTN} disabled={!filedOn || busy} onClick={save}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </Button>
        <Button size="sm" variant="ghost" className={WS_BTN} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </SectionCard>
  );
};

/** The three documents: a tab each, the editor, the assistant. */
const AppealDocuments: React.FC<{ clientId: string; caseKey: string; appeal: CaseAppeal; phase: AppealPhase; clientName?: string | null; groundsSeed?: { text: string; n: number } | null }> = ({ clientId, caseKey, appeal, phase, clientName, groundsSeed }) => {
  const { user } = useAuth();
  const actor = user?.firstName ?? null;
  const qc = useQueryClient();
  const [pickedDoc, setDoc] = useState<AppealDocType | null>(null);
  useEffect(() => { if (groundsSeed) setDoc('grounds'); }, [groundsSeed]);
  const drafts = useQuery({ queryKey: appealDraftsKey(clientId, appeal.appeal_key), queryFn: () => loadAppealDrafts(clientId, appeal.appeal_key) });
  const runs = useAppealRuns(clientId, appeal.appeal_key);
  const byDoc = useMemo(() => {
    const m = new Map<AppealDocType, AppealDraft[]>();
    for (const d of drafts.data ?? []) {
      const k = d.doc_type as AppealDocType;
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return m;
  }, [drafts.data]);
  // What can still be drafted at this stage; a document that cannot is shown only to read its drafts.
  const shownDocs = APPEAL_DOCS.map((d) => ({ ...d, state: appealDocState(d.key, phase) }))
    .filter((d) => d.state.open || (byDoc.get(d.key)?.length ?? 0) > 0 || !!appeal.drafts?.[d.key]);
  const doc: AppealDocType = shownDocs.find((d) => d.key === pickedDoc)?.key
    ?? shownDocs.find((d) => d.state.open)?.key ?? shownDocs[0]?.key ?? 'submission';
  const filedLine = phase === 'filed'
    ? `The statement of facts and the grounds of appeal were filed with the APL 01${appeal.filed_on ? ` on ${fmtDate(appeal.filed_on)}` : ''} and stand as filed; they are in the case's documents. What is left to draft is the written submission for the hearing, which argues the grounds as filed.`
    : !shownDocs.some((d) => d.state.open) ? appealDocState('facts', phase).why : null;

  // A run that ends brings its version: load the drafts again.
  const running = (runs.data ?? []).filter((r) => r.status === 'running').map((r) => r.id).join(',');
  useEffect(() => {
    qc.invalidateQueries({ queryKey: appealDraftsKey(clientId, appeal.appeal_key) });
    qc.invalidateQueries({ queryKey: caseAppealsKey(clientId, caseKey) });
  }, [running, qc, clientId, appeal.appeal_key, caseKey]);

  return (
    <SectionCard title="Appeal documents"
      info="Draft each document with the AI, then read, edit and save it. Only the documents that can still be drafted at the appeal's stage are offered: once the appeal is filed, the statement of facts and grounds stand as filed and only the written submission is drafted. The AI reads the order appealed, every document of the case as read (with the names and evidence types given on the Documents tab), the firm's replies and positions in the case, the appeal's other documents, and the firm's earlier appeals and replies on other cases (another client's only when that client is chosen under Reply Factory, Learning). Draft the statement of facts first: the grounds and the written submission build on it. A version marked final is used for later appeals."
      actions={
        <div className="inline-flex rounded-md border bg-card p-0.5" role="tablist" aria-label="Document">
          {shownDocs.map((d) => {
            const head = appeal.drafts?.[d.key] ?? (byDoc.get(d.key)?.[0] ? { status: byDoc.get(d.key)?.[0]?.status } : undefined);
            return (
              <button key={d.key} type="button" role="tab" aria-selected={doc === d.key} onClick={() => setDoc(d.key)} title={d.hint}
                className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
                  doc === d.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {d.label}{!d.state.open && <span className="sr-only"> (to read only)</span>}
                {head?.status === 'final' ? <Check className="h-3 w-3" aria-label="final" /> : head ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-label="drafted" /> : null}
              </button>
            );
          })}
        </div>
      }>
      {filedLine && <Note tone="info">{filedLine}</Note>}
      {drafts.error ? <Note tone="warn">Couldn't load the drafts: {drafts.error instanceof Error ? drafts.error.message : String(drafts.error)}</Note>
        : drafts.isLoading ? <Skeleton className="h-96 w-full" />
        // All three stay mounted, so switching documents never loses an edit not saved.
        : shownDocs.map((d) => (
          <div key={d.key} role="tabpanel" hidden={doc !== d.key}>
            <DocEditor clientId={clientId} caseKey={caseKey} appeal={appeal} doc={d.key} versions={byDoc.get(d.key) ?? []} closedWhy={d.state.why}
              runs={(runs.data ?? []).filter((r) => r.doc_type === d.key)} actor={actor} clientName={clientName}
              seed={d.key === 'grounds' ? groundsSeed : null}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: appealDraftsKey(clientId, appeal.appeal_key) });
                qc.invalidateQueries({ queryKey: caseAppealsKey(clientId, caseKey) });
              }}
              onStarted={() => qc.invalidateQueries({ queryKey: appealRunsKey(clientId, appeal.appeal_key) })} />
          </div>
        ))}
    </SectionCard>
  );
};

/** A failed run's reason as one sentence, with what to do (an older run's message ends with its own full stop). */
const failedLine = (error: string | null | undefined) => {
  const text = (error ?? 'no answer').trim().replace(/\.+$/, '');
  return `${text}.${/draft again/i.test(text) ? '' : ' Draft again to try once more.'}`;
};

const DocEditor: React.FC<{
  clientId: string; caseKey: string; appeal: CaseAppeal; doc: AppealDocType; versions: AppealDraft[];
  runs: ReturnType<typeof useAppealRuns>['data']; actor: string | null; clientName?: string | null;
  /** Set when the document is no longer drafted at this stage: its versions are shown to read. */
  closedWhy?: string | null;
  /** Grounds from the order check, added to the guidance for the AI. */
  seed?: { text: string; n: number } | null;
  onSaved: () => void; onStarted: () => void;
}> = ({ clientId, caseKey, appeal, doc, versions, runs, actor, clientName, closedWhy, seed, onSaved, onStarted }) => {
  const readOnly = !!closedWhy;
  const latest = versions[0];
  const [shown, setShown] = useState<number | null>(null); // a version picked to read, else the latest
  const base = (shown ? versions.find((v) => v.version === shown) : latest) ?? null;
  const [text, setText] = useState(base?.body ?? '');
  const [loadedVersion, setLoadedVersion] = useState<number>(base?.version ?? 0);
  const [guide, setGuide] = useState('');
  useEffect(() => {
    if (!seed?.text) return;
    setGuide((g) => (g.includes(seed.text) ? g : `${g.trim() ? `${g.trim()}\n\n` : ''}Take these grounds from the order check, each with its law:\n${seed.text}`));
    toast.success('The order check\'s grounds are in the guidance for the AI. Draft the grounds to use them.');
  }, [seed]);
  const [busy, setBusy] = useState<null | 'draft' | 'improve' | 'save' | 'final'>(null);
  const dirty = text !== (base?.body ?? '');
  const running = (runs ?? []).find((r) => r.status === 'running');
  const lastRun = (runs ?? []).find((r) => r.status !== 'running');
  const notes = runNotes((runs ?? []).find((r) => r.status === 'done'));

  // A new version came in (the AI, or a colleague): show it unless there are edits here.
  useEffect(() => {
    if (shown || dirty) return;
    setText(latest?.body ?? '');
    setLoadedVersion(latest?.version ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id]);
  const newer = !!latest && latest.version > loadedVersion && (dirty || !!shown);

  const ask = async (mode: 'draft' | 'improve') => {
    setBusy(mode);
    const r = await startAppealDraft({
      clientId, caseKey, appealKey: appeal.appeal_key, docType: doc, mode, text: mode === 'improve' ? text : null,
      instructions: guide.trim() || null, actor,
    });
    setBusy(null);
    if (r.error) { toast.error(r.error); return; }
    toast.success(`The AI is drafting the ${appealDocLabel(doc).toLowerCase()}. It takes a minute or two; the new version opens here.`);
    onStarted();
  };
  const save = async (status: 'draft' | 'final') => {
    setBusy(status === 'final' ? 'final' : 'save');
    const r = await saveAppealDraft({ clientId, caseKey, appealKey: appeal.appeal_key, docType: doc, body: text, status, expectVersion: latest?.version ?? 0, actor });
    setBusy(null);
    if (r.error) { toast.error(r.error); return; }
    toast.success(status === 'final' ? `Version ${r.version} saved as final.` : `Saved as version ${r.version}.`);
    setShown(null);
    setLoadedVersion(r.version ?? 0);
    onSaved();
  };
  const reloadLatest = () => { setShown(null); setText(latest?.body ?? ''); setLoadedVersion(latest?.version ?? 0); };
  const pickVersion = (v: string) => {
    const n = Number(v);
    const found = versions.find((x) => x.version === n);
    if (!found) return;
    setShown(n === latest?.version ? null : n);
    setText(found.body);
    setLoadedVersion(latest?.version ?? 0);
  };

  const label = appealDocLabel(doc);
  const fileName = `${label} ${clientName ?? ''} ${appeal.order_ref ?? appeal.appeal_key}`.replace(/\s+/g, ' ');

  return (
    <div className={cn('grid grid-cols-1 items-start gap-3', !readOnly && 'xl:grid-cols-[minmax(0,1fr)_17rem]')}>
      <div className="min-w-0 space-y-2">
        {readOnly && <Note tone="info">{closedWhy} The drafts kept here are to read, copy or download.</Note>}
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && <>
          <Button size="sm" className={WS_BTN} disabled={!!busy || !!running} onClick={() => ask('draft')}>
            {busy === 'draft' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
            {latest ? 'Draft again with AI' : 'Draft with AI'}
          </Button>
          <Button size="sm" variant="outline" className={WS_BTN} disabled={!!busy || !!running || !text.trim()} onClick={() => ask('improve')}
            title="The AI rewrites the text below in the firm's style, keeping its facts">
            {busy === 'improve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Wand2 className="h-3.5 w-3.5" aria-hidden />} Improve with AI
          </Button>
          <span className="mx-1 hidden h-5 w-px bg-border sm:inline-block" aria-hidden />
          <Button size="sm" variant="outline" className={WS_BTN} disabled={!!busy || !dirty || !text.trim()} onClick={() => save('draft')}>
            {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />} Save
          </Button>
          {(dirty || latest?.status !== 'final') && (
            <Button size="sm" variant="outline" className={WS_BTN} disabled={!!busy || !text.trim()} onClick={() => save('final')}
              title="Save this text as the final version, ready to file; a final version is also used for later appeals">
              {busy === 'final' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Mark final
            </Button>
          )}
          </>}
          <Button size="sm" variant="ghost" className={WS_BTN} disabled={!text.trim()}
            onClick={() => navigator.clipboard.writeText(text).then(() => toast.success('Copied.'), () => toast.error('Could not copy.'))}>
            <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
          </Button>
          <Button size="sm" variant="ghost" className={WS_BTN} disabled={!text.trim()}
            onClick={() => downloadAppealDocx(fileName, label, text).catch(() => toast.error('Could not make the Word file.'))}>
            <Download className="h-3.5 w-3.5" aria-hidden /> Word
          </Button>
          {versions.length > 0 && (
            <Select value={String(shown ?? latest?.version ?? '')} onValueChange={pickVersion}>
              <SelectTrigger className="ml-auto h-8 w-auto gap-1 text-xs" aria-label="Version"><SelectValue /></SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={String(v.version)} className="text-xs">
                    Version {v.version}{v.status === 'final' ? ', final' : ''} · {v.source === 'ai' ? 'AI' : v.author_name ?? 'staff'} · {fmtDateTime(v.created_at)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {running && !readOnly && (
          <Note tone="info"><span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            The AI is {running.mode === 'improve' ? 'improving' : 'drafting'} the {label.toLowerCase()} (asked by {running.requested_by_name ?? 'staff'} at {fmtDateTime(running.created_at)}). The new version opens here when it is done.</span></Note>
        )}
        {!readOnly && !running && lastRun?.status === 'failed' && lastRun.created_at > (latest?.created_at ?? '') && (
          <Note tone="warn">The AI could not finish the last request: {failedLine(lastRun.error)}</Note>
        )}
        {newer && (
          <Note tone="warn">
            <span className="inline-flex flex-wrap items-center gap-2">Version {latest?.version} is newer than the text below{dirty ? ', which has edits not saved' : ''}.
              <Button size="sm" variant="outline" className={WS_BTN} onClick={reloadLatest}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Show version {latest?.version}</Button>
            </span>
          </Note>
        )}
        {shown && !newer && <p className="text-xs text-muted-foreground">Reading version {shown}. Save to make it the current version again.</p>}

        {!latest && !text && !readOnly ? (
          <div className="flex min-h-[18rem] flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center">
            <FileText className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">No {label.toLowerCase()} yet</p>
            <p className="max-w-md text-xs text-muted-foreground">{APPEAL_DOCS.find((d) => d.key === doc)?.hint} Draft it with the AI, or type it below and save.</p>
            <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setText(' ')}>Type it myself</Button>
          </div>
        ) : (
          <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={label} readOnly={readOnly}
            className="min-h-[28rem] font-serif text-[14px] leading-relaxed" spellCheck />
        )}
        <p className="text-xs text-muted-foreground">
          {latest ? <>Version {latest.version}{latest.status === 'final' ? ' (final)' : ''}, {latest.source === 'ai' ? `drafted by the AI for ${latest.author_name ?? 'staff'}` : `saved by ${latest.author_name ?? 'staff'}`}, {fmtDateTime(latest.created_at)}. </> : null}
          {!readOnly && 'Hyphens and dashes are taken out on saving, the firm\'s rule for what is filed.'}
        </p>
      </div>

      {!readOnly && <aside className="min-w-0 space-y-3" aria-label="For the AI">
        <div className="space-y-1">
          <label htmlFor={`guide-${doc}`} className="text-xs font-medium text-muted-foreground">Guidance for the AI (optional)</label>
          <Textarea id={`guide-${doc}`} value={guide} onChange={(e) => setGuide(e.target.value)} rows={4} className="text-xs"
            placeholder={doc === 'grounds' ? 'e.g. Lead with limitation; add a ground on the supplier\'s cancellation.' : doc === 'submission' ? 'e.g. Rely on the purchase invoices and the bank statement; keep it to 8 pages.' : 'e.g. Mention that no personal hearing was given.'} />
        </div>
        {notes.cautions.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Cautions from the AI</div>
            <ul className="list-disc space-y-1 pl-4 text-xs">{notes.cautions.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        {notes.questions.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">To ask the client</div>
            <ul className="list-disc space-y-1 pl-4 text-xs">{notes.questions.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        {notes.precedents.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Earlier work it drew on</div>
            <ul className="space-y-1 text-xs">
              {notes.precedents.map((p) => (
                <li key={p.id}>{p.title || 'Untitled'} <span className="text-muted-foreground">({p.kind === 'filed_appeal' ? 'appeal filed' : p.kind === 'reply' ? 'reply filed' : 'final draft'}, {p.same_client ? 'this client' : 'another client'})</span></li>
              ))}
            </ul>
          </div>
        )}
      </aside>}
    </div>
  );
};
