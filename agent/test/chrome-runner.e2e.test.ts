// End to end for scheduled syncs in the firm's own Chrome (extension 0.7.0,
// extension/runner.js), without the GST portal: the real extension (repo
// extension/, staged the way the office agent stages it) runs in Chromium
// against FakePortal (Playwright routing, no network) and a LOCAL PostgREST over
// a database that carries the notices and autopilot migrations, the Chrome
// runner one (20261008170000) included. A test-only stand-in for the firm's
// CAPTCHA extension fills the CAPTCHA box in one go (runnerHarness.ts,
// CaptchaFiller); nothing in extension/ reads, relays or solves a CAPTCHA.
// Never point it at the live project.
//
//   E2E_RUNNER_PGRST=http://127.0.0.1:54391 E2E_JWT_FILE=/path/anon.jwt \
//     node --import tsx --test test/chrome-runner.e2e.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { makeDb } from '../src/db.js';
import { stageExtension } from '../src/extension.js';
import type { Page } from 'playwright';
import { CaptchaFiller, ChromeRunner, RunnerPortal, sleep, startGateway } from './runnerHarness.js';

const PGRST = process.env.E2E_RUNNER_PGRST;
const JWT = process.env.E2E_JWT_FILE ? fs.readFileSync(process.env.E2E_JWT_FILE, 'utf8').trim() : '';
const skip = !PGRST || !JWT ? 'set E2E_RUNNER_PGRST and E2E_JWT_FILE (local PostgREST only)' : false;
if (PGRST && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(PGRST)) throw new Error('E2E_RUNNER_PGRST must be a local PostgREST');

interface Job {
  id: string; status: string; attempts: number; reason_class: string | null; error: string | null; claimed_by: string | null;
  captcha_count: number; human_prompt: unknown; not_before: string | null; run_id: string | null;
}
interface Status {
  agent_online: boolean;
  runner: string;
  runners: { agent_id: string; kind: string; label: string; version: string; online: boolean; busy: boolean }[];
  failures: { reason: string; clients: { client_id: string }[] }[];
}

const CLIENTS = ['asha', 'bina', 'chetan', 'dina', 'eshan', 'farah', 'gopal', 'hema', 'isha', 'jaya'].map((user, i) => ({
  user, name: `${user[0].toUpperCase()}${user.slice(1)} Runner Test`, gstin: `24RUNR${String(i).padStart(4, '0')}X1Z${i}`, pass: `${user}-pass`,
}));

const portal = new RunnerPortal();
const filler = new CaptchaFiller(portal);
const ids: Record<string, string> = {};
let gateway: { url: string; close: () => void } | null = null;
let db = makeDb({ supabaseUrl: 'http://127.0.0.1:1', anonKey: JWT || 'x' });
let dataDir = '';
let extDir = '';
let A: ChromeRunner | null = null; // the firm's Chrome
let B: ChromeRunner | null = null; // a second Chrome, for the two-runner test

