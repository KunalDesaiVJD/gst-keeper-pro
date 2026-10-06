// The inbox watcher (src/mail/inbox.ts) against a fake IMAP server and a fake
// database rpc (test/mail-fixtures.ts): no network, no real mailbox.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  backoffDelay,
  describeImapError,
  inboxConfigFromEnv,
  pollInboxOnce,
  startInboxWatcher,
  type InboxConfig,
  type InboxWatcherDeps,
  type LogLevel,
} from '../src/mail/inbox.js';
import { DEFAULT_PORTAL_SENDERS } from '../src/mail/parse.js';
import { FakeImapServer, fakeRpc, fixtureMessageId, fixtureSource } from './mail-fixtures.js';

const NOW = new Date('2026-10-06T12:00:00Z');
const at = (iso: string) => new Date(iso);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gstk-inbox-test-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
let caseNo = 0;

const cfg: InboxConfig = {
  host: 'imap.example.test',
  port: 993,
  secure: true,
  user: 'notices@demo-ca-firm.example',
  password: 'app-password-1234',
  mailbox: 'INBOX',
  pollSeconds: 120,
  portalSenders: DEFAULT_PORTAL_SENDERS,
};

interface SavedState {
  account: string;
  uidValidity: string;
  lastUid: number;
  pending: Array<{ uid: number; attempts: number; since: string }>;
}

function harness(opts: { enabled?: () => boolean | Promise<boolean> } = {}) {
  const server = new FakeImapServer();
  const db = fakeRpc();
  const logs: Array<{ level: LogLevel; msg: string }> = [];
  let clock = NOW;
  // A folder that does not exist yet: the watcher creates it.
  const stateFile = path.join(tmpRoot, `case-${++caseNo}`, 'inbox-state.json');
  const deps: InboxWatcherDeps = {
    rpc: db.rpc,
    log: (level, msg) => logs.push({ level, msg }),
    isEnabled: opts.enabled ?? (() => true),
    stateFile,
    now: () => clock,
    createClient: server.factory,
  };
  return {
    server,
    db,
    logs,
    deps,
    stateFile,
    state: (): SavedState => JSON.parse(fs.readFileSync(stateFile, 'utf8')),
    setNow: (d: Date) => {
      clock = d;
    },
    fetched: () => server.calls.filter((c) => c.startsWith('fetch')),
  };
}

/** The same e-mail under another Message-ID. */
function withMessageId(source: Buffer, id: string): Buffer {
  return Buffer.from(source.toString('utf8').replace(/^Message-ID:.*$/im, `Message-ID: ${id}`), 'utf8');
}

const DRC01B = fixtureMessageId('drc01b-direct.eml');
const GSTR3A = fixtureMessageId('gstr3a-defaulter.eml');
const REG17 = fixtureMessageId('reg17-scn.eml');
const GMAIL_FWD = fixtureMessageId('forwarded-gmail.eml');

// ── Reading ────────────────────────────────────────────────────────────────

