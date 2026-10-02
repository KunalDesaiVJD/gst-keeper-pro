// Data access for the Annual Return workspace. Every read/write of the
// workings goes through here; the components never call supabase directly.
//
// Portal reads are limited to rows the browser extension pulled from the GST
// portal itself — the as-filed GSTR-3B ('GSTR3B', 'MM/YYYY') and the GSTR-9
// system-computed JSON ('GSTR9_CALC', '03/YYYY'). The app's own GSTR-1 /
// GSTR-3B data is never read (docs/GSTR9_9C_WORKINGS.md §5).

import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { toChangeLogEntry, type ChangeLogEntry } from './audit';
import { normalizeDoc, normalizeDocs } from './defaults';
import type { Drc03Filing, PayableSide, SetOff, SetOffMethod } from './payables';
import { gstr9Fp, periodsForFY } from './portalParser';
import { AnnualReturnDocs, DocKey, DOC_KEYS } from './types';

export type PeriodStatus = 'not_started' | 'in_progress' | 'locked';

export interface AnnualReturnPeriod {
  id: string;
  status: PeriodStatus;
  locked_at: string | null;
  locked_by: string | null;
  updated_at: string;
  /** "Ready for review" — the preparer's sign-off. */
  prepared_by_name: string | null;
  prepared_at: string | null;
  prepared_note: string | null;
  /** The reviewer who verified and locked (GST manager / superadmin). Cleared on unlock. */
  reviewed_by_name: string | null;
  reviewed_role: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  review_checklist: Record<string, boolean> | null;
  /** Workings.payables as they stood at the lock. */
  payables_at_lock: unknown;
}

const PERIOD_COLUMNS =
  'id, status, locked_at, locked_by, updated_at, prepared_by_name, prepared_at, prepared_note, reviewed_by_name, reviewed_role, reviewed_at, review_note, review_checklist, payables_at_lock';

export interface LoadedWorkspace {
  docs: AnnualReturnDocs;
  versions: Record<DocKey, number>;
  updatedAt: Partial<Record<DocKey, string>>;
  updatedBy: Partial<Record<DocKey, string | null>>;
}

export class DocConflictError extends Error {
  constructor(public docKey: DocKey) {
    super(`"${docKey}" was changed by someone else.`);
    this.name = 'DocConflictError';
  }
}

/** The period's status changed since the user last saw it (someone else locked / unlocked it). */
export class PeriodChangedError extends Error {
  constructor(public current?: PeriodStatus | null) {
    super(current ? `The status was changed by someone else (now "${current.replace('_', ' ')}").` : 'The status was changed by someone else.');
    this.name = 'PeriodChangedError';
  }
}

export class YearLockedError extends Error {
  constructor() {
    super('This year is locked. Unlock it before editing.');
    this.name = 'YearLockedError';
  }
}

export async function loadWorkspace(clientId: string, financialYear: string): Promise<LoadedWorkspace> {
  const { data, error } = await supabase
    .from('annual_return_docs')
    .select('doc_key, data, version, updated_at, updated_by')
    .eq('client_id', clientId)
    .eq('financial_year', financialYear);
  if (error) throw error;
  const stored: Partial<Record<DocKey, unknown>> = {};
  const versions = Object.fromEntries(DOC_KEYS.map((k) => [k, 0])) as Record<DocKey, number>;
  const updatedAt: Partial<Record<DocKey, string>> = {};
  const updatedBy: Partial<Record<DocKey, string | null>> = {};
  (data || []).forEach((r) => {
    const k = r.doc_key as DocKey;
    if (!DOC_KEYS.includes(k)) return;
    stored[k] = r.data;
    versions[k] = r.version;
    updatedAt[k] = r.updated_at;
    updatedBy[k] = r.updated_by;
  });
  return { docs: normalizeDocs(stored), versions, updatedAt, updatedBy };
}

/** One doc as stored now (used to recover from a version conflict without touching the other docs). */
export async function loadDoc<K extends DocKey>(clientId: string, financialYear: string, key: K): Promise<{ data: AnnualReturnDocs[K]; version: number }> {
  const { data, error } = await supabase
    .from('annual_return_docs')
    .select('data, version')
    .eq('client_id', clientId)
    .eq('financial_year', financialYear)
    .eq('doc_key', key)
    .maybeSingle();
  if (error) throw error;
  return { data: normalizeDoc(key, data?.data), version: data?.version ?? 0 };
}

/**
 * Version-checked save. Returns the new version. `forceHistory` archives the
 * version being replaced even inside the history throttle window (restores).
 * `action` labels the change in the revision log ("Imported as-filed GSTR-3B",
 * "Restored version 12" …); the database logs every changed figure itself.
 * `role` is the user's role: the database refuses a change to a figure that
 * comes from a source (sourceLock.ts) unless it is the superadmin's.
 */
