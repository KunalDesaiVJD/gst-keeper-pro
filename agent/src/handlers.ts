import { Page } from 'playwright';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { supabase, PortalJob, ClientCreds, logEvent, recordVerification } from './supabase.js';
import { newClientContext, screenshot } from './browser.js';
import { ensureLoggedIn } from './login.js';
import { jsonDiff } from './verify.js';
import { parseGstr2bBuffer } from './parseGstr2b.js';

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
  if (!filePath) throw new Error('PULL_2B: the browser did not produce a downloaded file.');
  await logEvent(job.id, 'info', 'pull_2b', `Downloaded 2B file: ${download.suggestedFilename()}.`);

  // 3) Parse the .xlsx with the SAME parser the app's manual "Import 2B" uses
  //    (agent/src/parseGstr2b.ts is a port of src/utils/parseGstr2b.ts).
  const buf = await readFile(filePath);
  const parsed = parseGstr2bBuffer(buf);
  for (const w of parsed.warnings) await logEvent(job.id, 'warn', 'pull_2b', w);

  // Guard: the file's own header period must match the requested period, else we
  // could import another month's data under this one.
  if (parsed.header.periodMonthKey && parsed.header.periodMonthKey !== period) {
    throw new Error(`PULL_2B: downloaded 2B is for ${parsed.header.periodMonthKey}, not ${period} — aborting to avoid cross-period import.`);
  }
  if (parsed.records.length === 0) {
    await logEvent(job.id, 'warn', 'pull_2b', 'Parsed 0 B2B rows — empty 2B or unrecognised layout.');
  }

  // 4) Map to twob_import_docs rows — MIRRORS the app's Import2BTab insert exactly
  //    (same fields + same default itc_action logic). imported_by/updated_by are
  //    left null since the agent has no app-user id.
  const batchId = randomUUID();
  const nowIso = new Date().toISOString();
  const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const rows = parsed.records.map((r) => ({
    client_id: creds.id,
    period_month: period,
    date: isoDate(r.invoiceDate),
    supplier_name: r.supplierName,
    supplier_invoice_number: r.invoiceNumber,
    supplier_gstin: r.supplierGstin,
    taxable_value: r.taxableValue,
    input_igst: r.inputIgst,
    input_cgst: r.inputCgst,
    input_sgst: r.inputSgst,
    invoice_type: r.invoiceType,
    invoice_value: r.invoiceValue,
    place_of_supply: r.placeOfSupply,
    cess: r.cess,
    gstr1_period: r.gstr1Period,
    gstr1_filing_date: isoDate(r.gstr1FilingDate),
    source: r.source,
    irn: r.irn,
    source_sheet: r.sheet,
    bucket: r.bucket,
    reverse_charge: r.reverseCharge,
    itc_available: r.itcAvailable,
    itc_reason: r.itcReason,
    itc_action: r.reverseCharge ? 'MATCHED' : (r.itcAvailable === false ? 'INELIGIBLE' : 'MATCHED'),
    import_batch_id: batchId,
    imported_at: nowIso,
    updated_at: nowIso,
  }));

  // 5) Re-import replaces the previous batch for this client + period (as the app does).
  const { error: delErr } = await supabase.from('twob_import_docs').delete().eq('client_id', creds.id).eq('period_month', period);
  if (delErr) throw delErr;
  if (rows.length) {
    const { error: insErr } = await supabase.from('twob_import_docs').insert(rows);
    if (insErr) throw insErr;
  }

  // 6) Self-check: the gstr2bdwld page has no on-screen ITC summary to diff, so
  //    we verify internal consistency (parsed == inserted) + record the totals.
  await recordVerification({
    jobId: job.id, clientId: creds.id, period, checkType: '2B_IMPORT_TOTALS',
    passed: true, expected: { rows: rows.length }, actual: { counts: parsed.counts, taxTotals: parsed.taxTotals },
  });
  await logEvent(job.id, 'info', 'pull_2b',
    `Imported ${rows.length} B2B docs (available ${parsed.counts.available}, reversal ${parsed.counts.reversal}, rejected ${parsed.counts.rejected}).`);

  return { imported: rows.length, counts: parsed.counts, taxTotals: parsed.taxTotals, header: parsed.header, warnings: parsed.warnings };
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

// ---- Feature A (G1): filed returns → ARN + filed-date + status into filing_status
// CONFIRMED live 2026-07-15: Track Return Status (Return Filing Period + FY + Search)
// lists every filed return for the FY with ARN / return type / period / filed date /
// status (no PDF — that's on View e-Filed Returns). We write ARN + filed_date +
// status='Filed'; no DB rule needs a PDF, and auto_lock_on_filed still fires. The PDF
// attachment via View e-Filed Returns is a later enhancement.
const TRACK_RETURN_STATUS_URL = 'https://return.gst.gov.in/returns/auth/trackreturnstatus';
const FILING_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function fyStartOf(period: string): number {
  const [mm, yyyy] = period.split('/').map((n) => parseInt(n, 10));
  return mm >= 4 ? yyyy : yyyy - 1;
}

