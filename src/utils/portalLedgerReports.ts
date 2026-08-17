// The 3 remaining Ledger reports. Credit Ledger (full transaction detail —
// distinct from the existing opening-balance-only "Credit Ledger — All
// Clients"/"— One Client" reports on this Hub) is HIGH confidence: it reads
// gst_credit_ledger_transactions, populated by extending the already-proven
// handleLedger extension flow (see content.js — readLedgerRows() was
// already scraping every row, just not persisting it). Liability Ledger and
// Cash Ledger read tables that exist but have NO automated pull yet — same
// "schema + report first, unverified portal page later" reasoning as the
// Notice/Refund/DRC-03 batch.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { fyMonthsForKey, formatMonthLabel } from './allClientsReports';

interface ClientLite { id: string; name: string; gstin: string; }

const fileSafe = (s: string) => s.replace(/\s+/g, '_');
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const fetchClient = async (clientId: string): Promise<ClientLite> => {
  const { data } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  return (data || { id: clientId, name: 'Unknown', gstin: '' }) as ClientLite;
};

// ─────────────────── Credit Ledger (full transaction detail) ──────────────

export const buildCreditLedgerTransactionsReport = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  const { data, error } = await supabase
    .from('gst_credit_ledger_transactions')
    .select('period_month, is_debit, description, igst, cgst, sgst')
    .eq('client_id', clientId).in('period_month', months)
    .order('period_month', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No credit-ledger transaction detail on record for ${client.name} in ${fyLabel}. Run a ledger "Pull from portal" for these months first — it now saves every transaction row, not just the opening balance.`);
  }

  let totI = 0, totC = 0, totS = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    const i = num(r.igst), c = num(r.cgst), s = num(r.sgst);
    if (r.is_debit) { totI -= i; totC -= c; totS -= s; } else { totI += i; totC += c; totS += s; }
    return [formatMonthLabel(r.period_month), r.is_debit ? 'Debit' : 'Credit', r.description || '—', i, c, s];
  });
  tableRows.push(['', '', 'NET (Credit − Debit)', totI, totC, totS]);

  return {
    title: 'Credit Ledger (Transaction Detail)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   Every transaction row from the portal's Electronic Credit Ledger, not just the opening balance the other Credit Ledger reports use.`,
    headers: ['Month', 'Type', 'Description', 'IGST', 'CGST', 'SGST'],
    rows: tableRows,
    fileNameBase: `Credit_Ledger_Detail_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [14, 10, 40, 14, 14, 14],
  };
};

// ─────────────────── Liability Ledger ──────────────────────────────────────

export const buildLiabilityLedgerReport = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  const { data, error } = await supabase
    .from('gst_liability_ledger_entries')
    .select('period_month, entry_date, description, is_debit, igst, cgst, sgst, cess, balance')
    .eq('client_id', clientId).in('period_month', months)
    .order('entry_date', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No Liability Ledger entries on record for ${client.name} in ${fyLabel}. This report has no automated portal pull yet — enter records directly, or check back once the extension's Liability Ledger pull is verified against the real portal.`);
  }

  const tableRows: (string | number)[][] = rows.map((r) => [
    r.entry_date || '—', r.description || '—', r.is_debit ? 'Debit' : 'Credit',
    num(r.igst), num(r.cgst), num(r.sgst), num(r.cess), num(r.balance),
  ]);

  return {
    title: 'Liability Ledger',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}`,
    headers: ['Date', 'Description', 'Type', 'IGST', 'CGST', 'SGST', 'Cess', 'Balance'],
    rows: tableRows,
    fileNameBase: `Liability_Ledger_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [12, 34, 10, 14, 14, 14, 12, 14],
  };
};

// ─────────────────── Cash Ledger ───────────────────────────────────────────

export const buildCashLedgerReport = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  const { data, error } = await supabase
    .from('gst_cash_ledger_entries')
    .select('period_month, entry_date, description, is_debit, igst, cgst, sgst, cess, balance')
    .eq('client_id', clientId).in('period_month', months)
    .order('entry_date', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No Cash Ledger entries on record for ${client.name} in ${fyLabel}. This report has no automated portal pull yet — enter records directly, or check back once the extension's Cash Ledger pull is verified against the real portal.`);
  }

  const tableRows: (string | number)[][] = rows.map((r) => [
    r.entry_date || '—', r.description || '—', r.is_debit ? 'Debit' : 'Credit',
    num(r.igst), num(r.cgst), num(r.sgst), num(r.cess), num(r.balance),
  ]);

  return {
    title: 'Cash Ledger',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}`,
    headers: ['Date', 'Description', 'Type', 'IGST', 'CGST', 'SGST', 'Cess', 'Balance'],
    rows: tableRows,
    fileNameBase: `Cash_Ledger_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [12, 34, 10, 14, 14, 14, 12, 14],
  };
};
