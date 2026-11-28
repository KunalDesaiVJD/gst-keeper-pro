// Vendor GSTIN Risk Report: the reads. Everything the engine (engine.ts)
// needs for one client and one FY, read from Supabase and handed over as
// plain data, plus the vendor master upload (the one write). Nothing else is
// written. Positions: docs/VENDOR_GSTIN_RISK.md.
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { currentActorId } from '@/lib/changeLogHeaders';
import { reconcile2A2B } from '@/lib/itcReco/reasons';
import { findRow, istDateOf, statementFromRow } from '@/lib/itcReco/sources';
import { istToday } from '@/lib/itcReco/dates';
import type { RecoDoc, SourceKey, StatementRow } from '@/lib/itcReco/types';
import { fetchClient } from '@/utils/filedReturnReports';
import {
  fyPeriods, isoDate, type BookLite, type FilingLite, type ImportDocLite, type LedgerLite, type LookupErrorLite, type LookupLite, type LookupRunLite,
  type MasterLite, type RecoFinding, type StatementInfo, type VendorRiskInput,
} from './engine';
import { checkGstin, normGstin } from './gstin';

const RETURN_TYPE: Record<'2A' | '2B', string> = { '2A': 'GSTR2A', '2B': 'GSTR2B' };
const SOURCE_OF: Record<string, SourceKey> = { GSTR2A: '2A', GSTR2B: '2B' };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const pad2 = (n: number) => String(n).padStart(2, '0');
const pFrom = (i: number) => `${pad2((i % 12) + 1)}/${Math.floor(i / 12)}`;

/** PostgREST's "no such relation" (the migration not applied yet). */
const isMissingRelation = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /does not exist|could not find the table|schema cache/i.test(e.message ?? ''));

/**
 * The FY's 2A and 2B, and around them the months a month's reconciliation
 * reads (two before April, three after March).
 */
async function loadStatements(clientId: string, fy: string): Promise<StatementRow[]> {
  const start = Number(fy.slice(0, 4)) * 12 + 3;
  const periods = Array.from({ length: 17 }, (_, i) => pFrom(start - 2 + i));
  const { data, error } = await supabase
    .from('gst_filed_returns')
    .select('period_month, return_type, status, summary, updated_at')
    .eq('client_id', clientId)
    .in('return_type', ['GSTR2A', 'GSTR2B'])
    .in('period_month', periods);
  if (error) throw error;
  return (data || []).map((r) => ({ source: SOURCE_OF[r.return_type], period: r.period_month, status: r.status, summary: r.summary, updatedAt: r.updated_at }));
}

/** Each FY month's GSTR-2A vs 2B reconciliation, where both are pulled; a month that cannot run is skipped. */
function runReco(rows: StatementRow[], fy: string, client: { name: string; gstin: string | null }, today: string) {
  const periods: string[] = [];
  const reco: RecoFinding[] = [];
  for (const period of fyPeriods(fy)) {
    try {
      const run = reconcile2A2B({ period, client, rows, today });
      periods.push(period);
      for (const r of run.result.rows) {
        const d = r.right ?? r.left;
        if (!d?.ctin) continue;
        reco.push({ ctin: d.ctin, period, reason: r.reason, notes: r.notes.map((n) => n.code), tax: d.igst + d.cgst + d.sgst + d.cess });
      }
    } catch {
      // Not pulled, not generated or failed: the vendor rows say what is missing.
    }
  }
  return { periods, reco };
}

interface LatestRow {
  gstin: string | null; status: string | null; looked_up_at: string | null; source: string | null; legal_name: string | null; trade_name: string | null;
  reg_status: string | null; reg_date: string | null; cancel_date: string | null; cancel_reason: string | null; taxpayer_type: string | null;
  constitution: string | null; nature_of_business: string[] | null; ato_slab: string | null; einvoice_status: string | null; filings: unknown;
  upload_file: string | null; last_g1: string | null; last_g3: string | null;
}

