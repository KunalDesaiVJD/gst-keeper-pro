// Fixtures for the Chrome runner end-to-end test (chrome-runner.e2e.test.ts):
// a stand-in for Supabase's gateway in front of a LOCAL PostgREST, the stand-in
// portal with one CAPTCHA answer per browser, a Chromium with the real GST Keeper
// extension (staged the way the office agent stages it), and a stand-in for the
// firm's CAPTCHA extension. Test-only: nothing here ships in extension/.
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { chromium, type BrowserContext, type Page, type Route, type Worker as SW } from 'playwright';
import { FakePortal } from './fakePortal.js';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Supabase serves PostgREST under /rest/v1 and Storage under /storage/v1; this gateway does the same. */
export function startGateway(pgrst: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const url = req.url || '/';
    if (url.startsWith('/storage/v1/')) { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end('{}'); req.resume(); return; }
    if (!url.startsWith('/rest/v1/')) { res.writeHead(404, cors); res.end(); req.resume(); return; }
    const target = new URL(pgrst + url.slice('/rest/v1'.length));
    const up = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
      res.writeHead(r.statusCode || 502, { ...r.headers, ...cors });
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502, cors); res.end(); });
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => server.close(),
  })));
}

/**
 * FakePortal keeps one CAPTCHA answer for every browser; two runners log in at
 * the same moment here, so the CAPTCHA image and the login check are answered
 * per browser and everything else falls through to FakePortal.
 */
export class RunnerPortal {
  readonly fake = new FakePortal();
  /** Users whose refused login comes back as a fresh login page, not in place. */
  readonly freshPage = new Set<string>();
  private answers = new Map<BrowserContext, string>();

  async route(ctx: BrowserContext) {
    await this.fake.route(ctx);
    // Registered last, so it runs first for these two paths.
    await ctx.route(/^https:\/\/services\.gst\.gov\.in\/services\/(captcha|api\/authenticate)(\?|$)/, (r) => this.handle(ctx, r));
  }

  answerFor(ctx: BrowserContext): string { return this.answers.get(ctx) ?? ''; }

  private async handle(ctx: BrowserContext, route: Route) {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    this.fake.requests++;
    this.fake.log.push(`${req.method()} ${p}`);
    if (p === '/services/captcha') {
      const answer = String(100000 + Math.floor(Math.random() * 900000));
      this.answers.set(ctx, answer);
      this.fake.expected = answer;
      this.fake.captchasServed++;
      return route.fulfill({ status: 200, contentType: 'image/png', body: GREY_PNG });
    }
    const b = JSON.parse(req.postData() || '{}') as { user?: string; pass?: string; captcha?: string };
    const json = (o: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    // Every Login press, by user and answer ("auth kiran refused"), so a test can count the tries of a password.
    if (String(b.captcha) !== this.answerFor(ctx)) { this.fake.log.push(`auth ${b.user} captcha`); return json({ ok: false, error: 'Enter valid Letters shown.' }); }
    const acc = this.fake.accounts[b.user ?? ''];
    if (!acc || acc.password !== b.pass) {
      this.fake.log.push(`auth ${b.user} refused`);
      return json({ ok: false, error: 'Invalid Username or Password. Please try again.', reload: this.freshPage.has(b.user ?? '') });
    }
    this.fake.log.push(`auth ${b.user} ok`);
    return json({ ok: true, session: b.user, redirect: this.fake.forceChange.has(b.user ?? '') ? '/services/auth/changepassword' : undefined });
  }
}

// A plain 120x40 grey PNG: what matters is that it is an image (the extension never looks at it).
const GREY_PNG = (() => {
  const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, sum]);
  };
  const w = 120, h = 40;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 180);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();

export interface Fill { user: string; marked: string | null; at: number }

/**
 * The firm's CAPTCHA extension, played by the test: on the stand-in portal's
 * login page it waits until the user ID and password are in, then writes the
 * answer into the CAPTCHA box in one go (page.fill: one input event), as an OCR
 * fill does. It takes the answer from RunnerPortal, never from the image, and
 * fills only for the users `allow` lets through.
 */
export class CaptchaFiller {
  allow: (user: string) => boolean = () => true;
  delayMs = 300;
  readonly fills: Fill[] = [];
  private watched = new WeakSet<Page>();

  constructor(private portal: RunnerPortal) {}

