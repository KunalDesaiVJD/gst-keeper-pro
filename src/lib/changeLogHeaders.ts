// Who is acting, sent with every database request so the change log
// (gst_change_log, migration 20261021130000) can name the person.
//
// The app has no Supabase auth session (auth.uid() is NULL), so the database
// cannot know the user by itself. Every request to /rest/v1 (tables and RPCs)
// carries:
//   x-gst-actor    the signed-in user's id (staff user_id, or the client id
//                  for the client portal), read from the saved sign-in
//   x-gst-source   'app'
//   x-gst-request  the page and a short random id, so the rows one request
//                  wrote can be found together
// PostgREST hands request headers to the database (request.headers). Only
// /rest/v1 gets them: the API gateway allows any header there (checked in a
// browser against the live project on 21 Oct 2026), but each Edge Function
// lists the headers it allows and would refuse these.

export const AUTH_STORAGE_KEY = 'vjdesai_user';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let lastRaw: string | null | undefined;
let lastId: string | null = null;

/** The signed-in user's id from the saved sign-in, or null. */
export function currentActorId(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string | null {
  try {
    const raw = storage ? storage.getItem(AUTH_STORAGE_KEY) : null;
    if (raw !== lastRaw) {
      lastRaw = raw;
      lastId = null;
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      const id = parsed && typeof parsed === 'object' ? (parsed as { id?: unknown }).id : null;
      if (typeof id === 'string' && UUID_RE.test(id)) lastId = id;
    }
    return lastId;
  } catch {
    return null;
  }
}

function shortId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(16).slice(2, 10);
  }
}

/** The headers for one request. Header values must be plain ASCII. */
export function changeLogHeaders(actorId: string | null, page: string | null): Record<string, string> {
  const h: Record<string, string> = { 'x-gst-source': 'app' };
  if (actorId) h['x-gst-actor'] = actorId;
  const where = (page || '').replace(/[^\x20-\x7e]/g, '').slice(0, 60);
  h['x-gst-request'] = (where ? where + ' ' : '') + shortId();
  return h;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Adds the headers to a request to /rest/v1; anything else is left as it is. */
export function withChangeLogHeaders(input: RequestInfo | URL, init?: RequestInit, actorId: string | null = currentActorId(),
  page: string | null = typeof location === 'undefined' ? null : location.pathname): RequestInit | undefined {
  if (!urlOf(input).includes('/rest/v1/')) return init;
  const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
  for (const [k, v] of Object.entries(changeLogHeaders(actorId, page))) headers.set(k, v);
  return { ...init, headers };
}

/** The fetch the Supabase client uses. */
export const changeLogFetch: typeof fetch = (input, init) => fetch(input, withChangeLogHeaders(input, init));
