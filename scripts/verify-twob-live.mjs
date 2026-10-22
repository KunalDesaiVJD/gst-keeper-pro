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
// Verification round 4:
//  - a change the page already shows as it is (its own Save, heard after
//    the Save's reload) is not news (changeShown); any other change is,
//    whoever made it and from whichever tab (before, every change stamped by
//    the same user was ignored for 5 s after a Save);
//  - a change heard while the page saves is kept and looked at again when
//    the Save ends (before, it was dropped: the page went on without it);
//  - Save decides its delete confirm from the rows read back, guards every
//    column (not only the figures) and, stopped before its first write,
//    keeps the edits instead of reloading them away.
// Verification round 5:
//  - the page's own Save of a carried entry with its own decision (the
//    decision undone, then the row deleted) is not news: a row's change read
//    with its delete in the same burst (changesShown; before, the update
//    alone read as someone else's change: a toast and a second reload);
//  - a reload heard live also reloads the version list, and a Save or
//    Restore numbers its version from the database at that moment
//    (nextVersionNumber; before, from the page's own list, which Import 2B's
//    snapshots had overtaken: two "Version 1").
// Verification round 8:
//  - the page's own Restore is not news: it deletes the month's own entries
//    and adds them back with their ids, then links some (an insert, then an
//    update), so a row's earlier changes in a burst are shown when its last
//    one is (changesShown), and a change the page already shows stays with
//    a burst under way; and the page keeps what it hears while the Restore
//    runs and looks at it again against the month it reloads, as a Save
//    does (before, the superadmin was told after their own Restore that the
//    ledger "was changed elsewhere").
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

// ── Round 4: which changes the page already shows ───────────────────────────
if (typeof L.changeShown === 'function') {
  const v = { clientId: 'c1', period: '10/2026' };
  const shownRow = { id: 'r1', client_id: 'c1', period_month: '10/2026', supplier_name: 'S', taxable_value: 12000, input_cgst: 900,
    reclaim_month: null, reclaim_subtype: null, adopted_from: null, updated_at: '2026-10-22T10:00:00+00:00', updated_by: 'u1' };
  const rows = new Map([['r1', shownRow]]);
  const shown = (change) => L.changeShown(change, v, rows);
  check('round 4: the page\'s own Save heard after its reload (same content, other stamps) is shown already: nothing to reload or say',
    shown({ eventType: 'UPDATE', new: { ...shownRow, updated_at: '2026-10-22T10:00:01+00:00', updated_by: 'u1' }, old: { id: 'r1' } }) === true);
  check('… also with amounts sent as text ("12000.00"), as a live change may carry them',
    shown({ eventType: 'UPDATE', new: { ...shownRow, taxable_value: '12000.00', input_cgst: '900.00' }, old: { id: 'r1' } }) === true);
  check('a row another user added (B10-7) is news, whoever wrote it and from whichever tab',
    shown({ eventType: 'INSERT', new: { id: 'r7', client_id: 'c1', period_month: '10/2026', supplier_name: 'B10-7', updated_by: 'u1' }, old: {} }) === false);
  check('a decision changed on a row shown (a reclaim recorded on Import 2B) is news',
    shown({ eventType: 'UPDATE', new: { ...shownRow, reclaim_month: 'Oct 26' }, old: { id: 'r1' } }) === false);
  check('a delete of a row the page no longer shows is shown already; of a row it shows, news',
    shown({ eventType: 'DELETE', new: {}, old: { id: 'gone' } }) === true && shown({ eventType: 'DELETE', new: {}, old: { id: 'r1' } }) === false);
  check('a row moved to another month: shown already once the page no longer holds it',
    shown({ eventType: 'UPDATE', new: { id: 'r9', client_id: 'c1', period_month: '11/2026' }, old: { id: 'r9' } }) === true
      && shown({ eventType: 'UPDATE', new: { ...shownRow, period_month: '11/2026' }, old: { id: 'r1' } }) === false);
} else check('round 4: changeShown exists', false, 'missing');

