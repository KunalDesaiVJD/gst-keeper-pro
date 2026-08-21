// The 6 GSTR-1 family reports on the Reports Hub. Each now PREFERS the real
// filed GSTR-1 JSON — gst_filed_returns.full_json, pulled directly from the
// portal's own "Offline Download for GSTR-1" feature (content.js
// handleGstr1JsonPull) — over this app's own pre-filing books draft
// (gstr1_data.raw_json, still the fallback when the filed JSON hasn't been
// pulled yet, since a return not yet filed genuinely has no portal JSON to
// pull). Confirmed live (2026-08-21): the portal's own download is the SAME
// invoice-level JSON schema gstr1_data.raw_json already uses, so every
// parser below works unchanged against either source — only WHICH one wins
// changed, and each report says which one it's showing.
//
// Reuses the app's existing GSTR-1 JSON parsers rather than re-deriving
// section logic:
//   - hydrateManualEntriesFromJson (gstr1ManualBuild.ts) flattens every
//     section into per-line rows with rt/txval/iamt/camt/samt/csamt, the
//     same parser the manual entry grid uses to re-open a return for
//     editing — kept in lock-step with the portal JSON shape by that file.
//   - buildGstr1Summary (buildGstr1Summary.ts) produces the portal-style
//     table-wise consolidated summary already shown in the "Generate
//     Summary" dialog.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { mmYyyyToShort, formatMonthLabel } from './allClientsReports';
import { hydrateManualEntriesFromJson } from './gstr1ManualBuild';
import { buildGstr1Summary } from './buildGstr1Summary';

interface ClientLite { id: string; name: string; gstin: string; }

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const fileSafe = (s: string) => s.replace(/\s+/g, '_');

// A debit note adds to the outward figure, a credit note subtracts — same
// convention buildGstr1Summary.ts and computeGstr1OutputTax.ts both use.
const noteSign = (ntTyp: unknown): 1 | -1 =>
  String(ntTyp ?? 'C').toUpperCase().startsWith('D') ? 1 : -1;

type Gstr1Source = 'filed' | 'draft';

// One line, appended to every report's subtitle, so it's never ambiguous
// which JSON a figure came from.
const sourceNote = (source: Gstr1Source) => source === 'filed'
  ? 'As filed on the portal (real invoices, pulled via GSTR-1 (Filed on Portal)\'s Pull button)'
  : 'This app\'s pre-filing books draft — pull the filed GSTR-1 JSON (GSTR-1 (Filed on Portal) → Pull) to see the real return instead';

const fetchGstr1Row = async (clientId: string, month: string) => {
  const shortMonth = mmYyyyToShort(month);
  const [clientRes, filedRes, draftRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle(),
    supabase.from('gst_filed_returns').select('full_json').eq('client_id', clientId).eq('period_month', month).eq('return_type', 'GSTR1').maybeSingle(),
    supabase.from('gstr1_data').select('raw_json').eq('client_id', clientId).eq('period_month', shortMonth).maybeSingle(),
  ]);
  const client: ClientLite = (clientRes.data || { id: clientId, name: 'Unknown', gstin: '' }) as any;
  const filedJson = filedRes.data?.full_json;
  if (filedJson && typeof filedJson === 'object' && Object.keys(filedJson).length > 0) {
    return { client, gstr1: { raw_json: filedJson }, source: 'filed' as Gstr1Source, shortMonth };
  }
  if (draftRes.data) {
    return { client, gstr1: { raw_json: draftRes.data.raw_json }, source: 'draft' as Gstr1Source, shortMonth };
  }
  throw new Error(`No filed GSTR-1 JSON pulled and no books draft imported for ${client.name} in ${formatMonthLabel(month)}. Use Pull to fetch the filed return from the portal, or import a draft from GSTR-1 Data.`);
};

// ─────────────────── REPORT 1: Rate Wise ─────────────────────────────────

