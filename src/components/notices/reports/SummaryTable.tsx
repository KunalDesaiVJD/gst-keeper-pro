// The Notice summary's breakdown (audit U-70-1, U-70-2, U-70-3): one row per
// category, stage or financial year that has notices — no placeholder rows,
// the categories nobody has a notice in folded into one line — with open,
// overdue, due in 7 days, unassigned, exposure, the oldest open notice's age,
// replied, closed and total, each a link to the list it counts. A table from
// md up, cards on a phone.
import React from 'react';
import { Link } from 'react-router-dom';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { StageBadge } from '@/components/notices/StageBadge';
import { noticesListHref, type NoticeListParams } from '@/lib/noticeQueries';
import { fmtDate, fmtInrShort } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { AmountLink, CountLink, SortHead } from './ReportBits';
import { ageDays, type BaseFilters, type Counts } from './noticeCounts';
import type { SummaryRow, SummarySort, SummaryTab } from './summaryRows';

// The categories the firm tracks; those without a notice are named on one line (U-70-1).
const WATCHED = ['Appeal', 'ASMT 10', 'Audit', 'DRC 01', 'Demand Notice', 'Enforcement', 'Ewaybill', 'LUT', 'Non filers',
  'Order Rectification', 'Others', 'Penalty', 'Recovery', 'Registration', 'AAR', 'TRAN 1', 'Anti evasion'];

interface Cell { key: SummarySort; label: string; node: (r: SummaryRow | null, c: Counts) => React.ReactNode }

export const SummaryTable: React.FC<{
  tab: SummaryTab;
  rows: SummaryRow[];
  total: Counts;
  base: BaseFilters;
  today: string;
  sort: SummarySort;
  dir: 'asc' | 'desc';
  onSort: (k: SummarySort) => void;
  showUntracked: boolean;
}> = ({ tab, rows, total, base, today, sort, dir, onSort, showUntracked }) => {
  const to = (r: SummaryRow | null, p: Partial<NoticeListParams>) => noticesListHref({ ...base, ...(r?.param ?? {}), ...p });
  const name = (r: SummaryRow | null) => (r ? r.label : 'All');
  // Rows the list cannot select show plain numbers; the total row sits on bg-muted.
  const count = (r: SummaryRow | null, n: number, p: Partial<NoticeListParams>, what: string, alarm = false) =>
    r && !r.param ? <span className="tabular-nums">{n}</span>
      : <CountLink n={n} to={to(r, p)} label={`${name(r)}, ${what}`} alarm={alarm} onMuted={!r} />;
  const cells: Cell[] = [
    { key: 'open', label: 'Open', node: (r, c) => count(r, c.open, { filter: 'open' }, 'open') },
    { key: 'overdue', label: 'Overdue', node: (r, c) => count(r, c.overdue, { filter: 'overdue' }, 'overdue', true) },
    { key: 'due7', label: 'Due in 7 d', node: (r, c) => count(r, c.due7, { filter: 'due7' }, 'due in 7 days') },
    { key: 'unassigned', label: 'Unassigned', node: (r, c) => count(r, c.unassigned, { filter: 'unassigned' }, 'without an owner') },
    {
      key: 'exposure', label: 'Exposure', node: (r, c) => (r && !r.param
        ? <span className="tabular-nums">{c.exposure ? fmtInrShort(c.exposure) : '—'}</span>
        : <AmountLink amount={c.exposure} to={to(r, { filter: 'exposure' })} label={`${name(r)}, exposure on ${c.exposureCount} notices`} onMuted={!r} />),
    },
    {
      key: 'oldest', label: 'Oldest open', node: (r, c) => {
        const age = ageDays(c.oldestOpen, today);
        if (age === null) return <span className={r ? 'text-muted-foreground' : 'text-foreground/70'}>—</span>;
        if (r && !r.param) return <span className="tabular-nums">{age} d</span>;
        return (
          <Link to={to(r, { filter: 'open', sort: 'issued', dir: 'asc' })} className="rounded tabular-nums text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="sr-only">{name(r)}, oldest open notice, issued {fmtDate(c.oldestOpen)}: </span>{age} d
          </Link>
        );
      },
    },
    { key: 'replied', label: 'Replied', node: (r, c) => count(r, c.replied, { filter: 'replied' }, 'reply logged') },
    { key: 'closed', label: 'Closed', node: (r, c) => count(r, c.closed, { filter: 'closed' }, 'closed') },
    { key: 'total', label: 'Total', node: (r, c) => count(r, c.total, { filter: 'all' }, 'all notices') },
  ];
  const firstHead = tab === 'stage' ? 'Stage' : tab === 'fy' ? 'Financial year' : 'Category';
  // Refund and DRC-03 cases are notices here; their applications and payments are counted under the table.
  const CASES: Record<string, string> = { Refunds: 'portal cases', 'Voluntary Payment': 'DRC-03 cases' };
  const label = (r: SummaryRow) => (tab === 'stage' ? <StageBadge stage={r.key} /> : (
    <span className="font-medium">{r.label}{tab === 'category' && CASES[r.key] && <span className="ml-1 text-xs font-normal text-muted-foreground">· {CASES[r.key]}</span>}</span>
  ));
  const untracked = showUntracked ? WATCHED.filter((w) => !rows.some((r) => r.key === w)) : [];
  const unselectable = rows.some((r) => !r.param);

  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No notices match these filters.</p>;
  }

  return (
    <>
      {/* Phones: one card per row. */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.key} className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{label(r)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">Total {cells[cells.length - 1].node(r, r.counts)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
              {cells.slice(0, -1).map((c) => (
                <div key={c.key} className="min-w-0">
                  <dt className="truncate text-muted-foreground">{c.label}</dt>
                  <dd className="font-medium">{c.node(r, r.counts)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        <li className="rounded-lg border bg-muted p-3">
          <div className="text-sm font-semibold">Total</div>
          <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
            {cells.map((c) => (
              <div key={c.key} className="min-w-0">
                <dt className="truncate text-foreground/70">{c.label}</dt>
                <dd className="font-semibold">{c.node(null, total)}</dd>
              </div>
            ))}
          </dl>
        </li>
      </ul>

      <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
        <table className={WS_TABLE}>
          <thead>
            <tr>
              <SortHead label={firstHead} k="name" sort={sort} dir={dir} onSort={onSort} />
              {cells.map((c) => <SortHead key={c.key} label={c.label} k={c.key} sort={sort} dir={dir} onSort={onSort} right />)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={WS_TR}>
                <th scope="row" className={cn(WS_TD, 'text-left font-normal')}>{label(r)}</th>
                {cells.map((c) => <td key={c.key} className={WS_TD_NUM}>{c.node(r, r.counts)}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={WS_TR_TOTAL}>
              <th scope="row" className={cn(WS_TD, 'text-left')}>Total</th>
              {cells.map((c) => <td key={c.key} className={WS_TD_NUM}>{c.node(null, total)}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>

      {untracked.length > 0 && (
        <p className="text-xs text-muted-foreground">No notices yet in: {untracked.join(' · ')}.</p>
      )}
      {unselectable && (
        <p className="text-xs text-muted-foreground">
          Notices without a financial year can't be opened as one list; the Total row includes them.
        </p>
      )}
    </>
  );
};
