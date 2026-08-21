// The last 6 "ready now" Step 2 reports: 2 more Ledger reports (Credit
// Reversal and Reclaim Statement, RCM Liability/ITC) and the 4 Extra
// reports (Filing Status, Tax Paid RCM vs ITC Claimed, ITC Claimed vs ITC
// Utilized, Client Master).

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { fyMonthsForKey, formatMonthLabel } from './allClientsReports';
import type { Gstr3bSummary, TypedAmt } from './filedReturnReports';

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

// ────── LEDGERS 1: Electronic Credit Reversal and Re-claimed Statement ───
// Rebuilt against the REAL portal statement (Dashboard Quick Link, Services >
// Ledger > "Electronic Credit Reversal and Re-claimed Statement") instead of
// computing it from this app's own suspended-ITC reconciliation — confirmed
// live 2026-08-22 to be a genuine, separate portal feature with its own API
// (see supabase/migrations/20260822120000_rcm_credit_reversal_statements.sql).
// A Pull (mode 'revrclm_pull') fetches the client's WHOLE financial year in
// one job, so this reads every row already stored for that FY rather than
// looping month by month.

const fyKeyOf = (anyMonthInFy: string): string => {
  const { months } = fyMonthsForKey(anyMonthInFy);
  const [, startYear] = months[0].split('/').map(Number);
  return `${startYear}-${startYear + 1}`;
};

interface CreditReversalReclaimEntry {
  is_opening_balance: boolean;
  return_period: string | null;
  transaction_date: string | null;
  reference_no: string | null;
  description: string | null;
  itc_claimed_igst: number | null; itc_claimed_cgst: number | null; itc_claimed_sgst: number | null; itc_claimed_cess: number | null;
  itc_reversed_igst: number | null; itc_reversed_cgst: number | null; itc_reversed_sgst: number | null; itc_reversed_cess: number | null;
  itc_reclaimed_igst: number | null; itc_reclaimed_cgst: number | null; itc_reclaimed_sgst: number | null; itc_reclaimed_cess: number | null;
  closing_balance_igst: number | null; closing_balance_cgst: number | null; closing_balance_sgst: number | null; closing_balance_cess: number | null;
}

const CREDIT_REVERSAL_HEADERS = [
  'S.No.', 'Date', 'Reference No.', 'Return Period', 'Description',
  'ITC Claimed IGST', 'ITC Claimed CGST', 'ITC Claimed SGST', 'ITC Claimed Cess',
  'ITC Reversed IGST', 'ITC Reversed CGST', 'ITC Reversed SGST', 'ITC Reversed Cess',
  'ITC Reclaimed IGST', 'ITC Reclaimed CGST', 'ITC Reclaimed SGST', 'ITC Reclaimed Cess',
  'Closing IGST', 'Closing CGST', 'Closing SGST', 'Closing Cess', 'Balance',
];

export const buildCreditReversalReclaimStatement = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const { fyLabel } = fyMonthsForKey(anyMonthInFy);
  const fy = fyKeyOf(anyMonthInFy);
  const client = await fetchClient(clientId);
  const { data } = await supabase
    .from('gst_credit_reversal_reclaim_entries' as any)
    .select('*')
    .eq('client_id', clientId)
    .eq('financial_year', fy)
    .order('is_opening_balance', { ascending: false })
    .order('transaction_date', { ascending: true });
  const entries = (data || []) as unknown as CreditReversalReclaimEntry[];

  const rows: (string | number)[][] = entries.map((e, idx) => {
    const bal = num(e.closing_balance_igst) + num(e.closing_balance_cgst) + num(e.closing_balance_sgst) + num(e.closing_balance_cess);
    if (e.is_opening_balance) {
      return [idx + 1, '-', '-', '-', 'Opening Balance', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
        num(e.closing_balance_igst), num(e.closing_balance_cgst), num(e.closing_balance_sgst), num(e.closing_balance_cess), bal];
    }
    return [
      idx + 1, e.transaction_date || '—', e.reference_no || '—', e.return_period || '—', e.description || '—',
      num(e.itc_claimed_igst), num(e.itc_claimed_cgst), num(e.itc_claimed_sgst), num(e.itc_claimed_cess),
      num(e.itc_reversed_igst), num(e.itc_reversed_cgst), num(e.itc_reversed_sgst), num(e.itc_reversed_cess),
      num(e.itc_reclaimed_igst), num(e.itc_reclaimed_cgst), num(e.itc_reclaimed_sgst), num(e.itc_reclaimed_cess),
      num(e.closing_balance_igst), num(e.closing_balance_cgst), num(e.closing_balance_sgst), num(e.closing_balance_cess), bal,
    ];
  });

  return {
    title: 'Electronic Credit Reversal and Re-claimed Statement',
    subtitle: entries.length === 0
      ? `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   NOT PULLED — this is a real GST portal statement (Table 4A(5)/4B(2)/4D(1) ITC movement, not a value this app computes); use this report's Pull button to fetch the whole financial year.`
      : `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   As shown on the portal's own "Electronic Credit Reversal and Re-claimed Statement" — pulled directly from the portal, not computed from this app's reconciliation.`,
    headers: CREDIT_REVERSAL_HEADERS,
    rows,
    fileNameBase: `Credit_Reversal_Reclaimed_Statement_${fileSafe(client.name)}_${fy}`,
    columnWidths: [6, 12, 16, 12, 22, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
  };
};

