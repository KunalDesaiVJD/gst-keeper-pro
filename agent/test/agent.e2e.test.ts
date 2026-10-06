// End to end, without the GST portal: the real agent drives the real
// extension (repo extension/, staged) in Chromium against FakePortal, with a
// LOCAL PostgREST over a database carrying the notices and autopilot
// migrations (see test/README.md). A test plays the person at the CAPTCHA
// wall through the same RPCs the app uses. Never point it at the live project.
//
//   E2E_PGRST=http://127.0.0.1:54397 E2E_JWT_FILE=/path/anon.jwt \
//     node --import tsx --test test/agent.e2e.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { makeDb } from '../src/db.js';
import { startAgent, type RunningAgent } from '../src/index.js';
import { FakePortal } from './fakePortal.js';

const PGRST = process.env.E2E_PGRST;
const JWT = process.env.E2E_JWT_FILE ? fs.readFileSync(process.env.E2E_JWT_FILE, 'utf8').trim() : '';
const skip = !PGRST || !JWT ? 'set E2E_PGRST and E2E_JWT_FILE (local PostgREST only)' : false;
if (PGRST && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(PGRST)) throw new Error('E2E_PGRST must be a local PostgREST');

// Supabase serves PostgREST under /rest/v1 and Storage under /storage/v1;
// this stand-in gateway does the same in front of the local PostgREST.
let gateway: http.Server | null = null;
let SUPA = 'http://127.0.0.1:1';
function startGateway(): Promise<string> {
  gateway = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const url = req.url || '/';
    if (url.startsWith('/storage/v1/')) { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end('{}'); req.resume(); return; }
    if (!url.startsWith('/rest/v1/')) { res.writeHead(404, cors); res.end(); req.resume(); return; }
    const target = new URL(PGRST + url.slice('/rest/v1'.length));
    const up = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
      res.writeHead(r.statusCode || 502, { ...r.headers, ...cors });
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502, cors); res.end(); });
    req.pipe(up);
  });
  return new Promise((resolve) => gateway!.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(gateway!.address() as AddressInfo).port}`)));
}
let db = makeDb({ supabaseUrl: SUPA, anonKey: JWT || 'x' });
const portal = new FakePortal();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PERSON = 'e2e00000-0000-0000-0000-0000000000aa';
let agent: RunningAgent | null = null;
let dataDir = '';
const ids: Record<string, string> = {};

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 90_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > until) throw new Error('timed out waiting for ' + what);
    await sleep(700);
  }
}
async function job(clientId: string) {
  const rows = await db.get<{ id: string; status: string; reason_class: string | null; captcha_count: number; error: string | null }[]>(
    `portal_jobs?client_id=eq.${clientId}&job_type=eq.PULL_NOTICES_BUNDLE&select=id,status,reason_class,captcha_count,error&order=created_at.desc&limit=1`);
  return rows[0];
}
// The person at the wall: keeps the wall open and answers what it is told to.
let answering: ((c: { client_name: string; attempt: number }) => { action: string; text?: string } | null) | null = null;
let wallOpen = false;
async function wallLoop() {
  while (agent) {
    if (wallOpen) {
      const w = await db.rpc<{ captchas: { job_id: string; prompt_id: string; client_name: string; attempt: number }[] }>(
        'autopilot_wall_ping', { p_user_id: PERSON, p_name: 'Test Person' });
      for (const c of w.captchas) {
        const a = answering?.(c);
        if (a) await db.rpc('portal_job_answer', { p_job_id: c.job_id, p_prompt_id: c.prompt_id, p_text: a.text ?? null, p_action: a.action, p_typing_ms: 4000, p_user_id: PERSON, p_user_name: 'Test Person' });
      }
    }
    await sleep(1200);
  }
}

before(async () => {
  if (skip) return;
  SUPA = await startGateway();
  db = makeDb({ supabaseUrl: SUPA, anonKey: JWT });
  const clients = [
    { name: 'Asha Traders', gstin: '24ASHAT0000A1Z5', user: 'asha', pass: 'right-pass', portalPass: 'right-pass' },
    { name: 'Bina Metals', gstin: '24BINAM0000B1Z5', user: 'bina', pass: 'old-pass', portalPass: 'new-pass' },
    { name: 'Chetan Mills', gstin: '24CHETA0000C1Z5', user: 'chetan', pass: 'c-pass', portalPass: 'c-pass' },
  ];
  for (const c of clients) {
    const [row] = await db.get<{ id: string }[]>(`clients?gstin=eq.${c.gstin}&select=id`);
    ids[c.user] = row?.id ?? '';
    if (!ids[c.user]) {
      const r = await fetch(SUPA + '/rest/v1/clients', { method: 'POST', headers: { apikey: JWT, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify([{ name: c.name, gstin: c.gstin, gst_user_id: c.user, gst_password: c.pass }]) });
      ids[c.user] = (await r.json())[0].id;
    }
    portal.accounts[c.user] = {
      password: c.portalPass, gstin: c.gstin,
      notices: [
        { noticeOrderId: 'ZD24E2E' + c.user.toUpperCase() + '1', type: 'Notice', descr: 'Notice for liability mismatch (Form GST DRC-01B)', dtOfIssue: '01/10/2026', dueDate: '08/10/2026', docId: 'D' + c.user, applnId: 'A' + c.user },
        { noticeOrderId: 'ZD24E2E' + c.user.toUpperCase() + '2', type: 'Order', descr: 'Registration Certificate', dtOfIssue: '01/06/2025' },
      ],
    };
  }
  await fetch(SUPA + '/rest/v1/clients?gst_user_id=not.in.(asha,bina,chetan)', { method: 'PATCH', headers: { apikey: JWT, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json' }, body: JSON.stringify({ inactive_at_hand: true }) });
  await fetch(SUPA + '/rest/v1/autopilot_settings?id=eq.true', { method: 'PATCH', headers: { apikey: JWT, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false, schedule_enabled: false, concurrency: 1, captcha_refresh_secs: 60 }) });

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstk-agent-e2e-'));
  agent = await startAgent({
    env: {},
    config: { supabaseUrl: SUPA, anonKey: JWT, dataDir, headful: false, maxWorkers: 1, pollMs: 1000, heartbeatMs: 1500, agentId: 'e2e-agent', sessionKey: 'e2e-session-key' },
    route: (ctx) => portal.route(ctx),
  });
  void wallLoop();
});

after(async () => {
  const a = agent;
  agent = null;
  if (a) await a.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  gateway?.close();
});

test('switched off: a queued job is not touched', { skip }, async () => {
  const r = await db.rpc<{ queued: number }>('autopilot_enqueue', { p_client_ids: [ids.asha], p_origin: 'manual' });
  assert.equal(r.queued, 1);
  await sleep(4000);
  assert.equal((await job(ids.asha)).status, 'queued');
  assert.equal(portal.requests, 0, 'no portal request while switched off');
});

test('nobody at the wall: the job waits without opening the portal', { skip }, async () => {
  await fetch(SUPA + '/rest/v1/autopilot_settings?id=eq.true', { method: 'PATCH', headers: { apikey: JWT, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
  await waitFor('parked', async () => (await job(ids.asha)).status === 'waiting_captcha');
  assert.equal(portal.requests, 0, 'the portal was not opened');
});

test('at the wall: a wrong CAPTCHA, then the right one, and the notices are in', { skip }, async () => {
  let seen = 0;
  answering = (c) => {
    if (c.client_name !== 'Asha Traders') return null;
    seen++;
    return seen === 1 ? { action: 'answer', text: '000000' } : { action: 'answer', text: portal.expected };
  };
  wallOpen = true;
  const done = await waitFor('Asha done', async () => { const j = await job(ids.asha); return ['succeeded', 'failed'].includes(j.status) && j; }, 180_000);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.ok(done.captcha_count >= 2, 'shown twice: the first answer was wrong');
  const notices = await db.get<{ portal_key: string; form_code: string | null }[]>(`gst_notices?client_id=eq.${ids.asha}&select=portal_key,form_code`);
  assert.equal(notices.length, 2, 'both notices saved by the extension');
  assert.ok(notices.some((n) => n.form_code === 'DRC-01B'), 'classified on capture');
  const apps = await db.get<unknown[]>(`gst_portal_applications?client_id=eq.${ids.asha}&select=arn`);
  assert.equal(apps.length, 1, 'the appeal on the portal saved');
  const ledger = await db.get<{ step: string; status: string }[]>(`sync_run_items?client_id=eq.${ids.asha}&select=step,status`);
  assert.ok(ledger.some((i) => i.step === 'notices' && i.status === 'ok'), 'notices step in the run ledger');
  assert.ok(portal.log.includes('GET /services/logout'), 'logged out after the client');
});

test('a password the portal rejects fails with the reason, without retries', { skip }, async () => {
  answering = (c) => (c.client_name === 'Bina Metals' ? { action: 'answer', text: portal.expected } : null);
  await db.rpc('autopilot_enqueue', { p_client_ids: [ids.bina], p_origin: 'manual' });
  const done = await waitFor('Bina done', async () => { const j = await job(ids.bina); return ['succeeded', 'failed'].includes(j.status) && j; }, 180_000);
  assert.equal(done.status, 'failed');
  assert.equal(done.reason_class, 'login_failed');
  const st = await db.rpc<{ failures: { reason: string; fix: string | null; clients: { client_id: string }[] }[] }>('autopilot_status');
  const f = st.failures.find((x) => x.clients.some((c) => c.client_id === ids.bina));
  assert.equal(f?.fix, 'password', 'grouped as a password to fix');
});

test('skipped on the wall: cancelled with a named reason', { skip }, async () => {
  answering = (c) => (c.client_name === 'Chetan Mills' ? { action: 'skip' } : null);
  await db.rpc('autopilot_enqueue', { p_client_ids: [ids.chetan], p_origin: 'manual' });
  const done = await waitFor('Chetan done', async () => { const j = await job(ids.chetan); return ['cancelled', 'failed', 'succeeded'].includes(j.status) && j; }, 120_000);
  assert.equal(done.status, 'cancelled');
  assert.equal(done.reason_class, 'skipped_at_wall');
  const ledger = await db.get<{ reason_class: string }[]>(`sync_run_items?client_id=eq.${ids.chetan}&select=reason_class`);
  assert.ok(ledger.some((i) => i.reason_class === 'skipped_at_wall'));
});

test('keep portal sessions: a second job for the client needs no CAPTCHA', { skip }, async () => {
  await fetch(SUPA + '/rest/v1/autopilot_settings?id=eq.true', { method: 'PATCH', headers: { apikey: JWT, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json' }, body: JSON.stringify({ keep_sessions: true }) });
  answering = (c) => (c.client_name === 'Asha Traders' ? { action: 'answer', text: portal.expected } : null);
  await sleep(2500); // the next heartbeat carries the setting
  await db.rpc('autopilot_enqueue', { p_client_ids: [ids.asha], p_origin: 'manual' });
  const first = await waitFor('Asha again', async () => { const j = await job(ids.asha); return ['succeeded', 'failed'].includes(j.status) && j; }, 120_000);
  assert.equal(first.status, 'succeeded');
  assert.ok(fs.readdirSync(path.join(dataDir, 'sessions')).some((f) => f.startsWith(ids.asha)), 'the session is kept, encrypted');
  const kept = fs.readFileSync(path.join(dataDir, 'sessions', ids.asha + '.json'), 'utf8');
  assert.ok(!kept.includes('fsess') && !kept.includes('asha'), 'nothing readable in the kept file');
  const served = portal.captchasServed;
  wallOpen = false; // nobody at the wall: only a kept session can run
  await db.rpc('autopilot_enqueue', { p_client_ids: [ids.asha], p_origin: 'manual' });
  const second = await waitFor('Asha reused', async () => {
    const rows = await db.get<{ status: string; session_reused: boolean; captcha_count: number }[]>(
      `portal_jobs?client_id=eq.${ids.asha}&select=status,session_reused,captcha_count&order=created_at.desc&limit=1`);
    return ['succeeded', 'failed'].includes(rows[0].status) && rows[0];
  }, 120_000);
  assert.equal(second.status, 'succeeded');
  assert.equal(second.session_reused, true);
  assert.equal(second.captcha_count, 0, 'no CAPTCHA the second time');
  assert.equal(portal.captchasServed, served, 'the portal served no CAPTCHA');
  await fetch(SUPA + '/rest/v1/autopilot_settings?id=eq.true', { method: 'PATCH', headers: { apikey: JWT, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json' }, body: JSON.stringify({ keep_sessions: false }) });
  wallOpen = true;
});

test('the heartbeat shows the agent and its worker', { skip }, async () => {
  const st = await db.rpc<{ agent_online: boolean; agents: { agent_id: string; info: { workers: unknown[]; ext_version: string } }[] }>('autopilot_status');
  assert.ok(st.agent_online);
  const a = st.agents.find((x) => x.agent_id === 'e2e-agent');
  assert.ok(a && a.info.workers.length === 1 && a.info.ext_version === '0.6.0');
});
