// Pay-to-close quote (the law audit of 26 October 2026, section C): what it
// costs today to end a demand by paying it, head by head, as the DRC-03 figures
// to enter, and the last day the reduced penalty holds. Pure; the figures come
// from the notice's own demand (gst_notices.demand, read from the portal's
// dmddtls) and its section. §36 of docs/NOTICES_LITIGATION_POSITIONS.md.
//
// The law (CGST Act, the same for SGST and, through s.20 IGST Act, IGST):
//   s.73: before the SCN or within 30 days of it, tax and interest, no penalty
//         (s.73(5), (8)); after that the order levies 10% of the tax or ₹10,000,
//         whichever is higher (s.73(9)), with no reduction after the order.
//   s.74: before the SCN 15% of the tax (s.74(5)), within 30 days of it 25%
//         (s.74(8)), within 30 days of the order 50% (s.74(11)), else 100%.
//   s.74A (FY 2024-25 onwards): no fraud, within 60 days of the SCN no penalty
//         (s.74A(8)), else 10% or ₹10,000; fraud, 15% before the SCN (s.74A(9)),
//         25% within 60 days of it (s.74A(10)), 50% within 60 days of the order
//         (s.74A(11)), else 100%.
// Interest: s.50 at 18% a year. The notice's interest runs to the date it was
// computed, about its issue date; interest on the tax keeps running from then to
// the day of payment, added here on a 365 day year (as interestLateFee.ts).

// Self-contained (no app imports), so scripts/verify-notice-section-c.mjs runs it under node.
const DAY_MS = 86_400_000;
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysBetween = (a: string, b: string) => {
  const [ay, am, ad] = a.slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = b.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
};
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export type Head = 'igst' | 'cgst' | 'sgst' | 'cess';
export const HEADS: Head[] = ['igst', 'cgst', 'sgst', 'cess'];
export const HEAD_LABEL: Record<Head, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST / UTGST', cess: 'Cess' };

export type QuoteSection = '73' | '74' | '74A';
export type QuoteStage = 'pre_scn' | 'scn' | 'order';

export interface QuoteRow {
  head: Head;
  tax: number;
  /** Interest as the notice computed it. */
  interest_notice: number;
  /** Interest on the tax from the notice's date to the day of payment. */
  interest_since: number;
  penalty: number;
  total: number;
}

export interface PayToCloseQuote {
  section: QuoteSection;
  /** s.74A only: whether the notice proposes the fraud penalty (equal to the tax). */
  fraud: boolean | null;
  stage: QuoteStage;
  asOf: string;
  rows: QuoteRow[];
  total: QuoteRow;
  /** The penalty the quote carries, as a share of the tax (null: 10% or ₹10,000, or as ordered). */
  penaltyPct: number | null;
  /** What the penalty line is. */
  penaltyBasis: string;
  /** Does paying these figures end the proceedings? */
  closes: boolean;
  /** The last day these figures hold (null: none, or until the SCN issues). */
  payBy: string | null;
  law: string;
  title: string;
  /** What follows once the window has passed. */
  next: string | null;
  /** How to pay it on the portal. */
  howToPay: string;
  notes: string[];
}

export interface QuoteNotice {
  form_code: string | null;
  section_of_law: string | null;
  financial_year: string | null;
  issue_date: string | null;
  demand: unknown;
}

const r0 = (n: number) => Math.round(n);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.-]/g, '')) : 0;
  return Number.isFinite(n) ? n : 0;
};

export const INTEREST_PCT = 18;
const MIN_PENALTY_EACH_ACT = 10_000;

/** "73", "74", "74A" from the notice's section, else from its year: a notice for FY 2024-25 onwards is under s.74A. */
export function quoteSection(section: string | null | undefined, fy: string | null | undefined): QuoteSection | null {
  const s = (section ?? '').toUpperCase().replace(/\s+/g, '');
  const m = /^(?:SECTION|SEC\.?|S\.?)?(74A|73|74)(?![0-9])/.exec(s);
  if (m) return m[1] as QuoteSection;
  const y = /^(\d{4})/.exec(fy ?? '');
  if (y && Number(y[1]) >= 2024) return '74A';
  return null;
}

export function quoteStage(form: string | null | undefined): QuoteStage | null {
  switch ((form ?? '').toUpperCase()) {
    case 'DRC-01A': return 'pre_scn';
    case 'DRC-01': return 'scn';
    case 'DRC-07': return 'order';
    default: return null;
  }
}

/** The notice's demand per head (tax, interest, penalty), as gst_notices.demand holds it. */
export function demandHeads(demand: unknown): Partial<Record<Head, { tax: number; interest: number; penalty: number }>> {
  const out: Partial<Record<Head, { tax: number; interest: number; penalty: number }>> = {};
  if (!demand || typeof demand !== 'object' || Array.isArray(demand)) return out;
  for (const h of HEADS) {
    const v = (demand as Record<string, unknown>)[h];
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const row = { tax: num(o.tax), interest: num(o.interest), penalty: num(o.penalty) };
    if (row.tax || row.interest || row.penalty) out[h] = row;
  }
  return out;
}

