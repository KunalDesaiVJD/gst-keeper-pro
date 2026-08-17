// The last 6 "ready now" Step 2 reports: 2 more Ledger reports (Credit
// Reversal and Reclaim Statement, RCM Liability/ITC) and the 4 Extra
// reports (Filing Status, Tax Paid RCM vs ITC Claimed, ITC Claimed vs ITC
// Utilized, Client Master).

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { fyMonthsForKey, formatMonthLabel, mmYyyyToShort } from './allClientsReports';
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

// ────── LEDGERS 1: Credit Reversal and Reclaim Statement (one client) ────

export const buildCreditReversalReclaimStatement = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  const [clientRes, originRes, reclaimRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle(),
    supabase.from('bills_not_in_2b').select('period_month, input_cgst, input_sgst, input_igst, reclaim_month').eq('client_id', clientId).in('period_month', months),
    supabase.from('bills_not_in_2b').select('reclaim_month, input_cgst, input_sgst, input_igst, reclaim_subtype').eq('client_id', clientId).in('reclaim_month', months),
  ]);
  const client: ClientLite = (clientRes.data || { id: clientId, name: 'Unknown', gstin: '' }) as any;
  const sumTax = (r: { input_cgst?: number | null; input_sgst?: number | null; input_igst?: number | null }) =>
    num(r.input_cgst) + num(r.input_sgst) + num(r.input_igst);

  const reversedByMonth = new Map<string, number>();
  const closingByMonth = new Map<string, number>();
  (originRes.data || []).forEach((r) => {
    reversedByMonth.set(r.period_month, (reversedByMonth.get(r.period_month) || 0) + sumTax(r));
    if (!r.reclaim_month) closingByMonth.set(r.period_month, (closingByMonth.get(r.period_month) || 0) + sumTax(r));
  });
  const reclaimedByMonth = new Map<string, number>();
  const expensedByMonth = new Map<string, number>();
  (reclaimRes.data || []).forEach((r) => {
    const amt = sumTax(r);
    const m = r.reclaim_month as string;
    reclaimedByMonth.set(m, (reclaimedByMonth.get(m) || 0) + amt);
    if (r.reclaim_subtype === 'EXPENSE_OUT') expensedByMonth.set(m, (expensedByMonth.get(m) || 0) + amt);
  });

  let totRev = 0, totRec = 0, totExp = 0, totClose = 0;
  const rows: (string | number)[][] = months.map((m, idx) => {
    const rev = reversedByMonth.get(m) || 0, rec = reclaimedByMonth.get(m) || 0, exp = expensedByMonth.get(m) || 0, close = closingByMonth.get(m) || 0;
    totRev += rev; totRec += rec; totExp += exp; totClose += close;
    return [idx + 1, formatMonthLabel(m), rev, rec, exp, close];
  });
  rows.push(['', 'TOTAL', totRev, totRec, totExp, totClose]);

  return {
    title: 'Credit Reversal and Reclaim Statement',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   "Reversed" and "Closing Balance" are keyed by the month the bill originated (reversal always happens in that same month); "Reclaimed" and "Expensed Out" are keyed by the month the reclaim/write-off actually happened, which can be a later month.`,
    headers: ['Sr No.', 'Month', 'Reversed This Month', 'Reclaimed This Month', 'Expensed Out This Month', 'Closing Balance (Still Suspended)'],
    rows,
    fileNameBase: `Credit_Reversal_Reclaim_Statement_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [6, 18, 18, 18, 20, 22],
  };
};

// ────── LEDGERS 2: RCM Liability/ITC (one client, FY ledger) ─────────────

