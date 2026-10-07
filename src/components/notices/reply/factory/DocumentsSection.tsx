// (e) Client documents (roadmap Phase 4; audit R-11, R-25): what the firm has
// asked clients for — open, open for more than a week, received in the last
// 90 days (and how many through the client portal), how long receiving takes,
// and how many came from the issue codes' document lists. Each count opens
// the requests it counts; each request links to its notice's Documents tab.
import React from 'react';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { ToneBadge } from '@/components/notices/autopilot/parts';
import { Pager } from '@/components/notices/Pager';
import { fmtWhen } from '@/lib/autopilot';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate } from '@/lib/noticeFormat';
import { factoryHref, useDocRequestRows, useListPage, type DocFilter, type DocRequestRow, type ReplyFactoryStatus } from '@/lib/replyFactory';
import { CountLink, DrillFrame, NoticeCell } from './parts';
import { cn } from '@/lib/utils';

const TITLES: Record<DocFilter, string> = {
  open: 'Documents still asked for',
  old: 'Asked for more than 7 days ago and still open',
  received: 'Received in the last 90 days',
  portal: 'Uploaded by clients in the client portal (90 days)',
  catalogue: "Asked for from the issue codes' document lists",
};

const Status: React.FC<{ r: DocRequestRow }> = ({ r }) => {
  if (r.status === 'received') {
    return <ToneBadge tone="success">{r.client_uploaded_at ? 'Uploaded by the client' : 'Received'}</ToneBadge>;
  }
  if (r.status === 'waived') return <ToneBadge tone="secondary">Not needed</ToneBadge>;
  const late = !!r.due_date && r.due_date < istToday();
  return <ToneBadge tone={late ? 'destructive' : 'warning'}>{late ? 'Overdue' : 'Asked'}</ToneBadge>;
};

const when = (r: DocRequestRow) => (r.status === 'received'
  ? `received ${fmtWhen(r.client_uploaded_at ?? r.resolved_at)}${r.resolved_by_name ? ` · ${r.resolved_by_name}` : ''}`
  : `asked ${fmtWhen(r.requested_at)}${r.requested_by_name ? ` by ${r.requested_by_name}` : ''}${r.due_date ? ` · needed by ${fmtDate(r.due_date)}` : ''}`);

const DocStat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="truncate text-[11px] font-medium text-muted-foreground">{label}</dt>
    <dd className="text-lg font-semibold leading-tight tabular-nums">{children}</dd>
  </div>
);

export const DocumentsSection: React.FC<{ s: ReplyFactoryStatus; show: string; part?: 'card' | 'list' }> = ({ s, show, part = 'card' }) => {
  const d = s.documents;
  const href = (k: DocFilter) => factoryHref('overview', { show: `docs:${k}` });
  const filter = show.startsWith('docs:') ? (show.slice(5) as DocFilter) : null;
  const q = useDocRequestRows(filter && TITLES[filter] ? filter : null);
  const rows = q.data ?? [];
  const pager = useListPage();
  const pageRows = pager.slice(rows);

  const list = filter && TITLES[filter] ? (
    <DrillFrame title={TITLES[filter]} count={q.data ? rows.length : null} closeTo={factoryHref('overview', { show: 'none' })}
      loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} empty="No request matches.">
      <ul className="space-y-1.5 md:hidden">
        {pageRows.map((r) => (
          <li key={r.id} className="space-y-1 rounded-md border bg-card p-2.5">
            <NoticeCell n={r.notice} id={r.notice_id} tab="documents" />
            <div className="flex items-start justify-between gap-2 text-xs"><span className="min-w-0 break-words font-medium">{r.item}</span><Status r={r} /></div>
            <div className="text-[11px] text-muted-foreground">{when(r)}</div>
          </li>
        ))}
      </ul>
      <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
        <table className={WS_TABLE}>
          <caption className="sr-only">{TITLES[filter]}</caption>
          <thead>
            <tr>
              <th scope="col" className={WS_TH}>Notice</th>
              <th scope="col" className={WS_TH}>Document</th>
              <th scope="col" className={WS_TH}>Status</th>
              <th scope="col" className={WS_TH}>When</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} className={WS_TR}>
                <td className={cn(WS_TD, 'max-w-[18rem]')}><NoticeCell n={r.notice} id={r.notice_id} tab="documents" /></td>
                <td className={cn(WS_TD, 'min-w-[12rem] text-xs')}>{r.item}{r.source === 'catalogue' && <span className="block text-[11px] text-muted-foreground">from the issue code's list</span>}</td>
                <td className={WS_TD}><Status r={r} /></td>
                <td className={cn(WS_TD, 'text-xs')}>{when(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={pager.page} pageSize={pager.pageSize} total={rows.length} onPage={pager.setPage} />
    </DrillFrame>
  ) : null;
  if (part === 'list') return list;

  return (
    <SectionCard title="Client documents"
      description="What the firm asked clients for — from the issue codes' document lists or typed by staff — and how fast it came back. Reminders go on the alert engine's ladder; with alerts off nothing is e-mailed.">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        <DocStat label="Still asked for"><CountLink to={href('open')} n={d.open} /></DocStat>
        <DocStat label="Open over 7 days"><CountLink to={href('old')} n={d.open_over_7_days} strong /></DocStat>
        <DocStat label="Received, 90 days"><CountLink to={href('received')} n={d.received_90d} /></DocStat>
        <DocStat label="Via client portal"><CountLink to={href('portal')} n={d.via_portal_90d} /></DocStat>
        <DocStat label="Median days to receive">{d.median_days_to_receive === null ? '—' : `${Number(d.median_days_to_receive).toFixed(1).replace(/\.0$/, '')} d`}</DocStat>
        <DocStat label="From issue code lists"><CountLink to={href('catalogue')} n={d.from_catalogue} /></DocStat>
      </dl>
    </SectionCard>
  );
};

export default DocumentsSection;
