// The 8 "ready now" Tax Liability & ITC reports on the Reports Hub. All of
// them slice the same computed draft GSTR-3B (fetchGstr3b/buildGstr3bJson)
// and its GSTR-1 source into focused, single-purpose views — mirroring how
// the portal's own GSTR-9 / GSTR-3B breakdowns separate import-of-goods ITC,
// RCM liability, export/SEZ supplies, etc. into their own tables rather than
// one combined dump.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { mmYyyyToShort, formatMonthLabel } from './allClientsReports';
import { buildGstr1Summary } from './buildGstr1Summary';
import { hydrateManualEntriesFromJson } from './gstr1ManualBuild';
import { fetchGstr3b } from './fetchGstr3b';

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

const fetchGstr1RawJson = async (clientId: string, client: ClientLite, month: string): Promise<any> => {
  const shortMonth = mmYyyyToShort(month);
  const { data } = await supabase.from('gstr1_data').select('raw_json').eq('client_id', clientId).eq('period_month', shortMonth).maybeSingle();
  if (!data) throw new Error(`No GSTR-1 data imported for ${client.name} in ${formatMonthLabel(month)}. Import it first from GSTR-1 Data.`);
  return data.raw_json;
};

// ────────── REPORT 1: Difference in Liability Declared and Paid ──────────

export const buildLiabilityDeclaredVsPaidReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const result = await fetchGstr3b(clientId, client.gstin || '', month);
  const s = result.summary;

  const rows: (string | number)[][] = [
    ['IGST', s.totalLiability.igst, s.indicativeNetPayable.igst, s.totalLiability.igst - s.indicativeNetPayable.igst],
    ['CGST', s.totalLiability.cgst, s.indicativeNetPayable.cgst, s.totalLiability.cgst - s.indicativeNetPayable.cgst],
    ['SGST', s.totalLiability.sgst, s.indicativeNetPayable.sgst, s.totalLiability.sgst - s.indicativeNetPayable.sgst],
    [
      'Total',
      s.totalLiability.igst + s.totalLiability.cgst + s.totalLiability.sgst,
      s.indicativeNetPayable.igst + s.indicativeNetPayable.cgst + s.indicativeNetPayable.sgst,
      (s.totalLiability.igst + s.totalLiability.cgst + s.totalLiability.sgst) - (s.indicativeNetPayable.igst + s.indicativeNetPayable.cgst + s.indicativeNetPayable.sgst),
    ],
  ];

  return {
    title: 'Difference in Liability Declared and Paid',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   "Declared" is Total Output Liability (3.1a + 3.1d) before ITC set-off; "Paid" is the indicative net payable after Net ITC set-off, both as computed by this app — not the actual cash challan paid on the portal (needs portal login, a later phase).`,
    headers: ['Tax Head', 'Liability Declared (gross)', 'Liability Paid (net of ITC)', 'ITC Set Off'],
    rows,
    fileNameBase: `Liability_Declared_vs_Paid_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [12, 22, 22, 16],
  };
};

// ────────── REPORT 2: Tax Liability and ITC Summary ──────────────────────

export const buildTaxLiabilityAndItcSummaryReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const result = await fetchGstr3b(clientId, client.gstin || '', month);
  const s = result.summary;

  const rows: (string | number)[][] = [
    ['Outward Taxable Liability (3.1a)', s.outward.igst, s.outward.cgst, s.outward.sgst, s.outward.igst + s.outward.cgst + s.outward.sgst],
    ['Reverse Charge Liability (3.1d)', s.rcmLiability.igst, s.rcmLiability.cgst, s.rcmLiability.sgst, s.rcmLiability.igst + s.rcmLiability.cgst + s.rcmLiability.sgst],
    ['Total Output Tax Liability', s.totalLiability.igst, s.totalLiability.cgst, s.totalLiability.sgst, s.totalLiability.igst + s.totalLiability.cgst + s.totalLiability.sgst],
    ['ITC Available (4A)', s.itcAvailable.igst, s.itcAvailable.cgst, s.itcAvailable.sgst, s.itcAvailable.igst + s.itcAvailable.cgst + s.itcAvailable.sgst],
    ['ITC Reversed (4B)', s.itcReversed.igst, s.itcReversed.cgst, s.itcReversed.sgst, s.itcReversed.igst + s.itcReversed.cgst + s.itcReversed.sgst],
    ['Net ITC Available (4C)', s.itcNet.igst, s.itcNet.cgst, s.itcNet.sgst, s.itcNet.igst + s.itcNet.cgst + s.itcNet.sgst],
    ['Indicative Net Payable', s.indicativeNetPayable.igst, s.indicativeNetPayable.cgst, s.indicativeNetPayable.sgst, s.indicativeNetPayable.igst + s.indicativeNetPayable.cgst + s.indicativeNetPayable.sgst],
  ];

  return {
    title: 'Tax Liability and ITC Summary',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   One-page digest of this app's computed draft GSTR-3B — see the GSTR-3B Liability Report for the full table-wise breakdown.`,
    headers: ['Component', 'IGST', 'CGST', 'SGST', 'Total'],
    rows,
    fileNameBase: `Tax_Liability_ITC_Summary_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [30, 14, 14, 14, 14],
  };
};

// ────────── REPORT 3: Tax Liability Other Than Export/Reverse Charge ─────

export const buildTaxLiabilityExclExportRcmReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const gstr1Raw = await fetchGstr1RawJson(clientId, client, month);
  const { rowsBySection } = hydrateManualEntriesFromJson(gstr1Raw);

  interface Bucket { txval: number; igst: number; cgst: number; sgst: number; cess: number; }
  const byRate = new Map<number, Bucket>();
  const bump = (rt: unknown, txval: number, igst: number, cgst: number, sgst: number, cess: number) => {
    const key = num(rt);
    const cur = byRate.get(key) || { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    cur.txval += txval; cur.igst += igst; cur.cgst += cgst; cur.sgst += sgst; cur.cess += cess;
    byRate.set(key, cur);
  };
  // Domestic taxable supplies only — excludes exports (zero-rated, its own
  // report below) and Nil/Exempt (no tax rate to bucket by).
  (['b2b', 'b2cl', 'b2cs'] as const).forEach((section) => {
    (rowsBySection[section] || []).forEach((r) => bump(r.rt, num(r.txval), num(r.iamt), num(r.camt), num(r.samt), num(r.csamt)));
  });
  (['cdnr', 'cdnur'] as const).forEach((section) => {
    (rowsBySection[section] || []).forEach((r) => {
      const sign = String(r.ntTyp || 'C').toUpperCase().startsWith('D') ? 1 : -1;
      bump(r.rt, sign * num(r.txval), sign * num(r.iamt), sign * num(r.camt), sign * num(r.samt), sign * num(r.csamt));
    });
  });

  const sorted = Array.from(byRate.entries()).map(([rt, v]) => ({ rt, ...v })).sort((a, b) => a.rt - b.rt);
  let totTx = 0, totI = 0, totC = 0, totS = 0, totCess = 0;
  const rows: (string | number)[][] = sorted.map((r) => {
    totTx += r.txval; totI += r.igst; totC += r.cgst; totS += r.sgst; totCess += r.cess;
    return [`${r.rt}%`, r.txval, r.igst, r.cgst, r.sgst, r.cess, r.igst + r.cgst + r.sgst + r.cess];
  });
  rows.push(['TOTAL', totTx, totI, totC, totS, totCess, totI + totC + totS + totCess]);

  return {
    title: 'Tax Liability Other Than Export/Reverse Charge',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Domestic taxable supplies (B2B, B2CL, B2CS, net of credit/debit notes) by rate — excludes exports/SEZ (its own report), Nil-rated/Exempt, and doesn't net out B2B reverse-charge (4B) tax; for the liability-only view net of RCM recipient tax, see the GSTR-3B Liability Report.`,
    headers: ['Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `Tax_Liability_Excl_Export_RCM_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [10, 18, 14, 14, 14, 12, 14],
  };
};

// ────────── REPORT 4: Tax Liability Due to Reverse Charge ────────────────

interface RcmDataRow { taxable_value: number | null; cgst_2_5: number | null; cgst_9: number | null; sgst_2_5: number | null; sgst_9: number | null; igst_5: number | null; igst_18: number | null; }
interface BuilderRcmRow { taxable_value: number | null; cgst: number | null; sgst: number | null; }

export const buildTaxLiabilityRcmReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const shortMonth = mmYyyyToShort(month);
  const [rcmRes, fsiRes] = await Promise.all([
    supabase.from('rcm_data').select('taxable_value, cgst_2_5, cgst_9, sgst_2_5, sgst_9, igst_5, igst_18').eq('client_id', clientId).eq('month', shortMonth),
    supabase.from('builder_rcm_postings').select('taxable_value, cgst, sgst').eq('client_id', clientId).eq('period_month', month),
  ]);
  const rcmRows = (rcmRes.data || []) as RcmDataRow[];
  const fsiRows = (fsiRes.data || []) as BuilderRcmRow[];
  if (rcmRows.length === 0 && fsiRows.length === 0) {
    throw new Error(`No RCM data for ${client.name} in ${formatMonthLabel(month)}. Enter it first in RCM Summary.`);
  }

  const sums = rcmRows.reduce((a, r) => ({
    igst5: a.igst5 + num(r.igst_5), igst18: a.igst18 + num(r.igst_18),
    cgst2_5: a.cgst2_5 + num(r.cgst_2_5), sgst2_5: a.sgst2_5 + num(r.sgst_2_5),
    cgst9: a.cgst9 + num(r.cgst_9), sgst9: a.sgst9 + num(r.sgst_9),
    taxableTotal: a.taxableTotal + num(r.taxable_value),
  }), { igst5: 0, igst18: 0, cgst2_5: 0, sgst2_5: 0, cgst9: 0, sgst9: 0, taxableTotal: 0 });

  const rows: (string | number)[][] = [
    ['5% — Inter-state (IGST)', sums.igst5 > 0 ? sums.igst5 / 0.05 : 0, sums.igst5, 0, 0, sums.igst5],
    ['5% — Intra-state (CGST+SGST)', (sums.cgst2_5 + sums.sgst2_5) > 0 ? (sums.cgst2_5 + sums.sgst2_5) / 0.05 : 0, 0, sums.cgst2_5, sums.sgst2_5, sums.cgst2_5 + sums.sgst2_5],
    ['18% — Inter-state (IGST)', sums.igst18 > 0 ? sums.igst18 / 0.18 : 0, sums.igst18, 0, 0, sums.igst18],
    ['18% — Intra-state (CGST+SGST)', (sums.cgst9 + sums.sgst9) > 0 ? (sums.cgst9 + sums.sgst9) / 0.18 : 0, 0, sums.cgst9, sums.sgst9, sums.cgst9 + sums.sgst9],
  ];
  if (fsiRows.length > 0) {
    const fsiTotals = fsiRows.reduce((a, r) => ({ txval: a.txval + num(r.taxable_value), cgst: a.cgst + num(r.cgst), sgst: a.sgst + num(r.sgst) }), { txval: 0, cgst: 0, sgst: 0 });
    rows.push(['Builder TDR/FSI Reverse Charge (always intra-state)', fsiTotals.txval, 0, fsiTotals.cgst, fsiTotals.sgst, fsiTotals.cgst + fsiTotals.sgst]);
  }
  const totalTax = sums.igst5 + sums.igst18 + sums.cgst2_5 + sums.sgst2_5 + sums.cgst9 + sums.sgst9
    + fsiRows.reduce((a, r) => a + num(r.cgst) + num(r.sgst), 0);
  const totalTaxable = sums.taxableTotal + fsiRows.reduce((a, r) => a + num(r.taxable_value), 0);
  rows.push(['TOTAL', totalTaxable, sums.igst5 + sums.igst18, sums.cgst2_5 + sums.cgst9 + fsiRows.reduce((a, r) => a + num(r.cgst), 0), sums.sgst2_5 + sums.sgst9 + fsiRows.reduce((a, r) => a + num(r.sgst), 0), totalTax]);

  return {
    title: 'Tax Liability Due to Reverse Charge',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Rate-wise RCM liability from RCM Summary. Per-bucket taxable value is derived from tax ÷ rate (RCM Summary doesn't store taxable value per rate bucket); the TOTAL row's taxable value is the actual sum instead, so it stays exact even if a bucket's derived figure carries rounding.`,
    headers: ['Rate / Head', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total Tax'],
    rows,
    fileNameBase: `Tax_Liability_RCM_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 14, 14, 14, 14],
  };
};

// ────────── REPORT 5: Tax Liability Due to Export and SEZ Supplies ───────

export const buildTaxLiabilityExportSezReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const gstr1Raw = await fetchGstr1RawJson(clientId, client, month);
  const summary = buildGstr1Summary(gstr1Raw);
  const s6A = summary.sections.find((s) => s.code === '6A');
  const s6B = summary.sections.find((s) => s.code === '6B');
  const s6C = summary.sections.find((s) => s.code === '6C');

  const rows: (string | number)[][] = [s6A, s6B, s6C]
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => [s.code, s.title, s.count, s.value, s.igst, s.cgst, s.sgst, s.cess]);
  const totIgst = rows.reduce((a, r) => a + Number(r[4]), 0);
  const totCgst = rows.reduce((a, r) => a + Number(r[5]), 0);
  const totSgst = rows.reduce((a, r) => a + Number(r[6]), 0);
  const totCess = rows.reduce((a, r) => a + Number(r[7]), 0);
  const totValue = rows.reduce((a, r) => a + Number(r[3]), 0);
  rows.push(['', 'TOTAL', '', totValue, totIgst, totCgst, totSgst, totCess]);

  return {
    title: 'Tax Liability Due to Export and SEZ Supplies',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   GSTR-1 Tables 6A (Exports), 6B (SEZ) and 6C (Deemed Exports). Only 6A is reported as zero-rated (3.1(b)) on this app's GSTR-3B draft — 6B/6C currently fold into 3.1(a); see the GSTR-3B Liability Report for what's actually on the draft.`,
    headers: ['Table', 'Description', 'Count', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess'],
    rows,
    fileNameBase: `Tax_Liability_Export_SEZ_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [8, 45, 8, 16, 14, 14, 14, 12],
  };
};

// ────────── REPORT 6: ITC Claimed and Due (Other Than Import of Goods) ───

export const buildItcClaimedExclImportGoodsReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const result = await fetchGstr3b(clientId, client.gstin || '', month);
  const others = result.summary.itcAvailableRows.filter((r) => r.srNo !== '(1)');

  let totI = 0, totC = 0, totS = 0;
  const rows: (string | number)[][] = others.map((r) => {
    totI += r.igst; totC += r.cgst; totS += r.sgst;
    return [r.srNo, r.label, r.igst, r.cgst, r.sgst, r.igst + r.cgst + r.sgst];
  });
  rows.push(['', 'TOTAL', totI, totC, totS, totI + totC + totS]);

  return {
    title: 'ITC Claimed and Due (Other Than Import of Goods)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   GSTR-3B Table 4(A) rows (2)-(5): import of services, RCM ITC, ISD, and all other ITC — this app's computed draft.`,
    headers: ['Row', 'Description', 'IGST', 'CGST', 'SGST', 'Total'],
    rows,
    fileNameBase: `ITC_Claimed_Excl_Import_Goods_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [8, 50, 14, 14, 14, 14],
  };
};

// ────────── REPORT 7: ITC Claimed and Due (Import of Goods) ──────────────

export const buildItcClaimedImportGoodsReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const result = await fetchGstr3b(clientId, client.gstin || '', month);
  const s = result.summary;
  const impg = s.itcAvailableRows.find((r) => r.srNo === '(1)') || { label: 'Import of goods', igst: 0, cgst: 0, sgst: 0 };

  const rows: (string | number)[][] = [
    ['(1)', impg.label, impg.igst, impg.cgst, impg.sgst, impg.igst + impg.cgst + impg.sgst],
  ];

  return {
    title: 'ITC Claimed and Due (Import of Goods)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   GSTR-3B Table 4(A)(1) — import of goods, entered directly in ITC Summary (not sourced from GSTR-2B).`,
    headers: ['Row', 'Description', 'IGST', 'CGST', 'SGST', 'Total'],
    rows,
    fileNameBase: `ITC_Claimed_Import_Goods_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [8, 40, 14, 14, 14, 14],
  };
};

// ────────── REPORT 8: RCM Liability Declared and ITC Claimed Thereon ─────

export const buildRcmLiabilityVsItcReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const result = await fetchGstr3b(clientId, client.gstin || '', month);
  const s = result.summary;
  const rcmItc = s.itcAvailableRows.find((r) => r.srNo === '(3)') || { igst: 0, cgst: 0, sgst: 0 };

  const rows: (string | number)[][] = [
    ['IGST', s.rcmLiability.igst, rcmItc.igst, s.rcmLiability.igst - rcmItc.igst],
    ['CGST', s.rcmLiability.cgst, rcmItc.cgst, s.rcmLiability.cgst - rcmItc.cgst],
    ['SGST', s.rcmLiability.sgst, rcmItc.sgst, s.rcmLiability.sgst - rcmItc.sgst],
    [
      'Total',
      s.rcmLiability.igst + s.rcmLiability.cgst + s.rcmLiability.sgst,
      rcmItc.igst + rcmItc.cgst + rcmItc.sgst,
      (s.rcmLiability.igst + s.rcmLiability.cgst + s.rcmLiability.sgst) - (rcmItc.igst + rcmItc.cgst + rcmItc.sgst),
    ],
  ];

  return {
    title: 'Reverse Charge Liability Declared and ITC Claimed Thereon',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Table 3.1(d) RCM liability vs Table 4(A)(3) RCM ITC, both from this app's computed draft. Both are built from the same RCM Summary totals, so they only diverge when a manual GSTR-3B Adjustments entry against 3.1(d) has no matching ITC-side adjustment — a genuine gap worth reviewing, not a computation error.`,
    headers: ['Tax Head', 'RCM Liability Declared (3.1d)', 'RCM ITC Claimed (4A(3))', 'Variance'],
    rows,
    fileNameBase: `RCM_Liability_vs_ITC_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [12, 22, 20, 14],
  };
};
