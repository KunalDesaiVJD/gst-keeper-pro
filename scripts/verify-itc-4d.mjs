#!/usr/bin/env node
// Checks GSTR-3B Table 4(D)(1), "ITC reclaimed which was reversed under Table
// 4(B)(2) in earlier tax period", as ITC Summary's 1.1 (Reclaim of ITC
// Reversed for Previous months) + 1.2 (Reclaim of ITC Reversed due to 180 days
// rule/Others): src/lib/itc4D.ts, the GSTR-3B summary and JSON
// (src/utils/buildGstr3bJson.ts: itcOtherDetails, itc_rclmd), and that the
// credit closing (src/utils/allClientsReports.ts) adds no 4(D) row to the
// credit, the reclaims being inside Total 4A already (rows 5.4, 5.5).
//
//   node scripts/verify-itc-4d.mjs
//
// Fictional figures (those of a real month's screen, no client named);
// nothing is read from or written to Supabase. Exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

const results = [];
const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info: cond ? '' : String(info) });
const run = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: runs`, false, e?.stack ?? e); } };

const load = async (contents) => {
  const out = await build({
    stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
        b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const supabase = {};', loader: 'js' }));
      },
    }],
    define: { 'import.meta.env': '{}' },
    banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
// Without src/lib/itc4D.ts (the code before the fix) the rest is still checked.
const H = await load(`export * from './src/lib/itc4D';`).catch(() => ({}));
const G = await load(`export * from './src/utils/buildGstr3bJson';`);
const A = await load(`export * from './src/utils/allClientsReports';`);

const heads = (igst, cgst, sgst) => ({ igst, cgst, sgst });
const same = (a, b) => ['igst', 'cgst', 'sgst'].every((h) => Math.abs((a?.[h] ?? NaN) - b[h]) < 0.005);
const show = (x) => JSON.stringify(x && { igst: x.igst, cgst: x.cgst, sgst: x.sgst });

// A month as ITC Summary saved it before the fix: row (1) holding 1.1 alone.
const D_SAVED = [
  { srNo: '(1)', particular: 'ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period', ...heads(0, 1402.2, 1402.2), isAutoLinked: true, reasons: '' },
  { srNo: '1.1', particular: 'Reclaim of ITC Reversed for Previous months', ...heads(0, 1402.2, 1402.2), isAutoLinked: true, reasons: '' },
  { srNo: '1.2', particular: 'Reclaim of ITC Reversed due to 180 days rule/Others', ...heads(2700, 2298.24, 2298.24), editable: true, reasons: '' },
  { srNo: '(2)', particular: 'Ineligible ITC under section 16(4) & ITC restricted due to PoS rules', ...heads(0, 0, 0), editable: true, reasons: '' },
];
const SUM = heads(2700, 3700.44, 3700.44);

// ── 1. The rule ─────────────────────────────────────────────────────────────
await run('rule', async () => {
  check('4(D)(1) = 1.1 + 1.2 (2,700.00 / 3,700.44 / 3,700.44), not row (1) as saved', same(H.reclaimed4D1?.(D_SAVED), SUM), show(H.reclaimed4D1?.(D_SAVED)));
  const rows = H.with4D1Total?.(D_SAVED) ?? D_SAVED;
  check('… the section with row (1) set to it; 1.1, 1.2 and (2) as they were, the row\'s other fields kept',
    same(rows[0], SUM) && rows[0].particular === D_SAVED[0].particular && rows[0].isAutoLinked === true
      && rows.slice(1).every((r, i) => r === D_SAVED[i + 1]), JSON.stringify(rows[0]));
  check('… 1.2 alone (no 1.1 row): row (1) is 1.2', same(H.reclaimed4D1?.([D_SAVED[0], D_SAVED[2]]), heads(2700, 2298.24, 2298.24)));
  const legacy = [{ srNo: '(1)', ...heads(5, 6, 6) }, { srNo: '(2)', ...heads(0, 0, 0) }];
  check('… a section with neither part keeps its row (1)', same(H.reclaimed4D1?.(legacy), heads(5, 6, 6)) && H.with4D1Total?.(legacy) === legacy);
  check('… figures saved as text read as numbers', same(H.reclaimed4D1?.([{ srNo: '1.1', igst: '1.10', cgst: '2', sgst: '2' }, { srNo: '1.2', igst: '0.2', cgst: '', sgst: null }]), heads(1.3, 2, 2)));
});

// ── 2. GSTR-3B summary and JSON ─────────────────────────────────────────────
const ITC = {
  section4A: [
    { srNo: '(1)', ...heads(0, 0, 0) }, { srNo: '(2)', ...heads(0, 0, 0) }, { srNo: '(3)', ...heads(0, 0, 0) }, { srNo: '(4)', ...heads(0, 0, 0) },
    { srNo: '(5)', ...heads(0, 0, 0), isHeader: true },
    { srNo: '5.1', ...heads(2206.1, 34891.27, 34891.27) },
    { srNo: '5.2', ...heads(0, 0, 0) }, { srNo: '5.3', ...heads(0, 0, 0) },
    { srNo: '5.4', ...heads(0, 1402.2, 1402.2) },
    { srNo: '5.5', ...heads(2700, 2298.24, 2298.24) },
  ],
  section4B: [{ srNo: '(1)', ...heads(0, 0, 0) }, { srNo: '(2)', ...heads(0, 0, 0), isHeader: true }],
  section4D: D_SAVED,
};
await run('GSTR-3B', async () => {
  const res = G.buildGstr3bJson({ gstin: '24AAAAA0000A1Z5', periodMonth: '08/2026', gstr1Raw: null, itc: ITC, rcm: { taxable: 0, igst: 0, cgst: 0, sgst: 0 }, alreadyFiled: false });
  const d = res.summary.itcOtherDetails;
  const row = (sr) => d.find((r) => r.srNo === sr);
  check('the GSTR-3B page\'s 4(D)(1) = (1.1) + (1.2)', same(row('(1)'), SUM), show(row('(1)')));
  check('… (1.1) and (1.2) as saved', same(row('(1.1)'), heads(0, 1402.2, 1402.2)) && same(row('(1.2)'), heads(2700, 2298.24, 2298.24)));
  const rclmd = res.json.itc_elg.itc_rclmd;
  check('the JSON uploaded to the portal: itc_rclmd OTH = 1.1 + 1.2, only ty and the three heads',
    rclmd.length === 1 && rclmd[0].ty === 'OTH' && same(rclmd[0], SUM) && Object.keys(rclmd[0]).sort().join(',') === 'cgst,igst,sgst,ty', JSON.stringify(rclmd));
  check('4(C) net ITC is 4A − 4B, untouched by 4(D)', same(res.summary.itcNet, heads(4906.1, 38591.71, 38591.71)), show(res.summary.itcNet));
});

// ── 3. Credit closing (Reports: credit ledger closing) ───────────────────────
await run('credit closing', async () => {
  const gr = { opening_igst: 1000, opening_cgst: 1000, opening_sgst: 1000 };
  const c = A.computeCreditClosing(gr, { ...ITC, section4D: [...D_SAVED.slice(0, 3), { srNo: '(2)', ...heads(50, 50, 50) }] }, null, '08/2026');
  // Opening + Total 4A (whose 5.4 and 5.5 are the reclaims) − 4B; output 0.
  check('closing credit = opening + Total 4A − 4B: no 4(D) row added (the reclaims are in 4A; 4(D)(2) is no credit)',
    Math.abs(c.closingIgst - (1000 + 4906.1)) < 0.005 && Math.abs(c.closingCgst - (1000 + 38591.71)) < 0.005 && Math.abs(c.closingSgst - (1000 + 38591.71)) < 0.005,
    JSON.stringify({ igst: c.closingIgst, cgst: c.closingCgst, sgst: c.closingSgst }));
});

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.info}]`}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
