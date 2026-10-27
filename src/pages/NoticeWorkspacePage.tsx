// The notice workspace at /notices/:id (roadmap Phase 2 task 1;
// docs/notices-mission-audit/mocks/target-notice.png; findings R-18, R-19,
// R-28, L-19, U-27-1, U-40-*, U-41-*). One page per notice, reachable by URL
// from every e-mail, the bell, search and every list: header facts, the stage
// rail, the four figures, what the notice says (Phase 4: read from the portal
// and the PDF, each value with its source, verified in one click; R-08), and
// tabs for Issues · Evidence · Draft · Documents · Activity · Payments ·
// Hearings · Deadlines. The next step can be done from here without leaving
// the page. Replaces the read-only drawer. Phase 4b: how much the notice type
// needs a reply (Critical / Optional / Info only), reply options on the Draft
// tab, and "Read and close" for types that need no reply.
// Laid out by the UX audit of 25 October 2026: the module's tabs stay and the
// breadcrumb goes through the notice's case; the header says the due date,
// stage and owner once; the work is the tabs, the three that build a reply
// numbered as steps, Payments, Hearings and Deadlines only once they hold
// something; beside them the figures and what the notice says, in one rail.
// Drafting is offered by the notice's stage (src/lib/noticeDrafting.ts): an
// order gets its letters and a way to the case's Appeal view, a reply filed or
// overtaken by an order keeps its drafts to read, the AI assistant only while
// a reply is being prepared.
import { NoticeExcludeDialog } from '@/components/notices/NoticeExcludeDialog';
import { canManageNoticeTypes } from '@/lib/noticeTypes';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Check, ChevronDown, ExternalLink, EyeOff, FileText, Gavel, Hourglass, Info, Loader2, Mail, MoreHorizontal, RefreshCw, Scale, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { useAuth } from '@/contexts/AuthContext';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import { loadWorkspace, NoticeHidden, NoticeNotFound, assignOwner, setPriority, setStage, docEmailOutcome, emailDocumentRequests, type Workspace } from '@/lib/noticeWorkspace';
import { nextActionDef, type StageKey, type WorkspaceTab } from '@/lib/noticeStages';
import { closeReasonText, fmtDate, fmtDateTime, fmtInrShort, noticeTitle, plural, sentenceCase } from '@/lib/noticeFormat';
import { AssignPopover } from '@/components/notices/AssignPopover';
import { StagePicker } from '@/components/notices/StagePicker';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { StatusStrip } from '@/components/notices/cases/StatusStrip';
import { LogReplyDialog } from '@/components/notices/actions/LogReplyDialog';
import { LogOrderDialog } from '@/components/notices/actions/LogOrderDialog';
import { HearingDialog } from '@/components/notices/actions/HearingDialog';
import { ExtensionDialog } from '@/components/notices/actions/ExtensionDialog';
import { MatterDialog } from '@/components/notices/actions/MatterDialog';
import type { NoticeRef } from '@/components/notices/actions/NoticeContext';
import { FactTiles } from '@/components/notices/workspace/FactTiles';
import { IssuesTab } from '@/components/notices/workspace/IssuesTab';
import { EvidenceTab } from '@/components/notices/workspace/EvidenceTab';
import { AskClientDialog } from '@/components/notices/workspace/AskClientDialog';
import { ReadCloseDialog } from '@/components/notices/workspace/ReadCloseDialog';
import { NoticeReadCard } from '@/components/notices/reply/read/NoticeReadCard';
import { aiDetail, isActiveRead, loadReading } from '@/lib/noticeReading';
import { DraftTab } from '@/components/notices/workspace/DraftTab';
import { AssistantTab } from '@/components/notices/workspace/AssistantTab';
import { DocumentsTab, portalReplyFrom } from '@/components/notices/workspace/DocumentsTab';
import { ActivityTab } from '@/components/notices/workspace/ActivityTab';
import { PaymentsTab } from '@/components/notices/workspace/PaymentsTab';
import { VoluntaryCancelNote } from '@/components/notices/workspace/VoluntaryCancelNote';
import { payToCloseQuote } from '@/lib/noticePayToClose';
import { HearingsTab } from '@/components/notices/workspace/HearingsTab';
import { DeadlinesTab } from '@/components/notices/workspace/DeadlinesTab';
import { KeyFactsLine } from '@/components/notices/workspace/SidePanel';
import { KindFacts } from '@/components/notices/cases/KindFacts';
import { CaseLinkSuggest } from '@/components/notices/cases/CaseLinkSuggest';
import { caseHref, caseKeyOf, loadCase, tabsFor, trackDef, trackOfCategory, useCaseOverview, type Track } from '@/lib/noticeCases';
import { cn } from '@/lib/utils';
import { useCaseDocuments } from '@/lib/caseDocuments';
import { assistantOffered, draftEditable, draftingPhase } from '@/lib/noticeDrafting';
import { appealsShown, useCaseAppeals } from '@/lib/noticeAppeals';

