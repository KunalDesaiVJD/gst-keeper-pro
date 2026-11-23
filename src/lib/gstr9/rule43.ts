// Rule 43 of the CGST Rules — credit on capital goods used in common for
// taxable and exempt supplies (s.17(2)), as the Annual Return working
// computes it. Pure: computeWorkings() hands it the client's capital goods
// register (capital_goods_register, shared with s.18(6)) and the Rule 42
// working's E ÷ F of each tax period, and reads the result into GSTR-9
// Table 7D, 7E, Payables and the review list. Positions: docs/GSTR9_9C_WORKINGS.md
// §6 position 40.
//
// Per asset in common use (rule 43(1)(c) to (g)):
//   Tc = the credit on the asset (the register's ITC; for an asset that came
//        from exempt-only or non-business use into common use, that credit
//        less 5 percentage points for every quarter or part of one from the
//        invoice date to the date of the change, quarters.ts);
//   Tm = Tc ÷ 60, for every month of the asset's useful life of 60 months
//        from the month of the invoice, while it is in common use and not
//        yet disposed of (a disposal is s.18(6)'s, capitalGoods.ts);
// and per tax period (a month, or a quarter for a QRMP client):
//   Tr = Σ Tm of the period's months;
//   Te = E ÷ F × Tr, the E ÷ F of the Rule 42 working for that period (a
//        period with no turnover carries the last one), reversed in that
//        period's GSTR-3B 4(B)(1).
// Rule 43 has no annual re-computation: GSTR-9 7D is Σ Te. Te not reversed
// in its period is due with interest u/s 50 from that period's due date.

import { FY_MONTHS } from './types';
import type { MonthKey, Rule42Doc, Tax, TaxIn } from './types';
import type { CapitalGoodsAsset, UseClass } from './capitalGoods';
import { parseIsoDate, quartersOrPart, reduceByQuarters } from './quarters';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n0 = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : 0; };
const T = (i = 0, c = 0, s = 0, x = 0): Tax => ({ i, c, s, x });
const HEADS = ['i', 'c', 's', 'x'] as const;
const map = (a: Tax, f: (v: number) => number): Tax => T(f(a.i), f(a.c), f(a.s), f(a.x));
const add = (...xs: Tax[]): Tax => xs.reduce((a, b) => T(a.i + b.i, a.c + b.c, a.s + b.s, a.x + b.x), T());
const sub = (a: Tax, ...bs: Tax[]): Tax => bs.reduce((p, b) => T(p.i - b.i, p.c - b.c, p.s - b.s, p.x - b.x), a);
const scale = (a: Tax, k: number): Tax => map(a, (v) => v * k);
const pos = (a: Tax): Tax => map(a, (v) => Math.max(v, 0));
const round = (a: Tax): Tax => map(a, r2);
const total = (a: Tax) => a.i + a.c + a.s + a.x;
const tin = (t: Partial<TaxIn> | null | undefined): Tax => {
  if (!t) return T();
  const c = n0(t.c);
  return T(n0(t.i), c, t.s === null || t.s === undefined ? c : n0(t.s), n0(t.x));
};
const clean = (t: Partial<Tax> | null | undefined): Tax => T(n0(t?.i), n0(t?.c), n0(t?.s ?? t?.c), n0(t?.x));

export const USEFUL_LIFE_MONTHS = 60;
const INTEREST_RATE_50 = 0.18;

export const USE_CLASS_LABEL: Record<UseClass, string> = {
  taxable: 'Taxable only',
  exempt_or_non_business: 'Exempt / non-business only',
  common: 'Common',
};

// ─── Dates ──────────────────────────────────────────────────────────────────

const fyStart = (fy: string) => Number(fy.slice(0, 4));
/** A month as a running number (year × 12 + month index). */
const monthNo = (y: number, m0: number) => y * 12 + m0;
const fyMonthNo = (fy: string, m: MonthKey) => {
  const k = FY_MONTHS.indexOf(m);
  return monthNo(k < 9 ? fyStart(fy) : fyStart(fy) + 1, (k + 3) % 12);
};
const isoOfMonthEnd = (no: number) => {
  const y = Math.floor(no / 12);
  const m0 = no % 12;
  const d = new Date(Date.UTC(y, m0 + 1, 0));
  return d.toISOString().slice(0, 10);
};
const dateNo = (iso: string | null | undefined): number | null => {
  const d = parseIsoDate(iso);
  return d ? monthNo(d.getUTCFullYear(), d.getUTCMonth()) : null;
};
const dueOf = (period: string, quarterly: boolean): number => {
  const [m, y] = period.split('/').map(Number);
  return Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, quarterly ? 22 : 20);
};
const days = (from: number, to: number) => Math.max(0, Math.round((to - from) / 86_400_000));

/** The use history in date order; empty when the register has none (the asset's class throughout). */
const historyOf = (a: CapitalGoodsAsset) =>
  (a.useHistory ?? []).filter((h) => !!parseIsoDate(h.fromDate)).slice().sort((x, y) => x.fromDate.localeCompare(y.fromDate));

