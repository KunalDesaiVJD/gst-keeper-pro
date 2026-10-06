// Reads the firm's notices inbox over IMAP and hands every GST portal e-mail
// to portal_email_ingest, which matches the GSTIN to a client and queues a
// high-priority notices sync. Strictly read-only: the mailbox is opened with
// EXAMINE and bodies are fetched with BODY.PEEK, so nothing is ever deleted,
// moved, flagged or marked seen. A small state file remembers the last UID
// read; it is replaced atomically after every message. One line is logged
// per poll, with counts only; no body is logged or stored anywhere.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail, type SimpleParserOptions } from 'mailparser';
import { DEFAULT_PORTAL_SENDERS, htmlToText, parsePortalEmail, type PortalEmail, type PortalEmailInput } from './parse.js';

// ── Configuration ──────────────────────────────────────────────────────────

export interface InboxConfig {
  host: string;
  port: number;
  /** true: TLS from the first byte (port 993). false: STARTTLS, which must succeed before the password is sent (port 143). */
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  pollSeconds: number;
  /** Tested against the bare sender address (and a forwarded From: address). */
  portalSenders: RegExp;
}

export const DEFAULT_POLL_SECONDS = 120;
export const MIN_POLL_SECONDS = 30;
const MAX_POLL_SECONDS = 24 * 3600;

function flag(name: string, v: string | undefined, d: boolean): boolean {
  const s = (v ?? '').trim();
  if (!s) return d;
  if (/^(1|true|yes|on)$/i.test(s)) return true;
  if (/^(0|false|no|off)$/i.test(s)) return false;
  throw new Error(`${name} must be true or false, not "${s}".`);
}

function sendersRegex(src: string | undefined): RegExp {
  const s = (src ?? '').trim();
  if (!s) return DEFAULT_PORTAL_SENDERS;
  const literal = /^\/(.+)\/([a-z]*)$/i.exec(s); // "/…/i" written as a literal
  try {
    return literal ? new RegExp(literal[1], literal[2].replace(/[gy]/g, '')) : new RegExp(s, 'i');
  } catch (err) {
    throw new Error(`PORTAL_SENDERS is not a valid regular expression: ${(err as Error).message}`);
  }
}

/**
 * The inbox settings from the agent's environment, or null when IMAP_HOST,
 * IMAP_USER or IMAP_PASSWORD is missing (no inbox to watch). Throws on a value
 * that cannot be right (a port that is not a number, IMAP_SECURE=maybe, a
 * PORTAL_SENDERS that is not a regular expression).
 */
export function inboxConfigFromEnv(env: Record<string, string | undefined> = process.env): InboxConfig | null {
  const host = (env.IMAP_HOST ?? '').trim();
  const user = (env.IMAP_USER ?? '').trim();
  const password = (env.IMAP_PASSWORD ?? '').replace(/[\r\n]+$/, '');
  if (!host || !user || !password) return null;
  const secure = flag('IMAP_SECURE', env.IMAP_SECURE, true);
  const portRaw = (env.IMAP_PORT ?? '').trim();
  const port = portRaw ? Number(portRaw) : secure ? 993 : 143;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`IMAP_PORT must be a port number, not "${portRaw}".`);
  const pollRaw = (env.IMAP_POLL_SECONDS ?? '').trim();
  const poll = Number(pollRaw);
  const pollSeconds = pollRaw && Number.isFinite(poll)
    ? Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(poll)))
    : DEFAULT_POLL_SECONDS;
  return {
    host,
    port,
    secure,
    user,
    password,
    mailbox: (env.IMAP_MAILBOX ?? '').trim() || 'INBOX',
    pollSeconds,
    portalSenders: sendersRegex(env.PORTAL_SENDERS),
  };
}

/** How the inbox is named on the Autopilot page and in log lines. */
export function inboxAddress(cfg: InboxConfig): string {
  return cfg.mailbox.toUpperCase() === 'INBOX' ? cfg.user : `${cfg.user} (${cfg.mailbox})`;
}

