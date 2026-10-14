// Builder — final ITC reversal at completion under Rules 42 and 43.
// Pure engine; data access is src/lib/builderItcReversalData.ts, the page is
// src/pages/BuilderItcReversalPage.tsx, and the elected positions are in
// docs/BUILDER_GST_POSITIONS.md §7A.
//
// At BU / completion the units still unbooked will be sold after completion,
// which Schedule III para 5 keeps outside supply; s.17(3) counts that as
// exempt for apportionment. For construction the Rule 42/43 key is carpet
// area, so for each financial year of the project:
//
//   reversal (Rule 42) = common credit on inputs and input services × Te/Tt
//                        − already reversed that year under Rule 42
//   reversal (Rule 43) = common credit on capital goods × Te/Tt
//                        − already reversed that year under Rule 43
//
// Common credit follows GSTR-9 Tables 6 and 7: credit availed (6O) less what
// Table 7 reversed under any head other than Rules 42/43 (7A Rule 37, 7B
// Rule 39, 7E s.17(5), 7F/7G TRAN, 7H other) — that credit was never common.
// So the base is 7J + 7C + 7D, and 7C/7D are what was already reversed.
//
// Te = carpet area exempt (unbooked at completion, plus residential carpet for
// a Partial-ITC REP, whose residential share is exempt throughout), Tt = total
// carpet area of the project. A negative net (more reversed over the years
// than the final figure) comes back as a re-credit.

export interface Tax { i: number; c: number; s: number; x: number }
export const ZERO: Tax = { i: 0, c: 0, s: 0, x: 0 };
export const HEADS: (keyof Tax)[] = ['i', 'c', 's', 'x'];
export const HEAD_LABEL: Record<keyof Tax, string> = { i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess' };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const tax = (t?: Partial<Tax> | null): Tax => ({
  i: Number(t?.i) || 0, c: Number(t?.c) || 0, s: Number(t?.s) || 0, x: Number(t?.x) || 0,
});
export const add = (a: Tax, b: Tax): Tax => ({ i: r2(a.i + b.i), c: r2(a.c + b.c), s: r2(a.s + b.s), x: r2(a.x + b.x) });
export const sub = (a: Tax, b: Tax): Tax => ({ i: r2(a.i - b.i), c: r2(a.c - b.c), s: r2(a.s - b.s), x: r2(a.x - b.x) });
export const scale = (a: Tax, k: number): Tax => ({ i: r2(a.i * k), c: r2(a.c * k), s: r2(a.s * k), x: r2(a.x * k) });
export const total = (a: Tax) => r2(a.i + a.c + a.s + a.x);

// ─── Financial years ────────────────────────────────────────────────────────

/** '2026-09-24' → '2026-27'. */
export const fyOfDate = (date: string): string => {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const fyStart = (fy: string) => Number(fy.slice(0, 4));
export const fyLabel = (fy: string) => `FY ${fy}`;

/** Every FY from `from` to `to`, inclusive. */
export const fyRange = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let y = fyStart(from); y <= fyStart(to); y += 1) out.push(`${y}-${String((y + 1) % 100).padStart(2, '0')}`);
  return out;
};

/**
 * The first year of the working: the project's registration or 01/04/2019,
 * whichever is later — the construction scheme (and its carpet-area key)
 * starts on 01/04/2019; earlier credit is outside these rules here.
 */
export const defaultStartFy = (registrationDate: string | null | undefined): string => {
  const scheme = '2019-04-01';
  const d = registrationDate && registrationDate > scheme ? registrationDate : scheme;
  return fyOfDate(d);
};

/** Latest GSTR-3B period the final reversal may go into: September after the BU FY ends. */
export const latestPostingPeriod = (buFy: string): string => `09/${fyStart(buFy) + 1}`;

const periodKey = (p: string) => { const [m, y] = p.split('/'); return Number(y) * 100 + Number(m); };

// ─── Inputs ─────────────────────────────────────────────────────────────────

export type Gstr9Match = 'UNVERIFIED' | 'MATCHED_DATA' | 'CONFIRMED';