/** The asset's use class on a date ("YYYY-MM-DD"). */
export const useClassOn = (a: CapitalGoodsAsset, iso: string): UseClass => {
  const h = historyOf(a);
  if (!h.length) return a.useClass;
  let cls = h[0].useClass;
  h.forEach((x) => { if (x.fromDate <= iso) cls = x.useClass; });
  return cls;
};

/**
 * Tc of the asset and how it was reached: the register's credit, or, where
 * the asset first came into common use from exempt-only / non-business use
 * (rule 43(1)(c) proviso, credit not taken until then), that credit less 5
 * points for every quarter or part from the invoice to the change.
 */
export const tcOf = (a: CapitalGoodsAsset): { tc: Tax; quarters: number | null; from: string | null } => {
  const itc = clean(a.itc);
  const h = historyOf(a);
  let prev: UseClass | null = null;
  for (const x of h) {
    if (x.useClass === 'common' && prev === 'exempt_or_non_business') {
      const q = quartersOrPart(a.invoiceDate, x.fromDate);
      return { tc: q === null ? itc : clean(reduceByQuarters({ ...itc } as Record<string, number>, q) as Partial<Tax>), quarters: q, from: x.fromDate };
    }
    if (x.useClass === 'common') return { tc: itc, quarters: null, from: null };
    prev = x.useClass;
  }
  return { tc: itc, quarters: null, from: null };
};

// ─── Inputs and result ──────────────────────────────────────────────────────

export interface Rule43PeriodIn {
  key: string;
  label: string;
  months: MonthKey[];
  /** MM/YYYY of the period's GSTR-3B. */
  period: string;
  /** The Rule 42 working's E ÷ F for the period. */
  ratio: number;
}

export interface Rule43Input {
  financialYear: string;
  quarterly: boolean;
  doc: Rule42Doc;
  assets: CapitalGoodsAsset[];
  periods: Rule43PeriodIn[];
  /** MM/YYYY of the return that settles what is still due (the Rule 42 posting period). */
  postingPeriod: string;
  /** The year's capital goods credit tagged on Purchases / RCM (the Rule 42 working's CG). */
  cgTagged: Tax;
}

export interface Rule43Asset {
  id: string;
  description: string;
  invoiceDate: string | null;
  /** Use class at the year end (or on disposal). */
  useClass: UseClass;
  tc: Tax;
  /** Quarters taken off Tc (exempt-only → common), else null. */
  quarters: number | null;
  tm: Tax;
  /** Months of the year the asset is in Tr. */
  monthsInYear: number;
  /** Months of the 60 used up by the year end (from the invoice month), at most 60. */
  lifeUsed: number;
  /** This year's Tr from the asset, and its share of Te. */
  tr: Tax;
  te: Tax;
  /** Why the asset is out of Tr this year, if it is. */
  excluded: string | null;
  issues: string[];
}

export interface Rule43Period {
  key: string;
  label: string;
  months: MonthKey[];
  period: string;
  ratio: number;
  tr: Tax;
  te: Tax;
  reversed: Tax;
  short: Tax;
  notUtilised: boolean;
  interestDays: number;
  interest: Tax;
}

export interface Rule43Result {
  assets: Rule43Asset[];
  /** Assets in Tr for some month of the year. */
  commonCount: number;
  periods: Rule43Period[];
  tr: Tax;
  te: Tax;
  reversed: Tax;
  /** Σ Te − reversed in the GSTR-3Bs. */
  net: Tax;
  payable: Tax;
  /** Reversed more than Σ Te: may be taken back. */
  recredit: Tax;
  interest: Tax;
  /** What GSTR-9 7D takes: the override, else Σ Te. */
  t7D: Tax;
  t7DSource: 'working' | 'override';
  warnings: string[];
}

// ─── The computation ────────────────────────────────────────────────────────

