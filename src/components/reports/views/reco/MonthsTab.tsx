// The filtered documents month by month (shown only when several months are
// reconciled together): counts by status, the tax on each side with a small
// bar of one against the other, and as of when each month's statements were
// pulled. A month that could not be built is listed with why. Clicking a month
// narrows every tab to it and opens its documents.
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { dayLabel, monthLabel } from '@/lib/itcReco/dates';
import { byPeriod } from '@/lib/itcReco/viewModel';
import type { RecoViewData, RecoViewRow } from '@/lib/itcReco/viewTypes';
import { CountCell, DiffText } from './shared';
import { T, fmtAmt, fmtCount } from './format';

export const MonthsTab: React.FC<{
  data: RecoViewData;
  rows: RecoViewRow[];
  selected: string[];
  onPick: (period: string) => void;
}> = ({ data, rows, selected, onPick }) => {
  const L = data.left.label;
  const R = data.right.label;
  const lines = useMemo(() => byPeriod(rows, data.periods), [rows, data.periods]);
  const stmt = useMemo(() => new Map(data.statements.map((s) => [s.period, s])), [data.statements]);
  const scale = useMemo(() => Math.max(1, ...lines.flatMap((l) => [Math.abs(l.leftTax), Math.abs(l.rightTax)])), [lines]);
  const total = useMemo(() => lines.reduce((t, l) => ({
    rows: t.rows + l.rows, leftDocs: t.leftDocs + l.leftDocs, rightDocs: t.rightDocs + l.rightDocs,
    matched: t.matched + l.counts.matched, only_left: t.only_left + l.counts.only_left, only_right: t.only_right + l.counts.only_right,
    differs: t.differs + l.counts.differs + l.counts.itc_differs, not_compared: t.not_compared + l.counts.not_compared,
    leftTax: t.leftTax + l.leftTax, rightTax: t.rightTax + l.rightTax, diff: t.diff + l.diff,
  }), { rows: 0, leftDocs: 0, rightDocs: 0, matched: 0, only_left: 0, only_right: 0, differs: 0, not_compared: 0, leftTax: 0, rightTax: 0, diff: 0 }), [lines]);
  // A month that could not be built sits in its place among the others.
  const ordered = useMemo(() => {
    const idx = (p: string) => { const m = /^(\d{2})\/(\d{4})$/.exec(p); return m ? Number(m[2]) * 12 + Number(m[1]) : 0; };
    return [
      ...lines.map((l) => ({ kind: 'line' as const, period: l.period, l })),
      ...data.failed.map((f) => ({ kind: 'failed' as const, period: f.period, f })),
    ].sort((a, b) => idx(a.period) - idx(b.period));
  }, [lines, data.failed]);
  const heads = ['Month', 'Docs', `In ${L}`, `In ${R}`, 'Matched', `Only ${L}`, `Only ${R}`, 'Differ', 'Not comp.', `${L} tax`, `${R} tax`, 'Difference', `${L} vs ${R} tax`, `${L} pulled`, `${R} generated`];
  const numeric = (h: string) => !/^(Month|.* vs .*|.* pulled|.* generated)$/.test(h);
  const bar = (v: number, cls: string) => <span className={cn('block h-1.5 rounded-sm', cls)} style={{ width: `${Math.max(0, Math.min(100, (Math.abs(v) / scale) * 100))}%` }} />;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Click a month to see only its documents. Each month is as of its own pulls.</p>
      <div className={T.wrap}>
        <table className={T.table} aria-label="By month">
          <thead>
            <tr>{heads.map((h) => <th key={h} scope="col" className={cn(T.th, numeric(h) && 'text-right')}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {ordered.map((item) => {
              if (item.kind === 'failed') {
                const f = item.f;
                return (
                  <tr key={`failed-${f.period}`} className="bg-destructive/[0.04] text-destructive-strong">
                    <td className={cn(T.td, 'whitespace-nowrap font-medium')}>{monthLabel(f.period)}</td>
                    <td colSpan={heads.length - 1} className={T.td}>Not built: {f.reason}</td>
                  </tr>
                );
              }
              const l = item.l;
              const s = stmt.get(l.period);
              const picked = selected.includes(l.period);
              return (
                <tr
                  key={l.period}
                  tabIndex={0}
                  onClick={() => onPick(l.period)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onPick(l.period); } }}
                  title="Show only this month's documents"
                  className={cn('cursor-pointer hover:bg-primary/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary', picked && 'bg-primary/[0.07]', !l.rows && 'text-muted-foreground')}
                >
                  <td className={cn(T.td, 'whitespace-nowrap font-medium')}>{monthLabel(l.period)}</td>
                  <td className={cn(T.num, 'font-medium')}>{fmtCount(l.rows)}</td>
                  <td className={T.num}>{fmtCount(l.leftDocs)}</td>
                  <td className={T.num}>{fmtCount(l.rightDocs)}</td>
                  <CountCell n={l.counts.matched} status="matched" />
                  <CountCell n={l.counts.only_left} status="only_left" />
                  <CountCell n={l.counts.only_right} status="only_right" />
                  <CountCell n={l.counts.differs + l.counts.itc_differs} status="differs" />
                  <CountCell n={l.counts.not_compared} status="not_compared" />
                  <td className={T.num}>{fmtAmt(l.leftTax)}</td>
                  <td className={T.num}>{fmtAmt(l.rightTax)}</td>
                  <td className={T.num}><DiffText v={l.diff} tolerance={data.tolerance} /></td>
                  <td className={cn(T.td, 'w-[140px] min-w-[120px]')} title={`${L} ${fmtAmt(l.leftTax)} · ${R} ${fmtAmt(l.rightTax)}`}>
                    <div className="space-y-0.5 py-0.5" aria-hidden="true">
                      {bar(l.leftTax, 'bg-primary/40')}
                      {bar(l.rightTax, 'bg-primary')}
                    </div>
                  </td>
                  <td className={cn(T.td, 'whitespace-nowrap tabular-nums text-muted-foreground')}>{s ? dayLabel(s.leftPulledAt) : ''}</td>
                  <td className={cn(T.td, 'whitespace-nowrap tabular-nums text-muted-foreground')}>{s ? dayLabel(s.rightGeneratedOn) : ''}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className={cn(T.total, 'border-r px-2 py-1.5')}>TOTAL</td>
              {[total.rows, total.leftDocs, total.rightDocs, total.matched, total.only_left, total.only_right, total.differs, total.not_compared].map((v, i) => (
                <td key={i} className={cn(T.total, 'border-r px-2 py-1.5 text-right tabular-nums')}>{fmtCount(v)}</td>
              ))}
              <td className={cn(T.total, 'border-r px-2 py-1.5 text-right tabular-nums')}>{fmtAmt(total.leftTax)}</td>
              <td className={cn(T.total, 'border-r px-2 py-1.5 text-right tabular-nums')}>{fmtAmt(total.rightTax)}</td>
              <td className={cn(T.total, 'border-r px-2 py-1.5 text-right')}><DiffText v={Math.round(total.diff * 100) / 100} tolerance={data.tolerance} /></td>
              <td colSpan={3} className={cn(T.total, 'border-r px-2 py-1.5 text-[11px] font-normal text-muted-foreground')}>
                <span className="mr-1 inline-block h-1.5 w-3 rounded-sm bg-primary/40 align-middle" /> {L}
                <span className="ml-3 mr-1 inline-block h-1.5 w-3 rounded-sm bg-primary align-middle" /> {R}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
