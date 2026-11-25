// The preparer's self-validation of a GSTR-9 / 9C working (the firm, 25 Nov 2026).
//
// Before a working goes to the verifier, the preparer answers every question
// below that applies to the client and year: Yes, No (with a remark saying why
// and what is being done) or, where the question allows it, Not applicable.
// Each question is asked on the step it concerns (StepSelfCheck under the
// step) and every one still unanswered is put to the preparer again in the
// Mark prepared dialog. Alongside the questions are checks the app makes
// itself: no difference is open (a 9C difference needs its form reasons too)
// and, when GSTR-9C is filed, its portal JSON has no error.
//
// Answers live in the doc `selfcheck` (annual_return_docs). Mark prepared
// writes `submitted` (what was required and what the app's checks found) and
// the database refuses to mark it prepared unless every question in
// SELF_CHECK_CORE and in `submitted.required` is answered, a No carries a
// remark and the app found nothing open (migration 20261125100000). Pure; no I/O.

import type { StepKey, Workings } from './engine';
import { totalTax } from './engine';
import type { Gstr9cDoc, SelfCheckAnswer, SelfCheckDoc, SelfCheckEntry } from './types';
import { FY_MONTHS } from './types';

export type { SelfCheckAnswer, SelfCheckEntry, SelfCheckSubmitted, SelfCheckDoc } from './types';

/** Shortest remark a No may carry (the database checks the same). */
export const SELF_CHECK_NOTE_MIN = 5;

export interface SelfCheckContext {
  w: Workings;
  gstr9c: Gstr9cDoc;
  /** GSTR-9C is filed (or that is not yet known). */
  file9c: boolean;
}

export interface SelfCheckQuestion {
  key: string;
  /** The step that asks it. */
  step: StepKey;
  /** Short heading for lists and the working papers. */
  short: string;
  question: string;
  allowNa: boolean;
  /** What the working shows that bears on the answer (null = nothing to add). */
  hint?: (c: SelfCheckContext) => string | null;
  /** When the question applies; always when omitted. */
  applies?: (c: SelfCheckContext) => boolean;
}

const inr = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;

const anyNonZero = (v: unknown): boolean => {
  if (typeof v === 'number') return Math.abs(v) > 0.004;
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).some(anyNonZero);
  return false;
};

const MONTH_WORD: Record<string, string> = {
  apr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec', jan: 'Jan', feb: 'Feb', mar: 'Mar',
};

export const SELF_CHECK_QUESTIONS: SelfCheckQuestion[] = [
  {
    key: 'portal_fetched',
    step: 'portal',
    short: 'Portal figures fetched',
    question: 'Are the GSTR-9 system-computed figures and the as-filed GSTR-3B of every month the client was registered fetched from the portal for this FY?',
    allowNa: false,
    hint: ({ w }) => {
      const missing = FY_MONTHS.filter((m) => !w.monthsPresent[m]?.any);
      return missing.length ? `GSTR-3B not in the working for ${missing.map((m) => MONTH_WORD[m]).join(', ')}.` : 'GSTR-3B is in the working for all 12 months.';
    },
  },
  {
    key: 'books_agree',
    step: 'sales',
    short: 'Books agree with audited accounts',
    question: 'Do the books figures used here (sales, purchases, Duties & Taxes, RCM) agree with the audited financial statements and the trial balance?',
    allowNa: false,
  },
  {
    key: 'itc_ineligible',
    step: 'itc',
    short: 'Ineligible ITC reversed',
    question: 'Is ineligible and blocked ITC (s.17(5), s.16(4), Rules 37, 42 and 43) reversed in the GSTR-3Bs or shown in Table 7?',
    allowNa: true,
  },
  {
    key: 'rcm_paid',
    step: 'rcm',
    short: 'Reverse charge paid',
    question: 'Is the tax on every reverse-charge supply paid in cash, and its ITC taken only after that payment?',
    allowNa: true,
  },
  {
    key: 'gstr9_tables',
    step: 'gstr9',
    short: 'GSTR-9 Tables 4 to 19 checked',
    question: 'Are GSTR-9 Tables 4 to 19 checked, including the previous year’s transactions declared in Part V (Tables 10 to 14)?',
    allowNa: false,
  },
  {
    key: 'hsn',
    step: 'gstr9',
    short: 'HSN summary filled',
    question: 'Is the HSN-wise summary of outward and inward supplies (Tables 17 and 18) filled from the books at the required number of digits?',
    allowNa: true,
  },
  {
    key: 'late_fee',
    step: 'gstr9',
    short: 'Late fee worked out',
    question: 'If the return is filed after its due date, is the late fee u/s 47 worked out and told to the client?',
    allowNa: true,
  },
  {
    key: 'tax_paid',
    step: 'payables',
    short: 'Additional tax paid',
    question: 'Has the additional tax payable found in this working been paid (DRC-03 or a later GSTR-3B), with interest u/s 50?',
    allowNa: false,
    applies: ({ w }) => totalTax(w.payables.totals.payable) > 0.004,
    hint: ({ w }) => {
      const t = w.payables.totals;
      const bal = totalTax(t.balance);
      return `Payable ${inr(totalTax(t.payable))}; set off ${inr(totalTax(t.setOff))}; ${bal > 0.004 ? `${inr(bal)} still not set off` : 'nothing left to set off'}.`;
    },
  },
  {
    key: 'gstr9c_liability_paid',
    step: 'gstr9c',
    short: 'GSTR-9C liability paid',
    question: 'Is the additional liability in GSTR-9C (Tables 11 and 16, Part V) paid through DRC-03?',
    allowNa: false,
    applies: ({ file9c, gstr9c }) => file9c && (anyNonZero(gstr9c.t11) || anyNonZero(gstr9c.t16) || anyNonZero(gstr9c.partV)),
  },
  {
    key: 'gstr9c_reasons',
    step: 'gstr9c',
    short: 'GSTR-9C reasons as filed',
    question: 'Do the reasons in GSTR-9C Tables 6, 8, 10, 13 and 15 read as they should in the filed statement, agreed with the client?',
    allowNa: true,
    applies: ({ file9c }) => file9c,
  },
  {
    key: 'gstr9c_signatory',
    step: 'gstr9c',
    short: 'GSTR-9C verification and accounts',
    question: 'Are the GSTR-9C verification details (signatory, place, address) filled, and are the audited financial statements to upload with it in hand?',
    allowNa: false,
    applies: ({ file9c }) => file9c,
  },
];

