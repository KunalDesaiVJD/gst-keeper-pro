// "Today's plan — next best action" (target-dashboard.png; audit U-01-1/2,
// U-12-2): open notices ranked by deadline × exposure × readiness, one button
// per row that does the next step in place (assign, chase the client, log the
// reply) or opens the notice where it is done. The same rows, in full, are the
// Work queue page.
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { WS_TABS_LIST, WS_TAB, WS_TAB_ACTIVE, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import type { CommandCentre } from '@/lib/noticeCommandCentre';
import { loadPlanTop } from '@/lib/noticeCommandCentre';
import type { NoticePlanRow } from '@/lib/noticeFacts';
import { queueHref, type QueueTab } from '@/lib/noticeQueries';
import { nextActionDef } from '@/lib/noticeStages';
import { fmtDay, fmtInrShort, noticeTitle, sentenceCase } from '@/lib/noticeFormat';
import { assignOwner, docEmailOutcome, emailDocumentRequests } from '@/lib/noticeWorkspace';
import { AssignPopover } from '../AssignPopover';
import { OwnerChip } from '../OwnerChip';
import { StageBadge } from '../StageBadge';
import { LogReplyDialog } from '../actions/LogReplyDialog';
import type { NoticeRef } from '../actions/NoticeContext';
import { cn } from '@/lib/utils';

const TABS: { key: QueueTab; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'team', label: 'Team' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'review', label: 'Review' },
];

const KIND_WORD: Record<string, string> = { reply: 'reply', hearing: 'hearing', appeal: 'appeal clock', attachment: 'attachment' };

/** What the row's readiness bar says. */
export function readinessText(r: NoticePlanRow): string {
  if (r.stage === 'waiting_client' && (r.docs_total ?? 0) > 0) return `${(r.docs_total ?? 0) - (r.docs_open ?? 0)} of ${r.docs_total} documents in`;
  if (r.draft_status === 'approved') return `draft v${r.draft_version} approved`;
  if (r.draft_status === 'in_review') return `draft v${r.draft_version} with partner`;
  if (r.draft_version) return `draft v${r.draft_version}`;
  if ((r.issues_total ?? 0) > 0) return `${r.issues_total} issue${r.issues_total === 1 ? '' : 's'} · ${Math.round(100 * Number(r.issues_explained ?? 0) / Math.max(1, Number(r.issues_amount ?? 0)))}% explained`;
  if (r.stage === 'new') return 'not read yet';
  return 'not started';
}

export function dueCell(r: NoticePlanRow) {
  const d = r.days_to_plan_due;
  if (d === null || d === undefined || !r.plan_due) return <span className="text-muted-foreground">no date</span>;
  return (
    <span className="leading-tight">
      <span className={cn('block font-semibold tabular-nums', d < 0 ? 'text-destructive-strong' : d <= 3 ? 'text-warning-foreground' : '')}>
        {d < 0 ? `${-d} d late` : d === 0 ? 'today' : `${d} d`}
      </span>
      <span className="block text-[11px] text-muted-foreground">{fmtDay(r.plan_due)} · {KIND_WORD[r.plan_due_kind ?? 'reply'] ?? r.plan_due_kind}</span>
    </span>
  );
}

export const toNoticeRef = (r: NoticePlanRow): NoticeRef => ({
  id: r.id!, client_id: r.client_id!, client_name: r.client_name, reference_number: r.reference_number, case_id: r.case_id,
  form_code: r.form_code, form_label: r.form_label, notice_type: r.notice_type, description: r.description,
  financial_year: r.financial_year, effective_due: r.effective_due, amount_of_demand: r.amount_of_demand, matter_id: r.matter_id,
  hearing_date: r.hearing_date, hearing_note: r.hearing_note, extended_due_date: r.extended_due_date, due_date: r.due_date,
});

