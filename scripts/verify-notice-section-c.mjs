#!/usr/bin/env node
// Checks the Notices section C helpers of the law audit of 26 Oct 2026: the
// pay-to-close quote (src/lib/noticePayToClose.ts) and the order checker
// (src/lib/noticeOrderCheck.ts). §36 of docs/NOTICES_LITIGATION_POSITIONS.md.
//
//   node --experimental-strip-types scripts/verify-notice-section-c.mjs
import assert from 'node:assert/strict';

const P = await import('../src/lib/noticePayToClose.ts');
const O = await import('../src/lib/noticeOrderCheck.ts');
const B = await import('../src/lib/reply/partB.ts');
const W = await import('../src/lib/noticeGstr3aWatch.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const demand = (tax, interest, penalty) => ({ cgst: { tax, interest, penalty }, sgst: { tax, interest, penalty } });

t('s.73 SCN within 30 days: no penalty, interest runs on', () => {
  const q = P.payToCloseQuote({ form_code: 'DRC-01', section_of_law: '73', financial_year: '2019-20', issue_date: '2026-10-01', demand: demand(100000, 50000, 10000) }, '2026-10-20', '2026-10-31');
  assert.equal(q.section, '73'); assert.equal(q.penaltyPct, 0); assert.equal(q.payBy, '2026-10-31'); assert.equal(q.closes, true);
  assert.equal(q.rows[0].interest_since, Math.round(100000 * 0.18 * 30 / 365));
  assert.equal(q.total.penalty, 0);
  assert.equal(q.law, 's.73(8)');
});
t('s.73 SCN after 30 days: 10% or ₹10,000 per Act, does not close', () => {
  const q = P.payToCloseQuote({ form_code: 'DRC-01', section_of_law: '73', financial_year: '2019-20', issue_date: '2026-08-01', demand: demand(50000, 0, 5000) }, '2026-10-20');
  assert.equal(q.closes, false); assert.equal(q.rows[0].penalty, 10000);
  assert.ok(q.notes.some((x) => /proposes no interest/.test(x)));
});
t('s.74 SCN: 25% within 30 days, then full', () => {
  const a = P.payToCloseQuote({ form_code: 'DRC-01', section_of_law: '74', financial_year: '2018-19', issue_date: '2026-10-10', demand: demand(16293, 13667, 16293) }, '2026-10-20');
  assert.equal(a.penaltyPct, 25); assert.equal(a.rows[0].penalty, Math.round(16293 * 0.25)); assert.equal(a.law, 's.74(8)');
  const b = P.payToCloseQuote({ form_code: 'DRC-01', section_of_law: '74', financial_year: '2018-19', issue_date: '2026-08-10', demand: demand(16293, 13667, 16293) }, '2026-10-20');
  assert.equal(b.penaltyPct, 100); assert.equal(b.closes, false);
});
t('s.74 DRC-01A: 15%; DRC-07: 50% within 30 days, else as ordered', () => {
  assert.equal(P.payToCloseQuote({ form_code: 'DRC-01A', section_of_law: '74', financial_year: '2018-19', issue_date: '2026-10-10', demand: demand(1000, 0, 0) }, '2026-10-20').penaltyPct, 15);
  const o = P.payToCloseQuote({ form_code: 'DRC-07', section_of_law: '74', financial_year: '2018-19', issue_date: '2026-10-10', demand: demand(1000, 0, 1000) }, '2026-10-20');
  assert.equal(o.penaltyPct, 50); assert.equal(o.law, 's.74(11)'); assert.match(o.howToPay, /liability register/);
  const late = P.payToCloseQuote({ form_code: 'DRC-07', section_of_law: '74', financial_year: '2018-19', issue_date: '2026-06-10', demand: demand(1000, 0, 1000) }, '2026-10-20');
  assert.equal(late.penaltyPct, null); assert.equal(late.rows[0].penalty, 1000);
});
t('s.74A: fraud read from the proposed penalty; 60 days', () => {
  const nf = P.payToCloseQuote({ form_code: 'DRC-01', section_of_law: null, financial_year: '2024-25', issue_date: '2026-09-01', demand: demand(100000, 0, 10000) }, '2026-10-20');
  assert.equal(nf.section, '74A'); assert.equal(nf.fraud, false); assert.equal(nf.penaltyPct, 0); assert.equal(nf.payBy, '2026-10-31');
  const f = P.payToCloseQuote({ form_code: 'DRC-01', section_of_law: '74A', financial_year: '2024-25', issue_date: '2026-09-01', demand: demand(100000, 0, 100000) }, '2026-10-20');
  assert.equal(f.fraud, true); assert.equal(f.penaltyPct, 25); assert.equal(f.law, 's.74A(10)');
});
t('no quote for other forms, no section or no tax', () => {
  assert.equal(P.payToCloseQuote({ form_code: 'ASMT-10', section_of_law: '61', financial_year: '2020-21', issue_date: '2026-10-01', demand: demand(1, 0, 0) }), null);
  assert.equal(P.payToCloseQuote({ form_code: 'DRC-01', section_of_law: null, financial_year: '2019-20', issue_date: '2026-10-01', demand: demand(1, 0, 0) }), null);
  assert.equal(P.payToCloseQuote({ form_code: 'DRC-07', section_of_law: '74', financial_year: '2019-20', issue_date: '2026-10-01', demand: demand(0, 0, 7463) }), null);
});

const paper = (o) => ({ form_code: 'DRC-01', section_of_law: '73', financial_year: '2018-19', period_from: '2018-04-01', period_to: '2019-03-31', issue_date: '2023-09-29', reference_number: 'ZD1', demand: demand(100000, 0, 10000), hearing_date: null, ...o });
const raw = { refid: 'ZD2', sdtls: { dtorder: { ntcno: 'ZD1', ntcdt: '29/09/2023' } }, todtls: { signty: 'DSC' } };
t('order check: a clean order passes', () => {
  const c = O.checkOrder({ order: { ...paper({ form_code: 'DRC-07', issue_date: '2024-04-20', reference_number: 'ZD2' }), raw }, scn: paper({ hearing_date: '2023-11-01' }), hearings: [],
    limitation: { fy: '2018-19', s73_order_by: '2024-04-30', s74_order_by: '2026-02-05' } });
  assert.deepEqual(c.filter((x) => x.status !== 'ok').map((x) => x.key), []);
  assert.equal(O.groundsText(c), '');
});
t('order check: section, amount, penalty, limitation and hearing become grounds', () => {
  const c = O.checkOrder({
    order: { ...paper({ form_code: 'DRC-07', section_of_law: '74', issue_date: '2026-03-01', reference_number: 'ZD2', demand: demand(150000, 0, 200000), period_to: '2019-06-30' }), raw },
    scn: paper({}), hearings: ['2026-05-01'], limitation: { fy: '2018-19', s73_order_by: '2024-04-30', s74_order_by: '2026-02-05' } });
  const bad = c.filter((x) => x.status === 'issue').map((x) => x.key);
  assert.deepEqual(bad, ['section', 'period', 'amount', 'penalty', 'limitation', 'hearing']);
  const g = O.groundsText(c);
  assert.match(g, /^1\. /); assert.match(g, /section 75\(7\)/); assert.match(g, /75\(4\)/); assert.match(g, /75\(10\)/);
});
t('order check: s.74 down to s.73 is allowed; a manual order with no DIN is to check', () => {
  const c = O.checkOrder({ order: paper({ form_code: 'DRC-07', section_of_law: '73', issue_date: '2024-01-01', manual: true }), scn: paper({ section_of_law: '74', hearing_date: '2023-12-01' }), hearings: [], limitation: null });
  assert.equal(c.find((x) => x.key === 'section').status, 'ok');
  assert.equal(c.find((x) => x.key === 'din').status, 'check');
});
t('order check: s.74A order beyond 12 and 18 months', () => {
  const base = { scn: paper({ section_of_law: '74A', financial_year: '2024-25', issue_date: '2026-01-10', hearing_date: '2026-02-01' }), hearings: [], limitation: null };
  assert.equal(O.checkOrder({ ...base, order: paper({ form_code: 'DRC-07', section_of_law: '74A', financial_year: '2024-25', issue_date: '2027-03-01' }) }).find((x) => x.key === 'limitation').status, 'check');
  assert.equal(O.checkOrder({ ...base, order: paper({ form_code: 'DRC-07', section_of_law: '74A', financial_year: '2024-25', issue_date: '2027-08-01' }) }).find((x) => x.key === 'limitation').status, 'issue');
});
t('Part B: the placeholder reasons become the annexure items', () => {
  const body = '3. The difference arises as follows:\n(a) [reason for the difference, such as tax on supplies]: Rs. [amount]\n(b) [further reason, if any]: Rs. [amount]\n\n4. Next';
  const summary = { lines: [
    { label: 'Difference (GSTR-1 − GSTR-3B)', values: { igst: 500 } },
    { label: 'Settled in another month of the FY (timing)', values: { cgst: 300, sgst: 300 }, kind: 'reconciling' },
    { label: 'DRC-03 paid for this difference', values: { igst: 0 }, kind: 'reconciling' },
  ] };
  const out = B.fillPartB(body, summary, 'DRC-01B');
  assert.match(out, /^\(a\) Tax on supplies reported in FORM GSTR 1 .*: Rs\. 600 \(CGST Rs\. 300, SGST Rs\. 300\)$/m);
  assert.doesNotMatch(out, /\[further reason/); assert.match(out, /\n\n4\. Next$/);
  assert.equal(B.fillPartB('no placeholders', summary, 'DRC-01B'), null);
  assert.equal(B.fillPartB(body, { lines: [] }, 'DRC-01B'), null);
});
t('GSTR-3A watch: period, 15 days, ASMT-13 and filed returns', () => {
  assert.equal(W.gstr3aPeriod('2026-01-25'), '12/2025');
  const notices = [{ id: 'a', client_id: 'c1', issue_date: '2026-09-25', reference_number: null }, { id: 'b', client_id: 'c2', issue_date: '2026-09-25', reference_number: null },
    { id: 'c', client_id: 'c3', issue_date: '2026-08-23', reference_number: null }, { id: 'd', client_id: 'c4', issue_date: '2026-09-25', reference_number: null }];
  const filings = [
    { client_id: 'c1', period_month: '08/2026', return_type: 'GSTR-3B', status: 'Pushed' },
    { client_id: 'c2', period_month: '08/2026', return_type: 'GSTR-3B', status: 'Filed' },
    { client_id: 'c3', period_month: '07/2026', return_type: 'GSTR-3B', status: 'Prepared Pending' },
    { client_id: 'c4', period_month: '08/2026', return_type: 'GSTR-1', status: 'Data Pending' },
  ];
  const rows = W.gstr3aWatch(notices, filings, [{ id: 'x', client_id: 'c3', issue_date: '2026-09-20' }], '2026-10-05');
  assert.deepEqual(rows.map((r) => [r.notice.id, r.state, r.date]), [['c', 'asmt13_issued', '2026-11-19'], ['a', 'within_15', '2026-10-10'], ['d', 'within_15', '2026-10-10']]);
  assert.equal(W.gstr3aWatch(notices, filings, [], '2026-10-11').find((r) => r.notice.id === 'a').state, 'asmt13_can_issue');
});
console.log(`\n${n} checks passed`);
