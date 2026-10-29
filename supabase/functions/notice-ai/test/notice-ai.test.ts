// notice-ai without the real API or database:
//   deno test --allow-read --allow-env supabase/functions/notice-ai/test/
import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { AI_EFFORT, AI_MODEL } from '../../_shared/aiModel.ts';
import { buildParams, callClaude, FALLBACK_BETA } from '../claude.ts';
import { buildDocResult, type DocumentClaim } from '../documents.ts';
import { assistUserText, mapAssistOutput, runAssist } from '../assist.ts';
import { readDocumentJob, runTick, type Deps } from '../runner.ts';
import { cliWithApiForScans, jsonFromText, JsonCutOff, rawSample, repairJson } from '../cli.ts';
import { documentUrlAllowed, downloadPdf, storageReadUrl } from '../pdf.ts';
import { pageRanges, pagesAsText, pagesToRead } from '../pages.ts';
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

Deno.test('the request: always Sonnet at medium effort, structured output, adaptive thinking, the server fallback', () => {
  const p = buildParams({ model: 'claude-opus-5-5', effort: 'low', system: 'S', content: [{ type: 'text', text: 'x' }], schema: { type: 'object' } }, 64000);
  assertEquals(p.model, AI_MODEL);
  assertEquals(p.thinking, { type: 'adaptive' });
  assertEquals((p.output_config as J).effort, AI_EFFORT);
  assertEquals((p.output_config as J).format.type, 'json_schema');
  assertEquals(p.betas, [FALLBACK_BETA]);
  assertEquals((p as J).fallbacks, 'default');
  for (const [model, effort] of [['claude-other', 'nonsense'], ['claude-haiku-4-5', 'high'], ['claude-opus-5-5', 'max']]) {
    const q = buildParams({ model, effort, system: 'S', content: [], schema: {} }, 128000);
    assertEquals([q.model, (q.output_config as J).effort, q.thinking, q.max_tokens], [AI_MODEL, AI_EFFORT, { type: 'adaptive' }, 128000], `${model} at ${effort} is sent as Sonnet, medium`);
  }
  assertEquals([AI_MODEL, AI_EFFORT], ['claude-sonnet-5-5', 'medium']);
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
  assertEquals(net.claude.map((s) => [s.body.model, s.body.output_config.effort]), [[AI_MODEL, AI_EFFORT], [AI_MODEL, AI_EFFORT]], 'asked for Opus at high, sent Sonnet at medium');
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

Deno.test('with the service role key a document is read keyed, so a private bucket still reads', async () => {
  const seen: { url: string; auth: string | null }[] = [];
  const fetchImpl = ((u: string, init?: RequestInit) => {
    seen.push({ url: String(u), auth: new Headers(init?.headers).get('authorization') });
    return Promise.resolve(new Response(new TextEncoder().encode('%PDF-1.4 x'), { status: 200 }));
  }) as typeof fetch;
  const allow = (u: string) => documentUrlAllowed(u, SUPA);
  await downloadPdf(storageUrl('n/a b.pdf'), { allow, fetchImpl, storageKey: 'svc' });
  assertEquals(seen[0].url, `${SUPA}/storage/v1/object/authenticated/return-pdfs/n/a%20b.pdf`);
  assertEquals(seen[0].auth, 'Bearer svc');
  await downloadPdf(storageUrl('n/a.pdf'), { allow, fetchImpl });
  assertEquals(seen[1].url, storageUrl('n/a.pdf'), 'no key: the address as it is');
  assertEquals(seen[1].auth, null);
  assertEquals(storageReadUrl('https://evil.example/x', true), 'https://evil.example/x');
  let refused = false;
  try { await downloadPdf('https://evil.example/storage/v1/object/public/a.pdf', { allow, fetchImpl, storageKey: 'svc' }); } catch { refused = true; }
  assert(refused && seen.length === 2, 'the key never goes to another host');
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
  assertEquals([req.model, req.output_config.effort], [AI_MODEL, AI_EFFORT]);
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
  assertEquals([req.model, req.output_config.effort], [AI_MODEL, AI_EFFORT]);
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
Deno.test('CLI: a reply PDF goes as its text, the JSON comes back, no tokens billed, tokens counted', async () => {
  const pdf = await buildPdf(replyPages);
  const net = new FakeNet({ 'reply.pdf': pdf }, () => jsonReply(replyReading));
  net.gateway = () => ({ body: { text: '```json\n' + JSON.stringify(replyReading) + '\n```', model: 'sonnet' } });
  const db = new FakeDb({ ai_document_hash: () => ({ duplicate: false }) });
  const deps: Deps = { db, claude: net.cliClient(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch };
  const f = await readDocumentJob(deps, docClaim({ attempt: 2 }), new AbortController().signal);
  assertEquals(f.status, 'done');
  assertEquals(net.claude.length, 0, 'the Claude API is not called');
  const req = net.cli[0];
  assertEquals(req.auth, 'Bearer gw-secret');
  assertEquals([req.body.model, req.body.effort], ['sonnet', 'medium'], 'the claim said Opus at low');
  assertStringIncludes(req.body.system, 'It must match this JSON Schema');
  assertEquals(req.body.parts.every((p: J) => p.kind === 'text'), true, 'text only');
  assertStringIncludes(req.body.parts[0].text, '--- Page 1 ---');
  assertStringIncludes(req.body.parts[0].text, 'the credit is reconciled invoice wise in Annexure A.');
  const r = f.result as J;
  assertEquals(r.pairs.length, 2);
  assertEquals(r.pairs[0].verified, true, 'quotes checked against the same text, on a second try too');
  // No tokens billed, but counted (an estimate, as the gateway sends none) so staff see what a read takes.
  assertEquals([f.usage?.input_tokens, f.usage?.output_tokens], [0, 0]);
  assert((f.usage?.tokens_in ?? 0) > 0 && (f.usage?.tokens_out ?? 0) > 0);
  assertEquals([f.usage?.estimated, f.usage?.model], [true, 'claude-cli:sonnet']);
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
  assertEquals([net.cli[0].body.model, net.cli[0].body.effort], ['sonnet', 'medium'], 'the settings said high');
  assertEquals(net.claude.length, 0);
});

Deno.test('CLI helpers: JSON out of words', () => {
  assertEquals(jsonFromText('Here it is:\n{"a": [1, {"b": 2}]}\nDone.'), { a: [1, { b: 2 }] });
  assertEquals(GATEWAY.startsWith('https://'), true);
});

Deno.test('CLI helpers: a long answer\'s slips are mended, a cut off one is said to be', () => {
  // A real line break, a quoted provision and a backslash inside strings, a trailing comma, words after the object.
  const slipped = 'Here is the submission:\n```json\n{"title": "Written submission", "sections": [{"heading": "Grounds", '
    + '"text": "The term "aggrieved person" in section 107\nis wide.\tSee rule 108\\(1).", "precedents_used": ["P1",],},],'
    + ' "prayer": "Set aside the order, "in full", and refund the pre deposit.", "client_questions": ["Ask for the "invoice", then the bank statement"],'
    + ' "cautions": [], "precedents_used": []}\n```\nI have kept {placeholders} in square brackets.';
  const j = jsonFromText(slipped) as J;
  assertEquals(j.sections[0].text, 'The term "aggrieved person" in section 107\nis wide.\tSee rule 108\\(1).');
  assertEquals(j.sections[0].precedents_used, ['P1']);
  assertEquals(j.prayer, 'Set aside the order, "in full", and refund the pre deposit.');
  assertEquals(j.client_questions, ['Ask for the "invoice", then the bank statement']);
  assertEquals(j.cautions, []);
  // An object that never closes was cut off, not malformed.
  assertThrows(() => jsonFromText('{"title": "Written submission", "sections": [{"heading": "Grounds", "text": "The appellant'), JsonCutOff);
  assertThrows(() => jsonFromText('Sorry, I cannot.'));
  assertEquals(repairJson('{"a": "x"} {"b": 1}'), '{"a": "x"}');
  assertStringIncludes(rawSample('a'.repeat(400) + 'b'.repeat(400)), ' … ');
});

Deno.test('CLI: an answer that cannot be read keeps its start and end on the run; a cut off one says so', async () => {
  const net = new FakeNet({}, () => jsonReply({}));
  const req = { model: AI_MODEL, effort: 'medium', system: 'S', schema: {}, what: 'the appeal', content: [{ type: 'text' as const, text: 'x' }] };
  net.gateway = () => ({ body: { text: '{"title": "Grounds of appeal", "sections": [{"heading": "One", "text": "That the' } });
  const cut = await net.cliClient()(req);
  assert(!cut.ok && cut.reason === 'max_tokens' && /stopped before its end/.test(cut.error));
  assertStringIncludes(cut.usage?.raw_sample ?? '', 'Grounds of appeal');
  net.gateway = () => ({ body: { text: 'I have written the submission to submission.md.' } });
  const words = await net.cliClient()(req);
  assert(!words.ok && words.reason === 'bad_output' && /in words/.test(words.error));
  assertStringIncludes(net.cli[0].body.system, 'typographic quotes');
});

// ── What to do now on a case (advise.ts) ─────────────────────────────────────
import { adviceUserText, cleanAdvice, runAdvise, runAdviseNext } from '../advise.ts';

Deno.test('advice: the case is read with today, the facts and the correspondence', () => {
  const t = adviceUserText({
    today: '2026-10-12',
    case: { track: 'refund', title: 'Refund order', forms: ['RFD-06'], next_due: '2025-11-26', is_overdue: true, is_open: true },
    overview: { fields: {}, refund: { refund_rejected: { value: 50000 }, reason: 'Export without payment' } },
    items: [{ from: 'department', date: '2025-08-26', label: 'RFD-06', summary: 'Rejected in part' }],
  });
  assertStringIncludes(t, 'Today: 2026-10-12');
  assertStringIncludes(t, 'due 2025-11-26 (overdue)');
  assertStringIncludes(t, 'refund rejected: 50000');
  assertStringIncludes(t, 'from the department: RFD-06');
});

Deno.test('advice: kept trimmed, dates checked, no dashes', () => {
  const a = cleanAdvice({
    headline: 'File appeal in APL-01 by 26 Feb 2026', situation: 'Order — rejected', deadline: '2026-02-26', deadline_basis: 'x',
    overdue_note: '', can_close: 'yes', close_reason: '', cautions: ['a', '', 'b', 'c', 'd'],
    steps: [{ action: 'File APL-01', detail: 'with pre-deposit', by: '26/02/2026', who: 'boss' }, { action: '', detail: '', by: '', who: '' }],
  });
  assertEquals(a.headline, 'File appeal in APL 01 by 26 Feb 2026');
  assertEquals(a.situation, 'Order, rejected');
  assertEquals(a.can_close, false);
  assertEquals((a.cautions as string[]).length, 2);
  assertEquals(a.steps, [{ action: 'File APL 01', detail: 'with pre deposit', by: '', who: 'firm' }]);
});

function adviceDeps(claims: unknown[], answer: unknown) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const deps = {
    db: {
      async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
        calls.push({ fn, args });
        if (fn === 'notice_case_advice_claim') return (claims.shift() ?? null) as T;
        if (fn === 'notice_case_advice_begin') return { client_id: args?.p_client_id, case_key: args?.p_case_key, hash: 'h', context: {}, settings: {} } as T;
        if (fn === 'notice_case_advice_finish') return { status: args?.p_status === 'done' ? 'done' : 'failed' } as T;
        throw new Error(`unexpected ${fn}`);
      },
    },
    claude: async () => ({ ok: true, json: answer, model: 'm', usage: { input_tokens: 1, output_tokens: 1, duration_ms: 1, request_id: null, status: 'ok', model: 'm', calls: 1 } }),
    supabaseUrl: '', agentId: 'edge:t', version: 't',
  } as unknown as Deps;
  return { deps, calls };
}

Deno.test('advice: one case on request is kept with its hash', async () => {
  const { deps, calls } = adviceDeps([], { headline: 'Close it', steps: [], cautions: [], can_close: true });
  const r = await runAdvise(deps, { client_id: '00000000-0000-0000-0000-000000000001', case_key: 'AV-1', actor: 'P' });
  assertEquals(r.status, 'done');
  const fin = calls.find((c) => c.fn === 'notice_case_advice_finish')!;
  assertEquals(fin.args?.p_hash, 'h');
  assertEquals((fin.args?.p_advice as Record<string, unknown>).can_close, true);
  assertEquals((await runAdvise(deps, { client_id: 'x', case_key: 'y' })).error, 'bad_request');
});

Deno.test('advice: the scheduled run takes the next cases until none is left', async () => {
  const claim = (k: string) => ({ client_id: '00000000-0000-0000-0000-000000000001', case_key: k, hash: 'h', context: {}, settings: {} });
  const { deps } = adviceDeps([claim('A'), claim('B'), null], { headline: 'x', steps: [], cautions: [] });
  const r = await runAdviseNext(deps, { seconds: 120 });
  assertEquals((r.advised as unknown[]).length, 2);
});

// ── Long and partly scanned documents (28 October 2026: refund applications of
// 60 to 200 pages and typed forms among scanned annexures were left unread) ──
const typedPage = (n: number) => [
  `Page ${n} of the order in original under section 54 of the CGST Act, 2017 for the refund of accumulated input tax credit.`,
  `Paragraph ${n}. The claim of Rs. ${n},000 is examined against the statement of invoices and the returns filed for the period.`,
];

Deno.test('pages of a long document: its first pages and its last few, named as a reader writes them', () => {
  assertEquals(pagesToRead(10, 40).length, 10);
  const r = pagesToRead(85, 40);
  assertEquals([r.length, r[0], r[34], r[35], r[39]], [40, 1, 35, 81, 85]);
  assertEquals(pageRanges(r), '1 to 35 and 81 to 85');
  assertEquals(pageRanges([2, 3, 5]), '2 to 3 and 5');
  assertEquals(pageRanges([4]), '4');
  // A scan with one typed page: that page goes, the others are named.
  const t = pagesAsText({ pages: ['x'.repeat(200), '', ' ', 'Page 4'], textLayer: false })!;
  assertStringIncludes(t, '--- Page 1 ---');
  assertStringIncludes(t, 'Pages 2 to 4 are scanned images without a text layer, not given here.');
  assert(!t.includes('--- Page 2 ---'));
  assertEquals(pagesAsText({ pages: ['', 'stamp'], textLayer: false }), null, 'a scan has nothing to send');
});

Deno.test('CLI: a document longer than the reader takes is read in part, by its own page numbers', async () => {
  const pages = Array.from({ length: 50 }, (_, i) => typedPage(i + 1));
  const pdf = await buildPdf(pages);
  const reading = { ...replyReading, doc_kind: 'order', paragraphs: [{ kind: 'finding', para: '48', heading: 'Refund', issue_code: 'OTHER',
    text: 'Paragraph 48. The claim of Rs. 48,000 is examined', page: 48, quote: 'Paragraph 48. The claim of Rs. 48,000 is examined', answers: '', allegation: '' }] };
  const net = new FakeNet({ 'order.pdf': pdf }, () => jsonReply(reading));
  net.gateway = () => ({ body: { text: JSON.stringify(reading), model: 'sonnet' } });
  const deps: Deps = { db: new FakeDb({ ai_document_hash: () => ({ duplicate: false }) }), claude: net.cliClient(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch };
  const f = await readDocumentJob(deps, docClaim({ role: 'order', folder_section: 'ORDRS', document_url: storageUrl('order.pdf') }), new AbortController().signal);
  assertEquals(f.status, 'done', 'not skipped as too long');
  const sent = net.cli[0].body.parts[0].text as string;
  assertStringIncludes(sent, 'The PDF has 50 pages and is too long to read whole: only pages 1 to 35 and 46 to 50 are given here');
  assertStringIncludes(sent, '--- Page 35 ---');
  assertStringIncludes(sent, '--- Page 46 ---');
  assert(!sent.includes('--- Page 36 ---'), 'the pages between are left out');
  const r = f.result as J;
  assertEquals([r.pages, r.text_layer, r.paragraphs[0].quote_ok, r.paragraphs[0].page], [50, true, true, 48]);
});

Deno.test('API: a long document goes as the text of the pages read, never as a PDF the API cannot take', async () => {
  const pdf = await buildPdf(Array.from({ length: 45 }, (_, i) => typedPage(i + 1)));
  const net = new FakeNet({ 'order.pdf': pdf }, () => jsonReply(replyReading));
  const deps: Deps = { db: new FakeDb({ ai_document_hash: () => ({ duplicate: false }) }), claude: net.client(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch };
  const f = await readDocumentJob(deps, docClaim({ role: 'order', document_url: storageUrl('order.pdf') }), new AbortController().signal);
  assertEquals(f.status, 'done');
  const first = net.claude[0].body.messages[0].content[0];
  assertEquals(first.type, 'text');
  assertStringIncludes(first.text, 'only pages 1 to 35 and 41 to 45');
});

Deno.test('CLI: a scan with typed pages is read by them; a whole scan still waits for vision; a long scan is too long', async () => {
  const mixed = await buildPdf([typedPage(1), [], [], [], [], [], []]);
  const scan = await buildPdf([[], [], []]);
  const longScan = await buildPdf(Array.from({ length: 45 }, () => []));
  const net = new FakeNet({ 'mixed.pdf': mixed, 'scan.pdf': scan, 'long.pdf': longScan }, () => jsonReply(replyReading));
  net.gateway = () => ({ body: { text: JSON.stringify({ ...replyReading, paragraphs: [] }) } });
  const deps: Deps = { db: new FakeDb({ ai_document_hash: () => ({ duplicate: false }) }), claude: net.cliClient(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch };
  const sig = new AbortController().signal;
  const m = await readDocumentJob(deps, docClaim({ role: 'application', document_url: storageUrl('mixed.pdf') }), sig);
  assertEquals(m.status, 'done');
  assertStringIncludes(net.cli[0].body.parts[0].text, 'Pages 2 to 7 are scanned images without a text layer, not given here.');
  assertEquals((m.result as J).text_layer, true, 'its quotes are checked against the typed pages');
  const s = await readDocumentJob(deps, docClaim({ role: 'application', document_url: storageUrl('scan.pdf') }), sig);
  assertEquals([s.status, s.reason], ['failed', 'needs_vision']);
  assertEquals(net.cli.length, 1, 'nothing sent for the whole scan');
  const l = await readDocumentJob(deps, docClaim({ role: 'application', document_url: storageUrl('long.pdf') }), sig);
  assertEquals([l.status, l.reason], ['skipped', 'too_long']);
  // With the API there, the partly scanned file goes to it whole (it reads the scanned pages too).
  const both: Deps = { ...deps, claude: cliWithApiForScans(net.cliClient(), net.client()) };
  const viaApi = await readDocumentJob(both, docClaim({ role: 'application', document_url: storageUrl('mixed.pdf') }), sig);
  assertEquals(viaApi.status, 'done');
  assertEquals(net.claude.at(-1)!.body.messages[0].content[0].type, 'document');
});

Deno.test('CLI: a later try of a document reads fewer pages instead of none', async () => {
  const pdf = await buildPdf(Array.from({ length: 30 }, (_, i) => typedPage(i + 1)));
  const net = new FakeNet({ 'order.pdf': pdf }, () => jsonReply(replyReading));
  net.gateway = () => ({ body: { text: JSON.stringify({ ...replyReading, paragraphs: [] }) } });
  const deps: Deps = { db: new FakeDb({ ai_document_hash: () => ({ duplicate: false }) }), claude: net.cliClient(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch };
  const f = await readDocumentJob(deps, docClaim({ attempt: 3, document_url: storageUrl('order.pdf') }), new AbortController().signal);
  assertEquals(f.status, 'done');
  assertStringIncludes(net.cli[0].body.parts[0].text, 'only pages 1 to 6 and 29 to 30 are given here');
});

Deno.test('a notice PDF read before, back at a new address after a refresh, is not read again', async () => {
  const notice = await buildPdf(replyPages);
  const net = new FakeNet({ 'notice.pdf': notice }, () => jsonReply(replyReading));
  const db = new FakeDb({
    ai_runner_begin: () => ({ lease: true, read_enabled: true, runner: 'edge', seconds: 400, sync_due: false }),
    ai_claim_next: (_a, n) => n === 1
      ? {
        kind: 'notice', extraction_id: 'x2', notice_id: 'n1', client_id: 'c1', document_url: storageUrl('notice.pdf'), document_label: 'Notice PDF',
        form_code: 'ASMT-10', reference_number: 'ZD-ASMT-1', issue_date: '2025-04-01', client_gstin: '24AAAAA0000A1Z5', attempt: 1,
        model: 'm', effort: 'medium', max_pages: 60, price_in_per_mtok: 4, price_out_per_mtok: 20, issue_codes: ISSUE_CODES,
      }
      : null,
    notice_read_hash: () => ({ duplicate: true, of: 'x1' }),
    ai_runner_end: () => null,
  });
  const report = await runTick({ db, claude: net.client(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch, now: () => 0 });
  assertEquals(report.jobs.map((j) => `${j.kind}:${j.status}:${j.reason}`), ['notice:skipped:same_file']);
  assertEquals(net.claude.length, 0, 'no tokens spent');
  assertEquals(db.called('notice_read_finish').length, 0, 'the earlier reading stands');
  assertEquals(db.called('notice_read_hash')[0].args.p_sha256.length, 64);
});

// ── Scans through GST Keeper's own gateway (29 October 2026: 206 scanned
// papers and 4 scanned notices waited for a reader of images) ──────────────
Deno.test('own gateway: a scan goes as where it is stored, never its bytes, and the reading says it was read from a scan', async () => {
  const scan = await buildPdf([[], [], []]);
  const net = new FakeNet({ 'scan.pdf': scan }, () => jsonReply(replyReading));
  net.gateway = () => ({ body: { text: JSON.stringify({ ...replyReading, paragraphs: [] }), model: 'sonnet' } });
  const deps: Deps = {
    db: new FakeDb({ ai_document_hash: () => ({ duplicate: false }) }), claude: net.cliFilesClient(), supabaseUrl: SUPA,
    agentId: 'edge:t', version: 't', fetchImpl: net.fetch, timeLeft: () => 130_000,
  };
  const f = await readDocumentJob(deps, docClaim({ role: 'application', document_url: storageUrl('scan.pdf') }), new AbortController().signal);
  assertEquals(f.status, 'done');
  const body = net.cli[0].body;
  const file = body.parts.find((p: J) => p.kind === 'storage');
  assertEquals([file.bucket, file.path, file.filename, file.mediaType], ['return-pdfs', 'scan.pdf', 'document.pdf', 'application/pdf']);
  assert(!JSON.stringify(body).includes('JVBER'), 'no base64 of the PDF');
  assertStringIncludes(JSON.stringify(body.parts), 'a scan of 3 pages');
  assert(body.timeoutMs >= 30_000 && body.timeoutMs <= 130_000, 'the gateway is given what is left of the run');
  assertEquals(f.usage?.read_from, 'scan');
  assertEquals(net.staged.length, 0, 'a short scan is read where it is stored');
  // The same scan with a gateway that reads text only still waits (needs_vision).
  const off = await readDocumentJob({ ...deps, claude: net.cliClient() }, docClaim({ role: 'application', document_url: storageUrl('scan.pdf') }), new AbortController().signal);
  assertEquals([off.status, off.reason], ['failed', 'needs_vision']);
  assertEquals(net.cli.length, 1);
});

Deno.test('own gateway: a long scan is read by its first and last pages, staged in ai-cli-temp and removed', async () => {
  const longScan = await buildPdf(Array.from({ length: 45 }, () => []));
  const net = new FakeNet({ 'long.pdf': longScan }, () => jsonReply(replyReading));
  net.gateway = () => ({ body: { text: JSON.stringify({ ...replyReading, paragraphs: [] }) } });
  const deps: Deps = {
    db: new FakeDb({ ai_document_hash: () => ({ duplicate: false }) }), claude: net.cliFilesClient(), supabaseUrl: SUPA,
    agentId: 'edge:t', version: 't', fetchImpl: net.fetch, timeLeft: () => 130_000,
  };
  const f = await readDocumentJob(deps, docClaim({ role: 'application', document_url: storageUrl('long.pdf') }), new AbortController().signal);
  assertEquals(f.status, 'done', 'not skipped as too long');
  assertEquals(net.staged.length, 1);
  const { PDFDocument } = await import('pdf-lib');
  assertEquals((await PDFDocument.load(net.staged[0].bytes)).getPageCount(), 12);
  const file = net.cli[0].body.parts.find((p: J) => p.kind === 'storage');
  assertEquals([file.bucket, file.path], ['ai-cli-temp', net.staged[0].path]);
  assertStringIncludes(JSON.stringify(net.cli[0].body.parts), 'pages 1 to 9 and 43 to 45');
  assertStringIncludes(JSON.stringify(net.cli[0].body.parts), "the attached file's page 10 is the original's page 43");
  assertEquals(net.unstaged, [[net.staged[0].path]], 'the staged part is removed after the read');
  assertEquals((f.result as J).pages, 45);
});

Deno.test('own gateway: a photo saved as .pdf is read as an image', async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  const net = new FakeNet({ 'photo.pdf': jpeg }, () => jsonReply(replyReading));
  net.gateway = () => ({ body: { text: JSON.stringify({ ...replyReading, paragraphs: [] }) } });
  const deps: Deps = {
    db: new FakeDb({ ai_document_hash: () => ({ duplicate: false }) }), claude: net.cliFilesClient(), supabaseUrl: SUPA,
    agentId: 'edge:t', version: 't', fetchImpl: net.fetch, timeLeft: () => 130_000,
  };
  const f = await readDocumentJob(deps, docClaim({ role: 'application', document_url: storageUrl('photo.pdf') }), new AbortController().signal);
  assertEquals(f.status, 'done');
  const file = net.cli[0].body.parts.find((p: J) => p.kind === 'storage');
  assertEquals([file.path, file.filename, file.mediaType], ['photo.pdf', 'page.jpg', 'image/jpeg']);
  // Without the own gateway the photo is still not a PDF.
  const off = await readDocumentJob({ ...deps, claude: net.cliClient() }, docClaim({ role: 'application', document_url: storageUrl('photo.pdf') }), new AbortController().signal);
  assertEquals(off.reason, 'not_pdf');
});

Deno.test('own gateway: a typed document still goes as its text; a scan with too little of the run left goes back to the queue', async () => {
  const typed = await buildPdf(replyPages);
  const scan = await buildPdf([[], []]);
  const net = new FakeNet({ 'reply.pdf': typed, 'scan.pdf': scan }, () => jsonReply(replyReading));
  net.gateway = () => ({ body: { text: JSON.stringify(replyReading) } });
  const deps: Deps = {
    db: new FakeDb({ ai_document_hash: () => ({ duplicate: false }) }), claude: net.cliFilesClient(), supabaseUrl: SUPA,
    agentId: 'edge:t', version: 't', fetchImpl: net.fetch, timeLeft: () => 50_000,
  };
  const t = await readDocumentJob(deps, docClaim(), new AbortController().signal);
  assertEquals(t.status, 'done');
  assert(!net.cli[0].body.parts.some((p: J) => p.kind === 'storage'), 'typed text, no file');
  assertEquals(t.usage?.read_from, undefined);
  const s = await readDocumentJob(deps, docClaim({ document_url: storageUrl('scan.pdf') }), new AbortController().signal);
  assertEquals([s.status, s.reason], ['release', 'needs_time']);
  assertEquals(net.cli.length, 1, 'nothing sent');
  // In a run: handed back, its try not counted, and the run stops.
  const db = new FakeDb({
    ai_runner_begin: () => ({ lease: true, read_enabled: true, runner: 'edge', seconds: 100, sync_due: false }),
    ai_claim_next: (_a, n) => n === 1 ? docClaim({ document_url: storageUrl('scan.pdf') }) : null,
    ai_document_hash: () => ({ duplicate: false }),
    ai_job_release: () => true,
    ai_runner_end: () => null,
  });
  const report = await runTick({ db, claude: net.cliFilesClient(), supabaseUrl: SUPA, agentId: 'edge:t', version: 't', fetchImpl: net.fetch, now: () => 0 });
  assertEquals(report.jobs.map((j) => `${j.status}:${j.reason}`), ['released:needs_time']);
  assertEquals(report.stopped, 'time');
  assertEquals(db.called('ai_job_release')[0].args.p_kind, 'document');
  assertEquals(db.called('ai_document_finish').length, 0);
});

Deno.test('GSTIN check characters: a misread GSTIN in a scan\'s reading is a doubt', async () => {
  const { gstinDoubts, gstinValid } = await import('../gstin.ts');
  assert(gstinValid('24AAQCA6090D1ZO'));
  assert(!gstinValid('24AAQCA6090D1Z0'), 'O read as 0');
  assertEquals(gstinDoubts(['GSTIN 24AAQCA6090D1ZO', 'ARN AA240524004808C', '24AAQCA6090D1Z0 and again 24AAQCA6090D1Z0']),
    ['GSTIN 24AAQCA6090D1Z0 as read from the scan fails its check character: confirm it on the paper.']);
  const scan = await buildPdf([[]]);
  const net = new FakeNet({ 'scan.pdf': scan }, () => jsonReply(replyReading));
  net.gateway = () => ({ body: { text: JSON.stringify({ ...replyReading, paragraphs: [], summary: 'Refund order for 24AAQCA6090D1Z0.' }) } });
  const deps: Deps = {
    db: new FakeDb({ ai_document_hash: () => ({ duplicate: false }) }), claude: net.cliFilesClient(), supabaseUrl: SUPA,
    agentId: 'edge:t', version: 't', fetchImpl: net.fetch, timeLeft: () => 130_000,
  };
  const f = await readDocumentJob(deps, docClaim({ role: 'order', document_url: storageUrl('scan.pdf') }), new AbortController().signal);
  assertEquals(f.usage?.doubts, ['GSTIN 24AAQCA6090D1Z0 as read from the scan fails its check character: confirm it on the paper.']);
});
