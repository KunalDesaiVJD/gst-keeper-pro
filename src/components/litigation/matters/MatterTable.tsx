// The matters list (audit U-80-1, U-80-2, U-80-5, U-80-6): what the matter is,
// whose it is, where it stands, the next clock with its IST days-left chip and
// what is outstanding; sortable heads with aria-sort, the matter number a real
// link, a total row, and cards instead of the table on phones.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, FolderOpen } from 'lucide-react';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { StageBadge } from '@/components/notices/StageBadge';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { fmtInr, fmtInrShort } from '@/lib/noticeFormat';
import { forumLabel, lifecycleLabel, mattersHref, type MatterListRow, type MatterSort } from '@/lib/litigationData';
import { ClockCell } from './ClockCell';
import { cn } from '@/lib/utils';

const SortHead: React.FC<{ label: string; k: MatterSort; sort: MatterSort; dir: 'asc' | 'desc'; onSort: (k: MatterSort) => void; className?: string }> = ({ label, k, sort, dir, onSort, className }) => (
  <th scope="col" className={cn(WS_TH, className)} aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {label}{sort === k && (dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
    </button>
  </th>
);

const Money: React.FC<{ r: MatterListRow }> = ({ r }) => {
  const m = r.money;
  if (!m.recorded) return <span className="text-xs text-muted-foreground">demand not recorded</span>;
  return (
    <span className="block leading-tight">
      <span className={cn('block font-semibold', r.open && m.outstanding > 0 && 'text-foreground')} title={fmtInr(r.open ? m.outstanding : m.demand)}>
        {r.open ? fmtInrShort(m.outstanding) : <span className="font-normal text-muted-foreground">closed</span>}
      </span>
      <span className="block text-[11px] text-muted-foreground">of {fmtInrShort(m.demand)}{m.preDeposit > 0 ? ` · pre-dep. ${fmtInrShort(m.preDeposit)}` : ''}</span>
    </span>
  );
};

export const MatterTable: React.FC<{
  rows: MatterListRow[];
  sort: MatterSort;
  dir: 'asc' | 'desc';
  onSort: (k: MatterSort) => void;
  ownerName: (id: string | null) => string | null;
  showClient: boolean;
  /** The whole filtered set (not just this page) for the total row. */
  total: { count: number; exposure: number };
}> = ({ rows, sort, dir, onSort, ownerName, showClient, total }) => (
  <>
    <ul className="space-y-2 md:hidden" aria-label="Matters">
      {rows.map((r) => (
        <li key={r.id} className={cn('rounded-lg border bg-card p-3', r.next && r.next.days < 0 && 'border-destructive/50')}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link to={`/litigation/${r.id}`} className="block break-words text-sm font-semibold hover:underline">{r.title || lifecycleLabel(r.lifecycle)}</Link>
              <div className="truncate text-xs text-muted-foreground"><span className="whitespace-nowrap font-mono">{r.matter_no}</span>{showClient ? ` · ${r.client_name}` : ''}</div>
            </div>
            <div className="shrink-0 text-right text-sm tabular-nums"><Money r={r} /></div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ClockCell clock={r.next} open={r.open} className="min-w-0 flex-1" />
            <StageBadge stage={r.stage} />
            <OwnerChip name={ownerName(r.owner_user_id)} />
          </div>
        </li>
      ))}
    </ul>

    <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
      <table className={WS_TABLE}>
        <thead>
          <tr>
            <SortHead label="Matter" k="matter" sort={sort} dir={dir} onSort={onSort} />
            {showClient && <SortHead label="Client" k="client" sort={sort} dir={dir} onSort={onSort} />}
            <th scope="col" className={WS_TH}>Type · forum</th>
            <SortHead label="Stage" k="stage" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="Next clock" k="clock" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="Outstanding" k="exposure" sort={sort} dir={dir} onSort={onSort} className="text-right" />
            <SortHead label="Owner" k="owner" sort={sort} dir={dir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cn(WS_TR, r.next && r.next.days < 0 && 'bg-destructive/[0.03]')}>
              <td className={cn(WS_TD, 'min-w-[14rem] max-w-[22rem]')}>
                <Link to={`/litigation/${r.id}`} className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {r.title || lifecycleLabel(r.lifecycle)}
                </Link>
                <div className="text-xs text-muted-foreground">
                  <span className="whitespace-nowrap font-mono">{r.matter_no}</span>
                  {r.notices.length > 0 && ` · ${r.notices.length} notice${r.notices.length === 1 ? '' : 's'}`}
                  {r.priority === 'High' && <span className="font-medium text-destructive-strong"> · High priority</span>}
                </div>
              </td>
              {showClient && (
                <td className={cn(WS_TD, 'max-w-[13rem]')}>
                  <div className="flex items-start gap-1">
                    <Link to={mattersHref({ client: r.client_id, status: 'open' })} className="block min-w-0 truncate font-medium hover:underline" title={`Matters of ${r.client_name}`}>
                      {r.client_name}
                    </Link>
                    <Link to={`/notices-company/${r.client_id}`} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Notices of ${r.client_name}`}>
                      <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{r.client_gstin}</div>
                </td>
              )}
              <td className={cn(WS_TD, 'text-xs')}>
                <div className="font-medium">{lifecycleLabel(r.lifecycle)}</div>
                <div className="text-muted-foreground">{forumLabel(r)}</div>
              </td>
              <td className={cn(WS_TD, 'whitespace-nowrap')}><StageBadge stage={r.stage} /></td>
              <td className={cn(WS_TD, 'min-w-[11rem]')}><ClockCell clock={r.next} open={r.open} /></td>
              <td className={WS_TD_NUM}><Money r={r} /></td>
              <td className={cn(WS_TD, 'whitespace-nowrap')}><OwnerChip name={ownerName(r.owner_user_id)} showName /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={WS_TR_TOTAL}>
            <td className={WS_TD} colSpan={showClient ? 5 : 4}>Outstanding on the {total.count.toLocaleString('en-IN')} open matter{total.count === 1 ? '' : 's'} in this list</td>
            <td className={WS_TD_NUM} title={fmtInr(total.exposure)}>{fmtInrShort(total.exposure)}</td>
            <td className={WS_TD} />
          </tr>
        </tfoot>
      </table>
    </div>
  </>
);

export default MatterTable;
