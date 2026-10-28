// notice-appeal-ai: the material as the model reads it, and one run begun and finished.
import { assertEquals, assertStringIncludes } from '@std/assert';
import { appealDates, appealUserText, beginAppeal, mapAppealOutput, type AppealDeps } from '../appeal.ts';
import { FakeDb, FakeNet, jsonReply, type J } from '../../notice-ai/test/fake.ts';

// ── The Appeal workspace (statement of facts, grounds, written submission) ──

const appealContext = {
  doc_type: 'grounds', mode: 'draft', instructions: 'Lead with limitation.',
  case: { client: 'Shree Buildcon', gstin: '24AAAAA0000A1Z5', forms: ['DRC-01', 'DRC-07'], today: '2026-10-25' },
  appeal: { status: 'filed', arn: 'AD241023006773K', order_ref: 'ZD2408230012305', order_form: 'DRC-07', order_date: '2023-08-01', disputed_tax: 150870, predeposit: 15088, predeposit_pct: 10, issues: ['Wrong demand of tax'] },
  order: { form_code: 'DRC-07', reference: 'ZD2408230012305', reading: 'Excess ITC of Rs. 1,50,870 over GSTR 2A disallowed.', documents: [{ title: 'DRC 07', paragraphs: [{ kind: 'finding', para: '4', text: 'The supplier was cancelled.' }] }] },
  documents: [{ title: 'Purchase invoices', role: 'reply_support', date: '2023-06-01', evidence: 'invoices', summary: 'Invoices of the supplier.' }],
  drafts: { facts: { version: 2, status: 'draft', body: 'The appellant is a builder.' } },
  precedents: [
    { id: 'p-1', kind: 'filed_appeal', same_client: false, title: 'Appeal on cancelled supplier ITC', paragraphs: [{ kind: 'ground', text: 'ITC cannot be denied to a bona fide buyer.' }] },
    { id: 'p-2', kind: 'final_grounds', same_client: true, title: 'Grounds of appeal against ZD1', body: 'That the order is time barred.' },
  ],
};

Deno.test('appeal: the material as read, precedents labelled, the other drafts carried', () => {
  const { text, labels } = appealUserText(appealContext);
  assertStringIncludes(text, 'The document: Grounds of appeal');
  assertStringIncludes(text, 'filed as AD241023006773K');
  assertStringIncludes(text, 'pre deposit Rs. 15,088 (10%)');
  assertStringIncludes(text, 'finding 4: The supplier was cancelled.');
  assertStringIncludes(text, 'evidence: invoices');
  assertStringIncludes(text, "The appeal's statement of facts (version 2, draft)");
  assertStringIncludes(text, 'P1 (an appeal the firm filed; another client)');
  assertStringIncludes(text, 'P2 (a final grounds draft of another appeal; the same client, another case)');
  assertStringIncludes(text, "The staff member's instructions for this document: Lead with limitation.");
  assertEquals(labels.get('P2'), 'p-2');
  const out = mapAppealOutput({ title: 'Grounds of appeal', sections: [{ heading: 'Ground 1', text: 'That ...', precedents_used: ['P1', 'P9'] }, { heading: 'x', text: '' }], prayer: 'Set aside.', client_questions: [], cautions: ['Late'], precedents_used: ['p2'] }, labels);
  assertEquals((out.sections as J[]).length, 1);
  assertEquals((out.sections as J[])[0].precedents_used, ['p-1']);
  assertEquals(out.precedents_used, ['p-2']);
});

Deno.test('appeal: begin, draft in the background, finish; a refusal and a bad request say so', async () => {
  const db = new FakeDb({
    notice_appeal_ai_begin: () => ({ run_id: 'ar1', settings: { model: 'claude-opus-5-5', effort: 'high' }, context: { ...appealContext, doc_type: 'submission' } }),
    notice_appeal_ai_finish: (a) => ({ id: a.p_run_id, status: a.p_status, output: a.p_output }),
  });
  const net = new FakeNet({}, () => jsonReply({ title: 'Written submission', sections: [{ heading: 'Ground 1', text: 'The appellant submits.', precedents_used: ['P1'] }], prayer: 'Set aside the order.', client_questions: [], cautions: [], precedents_used: [] }, { input_tokens: 30000, output_tokens: 9000 }));
  const deps: AppealDeps = { db, claude: net.client() };
  const r = await beginAppeal(deps, { client_id: '00000000-0000-0000-0000-0000000000c1', case_key: 'AD1', appeal_key: 'ZD2408230012305', doc_type: 'submission', actor: 'Staff' });
  assertEquals(r.run_id, 'ar1');
  const done = await r.done!;
  assertEquals(done.status, 'done');
  const fin = db.called('notice_appeal_ai_finish')[0].args;
  assertEquals(fin.p_output.sections[0].precedents_used, ['p-1']);
  assertEquals(db.called('notice_appeal_ai_begin')[0].args.p_mode, 'draft');
  const req = net.claude[0].body;
  assertEquals(req.max_tokens, 48000, 'a submission gets more room');
  assertStringIncludes(req.system, 'No hyphen or dash');
  assertStringIncludes(req.system, 'never carry their names, GSTINs');

  const refused = await beginAppeal({ ...deps, db: new FakeDb({ notice_appeal_ai_begin: () => ({ error: 'no_consent' }) }) },
    { client_id: '00000000-0000-0000-0000-0000000000c1', case_key: 'AD1', appeal_key: 'ZD1', doc_type: 'facts' });
  assertEquals(refused.error, 'no_consent');
  assertEquals((await beginAppeal(deps, { client_id: 'x', case_key: 'AD1', appeal_key: 'ZD1', doc_type: 'facts' })).error, 'bad_request');
  assertEquals((await beginAppeal(deps, { client_id: '00000000-0000-0000-0000-0000000000c1', case_key: 'AD1', appeal_key: 'ZD1', doc_type: 'memo' })).error, 'bad_request');
});

