// A litigation matter at /litigation/:id (roadmap Phase 2; audit U-84-1..5,
// U-85..U-96, cross-cutting ui-c). Built like the notice workspace: a
// breadcrumb, one header (title, the facts in a line, the next clock, stage,
// priority, owner and reviewer, and the one next step), the stage rail, the
// money in four figures, then tabs kept in the URL (?tab=) — Notices,
// Hearings, Payments, Documents, Activity, Deadlines — beside the next step
// and the key facts. A closed matter says how and when it closed and is
// read-only until reopened.
import React, { useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, ChevronDown, FileText, Gavel, IndianRupee, MoreHorizontal, Pencil, RefreshCw, RotateCcw, Scale, Upload, UserPlus, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note } from '@/components/gstr9/ui';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_BTN, WS_PAGE } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffList } from '@/hooks/useStaffList';
import { AssignPopover } from '@/components/notices/AssignPopover';
import { StagePicker } from '@/components/notices/StagePicker';
import { StageBadge } from '@/components/notices/StageBadge';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { StageRail } from '@/components/notices/workspace/StageRail';
import { stageLabel, type StageKey } from '@/lib/noticeStages';
import { fmtDate, fmtDateTime, fmtFy, fmtInr, plural } from '@/lib/noticeFormat';
import {
  assignMatter, changeMatterStage, forumLabel, istDate, lifecycleLabel, loadMatterWorkspace, matterCloseText, MatterNotFound, mattersHref,
  setMatterPriority, toStageKey, type MatterHearing, type MatterWorkspace,
} from '@/lib/litigationData';
import { clockWhen } from '@/components/litigation/matters/ClockCell';
import { MatterNoticesTab, LinkNoticesDialog } from '@/components/litigation/matters/MatterNoticesTab';
import { MatterHearingsTab } from '@/components/litigation/matters/MatterHearingsTab';
import { HearingDialog, OutcomeDialog } from '@/components/litigation/matters/HearingDialogs';
import { MatterPaymentsTab, RecordPaymentDialog, isAppeal, preDepositNeed } from '@/components/litigation/matters/MatterPayments';
import { MatterDocumentsTab } from '@/components/litigation/matters/MatterDocumentsTab';
import { MatterActivityTab } from '@/components/litigation/matters/MatterActivityTab';
import { MatterDeadlinesTab } from '@/components/litigation/matters/MatterDeadlinesTab';
import { MatterFacts } from '@/components/litigation/matters/MatterSidePanel';
import {
  CloseMatterDialog, EditDemandDialog, EditMatterDialog, RecordOrderDialog, RecordReplyDialog, ReopenDialog,
} from '@/components/litigation/matters/MatterDialogs';
import { cn } from '@/lib/utils';

type Tab = 'notices' | 'hearings' | 'payments' | 'documents' | 'activity' | 'deadlines';
const TABS: { key: Tab; label: string }[] = [
  { key: 'notices', label: 'Notices' }, { key: 'hearings', label: 'Hearings' }, { key: 'payments', label: 'Payments' },
  { key: 'documents', label: 'Documents' }, { key: 'activity', label: 'Activity' }, { key: 'deadlines', label: 'Deadlines' },
];
type DialogKey = 'hearing' | 'outcome' | 'payment' | 'reply' | 'order' | 'close' | 'decide' | 'reopen' | 'edit' | 'demand' | 'link' | null;

/** Stages the matter has been in, from its stage history (null when it has none). */
function visited(ws: MatterWorkspace): Set<string> | null {
  if (!ws.history.length) return null;
  const s = new Set<string>();
  ws.history.forEach((h) => { if (h.from_stage) s.add(toStageKey(h.from_stage)); s.add(toStageKey(h.to_stage)); });
  return s;
}

const LitigationMatterDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { user, isStaffRole, canEditNoticeStatus } = useAuth();
  const { staff } = useStaffList();
  const [dialog, setDialog] = useState<DialogKey>(null);
  const [hearing, setHearing] = useState<MatterHearing | null>(null);
  const q = useQuery({ queryKey: ['matter-workspace', id], queryFn: () => loadMatterWorkspace(id), enabled: !!id, retry: (n, e) => !(e instanceof MatterNotFound) && n < 2 });
  const ws = q.data;
  const tab = (TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'notices') as Tab;
  const setTab = (t: string) => { const next = new URLSearchParams(sp); next.set('tab', t); setSp(next, { replace: true }); };
  const rail = useMemo(() => (ws ? visited(ws) : null), [ws]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const reload = () => {
    qc.invalidateQueries({ queryKey: ['matter-workspace', id] });
    qc.invalidateQueries({ queryKey: ['matter-list'] });
    qc.invalidateQueries({ queryKey: ['matter-suggestions'] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['notice-hearings'] });
  };

  if (q.isLoading) {
    return (
      <div className={WS_PAGE} aria-busy="true">
        <Skeleton className="h-4 w-80" /><Skeleton className="h-8 w-[32rem] max-w-full" /><Skeleton className="h-5 w-[40rem] max-w-full" />
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[70px]" />)}</div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (q.error || !ws) {
    const notFound = q.error instanceof MatterNotFound;
    return (
      <div className={WS_PAGE}>
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground md:pr-12">
          <Link to="/notices-dashboard" className="hover:underline">Notices & Litigation</Link> › <Link to="/litigation" className="hover:underline">Matters</Link>
        </nav>
        <Note tone="warn">{notFound ? (q.error as Error).message : <>Couldn't load the matter: {q.error instanceof Error ? q.error.message : String(q.error)}</>}</Note>
        <div className="flex gap-2">
          {!notFound && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => q.refetch()}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry</Button>}
          <Button size="sm" variant="outline" className={WS_BTN} asChild><Link to="/litigation">All matters</Link></Button>
        </div>
      </div>
    );
  }

  const m = ws.matter;
  const money = ws.money;
  const stage = toStageKey(m.stage);
  const closed = stage === 'closed';
  const canEdit = canEditNoticeStatus();
  const edit = canEdit && !closed;
  const nameOf = (uid: string | null) => (uid ? staff.find((s) => s.userId === uid)?.name ?? (uid === user?.id ? user?.firstName ?? 'Me' : 'Staff') : null);
  const owner = nameOf(m.owner_user_id);
  const reviewer = nameOf(m.reviewer_user_id);
  const next = ws.clocks[0] ?? null;
  const last = ws.history[ws.history.length - 1];
  const now = Date.now();
  const awaitingOutcome = ws.hearings.find((h) => !h.outcome && new Date(h.scheduled_at).getTime() <= now);
  const upcoming = ws.hearings.find((h) => !h.outcome && new Date(h.scheduled_at).getTime() > now);
  const need = isAppeal(ws) ? preDepositNeed(ws) : null;
  const openNotice = ws.notices.filter((n) => n.is_open && !n.reply_date).sort((a, b) => (a.effective_due ?? '9').localeCompare(b.effective_due ?? '9'))[0];
  const closedEvent = ws.events.find((e) => e.event_type === 'closed');

  const run = async (fn: () => Promise<void>, ok: string) => {
    try { await fn(); toast.success(ok); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  const changeStage = async (to: StageKey, reason?: string) => {
    if (!user) return;
    // Stages that carry facts ask for them first (U-89-3).
    if (to === 'filed') { setDialog('reply'); return; }
    if (to === 'order') { setDialog('order'); return; }
    if (to === 'hearing' && !upcoming) { setHearing(null); setDialog('hearing'); return; }
    await run(() => changeMatterStage(m, to, user, { reason: reason ?? null }), to === 'closed' ? 'Matter closed' : `Moved to ${stageLabel(to)}`);
  };
  const assign = (role: 'owner' | 'reviewer') => async (p: { userId: string; name: string } | null) => {
    if (!user) return;
    await run(() => assignMatter(m, role, p, role === 'owner' ? owner : reviewer, user), p ? `${role === 'owner' ? 'Owner' : 'Reviewer'}: ${p.name}` : `${role === 'owner' ? 'Owner' : 'Reviewer'} removed`);
  };

  // The one next step, by where the matter stands (U-84-5).
  const step = ((): { hint: string; button: React.ReactNode } => {
    const b = (label: string, onClick: () => void, Icon?: React.ElementType) => (
      <Button size="sm" className={WS_BTN} onClick={onClick}>{Icon && <Icon className="h-3.5 w-3.5" aria-hidden />} {label}</Button>
    );
    if (closed) return { hint: 'This matter is closed.', button: canEdit ? b('Reopen', () => setDialog('reopen'), RotateCcw) : null };
    if (!canEdit) return { hint: next ? `${next.label} ${clockWhen(next)}` : 'Nothing is running.', button: null };
    if (!m.owner_user_id) return { hint: 'Nobody owns this matter yet.', button: <AssignPopover currentOwnerId={null} suggestedName={ws.client?.assigned_accountant} onAssign={assign('owner')}><Button size="sm" className={WS_BTN}><UserPlus className="h-3.5 w-3.5" aria-hidden /> Assign</Button></AssignPopover> };
    if (awaitingOutcome) return { hint: `The hearing of ${fmtDateTime(awaitingOutcome.scheduled_at)} has no outcome yet.`, button: b('Record outcome', () => { setHearing(awaitingOutcome); setDialog('outcome'); }, CalendarClock) };
    if (stage === 'new') return { hint: 'Read the notices, set the priority and the next step.', button: b('Mark triaged', () => changeStage('triaged')) };
    if (['triaged', 'evidence', 'waiting_client', 'draft'].includes(stage)) {
      return openNotice
        ? { hint: 'The reply is prepared on the notice.', button: <Button size="sm" className={WS_BTN} asChild><Link to={`/notices/${openNotice.id}?tab=draft`}><FileText className="h-3.5 w-3.5" aria-hidden /> Work on the reply</Link></Button> }
        : { hint: 'Record the reply once it is filed on the portal.', button: b('Record reply filed', () => setDialog('reply'), FileText) };
    }
    if (stage === 'partner_review') return { hint: 'After approval, file the reply and record it.', button: b('Record reply filed', () => setDialog('reply'), FileText) };
    if (stage === 'filed') return upcoming ? { hint: 'Waiting for the hearing or the order.', button: b('Record order', () => setDialog('order'), Gavel) } : { hint: 'Fix the hearing when the officer gives a date, or record the order.', button: b('Fix a hearing', () => { setHearing(null); setDialog('hearing'); }, CalendarClock) };
    if (stage === 'hearing') return upcoming ? { hint: `Prepare for ${fmtDateTime(upcoming.scheduled_at)}.`, button: b('Prepare hearing', () => setTab('hearings'), CalendarClock) } : { hint: 'Record the order when it comes.', button: b('Record order', () => setDialog('order'), Gavel) };
    if (stage === 'order') return { hint: `Accept, rectify or appeal${m.limitation_date ? ` by ${fmtDate(m.limitation_date)}` : ''}.`, button: b('Decide on the order', () => setDialog('decide'), Scale) };
    if (need && money.preDeposit < need.required && need.tax > 0) return { hint: `Pre-deposit ${fmtInr(need.required - money.preDeposit)} short.`, button: b('Record pre-deposit', () => setDialog('payment'), IndianRupee) };
    return upcoming ? { hint: `Prepare for ${fmtDateTime(upcoming.scheduled_at)}.`, button: b('Prepare hearing', () => setTab('hearings'), CalendarClock) } : { hint: 'Record the appeal order when it comes.', button: b('Record order', () => setDialog('order'), Gavel) };
  })();

  const counts: Record<Tab, number> = {
    notices: ws.notices.length, hearings: ws.hearings.length, payments: ws.payments.length,
    documents: ws.documents.length + ws.notices.filter((n) => n.pdf_url).length + ws.folder.reduce((s, f) => s + (Array.isArray(f.attachments) ? f.attachments.length : 0), 0),
    activity: ws.events.length + ws.noticeEvents.length, deadlines: ws.clocks.length,
  };
  const meta = [lifecycleLabel(m.lifecycle), m.section_of_law, (m.financial_years ?? []).length ? `FY ${(m.financial_years ?? []).map(fmtFy).join(', ')}` : '', forumLabel(m), m.officer].filter(Boolean);

  return (
    <div className={WS_PAGE}>
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground md:pr-12">
        <Link to="/notices-dashboard" className="hover:underline">Notices & Litigation</Link> ›
        <Link to="/litigation" className="hover:underline">Matters</Link> ›
        <Link to={mattersHref({ client: m.client_id, status: 'all' })} className="hover:underline">{ws.client?.name ?? 'Client'}</Link> ›
        <span className="whitespace-nowrap font-mono text-foreground">{m.matter_no}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3 md:pr-12">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="break-words font-heading text-lg font-bold leading-tight sm:text-xl">{m.title || lifecycleLabel(m.lifecycle)}</h1>
          <p className="text-xs text-muted-foreground">
            <span className="whitespace-nowrap font-mono">{m.matter_no}</span> · {ws.client?.name}{ws.client?.gstin ? <> · <span className="font-mono">{ws.client.gstin}</span></> : null}
            {meta.length ? ` · ${meta.join(' · ')}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {!closed && (next
              ? <Badge variant={next.days < 0 ? 'destructive' : next.days <= 7 ? 'warning' : 'secondary'} className="text-[11px]">{next.label} · {clockWhen(next)} · {next.days < 0 ? `${-next.days} d late` : next.days === 0 ? 'today' : `in ${next.days} d`}</Badge>
              : <Badge variant="secondary" className="text-[11px]">No clock running</Badge>)}
            {edit ? <StagePicker noun="matter" value={m.stage} since={last?.changed_at} by={nameOf(last?.changed_by ?? null)} onChange={changeStage} /> : <StageBadge stage={m.stage} since={last?.changed_at} by={nameOf(last?.changed_by ?? null)} />}
            {edit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Badge variant={m.priority === 'High' ? 'destructive' : m.priority === 'Medium' ? 'warning' : 'secondary'} className="gap-1 text-[11px]">
                      Priority: {m.priority ?? 'not set'} <ChevronDown className="h-3 w-3" aria-hidden />
                    </Badge>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(['High', 'Medium', 'Low'] as const).map((p) => (
                    <DropdownMenuItem key={p} onSelect={() => user && run(() => setMatterPriority(m, p, user), `Priority ${p}`)}>{p}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : m.priority && <Badge variant="secondary" className="text-[11px]">Priority: {m.priority}</Badge>}
            {edit ? (
              <AssignPopover currentOwnerId={m.owner_user_id} suggestedName={ws.client?.assigned_accountant} onAssign={assign('owner')} align="start">
                <button type="button" className="rounded-md border px-1.5 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="sr-only">Owner: </span><OwnerChip name={owner} showName /><span className="sr-only">. Change owner</span>
                </button>
              </AssignPopover>
            ) : <OwnerChip name={owner} showName />}
            {edit ? (
              <AssignPopover currentOwnerId={m.reviewer_user_id} onAssign={assign('reviewer')} align="start">
                <button type="button" className="rounded-md border px-1.5 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Reviewer: {reviewer ?? 'none'}<span className="sr-only">. Change reviewer</span>
                </button>
              </AssignPopover>
            ) : reviewer && <span className="text-xs">Reviewer: {reviewer}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {edit && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => { setHearing(null); setDialog('hearing'); }}><CalendarClock className="h-3.5 w-3.5" aria-hidden /> Fix a hearing</Button>}
          {edit && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setDialog('payment')}><IndianRupee className="h-3.5 w-3.5" aria-hidden /> Record payment</Button>}
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className={WS_BTN}><MoreHorizontal className="h-3.5 w-3.5" aria-hidden /> More</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!closed && <DropdownMenuItem onSelect={() => setDialog('reply')}><FileText className="mr-2 h-4 w-4" aria-hidden /> Record reply filed</DropdownMenuItem>}
                {!closed && <DropdownMenuItem onSelect={() => setDialog('order')}><Gavel className="mr-2 h-4 w-4" aria-hidden /> Record order</DropdownMenuItem>}
                {!closed && <DropdownMenuItem onSelect={() => setDialog('edit')}><Pencil className="mr-2 h-4 w-4" aria-hidden /> Edit details and dates</DropdownMenuItem>}
                {!closed && <DropdownMenuItem onSelect={() => setDialog('demand')}><IndianRupee className="mr-2 h-4 w-4" aria-hidden /> Edit demand</DropdownMenuItem>}
                {!closed && <DropdownMenuItem onSelect={() => setTab('documents')}><Upload className="mr-2 h-4 w-4" aria-hidden /> Upload documents</DropdownMenuItem>}
                <DropdownMenuSeparator />
                {closed
                  ? <DropdownMenuItem onSelect={() => setDialog('reopen')}><RotateCcw className="mr-2 h-4 w-4" aria-hidden /> Reopen</DropdownMenuItem>
                  : <DropdownMenuItem onSelect={() => setDialog('close')}><XCircle className="mr-2 h-4 w-4" aria-hidden /> Close the matter</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {step.button}
        </div>
      </header>

      {closed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span>
            <span className="font-semibold">Closed {fmtDate(istDate(m.closed_at ?? last?.changed_at ?? null))}</span>
            {closedEvent?.actor_name ? ` by ${closedEvent.actor_name}` : ''}
            {m.closed_reason ? ` · ${matterCloseText(m.closed_reason)}` : ''}
            <span className="block text-xs text-foreground/70">Read-only while closed — reopen it to change anything.</span>
          </span>
          {canEdit && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setDialog('reopen')}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reopen</Button>}
        </div>
      )}
      {!canEdit && <Note tone="info">You can read this matter. Changing it needs the "Edit notice status" permission — ask a GST manager.</Note>}

      <StageRail stage={stage} visited={rail} since={last?.changed_at ?? m.created_at} by={nameOf(last?.changed_by ?? null)} closeReason={m.closed_reason ? matterCloseText(m.closed_reason) : null}
        replyDate={ws.notices.map((n) => n.reply_date).filter(Boolean).sort().pop() ?? null}
        hearingDate={ws.hearings.filter((h) => h.outcome).map((h) => istDate(h.scheduled_at)).pop() ?? null}
        orderDate={ws.notices.map((n) => n.order_date).filter(Boolean).sort().pop() ?? null} />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiTile label="Demand" value={money.recorded ? fmtInr(money.demand) : 'Not recorded'}
          hint={money.recorded ? `tax ${fmtInr(money.tax)} · interest ${fmtInr(money.interest)} · penalty ${fmtInr(money.penalty)}${money.cess ? ` · cess ${fmtInr(money.cess)}` : ''}`
            : edit ? <button type="button" className="text-primary underline underline-offset-2" onClick={() => setDialog('demand')}>Add it from the notice or order</button> : 'no amount entered'} />
        <KpiTile label="Paid" value={fmtInr(money.paid)} hint={money.refunded ? `refunded ${fmtInr(money.refunded)}` : plural(ws.payments.filter((p) => p.kind !== 'pre_deposit').length, 'payment')} />
        <KpiTile label="Pre-deposit" value={fmtInr(money.preDeposit)}
          hint={need && need.tax > 0 ? `${fmtInr(need.required)} required (${need.p107}% of tax)` : 'needed only to appeal'} tone={need && need.tax > 0 ? (money.preDeposit >= need.required ? 'ok' : 'warn') : 'neutral'} />
        <KpiTile label="Outstanding" value={money.recorded ? fmtInr(money.outstanding) : '—'}
          tone={!money.recorded ? 'neutral' : closed || money.outstanding === 0 ? 'ok' : 'error'}
          hint={money.recorded ? `${fmtInr(money.demand)} − ${fmtInr(money.paid)} paid − ${fmtInr(money.preDeposit)} pre-deposit` : 'demand not recorded'} />
      </div>

      <MatterFacts ws={ws} hint={step.hint} canEdit={edit} onChanged={reload} />

      <Tabs value={tab} onValueChange={setTab} className="min-w-0 space-y-2">
          <TabsList className={cn(TAB_LIST_CLASS, 'w-full sm:w-auto')}>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className={cn(TAB_TRIGGER_CLASS, 'h-8 px-3')}>
                {t.label}{counts[t.key] > 0 && <span className="rounded-full bg-card/30 px-1.5 text-[10px] font-semibold tabular-nums">{counts[t.key]}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="rounded-lg border bg-card p-3">
            <TabsContent value="notices" className="mt-0"><MatterNoticesTab ws={ws} canEdit={edit} onLink={() => setDialog('link')} onChanged={reload} /></TabsContent>
            <TabsContent value="hearings" className="mt-0">
              <MatterHearingsTab ws={ws} canEdit={edit} onChanged={reload} onSchedule={() => { setHearing(null); setDialog('hearing'); }}
                onChange={(h) => { setHearing(h); setDialog('hearing'); }} onOutcome={(h) => { setHearing(h); setDialog('outcome'); }} />
            </TabsContent>
            <TabsContent value="payments" className="mt-0"><MatterPaymentsTab ws={ws} canEdit={edit} onRecord={() => setDialog('payment')} onChanged={reload} /></TabsContent>
            <TabsContent value="documents" className="mt-0"><MatterDocumentsTab ws={ws} canEdit={edit} onChanged={reload} /></TabsContent>
            <TabsContent value="activity" className="mt-0"><MatterActivityTab ws={ws} canEdit={canEdit} onChanged={reload} /></TabsContent>
            <TabsContent value="deadlines" className="mt-0"><MatterDeadlinesTab ws={ws} canEdit={edit} onChanged={reload} /></TabsContent>
          </div>
        </Tabs>

      <HearingDialog open={dialog === 'hearing'} onOpenChange={(o) => setDialog(o ? 'hearing' : null)} ws={ws} hearing={hearing} onDone={reload} />
      <OutcomeDialog open={dialog === 'outcome'} onOpenChange={(o) => setDialog(o ? 'outcome' : null)} ws={ws} hearing={hearing} onDone={reload} onOrder={() => setDialog('order')} />
      <RecordPaymentDialog open={dialog === 'payment'} onOpenChange={(o) => setDialog(o ? 'payment' : null)} ws={ws} onDone={reload} />
      <RecordReplyDialog open={dialog === 'reply'} onOpenChange={(o) => setDialog(o ? 'reply' : null)} ws={ws} onDone={reload} />
      <RecordOrderDialog open={dialog === 'order'} onOpenChange={(o) => setDialog(o ? 'order' : null)} ws={ws} onDone={reload} />
      <CloseMatterDialog open={dialog === 'close' || dialog === 'decide'} preset={dialog === 'decide' ? 'appeal' : null} onOpenChange={(o) => setDialog(o ? dialog : null)} ws={ws} onDone={reload} />
      <ReopenDialog open={dialog === 'reopen'} onOpenChange={(o) => setDialog(o ? 'reopen' : null)} ws={ws} onDone={reload} />
      <EditMatterDialog open={dialog === 'edit'} onOpenChange={(o) => setDialog(o ? 'edit' : null)} ws={ws} onDone={reload} />
      <EditDemandDialog open={dialog === 'demand'} onOpenChange={(o) => setDialog(o ? 'demand' : null)} ws={ws} onDone={reload} />
      <LinkNoticesDialog open={dialog === 'link'} onOpenChange={(o) => setDialog(o ? 'link' : null)} ws={ws} onDone={reload} />
    </div>
  );
};

export default LitigationMatterDetailPage;
