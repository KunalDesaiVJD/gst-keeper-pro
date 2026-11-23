// Rule 42 of the CGST Rules — common credit on inputs and input services used
// partly for exempt supplies (s.17(2)/(3)), as the Annual Return working
// computes it. Pure: computeWorkings() prepares the inputs and reads the result
// into GSTR-9 Table 7C, Payables and the review list. The positions are in
// docs/GSTR9_9C_WORKINGS.md §6 ("Rule 42 working") and the plan in the
// Rule 42/43 roadmap doc.
//
// Per tax period (a month, or a quarter for a QRMP client), per head:
//
//   C1 = T − (T1 + T2 + T3)      T  = input tax on inputs and input services credited
//   C2 = C1 − T4                 T1 = non-business only, T2 = exempt only,
//   D1 = E ÷ F × C2              T3 = blocked u/s 17(5), T4 = taxable only (zero rated included)
//   D2 = 5% × C2 (only when common credit is also used for non-business purposes)
//
// The annual final is the same chain on the year's T to T4 with the year's
// E ÷ F (rule 42(2)). Final over provisional is reversed by the September
// return after the year, with interest u/s 50(1) from 1 April of the next
// year; provisional over final is taken back as credit in the same window.
// A period with no turnover takes E ÷ F from the last period that had one.
//
// T is the month's GSTR-3B 4A total as filed (never the app's own GSTR-3B,
// docs/GSTR9_9C_WORKINGS.md §5) less the capital goods credit inside it,
// which is Rule 43's. T1 to T4 and that capital goods credit come from the
// Purchases and RCM tags for the year, spread over the months by their share
// of T, unless typed for a month.

import { FY_MONTHS } from './types';
import type { MonthKey, PortalTurnover, Rule42Doc, Rule42Month, Tax, TaxIn } from './types';

// ─── Small arithmetic (local: engine.ts imports this module) ────────────────

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n0 = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : 0; };
const T = (i = 0, c = 0, s = 0, x = 0): Tax => ({ i, c, s, x });
const HEADS = ['i', 'c', 's', 'x'] as const;
type Head = (typeof HEADS)[number];
const map = (a: Tax, f: (v: number, h: Head) => number): Tax => T(f(a.i, 'i'), f(a.c, 'c'), f(a.s, 's'), f(a.x, 'x'));
const add = (...xs: Tax[]): Tax => xs.reduce((a, b) => T(a.i + b.i, a.c + b.c, a.s + b.s, a.x + b.x), T());
const sub = (a: Tax, ...bs: Tax[]): Tax => bs.reduce((p, b) => T(p.i - b.i, p.c - b.c, p.s - b.s, p.x - b.x), a);
const scale = (a: Tax, k: number): Tax => map(a, (v) => v * k);
const pos = (a: Tax): Tax => map(a, (v) => Math.max(v, 0));
const round = (a: Tax): Tax => map(a, r2);
const total = (a: Tax) => a.i + a.c + a.s + a.x;
/** A typed cell: SGST null mirrors CGST (the workings' SGST lock). */
const tin = (t: Partial<TaxIn> | null | undefined): Tax => {
  if (!t) return T();
  const c = n0(t.c);
  return T(n0(t.i), c, t.s === null || t.s === undefined ? c : n0(t.s), n0(t.x));
};

export const INTEREST_RATE_50 = 0.18;
export const D2_RATE = 0.05;
const QUARTERS: MonthKey[][] = [['apr', 'may', 'jun'], ['jul', 'aug', 'sep'], ['oct', 'nov', 'dec'], ['jan', 'feb', 'mar']];
const MONTH_NAME: Record<MonthKey, string> = {
  apr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec', jan: 'Jan', feb: 'Feb', mar: 'Mar',
};

/** The tagged keys spread over the months. */
export type R42Tag = 't1' | 't2' | 't3' | 't4' | 'cg';
export const R42_TAGS: R42Tag[] = ['t1', 't2', 't3', 't4', 'cg'];

// ─── Dates ──────────────────────────────────────────────────────────────────

