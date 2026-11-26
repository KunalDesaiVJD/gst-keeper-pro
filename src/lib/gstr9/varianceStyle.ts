// How a final GSTR-9 figure that differs from the system-computed GSTR-9 looks
// (variance.ts; kept apart so the shared grids import no engine).

const r2 = (n: number) => {
  const r = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/** "₹1,23,456.78" (negatives with a minus). */
export const inr = (n: number): string => {
  const v = r2(n);
  return `${v < 0 ? '−' : ''}₹${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** The classes of a differing cell on screen (the --cell-variance tokens of src/index.css; the legend's swatch is the same). */
export const VARIANCE_CELL_CLASS = 'bg-cell-variance text-cell-variance-foreground font-semibold shadow-[inset_3px_0_0_hsl(var(--cell-variance-foreground)/0.8)]';

/** The hover text of a differing cell. */
export const varianceTitle = (portal: number, final: number): string =>
  `System-computed ${inr(portal)} · final ${inr(final)} · difference ${inr(final - portal)}`;

