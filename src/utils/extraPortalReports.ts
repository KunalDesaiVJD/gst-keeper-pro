// 4 more reports: Credit and Liability Statement (computed, reuses the
// existing GSTR-3B draft + the Rule 88A offset helper — zero new
// automation), Taxpayer Information, Download Registration Certificate, and
// Challan Summary Report (schema + report only, same no-automation-yet
// reasoning as the Notice/Refund/DRC-03 batch — see gst_taxpayer_profile /
// gst_challans in the migration for why).

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { fyMonthsForKey, formatMonthLabel } from './allClientsReports';
import type { Gstr3bSummary } from './filedReturnReports';

interface ClientLite { id: string; name: string; gstin: string; }

const fileSafe = (s: string) => s.replace(/\s+/g, '_');
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const fetchClient = async (clientId: string): Promise<ClientLite> => {
  const { data } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  return (data || { id: clientId, name: 'Unknown', gstin: '' }) as ClientLite;
};

// ─────────────────── Credit and Liability Statement ───────────────────────

export const buildCreditAndLiabilityStatementReport = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  const { data: filedRows } = await supabase.from('gst_filed_returns').select('period_month, summary').eq('client_id', clientId).eq('return_type', 'GSTR3B').in('period_month', months);
  const byMonth = new Map((filedRows || []).map((r) => [r.period_month, r.summary as Gstr3bSummary]));

  let totLiab = 0, totItc = 0, totCash = 0, pulled = 0;
  const rows: (string | number)[][] = months.map((m) => {
    const s = byMonth.get(m);
    if (!s || Object.keys(s).length === 0) return [formatMonthLabel(m), 'NOT PULLED', '', ''];
    pulled++;
    const sup = s.sup_details || {};
    const liab = num(sup.osup_det?.iamt) + num(sup.osup_det?.camt) + num(sup.osup_det?.samt)
      + num(sup.isup_rev?.iamt) + num(sup.isup_rev?.camt) + num(sup.isup_rev?.samt);
    const itc = num(s.tt_val?.tt_itc_pd);
    const cash = num(s.tt_val?.tt_csh_pd);
    totLiab += liab; totItc += itc; totCash += cash;
    return [formatMonthLabel(m), liab, itc, cash];
  });
  rows.push(['TOTAL — ' + fyLabel, totLiab, totItc, totCash]);

  return {
    title: 'Credit And Liability Statement',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${fyLabel}   |   As filed on the portal's GSTR-3B for each month (${pulled}/${months.length} months pulled — the rest show NOT PULLED). "ITC Set Off" and "Paid in Cash" are the return's own as-filed aggregate figures — the portal doesn't expose which ITC head funded which liability head, so a per-head Rule 88A allocation isn't shown (see GSTR 3B Offset Summary for the same caveat).`,
    headers: ['Month', 'Total Liability', 'ITC Set Off (as filed)', 'Paid in Cash (as filed)'],
    rows,
    fileNameBase: `Credit_Liability_Statement_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
    columnWidths: [14, 16, 18, 18],
  };
};

// ─────────────────── Taxpayer Information ──────────────────────────────────

export const buildTaxpayerInformationReport = async (clientId: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data, error } = await supabase
    .from('gst_taxpayer_profile')
    .select('legal_name, trade_name, constitution_of_business, registration_date, jurisdiction_state, jurisdiction_centre, principal_place_address, aadhaar_authentication_status')
    .eq('client_id', clientId).maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(`No portal taxpayer profile on record for ${client.name}. This report has no automated portal pull yet — enter it directly, or check back once the extension's Taxpayer Information pull is verified against the real portal.`);
  }

  const rows: (string | number)[][] = [
    ['Legal Name', data.legal_name || '—'],
    ['Trade Name', data.trade_name || '—'],
    ['GSTIN', client.gstin || '—'],
    ['Constitution of Business', data.constitution_of_business || '—'],
    ['Registration Date', data.registration_date || '—'],
    ['State Jurisdiction', data.jurisdiction_state || '—'],
    ['Centre Jurisdiction', data.jurisdiction_centre || '—'],
    ['Principal Place of Business', data.principal_place_address || '—'],
    ['Aadhaar Authentication Status', data.aadhaar_authentication_status || '—'],
  ];

  return {
    title: 'Taxpayer Information',
    subtitle: `Client: ${client.name}   |   As on record`,
    headers: ['Field', 'Value'],
    rows,
    fileNameBase: `Taxpayer_Information_${fileSafe(client.name)}`,
    columnWidths: [30, 50],
  };
};

// ─────────────────── Download Registration Certificate ────────────────────
// Not a tabular report by nature — the portal artifact is a PDF. This
// report surfaces whatever's on record as a one-row pointer rather than
// pretending to render the certificate itself.

export const buildRegistrationCertificateReport = async (clientId: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data, error } = await supabase
    .from('gst_taxpayer_profile')
    .select('legal_name, registration_date, registration_certificate_url')
    .eq('client_id', clientId).maybeSingle();
  if (error) throw error;
  if (!data || !data.registration_certificate_url) {
    throw new Error(`No Registration Certificate on record for ${client.name}. This report has no automated portal pull yet — download it manually from the portal and record the file location, or check back once the extension's pull is verified.`);
  }

  return {
    title: 'Registration Certificate',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}`,
    headers: ['Legal Name', 'Registration Date', 'Certificate URL'],
    rows: [[data.legal_name || '—', data.registration_date || '—', data.registration_certificate_url]],
    fileNameBase: `Registration_Certificate_${fileSafe(client.name)}`,
    columnWidths: [30, 16, 60],
  };
};

// ─────────────────── Challan Summary Report ────────────────────────────────

export const buildChallanSummaryReport = async (clientId: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { data, error } = await supabase
    .from('gst_challans')
    .select('cpin, challan_date, payment_mode, total_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, status')
    .eq('client_id', clientId)
    .order('challan_date', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) {
    throw new Error(`No challans on record for ${client.name}. This report has no automated portal pull yet — enter records directly, or check back once the extension's Challan Summary pull is verified against the real portal.`);
  }

  let tot = 0;
  const tableRows: (string | number)[][] = rows.map((r) => {
    tot += num(r.total_amount);
    return [r.cpin || '—', r.challan_date || '—', r.payment_mode || '—', num(r.cgst_amount), num(r.sgst_amount), num(r.igst_amount), num(r.cess_amount), num(r.total_amount), r.status || '—'];
  });
  tableRows.push(['', '', 'TOTAL', '', '', '', '', tot, '']);

  return {
    title: 'Challan Summary Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   All challans on record, most recent first`,
    headers: ['CPIN', 'Challan Date', 'Payment Mode', 'CGST', 'SGST', 'IGST', 'Cess', 'Total Amount', 'Status'],
    rows: tableRows,
    fileNameBase: `Challan_Summary_${fileSafe(client.name)}`,
    columnWidths: [16, 12, 14, 14, 14, 14, 12, 16, 14],
  };
};
