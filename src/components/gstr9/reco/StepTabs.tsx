// Compact tab pieces shared by the Duties & Taxes, RCM, Outward reco, ITC
// reco and 9C expense-head steps. Presentation only: the selected tab lives in
// a URL search param (useTabParam in ./helpers, e.g. ?rcmtab=books) so a link,
// a reload or Back lands on the same part of the step.

import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';

/** Open (reason-needed) count on a tab: a red number, or a green tick with a text alternative when nothing is open. */
export const OpenBadge: React.FC<{ n: number; showOk?: boolean }> = ({ n, showOk = true }) =>
  n > 0 ? (
    <Badge variant="destructive" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none" aria-label={`${n} open difference${n === 1 ? '' : 's'}`}>
      {n}
    </Badge>
  ) : showOk ? (
    <span className="inline-flex items-center text-success-strong">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">No open differences</span>
    </span>
  ) : null;

/** A neutral count on a tab (rows, ledgers …). */
export const CountBadge: React.FC<{ n: number; label: string }> = ({ n, label }) => (
  <Badge variant="secondary" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] font-normal leading-none" aria-label={`${n} ${label}`}>
    {n}
  </Badge>
);

/** The compact tab strip (h-8, text-xs) every reconciliation step uses; scrolls sideways on a narrow screen. */
export const StepTabsList: React.FC<{ children: React.ReactNode; className?: string; label: string }> = ({ children, className, label }) => (
  <div className={cn('max-w-full overflow-x-auto', className)}>
    <TabsList className="h-8" aria-label={label}>
      {children}
    </TabsList>
  </div>
);

export const StepTab: React.FC<{ value: string; children: React.ReactNode; title?: string }> = ({ value, children, title }) => (
  <TabsTrigger value={value} className="h-7 gap-1.5 px-2.5 text-xs" title={title}>
    {children}
  </TabsTrigger>
);

/** Two or three mutually exclusive view options as a small segmented control (keyboard reachable, aria-pressed). */
export function ViewSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-8 items-center rounded-md bg-muted p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 whitespace-nowrap rounded-sm px-2.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === o.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