/** GSTR-9 Table 7 heads other than 7C (Rule 42) and 7D (Rule 43). */
export type T7Key = 'a' | 'b' | 'e' | 'f' | 'g' | 'h';
export type T7Other = Record<T7Key, Tax>;
export const T7_KEYS: T7Key[] = ['a', 'b', 'e', 'f', 'g', 'h'];
export const T7_LABEL: Record<T7Key, string> = {
  a: '7A — Rule 37 (payment not made in 180 days)',
  b: '7B — Rule 39 (ISD)',
  e: '7E — Section 17(5) (blocked)',
  f: '7F — Reversal of TRAN-I credit',
  g: '7G — Reversal of TRAN-II credit',
  h: '7H — Other reversals',
};
export const t7 = (v?: Partial<Record<T7Key, Partial<Tax>>> | null): T7Other => ({
  a: tax(v?.a), b: tax(v?.b), e: tax(v?.e), f: tax(v?.f), g: tax(v?.g), h: tax(v?.h),
});
export const t7Sum = (v: T7Other): Tax => T7_KEYS.reduce((a, k) => add(a, v[k]), ZERO);
const floor0 = (a: Tax): Tax => ({ i: Math.max(0, a.i), c: Math.max(0, a.c), s: Math.max(0, a.s), x: Math.max(0, a.x) });

export interface YearInput {
  financialYear: string;
  isBuYear: boolean;
  inputsServices: Tax;   // Rule 42 common credit
  capitalGoods: Tax;     // Rule 43 common credit
  reversedR42: Tax;      // already reversed (GSTR-9 7C)
  reversedR43: Tax;      // already reversed (GSTR-9 7D)
  otherReversed: T7Other; // GSTR-9 7A, 7B, 7E–7H
  /** 7I as in the filed GSTR-9, when only Table 7's total was read: the rows typed must add up to it. */
  filed7i?: Tax | null;
  gstr9Arn: string | null;
  gstr9Match: Gstr9Match;
}

/** What the app already holds for a FY, to check the entries against. */
export interface YearReference {
  financialYear: string;
  /** Total ITC availed per the app's data, and where it came from. */
  availed: Tax | null;
  source: 'GSTR-9 as filed (portal)' | 'GSTR-9 Table 6A' | 'GSTR-3B Table 4A (as filed)' | null;
  months: number;
}

export interface WorkingInput {
  completionDate: string;
  totalCarpet: number;
  exemptCarpet: number;
  postingPeriod: string;
  includeInterest: boolean;
  years: YearInput[];
  references: Record<string, YearReference>;
}

// ─── Result ─────────────────────────────────────────────────────────────────

export interface YearResult extends YearInput {
  /** 6O: total credit availed. */
  availed: Tax;
  /** 7I: total reversed, 7A to 7H. */
  t7i: Tax;
  /** 7J: net credit available, 6O − 7I. */
  t7j: Tax;
  /** Rule 42 / 43 common credit: 6O less the non-42/43 reversals (= 7J + 7C + 7D). */
  baseR42: Tax;
  baseR43: Tax;
  attributableR42: Tax;
  attributableR43: Tax;
  netR42: Tax;
  netR43: Tax;
  net: Tax;
  interestDays: number;
  interest: Tax;
  reference: YearReference | null;
  /** Entered availed less the app's reference — null when there is none. */
  referenceDiff: Tax | null;
}

export interface WorkingResult {
  ratio: number;
  years: YearResult[];
  totalNet: Tax;
  totalInterest: Tax;
  /** GSTR-3B rows the approval writes. */
  lines: { tableRef: '4B(1)' | '4A(5)'; label: string; amount: Tax; reason: string }[];
  problems: string[];
  warnings: string[];
}

/** Interest u/s 50 runs from 1 April after the FY to the due date of the posting period's GSTR-3B (20th of next month). */
const interestDaysFor = (fy: string, postingPeriod: string, isBuYear: boolean): number => {
  if (isBuYear) return 0;
  const from = Date.UTC(fyStart(fy) + 1, 3, 1);
  const [m, y] = postingPeriod.split('/').map(Number);
  const due = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 20);
  return Math.max(0, Math.round((due - from) / 86_400_000));
};

export const INTEREST_RATE = 0.18;

