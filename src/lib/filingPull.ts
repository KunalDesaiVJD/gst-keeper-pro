// Filing Status, pull only (the firm's decision of 21 Oct 2026; migration
// 20261021110000, docs/FILING_STATUS_PULL_ONLY.md). Filed, the ARN, the filing
// date and the return PDF come from the extension's portal pull
// (filing_record_pull). The only other way in is filing_attach_manual: under
// the superadmin's allowance for a return that is pulled only (GSTR-1 and
// GSTR-3B, the firm's "1 & 3B"), or as the manual route kept for the others:
// GSTR-1 (IFF), GSTR-3B (Q), GSTR-6 and GSTR-7 until their pull is proven to
// work, CMP-08 and ITC-04 which have no pull yet. A database trigger refuses
// every direct write, so these are the app's only writers of those columns.
import { supabase } from '@/integrations/supabase/client';
import { allowanceBadgeText, type ManualSourceAllowance } from '@/lib/manualSourceAllowances';

/**
 * Returns that are pulled only (filing_pull_only in the database): a manual
 * upload of one needs the superadmin's allowance. Round 3: GSTR-1 and GSTR-3B
 * (monthly) only. Add a return here and in filing_pull_only once its pull has
 * landed Filed with its checked PDF.
 */
export const PULL_ONLY_RETURN_TYPES = ['GSTR-1', 'GSTR-3B'] as const;
export const isPullOnly = (returnType: string) => (PULL_ONLY_RETURN_TYPES as readonly string[]).includes(returnType);

/**
 * Returns the extension's e-Filed Returns pull can be asked for. A pull of
 * one writes it as it writes GSTR-1 / 3B, whether or not it is pulled only.
 * CMP-08 and ITC-04 are left out: the pull sets a monthly period, and theirs
 * is a quarter and a half-year.
 */
export const PORTAL_PULL_RETURN_TYPES = ['GSTR-1', 'GSTR-1 (IFF)', 'GSTR-3B', 'GSTR-3B (Q)', 'GSTR-1A', 'GSTR-6', 'GSTR-7'] as const;
export const hasPortalPull = (returnType: string) => (PORTAL_PULL_RETURN_TYPES as readonly string[]).includes(returnType);

/**
 * Why a return may be attached by hand without an allowance (null for one
 * that is pulled only). Same words as filing_manual_reason in the database.
 */
export function manualRouteReason(returnType: string): string | null {
  if (isPullOnly(returnType)) return null;
  if (returnType === 'CMP-08' || returnType === 'ITC-04') return `${returnType} has no portal pull yet`;
  return `the portal pull for ${returnType || 'this return'} is not proven yet`;
}

/** Which pull a page is waiting on: one return of one client for one period. */
export const pullKey = (clientId: string, returnType: string, periodMonth: string) => `${clientId}__${returnType}__${periodMonth}`;

/**
 * How long the page waits with no sign at all from the extension about a
 * pull before it gives up on the returns still waiting (round 3). A sign is
 * a return's outcome, or the extension answering "still running" when the
 * page asks (every PULL_ASK_EVERY_MS). This is longer than the extension's
 * own idle limit (10 minutes, after which it ends the pull itself and
 * reports every return not reached), so a pull the extension is still
 * running is never given up by the page, however many clients it has.
 */
export const PULL_SILENCE_MS = 12 * 60 * 1000;
export const PULL_ASK_EVERY_MS = 30 * 1000;

/**
 * The pulls a page is waiting on, by request: which returns each still
 * waits for, and when the extension last gave a sign of it. Pure (the clock
 * is passed in), so scripts/verify-filing-pull-only.mjs runs it.
 */
export class PullWatch {
  private reqs = new Map<string, { keys: Set<string>; lastSign: number; started: boolean }>();

  /** A pull was asked for. */
  start(requestId: string, keys: string[], now: number): void {
    this.reqs.set(requestId, { keys: new Set(keys), lastSign: now, started: false });
  }

  /**
   * The extension said it started the pull (its job is set): only from then
   * on is it asked whether the pull is still running (before, a "no" would
   * only mean it is still reading the clients' logins).
   */
  confirm(requestId: string | null | undefined, now: number): void {
    const r = requestId ? this.reqs.get(requestId) : undefined;
    if (r) { r.started = true; r.lastSign = now; }
  }

