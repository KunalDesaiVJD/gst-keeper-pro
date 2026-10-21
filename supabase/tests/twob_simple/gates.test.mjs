#!/usr/bin/env node
// The checks before pushing or filing a GSTR-3B, run by the app's own code
// against the test database before and after a permitted prior-month change
// (docs/2B_RECONCILIATION_FLOW.md §13; the firm: "make sure that the changes
// in prior months should not affect our validation controls that we have
// placed in pushing the GSTR-3B to portal").
//
// The gates of a month:
//   - Gstr3bPage handlePush: the Suspended Reco and GST Receivable Reco
//     differences (computeSuspendedRecoDiff, computeGstReceivableRecoDiff;
//     Push is disabled unless both are 0) and the draft (fetchGstr3b →
//     buildGstr3bJson, also what the Prepare GSTR-3B dialog shows); a filed
//     month's push is locked as filed;
//   - FilingStatusPage marking GSTR-3B Filed: the Suspended Reco check
//     (filingSuspendedCheck: saved opening and current total less the live
//     books side, within ₹20);
//   - the gst-push Edge Function: reads no 2B table (checked from its source).
// A permitted change must leave every gate of every month as it was, except
// the Suspended Reco books side of the changed month and the later months,
// which moves on purpose by exactly the books' change. Nothing saved for a
// month moves (ITC Summary, Suspended Reco, Receivable Reco, push versions,
// filing status).
//
// Applying this change must move no gate either: before any permitted
// change, every gate of every month gives what origin/main's code gives
// (bundled from the branch point), also where a filed month's saved ITC
// Summary is stale (TAMNNA Sep-26: saved 5.4 = 0, live and pushed 5.4 not).
//
// Run by run.sh with TWOB_TEST_DB set; PG* variables as for psql. The app's
// modules are bundled as they are (esbuild), with a stand-in supabase client
// that reads a snapshot of the test database (only the columns each query
// names, as PostgREST returns them). The change itself is written as
// PostgREST writes it: SET ROLE anon, through twob_prior_books_apply.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');
const db = process.env.TWOB_TEST_DB;
if (!db) { console.error('TWOB_TEST_DB is not set (run through run.sh)'); process.exit(2); }

const results = [];
const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info: cond ? '' : String(info) });
const psql = (sql) => execFileSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
const asApp = (sql) => psql(`SET ROLE anon; SELECT set_config('request.jwt.claims', '{"role":"anon"}', false); ${sql}`);

const TABLES = ['clients', 'filing_status', 'itc_summaries', 'bills_not_in_2b', 'bills_not_in_books', 'twob_import_docs',
  'books_register', 'suspended_reco', 'gst_receivable_reco', 'gstr1_data', 'rcm_data', 'gstr3b_adjustments', 'builder_rcm_postings',
  'twob_filed_figures'];
const snapshot = () => {
  const out = {};
  for (const t of TABLES) out[t] = JSON.parse(psql(`SELECT COALESCE(json_agg(t), '[]') FROM public.${t} t`) || '[]');
  return out;
};

const FAKE_SUPABASE = `
class Q {
  constructor(t) { this.t = t; this.f = []; this.lim = null; this.rng = null; this.head = false; this.one = false; this.cols = null; }
  select(c, o) {
    this.head = !!(o && o.head);
    this.cols = c && c.trim() !== '*' ? c.split(',').map((x) => x.trim()).filter(Boolean) : null;
    return this;
  }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
  in(c, a) { this.f.push((r) => a.includes(r[c])); return this; }
  is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  not(c, op, v) { if (op !== 'is') throw new Error('fake supabase: not ' + op); this.f.push((r) => (r[c] ?? null) !== v); return this; }
  order() { return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  insert() { throw new Error('the gates must not write (insert into ' + this.t + ')'); }
  update() { throw new Error('the gates must not write (update ' + this.t + ')'); }
  delete() { throw new Error('the gates must not write (delete from ' + this.t + ')'); }
  exec() {
    const tbl = globalThis.__db[this.t];
    if (!tbl) throw new Error('fake supabase: no table ' + this.t);
    let rows = tbl.filter((r) => this.f.every((fn) => fn(r)));
    const count = rows.length;
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim !== null) rows = rows.slice(0, this.lim);
    if (this.head) return { data: null, count, error: null };
    rows = rows.map((r) => (this.cols ? Object.fromEntries(this.cols.map((k) => [k, r[k] ?? null])) : { ...r }));
    return { data: this.one ? rows[0] ?? null : rows, count, error: null };
  }
  then(ok, ko) { let r; try { r = this.exec(); } catch (e) { return Promise.reject(e).then(ok, ko); } return Promise.resolve(r).then(ok, ko); }
}
export const supabase = { from: (t) => new Q(t), rpc: async () => ({ data: null, error: { message: 'no rpc in the gates' } }) };
`;