  attach(ctx: BrowserContext) {
    for (const p of ctx.pages()) this.watch(ctx, p);
    ctx.on('page', (p) => this.watch(ctx, p));
  }

  private watch(ctx: BrowserContext, page: Page) {
    if (this.watched.has(page)) return;
    this.watched.add(page);
    let filledSrc = '';
    const loop = async () => {
      while (!page.isClosed()) {
        try {
          if (/\/services\/login/.test(page.url())) {
            // No function declared inside: tsx names inner functions with a helper the page does not have.
            const s = await page.evaluate(() => {
              const user = document.querySelector('#username') as HTMLInputElement | null;
              const pass = document.querySelector('#user_pass') as HTMLInputElement | null;
              const box = document.querySelector('#captcha') as HTMLInputElement | null;
              const img = document.querySelector('#imgCaptcha') as HTMLImageElement | null;
              return {
                user: user ? user.value : '', pass: pass ? pass.value : '', box: box ? box.value : '', src: img ? img.src : '',
                ready: !!img && img.complete && img.naturalWidth > 0,
                marked: document.documentElement.getAttribute('data-gstk-captcha'),
              };
            });
            if (s.user && s.pass && s.ready && !s.box && s.src !== filledSrc && this.allow(s.user)) {
              await sleep(this.delayMs);
              filledSrc = s.src;
              await page.fill('#captcha', this.portal.answerFor(ctx), { timeout: 5000 });
              this.fills.push({ user: s.user, marked: s.marked, at: Date.now() });
            }
          }
        } catch { /* the page navigated or closed */ }
        await sleep(250);
      }
    };
    void loop();
  }
}

declare const API: Record<string, (...args: unknown[]) => Promise<unknown>>;
declare const GSTK_RUNNER: { tick(why: string): Promise<unknown>; state(): Promise<unknown> };
declare const chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>>; remove(k: string): Promise<void> } } };

export interface RunnerState {
  status: string;
  why: string | null;
  error: string | null;
  job: { id: string; client_name: string; tab_id: number | null; window_id: number | null; phase: string } | null;
  last: { job_id: string; client_name: string; outcome: string; status: string | null; reason: string | null; error: string | null } | null;
  beat: { ok: boolean; runner: string | null; serves: boolean; enabled: boolean; captcha_wait_secs: number } | null;
}

/** One Chrome profile with the extension: the firm's Chrome, as far as the runner can tell. */
export class ChromeRunner {
  private constructor(readonly ctx: BrowserContext, private sw: SW, readonly profile: string) {}

  static async launch(extDir: string, profile: string, portal: RunnerPortal, filler: CaptchaFiller): Promise<ChromeRunner> {
    const ctx = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
      viewport: { width: 1280, height: 900 },
    });
    await portal.route(ctx);
    filler.attach(ctx);
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
      ?? await ctx.waitForEvent('serviceworker', { timeout: 30_000 });
    return new ChromeRunner(ctx, sw, profile);
  }

  private async worker(): Promise<SW> {
    const live = this.ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
    if (live) this.sw = live;
    return this.sw;
  }

  /** Runs in the extension's background worker (background.js / runner.js globals); a restarted worker is found again. */
  private async inWorker<T>(run: (sw: SW) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run(await this.worker());
      } catch (e) {
        if (attempt >= 2) throw e;
        await sleep(500);
      }
    }
  }

  api<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
    return this.inWorker((sw) => sw.evaluate(([f, a]) => API[f](...a), [fn, args] as const)) as Promise<T>;
  }
  tick(): Promise<unknown> { return this.inWorker((sw) => sw.evaluate(() => GSTK_RUNNER.tick('test'))); }
  state(): Promise<RunnerState> { return this.inWorker((sw) => sw.evaluate(() => GSTK_RUNNER.state())) as Promise<RunnerState>; }
  activeJob(): Promise<Record<string, unknown> | null> {
    return this.inWorker((sw) => sw.evaluate(async () => ((await chrome.storage.local.get('gstk_active_job')).gstk_active_job ?? null) as Record<string, unknown> | null));
  }
  /** What the popup's Stop does to a person's sync. */
  clearJob(): Promise<void> { return this.inWorker((sw) => sw.evaluate(() => chrome.storage.local.remove('gstk_active_job'))); }

  portalPages(): Page[] { return this.ctx.pages().filter((p) => /\.gst\.gov\.in\//.test(p.url())); }

  async close() { await this.ctx.close().catch(() => {}); }
}