  /** The extension gave a sign of this pull (a return's outcome, or "still running"). */
  sign(requestId: string | null | undefined, now: number): void {
    const r = requestId ? this.reqs.get(requestId) : undefined;
    if (r) r.lastSign = now;
  }

  /** One return was answered (any request); a request with nothing left goes. */
  answered(key: string): void {
    for (const [id, r] of this.reqs) {
      if (r.keys.delete(key) && !r.keys.size) this.reqs.delete(id);
    }
  }

  /** The pull is over (done, refused at the start, or the extension says it is not running): the returns still waiting. */
  end(requestId: string | null | undefined): string[] {
    const r = requestId ? this.reqs.get(requestId) : undefined;
    if (!r) return [];
    this.reqs.delete(requestId as string);
    return [...r.keys];
  }

  /** The requests still waiting that the extension started (to ask it about). */
  requests(): string[] {
    return [...this.reqs].filter(([, r]) => r.started).map(([id]) => id);
  }

  /** Is the page still waiting on this request? */
  has(requestId: string | null | undefined): boolean {
    return !!requestId && this.reqs.has(requestId);
  }

  /** Requests with no sign for longer than PULL_SILENCE_MS: ended, with their returns still waiting. */
  silent(now: number): { requestId: string; keys: string[] }[] {
    const out: { requestId: string; keys: string[] }[] = [];
    for (const [id, r] of this.reqs) {
      if (now - r.lastSign > PULL_SILENCE_MS) out.push({ requestId: id, keys: [...r.keys] });
    }
    out.forEach((x) => this.reqs.delete(x.requestId));
    return out;
  }
}

/** The rows of one return: GSTR-1 / GSTR-1 (IFF), GSTR-3B / GSTR-3B (Q). */
export function filingFamily(returnType: string): string[] {
  if (returnType === 'GSTR-1' || returnType === 'GSTR-1 (IFF)') return ['GSTR-1', 'GSTR-1 (IFF)'];
  if (returnType === 'GSTR-3B' || returnType === 'GSTR-3B (Q)') return ['GSTR-3B', 'GSTR-3B (Q)'];
  return [returnType];
}

/**
 * Why an ARN cannot be this return's, or null (filing_arn_problem in the
 * database, same words). The two letters are a series, not the return: the
 * form name in the PDF says which return it is.
 */
export function arnProblem(gstin: string | null | undefined, returnType: string, periodMonth: string, arnRaw: string): string | null {
  const arn = (arnRaw || '').trim().toUpperCase();
  if (!arn) return 'No ARN was given.';
  if (!/^[A-Z]{2}[0-9]{6}[A-Z0-9]{7}$/.test(arn)) {
    return `${arn} is not an ARN. An ARN has 15 characters: two letters, the state code, the tax period (MMYY) and seven more.`;
  }
  const state = (gstin || '').slice(0, 2);
  if (/^[0-9]{2}$/.test(state) && arn.slice(2, 4) !== state) {
    return `ARN ${arn} has state code ${arn.slice(2, 4)}, but the client's GSTIN is in state ${state}.`;
  }
  const m = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(periodMonth || '');
  if (returnType !== 'ITC-04' && m && arn.slice(4, 8) !== m[1] + m[2].slice(2)) {
    return `ARN ${arn} is for the tax period ${arn.slice(4, 6)}/20${arn.slice(6, 8)}, not ${periodMonth}.`;
  }
  return null;
}

/**
 * A row unlocked for correction (filing_status_unlock): not Filed, its ARN
 * kept. Its own Pull files it again; a bulk or per-client pull leaves it out,
 * so a correction is never re-locked behind the staff's back.
 */
export const isUnlockedFiled = (r: { status: string | null; arn: string | null }) => r.status !== 'Filed' && !!r.arn;

/**
 * The row holds a PDF a portal pull checked (the filed return, showing its
 * ARN). A portal row may also still show a PDF attached by hand that no pull
 * checked (round 3: a pull without a checked PDF never takes one off); its
 * pdf_note says so, and it is not a checked PDF.
 */
