// GSTR-3B / GSTR-1 / GSTR-2B "as filed on the portal" — reads gst_filed_returns,
// populated by the extension's direct JSON-API pulls (content.js
// handleGstr3bPull/handleGstr1Pull/handleGstr2bPull; see CLAUDE.md context on
// why these exist as a separate table from the app's own computed drafts).
// One row per client+period_month+return_type; `summary` is the raw portal
// JSON, flattened here into a display table rather than modelled field-by-
// field, since the portal's own section/head names are already the
// authoritative labels a reviewer would expect to see.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { formatMonthLabel } from './allClientsReports';

interface ClientLite { id: string; name: string; gstin: string; }

const fileSafe = (s: string) => s.replace(/\s+/g, '_');
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const fetchClient = async (clientId: string): Promise<ClientLite> => {
  const { data } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  return (data || { id: clientId, name: 'Unknown', gstin: '' }) as ClientLite;
};

export interface FiledReturnRow {
  arn: string | null;
  filed_date: string | null;
  status: string | null;
  summary: Record<string, unknown>;
}

// Loose shapes for the pieces of each portal JSON blob this file actually
// reads — the raw payloads carry far more than this (amendment sections,
// checksums, IRNs…), so these are deliberately partial, not a full model.
export interface HeadAmt { txval?: number; iamt?: number; camt?: number; samt?: number; csamt?: number; tx?: number; }
export interface TypedAmt extends HeadAmt { ty?: string; }
export interface Gstr3bSummary {
  sup_details?: { osup_det?: HeadAmt; osup_zero?: HeadAmt; osup_nil_exmp?: HeadAmt; osup_nongst?: HeadAmt; isup_rev?: HeadAmt };
  itc_elg?: { itc_avl?: TypedAmt[]; itc_rev?: TypedAmt[]; itc_inelg?: TypedAmt[]; itc_net?: HeadAmt };
  intr_ltfee?: { intr_details?: HeadAmt; ltfee_details?: HeadAmt };
  tt_val?: { tt_csh_pd?: number; tt_itc_pd?: number; tt_pay?: number };
}
export interface Gstr1Section {
  sec_nm?: string; ttl_rec?: number; ttl_val?: number; ttl_doc_issued?: number;
  ttl_igst?: number; ttl_cgst?: number; ttl_sgst?: number; ttl_cess?: number;
}
export interface Gstr1Summary { sec_sum?: Gstr1Section[]; }
export interface Gstr2bInvoice { inum?: string; dt?: string; txval?: number; iamt?: number; camt?: number; sgst?: number; samt?: number; itcavl?: string; }
export interface Gstr2bSupplier { ctin?: string; trdnm?: string; supfildt?: string; inv?: Gstr2bInvoice[]; }
export interface Gstr2bSummary { docdata?: { b2b?: Gstr2bSupplier[] } }
// GSTR-2A's invoice shape differs from 2B's (idt not dt, samt not sgst, no
// itcavl at all — eligibility isn't part of this payload) — the extension's
// handleGstr2aPull normalizes the supplier wrapper to match 2B's shape
// (ctin/trdnm/supfildt) but leaves each invoice exactly as the portal sent it.
export interface Gstr2aInvoice { inum?: string; idt?: string; txval?: number; iamt?: number; camt?: number; samt?: number; rchrg?: string; }
export interface Gstr2aSupplier { ctin?: string; trdnm?: string | null; supfildt?: string | null; inv?: Gstr2aInvoice[]; }
export interface Gstr2aSummary { b2b?: Gstr2aSupplier[] }

export const fetchFiledReturn = async (clientId: string, period: string, returnType: string): Promise<FiledReturnRow | null> => {
  const { data, error } = await supabase
    .from('gst_filed_returns')
    .select('arn, filed_date, status, summary')
    .eq('client_id', clientId).eq('period_month', period).eq('return_type', returnType)
    .maybeSingle();
  if (error) throw error;
  return (data as FiledReturnRow) || null;
};

export const notPulledMsg = (client: ClientLite, period: string, label: string) =>
  `No filed ${label} on record for ${client.name} in ${formatMonthLabel(period)}. Use "Pull" on this report to fetch it directly from the GST portal.`;

// ─────────────────── GSTR-3B (filed) ───────────────────────────────────────

