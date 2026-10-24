// Reasons: the plain-English catalogue and the ordered rule sets per pair of
// sources. RULES_2A_2B is the GSTR-2A vs GSTR-2B set; the 8A pairs are declared
// (empty) for the next reports. The first rule that claims a row gives its
// reason; notes add flags and never change the status. Every reason that needs
// a neighbouring statement (next months' 2B, an earlier month's 2A) says whether
// it was checked against it ("confirmed") or only inferred, and why.
// Positions: docs/GSTR2A_2B_RECO_POSITIONS.md.
import { daysBetween, fyOfDate, fyOfPeriod, fyStartYear, periodIndex } from '@/lib/reply/periods';
import { addMonths, cutoffOf2B, dayLabel, due2BDate, monthLabel, nextPeriod, prevPeriod, type Cutoff } from './dates';
import { indexDocs, lookupAmendmentOf, lookupDoc, reconcile, signedTax, type DocIndex } from './engine';
import { findRow, SECTION_LABELS, sectionLabel, statementFromRow } from './sources';
import type {
  NoteRule, PairConfig, ReasonCode, ReasonInfo, ReasonRule, RecoDoc, RecoResult, RecoRow, SourceSet, Statement,
  StatementMeta, StatementRow,
} from './types';

// ── Catalogue ───────────────────────────────────────────────────────────────

export const REASONS: Record<ReasonCode, ReasonInfo> = {
  IN_LATER_2B: { label: 'Filed after the 2B cut-off: in a later 2B', action: 'Do not claim it this month; claim it in the GSTR-3B of the month whose 2B shows it.' },
  IMS_ACCEPTED_LATER: { label: 'Kept pending in IMS, accepted later', action: 'Claim it in the GSTR-3B of the month whose 2B shows it, not this month.' },
  EXPECTED_NEXT_2B: { label: 'Filed after the 2B cut-off: expected in a later 2B', action: 'Do not claim it this month; pull that 2B to confirm, then claim it in that month.' },
  NOT_FILED_BY_SUPPLIER: { label: 'Saved by the supplier, GSTR-1 / IFF not filed', action: 'No ITC until the supplier files; ask the supplier to file GSTR-1 / IFF.' },
  IMS_PENDING: { label: 'Filed in time but not in this 2B: pending or rejected in IMS', action: 'Check IMS: accept it and recompute the 2B before filing GSTR-3B, or it moves to a later 2B.' },
  ONLY_2A_UNEXPLAINED: { label: 'Only in 2A: no reason found', action: 'Check IMS and ask the supplier.' },
  ITC_REVERSAL: { label: 'ITC reversal (Rule 37A): supplier has not filed GSTR-3B', action: 'Reverse this ITC in Table 4(B)(2) of GSTR-3B; reclaim it in Table 4(A)(5) once the supplier files its GSTR-3B.' },
  NOT_COMPARED_SECTION: { label: 'Section not read by the 2A pull: not compared', action: 'Nothing for this comparison (the 2A pull does not read this section); check it against your books.' },
  QUARTERLY_2B: { label: 'Quarterly 2B: for an earlier month of the quarter', action: "Claim it in this quarter's GSTR-3B; pull that month's 2A to compare it." },
  EARLIER_PERIOD_IN_TIME: { label: 'For an earlier month, filed in time: kept pending in IMS, accepted later', action: "Claim it in this month's GSTR-3B; clear it from that month's not-in-2B list." },
  EARLIER_PERIOD: { label: 'Supplier filed late for an earlier month', action: "Claim it in this month's GSTR-3B; clear it from that month's not-in-2B list; check the s.16(4) time limit." },
  STALE_2A: { label: '2A pulled before the supplier filed', action: 'Pull 2A again.' },
  TWO_A_INCOMPLETE: { label: 'The 2A pull failed for this supplier', action: 'Pull 2A again.' },
  ONLY_2B_UNEXPLAINED: { label: 'Only in 2B: no reason found', action: "Check the supplier's GSTR-1 period, and pull 2A again." },
  AMENDED: { label: 'Amended by the supplier', action: 'Claim or reverse only the difference, as the 2B shows it.' },
  IMS_REJECTED: { label: 'Rejected in IMS', action: 'No ITC. If rejected by mistake: before filing that GSTR-3B, change the action to Accept in IMS and recompute the 2B; once it is filed, ask the supplier to report it again unchanged (GSTR-1A or amendment), then accept it.' },
  DATE_DIFFERS: { label: 'Same number, different date', action: 'Ask the supplier which date is right; a wrong one is corrected by amendment.' },
  CHANGED_AFTER_2B: { label: 'Changed by the supplier after the 2B was generated', action: 'Claim as this 2B shows it; the change reaches a later 2B.' },
  VALUE_DIFFERENCE: { label: 'Value or tax difference', action: "Compare with the supplier's GSTR-1 and your books; ask the supplier to amend a wrong figure." },
  MATCHED: { label: 'Same in 2A and 2B', action: 'Nothing to do.' },
  RCM: { label: 'Reverse charge', action: 'Pay the tax in 3.1(d), then claim the ITC.' },
  ITC_NA_POS: { label: 'ITC not available: place of supply', action: 'No ITC; ask the supplier to correct the place of supply if it is wrong.' },
  ITC_NA_TIME: { label: 'ITC not available: time limit u/s 16(4)', action: 'No ITC: the time limit has passed.' },
  ITC_NA_OTHER: { label: '2B says ITC not available', action: 'No ITC for this document as the 2B stands.' },
  RULE_37A: { label: 'Supplier has not filed GSTR-3B (Rule 37A)', action: 'Reverse the ITC in Table 4(B)(2): the supplier had not filed GSTR-3B by 30 September after the year; reclaim it once the supplier files.' },
  SUPPLIER_3B_PENDING: { label: "Supplier's GSTR-3B not filed yet, as of the 2A pull", action: 'Nothing yet: ITC is reversed (Rule 37A) only if the supplier has not filed it by 30 September after the year.' },
  SUPPLIER_CANCELLED: { label: 'Supplier registration cancelled', action: 'Check the document: a cancelled supplier cannot charge tax after the cancellation date.' },
  EARLIER_YEAR_DOC: { label: 'Document dated in an earlier financial year', action: 'Check the s.16(4) time limit before claiming.' },
  // A year's 2A or 2B against its GSTR-9 Table 8A (reasons8A.ts; docs/GSTR8A_RECO_POSITIONS.md)
  RCM_NOT_IN_8A: { label: 'Reverse charge: never in 8A', action: 'No 8A ITC: claim it in GSTR-3B 4(A)(3) once the tax is paid in 3.1(d); it is Table 6C / 6D of GSTR-9.' },
  REJECTED_NOT_IN_8A: { label: 'Rejected in IMS: not in 8A', action: 'No ITC for the year as the 2B stands. If rejected by mistake, ask the supplier to report it again (GSTR-1A or amendment) before 30 November after the year, then accept it.' },
  ITC_NA_NOT_IN_8A: { label: '2B says ITC not available: not in 8A', action: 'No ITC for this document as the 2B stands (place of supply or time limit); ask the supplier to correct a wrong place of supply.' },
  REVERSAL_NOT_IN_8A: { label: 'ITC reversal entry (Rule 37A): not in 8A', action: 'Reverse this ITC (Table 4(B)(2) of GSTR-3B, Table 7 of GSTR-9); reclaim it once the supplier files its GSTR-3B.' },
  AFTER_8A_WINDOW: { label: 'In a 2B after October of the next year: not in 8A', action: 'Time-barred u/s 16(4): no ITC for the year. Reverse it if it was claimed.' },
  NOT_IN_ANY_2B: { label: "Not in any of the year's 2Bs: no ITC", action: 'No ITC (s.16(2)(aa)): check IMS for it (pending or rejected) and ask the supplier; it must reach a 2B by October after the year.' },
  TWO_B_NOT_PULLED: { label: 'Not in the 2Bs pulled; some 2Bs of the year are not pulled', action: 'Pull the 2Bs named, then build the report again.' },
  EIGHT_A_BEFORE: { label: '8A downloaded before this was reported', action: 'Download the Table 8A document details again and upload it.' },
  IN_2B_NOT_IN_8A: { label: 'In a 2B of the year with ITC, but not in the 8A', action: "Check the portal's 8A for this document; download the 8A again if it is older than that 2B." },
  NOT_IN_8A_SECTION: { label: 'A section 8A never holds: not compared', action: 'Not part of 8A: imports go to Table 6E and ISD credits to Table 6G of GSTR-9; claim them as the 2B shows them.' },
  ONLY_LEFT_8A_UNEXPLAINED: { label: 'Not in 8A: no reason found', action: "Check the portal's 8A for this document and ask the supplier." },
  EIGHT_A_2A_NOT_PULLED: { label: 'In 8A; the 2A of its month is not pulled', action: 'Pull the 2A of that month to compare it.' },
  EIGHT_A_2B_NOT_PULLED: { label: 'In 8A; the 2B that holds it is not pulled', action: 'Pull the 2Bs named to compare it.' },
  ONLY_8A_UNEXPLAINED: { label: 'Only in 8A: no reason found', action: 'Check the document in the 2A / 2B of its month on the portal, and pull them again.' },
  EIGHT_A_HOLDS_NO_ITC: { label: '8A holds it, but the 2B gives no ITC', action: 'Take the 2B as it stands (no ITC); check the 8A again.' },
  MATCHED_8A: { label: 'Same in both', action: 'Nothing to do.' },
};

