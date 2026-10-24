// GSTR-8A vs GSTR-2A vs GSTR-2B for one financial year: every document of the
// year in any of the three statements, side by side, with the reason the three
// differ and a final judgment of the ITC the year can take for it, summed into
// the year's final available ITC. Pure: no Supabase, no React, no clock.
//
// The judgment follows the law as engineering reads it (positions doc §5),
// never the books (the app does not hold them here):
//  - s.16(2)(aa): ITC only on a document the 2B shows with ITC available. The
//    2B's figures are the basis; a 2A or 8A that differs is flagged, not used.
//  - s.16(4): only a 2B of April of the year to October of the next counts; a
//    document that first reaches a later 2B is time-barred.
//  - rejected in IMS, "ITC not available" (place of supply, time limit): no ITC.
//  - Rule 37A: a 2B ITC reversal entry reduces the year's ITC.
//  - imports and ISD credits are eligible but outside 8A (Tables 6E, 6G).
//  - reverse charge: never through 2B / 8A; the ITC follows payment of the tax,
//    so it is listed apart and not in the final figure.
//  - a document no pulled 2B shows, while some 2B of the year is not pulled
//    (or is not out yet), is "to confirm", never eligible and never refused.
// Positions: docs/GSTR8A_RECO_POSITIONS.md.
import type { ColumnGroup, ReportKpi, ReportMetaField, ReportSheet, ReportTable, RowKind, RowTone } from '@/utils/allClientsReports';
import { fyStartYear, periodIndex } from '@/lib/reply/periods';
import { dayLabel, monthLabel, portalDate } from './dates';
import { compareFigures, matchSources } from './engine';
import { fyWindow, monthsWords, type FyStatements } from './fy8a';
import { eightAWords, missingFor, sourceSets } from './reasons8A';
import { docSign, EIGHT_A_SECTIONS, sectionLabel } from './sources';
import type { DocFamily, RecoDoc } from './types';

const r2 = (n: number): number => {
  const v = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  return v === 0 ? 0 : v;
};
const fmt = (n: number) => r2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const before = (a: string, b: string) => periodIndex(a) < periodIndex(b);
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// ── Rows ────────────────────────────────────────────────────────────────────

/** Where the document is: in which of the three statements, and whether their figures agree. */
export type ThreeStatus = 'in_all' | 'in_all_differs' | 'not_in_8a' | 'not_in_2a' | 'not_in_2b' | 'only_2a' | 'only_2b' | 'only_8a' | 'outside_8a';

export const THREE_STATUS_LABEL: Record<ThreeStatus, string> = {
  in_all: 'In 2A, 2B and 8A',
  in_all_differs: 'In all three, figures differ',
  not_in_8a: 'In 2A and 2B, not in 8A',
  not_in_2a: 'In 2B and 8A, not in 2A',
  not_in_2b: 'In 2A and 8A, not in 2B',
  only_2a: 'Only in 2A',
  only_2b: 'Only in 2B',
  only_8a: 'Only in 8A',
  outside_8a: 'Outside 8A (imports, ISD)',
};
const STATUS_ORDER: ThreeStatus[] = ['only_2a', 'only_2b', 'only_8a', 'not_in_8a', 'not_in_2b', 'not_in_2a', 'in_all_differs', 'outside_8a', 'in_all'];

/** The final judgment on a document's ITC for the year. */
export type Verdict = 'eligible' | 'eligible_outside_8a' | 'reverse_37a' | 'rcm' | 'to_confirm' | 'rejected' | 'itc_na' | 'time_barred' | 'not_in_2b' | 'not_filed';

export const VERDICTS: Record<Verdict, { label: string; tone: RowTone; counts: boolean }> = {
  eligible: { label: 'Eligible', tone: 'good', counts: true },
  eligible_outside_8a: { label: 'Eligible (outside 8A)', tone: 'good', counts: true },
  reverse_37a: { label: 'Reverse (Rule 37A)', tone: 'warn', counts: true },
  rcm: { label: 'Reverse charge: on payment', tone: 'info', counts: false },
  to_confirm: { label: 'To confirm', tone: 'warn', counts: false },
  rejected: { label: 'Not available: rejected in IMS', tone: 'bad', counts: false },
  itc_na: { label: 'Not available: 2B says no ITC', tone: 'bad', counts: false },
  time_barred: { label: 'Not available: time-barred u/s 16(4)', tone: 'bad', counts: false },
  not_in_2b: { label: 'Not available: not in any 2B', tone: 'bad', counts: false },
  not_filed: { label: 'Not available: supplier did not file GSTR-1', tone: 'bad', counts: false },
};
const VERDICT_ORDER: Verdict[] = ['eligible', 'eligible_outside_8a', 'reverse_37a', 'rcm', 'to_confirm', 'rejected', 'itc_na', 'time_barred', 'not_in_2b', 'not_filed'];

