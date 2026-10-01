// The tab pieces every step uses. Presentation only: the selected tab lives in
// a URL search param (useTabParam in ./helpers, e.g. ?rcmtab=books) so a link,
// a reload or Back lands on the same part of the step.
//
// StepTabsList is pinned under the page's step bar while the step scrolls, so
// the tabs (and the controls beside them) stay in sight; an inner row of tabs
// inside a tab pins under that one. Labels wrap onto a second line rather
// than scrolling sideways or being hidden, so every tab stays visible.

import React, { useEffect, useLayoutEffect, useRef } from 'react';
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

/** The CSS variables the pinned rows read: the step bar's height (set by the page) and the step's tab row's height. */
export const STEPBAR_H_VAR = '--ar-stepbar-h';
const TABS_H_VAR = '--ar-tabs-h';
/** The element that carries both variables. */
export const PAGE_ROOT_ATTR = 'data-ar-page';

const pinnedTop = (level: 'step' | 'inner') =>
  level === 'step' ? `var(${STEPBAR_H_VAR}, 0px)` : `calc(var(${STEPBAR_H_VAR}, 0px) + var(${TABS_H_VAR}, 0px))`;

/**
 * A step's row of tabs, pinned under the step bar while the step scrolls
 * (`level="inner"`: a row of tabs inside a tab, pinned under the step's own
 * row). It must be a direct child of its <Tabs>, which bounds how long it stays
 * pinned. `actions` sit on the same line and stay in sight with the tabs.
 * Pass `value` (the open tab) so that switching tabs while the row is pinned
 * brings the top of the newly opened tab into view. `surface="card"` for a row
 * that sits inside a card (the default for an inner row).
 */
export const StepTabsList: React.FC<{
  children: React.ReactNode;
  label: string;
  actions?: React.ReactNode;
  value?: string;
  level?: 'step' | 'inner';
  surface?: 'page' | 'card';
  className?: string;
  actionsClassName?: string;
}> = ({ children, label, actions, value, level = 'step', surface = level === 'step' ? 'page' : 'card', className, actionsClassName }) => {
  const ref = useRef<HTMLDivElement>(null);

  // The step's row publishes its height, so an inner row pins just below it.
  useLayoutEffect(() => {
    const el = ref.current;
    const root = el?.closest<HTMLElement>(`[${PAGE_ROOT_ATTR}]`);
    if (level !== 'step' || !el || !root) return;
    const set = () => root.style.setProperty(TABS_H_VAR, `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty(TABS_H_VAR, '0px');
    };
  }, [level]);

  // A rule under the row only while it is pinned over the content.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const top = parseFloat(getComputedStyle(el).top) || 0;
      const box = el.parentElement?.getBoundingClientRect();
      el.dataset.pinned = String(!!box && box.top < top - 0.5 && box.bottom > top + el.offsetHeight);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Switching tabs while pinned: show the new tab from its top, not from wherever the old one was scrolled to.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    const box = el?.parentElement?.getBoundingClientRect();
    if (!el || !box) return;
    const top = parseFloat(getComputedStyle(el).top) || 0;
    if (box.top < top - 0.5) window.scrollBy({ top: box.top - top });
  }, [value]);

  return (
    <div
      ref={ref}
      data-pinned="false"
      style={{ top: pinnedTop(level) }}
      className={cn(
        'sticky border-b border-transparent py-1 transition-colors data-[pinned=true]:border-border',
        level === 'step' ? 'z-[25]' : 'z-[22]',
        surface === 'page'
          ? '-mx-4 bg-background px-4 md:-mx-6 md:px-6'
          : 'bg-card',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <TabsList className="h-auto max-w-full flex-wrap justify-start gap-0.5 p-0.5" aria-label={label}>
          {children}
        </TabsList>
        {actions && <div className={cn('ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5', actionsClassName)}>{actions}</div>}
      </div>
    </div>
  );
};

export const StepTab: React.FC<{ value: string; children: React.ReactNode; title?: string; className?: string }> = ({ value, children, title, className }) => (
  <TabsTrigger value={value} className={cn('h-7 gap-1.5 px-2.5 text-xs', className)} title={title}>
    {children}
  </TabsTrigger>
);

/** A tab's second part ("Annexure-1 · Income reco"): lighter, never hidden. */
export const TabSub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="font-normal text-muted-foreground">· {children}</span>
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