// ── The IMAP seam ──────────────────────────────────────────────────────────
// The part of imapflow's ImapFlow the watcher uses. Tests pass a fake through
// InboxWatcherDeps.createClient, so they need no network.

export interface ImapMailbox {
  uidValidity: bigint | number | string;
  uidNext?: number;
  exists?: number;
}

export interface ImapMessage {
  uid: number;
  source?: Buffer;
  internalDate?: Date | string;
  envelope?: {
    messageId?: string;
    subject?: string;
    date?: Date;
    from?: Array<{ name?: string; address?: string }>;
  };
}

export interface ImapClient {
  /** imapflow sets this to false once the connection is gone. */
  usable?: boolean;
  connect(): Promise<void>;
  mailboxOpen(path: string, options: { readOnly: boolean }): Promise<ImapMailbox>;
  search(query: { since?: Date; uid?: string }, options: { uid: boolean }): Promise<number[] | false>;
  fetchOne(
    range: string,
    query: { uid: boolean; source?: { maxLength: number }; internalDate?: boolean; envelope?: boolean },
    options: { uid: boolean },
  ): Promise<ImapMessage | false>;
  logout(): Promise<void>;
  close(): void;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

function imapflowClient(cfg: InboxConfig): ImapClient {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // Without direct TLS, STARTTLS is required: the password never travels in clear.
    ...(cfg.secure ? {} : { doSTARTTLS: true }),
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    disableAutoIdle: true,
    clientInfo: { name: 'GST Keeper agent' },
    connectionTimeout: 60_000,
    greetingTimeout: 30_000,
    socketTimeout: 5 * 60_000,
  });
}

// ── Reading one message ────────────────────────────────────────────────────

// skipHtmlToText: mailparser's own conversion runs table cells together
// ("GSTINReference Number24…"), hiding GSTINs and references, so an HTML-only
// e-mail is left to the parser's htmlToText, which keeps cells apart.
const PARSER_OPTIONS: SimpleParserOptions = {
  skipHtmlToText: true,
  skipImageLinks: true,
  skipTextToHtml: true,
  skipTextLinks: true,
};
const MAX_EMBEDDED = 3;

const cleanId = (s: string | undefined | null) => (s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 500) || null;

const plainText = (m: ParsedMail) => (m.text?.trim() ? m.text : typeof m.html === 'string' ? htmlToText(m.html) : '');

// An attached e-mail written out the way Gmail writes an inline forward, so the
// parser reads "Forward as attachment" exactly like a normal forward.
function forwardedBlock(m: ParsedMail): string {
  const lines = ['', '', '---------- Forwarded message ---------', `From: ${m.from?.text ?? ''}`];
  if (m.date) lines.push(`Date: ${m.date.toUTCString()}`);
  if (m.subject) lines.push(`Subject: ${m.subject}`);
  lines.push('', plainText(m));
  return lines.join('\n');
}

/**
 * The parser's input from a raw message: the Message-ID header (else
 * meta.fallbackId), the arrival time (the server's INTERNALDATE, else the Date
 * header), sender, subject, text and HTML, plus the text of up to three
 * attached e-mails (message/rfc822).
 */
export async function emailInputFromSource(
  source: Buffer | string,
  meta: { fallbackId: string; internalDate?: Date | string | null; envelope?: ImapMessage['envelope'] },
): Promise<PortalEmailInput> {
  const parsed = await simpleParser(source, PARSER_OPTIONS);
  let text = parsed.text ?? '';
  for (const att of parsed.attachments.filter((a) => a.contentType === 'message/rfc822').slice(0, MAX_EMBEDDED)) {
    try {
      text += forwardedBlock(await simpleParser(att.content, PARSER_OPTIONS));
    } catch {
      // an unreadable attached e-mail is skipped; the outer one is still read
    }
  }
  return {
    messageId: cleanId(parsed.messageId) ?? cleanId(meta.envelope?.messageId) ?? meta.fallbackId,
    date: meta.internalDate ?? parsed.date ?? meta.envelope?.date ?? null,
    from: parsed.from?.value?.[0]?.address || meta.envelope?.from?.[0]?.address || parsed.from?.text || null,
    subject: parsed.subject ?? meta.envelope?.subject ?? '',
    text,
    html: typeof parsed.html === 'string' ? parsed.html : null,
  };
}