Deno.test('appeal: only what can still be drafted at the appeal\'s stage', async () => {
  const { appealDocState, appealPhase } = await import('../../_shared/appealStage.ts');
  const filed = { appeal_key: 'ZD1', status: 'filed', portal_status: 'Reply Submitted', filed_on: '2024-01-09' };
  assertEquals(appealPhase(filed), 'filed');
  assertEquals(appealDocState('facts', 'filed').open, false);
  assertEquals(appealDocState('grounds', 'filed').open, false);
  assertEquals(appealDocState('submission', 'filed').open, true);
  assertEquals(appealPhase({ ...filed, portal_status: 'Appeal Withdrawn' }), 'withdrawn');
  assertEquals(appealPhase(filed, [filed, { appeal_key: 'ZA9', status: 'to_file', order_form: 'APL-04', order_date: '2025-03-01' }]), 'decided');
  assertEquals(appealDocState('submission', 'decided').open, false);
  const toFile = { appeal_key: 'ZD2', status: 'to_file', last_day: '2026-10-01' };
  assertEquals(appealPhase(toFile, [], '2026-09-30'), 'preparing');
  assertEquals(appealPhase(toFile, [], '2026-10-20'), 'late');
  assertEquals(appealDocState('facts', 'late').open, true);
  assertEquals(appealPhase(toFile, [], '2026-11-02'), 'time_over');

  // The function refuses a filed appeal's grounds before it begins a run, and drafts its submission.
  const db = new FakeDb({
    notice_case_appeals: () => [filed],
    notice_appeal_ai_begin: () => ({ run_id: 'ar2', settings: {}, context: { ...appealContext, doc_type: 'submission' } }),
    notice_appeal_ai_finish: (a) => ({ id: a.p_run_id, status: a.p_status }),
  });
  const deps: AppealDeps = { db, claude: null };
  const id = '00000000-0000-0000-0000-0000000000c1';
  assertEquals((await beginAppeal(deps, { client_id: id, case_key: 'AD1', appeal_key: 'zd1', doc_type: 'grounds' })).error, 'doc_closed');
  assertEquals(db.called('notice_appeal_ai_begin').length, 0);
  const ok = await beginAppeal(deps, { client_id: id, case_key: 'AD1', appeal_key: 'ZD1', doc_type: 'submission' });
  assertEquals(ok.run_id, 'ar2');
  await ok.done;
  assertStringIncludes(appealUserText({ ...appealContext, doc_type: 'submission' }).text, 'Argue those grounds');
});

Deno.test('appeal: a refund order is argued as a refund; the hearings and the order\'s checks are carried', async () => {
  const refund = {
    ...appealContext, doc_type: 'submission',
    appeal: { status: 'filed', arn: 'AD2409260000001', subject: 'refund', order_ref: 'ZD240826058242D', order_form: 'RFD-06', order_date: '2026-08-13', refund_claimed: 3255100, refund_rejected: 83673 },
  };
  const deps: AppealDeps = {
    claude: null,
    db: new FakeDb({
      notice_case_key_dates: () => [
        { date: '2026-11-20', kind: 'hearing', title: 'Personal hearing at 11:15 AM', detail: 'AHMEDABAD', own_key: 'AD2409260000001', upcoming: true },
        { date: '2026-11-05', kind: 'adjournment', title: 'Adjournment 1 of the 3 the law allows', own_key: 'AD2409260000001', upcoming: false },
        { date: '2026-09-01', kind: 'hearing', title: 'Personal hearing in another case', own_key: 'AD999', upcoming: false },
        { date: '2026-08-13', kind: 'order_check', ground: true, law: 's.75(4)', title: 'No personal hearing on record before this order', detail: 'Check the papers.', item_id: 'o-1' },
      ],
    }),
  };
  const dates = await appealDates(deps, 'c1', 'AA2407261761073', { appeal_key: 'ZD240826058242D', status: 'filed', arn: 'AD2409260000001', order_notice_id: 'o-1' } as never);
  assertEquals(dates.hearings.map((h) => h.date), ['2026-11-05', '2026-11-20'], 'the appeal\'s own, oldest first');
  assertEquals(dates.order_checks.length, 1);
  const { text } = appealUserText({ ...refund, ...dates });
  assertStringIncludes(text, 'appeal against a refund order');
  assertStringIncludes(text, 'refund rejected by the order Rs. 83,673');
  assertStringIncludes(text, 'each reason of rejection cannot stand');
  assertStringIncludes(text, 'section 107(6)');
  assertStringIncludes(text, 'The written submission is for the hearing on 2026-11-20');
  assertStringIncludes(text, 's.75(4): No personal hearing on record before this order');
  // A demand keeps its own brief, and a failed read of the dates leaves the drafts without them.
  assertStringIncludes(appealUserText(appealContext).text, 'natural justice');
  const broken: AppealDeps = { claude: null, db: { rpc: () => Promise.reject(new Error('down')) } };
  assertEquals(await appealDates(broken, 'c1', 'AA1', { appeal_key: 'ZD1', status: 'filed' }), { hearings: [], order_checks: [] });
});