// ── Round 5: a row's change read with its delete in the same burst ──────────
if (typeof L.changesShown === 'function') {
  const v = { clientId: 'c1', period: '10/2026' };
  const kept = { id: 'r1', client_id: 'c1', period_month: '10/2026', supplier_name: 'S', reclaim_month: null, reclaim_subtype: null };
  const rows = new Map([['r1', kept]]);
  const decidedCopy = { id: 'r5', client_id: 'c1', period_month: '10/2026', supplier_name: 'B9-5', reclaim_month: null, reclaim_subtype: null, is_carried_forward: true };
  check('round 5: the page\'s own Save of a carried entry with its decision (decision undone, then the row deleted) is shown already: no toast, no second reload',
    L.changesShown([{ eventType: 'UPDATE', new: decidedCopy, old: { id: 'r5' } }, { eventType: 'DELETE', new: {}, old: { id: 'r5' } }], v, rows) === true);
  check('… heard in either order', L.changesShown([{ eventType: 'DELETE', new: {}, old: { id: 'r5' } }, { eventType: 'UPDATE', new: decidedCopy, old: { id: 'r5' } }], v, rows) === true);
  check('… but that update alone, of a row the page does not hold, is still news',
    L.changesShown([{ eventType: 'UPDATE', new: decidedCopy, old: { id: 'r5' } }], v, rows) === false);
  check('… and a change to a row the page holds stays news beside an unrelated delete',
    L.changesShown([{ eventType: 'UPDATE', new: { ...kept, reclaim_month: 'Oct 26' }, old: { id: 'r1' } }, { eventType: 'DELETE', new: {}, old: { id: 'r5' } }], v, rows) === false);
  check('… and a row the page holds, deleted elsewhere, is news', L.changesShown([{ eventType: 'DELETE', new: {}, old: { id: 'r1' } }], v, rows) === false);
  // Round 8: the page's own Restore (the entries deleted, added back with
  // their ids, one linked after it is added).
  const linked = { ...kept, id: 'r3', source_book_id: 'b1' };
  const rows8 = new Map([['r1', kept], ['r3', linked]]);
  const restoreBurst = [{ eventType: 'DELETE', new: {}, old: { id: 'r1' } }, { eventType: 'DELETE', new: {}, old: { id: 'r9' } },
    { eventType: 'INSERT', new: kept, old: {} }, { eventType: 'INSERT', new: { ...linked, source_book_id: null }, old: {} },
    { eventType: 'UPDATE', new: linked, old: { id: 'r3' } }];
  check('round 8: the page\'s own Restore heard after its reload (deleted, added back with their ids, one linked after) is shown already',
    L.changesShown(restoreBurst, v, rows8) === true);
  check('… but a row deleted and added back otherwise than the page shows it is news',
    L.changesShown([{ eventType: 'DELETE', new: {}, old: { id: 'r1' } }, { eventType: 'INSERT', new: { ...kept, reclaim_month: 'Oct 26' }, old: {} }], v, rows8) === false);
  check('… and a row the page holds, deleted (not added back), is still news beside a Restore\'s burst',
    L.changesShown([...restoreBurst.slice(1), { eventType: 'DELETE', new: {}, old: { id: 'r1' } }], v, rows8) === false);
} else check('round 5: changesShown exists', false, 'missing');

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
check('the live handler ignores other months, shows the banner while edits are unsaved, else reloads once per burst',
  /ledgerChangeConcerns\(change, \{ clientId, period, ids: shownRowsRef\.current \}\)/.test(code)
    && /liveChangeAction\(\{ saving: savingRef\.current, dirty: dirtyRef\.current \}\)/.test(code)
    && /if \(act === 'banner'\) \{ setLedgerChanged\(true\); return; \}/.test(code)
    && /clearTimeout\(timer\);\s*timer = setTimeout\(settle, wait\);/.test(code) && code.includes("fetchBillsData({ ifClean: true })")
    && !/\}, \(\) => \{\s*fetchBillsData\(\);\s*toast\.info\('2B data updated by another user'\);/.test(code));
check('round 4: a change heard while the page saves is kept, and looked at again when the Save ends (both Saves)',
  /if \(savingRef\.current\) \{ heardDuringSaveRef\.current\.push\(change\); return; \}/.test(code)
    && /if \(act === 'wait'\) \{ heardDuringSaveRef\.current\.push\(\.\.\.changes\); return; \}/.test(code)
    && /const endSave = \(\) => \{\s*savingRef\.current = false;\s*const heard = heardDuringSaveRef\.current;\s*heardDuringSaveRef\.current = \[\];\s*if \(heard\.length > 0\) liveKickRef\.current\?\.\(heard\);/.test(code)
    && (code.match(/\} finally \{\s*endSave\(\);\s*setIsSaving\(false\);/g) || []).length === 2,
  'the wait path drops the change, or a Save does not replay what it heard');
check('round 8: a change the page already shows stays with a burst under way (a Restore\'s insert heard just after its delete of the same row), and starts none by itself',
  /if \(changeShown\(change, view, shownRowsRef\.current\)\) \{ if \(timer\) pending\.push\(change\); return; \}\s*hear\(\[change\], 400\);/.test(code));
check('round 8: the page\'s own Restore is heard as a Save is: what it hears while it runs is kept and looked at again against the month it reloads',
  /const handleRestoreVersion = async[\s\S]{0,600}savingRef\.current = true;\s*try \{[\s\S]*?const restored = await restoreVersion\([\s\S]*?await fetchBillsData\(\);[\s\S]*?\} finally \{\s*endSave\(\);\s*\}\s*\};/.test(code),
  'handleRestoreVersion does not hold savingRef while it runs, or does not end with endSave()');
check('round 4: no quiet window by user: a change is ignored only when the page already shows it (changeShown)',
  !code.includes('quietUntilRef') && /if \(changeShown\(change, view, shownRowsRef\.current\)\) \{ if \(timer\) pending\.push\(change\); return; \}/.test(code)
    && /if \(changesShown\(changes, view, shownRowsRef\.current\)\) return;/.test(code)
    && /shownRowsRef\.current = new Map\(\[\.\.\.notIn2B, \.\.\.notInBooks\]\.map\(\(b\) => \[b\.id, b\]\)\);/.test(fetchBody));
check('… hears deletes (which carry only a row id) and every change of the client',
  /event: 'DELETE', schema: 'public', table: 'bills_not_in_2b' \}/.test(code) && /event: 'DELETE', schema: 'public', table: 'bills_not_in_books' \}/.test(code));
