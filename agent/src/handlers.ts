import { Page } from 'playwright';
import { supabase, PortalJob, ClientCreds, logEvent, recordVerification } from './supabase.js';
import { newClientContext, screenshot } from './browser.js';
import { ensureLoggedIn } from './login.js';
import { jsonDiff } from './verify.js';

// suspended_reco has no (client,period) unique constraint, so upsert-by-key
// manually (works for gst_receivable_reco too).
async function upsertByClientPeriod(table: string, clientId: string, period: string, patch: Record<string, any>) {
  const { data: existing } = await supabase.from(table).select('id').eq('client_id', clientId).eq('period_month', period).maybeSingle();
  if (existing) await supabase.from(table).update(patch).eq('id', (existing as any).id);
  else await supabase.from(table).insert({ client_id: clientId, period_month: period, ...patch });
}

// --- Returns Dashboard period selection (CONFIRMED live 2026-07-14) ----------
// The Returns Dashboard is the shared entry for 2B / GSTR-1 / GSTR-3B / status.
// Its period selects are `name`-based (no id) and the month cascades off quarter.
// See agent/SELECTORS.md for the full map.
const RETURN_DASHBOARD_URL = 'https://return.gst.gov.in/returns/auth/dashboard';
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Map a MM/YYYY period to the dashboard dropdown labels (GST FY runs Apr–Mar).
function periodToDashboard(period: string): { fin: string; quarterPrefix: string; month: string } {
  const [mm, yyyy] = period.split('/').map((n) => parseInt(n, 10));
  if (!mm || !yyyy || mm < 1 || mm > 12) throw new Error(`Bad period "${period}" (expected MM/YYYY).`);
  const fyStart = mm >= 4 ? yyyy : yyyy - 1;                 // Apr starts the FY
  const fin = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`; // e.g. 2026-27
  const q = mm >= 4 && mm <= 6 ? 1 : mm >= 7 && mm <= 9 ? 2 : mm >= 10 && mm <= 12 ? 3 : 4;
  return { fin, quarterPrefix: `Quarter ${q}`, month: MONTH_NAMES[mm - 1] };
}

// Select a dropdown <option> by the START of its visible text (robust to the
// portal's option value/index churn). Throws if nothing matches.
async function selectByTextStart(page: Page, selector: string, textStart: string): Promise<void> {
  const value = await page.$$eval(
    `${selector} option`,
    (opts, t) => {
      const m = (opts as HTMLOptionElement[]).find((o) => (o.textContent || '').trim().startsWith(t as string));
      return m ? m.value : null;
    },
    textStart,
  );
  if (value == null) throw new Error(`No <option> starting with "${textStart}" in ${selector}.`);
  await page.selectOption(selector, value);
}

// Navigate to the Returns Dashboard and select job.period_month, then Search so
// the return tiles render. Returns the resolved labels for logging/verification.
async function selectReturnPeriod(page: Page, period: string): Promise<{ fin: string; month: string }> {
  const { fin, quarterPrefix, month } = periodToDashboard(period);
  await page.goto(RETURN_DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
  await selectByTextStart(page, 'select[name="fin"]', fin);
  await selectByTextStart(page, 'select[name="quarter"]', quarterPrefix);
  await page.waitForTimeout(600);                            // month repopulates after quarter changes
  await selectByTextStart(page, 'select[name="mon"]', month);
  await page.locator('button.srchbtn').click();
  await page.waitForLoadState('networkidle').catch(() => {});
  return { fin, month };
}

// Locate a return tile by its name and return its action button. Every tile's
// buttons share `btn btn-primary smallbutton` with generic text, so we MUST
// scope by the tile (its column) first. `returnName` matches the tile header
// (e.g. 'GSTR-2B', 'GSTR-3B'); `action` is the button label (e.g. /^Download$/i).
function tileButton(page: Page, returnName: string, action: RegExp) {
  return page.locator('div.col-md-4').filter({ hasText: returnName }).getByRole('button', { name: action });
}

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

// ---- Phase 2: PULL_2B (navigation CONFIRMED; download+parse need a live run) -
const handlePull2b: Handler = async (job, creds, page) => {
  const period = job.period_month;
  if (!period) throw new Error('PULL_2B: job.period_month (MM/YYYY) is required.');

  // 1) CONFIRMED: pick the period on the Returns Dashboard, then open the
  //    GSTR-2B tile's Download (scoped to the tile — button text is not unique).
  const { fin, month } = await selectReturnPeriod(page, period);
  await logEvent(job.id, 'info', 'pull_2b', `Dashboard set to ${month} ${fin}; opening GSTR-2B download.`);
  await tileButton(page, 'GSTR-2B', /^Download$/i).click();
  await page.waitForLoadState('networkidle').catch(() => {});

  // 2) CONFIRMED page: gstr2b.../gstr2bdwld with two buttons — we use the Excel
  //    one (the app already has an .xlsx importer). Clicking it triggers a
  //    server-side generation; TODO(verify): confirm on a live run whether the
  //    file auto-downloads or a "download" link/button appears after generation.
  const genExcel = page.locator('button.btn-primary:has-text("GENERATE EXCEL FILE TO DOWNLOAD")');
  await genExcel.waitFor({ state: 'visible', timeout: 30_000 });
  let download;
  try {
    [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      genExcel.click(),
    ]);
  } catch {
    // Fallback: generation reveals a separate download control.
    await logEvent(job.id, 'info', 'pull_2b', 'No direct download after GENERATE — looking for a download link.');
    [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page.locator('a:has-text("download"), button:has-text("DOWNLOAD")').first().click(),
    ]);
  }
  const filePath = await download.path();
  await logEvent(job.id, 'info', 'pull_2b', `Downloaded 2B file: ${download.suggestedFilename()}.`);

  // 3) TODO(parse): read `filePath` (.xlsx) and port the app's parseGstr2b logic
  //    here -> rows + tax totals. 4) RECONCILE summed ITC vs the portal figure.
  //    5) write rows into public.twob_import_docs (replace batch) + verification.
  await logEvent(job.id, 'warn', 'pull_2b', 'Navigation + download wired; parser/reconcile/write still to port (needs a live-run to finalize).');
  throw new Error(`PULL_2B: navigation is wired and the file downloaded to ${filePath}, but the xlsx parser + twob_import_docs write are not ported yet.`);
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

const handlePullGstr1 = notImplemented('PULL_GSTR1', 'Phase 3');

// ---- Feature A (G1): filed returns → ARN + PDF into filing_status ----------
// DB/storage writes are real; only the portal reading is TODO(selector).
interface FiledReturn { return_type: string; period: string; arn: string; filed_date: string | null; pdfBytes: Buffer | null }

const handlePullFilingStatus: Handler = async (job, creds, _page) => {
  // TODO(selector): Services > Returns > Track Return Status. For each filed
  // return read: return_type (map portal label -> the return_type enum:
  // GSTR-1 / GSTR-3B / GSTR-3B (Q) / GSTR-1 (IFF) / CMP-08 / ITC-04 / GSTR-6 / GSTR-7),
  // period (MM/YYYY), ARN (15 chars), filed_date (YYYY-MM-DD), and download the
  // filed-return PDF into pdfBytes.
  const filed: FiledReturn[] = [];
  if (filed.length === 0) {
    await logEvent(job.id, 'warn', 'pull_filing_status', 'No filed returns read — portal selectors not wired yet.');
    throw new Error('PULL_FILING_STATUS not wired (Feature A / G1): fill in the Track-Return-Status selectors.');
  }

  const written: any[] = [];
  for (const r of filed) {
    // Upload the PDF to the return-pdfs bucket.
    let pdfUrl: string | null = null;
    if (r.pdfBytes) {
      const path = `${creds.id}/${r.period.replace('/', '-')}/${r.return_type}-${r.arn}.pdf`;
      const { error: upErr } = await supabase.storage.from('return-pdfs')
        .upload(path, r.pdfBytes, { contentType: 'application/pdf', upsert: true });
      if (!upErr) pdfUrl = supabase.storage.from('return-pdfs').getPublicUrl(path).data.publicUrl;
    }
    // Only write "Filed" when ARN + PDF verify (the DB trigger also enforces this).
    const arnOk = /^[A-Z0-9]{15}$/.test((r.arn || '').toUpperCase());
    const passed = arnOk && !!pdfUrl;
    await recordVerification({ jobId: job.id, clientId: creds.id, period: r.period, checkType: 'FILING_ARN_PDF', passed, expected: { arn15: true, pdf: true }, actual: { arn: r.arn, pdf: !!pdfUrl } });
    if (!passed) { written.push({ ...r, pdfBytes: undefined, skipped: 'arn/pdf failed verification' }); continue; }

    await supabase.from('filing_status').upsert({
      client_id: creds.id, return_type: r.return_type, period_month: r.period,
      status: 'Filed', arn: r.arn.toUpperCase(), filed_date: r.filed_date, return_pdf_url: pdfUrl,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id,return_type,period_month' });
    written.push({ return_type: r.return_type, period: r.period, arn: r.arn, pdf: !!pdfUrl });
  }
  return { filingStatus: written };
};

// ---- Feature B (G2): electronic credit ledger → suspended/receivable opening -
const CREDIT_LEDGER_URL = 'https://return.gst.gov.in/returns/auth/ledger/itcledger';

const handlePullLedgers: Handler = async (job, creds, page) => {
  // CONFIRMED live 2026-07-14: the Electronic Credit Ledger LANDING page shows a
  // single TOTAL "ITC Balance As On Date" in `div.rettbl-format span.reg` (plus
  // provisional/blocked). It does NOT break the balance into IGST/CGST/SGST and
  // has no date-range form — that per-head, period-end detail lives on the
  // separate detailed-ledger view (From/To + GO), which was NOT inspected yet.
  await page.goto(CREDIT_LEDGER_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const totalRaw = await page.locator('div.rettbl-format span.reg').first().innerText().catch(() => '');
  const itcTotal = totalRaw ? Number(totalRaw.replace(/[,\s]/g, '')) : NaN;
  await logEvent(job.id, 'info', 'pull_ledgers', `Credit-ledger total ITC balance (as-on-today): ${totalRaw || 'not found'}.`);

  // The app needs the per-head opening (opening_igst/cgst/sgst); a single total
  // can't be split safely. Record what we read, then stop until the detailed
  // ledger (per-head + date range) is inspected/wired — do NOT write a fake split.
  const opening: { igst: number; cgst: number; sgst: number } | null = null; // TODO(detail-view)
  if (!opening) {
    await recordVerification({ jobId: job.id, clientId: creds.id, period: job.period_month, checkType: 'LEDGER_TOTAL_READ', passed: Number.isFinite(itcTotal), expected: { total: true }, actual: { total: itcTotal } });
    await logEvent(job.id, 'warn', 'pull_ledgers', 'Read the total balance, but per-head opening needs the detailed-ledger view (not inspected yet).');
    throw new Error(`PULL_LEDGERS: read total ITC balance = ${itcTotal}, but per-head opening (IGST/CGST/SGST) requires the detailed-ledger date-range view, which is not wired yet.`);
  }

  const period = job.period_month || '';
  const patch = {
    opening_igst: opening.igst, opening_cgst: opening.cgst, opening_sgst: opening.sgst,
    opening_source: 'portal', opening_portal_pulled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await upsertByClientPeriod('suspended_reco', creds.id, period, patch);
  await upsertByClientPeriod('gst_receivable_reco', creds.id, period, patch);
  await recordVerification({ jobId: job.id, clientId: creds.id, period, checkType: 'LEDGER_OPENING', passed: true, expected: opening, actual: opening });
  return { opening };
};

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
