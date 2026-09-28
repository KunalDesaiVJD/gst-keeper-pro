// The Annual Return computation engine — one pure function from the stored
// docs to every figure the firm's MASTER_PMS.xlsx computes, sheet by sheet,
// per tax head (IGST / CGST / SGST / Cess). No I/O: the UI, the exports and
// the golden test (scripts/verify-gstr9-engine.mjs) all call computeWorkings().
//
// Cell references in comments ("PL-INPUT E79") point at the firm's workbook.
// Where this engine deliberately departs from the workbook, the comment says
// "POSITION" and docs/GSTR9_9C_WORKINGS.md §6 records why.

import {
  AnnualReturnDocs,
  ExpenseHead,
  FY_MONTHS,
  GSTR9C_T5_KEYS,
  GSTR9C_T5_SUB,
  GSTR9C_T9_OTHER_KEYS,
  GSTR9C_T9_RATE_KEYS,
  Gstr9cT9RateKey,
  InputSection,
  Justification,
  MonthKey,
  NonTaxNature,
  OutwardCategory,
  PortalMonth,
  PurchaseRow,
  RateWiseRow,
  RcmCategory,
  RcmCell,
  RcmItcTable,
  SalesRow,
  T4Key,
  TABLE9_HEADS,
  Table9Head,
  Tax,
  TaxIn,
  ValTax,
  WorkspaceContext,
} from './types';

// ---------------------------------------------------------------------------
// Arithmetic helpers
// ---------------------------------------------------------------------------

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const tax = (i = 0, c = 0, s = 0, x = 0): Tax => ({ i, c, s, x });
export const val = (t = 0, i = 0, c = 0, s = 0, x = 0): ValTax => ({ t, i, c, s, x });
export const ZT: Tax = Object.freeze(tax()) as Tax;
export const ZV: ValTax = Object.freeze(val()) as ValTax;

/** Resolve a typed cell: SGST null → mirrors CGST. */
export const tin = (t: Partial<TaxIn> | null | undefined): Tax => {
  if (!t) return tax();
  const c = num(t.c);
  return tax(num(t.i), c, t.s === null || t.s === undefined ? c : num(t.s), num(t.x));
};

export const addT = (...xs: Tax[]): Tax =>
  xs.reduce((a, b) => tax(a.i + num(b.i), a.c + num(b.c), a.s + num(b.s), a.x + num(b.x)), tax());
export const subT = (a: Tax, ...bs: Tax[]): Tax =>
  bs.reduce((acc, b) => tax(acc.i - num(b.i), acc.c - num(b.c), acc.s - num(b.s), acc.x - num(b.x)), tax(a.i, a.c, a.s, a.x));
export const negT = (a: Tax): Tax => tax(-a.i, -a.c, -a.s, -a.x);
export const mapT = (a: Tax, f: (v: number) => number): Tax => tax(f(a.i), f(a.c), f(a.s), f(a.x));
export const maxT0 = (a: Tax): Tax => mapT(a, (v) => Math.max(v, 0));
export const minT0 = (a: Tax): Tax => mapT(a, (v) => Math.min(v, 0));
export const totalTax = (a: Tax): number => a.i + a.c + a.s + a.x;

export const addV = (...xs: ValTax[]): ValTax =>
  xs.reduce((a, b) => val(a.t + num(b.t), a.i + num(b.i), a.c + num(b.c), a.s + num(b.s), a.x + num(b.x)), val());
export const subV = (a: ValTax, ...bs: ValTax[]): ValTax =>
  bs.reduce(
    (acc, b) => val(acc.t - num(b.t), acc.i - num(b.i), acc.c - num(b.c), acc.s - num(b.s), acc.x - num(b.x)),
    val(a.t, a.i, a.c, a.s, a.x),
  );
export const negV = (a: ValTax): ValTax => val(-a.t, -a.i, -a.c, -a.s, -a.x);
export const withT = (t: number, a: Tax): ValTax => val(t, a.i, a.c, a.s, a.x);
export const taxOf = (a: ValTax): Tax => tax(a.i, a.c, a.s, a.x);

const isNonZeroT = (a: Tax, eps = 0.005) => Math.abs(a.i) > eps || Math.abs(a.c) > eps || Math.abs(a.s) > eps || Math.abs(a.x) > eps;
const isNonZeroV = (a: ValTax, eps = 0.005) => Math.abs(a.t) > eps || isNonZeroT(a, eps);

/** Largest absolute per-head difference (taxable value included when asked). */
export const maxAbs = (d: ValTax | Tax, withTaxable = false): number => {
  const heads = [Math.abs(d.i), Math.abs(d.c), Math.abs(d.s), Math.abs(d.x)];
  if (withTaxable && 't' in d) heads.push(Math.abs((d as ValTax).t));
  return Math.max(...heads);
};

const byMonth = <T,>(f: (m: MonthKey) => T): Record<MonthKey, T> =>
  Object.fromEntries(FY_MONTHS.map((m) => [m, f(m)])) as Record<MonthKey, T>;
const sumMonths = (rec: Record<MonthKey, Tax>): Tax => addT(...FY_MONTHS.map((m) => rec[m]));
const sumMonthsV = (rec: Record<MonthKey, ValTax>): ValTax => addV(...FY_MONTHS.map((m) => rec[m]));

// ---------------------------------------------------------------------------
// Row helpers shared by the grids
// ---------------------------------------------------------------------------

export const rowTax = (r: { igst: number; cgst: number; sgst: number | null; cess: number }): Tax =>
  tin({ i: r.igst, c: r.cgst, s: r.sgst, x: r.cess });

/** PL-OUTPUT H / PL-INPUT H: (IGST+CGST+SGST)×100 / value. Cess is not part of the rate. */
export const impliedRate = (taxable: number, t: Tax): number | null => {
  if (!taxable) return null;
  return ((t.i + t.c + t.s) * 100) / taxable;
};

/** Rate check tolerance: 0.05 percentage points (covers paisa rounding on real ledgers). */
export const RATE_TOLERANCE = 0.05;
export const rateMismatch = (rate: number | null, implied: number | null): boolean =>
  rate !== null && implied !== null && Math.abs(Math.abs(implied) - rate) > RATE_TOLERANCE;

/** A sales-return / debit-note row: negative value (sheet note PL-OUTPUT B35), or zero value with negative tax. */
export const isReturnRow = (taxable: number, t: Tax): boolean => taxable < 0 || (taxable === 0 && t.i + t.c + t.s + t.x < 0);

export const DEFAULT_HEAD: Record<InputSection, ExpenseHead> = {
  purchase: 'purchases',
  expense: 'other2',
  capital_goods: 'capital_goods',
};
export const resolveHead = (r: Pick<PurchaseRow, 'head' | 'section'>): ExpenseHead => r.head ?? DEFAULT_HEAD[r.section];

/** RCM Part B cell: tax from the category rate unless typed (RCM F52 `=D52*2.5%`, G52 `=+F52`). */
export const rcmCellTax = (cat: Pick<RcmCategory, 'rate' | 'supplyType'>, cell: RcmCell | undefined): ValTax => {
  const taxable = num(cell?.taxable);
  const rate = num(cat.rate) / 100;
  const auto = (v: number | null | undefined, computed: number) => (v === null || v === undefined ? computed : num(v));
  if (cat.supplyType === 'inter') {
    const i = auto(cell?.i, taxable * rate);
    const c = auto(cell?.c, 0);
    return val(taxable, i, c, auto(cell?.s, c), auto(cell?.x, 0));
  }
  const c = auto(cell?.c, (taxable * rate) / 2);
  return val(taxable, auto(cell?.i, 0), c, auto(cell?.s, c), auto(cell?.x, 0));
};

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export type StepKey =
  | 'overview'
  | 'portal'
  | 'sales'
  | 'purchases'
  | 'duties'
  | 'rcm'
  | 'outward'
  | 'itc'
  | 'expense'
  | 'annexures'
  | 'gstr9'
  | 'gstr9c'
  | 'notice'
  | 'review';

export interface DiffLine {
  /** Stable key — justifications are stored against it. */
  key: string;
  step: StepKey;
  label: string;
  /** Left side (books / as per P&L / as per report …). */
  a: ValTax;
  /** Right side (portal / 3B / GSTR-9 …). */
  b: ValTax;
  /** a − b, per head. */
  diff: ValTax;
  /** How the difference is read on screen, e.g. "Books − 3B". */
  direction: string;
  aLabel: string;
  bLabel: string;
  /** Whether the taxable-value column is meaningful for this line. */
  hasTaxable: boolean;
  /** Whether the tax heads are meaningful for this line. */
  hasTax: boolean;
  /** Informational lines are shown but never block the lock. */
  informational: boolean;
  /** |diff| on some head exceeds tolerance and the line isn't informational. */
  requiresReason: boolean;
  justification: Justification | null;
  /** A justification exists but the difference has since moved by more than tolerance. */
  stale: boolean;
  /** requiresReason && (no justification || stale). */
  open: boolean;
}

export interface SalesRowCalc {
  id: string;
  tax: Tax;
  impliedRate: number | null;
  rateMismatch: boolean;
  isReturn: boolean;
}

export interface PurchaseRowCalc {
  id: string;
  tax: Tax;
  impliedRate: number | null;
  rateMismatch: boolean;
  head: ExpenseHead;
}

export interface DtoMonthCalc {
  sales: Tax;
  cn: Tax;
  net: Tax;
  asPer3B: Tax;
  diff: Tax;
}