export const buildRcmLedgerPerClient = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  const shortMonths = months.map(mmYyyyToShort);
  const [clientRes, rcmRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle(),
    supabase.from('rcm_data').select('month, taxable_value, cgst_2_5, cgst_9, sgst_2_5, sgst_9, igst_5, igst_18').eq('client_id', clientId).in('month', shortMonths),
  ]);
  const client: ClientLite = (clientRes.data || { id: clientId, name: 'Unknown', gstin: '' }) as any;

  interface Bucket { txval: number; igst: number; cgst: number; sgst: number; }
  const byMonth = new Map<string, Bucket>();
  (rcmRes.data || []).forEach((r) => {
    const cur = byMonth.get(r.month) || { txval: 0, igst: 0, cgst: 0, sgst: 0 };
    cur.txval += num(r.taxable_value);
    cur.igst += num(r.igst_5) + num(r.igst_18);
    cur.cgst += num(r.cgst_2_5) + num(r.cgst_9);
    cur.sgst += num(r.sgst_2_5) + num(r.sgst_9);
    byMonth.set(r.month, cur);
  });

  let totTx = 0, totI = 0, totC = 0, totS = 0;
  const rows: (string | number)[][] = months.map((m, idx) => {
    const v = byMonth.get(mmYyyyToShort(m)) || { txval: 0, igst: 0, cgst: 0, sgst: 0 };
    totTx += v.txval; totI += v.igst; totC += v.cgst; totS += v.sgst;
    return [idx + 1, formatMonthLabel(m), v.txval, v.igst, v.cgst, v.sgst, v.igst + v.cgst + v.sgst];
  });
  rows.push(['', 'TOTAL', totTx, totI, totC, totS, totI + totC + totS]);

  return {
    title: 'RCM Liability/ITC Ledger',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   From RCM Summary. In this app's GSTR-3B draft, Table 4A(3) RCM ITC is always computed from this same total, so RCM liability and RCM ITC claimed are identical per month here — see "Reverse Charge Liability Declared and ITC Claimed Thereon" (Tax Liability & ITC) for periods where a manual adjustment creates a difference.`,
    headers: ['Sr No.', 'Month', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total RCM Tax'],
    rows,
    fileNameBase: `RCM_Liability_ITC_Ledger_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [6, 18, 16, 14, 14, 14, 16],
  };
};

// ────── EXTRA 1: Filing Status Report (all clients, one month) ───────────

export const buildFilingStatusReport = async (month: string): Promise<ReportTable> => {
  const [clientsRes, filingRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').order('name'),
    supabase.from('filing_status').select('client_id, return_type, status, filed_date').eq('period_month', month),
  ]);
  const clients: ClientLite[] = (clientsRes.data || []) as any;
  const filingByClient = new Map<string, { return_type: string; status: string; filed_date: string | null }[]>();
  (filingRes.data || []).forEach((r: any) => {
    const arr = filingByClient.get(r.client_id) || [];
    arr.push(r);
    filingByClient.set(r.client_id, arr);
  });

  const rows: (string | number)[][] = [];
  clients.forEach((client) => {
    const records = filingByClient.get(client.id) || [];
    if (records.length === 0) {
      rows.push([client.name, client.gstin || '—', '—', 'No filing record', '—']);
      return;
    }
    records
      .sort((a, b) => a.return_type.localeCompare(b.return_type))
      .forEach((r) => rows.push([client.name, client.gstin || '—', r.return_type, r.status || '—', r.filed_date || '—']));
  });

  return {
    title: 'Filing Status Report',
    subtitle: `Month: ${formatMonthLabel(month)}   |   One row per client per return type`,
    headers: ['Client Name', 'GSTIN', 'Return Type', 'Status', 'Filed Date'],
    rows,
    fileNameBase: `Filing_Status_Report_${month.replace('/', '-')}`,
    columnWidths: [35, 18, 14, 18, 14],
  };
};

// ────── EXTRA 2: Tax Paid under RCM vs ITC Claimed (all clients) ─────────

export const buildRcmTaxPaidVsItcClaimedAllClients = async (month: string): Promise<ReportTable> => {
  const { data: clientsData } = await supabase.from('clients').select('id, name, gstin').order('name');
  const clients: ClientLite[] = (clientsData || []) as any;

  const results = await Promise.all(clients.map((c) => fetchGstr3b(c.id, c.gstin || '', month).catch(() => null)));

  let totLiab = 0, totItc = 0;
  const rows: (string | number)[][] = clients.map((client, idx) => {
    const s = results[idx]?.summary;
    const liab = s ? s.rcmLiability.igst + s.rcmLiability.cgst + s.rcmLiability.sgst : 0;
    const itcRow = s?.itcAvailableRows.find((r) => r.srNo === '(3)');
    const itc = itcRow ? itcRow.igst + itcRow.cgst + itcRow.sgst : 0;
    totLiab += liab; totItc += itc;
    return [idx + 1, client.name, client.gstin || '—', liab, itc, liab - itc];
  });
  rows.push(['', 'TOTAL', '', totLiab, totItc, totLiab - totItc]);

  return {
    title: 'Tax Paid under RCM vs ITC Claimed',
    subtitle: `Month: ${formatMonthLabel(month)}   |   RCM liability (Table 3.1d) vs RCM ITC claimed (Table 4A(3)) per client, from this app's computed draft GSTR-3B`,
    headers: ['Sr No.', 'Client Name', 'GSTIN', 'RCM Tax Paid', 'ITC Claimed', 'Variance'],
    rows,
    fileNameBase: `RCM_Tax_Paid_vs_ITC_Claimed_${month.replace('/', '-')}`,
    columnWidths: [6, 35, 18, 16, 16, 14],
  };
};

