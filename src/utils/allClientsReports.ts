// Cross-client and per-client closing-balance reports.
//
// Four exports:
//   • generateSuspendedClosingAllClientsExcel(month)
//   • generateCreditClosingAllClientsExcel(month)
//   • generateSuspendedClosingPerClientExcel(clientId, fyStartMonth)
//   • generateCreditClosingPerClientExcel(clientId, fyStartMonth)
//
// Each report fetches its source tables in a small number of batched queries
// (filtered by period_month or client_id) and joins them in-memory. Closing
// math stays in lock-step with the on-screen formulas: change them here too
// if you change them on SuspendedRecoPage or GstReceivableRecoPage.

import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { computeGstr1OutputTax } from './computeGstr1OutputTax';

interface ClientRow { id: string; name: string; gstin: string; }

// ─────────────── Shared helpers ──────────────────────────────────────────

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const mmYyyyToShort = (mmYyyy: string): string => {
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  if (!mm || !yyyy) return '';
  return `${MONTH_SHORT[mm - 1]}-${String(yyyy).slice(-2)}`;
};

const formatMonthLabel = (mmYyyy: string): string => {
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  if (!mm || !yyyy) return mmYyyy;
  return `${MONTH_SHORT[mm - 1]} ${yyyy}`;
};

const safeNum = (v: any): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Credit Ledger reconciliation only exists from Jun-26 onward — same cutoff
// the GstReceivableRecoPage applies. Reports must enforce this so old months
// don't get a misleading "0 + 4A − 4B + 4D − Output" number when there is
// genuinely no portal opening balance to compare against.
const CREDIT_RECO_FROM = 202606; // YYYY * 100 + MM
const monthSortKey = (mmYyyy: string): number => {
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  if (!mm || !yyyy) return 0;
  return yyyy * 100 + mm;
};

// Indian FY (Apr-Mar) containing the given MM/YYYY. Returns ordered list of
// 12 month keys (Apr first, Mar last).
export const fyMonthsForKey = (mmYyyy: string): { fyLabel: string; months: string[] } => {
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  const startYear = mm >= 4 ? yyyy : yyyy - 1;
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIdx = ((3 + i) % 12) + 1;       // 4..12,1,2,3
    const year = i >= 9 ? startYear + 1 : startYear;
    months.push(`${String(monthIdx).padStart(2, '0')}/${year}`);
  }
  return { fyLabel: `FY ${startYear}-${String(startYear + 1).slice(-2)}`, months };
};

// ─────────── Suspended Reco math (matches SuspendedRecoPage) ────────────

const getMonthPatterns = (monthStr: string) => {
  const [monthNum, year] = monthStr.split('/');
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return {
    monthName: monthNames[parseInt(monthNum) - 1] || '',
    yearShort: year?.slice(-2) || '',
    yearSingle: year?.slice(-1) || '',
    fullYear: year || '',
    monthNum,
  };
};

const monthMatchesFn = (storedMonth: string | null, patterns: ReturnType<typeof getMonthPatterns>): boolean => {
  if (!storedMonth) return false;
  const stored = storedMonth.toLowerCase().trim();
  const hasMonth = stored.includes(patterns.monthName);
  const hasYear = stored.includes(patterns.yearShort) || stored.includes(patterns.yearSingle) || stored.includes(patterns.fullYear);
  return hasMonth && hasYear;
};

const sumSection = (rows: any[]): { cgst: number; sgst: number; igst: number } =>
  (rows || []).reduce(
    (acc, r) => ({
      cgst: acc.cgst + safeNum(r?.cgst),
      sgst: acc.sgst + safeNum(r?.sgst),
      igst: acc.igst + safeNum(r?.igst),
    }),
    { cgst: 0, sgst: 0, igst: 0 }
  );

// Closing per books for Suspended Reco — sum of bills_not_in_2b rows for the
// period where the bill has a reversal_month set but no reclaim_month yet
// (i.e. still suspended at month-end).
const computeSuspendedBooksClosing = (bills: any[]) => {
  const suspended = bills.filter(b => !!b.reversal_month && !b.reclaim_month);
  return suspended.reduce(
    (acc, b) => ({
      cgst: acc.cgst + safeNum(b.input_cgst),
      sgst: acc.sgst + safeNum(b.input_sgst),
      igst: acc.igst + safeNum(b.input_igst),
    }),
    { cgst: 0, sgst: 0, igst: 0 }
  );
};

