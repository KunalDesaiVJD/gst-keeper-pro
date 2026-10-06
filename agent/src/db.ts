// The database, through the same PostgREST door and publishable key the app
// and the extension use. Every call has a timeout; network errors are retried
// a few times with backoff.
import type { AgentConfig } from './config.js';

export class DbError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export interface Db {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  get<T = unknown>(pathAndQuery: string): Promise<T>;
  post(table: string, rows: unknown): Promise<void>;
}

export function makeDb(cfg: Pick<AgentConfig, 'supabaseUrl' | 'anonKey'>, fetchImpl: typeof fetch = fetch): Db {
  const base = cfg.supabaseUrl + '/rest/v1/';
  const headers = { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'Content-Type': 'application/json' };

  async function call(method: string, url: string, body?: unknown, prefer?: string): Promise<unknown> {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30_000);
      try {
        const r = await fetchImpl(url, {
          method, signal: ctl.signal,
          headers: prefer ? { ...headers, Prefer: prefer } : headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await r.text();
        if (!r.ok) {
          const err = new DbError(`${method} ${url.slice(base.length).split('?')[0]} -> ${r.status} ${text.slice(0, 300)}`, r.status);
          if (r.status >= 500 && attempt < 3) { last = err; await sleep(1000 * 2 ** attempt); continue; }
          throw err;
        }
        return text ? JSON.parse(text) : null;
      } catch (e) {
        if (e instanceof DbError) throw e;
        last = e;
        if (attempt < 3) await sleep(1000 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  return {
    rpc: <T>(fn: string, args: Record<string, unknown> = {}) => call('POST', base + 'rpc/' + fn, args) as Promise<T>,
    get: <T>(q: string) => call('GET', base + q) as Promise<T>,
    post: async (table: string, rows: unknown) => { await call('POST', base + table, rows, 'return=minimal'); },
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
