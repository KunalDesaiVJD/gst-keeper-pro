#!/usr/bin/env node
// Checks the rules' reading of remarks and Apply / Undo (src/lib/gstr9/remarkEffects.ts, §10 of
// docs/GSTR9_9C_WORKINGS.md). Run: node --experimental-strip-types scripts/verify-remark-effects.mjs
import assert from 'node:assert/strict';
const m = await import('../src/lib/gstr9/remarkEffects.ts');

const line = (key, diff, o = {}) => ({ key, label: key, step: 'duties', diff: { t: 0, i: 0, c: 0, s: 0, x: 0, ...diff }, hasTax: true, hasTaxable: false, ...o });
const fy = '2025-26';
const kind = (l, r) => m.suggestFromRules(l, r, fy).kind;

// ITC of this FY availed / reversed in next FY.
assert.equal(kind(line('dti.03', { c: 900, s: 900 }), 'Invoice booked in March, ITC claimed in GSTR-3B of April 2026'), 'next_fy_t13');
assert.equal(kind(line('itc.books', { i: 500 }), 'Claimed in May-26 3B'), 'next_fy_t13');
assert.equal(kind(line('itc.books', { i: 500 }), 'ITC reversed in next FY return'), 'next_fy_t12');
// Outward of this FY declared / reduced in next FY.
assert.equal(kind(line('dto.03', { c: 90, s: 90 }), 'Invoice of 31 Mar declared in GSTR-1 of 04/2026'), 'next_fy_t10');
assert.equal(kind(line('out.b2b', { t: 1000, i: 180 }, { hasTaxable: true }), 'Credit note issued in FY 2026-27'), 'next_fy_t11');
// Previous FY ITC, DRC-03, timing.
assert.equal(kind(line('dti.04', { c: -50, s: -50 }), 'ITC of last year claimed this year'), 'prev_fy_itc');
assert.equal(kind(line('dto.05', { c: 50, s: 50 }), 'Short paid, paid via DRC-03'), 'pay_drc03');
assert.equal(kind(line('dto.05', { c: 50, s: 50 }), 'Booked in May 2025, shown in June 2025 3B'), 'timing');
assert.equal(kind(line('dto.05', { c: 50, s: 50 }), 'Rounding'), 'no_effect');

// Amounts: the difference, absolute; SGST = CGST; a named amount spread over the heads.
const d = m.suggestFromRules(line('dti.03', { c: -900, s: -900 }), 'claimed in April 2026', fy);
assert.deepEqual(d.amount, { t: 0, i: 0, c: 900, s: 900, x: 0 });
const s = m.suggestFromRules(line('dti.03', { c: 900, s: 900 }), 'Rs. 1,000 claimed in April 2026', fy);
assert.deepEqual(s.amount, { t: 0, i: 0, c: 500, s: 500, x: 0 });

// Apply then Undo leaves the doc as it was (Table 13 typed; Table 12 on its computed figure).
const doc = { t10: { t: 0, i: 0, c: 0, s: 0, x: 0 }, t11: { t: 0, i: 0, c: 0, s: 0, x: 0 }, t12: null, t13: { i: 10, c: 0, s: null, x: 0 } };
const amt = { t: 0, i: 5, c: 3, s: 3, x: 0 };
const on = m.writeEffect(doc, 't13', amt, 1, { i: 0, c: 0, s: 0, x: 0 });
assert.deepEqual(on.t13, { i: 15, c: 3, s: null, x: 0 });
assert.deepEqual(m.writeEffect(on, 't13', amt, -1, { i: 0, c: 0, s: 0, x: 0 }).t13, { i: 10, c: 0, s: null, x: 0 });
const t12 = m.writeEffect(doc, 't12', amt, 1, { i: 100, c: 0, s: 0, x: 0 }).t12;
assert.deepEqual(t12, { i: 105, c: 3, s: null, x: 0 });
const t10 = m.writeEffect(doc, 't10', { t: 1000, i: 0, c: 90, s: 90, x: 0 }, 1, { i: 0, c: 0, s: 0, x: 0 }).t10;
assert.deepEqual(t10, { t: 1000, i: 0, c: 90, s: 90, x: 0 });

// Next FY: only applied next-FY effects carry.
const eff = (kind, status) => ({ kind, status, amount: { t: 0, i: 5, c: 0, s: 0, x: 0 }, remark: 'r', summary: '', thisFy: '', nextFy: null, source: 'rules', confidence: 'low', suggestedAt: '' });
const carried = m.carriedEffects({ lines: {
  a: { text: 'claimed Apr 26', effect: eff('next_fy_t13', 'applied') },
  b: { text: 'x', effect: eff('next_fy_t12', 'suggested') },
  c: { text: 'y', effect: eff('timing', 'applied') },
} }, [{ key: 'a', label: 'Input tax Mar' }]);
assert.equal(carried.length, 1);
assert.equal(carried[0].lineLabel, 'Input tax Mar');
assert.equal(m.carriedFor('dti.04', carried).length, 1);
assert.equal(m.carriedFor('dto.04', carried).length, 0);
assert.match(m.carriedReason(carried, '2025-26'), /6A1/);
console.log('verify-remark-effects: ok');
