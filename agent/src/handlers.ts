import { Page } from 'playwright';
import { PortalJob, ClientCreds, logEvent, recordVerification } from './supabase.js';
import { newClientContext, screenshot } from './browser.js';
import { ensureLoggedIn } from './login.js';
import { jsonDiff } from './verify.js';

// Each handler logs in (session-reused), does its portal work, self-verifies,
// and returns a JSON result. PULL handlers also (Phase 2+) write into the app's
// tables; PUSH handlers upload+SAVE only and read back to verify.
//
// Portal-navigation selectors are marked TODO(selector): they must be filled in
// and tested against the LIVE portal DOM (can't be done from this repo). Until
// then, unimplemented handlers throw so a job fails loudly rather than silently.

type Handler = (job: PortalJob, creds: ClientCreds, page: Page) => Promise<any>;

// ---- Phase 1: LOGIN_TEST (fully wired) -------------------------------------
const handleLoginTest: Handler = async (job, creds, page) => {
  const shot = await screenshot(page, job.id, 'dashboard');
  await logEvent(job.id, 'info', 'login_test', `Logged in as ${creds.gstin}.`, shot);
  return { loggedIn: true, gstin: creds.gstin };
};

// ---- Phase 2: PULL_2B (scaffold) -------------------------------------------
const handlePull2b: Handler = async (job, creds, page) => {
  // TODO(selector): Returns Dashboard -> select period -> GSTR-2B -> Download (JSON/Excel).
  // 1. navigate + pick job.period_month
  // 2. download the 2B file, read its bytes
  // 3. parse (reuse the app's parseGstr2b logic ported to the agent) -> rows + tax totals
  // 4. RECONCILE: compare summed ITC to the portal's on-screen "ITC Available" figure
  // 5. write rows into public.twob_import_docs (replace batch), record verification
  await logEvent(job.id, 'warn', 'pull_2b', 'PULL_2B scaffold — portal selectors not yet wired.');
  throw new Error('PULL_2B not implemented yet (Phase 2): fill in portal selectors + parser, then remove this.');
};

const notImplemented = (name: string, phase: string): Handler => async (job) => {
  await logEvent(job.id, 'warn', name.toLowerCase(), `${name} scaffold — not wired yet.`);
  throw new Error(`${name} not implemented yet (${phase}).`);
};

// ---- Phase 4/5: PUSH (scaffold with shadow-mode + read-back verify) --------
function makePushHandler(name: string, phase: string): Handler {
  return async (job, creds, page) => {
    const sent = job.payload?.gstr_json;
    if (!sent) throw new Error(`${name}: job.payload.gstr_json is required (the data to push).`);

    // TODO(selector): open the return -> Prepare Offline -> upload the JSON so the
    // portal tables populate. This is a SAVE only — never click offset/submit/file.
    await logEvent(job.id, 'info', name.toLowerCase(), 'Uploading JSON to portal (save only)…');

    if (job.mode === 'shadow') {
      // Shadow mode: do everything EXCEPT the final Save. Read current portal state
      // and diff against what we WOULD push — proves correctness with zero side-effects.
      await logEvent(job.id, 'info', name.toLowerCase(), 'Shadow mode — not saving; comparing only.');
      const readBack = await readBackFromPortal(page, job); // TODO(selector)
      const diffs = jsonDiff(sent, readBack);
      await recordVerification({
        jobId: job.id, clientId: creds.id, period: job.period_month,
        checkType: 'PUSH_READBACK_DIFF', passed: diffs.length === 0, expected: readBack, actual: sent, diff: diffs,
      });
      return { mode: 'shadow', wouldSave: true, diffs };
    }

    // Live: click SAVE (TODO selector), then read back and diff.
    // await page.click('button:has-text("Save")'); // TODO(selector) — SAVE, never SUBMIT/FILE
    const readBack = await readBackFromPortal(page, job); // TODO(selector)
    const diffs = jsonDiff(sent, readBack);
    const verified = diffs.length === 0;
    await recordVerification({
      jobId: job.id, clientId: creds.id, period: job.period_month,
      checkType: 'PUSH_READBACK_DIFF', passed: verified, expected: readBack, actual: sent, diff: diffs,
    });
    const shot = await screenshot(page, job.id, 'saved');
    await logEvent(job.id, verified ? 'info' : 'warn', name.toLowerCase(),
      verified ? 'Saved & verified — now offset + file on the portal (human).' : `Saved but read-back differs: ${diffs.length} field(s).`, shot);
    throw new Error(`${name}: SAVE step not wired yet (${phase}) — fill in selectors, then remove this guard.`);
  };
}

async function readBackFromPortal(_page: Page, _job: PortalJob): Promise<any> {
  // TODO(selector): re-read the saved return summary from the portal to diff against `sent`.
  return {};
}

const handlePullLedgers = notImplemented('PULL_LEDGERS', 'Phase 3');
const handlePullGstr1 = notImplemented('PULL_GSTR1', 'Phase 3');
const handlePullFilingStatus = notImplemented('PULL_FILING_STATUS', 'Phase 3');

// SYNC_ALL: one login (shared page) then every PULL in sequence. A single step
// failing is captured but doesn't abort the rest — "single click, everything imported".
const handleSyncAll: Handler = async (job, creds, page) => {
  const steps: [string, Handler][] = [
    ['PULL_2B', handlePull2b],
    ['PULL_LEDGERS', handlePullLedgers],
    ['PULL_GSTR1', handlePullGstr1],
    ['PULL_FILING_STATUS', handlePullFilingStatus],
  ];
  const results: Record<string, any> = {};
  for (const [name, fn] of steps) {
    try {
      results[name] = await fn(job, creds, page);
    } catch (e: any) {
      results[name] = { error: e?.message || String(e) };
      await logEvent(job.id, 'warn', 'sync_all', `${name}: ${e?.message || e}`);
    }
  }
  return { sync: results };
};

export const HANDLERS: Record<string, Handler> = {
  LOGIN_TEST: handleLoginTest,
  SYNC_ALL: handleSyncAll,
  PULL_2B: handlePull2b,
  PULL_LEDGERS: handlePullLedgers,
  PULL_GSTR1: handlePullGstr1,
  PULL_FILING_STATUS: handlePullFilingStatus,
  PUSH_GSTR1_SAVE: makePushHandler('PUSH_GSTR1_SAVE', 'Phase 4'),
  PUSH_GSTR3B_SAVE: makePushHandler('PUSH_GSTR3B_SAVE', 'Phase 5'),
};

// Runs one job end-to-end: context -> login -> handler -> result.
export async function runJob(job: PortalJob, creds: ClientCreds): Promise<any> {
  const handler = HANDLERS[job.job_type];
  if (!handler) throw new Error(`Unknown job_type: ${job.job_type}`);
  const context = await newClientContext(creds.id);
  try {
    const page = await ensureLoggedIn(context, job, creds);
    return await handler(job, creds, page);
  } finally {
    await context.close();
  }
}
