// How the kit's standard cell reads a report's values: a link is a "View",
// "NOT PULLED" is a sentinel and not a value, a Status cell is a badge tinted
// by the row's tone (else guessed from its words), and figures sit right and
// never wrap. A view with a better idea for one column says so through
// TableKitTable's renderCell; every other cell keeps these rules.
import type { RowTone } from '@/utils/allClientsReports';
import { cn } from '@/lib/utils';
import { WS_TD } from '@/components/workspace/theme';
import type { TableKit } from './useTableKit';

export type BadgeVariant = 'success' | 'warning' | 'destructive' | 'info' | 'secondary';

export const isUrlCell = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

export const isSentinelCell = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  const s = v.trim().toUpperCase();
  return s === 'NOT PULLED' || /NOT CAPTURED|NOT PULLED/i.test(v);
};

/** A status's badge from its words, when the report gave the row no tone. */
export const statusVariant = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ACKNOWLEDG|APPROV|FILED|ACCEPT|PROCESSED|MATCHED/.test(s)) return 'success';
  if (/PENDING|PROCESSING|SUBMIT/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

export const TONE_VARIANT: Record<RowTone, BadgeVariant> = {
  good: 'success', warn: 'warning', bad: 'destructive', info: 'info', muted: 'secondary',
};

/**
 * A data cell's classes: figures right-aligned and unwrapped, dates and the
 * period unwrapped, text cut at 280px with the whole value in its title. A
 * register is read many rows at a time, so `dense` is a slightly tighter row
 * than the house default.
 */
export const kitCellClass = (kit: TableKit, col: number, dense = true): string => cn(
  WS_TD, dense && 'py-1',
  kit.isFigure(col) ? 'whitespace-nowrap text-right tabular-nums'
    : kit.model.columns[col]?.kind === 'date' || col === kit.model.periodCol ? 'whitespace-nowrap'
      : 'max-w-[280px] truncate',
);
