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
//  - the app's calls name the RPCs and arguments the migration defines.
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
  from: (t) => { throw new Error('fake supabase: from(' + t + ') not expected here'); },
};
`;
const out = await build({
  stdin: {
    contents: `export * as L from './src/lib/filingPull'; export * as M from './src/lib/manualSourceAllowances'; export * as C from './src/lib/filedPdfCheck';`,
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
const { L, M, C } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

// The database's words (filing_arn_problem; supabase/tests/filing_pull/test_20).
const G = '24ABCDE1234F1Z5';
check('ARN: right state and period', L.arnProblem(G, 'GSTR-3B', '08/2026', 'AB240826123456X') === null);
check('ARN: lower case is read', L.arnProblem(G, 'GSTR-3B', '08/2026', 'ab240826123456x') === null);
check('ARN: another state', L.arnProblem(G, 'GSTR-3B', '08/2026', 'AB270826123456X') === "ARN AB270826123456X has state code 27, but the client's GSTIN is in state 24.");
check('ARN: another period', L.arnProblem(G, 'GSTR-1', '08/2026', 'AA240726123456X') === 'ARN AA240726123456X is for the tax period 07/2026, not 08/2026.');
check('ARN: not an ARN', L.arnProblem(G, 'GSTR-3B', '08/2026', 'AB2408261234') === 'AB2408261234 is not an ARN. An ARN has 15 characters: two letters, the state code, the tax period (MMYY) and seven more.');
check('ARN: ITC-04 period code is not checked', L.arnProblem(G, 'ITC-04', '03/2026', 'AA241825001756X') === null);
check('pull only: GSTR-1, IFF, 3B, 3B (Q), 1A; not CMP-08 / GSTR-6 / GSTR-7 / ITC-04',
  ['GSTR-1', 'GSTR-1 (IFF)', 'GSTR-3B', 'GSTR-3B (Q)', 'GSTR-1A'].every(L.isPullOnly) && !['CMP-08', 'GSTR-6', 'GSTR-7', 'ITC-04'].some(L.isPullOnly));
check('no pull offered for CMP-08 and ITC-04', !L.hasPortalPull('CMP-08') && !L.hasPortalPull('ITC-04') && L.hasPortalPull('GSTR-3B (Q)'));
check('twins are one return', L.filingFamily('GSTR-1 (IFF)').join() === 'GSTR-1,GSTR-1 (IFF)' && L.filingFamily('GSTR-3B').join() === 'GSTR-3B,GSTR-3B (Q)' && L.filingFamily('CMP-08').join() === 'CMP-08');

const log = [
  { id: '3', at: '2026-10-21T10:00:00Z', client_id: 'c1', return_type: 'GSTR-1 (IFF)', event: 'filed' },
  { id: '2', at: '2026-10-20T10:00:00Z', client_id: 'c1', return_type: 'GSTR-1', event: 'not_found' },
  { id: '1', at: '2026-10-19T10:00:00Z', client_id: 'c1', return_type: 'GSTR-3B', event: 'changed' },
];
const o = L.latestOutcomes(log);
check('latest outcome per return, shared by its twins', o.get('c1__GSTR-1').id === '3' && o.get('c1__GSTR-1 (IFF)').id === '3' && !o.has('c1__GSTR-3B'));

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
