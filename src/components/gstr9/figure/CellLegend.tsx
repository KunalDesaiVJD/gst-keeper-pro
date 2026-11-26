// The key to the Annual Return's cells (25 Nov 2026): what the user types,
// what is linked from another tab (click to open it), and what is computed or
// locked. Shown under every step's heading; the colours are SheetGrid's and
// FigLink's own.

import React from 'react';
import { cn } from '@/lib/utils';
import { VARIANCE_CELL_CLASS } from '@/lib/gstr9/varianceStyle';

const Swatch: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={cn('inline-flex h-5 items-center rounded-sm border px-1.5 font-medium tabular-nums', className)}>{children}</span>
);

/** `variance`: the GSTR-9 step also shows a final figure that differs from the system-computed GSTR-9. */
export const CellLegend: React.FC<{ readOnly?: boolean; variance?: boolean; className?: string }> = ({ readOnly, variance, className }) => (
  <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground', className)} aria-label="What the cells mean">
    {!readOnly && (
      <span className="inline-flex items-center gap-1.5">
        <Swatch className="gstr9-cell-empty-input border-transparent bg-cell-input text-cell-input-foreground">1,000</Swatch>
        Type here
      </span>
    )}
    <span className="inline-flex items-center gap-1.5">
      <Swatch className="bg-muted/40 text-success-strong underline decoration-dotted underline-offset-2">1,000</Swatch>
      From another tab, click to open its source
    </span>
    <span className="inline-flex items-center gap-1.5">
      <Swatch className="bg-muted/40 text-foreground">1,000</Swatch>
      Computed or locked
    </span>
    {variance && (
      <span className="inline-flex items-center gap-1.5">
        <Swatch className={cn('border-transparent', VARIANCE_CELL_CLASS)}>1,000</Swatch>
        Differs from the system-computed GSTR-9 (hover for both figures)
      </span>
    )}
  </div>
);