test('first poll: looks back two days by date, read-only, and remembers the newest UID', async () => {
  const h = harness();
  h.server.add(fixtureSource('drc01b-direct.eml'), at('2026-09-30T05:00:00Z')); // uid 1: older than two days
  h.server.add(fixtureSource('non-portal.eml'), at('2026-10-03T23:00:00Z')); // uid 2: the day before the window
  h.server.add(fixtureSource('gstr3a-defaulter.eml'), at('2026-10-04T03:00:00Z')); // uid 3
  h.server.add(fixtureSource('non-portal.eml'), at('2026-10-05T09:00:00Z')); // uid 4: not from the portal
  h.server.add(fixtureSource('forwarded-gmail.eml'), at('2026-10-06T06:00:00Z')); // uid 5: forwarded by a client

  const r = await pollInboxOnce(cfg, h.deps);

  assert.equal(r.ok, true);
  assert.equal(r.lookback, true);
  assert.equal(r.read, 3);
  assert.equal(r.portal, 2);
  assert.deepEqual(r.statuses, { queued: 2 });
  assert.deepEqual(h.server.calls, [
    'connect', 'open INBOX read-only', 'search since 2026-10-04', 'fetch 3', 'fetch 4', 'fetch 5', 'logout',
  ]);

  const ingests = h.db.ingests();
  assert.deepEqual(ingests.map((c) => c.args.p_message_id), [GSTR3A, GMAIL_FWD]);
  const { p_snippet, ...args } = ingests[0].args;
  assert.deepEqual(args, {
    p_message_id: GSTR3A,
    p_received_at: '2026-10-04T03:00:00.000Z', // when it reached the inbox (INTERNALDATE)
    p_from: 'noreply@gst.gov.in',
    p_subject: 'Notice to return defaulter u/s 46 for not filing return',
    p_gstins: ['24ZZZZB0002B1ZV'],
    p_form_code: 'GSTR-3A',
    p_reference: 'ZA2410260004567',
  });
  assert.ok(typeof p_snippet === 'string' && p_snippet.startsWith('Dear Taxpayer,') && p_snippet.length <= 400);
  assert.equal(ingests[1].args.p_from, 'accounts@sample-agro.example');
  assert.equal(ingests[1].args.p_form_code, 'DRC-01C');

  assert.deepEqual(h.db.reports().map((c) => c.args), [{ p_address: 'notices@demo-ca-firm.example', p_error: null }]);
  const s = h.state();
  assert.deepEqual([s.uidValidity, s.lastUid, s.pending], ['1001', 5, []]);
  assert.ok(!h.logs.some((l) => /Dear Taxpayer|24ZZZZ|ZA24|ZD24/.test(l.msg)), 'no body, GSTIN or reference is logged');
});

test('later polls read only messages after the last UID; "n:*" past the end reads nothing', async () => {
  const h = harness();
  h.server.add(fixtureSource('drc01b-direct.eml'), at('2026-10-06T05:00:00Z')); // uid 1
  await pollInboxOnce(cfg, h.deps);
  assert.equal(h.state().lastUid, 1);

  h.server.add(fixtureSource('reg17-scn.eml'), at('2026-10-06T10:00:00Z')); // uid 2
  h.server.add(fixtureSource('non-portal.eml'), at('2026-10-06T10:05:00Z')); // uid 3
  h.server.calls.length = 0;
  const r2 = await pollInboxOnce(cfg, h.deps);
  assert.equal(r2.lookback, false);
  assert.equal(r2.read, 2);
  assert.equal(r2.portal, 1);
  assert.deepEqual(h.server.calls, ['connect', 'open INBOX read-only', 'search uid 2:*', 'fetch 2', 'fetch 3', 'logout']);
  assert.deepEqual(h.db.ingests().map((c) => c.args.p_message_id), [DRC01B, REG17]);
  assert.equal(h.state().lastUid, 3);

  h.server.calls.length = 0;
  const r3 = await pollInboxOnce(cfg, h.deps);
  assert.equal(r3.read, 0);
  assert.deepEqual(h.server.calls, ['connect', 'open INBOX read-only', 'search uid 4:*', 'logout'],
    'the newest message, which "4:*" returns, is not read again');
  assert.equal(h.db.ingests().length, 2);
});

test('a new UIDVALIDITY (the server renumbered the mailbox) looks back two days again', async () => {
  const h = harness();
  h.server.add(fixtureSource('non-portal.eml'), at('2026-09-20T05:00:00Z')); // uid 1: old
  h.server.add(fixtureSource('drc01b-direct.eml'), at('2026-10-05T05:00:00Z')); // uid 2
  h.server.add(fixtureSource('reg17-scn.eml'), at('2026-10-06T05:00:00Z')); // uid 3
  await pollInboxOnce(cfg, h.deps);
  assert.deepEqual([h.state().uidValidity, h.state().lastUid], ['1001', 3]);

  h.server.renumber(2002n);
  h.server.add(fixtureSource('gstr3a-defaulter.eml'), at('2026-10-06T11:00:00Z')); // uid 4
  h.server.calls.length = 0;
  const r = await pollInboxOnce(cfg, h.deps);

  assert.equal(r.lookback, true);
  assert.ok(h.server.calls.includes('search since 2026-10-04'));
  assert.deepEqual(h.fetched(), ['fetch 2', 'fetch 3', 'fetch 4']);
  // Sent again: portal_email_ingest is idempotent on the message id.
  assert.deepEqual(h.db.ingests().map((c) => c.args.p_message_id), [DRC01B, REG17, DRC01B, REG17, GSTR3A]);
  assert.deepEqual([h.state().uidValidity, h.state().lastUid], ['2002', 4]);
  assert.ok(h.logs.some((l) => l.level === 'warn' && /renumbered the mailbox \(UIDVALIDITY 1001 -> 2002\)/.test(l.msg)));
});

