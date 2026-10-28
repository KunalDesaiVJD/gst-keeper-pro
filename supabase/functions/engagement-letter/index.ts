// engagement-letter: e-mails an engagement letter for e-signature, the code
// that signs it and the signed copy (migration 20261028110000_engagement_letters.sql,
// docs/ENGAGEMENT_LETTERS.md). The link's token and the code are minted for
// one e-mail each and never stored or logged (only their hashes, in private
// tables), and never go through email_outbox, which the anon key can read;
// the messages are not kept in the firm's Sent Items (_shared/graph.ts).
// The request handling is handler.ts; the messages message.ts.
//
// The database is reached with plain PostgREST calls (no supabase-js), so the
// deploy bundler needs nothing from a registry.
//
// Secrets: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER.
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { graphToken, sendMail } from '../_shared/graph.ts';
import { makeHandler } from './handler.ts';

const url = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) return { data: null, error: { message: `${r.status} ${text.slice(0, 300)}` } };
  try { return { data: text ? JSON.parse(text) : null, error: null }; } catch { return { data: null, error: { message: 'not JSON' } }; }
}

Deno.serve(makeHandler({
  rpc,
  send: async (to, subject, html, cc) => sendMail(await graphToken(), to, subject, html, cc),
  firmMailbox: Deno.env.get('GRAPH_SENDER') || 'gst@vjdesai.com',
}));
