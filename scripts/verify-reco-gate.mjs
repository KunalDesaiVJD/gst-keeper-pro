#!/usr/bin/env node
// Checks the app side of the GSTR-3B push gate and the pull-only recos (the
// firm's decisions of 21 Oct 2026, migration 20261021120000):
//  - src/lib/gstr3bPushGate.ts fails closed: only a clear "ok" with no
//    reason from gstr3b_push_gate lets a GSTR-3B out; a "no", an RPC error,
//    a throw, an empty or malformed answer, or an answer for another client
//    or month blocks, with the reasons; askGateForClick asks again at the
//    click and says why it is locked;
//  - the GSTR-3B page asks it before the push message and before the JSON
//    file is made, and locks both buttons while it loads or says no (it no
//    longer computes the differences itself);
//  - the reco pages' Save carries no portal-side figure from 06/2026, Upload
//    and Not Applicable go through reco_manual_opening (the allowance), the
//    Pull sends who asked and needs extension 0.16.0;
//  - a pulled GST Receivable Reco takes ITC utilised from the ledger (none
//    seen is 0); only a row not yet pulled shows the GSTR-1 estimate;
//  - round 1 of the review: the override and Clear Data go through their
//    database doors (reco_override_opening, reco_clear) with who acts; Upload
//    and Not Applicable never show over a pulled opening; a revoked
//    allowance gives no "manual (allowed ...)" label; the reco pages show only
//    the latest gate answer; "ready" says what it rests on (pulled, manual,
//    waived, no pull needed before Jun 2026).
//
//   node scripts/verify-reco-gate.mjs
//
// Nothing is read from or written to the live project: the database is an
// in-memory stand-in. Exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');

const results = [];
const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info: cond ? '' : String(info) });

// The stand-in client: from() over globalThis.__db, rpc() answered by globalThis.__rpc.
const FAKE = `
class Q {
  constructor(t) { this.t = t; this.f = []; this.cols = null; this.one = false; }
  select(c) { this.cols = c && c.trim() !== '*' ? c.split(',').map((x) => x.trim()).filter(Boolean) : null; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  in(c, a) { this.f.push((r) => a.includes(r[c])); return this; }
  not(c, op, v) { this.f.push((r) => (r[c] ?? null) !== v); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.one = true; return this; }
  then(res, rej) {
    const rows = (globalThis.__db[this.t] || []).filter((r) => this.f.every((fn) => fn(r)))
      .map((r) => this.cols ? Object.fromEntries(this.cols.map((c) => [c, r[c] === undefined ? null : r[c]])) : { ...r });
    return Promise.resolve({ data: this.one ? (rows[0] ?? null) : rows, error: null }).then(res, rej);
  }
}
export const supabase = {
  from: (t) => new Q(t),
  rpc: (fn, args) => { globalThis.__rpcCalls.push({ fn, args }); return globalThis.__rpc(fn, args); },
};
`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reco-gate-'));
const entry = path.join(tmp, 'entry.ts');
fs.writeFileSync(entry, [
  "export * from '@/lib/gstr3bPushGate';",
  "export * from '@/lib/recoSources';",
  "export { computeGstReceivableRecoDiff, utilisedFromLedger } from '@/lib/gstReceivableRecoCalc';",
].join('\n'));
const out = path.join(tmp, 'bundle.mjs');
await build({
  entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  nodePaths: [path.join(root, 'node_modules')],
  plugins: [{ name: 'alias', setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'fake', namespace: 'fake' }));
    b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: FAKE, loader: 'js' }));
    b.onResolve({ filter: /^@\// }, (a) => {
      const base = path.join(root, 'src', a.path.slice(2));
      for (const ext of ['.ts', '.tsx', '/index.ts', '.js']) if (fs.existsSync(base + ext)) return { path: base + ext };
      return { path: base };
    });
  } }],
});
globalThis.__db = {};
globalThis.__rpcCalls = [];
globalThis.__rpc = async () => ({ data: null, error: null });
const lib = await import(pathToFileURL(out).href);

