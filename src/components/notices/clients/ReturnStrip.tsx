// Returns filed, as a folded 12-month strip (audit U-56-4): each month's GSTR-1
// and GSTR-3B filing date in the house format and how late it was against the
// client's due day (Filing Status's own rule: 11th / 20th of the next month
// unless set in Edit Client), since late filing is what GSTR-3A and late-fee
// notices are about. Dates come from the portal (gst_filed_returns).
import React from 'react';
import { dueDayForReturn, computeDueDate } from '@/utils/interestLateFee';
import { daysBetween } from '@/lib/noticeFacts';
import { fmtDate, fmtFy } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import type { ClientExtras, FiledReturn } from './profileData';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

interface Cell { kind: 'GSTR-1' | 'GSTR-3B'; filed: string | null; late: number | null; due: string }

function cellFor(period: string, kind: Cell['kind'], filed: string | null, extras: ClientExtras | null): Cell {
  const due = isoOf(computeDueDate(period, dueDayForReturn(kind, extras?.target_date_group1 ?? null, extras?.target_date_group2 ?? null)));
  return { kind, filed, due, late: filed ? Math.max(0, daysBetween(due, filed.slice(0, 10))) : null };
}

export const ReturnStrip: React.FC<{ filings: FiledReturn[] | null; extras: ClientExtras | null; today: string }> = ({ filings, extras, today }) => {
  if (filings === null || filings.length === 0) {
    return (
      <p className="rounded-lg border bg-card px-4 py-2.5 text-xs text-muted-foreground">
        Returns filed: {filings === null ? 'the portal filing dates are not available here.' : 'no filing date captured from the portal yet for this client.'}
      </p>
    );
  }
  // The 12 periods before this month (returns are filed the month after).
  const [ty, tm] = today.split('-').map(Number);
  const periods = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(ty, tm - 2 - i, 1));
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  });
  const byKey = new Map(filings.map((f) => [`${f.return_type}:${f.period_month}`, f.filed_date]));
  const rows = periods.map((p) => ({
    period: p,
    cells: [cellFor(p, 'GSTR-1', byKey.get(`GSTR1:${p}`) ?? null, extras), cellFor(p, 'GSTR-3B', byKey.get(`GSTR3B:${p}`) ?? null, extras)],
  }));
  const late = rows.flatMap((r) => r.cells).filter((c) => (c.late ?? 0) > 0).length;
  const missing = rows.flatMap((r) => r.cells).filter((c) => !c.filed && c.due < today).length;
  const fyOf = (p: string) => { const [m, y] = p.split('/').map(Number); return fmtFy(m >= 4 ? `${y}-${y + 1}` : `${y - 1}-${y}`); };

  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Returns filed <span className="font-normal text-muted-foreground">· last 12 months · {late ? `${late} filed late` : 'none filed late'}{missing ? ` · ${missing} not on record` : ''}</span>
      </summary>
      <div className="space-y-2 border-t px-4 py-3">
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {rows.map((r) => {
            const [m, y] = r.period.split('/').map(Number);
            return (
              <li key={r.period} className="rounded-md border p-1.5 text-xs">
                <div className="font-semibold">{MONTHS[m - 1]} {y} <span className="font-normal text-muted-foreground">· FY {fyOf(r.period)}</span></div>
                {r.cells.map((c) => (
                  <div key={c.kind} className={cn('leading-snug', (c.late ?? 0) > 0 && 'text-destructive-strong', !c.filed && 'text-muted-foreground')}>
                    {c.kind} {c.filed ? `${fmtDate(c.filed.slice(0, 10))}${c.late ? ` · ${c.late} d late` : ' · on time'}` : c.due < today ? 'not on record' : `due ${fmtDate(c.due)}`}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-muted-foreground">Late is counted from the client's due day (GSTR-1 on the 11th, GSTR-3B on the 20th unless set in Edit Client). Quarterly filers file once a quarter, so a month without a return is not by itself late.</p>
      </div>
    </details>
  );
};

export default ReturnStrip;
