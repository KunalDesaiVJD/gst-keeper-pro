// Parses what the GST portal returns into the workspace's PortalDoc shape.
// Two inputs, both straight from the portal (never from the app's own
// GSTR-1 / GSTR-3B modules — docs/GSTR9_9C_WORKINGS.md §5):
//
//  1. GSTR-9 system-computed details — GET returns2/auth/api/gstr9/details/calc
//     (same shape as GSTN's CALRCDS / the "System computed" summary).
//     Pulled by the extension's gstr9_pull mode (stored as GSTR9_CALC) or
//     uploaded as the JSON saved from the portal.
//  2. The as-filed GSTR-3B summary per month — GET returns/auth/api/gstr3b/summary,
//     pulled by the extension's existing gstr3b_pull mode (stored as GSTR3B).
//
// The parser is deliberately tolerant: wrappers ({status, data}, {data:{data}}),
// numeric strings ("1,23,456.78"), missing heads, and the key aliases seen
// across portal versions (db_nt for dr_nt, itc_2a before FY 2023-24 …).

import { emptyPortalMonth, emptyTable9, zTax, zVal } from './defaults';
import { FY_MONTHS, MonthKey, PortalDoc, PortalGstr9, PortalMonth, T4_KEYS, T5_KEYS, T4Key, T5Key, Tax, ValTax } from './types';

type AnyObj = Record<string, unknown>;
const isObj = (v: unknown): v is AnyObj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Number from anything the portal sends: 123, "123.45", "1,23,456.78", null. */
export const pnum = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const ptax = (o: unknown): Tax => {
  if (!isObj(o)) return zTax();
  return { i: pnum(o.iamt), c: pnum(o.camt), s: pnum(o.samt), x: pnum(o.csamt) };
};
const pval = (o: unknown): ValTax => {
  if (!isObj(o)) return zVal();
  return { t: pnum(o.txval), ...ptax(o) };
};
const addTax = (...xs: Tax[]): Tax => xs.reduce((a, b) => ({ i: a.i + b.i, c: a.c + b.c, s: a.s + b.s, x: a.x + b.x }), zTax());
const subTax = (a: Tax, ...bs: Tax[]): Tax => bs.reduce((acc, b) => ({ i: acc.i - b.i, c: acc.c - b.c, s: acc.s - b.s, x: acc.x - b.x }), a);

