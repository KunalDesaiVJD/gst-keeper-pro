// The year's GSTR-2A against its GSTR-9 Table 8A, and the year's GSTR-2B
// against it: the ordered rule sets (the first rule that claims a row gives its
// reason, as for 2A vs 2B) and the runs that build them from fy8a.ts's
// statements. The catalogue entries live with the others in reasons.ts.
// Positions: docs/GSTR8A_RECO_POSITIONS.md.
import { fyOfPeriod, fyStartYear, periodIndex } from '@/lib/reply/periods';
import { dayLabel, monthLabel } from './dates';
import { reconcile, signedTax } from './engine';
import { copiesIn, fromMonth, monthsWords, type FyStatements, type FySide } from './fy8a';
import { REASONS } from './reasons';
import { EIGHT_A_SECTIONS, sectionLabel } from './sources';
import type { NoteRule, PairConfig, ReasonCode, ReasonHit, ReasonRule, RecoDoc, RecoResult, RecoRow, RowDraft, SourceSet } from './types';

export interface CtxFy {
  fy: string;
  st: FyStatements;
  /** The client's state code (GSTIN[0..2]). */
  recipientState: string;
  today: string;
}

const before = (a: string, b: string) => periodIndex(a) < periodIndex(b);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const HEADS: ['igst' | 'cgst' | 'sgst' | 'cess', string][] = [['igst', 'IGST'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['cess', 'Cess']];

/** "the portal's 8A (downloaded 14 Oct 2026)" or "the 8A rebuilt from the year's 2B". */
export const eightAWords = (st: FyStatements): string =>
  st.eightA.origin === 'portal'
    ? `the portal's 8A${st.eightA.meta.generatedOn ? ` (generated ${dayLabel(st.eightA.meta.generatedOn)})` : st.eightA.meta.pulledAt ? ` (${st.eightA.stored?.via === 'pull' ? 'pulled from the portal' : 'uploaded'} ${dayLabel(st.eightA.meta.pulledAt)})` : ''}`
    : `the 8A rebuilt from the year's ${st.eightA.basis}`;

/** The 2B copy of a document that tells what the 2B did with it: ITC in the window, then later, then no ITC, then rejected. */
export function twoBVerdict(st: FyStatements, d: RecoDoc): { doc: RecoDoc; kind: 'itc' | 'late' | 'not_available' | 'rejected' | 'reversal' } | null {
  const hits = copiesIn(st.twoB, d);
  if (!hits.length) return null;
  const inWindow = (x: RecoDoc) => !before(st.windowEnd, x.statementPeriod);
  const itc = (x: RecoDoc) => x.bucket === 'available' && x.itcAvailable !== false;
  const pick = hits.find((x) => itc(x) && inWindow(x)) ? { doc: hits.find((x) => itc(x) && inWindow(x)) as RecoDoc, kind: 'itc' as const }
    : hits.find(itc) ? { doc: hits.find(itc) as RecoDoc, kind: 'late' as const }
      : hits.find((x) => x.bucket === 'not_available' || x.itcAvailable === false) ? { doc: hits.find((x) => x.bucket === 'not_available' || x.itcAvailable === false) as RecoDoc, kind: 'not_available' as const }
        : hits.find((x) => x.bucket === 'rejected') ? { doc: hits.find((x) => x.bucket === 'rejected') as RecoDoc, kind: 'rejected' as const }
          : { doc: hits[0], kind: 'reversal' as const };
  return pick;
}

/** The 2Bs (or 2As) a document could still be in that are not pulled: from its own month to the window's end. */
export const missingFor = (side: FySide, d: RecoDoc): string[] =>
  fromMonth(side.missing, d.supplierPeriod ?? (d.date ? `${d.date.slice(5, 7)}/${d.date.slice(0, 4)}` : null));

const naWords = (d: RecoDoc): string => {
  const r = d.itcReason?.toUpperCase();
  return r === 'P' ? 'place of supply' : r === 'C' ? 'time limit u/s 16(4)' : d.itcReason ? `reason ${d.itcReason}` : 'no reason given';
};

const valueDiff = (row: RowDraft, L: string, R: string): ReasonHit => {
  const parts: string[] = [];
  const say = (name: string, v: number) => { if (Math.abs(v) > 1) parts.push(`${name} ${v > 0 ? `${R} more` : `${R} less`} by ${fmt(Math.abs(v))}`); };
  say('taxable value', row.diff.taxable);
  for (const [k, name] of HEADS) say(name, row.diff[k]);
  return { detail: parts.join(', ') || 'figures differ', evidence: `${L} and ${R} figures`, confirmed: null };
};

/** Rules both pairs share: amendments, dates and figures. */
const bothSides = (L: string, R: string): ReasonRule<CtxFy>[] => [
  {
    code: 'AMENDED', when: ['differs', 'matched'],
    test: (row) => {
      const l = row.left as RecoDoc;
      const r = row.right as RecoDoc;
      if (!l.isAmendment && !r.isAmendment && !row.viaAmendment) return null;
      const a = r.isAmendment ? r : l;
      const orig = a.original?.number ? ` (original no. ${a.original.number})` : '';
      return { detail: `the ${a === r ? R : L} shows the amended document${orig}`, evidence: `Amendment in the ${a === r ? R : L}`, confirmed: true };
    },
  },
  {
    code: 'DATE_DIFFERS', when: ['differs', 'matched'],
    test: (row) => (row.dateDiffers && !row.viaAmendment
      ? { detail: `${L} dated ${dayLabel(row.left?.date)}, ${R} dated ${dayLabel(row.right?.date)}`, evidence: 'Same supplier and number', confirmed: null, status: 'differs' }
      : null),
  },
  { code: 'VALUE_DIFFERENCE', when: ['differs'], test: (row) => valueDiff(row, L, R) },
  { code: 'MATCHED_8A', when: ['matched'], test: () => ({ detail: '', confirmed: null }) },
];

/** Only in 8A: the statement it should be in is not pulled, the pull failed, or nothing explains it. */
const sideOfCtx = (ctx: CtxFy, source: '2A' | '2B'): FySide => (source === '2A' ? ctx.st.twoA : ctx.st.twoB);
const only8A = (source: '2A' | '2B'): ReasonRule<CtxFy>[] => [
  {
    code: source === '2A' ? 'EIGHT_A_2A_NOT_PULLED' : 'EIGHT_A_2B_NOT_PULLED', when: ['only_right'],
    test: (row, ctx) => {
      const side = sideOfCtx(ctx, source);
      const d = row.right as RecoDoc;
      const miss = missingFor(side, d);
      if (!miss.length) return null;
      return {
        detail: `${side.source} of ${monthsWords(miss, monthLabel)} not pulled`,
        evidence: `${side.source} of ${monthsWords(miss, monthLabel)} not pulled`, confirmed: false, refPeriod: miss[0],
        action: `Pull the ${side.source} of ${monthsWords(miss, monthLabel)}, then build the report again.`,
      };
    },
  },
  {
    code: 'TWO_A_INCOMPLETE', when: ['only_right'],
    test: (row, ctx) => {
      if (source !== '2A') return null;
      const side = ctx.st.twoA;
      const d = row.right as RecoDoc;
      const m = d.supplierPeriod ? side.metas.get(d.supplierPeriod) : null;
      if (!m?.failedCtins?.includes(d.ctin)) return null;
      return { detail: `the 2A pull of ${monthLabel(m.period)} failed for this supplier`, evidence: `2A of ${monthLabel(m.period)}: supplier's fetch failed`, confirmed: false, refPeriod: m.period };
    },
  },
  {
    code: 'STALE_2A', when: ['only_right'],
    test: (row, ctx) => {
      if (source !== '2A') return null;
      const side = ctx.st.twoA;
      const d = row.right as RecoDoc;
      const m = d.supplierPeriod ? side.metas.get(d.supplierPeriod) : null;
      if (!m?.pulledAt || !d.supplierFiledOn || d.supplierFiledOn <= m.pulledAt) return null;
      return { detail: `2A of ${monthLabel(m.period)} pulled on ${dayLabel(m.pulledAt)}; the supplier filed on ${dayLabel(d.supplierFiledOn)}`, evidence: `2A pulled ${dayLabel(m.pulledAt)}`, confirmed: false, refPeriod: m.period };
    },
  },
  {
    code: 'ONLY_8A_UNEXPLAINED', when: ['only_right'],
    test: (row, ctx) => {
      const d = row.right as RecoDoc;
      const sp = d.supplierPeriod ? ` (reported for ${monthLabel(d.supplierPeriod)})` : '';
      return { detail: `in none of the year's ${source}s pulled${sp}`, evidence: `${source} of every month from ${monthLabel(ctx.st.window[0])} pulled`, confirmed: null };
    },
  },
];

const notCompared = (L: string): ReasonRule<CtxFy> => ({
  code: 'NOT_IN_8A_SECTION', when: ['not_compared'],
  test: (row) => {
    const d = (row.left ?? row.right) as RecoDoc;
    if (row.left && !EIGHT_A_SECTIONS.includes(d.section)) {
      return { detail: sectionLabel(d.section), evidence: `8A holds ${EIGHT_A_SECTIONS.map(sectionLabel).join(', ')} only`, confirmed: null };
    }
    return {
      detail: sectionLabel(d.section), evidence: `The ${L} pulls do not read ${sectionLabel(d.section)}`, confirmed: null,
      action: `Not compared: pull the ${L} again with extension 0.14.0 or later (it reads the notes); until then, check it against your books.`,
    };
  },
});

// ── 2A vs 8A ────────────────────────────────────────────────────────────────

export const RULES_2A_8A: ReasonRule<CtxFy>[] = [
  { code: 'RCM_NOT_IN_8A', when: ['only_left'], test: (row) => (row.left?.reverseCharge ? { detail: 'reverse charge', evidence: '2A marks it reverse charge', confirmed: null } : null) },
  {
    // The 2B said no to it: rejected in IMS, ITC not available, or too late.
    code: 'REJECTED_NOT_IN_8A', when: ['only_left'],
    test: (row, ctx) => {
      if (ctx.st.eightA.basis !== '2B') return null;
      const v = twoBVerdict(ctx.st, row.left as RecoDoc);
      return v?.kind === 'rejected'
        ? { detail: `rejected in IMS in the 2B of ${monthLabel(v.doc.statementPeriod)}`, evidence: `Listed as rejected in the 2B of ${monthLabel(v.doc.statementPeriod)}`, confirmed: true, refPeriod: v.doc.statementPeriod }
        : null;
    },
  },
  {
    code: 'ITC_NA_NOT_IN_8A', when: ['only_left'],
    test: (row, ctx) => {
      if (ctx.st.eightA.basis !== '2B') return null;
      const v = twoBVerdict(ctx.st, row.left as RecoDoc);
      return v?.kind === 'not_available'
        ? { detail: `2B of ${monthLabel(v.doc.statementPeriod)}: ITC not available (${naWords(v.doc)})`, evidence: `2B of ${monthLabel(v.doc.statementPeriod)}`, confirmed: true, refPeriod: v.doc.statementPeriod }
        : null;
    },
  },
  {
    code: 'AFTER_8A_WINDOW', when: ['only_left'],
    test: (row, ctx) => {
      const d = row.left as RecoDoc;
      if (ctx.st.eightA.basis === '2B') {
        const v = twoBVerdict(ctx.st, d);
        if (v?.kind !== 'late') return null;
        return { detail: `first in the 2B of ${monthLabel(v.doc.statementPeriod)}, after ${monthLabel(ctx.st.windowEnd)}`, evidence: `Found in the 2B of ${monthLabel(v.doc.statementPeriod)}`, confirmed: true, refPeriod: v.doc.statementPeriod };
      }
      return null;
    },
  },
  {
    code: 'IN_2B_NOT_IN_8A', when: ['only_left'],
    test: (row, ctx) => {
      if (ctx.st.eightA.basis !== '2B') return null;
      const v = twoBVerdict(ctx.st, row.left as RecoDoc);
      if (v?.kind !== 'itc') return null;
      const gen = ctx.st.eightA.meta.generatedOn ?? ctx.st.eightA.meta.pulledAt;
      const g2b = ctx.st.twoB.metas.get(v.doc.statementPeriod)?.generatedOn ?? null;
      const early = gen && g2b && gen < g2b;
      return {
        detail: `in the 2B of ${monthLabel(v.doc.statementPeriod)} with ITC${early ? `, generated ${dayLabel(g2b)}, after the 8A (${dayLabel(gen)})` : ''}`,
        evidence: `Found in the 2B of ${monthLabel(v.doc.statementPeriod)}`, confirmed: true, refPeriod: v.doc.statementPeriod,
        action: early ? REASONS.EIGHT_A_BEFORE.action : REASONS.IN_2B_NOT_IN_8A.action,
      };
    },
  },
  {
    code: 'NOT_FILED_BY_SUPPLIER', when: ['only_left'],
    test: (row) => {
      const d = row.left as RecoDoc;
      if (d.supplierFiled === true || (d.supplierFiled === null && d.supplierFiledOn)) return null;
      return { detail: '', evidence: d.supplierFiled === false ? '2A shows GSTR-1 / IFF not filed' : '2A shows no filing date', confirmed: null };
    },
  },
  {
    code: 'TWO_B_NOT_PULLED', when: ['only_left'],
    test: (row, ctx) => {
      if (ctx.st.eightA.basis !== '2B') return null;
      const miss = missingFor(ctx.st.twoB, row.left as RecoDoc);
      if (!miss.length) return null;
      return {
        detail: `not in the 2Bs pulled; 2B of ${monthsWords(miss, monthLabel)} not pulled`,
        evidence: `2B of ${monthsWords(miss, monthLabel)} not pulled`, confirmed: false, refPeriod: miss[0],
        action: `Pull the 2B of ${monthsWords(miss, monthLabel)}, then build the report again.`,
      };
    },
  },
  {
    code: 'NOT_IN_ANY_2B', when: ['only_left'],
    test: (row, ctx) => {
      if (ctx.st.eightA.basis !== '2B') return null;
      const d = row.left as RecoDoc;
      const notDue = ctx.st.twoB.notDue;
      return {
        detail: `${d.supplierFiledOn ? `filed on ${dayLabel(d.supplierFiledOn)}; ` : ''}in none of the 2Bs from ${monthLabel(ctx.st.window[0])}${notDue.length ? ` (the 2B of ${monthsWords(notDue, monthLabel)} is not out yet)` : ` to ${monthLabel(ctx.st.windowEnd)}`}`,
        evidence: 'Every 2B of the year pulled', confirmed: notDue.length ? false : true,
        action: notDue.length ? `It can still reach the 2B of ${monthsWords(notDue, monthLabel)}: check IMS (pending or rejected) and ask the supplier.` : REASONS.NOT_IN_ANY_2B.action,
      };
    },
  },
  {
    // An 8A built from 2A (before FY 2023-24): filed after the 8A was generated.
    code: 'EIGHT_A_BEFORE', when: ['only_left'],
    test: (row, ctx) => {
      const d = row.left as RecoDoc;
      const gen = ctx.st.eightA.meta.generatedOn;
      if (ctx.st.eightA.basis !== '2A' || !gen || !d.supplierFiledOn || d.supplierFiledOn <= gen) return null;
      return { detail: `filed on ${dayLabel(d.supplierFiledOn)}, after the 8A was generated on ${dayLabel(gen)}`, evidence: `8A generated ${dayLabel(gen)}`, confirmed: true };
    },
  },
  notCompared('2A'),
  ...only8A('2A'),
  ...bothSides('2A', '8A'),
];

// ── 2B vs 8A ────────────────────────────────────────────────────────────────

export const RULES_2B_8A: ReasonRule<CtxFy>[] = [
  {
    code: 'REVERSAL_NOT_IN_8A', when: ['only_left', 'not_compared'],
    test: (row) => (row.left?.bucket === 'reversal'
      ? { detail: `2B of ${monthLabel(row.left.statementPeriod)}; shown negative: it reduces the ITC`, evidence: "The 2B's ITC reversal section", confirmed: true }
      : null),
  },
  {
    code: 'REJECTED_NOT_IN_8A', when: ['only_left'],
    test: (row) => (row.left?.bucket === 'rejected'
      ? { detail: `rejected in IMS in the 2B of ${monthLabel(row.left.statementPeriod)}`, evidence: 'The 2B lists it as rejected', confirmed: true }
      : null),
  },
  { code: 'RCM_NOT_IN_8A', when: ['only_left'], test: (row) => (row.left?.reverseCharge ? { detail: `2B of ${monthLabel(row.left.statementPeriod)}`, evidence: '2B marks it reverse charge', confirmed: null } : null) },
  {
    code: 'ITC_NA_NOT_IN_8A', when: ['only_left'],
    test: (row) => (row.left && (row.left.bucket === 'not_available' || row.left.itcAvailable === false)
      ? { detail: `2B of ${monthLabel(row.left.statementPeriod)}: ITC not available (${naWords(row.left)})`, evidence: `2B of ${monthLabel(row.left.statementPeriod)}`, confirmed: true }
      : null),
  },
  {
    code: 'AFTER_8A_WINDOW', when: ['only_left'],
    test: (row, ctx) => (row.left && before(ctx.st.windowEnd, row.left.statementPeriod)
      ? { detail: `in the 2B of ${monthLabel(row.left.statementPeriod)}, after ${monthLabel(ctx.st.windowEnd)}`, evidence: `2B of ${monthLabel(row.left.statementPeriod)}`, confirmed: true }
      : null),
  },
  {
    code: 'EIGHT_A_BEFORE', when: ['only_left'],
    test: (row, ctx) => {
      const d = row.left as RecoDoc;
      const gen = ctx.st.eightA.meta.generatedOn ?? ctx.st.eightA.meta.pulledAt;
      const g2b = ctx.st.twoB.metas.get(d.statementPeriod)?.generatedOn ?? null;
      if (ctx.st.eightA.origin !== 'portal' || !gen || !g2b || g2b <= gen) return null;
      return { detail: `the 2B of ${monthLabel(d.statementPeriod)} was generated on ${dayLabel(g2b)}, after the 8A (${dayLabel(gen)})`, evidence: `8A of ${dayLabel(gen)}`, confirmed: true };
    },
  },
  {
    code: 'EIGHT_A_HOLDS_NO_ITC', when: ['matched', 'differs'],
    test: (row) => {
      const l = row.left as RecoDoc;
      if (l.bucket !== 'rejected' && l.bucket !== 'not_available' && l.itcAvailable !== false) return null;
      return {
        detail: `the 2B of ${monthLabel(l.statementPeriod)} ${l.bucket === 'rejected' ? 'lists it as rejected in IMS' : `gives no ITC (${naWords(l)})`}`,
        evidence: `2B of ${monthLabel(l.statementPeriod)}`, confirmed: true, ...(row.status === 'matched' ? { status: 'itc_differs' as const } : {}),
      };
    },
  },
  notCompared('2B'),
  ...only8A('2B'),
  ...bothSides('2B', '8A'),
];

const notes8A: NoteRule<CtxFy>[] = [
  {
    code: 'SUPPLIER_CANCELLED',
    test: (row) => {
      const d = (row.left ?? row.right) as RecoDoc;
      const from = row.left?.supplierCancelledFrom ?? row.right?.supplierCancelledFrom ?? null;
      return from && d.date && d.date >= from ? `Supplier registration cancelled from ${dayLabel(from)}` : null;
    },
  },
  {
    code: 'RULE_37A',
    test: (row, ctx) => {
      const d = row.left?.supplier3bFiled === false ? row.left : null;
      if (!d) return null;
      const deadline = `${fyStartYear(ctx.fy) + 1}-09-30`;
      const pulled = ctx.st.twoA.metas.get(d.statementPeriod)?.pulledAt;
      return pulled && pulled > deadline ? `Supplier had not filed GSTR-3B for ${monthLabel(d.supplierPeriod ?? d.statementPeriod)} by ${dayLabel(deadline)} (Rule 37A)` : null;
    },
  },
  { code: 'ITC_NA_POS', test: (row) => ((row.left?.itcReason ?? row.right?.itcReason)?.toUpperCase() === 'P' ? 'ITC not available: place of supply' : null) },
];

/** The lines above the list: what the 8A is, what is not pulled, what was left out. */
const explainFy = (L: '2A' | '2B') => (rows: RecoRow[], ctx: CtxFy): string[] => {
  const st = ctx.st;
  const side = L === '2A' ? st.twoA : st.twoB;
  const out: string[] = [];
  out.push(st.eightA.origin === 'portal'
    ? `8A: the portal's Table 8A document details${st.eightA.stored?.fileName ? ` (${st.eightA.stored.fileName})` : ''}, ${st.eightA.stored?.via === 'pull' ? 'pulled from the portal' : 'uploaded'} ${dayLabel(st.eightA.meta.pulledAt)}${st.eightA.stored?.uploadedBy ? ` by ${st.eightA.stored.uploadedBy}` : ''}${st.eightA.meta.generatedOn ? `, generated ${dayLabel(st.eightA.meta.generatedOn)}` : ''}.`
    : `8A: not pulled or uploaded, so rebuilt from the year's ${st.eightA.basis} the way the portal builds it (B2B invoices and notes dated in FY ${st.fy}, ITC available, no reverse charge, in a ${st.eightA.basis} of ${monthLabel(st.window[0])} to ${monthLabel(st.windowEnd)}). Pull (extension 0.18.0 fetches the portal's Table 8A document details) or Upload 8A to compare with the portal's own 8A.`);
  if (st.eightA.origin === 'rebuilt' && st.eightA.meta.status) out.push(`The portal's 8A: ${st.eightA.meta.status}`);
  if (side.missing.length) out.push(`${L} of ${monthsWords(side.missing, monthLabel)} not pulled: documents there are not seen. Use Pull.`);
  if (side.notDue.length) out.push(`The year is still open: the ${L} of ${monthsWords(side.notDue, monthLabel)} ${side.notDue.length === 1 ? 'is' : 'are'} not out yet.`);
  if (side.earlierFy) out.push(`${plural(side.earlierFy, 'document')} of an earlier year found in the year's ${L}s ${side.earlierFy === 1 ? 'is' : 'are'} left out: ${side.earlierFy === 1 ? 'it belongs' : 'they belong'} to that year's 8A.`);
  if (side.superseded) out.push(`${plural(side.superseded, 'document')} listed again or amended later ${side.superseded === 1 ? 'is' : 'are'} counted once, at the latest figures.`);
  if (st.eightA.stored?.unread.length) out.push(`Sheets of the 8A file not read: ${st.eightA.stored.unread.join(', ')}.`);
  if (st.eightA.stored?.warnings.length) out.push(`8A file: ${st.eightA.stored.warnings.slice(0, 5).join(' ')}${st.eightA.stored.warnings.length > 5 ? ` (${st.eightA.stored.warnings.length - 5} more)` : ''}`);
  const by = new Map<ReasonCode, RecoRow[]>();
  for (const r of rows) if (r.status !== 'matched') by.set(r.reason, [...(by.get(r.reason) ?? []), r]);
  for (const [code, rs] of by) {
    const tax = rs.reduce((t, r) => t + signedTax(r.left ?? r.right), 0);
    out.push(`${REASONS[code].label}: ${plural(rs.length, 'document')}, tax ${fmt(tax)}.`);
  }
  return out;
};

export const PAIR_2A_8A: PairConfig<CtxFy> = {
  left: '2A', right: '8A', rules: RULES_2A_8A, notes: notes8A,
  fallback: { only_left: 'ONLY_LEFT_8A_UNEXPLAINED', only_right: 'ONLY_8A_UNEXPLAINED', differs: 'VALUE_DIFFERENCE', itc_differs: 'EIGHT_A_HOLDS_NO_ITC', not_compared: 'NOT_IN_8A_SECTION', matched: 'MATCHED_8A' },
  tolerance: 1, explain: explainFy('2A'),
};

export const PAIR_2B_8A: PairConfig<CtxFy> = {
  left: '2B', right: '8A', rules: RULES_2B_8A, notes: notes8A,
  fallback: { only_left: 'ONLY_LEFT_8A_UNEXPLAINED', only_right: 'ONLY_8A_UNEXPLAINED', differs: 'VALUE_DIFFERENCE', itc_differs: 'EIGHT_A_HOLDS_NO_ITC', not_compared: 'NOT_IN_8A_SECTION', matched: 'MATCHED_8A' },
  tolerance: 1, explain: explainFy('2B'),
};

/** The three sources as the matcher takes them (2B's ITC reversal entries listed on their own). */
export function sourceSets(st: FyStatements): Record<'2A' | '2B' | '8A', SourceSet> {
  const read8A = st.eightA.meta.sectionsRead;
  return {
    '2A': { key: '2A', label: '2A', docs: st.twoA.docs, covers: (d) => st.twoA.sectionsRead.includes(d.section) },
    '2B': { key: '2B', label: '2B', docs: st.twoB.docs, covers: () => true, solo: (d) => d.bucket === 'reversal' },
    '8A': { key: '8A', label: '8A', docs: st.eightA.docs, covers: (d) => read8A.includes(d.section) },
  };
}

export interface FyPairRun { result: RecoResult; ctx: CtxFy }

/** Why a year cannot be compared at all, or null. */
export function fyMissingMessage(st: FyStatements, side: '2A' | '2B', clientName: string): string | null {
  const s = side === '2A' ? st.twoA : st.twoB;
  const ready = [...s.metas.entries()].filter(([p, m]) => st.window.includes(p) && m.state === 'ready');
  if (ready.length) return null;
  return `No GSTR-${side} of FY ${st.fy} (${monthLabel(st.window[0])} to ${monthLabel(st.windowEnd)}) is pulled for ${clientName}. Use Pull on this report: it fetches the year's 2A and 2B.`;
}

/** The year's 2A (or 2B) against its 8A. Throws when no statement of that side is pulled. */
export function reconcileFyPair(left: '2A' | '2B', st: FyStatements, client: { name: string; gstin: string | null }, today: string): FyPairRun {
  const msg = fyMissingMessage(st, left, client.name) ?? (st.eightA.origin === 'rebuilt' ? fyMissingMessage(st, st.eightA.basis, client.name) : null);
  if (msg) throw new Error(msg);
  const ctx: CtxFy = { fy: st.fy, st, recipientState: (client.gstin ?? '').slice(0, 2), today };
  const sets = sourceSets(st);
  const cfg = left === '2A' ? PAIR_2A_8A : PAIR_2B_8A;
  return { result: reconcile(sets[left], sets['8A'], cfg, ctx), ctx };
}

/** The FY a month belongs to, for a report built from any month of it. */
export const fyOfMonth = (month: string): string => fyOfPeriod(month);
