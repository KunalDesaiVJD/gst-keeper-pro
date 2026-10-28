// The request handling of engagement-letter, apart from Deno.serve, the
// database and Graph so test/handler.test.ts can drive it with fakes.
//
// Three actions, each told only an id; what is sent, and to whom, comes from
// the database (migration 20261028110000):
//   {action: 'send', letter_id}: mints the link's token (only its hash goes to
//     engagement_letter_issue), e-mails the letter with its one page summary,
//     and reports it (engagement_letter_mark_sent: the new link opens the
//     letter only once its e-mail is out);
//   {action: 'code', code_id}: e-mails the code the page asked for
//     (engagement_letter_code_claim / _mark);
//   {action: 'copy', letter_id}: once a letter is signed, e-mails the signed
//     copy with its own link (engagement_letter_copy_claim, once only) to the
//     signer and the CC, and a note to the firm (engagement_letter_copy_mark).
// Answers {ok, status: 'sent' | 'failed' | 'none'}; never a token, a code or
// Graph's error (the caller may be the public page). Never logs a token or a code.
import { codeEmail, checkedAddress, copyEmail, firmCopyEmail, letterEmail, type ClaimedCode, type IssuedLetter, type SignedLetter } from './message.ts';

export interface Deps {
  /** The database's functions, through the service role. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  /** Sends one message (no copy in the firm's Sent Items). */
  send: (to: string, subject: string, html: string, cc?: string | null) => Promise<void>;
  /** The firm's mailbox, for its note of a signature. */
  firmMailbox?: string;
  /** A new token (tests give their own). */
  token?: () => string;
  log?: (line: string) => void;
}

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 32 random bytes as base64url: the link's token. */
export function mintToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The token's SHA-256 as hex, as the database's engagement_letter_hash. */
export async function tokenHash(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const brief = (e: unknown) => ((e as Error)?.message || 'send error').slice(0, 500);

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const newToken = deps.token ?? mintToken;
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    let body: Record<string, unknown> = {};
    try { body = (await req.json()) as Record<string, unknown>; } catch { /* no body */ }
    const action = String(body.action ?? '');
    const id = String(body.letter_id ?? body.code_id ?? '');
    if (!['send', 'code', 'copy'].includes(action) || !UUID_RE.test(id)) return json({ ok: false, status: 'none' }, 400);

    if (action === 'send') {
      const token = newToken();
      const { data, error } = await deps.rpc('engagement_letter_issue', { p_letter_id: id, p_token_hash: await tokenHash(token) });
      if (error) { log(`engagement-letter: issue ${id} failed: ${error.message}`); return json({ ok: false, status: 'failed' }, 500); }
      const l = data as IssuedLetter | null;
      if (!l) return json({ ok: true, status: 'none' });
      let problem: string | null = null;
      try {
        const { subject, html } = letterEmail(l, token);
        await deps.send(checkedAddress(l.to), subject, html, l.cc);
      } catch (e) { problem = brief(e); }
      log(`engagement-letter: letter ${id} ${problem ? 'failed: ' + problem : 'sent'}`);
      const mark = await deps.rpc('engagement_letter_mark_sent', { p_letter_id: id, p_error: problem });
      if (mark.error) log(`engagement-letter: mark ${id} failed: ${mark.error.message}`);
      return json({ ok: !problem, status: problem ? 'failed' : 'sent' });
    }

    if (action === 'code') {
      const { data, error } = await deps.rpc('engagement_letter_code_claim', { p_code_id: id });
      if (error) { log(`engagement-letter: claim ${id} failed: ${error.message}`); return json({ ok: false, status: 'failed' }, 500); }
      const c = data as ClaimedCode | null;
      if (!c) return json({ ok: true, status: 'none' });
      let problem: string | null = null;
      try {
        const { subject, html } = codeEmail(c);
        await deps.send(checkedAddress(c.to), subject, html);
      } catch (e) { problem = brief(e); }
      log(`engagement-letter: code ${id} ${problem ? 'failed: ' + problem : 'sent'}`);
      const mark = await deps.rpc('engagement_letter_code_mark', { p_code_id: id, p_error: problem });
      if (mark.error) log(`engagement-letter: code mark ${id} failed: ${mark.error.message}`);
      return json({ ok: !problem, status: problem ? 'failed' : 'sent' });
    }

    // copy
    const token = newToken();
    const { data, error } = await deps.rpc('engagement_letter_copy_claim', { p_letter_id: id, p_view_hash: await tokenHash(token) });
    if (error) { log(`engagement-letter: copy ${id} failed: ${error.message}`); return json({ ok: false, status: 'failed' }, 500); }
    const s = data as SignedLetter | null;
    if (!s) return json({ ok: true, status: 'none' });
    let problem: string | null = null;
    try {
      const { subject, html } = copyEmail(s, token);
      await deps.send(checkedAddress(s.to), subject, html, s.cc);
    } catch (e) { problem = brief(e); }
    // The firm's note goes even when the client's copy fails, so someone follows up.
    const firm = deps.firmMailbox || s.firm?.email;
    if (firm) {
      try {
        const { subject, html } = firmCopyEmail(s);
        await deps.send(checkedAddress(firm), subject, html);
      } catch (e) { log(`engagement-letter: firm note ${id} failed: ${brief(e)}`); }
    }
    log(`engagement-letter: copy ${id} ${problem ? 'failed: ' + problem : 'sent'}`);
    const mark = await deps.rpc('engagement_letter_copy_mark', { p_letter_id: id, p_error: problem });
    if (mark.error) log(`engagement-letter: copy mark ${id} failed: ${mark.error.message}`);
    return json({ ok: !problem, status: problem ? 'failed' : 'sent' });
  };
}
