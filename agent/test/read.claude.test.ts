// The Claude API call (src/read/claude.ts) against a stand-in server: the
// request's shape (model, adaptive thinking, effort, JSON schema output,
// fallbacks, the PDF first and nothing about the client), and every way an
// answer can go (refusal, 429 then success, a refused key, max_tokens, a
// fallback mid-answer, a stream cut off, the agent stopping).
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { billedTokens, buildParams, FALLBACK_BETA, makeClaudeClient, readNotice, scrub, type ReadRequest } from '../src/read/claude.js';
import { SYSTEM_PROMPT } from '../src/read/prompt.js';
import { OUTPUT_SCHEMA } from '../src/read/schema.js';
import { FakeAnthropic, readingReply, type FakeReply } from './fakeAnthropic.js';
import { noticeReading } from './readFixtures.js';

const SPEC = { gstin: '24AAAAA0000A1Z5', name: 'Navkar Test Traders', ref: 'ZD2410260012345' };
const READING = noticeReading(SPEC);
const KEY = 'sk-ant-test-0000000000';
const PDF_B64 = Buffer.from('%PDF-1.7 a made-up notice').toString('base64');
const CODES = [{ code: 'LIAB_GSTR1_V_3B', title: 'Output tax: GSTR-1 higher than GSTR-3B' }, { code: 'OTHER', title: 'Other issue' }];

let script: FakeReply[] = [];
const fake = new FakeAnthropic((_, n) => script[Math.min(n, script.length) - 1] ?? { status: 500 });
const req = (over: Partial<ReadRequest> = {}): ReadRequest => ({ pdfBase64: PDF_B64, model: 'claude-opus-5-5', effort: 'high', issueCodes: CODES, ...over });
const client = (maxRetries = 0) => makeClaudeClient({ apiKey: KEY, baseUrl: fake.url, maxRetries });

before(async () => { await fake.start(); });
after(async () => { await fake.stop(); });
beforeEach(() => { fake.seen = []; script = []; });

test('the request: Opus 5.5 default, adaptive thinking, effort, JSON schema, fallbacks "default", PDF first, no client data', async () => {
  script = [readingReply(READING, { input_tokens: 12000, cache_creation_input_tokens: 300, cache_read_input_tokens: 200, output_tokens: 2500 })];
  const out = await readNotice(client(), req());
  assert.equal(out.ok, true);
  assert.equal(fake.seen.length, 1);
  const { url, headers, body } = fake.seen[0];
  assert.match(url, /^\/v1\/messages/);
  assert.equal(headers['x-api-key'], KEY);
  assert.equal(headers.authorization, undefined, 'only the key from agent/.env');
  assert.match(String(headers['anthropic-beta']), new RegExp(FALLBACK_BETA));
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.max_tokens, 64000);
  assert.equal(body.stream, true);
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.equal(body.output_config.effort, 'high');
  assert.deepEqual(body.output_config.format, { type: 'json_schema', schema: OUTPUT_SCHEMA });
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.system, SYSTEM_PROMPT);
  assert.equal('temperature' in body || 'tool_choice' in body || 'tools' in body, false);
  const [docBlock, textBlock] = body.messages[0].content;
  assert.deepEqual(docBlock, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_B64 } });
  assert.equal(textBlock.type, 'text');
  assert.match(textBlock.text, /LIAB_GSTR1_V_3B — Output tax: GSTR-1 higher than GSTR-3B/);
  const sent = JSON.stringify({ ...body, messages: [{ ...body.messages[0], content: [textBlock] }] });
  for (const s of [SPEC.gstin, SPEC.name, SPEC.ref]) assert.equal(sent.includes(s), false, `the request never carries ${s}`);
  if (!out.ok) return;
  assert.deepEqual(out.reading.gstin, READING.gstin);
  assert.equal(out.reading.issues.length, 2);
  assert.deepEqual([out.usage.input_tokens, out.usage.output_tokens], [12500, 2500], 'cache reads and writes count as input');
  assert.deepEqual([out.usage.status, out.usage.request_id, out.usage.calls, out.model], ['ok', 'req_fake_1', 1, 'claude-opus-5-5']);
});

test('fallbacks only for models documented to take "default"; effort from the settings', () => {
  const p = buildParams(req({ model: 'claude-opus-4-8', effort: 'max' }), 64000);
  assert.equal(p.fallbacks, undefined);
  assert.equal(p.betas, undefined);
  assert.equal(p.output_config?.effort, 'max');
  assert.equal(buildParams(req({ effort: 'bogus' }), 64000).output_config?.effort, 'high');
  assert.equal(buildParams(req({ model: 'claude-sonnet-5-5' }), 64000).fallbacks, 'default');
});

test('a refusal: failed, reason refused, its tokens still counted', async () => {
  script = [{ blocks: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null }, usage: { input_tokens: 9000, output_tokens: 0 } }];
  const out = await readNotice(client(), req());
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.deepEqual([out.status, out.reason], ['failed', 'refused']);
  assert.match(out.error, /declined.*\(cyber\)/);
  assert.deepEqual([out.usage?.status, out.usage?.input_tokens], ['refused', 9000]);
});

test('429 then success: the SDK retries and the reading comes back', async () => {
  script = [{ status: 429, errorType: 'rate_limit_error', headers: { 'retry-after-ms': '20' } }, readingReply(READING)];
  const out = await readNotice(client(2), req());
  assert.equal(out.ok, true);
  assert.equal(fake.seen.length, 2);
  if (out.ok) assert.equal(out.usage.request_id, 'req_fake_2');
});