const TABS: { key: WorkspaceTab; label: string }[] = [
  { key: 'issues', label: 'Issues' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'draft', label: 'Draft reply' },
  { key: 'assistant', label: 'AI assistant' },
  { key: 'documents', label: 'Documents' },
  { key: 'activity', label: 'Activity' },
  { key: 'payments', label: 'Payments' },
  { key: 'hearings', label: 'Hearings' },
  { key: 'deadlines', label: 'Deadlines' },
];

// A reply is built in three steps (the UX audit of 25 October 2026): the tabs
// that make it are numbered and ticked; the rest of the tabs follow a divider,
// and Payments, Hearings and Deadlines appear once they hold something.
const STEP_NO: Partial<Record<WorkspaceTab, number>> = { issues: 1, evidence: 2, draft: 3 };
const STEP_HINT: Partial<Record<WorkspaceTab, string>> = {
  issues: 'Step 1: list what the notice alleges, each with its amount',
  evidence: 'Step 2: build the evidence that answers each issue',
  draft: 'Step 3: write the reply, have it approved, then log it as filed',
};
const OPTIONAL_TABS: WorkspaceTab[] = ['payments', 'hearings', 'deadlines'];

type DialogKey = 'reply' | 'order' | 'docs' | 'hearing' | 'extension' | 'matter' | 'close' | null;

/** How much the notice type needs a reply (notice_type_settings.response_need via notice_facts). */
const NEED: Record<string, { label: string; title: string; tone: 'destructive' | 'warning' | 'secondary' }> = {
  critical: { label: 'Critical', title: 'Reply required', tone: 'destructive' },
  optional: { label: 'Optional', title: 'Reply optional', tone: 'warning' },
  none: { label: 'Info only', title: 'No reply needed', tone: 'secondary' },
};

function ResponseNeedChip({ need }: { need: string | null | undefined }) {
  const d = need ? NEED[need] : undefined;
  if (!d) return null;
  return <Badge variant={d.tone} className="text-xs" title={d.title}>{d.label}<span className="sr-only">: {d.title.toLowerCase()}</span></Badge>;
}

function toRef(ws: Workspace): NoticeRef {
  const f = ws.fact;
  const n = ws.notice;
  return {
    id: n.id, client_id: n.client_id, client_name: ws.client?.name ?? f.client_name, reference_number: n.reference_number,
    case_id: n.case_id, form_code: f.form_code, form_label: f.form_label, notice_type: n.notice_type, description: n.description,
    financial_year: n.financial_year, effective_due: f.effective_due, amount_of_demand: n.amount_of_demand, matter_id: n.matter_id,
    hearing_date: n.hearing_date, hearing_note: n.hearing_note, extended_due_date: n.extended_due_date, due_date: n.due_date,
  };
}

const DRAFT_STATUS: Record<string, string> = {
  draft: 'in draft', in_review: 'with partner', changes_requested: 'changes asked', approved: 'approved',
};

/** The header's due chip: overdue / due soon / replied / none (U-42-4: said once, here). */
function DueChip({ ws }: { ws: Workspace }) {
  const f = ws.fact;
  if (f.stage === 'closed') return <Badge variant="secondary" className="text-xs">Closed{ws.notice.close_reason ? ` · ${closeReasonText(ws.notice.close_reason).replace('Closed automatically: ', 'auto: ')}` : ''}</Badge>;
  if (f.reply_date) return <Badge variant="success" className="text-xs">Replied {fmtDate(f.reply_date)}</Badge>;
  // An order under appeal has met its clock (20261012100000): the appeal is the task now.
  if (f.stage === 'appeal') return <Badge variant="info" className="text-xs">In appeal</Badge>;
  // A type that needs no reply runs on no reply clock (contract A): no due chip.
  if (f.response_need === 'none') return null;
  if (!f.effective_due) return <Badge variant="secondary" className="text-xs">No due date</Badge>;
  const d = f.days_to_due ?? 0;
  return (
    <Badge variant={d < 0 ? 'destructive' : d <= 7 ? 'warning' : 'secondary'} className="text-xs">
      {d < 0 ? `Overdue ${-d} d` : d === 0 ? 'Due today' : `Due in ${d} d`} · {fmtDate(f.effective_due)}{f.due_basis === 'computed' ? ' (computed)' : f.due_basis === 'extended' ? ' (extended)' : ''}
    </Badge>
  );
}

