// The 4 PAN-Based reports: a GSTIN's PAN is embedded in the GSTIN itself
// (characters 3-12 of the standard 15-char format — state code, then PAN,
// then entity number, 'Z', checksum), so grouping every client under the
// same firm-PAN needs no portal call and no new schema. The rollup ITSELF
// makes no new portal call, but the per-GSTIN figures it rolls up are now
// the as-filed portal data (gst_filed_returns) instead of this app's
// computed draft or the Excel-imported 2A/2B — any GSTIN not yet pulled for
// the period shows NOT PULLED rather than a silent zero.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { formatMonthLabel } from './allClientsReports';
import {
  fetchFiledReturn, flattenGstr2aDocs, flattenGstr2bDocs,
  type Gstr3bSummary, type Gstr1Summary, type Gstr2aSummary, type Gstr2bSummary, type TypedAmt,
} from './filedReturnReports';

interface ClientLite { id: string; name: string; gstin: string; }

const fileSafe = (s: string) => s.replace(/\s+/g, '_');
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export const derivePan = (gstin: string): string => (gstin || '').toUpperCase().trim().slice(2, 12);

export const fetchPanGroup = async (clientId: string): Promise<{ pan: string; group: ClientLite[] }> => {
  const { data: clientRow } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  const client = (clientRow || { id: clientId, name: 'Unknown', gstin: '' }) as ClientLite;
  const pan = derivePan(client.gstin);
  if (pan.length !== 10) throw new Error(`${client.name}'s GSTIN (${client.gstin || '—'}) doesn't look like a valid 15-character GSTIN — can't derive a PAN to group by.`);
  const { data: allClients } = await supabase.from('clients').select('id, name, gstin').order('name');
  const group = ((allClients || []) as ClientLite[]).filter((c) => derivePan(c.gstin) === pan);
  return { pan, group };
};

const findItc = (arr: TypedAmt[] | undefined, ty: string) => (Array.isArray(arr) ? arr.find((x) => x.ty === ty) : undefined) || {};
const itcAvailGross = (s: Gstr3bSummary) => ['IMPG', 'IMPS', 'ISRC', 'ISD', 'OTH']
  .map((ty) => findItc(s.itc_elg?.itc_avl, ty))
  .reduce((a, r) => a + num(r.iamt) + num(r.camt) + num(r.samt), 0);
const totalLiability = (s: Gstr3bSummary) => {
  const o = s.sup_details?.osup_det, r = s.sup_details?.isup_rev;
  return num(o?.iamt) + num(o?.camt) + num(o?.samt) + num(r?.iamt) + num(r?.camt) + num(r?.samt);
};

// ────── REPORT 1: Output Liability as per GSTR 1 and GSTR 3B (PAN) ───────

export const buildPanOutputLiabilityReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { pan, group } = await fetchPanGroup(clientId);

  let totG1 = 0, totG3b = 0, pulled = 0;
  const rows: (string | number)[][] = [];
  for (const c of group) {
    const [g1row, g3row] = await Promise.all([
      fetchFiledReturn(c.id, month, 'GSTR1'),
      fetchFiledReturn(c.id, month, 'GSTR3B'),
    ]);
    if (!g1row?.summary || !g3row?.summary || Object.keys(g1row.summary).length === 0 || Object.keys(g3row.summary).length === 0) {
      rows.push([c.name, c.gstin || '—', 'NOT PULLED', '', '']);
      continue;
    }
    pulled++;
    const g1 = g1row.summary as Gstr1Summary;
    const g3 = g3row.summary as Gstr3bSummary;
    const ttlLiab = (g1.sec_sum || []).find((sec) => sec.sec_nm === 'TTL_LIAB');
    const g1Tax = num(ttlLiab?.ttl_igst) + num(ttlLiab?.ttl_cgst) + num(ttlLiab?.ttl_sgst);
    const g3bTax = totalLiability(g3);
    totG1 += g1Tax; totG3b += g3bTax;
    rows.push([c.name, c.gstin || '—', g1Tax, g3bTax, g3bTax - g1Tax]);
  }
  rows.push(['TOTAL — PAN ' + pan, '', totG1, totG3b, totG3b - totG1]);

  return {
    title: 'Output Liability as per GSTR 1 and GSTR 3B (PAN-Based)',
    subtitle: `PAN: ${pan}   |   ${group.length} GSTIN(s), ${pulled} pulled for this period   |   Period: ${formatMonthLabel(month)}   |   Both sides as filed on the portal for each entity — GSTINs not yet pulled show NOT PULLED.`,
    headers: ['Entity (GSTIN)', 'GSTIN', 'GSTR-1 Output Tax', 'GSTR-3B Output Liability', 'Variance'],
    rows,
    fileNameBase: `PAN_Output_Liability_${pan}_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 18, 20, 14],
  };
};

// ──── REPORT 2: Liability per GSTR 1 and ITC Claimed per GSTR 3B (PAN) ───

export const buildPanLiabilityVsItcClaimedReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { pan, group } = await fetchPanGroup(clientId);

  let totLiab = 0, totItc = 0, pulled = 0;
  const rows: (string | number)[][] = [];
  for (const c of group) {
    const [g1row, g3row] = await Promise.all([
      fetchFiledReturn(c.id, month, 'GSTR1'),
      fetchFiledReturn(c.id, month, 'GSTR3B'),
    ]);
    if (!g1row?.summary || !g3row?.summary || Object.keys(g1row.summary).length === 0 || Object.keys(g3row.summary).length === 0) {
      rows.push([c.name, c.gstin || '—', 'NOT PULLED', '', '']);
      continue;
    }
    pulled++;
    const g1 = g1row.summary as Gstr1Summary;
    const g3 = g3row.summary as Gstr3bSummary;
    const ttlLiab = (g1.sec_sum || []).find((sec) => sec.sec_nm === 'TTL_LIAB');
    const liab = num(ttlLiab?.ttl_igst) + num(ttlLiab?.ttl_cgst) + num(ttlLiab?.ttl_sgst);
    const itc = itcAvailGross(g3);
    totLiab += liab; totItc += itc;
    rows.push([c.name, c.gstin || '—', liab, itc, liab - itc]);
  }
  rows.push(['TOTAL — PAN ' + pan, '', totLiab, totItc, totLiab - totItc]);

  return {
    title: 'Liability as per GSTR 1 and ITC Claimed as per GSTR 3B (PAN-Based)',
    subtitle: `PAN: ${pan}   |   ${group.length} GSTIN(s), ${pulled} pulled for this period   |   Period: ${formatMonthLabel(month)}   |   Both sides as filed on the portal for each entity — GSTINs not yet pulled show NOT PULLED.`,
    headers: ['Entity (GSTIN)', 'GSTIN', 'GSTR-1 Output Liability', 'GSTR-3B ITC Claimed (Table 4A)', 'Liability − ITC'],
    rows,
    fileNameBase: `PAN_Liability_vs_ITC_Claimed_${pan}_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 20, 24, 16],
  };
};

// ────── REPORT 3: GSTR 2A/2B Multiple Company Report (PAN) ───────────────
// Rolls up the portal-pulled document-level GSTR-2A/2B (gst_filed_returns —
// see filedReturnReports.ts) across every GSTIN sharing a PAN, NOT the
// Excel-imported gstr2a_import_docs/twob_import_docs 2B Reconciliation uses.