// ─────────── Credit Ledger math (matches GstReceivableRecoPage) ─────────

interface CreditClosing { closingCgst: number; closingSgst: number; closingIgst: number; payableCgst: number; payableSgst: number; payableIgst: number; }

const computeCreditClosing = (
  gr: any | undefined,
  itc: any | undefined,
  rawJson: any | undefined,
): CreditClosing => {
  const openingCgst = safeNum(gr?.opening_cgst);
  const openingSgst = safeNum(gr?.opening_sgst);
  const openingIgst = safeNum(gr?.opening_igst);
  const availed = itc ? sumSection(itc.section4A) : { cgst: 0, sgst: 0, igst: 0 };
  const reversed = itc ? sumSection(itc.section4B) : { cgst: 0, sgst: 0, igst: 0 };
  const reclaimed = itc ? sumSection(itc.section4D) : { cgst: 0, sgst: 0, igst: 0 };
  const output = rawJson ? computeGstr1OutputTax(rawJson) : { igst: 0, cgst: 0, sgst: 0 };
  const availableCgst = Math.max(0, openingCgst + availed.cgst - reversed.cgst + reclaimed.cgst);
  const availableSgst = Math.max(0, openingSgst + availed.sgst - reversed.sgst + reclaimed.sgst);
  const availableIgst = Math.max(0, openingIgst + availed.igst - reversed.igst + reclaimed.igst);
  return {
    closingCgst: availableCgst - Math.min(availableCgst, output.cgst),
    closingSgst: availableSgst - Math.min(availableSgst, output.sgst),
    closingIgst: availableIgst - Math.min(availableIgst, output.igst),
    payableCgst: Math.max(0, output.cgst - availableCgst),
    payableSgst: Math.max(0, output.sgst - availableSgst),
    payableIgst: Math.max(0, output.igst - availableIgst),
  };
};

// ─────────── Shared structure: { title, headers, rows, fileNameBase } ────

export interface ReportTable {
  title: string;
  subtitle: string;
  headers: string[];
  rows: (string | number)[][];
  fileNameBase: string;
  columnWidths: number[]; // for Excel sheet sizing
}

// ─────────────────── REPORT 1: Suspended — All Clients ───────────────────

export const buildSuspendedClosingAllClients = async (month: string): Promise<ReportTable> => {
  const [clientsRes, billsRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').order('name'),
    supabase
      .from('bills_not_in_2b')
      .select('client_id, input_cgst, input_sgst, input_igst, reversal_month, reclaim_month')
      .eq('period_month', month),
  ]);

  const clients: ClientRow[] = (clientsRes.data || []) as any;
  const billsByClient = new Map<string, any[]>();
  (billsRes.data || []).forEach((b: any) => {
    const arr = billsByClient.get(b.client_id) || [];
    arr.push(b);
    billsByClient.set(b.client_id, arr);
  });

  const rows = clients.map((client, idx) => {
    const bills = billsByClient.get(client.id) || [];
    const closing = computeSuspendedBooksClosing(bills);
    return [
      idx + 1,
      client.name,
      client.gstin || '',
      closing.cgst,
      closing.sgst,
      closing.igst,
      closing.cgst + closing.sgst + closing.igst,
    ];
  });

  return {
    title: 'Suspended Ledger — Closing Balance — All Clients',
    subtitle: `Month: ${formatMonthLabel(month)}`,
    headers: ['Sr No.', 'Client Name', 'GSTIN', 'CGST', 'SGST', 'IGST', 'TOTAL'],
    rows,
    fileNameBase: `Suspended_Ledger_All_Clients_${month.replace('/', '-')}`,
    columnWidths: [6, 35, 18, 16, 16, 16, 16],
  };
};

// ─────────────────── REPORT 2: Credit — All Clients ──────────────────────

