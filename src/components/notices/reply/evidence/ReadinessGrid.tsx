// What a working needs from the portal and what is in (audit R-10): month ×
// return (ready / not fetched / not filed / pull failed / not due), and the
// statements fetched once a year. Months outside the notice are the rest of
// its financial year, used to find timing differences.
import React from 'react';
import { AlertTriangle, Check, CircleDashed, Clock, X } from 'lucide-react';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH } from '@/components/workspace/theme';
import type { Readiness, ReadyState } from '@/lib/reply';
import { periodLabel } from '@/lib/reply';
import { fmtDateTime } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { READY_LOOK } from './look';

const ICON: Record<ReadyState, React.ReactNode> = {
  ready: <Check className="h-3.5 w-3.5" aria-hidden />,
  not_fetched: <CircleDashed className="h-3.5 w-3.5" aria-hidden />,
  not_filed: <X className="h-3.5 w-3.5" aria-hidden />,
  failed: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
  not_due: <Clock className="h-3.5 w-3.5" aria-hidden />,
};

const short = (p: string) => `${periodLabel(p).slice(0, 3)} ${p.slice(5)}`;

export const ReadinessGrid: React.FC<{ readiness: Readiness }> = ({ readiness }) => {
  const monthly = readiness.sources.filter((s) => s.scope === 'month' && s.cells.length);
  const yearly = readiness.sources.filter((s) => s.scope === 'fy' && s.cells.length);
  const months = [...new Set(monthly.flatMap((s) => s.cells.map((c) => c.period)))]
    .sort((a, b) => Number(a.slice(3)) * 12 + Number(a.slice(0, 2)) - (Number(b.slice(3)) * 12 + Number(b.slice(0, 2))));
  const context = new Set(monthly.flatMap((s) => s.cells.filter((c) => c.context).map((c) => c.period)));
  if (!monthly.length && !yearly.length) return <p className="text-xs text-muted-foreground">This working reads no portal returns.</p>;
  return (
    <div className="space-y-2">
      {monthly.length > 0 && (
        <div className={WS_TABLE_WRAP} tabIndex={0} role="region" aria-label="Data from the portal, month by month">
          <table className={WS_TABLE}>
            <thead>
              <tr>
                <th scope="col" className={WS_TH}>Return</th>
                {months.map((p) => (
                  <th key={p} scope="col" className={cn(WS_TH, 'px-1.5 text-center text-xs', context.has(p) && 'font-normal')}>
                    {short(p)}{context.has(p) && <span className="sr-only"> (outside the notice, same financial year)</span>}
                    {context.has(p) && <span aria-hidden> *</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthly.map((s) => {
                const byP = new Map(s.cells.map((c) => [c.period, c]));
                return (
                  <tr key={s.key}>
                    <th scope="row" className={cn(WS_TD, 'whitespace-nowrap text-left text-xs font-medium')}>{s.label}</th>
                    {months.map((p) => {
                      const c = byP.get(p);
                      if (!c) return <td key={p} className={cn(WS_TD, 'text-center text-xs text-muted-foreground')}><span aria-hidden>·</span><span className="sr-only">not needed</span></td>;
                      const look = READY_LOOK[c.state];
                      const title = [look.label, c.status, c.pulled_at ? `pulled ${fmtDateTime(c.pulled_at)}` : null, c.arn ? `ARN ${c.arn}` : null].filter(Boolean).join(' · ');
                      return (
                        <td key={p} className={cn(WS_TD, 'px-1 text-center')} title={title}>
                          <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded border', look.cls)}>{ICON[c.state]}<span className="sr-only">{look.label}</span></span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {yearly.map((s) => (
        <p key={s.key} className="text-xs">
          <span className="font-medium">{s.label}:</span>{' '}
          {s.cells.map((c) => `FY ending ${periodLabel(c.period)} — ${READY_LOOK[c.state].label.toLowerCase()}${c.pulled_at ? ` (pulled ${fmtDateTime(c.pulled_at)})` : ''}`).join('; ')}
        </p>
      ))}
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {(Object.keys(READY_LOOK) as ReadyState[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1"><span className={cn('inline-flex h-4 w-4 items-center justify-center rounded border', READY_LOOK[k].cls)}>{ICON[k]}</span>{READY_LOOK[k].label}</span>
        ))}
        {context.size > 0 && <span>* outside the notice: the rest of its financial year, for timing</span>}
      </p>
    </div>
  );
};

export default ReadinessGrid;