/** The arguments of portal_email_ingest for one parsed e-mail. */
export function ingestArgs(e: PortalEmail): Record<string, unknown> {
  return {
    p_message_id: e.messageId,
    p_received_at: e.receivedAt,
    p_from: e.from,
    p_subject: e.subject || null,
    p_snippet: e.snippet || null,
    p_gstins: e.gstins,
    p_form_code: e.formCode,
    p_reference: e.reference,
  };
}

// ── State file ─────────────────────────────────────────────────────────────

interface PendingEntry {
  uid: number;
  attempts: number;
  /** When it first failed; it is dropped after PENDING_MAX_AGE_MS. */
  since: string;
}

interface InboxState {
  /** Which mailbox the UIDs belong to; another account or folder starts afresh. */
  account: string;
  uidValidity: string;
  lastUid: number;
  /** Portal e-mails not yet recorded (the database failed); tried again on later polls. */
  pending: PendingEntry[];
}

const accountKey = (cfg: InboxConfig) =>
  `imap://${cfg.user.toLowerCase()}@${cfg.host.toLowerCase()}:${cfg.port}/${cfg.mailbox}`;

async function readState(file: string): Promise<{ state: InboxState | null; corrupt: boolean }> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: null, corrupt: false };
    throw err;
  }
  try {
    const s = JSON.parse(raw) as Partial<InboxState>;
    if (s && typeof s.uidValidity === 'string' && Number.isInteger(s.lastUid) && (s.lastUid as number) >= 0) {
      const pending = Array.isArray(s.pending)
        ? s.pending.filter((p): p is PendingEntry =>
            !!p && Number.isInteger(p.uid) && p.uid > 0 && Number.isInteger(p.attempts) && typeof p.since === 'string')
        : [];
      return { state: { account: String(s.account ?? ''), uidValidity: s.uidValidity, lastUid: s.lastUid as number, pending }, corrupt: false };
    }
  } catch {
    // fall through: unreadable
  }
  return { state: null, corrupt: true };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Windows: an antivirus or indexer briefly holding the file makes rename fail with EPERM/EBUSY.
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) throw err;
      await sleep(50 * 2 ** attempt);
    }
  }
}

/** Write to <file>.tmp, flush it to disk, then rename over the old file. */
async function writeState(file: string, state: InboxState, at: Date): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(JSON.stringify({ ...state, updatedAt: at.toISOString() }, null, 2) + '\n', 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await renameWithRetry(tmp, file);
}

// ── One poll ───────────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error';

export interface InboxWatcherDeps {
  /** Calls a database function: resolves with its result, rejects on any error (the agent's Db.rpc). */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  log: (level: LogLevel, msg: string) => void;
  /** The app's e-mail switch (autopilot_settings.email_trigger), read before every poll. */
  isEnabled: () => boolean | Promise<boolean>;
  /** Where the watcher keeps {uidValidity, lastUid, pending}. */
  stateFile: string;
  now?: () => Date;
  /** Tests inject a fake client; production uses imapflow. */
  createClient?: (cfg: InboxConfig) => ImapClient;
}

export interface PollResult {
  /** Nothing was read: the e-mail switch is off, or the watcher is stopping. */
  skipped?: 'disabled' | 'stopped';
  /** False when the mailbox could not be read (connection, login, mailbox, state file). */
  ok: boolean;
  error?: string;
  /** Looked back two days by date: the first poll, another mailbox, or the server renumbered it. */
  lookback: boolean;
  /** Messages read this poll. */
  read: number;
  /** Of those, e-mails from the GST portal (sent by it, or forwarded). */
  portal: number;
  /** What portal_email_ingest said, by status ('queued', 'already_queued', 'unmatched', …); 'duplicate' for e-mails it already had. */
  statuses: Record<string, number>;
  /** E-mails not fetched or not recorded this poll; kept and tried again on the next polls. */
  failed: number;
  /** E-mails waiting to be tried again after this poll. */
  pending: number;
}