/** Asked of every working; the database requires these whatever the app sends. */
export const SELF_CHECK_CORE: string[] = SELF_CHECK_QUESTIONS.filter((q) => !q.applies).map((q) => q.key);

export const ANSWER_LABEL: Record<SelfCheckAnswer, string> = { yes: 'Yes', no: 'No', na: 'Not applicable' };

export interface SelfCheckItem {
  q: SelfCheckQuestion;
  entry: SelfCheckEntry | null;
  hint: string | null;
  /** Why it is not yet answered well enough (null = answered). */
  problem: string | null;
}

export interface SelfCheckAuto {
  key: 'differences' | 'json';
  label: string;
  ok: boolean;
  detail: string;
  /** Where it is fixed. */
  step: StepKey;
}

export interface SelfCheckStatus {
  items: SelfCheckItem[];
  auto: SelfCheckAuto[];
  /** Questions still to answer. */
  pending: number;
  /** Every question answered and every check passed. */
  ok: boolean;
  required: string[];
}

export const entryProblem = (q: SelfCheckQuestion, e: SelfCheckEntry | null | undefined): string | null => {
  if (!e || !e.answer) return 'Not answered';
  if (e.answer === 'na' && !q.allowNa) return 'Answer Yes or No';
  if (e.answer === 'no' && (e.note ?? '').trim().length < SELF_CHECK_NOTE_MIN) return 'Say why, and what is being done';
  return null;
};

export function selfCheckStatus(c: SelfCheckContext, doc: SelfCheckDoc | null | undefined, opts: { jsonErrors?: number } = {}): SelfCheckStatus {
  const answers = doc?.answers ?? {};
  const items = SELF_CHECK_QUESTIONS.filter((q) => !q.applies || q.applies(c)).map((q) => {
    const entry = answers[q.key] ?? null;
    return { q, entry, hint: q.hint ? q.hint(c) : null, problem: entryProblem(q, entry) };
  });
  const open = c.w.openCount;
  const jsonErrors = c.file9c ? opts.jsonErrors ?? 0 : 0;
  const auto: SelfCheckAuto[] = [
    {
      key: 'differences', step: 'review', ok: open === 0,
      label: 'Every difference is matched, within tolerance or explained, and a GSTR-9C difference has its reasons in the form',
      detail: open === 0 ? 'No difference is open.' : `${open} difference${open === 1 ? ' is' : 's are'} open.`,
    },
  ];
  if (c.file9c) {
    auto.push({
      key: 'json', step: 'gstr9c', ok: jsonErrors === 0,
      label: 'The GSTR-9C portal JSON passes the offline utility’s checks',
      detail: jsonErrors === 0 ? 'No error.' : `${jsonErrors} error${jsonErrors === 1 ? '' : 's'} on the Portal JSON tab.`,
    });
  }
  const pending = items.filter((i) => i.problem).length;
  return { items, auto, pending, ok: pending === 0 && auto.every((a) => a.ok), required: items.map((i) => i.q.key) };
}

/** The questions a step asks. */
export const itemsForStep = (s: SelfCheckStatus, step: StepKey): SelfCheckItem[] => s.items.filter((i) => i.q.step === step);
