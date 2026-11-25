// Clickable figures: a figure on the GSTR-9 / GSTR-9C step opens the step,
// tab and row it comes from (src/lib/gstr9/figureLinks.ts). <FigureFocus />
// is mounted once in the workspace: it waits for the anchored row to render,
// scrolls it into view (inside its own scroll box too) and flashes it.

import React, { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FIG_COL_PARAM, FIG_PARAM, figTargetParams, type FigTarget } from '@/lib/gstr9/figureLinks';

export type { FigTarget } from '@/lib/gstr9/figureLinks';

/** Open a figure's source (step, tab, row). */
export const useGoFigure = () => {
  const [params, setParams] = useSearchParams();
  return useCallback(
    (t: FigTarget) => {
      setParams(figTargetParams(params, t));
      if (!t.table || !t.row) window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [params, setParams],
  );
};

/**
 * A figure that opens its source. Without a target it renders the figure as
 * it is, so a caller can pass `to={cond ? target : undefined}`.
 */
export const FigLink: React.FC<{ to?: FigTarget | null; children: React.ReactNode; className?: string }> = ({ to, children, className }) => {
  const go = useGoFigure();
  if (!to) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        go(to);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title={`Go to the source: ${to.label}`}
      aria-label={`Go to the source: ${to.label}`}
      className={cn(
        // Green, dotted: a figure linked from another tab (the working-paper convention, figure/CellLegend.tsx).
        'rounded-sm text-right tabular-nums text-success-strong underline decoration-success-strong/50 decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {children}
    </button>
  );
};

const FLASH = 'gstr9-fig-flash';
const WAIT_MS = 5000;

/** Mounted once in the workspace: scrolls to and flashes the row a figure link opened. */
export const FigureFocus: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const fig = params.get(FIG_PARAM);
  const col = params.get(FIG_COL_PARAM);

  useEffect(() => {
    if (!fig) return;
    let done = false;
    let timer: number | undefined;
    const started = Date.now();
    const sel = `[data-fig="${CSS.escape(fig)}"]`;
    const clear = () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(FIG_PARAM);
          next.delete(FIG_COL_PARAM);
          return next;
        },
        { replace: true },
      );
    const tryFind = () => {
      if (done) return;
      const row = document.querySelector<HTMLElement>(sel);
      if (!row) {
        if (Date.now() - started > WAIT_MS) {
          done = true;
          clear();
          return;
        }
        timer = window.setTimeout(tryFind, 120);
        return;
      }
      done = true;
      const cell = col ? row.querySelector<HTMLElement>(`[data-col="${CSS.escape(col)}"]`) : null;
      const el = cell ?? row;
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      [row, cell].forEach((n) => {
        if (!n) return;
        n.classList.remove(FLASH);
        void n.offsetWidth;
        n.classList.add(FLASH);
      });
      window.setTimeout(() => [row, cell].forEach((n) => n?.classList.remove(FLASH)), 2600);
      clear();
    };
    // Let the step / tab render first.
    timer = window.setTimeout(tryFind, 60);
    return () => {
      done = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [fig, col, setParams]);

  return null;
};