const LOOKBACK_MS = 2 * 24 * 3600_000;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024; // the text comes first; a long attachment is cut, not the body
const RPC_TIMEOUT_MS = 3 * 60_000;
const SWITCH_TIMEOUT_MS = 30_000;
const DB_FAILURES_BEFORE_PAUSE = 3; // in a row: the database is not answering, keep the rest for the next poll
const PENDING_MAX_AGE_MS = 24 * 3600_000;
const PENDING_MAX = 500;
const FETCH_QUERY = { uid: true, source: { maxLength: MAX_SOURCE_BYTES }, internalDate: true, envelope: true };

function emptyResult(skipped?: PollResult['skipped']): PollResult {
  return { ...(skipped ? { skipped } : {}), ok: true, lookback: false, read: 0, portal: 0, statuses: {}, failed: 0, pending: 0 };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)) || 'unknown error';

type Step = 'connect' | 'open' | 'search' | 'fetch' | 'state';

interface ImapErrorLike {
  message?: string;
  code?: string;
  authenticationFailed?: boolean;
  tlsFailed?: boolean;
  responseText?: string;
  response?: unknown;
}

/** One readable line for the log and the Autopilot page; never the password. */
export function describeImapError(err: unknown, cfg: InboxConfig, step: Step): string {
  const e = (err && typeof err === 'object' ? err : {}) as ImapErrorLike;
  const msg = errMessage(err);
  const server = e.responseText || (typeof e.response === 'string' ? e.response : '');
  const code = e.code ?? '';
  const at = `${cfg.host}:${cfg.port}`;
  let text: string;
  if (e.authenticationFailed) {
    text = `login refused for ${cfg.user}${server ? ` (${server})` : ''}: check IMAP_USER and IMAP_PASSWORD (Google Workspace and Microsoft 365 need an app password)`;
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    text = `cannot find the mail server ${cfg.host}`;
  } else if (code === 'ECONNREFUSED') {
    text = `${at} refused the connection`;
  } else if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'NoConnection') {
    text = `${at} closed the connection`;
  } else if (/TIMEOUT|TIMEDOUT/i.test(code)) {
    text = `${at} did not answer in time`;
  } else if (e.tlsFailed || /TLS|CERT|SSL/i.test(code)) {
    text = `secure connection to ${at} failed: ${msg}`;
  } else if (step === 'open') {
    text = `cannot open mailbox "${cfg.mailbox}": ${server || msg}`;
  } else if (step === 'state') {
    text = `cannot use the inbox state file: ${msg}`;
  } else {
    text = server && server !== msg ? `${msg}: ${server}` : msg;
  }
  if (cfg.password) text = text.split(cfg.password).join('***');
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function largest(uids: number[]): number {
  return uids.reduce((m, u) => (u > m ? u : m), 0);
}

// The UID below which the first poll does not look: everything already there.
async function highestUid(client: ImapClient, box: ImapMailbox, seen: number[]): Promise<number> {
  if (typeof box.uidNext === 'number' && box.uidNext > 0) return box.uidNext - 1;
  let top = largest(seen);
  if (box.exists) {
    // No UIDNEXT from the server: the last message tells.
    const lastMsg = await client.fetchOne('*', { uid: true }, { uid: true });
    if (lastMsg && lastMsg.uid > top) top = lastMsg.uid;
  }
  return top;
}

/**
 * One poll, no timers: read the e-mail switch, connect, open the mailbox
 * read-only, read every message after the last one seen (two days back by date
 * on a first poll or after the server renumbered the mailbox), record each
 * portal e-mail, then report to portal_inbox_report. Never throws.
 */
