// E-invoice records for the GSTR-1 page: who is an e-invoice client, the
// stored e-invoice records and their last pull / Excel import, and the
// e-invoice Excel import. The pure rules live in einvoice.ts and excel.ts.
//
// Read docs/GSTR1_EINVOICE_POSITIONS.md before changing anything here.

import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { parseEinvoiceExcel, type EinvExcelDoc, type EinvExcelMeta, type EinvExcelSkip } from './excel';
import { KEEPABLE_SECTIONS, isEinvoiceableBookDoc, type EinvDoc, type EinvoiceDocRow } from './einvoice';

/**
 * First extension version that leaves e-invoices out of a GSTR-1 upload
 * (einvoice.keep) and pulls on the new record keys. Older copies upload every
 * document, overwriting the e-invoices on the portal (§4.4), and their pull
 * fails on the new keys.
 */
export const EINVOICE_MIN_EXTENSION = '0.8.7';

/** einvoice_pulls row: the last pull (portal_gstr1) or Excel import (einvoice_excel) for a client and period. */
export interface EinvoicePullRow {
  status: string; // ok | none | pending | failed
  docs_found: number;
  message: string | null;
  pulled_at: string;
  pulled_by?: string | null;
  source?: string | null;
}

/** pulled_at of a pull that finished (ok / none): the time the plan may rest on. */
export const successfulPullAt = (p: EinvoicePullRow | null | undefined): string | null =>
  (p && (p.status === 'ok' || p.status === 'none') ? p.pulled_at : null);

/** Do the books hold any document an e-invoice could cover (or that carries its own IRN)? */
export const booksHaveEinvoiceable = (books: EinvDoc[]): boolean =>
  books.some((d) => isEinvoiceableBookDoc(d) || (!!d.books_irn && KEEPABLE_SECTIONS.includes(d.section)));

// ---------------------------------------------------------------------------
// Who is an e-invoice client (§7)
// ---------------------------------------------------------------------------

export interface EinvoiceEvidence {
  issues: boolean;
  /** Plain words: why this client is (or is not) treated as an e-invoice client. */
  reason: string;
  /** false when client_einvoice_evidence could not be read and only the tick decided. */
  fromEvidence: boolean;
}

const TICK_REASON = 'Ticked "E-invoice applicable"';

/**
 * clients.einvoice_applicable OR client_einvoice_evidence(client). The
 * evidence ignores the exemption, so an exempt client that issues IRNs is
 * still protected. When the RPC fails (migration not applied) the tick alone
 * decides.
 */
export async function fetchEinvoiceEvidence(clientId: string, ticked: boolean): Promise<EinvoiceEvidence> {
  try {
    const { data, error } = await supabase.rpc('client_einvoice_evidence', { p_client_id: clientId });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as { issues_einvoices?: boolean | null; reason?: string | null } | null | undefined;
    if (!row) throw new Error('no evidence row');
    if (row.issues_einvoices) return { issues: true, reason: row.reason || TICK_REASON, fromEvidence: true };
    return ticked
      ? { issues: true, reason: TICK_REASON, fromEvidence: true }
      : { issues: false, reason: row.reason || '', fromEvidence: true };
  } catch {
    return { issues: ticked, reason: ticked ? TICK_REASON : '', fromEvidence: false };
  }
}

// ---------------------------------------------------------------------------
// Stored records
// ---------------------------------------------------------------------------

export interface EinvoiceRecords {
  docs: EinvoiceDocRow[];
  /** The last portal pull (source portal_gstr1). */
  pull: EinvoicePullRow | null;
  /** The last e-invoice Excel import (source einvoice_excel). */
  excel: EinvoicePullRow | null;
}

const DOC_COLS = 'id, client_id, period_month, section, doc_type, doc_no, doc_key, ctin, doc_date, irn, irn_date, inv_typ, pos, '
  + 'doc_value, taxable, igst, cgst, sgst, cess, first_seen_at, last_seen_at, source';
const EXCEL_COLS = ', irn_status, autopop_status, autopop_date, error';
const PULL_COLS = 'status, docs_found, message, pulled_at, pulled_by';

/** A query that names a column the database does not have yet (migration 20261013100000 not applied). */
const isMissingColumn = (e: unknown): boolean => {
  const err = e as { code?: string; message?: string } | null;
  return !!err && (err.code === '42703' || err.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(err.message || ''));
};

