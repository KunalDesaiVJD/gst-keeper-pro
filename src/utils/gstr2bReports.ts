// The GSTR-2B family reports on the Reports Hub. Rate Wise, Supplier Wise and
// PY-in-CY now read gst_filed_returns (the portal-pulled document-level
// GSTR-2B, B2B only — see filedReturnReports.ts/handleGstr2bPull) instead of
// twob_import_docs, the Excel-imported table 2B Reconciliation uses — kept
// deliberately separate so this Hub never shows a figure sourced from a
// manual Excel import. Purchase Rate Wise stays on books_register (the
// firm's own purchase register, by design — see its own comment below).
//
// The portal's GSTR-2B payload doesn't carry an explicit tax rate either —
// rate-wise reports below derive it from tax ÷ taxable value and snap to the
// nearest standard GST slab, same approach a manual rate-wise working paper
// would use.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { formatMonthLabel } from './allClientsReports';
import { fetchFiledReturn, notPulledMsg, flattenGstr2bDocs, type Gstr2bSummary } from './filedReturnReports';

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

const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];
const deriveRate = (taxable: number, totalTax: number): number => {
  if (taxable <= 0) return 0;
  const raw = (totalTax / taxable) * 100;
  let closest = GST_SLABS[0], minDiff = Math.abs(raw - GST_SLABS[0]);
  for (const slab of GST_SLABS) {
    const diff = Math.abs(raw - slab);
    if (diff < minDiff) { minDiff = diff; closest = slab; }
  }
  return closest;
};

// ─────────────────── REPORT 1: GSTR 2B Rate Wise ──────────────────────────

const fetchFiledGstr2bDocs = async (clientId: string, client: ClientLite, month: string) => {
  const row = await fetchFiledReturn(clientId, month, 'GSTR2B');
  if (!row || !row.summary || Object.keys(row.summary).length === 0) throw new Error(notPulledMsg(client, month, 'GSTR-2B'));
  const docs = flattenGstr2bDocs(row.summary as Gstr2bSummary);
  if (docs.length === 0) throw new Error(`GSTR-2B was pulled for ${client.name} in ${formatMonthLabel(month)} but had no B2B documents to show.`);
  return docs;
};

export const buildGstr2bRateWiseReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const docs = await fetchFiledGstr2bDocs(clientId, client, month);

  interface Bucket { txval: number; igst: number; cgst: number; sgst: number; }
  const byRate = new Map<number, Bucket>();
  docs.forEach((d) => {
    const rate = deriveRate(d.txval, d.igst + d.cgst + d.sgst);
    const cur = byRate.get(rate) || { txval: 0, igst: 0, cgst: 0, sgst: 0 };
    cur.txval += d.txval; cur.igst += d.igst; cur.cgst += d.cgst; cur.sgst += d.sgst;
    byRate.set(rate, cur);
  });

  const sorted = Array.from(byRate.entries()).map(([rate, v]) => ({ rate, ...v })).sort((a, b) => a.rate - b.rate);
  let totTx = 0, totI = 0, totC = 0, totS = 0;
  const rows: (string | number)[][] = sorted.map((r) => {
    totTx += r.txval; totI += r.igst; totC += r.cgst; totS += r.sgst;
    return [`${r.rate}%`, r.txval, r.igst, r.cgst, r.sgst, r.igst + r.cgst + r.sgst];
  });
  rows.push(['TOTAL', totTx, totI, totC, totS, totI + totC + totS]);

  return {
    title: 'GSTR 2B Rate Wise Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Pulled directly from the portal (B2B documents only) — not the Excel-imported 2B used by 2B Reconciliation. Rate is derived from tax ÷ taxable value and snapped to the nearest standard GST slab — the portal payload doesn't carry an explicit rate column either.`,
    headers: ['Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total Tax'],
    rows,
    fileNameBase: `GSTR2B_Rate_Wise_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [10, 18, 14, 14, 14, 14],
  };
};

// ─────────────────── REPORT 2: GSTR 2B Supplier Wise ──────────────────────