check('the banner and a Reload (discard) are on the page', code.includes('{LEDGER_CHANGED_BANNER}') && /onClick=\{\(\) => void reloadMonth\(\)\}/.test(code));
const pendLib = fs.readFileSync(path.join(root, 'src/lib/twobPendingWrites.ts'), 'utf8');
check('Save sends only the changed rows, checks them against the rows loaded first, and refuses with a reload prompt',
  /const plan2B = rowsToSave\(localBills2B, billsNotIn2B, deletedRows2B\);/.test(code)
    && /const checked = await checkNotChangedElsewhere\(plan2B, planBooks\);\s*if \(!checked\) return;/.test(code)
    && /title: 'This month changed since you loaded it'[\s\S]{0,400}confirmText: 'Reload',\s*cancelText: 'Keep my changes'/.test(code)
    && /updates: \{ bills_not_in_2b: plan2B\.updates, bills_not_in_books: planBooks\.updates \}/.test(code)
    && /for \(const \{ loaded, edited \} of o\.updates\[table\]\) \{\s*const res = await updateOpenMonthRow\(table, loaded, edited, o\.userId\);/.test(pendLib));
check('round 4: every column a row holds guards its update and delete (not only the figures); the check reads them all',
  /const \{ data, error \} = await guarded\(q, loaded\)\.select\('id'\);/.test(pendLib)
    && /await guarded\(supabase\.from\(table\)\.delete\(\), guard\)\.select\('id'\)/.test(pendLib)
    && /await guarded\(supabase\.from\(table\)\.update\(DECISION_CLEARED\[table\] as never\), row\)\.select\('\*'\)/.test(pendLib)
    && /supabase\.from\(table\)\.select\('\*'\)\.in\('id', ids\)/.test(pendLib) && !pendLib.includes('DOOR_COLUMNS'));
check('round 4: the delete confirm and the decisions a delete undoes come from the rows read back, not the copies loaded',
  /const del2B = plan2B\.deletes\.map\(\(b\) => checked\.current2B\.get\(b\.id\) \?\? b\);/.test(code)
    && /const goneDecided = \[\.\.\.del2B, \.\.\.delBooks\]\.filter\(/.test(code)
    && /deletes: \{ bills_not_in_2b: del2B, bills_not_in_books: delBooks \}/.test(code)
    && code.indexOf('const checked = await checkNotChangedElsewhere(plan2B, planBooks);') < code.indexOf('const goneDecided'));
check('round 4: a Save stopped before its first write keeps the edits and pending deletes (the banner when a row changed), never reloading them away',
  /if \(error instanceof OpenMonthSaveError \? !error\.wrote : !wrote\) \{[\s\S]{0,200}if \(error\?\.stale\) setLedgerChanged\(true\);[\s\S]{0,700}return;\s*\}[\s\S]{0,600}await fetchBillsData\(\);/.test(code));
check('… a filed month\'s Save is checked the same way before its preview',
  /const savePriorMonth = async[\s\S]{0,2500}checkNotChangedElsewhere\(plan2B, planBooks\)[\s\S]{0,300}previewAndApplyPriorBooks/.test(code));
check('round 5: a reload heard live reloads the version list too',
  /void fetchBillsData\(\{ ifClean: true \}\)\.then\(\(\) => fetchVersions\(\)\);/.test(code));
check('round 5: a Save and a Restore number their version from the database at that moment, never from the page\'s list',
  !/versions\.length > 0 \? Math\.max\(\.\.\.versions\.map/.test(code)
    && (code.match(/= await nextVersionNumber\(selectedClientId, selectedMonth\);/g) || []).length === 2
    && code.indexOf('const done = await writeOpenMonthSave(') < code.indexOf('const currentVersionNumber = await nextVersionNumber(')
    && code.indexOf('const restored = await restoreVersion(') < code.indexOf('const newVersionNumber = await nextVersionNumber('));
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