const fyStart = (fy: string) => Number(fy.slice(0, 4));
/** MM/YYYY of a month of the FY. */
export const periodOf = (fy: string, m: MonthKey): string => {
  const k = FY_MONTHS.indexOf(m);
  const month = ((k + 3) % 12) + 1;
  return `${String(month).padStart(2, '0')}/${k < 9 ? fyStart(fy) : fyStart(fy) + 1}`;
};
/** The latest GSTR-3B the true-up may go into: September after the FY (rule 42(2)). */
export const latestTrueUpPeriod = (fy: string) => `09/${fyStart(fy) + 1}`;
const periodKey = (p: string) => { const [m, y] = p.split('/').map(Number); return y * 100 + m; };
export const validPeriod = (p: string | null | undefined): p is string => !!p && /^(0[1-9]|1[0-2])\/\d{4}$/.test(p);
/** Due date (UTC ms) of a period's GSTR-3B: the 20th of the next month, the 22nd for a quarterly return. */
const dueOf = (period: string, quarterly: boolean): number => {
  const [m, y] = period.split('/').map(Number);
  return Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, quarterly ? 22 : 20);
};
const days = (from: number, to: number) => Math.max(0, Math.round((to - from) / 86_400_000));

// ─── Inputs and result ──────────────────────────────────────────────────────

export interface Rule42MonthInput {
  /** T before the capital goods credit is taken out: the as-filed GSTR-3B 4A total. */
  itc: Tax;
  /** The as-filed GSTR-3B 3.1 values, when the month was imported with them. */
  turnover: PortalTurnover | null;
}

export interface Rule42Input {
  financialYear: string;
  quarterly: boolean;
  doc: Rule42Doc;
  months: Record<MonthKey, Rule42MonthInput>;
  /** The year's credit tagged T1 to T4 on Purchases and RCM, and the capital goods credit (Purchases capital goods section). */
  tagged: Record<R42Tag, Tax>;
  /** E and F for the year from the Sales classification (Part A + Part B). */
  books: { e: number; f: number };
}

export type RatioSource = 'typed' | 'portal' | 'carried' | 'annual' | 'none';

export interface Rule42Period {
  key: string;
  label: string;
  months: MonthKey[];
  /** MM/YYYY of the GSTR-3B the period was filed in (the quarter's last month for QRMP). */
  period: string;
  itc: Tax;
  t: Tax;
  t1: Tax; t2: Tax; t3: Tax; t4: Tax; cg: Tax;
  /** Which of T1 to T4 / CG were typed for this period (else spread). */
  typed: Record<R42Tag, boolean>;
  c1: Tax;
  c2: Tax;
  e: number | null;
  f: number | null;
  ratio: number;
  ratioSource: RatioSource;
  d1: Tax;
  d2: Tax;
  provisional: Tax;
  reversed: Tax;
  /** provisional − reversed: positive = reversed short. */
  short: Tax;
  notUtilised: boolean;
  interestDays: number;
  interest: Tax;
}

export interface Rule42Annual {
  t: Tax; t1: Tax; t2: Tax; t3: Tax; t4: Tax; cg: Tax;
  c1: Tax; c2: Tax;
  e: number; f: number; ratio: number; ratioSource: 'books' | 'periods' | 'none';
  d1: Tax; d2: Tax;
  final: Tax;
}

export interface Rule42Result {
  enabled: boolean;
  /** Exempt supplies and credit both exist in the year: the rule applies. */
  applies: boolean;
  periods: Rule42Period[];
  annual: Rule42Annual;
  provisional: Tax;
  reversed: Tax;
  /** final − provisional, per head (positive = reverse more, negative = take back). */
  trueUp: Tax;
  /** final − reversed in the GSTR-3Bs: what is still to settle. */
  net: Tax;
  payable: Tax;
  recredit: Tax;
  postingPeriod: string;
  latestPeriod: string;
  postingLate: boolean;
  trueUpInterestDays: number;
  interestTrueUp: Tax;
  interestShort: Tax;
  interest: Tax;
  /** What GSTR-9 7C takes: the override, else the final figure. */
  t7C: Tax;
  t7CSource: 'working' | 'override';
  /** Σ E and Σ F of the periods, against the books. */
  periodsE: number;
  periodsF: number;
  warnings: string[];
}