/** A note with a heading that says it in a line and the reason under it (27 October 2026: no truncated one-line walls). */
function Callout({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-wrap items-start gap-3 rounded-lg border border-info/40 bg-info/5 px-4 py-3">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
      <div className="min-w-0 flex-1 basis-80">
        <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>
        <p className="mt-0.5 text-sm leading-relaxed text-foreground/80">{children}</p>
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </section>
  );
}

/** Why the page offers the drafting it does, once a reply is no longer what is being prepared. */
function DraftingNote({ phase, replyDate, appealHref, underAppeal }: { phase: ReturnType<typeof draftingPhase>; replyDate: string | null; appealHref: string | null; underAppeal: boolean }) {
  const appeal = appealHref && (
    <Button size="sm" variant="outline" className={WS_BTN} asChild><Link to={appealHref}><Scale className="h-3.5 w-3.5" /> {underAppeal ? 'Open the appeal' : 'Prepare the appeal'}</Link></Button>
  );
  if (phase === 'order') {
    return (
      <Callout title="This is an order, so it is not replied to" action={appeal}>
        It is appealed, rectified or paid: the statement of facts, grounds of appeal and written submission are drafted on the case's Appeal view, and the letters (rectification, stay of recovery, payment) on the Letters tab.
      </Callout>
    );
  }
  if (phase === 'moved_on') {
    return (
      <Callout title={`The proceedings have moved on to the order${underAppeal ? ' and its appeal' : ''}`} action={appeal}>
        No reply is drafted for this notice now; its drafts stay here to read.
      </Callout>
    );
  }
  if (phase === 'replied') {
    return (
      <Callout title={`The reply was filed${replyDate ? ` on ${fmtDate(replyDate)}` : ''}`}>
        Its draft stays here as it was. Drafting opens again for a written submission once a hearing is fixed.
      </Callout>
    );
  }
  return null;
}

