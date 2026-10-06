// (d) What the readers produced (roadmap Phase 4; audit R-08, R-28): the
// portal reader's readings of each notice's case-folder record, the issues
// found by source (portal, implied by the form, read from the PDF), the issues
// nobody has verified yet, and what became of the AI readings. Each count
// opens its list; AI outcomes open the AI reading tab's list.
import React from 'react';
import { Link } from 'react-router-dom';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { ToneBadge } from '@/components/notices/autopilot/parts';
import { Pager } from '@/components/notices/Pager';
import { fmtWhen } from '@/lib/autopilot';
import { fmtInr } from '@/lib/noticeFormat';
import {
  ISSUE_SOURCE_LABELS, factoryHref, readKeyDef, readStateDef, useAiOutcomeCounts, useIssueRows, useListPage, useReadings,
  type IssueFilter, type ReplyFactoryStatus,
} from '@/lib/replyFactory';
import { CountLink, DrillFrame, NoticeCell } from './parts';
import { cn } from '@/lib/utils';

const ISSUE_TITLES: Record<IssueFilter, string> = {
  portal: "Issues from the portal's case folder",
  form: 'Issues implied by the form',
  extracted: 'Issues read from the notice PDF',
  unverified: 'Issues nobody has verified yet',
};

export const ReadersSection: React.FC<{ s: ReplyFactoryStatus; show: string }> = ({ s, show }) => {
  const r = s.reading;
  const outcomes = useAiOutcomeCounts(true);
  const href = (k: string) => factoryHref('overview', { show: k });
  const issueFilter = show.startsWith('iss:') ? (show.slice(4) as IssueFilter) : null;
  const readFilter = show === 'rd:portal' || show === 'rd:portal_applied' ? show.slice(3) : null;
  const outcomeKeys = Object.entries(outcomes.data ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <SectionCard title="What the readers produced"
      description="The portal reader reads each notice's own case-folder record as it arrives. The AI reader reads the notice PDF once it is switched on, for clients with consent.">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="space-y-1 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Portal reader</h3>
          <p><CountLink to={href('rd:portal')} n={r.portal_read} /> notices read from the case folder</p>
          <p><CountLink to={href('rd:portal_applied')} n={r.portal_applied} /> filled empty fields on the notice</p>
        </div>
        <div className="space-y-1 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Issues found</h3>
          <ul className="space-y-0.5">
            <li><CountLink to={href('iss:portal')} n={r.issues_portal} /> from the portal's case folder</li>
            <li><CountLink to={href('iss:form')} n={r.issues_form} /> implied by the form (DRC-01B, DRC-01C)</li>
            <li><CountLink to={href('iss:extracted')} n={r.issues_extracted} /> read from the notice PDF</li>
            <li><CountLink to={href('iss:unverified')} n={r.issues_unverified} strong /> not verified yet</li>
          </ul>
        </div>
        <div className="space-y-1 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">AI reader</h3>
          <p><CountLink to={factoryHref('ai', { reads: 'st:done' })} n={r.ai_done} /> readings done</p>
          {outcomes.data && outcomeKeys.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="AI readings by what became of them">
              {outcomeKeys.map(([k, n]) => {
                const def = readKeyDef(k);
                return (
                  <li key={k}>
                    <Link to={factoryHref('ai', { reads: `oc:${k}` })}
                      className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {def.label} <span className="font-semibold tabular-nums">{n}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : outcomes.data ? <p className="text-xs text-muted-foreground">No AI reading yet.</p> : null}
        </div>
      </div>

      {issueFilter && ISSUE_TITLES[issueFilter] && <IssueList filter={issueFilter} />}
      {readFilter && <PortalReadList filter={readFilter} />}
    </SectionCard>
  );
};

const IssueList: React.FC<{ filter: IssueFilter }> = ({ filter }) => {
  const q = useIssueRows(filter);
  const rows = q.data ?? [];
  const pager = useListPage();
  const pageRows = pager.slice(rows);
  return (
    <DrillFrame title={ISSUE_TITLES[filter]} count={q.data ? rows.length : null} closeTo={factoryHref('overview', { show: 'none' })}
      loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} empty="No issue matches.">
      {filter === 'unverified' && <p className="text-xs text-foreground/80">Open the notice and confirm each issue against the PDF (the page and quote are on the issue).</p>}
      <ul className="space-y-1.5 md:hidden">
        {pageRows.map((i) => (
          <li key={i.id} className="space-y-1 rounded-md border bg-card p-2.5">
            <NoticeCell n={i.notice} id={i.notice_id} />
            <div className="text-xs font-medium">{i.title}</div>
            <div className="text-[11px] text-muted-foreground">
              {fmtInr(i.amount)} · {ISSUE_SOURCE_LABELS[i.source] ?? i.source}{i.page ? ` · page ${i.page}` : ''} · {i.verified ? 'verified' : 'not verified'}
            </div>
          </li>
        ))}
      </ul>
      <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
        <table className={WS_TABLE}>
          <caption className="sr-only">{ISSUE_TITLES[filter]}</caption>
          <thead>
            <tr>
              <th scope="col" className={WS_TH}>Notice</th>
              <th scope="col" className={WS_TH}>Issue</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Amount</th>
              <th scope="col" className={WS_TH}>Source</th>
              <th scope="col" className={WS_TH}>Verified</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((i) => (
              <tr key={i.id} className={WS_TR}>
                <td className={cn(WS_TD, 'max-w-[18rem]')}><NoticeCell n={i.notice} id={i.notice_id} /></td>
                <td className={cn(WS_TD, 'min-w-[14rem] text-xs')}>{i.title}{i.issue_code && <span className="block font-mono text-[10px] text-muted-foreground">{i.issue_code}</span>}</td>
                <td className={WS_TD_NUM}>{fmtInr(i.amount)}</td>
                <td className={cn(WS_TD, 'text-xs')}>{ISSUE_SOURCE_LABELS[i.source] ?? i.source}{i.page ? ` · page ${i.page}` : ''}</td>
                <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{i.verified ? 'Yes' : <span className="font-medium text-destructive-strong">Not yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={pager.page} pageSize={pager.pageSize} total={rows.length} onPage={pager.setPage} />
    </DrillFrame>
  );
};

const PortalReadList: React.FC<{ filter: string }> = ({ filter }) => {
  const q = useReadings(filter);
  const rows = q.data ?? [];
  const pager = useListPage();
  const title = filter === 'portal_applied' ? 'Portal readings that filled empty fields' : "Notices read from the portal's case folder";
  return (
    <DrillFrame title={title} count={q.data ? rows.length : null} closeTo={factoryHref('overview', { show: 'none' })}
      loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} empty="No portal reading yet.">
      <ul className="space-y-1.5">
        {pager.slice(rows).map((x) => {
          const def = readStateDef(x.status, x.outcome);
          return (
            <li key={x.id} className="flex flex-col gap-1 rounded-md border bg-card p-2.5 sm:flex-row sm:items-center sm:justify-between">
              <NoticeCell n={x.notice} id={x.notice_id} />
              <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                <ToneBadge tone={def.tone}>{def.label}</ToneBadge>
                <span className="text-muted-foreground">read {fmtWhen(x.finished_at ?? x.created_at)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <Pager page={pager.page} pageSize={pager.pageSize} total={rows.length} onPage={pager.setPage} />
    </DrillFrame>
  );
};

export default ReadersSection;
