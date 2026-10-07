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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, ChevronDown, ExternalLink, FileText, Gavel, Hourglass, Loader2, Mail, MoreHorizontal, RefreshCw, Scale, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_BTN, WS_PAGE } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import { loadWorkspace, NoticeHidden, NoticeNotFound, assignOwner, setPriority, setStage, docEmailOutcome, emailDocumentRequests, type Workspace } from '@/lib/noticeWorkspace';
import { nextActionDef, type StageKey, type WorkspaceTab } from '@/lib/noticeStages';
import { closeReasonText, dueWords, fmtDate, fmtDateTime, fmtInrShort, noticeTitle, sentenceCase } from '@/lib/noticeFormat';
import { AssignPopover } from '@/components/notices/AssignPopover';
import { StagePicker } from '@/components/notices/StagePicker';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { LogReplyDialog } from '@/components/notices/actions/LogReplyDialog';
import { LogOrderDialog } from '@/components/notices/actions/LogOrderDialog';
import { HearingDialog } from '@/components/notices/actions/HearingDialog';
import { ExtensionDialog } from '@/components/notices/actions/ExtensionDialog';
import { MatterDialog } from '@/components/notices/actions/MatterDialog';
import type { NoticeRef } from '@/components/notices/actions/NoticeContext';
import { StageRail } from '@/components/notices/workspace/StageRail';
import { FactTiles } from '@/components/notices/workspace/FactTiles';
import { IssuesTab } from '@/components/notices/workspace/IssuesTab';
import { EvidenceTab } from '@/components/notices/workspace/EvidenceTab';
import { AskClientDialog } from '@/components/notices/workspace/AskClientDialog';
import { ReadCloseDialog } from '@/components/notices/workspace/ReadCloseDialog';
import { NoticeReadCard } from '@/components/notices/reply/read/NoticeReadCard';
import { aiDetail, isActiveRead, loadReading } from '@/lib/noticeReading';
import { DraftTab } from '@/components/notices/workspace/DraftTab';
import { DocumentsTab, portalReplyFrom } from '@/components/notices/workspace/DocumentsTab';
import { ActivityTab } from '@/components/notices/workspace/ActivityTab';
import { PaymentsTab } from '@/components/notices/workspace/PaymentsTab';
import { HearingsTab } from '@/components/notices/workspace/HearingsTab';
import { DeadlinesTab } from '@/components/notices/workspace/DeadlinesTab';
import { KeyFacts, NextStepCard } from '@/components/notices/workspace/SidePanel';
import { cn } from '@/lib/utils';

const TABS: { key: WorkspaceTab; label: string }[] = [
  { key: 'issues', label: 'Issues' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'draft', label: 'Draft reply' },
  { key: 'documents', label: 'Documents' },
  { key: 'activity', label: 'Activity' },
  { key: 'payments', label: 'Payments' },
  { key: 'hearings', label: 'Hearings' },
  { key: 'deadlines', label: 'Deadlines' },
];

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
  return <Badge variant={d.tone} className="text-[11px]" title={d.title}>{d.label}<span className="sr-only">: {d.title.toLowerCase()}</span></Badge>;
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

/**
 * The stages this notice has actually been in, from its event history. Only
 * known when its capture recorded a stage (notices captured from Phase 2 on);
 * older notices return null and the rail ticks every stage before the current.
 */
function visitedStages(ws: Workspace): Set<string> | null {
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const seen = new Set<string>();
  let origin = false;
  for (const e of ws.events) {
    const nv = obj(e.new_value);
    const ov = obj(e.old_value);
    if (e.event_type === 'captured' && typeof nv.stage === 'string') { seen.add(nv.stage); origin = true; }
    if (e.event_type === 'stage_changed' || e.event_type === 'closed' || e.event_type === 'reopened') {
      if (typeof ov.stage === 'string') seen.add(ov.stage);
      if (typeof nv.stage === 'string') seen.add(nv.stage);
    }
  }
  return origin ? seen : null;
}

const DRAFT_STATUS: Record<string, string> = {
  draft: 'in draft', in_review: 'with partner', changes_requested: 'changes asked', approved: 'approved',
};

