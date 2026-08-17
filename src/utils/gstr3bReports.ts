// The 4 "ready now" GSTR-3B family reports on the Reports Hub. All of them
// read this app's own DRAFT GSTR-3B (buildGstr3bJson.ts, via fetchGstr3b) —
// not the as-filed portal return, which the app doesn't have access to yet
// (that needs the portal login extension, a later step). Three of the four
// are marked "ready (approx.)" for exactly that reason: they can only catch
// internal drift between this app's own computed tables, not drift from
// what was actually filed.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { mmYyyyToShort, formatMonthLabel, fyMonthsForKey } from './allClientsReports';
import { buildGstr1Summary } from './buildGstr1Summary';
import { fetchGstr3b } from './fetchGstr3b';
import { fetchImport2BEligibleTotal } from '@/lib/postImport2B';

interface ClientLite { id: string; name: string; gstin: string; }

const fileSafe = (s: string) => s.replace(/\s+/g, '_');

const fetchClient = async (clientId: string): Promise<ClientLite> => {
  const { data } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  return (data || { id: clientId, name: 'Unknown', gstin: '' }) as ClientLite;
};

const fetchGstr1RawJson = async (clientId: string, client: ClientLite, month: string): Promise<any> => {
  const shortMonth = mmYyyyToShort(month);
  const { data } = await supabase.from('gstr1_data').select('raw_json').eq('client_id', clientId).eq('period_month', shortMonth).maybeSingle();
  if (!data) throw new Error(`No GSTR-1 data imported for ${client.name} in ${formatMonthLabel(month)}. Import it first from GSTR-1 Data.`);
  return data.raw_json;
};

// ─────────────────── REPORT 1: Liability Report ───────────────────────────

export const buildGstr3bLiabilityReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const result = await fetchGstr3b(clientId, client.gstin || '', month);
  const s = result.summary;

  const rows: (string | number)[][] = [
    ['3.1(a)', 'Outward taxable supplies (other than zero rated, nil rated and exempted)', s.outward.txval, s.outward.igst, s.outward.cgst, s.outward.sgst],
    ['3.1(b)', 'Outward taxable supplies — zero rated (exports)', s.zeroRated.txval, s.zeroRated.igst, 0, 0],
    ['3.1(c)', 'Other outward supplies (Nil rated, exempted)', s.nilExempt, 0, 0, 0],
    ['3.1(d)', 'Inward supplies liable to reverse charge', s.rcmLiability.txval, s.rcmLiability.igst, s.rcmLiability.cgst, s.rcmLiability.sgst],
    ['3.1(e)', 'Non-GST outward supplies', s.nonGst, 0, 0, 0],
    ['', 'Total Output Tax Liability (3.1(a) + 3.1(d))', '', s.totalLiability.igst, s.totalLiability.cgst, s.totalLiability.sgst],
    ['', '', '', '', '', ''],
    ['4(A)', 'ITC Available', '', s.itcAvailable.igst, s.itcAvailable.cgst, s.itcAvailable.sgst],
    ['4(B)', 'ITC Reversed', '', s.itcReversed.igst, s.itcReversed.cgst, s.itcReversed.sgst],
    ['4(C)', 'Net ITC Available (4A − 4B)', '', s.itcNet.igst, s.itcNet.cgst, s.itcNet.sgst],
    ['4(D)(2)', 'Ineligible ITC (s.16(4) & Place of Supply)', '', s.itcIneligible.igst, s.itcIneligible.cgst, s.itcIneligible.sgst],
    ['', '', '', '', '', ''],
    ['', 'Indicative Net Payable (Total Liability − Net ITC)', '', s.indicativeNetPayable.igst, s.indicativeNetPayable.cgst, s.indicativeNetPayable.sgst],
  ];
  if (result.flags.length) {
    rows.push(['', '', '', '', '', '']);
    rows.push(['', 'DATA NOTES', '', '', '', '']);
    result.flags.forEach((f) => rows.push(['', f, '', '', '', '']));
  }

  return {
    title: 'GSTR-3B Liability Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   This app's computed DRAFT — verify before filing`,
    headers: ['Table', 'Description', 'Taxable Value', 'IGST', 'CGST', 'SGST'],
    rows,
    fileNameBase: `GSTR3B_Liability_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [10, 55, 16, 14, 14, 14],
  };
};

// ────────────── REPORT 2: GSTR-3B vs GSTR-1 Tax Report ───────────────────

