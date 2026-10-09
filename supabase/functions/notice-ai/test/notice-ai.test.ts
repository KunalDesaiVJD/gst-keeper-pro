// notice-ai without the real API or database:
//   deno test --allow-read --allow-env supabase/functions/notice-ai/test/
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { buildParams, callClaude, FALLBACK_BETA } from '../claude.ts';
import { buildDocResult, type DocumentClaim } from '../documents.ts';
import { assistUserText, mapAssistOutput, runAssist } from '../assist.ts';
import { readDocumentJob, runTick, type Deps } from '../runner.ts';
import { cliModel, cliWithApiForScans, jsonFromText } from '../cli.ts';
import { documentUrlAllowed } from '../pdf.ts';
import {
  buildPdf, FakeDb, FakeNet, GATEWAY, ISSUE_CODES, jsonReply, replyPages, replyReading, storageUrl, SUPA, type J,
} from './fake.ts';

const docClaim = (over: Partial<DocumentClaim> = {}): DocumentClaim => ({
  kind: 'document', document_id: '00000000-0000-0000-0000-0000000000d1', client_id: 'c1', notice_id: '00000000-0000-0000-0000-0000000000a1',
  case_id: 'AD-CASE-1', source: 'folder', role: 'reply', folder_section: 'REPLY', document_url: storageUrl('reply.pdf'),
  document_label: 'REPLY.pdf', body: null, context: { reply_reason: 'Reply to ASMT 10 with reconciliation' },
  form_code: 'ASMT-10', reference_number: 'ZD-ASMT-1', issue_date: '2025-04-01', financial_year: '2019-20', attempt: 1,
  model: 'claude-opus-5-5', effort: 'low', max_pages: 40, issue_codes: ISSUE_CODES,
  case_paragraphs: [{
    notice_id: '00000000-0000-0000-0000-0000000000a1', notice_ref: 'ZD-ASMT-1', form_code: 'ASMT-10', seq: 1, para: '2',
    issue_code: 'ITC_2A_V_3B', title: 'Excess ITC over GSTR 2A',
    text: 'Para 2. On scrutiny it is seen that ITC availed in GSTR 3B exceeds GSTR 2A by Rs. 1,20,000.',
  }],
  ...over,
});

Deno.test('the request: structured output, adaptive thinking, effort, the server fallback', () => {
  const p = buildParams({ model: 'claude-opus-5-5', effort: 'low', system: 'S', content: [{ type: 'text', text: 'x' }], schema: { type: 'object' } }, 64000);
  assertEquals(p.thinking, { type: 'adaptive' });
  assertEquals((p.output_config as J).effort, 'low');
  assertEquals((p.output_config as J).format.type, 'json_schema');
  assertEquals(p.betas, [FALLBACK_BETA]);
  assertEquals((p as J).fallbacks, 'default');
  const q = buildParams({ model: 'claude-other', effort: 'nonsense', system: 'S', content: [], schema: {} }, 64000);
  assertEquals(q.betas, undefined);
  assertEquals((q.output_config as J).effort, 'high');
  const h = buildParams({ model: 'claude-haiku-4-5', effort: 'high', system: 'S', content: [], schema: {} }, 128000);
  assertEquals([h.thinking, (h.output_config as J).effort, h.max_tokens], [undefined, undefined, 64000], 'Haiku: no effort, no thinking, 64K');
});

Deno.test('a call: the JSON, its usage, and a cut-off answer asked again with the whole budget', async () => {
  const net = new FakeNet({}, (_r, n) => n === 1 ? { text: '{"a":', stop_reason: 'max_tokens', usage: { input_tokens: 100, output_tokens: 64000 } } : jsonReply({ a: 1 }, { input_tokens: 100, output_tokens: 50 }));
  const out = await callClaude(net.raw(), { model: 'claude-opus-5-5', effort: 'high', system: 'S', content: [{ type: 'text', text: 'x' }], schema: { type: 'object' } });
  assert(out.ok);
  if (out.ok) {
    assertEquals(out.json, { a: 1 });
    assertEquals(out.usage.input_tokens, 200);
    assertEquals(out.usage.output_tokens, 64050);
    assertEquals(out.usage.calls, 2);
  }
  assertEquals(net.claude.map((s) => s.body.max_tokens), [64000, 128000]);
});

