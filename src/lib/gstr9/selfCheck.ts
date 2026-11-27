// The preparer's self-validation of a GSTR-9 / 9C working (the firm, 25 Nov 2026).
//
// Before a working goes to the verifier, the preparer answers every question
// below that applies to the client and year: Yes, No (with a remark saying why
// and what is being done) or, where the question allows it, Not applicable.
// Only the preparer is asked, and only until the working is marked
// prepared: the verifier and the final review see the answers, never the
// questions (Kunal, 26 Nov 2026).
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

const QUARTERS: Array<(typeof FY_MONTHS)[number][]> = [['apr', 'may', 'jun'], ['jul', 'aug', 'sep'], ['oct', 'nov', 'dec'], ['jan', 'feb', 'mar']];

/** Active months whose as-filed GSTR-3B is not in the working (a quarterly 3B covers its quarter; a part-year working asks only for its active months). */
const missing3B = (w: Workings): string[] => {
  const qEnds = new Set([...w.quarterly.out, ...w.quarterly.itc]);
  return FY_MONTHS.filter((m) => (w.activeMonths ?? FY_MONTHS).includes(m) && !w.monthsPresent[m]?.any && !QUARTERS.some((q) => q.includes(m) && qEnds.has(q[2])));
};

/** 31 December after the FY ends (s.44 due date of GSTR-9 / 9C), as yyyy-mm-dd; '2025-26' → '2026-12-31'. */
export const annualDueDate = (financialYear: string): string | null => {
  const y = Number(/^(\d{4})/.exec(financialYear)?.[1]);
  return Number.isFinite(y) && y > 2000 ? `${y + 1}-12-31` : null;
};

/**
 * Only what the app cannot check itself and what would otherwise let a wrong
 * GSTR-9 / 9C be filed (Kunal, 26 Nov 2026: "only ask those questions which
 * are really relevant"). Questions the figures already answer are asked only
 * when the figures show a gap (portal_fetched, rcm_paid, tax_paid, late_fee);
 * the generic "have you checked Tables 4 to 19" and "do the 9C reasons read
 * well" questions are gone (the open-difference check and the 9C form-reason
 * rule already hold them), and the 9C signatory is shown on the accounts question.
 */
export const SELF_CHECK_QUESTIONS: SelfCheckQuestion[] = [
  {
    key: 'portal_fetched',
    step: 'portal',
    short: 'Missing portal figures explained',
    question: 'Some portal figures are not in the working (see below). Is that because the client was not registered, or did not have to file, for that period?',
    allowNa: false,
    applies: ({ w }) => missing3B(w).length > 0 || !(w.g9.t4Source === 'portal'),
    hint: ({ w }) => {
      const m = missing3B(w);
      return [
        !(w.g9.t4Source === 'portal') ? 'GSTR-9 system-computed figures not fetched.' : '',
        m.length ? `GSTR-3B not in the working for ${m.map((x) => MONTH_WORD[x]).join(', ')}.` : '',
      ].filter(Boolean).join(' ') + ' Fetch them on the Portal step if they exist.';
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
    short: 'Blocked ITC reversed',
    question: 'Is all blocked and ineligible ITC (s.17(5), s.16(4), Rules 37, 38, 42 and 43) either reversed in the GSTR-3Bs or shown in Table 7?',
    allowNa: true,
    hint: ({ w }) => `Table 7 total reversed (7I): ${inr(totalTax(w.g9.t7I))}.`,
  },
  {
    key: 'rcm_paid',
    step: 'rcm',
    short: 'Reverse charge paid',
    question: 'Is the tax on every reverse-charge supply paid in cash, and its ITC taken only after that payment?',
    allowNa: false,
    applies: ({ w }) => anyNonZero(w.rcm.partA) || anyNonZero(w.rcm.partB),
  },
  {
    key: 'hsn',
    step: 'gstr9',
    short: 'HSN summary filled',
    question: 'Is the HSN-wise summary (Tables 17 and 18) filled from the books at the required number of digits?',
    allowNa: true,
  },
  {
    key: 'late_fee',
    step: 'gstr9',
    short: 'Late fee worked out',
    question: 'The due date has passed. Is the late fee u/s 47 worked out and told to the client?',
    allowNa: false,
    applies: ({ w }) => {
      const due = annualDueDate(w.ctx.financialYear);
      return !!due && new Date().toISOString().slice(0, 10) > due;
    },
  },
  {
    key: 'tax_paid',
    step: 'payables',
    short: 'Additional tax paid',
    question: 'Part of the additional tax found in this working is not yet set off in the system. Has it been paid (DRC-03 or a later GSTR-3B), with interest u/s 50, or is it to be paid before filing?',
    allowNa: false,
    applies: ({ w }) => totalTax(w.payables.totals.balance) > 0.004,
    hint: ({ w }) => {
      const t = w.payables.totals;
      return `Payable ${inr(totalTax(t.payable))}; set off ${inr(totalTax(t.setOff))}; ${inr(totalTax(t.balance))} still not set off.`;
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
    key: 'gstr9c_signatory',
    step: 'gstr9c',
    short: 'Audited accounts in hand',
    question: 'Are the audited financial statements to upload with GSTR-9C in hand (the final signed version), and is the verification (signatory, place) filled?',
    allowNa: false,
    applies: ({ file9c }) => file9c,
    hint: ({ gstr9c }) => (gstr9c.certification?.signatory_name?.trim() ? `Signatory: ${gstr9c.certification.signatory_name.trim()}.` : 'No signatory filled on the GSTR-9C step yet.'),
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