export const buildCreditClosingAllClients = async (month: string): Promise<ReportTable> => {
  if (monthSortKey(month) < CREDIT_RECO_FROM) {
    throw new Error('Credit Ledger reconciliation is available from Jun-26 onward only. Pick Jun-26 or later.');
  }
  const shortMonth = mmYyyyToShort(month);
  const [clientsRes, grRes, itcRes, gstr1Res] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').order('name'),
    supabase.from('gst_receivable_reco' as any).select('*').eq('period_month', month),
    supabase.from('itc_summaries').select('client_id, data').eq('period_month', month),
    supabase.from('gstr1_data').select('client_id, raw_json').eq('period_month', shortMonth),
  ]);

  const clients: ClientRow[] = (clientsRes.data || []) as any;
  const grByClient = new Map<string, any>();
  ((grRes.data as any) || []).forEach((r: any) => grByClient.set(r.client_id, r));
  const itcByClient = new Map<string, any>();
  (itcRes.data || []).forEach((r: any) => itcByClient.set(r.client_id, r.data));
  const gstr1ByClient = new Map<string, any>();
  (gstr1Res.data || []).forEach((r: any) => gstr1ByClient.set(r.client_id, r.raw_json));

  const rows = clients.map((client, idx) => {
    const c = computeCreditClosing(grByClient.get(client.id), itcByClient.get(client.id), gstr1ByClient.get(client.id));
    return [
      idx + 1,
      client.name,
      client.gstin || '',
      c.closingCgst, c.closingSgst, c.closingIgst, c.closingCgst + c.closingSgst + c.closingIgst,
      c.payableCgst, c.payableSgst, c.payableIgst, c.payableCgst + c.payableSgst + c.payableIgst,
    ];
  });

  return {
    title: 'Credit Ledger — Closing Balance — All Clients',
    subtitle: `Month: ${formatMonthLabel(month)}`,
    headers: ['Sr No.', 'Client Name', 'GSTIN', 'CGST', 'SGST', 'IGST', 'TOTAL', 'GST Payable CGST', 'GST Payable SGST', 'GST Payable IGST', 'GST Payable TOTAL'],
    rows,
    fileNameBase: `Credit_Ledger_All_Clients_${month.replace('/', '-')}`,
    columnWidths: [6, 35, 18, 14, 14, 14, 14, 14, 14, 14, 14],
  };
};

// ─────────── REPORT 3: Suspended — Single Client (12 months of FY) ──────

export const buildSuspendedClosingPerClient = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  const [clientRes, billsRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle(),
    supabase
      .from('bills_not_in_2b')
      .select('period_month, input_cgst, input_sgst, input_igst, reversal_month, reclaim_month')
      .eq('client_id', clientId)
      .in('period_month', months),
  ]);

  const client: ClientRow = (clientRes.data || { id: clientId, name: 'Unknown', gstin: '' }) as any;
  const billsByMonth = new Map<string, any[]>();
  (billsRes.data || []).forEach((b: any) => {
    const arr = billsByMonth.get(b.period_month) || [];
    arr.push(b);
    billsByMonth.set(b.period_month, arr);
  });

  let totC = 0, totS = 0, totI = 0;
  const rows: (string | number)[][] = months.map((m, idx) => {
    const closing = computeSuspendedBooksClosing(billsByMonth.get(m) || []);
    totC += closing.cgst; totS += closing.sgst; totI += closing.igst;
    return [idx + 1, formatMonthLabel(m), closing.cgst, closing.sgst, closing.igst, closing.cgst + closing.sgst + closing.igst];
  });
  rows.push(['', 'TOTAL', totC, totS, totI, totC + totS + totI]);

  return {
    title: 'Suspended Ledger — Closing Balance — All Months',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}`,
    headers: ['Sr No.', 'Month', 'CGST', 'SGST', 'IGST', 'TOTAL'],
    rows,
    fileNameBase: `Suspended_Ledger_${client.name.replace(/\s+/g, '_')}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [6, 18, 16, 16, 16, 16],
  };
};

// ─────────── REPORT 4: Credit — Single Client (12 months of FY) ─────────

