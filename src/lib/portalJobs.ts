import { supabase } from '@/integrations/supabase/client';

// The portal_* tables (job queue for the local Playwright Agent) aren't in the
// generated Supabase types yet — and types.ts is churny across sessions — so we
// type them here and cast the client once. All app access to the portal queue
// goes through this lib.
const db = supabase as any;

export type PortalJobType =
  | 'LOGIN_TEST'
  | 'SYNC_ALL'
  | 'PULL_2B'
  | 'PULL_LEDGERS'
  | 'PULL_GSTR1'
  | 'PULL_FILING_STATUS'
  | 'PUSH_GSTR1_SAVE'
  | 'PUSH_GSTR3B_SAVE';

export type PortalJobStatus =
  | 'queued' | 'claimed' | 'running' | 'needs_human' | 'succeeded' | 'failed' | 'cancelled';

export interface PortalJob {
  id: string;
  client_id: string;
  period_month: string | null;
  job_type: PortalJobType;
  mode: 'live' | 'shadow';
  status: PortalJobStatus;
  payload: any;
  result: any;
  verified: boolean | null;
  human_prompt: any;
  human_response: any;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export const JOB_LABELS: Record<PortalJobType, string> = {
  LOGIN_TEST: 'Test portal login',
  SYNC_ALL: 'Sync from portal',
  PULL_2B: 'Pull GSTR-2B',
  PULL_LEDGERS: 'Pull ledgers',
  PULL_GSTR1: 'Pull GSTR-1',
  PULL_FILING_STATUS: 'Pull filing status',
  PUSH_GSTR1_SAVE: 'Push GSTR-1 (save)',
  PUSH_GSTR3B_SAVE: 'Push GSTR-3B (save)',
};

export const TERMINAL_STATUSES: PortalJobStatus[] = ['succeeded', 'failed', 'cancelled'];

export async function enqueuePortalJob(input: {
  clientId: string;
  jobType: PortalJobType;
  periodMonth?: string | null;
  mode?: 'live' | 'shadow';
  payload?: any;
  requestedBy?: string | null;
}): Promise<PortalJob> {
  const { data, error } = await db.from('portal_jobs').insert({
    client_id: input.clientId,
    period_month: input.periodMonth ?? null,
    job_type: input.jobType,
    mode: input.mode ?? 'live',
    payload: input.payload ?? {},
    requested_by: input.requestedBy ?? null,
    status: 'queued',
  }).select('*').single();
  if (error) throw error;
  return data as PortalJob;
}

export async function getPortalJob(jobId: string): Promise<PortalJob | null> {
  const { data } = await db.from('portal_jobs').select('*').eq('id', jobId).maybeSingle();
  return (data as PortalJob) ?? null;
}

// The human's answer to a needs_human prompt (e.g. the CAPTCHA text). The Agent,
// which is polling, picks this up and continues.
export async function submitCaptcha(jobId: string, captcha: string): Promise<void> {
  const { error } = await db.from('portal_jobs')
    .update({ human_response: { captcha }, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw error;
}

export async function cancelPortalJob(jobId: string): Promise<void> {
  await db.from('portal_jobs').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', jobId);
}

export async function recentPortalJobs(clientId: string, periodMonth: string | null, limit = 10): Promise<PortalJob[]> {
  let q = db.from('portal_jobs').select('*').eq('client_id', clientId)
    .order('created_at', { ascending: false }).limit(limit);
  if (periodMonth) q = q.eq('period_month', periodMonth);
  const { data } = await q;
  return (data as PortalJob[]) ?? [];
}

export interface AgentStatus { online: boolean; lastSeen: string | null; agentId: string | null }

// The Agent upserts a heartbeat each poll; "online" if seen in the last 30s.
export async function getAgentStatus(): Promise<AgentStatus> {
  const { data } = await db.from('portal_agent_heartbeat')
    .select('agent_id, last_seen').order('last_seen', { ascending: false }).limit(1).maybeSingle();
  if (!data?.last_seen) return { online: false, lastSeen: null, agentId: null };
  const online = Date.now() - new Date(data.last_seen).getTime() < 30_000;
  return { online, lastSeen: data.last_seen, agentId: data.agent_id ?? null };
}
