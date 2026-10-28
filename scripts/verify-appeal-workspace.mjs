#!/usr/bin/env node
// Checks where an appeal stands on the Appeal view (src/lib/appealProgress.ts,
// the firm's request of 28 October 2026): the appeal's own papers and dates,
// its road from the order to the order in appeal, and the next thing to do.
// §33 of docs/NOTICES_LITIGATION_POSITIONS.md.
//
//   node --experimental-strip-types scripts/verify-appeal-workspace.mjs
import assert from 'node:assert/strict';

const A = await import('../src/lib/appealProgress.ts');
const S = await import('../supabase/functions/_shared/appealStage.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const today = '2026-10-28';

// A demand order appealed and admitted, two hearings (one to come), an adjournment, in the appeal's own portal case.
const filed = {
  appeal_key: 'ZD240224038588B', status: 'filed', arn: 'AD240224018334L', filed_on: '2024-02-24', portal_status: 'Appeal Admitted',
  order_ref: 'ZD240224038588B', order_form: 'DRC-07', order_date: '2024-02-19', order_notice_id: 'drc07', last_day: '2024-05-19',
  predeposit: 159004, predeposit_pct: 10, pending_days: 977, drafts: { submission: { version: 2, status: 'draft', at: '2026-10-20T10:00:00Z' } },
};
const items = [
  { kind: 'notice', id: 'drc07', date: '2024-02-19', label: 'DRC-07 · Summary of the demand order', reference: 'ZD240224038588B', own_key: 'AD240823010938Z' },
  { kind: 'notice', id: 'drc01', date: '2023-12-21', label: 'DRC-01 · Show cause notice', reference: 'ZD1', own_key: 'AD240823010938Z' },
  { kind: 'document', id: 'apl01', date: '2024-02-24', label: 'Appeal', reference: null, own_key: 'AD240224018334L', facts: { form: 'APL-01' } },
  { kind: 'notice', id: 'apl02', date: '2024-06-25', label: 'APL-02 · Appeal admitted', reference: 'ZD2406241676463', own_key: 'AD240224018334L' },
  { kind: 'notice', id: 'adj', date: '2026-09-10', label: 'ADJOURNMENT · Adjournment of a hearing', reference: 'ZD9', own_key: 'AD240224018334L' },
];
const dates = [
  { date: '2026-11-12', kind: 'hearing', title: 'Personal hearing at 11:15 AM', detail: 'GANDHINAGAR', tone: 'warn', own_key: 'AD240224018334L', item_id: 'adj', upcoming: true },
  { date: '2026-09-10', kind: 'adjournment', title: 'Adjournment 1 of the 3 the law allows', tone: 'info', own_key: 'AD240224018334L', item_id: 'adj', upcoming: false },
  { date: '2026-08-13', kind: 'hearing', title: 'Personal hearing at 11:15 AM', tone: 'muted', own_key: 'AD240224018334L', item_id: 'h1', upcoming: false },
  { date: '2024-02-24', kind: 'predeposit', title: 'Pre-deposit of ₹1,59,004 paid with the appeal', tone: 'ok', own_key: 'AD240823010938Z', item_id: 'drc07', upcoming: false },
  { date: '2024-02-24', kind: 'appeal_filed', title: 'Appeal filed in time', tone: 'ok', own_key: 'AD240823010938Z', item_id: 'drc07', upcoming: false },
  // The original proceedings' hearing, before the order: not the appeal's.
  { date: '2023-12-01', kind: 'hearing', title: 'Personal hearing', tone: 'muted', own_key: 'AD240823010938Z', item_id: 'drc01', upcoming: false },
  { date: '2023-12-21', kind: 'reply_due', title: 'Reply due', tone: 'danger', own_key: 'AD240823010938Z', item_id: 'drc01', upcoming: false },
];

t('the appeal\'s papers: the order and its own portal case, oldest first; the rest of the case stays on the timeline', () => {
  assert.deepEqual(A.appealPapers(filed, items).map((p) => p.id), ['drc07', 'apl01', 'apl02', 'adj']);
  assert.equal(A.paperForm(items[2]), 'APL-01');
  assert.equal(A.paperForm(items[3]), 'APL-02');
  assert.equal(A.paperForm(items[4]), 'ADJOURNMENT');
});

t('the appeal\'s dates: its hearings and adjournments, and the order\'s dates that bear on it', () => {
  const d = A.appealKeyDates(filed, dates);
  assert.deepEqual(d.map((k) => k.kind), ['predeposit', 'appeal_filed', 'hearing', 'adjournment', 'hearing']);
  assert.ok(!d.some((k) => k.item_id === 'drc01'), 'the original proceedings\' hearing and reply are not the appeal\'s');
});

t('a filed appeal\'s road: order, pre-deposit, filed, admitted, hearing to come, submission in draft, decision to come', () => {
  const phase = S.appealPhase(filed, [filed], today);
  assert.equal(phase, 'filed');
  const steps = A.appealSteps(filed, phase, A.appealPapers(filed, items), A.appealKeyDates(filed, dates), [filed], today);
  assert.deepEqual(steps.map((s) => [s.key, s.state]), [
    ['order', 'done'], ['predeposit', 'done'], ['filed', 'done'], ['admitted', 'done'], ['hearing', 'now'], ['submission', 'now'], ['decided', 'later'],
  ]);
  const h = steps.find((s) => s.key === 'hearing');
  assert.equal(h.date, '2026-11-12');
  assert.match(h.note, /1 adjournment/);
  assert.equal(steps.find((s) => s.key === 'admitted').date, '2024-06-25');
  assert.match(steps.find((s) => s.key === 'decided').note, /s\.107\(13\)/);
});

t('the next step of a filed appeal is the submission before the hearing, then the hearing itself', () => {
  const d = A.appealKeyDates(filed, dates);
  const next = A.appealNext(filed, 'filed', d, today);
  assert.equal(next.due, '2026-11-12');
  assert.match(next.text, /written submission final before the hearing/);
  const final = { ...filed, drafts: { submission: { version: 3, status: 'final', at: '2026-10-27T09:00:00Z' } } };
  assert.match(A.appealNext(final, 'filed', d, today).text, /Attend the hearing/);
  assert.equal(A.appealSteps(final, 'filed', [], d, [final], today).find((s) => s.key === 'submission').state, 'done');
  // No hearing fixed and pending over a year: ask for one (s.107(13)).
  assert.match(A.appealNext(filed, 'filed', [], today).text, /Ask the appellate authority for a hearing date/);
  assert.match(A.appealNext({ ...filed, pending_days: 30 }, 'filed', [], today).text, /Prepare the written submission/);
});

t('an order to appeal: file by the last day with the pre-deposit; late, condoned for a month; then over', () => {
  const toFile = { appeal_key: 'ZD3', status: 'to_file', order_form: 'DRC-07', order_date: '2026-09-01', last_day: '2026-12-01', order_notice_id: 'o3' };
  const steps = A.appealSteps(toFile, 'preparing', [], [], [toFile], today);
  assert.deepEqual(steps.map((s) => [s.key, s.state]), [
    ['order', 'done'], ['predeposit', 'now'], ['filed', 'now'], ['admitted', 'later'], ['hearing', 'later'], ['submission', 'later'], ['decided', 'later'],
  ]);
  assert.equal(steps.find((s) => s.key === 'filed').date, '2026-12-01');
  const next = A.appealNext(toFile, 'preparing', [], today);
  assert.match(next.text, /APL-01\) with the pre-deposit/);
  assert.equal(next.due, '2026-12-01');
  const late = A.appealNext(toFile, 'late', [], '2026-12-10');
  assert.equal(late.due, '2027-01-01');
  assert.match(late.why, /s\.107\(4\)/);
  assert.equal(A.appealSteps(toFile, 'time_over', [], [], [toFile], '2027-02-01').find((s) => s.key === 'filed').state, 'missed');
});