export const holdsCheckedPortalPdf = (r: { filed_source?: string | null; return_pdf_url: string | null; pdf_note?: string | null }) =>
  r.filed_source === 'portal' && !!r.return_pdf_url && !r.pdf_note;

/** The row shows a PDF attached by hand that no pull checked (kept by a pull without a checked PDF). */
export const holdsUncheckedHandPdf = (r: { filed_source?: string | null; return_pdf_url: string | null; pdf_note?: string | null }) =>
  r.filed_source === 'portal' && !!r.return_pdf_url && !!r.pdf_note;

/** The words shown with such a PDF. */
export const UNCHECKED_HAND_PDF = 'Attached by hand, not checked by a pull';

/** The row's filing date was typed by hand and no pull has read the portal's yet (date_note). */
export const dateTypedByHand = (r: { filed_source?: string | null; filed_date: string | null; date_note?: string | null }) =>
  r.filed_source === 'portal' && !!r.filed_date && !!r.date_note;

/**
 * What "Pull filed returns" asks for: not unlocked for correction, and not
 * Filed; or Filed but never pulled (recorded by hand before 21 Oct 2026, so
 * its PDF was never checked); or pulled without a checked PDF (none, or one
 * attached by hand that no pull checked) or without the portal's date (none,
 * or one typed by hand). A return attached by hand (under an allowance or
 * the manual route) is left out (its own Pull still tries).
 */
export const wantedInBulkPull = (r: {
  status: string | null; arn: string | null; return_pdf_url: string | null; filed_date: string | null;
  filed_source?: string | null; pdf_note?: string | null; date_note?: string | null;
}) =>
  !isUnlockedFiled(r) && (r.status !== 'Filed' || !r.filed_source
    || (r.filed_source === 'portal' && (!holdsCheckedPortalPdf(r) || !r.filed_date || !!r.date_note)));

/**
 * What the toast says when "Pull filed returns" finds nothing to pull:
 * heldBack returns wait for the superadmin's direct-filing approval; byHand
 * returns in view were attached by hand (their own Pull still tries).
 */
export function bulkPullNothingText(heldBack: number, byHand = 0): string {
  const hand = byHand ? `, or attached by hand (${byHand}: Pull on its row checks it against the portal)` : '';
  if (!heldBack) {
    return byHand
      ? `Nothing to pull. Every return in view is Filed from the portal with its checked PDF and date${hand}.`
      : 'Every return in view is Filed from the portal with its checked PDF and date.';
  }
  return `Nothing pulled. ${heldBack} return${heldBack === 1 ? ' was' : 's were'} not pushed through GST Keeper: the superadmin approves the direct filing first (Request approval on the row). Every other return in view is Filed from the portal${hand}.`;
}

/** What "Pull filed returns" says on a tab whose return has no portal pull (CMP-08, ITC-04). */
export const noPullTabText = (returnType: string) => `${returnType} has no portal pull yet: attach each filed return by hand on its row.`;

/**
 * The manual exception on one row. canAllow: the superadmin may allow one
 * manual upload (a pull-only return with no live allowance, unless the row
 * holds a checked PDF from the portal). canAttach: a staff member with the
 * Filing status permission may attach now (a return with a manual route
 * freely until Filed with a PDF, or over a PDF attached by hand that no pull
 * checked; a pull-only return under an open allowance; never over a checked
 * portal PDF). showAllowance: the "Manual allowed by" line.
 */
export function manualActions(
  r: { status: string | null; return_type: string; return_pdf_url: string | null; filed_source?: string | null; pdf_note?: string | null },
  o: { canEdit: boolean; isSuperadmin: boolean; notApplicable: boolean; lockedOut: boolean; allowance: { used_at: string | null } | null },
): { canAttach: boolean; canAllow: boolean; showAllowance: boolean } {
  const pulled = holdsCheckedPortalPdf(r);
  const open = !!o.allowance && !o.allowance.used_at;
  const pullOnly = isPullOnly(r.return_type);
  return {
    canAttach: o.canEdit && !o.notApplicable && !o.lockedOut
      && (pullOnly ? open && !pulled : !(r.status === 'Filed' && r.return_pdf_url) || holdsUncheckedHandPdf(r)),
    canAllow: o.isSuperadmin && pullOnly && !o.notApplicable && !o.allowance && !pulled,
    showAllowance: open && !pulled,
  };
}

