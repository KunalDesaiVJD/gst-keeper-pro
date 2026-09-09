// Override requests and decisions for the advance set-off gate.
//
// docs/ADVANCE_SETOFF_POSITIONS.md §6. The hard block is always passable —
// genuine cases exist (an invoice to a party who separately holds an unrelated
// advance, an advance being refunded rather than adjusted). A block that could
// not be passed would be routed around by filing outside the app, which is
// strictly worse than a recorded override. So the override is not prevented;
// it is made expensive, attributable and permanent.

import { supabase } from '@/integrations/supabase/client';
import type { AdvanceCheckResult, AdvanceFinding } from './advanceSetoffCheck';

export type OverrideStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'LAPSED';

/**
 * Which gate an override was granted at.
 *
 * The Filing Status gate carries the RETURN it was marking filed, because four
 * different return types pass through that one screen. Collapsing them to a
 * bare 'FILING_STATUS' let an override approved while marking GSTR-1 filed also
 * pass GSTR-3B in the same period — which contradicts the scoping rule this
 * module states in §6 and in the migration.
 */
export type OverrideReturnType = 'GSTR-1' | 'GSTR-3B' | `FILING_STATUS:${string}`;

export interface AdvanceOverride {
  id: string;
  client_id: string;
  period_month: string;
  return_type: OverrideReturnType;
  severity: string;
  findings: AdvanceFinding[];
  findings_fingerprint: string;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_at: string;
  request_reason: string;
  status: OverrideStatus;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
  filed_after_override: boolean;
  arn: string | null;
}

/** Minimum characters of justification. A one-word reason is not a reason. */
export const OVERRIDE_REASON_MIN = 20;

const TABLE = 'advance_setoff_overrides';

/** Best-effort mirror into the firm-wide audit trail. Never blocks the flow. */
async function mirrorToAuditLog(params: {
  action: string;
  clientId: string;
  clientName?: string | null;
  userId: string | null;
  userRole: string;
  details: Record<string, unknown>;
}) {
  try {
    await supabase.from('audit_log').insert({
      module: 'advances',
      action: params.action,
      client_id: params.clientId,
      client_name: params.clientName || null,
      user_id: params.userId || '',
      user_role: params.userRole,
      details: params.details as never,
    } as never);
  } catch {
    // The override row itself is the record of authority; a failed mirror
    // must not stop a manager approving a return that is otherwise ready.
  }
}

/**
 * The override standing against one (client, period, return type), latest
 * first. Returns null when there has never been one.
 */
export async function fetchOverride(
  clientId: string,
  periodMonth: string,
  returnType: OverrideReturnType,
): Promise<AdvanceOverride | null> {
  const { data, error } = await supabase
    .from(TABLE as never)
    .select('*')
    .eq('client_id', clientId)
    .eq('period_month', periodMonth)
    .eq('return_type', returnType)
    .order('requested_at', { ascending: false })
    .limit(1);
  // A missing table (migration not applied) must degrade to "no override",
  // which keeps the gate closed — the safe direction.
  if (error) return null;
  const row = ((data as unknown as AdvanceOverride[]) || [])[0];
  return row || null;
}

export async function fetchPendingOverrides(): Promise<AdvanceOverride[]> {
  const { data, error } = await supabase
    .from(TABLE as never)
    .select('*')
    .eq('status', 'PENDING')
    .order('requested_at', { ascending: true });
  if (error) return [];
  return (data as unknown as AdvanceOverride[]) || [];
}

export async function requestOverride(params: {
  clientId: string;
  clientName?: string | null;
  periodMonth: string;
  returnType: OverrideReturnType;
  check: AdvanceCheckResult;
  reason: string;
  userId: string | null;
  userName: string;
  userRole: string;
  /** True when the requester may also decide — records an immediate approval. */
  selfApprove: boolean;
}): Promise<AdvanceOverride | null> {
  const now = new Date().toISOString();
  const row = {
    client_id: params.clientId,
    period_month: params.periodMonth,
    return_type: params.returnType,
    severity: params.check.severity,
    findings: params.check.findings as never,
    findings_fingerprint: params.check.fingerprint,
    requested_by: params.userId,
    requested_by_name: params.userName,
    request_reason: params.reason.trim(),
    // A manager passing their own block is one step, but it is recorded
    // identically to an approval they gave someone else — same row, same
    // fields, so the certificate reads the same way either way.
    status: params.selfApprove ? 'APPROVED' : 'PENDING',
    decided_by: params.selfApprove ? params.userId : null,
    decided_by_name: params.selfApprove ? params.userName : null,
    decided_at: params.selfApprove ? now : null,
    decision_note: params.selfApprove ? 'Self-override by approver.' : '',
  };

  const { data, error } = await supabase.from(TABLE as never).insert(row as never).select().limit(1);
  if (error) throw error;

  await mirrorToAuditLog({
    action: params.selfApprove ? 'advance_setoff_override_self_approved' : 'advance_setoff_override_requested',
    clientId: params.clientId,
    clientName: params.clientName,
    userId: params.userId,
    userRole: params.userRole,
    details: {
      period_month: params.periodMonth,
      return_type: params.returnType,
      reason: params.reason.trim(),
      fingerprint: params.check.fingerprint,
      finding_codes: params.check.findings.filter((f) => f.severity === 'hard').map((f) => f.code),
    },
  });

  return ((data as unknown as AdvanceOverride[]) || [])[0] || null;
}

