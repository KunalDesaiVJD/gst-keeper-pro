// The notice reader end to end, without the Claude API or the live project:
// the real agent (startAgent) reads notices queued in a LOCAL database that
// carries the notices migrations (served by a local PostgREST), downloads each
// PDF from a stand-in for the app's storage, and asks a stand-in Claude API
// (test/fakeAnthropic.ts) that answers per PDF. Checks what the database then
// holds: fields applied as "auto — verify", issues added, the audit row with
// its cost — and what must never happen (a wrong GSTIN, a scan, a client
// without consent, the day's cap). Skipped unless pointed at a local PostgREST:
//
//   E2E_READ_PGRST=http://127.0.0.1:54396 E2E_JWT_FILE=/path/anon.jwt \
//     node --import tsx --test test/read.e2e.test.ts
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { makeDb } from '../src/db.js';
import { startAgent, type RunningAgent } from '../src/index.js';
import { FakeAnthropic, readingReply, type FakeReply, type Json } from './fakeAnthropic.js';
import { noticePdf, noticeReading, scanPdf, type NoticeSpec } from './readFixtures.js';

const PGRST = process.env.E2E_READ_PGRST;
const JWT = process.env.E2E_JWT_FILE ? fs.readFileSync(process.env.E2E_JWT_FILE, 'utf8').trim() : '';
const skip = !PGRST || !JWT ? 'set E2E_READ_PGRST and E2E_JWT_FILE (local PostgREST only)' : false;
if (PGRST && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(PGRST)) throw new Error('E2E_READ_PGRST must be a local PostgREST');

const AGENT = 'e2e-reader';
const RUN = Date.now().toString(36);
const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The made-up clients: who they are, what their notice PDF is, and how the
// stand-in Claude API answers for it.
interface Party { key: string; name: string; gstin: string; consent: boolean }
const P: Record<string, Party> = {
  a: { key: 'a', name: 'E2E Reader Traders', gstin: '24AAAAA0000A1Z5', consent: true },
  b: { key: 'b', name: 'E2E Mismatch Metals', gstin: '24BBBBB0000B1Z5', consent: true },
  c: { key: 'c', name: 'E2E Scan Steels', gstin: '24CCCCC0000C1Z5', consent: true },
  d: { key: 'd', name: 'E2E No Consent Cottons', gstin: '24DDDDD0000D1Z5', consent: false },
  e: { key: 'e', name: 'E2E Capped Chemicals', gstin: '24EEEEE0000E1Z5', consent: true },
  f: { key: 'f', name: 'E2E Refused Fabrics', gstin: '24FFFFF0000F1Z5', consent: true },
  g: { key: 'g', name: 'E2E Typed Textiles', gstin: '24GGGGG0000G1Z5', consent: true },
};
const spec = (p: Party, gstin = p.gstin): NoticeSpec => ({ gstin, name: p.name, ref: `ZD24E2E${p.key.toUpperCase()}${RUN}`.toUpperCase() });