export const buildFiledGstr3bReport = async (clientId: string, period: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const row = await fetchFiledReturn(clientId, period, 'GSTR3B');
  if (!row || !row.summary || Object.keys(row.summary).length === 0) {
    throw new Error(notPulledMsg(client, period, 'GSTR-3B'));
  }
  const s = row.summary as Gstr3bSummary;
  const sup = s.sup_details || {};
  const itc = s.itc_elg || {};
  const intr = s.intr_ltfee || {};
  const tt = s.tt_val || {};

  const head = (o?: HeadAmt) => [num(o?.txval), num(o?.iamt), num(o?.camt), num(o?.samt), num(o?.csamt)];
  const findItc = (arr: TypedAmt[] | undefined, ty: string) => (Array.isArray(arr) ? arr.find((x) => x.ty === ty) : undefined);

  const rows: (string | number)[][] = [
    ['3.1(a) Outward taxable (other than zero rated, nil, exempt)', ...head(sup.osup_det)],
    ['3.1(b) Outward zero-rated (exports/SEZ)', ...head(sup.osup_zero)],
    ['3.1(c) Nil rated / exempt outward', ...head(sup.osup_nil_exmp)],
    ['3.1(d) Inward liable to reverse charge', ...head(sup.isup_rev)],
    ['3.1(e) Non-GST outward', ...head(sup.osup_nongst)],
    ['4(A) ITC Available — Import of goods', ...head(findItc(itc.itc_avl, 'IMPG'))],
    ['4(A) ITC Available — Import of services', ...head(findItc(itc.itc_avl, 'IMPS'))],
    ['4(A) ITC Available — Inward reverse charge', ...head(findItc(itc.itc_avl, 'ISRC'))],
    ['4(A) ITC Available — ISD', ...head(findItc(itc.itc_avl, 'ISD'))],
    ['4(A) ITC Available — All other ITC', ...head(findItc(itc.itc_avl, 'OTH'))],
    ['4(B) ITC Reversed — As per rules', ...head(findItc(itc.itc_rev, 'RUL'))],
    ['4(B) ITC Reversed — Others', ...head(findItc(itc.itc_rev, 'OTH'))],
    ['4(C) Net ITC available', ...head(itc.itc_net)],
    ['4(D) Ineligible ITC — As per rules', ...head(findItc(itc.itc_inelg, 'RUL'))],
    ['4(D) Ineligible ITC — Others', ...head(findItc(itc.itc_inelg, 'OTH'))],
    ['5.1 Interest', num(intr.intr_details?.tx ?? intr.intr_details?.iamt ?? 0), num(intr.intr_details?.iamt), num(intr.intr_details?.camt), num(intr.intr_details?.samt), num(intr.intr_details?.csamt)],
    ['5.1 Late fee', num(intr.ltfee_details?.tx ?? 0), num(intr.ltfee_details?.iamt), num(intr.ltfee_details?.camt), num(intr.ltfee_details?.samt), num(intr.ltfee_details?.csamt)],
  ];
  rows.push(['Total cash paid', num(tt.tt_csh_pd), '', '', '', '']);
  rows.push(['Total ITC utilised', num(tt.tt_itc_pd), '', '', '', '']);
  rows.push(['Total payable', num(tt.tt_pay), '', '', '', '']);

  return {
    title: 'GSTR-3B (Filed on Portal)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${formatMonthLabel(period)}   |   ARN: ${row.arn || '—'}   |   Filed: ${row.filed_date || '—'}   |   Status: ${row.status || '—'}`,
    headers: ['Table / Head', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess'],
    rows,
    fileNameBase: `GSTR3B_Filed_${fileSafe(client.name)}_${period.replace('/', '-')}`,
    columnWidths: [42, 16, 14, 14, 14, 12],
  };
};

// ─────────────────── GSTR-1 (filed) ────────────────────────────────────────

const GSTR1_SECTION_ORDER: [string, string][] = [
  ['B2B', 'B2B Invoices'],
  ['B2CL', 'B2C (Large)'],
  ['B2CS', 'B2C (Small)'],
  ['EXP', 'Exports'],
  ['CDNR', 'Credit/Debit Notes (Registered)'],
  ['CDNUR', 'Credit/Debit Notes (Unregistered)'],
  ['NIL', 'Nil Rated / Exempt / Non-GST'],
  ['AT', 'Advances Received'],
  ['TXPD', 'Advances Adjusted'],
  ['HSN', 'HSN Summary'],
  ['DOC_ISSUE', 'Documents Issued'],
  ['SUPECOM', 'Supplies via E-Commerce Operator'],
  ['TTL_LIAB', 'TOTAL LIABILITY'],
];

export const buildFiledGstr1Report = async (clientId: string, period: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const row = await fetchFiledReturn(clientId, period, 'GSTR1');
  if (!row || !row.summary || Object.keys(row.summary).length === 0) {
    throw new Error(notPulledMsg(client, period, 'GSTR-1'));
  }
  const s = row.summary as Gstr1Summary;
  const secs: Gstr1Section[] = Array.isArray(s.sec_sum) ? s.sec_sum : [];
  const byName = new Map(secs.map((sec) => [sec.sec_nm, sec]));

  const rows: (string | number)[][] = GSTR1_SECTION_ORDER
    .map(([code, label]) => {
      const sec = byName.get(code);
      if (!sec) return null;
      return [
        label,
        num(sec.ttl_rec), num(sec.ttl_val ?? sec.ttl_doc_issued),
        num(sec.ttl_igst), num(sec.ttl_cgst), num(sec.ttl_sgst), num(sec.ttl_cess),
      ];
    })
    .filter((r): r is (string | number)[] => r !== null);

  if (rows.length === 0) {
    throw new Error(`GSTR-1 summary was pulled for ${client.name} in ${formatMonthLabel(period)} but had no recognisable sections — the portal's JSON shape may have changed.`);
  }

  return {
    title: 'GSTR-1 (Filed on Portal)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${formatMonthLabel(period)}   |   ARN: ${row.arn || '—'}   |   Filed: ${row.filed_date || '—'}   |   Status: ${row.status || '—'}   |   Current period only — amendment (…A) sections not shown.`,
    headers: ['Section', 'Records', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess'],
    rows,
    fileNameBase: `GSTR1_Filed_${fileSafe(client.name)}_${period.replace('/', '-')}`,
    columnWidths: [34, 10, 16, 14, 14, 14, 12],
  };
};

// Flattened B2B document shape shared by both 2A and 2B — used here and by
// the rate-wise/supplier-wise/PY-in-CY reports (gstr2aReports.ts/
// gstr2bReports.ts), which used to read the Excel-imported twob_import_docs/
// gstr2a_import_docs but now read this same portal-pulled document data
// instead, so every 2A/2B report in the Reports Hub is portal-sourced.
export interface FlatB2bDoc { ctin: string; trdnm: string; inum: string; date: string; txval: number; igst: number; cgst: number; sgst: number; itcavl?: string; }

export const flattenGstr2bDocs = (s: Gstr2bSummary): FlatB2bDoc[] => {
  const out: FlatB2bDoc[] = [];
  for (const supplier of s.docdata?.b2b || []) {
    for (const inv of supplier.inv || []) {
      out.push({
        ctin: supplier.ctin || '—', trdnm: supplier.trdnm || '—',
        inum: inv.inum || '—', date: inv.dt || '—',
        txval: num(inv.txval), igst: num(inv.iamt), cgst: num(inv.camt), sgst: num(inv.sgst ?? inv.samt),
        itcavl: inv.itcavl,
      });
    }
  }
  return out;
};

export const flattenGstr2aDocs = (s: Gstr2aSummary): FlatB2bDoc[] => {
  const out: FlatB2bDoc[] = [];
  for (const supplier of s.b2b || []) {
    for (const inv of supplier.inv || []) {
      out.push({
        ctin: supplier.ctin || '—', trdnm: supplier.trdnm || '—',
        inum: inv.inum || '—', date: inv.idt || '—',
        txval: num(inv.txval), igst: num(inv.iamt), cgst: num(inv.camt), sgst: num(inv.samt),
      });
    }
  }
  return out;
};

// ─────────────────── GSTR-2A (document-level, B2B only) ────────────────────

export const buildFiledGstr2aReport = async (clientId: string, period: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const row = await fetchFiledReturn(clientId, period, 'GSTR2A');
  if (!row || !row.summary || Object.keys(row.summary).length === 0) {
    throw new Error(notPulledMsg(client, period, 'GSTR-2A'));
  }
  const s = row.summary as Gstr2aSummary;
  const b2b: Gstr2aSupplier[] = Array.isArray(s.b2b) ? s.b2b : [];

  const rows: (string | number)[][] = [];
  for (const supplier of b2b) {
    const invs: Gstr2aInvoice[] = Array.isArray(supplier.inv) ? supplier.inv : [];
    for (const inv of invs) {
      rows.push([
        supplier.ctin || '—', supplier.trdnm || '—',
        inv.inum || '—', inv.idt || '—',
        num(inv.txval), num(inv.iamt), num(inv.camt), num(inv.samt),
        supplier.supfildt || '—',
      ]);
    }
  }

  if (rows.length === 0) {
    throw new Error(`GSTR-2A was pulled for ${client.name} in ${formatMonthLabel(period)} but had no B2B documents to show.`);
  }

  let totTx = 0, totI = 0, totC = 0, totS = 0;
  for (const r of rows) { totTx += num(r[4]); totI += num(r[5]); totC += num(r[6]); totS += num(r[7]); }
  rows.push(['', '', '', 'TOTAL', totTx, totI, totC, totS, '']);

  return {
    title: 'GSTR-2A (Portal, Document-Level)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${formatMonthLabel(period)}   |   Status: ${row.status || '—'}   |   B2B only — CDNR/ISD/TDS/TCS sections not yet flattened.`,
    headers: ['Supplier GSTIN', 'Supplier Name', 'Invoice No.', 'Invoice Date', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Supplier Filed On'],
    rows,
    fileNameBase: `GSTR2A_Portal_${fileSafe(client.name)}_${period.replace('/', '-')}`,
    columnWidths: [18, 30, 18, 14, 16, 14, 14, 14, 16],
  };
};

// ─────────────────── GSTR-2B (document-level) ──────────────────────────────

export const buildFiledGstr2bReport = async (clientId: string, period: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const row = await fetchFiledReturn(clientId, period, 'GSTR2B');
  if (!row || !row.summary || Object.keys(row.summary).length === 0) {
    throw new Error(notPulledMsg(client, period, 'GSTR-2B'));
  }
  const s = row.summary as Gstr2bSummary;
  const b2b: Gstr2bSupplier[] = (s.docdata && Array.isArray(s.docdata.b2b)) ? s.docdata.b2b : [];

  const rows: (string | number)[][] = [];
  for (const supplier of b2b) {
    const invs: Gstr2bInvoice[] = Array.isArray(supplier.inv) ? supplier.inv : [];
    for (const inv of invs) {
      rows.push([
        supplier.ctin || '—', supplier.trdnm || '—',
        inv.inum || '—', inv.dt || '—',
        num(inv.txval), num(inv.iamt), num(inv.camt), num(inv.sgst ?? inv.samt),
        inv.itcavl === 'Y' ? 'Yes' : inv.itcavl === 'N' ? 'No' : (inv.itcavl || '—'),
        supplier.supfildt || '—',
      ]);
    }
  }

  if (rows.length === 0) {
    throw new Error(`GSTR-2B was pulled for ${client.name} in ${formatMonthLabel(period)} but had no B2B documents to show.`);
  }

  let totTx = 0, totI = 0, totC = 0, totS = 0;
  for (const r of rows) { totTx += num(r[4]); totI += num(r[5]); totC += num(r[6]); totS += num(r[7]); }
  rows.push(['', '', '', 'TOTAL', totTx, totI, totC, totS, '', '']);

  return {
    title: 'GSTR-2B (Portal, Document-Level)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   ${formatMonthLabel(period)}   |   Status: ${row.status || '—'}   |   B2B only — CDNR/ISD/IMPG sections not yet flattened.`,
    headers: ['Supplier GSTIN', 'Supplier Name', 'Invoice No.', 'Invoice Date', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'ITC Available', 'Supplier Filed On'],
    rows,
    fileNameBase: `GSTR2B_Portal_${fileSafe(client.name)}_${period.replace('/', '-')}`,
    columnWidths: [18, 30, 18, 14, 16, 14, 14, 14, 14, 16],
  };
};
