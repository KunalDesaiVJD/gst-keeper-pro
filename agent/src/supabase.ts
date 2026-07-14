import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Service-role client — reads client credentials, writes job results. This runs
// only on the trusted office machine.
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
});

export interface PortalJob {
  id: string;
  client_id: string;
  period_month: string | null;
  job_type: string;
  mode: 'live' | 'shadow';
  status: string;
  payload: any;
  result: any;
  human_response: any;
  attempts: number;
}

export interface ClientCreds {
  id: string;
  name: string;
  gstin: string;
  gst_user_id: string | null;
  gst_password: string | null;
}

// Atomically claim the oldest queued job for this agent. (Uses a conditional
// update; for a single agent this is race-free. Multiple agents would want an
// RPC with SELECT ... FOR UPDATE SKIP LOCKED — noted for Phase 6.)
export async function claimNextJob(): Promise<PortalJob | null> {
  const { data: candidate } = await supabase
    .from('portal_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!candidate) return null;

  const { data: claimed } = await supabase
    .from('portal_jobs')
    .update({ status: 'claimed', claimed_by: config.agentId, updated_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', 'queued') // only if still queued
    .select('*')
    .maybeSingle();
  return (claimed as PortalJob) || null;
}

export async function setStatus(jobId: string, status: string, patch: Record<string, any> = {}) {
  await supabase.from('portal_jobs')
    .update({ status, updated_at: new Date().toISOString(), ...patch })
    .eq('id', jobId);
}

export async function finishJob(jobId: string, ok: boolean, patch: Record<string, any> = {}) {
  await supabase.from('portal_jobs').update({
    status: ok ? 'succeeded' : 'failed',
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...patch,
  }).eq('id', jobId);
}

export async function logEvent(
  jobId: string,
  level: 'info' | 'warn' | 'error',
  step: string,
  message: string,
  screenshotPath?: string,
) {
  console.log(`[${level}] ${step}: ${message}`);
  await supabase.from('portal_job_events').insert({ job_id: jobId, level, step, message, screenshot_path: screenshotPath });
}

export async function recordVerification(v: {
  jobId: string; clientId: string; period: string | null; checkType: string;
  passed: boolean; expected: any; actual: any; diff?: any;
}) {
  await supabase.from('portal_verifications').insert({
    job_id: v.jobId, client_id: v.clientId, period_month: v.period,
    check_type: v.checkType, passed: v.passed, expected: v.expected, actual: v.actual, diff: v.diff ?? null,
  });
}

// Liveness ping so the app can show "agent online".
export async function heartbeat() {
  await supabase.from('portal_agent_heartbeat').upsert({
    agent_id: config.agentId, last_seen: new Date().toISOString(), info: { headful: config.headful },
  }, { onConflict: 'agent_id' });
}

export async function getClientCreds(clientId: string): Promise<ClientCreds | null> {
  const { data } = await supabase.from('clients')
    .select('id, name, gstin, gst_user_id, gst_password')
    .eq('id', clientId).maybeSingle();
  return (data as ClientCreds) || null;
}

// Poll a needs_human job until the app writes back human_response (e.g. captcha text).
export async function waitForHumanResponse(jobId: string, timeoutMs = 180000): Promise<any | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await supabase.from('portal_jobs').select('human_response, status').eq('id', jobId).maybeSingle();
    if (data?.status === 'cancelled') return null;
    if (data?.human_response) return data.human_response;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}