const CLIENT = 'c-1';
const P = '09/2026';
const answer = (data, error = null) => { globalThis.__rpc = async () => ({ data, error }); };
const okGate = { ok: true, client_id: CLIENT, period_month: P, reasons: [], suspended: { status: 'pulled' }, receivable: { status: 'manual', required: true } };

// ── The gate fails closed ─────────────────────────────────────────────────
answer(okGate);
let g = await lib.checkGstr3bPushGate(CLIENT, P);
check('gate: a clear ok passes', g.ok === true && g.reasons.length === 0, JSON.stringify(g));
check('gate: it asks gstr3b_push_gate for the client and month', globalThis.__rpcCalls.at(-1).fn === 'gstr3b_push_gate'
  && globalThis.__rpcCalls.at(-1).args.p_client_id === CLIENT && globalThis.__rpcCalls.at(-1).args.p_period === P);
answer({ ok: false, reasons: [{ code: 'suspended_not_pulled', message: 'Suspended Reco for Sep 2026 is not pulled from the portal.' }] });
g = await lib.checkGstr3bPushGate(CLIENT, P);
check('gate: a "no" blocks with its reason', !g.ok && g.reasons[0].message.includes('not pulled'), JSON.stringify(g));
for (const [label, data, error, thrower] of [
  ['an RPC error', null, { message: 'permission denied for function gstr3b_push_gate' }],
  ['a missing function', null, { message: 'Could not find the function public.gstr3b_push_gate' }],
  ['an empty answer', null, null],
  ['an answer without ok', { reasons: [] }, null],
  ['ok but with a reason', { ok: true, reasons: [{ code: 'x', message: 'Something is off.' }] }, null],
  ['ok as a string', { ok: 'true', reasons: [] }, null],
  ['an answer for another client', { ...okGate, client_id: 'c-2' }, null],
  ['an answer for another month', { ...okGate, period_month: '08/2026' }, null],
  ['a throw', null, null, true],
]) {
  globalThis.__rpc = thrower ? async () => { throw new Error('network down'); } : async () => ({ data, error });
  g = await lib.checkGstr3bPushGate(CLIENT, P);
  check(`gate: fails closed on ${label}`, g.ok === false && g.reasons.length > 0 && g.reasons.every((r) => typeof r.message === 'string' && r.message), JSON.stringify(g));
}
g = await lib.checkGstr3bPushGate('', P);
check('gate: no client selected blocks', !g.ok);

// The click-time check (push, JSON download) asks again and says why.
answer(okGate);
let c = await lib.askGateForClick(CLIENT, P, 'Push to GST Portal');
check('click: allowed when the gate passes now', c.allowed === true && c.message === '');
answer({ ok: false, reasons: [{ code: 'receivable_difference', message: 'GST Receivable Reco for Sep 2026 has a difference of ₹250.00.' }] });
c = await lib.askGateForClick(CLIENT, P, 'The GSTR-3B JSON download');
check('click: refused with the reasons when it does not', c.allowed === false && c.message === 'The GSTR-3B JSON download is locked. GST Receivable Reco for Sep 2026 has a difference of ₹250.00.', c.message);
globalThis.__rpc = async () => { throw new Error('offline'); };
c = await lib.askGateForClick(CLIENT, P, 'Push to GST Portal');
check('click: refused when the check cannot run', c.allowed === false && /could not run/.test(c.message), c.message);
check('labels: pulled / manual', lib.gatePartLabel({ status: 'pulled', pulled_at: '2026-10-21T05:00:00Z', pulled_by_name: 'Esha' }).startsWith('Pulled from portal 21 Oct 2026 by Esha')
  && lib.gatePartLabel({ status: 'manual', allowance: { allowed_by_name: 'Sonal', reason: 'Portal down' } }) === 'manual (allowed by Sonal: Portal down)');
check('labels: an empty portal month and a row with no pull yet',
  /no balance on the portal$/.test(lib.gatePartLabel({ status: 'pulled', pulled_at: '2026-10-21T05:00:00Z', pulled_by_name: 'Esha', empty: true }))
  && lib.gatePartLabel({ status: 'not_pulled', source: 'manual' }) === 'Not pulled yet');

