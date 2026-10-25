// The refund register (the firm's choice of 25 October 2026, option B): a plain
// ledger grouped by financial year, the same columns on every row, a total per
// year. Rows sit in the year and quarter of the period claimed (else, marked,
// of the filing date), latest first; a row opens the refund's own page.
import React, { useMemo } from 'react';
import { GitBranch } from 'lucide-react';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { dueWords, fmtDate, fmtInr } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import type { RefundRow } from './ledgerData';
import { daysTo } from './ledgerStatus';
import { TonePill } from './RefundBits';
import { fyLabel, linkWord, placeOf, refundPeriod, sumMoney, toneOf, typeCode, typeLong, typeShort } from './refundModel';

const money = (v: number | null | undefined, cls?: string) =>
  v ? <span className={cls}>{fmtInr(v)}</span> : <span className="text-muted-foreground">—</span>;

export const RefundRegister: React.FC<{ rows: RefundRow[]; today: string; showClient: boolean; onOpen: (r: RefundRow) => void }> = ({ rows, today, showClient, onOpen }) => {
  const groups = useMemo(() => {
    const by = new Map<number | null, RefundRow[]>();
    rows.forEach((r) => { const p = placeOf(r); const k = p ? p.fy : null; by.set(k, [...(by.get(k) ?? []), r]); });
    const key = (r: RefundRow) => { const p = placeOf(r); return p ? p.q : 0; };
    return [...by.entries()].sort((a, b) => (b[0] ?? -1) - (a[0] ?? -1))
      .map(([fy, list]) => ({
        fy,
        list: list.sort((a, b) => key(b) - key(a) || typeCode(a).localeCompare(typeCode(b))
          || (showClient ? (a.fact.client_name ?? '').localeCompare(b.fact.client_name ?? '') : 0)
          || (b.fact.filed_date ?? '').localeCompare(a.fact.filed_date ?? '')),
      }));
  }, [rows, showClient]);
  const cols = showClient ? 11 : 10;

  return (
    <div className={WS_TABLE_WRAP}>
      <table className={cn(WS_TABLE, 'min-w-[64rem]')}>
        <thead>
          <tr>
            {showClient && <th scope="col" className={WS_TH}>Client</th>}
            <th scope="col" className={WS_TH}>Quarter</th>
            <th scope="col" className={WS_TH}>Type</th>
            <th scope="col" className={WS_TH}>ARN</th>
            <th scope="col" className={WS_TH}>Filed</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Claimed</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Sanctioned</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Rejected</th>
            <th scope="col" className={WS_TH}>Status</th>
            <th scope="col" className={WS_TH}>Next action</th>
            <th scope="col" className={WS_TH}>Linked</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ fy, list }) => {
            const m = sumMoney(list);
            return (
              <React.Fragment key={fy ?? 'none'}>
                <tr><th scope="rowgroup" colSpan={cols} className="border-b bg-primary/[0.07] px-2 py-1.5 text-left text-[13px] font-semibold text-primary">
                  {fy === null ? 'Period and filing date not captured' : fyLabel(fy)}
                  <span className="ml-2 font-normal text-muted-foreground">{list.length} {list.length === 1 ? 'refund' : 'refunds'}</span>
                </th></tr>
                {list.map((r) => {
                  const p = placeOf(r);
                  const tone = toneOf(r);
                  const d = daysTo(r.state.due, today);
                  return (
                    <tr key={r.key} tabIndex={0} onClick={() => onOpen(r)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r); }}
                      aria-label={`Open refund ${r.fact.arn ?? ''}`}
                      className={cn(WS_TR, 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', tone === 'withdrawn' && 'text-muted-foreground')}>
                      {showClient && <td className={cn(WS_TD, 'max-w-[12rem] truncate font-medium')}>{r.fact.client_name}</td>}
                      <td className={cn(WS_TD, 'whitespace-nowrap')}>
                        {p ? <span className="font-medium">Q{p.q}</span> : '—'}
                        <span className="ml-1.5 text-xs text-muted-foreground">{refundPeriod(r) ?? (p?.byFiling ? 'by filing date' : '')}</span>
                      </td>
                      <td className={cn(WS_TD, 'whitespace-nowrap')} title={typeLong(typeCode(r))}>{typeShort(typeCode(r))}</td>
                      <td className={cn(WS_TD, 'whitespace-nowrap font-mono text-xs')}>{r.fact.arn ?? '—'}</td>
                      <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums')}>{fmtDate(r.fact.filed_date)}</td>
                      <td className={WS_TD_NUM}>{money(r.claimed)}</td>
                      <td className={WS_TD_NUM}>{money(r.sanctioned, 'text-success-strong')}</td>
                      <td className={WS_TD_NUM}>{money(r.rejected, 'text-destructive-strong')}</td>
                      <td className={WS_TD}><TonePill tone={tone} /></td>
                      <td className={cn(WS_TD, 'min-w-[13rem] text-xs')}>
                        {r.state.next ? (
                          <span className={cn(tone === 'action' && 'font-medium text-destructive-strong')}>
                            {r.state.next}{r.state.due && <span className={cn('block tabular-nums', d !== null && d < 0 ? 'font-semibold' : 'text-muted-foreground')}>by {fmtDate(r.state.due)} · {dueWords(d).replace('due ', '')}</span>}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>
                        {r.links.length ? r.links.map((l) => (
                          <span key={l.key} className="mr-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]" title={`${linkWord(l.kind, l.dir)} ${l.key}`}>
                            <GitBranch className="h-3 w-3 text-muted-foreground" aria-hidden />{linkWord(l.kind, l.dir)}
                          </span>
                        )) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-muted/60 font-semibold">
                  <td className={cn(WS_TD, 'text-xs')} colSpan={showClient ? 5 : 4}>{fy === null ? 'Total' : `${fyLabel(fy)} total`}{m.withdrawn ? <span className="font-normal text-muted-foreground"> · withdrawn left out</span> : null}</td>
                  <td className={WS_TD_NUM}>{fmtInr(m.claimed - m.withdrawn)}</td>
                  <td className={cn(WS_TD_NUM, 'text-success-strong')}>{fmtInr(m.sanctioned)}</td>
                  <td className={cn(WS_TD_NUM, 'text-destructive-strong')}>{m.rejected ? fmtInr(m.rejected) : '—'}</td>
                  <td className={WS_TD} colSpan={3} />
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default RefundRegister;