export interface Amounts { taxable: number; igst: number; cgst: number; sgst: number; cess: number; tax: number }
const ZERO: Amounts = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tax: 0 };
/** A document's figures, signed (a credit note and an ITC reversal entry count −1). */
export const amountsOf = (d: RecoDoc | undefined): Amounts => {
  if (!d) return ZERO;
  const s = docSign(d);
  return { taxable: r2(s * d.taxable), igst: r2(s * d.igst), cgst: r2(s * d.cgst), sgst: r2(s * d.sgst), cess: r2(s * d.cess), tax: r2(s * (d.igst + d.cgst + d.sgst + d.cess)) };
};
const add = (a: Amounts, b: Amounts): Amounts => ({
  taxable: r2(a.taxable + b.taxable), igst: r2(a.igst + b.igst), cgst: r2(a.cgst + b.cgst), sgst: r2(a.sgst + b.sgst), cess: r2(a.cess + b.cess), tax: r2(a.tax + b.tax),
});

export interface ThreeRow {
  a?: RecoDoc;
  b?: RecoDoc;
  e?: RecoDoc;
  status: ThreeStatus;
  verdict: Verdict;
  /** The reason the three statements differ (or agree), in words: `head`, then this document's own detail. */
  reason: string;
  /** The reason without the document's detail: the summary groups by it. */
  head: string;
  action: string;
  evidence: string;
  /** false = inferred (a statement it depends on is not pulled). */
  confirmed: boolean | null;
  /** The ITC the year takes for it (zero unless the verdict counts). */
  final: Amounts;
  /** The figures the judgment is about: the 2B's, else the 8A's, else the 2A's. */
  basis: Amounts;
  basisSource: '2A' | '2B' | '8A';
  notes: string[];
}

const FAMILY_LABEL: Record<DocFamily, string> = { INV: 'Invoice', DN: 'Debit note', CN: 'Credit note', ISD: 'ISD credit', BOE: 'Bill of entry', OTHER: 'Other' };

const statusOf = (a: RecoDoc | undefined, b: RecoDoc | undefined, e: RecoDoc | undefined, outside: boolean, same: boolean): ThreeStatus => {
  if (outside) return 'outside_8a';
  if (a && b && e) return same ? 'in_all' : 'in_all_differs';
  if (a && b) return 'not_in_8a';
  if (b && e) return 'not_in_2a';
  if (a && e) return 'not_in_2b';
  if (a) return 'only_2a';
  if (b) return 'only_2b';
  return 'only_8a';
};

const naWords = (d: RecoDoc): string => {
  const r = d.itcReason?.toUpperCase();
  return r === 'P' ? 'place of supply' : r === 'C' ? 'time limit u/s 16(4)' : d.itcReason ? `reason ${d.itcReason}` : 'no reason given';
};

/** Differences between the figures of the statements that hold the document, in words. */
const figureWords = (a?: RecoDoc, b?: RecoDoc, e?: RecoDoc): string => {
  const parts: string[] = [];
  const say = (x: RecoDoc | undefined, y: RecoDoc | undefined, X: string, Y: string) => {
    if (!x || !y) return;
    const d = compareFigures(x, y, 1);
    if (!d.same) parts.push(`${Y} tax ${d.tax >= 0 ? 'more' : 'less'} than ${X} by ${fmt(Math.abs(d.tax))}${Math.abs(d.taxable) > 1 ? ` (taxable ${d.taxable >= 0 ? '+' : '−'}${fmt(Math.abs(d.taxable))})` : ''}`);
  };
  say(b, e, '2B', '8A');
  say(b, a, '2B', '2A');
  if (!b) say(e, a, '8A', '2A');
  return parts.join('; ');
};

