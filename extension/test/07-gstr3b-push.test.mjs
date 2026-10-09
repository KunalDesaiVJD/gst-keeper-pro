// 0.8.6: how a GSTR-3B push is judged and typed (content.js). A skipped entry
// the portal explains (a locked column, an import row's missing 2nd/3rd input,
// 3.1(a)/(b) not on the form) leaves the push 'filled'; anything else makes it
// 'partial'. 4A(1)/(2) carry IGST only, so nothing lands in their CESS box; a
// value the portal did not keep is a skip, not a fill; figures go in rounded.
// Also the GSTR-1 Upload History status and the portal labels that are never
// invoice errors. Runs the shipped code: each function is cut out of
// content.js, as 06-login-answers does.
//   node test/07-gstr3b-push.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
// A function declared at the IIFE's top level: from its signature to the
// first closing brace at that indent (or its own line, for a one-liner).
function cut(sig) {
  const i = src.indexOf('\n  ' + sig);
  if (i < 0) throw new Error(sig + ' not found in content.js');
  const line = src.slice(i + 1, src.indexOf('\n', i + 1));
  if (line.split('{').length === line.split('}').length) return line;
  return src.slice(i + 1, src.indexOf('\n  }\n', i) + 4);
}
const names = ['oneLine', 'gstr3bNum', 'gstr3bSameValue', 'classifyGstr3bSkips', 'gstr3bSummary', 'gstr3bTable4Rows',
  'find31RowByLetter', 'classifyUploadStatus', 'isPortalPlaceholder'];
const code = names.map((n) => cut('function ' + n + '(')).join('\n') + '\n' + cut('async function fillGstr3bRow(')
  + '\n' + [...names, 'fillGstr3bRow'].map((n) => 'this.' + n + ' = ' + n + ';').join('\n');
// What fillGstr3bRow and find31RowByLetter reach outside themselves: the page.
const page = { row: null, anchor: null };
const ctx = vm.createContext({
  findGstr3bRow: () => page.row,
  gstr3bRowsSeen: () => ' (rows in the open form: Nature of Supplies | (c) Other outward supplies)',
  setGstr3bNumericVal: async (el, v) => { el.typed = String(v); el.value = el.keeps ? el.keeps(String(v)) : String(v); },
  sleep: async () => {},
});
vm.runInContext(code, ctx);
const f = ctx;

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : `  [got ${JSON.stringify(a)}]`));

// ── Figures go in rounded to 2 decimals; null stays null ──────────────────────
eq(f.gstr3bNum(null), null, 'gstr3bNum(null) is null');
eq(f.gstr3bNum(undefined), null, 'gstr3bNum(undefined) is null');
eq(f.gstr3bNum(0), '0', 'gstr3bNum(0) is "0"');
eq(f.gstr3bNum(3942.4500000000003), '3942.45', 'float noise from the draft is rounded (PRIDE DRUGS 07/2026)');
eq(f.gstr3bNum(70977.79000000001), '70977.79', 'float noise from the draft is rounded (TAMNNA 07/2026)');
eq(f.gstr3bNum(12.3456), '12.35', 'more than 2 decimals is rounded');
eq(f.gstr3bNum('1200.5'), '1200.5', 'a numeric string passes');
eq(f.gstr3bNum('abc'), null, 'a non-number is never typed');

// ── Read back: the portal's formatting is not a change ────────────────────────
ok(f.gstr3bSameValue('1,234.00', '1234'), 'commas and a trailing .00 are formatting');
ok(f.gstr3bSameValue('12,34,567.89', '1234567.89'), 'Indian digit grouping is formatting');
ok(f.gstr3bSameValue('1234.50', '1234.5'), 'a trailing zero is formatting');
ok(!f.gstr3bSameValue('', '0'), 'a blanked field is not what was typed');
ok(!f.gstr3bSameValue('99000', '1200'), 'another figure is not what was typed');

// ── What a skipped entry means: the 0.8.5 skips of every 'ok' push ────────────
const live = [
  '3.1(a) Outward taxable supplies — row not found',
  '3.1(b) Zero rated — row not found',
  '4A(1) Import of goods col 3 — no input at that position',
  '4A(2) Import of services col 3 — no input at that position',
];
const c0 = f.classifyGstr3bSkips(live);
eq(c0.status, 'filled', 'the skips every 0.8.5 push had leave it filled');
eq(c0.portalFilled, [
  '3.1(a) Outward taxable supplies — not typed; the portal keeps the value it filled from GSTR-1',
  '3.1(b) Zero rated — not typed; the portal keeps the value it filled from GSTR-1',
], '3.1(a)/(b) row not found move to portalFilled, in the agreed words');
eq(c0.skipped, live.slice(2), 'the import rows\' missing col 3 stay in skipped, tolerated');
eq(c0.problems, [], 'nothing counts against the push');