export function computeItcReversal(input: WorkingInput): WorkingResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const ratio = input.totalCarpet > 0 ? Math.min(1, Math.max(0, input.exemptCarpet / input.totalCarpet)) : 0;
  if (!(input.totalCarpet > 0)) problems.push('The total carpet area of the project is nil — check the unit master.');

  const buFy = fyOfDate(input.completionDate);
  const years: YearResult[] = input.years.map((y) => {
    const other = t7Sum(y.otherReversed);
    const availed = add(y.inputsServices, y.capitalGoods);
    const t7i = add(add(y.reversedR42, y.reversedR43), other);
    const t7j = sub(availed, t7i);
    // The non-42/43 reversals come out of inputs first, then capital goods.
    const baseR42 = floor0(sub(y.inputsServices, other));
    const baseR43 = floor0(sub(y.capitalGoods, floor0(sub(other, y.inputsServices))));
    const attributableR42 = scale(baseR42, ratio);
    const attributableR43 = scale(baseR43, ratio);
    const netR42 = sub(attributableR42, y.reversedR42);
    const netR43 = sub(attributableR43, y.reversedR43);
    const net = add(netR42, netR43);
    const interestDays = input.includeInterest ? interestDaysFor(y.financialYear, input.postingPeriod, y.isBuYear) : 0;
    const positive: Tax = { i: Math.max(0, net.i), c: Math.max(0, net.c), s: Math.max(0, net.s), x: Math.max(0, net.x) };
    const interest = scale(positive, (INTEREST_RATE * interestDays) / 365);
    const reference = input.references[y.financialYear] ?? null;
    const referenceDiff = reference?.availed ? sub(availed, reference.availed) : null;

    if (!y.isBuYear) {
      if (y.gstr9Match === 'UNVERIFIED') {
        problems.push(`${fyLabel(y.financialYear)}: enter Table 7 from the filed GSTR-9 and tick that it has been checked.`);
      }
      if (y.filed7i) {
        const d = sub(t7i, y.filed7i);
        const off = HEADS.filter((h) => Math.abs(d[h]) > 1);
        if (off.length) {
          problems.push(`${fyLabel(y.financialYear)}: Table 7 rows add up to 7I ${off.map((h) => `${HEAD_LABEL[h]} ${t7i[h].toFixed(2)}`).join(', ')}, but the filed GSTR-9 shows 7I ${off.map((h) => `${HEAD_LABEL[h]} ${y.filed7i![h].toFixed(2)}`).join(', ')}.`);
        }
      }
      if (y.gstr9Match === 'CONFIRMED' && !(y.gstr9Arn || '').trim()) {
        problems.push(`${fyLabel(y.financialYear)}: give the ARN of the GSTR-9 the figures were matched with.`);
      }
      if (referenceDiff && HEADS.some((h) => Math.abs(referenceDiff[h]) > 1)) {
        warnings.push(
          `${fyLabel(y.financialYear)}: ITC entered differs from ${reference?.source} by `
          + `${HEADS.filter((h) => Math.abs(referenceDiff[h]) > 1).map((h) => `${HEAD_LABEL[h]} ${referenceDiff[h].toFixed(2)}`).join(', ')}`
          + ' — explain it in the remarks (e.g. ITC of another project or blocked credit).',
        );
      }
    }
    return { ...y, availed, t7i, t7j, baseR42, baseR43, attributableR42, attributableR43, netR42, netR43, net, interestDays, interest, reference, referenceDiff };
  });

  const want = fyRange(years[0]?.financialYear ?? buFy, buFy);
  const missing = want.filter((fy) => !years.some((y) => y.financialYear === fy));
  if (missing.length) problems.push(`No figures for ${missing.map(fyLabel).join(', ')}.`);

  if (periodKey(input.postingPeriod) < periodKey(`${input.completionDate.slice(5, 7)}/${input.completionDate.slice(0, 4)}`)) {
    problems.push('The reversal cannot go into a GSTR-3B before the BU month.');
  }
  if (periodKey(input.postingPeriod) > periodKey(latestPostingPeriod(buFy))) {
    warnings.push(`${input.postingPeriod} is after ${latestPostingPeriod(buFy)}, the September following the year of completion.`);
  }

  const totalNet = years.reduce((a, y) => add(a, y.net), ZERO);
  const totalInterest = years.reduce((a, y) => add(a, y.interest), ZERO);

  const reversal: Tax = { i: Math.max(0, totalNet.i), c: Math.max(0, totalNet.c), s: Math.max(0, totalNet.s), x: Math.max(0, totalNet.x) };
  const recredit: Tax = { i: Math.max(0, -totalNet.i), c: Math.max(0, -totalNet.c), s: Math.max(0, -totalNet.s), x: Math.max(0, -totalNet.x) };
  const span = `${fyLabel(years[0]?.financialYear ?? buFy)} to ${fyLabel(buFy)}`;
  const lines: WorkingResult['lines'] = [];
  if (total(reversal) > 0) {
    lines.push({
      tableRef: '4B(1)', label: 'Rule 42/43 final reversal at completion', amount: reversal,
      reason: `Builder: ITC on the exempt share (${(ratio * 100).toFixed(4)}% of carpet area unbooked/exempt at completion) of common credit (GSTR-9 7J + 7C + 7D) for ${span}, net of earlier Rule 42/43 reversals.`,
    });
  }
  if (total(recredit) > 0) {
    lines.push({
      tableRef: '4A(5)', label: 'Rule 42/43 final determination — excess reversed earlier', amount: recredit,
      reason: `Builder: earlier Rule 42/43 reversals for ${span} exceed the final figure at completion; the excess is re-credited.`,
    });
  }
  if (!lines.length) warnings.push('Nothing to reverse or re-credit.');

  return { ratio, years, totalNet, totalInterest, lines, problems, warnings };
}