export const buildGstr3bVsGstr1TaxReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const gstr1Raw = await fetchGstr1RawJson(clientId, client, month);
  const gstr1Total = buildGstr1Summary(gstr1Raw).totals;
  const result = await fetchGstr3b(clientId, client.gstin || '', month);
  const s = result.summary;

  const g3bValue = s.outward.txval + s.zeroRated.txval;
  const g3bIgst = s.outward.igst + s.zeroRated.igst;
  const g3bCgst = s.outward.cgst;
  const g3bSgst = s.outward.sgst;
  const g3bTotalTax = g3bIgst + g3bCgst + g3bSgst;
  const g1TotalTax = gstr1Total.igst + gstr1Total.cgst + gstr1Total.sgst;

  const rows: (string | number)[][] = [
    ['Taxable Value', gstr1Total.value, g3bValue, g3bValue - gstr1Total.value],
    ['IGST', gstr1Total.igst, g3bIgst, g3bIgst - gstr1Total.igst],
    ['CGST', gstr1Total.cgst, g3bCgst, g3bCgst - gstr1Total.cgst],
    ['SGST', gstr1Total.sgst, g3bSgst, g3bSgst - gstr1Total.sgst],
    ['Total Tax', g1TotalTax, g3bTotalTax, g3bTotalTax - g1TotalTax],
  ];

  return {
    title: 'GSTR 3B vs GSTR 1 Tax Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Approximate — both sides are computed by this app from the same GSTR-1 JSON, not the as-filed portal figures. A variance is expected whenever Table 4B (B2B reverse charge) has value: GSTR-3B correctly excludes the recipient's RCM liability from the supplier's own output tax, while the GSTR-1 table total does not net that out.`,
    headers: ['Component', 'As per GSTR-1 (table totals)', "As per GSTR-3B (Table 3.1, this app's draft)", 'Variance'],
    rows,
    fileNameBase: `GSTR3B_vs_GSTR1_Tax_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [16, 26, 30, 16],
  };
};

// ────────────── REPORT 3: GSTR-3B vs GSTR-1 Comparison Report ────────────

// Every GSTR-1 table folds into one of GSTR-3B's Table 3.1 rows — mostly
// 3.1(a), since computeOutward (buildGstr3bJson.ts) doesn't break B2B/B2CL/
// B2CS/CDNR/CDNUR/Table 10/Advances out by sub-type, only exports (6A) and
// nil/exempt (8) get their own 3.1(b)/3.1(c) row.
const GSTR1_TO_3B_MAP: Record<string, string> = {
  '4A': '3.1(a)',
  '4B': '3.1(a) — value only, RCM tax excluded',
  '5': '3.1(a)',
  '6A': '3.1(b)',
  '6B': '3.1(a)',
  '6C': '3.1(a)',
  '7': '3.1(a)',
  '8': '3.1(c)',
  '9B': '3.1(a)',
  '10': '3.1(a)',
  '11A': '3.1(a)',
  '11B': '3.1(a) (reduces)',
};

export const buildGstr3bVsGstr1ComparisonReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const gstr1Raw = await fetchGstr1RawJson(clientId, client, month);
  const gstr1Summary = buildGstr1Summary(gstr1Raw);
  const result = await fetchGstr3b(clientId, client.gstin || '', month);
  const s = result.summary;

  const rows: (string | number)[][] = gstr1Summary.sections
    .filter((sec) => sec.code !== '12' && sec.code !== '13') // HSN + Documents Issued are memo rows, no GSTR-3B mapping
    .map((sec) => [sec.code, sec.title, GSTR1_TO_3B_MAP[sec.code] || '—', sec.value, sec.igst, sec.cgst, sec.sgst, sec.cess]);

  rows.push(['', '', '', '', '', '', '', '']);
  rows.push(['', 'GSTR-3B Table 3.1(a) — Outward taxable supplies, as actually computed', '', s.outward.txval, s.outward.igst, s.outward.cgst, s.outward.sgst, '']);
  rows.push(['', 'GSTR-3B Table 3.1(b) — Zero rated supplies, as actually computed', '', s.zeroRated.txval, s.zeroRated.igst, 0, 0, '']);
  rows.push(['', 'GSTR-3B Table 3.1(c) — Nil rated / exempted, as actually computed', '', s.nilExempt, 0, 0, 0, '']);

  return {
    title: 'GSTR 3B vs GSTR 1 Comparison Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Approximate — shows every GSTR-1 table and which GSTR-3B Table 3.1 row it feeds, so a mismatch can be traced to its source section instead of only the net total.`,
    headers: ['GSTR-1 Table', 'Description', 'Maps to GSTR-3B Table', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess'],
    rows,
    fileNameBase: `GSTR3B_vs_GSTR1_Comparison_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [10, 46, 24, 16, 14, 14, 14, 12],
  };
};

// ────────────── REPORT 4: GSTR-3B vs GSTR-2B ITC Report ──────────────────

export const buildGstr3bVsGstr2bItcReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const result = await fetchGstr3b(clientId, client.gstin || '', month);
  const eligible2B = await fetchImport2BEligibleTotal(clientId, month);
  const s = result.summary;

  const g2bTotal = eligible2B.igst + eligible2B.cgst + eligible2B.sgst;
  const g3bTotal = s.itcAvailable.igst + s.itcAvailable.cgst + s.itcAvailable.sgst;

  const rows: (string | number)[][] = [
    ['IGST', eligible2B.igst, s.itcAvailable.igst, s.itcAvailable.igst - eligible2B.igst],
    ['CGST', eligible2B.cgst, s.itcAvailable.cgst, s.itcAvailable.cgst - eligible2B.cgst],
    ['SGST', eligible2B.sgst, s.itcAvailable.sgst, s.itcAvailable.sgst - eligible2B.sgst],
    ['Total', g2bTotal, g3bTotal, g3bTotal - g2bTotal],
  ];

  return {
    title: 'GSTR 3B vs GSTR 2B ITC Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Approximate — "As per GSTR-2B" is the MATCHED+MISMATCHED, non-RCM total from this period's Import 2B (the same live figure that feeds ITC Summary row 5.1). "As per GSTR-3B" is Table 4(A) ITC Available, which also includes import of goods/services, RCM ITC and ISD entered separately in ITC Summary, so it will legitimately run higher whenever those rows are non-zero. A variance concentrated in the 2B-sourced portion usually means ITC Summary needs to be re-opened and re-saved to pick up a change made in Import 2B after it was last saved.`,
    headers: ['Tax Head', 'As per GSTR-2B (Import 2B, eligible)', 'As per GSTR-3B (Table 4A, total ITC available)', 'Variance'],
    rows,
    fileNameBase: `GSTR3B_vs_GSTR2B_ITC_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [12, 26, 32, 14],
  };
};

// ────────────── REPORT 5: GSTR-3B vs GSTR-2A ITC Report ──────────────────
// Extends-portal-login: needs gstr2a_import_docs (Import 2B's GSTR-2A Import
// card) populated first, hence a separate category/status from the 2B
// version above even though the shape is identical.

export const buildGstr3bVsGstr2aItcReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const [result, gstr2aRes] = await Promise.all([
    fetchGstr3b(clientId, client.gstin || '', month),
    supabase.from('gstr2a_import_docs').select('input_igst, input_cgst, input_sgst').eq('client_id', clientId).eq('period_month', month).eq('reverse_charge', false),
  ]);
  const docs = gstr2aRes.data || [];
  const gstr2aTotal = docs.reduce((a, d: any) => ({
    igst: a.igst + (Number(d.input_igst) || 0),
    cgst: a.cgst + (Number(d.input_cgst) || 0),
    sgst: a.sgst + (Number(d.input_sgst) || 0),
  }), { igst: 0, cgst: 0, sgst: 0 });
  const s = result.summary;

  const g2aTotal = gstr2aTotal.igst + gstr2aTotal.cgst + gstr2aTotal.sgst;
  const g3bTotal = s.itcAvailable.igst + s.itcAvailable.cgst + s.itcAvailable.sgst;

  const rows: (string | number)[][] = [
    ['IGST', gstr2aTotal.igst, s.itcAvailable.igst, s.itcAvailable.igst - gstr2aTotal.igst],
    ['CGST', gstr2aTotal.cgst, s.itcAvailable.cgst, s.itcAvailable.cgst - gstr2aTotal.cgst],
    ['SGST', gstr2aTotal.sgst, s.itcAvailable.sgst, s.itcAvailable.sgst - gstr2aTotal.sgst],
    ['Total', g2aTotal, g3bTotal, g3bTotal - g2aTotal],
  ];

  return {
    title: 'GSTR 3B vs GSTR 2A ITC Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Approximate — "As per GSTR-2A" is every non-RCM document imported for the period (2A has no eligibility classification, unlike 2B, so this is a broader, rougher universe than the vs-GSTR-2B report). "As per GSTR-3B" is Table 4(A) ITC Available. Import GSTR-2A first from Import 2B's GSTR-2A Import card.`,
    headers: ['Tax Head', 'As per GSTR-2A (all non-RCM docs)', 'As per GSTR-3B (Table 4A, total ITC available)', 'Variance'],
    rows,
    fileNameBase: `GSTR3B_vs_GSTR2A_ITC_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [12, 28, 32, 14],
  };
};

// ────────────── REPORT 6: GSTR-3B Annual Summary Report ──────────────────

export const buildGstr3bAnnualSummaryReport = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);

  const results = await Promise.all(months.map((m) => fetchGstr3b(clientId, client.gstin || '', m).catch(() => null)));

  let totOut = 0, totRcm = 0, totLiab = 0, totItcAvail = 0, totItcNet = 0, totPayable = 0;
  const rows: (string | number)[][] = months.map((m, idx) => {
    const s = results[idx]?.summary;
    const outward = s ? s.outward.igst + s.outward.cgst + s.outward.sgst : 0;
    const rcm = s ? s.rcmLiability.igst + s.rcmLiability.cgst + s.rcmLiability.sgst : 0;
    const liab = s ? s.totalLiability.igst + s.totalLiability.cgst + s.totalLiability.sgst : 0;
    const itcAvail = s ? s.itcAvailable.igst + s.itcAvailable.cgst + s.itcAvailable.sgst : 0;
    const itcNet = s ? s.itcNet.igst + s.itcNet.cgst + s.itcNet.sgst : 0;
    const payable = s ? s.indicativeNetPayable.igst + s.indicativeNetPayable.cgst + s.indicativeNetPayable.sgst : 0;
    totOut += outward; totRcm += rcm; totLiab += liab; totItcAvail += itcAvail; totItcNet += itcNet; totPayable += payable;
    return [formatMonthLabel(m), outward, rcm, liab, itcAvail, itcNet, payable];
  });
  rows.push(['TOTAL — ' + fyLabel, totOut, totRcm, totLiab, totItcAvail, totItcNet, totPayable]);

  return {
    title: 'GSTR 3B Annual Summary Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   Approximate — this app's own computed draft GSTR-3B for each month, not the as-filed portal figures.`,
    headers: ['Month', 'Outward Liability', 'RCM Liability', 'Total Liability', 'ITC Available', 'Net ITC', 'Indicative Net Payable'],
    rows,
    fileNameBase: `GSTR3B_Annual_Summary_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [14, 18, 16, 16, 16, 14, 20],
  };
};

// ────────────── ITC cross-utilization (Rule 88A) ──────────────────────────

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
  const result = await fetchGstr3b(clientId, client.gstin || '', month);
  const s = result.summary;
  const { offset, cashPayable, itcCarriedForward } = computeItcOffset(s.totalLiability, s.itcNet);

  const rows: (string | number)[][] = [
    ['IGST Liability', s.totalLiability.igst, offset.igstFromIgst, offset.igstFromCgst, offset.igstFromSgst, cashPayable.igst],
    ['CGST Liability', s.totalLiability.cgst, offset.cgstFromIgst, offset.cgstFromCgst, 0, cashPayable.cgst],
    ['SGST Liability', s.totalLiability.sgst, offset.sgstFromIgst, 0, offset.sgstFromSgst, cashPayable.sgst],
    ['', '', '', '', '', ''],
    ['ITC Carried Forward', '', itcCarriedForward.igst, itcCarriedForward.cgst, itcCarriedForward.sgst, ''],
  ];

  return {
    title: 'GSTR 3B Offset Summary',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Approximate — this app's own computed indicative offset, following the standard IGST-first cross-utilization order (Rule 88A). The portal's actual filing-time allocation may differ if the filer chose a different (still legally valid) order.`,
    headers: ['Liability Head', 'Total Liability', 'Set Off from IGST ITC', 'Set Off from CGST ITC', 'Set Off from SGST ITC', 'Paid in Cash'],
    rows,
    fileNameBase: `GSTR3B_Offset_Summary_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [18, 16, 18, 18, 18, 14],
  };
};