/** Judges one document group. The first rule that applies decides; notes add flags. */
function judge(st: FyStatements, a: RecoDoc | undefined, b: RecoDoc | undefined, e: RecoDoc | undefined): Omit<ThreeRow, 'a' | 'b' | 'e' | 'status' | 'notes'> {
  const portal8A = st.eightA.origin === 'portal';
  const d = (b ?? e ?? a) as RecoDoc;
  const cn = d.family === 'CN';
  const figs = figureWords(a, b, e);
  const basis = b ? amountsOf(b) : e ? amountsOf(e) : amountsOf(a);
  const basisSource: ThreeRow['basisSource'] = b ? '2B' : e ? '8A' : '2A';
  const out = (verdict: Verdict, [head, detail]: [string, string], action: string, evidence = '', confirmed: boolean | null = null) => ({
    verdict, head, reason: detail ? `${head}: ${detail}` : head, action, evidence, confirmed, basis, basisSource, final: VERDICTS[verdict].counts ? basis : ZERO,
  });

  if (b?.bucket === 'reversal') {
    return out('reverse_37a', ['ITC reversal entry (Rule 37A)', `2B of ${monthLabel(b.statementPeriod)}`],
      'Reverse this ITC (GSTR-3B 4(B)(2); GSTR-9 Table 7); reclaim it once the supplier files its GSTR-3B.', "The 2B's ITC reversal section", true);
  }
  if (a?.reverseCharge || b?.reverseCharge || e?.reverseCharge) {
    return out('rcm', ['Reverse charge: never in 2B ITC or 8A', ''],
      'Pay the tax in GSTR-3B 3.1(d), then claim the ITC in 4(A)(3); GSTR-9 Table 6C / 6D. Check the payment against your books.');
  }
  if (b && b.bucket === 'rejected') {
    return out('rejected', ['Rejected in IMS', `2B of ${monthLabel(b.statementPeriod)}${e ? '; the 8A still holds it' : ''}`],
      'No ITC as the 2B stands. If rejected by mistake, ask the supplier to report it again (GSTR-1A or amendment) and accept it before 30 November after the year.', 'The 2B lists it as rejected', true);
  }
  if (b && (b.bucket === 'not_available' || b.itcAvailable === false)) {
    const time = b.itcReason?.toUpperCase() === 'C';
    return out(time ? 'time_barred' : 'itc_na', ['2B says ITC not available', `${naWords(b)}, 2B of ${monthLabel(b.statementPeriod)}`],
      time ? 'No ITC: the time limit u/s 16(4) has passed.' : 'No ITC as the 2B stands; ask the supplier to correct a wrong place of supply.', `2B of ${monthLabel(b.statementPeriod)}`, true);
  }
  if (b && before(st.windowEnd, b.statementPeriod)) {
    return out('time_barred', [`First in a 2B after ${monthLabel(st.windowEnd)}`, `2B of ${monthLabel(b.statementPeriod)}`],
      'Time-barred u/s 16(4): no ITC for the year. Reverse it if it was claimed.', `2B of ${monthLabel(b.statementPeriod)}`, true);
  }
  if (b && !EIGHT_A_SECTIONS.includes(b.section)) {
    return out('eligible_outside_8a', [`${sectionLabel(b.section).charAt(0).toUpperCase()}${sectionLabel(b.section).slice(1)}: never in 8A`, `2B of ${monthLabel(b.statementPeriod)}`],
      b.section.startsWith('IMPG') ? 'Eligible as the 2B shows it: GSTR-9 Table 6E (imports).' : 'Eligible as the 2B shows it: GSTR-9 Table 6G (ISD).', `2B of ${monthLabel(b.statementPeriod)}`, true);
  }
  if (b) {
    const where = `2B of ${monthLabel(b.statementPeriod)}`;
    const reason: [string, string] = !e && portal8A ? ["In 2B with ITC, not in the portal's 8A", where]
      : !a ? [`In 2B with ITC, not in the 2A${st.twoA.sectionsRead.includes(b.section) ? '' : ` (the 2A pulls do not read ${sectionLabel(b.section)})`}`, where]
        : figs ? ['In 2B with ITC; figures differ', `${figs}; ${where}`] : [e ? 'In 2B with ITC; 2A and 8A agree' : 'In 2B with ITC', where];
    const action = cn
      ? 'Reduce the ITC by this credit note as the 2B shows it.'
      : figs ? 'Eligible at the 2B figures; check them against your books and take the lower.'
        : !e && portal8A ? "Eligible as the 2B shows it; the portal's 8A should hold it: download the 8A again."
          : 'Eligible as the 2B shows it.';
    return out('eligible', reason, action, `2B of ${monthLabel(b.statementPeriod)}`, true);
  }
  // Not in any 2B of the year that was read.
  const miss = missingFor(st.twoB, d);
  const notDue = st.twoB.notDue;
  if (e) {
    return out('to_confirm', [miss.length ? 'In 8A; its 2B is not pulled' : 'In 8A, but in no 2B pulled', `${eightAWords(st)}${miss.length ? `; 2B of ${monthsWords(miss, monthLabel)} not pulled` : ''}`],
      miss.length ? `Pull the 2B of ${monthsWords(miss, monthLabel)}; until a 2B shows it, do not count it.` : 'Find it in the 2B on the portal (it may be under another number or GSTIN); until a 2B shows it, do not count it.',
      miss.length ? `2B of ${monthsWords(miss, monthLabel)} not pulled` : 'Every 2B of the year pulled', false);
  }
  const ad = a as RecoDoc;
  if (ad.supplierFiled === false || (ad.supplierFiled === null && !ad.supplierFiledOn)) {
    return out('not_filed', ['Only in 2A: saved by the supplier, GSTR-1 / IFF not filed', ''],
      'No ITC until the supplier files and the document reaches a 2B by October after the year; ask the supplier to file.', ad.supplierFiled === false ? '2A shows GSTR-1 / IFF not filed' : '2A shows no filing date', null);
  }
  if (miss.length || notDue.length) {
    const ps = [...miss, ...notDue];
    return out('to_confirm', miss.length ? ['Only in 2A; a 2B of the year is not pulled', `2B of ${monthsWords(miss, monthLabel)} not pulled`] : ['Only in 2A; the year is still open', `the 2B of ${monthsWords(notDue, monthLabel)} is not out yet`],
      miss.length ? `Pull the 2B of ${monthsWords(miss, monthLabel)}.` : `It can still reach the 2B of ${monthsWords(ps, monthLabel)}: check IMS (pending) and ask the supplier.`,
      miss.length ? `2B of ${monthsWords(miss, monthLabel)} not pulled` : 'Year still open', false);
  }
  return out('not_in_2b', ["Only in 2A: in none of the year's 2Bs (pending or rejected in IMS, or reported too late)", ad.supplierFiledOn ? `filed on ${dayLabel(ad.supplierFiledOn)}` : ''],
    "No ITC (s.16(2)(aa)). Check IMS for it; if it was claimed, reverse it. It is lost once October's 2B after the year has passed without it.", 'Every 2B of the year pulled', true);
}

