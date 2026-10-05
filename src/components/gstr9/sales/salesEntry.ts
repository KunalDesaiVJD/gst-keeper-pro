// Entry aids for the Sales (PL-OUTPUT) step. These only shape what staff
// type into the doc — every computed figure (totals, implied rate, Table 5)
// still comes from computeWorkings() in src/lib/gstr9/engine.ts.

import { NON_TAX_NATURE_LABEL, OUTWARD_CATEGORY_LABEL } from '@/lib/gstr9/engine';
import { newId } from '@/lib/gstr9/defaults';
import type { NonTaxNature, NonTaxRow, OutwardCategory, SalesRow, SupplyType } from '@/lib/gstr9/types';
import { parseEntry } from '../grid/money';

/** Column keys of the Part A tax cells (also the keys their "=…" expressions are remembered under). */
export const TAX_KEY = { i: 'tax.i', c: 'tax.c', s: 'tax.s', x: 'tax.x' } as const;

const n0 = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** A number as it should appear inside a remembered expression (no exponent, no float noise). */
const exprNum = (v: number) => String(Math.round(v * 1e6) / 1e6);

/** Set or drop one remembered "=…" expression on a row. */
export function setFormula<R extends { f?: Record<string, string> }>(row: R, field: string, formula: string | undefined): R {
  const prev = row.f || {};
  if (!formula && !(field in prev)) return row;
  const f = { ...prev };
  if (formula) f[field] = formula;
  else delete f[field];
  return { ...row, f };
}

export const newSalesRow = (): SalesRow => ({
  id: newId(),
  ledger: '',
  category: 'b2b',
  supplyType: 'intra',
  rate: null,
  taxable: 0,
  igst: 0,
  cgst: 0,
  sgst: null,
  cess: 0,
});

export const newNonTaxRow = (): NonTaxRow => ({ id: newId(), ledger: '', nature: 'non_gst', amount: 0 });

// ---------------------------------------------------------------------------
// Part A — tax from the rate (the sheet's `=D*18%` / `=D*9%` cells)
// ---------------------------------------------------------------------------

export interface AutoTax {
  igst: number;
  cgst: number;
  head: 'i' | 'c';
  /** The expression as the sheet writes it, e.g. "=147455684*9%". */
  formula: string;
}

/**
 * Tax the sheet would compute from the row's value and rate: inter-state →
 * IGST = value × rate; intra-state → CGST = value × rate / 2 (SGST mirrors
 * CGST). Evaluated through the same expression parser as a typed "=…" entry,
 * so the stored figure and the remembered expression always agree.
 */
export function autoTaxFor(r: Pick<SalesRow, 'taxable' | 'rate' | 'supplyType'>): AutoTax | null {
  const rate = r.rate;
  const value = n0(r.taxable);
  if (rate === null || rate === undefined || !Number.isFinite(rate) || !value) return null;
  const inter = r.supplyType === 'inter';
  const formula = `=${exprNum(value)}*${exprNum(inter ? rate : rate / 2)}%`;
  const v = parseEntry(formula).value ?? 0;
  return inter ? { igst: v, cgst: 0, head: 'i', formula } : { igst: 0, cgst: v, head: 'c', formula };
}

/** IGST, CGST, SGST and Cess all zero / blank. */
export const taxBlank = (r: SalesRow): boolean => !n0(r.igst) && !n0(r.cgst) && !n0(r.sgst) && !n0(r.cess);

/**
 * The row's tax is still "from the rate": blank, or exactly what autoTaxFor()
 * gives for the row as it stands (SGST mirroring, no cess). Only such rows are
 * recomputed when the value, rate or supply changes — a figure staff typed
 * differently is never overwritten.
 */
export const taxIsAuto = (r: SalesRow): boolean => {
  if (taxBlank(r)) return true;
  const a = autoTaxFor(r);
  return !!a && near(n0(r.igst), a.igst) && near(n0(r.cgst), a.cgst) && (r.sgst === null || r.sgst === undefined) && !n0(r.cess);
};

