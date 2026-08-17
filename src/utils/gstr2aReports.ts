// The 3 GSTR-2A reports on the Reports Hub (Phase 3 / extends-portal-login).
// Read gstr2a_import_docs — populated either by the extension's "Pull from
// portal" (Import 2B page's GSTR-2A Import card) or a manual Excel import,
// same client_id + period_month (MM/YYYY) keying as every other report here.
// Mirrors gstr2bReports.ts closely; see that file for why rate is derived
// rather than read from a column (neither 2A nor 2B exports carry one).

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { formatMonthLabel } from './allClientsReports';

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

// ─────────────────── REPORT 1: GSTR 2A Rate Wise ──────────────────────────

export const buildGstr2aRateWiseReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data } = await supabase
    .from('gstr2a_import_docs')
    .select('taxable_value, input_igst, input_cgst, input_sgst, cess')
    .eq('client_id', clientId).eq('period_month', month);
  const docs = data || [];
  if (docs.length === 0) {
    throw new Error(`No GSTR-2A data imported for ${client.name} in ${formatMonthLabel(month)}. Import it first from Import 2B's GSTR-2A Import card.`);
  }

  interface Bucket { txval: number; igst: number; cgst: number; sgst: number; cess: number; }
  const byRate = new Map<number, Bucket>();
  docs.forEach((d) => {
    const txval = num(d.taxable_value), igst = num(d.input_igst), cgst = num(d.input_cgst), sgst = num(d.input_sgst), cess = num(d.cess);
    const rate = deriveRate(txval, igst + cgst + sgst);
    const cur = byRate.get(rate) || { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    cur.txval += txval; cur.igst += igst; cur.cgst += cgst; cur.sgst += sgst; cur.cess += cess;
    byRate.set(rate, cur);
  });

  const sorted = Array.from(byRate.entries()).map(([rate, v]) => ({ rate, ...v })).sort((a, b) => a.rate - b.rate);
  let totTx = 0, totI = 0, totC = 0, totS = 0, totCess = 0;
  const rows: (string | number)[][] = sorted.map((r) => {
    totTx += r.txval; totI += r.igst; totC += r.cgst; totS += r.sgst; totCess += r.cess;
    return [`${r.rate}%`, r.txval, r.igst, r.cgst, r.sgst, r.cess, r.igst + r.cgst + r.sgst + r.cess];
  });
  rows.push(['TOTAL', totTx, totI, totC, totS, totCess, totI + totC + totS + totCess]);

  return {
    title: 'GSTR 2A Rate Wise Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Rate is derived from tax ÷ taxable value and snapped to the nearest standard GST slab — the imported GSTR-2A doesn't carry an explicit rate column.`,
    headers: ['Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `GSTR2A_Rate_Wise_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [10, 18, 14, 14, 14, 12, 14],
  };
};

// ─────────────────── REPORT 2: GSTR 2A Supplier Wise ──────────────────────

export const buildGstr2aSupplierWiseReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data } = await supabase
    .from('gstr2a_import_docs')
    .select('supplier_gstin, supplier_name, taxable_value, input_igst, input_cgst, input_sgst, cess')
    .eq('client_id', clientId).eq('period_month', month);
  const docs = data || [];
  if (docs.length === 0) {
    throw new Error(`No GSTR-2A data imported for ${client.name} in ${formatMonthLabel(month)}. Import it first from Import 2B's GSTR-2A Import card.`);
  }

  interface Agg { name: string; count: number; txval: number; igst: number; cgst: number; sgst: number; cess: number; }
  const byGstin = new Map<string, Agg>();
  docs.forEach((d) => {
    const gstin = String(d.supplier_gstin || '').trim() || 'Unknown';
    const cur = byGstin.get(gstin) || { name: d.supplier_name || '—', count: 0, txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    cur.count += 1;
    cur.txval += num(d.taxable_value); cur.igst += num(d.input_igst); cur.cgst += num(d.input_cgst); cur.sgst += num(d.input_sgst); cur.cess += num(d.cess);
    byGstin.set(gstin, cur);
  });

  const sortedGstins = Array.from(byGstin.keys()).sort((a, b) => byGstin.get(b)!.txval - byGstin.get(a)!.txval);
  let totCount = 0, totTx = 0, totI = 0, totC = 0, totS = 0, totCess = 0;
  const rows: (string | number)[][] = sortedGstins.map((gstin, idx) => {
    const a = byGstin.get(gstin)!;
    totCount += a.count; totTx += a.txval; totI += a.igst; totC += a.cgst; totS += a.sgst; totCess += a.cess;
    return [idx + 1, a.name, gstin, a.count, a.txval, a.igst, a.cgst, a.sgst, a.cess, a.igst + a.cgst + a.sgst + a.cess];
  });
  rows.push(['', 'TOTAL', '', totCount, totTx, totI, totC, totS, totCess, totI + totC + totS + totCess]);

  return {
    title: 'GSTR 2A Supplier Wise Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Sorted by taxable value, highest first`,
    headers: ['Sr No.', 'Supplier Name', 'Supplier GSTIN', 'Document Count', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `GSTR2A_Supplier_Wise_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [6, 30, 20, 12, 16, 14, 14, 14, 12, 14],
  };
};

// ────────────── REPORT 3: GSTR 2A (P.Y Invoices showing in C.Y) ──────────

const fyStartYearOfIso = (isoDate: string): number | null => {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]), monthNum = Number(m[2]);
  return monthNum >= 4 ? year : year - 1;
};

export const buildGstr2aPyInCyReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data } = await supabase
    .from('gstr2a_import_docs')
    .select('date, supplier_gstin, supplier_name, supplier_invoice_number, taxable_value, input_igst, input_cgst, input_sgst, cess')
    .eq('client_id', clientId).eq('period_month', month);
  const docs = data || [];
  if (docs.length === 0) {
    throw new Error(`No GSTR-2A data imported for ${client.name} in ${formatMonthLabel(month)}. Import it first from Import 2B's GSTR-2A Import card.`);
  }

  const [mm, yyyy] = month.split('/').map(Number);
  const periodFy = mm >= 4 ? yyyy : yyyy - 1;

  const flagged = docs
    .map((d) => ({ d, invFy: fyStartYearOfIso(String(d.date || '')) }))
    .filter((x) => x.invFy != null && x.invFy < periodFy)
    .sort((a, b) => String(a.d.date || '').localeCompare(String(b.d.date || '')));

  const rows: (string | number)[][] = flagged.map(({ d }, idx) => {
    const igst = num(d.input_igst), cgst = num(d.input_cgst), sgst = num(d.input_sgst), cess = num(d.cess);
    return [idx + 1, d.supplier_name || '—', d.supplier_gstin || '—', d.supplier_invoice_number || '—', d.date || '—', num(d.taxable_value), igst + cgst + sgst + cess];
  });
  if (rows.length === 0) {
    rows.push(['—', 'No previous-year-dated documents found in this period\'s imported GSTR-2A.', '', '', '', '', '']);
  }

  return {
    title: 'GSTR 2A (P.Y Invoices showing in C.Y)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Return Period: ${formatMonthLabel(month)} (FY ${periodFy}-${String(periodFy + 1).slice(-2)})`,
    headers: ['Sr No.', 'Supplier Name', 'Supplier GSTIN', 'Invoice No.', 'Invoice Date', 'Taxable Value', 'Total Tax'],
    rows,
    fileNameBase: `GSTR2A_PY_in_CY_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [6, 30, 20, 16, 12, 16, 14],
  };
};
