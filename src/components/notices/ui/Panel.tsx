// The module's minimal building blocks (the firm's request of 7 October 2026:
// balanced, structured, less text): a panel whose explanation sits behind an
// (i) instead of a paragraph and which fills its grid cell, so panels side by
// side end level; a compact stat; and a two-column row of equal panels.
import React from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** An explanation behind an (i): read on hover or focus, never in the way. */
export const InfoTip: React.FC<{ children: React.ReactNode; label?: string; className?: string }> = ({ children, label = 'About this', className }) => (
  <Tooltip delayDuration={150}>
    <TooltipTrigger asChild>
      <button type="button" aria-label={label}
        className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs text-xs font-normal leading-snug">{children}</TooltipContent>
  </Tooltip>
);

/** A titled panel: title, an (i) for its explanation, actions on the right; fills its cell. */
export const Panel: React.FC<{
  title: React.ReactNode;
  info?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}> = ({ title, info, actions, className, bodyClassName, children }) => (
  <section className={cn('flex h-full min-w-0 flex-col rounded-lg border bg-card', className)}>
    <header className="flex min-h-[2.5rem] flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3.5 pb-1 pt-2.5">
      <h2 className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold leading-tight">
        <span className="truncate">{title}</span>{info && <InfoTip>{info}</InfoTip>}
      </h2>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </header>
    <div className={cn('min-h-0 flex-1 px-3.5 pb-3', bodyClassName)}>{children}</div>
  </section>
);

/** Two (or three) panels side by side, the same height. */
export const PanelRow: React.FC<{ cols?: 2 | 3; className?: string; children: React.ReactNode }> = ({ cols = 2, className, children }) => (
  <div className={cn('grid grid-cols-1 items-stretch gap-3', cols === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3', className)}>{children}</div>
);

/** A figure with its label above and an optional line below. */
export const Stat: React.FC<{ label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: 'bad' | 'good'; className?: string }> = ({ label, value, sub, tone, className }) => (
  <div className={cn('min-w-0', className)}>
    <div className="truncate text-[11px] font-medium text-muted-foreground">{label}</div>
    <div className={cn('text-lg font-semibold leading-tight tabular-nums',
      tone === 'bad' && 'text-destructive-strong', tone === 'good' && 'text-success-strong')}>{value}</div>
    {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
  </div>
);

/** A thin bar for a share (0–100). */
export const Bar: React.FC<{ pct: number; tone?: 'primary' | 'bad' | 'warn'; className?: string; label?: string }> = ({ pct, tone = 'primary', className, label }) => (
  <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="img" aria-label={label ?? `${Math.round(pct)}%`}>
    <div className={cn('h-full rounded-full', tone === 'bad' ? 'bg-destructive' : tone === 'warn' ? 'bg-warning' : 'bg-primary')}
      style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
  </div>
);

/**
 * The module's section card (the same props as the Annual Return's SectionCard,
 * so a page swaps one import): a long explanation goes behind (i), a short
 * one ("35 readings") stays beside the title; the card fills its grid cell.
 */
export const SectionCard: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A fuller explanation, always behind (i). */
  info?: React.ReactNode;
  /** Accepted for the same props as the Annual Return's card; not shown here. */
  excelRef?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, description, info, actions, children, className }) => {
  const long = typeof description === 'string' && description.length > 70;
  const tip = long ? description : info;
  return (
    <section className={cn('flex h-full min-w-0 flex-col rounded-lg border bg-card', className)}>
      <header className="flex min-h-[2.5rem] flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3.5 pb-1 pt-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <h2 className="flex shrink-0 items-center gap-1.5 text-[15px] font-semibold leading-tight">{title}{tip && <InfoTip>{tip}</InfoTip>}</h2>
          {!long && description && <span className="min-w-0 truncate text-xs text-muted-foreground">{description}</span>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 space-y-2.5 px-3.5 pb-3">{children}</div>
    </section>
  );
};