test('another mailbox or account starts afresh', async () => {
  const h = harness();
  h.server.add(fixtureSource('drc01b-direct.eml'), at('2026-10-06T05:00:00Z'));
  await pollInboxOnce(cfg, h.deps);
  h.server.calls.length = 0;
  const r = await pollInboxOnce({ ...cfg, mailbox: 'GST Portal' }, h.deps);
  assert.equal(r.lookback, true);
  assert.deepEqual(h.server.calls.slice(0, 3), ['connect', 'open GST Portal read-only', 'search since 2026-10-04']);
  assert.deepEqual(h.db.reports().at(-1)?.args, { p_address: 'notices@demo-ca-firm.example (GST Portal)', p_error: null });
});

test('a server that sends no UIDNEXT: the newest UID is asked for', async () => {
  const h = harness();
  h.server.sendUidNext = false;
  h.server.add(fixtureSource('non-portal.eml'), at('2026-09-01T00:00:00Z'));
  h.server.add(fixtureSource('non-portal.eml'), at('2026-09-02T00:00:00Z'));
  const r = await pollInboxOnce(cfg, h.deps);
  assert.equal(r.read, 0);
  assert.deepEqual(h.fetched(), ['fetch *']);
  assert.equal(h.state().lastUid, 2);
});

test('an e-mail without a Message-ID is recorded as uid:<uidValidity>:<uid>@<mailbox>', async () => {
  const h = harness();
  const src = fixtureSource('drc01b-direct.eml').toString('utf8').replace(/^Message-ID:.*\r\n/im, '');
  h.server.add(src, at('2026-10-06T08:00:00Z'));
  await pollInboxOnce(cfg, h.deps);
  assert.equal(h.db.ingests()[0].args.p_message_id, 'uid:1001:1@INBOX');
});

test('the state file is replaced after every message, through a temporary file', async () => {
  const h = harness();
  for (const f of ['drc01b-direct.eml', 'gstr3a-defaulter.eml', 'reg17-scn.eml']) {
    h.server.add(fixtureSource(f), at('2026-10-06T08:00:00Z'));
  }
  const lastUidSeen: number[] = [];
  h.db.onIngest = async () => {
    lastUidSeen.push(fs.existsSync(h.stateFile) ? h.state().lastUid : 0);
  };
  await pollInboxOnce(cfg, h.deps);
  assert.deepEqual(lastUidSeen, [0, 1, 2]);
  assert.deepEqual(fs.readdirSync(path.dirname(h.stateFile)), ['inbox-state.json'], 'no temporary file is left');
});

// ── Failures ───────────────────────────────────────────────────────────────

