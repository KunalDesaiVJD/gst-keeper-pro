// The four numbers at the top of the Refunds page (claimed, sanctioned,
// rejected, still open), the same for one client and for all, the refunds
// that need the firm under them, and, for all clients, one line per client
// with the same numbers (the firm's choice of 25 October 2026).
import React, { useMemo } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { InfoTip } from '@/components/notices/ui/Panel';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { dueWords, fmtDate, fmtInr, fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import type { RefundRow } from './ledgerData';
import { daysTo } from './ledgerStatus';
import { MoneyBar } from './RefundBits';
import { fyLabel, placeOf, refundPeriod, sumMoney, typeCode, typeShort } from './refundModel';

const Num: React.FC<{ label: string; value: string; sub: React.ReactNode; tone?: string; info?: string }> = ({ label, value, sub, tone, info }) => (
  <div className="min-w-0 border-b px-4 py-3 sm:border-b-0 sm:border-r last:border-r-0">
    <div className="flex items-center gap-1 text-xs text-muted-foreground">{label}{info && <InfoTip>{info}</InfoTip>}</div>
    <div className={cn('text-2xl font-semibold leading-tight tabular-nums', tone)}>{value}</div>
    <div className="truncate text-xs text-muted-foreground">{sub}</div>
  </div>
);

export const RefundNumbers: React.FC<{ rows: RefundRow[] }> = ({ rows }) => {
  const m = sumMoney(rows);
  const decided = m.sanctioned + m.rejected;
  const open = rows.filter((r) => r.state.open);
  const action = rows.filter((r) => r.state.group === 'action').length;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Num label="Claimed" value={fmtInrShort(m.claimed - m.withdrawn)}
          sub={`${plural(rows.length, 'application')}${m.withdrawn ? ` · ${fmtInrShort(m.withdrawn)} withdrawn left out` : ''}`} />
        <Num label="Sanctioned" value={fmtInrShort(m.sanctioned)} tone="text-success-strong"
          sub={decided ? `${Math.round((m.sanctioned / decided) * 100)}% of what was decided` : 'nothing decided yet'}
          info="From the portal, else read by the AI from the refund's own orders (RFD-04, RFD-06, RFD-05); each refund's page says which order." />
        <Num label="Rejected" value={fmtInrShort(m.rejected)} tone={m.rejected ? 'text-destructive-strong' : undefined}
          sub={decided ? `${Math.round((m.rejected / decided) * 100)}% of what was decided` : '—'}
          info="Read from the orders, never from a notice (a notice only proposes a rejection); else the claim less the sanction." />
        <Num label="Still open" value={fmtInrShort(m.awaiting)} tone={open.length ? 'text-info' : undefined}
          sub={open.length ? `${plural(open.length, 'refund')}${action ? ` · ${action} need${action === 1 ? 's' : ''} action` : ' with the officer'}` : 'none open'} />
      </div>
      <MoneyBar m={m} className="h-1.5 rounded-none" />
    </div>
  );
};