/** Peel the portal's response wrappers until an object with the expected keys appears. */
export function unwrap(raw: unknown, markers: string[]): AnyObj | null {
  let cur: unknown = raw;
  for (let depth = 0; depth < 5 && isObj(cur); depth++) {
    if (markers.some((m) => m in (cur as AnyObj))) return cur as AnyObj;
    const o = cur as AnyObj;
    cur = o.data ?? o.result ?? o.payload ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// GSTR-9 system-computed
// ---------------------------------------------------------------------------

export interface ParsedGstr9 {
  gstin: string | null;
  /** Return period as the portal writes it — "032025" for FY 2024-25. */
  fp: string | null;
  gstr9: PortalGstr9;
  /** Which keys were actually present, for the preview's coverage list. */
  found: { table4: boolean; table5: boolean; t6A: boolean; t8A: boolean; table9: boolean };
}

const T4_ALIASES: Record<T4Key, string[]> = {
  b2c: ['b2c'],
  b2b: ['b2b'],
  exp: ['exp'],
  sez: ['sez'],
  deemed: ['deemed'],
  at: ['at'],
  rchrg: ['rchrg'],
  ecom: ['ecom', 'ecom_9_5', 'ecom_14'],
  cr_nt: ['cr_nt', 'cdn_neg'],
  dr_nt: ['dr_nt', 'db_nt', 'cdn_pos'],
  amd_pos: ['amd_pos'],
  amd_neg: ['amd_neg'],
};

const T5_ALIASES: Record<T5Key, string[]> = {
  zero_rtd: ['zero_rtd'],
  sez: ['sez'],
  rchrg: ['rchrg'],
  ecom_14: ['ecom_14', 'ecom'],
  exmt: ['exmt'],
  nil: ['nil'],
  non_gst: ['non_gst'],
  cr_nt: ['cr_nt', 'cdn_neg'],
  dr_nt: ['dr_nt', 'db_nt', 'cdn_pos'],
  amd_pos: ['amd_pos'],
  amd_neg: ['amd_neg'],
};

const pickAlias = (o: AnyObj, names: string[]): unknown => {
  for (const n of names) if (n in o) return o[n];
  return undefined;
};

export function parseGstr9Calc(raw: unknown, financialYear?: string): ParsedGstr9 {
  const d = unwrap(raw, ['table4', 'table6', 'table9']);
  if (!d) throw new Error('This file is not a GSTR-9 system-computed JSON (no table4 / table6 / table9 found).');

  const out: PortalGstr9 = {
    table4: Object.fromEntries(T4_KEYS.map((k) => [k, zVal()])) as Record<T4Key, ValTax>,
    table5: Object.fromEntries(T5_KEYS.map((k) => [k, 0])) as Record<T5Key, number>,
    t6A: zTax(),
    t6G: zTax(),
    t8A: zTax(),
    table9: emptyTable9(),
  };
  const found = { table4: false, table5: false, t6A: false, t8A: false, table9: false };

  const t4 = isObj(d.table4) ? d.table4 : null;
  if (t4) {
    found.table4 = true;
    T4_KEYS.forEach((k) => { out.table4[k] = pval(pickAlias(t4, T4_ALIASES[k])); });
  }
  const t5 = isObj(d.table5) ? d.table5 : null;
  if (t5) {
    found.table5 = true;
    T5_KEYS.forEach((k) => { out.table5[k] = pnum((pickAlias(t5, T5_ALIASES[k]) as AnyObj | undefined)?.txval); });
  }
  const t6 = isObj(d.table6) ? d.table6 : null;
  if (t6) {
    const a = pickAlias(t6, ['itc_3b', 'itc_frm_3b']);
    if (a !== undefined) { found.t6A = true; out.t6A = ptax(a); }
    out.t6G = ptax(t6.isd);
  }
  const t8 = isObj(d.table8) ? d.table8 : null;
  if (t8) {
    // itc_2b from FY 2023-24 onward, itc_2a before; prefer the one matching the FY.
    const startYear = financialYear ? Number(financialYear.slice(0, 4)) : NaN;
    const order = Number.isFinite(startYear) && startYear < 2023 ? ['itc_2a', 'itc_2b'] : ['itc_2b', 'itc_2a'];
    const a = pickAlias(t8, order);
    if (a !== undefined) { found.t8A = true; out.t8A = ptax(a); }
  }
  const t9 = isObj(d.table9) ? d.table9 : null;
  if (t9) {
    found.table9 = true;
    const head = (o: unknown) => {
      const r = isObj(o) ? o : {};
      return {
        payable: pnum(r.txpyble),
        cash: pnum(r.txpaid_cash),
        itcI: pnum(r.tax_paid_itc_iamt),
        itcC: pnum(r.tax_paid_itc_camt),
        itcS: pnum(r.tax_paid_itc_samt),
        itcX: pnum(r.tax_paid_itc_csamt),
      };
    };
    const other = (o: unknown) => {
      const r = isObj(o) ? o : {};
      return { payable: pnum(r.txpyble), cash: pnum(r.txpaid_cash ?? r.txpaid) };
    };
    out.table9 = {
      igst: head(t9.iamt),
      cgst: head(t9.camt),
      sgst: head(t9.samt),
      cess: head(t9.csamt),
      interest: other(t9.intr),
      lateFee: other(t9.fee),
      penalty: other(t9.pen),
      other: other(t9.other),
    };
  }

  return {
    gstin: typeof d.gstin === 'string' ? d.gstin : null,
    fp: typeof d.fp === 'string' ? d.fp : typeof d.ret_period === 'string' ? d.ret_period : null,
    gstr9: out,
    found,
  };
}

/** GSTR-9's return period for an FY: "2024-25" → "032025". */
export const gstr9Fp = (financialYear: string): string => `03${Number(financialYear.slice(0, 4)) + 1}`;

// ---------------------------------------------------------------------------
// As-filed GSTR-3B (one month)
// ---------------------------------------------------------------------------

export function parseGstr3bSummary(raw: unknown): PortalMonth {
  const d = unwrap(raw, ['sup_details', 'itc_elg']);
  const m = emptyPortalMonth();
  if (!d) return m;
  const sup = isObj(d.sup_details) ? d.sup_details : {};
  m.outTax = addTax(ptax(sup.osup_det), ptax(sup.osup_zero)); // 3.1(a) + 3.1(b)
  m.rcm = pval(sup.isup_rev); // 3.1(d)

  const elg = isObj(d.itc_elg) ? d.itc_elg : {};
  const avl = Array.isArray(elg.itc_avl) ? (elg.itc_avl as AnyObj[]) : [];
  const rev = Array.isArray(elg.itc_rev) ? (elg.itc_rev as AnyObj[]) : [];
  const inelg = Array.isArray(elg.itc_inelg) ? (elg.itc_inelg as AnyObj[]) : [];
  const byTy = (list: AnyObj[], ty: string) => addTax(...list.filter((r) => String(r.ty).toUpperCase() === ty).map(ptax));

  const impg = byTy(avl, 'IMPG');
  const isd = byTy(avl, 'ISD');
  const oth = byTy(avl, 'OTH');
  const rul = byTy(rev, 'RUL');
  const othRev = byTy(rev, 'OTH');
  m.itc4a5 = oth;
  m.itc4b1 = rul;
  m.itc4b2 = othRev;
  m.itc4d = addTax(...inelg.map(ptax));
  m.itc4aTotal = addTax(...avl.map(ptax));
  // D&T-INPUT "AS PER 3B" excludes RCM (4A(2) IMPS, 4A(3) ISRC): 4A(1) + 4A(4) + 4A(5) − 4B(1) − 4B(2).
  m.itcExclRcm = subTax(addTax(impg, isd, oth), rul, othRev);
  return m;
}

// ---------------------------------------------------------------------------
// FY ↔ portal period helpers
// ---------------------------------------------------------------------------

/** FY "2024-25" → ["04/2024", …, "03/2025"] (the MM/YYYY the extension keys gst_filed_returns by). */
export const periodsForFY = (financialYear: string): string[] => {
  const start = Number(financialYear.slice(0, 4));
  return FY_MONTHS.map((_, k) => {
    const month = ((k + 3) % 12) + 1;
    const year = k < 9 ? start : start + 1;
    return `${String(month).padStart(2, '0')}/${year}`;
  });
};

export const monthKeyForPeriod = (period: string, financialYear: string): MonthKey | null => {
  const idx = periodsForFY(financialYear).indexOf(period);
  return idx >= 0 ? FY_MONTHS[idx] : null;
};

// ---------------------------------------------------------------------------
// Import preview: flatten to field paths, compare, apply
// ---------------------------------------------------------------------------

export interface ImportChange {
  path: string;
  label: string;
  current: number;
  incoming: number;
  /** The current value was typed by hand (PortalDoc.manual). */
  manual: boolean;
}

const HEAD_LABEL: Record<string, string> = { t: 'Value', i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess' };

function flatten(obj: unknown, prefix: string, out: Record<string, number>) {
  if (typeof obj === 'number') { out[prefix] = obj; return; }
  if (!isObj(obj)) return;
  Object.entries(obj).forEach(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k, out));
}

export const getPath = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), obj);