const withRows = f.classifyGstr3bSkips(['3.1(a) Outward taxable supplies — row not found (rows in the open form: Nature of Supplies | (a) Outward)']);
eq(withRows.portalFilled, ['3.1(a) Outward taxable supplies — not typed; the portal keeps the value it filled from GSTR-1 (rows in the open form: Nature of Supplies | (a) Outward)'],
  'the row labels found on the form are kept on the portalFilled entry');
eq(f.classifyGstr3bSkips(['3.1(a) Outward taxable supplies col 2 — portal-locked (e.g. CGST/SGST on an import row)']).status, 'filled', 'a portal-locked column is tolerated');
eq(f.classifyGstr3bSkips(['4A(1) Import of goods col 2 — no input at that position']).status, 'filled', '4A(1) col 2 with no input is tolerated');
eq(f.classifyGstr3bSkips(['4A(1) Import of goods col 1 — no input at that position']).status, 'partial', '4A(1) col 1 with no input is not');
eq(f.classifyGstr3bSkips(['4A(3) Inward RCM ITC col 3 — no input at that position']).status, 'partial', 'a missing input on any other row is partial');
eq(f.classifyGstr3bSkips(['3.1(c) Nil/exempt — row not found']).status, 'partial', '3.1(c) not found is partial');
eq(f.classifyGstr3bSkips(['3.1(d) Inward RCM — row not found']).portalFilled, [], 'only 3.1(a)/(b) can be portal filled');
const tile = f.classifyGstr3bSkips(['3.1(a)-(e) — could not open the "3.1 Tax on outward…" tile']);
ok(tile.status === 'partial' && tile.portalFilled.length === 0, 'a 3.1 tile that would not open is partial, not portal filled');
eq(f.classifyGstr3bSkips(['Table 4 — could not open the "4. Eligible ITC" tile']).status, 'partial', 'a Table 4 tile that would not open is partial');
eq(f.classifyGstr3bSkips(['4A(5) All other ITC col 1 — portal kept 0']).status, 'partial', 'a value the portal did not keep is partial');
eq(f.classifyGstr3bSkips([]).status, 'filled', 'nothing skipped is filled');

const s0 = f.gstr3bSummary(31, c0);
ok(/^Filled 31 field\(s\)\./.test(s0) && !/Could not set/.test(s0), 'a filled push\'s summary lists nothing as not set');
ok(s0.includes('the portal keeps the value it filled from GSTR-1: 3.1(a) Outward taxable supplies, 3.1(b) Zero rated'), 'the summary names the portal-filled rows');
const s1 = f.gstr3bSummary(30, f.classifyGstr3bSkips(['3.1(c) Nil/exempt — row not found (rows in the open form: A | B)']));
ok(s1.includes('Could not set 1: 3.1(c) Nil/exempt — row not found.') && !s1.includes('rows in the open form'), 'a partial push\'s summary names the row, without the row labels');