const toNum = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/** Every e-invoice record of a client and period (MM/YYYY), with the last pull and the last Excel import. */
export async function loadEinvoiceRecords(clientId: string, periodMonth: string): Promise<EinvoiceRecords> {
  const readDocs = async (cols: string): Promise<EinvoiceDocRow[]> => {
    const PAGE = 1000;
    const out: EinvoiceDocRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('einvoice_docs')
        .select(cols)
        .eq('client_id', clientId)
        .eq('period_month', periodMonth)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data || []) as unknown as EinvoiceDocRow[];
      // numeric columns come back as strings from PostgREST
      out.push(...rows.map((r) => ({
        ...r,
        doc_value: toNum(r.doc_value), taxable: toNum(r.taxable), igst: toNum(r.igst), cgst: toNum(r.cgst), sgst: toNum(r.sgst), cess: toNum(r.cess),
      })));
      if (rows.length < PAGE) break;
    }
    return out;
  };

  let legacy = false;
  let docs: EinvoiceDocRow[];
  try {
    docs = await readDocs(DOC_COLS + EXCEL_COLS);
  } catch (e) {
    if (!isMissingColumn(e)) throw e;
    // Before the migration: no Excel columns and one pull row per period.
    legacy = true;
    docs = await readDocs(DOC_COLS);
  }

  const readPull = async (source: string | null): Promise<EinvoicePullRow | null> => {
    let q = supabase.from('einvoice_pulls').select(PULL_COLS).eq('client_id', clientId).eq('period_month', periodMonth);
    if (source) q = q.eq('source', source);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data ? { ...(data as unknown as EinvoicePullRow), source: source ?? 'portal_gstr1' } : null;
  };
  if (legacy) return { docs, pull: await readPull(null), excel: null };
  const [pull, excel] = await Promise.all([readPull('portal_gstr1'), readPull('einvoice_excel')]);
  return { docs, pull, excel };
}

// ---------------------------------------------------------------------------
// E-invoice Excel import (§6)
// ---------------------------------------------------------------------------

export interface EinvoiceExcelFile {
  name: string;
  wb: XLSX.WorkBook;
}

/**
 * The workbook(s) in a picked file: an .xlsx as it is, or every workbook in
 * the ZIP the portal gives for more than 500 documents
 * (EINV_<GSTIN>_<FY>.zip, from "E-invoice download history").
 */
export async function readEinvoiceExcelFile(file: File): Promise<EinvoiceExcelFile[]> {
  const buf = await file.arrayBuffer();
  if (/\.zip$/i.test(file.name)) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    const entries = Object.values(zip.files)
      .filter((f) => !f.dir && /\.xlsx$/i.test(f.name) && !/(^|\/)(__MACOSX\/|\._)/.test(f.name));
    if (!entries.length) throw new Error('The ZIP holds no Excel workbook (.xlsx).');
    return Promise.all(entries.map(async (f) => ({ name: f.name, wb: XLSX.read(await f.async('arraybuffer'), { type: 'array' }) })));
  }
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Pick the .xlsx (or the .zip) downloaded from the GSTR-1 dashboard.');
  return [{ name: file.name, wb: XLSX.read(buf, { type: 'array' }) }];
}

export interface EinvoiceExcelImport {
  /** Valid (not cancelled) documents: what is saved. */
  docs: EinvExcelDoc[];
  cancelled: number;
  pending: number;
  failed: number;
  /** Sheets the parser could not read as a document table (HSN summaries included). */
  sheetsSkipped: EinvExcelSkip[];
  /** Rows the parser could not read. */
  rowsSkipped: EinvExcelSkip[];
  metas: { file: string; meta: EinvExcelMeta }[];
}