export async function pollInboxOnce(
  cfg: InboxConfig,
  deps: InboxWatcherDeps,
  shouldStop: () => boolean = () => false,
): Promise<PollResult> {
  const now = deps.now ?? (() => new Date());
  const say = (level: LogLevel, msg: string) => {
    try {
      deps.log(level, msg);
    } catch {
      // a failing logger must never stop the inbox
    }
  };
  const address = inboxAddress(cfg);
  const result = emptyResult();
  if (shouldStop()) return emptyResult('stopped');

  try {
    const on = await withTimeout(Promise.resolve().then(() => deps.isEnabled()), SWITCH_TIMEOUT_MS, 'the e-mail switch');
    if (!on) return emptyResult('disabled');
  } catch (err) {
    say('warn', `inbox ${address}: could not read the e-mail switch, not polling this time: ${errMessage(err)}`);
    return emptyResult('disabled');
  }

  const client = (deps.createClient ?? imapflowClient)(cfg);
  let connectionLost = false;
  // imapflow emits 'error' when the socket fails; unheard, that would crash the agent.
  client.on('error', () => {
    connectionLost = true;
  });

  let step: Step = 'connect';
  let firstFailure: string | null = null;
  try {
    await client.connect();
    step = 'open';
    const box = await client.mailboxOpen(cfg.mailbox, { readOnly: true });
    const uidValidity = String(box.uidValidity);

    step = 'state';
    const account = accountKey(cfg);
    const { state: prev, corrupt } = await readState(deps.stateFile);
    if (corrupt) say('warn', `inbox ${address}: the state file ${deps.stateFile} could not be read; looking back two days`);
    const renumbered = !!prev && prev.account === account &&
      (prev.uidValidity !== uidValidity || (typeof box.uidNext === 'number' && box.uidNext > 0 && box.uidNext <= prev.lastUid));
    const fresh = !prev || prev.account !== account || renumbered;
    if (renumbered && prev) {
      say('warn', `inbox ${address}: the server renumbered the mailbox (UIDVALIDITY ${prev.uidValidity} -> ${uidValidity}); looking back two days`);
    }

    step = 'search';
    let state: InboxState;
    let uids: number[];
    let baseline = 0;
    if (fresh || !prev) {
      result.lookback = true;
      uids = (await client.search({ since: new Date(now().getTime() - LOOKBACK_MS) }, { uid: true })) || [];
      baseline = await highestUid(client, box, uids);
      state = { account, uidValidity, lastUid: 0, pending: [] };
    } else {
      state = { ...prev, pending: prev.pending.map((p) => ({ ...p })) };
      const after = prev.lastUid;
      // "n:*" also returns the newest message when n is past it, hence the filter.
      const found = ((await client.search({ uid: `${after + 1}:*` }, { uid: true })) || []).filter((u) => u > after);
      uids = [...state.pending.map((p) => p.uid), ...found];
    }
    uids = [...new Set(uids.filter((u) => Number.isInteger(u) && u > 0))].sort((a, b) => a - b);

    const dropPending = (uid: number) => {
      state.pending = state.pending.filter((p) => p.uid !== uid);
    };
    const keepPending = (uid: number, reason: string, attempted: boolean) => {
      const t = now();
      let entry = state.pending.find((p) => p.uid === uid);
      if (!entry) {
        entry = { uid, attempts: 0, since: t.toISOString() };
        state.pending.push(entry);
      }
      if (attempted) entry.attempts++;
      if (t.getTime() - Date.parse(entry.since) >= PENDING_MAX_AGE_MS) {
        dropPending(uid);
        say('error', `inbox ${address}: message uid ${uid} ${reason}; giving up after ${entry.attempts} attempts over 24 hours`);
      } else if (attempted) {
        say('warn', `inbox ${address}: message uid ${uid} ${reason}; will try again (attempt ${entry.attempts})`);
      }
      if (state.pending.length > PENDING_MAX) {
        const dropped = state.pending.sort((a, b) => a.uid - b.uid).splice(0, state.pending.length - PENDING_MAX);
        say('error', `inbox ${address}: too many e-mails waiting; dropped uid ${dropped.map((p) => p.uid).join(', ')}`);
      }
    };

    let dbFailuresInARow = 0;
    const readOne = async (uid: number): Promise<void> => {
      step = 'fetch';
      let msg: ImapMessage | false;
      try {
        msg = await client.fetchOne(String(uid), FETCH_QUERY, { uid: true });
      } catch (err) {
        // Connection gone: end the poll here; the next one starts again from this message.
        if (connectionLost || client.usable === false) throw err;
        result.failed++;
        const why = describeImapError(err, cfg, 'fetch');
        firstFailure ??= why;
        keepPending(uid, `could not be fetched (${why})`, true);
        return;
      }
      if (!msg) {
        dropPending(uid); // deleted since
        return;
      }
      result.read++;
      let email: PortalEmail;
      try {
        const input = await emailInputFromSource(msg.source ?? Buffer.alloc(0), {
          fallbackId: `uid:${uidValidity}:${uid}@${cfg.mailbox}`,
          internalDate: msg.internalDate,
          envelope: msg.envelope,
        });
        email = parsePortalEmail(input, { portalSenders: cfg.portalSenders });
      } catch (err) {
        say('warn', `inbox ${address}: message uid ${uid} could not be parsed and is skipped: ${errMessage(err)}`);
        dropPending(uid);
        return;
      }
      if (!email.isPortal) {
        dropPending(uid);
        return;
      }
      result.portal++;
      if (dbFailuresInARow >= DB_FAILURES_BEFORE_PAUSE) {
        result.failed++;
        keepPending(uid, 'was not recorded (the database is not answering)', false);
        return;
      }
      try {
        const res = await withTimeout(deps.rpc('portal_email_ingest', ingestArgs(email)), RPC_TIMEOUT_MS, 'portal_email_ingest');
        dbFailuresInARow = 0;
        const r = (res && typeof res === 'object' ? res : {}) as { status?: unknown; duplicate?: unknown };
        const key = r.duplicate === true ? 'duplicate' : typeof r.status === 'string' && r.status ? r.status : 'recorded';
        result.statuses[key] = (result.statuses[key] ?? 0) + 1;
        dropPending(uid);
      } catch (err) {
        dbFailuresInARow++;
        result.failed++;
        firstFailure ??= errMessage(err);
        keepPending(uid, `could not be recorded (${errMessage(err).slice(0, 200)})`, true);
      }
    };

    let completed = true;
    for (const uid of uids) {
      if (shouldStop()) {
        completed = false;
        break;
      }
      await readOne(uid);
      if (uid > state.lastUid) state.lastUid = uid;
      step = 'state';
      await writeState(deps.stateFile, state, now());
    }
    if (completed && (fresh || baseline > state.lastUid)) {
      // Everything older than the look-back is left alone from now on.
      state.lastUid = Math.max(state.lastUid, baseline);
      step = 'state';
      await writeState(deps.stateFile, state, now());
    }
    result.pending = state.pending.length;
  } catch (err) {
    result.ok = false;
    result.error = describeImapError(err, cfg, step);
  } finally {
    try {
      await withTimeout(client.logout(), 10_000, 'logout');
    } catch {
      try {
        client.close();
      } catch {
        // already closed
      }
    }
  }

  const report = !result.ok
    ? result.error ?? 'inbox poll failed'
    : result.failed
      ? `${result.failed} e-mail${result.failed === 1 ? '' : 's'} not recorded yet, will retry${firstFailure ? `: ${firstFailure}` : ''}`
      : null;
  try {
    await withTimeout(deps.rpc('portal_inbox_report', { p_address: address, p_error: report ? report.slice(0, 500) : null }), RPC_TIMEOUT_MS, 'portal_inbox_report');
  } catch (err) {
    say('warn', `inbox ${address}: could not report the poll to the database: ${errMessage(err)}`);
  }
  return result;
}

