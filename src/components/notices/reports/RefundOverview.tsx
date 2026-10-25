// The Refunds page's bird's-eye view (the firm's request of 25 October 2026):
// where the money claimed stands (sanctioned, rejected, awaiting a decision)
// in one bar, what needs the firm next in date order, and each type of refund
// with its claims and outcome. Every line opens the refund or the list it
// counts; the status tiles above stay the page's filters.
import React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { Panel, PanelRow, Stat } from '@/components/notices/ui/Panel';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { dueWords, fmtDate, fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import type { RefundRow } from './ledgerData';
import { daysTo } from './ledgerStatus';
import { MoneyBar, MoneyLegend } from './RefundBits';
import { moneyOf, addMoney, NO_MONEY, sumMoney, typeCode, typeLong, typeShort, type Money } from './refundModel';

export const RefundOverview: React.FC<{
  rows: RefundRow[];
  today: string;
  showClient: boolean;
  type: string;
  onType: (code: string | undefined) => void;
  onOpen: (r: RefundRow) => void;
  onShowAction: () => void;
}> = ({ rows, today, showClient, type, onType, onOpen, onShowAction }) => {
  const m = sumMoney(rows);
  const decided = m.sanctioned + m.rejected;
  const rate = decided > 0 ? Math.round((m.sanctioned / decided) * 100) : null;
  const action = rows.filter((r) => r.state.group === 'action')
    .sort((a, b) => (a.state.due ?? '9999').localeCompare(b.state.due ?? '9999'));
  const waiting = rows.filter((r) => r.state.group === 'process' && r.state.due)
    .sort((a, b) => (a.state.due as string).localeCompare(b.state.due as string));
  const attention = [...action, ...waiting].slice(0, 6);

  const byType = new Map<string, { n: number; open: number; money: Money }>();
  rows.forEach((r) => {
    const k = typeCode(r);
    const t = byType.get(k) ?? { n: 0, open: 0, money: NO_MONEY };
    byType.set(k, { n: t.n + 1, open: t.open + (r.state.open ? 1 : 0), money: addMoney(t.money, moneyOf(r)) });
  });
  const types = [...byType.entries()].sort((a, b) => b[1].money.claimed - a[1].money.claimed);

  return (
    <div className="space-y-3">
      <Panel title="Where the money stands"
        info="Claimed is what the applications ask for. Sanctioned and rejected come from the portal, else from what the AI read in the refund's own orders (RFD-04, RFD-06, RFD-05); a notice's proposed rejection is never counted. Awaiting a decision is the claim of open refunds with no order yet.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <Stat label="Claimed" value={fmtInrShort(m.claimed)} sub={plural(rows.length, 'application')} />
          <Stat label="Sanctioned" value={fmtInrShort(m.sanctioned)} tone="good" sub={rate !== null ? `${rate}% of what was decided` : 'nothing decided yet'} />
          <Stat label="Rejected" value={fmtInrShort(m.rejected)} tone={m.rejected > 0 ? 'bad' : undefined} sub={decided ? `${100 - (rate ?? 0)}% of what was decided` : undefined} />
          <Stat label="Awaiting a decision" value={fmtInrShort(m.awaiting)} sub={plural(rows.filter((r) => r.state.open).length, 'open refund')} />
          <Stat label="Withdrawn" value={fmtInrShort(m.withdrawn)} className="hidden lg:block" />
        </div>
        <MoneyBar m={m} className="mt-3 h-3" />
        <div className="mt-2"><MoneyLegend m={m} /></div>
      </Panel>

      <PanelRow>
        <Panel title={<>Needs attention{action.length > 0 && <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground">{action.length}</span>}</>}
          info="Refunds that need the firm (a reply, a fresh application, an appeal decision) first, by date; then refunds with the officer whose date is nearest."
          actions={action.length > 6 ? <button type="button" onClick={onShowAction} className="text-xs text-primary hover:underline">All {action.length}</button> : undefined}>
          {attention.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nothing waiting on the firm or due soon.</p>
          ) : (
            <ul className="divide-y">
              {attention.map((r) => {
                const d = daysTo(r.state.due, today);
                const isAction = r.state.group === 'action';
                return (
                  <li key={r.key}>
                    <button type="button" onClick={() => onOpen(r)}
                      className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {isAction ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden /> : <span className="ml-1 mr-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-sm font-medium', isAction && 'text-destructive-strong')}>{r.state.next ?? r.state.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {showClient && r.fact.client_name ? `${r.fact.client_name} · ` : ''}<span className="font-mono">{r.fact.arn ?? 'ARN not captured'}</span> · {typeShort(typeCode(r))}
                          {r.claimed ? ` · ${fmtInrShort(r.claimed)}` : ''}
                        </span>
                      </span>
                      <span className={cn('shrink-0 text-right text-[11px] tabular-nums', d !== null && d < 0 ? 'font-semibold text-destructive-strong' : 'text-muted-foreground')}>
                        {r.state.due ? <>{fmtDate(r.state.due)}<br />{dueWords(d).replace('due ', '')}</> : 'no date'}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="By type of refund" info="Each type with its claims and outcome. Click a type to list only those refunds; click it again to list every type.">
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={WS_TH}>Type</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Refunds</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Claimed</th>
                  <th scope="col" className={cn(WS_TH, 'w-32')}>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {types.map(([code, t]) => (
                  <tr key={code || 'none'} className={cn(WS_TR, 'cursor-pointer', type === code && 'bg-primary/5')} onClick={() => onType(type === code ? undefined : code)}>
                    <td className={WS_TD}>
                      <button type="button" className="text-left text-sm font-medium hover:underline" title={typeLong(code)} aria-pressed={type === code}
                        onClick={(e) => { e.stopPropagation(); onType(type === code ? undefined : code); }}>
                        {typeShort(code)}
                      </button>
                      {code && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{code}</span>}
                    </td>
                    <td className={WS_TD_NUM}>{t.n}{t.open ? <span className="text-[11px] text-muted-foreground"> · {t.open} open</span> : null}</td>
                    <td className={WS_TD_NUM}>{fmtInrShort(t.money.claimed)}</td>
                    <td className={WS_TD}>
                      <MoneyBar m={t.money} />
                      <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {t.money.sanctioned ? `${fmtInrShort(t.money.sanctioned)} sanctioned` : 'no sanction read'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </PanelRow>
    </div>
  );
};

export default RefundOverview;