async function loadLookups(gstins: string[]): Promise<LookupLite[] | null> {
  const out: LookupLite[] = [];
  for (let i = 0; i < gstins.length; i += 150) {
    const chunk = gstins.slice(i, i + 150);
    // The typed client cannot type JSON paths (payload->>...): the row's shape is written out here.
    const view = supabase.from('vendor_gstin_latest') as unknown as {
      select: (cols: string) => { in: (c: string, v: string[]) => PromiseLike<{ data: LatestRow[] | null; error: { code?: string; message?: string } | null }> };
    };
    const { data, error } = await view
      .select('gstin, status, looked_up_at, source, legal_name, trade_name, reg_status, reg_date, cancel_date, cancel_reason, taxpayer_type, constitution, nature_of_business, ato_slab, einvoice_status, filings, upload_file:payload->>file_name, last_g1:payload->>last_gstr1_filed, last_g3:payload->>last_gstr3b_filed')
      .in('gstin', chunk);
    if (error) {
      if (isMissingRelation(error)) return null;
      throw error;
    }
    for (const r of data || []) {
      if (!r.gstin || (r.status !== 'ok' && r.status !== 'not_found')) continue;
      out.push({
        gstin: r.gstin,
        status: r.status,
        lookedUpAt: r.looked_up_at ?? '',
        source: r.source,
        legalName: r.legal_name,
        tradeName: r.trade_name,
        regStatus: r.reg_status,
        regDate: r.reg_date,
        cancelDate: r.cancel_date,
        cancelReason: r.cancel_reason,
        taxpayerType: r.taxpayer_type,
        constitution: r.constitution,
        natureOfBusiness: r.nature_of_business,
        atoSlab: r.ato_slab,
        einvoiceStatus: r.einvoice_status,
        filings: Array.isArray(r.filings) ? (r.filings as unknown as FilingLite[]).filter((f) => f && typeof f === 'object' && typeof f.rtntype === 'string') : null,
        uploadFile: r.upload_file ?? null,
        lastGstr1Filed: r.last_g1 ?? null,
        lastGstr3bFiled: r.last_g3 ?? null,
      });
    }
  }
  return out;
}

/** The latest failed lookup of each GSTIN (the view hides error rows; the report names the failure). */
async function loadLookupErrors(gstins: string[]): Promise<LookupErrorLite[]> {
  const latest = new Map<string, LookupErrorLite>();
  for (let i = 0; i < gstins.length; i += 150) {
    const { data, error } = await supabase
      .from('vendor_gstin_lookups')
      .select('gstin, looked_up_at, error, run_id')
      .in('gstin', gstins.slice(i, i + 150))
      .eq('status', 'error')
      .order('looked_up_at', { ascending: false })
      .limit(2000);
    if (error) {
      // run_id is new (20261128120000): read without it on a database that does not have it.
      if (/run_id/.test(error.message ?? '')) {
        const again = await supabase.from('vendor_gstin_lookups').select('gstin, looked_up_at, error').in('gstin', gstins.slice(i, i + 150)).eq('status', 'error').order('looked_up_at', { ascending: false }).limit(2000);
        if (again.error) { if (isMissingRelation(again.error)) return []; throw again.error; }
        for (const r of again.data || []) if (!latest.has(r.gstin)) latest.set(r.gstin, { gstin: r.gstin, at: r.looked_up_at, error: r.error, runId: null });
        continue;
      }
      if (isMissingRelation(error)) return [];
      throw error;
    }
    for (const r of data || []) if (!latest.has(r.gstin)) latest.set(r.gstin, { gstin: r.gstin, at: r.looked_up_at, error: r.error, runId: r.run_id });
  }
  return [...latest.values()];
}

