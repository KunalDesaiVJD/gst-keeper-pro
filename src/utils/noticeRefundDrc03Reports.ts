// 8 reports across 3 categories — Notice & Order, Refund, DRC-03 — reading
// gst_notices / gst_refund_applications / gst_drc03_filings.
//
// IMPORTANT: unlike every other Phase-3 table, NO extension automation pulls
// into these three tables yet. Notices & Orders, Refund, and DRC-03 are
// portal pages this codebase has never scraped before, with no existing
// working handler to mirror the way GSTR-2A could mirror GSTR-2B's proven
// tile-and-download flow — writing speculative CSS selectors for pages
// nobody has verified against the real portal risks silently capturing the
// wrong figures into what a firm relies on for compliance reporting, which
// is worse than not automating it at all. These reports are real and will
// work the moment their table has rows — today that means direct entry
// (e.g. via Supabase), tomorrow a verified extension pull once someone
// checks the real portal page structure and wires handleNotices /
// handleRefund / handleDrc03 in content.js the same way handleTwoA was
// wired for GSTR-2A.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';

interface ClientLite { id: string; name: string; gstin: string; }

const fileSafe = (s: string) => s.replace(/\s+/g, '_');
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const fetchClient = async (clientId: string): Promise<ClientLite> => {
  const { data } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  return (data || { id: clientId, name: 'Unknown', gstin: '' }) as ClientLite;
};

// ─────────────────── NOTICE & ORDER (2 reports) ───────────────────────────