export async function saveDoc<K extends DocKey>(
  clientId: string,
  financialYear: string,
  key: K,
  data: AnnualReturnDocs[K],
  expectedVersion: number,
  updatedBy: string,
  forceHistory = false,
  action?: string,
  role?: string,
): Promise<number> {
  const { data: version, error } = await supabase.rpc('save_annual_return_doc', {
    p_client_id: clientId,
    p_financial_year: financialYear,
    p_doc_key: key,
    p_data: data as unknown as Json,
    p_expected_version: expectedVersion,
    p_updated_by: updatedBy,
    p_force_history: forceHistory,
    p_action: action,
    p_role: role,
  });
  if (error) {
    if (error.message?.includes('ANNUAL_RETURN_VERSION_CONFLICT')) throw new DocConflictError(key);
    if (error.message?.includes('ANNUAL_RETURN_SOURCE_LOCKED')) throw new SourceLockedError(key);
    if (error.message?.includes('ANNUAL_RETURN_LOCKED')) throw new YearLockedError();
    throw error;
  }
  return Number(version);
}

export async function loadPeriod(clientId: string, financialYear: string): Promise<AnnualReturnPeriod | null> {
  const { data, error } = await supabase
    .from('annual_return_periods')
    .select(PERIOD_COLUMNS)
    .eq('client_id', clientId)
    .eq('financial_year', financialYear)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as AnnualReturnPeriod) || null;
}

/** The save changed a figure that comes from a source, and the user is not the superadmin (sourceLock.ts). */
export class SourceLockedError extends Error {
  constructor(public key: DocKey) {
    super(`${key}: only a superadmin can change figures that come from a source`);
    this.name = 'SourceLockedError';
  }
}

export class NotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAllowedError';
  }
}

const rpcError = (message: string | undefined): Error | null => {
  if (!message) return null;
  const m = /ANNUAL_RETURN_STATUS_CHANGED: (\w+)/.exec(message);
  if (m) return new PeriodChangedError(m[1] as PeriodStatus);
  if (message.includes('ANNUAL_RETURN_NOT_ALLOWED')) return new NotAllowedError(message.replace(/^.*ANNUAL_RETURN_NOT_ALLOWED:\s*/, ''));
  if (message.includes('ANNUAL_RETURN_LOCKED')) return new YearLockedError();
  const s = /ANNUAL_RETURN_SETOFF_INVALID:\s*(.*)$/.exec(message);
  if (s) return new Error(s[1]);
  return null;
};

export interface StatusChange {
  /** The status the user was looking at — a stale click is refused, never applied. */
  from: PeriodStatus;
  to: PeriodStatus;
  by: string;
  /** superadmin | gst_manager | employee | unlock_sheets — locking needs superadmin or gst_manager. */
  role: string;
  note?: string;
  checklist?: Record<string, boolean>;
  /** Workings.payables at the lock. */
  payables?: unknown;
}

/**
 * Move the period from `from` to `to` through set_annual_return_status: the
 * database refuses a stale transition (PeriodChangedError) and a lock by
 * anyone but a GST manager / superadmin (NotAllowedError); it records the
 * reviewer, snapshots every sheet at the lock and logs the change.
 */
export async function setPeriodStatus(clientId: string, financialYear: string, change: StatusChange): Promise<void> {
  const { error } = await supabase.rpc('set_annual_return_status', {
    p_client_id: clientId,
    p_financial_year: financialYear,
    p_from: change.from,
    p_to: change.to,
    p_by: change.by,
    p_role: change.role,
    p_note: change.note || undefined,
    p_checklist: (change.checklist ?? undefined) as Json | undefined,
    p_payables: (change.payables ?? undefined) as Json | undefined,
  });
  if (error) throw rpcError(error.message) ?? error;
}

/** "Ready for review" by the preparer (clear = withdraw it). */
export async function markPrepared(clientId: string, financialYear: string, by: string, note?: string, clear = false): Promise<void> {
  const { error } = await supabase.rpc('mark_annual_return_prepared', {
    p_client_id: clientId,
    p_financial_year: financialYear,
    p_by: by,
    p_note: note || undefined,
    p_clear: clear,
  });
  if (error) throw rpcError(error.message) ?? error;
}

// ---------------------------------------------------------------------------
// Revision log
// ---------------------------------------------------------------------------

const LOG_COLUMNS = 'id, doc_key, version, path, row_label, kind, old_value, new_value, action, changed_by, changed_at';