/** The client's lookup runs of the FY, newest first (vendor_lookup_runs, 20261128120000), with the requester's name. */
async function loadRuns(clientId: string, fy: string): Promise<LookupRunLite[]> {
  const { data, error } = await supabase
    .from('vendor_lookup_runs')
    .select('id, status, stage, requested_at, requested_by, planned, gstins, found, not_found, failed, stop_reason, heartbeat_at, finished_at, extension_version, page_url')
    .eq('client_id', clientId)
    .eq('fy', fy)
    .order('requested_at', { ascending: false })
    .limit(20);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  const rows = data || [];
  const ids = [...new Set(rows.map((r) => r.requested_by).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: ps } = await supabase.from('profiles').select('user_id, first_name, email').in('user_id', ids);
    for (const p of ps || []) names.set(p.user_id, p.first_name || p.email || p.user_id);
  }
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    stage: r.stage,
    requestedAt: r.requested_at,
    requestedBy: r.requested_by ? names.get(r.requested_by) ?? null : null,
    planned: r.planned ?? 0,
    gstins: r.gstins ?? [],
    found: r.found ?? 0,
    notFound: r.not_found ?? 0,
    failed: r.failed ?? 0,
    stopReason: r.stop_reason,
    heartbeatAt: r.heartbeat_at,
    finishedAt: r.finished_at,
    extensionVersion: r.extension_version,
    pageUrl: r.page_url,
    // The extension stores page_url with the snapshot (never one without the other); the 40k text is not read here.
    hasSnapshot: !!r.page_url,
  }));
}

async function loadMaster(clientId: string): Promise<{ master: MasterLite[]; file: VendorRiskInput['masterFile'] }> {
  const { data, error } = await supabase
    .from('vendor_master_entries')
    .select('gstin, vendor_name, vendor_code, uploaded_at, file_name')
    .eq('client_id', clientId)
    .order('uploaded_at', { ascending: false })
    .limit(10000);
  if (error) {
    if (isMissingRelation(error)) return { master: [], file: null };
    throw error;
  }
  const rows = data || [];
  return {
    master: rows.map((r) => ({ gstin: r.gstin, name: r.vendor_name, code: r.vendor_code })),
    file: rows.length ? { fileName: rows[0].file_name, uploadedAt: rows[0].uploaded_at } : null,
  };
}

interface LedgerRow { supplier_gstin: string | null; supplier_name: string | null; period_month: string; input_igst: number | null; input_cgst: number | null; input_sgst: number | null }

