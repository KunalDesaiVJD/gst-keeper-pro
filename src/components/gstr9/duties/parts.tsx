import React from 'react';
import { Info } from 'lucide-react';
import { Portal as TooltipPortal } from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { PortalMeta } from '@/lib/gstr9/types';
import { diffTone } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { SourceChip } from '../ui';

// Small presentational pieces of the Duties & Taxes step. No tax logic here —
// every figure shown comes from computeWorkings().

/** A difference figure in the grid's own tones: green at zero, muted within tolerance, red beyond. */
export const DiffValue: React.FC<{ value: number; tolerance: number }> = ({ value, tolerance }) => {
  const tone = diffTone(value, tolerance);
  return (
    <span
      className={cn(
        'tabular-nums',
        tone === 'error' && 'font-medium text-destructive',
        tone === 'ok' && 'text-success',
        tone === 'muted' && 'text-muted-foreground',
      )}
    >
      {fmtMoney(value)}
    </span>
  );
};

/** Where a month's "As per 3B" came from, plus a marker when some heads were typed over a fetched figure. */
export const MonthSource: React.FC<{ meta?: PortalMeta | null; typedHeads: number }> = ({ meta, typedHeads }) => (
  <span className="inline-flex items-center gap-1">
    <SourceChip meta={meta} />
    {typedHeads > 0 && meta?.source !== 'manual' && (
      <span className="text-[10px] text-muted-foreground" title={`${typedHeads} head${typedHeads === 1 ? '' : 's'} typed by hand over the fetched figure`}>
        + typed
      </span>
    )}
  </span>
);

/** A column header with an explanatory tooltip (keyboard-reachable). */
export const HeaderTip: React.FC<{ label: string; tip: React.ReactNode }> = ({ label, tip }) => (
  <TooltipProvider delayDuration={150}>
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 font-semibold">
          {label}
          <Info className="h-3 w-3" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      {/* Portalled: the grid's scroll container would otherwise clip it. */}
      <TooltipPortal>
        <TooltipContent className="max-w-xs text-xs font-normal">{tip}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  </TooltipProvider>
);

/**
 * A footer-row label with a hover explanation (the Excel cell it reproduces).
 * `soft` marks a secondary line (normal weight, muted) — footer rows all use
 * the opaque "total" tone so the sticky label cell never shows the scrolled
 * figures through it.
 */
export const FooterLabel: React.FC<{ children: React.ReactNode; title: string; soft?: boolean }> = ({ children, title, soft }) => (
  <span title={title} className={cn('cursor-help underline decoration-dotted underline-offset-2', soft && 'font-normal text-muted-foreground')}>
    {children}
  </span>
);

/** A secondary footer figure (normal weight, muted). */
export const SoftMoney: React.FC<{ value: number }> = ({ value }) => (
  <span className="font-normal tabular-nums text-muted-foreground">{fmtMoney(value)}</span>
);