// The app's gate code as this branch has it, and as origin/main had it at
// the branch point (the code running before this change is deployed).
const bundle = async (srcRoot, entry) => {
  const out = await build({
    stdin: { contents: entry, resolveDir: srcRoot, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    nodePaths: [path.join(root, 'node_modules')],
    plugins: [{
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
        b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(srcRoot, 'src'), kind: a.kind }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: FAKE_SUPABASE, loader: 'js' }));
      },
    }],
    define: { 'import.meta.env': '{}' },
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const G = await bundle(root, `
export { fetchGstr3b } from './src/utils/fetchGstr3b';
export { fetchItcAutoLinkTotals } from './src/lib/itcAutoLink';
export { computeSuspendedRecoDiff, filingSuspendedCheck } from './src/lib/suspendedRecoCalc';
export { computeGstReceivableRecoDiff } from './src/lib/gstReceivableRecoCalc';
export { planImport2BPost } from './src/lib/postImport2B';
export { ledgerCellReadOnly } from './src/lib/twobPriorMonth';
`);
let M = null;
{
  const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const base = git(['merge-base', 'HEAD', 'origin/main']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twob-main-'));
    execFileSync('bash', ['-c', `git -C '${root}' archive ${base} src | tar -x -C '${dir}'`]);
    M = await bundle(dir, `
export { fetchGstr3b } from './src/utils/fetchGstr3b';
export { fetchItcAutoLinkTotals } from './src/lib/itcAutoLink';
export { computeSuspendedRecoDiff } from './src/lib/suspendedRecoCalc';
export { computeGstReceivableRecoDiff } from './src/lib/gstReceivableRecoCalc';
`);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.log(`note gates: origin/main's code not bundled (${String(e.message || e).split('\n')[0]}); the before-deploy comparison is skipped`);
  }
}

const MONTHS3 = ['07/2026', '08/2026', '09/2026'];
const round = (x) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 + 0 : v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const delta = (a, b, k) => Math.round(((b?.[k] ?? 0) - (a?.[k] ?? 0)) * 100) / 100;

const gates = async (snap, clientId, MONTHS = MONTHS3) => {
  globalThis.__db = snap;
  const client = snap.clients.find((c) => c.id === clientId);
  const byMonth = {};
  for (const m of MONTHS) {
    const filed = snap.filing_status.some((f) => f.client_id === clientId && f.period_month === m
      && ['GSTR-3B', 'GSTR-3B (Q)'].includes(f.return_type) && f.status === 'Filed');
    const draft = await G.fetchGstr3b(clientId, client.gstin || '', m);
    const suspended = await G.computeSuspendedRecoDiff(clientId, m);
    const receivable = await G.computeGstReceivableRecoDiff(clientId, m);
    const suspendedBlocks = suspended.total !== 0;
    const receivableBlocks = !!receivable && receivable.total !== 0;
    byMonth[m] = round({
      filed,
      draft: { json: draft.json, flags: draft.flags, itcTyped: draft.itcTyped, summary: draft.summary },
      autoLink: await G.fetchItcAutoLinkTotals(clientId, m),
      receivable,
      suspended,
      push: { blockedAsFiled: filed, recoBlocks: suspendedBlocks || receivableBlocks, suspendedBlocks, receivableBlocks },
      filing: await G.filingSuspendedCheck(clientId, m),
    });
  }
  return byMonth;
};