export const buildGstr1RateWiseReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { client, gstr1, source } = await fetchGstr1Row(clientId, month);
  const { rowsBySection } = hydrateManualEntriesFromJson(gstr1.raw_json);

  interface Bucket { txval: number; igst: number; cgst: number; sgst: number; cess: number; }
  const byRate = new Map<number, Bucket>();
  const bump = (rt: unknown, txval: number, igst: number, cgst: number, sgst: number, cess: number) => {
    const key = num(rt);
    const cur = byRate.get(key) || { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    cur.txval += txval; cur.igst += igst; cur.cgst += cgst; cur.sgst += sgst; cur.cess += cess;
    byRate.set(key, cur);
  };

  // Every outward-supply line, at whatever rate it carries — reverse-charge
  // and SEZ/deemed-export B2B invoices included, since this is a breakdown
  // of what's in the return, not a re-derivation of net output liability.
  (['b2b', 'b2cl', 'b2cs', 'exp'] as const).forEach((section) => {
    (rowsBySection[section] || []).forEach((r) => bump(r.rt, num(r.txval), num(r.iamt), num(r.camt), num(r.samt), num(r.csamt)));
  });
  (['cdnr', 'cdnur'] as const).forEach((section) => {
    (rowsBySection[section] || []).forEach((r) => {
      const sign = noteSign(r.ntTyp);
      bump(r.rt, sign * num(r.txval), sign * num(r.iamt), sign * num(r.camt), sign * num(r.samt), sign * num(r.csamt));
    });
  });

  const j = gstr1.raw_json || {};
  const nilValue = (j.nil?.inv || []).reduce((s: number, r: any) => s + num(r.nil_amt) + num(r.expt_amt) + num(r.ngsup_amt), 0);

  const rateRows = Array.from(byRate.entries()).map(([rt, v]) => ({ rt, ...v })).sort((a, b) => a.rt - b.rt);

  let totTx = 0, totI = 0, totC = 0, totS = 0, totCess = 0;
  const rows: (string | number)[][] = rateRows.map((r) => {
    totTx += r.txval; totI += r.igst; totC += r.cgst; totS += r.sgst; totCess += r.cess;
    return [`${r.rt}%`, r.txval, r.igst, r.cgst, r.sgst, r.cess, r.igst + r.cgst + r.sgst + r.cess];
  });
  if (nilValue) {
    rows.push(['Nil Rated / Exempt / Non-GST', nilValue, 0, 0, 0, 0, 0]);
    totTx += nilValue;
  }
  rows.push(['TOTAL', totTx, totI, totC, totS, totCess, totI + totC + totS + totCess]);

  return {
    title: 'GSTR-1 Rate Wise Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ${sourceNote(source)}`,
    headers: ['Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `GSTR1_Rate_Wise_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [22, 18, 14, 14, 14, 12, 14],
  };
};

// ─────────────────── REPORT 2: Summary ────────────────────────────────────

export const buildGstr1SummaryReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { client, gstr1, source } = await fetchGstr1Row(clientId, month);
  const summary = buildGstr1Summary(gstr1.raw_json);

  const rows: (string | number)[][] = summary.sections.map((s) => [
    s.code, s.title, s.docType, s.count, s.value, s.igst, s.cgst, s.sgst, s.cess, s.igst + s.cgst + s.sgst + s.cess,
  ]);
  rows.push([
    '', 'TOTAL (liability-bearing tables only — HSN and Documents Issued are memo rows above, excluded here)', '', '',
    summary.totals.value, summary.totals.igst, summary.totals.cgst, summary.totals.sgst, summary.totals.cess,
    summary.totals.igst + summary.totals.cgst + summary.totals.sgst + summary.totals.cess,
  ]);

  return {
    title: 'GSTR-1 Summary Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ${sourceNote(source)}`,
    headers: ['Table', 'Description', 'Doc Type', 'Count', 'Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `GSTR1_Summary_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [8, 60, 12, 10, 16, 14, 14, 14, 12, 14],
  };
};

// ─────────────────── REPORT 3: HSN Summary ────────────────────────────────

export const buildGstr1HsnSummaryReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { client, gstr1, source } = await fetchGstr1Row(clientId, month);
  const j = gstr1.raw_json || {};
  // Same dual-shape handling as buildGstr1Summary.ts: older imports carry
  // hsn.data, newer ones split hsn.hsn_b2b / hsn.hsn_b2c.
  const hsnRowsRaw: any[] = j.hsn?.data ? j.hsn.data : [...(j.hsn?.hsn_b2b || []), ...(j.hsn?.hsn_b2c || [])];
  const sorted = [...hsnRowsRaw].sort((a, b) => String(a.hsn_sc || '').localeCompare(String(b.hsn_sc || '')));

  let totQty = 0, totTx = 0, totI = 0, totC = 0, totS = 0, totCess = 0;
  const rows: (string | number)[][] = sorted.map((h) => {
    const qty = num(h.qty), tx = num(h.txval), i = num(h.iamt), c = num(h.camt), s = num(h.samt), cess = num(h.csamt);
    totQty += qty; totTx += tx; totI += i; totC += c; totS += s; totCess += cess;
    return [h.hsn_sc || '—', h.desc || '', h.uqc || '—', qty, `${num(h.rt)}%`, tx, i, c, s, cess, i + c + s + cess];
  });
  rows.push(['', 'TOTAL', '', totQty, '', totTx, totI, totC, totS, totCess, totI + totC + totS + totCess]);

  return {
    title: 'GSTR-1 HSN Summary Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ${sourceNote(source)}`,
    headers: ['HSN/SAC', 'Description', 'UQC', 'Qty', 'Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `GSTR1_HSN_Summary_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [12, 30, 8, 10, 8, 16, 14, 14, 14, 12, 14],
  };
};

// ─────────────────── REPORT 4: Customer Wise ──────────────────────────────

export const buildGstr1CustomerWiseReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { client, gstr1, source } = await fetchGstr1Row(clientId, month);
  const { rowsBySection } = hydrateManualEntriesFromJson(gstr1.raw_json);

  interface Agg { count: number; txval: number; igst: number; cgst: number; sgst: number; cess: number; docKeys: Set<string>; }
  const byGstin = new Map<string, Agg>();
  const bump = (ctin: unknown, docKey: string, txval: number, igst: number, cgst: number, sgst: number, cess: number) => {
    const gstin = String(ctin || '').trim();
    if (!gstin) return;
    const cur = byGstin.get(gstin) || { count: 0, txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, docKeys: new Set() };
    if (!cur.docKeys.has(docKey)) { cur.docKeys.add(docKey); cur.count += 1; }
    cur.txval += txval; cur.igst += igst; cur.cgst += cgst; cur.sgst += sgst; cur.cess += cess;
    byGstin.set(gstin, cur);
  };

  // Registered (B2B) counterparties only — B2CL/B2CS/CDNUR/EXP address the
  // recipient by place-of-supply, not GSTIN, so there's no customer to
  // group them under.
  (rowsBySection.b2b || []).forEach((r) => bump(r.ctin, `inv:${r.inum}`, num(r.txval), num(r.iamt), num(r.camt), num(r.samt), num(r.csamt)));
  (rowsBySection.cdnr || []).forEach((r) => {
    const sign = noteSign(r.ntTyp);
    bump(r.ctin, `nt:${r.ntNum}`, sign * num(r.txval), sign * num(r.iamt), sign * num(r.camt), sign * num(r.samt), sign * num(r.csamt));
  });

  const sortedGstins = Array.from(byGstin.keys()).sort();
  let totCount = 0, totTx = 0, totI = 0, totC = 0, totS = 0, totCess = 0;
  const rows: (string | number)[][] = sortedGstins.map((gstin, idx) => {
    const a = byGstin.get(gstin)!;
    totCount += a.count; totTx += a.txval; totI += a.igst; totC += a.cgst; totS += a.sgst; totCess += a.cess;
    return [idx + 1, gstin, a.count, a.txval, a.igst, a.cgst, a.sgst, a.cess, a.igst + a.cgst + a.sgst + a.cess];
  });
  rows.push(['', 'TOTAL', totCount, totTx, totI, totC, totS, totCess, totI + totC + totS + totCess]);

  return {
    title: 'GSTR-1 Customer Wise Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Registered (B2B) customers only — the GSTR-1 JSON doesn't carry counterparty trade names   |   ${sourceNote(source)}`,
    headers: ['Sr No.', 'Customer GSTIN', 'Document Count', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `GSTR1_Customer_Wise_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [6, 20, 12, 16, 14, 14, 14, 12, 14],
  };
};

