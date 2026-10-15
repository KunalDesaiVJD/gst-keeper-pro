// Formats, colours and table classes the reconciliation view's pieces share
// (the components using them are in ./shared.tsx). Figures are printed as the
// Excel and PDF print them: 1,23,456.00, a negative in brackets, nil as a dash
// (fmtNumber in src/lib/reportExport/layout.ts).
import { fmtDate, fmtNumber } from '@/lib/reportExport/layout';
import type { RecoStatus } from '@/lib/itcReco/types';
import type { StatusCounts } from '@/lib/itcReco/viewTypes';

/** An amount as the exports print it; '' for a side that has no document. */
export const fmtAmt = (v: number | null | undefined): string => (v === null || v === undefined ? '' : fmtNumber(v, 'amount'));
/** A count in a table: a dash for nil, as the exports print it. */
export const fmtCount = (v: number): string => fmtNumber(v, 'int');
/** A count standing on its own (a tile, a chip): 0 reads as 0. */
export const fmtCountPlain = (v: number): string => (v === 0 ? '0' : fmtNumber(v, 'int'));
/** ISO → 22-Apr-2025; '' when unknown. */
export const fmtIso = (iso: string | null | undefined): string => (iso ? fmtDate(iso.slice(0, 10)) : '');
export const pct = (n: number, of: number): string => (of ? `${(Math.round((n / of) * 1000) / 10).toFixed(1)}%` : '0.0%');

// The gstr9 Badge's readable tones (src/components/gstr9/badge.tsx: a light
// tint with dark text, the destructive one a card pill with a red border) as
// one plain class string per status, so a status costs a <span> and not three
// components and two class merges: the document list draws thousands.
const PILL = 'inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-0 text-[10.5px] font-medium leading-[18px]';
export const STATUS_PILL: Record<RecoStatus, string> = {
  matched: `${PILL} border-success/50 bg-success/15 text-foreground`,
  only_left: `${PILL} border-warning/60 bg-warning/20 text-foreground`,
  only_right: `${PILL} border-orange-500/60 bg-orange-500/15 text-foreground`,
  differs: `${PILL} border-destructive bg-card text-foreground`,
  itc_differs: `${PILL} border-destructive bg-card text-foreground`,
  not_compared: `${PILL} border-transparent bg-secondary text-secondary-foreground`,
};

/** The colour of a status in the stacked bar and the small dots (the two "only" statuses must read apart). */
export const STATUS_FILL: Record<RecoStatus, string> = {
  matched: 'bg-success',
  only_left: 'bg-warning',
  only_right: 'bg-orange-600',
  differs: 'bg-destructive',
  itc_differs: 'bg-destructive',
  not_compared: 'bg-muted-foreground/40',
};

/** Ink for a small count of that status (counts in the supplier and month tables). */
export const STATUS_INK: Record<RecoStatus, string> = {
  matched: 'text-success-strong',
  only_left: 'text-amber-700 dark:text-amber-400',
  only_right: 'text-orange-700 dark:text-orange-400',
  differs: 'text-destructive-strong',
  itc_differs: 'text-destructive-strong',
  not_compared: 'text-muted-foreground',
};

/** A light row tint by status; matched rows stay plain so the exceptions stand out. The word in the badge carries the meaning. */
export const ROW_TINT: Record<RecoStatus, string> = {
  matched: '',
  only_left: 'bg-warning/[0.07]',
  only_right: 'bg-orange-500/[0.06]',
  differs: 'bg-destructive/[0.06]',
  itc_differs: 'bg-destructive/[0.06]',
  not_compared: 'bg-muted/40',
};

/** The coloured rule at a row's left edge. */
export const ROW_EDGE: Record<RecoStatus, string> = {
  matched: 'shadow-[inset_3px_0_0_hsl(var(--success)/0.55)]',
  only_left: 'shadow-[inset_3px_0_0_hsl(var(--warning))]',
  only_right: 'shadow-[inset_3px_0_0_#ea580c]',
  differs: 'shadow-[inset_3px_0_0_hsl(var(--destructive))]',
  itc_differs: 'shadow-[inset_3px_0_0_hsl(var(--destructive))]',
  not_compared: 'shadow-[inset_3px_0_0_hsl(var(--muted-foreground)/0.35)]',
};

/** The five buckets of the figures across the top, in the order a reviewer reads them. */
export const bucketCounts = (c: StatusCounts) => ({
  matched: c.matched, only_left: c.only_left, only_right: c.only_right, differs: c.differs + c.itc_differs, not_compared: c.not_compared,
});

export type SortDir = 'asc' | 'desc';

/** Table classes shared by the analysis tabs (the document list has its own). */
export const T = {
  wrap: 'relative max-h-[62vh] overflow-auto rounded-md border bg-card',
  table: 'w-full border-separate border-spacing-0 text-[12.5px]',
  th: 'sticky top-0 z-10 border-b border-r bg-muted px-2 py-1.5 text-left text-[12px] font-semibold text-foreground/75 whitespace-nowrap',
  td: 'border-b border-r px-2 py-1',
  num: 'border-b border-r px-2 py-1 text-right tabular-nums whitespace-nowrap',
  total: 'sticky bottom-0 z-10 border-t-2 border-t-foreground/30 bg-muted font-semibold',
} as const;
