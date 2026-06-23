// Bulk reports that aggregate one row per client for a given month.
//
// Each public function is `generate<Name>Report(month)` returning an XLSX
// workbook download. To keep the round-trip count low, each report fetches
// the source tables in a small number of batched queries (filtered by
// period_month) and joins them in-memory by client_id.
//
// The closing-balance math in these reports MUST stay in lock-step with
// SuspendedRecoPage / GstReceivableRecoPage. If you change a formula on the
// page, change it here too.

import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { computeGstr1OutputTax } from './computeGstr1OutputTax';

interface ClientRow {
  id: string;
  name: string;
  gstin: string;
}

// ─────────────── Suspended Reco — month-pattern matching ──────────────────
// Copied from SuspendedRecoPage.fetchData so the bulk report agrees with
// what the page renders for the same (client, month) pair.

const getMonthPatterns = (monthStr: string) => {
  const [monthNum, year] = monthStr.split('/');
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthName = monthNames[parseInt(monthNum) - 1] || '';
  const yearShort = year?.slice(-2) || '';
  const yearSingle = year?.slice(-1) || '';
  return { monthName, yearShort, yearSingle, fullYear: year || '', monthNum };
};

const monthMatchesFn = (storedMonth: string | null, patterns: ReturnType<typeof getMonthPatterns>): boolean => {
  if (!storedMonth) return false;
  const stored = storedMonth.toLowerCase().trim();
  const { monthName, yearShort, yearSingle, fullYear } = patterns;
  const hasMonth = stored.includes(monthName);
  const hasYear = stored.includes(yearShort) || stored.includes(yearSingle) || stored.includes(fullYear);
  return hasMonth && hasYear;
};

const sumSection = (rows: any[]): { cgst: number; sgst: number; igst: number } =>
  (rows || []).reduce(
    (acc, r) => ({
      cgst: acc.cgst + (Number(r?.cgst) || 0),
      sgst: acc.sgst + (Number(r?.sgst) || 0),
      igst: acc.igst + (Number(r?.igst) || 0),
    }),
    { cgst: 0, sgst: 0, igst: 0 }
  );

// ──────────────── MM/YYYY ↔ short-label helpers (gstr1) ───────────────────

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mmYyyyToShort = (mmYyyy: string): string => {
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  if (!mm || !yyyy) return '';
  return `${MONTH_SHORT[mm - 1]}-${String(yyyy).slice(-2)}`;
};

// Human-readable form for the title / file name (e.g. "Jun 2026")
const formatMonthLabel = (mmYyyy: string): string => {
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  if (!mm || !yyyy) return mmYyyy;
  return `${MONTH_SHORT[mm - 1]} ${yyyy}`;
};

const safeNum = (v: any): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// ─────────────────── Suspended Ledger — All Clients ──────────────────────