export const NeedsAction: React.FC<{ rows: RefundRow[]; today: string; showClient: boolean; onOpen: (r: RefundRow) => void }> = ({ rows, today, showClient, onOpen }) => {
  const list = rows.filter((r) => r.state.group === 'action').sort((a, b) => (a.state.due ?? '9999').localeCompare(b.state.due ?? '9999'));
  if (!list.length) return null;
  return (
    <section className="rounded-lg border border-destructive/50 bg-destructive/[0.04] px-3 py-2" aria-label="Refunds that need action">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-destructive-strong">
        <AlertTriangle className="h-4 w-4" aria-hidden /> Needs action · {list.length}
      </h2>
      <ul className="mt-1 divide-y divide-destructive/15">
        {list.map((r) => {
          const d = daysTo(r.state.due, today);
          const p = placeOf(r);
          return (
            <li key={r.key}>
              <button type="button" onClick={() => onOpen(r)} className="flex w-full items-center gap-3 py-1.5 text-left hover:bg-destructive/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.state.next}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {showClient ? `${r.fact.client_name} · ` : ''}{typeShort(typeCode(r))}{p ? ` · ${fyLabel(p.fy)} Q${p.q}` : ''}{refundPeriod(r) ? ` (${refundPeriod(r)})` : ''} · {r.claimed ? fmtInrShort(r.claimed) : '—'}
                  </span>
                </span>
                <span className={cn('shrink-0 text-right text-xs tabular-nums', d !== null && d < 0 ? 'font-semibold text-destructive-strong' : 'text-muted-foreground')}>
                  {r.state.due ? <>by {fmtDate(r.state.due)}<br />{dueWords(d).replace('due ', '')}</> : 'no date'}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

/** All clients: one line per client with the same four numbers; a line opens that client's grid. */
export const RefundClients: React.FC<{ rows: RefundRow[]; onClient: (id: string) => void }> = ({ rows, onClient }) => {
  const clients = useMemo(() => {
    const by = new Map<string, RefundRow[]>();
    rows.forEach((r) => { if (r.fact.client_id) by.set(r.fact.client_id, [...(by.get(r.fact.client_id) ?? []), r]); });
    return [...by.entries()].map(([id, list]) => {
      const latest = list.map((r) => placeOf(r)).filter((p): p is NonNullable<typeof p> => !!p && !p.byFiling)
        .sort((a, b) => b.fy * 4 + b.q - (a.fy * 4 + a.q))[0];
      return { id, name: list[0].fact.client_name ?? 'Client', gstin: list[0].fact.client_gstin, list, m: sumMoney(list),
        action: list.filter((r) => r.state.group === 'action').length, open: list.filter((r) => r.state.open).length, latest };
    }).sort((a, b) => b.action - a.action || b.open - a.open || b.m.claimed - a.m.claimed);
  }, [rows]);
  return (
    <div className={WS_TABLE_WRAP}>
      <table className={cn(WS_TABLE, 'min-w-[52rem]')}>
        <thead>
          <tr>
            <th scope="col" className={WS_TH}>Client</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Refunds</th>
            <th scope="col" className={WS_TH}>Open</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Claimed</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Sanctioned</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Rejected</th>
            <th scope="col" className={cn(WS_TH, 'w-40')}>Outcome</th>
            <th scope="col" className={WS_TH}>Latest quarter claimed</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} tabIndex={0} onClick={() => onClient(c.id)} onKeyDown={(e) => { if (e.key === 'Enter') onClient(c.id); }}
              className={cn(WS_TR, 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring')}>
              <td className={cn(WS_TD, 'max-w-[16rem]')}>
                <div className="truncate font-medium">{c.name}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{c.gstin}</div>
              </td>
              <td className={WS_TD_NUM}>{c.list.length}</td>
              <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>
                {c.action ? <span className="font-semibold text-destructive-strong">{c.action} need{c.action === 1 ? 's' : ''} action</span> : null}
                {c.action && c.open - c.action ? ' · ' : ''}
                {c.open - c.action ? <span className="text-info">{c.open - c.action} with officer</span> : null}
                {!c.open && <span className="text-muted-foreground">—</span>}
              </td>
              <td className={WS_TD_NUM}>{fmtInr(c.m.claimed - c.m.withdrawn)}</td>
              <td className={cn(WS_TD_NUM, 'text-success-strong')}>{c.m.sanctioned ? fmtInr(c.m.sanctioned) : '—'}</td>
              <td className={cn(WS_TD_NUM, 'text-destructive-strong')}>{c.m.rejected ? fmtInr(c.m.rejected) : '—'}</td>
              <td className={WS_TD}><MoneyBar m={c.m} /></td>
              <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{c.latest ? `${fyLabel(c.latest.fy)} Q${c.latest.q}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

