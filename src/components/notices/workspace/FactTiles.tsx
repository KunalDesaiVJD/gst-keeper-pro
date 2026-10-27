import React from 'react';
import type { Workspace } from '@/lib/noticeWorkspace';
import { fmtInr, plural } from '@/lib/noticeFormat';
import { demandSummary } from '@/lib/noticeReading';
import { cn } from '@/lib/utils';

/**
 * The four figures of a notice (target-notice.png): what it demands, how much
 * of that the firm's own data explains, what is genuinely payable, and how many
 * of the client's documents are in. The demand's split by head shows under
 * the amount when a reader (or staff) recorded it. In the page's side rail
 * (27 October 2026) the four are one card of rows, each hint in full rather
 * than cut to a line.
 */
export const FactTiles: React.FC<{ ws: Workspace; onAskClient?: () => void; /** Two columns, for a page's side rail. */ rail?: boolean }> = ({ ws, onAskClient, rail }) => {
  const demand = Number(ws.notice.amount_of_demand ?? 0);
  const issuesAmount = ws.issues.reduce((s, i) => s + Number(i.amount || 0), 0);
  const amount = demand || issuesAmount;
  const explained = ws.issues.reduce((s, i) => s + Number(i.explained_amount || 0), 0);
  const toPay = ws.issues.filter((i) => i.status === 'pay').reduce((s, i) => s + Number(i.amount || 0) - Number(i.explained_amount || 0), 0);
  const paid = ws.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const asked = ws.requests.filter((r) => r.status !== 'waived');
  const received = asked.filter((r) => r.status === 'received').length;
  const pending = ws.requests.filter((r) => r.status === 'requested');
  const pct = amount ? Math.round((100 * explained) / amount) : 0;
  const byHead = demandSummary(ws.notice.demand);

  const Tile: React.FC<{ label: string; value: React.ReactNode; hint: React.ReactNode; accent: string }> = ({ label, value, hint, accent }) => (
    <div className={cn('min-w-0 border-l-4 px-3 py-2', rail ? 'py-2.5' : 'rounded-lg border bg-card', accent)}>
      <div className={cn('font-medium text-muted-foreground', rail ? 'text-[13px]' : 'text-xs')}>{label}</div>
      <div className={cn('font-semibold leading-tight tabular-nums', rail ? 'text-lg' : 'text-xl')}>{value}</div>
      <div className={cn('text-xs text-muted-foreground', !rail && 'truncate')} title={typeof hint === 'string' ? hint : undefined}>{hint}</div>
    </div>
  );

  return (
    <div className={cn(rail ? 'divide-y overflow-hidden rounded-lg border bg-card' : 'grid grid-cols-2 gap-2 lg:grid-cols-4')}>
      <Tile label="Amount in notice" accent="border-l-destructive"
        value={amount ? fmtInr(amount) : '—'}
        hint={byHead || (demand ? (ws.issues.length ? `${plural(ws.issues.length, 'issue')} · ${fmtInr(issuesAmount)} listed` : 'demand as recorded') : ws.issues.length ? 'total of the issues listed' : 'no demand recorded')} />
      <Tile label="Explained by your own data" accent="border-l-success"
        value={amount ? <>{fmtInr(explained)} <span className="text-xs font-medium text-muted-foreground">· {pct}%</span></> : '—'}
        hint={ws.issues.length ? `${ws.issues.filter((i) => i.status === 'explained').length} of ${ws.issues.length} issues explained` : 'add the issues to work it out'} />
      <Tile label="Genuine short-payment" accent="border-l-warning"
        value={toPay ? fmtInr(toPay) : '—'}
        hint={paid ? `${fmtInr(paid)} paid against this notice` : toPay ? 'not paid yet — link the DRC-03 on Payments' : 'nothing marked to pay'} />
      <button type="button" onClick={pending.length || !onAskClient ? undefined : onAskClient}
        className={cn('w-full border-l-4 border-l-info px-3 py-2 text-left', rail ? 'py-2.5' : 'rounded-lg border bg-card', !pending.length && onAskClient && 'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
        disabled={!!pending.length || !onAskClient}>
        <div className={cn('font-medium text-muted-foreground', rail ? 'text-[13px]' : 'text-xs')}>Client documents</div>
        <div className={cn('font-semibold leading-tight tabular-nums', rail ? 'text-lg' : 'text-xl')}>{asked.length ? `${received} of ${asked.length} in` : '—'}</div>
        <div className={cn('text-xs text-muted-foreground', !rail && 'truncate')}>
          {pending.length ? `${pending[0].item}${pending.length > 1 ? ` +${pending.length - 1} more` : ''} pending` : asked.length ? 'all in' : onAskClient ? 'none asked — ask the client' : 'none asked'}
        </div>
      </button>
    </div>
  );
};

export default FactTiles;