test('an ingest error on one message does not stop the others; it is tried again next poll', async () => {
  const h = harness();
  const ids = ['drc01b-direct.eml', 'gstr3a-defaulter.eml', 'reg17-scn.eml'].map((f) => {
    h.server.add(fixtureSource(f), at('2026-10-06T08:00:00Z'));
    return fixtureMessageId(f);
  });
  h.db.fail = (c) =>
    c.fn === 'portal_email_ingest' && c.args.p_message_id === ids[1] ? new Error('POST rpc/portal_email_ingest -> 500 boom') : null;

  const r = await pollInboxOnce(cfg, h.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.statuses, { queued: 2 });
  assert.equal(r.failed, 1);
  assert.equal(r.pending, 1);
  assert.deepEqual(h.db.ingests().map((c) => c.args.p_message_id), ids, 'all three were tried, in order');
  assert.equal(h.state().lastUid, 3);
  assert.deepEqual(h.state().pending.map((p) => [p.uid, p.attempts]), [[2, 1]]);
  assert.equal(h.db.reports().at(-1)?.args.p_error, '1 e-mail not recorded yet, will retry: POST rpc/portal_email_ingest -> 500 boom');
  assert.ok(h.logs.some((l) => l.level === 'warn' && /uid 2 could not be recorded .*will try again \(attempt 1\)/.test(l.msg)));

  h.db.fail = () => null;
  h.server.calls.length = 0;
  const r2 = await pollInboxOnce(cfg, h.deps);
  assert.deepEqual(h.fetched(), ['fetch 2'], 'only the one waiting');
  assert.deepEqual(r2.statuses, { queued: 1 });
  assert.deepEqual(h.state().pending, []);
  assert.equal(h.db.reports().at(-1)?.args.p_error, null);
});

test('a message the server cannot fetch is kept for later; the rest are read', async () => {
  const h = harness();
  for (const f of ['drc01b-direct.eml', 'gstr3a-defaulter.eml', 'reg17-scn.eml']) {
    h.server.add(fixtureSource(f), at('2026-10-06T08:00:00Z'));
  }
  h.server.failFetch.add(2);
  const r = await pollInboxOnce(cfg, h.deps);
  assert.equal(r.ok, true);
  assert.equal(r.failed, 1);
  assert.deepEqual(h.db.ingests().map((c) => c.args.p_message_id), [DRC01B, REG17]);
  assert.deepEqual(h.state().pending.map((p) => p.uid), [2]);
  assert.equal(h.db.reports().at(-1)?.args.p_error, '1 e-mail not recorded yet, will retry: Command failed: Internal server error');

  h.server.failFetch.clear();
  await pollInboxOnce(cfg, h.deps);
  assert.deepEqual(h.db.ingests().map((c) => c.args.p_message_id), [DRC01B, REG17, GSTR3A]);
  assert.deepEqual(h.state().pending, []);
});

test('a connection lost in the middle of a poll ends it; the next poll starts again from that message', async () => {
  const h = harness();
  for (const f of ['drc01b-direct.eml', 'gstr3a-defaulter.eml', 'reg17-scn.eml']) {
    h.server.add(fixtureSource(f), at('2026-10-06T08:00:00Z'));
  }
  h.server.dropOnFetch.add(2);
  const r = await pollInboxOnce(cfg, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'imap.example.test:993 closed the connection');
  assert.equal(h.state().lastUid, 1, 'saved after the first message only');
  assert.equal(h.db.reports().at(-1)?.args.p_error, r.error);

  h.server.dropOnFetch.clear();
  h.server.calls.length = 0;
  const r2 = await pollInboxOnce(cfg, h.deps);
  assert.equal(r2.ok, true);
  assert.deepEqual(h.fetched(), ['fetch 2', 'fetch 3']);
  assert.equal(h.state().lastUid, 3);
  assert.deepEqual(h.db.ingests().map((c) => c.args.p_message_id), [DRC01B, GSTR3A, REG17]);
});

test('when the database stops answering, the rest wait for the next poll untried', async () => {
  const h = harness();
  for (let i = 1; i <= 5; i++) {
    h.server.add(withMessageId(fixtureSource('drc01b-direct.eml'), `<copy-${i}@fixture.example>`), at('2026-10-06T08:00:00Z'));
  }
  h.db.fail = (c) => (c.fn === 'portal_email_ingest' ? new Error('fetch failed') : null);
  const r = await pollInboxOnce(cfg, h.deps);
  assert.equal(r.ok, true, 'the inbox itself was read');
  assert.equal(h.db.ingests().length, 3, 'three failures in a row, then no more tries this poll');
  assert.equal(r.failed, 5);
  assert.equal(r.pending, 5);
  assert.deepEqual(h.state().pending.map((p) => [p.uid, p.attempts]), [[1, 1], [2, 1], [3, 1], [4, 0], [5, 0]]);
  assert.equal(h.state().lastUid, 5);

  h.db.fail = () => null;
  const r2 = await pollInboxOnce(cfg, h.deps);
  assert.deepEqual(r2.statuses, { queued: 5 });
  assert.equal(r2.pending, 0);
});

