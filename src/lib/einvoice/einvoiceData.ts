// E-invoice records for the GSTR-1 page: who is an e-invoice client, the
// stored e-invoice records and their last pull / Excel import, and the
// e-invoice Excel import. The pure rules live in einvoice.ts and excel.ts.
//
// Read docs/GSTR1_EINVOICE_POSITIONS.md before changing anything here.

import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
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
  /**
   * ok | none | pending | failed | stale. 'stale': the portal served a
   * GSTR-1 file generated before the pull day; nothing was saved or marked.
   */
  status: string;
  docs_found: number;
  message: string | null;
  /** The same timestamp the pull wrote on last_seen_at of every row it saw. */
  pulled_at: string;
  pulled_by?: string | null;
  source?: string | null;
  /** Pulls: the date (yyyy-mm-dd) the portal generated the GSTR-1 file, from its name; null when unknown. */
  generated_on?: string | null;
}

/** pulled_at of a pull that finished (ok / none): the time the plan may rest on. A 'stale' pull never counts. */
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
  /**
   * false when client_einvoice_evidence was not read: the function is missing
   * (migration not applied) and the tick alone decided, or the read failed.
   */
  fromEvidence: boolean;
  /**
   * The read failed for another reason (network, timeout, a server error):
   * nobody knows whether the client issues e-invoices. `issues` is then the
   * tick alone, and a client that is not ticked must not be pushed (§7).
   */
  failed?: boolean;
  /** The error, when failed. */
  error?: string;
}

const TICK_REASON = 'Ticked "E-invoice applicable"';

/** The RPC does not exist (migration 20261013100000 not applied): the only error that lets the tick decide alone. */
const isMissingFunction = (e: unknown): boolean => {
  const err = e as { code?: string; message?: string; status?: number } | null;
  return !!err && (err.code === 'PGRST202' || err.code === '42883'
    || /could not find the function|function .* does not exist/i.test(err.message || ''));
};

const errorText = (e: unknown): string =>
  (e instanceof Error ? e.message : (e as { message?: string } | null)?.message || String(e));

/**
 * clients.einvoice_applicable OR client_einvoice_evidence(client). The
 * evidence ignores the exemption, so an exempt client that issues IRNs is
 * still protected. Only when the function is missing (PGRST202 / 42883:
 * the migration is not applied) does the tick alone decide. Any other error
 * returns failed: true, so the page can refuse to push an unticked client
 * rather than treat it as one that issues no e-invoices.
 */
export async function fetchEinvoiceEvidence(clientId: string, ticked: boolean): Promise<EinvoiceEvidence> {
  try {
    const { data, error } = await supabase.rpc('client_einvoice_evidence', { p_client_id: clientId });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as { issues_einvoices?: boolean | null; reason?: string | null } | null | undefined;
    if (!row) throw new Error('the evidence check returned nothing for this client');
    if (row.issues_einvoices) return { issues: true, reason: row.reason || TICK_REASON, fromEvidence: true };
    return ticked
      ? { issues: true, reason: TICK_REASON, fromEvidence: true }
      : { issues: false, reason: row.reason || '', fromEvidence: true };
  } catch (e) {
    if (isMissingFunction(e)) return { issues: ticked, reason: ticked ? TICK_REASON : '', fromEvidence: false };
    return { issues: ticked, reason: ticked ? TICK_REASON : '', fromEvidence: false, failed: true, error: errorText(e) };
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

// The reverse charge, e-commerce GSTIN and shipping bill are read out of
// `raw` (the portal's document for a pull, the Excel's fields for an
// import), so the whole document is not fetched.
const DOC_COLS = 'id, client_id, period_month, section, doc_type, doc_no, doc_key, ctin, doc_date, irn, irn_date, inv_typ, pos, '
  + 'doc_value, taxable, igst, cgst, sgst, cess, first_seen_at, last_seen_at, source, '
  + 'rchrg:raw->>rchrg, etin:raw->>etin, sbnum:raw->>sbnum, sbdt:raw->>sbdt, sbpcode:raw->>sbpcode';
/** Columns of migration 20261013100000. */
const NEW_DOC_COLS = ', irn_status, autopop_status, autopop_date, error, gone_at';
const PULL_COLS = 'status, docs_found, message, pulled_at, pulled_by';
const NEW_PULL_COLS = ', generated_on';

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
    docs = await readDocs(DOC_COLS + NEW_DOC_COLS);
  } catch (e) {
    if (!isMissingColumn(e)) throw e;
    // Before the migration: no Excel columns, no gone_at and one pull row per period.
    legacy = true;
    docs = await readDocs(DOC_COLS);
  }

  const readPull = async (source: string | null): Promise<EinvoicePullRow | null> => {
    const read = async (cols: string) => {
      let q = supabase.from('einvoice_pulls').select(cols).eq('client_id', clientId).eq('period_month', periodMonth);
      if (source) q = q.eq('source', source);
      return q.maybeSingle();
    };
    let { data, error } = await read(legacy ? PULL_COLS : PULL_COLS + NEW_PULL_COLS);
    if (error && !legacy && isMissingColumn(error)) ({ data, error } = await read(PULL_COLS));
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

/** One document as einvoice_excel_replace takes it (p_docs). */
export const excelDocPayload = (d: EinvExcelDoc) => ({
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
  // The Excel's own fields; the reconciliation reads the reverse charge,
  // e-commerce GSTIN and shipping bill from here, as it does from a pulled
  // record's raw.
  raw: {
    sheet: d.sheet,
    rows: d.rows,
    autopop_text: d.autopop_text,
    rchrg: d.rchrg ?? null,
    etin: d.etin ?? null,
    sbnum: d.sbnum ?? null,
    sbdt: d.sbdt ?? null,
    sbpcode: d.sbpcode ?? null,
  },
});

/**
 * Replaces the client and period's Excel records in ONE transaction
 * (einvoice_excel_replace): deletes the rows with source 'einvoice_excel',
 * inserts the new ones and records the import in einvoice_pulls. A failure
 * anywhere leaves the earlier import exactly as it was. The pull's records
 * (source 'portal_gstr1') are untouched.
 */
export async function saveEinvoiceExcelImport(args: {
  clientId: string;
  periodMonth: string;
  actorId: string | null;
  docs: EinvExcelDoc[];
  message: string;
}): Promise<{ inserted: number }> {
  const { clientId, periodMonth, actorId, docs, message } = args;
  const { data, error } = await supabase.rpc('einvoice_excel_replace', {
    p_client_id: clientId,
    p_period_month: periodMonth,
    p_docs: docs.map(excelDocPayload) as unknown as Json,
    p_message: message,
    p_actor: actorId,
  });
  if (error) throw error;
  const inserted = typeof data === 'number' ? data : Number(data);
  if (!Number.isFinite(inserted) || inserted !== docs.length) {
    throw new Error(`the database reports ${String(data)} of ${docs.length} documents saved. Import the file again.`);
  }
  return { inserted };
}
