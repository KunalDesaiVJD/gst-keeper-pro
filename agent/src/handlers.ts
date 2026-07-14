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
const handlePullLedgers: Handler = async (job, creds, _page) => {
  // TODO(selector): Services > Ledgers > Electronic Credit Ledger. Set the
  // period's date range, download the ledger, and derive the OPENING balance
  // (IGST/CGST/SGST) — the same figure the app's parseElectronicCreditLedgerCsv
  // produces from the manual CSV upload (port that logic here).
  const opening: { igst: number; cgst: number; sgst: number } | null = null; // TODO(parse)
  if (!opening) {
    await logEvent(job.id, 'warn', 'pull_ledgers', 'Ledger opening not parsed — portal selectors/parser not wired yet.');
    throw new Error('PULL_LEDGERS not wired (Feature B / G2): fill in the credit-ledger selectors + opening parser.');
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
