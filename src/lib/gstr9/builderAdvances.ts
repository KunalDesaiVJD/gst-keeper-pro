// Builder clients: the customer-advance roll-forward behind GSTR-9C Table 5
// (the firm's "TURNOVER IN 9C" sheet, 23 Nov 2026). Pure: the year's figures
// live in gstr9c.builderAdv, computeWorkings() reads the result into Table 5.
//
// Per FY:
//   Advance received in the FY = Closing advance − Opening advance + Revenue recognised
//   Received to date           = Received before the FY + Advance received in the FY
//   Sales to date              = Sales before the FY + Revenue recognised
//   Unadjusted advance at end  = Received to date − Sales to date (= Closing advance)
//
// Table 5 for the year: 5B = opening unbilled revenue, 5C = closing advance,
// 5H = closing unbilled revenue, 5I = opening advance, 5J and 5O = the listed
// adjustments (an advance refunded to a cancelled member is 5O, the firm's
// position; 5J only where a credit note was raised in the books).
//
// The openings are what the year before carries forward (carryForward); they
// are typed only for the first year of the chain. The database checks both
// that and the one-open-year rule (20261123150000_annual_return_builder_advances.sql).
// Positions: docs/GSTR9_9C_WORKINGS.md, "Builder advance roll-forward".

export type BuilderAdjRow = 'J' | 'O';

export interface BuilderAdvAdjustment {
  id: string;
  /** Table 5 row it goes to: 5J (−) or 5O (+, or − when negative). */
  row: BuilderAdjRow;
  label: string;
  amount: number;
  reason: string;
  /** Where a suggested line came from (a Builder cancellation id), else null. */
  sourceId?: string | null;
}

export interface BuilderAdvTieOut {
  /** Builder receipts dated in the FY, bounced cheques left out (consideration, excl. GST). */
  receipts: number;
  /** Refunds paid in the FY to cancelled members. */
  refunds: number;
  /** When the figures were read from the Builder module. */
  readAt: string;
  note: string;
}

export interface BuilderAdvanceDoc {
  /** Carried from the year before (typed only for the first year of the chain). */
  openingAdvance: number;
  openingUnbilled: number;
  receivedBefore: number;
  salesBefore: number;
  /** Customer advance in the audited balance sheet at 31 March. */
  closingAdvance: number;
  /** Revenue recognised in the FY (transferred from advances to sales / WIP). */
  revenue: number;
  closingUnbilled: number;
  adjustments: BuilderAdvAdjustment[];
  tieOut: BuilderAdvTieOut | null;
}

export interface BuilderCarry {
  openingAdvance: number;
  openingUnbilled: number;
  receivedBefore: number;
  salesBefore: number;
}

export interface BuilderRollForward {
  openingAdvance: number;
  openingUnbilled: number;
  closingAdvance: number;
  closingUnbilled: number;
  revenue: number;
  received: number;
  receivedBefore: number;
  receivedToDate: number;
  salesBefore: number;
  salesToDate: number;
  unadjustedEnd: number;
  /** Table 5 rows this working fills. */
  t5: { B: number; C: number; H: number; I: number; J: number; O: number };
  /** Receipts less refunds against the advance received (null until read). */
  tieOut: { net: number; diff: number } | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export const emptyBuilderAdv = (carry?: BuilderCarry | null): BuilderAdvanceDoc => ({
  openingAdvance: carry?.openingAdvance ?? 0,
  openingUnbilled: carry?.openingUnbilled ?? 0,
  receivedBefore: carry?.receivedBefore ?? 0,
  salesBefore: carry?.salesBefore ?? 0,
  closingAdvance: 0,
  revenue: 0,
  closingUnbilled: 0,
  adjustments: [],
  tieOut: null,
});

/** A stored builderAdv, made safe to read (null = the year has none). */
export function normalizeBuilderAdv(raw: unknown): BuilderAdvanceDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const adj = Array.isArray(o.adjustments) ? o.adjustments : [];
  const t = o.tieOut && typeof o.tieOut === 'object' ? (o.tieOut as Record<string, unknown>) : null;
  return {
    openingAdvance: num(o.openingAdvance),
    openingUnbilled: num(o.openingUnbilled),
    receivedBefore: num(o.receivedBefore),
    salesBefore: num(o.salesBefore),
    closingAdvance: num(o.closingAdvance),
    revenue: num(o.revenue),
    closingUnbilled: num(o.closingUnbilled),
    adjustments: adj
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a, i) => ({
        id: typeof a.id === 'string' && a.id ? a.id : `adj${i}`,
        row: a.row === 'J' ? 'J' : 'O',
        label: typeof a.label === 'string' ? a.label : '',
        amount: num(a.amount),
        reason: typeof a.reason === 'string' ? a.reason : '',
        sourceId: typeof a.sourceId === 'string' ? a.sourceId : null,
      })),
    tieOut: t
      ? { receipts: num(t.receipts), refunds: num(t.refunds), readAt: typeof t.readAt === 'string' ? t.readAt : '', note: typeof t.note === 'string' ? t.note : '' }
      : null,
  };
}