// ── Table 4: 4A(1)/(2) carry IGST only ─────────────────────────────────────────
const j = { itc_elg: {
  itc_avl: [
    { ty: 'IMPG', igst: 100.456, cgst: 0, sgst: 0 },
    { ty: 'IMPS', igst: 20, cgst: 0, sgst: 0 },
    { ty: 'ISRC', igst: 1, cgst: 2, sgst: 2 },
    { ty: 'OTH', igst: 10, cgst: 3942.4500000000003, sgst: 3942.45 },
  ],
  itc_rev: [{ ty: 'RUL', igst: 0, cgst: 5, sgst: 5 }],
  itc_rclmd: [{ ty: 'OTH', igst: 0, cgst: 1, sgst: 1 }],
  itc_inelg: [{ ty: 'OTH', igst: 7, cgst: 0, sgst: 0 }],
} };
const rows = f.gstr3bTable4Rows(j);
const byName = Object.fromEntries(rows.map(([n, , v]) => [n, v]));
eq(rows.length, 9, 'Table 4 has nine rows to fill');
eq(byName['4A(1) Import of goods'], ['100.46', null, null], '4A(1) Import of goods: IGST only');
eq(byName['4A(2) Import of services'], ['20', null, null], '4A(2) Import of services: IGST only');
eq(byName['4A(3) Inward RCM ITC'], ['1', '2', '2'], '4A(3) keeps IGST/CGST/SGST');
eq(byName['4A(5) All other ITC'], ['10', '3942.45', '3942.45'], '4A(5) keeps IGST/CGST/SGST, rounded');
eq(byName['4B(1) Reversed — rules 38/42/43 & 17(5)'], ['0', '5', '5'], '4B(1) from itc_rev RUL');
eq(byName['4D(1) ITC reclaimed — reversed under 4(B)(2)'], ['0', '1', '1'], '4D(1) from itc_rclmd');
eq(byName['4D(2) Ineligible — 16(4) & PoS'], ['7', '0', '0'], '4D(2) from itc_inelg');
ok(f.gstr3bTable4Rows({}).every(([, , v]) => v.every((x) => x === null)), 'an empty draft types nothing');
ok(rows[0][1].test('(1) Import of goods') && rows[1][1].test('(2) Import of services'), 'the import rows are found by their labels');

// ── fillGstr3bRow on the portal's two-input import row (IGST, CESS) ─────────
const input = (extra) => ({ value: '', disabled: false, readOnly: false, ...extra });
const rowOf = (inputs) => ({ querySelectorAll: () => inputs });
{
  const igst = input(), cess = input({ value: '512.00' });
  page.row = rowOf([igst, cess]);
  const filled = [], skipped = [];
  await f.fillGstr3bRow(filled, skipped, '4A(1) Import of goods', /import of goods/i, byName['4A(1) Import of goods']);
  eq(igst.typed, '100.46', 'IGST is typed into the first input');
  ok(cess.typed === undefined && cess.value === '512.00', 'the CESS input is never touched (an ICEGATE cess stays)');
  eq(filled, ['4A(1) Import of goods col 1'], 'one field filled');
  eq(skipped, [], 'nothing skipped');
}
{
  // What 0.8.5 did with [igst, cgst, sgst] on the same row: 0 into CESS.
  const igst = input(), cess = input({ value: '512.00' });
  page.row = rowOf([igst, cess]);
  const filled = [], skipped = [];
  await f.fillGstr3bRow(filled, skipped, '4A(1) Import of goods', /import of goods/i, ['100.46', '0', '0']);
  ok(cess.typed === '0', 'the old three-value mapping typed into CESS (why 0.8.6 sends IGST only)');
}
{
  const kept = input({ keeps: () => '' });
  page.row = rowOf([kept]);
  const filled = [], skipped = [];
  await f.fillGstr3bRow(filled, skipped, '4A(5) All other ITC', /all other itc/i, ['1200', null, null]);
  eq(filled, [], 'a value the portal blanked is not counted as filled');
  eq(skipped, ['4A(5) All other ITC col 1 — portal kept (blank)'], 'it is reported as what the portal kept');
  eq(f.classifyGstr3bSkips(skipped).status, 'partial', 'and makes the push partial');
}
{
  const fmt = input({ keeps: (v) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 }) });
  page.row = rowOf([fmt]);
  const filled = [], skipped = [];
  await f.fillGstr3bRow(filled, skipped, '4A(5) All other ITC', /all other itc/i, ['1234567', null, null]);
  eq(filled, ['4A(5) All other ITC col 1'], 'a value the portal formats (12,34,567.00) counts as filled');
}
{
  const locked = input({ disabled: true });
  page.row = rowOf([input(), locked]);
  const filled = [], skipped = [];
  await f.fillGstr3bRow(filled, skipped, '3.1(a) Outward taxable supplies', /x/, ['10', '1']);
  eq(skipped, ['3.1(a) Outward taxable supplies col 2 — portal-locked (e.g. CGST/SGST on an import row)'], 'a disabled input is portal-locked (wording kept)');
}
{
  page.row = null;
  const filled = [], skipped = [];
  await f.fillGstr3bRow(filled, skipped, '3.1(a) Outward taxable supplies', /x/, ['10']);
  eq(skipped, ['3.1(a) Outward taxable supplies — row not found (rows in the open form: Nature of Supplies | (c) Other outward supplies)'],
    'a row not found keeps "— row not found" and lists the rows the form shows');
  const viaFallback = input();
  const filled2 = [], skipped2 = [];
  await f.fillGstr3bRow(filled2, skipped2, '3.1(a) Outward taxable supplies', /x/, ['10'], () => rowOf([viaFallback]));
  ok(viaFallback.typed === '10' && skipped2.length === 0, 'the fallback row is filled when the label does not match');
}