// ─────────────────── REPORT 5: Error Log ──────────────────────────────────

interface UploadErrorRow { invoiceNo?: string; gstin?: string; reason: string; }

// GSTN's upload/error-report responses can include a row for every
// submitted record, not just the rejected ones — accepted records show up
// with placeholder fields like reason "NA NA NA". Same filter GSTR1DataPage
// applies before rendering the on-screen error list.
const isPlaceholderReason = (reason?: string | null) => {
  const trimmed = (reason || '').trim();
  if (!trimmed) return true;
  return trimmed.split(/\s+/).every((token) => /^n\/?a$/i.test(token));
};

export const buildGstr1ErrorLogReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const shortMonth = mmYyyyToShort(month);
  const [clientRes, versionsRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle(),
    supabase.from('gstr1_upload_versions').select('*').eq('client_id', clientId).eq('period_month', shortMonth).order('version_number', { ascending: true }),
  ]);
  const client: ClientLite = (clientRes.data || { id: clientId, name: 'Unknown', gstin: '' }) as any;
  const versions = versionsRes.data || [];
  if (versions.length === 0) {
    throw new Error(`No GSTR-1 upload history for ${client.name} in ${formatMonthLabel(month)}.`);
  }

  const rows: (string | number)[][] = [];
  versions.forEach((v: any) => {
    const errors = ((v.errors as UploadErrorRow[] | null) || []).filter((e) => !isPlaceholderReason(e.reason));
    const when = v.action_at ? new Date(v.action_at).toLocaleString('en-IN') : '—';
    if (errors.length === 0) {
      rows.push([v.version_number, v.action_type || '—', when, v.status || '—', '—', '—', 'No errors']);
    } else {
      errors.forEach((e) => rows.push([v.version_number, v.action_type || '—', when, v.status || '—', e.invoiceNo || '—', e.gstin || '—', e.reason]));
    }
  });

  return {
    title: 'GSTR-1 Error Log',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}`,
    headers: ['Version', 'Action', 'Date/Time', 'Status', 'Invoice No.', 'GSTIN', 'Reason'],
    rows,
    fileNameBase: `GSTR1_Error_Log_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [8, 14, 22, 14, 16, 20, 44],
  };
};