// The same gates by origin/main's code (no filingSuspendedCheck there).
const gatesMain = async (snap, clientId, MONTHS = MONTHS3) => {
  globalThis.__db = snap;
  const client = snap.clients.find((c) => c.id === clientId);
  const byMonth = {};
  for (const m of MONTHS) {
    const draft = await M.fetchGstr3b(clientId, client.gstin || '', m);
    byMonth[m] = round({
      draft: { json: draft.json, flags: draft.flags, itcTyped: draft.itcTyped, summary: draft.summary },
      autoLink: await M.fetchItcAutoLinkTotals(clientId, m),
      receivable: await M.computeGstReceivableRecoDiff(clientId, m),
      suspended: await M.computeSuspendedRecoDiff(clientId, m),
    });
  }
  return byMonth;
};
const sameAsMain = (label, branch, main) => {
  if (!main) return;
  for (const m of Object.keys(main)) {
    for (const k of ['draft', 'autoLink', 'receivable', 'suspended']) {
      check(`${label} ${m}: ${k} as origin/main gives it (applying this change moves nothing)`, same(branch[m][k], main[m][k]),
        JSON.stringify({ branch: branch[m][k]?.summary ?? branch[m][k], main: main[m][k]?.summary ?? main[m][k] }));
    }
  }
};

// Every gate of every month, except the Suspended Reco books side, which
// moves by exactly the books' change in the changed and later months.
const compare = (label, before, after, booksMove) => {
  for (const m of Object.keys(before)) {
    const a = before[m];
    const b = after[m];
    const scope = a.filed ? 'filed' : 'open';
    check(`${label} ${m} (${scope}): filed status unchanged`, a.filed === b.filed);
    check(`${label} ${m} (${scope}): GST Receivable Reco gate identical`, same(a.receivable, b.receivable),
      JSON.stringify({ a: a.receivable, b: b.receivable }));
    const move = booksMove[m] || { cgst: 0, sgst: 0, igst: 0 };
    check(`${label} ${m} (${scope}): Suspended Reco difference moves only by the books change (${JSON.stringify(move)})`,
      delta(a.suspended, b.suspended, 'cgst') === move.cgst && delta(a.suspended, b.suspended, 'sgst') === move.sgst
      && delta(a.suspended, b.suspended, 'igst') === move.igst, JSON.stringify({ a: a.suspended, b: b.suspended }));
    check(`${label} ${m} (${scope}): Filing Status Suspended Reco check moves only by the books change`,
      Math.round((b.filing.difference - a.filing.difference) * 100) / 100 === Math.round((move.cgst + move.sgst + move.igst) * 100) / 100,
      JSON.stringify({ a: a.filing, b: b.filing }));
    if (a.filed) {
      check(`${label} ${m} (filed): push stays locked as filed`, b.push.blockedAsFiled);
      check(`${label} ${m} (filed): its GSTR-3B page shows what was filed (draft identical)`, same(a.draft, b.draft),
        JSON.stringify({ a: a.draft.summary, b: b.draft.summary }));
      continue;
    }
    check(`${label} ${m}: GSTR-3B draft (JSON, flags, typed ITC, summary) identical`, same(a.draft, b.draft),
      JSON.stringify({ a: a.draft.summary, b: b.draft.summary }));
    check(`${label} ${m}: ITC Summary auto-linked figures (5.1, 5.3, 5.4, 4B(2)(i), 4D) identical`, same(a.autoLink, b.autoLink),
      JSON.stringify({ a: a.autoLink, b: b.autoLink }));
    if (!move.cgst && !move.sgst && !move.igst) {
      check(`${label} ${m}: every gate result identical`, same(a.push, b.push) && same(a.filing, b.filing), JSON.stringify({ a: a.push, b: b.push }));
    }
  }
};

// The gst-push Edge Function (GSTR-1 push) reads no 2B table.
{
  const src = fs.readFileSync(path.join(root, 'supabase/functions/gst-push/index.ts'), 'utf8');
  check('gst-push reads none of the four 2B tables', !/bills_not_in_2b|bills_not_in_books|twob_import_docs|books_register/.test(src));
}

const changesFor = (C) => JSON.parse(psql(`SELECT jsonb_agg(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', x.id))
  FROM (SELECT unnest(public.t_ids('${C}', '07/2026', 'PERFECT INDUSTRIES', 1)) AS id
        UNION ALL SELECT unnest(public.t_ids('${C}', '07/2026', 'BOI - CC'))) x`));