/** s.73(9) and s.74A(5)(i): 10% of the tax or ₹10,000, whichever is higher, for each Act; cess at 10%. */
const tenPctOrMin = (h: Head, tax: number) => (tax <= 0 ? 0 : h === 'cess' ? tax * 0.1 : Math.max(tax * 0.1, MIN_PENALTY_EACH_ACT));

interface Rule {
  pct: number | 'ten_or_min' | 'ordered';
  closes: boolean;
  payBy: string | null;
  law: string;
  title: string;
  basis: string;
  next: string | null;
}

/** Which penalty rule holds on `today` for this section, stage and notice date. */
function ruleFor(section: QuoteSection, fraud: boolean, stage: QuoteStage, issued: string, today: string): Rule {
  const d30 = addDays(issued, 30);
  const d60 = addDays(issued, 60);
  const open30 = today <= d30;
  const open60 = today <= d60;
  if (section === '73' || (section === '74A' && !fraud)) {
    const days = section === '73' ? 30 : 60;
    const by = section === '73' ? d30 : d60;
    const open = section === '73' ? open30 : open60;
    const lawOpen = section === '73' ? (stage === 'pre_scn' ? 's.73(5)' : 's.73(8)') : 's.74A(8)';
    const lawOrder = section === '73' ? 's.73(9)' : 's.74A(5)(i)';
    if (stage === 'pre_scn') {
      return { pct: 0, closes: true, payBy: null, law: lawOpen, title: 'Pay before the show cause notice: no penalty',
        basis: 'No penalty', next: `Once the SCN issues, still no penalty if paid within ${days} days of it.` };
    }
    if (stage === 'scn' && open) {
      return { pct: 0, closes: true, payBy: by, law: lawOpen, title: `Pay within ${days} days of the notice: no penalty`,
        basis: 'No penalty', next: `After ${fmt(by)} the order levies 10% of the tax or ₹10,000 for each Act, whichever is higher (${lawOrder}).` };
    }
    if (stage === 'scn') {
      return { pct: 'ten_or_min', closes: false, payBy: null, law: lawOrder, title: `The ${days} days are over: the order will levy the penalty`,
        basis: '10% of the tax or ₹10,000 for each Act, whichever is higher', next: 'Paying now still stops interest; the proceedings end with the order.' };
    }
    return { pct: 'ordered', closes: true, payBy: null, law: lawOrder, title: 'Pay the order as it stands',
      basis: 'As ordered', next: null };
  }
  // s.74, and s.74A where fraud is alleged.
  const is74 = section === '74';
  const days = is74 ? 30 : 60;
  const law = (k: 'pre' | 'scn' | 'order') => (is74 ? { pre: 's.74(5)', scn: 's.74(8)', order: 's.74(11)' } : { pre: 's.74A(9)', scn: 's.74A(10)', order: 's.74A(11)' })[k];
  if (stage === 'pre_scn') {
    return { pct: 15, closes: true, payBy: null, law: law('pre'), title: 'Pay before the show cause notice: 15% penalty',
      basis: '15% of the tax', next: `Once the SCN issues, 25% if paid within ${days} days of it (${law('scn')}).` };
  }
  if (stage === 'scn') {
    const by = is74 ? d30 : d60;
    if (is74 ? open30 : open60) {
      return { pct: 25, closes: true, payBy: by, law: law('scn'), title: `Pay within ${days} days of the notice: 25% penalty`,
        basis: '25% of the tax', next: `After ${fmt(by)} the order levies a penalty equal to the tax; ${days} days after the order, half of it (${law('order')}).` };
    }
    return { pct: 100, closes: false, payBy: null, law: is74 ? 's.74(9)' : 's.74A(5)(ii)', title: `The ${days} days are over: the order will levy the full penalty`,
      basis: 'A penalty equal to the tax', next: `Once the order issues, paid within ${days} days of it the penalty is halved (${law('order')}).` };
  }
  const by = is74 ? d30 : d60;
  if (is74 ? open30 : open60) {
    return { pct: 50, closes: true, payBy: by, law: law('order'), title: `Pay within ${days} days of the order: 50% penalty`,
      basis: '50% of the tax', next: `After ${fmt(by)} the full penalty in the order is payable.` };
  }
  return { pct: 'ordered', closes: true, payBy: null, law: is74 ? 's.74(9)' : 's.74A(5)(ii)', title: `The ${days} days after the order are over: pay the order as it stands`,
    basis: 'As ordered', next: null };
}