// Stand-in storage (/storage/v1/object/public/return-pdfs/…) and PostgREST
// under /rest/v1, on one local origin — as Supabase serves them.
const files = new Map<string, Buffer>();
let gateway: http.Server | null = null;
let SUPA = 'http://127.0.0.1:1';
function startGateway(): Promise<string> {
  gateway = http.createServer((req, res) => {
    const url = req.url || '/';
    const store = '/storage/v1/object/public/return-pdfs/';
    if (url.startsWith(store)) {
      const f = files.get(url.slice(store.length));
      res.writeHead(f ? 200 : 404, { 'content-type': f ? 'application/pdf' : 'text/plain' });
      res.end(f ?? 'not found');
      req.resume();
      return;
    }
    if (!url.startsWith('/rest/v1/')) { res.writeHead(404); res.end(); req.resume(); return; }
    const target = new URL(PGRST + url.slice('/rest/v1'.length));
    const up = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  return new Promise((resolve) => gateway!.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(gateway!.address() as AddressInfo).port}`)));
}

// The stand-in Claude API answers by the PDF it is sent.
const replies = new Map<string, FakeReply>();
const pdfOf = (body: Record<string, Json>) => Buffer.from(String(body?.messages?.[0]?.content?.[0]?.source?.data ?? ''), 'base64');
const fake = new FakeAnthropic((req) => replies.get(sha(pdfOf(req.body))) ?? { status: 400, errorType: 'invalid_request_error' });
const sentFor = (p: Party) => fake.seen.filter((s) => sha(pdfOf(s.body)) === pdfSha[p.key]).length;

let db = makeDb({ supabaseUrl: SUPA, anonKey: JWT || 'x' });
let agent: RunningAgent | null = null;
let dataDir = '';
const clientId: Record<string, string> = {};
const noticeId: Record<string, string> = {};
const pdfSha: Record<string, string> = {};

async function rest(method: string, pathAndQuery: string, body?: unknown, prefer = 'return=representation') {
  const r = await fetch(`${SUPA}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: JWT, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json', Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${pathAndQuery} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const settings = (patch: Record<string, unknown>) => rest('PATCH', 'ai_settings?id=eq.true', patch, 'return=minimal');
const request = (p: Party) => db.rpc<{ queued: boolean; reason?: string; extraction_id?: string }>('notice_read_request',
  { p_notice_id: noticeId[p.key], p_actor_name: 'E2E Tester' });
async function extraction(id: string) {
  const [x] = await db.get<Record<string, Json>[]>(`notice_extractions?id=eq.${id}&select=*`);
  return x;
}
async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 60_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > until) throw new Error('timed out waiting for ' + what);
    await sleep(300);
  }
}
const finished = (id: string) => waitFor(`reading ${id}`, async () => {
  const x = await extraction(id);
  return x && ['done', 'failed', 'cancelled'].includes(x.status) ? x : null;
});
async function notice(p: Party) {
  const [n] = await db.get<Record<string, Json>[]>(`gst_notices?id=eq.${noticeId[p.key]}&select=*`);
  return n;
}
const issues = (p: Party) => db.get<Record<string, Json>[]>(`notice_issues?notice_id=eq.${noticeId[p.key]}&select=*&order=seq`);
const audit = (extractionId: string) => db.get<Record<string, Json>[]>(`ai_audit_log?extraction_id=eq.${extractionId}&select=*`);

