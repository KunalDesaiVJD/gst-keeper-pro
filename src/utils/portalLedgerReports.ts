// The 3 remaining Ledger reports. Credit Ledger (full transaction detail —
// distinct from the existing opening-balance-only "Credit Ledger — All
// Clients"/"— One Client" reports on this Hub) is HIGH confidence: it reads
// gst_credit_ledger_transactions, populated by extending the already-proven
// handleLedger extension flow (see content.js — readLedgerRows() was
// already scraping every row, just not persisting it). Liability Ledger and
// Cash Ledger read tables that exist but have NO automated pull yet — same
// "schema + report first, unverified portal page later" reasoning as the
// Notice/Refund/DRC-03 batch.
//
// Each covers a financial year of monthly pulls, so the rows are put in the
// ledger's own order by ./ledgerOrder (month by month, each month's Opening
// Balance first and Closing Balance last, one day's entries in the order
// their running balances prove), and every row names its month: the tables
// keep no sequence of their own, and a balance row has no date to say which
// month it closes.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { fyMonthsForKey, formatMonthLabel } from './allClientsReports';
import { orderLedger, readCreditLedgerText, type LedgerLine, type LedgerOrderOptions, type UnsettledDay } from './ledgerOrder';

interface ClientLite { id: string; name: string; gstin: string; }

