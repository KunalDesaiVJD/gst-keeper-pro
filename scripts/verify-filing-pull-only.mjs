#!/usr/bin/env node
// Filing Status, pull only (21 Oct 2026; 20261021110000,
// docs/FILING_STATUS_PULL_ONLY.md), from the app's side:
//  - no app or extension code writes Filed, the ARN, the filing date or the
//    return PDF to filing_status directly: only filing_record_pull (the
//    extension) and filing_attach_manual (src/lib/filingPull.ts) do, and the
//    database refuses the rest;
//  - the side effects of a Filed return (confirmation e-mail, advance
//    set-off stamp, GSTR-3B (Q) locks) are no longer run by the page, so the
//    database's one trigger runs them once on every route
//    (supabase/tests/filing_pull/test_50_side_effects.sql checks that side);
//  - the app's ARN check says what the database's says (same words);
//  - the app reads a PDF with the extension's own checker: the filed return
//    is accepted with its ARN and ARN date, the System generated summary and
//    a GSTR-1A are not (extension/test/fixtures);
//  - the app's calls name the RPCs and arguments the migration defines;
//  - round 1: bulk and per-client pulls leave out a return unlocked for
//    correction; every staff level can ask for a direct-filing approval from
//    a held-back row; the filed-return reports keep the PDF link a bare
//    address with its source beside it; where a filed return came from is
//    said on the page, its PDF export, the Reports Hub and reply evidence;
//  - round 2: a PDF no pull checked is never shown as the portal's and the
//    bulk pull retries it; no manual upload over a pulled return; GSTR-6 and
//    GSTR-7 are pulled only; one pull at a time, keyed by period; returns held
//    back are named; Pull needs the Filing status permission.
//   node scripts/verify-filing-pull-only.mjs
// Fictional data; Supabase is replaced by a recorder. Exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');

const results = [];
const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info: cond ? '' : String(info) });

