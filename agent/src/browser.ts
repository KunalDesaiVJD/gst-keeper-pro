import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch({ headless: !config.headful });
  return browser;
}

function sessionPath(clientId: string): string {
  const dir = path.join(config.dataDir, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${clientId}.json`);
}

// A context per client keeps sessions strictly isolated (no cross-tenant leakage)
// and lets us reuse a saved login (storageState) for hours to avoid re-CAPTCHA.
export async function newClientContext(clientId: string): Promise<BrowserContext> {
  const b = await getBrowser();
  const sp = sessionPath(clientId);
  const storageState = fs.existsSync(sp) ? sp : undefined;
  return b.newContext({ storageState, viewport: { width: 1366, height: 900 } });
}

export async function saveSession(context: BrowserContext, clientId: string) {
  await context.storageState({ path: sessionPath(clientId) });
}

export async function screenshot(page: Page, jobId: string, name: string): Promise<string> {
  const dir = path.join(config.dataDir, 'screenshots', jobId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
  // Phase 6: upload to Supabase Storage and store the public path instead of a local one.
}

export async function closeBrowser() {
  if (browser) { await browser.close(); browser = null; }
}