const apply = (C, actor, changes) => {
  try {
    asApp(`SELECT public.twob_prior_books_apply(${actor}, '${C}', '07/2026', '${JSON.stringify(changes).replace(/'/g, "''")}'::jsonb, false);`);
    return null;
  } catch (e) {
    return String(e.stderr || e.message);
  }
};
const MOVE = { '07/2026': { cgst: 8871.09, sgst: 8871.09, igst: 0 }, '08/2026': { cgst: 8871.09, sgst: 8871.09, igst: 0 }, '09/2026': { cgst: 8871.09, sgst: 8871.09, igst: 0 } };

// ── 1. SORATH (Liberal): the permitted removal in filed July ────────────────
for (const [C, name, liberal] of [
  ['91000000-0000-0000-0000-000000000001', 'Gates Sorath', true],
  ['91000000-0000-0000-0000-000000000002', 'Gates Strict', false],
]) {
  psql(`SELECT public.t_make_sorath('${C}', '${name}', ${liberal})`);
  const label = liberal ? 'SORATH (Liberal)' : 'Strict';
  const saved = psql(`SELECT public.t_saved_digest('${C}')`).trim();
  const before = await gates(snapshot(), C);
  if (M) sameAsMain(`${label} before`, before, await gatesMain(snapshot(), C));
  check(`${label} before: Sep-26 push blocked by the Suspended Reco difference`, before['09/2026'].push.suspendedBlocks,
    JSON.stringify(before['09/2026'].suspended));

  // Refused first: an employee, and a reclaim month in July. Nothing moves.
  const refused = apply(C, 'public.t_employee()', changesFor(C));
  check(`${label}: an employee's removal is refused`, refused && refused.includes('Only a GST Manager or the superadmin'), refused);
  const julOldA = psql(`SELECT id FROM public.bills_not_in_2b WHERE client_id = '${C}' AND period_month = '07/2026' AND supplier_name = 'OLD A'`).trim();
  const refused2 = apply(C, 'public.t_manager()', [{ table: 'bills_not_in_2b', op: 'update', id: julOldA, values: { reclaim_month: 'Jul 26' } }]);
  check(`${label}: a reclaim month in July is refused`, refused2 && refused2.includes('cannot change'), refused2);
  const mid = await gates(snapshot(), C);
  check(`${label}: after the refusals every gate of every month is exactly as before`, same(before, mid));

  const err = apply(C, 'public.t_manager()', changesFor(C));
  check(`${label}: the GST Manager's removal of the 16 July entries goes through`, err === null, err);
  const after = await gates(snapshot(), C);
  compare(label, before, after, MOVE);
  check(`${label} after: Sep-26 Suspended Reco difference cleared by the tally`, after['09/2026'].suspended.total === 0
    && !after['09/2026'].push.suspendedBlocks, JSON.stringify(after['09/2026'].suspended));
  check(`${label} after: Sep-26 Filing Status check passes (within ₹20)`, !after['09/2026'].filing.blocks, JSON.stringify(after['09/2026'].filing));
  // Aug-26's GST Receivable Reco reads July's 4B(2)(i) as recorded before the change, not July's live list.
  check(`${label}: July's live reversal moved by the tally, yet Aug-26's GST Receivable Reco did not`,
    Number(psql(`SELECT COALESCE(sum(input_cgst), 0) FROM public.bills_not_in_2b WHERE client_id = '${C}' AND period_month = '07/2026' AND public.twob_label_matches(reversal_month, '07/2026')`))
      === Math.round((before['07/2026'].autoLink.reversalFromReco.cgst - 8871.09) * 100) / 100
    && same(before['08/2026'].receivable, after['08/2026'].receivable),
    JSON.stringify({ jul: after['07/2026'].autoLink.reversalFromReco, a: before['08/2026'].receivable, b: after['08/2026'].receivable }));
  check(`${label}: nothing saved for any month moved (ITC Summary, Suspended Reco, Receivable Reco, push versions, filing status)`,
    psql(`SELECT public.t_saved_digest('${C}')`).trim() === saved);
}

