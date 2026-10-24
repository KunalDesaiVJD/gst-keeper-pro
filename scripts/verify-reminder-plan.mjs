#!/usr/bin/env node
// Checks the GST data reminder dates (supabase/functions/_shared/reminderPlan.ts),
// which the daily job and the GST Reminders page both use.
//
//   node --experimental-strip-types scripts/verify-reminder-plan.mjs
import assert from 'node:assert/strict';

const P = await import('../supabase/functions/_shared/reminderPlan.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

const standard = [
  { return_type: 'GSTR-1', due_day: 11, reminder_1_day: 5, reminder_2_day: 6, reminder_final_day: 7 },
  { return_type: 'GSTR-1 (IFF)', due_day: 13, reminder_1_day: 5, reminder_2_day: 6, reminder_final_day: 7 },
  { return_type: 'GSTR-3B', due_day: 20, reminder_1_day: 14, reminder_2_day: 16, reminder_final_day: 17 },
  { return_type: 'GSTR-3B (Q)', due_day: 22, due_day_y: 24, reminder_1_day: 14, reminder_2_day: 16, reminder_final_day: 17 },
  { return_type: 'GSTR-7', due_day: 10, reminder_1_day: 6, reminder_2_day: 7, reminder_final_day: 8 },
];
// October 2026 brought forward for Diwali (8 Nov 2026).
const plans = [{
  period_month: '10/2026', return_type: 'GSTR-1', due_date: '2026-11-11', due_date_y: null, data_by_date: '2026-11-03',
  reminder_1_date: '2026-10-28', reminder_2_date: '2026-10-31', reminder_final_date: '2026-11-04', note: 'Diwali',
}];
const none = new Set();

t('standard dates fall in the month after the period', () => {
  const p = P.resolvePlan('10/2026', 'GSTR-3B', standard, plans);
  assert.equal(p.source, 'standard');
  assert.equal(p.dueDate, '2026-11-20');
  assert.deepEqual(p.dates, { 1: '2026-11-14', 2: '2026-11-16', 3: '2026-11-17' });
  assert.equal(p.dataByDate, '2026-11-17');
});

t('December rolls into January', () => {
  const p = P.resolvePlan('12/2026', 'GSTR-1', standard, []);
  assert.equal(p.dueDate, '2027-01-11');
});

t("a period's own plan wins and may send inside the period month", () => {
  const p = P.resolvePlan('10/2026', 'GSTR-1', standard, plans);
  assert.equal(p.source, 'period');
  assert.equal(p.dates[1], '2026-10-28');
  assert.equal(p.dataByDate, '2026-11-03');
  assert.deepEqual(P.stepDueToday(p, '2026-10-27', p.dueDate, none, false), { send: false, reason: 'not_yet' });
  assert.deepEqual(P.stepDueToday(p, '2026-10-28', p.dueDate, none, false), { send: true, step: 1 });
});

t('IFF and 3B (Q) have their own due dates; 3B (Q) by state', () => {
  assert.equal(P.resolvePlan('10/2026', 'GSTR-1 (IFF)', standard, []).dueDate, '2026-11-13');
  const q = P.resolvePlan('12/2026', 'GSTR-3B (Q)', standard, []);
  assert.equal(P.dueDateFor(q, '24AAACV1234F1Z5'), '2027-01-22'); // Gujarat
  assert.equal(P.dueDateFor(q, '07AAACV1234F1Z5'), '2027-01-24'); // Delhi
  assert.equal(P.returnFiledForPeriod('GSTR-3B (Q)', '10/2026'), false);
  assert.equal(P.returnFiledForPeriod('GSTR-3B (Q)', '12/2026'), true);
});

t('a base row stands in when a variant has none', () => {
  const p = P.resolvePlan('10/2026', 'GSTR-1 (IFF)', standard.filter((r) => r.return_type !== 'GSTR-1 (IFF)'), []);
  assert.equal(p.dueDate, '2026-11-11');
});

t('only the latest step whose date has come; missed steps are skipped', () => {
  const p = P.resolvePlan('10/2026', 'GSTR-3B', standard, []);
  // job did not run on the 14th; on the 16th it sends the 2nd reminder, not both
  assert.deepEqual(P.stepDueToday(p, '2026-11-16', p.dueDate, none, false), { send: true, step: 2 });
  assert.deepEqual(P.stepDueToday(p, '2026-11-16', p.dueDate, new Set([2]), false), { send: false, reason: 'already_sent' });
  assert.deepEqual(P.stepDueToday(p, '2026-11-17', p.dueDate, new Set([2]), false), { send: true, step: 3 });
});

t('never two in one day, never after the due date', () => {
  const p = P.resolvePlan('10/2026', 'GSTR-3B', standard, []);
  assert.deepEqual(P.stepDueToday(p, '2026-11-14', p.dueDate, none, true), { send: false, reason: 'sent_today' });
  assert.deepEqual(P.stepDueToday(p, '2026-11-21', p.dueDate, none, false), { send: false, reason: 'past_due' });
  assert.deepEqual(P.stepDueToday(p, '2026-11-20', p.dueDate, new Set([1, 2]), false), { send: true, step: 3 });
});

t('a skipped step (no date) is simply left out', () => {
  const p = P.resolvePlan('10/2026', 'GSTR-1', standard, [{ ...plans[0], reminder_2_date: null }]);
  assert.deepEqual(P.stepDueToday(p, '2026-11-01', p.dueDate, new Set([1]), false), { send: false, reason: 'already_sent' });
  assert.deepEqual(P.stepDueToday(p, '2026-11-04', p.dueDate, new Set([1]), false), { send: true, step: 3 });
});

t('plan checks', () => {
  assert.deepEqual(P.planProblems(plans[0]), []);
  assert.ok(P.planProblems({ ...plans[0], reminder_1_date: '2026-09-30' }).some((s) => s.includes('before the period starts')));
  assert.ok(P.planProblems({ ...plans[0], reminder_final_date: '2026-11-12' }).some((s) => s.includes('after the due date')));
  assert.ok(P.planProblems({ ...plans[0], reminder_2_date: '2026-10-28' }).some((s) => s.includes('must come after')));
  assert.ok(P.planProblems({ ...plans[0], reminder_1_date: null, reminder_2_date: null, reminder_final_date: null }).length > 0);
});

t('standard checks catch the 28 / 28 / 2 row of 24 Oct 2026', () => {
  const bad = { return_type: 'GSTR-1', due_day: 11, reminder_1_day: 28, reminder_2_day: 28, reminder_final_day: 2 };
  assert.ok(P.standardProblems(bad).length >= 2);
  assert.deepEqual(P.standardProblems(standard[0]), []);
});

t('periods and dates', () => {
  assert.equal(P.shiftPeriod('01/2027', -1), '12/2026');
  assert.equal(P.currentReturnPeriod(Date.parse('2026-10-24T13:00:00Z')), '09/2026');
  assert.equal(P.currentReturnPeriod(Date.parse('2026-10-31T19:00:00Z')), '10/2026'); // 1 Nov IST
  assert.equal(P.formatDate('2026-11-20'), '20 Nov 2026');
  assert.equal(P.isoDate(2027, 2, 30), '2027-02-28');
});

console.log(`\n${n} checks passed`);
