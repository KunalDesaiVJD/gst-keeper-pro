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
import { fyPeriods, type BookLite, type FilingLite, type ImportDocLite, type LedgerLite, type LookupLite, type MasterLite, type RecoFinding, type StatementInfo, type VendorRiskInput } from './engine';
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

async function loadLookups(gstins: string[]): Promise<LookupLite[] | null> {
  const out: LookupLite[] = [];
  for (let i = 0; i < gstins.length; i += 150) {
    const chunk = gstins.slice(i, i + 150);
    const { data, error } = await supabase
      .from('vendor_gstin_latest')
      .select('gstin, status, looked_up_at, source, legal_name, trade_name, reg_status, reg_date, cancel_date, cancel_reason, taxpayer_type, constitution, nature_of_business, ato_slab, einvoice_status, filings')
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
      });
    }
  }
  return out;
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
  const lookups = await loadLookups(gstins);

  return {
    client: clientLite, fy, today, statements, docs2A, docs2B, importDocs, books, ledgerAsOf, notIn2B, notInBooks,
    recoPeriods, reco, master: master.master, masterFile: master.file, lookups,
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