const notesOf = (st: FyStatements, a?: RecoDoc, b?: RecoDoc, e?: RecoDoc): string[] => {
  const out: string[] = [];
  const any = [a, b, e].filter(Boolean) as RecoDoc[];
  const cancelled = any.find((x) => x.supplierCancelledFrom)?.supplierCancelledFrom;
  const d = any[0];
  if (cancelled && d.date && d.date >= cancelled) out.push(`Supplier registration cancelled from ${dayLabel(cancelled)}`);
  if (a?.supplier3bFiled === false) {
    const deadline = `${fyStartYear(st.fy) + 1}-09-30`;
    const pulled = st.twoA.metas.get(a.statementPeriod)?.pulledAt;
    out.push(pulled && pulled > deadline
      ? `Supplier had not filed GSTR-3B by ${dayLabel(deadline)}: reverse under Rule 37A`
      : `Supplier's GSTR-3B not filed as of the 2A pull${pulled ? ` (${dayLabel(pulled)})` : ''}`);
  }
  if (any.some((x) => x.isAmendment)) out.push('Amended by the supplier: figures as last reported');
  const dates = [...new Set(any.map((x) => x.date).filter(Boolean))];
  if (dates.length > 1) out.push(`Dates differ: ${dates.map((x) => dayLabel(x)).join(' / ')}`);
  return out;
};

export interface ThreeWayResult {
  fy: string;
  rows: ThreeRow[];
  notes: string[];
}

/** Every document of the year in 2A, 2B or 8A, judged. */
export function reconcileThreeWay(st: FyStatements): ThreeWayResult {
  const sets = sourceSets(st);
  // 2B first (the basis), then 8A (built from it), then 2A: each group's representative is its 2B copy.
  const groups = matchSources([sets['2B'], sets['8A'], sets['2A']]);
  const rows: ThreeRow[] = groups.map((g) => {
    const a = g.docs['2A'];
    const b = g.docs['2B'];
    const e = g.docs['8A'];
    const outside = !!b && !EIGHT_A_SECTIONS.includes(b.section);
    const present = [a, b, e].filter(Boolean) as RecoDoc[];
    const same = present.every((x) => compareFigures(present[0], x, 1).same);
    const j = judge(st, a, b, e);
    return { a, b, e, status: statusOf(a, b, e, outside, same && !g.dateDiffers), ...j, notes: notesOf(st, a, b, e) };
  });
  rows.sort((x, y) => STATUS_ORDER.indexOf(x.status) - STATUS_ORDER.indexOf(y.status) || Math.abs(y.basis.tax) - Math.abs(x.basis.tax));
  return { fy: st.fy, rows, notes: explainThree(st, rows) };
}

function explainThree(st: FyStatements, rows: ThreeRow[]): string[] {
  const out: string[] = [];
  out.push(st.eightA.origin === 'portal'
    ? `8A: the portal's Table 8A document details${st.eightA.stored?.fileName ? ` (${st.eightA.stored.fileName})` : ''}, uploaded ${dayLabel(st.eightA.meta.pulledAt)}${st.eightA.meta.generatedOn ? `, generated ${dayLabel(st.eightA.meta.generatedOn)}` : ''}.`
    : `8A is not uploaded, so it is rebuilt from the year's ${st.eightA.basis} the way the portal builds it. Upload the portal's Table 8A document details (GSTR-9, Download Table 8A document details) to compare with the portal's own 8A.`);
  for (const side of [st.twoA, st.twoB]) {
    if (side.missing.length) out.push(`${side.source} of ${monthsWords(side.missing, monthLabel)} not pulled: use Pull.`);
    if (side.earlierFy) out.push(`${plural(side.earlierFy, 'document')} of an earlier year in the year's ${side.source}s left out (they belong to that year).`);
  }
  if (st.twoB.notDue.length) out.push(`The year is still open: the 2B of ${monthsWords(st.twoB.notDue, monthLabel)} ${st.twoB.notDue.length === 1 ? 'is' : 'are'} not out yet, so the final ITC can still change.`);
  if (fyStartYear(st.fy) < 2022) out.push('Before 1 January 2022 the ITC did not depend on GSTR-2B (s.16(2)(aa)); for this year the judgment is stricter than the law then.');
  const rcm = rows.filter((r) => r.verdict === 'rcm');
  if (rcm.length) out.push(`${plural(rcm.length, 'reverse charge document')} (tax ${fmt(rcm.reduce((t, r) => t + r.basis.tax, 0))}) ${rcm.length === 1 ? 'is' : 'are'} not in the final ITC: their ITC follows the payment of the tax (GSTR-9 Table 6C / 6D).`);
  return out;
}

// ── Judgment ────────────────────────────────────────────────────────────────

export interface JudgementLine { key: string; label: string; docs: number | ''; amounts: Amounts | null; note: string; kind: RowKind; tone: RowTone | null }