/** The header's due chip: overdue / due soon / replied / none (U-42-4: said once, here). */
function DueChip({ ws }: { ws: Workspace }) {
  const f = ws.fact;
  if (f.stage === 'closed') return <Badge variant="secondary" className="text-[11px]">Closed{ws.notice.close_reason ? ` · ${closeReasonText(ws.notice.close_reason).replace('Closed automatically: ', 'auto: ')}` : ''}</Badge>;
  if (f.reply_date) return <Badge variant="success" className="text-[11px]">Replied {fmtDate(f.reply_date)}</Badge>;
  // A type that needs no reply runs on no reply clock (contract A): no due chip.
  if (f.response_need === 'none') return null;
  if (!f.effective_due) return <Badge variant="secondary" className="text-[11px]">No due date</Badge>;
  const d = f.days_to_due ?? 0;
  return (
    <Badge variant={d < 0 ? 'destructive' : d <= 7 ? 'warning' : 'secondary'} className="text-[11px]">
      {d < 0 ? `Overdue ${-d} d` : d === 0 ? 'Due today' : `Due in ${d} d`} · {fmtDate(f.effective_due)}{f.due_basis === 'computed' ? ' (computed)' : f.due_basis === 'extended' ? ' (extended)' : ''}
    </Badge>
  );
}

