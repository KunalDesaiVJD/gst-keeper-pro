// Small pieces the Litigation MIS tabs share (audit U-100-4, U-101-4, U-102-1,
// U-102-3, U-104-3, U-106-2; cross-cutting ui-c "MIS numbers are dead ends",
// "no table has a total row", mobile): compact rupees with the full figure on
// hover, "—" for an amount nobody typed, bars on semantic tones whose whole row
// opens the list it counts, IST day chips, and bucket tables with a total row
// and a card list on phones.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { fmtDate, fmtInr, fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import type { Bucket, Clock, MisMatter, Money, Tone } from './misData';

const BAR_TONE: Record<Tone, string> = {
  info: 'bg-info',
  warning: 'bg-warning',
  success: 'bg-success',
  destructive: 'bg-destructive',
  secondary: 'bg-muted-foreground/50',
  primary: 'bg-primary',
};

/** "₹2.85 cr" with the full figure on hover; "—" when nothing was typed (U-101-4). */
export const Amount: React.FC<{ value: number; recorded?: boolean; className?: string }> = ({ value, recorded = true, className }) =>
  recorded ? (
    <span className={cn('tabular-nums', className)} title={fmtInr(value)}>{fmtInrShort(value)}</span>
  ) : (
    <span className={cn('text-muted-foreground', className)} title="Not recorded">—<span className="sr-only"> not recorded</span></span>
  );

/** A count that opens its list; a zero stays plain text. */
export const CountLink: React.FC<{ n: number; to: string; noun: string; bad?: boolean; className?: string }> = ({ n, to, noun, bad, className }) =>
  n > 0 ? (
    <Link to={to} className={cn('rounded font-medium tabular-nums text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', bad && 'font-semibold text-destructive-strong', className)}>
      {n.toLocaleString('en-IN')}<span className="sr-only"> {noun}</span>
    </Link>
  ) : (
    <span className={cn('tabular-nums text-muted-foreground', className)}>0<span className="sr-only"> {noun}</span></span>
  );

