import { supabase } from '@/integrations/supabase/client';

// Manual source allowances (the firm's decision of 21 Oct 2026): portal data
// is pulled by the browser extension; when a pull cannot be done (wrong portal
// password, portal down, no access) the superadmin may allow a manual entry
// for one client, month and scope, with a reason. The table is
// manual_source_allowances; it changes only through manual_source_allow /
// manual_source_revoke (superadmin, checked in the database) and is used once
// by the write it allows (migration 20261021120000). Whatever it allowed is
// shown as "manual (allowed by X: reason)" everywhere.

/** Scopes this app uses. Others ('filing:GSTR-3B', ...) live in the same table. */
export type ManualSourceScope = 'reco:suspended' | 'reco:receivable' | (string & {});

export interface ManualSourceAllowance {
  id: string;
  client_id: string;
  period_month: string;
  scope: string;
  reason: string;
  allowed_by: string;
  allowed_at: string;
  used_by: string | null;
  used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}

const COLUMNS = 'id, client_id, period_month, scope, reason, allowed_by, allowed_at, used_by, used_at, revoked_at, revoked_by';

/** Every allowance (live and revoked) for a client and month, newest first. */
export async function fetchManualSourceAllowances(clientId: string, periodMonth: string, scope?: string): Promise<ManualSourceAllowance[]> {
  let q = supabase.from('manual_source_allowances').select(COLUMNS)
    .eq('client_id', clientId).eq('period_month', periodMonth);
  if (scope) q = q.eq('scope', scope);
  const { data, error } = await q.order('allowed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ManualSourceAllowance[];
}

/** The one live (not revoked) allowance in a list, if any. */
export const liveAllowance = (rows: ManualSourceAllowance[], scope: string): ManualSourceAllowance | null =>
  rows.find((a) => a.scope === scope && !a.revoked_at) ?? null;

export async function allowManualSource(actorId: string, clientId: string, periodMonth: string, scope: string, reason: string): Promise<ManualSourceAllowance> {
  const { data, error } = await supabase.rpc('manual_source_allow', {
    p_actor_id: actorId, p_client_id: clientId, p_period: periodMonth, p_scope: scope, p_reason: reason,
  });
  if (error) throw error;
  return data as unknown as ManualSourceAllowance;
}

export async function revokeManualSource(actorId: string, id: string): Promise<ManualSourceAllowance> {
  const { data, error } = await supabase.rpc('manual_source_revoke', { p_actor_id: actorId, p_id: id });
  if (error) throw error;
  return data as unknown as ManualSourceAllowance;
}

/** First names for staff ids (allowed by, used by, pulled by, overridden by). */
export async function staffNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!wanted.length) return new Map();
  const { data } = await supabase.from('profiles').select('user_id, first_name').in('user_id', wanted);
  return new Map((data ?? []).map((p) => [p.user_id, p.first_name || 'Unknown']));
}

/** "manual (allowed by Asha: portal password changed by the client)" */
export function manualSourceLabel(allowedByName: string | null | undefined, reason: string | null | undefined): string {
  return `manual (allowed by ${allowedByName || 'the superadmin'}: ${(reason || '').trim() || 'no reason given'})`;
}

/**
 * What the superadmin sees beside Allow / Revoke for a live allowance (round
 * 2 of the review): the "manual (allowed by X: reason)" label only for the
 * allowance the opening shown was entered under (openingAllowanceId). An
 * unused one says so; a used one that the opening is not from (its data was
 * cleared) says that, so a pulled or empty month never reads as manual.
 */
export function allowanceControlLabel(
  a: Pick<ManualSourceAllowance, 'id' | 'reason' | 'used_at'>,
  openingAllowanceId: string | null | undefined,
  allowedByName: string | null | undefined,
): string {
  const who = allowedByName || 'the superadmin';
  const why = (a.reason || '').trim() || 'no reason given';
  if (!a.used_at) return `Manual entry allowed by ${who}: ${why} · not used yet`;
  if (openingAllowanceId && a.id === openingAllowanceId) return manualSourceLabel(allowedByName, a.reason);
  const used = new Date(a.used_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return `Manual entry used ${used} (allowed by ${who}: ${why}); the opening shown is not from it`;
}