/** Status names, for a pair of sources. */
export const statusLabel = (status: RecoRow['status'], left: string, right: string): string =>
  status === 'only_left' ? `Only in ${left}`
    : status === 'only_right' ? `Only in ${right}`
      : status === 'differs' ? 'Figures differ'
        : status === 'itc_differs' ? 'ITC differs'
          : status === 'not_compared' ? 'Not compared'
            : 'Matched';

// ── 2A vs 2B ────────────────────────────────────────────────────────────────

export interface Neighbour {
  period: string;
  meta: StatementMeta;
  /** A 2B is due once the 14th of the next month has come (always true for a 2A). */
  due: boolean;
  /** Null when the statement is not ready. */
  index: DocIndex | null;
}

export interface Ctx2A2B {
  period: string;
  /** The client's state code (GSTIN[0..2]). */
  recipientState: string;
  /** ISO, India. Only for "is it due yet" and "how old is the 2A". */
  today: string;
  /** The 2A of M. */
  twoA: StatementMeta;
  twoB: StatementMeta;
  cutoff: Cutoff;
  /**
   * A quarterly (QRMP) 2B: the quarter's earlier months [M-2, M-1], whose 2B
   * the portal did not generate; null for a monthly 2B.
   */
  quarter: string[] | null;
  /** The 2As compared (ready ones), by period: M, plus the quarter's earlier months for a quarterly 2B. */
  twoAs: Map<string, StatementMeta>;
  /** The next 2Bs, pulled or not, so the notes can say what is missing: M+1 to M+3 (a quarterly 2B: M+3). */
  later2B: Neighbour[];
  /** 2A of each earlier month a 2B document's supplier period points to. */
  earlier2A: Map<string, Neighbour>;
  /** Suppliers present in the 2A. */
  twoACtins: Set<string>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isAre = (n: number) => (n === 1 ? 'is' : 'are');
const before = (a: string, b: string) => periodIndex(a) < periodIndex(b);

/** March, June, September, December: the months a quarterly (QRMP) taxpayer gets a 2B for. */
export const isQuarterEnd = (period: string): boolean => Number(period.slice(0, 2)) % 3 === 0;
/** The last month of `period`'s quarter. */
const quarterEnd = (period: string): string => addMonths(period, (3 - (Number(period.slice(0, 2)) % 3)) % 3);
/** The first month whose documents the 2B of M is compared for (M-2 for a quarterly 2B). */
const firstCompared = (ctx: Ctx2A2B): string => (ctx.quarter ? ctx.quarter[0] : ctx.period);
/** The month M-1 or M-2 of a quarter-end month, when it is not known whether the 2B is quarterly. */
const maybeQuarterMonth = (ctx: Ctx2A2B, sp: string): boolean =>
  !ctx.quarter && isQuarterEnd(ctx.period) && before(addMonths(ctx.period, -3), sp) && before(sp, ctx.period);
/** The 2A a 2B document belongs in, among those compared (M's otherwise). */
const twoAOf = (ctx: Ctx2A2B, d: RecoDoc): StatementMeta => (d.supplierPeriod && ctx.twoAs.get(d.supplierPeriod)) || ctx.twoA;

/**
 * Why a 2A holds no credit and debit notes: the portal did not return them to
 * a 0.14.0 pull (its cdnProblem), or the pull came from an earlier extension,
 * which reads B2B invoices only. `of` names the 2A when several are compared.
 */
const notesNotRead = (a: StatementMeta, of = ''): { evidence: string; action: string; words: string } =>
  a.cdnProblem
    ? {
      evidence: `The portal did not return the notes of the 2A${of} (${a.cdnProblem})`,
      action: 'Pull 2A again; until its notes are read, check it against your books.',
      words: `the portal did not return the notes of the 2A${of} (${a.cdnProblem}); pull 2A again`,
    }
    : {
      evidence: `2A${of} pulled by an extension before 0.14.0, which reads B2B invoices only`,
      action: 'Pull 2A again with extension 0.14.0 or later, which reads the notes; until then, check it against your books.',
      words: `the 2A${of} was pulled by an extension before 0.14.0, which reads B2B invoices only; pull 2A again with 0.14.0`,
    };

const neighbourWords = (n: Neighbour | undefined, period: string): string => {
  if (!n) return `2B of ${monthLabel(period)} not checked (beyond the three months read)`;
  if (n.meta.state === 'not_generated') return `2B of ${monthLabel(period)} not generated on the portal when last pulled`;
  if (!n.due) return `2B of ${monthLabel(period)} not generated yet (due ${dayLabel(due2BDate(period))})`;
  if (n.meta.state === 'failed') return `last pull of the 2B of ${monthLabel(period)} failed`;
  return `2B of ${monthLabel(period)} not pulled`;
};

/** In a later 2B: as ITC (`rejected` false; never its ITC reversal section) or as rejected in IMS. */
const findInLater = (ctx: Ctx2A2B, d: RecoDoc, rejected = false): { period: string; doc: RecoDoc } | null => {
  const where = rejected ? (x: RecoDoc) => x.bucket === 'rejected' : (x: RecoDoc) => x.bucket !== 'rejected' && x.bucket !== 'reversal';
  for (const n of ctx.later2B) {
    const doc = n.index ? lookupDoc(n.index, d, where) : null;
    if (doc) return { period: n.period, doc };
  }
  return null;
};

/**
 * The 2B(s) a document filed on `filedOn` (after this 2B's cut-off) belongs to:
 * filed by the 11th, the previous month's; after the 13th, that month's; the
 * 12th or 13th, either (a quarterly (IFF) supplier's or a monthly one's). A
 * quarterly 2B: the quarter's.
 */
const expectedPeriodsFor = (filedOn: string, ctx: Ctx2A2B): string[] => {
  const p = `${filedOn.slice(5, 7)}/${filedOn.slice(0, 4)}`;
  const day = Number(filedOn.slice(8, 10));
  const raw = day <= 11 ? [prevPeriod(p)] : day <= 13 ? [prevPeriod(p), p] : [p];
  return [...new Set(raw.map((e) => {
    if (ctx.quarter) { const q = quarterEnd(e); return before(ctx.period, q) ? q : addMonths(ctx.period, 3); }
    return before(ctx.period, e) ? e : nextPeriod(ctx.period);
  }))];
};

const filedWords = (d: RecoDoc) => (d.supplierFiledOn ? `filed on ${dayLabel(d.supplierFiledOn)}` : 'filing date not shown');
/** Filed on the 12th or 13th after the period, or no date: a monthly filer's is late, a quarterly (IFF) filer's is not. */
const ambiguousFiling = (d: RecoDoc, co: Cutoff): boolean => !d.supplierFiledOn || (d.supplierFiledOn > co.sureBy && d.supplierFiledOn <= co.latest);

/** The 2B gives no ITC on this document: rejected in IMS, an ITC reversal entry, or ITC not available. */
const noItc = (d: RecoDoc | undefined): boolean => !!d && (d.bucket === 'rejected' || d.bucket === 'reversal' || d.itcAvailable === false);
const noItcAction = (d: RecoDoc): string => {
  if (d.bucket === 'rejected') return REASONS.IMS_REJECTED.action;
  if (d.bucket === 'reversal') return REASONS.ITC_REVERSAL.action;
  const rsn = d.itcReason?.toUpperCase();
  return REASONS[rsn === 'P' ? 'ITC_NA_POS' : rsn === 'C' ? 'ITC_NA_TIME' : 'ITC_NA_OTHER'].action;
};
/**
 * A claim action, unless the 2B document gives no ITC (then what the 2B says)
 * or it is a credit note: a credit note reduces ITC, so its instruction is the
 * reduction (cnAction), and the s.16(4) time limit, which bounds a claim, is
 * not mentioned for it.
 */
const claimOr = (d: RecoDoc | undefined, action: string, cnAction?: string): string =>
  (d && noItc(d) ? noItcAction(d) : d?.family === 'CN' && cnAction ? cnAction : action);

const laterChecked = (ctx: Ctx2A2B): string => {
  const ready = ctx.later2B.filter((n) => n.index).map((n) => monthLabel(n.period));
  const missing = ctx.later2B.filter((n) => !n.index && n.due && n.meta.state !== 'not_generated').map((n) => monthLabel(n.period));
  const parts: string[] = [];
  if (ready.length) parts.push(`Not in the 2B of ${ready.join(' or ')} either`);
  if (missing.length) parts.push(`2B of ${missing.join(', ')} not pulled`);
  if (!parts.length) parts.push('No later 2B pulled yet');
  return parts.join('; ');
};

/** An earlier month's 2A lookup: found there, not there, or why it was not read. */
const earlierEvidence = (ctx: Ctx2A2B, d: RecoDoc, sp: string): { evidence: string; confirmed: boolean } => {
  const n = ctx.earlier2A.get(sp);
  // A note can only be looked for in a 2A that read the notes (0.14.0): an
  // older one is no evidence either way.
  if (n?.index && !n.meta.sectionsRead.includes(d.section)) {
    return { evidence: `2A of ${monthLabel(sp)} has no ${sectionLabel(d.section)} (${n.meta.cdnProblem ? 'the portal did not return them' : 'pulled before extension 0.14.0'})`, confirmed: false };
  }
  const found = n?.index ? lookupDoc(n.index, d) : null;
  const missing = n?.meta.state === 'failed' ? `last pull of the 2A of ${monthLabel(sp)} failed` : `2A of ${monthLabel(sp)} not pulled`;
  return { evidence: found ? `Found in the 2A of ${monthLabel(sp)}` : n?.index ? `Not in the 2A of ${monthLabel(sp)} either` : missing, confirmed: !!found };
};

const HEADS: [keyof RecoDoc & ('igst' | 'cgst' | 'sgst' | 'cess'), string][] = [['igst', 'IGST'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['cess', 'Cess']];
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const RULES_2A_2B: ReasonRule<Ctx2A2B>[] = [
  // ── Only in 2A (left = 2A of M) ──
  {
    code: 'IN_LATER_2B', when: ['only_left'],
    test: (row, ctx) => {
      const d = row.left as RecoDoc;
      const f = findInLater(ctx, d);
      if (!f || (d.supplierFiledOn && d.supplierFiledOn <= ctx.cutoff.sureBy)) return null;
      // The 12th or 13th (or no date): after the cut-off for a monthly filer, in
      // time and kept pending in IMS for a quarterly (IFF) one. Either way, that 2B.
      const filed = !d.supplierFiledOn
        ? 'filing date not shown: after the cut-off, or kept pending in IMS'
        : ambiguousFiling(d, ctx.cutoff)
          ? `${filedWords(d)}, the 12th or 13th: after the cut-off for a monthly filer, in time and kept pending in IMS for a quarterly (IFF) filer`
          : filedWords(d);
      return {
        detail: `${filed}; in the 2B of ${monthLabel(f.period)}`,
        evidence: `Found in the 2B of ${monthLabel(f.period)}`, confirmed: true, refPeriod: f.period,
        action: claimOr(f.doc, `Do not claim it this month; claim it in the GSTR-3B of ${monthLabel(f.period)}.`,
          `Not this month: reduce the ITC for this credit note in the GSTR-3B of ${monthLabel(f.period)}.`),
      };
    },
  },
  {
    code: 'IMS_ACCEPTED_LATER', when: ['only_left'],
    test: (row, ctx) => {
      const d = row.left as RecoDoc;
      const f = findInLater(ctx, d);
      if (!f) return null;
      return {
        detail: `${filedWords(d)}, in time; in the 2B of ${monthLabel(f.period)}`,
        evidence: `Found in the 2B of ${monthLabel(f.period)}`, confirmed: true, refPeriod: f.period,
        action: claimOr(f.doc, `Claim it in the GSTR-3B of ${monthLabel(f.period)}, not this month.`,
          `Reduce the ITC for this credit note in the GSTR-3B of ${monthLabel(f.period)}, not this month.`),
      };
    },
  },
  {
    // Listed as rejected in a later 2B (and not as ITC in any of them).
    code: 'IMS_REJECTED', when: ['only_left'],
    test: (row, ctx) => {
      const f = findInLater(ctx, row.left as RecoDoc, true);
      if (!f) return null;
      return {
        detail: `${filedWords(row.left as RecoDoc)}; rejected in IMS in the 2B of ${monthLabel(f.period)}`,
        evidence: `Listed as rejected in the 2B of ${monthLabel(f.period)}`, confirmed: true, refPeriod: f.period,
      };
    },
  },
  {
    code: 'EXPECTED_NEXT_2B', when: ['only_left'],
    test: (row, ctx) => {
      const d = row.left as RecoDoc;
      if (!d.supplierFiledOn || d.supplierFiledOn <= ctx.cutoff.latest) return null;
      const cands = expectedPeriodsFor(d.supplierFiledOn, ctx);
      const read = cands.filter((p) => ctx.later2B.find((x) => x.period === p)?.index);
      const p = cands.find((x) => !read.includes(x));
      if (!p) return null; // every 2B it could be in was read, and it is not there
      const n = ctx.later2B.find((x) => x.period === p);
      const notIn = read.length ? ` (not in the 2B of ${read.map(monthLabel).join(' or ')})` : '';
      return {
        detail: `${filedWords(d)}, after the cut-off of ${dayLabel(ctx.cutoff.latest)}; expected in the 2B of ${monthLabel(p)}${notIn}`,
        evidence: neighbourWords(n, p), confirmed: false, refPeriod: p,
        action: `Do not claim it this month; claim it in ${monthLabel(p)} once its 2B shows it.`,
      };
    },
  },
  {
    code: 'NOT_FILED_BY_SUPPLIER', when: ['only_left'],
    test: (row) => {
      const d = row.left as RecoDoc;
      // cfs N, or no cfs and no filing date. cfs Y without a date is filed.
      if (d.supplierFiled === true || (d.supplierFiled === null && d.supplierFiledOn)) return null;
      const why = d.supplierFiled === false ? '2A shows GSTR-1 / IFF not filed' : '2A shows no filing date';
      return {
        detail: d.irn ? "e-invoice (IRN): it reaches the supplier's GSTR-1 by itself, but that GSTR-1 is not filed" : '',
        evidence: why, confirmed: null,
      };
    },
  },
  {
    code: 'IMS_PENDING', when: ['only_left'],
    test: (row, ctx) => {
      const d = row.left as RecoDoc;
      if (!d.supplierFiledOn || d.supplierFiledOn > ctx.cutoff.latest) return null;
      const ambiguous = d.supplierFiledOn > ctx.cutoff.sureBy;
      return {
        detail: ambiguous
          ? `${filedWords(d)}, the 12th or 13th: in this 2B for a quarterly (IFF) filer, next month's 2B for a monthly filer`
          : filedWords(d),
        evidence: laterChecked(ctx), confirmed: false,
      };
    },
  },
  {
    code: 'ONLY_2A_UNEXPLAINED', when: ['only_left'],
    test: (row, ctx) => {
      const d = row.left as RecoDoc;
      if (d.supplierFiledOn && d.supplierFiledOn > ctx.cutoff.latest) {
        const ps = expectedPeriodsFor(d.supplierFiledOn, ctx);
        const p = ps[ps.length - 1];
        return {
          detail: `${filedWords(d)}, after the cut-off, but not in the 2B of ${ps.map(monthLabel).join(' or ')} either`,
          evidence: laterChecked(ctx), confirmed: null, refPeriod: p, action: `Check IMS of ${ps.map(monthLabel).join(' and ')} and ask the supplier.`,
        };
      }
      return { detail: d.supplierFiledOn ? '' : filedWords(d), evidence: laterChecked(ctx), confirmed: null };
    },
  },

  // ── An ITC reversal entry of the 2B (never paired: it is not the invoice) ──
  {
    code: 'ITC_REVERSAL', when: ['only_right', 'not_compared'],
    test: (row) => {
      const d = row.right;
      if (d?.bucket !== 'reversal') return null;
      return {
        detail: `${d.supplierPeriod ? `for ${monthLabel(d.supplierPeriod)}` : 'supplier period not shown'}; shown negative: it reduces the ITC`,
        evidence: "The 2B's ITC reversal section", confirmed: true,
      };
    },
  },

  // ── Not compared (a section the other side does not read) ──
  {
    code: 'NOT_COMPARED_SECTION', when: ['not_compared'],
    test: (row, ctx) => {
      const d = (row.right ?? row.left) as RecoDoc;
      const other = row.right ? '2A' : '2B';
      // Extension 0.14.0 reads the 2A's notes: a 2B note is left out only when
      // its 2A was pulled before that, or the notes could not be read.
      if (row.right && d.section === 'CDNR') {
        const why = notesNotRead(twoAOf(ctx, d));
        return { detail: sectionLabel(d.section), evidence: why.evidence, confirmed: null, action: claimOr(d, why.action) };
      }
      return { detail: sectionLabel(d.section), evidence: `The ${other} pull does not read ${sectionLabel(d.section)}`, confirmed: null };
    },
  },

  // ── Only in 2B (right = 2B of M) ──
  {
    // Rejected in IMS: no ITC, whatever else explains it.
    code: 'IMS_REJECTED', when: ['only_right'],
    test: (row) => {
      const d = row.right as RecoDoc;
      if (d.bucket !== 'rejected') return null;
      const sp = d.supplierPeriod ? `for ${monthLabel(d.supplierPeriod)}, ` : '';
      return { detail: `${sp}${filedWords(d)}; no ITC in this 2B`, evidence: 'The 2B lists it as rejected', confirmed: true };
    },
  },
  {
    // A quarterly 2B holds the whole quarter; the 2A of that month was not read.
    code: 'QUARTERLY_2B', when: ['only_right'],
    test: (row, ctx) => {
      const d = row.right as RecoDoc;
      const sp = d.supplierPeriod;
      if (!ctx.quarter || !sp || !ctx.quarter.includes(sp) || ctx.twoAs.has(sp)) return null;
      const n = ctx.earlier2A.get(sp);
      const why = n?.meta.state === 'failed' ? `last pull of the 2A of ${monthLabel(sp)} failed` : `2A of ${monthLabel(sp)} not pulled`;
      return {
        detail: `for ${monthLabel(sp)}${d.supplierFiledOn ? `, filed on ${dayLabel(d.supplierFiledOn)}` : ''}; ${why}`,
        evidence: why, confirmed: false, refPeriod: sp,
        action: claimOr(d, REASONS.QUARTERLY_2B.action, "Reduce the ITC for this credit note in this quarter's GSTR-3B; pull that month's 2A to compare it."),
      };
    },
  },
  {
    // For an earlier month and filed by that month's cut-off: the client kept it
    // pending in IMS and accepted it now (the supplier was not late).
    code: 'EARLIER_PERIOD_IN_TIME', when: ['only_right'],
    test: (row, ctx) => {
      const d = row.right as RecoDoc;
      const sp = d.supplierPeriod;
      if (!sp || !before(sp, firstCompared(ctx)) || !d.supplierFiledOn) return null;
      const co = cutoffOf2B(ctx.quarter ? quarterEnd(sp) : sp, null);
      if (d.supplierFiledOn > co.sureBy) return null;
      const qrmp = maybeQuarterMonth(ctx, sp) ? "; or, if this client files quarterly (QRMP), this quarter's 2B" : '';
      return {
        detail: `for ${monthLabel(sp)}, filed on ${dayLabel(d.supplierFiledOn)}, in time for the 2B of ${monthLabel(ctx.quarter ? quarterEnd(sp) : sp)}${qrmp}`,
        ...earlierEvidence(ctx, d, sp), refPeriod: sp,
        action: claimOr(d, `Claim it in this month's GSTR-3B; clear it from the not-in-2B list of ${monthLabel(sp)}.`,
          "Reduce the ITC for this credit note in this month's GSTR-3B."),
      };
    },
  },
  {
    code: 'EARLIER_PERIOD', when: ['only_right'],
    test: (row, ctx) => {
      const d = row.right as RecoDoc;
      const sp = d.supplierPeriod;
      if (!sp || !before(sp, firstCompared(ctx))) return null;
      const co = cutoffOf2B(ctx.quarter ? quarterEnd(sp) : sp, null);
      const filed = !d.supplierFiledOn ? ''
        : d.supplierFiledOn <= co.latest
          ? `, filed on ${dayLabel(d.supplierFiledOn)}, the 12th or 13th: late for a monthly filer, in time and kept pending in IMS for a quarterly (IFF) filer`
          : `, filed on ${dayLabel(d.supplierFiledOn)}`;
      const qrmp = maybeQuarterMonth(ctx, sp) ? "; or, if this client files quarterly (QRMP), in time for this quarter's 2B" : '';
      return {
        detail: `for ${monthLabel(sp)}${filed}; it belongs in the 2A of ${monthLabel(sp)}${qrmp}`,
        ...earlierEvidence(ctx, d, sp), refPeriod: sp,
        action: claimOr(d, `Claim it in this month's GSTR-3B; clear it from the not-in-2B list of ${monthLabel(sp)}; check the s.16(4) time limit.`,
          "Reduce the ITC for this credit note in this month's GSTR-3B."),
      };
    },
  },
  {
    code: 'STALE_2A', when: ['only_right'],
    test: (row, ctx) => {
      const d = row.right as RecoDoc;
      const pulled = twoAOf(ctx, d).pulledAt;
      if (!pulled || !d.supplierFiledOn || d.supplierFiledOn <= pulled) return null;
      return { detail: `2A pulled on ${dayLabel(pulled)}; the supplier filed on ${dayLabel(d.supplierFiledOn)}`, evidence: `2A pulled ${dayLabel(pulled)}`, confirmed: false };
    },
  },
  {
    code: 'TWO_A_INCOMPLETE', when: ['only_right'],
    test: (row, ctx) => {
      const d = row.right as RecoDoc;
      const a = twoAOf(ctx, d);
      if (a.suspectEmpty) {
        return {
          detail: `the 2A of ${monthLabel(a.period)} was saved by an extension before 0.13.0 with no suppliers: it may be a failed pull`,
          evidence: `2A of ${monthLabel(a.period)}: no suppliers, no pull record`, confirmed: false,
        };
      }
      // 0.14.0: a credit or debit note is missing only if that supplier's notes fetch failed.
      if (d.section === 'CDNR' && a.cdnFailedCtins) {
        if (!a.cdnFailedCtins.includes(d.ctin)) return null;
        return {
          detail: "the 2A pull failed for this supplier's credit and debit notes",
          evidence: `2A notes pull: ${plural(a.cdnFailedSuppliers ?? a.cdnFailedCtins.length, 'supplier')} failed`, confirmed: false,
        };
      }
      const failed = a.failedSuppliers ?? 0;
      // 0.13.0 names the suppliers whose fetch failed, which settles it even when
      // the 2A holds that supplier's notes (0.14.0). Older pulls give a count
      // only: then a supplier found in the 2A is not one that failed.
      if (a.failedCtins ? !a.failedCtins.includes(d.ctin) : ctx.twoACtins.has(d.ctin) || failed <= 0) return null;
      return {
        detail: a.failedCtins ? 'the 2A pull failed for this supplier' : `the 2A pull failed for ${plural(failed, 'supplier')} and this one is not in the 2A`,
        evidence: `2A pull: ${plural(failed || (a.failedCtins?.length ?? 0), 'supplier')} failed`, confirmed: false,
      };
    },
  },
  {
    code: 'ONLY_2B_UNEXPLAINED', when: ['only_right'],
    test: (row, ctx) => {
      const d = row.right as RecoDoc;
      const later = d.supplierPeriod && before(ctx.period, d.supplierPeriod);
      return {
        detail: later ? `the supplier's period is ${monthLabel(d.supplierPeriod)}, later than this month` : '',
        evidence: ctx.twoACtins.has(d.ctin) ? 'Supplier is in the 2A with other documents' : 'Supplier is not in the 2A', confirmed: null,
      };
    },
  },

  // ── Both sides ──
  {
    // Paired through an amendment (equal figures too: the numbers differ).
    code: 'AMENDED', when: ['differs', 'matched'],
    test: (row, ctx) => {
      const l = row.left as RecoDoc;
      const r = row.right as RecoDoc;
      if (l.isAmendment || r.isAmendment || row.viaAmendment) {
        const a = r.isAmendment ? r : l;
        const side = a === r ? '2B' : '2A';
        const orig = a.original?.number ? ` (original no. ${a.original.number})` : '';
        return { detail: `the ${side} shows the amended document${orig}`, evidence: `Amendment in this month's ${side}`, confirmed: true };
      }
      if (row.status !== 'differs') return null;
      for (const n of ctx.later2B) {
        const amd = n.index ? lookupAmendmentOf(n.index, l) ?? lookupAmendmentOf(n.index, r) : null;
        if (amd) return { detail: `amended figures in the 2B of ${monthLabel(n.period)}`, evidence: `Amendment found in the 2B of ${monthLabel(n.period)}`, confirmed: true, refPeriod: n.period };
      }
      return null;
    },
  },
  {
    // Same figures, but no ITC: "ITC differs", not "Figures differ".
    code: 'IMS_REJECTED', when: ['differs', 'matched'],
    test: (row) => {
      if (row.right?.bucket !== 'rejected') return null;
      return { detail: 'no ITC in this 2B', evidence: 'The 2B lists it as rejected', confirmed: true, ...(row.status === 'matched' ? { status: 'itc_differs' as const } : {}) };
    },
  },
  {
    code: 'DATE_DIFFERS', when: ['differs', 'matched'],
    test: (row) => {
      if (!row.dateDiffers || row.viaAmendment) return null;
      const l = row.left as RecoDoc;
      const r = row.right as RecoDoc;
      return { detail: `2A dated ${dayLabel(l.date)}, 2B dated ${dayLabel(r.date)}`, evidence: 'Same supplier and number', confirmed: null, status: 'differs' };
    },
  },
  {
    code: 'CHANGED_AFTER_2B', when: ['differs'],
    test: (row, ctx) => {
      const l = row.left as RecoDoc;
      const gen = ctx.twoB.generatedOn;
      if (!gen || !l.supplierFiledOn || l.supplierFiledOn <= gen) return null;
      return {
        detail: `2A shows it filed on ${dayLabel(l.supplierFiledOn)}, after the 2B was generated on ${dayLabel(gen)} (GSTR-1A or amendment); the change reaches a later 2B`,
        evidence: `2B generated ${dayLabel(gen)}`, confirmed: false,
      };
    },
  },
  {
    code: 'VALUE_DIFFERENCE', when: ['differs'],
    test: (row) => {
      const parts: string[] = [];
      const say = (name: string, v: number) => { if (Math.abs(v) > 1) parts.push(`${name} ${v > 0 ? '2B more' : '2B less'} by ${fmt(Math.abs(v))}`); };
      say('taxable value', row.diff.taxable);
      for (const [k, name] of HEADS) say(name, row.diff[k]);
      return { detail: parts.join(', ') || 'figures differ', evidence: '', confirmed: null };
    },
  },
  { code: 'MATCHED', when: ['matched'], test: (row) => ({ detail: '', confirmed: null, ...(noItc(row.right) ? { action: noItcAction(row.right as RecoDoc) } : {}) }) },
];

/**
 * The supplier's GSTR-3B for the period, from the 2A's cfs3b (as of that 2A's
 * pull). Rule 37A bites only once 30 September after the year has passed; before
 * that, "not filed yet" is ordinary (3B is due after the 2B, quarterly for QRMP).
 */
const threeBNote = (row: RecoRowLike, ctx: Ctx2A2B): { late: boolean; text: string } | null => {
  const d = row.left?.supplier3bFiled === false ? row.left : row.right?.supplier3bFiled === false ? row.right : null;
  if (!d) return null;
  const sp = d.supplierPeriod ?? d.statementPeriod;
  const deadline = `${fyStartYear(fyOfPeriod(sp)) + 1}-09-30`;
  const pulled = (d.source === '2A' ? ctx.twoAs.get(d.statementPeriod) ?? ctx.twoA : ctx.twoA).pulledAt;
  return pulled && pulled > deadline
    ? { late: true, text: `Supplier had not filed GSTR-3B for ${monthLabel(sp)} by ${dayLabel(deadline)} (Rule 37A)` }
    : { late: false, text: `Supplier's GSTR-3B for ${monthLabel(sp)} not filed as of the 2A pull${pulled ? ` (${dayLabel(pulled)})` : ''}` };
};
type RecoRowLike = { left?: RecoDoc; right?: RecoDoc };

export const NOTES_2A_2B: NoteRule<Ctx2A2B>[] = [
  { code: 'RCM', test: (row) => (row.left?.reverseCharge || row.right?.reverseCharge ? 'Reverse charge: pay the tax in 3.1(d), then claim' : null) },
  {
    code: 'ITC_NA_POS',
    test: (row, ctx) => {
      if (row.right) return row.right.itcReason?.toUpperCase() === 'P' ? 'ITC not available: place of supply' : null;
      const l = row.left as RecoDoc;
      return l.pos && l.ctin && l.pos === l.ctin.slice(0, 2) && l.pos !== ctx.recipientState
        ? `ITC likely not available: place of supply ${l.pos} is the supplier's state, not yours (${ctx.recipientState})`
        : null;
    },
  },
  { code: 'ITC_NA_TIME', test: (row) => (row.right?.itcReason?.toUpperCase() === 'C' ? 'ITC not available: time limit u/s 16(4) (2B reason C)' : null) },
  {
    code: 'ITC_NA_OTHER',
    test: (row) => {
      const r = row.right;
      if (!r || r.itcAvailable !== false || ['P', 'C'].includes(r.itcReason?.toUpperCase() ?? '')) return null;
      return `2B says ITC not available${r.itcReason ? ` (reason ${r.itcReason})` : ''}`;
    },
  },
  { code: 'RULE_37A', test: (row, ctx) => { const n = threeBNote(row, ctx); return n?.late ? n.text : null; } },
  { code: 'SUPPLIER_3B_PENDING', test: (row, ctx) => { const n = threeBNote(row, ctx); return n && !n.late ? n.text : null; } },
  {
    code: 'SUPPLIER_CANCELLED',
    test: (row) => {
      const d = (row.left ?? row.right) as RecoDoc;
      const from = row.left?.supplierCancelledFrom ?? row.right?.supplierCancelledFrom ?? null;
      return from && d.date && d.date >= from ? `Supplier registration cancelled from ${dayLabel(from)}` : null;
    },
  },
  {
    code: 'EARLIER_YEAR_DOC',
    test: (row, ctx) => {
      const d = (row.left ?? row.right) as RecoDoc;
      // An ITC reversal entry is always of an earlier year, and a credit note
      // reduces ITC: nothing to claim, so no s.16(4) flag for either.
      if (!d.date || d.bucket === 'reversal' || d.family === 'CN') return null;
      const fy = fyOfDate(d.date);
      return fy < fyOfPeriod(ctx.period) ? `Dated in an earlier financial year (FY ${fy})` : null;
    },
  },
];

const explain2A2B = (rows: RecoRow[], ctx: Ctx2A2B): string[] => {
  const out: string[] = [];
  const count = (pred: (r: RecoRow) => boolean) => rows.filter(pred).length;

  // Later 2B: what is expected there and could not be confirmed.
  const expectedPeriods = new Set(rows.filter((r) => r.reason === 'EXPECTED_NEXT_2B' && r.refPeriod).map((r) => r.refPeriod as string));
  const next = ctx.later2B[0];
  if (next && !next.index) expectedPeriods.add(next.period);
  for (const p of [...expectedPeriods].sort((a, b) => periodIndex(a) - periodIndex(b))) {
    const n = ctx.later2B.find((x) => x.period === p);
    const k = count((r) => r.reason === 'EXPECTED_NEXT_2B' && r.refPeriod === p);
    const words = neighbourWords(n, p);
    const tail = k ? ` ${plural(k, 'document')} filed after the cut-off ${isAre(k)} expected there, not confirmed.` : '';
    // A 2B not generated is generated once the previous GSTR-3B is filed: worth asking again.
    const pull = n && n.due ? ' Pull it to confirm.' : '';
    out.push(`${words[0].toUpperCase()}${words.slice(1)}.${tail}${pull}`);
  }
  const pending = count((r) => r.reason === 'IMS_PENDING');
  if (pending) out.push(`${plural(pending, 'document')} filed in time ${isAre(pending)} not in this 2B: pending (or rejected) in IMS until a later 2B shows ${pending === 1 ? 'it' : 'them'}.`);

  // A quarterly 2B.
  if (ctx.quarter) {
    const months = [...ctx.quarter, ctx.period];
    const missing = ctx.quarter.filter((p) => !ctx.twoAs.has(p)).map(monthLabel);
    out.push(`Quarterly (QRMP) 2B: the portal generated no 2B for ${ctx.quarter.map(monthLabel).join(' and ')}, so this 2B covers ${monthLabel(months[0])} to ${monthLabel(ctx.period)} and is compared with the 2A of all three months${missing.length ? ` (${missing.join(', ')} not pulled: pull ${missing.length === 1 ? 'it' : 'them'})` : ''}.`);
  }

  // Earlier 2A.
  for (const [sp, n] of [...ctx.earlier2A.entries()].sort((a, b) => periodIndex(a[0]) - periodIndex(b[0]))) {
    if (n.index) continue;
    const k = count((r) => (r.reason === 'EARLIER_PERIOD' || r.reason === 'EARLIER_PERIOD_IN_TIME') && r.refPeriod === sp);
    if (k) out.push(`2A of ${monthLabel(sp)} not pulled: ${plural(k, 'document')} for ${monthLabel(sp)} ${isAre(k)} not confirmed.`);
  }

  // Sections not compared.
  const nc = rows.filter((r) => r.status === 'not_compared' && r.reason === 'NOT_COMPARED_SECTION');
  if (nc.length) {
    const order = Object.keys(SECTION_LABELS);
    const rank = (x: string) => (order.indexOf(x) < 0 ? order.length : order.indexOf(x));
    const secs = [...new Set(nc.map((r) => (r.right ?? r.left)!.section))].sort((x, y) => rank(x) - rank(y)).map(sectionLabel);
    const read = ctx.twoA.sectionsRead.length ? ctx.twoA.sectionsRead.map(sectionLabel).join(', ') : 'B2B invoices';
    const head = `Compared: ${read}. Not compared: ${plural(nc.length, 'document')} (${secs.join(', ')})`;
    // The 2B's notes are left out only when their 2A holds none (0.14.0 reads
    // them): say why for each such 2A, so the fix (pull again) is plain.
    const noteRows = nc.filter((r) => r.right?.section === 'CDNR');
    const of = (m: StatementMeta) => (ctx.twoAs.size > 1 ? ` of ${monthLabel(m.period)}` : '');
    const notesWhy = [...new Set(noteRows.map((r) => twoAOf(ctx, r.right as RecoDoc)))].map((m) => notesNotRead(m, of(m)).words);
    if (!noteRows.length) out.push(`${head}, because the 2A pull reads ${read} only.`);
    else if (noteRows.length === nc.length) out.push(`${head}, because ${notesWhy.join(', and ')}.`);
    else out.push(`${head}. Credit and debit notes: ${notesWhy.join(', and ')}. The others: the 2A pull does not read them.`);
  }

  // How old the 2A is, and whether its pull was complete.
  const a = ctx.twoA.pulledAt;
  const gen = ctx.twoB.generatedOn;
  if (isStale2A(a, gen, ctx.today)) {
    out.push(`2A pulled ${dayLabel(a)}; 2B generated ${dayLabel(gen)}. 2A changes whenever a supplier files: pull it again before relying on the Only in 2B rows.`);
  }
  for (const m of ctx.twoAs.values()) {
    const failed = m.failedSuppliers ?? m.failedCtins?.length ?? 0;
    const of = ctx.twoAs.size > 1 ? ` of ${monthLabel(m.period)}` : '';
    if (failed > 0) out.push(`The 2A pull${of} failed for ${plural(failed, 'supplier')}: pull 2A again.`);
    const notesFailed = m.cdnFailedSuppliers ?? m.cdnFailedCtins?.length ?? 0;
    if (notesFailed > 0) out.push(`The 2A pull${of} could not read the credit and debit notes of ${plural(notesFailed, 'supplier')}: pull 2A again.`);
    if (m.suspectEmpty) out.push(`The 2A of ${monthLabel(m.period)} was saved by an extension before 0.13.0 and shows no suppliers: it may be a failed pull. Pull it again.`);
  }
  if (ctx.twoB.sectionsUnknown.length) out.push(`Sections in 2B this report does not read: ${ctx.twoB.sectionsUnknown.join(', ')}.`);

  // The flags of the Excel's "Also note" column, counted (the PDF prints no such column).
  for (const code of FLAG_CODES) {
    const flagged = rows.filter((r) => r.notes.some((n) => n.code === code));
    if (!flagged.length) continue;
    const nums = flagged.map((r) => (r.left ?? r.right)?.number ?? '');
    const list = nums.length > 8 ? `${nums.slice(0, 8).join(', ')} and ${nums.length - 8} more` : nums.join(', ');
    const tax = flagged.reduce((t, r) => t + (r.right ? signedTax(r.right) : signedTax(r.left)), 0);
    out.push(`Also note (${REASONS[code].label}): ${plural(flagged.length, 'document')} (${list}), tax ${fmt(tax)}.`);
  }
  return out;
};

const FLAG_CODES: ReasonCode[] = ['ITC_NA_POS', 'ITC_NA_TIME', 'ITC_NA_OTHER', 'RCM', 'RULE_37A', 'SUPPLIER_3B_PENDING', 'SUPPLIER_CANCELLED', 'EARLIER_YEAR_DOC'];

/** The 2A is older than the 2B's generation, or than 15 days: the notes say so and Pull fetches it again. */
export const isStale2A = (pulledAt: string | null, generatedOn: string | null, today: string): boolean =>
  !!pulledAt && ((!!generatedOn && pulledAt < generatedOn) || daysBetween(pulledAt, today) > 15);

export const PAIR_2A_2B: PairConfig<Ctx2A2B> = {
  left: '2A',
  right: '2B',
  rules: RULES_2A_2B,
  notes: NOTES_2A_2B,
  fallback: { only_left: 'ONLY_2A_UNEXPLAINED', only_right: 'ONLY_2B_UNEXPLAINED', differs: 'VALUE_DIFFERENCE', itc_differs: 'IMS_REJECTED', not_compared: 'NOT_COMPARED_SECTION', matched: 'MATCHED' },
  tolerance: 1,
  explain: explain2A2B,
};

// The 8A pairs (2A vs 8A, 2B vs 8A) and the three-way report: reasons8A.ts, threeWay.ts.

// ── Building the 2A vs 2B run from stored rows ──────────────────────────────

export interface Input2A2B {
  period: string;
  client: { name: string; gstin: string | null };
  /** 2A and 2B rows for M to M+3, and the 2A of earlier months the 2B points to. */
  rows: StatementRow[];
  /** ISO date in India. */
  today: string;
}

/**
 * The months before M that the 2B's ITC documents were filed for (their 2A
 * confirms "filed late"). Rejected and ITC reversal entries are left out: their
 * reason does not depend on that 2A.
 */
export const earlierPeriodsOf = (twoB: Statement, period: string): string[] =>
  [...new Set(twoB.docs
    .filter((d) => d.bucket !== 'rejected' && d.bucket !== 'reversal')
    .map((d) => d.supplierPeriod).filter((p): p is string => !!p && before(p, period)))]
    .sort((a, b) => periodIndex(a) - periodIndex(b));

/**
 * A quarterly (QRMP) 2B: M is a quarter's last month and the portal generated
 * no 2B for the quarter's first two months (both recorded "not generated").
 * Returns [M-2, M-1], or null. Without that record the 2B is taken as monthly,
 * and the reasons of documents from those months say "or quarterly".
 */
export function quarterOf(rows: StatementRow[], period: string): string[] | null {
  if (!isQuarterEnd(period)) return null;
  const months = [addMonths(period, -2), addMonths(period, -1)];
  return months.every((p) => statementFromRow(findRow(rows, '2B', p), '2B', p).meta.state === 'not_generated') ? months : null;
}

/** Why the report cannot run, in one message; null when both statements are ready. */
export function missingMessage(clientName: string, period: string, twoA: StatementMeta, twoB: StatementMeta, today: string): string | null {
  if (twoA.state === 'ready' && twoB.state === 'ready') return null;
  const m = monthLabel(period);
  const parts: string[] = [];
  let canPull = false;
  const say = (meta: StatementMeta, name: string) => {
    if (meta.state === 'ready') return;
    if (meta.state === 'not_generated') {
      parts.push(name === 'GSTR-2B'
        ? `The portal had no GSTR-2B for ${m}. A quarterly (QRMP) taxpayer gets a 2B only for the last month of the quarter; otherwise the 2B is not generated until the previous GSTR-3B is filed.`
        : `The portal had no ${name} for ${m}.`);
      return;
    }
    if (name === 'GSTR-2B' && today < due2BDate(period)) {
      parts.push(`GSTR-2B of ${m} is generated on ${dayLabel(due2BDate(period))}; it is not out yet.`);
      return;
    }
    canPull = true;
    parts.push(meta.state === 'failed'
      ? `The last ${name} pull for ${m} failed (${meta.status}).`
      : `${name} of ${m} is not pulled for ${clientName}.`);
  };
  say(twoA, 'GSTR-2A');
  say(twoB, 'GSTR-2B');
  if (canPull) parts.push('Use Pull on this report: it fetches what is missing.');
  return parts.join(' ');
}

export interface Run2A2B {
  result: RecoResult;
  ctx: Ctx2A2B;
  twoA: StatementMeta;
  twoB: StatementMeta;
}

/** Statements, context and the reconciliation, from stored rows. Throws when 2A or 2B of M is not usable. */
export function reconcile2A2B(input: Input2A2B): Run2A2B {
  const { period, rows, today } = input;
  const a = statementFromRow(findRow(rows, '2A', period), '2A', period);
  const b = statementFromRow(findRow(rows, '2B', period), '2B', period);
  const msg = missingMessage(input.client.name, period, a.meta, b.meta, today);
  if (msg) throw new Error(msg);

  const neighbour = (source: '2A' | '2B', p: string): Neighbour => {
    const s = statementFromRow(findRow(rows, source, p), source, p);
    return { period: p, meta: s.meta, due: source === '2A' || today >= due2BDate(p), index: s.meta.state === 'ready' ? indexDocs(s.docs) : null };
  };
  // A quarterly 2B holds the whole quarter: the left side is the 2A of each of
  // its months that is pulled (the others are named in the notes).
  const quarter = quarterOf(rows, period);
  const quarter2A = (quarter ?? [])
    .map((p) => statementFromRow(findRow(rows, '2A', p), '2A', p))
    .filter((s) => s.meta.state === 'ready');
  const leftDocs = [...quarter2A.flatMap((s) => s.docs), ...a.docs];
  const earlier = [...new Set([...(quarter ?? []), ...earlierPeriodsOf(b, period)])].sort((x, y) => periodIndex(x) - periodIndex(y));
  const ctx: Ctx2A2B = {
    period,
    recipientState: (input.client.gstin ?? '').slice(0, 2),
    today,
    twoA: a.meta,
    twoB: b.meta,
    cutoff: cutoffOf2B(period, b.meta.generatedOn),
    quarter,
    twoAs: new Map([...quarter2A.map((s) => [s.meta.period, s.meta] as const), [period, a.meta] as const]),
    // A quarterly taxpayer's next 2B is the next quarter's.
    later2B: (quarter ? [3] : [1, 2, 3]).map((k) => neighbour('2B', addMonths(period, k))),
    earlier2A: new Map(earlier.map((p) => [p, neighbour('2A', p)])),
    twoACtins: new Set(leftDocs.map((d) => d.ctin)),
  };
  // A 2B document is compared when the 2A it belongs in reads its section: a
  // quarterly 2B's 2As may come from different extensions (notes from 0.14.0).
  const left: SourceSet = { key: '2A', label: '2A', docs: leftDocs, covers: (d) => twoAOf(ctx, d).sectionsRead.includes(d.section) };
  const right: SourceSet = {
    key: '2B', label: '2B', docs: b.docs, covers: (d) => b.meta.sectionsRead.includes(d.section),
    // An ITC reversal entry is not the invoice: listed on its own, never paired.
    solo: (d) => d.bucket === 'reversal',
  };
  return { result: reconcile(left, right, PAIR_2A_2B, ctx), ctx, twoA: a.meta, twoB: b.meta };
}
