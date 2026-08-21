// The 7 GSTR-3B family reports on the Reports Hub. Previously these read
// this app's own DRAFT GSTR-3B (buildGstr3bJson.ts, via fetchGstr3b) and the
// Excel-imported GSTR-1/2A/2B data — re-derived here to read gst_filed_returns
// instead: the portal's own as-filed JSON, pulled directly by content.js's
// handleGstr3bPull/handleGstr1Pull/handleGstr2aPull/handleGstr2bPull. Where
// the portal's summary API genuinely doesn't split a figure the same way the
// old computed report did (e.g. Rule 88A's per-head cash/ITC allocation),
// that's said outright in the subtitle rather than silently kept from the
// old, non-portal computation.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { formatMonthLabel, fyMonthsForKey } from './allClientsReports';
import {
  fetchFiledReturn, notPulledMsg,
  type Gstr3bSummary, type Gstr1Summary, type Gstr1Section, type HeadAmt, type TypedAmt,
  type Gstr2bSummary, type Gstr2aSummary,
} from './filedReturnReports';

interface ClientLite { id: string; name: string; gstin: string; }

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const fileSafe = (s: string) => s.replace(/\s+/g, '_');

const fetchClient = async (clientId: string): Promise<ClientLite> => {
  const { data } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  return (data || { id: clientId, name: 'Unknown', gstin: '' }) as ClientLite;
};

const fetchFiledGstr3b = async (clientId: string, client: ClientLite, month: string) => {
  const row = await fetchFiledReturn(clientId, month, 'GSTR3B');
  if (!row || !row.summary || Object.keys(row.summary).length === 0) throw new Error(notPulledMsg(client, month, 'GSTR-3B'));
  return { row, s: row.summary as Gstr3bSummary };
};
const fetchFiledGstr1 = async (clientId: string, client: ClientLite, month: string) => {
  const row = await fetchFiledReturn(clientId, month, 'GSTR1');
  if (!row || !row.summary || Object.keys(row.summary).length === 0) throw new Error(notPulledMsg(client, month, 'GSTR-1'));
  return { row, s: row.summary as Gstr1Summary };
};

const findItc = (arr: TypedAmt[] | undefined, ty: string): HeadAmt =>
  (Array.isArray(arr) ? arr.find((x) => x.ty === ty) : undefined) || {};
const headSum = (...heads: (HeadAmt | undefined)[]) => ({
  txval: heads.reduce((a, h) => a + num(h?.txval), 0),
  igst: heads.reduce((a, h) => a + num(h?.iamt), 0),
  cgst: heads.reduce((a, h) => a + num(h?.camt), 0),
  sgst: heads.reduce((a, h) => a + num(h?.samt), 0),
});
const ITC_AVL_TYPES = ['IMPG', 'IMPS', 'ISRC', 'ISD', 'OTH'];

// ─────────────────── REPORT 1: Liability Report ───────────────────────────