/** The year's final available ITC and how it is reached, line by line. `portal8A` is the GSTR-9 system figure, when pulled. */
export function judgement(res: ThreeWayResult, st: FyStatements, portal8A: { igst: number; cgst: number; sgst: number; cess: number } | null): JudgementLine[] {
  const sum = (pick: (r: ThreeRow) => RecoDoc | Amounts | undefined | null, where: (r: ThreeRow) => boolean) => {
    let t = ZERO;
    let n = 0;
    for (const r of res.rows) {
      if (!where(r)) continue;
      const v = pick(r);
      if (!v) continue;
      t = add(t, 'ref' in (v as object) ? amountsOf(v as RecoDoc) : v as Amounts);
      n += 1;
    }
    return { t, n };
  };
  const window = new Set(fyWindow(st.fy));
  const lines: JudgementLine[] = [];
  const line = (key: string, label: string, s: { t: Amounts; n: number } | null, note: string, kind: RowKind = 'data', tone: RowTone | null = null) =>
    lines.push({ key, label, docs: s ? s.n : '', amounts: s ? s.t : null, note, kind, tone });

  line('h1', 'As the three statements show it', null, '', 'section');
  line('2a', 'ITC as per GSTR-2A', sum((r) => r.a, (r) => !!r.a), `Documents dated in FY ${st.fy}, 2A of ${monthLabel(st.window[0])} to ${monthLabel(st.windowEnd)}, reverse charge included.`);
  line('2b', 'ITC as per GSTR-2B (ITC available)', sum((r) => r.b, (r) => !!r.b && r.b.bucket !== 'rejected' && r.b.bucket !== 'reversal' && r.b.itcAvailable !== false && window.has(r.b.statementPeriod)),
    'Documents dated in the year with ITC available in a 2B of the window; imports, ISD and reverse charge included.');
  line('8a', st.eightA.origin === 'portal' ? "ITC as per GSTR-8A (portal's Table 8A document details)" : `ITC as per GSTR-8A (rebuilt from the year's ${st.eightA.basis}, not uploaded)`,
    sum((r) => r.e, (r) => !!r.e), 'B2B invoices and notes only.');
  if (portal8A) {
    const t = { taxable: 0, igst: r2(portal8A.igst), cgst: r2(portal8A.cgst), sgst: r2(portal8A.sgst), cess: r2(portal8A.cess), tax: r2(portal8A.igst + portal8A.cgst + portal8A.sgst + portal8A.cess) };
    lines.push({ key: '8a_portal', label: 'GSTR-9 Table 8A as the portal computed it', docs: '', amounts: t, note: 'From the GSTR-9 system-computed figures (GSTR-9 pull).', kind: 'data', tone: null });
  }
  line('h2', 'Final judgment', null, '', 'section');
  const by = (v: Verdict) => sum((r) => r.basis, (r) => r.verdict === v);
  const A = by('eligible');
  const B = by('eligible_outside_8a');
  const C = by('reverse_37a');
  line('A', 'A. Eligible: B2B invoices and notes (8A basis)', A, 'In a 2B of the window with ITC available, no reverse charge; credit notes reduce it.', 'data', 'good');
  line('B', 'B. Eligible outside 8A: imports and ISD', B, 'GSTR-9 Table 6E (imports) and 6G (ISD).', 'data', 'good');
  line('C', 'C. Less: ITC reversal entries (Rule 37A)', C, 'Shown negative.', 'data', C.n ? 'warn' : null);
  const D = { t: add(add(A.t, B.t), C.t), n: A.n + B.n + C.n };
  line('D', `FINAL ITC AVAILABLE FOR FY ${st.fy} (A + B + C)`, D, st.twoB.notDue.length || st.twoB.missing.length ? 'Can still change: see To confirm below.' : 'As the 2Bs of the year stand; check it against your books.', 'total', 'good');
  line('h3', 'Not in the final ITC', null, '', 'section');
  line('rcm', 'Reverse charge: ITC once the tax is paid', by('rcm'), 'GSTR-9 Table 6C / 6D; not from 2B or 8A.', 'data', 'info');
  line('to_confirm', 'To confirm: no 2B pulled shows it yet', by('to_confirm'), 'Pull the 2Bs named on each document; until a 2B shows it, it is not counted.', 'data', 'warn');
  for (const v of ['rejected', 'itc_na', 'time_barred', 'not_in_2b', 'not_filed'] as Verdict[]) {
    line(v, VERDICTS[v].label, by(v), '', 'data', 'bad');
  }
  const e = lines.find((l) => l.key === '8a')?.amounts ?? ZERO;
  line('h4', 'Against 8A', null, '', 'section');
  lines.push({
    key: 'A_minus_8a', label: 'A minus GSTR-8A', docs: '', amounts: { taxable: r2(A.t.taxable - e.taxable), igst: r2(A.t.igst - e.igst), cgst: r2(A.t.cgst - e.cgst), sgst: r2(A.t.sgst - e.sgst), cess: r2(A.t.cess - e.cess), tax: r2(A.t.tax - e.tax) },
    note: 'Eligible B2B ITC against the 8A: each difference is a document listed as Only in 2B / Not in 8A or Only in 8A / To confirm.', kind: 'data', tone: Math.abs(A.t.tax - e.tax) > 1 ? 'warn' : 'good',
  });
  return lines;
}