// ── "Ready" says what it rests on (round 1, low) ───────────────────────────
const ready = (suspended, receivable) => lib.gateReadyText({ ok: true, reasons: [], suspended, receivable });
check('ready: pulled and no difference', ready({ status: 'pulled', required_pull: true, difference: { total: 0 } }, { status: 'pulled', required: true, difference: { total: 0 } })
  === 'Suspended Reco is pulled and has no difference. GST Receivable Reco is pulled and has no difference.');
check('ready: a waived Builder difference is not called "no difference"',
  ready({ status: 'pulled', required_pull: true, waived: true, difference: { total: 1000 } }, { status: 'pulled', required: true, difference: { total: 0 } })
    .startsWith('Suspended Reco is pulled; its difference is waived (Builder, no ITC).'));
check('ready: an allowed manual entry is called manual, not pulled',
  ready({ status: 'pulled', required_pull: true, difference: { total: 0 } }, { status: 'manual', required: true, difference: { total: 0 } })
    .endsWith('GST Receivable Reco is a manual entry (allowed) with no difference.'));
check('ready: before Jun 2026 a missing row is not called pulled',
  ready({ status: 'missing', required_pull: false, difference: { total: 0 } }, { required: false })
    === 'Suspended Reco has no difference (no pull is needed before Jun 2026).');
check('ready: an override is named', /Its opening was overridden by Gita\.$/.test(
  ready({ status: 'pulled', required_pull: true, difference: { total: 0 }, override: { by_name: 'Gita' } }, { required: false })));
const note = fs.readFileSync(path.join(root, 'src/components/reco/Gstr3bGateNote.tsx'), 'utf8');
check('ready: the note no longer says "Both recos are pulled and tally"', !/Both recos are pulled and tally/.test(note) && /gateReadyText\(gate\)/.test(note));

// ── The GSTR-3B page: both ways out ask the gate first ─────────────────────
const page = fs.readFileSync(path.join(root, 'src/pages/Gstr3bPage.tsx'), 'utf8');
const body = (name) => {
  const i = page.indexOf(`const ${name} = async`);
  if (i < 0) return '';
  const j = page.indexOf('\n  };\n', i);
  return page.slice(i, j);
};
const push = body('handlePush');
const json = body('handleDownloadJson');
check('page: the push asks the gate before it messages the extension',
  push.includes("await gatePassesNow('Push to GST Portal')") && push.indexOf('gatePassesNow') < push.indexOf('__gstkPushGstr3b'), push.slice(0, 200));
check('page: the JSON download asks the gate before it makes the file',
  json.includes("await gatePassesNow('The GSTR-3B JSON download')") && json.indexOf('gatePassesNow') < json.indexOf('new Blob('), json.slice(0, 200));
