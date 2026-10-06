// The demand by head and component (per-notice spec "demand by head (tax /
// interest / penalty x IGST / CGST / SGST / Cess)"; audit R-08): one row per
// head, the parts any head carries, and totals.
import React from 'react';
import type { Json } from '@/integrations/supabase/types';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { demandPartsShown, demandRows, PART_LABEL } from '@/lib/noticeReading';
import { fmtInr } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const cell = (v: number) => (v ? fmtInr(v) : <span className="text-foreground/70">—</span>);

export const DemandTable: React.FC<{ demand: Json | null | undefined; caption: string; className?: string }> = ({ demand, caption, className }) => {
  const rows = demandRows(demand);
  if (!rows.length) return null;
  const parts = demandPartsShown(rows);
  const sum = (p: (typeof parts)[number]) => rows.reduce((s, r) => s + r.parts[p], 0);
  const grand = rows.reduce((s, r) => s + r.total, 0);
  return (
    <div className={cn(WS_TABLE_WRAP, className)} tabIndex={0} role="region" aria-label={caption}>
      <table className={WS_TABLE}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={WS_TH}>Head</th>
            {parts.map((p) => <th key={p} scope="col" className={cn(WS_TH, 'text-right')}>{PART_LABEL[p]}</th>)}
            <th scope="col" className={cn(WS_TH, 'text-right')}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.head} className={WS_TR}>
              <th scope="row" className={cn(WS_TD, 'whitespace-nowrap text-left font-medium')}>{r.label}</th>
              {parts.map((p) => <td key={p} className={WS_TD_NUM}>{cell(r.parts[p])}</td>)}
              <td className={cn(WS_TD_NUM, 'font-semibold')}>{fmtInr(r.total)}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className={WS_TR_TOTAL}>
              <th scope="row" className={cn(WS_TD, 'text-left')}>Total</th>
              {parts.map((p) => <td key={p} className={WS_TD_NUM}>{cell(sum(p))}</td>)}
              <td className={WS_TD_NUM}>{fmtInr(grand)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};

export default DemandTable;