/** One page of the revision log, newest first. `beforeId` continues from the last page. */
export async function loadChangeLog(
  clientId: string,
  financialYear: string,
  opts: { limit?: number; beforeId?: number; docKey?: string } = {},
): Promise<ChangeLogEntry[]> {
  let q = supabase
    .from('annual_return_change_log')
    .select(LOG_COLUMNS)
    .eq('client_id', clientId)
    .eq('financial_year', financialYear)
    .order('id', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.beforeId) q = q.lt('id', opts.beforeId);
  if (opts.docKey) q = q.eq('doc_key', opts.docKey);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r) => toChangeLogEntry(r as Parameters<typeof toChangeLogEntry>[0]));
}

/** The whole revision log, oldest first (for the exports). */
export async function loadFullChangeLog(clientId: string, financialYear: string): Promise<ChangeLogEntry[]> {
  const out: ChangeLogEntry[] = [];
  let afterId = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('annual_return_change_log')
      .select(LOG_COLUMNS)
      .eq('client_id', clientId)
      .eq('financial_year', financialYear)
      .gt('id', afterId)
      .order('id', { ascending: true })
      .limit(1000);
    if (error) throw error;
    const page = (data || []).map((r) => toChangeLogEntry(r as Parameters<typeof toChangeLogEntry>[0]));
    out.push(...page);
    if (page.length < 1000) return out;
    afterId = page[page.length - 1].id;
  }
}

// ---------------------------------------------------------------------------
// Payable set-offs
// ---------------------------------------------------------------------------

const n = (v: unknown): number => Number(v) || 0;

/** Every set-off of the year, removed ones included (they show struck through, with the reason). */
export async function loadSetOffs(clientId: string, financialYear: string): Promise<SetOff[]> {
  const { data, error } = await supabase
    .from('annual_return_payable_setoffs')
    .select('*')
    .eq('client_id', clientId)
    .eq('financial_year', financialYear)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    side: r.side as PayableSide,
    method: r.method as SetOffMethod,
    drc03Id: r.drc03_id,
    reference: r.reference,
    docDate: r.doc_date,
    gstr3bPeriod: r.gstr3b_period,
    gstr3bTable: r.gstr3b_table,
    evidenceUrl: r.evidence_url,
    evidenceName: r.evidence_name,
    tax: { i: n(r.igst), c: n(r.cgst), s: n(r.sgst), x: n(r.cess) },
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
    deletedBy: r.deleted_by,
    deleteReason: r.delete_reason,
  }));
}

/** DRC-03s synced from the portal for the client (all years, newest first). */
export async function loadDrc03s(clientId: string): Promise<Drc03Filing[]> {
  const { data, error } = await supabase
    .from('gst_drc03_filings')
    .select('id, arn, filed_date, financial_year, cause_of_payment, section, status, igst_amount, cgst_amount, sgst_amount, cess_amount, interest_amount, late_fee_amount, penalty_amount, pdf_url')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('filed_date', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    arn: r.arn,
    filedDate: r.filed_date,
    financialYear: r.financial_year,
    cause: r.cause_of_payment,
    section: r.section,
    status: r.status,
    tax: { i: n(r.igst_amount), c: n(r.cgst_amount), s: n(r.sgst_amount), x: n(r.cess_amount) },
    interest: n(r.interest_amount),
    lateFee: n(r.late_fee_amount),
    penalty: n(r.penalty_amount),
    pdfUrl: r.pdf_url,
  }));
}

export interface NewSetOff {
  side: PayableSide;
  method: SetOffMethod;
  tax: { i: number; c: number; s: number; x: number };
  drc03Id?: string | null;
  reference?: string | null;
  docDate?: string | null;
  gstr3bPeriod?: string | null;
  gstr3bTable?: string | null;
  evidenceUrl?: string | null;
  evidenceName?: string | null;
  note?: string | null;
}

/** Record a set-off. The database refuses one without its evidence, or beyond what a DRC-03 paid. */
export async function addSetOff(clientId: string, financialYear: string, by: string, s: NewSetOff): Promise<string> {
  const { data, error } = await supabase.rpc('add_annual_return_setoff', {
    p_client_id: clientId,
    p_financial_year: financialYear,
    p_side: s.side,
    p_method: s.method,
    p_by: by,
    p_igst: s.tax.i,
    p_cgst: s.tax.c,
    p_sgst: s.tax.s,
    p_cess: s.tax.x,
    p_drc03_id: s.drc03Id || undefined,
    p_reference: s.reference || undefined,
    p_doc_date: s.docDate || undefined,
    p_gstr3b_period: s.gstr3bPeriod || undefined,
    p_gstr3b_table: s.gstr3bTable || undefined,
    p_evidence_url: s.evidenceUrl || undefined,
    p_evidence_name: s.evidenceName || undefined,
    p_note: s.note || undefined,
  });
  if (error) {
    if (error.code === '23514') throw new Error('The set-off was refused: its evidence is incomplete (a DRC-03 needs its ARN, date and copy; a GSTR-3B its period, filing date and copy).');
    throw rpcError(error.message) ?? error;
  }
  return String(data);
}

