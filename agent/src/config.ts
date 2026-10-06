// Agent settings from agent/.env (see .env.example). The switches that matter
// day to day (on/off, schedule, how many browsers, sessions) live in the app's
// Autopilot settings and come back with every heartbeat, not from here.
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const AGENT_ROOT = path.resolve(here, '..');
export const VERSION: string = JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, 'package.json'), 'utf8')).version;

export interface AgentConfig {
  agentId: string;
  supabaseUrl: string;
  anonKey: string;
  extensionDir: string;
  dataDir: string;
  headful: boolean;
  chromiumPath: string | null;
  pollMs: number;
  heartbeatMs: number;
  jobBudgetMin: number;
  sessionKey: string | null;
  sessionMaxAgeMin: number;
  maxWorkers: number;
  // Reading notices with the Claude API (src/read/). No key: the reader stays off.
  anthropicApiKey: string | null;
  // Tests only (a stand-in server). Never read from the environment: the agent
  // sends notices to the Claude API at api.anthropic.com and nowhere else.
  anthropicBaseUrl: string | null;
  readerPollMs: number;
}

// The app's own public settings, so the agent needs no secret of its own: the
// URL and the publishable (anon) key the extension already ships with.
function extensionConfig(extensionDir: string): { url?: string; key?: string } {
  try {
    const src = fs.readFileSync(path.join(extensionDir, 'config.js'), 'utf8');
    return {
      url: /SUPABASE_URL\s*:\s*['"]([^'"]+)['"]/.exec(src)?.[1],
      key: /SUPABASE_ANON_KEY\s*:\s*['"]([^'"]+)['"]/.exec(src)?.[1],
    };
  } catch {
    return {};
  }
}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? Math.min(max, Math.max(min, n)) : d;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AgentConfig> = {}): AgentConfig {
  const extensionDir = path.resolve(AGENT_ROOT, env.EXTENSION_DIR || '../extension');
  const ext = extensionConfig(extensionDir);
  const cfg: AgentConfig = {
    agentId: env.AGENT_ID || `office-${os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'pc'}`,
    supabaseUrl: (env.SUPABASE_URL || ext.url || '').replace(/\/+$/, ''),
    anonKey: env.SUPABASE_ANON_KEY || ext.key || '',
    extensionDir,
    dataDir: path.resolve(AGENT_ROOT, env.DATA_DIR || './.agent-data'),
    headful: bool(env.HEADFUL, true),
    chromiumPath: env.CHROMIUM_PATH || null,
    pollMs: num(env.POLL_INTERVAL_MS, 5000, 1000, 60000),
    heartbeatMs: num(env.HEARTBEAT_MS, 10000, 2000, 60000),
    jobBudgetMin: num(env.JOB_BUDGET_MIN, 40, 5, 180),
    sessionKey: env.AGENT_SESSION_KEY || null,
    sessionMaxAgeMin: num(env.SESSION_MAX_AGE_MIN, 50, 5, 720),
    maxWorkers: num(env.MAX_WORKERS, 4, 1, 4),
    anthropicApiKey: (env.ANTHROPIC_API_KEY || '').trim() || null,
    anthropicBaseUrl: null,
    readerPollMs: num(env.READER_POLL_MS, 15000, 2000, 600000),
    ...overrides,
  };
  if (!cfg.supabaseUrl || !cfg.anonKey) {
    throw new Error('No database address: set SUPABASE_URL and SUPABASE_ANON_KEY in agent/.env, or keep the extension folder next to the agent.');
  }
  if (/gst\.gov\.in/i.test(cfg.supabaseUrl)) throw new Error('SUPABASE_URL must be the GST Keeper database, not the portal.');
  return cfg;
}
