import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  supabaseUrl: req('SUPABASE_URL'),
  supabaseServiceKey: req('SUPABASE_SERVICE_ROLE_KEY'),
  agentId: process.env.AGENT_ID || 'office-pc-1',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 4000),
  headful: (process.env.HEADFUL || 'true') === 'true',
  dataDir: process.env.DATA_DIR || './.agent-data',
  // RUN_ONCE: drain the queue and exit (for ephemeral cloud runners like GitHub
  // Actions). Default false = the persistent poll loop (office PC / a VM).
  runOnce: (process.env.RUN_ONCE || 'false') === 'true',
  // Hard time budget for a run-once pass, so a scheduled job can't run away.
  maxRunMs: Number(process.env.MAX_RUN_MS || 300000),
  portalBaseUrl: 'https://services.gst.gov.in',
  loginUrl: 'https://services.gst.gov.in/services/login',
};

export type JobType =
  | 'LOGIN_TEST'
  | 'SYNC_ALL'
  | 'PULL_2B'
  | 'PULL_LEDGERS'
  | 'PULL_GSTR1'
  | 'PULL_FILING_STATUS'
  | 'PUSH_GSTR1_SAVE'
  | 'PUSH_GSTR3B_SAVE';