const NoticeWorkspacePage: React.FC = () => {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { user, isStaffRole, canEditNoticeStatus, canApproveNoticeReplies } = useAuth();
  const bridge = useExtensionBridge();
  const [dialog, setDialog] = useState<DialogKey>(null);
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
  const tab = (TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'issues') as WorkspaceTab;
  const setTab = (t: string) => { const next = new URLSearchParams(sp); next.set('tab', t); setSp(next, { replace: true }); };
  const ref = useMemo(() => (ws ? toRef(ws) : null), [ws]);
  const portalReply = useMemo(() => (ws ? portalReplyFrom(ws.folder) : null), [ws]);
  const visited = useMemo(() => (ws ? visitedStages(ws) : null), [ws]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const reload = () => {
    qc.invalidateQueries({ queryKey: ['notice-workspace', id] });
    qc.invalidateQueries({ queryKey: ['notice-reading', id] });
    qc.invalidateQueries({ queryKey: ['notice-reply-options', id] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['notice-plan-top'] });
  };
  const canEdit = canEditNoticeStatus();

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
  if (q.error || !ws || !ref) {
    const notFound = q.error instanceof NoticeNotFound;
    const hidden = q.error instanceof NoticeHidden ? q.error.formCode : null;
    return (
      <div className={WS_PAGE}>
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground"><Link to="/notices-dashboard" className="hover:underline">Notices & Litigation</Link> › Notice</nav>
        <Note tone={hidden ? 'info' : 'warn'}>
          {hidden ? `${hidden} notices are hidden everywhere, so this one is not shown. It stays on record; a superadmin or GST manager can show the type again under Notice types.`
            : notFound ? 'This notice is not on record — it may have been removed by a portal sync, or the link is wrong.'
            : <>Couldn't load the notice: {q.error instanceof Error ? q.error.message : String(q.error)}</>}
        </Note>
        <div className="flex gap-2">
          {!notFound && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => q.refetch()}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>}
          <Button size="sm" variant="outline" className={WS_BTN} asChild><Link to="/notices-all">All notices</Link></Button>
        </div>
      </div>
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

  return (
    <div className={WS_PAGE}>
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground md:pr-12">
        <Link to="/notices-dashboard" className="hover:underline">Notices & Litigation</Link> ›
        <Link to="/notices-all" className="hover:underline">All notices</Link> ›
        <Link to={`/notices-company/${n.client_id}`} className="hover:underline">{ws.client?.name}</Link>
        <span className="font-mono">{ws.client?.gstin}</span> › <span className="text-foreground">{f.form_code || sentenceCase(n.notice_type)}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3 md:pr-12">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="font-heading text-lg font-bold leading-tight sm:text-xl">{title}</h1>
          <p className="text-xs text-muted-foreground">
            {n.reference_number && <>Ref <span className="font-mono">{n.reference_number}</span> · </>}
            {n.case_id && <>Case <span className="font-mono">{n.case_id}</span> · </>}
            {n.din && <>DIN <span className="font-mono">{n.din}</span> · </>}
            {n.issue_date ? `issued ${fmtDate(n.issue_date)}` : 'issue date not known'}{n.issued_by ? ` by ${n.issued_by}` : ''}
            {' · '}{n.portal_key?.startsWith('manual:') ? 'typed in' : 'captured by the portal sync'} {fmtDateTime(n.first_seen_at)}
            {n.pdf_url && <> · <a href={n.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">PDF <ExternalLink className="h-3 w-3" /></a></>}
          </p>
          {n.description && <p className="line-clamp-2 text-sm" title={n.description}>{sentenceCase(n.description)}</p>}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <DueChip ws={ws} />
            <ResponseNeedChip need={f.response_need} />
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Badge variant={f.effective_priority === 'High' ? 'destructive' : f.effective_priority === 'Medium' ? 'warning' : 'secondary'} className="gap-1 text-[11px]">
                      Priority: {f.effective_priority ?? 'not set'}{!n.priority && f.default_priority ? ' (form default)' : ''} <ChevronDown className="h-3 w-3" />
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
            ) : f.effective_priority && <Badge variant="secondary" className="text-[11px]">Priority: {f.effective_priority}</Badge>}
            {canEdit ? (
              <AssignPopover currentOwnerId={n.assign_to_user_id} suggestedName={ws.client?.assigned_accountant} onAssign={assign} align="start">
                <button type="button" className="rounded-md border px-1.5 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="sr-only">Owner: </span><OwnerChip name={n.assign_to} showName /><span className="sr-only">. Change owner</span>
                </button>
              </AssignPopover>
            ) : <OwnerChip name={n.assign_to} showName />}
            <StagePicker value={f.stage} since={f.stage_changed_at} by={f.stage_changed_by} disabled={!canEdit} onChange={changeStage} />
            {ws.issues.length > 0 && <Badge variant="info" className="text-[11px]">{ws.issues.length} issue{ws.issues.length === 1 ? '' : 's'} · {fmtInrShort(issuesTotal)}</Badge>}
            {latestDraft && <Badge variant={latestDraft.status === 'approved' ? 'success' : latestDraft.status === 'changes_requested' ? 'warning' : 'secondary'} className="text-[11px]">Draft v{latestDraft.version} · {DRAFT_STATUS[latestDraft.status] ?? latestDraft.status.replace('_', ' ')}</Badge>}
            {ws.matter && <Link to={`/litigation/${ws.matter.id}`}><Badge variant="secondary" className="text-[11px] hover:bg-muted">Matter {ws.matter.matter_no}</Badge></Link>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && !closed && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setDialog('docs')}><Mail className="h-3.5 w-3.5" /> Ask client</Button>}
          {canEdit && !closed && !f.reply_date && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setDialog('extension')}><Hourglass className="h-3.5 w-3.5" /> Extension</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className={WS_BTN} aria-label="More actions"><MoreHorizontal className="h-3.5 w-3.5" /> More</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && !closed && <DropdownMenuItem onSelect={() => setDialog('reply')}><FileText className="mr-2 h-4 w-4" /> Log reply</DropdownMenuItem>}
              {canEdit && !closed && <DropdownMenuItem onSelect={() => setDialog('order')}><Gavel className="mr-2 h-4 w-4" /> Log order</DropdownMenuItem>}
              {canEdit && !closed && <DropdownMenuItem onSelect={() => setDialog('hearing')}><CalendarClock className="mr-2 h-4 w-4" /> {n.hearing_date ? 'Change hearing' : 'Fix a hearing'}</DropdownMenuItem>}
              {/* A finished notice gets no new matter (U-44-5); an order can still go to appeal from the next step. */}
              {canEdit && (!closed || n.matter_id) && <DropdownMenuItem onSelect={() => setDialog('matter')}><Scale className="mr-2 h-4 w-4" /> {n.matter_id ? 'Move to another matter' : 'Create or link a matter'}</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={openPortal} disabled={!bridge.ready}><ExternalLink className="mr-2 h-4 w-4" /> Open on the portal{!bridge.ready ? ' (needs the extension)' : ''}</DropdownMenuItem>
              {n.pdf_url && <DropdownMenuItem asChild><a href={n.pdf_url} target="_blank" rel="noreferrer"><FileText className="mr-2 h-4 w-4" /> Notice PDF</a></DropdownMenuItem>}
              {n.case_id && <DropdownMenuItem asChild><Link to={`/notices-case-folder/${n.client_id}/${encodeURIComponent(n.case_id)}`}><FileText className="mr-2 h-4 w-4" /> Case folder</Link></DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          {primary}
        </div>
      </header>

      {!canEdit && <Note tone="info">You can read this notice. Changing it needs the "Edit notice status" permission — ask a GST manager.</Note>}

      <StageRail stage={f.stage ?? 'new'} visited={visited} since={f.stage_changed_at} by={f.stage_changed_by} closeReason={n.close_reason}
        replyDate={n.reply_date} hearingDate={n.hearing_date} orderDate={n.order_date} />

      <FactTiles ws={ws} onAskClient={canEdit && !closed ? () => setDialog('docs') : undefined} />

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <NoticeReadCard ws={ws} reading={rq.data} loading={rq.isLoading} error={rq.error} canEdit={canEdit} onChanged={reload} />
          <Tabs value={tab} onValueChange={setTab} className="min-w-0 space-y-2">
            <TabsList className={cn(TAB_LIST_CLASS, 'w-full sm:w-auto')}>
              {TABS.map((t) => {
                const count = t.key === 'documents' ? ws.documents.length + ws.folder.length + (n.pdf_url ? 1 : 0)
                  : t.key === 'issues' ? ws.issues.length : t.key === 'deadlines' ? ws.deadlines.filter((d) => !d.is_met).length : 0;
                return (
                  <TabsTrigger key={t.key} value={t.key} className={cn(TAB_TRIGGER_CLASS, 'h-8 px-3')}>
                    {t.label}{count > 0 && <span className="rounded-full bg-card/30 px-1.5 text-[10px] font-semibold tabular-nums">{count}</span>}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            <div className="rounded-lg border bg-card p-3">
              <TabsContent value="issues" className="mt-0"><IssuesTab noticeId={n.id} issues={ws.issues} canEdit={canEdit} onChanged={reload} /></TabsContent>
              <TabsContent value="evidence" className="mt-0"><EvidenceTab ws={ws} canEdit={canEdit} onChanged={reload} /></TabsContent>
              <TabsContent value="draft" className="mt-0"><DraftTab ws={ws} canEdit={canEdit} canApprove={canApproveNoticeReplies()} onChanged={reload} /></TabsContent>
              <TabsContent value="documents" className="mt-0"><DocumentsTab ws={ws} canEdit={canEdit} onChanged={reload} onAskClient={() => setDialog('docs')} /></TabsContent>
              <TabsContent value="activity" className="mt-0"><ActivityTab notice={n} events={ws.events} canEdit={canEdit} onChanged={reload} /></TabsContent>
              <TabsContent value="payments" className="mt-0"><PaymentsTab ws={ws} canEdit={canEdit} onChanged={reload} /></TabsContent>
              <TabsContent value="hearings" className="mt-0"><HearingsTab ws={ws} canEdit={canEdit} onFix={() => setDialog('hearing')} /></TabsContent>
              <TabsContent value="deadlines" className="mt-0"><DeadlinesTab ws={ws} canEdit={canEdit} onChanged={reload} /></TabsContent>
            </div>
          </Tabs>
        </div>
        <aside className="space-y-3" aria-label="Next step and key facts">
          <NextStepCard ws={ws} action={primary ?? <span className="text-xs text-muted-foreground">{dueWords(f.days_to_due)}</span>} />
          <KeyFacts ws={ws} />
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
    </div>
  );
};

export default NoticeWorkspacePage;