/** Everything the engine reads for the client and the FY of `month`. */
export async function loadVendorRiskInput(clientId: string, fy: string): Promise<VendorRiskInput> {
  const today = istToday();
  const months = fyPeriods(fy);
  const [client, stmtRows, importRows, bookRows, nib2b, nibBooks, master] = await Promise.all([
    fetchClient(clientId),
    loadStatements(clientId, fy),
    fetchAllRows<{ supplier_gstin: string | null; supplier_name: string | null; period_month: string; supplier_invoice_number: string | null; input_igst: number | null; input_cgst: number | null; input_sgst: number | null; cess: number | null; irn: string | null }>(
      'twob_import_docs', 'supplier_gstin, supplier_name, period_month, supplier_invoice_number, input_igst, input_cgst, input_sgst, cess, irn',
      (q) => q.eq('client_id', clientId).in('period_month', months).order('id')),
    fetchAllRows<{ id: string; supplier_gstin: string | null; supplier_name: string | null; period_month: string; supplier_invoice_number: string | null; doc_type: string | null; date: string | null; input_igst: number | null; input_cgst: number | null; input_sgst: number | null }>(
      'books_register', 'id, supplier_gstin, supplier_name, period_month, supplier_invoice_number, doc_type, date, input_igst, input_cgst, input_sgst',
      (q) => q.eq('client_id', clientId).in('period_month', months).order('id')),
    fetchAllRows<LedgerRow & { reclaim_month: string | null }>(
      'bills_not_in_2b', 'supplier_gstin, supplier_name, period_month, input_igst, input_cgst, input_sgst, reclaim_month',
      (q) => q.eq('client_id', clientId).in('period_month', months).order('id')),
    fetchAllRows<LedgerRow & { book_entry_month: string | null }>(
      'bills_not_in_books', 'supplier_gstin, supplier_name, period_month, input_igst, input_cgst, input_sgst, book_entry_month',
      (q) => q.eq('client_id', clientId).in('period_month', months).order('id')),
    loadMaster(clientId),
  ]);
  const clientLite = { name: client.name, gstin: client.gstin || null };

  // The FY's statements (April to March) and their documents.
  const statements: StatementInfo[] = [];
  const docs2A: RecoDoc[] = [];
  const docs2B: RecoDoc[] = [];
  for (const period of months) {
    for (const source of ['2A', '2B'] as const) {
      const s = statementFromRow(findRow(stmtRows, source, period), source, period);
      statements.push({ source, period, state: s.meta.state, pulledAt: s.meta.pulledAt ?? istDateOf(findRow(stmtRows, source, period)?.updatedAt) });
      (source === '2A' ? docs2A : docs2B).push(...s.docs);
    }
  }
  const { periods: recoPeriods, reco } = runReco(stmtRows, fy, clientLite, today);

  const tax = (r: { input_igst: number | null; input_cgst: number | null; input_sgst: number | null }) => num(r.input_igst) + num(r.input_cgst) + num(r.input_sgst);
  const importDocs: ImportDocLite[] = importRows.filter((r) => r.supplier_gstin).map((r) => ({
    gstin: r.supplier_gstin as string, name: r.supplier_name, period: r.period_month, number: r.supplier_invoice_number, tax: tax(r) + num(r.cess), irn: r.irn,
  }));
  const books: BookLite[] = bookRows.filter((r) => r.supplier_gstin).map((r) => ({
    id: r.id, gstin: r.supplier_gstin as string, name: r.supplier_name, period: r.period_month, number: r.supplier_invoice_number, docType: r.doc_type, date: r.date, tax: tax(r),
  }));
  // The ledgers as they stand at the FY's latest month holding any entry.
  const idx = (p: string) => Number(p.slice(3)) * 12 + Number(p.slice(0, 2));
  const ledgerAsOf = [...nib2b, ...nibBooks].map((r) => r.period_month).sort((a, b) => idx(a) - idx(b)).pop() ?? null;
  const notIn2B: LedgerLite[] = nib2b.filter((r) => r.period_month === ledgerAsOf && !r.reclaim_month && r.supplier_gstin)
    .map((r) => ({ gstin: r.supplier_gstin as string, name: r.supplier_name, tax: tax(r) }));
  const notInBooks: LedgerLite[] = nibBooks.filter((r) => r.period_month === ledgerAsOf && !r.book_entry_month && r.supplier_gstin)
    .map((r) => ({ gstin: r.supplier_gstin as string, name: r.supplier_name, tax: tax(r) }));

  const gstins = [...new Set([
    ...docs2A.map((d) => d.ctin), ...docs2B.map((d) => d.ctin), ...importDocs.map((d) => d.gstin), ...books.map((d) => d.gstin),
    ...notIn2B.map((d) => d.gstin), ...notInBooks.map((d) => d.gstin), ...master.master.map((m) => m.gstin),
  ].map(normGstin).filter((g) => g.length === 15))];
  const [lookups, lookupErrors, runs] = await Promise.all([loadLookups(gstins), loadLookupErrors(gstins), loadRuns(clientId, fy)]);

  return {
    client: clientLite, fy, today, statements, docs2A, docs2B, importDocs, books, ledgerAsOf, notIn2B, notInBooks,
    recoPeriods, reco, master: master.master, masterFile: master.file, lookups, lookupErrors, runs, now: new Date().toISOString(),
  };
}

// ── Vendor master upload ────────────────────────────────────────────────────

const GSTIN_HEAD = /\b(gstin|gstn|gst\s*(no|number|reg(istration)?\s*(no|number)?|in)|gst\s*id)\b/i;
const NAME_HEAD = /\b(vendor|supplier|party|creditor|ledger|account)?\s*name\b|^(vendor|supplier|party|creditor|particulars)$/i;
const CODE_HEAD = /\b(code|vendor\s*id|supplier\s*id|ledger\s*id|vendor\s*no)\b/i;

export interface ParsedMaster { rows: MasterLite[]; invalid: string[]; duplicates: number; sheet: string }

