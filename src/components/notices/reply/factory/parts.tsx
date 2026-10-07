// Small pieces the Reply Factory tabs share: a count that opens the list it
// counts (audit cross-cutting "every number clickable"), a row of counted
// chips, a notice cell, the drill-down list frame, and a target mark that says
// on target / off target in words as well as colour.
import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import { EmptyBox, INLINE_LINK, LoadError } from '@/components/notices/autopilot/parts';
import { plural } from '@/lib/noticeFormat';
import type { NoticeRef } from '@/lib/replyFactory';
import { cn } from '@/lib/utils';

/** A count that opens its list. `label` is read after the number by screen readers. */
export const CountLink: React.FC<{ to: string; n: number; label?: string; className?: string; strong?: boolean }> = ({ to, n, label, className, strong }) => (
  <Link to={to} className={cn(INLINE_LINK, 'tabular-nums', strong && n > 0 && 'text-destructive-strong hover:text-destructive-strong', className)}>
    {n.toLocaleString('en-IN')}{label && <span className="sr-only"> {label}</span>}
  </Link>
);

export const TargetMark: React.FC<{ ok: boolean | null; what: string }> = ({ ok, what }) => (ok === null ? null : ok
  ? <><Check className="ml-1 inline h-3.5 w-3.5 text-success-strong" aria-hidden /><span className="sr-only"> meets {what}</span></>
  : <><X className="ml-1 inline h-3.5 w-3.5 text-destructive-strong" aria-hidden /><span className="sr-only"> misses {what}</span></>);

/** The notice a row points at: client, then the form and reference as the link to the notice page. */
export const NoticeCell: React.FC<{ n: NoticeRef | null; id: string; tab?: string; className?: string }> = ({ n, id, tab, className }) => (
  <div className={cn('min-w-0', className)}>
    <div className="truncate text-sm font-medium" title={n?.client_name ?? undefined}>{n?.client_name ?? 'Notice no longer in the app'}</div>
    {n ? (
      <Link to={`/notices/${id}${tab ? `?tab=${tab}` : ''}`} className={cn(INLINE_LINK, 'break-all font-mono text-[11px] font-normal')}>
        {[n.form_code, n.reference_number ?? n.case_id].filter(Boolean).join(' · ') || 'Open the notice'}
      </Link>
    ) : <div className="font-mono text-[11px] text-muted-foreground">{id.slice(0, 8)}</div>}
  </div>
);

/**
 * The frame of a drill-down list opened from a count: its title with the
 * count (the same number as the link that opened it), Close, and the body.
 * The overview opens it full width under the row of the count, so it comes
 * into view when it opens.
 */
export const DrillFrame: React.FC<{
  title: string;
  count: number | null;
  closeTo: string;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: string;
  children: React.ReactNode;
}> = ({ title, count, closeTo, loading, error, onRetry, empty, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [title]);
  return (
    <div ref={ref} className="scroll-mt-4 space-y-2 rounded-md border bg-muted/20 p-2.5" role="region" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" aria-live="polite">{title}{count !== null && <span className="font-normal text-foreground/70"> · {plural(count, 'row')}</span>}</h3>
        <Button asChild size="sm" variant="ghost" className={WS_BTN}><Link to={closeTo}>Close the list</Link></Button>
      </div>
      {error ? <LoadError what="this list" error={error} onRetry={onRetry} />
        : loading ? <div className="space-y-1.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        : count === 0 ? <EmptyBox className="p-4">{empty}</EmptyBox>
        : children}
    </div>
  );
};

/** "Date from: Portal 120 · Typed 4": each chip opens the list it counts. */
export const ChipLinks: React.FC<{ label: string; items: { key: string; label: string; n: number; to: string; bad?: boolean }[] }> = ({ label, items }) => (
  <div className="flex flex-wrap items-center gap-1.5 text-xs">
    <span className="font-medium text-muted-foreground">{label}</span>
    {items.map((it) => (
      <Link key={it.key} to={it.to}
        className={cn('inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          it.bad && it.n > 0 && 'border-destructive/40')}>
        {it.label} <span className={cn('font-semibold tabular-nums', it.bad && it.n > 0 && 'text-destructive-strong')}>{it.n.toLocaleString('en-IN')}</span>
      </Link>
    ))}
  </div>
);
