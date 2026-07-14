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
  portalBaseUrl: 'https://services.gst.gov.in',
  loginUrl: 'https://services.gst.gov.in/services/login',
};

export type JobType =
  | 'LOGIN_TEST'
  | 'PULL_2B'
  | 'PULL_LEDGERS'
  | 'PULL_GSTR1'
  | 'PULL_FILING_STATUS'
  | 'PUSH_GSTR1_SAVE'
  | 'PUSH_GSTR3B_SAVE';