before(async () => {
  if (skip) return;
  SUPA = await startGateway();
  db = makeDb({ supabaseUrl: SUPA, anonKey: JWT });
  await fake.start();

  // Reading off while the test sets up; the autopilot stays off throughout.
  // The office agent is the runner here (the Edge Function is the default since 20261009100000).
  await settings({ read_enabled: false, auto_read_new: false, daily_cap_usd: 10, model: 'claude-opus-5-5', effort: 'high', max_pages: 60, runner: 'office_agent' });
  await rest('PATCH', 'autopilot_settings?id=eq.true', { enabled: false }, 'return=minimal');

  for (const p of Object.values(P)) {
    const [row] = await db.get<{ id: string }[]>(`clients?gstin=eq.${p.gstin}&select=id`);
    clientId[p.key] = row?.id ?? (await rest('POST', 'clients', [{ name: p.name, gstin: p.gstin }]))[0].id;
  }
  const consenting = Object.values(P).filter((p) => p.consent).map((p) => clientId[p.key]);
  await db.rpc('ai_set_consent', { p_client_ids: consenting, p_consent_at: '2026-10-01', p_note: 'E2E engagement letter', p_opt_out: false });
  await db.rpc('ai_set_consent', { p_client_ids: [clientId.d], p_consent_at: null, p_note: null, p_opt_out: false });

  // Each client's notice PDF and the stand-in API's answer to it.
  const pdfs: Record<string, Uint8Array> = {
    a: await noticePdf(spec(P.a)),
    b: await noticePdf(spec(P.b, '24ZZZZZ9999Z1Z5')),
    c: await scanPdf(),
    d: await noticePdf(spec(P.d)),
    e: await noticePdf(spec(P.e)),
    f: await noticePdf(spec(P.f)),
    g: await noticePdf(spec(P.g)),
  };
  for (const [k, bytes] of Object.entries(pdfs)) {
    pdfSha[k] = sha(bytes);
    files.set(`notices/${clientId[k]}/e2e-${RUN}-${k}.pdf`, Buffer.from(bytes));
  }
  replies.set(pdfSha.a, readingReply(noticeReading(spec(P.a)), { input_tokens: 12000, output_tokens: 2500 }));
  replies.set(pdfSha.b, readingReply(noticeReading(spec(P.b, '24ZZZZZ9999Z1Z5'))));
  replies.set(pdfSha.c, readingReply(noticeReading(spec(P.c))));
  replies.set(pdfSha.d, readingReply(noticeReading(spec(P.d))));
  replies.set(pdfSha.e, readingReply(noticeReading(spec(P.e))));
  replies.set(pdfSha.f, { blocks: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null }, usage: { input_tokens: 9000, output_tokens: 0 } });
  replies.set(pdfSha.g, readingReply(noticeReading(spec(P.g))));

  for (const p of Object.values(P)) {
    const typed = p.key === 'g' ? { due_date: '2026-10-25', hearing_note: 'Typed by staff: 10:30 AM' } : {};
    const [n] = await rest('POST', 'gst_notices', [{
      client_id: clientId[p.key], portal_key: `e2e-read-${RUN}-${p.key}`, source: 'notices', notice_type: 'Notice',
      description: 'Show Cause Notice (Form GST DRC-01)', reference_number: spec(P[p.key]).ref, issue_date: '2026-10-01',
      pdf_url: `${SUPA}/storage/v1/object/public/return-pdfs/notices/${clientId[p.key]}/e2e-${RUN}-${p.key}.pdf`, ...typed,
    }]);
    noticeId[p.key] = n.id;
  }

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstk-read-e2e-'));
  agent = await startAgent({
    env: {},
    config: {
      supabaseUrl: SUPA, anonKey: JWT, dataDir, headful: false, maxWorkers: 1, pollMs: 1000, heartbeatMs: 1000, agentId: AGENT,
      anthropicApiKey: 'sk-ant-e2e-not-a-real-key', anthropicBaseUrl: fake.url, readerPollMs: 500,
    },
  });
});

after(async () => {
  const a = agent;
  agent = null;
  if (a) await a.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  await fake.stop();
  gateway?.closeAllConnections?.();
  gateway?.close();
});

let readingA = '';

test('switched off: nothing is queued or claimed', { skip }, async () => {
  assert.deepEqual(await request(P.a), { queued: false, reason: 'off' });
  // One queued while it was on stays queued while it is off.
  const [x] = await rest('POST', 'notice_extractions', [{
    notice_id: noticeId.a, client_id: clientId.a, source: 'ai', status: 'queued', priority: 50,
    document_url: `${SUPA}/storage/v1/object/public/return-pdfs/notices/${clientId.a}/e2e-${RUN}-a.pdf`, document_label: 'Notice PDF',
  }]);
  readingA = x.id;
  await sleep(2500);
  assert.equal((await extraction(readingA)).status, 'queued');
  assert.equal(fake.seen.length, 0, 'no API call while reading is off');
});

test('a client without consent is never claimed, and nothing of it is sent', { skip }, async () => {
  const [x] = await rest('POST', 'notice_extractions', [{
    notice_id: noticeId.d, client_id: clientId.d, source: 'ai', status: 'queued', priority: 99,
    document_url: `${SUPA}/storage/v1/object/public/return-pdfs/notices/${clientId.d}/e2e-${RUN}-d.pdf`,
  }]);
  await settings({ read_enabled: true });
  assert.deepEqual(await request(P.d), { queued: false, reason: 'no_consent' });
  const done = await finished(x.id);
  assert.deepEqual([done.status, done.reason_class, done.agent_id, done.claimed_at], ['cancelled', 'no_consent', null, null]);
  assert.equal(sentFor(P.d), 0);
  assert.deepEqual(await audit(x.id), []);
});

