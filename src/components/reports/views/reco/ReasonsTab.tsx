// The filtered documents by status and reason (the report's "Summary by
// reason"): how many, the value and tax on each side, the difference and what
// to do. Clicking a line narrows every tab to that reason and opens its
// documents.
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { byReason } from '@/lib/itcReco/viewModel';
import type { RecoViewData, RecoViewRow } from '@/lib/itcReco/viewTypes';
import { DiffText, EmptyLine, StatusBadge } from './shared';
import { T, fmtAmt, fmtCount } from './format';

export const ReasonsTab: React.FC<{
  data: RecoViewData;
  rows: RecoViewRow[];
  selected: string[];
  onPick: (key: string) => void;
}> = ({ data, rows, selected, onPick }) => {
  const L = data.left.label;
  const R = data.right.label;
  const lines = useMemo(() => byReason(rows), [rows]);
  const total = useMemo(() => lines.reduce((t, l) => ({
    count: t.count + l.count, leftTaxable: t.leftTaxable + l.leftTaxable, rightTaxable: t.rightTaxable + l.rightTaxable,
    leftTax: t.leftTax + l.leftTax, rightTax: t.rightTax + l.rightTax, diff: t.diff + (l.status === 'not_compared' ? 0 : l.diff),
  }), { count: 0, leftTaxable: 0, rightTaxable: 0, leftTax: 0, rightTax: 0, diff: 0 }), [lines]);
  if (!lines.length) return <EmptyLine>No reason: no documents are shown.</EmptyLine>;
  const heads = ['Status', 'Reason', 'Docs', `${L} taxable`, `${R} taxable`, `${L} tax`, `${R} tax`, 'Difference', 'What to do'];
  const numeric = (i: number) => i >= 2 && i <= 7;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Click a line to see only its documents. Difference is {R} minus {L}; documents not compared have none.</p>
      <div className={T.wrap}>
        <table className={T.table} aria-label="By reason">
          <thead>
            <tr>{heads.map((h, i) => <th key={h} scope="col" className={cn(T.th, numeric(i) && 'text-right')}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const key = `${l.status}|${l.reason}`;
              const picked = selected.includes(key);
              return (
                <tr
                  key={key}
                  tabIndex={0}
                  onClick={() => onPick(key)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onPick(key); } }}
                  title="Show only these documents"
                  className={cn('cursor-pointer align-top hover:bg-primary/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary', picked && 'bg-primary/[0.07]')}
                >
                  <td className={T.td}><StatusBadge status={l.status} label={l.statusLabel} /></td>
                  <td className={cn(T.td, 'min-w-[220px] max-w-[360px] font-medium')}>{l.reasonLabel}</td>
                  <td className={cn(T.num, 'font-semibold')}>{fmtCount(l.count)}</td>
                  <td className={T.num}>{fmtAmt(l.leftTaxable)}</td>
                  <td className={T.num}>{fmtAmt(l.rightTaxable)}</td>
                  <td className={T.num}>{fmtAmt(l.leftTax)}</td>
                  <td className={T.num}>{fmtAmt(l.rightTax)}</td>
                  <td className={T.num}>{l.status === 'not_compared' ? '' : <DiffText v={l.diff} tolerance={data.tolerance} />}</td>
                  <td className={cn(T.td, 'min-w-[260px] max-w-[420px] text-[12px] leading-snug text-foreground/85')}>{l.action}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className={cn(T.total, 'border-r px-2 py-1.5')}>TOTAL</td>
              <td className={cn(T.total, 'border-r px-2 py-1.5 text-right tabular-nums')}>{fmtCount(total.count)}</td>
              {[total.leftTaxable, total.rightTaxable, total.leftTax, total.rightTax].map((v, i) => (
                <td key={i} className={cn(T.total, 'border-r px-2 py-1.5 text-right tabular-nums')}>{fmtAmt(v)}</td>
              ))}
              <td className={cn(T.total, 'border-r px-2 py-1.5 text-right')}><DiffText v={Math.round(total.diff * 100) / 100} tolerance={data.tolerance} /></td>
              <td className={cn(T.total, 'border-r')} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