// ─── Spread of the year's tagged credit over the months ─────────────────────

/**
 * Months typed keep their figure; the rest of the year's tagged amount is
 * spread over the other months by their share of the month's credit, head by
 * head (evenly when those months have no credit on that head).
 */
export function spreadTagged(
  annual: Tax,
  typed: Partial<Record<MonthKey, Tax>>,
  weight: Record<MonthKey, Tax>,
): Record<MonthKey, Tax> {
  const out = {} as Record<MonthKey, Tax>;
  const open = FY_MONTHS.filter((m) => !typed[m]);
  const rest = sub(annual, ...FY_MONTHS.filter((m) => typed[m]).map((m) => typed[m] as Tax));
  FY_MONTHS.forEach((m) => { out[m] = typed[m] ?? T(); });
  HEADS.forEach((h) => {
    const left = rest[h];
    if (!open.length || Math.abs(left) < 0.005) return;
    const w = open.reduce((s, m) => s + Math.max(weight[m][h], 0), 0);
    open.forEach((m) => {
      out[m][h] = w > 0 ? (left * Math.max(weight[m][h], 0)) / w : left / open.length;
    });
  });
  FY_MONTHS.forEach((m) => { out[m] = round(out[m]); });
  return out;
}

// ─── The computation ────────────────────────────────────────────────────────

const chain = (t: Tax, t1: Tax, t2: Tax, t3: Tax, t4: Tax, ratio: number, d2On: boolean) => {
  const c1 = sub(t, t1, t2, t3);
  const c2 = pos(sub(c1, t4));
  const d1 = round(scale(c2, ratio));
  const d2 = d2On ? round(scale(c2, D2_RATE)) : T();
  return { c1: round(c1), c2: round(c2), d1, d2 };
};

const monthE = (mm: Rule42Month, inp: Rule42MonthInput): number | null =>
  mm.e !== null && mm.e !== undefined ? n0(mm.e) : inp.turnover ? n0(inp.turnover.nilExempt) + n0(inp.turnover.nonGst) : null;
const monthF = (mm: Rule42Month, inp: Rule42MonthInput): number | null =>
  mm.f !== null && mm.f !== undefined
    ? n0(mm.f)
    : inp.turnover ? n0(inp.turnover.taxable) + n0(inp.turnover.zero) + n0(inp.turnover.nilExempt) + n0(inp.turnover.nonGst) : null;