/** The one button of a plan row. */
export const NextActionButton: React.FC<{ row: NoticePlanRow; onChanged: () => void; compact?: boolean }> = ({ row, onChanged, compact }) => {
  const { user, canEditNoticeStatus } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const def = nextActionDef(row.next_action);
  const editable = canEditNoticeStatus();
  const btnCls = cn('h-7 px-2.5 text-xs', compact && 'w-full');
  const open = () => navigate(`/notices/${row.id}${def.tab ? `?tab=${def.tab}` : ''}`);

  if (!editable || !def.inline) {
    return <Button size="sm" variant={def.primary ? 'default' : 'outline'} className={btnCls} onClick={open}>{def.label}</Button>;
  }
  if (def.inline === 'assign') {
    return (
      <AssignPopover currentOwnerId={row.assign_to_user_id} onAssign={async (o) => {
        if (!user) return;
        try { await assignOwner(row.id!, o, user); toast.success(o ? `Assigned to ${o.name}` : 'Unassigned'); onChanged(); }
        catch (e) { toast.error(`Couldn't assign: ${e instanceof Error ? e.message : String(e)}`); }
      }}>
        <Button size="sm" className={btnCls}>Assign</Button>
      </AssignPopover>
    );
  }
  if (def.inline === 'chase') {
    return (
      <Button size="sm" variant="outline" className={btnCls} disabled={busy} onClick={async () => {
        if (!user) return;
        setBusy(true);
        try {
          const r = await emailDocumentRequests(row.id!, user, true);
          const o = docEmailOutcome(r, 'reminder');
          toast[o.tone](o.text);
          if (r.reason === 'no_client_email') open();
          onChanged();
        } catch (e) { toast.error(`Couldn't send the reminder: ${e instanceof Error ? e.message : String(e)}`); }
        finally { setBusy(false); }
      }}>
        {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{def.label} ({row.docs_open})
      </Button>
    );
  }
  return (
    <>
      <Button size="sm" className={btnCls} onClick={() => setReplyOpen(true)}>{def.label}</Button>
      <LogReplyDialog notice={toNoticeRef(row)} open={replyOpen} onOpenChange={setReplyOpen} onDone={onChanged} />
    </>
  );
};

export const PlanRows: React.FC<{ rows: NoticePlanRow[]; onChanged: () => void }> = ({ rows, onChanged }) => (
  <>
    {/* Phones and tablets: cards (U-20-6). */}
    <ul className="space-y-2 lg:hidden">
      {rows.map((r) => (
        <li key={r.id} className={cn('rounded-lg border bg-card p-3', (r.days_to_plan_due ?? 1) < 0 && 'border-destructive/50')}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link to={`/notices/${r.id}`} className="block truncate text-sm font-semibold hover:underline">{noticeTitle(r)}</Link>
              <div className="truncate text-xs text-muted-foreground">{r.client_name} · <span className="font-mono">{r.client_gstin}</span></div>
            </div>
            <div className="shrink-0 text-right text-xs">{dueCell(r)}</div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <StageBadge stage={r.stage} since={r.stage_changed_at} by={r.stage_changed_by} />
            <span className="truncate text-[11px] text-muted-foreground">{readinessText(r)}</span>
            <OwnerChip name={r.assign_to} className="ml-auto" />
          </div>
          <div className="mt-2"><NextActionButton row={r} onChanged={onChanged} compact /></div>
        </li>
      ))}
    </ul>
    <div className={cn(WS_TABLE_WRAP, 'hidden lg:block')}>
      <table className={WS_TABLE}>
        <thead>
          <tr>
            <th scope="col" className={WS_TH}>Client</th>
            <th scope="col" className={WS_TH}>Notice · what the system read</th>
            <th scope="col" className={WS_TH}>Due</th>
            <th scope="col" className={WS_TH}>Readiness</th>
            <th scope="col" className={WS_TH}>Next action</th>
            <th scope="col" className={cn(WS_TH, 'text-center')}><span className="sr-only">Owner</span><span aria-hidden>Own.</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cn(WS_TR, (r.days_to_plan_due ?? 1) < 0 && 'bg-destructive/[0.04]')}>
              <td className={cn(WS_TD, 'max-w-[11rem]')}>
                <div className="truncate font-medium">{r.client_name}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{r.client_gstin}</div>
              </td>
              <td className={cn(WS_TD, 'min-w-[14rem]')}>
                <Link to={`/notices/${r.id}`} className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {noticeTitle(r)}{r.amount_of_demand ? ` · ${fmtInrShort(r.amount_of_demand)}` : ''}
                </Link>
                <div className="line-clamp-1 text-xs text-muted-foreground" title={r.description ?? ''}>
                  {r.reference_number || r.case_id ? <span className="font-mono">{r.reference_number || r.case_id}</span> : null}
                  {r.description ? ` · ${sentenceCase(r.description)}` : ''}
                </div>
              </td>
              <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{dueCell(r)}</td>
              <td className={cn(WS_TD, 'w-32')}>
                <div className="h-1.5 rounded-full bg-muted" aria-hidden>
                  <div className={cn('h-1.5 rounded-full', (r.readiness_pct ?? 0) >= 80 ? 'bg-success' : (r.readiness_pct ?? 0) >= 40 ? 'bg-warning' : 'bg-info')}
                    style={{ width: `${Math.max(4, r.readiness_pct ?? 0)}%` }} />
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  <span className="sr-only">Readiness {r.readiness_pct}% · </span>{readinessText(r)}
                </div>
              </td>
              <td className={cn(WS_TD, 'whitespace-nowrap')} title={nextActionDef(r.next_action).hint}>
                <NextActionButton row={r} onChanged={onChanged} />
              </td>
              <td className={cn(WS_TD, 'w-12 text-center')}><OwnerChip name={r.assign_to} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>
);