test('a notice read: checked fields applied as "auto — verify", issues added, the call audited with its cost', { skip }, async () => {
  const x = await finished(readingA);
  assert.equal(x.status, 'done', x.error);
  assert.equal(x.outcome, 'applied');
  assert.deepEqual([x.pages, x.text_layer, x.model, x.document_sha256], [2, true, 'claude-opus-5-5', pdfSha.a]);
  assert.equal(x.checks.quotes.failed.length, 0, JSON.stringify(x.checks.quotes));
  assert.equal(x.checks.gstin.ok, true);
  assert.equal(x.checks.sums.ok, true);
  assert.equal(x.checks.issues_added, 2);
  assert.equal(x.fields.section_of_law.quote_ok, true);
  assert.equal(x.detail.documents_asked.length, 2);

  const n = await notice(P.a);
  assert.equal(n.section_of_law, '73(1)');
  assert.equal(n.financial_year, '2019-20');
  assert.equal(n.period_from, '2019-04-01');
  assert.equal(n.period_to, '2020-03-31');
  assert.equal(n.din, '20261001TEST000123');
  assert.equal(n.due_date, '2026-10-31');
  assert.equal(n.due_date_source, 'read');
  assert.equal(n.hearing_date, '2026-11-05');
  assert.equal(n.hearing_note, '11:00 AM · Room No. 5, GST Bhavan, Ahmedabad');
  assert.equal(n.issued_by, 'R. K. Testofficer, Assistant Commissioner, Ghatak 99, Ahmedabad');
  assert.deepEqual(n.demand, {
    cgst: { tax: 75000, interest: 13500, penalty: 7500, fee: 0, others: 0 },
    sgst: { tax: 75000, interest: 13500, penalty: 7500, fee: 0, others: 0 },
  });
  assert.equal(Number(n.demand_total), 192000);
  assert.equal(Number(n.amount_of_demand), 192000);
  const applied = ['section_of_law', 'financial_year', 'period_from', 'period_to', 'din', 'demand', 'due_date', 'hearing_date', 'hearing_note', 'issued_by', 'amount_of_demand'];
  assert.deepEqual(Object.keys(n.read_fields).sort(), [...applied].sort());
  for (const k of applied) {
    assert.equal(n.read_fields[k].source, 'ai', k);
    assert.equal(n.read_fields[k].verified, false, k);
    assert.equal(n.read_fields[k].extraction_id, readingA, k);
  }

  const iss = await issues(P.a);
  assert.deepEqual(iss.map((i) => [i.seq, i.issue_code, Number(i.amount), i.source, i.verified, i.page, i.extraction_id]), [
    [1, 'LIAB_GSTR1_V_3B', 50000, 'extracted', false, 1, readingA],
    [2, 'ITC_2A_V_3B', 100000, 'extracted', false, 1, readingA],
  ]);
  assert.equal(iss[0].period_from, '2019-04-01');
  assert.match(iss[1].quote, /Rs\. 1,00,000/);

  const [row, ...more] = await audit(readingA);
  assert.equal(more.length, 0, 'one audit row per API call');
  assert.equal(row.purpose, 'notice_read');
  assert.deepEqual([row.model, row.input_tokens, row.output_tokens, row.status, row.agent_id, row.document_sha256],
    ['claude-opus-5-5', 12000, 2500, 'ok', AGENT, pdfSha.a]);
  assert.equal(Number(row.cost_usd), 0.098, '12,000 in at $4 + 2,500 out at $20 a million');
  assert.match(row.request_id, /^req_fake_\d+$/);

  // What was sent: the PDF and fixed instructions, nothing about the client.
  const sent = fake.seen.find((s) => sha(pdfOf(s.body)) === pdfSha.a)!;
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.output_config.effort, 'high');
  assert.equal(sent.body.fallbacks, 'default');
  assert.equal(sent.headers['x-api-key'], 'sk-ant-e2e-not-a-real-key');
  const withoutPdf = JSON.stringify({ ...sent.body, messages: [{ role: 'user', content: sent.body.messages[0].content.slice(1) }] });
  for (const s of [P.a.name, P.a.gstin, spec(P.a).ref, clientId.a, noticeId.a]) assert.equal(withoutPdf.includes(s), false, s);
});