/** "Today", "Tomorrow", "in 3 d", "2 d late", toned by how close it is (U-106-2: IST calendar days). */
export const DaysChip: React.FC<{ days: number; className?: string }> = ({ days, className }) => {
  const text = days < 0 ? `${-days} d late` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days} d`;
  const variant = days <= 1 ? 'destructive' : days <= 3 ? 'warning' : days <= 7 ? 'info' : null;
  if (!variant) return <span className={cn('whitespace-nowrap text-xs text-muted-foreground', className)}>{text}</span>;
  return <Badge variant={variant} className={cn('whitespace-nowrap text-[11px] font-medium', className)}>{text}</Badge>;
};

export const ClockCell: React.FC<{ clock: Clock | null }> = ({ clock }) =>
  clock ? (
    <span className="block text-xs leading-tight">
      <span className="flex flex-wrap items-center gap-1">
        <span className={cn('font-semibold tabular-nums', clock.days < 0 && 'text-destructive-strong')}>{fmtDate(clock.date)}</span>
        <DaysChip days={clock.days} />
      </span>
      <span className="text-muted-foreground">{clock.label}</span>
    </span>
  ) : <span className="text-xs text-muted-foreground">No clock on record</span>;

/** A matter's outstanding, or its refund at stake for a refund matter; "—" when nothing was typed. */
export const MatterAmount: React.FC<{ m: MisMatter; className?: string }> = ({ m, className }) =>
  m.isRefund && m.refundAtStake > 0 ? (
    <span className={cn('whitespace-nowrap', className)}>
      <Amount value={m.refundAtStake} /> <span className="text-[11px] font-normal text-muted-foreground">refund</span>
    </span>
  ) : <Amount value={m.outstanding} recorded={m.recorded} className={className} />;

type Accent = 'destructive' | 'warning' | 'info' | 'primary' | 'success';
const ACCENT: Record<Accent, string> = {
  destructive: 'border-l-destructive', warning: 'border-l-warning', info: 'border-l-info', primary: 'border-l-primary', success: 'border-l-success',
};

/** A headline figure that opens its list (the command centre's tile, with room for a two-line hint). */
export const MisTile: React.FC<{ to: string; label: string; value: React.ReactNode; hint?: React.ReactNode; accent: Accent; strong?: boolean }> =
  ({ to, label, value, hint, accent, strong }) => (
    <Link to={to}
      className={cn('group block min-w-0 rounded-lg border border-l-4 bg-card px-3 py-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', ACCENT[accent])}>
      <span className="flex items-start justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="min-w-0 break-words">{label}</span>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
      </span>
      <span className={cn('block text-2xl font-semibold leading-tight tabular-nums', strong && 'text-destructive-strong')}>{value}</span>
      {hint && <span className="block break-words text-xs leading-snug text-muted-foreground">{hint}</span>}
    </Link>
  );

export const MatterLink: React.FC<{ m: MisMatter; className?: string }> = ({ m, className }) => (
  <span className={cn('block min-w-0', className)}>
    <Link to={`/litigation/${m.id}`} className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{m.title}</Link>
    <span className="block whitespace-nowrap font-mono text-[11px] text-muted-foreground">{m.matterNo}</span>
  </span>
);

export const EmptyBox: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground', className)}>{children}</div>
);

// ── Bars ────────────────────────────────────────────────────────────────────
export interface BarRow { key: string; label: React.ReactNode; tone: Tone; amount: number; count: number; to: string; barClass?: string }

/** Horizontal bars of an amount, the whole row a link to the list it counts (U-102-1: sized by rupees, not by count). */
export const BarList: React.FC<{ rows: BarRow[]; noun?: string; className?: string }> = ({ rows, noun = 'matters', className }) => {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <ul className={cn('space-y-1', className)}>
      {rows.map((r) => (
        <li key={r.key}>
          <Link to={r.to}
            className="grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)_auto] items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="truncate">{r.label}</span>
            <span className="h-2 rounded-full bg-muted" aria-hidden>
              {r.amount > 0 && <span className={cn('block h-2 rounded-full', r.barClass ?? BAR_TONE[r.tone])} style={{ width: `${Math.max(2, (r.amount / max) * 100)}%` }} />}
            </span>
            <span className="whitespace-nowrap text-right tabular-nums">
              <span className="font-semibold">{fmtInrShort(r.amount)}</span>
              <span className="text-muted-foreground"> · {r.count.toLocaleString('en-IN')}<span className="sr-only"> {noun}</span></span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
};

// ── Bucket table ────────────────────────────────────────────────────────────
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

/** One row per bucket with the money split and a total row; cards on phones. */
export const BucketTable: React.FC<{
  label: string;
  buckets: Bucket[];
  total: Money;
  countHref: (b: Bucket) => string;
  renderLabel?: (b: Bucket) => React.ReactNode;
  caption: string;
}> = ({ label, buckets, total, countHref, renderLabel, caption }) => {
  const showRefund = total.refund > 0;
  return (
    <>
      <ul className="space-y-1.5 md:hidden">
        {buckets.map((b) => (
          <li key={b.key} className="rounded-md border bg-card px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{renderLabel ? renderLabel(b) : b.label}</span>
              <CountLink n={b.rows.length} to={countHref(b)} noun={`matters, ${b.label}`} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
              <span>Outstanding <Amount value={b.money.outstanding} recorded={b.money.recorded > 0} className="font-semibold text-foreground" /></span>
              <span>Demand <Amount value={b.money.demand} recorded={b.money.recorded > 0} /></span>
              {b.money.preDeposit > 0 && <span>Pre-deposit <Amount value={b.money.preDeposit} /></span>}
              {b.money.paid > 0 && <span>Paid <Amount value={b.money.paid} /></span>}
              {b.money.refund > 0 && <span>Refund at stake <Amount value={b.money.refund} /></span>}
            </div>
          </li>
        ))}
        <li className="flex items-center justify-between rounded-md border bg-muted px-3 py-2 text-xs font-semibold">
          <span>Total · {plural(total.matters, 'matter')}</span>
          <Amount value={total.outstanding} />
        </li>
      </ul>
      <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
        <table className={WS_TABLE}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={WS_TH}>{label}</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Matters</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Demand</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Pre-deposit</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Paid</th>
              <th scope="col" className={cn(WS_TH, 'text-right')} title="Demand − pre-deposit − paid">Outstanding</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Share</th>
              {showRefund && <th scope="col" className={cn(WS_TH, 'text-right')}>Refund at stake</th>}
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key} className={WS_TR}>
                <td className={WS_TD}>
                  {renderLabel ? renderLabel(b) : b.label}
                  {b.description && <div className="text-[11px] text-muted-foreground">{b.description}</div>}
                </td>
                <td className={WS_TD_NUM}><CountLink n={b.rows.length} to={countHref(b)} noun={`matters, ${b.label}`} /></td>
                <td className={WS_TD_NUM}><Amount value={b.money.demand} recorded={b.money.recorded > 0} /></td>
                <td className={WS_TD_NUM}><Amount value={b.money.preDeposit} recorded={b.money.recorded > 0} /></td>
                <td className={WS_TD_NUM}><Amount value={b.money.paid} recorded={b.money.recorded > 0} /></td>
                <td className={cn(WS_TD_NUM, 'font-semibold')}><Amount value={b.money.outstanding} recorded={b.money.recorded > 0} /></td>
                <td className={WS_TD_NUM}>{pct(b.money.outstanding, total.outstanding)}</td>
                {showRefund && <td className={WS_TD_NUM}><Amount value={b.money.refund} /></td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={WS_TR_TOTAL}>
              <td className={WS_TD}>Total</td>
              <td className={WS_TD_NUM}>{total.matters.toLocaleString('en-IN')}</td>
              <td className={WS_TD_NUM}><Amount value={total.demand} /></td>
              <td className={WS_TD_NUM}><Amount value={total.preDeposit} /></td>
              <td className={WS_TD_NUM}><Amount value={total.paid} /></td>
              <td className={WS_TD_NUM}><Amount value={total.outstanding} /></td>
              <td className={WS_TD_NUM}>{total.outstanding > 0 ? '100%' : '—'}</td>
              {showRefund && <td className={WS_TD_NUM}><Amount value={total.refund} /></td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
};
