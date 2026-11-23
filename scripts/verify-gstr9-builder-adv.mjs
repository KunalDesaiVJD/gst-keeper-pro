#!/usr/bin/env node
// Checks the Builder advance roll-forward of GSTR-9C Table 5
// (src/lib/gstr9/builderAdvances.ts and its wiring in engine.ts) on the firm's
// TURNOVER IN 9C sheet layout, on illustrative figures for three years:
//
//   node scripts/verify-gstr9-builder-adv.mjs

import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (rel) => {
  const out = buildSync({ entryPoints: [path.join(root, rel)], bundle: true, format: 'esm', platform: 'node', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const B = await load('src/lib/gstr9/builderAdvances.ts');
const E = await load('src/lib/gstr9/engine.ts');
const D = await load('src/lib/gstr9/defaults.ts');

let failed = 0;
const eq = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.011;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
};
const is = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};

// FY 2022-23: first year of the chain.
const y1 = { ...B.emptyBuilderAdv(), closingAdvance: 41710985.84, revenue: 40400000 };
const r1 = B.rollForward(y1);
eq('22-23 advance received', r1.received, 82110985.84);
eq('22-23 unadjusted at end', r1.unadjustedEnd, 41710985.84);

const y2 = { ...B.emptyBuilderAdv(B.carryForward(y1)), closingAdvance: 68778986, revenue: 68188500 };
const r2 = B.rollForward(y2);
eq('23-24 opening = 22-23 closing', y2.openingAdvance, 41710985.84);
eq('23-24 advance received', r2.received, 95256500.16);
eq('23-24 received to date', r2.receivedToDate, 177367486);
eq('23-24 sales to date', r2.salesToDate, 108588500);
eq('23-24 unadjusted at end', r2.unadjustedEnd, 68778986);

const y3 = {
  ...B.emptyBuilderAdv(B.carryForward(y2)), closingAdvance: 183985.84, revenue: 170440000,
  adjustments: [{ id: 'a', row: 'O', label: 'Advance refunded to a cancelled member', amount: 751000, reason: 'x' }],
};
const r3 = B.rollForward(y3);
eq('24-25 advance received', r3.received, 101844999.84);
eq('24-25 received to date', r3.receivedToDate, 279212485.84);
eq('24-25 sales to date', r3.salesToDate, 279028500);
eq('24-25 unadjusted at end', r3.unadjustedEnd, 183985.84);
eq('24-25 5I', r3.t5.I, 68778986);
eq('24-25 5C', r3.t5.C, 183985.84);
eq('24-25 5O', r3.t5.O, 751000);

// Wired into the engine: 5A from the audit report, 5Q typed as GSTR-9.
const docs = D.emptyDocs();
docs.gstr9c.t5A = 170440000;
docs.gstr9c.t5Q = 102596000.01;
docs.gstr9c.t5.I = 999; // typed values of the rows the roll-forward fills are not used
docs.gstr9c.builderAdv = y3;
const w = E.computeWorkings(docs, { clientName: 'T', gstin: '27AAAAA0000A1Z5', financialYear: '2024-25', noItcBuilder: false });
eq('engine 5I from the roll-forward', w.gstr9c.t5.rows.I, 68778986);
eq('engine 5P', w.gstr9c.t5.P, 102595999.84);
eq('engine 5R (rounding only)', w.gstr9c.t5.R, 0.17);
is('engine exposes the roll-forward', !!w.gstr9c.builderAdv, true);
const off = D.emptyDocs();
off.gstr9c.t5.I = 5;
is('off: typed 5I kept', E.computeWorkings(off, { clientName: 'T', gstin: 'x', financialYear: '2024-25', noItcBuilder: false }).gstr9c.t5.rows.I, 5);

// The one-open-year rule.
const chain = [
  { fy: '2022-23', doc: y1, closed: true, closedHow: 'closed' },
  { fy: '2023-24', doc: y2, closed: true, closedHow: 'locked' },
  { fy: '2024-25', doc: y3, closed: false, closedHow: null },
];
is('open year editable', B.editableReason('2024-25', chain), null);
is('closed year refused', B.editableReason('2023-24', chain) !== null, true);
is('year before open refused', B.editableReason('2025-26', chain) !== null, true);
is('openings carried', B.openingsDiffer(y3, B.carryForward(y2)), false);
is('prevFy', B.prevFy('2025-26'), '2024-25');

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll Builder advance roll-forward checks passed.');
