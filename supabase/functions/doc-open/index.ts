// doc-open — streams a stored file to the app's page /d/:id (short document
// links, migration 20261025210000_doc_links.sql, _shared/docLink.ts).
//
// Request (POST, JSON, from the page): { id, actorId, sessionsEndedAt?, download? }
//   id               the 12-character link id
//   actorId          the signed-in person (the app's own sign-in: a staff
//                    member's user id, or a client's id)
//   sessionsEndedAt  the staff member's profiles.sessions_ended_at as it stood
//                    when they signed in (as AuthContext keeps it)
//   download         a file name: answer as an attachment of that name
//
// Who may open: any staff level whose sign-in has not been ended
// (Dashboard → User Management → Log out); a client only a file whose path
// carries the client's own id (every client's file does: notices/<client>/…,
// refund/<client>/…, <client>/<MM-YYYY>/…). The app has no server-checked
// session (custom sign-in, see CLAUDE.md), so like gst-push this trusts the
// actor id the page sends and checks it against the database; the id is
// never shown in the app. Every answer is kept in doc_link_opens.
//
// The file is read with the service role and streamed, so the storage address
// never reaches the browser; it works the same once the buckets are private.
//
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { DOC_LINK_RE } from '../_shared/docLink.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = new Set(['superadmin', 'gst_manager', 'employee']);

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'content-type, content-length, content-disposition, x-doc-name',
};

function answer(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// A file name safe for a header: no path, no control characters.
function cleanName(s: string): string {
  const base = s.split('/').pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f"\\]/g, '').trim().slice(0, 180) || 'document';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return answer(405, 'Use POST.');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return answer(400, 'The request could not be read.');
  }
  const id = typeof body.id === 'string' ? body.id : '';
  const actorId = typeof body.actorId === 'string' ? body.actorId : '';
  const signedInEnded = typeof body.sessionsEndedAt === 'string' ? body.sessionsEndedAt : null;
  const download = typeof body.download === 'string' && body.download.trim() ? cleanName(body.download) : null;
  if (!DOC_LINK_RE.test(id)) return answer(404, 'This link is not a document link.');
  if (!UUID_RE.test(actorId)) return answer(401, 'Please log in to open this document.');

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const log = (outcome: 'opened' | 'refused' | 'not_found' | 'failed', detail: string | null) =>
    sb.from('doc_link_opens').insert({ link_id: id, actor_id: actorId, outcome, detail }).then(() => {}, () => {});

  const { data: roleRows, error: roleErr } = await sb.from('user_roles').select('role').eq('user_id', actorId);
  if (roleErr) return answer(500, 'Who is signed in could not be checked. Try again.');
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.length) {
    // A client's sign-in has no user_roles row: the actor id is the client's id.
    const { data: client } = await sb.from('clients').select('id').eq('id', actorId).maybeSingle();
    if (client) roles.push('client');
  }
  if (!roles.length) {
    await log('refused', 'no such user');
    return answer(401, 'Please log in to open this document.');
  }
  const staff = roles.some((r) => STAFF.has(r));

  if (staff) {
    const { data: prof } = await sb.from('profiles').select('sessions_ended_at').eq('user_id', actorId).maybeSingle();
    const ended = prof?.sessions_ended_at as string | null | undefined;
    if (ended && (!signedInEnded || new Date(ended).getTime() > new Date(signedInEnded).getTime())) {
      await log('refused', 'sessions ended');
      return answer(401, 'You were logged out by an administrator. Please log in again.');
    }
  }

  const { data: found, error: findErr } = await sb.rpc('doc_link_resolve', { p_id: id });
  if (findErr) return answer(500, 'The document could not be looked up. Try again.');
  const file = (found as { bucket: string; name: string }[] | null)?.[0];
  if (!file) {
    await log('not_found', null);
    return answer(404, 'This document is not stored any more, or the link is wrong.');
  }

  if (!staff && !(roles.includes('client') && file.name.split('/').includes(actorId))) {
    await log('refused', 'not this client\'s file');
    return answer(403, 'This document is not one of yours.');
  }

  const path = file.name.split('/').map(encodeURIComponent).join('/');
  let up: Response;
  try {
    up = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${encodeURIComponent(file.bucket)}/${path}`, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    });
  } catch (e) {
    await log('failed', (e as Error).message.slice(0, 200));
    return answer(502, 'The document could not be read. Try again.');
  }
  if (!up.ok || !up.body) {
    await up.body?.cancel().catch(() => {});
    await log(up.status === 400 || up.status === 404 ? 'not_found' : 'failed', `storage ${up.status}`);
    return up.status === 400 || up.status === 404
      ? answer(404, 'This document is not stored any more.')
      : answer(502, 'The document could not be read. Try again.');
  }

  const name = download ?? cleanName(file.name);
  const headers: Record<string, string> = {
    ...CORS,
    'Content-Type': up.headers.get('content-type') ?? 'application/octet-stream',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Doc-Name': encodeURIComponent(name),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const len = up.headers.get('content-length');
  if (len) headers['Content-Length'] = len;
  await log('opened', null);
  return new Response(up.body, { status: 200, headers });
});
