#!/usr/bin/env node
// Checks what each Reports Hub Pull fetches (src/lib/reportPullPlans.ts, wired
// in src/lib/reportsCatalog.ts): a comparison pulls both of its returns, a year
// report every month of its FY up to today, a PAN report every GSTIN of the
// PAN, a ledger the months of the year not pulled (or failed), a year
// statement once a year, an all-clients report the clients still missing the
// month's GSTR-3B; only what is missing, else the months picked again; and
// every mode a Pull starts is one the extension (0.17.0 and later) runs.
//
//   node scripts/verify-report-pull-plans.mjs
//
// Fictional rows on a Supabase stand-in; nothing is read from or written to
// Supabase. Prints pass / fail; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const { build } = requireRoot('esbuild');

// A stand-in that answers select / eq / in / maybeSingle over globalThis.__db.
const SUPABASE_STUB = `
  const q = (table) => {
    const filters = [];
    let single = false;
    const api = {
      select() { return api; },
      eq(c, v) { filters.push((r) => r[c] === v); return api; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return api; },
      order() { return api; },
      maybeSingle() { single = true; return api; },
      then(res, rej) {
        const rows = (globalThis.__db[table] || []).filter((r) => filters.every((f) => f(r)));
        return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(res, rej);
      },
    };
    return api;
  };
  export const supabase = { from: q };
`;
const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
    b.onResolve({ filter: /^exceljs$/ }, () => ({ path: 'exceljs', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
      contents: a.path === 'supabase' ? SUPABASE_STUB : 'export default {};', loader: 'js',
    }));
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
  },
};
const out = await build({
  stdin: {
    contents: `
      export * as P from './src/lib/reportPullPlans';
      export { REPORTS_CATALOG } from './src/lib/reportsCatalog';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stubs], logLevel: 'error',
  define: { 'import.meta.env': '{}' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' },
  banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
});
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { P, REPORTS_CATALOG } = M;

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byKey = Object.fromEntries(REPORTS_CATALOG.map((r) => [r.key, r]));
const plan = (key, args) => byKey[key].pull.plan({ extVersion: '0.18.1', ...args });

// Today, IST, fixed by the clock the module reads.
const realNow = Date.now;
Date.now = () => Date.parse('2026-10-25T06:00:00Z');

const A = 'client-a', B = 'client-b', C = 'client-c';
const filed = (client_id, period_month, return_type, summary = { x: 1 }) => ({ client_id, period_month, return_type, summary });
globalThis.__db = {
  clients: [
    { id: A, name: 'Alpha Gujarat', gstin: '24AAACA1111A1Z1', gst_user_id: 'a', portal_login_issue: null },
    { id: B, name: 'Alpha Maharashtra', gstin: '27AAACA1111A1Z2', gst_user_id: 'b', portal_login_issue: null },
    { id: C, name: 'Other', gstin: '24BBBCB2222B1Z3', gst_user_id: null, portal_login_issue: null },
  ],
  gst_filed_returns: [
    filed(A, '08/2026', 'GSTR3B'), filed(A, '09/2026', 'GSTR3B'),
    filed(A, '08/2026', 'GSTR1'), filed(A, '09/2026', 'GSTR1', {}),
    filed(B, '09/2026', 'GSTR3B'),
  ],
  filing_status: [
    { client_id: A, period_month: '09/2026', return_type: 'GSTR-3B' },
    { client_id: B, period_month: '09/2026', return_type: 'GSTR-3B' },
    { client_id: C, period_month: '09/2026', return_type: 'GSTR-3B' },
  ],
  gst_cash_ledger_entries: [
    { client_id: A, period_month: '04/2026', description: 'Opening Balance' },
    { client_id: A, period_month: '05/2026', description: 'PULL FAILED: HTTP 500' },
  ],
};

// 1. A comparison pulls both returns, only what is missing.
{
  const p = await plan('gstr3b-vs-gstr1-tax', { clientId: A, periods: ['08/2026', '09/2026'] });
  check('3B vs GSTR-1: the GSTR-1 of Sep (pulled empty) is fetched, nothing of 3B', same(p.jobs.map((j) => [j.mode, j.periods]), [['gstr1_pull', ['09/2026']]]), JSON.stringify(p.jobs));
  const q = await plan('gstr3b-vs-gstr1-tax', { clientId: A, periods: ['08/2026'] });
  check('3B vs GSTR-1: all pulled, both returns of the months picked again', same(q.jobs.map((j) => j.mode), ['gstr3b_pull', 'gstr1_pull']) && /again/.test(q.note), JSON.stringify(q));
  const r = await plan('gstr3b-vs-gstr2b-itc', { clientId: A, periods: ['09/2026'] });
  check('3B vs 2B: the 2B is fetched', same(r.jobs.map((j) => j.mode), ['gstr2b_pull']), JSON.stringify(r.jobs));
  const s = await plan('gstr3b-vs-gstr2a-itc', { clientId: A, periods: ['09/2026'] });
  check('3B vs 2A: the 2A is fetched', same(s.jobs.map((j) => j.mode), ['gstr2a_pull']), JSON.stringify(s.jobs));
}

// 2. A year report pulls every month of the FY up to last month.
{
  const p = await plan('gstr3b-annual-summary', { clientId: A, periods: ['09/2026'] });
  check('annual summary: Apr to Sep 2026 less Aug and Sep (Oct not filed yet)', same(p.jobs[0]?.periods, ['04/2026', '05/2026', '06/2026', '07/2026']), JSON.stringify(p.jobs));
  check('fyMonthsUpTo this month for a ledger', same(P.fyMonthsUpTo(['06/2026'], 'this-month').slice(-1), ['10/2026']));
  check('oneMonthPerFy keeps the first month of each FY', same(P.oneMonthPerFy(['05/2026', '03/2026', '04/2026']), ['03/2026', '04/2026']));
}

// 3. A PAN report pulls each GSTIN of the PAN.
{
  const p = await plan('pan-output-liability', { clientId: A, periods: ['09/2026'] });
  const shape = p.jobs.map((j) => [j.mode, j.clientId ?? 'picked', j.periods]);
  check('PAN: picked client GSTR-1 first, then the other GSTIN\'s GSTR-1 (its 3B is pulled)', same(shape, [['gstr1_pull', 'picked', ['09/2026']], ['gstr1_pull', B, ['09/2026']]]), JSON.stringify(shape));
  check('PAN: the other GSTIN is named in the words', /Alpha Maharashtra/.test(p.jobs[1]?.label ?? ''), p.jobs[1]?.label);
  check('PAN: a client of another PAN is not pulled', !p.jobs.some((j) => j.clientId === C));
}

// 4. A ledger pulls the months not pulled, and a failed one again.
{
  const p = await plan('cash-ledger', { clientId: A, periods: ['06/2026'] });
  check('cash ledger: May (failed) and Jun to Oct, not Apr', same(p.jobs[0]?.periods, ['05/2026', '06/2026', '07/2026', '08/2026', '09/2026', '10/2026']), JSON.stringify(p.jobs));
}

// 5. A year statement once a year.
{
  const p = await plan('rcm-liability-itc-ledger', { clientId: A, periods: ['04/2026', '05/2026', '06/2026'] });
  check('RCM statement: one pull for FY 2026-27', same(p.jobs.map((j) => j.periods), [['04/2026']]), JSON.stringify(p.jobs));
}

// 6. An all-clients report: the clients missing the month, with a login.
{
  const p = await plan('interest-scrutiny', { clientId: '', periods: ['09/2026'] });
  check('all clients: nobody missing among those with a login (C has none) → no job', p.jobs.length === 0 && /left out/.test(p.note), JSON.stringify(p));
  globalThis.__db.gst_filed_returns = globalThis.__db.gst_filed_returns.filter((r) => !(r.client_id === B && r.return_type === 'GSTR3B'));
  const q = await plan('interest-scrutiny', { clientId: '', periods: ['09/2026'] });
  check('all clients: B missing → one run for B', same(q.jobs.map((j) => [j.mode, j.clientIds, j.periods]), [['gstr3b_pull', [B], ['09/2026']]]), JSON.stringify(q.jobs));
  check('all-clients reports need no client picked', ['rcm-tax-paid-vs-itc-claimed-all', 'itc-claimed-vs-utilized-all', 'interest-late-fee-all-clients', 'interest-scrutiny', 'rule42-short-reversal-all-clients'].every((k) => byKey[k].pull?.allClients === true));
}

// 7. Every mode a Pull names is one the extension runs.
{
  const content = readFileSync(path.join(root, 'extension/content.js'), 'utf8');
  const modes = new Set([...content.matchAll(/job\.mode === '([a-z0-9_]+)'/g)].map((m) => m[1]));
  const named = [...new Set(REPORTS_CATALOG.filter((r) => r.pull).map((r) => r.pull.mode).concat(Object.values(P.SRC).map((s) => s.mode)))];
  const unknown = named.filter((m) => !modes.has(m));
  check('every Pull mode is run by the extension', unknown.length === 0, unknown.join(', '));
  const noPull = REPORTS_CATALOG.filter((r) => !r.pull && !/^builder/.test(r.key)).map((r) => r.key);
  check('the reports without a Pull read only the app\'s own data', same(noPull.sort(), ['client-master', 'cred-all', 'cred-one', 'filing-status-report', 'gstr1-error-log', 'purchase-rate-wise', 'sus-all', 'sus-one'].sort()), noPull.join(', '));
}

Date.now = realNow;
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `\n        ${r.detail}`}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
