import { supabase } from '@/integrations/supabase/client';

/**
 * GSTR-1 direct-filing approvals.
 *
 * From the Sep-2026 return period a GSTR-1 / GSTR-1 (IFF) that was never
 * pushed to the portal through GST Keeper (filing_status.pushed_at IS NULL)
 * cannot become Filed — by the Filing Status dropdown or by the extension's
 * "Pull from portal" — until a superadmin approves a request explaining why it
 * was filed directly on the portal. The database trigger
 * `filing_status_guard_direct_filing` enforces this; everything here exists so
 * staff meet a request dialog instead of the raw trigger error.
 */

export const DIRECT_FILING_RETURN_TYPES = ['GSTR-1', 'GSTR-1 (IFF)'] as const;
export type DirectFilingReturnType = (typeof DIRECT_FILING_RETURN_TYPES)[number];

/** First return period (YYYYMM) the rule applies to — Sep-2026. */
const FIRST_PERIOD_KEY = 202609;

export const MIN_REASON_LENGTH = 15;

export type DirectFilingApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface DirectFilingApproval {
  id: string;
  client_id: string;
  return_type: string;
  period_month: string;
  status: DirectFilingApprovalStatus;
  reason: string;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export type DirectFilingState =
  | 'not_applicable'
  | 'pushed'
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'needs_request';

/** States in which marking Filed / pulling from the portal is blocked. */
export const isDirectFilingBlocked = (state: DirectFilingState): boolean =>
  state === 'needs_request' || state === 'pending' || state === 'rejected';

/** Mirror of SQL `gstr1_direct_filing_rule_applies(return_type, period)`. */
export function directFilingRuleApplies(returnType: string | null | undefined, periodMonth: string | null | undefined): boolean {
  if (!returnType || !(DIRECT_FILING_RETURN_TYPES as readonly string[]).includes(returnType)) return false;
  const m = /^(\d{2})\/(\d{4})$/.exec(periodMonth || '');
  if (!m) return false;
  return Number(m[2]) * 100 + Number(m[1]) >= FIRST_PERIOD_KEY;
}

/** The trigger's error text ("… was not pushed through GST Keeper …"). */
export function isDirectFilingTriggerError(message: string | null | undefined): boolean {
  return !!message && /was not pushed through GST Keeper/i.test(message);
}

export const approvalKey = (clientId: string, returnType: string, periodMonth: string): string =>
  `${clientId}|${returnType}|${periodMonth}`;

const COLUMNS = 'id, client_id, return_type, period_month, status, reason, requested_by, requested_at, decided_by, decided_at, decision_note';

/** Every approval row for these clients in one period, newest first. */
export async function fetchDirectFilingApprovals(clientIds: string[], periodMonth: string): Promise<DirectFilingApproval[]> {
  if (clientIds.length === 0) return [];
  const out: DirectFilingApproval[] = [];
  // Chunk the IN list so a long client list stays under URL limits.
  for (let i = 0; i < clientIds.length; i += 150) {
    const { data, error } = await supabase
      .from('gstr1_direct_filing_approvals')
      .select(COLUMNS)
      .in('client_id', clientIds.slice(i, i + 150))
      .eq('period_month', periodMonth)
      .order('requested_at', { ascending: false });
    if (error) throw error;
    out.push(...((data || []) as DirectFilingApproval[]));
  }
  return out.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
}

/** All pending requests (any client, any period), oldest first. */
export async function fetchPendingDirectFilingApprovals(): Promise<DirectFilingApproval[]> {
  const { data, error } = await supabase
    .from('gstr1_direct_filing_approvals')
    .select(COLUMNS)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });
  if (error) throw error;
  return (data || []) as DirectFilingApproval[];
}