async function rest<T = unknown>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
  const r = await fetch(`${gateway!.url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: JWT, Authorization: `Bearer ${JWT}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${pathAndQuery} -> ${r.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}
const settings = (patch: Record<string, unknown>) => rest('PATCH', 'autopilot_settings?id=eq.true', patch);
const enqueue = (user: string, priority: number | null = null) => db.rpc<{ queued: number; run_id: string | null }>('autopilot_enqueue', {
  p_client_ids: [ids[user]], p_origin: 'manual', p_priority: priority, p_requested_by_name: 'Runner e2e',
});
async function latestJob(user: string): Promise<Job> {
  const rows = await rest<Job[]>('GET', `portal_jobs?client_id=eq.${ids[user]}&job_type=eq.PULL_NOTICES_BUNDLE`
    + '&select=id,status,attempts,reason_class,error,claimed_by,captcha_count,human_prompt,not_before,run_id&order=created_at.desc&limit=1');
  return rows[0];
}
const ended = async (user: string) => { const j = await latestJob(user); return ['succeeded', 'failed', 'cancelled'].includes(j.status) && j; };
async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 90_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}\n${await snapshot()}`);
    await sleep(500);
  }
}
/** What the runners, their pages and the stand-in portal were doing, for a failed wait. */
async function snapshot(): Promise<string> {
  const out: string[] = [];
  for (const [name, r] of [['A', A], ['B', B]] as const) {
    if (!r) continue;
    const st = await r.state().catch((e: Error) => `state: ${e.message}`);
    const aj = await r.activeJob().catch((e: Error) => `slot: ${e.message}`);
    out.push(`${name} state ${JSON.stringify(st)}`, `${name} slot ${JSON.stringify(aj)}`,
      `${name} pages ${r.ctx.pages().map((p) => p.url()).join(' | ')}`);
  }
  out.push(`portal ${portal.fake.log.slice(-20).join(' | ')}`, `fills ${JSON.stringify(filler.fills.slice(-5))}`);
  return out.join('\n');
}
const agentOf = async (r: ChromeRunner) => `chrome:${(await r.api<{ config: { id: string } }>('runnerGet')).config.id}`;
/**
 * A person's Sync in this Chrome: the app's Sync now and the popup call the same
 * function. The test browser cannot route the first load of a tab the extension
 * opens straight on a portal URL (it loads before the routing attaches), so the
 * test loads that tab again; a real Chrome needs no help.
 */
async function personSync(r: ChromeRunner, user: string): Promise<Page> {
  const before = new Set(r.ctx.pages());
  await r.api('startAllClientsSectionPull', { mode: 'notices_bundle', clientIds: [ids[user]] });
  const page = await waitFor("the person's tab", async () => r.ctx.pages().find((p) => !before.has(p)) ?? null);
  await page.goto('https://services.gst.gov.in/services/login').catch(() => {});
  return page;
}
/** The person stops their sync (the popup's Stop) and closes the tab. */
async function personDone(r: ChromeRunner, page: Page) {
  await r.clearJob();
  await page.close().catch(() => {});
}
const starts = (jobId: string) => rest<{ message: string }[]>('GET', `portal_job_events?job_id=eq.${jobId}&step=eq.start&select=message`);

before(async () => {
  if (skip) return;
  gateway = await startGateway(PGRST!);
  db = makeDb({ supabaseUrl: gateway.url, anonKey: JWT });
  // A queue of our own: whatever the copied database still had waiting is cancelled.
  for (const j of await rest<{ id: string }[]>('GET', 'portal_jobs?status=in.(queued,claimed,running,needs_human,waiting_captcha)&select=id')) {
    await db.rpc('portal_job_cancel', { p_job_id: j.id, p_by_name: 'Runner e2e setup' });
  }
  await settings({ enabled: false, paused_until: null, schedule_enabled: false, runner: 'chrome', captcha_wait_secs: 30, max_attempts: 3 });
  for (const c of CLIENTS) {
    const [row] = await rest<{ id: string }[]>('GET', `clients?gstin=eq.${c.gstin}&select=id`);
    const fields = { name: c.name, gst_user_id: c.user, gst_password: c.pass, inactive_at_hand: false, notices_sync_excluded: false };
    ids[c.user] = row ? (await rest<{ id: string }[]>('PATCH', `clients?id=eq.${row.id}`, fields))[0].id
      : (await rest<{ id: string }[]>('POST', 'clients', [{ ...fields, gstin: c.gstin }]))[0].id;
    portal.fake.accounts[c.user] = {
      password: c.pass, gstin: c.gstin,
      notices: [
        { noticeOrderId: `ZD24RUN${c.user.toUpperCase()}1`, type: 'Notice', descr: 'Notice for liability mismatch (Form GST DRC-01B)', dtOfIssue: '01/10/2026', dueDate: '08/10/2026', docId: `D${c.user}`, applnId: `A${c.user}` },
        { noticeOrderId: `ZD24RUN${c.user.toUpperCase()}2`, type: 'Order', descr: 'Registration Certificate', dtOfIssue: '01/06/2025' },
      ],
    };
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstk-runner-e2e-'));
  extDir = stageExtension(loadConfig({}, { supabaseUrl: gateway.url, anonKey: JWT, dataDir })).dir;
  A = await ChromeRunner.launch(extDir, path.join(dataDir, 'chrome-a'), portal, filler);
});

after(async () => {
  await A?.close();
  await B?.close();
  if (A) await settings({ enabled: false, runner: 'chrome', max_attempts: 3 }).catch(() => {});
  gateway?.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a: the runner claims a queued job; the CAPTCHA extension fills the box; login, sync, succeeded, with ledger rows', { skip }, async () => {
  const r = A!;
  assert.equal((await r.api<{ config: { enabled: boolean } }>('runnerGet')).config.enabled, false, 'off until switched on in the popup');
  assert.equal((await enqueue('asha')).queued, 1);
  await r.api('runnerSet', { enabled: true, label: 'Test PC A' });
  const agentA = await agentOf(r);
  // The autopilot is still off in the app: the runner reports and waits.
  await waitFor('the runner to see the autopilot off', async () => (await r.state()).why === 'autopilot_off');
  assert.equal((await latestJob('asha')).status, 'queued');
  assert.equal(portal.fake.requests, 0, 'the portal is not touched while the autopilot is off');

  await settings({ enabled: true });
  await r.tick();
  const done = await waitFor('Asha to finish', () => ended('asha'), 120_000);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.equal(done.claimed_by, agentA);
  assert.equal(done.attempts, 1);
  assert.equal(done.captcha_count, 0, 'no CAPTCHA went to the app');
  assert.equal(done.human_prompt, null);
  const fill = filler.fills.find((f) => f.user === 'asha');
  assert.ok(fill, 'the CAPTCHA extension filled the box');
  assert.equal(fill.marked, null, 'the page was not marked for a CAPTCHA wall');

  const notices = await rest<{ form_code: string | null }[]>('GET', `gst_notices?client_id=eq.${ids.asha}&select=form_code`);
  assert.equal(notices.length, 2, 'both notices saved by the extension');
  assert.ok(notices.some((n) => n.form_code === 'DRC-01B'));
  const ledger = await rest<{ step: string; status: string }[]>('GET', `sync_run_items?run_id=eq.${done.run_id}&client_id=eq.${ids.asha}&select=step,status`);
  assert.ok(ledger.some((i) => i.step === 'notices' && i.status === 'ok'), 'notices step in the run ledger');
  assert.ok(ledger.some((i) => i.step === 'applications'), 'and the rest of the bundle');
  const events = await rest<{ step: string; message: string }[]>('GET', `portal_job_events?job_id=eq.${done.id}&select=step,message&order=created_at`);
  assert.ok(events.some((e) => e.step === 'start' && /Test PC A/.test(e.message)), JSON.stringify(events));
  assert.ok(events.some((e) => e.step === 'finish' && /^succeeded/.test(e.message)), JSON.stringify(events));

  // It logs the portal out and closes the window it opened.
  await waitFor('the runner window to close', async () => (await r.state()).job === null && r.portalPages().length === 0);
  assert.ok(portal.fake.log.filter((l) => l === 'GET /services/logout').length >= 2, 'logged out before and after the client');
  const st = await r.state();
  assert.equal(st.last?.outcome, 'succeeded');

  const status = await db.rpc<Status>('autopilot_status');
  const me = status.runners.find((x) => x.agent_id === agentA);
  assert.ok(me && me.online && me.kind === 'chrome' && me.label === 'Test PC A' && me.version === '0.7.0', JSON.stringify(status.runners));
  assert.equal(status.agent_online, true);
});

test('b: a CAPTCHA not filled in time fails the client with captcha_timeout; the queue retries it; the runner moves on', { skip }, async () => {
  const r = A!;
  filler.allow = (u) => u !== 'bina';
  await enqueue('bina', 95);
  await enqueue('chetan', 60);
  await r.tick();
  const page = await waitFor('Bina at the login', async () => r.portalPages().find((p) => /\/services\/login/.test(p.url())) ?? null);
  const since = await waitFor('the wait for the fill', async () => { const aj = await r.activeJob(); return Number(aj?.captchaWaitSince) || null; });
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-gstk-captcha')), null, 'nothing marks the page for a wall');
  const retried = await waitFor('Bina back on the queue', async () => { const j = await latestJob('bina'); return j.status === 'queued' && j.attempts === 1 && j; }, 90_000);
  assert.ok(Date.now() - since >= 29_000, 'it waited the 30 seconds set in the app');
  assert.equal(retried.reason_class, 'captcha_timeout');
  assert.match(retried.error ?? '', /not filled within 30 seconds/);
  assert.equal(retried.claimed_by, null);
  assert.equal(retried.captcha_count, 0);
  assert.ok(Date.parse(retried.not_before ?? '') > Date.now() + 3 * 60_000, 'tried again after the 5-minute backoff');

  const c = await waitFor('Chetan to finish', () => ended('chetan'), 120_000);
  assert.equal(c.status, 'succeeded', 'the runner moved on to the next client');

  // The backoff over (the test moves its clock), the box is filled this time.
  filler.allow = () => true;
  await rest('PATCH', `portal_jobs?id=eq.${retried.id}`, { not_before: new Date(Date.now() - 1000).toISOString() });
  await r.tick();
  const b2 = await waitFor('Bina to finish', () => ended('bina'), 120_000);
  assert.equal(b2.id, retried.id);
  assert.equal(b2.status, 'succeeded');
  assert.equal(b2.attempts, 2);

  // The last try: failed with the named reason, in the run ledger and under "Needs a person".
  await settings({ max_attempts: 1 });
  filler.allow = (u) => u !== 'dina';
  await enqueue('dina');
  await r.tick();
  const d = await waitFor('Dina to end', () => ended('dina'), 120_000);
  assert.equal(d.status, 'failed');
  assert.equal(d.reason_class, 'captcha_timeout');
  const ledger = await rest<{ step: string; status: string; reason_class: string }[]>('GET', `sync_run_items?run_id=eq.${d.run_id}&client_id=eq.${ids.dina}&select=step,status,reason_class`);
  assert.ok(ledger.some((i) => i.step === 'login' && i.status === 'failed' && i.reason_class === 'captcha_timeout'), JSON.stringify(ledger));
  const status = await db.rpc<Status>('autopilot_status');
  assert.ok(status.failures.some((g) => g.reason === 'captcha_timeout' && g.clients.some((x) => x.client_id === ids.dina)));
  await settings({ max_attempts: 3 });
  filler.allow = () => true;
});

test('c: with the runner set to the office agent, the Chrome runner gets nothing', { skip }, async () => {
  const r = A!;
  const agentA = await agentOf(r);
  await settings({ runner: 'office_agent' });
  await enqueue('eshan');
  const requests = portal.fake.requests;
  await r.tick();
  await sleep(1500);
  await r.tick();
  const st = await r.state();
  assert.equal(st.why, 'office_agent');
  assert.equal(st.job, null);
  const j = await latestJob('eshan');
  assert.equal(j.status, 'queued');
  assert.equal(j.claimed_by, null);
  assert.equal(await db.rpc('portal_job_claim', { p_agent: agentA, p_wall_open: false }), null, 'the queue hands a Chrome nothing');
  assert.equal(portal.fake.requests, requests, 'no portal request');

  await settings({ runner: 'chrome' });
  await r.tick();
  const done = await waitFor('Eshan to finish', () => ended('eshan'), 120_000);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.claimed_by, agentA);
});

test('d: two runners never take the same job', { skip }, async () => {
  B = await ChromeRunner.launch(extDir, path.join(dataDir, 'chrome-b'), portal, filler);
  await B.api('runnerSet', { enabled: true, label: 'Test PC B' });
  const agentA = await agentOf(A!);
  const agentB = await agentOf(B);
  assert.notEqual(agentA, agentB);
  const users = ['farah', 'gopal', 'hema', 'isha'];
  for (const u of users) await enqueue(u);
  await Promise.all([A!.tick(), B.tick()]);
  const jobs = await waitFor('all four to finish', async () => {
    const rows = await Promise.all(users.map(latestJob));
    return rows.every((j) => ['succeeded', 'failed', 'cancelled'].includes(j.status)) && rows;
  }, 180_000);
  for (const j of jobs) {
    assert.equal(j.status, 'succeeded', JSON.stringify(j));
    assert.equal(j.attempts, 1);
    assert.equal((await starts(j.id)).length, 1, 'started once, by one runner');
  }
  const by = new Set(jobs.map((j) => j.claimed_by));
  assert.ok(by.has(agentA) && by.has(agentB), `both runners worked: ${[...by].join(', ')}`);
  const status = await db.rpc<Status>('autopilot_status');
  assert.ok(status.runners.filter((x) => x.online).length >= 2, JSON.stringify(status.runners));
  await B.api('runnerSet', { enabled: false });
});

test("e: a person's sync in this Chrome comes first", { skip }, async () => {
  const r = A!;
  // A person's Sync (the app's Sync now and the popup start the same function) while the runner is idle.
  filler.allow = (u) => u !== 'jaya';
  let person = await personSync(r, 'jaya');
  await enqueue('asha');
  await r.tick();
  await sleep(3000);
  await r.tick();
  const st = await r.state();
  assert.equal(st.why, 'person_sync');
  assert.equal(st.job, null);
  assert.equal((await latestJob('asha')).status, 'queued', 'the runner waits');
  // The person closes the tab without stopping the sync: that sync cannot go on, and the runner does.
  await person.close();
  await r.tick();
  const slot0 = await r.activeJob();
  assert.ok(!slot0 || slot0.runner, "the person's sync without its tab no longer holds the slot");
  const a = await waitFor('Asha to finish', () => ended('asha'), 120_000);
  assert.equal(a.status, 'succeeded');

  // A person starting a sync while a scheduled client waits for its CAPTCHA takes over.
  filler.allow = (u) => u !== 'bina' && u !== 'jaya';
  await enqueue('bina', 95);
  await r.tick();
  await waitFor('Bina waiting for the fill', async () => { const aj = await r.activeJob(); return !!aj?.runner && !!aj.captchaWaitSince; });
  const held = await latestJob('bina');
  assert.equal(held.status, 'running');
  person = await personSync(r, 'jaya');
  const back = await waitFor('Bina given back', async () => { const j = await latestJob('bina'); return j.status === 'queued' && !j.claimed_by && j; });
  assert.equal(back.id, held.id);
  assert.equal(back.attempts, 0, 'no try counted');
  const slot = await r.activeJob();
  assert.ok(slot && !slot.runner, "the person's sync holds the slot");
  await waitFor('the runner window to close', async () => (await r.state()).job === null && r.portalPages().length === 1);
  assert.equal((await r.state()).last?.outcome, 'released');
  const release = await rest<{ message: string }[]>('GET', `portal_job_events?job_id=eq.${held.id}&step=eq.release&select=message`);
  assert.ok(release.some((e) => /person/.test(e.message)), JSON.stringify(release));

  // The person is done: the runner takes Bina again.
  await personDone(r, person);
  filler.allow = () => true;
  await r.tick();
  const b = await waitFor('Bina to finish', () => ended('bina'), 120_000);
  assert.equal(b.status, 'succeeded');
  assert.equal(b.attempts, 1);
});

test('f: Chrome restarting in the middle of a client gives it back to the queue, and it runs again', { skip }, async () => {
  filler.allow = (u) => u !== 'hema';
  await enqueue('hema', 95);
  await A!.tick();
  await waitFor('Hema waiting for the fill', async () => { const aj = await A!.activeJob(); return !!aj?.runner && !!aj.captchaWaitSince; });
  const held = await latestJob('hema');
  assert.equal(held.status, 'running');
  const profile = A!.profile;
  await A!.close(); // Chrome closes …
  filler.allow = () => true;
  A = await ChromeRunner.launch(extDir, profile, portal, filler); // … and opens again
  const done = await waitFor('Hema to finish', () => ended('hema'), 150_000);
  assert.equal(done.id, held.id);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.attempts, 1, 'the interrupted try is not counted');
  const release = await rest<{ message: string }[]>('GET', `portal_job_events?job_id=eq.${held.id}&step=eq.release&select=message`);
  assert.ok(release.some((e) => /restarted|reloaded/.test(e.message)), JSON.stringify(release));
});
