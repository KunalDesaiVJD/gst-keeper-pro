// Build a GSTR-3B JSON (GSTN offline-utility schema) from the app's already-
// computed numbers.
//
// ⚠️ THIS FILES TAX. The output is a DRAFT: a CA must verify it line-by-line,
// and it must be tested in shadow mode before any live push. Several mappings
// are marked REVIEW below because the app doesn't compute them (Table 5 inward
// exempt) or the GSTN mapping is ambiguous (4D → itc_inelg).
//
// Sources:
//   Table 3.1 (outward) + 3.2   ← the client's GSTR-1 raw JSON (computed here;
//                                 3.1(a) vs 3.1(b) by src/lib/gstr1/supplyKind.ts,
//                                 docs/GSTR3B_OUTWARD_POSITIONS.md)
//   Table 3.1(d) inward RCM     ← RCM Summary totals (rcm_data)
//   Table 4 (ITC) 4A / 4B / 4C  ← ITC Summary (itc_summaries.data)
//   Table 4D(2) ineligible      ← ITC Summary 4D(2)  [4D(1) reclaim already sits inside 4A(5)]
//   Table 5 (exempt inward)     ← NOT computed by the app → left 0 (REVIEW)

import { computePartialItcSplit } from './builderPartialItc';
import { reclaimed4D1 } from '@/lib/itc4D';
import { b2bRow, cdnurRow, isUin, noteSign, type Outward31Row } from '@/lib/gstr1/supplyKind';
import { amendmentDifferences, b2csaLines, type AmendmentDifference, type Gstr1History } from '@/lib/gstr1/amendments';

export interface ItcRow { srNo: string; igst: number; cgst: number; sgst: number; particular?: string }
export interface ItcData { section4A: ItcRow[]; section4B: ItcRow[]; section4D: ItcRow[] }
export interface RcmTotals { taxable: number; igst: number; cgst: number; sgst: number }