// ────── EXTRA 3: ITC Claimed vs ITC Utilized (all clients) ───────────────

export const buildItcClaimedVsUtilizedAllClients = async (month: string): Promise<ReportTable> => {
  const { data: clientsData } = await supabase.from('clients').select('id, name, gstin').order('name');
  const clients: ClientLite[] = (clientsData || []) as any;

  const results = await Promise.all(clients.map((c) => fetchGstr3b(c.id, c.gstin || '', month).catch(() => null)));

  let totClaimed = 0, totUtilized = 0;
  const rows: (string | number)[][] = clients.map((client, idx) => {
    const s = results[idx]?.summary;
    const claimed = s ? s.itcAvailable.igst + s.itcAvailable.cgst + s.itcAvailable.sgst : 0;
    const liability = s ? s.totalLiability.igst + s.totalLiability.cgst + s.totalLiability.sgst : 0;
    const netAvail = s ? Math.max(0, s.itcNet.igst + s.itcNet.cgst + s.itcNet.sgst) : 0;
    const utilized = Math.min(netAvail, liability);
    totClaimed += claimed; totUtilized += utilized;
    return [idx + 1, client.name, client.gstin || '—', claimed, utilized, claimed - utilized];
  });
  rows.push(['', 'TOTAL', '', totClaimed, totUtilized, totClaimed - totUtilized]);

  return {
    title: 'ITC Claimed vs ITC Utilized',
    subtitle: `Month: ${formatMonthLabel(month)}   |   "Claimed" is Table 4(A) ITC Available (gross); "Utilized" is Net ITC actually set off against this month's liability, capped at the liability itself — the balance carries forward on the portal's electronic credit ledger, which this app doesn't track period-to-period yet.`,
    headers: ['Sr No.', 'Client Name', 'GSTIN', 'ITC Claimed', 'ITC Utilized', 'Balance / Carried Forward'],
    rows,
    fileNameBase: `ITC_Claimed_vs_Utilized_${month.replace('/', '-')}`,
    columnWidths: [6, 35, 18, 16, 16, 20],
  };
};

// ────── EXTRA 4: Client Master (all clients, no period) ──────────────────

export const buildClientMasterReport = async (): Promise<ReportTable> => {
  const { data, error } = await supabase
    .from('clients')
    .select('name, gstin, registration_type, regular_sub_type, registration_date, email, mobile, assigned_accountant, inactive_at_hand')
    .order('name');
  if (error) throw error;
  const clients = data || [];

  const rows: (string | number)[][] = clients.map((c, i) => [
    i + 1,
    c.name || '—',
    c.gstin || '—',
    c.registration_type || '—',
    c.regular_sub_type || '—',
    c.registration_date || '—',
    c.email || '—',
    c.mobile || '—',
    c.assigned_accountant || '—',
    c.inactive_at_hand ? 'Inactive' : 'Active',
  ]);

  return {
    title: 'Client Master',
    subtitle: `Total clients: ${clients.length}`,
    headers: ['#', 'Client Name', 'GSTIN', 'Registration Type', 'Sub Type', 'Registration Date', 'Email', 'Mobile', 'Assigned Accountant', 'Status'],
    rows,
    fileNameBase: 'Client_Master',
    columnWidths: [6, 32, 18, 14, 12, 16, 26, 14, 20, 10],
  };
};