/** What a client's "all" asks for: every return but one unlocked for correction. */
export const wantedInClientPull = (r: { status: string | null; arn: string | null }) => !isUnlockedFiled(r);

/**
 * Where a filed return came from, in words, wherever it is shown or exported:
 * "Portal" (with "PDF attached by hand, not checked by a pull" or "filing
 * date typed by hand" when the row still shows one of those), "manual
 * (allowed by Asha: portal down)", "manual (CMP-08 has no portal pull yet)",
 * "manual (the portal pull for GSTR-6 is not proven yet)", or "By hand before
 * 21 Oct 2026" for rows recorded before the pull-only rule. null for a row
 * holding no filed return.
 */
export function filingSourceText(
  r: {
    status: string | null; arn: string | null; return_type: string; filed_source?: string | null; manual_allowance_id?: string | null;
    return_pdf_url?: string | null; pdf_note?: string | null; filed_date?: string | null; date_note?: string | null;
  },
  allowance: Pick<ManualSourceAllowance, 'allowed_by' | 'reason'> | null | undefined,
  names: Record<string, string>,
): string | null {
  if (r.filed_source === 'portal') {
    const extra = [
      r.return_pdf_url && r.pdf_note ? 'PDF attached by hand, not checked by a pull' : null,
      r.filed_date && r.date_note ? 'filing date typed by hand, not read from the portal' : null,
    ].filter(Boolean);
    return extra.length ? `Portal (${extra.join('; ')})` : 'Portal';
  }
  if (r.filed_source === 'manual') {
    if (allowance) return allowanceBadgeText(allowance, names);
    const why = r.manual_allowance_id ? null : manualRouteReason(r.return_type);
    return why ? `manual (${why})` : 'manual';
  }
  if (r.status === 'Filed' || r.arn) return 'By hand before 21 Oct 2026';
  return null;
}

/**
 * The words above for a set of rows, keyed by row id: reads the allowances
 * the manual rows were attached under and who gave them (two small queries,
 * only when there is a manual row).
 */
export async function fetchFilingSourceTexts(
  rows: {
    id: string; status: string | null; arn: string | null; return_type: string; filed_source?: string | null; manual_allowance_id?: string | null;
    return_pdf_url?: string | null; pdf_note?: string | null; filed_date?: string | null; date_note?: string | null;
  }[],
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.manual_allowance_id).filter((x): x is string => !!x))];
  const allowances = new Map<string, { allowed_by: string; reason: string }>();
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data } = await supabase.from('manual_source_allowances' as never).select('id, allowed_by, reason').in('id', ids);
    for (const a of (data as unknown as { id: string; allowed_by: string; reason: string }[]) || []) allowances.set(a.id, a);
    const who = [...new Set([...allowances.values()].map((a) => a.allowed_by))];
    if (who.length) {
      const { data: people } = await supabase.from('profiles').select('user_id, first_name').in('user_id', who);
      for (const p of (people as { user_id: string; first_name: string | null }[]) || []) if (p.first_name) names[p.user_id] = p.first_name;
    }
  }
  const out = new Map<string, string>();
  for (const r of rows) {
    const t = filingSourceText(r, r.manual_allowance_id ? allowances.get(r.manual_allowance_id) : null, names);
    if (t) out.set(r.id, t);
  }
  return out;
}

export type PullOutcome = 'filed' | 'refreshed' | 'conflict' | 'refused' | 'not_found' | 'failed' | 'gstr1a_seen' | 'not_reached';

export interface FilingLogRow {
  id: string;
  at: string;
  client_id: string;
  return_type: string;
  period_month: string;
  filing_status_id: string | null;
  event: string;
  route: string;
  actor_id: string | null;
  old_status: string | null;
  new_status: string | null;
  old_arn: string | null;
  new_arn: string | null;
  old_filed_date: string | null;
  new_filed_date: string | null;
  old_pdf_url: string | null;
  new_pdf_url: string | null;
  message: string | null;
  detail: Record<string, unknown> | null;
  allowance_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
}

