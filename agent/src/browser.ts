import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { supabase } from './supabase.js';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch({ headless: !config.headful });
  return browser;
}

// A context per client keeps sessions strictly isolated (no cross-tenant leakage)
// and lets us reuse a saved login (storageState) for hours to avoid re-CAPTCHA.
// The session is stored in Supabase (portal_sessions), NOT on local disk, so it
// survives on ephemeral cloud runners (GitHub Actions) and works identically on
// an office PC / VM.
export async function newClientContext(clientId: string): Promise<BrowserContext> {
  const b = await getBrowser();
  let storageState: any = undefined;
  try {
    const { data } = await supabase.from('portal_sessions').select('storage_state').eq('client_id', clientId).maybeSingle();
    if (data?.storage_state) storageState = data.storage_state;
  } catch { /* portal_sessions may not exist until the migration is applied */ }
  return b.newContext({ storageState, viewport: { width: 1366, height: 900 } });
}

export async function saveSession(context: BrowserContext, clientId: string) {
  const state = await context.storageState();
  await supabase.from('portal_sessions').upsert(
    { client_id: clientId, storage_state: state, updated_at: new Date().toISOString() },
    { onConflict: 'client_id' },
  );
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