/** The most recently decided requests (any client, any period). */
export async function fetchRecentDecidedDirectFilingApprovals(limit = 20): Promise<DirectFilingApproval[]> {
  const { data, error } = await supabase
    .from('gstr1_direct_filing_approvals')
    .select(COLUMNS)
    .neq('status', 'pending')
    .order('decided_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as DirectFilingApproval[];
}

/**
 * ok → `approval` is the row written. Not ok → either `alreadyPending` (with
 * the open request in `approval`, when it could be read) or `error`.
 */
export interface RequestResult {
  ok: boolean;
  approval?: DirectFilingApproval | null;
  alreadyPending?: boolean;
  error?: string;
}

export interface DecideResult {
  ok: boolean;
  approval?: DirectFilingApproval;
  error?: string;
}

/**
 * Raise a request. `approveNow` (superadmin only — the caller checks) records
 * it as already approved with the requester as decider and the reason as the
 * decision note.
 */
export async function requestDirectFilingApproval(args: {
  clientId: string;
  returnType: string;
  periodMonth: string;
  reason: string;
  requestedBy: string | null;
  approveNow?: boolean;
}): Promise<RequestResult> {
  const reason = args.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    return { ok: false, error: `Please explain what happened (at least ${MIN_REASON_LENGTH} characters).` };
  }

  const findPending = async () => {
    const { data } = await supabase
      .from('gstr1_direct_filing_approvals')
      .select(COLUMNS)
      .eq('client_id', args.clientId)
      .eq('return_type', args.returnType)
      .eq('period_month', args.periodMonth)
      .eq('status', 'pending')
      .maybeSingle();
    return (data as DirectFilingApproval | null) ?? null;
  };

  const existing = await findPending();
  if (existing) {
    if (!args.approveNow) return { ok: false, alreadyPending: true, approval: existing };
    // A superadmin approving straight away settles the open request instead of
    // leaving a stale pending row beside the approval.
    return decideDirectFilingApproval({ id: existing.id, approve: true, note: reason, decidedBy: args.requestedBy });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('gstr1_direct_filing_approvals')
    .insert({
      client_id: args.clientId,
      return_type: args.returnType,
      period_month: args.periodMonth,
      reason,
      requested_by: args.requestedBy,
      requested_at: now,
      status: args.approveNow ? 'approved' : 'pending',
      ...(args.approveNow ? { decided_by: args.requestedBy, decided_at: now, decision_note: reason } : {}),
    })
    .select(COLUMNS)
    .single();
  if (error) {
    // Unique "one pending per return" index — someone raised it a moment ago.
    if (error.code === '23505') return { ok: false, alreadyPending: true, approval: await findPending() };
    return { ok: false, error: error.message };
  }
  return { ok: true, approval: data as DirectFilingApproval };
}

/** Approve or reject a pending request. Rejection requires a note. */
export async function decideDirectFilingApproval(args: {
  id: string;
  approve: boolean;
  note?: string | null;
  decidedBy: string | null;
}): Promise<DecideResult> {
  const note = (args.note || '').trim();
  if (!args.approve && !note) return { ok: false, error: 'A note is required to reject a request.' };
  const { data, error } = await supabase
    .from('gstr1_direct_filing_approvals')
    .update({
      status: args.approve ? 'approved' : 'rejected',
      decided_by: args.decidedBy,
      decided_at: new Date().toISOString(),
      decision_note: note || null,
    })
    .eq('id', args.id)
    .eq('status', 'pending') // never overwrite someone else's decision
    .select(COLUMNS)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'This request was already decided — refresh to see the outcome.' };
  return { ok: true, approval: data as DirectFilingApproval };
}

/**
 * The approval that speaks for a return: an approved row wins, then the open
 * request, then the most recent rejection.
 */
export function pickApproval(approvals: DirectFilingApproval[]): DirectFilingApproval | null {
  return approvals.find((a) => a.status === 'approved')
    ?? approvals.find((a) => a.status === 'pending')
    ?? [...approvals].sort((a, b) => (b.decided_at || b.requested_at).localeCompare(a.decided_at || a.requested_at))[0]
    ?? null;
}

/**
 * Per-return state. `alreadyFiled` rows are left alone (the trigger lets a
 * Filed row stay Filed) and read as not_applicable.
 */
export function directFilingState(args: {
  returnType: string;
  periodMonth: string;
  pushedAt: string | null | undefined;
  alreadyFiled?: boolean;
  approvals: DirectFilingApproval[];
}): DirectFilingState {
  if (!directFilingRuleApplies(args.returnType, args.periodMonth)) return 'not_applicable';
  if (args.alreadyFiled) return 'not_applicable';
  if (args.pushedAt) return 'pushed';
  const a = pickApproval(args.approvals);
  if (!a) return 'needs_request';
  if (a.status === 'approved') return 'approved';
  if (a.status === 'pending') return 'pending';
  return 'rejected';
}

/** Index approval rows by client|return|period. */
export function groupApprovals(rows: DirectFilingApproval[]): Map<string, DirectFilingApproval[]> {
  const map = new Map<string, DirectFilingApproval[]>();
  for (const r of rows) {
    const k = approvalKey(r.client_id, r.return_type, r.period_month);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

/** first_name per user id (profiles), the way Filing Status resolves updated_by. */
export async function fetchUserNames(userIds: (string | null | undefined)[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return {};
  const { data } = await supabase.from('profiles').select('user_id, first_name').in('user_id', ids);
  const out: Record<string, string> = {};
  (data || []).forEach((p: { user_id: string; first_name: string | null }) => { out[p.user_id] = p.first_name || 'Unknown'; });
  return out;
}