// ── The watcher ────────────────────────────────────────────────────────────

const MAX_BACKOFF_MS = 30 * 60_000;

/** The wait after `failures` failed polls in a row: the interval doubled each time, at most 30 minutes (never less than the interval). */
export function backoffDelay(intervalMs: number, failures: number): number {
  if (failures <= 0) return intervalMs;
  return Math.max(intervalMs, Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS));
}

export interface InboxWatcherStatus {
  address: string;
  polling: boolean;
  /** Failed polls in a row (connection, login, mailbox). */
  failures: number;
  lastPollAt: string | null;
  nextPollAt: string | null;
  last: PollResult | null;
}

export interface InboxWatcher {
  /** Stops polling; resolves once a poll in progress has wound down (it stops between messages). */
  stop(): Promise<void>;
  /** Polls now, unless a poll is already running: then that poll's result. */
  pollNow(): Promise<PollResult>;
  status(): InboxWatcherStatus;
}

function summaryLine(address: string, r: PollResult, ms: number, retryInMs: number | null): string {
  const secs = `${(ms / 1000).toFixed(1)} s`;
  if (!r.ok) return `inbox ${address}: poll failed: ${r.error}; next try in ${Math.round((retryInMs ?? 0) / 60_000)} min`;
  const statuses = Object.entries(r.statuses).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(', ');
  const parts = [
    `${r.lookback ? 'first look at the last two days: ' : ''}${r.read} new`,
    `${r.portal} from the GST portal${statuses ? ` (${statuses})` : ''}`,
  ];
  if (r.failed) parts.push(`${r.failed} not recorded yet`);
  if (r.pending) parts.push(`${r.pending} waiting to retry`);
  return `inbox ${address}: ${parts.join(', ')}; ${secs}`;
}