export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const clone = (o: unknown) => (isObj(o) ? { ...o } : {});
  const root = clone(obj) as AnyObj;
  let cur = root;
  keys.forEach((k, idx) => {
    if (idx === keys.length - 1) { cur[k] = value; return; }
    cur[k] = clone(cur[k]);
    cur = cur[k] as AnyObj;
  });
  return root as T;
}

/**
 * Every numeric field that would change if `incoming` (a partial PortalDoc,
 * e.g. { gstr9 } or { months: { apr } }) were applied. Unchanged fields are
 * left out; a typed (manual) current value is flagged so the preview can
 * leave it alone unless the user ticks it.
 */
export function diffPortalImport(current: PortalDoc, incoming: Partial<PortalDoc>, labelFor: (path: string) => string): ImportChange[] {
  const flat: Record<string, number> = {};
  flatten(incoming, '', flat);
  return Object.entries(flat)
    .filter(([path]) => !path.startsWith('manual.') && !path.includes('Meta.'))
    .map(([path, incomingValue]) => ({
      path,
      label: labelFor(path),
      current: pnum(getPath(current, path)),
      incoming: incomingValue,
      manual: !!current.manual[path],
    }))
    .filter((c) => Math.abs(c.current - c.incoming) > 0.004);
}

export function applyPortalImport(current: PortalDoc, changes: ImportChange[]): PortalDoc {
  let next = current;
  const manual = { ...current.manual };
  changes.forEach((c) => {
    next = setPath(next, c.path, c.incoming);
    delete manual[c.path];
  });
  return { ...next, manual };
}

/** Human label for a portal field path, e.g. "gstr9.table4.b2b.c" → "Table 4B · CGST". */
export function portalPathLabel(path: string): string {
  const parts = path.split('.');
  const head = HEAD_LABEL[parts[parts.length - 1]] ?? parts[parts.length - 1];
  if (parts[0] === 'months') {
    const q: Record<string, string> = {
      outTax: 'Output tax 3.1(a)+(b)', itcExclRcm: 'ITC excl. RCM', rcm: 'RCM 3.1(d)', itc4a5: '4A(5)',
      itc4b1: '4B(1)', itc4b2: '4B(2)', itc4d: '4D', itc4aTotal: '4A total',
    };
    return `${parts[1].toUpperCase()} · ${q[parts[2]] ?? parts[2]} · ${head}`;
  }
  if (parts[1] === 'table4') return `Table 4 ${parts[2]} · ${head}`;
  if (parts[1] === 'table5') return `Table 5 ${parts[2]} · Value`;
  if (parts[1] === 't6A') return `6A · ${head}`;
  if (parts[1] === 't6G') return `6G (ISD) · ${head}`;
  if (parts[1] === 't8A') return `8A · ${head}`;
  if (parts[1] === 'table9') return `Table 9 ${parts[2]} · ${parts[3]}`;
  return path;
}
