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
  /** Bumped by every sign-off change; sent back with each sign-off so a stale click is refused. */
  signoff_rev: number;
  /** Allotment (signoffFlow.ts): the preparer, and optionally a verifier and a reviewer. */
  preparer_id: string | null;
  preparer_name: string | null;
  preparer_allotted_at: string | null;
  verifier_id: string | null;
  verifier_name: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  allotted_at: string | null;
  allotted_by_name: string | null;
  /** Prepared — the preparer's sign-off. */
  prepared_by: string | null;
  prepared_by_name: string | null;
  prepared_at: string | null;
  prepared_note: string | null;
  /** Verified — a second person. */
  verified_by: string | null;
  verified_by_name: string | null;
  verified_role: string | null;
  verified_at: string | null;
  verified_note: string | null;
  changes_at_verify: number | null;
  /** Reviewed & locked — a GST manager / superadmin, a third person. Cleared on unlock. */
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_role: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  review_checklist: Record<string, boolean> | null;
  changes_at_lock: number | null;
  /** Sent back to the preparer or the verifier, with what needs fixing. */
  returned_to: 'preparer' | 'verifier' | null;
  returned_by_name: string | null;
  returned_at: string | null;
  returned_note: string | null;
  /** Superadmin overrides recorded at the lock ([{kind, by, at, reason}]). */
  signoff_overrides: unknown;
  /** Workings.payables as they stood at the lock. */
  payables_at_lock: unknown;
}

export const PERIOD_COLUMNS =
  'id, status, locked_at, locked_by, updated_at, signoff_rev, preparer_id, preparer_name, preparer_allotted_at, verifier_id, verifier_name, '
  + 'reviewer_id, reviewer_name, allotted_at, allotted_by_name, prepared_by, prepared_by_name, prepared_at, prepared_note, '
  + 'verified_by, verified_by_name, verified_role, verified_at, verified_note, changes_at_verify, '
  + 'reviewed_by, reviewed_by_name, reviewed_role, reviewed_at, review_note, review_checklist, changes_at_lock, '
  + 'returned_to, returned_by_name, returned_at, returned_note, signoff_overrides, payables_at_lock';

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

/** The sign-off changed since the user last saw it (someone else signed, sent back, locked or unlocked it). */
export class SignoffStaleError extends Error {
  constructor(public stage: string | null) {
    super('The sign-off was changed by someone else while you were looking. Nothing of yours was applied.');
    this.name = 'SignoffStaleError';
  }
}

/** More figures changed since the previous sign-off than the signer was shown. */
export class ChangedSinceError extends Error {
  constructor(public count: number) {
    super(`${count} figure change${count === 1 ? ' was' : 's were'} made since the previous sign-off — check ${count === 1 ? 'it' : 'them'} and try again.`);
    this.name = 'ChangedSinceError';
  }
}

/** The superadmin is locking without the three-person sign-off and has to give a reason. */
export class OverrideRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverrideRequiredError';
  }
}