/**
 * Polls the inbox now and then every cfg.pollSeconds while deps.isEnabled()
 * says so. A poll never overlaps the previous one. After a failed poll the
 * wait doubles, up to 30 minutes.
 */
export function startInboxWatcher(cfg: InboxConfig, deps: InboxWatcherDeps): InboxWatcher {
  const now = deps.now ?? (() => new Date());
  const address = inboxAddress(cfg);
  const intervalMs = Math.max(1000, Math.round(cfg.pollSeconds * 1000));
  const say = (level: LogLevel, msg: string) => {
    try {
      deps.log(level, msg);
    } catch {
      // never let logging stop the watcher
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<PollResult> | null = null;
  let stopped = false;
  let failures = 0;
  let disabled: boolean | null = null;
  let nextPollAt: Date | null = null;
  let lastPollAt: Date | null = null;
  let last: PollResult | null = null;

  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    nextPollAt = new Date(now().getTime() + ms);
    timer = setTimeout(() => {
      timer = null;
      void pollNow();
    }, ms);
  };

  function pollNow(): Promise<PollResult> {
    if (inFlight) return inFlight;
    if (stopped) return Promise.resolve(emptyResult('stopped'));
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    nextPollAt = null;
    const started = Date.now();
    const run = pollInboxOnce(cfg, deps, () => stopped)
      .catch((err): PollResult => ({ ...emptyResult(), ok: false, error: errMessage(err) }))
      .then((r) => {
        let delay = intervalMs;
        try {
          if (r.skipped === 'disabled') {
            if (disabled !== true) say('info', `inbox ${address}: the e-mail trigger is off; not reading the inbox`);
            disabled = true;
          } else if (!r.skipped) {
            if (disabled === true) say('info', `inbox ${address}: the e-mail trigger is on; reading the inbox`);
            disabled = false;
            last = r;
            lastPollAt = now();
            failures = r.ok ? 0 : failures + 1;
            delay = backoffDelay(intervalMs, failures);
            say(!r.ok ? 'error' : r.failed ? 'warn' : 'info', summaryLine(address, r, Date.now() - started, r.ok ? null : delay));
          }
        } catch {
          // bookkeeping must never stop the watcher
        } finally {
          inFlight = null;
          schedule(delay);
        }
        return r;
      });
    inFlight = run;
    return run;
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    nextPollAt = null;
    if (inFlight) await inFlight;
  }

  const status = (): InboxWatcherStatus => ({
    address,
    polling: inFlight !== null,
    failures,
    lastPollAt: lastPollAt ? lastPollAt.toISOString() : null,
    nextPollAt: nextPollAt ? nextPollAt.toISOString() : null,
    last,
  });

  say('info', `inbox ${address}: watching ${cfg.host}:${cfg.port} ${cfg.mailbox} (read-only) every ${cfg.pollSeconds} s`);
  schedule(0);
  return { stop, pollNow, status };
}