/** Parses every workbook; one document per identity across them (the first wins). */
export function parseEinvoiceExcelFiles(files: EinvoiceExcelFile[], supplierGstin: string | null): EinvoiceExcelImport {
  const seen = new Set<string>();
  const all: EinvExcelDoc[] = [];
  const skipped: EinvExcelSkip[] = [];
  const metas: EinvoiceExcelImport['metas'] = [];
  files.forEach(({ name, wb }) => {
    const res = parseEinvoiceExcel(wb, { supplierGstin });
    metas.push({ file: name, meta: res.meta });
    const prefix = files.length > 1 ? `${name}: ` : '';
    skipped.push(...res.skipped.map((s) => ({ ...s, sheet: prefix + s.sheet })));
    res.docs.forEach((d) => {
      const k = `${d.section}|${d.ctin}|${d.doc_type}|${d.doc_key}`;
      if (seen.has(k)) return;
      seen.add(k);
      all.push(d);
    });
  });
  const docs = all.filter((d) => d.irn_status !== 'cancelled');
  return {
    docs,
    cancelled: all.length - docs.length,
    pending: docs.filter((d) => d.autopop_status === 'pending').length,
    failed: docs.filter((d) => d.autopop_status === 'failed').length,
    sheetsSkipped: skipped.filter((s) => s.row == null),
    rowsSkipped: skipped.filter((s) => s.row != null),
    metas,
  };
}

/**
 * Why the file is not this client's and month's, or null when it is. The
 * Read me sheet's GSTIN and Tax Period must both be there and match: an
 * import for another client or month would plan the push on records that
 * are not this return's.
 */
export function einvoiceExcelMismatch(metas: EinvoiceExcelImport['metas'], want: { gstin: string; periodMonth: string; label: string }): string | null {
  const gstin = want.gstin.trim().toUpperCase();
  for (const { file, meta } of metas) {
    const where = metas.length > 1 ? ` (${file})` : '';
    if (!meta.gstin || !meta.period_month) {
      return `The file${where} does not say which GSTIN and tax period it is for (its "Read me" sheet is missing or changed). Import the file exactly as downloaded from the GSTR-1 dashboard.`;
    }
    if (meta.gstin !== gstin) return `The file${where} is for GSTIN ${meta.gstin}, not this client's ${gstin || '(no GSTIN saved)'}. Nothing was imported.`;
    if (meta.period_month !== want.periodMonth) return `The file${where} is for tax period ${meta.period_month}, not ${want.label}. Nothing was imported.`;
  }
  return null;
}

/**
 * Replaces the client and period's Excel records: deletes the rows with
 * source 'einvoice_excel', inserts the new ones in chunks of 500 (each
 * checked against the rows the database returns) and records the import in
 * einvoice_pulls. The pull's records (source 'portal_gstr1') are untouched.
 */
export async function saveEinvoiceExcelImport(args: {
  clientId: string;
  periodMonth: string;
  actorId: string | null;
  docs: EinvExcelDoc[];
  message: string;
}): Promise<{ inserted: number }> {
  const { clientId, periodMonth, actorId, docs, message } = args;
  const { error: delError } = await supabase
    .from('einvoice_docs')
    .delete()
    .eq('client_id', clientId)
    .eq('period_month', periodMonth)
    .eq('source', 'einvoice_excel');
  if (delError) throw delError;

  const now = new Date().toISOString();
  const rows = docs.map((d) => ({
    client_id: clientId,
    period_month: periodMonth,
    source: 'einvoice_excel',
    section: d.section,
    doc_type: d.doc_type,
    doc_no: d.doc_no,
    doc_key: d.doc_key,
    ctin: d.ctin,
    doc_date: d.doc_date,
    irn: d.irn,
    irn_date: d.irn_date,
    inv_typ: d.inv_typ,
    pos: d.pos,
    doc_value: d.doc_value,
    taxable: d.taxable,
    igst: d.igst,
    cgst: d.cgst,
    sgst: d.sgst,
    cess: d.cess,
    irn_status: d.irn_status,
    autopop_status: d.autopop_status,
    autopop_date: d.autopop_date,
    error: d.error,
    raw: { sheet: d.sheet, rows: d.rows, autopop_text: d.autopop_text },
    last_seen_at: now,
  }));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await supabase.from('einvoice_docs').insert(chunk).select('id');
    if (error) throw error;
    if (!data || data.length < chunk.length) {
      throw new Error(`the database saved ${data?.length ?? 0} of ${chunk.length} rows (${inserted} saved before). Import the file again.`);
    }
    inserted += data.length;
  }

  const { error: pullError } = await supabase.from('einvoice_pulls').upsert(
    {
      client_id: clientId,
      period_month: periodMonth,
      source: 'einvoice_excel',
      status: 'ok',
      docs_found: inserted,
      message,
      pulled_by: actorId,
      pulled_at: now,
    },
    { onConflict: 'client_id,period_month,source' },
  );
  if (pullError) throw pullError;
  return { inserted };
}