export const buildPanMultipleCompany2A2BReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { pan, group } = await fetchPanGroup(clientId);

  let tot2a = 0, tot2b = 0;
  const rows: (string | number)[][] = [];
  for (const c of group) {
    const [g2aRow, g2bRow] = await Promise.all([
      fetchFiledReturn(c.id, month, 'GSTR2A'),
      fetchFiledReturn(c.id, month, 'GSTR2B'),
    ]);
    const g2aDocs = g2aRow?.summary && Object.keys(g2aRow.summary).length > 0 ? flattenGstr2aDocs(g2aRow.summary as Gstr2aSummary) : null;
    const g2bDocs = g2bRow?.summary && Object.keys(g2bRow.summary).length > 0 ? flattenGstr2bDocs(g2bRow.summary as Gstr2bSummary) : null;
    const sum = (docs: { txval: number; igst: number; cgst: number; sgst: number }[]) =>
      docs.reduce((a, d) => a + d.txval + d.igst + d.cgst + d.sgst, 0);
    const g2a = g2aDocs ? sum(g2aDocs) : null;
    const g2b = g2bDocs ? sum(g2bDocs) : null;
    if (g2a != null) tot2a += g2a;
    if (g2b != null) tot2b += g2b;
    rows.push([
      c.name, c.gstin || '—',
      g2aDocs ? g2aDocs.length : 'NOT PULLED', g2a ?? '',
      g2bDocs ? g2bDocs.length : 'NOT PULLED', g2b ?? '',
      (g2a != null && g2b != null) ? g2b - g2a : '',
    ]);
  }
  rows.push(['TOTAL — PAN ' + pan, '', '', tot2a, '', tot2b, tot2b - tot2a]);

  return {
    title: 'GSTR 2A/2B Multiple Company Report',
    subtitle: `PAN: ${pan}   |   ${group.length} GSTIN(s)   |   Period: ${formatMonthLabel(month)}   |   Both sides pulled directly from the portal (B2B documents only) for each entity — not the Excel-imported 2A/2B. NOT PULLED means that GSTIN hasn't been pulled for this period yet.`,
    headers: ['Entity (GSTIN)', 'GSTIN', '2A Doc Count', '2A Total (Value + Tax)', '2B Doc Count', '2B Total (Value + Tax)', '2B − 2A'],
    rows,
    fileNameBase: `PAN_Multiple_Company_2A2B_${pan}_${month.replace('/', '-')}`,
    columnWidths: [28, 18, 12, 18, 12, 18, 14],
  };
};

// ────── REPORT 4: Net Output Liability Report (PAN) ───────────────────────
// Distinct from "Output Liability as per GSTR 1 and GSTR 3B" above: that
// report compares two independent as-filed figures for the same GROSS
// liability; this one rolls up the return's own as-filed total payable
// (aggregate, after ITC set-off) per GSTIN under a PAN.

export const buildPanNetOutputLiabilityReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { pan, group } = await fetchPanGroup(clientId);

  let totLiab = 0, totItcNet = 0, totPayable = 0, pulled = 0;
  const rows: (string | number)[][] = [];
  for (const c of group) {
    const g3row = await fetchFiledReturn(c.id, month, 'GSTR3B');
    if (!g3row?.summary || Object.keys(g3row.summary).length === 0) {
      rows.push([c.name, c.gstin || '—', 'NOT PULLED', '', '']);
      continue;
    }
    pulled++;
    const s = g3row.summary as Gstr3bSummary;
    const liab = totalLiability(s);
    const itcNet = num(s.itc_elg?.itc_net?.iamt) + num(s.itc_elg?.itc_net?.camt) + num(s.itc_elg?.itc_net?.samt);
    const payable = num(s.tt_val?.tt_pay);
    totLiab += liab; totItcNet += itcNet; totPayable += payable;
    rows.push([c.name, c.gstin || '—', liab, itcNet, payable]);
  }
  rows.push(['TOTAL — PAN ' + pan, '', totLiab, totItcNet, totPayable]);

  return {
    title: 'Net Output Liability Report (PAN-Based)',
    subtitle: `PAN: ${pan}   |   ${group.length} GSTIN(s), ${pulled} pulled for this period   |   Period: ${formatMonthLabel(month)}   |   As filed on the portal's GSTR-3B for each entity — "Indicative Net Payable" is the return's own as-filed total payable (aggregate).`,
    headers: ['Entity (GSTIN)', 'GSTIN', 'Total Liability', 'Net ITC Available', 'Total Payable (as filed)'],
    rows,
    fileNameBase: `PAN_Net_Output_Liability_${pan}_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 18, 18, 20],
  };
};