// ── 3.1(a)/(b) labels take any whitespace (the regexes in handleGstr3bFill31) ─
const labelRe = (name) => {
  const at = src.indexOf("'" + name + "', /");
  if (at < 0) throw new Error(name + ' fill not found in content.js');
  const lit = src.slice(src.indexOf('/', at), src.indexOf('/i, [', at) + 2);
  return vm.runInNewContext(lit);
};
const re31a = labelRe('3.1(a) Outward taxable supplies');
const re31b = labelRe('3.1(b) Zero rated');
for (const t of ['(a) Outward taxable supplies (other than zero rated, nil rated and exempted)',
  '(a) Outward taxable supplies\n (other than zero rated, nil rated and exempted)', '(a)  Outward  taxable supplies ( other than zero rated']) {
  ok(re31a.test(t), '3.1(a) label matches ' + JSON.stringify(t.slice(0, 50)));
}
for (const t of ['(b) Outward taxable supplies (zero rated)', '(b) Outward taxable\n supplies ( zero rated )']) {
  ok(re31b.test(t), '3.1(b) label matches ' + JSON.stringify(t));
}
ok(!re31a.test('(b) Outward taxable supplies (zero rated)') && !re31b.test('(a) Outward taxable supplies (other than zero rated'), '3.1(a) and (b) never match each other');

// ── 3.1(a)/(b) fallback: the '(a)' row of the 3.1 form, never Table 4 ────────
{
  const tr = (text, shown = true) => ({ textContent: text, offsetParent: shown ? {} : null });
  const table = (trs) => ({ querySelectorAll: () => trs });
  const form31 = table([tr('Nature of Supplies Total Taxable value'), tr('  (a) Outward taxable supplies (other than zero rated,\n nil rated and exempted) 0.00'),
    tr('(b) Outward taxable supplies (zero rated) 0.00'), tr('(c) Other outward supplies (Nil rated, exempted)')]);
  page.row = { closest: () => form31 };
  ok(/^\s*\(a\) Outward/.test(f.find31RowByLetter('a').textContent), 'finds the (a) row of the 3.1 form');
  ok(/^\(b\) Outward/.test(f.find31RowByLetter('b').textContent), 'finds the (b) row of the 3.1 form');
  const form4 = table([tr('(A) ITC Available (whether in full or part)'), tr('(B) ITC Reversed'), tr('(a) ITC reclaimed'), tr('(a) Import of goods')]);
  page.row = { closest: () => form4 };
  eq(f.find31RowByLetter('a'), null, 'never a Table 4 row: (A)/(B) are upper case, and no ITC or import row');
  eq(f.find31RowByLetter('b'), null, 'nor (B) ITC Reversed');
  page.row = { closest: () => table([tr('(a) Outward taxable supplies', false)]) };
  eq(f.find31RowByLetter('a'), null, 'a hidden row is never used');
  page.row = null;
  eq(f.find31RowByLetter('a'), null, 'no 3.1 form open: nothing');
}

// ── GSTR-1: the Upload History status, and labels that are not errors ───────
eq(f.classifyUploadStatus('Processed'), 'accepted', 'Processed is accepted');
eq(f.classifyUploadStatus('Processed with Error'), 'partial', 'Processed with Error is partial');
eq(f.classifyUploadStatus('Error Occurred'), 'failed', 'Error Occurred is failed');
eq(f.classifyUploadStatus('In Progress'), null, 'In Progress is not an outcome yet');
for (const label of ['Error report generation requested', 'Generate error report', 'Download error report', 'NA', 'NA NA NA', 'N/A', '', 'Request for error report has been acknowledged']) {
  ok(f.isPortalPlaceholder(label), `${JSON.stringify(label)} is never an invoice error`);
}
ok(!f.isPortalPlaceholder('The UQC entered is not valid'), 'a real reason is kept');
ok(!f.isPortalPlaceholder('File could not be uploaded! Download the latest offline tool'), 'a file-level rejection is kept');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