// ── 1. No direct writes of the filed columns ──────────────────────────────
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
});
const PROTECTED = /\b(arn|filed_date|return_pdf_url|filed_source|manual_allowance_id|pulled_at|pdf_note)\s*:|status\s*:\s*['"]Filed['"]|status\s*:\s*\w+\s*\?\s*['"]Filed['"]/;
const offenders = [];
for (const f of walk(path.join(root, 'src'))) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /from\(\s*['"]filing_status['"]\s*\)([\s\S]{0,300}?)\.(update|insert|upsert)\(([\s\S]*?)\)\s*;?/g;
  let m;
  while ((m = re.exec(s))) {
    // The write's payload: up to the end of its object/array literal.
    const payload = m[3].slice(0, 1500);
    if (PROTECTED.test(payload)) offenders.push(path.relative(root, f) + ':' + (s.slice(0, m.index).split('\n').length));
  }
}
check('no app code writes Filed / ARN / filing date / PDF to filing_status directly', offenders.length === 0, offenders.join(', '));

const page = fs.readFileSync(path.join(root, 'src/pages/FilingStatusPage.tsx'), 'utf8');
check('the page no longer queues the confirmation e-mail itself', !/enqueueConfirmation/.test(page));
check('the page no longer stamps the advance override itself', !/markFiledForPeriod|markFiledUnderOverride/.test(page));
check('the page no longer locks the sheets on Filed itself', !/\.update\(\{\s*is_locked:\s*true\s*\}\)/.test(page));
check('the page has no PDF upload or delete of its own', !/handlePdfUpload|handlePdfDelete|return-pdfs/.test(page));
check('FilingTable is a component of its own, not defined inside the page', !/const FilingTable\s*=/.test(page) && /from '@\/components\/filing\/FilingTable'/.test(page));
check('the page listens on one realtime channel per table', /\['filing-status-rows', 'filing_status'/.test(page) && /\['filing-status-log', 'filing_status_log'/.test(page)
  && !/\.on\('postgres_changes'[^;]*\.on\('postgres_changes'/s.test(page.slice(page.indexOf('const channels'), page.indexOf('const channels') + 600)));
const bg = fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8');
check('the extension does not write filing_status through REST', !/['"`]filing_status\?/.test(bg) && !/post\(\s*['"]filing_status/.test(bg));
check('the extension records a pull through filing_record_pull', /rpc\('filing_record_pull'/.test(bg));
const adj = fs.readFileSync(path.join(root, 'src/pages/Gstr3bAdjustmentsPage.tsx'), 'utf8');
check('GSTR-1A is read from the portal pull, not ticked by hand', /\.eq\('return_type', 'GSTR1A'\)/.test(adj) && !/status: gstr1aFiled/.test(adj));

// ── 2. The app's libraries, with a recording Supabase ─────────────────────
const FAKE_SUPABASE = `
const calls = (globalThis.__calls = []);
export const supabase = {
  rpc: async (fn, args) => { calls.push({ rpc: fn, args }); return { data: (globalThis.__rpcAnswer || (() => ({ outcome: 'ok' })))(fn, args), error: null }; },
  storage: { from: (b) => ({
    upload: async (p, file, o) => { calls.push({ upload: b + '/' + p, o }); return { data: { path: p }, error: null }; },
    getPublicUrl: (p) => ({ data: { publicUrl: 'https://db.test/storage/v1/object/public/' + b + '/' + p } }),
  }) },
  functions: { invoke: async (name) => { calls.push({ invoke: name }); return { data: null, error: null }; } },
  // A read-only table fake: globalThis.__tables[name] are the rows; filters
  // eq / in are applied, everything else is ignored.
  from: (t) => {
    const rows = () => ((globalThis.__tables || {})[t] || []);
    const f = [];
    const b = {
      select: () => b, order: () => b, limit: () => b, like: () => b, is: () => b, not: () => b,
      eq: (c, v) => { f.push((r) => r[c] === v); return b; },
      in: (c, vs) => { f.push((r) => vs.includes(r[c])); return b; },
      maybeSingle: async () => { calls.push({ from: t }); return { data: rows().filter((r) => f.every((x) => x(r)))[0] || null, error: null }; },
      then: (ok, ko) => { calls.push({ from: t }); return Promise.resolve({ data: rows().filter((r) => f.every((x) => x(r))), error: null }).then(ok, ko); },
    };
    return b;
  },
};
`;
const out = await build({
  stdin: {
    contents: `export * as L from './src/lib/filingPull'; export * as M from './src/lib/manualSourceAllowances'; export * as C from './src/lib/filedPdfCheck';
      export * as D from './src/lib/directFilingApprovals'; export { fetchFiledPdf } from './src/utils/filedReturnReports';`,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  plugins: [{
    name: 'stub',
    setup(b) {
      b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
      b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: FAKE_SUPABASE, loader: 'js' }));
    },
  }],
  define: { 'import.meta.env': '{}' },
});
const { L, M, C, D, fetchFiledPdf } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

// The database's words (filing_arn_problem; supabase/tests/filing_pull/test_20).
const G = '24ABCDE1234F1Z5';
check('ARN: right state and period', L.arnProblem(G, 'GSTR-3B', '08/2026', 'AB240826123456X') === null);
check('ARN: lower case is read', L.arnProblem(G, 'GSTR-3B', '08/2026', 'ab240826123456x') === null);
check('ARN: another state', L.arnProblem(G, 'GSTR-3B', '08/2026', 'AB270826123456X') === "ARN AB270826123456X has state code 27, but the client's GSTIN is in state 24.");
check('ARN: another period', L.arnProblem(G, 'GSTR-1', '08/2026', 'AA240726123456X') === 'ARN AA240726123456X is for the tax period 07/2026, not 08/2026.');
check('ARN: not an ARN', L.arnProblem(G, 'GSTR-3B', '08/2026', 'AB2408261234') === 'AB2408261234 is not an ARN. An ARN has 15 characters: two letters, the state code, the tax period (MMYY) and seven more.');
check('ARN: ITC-04 period code is not checked', L.arnProblem(G, 'ITC-04', '03/2026', 'AA241825001756X') === null);
check('pull only: GSTR-1, IFF, 3B, 3B (Q), 1A, GSTR-6, GSTR-7; not CMP-08 / ITC-04 (round 2, defect 8)',
  ['GSTR-1', 'GSTR-1 (IFF)', 'GSTR-3B', 'GSTR-3B (Q)', 'GSTR-1A', 'GSTR-6', 'GSTR-7'].every(L.isPullOnly) && !['CMP-08', 'ITC-04'].some(L.isPullOnly));
check('no pull offered for CMP-08 and ITC-04', !L.hasPortalPull('CMP-08') && !L.hasPortalPull('ITC-04') && L.hasPortalPull('GSTR-3B (Q)'));
check('twins are one return', L.filingFamily('GSTR-1 (IFF)').join() === 'GSTR-1,GSTR-1 (IFF)' && L.filingFamily('GSTR-3B').join() === 'GSTR-3B,GSTR-3B (Q)' && L.filingFamily('CMP-08').join() === 'CMP-08');

const log = [
  { id: '3', at: '2026-10-21T10:00:00Z', client_id: 'c1', return_type: 'GSTR-1 (IFF)', period_month: '09/2026', event: 'filed' },
  { id: '2', at: '2026-10-20T10:00:00Z', client_id: 'c1', return_type: 'GSTR-1', period_month: '09/2026', event: 'not_found' },
  { id: '1', at: '2026-10-19T10:00:00Z', client_id: 'c1', return_type: 'GSTR-3B', period_month: '09/2026', event: 'changed' },
];
const o = L.latestOutcomes(log);
// Before round 2 there was no pullKey (the page keyed by client and return only).
const pullKeyOf = L.pullKey || ((c, rt) => `${c}__${rt}`);
const k9 = (rt) => pullKeyOf('c1', rt, '09/2026');
check('latest outcome per return, shared by its twins', o.get(k9('GSTR-1')).id === '3' && o.get(k9('GSTR-1 (IFF)')).id === '3' && !o.has(k9('GSTR-3B')));

// The calls.
globalThis.__calls.length = 0;
await L.attachManual({ actorId: 'u1', clientId: 'c1', returnType: 'GSTR-3B', periodMonth: '08/2026', arn: 'AB240826123456X', filedDate: '2026-09-18', pdfUrl: 'https://db.test/x.pdf' });
await L.unlockFiled('u2', 'c1', '08/2026');
await L.unfileReturn('u3', 'fs1', 'wrong return attached');
await L.decideConflict('u3', 'log1', true, 'portal is right');
await M.allowManualSource({ actorId: 'u3', clientId: 'c1', periodMonth: '08/2026', scope: M.filingScope('GSTR-3B'), reason: 'portal password changed' });
await M.revokeManualSource('u3', 'a1');
const rpcs = globalThis.__calls.filter((c) => c.rpc);
check('attach: filing_attach_manual with the actor', rpcs[0].rpc === 'filing_attach_manual' && rpcs[0].args.p_actor_id === 'u1' && rpcs[0].args.p_arn === 'AB240826123456X' && rpcs[0].args.p_filed_date === '2026-09-18', JSON.stringify(rpcs[0]));
check('unlock: filing_status_unlock', rpcs[1].rpc === 'filing_status_unlock' && rpcs[1].args.p_actor_id === 'u2' && rpcs[1].args.p_period_month === '08/2026');
check('take off Filed: filing_status_unfile with the reason', rpcs[2].rpc === 'filing_status_unfile' && rpcs[2].args.p_reason === 'wrong return attached');
check('conflict: filing_pull_conflict_decide', rpcs[3].rpc === 'filing_pull_conflict_decide' && rpcs[3].args.p_accept === true);
check('allow: manual_source_allow with scope filing:GSTR-3B', rpcs[4].rpc === 'manual_source_allow' && rpcs[4].args.p_scope === 'filing:GSTR-3B' && rpcs[4].args.p_period === '08/2026');
check('revoke: manual_source_revoke', rpcs[5].rpc === 'manual_source_revoke' && rpcs[5].args.p_id === 'a1');
check('the allowance badge', M.allowanceBadgeText({ allowed_by: 'u3', reason: 'portal password changed' }, { u3: 'Asha' }) === 'manual (allowed by Asha: portal password changed)');
check('a manual PDF goes to the client\'s folder', /^c1\/GSTR-3B\/08-2026\/manual-AB240826123456X-\d+\.pdf$/.test(L.manualPdfPath('c1', 'GSTR-3B', '08/2026', 'AB240826123456X')));

// ── 2b. Round 1 ───────────────────────────────────────────────────────────
// Defect 5: a return unlocked for correction (not Filed, ARN kept) is never
// in a bulk or per-client pull; its own Pull re-files it.
const unlocked = { status: 'Prepared Pending', arn: 'AB240826123456X', return_pdf_url: 'https://x/a.pdf', filed_date: '2026-09-18' };
check('bulk pull: an unlocked return is left out', !L.wantedInBulkPull(unlocked) && !L.wantedInClientPull(unlocked));
check('bulk pull: not Filed, or pulled without a checked PDF or date, is asked for',
  L.wantedInBulkPull({ status: 'Prepared', arn: null, return_pdf_url: null, filed_date: null })
  && L.wantedInBulkPull({ status: 'Filed', arn: 'AB240826123456X', return_pdf_url: null, filed_date: '2026-09-18', filed_source: 'portal' })
  && L.wantedInBulkPull({ status: 'Filed', arn: 'AB240826123456X', return_pdf_url: 'https://x/a.pdf', filed_date: null, filed_source: 'portal' })
  && !L.wantedInBulkPull({ status: 'Filed', arn: 'AB240826123456X', return_pdf_url: 'https://x/a.pdf', filed_date: '2026-09-18', filed_source: 'portal' }));
check('client pull: a Filed return is still refreshed', L.wantedInClientPull({ status: 'Filed', arn: 'AB240826123456X' }));
check('the page\'s bulk and client pulls use these rules', /\.filter\(\(r\) => hasPortalPull\(r\.return_type\) && !filedTwinOf\(r\) && wantedInBulkPull\(r\)\);\s*const rows = wanted\.filter\(\(r\) => pullable\(r\)\);/.test(page)
  && /pullable\(r\) && wantedInClientPull\(r\)/.test(page));

// Defect 10: every staff level can ask for the approval from a held-back row.
check('needs_request offers "Request approval" (the words the database names) to staff', D.directFilingActionLabel('needs_request', false) === 'Request approval'
  && D.directFilingActionLabel('rejected', false) === 'Request again' && D.directFilingActionLabel('pending', false) === 'View request'
  && D.directFilingActionLabel('pending', true) === 'Review request' && D.directFilingActionLabel('approved', false) === null && D.directFilingActionLabel('pushed', true) === null);
const table = fs.readFileSync(path.join(root, 'src/components/filing/FilingTable.tsx'), 'utf8');
check('the row\'s Pull is not disabled for a held-back return (it opens the request)', /const pullDisabled = ctx\.pulling \|\| p\.pullRunning;/.test(table)
  && /disabled=\{pullDisabled\}/.test(table) && !/ctx\.pullBlocked && !p\.isSuperadmin/.test(table));
check('the held-back badge shows on every return type, not only the GSTR-1 tab', /\{p\.directFilingBadge\(record\)\}/.test(table) && !/returnType === 'GSTR-1' && p\.directFilingBadge/.test(table));
check('a held-back row\'s Pull opens the request for every staff level', /const pullOne = \(record: FilingRecord\) => \{\s*if \(isDirectFilingBlocked\(directFilingStateFor\(record\)\)\) \{\s*openDirectFilingDialog/.test(page)
  && /Request approval: direct filing/.test(fs.readFileSync(path.join(root, 'src/components/filing/RequestDirectFilingDialog.tsx'), 'utf8')));
check('attaching a held-back return opens the request first', /const openAttach = \(record: FilingRecord\) => \{[\s\S]{0,300}isDirectFilingBlocked\(directFilingStateFor\(record\)\)[\s\S]{0,300}openDirectFilingDialog/.test(page));

// Defect 12: Take off Filed unlocks a GSTR-3B's month sheets, as Unlock does.
check('Take off Filed unlocks the month\'s sheets of a GSTR-3B', /await unfileReturn\(user\.id, record\.id, reason\);\s*if \(filingFamily\('GSTR-3B'\)\.includes\(record\.return_type\)\) await unlockMonthSheets/.test(page));

// Defects 6 and 13: where a filed return came from, in words.
const N = { a1: 'Asha' };
check('source: portal', L.filingSourceText({ status: 'Filed', arn: 'X', return_type: 'GSTR-3B', filed_source: 'portal' }, null, N) === 'Portal');
check('source: manual under an allowance', L.filingSourceText({ status: 'Filed', arn: 'X', return_type: 'GSTR-3B (Q)', filed_source: 'manual' }, { allowed_by: 'a1', reason: 'portal down' }, N)
  === 'manual (allowed by Asha: portal down)');
check('source: manual for a return with no pull', L.filingSourceText({ status: 'Filed', arn: 'X', return_type: 'CMP-08', filed_source: 'manual' }, null, N) === 'manual (no portal pull for CMP-08 yet)');
check('source: before the rule', L.filingSourceText({ status: 'Filed', arn: 'X', return_type: 'GSTR-1', filed_source: null }, null, N) === 'By hand before 21 Oct 2026'
  && L.filingSourceText({ status: 'Prepared', arn: null, return_type: 'GSTR-1', filed_source: null }, null, N) === null);
const PDF = 'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/c1/GSTR-3B%20(Q)/09-2026/manual-AB240926222333Q-1761030000000.pdf';
globalThis.__tables = {
  filing_status: [{ id: 'fs1', client_id: 'c1', period_month: '09/2026', return_type: 'GSTR-3B (Q)', status: 'Filed', arn: 'AB240926222333Q', return_pdf_url: PDF, filed_source: 'manual', manual_allowance_id: 'al1' }],
  manual_source_allowances: [{ id: 'al1', allowed_by: 'a1', reason: 'Client changed the portal password; filed 22 Oct.' }],
  profiles: [{ user_id: 'a1', first_name: 'Asha' }],
};
const fp = await fetchFiledPdf('c1', '09/2026', ['GSTR-3B', 'GSTR-3B (Q)']);
check('filed-return report: the link is the bare address', fp && fp.url === PDF, JSON.stringify(fp));
check('filed-return report: the source is its own value', fp && fp.note === 'manual (allowed by Asha: Client changed the portal password; filed 22 Oct.)', JSON.stringify(fp));
const frr = fs.readFileSync(path.join(root, 'src/utils/filedReturnReports.ts'), 'utf8');
check('filed-return reports put the address and the source in separate cells', (frr.match(/pdf\?\.url \|\| 'Not captured yet[^']*', pdf\?\.note \? `Source: \$\{pdf\.note\}` : ''/g) || []).length === 2
  && !/\$\{row\.return_pdf_url\} — /.test(frr));
const view = fs.readFileSync(path.join(root, 'src/components/reports/views/FiledReturnSummaryView.tsx'), 'utf8');
check('the report view shows the source next to "View filed PDF"', /if \(note && width > 2\) out\[2\] = note;/.test(view) && /source\.replace\(\/\^source:\\s\*\/i, ''\)/.test(view));
const pdfx = fs.readFileSync(path.join(root, 'src/utils/pdfExport.ts'), 'utf8');
check('the Filing Status PDF export has a Source column, filled by the page', /'ARN', 'Source', 'Remarks'/.test(pdfx) && /base\.push\(record\.source \|\| '-'\)/.test(pdfx)
  && /source: filingSourceText\(r, r\.manual_allowance_id/.test(page));
const hub = fs.readFileSync(path.join(root, 'src/utils/extraLedgerReports.ts'), 'utf8');
check('the Reports Hub Filing Status Report has a Source column', /headers: \['Client Name', 'GSTIN', 'Return Type', 'Status', 'Filed Date', 'Source'\]/.test(hub) && /fetchFilingSourceTexts\(records\)/.test(hub));
const reply = fs.readFileSync(path.join(root, 'src/lib/reply/recipes/filing.ts'), 'utf8');
check('reply evidence says when the tracker row was attached by hand', /fs\.source === 'manual'/.test(reply)
  && /filed_source'\)\.eq\('client_id', clientId\)/.test(fs.readFileSync(path.join(root, 'src/lib/reply/load.ts'), 'utf8')));

// Defect 11: the Unlock the page offers (canUnlockSheets) is the Unlock the database accepts.
const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20261021110000_filing_status_pull_only.sql'), 'utf8');
const unlockFn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.filing_status_unlock('), mig.indexOf('CREATE OR REPLACE FUNCTION public.filing_status_unfile('));
check('filing_status_unlock accepts an employee holding unlock_sheets, as canUnlockSheets does', /permission_key = 'unlock_sheets'/.test(unlockFn)
  && /canUnlockSheets=\{canUnlockSheets\(\)\}/.test(page));

// ── 2c. Round 2 ───────────────────────────────────────────────────────────
// Defects 1 and 5: a PDF no pull checked never reads as the portal's. The
// database takes it off a row Filed from the portal (test_80); here: the
// bulk pull retries such rows and rows never pulled, and the superadmin can
// allow a manual upload on them.
// Helpers added in round 2 (absent before it, so the checks fail there instead of crashing).
const missing = (f) => () => { throw new Error(f + ' is missing'); };
const holds = L.holdsCheckedPortalPdf || missing('holdsCheckedPortalPdf');
const acts = L.manualActions || (() => ({ canAttach: null, canAllow: null, showAllowance: null }));
const nothingText = L.bulkPullNothingText || (() => '');
const legacy = { status: 'Filed', arn: 'AB240926000111X', return_pdf_url: 'https://old/summary.pdf', filed_date: '2026-10-18', filed_source: null, return_type: 'GSTR-3B' };
const pulledNoPdf = { status: 'Filed', arn: 'AB240926000111X', return_pdf_url: null, filed_date: '2026-10-18', filed_source: 'portal', return_type: 'GSTR-3B',
  pdf_note: 'The portal gave the System generated summary, not the filed return. The PDF stored before was not checked by a pull, so it is no longer shown (the log keeps its address).' };
const pulledPdf = { status: 'Filed', arn: 'AB240926000111X', return_pdf_url: 'https://x/checked.pdf', filed_date: '2026-10-18', filed_source: 'portal', return_type: 'GSTR-3B' };
const manualRow = { status: 'Filed', arn: 'AB240926000111X', return_pdf_url: 'https://x/m.pdf', filed_date: '2026-10-18', filed_source: 'manual', return_type: 'GSTR-3B' };
check('bulk pull: a Filed row never pulled (its PDF never checked) is asked for again', L.wantedInBulkPull(legacy));
check('bulk pull: a pulled row without a checked PDF is asked for again; a checked one and a manual one are not',
  L.wantedInBulkPull(pulledNoPdf) && !L.wantedInBulkPull(pulledPdf) && !L.wantedInBulkPull(manualRow));
check('only a portal row with a PDF holds a checked portal PDF', !!L.holdsCheckedPortalPdf && holds(pulledPdf) && !holds(pulledNoPdf)
  && !holds(legacy) && !holds(manualRow));
const base = { canEdit: true, isSuperadmin: true, notApplicable: false, lockedOut: false, allowance: null };
check('the superadmin can allow a manual upload on a row whose PDF no pull checked', acts(legacy, base).canAllow && acts(pulledNoPdf, base).canAllow);
check('but not on a row holding the checked PDF from the portal', !acts(pulledPdf, base).canAllow);
check('the row says "No checked PDF" with the reason visible, not a plain eye', /record\.pdf_note \? 'No checked PDF' : 'No PDF'/.test(table));
// Defect 2: no manual upload over a pulled return, and no "Manual allowed" line on it.
const open = { ...base, isSuperadmin: false, allowance: { used_at: null } };
check('paperclip and "Manual allowed" line hidden on a row Filed from the portal with its checked PDF',
  !acts(pulledPdf, open).canAttach && !acts(pulledPdf, open).showAllowance);
check('under an open allowance a row with no checked PDF can be attached', acts(pulledNoPdf, open).canAttach && acts(legacy, open).canAttach
  && acts(pulledNoPdf, open).showAllowance);
check('the table uses these rules', /manualActions\(record, \{/.test(table) && /\{showAllowance && allowanceOpen && \(/.test(table));
// Defect 8: GSTR-6 and GSTR-7 need an allowance like GSTR-1 / 3B; CMP-08 does not.
check('GSTR-7 by hand needs an open allowance; CMP-08 does not', !acts({ status: 'Prepared', return_type: 'GSTR-7', return_pdf_url: null }, { ...base, isSuperadmin: false }).canAttach
  && acts({ status: 'Prepared', return_type: 'CMP-08', return_pdf_url: null }, { ...base, isSuperadmin: false }).canAttach
  && L.hasPortalPull('GSTR-6') && L.hasPortalPull('GSTR-7'));
// Defect 9: the spinner is keyed by client, return and period.
check('pullKey carries the period', pullKeyOf('c1', 'GSTR-3B', '09/2026') !== pullKeyOf('c1', 'GSTR-3B', '08/2026'));
const o2 = L.latestOutcomes([{ id: 'a', at: '2026-10-21T10:00:00Z', client_id: 'c1', return_type: 'GSTR-3B', period_month: '08/2026', event: 'filed' }]);
check('an August outcome does not answer a September pull', o2.has(pullKeyOf('c1', 'GSTR-3B', '08/2026')) && !o2.has(pullKeyOf('c1', 'GSTR-3B', '09/2026')));
check('the page keys pending pulls and outcomes by period', !/const pullKey = /.test(page) && /pullKey\(record\.client_id, record\.return_type, period\)/.test(page)
  && /pullKey\(p\.clientId, p\.return_type, p\.period_month\)/.test(page) && /pullKey\(i\.clientId, i\.return_type, i\.period_month\)/.test(page));
// Defect 10: held-back rows are named, not called Filed.
check('"Pull filed returns" names returns held back by the direct-filing rule', /7 returns were not pushed through GST Keeper: the superadmin approves the direct filing first/.test(nothingText(7))
  && nothingText(0) === 'Every return in view is Filed from the portal with its checked PDF and date.'
  && /toast\.info\(bulkPullNothingText\(heldBack\)/.test(page));
// Defect 11: Pull and "all" only for whoever may change Filing Status.
check('the row\'s Pull and "all" need the Filing status permission', /const showPull = hasPortalPull\(record\.return_type\) && !notApplicable && p\.canEditFilingStatus;/.test(table));
// Defect 6: one pull at a time; a pull that never answers is said.
check('while a pull runs, every Pull, "all" and Pull filed returns wait', /if \(pendingCount\) \{ toast\.info\('A pull is running/.test(page)
  && /disabled=\{!canEditFilingStatus\(\) \|\| pendingCount > 0\}/.test(page) && /pullRunning=\{pendingCount > 0\}/.test(page));
check('the 15-minute give-up says the outcome is not known', /The outcome is not known: check the portal tab, then pull again/.test(page));
check('a pull the extension ended early is said, with why', /The pull ended early: \$\{r\.ended\}/.test(page));

// ── 3. Reading a PDF in the app (the extension's checker) ─────────────────
const fx = (f) => new Blob([fs.readFileSync(path.join(root, 'extension/test/fixtures', f))], { type: 'application/pdf' });
let r = await C.readFiledPdf(fx('filed-gstr3b.pdf'));
check('filed GSTR-3B: ARN and ARN date read for the form', r.arn === 'AB240926123456X' && r.arnDate === '2026-10-11' && !r.problem, JSON.stringify(r));
check('filed GSTR-3B: accepted for its return', r.check({ arn: 'AB240926123456X', returnType: 'GSTR-3B' }).ok);
check('filed GSTR-3B: refused for another month', !r.check({ arn: 'AB240826123456X', returnType: 'GSTR-3B' }).ok);
r = await C.readFiledPdf(fx('system-summary-gstr3b.pdf'));
const v = r.check({ arn: 'AB240926123456X', returnType: 'GSTR-3B' });
check('the System generated summary: no ARN read, refused', r.arn === null && !v.ok && v.reason === 'The portal gave the System generated summary, not the filed return.', JSON.stringify(v));
r = await C.readFiledPdf(fx('filed-gstr1a.pdf'));
check('a GSTR-1A: refused for the GSTR-1', !r.check({ arn: 'AA240926000001Z', returnType: 'GSTR-1' }).ok);
r = await C.readFiledPdf(new Blob(['<html>not a pdf</html>']));
check('not a PDF: said so', r.problem === 'This file is not a PDF.');

const failed = results.filter((x) => !x.ok);
for (const x of results) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name}${x.ok ? '' : `\n     ${x.info}`}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