/** The vendor master file (xlsx / xls / csv) → rows. Finds the header row among the first 25 rows of each sheet. */
export function parseVendorMaster(data: ArrayBuffer | Uint8Array): ParsedMaster {
  const wb = XLSX.read(data, { type: 'array' });
  for (const sheet of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[sheet], { header: 1, raw: false, defval: null });
    for (let h = 0; h < Math.min(25, grid.length); h += 1) {
      const head = (grid[h] || []).map((c) => String(c ?? '').trim());
      const g = head.findIndex((c) => GSTIN_HEAD.test(c));
      if (g === -1) continue;
      const n = head.findIndex((c, i) => i !== g && NAME_HEAD.test(c) && !GSTIN_HEAD.test(c));
      const k = head.findIndex((c, i) => i !== g && i !== n && CODE_HEAD.test(c) && !GSTIN_HEAD.test(c));
      const seen = new Set<string>();
      const rows: MasterLite[] = [];
      const invalid: string[] = [];
      let duplicates = 0;
      for (const r of grid.slice(h + 1)) {
        const gstin = normGstin(String(r?.[g] ?? ''));
        if (!gstin) continue;
        if (seen.has(gstin)) { duplicates += 1; continue; }
        seen.add(gstin);
        if (!checkGstin(gstin).valid) invalid.push(gstin);
        rows.push({ gstin, name: n >= 0 ? String(r?.[n] ?? '').trim() || null : null, code: k >= 0 ? String(r?.[k] ?? '').trim() || null : null });
      }
      if (rows.length) return { rows, invalid, duplicates, sheet };
    }
  }
  throw new Error('No GSTIN column found: the file needs a header row with a "GSTIN" column (and a "Vendor Name" column), in the first 25 rows of a sheet.');
}

/** Replaces the client's vendor master with the file's rows. Returns what was saved, in words. */
export async function uploadVendorMaster({ clientId, file }: { clientId: string; periods: string[]; file: File; uploadedBy: string | null }): Promise<string> {
  const parsed = parseVendorMaster(await file.arrayBuffer());
  const at = new Date().toISOString();
  const by = currentActorId();
  // The new rows first, then the earlier upload's: a failed insert leaves the earlier master in place.
  for (let i = 0; i < parsed.rows.length; i += 500) {
    const { error } = await supabase.from('vendor_master_entries').insert(parsed.rows.slice(i, i + 500).map((r) => ({
      client_id: clientId, gstin: r.gstin, vendor_name: r.name, vendor_code: r.code, uploaded_at: at, uploaded_by: by, file_name: file.name,
    })));
    if (error) {
      if (isMissingRelation(error)) throw new Error('The vendor master table is not set up yet (migration 20261127140000_vendor_gstin_risk.sql is not applied).');
      await supabase.from('vendor_master_entries').delete().eq('client_id', clientId).eq('uploaded_at', at);
      throw error;
    }
  }
  const del = await supabase.from('vendor_master_entries').delete().eq('client_id', clientId).neq('uploaded_at', at);
  if (del.error) throw del.error;
  const notes = [
    parsed.invalid.length ? `${parsed.invalid.length} GSTIN${parsed.invalid.length === 1 ? '' : 's'} fail the check digit (listed as Invalid in the report)` : '',
    parsed.duplicates ? `${parsed.duplicates} repeated GSTIN${parsed.duplicates === 1 ? '' : 's'} kept once` : '',
  ].filter(Boolean);
  return `Vendor master saved: ${parsed.rows.length} vendors from sheet "${parsed.sheet}" of ${file.name}, replacing the earlier upload.${notes.length ? ` ${notes.join('; ')}.` : ''}`;
}

// ── Vendor lookup sheet upload (the firm's fallback when the portal will not answer) ──

/** The sheet's columns, as the report reads them. */
export const LOOKUP_SHEET_COLUMNS = [
  'GSTIN', 'Legal name', 'Trade name', 'Status', 'Registration date', 'Cancellation date', 'Taxpayer type', 'Constitution', 'Address',
  'Last GSTR-1 filed', 'Last GSTR-3B filed', 'e-invoice (Yes/No)',
] as const;

type SheetField = 'gstin' | 'legal' | 'trade' | 'status' | 'regDate' | 'cancelDate' | 'taxpayerType' | 'constitution' | 'address' | 'lastG1' | 'lastG3' | 'einv';