export const buildCreditClosingPerClient = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const { fyLabel, months: allMonths } = fyMonthsForKey(anyMonthInFy);
  // Restrict to months where Credit Ledger reconciliation actually existed
  // (Jun-26+). If the picked FY has no eligible months, refuse the build.
  const months = allMonths.filter(m => monthSortKey(m) >= CREDIT_RECO_FROM);
  if (months.length === 0) {
    throw new Error(`${fyLabel} has no months eligible for Credit Ledger reconciliation (Jun-26 onward only).`);
  }
  const shortMonths = months.map(mmYyyyToShort);

  const [clientRes, grRes, itcRes, gstr1Res] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle(),
    supabase.from('gst_receivable_reco' as any).select('*').eq('client_id', clientId).in('period_month', months),
    supabase.from('itc_summaries').select('period_month, data').eq('client_id', clientId).in('period_month', months),
    supabase.from('gstr1_data').select('period_month, raw_json').eq('client_id', clientId).in('period_month', shortMonths),
  ]);

  const client: ClientRow = (clientRes.data || { id: clientId, name: 'Unknown', gstin: '' }) as any;
  const grByMonth = new Map<string, any>();
  ((grRes.data as any) || []).forEach((r: any) => grByMonth.set(r.period_month, r));
  const itcByMonth = new Map<string, any>();
  (itcRes.data || []).forEach((r: any) => itcByMonth.set(r.period_month, r.data));
  const gstr1ByShort = new Map<string, any>();
  (gstr1Res.data || []).forEach((r: any) => gstr1ByShort.set(r.period_month, r.raw_json));

  let tCl = 0, tCS = 0, tCI = 0, tPC = 0, tPS = 0, tPI = 0;
  const rows: (string | number)[][] = months.map((m, idx) => {
    const c = computeCreditClosing(grByMonth.get(m), itcByMonth.get(m), gstr1ByShort.get(mmYyyyToShort(m)));
    tCl += c.closingCgst; tCS += c.closingSgst; tCI += c.closingIgst;
    tPC += c.payableCgst; tPS += c.payableSgst; tPI += c.payableIgst;
    return [
      idx + 1,
      formatMonthLabel(m),
      c.closingCgst, c.closingSgst, c.closingIgst, c.closingCgst + c.closingSgst + c.closingIgst,
      c.payableCgst, c.payableSgst, c.payableIgst, c.payableCgst + c.payableSgst + c.payableIgst,
    ];
  });
  rows.push(['', 'TOTAL', tCl, tCS, tCI, tCl + tCS + tCI, tPC, tPS, tPI, tPC + tPS + tPI]);

  return {
    title: 'Credit Ledger — Closing Balance — All Months',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}`,
    headers: ['Sr No.', 'Month', 'CGST', 'SGST', 'IGST', 'TOTAL', 'GST Payable CGST', 'GST Payable SGST', 'GST Payable IGST', 'GST Payable TOTAL'],
    rows,
    fileNameBase: `Credit_Ledger_${client.name.replace(/\s+/g, '_')}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [6, 18, 14, 14, 14, 14, 14, 14, 14, 14],
  };
};

// ─────────────────── REPORT 5: Client login credentials ─────────────────

export interface ClientCredentialRow {
  id: string;
  name: string;
  gstin: string | null;
  gst_user_id: string | null;
  gst_password: string | null;
}

// Fetches every client with its GST portal login. Shared by the on-screen
// live table and the Excel/PDF download so both always show the same data.
export const fetchClientCredentials = async (): Promise<ClientCredentialRow[]> => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, gstin, gst_user_id, gst_password')
    .order('name');
  if (error) throw error;
  return (data || []) as ClientCredentialRow[];
};

export const buildClientCredentials = async (): Promise<ReportTable> => {
  const clients = await fetchClientCredentials();
  const rows: (string | number)[][] = clients.map((c, i) => [
    i + 1,
    c.name || '—',
    c.gstin || '—',
    c.gst_user_id || '—',
    c.gst_password || '—',
  ]);
  return {
    title: 'Client Login Credentials',
    subtitle: `Total clients: ${clients.length}`,
    headers: ['#', 'Client Name', 'GSTIN', 'GST User ID', 'GST Password'],
    rows,
    fileNameBase: 'Client_Login_Credentials',
    columnWidths: [6, 42, 22, 22, 22],
  };
};

// ─────────────────── Excel renderer (shared) ─────────────────────────────

export const renderReportToExcel = (report: ReportTable) => {
  const sheetData = [[report.title], [report.subtitle], [], report.headers, ...report.rows];
  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  sheet['!cols'] = report.columnWidths.map(wch => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Report');
  XLSX.writeFile(workbook, `${report.fileNameBase}.xlsx`);
};