const NoticeWorkspacePage: React.FC = () => {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, isStaffRole, canEditNoticeStatus, canApproveNoticeReplies } = useAuth();
  const bridge = useExtensionBridge();
  const [dialog, setDialog] = useState<DialogKey>(null);
  const [hiding, setHiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['notice-workspace', id], queryFn: () => loadWorkspace(id), enabled: !!id, retry: (n, e) => !(e instanceof NoticeNotFound) && n < 2 });
  const ws = q.data;
  const clientId = ws?.notice.client_id;
  // What the readers found; polled while a PDF read is queued or running.
  const rq = useQuery({
    queryKey: ['notice-reading', id],
    queryFn: () => loadReading(id, clientId as string),
    enabled: !!clientId,
    refetchInterval: (query) => (isActiveRead(query.state.data?.ai) ? 20_000 : false),
  });
  const wasReading = useRef(false);
  useEffect(() => {
    const active = isActiveRead(rq.data?.ai);
    // A read that just finished filled fields and issues: load the notice again.
    if (wasReading.current && !active) qc.invalidateQueries({ queryKey: ['notice-workspace', id] });
    wasReading.current = active;
  }, [rq.data, id, qc]);
  // The notice's kind of service and its case (20261011100000): a refund,
  // registration or record-only notice gets the facts and tabs of its kind.
  const track: Track = trackOfCategory(ws?.fact.category);
  const caseKey = ws ? caseKeyOf(ws.notice.case_id, ws.fact.category, ws.notice.id) : null;
  const phase = ws ? draftingPhase(ws.fact) : 'reply';
  const caseOv = useCaseOverview(clientId, caseKey, ws?.notice.id ?? null);
  // The case's Appeal view, where an order's appeal is drafted, when it has an appeal to offer.
  const caseAppeals = useCaseAppeals(clientId ?? '', phase === 'order' || phase === 'moved_on' ? caseKey : null);
  const appealHref = clientId && caseKey && appealsShown(caseAppeals.data).length > 0 ? `${caseHref(clientId, caseKey)}?side=appeal` : null;
  const caseRow = useQuery({ queryKey: ['notice-case', clientId, caseKey], queryFn: () => loadCase(clientId as string, caseKey as string), enabled: !!clientId && !!caseKey, staleTime: 60_000 });
  const needsReply = ws?.fact.response_need === 'critical';
  const wantTab = sp.get('tab');
  const shownTabs = useMemo(() => {
    const keys = tabsFor(track, needsReply);
    const has: Partial<Record<WorkspaceTab, boolean>> = {
      payments: !!ws && (ws.payments.length > 0 || ws.drc03.length > 0 || !!payToCloseQuote(ws.notice)),
      hearings: !!ws && (!!ws.notice.hearing_date || ws.hearings.length > 0),
      deadlines: !!ws && ws.deadlines.length > 0,
    };
    // Drafting only where it still makes sense: the assistant while a reply is prepared, a closed draft tab only to read what it holds.
    const drafting = (k: WorkspaceTab) => (k === 'assistant' ? assistantOffered(phase)
      : k === 'draft' ? draftEditable(phase) || (ws?.drafts.length ?? 0) > 0 : true);
    return TABS.filter((t) => keys.includes(t.key) && drafting(t.key) && (!OPTIONAL_TABS.includes(t.key) || has[t.key] || wantTab === t.key));
  }, [track, needsReply, ws, wantTab, phase]);
  const hasEvidenceTab = shownTabs.some((t) => t.key === 'evidence');
  // The documents organised (named, by stage, evidence apart), for the tab counts; the tabs read the same queries.
  const caseDocs = useCaseDocuments(ws);
  const tab = (shownTabs.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : shownTabs[0]?.key ?? 'documents') as WorkspaceTab;
  const setTab = (t: string) => { const next = new URLSearchParams(sp); next.set('tab', t); setSp(next, { replace: true }); };
  const ref = useMemo(() => (ws ? toRef(ws) : null), [ws]);
  const portalReply = useMemo(() => (ws ? portalReplyFrom(ws.folder) : null), [ws]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const reload = () => {
    qc.invalidateQueries({ queryKey: ['notice-workspace', id] });
    qc.invalidateQueries({ queryKey: ['notice-reading', id] });
    qc.invalidateQueries({ queryKey: ['notice-reply-options', id] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['notice-plan-top'] });
  };
  const canEdit = canEditNoticeStatus();
  const lit = track === 'litigation';

  if (q.isLoading) {
    return (
      <NoticesShell section="Notice" record crumbs={[{ label: 'Cases', to: '/notices-cases' }, { label: 'Notice' }]}>
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-8 w-[32rem] max-w-full" /><Skeleton className="h-5 w-[40rem] max-w-full" />
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[70px]" />)}</div>
        <Skeleton className="h-96 w-full" />
        </div>
      </NoticesShell>
    );
  }
  if (q.error || !ws || !ref) {
    const notFound = q.error instanceof NoticeNotFound;
    const hidden = q.error instanceof NoticeHidden ? q.error.formCode : null;
    return (
      <NoticesShell section="Notice" record crumbs={[{ label: 'Cases', to: '/notices-cases' }, { label: 'Notice' }]}>
        <Note tone={hidden ? 'info' : 'warn'}>
          {hidden ? `${hidden} notices are hidden everywhere, so this one is not shown. It stays on record; a superadmin or GST manager can show the type again under Notice types.`
            : notFound ? 'This notice is not on record — it may have been removed by a portal sync, or the link is wrong.'
            : <>Couldn't load the notice: {q.error instanceof Error ? q.error.message : String(q.error)}</>}
        </Note>
        <div className="flex gap-2">
          {!notFound && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => q.refetch()}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>}
          <Button size="sm" variant="outline" className={WS_BTN} asChild><Link to="/notices-all">All notices</Link></Button>
        </div>
      </NoticesShell>
    );
  }

  const f = ws.fact;
  const n = ws.notice;
  const closed = f.stage === 'closed';
  const title = noticeTitle(f);
  const issuesTotal = ws.issues.reduce((s, i) => s + Number(i.amount || 0), 0);
  const latestDraft = ws.drafts[0];

  const changeStage = async (stage: StageKey, reason?: string) => {
    if (!user) return;
    try { await setStage(n.id, stage, user, reason); toast.success(stage === 'closed' ? 'Closed' : `Moved to ${stage.replace('_', ' ')}`); reload(); }
    catch (e) { toast.error(`Couldn't change the stage: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const assign = async (o: { userId: string; name: string } | null) => {
    if (!user) return;
    try { await assignOwner(n.id, o, user); toast.success(o ? `Assigned to ${o.name}` : 'Unassigned'); reload(); }
    catch (e) { toast.error(`Couldn't assign: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const remind = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const o = docEmailOutcome(await emailDocumentRequests(n.id, user, true), 'reminder');
      toast[o.tone](o.text);
      reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const openPortal = async () => {
    if (!bridge.ready) { toast.error('Install or enable the GST Keeper extension to open the portal from here.'); return; }
    const r = await bridge.openOnPortal(n.client_id, n.reference_number);
    if (!r.ok) toast.error(r.error || 'Could not open the portal.');
  };

  // The one primary action, chosen by what is next for this notice.
  const primary = (() => {
    if (!canEdit) return null;
    if (closed) return <Button size="sm" className={WS_BTN} onClick={() => changeStage('triaged')}>Reopen</Button>;
    // An order is answered by an appeal, drafted on the case's Appeal view.
    if (phase === 'order' && appealHref && f.next_action !== 'assign') {
      return <Button size="sm" className={WS_BTN} asChild><Link to={appealHref}><Scale className="h-3.5 w-3.5" /> {f.stage === 'appeal' ? 'Open the appeal' : 'Prepare the appeal'}</Link></Button>;
    }
    // A refund, registration or record-only notice: reply when it asks for one, else read and close.
    if (!lit) {
      if (!n.assign_to_user_id && needsReply) {
        return <AssignPopover currentOwnerId={n.assign_to_user_id} suggestedName={ws.client?.assigned_accountant} onAssign={assign}>
          <Button size="sm" className={WS_BTN}><UserPlus className="h-3.5 w-3.5" /> Assign</Button></AssignPopover>;
      }
      if (needsReply && !f.reply_date) return <Button size="sm" className={WS_BTN} onClick={() => setTab('draft')}>Write the reply</Button>;
      if (needsReply) return <Button size="sm" className={WS_BTN} onClick={() => setDialog('order')}><Gavel className="h-3.5 w-3.5" /> Log order</Button>;
      return <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setDialog('close')}>Read and close</Button>;
    }
    const key = f.next_action ?? (f.stage === 'filed' || f.stage === 'hearing' ? 'await_order' : null);
    const def = nextActionDef(key);
    switch (key) {
      case 'assign':
        return <AssignPopover currentOwnerId={n.assign_to_user_id} suggestedName={ws.client?.assigned_accountant} onAssign={assign}>
          <Button size="sm" className={WS_BTN}><UserPlus className="h-3.5 w-3.5" /> Assign</Button></AssignPopover>;
      case 'triage': return <Button size="sm" className={WS_BTN} onClick={() => changeStage('triaged')}>Mark triaged</Button>;
      case 'read_close': return <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setDialog('close')}>{def.label}</Button>;
      case 'build_evidence':
        return ws.issues.length
          ? <Button size="sm" className={WS_BTN} onClick={() => setTab('evidence')}>Build evidence</Button>
          : <Button size="sm" className={WS_BTN} onClick={() => setTab('issues')}>List the issues</Button>;
      case 'start_work':
        return ws.issues.length
          ? <Button size="sm" className={WS_BTN} onClick={() => setTab('draft')}>Write the draft</Button>
          : <Button size="sm" className={WS_BTN} onClick={() => setTab('issues')}>List the issues</Button>;
      case 'chase_client': return <Button size="sm" className={WS_BTN} disabled={busy} onClick={remind}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Remind client ({f.docs_open})</Button>;
      case 'write_draft': case 'review_draft': return <Button size="sm" className={WS_BTN} onClick={() => setTab('draft')}>{def.label}</Button>;
      case 'file_reply': return <Button size="sm" className={WS_BTN} onClick={() => setDialog('reply')}>Log reply</Button>;
      case 'prepare_hearing': return <Button size="sm" className={WS_BTN} onClick={() => setTab('hearings')}>Prepare hearing</Button>;
      case 'decide_order': case 'follow_appeal':
        return n.matter_id
          ? <Button size="sm" className={WS_BTN} asChild><Link to={`/litigation/${n.matter_id}`}><Scale className="h-3.5 w-3.5" /> Open matter</Link></Button>
          : <Button size="sm" className={WS_BTN} onClick={() => setDialog('matter')}><Scale className="h-3.5 w-3.5" /> Create appeal matter</Button>;
      default: return <Button size="sm" className={WS_BTN} onClick={() => setDialog('order')}><Gavel className="h-3.5 w-3.5" /> Log order</Button>;
    }
  })();

  const stepDone = (k: WorkspaceTab) => (k === 'issues' ? ws.issues.length > 0
    : k === 'evidence' ? (caseDocs.model?.evidence.length ?? 0) > 0
    : k === 'draft' ? latestDraft?.status === 'approved' || !!f.reply_date : false);
  // Where the reply stands, in one line under the steps (was two badges in the header).
  const stepLine = lit && phase === 'reply' ? [
    ws.issues.length ? `${plural(ws.issues.length, 'issue')} listed · ${fmtInrShort(issuesTotal)}` : 'No issues listed yet',
    latestDraft ? `Draft v${latestDraft.version} ${DRAFT_STATUS[latestDraft.status] ?? latestDraft.status.replace('_', ' ')}` : null,
    f.reply_date ? `Replied ${fmtDate(f.reply_date)}` : null,
  ].filter(Boolean).join(' · ') : null;

  // Cases › client › the notice's case › the notice (the UX audit of 25 October 2026: a notice is reached through its case).
  const crumbs = [
    { label: `Cases · ${trackDef(track).label}`, to: `/notices-cases?kind=${track}` },
    { label: ws.client?.name ?? f.client_name ?? 'Client', to: `/notices-company/${n.client_id}` },
    ...(caseKey && caseRow.data ? [{ label: n.case_id ? <>Case <span className="font-mono">{n.case_id}</span></> : 'Case', to: `${caseHref(n.client_id, caseRow.data.case_key as string)}?notice=${n.id}` }] : []),
    { label: f.form_code || sentenceCase(n.notice_type) || 'Notice' },
  ];

  return (
    <NoticesShell section="Notice" record crumbs={crumbs}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="font-heading text-xl font-bold leading-tight sm:text-2xl">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {n.reference_number && <>Ref <span className="font-mono">{n.reference_number}</span> · </>}
            {n.case_id && <>Case <span className="font-mono">{n.case_id}</span> · </>}
            {n.din && <>DIN <span className="font-mono">{n.din}</span> · </>}
            {n.issue_date ? `issued ${fmtDate(n.issue_date)}` : 'issue date not known'}{n.issued_by ? ` by ${n.issued_by}` : ''}
            {n.portal_key?.startsWith('manual:') ? ' · typed in' : ''}
            {n.pdf_url && <> · <a href={n.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">PDF <ExternalLink className="h-3.5 w-3.5" /></a></>}
          </p>
          {n.description && <p className="line-clamp-2 text-[15px]" title={n.description}>{sentenceCase(n.description)}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && !closed && track !== 'other' && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setDialog('docs')}><Mail className="h-3.5 w-3.5" /> Ask client</Button>}
          {canEdit && phase === 'reply' && !f.reply_date && (lit || needsReply) && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setDialog('extension')}><Hourglass className="h-3.5 w-3.5" /> Extension</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className={WS_BTN} aria-label="More actions"><MoreHorizontal className="h-3.5 w-3.5" /> More</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && !closed && phase !== 'order' && (lit || needsReply) && <DropdownMenuItem onSelect={() => setDialog('reply')}><FileText className="mr-2 h-4 w-4" /> Log reply</DropdownMenuItem>}
              {canEdit && !closed && (lit || needsReply) && <DropdownMenuItem onSelect={() => setDialog('order')}><Gavel className="mr-2 h-4 w-4" /> Log order</DropdownMenuItem>}
              {canEdit && !closed && lit && <DropdownMenuItem onSelect={() => setDialog('hearing')}><CalendarClock className="mr-2 h-4 w-4" /> {n.hearing_date ? 'Change hearing' : 'Fix a hearing'}</DropdownMenuItem>}
              {canEdit && !closed && !lit && <DropdownMenuItem onSelect={() => setDialog('close')}><FileText className="mr-2 h-4 w-4" /> Read and close</DropdownMenuItem>}
              {/* A closed notice offers no matter or appeal (the firm's request of 12 October 2026). */}
              {canEdit && lit && !closed && <DropdownMenuItem onSelect={() => setDialog('matter')}><Scale className="mr-2 h-4 w-4" /> {n.matter_id ? 'Move to another matter' : 'Create or link a matter'}</DropdownMenuItem>}
              {canManageNoticeTypes(user?.role) && <DropdownMenuItem onSelect={() => setHiding(true)}><EyeOff className="mr-2 h-4 w-4" /> Not required (hide)</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={openPortal} disabled={!bridge.ready}><ExternalLink className="mr-2 h-4 w-4" /> Open on the portal{!bridge.ready ? ' (needs the extension)' : ''}</DropdownMenuItem>
              {n.pdf_url && <DropdownMenuItem asChild><a href={n.pdf_url} target="_blank" rel="noreferrer"><FileText className="mr-2 h-4 w-4" /> Notice PDF</a></DropdownMenuItem>}
              {n.case_id && <DropdownMenuItem asChild><Link to={`${caseHref(n.client_id as string, n.case_id)}?view=portal`}><FileText className="mr-2 h-4 w-4" /> Portal case folder</Link></DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          {primary}
        </div>
      </header>

      <StatusStrip cells={[
        { label: 'Reply', children: <><DueChip ws={ws} /><ResponseNeedChip need={f.response_need} /></> },
        { label: 'Stage', children: <StagePicker value={f.stage} since={f.stage_changed_at} by={f.stage_changed_by} disabled={!canEdit} onChange={changeStage} /> },
        { label: 'Priority', children: canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Badge variant={f.effective_priority === 'High' ? 'destructive' : f.effective_priority === 'Medium' ? 'warning' : 'secondary'} className="gap-1 text-xs">
                  {f.effective_priority ?? 'not set'}{!n.priority && f.default_priority ? ' (form default)' : ''} <ChevronDown className="h-3.5 w-3.5" />
                </Badge>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(['High', 'Medium', 'Low'] as const).map((p) => (
                <DropdownMenuItem key={p} onSelect={async () => { if (user) { await setPriority(n.id, p, user).catch((e) => toast.error(String(e))); reload(); } }}>{p}</DropdownMenuItem>
              ))}
              {n.priority && <DropdownMenuItem onSelect={async () => { if (user) { await setPriority(n.id, null, user).catch((e) => toast.error(String(e))); reload(); } }}>Use the form's default</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : <Badge variant="secondary" className="text-xs">{f.effective_priority ?? 'not set'}</Badge> },
        { label: 'Owner', children: canEdit ? (
          <AssignPopover currentOwnerId={n.assign_to_user_id} suggestedName={ws.client?.assigned_accountant} onAssign={assign} align="start">
            <button type="button" className="rounded-md border px-1.5 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="sr-only">Owner: </span><OwnerChip name={n.assign_to} showName className="[&>span:last-child]:text-sm" /><span className="sr-only">. Change owner</span>
            </button>
          </AssignPopover>
        ) : <OwnerChip name={n.assign_to} showName className="[&>span:last-child]:text-sm" /> },
      ]} />
      <div className="text-sm [&_p]:text-sm">
        <KeyFactsLine ws={ws}>
          {caseKey && caseRow.data && ((caseRow.data.notices ?? 0) > 1 || (caseRow.data.documents ?? 0) > 0) && (
            <Link to={caseHref(n.client_id, caseKey)} className="font-medium text-primary hover:underline">
              Case: {caseRow.data.notices} notice{caseRow.data.notices === 1 ? '' : 's'}{caseRow.data.documents ? `, ${caseRow.data.documents} document${caseRow.data.documents === 1 ? '' : 's'}` : ''}
              {(caseRow.data.new_items ?? 0) > 0 ? ` · ${caseRow.data.new_items} new` : ''} →
            </Link>
          )}
        </KeyFactsLine>
      </div>

      <NoticeExcludeDialog noticeId={n.id} open={hiding} onOpenChange={setHiding}
        onDone={() => { qc.invalidateQueries(); navigate('/notices-all'); }} />

      <CaseLinkSuggest noticeId={n.id} clientId={n.client_id} caseId={n.case_id} canEdit={canEdit}
        onLinked={() => { reload(); qc.invalidateQueries({ queryKey: ['notice-case'] }); qc.invalidateQueries({ queryKey: ['notice-case-overview'] }); }} />

      <DraftingNote phase={phase} replyDate={f.reply_date} appealHref={appealHref} underAppeal={f.stage === 'appeal'} />
      <VoluntaryCancelNote ws={ws} canClose={canEdit && !closed} onClose={(reason) => changeStage('closed', reason)} />

      {!canEdit && <Note tone="info">You can read this notice. Changing it needs the "Edit notice status" permission — ask a GST manager.</Note>}

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <Tabs value={tab} onValueChange={setTab} className="min-w-0 space-y-2">
          <TabsList className={cn(TAB_LIST_CLASS, 'h-auto w-full flex-wrap justify-start sm:w-auto')}>
            {shownTabs.map((t, i) => {
              const count = t.key === 'documents' ? (caseDocs.model ? caseDocs.model.documents.length + (caseDocs.model.noticePdf ? 1 : 0) + (hasEvidenceTab ? 0 : caseDocs.model.evidence.length) : ws.documents.length + ws.folder.length)
                : t.key === 'evidence' ? caseDocs.model?.evidence.length ?? 0
                : t.key === 'issues' ? ws.issues.length : t.key === 'deadlines' ? ws.deadlines.filter((d) => !d.is_met).length : 0;
              const steps = lit && phase === 'reply';
              const step = steps ? STEP_NO[t.key] : undefined;
              const done = step ? stepDone(t.key) : false;
              const afterSteps = !step && i > 0 && steps && !!STEP_NO[shownTabs[i - 1].key];
              return (
                <React.Fragment key={t.key}>
                  {afterSteps && <span aria-hidden className="mx-1 h-5 w-px self-center bg-border" />}
                  <TabsTrigger value={t.key} className={cn(TAB_TRIGGER_CLASS, 'h-8 gap-1.5 px-3')}
                    title={step ? STEP_HINT[t.key] : undefined}>
                    {step && (
                      <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold',
                        done ? 'bg-success text-success-foreground' : 'bg-card/40')} aria-hidden>
                        {done ? <Check className="h-3 w-3" /> : step}
                      </span>
                    )}
                    {t.key === 'draft' && phase === 'order' ? 'Letters' : t.label}{count > 0 && <span className="rounded-full bg-card/30 px-1.5 text-xs font-semibold tabular-nums">{count}</span>}
                    {step && done && <span className="sr-only"> (done)</span>}
                  </TabsTrigger>
                </React.Fragment>
              );
            })}
          </TabsList>
          {stepLine && <p className="text-sm text-muted-foreground">{stepLine}</p>}
          <div className="rounded-lg border bg-card p-3">
            <TabsContent value="issues" className="mt-0"><IssuesTab noticeId={n.id} issues={ws.issues} canEdit={canEdit} onChanged={reload} /></TabsContent>
            <TabsContent value="evidence" className="mt-0"><EvidenceTab ws={ws} canEdit={canEdit} onChanged={reload} /></TabsContent>
            <TabsContent value="assistant" className="mt-0"><AssistantTab ws={ws} canEdit={canEdit} onChanged={reload} onOpenDraft={() => setTab('draft')} /></TabsContent>
            <TabsContent value="draft" className="mt-0"><DraftTab ws={ws} canEdit={canEdit && draftEditable(phase)} canApprove={canApproveNoticeReplies()} onChanged={reload} /></TabsContent>
            <TabsContent value="documents" className="mt-0"><DocumentsTab ws={ws} canEdit={canEdit} onChanged={reload} onAskClient={() => setDialog('docs')} onOpenEvidence={hasEvidenceTab ? () => setTab('evidence') : undefined} /></TabsContent>
            <TabsContent value="activity" className="mt-0"><ActivityTab notice={n} events={ws.events} canEdit={canEdit} onChanged={reload} /></TabsContent>
            <TabsContent value="payments" className="mt-0"><PaymentsTab ws={ws} canEdit={canEdit} onChanged={reload} /></TabsContent>
            <TabsContent value="hearings" className="mt-0"><HearingsTab ws={ws} canEdit={canEdit} onFix={() => setDialog('hearing')} /></TabsContent>
            <TabsContent value="deadlines" className="mt-0"><DeadlinesTab ws={ws} canEdit={canEdit} onChanged={reload} /></TabsContent>
          </div>
        </Tabs>

        <aside className="min-w-0 space-y-3 xl:sticky xl:top-3" aria-label="The notice's facts">
          {lit ? <FactTiles ws={ws} rail onAskClient={canEdit && !closed ? () => setDialog('docs') : undefined} />
            : <KindFacts track={track} overview={caseOv.data} loading={caseOv.isLoading} forms={caseRow.data?.forms ?? (f.form_code ? [f.form_code] : [])} rail
                notice={{ form_label: f.form_label, issue_date: n.issue_date, reference_number: n.reference_number, financial_year: n.financial_year, description: n.description }} />}
          <NoticeReadCard ws={ws} reading={rq.data} loading={rq.isLoading} error={rq.error} canEdit={canEdit} onChanged={reload}
            caseOverview={caseOv.data} readingOnly={!lit} rail />
          {(['payments', 'hearings', 'deadlines'] as const).some((k) => !shownTabs.some((t) => t.key === k) && tabsFor(track, needsReply).includes(k)) && (
            <p className="px-1 text-xs text-muted-foreground">
              {(['payments', 'hearings', 'deadlines'] as const).filter((k) => !shownTabs.some((t) => t.key === k) && tabsFor(track, needsReply).includes(k))
                .map((k) => TABS.find((t) => t.key === k)?.label.toLowerCase()).join(', ')} appear as tabs once there is something to show.{' '}
              {canEdit && !closed && lit && <button type="button" className="text-primary hover:underline" onClick={() => setDialog('hearing')}>Fix a hearing</button>}
            </p>
          )}
        </aside>
      </div>

      <LogReplyDialog notice={ref} open={dialog === 'reply'} onOpenChange={(o) => setDialog(o ? 'reply' : null)} onDone={reload} portalReply={portalReply} />
      <LogOrderDialog notice={ref} open={dialog === 'order'} onOpenChange={(o) => setDialog(o ? 'order' : null)} onDone={reload} />
      <AskClientDialog notice={ref} clientEmail={ws.client?.email ?? null} issues={ws.issues} requests={ws.requests} noticeAsks={aiDetail(rq.data?.aiDone).documentsAsked}
        open={dialog === 'docs'} onOpenChange={(o) => setDialog(o ? 'docs' : null)} onDone={reload} />
      <HearingDialog notice={ref} open={dialog === 'hearing'} onOpenChange={(o) => setDialog(o ? 'hearing' : null)} onDone={reload} />
      <ExtensionDialog notice={ref} open={dialog === 'extension'} onOpenChange={(o) => setDialog(o ? 'extension' : null)} onDone={reload} />
      <MatterDialog notice={{ ...ref, stage: f.stage }} open={dialog === 'matter'} onOpenChange={(o) => setDialog(o ? 'matter' : null)} onDone={reload} />
      <ReadCloseDialog open={dialog === 'close'} onOpenChange={(o) => setDialog(o ? 'close' : null)} onClose={(reason) => changeStage('closed', reason)} />
    </NoticesShell>
  );
};

export default NoticeWorkspacePage;