/** The page was built against functions the database no longer has. */
export class OutdatedAppError extends Error {
  constructor() {
    super('This page is out of date — reload it to continue.');
    this.name = 'OutdatedAppError';
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

const rpcError = (message: string | undefined, code?: string): Error | null => {
  if (!message) return null;
  const st = /ANNUAL_RETURN_SIGNOFF_STALE: (\w+)/.exec(message);
  if (st) return new SignoffStaleError(st[1]);
  const ch = /ANNUAL_RETURN_CHANGED_SINCE: (\d+)/.exec(message);
  if (ch) return new ChangedSinceError(Number(ch[1]));
  const said = (key: string) => message.replace(new RegExp(`^.*${key}:\\s*`), '');
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  if (message.includes('ANNUAL_RETURN_OVERRIDE_REQUIRED')) return new OverrideRequiredError(cap(said('ANNUAL_RETURN_OVERRIDE_REQUIRED')));
  if (message.includes('ANNUAL_RETURN_NOT_ALLOWED')) return new NotAllowedError(cap(said('ANNUAL_RETURN_NOT_ALLOWED')));
  if (message.includes('ANNUAL_RETURN_NOTE_REQUIRED')) return new Error(cap(said('ANNUAL_RETURN_NOTE_REQUIRED')));
  if (message.includes('ANNUAL_RETURN_BAD_ACTION')) return new Error(cap(said('ANNUAL_RETURN_BAD_ACTION')));
  if (message.includes('ANNUAL_RETURN_LOCKED')) return new YearLockedError();
  const s = /ANNUAL_RETURN_SETOFF_INVALID:\s*(.*)$/.exec(message);
  if (s) return new Error(s[1]);
  if (code === 'PGRST202' || message.includes('Could not find the function')) return new OutdatedAppError();
  return null;
};

/** The period row as the sign-off RPCs return it: the period, its sheets, stage and changes since sign-off. */
export interface SignoffRow extends AnnualReturnPeriod {
  client_id: string;
  financial_year: string;
  sheets: number;
  last_saved_at: string | null;
  stage: string;
  changes: { since_prepared: number; since_verified: number; last_change_at: string | null; last_change_by: string | null } | null;
}

export interface StatusChange {
  /** 'locked' reviews and locks; 'in_progress' unlocks (back to Verified). */
  to: 'locked' | 'in_progress';
  /** signoff_rev the user was looking at — a stale click is refused, never applied. */
  expectedRev: number;
  actorId: string;
  /** Review note at the lock; the reason at an unlock (required). */
  note?: string;
  checklist?: Record<string, boolean>;
  /** Workings.payables at the lock. */
  payables?: unknown;
  /** How many changes since the verification the reviewer was shown and checked. */
  changesAck?: number;
  /** Superadmin only: why the year is locked without the three-person sign-off. */
  overrideReason?: string;
}

/**
 * Review & lock, or unlock, through set_annual_return_status. The database
 * looks the user up by id, refuses a stale click (SignoffStaleError), a lock
 * by anyone but a GST manager / superadmin who neither prepared nor verified
 * it (NotAllowedError; OverrideRequiredError for the superadmin), and
 * unchecked changes since the verification (ChangedSinceError). It snapshots
 * every sheet at the lock and logs the change.
 */
export async function setPeriodStatus(clientId: string, financialYear: string, change: StatusChange): Promise<SignoffRow> {
  const { data, error } = await supabase.rpc('set_annual_return_status', {
    p_client_id: clientId,
    p_financial_year: financialYear,
    p_to: change.to,
    p_expected_rev: change.expectedRev,
    p_actor_id: change.actorId,
    p_note: change.note || undefined,
    p_checklist: (change.checklist ?? undefined) as Json | undefined,
    p_payables: (change.payables ?? undefined) as Json | undefined,
    p_changes_ack: change.changesAck ?? undefined,
    p_override_reason: change.overrideReason || undefined,
  });
  if (error) throw rpcError(error.message, error.code) ?? error;
  return data as unknown as SignoffRow;
}

/** Prepare / verify / send back, or withdraw a sign-off (annual_return_signoff). */
export async function signoffAnnualReturn(
  clientId: string,
  financialYear: string,
  action: 'prepare' | 'withdraw_prepared' | 'verify' | 'withdraw_verified' | 'send_back',
  opts: { expectedRev: number; actorId: string; note?: string; returnTo?: 'preparer' | 'verifier'; changesAck?: number },
): Promise<SignoffRow> {
  const { data, error } = await supabase.rpc('annual_return_signoff', {
    p_client_id: clientId,
    p_financial_year: financialYear,
    p_action: action,
    p_expected_rev: opts.expectedRev,
    p_actor_id: opts.actorId,
    p_note: opts.note || undefined,
    p_return_to: opts.returnTo ?? undefined,
    p_changes_ack: opts.changesAck ?? undefined,
  });
  if (error) throw rpcError(error.message, error.code) ?? error;
  return data as unknown as SignoffRow;
}

export type AllotSkip = 'locked' | 'changed' | 'signed' | 'not_staff' | 'not_manager' | 'same_person' | 'unchanged';

export interface AllotResult {
  clientId: string;
  applied: boolean;
  reason: AllotSkip | null;
  previous: { id: string; name: string } | null;
  row: SignoffRow | null;
}

/**
 * Allot (or, with userId null, un-allot) one slot on many workings at once.
 * `expectUserId` is who the user saw in the slot: a working that changed
 * meanwhile is skipped, never overwritten. Only a GST manager / superadmin.
 */
export async function allotAnnualReturn(
  financialYear: string,
  slot: 'preparer' | 'verifier' | 'reviewer',
  items: { clientId: string; userId: string | null; expectUserId: string | null }[],
  actorId: string,
): Promise<AllotResult[]> {
  const out: AllotResult[] = [];
  // The database takes at most 500 a call.
  for (let i = 0; i < items.length; i += 500) {
    const { data, error } = await supabase.rpc('annual_return_allot', {
      p_financial_year: financialYear,
      p_stage: slot,
      p_items: items.slice(i, i + 500).map((x) => ({ client_id: x.clientId, user_id: x.userId, expect_user_id: x.expectUserId })) as unknown as Json,
      p_actor_id: actorId,
    });
    if (error) throw rpcError(error.message, error.code) ?? error;
    const results = ((data as { results?: unknown[] } | null)?.results ?? []) as {
      client_id: string; applied: boolean; reason: AllotSkip | null; previous: { id: string; name: string } | null; row: SignoffRow | null;
    }[];
    out.push(...results.map((r) => ({ clientId: r.client_id, applied: r.applied, reason: r.reason, previous: r.previous, row: r.row })));
  }
  return out;
}

/** The working's period, sheets, stage and changes since sign-off, fresh (null when it has no period row yet). */
export async function loadSignoffRow(clientId: string, financialYear: string): Promise<SignoffRow | null> {
  const { data, error } = await supabase.rpc('annual_return_signoff_row', { p_client_id: clientId, p_financial_year: financialYear });
  if (error) throw rpcError(error.message, error.code) ?? error;
  return (data as unknown as SignoffRow) ?? null;
}

/**
 * How many figure changes by others the signer has to check: since Prepared
 * for a verification, since Verified for the lock. The same count the
 * database checks the acknowledgement against.
 */
export async function loadUnackedChanges(clientId: string, financialYear: string, forWhat: 'verify' | 'lock', actorId: string): Promise<number> {
  const { data, error } = await supabase.rpc('annual_return_unacked_changes', {
    p_client_id: clientId, p_financial_year: financialYear, p_for: forWhat, p_actor_id: actorId,
  });
  if (error) throw rpcError(error.message, error.code) ?? error;
  return Number(data ?? 0);
}

/** The latest figure changes since a moment (sheets only — not status, payables or reasons), newest first. */
export async function loadChangesSince(
  clientId: string,
  financialYear: string,
  since: string,
  limit = 8,
): Promise<{ entries: ChangeLogEntry[]; total: number }> {
  const { data, error, count } = await supabase
    .from('annual_return_change_log')
    .select(LOG_COLUMNS, { count: 'exact' })
    .eq('client_id', clientId)
    .eq('financial_year', financialYear)
    .gt('changed_at', since)
    .in('kind', ['edit', 'add', 'remove'])
    .not('doc_key', 'in', '(period,payables,justifications)')
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { entries: (data ?? []).map(toChangeLogEntry), total: count ?? (data ?? []).length };
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