/** The roll-forward of one year. */
export function rollForward(d: BuilderAdvanceDoc): BuilderRollForward {
  const received = r2(d.closingAdvance - d.openingAdvance + d.revenue);
  const receivedToDate = r2(d.receivedBefore + received);
  const salesToDate = r2(d.salesBefore + d.revenue);
  const sumOf = (row: BuilderAdjRow) => r2(d.adjustments.filter((a) => a.row === row).reduce((s, a) => s + num(a.amount), 0));
  const net = d.tieOut ? r2(d.tieOut.receipts - d.tieOut.refunds) : null;
  return {
    openingAdvance: d.openingAdvance,
    openingUnbilled: d.openingUnbilled,
    closingAdvance: d.closingAdvance,
    closingUnbilled: d.closingUnbilled,
    revenue: d.revenue,
    received,
    receivedBefore: d.receivedBefore,
    receivedToDate,
    salesBefore: d.salesBefore,
    salesToDate,
    unadjustedEnd: r2(receivedToDate - salesToDate),
    t5: { B: d.openingUnbilled, C: d.closingAdvance, H: d.closingUnbilled, I: d.openingAdvance, J: sumOf('J'), O: sumOf('O') },
    tieOut: net === null ? null : { net, diff: r2(net - received) },
  };
}

/** What a year carries into the next (the database checks the same sums). */
export function carryForward(d: BuilderAdvanceDoc): BuilderCarry {
  const rf = rollForward(d);
  return {
    openingAdvance: d.closingAdvance,
    openingUnbilled: d.closingUnbilled,
    receivedBefore: rf.receivedToDate,
    salesBefore: rf.salesToDate,
  };
}

/** The openings differ from what the year before carries (beyond paise). */
export function openingsDiffer(d: BuilderAdvanceDoc, carry: BuilderCarry): boolean {
  return (
    Math.abs(d.openingAdvance - carry.openingAdvance) > 0.005
    || Math.abs(d.openingUnbilled - carry.openingUnbilled) > 0.005
    || Math.abs(d.receivedBefore - carry.receivedBefore) > 0.005
    || Math.abs(d.salesBefore - carry.salesBefore) > 0.005
  );
}

export const withCarry = (d: BuilderAdvanceDoc, carry: BuilderCarry): BuilderAdvanceDoc => ({ ...d, ...carry });

/** "2025-26" → "2024-25". */
export function prevFy(fy: string): string {
  const y = Number(fy.slice(0, 4));
  return `${y - 1}-${String(y % 100).padStart(2, '0')}`;
}

/** A year in the chain, as the workspace shows it. */
export interface BuilderChainYear {
  fy: string;
  doc: BuilderAdvanceDoc;
  closed: boolean;
  /** Why it is closed: its Annual Return is locked, or its roll-forward was closed. */
  closedHow: 'locked' | 'closed' | null;
  closedBy: string | null;
  closedAt: string | null;
  closeReason: string | null;
}

/**
 * Whether the year `fy` may be edited, and if not, why — the same rule the
 * database applies: open itself, the year before closed (when it holds a
 * roll-forward), and no later year closed.
 */
export function editableReason(fy: string, chain: BuilderChainYear[]): string | null {
  const self = chain.find((y) => y.fy === fy);
  if (self?.closed) return `FY ${fy} is closed${self.closedHow === 'locked' ? ' (its Annual Return is locked)' : ''}.`;
  const later = chain.filter((y) => y.fy > fy && y.closed).sort((a, b) => a.fy.localeCompare(b.fy))[0];
  if (later) return `FY ${later.fy} is already closed, so FY ${fy} cannot change.`;
  const p = chain.find((y) => y.fy === prevFy(fy));
  if (p && !p.closed) return `Close FY ${p.fy} first. Only one year is open at a time.`;
  return null;
}

/** Plain words for the database's refusals. */
export function builderAdvError(message: string): string | null {
  const m = /BUILDER_ADV_[A-Z_]+:\s*(.*)$/.exec(message);
  return m ? m[1] : null;
}