export function computeRule42(input: Rule42Input): Rule42Result {
  const { doc, financialYear: fy, quarterly } = input;
  const warnings: string[] = [];
  const mm = (m: MonthKey): Rule42Month => doc.months?.[m] ?? ({} as Rule42Month);

  // T before CG for each month, and the year's tags spread.
  const itcM = Object.fromEntries(FY_MONTHS.map((m) => [m, round(input.months[m]?.itc ?? T())])) as Record<MonthKey, Tax>;
  const spread = Object.fromEntries(R42_TAGS.map((k) => {
    const typed: Partial<Record<MonthKey, Tax>> = {};
    FY_MONTHS.forEach((m) => { const v = mm(m)[k]; if (v) typed[m] = tin(v); });
    return [k, { values: spreadTagged(input.tagged[k] ?? T(), typed, itcM), typed }];
  })) as Record<R42Tag, { values: Record<MonthKey, Tax>; typed: Partial<Record<MonthKey, Tax>> }>;

  const groups: MonthKey[][] = quarterly ? QUARTERS : FY_MONTHS.map((m) => [m]);

  // E ÷ F of the year, the fallback for a period with no data.
  const periodsE0 = groups.map((g) => g.map((m) => monthE(mm(m), input.months[m])));
  const periodsF0 = groups.map((g) => g.map((m) => monthF(mm(m), input.months[m])));
  const sumKnown = (xs: (number | null)[]) => (xs.some((x) => x !== null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null);
  const pE = periodsE0.map(sumKnown);
  const pF = periodsF0.map(sumKnown);
  const periodsE = pE.reduce<number>((s, x) => s + (x ?? 0), 0);
  const periodsF = pF.reduce<number>((s, x) => s + (x ?? 0), 0);
  const booksF = n0(input.books.f);
  const annualRatio = booksF > 0
    ? { e: n0(input.books.e), f: booksF, ratio: n0(input.books.e) / booksF, src: 'books' as const }
    : periodsF > 0 ? { e: periodsE, f: periodsF, ratio: periodsE / periodsF, src: 'periods' as const }
      : { e: 0, f: 0, ratio: 0, src: 'none' as const };

  let lastRatio: number | null = null;
  const missing: string[] = [];
  const periods: Rule42Period[] = groups.map((g, gi) => {
    const label = quarterly ? `Q${gi + 1} (${MONTH_NAME[g[0]]}–${MONTH_NAME[g[2]]})` : MONTH_NAME[g[0]];
    const itc = add(...g.map((m) => itcM[m]));
    const tagOf = (k: R42Tag) => round(add(...g.map((m) => spread[k].values[m])));
    const typed = Object.fromEntries(R42_TAGS.map((k) => [k, g.some((m) => !!spread[k].typed[m])])) as Record<R42Tag, boolean>;
    const cg = tagOf('cg');
    const t = round(sub(itc, cg));
    const t1 = tagOf('t1'); const t2 = tagOf('t2'); const t3 = tagOf('t3'); const t4 = tagOf('t4');
    const e = pE[gi];
    const f = pF[gi];
    const anyTyped = g.some((m) => (mm(m).e ?? null) !== null || (mm(m).f ?? null) !== null);
    let ratio: number;
    let ratioSource: RatioSource;
    if (f !== null && f > 0) {
      ratio = Math.min(Math.max((e ?? 0) / f, 0), 1);
      ratioSource = anyTyped ? 'typed' : 'portal';
      lastRatio = ratio;
    } else if (f !== null && lastRatio !== null) {
      ratio = lastRatio; ratioSource = 'carried';
    } else {
      if (f === null) missing.push(label);
      ratio = Math.min(Math.max(annualRatio.ratio, 0), 1);
      ratioSource = annualRatio.src === 'none' ? 'none' : 'annual';
    }
    const { c1, c2, d1, d2 } = chain(t, t1, t2, t3, t4, ratio, doc.d2);
    const provisional = add(d1, d2);
    const reversed = round(add(...g.map((m) => tin(mm(m).reversed))));
    const short = round(sub(provisional, reversed));
    const periodEnd = periodOf(fy, g[g.length - 1]);
    const notUtilised = !!mm(g[g.length - 1]).notUtilised;
    return {
      key: g.join('-'), label, months: g, period: periodEnd, itc, t, t1, t2, t3, t4, cg, typed, c1, c2,
      e, f, ratio, ratioSource, d1, d2, provisional, reversed, short, notUtilised, interestDays: 0, interest: T(),
    };
  });
  if (missing.length) {
    warnings.push(`No GSTR-3B 3.1 values for ${missing.join(', ')}: the year's ratio is used there. Re-import the GSTR-3B months, or type E and F.`);
  }

  // Annual final.
  const yr = (k: 't' | R42Tag) => round(add(...periods.map((p) => p[k])));
  const aT = yr('t');
  const a = chain(aT, yr('t1'), yr('t2'), yr('t3'), yr('t4'), Math.min(Math.max(annualRatio.ratio, 0), 1), doc.d2);
  const annual: Rule42Annual = {
    t: aT, t1: yr('t1'), t2: yr('t2'), t3: yr('t3'), t4: yr('t4'), cg: yr('cg'), c1: a.c1, c2: a.c2,
    e: r2(annualRatio.e), f: r2(annualRatio.f), ratio: annualRatio.ratio, ratioSource: annualRatio.src,
    d1: a.d1, d2: a.d2, final: add(a.d1, a.d2),
  };

  const provisional = round(add(...periods.map((p) => p.provisional)));
  const reversed = round(add(...periods.map((p) => p.reversed)));
  const trueUp = round(sub(annual.final, provisional));
  const net = round(sub(annual.final, reversed));

  // Posting and interest.
  const latestPeriod = latestTrueUpPeriod(fy);
  const postingPeriod = validPeriod(doc.postingPeriod) ? doc.postingPeriod : latestPeriod;
  const postingLate = periodKey(postingPeriod) > periodKey(latestPeriod);
  if (postingLate) warnings.push(`The true-up is posted in ${postingPeriod}, after ${latestPeriod}: rule 42(2) wants it by the September return after the year.`);
  const postingDue = dueOf(postingPeriod, false);
  periods.forEach((p) => {
    if (p.notUtilised) return;
    p.interestDays = days(dueOf(p.period, quarterly), postingDue);
    p.interest = round(scale(pos(p.short), (INTEREST_RATE_50 * p.interestDays) / 365));
  });
  const trueUpInterestDays = days(Date.UTC(fyStart(fy) + 1, 3, 1), postingDue);
  // Interest on the true-up runs on what the final adds over the provisional; a short month already carries its own.
  const interestTrueUp = round(scale(pos(trueUp), (INTEREST_RATE_50 * trueUpInterestDays) / 365));
  const interestShort = round(add(...periods.map((p) => p.interest)));

  if (doc.d2 && !doc.d2Reason.trim()) warnings.push('D2 (5% for non-business use) is on without a reason.');
  periods.forEach((p) => {
    const tagged = add(p.t1, p.t2, p.t3, p.t4);
    if (HEADS.some((h) => tagged[h] - p.t[h] > 0.5)) warnings.push(`${p.label}: T1 to T4 add up to more than T.`);
    if (p.notUtilised && !mm(p.months[p.months.length - 1]).notUtilisedReason?.trim()) {
      warnings.push(`${p.label}: no interest on the short reversal is claimed without a reason.`);
    }
  });

  const override = doc.final7C ? tin(doc.final7C) : null;
  const applies = annual.e > 0 && total(aT) > 0;
  return {
    enabled: !!doc.enabled,
    applies,
    periods,
    annual,
    provisional,
    reversed,
    trueUp,
    net,
    payable: pos(net),
    recredit: pos(map(net, (v) => -v)),
    postingPeriod,
    latestPeriod,
    postingLate,
    trueUpInterestDays,
    interestTrueUp,
    interestShort,
    interest: round(add(interestTrueUp, interestShort)),
    t7C: override ?? annual.final,
    t7CSource: override ? 'override' : 'working',
    periodsE: r2(periodsE),
    periodsF: r2(periodsF),
    warnings,
  };
}

/** Where a non-taxable ledger counts: in E and F, F only, or neither. */
export const R42_CLASS_COUNTS: Record<import('./types').R42Class, { e: boolean; f: boolean; factor: number }> = {
  taxable: { e: false, f: true, factor: 1 },
  zero_rated: { e: false, f: true, factor: 1 },
  exempt: { e: true, f: true, factor: 1 },
  nil: { e: true, f: true, factor: 1 },
  non_taxable: { e: true, f: true, factor: 1 },
  rcm_outward: { e: true, f: true, factor: 1 },
  sch3_para5: { e: true, f: true, factor: 1 },
  securities: { e: true, f: true, factor: 0.01 },
  excluded_e: { e: false, f: true, factor: 1 },
  not_turnover: { e: false, f: false, factor: 1 },
};

export const R42_CLASS_LABEL: Record<import('./types').R42Class, string> = {
  taxable: 'Taxable (F only)',
  zero_rated: 'Zero rated (F only)',
  exempt: 'Exempt (E)',
  nil: 'Nil rated (E)',
  non_taxable: 'Non-taxable supply (E)',
  rcm_outward: 'Reverse charge outward (E)',
  sch3_para5: 'Land / building after completion (E)',
  securities: 'Securities, at 1% (E)',
  excluded_e: 'Interest on loans, Entry 84/92A (F only)',
  not_turnover: 'Not a supply (neither)',
};

export const CREDIT_USE_LABEL: Record<import('./types').CreditUse, string> = {
  common: 'Common',
  t1: 'T1 non-business',
  t2: 'T2 exempt only',
  t3: 'T3 blocked 17(5)',
  t4: 'T4 taxable only',
};