test('rate limit, 5xx and connection failures are retried later; what was billed is counted', async () => {
  script = [{ status: 429, errorType: 'rate_limit_error' }];
  let out = await readNotice(client(0), req());
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.deepEqual([out.status, out.reason, out.usage?.status, out.usage?.input_tokens, out.usage?.request_id], ['retry', 'rate_limited', 'error', 0, 'req_fake_1']);
  }
  script = [{ status: 529, errorType: 'overloaded_error' }];
  out = await readNotice(client(0), req());
  if (!out.ok) assert.deepEqual([out.status, out.reason], ['retry', 'api_unavailable']);
  script = [{ cutAfterStart: true, usage: { input_tokens: 7000, output_tokens: 0 } }];
  out = await readNotice(client(0), req());
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.deepEqual([out.status, out.reason], ['retry', 'connection']);
    assert.equal(out.usage?.input_tokens, 7000, 'input counted from the stream\'s first event');
  }
  const unreachable = makeClaudeClient({ apiKey: KEY, baseUrl: 'http://127.0.0.1:1', maxRetries: 0 });
  out = await readNotice(unreachable, req());
  if (!out.ok) assert.deepEqual([out.status, out.reason], ['retry', 'connection']);
});

test('a refused key fails the job and pauses the reader; a bad request fails', async () => {
  script = [{ status: 401, errorType: 'authentication_error' }];
  let out = await readNotice(client(2), req());
  assert.equal(fake.seen.length, 1, '401 is not retried');
  assert.equal(out.ok, false);
  if (!out.ok) assert.deepEqual([out.status, out.reason, out.pause], ['failed', 'api_key', 'api_key']);
  script = [{ status: 400, errorType: 'invalid_request_error' }];
  out = await readNotice(client(), req());
  if (!out.ok) assert.deepEqual([out.status, out.reason, out.pause], ['failed', 'bad_request', undefined]);
  script = [{ status: 404, errorType: 'not_found_error' }];
  out = await readNotice(client(), req());
  if (!out.ok) assert.deepEqual([out.status, out.reason], ['failed', 'model_unavailable']);
});

test('max_tokens: asked once more with the larger budget; both calls counted', async () => {
  script = [
    { blocks: [{ type: 'thinking' }, { type: 'text', text: '{"gstin": {"value": "24AA' }], stop_reason: 'max_tokens', usage: { input_tokens: 10000, output_tokens: 64000 } },
    readingReply(READING, { input_tokens: 10000, output_tokens: 3000 }),
  ];
  const out = await readNotice(client(), req());
  assert.equal(out.ok, true);
  assert.deepEqual(fake.seen.map((s) => s.body.max_tokens), [64000, 128000]);
  if (out.ok) {
    assert.deepEqual([out.usage.input_tokens, out.usage.output_tokens, out.usage.calls], [20000, 67000, 2]);
    assert.equal(out.usage.request_id, 'req_fake_1 req_fake_2');
  }
  script = [{ blocks: [], stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 1 } }];
  const again = await readNotice(client(), req());
  if (!again.ok) assert.deepEqual([again.status, again.reason], ['failed', 'max_tokens']);
});

test('a fallback mid-answer: only the text after the last fallback block is the reading', async () => {
  const iterations = [
    { type: 'message', model: 'claude-opus-5-5', input_tokens: 11000, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 11000, output_tokens: 2600, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  ];
  script = [{
    blocks: [{ type: 'text', text: '{"gstin": {"value": "24AAAAA0' }, { type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' }, { type: 'text', text: JSON.stringify(READING) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 11000, output_tokens: 2600, iterations },
  }];
  const out = await readNotice(client(), req());
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.reading.reference_number.value, SPEC.ref);
  assert.equal(out.model, 'claude-opus-5');
  assert.deepEqual(out.usage.fallback, { from: 'claude-opus-5-5', to: 'claude-opus-5' });
  assert.deepEqual([out.usage.input_tokens, out.usage.output_tokens], [22000, 3000], 'every attempt billed');
});

test('the agent stopping mid-call: retried later', async () => {
  script = [{ ...readingReply(READING), delayMs: 3000 }];
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 200);
  const out = await readNotice(client(), req({ signal: ctl.signal }));
  assert.equal(out.ok, false);
  if (!out.ok) assert.deepEqual([out.status, out.reason], ['retry', 'agent_stopped']);
});

test('an answer that is not JSON, or a PDF too big for one request, fails', async () => {
  script = [{ blocks: [{ type: 'text', text: 'not json' }], stop_reason: 'end_turn' }];
  const out = await readNotice(client(), req());
  if (!out.ok) assert.deepEqual([out.status, out.reason, out.usage?.status], ['failed', 'bad_output', 'error']);
  const big = await readNotice(client(), req({ pdfBase64: 'A'.repeat(32 * 1024 * 1024) }));
  assert.equal(fake.seen.length, 1, 'never sent');
  if (!big.ok) assert.deepEqual([big.status, big.reason, big.usage], ['failed', 'too_large', null]);
});

test('tokens: iterations when there are any, else the top-level usage; keys scrubbed', () => {
  assert.deepEqual(billedTokens({ input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: null }), { input: 8, output: 7 });
  assert.deepEqual(billedTokens(null), { input: 0, output: 0 });
  assert.equal(scrub('bad key sk-ant-api03-abcDEF_123-xyz given'), 'bad key sk-ant-… given');
});