export interface DtiMonthCalc {
  purchase: Tax;
  dn: Tax;
  sr: Tax;
  sr180: Tax;
  rc: Tax;
  rc180: Tax;
  /** Suspended ITC net for the month: I + L − O − R. */
  suspNet: Tax;
  net: Tax;
  asPer3B: Tax;
  diff: Tax;
}

export type Table7Key = 'A' | 'A1' | 'A2' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export interface Table9Calc {
  payable: number;
  payableSource: 'override' | 'portal' | '4N';
  cash: number;
  itcI: number;
  itcC: number;
  itcS: number;
  itcX: number;
  paid: number;
  diff: number;
}

export interface Workings {
  ctx: WorkspaceContext;
  tolerance: number;

  sales: {
    rows: Record<string, SalesRowCalc>;
    partA: ValTax; // PL-OUTPUT D33:G33
    partATaxable: number;
    partBTotal: number; // D50
    partBByNature: Record<NonTaxNature, { pos: number; neg: number }>;
    total: number; // D52
    auditReportTotal: number | null; // D54
    auditDiff: number | null; // D56 = D54 − D52
    byRate: Record<string, ValTax>; // for GSTR-9C Table 9
  };

  purchases: {
    rows: Record<string, PurchaseRowCalc>;
    sections: Record<InputSection, ValTax>; // rows 30 / 58 / 69
    totalPl: ValTax; // row 71
    suspended: Tax; // row 73
    otherAdj: Tax; // row 75
    rcmCredit: ValTax; // row 77
    netItc: ValTax; // row 79
    dtNet: Tax; // row 80 (= D&T-INPUT U26)
    diffVsDt: Tax; // row 81
  };

  dto: {
    months: Record<MonthKey, DtoMonthCalc>;
    totals: DtoMonthCalc; // row 20
    adjustments: Tax; // row 28
    totalCrSide: Tax; // row 30
    asPerPl: Tax; // I22:K22
    plDiff: Tax; // I24:K24 = P&L − D&T net
  };

  dti: {
    lye: Tax; // row 9
    months: Record<MonthKey, DtiMonthCalc>;
    totals: DtiMonthCalc; // row 22 (net includes LYE, as U22 = SUM(U9:U21))
    rcmBooks: Tax; // U23
    rcmPortal: Tax; // X23
    rcmDiff: Tax; // AA23
    totalItcBooks: Tax; // U24
    totalItcPortal: Tax; // X24
    totalItcDiff: Tax; // AA24
    net: Tax; // U26 = U24 − LYE
    asPerPl: Tax; // U28
    plDiff: Tax; // U29 = U28 − U26
    adjustments: Tax; // row 34
    totalDr: Tax; // row 36
    suspendedNet: Tax; // I+L−O−R (PL-INPUT row 73)
    reversals: Tax; // I+L (GSTR-9 7H1)
    reclaims: Tax; // O+R (GSTR-9 6H)
  };

  rcm: {
    categories: Record<string, { months: Record<MonthKey, ValTax>; total: ValTax }>;
    partBMonths: Record<MonthKey, ValTax>;
    partB: ValTax; // RCM D41:G41
    partAMonths: Record<MonthKey, ValTax>;
    partA: ValTax; // RCM D22:G22
    partASource: 'monthly' | 'gstr9' | 'none';
    diffMonths: Record<MonthKey, ValTax>; // books − portal
    diff: ValTax;
    byItcTable: Record<RcmItcTable, ValTax>;
  };

  /** GSTR 9-OUTPUT — books (A) vs GSTR-9 auto-populated (B). */
  outward: {
    rows: Array<{ key: string; label: string; table: string; books: ValTax; portal: ValTax; diff: ValTax; subtract: boolean }>;
    booksTotal: ValTax;
    portalTotal: ValTax;
    diffTotal: ValTax;
  };

  /** GSTR 9-INPUT — ITC working for GSTR-9. */
  itc: {
    inputs: ValTax; // row 9
    inputServices: ValTax; // row 10 (tax = balancing figure)
    inputServicesBooks: Tax; // books ITC of the same ledgers (the figure the plug hides)
    importGoods: ValTax; // row 11
    capitalGoods: ValTax; // row 12
    rcm: ValTax; // row 13
    reclaim: Tax; // row 14
    isd: Tax;
    t6N: Tax;
    asPer3B: Tax; // row 16 = 6A2
    total: ValTax; // row 18 (= 6O)
    reversal7H1: Tax; // row 20
    s17_5: Tax; // row 21
    otherReversals: Tax; // rest of Table 7
    total7J: Tax; // row 23
    asPerBook: Tax; // row 25 (POSITION: D&T-INPUT U26, net of Last Year Effect)
    residual: Tax; // 7J − book
    t12Suggested: Tax; // row 27 MAX(…,0)
    t13Suggested: Tax; // −row 28
  };

  /** The firm's "GSTR 9C" sheet — ITC by expense head (GSTR-9C Table 14). */
  c14: {
    rows: Record<string, ValTax>; // A, A1, A2, B..Q, R
    qTagged: ValTax;
    qBalancing: ValTax;
    check: ValTax; // PL NET ITC − R (row 30) — 0 by construction
    S: Tax; // ITC claimed in GSTR-9 (7J)
    T: Tax; // R − S
  };

  g9: {
    t4: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'G1' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N', ValTax>;
    t4Source: 'portal' | 'none';
    t5: Record<'A' | 'B' | 'C' | 'C1' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N', ValTax>;
    t5Portal: Record<string, number>;
    /** Portal Table 5 sub-totals (5G, 5L, 5M) built from the auto-populated rows. */
    t5PortalTotals: { G: number; L: number; M: number };
    /** 8D not yet explained by 8E + 8F. */
    t8Unsplit: Tax;
    t6: Record<
      | 'A' | 'A1' | 'A2'
      | 'B_ip' | 'B_cg' | 'B_is'
      | 'C_ip' | 'C_cg' | 'C_is'
      | 'D_ip' | 'D_cg' | 'D_is'
      | 'E_ip' | 'E_cg'
      | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O',
      Tax
    >;
    t6ASource: 'gstr9' | 'monthly_3b' | 'none';
    t7: Record<Table7Key, Tax>;
    t7H: Array<{ id: string; description: string; tax: Tax; computed: boolean }>;
    t7I: Tax;
    /** 7E as the as-filed GSTR-3B 4B(1) gives it — what "use as-filed 3B" reverts to. */
    t7EPortal: Tax;
    t7J: Tax;
    t8: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'H1' | 'I' | 'J' | 'K', Tax>;
    t9: Record<Table9Head, Table9Calc>;
    t9Other: Record<'interest' | 'lateFee' | 'penalty' | 'other', { payable: number; cash: number; diff: number }>;
    t10: ValTax;
    t11: ValTax;
    t12: Tax;
    t12Source: 'computed' | 'override';
    t13: Tax;
    totalTurnover: ValTax; // 5N + 10 − 11
  };

  ann1: {
    A: ValTax;
    nonGst: number;
    B: ValTax;
    C: ValTax;
    D: ValTax;
    E: ValTax;
    F: ValTax;
    G: ValTax;
    payable: Tax;
    paid: Tax;
    payDiff: Tax;
  };

  ann2: Record<'A' | 'A1' | 'A2' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G1' | 'G2' | 'H' | 'I' | 'J', Tax>;

  ann3: {
    clause9: Tax;
    rcmToPay: Tax;
    rcmToPaySuggested: Tax;
    excessItc: Tax;
    excessItcSuggested: Tax;
    other: Tax;
    total: Tax; // signed, as the Excel's D46
    payable: Tax; // MAX(total, 0) per head
    excessPaid: Tax; // MIN(total, 0) per head, shown positive
    alreadyPaid: Tax;
    balance: Tax; // MAX(payable − already paid, 0)
  };

  gstr9c: {
    t5: { A: number; P: number; Q: number; R: number; rows: Record<string, number> };
    t7: { A: number; B: number; C: number; D: number; D1: number; E: number; F: number; G: number };
    t9: {
      rows: Record<string, RateWiseRow>;
      /** true = the row is not overridden (shows the books figure, or 0 when books have none). */
      derived: Record<string, boolean>;
      /** Where a rate row's figure comes from. */
      source: Record<string, 'sales' | 'rcm' | 'sales+rcm' | 'none' | 'typed'>;
      P: RateWiseRow;
      Q: Tax;
      R: Tax;
    };
    t12: { A: Tax; B: Tax; C: Tax; D: Tax; E: Tax; F: Tax };
    t14: { rows: Record<string, ValTax>; R: ValTax; S: Tax; T: Tax };
    /** The computed value of every "computed unless typed" 9C cell, whether or not it is overridden. */
    defaults: {
      t5A: number;
      t5Q: number;
      t7: { B: number; C: number; D: number; D1: number; F: number };
      t9: Record<string, RateWiseRow>;
      t9Q: Tax;
      t12: { A: Tax; B: Tax; C: Tax };
    };
  };

  notice: {
    outward: Record<'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' | 'r8' | 'r9' | 'r10' | 'r11', Tax>;
    inward: Record<'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' | 'r8' | 'r9', Tax>;
  };