// ── 2. TAMNNA, a stale saved summary: Sep-26 filed and locked with its
// saved 5.4 at 0 while its live (and pushed) 5.4 is 500 a head; Oct-26 open
// and tallied. Applying this change moves no gate (origin/main's code gives
// the same), and removing T-1 in filed July moves only the books side. Post
// does not add T-1 back afterwards. ──────────────────────────────────────
{
  const C = '91000000-0000-0000-0000-000000000003';
  const MONTHS4 = ['07/2026', '08/2026', '09/2026', '10/2026'];
  psql(`SELECT public.t_make_tamnna('${C}', 'Gates stale summary')`);
  psql(`UPDATE public.filing_status SET status = 'Filed', arn = 'AA2409260000055', filed_date = '2026-10-20' WHERE client_id = '${C}' AND period_month = '09/2026';
        UPDATE public.itc_summaries SET data = public.t_itc(70000, 0, 0), is_locked = true WHERE client_id = '${C}' AND period_month = '09/2026';
        INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES ('${C}', 'GSTR-3B', '10/2026', 'Data Received');
        INSERT INTO public.itc_summaries (client_id, period_month, data, is_locked) VALUES ('${C}', '10/2026', public.t_itc(80000, 0, 0), false);
        INSERT INTO public.gst_receivable_reco (client_id, period_month, opening_cgst, opening_sgst, opening_igst, books_closing_cgst, books_closing_sgst, books_closing_igst,
          utilized_cgst, utilized_sgst, utilized_igst, drc_cgst, drc_sgst, drc_igst)
        VALUES ('${C}', '10/2026', 1000000, 1000000, 0, 1070500, 1070500, 0, 0, 0, 0, 0, 0, 0);`);
  const saved = psql(`SELECT public.t_saved_digest('${C}')`).trim();
  const before = await gates(snapshot(), C, MONTHS4);
  if (M) sameAsMain('Stale summary before', before, await gatesMain(snapshot(), C, MONTHS4));
  check('Stale summary before: Sep-26 shows its live 5.4 (500), not the saved 0', before['09/2026'].autoLink.reclaimFromReco.cgst === 500,
    JSON.stringify(before['09/2026'].autoLink.reclaimFromReco));
  const t1 = psql(`SELECT id FROM public.bills_not_in_2b WHERE client_id = '${C}' AND period_month = '07/2026' AND supplier_invoice_number = 'T-1'`).trim();
  const err = apply(C, 'public.t_manager()', [{ table: 'bills_not_in_2b', op: 'delete', id: t1 }]);
  check('Stale summary: the GST Manager removes T-1 in filed July', err === null, err);
  const after = await gates(snapshot(), C, MONTHS4);
  const move = { cgst: 1000, sgst: 1000, igst: 0 };
  compare('Stale summary', before, after, { '07/2026': move, '08/2026': move, '09/2026': move, '10/2026': move });
  check('Stale summary: Oct-26 GST Receivable Reco reads Sep-26 as before (5.4 = 500), so its push gate is unchanged',
    same(before['10/2026'].receivable, after['10/2026'].receivable) && same(before['10/2026'].push.receivableBlocks, after['10/2026'].push.receivableBlocks),
    JSON.stringify({ a: before['10/2026'].receivable, b: after['10/2026'].receivable }));
  check('Stale summary: nothing saved for any month moved', psql(`SELECT public.t_saved_digest('${C}')`).trim() === saved);
  globalThis.__db = snapshot();
  const plan = await G.planImport2BPost(C, '07/2026');
  check('Stale summary: the next Post of July does not add T-1 back', plan.insertBills2B.length === 0 && plan.updateBills2B.length === 0,
    JSON.stringify({ insert: plan.insertBills2B.map((x) => x.row.supplier_invoice_number), update: plan.updateBills2B.length }));
}

// ── 3. 2B Reconciliation's cells in a prior month (Liberal client): a GST
// Manager corrects a carried entry's date, supplier, number, GSTIN and
// amounts too (SORATH: 74 + 253 carried rows were display-only); an
// employee sees the month read-only. ──────────────────────────────────────
{
  const cell = (o) => G.ledgerCellReadOnly({ readOnly: false, editableForCF: false, isSuperadmin: false, isPrior: true, canPriorBooks: true, isCarriedForward: true, ...o });
  check('Screens: a GST Manager edits a carried entry\'s cells in a prior month', cell({}) === false);
  check('Screens: an open month keeps carried entries\' cells read-only for a GST Manager', cell({ isPrior: false }) === true);
  check('Screens: an employee (the page read-only) edits nothing in a prior month', cell({ readOnly: true, canPriorBooks: false }) === true);
}

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`ok   gates: ${r.name}`);
  else { failed += 1; console.log(`FAIL gates: ${r.name}${r.info ? `\n     ${r.info}` : ''}`); }
}
console.log(`gates: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