export const generateSuspendedLedgerReport = async (month: string) => {
  // Pull clients + per-table rows for the month in parallel
  const [clientsRes, srRes, itcRes, billsRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').order('name'),
    supabase.from('suspended_reco').select('*').eq('period_month', month),
    supabase.from('itc_summaries').select('client_id, data').eq('period_month', month),
    supabase
      .from('bills_not_in_2b')
      .select('client_id, input_cgst, input_sgst, input_igst, reversal_month, reclaim_month, reclaim_subtype')
      .eq('period_month', month),
  ]);

  const clients: ClientRow[] = (clientsRes.data || []) as any;
  const srByClient = new Map<string, any>();
  (srRes.data || []).forEach((r: any) => srByClient.set(r.client_id, r));
  const itcByClient = new Map<string, any>();
  (itcRes.data || []).forEach((r: any) => itcByClient.set(r.client_id, r.data));
  const billsByClient = new Map<string, any[]>();
  (billsRes.data || []).forEach((b: any) => {
    const arr = billsByClient.get(b.client_id) || [];
    arr.push(b);
    billsByClient.set(b.client_id, arr);
  });

  const patterns = getMonthPatterns(month);

  const dataRows: (string | number)[][] = clients.map((client, idx) => {
    const sr = srByClient.get(client.id);
    const itc = itcByClient.get(client.id);
    const bills = billsByClient.get(client.id) || [];

    // OPENING from suspended_reco
    const openingCgst = safeNum(sr?.opening_cgst);
    const openingSgst = safeNum(sr?.opening_sgst);
    const openingIgst = safeNum(sr?.opening_igst);

    // 4B(2)(i): reversal bills where reversal_month matches current month
    const matchingReversals = bills.filter(b => monthMatchesFn(b.reversal_month, patterns));
    const row4B2i = matchingReversals.reduce(
      (acc, b) => ({
        cgst: acc.cgst + safeNum(b.input_cgst),
        sgst: acc.sgst + safeNum(b.input_sgst),
        igst: acc.igst + safeNum(b.input_igst),
      }),
      { cgst: 0, sgst: 0, igst: 0 }
    );

    // 5.4: reclaim bills where reclaim_month matches current month, excluding EXPENSE_OUT
    const normalReclaims = bills.filter(b => monthMatchesFn(b.reclaim_month, patterns) && b.reclaim_subtype !== 'EXPENSE_OUT');
    const row54 = normalReclaims.reduce(
      (acc, b) => ({
        cgst: acc.cgst + safeNum(b.input_cgst),
        sgst: acc.sgst + safeNum(b.input_sgst),
        igst: acc.igst + safeNum(b.input_igst),
      }),
      { cgst: 0, sgst: 0, igst: 0 }
    );

    // 4B(2)(ii), 5.5, 4(D)(1.2) — from ITC summary
    let row4B2ii = { cgst: 0, sgst: 0, igst: 0 };
    let row55 = { cgst: 0, sgst: 0, igst: 0 };
    let row4D12 = { cgst: 0, sgst: 0, igst: 0 };
    if (itc) {
      const found4B2ii = (itc.section4B || []).find((r: any) =>
        r.srNo === '(ii)' || r.srNo === '4(B)(2)(ii)' ||
        (r.particular && r.particular.includes('ITC Reversal for previous months'))
      );
      if (found4B2ii) row4B2ii = { cgst: safeNum(found4B2ii.cgst), sgst: safeNum(found4B2ii.sgst), igst: safeNum(found4B2ii.igst) };
      const found55 = (itc.section4A || []).find((r: any) => r.srNo === '5.5');
      if (found55) row55 = { cgst: safeNum(found55.cgst), sgst: safeNum(found55.sgst), igst: safeNum(found55.igst) };
      const found4D12 = (itc.section4D || []).find((r: any) => r.srNo === '1.2');
      if (found4D12) row4D12 = { cgst: safeNum(found4D12.cgst), sgst: safeNum(found4D12.sgst), igst: safeNum(found4D12.igst) };
    }

    // Current total = (4B2i + 4B2ii) - (5.4 + 5.5 + 4D1.2)
    const currentCgst = row4B2i.cgst + row4B2ii.cgst - row54.cgst - row55.cgst - row4D12.cgst;
    const currentSgst = row4B2i.sgst + row4B2ii.sgst - row54.sgst - row55.sgst - row4D12.sgst;
    const currentIgst = row4B2i.igst + row4B2ii.igst - row54.igst - row55.igst - row4D12.igst;

    // Books closing — bills where reclaim is blank AND reversal is set
    const bookBills = bills.filter(b => {
      const reversalBlank = !b.reversal_month;
      const reclaimBlank = !b.reclaim_month;
      return reclaimBlank && !reversalBlank;
    });
    const booksTotals = bookBills.reduce(
      (acc, b) => ({
        cgst: acc.cgst + safeNum(b.input_cgst),
        sgst: acc.sgst + safeNum(b.input_sgst),
        igst: acc.igst + safeNum(b.input_igst),
      }),
      { cgst: 0, sgst: 0, igst: 0 }
    );

    // Portal closing = Opening + Current Total
    const portalCgst = openingCgst + currentCgst;
    const portalSgst = openingSgst + currentSgst;
    const portalIgst = openingIgst + currentIgst;

    // Difference: Portal - Books, with the same Rs.10 tolerance as the page
    const tol = (v: number) => (Math.abs(v) <= 10 ? 0 : v);
    const diffCgst = tol(portalCgst - booksTotals.cgst);
    const diffSgst = tol(portalSgst - booksTotals.sgst);
    const diffIgst = tol(portalIgst - booksTotals.igst);

    return [
      idx + 1,
      client.name,
      client.gstin || '',
      portalCgst, portalSgst, portalIgst, portalCgst + portalSgst + portalIgst,
      booksTotals.cgst, booksTotals.sgst, booksTotals.igst, booksTotals.cgst + booksTotals.sgst + booksTotals.igst,
      diffCgst, diffSgst, diffIgst, diffCgst + diffSgst + diffIgst,
    ];
  });

  const sheetData: (string | number)[][] = [
    ['Suspended Ledger — Closing Balance — All Clients'],
    [`Month: ${formatMonthLabel(month)}`],
    [],
    [
      'Sr No.', 'Client Name', 'GSTIN',
      'Portal Closing CGST', 'Portal Closing SGST', 'Portal Closing IGST', 'Portal Closing TOTAL',
      'Books Closing CGST', 'Books Closing SGST', 'Books Closing IGST', 'Books Closing TOTAL',
      'Difference CGST', 'Difference SGST', 'Difference IGST', 'Difference TOTAL',
    ],
    ...dataRows,
  ];

  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  sheet['!cols'] = [
    { wch: 6 }, { wch: 35 }, { wch: 18 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Suspended Ledger');
  XLSX.writeFile(workbook, `Suspended_Ledger_All_Clients_${month.replace('/', '-')}.xlsx`);
};

// ───────────────── Credit Ledger — All Clients (GST Receivable) ──────────

export const generateCreditLedgerReport = async (month: string) => {
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

  const dataRows: (string | number)[][] = clients.map((client, idx) => {
    const gr = grByClient.get(client.id);
    const itc = itcByClient.get(client.id);
    const gstr1 = gstr1ByClient.get(client.id);

    const openingCgst = safeNum(gr?.opening_cgst);
    const openingSgst = safeNum(gr?.opening_sgst);
    const openingIgst = safeNum(gr?.opening_igst);
    const booksCgst = safeNum(gr?.books_closing_cgst);
    const booksSgst = safeNum(gr?.books_closing_sgst);
    const booksIgst = safeNum(gr?.books_closing_igst);

    const availed = itc ? sumSection(itc.section4A) : { cgst: 0, sgst: 0, igst: 0 };
    const reversed = itc ? sumSection(itc.section4B) : { cgst: 0, sgst: 0, igst: 0 };
    const reclaimed = itc ? sumSection(itc.section4D) : { cgst: 0, sgst: 0, igst: 0 };
    const output = gstr1 ? computeGstr1OutputTax(gstr1) : { igst: 0, cgst: 0, sgst: 0 };

    // Same per-head math as the page
    const availableCgst = Math.max(0, openingCgst + availed.cgst - reversed.cgst + reclaimed.cgst);
    const availableSgst = Math.max(0, openingSgst + availed.sgst - reversed.sgst + reclaimed.sgst);
    const availableIgst = Math.max(0, openingIgst + availed.igst - reversed.igst + reclaimed.igst);
    const utilizedCgst = Math.min(availableCgst, output.cgst);
    const utilizedSgst = Math.min(availableSgst, output.sgst);
    const utilizedIgst = Math.min(availableIgst, output.igst);
    const payableCgst = Math.max(0, output.cgst - availableCgst);
    const payableSgst = Math.max(0, output.sgst - availableSgst);
    const payableIgst = Math.max(0, output.igst - availableIgst);
    const portalCgst = availableCgst - utilizedCgst;
    const portalSgst = availableSgst - utilizedSgst;
    const portalIgst = availableIgst - utilizedIgst;

    const tol = (v: number) => (Math.abs(v) <= 10 ? 0 : v);
    const diffCgst = tol(portalCgst - booksCgst);
    const diffSgst = tol(portalSgst - booksSgst);
    const diffIgst = tol(portalIgst - booksIgst);

    return [
      idx + 1,
      client.name,
      client.gstin || '',
      portalCgst, portalSgst, portalIgst, portalCgst + portalSgst + portalIgst,
      booksCgst, booksSgst, booksIgst, booksCgst + booksSgst + booksIgst,
      diffCgst, diffSgst, diffIgst, diffCgst + diffSgst + diffIgst,
      payableCgst, payableSgst, payableIgst, payableCgst + payableSgst + payableIgst,
    ];
  });

  const sheetData: (string | number)[][] = [
    ['Credit Ledger — Closing Balance — All Clients'],
    [`Month: ${formatMonthLabel(month)}`],
    [],
    [
      'Sr No.', 'Client Name', 'GSTIN',
      'Portal Closing CGST', 'Portal Closing SGST', 'Portal Closing IGST', 'Portal Closing TOTAL',
      'Books Closing CGST', 'Books Closing SGST', 'Books Closing IGST', 'Books Closing TOTAL',
      'Difference CGST', 'Difference SGST', 'Difference IGST', 'Difference TOTAL',
      'GST Payable CGST', 'GST Payable SGST', 'GST Payable IGST', 'GST Payable TOTAL',
    ],
    ...dataRows,
  ];

  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  sheet['!cols'] = [
    { wch: 6 }, { wch: 35 }, { wch: 18 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Credit Ledger');
  XLSX.writeFile(workbook, `Credit_Ledger_All_Clients_${month.replace('/', '-')}.xlsx`);
};