Deno.test('a call: a refusal fails, a refused key pauses', async () => {
  const refused = await callClaude(new FakeNet({}, () => ({ text: '', stop_reason: 'refusal', stop_details: { category: 'cyber' } })).raw(),
    { model: 'claude-opus-5-5', effort: 'high', system: 'S', content: [], schema: {} });
  assert(!refused.ok && refused.status === 'failed' && refused.reason === 'refused');
  const key = await callClaude(new FakeNet({}, () => ({ status: 401, errorType: 'authentication_error' })).raw(),
    { model: 'claude-opus-5-5', effort: 'high', system: 'S', content: [], schema: {} });
  assert(!key.ok && key.pause === 'api_key' && key.status === 'retry');
});

Deno.test('documents come only from the project\'s own storage', () => {
  assert(documentUrlAllowed(storageUrl('a.pdf'), SUPA));
  assert(!documentUrlAllowed('https://evil.example/storage/v1/object/public/a.pdf', SUPA));
  assert(!documentUrlAllowed(`${SUPA}/rest/v1/clients`, SUPA));
  assert(!documentUrlAllowed(storageUrl('a.pdf').replace('https:', 'http:'), SUPA));
});

Deno.test('a document\'s overview: dates checked, amounts as digits, the year as 2019-20, nothing guessed', () => {
  const r = buildDocResult(replyReading, { pages: [], pageCount: 1, textLayer: false, sha256: null }, docClaim(), 'm');
  assertEquals(r.overview.section_of_law, 'Section 73(1)');
  assertEquals(r.overview.financial_year, '2019-20');
  assertEquals(r.overview.reply_due, '', 'a date not as YYYY-MM-DD is dropped');
  assertEquals(r.overview.demand_tax, '120000', 'rupee signs and commas go');
  assertEquals(r.overview.demand_penalty, '', '"nil" is not an amount');
  assertEquals(r.overview.period_to, '2020-03-31');
  const none = buildDocResult({ doc_kind: 'notice' }, { pages: [], pageCount: 1, textLayer: false, sha256: null }, docClaim(), 'm');
  assertEquals(Object.values(none.overview).every((v) => v === ''), true, 'no overview: every fact empty');
});

Deno.test('a reply\'s reading: pairs from its answers, checked against the PDF\'s text', () => {
  const pages = [replyPages[0].join('\n')];
  const r = buildDocResult(replyReading, { pages, pageCount: 1, textLayer: true, sha256: 'abc' }, docClaim(), 'claude-opus-5-5');
  assertEquals(r.doc_kind, 'reply');
  assertEquals(r.doc_date, '2025-04-20');
  assertEquals(r.paragraphs.length, 3);
  assertEquals(r.pairs.length, 2, 'the prayer answers nothing: no pair');
  assertEquals(r.pairs[0].allegation, 'Para 2. On scrutiny it is seen that ITC availed in GSTR 3B exceeds GSTR 2A by Rs. 1,20,000.');
  assertEquals(r.pairs[0].notice_id, '00000000-0000-0000-0000-0000000000a1');
  assertEquals(r.pairs[0].seq, 1);
  assertEquals(r.pairs[0].verified, true);
  assertEquals(r.pairs[1].allegation, 'Interest under section 50 on the excess credit.', 'restated in the reply itself');
  assertEquals(r.pairs[1].issue_code, 'INTEREST_50');
  assertEquals(r.paragraphs[2].quote_ok, false, 'a quote not in the PDF does not check');
  const scan = buildDocResult(replyReading, { pages: [], pageCount: 1, textLayer: false, sha256: 'abc' }, docClaim(), 'm');
  assertEquals(scan.pairs.every((p) => !p.verified), true, 'a scan\'s pairs are kept unchecked');
  const draft = buildDocResult(replyReading, { pages: [], pageCount: null, textLayer: false, sha256: null }, docClaim({ source: 'draft', document_url: null }), 'm');
  assertEquals(draft.pairs.every((p) => p.verified), true, 'the firm\'s own approved text counts as checked');
  const junk = buildDocResult({ doc_kind: 'Memo', outcome: 'won', paragraphs: [{ kind: 'x', text: 'A', issue_code: 'NOPE' }] },
    { pages: [], pageCount: 1, textLayer: false, sha256: null }, docClaim({ role: 'order' }), 'm');
  assertEquals([junk.doc_kind, junk.outcome, junk.paragraphs[0].kind, junk.paragraphs[0].issue_code], ['other', '', 'other', 'OTHER']);
});