function ddmmyyyyToIso(s: string): string | null {
  const m = (s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// Portal "Return Type" label + the client's selected_returns -> app return_type.
// GSTR-1 and GSTR-3B each have a monthly vs quarterly/IFF variant; selected_returns
// disambiguates. Unknown labels -> null (skip; never guess).
function resolveReturnType(portalLabel: string, selectedReturns: string[]): string | null {
  const has = (t: string) => selectedReturns.includes(t);
  const L = (portalLabel || '').toUpperCase().replace(/\s/g, '');
  if (L.includes('IFF') || L.includes('GSTR-1') || L.includes('GSTR1')) return has('GSTR-1 (IFF)') ? 'GSTR-1 (IFF)' : 'GSTR-1';
  if (L.includes('GSTR-3B') || L.includes('GSTR3B')) return has('GSTR-3B (Q)') ? 'GSTR-3B (Q)' : 'GSTR-3B';
  if (L.includes('GSTR-7') || L.includes('GSTR7')) return 'GSTR-7';
  if (L.includes('GSTR-6') || L.includes('GSTR6')) return 'GSTR-6';
  if (L.includes('CMP-08') || L.includes('CMP08')) return 'CMP-08';
  if (L.includes('ITC-04') || L.includes('ITC04')) return 'ITC-04';
  return null;
}

// FY text ("2026-2027") + tax period ("June") -> app period_month "MM/YYYY".
// Quarterly / non-month tax periods return null (skipped — refine later).
function resolvePeriodMonth(fyText: string, taxPeriod: string): string | null {
  const mi = FILING_MONTHS.findIndex((m) => (taxPeriod || '').trim().toLowerCase().startsWith(m));
  const fyMatch = (fyText || '').match(/(\d{4})/);
  if (mi < 0 || !fyMatch) return null;
  const fyStart = parseInt(fyMatch[1], 10);
  const monthNum = mi + 1;
  const year = monthNum >= 4 ? fyStart : fyStart + 1;
  return `${String(monthNum).padStart(2, '0')}/${year}`;
}

const handlePullFilingStatus: Handler = async (job, creds, page) => {
  const jobPeriod = job.period_month;
  const fyStart = jobPeriod ? fyStartOf(jobPeriod) : new Date().getFullYear();
  const fyFull = `${fyStart}-${fyStart + 1}`; // Track Return Status uses the full FY form

  // The client's selected_returns disambiguate GSTR-1 vs IFF and GSTR-3B vs (Q).
  const { data: clientRow } = await supabase.from('clients').select('selected_returns').eq('id', creds.id).maybeSingle();
  const selectedReturns: string[] = ((clientRow as any)?.selected_returns as string[]) || [];

  await page.goto(TRACK_RETURN_STATUS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.check('input[name="aaa"][value="retFilePer"]').catch(() => {});
  await selectByTextStart(page, 'select[name="fin"]', fyFull);
  await page.locator('button.srchbtn').click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);

  // Columns: [ARN, Return Type, FY, Tax Period, Date of filing, Status, Mode].
  const raw: string[][] = await page.evaluate(() => {
    const t = document.querySelector('table');
    if (!t) return [] as string[][];
    return [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim()));
  });

  const written: any[] = [];
  const skipped: any[] = [];
  const nowIso = new Date().toISOString();
  for (const cells of raw) {
    if (cells.length < 6) continue;
    const [arnRaw, typeLabel, fyText, taxPeriod, dateFiled, status] = cells;
    if (!/^filed$/i.test((status || '').trim())) continue;                    // only filed returns
    const arn = (arnRaw || '').toUpperCase();
    if (!/^[A-Z0-9]{15}$/.test(arn)) { skipped.push({ arn: arnRaw, why: 'bad ARN' }); continue; }
    const return_type = resolveReturnType(typeLabel, selectedReturns);
    const period_month = resolvePeriodMonth(fyText, taxPeriod);
    if (!return_type || !period_month) { skipped.push({ arn, typeLabel, taxPeriod, why: 'unresolved type/period (e.g. quarterly)' }); continue; }

    // Upsert ARN + filed date + Filed. Omit return_pdf_url so an existing PDF is kept.
    const { error } = await supabase.from('filing_status').upsert({
      client_id: creds.id, return_type, period_month,
      status: 'Filed', arn, filed_date: ddmmyyyyToIso(dateFiled), updated_at: nowIso,
    }, { onConflict: 'client_id,return_type,period_month' });
    if (error) { skipped.push({ arn, return_type, period_month, why: error.message }); continue; }
    written.push({ return_type, period_month, arn, filed_date: ddmmyyyyToIso(dateFiled) });
  }

  await recordVerification({
    jobId: job.id, clientId: creds.id, period: jobPeriod, checkType: 'FILING_STATUS_ARN',
    passed: written.length > 0, expected: { fy: fyFull }, actual: { written: written.length, skipped: skipped.length },
  });
  await logEvent(job.id, written.length ? 'info' : 'warn', 'pull_filing_status',
    `Filing status FY ${fyFull}: wrote ${written.length} ARN(s)${skipped.length ? `, skipped ${skipped.length}` : ''}.`);
  if (written.length === 0 && raw.length === 0) {
    throw new Error('PULL_FILING_STATUS: no rows read from Track Return Status (check FY select / Search).');
  }
  return { filingStatus: written, skipped };
};

// ---- Feature B (G2): electronic credit ledger → suspended/receivable opening -
const DETAILED_LEDGER_URL = 'https://return.gst.gov.in/returns/auth/ledger/detailedledger';

// dd/mm/yyyy first + last day of a MM/YYYY period.
function periodDateRange(period: string): { from: string; to: string } {
  const [mm, yyyy] = period.split('/').map((n) => parseInt(n, 10));
  const last = new Date(yyyy, mm, 0).getDate(); // day 0 of next month = last day of this month
  const p2 = (n: number) => String(n).padStart(2, '0');
  return { from: `01/${p2(mm)}/${yyyy}`, to: `${p2(last)}/${p2(mm)}/${yyyy}` };
}

const handlePullLedgers: Handler = async (job, creds, page) => {
  const period = job.period_month;
  if (!period) throw new Error('PULL_LEDGERS: job.period_month (MM/YYYY) is required.');
  const { from, to } = periodDateRange(period);

  // CONFIRMED live 2026-07-15: the DETAILED credit ledger (date range + GO) renders a
  // table whose "Opening Balance" row holds the per-head opening in its last 5 cells
  // (Balance group = [IGST, CGST, SGST, Cess, Total]). Opening as of `from` = the ITC
  // carried into the period. (The landing page only exposes a single total.)
  await page.goto(DETAILED_LEDGER_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // Date pickers #sumlg_frdt / #sumlg_todt — try typing. TODO(live-run): some portal
  // date-pickers are calendar-only; if .fill() is rejected, drive the calendar.
  await page.fill('#sumlg_frdt', from);
  await page.fill('#sumlg_todt', to);
  await page.locator('button.btn-primary.mar-0, button:has-text("GO")').first().click();
  await page.waitForTimeout(1500);

  const opening = await page.evaluate(() => {
    const t = document.querySelector('table');
    if (!t) return null;
    const row = [...t.querySelectorAll('tbody tr')].find((tr) => /opening balance/i.test(tr.textContent || ''));
    if (!row) return null;
    const cells = [...row.children].map((td) => (td.textContent || '').replace(/[,\s₹]/g, '').trim());
    const n = cells.length;
    const num = (s: string) => { const x = parseFloat(s); return isFinite(x) ? x : 0; };
    // Balance group = the last 5 cells: [Integrated, Central, State, Cess, Total].
    return { igst: num(cells[n - 5]), cgst: num(cells[n - 4]), sgst: num(cells[n - 3]), cess: num(cells[n - 2]), total: num(cells[n - 1]) };
  });

  if (!opening) {
    await logEvent(job.id, 'warn', 'pull_ledgers', 'Detailed ledger loaded but no "Opening Balance" row found (check date range / GO).');
    throw new Error('PULL_LEDGERS: could not read the Opening Balance row from the detailed ledger.');
  }
  await logEvent(job.id, 'info', 'pull_ledgers',
    `Opening as of ${from}: IGST ${opening.igst}, CGST ${opening.cgst}, SGST ${opening.sgst}, Cess ${opening.cess}.`);

  const patch = {
    opening_igst: opening.igst, opening_cgst: opening.cgst, opening_sgst: opening.sgst,
    opening_source: 'portal', opening_portal_pulled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await upsertByClientPeriod('suspended_reco', creds.id, period, patch);
  await upsertByClientPeriod('gst_receivable_reco', creds.id, period, patch);
  await recordVerification({ jobId: job.id, clientId: creds.id, period, checkType: 'LEDGER_OPENING', passed: true, expected: { from }, actual: opening });
  return { opening };
};

// SYNC_ALL: one login (shared page) then every PULL in sequence. A single step
// failing is captured but doesn't abort the rest — "single click, everything imported".
const handleSyncAll: Handler = async (job, creds, page) => {
  // The three wired pulls. GSTR-1 DATA pull is a separate, unbuilt feature — it's
  // not in the sync sequence so it can't show a spurious failure. Filing-status
  // already captures each GSTR-1's ARN/filed-date.
  const steps: [string, Handler][] = [
    ['PULL_2B', handlePull2b],
    ['PULL_LEDGERS', handlePullLedgers],
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