export const buildGstr2bSupplierWiseReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const docs = await fetchFiledGstr2bDocs(clientId, client, month);

  interface Agg { name: string; count: number; txval: number; igst: number; cgst: number; sgst: number; }
  const byGstin = new Map<string, Agg>();
  docs.forEach((d) => {
    const gstin = d.ctin || 'Unknown';
    const cur = byGstin.get(gstin) || { name: d.trdnm, count: 0, txval: 0, igst: 0, cgst: 0, sgst: 0 };
    cur.count += 1;
    cur.txval += d.txval; cur.igst += d.igst; cur.cgst += d.cgst; cur.sgst += d.sgst;
    byGstin.set(gstin, cur);
  });

  const sortedGstins = Array.from(byGstin.keys()).sort((a, b) => byGstin.get(b)!.txval - byGstin.get(a)!.txval);
  let totCount = 0, totTx = 0, totI = 0, totC = 0, totS = 0;
  const rows: (string | number)[][] = sortedGstins.map((gstin, idx) => {
    const a = byGstin.get(gstin)!;
    totCount += a.count; totTx += a.txval; totI += a.igst; totC += a.cgst; totS += a.sgst;
    return [idx + 1, a.name, gstin, a.count, a.txval, a.igst, a.cgst, a.sgst, a.igst + a.cgst + a.sgst];
  });
  rows.push(['', 'TOTAL', '', totCount, totTx, totI, totC, totS, totI + totC + totS]);

  return {
    title: 'GSTR 2B Supplier Wise Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Pulled directly from the portal (B2B documents only) — not the Excel-imported 2B. Sorted by taxable value, highest first.`,
    headers: ['Sr No.', 'Supplier Name', 'Supplier GSTIN', 'Document Count', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total Tax'],
    rows,
    fileNameBase: `GSTR2B_Supplier_Wise_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [6, 30, 20, 12, 16, 14, 14, 14, 14],
  };
};

// ─────────────────── REPORT 3: Purchase Rate Wise ─────────────────────────

// Same rate-derivation as GSTR 2B Rate Wise, sourced from the firm's own
// books_register instead of the imported GSTR-2B — so this reflects what
// the client's books say was purchased, not what the portal shows.
export const buildPurchaseRateWiseReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data } = await supabase
    .from('books_register')
    .select('taxable_value, input_igst, input_cgst, input_sgst')
    .eq('client_id', clientId).eq('period_month', month);
  const docs = data || [];
  if (docs.length === 0) {
    throw new Error(`No books register data for ${client.name} in ${formatMonthLabel(month)}. Import it first from Import 2B.`);
  }

  interface Bucket { txval: number; igst: number; cgst: number; sgst: number; }
  const byRate = new Map<number, Bucket>();
  docs.forEach((d) => {
    const txval = num(d.taxable_value), igst = num(d.input_igst), cgst = num(d.input_cgst), sgst = num(d.input_sgst);
    const rate = deriveRate(txval, igst + cgst + sgst);
    const cur = byRate.get(rate) || { txval: 0, igst: 0, cgst: 0, sgst: 0 };
    cur.txval += txval; cur.igst += igst; cur.cgst += cgst; cur.sgst += sgst;
    byRate.set(rate, cur);
  });

  const sorted = Array.from(byRate.entries()).map(([rate, v]) => ({ rate, ...v })).sort((a, b) => a.rate - b.rate);
  let totTx = 0, totI = 0, totC = 0, totS = 0;
  const rows: (string | number)[][] = sorted.map((r) => {
    totTx += r.txval; totI += r.igst; totC += r.cgst; totS += r.sgst;
    return [`${r.rate}%`, r.txval, r.igst, r.cgst, r.sgst, r.igst + r.cgst + r.sgst];
  });
  rows.push(['TOTAL', totTx, totI, totC, totS, totI + totC + totS]);

  return {
    title: 'Purchase Rate Wise Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   From the firm's books register (not GSTR-2B) — rate is derived from tax ÷ taxable value and snapped to the nearest standard GST slab.`,
    headers: ['Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total Tax'],
    rows,
    fileNameBase: `Purchase_Rate_Wise_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [10, 18, 14, 14, 14, 14],
  };
};

// ────────────── REPORT 4: GSTR 2B (P.Y Invoices showing in C.Y) ──────────

// The portal sends invoice dates as DD-MM-YYYY (e.g. "31-07-2026"), not ISO.
const fyStartYearOfPortalDate = (d: string): number | null => {
  const m = String(d || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const monthNum = Number(m[2]), year = Number(m[3]);
  return monthNum >= 4 ? year : year - 1;
};

export const buildGstr2bPyInCyReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const docs = await fetchFiledGstr2bDocs(clientId, client, month);

  const [mm, yyyy] = month.split('/').map(Number);
  const periodFy = mm >= 4 ? yyyy : yyyy - 1;

  const flagged = docs
    .map((d) => ({ d, invFy: fyStartYearOfPortalDate(d.date) }))
    .filter((x) => x.invFy != null && x.invFy < periodFy)
    .sort((a, b) => a.d.date.localeCompare(b.d.date));

  const rows: (string | number)[][] = flagged.map(({ d }, idx) =>
    [idx + 1, d.trdnm, d.ctin, d.inum, d.date, d.txval, d.igst + d.cgst + d.sgst]);
  if (rows.length === 0) {
    rows.push(['—', 'No previous-year-dated documents found in this period\'s GSTR-2B.', '', '', '', '', '']);
  }

  return {
    title: 'GSTR 2B (P.Y Invoices showing in C.Y)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Return Period: ${formatMonthLabel(month)} (FY ${periodFy}-${String(periodFy + 1).slice(-2)})   |   Pulled directly from the portal (B2B documents only) — not the Excel-imported 2B.`,
    headers: ['Sr No.', 'Supplier Name', 'Supplier GSTIN', 'Invoice No.', 'Invoice Date', 'Taxable Value', 'Total Tax'],
    rows,
    fileNameBase: `GSTR2B_PY_in_CY_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [6, 30, 20, 16, 12, 16, 14],
  };
};
