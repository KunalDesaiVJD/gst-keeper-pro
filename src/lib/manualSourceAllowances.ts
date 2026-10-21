// The superadmin's manual-source allowances (20261021110000, shared by Filing
// Status and the reco pages): one manual upload for one client, period and
// scope, with a reason. Given and taken back only through the RPCs below (a
// database trigger refuses every other write); the page that uses one marks
// it used, in the database, in the same write as the manual data.
//
// Scopes: 'filing:<return type>' (Filing Status), 'reco:suspended',
// 'reco:receivable' (Suspended Reco, GST Receivable Reco).
import { supabase } from '@/integrations/supabase/client';

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

const TABLE = 'manual_source_allowances';

export const filingScope = (returnType: string) => `filing:${returnType}`;

/** Allowances for a period (all scopes, or those starting with scopePrefix), newest first. */
export async function fetchAllowances(periodMonth: string, scopePrefix?: string): Promise<ManualSourceAllowance[]> {
  let q = supabase
    .from(TABLE as never)
    .select('id, client_id, period_month, scope, reason, allowed_by, allowed_at, used_by, used_at, revoked_at, revoked_by')
    .eq('period_month', periodMonth)
    .order('allowed_at', { ascending: false });
  if (scopePrefix) q = q.like('scope', `${scopePrefix}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as ManualSourceAllowance[]) || [];
}

/** Allowances by id (to explain rows marked manual). */
export async function fetchAllowancesById(ids: string[]): Promise<ManualSourceAllowance[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const { data, error } = await supabase
    .from(TABLE as never)
    .select('id, client_id, period_month, scope, reason, allowed_by, allowed_at, used_by, used_at, revoked_at, revoked_by')
    .in('id', unique);
  if (error) throw error;
  return (data as unknown as ManualSourceAllowance[]) || [];
}

/** The live allowance (not taken back) for a client, period and scope, used or not. */
export function liveAllowance(list: ManualSourceAllowance[], clientId: string, periodMonth: string, scope: string): ManualSourceAllowance | null {
  return list.find((a) => a.client_id === clientId && a.period_month === periodMonth && a.scope === scope && !a.revoked_at) || null;
}

export async function allowManualSource(params: {
  actorId: string; clientId: string; periodMonth: string; scope: string; reason: string;
}): Promise<ManualSourceAllowance> {
  const { data, error } = await supabase.rpc('manual_source_allow' as never, {
    p_actor_id: params.actorId, p_client_id: params.clientId, p_period: params.periodMonth,
    p_scope: params.scope, p_reason: params.reason,
  } as never);
  if (error) throw new Error(error.message);
  return data as unknown as ManualSourceAllowance;
}

export async function revokeManualSource(actorId: string, id: string): Promise<ManualSourceAllowance> {
  const { data, error } = await supabase.rpc('manual_source_revoke' as never, { p_actor_id: actorId, p_id: id } as never);
  if (error) throw new Error(error.message);
  return data as unknown as ManualSourceAllowance;
}

/** "manual (allowed by Asha: portal password changed)". */
export function allowanceBadgeText(a: Pick<ManualSourceAllowance, 'allowed_by' | 'reason'> | null | undefined, names: Record<string, string>): string {
  if (!a) return 'manual';
  return `manual (allowed by ${names[a.allowed_by] || 'the superadmin'}: ${a.reason})`;
}