// ────────────── REPORT 6: P.Y. Invoice Showing in C.Y. ───────────────────

// Indian FY (Apr-Mar) start year for an ISO (YYYY-MM-DD) date, as produced
// by gstr1ManualBuild's fromPortalDate conversion.
const fyStartYearOfIso = (isoDate: string): number | null => {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]), monthNum = Number(m[2]);
  return monthNum >= 4 ? year : year - 1;
};

export const buildGstr1PyInCyReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { client, gstr1, source } = await fetchGstr1Row(clientId, month);
  const { rowsBySection } = hydrateManualEntriesFromJson(gstr1.raw_json);

  const [mm, yyyy] = month.split('/').map(Number);
  const periodFy = mm >= 4 ? yyyy : yyyy - 1;

  interface FlagRow { section: string; partyRef: string; docNo: string; docDate: string; txval: number; totalTax: number; }
  const flagged: FlagRow[] = [];
  const check = (section: string, partyRef: unknown, docNo: unknown, isoDate: unknown, txval: number, igst: number, cgst: number, sgst: number, cess: number) => {
    const invFy = fyStartYearOfIso(String(isoDate || ''));
    if (invFy == null || invFy >= periodFy) return;
    flagged.push({ section, partyRef: String(partyRef || '—'), docNo: String(docNo || '—'), docDate: String(isoDate), txval, totalTax: igst + cgst + sgst + cess });
  };

  (rowsBySection.b2b || []).forEach((r) => check('B2B', r.ctin, r.inum, r.idt, num(r.txval), num(r.iamt), num(r.camt), num(r.samt), num(r.csamt)));
  (rowsBySection.b2cl || []).forEach((r) => check('B2CL', r.pos, r.inum, r.idt, num(r.txval), num(r.iamt), 0, 0, num(r.csamt)));
  (rowsBySection.cdnr || []).forEach((r) => check('CDNR', r.ctin, r.ntNum, r.ntDt, num(r.txval), num(r.iamt), num(r.camt), num(r.samt), num(r.csamt)));
  (rowsBySection.cdnur || []).forEach((r) => check('CDNUR', r.pos, r.ntNum, r.ntDt, num(r.txval), num(r.iamt), 0, 0, num(r.csamt)));
  (rowsBySection.exp || []).forEach((r) => check('EXP', '—', r.inum, r.idt, num(r.txval), num(r.iamt), 0, 0, num(r.csamt)));

  flagged.sort((a, b) => a.docDate.localeCompare(b.docDate));

  const rows: (string | number)[][] = flagged.map((f, idx) => [idx + 1, f.section, f.partyRef, f.docNo, f.docDate, f.txval, f.totalTax]);
  if (rows.length === 0) {
    rows.push(['—', 'No previous-year-dated invoices/notes found in this period\'s GSTR-1.', '', '', '', '', '']);
  }

  return {
    title: 'GSTR-1 — P.Y. Invoice Showing in C.Y.',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Return Period: ${formatMonthLabel(month)} (FY ${periodFy}-${String(periodFy + 1).slice(-2)})   |   ${sourceNote(source)}`,
    headers: ['Sr No.', 'Section', 'GSTIN / POS', 'Doc No.', 'Doc Date', 'Taxable Value', 'Total Tax'],
    rows,
    fileNameBase: `GSTR1_PY_in_CY_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [6, 10, 18, 16, 12, 16, 14],
  };
};