const buildNoticesReport = async (clientId: string, source: 'notices' | 'additional_notices', title: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data, error } = await supabase
    .from('gst_notices')
    .select('reference_number, notice_type, description, issue_date, due_date, status')
    .eq('client_id', clientId).eq('source', source)
    .order('issue_date', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No ${title.toLowerCase()} on record for ${client.name}. This report has no automated portal pull yet — enter records directly, or check back once the extension's Notices pull is verified against the real portal.`);
  }

  return {
    title,
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   All periods on record, most recent first`,
    headers: ['Reference No.', 'Type', 'Description', 'Issue Date', 'Due Date', 'Status'],
    rows: rows.map((r) => [r.reference_number || '—', r.notice_type || '—', r.description || '—', r.issue_date || '—', r.due_date || '—', r.status || '—']),
    fileNameBase: `${fileSafe(title)}_${fileSafe(client.name)}`,
    columnWidths: [16, 16, 40, 12, 12, 14],
  };
};

export const buildViewNoticesAndOrdersReport = (clientId: string) => buildNoticesReport(clientId, 'notices', 'View Notice and Orders');
export const buildAdditionalNoticesAndOrdersReport = (clientId: string) => buildNoticesReport(clientId, 'additional_notices', 'Additional Notices and Orders');

// ─────────────────── REFUND (3 reports) ────────────────────────────────────

const REFUND_SELECT = 'arn, refund_type, filed_date, claimed_amount, sanctioned_amount, status, ' +
  'application_pdf_url, query_memo_pdf_url, order_pdf_url';
const REFUND_HEADERS = ['ARN', 'Refund Type', 'Filed Date', 'Claimed Amount', 'Sanctioned Amount', 'Status', 'Application', 'Query Memo', 'Order'];
const REFUND_WIDTHS = [18, 20, 12, 16, 18, 14, 14, 14, 14];

const refundRow = (r: {
  arn: string | null; refund_type: string | null; filed_date: string | null;
  claimed_amount: number | null; sanctioned_amount: number | null; status: string | null;
  application_pdf_url: string | null; query_memo_pdf_url: string | null; order_pdf_url: string | null;
}): (string | number)[] => [
  r.arn || '—', r.refund_type || '—', r.filed_date || '—', num(r.claimed_amount), num(r.sanctioned_amount), r.status || '—',
  r.application_pdf_url || '—', r.query_memo_pdf_url || '—', r.order_pdf_url || '—',
];

export const buildRefundFiledOnPortalReport = async (clientId: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data, error } = await supabase
    .from('gst_refund_applications')
    .select(REFUND_SELECT)
    .eq('client_id', clientId)
    .order('filed_date', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No refund applications on record for ${client.name}. Use Pull to fetch it from the portal.`);
  }

  let totClaimed = 0, totSanctioned = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    totClaimed += num(r.claimed_amount); totSanctioned += num(r.sanctioned_amount);
    return refundRow(r);
  });
  tableRows.push(['', 'TOTAL', '', totClaimed, totSanctioned, '', '', '', '']);

  return {
    title: 'Refund Filed On Portal',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   All periods on record, most recent first`,
    headers: REFUND_HEADERS,
    rows: tableRows,
    fileNameBase: `Refund_Filed_On_Portal_${fileSafe(client.name)}`,
    columnWidths: REFUND_WIDTHS,
  };
};

const buildRefundByLedgerReport = async (clientId: string, ledger: 'ITC' | 'Cash', title: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data, error } = await supabase
    .from('gst_refund_applications')
    .select(REFUND_SELECT)
    .eq('client_id', clientId).eq('source_ledger', ledger)
    .order('filed_date', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No ${ledger}-ledger refund applications on record for ${client.name}. Use Pull (on "Refund Filed On Portal") to fetch it from the portal.`);
  }

  let totClaimed = 0, totSanctioned = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    totClaimed += num(r.claimed_amount); totSanctioned += num(r.sanctioned_amount);
    return refundRow(r);
  });
  tableRows.push(['', 'TOTAL', '', totClaimed, totSanctioned, '', '', '', '']);

  return {
    title,
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Refunds claimed from the ${ledger} ledger, most recent first`,
    headers: REFUND_HEADERS,
    rows: tableRows,
    fileNameBase: `${fileSafe(title)}_${fileSafe(client.name)}`,
    columnWidths: REFUND_WIDTHS,
  };
};

export const buildRefundClaimedFromItcLedgerReport = (clientId: string) => buildRefundByLedgerReport(clientId, 'ITC', 'Refund Claimed From ITC Ledger');
export const buildRefundClaimedFromCashLedgerReport = (clientId: string) => buildRefundByLedgerReport(clientId, 'Cash', 'Refund Claimed From Cash Ledger');

// ─────────────────── DRC-03 (3 reports) ────────────────────────────────────

const DRC03_FULL_SELECT = 'arn, cause_of_payment, filed_date, period_from, period_to, financial_year, section, ' +
  'taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount, interest_amount, late_fee_amount, penalty_amount, ' +
  'cash_amount, credit_amount, status, pdf_url';

const DRC03_FULL_HEADERS = [
  'ARN', 'Cause of Payment', 'Section', 'FY', 'Filed Date', 'Period',
  'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Interest', 'Late Fee', 'Penalty',
  'Cash Amount', 'Credit Amount', 'Status', 'PDF',
];
const DRC03_FULL_WIDTHS = [18, 30, 10, 10, 12, 18, 14, 12, 12, 12, 10, 12, 12, 12, 14, 14, 16, 30];

// Every DRC-03 report row, in the shared column order above. cash/credit
// amounts follow the extension's documented limitation: a line whose ldgrut
// was the unsplittable "Cash/Credit" lands entirely in cash_amount, so
// credit_amount can understate DRC-03s that were part of a split payment.
const drc03Row = (r: {
  arn: string | null; cause_of_payment: string | null; section: string | null; financial_year: string | null;
  filed_date: string | null; period_from: string | null; period_to: string | null;
  taxable_value: number | null; igst_amount: number | null; cgst_amount: number | null; sgst_amount: number | null;
  cess_amount: number | null; interest_amount: number | null; late_fee_amount: number | null; penalty_amount: number | null;
  cash_amount: number | null; credit_amount: number | null; status: string | null; pdf_url: string | null;
}): (string | number)[] => [
  r.arn || '—', r.cause_of_payment || '—', r.section || '—', r.financial_year || '—',
  r.filed_date || '—', `${r.period_from || '—'} to ${r.period_to || '—'}`,
  num(r.taxable_value), num(r.igst_amount), num(r.cgst_amount), num(r.sgst_amount), num(r.cess_amount),
  num(r.interest_amount), num(r.late_fee_amount), num(r.penalty_amount),
  num(r.cash_amount), num(r.credit_amount), r.status || '—', r.pdf_url || '—',
];

export const buildDrc03FiledOnPortalReport = async (clientId: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data, error } = await supabase
    .from('gst_drc03_filings')
    .select(DRC03_FULL_SELECT)
    .eq('client_id', clientId)
    .order('filed_date', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No DRC-03 filings on record for ${client.name}. This report has no automated portal pull yet — enter records directly, or check back once the extension's DRC-03 pull is verified against the real portal.`);
  }

  let totTaxable = 0, totIgst = 0, totCgst = 0, totSgst = 0, totCess = 0, totIntr = 0, totFee = 0, totPnlty = 0, totCash = 0, totCredit = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    totTaxable += num(r.taxable_value); totIgst += num(r.igst_amount); totCgst += num(r.cgst_amount); totSgst += num(r.sgst_amount);
    totCess += num(r.cess_amount); totIntr += num(r.interest_amount); totFee += num(r.late_fee_amount); totPnlty += num(r.penalty_amount);
    totCash += num(r.cash_amount); totCredit += num(r.credit_amount);
    return drc03Row(r);
  });
  tableRows.push(['', 'TOTAL', '', '', '', '', totTaxable, totIgst, totCgst, totSgst, totCess, totIntr, totFee, totPnlty, totCash, totCredit, '', '']);

  return {
    title: 'DRC-03 Filed On Portal',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   All periods on record, most recent first`,
    headers: DRC03_FULL_HEADERS,
    rows: tableRows,
    fileNameBase: `DRC03_Filed_On_Portal_${fileSafe(client.name)}`,
    columnWidths: DRC03_FULL_WIDTHS,
  };
};

const buildDrc03VoluntaryPaymentReport = async (clientId: string, head: 'cash' | 'credit', title: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const column = head === 'cash' ? 'cash_amount' : 'credit_amount';
  const { data, error } = await supabase
    .from('gst_drc03_filings')
    .select(DRC03_FULL_SELECT)
    .eq('client_id', clientId).gt(column, 0)
    .order('filed_date', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No voluntary DRC-03 payments from the ${head} ledger on record for ${client.name}. This report has no automated portal pull yet — enter records directly, or check back once the extension's DRC-03 pull is verified against the real portal.`);
  }

  let totTaxable = 0, totIgst = 0, totCgst = 0, totSgst = 0, totCess = 0, totIntr = 0, totFee = 0, totPnlty = 0, totCash = 0, totCredit = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    totTaxable += num(r.taxable_value); totIgst += num(r.igst_amount); totCgst += num(r.cgst_amount); totSgst += num(r.sgst_amount);
    totCess += num(r.cess_amount); totIntr += num(r.interest_amount); totFee += num(r.late_fee_amount); totPnlty += num(r.penalty_amount);
    totCash += num(r.cash_amount); totCredit += num(r.credit_amount);
    return drc03Row(r);
  });
  tableRows.push(['', 'TOTAL', '', '', '', '', totTaxable, totIgst, totCgst, totSgst, totCess, totIntr, totFee, totPnlty, totCash, totCredit, '', '']);

  return {
    title,
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Voluntary DRC-03 payments discharged from the ${head === 'cash' ? 'Cash' : 'Credit'} ledger`,
    headers: DRC03_FULL_HEADERS,
    rows: tableRows,
    fileNameBase: `${fileSafe(title)}_${fileSafe(client.name)}`,
    columnWidths: DRC03_FULL_WIDTHS,
  };
};

export const buildDrc03VoluntaryCashLedgerReport = (clientId: string) => buildDrc03VoluntaryPaymentReport(clientId, 'cash', 'Voluntary Payment Of Cash Ledger');
export const buildDrc03VoluntaryCreditLedgerReport = (clientId: string) => buildDrc03VoluntaryPaymentReport(clientId, 'credit', 'Voluntary Payment Of Credit Ledger');
