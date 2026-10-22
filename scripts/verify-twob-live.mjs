#!/usr/bin/env node
// Checks 2B Reconciliation's live updates (docs/2B_RECONCILIATION_FLOW.md
// §15, verification round 3): every Import 2B save now writes the ledger at
// once, so the page hears of a change to its month often, and a change must
// never drop what the user is editing:
//  - a change to another month or client is ignored (ledgerChangeConcerns);
//  - while the page holds unsaved edits or pending deletes, nothing reloads:
//    a banner says the ledger changed (liveChangeAction 'banner'), and while
//    it saves, nothing either ('wait'); otherwise one reload per burst;
//  - Save sends only the rows the user changed (rowsToSave), each guarded by
//    the figures it loaded (findChangedElsewhere, updateOpenMonthRow), and
//    refuses with a reload prompt when any of them changed;
//  - a reload or a discard clears the edits and the pending deletes together
//    (before, a reload left the pending deletes armed and the next Save
//    deleted a row the screen showed again).
// The pure parts are run; the page's wiring is read from its source.
//
//   node scripts/verify-twob-live.mjs
//   GSTK_ROOT=/path/to/other/checkout node scripts/verify-twob-live.mjs
//
// Exits 1 on any failure.
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

let L = {};
try {
  const out = await build({
    stdin: { contents: `export * from './src/lib/twobLiveSync';`, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  });
  L = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
} catch (e) {
  check('src/lib/twobLiveSync.ts loads', false, e?.message ?? e);
}

// ── Which changes concern the month shown ───────────────────────────────────
const view = { clientId: 'c1', period: '09/2026', ids: new Set(['r1', 'r2']) };
const concerns = (change) => (typeof L.ledgerChangeConcerns === 'function' ? L.ledgerChangeConcerns(change, view) : undefined);
check('a change to a row of this month concerns the page', concerns({ eventType: 'UPDATE', new: { id: 'x', client_id: 'c1', period_month: '09/2026' }, old: { id: 'x' } }) === true);
check('a change to another month of the client does not (an import of Oct-26 no longer wipes Sep-26\'s edits)',
  concerns({ eventType: 'INSERT', new: { id: 'y', client_id: 'c1', period_month: '10/2026' }, old: {} }) === false);
check('a change to another client does not', concerns({ eventType: 'UPDATE', new: { id: 'z', client_id: 'c2', period_month: '09/2026' }, old: { id: 'z' } }) === false);
check('a delete naming only a row id the page shows concerns it', concerns({ eventType: 'DELETE', new: {}, old: { id: 'r2' } }) === true);
check('a delete naming only a row id the page never loaded does not', concerns({ eventType: 'DELETE', new: {}, old: { id: 'other' } }) === false);
check('a row moved away from this month (its old id shown) concerns it', concerns({ eventType: 'UPDATE', new: { id: 'r1', client_id: 'c1', period_month: '10/2026' }, old: { id: 'r1' } }) === true);
check('a change naming nothing is never ignored on a guess', concerns({ eventType: 'UPDATE', new: {}, old: {} }) === true);

// ── What the page does with it ──────────────────────────────────────────────
const act = (s) => (typeof L.liveChangeAction === 'function' ? L.liveChangeAction(s) : undefined);
check('unsaved edits or pending deletes: the banner, never a reload', act({ saving: false, dirty: true }) === 'banner');
check('during a Save: wait (the Save reloads at its end)', act({ saving: true, dirty: true }) === 'wait' && act({ saving: true, dirty: false }) === 'wait');
check('nothing unsaved: reload', act({ saving: false, dirty: false }) === 'reload');
check('the banner says the ledger changed and that the edits stay until saved or discarded',
  L.LEDGER_CHANGED_BANNER === 'Someone changed this month\'s ledger; reload to see it; your unsaved changes stay until you save or discard.');

// ── What a Save sends ───────────────────────────────────────────────────────
if (typeof L.rowsToSave === 'function') {
  const loaded = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }, { id: 'd', v: 4 }];
  const local = [{ id: 'a', v: 1 }, { id: 'b', v: 20 }, { id: 'temp-1', v: 5 }];
  const plan = L.rowsToSave(local, loaded, ['c']);
  check('Save sends only the rows the user changed: the edited row with its loaded copy',
    plan.updates.length === 1 && plan.updates[0].loaded.v === 2 && plan.updates[0].edited.v === 20, JSON.stringify(plan));
  check('… the added row', plan.inserts.length === 1 && plan.inserts[0].id === 'temp-1', JSON.stringify(plan.inserts));
  check('… and the deleted row as loaded (its figures guard the delete); an untouched row is not sent',
    plan.deletes.length === 1 && plan.deletes[0].id === 'c' && !plan.updates.some((u) => u.edited.id === 'a'), JSON.stringify(plan));
} else check('rowsToSave exists', false, 'missing');

