// Headline numbers for the matters screens (the TileLink pattern of the command
// centre): a tile that is a link opens the list it counts.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TileAccent = 'destructive' | 'warning' | 'info' | 'primary' | 'success' | 'muted';
const ACCENT: Record<TileAccent, string> = {
  destructive: 'border-l-destructive', warning: 'border-l-warning', info: 'border-l-info',
  primary: 'border-l-primary', success: 'border-l-success', muted: 'border-l-muted-foreground/40',
};

export const MatterTile: React.FC<{
  label: string; value: React.ReactNode; hint?: React.ReactNode; accent: TileAccent; to?: string; strong?: boolean; title?: string;
}> = ({ label, value, hint, accent, to, strong, title }) => {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        {to && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
      </div>
      <div className={cn('truncate text-xl font-semibold leading-tight tabular-nums', strong && 'text-destructive-strong')} title={title}>{value}</div>
      {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  const cls = cn('group block min-w-0 rounded-lg border border-l-4 bg-card px-3 py-2', ACCENT[accent]);
  return to
    ? <Link to={to} className={cn(cls, 'transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>{body}</Link>
    : <div className={cls}>{body}</div>;
};

export default MatterTile;