export const TodaysPlan: React.FC<{ cc: CommandCentre | undefined }> = ({ cc }) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const counts = cc?.plan_counts;
  const [tab, setTab] = useState<QueueTab>('team');
  const userId = user?.id ?? null;
  const plan = useQuery({
    queryKey: ['notice-plan-top', tab, userId],
    queryFn: () => loadPlanTop(tab, userId, 8),
    staleTime: 60_000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notice-plan-top'] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
  };
  const rows = plan.data ?? [];
  const total = counts ? counts[tab] : rows.length;

  return (
    <SectionCard
      title="Today's plan — next best action"
      description="Ranked by statutory deadline × exposure × readiness. One click does the next step; the row leaves the list when it is done.">
      <div role="tablist" aria-label="Whose work" className={WS_TABS_LIST}>
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn(WS_TAB, 'h-7 px-2.5 text-xs', tab === t.key && WS_TAB_ACTIVE)}>
            {t.label}
            {counts && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold tabular-nums">{counts[t.key].toLocaleString('en-IN')}</span>}
          </button>
        ))}
      </div>
      {plan.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : plan.error ? (
        <p className="text-sm text-destructive-strong">Couldn't load the plan: {plan.error instanceof Error ? plan.error.message : String(plan.error)} <Button variant="link" className="h-auto p-0" onClick={() => plan.refetch()}>Retry</Button></p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {tab === 'mine' ? 'Nothing assigned to you needs action.' : tab === 'review' ? 'No draft is waiting for a partner.' : tab === 'unassigned' ? 'Every open notice has an owner.' : 'Nothing needs action.'}
        </p>
      ) : (
        <PlanRows rows={rows} onChanged={refresh} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Showing {rows.length} of {total.toLocaleString('en-IN')}
          {cc && cc.health.auto_closed_today > 0 && <> · {cc.health.auto_closed_today} closed automatically today — <Link to="/notices-all?filter=auto_closed" className="text-primary hover:underline">see why</Link></>}
        </span>
        <Link to={queueHref(tab)} className="font-medium text-primary hover:underline">Open the work queue ({total.toLocaleString('en-IN')}) →</Link>
      </div>
    </SectionCard>
  );
};

export default TodaysPlan;