// ────── LEDGERS 2: RCM Liability/ITC Statement (one client, FY) ──────────
// Same story: rebuilt against the REAL portal statement (Dashboard Quick
// Link "RCM Liability/ITC Statement") instead of deriving it from RCM
// Summary's own books-based rcm_data. A Pull (mode 'rcmliab_pull') fetches
// the client's whole financial year in one job.

interface RcmLiabilityItcEntry {
  is_opening_balance: boolean;
  return_period: string | null;
  transaction_date: string | null;
  reference_no: string | null;
  description: string | null;
  liability_3_1d_igst: number | null; liability_3_1d_cgst: number | null; liability_3_1d_sgst: number | null; liability_3_1d_cess: number | null;
  itc_4a2_igst: number | null; itc_4a2_cess: number | null;
  itc_4a3_igst: number | null; itc_4a3_cgst: number | null; itc_4a3_sgst: number | null; itc_4a3_cess: number | null;
  closing_balance_igst: number | null; closing_balance_cgst: number | null; closing_balance_sgst: number | null; closing_balance_cess: number | null;
}

const RCM_LIABILITY_ITC_HEADERS = [
  'S.No.', 'Date', 'Reference No.', 'Return Period', 'Description',
  'Liability Paid IGST', 'Liability Paid CGST', 'Liability Paid SGST', 'Liability Paid Cess',
  'ITC 4A(2) IGST', 'ITC 4A(2) Cess',
  'ITC 4A(3) IGST', 'ITC 4A(3) CGST', 'ITC 4A(3) SGST', 'ITC 4A(3) Cess',
  'Closing IGST', 'Closing CGST', 'Closing SGST', 'Closing Cess', 'Balance',
];