  diffs: DiffLine[];
  openCount: number;
  stepOpen: Record<StepKey, number>;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const MONTH_LABEL: Record<MonthKey, string> = {
  apr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul', aug: 'Aug', sep: 'Sep',
  oct: 'Oct', nov: 'Nov', dec: 'Dec', jan: 'Jan', feb: 'Feb', mar: 'Mar',
};

export const EXPENSE_HEAD_LABEL: Record<ExpenseHead, string> = {
  purchases: 'A · Purchases',
  freight: 'B · Freight / carriage',
  power_fuel: 'C · Power and fuel',
  imported_goods: 'D · Imported goods (incl. from SEZ)',
  rent_insurance: 'E · Rent and insurance',
  goods_lost: 'F · Goods lost, stolen, destroyed, gifted',
  royalty: 'G · Royalty',
  employees_cost: "H · Employees' cost",
  conveyance: 'I · Conveyance charges',
  bank_charges: 'J · Bank charges',
  entertainment: 'K · Entertainment charges',
  stationery: 'L · Stationery (incl. postage)',
  repair_maintenance: 'M · Repair and maintenance',
  other_misc: 'N · Other miscellaneous expenses',
  capital_goods: 'O · Capital goods',
  other2: 'Q · Any other expense 2',
};

/** 9C Table 14 row letter of each head (P is RCM, R total). */
export const EXPENSE_HEAD_ROW: Record<ExpenseHead, string> = {
  purchases: 'A', freight: 'B', power_fuel: 'C', imported_goods: 'D', rent_insurance: 'E', goods_lost: 'F',
  royalty: 'G', employees_cost: 'H', conveyance: 'I', bank_charges: 'J', entertainment: 'K', stationery: 'L',
  repair_maintenance: 'M', other_misc: 'N', capital_goods: 'O', other2: 'Q',
};

export const OUTWARD_CATEGORY_LABEL: Record<OutwardCategory, string> = {
  b2b: 'B2B (4B)',
  b2c: 'B2C (4A)',
  exp_wp: 'Export with tax (4C)',
  sez_wp: 'SEZ with tax (4D)',
  deemed: 'Deemed export (4E)',
};

export const NON_TAX_NATURE_LABEL: Record<NonTaxNature, string> = {
  export_wo: 'Export without tax (5A)',
  sez_wo: 'SEZ without tax (5B)',
  rcm_outward: 'Reverse charge — recipient pays (5C)',
  ecom_95: 'E-commerce operator pays u/s 9(5) (5C1)',
  exempt: 'Exempted (5D)',
  nil: 'Nil rated (5E)',
  non_gst: 'Non-GST / no supply (5F)',
  not_in_gstr9: 'Not reportable in GSTR-9',
};

// ---------------------------------------------------------------------------
// The computation
// ---------------------------------------------------------------------------

const portalMonthPresent = (docs: AnnualReturnDocs, m: MonthKey): boolean => {
  const pm: PortalMonth = docs.portal.months[m];
  const meta = docs.portal.monthMeta[m];
  return (
    !!meta?.source ||
    isNonZeroT(pm.outTax) ||
    isNonZeroT(pm.itcExclRcm) ||
    isNonZeroV(pm.rcm) ||
    isNonZeroT(pm.itc4aTotal)
  );
};

export const gstr9PortalPresent = (docs: AnnualReturnDocs): boolean => {
  const g = docs.portal.gstr9;
  if (docs.portal.gstr9Meta?.source) return true;
  return (
    Object.values(g.table4).some((v) => isNonZeroV(v)) ||
    isNonZeroT(g.t6A) ||
    isNonZeroT(g.t8A) ||
    TABLE9_HEADS.some((h) => g.table9[h].payable || g.table9[h].cash || g.table9[h].itcI || g.table9[h].itcC || g.table9[h].itcS)
  );
};

export function computeWorkings(docs: AnnualReturnDocs, ctx: WorkspaceContext): Workings {
  const tol = Math.max(0, num(docs.settings.tolerance));
  const P = docs.portal;
  const monthsPresent = byMonth((m) => portalMonthPresent(docs, m));
  // Per side: a pulled/filed 3B counts for every figure in the month (a filed zero is a real zero);
  // a hand-typed month only for the figures actually typed or non-zero on that side.
  const sidePresent = (m: MonthKey, field: 'outTax' | 'itcExclRcm'): boolean => {
    const src = P.monthMeta[m]?.source;
    if (src && src !== 'manual') return true;
    if (isNonZeroT(P.months[m][field])) return true;
    const prefix = `months.${m}.${field}.`;
    return Object.keys(P.manual || {}).some((k) => k.startsWith(prefix));
  };
  const outPresent = byMonth((m) => sidePresent(m, 'outTax'));
  const itcPresent = byMonth((m) => sidePresent(m, 'itcExclRcm'));
  const anyMonthPresent = FY_MONTHS.some((m) => monthsPresent[m]);
  const gstr9Present = gstr9PortalPresent(docs);

  // ------------------------------------------------------------ Sales (PL-OUTPUT)
  const salesRows: Record<string, SalesRowCalc> = {};
  let partA = val();
  const byRate: Record<string, ValTax> = {};
  const outwardBooks: Record<OutwardCategory | 'cr_nt', ValTax> = {
    b2b: val(), b2c: val(), exp_wp: val(), sez_wp: val(), deemed: val(), cr_nt: val(),
  };
  docs.sales.partA.forEach((r: SalesRow) => {
    const t = rowTax(r);
    const taxable = num(r.taxable);
    const implied = impliedRate(taxable, t);
    const ret = isReturnRow(taxable, t);
    salesRows[r.id] = { id: r.id, tax: t, impliedRate: implied, rateMismatch: rateMismatch(r.rate, implied), isReturn: ret };
    const v = withT(taxable, t);
    partA = addV(partA, v);
    if (ret) outwardBooks.cr_nt = addV(outwardBooks.cr_nt, negV(v));
    else outwardBooks[r.category] = addV(outwardBooks[r.category], v);
    // GSTR-9C Table 9 is rate-wise tax actually payable: net of returns, keyed by rate.
    const rateKey = r.rate !== null && r.rate !== undefined ? String(num(r.rate)) : snapRate(implied);
    byRate[rateKey] = addV(byRate[rateKey] || val(), v);
  });

  const natures: NonTaxNature[] = ['export_wo', 'sez_wo', 'rcm_outward', 'ecom_95', 'exempt', 'nil', 'non_gst', 'not_in_gstr9'];
  const partBByNature = Object.fromEntries(natures.map((k) => [k, { pos: 0, neg: 0 }])) as Record<NonTaxNature, { pos: number; neg: number }>;
  let partBTotal = 0;
  docs.sales.partB.forEach((r) => {
    const a = num(r.amount);
    partBTotal += a;
    const bucket = partBByNature[r.nature] || partBByNature.non_gst;
    if (a < 0) bucket.neg += a;
    else bucket.pos += a;
  });
  const salesTotal = partA.t + partBTotal; // D52
  const auditReportTotal = docs.sales.auditReportTotal === null || docs.sales.auditReportTotal === undefined ? null : num(docs.sales.auditReportTotal);
  const auditDiff = auditReportTotal === null ? null : auditReportTotal - salesTotal; // D56 = D54 − D52

  // ------------------------------------------------------------ Duties & Taxes — Input (needed by PL-INPUT row 73)
  const DI = docs.duties_input;
  const dtiMonths = byMonth<DtiMonthCalc>((m) => {
    const mm = DI.months[m];
    const purchase = tin(mm.purchase);
    const dn = tin(mm.debitNote);
    const sr = tin(mm.suspRev);
    const sr180 = tin(mm.suspRev180);
    const rc = tin(mm.suspReclaim);
    const rc180 = tin(mm.suspReclaim180);
    const net = addT(subT(purchase, dn, sr, sr180), rc, rc180); // U = C − F − I − L + O + R
    const asPer3B = P.months[m].itcExclRcm;
    return { purchase, dn, sr, sr180, rc, rc180, suspNet: subT(addT(sr, sr180), rc, rc180), net, asPer3B, diff: subT(net, asPer3B) };
  });
  const lye = tin(DI.lastYearEffect);
  const dtiSum = (k: keyof DtiMonthCalc) => sumMonths(byMonth((m) => dtiMonths[m][k]));
  const dtiNetMonths = dtiSum('net');
  const dtiTotals: DtiMonthCalc = {
    purchase: dtiSum('purchase'),
    dn: dtiSum('dn'),
    sr: dtiSum('sr'),
    sr180: dtiSum('sr180'),
    rc: dtiSum('rc'),
    rc180: dtiSum('rc180'),
    suspNet: dtiSum('suspNet'),
    net: addT(dtiNetMonths, lye), // U22 = SUM(U9:U21)
    asPer3B: dtiSum('asPer3B'), // X22 (X9 is blank)
    diff: tax(),
  };
  dtiTotals.diff = subT(dtiTotals.net, dtiTotals.asPer3B); // AA22 = U22 − X22
  const suspendedNet = subT(addT(dtiTotals.sr, dtiTotals.sr180), dtiTotals.rc, dtiTotals.rc180); // I+L−O−R
  const reversals = addT(dtiTotals.sr, dtiTotals.sr180);
  const reclaims = addT(dtiTotals.rc, dtiTotals.rc180);

  // ------------------------------------------------------------ RCM
  const rcmCats: Workings['rcm']['categories'] = {};
  const byItcTable: Record<RcmItcTable, ValTax> = { '6C': val(), '6D': val(), '6F': val() };
  docs.rcm.categories.forEach((cat) => {
    const months = byMonth((m) => rcmCellTax(cat, cat.months?.[m]));
    const total = sumMonthsV(months);
    rcmCats[cat.id] = { months, total };
    const tbl = cat.itcTable || '6C';
    byItcTable[tbl] = addV(byItcTable[tbl], total);
  });
  const partBMonths = byMonth((m) => addV(...Object.values(rcmCats).map((c) => c.months[m])));
  const rcmPartB = sumMonthsV(partBMonths); // RCM D41:G41 — POSITION: all blocks (the sheet's D28:D39 adds only two)
  const rcmMonthlyPresent = FY_MONTHS.some((m) => monthsPresent[m] && (isNonZeroV(P.months[m].rcm) || !!P.monthMeta[m]?.source));
  let partASource: Workings['rcm']['partASource'] = 'none';
  let partAMonths = byMonth((m) => P.months[m].rcm);
  let rcmPartA = sumMonthsV(partAMonths);
  if (rcmMonthlyPresent) partASource = 'monthly';
  else if (gstr9Present && isNonZeroV(P.gstr9.table4.rchrg)) {
    partASource = 'gstr9';
    rcmPartA = P.gstr9.table4.rchrg;
    partAMonths = byMonth(() => val());
  }
  const rcmDiffMonths = byMonth((m) => subV(partBMonths[m], partAMonths[m]));
  const rcmDiff = subV(rcmPartB, rcmPartA);

  const dtiRcmBooks = taxOf(rcmPartB); // U23 = RCM!E41
  const dtiRcmPortal = taxOf(rcmPartA); // X23 = RCM!E22
  const totalItcBooks = addT(dtiTotals.net, dtiRcmBooks); // U24
  const totalItcPortal = addT(dtiTotals.asPer3B, dtiRcmPortal); // X24
  const dtiNet = subT(totalItcBooks, lye); // U26 = U24 − U25

  // ------------------------------------------------------------ Purchases (PL-INPUT)
  const purchaseRows: Record<string, PurchaseRowCalc> = {};
  const sections: Record<InputSection, ValTax> = { purchase: val(), expense: val(), capital_goods: val() };
  const byHead: Record<ExpenseHead, ValTax> = Object.fromEntries(
    (Object.keys(EXPENSE_HEAD_LABEL) as ExpenseHead[]).map((h) => [h, val()]),
  ) as Record<ExpenseHead, ValTax>;
  docs.purchases.rows.forEach((r) => {
    const t = rowTax(r);
    const taxable = num(r.taxable);
    const implied = impliedRate(taxable, t);
    const head = resolveHead(r);
    purchaseRows[r.id] = {
      id: r.id,
      tax: t,
      impliedRate: implied === null ? null : Math.round(implied * 100) / 100, // PL-INPUT H: ROUND(…,2)
      rateMismatch: rateMismatch(r.rate, implied),
      head,
    };
    const v = withT(taxable, t);
    sections[r.section] = addV(sections[r.section], v);
    byHead[head] = addV(byHead[head], v);
  });
  const totalPl = addV(sections.purchase, sections.expense, sections.capital_goods); // row 71
  const otherAdj = tin(docs.purchases.suspendedOtherAdj); // row 75
  // Row 79: value = D71 − D73 + D77 (D73 is 0: suspended ITC carries no value); tax = 71 − 73 + 77 − 75.
  const netItc = withT(totalPl.t + rcmPartB.t, addT(subT(taxOf(totalPl), suspendedNet, otherAdj), taxOf(rcmPartB)));
  const purchasesDiffVsDt = subT(taxOf(netItc), dtiNet); // row 81 = 79 − 80

  // ------------------------------------------------------------ Duties & Taxes — Output
  const DO = docs.duties_output;
  const dtoMonths = byMonth<DtoMonthCalc>((m) => {
    const sales = tin(DO.months[m].sales);
    const cn = tin(DO.months[m].creditNote);
    const net = subT(sales, cn); // I = C − F
    const asPer3B = P.months[m].outTax;
    return { sales, cn, net, asPer3B, diff: subT(net, asPer3B) }; // O = I − L
  });
  const dtoSum = (k: keyof DtoMonthCalc) => sumMonths(byMonth((m) => dtoMonths[m][k]));
  const dtoTotals: DtoMonthCalc = { sales: dtoSum('sales'), cn: dtoSum('cn'), net: dtoSum('net'), asPer3B: dtoSum('asPer3B'), diff: dtoSum('diff') };
  const dtoAdj = addT(...DO.adjustments.map((a) => tin(a)));
  const dtoAsPerPl = taxOf(partA); // I22 = PL-OUTPUT E33 (mapped by head, not column position)
  const dtoPlDiff = subT(dtoAsPerPl, dtoTotals.net); // I24 = I22 − I20
  const dtiAdj = addT(...DI.adjustments.map((a) => tin(a)));

  // ------------------------------------------------------------ GSTR-9 Table 4 (portal) and 9-OUTPUT
  const T4 = P.gstr9.table4;
  const g4 = {
    A: T4.b2c, B: T4.b2b, C: T4.exp, D: T4.sez, E: T4.deemed, F: T4.at,
    G: rcmPartA, // 4G = RCM!D22 (Part A)
    G1: T4.ecom,
    I: T4.cr_nt, J: T4.dr_nt, K: T4.amd_pos, L: T4.amd_neg,
  } as Record<string, ValTax>;
  g4.H = addV(g4.A, g4.B, g4.C, g4.D, g4.E, g4.F, g4.G, g4.G1);
  g4.M = subV(addV(g4.J, g4.K), g4.I, g4.L); // F20 = J + K − I − L
  g4.N = addV(g4.H, g4.M);

  const X = docs.gstr9.t4BooksExtra;
  const outwardRows: Workings['outward']['rows'] = [
    { key: 'b2c', label: 'B2C', table: '4A', books: outwardBooks.b2c, portal: T4.b2c, diff: val(), subtract: false },
    { key: 'b2b', label: 'B2B', table: '4B', books: outwardBooks.b2b, portal: T4.b2b, diff: val(), subtract: false },
    { key: 'exp', label: 'Exports with payment of tax', table: '4C', books: outwardBooks.exp_wp, portal: T4.exp, diff: val(), subtract: false },
    { key: 'sez', label: 'SEZ with payment of tax', table: '4D', books: outwardBooks.sez_wp, portal: T4.sez, diff: val(), subtract: false },
    { key: 'deemed', label: 'Deemed exports', table: '4E', books: outwardBooks.deemed, portal: T4.deemed, diff: val(), subtract: false },
    { key: 'at', label: 'Advances (tax paid, invoice not issued)', table: '4F', books: X.at, portal: T4.at, diff: val(), subtract: false },
    { key: 'ecom', label: 'E-commerce operator u/s 9(5)', table: '4G1', books: val(), portal: T4.ecom, diff: val(), subtract: false },
    { key: 'dr_nt', label: 'Debit notes', table: '4J', books: X.dr_nt, portal: T4.dr_nt, diff: val(), subtract: false },
    { key: 'amd', label: 'Net amendments (4K − 4L)', table: '4K−4L', books: subV(X.amd_pos, X.amd_neg), portal: subV(T4.amd_pos, T4.amd_neg), diff: val(), subtract: false },
    { key: 'cr_nt', label: 'Credit notes', table: '4I', books: outwardBooks.cr_nt, portal: T4.cr_nt, diff: val(), subtract: true },
  ];
  outwardRows.forEach((r) => { r.diff = subV(r.books, r.portal); });
  const signedSum = (pick: (r: (typeof outwardRows)[number]) => ValTax) =>
    outwardRows.reduce((acc, r) => (r.subtract ? subV(acc, pick(r)) : addV(acc, pick(r))), val());
  const outwardBooksTotal = signedSum((r) => r.books); // C17 = SUM(C9:C14) − C15
  const outwardPortalTotal = signedSum((r) => r.portal); // I17
  const outwardDiffTotal = subV(outwardBooksTotal, outwardPortalTotal); // D32

  // ------------------------------------------------------------ GSTR-9 Table 5 (books, PL-OUTPUT Part B)
  const pos = (k: NonTaxNature) => partBByNature[k].pos;
  const g5 = {} as Workings['g9']['t5'];
  g5.A = val(pos('export_wo')); // F24 = PL-OUTPUT D41
  g5.B = val(pos('sez_wo')); // F25 = D43
  g5.C = val(pos('rcm_outward'));
  g5.C1 = val(pos('ecom_95'));
  g5.D = val(pos('exempt'));
  g5.E = val(pos('nil'));
  g5.F = val(pos('non_gst')); // F30 = SUM(D44:D48)
  g5.G = addV(g5.A, g5.B, g5.C, g5.C1, g5.D, g5.E, g5.F);
  const t5Neg = natures.filter((k) => k !== 'not_in_gstr9').reduce((s, k) => s + partBByNature[k].neg, 0);
  g5.H = val(-t5Neg); // F32 = −D42 (credit notes, entered as negative rows)
  g5.I = val(num(docs.gstr9.t5Extra.dr_nt));
  g5.J = val(num(docs.gstr9.t5Extra.amd_pos));
  g5.K = val(num(docs.gstr9.t5Extra.amd_neg));
  g5.L = subV(addV(g5.I, g5.J), g5.H, g5.K); // F36 = I + J − H − K
  g5.M = addV(g5.G, g5.L); // F37
  g5.N = subV(addV(g4.N, g5.M), g4.G, g4.G1); // 5N = 4N + 5M − 4G − 4G1 (the sheet types F38)

  // ------------------------------------------------------------ GSTR-9 Table 6 / GSTR 9-INPUT
  const G = docs.gstr9;
  const monthly4A = sumMonths(byMonth((m) => P.months[m].itc4aTotal));
  let t6ASource: Workings['g9']['t6ASource'] = 'none';
  let t6A = tax();
  if (gstr9Present) { t6A = P.gstr9.t6A; t6ASource = 'gstr9'; }
  else if (anyMonthPresent && isNonZeroT(monthly4A)) { t6A = monthly4A; t6ASource = 'monthly_3b'; }
  const t6A1 = G.t6A1 === null || G.t6A1 === undefined ? lye : tin(G.t6A1); // POSITION: defaults to Last Year Effect
  const t6A2 = subT(t6A, t6A1);

  const inputs = byHead.purchases; // 9-INPUT row 9 = 9C row A
  const capitalGoods = byHead.capital_goods; // row 12 = 9C row O
  const importGoods = byHead.imported_goods; // row 11 = 9C row D
  const isd = G.t6G === null || G.t6G === undefined ? P.gstr9.t6G : tin(G.t6G);
  const rcmItc = taxOf(rcmPartB);
  const inputServicesTaxable = (Object.keys(byHead) as ExpenseHead[])
    .filter((h) => h !== 'purchases' && h !== 'capital_goods' && h !== 'imported_goods')
    .reduce((s, h) => s + byHead[h].t, 0);
  const inputServicesBooks = (Object.keys(byHead) as ExpenseHead[])
    .filter((h) => h !== 'purchases' && h !== 'capital_goods' && h !== 'imported_goods')
    .reduce((acc, h) => addT(acc, taxOf(byHead[h])), tax());
  // 9-INPUT D10 = D16 − D9 − D12 − D13 − D11 − D14: input services is the balancing figure, so 6O ties to 6A2.
  const inputServicesTax = subT(t6A2, taxOf(inputs), taxOf(capitalGoods), rcmItc, taxOf(importGoods), reclaims, isd);
  const inputServices = withT(inputServicesTaxable, inputServicesTax);

  const t6: Workings['g9']['t6'] = {
    A: t6A, A1: t6A1, A2: t6A2,
    B_ip: taxOf(inputs), B_cg: taxOf(capitalGoods), B_is: inputServicesTax,
    C_ip: tax(), C_cg: tax(), C_is: taxOf(byItcTable['6C']),
    D_ip: tax(), D_cg: tax(), D_is: taxOf(byItcTable['6D']),
    E_ip: taxOf(importGoods), E_cg: tax(),
    F: taxOf(byItcTable['6F']),
    G: isd,
    H: reclaims,
    I: tax(), J: tax(), K: tin(G.t6K), L: tin(G.t6L), M: tin(G.t6M), N: tax(), O: tax(),
  };
  t6.I = addT(t6.B_ip, t6.B_cg, t6.B_is, t6.C_ip, t6.C_cg, t6.C_is, t6.D_ip, t6.D_cg, t6.D_is, t6.E_ip, t6.E_cg, t6.F, t6.G, t6.H);
  t6.J = subT(t6.I, t6.A2);
  t6.N = addT(t6.K, t6.L, t6.M);
  t6.O = addT(t6.I, t6.N);

  // ------------------------------------------------------------ Table 7
  const monthly4B1 = sumMonths(byMonth((m) => P.months[m].itc4b1));
  const t7: Record<Table7Key, Tax> = {
    A: tin(G.t7.r37), A1: tin(G.t7.r37A), A2: tin(G.t7.r38), B: tin(G.t7.r39), C: tin(G.t7.r42), D: tin(G.t7.r43),
    E: G.t7.s17_5 === null || G.t7.s17_5 === undefined ? monthly4B1 : tin(G.t7.s17_5), // 9-INPUT E21 "AS PER 3B"
    F: tin(G.t7.tran1), G: tin(G.t7.tran2),
  };
  const t7H: Workings['g9']['t7H'] = [
    { id: 'h1', description: G.t7.otherDesc || 'Other reversal', tax: reversals, computed: true }, // 7H1 = 9-INPUT D20 = D&T I+L
    ...G.t7.otherExtra.map((o) => ({ id: o.id, description: o.description, tax: tin(o), computed: false })),
  ];
  const t7I = addT(...(Object.values(t7) as Tax[]), ...t7H.map((h) => h.tax));
  const t7J = subT(t6.O, t7I);

  // ------------------------------------------------------------ ITC reco (GSTR 9-INPUT) rows 25–28
  const asPerBook = dtiNet; // POSITION: U26 (net of Last Year Effect) — the sheet reads U24
  const residual = subT(t7J, asPerBook);
  const t12Suggested = maxT0(residual); // D27 = IF(D23 − D25 > 0, …, 0)
  const t13Suggested = negT(minT0(residual)); // −D28
  const t12 = G.t12 === null || G.t12 === undefined ? t12Suggested : tin(G.t12);
  const t13 = tin(G.t13);

  // ------------------------------------------------------------ Table 8
  const t8 = {} as Workings['g9']['t8'];
  t8.A = P.gstr9.t8A;
  t8.B = addT(t6.B_ip, t6.B_cg, t6.B_is, t6.H); // POSITION: 6(B) + 6(H) per the form; the sheet sums 6(B) only
  t8.C = subT(t13, t12); // G83 = G111 − G110
  t8.D = subT(t8.A, t8.B, t8.C);
  t8.E = tin(G.t8E);
  t8.F = tin(G.t8F);
  t8.G = tax(t6.E_ip.i, 0, 0, t6.E_ip.x); // I87 = I53
  t8.H = t8.G; // 8H = 8G
  t8.H1 = tin(G.t8H1);
  t8.I = subT(t8.G, t8.H, t8.H1);
  t8.J = t8.I;
  t8.K = addT(t8.E, t8.F, t8.J);
  const t8Unsplit = subT(t8.D, t8.E, t8.F);
  const T5P = P.gstr9.table5;
  const t5PG = num(T5P.zero_rtd) + num(T5P.sez) + num(T5P.rchrg) + num(T5P.ecom_14) + num(T5P.exmt) + num(T5P.nil) + num(T5P.non_gst);
  const t5PL = num(T5P.dr_nt) + num(T5P.amd_pos) - num(T5P.cr_nt) - num(T5P.amd_neg);
  const t5PortalTotals = { G: t5PG, L: t5PL, M: t5PG + t5PL };

  // ------------------------------------------------------------ Table 9
  const T9 = P.gstr9.table9;
  const g4NTax = taxOf(g4.N);
  const headOf: Record<Table9Head, keyof Tax> = { igst: 'i', cgst: 'c', sgst: 's', cess: 'x' };
  const t9 = {} as Workings['g9']['t9'];
  TABLE9_HEADS.forEach((h) => {
    const row = T9[h];
    const override = G.t9Payable?.[h];
    let payable: number;
    let payableSource: Table9Calc['payableSource'];
    if (override !== null && override !== undefined) { payable = num(override); payableSource = 'override'; }
    else if (gstr9Present && num(row.payable) !== 0) { payable = num(row.payable); payableSource = 'portal'; }
    else { payable = g4NTax[headOf[h]]; payableSource = '4N'; }
    const paid = num(row.cash) + num(row.itcI) + num(row.itcC) + num(row.itcS) + num(row.itcX);
    t9[h] = { payable, payableSource, cash: num(row.cash), itcI: num(row.itcI), itcC: num(row.itcC), itcS: num(row.itcS), itcX: num(row.itcX), paid, diff: payable - paid };
  });
  const t9Other = {} as Workings['g9']['t9Other'];
  (['interest', 'lateFee', 'penalty', 'other'] as const).forEach((k) => {
    const r = T9[k];
    t9Other[k] = { payable: num(r.payable), cash: num(r.cash), diff: num(r.payable) - num(r.cash) };
  });

  const t10 = G.t10;
  const t11 = G.t11;
  const totalTurnover = subV(addV(g5.N, t10), t11); // F112 = F38 + F108 − F109

  // ------------------------------------------------------------ 9C expense-head working (the firm's "GSTR 9C" sheet)
  const c14: Record<string, ValTax> = {};
  c14.A = byHead.purchases; // D8 = PL-INPUT D30 (purchase-section ledgers)
  c14.A1 = withT(0, suspendedNet); // D9 = 0, E9 = PL-INPUT E73
  c14.A2 = subV(c14.A, c14.A1);
  (['freight', 'power_fuel', 'imported_goods', 'rent_insurance', 'goods_lost', 'royalty', 'employees_cost', 'conveyance', 'bank_charges', 'entertainment', 'stationery', 'repair_maintenance', 'other_misc', 'capital_goods'] as ExpenseHead[])
    .forEach((h) => { c14[EXPENSE_HEAD_ROW[h]] = byHead[h]; });
  c14.P = rcmPartB; // D25 = PL-INPUT D77 = RCM Part B
  const qTagged = byHead.other2;
  const beforeQ = addV(c14.A2, ...['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'].map((k) => c14[k]));
  c14.Q = subV(netItc, beforeQ); // D26 = PL-INPUT D79 − SUM(D10:D25)
  const qBalancing = subV(c14.Q, qTagged);
  c14.R = addV(beforeQ, c14.Q); // D28
  const c14Check = subV(netItc, c14.R); // D30
  const c14S = t7J;
  const c14T = subT(taxOf(c14.R), c14S);

  // ------------------------------------------------------------ Annexure-1 (income reco)
  const A = docs.annexures;
  const ann1A = partA; // D8 = PL-OUTPUT D33
  const ann1NonGst = num(A.a1NonGstIncome); // D9
  const ann1B = A.a1SaleReturn; // D10
  const ann1C = subV(addV(ann1A, val(ann1NonGst)), ann1B); // D11 = D8 + D9 − D10
  const ann1D = rcmPartB; // D12 = RCM!D41
  const ann1E = addV(ann1C, ann1D); // D13
  const ann1F = addV(outwardPortalTotal, rcmPartA); // D14 = 'GSTR 9-OUTPUT'!I17 + RCM!D22
  const ann1G = subV(ann1E, ann1F); // D15
  const ann1Payable = taxOf(ann1E); // D19:D21 (POSITION: SGST from its own head; the sheet copies CGST)
  const ann1Paid = tax(t9.igst.paid, t9.cgst.paid, t9.sgst.paid, t9.cess.paid); // E19:E21 = GSTR-9 J97:J99
  const ann1PayDiff = subT(ann1Payable, ann1Paid); // F19:F21

  // ------------------------------------------------------------ Annexure-2 (ITC reco)
  const ann2 = {} as Workings['ann2'];
  ann2.A = dtiTotals.purchase; // D26 = D&T C22
  ann2.A1 = dtiRcmBooks; // D27 = D&T U23
  ann2.A2 = dtiTotals.dn; // D28 = D&T F22
  ann2.B = suspendedNet; // D29
  ann2.C = subT(addT(ann2.A, ann2.A1), ann2.A2, ann2.B); // D30
  ann2.D = residual; // D31 = 9-INPUT D27 + D28
  ann2.E = addT(ann2.C, ann2.D); // D32
  ann2.F = t6A; // D33 = GSTR-9 6A
  ann2.G1 = reversals; // D34 = 7H1
  ann2.G2 = subT(t7I, reversals); // POSITION: rest of Table 7 (7A–7G + other 7H lines) — the sheet leaves it out
  ann2.H = lye; // D35 = D&T U25
  ann2.I = subT(ann2.F, ann2.G1, ann2.G2, ann2.H); // D36
  ann2.J = subT(ann2.E, ann2.I); // D37

  // ------------------------------------------------------------ Annexure-3 (DRC-03)
  const rcmToPaySuggested = maxT0(taxOf(rcmDiff)); // books RCM liability not paid on the portal
  const rcmToPay = A.a3RcmToPay === null || A.a3RcmToPay === undefined ? rcmToPaySuggested : tin(A.a3RcmToPay);
  const excessItcSuggested = t12;
  const excessItc = A.a3ExcessItc === null || A.a3ExcessItc === undefined ? excessItcSuggested : tin(A.a3ExcessItc);
  const a3Other = addT(...A.a3Other.map((o) => tin(o)));
  const ann3Total = addT(ann1PayDiff, rcmToPay, excessItc, a3Other); // D46
  const ann3Payable = maxT0(ann3Total);
  const ann3Excess = negT(minT0(ann3Total));
  const alreadyPaid = tin(A.a3AlreadyPaid);

  // ------------------------------------------------------------ GSTR-9C official tables
  const C = docs.gstr9c;
  const t5ADefault = auditReportTotal ?? salesTotal;
  const t5A = C.t5A === null || C.t5A === undefined ? t5ADefault : num(C.t5A);
  const t5Rows: Record<string, number> = { A: t5A };
  GSTR9C_T5_KEYS.forEach((k) => { t5Rows[k] = num(C.t5[k]); });
  const t5P = GSTR9C_T5_KEYS.reduce((s, k) => s + (GSTR9C_T5_SUB.includes(k) ? -t5Rows[k] : t5Rows[k]), t5A);
  const t5Q = C.t5Q === null || C.t5Q === undefined ? totalTurnover.t : num(C.t5Q);
  const pick = (v: number | null | undefined, d: number) => (v === null || v === undefined ? d : num(v));
  const t7Default = {
    B: g5.D.t + g5.E.t + g5.F.t, // exempt + nil + non-GST
    C: g5.A.t + g5.B.t, // zero rated without tax
    D: g5.C.t, // recipient pays under RCM
    D1: g5.C1.t,
    F: g4.N.t - g4.G.t - g4.G1.t + t10.t - t11.t,
  };
  const c7 = {
    A: t5P,
    B: pick(C.t7.B, t7Default.B),
    C: pick(C.t7.C, t7Default.C),
    D: pick(C.t7.D, t7Default.D),
    D1: pick(C.t7.D1, t7Default.D1),
    E: 0,
    F: pick(C.t7F, t7Default.F),
    G: 0,
  };
  c7.E = c7.A - c7.B - c7.C - c7.D - c7.D1;
  c7.G = c7.F - c7.E;

  const rateKeyFor: Record<string, Gstr9cT9RateKey> = { '5': 'A', '6': 'B1', '12': 'C', '18': 'E', '28': 'G', '40': 'H1', '3': 'I', '0.25': 'J', '0.1': 'K' };
  const rcKeyFor: Record<string, Gstr9cT9RateKey> = { '5': 'B', '12': 'D', '18': 'F', '28': 'H', '40': 'H2' };
  const derivedT9: Partial<Record<Gstr9cT9RateKey, RateWiseRow>> = {};
  const t9Source: Record<string, 'sales' | 'rcm' | 'sales+rcm' | 'none' | 'typed'> = {};
  const markSource = (k: string, src: 'sales' | 'rcm') => {
    const cur = t9Source[k];
    t9Source[k] = !cur || cur === src ? src : 'sales+rcm';
  };
  Object.entries(byRate).forEach(([rate, v]) => {
    const k = rateKeyFor[rate] ?? 'K1';
    derivedT9[k] = addV(derivedT9[k] || val(), v);
    markSource(k, 'sales');
  });
  docs.rcm.categories.forEach((cat) => {
    const k = rcKeyFor[String(num(cat.rate))] ?? 'K1';
    derivedT9[k] = addV(derivedT9[k] || val(), rcmCats[cat.id].total);
    markSource(k, 'rcm');
  });
  const c9rows: Record<string, RateWiseRow> = {};
  const c9derived: Record<string, boolean> = {};
  const c9defaults: Record<string, RateWiseRow> = {};
  GSTR9C_T9_RATE_KEYS.forEach((k) => {
    const o = C.t9[k];
    c9derived[k] = o === null || o === undefined;
    c9defaults[k] = derivedT9[k] || val();
    c9rows[k] = c9derived[k] ? c9defaults[k] : { ...val(), ...o };
    t9Source[k] = c9derived[k] ? t9Source[k] ?? 'none' : 'typed';
  });
  GSTR9C_T9_OTHER_KEYS.forEach((k) => { c9rows[k] = withT(0, C.t9Other[k] || tax()); });
  const c9P = addV(...Object.values(c9rows));
  const c9QDefault = tax(t9.igst.payable, t9.cgst.payable, t9.sgst.payable, t9.cess.payable);
  const c9Q = C.t9Q === null || C.t9Q === undefined ? c9QDefault : tin(C.t9Q);
  const c9R = subT(c9Q, taxOf(c9P));

  const c12Default = { A: taxOf(netItc), B: lye, C: t13 };
  const c12A = C.t12A === null || C.t12A === undefined ? c12Default.A : tin(C.t12A);
  const c12B = C.t12B === null || C.t12B === undefined ? c12Default.B : tin(C.t12B);
  const c12C = C.t12C === null || C.t12C === undefined ? c12Default.C : tin(C.t12C);
  const c12D = subT(addT(c12A, c12B), c12C);
  const c12E = t7J;
  const c12F = subT(c12E, c12D);

  // ------------------------------------------------------------ Notice format
  const N = docs.notice;
  const t16Deemed = taxOf(G.t16.deemedSupply);
  const t16Approval = taxOf(G.t16.approvalNotReturned);
  const t15Pending = tax(G.t15.demandPending.i, G.t15.demandPending.c, G.t15.demandPending.s, G.t15.demandPending.x);
  const t14Paid = tax(G.t14.igst.paid, G.t14.cgst.paid, G.t14.sgst.paid, G.t14.cess.paid);
  const o = {} as Workings['notice']['outward'];
  o.r1 = g4NTax; // 4N
  o.r2 = subT(taxOf(t10), taxOf(t11)); // 10 − 11 (the sheet shifts these one column)
  o.r3 = N.deemedSupplies ? tin(N.deemedSupplies) : t16Deemed; // 16B
  o.r4 = N.unreturnedGoods ? tin(N.unreturnedGoods) : t16Approval; // 16C
  o.r5 = N.pendingDemands ? tin(N.pendingDemands) : t15Pending; // 15G
  o.r6 = addT(o.r1, o.r2, o.r3, o.r4, o.r5);
  o.r7 = tax(t9.igst.cash, t9.cgst.cash, t9.sgst.cash, t9.cess.cash);
  o.r8 = tax(
    t9.igst.itcI + t9.igst.itcC + t9.igst.itcS + t9.igst.itcX,
    t9.cgst.itcI + t9.cgst.itcC + t9.cgst.itcS + t9.cgst.itcX,
    t9.sgst.itcI + t9.sgst.itcC + t9.sgst.itcS + t9.sgst.itcX,
    t9.cess.itcI + t9.cess.itcC + t9.cess.itcS + t9.cess.itcX,
  );
  o.r9 = t14Paid;
  o.r10 = tin(N.prevYearT14);
  o.r11 = addT(subT(o.r6, o.r7, o.r8, o.r9), o.r10);

  const inw = {} as Workings['notice']['inward'];
  inw.r1 = t8.A;
  inw.r2 = N.prevYear8C ? tin(N.prevYear8C) : tin(A.a4.c8);
  inw.r3 = t8.C;
  inw.r4 = N.ineligible4D ? tin(N.ineligible4D) : sumMonths(byMonth((m) => P.months[m].itc4d));
  inw.r5 = tin(N.ineligible164);
  inw.r6 = subT(addT(inw.r1, inw.r2), inw.r3, inw.r4, inw.r5); // E28 = 1 + 2 − 3 − 4 − 5
  inw.r7 = N.itcUsed4A5 ? tin(N.itcUsed4A5) : sumMonths(byMonth((m) => P.months[m].itc4a5));
  inw.r8 = N.reversed4B2 ? tin(N.reversed4B2) : sumMonths(byMonth((m) => P.months[m].itc4b2));
  inw.r9 = subT(inw.r7, inw.r6, inw.r8); // E31 = 7 − 6 − 8 (positive = ITC used in excess)

  // ------------------------------------------------------------ Difference lines (the review list)
  const J = docs.justifications.lines || {};
  const diffs: DiffLine[] = [];
  const itcLine = (key: string) => ctx.noItcBuilder && /^(purchases|dti|itc|ann2|g9\.8D|gstr9c\.12F|gstr9c\.14T)/.test(key);
  const push = (
    key: string,
    step: StepKey,
    label: string,
    a: ValTax,
    b: ValTax,
    opts: { direction: string; aLabel: string; bLabel: string; hasTaxable?: boolean; hasTax?: boolean; informational?: boolean },
  ) => {
    const hasTaxable = opts.hasTaxable ?? false;
    const hasTax = opts.hasTax ?? true;
    const diff = subV(a, b);
    const mag = Math.max(hasTax ? maxAbs(diff) : 0, hasTaxable ? Math.abs(diff.t) : 0);
    const informational = !!opts.informational || itcLine(key);
    const requiresReason = !informational && mag > tol + 1e-9;
    const j = J[key] || null;
    let stale = false;
    if (j && j.diffAt) {
      const moved = subV(diff, { ...val(), ...j.diffAt });
      stale = Math.max(hasTax ? maxAbs(moved) : 0, hasTaxable ? Math.abs(moved.t) : 0) > tol + 1e-9;
    }
    const hasText = !!j && !!j.text && !!j.text.trim();
    diffs.push({
      key, step, label, a, b, diff,
      direction: opts.direction, aLabel: opts.aLabel, bLabel: opts.bLabel,
      hasTaxable, hasTax, informational, requiresReason,
      justification: j, stale: hasText && stale,
      open: requiresReason && (!hasText || stale),
    });
  };

  if (auditReportTotal !== null) {
    push('sales.audit', 'sales', 'Total income: audit report vs books (PL-OUTPUT D56)', val(auditReportTotal), val(salesTotal), {
      direction: 'Report − Books', aLabel: 'As per audit report', bLabel: 'Books (Part A + B)', hasTaxable: true, hasTax: false,
    });
  }
  push('purchases.dt', 'purchases', 'Net ITC: P&L vs Duties & Taxes (PL-INPUT row 81)', withT(0, taxOf(netItc)), withT(0, dtiNet), {
    direction: 'P&L − D&T', aLabel: 'Net ITC as per P&L', bLabel: 'Duties & Taxes net',
  });
  const missingLine = (key: string, step: StepKey, what: string, months: MonthKey[], books: Tax) => {
    if (!months.length) return;
    push(key, step, `${what}: GSTR-3B not fetched for ${months.map((m) => MONTH_LABEL[m]).join(', ')}`, withT(0, books), val(), {
      direction: 'Books − 3B', aLabel: 'Books (those months)', bLabel: 'Not fetched',
    });
  };
  const dtoMissing = FY_MONTHS.filter((m) => !outPresent[m] && isNonZeroT(dtoMonths[m].net));
  missingLine('dto.no3b', 'duties', 'Output tax', dtoMissing, addT(...dtoMissing.map((m) => dtoMonths[m].net)));
  FY_MONTHS.forEach((m) => {
    if (!outPresent[m]) return;
    push(`dto.${m}`, 'duties', `Output tax ${MONTH_LABEL[m]}: books vs GSTR-3B`, withT(0, dtoMonths[m].net), withT(0, dtoMonths[m].asPer3B), {
      direction: 'Books − 3B', aLabel: 'Net sales tax (books)', bLabel: 'As per GSTR-3B',
    });
  });
  push('dto.pl', 'duties', 'Output tax: P&L vs Duties & Taxes (annual)', withT(0, dtoAsPerPl), withT(0, dtoTotals.net), {
    direction: 'P&L − D&T', aLabel: 'As per P&L (Part A)', bLabel: 'Duties & Taxes net',
  });
  const dtiMissing = FY_MONTHS.filter((m) => !itcPresent[m] && isNonZeroT(dtiMonths[m].net));
  missingLine('dti.no3b', 'duties', 'Input tax', dtiMissing, addT(...dtiMissing.map((m) => dtiMonths[m].net)));
  FY_MONTHS.forEach((m) => {
    if (!itcPresent[m]) return;
    push(`dti.${m}`, 'duties', `Input tax ${MONTH_LABEL[m]}: books vs GSTR-3B`, withT(0, dtiMonths[m].net), withT(0, dtiMonths[m].asPer3B), {
      direction: 'Books − 3B', aLabel: 'Net purchase ITC (books)', bLabel: 'As per GSTR-3B (excl. RCM)',
    });
  });
  if (isNonZeroT(lye)) {
    push('dti.lye', 'duties', 'Last year effect (books; no 3B month)', withT(0, lye), val(), {
      direction: 'Books − 3B', aLabel: 'Last year effect', bLabel: '—', informational: true,
    });
  }
  push('dti.rcm', 'duties', 'RCM tax: books vs GSTR-3B', withT(0, dtiRcmBooks), withT(0, dtiRcmPortal), {
    direction: 'Books − 3B', aLabel: 'RCM Part B (books)', bLabel: 'RCM Part A (portal)', informational: true,
  });
  push('dti.pl', 'duties', 'ITC: P&L vs Duties & Taxes (annual)', withT(0, taxOf(netItc)), withT(0, dtiNet), {
    direction: 'P&L − D&T', aLabel: 'Net ITC as per P&L', bLabel: 'Duties & Taxes net', informational: true,
  });
  FY_MONTHS.forEach((m) => {
    if (partASource === 'gstr9') return; // only the annual 4G figure exists — compared once, by rcm.annual
    if (!isNonZeroV(partBMonths[m]) && !isNonZeroV(partAMonths[m])) return;
    push(`rcm.${m}`, 'rcm', `RCM ${MONTH_LABEL[m]}: books vs portal`, partBMonths[m], partAMonths[m], {
      direction: 'Books − Portal', aLabel: 'Part B (books)', bLabel: 'Part A (portal)', hasTaxable: true,
    });
  });
  if (partASource === 'gstr9') {
    push('rcm.annual', 'rcm', 'RCM (annual): books vs GSTR-9 4G', rcmPartB, rcmPartA, {
      direction: 'Books − Portal', aLabel: 'Part B (books)', bLabel: 'GSTR-9 4G', hasTaxable: true,
    });
  }
  if (!gstr9Present) {
    if (isNonZeroV(outwardBooksTotal)) {
      push('out.portal', 'outward', 'GSTR-9 Table 4 not fetched from the portal', outwardBooksTotal, val(), {
        direction: 'Books − GSTR-9', aLabel: 'As per books', bLabel: 'Not fetched', hasTaxable: true,
      });
    }
  } else outwardRows.forEach((r) => {
    if (!isNonZeroV(r.books) && !isNonZeroV(r.portal)) return;
    push(`out.${r.key}`, 'outward', `${r.label} (${r.table}): books vs GSTR-9`, r.books, r.portal, {
      direction: 'Books − GSTR-9', aLabel: 'As per books', bLabel: 'Auto-populated GSTR-9', hasTaxable: true,
    });
  });
  if (gstr9Present) {
    push('out.total', 'outward', 'Total outward supplies: books vs GSTR-9', outwardBooksTotal, outwardPortalTotal, {
      direction: 'Books − GSTR-9', aLabel: 'As per books', bLabel: 'Auto-populated GSTR-9', hasTaxable: true,
    });
  }
  push('itc.6J', 'itc', 'Table 6J: ITC availed (6I) vs 6A2', withT(0, t6.I), withT(0, t6.A2), {
    direction: '6I − 6A2', aLabel: '6I', bLabel: '6A2',
  });
  push('itc.books', 'itc', 'ITC for the year: GSTR-9 7J vs books', withT(0, t7J), withT(0, asPerBook), {
    direction: '7J − Books', aLabel: 'Table 7J', bLabel: 'As per books (D&T net)', informational: true,
  });
  push('ann1.income', 'annexures', 'Annexure-1: income as per books vs GSTR-9', ann1E, ann1F, {
    direction: 'Books − GSTR-9', aLabel: 'Total as per books (E)', bLabel: 'Auto-calculated GSTR-9 (F)', hasTaxable: true,
  });
  push('ann1.paid', 'annexures', 'Annexure-1: tax payable (books) vs paid (Table 9)', withT(0, ann1Payable), withT(0, ann1Paid), {
    direction: 'Payable − Paid', aLabel: 'Payable (books)', bLabel: 'Paid (GSTR-9 Table 9)',
  });
  push('ann2.J', 'annexures', 'Annexure-2: excess ITC claimed / to be claimed (J)', withT(0, ann2.E), withT(0, ann2.I), {
    direction: 'E − I', aLabel: 'Total (E)', bLabel: 'Net ITC as per portal (I)',
  });
  if (gstr9Present) {
    // Table 5 against the portal's auto-populated Table 5 — a cross-check only (Table 5 is filed from books).
    const t5Pairs: Array<[string, string, number, number]> = [
      ['5A', 'Zero rated (export) without tax', g5.A.t, num(T5P.zero_rtd)],
      ['5B', 'SEZ without tax', g5.B.t, num(T5P.sez)],
      ['5C', 'Reverse charge (recipient pays)', g5.C.t, num(T5P.rchrg)],
      ['5D', 'Exempted', g5.D.t, num(T5P.exmt)],
      ['5E', 'Nil rated', g5.E.t, num(T5P.nil)],
      ['5F', 'Non-GST supply', g5.F.t, num(T5P.non_gst)],
      ['5H', 'Credit notes', g5.H.t, num(T5P.cr_nt)],
    ];
    t5Pairs.forEach(([code, label, books, portal]) => {
      if (Math.abs(books) < 0.005 && Math.abs(portal) < 0.005) return;
      push(`g9.t5.${code}`, 'gstr9', `Table ${code} ${label}: books vs portal`, val(books), val(portal), {
        direction: 'Books − Portal', aLabel: 'As per books (Part B)', bLabel: 'Auto-populated Table 5', hasTaxable: true, hasTax: false, informational: true,
      });
    });
  }
  push('g9.8D', 'gstr9', 'Table 8D: ITC in GSTR-2B not availed [8A − (8B + 8C)]', withT(0, t8.A), withT(0, addT(t8.B, t8.C)), {
    direction: '8A − (8B + 8C)', aLabel: '8A', bLabel: '8B + 8C',
  });
  TABLE9_HEADS.forEach((h) => {
    push(`g9.t9.${h}`, 'gstr9', `Table 9 ${h.toUpperCase()}: payable vs paid`, withT(0, headT(h, t9[h].payable)), withT(0, headT(h, t9[h].paid)), {
      direction: 'Payable − Paid', aLabel: 'Tax payable', bLabel: 'Total paid',
    });
  });
  push('gstr9c.5R', 'gstr9c', 'GSTR-9C 5R: un-reconciled turnover (Q − P)', val(t5Q), val(t5P), {
    direction: 'Q − P', aLabel: 'As per GSTR-9 (Q)', bLabel: 'After adjustments (P)', hasTaxable: true, hasTax: false,
  });
  push('gstr9c.7G', 'gstr9c', 'GSTR-9C 7G: un-reconciled taxable turnover (F − E)', val(c7.F), val(c7.E), {
    direction: 'F − E', aLabel: 'As per GSTR-9 (F)', bLabel: 'After adjustments (E)', hasTaxable: true, hasTax: false,
  });
  push('gstr9c.9R', 'gstr9c', 'GSTR-9C 9R: un-reconciled payment (Q − P)', withT(0, c9Q), withT(0, taxOf(c9P)), {
    direction: 'Q − P', aLabel: 'As per GSTR-9 (Q)', bLabel: 'Rate-wise (P)',
  });
  push('gstr9c.12F', 'gstr9c', 'GSTR-9C 12F: un-reconciled ITC (E − D)', withT(0, c12E), withT(0, c12D), {
    direction: 'E − D', aLabel: 'Claimed in GSTR-9 (E)', bLabel: 'As per books (D)',
  });
  push('gstr9c.14T', 'gstr9c', 'GSTR-9C 14T: un-reconciled ITC by expense head (R − S)', withT(0, taxOf(c14.R)), withT(0, c14S), {
    direction: 'R − S', aLabel: 'Eligible ITC by head (R)', bLabel: 'Claimed in GSTR-9 (S)',
  });

  const stepOpen = {
    overview: 0, portal: 0, sales: 0, purchases: 0, duties: 0, rcm: 0, outward: 0, itc: 0,
    expense: 0, annexures: 0, gstr9: 0, gstr9c: 0, notice: 0, review: 0,
  } as Record<StepKey, number>;
  diffs.forEach((d) => { if (d.open) { stepOpen[d.step] += 1; stepOpen.review += 1; } });

  return {
    ctx,
    tolerance: tol,
    sales: {
      rows: salesRows, partA, partATaxable: partA.t, partBTotal, partBByNature,
      total: salesTotal, auditReportTotal, auditDiff, byRate,
    },
    purchases: {
      rows: purchaseRows, sections, totalPl, suspended: suspendedNet, otherAdj,
      rcmCredit: rcmPartB, netItc, dtNet: dtiNet, diffVsDt: purchasesDiffVsDt,
    },
    dto: { months: dtoMonths, totals: dtoTotals, adjustments: dtoAdj, totalCrSide: addT(dtoTotals.sales, dtoAdj), asPerPl: dtoAsPerPl, plDiff: dtoPlDiff },
    dti: {
      lye, months: dtiMonths, totals: dtiTotals,
      rcmBooks: dtiRcmBooks, rcmPortal: dtiRcmPortal, rcmDiff: subT(dtiRcmBooks, dtiRcmPortal),
      totalItcBooks, totalItcPortal, totalItcDiff: subT(totalItcBooks, totalItcPortal),
      net: dtiNet, asPerPl: taxOf(netItc), plDiff: subT(taxOf(netItc), dtiNet),
      adjustments: dtiAdj, totalDr: addT(dtiTotals.purchase, dtiAdj),
      suspendedNet, reversals, reclaims,
    },
    rcm: {
      categories: rcmCats, partBMonths, partB: rcmPartB, partAMonths, partA: rcmPartA, partASource,
      diffMonths: rcmDiffMonths, diff: rcmDiff, byItcTable,
    },
    outward: { rows: outwardRows, booksTotal: outwardBooksTotal, portalTotal: outwardPortalTotal, diffTotal: outwardDiffTotal },
    itc: {
      inputs, inputServices, inputServicesBooks, importGoods, capitalGoods, rcm: rcmPartB, reclaim: reclaims,
      isd, t6N: t6.N, asPer3B: t6A2, total: withT(inputs.t + inputServices.t + importGoods.t + capitalGoods.t + rcmPartB.t, t6.O),
      reversal7H1: reversals, s17_5: t7.E, otherReversals: subT(t7I, reversals, t7.E), total7J: t7J,
      asPerBook, residual, t12Suggested, t13Suggested,
    },
    c14: { rows: c14, qTagged, qBalancing, check: c14Check, S: c14S, T: c14T },
    g9: {
      t4: g4 as Workings['g9']['t4'], t4Source: gstr9Present ? 'portal' : 'none',
      t5: g5, t5Portal: { ...P.gstr9.table5 }, t5PortalTotals, t8Unsplit,
      t6, t6ASource, t7, t7H, t7I, t7EPortal: monthly4B1, t7J, t8, t9, t9Other,
      t10, t11, t12, t12Source: G.t12 === null || G.t12 === undefined ? 'computed' : 'override', t13, totalTurnover,
    },
    ann1: { A: ann1A, nonGst: ann1NonGst, B: ann1B, C: ann1C, D: ann1D, E: ann1E, F: ann1F, G: ann1G, payable: ann1Payable, paid: ann1Paid, payDiff: ann1PayDiff },
    ann2,
    ann3: {
      clause9: ann1PayDiff, rcmToPay, rcmToPaySuggested, excessItc, excessItcSuggested, other: a3Other,
      total: ann3Total, payable: ann3Payable, excessPaid: ann3Excess, alreadyPaid,
      balance: maxT0(subT(ann3Payable, alreadyPaid)),
    },
    gstr9c: {
      t5: { A: t5A, P: t5P, Q: t5Q, R: t5Q - t5P, rows: t5Rows },
      t7: c7,
      t9: { rows: c9rows, derived: c9derived, source: t9Source, P: c9P, Q: c9Q, R: c9R },
      t12: { A: c12A, B: c12B, C: c12C, D: c12D, E: c12E, F: c12F },
      t14: { rows: c14, R: c14.R, S: c14S, T: c14T },
      defaults: { t5A: t5ADefault, t5Q: totalTurnover.t, t7: t7Default, t9: c9defaults, t9Q: c9QDefault, t12: c12Default },
    },
    notice: { outward: o, inward: inw },
    diffs,
    openCount: stepOpen.review,
    stepOpen,
  };
}

/** GST rates in force (percent). */
export const STANDARD_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28, 40];

