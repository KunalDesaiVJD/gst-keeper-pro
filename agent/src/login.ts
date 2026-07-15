import { BrowserContext, Page } from 'playwright';
import { config } from './config.js';
import { PortalJob, ClientCreds, setStatus, waitForHumanResponse, logEvent } from './supabase.js';
import { saveSession } from './browser.js';
import { autoSolveCaptcha } from './captchaSolver.js';

// Returns a logged-in page for the client, reusing a saved session when possible.
// If a fresh login is needed, the CAPTCHA is handed to a HUMAN (see solveCaptcha).
export async function ensureLoggedIn(
  context: BrowserContext,
  job: PortalJob,
  creds: ClientCreds,
): Promise<Page> {
  const page = await context.newPage();

  // 1) Try an existing session first (this is the common, zero-touch path).
  await page.goto(`${config.portalBaseUrl}/services/auth/dashboard`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  if (await isLoggedIn(page)) {
    await logEvent(job.id, 'info', 'login', 'Reused existing session (no CAPTCHA needed).');
    return page;
  }

  if (!creds.gst_user_id || !creds.gst_password) {
    throw new Error(`Client ${creds.name} has no stored GST portal username/password.`);
  }

  // 2) Fresh login.
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
  // CONFIRMED 2026-07-14 (live DOM): id=username (name=user_name), id=user_pass.
  await page.fill('#username', creds.gst_user_id);
  await page.fill('#user_pass', creds.gst_password);

  // 3) CAPTCHA — HUMAN-ASSISTED. We do NOT auto-solve the portal's bot-detection.
  const captchaText = await solveCaptcha(page, job);
  if (!captchaText) throw new Error('CAPTCHA was not provided by a human in time.');
  await page.fill('#captcha', captchaText); // CONFIRMED 2026-07-15: id=captcha (placeholder "Enter Characters shown below").

  // CONFIRMED 2026-07-14: <button type=submit class="btn btn-primary">Login</button>.
  // Scope to text so we don't hit the browser-extension's injected submit buttons.
  await page.locator('button.btn-primary:has-text("Login")').click();
  await page.waitForLoadState('networkidle').catch(() => {});

  // Distinguish "wrong captcha" (retryable) from "wrong password" (stop).
  const err = await readLoginError(page);
  if (err) {
    if (/captcha/i.test(err)) throw new Error('CAPTCHA rejected — re-queue to try again.');
    throw new Error(`Portal login failed: ${err}`);
  }
  if (!(await isLoggedIn(page))) throw new Error('Login did not complete (unknown reason).');

  await saveSession(context, creds.id);
  await logEvent(job.id, 'info', 'login', 'Logged in and saved session.');
  return page;
}

async function isLoggedIn(page: Page): Promise<boolean> {
  // TODO(selector): a stable post-login marker, e.g. the dashboard greeting or logout link.
  return await page.locator('a:has-text("Logout"), .welcome, #dashboardHeading')
    .first().isVisible().catch(() => false);
}

async function readLoginError(page: Page): Promise<string | null> {
  // TODO(selector): the portal's inline error/toast area.
  const el = page.locator('.alert-danger, .err, [role="alert"]').first();
  return (await el.isVisible().catch(() => false)) ? (await el.textContent())?.trim() ?? null : null;
}

// --- CAPTCHA: human-in-the-loop only ----------------------------------------
// The portal CAPTCHA is deliberately NOT auto-solved here. We capture the image,
// park the job as `needs_human`, and the app shows it for a one-time manual entry.
// (If you choose to add an automatic solver, this is the single seam to change —
// it is intentionally left to you.)
async function solveCaptcha(page: Page, job: PortalJob): Promise<string | null> {
  const captchaImg = page.locator('#imgCaptcha, img.captcha'); // CONFIRMED 2026-07-15: id=imgCaptcha, class="captcha".
  const buffer = await captchaImg.screenshot().catch(() => null);

  // 1) Try the optional auto-solver first (unimplemented by default -> returns
  //    null; your firm can fill in autoSolveCaptcha() in captchaSolver.ts).
  if (buffer) {
    const auto = await autoSolveCaptcha(buffer).catch(() => null);
    if (auto && auto.trim()) {
      await logEvent(job.id, 'info', 'captcha', 'CAPTCHA auto-solved.');
      return auto.trim();
    }
  }

  // 2) Fall back to a human via the app (the always-on path when there's no solver).
  const b64 = buffer ? `data:image/png;base64,${buffer.toString('base64')}` : null;
  await logEvent(job.id, 'info', 'captcha', 'Auto-solver unavailable — waiting for a human to type the CAPTCHA.');
  await setStatus(job.id, 'needs_human', {
    human_prompt: { kind: 'captcha', image: b64, message: 'Type the CAPTCHA shown to continue login.' },
    human_response: null,
  });

  const resp = await waitForHumanResponse(job.id);
  await setStatus(job.id, 'running');
  return resp?.captcha ?? resp?.text ?? null;
}
