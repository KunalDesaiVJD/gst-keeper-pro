// A headline number that is a saved filter (the command centre's TileLink, plus
// an "on" state when its filter is the one shown): the whole tile is a link to
// the list it counts, so the two always agree (rule: every count is a link).
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TileAccent = 'destructive' | 'warning' | 'info' | 'primary' | 'success' | 'muted';

const ACCENT: Record<TileAccent, string> = {
  destructive: 'border-l-destructive',
  warning: 'border-l-warning',
  info: 'border-l-info',
  primary: 'border-l-primary',
  success: 'border-l-success',
  muted: 'border-l-muted-foreground/40',
};

export const FilterTile: React.FC<{
  to: string;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent: TileAccent;
  active?: boolean;
  strong?: boolean;
}> = ({ to, label, value, hint, accent, active, strong }) => (
  <Link to={to} aria-current={active ? 'true' : undefined}
    className={cn('group block min-w-0 rounded-lg border border-l-4 bg-card px-3 py-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      ACCENT[accent], active && 'ring-2 ring-primary')}>
    <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
      <span className="truncate">{label}</span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
    </div>
    <div className={cn('truncate text-2xl font-semibold leading-tight tabular-nums', strong && 'text-destructive-strong')}>{value}</div>
    {hint && <div className="truncate text-xs text-muted-foreground" title={typeof hint === 'string' ? hint : undefined}>{hint}</div>}
  </Link>
);

export default FilterTile;