Deno.test('reading a reply PDF: downloaded, hashed, read with the case\'s paragraphs', async () => {
  const pdf = await buildPdf(replyPages);
  const net = new FakeNet({ 'reply.pdf': pdf }, () => jsonReply(replyReading));
  const db = new FakeDb({ ai_document_hash: () => ({ duplicate: false }) });
  const deps: Deps = { db, claude: net.client(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch };
  const f = await readDocumentJob(deps, docClaim(), new AbortController().signal);
  assertEquals(f.status, 'done');
  const r = f.result as J;
  assertEquals(r.text_layer, true);
  assertEquals(r.pairs.length, 2);
  assertEquals(r.pairs[0].verified, true);
  assertEquals(db.called('ai_document_hash')[0].args.p_sha256.length, 64);
  const req = net.claude[0].body;
  assertEquals(req.output_config.effort, 'low');
  assertEquals(req.messages[0].content[0].type, 'document');
  const text = req.messages[0].content[1].text as string;
  assertStringIncludes(text, 'P1 [ASMT-10 · ZD-ASMT-1 · para 2 · Excess ITC over GSTR 2A]: Para 2. On scrutiny');
  assertStringIncludes(text, 'Reply to ASMT 10 with reconciliation');
  assert(!text.includes('Learning Textiles'), 'nothing about the client beyond the document');
});

Deno.test('a duplicate is not sent; a draft is sent as text', async () => {
  const pdf = await buildPdf(replyPages);
  const net = new FakeNet({ 'reply.pdf': pdf }, () => jsonReply(replyReading));
  const db = new FakeDb({ ai_document_hash: () => ({ duplicate: true }) });
  const deps: Deps = { db, claude: net.client(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch };
  const dup = await readDocumentJob(deps, docClaim(), new AbortController().signal);
  assertEquals([dup.status, dup.reason], ['skipped', 'duplicate']);
  assertEquals(net.claude.length, 0);
  const draft = await readDocumentJob(deps, docClaim({ source: 'draft', document_url: null, body: 'Para 2. The credit is reconciled.' }), new AbortController().signal);
  assertEquals(draft.status, 'done');
  assertEquals(net.claude[0].body.messages[0].content[0].text, 'The document (text):\n\nPara 2. The credit is reconciled.');
  assertEquals(net.downloads.length, 1, 'a draft downloads nothing');
});

Deno.test('one run: the lease, the queue refresh, a notice then a document, the lease back', async () => {
  const notice = await buildPdf([[
    'FORM GST ASMT-10', 'Reference No.: ZD-ASMT-1    Date: 01/04/2025', 'GSTIN: 24AAAAA0000A1Z5',
    'Para 2. On scrutiny it is seen that ITC availed in GSTR 3B exceeds GSTR 2A by Rs. 1,20,000.',
  ]]);
  const reply = await buildPdf(replyPages);
  const field = (value: string, quote: string) => ({ value, page: 1, quote });
  const none = { value: '', page: 0, quote: '' };
  const zero = { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 };
  const reading = {
    gstin: field('24AAAAA0000A1Z5', 'GSTIN: 24AAAAA0000A1Z5'), form_code: field('FORM GST ASMT-10', 'FORM GST ASMT-10'),
    reference_number: field('ZD-ASMT-1', 'Reference No.: ZD-ASMT-1'), din: none, issue_date: field('2025-04-01', 'Date: 01/04/2025'),
    section_of_law: none, financial_year: none, period_from: none, period_to: none, due_date: none, hearing_date: none,
    hearing_time: none, hearing_venue: none, officer: none,
    demand: { stated: false, igst: zero, cgst: zero, sgst: zero, cess: zero, page: 0, quote: '' },
    issues: [{
      issue_code: 'ITC_2A_V_3B', title: 'Excess ITC over GSTR 2A', detail: 'ITC in 3B exceeds 2A.', period_from: '', period_to: '',
      demand: { igst: zero, cgst: zero, sgst: zero, cess: zero }, amount: 120000, page: 1, para: '2',
      quote: 'ITC availed in GSTR 3B exceeds GSTR 2A by Rs. 1,20,000.',
      text: 'Para 2. On scrutiny it is seen that ITC availed in GSTR 3B exceeds GSTR 2A by Rs. 1,20,000.',
    }],
    documents_asked: [], summary: 'ASMT-10 for 2019-20.',
  };
  const net = new FakeNet({ 'notice.pdf': notice, 'reply.pdf': reply }, (_r, n) => jsonReply(n === 1 ? reading : replyReading));
  let clock = 0;
  const db = new FakeDb({
    ai_runner_begin: () => ({ lease: true, read_enabled: true, runner: 'edge', seconds: 400, sync_due: true }),
    ai_sync: () => ({ documents: 0, drafts: 0, notices: 1 }),
    ai_claim_next: (_a, n) => n === 1
      ? {
        kind: 'notice', extraction_id: 'x1', notice_id: 'n1', client_id: 'c1', document_url: storageUrl('notice.pdf'), document_label: 'Notice PDF',
        form_code: 'ASMT-10', reference_number: 'ZD-ASMT-1', issue_date: '2025-04-01', client_gstin: '24AAAAA0000A1Z5', attempt: 1,
        model: 'claude-opus-5-5', effort: 'high', max_pages: 60, price_in_per_mtok: 4, price_out_per_mtok: 20, issue_codes: ISSUE_CODES,
      }
      : n === 2 ? docClaim() : null,
    notice_read_finish: () => ({ status: 'done', outcome: 'applied' }),
    ai_document_hash: () => ({ duplicate: false }),
    ai_document_finish: () => ({ status: 'done', pairs: 2 }),
    ai_runner_end: () => null,
  });
  const report = await runTick({ db, claude: net.client(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch, now: () => clock });
  assertEquals(report.ran, true);
  assertEquals(report.stopped, 'empty');
  assertEquals(report.jobs.map((j) => `${j.kind}:${j.status}`), ['notice:done', 'document:done']);
  const fin = db.called('notice_read_finish')[0].args;
  assertEquals(fin.p_status, 'done');
  assertEquals(fin.p_result.fields.reference_number.quote_ok, true, 'checked against the PDF\'s text');
  assertEquals(fin.p_result.issues[0].text, 'Para 2. On scrutiny it is seen that ITC availed in GSTR 3B exceeds GSTR 2A by Rs. 1,20,000.');
  assertEquals(fin.p_usage.input_tokens, 12000);
  assertEquals(db.called('ai_document_finish')[0].args.p_result.pairs.length, 2);
  assertEquals(db.called('ai_runner_end')[0].args.p_done, 2);
  assertEquals(db.calls.map((c) => c.fn).slice(0, 2), ['ai_runner_begin', 'ai_sync']);
  clock = 0;
});

Deno.test('one run: no key, no lease; a refused key hands the job back and pauses', async () => {
  const db = new FakeDb({ ai_runner_begin: (a) => ({ lease: a.p_key_ok, read_enabled: true, runner: 'edge', seconds: 140, sync_due: false }) });
  const none = await runTick({ db, claude: null, supabaseUrl: SUPA, agentId: 'edge:t', version: 't' });
  assertEquals([none.ran, none.reason], [false, 'no_key']);
  assertEquals(db.called('ai_runner_begin')[0].args.p_key_ok, false);

  const pdf = await buildPdf(replyPages);
  const net = new FakeNet({ 'reply.pdf': pdf }, () => ({ status: 401, errorType: 'authentication_error' }));
  const db2 = new FakeDb({
    ai_runner_begin: () => ({ lease: true, read_enabled: true, runner: 'edge', seconds: 400, sync_due: false }),
    ai_claim_next: (_a, n) => (n === 1 ? docClaim() : null),
    ai_document_hash: () => ({ duplicate: false }),
  });
  const r = await runTick({ db: db2, claude: net.client(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch, now: () => 0 });
  assertEquals(r.stopped, 'paused:api_key');
  assertEquals(db2.called('ai_job_release')[0].args, { p_agent: 'edge:t', p_kind: 'document', p_id: '00000000-0000-0000-0000-0000000000d1' });
  assertEquals(db2.called('ai_document_finish').length, 0);
  const end = db2.called('ai_runner_end')[0].args;
  assertEquals([end.p_key_ok, end.p_done], [false, 0]);
  assertStringIncludes(end.p_error, 'ANTHROPIC_API_KEY');
});

Deno.test('one run stops when too little time is left for another job', async () => {
  let t = 0;
  const db = new FakeDb({
    ai_runner_begin: () => ({ lease: true, read_enabled: true, runner: 'edge', seconds: 140, sync_due: false }),
    ai_claim_next: () => { t += 100_000; return docClaim({ source: 'draft', document_url: null, body: 'Text.' }); },
    ai_document_finish: () => ({ status: 'done', pairs: 0 }),
  });
  const net = new FakeNet({}, () => jsonReply(replyReading));
  const r = await runTick({ db, claude: net.client(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch, now: () => t });
  assertEquals(r.jobs.length, 1);
  assertEquals(r.stopped, 'time');
});

const assistContext = {
  mode: 'draft',
  notice: { form_code: 'DRC-01', reference_number: 'ZD-SCN-2', issue_date: '2026-10-01', section_of_law: '73', financial_year: '2019-20', amount_of_demand: 120000, due_date: '2026-10-31' },
  reading: { summary: 'Show cause notice for excess ITC.', documents_asked: ['Invoices'] },
  issues: [{ id: 'i1', seq: 1, title: 'Excess ITC over GSTR 2A', issue_code: 'ITC_2A_V_3B', amount: 120000, text: 'Para 2. ITC exceeds 2A.', position: 'Suppliers filed late.' }],
  documents: [{ label: 'REPLY.pdf', role: 'reply', doc_kind: 'reply', title: 'Earlier reply', summary: 'Explained.', paragraphs: [{ kind: 'response', text: 'Explained.' }] }],
  draft: { version: 2, status: 'in_review', body: 'Para 1.' },
  examples: [
    { id: '11111111-1111-1111-1111-111111111111', for_issue: 1, form_code: 'ASMT-10', issue_code: 'ITC_2A_V_3B', origin: 'portal_reply', verified: true, allegation: 'ITC in 3B exceeds 2A.', response: 'Suppliers filed late; reconciled.' },
    { id: '22222222-2222-2222-2222-222222222222', for_issue: 1, form_code: 'DRC-01', issue_code: 'ITC_2A_V_3B', origin: 'position', verified: true, allegation: 'Excess ITC.', response: 'Reconciled supplier wise.' },
  ],
};

Deno.test('the assistant\'s context: issues with their paragraphs, the case, the draft, examples as E1, E2', () => {
  const { text, labels } = assistUserText(assistContext);
  assertStringIncludes(text, 'Mode: draft');
  assertStringIncludes(text, 'demand Rs. 1,20,000');
  assertStringIncludes(text, 'The paragraph as printed: Para 2. ITC exceeds 2A.');
  assertStringIncludes(text, 'The firm\'s position typed by staff: Suppliers filed late.');
  assertStringIncludes(text, 'E1 (for issue 1; ASMT-10; ITC_2A_V_3B; filed on the portal; checked)');
  assertStringIncludes(text, 'The current draft (version 2, in_review)');
  assertEquals(labels.get('E2'), '22222222-2222-2222-2222-222222222222');
  const out = mapAssistOutput({ answer: '', paragraphs: [{ issue_seq: 1, heading: 'H', text: 'T', examples_used: ['E2', 'E9', 'e1'] }, { issue_seq: 2, heading: '', text: '' }], client_questions: ['Q', 3], cautions: [], examples_used: ['E1'] }, labels);
  assertEquals((out.paragraphs as J[]).length, 1, 'an empty paragraph is dropped');
  assertEquals((out.paragraphs as J[])[0].examples_used, ['22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111']);
  assertEquals(out.client_questions, ['Q']);
  assertEquals(out.examples_used, ['11111111-1111-1111-1111-111111111111']);
});

Deno.test('the assistant: begin, ask the API, finish; no key says so', async () => {
  const db = new FakeDb({
    ai_assist_begin: () => ({ run_id: 'r1', settings: { model: 'claude-opus-5-5', effort: 'high' }, context: assistContext }),
    ai_assist_finish: (a) => ({ id: a.p_run_id, status: a.p_status, output: a.p_output }),
  });
  const net = new FakeNet({}, () => jsonReply({ answer: '', paragraphs: [{ issue_seq: 1, heading: 'Excess ITC', text: 'The noticee submits.', examples_used: ['E1'] }], client_questions: [], cautions: [], examples_used: ['E1'] }, { input_tokens: 20000, output_tokens: 3000 }));
  const r = await runAssist({ db, claude: net.client(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't' },
    { notice_id: '00000000-0000-0000-0000-0000000000a2', mode: 'draft', actor: 'Staff' });
  assertEquals(r.status, 'done');
  const fin = db.called('ai_assist_finish')[0].args;
  assertEquals(fin.p_output.paragraphs[0].examples_used, ['11111111-1111-1111-1111-111111111111']);
  assertEquals(fin.p_usage.input_tokens, 20000);
  assertEquals(db.called('ai_assist_begin')[0].args.p_actor, 'Staff');
  const req = net.claude[0].body;
  assertEquals(req.output_config.effort, 'high');
  assertEquals(req.max_tokens, 32000);
  assertStringIncludes(req.system, 'never carry their names, GSTINs');
  assertStringIncludes(req.system, 'No hyphen or dash');

  const noKey = await runAssist({ db, claude: null, supabaseUrl: SUPA, agentId: 'edge:t', version: 't' }, { notice_id: '00000000-0000-0000-0000-0000000000a2' });
  assertEquals(noKey.error, 'no_key');
  const refused = await runAssist({ db: new FakeDb({ ai_assist_begin: () => ({ error: 'no_consent' }) }), claude: null, supabaseUrl: SUPA, agentId: 'e', version: 't' },
    { notice_id: '00000000-0000-0000-0000-0000000000a2' });
  assertEquals(refused.error, 'no_consent');
  assertEquals((await runAssist({ db, claude: null, supabaseUrl: SUPA, agentId: 'e', version: 't' }, { notice_id: 'x' })).error, 'bad_request');
});

// ── The Claude CLI gateway (the firm's subscription, as in its other project) ──
Deno.test('CLI: a reply PDF goes as its text, the JSON comes back, no tokens billed', async () => {
  const pdf = await buildPdf(replyPages);
  const net = new FakeNet({ 'reply.pdf': pdf }, () => jsonReply(replyReading));
  net.gateway = () => ({ body: { text: '```json\n' + JSON.stringify(replyReading) + '\n```', model: 'opus' } });
  const db = new FakeDb({ ai_document_hash: () => ({ duplicate: false }) });
  const deps: Deps = { db, claude: net.cliClient(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch };
  const f = await readDocumentJob(deps, docClaim({ attempt: 2 }), new AbortController().signal);
  assertEquals(f.status, 'done');
  assertEquals(net.claude.length, 0, 'the Claude API is not called');
  const req = net.cli[0];
  assertEquals(req.auth, 'Bearer gw-secret');
  assertEquals([req.body.model, req.body.effort], ['opus', 'low']);
  assertStringIncludes(req.body.system, 'It must match this JSON Schema');
  assertEquals(req.body.parts.every((p: J) => p.kind === 'text'), true, 'text only');
  assertStringIncludes(req.body.parts[0].text, '--- Page 1 ---');
  assertStringIncludes(req.body.parts[0].text, 'the credit is reconciled invoice wise in Annexure A.');
  const r = f.result as J;
  assertEquals(r.pairs.length, 2);
  assertEquals(r.pairs[0].verified, true, 'quotes checked against the same text, on a second try too');
  assertEquals([f.usage?.input_tokens, f.usage?.output_tokens, f.usage?.model], [0, 0, 'claude-cli:opus']);
});

Deno.test('CLI: a scan goes to the API when there is a key, else waits for one; a refused secret pauses', async () => {
  const scan = { ...docClaim(), document_url: null, source: 'draft' as const, body: null };
  const net = new FakeNet({}, () => jsonReply({ a: 1 }));
  const req = { model: 'claude-opus-5-5', effort: 'low', system: 'S', schema: {}, what: 'the document',
    content: [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'JVBERg==' } }],
    pdfText: { pages: [], textLayer: false } };
  const only = await net.cliClient()(req);
  assert(!only.ok && only.reason === 'needs_vision' && only.status === 'failed');
  assertEquals(net.cli.length, 0, 'nothing sent for a scan');
  const both = await cliWithApiForScans(net.cliClient(), net.client())(req);
  assert(both.ok, 'the API read the scan');
  assertEquals(net.claude.length, 1);
  net.gateway = () => ({ status: 401, body: { error: 'Unauthorized' } });
  const refused = await net.cliClient()({ ...req, content: [{ type: 'text', text: 'x' }] });
  assert(!refused.ok && refused.pause === 'cli_auth' && refused.status === 'retry');
  net.gateway = () => ({ status: 502, body: { error: 'claude exited 1' } });
  const down = await net.cliClient()({ ...req, content: [{ type: 'text', text: 'x' }] });
  assert(!down.ok && down.status === 'retry' && down.reason === 'cli_unavailable');
  net.gateway = () => ({ body: { text: 'Sorry, I cannot.' } });
  const junk = await net.cliClient()({ ...req, content: [{ type: 'text', text: 'x' }] });
  assert(!junk.ok && junk.reason === 'bad_output');
  void scan;
});

Deno.test('CLI: the assistant drafts through the gateway', async () => {
  const net = new FakeNet({}, () => jsonReply({}));
  net.gateway = () => ({ body: { text: JSON.stringify({ answer: 'The credit is reconciled.', parts: [], examples_used: [], cautions: [] }) } });
  const db = new FakeDb({
    ai_assist_begin: () => ({ run_id: 'r1', settings: { model: 'claude-sonnet-5-5', effort: 'high' }, context: {} }),
    ai_assist_finish: (a: J) => ({ status: a.p_status }),
  });
  const r = await runAssist({ db, claude: net.cliClient(), supabaseUrl: SUPA, agentId: 'e', version: 't' }, { notice_id: '00000000-0000-0000-0000-0000000000a2' });
  assertEquals(r.status, 'done');
  assertEquals(net.cli[0].body.model, 'sonnet');
  assertEquals(net.claude.length, 0);
});

Deno.test('CLI helpers: model names and JSON out of words', () => {
  assertEquals([cliModel('claude-opus-5-5'), cliModel('claude-sonnet-5-5'), cliModel('claude-haiku-4-5')], ['opus', 'sonnet', 'haiku']);
  assertEquals(jsonFromText('Here it is:\n{"a": [1, {"b": 2}]}\nDone.'), { a: [1, { b: 2 }] });
  assertEquals(GATEWAY.startsWith('https://'), true);
});