/** Write the rate-computed tax into a row, remembering the expression like the sheet's formula cell. */
const writeAuto = (r: SalesRow, a: AutoTax): SalesRow => {
  let out: SalesRow = { ...r, igst: a.igst, cgst: a.cgst, sgst: null };
  out = setFormula(out, TAX_KEY.i, a.head === 'i' ? a.formula : undefined);
  out = setFormula(out, TAX_KEY.c, a.head === 'c' ? a.formula : undefined);
  out = setFormula(out, TAX_KEY.s, undefined);
  return out;
};

/** After the value, rate or supply of `prev` changed to `next`: refill the tax when it was blank or rate-computed. */
export function withAutoTax(prev: SalesRow, next: SalesRow): SalesRow {
  if (!taxIsAuto(prev)) return next;
  const a = autoTaxFor(next);
  if (!a) return next;
  return writeAuto(next, a);
}

/** Supply follows the heads that carry tax: IGST only → inter-state; CGST/SGST only → intra-state. */
export function syncSupply(r: SalesRow): SalesRow {
  const i = n0(r.igst);
  const cs = n0(r.cgst) || n0(r.sgst);
  let supplyType: SupplyType = r.supplyType;
  if (i && !cs) supplyType = 'inter';
  else if (cs && !i) supplyType = 'intra';
  return supplyType === r.supplyType ? r : { ...r, supplyType };
}

/** "Fill tax from rate": rows whose tax is blank and that have a value and a rate. */
export function fillTaxFromRate(rows: SalesRow[]): { rows: SalesRow[]; changed: number } {
  let changed = 0;
  const out = rows.map((r) => {
    if (!taxBlank(r)) return r;
    const a = autoTaxFor(r);
    if (!a || (!a.igst && !a.cgst)) return r;
    changed += 1;
    return writeAuto(r, a);
  });
  return { rows: changed ? out : rows, changed };
}

export const SUPPLY_OPTIONS: Array<{ value: SupplyType; label: string }> = [
  { value: 'intra', label: 'Intra-state' },
  { value: 'inter', label: 'Inter-state' },
];

export const CATEGORY_OPTIONS = (Object.keys(OUTWARD_CATEGORY_LABEL) as OutwardCategory[]).map((k) => ({
  value: k,
  label: OUTWARD_CATEGORY_LABEL[k],
}));

// ---------------------------------------------------------------------------
// Part B — nature (the sheet's BIFURCATION column)
// ---------------------------------------------------------------------------

/** The firm's own BIFURCATION labels (PL-OUTPUT E41:E48): accepted when typing or pasting, not listed. */
const NATURE_ALIASES: Partial<Record<NonTaxNature, string[]>> = {
  export_wo: ['EXPORT SALE W/O'],
  sez_wo: ['SEZ W/O'],
  non_gst: ['NON-GST'],
};

export const NATURE_OPTIONS: Array<{ value: NonTaxNature; label: string; aliases?: string[] }> = (
  Object.keys(NON_TAX_NATURE_LABEL) as NonTaxNature[]
).map((k) => ({ value: k, label: NON_TAX_NATURE_LABEL[k], aliases: NATURE_ALIASES[k] }));

/** Option value → nature; null when nothing (or something unknown) was chosen. */
export function natureFromOption(value: string): NonTaxNature | null {
  return value && value in NON_TAX_NATURE_LABEL ? (value as NonTaxNature) : null;
}

/** GSTR-9 Table 5 row of each nature (positive amounts). */
export const NATURE_TABLE: Record<NonTaxNature, string> = {
  export_wo: '5A',
  sez_wo: '5B',
  rcm_outward: '5C',
  ecom_95: '5C1',
  exempt: '5D',
  nil: '5E',
  non_gst: '5F',
  not_in_gstr9: '—',
};

/** Where a Part B row lands in GSTR-9 Table 5 (negative rows are credit notes, 5H). */
export function landsIn(r: NonTaxRow): { code: string; note: string } {
  if (r.nature === 'not_in_gstr9') return { code: '—', note: 'Not in GSTR-9' };
  if (n0(r.amount) < 0) return { code: '5H', note: 'Credit note' };
  return { code: NATURE_TABLE[r.nature] ?? '5F', note: '' };
}
