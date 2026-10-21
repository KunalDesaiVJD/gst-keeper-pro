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
//    waived, no pull needed before Jun 2026);
//  - round 2: every head must tally, not only the total (headsTally, the
//    pages' Tallies / Differs); a superadmin sees "manual (allowed by ...)"
//    only for the allowance the opening was entered under; GST Receivable
//    Reco refuses Override / Upload / Not Applicable while a typed books
//    closing is unsaved, and its gate note says it has not checked the typed
//    figures; before Jun 2026 the parts line names the source plainly; the
//    Excel exports and the credit-ledger reports say where each opening came
//    from; Push History flags a push recorded without a passing gate;
//  - round 3: the GSTR-3B page keeps its draft, its gate answer and its
//    filing status with the client and month they were loaded for
//    (src/lib/gstr3bSelection.ts): a switch clears them, a late answer for
//    another pair is dropped, and the JSON download and the push send only
//    the draft of the pair selected at the click, whose GSTIN and return
//    period match, while that pair is still selected.
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
  "export { allowanceControlLabel, manualSourceLabel } from '@/lib/manualSource';",
  "export { draftMismatch, forSelection, selectionKey, tagForSelection } from '@/lib/gstr3bSelection';",
  "export { suspendedRecoSheetRows } from '@/utils/suspendedRecoExcelExport';",
  "export { gstReceivableRecoSheetRows } from '@/utils/gstReceivableRecoExcelExport';",
  "export { buildCreditClosingAllClients, buildCreditClosingPerClient } from '@/utils/allClientsReports';",
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
check('page: gatePassesNow uses askGateForClick', /const clientId = selectedClient;\s*const month = selectedMonth;[\s\S]*?askGateForClick\(clientId, month, what\)/.test(body('gatePassesNow')));
check('page: locked while loading, on no answer and on "no"', /const gateBlocks = gateLoading \|\| !gate \|\| !gate\.ok;/.test(page));
check('page: the push button is disabled by the gate', /disabled=\{isPushing \|\| isLoading \|\| !extReady \|\| !filingKnown \|\| isFiled \|\| gateBlocks \|\| !canEditFilingStatus\(\)\}/.test(page));
check('page: the JSON button is disabled by the gate', /disabled=\{!canExportData\(\) \|\| gateBlocks \|\| isLoading\}/.test(page));
check('page: the push needs extension 0.16.0', /if \(!extensionCanPull\(extVersion\)\) \{\s*toast\.error\(needsExtensionMessage\(extVersion\)\);\s*return;/.test(push));
const preview = fs.readFileSync(path.join(root, 'src/components/portal/Gstr3bPreviewDialog.tsx'), 'utf8');
check('preview dialog: its JSON download asks the gate first too',
  /const \{ allowed, message \} = await askGateForClick\(clientId, periodMonth, 'The GSTR-3B JSON download'\);\s*if \(keyRef\.current !== key\) \{[^\n]*\}\s*if \(!allowed\)/.test(preview)
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

// ── Round 2 of the review ──────────────────────────────────────────────────
// 1. Heads that offset do not tally.
check('r2 heads: IGST 1,000 against CGST 500 + SGST 500 does not tally', lib.headsTally({ igst: 1000, cgst: -500, sgst: -500, total: 0 }) === false);
check('r2 heads: every head and the total at 0 tallies', lib.headsTally({ igst: 0, cgst: 0, sgst: 0, total: 0 }) === true && lib.headsTally(null) === true);
check('r2 heads: "ready" does not call offsetting heads "no difference" when waived',
  ready({ status: 'pulled', required_pull: true, waived: true, difference: { igst: 1000, cgst: -500, sgst: -500, total: 0 } }, { required: false })
    .startsWith('Suspended Reco is pulled; its difference is waived (Builder, no ITC).'));
const suspPage = fs.readFileSync(path.join(root, 'src/pages/SuspendedRecoPage.tsx'), 'utf8');
const recvPage2 = fs.readFileSync(path.join(root, 'src/pages/GstReceivableRecoPage.tsx'), 'utf8');
check('r2 heads: both reco pages say Tallies / Reconciled only when every head tallies',
  /const diffTallies = headsTally\(\{ cgst: diffCgst, sgst: diffSgst, igst: diffIgst, total: diffTotal \}\);/.test(suspPage)
  && /const diffTallies = headsTally\(\{ cgst: diffCgst, sgst: diffSgst, igst: diffIgst, total: diffTotal \}\);/.test(recvPage2)
  && /\{diffTallies \? 'Tallies' : 'Differs'\}/.test(recvPage2) && /hint=\{diffTallies \? 'Reconciled'/.test(suspPage)
  && !/diffTotal === 0 \? 'Tallies'/.test(recvPage2));

// 6. The manual label belongs to the allowance the opening was entered under.
const al = { id: 'a1', reason: 'portal password wrong', used_at: '2026-10-21T06:00:00Z' };
check('r2 allowance: the opening entered under it reads manual (allowed by ...)',
  lib.allowanceControlLabel(al, 'a1', 'Sam') === 'manual (allowed by Sam: portal password wrong)');
check('r2 allowance: a used one the opening is not from does not read manual',
  /^Manual entry used 21 Oct 2026 \(allowed by Sam: portal password wrong\); the opening shown is not from it$/.test(lib.allowanceControlLabel(al, null, 'Sam'))
  && !/^manual \(/.test(lib.allowanceControlLabel(al, 'other', 'Sam')));
check('r2 allowance: an unused one says so', lib.allowanceControlLabel({ ...al, used_at: null }, null, 'Sam') === 'Manual entry allowed by Sam: portal password wrong · not used yet');
const ctrl = fs.readFileSync(path.join(root, 'src/components/manualSource/ManualSourceAllowanceControl.tsx'), 'utf8');
check('r2 allowance: the control labels through allowanceControlLabel with the opening\'s allowance',
  /allowanceControlLabel\(allowance, openingAllowanceId, names\.get\(allowance\.allowed_by\)\)/.test(ctrl) && !/manualSourceLabel\(names/.test(ctrl));
check('r2 allowance: neither reco page shows the control over a pulled month, and both pass the opening\'s allowance',
  [suspPage, recvPage2].every((t) => /\{selectedClientId && !isPulled && \(\s*<ManualSourceAllowanceControl/.test(t)
    && /openingAllowanceId=\{openingAllowanceId\}/.test(t) && !/\(!isPulled \|\| allowance\)/.test(t)));

// 7. Typed books closing not saved: Override, Upload, Not Applicable refuse.
check('r2 books: typed and saved compared head by head',
  lib.booksUnsaved({ cgst: 777, sgst: 0, igst: 0 }, { cgst: 0, sgst: 0, igst: 0 }) === true
  && lib.booksUnsaved({ cgst: 5, sgst: 6, igst: 7 }, { cgst: 5, sgst: 6, igst: 7 }) === false);
const recvBody = (start) => { const i = recvPage2.indexOf(start); return i < 0 ? '' : recvPage2.slice(i, i + 400); };
check('r2 books: Override (button and save), Upload and Not Applicable stop while the books closing is unsaved',
  /if \(booksDirty\) \{ toast\.error\(UNSAVED_BOOKS_MESSAGE\); return; \}/.test(recvBody('const handleUploadClick'))
  && /if \(booksDirty\) \{ toast\.error\(UNSAVED_BOOKS_MESSAGE\); return; \}/.test(recvBody('const handleNotApplicable'))
  && /if \(booksDirty\) \{ toast\.error\(UNSAVED_BOOKS_MESSAGE\); return; \}/.test(recvBody('const handleOverrideSave'))
  && /onClick=\{\(\) => \{ if \(booksDirty\) \{ toast\.error\(UNSAVED_BOOKS_MESSAGE\); return; \} setShowOverrideDialog\(true\); \}\}/.test(recvPage2));
check('r2 books: the saved books closing is what fetchData loaded', (recvPage2.match(/setSavedBooks\(/g) || []).length === 2
  && /const booksDirty = isStaff && booksUnsaved\(\{ cgst: booksClosingCgst, sgst: booksClosingSgst, igst: booksClosingIgst \}, savedBooks\);/.test(recvPage2));

// 8. The gate note does not say "ready" for typed figures it has not checked.
check('r2 stale: the receivable page passes the unsaved state to its gate note', /<Gstr3bGateNote compact gate=\{gate\} loading=\{gateLoading\} onRecheck=\{checkGate\} stale=\{booksDirty\} \/>/.test(recvPage2));
check('r2 stale: the note is not ready while stale, and says to save',
  /const ok = !!gate\?\.ok && !loading && !stale;/.test(note) && /Based on the saved figures\. Save to check again\./.test(note)
  && /GSTR-3B push: not checked yet for the figures typed here\./.test(note));

// 9. Before Jun 2026 the parts line names the source plainly.
check('r2 pre-June: a typed opening is not called "not pulled"', lib.gatePartLabel({ status: 'not_pulled', source: 'manual', required_pull: false }) === 'Opening typed');
check('r2 pre-June: a CSV opening is not called "not allowed"', lib.gatePartLabel({ status: 'not_pulled', source: 'csv', required_pull: false }) === 'Opening from a CSV upload');
check('r2 pre-June: no row, and a pull still reads pulled',
  lib.gatePartLabel({ status: 'missing', required_pull: false }) === 'No row (opening 0)'
  && lib.gatePartLabel({ status: 'pulled', required_pull: false, pulled_at: '2026-05-21T05:00:00Z' }).startsWith('Pulled from portal'));
check('r2 pre-June: from Jun 2026 an entry by hand is still "not allowed"', lib.gatePartLabel({ status: 'not_pulled', source: 'csv', required_pull: true }) === 'Not pulled (entered by hand, not allowed)');

// 10. Exports and reports say where each opening came from.
const names2 = new Map([['sam', 'Sam'], ['emil', 'Emil'], ['gita', 'Gita']]);
const manualRow = { opening_source: 'not_applicable', opening_allowance_id: 'a1' };
const srcText = lib.openingSourceText('09/2026', manualRow, { id: 'a1', allowed_by: 'sam', reason: 'portal password wrong', revoked_at: null }, names2);
check('r2 source: an allowed manual entry reads manual (allowed by X: reason)', srcText === 'Not applicable, manual (allowed by Sam: portal password wrong)', srcText);
check('r2 source: pulled, with an override',
  /^Pulled from portal 21 Oct 2026 by Emil; opening overridden by Gita: Reclaim posted late$/.test(lib.openingSourceText('09/2026',
    { opening_source: 'portal', opening_portal_pulled_at: '2026-10-21T05:00:00Z', opening_portal_pulled_by: 'emil', opening_override_justification: 'Reclaim posted late', opening_override_by: 'gita' }, null, names2)));
check('r2 source: not pulled, and no row', lib.openingSourceText('09/2026', { opening_source: 'manual' }, null, names2) === 'Not pulled'
  && lib.openingSourceText('09/2026', null, null, names2) === 'No row (not pulled)');
const sRows = lib.suspendedRecoSheetRows({ clientName: 'P2', clientGstin: 'G', month: '09/2026', openingCgst: 0, openingSgst: 0, openingIgst: 0,
  portalCgst: 0, portalSgst: 0, portalIgst: 0, booksCgst: 0, booksSgst: 0, booksIgst: 0, diffCgst: 0, diffSgst: 0, diffIgst: 0, openingSource: srcText });
check('r2 source: the Suspended Reco export has the source under the opening row',
  sRows[4][0] === 'OPENING BALANCE AS PER PORTAL' && sRows[5][0] === `Opening source: ${srcText}`, JSON.stringify(sRows.slice(4, 6)));
const gRows = lib.gstReceivableRecoSheetRows({ clientName: 'P2', clientGstin: 'G', month: '09/2026', openingCgst: 0, openingSgst: 0, openingIgst: 0,
  availedCgst: 0, availedSgst: 0, availedIgst: 0, utilizedCgst: 0, utilizedSgst: 0, utilizedIgst: 0, drcCgst: 0, drcSgst: 0, drcIgst: 0,
  portalClosingCgst: 0, portalClosingSgst: 0, portalClosingIgst: 0, booksClosingCgst: 0, booksClosingSgst: 0, booksClosingIgst: 0,
  diffCgst: 0, diffSgst: 0, diffIgst: 0, openingSource: srcText });
check('r2 source: the GST Receivable Reco export too', gRows[4][0] === 'OPENING BALANCE AS PER PORTAL' && gRows[5][0] === `Opening source: ${srcText}`, JSON.stringify(gRows.slice(4, 6)));
check('r2 source: both pages pass it', [suspPage, recvPage2].every((t) => /openingSource: exportOpeningSource\(\),/.test(t)));
globalThis.__db = {
  clients: [{ id: 'p1', name: 'P1 PULLED', gstin: 'G1' }, { id: 'p2', name: 'P2 MANUAL', gstin: 'G2' }, { id: 'p3', name: 'P3 NONE', gstin: 'G3' }],
  gst_receivable_reco: [
    { client_id: 'p1', period_month: '09/2026', opening_source: 'portal', opening_portal_pulled_at: '2026-10-21T05:00:00Z', opening_portal_pulled_by: 'emil' },
    { client_id: 'p2', period_month: '09/2026', opening_source: 'not_applicable', opening_allowance_id: 'a1' },
  ],
  manual_source_allowances: [{ id: 'a1', allowed_by: 'sam', reason: 'portal password wrong', revoked_at: null }],
  profiles: [{ user_id: 'sam', first_name: 'Sam' }, { user_id: 'emil', first_name: 'Emil' }],
  itc_summaries: [], gstr1_data: [],
};
const credAll = await lib.buildCreditClosingAllClients('09/2026');
const srcCol = credAll.headers.indexOf('Opening Source');
check('r2 source: the all-clients credit-ledger report has an Opening Source column',
  srcCol === credAll.headers.length - 1 && credAll.rows.every((r) => r.length === credAll.headers.length), JSON.stringify(credAll.headers));
check('r2 source: pulled, manual and no row read as such',
  /^Pulled from portal 21 Oct 2026 by Emil$/.test(credAll.rows[0][srcCol])
  && credAll.rows[1][srcCol] === 'Not applicable, manual (allowed by Sam: portal password wrong)'
  && credAll.rows[2][srcCol] === 'No row (not pulled)', JSON.stringify(credAll.rows.map((r) => r[srcCol])));
const credOne = await lib.buildCreditClosingPerClient('p2', '09/2026');
const m9 = credOne.rows.find((r) => r[1] === 'Sep 2026');
check('r2 source: the per-client months report too', credOne.headers.at(-1) === 'Opening Source' && m9 && m9.at(-1) === 'Not applicable, manual (allowed by Sam: portal password wrong)'
  && credOne.rows.at(-1)[1] === 'TOTAL' && credOne.rows.at(-1).length === credOne.headers.length, JSON.stringify(m9));
globalThis.__db = {};

// 3. Push History flags a push the database recorded without a passing gate.
check('r2 push record: Push History flags an ok push whose recorded gate failed',
  /const pushedWithoutGate = \(v: Pick<Gstr3bPushVersion, 'status' \| 'gate'>\) => v\.status === 'ok' && !!v\.gate && v\.gate\.ok === false;/.test(page)
  && (page.match(/pushedWithoutGate\((v|versions\[0\])\) && \(/g) || []).length === 2 && /Reco check failed: not marked Pushed/.test(page));

// ── Round 3 of the review: the GSTR-3B page is keyed to its client and month ──
// The helpers, as values.
const tagged = lib.tagForSelection('c-1', '09/2026', { draft: 'C1' });
check('r3 keyed: a value reads back for its own client and month', lib.forSelection(tagged, 'c-1', '09/2026')?.draft === 'C1');
check('r3 keyed: and for no other pair, or none', lib.forSelection(tagged, 'c-10', '09/2026') === null
  && lib.forSelection(tagged, 'c-1', '10/2026') === null && lib.forSelection(null, 'c-1', '09/2026') === null
  && lib.forSelection(tagged, '', '09/2026') === null);
check('r3 keyed: the key needs both', lib.selectionKey('c-1', '09/2026') === 'c-1|09/2026' && lib.selectionKey('', '09/2026') === '' && lib.selectionKey('c-1', null) === '');
// The verifier's case: C10's draft on screen while C1 is selected.
const c10Draft = { gstin: '24AAAAA0010A1Z5', ret_period: '092026' };
check('r3 draft: another client\'s draft does not go out', /is for GSTIN 24AAAAA0010A1Z5, not 24AAAAA0001A1Z5/.test(lib.draftMismatch(c10Draft, '24AAAAA0001A1Z5', '09/2026') || ''));
check('r3 draft: another month\'s draft does not go out', /another month/.test(lib.draftMismatch(c10Draft, '24AAAAA0010A1Z5', '10/2026') || ''));
check('r3 draft: a draft built before the GSTIN was known does not go out', !!lib.draftMismatch({ gstin: '', ret_period: '092026' }, '24AAAAA0010A1Z5', '09/2026'));
check('r3 draft: no draft, or a client with no GSTIN, does not go out', !!lib.draftMismatch(null, 'G', '09/2026') && /no GSTIN/.test(lib.draftMismatch(c10Draft, '', '09/2026') || ''));
check('r3 draft: its own draft goes out', lib.draftMismatch(c10Draft, ' 24aaaaa0010a1z5 ', '09/2026') === null);

// The page's wiring.
check('r3 page: the draft is kept with its pair and read back through forSelection',
  /const \[loaded, setLoaded\] = useState<ForSelection<Gstr3bResult> \| null>\(null\);\s*const result = forSelection\(loaded, selectedClient, selectedMonth\);/.test(page)
  && !/setResult\(/.test(page));
const compute = page.slice(page.indexOf('const compute = useCallback'), page.indexOf('}, [selectedClient, selectedMonth, clients]);'));
check('r3 page: a switch clears the draft and a late build is dropped',
  /const seq = \+\+computeSeq\.current;\s*setLoaded\(null\);/.test(compute)
  && /if \(seq !== computeSeq\.current\) return;\s*setLoaded\(tagForSelection\(selectedClient, selectedMonth, built\)\);/.test(compute), compute.slice(0, 300));
check('r3 page: the gate answer is kept with its pair and read back through forSelection',
  /const gate = forSelection\(gateFor, selectedClient, selectedMonth\);/.test(page) && !/setGate\(/.test(page)
  && (page.match(/setGateFor\(tagForSelection\(/g) || []).length === 2);
const gpn = body('gatePassesNow');
check('r3 page: a click\'s late gate answer is dropped when the pair changed, and is not shown',
  gpn.indexOf('if (selKeyRef.current !== key) {') > gpn.indexOf('await askGateForClick')
  && gpn.indexOf('return null;', gpn.indexOf('if (selKeyRef.current !== key) {')) < gpn.indexOf('setGateFor(')
  && /if \(seq === gateSeq\.current\) \{\s*setGateFor\(tagForSelection\(clientId, month, g\)\);/.test(gpn), gpn.slice(0, 400));
check('r3 page: the JSON download takes the click\'s draft, checks it is that client\'s and month\'s, and that the pair is still selected',
  /const key = selKey;\s*const draft = result;/.test(json) && /if \(!draft \|\| isLoading\)/.test(json)
  && json.indexOf('draftMismatch(draft.json, gstin, month)') < json.indexOf('gatePassesNow')
  && json.indexOf("stillSelected(key, 'The GSTR-3B JSON download')") > json.indexOf('gatePassesNow')
  && json.indexOf("stillSelected(key, 'The GSTR-3B JSON download')") < json.indexOf('new Blob(')
  && /new Blob\(\[JSON\.stringify\(draft\.json/.test(json) && !/result\.json/.test(json), json.slice(0, 400));
check('r3 page: the push takes the click\'s draft, client and month, checks them, and sends only those',
  /const key = selKey;\s*const draft0 = result;\s*const clientId = selectedClient;\s*const month = selectedMonth;/.test(push)
  && /if \(!draft0 \|\| isLoading\)/.test(push)
  && push.indexOf('draftMismatch(draft0.json, client.gstin, month)') < push.indexOf('gatePassesNow')
  && push.indexOf("stillSelected(key, 'Push to GST Portal')") > push.indexOf('advanceGate.evaluate')
  && push.indexOf("stillSelected(key, 'Push to GST Portal')") < push.indexOf('__gstkPushGstr3b')
  && /__gstkPushGstr3b: \{\s*clientId,\s*period_month: month,/.test(push)
  && !/result\.|selectedClient\b|selectedMonth\b|selectedClientData/.test(push.slice(push.indexOf('const client = selectedClientData;') + 40)), push.slice(0, 400));
check('r3 page: the push is locked until this pair\'s filing status is read',
  /const filingKnown = filingFor !== '' && filingFor === selKey;\s*const isFiled = filingKnown && filingStatus === 'Filed';/.test(page)
  && /if \(!filingKnown \|\| isFiled\)/.test(push) && /if \(seq !== filingSeq\.current\) return;/.test(page));
check('r3 page: Push History drops a late answer for another pair', /if \(seq !== versionsSeq\.current\) return;/.test(page));
check('r3 preview dialog: keyed the same way',
  /const result = forSelection\(loaded, clientId, periodMonth\);/.test(preview) && /draftMismatch\(draft\.json, gstin, periodMonth\)/.test(preview)
  && /if \(seq === buildSeq\.current\) setLoaded\(tagForSelection\(clientId, periodMonth, built\)\);/.test(preview));

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n     ${r.info}`}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
