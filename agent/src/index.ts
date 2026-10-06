// GST Keeper portal agent (Portal Autopilot, roadmap Phase 3). Runs on an
// always-on office PC: claims jobs from the app's queue, drives the GST
// Keeper extension through the portal in its own Chromium, shows each login
// CAPTCHA on the app's CAPTCHA wall for a person to type, and writes nothing
// itself but job status — the extension saves the data. No CAPTCHA solver, no
// proxies, no filing. See agent/README.md and docs/PORTAL_AUTOPILOT_POSITIONS.md.
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, VERSION, type AgentConfig } from './config.js';
import { makeDb, sleep, type Db } from './db.js';
import { stageExtension } from './extension.js';
import { initLog, log } from './log.js';
import { SessionStore } from './sessions.js';
import { PortalWorker, type Hooks, type Settings, type Shared } from './worker.js';

const OFF: Settings = {
  enabled: false, paused: false, concurrency: 1, keep_sessions: false, email_trigger: false,
  captcha_refresh_secs: 150, max_attempts: 3, wall_open: false,
};

export interface RunningAgent {
  stop(): Promise<void>;
  shared: Shared;
  workers: PortalWorker[];
}

export interface StartOptions extends Hooks {
  config?: Partial<AgentConfig>;
  env?: NodeJS.ProcessEnv;
  db?: Db;
}

export async function startAgent(opts: StartOptions = {}): Promise<RunningAgent> {
  const cfg = loadConfig(opts.env ?? process.env, opts.config ?? {});
  initLog(cfg.dataDir);
  const db = opts.db ?? makeDb(cfg);
  const ext = stageExtension(cfg);
  const sessions = new SessionStore(path.join(cfg.dataDir, 'sessions'), cfg.sessionKey, cfg.sessionMaxAgeMin);
  const shared: Shared = { settings: { ...OFF }, stopping: false };
  const startedAt = new Date().toISOString();
  log('info', `GST Keeper portal agent ${VERSION} "${cfg.agentId}" · extension ${ext.version} · ${cfg.headful ? 'visible' : 'headless'} browser · database ${new URL(cfg.supabaseUrl).host}`);

  // Jobs this agent held when it last stopped go back on the queue.
  const released = await db.rpc<number>('portal_jobs_release', { p_agent: cfg.agentId }).catch(() => 0);
  if (released) log('info', `released ${released} job(s) left from the last run`);

  const workers = Array.from({ length: cfg.maxWorkers }, (_, i) =>
    new PortalWorker(i + 1, cfg, db, shared, ext.dir, sessions, { route: opts.route }));

  let lastBeat = Date.now();
  let warnedNoKey = false;
  const beat = async () => {
    try {
      const s = await db.rpc<Settings>('autopilot_heartbeat', {
        p_agent: cfg.agentId,
        p_info: {
          version: VERSION, ext_version: ext.version, headful: cfg.headful, host: os.hostname(), started_at: startedAt,
          workers: workers.map((w) => w.info()),
        },
      });
      if (s.keep_sessions && !sessions.enabled && !warnedNoKey) {
        warnedNoKey = true;
        log('warn', 'Keep portal sessions is on, but AGENT_SESSION_KEY is not set in agent/.env, so no session is kept.');
      }
      if (s.enabled !== shared.settings.enabled || s.paused !== shared.settings.paused) {
        log('info', s.enabled ? (s.paused ? 'autopilot paused' : 'autopilot on') : 'autopilot off — waiting');
      }
      shared.settings = { ...OFF, ...s };
      lastBeat = Date.now();
    } catch (e) {
      log('warn', `heartbeat failed: ${(e as Error).message}`);
      // Two minutes without the database: stop taking work until it is back.
      if (Date.now() - lastBeat > 120_000) shared.settings = { ...shared.settings, enabled: false };
    }
  };
  await beat();
  const timer = setInterval(() => { void beat(); }, cfg.heartbeatMs);
  const loops = workers.map((w) => w.loop().catch((e) => log('error', `worker ${w.n} stopped: ${(e as Error).message}`)));

  return {
    shared,
    workers,
    async stop() {
      shared.stopping = true;
      clearInterval(timer);
      await Promise.race([Promise.all(loops), sleep(15_000)]);
      await db.rpc('portal_jobs_release', { p_agent: cfg.agentId }).catch(() => 0);
      await Promise.all(workers.map((w) => w.closeBrowser()));
      log('info', 'agent stopped');
    },
  };
}

// `npm start`: run until Ctrl+C / the service stops.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  startAgent().then((agent) => {
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await agent.stop();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }).catch((e) => {
    log('error', (e as Error).message);
    process.exit(1);
  });
}
