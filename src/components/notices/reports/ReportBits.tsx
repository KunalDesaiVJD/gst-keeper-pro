// Pieces shared by the Notices report pages (audit cross-cutting ui-b:
// "clickable affordances are inconsistent", "no 'as of' time", U-76-2): a
// number that is a real link (a plain 0 is not), sortable heads that expose
// aria-sort, a chip with ✕ for every active filter, a tile that is a filter
// and shows when it is on, and the "as of" line.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { WS_TH } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useCommandCentre } from '@/lib/noticeCommandCentre';
import { fmtAgo, fmtDateTime, fmtInrShort } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const LINK = 'rounded tabular-nums underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// Grey text on a muted (total) row needs the darker tone to keep its contrast.
const quiet = (onMuted?: boolean) => (onMuted ? 'text-foreground/70' : 'text-muted-foreground');

/** A count that opens the list it counts; zero is plain text. */
export const CountLink: React.FC<{ n: number; to: string; label: string; alarm?: boolean; onMuted?: boolean; className?: string }> = ({ n, to, label, alarm, onMuted, className }) =>
  n > 0 ? (
    <Link to={to} className={cn(LINK, alarm ? 'font-semibold text-destructive-strong decoration-destructive/40 hover:decoration-destructive' : 'font-medium text-primary decoration-primary/30 hover:decoration-primary', className)}>
      <span className="sr-only">{label}: </span>{n.toLocaleString('en-IN')}
    </Link>
  ) : <span className={cn('tabular-nums', quiet(onMuted), className)}>0</span>;

/** An amount that opens the list it sums; nothing to show is a dash. */
export const AmountLink: React.FC<{ amount: number; to: string; label: string; onMuted?: boolean; className?: string }> = ({ amount, to, label, onMuted, className }) =>
  amount > 0 ? (
    <Link to={to} className={cn(LINK, 'font-medium text-primary decoration-primary/30 hover:decoration-primary', className)}>
      <span className="sr-only">{label}: </span>{fmtInrShort(amount)}
    </Link>
  ) : <span className={cn(quiet(onMuted), className)}>—</span>;

export function SortHead<K extends string>({ label, k, sort, dir, onSort, right, className }: {
  label: string; k: K; sort: K; dir: 'asc' | 'desc'; onSort: (k: K) => void; right?: boolean; className?: string;
}) {
  const on = sort === k;
  return (
    <th scope="col" className={cn(WS_TH, right && 'text-right', className)} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)}
        className={cn('inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', right && 'flex-row-reverse')}>
        {label}{on && (dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  );
}

export interface Chip { key: string; label: string; onRemove: () => void }

/** One chip per active filter, each with ✕, and "Clear all". */
export const FilterChips: React.FC<{ chips: Chip[]; onClear: () => void }> = ({ chips, onClear }) =>
  chips.length === 0 ? null : (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active filters">
      {chips.map((c) => (
        <button key={c.key} type="button" onClick={c.onRemove}
          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="sr-only">Remove filter </span>{c.label} <X className="h-3 w-3" aria-hidden />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={onClear} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">Clear all</button>
      )}
    </div>
  );

type Accent = 'destructive' | 'warning' | 'info' | 'success' | 'primary' | 'muted';
const ACCENT: Record<Accent, string> = {
  destructive: 'border-l-destructive', warning: 'border-l-warning', info: 'border-l-info',
  success: 'border-l-success', primary: 'border-l-primary', muted: 'border-l-muted-foreground/40',
};

/** A headline number that is a saved filter: the whole tile links to the view it counts. */
export const FilterTile: React.FC<{
  to: string; label: string; value: React.ReactNode; hint?: React.ReactNode; accent: Accent; active?: boolean; alarm?: boolean;
}> = ({ to, label, value, hint, accent, active, alarm }) => (
  <Link to={to} aria-current={active ? 'true' : undefined}
    className={cn('block min-w-0 rounded-lg border border-l-4 bg-card px-3 py-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      ACCENT[accent], active && 'ring-2 ring-primary/60')}>
    <div className="truncate text-xs font-medium text-muted-foreground">{label}{active && <span className="sr-only"> (showing)</span>}</div>
    <div className={cn('text-xl font-semibold leading-tight tabular-nums', alarm && 'text-destructive-strong')}>{value}</div>
    {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
  </Link>
);

/** "Counted 06 Oct 2026, 10:48 · last portal sync 5 h ago (8 of 10 GSTINs in 24 h)". */
export const AsOfLine: React.FC<{ at: number | null | undefined; children?: React.ReactNode }> = ({ at, children }) => {
  const { user } = useAuth();
  const cc = useCommandCentre(user?.id ?? null).data;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span>Counted {at ? `${fmtDateTime(new Date(at).toISOString())} IST` : '…'}</span>
      {cc && (
        <span>· last portal sync {fmtAgo(cc.health.last_success_at)} ({cc.health.fresh} of {cc.health.eligible} GSTINs synced in 24 h)</span>
      )}
      {children}
    </p>
  );
};