export function computeRule43(input: Rule43Input): Rule43Result {
  const { financialYear: fy, doc, quarterly } = input;
  const warnings: string[] = [];
  const fyNos = FY_MONTHS.map((m) => fyMonthNo(fy, m));
  const fyEnd = fyNos[11];

  // Tm of each asset for each month of the year (zero where it is not in Tr).
  const perMonth: Record<string, Tax[]> = {};
  const assets: Rule43Asset[] = input.assets.map((a) => {
    const issues: string[] = [];
    const inv = dateNo(a.invoiceDate);
    const disp = a.disposalType ? dateNo(a.disposalDate) : null;
    const { tc, quarters } = tcOf(a);
    const tm = round(scale(tc, 1 / USEFUL_LIFE_MONTHS));
    const months = fyNos.map((no) => {
      if (inv === null || no < inv || no >= inv + USEFUL_LIFE_MONTHS) return false;
      if (disp !== null && no >= disp) return false;
      return useClassOn(a, isoOfMonthEnd(no)) === 'common';
    });
    const everCommon = a.useClass === 'common' || historyOf(a).some((h) => h.useClass === 'common');
    let excluded: string | null = null;
    if (a.itcRoute === 'not_taken') excluded = 'No credit taken';
    else if (inv === null) {
      excluded = 'No invoice date';
      if (everCommon) issues.push('Type the invoice date: the 60 months run from it.');
    } else if (inv > fyEnd) excluded = 'Bought after the year';
    else if (fyNos[0] >= inv + USEFUL_LIFE_MONTHS) excluded = 'Useful life over';
    else if (disp !== null && disp <= fyNos[0]) excluded = 'Disposed of before the year';
    else if (!months.some(Boolean)) excluded = 'Not in common use this year';
    const on = !excluded && a.itcRoute !== 'not_taken';
    perMonth[a.id] = months.map((m) => (on && m ? tm : T()));
    const n = on ? months.filter(Boolean).length : 0;
    if (on && total(tc) <= 0) issues.push('Common use but no ITC typed on the asset.');
    const endNo = disp !== null ? Math.min(disp, fyEnd) : fyEnd;
    // Change of use away from common: the law gives no annual re-computation; the firm reviews it (position 40).
    const h = historyOf(a);
    for (let k = 1; k < h.length; k++) {
      if (h[k - 1].useClass === 'common' && h[k].useClass !== 'common' && dateNo(h[k].fromDate) !== null
        && (dateNo(h[k].fromDate) as number) >= fyNos[0] && (dateNo(h[k].fromDate) as number) <= fyEnd) {
        issues.push(`Left common use on ${h[k].fromDate.split('-').reverse().join('-')}: review the credit for the rest of its life (s.17(2), rule 43 has no re-computation).`);
      }
    }
    return {
      id: a.id,
      description: a.description,
      invoiceDate: a.invoiceDate,
      useClass: useClassOn(a, isoOfMonthEnd(endNo)),
      tc: round(tc),
      quarters,
      tm,
      monthsInYear: n,
      lifeUsed: inv === null ? 0 : Math.max(0, Math.min(USEFUL_LIFE_MONTHS, endNo - inv + 1)),
      tr: round(scale(tm, n)),
      te: T(),
      excluded: on ? null : excluded,
      issues,
    };
  });

  const mm = (m: MonthKey) => doc.months?.[m];
  const periods: Rule43Period[] = input.periods.map((p) => {
    const idx = p.months.map((m) => FY_MONTHS.indexOf(m));
    const tr = round(add(...input.assets.map((a) => add(...idx.map((i) => perMonth[a.id][i])))));
    const ratio = Math.min(Math.max(p.ratio, 0), 1);
    const te = round(scale(tr, ratio));
    const reversed = round(add(...p.months.map((m) => tin(mm(m)?.reversed43))));
    const last = mm(p.months[p.months.length - 1]);
    return {
      key: p.key, label: p.label, months: p.months, period: p.period, ratio, tr, te, reversed,
      short: round(sub(te, reversed)), notUtilised: !!last?.notUtilised, interestDays: 0, interest: T(),
    };
  });

  // Each asset's share of Te, period by period (for the register view and the paper).
  assets.forEach((a) => {
    a.te = round(add(...periods.map((p) => scale(add(...p.months.map((m) => perMonth[a.id][FY_MONTHS.indexOf(m)])), p.ratio))));
  });

  const postingDue = dueOf(input.postingPeriod, false);
  periods.forEach((p) => {
    if (p.notUtilised) return;
    p.interestDays = days(dueOf(p.period, quarterly), postingDue);
    p.interest = round(scale(pos(p.short), (INTEREST_RATE_50 * p.interestDays) / 365));
  });

  const tr = round(add(...periods.map((p) => p.tr)));
  const te = round(add(...periods.map((p) => p.te)));
  const reversed = round(add(...periods.map((p) => p.reversed)));
  const net = round(sub(te, reversed));
  const commonCount = assets.filter((a) => a.monthsInYear > 0).length;

  if (total(input.cgTagged) > 0.5 && commonCount === 0 && total(te) <= 0) {
    warnings.push('Capital goods credit is taken this year but the capital goods register has no asset in common use: add the assets used for both taxable and exempt supplies, or Rule 43 reverses nothing.');
  }
  assets.forEach((a) => a.issues.forEach((i) => warnings.push(`${a.description || 'Asset'}: ${i}`)));
  periods.forEach((p) => {
    if (HEADS.some((h) => p.reversed[h] - p.te[h] > 0.5)) warnings.push(`${p.label}: more reversed under Rule 43 than Te.`);
  });

  const override = doc.final7D ? tin(doc.final7D) : null;
  return {
    assets,
    commonCount,
    periods,
    tr,
    te,
    reversed,
    net,
    payable: pos(net),
    recredit: pos(map(net, (v) => -v)),
    interest: round(add(...periods.map((p) => p.interest))),
    t7D: override ?? te,
    t7DSource: override ? 'override' : 'working',
    warnings,
  };
}