const fileSafe = (s: string) => s.replace(/\s+/g, '_');
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${m[3]}-${MON[+m[2] - 1]}-${m[1]}` : iso;
};

const fetchClient = async (clientId: string): Promise<ClientLite> => {
  const { data } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  return (data || { id: clientId, name: 'Unknown', gstin: '' }) as ClientLite;
};

/**
 * The subtitle's word on days the balances could not order, so a reader
 * cross-checking against the portal knows which days to look at. Empty when
 * every day was settled.
 */
const unsettledNote = (days: UnsettledDay[]): string => {
  if (!days.length) return '';
  const named = days.slice(0, 3).map((d) => dayLabel(d.date)).join(', ');
  return `Same-day order: ${days.length} ${days.length === 1 ? 'day' : 'days'} the running balance does not put in one order (${named}${days.length > 3 ? ', …' : ''}), listed as the portal gave them unless the balances fit another order better`;
};

// ─────────────────── Credit Ledger (full transaction detail) ──────────────

export const buildCreditLedgerTransactionsReport = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  // No order asked of the database: the rows are ordered below, and the order
  // they come back in (as the pull wrote them) is only the last tie-break.
  const { data, error } = await supabase
    .from('gst_credit_ledger_transactions')
    .select('period_month, is_debit, description, igst, cgst, sgst')
    .eq('client_id', clientId).in('period_month', months);
  if (error) throw error;
  const fetched = data || [];
  if (fetched.length === 0) {
    throw new Error(`No credit-ledger transaction detail on record for ${client.name} in ${fyLabel}. Use "Pull" on this report: it fetches every month of the year not yet pulled.`);
  }

  // The scraped row text carries the portal's serial number, date and running
  // balance; they order the rows (the serial first, as the portal printed it).
  const order = orderLedger(fetched.map((r): LedgerLine<typeof r> => {
    const t = readCreditLedgerText(r.description);
    return {
      row: r, period: r.period_month, role: 'entry', date: t.date, isDebit: !!r.is_debit,
      amount: t.amount ?? num(r.igst) + num(r.cgst) + num(r.sgst), balance: t.balance, serial: t.serial,
    };
  }), { convention: 'credit-adds' });
  const rows = order.lines.map((l) => l.row);

  let totI = 0, totC = 0, totS = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    const i = num(r.igst), c = num(r.cgst), s = num(r.sgst);
    if (r.is_debit) { totI -= i; totC -= c; totS -= s; } else { totI += i; totC += c; totS += s; }
    return [formatMonthLabel(r.period_month), r.is_debit ? 'Debit' : 'Credit', r.description || '—', i, c, s];
  });
  tableRows.push(['', '', 'NET (Credit − Debit)', totI, totC, totS]);

  const note = unsettledNote(order.unsettled);
  return {
    title: 'Credit Ledger (Transaction Detail)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   Every transaction row from the portal's Electronic Credit Ledger, not just the opening balance the other Credit Ledger reports use.${note ? `   |   ${note}` : ''}`,
    headers: ['Month', 'Type', 'Description', 'IGST', 'CGST', 'SGST'],
    rows: tableRows,
    fileNameBase: `Credit_Ledger_Detail_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [14, 10, 40, 14, 14, 14],
  };
};

// ─────────────────── Liability and Cash Ledgers ───────────────────────────
// One shape: the portal's retdtl / cashdetls API rows (content.js
// parseLedgerTxns), a lead "Opening Balance" and a closing "Closing Balance"
// row per month with no date and no Dr/Cr, and the total running balance
// after each row.

interface RegisterRow {
  period_month: string;
  entry_date: string | null;
  description: string | null;
  is_debit: boolean | null;
  igst: number | null; cgst: number | null; sgst: number | null; cess: number | null;
  balance: number | null;
}

const OPENING_RE = /^opening\s+balance\b/i;
const CLOSING_RE = /^closing\s+balance\b/i;

/** A balance row: undated or without a direction, and named so. */
const roleOf = (r: RegisterRow): LedgerLine['role'] => {
  const d = (r.description || '').trim();
  if (r.is_debit !== null && r.entry_date) return 'entry';
  if (OPENING_RE.test(d)) return 'opening';
  if (CLOSING_RE.test(d)) return 'closing';
  return 'entry';
};

/** The register's rows in its own order (exported for scripts/verify-ledger-order.mjs). */
export const orderRegisterRows = <R extends RegisterRow>(rows: R[], options: LedgerOrderOptions) => orderLedger(rows.map((r): LedgerLine<R> => ({
  row: r,
  period: r.period_month,
  role: roleOf(r),
  date: r.entry_date,
  isDebit: r.is_debit,
  amount: num(r.igst) + num(r.cgst) + num(r.sgst) + num(r.cess),
  balance: r.balance === null || r.balance === undefined ? null : num(r.balance),
})), options);

/** The register's table rows: Month first, so every row (a balance row too) names its month. */
export const registerTableRows = (rows: RegisterRow[]): (string | number)[][] => rows.map((r) => [
  formatMonthLabel(r.period_month), r.entry_date || '—', r.description || '—',
  r.is_debit === true ? 'Debit' : r.is_debit === false ? 'Credit' : '',
  num(r.igst), num(r.cgst), num(r.sgst), num(r.cess), num(r.balance),
]);

const REGISTER_HEADERS = ['Month', 'Date', 'Description', 'Type', 'IGST', 'CGST', 'SGST', 'Cess', 'Balance'];
const REGISTER_WIDTHS = [11, 12, 34, 10, 14, 14, 14, 12, 14];

const buildRegister = async (
  clientId: string, anyMonthInFy: string,
  spec: { table: 'gst_liability_ledger_entries' | 'gst_cash_ledger_entries'; title: string; file: string; empty: (client: string, fy: string) => string; options: LedgerOrderOptions },
): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  // No order asked of the database (see the credit ledger above).
  const { data, error } = await supabase
    .from(spec.table)
    .select('period_month, entry_date, description, is_debit, igst, cgst, sgst, cess, balance')
    .eq('client_id', clientId).in('period_month', months);
  if (error) throw error;
  const fetched = (data || []) as RegisterRow[];
  if (fetched.length === 0) throw new Error(spec.empty(client.name, fyLabel));

  const order = orderRegisterRows(fetched, spec.options);
  const note = unsettledNote(order.unsettled);
  return {
    title: spec.title,
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}${note ? `   |   ${note}` : ''}`,
    headers: REGISTER_HEADERS,
    rows: registerTableRows(order.lines.map((l) => l.row)),
    fileNameBase: `${spec.file}_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: REGISTER_WIDTHS,
  };
};

// ─────────────────── Liability Ledger ──────────────────────────────────────

/**
 * What is owed: a debit (the return's liability) raises the balance and a
 * credit (its discharge) lowers it, as the portal's own rows chain. Tried both
 * ways all the same, keeping whichever the balances bear out.
 */
export const LIABILITY_ORDER: LedgerOrderOptions = { convention: 'auto', prefer: 'debit-adds' };

export const buildLiabilityLedgerReport = (clientId: string, anyMonthInFy: string): Promise<ReportTable> => buildRegister(clientId, anyMonthInFy, {
  table: 'gst_liability_ledger_entries',
  title: 'Liability Ledger',
  file: 'Liability_Ledger',
  empty: (name, fy) => `No Liability Ledger entries on record for ${name} in ${fy}. Use "Pull" on this report: it fetches every month of the year not yet pulled.`,
  options: LIABILITY_ORDER,
});

// ─────────────────── Cash Ledger ───────────────────────────────────────────

/** Money held: a credit (a deposit) adds to the balance, a debit (its use) takes from it. */
export const CASH_ORDER: LedgerOrderOptions = { convention: 'credit-adds' };

export const buildCashLedgerReport = (clientId: string, anyMonthInFy: string): Promise<ReportTable> => buildRegister(clientId, anyMonthInFy, {
  table: 'gst_cash_ledger_entries',
  title: 'Cash Ledger',
  file: 'Cash_Ledger',
  empty: (name, fy) => `No Cash Ledger entries on record for ${name} in ${fy}. Use "Pull" on this report: it fetches every month of the year not yet pulled.`,
  options: CASH_ORDER,
});
