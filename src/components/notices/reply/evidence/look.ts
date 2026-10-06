// Words, tones and figures for the Evidence tab (roadmap Phase 4; audit R-10, R-23).
import { fmtMoney, fmtWhole } from '@/components/gstr9/grid/money';
import type { AnnexureStatus, Readiness, ReadyState } from '@/lib/reply';

export type Tone = 'success' | 'warning' | 'info' | 'destructive' | 'secondary';

export const STATUS_LOOK: Record<AnnexureStatus, { label: string; tone: Tone; words: string }> = {
  ready: { label: 'Ready', tone: 'success', words: 'Every month the working needs is in.' },
  partial: { label: 'Partial', tone: 'info', words: 'Some months are missing; the figures cover what is in.' },
  needs_data: { label: 'Needs data', tone: 'warning', words: 'Nothing to compute on yet.' },
  not_applicable: { label: 'Not applicable', tone: 'secondary', words: 'This comparison does not apply to the period.' },
  failed: { label: 'Failed', tone: 'destructive', words: 'The working could not be built.' },
};

export const statusLook = (s: string) => STATUS_LOOK[s as AnnexureStatus] ?? { label: s, tone: 'secondary' as Tone, words: '' };

export const READY_LOOK: Record<ReadyState, { label: string; cls: string }> = {
  ready: { label: 'Ready', cls: 'bg-success/15 text-foreground border-success/50' },
  not_fetched: { label: 'Not fetched', cls: 'bg-warning/20 text-foreground border-warning/60' },
  not_filed: { label: 'Not filed', cls: 'bg-destructive/10 text-foreground border-destructive/60' },
  failed: { label: 'Pull failed', cls: 'bg-destructive/10 text-foreground border-destructive/60' },
  not_due: { label: 'Not due', cls: 'bg-muted text-foreground/70 border-border' },
};

export function readinessCounts(r: Readiness): Record<ReadyState, number> {
  const c: Record<ReadyState, number> = { ready: 0, not_fetched: 0, not_filed: 0, failed: 0, not_due: 0 };
  for (const s of r.sources) for (const x of s.cells) c[x.state] += 1;
  return c;
}

/** Rupees on screen: whole when there are no paise (most portal figures), else to the paisa. Exports keep every figure exact. */
export const fmtAmount = (v: number): string => (Math.abs(v - Math.round(v)) < 0.005 ? fmtWhole(v) : fmtMoney(v));
