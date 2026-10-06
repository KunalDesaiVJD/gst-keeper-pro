// One worker = one Chromium profile with the GST Keeper extension, one client
// at a time. It claims a job, starts it in the extension, relays the login
// CAPTCHA to the app's CAPTCHA wall while somebody has the wall open (parks
// the job otherwise), and finishes the job from what the extension wrote to
// the run ledger. It never solves a CAPTCHA and never files anything.
import { chromium, type BrowserContext, type Page, type Worker as SW } from 'playwright';
import path from 'node:path';
import type { AgentConfig } from './config.js';
import { sleep, type Db } from './db.js';
import { log } from './log.js';
import { readOutcome } from './outcome.js';
import { bannerText, captchaImage, captchaReady, DASHBOARD_URL, documentToken, fillCaptcha, logOut } from './portal.js';
import type { SessionStore } from './sessions.js';

export interface Settings {
  enabled: boolean;
  paused: boolean;
  concurrency: number;
  keep_sessions: boolean;
  email_trigger: boolean;
  captcha_refresh_secs: number;
  max_attempts: number;
  wall_open: boolean;
}

export interface Shared {
  settings: Settings;
  stopping: boolean;
}

export interface Job {
  id: string;
  client_id: string;
  client_name: string;
  gstin: string;
  job_type: string;
  status: string;
  payload: { mode?: string; periods?: string[] } | null;
  run_id: string | null;
  attempts: number;
}

type WorkerState = 'starting' | 'idle' | 'login' | 'captcha' | 'running' | 'parking' | 'stopped';

declare const API: Record<string, (...args: unknown[]) => Promise<unknown>>;

export interface Hooks {
  // Tests serve a stand-in portal through this; production never sets it.
  route?: (context: BrowserContext) => Promise<void>;
}

export class PortalWorker {
  state: WorkerState = 'starting';
  private since = Date.now();
  private jobId: string | null = null;
  private clientName: string | null = null;
  private context: BrowserContext | null = null;
  private sw: SW | null = null;
  private sessionOpen = false;
  private sessionClient: string | null = null;

  constructor(
    readonly n: number,
    private cfg: AgentConfig,
    private db: Db,
    private shared: Shared,
    private extensionDir: string,
    private sessions: SessionStore,
    private hooks: Hooks = {},
  ) {}

  info() {
    return { n: this.n, state: this.state, client_name: this.clientName, job_id: this.jobId, since: new Date(this.since).toISOString() };
  }

  private setState(s: WorkerState) {
    if (s !== this.state) { this.state = s; this.since = Date.now(); }
  }

  async loop(): Promise<void> {
    while (!this.shared.stopping) {
      const s = this.shared.settings;
      if (!s.enabled || s.paused || this.n > s.concurrency) {
        this.setState('idle');
        await sleep(this.cfg.pollMs);
        continue;
      }
      let job: Job | null = null;
      try {
        job = await this.db.rpc<Job | null>('portal_job_claim', { p_agent: this.cfg.agentId, p_wall_open: s.wall_open });
      } catch (e) {
        log('warn', `worker ${this.n}: claim failed: ${(e as Error).message}`);
        await sleep(this.cfg.pollMs * 2);
        continue;
      }
      if (!job) {
        this.setState('idle');
        await sleep(this.cfg.pollMs);
        continue;
      }
      try {
        await this.runJob(job);
      } catch (e) {
        const msg = (e as Error).message || String(e);
        log('error', `worker ${this.n}: ${job.client_name}: ${msg}`);
        await this.finish(job, 'retry', 'agent_error', msg.slice(0, 500)).catch(() => {});
        await this.closeBrowser();
      } finally {
        this.jobId = null;
        this.clientName = null;
        this.setState('idle');
      }
      // Gentle on the portal: a pause between clients.
      await sleep(1500 + Math.floor(Math.random() * 1500));
    }
    this.setState('stopped');
  }