// ── The page's wiring ───────────────────────────────────────────────────────
const page = fs.readFileSync(path.join(root, 'src/pages/TwoBReconciliationPage.tsx'), 'utf8');
const code = page.replace(/^\s*\/\/.*$/gm, '');
const fetchBody = (code.match(/const fetchBillsData = useCallback\(async[\s\S]*?\n {2}\}, \[selectedClientId, selectedMonth\]\);/) || [''])[0];
check('a reload clears the pending deletes and the edits together',
  /setDeletedRows2B\(\[\]\);\s*setDeletedRowsBooks\(\[\]\);\s*setHasUnsavedChanges\(false\);/.test(fetchBody), 'fetchBillsData does not clear the pending deletes');
check('… and a reload heard live lands only on a page with no edits (an edit begun meanwhile stays, with the banner)',
  /opts\.ifClean && \(editGenRef\.current !== gen \|\| dirtyRef\.current\)/.test(fetchBody) && fetchBody.includes('setLedgerChanged(true)'));
check('… and only for the (client, month) it was started for, and the latest',
  /seq === loadSeq\.current && selectionRef\.current\.client === client && selectionRef\.current\.month === month/.test(fetchBody));
check('the live handler ignores other months, waits while saving, shows the banner while edits are unsaved, else reloads once per burst',
  /ledgerChangeConcerns\(change, \{ clientId, period, ids: loadedIdsRef\.current \}\)/.test(code)
    && /liveChangeAction\(\{ saving: savingRef\.current, dirty: dirtyRef\.current \}\)/.test(code)
    && /if \(act === 'banner'\) \{ setLedgerChanged\(true\); return; \}/.test(code)
    && /clearTimeout\(timer\);\s*timer = setTimeout\(/.test(code) && code.includes("fetchBillsData({ ifClean: true })")
    && !/\}, \(\) => \{\s*fetchBillsData\(\);\s*toast\.info\('2B data updated by another user'\);/.test(code));
check('… hears deletes (which carry only a row id) and every change of the client',
  /event: 'DELETE', schema: 'public', table: 'bills_not_in_2b' \}/.test(code) && /event: 'DELETE', schema: 'public', table: 'bills_not_in_books' \}/.test(code));
check('the banner and a Reload (discard) are on the page', code.includes('{LEDGER_CHANGED_BANNER}') && /onClick=\{\(\) => void reloadMonth\(\)\}/.test(code));
check('Save sends only the changed rows, checks them against the figures loaded first, and refuses with a reload prompt',
  /const plan2B = rowsToSave\(localBills2B, billsNotIn2B, deletedRows2B\);/.test(code)
    && /if \(!\(await checkNotChangedElsewhere\(plan2B, planBooks\)\)\) return;/.test(code)
    && /title: 'This month changed since you loaded it'[\s\S]{0,400}confirmText: 'Reload',\s*cancelText: 'Keep my changes'/.test(code)
    && /for \(const \{ loaded, edited \} of plan\.updates\) \{\s*const res = await updateOpenMonthRow\(table, loaded, edited, user\?\.id\);/.test(code));
check('… a filed month\'s Save is checked the same way before its preview',
  /const savePriorMonth = async[\s\S]{0,2500}checkNotChangedElsewhere\(plan2B, planBooks\)[\s\S]{0,300}previewAndApplyPriorBooks/.test(code));
check('a Save marks itself at once, so a change heard during it waits',
  /savingRef\.current = true;/.test(code) && /savingRef\.current = false;/.test(code));
check('Import Excel (which reloads the month) is refused while edits are unsaved',
  /if \(dirtyRef\.current\) \{\s*toast\.error\('Save or discard your unsaved changes first: Import Excel reloads the month\.'\);/.test(code));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.info}]`}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
