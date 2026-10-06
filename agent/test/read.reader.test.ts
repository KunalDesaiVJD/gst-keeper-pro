// The notice reader's loop (src/read/reader.ts) with an in-memory stand-in for
// the database's RPCs, a local "storage" serving the notice PDF, and the
// stand-in Claude API: off without a key; release, claim, read, check and
// finish; the day's cap; a refused key pauses it; stop releases.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { NoticeReader } from '../src/read/reader.js';
import { FakeAnthropic, readingReply, type FakeReply, type Json } from './fakeAnthropic.js';
import { noticePdf, noticeReading } from './readFixtures.js';

const SPEC = { gstin: '24AAAAA0000A1Z5', name: 'Navkar Test Traders', ref: 'ZD2410260012345' };
let storage: http.Server;
let storageUrl = '';
let reply: FakeReply = readingReply(noticeReading(SPEC));
const fake = new FakeAnthropic(() => reply);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstk-reader-'));

before(async () => {
  const pdf = Buffer.from(await noticePdf(SPEC));
  storage = http.createServer((req, res) => {
    if (req.url === '/storage/v1/object/public/return-pdfs/notices/n1.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(pdf); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => storage.listen(0, '127.0.0.1', () => r()));
  storageUrl = `http://127.0.0.1:${(storage.address() as AddressInfo).port}`;
  await fake.start();
});
after(async () => {
  storage.closeAllConnections?.();
  storage.close();
  await fake.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// The database, as far as the reader sees it.
class FakeDb implements Db {
  calls: { fn: string; args: Record<string, unknown> }[] = [];
  claims: unknown[] = [];
  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ fn, args });
    if (fn === 'notice_reads_release') return 0 as T;
    if (fn === 'notice_read_claim') return (this.claims.length ? this.claims.shift() : null) as T;
    if (fn === 'notice_read_finish') return { status: args.p_status, outcome: 'applied', applied: ['due_date'], issues_added: 2 } as T;
    throw new Error('unexpected rpc ' + fn);
  }
  async get<T>(): Promise<T> { throw new Error('not used'); }
  async post(): Promise<void> { throw new Error('not used'); }
  named(fn: string) { return this.calls.filter((c) => c.fn === fn); }
}

const claim = (over: Record<string, unknown> = {}) => ({
  extraction_id: 'e0000000-0000-0000-0000-000000000001', notice_id: 'n1', client_id: 'c1',
  document_url: `${storageUrl}/storage/v1/object/public/return-pdfs/notices/n1.pdf`, document_label: 'Notice PDF',
  form_code: 'DRC-01', reference_number: SPEC.ref, issue_date: '2026-10-01', client_gstin: SPEC.gstin, attempt: 1,
  model: 'claude-opus-5-5', effort: 'high', max_pages: 60, price_in_per_mtok: 4, price_out_per_mtok: 20,
  issue_codes: [{ code: 'LIAB_GSTR1_V_3B', title: 'Output tax' }, { code: 'ITC_2A_V_3B', title: 'ITC v 2A' }, { code: 'OTHER', title: 'Other' }],
  ...over,
});
const cfg = (over: Record<string, unknown> = {}) => loadConfig({}, {
  supabaseUrl: storageUrl, anonKey: 'anon', agentId: 'reader-test', dataDir, readerPollMs: 100,
  anthropicApiKey: 'sk-ant-test-key', anthropicBaseUrl: fake.url, ...over,
});
async function until(what: string, fn: () => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('no API key: the reader stays off and claims nothing', async () => {
  const db = new FakeDb();
  const r = new NoticeReader(cfg({ anthropicApiKey: null }), db);
  r.start();
  await new Promise((res) => setTimeout(res, 300));
  await r.stop();
  assert.equal(r.info().enabled, false);
  assert.deepEqual(db.calls.map((c) => c.fn), ['notice_reads_release'], 'only the release of left-overs');
});

test('a reading: release, claim, read, check, finish with the result and the usage', async () => {
  fake.seen = [];
  reply = readingReply(noticeReading(SPEC), { input_tokens: 12000, output_tokens: 2500 });
  const db = new FakeDb();
  db.claims = [claim()];
  const r = new NoticeReader(cfg(), db);
  r.start();
  await until('the finish', () => db.named('notice_read_finish').length > 0);
  await until('the next claim', () => db.named('notice_read_claim').length > 1);
  await r.stop();
  assert.equal(db.calls[0].fn, 'notice_reads_release', 'left-overs released first');
  assert.equal(db.calls.at(-1)?.fn, 'notice_reads_release', 'and at stop');
  const f = db.named('notice_read_finish')[0].args as Record<string, Json>;
  assert.deepEqual([f.p_extraction_id, f.p_agent, f.p_status, f.p_error, f.p_reason_class], ['e0000000-0000-0000-0000-000000000001', 'reader-test', 'done', null, null]);
  assert.equal(f.p_result.fields.section_of_law.value, '73(1)');
  assert.equal(f.p_result.fields.section_of_law.quote_ok, true);
  assert.equal(f.p_result.issues.length, 2);
  assert.equal(f.p_result.checks.gstin.ok, true);
  assert.deepEqual([f.p_result.pages, f.p_result.text_layer, f.p_result.model], [2, true, 'claude-opus-5-5']);
  assert.match(f.p_result.document_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual([f.p_usage.input_tokens, f.p_usage.output_tokens, f.p_usage.status, f.p_usage.request_id], [12000, 2500, 'ok', 'req_fake_1']);
  const info = r.info();
  assert.deepEqual([info.enabled, info.busy, info.done_today, info.last_error], [true, false, 1, null]);
  assert.ok(info.last_claim_at);
  assert.equal(fake.seen.length, 1);
});

test('the day\'s cap: nothing is read while the claim says capped', async () => {
  fake.seen = [];
  const db = new FakeDb();
  db.claims = [{ capped: true }];
  const r = new NoticeReader(cfg({ readerPollMs: 1000 }), db);
  r.start();
  await until('the claim', () => db.named('notice_read_claim').length > 0);
  await new Promise((res) => setTimeout(res, 1500));
  await r.stop();
  assert.equal(db.named('notice_read_finish').length, 0);
  assert.equal(fake.seen.length, 0);
  assert.equal(db.named('notice_read_claim').length, 1, 'backs off four poll intervals (a minute by default) before asking again');
});

test('a refused key: the job fails with api_key and the reader pauses', async () => {
  fake.seen = [];
  reply = { status: 401, errorType: 'authentication_error' };
  const db = new FakeDb();
  db.claims = [claim(), claim({ extraction_id: 'e0000000-0000-0000-0000-000000000002' })];
  const r = new NoticeReader(cfg(), db);
  r.start();
  await until('the finish', () => db.named('notice_read_finish').length > 0);
  await new Promise((res) => setTimeout(res, 500));
  await r.stop();
  const f = db.named('notice_read_finish')[0].args as Record<string, Json>;
  assert.deepEqual([f.p_status, f.p_reason_class, f.p_usage.status, f.p_usage.input_tokens], ['failed', 'api_key', 'error', 0]);
  assert.equal(db.named('notice_read_claim').length, 1, 'no further claim while paused');
  assert.equal(r.info().enabled, false);
  assert.match(r.info().last_error ?? '', /ANTHROPIC_API_KEY/);
  assert.equal(JSON.stringify(db.calls).includes('sk-ant-test-key'), false, 'the key never reaches the database');
});

test('a PDF over the page limit fails before any API call; one outside storage is refused', async () => {
  fake.seen = [];
  reply = readingReply(noticeReading(SPEC));
  const db = new FakeDb();
  db.claims = [claim({ max_pages: 1 }), claim({ extraction_id: 'e0000000-0000-0000-0000-000000000003', document_url: 'http://10.1.2.3/notice.pdf' })];
  const r = new NoticeReader(cfg(), db);
  r.start();
  await until('two finishes', () => db.named('notice_read_finish').length > 1);
  await r.stop();
  const [a, b] = db.named('notice_read_finish').map((c) => c.args as Record<string, Json>);
  assert.deepEqual([a.p_status, a.p_reason_class, a.p_usage, a.p_result.pages], ['failed', 'too_long', null, 2]);
  assert.match(a.p_result.document_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual([b.p_status, b.p_reason_class, b.p_usage], ['failed', 'document_url', null]);
  assert.equal(fake.seen.length, 0, 'nothing sent to the API');
});
