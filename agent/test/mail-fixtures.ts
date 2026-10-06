// Shared by the mail tests: the synthetic e-mails, a fake IMAP server that
// stands in for imapflow (no network), and a fake database rpc.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImapClient, ImapMailbox, ImapMessage, InboxConfig } from '../src/mail/inbox.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** A fixture from test/fixtures/emails as an IMAP server hands it over (CRLF line ends). */
export function fixtureSource(name: string): Buffer {
  const raw = fs.readFileSync(path.join(here, 'fixtures', 'emails', name), 'utf8');
  return Buffer.from(raw.replace(/\r?\n/g, '\r\n'), 'utf8');
}

/** The Message-ID header of a fixture. */
export function fixtureMessageId(name: string): string {
  const m = /^Message-ID:\s*(\S+)/im.exec(fixtureSource(name).toString('utf8'));
  if (!m) throw new Error(`${name} has no Message-ID`);
  return m[1];
}

interface StoredMessage {
  uid: number;
  source: Buffer;
  internalDate: Date;
}

/**
 * One mailbox on a fake IMAP server. It follows IMAP where the watcher relies
 * on it: UIDs only grow, SEARCH SINCE compares dates (not times) in UTC, and a
 * UID range "n:*" also returns the newest message when n is past it.
 */
export class FakeImapServer {
  uidValidity: bigint = 1001n;
  uidNext = 1;
  sendUidNext = true;
  messages: StoredMessage[] = [];
  /** Every command, in order, across connections. */
  calls: string[] = [];
  /** Clients made by the factory. */
  clients = 0;
  failLogin = false;
  failOpen = false;
  /** UIDs whose FETCH fails while the connection stays usable. */
  failFetch = new Set<number>();
  /** UIDs whose FETCH drops the connection. */
  dropOnFetch = new Set<number>();

  add(source: Buffer | string, internalDate: Date): number {
    const uid = this.uidNext++;
    this.messages.push({ uid, source: Buffer.isBuffer(source) ? source : Buffer.from(source), internalDate });
    return uid;
  }

  /** The server renumbers the mailbox: a new UIDVALIDITY, UIDs from 1 again. */
  renumber(uidValidity: bigint): void {
    this.uidValidity = uidValidity;
    let uid = 1;
    for (const m of this.messages) m.uid = uid++;
    this.uidNext = uid;
  }

  readonly factory = (_cfg: InboxConfig): ImapClient => {
    this.clients++;
    const server = this;
    let connected = false;
    let selected = false;
    const client: ImapClient = {
      usable: true,
      on() {
        return client;
      },
      async connect() {
        server.calls.push('connect');
        if (server.failLogin) {
          throw Object.assign(new Error('Command failed'), {
            authenticationFailed: true,
            serverResponseCode: 'AUTHENTICATIONFAILED',
            responseText: 'Invalid credentials (Failure)',
          });
        }
        connected = true;
      },
      async mailboxOpen(p: string, options: { readOnly: boolean }): Promise<ImapMailbox> {
        if (!connected) throw new Error('not connected');
        server.calls.push(`open ${p}${options.readOnly ? ' read-only' : ' READ-WRITE'}`);
        if (server.failOpen) {
          throw Object.assign(new Error('Command failed'), { responseText: `Mailbox doesn't exist: ${p}`, serverResponseCode: 'NONEXISTENT' });
        }
        selected = true;
        return {
          uidValidity: server.uidValidity,
          uidNext: server.sendUidNext ? server.uidNext : undefined,
          exists: server.messages.length,
        };
      },
      async search(query: { since?: Date; uid?: string }, options: { uid: boolean }) {
        if (!selected) throw new Error('no mailbox selected');
        if (!options.uid) throw new Error('the watcher must search by UID');
        if (query.since) {
          const day = query.since.toISOString().slice(0, 10);
          server.calls.push(`search since ${day}`);
          const start = Date.parse(`${day}T00:00:00Z`);
          return server.messages.filter((m) => m.internalDate.getTime() >= start).map((m) => m.uid);
        }
        if (query.uid) {
          server.calls.push(`search uid ${query.uid}`);
          const m = /^(\d+):\*$/.exec(query.uid);
          if (!m) throw new Error(`unexpected uid range ${query.uid}`);
          if (!server.messages.length) return [];
          const max = server.messages.reduce((a, x) => Math.max(a, x.uid), 0);
          const n = Number(m[1]);
          const lo = Math.min(n, max);
          const hi = Math.max(n, max);
          return server.messages.filter((x) => x.uid >= lo && x.uid <= hi).map((x) => x.uid);
        }
        throw new Error('unexpected search');
      },
      async fetchOne(range: string, query: { source?: { maxLength: number } }, options: { uid: boolean }): Promise<ImapMessage | false> {
        if (!selected) throw new Error('no mailbox selected');
        if (!options.uid) throw new Error('the watcher must fetch by UID');
        server.calls.push(`fetch ${range}`);
        const m = range === '*' ? server.messages[server.messages.length - 1] : server.messages.find((x) => x.uid === Number(range));
        if (!m) return false;
        if (server.dropOnFetch.has(m.uid)) {
          client.usable = false;
          throw Object.assign(new Error('Connection not available'), { code: 'NoConnection' });
        }
        if (server.failFetch.has(m.uid)) throw Object.assign(new Error('Command failed'), { responseText: 'Internal server error' });
        return {
          uid: m.uid,
          source: query.source ? m.source.subarray(0, query.source.maxLength) : undefined,
          internalDate: m.internalDate,
        };
      },
      async logout() {
        server.calls.push('logout');
        connected = false;
      },
      close() {
        server.calls.push('close');
      },
    };
    return client;
  };
}

export interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

/** A stand-in for Db.rpc: records calls; `fail` decides which calls throw. */
export function fakeRpc() {
  const calls: RpcCall[] = [];
  const state = {
    calls,
    fail: (_call: RpcCall): Error | null => null,
    /** Runs inside each portal_email_ingest call, before it answers. */
    onIngest: async (_args: Record<string, unknown>): Promise<void> => {},
    rpc: async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
      const call = { fn, args };
      calls.push(call);
      if (fn === 'portal_email_ingest') await state.onIngest(args);
      const err = state.fail(call);
      if (err) throw err;
      if (fn === 'portal_email_ingest') {
        return { status: 'queued', client_id: 'client-1', job_id: 'job-1', email_id: `email-${calls.length}`, notice_id: null };
      }
      return null;
    },
    ingests: () => calls.filter((c) => c.fn === 'portal_email_ingest'),
    reports: () => calls.filter((c) => c.fn === 'portal_inbox_report'),
  };
  return state;
}