test('an e-mail the database keeps refusing is given up after 24 hours', async () => {
  const h = harness();
  h.server.add(fixtureSource('drc01b-direct.eml'), at('2026-10-06T08:00:00Z'));
  h.db.fail = (c) => (c.fn === 'portal_email_ingest' ? new Error('400 invalid input') : null);
  await pollInboxOnce(cfg, h.deps);
  h.setNow(new Date(NOW.getTime() + 23 * 3600_000));
  await pollInboxOnce(cfg, h.deps);
  assert.deepEqual(h.state().pending.map((p) => [p.uid, p.attempts]), [[1, 2]]);
  h.setNow(new Date(NOW.getTime() + 25 * 3600_000));
  await pollInboxOnce(cfg, h.deps);
  assert.deepEqual(h.state().pending, []);
  assert.ok(h.logs.some((l) => l.level === 'error' && /uid 1 could not be recorded .*giving up after 3 attempts over 24 hours/.test(l.msg)));
});

test('a refused login is reported with its reason, never the password, and nothing is saved', async () => {
  const h = harness();
  h.server.failLogin = true;
  const r = await pollInboxOnce(cfg, h.deps);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /^login refused for notices@demo-ca-firm\.example \(Invalid credentials \(Failure\)\): check IMAP_USER and IMAP_PASSWORD/);
  assert.deepEqual(h.db.reports().map((c) => c.args), [{ p_address: 'notices@demo-ca-firm.example', p_error: r.error }]);
  assert.equal(h.db.ingests().length, 0);
  assert.equal(fs.existsSync(h.stateFile), false);
  assert.ok(!JSON.stringify(h.db.calls).includes(cfg.password));
});

test('a mailbox that cannot be opened is reported by name', async () => {
  const h = harness();
  h.server.failOpen = true;
  const r = await pollInboxOnce({ ...cfg, mailbox: 'Notices' }, h.deps);
  assert.equal(r.error, `cannot open mailbox "Notices": Mailbox doesn't exist: Notices`);
});

test('error text never carries the password', () => {
  const text = describeImapError(new Error(`server said: bad password ${cfg.password}`), cfg, 'fetch');
  assert.equal(text, 'server said: bad password ***');
  assert.equal(describeImapError(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }), cfg, 'connect'),
    'cannot find the mail server imap.example.test');
  assert.equal(describeImapError(Object.assign(new Error('x'), { code: 'CONNECT_TIMEOUT' }), cfg, 'connect'),
    'imap.example.test:993 did not answer in time');
});

test('with the e-mail switch off nothing connects and nothing is reported', async () => {
  const off = harness({ enabled: () => false });
  off.server.add(fixtureSource('drc01b-direct.eml'), at('2026-10-06T08:00:00Z'));
  const r = await pollInboxOnce(cfg, off.deps);
  assert.equal(r.skipped, 'disabled');
  assert.equal(off.server.clients, 0);
  assert.deepEqual(off.db.calls, []);

  const offAsync = harness({ enabled: async () => false });
  assert.equal((await pollInboxOnce(cfg, offAsync.deps)).skipped, 'disabled');
  assert.equal(offAsync.server.clients, 0);

  const broken = harness({
    enabled: () => {
      throw new Error('settings not loaded');
    },
  });
  assert.equal((await pollInboxOnce(cfg, broken.deps)).skipped, 'disabled');
  assert.equal(broken.server.clients, 0);
  assert.ok(broken.logs.some((l) => l.level === 'warn' && /could not read the e-mail switch/.test(l.msg)));
});

// ── The watcher ────────────────────────────────────────────────────────────