export async function decideOverride(params: {
  overrideId: string;
  clientId: string;
  clientName?: string | null;
  decision: 'APPROVED' | 'REJECTED';
  note: string;
  userId: string | null;
  userName: string;
  userRole: string;
}): Promise<void> {
  const { error } = await supabase
    .from(TABLE as never)
    .update({
      status: params.decision,
      decided_by: params.userId,
      decided_by_name: params.userName,
      decided_at: new Date().toISOString(),
      decision_note: params.note.trim(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', params.overrideId);
  if (error) throw error;

  await mirrorToAuditLog({
    action: params.decision === 'APPROVED' ? 'advance_setoff_override_approved' : 'advance_setoff_override_rejected',
    clientId: params.clientId,
    clientName: params.clientName,
    userId: params.userId,
    userRole: params.userRole,
    details: { override_id: params.overrideId, note: params.note.trim() },
  });
}

/** Records that the return actually went out under this override. */
export async function markFiledUnderOverride(overrideId: string, arn?: string | null): Promise<void> {
  await supabase
    .from(TABLE as never)
    .update({ filed_after_override: true, arn: arn || null, updated_at: new Date().toISOString() } as never)
    .eq('id', overrideId);
}

/**
 * Stamp the standing APPROVED override for this (client, period, return) as
 * the authority a return actually went out under.
 *
 * Called after the filing is recorded rather than at approval time: an
 * approval is permission to file, not evidence that filing happened. Without
 * this the certificate printed "Filed under this override: No" on every return
 * that had in fact gone out under one.
 */
export async function markFiledForPeriod(params: {
  clientId: string;
  periodMonth: string;
  returnType: OverrideReturnType;
  arn?: string | null;
}): Promise<void> {
  try {
    const standing = await fetchOverride(params.clientId, params.periodMonth, params.returnType);
    if (!standing || standing.status !== 'APPROVED') return;
    await markFiledUnderOverride(standing.id, params.arn);
  } catch {
    // Never let bookkeeping about an override block the filing itself.
  }
}

export type GateDecision =
  | { allowed: true; reason: 'clean' | 'soft_only' | 'override_approved'; override?: AdvanceOverride }
  | { allowed: false; reason: 'blocked' | 'awaiting_approval' | 'rejected' | 'lapsed'; override?: AdvanceOverride };

/**
 * Whether this return may go out, given the check and the standing override.
 *
 * The fingerprint comparison is the rule that stops an override becoming a
 * rubber stamp: an approval authorises the findings the approver actually saw,
 * nothing else. Edit the draft afterwards and the findings change, the
 * fingerprint changes, and the block returns.
 */
export function evaluateGate(check: AdvanceCheckResult, override: AdvanceOverride | null): GateDecision {
  if (check.severity !== 'hard') {
    return { allowed: true, reason: check.severity === 'ok' ? 'clean' : 'soft_only' };
  }
  if (!override) return { allowed: false, reason: 'blocked' };

  if (override.findings_fingerprint !== check.fingerprint) {
    // Stale in either direction — a new finding appeared, or the one that was
    // approved is gone and different ones remain.
    return { allowed: false, reason: override.status === 'APPROVED' ? 'lapsed' : 'blocked', override };
  }
  if (override.status === 'APPROVED') return { allowed: true, reason: 'override_approved', override };
  if (override.status === 'PENDING') return { allowed: false, reason: 'awaiting_approval', override };
  if (override.status === 'REJECTED') return { allowed: false, reason: 'rejected', override };
  return { allowed: false, reason: 'blocked', override };
}

/**
 * Mark an approved override LAPSED once its findings no longer match. Called
 * when the gate reports 'lapsed', so the stale approval stops showing as live
 * authority on the manager's inbox and in the certificate.
 */
export async function lapseOverride(overrideId: string): Promise<void> {
  await supabase
    .from(TABLE as never)
    .update({ status: 'LAPSED', updated_at: new Date().toISOString() } as never)
    .eq('id', overrideId);
}