check('page: a refused click stops (return)', /if \(!\(await gatePassesNow\('Push to GST Portal'\)\)\) return;/.test(push) && /if \(!\(await gatePassesNow\('The GSTR-3B JSON download'\)\)\) return;/.test(json));
check('page: gatePassesNow uses askGateForClick', /askGateForClick\(selectedClient, selectedMonth, what\)/.test(page));
check('page: locked while loading, on no answer and on "no"', /const gateBlocks = gateLoading \|\| !gate \|\| !gate\.ok;/.test(page));
check('page: the push button is disabled by the gate', /disabled=\{isPushing \|\| !extReady \|\| isFiled \|\| gateBlocks \|\| !canEditFilingStatus\(\)\}/.test(page));
check('page: the JSON button is disabled by the gate', /disabled=\{!canExportData\(\) \|\| gateBlocks\}/.test(page));
check('page: the push needs extension 0.16.0', /if \(!extensionCanPull\(extVersion\)\) \{\s*toast\.error\(needsExtensionMessage\(extVersion\)\);\s*return;/.test(push));
const preview = fs.readFileSync(path.join(root, 'src/components/portal/Gstr3bPreviewDialog.tsx'), 'utf8');
check('preview dialog: its JSON download asks the gate first too',
  /const \{ allowed, message \} = await askGateForClick\(clientId, periodMonth, 'The GSTR-3B JSON download'\);\s*if \(!allowed\)/.test(preview)
  && preview.indexOf('askGateForClick(clientId') < preview.indexOf('new Blob('));
check('page: no difference of its own any more', !/computeSuspendedRecoDiff|computeGstReceivableRecoDiff|hasRecoDiff/.test(page));

// ── The reco pages ─────────────────────────────────────────────────────────
const PORTAL_SIDE = ['opening_cgst', 'opening_sgst', 'opening_igst', 'opening_source', 'opening_csv_period_month', 'opening_csv_uploaded_at',
  'opening_csv_uploaded_by', 'opening_override_justification', 'opening_override_at', 'opening_override_by', 'opening_portal_pulled_at',
  'opening_portal_pulled_by', 'opening_allowance_id', 'utilized_cgst', 'utilized_sgst', 'utilized_igst', 'drc_cgst', 'drc_sgst', 'drc_igst'];
const susp = lib.suspendedSavePayload({ clientId: CLIENT, periodMonth: '09/2026', userId: 'u', opening: { cgst: 1, sgst: 2, igst: 3 }, portal: { cgst: 4, sgst: 5, igst: 6 } });
check('save: Suspended Reco from 06/2026 sends no portal-side field', PORTAL_SIDE.every((k) => !(k in susp)) && susp.portal_cgst === 4, JSON.stringify(susp));
const old = lib.suspendedSavePayload({ clientId: CLIENT, periodMonth: '05/2026', userId: 'u', opening: { cgst: 1, sgst: 2, igst: 3 }, portal: { cgst: 4, sgst: 5, igst: 6 } });
check('save: before 06/2026 the typed opening is saved as before', old.opening_cgst === 1 && !('opening_source' in old), JSON.stringify(old));
const recv = lib.receivableSavePayload({ clientId: CLIENT, periodMonth: '09/2026', userId: 'u', booksClosing: { cgst: 7, sgst: 8, igst: 9 } });
check('save: GST Receivable Reco sends the books closing only', PORTAL_SIDE.every((k) => !(k in recv)) && recv.books_closing_igst === 9, JSON.stringify(recv));
check('extension: 0.16.0 pulls, 0.14.0 does not', lib.extensionCanPull('0.16.0') && lib.extensionCanPull('0.16.1') && !lib.extensionCanPull('0.15.0') && !lib.extensionCanPull(null));
check('periods: pull only from 06/2026', lib.isPullOnlyPeriod('06/2026') && lib.isPullOnlyPeriod('01/2027') && !lib.isPullOnlyPeriod('05/2026'));

globalThis.__rpcCalls = [];
answer({ ok: true });
await lib.recordManualOpening({ actorId: 'u', kind: 'receivable', clientId: CLIENT, periodMonth: P, source: 'csv',
  opening: { igst: 1, cgst: 2, sgst: 3 }, utilised: null, drc: { igst: 0, cgst: 4, sgst: 4 }, csvPeriod: '07/2026' });
const mo = globalThis.__rpcCalls.at(-1);
check('manual entry: through reco_manual_opening with who, which reco and the figures', mo.fn === 'reco_manual_opening' && mo.args.p_actor_id === 'u'
  && mo.args.p_reco === 'receivable' && mo.args.p_source === 'csv' && mo.args.p_opening.cgst === 2 && mo.args.p_drc.cgst === 4 && mo.args.p_csv_period === '07/2026', JSON.stringify(mo));
answer(null, { message: 'No manual entry is allowed for this client and month.' });
let threw = '';
try { await lib.recordManualOpening({ actorId: 'u', kind: 'suspended', clientId: CLIENT, periodMonth: P, source: 'not_applicable', opening: { igst: 0, cgst: 0, sgst: 0 } }); }
catch (e) { threw = e.message; }
check('manual entry: a refusal reaches the page', /No manual entry is allowed/.test(threw), threw);

for (const [file, kind] of [['src/pages/SuspendedRecoPage.tsx', 'suspended'], ['src/pages/GstReceivableRecoPage.tsx', 'receivable']]) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  // Every .upsert( call, to its closing bracket.
  const upserts = [];
  for (let i = src.indexOf('.upsert('); i >= 0; i = src.indexOf('.upsert(', i + 1)) {
    let depth = 0, j = i + '.upsert'.length;
    for (; j < src.length; j++) { if (src[j] === '(') depth++; else if (src[j] === ')' && --depth === 0) break; }
    upserts.push(src.slice(i, j + 1));
  }
  check(`${kind} page: one upsert left (Save); the override goes through its door`, upserts.length === 1, upserts.length);
  check(`${kind} page: the override goes through reco_override_opening with who acts`,
    /await recordOverride\(\{\s*actorId: user\.id,\s*kind: '(suspended|receivable)',/.test(src) && !/opening_override_justification: values/.test(src));
  check(`${kind} page: no upsert writes the opening source, CSV, pull or ledger fields`,
    upserts.every((u) => !/opening_source|opening_csv_|opening_portal_pulled|opening_allowance_id|utilized_|drc_/.test(u)), upserts.map((u) => u.slice(0, 160)).join(' | '));
  check(`${kind} page: Upload and Not Applicable use the allowance (recordManualOpening)`,
    (src.match(/await recordManualOpening\(\{/g) || []).length === 2 && src.includes(`kind: '${kind}'`));
  check(`${kind} page: Upload and Not Applicable show only with an unused allowance`, /\{canEnterManually && \(/.test(src));
  check(`${kind} page: and never over a pulled opening`,
    /const isPulled = openingSource === 'portal' && !!openingPulledAt;\s*const canEnterManually = !!allowance && !allowance\.used_at && !isPulled;/.test(src));
  check(`${kind} page: the manual label comes from a live allowance only (openingManualState)`,
    /const \{ label: manualLabel, revoked: manualRevoked \} = openingManualState\(allowances, openingAllowanceId, names\);/.test(src)
    && src.includes("manualRevoked ? 'Manual entry revoked'") && !src.includes('manualSourceLabel('));
  check(`${kind} page: only the latest gate answer is shown`,
    /const seq = \+\+gateSeq\.current;[\s\S]{0,300}?if \(seq !== gateSeq\.current\) return;/.test(src));
  check(`${kind} page: Override needs a pulled (or allowed manual) opening`, /disabled=\{!selectedClientId \|\| isSaving \|\| !\(isPulled \|\| manualLabel\)\}/.test(src));
  check(`${kind} page: the Pull sends who asked and needs 0.16.0`,
    /__gstkPullLedgers: \{ clientId: selectedClientId, period_month: selectedMonth, actorId: user\?\.id \?\? null \}/.test(src)
    && /if \(!extensionCanPull\(extVersion\)\) \{ toast\.error\(needsExtensionMessage\(extVersion\)\); return; \}/.test(src));
  check(`${kind} page: shows the pull and the allowed manual entry`, src.includes('pulledLabel(openingPulledAt, openingPullerName, openingPortalEmpty)') && src.includes('ManualSourceAllowanceControl'));
  check(`${kind} page: shows the push gate`, src.includes('<Gstr3bGateNote compact'));
}
// The manual label: a revoked allowance does not count.
{
  const names = new Map([['sa', 'Sonal']]);
  const live = { id: 'a1', allowed_by: 'sa', reason: 'Portal password changed', revoked_at: null };
  const gone = { ...live, revoked_at: '2026-10-21T06:00:00Z' };
  const m1 = lib.openingManualState([live], 'a1', names);
  const m2 = lib.openingManualState([gone], 'a1', names);
  const m3 = lib.openingManualState([live], 'other', names);
  check('manual label: a live allowance is "manual (allowed by Sonal: ...)"', m1.label === 'manual (allowed by Sonal: Portal password changed)' && !m1.revoked);
  check('manual label: a revoked one gives no label and says revoked', m2.label === null && m2.revoked === true, JSON.stringify(m2));
  check('manual label: an allowance not this row\'s gives nothing', m3.label === null && !m3.revoked);
}

// The doors: override and Clear Data name who acts.
globalThis.__rpcCalls = [];
answer({ ok: true });
await lib.recordOverride({ actorId: 'gm', kind: 'suspended', clientId: CLIENT, periodMonth: P, opening: { igst: 0, cgst: 0, sgst: 0 }, reason: 'Portal lags' });
const ov = globalThis.__rpcCalls.at(-1);
check('override: through reco_override_opening with who, which reco and the reason', ov.fn === 'reco_override_opening' && ov.args.p_actor_id === 'gm'
  && ov.args.p_reco === 'suspended' && ov.args.p_reason === 'Portal lags' && ov.args.p_opening.cgst === 0, JSON.stringify(ov));
answer(2);
const cleared = await lib.clearReco('sa', 'suspended', CLIENT, ['04/2026', '05/2026']);
const cl = globalThis.__rpcCalls.at(-1);
check('clear data: through reco_clear with who and the months', cl.fn === 'reco_clear' && cl.args.p_actor_id === 'sa' && cl.args.p_periods.length === 2 && cleared === 2, JSON.stringify(cl));
const clearDialog = fs.readFileSync(path.join(root, 'src/components/dialogs/ClearDataDialog.tsx'), 'utf8');
check('clear data: the dialog clears Suspended Reco through clearReco, not a direct delete',
  /totalDeleted = await clearReco\(user\.id, 'suspended', clientId, months\);/.test(clearDialog) && !/from\('suspended_reco'\)/.test(clearDialog));

const recvPage = fs.readFileSync(path.join(root, 'src/pages/GstReceivableRecoPage.tsx'), 'utf8');
check('receivable page: DRC-03 is shown, not typed', !/renderBooksCell\(drc/.test(recvPage));
check('receivable page: ITC utilised from the ledger for a pulled row', /const hasUtilizedFromCsv = utilisedFromLedger\(r\);/.test(recvPage));

// ── ITC utilised: the ledger's for a pulled row, none seen is 0 ────────────
check('utilised: a pulled row with none recorded reads the ledger (0)', lib.utilisedFromLedger({ opening_source: 'portal', utilized_cgst: null }) === true);
check('utilised: an allowed manual row reads the ledger', lib.utilisedFromLedger({ opening_source: 'not_applicable', utilized_cgst: null }) === true);
check('utilised: a row not pulled keeps the estimate', lib.utilisedFromLedger({ opening_source: 'manual', utilized_cgst: null }) === false && lib.utilisedFromLedger(null) === false);
globalThis.__db = {
  gst_receivable_reco: [{ client_id: CLIENT, period_month: P, opening_source: 'portal', opening_cgst: 100, opening_sgst: 100, opening_igst: 0,
    books_closing_cgst: 100, books_closing_sgst: 100, books_closing_igst: 0, utilized_cgst: null, utilized_sgst: null, utilized_igst: null, drc_cgst: 0, drc_sgst: 0, drc_igst: 0 }],
  gstr1_data: [{ client_id: CLIENT, period_month: 'Aug-26', raw_json: { b2cs: [{ sply_ty: 'INTRA', pos: '24', rt: 18, txval: 1000, camt: 90, samt: 90, iamt: 0 }] } }],
  itc_summaries: [], filing_status: [], rcm_data: [], bills_not_in_2b: [], clients: [],
};
let d = await lib.computeGstReceivableRecoDiff(CLIENT, P);
check('utilised: pulled with no set-off debit, the books at the opening tally', d && d.total === 0, JSON.stringify(d));
globalThis.__db.gst_receivable_reco[0].opening_source = 'manual';
d = await lib.computeGstReceivableRecoDiff(CLIENT, P);
check('utilised: the same row not pulled shows the GSTR-1 estimate (₹180 used)', d && d.total === -180, JSON.stringify(d));

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n     ${r.info}`}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