const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/**
 * The quote for a DRC-01A, DRC-01 or DRC-07 under s.73, s.74 or s.74A, or null
 * when the notice is of another form, has no section or no tax in its demand.
 */
export function payToCloseQuote(n: QuoteNotice, today: string = istToday(), payOn: string = today): PayToCloseQuote | null {
  const stage = quoteStage(n.form_code);
  const section = quoteSection(n.section_of_law, n.financial_year);
  if (!stage || !section || !n.issue_date) return null;
  const heads = demandHeads(n.demand);
  const taxTotal = HEADS.reduce((s, h) => s + (heads[h]?.tax ?? 0), 0);
  if (taxTotal <= 0) return null;
  const proposedPen = HEADS.reduce((s, h) => s + (heads[h]?.penalty ?? 0), 0);
  // s.74A: the fraud penalty equals the tax; the other is 10%. The notice's own figure says which.
  const fraud = section === '74A' ? proposedPen >= taxTotal * 0.9 : null;
  const rule = ruleFor(section, !!fraud, stage, n.issue_date, today);
  const days = Math.max(0, daysBetween(n.issue_date, payOn));

  const rows: QuoteRow[] = [];
  for (const h of HEADS) {
    const v = heads[h];
    if (!v) continue;
    const interestSince = r0(v.tax * (INTEREST_PCT / 100) * days / 365);
    const penalty = r0(rule.pct === 'ordered' ? v.penalty : rule.pct === 'ten_or_min' ? tenPctOrMin(h, v.tax) : v.tax * rule.pct / 100);
    rows.push({ head: h, tax: r0(v.tax), interest_notice: r0(v.interest), interest_since: interestSince, penalty,
      total: r0(v.tax) + r0(v.interest) + interestSince + penalty });
  }
  const total = rows.reduce<QuoteRow>((t, r) => ({
    head: t.head, tax: t.tax + r.tax, interest_notice: t.interest_notice + r.interest_notice,
    interest_since: t.interest_since + r.interest_since, penalty: t.penalty + r.penalty, total: t.total + r.total,
  }), { head: 'igst', tax: 0, interest_notice: 0, interest_since: 0, penalty: 0, total: 0 });

  const notes: string[] = [];
  if (total.interest_notice === 0) notes.push('The notice proposes no interest. Interest under s.50 runs from each period\'s due date anyway: work it out from the due dates before paying.');
  if (section === '74A' && stage !== 'order') notes.push(fraud
    ? 'Read as a fraud or suppression case under s.74A(5)(ii): the notice proposes a penalty equal to the tax.'
    : 'Read as a case without fraud under s.74A(5)(i): the notice proposes a penalty of about 10% of the tax.');
  if (stage === 'order' && section === '74') notes.push('Where the order was passed under s.74 but on appeal is held to fall under s.73, the s.73 penalty applies (s.75(2)).');
  if (rule.closes && stage !== 'order') notes.push('Pay the tax and interest in full: a shortfall keeps the proceedings open for the amount short (s.73(7), s.74(7)).');
  notes.push(`Interest from ${fmt(n.issue_date)} is 18% a year on the tax, to ${fmt(payOn)}; the notice's own interest is taken as computed to its date.`);

  const howToPay = stage === 'order'
    ? 'Pay against the demand ID of the order in the electronic liability register (Services, Ledgers, Payment towards demand), so the demand closes; a DRC-03 paid instead must then be adjusted in DRC-03A (rule 142(2B)).'
    : `File DRC-03 with the cause "${stage === 'pre_scn' ? 'Intimation of tax ascertained through FORM GST DRC-01A' : 'SCN'}", quoting the notice's reference, then send the DRC-03 to the officer with a request to close the proceedings (DRC-05).`;

  return {
    section, fraud, stage, asOf: payOn, rows, total,
    penaltyPct: typeof rule.pct === 'number' ? rule.pct : null, penaltyBasis: rule.basis,
    closes: rule.closes, payBy: rule.payBy, law: rule.law, title: rule.title, next: rule.next, howToPay, notes,
  };
}

/** The quote as lines to paste into an e-mail or note. */
export function quoteText(q: PayToCloseQuote, label: string): string {
  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  const lines = [
    `${label}: pay to close, as at ${fmt(q.asOf)}`,
    `${q.title} (${q.law})${q.payBy ? `, by ${fmt(q.payBy)}` : ''}.`,
    '',
    ...q.rows.map((r) => `${HEAD_LABEL[r.head]}: tax ${inr(r.tax)}, interest ${inr(r.interest_notice + r.interest_since)}, penalty ${inr(r.penalty)}, total ${inr(r.total)}`),
    `Total: ${inr(q.total.total)}`,
    '',
    q.howToPay,
  ];
  if (q.next) lines.push(q.next);
  return lines.join('\n');
}

export { fmt as fmtQuoteDate };