test('backoff: the interval doubles after each failed poll, at most 30 minutes', () => {
  assert.equal(backoffDelay(120_000, 0), 120_000);
  assert.equal(backoffDelay(120_000, 1), 240_000);
  assert.equal(backoffDelay(120_000, 4), 1_800_000);
  assert.equal(backoffDelay(120_000, 30), 1_800_000);
  assert.equal(backoffDelay(3_600_000, 1), 3_600_000, 'never shorter than the interval itself');
});

test('the watcher backs off after failures and returns to the interval after a good poll', async () => {
  const h = harness();
  h.server.failLogin = true;
  const w = startInboxWatcher(cfg, h.deps);
  const waits: number[] = [];
  try {
    for (let i = 0; i < 6; i++) {
      await w.pollNow();
      waits.push((Date.parse(w.status().nextPollAt ?? '') - NOW.getTime()) / 1000);
    }
    assert.deepEqual(waits, [240, 480, 960, 1800, 1800, 1800]);
    assert.equal(w.status().failures, 6);
    assert.equal(h.db.reports().length, 6, 'every failed poll is reported');
    assert.ok(h.logs.some((l) => l.level === 'error' && /poll failed: login refused .*; next try in 4 min$/.test(l.msg)));

    h.server.failLogin = false;
    await w.pollNow();
    assert.equal(w.status().failures, 0);
    assert.equal((Date.parse(w.status().nextPollAt ?? '') - NOW.getTime()) / 1000, 120);
  } finally {
    await w.stop();
  }
  assert.equal(w.status().nextPollAt, null);
  assert.equal((await w.pollNow()).skipped, 'stopped');
});

test('a poll never overlaps the one before', async () => {
  const h = harness();
  h.server.add(fixtureSource('drc01b-direct.eml'), at('2026-10-06T08:00:00Z'));
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.db.onIngest = () => gate;
  const w = startInboxWatcher(cfg, h.deps);
  try {
    const first = w.pollNow();
    const second = w.pollNow();
    assert.equal(first, second, 'the running poll is handed back');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(h.server.clients, 1);
    assert.equal(w.status().polling, true);
    release();
    assert.equal((await first).portal, 1);
    assert.equal(h.server.clients, 1);
    assert.equal(w.status().polling, false);
  } finally {
    await w.stop();
  }
});

test('stop() ends a poll between messages; an unfinished first look is completed later', async () => {
  const h = harness();
  for (const f of ['drc01b-direct.eml', 'gstr3a-defaulter.eml', 'reg17-scn.eml']) {
    h.server.add(fixtureSource(f), at('2026-10-06T08:00:00Z'));
  }
  const w = startInboxWatcher(cfg, h.deps);
  let stopping: Promise<void> | null = null;
  h.db.onIngest = async () => {
    stopping ??= w.stop(); // stop while the first message is being recorded
  };
  const r = await w.pollNow();
  await stopping;
  assert.equal(r.portal, 1, 'only the first message was read');
  assert.equal(h.state().lastUid, 1, 'the look-back is not marked done');

  h.db.onIngest = async () => {};
  const r2 = await pollInboxOnce(cfg, h.deps);
  assert.equal(r2.lookback, false);
  assert.deepEqual(h.db.ingests().map((c) => c.args.p_message_id), [DRC01B, GSTR3A, REG17]);
});

test('the watcher logs one line per poll, counts only, and the switch only when it changes', async () => {
  let on = false;
  const h = harness({ enabled: () => on });
  h.server.add(fixtureSource('drc01b-direct.eml'), at('2026-10-06T08:00:00Z'));
  const w = startInboxWatcher(cfg, h.deps);
  try {
    await w.pollNow();
    await w.pollNow();
    on = true;
    await w.pollNow();
    await w.pollNow();
  } finally {
    await w.stop();
  }
  assert.deepEqual(h.logs.map((l) => `${l.level} ${l.msg}`.replace(/; \d+\.\d s$/, '')), [
    'info inbox notices@demo-ca-firm.example: watching imap.example.test:993 INBOX (read-only) every 120 s',
    'info inbox notices@demo-ca-firm.example: the e-mail trigger is off; not reading the inbox',
    'info inbox notices@demo-ca-firm.example: the e-mail trigger is on; reading the inbox',
    'info inbox notices@demo-ca-firm.example: first look at the last two days: 1 new, 1 from the GST portal (queued 1)',
    'info inbox notices@demo-ca-firm.example: 0 new, 0 from the GST portal',
  ]);
  assert.equal(h.server.clients, 2, 'no connection while the switch was off');
});