/** Remove a set-off (kept in the register, struck through, with the reason). */
export async function removeSetOff(id: string, by: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('remove_annual_return_setoff', { p_id: id, p_by: by, p_reason: reason });
  if (error) throw rpcError(error.message) ?? error;
}

/**
 * Upload a DRC-03 / GSTR-3B copy to the evidence bucket (upload-only: a copy
 * on record cannot be replaced or deleted from the app). Returns its URL.
 */
export async function uploadEvidence(clientId: string, financialYear: string, file: File): Promise<{ url: string; name: string }> {
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'copy.pdf';
  const path = `${clientId}/${financialYear}/${crypto.randomUUID()}-${safe}`;
  const bucket = supabase.storage.from('annual-return-evidence');
  const { error } = await bucket.upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
  if (error) throw error;
  return { url: bucket.getPublicUrl(path).data.publicUrl, name: file.name };
}

export interface AsFiledReturn {
  period: string; // "MM/YYYY"
  status: string | null;
  arn: string | null;
  filedDate: string | null;
  summary: unknown;
  updatedAt: string | null;
}

/** As-filed GSTR-3B the extension pulled from the portal, for the FY's 12 months. */
export async function loadAsFiledGstr3b(clientId: string, financialYear: string): Promise<AsFiledReturn[]> {
  const periods = periodsForFY(financialYear);
  const { data, error } = await supabase
    .from('gst_filed_returns')
    .select('period_month, status, arn, filed_date, summary, updated_at')
    .eq('client_id', clientId)
    .eq('return_type', 'GSTR3B')
    .in('period_month', periods);
  if (error) throw error;
  return (data || []).map((r) => ({
    period: r.period_month,
    status: r.status,
    arn: r.arn,
    filedDate: r.filed_date,
    summary: r.summary,
    updatedAt: r.updated_at,
  }));
}

/** GSTR-9 system-computed JSON the extension's gstr9_pull saved (return_type GSTR9_CALC). */
export async function loadGstr9Calc(clientId: string, financialYear: string): Promise<AsFiledReturn | null> {
  const fp = gstr9Fp(financialYear);
  const period = `${fp.slice(0, 2)}/${fp.slice(2)}`;
  const { data, error } = await supabase
    .from('gst_filed_returns')
    .select('period_month, status, arn, filed_date, summary, updated_at')
    .eq('client_id', clientId)
    .eq('return_type', 'GSTR9_CALC')
    .eq('period_month', period)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { period: data.period_month, status: data.status, arn: data.arn, filedDate: data.filed_date, summary: data.summary, updatedAt: data.updated_at };
}

/** Keep an uploaded GSTR-9 JSON as the raw portal copy, same place the extension writes it. */
export async function saveUploadedGstr9Calc(clientId: string, financialYear: string, raw: unknown): Promise<void> {
  const fp = gstr9Fp(financialYear);
  const { error } = await supabase.from('gst_filed_returns').upsert(
    {
      client_id: clientId,
      period_month: `${fp.slice(0, 2)}/${fp.slice(2)}`,
      return_type: 'GSTR9_CALC',
      status: 'Uploaded',
      summary: raw as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id,period_month,return_type' },
  );
  if (error) throw error;
}

export interface DocHistoryEntry {
  id: string;
  docKey: DocKey;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
  data: unknown;
  /** Why the snapshot was kept: autosave checkpoint, before another user's edit, before a restore, locked. */
  reason: string | null;
  archivedAt: string;
}

export async function loadDocHistory(clientId: string, financialYear: string, key: DocKey): Promise<DocHistoryEntry[]> {
  const { data, error } = await supabase
    .from('annual_return_doc_history')
    .select('id, doc_key, version, updated_by, updated_at, data, reason, archived_at')
    .eq('client_id', clientId)
    .eq('financial_year', financialYear)
    .eq('doc_key', key)
    .order('archived_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id, docKey: r.doc_key as DocKey, version: r.version, updatedBy: r.updated_by, updatedAt: r.updated_at, data: r.data,
    reason: r.reason, archivedAt: r.archived_at,
  }));
}

/** Previous FY's saved docs (for carry-forward prefill: Annexure-4, prior-year 8C / Table 14). */
export async function loadPreviousYear(clientId: string, financialYear: string): Promise<LoadedWorkspace | null> {
  const start = Number(financialYear.slice(0, 4)) - 1;
  const prev = `${start}-${String(start + 1).slice(-2)}`;
  const ws = await loadWorkspace(clientId, prev);
  return Object.values(ws.versions).some((v) => v > 0) ? ws : null;
}