  // ── the job ──────────────────────────────────────────────────────────────
  private async runJob(job: Job) {
    this.jobId = job.id;
    this.clientName = job.client_name;
    const s = this.shared.settings;
    const keep = s.keep_sessions && this.sessions.enabled;
    const saved = keep ? this.sessions.load(job.client_id) : null;
    const mode = job.payload?.mode || 'notices_bundle';
    const label = `${job.client_name} (${job.gstin}) · ${mode}`;

    // Without a session to reuse the portal wants a CAPTCHA: nobody at the
    // wall, the job waits without opening the portal at all.
    if (!saved && !s.wall_open) {
      await this.park(job, 'nobody at the CAPTCHA wall');
      return;
    }
    log('info', `worker ${this.n}: start ${label}${saved ? ' (reusing the saved session)' : ''}`);
    await this.ensureBrowser();
    const context = this.context!;

    if (this.sessionOpen && (this.sessionClient !== job.client_id || !saved)) {
      await logOut(context);
      this.sessionOpen = false;
      this.sessionClient = null;
    } else if (!this.sessionOpen) {
      await context.clearCookies();
    }
    if (saved && this.sessionClient !== job.client_id) await context.addCookies(saved);

    await this.db.rpc('portal_job_start', { p_job_id: job.id, p_agent: this.cfg.agentId, p_session_reused: !!saved });
    await this.event(job.id, 'info', 'start', saved ? 'Started with a saved portal session.' : 'Started; the portal will ask for a CAPTCHA.');
    const since = new Date(Date.now() - 2000).toISOString();

    // One blank tab stays open (the extension opens the job's tab in its
    // window); tabs left from an earlier job go.
    const pages = context.pages();
    const keeper = pages.find((p) => p.url() === 'about:blank') ?? await context.newPage();
    for (const p of pages) if (p !== keeper) await p.close().catch(() => {});
    const pagePromise = context.waitForEvent('page', { timeout: 30000 });
    pagePromise.catch(() => {});
    await this.api('startAgentJob', {
      clientId: job.client_id, mode, periods: job.payload?.periods || [], runId: job.run_id, jobId: job.id,
      startUrl: saved ? DASHBOARD_URL : undefined,
    });
    const page = await pagePromise;
    this.sessionOpen = true;
    this.sessionClient = job.client_id;
    this.setState('login');

    const deadline = Date.now() + this.cfg.jobBudgetMin * 60_000;
    let attempt = 0;
    let lastCheck = 0;
    // A login page that never shows a CAPTCHA (portal slow, layout changed):
    // reload it twice, then try the job again later.
    let loginWaitSince = Date.now();
    let loginReloads = 0;
    for (;;) {
      const st = (await this.api('agentJobState')) as { step: string } | null;
      if (!st) break;
      if (st.step !== 'login') this.setState('running');
      if (Date.now() > deadline) {
        await this.abort(page);
        await this.finish(job, 'retry', 'stalled', `The job ran past its ${this.cfg.jobBudgetMin}-minute budget.`);
        return;
      }
      if (Date.now() - lastCheck > 5000) {
        lastCheck = Date.now();
        if (await this.cancelled(job)) { await this.abort(page); log('info', `worker ${this.n}: ${label} cancelled`); return; }
        if (!this.shared.settings.enabled && st.step === 'login') { await this.abort(page); await this.park(job, 'autopilot switched off'); return; }
      }
      if (st.step === 'login') {
        const banner = await bannerText(page);
        if (/No saved GST portal password/i.test(banner)) {
          await this.abort(page);
          await this.db.rpc('sync_log_step', { p_run_id: job.run_id, p_client_id: job.client_id, p_step: 'login', p_status: 'failed',
            p_reason_class: 'login_failed', p_message: 'No saved GST portal password for this client.' }).catch(() => {});
          await this.finish(job, 'failed', 'login_failed', 'No saved GST portal password for this client.');
          return;
        }
        if (/Login form did not load/i.test(banner)) {
          await this.abort(page);
          await this.finish(job, 'retry', 'portal_error', 'The portal login page did not load.');
          return;
        }
        if (!saved && !this.shared.settings.wall_open) { await this.abort(page); await this.park(job, 'everyone left the CAPTCHA wall'); return; }
        if (await captchaReady(page)) {
          loginWaitSince = Date.now();
          if (saved) this.sessions.drop(job.client_id); // the kept session had expired
          attempt++;
          const r = await this.relayCaptcha(job, page, attempt);
          if (r === 'gone') { await this.abort(page); return; }
          if (r === 'skip') {
            await this.abort(page);
            await this.finish(job, 'cancelled', 'skipped_at_wall', 'Skipped on the CAPTCHA wall.');
            return;
          }
          if (r === 'park') { await this.abort(page); await this.park(job, 'everyone left the CAPTCHA wall'); return; }
          if (r === 'refresh' || r === 'timeout') {
            await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
            continue;
          }
          this.setState('login');
          loginWaitSince = Date.now();
          continue;
        }
        if (Date.now() - loginWaitSince > 60_000) {
          if (loginReloads >= 2) {
            await this.abort(page);
            await this.finish(job, 'retry', 'portal_error', 'The portal login page did not show a CAPTCHA.');
            return;
          }
          loginReloads++;
          loginWaitSince = Date.now();
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          continue;
        }
      } else {
        loginWaitSince = Date.now();
      }
      await sleep(1000);
    }

    const outcome = await readOutcome(this.db, job, since);
    await page.close().catch(() => {});
    if (keep && outcome.loggedIn) {
      this.sessions.save(job.client_id, await context.cookies());
    } else {
      if (keep) this.sessions.drop(job.client_id);
      await logOut(context);
      this.sessionOpen = false;
      this.sessionClient = null;
    }
    await this.finish(job, outcome.outcome, outcome.reason, outcome.error, outcome.result);
    log('info', `worker ${this.n}: ${label}: ${outcome.outcome}${outcome.reason ? ' (' + outcome.reason + ')' : ''}`);
  }

