// What the agent does on the portal page itself. Everything else — logging in
// with the saved password, reading notices, refunds, DRC-03, applications and
// the profile, saving them — is the extension's, exactly as for a person.
// Selectors confirmed against the live login page (2026-07-14/15): #username,
// #user_pass, #captcha, #imgCaptcha, button.btn-primary "Login".
import type { BrowserContext, Page } from 'playwright';

export const PORTAL = 'https://services.gst.gov.in';
export const LOGIN_URL = PORTAL + '/services/login';
export const LOGOUT_URL = PORTAL + '/services/logout';
export const DASHBOARD_URL = PORTAL + '/services/auth/dashboard';

export const onLoginPage = (page: Page) => /\/services\/login/.test(page.url());

// The extension marks the page once its listener for a filled-in CAPTCHA is
// attached (content.js, agent jobs only); before that a fill would be missed.
export async function captchaReady(page: Page): Promise<boolean> {
  if (!onLoginPage(page)) return false;
  return page.evaluate(() => {
    const img = document.querySelector('#imgCaptcha') as HTMLImageElement | null;
    return document.documentElement.getAttribute('data-gstk-captcha') === 'ready'
      && !!document.querySelector('#captcha') && !!img && img.complete && img.naturalWidth > 10;
  }).catch(() => false);
}

export async function captchaImage(page: Page): Promise<string> {
  const img = page.locator('#imgCaptcha').first();
  await img.waitFor({ state: 'visible', timeout: 15000 });
  const png = await img.screenshot({ timeout: 15000 });
  return 'data:image/png;base64,' + png.toString('base64');
}

// One fill in one input event: the extension takes that as a relayed answer
// and presses Login itself, then tells a wrong CAPTCHA from a wrong password.
export async function fillCaptcha(page: Page, text: string): Promise<void> {
  await page.fill('#captcha', text, { timeout: 10000 });
}

export async function bannerText(page: Page): Promise<string> {
  return (await page.locator('#gstk-banner').first().textContent({ timeout: 1000 }).catch(() => null)) || '';
}

// A per-document token: when it changes, the page has loaded again.
export async function documentToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __gstkAgentDoc?: string };
    w.__gstkAgentDoc ||= Math.random().toString(36).slice(2);
    return w.__gstkAgentDoc;
  }).catch(() => null);
}

// Leave the portal the way a person does, then forget every cookie, so the
// next client's job never starts inside this client's session.
export async function logOut(context: BrowserContext, page?: Page): Promise<void> {
  const p = page && !page.isClosed() ? page : await context.newPage();
  try { await p.goto(LOGOUT_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch { /* the cookies go anyway */ }
  await context.clearCookies();
  if (p !== page) await p.close().catch(() => {});
}