// A row from the GSTR-3B Adjustments module (gstr3b_adjustments table) — a
// correction that legitimately belongs in this period's 3B but doesn't come
// from GSTR-1/ITC Summary/RCM (a GSTR-1A amendment, a prior-period true-up).
// Only the seven mapped table_ref values below fold into the computed
// totals; anything else ("Other") is deliberately left out and surfaced via
// `flags` so it isn't silently missing from the draft.
export interface Gstr3bAdjustment {
  tableRef: string;    // '3.1(a)' | '3.1(b)' | '3.1(c)' | '3.1(d)' | '3.1(e)' | '4A(5)' | '4B(1)' | 'Other'
  label: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr3bInput {
  gstin: string;
  periodMonth: string;    // "MM/YYYY"
  gstr1Raw: any | null;   // GSTR-1 JSON (outward supplies)
  itc: ItcData | null;    // itc_summaries.data
  rcm: RcmTotals;         // RCM liability/ITC totals for the period
  adjustments?: Gstr3bAdjustment[]; // GSTR-3B Adjustments module rows for this period
  // The client's other GSTR-1s (loadGstr1History), so each amendment counts
  // at its difference from what was last reported. Not found: nil, flagged.
  gstr1History?: Gstr1History;
  // Whether this client's GSTR-3B (or GSTR-3B (Q)) for periodMonth is already
  // Filed. Required (not defaulted) so every caller makes an explicit choice —
  // see RCM_RCHRG_FIX_FROM below for why this matters.
  alreadyFiled: boolean;
  // Builder Partial-ITC / No-ITC clients (docs/BUILDER_GST_POSITIONS.md §7)
  // reverse ITC by carpet-area apportionment instead of the plain default
  // Table 4(B) rows — omit for a non-builder or Regular-scheme client.
  builderItcType?: string | null;
  commercialArea?: number | null;
  residentialArea?: number | null;
  // Reverse charge inside `rcm` whose credit is blocked, so it is liability in
  // 3.1(d) but never ITC in 4A(3): the builder TDR/FSI reverse charge, whose
  // credit the 1%/5% scheme blocks (docs/BUILDER_GST_POSITIONS.md §12).
  rcmItcBlocked?: RcmTotals | null;
  // Reverse charge credit in 4A(3) attributable wholly to commercial units:
  // the FSI commercial leg in a REP other than an RREP. Claimed in full, so a
  // Partial-ITC builder's carpet apportionment leaves it out of its base.
  rcmItcExclusive?: TaxHead | null;
}

export interface TaxHead { igst: number; cgst: number; sgst: number }
export interface Gstr3bSummary {
  outward: { txval: number; igst: number; cgst: number; sgst: number }; // 3.1(a)
  zeroRated: { txval: number; igst: number; cess: number };             // 3.1(b) exports and SEZ
  nilExempt: number;                                                    // 3.1(c) txval
  rcmLiability: { txval: number; igst: number; cgst: number; sgst: number }; // 3.1(d)
  nonGst: number;                                                       // 3.1(e) txval
  itcAvailable: TaxHead;  // 4A total
  // 4(A) ITC Available bifurcation — the five portal rows (1)–(5).
  itcAvailableRows: { srNo: string; label: string; igst: number; cgst: number; sgst: number }[];
  itcReversed: TaxHead;   // 4B total
  // 4(B) ITC Reversed bifurcation — the two portal rows (1)-(2), same
  // pattern as itcAvailableRows/itcOtherDetails below.
  itcReversedRows: { srNo: string; label: string; igst: number; cgst: number; sgst: number }[];
  itcNet: TaxHead;        // 4C
  itcIneligible: TaxHead; // 4D(2)
  // 4(D) Other Details — the four portal rows (D)(1), (1.1), (1.2), (2),
  // taken straight from the ITC Summary section 4D.
  itcOtherDetails: { srNo: string; label: string; igst: number; cgst: number; sgst: number }[];
  totalLiability: TaxHead;      // 3.1(a) + 3.1(b) + 3.1(d)
  indicativeNetPayable: TaxHead; // liability − net ITC (indicative; real offset is done on the portal)
}
export interface Gstr3bResult {
  json: any;
  summary: Gstr3bSummary;
  flags: string[];
  // How many GSTR-3B Adjustments rows fed into the totals above, and how
  // many were left out because their table_ref isn't one of the mapped
  // seven (e.g. 'Other') — surfaced so the UI can badge the draft.
  adjustmentsApplied: number;
  adjustmentsUnmapped: number;
  // Option 3 (14 Oct 2026): ITC Summary rows in 4A(5) that were typed rather
  // than taken from 2B (fetchGstr3b fills it; the page marks Table 4 in red).
  itcTyped?: Gstr3bItcTyped[];
}
export interface Gstr3bItcTyped {
  row: '5.1' | '5.2' | '5.3';
  label: string;
  typed: { igst: number; cgst: number; sgst: number };
  // Row 5.1: what Import 2B and this month's Not-in-2B reversal give.
  // Row 5.3: what the month's 2B credit notes reduce. None for row 5.2.
  twob?: { igst: number; cgst: number; sgst: number };
}

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;
const num = (v: any) => (typeof v === 'number' ? v : parseFloat(v) || 0);

// The GSTR-1 JSON as stored: loosely shaped, read field by field.
type Gj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const list = (v: unknown): Gj[] => (Array.isArray(v) ? v : []);

// B2B invoices marked `rchrg: 'Y'` (Table 4B — reverse charge) are the
// recipient's liability, not the supplier's: GSTN's own "Total Liability"
// line on the filed acknowledgement counts their taxable value but zeroes
// their tax. Gated from Aug-2026 onward, OR any earlier period that is
// genuinely still unfiled — periods that were already filed (regardless of
// month) keep the un-gated figure, since recomputing them now would show a
// number that no longer matches what was actually filed. A calendar cutoff
// alone isn't enough: a straggling pre-Aug-2026 period that hasn't been
// filed yet (e.g. still Data Pending) must get the correct figure too, since
// nothing has been filed against the wrong number yet.
const RCM_RCHRG_FIX_FROM = 202608; // YYYY * 100 + MM
const periodSortKey = (mmYyyy: string): number => {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  return (parseInt(yyyy, 10) || 0) * 100 + (parseInt(mm, 10) || 0);
};

function retPeriod(mmYyyy: string): string {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  return mm && yyyy ? `${mm}${yyyy}` : '';
}

// ---- Table 4 helpers -------------------------------------------------------
function row(rows: ItcRow[] | undefined, sr: string): ItcRow {
  return (rows || []).find((r) => r.srNo === sr) || { srNo: sr, igst: 0, cgst: 0, sgst: 0 };
}
const add3 = (...rs: TaxHead[]): TaxHead => rs.reduce(
  (a, r) => ({ igst: a.igst + (r.igst || 0), cgst: a.cgst + (r.cgst || 0), sgst: a.sgst + (r.sgst || 0) }),
  { igst: 0, cgst: 0, sgst: 0 });
const sub3 = (a: TaxHead, b: TaxHead): TaxHead => ({ igst: a.igst - b.igst, cgst: a.cgst - b.cgst, sgst: a.sgst - b.sgst });
const round3 = (t: TaxHead): TaxHead => ({ igst: r2(t.igst), cgst: r2(t.cgst), sgst: r2(t.sgst) });

// ---- Table 3.1 outward, computed from the GSTR-1 raw JSON ------------------
// Which row a document goes to is decided in one place,
// src/lib/gstr1/supplyKind.ts (docs/GSTR3B_OUTWARD_POSITIONS.md):
//   3.1(a) R, DE and CBW invoices, B2CL, B2CS, advances, and their notes;
//   3.1(b) exports (exp, WPAY and WOPAY) and SEZ supplies (SEWP, SEWOP),
//          and their notes: cdnr notes whose inv_typ is SEWP / SEWOP, cdnur
//          notes whose typ is EXPWP / EXPWOP. The IGST on an export or SEZ
//          supply with payment is shown in 3.1(b) and is payable.
interface Heads { txval: number; iamt: number; camt: number; samt: number; csamt: number }
const heads = (): Heads => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
/** The 3.1 bucket a document goes to. */
type Pick31 = (row: Outward31Row) => Heads;
// One rate line into its bucket. Reverse charge: the value counts, the tax
// is the recipient's (Table 4B; see RCM_RCHRG_FIX_FROM).
const addLine = (to: Heads, d: Gj, sign: number, valueOnly: boolean) => {
  to.txval += sign * num(d.txval);
  if (valueOnly) return;
  to.iamt += sign * num(d.iamt); to.camt += sign * num(d.camt); to.samt += sign * num(d.samt); to.csamt += sign * num(d.csamt);
};
const isRcm = (doc: Gj) => String(doc.rchrg || 'N').toUpperCase() === 'Y';

// The document tables, one adder per JSON shape. The amendment tables share
// the shape of the table they amend (b2ba of b2b, cdnra of cdnr, cdnura of
// cdnur, expa of exp, b2cla of b2cl), so the same adder sorts both.
// A note is signed by noteSign: a credit note takes off, a debit note adds.
// A note against an RCM invoice carries its own rchrg='Y' (GSTN's real
// schema puts it on the note, not just the original invoice) and gets the
// same treatment as the RCM invoice — value only, no tax — or its tax
// adjustment nets against nothing (the original invoice's tax was never
// added) and produces a phantom negative liability.
const addB2b = (rows: unknown, pick: Pick31, rcmFix: boolean, m = 1) => list(rows).forEach((p) => list(p.inv).forEach((inv) => {
  const to = pick(b2bRow(inv));
  const valueOnly = rcmFix && isRcm(inv);
  list(inv.itms).forEach((i) => addLine(to, i.itm_det || {}, m, valueOnly));
}));
const addB2cl = (rows: unknown, pick: Pick31, m = 1) => list(rows).forEach((s) => list(s.inv).forEach((inv) =>
  list(inv.itms).forEach((i) => addLine(pick('3.1(a)'), i.itm_det || {}, m, false))));
const addCdnr = (rows: unknown, pick: Pick31, rcmFix: boolean, m = 1) => list(rows).forEach((p) => list(p.nt).forEach((nt) => {
  const to = pick(b2bRow(nt)); // a registered note carries the inv_typ of its invoice
  const sign = noteSign(nt, 'cdnr') * m;
  const valueOnly = rcmFix && isRcm(nt);
  list(nt.itms).forEach((i) => addLine(to, i.itm_det || {}, sign, valueOnly));
}));
const addCdnur = (rows: unknown, pick: Pick31, rcmFix: boolean, m = 1) => list(rows).forEach((nt) => {
  const to = pick(cdnurRow(nt));
  const sign = noteSign(nt, 'cdnur') * m;
  const valueOnly = rcmFix && isRcm(nt);
  list(nt.itms).forEach((i) => addLine(to, i.itm_det || {}, sign, valueOnly));
});
// Exports: zero rated, value, IGST (with payment) and cess. Flat rate lines.
const addExp = (rows: unknown, pick: Pick31, m = 1) => list(rows).forEach((e) => list(e.inv).forEach((inv) =>
  list(inv.itms).forEach((i) => addLine(pick('3.1(b)'), i.itm_det || i, m, false))));
// Advances. The advance amount IS the value being offered to tax when the
// supply is a service — construction is, so Notification 66/2017 does not
// apply and tax falls due on receipt. Carrying only the tax and not the
// value left 3.1(a) internally inconsistent, and materially so for a
// builder, where most of the consideration arrives as advances long before
// any invoice. AT adds value and tax; TXPD takes both back out when an
// invoice later absorbs the advance and reports the full value in Table 7.
//
// One POS group can carry SEVERAL rate lines (an 18% and a 12% advance at
// the same place of supply is one group with two `itms`). Reading only
// itms[0], as this did, dropped every rate but the first straight out of
// 3.1(a) — understating the liability on 11A and overstating it on 11B.
// Sum every line, the way buildGstr1Summary always has.
const advanceLines = (a: Gj): Gj[] => (Array.isArray(a?.itms) && a.itms.length ? a.itms : [a]);
const addAdvances = (j: Gj, det: Heads, m = 1) => {
  list(j.at).forEach((a) => advanceLines(a).forEach((it) => {
    det.txval += m * num(it.ad_amt);
    det.iamt += m * num(it.iamt); det.camt += m * num(it.camt); det.samt += m * num(it.samt);
  }));
  list(j.txpd).forEach((a) => advanceLines(a).forEach((it) => {
    det.txval -= m * num(it.ad_amt);
    det.iamt -= m * num(it.iamt); det.camt -= m * num(it.camt); det.samt -= m * num(it.samt);
  }));
};
/** Every base table of a GSTR-1 JSON into 3.1(a) / (b), times m. */
const addOutwardDocs = (j: Gj, into: Pick31, rcmFix: boolean, m = 1) => {
  addB2b(j.b2b, into, rcmFix, m);
  addB2cl(j.b2cl, into, m);
  list(j.b2cs).forEach((i) => addLine(into('3.1(a)'), i, m, false));
  addCdnr(j.cdnr, into, rcmFix, m);
  addCdnur(j.cdnur, into, rcmFix, m);
  addExp(j.exp, into, m);
  addAdvances(j, into('3.1(a)'), m);
};

// Table 10 (b2csa) rate lines: under itms[] in the portal's shape
// (Builder's), flat in older files.
// A Table 10 entry that reverses a rate and re-reports the same value at
// another (a line below zero, the lines netting to nil value) states the
// DIFFERENCE, not the revised month: the Builder's re-rating
// (builderGstr1.ts, discharge_mode 'GSTR1_AMENDMENT') writes exactly this.
// Its tax difference is this month's liability and is folded into 3.1(a).
// Any other entry restates the earlier month in full, like every other
// amendment, and is flagged, never folded (docs/ADVANCE_SETOFF_POSITIONS.md
// §7.2): adding a restated figure would overstate 3.1(a).
export const isB2csaDifference = (a: Gj): boolean => {
  const lines = b2csaLines(a);
  const net = lines.reduce((t, l) => t + num(l.txval), 0);
  return lines.some((l) => num(l.txval) < 0) && Math.abs(net) < 0.005;
};

/** What one GSTR-1 amendment table restates, by the 3.1 row its documents belong to. */
export interface Gstr1AmendmentSum { table: string; label: string; docs: number; a: Heads; b: Heads }
const AMENDMENT_TABLES: { table: string; label: string }[] = [
  { table: 'b2ba', label: 'Table 9A B2B invoices (b2ba)' },
  { table: 'b2cla', label: 'Table 9A B2C large invoices (b2cla)' },
  { table: 'expa', label: 'Table 9A exports (expa)' },
  { table: 'cdnra', label: 'Table 9C registered credit / debit notes (cdnra)' },
  { table: 'cdnura', label: 'Table 9C unregistered credit / debit notes (cdnura)' },
  { table: 'b2csa', label: 'Table 10 B2C small, restated (b2csa)' },
];

// Amendments (9A, 9C, a restated Table 10, 11(2)) count at their difference
// (position 12) from this return period, or in any month whose GSTR-3B is
// not yet filed. Earlier filed months keep what they were computed with:
// the amendment flagged, never folded (the firm, 29 Oct 2026: nothing about
// a filed return changes).
const AMENDMENT_FOLD_FROM = 202609; // YYYY * 100 + MM

/** One amendment counted at its difference, by 3.1 row. */
export interface Gstr1AmendmentDifference {
  table: AmendmentDifference['table'];
  label: string;
  ref: string;
  /** False: what was last reported is not in the app, taken as nil. */
  known: boolean;
  source: string;
  revised: { a: Heads; b: Heads };
  earlier: { a: Heads; b: Heads };
  diff: { a: Heads; b: Heads };
}

const restatedB2csa = (a: Gj) => !isB2csaDifference(a);

function computeOutward(g: Gj | null, periodMonth: string, alreadyFiled: boolean, history: Gstr1History = {}) {
  const det = heads();  // 3.1(a)
  const zero = heads(); // 3.1(b)
  let nilExempt = 0;    // 3.1(c) txval
  let nonGst = 0;       // 3.1(e) txval
  const amendments: Gstr1AmendmentSum[] = [];
  const amendmentDiffs: Gstr1AmendmentDifference[] = [];
  // The documents and lines the amendments add and take off, for Table 3.2.
  const amendmentDocs: { j: Gj; sign: number }[] = [];

  const rcmFix = periodSortKey(periodMonth) >= RCM_RCHRG_FIX_FROM || !alreadyFiled;
  const folded = periodSortKey(periodMonth) >= AMENDMENT_FOLD_FROM || !alreadyFiled;
  const into: Pick31 = (r) => (r === '3.1(b)' ? zero : det);
  if (g) {
    addOutwardDocs(g, into, rcmFix);
    // Table 10: the Builder's re-rating states the difference itself and is
    // folded as it stands.
    list(g.b2csa).filter(isB2csaDifference).forEach((a) => b2csaLines(a).forEach((i) => addLine(det, i, 1, false)));
    if (folded) {
      // Each amendment adds its revised document or line and takes off what
      // was last reported for it, both sorted and signed like any other
      // document (position 12). Before, an amendment was left out of 3.1
      // altogether, so a month whose supply was an amendment showed nil.
      amendmentDifferences(g, history, restatedB2csa).forEach((d) => {
        const rev = { a: heads(), b: heads() };
        const earl = { a: heads(), b: heads() };
        addOutwardDocs(d.revised, (r) => (r === '3.1(b)' ? rev.b : rev.a), rcmFix);
        if (d.earlier) addOutwardDocs(d.earlier, (r) => (r === '3.1(b)' ? earl.b : earl.a), rcmFix);
        const sub = (x: Heads, y: Heads): Heads => ({
          txval: r2(x.txval - y.txval), iamt: r2(x.iamt - y.iamt), camt: r2(x.camt - y.camt), samt: r2(x.samt - y.samt), csamt: r2(x.csamt - y.csamt),
        });
        const diff = { a: sub(rev.a, earl.a), b: sub(rev.b, earl.b) };
        (Object.keys(det) as (keyof Heads)[]).forEach((h) => { det[h] += diff.a[h]; zero[h] += diff.b[h]; });
        amendmentDocs.push({ j: d.revised, sign: 1 });
        if (d.earlier) amendmentDocs.push({ j: d.earlier, sign: -1 });
        amendmentDiffs.push({ table: d.table, label: d.label, ref: d.ref, known: !!d.earlier, source: d.source, revised: rev, earlier: earl, diff });
      });
    } else {
      // A filed month before AMENDMENT_FOLD_FROM: amendments were flagged,
      // not folded, and stay so. Table 11(2) has its own flag in the caller.
      AMENDMENT_TABLES.forEach(({ table, label }) => {
        const s: Gstr1AmendmentSum = { table, label, docs: 0, a: heads(), b: heads() };
        const pick: Pick31 = (r) => (r === '3.1(b)' ? s.b : s.a);
        const rows = list(g[table]);
        if (table === 'b2ba') { addB2b(rows, pick, rcmFix); s.docs = rows.reduce((n, p) => n + list(p.inv).length, 0); }
        if (table === 'b2cla') { addB2cl(rows, pick); s.docs = rows.reduce((n, p) => n + list(p.inv).length, 0); }
        if (table === 'expa') { addExp(rows, pick); s.docs = rows.reduce((n, p) => n + list(p.inv).length, 0); }
        if (table === 'cdnra') { addCdnr(rows, pick, rcmFix); s.docs = rows.reduce((n, p) => n + list(p.nt).length, 0); }
        if (table === 'cdnura') { addCdnur(rows, pick, rcmFix); s.docs = rows.length; }
        if (table === 'b2csa') {
          const restated = rows.filter(restatedB2csa);
          restated.forEach((a) => b2csaLines(a).forEach((i) => addLine(s.a, i, 1, false)));
          s.docs = restated.length;
        }
        if (s.docs) amendments.push(s);
      });
    }
    // Nil / exempt / non-GST.
    list(g.nil?.inv).forEach((n) => { nilExempt += num(n.nil_amt) + num(n.expt_amt); nonGst += num(n.ngsup_amt); });
  }

  const roundObj = (o: Heads): Heads => { (Object.keys(o) as (keyof Heads)[]).forEach((k) => (o[k] = r2(o[k]))); return o; };
  amendments.forEach((s) => { roundObj(s.a); roundObj(s.b); });
  roundObj(det); roundObj(zero);
  return {
    det,
    // GSTN's osup_zero carries value, IGST and cess only: zero rated supplies
    // bear no CGST / SGST. zeroLocalTax is whatever a 3.1(b) document wrongly
    // carries as CGST / SGST, for the caller's flag.
    zero: { txval: zero.txval, iamt: zero.iamt, csamt: zero.csamt },
    zeroLocalTax: r2(zero.camt + zero.samt),
    nilExempt: r2(nilExempt),
    nonGst: r2(nonGst),
    folded,
    amendments,
    amendmentDiffs,
    amendmentDocs,
  };
}

/**
 * The total liability of a month's GSTR-1, as GSTR-3B takes it: Table 3.1(a)
 * plus 3.1(b), value and tax. Reverse charge supplies (4B) count at value only,
 * advances adjusted (11B) come off, and every amendment counts at its
 * difference from what was last reported (`history`, the client's other
 * GSTR-1s; position 12). buildGstr1Summary's "Total liability" is this figure,
 * so the summary and the 3B draft cannot differ.
 */
export function gstr1OutwardTotal(gstr1Raw: unknown, history: Gstr1History = {}): { value: number; igst: number; cgst: number; sgst: number; cess: number } {
  const g = gstr1Raw && typeof gstr1Raw === 'object' ? (gstr1Raw as Gj) : null;
  const out = computeOutward(g, '', false, history);
  return {
    value: r2(out.det.txval + out.zero.txval),
    igst: r2(out.det.iamt + out.zero.iamt),
    cgst: r2(out.det.camt),
    sgst: r2(out.det.samt),
    cess: r2(out.det.csamt + out.zero.csamt),
  };
}

/**
 * The amendment tables as a filed month before AMENDMENT_FOLD_FROM leaves
 * them: out of 3.1, each with what it restates (Table 11(2) aside).
 */
export function gstr1AmendmentsLeftOut(gstr1Raw: unknown): Gstr1AmendmentSum[] {
  const g = gstr1Raw && typeof gstr1Raw === 'object' ? (gstr1Raw as Gj) : null;
  return computeOutward(g, '', true).amendments;
}

/** Every amendment counted at its difference (position 12). */
export function gstr1AmendmentDifferences(gstr1Raw: unknown, history: Gstr1History = {}): Gstr1AmendmentDifference[] {
  const g = gstr1Raw && typeof gstr1Raw === 'object' ? (gstr1Raw as Gj) : null;
  return computeOutward(g, '', false, history).amendmentDiffs;
}

/**
 * Output tax of a month's GSTR-1: the tax of Table 3.1(a) and 3.1(b), which
 * GSTR-3B sets off against ITC or cash. 3.1(b) holds the IGST on exports and
 * SEZ supplies with payment. Cess is left out. Reverse charge and amendments
 * as in computeOutward. Shared by the GST receivable reco and the credit
 * closing report (computeGstr1OutputTax), so their "ITC utilised" is the
 * draft's own figure.
 */
export function gstr1OutputTax(gstr1Raw: unknown, periodMonth: string, alreadyFiled: boolean, history: Gstr1History = {}): TaxHead {
  const g = gstr1Raw && typeof gstr1Raw === 'object' ? (gstr1Raw as Gj) : null;
  const out = computeOutward(g, periodMonth, alreadyFiled, history);
  return round3({ igst: out.det.iamt + out.zero.iamt, cgst: out.det.camt, sgst: out.det.samt });
}

// ---- Table 3.2 inter-state supplies, by place of supply --------------------
// "Of the supplies shown in 3.1(a)": zero rated supplies never enter it.
//   Unregistered persons: B2CL, inter-state B2CS, cdnur notes of typ B2CL
//     (signed), and an inter-state Table 10 difference folded above.
//   UIN holders: b2b invoices to a UIN (GSTN's UIN format) at a place of
//     supply outside the supplier's state, and their cdnr notes (signed).
//   Composition dealers: GSTR-1 does not say who is one, so this stays
//     empty. The portal fills that row itself from GSTR-1 (TISHA 10/2025
//     filed comp_details it computed), so no flag is raised for it.
interface PosRow { pos: string; txval: number; iamt: number }
function computeInterSup(g: Gj | null, homeState: string, extra: { j: Gj; sign: number }[] = []) {
  const make = () => {
    const byPos: Record<string, { txval: number; iamt: number }> = {};
    const bump = (pos: unknown, d: Gj, sign = 1) => {
      const p = String(pos ?? '').trim();
      if (!p) return;
      byPos[p] = byPos[p] || { txval: 0, iamt: 0 };
      byPos[p].txval += sign * num(d.txval); byPos[p].iamt += sign * num(d.iamt);
    };
    const rows = (): PosRow[] => Object.entries(byPos)
      .map(([pos, v]) => ({ pos, txval: r2(v.txval), iamt: r2(v.iamt) }))
      .filter((r) => r.txval || r.iamt);
    return { bump, rows };
  };
  const unreg = make();
  const uin = make();
  let interB2b = 0;
  // Inter-state: a place of supply outside the supplier's state; with no
  // GSTIN to tell the state, IGST charged on the line.
  const inter = (pos: unknown, d: Gj) => (homeState ? !!String(pos ?? '').trim() && String(pos).trim() !== homeState : num(d.iamt) !== 0);
  // One GSTR-1 JSON's 3.2 rows, times m: the return itself, then each
  // amendment's revised documents (+1) and what they replace (-1).
  const collect = (j: Gj, m: number, countB2b: boolean) => {
    list(j.b2cl).forEach((s) => list(s.inv).forEach((inv) => list(inv.itms).forEach((i) => unreg.bump(s.pos, i.itm_det || {}, m))));
    list(j.b2cs).forEach((i) => { if (String(i.sply_ty || '').toUpperCase() === 'INTER') unreg.bump(i.pos, i, m); });
    list(j.cdnur).forEach((nt) => {
      if (cdnurRow(nt) !== '3.1(a)') return; // export notes are zero rated
      const sign = noteSign(nt, 'cdnur') * m;
      list(nt.itms).forEach((i) => unreg.bump(nt.pos, i.itm_det || {}, sign));
    });
    list(j.b2b).forEach((p) => list(p.inv).forEach((inv) => {
      if (b2bRow(inv) !== '3.1(a)') return; // SEZ: zero rated
      const lines = list(inv.itms).map((i) => i.itm_det || {});
      if (!lines.some((d) => inter(inv.pos, d))) return;
      if (isUin(p.ctin)) lines.forEach((d) => uin.bump(inv.pos, d, m));
      else if (countB2b && !isRcm(inv)) interB2b += 1;
    }));
    list(j.cdnr).forEach((p) => {
      if (!isUin(p.ctin)) return;
      list(p.nt).forEach((nt) => {
        if (b2bRow(nt) !== '3.1(a)') return;
        const sign = noteSign(nt, 'cdnr') * m;
        list(nt.itms).forEach((i) => { const d = i.itm_det || {}; if (inter(nt.pos, d)) uin.bump(nt.pos, d, sign); });
      });
    });
  };
  if (g) {
    collect(g, 1, true);
    list(g.b2csa).filter(isB2csaDifference).forEach((a) => {
      if (String(a.sply_ty || '').toUpperCase() === 'INTER') b2csaLines(a).forEach((i) => unreg.bump(a.pos, i));
    });
    extra.forEach((e) => collect(e.j, e.sign, false));
  }
  return { unreg: unreg.rows(), uin: uin.rows(), interB2b };
}

export function buildGstr3bJson(input: Gstr3bInput): Gstr3bResult {
  const flags: string[] = [];
  const g = input.gstr1Raw;
  const itc = input.itc;
  if (!g) flags.push('No GSTR-1 data — outward (Table 3.1 a/b/c/e, 3.2) is all zero.');
  if (!itc) flags.push('No ITC Summary — Table 4 (ITC) is all zero.');

  const out = computeOutward(g, input.periodMonth, input.alreadyFiled, input.gstr1History || {});

  // Table 11(2) advance amendments restate an earlier period and are never
  // auto-included in 3.1(a) (see computeOutward). Surface them loudly so the
  // differential is entered deliberately rather than forgotten — a silently
  // dropped amendment is exactly the failure mode this whole module exists to
  // stop. docs/ADVANCE_SETOFF_POSITIONS.md §7.2.
  const advanceAmendment = (rows: any[]) => {
    let value = 0;
    const periods = new Set<string>();
    (rows || []).forEach((r: any) => {
      const omon = String(r?.omon || '').trim();
      if (omon) periods.add(omon);
      const itms = Array.isArray(r?.itms) && r.itms.length ? r.itms : [r];
      itms.forEach((it: any) => { value += num(it?.ad_amt); });
    });
    return { value: r2(value), periods: Array.from(periods).sort() };
  };
  const ataTotal = advanceAmendment(g?.ata);
  const txpdaTotal = advanceAmendment(g?.txpda);
  if (!out.folded && (ataTotal.value || txpdaTotal.value)) {
    const parts: string[] = [];
    // "restated to", not "amended by": an amendment row carries the REVISED
    // figure for the earlier period, not a delta against it.
    if (ataTotal.value) parts.push(`11A restated to ₹${ataTotal.value.toFixed(2)}`);
    if (txpdaTotal.value) parts.push(`11B restated to ₹${txpdaTotal.value.toFixed(2)}`);
    const periods = Array.from(new Set([...ataTotal.periods, ...txpdaTotal.periods])).join(', ');
    flags.push(
      `GSTR-1 Table 11(2) advance amendment present (${parts.join('; ')}${periods ? `, restating ${periods}` : ''}) — ` +
      'NOT included in Table 3.1(a). An amendment states the revised figure for the earlier period, so the differential ' +
      "against that period's own 3B must be entered in GSTR-3B Adjustments (table 3.1(a), source 'Prior Period')."
    );
  }

  // The other amendment tables (9A, 9C, a restated Table 10) restate an
  // earlier document in full, so they are flagged the same way, never folded
  // (computeOutward). Each is shown against its own 3.1 row: SEZ and export
  // amendments against 3.1(b), the rest against 3.1(a).
  if (out.amendments.length) {
    const money = (n: number) => `₹${n.toFixed(2)}`;
    const part = (h: { txval: number; iamt: number; camt: number; samt: number; csamt: number }, row: string) =>
      `${row} value ${money(h.txval)}, tax ${money(r2(h.iamt + h.camt + h.samt + h.csamt))}`;
    const parts = out.amendments.map((s) => {
      const rows = [
        ...(s.a.txval || s.a.iamt || s.a.camt || s.a.samt || s.a.csamt ? [part(s.a, '3.1(a)')] : []),
        ...(s.b.txval || s.b.iamt || s.b.csamt ? [part(s.b, '3.1(b)')] : []),
      ];
      return `${s.label}: ${s.docs} document(s)${rows.length ? `, ${rows.join('; ')}` : ''}`;
    });
    flags.push(
      `GSTR-1 amendments present, NOT included in Table 3.1: ${parts.join('. ')}. ` +
      'An amendment states the revised document in full, so only its difference from the original belongs in this 3B. ' +
      "Enter that difference in GSTR-3B Adjustments (source 'Prior Period') against the row shown. " +
      'An amended B2C large or small supply that is inter-state also changes Table 3.2 on the portal.'
    );
  }
  if (out.amendmentDiffs.length) {
    const money = (n: number) => `₹${n.toFixed(2)}`;
    const tax = (h: Heads) => r2(h.iamt + h.camt + h.samt + h.csamt);
    const both = (x: { a: Heads; b: Heads }) => {
      const p: string[] = [];
      if (x.a.txval || tax(x.a)) p.push(`3.1(a) value ${money(x.a.txval)}, tax ${money(tax(x.a))}`);
      if (x.b.txval || tax(x.b)) p.push(`3.1(b) value ${money(x.b.txval)}, tax ${money(tax(x.b))}`);
      return p.length ? p.join(' and ') : 'nil';
    };
    const parts = out.amendmentDiffs.map((d) =>
      `${d.label}, ${d.ref}: revised ${both(d.revised)}; less ${d.known ? `${both(d.earlier)} last reported (${d.source})` : 'nil, as what was reported for it is not in the app'}; difference ${both(d.diff)}`);
    flags.push(
      `GSTR-1 amendments counted in Table 3.1 at their difference: ${parts.join('. ')}.` +
      (out.amendmentDiffs.some((d) => !d.known)
        ? ' Where the earlier report is not in the app it is taken as nil: if it did report a figure, pull or import that GSTR-1 so it is taken off.'
        : '')
    );
  }
  if (out.zeroLocalTax) {
    flags.push(
      `A zero rated document (export or SEZ) carries CGST / SGST of ₹${out.zeroLocalTax.toFixed(2)}. ` +
      'Table 3.1(b) takes IGST and cess only, so this tax is NOT in the draft. Check the invoice type in GSTR-1.'
    );
  }

  // Table 3.2, by place of supply (computeInterSup). The supplier's state is
  // the first two digits of its GSTIN.
  const homeState = /^\d{2}/.test(input.gstin || '') ? input.gstin.slice(0, 2) : '';
  const inter = computeInterSup(g, homeState, out.amendmentDocs);

  // ---- GSTR-3B Adjustments module — fold mapped rows into the relevant
  // Table 3.1 / Table 4 bucket before anything downstream (totalLiability,
  // itc_net, the indicative net payable) is computed, so the effect is
  // consistent everywhere rather than a bolt-on at the end.
  const adjustments = input.adjustments || [];
  const MAPPED_REFS = ['3.1(a)', '3.1(b)', '3.1(c)', '3.1(d)', '3.1(e)', '4A(5)', '4B(1)'];
  const sumAdj = (ref: string) => adjustments
    .filter((a) => a.tableRef === ref)
    .reduce((acc, a) => ({
      taxable: acc.taxable + (a.taxableValue || 0),
      igst: acc.igst + (a.igst || 0),
      cgst: acc.cgst + (a.cgst || 0),
      sgst: acc.sgst + (a.sgst || 0),
      cess: acc.cess + (a.cess || 0),
    }), { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
  const adjustmentsApplied = adjustments.filter((a) => MAPPED_REFS.includes(a.tableRef)).length;
  const adjustmentsUnmapped = adjustments.length - adjustmentsApplied;
  if (adjustmentsApplied > 0) {
    flags.push(`${adjustmentsApplied} manual adjustment(s) from the GSTR-3B Adjustments module are included in the totals below.`);
  }
  if (adjustmentsUnmapped > 0) {
    flags.push(`${adjustmentsUnmapped} adjustment(s) tagged "Other" are NOT included in any table below — review them in the GSTR-3B Adjustments module and fold them in manually.`);
  }

  const adj31a = sumAdj('3.1(a)');
  out.det.txval = r2(out.det.txval + adj31a.taxable);
  out.det.iamt = r2(out.det.iamt + adj31a.igst);
  out.det.camt = r2(out.det.camt + adj31a.cgst);
  out.det.samt = r2(out.det.samt + adj31a.sgst);
  out.det.csamt = r2(out.det.csamt + adj31a.cess);

  const adj31b = sumAdj('3.1(b)');
  out.zero.txval = r2(out.zero.txval + adj31b.taxable);
  out.zero.iamt = r2(out.zero.iamt + adj31b.igst);
  out.zero.csamt = r2(out.zero.csamt + adj31b.cess);

  out.nilExempt = r2(out.nilExempt + sumAdj('3.1(c)').taxable);
  out.nonGst = r2(out.nonGst + sumAdj('3.1(e)').taxable);

  const adj31d = sumAdj('3.1(d)');

  // ---- Table 4 (ITC) ----
  const A: ItcRow[] = itc?.section4A || [];
  const B: ItcRow[] = itc?.section4B || [];
  const D: ItcRow[] = itc?.section4D || [];

  const impg = row(A, '(1)');   // 4A(1) import of goods
  const imps = row(A, '(2)');   // 4A(2) import of services
  // 4A(3) RCM ITC — computed directly from the SAME live RCM totals used for
  // Table 3.1(d) below, not read from ITC Summary's stored section4A row(3).
  // That stored row is only refreshed when someone opens and re-saves the
  // ITC Summary page; if RCM data changes after that (a real case: a client
  // whose ITC Summary was saved before a new RCM entry — e.g. a different
  // rate/head — was added), the two tables silently drift apart. GSTR-3B
  // always pushes wrong figures for the drifted head until someone happens
  // to re-save ITC Summary. Deriving both from the same source makes that
  // drift structurally impossible instead of relying on a save workflow.
  // Manual 3.1(d) adjustments are output-liability-only (like every other
  // outward-table adjustment here) — they don't create matching 4A(3) ITC;
  // log a separate 4A(5) adjustment for that if it's actually eligible.
  const blocked = input.rcmItcBlocked;
  const isrc: ItcRow = {
    srNo: '(3)',
    igst: r2(input.rcm.igst - (blocked?.igst || 0)),
    cgst: r2(input.rcm.cgst - (blocked?.cgst || 0)),
    sgst: r2(input.rcm.sgst - (blocked?.sgst || 0)),
  };
  const isd = row(A, '(4)');    // 4A(4) ISD
  // 4A(5) "all other ITC" = 5.1 + 5.2 − 5.3 + 5.4 + 5.5, plus any manual
  // 4A(5) adjustment.
  const adj4A5 = sumAdj('4A(5)');
  const oth4aRaw = round3(add3(
    row(A, '5.1'), row(A, '5.2'), sub3({ igst: 0, cgst: 0, sgst: 0 }, row(A, '5.3')), row(A, '5.4'), row(A, '5.5'),
    { igst: adj4A5.igst, cgst: adj4A5.cgst, sgst: adj4A5.sgst },
  ));
  // 4A(5) is never negative on the portal. When supplier credit notes (row
  // 5.3, filled from 2B for a Strict client, or a booked credit note reduced
  // through a negative row 5.2 head) or a negative amendment difference take
  // a head below zero, that head is 0 in 4A(5) and the excess
  // is reversed in 4B(2), as the portal's own auto-fill does. Net ITC (4C) is
  // the same either way. A No-ITC builder reverses all of 4A in 4B(1) and has
  // nothing to reduce, so its excess is dropped.
  const excess4A5 = {
    igst: Math.max(0, -oth4aRaw.igst), cgst: Math.max(0, -oth4aRaw.cgst), sgst: Math.max(0, -oth4aRaw.sgst),
  };
  const oth4a = round3(add3(oth4aRaw, excess4A5));
  const itcAvail = round3(add3(impg, imps, isrc, isd, oth4a));

  // Table 4(B) — Partial-ITC builder clients (docs/BUILDER_GST_POSITIONS.md
  // §7) reverse ITC by carpet-area apportionment, computed by the SAME
  // shared function ITC Summary itself uses (builderPartialItc.ts), not the
  // plain default-template row lookup below. That default lookup matches
  // sub-rows by literal srNo '(i)'/'(ii)'/'(iii)', but the Partial-ITC row
  // template leaves those sub-rows' srNo empty (matched by particular text
  // instead) — reading it with the default lookup silently computed 4(B)(2)
  // as 0 for every such client, understating the reversal and overstating
  // 4C Net ITC.
  // No-ITC clients don't run computePartialItcSplit either, but for a
  // different reason than "plain lookup": per firm decision (2026-08-19),
  // 4(B)(1) is locked to mirror the WHOLE of itcAvail below, unconditionally
  // — not derived from 2B reconciliation's eligible/reversal classification
  // at all (see the isNoITC branch further down). "Allowing" vs
  // "disallowing" per 2B reconciliation only means something for a client
  // who can claim SOME credit; it never applies to a No-ITC builder, so this
  // doesn't read row(B, ...) or run the apportionment split against their
  // saved data — the same way #71 found reading a 7-row template as if it
  // were the 5-row one silently zeroed 4(B)(2) instead.
  const isNoITC = input.builderItcType === 'NO_ITC';
  const isPartialITC = input.builderItcType === 'PARTIAL_ITC';
  if (excess4A5.igst || excess4A5.cgst || excess4A5.sgst) {
    const heads = [['IGST', excess4A5.igst], ['CGST', excess4A5.cgst], ['SGST', excess4A5.sgst]]
      .filter(([, v]) => v).map(([h, v]) => `${h} ${Number(v).toFixed(2)}`).join(', ');
    flags.push(isNoITC
      ? `4A(5) All other ITC came out negative (${heads}): set to 0; a No-ITC client reverses all of 4A, so nothing moves to 4B(2).`
      : `4A(5) All other ITC came out negative (${heads}), mostly supplier credit notes (row 5.3, or a negative row 5.2): set to 0 and the excess added to 4B(2) Others.`);
  }
  const commercialArea = input.commercialArea || 0;
  const residentialArea = input.residentialArea || 0;
  // Keep Total 4A consistent with `itcAvail` above (which uses the live
  // `isrc` for row (3) and folds in the manual 4A(5) adjustment) so the
  // apportionment ratio isn't applied against a stale base.
  const adjustedA = A.map((r) => {
    if (r.srNo === '(3)') return { ...r, igst: isrc.igst, cgst: isrc.cgst, sgst: isrc.sgst };
    if (r.srNo === '5.1' && (adj4A5.igst || adj4A5.cgst || adj4A5.sgst))
      return { ...r, igst: r.igst + adj4A5.igst, cgst: r.cgst + adj4A5.cgst, sgst: r.sgst + adj4A5.sgst };
    return r;
  });
  const partialSplit = isPartialITC
    ? computePartialItcSplit({ section4A: adjustedA, section4B: B.map((r) => ({ ...r, particular: r.particular || '' })), commercialArea, residentialArea, exclusiveItc: input.rcmItcExclusive })
    : null;
  if (isPartialITC && !partialSplit) {
    flags.push('Partial-ITC client but no carpet area set on the client record — Table 4(B) fell back to the default (non-apportioned) formula; set commercial/residential area to get the correct reversal.');
  }

  const adj4B1 = sumAdj('4B(1)');
  // Partial-ITC builder clients: 4B(1) is the carpet-area Rule 42/43
  // reversal and 4B(2) is the 2B-reco / 180-day reversal (Others), both
  // computed by computePartialItcSplit in builderPartialItc.ts. No-ITC
  // clients skip both the split AND the plain lookup — (1) is forced to
  // equal itcAvail exactly, guaranteeing Net ITC (4C) is 0 by construction.
  // Non-builder clients fall through to the plain row lookup.
  const revRulRaw = isNoITC
    ? round3(itcAvail) // 4B(1) — locked to the whole of 4A, no exceptions
    : partialSplit
    ? round3(add3(partialSplit.row1Reclassified, { igst: adj4B1.igst, cgst: adj4B1.cgst, sgst: adj4B1.sgst })) // 4B(1) rule 38/42/43 & 17(5)
    : round3(add3(row(B, '(1)'), { igst: adj4B1.igst, cgst: adj4B1.cgst, sgst: adj4B1.sgst })); // 4B(1) rule 38/42/43 & 17(5)
  const revOthRaw = isNoITC
    ? { igst: 0, cgst: 0, sgst: 0 } // 4B(2) others — always 0 for a No-ITC builder
    : partialSplit
    ? round3(add3(partialSplit.row2Reclassified, excess4A5)) // 4B(2) others: 2B-reco / 180-day reversal, plus a negative 4A(5)'s excess
    : round3(add3(row(B, '(i)'), row(B, '(ii)'), row(B, '(iii)'), excess4A5)); // 4B(2) others, plus a negative 4A(5)'s excess
  // A Partial-ITC builder's carpet-area split runs on Total 4A before 4A(5)
  // is clipped, so credit notes that take a head of Total 4A below zero give
  // a negative 4B(1), which the portal refuses. That head is 0 in 4B(1) and
  // its negative part comes off 4B(2) Others (which holds the clipped
  // excess), so net ITC (4C) is unchanged.
  // Only a head whose 4A(5) was clipped, and never more than 4B(2) holds: a
  // negative 4B(1) from typed adjustments in an ordinary month stays as it
  // was (the draft check flags it for staff to correct).
  const clipNeg = (h: 'igst' | 'cgst' | 'sgst') =>
    excess4A5[h] > 0 ? Math.max(Math.min(0, revRulRaw[h]), -Math.max(0, revOthRaw[h])) : 0;
  const negRul = partialSplit && !isNoITC
    ? { igst: clipNeg('igst'), cgst: clipNeg('cgst'), sgst: clipNeg('sgst') }
    : { igst: 0, cgst: 0, sgst: 0 };
  const revRul = round3(sub3(revRulRaw, negRul));
  const revOth = round3(add3(revOthRaw, negRul));
  if (negRul.igst || negRul.cgst || negRul.sgst) {
    const heads = [['IGST', negRul.igst], ['CGST', negRul.cgst], ['SGST', negRul.sgst]]
      .filter(([, v]) => v).map(([h, v]) => `${h} ${Number(v).toFixed(2)}`).join(', ');
    flags.push(`4B(1) Rule 42/43 reversal came out negative (${heads}), since credit notes took Total 4A below zero: set to 0 and taken off 4B(2) Others (net ITC unchanged).`);
  }

  // 4D(1) ITC reclaimed which was reversed under 4B(2) in an earlier period:
  // 1.1 + 1.2 (src/lib/itc4D.ts), never row (1) as a summary saved it.
  const rclmd1 = reclaimed4D1(D);
  const inelgOth = row(D, '(2)');                     // 4D(2) 16(4) & PoS
  // Full 4(D) Other Details, as shown in ITC Summary and the portal GSTR-3B.
  const itcOtherDetails = [
    { srNo: '(1)', label: 'ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period', ...round3(rclmd1) },
    { srNo: '(1.1)', label: 'Reclaim of ITC Reversed for Previous months', ...round3(row(D, '1.1')) },
    { srNo: '(1.2)', label: 'Reclaim of ITC Reversed due to 180 days rule/Others', ...round3(row(D, '1.2')) },
    { srNo: '(2)', label: 'Ineligible ITC under section 16(4) & ITC restricted due to PoS rules', ...round3(inelgOth) },
  ];
  // REVIEW: GSTN itc_inelg has ty RUL + OTH; the app has no distinct 4D "RUL" input → 0.
  flags.push('4D itc_inelg: mapped 4D(2) → OTH; RUL defaulted to 0 (confirm with the CA).');
  flags.push('Table 5 (exempt / nil / non-GST INWARD supplies) is not computed by the app → left 0 (fill manually if applicable).');

  // 4(A) ITC Available bifurcation, as shown in ITC Summary and the portal.
  const itcAvailableRows = [
    { srNo: '(1)', label: 'Import of goods', ...round3(impg) },
    { srNo: '(2)', label: 'Import of services', ...round3(imps) },
    { srNo: '(3)', label: 'Inward supplies liable to reverse charge (other than 1 & 2 above)', ...round3(isrc) },
    { srNo: '(4)', label: 'Inward supplies from ISD', ...round3(isd) },
    { srNo: '(5)', label: 'All other ITC', ...round3(oth4a) },
  ];
  const itcRev = round3(add3(revRul, revOth));
  // 4(B) ITC Reversed bifurcation, as shown on the portal.
  const itcReversedRows = [
    { srNo: '(1)', label: 'As per rules 38,42 & 43 of CGST Rules and section 17(5)', ...round3(revRul) },
    { srNo: '(2)', label: 'Others', ...round3(revOth) },
  ];
  const itcNet = round3(sub3(itcAvail, itcRev));

  const rcm = {
    txval: r2(input.rcm.taxable + adj31d.taxable),
    iamt: r2(input.rcm.igst + adj31d.igst),
    camt: r2(input.rcm.cgst + adj31d.cgst),
    samt: r2(input.rcm.sgst + adj31d.sgst),
    csamt: r2(adj31d.cess),
  };

  const json = {
    gstin: input.gstin,
    ret_period: retPeriod(input.periodMonth),
    sup_details: {
      osup_det: out.det,                                   // 3.1(a)
      osup_zero: out.zero,                                 // 3.1(b)
      osup_nil_exmp: { txval: out.nilExempt },             // 3.1(c)
      isup_rev: rcm,                                       // 3.1(d) inward RCM
      osup_nongst: { txval: out.nonGst },                  // 3.1(e)
    },
    inter_sup: {                                           // 3.2, of the supplies in 3.1(a)
      unreg_details: inter.unreg,
      comp_details: [],                                    // not known from GSTR-1 (flagged)
      uin_details: inter.uin,
    },
    itc_elg: {
      itc_avl: [
        { ty: 'IMPG', ...impg },
        { ty: 'IMPS', ...imps },
        { ty: 'ISRC', ...isrc },
        { ty: 'ISD', ...isd },
        { ty: 'OTH', ...oth4a },
      ].map(stripSr),
      itc_rev: [
        { ty: 'RUL', ...revRul },
        { ty: 'OTH', ...revOth },
      ].map(stripSr),
      itc_net: itcNet,
      // 4(D)(1) — reclaim of ITC previously reversed under 4(B)(2). Computed
      // by ITC Summary (auto-linked from the current period's reclaim bills)
      // same as 4(B)(2)(i)/row 5.4 — not "always 0", despite what the push
      // extension used to assume when this field didn't exist here yet.
      itc_rclmd: [
        { ty: 'OTH', ...rclmd1 },
      ].map(stripSr),
      itc_inelg: [
        { ty: 'RUL', igst: 0, cgst: 0, sgst: 0 },
        { ty: 'OTH', ...inelgOth },
      ].map(stripSr),
    },
    // Table 5 — not computed; provided as a zeroed placeholder for the CA to fill.
    inward_sup: {
      isup_details: [
        { ty: 'GST', inter: 0, intra: 0 },
        { ty: 'NONGST', inter: 0, intra: 0 },
      ],
    },
  };

  // Total tax liability = 3.1(a) + 3.1(b) + 3.1(d). 3.1(b) holds the IGST on
  // exports and SEZ supplies with payment, which is payable like any other.
  const totalLiability = round3(add3(
    { igst: out.det.iamt, cgst: out.det.camt, sgst: out.det.samt },
    { igst: out.zero.iamt, cgst: 0, sgst: 0 },
    { igst: rcm.iamt, cgst: rcm.camt, sgst: rcm.samt },
  ));
  const summary: Gstr3bSummary = {
    outward: { txval: out.det.txval, igst: out.det.iamt, cgst: out.det.camt, sgst: out.det.samt },
    zeroRated: { txval: out.zero.txval, igst: out.zero.iamt, cess: out.zero.csamt },
    nilExempt: out.nilExempt,
    rcmLiability: { txval: rcm.txval, igst: rcm.iamt, cgst: rcm.camt, sgst: rcm.samt },
    nonGst: out.nonGst,
    itcAvailable: itcAvail,
    itcAvailableRows,
    itcReversed: itcRev,
    itcReversedRows,
    itcNet,
    itcIneligible: round3(inelgOth),
    itcOtherDetails,
    totalLiability,
    indicativeNetPayable: round3(sub3(totalLiability, itcNet)),
  };

  return { json, summary, flags, adjustmentsApplied, adjustmentsUnmapped };
}

function stripSr(o: any) { const { srNo, ...rest } = o; return rest; }