const LOG_COLUMNS = 'id, at, client_id, return_type, period_month, filing_status_id, event, route, actor_id, old_status, new_status, old_arn, new_arn, old_filed_date, new_filed_date, old_pdf_url, new_pdf_url, message, detail, allowance_id, resolved_at, resolved_by, resolution';

/** The month's log, newest first (pull outcomes and every change). */
export async function fetchFilingLog(periodMonth: string): Promise<FilingLogRow[]> {
  const { data, error } = await supabase
    .from('filing_status_log' as never)
    .select(LOG_COLUMNS)
    .eq('period_month', periodMonth)
    .order('at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data as unknown as FilingLogRow[]) || [];
}

/** Pull conflicts waiting for the superadmin, any month. */
export async function fetchOpenConflicts(): Promise<FilingLogRow[]> {
  const { data, error } = await supabase
    .from('filing_status_log' as never)
    .select(LOG_COLUMNS)
    .eq('event', 'conflict')
    .is('resolved_at', null)
    .order('at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data as unknown as FilingLogRow[]) || [];
}

/** Pull outcomes the page shows on a row (not every change). */
export const PULL_EVENTS = ['filed', 'refreshed', 'conflict', 'refused', 'not_found', 'failed', 'manual_attach', 'conflict_accepted'];

/** The latest pull outcome per client, return type and period, from the log (keyed by pullKey). */
export function latestOutcomes(log: FilingLogRow[]): Map<string, FilingLogRow> {
  const m = new Map<string, FilingLogRow>();
  for (const r of log) {
    if (!PULL_EVENTS.includes(r.event)) continue;
    for (const rt of filingFamily(r.return_type)) {
      const k = pullKey(r.client_id, rt, r.period_month);
      if (!m.has(k)) m.set(k, r);
    }
  }
  return m;
}

export function outcomeWords(event: string): string {
  switch (event) {
    case 'filed': return 'Filed from the portal';
    case 'refreshed': return 'Pulled again';
    case 'conflict': return 'Pull conflict';
    case 'refused': return 'Pull refused';
    case 'not_found': return 'Not found on the portal';
    case 'failed': return 'Pull failed';
    case 'not_reached': return 'Not reached';
    case 'manual_attach': return 'Attached by hand';
    case 'conflict_accepted': return 'Conflict decided';
    default: return event;
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as unknown as T;
}

export interface AttachResult { outcome: string; message: string; id: string; return_type: string; allowance_id: string | null }

/** Attach a filed return by hand (PDF already uploaded to the client's folder). */
export const attachManual = (p: {
  actorId: string; clientId: string; returnType: string; periodMonth: string; arn: string; filedDate: string; pdfUrl: string;
}) => rpc<AttachResult>('filing_attach_manual', {
  p_actor_id: p.actorId, p_client_id: p.clientId, p_return_type: p.returnType, p_period_month: p.periodMonth,
  p_arn: p.arn, p_filed_date: p.filedDate, p_pdf_url: p.pdfUrl,
});

/** Unlock a filed GSTR-3B / GSTR-3B (Q) (GST Manager or superadmin): ARN, date and PDF are kept. */
export const unlockFiled = (actorId: string, clientId: string, periodMonth: string) =>
  rpc<number>('filing_status_unlock', { p_actor_id: actorId, p_client_id: clientId, p_period_month: periodMonth });

/** Take a return off Filed (superadmin, with a reason). */
export const unfileReturn = (actorId: string, id: string, reason: string) =>
  rpc<unknown>('filing_status_unfile', { p_actor_id: actorId, p_id: id, p_reason: reason });

/** The superadmin decides a pull conflict: accept the pulled ARN, or keep what is there. */
export const decideConflict = (actorId: string, logId: string, accept: boolean, note?: string) =>
  rpc<{ outcome: string }>('filing_pull_conflict_decide', { p_actor_id: actorId, p_log_id: logId, p_accept: accept, p_note: note ?? null });

/** Where a manually attached PDF goes in the return-pdfs bucket. */
export const manualPdfPath = (clientId: string, returnType: string, periodMonth: string, arn: string) =>
  `${clientId}/${returnType}/${periodMonth.replace('/', '-')}/manual-${arn}-${Date.now()}.pdf`;