t('a refund order: no pre-deposit step, the rejection on the order, and the next step leaves the pre-deposit out', () => {
  const refund = { appeal_key: 'ZD240826058242D', status: 'to_file', subject: 'refund', order_form: 'RFD-06', order_date: '2026-08-13', last_day: '2026-11-13', refund_rejected: 83673, order_notice_id: 'r6' };
  const steps = A.appealSteps(refund, 'preparing', [], [], [refund], today);
  assert.ok(!steps.some((s) => s.key === 'predeposit'));
  assert.match(steps[0].note, /83,673 rejected/);
  const next = A.appealNext(refund, 'preparing', [], today);
  assert.equal(next.text, 'File the appeal (APL-01) by the last day');
  assert.equal(next.due, '2026-11-13');
});

t('a Tribunal appeal against an APL-04: APL-05, three months condonable, no APL-02 step', () => {
  const trib = { appeal_key: 'ZA9', status: 'to_file', order_form: 'APL-04', order_date: '2026-09-01', last_day: '2026-12-01', forum: 'tribunal' };
  assert.ok(!A.appealSteps(trib, 'preparing', [], [], [trib], today).some((s) => s.key === 'admitted'));
  assert.match(A.appealNext(trib, 'preparing', [], today).text, /APL-05/);
  assert.equal(A.appealNext(trib, 'late', [], '2026-12-05').due, '2027-03-01');
});

t('decided and withdrawn appeals close the road', () => {
  const apl04 = { appeal_key: 'ZA4', status: 'to_file', order_form: 'APL-04', order_date: '2026-10-01' };
  const steps = A.appealSteps(filed, 'decided', [], [], [filed, apl04], today);
  assert.equal(steps.at(-1).state, 'done');
  assert.equal(steps.at(-1).date, '2026-10-01');
  assert.equal(A.appealNext(filed, 'decided', [], today).tone, 'done');
  assert.equal(A.appealSteps(filed, 'withdrawn', [], [], [filed], today).at(-1).label, 'Withdrawn');
});

console.log(`verify-appeal-workspace: ${n} checks passed`);