test('the first poll starts by itself', async () => {
  const h = harness();
  const w = startInboxWatcher(cfg, h.deps);
  try {
    for (let i = 0; i < 50 && h.db.reports().length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(h.db.reports().length, 1);
    assert.equal(w.status().failures, 0);
    assert.notEqual(w.status().lastPollAt, null);
  } finally {
    await w.stop();
  }
});

// ── Configuration ──────────────────────────────────────────────────────────

test('inboxConfigFromEnv: null without host, user or password; defaults and limits', () => {
  assert.equal(inboxConfigFromEnv({}), null);
  assert.equal(inboxConfigFromEnv({ IMAP_HOST: 'imap.example.test', IMAP_USER: 'u' }), null);
  assert.equal(inboxConfigFromEnv({ IMAP_HOST: ' ', IMAP_USER: 'u', IMAP_PASSWORD: 'p' }), null);

  const c = inboxConfigFromEnv({ IMAP_HOST: ' imap.gmail.com ', IMAP_USER: 'notices@demo-ca-firm.example', IMAP_PASSWORD: 'abcdefghijklmnop\r' });
  assert.ok(c);
  assert.deepEqual({ ...c, portalSenders: c.portalSenders.source }, {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    user: 'notices@demo-ca-firm.example',
    password: 'abcdefghijklmnop',
    mailbox: 'INBOX',
    pollSeconds: 120,
    portalSenders: DEFAULT_PORTAL_SENDERS.source,
  });

  const base = { IMAP_HOST: 'h.example', IMAP_USER: 'u@h.example', IMAP_PASSWORD: 'p' };
  const starttls = inboxConfigFromEnv({ ...base, IMAP_SECURE: 'false', IMAP_POLL_SECONDS: '5', IMAP_MAILBOX: ' GST Portal ' });
  assert.deepEqual([starttls?.port, starttls?.secure, starttls?.pollSeconds, starttls?.mailbox], [143, false, 30, 'GST Portal']);
  assert.equal(inboxConfigFromEnv({ ...base, IMAP_PORT: '1993' })?.port, 1993);
  assert.equal(inboxConfigFromEnv({ ...base, IMAP_POLL_SECONDS: '300' })?.pollSeconds, 300);
  assert.equal(inboxConfigFromEnv({ ...base, IMAP_POLL_SECONDS: 'soon' })?.pollSeconds, 120);
  assert.equal(inboxConfigFromEnv({ ...base, IMAP_SECURE: 'yes' })?.secure, true);

  const senders = inboxConfigFromEnv({ ...base, PORTAL_SENDERS: String.raw`@(?:[a-z0-9-]+\.)*(?:gst\.gov\.in|portal\.example)$` });
  assert.equal(senders?.portalSenders.test('x@portal.example'), true);
  assert.equal(senders?.portalSenders.test('x@GST.GOV.IN'), true, 'case-insensitive');
  assert.equal(inboxConfigFromEnv({ ...base, PORTAL_SENDERS: '/@gst\\.gov\\.in$/i' })?.portalSenders.test('a@GST.gov.in'), true);

  assert.throws(() => inboxConfigFromEnv({ ...base, IMAP_PORT: 'imaps' }), /IMAP_PORT/);
  assert.throws(() => inboxConfigFromEnv({ ...base, IMAP_PORT: '70000' }), /IMAP_PORT/);
  assert.throws(() => inboxConfigFromEnv({ ...base, IMAP_SECURE: 'maybe' }), /IMAP_SECURE/);
  assert.throws(() => inboxConfigFromEnv({ ...base, PORTAL_SENDERS: '(' }), /PORTAL_SENDERS/);
});