// ── The report ──────────────────────────────────────────────────────────────

export interface ThreeWayInfo {
  client: { name: string; gstin: string | null };
  /** GSTR-9 Table 8A as the portal computed it (GSTR9_CALC), when pulled. */
  portal8A: { igst: number; cgst: number; sgst: number; cess: number } | null;
}

const itcIn2B = (b?: RecoDoc): string => {
  if (!b) return '';
  if (b.bucket === 'rejected') return 'Rejected';
  if (b.bucket === 'reversal') return 'Reversal';
  if (b.bucket === 'not_available' || b.itcAvailable === false) return `No (${naWords(b)})`;
  return 'Yes';
};
const kinds = (n: number, total: boolean): RowKind[] => [...Array(n).fill('data' as RowKind), ...(total ? ['total' as RowKind] : [])];
const sumCol = (rows: (string | number)[][], c: number): number => r2(rows.reduce((s, r) => s + (typeof r[c] === 'number' ? (r[c] as number) : 0), 0));
const amt = (d: RecoDoc | undefined, k: keyof Amounts): number | '' => (d ? amountsOf(d)[k] : '');

/** The three-way report: the judgment, the documents side by side, the summary by reason and the analysis sheets. */
export function threeWayReportTable(res: ThreeWayResult, st: FyStatements, info: ThreeWayInfo): ReportTable {
  const name = info.client.name || 'Client';
  const gstin = info.client.gstin || 'not on record';
  const lines = judgement(res, st, info.portal8A);
  const rows = [...res.rows].sort((x, y) => STATUS_ORDER.indexOf(x.status) - STATUS_ORDER.indexOf(y.status)
    || ((x.b ?? x.e ?? x.a)?.supplierName || '￿').localeCompare((y.b ?? y.e ?? y.a)?.supplierName || '￿', 'en', { sensitivity: 'base' })
    || ((x.b ?? x.e ?? x.a)?.date ?? '').localeCompare((y.b ?? y.e ?? y.a)?.date ?? ''));

  const final = lines.find((l) => l.key === 'D')?.amounts ?? ZERO;
  const pending = lines.find((l) => l.key === 'to_confirm');
  const notAvail = lines.filter((l) => ['rejected', 'itc_na', 'time_barred', 'not_in_2b', 'not_filed'].includes(l.key));
  const notAvailTax = r2(notAvail.reduce((t, l) => t + (l.amounts?.tax ?? 0), 0));
  const notAvailDocs = notAvail.reduce((t, l) => t + (typeof l.docs === 'number' ? l.docs : 0), 0);
  const tax = (k: string) => lines.find((l) => l.key === k)?.amounts?.tax ?? 0;
  const inAll = rows.filter((r) => r.status === 'in_all').length;

  const meta: ReportMetaField[] = [
    { label: 'Client', value: name },
    { label: 'GSTIN', value: gstin },
    { label: 'Financial year', value: `FY ${st.fy}` },
    { label: 'Statements', value: `2A and 2B of ${monthLabel(st.window[0])} to ${monthLabel(st.windowEnd)}` },
    { label: '8A', value: st.eightA.origin === 'portal' ? `portal file, uploaded ${dayLabel(st.eightA.meta.pulledAt)}` : `rebuilt from the year's ${st.eightA.basis} (not uploaded)` },
  ];
  const kpis: ReportKpi[] = [
    { label: 'Documents', value: rows.length, note: `${rows.filter((r) => r.a).length} in 2A, ${rows.filter((r) => r.b).length} in 2B, ${rows.filter((r) => r.e).length} in 8A` },
    { label: 'In all three, same', value: inAll, note: rows.length ? `${Math.round((inAll / rows.length) * 1000) / 10}%` : undefined, tone: 'good' },
    { label: `Final ITC, FY ${st.fy}`, value: final.tax, note: 'A + B + C', tone: 'good' },
    { label: 'To confirm', value: pending?.amounts?.tax ?? 0, note: `${pending?.docs || 0} documents`, tone: pending?.docs ? 'warn' : 'good' },
    { label: 'Not available', value: notAvailTax, note: `${notAvailDocs} documents`, tone: notAvailDocs ? 'bad' : 'good' },
    { label: '2A tax', value: tax('2a') },
    { label: '2B tax (ITC available)', value: tax('2b') },
    { label: st.eightA.origin === 'portal' ? '8A tax' : '8A tax (rebuilt)', value: tax('8a') },
  ];

  const headers = [
    'Sr.', 'Doc Month', 'Supplier GSTIN', 'Supplier Name', 'Doc Type', 'Doc No.', 'Doc Date', 'Section',
    '2A Taxable Value', '2A Total Tax', '2A Filed On',
    '2B Taxable Value', '2B Total Tax', '2B Month', 'ITC in 2B',
    '8A Taxable Value', '8A Total Tax',
    'Found In', 'Status', 'Reason',
    'Final ITC', 'Final IGST', 'Final CGST', 'Final SGST', 'Final Cess', 'Final Total ITC',
    'What to do', 'Evidence', 'Also note',
  ];
  const headerLabels = [
    'Sr.', 'Month', 'Supplier GSTIN', 'Supplier name', 'Doc type', 'Doc no.', 'Doc date', 'Section',
    'Taxable value', 'Total tax', 'Filed on',
    'Taxable value', 'Total tax', '2B month', 'ITC',
    'Taxable value', 'Total tax',
    'Found in', 'Status', 'Reason',
    'Judgment', 'IGST', 'CGST', 'SGST', 'Cess', 'Total ITC',
    'What to do', 'Evidence', 'Also note',
  ];
  const columnGroups: ColumnGroup[] = [
    { label: 'Document', span: 8 }, { label: 'GSTR-2A', span: 3 }, { label: 'GSTR-2B', span: 4 }, { label: 'GSTR-8A', span: 2 },
    { label: 'Reconciliation', span: 3 }, { label: `Final ITC for FY ${st.fy}`, span: 6 }, { label: 'Notes', span: 3 },
  ];
  const body: (string | number)[][] = rows.map((r, i) => {
    const d = (r.b ?? r.e ?? r.a) as RecoDoc;
    const found = [r.a && '2A', r.b && '2B', r.e && '8A'].filter(Boolean).join(', ');
    const numbers = [...new Set([r.a, r.b, r.e].filter(Boolean).map((x) => (x as RecoDoc).number))].join(' / ');
    return [
      i + 1, d.date ? monthLabel(`${d.date.slice(5, 7)}/${d.date.slice(0, 4)}`) : '', d.ctin, d.supplierName ?? r.a?.supplierName ?? '',
      `${FAMILY_LABEL[d.family]}${d.isAmendment ? ' (amended)' : ''}`, numbers, portalDate(d.date), d.section,
      amt(r.a, 'taxable'), amt(r.a, 'tax'), r.a ? portalDate(r.a.supplierFiledOn) : '',
      amt(r.b, 'taxable'), amt(r.b, 'tax'), r.b ? monthLabel(r.b.statementPeriod) : '', itcIn2B(r.b),
      amt(r.e, 'taxable'), amt(r.e, 'tax'),
      found, THREE_STATUS_LABEL[r.status], r.confirmed === false ? `${r.reason} (not confirmed)` : r.reason,
      VERDICTS[r.verdict].label, r.final.igst, r.final.cgst, r.final.sgst, r.final.cess, r.final.tax,
      r.action, r.evidence, r.notes.join('; '),
    ];
  });
  const AMOUNT_COLS = [8, 9, 11, 12, 15, 16, 21, 22, 23, 24, 25];
  const total: (string | number)[] = headers.map(() => '');
  total[1] = 'TOTAL';
  for (const c of AMOUNT_COLS) total[c] = sumCol(body, c);

  // ── Summary by reason (status, judgment) ──
  const groups = new Map<string, { status: ThreeStatus; verdict: Verdict; reason: string; rows: ThreeRow[] }>();
  for (const r of rows) {
    const k = `${r.status}|${r.verdict}|${r.head}`;
    const g = groups.get(k) ?? { status: r.status, verdict: r.verdict, reason: r.head, rows: [] };
    g.rows.push(r);
    groups.set(k, g);
  }
  const sum = (rs: ThreeRow[], f: (r: ThreeRow) => number) => r2(rs.reduce((t, r) => t + f(r), 0));
  const glist = [...groups.values()].sort((x, y) => STATUS_ORDER.indexOf(x.status) - STATUS_ORDER.indexOf(y.status) || VERDICT_ORDER.indexOf(x.verdict) - VERDICT_ORDER.indexOf(y.verdict) || y.rows.length - x.rows.length);
  const sRows: (string | number)[][] = glist.map((g) => [
    THREE_STATUS_LABEL[g.status], g.reason, VERDICTS[g.verdict].label, g.rows.length,
    sum(g.rows, (r) => amountsOf(r.a).tax), sum(g.rows, (r) => amountsOf(r.b).tax), sum(g.rows, (r) => amountsOf(r.e).tax), sum(g.rows, (r) => r.final.tax),
    g.rows[0].action,
  ]);
  sRows.push(['', 'TOTAL', '', rows.length, sumCol(sRows, 4), sumCol(sRows, 5), sumCol(sRows, 6), sumCol(sRows, 7), '']);

  // ── Final ITC sheet ──
  const jRows: (string | number)[][] = lines.map((l) => [l.label, l.docs, l.amounts?.igst ?? '', l.amounts?.cgst ?? '', l.amounts?.sgst ?? '', l.amounts?.cess ?? '', l.amounts?.tax ?? '', l.note]);
  const judgementSheet: ReportSheet = {
    name: 'Final ITC',
    title: `Final available ITC, FY ${st.fy}`,
    headers: ['Line', 'Documents', 'IGST', 'CGST', 'SGST', 'Cess', 'Total ITC', 'Note'],
    rows: jRows,
    rowTones: lines.map((l) => l.tone),
    rowKinds: lines.map((l) => l.kind),
    toneColumn: 0,
    columnWidths: [46, 10, 14, 14, 14, 11, 15, 60],
  };

  // ── By supplier ──
  const sup = new Map<string, { ctin: string; name: string; rows: ThreeRow[] }>();
  for (const r of rows) {
    const d = (r.b ?? r.e ?? r.a) as RecoDoc;
    const k = d.ctin || `~${d.supplierName ?? ''}`;
    const g = sup.get(k) ?? { ctin: d.ctin, name: d.supplierName ?? '', rows: [] };
    if (!g.name && d.supplierName) g.name = d.supplierName;
    g.rows.push(r);
    sup.set(k, g);
  }
  const supList = [...sup.values()].map((g) => ({
    ...g,
    a: sum(g.rows, (r) => amountsOf(r.a).tax), b: sum(g.rows, (r) => amountsOf(r.b).tax), e: sum(g.rows, (r) => amountsOf(r.e).tax),
    f: sum(g.rows, (r) => r.final.tax),
    pending: sum(g.rows.filter((r) => r.verdict === 'to_confirm'), (r) => r.basis.tax),
    na: sum(g.rows.filter((r) => ['rejected', 'itc_na', 'time_barred', 'not_in_2b', 'not_filed'].includes(r.verdict)), (r) => r.basis.tax),
  })).sort((x, y) => Math.abs(y.a - y.f) + Math.abs(y.e - y.f) - (Math.abs(x.a - x.f) + Math.abs(x.e - x.f)) || x.name.localeCompare(y.name));
  const supRows: (string | number)[][] = supList.map((g) => [g.ctin, g.name || (g.ctin ? '' : 'Imports (no GSTIN)'), g.rows.length, g.a, g.b, g.e, g.f, g.pending, g.na]);
  const supTotal: (string | number)[] = ['', 'TOTAL'];
  for (let c = 2; c < 9; c++) supTotal.push(sumCol(supRows, c));
  const supplierSheet: ReportSheet = {
    name: 'By supplier',
    title: 'By supplier',
    headers: ['Supplier GSTIN', 'Supplier Name', 'Documents', '2A Total Tax', '2B Total Tax', '8A Total Tax', 'Final ITC', 'To Confirm', 'Not Available'],
    rows: [...supRows, supTotal],
    rowKinds: kinds(supRows.length, true),
    toneColumn: -1,
    freezeColumns: 2,
    columnWidths: [17, 32, 10, 14, 14, 14, 14, 13, 13],
  };

  const flagged = rows.filter((r) => r.notes.length || r.confirmed === false);
  const notesSheet: ReportSheet = {
    name: 'Notes and evidence',
    title: 'Notes and evidence',
    pdf: false,
    headers: ['Supplier GSTIN', 'Supplier Name', 'Doc No.', 'Status', 'Reason', 'Final ITC', 'Evidence', 'Also note'],
    rows: flagged.map((r) => {
      const d = (r.b ?? r.e ?? r.a) as RecoDoc;
      return [d.ctin, d.supplierName ?? '', d.number, THREE_STATUS_LABEL[r.status], r.reason, VERDICTS[r.verdict].label, r.evidence, r.notes.join('; ')];
    }),
    rowTones: flagged.map((r) => VERDICTS[r.verdict].tone),
    rowKinds: kinds(flagged.length, false),
    toneColumn: 5,
    freezeColumns: 3,
    columnWidths: [17, 28, 14, 22, 44, 24, 30, 40],
  };

  const common = `Client: ${name}   |   GSTIN: ${gstin}`;
  return {
    title: 'GSTR-8A vs GSTR-2A vs GSTR-2B Reconciliation',
    subtitle: [common, `FY ${st.fy}`, `8A: ${st.eightA.origin === 'portal' ? 'portal file' : `rebuilt from ${st.eightA.basis}`}`].join('   |   '),
    meta,
    kpis,
    headers,
    headerLabels,
    columnGroups,
    rows: [...body, total],
    rowTones: [...rows.map((r) => VERDICTS[r.verdict].tone), null],
    rowKinds: kinds(rows.length, true),
    toneColumn: headers.indexOf('Final ITC'),
    freezeColumns: 4,
    sheetName: 'Documents',
    fileNameBase: `GSTR8A_vs_2A_vs_2B_${fileSafe(name)}_FY_${st.fy}`,
    columnWidths: [5, 9, 17, 26, 12, 16, 10, 8, 13, 12, 10, 13, 12, 9, 11, 13, 12, 12, 20, 40, 22, 11, 11, 11, 9, 12, 36, 26, 30],
    // Supplier, number, date, the three taxes, status, reason, judgment and its ITC: a landscape page.
    pdfColumns: [3, 5, 6, 9, 12, 16, 18, 19, 20, 25],
    summary: {
      title: 'Summary by reason',
      headers: ['Status', 'Reason', 'Final ITC', 'Documents', '2A Total Tax', '2B Total Tax', '8A Total Tax', 'Final Total ITC', 'What to do'],
      rows: sRows,
      rowTones: [...glist.map((g) => VERDICTS[g.verdict].tone), null],
      rowKinds: kinds(glist.length, true),
      toneColumn: 2,
      columnWidths: [20, 40, 22, 9, 13, 13, 13, 13, 36],
      notes: res.notes,
    },
    extraSheets: [judgementSheet, supplierSheet, notesSheet],
  };
}