/** Header words → field, the first rule that matches wins (so "GSTIN / UIN Status" is the status, "GSTR-3B" never GSTR-1). */
const SHEET_RULES: [SheetField, (h: string) => boolean][] = [
  ['lastG3', (h) => /gstr\s*[-.]?\s*3\s*b/i.test(h)],
  ['lastG1', (h) => /gstr\s*[-.]?\s*1(?!\d)/i.test(h)],
  ['einv', (h) => /e\s*[-.]?\s*invoic|\beinv|\birn\b/i.test(h)],
  ['cancelDate', (h) => /cancel/i.test(h) && /\b(date|from|on|w\.?e\.?f)\b/i.test(h)],
  ['regDate', (h) => /(registration|regn?\.?|effective)\s*date|date\s*of\s*(registration|regn?)|registered\s*(on|from)/i.test(h)],
  ['taxpayerType', (h) => /taxpayer\s*type|type\s*of\s*(tax\s*payer|taxpayer|registration|dealer)|dealer\s*type|registration\s*type/i.test(h)],
  ['status', (h) => /status/i.test(h)],
  ['constitution', (h) => /constitution/i.test(h)],
  ['legal', (h) => /legal|name\s*of\s*(the\s*)?business|^(vendor|supplier|party)?\s*name$/i.test(h)],
  ['trade', (h) => /trade/i.test(h)],
  ['address', (h) => /address|place\s*of\s*business/i.test(h)],
  ['gstin', (h) => GSTIN_HEAD.test(h)],
];
const classify = (h: string): SheetField | null => {
  const t = h.trim();
  if (!t) return null;
  for (const [f, test] of SHEET_RULES) if (test(t)) return f;
  return null;
};

export interface LookupSheetRow {
  gstin: string;
  legal_name: string | null;
  trade_name: string | null;
  reg_status: string | null;
  reg_date: string | null;
  cancel_date: string | null;
  taxpayer_type: string | null;
  constitution: string | null;
  address: string | null;
  einvoice_status: string | null;
  last_gstr1_filed: string | null;
  last_gstr3b_filed: string | null;
  /** The sheet's row as it came (header → cell), and its row number. */
  raw: Record<string, string>;
  rowNumber: number;
}
export interface ParsedLookupSheet { rows: LookupSheetRow[]; invalid: string[]; duplicates: number; sheet: string; columns: Partial<Record<SheetField, string>>; badDates: number }