test('a value staff typed is never replaced: recorded as a conflict', { skip }, async () => {
  const r = await request(P.g);
  assert.equal(r.queued, true);
  const x = await finished(r.extraction_id!);
  assert.equal(x.status, 'done', x.error);
  assert.equal(x.outcome, 'conflict');
  assert.deepEqual(Object.keys(x.checks.conflicts).sort(), ['due_date', 'hearing_note']);
  const n = await notice(P.g);
  assert.deepEqual([n.due_date, n.hearing_note], ['2026-10-25', 'Typed by staff: 10:30 AM']);
  assert.equal(n.read_fields.due_date, undefined);
  assert.equal(n.section_of_law, '73(1)', 'empty fields are still filled');
  assert.equal((await issues(P.g)).length, 2);
});

test('a notice addressed to another GSTIN applies nothing', { skip }, async () => {
  const r = await request(P.b);
  const x = await finished(r.extraction_id!);
  assert.equal(x.status, 'done', x.error);
  assert.equal(x.outcome, 'gstin_mismatch');
  assert.deepEqual(x.checks.gstin, { expected: P.b.gstin, found: '24ZZZZZ9999Z1Z5', ok: false });
  const n = await notice(P.b);
  assert.deepEqual([n.section_of_law, n.due_date, n.demand, n.hearing_note, n.issued_by], [null, null, null, null, null]);
  assert.deepEqual(n.read_fields, {});
  assert.deepEqual(await issues(P.b), []);
  assert.equal((await audit(r.extraction_id!)).length, 1, 'the call is still audited');
});

test('a scan applies nothing: no quote can be checked', { skip }, async () => {
  const r = await request(P.c);
  const x = await finished(r.extraction_id!);
  assert.equal(x.status, 'done', x.error);
  assert.equal(x.text_layer, false);
  assert.equal(x.outcome, 'nothing_new');
  assert.equal(x.checks.quotes.ok, 0);
  assert.equal(x.detail.issues_withheld.length, 2);
  assert.deepEqual(x.issues, []);
  const n = await notice(P.c);
  assert.deepEqual(n.read_fields, {});
  assert.deepEqual([n.section_of_law, n.due_date, n.demand], [null, null, null]);
  assert.deepEqual(await issues(P.c), []);
});

test('a refusal fails the reading with reason refused, audited as refused', { skip }, async () => {
  const r = await request(P.f);
  const x = await finished(r.extraction_id!);
  assert.deepEqual([x.status, x.reason_class], ['failed', 'refused']);
  const [row] = await audit(r.extraction_id!);
  assert.deepEqual([row.status, row.input_tokens], ['refused', 9000]);
  assert.deepEqual((await notice(P.f)).read_fields, {});
});

test('the day\'s spending cap stops claims until it is raised', { skip }, async () => {
  await settings({ daily_cap_usd: 0.0001 });
  const r = await request(P.e);
  assert.equal(r.queued, true);
  await sleep(3000);
  assert.equal((await extraction(r.extraction_id!)).status, 'queued');
  assert.equal(sentFor(P.e), 0, 'nothing sent while capped');
  await settings({ daily_cap_usd: 10 });
  const x = await finished(r.extraction_id!);
  assert.deepEqual([x.status, x.outcome], ['done', 'applied']);
});

test('the heartbeat reports the reader', { skip }, async () => {
  const hb = await waitFor('heartbeat', async () => {
    const [row] = await db.get<{ info: Record<string, Json> }[]>(`portal_agent_heartbeat?agent_id=eq.${AGENT}&select=info`);
    return row?.info?.reader?.done_today >= 5 && !row.info.reader.busy ? row.info.reader : null;
  }, 15_000);
  assert.equal(hb.enabled, true);
  assert.ok(hb.last_claim_at);
  const status = await db.rpc<Record<string, Json>>('ai_read_status');
  assert.equal(status.queue.running, 0);
});