/** Snap an implied rate to the nearest standard rate within 0.5 points, else "unknown". */
function snapRate(implied: number | null): string {
  if (implied === null) return 'unknown';
  const a = Math.abs(implied);
  let best: number | null = null;
  STANDARD_RATES.forEach((r) => { if (Math.abs(a - r) <= 0.5 && (best === null || Math.abs(a - r) < Math.abs(a - best))) best = r; });
  return best === null ? 'unknown' : String(best);
}

function headT(h: Table9Head, v: number): Tax {
  if (h === 'igst') return tax(v, 0, 0, 0);
  if (h === 'cgst') return tax(0, v, 0, 0);
  if (h === 'sgst') return tax(0, 0, v, 0);
  return tax(0, 0, 0, v);
}

/** Table 4 portal row keys in form order, for the Portal step grid. */
export const T4_ROWS: Array<{ key: T4Key; table: string; label: string }> = [
  { key: 'b2c', table: '4A', label: 'Supplies to unregistered persons (B2C)' },
  { key: 'b2b', table: '4B', label: 'Supplies to registered persons (B2B)' },
  { key: 'exp', table: '4C', label: 'Zero rated supply (export) on payment of tax' },
  { key: 'sez', table: '4D', label: 'Supply to SEZs on payment of tax' },
  { key: 'deemed', table: '4E', label: 'Deemed exports' },
  { key: 'at', table: '4F', label: 'Advances on which tax paid, invoice not issued' },
  { key: 'rchrg', table: '4G', label: 'Inward supplies on which tax is paid on reverse charge' },
  { key: 'ecom', table: '4G1', label: 'Supplies on which e-commerce operator pays tax u/s 9(5)' },
  { key: 'cr_nt', table: '4I', label: 'Credit notes (−)' },
  { key: 'dr_nt', table: '4J', label: 'Debit notes (+)' },
  { key: 'amd_pos', table: '4K', label: 'Supplies / tax declared through amendments (+)' },
  { key: 'amd_neg', table: '4L', label: 'Supplies / tax reduced through amendments (−)' },
];