export const buildGstr3bLiabilityReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { row, s } = await fetchFiledGstr3b(clientId, client, month);
  const sup = s.sup_details || {};
  const outward = headSum(sup.osup_det);
  const zeroRated = headSum(sup.osup_zero);
  const nilExempt = headSum(sup.osup_nil_exmp);
  const rcm = headSum(sup.isup_rev);
  const nonGst = headSum(sup.osup_nongst);
  const total = headSum(sup.osup_det, sup.isup_rev);
  const itcAvail = headSum(...ITC_AVL_TYPES.map((ty) => findItc(s.itc_elg?.itc_avl, ty)));
  const itcRev = headSum(...(s.itc_elg?.itc_rev || []));
  const itcInelg = headSum(...(s.itc_elg?.itc_inelg || []));
  const itcNet = { igst: num(s.itc_elg?.itc_net?.iamt), cgst: num(s.itc_elg?.itc_net?.camt), sgst: num(s.itc_elg?.itc_net?.samt) };
  const tt = s.tt_val || {};

  const rows: (string | number)[][] = [
    ['3.1(a)', 'Outward taxable supplies (other than zero rated, nil rated and exempted)', outward.txval, outward.igst, outward.cgst, outward.sgst],
    ['3.1(b)', 'Outward taxable supplies — zero rated (exports)', zeroRated.txval, zeroRated.igst, zeroRated.cgst, zeroRated.sgst],
    ['3.1(c)', 'Other outward supplies (Nil rated, exempted)', nilExempt.txval, 0, 0, 0],
    ['3.1(d)', 'Inward supplies liable to reverse charge', rcm.txval, rcm.igst, rcm.cgst, rcm.sgst],
    ['3.1(e)', 'Non-GST outward supplies', nonGst.txval, 0, 0, 0],
    ['', 'Total Output Tax Liability (3.1(a) + 3.1(d))', '', total.igst, total.cgst, total.sgst],
    ['', '', '', '', '', ''],
    ['4(A)', 'ITC Available (gross)', '', itcAvail.igst, itcAvail.cgst, itcAvail.sgst],
    ['4(B)', 'ITC Reversed', '', itcRev.igst, itcRev.cgst, itcRev.sgst],
    ['4(C)', 'Net ITC Available (4A − 4B)', '', itcNet.igst, itcNet.cgst, itcNet.sgst],
    ['4(D)', 'Ineligible ITC', '', itcInelg.igst, itcInelg.cgst, itcInelg.sgst],
    ['', '', '', '', '', ''],
    ['', 'As-filed cash paid (aggregate — portal doesn\'t split by head)', num(tt.tt_csh_pd), '', '', ''],
    ['', 'As-filed total payable (aggregate)', num(tt.tt_pay), '', '', ''],
  ];

  return {
    title: 'GSTR-3B Liability Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ARN: ${row.arn || '—'}   |   As filed on the portal — not a computed draft.`,
    headers: ['Table', 'Description', 'Taxable Value', 'IGST', 'CGST', 'SGST'],
    rows,
    fileNameBase: `GSTR3B_Liability_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [10, 55, 16, 14, 14, 14],
  };
};

// ────────────── REPORT 2: GSTR-3B vs GSTR-1 Tax Report ───────────────────

export const buildGstr3bVsGstr1TaxReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const [{ row: g1row, s: g1 }, { row: g3row, s: g3 }] = await Promise.all([
    fetchFiledGstr1(clientId, client, month),
    fetchFiledGstr3b(clientId, client, month),
  ]);
  const ttlLiab = (g1.sec_sum || []).find((sec) => sec.sec_nm === 'TTL_LIAB');
  const g1Value = num(ttlLiab?.ttl_val), g1Igst = num(ttlLiab?.ttl_igst), g1Cgst = num(ttlLiab?.ttl_cgst), g1Sgst = num(ttlLiab?.ttl_sgst);
  const g1TotalTax = g1Igst + g1Cgst + g1Sgst;

  const outward = headSum(g3.sup_details?.osup_det, g3.sup_details?.osup_zero);
  const g3bTotalTax = outward.igst + outward.cgst + outward.sgst;

  const rows: (string | number)[][] = [
    ['Taxable Value', g1Value, outward.txval, outward.txval - g1Value],
    ['IGST', g1Igst, outward.igst, outward.igst - g1Igst],
    ['CGST', g1Cgst, outward.cgst, outward.cgst - g1Cgst],
    ['SGST', g1Sgst, outward.sgst, outward.sgst - g1Sgst],
    ['Total Tax', g1TotalTax, g3bTotalTax, g3bTotalTax - g1TotalTax],
  ];

  return {
    title: 'GSTR 3B vs GSTR 1 Tax Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   GSTR-1 ARN: ${g1row.arn || '—'}   |   GSTR-3B ARN: ${g3row.arn || '—'}   |   Both sides as filed on the portal — GSTR-1's own Total Liability (TTL_LIAB) section vs GSTR-3B's Table 3.1(a)+3.1(b). A genuine variance here is worth investigating; it isn't an artifact of this app's own computation.`,
    headers: ['Component', 'As per GSTR-1 (Total Liability, as filed)', 'As per GSTR-3B (Table 3.1, as filed)', 'Variance'],
    rows,
    fileNameBase: `GSTR3B_vs_GSTR1_Tax_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [16, 26, 30, 16],
  };
};

// ────────────── REPORT 3: GSTR-3B vs GSTR-1 Comparison Report ────────────

const GSTR1_SECTION_LABELS: [string, string, string][] = [
  ['B2B', 'B2B Invoices', '3.1(a)'],
  ['B2CL', 'B2C (Large)', '3.1(a)'],
  ['B2CS', 'B2C (Small)', '3.1(a)'],
  ['CDNR', 'Credit/Debit Notes (Registered)', '3.1(a) (net)'],
  ['CDNUR', 'Credit/Debit Notes (Unregistered)', '3.1(a) (net)'],
  ['EXP', 'Exports', '3.1(b)'],
  ['NIL', 'Nil Rated / Exempt / Non-GST', '3.1(c)'],
  ['AT', 'Advances Received', '3.1(a)'],
  ['TXPD', 'Advances Adjusted', '3.1(a) (reduces)'],
];

export const buildGstr3bVsGstr1ComparisonReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const [{ row: g1row, s: g1 }, { s: g3 }] = await Promise.all([
    fetchFiledGstr1(clientId, client, month),
    fetchFiledGstr3b(clientId, client, month),
  ]);
  const byName = new Map((g1.sec_sum || []).map((sec) => [sec.sec_nm, sec] as [string, Gstr1Section]));

  const rows: (string | number)[][] = GSTR1_SECTION_LABELS
    .map(([code, label, mapsTo]) => {
      const sec = byName.get(code);
      if (!sec) return null;
      return [code, label, mapsTo, num(sec.ttl_val), num(sec.ttl_igst), num(sec.ttl_cgst), num(sec.ttl_sgst), num(sec.ttl_cess)];
    })
    .filter((r): r is (string | number)[] => r !== null);

  const outward = headSum(g3.sup_details?.osup_det);
  const zeroRated = headSum(g3.sup_details?.osup_zero);
  const nilExempt = headSum(g3.sup_details?.osup_nil_exmp);
  rows.push(['', '', '', '', '', '', '', '']);
  rows.push(['', 'GSTR-3B Table 3.1(a) — Outward taxable supplies, as filed', '', outward.txval, outward.igst, outward.cgst, outward.sgst, '']);
  rows.push(['', 'GSTR-3B Table 3.1(b) — Zero rated supplies, as filed', '', zeroRated.txval, zeroRated.igst, zeroRated.cgst, zeroRated.sgst, '']);
  rows.push(['', 'GSTR-3B Table 3.1(c) — Nil rated / exempted, as filed', '', nilExempt.txval, 0, 0, 0, '']);

  return {
    title: 'GSTR 3B vs GSTR 1 Comparison Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   GSTR-1 ARN: ${g1row.arn || '—'}   |   Every GSTR-1 section and which GSTR-3B Table 3.1 row it feeds, both as filed on the portal.`,
    headers: ['GSTR-1 Section', 'Description', 'Maps to GSTR-3B Table', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess'],
    rows,
    fileNameBase: `GSTR3B_vs_GSTR1_Comparison_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [10, 34, 20, 16, 14, 14, 14, 12],
  };
};

// ────────────── REPORT 4: GSTR-3B vs GSTR-2B ITC Report ──────────────────

export const buildGstr3bVsGstr2bItcReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const [{ s: g3 }, g2bRow] = await Promise.all([
    fetchFiledGstr3b(clientId, client, month),
    fetchFiledReturn(clientId, month, 'GSTR2B'),
  ]);
  if (!g2bRow || !g2bRow.summary || Object.keys(g2bRow.summary).length === 0) throw new Error(notPulledMsg(client, month, 'GSTR-2B'));
  const g2b = g2bRow.summary as Gstr2bSummary;
  const b2b = g2b.docdata?.b2b || [];

  let eIgst = 0, eCgst = 0, eSgst = 0;
  for (const supplier of b2b) {
    for (const inv of supplier.inv || []) {
      if (inv.itcavl !== 'Y') continue;
      eIgst += num(inv.iamt); eCgst += num(inv.camt); eSgst += num(inv.sgst ?? inv.samt);
    }
  }
  const g2bTotal = eIgst + eCgst + eSgst;
  const itcAvail = headSum(...ITC_AVL_TYPES.map((ty) => findItc(g3.itc_elg?.itc_avl, ty)));
  const g3bTotal = itcAvail.igst + itcAvail.cgst + itcAvail.sgst;

  const rows: (string | number)[][] = [
    ['IGST', eIgst, itcAvail.igst, itcAvail.igst - eIgst],
    ['CGST', eCgst, itcAvail.cgst, itcAvail.cgst - eCgst],
    ['SGST', eSgst, itcAvail.sgst, itcAvail.sgst - eSgst],
    ['Total', g2bTotal, g3bTotal, g3bTotal - g2bTotal],
  ];

  return {
    title: 'GSTR 3B vs GSTR 2B ITC Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Both sides pulled directly from the portal — not the Excel-imported 2B used by 2B Reconciliation. "As per GSTR-2B" sums B2B documents flagged ITC-eligible (itcavl='Y') in the as-filed 2B; "As per GSTR-3B" is Table 4(A) ITC Available (gross), which also includes import of goods/services, RCM ITC and ISD, so it will legitimately run higher whenever those rows are non-zero. B2B only — CDNR/ISD/IMPG sections of 2B aren't in this comparison yet.`,
    headers: ['Tax Head', 'As per GSTR-2B (B2B, ITC-eligible)', 'As per GSTR-3B (Table 4A, gross ITC available)', 'Variance'],
    rows,
    fileNameBase: `GSTR3B_vs_GSTR2B_ITC_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [12, 26, 32, 14],
  };
};

// ────────────── REPORT 5: GSTR-3B vs GSTR-2A ITC Report ──────────────────

export const buildGstr3bVsGstr2aItcReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const [{ s: g3 }, g2aRow] = await Promise.all([
    fetchFiledGstr3b(clientId, client, month),
    fetchFiledReturn(clientId, month, 'GSTR2A'),
  ]);
  if (!g2aRow || !g2aRow.summary || Object.keys(g2aRow.summary).length === 0) throw new Error(notPulledMsg(client, month, 'GSTR-2A'));
  const g2a = g2aRow.summary as Gstr2aSummary;
  const b2b = g2a.b2b || [];

  let aIgst = 0, aCgst = 0, aSgst = 0;
  for (const supplier of b2b) {
    for (const inv of supplier.inv || []) {
      if (inv.rchrg === 'Y') continue; // RCM invoices excluded — non-RCM universe, matching the old report's scope
      aIgst += num(inv.iamt); aCgst += num(inv.camt); aSgst += num(inv.samt);
    }
  }
  const g2aTotal = aIgst + aCgst + aSgst;
  const itcAvail = headSum(...ITC_AVL_TYPES.map((ty) => findItc(g3.itc_elg?.itc_avl, ty)));
  const g3bTotal = itcAvail.igst + itcAvail.cgst + itcAvail.sgst;

  const rows: (string | number)[][] = [
    ['IGST', aIgst, itcAvail.igst, itcAvail.igst - aIgst],
    ['CGST', aCgst, itcAvail.cgst, itcAvail.cgst - aCgst],
    ['SGST', aSgst, itcAvail.sgst, itcAvail.sgst - aSgst],
    ['Total', g2aTotal, g3bTotal, g3bTotal - g2aTotal],
  ];

  return {
    title: 'GSTR 3B vs GSTR 2A ITC Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Both sides pulled directly from the portal — not the Excel-imported 2A used elsewhere. "As per GSTR-2A" sums every non-RCM B2B document in the as-filed 2A (2A has no eligibility classification, unlike 2B, so this is a broader, rougher universe than the vs-GSTR-2B report). "As per GSTR-3B" is Table 4(A) ITC Available (gross). B2B only.`,
    headers: ['Tax Head', 'As per GSTR-2A (B2B, non-RCM)', 'As per GSTR-3B (Table 4A, gross ITC available)', 'Variance'],
    rows,
    fileNameBase: `GSTR3B_vs_GSTR2A_ITC_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [12, 28, 32, 14],
  };
};

// ────────────── REPORT 6: GSTR-3B Annual Summary Report ──────────────────

export const buildGstr3bAnnualSummaryReport = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  const { data: filedRows } = await supabase.from('gst_filed_returns').select('period_month, summary').eq('client_id', clientId).eq('return_type', 'GSTR3B').in('period_month', months);
  const byMonth = new Map((filedRows || []).map((r) => [r.period_month, r.summary as Gstr3bSummary]));

  let totOut = 0, totRcm = 0, totLiab = 0, totItcAvail = 0, totItcNet = 0, totPayable = 0, pulled = 0;
  const rows: (string | number)[][] = months.map((m) => {
    const s = byMonth.get(m);
    if (!s || Object.keys(s).length === 0) return [formatMonthLabel(m), 'NOT PULLED', '', '', '', '', ''];
    pulled++;
    const outward = headSum(s.sup_details?.osup_det);
    const rcm = headSum(s.sup_details?.isup_rev);
    const liab = outward.igst + outward.cgst + outward.sgst + rcm.igst + rcm.cgst + rcm.sgst;
    const itcAvail = headSum(...ITC_AVL_TYPES.map((ty) => findItc(s.itc_elg?.itc_avl, ty)));
    const itcNetVal = num(s.itc_elg?.itc_net?.iamt) + num(s.itc_elg?.itc_net?.camt) + num(s.itc_elg?.itc_net?.samt);
    const payable = num(s.tt_val?.tt_pay);
    const outwardTot = outward.igst + outward.cgst + outward.sgst, rcmTot = rcm.igst + rcm.cgst + rcm.sgst, itcAvailTot = itcAvail.igst + itcAvail.cgst + itcAvail.sgst;
    totOut += outwardTot; totRcm += rcmTot; totLiab += liab; totItcAvail += itcAvailTot; totItcNet += itcNetVal; totPayable += payable;
    return [formatMonthLabel(m), outwardTot, rcmTot, liab, itcAvailTot, itcNetVal, payable];
  });
  rows.push(['TOTAL — ' + fyLabel, totOut, totRcm, totLiab, totItcAvail, totItcNet, totPayable]);

  return {
    title: 'GSTR 3B Annual Summary Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   As filed on the portal for each month (${pulled}/${months.length} months pulled — the rest show NOT PULLED; use GSTR-3B (Filed on Portal)'s Pull button for each missing month).`,
    headers: ['Month', 'Outward Liability', 'RCM Liability', 'Total Liability', 'ITC Available', 'Net ITC', 'Total Payable (as filed)'],
    rows,
    fileNameBase: `GSTR3B_Annual_Summary_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [14, 18, 16, 16, 16, 14, 20],
  };
};

// ────────────── ITC cross-utilization (Rule 88A) ──────────────────────────
// Kept here (unused by this file's own reports now — see REPORT 7 below,
// which uses the portal's own as-filed aggregate instead of this estimate)
// because interestScrutinyReports.ts still uses it against the computed
// draft GSTR-3B for interest working — a genuine, separate need from this
// file's own "as filed" reports, out of scope for this pass.

export interface TaxHeadAmounts { igst: number; cgst: number; sgst: number }

// Standard IGST-first cross-utilization order under Rule 88A (inserted 2019):
// IGST ITC must be fully exhausted (against IGST, then CGST, then SGST
// liability) before CGST/SGST ITC can be used at all; CGST ITC then covers
// CGST liability first with any remainder going to IGST liability, and SGST
// ITC mirrors that for SGST — CGST ITC can never offset SGST liability or
// vice versa. This is the common practical ordering GST software uses within
// the law's permitted flexibility — the portal's actual filing-time
// allocation can differ if the filer chose a different order.
export function computeItcOffset(liability: TaxHeadAmounts, itcAvailable: TaxHeadAmounts) {
  let igstItc = itcAvailable.igst, cgstItc = itcAvailable.cgst, sgstItc = itcAvailable.sgst;
  let igstLiab = liability.igst, cgstLiab = liability.cgst, sgstLiab = liability.sgst;

  const igstFromIgst = Math.min(igstItc, igstLiab); igstItc -= igstFromIgst; igstLiab -= igstFromIgst;
  const cgstFromIgst = Math.min(igstItc, cgstLiab); igstItc -= cgstFromIgst; cgstLiab -= cgstFromIgst;
  const sgstFromIgst = Math.min(igstItc, sgstLiab); igstItc -= sgstFromIgst; sgstLiab -= sgstFromIgst;
  const cgstFromCgst = Math.min(cgstItc, cgstLiab); cgstItc -= cgstFromCgst; cgstLiab -= cgstFromCgst;
  const igstFromCgst = Math.min(cgstItc, igstLiab); cgstItc -= igstFromCgst; igstLiab -= igstFromCgst;
  const sgstFromSgst = Math.min(sgstItc, sgstLiab); sgstItc -= sgstFromSgst; sgstLiab -= sgstFromSgst;
  const igstFromSgst = Math.min(sgstItc, igstLiab); sgstItc -= igstFromSgst; igstLiab -= igstFromSgst;

  return {
    offset: { igstFromIgst, cgstFromIgst, sgstFromIgst, cgstFromCgst, igstFromCgst, sgstFromSgst, igstFromSgst },
    cashPayable: { igst: igstLiab, cgst: cgstLiab, sgst: sgstLiab },
    itcCarriedForward: { igst: igstItc, cgst: cgstItc, sgst: sgstItc },
  };
}

// ────────────── REPORT 7: GSTR-3B Offset Summary ──────────────────────────

export const buildGstr3bOffsetSummaryReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { row, s } = await fetchFiledGstr3b(clientId, client, month);
  const total = headSum(s.sup_details?.osup_det, s.sup_details?.isup_rev);
  const tt = s.tt_val || {};

  const rows: (string | number)[][] = [
    ['IGST Liability (as filed)', total.igst],
    ['CGST Liability (as filed)', total.cgst],
    ['SGST Liability (as filed)', total.sgst],
    ['Total Liability', total.igst + total.cgst + total.sgst],
    ['', ''],
    ['ITC Utilised (as filed, aggregate)', num(tt.tt_itc_pd)],
    ['Cash Paid (as filed, aggregate)', num(tt.tt_csh_pd)],
    ['Total Payable (as filed)', num(tt.tt_pay)],
  ];

  return {
    title: 'GSTR 3B Offset Summary',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ARN: ${row.arn || '—'}   |   As filed on the portal. The portal's own GSTR-3B summary API states total liability per head but ITC utilisation and cash paid only in aggregate — it doesn't expose which ITC head funded which liability head, so the earlier computed-draft version's per-head Rule 88A allocation (an assumption about cross-utilization order) has been dropped rather than guessed at.`,
    headers: ['Component', 'Amount'],
    rows,
    fileNameBase: `GSTR3B_Offset_Summary_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [40, 20],
  };
};
