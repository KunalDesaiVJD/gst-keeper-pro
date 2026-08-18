// 8 reports across 3 categories — Notice & Order, Refund, DRC-03 — reading
// gst_notices / gst_refund_applications / gst_drc03_filings.
//
// An extension pull now exists for all three (content.js handleNotices /
// handleNoticesAdditional / handleRefund / handleDrc03, triggered from the
// PortalComplianceCard on Edit Client) — but UNVERIFIED against the real
// portal. Notices & Orders, Refund and DRC-03 are portal pages this codebase
// had never scraped before, with no existing proven handler to mirror the
// way GSTR-2A could mirror GSTR-2B's tile-and-download flow, so the
// navigation and table-column selectors are a best-effort guess, not a
// confirmed match. Each step banners loudly and leaves a debugPanel dump if
// the expected page/table isn't found, rather than silently saving nothing
// or the wrong columns — if a pull fails, check that panel and correct the
// selectors in content.js. Until then, these reports work the moment their
// table has rows by direct entry (e.g. via Supabase) same as before.

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

export const buildRefundFiledOnPortalReport = async (clientId: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data, error } = await supabase
    .from('gst_refund_applications')
    .select('arn, refund_type, filed_date, claimed_amount, sanctioned_amount, status')
    .eq('client_id', clientId)
    .order('filed_date', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No refund applications on record for ${client.name}. This report has no automated portal pull yet — enter records directly, or check back once the extension's Refund pull is verified against the real portal.`);
  }

  let totClaimed = 0, totSanctioned = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    totClaimed += num(r.claimed_amount); totSanctioned += num(r.sanctioned_amount);
    return [r.arn || '—', r.refund_type || '—', r.filed_date || '—', num(r.claimed_amount), num(r.sanctioned_amount), r.status || '—'];
  });
  tableRows.push(['', 'TOTAL', '', totClaimed, totSanctioned, '']);

  return {
    title: 'Refund Filed On Portal',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   All periods on record, most recent first`,
    headers: ['ARN', 'Refund Type', 'Filed Date', 'Claimed Amount', 'Sanctioned Amount', 'Status'],
    rows: tableRows,
    fileNameBase: `Refund_Filed_On_Portal_${fileSafe(client.name)}`,
    columnWidths: [18, 20, 12, 16, 18, 14],
  };
};

const buildRefundByLedgerReport = async (clientId: string, ledger: 'ITC' | 'Cash', title: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data, error } = await supabase
    .from('gst_refund_applications')
    .select('arn, refund_type, filed_date, claimed_amount, sanctioned_amount, status')
    .eq('client_id', clientId).eq('source_ledger', ledger)
    .order('filed_date', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No ${ledger}-ledger refund applications on record for ${client.name}. This report has no automated portal pull yet — enter records directly, or check back once the extension's Refund pull is verified against the real portal.`);
  }

  let totClaimed = 0, totSanctioned = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    totClaimed += num(r.claimed_amount); totSanctioned += num(r.sanctioned_amount);
    return [r.arn || '—', r.refund_type || '—', r.filed_date || '—', num(r.claimed_amount), num(r.sanctioned_amount), r.status || '—'];
  });
  tableRows.push(['', 'TOTAL', '', totClaimed, totSanctioned, '']);

  return {
    title,
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Refunds claimed from the ${ledger} ledger, most recent first`,
    headers: ['ARN', 'Refund Type', 'Filed Date', 'Claimed Amount', 'Sanctioned Amount', 'Status'],
    rows: tableRows,
    fileNameBase: `${fileSafe(title)}_${fileSafe(client.name)}`,
    columnWidths: [18, 20, 12, 16, 18, 14],
  };
};

export const buildRefundClaimedFromItcLedgerReport = (clientId: string) => buildRefundByLedgerReport(clientId, 'ITC', 'Refund Claimed From ITC Ledger');
export const buildRefundClaimedFromCashLedgerReport = (clientId: string) => buildRefundByLedgerReport(clientId, 'Cash', 'Refund Claimed From Cash Ledger');

// ─────────────────── DRC-03 (3 reports) ────────────────────────────────────

export const buildDrc03FiledOnPortalReport = async (clientId: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data, error } = await supabase
    .from('gst_drc03_filings')
    .select('arn, cause_of_payment, filed_date, period_from, period_to, cash_amount, credit_amount, status')
    .eq('client_id', clientId)
    .order('filed_date', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No DRC-03 filings on record for ${client.name}. This report has no automated portal pull yet — enter records directly, or check back once the extension's DRC-03 pull is verified against the real portal.`);
  }

  let totCash = 0, totCredit = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    totCash += num(r.cash_amount); totCredit += num(r.credit_amount);
    return [r.arn || '—', r.cause_of_payment || '—', r.filed_date || '—', `${r.period_from || '—'} to ${r.period_to || '—'}`, num(r.cash_amount), num(r.credit_amount), r.status || '—'];
  });
  tableRows.push(['', 'TOTAL', '', '', totCash, totCredit, '']);

  return {
    title: 'DRC-03 Filed On Portal',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   All periods on record, most recent first`,
    headers: ['ARN', 'Cause of Payment', 'Filed Date', 'Period', 'Cash Amount', 'Credit Amount', 'Status'],
    rows: tableRows,
    fileNameBase: `DRC03_Filed_On_Portal_${fileSafe(client.name)}`,
    columnWidths: [18, 24, 12, 18, 16, 16, 14],
  };
};

const buildDrc03VoluntaryPaymentReport = async (clientId: string, head: 'cash' | 'credit', title: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const column = head === 'cash' ? 'cash_amount' : 'credit_amount';
  const { data, error } = await supabase
    .from('gst_drc03_filings')
    .select('arn, cause_of_payment, filed_date, period_from, period_to, cash_amount, credit_amount, status')
    .eq('client_id', clientId).gt(column, 0)
    .order('filed_date', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No voluntary DRC-03 payments from the ${head} ledger on record for ${client.name}. This report has no automated portal pull yet — enter records directly, or check back once the extension's DRC-03 pull is verified against the real portal.`);
  }

  let tot = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    const amt = num(head === 'cash' ? r.cash_amount : r.credit_amount);
    tot += amt;
    return [r.arn || '—', r.cause_of_payment || '—', r.filed_date || '—', `${r.period_from || '—'} to ${r.period_to || '—'}`, amt, r.status || '—'];
  });
  tableRows.push(['', 'TOTAL', '', '', tot, '']);

  return {
    title,
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Voluntary DRC-03 payments discharged from the ${head === 'cash' ? 'Cash' : 'Credit'} ledger`,
    headers: ['ARN', 'Cause of Payment', 'Filed Date', 'Period', head === 'cash' ? 'Cash Amount' : 'Credit Amount', 'Status'],
    rows: tableRows,
    fileNameBase: `${fileSafe(title)}_${fileSafe(client.name)}`,
    columnWidths: [18, 24, 12, 18, 16, 14],
  };
};

export const buildDrc03VoluntaryCashLedgerReport = (clientId: string) => buildDrc03VoluntaryPaymentReport(clientId, 'cash', 'Voluntary Payment Of Cash Ledger');
export const buildDrc03VoluntaryCreditLedgerReport = (clientId: string) => buildDrc03VoluntaryPaymentReport(clientId, 'credit', 'Voluntary Payment Of Credit Ledger');