const cellText = (v: unknown): string => {
  if (v instanceof Date) {
    const d = new Date(v.getTime() + 12 * 3600_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return v == null ? '' : String(v).trim();
};
const yesNo = (s: string): string | null => {
  if (!s) return null;
  if (/^(y|yes|true|1|enabled|applicable|active)$/i.test(s)) return 'Yes';
  if (/^(n|no|false|0|not\s*enabled|not\s*applicable|na|n\/a)$/i.test(s)) return 'No';
  return s;
};

/**
 * The vendor lookup sheet (xlsx / xls / csv) → rows. The header row is any of
 * the first 25 rows of a sheet holding a GSTIN column and at least one other
 * column of LOOKUP_SHEET_COLUMNS (header words are matched loosely: case,
 * spacing, "Date of registration" or "Registration date", "GSTIN / UIN
 * Status", ...). Dates as dd/mm/yyyy, dd-Mon-yyyy, ISO or Excel dates.
 */
export function parseVendorLookupSheet(data: ArrayBuffer | Uint8Array): ParsedLookupSheet {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  for (const sheet of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
    for (let h = 0; h < Math.min(25, grid.length); h += 1) {
      const head = (grid[h] || []).map((c) => cellText(c));
      const at: Partial<Record<SheetField, number>> = {};
      head.forEach((c, i) => { const f = classify(c); if (f && at[f] === undefined) at[f] = i; });
      if (at.gstin === undefined || Object.keys(at).length < 2) continue;
      const seen = new Set<string>();
      const rows: LookupSheetRow[] = [];
      const invalid: string[] = [];
      let duplicates = 0;
      let badDates = 0;
      const date = (s: string) => { if (!s) return null; const d = isoDate(s); if (!d) badDates += 1; return d; };
      grid.slice(h + 1).forEach((r, k) => {
        const get = (f: SheetField) => (at[f] === undefined ? '' : cellText((r || [])[at[f]!]));
        const gstin = normGstin(get('gstin'));
        if (!gstin) return;
        if (seen.has(gstin)) { duplicates += 1; return; }
        seen.add(gstin);
        if (!checkGstin(gstin).valid) { invalid.push(gstin); return; }
        const raw: Record<string, string> = {};
        head.forEach((c, i) => { const v = cellText((r || [])[i]); if (c && v) raw[c] = v; });
        rows.push({
          gstin,
          legal_name: get('legal') || null,
          trade_name: get('trade') || null,
          reg_status: get('status') || null,
          reg_date: date(get('regDate')),
          cancel_date: date(get('cancelDate')),
          taxpayer_type: get('taxpayerType') || null,
          constitution: get('constitution') || null,
          address: get('address') || null,
          einvoice_status: yesNo(get('einv')),
          last_gstr1_filed: date(get('lastG1')),
          last_gstr3b_filed: date(get('lastG3')),
          raw,
          rowNumber: h + 2 + k,
        });
      });
      const columns: Partial<Record<SheetField, string>> = {};
      for (const [f, i] of Object.entries(at)) columns[f as SheetField] = head[i as number];
      if (rows.length || invalid.length) return { rows, invalid, duplicates, sheet, columns, badDates };
    }
  }
  throw new Error(`No vendor lookup sheet found: the file needs a header row (in the first 25 rows of a sheet) with a "GSTIN" column and at least one of ${LOOKUP_SHEET_COLUMNS.slice(1).join(', ')}.`);
}

/**
 * Saves the sheet's vendors as lookups (vendor_gstin_lookups, source
 * 'manual_upload', status ok, looked up by the person uploading; payload: the
 * sheet's row and the file name). A later portal lookup of a GSTIN replaces it
 * in the report (the newest answer is read). Returns what was saved, in words.
 */
export async function uploadVendorLookupSheet({ clientId, file }: { clientId: string; periods: string[]; file: File; uploadedBy: string | null }): Promise<string> {
  const parsed = parseVendorLookupSheet(await file.arrayBuffer());
  if (!parsed.rows.length) throw new Error(`No valid GSTIN in sheet "${parsed.sheet}" of ${file.name} (${parsed.invalid.length} fail the check character).`);
  const by = currentActorId();
  const at = new Date().toISOString();
  for (let i = 0; i < parsed.rows.length; i += 500) {
    const { error } = await supabase.from('vendor_gstin_lookups').insert(parsed.rows.slice(i, i + 500).map((r) => ({
      gstin: r.gstin,
      status: 'ok',
      source: 'manual_upload',
      looked_up_by: by,
      via_client_id: clientId,
      legal_name: r.legal_name,
      trade_name: r.trade_name,
      reg_status: r.reg_status,
      reg_date: r.reg_date,
      cancel_date: r.cancel_date,
      taxpayer_type: r.taxpayer_type,
      constitution: r.constitution,
      address: r.address,
      einvoice_status: r.einvoice_status,
      // A last-filed date is not a filing table: the report shows it, and never reads periods missing from it.
      filings: null,
      payload: {
        file_name: file.name, sheet: parsed.sheet, row_number: r.rowNumber, uploaded_at: at, columns: parsed.columns,
        last_gstr1_filed: r.last_gstr1_filed, last_gstr3b_filed: r.last_gstr3b_filed, row: r.raw,
      },
    })));
    if (error) {
      if (isMissingRelation(error)) throw new Error('The vendor lookups table is not set up yet (migration 20261127140000_vendor_gstin_risk.sql is not applied).');
      throw error;
    }
  }
  const notes = [
    parsed.invalid.length ? `${parsed.invalid.length} GSTIN${parsed.invalid.length === 1 ? '' : 's'} failing the check character left out` : '',
    parsed.duplicates ? `${parsed.duplicates} repeated GSTIN${parsed.duplicates === 1 ? '' : 's'} kept once` : '',
    parsed.badDates ? `${parsed.badDates} date${parsed.badDates === 1 ? '' : 's'} not read (use dd/mm/yyyy)` : '',
  ].filter(Boolean);
  return `Vendor lookup sheet saved: ${parsed.rows.length} vendors from sheet "${parsed.sheet}" of ${file.name} (columns read: ${Object.values(parsed.columns).join(', ')}).${notes.length ? ` ${notes.join('; ')}.` : ''}`;
}