export const buildRcmLedgerPerClient = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const { fyLabel } = fyMonthsForKey(anyMonthInFy);
  const fy = fyKeyOf(anyMonthInFy);
  const client = await fetchClient(clientId);
  const { data } = await supabase
    .from('gst_rcm_liability_itc_entries' as any)
    .select('*')
    .eq('client_id', clientId)
    .eq('financial_year', fy)
    .order('is_opening_balance', { ascending: false })
    .order('transaction_date', { ascending: true });
  const entries = (data || []) as unknown as RcmLiabilityItcEntry[];

  const rows: (string | number)[][] = entries.map((e, idx) => {
    const bal = num(e.closing_balance_igst) + num(e.closing_balance_cgst) + num(e.closing_balance_sgst) + num(e.closing_balance_cess);
    if (e.is_opening_balance) {
      return [idx + 1, '-', '-', '-', 'Opening Balance', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
        num(e.closing_balance_igst), num(e.closing_balance_cgst), num(e.closing_balance_sgst), num(e.closing_balance_cess), bal];
    }
    return [
      idx + 1, e.transaction_date || '—', e.reference_no || '—', e.return_period || '—', e.description || '—',
      num(e.liability_3_1d_igst), num(e.liability_3_1d_cgst), num(e.liability_3_1d_sgst), num(e.liability_3_1d_cess),
      num(e.itc_4a2_igst), num(e.itc_4a2_cess),
      num(e.itc_4a3_igst), num(e.itc_4a3_cgst), num(e.itc_4a3_sgst), num(e.itc_4a3_cess),
      num(e.closing_balance_igst), num(e.closing_balance_cgst), num(e.closing_balance_sgst), num(e.closing_balance_cess), bal,
    ];
  });

  return {
    title: 'RCM Liability/ITC Statement',
    subtitle: entries.length === 0
      ? `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   NOT PULLED — this is a real GST portal statement (Table 3.1(d) RCM liability paid vs Table 4A(2)/4A(3) RCM ITC claimed, not a value this app computes); use this report's Pull button to fetch the whole financial year.`
      : `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   As shown on the portal's own "RCM Liability/ITC Statement". Positive Balance = RCM liability paid but ITC not yet claimed; negative = ITC claimed in excess of liability paid.`,
    headers: RCM_LIABILITY_ITC_HEADERS,
    rows,
    fileNameBase: `RCM_Liability_ITC_Statement_${fileSafe(client.name)}_${fy}`,
    columnWidths: [6, 12, 16, 12, 22, 12, 12, 12, 12, 12, 10, 12, 12, 12, 12, 12, 12, 12, 12, 12],
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

const findItc = (arr: TypedAmt[] | undefined, ty: string): TypedAmt =>
  (Array.isArray(arr) ? arr.find((x) => x.ty === ty) : undefined) || {};

export const buildRcmTaxPaidVsItcClaimedAllClients = async (month: string): Promise<ReportTable> => {
  const { data: clientsData } = await supabase.from('clients').select('id, name, gstin').order('name');
  const clients: ClientLite[] = (clientsData || []) as any;
  const { data: filedRows } = await supabase.from('gst_filed_returns' as any).select('client_id, summary').eq('period_month', month).eq('return_type', 'GSTR3B');
  const byClient = new Map((filedRows || []).map((r: any) => [r.client_id, r.summary as Gstr3bSummary]));

  let totLiab = 0, totItc = 0, pulled = 0;
  const rows: (string | number)[][] = clients.map((client, idx) => {
    const s = byClient.get(client.id);
    if (!s || Object.keys(s).length === 0) return [idx + 1, client.name, client.gstin || '—', 'NOT PULLED', '', ''];
    pulled++;
    const rcm = s.sup_details?.isup_rev || {};
    const liab = num(rcm.iamt) + num(rcm.camt) + num(rcm.samt);
    const itcRow = findItc(s.itc_elg?.itc_avl, 'ISRC');
    const itc = num(itcRow.iamt) + num(itcRow.camt) + num(itcRow.samt);
    totLiab += liab; totItc += itc;
    return [idx + 1, client.name, client.gstin || '—', liab, itc, liab - itc];
  });
  rows.push(['', 'TOTAL', '', totLiab, totItc, totLiab - totItc]);

  return {
    title: 'Tax Paid under RCM vs ITC Claimed',
    subtitle: `Month: ${formatMonthLabel(month)}   |   RCM liability (Table 3.1d) vs RCM ITC claimed (Table 4A(3)) per client, as filed on the portal's GSTR-3B (${pulled}/${clients.length} clients pulled for this period — the rest show NOT PULLED; use GSTR-3B (Filed on Portal)'s Pull button per client).`,
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
  const { data: filedRows } = await supabase.from('gst_filed_returns' as any).select('client_id, summary').eq('period_month', month).eq('return_type', 'GSTR3B');
  const byClient = new Map((filedRows || []).map((r: any) => [r.client_id, r.summary as Gstr3bSummary]));

  let totClaimed = 0, totUtilized = 0, pulled = 0;
  const rows: (string | number)[][] = clients.map((client, idx) => {
    const s = byClient.get(client.id);
    if (!s || Object.keys(s).length === 0) return [idx + 1, client.name, client.gstin || '—', 'NOT PULLED', '', ''];
    pulled++;
    const claimed = ['IMPG', 'IMPS', 'ISRC', 'ISD', 'OTH']
      .map((ty) => findItc(s.itc_elg?.itc_avl, ty))
      .reduce((a, r) => a + num(r.iamt) + num(r.camt) + num(r.samt), 0);
    const utilized = num(s.tt_val?.tt_itc_pd);
    totClaimed += claimed; totUtilized += utilized;
    return [idx + 1, client.name, client.gstin || '—', claimed, utilized, claimed - utilized];
  });
  rows.push(['', 'TOTAL', '', totClaimed, totUtilized, totClaimed - totUtilized]);

  return {
    title: 'ITC Claimed vs ITC Utilized',
    subtitle: `Month: ${formatMonthLabel(month)}   |   "Claimed" is Table 4(A) ITC Available (gross); "Utilized" is the return's own as-filed ITC utilised (tt_itc_pd) — both as filed on the portal's GSTR-3B (${pulled}/${clients.length} clients pulled for this period).`,
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