  // Show the CAPTCHA on the wall and wait for a person. 'answered' once the
  // characters are in the portal's field (the extension then presses Login).
  private async relayCaptcha(job: Job, page: Page, attempt: number): Promise<'answered' | 'refresh' | 'skip' | 'park' | 'timeout' | 'gone'> {
    this.setState('captcha');
    const image = await captchaImage(page);
    const promptId = await this.db.rpc<string | null>('portal_job_captcha', { p_job_id: job.id, p_agent: this.cfg.agentId, p_image: image, p_attempt: attempt });
    if (!promptId) return 'gone';
    await this.event(job.id, 'info', 'captcha', attempt > 1 ? `CAPTCHA shown again (try ${attempt}).` : 'CAPTCHA shown on the wall.');
    const until = Date.now() + this.shared.settings.captcha_refresh_secs * 1000;
    while (Date.now() < until) {
      await sleep(1000);
      const rows = await this.db.get<{ status: string; human_response: { action?: string; captcha?: string; prompt_id?: string; by?: string } | null }[]>(
        `portal_jobs?id=eq.${job.id}&select=status,human_response`);
      const row = rows[0];
      if (!row || row.status === 'cancelled' || row.status === 'succeeded' || row.status === 'failed') return 'gone';
      const hr = row.human_response;
      if (hr && hr.prompt_id === promptId) {
        if (hr.action === 'skip') return 'skip';
        if (hr.action === 'refresh') return 'refresh';
        if (hr.action === 'answer' && hr.captcha) {
          const token = await documentToken(page);
          await fillCaptcha(page, hr.captcha);
          await this.event(job.id, 'info', 'captcha', `CAPTCHA typed${hr.by ? ' by ' + hr.by : ''}.`);
          // Wait for the portal to answer: a new page (logged in, or a fresh
          // CAPTCHA after a wrong one) or the job ending (password rejected).
          const waitUntil = Date.now() + 30_000;
          while (Date.now() < waitUntil) {
            await sleep(1000);
            if (page.isClosed()) break;
            if ((await documentToken(page)) !== token) break;
            if (!(await this.api('agentJobState'))) break;
          }
          return 'answered';
        }
      }
      if (!this.shared.settings.wall_open) return 'park';
    }
    return 'timeout';
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  private async park(job: Job, why: string) {
    this.setState('parking');
    await this.db.rpc('portal_job_park', { p_job_id: job.id, p_agent: this.cfg.agentId });
    log('info', `worker ${this.n}: ${job.client_name} waits for a CAPTCHA (${why})`);
  }

  private async finish(job: Job, outcome: string, reason: string | null, error: string | null, result?: Record<string, unknown>) {
    const r = await this.db.rpc<{ status: string }>('portal_job_finish', {
      p_job_id: job.id, p_agent: this.cfg.agentId, p_outcome: outcome, p_reason_class: reason, p_error: error, p_result: result ?? null,
    });
    await this.event(job.id, outcome === 'succeeded' ? 'info' : 'warn', 'finish',
      `${r?.status ?? outcome}${reason ? ' · ' + reason : ''}${error ? ' · ' + error.slice(0, 300) : ''}`);
  }

  private async cancelled(job: Job): Promise<boolean> {
    const rows = await this.db.get<{ status: string }[]>(`portal_jobs?id=eq.${job.id}&select=status`).catch(() => []);
    return rows[0]?.status === 'cancelled';
  }

  private async abort(page: Page) {
    await this.api('agentClearJob').catch(() => {});
    await page.close().catch(() => {});
  }

  private async event(jobId: string, level: 'info' | 'warn' | 'error', step: string, message: string) {
    await this.db.post('portal_job_events', [{ job_id: jobId, level, step, message }]).catch(() => {});
  }

  // ── the browser ──────────────────────────────────────────────────────────
  private async ensureBrowser() {
    if (this.context) return;
    const profile = path.join(this.cfg.dataDir, 'profiles', `worker-${this.n}`);
    const context = await chromium.launchPersistentContext(profile, {
      // The full Chromium (its new headless mode) so the extension loads
      // without a window too.
      channel: this.cfg.chromiumPath ? undefined : 'chromium',
      executablePath: this.cfg.chromiumPath ?? undefined,
      headless: !this.cfg.headful,
      args: [`--disable-extensions-except=${this.extensionDir}`, `--load-extension=${this.extensionDir}`],
      viewport: { width: 1366, height: 900 },
    });
    context.on('close', () => { this.context = null; this.sw = null; this.sessionOpen = false; this.sessionClient = null; });
    if (this.hooks.route) await this.hooks.route(context);
    this.context = context;
    this.sw = await this.findServiceWorker();
    const version = await this.api('agentVersion').catch(() => null);
    log('info', `worker ${this.n}: browser ready (extension ${version ?? '?'})`);
  }

  private async findServiceWorker(): Promise<SW> {
    const ctx = this.context!;
    const existing = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
    if (existing) return existing;
    return ctx.waitForEvent('serviceworker', { timeout: 30000 });
  }

  // Calls a function of the extension's background worker (background.js API).
  private async api(fn: string, ...args: unknown[]): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!this.sw) this.sw = await this.findServiceWorker();
        return await this.sw.evaluate(([f, a]) => {
          if (f === 'agentVersion') return chrome.runtime.getManifest().version;
          return API[f as string](...(a as unknown[]));
        }, [fn, args] as const);
      } catch (e) {
        if (attempt === 1) throw e;
        this.sw = null; // the worker restarted; find it again
      }
    }
    return null;
  }

  async closeBrowser() {
    const c = this.context;
    this.context = null;
    this.sw = null;
    this.sessionOpen = false;
    this.sessionClient = null;
    if (c) await c.close().catch(() => {});
  }
}

declare const chrome: { runtime: { getManifest(): { version: string } } };
