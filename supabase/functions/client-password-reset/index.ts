// client-password-reset — e-mails the client password reset links waiting in
// public.client_password_resets (migration 20261020100000).
//
// Woken by the database right after a link is queued (pg_net, the Vault anon
// key the cron jobs use) and by the app after asking; either may arrive
// first, claiming is exactly-once. For each waiting link it calls
// client_password_reset_claim (service role only), which mints the token and
// stores only its sha256, sends the e-mail through Microsoft Graph, and
// reports back with client_password_reset_mark (sent, or failed: the link is
// voided and staff get a request on the Dashboard).
//
// It answers {ok:true} at once and works afterwards, so the answer never
// shows whether a link went out. It takes no input: what is sent, and to
// whom, comes only from the database. Never logs a token.
//
// Secrets: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER.
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { graphToken, sendMail } from '../_shared/graph.ts';
import { type ClaimedLink, resetEmail } from './message.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function drain(): Promise<void> {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  for (let round = 0; round < 5; round++) {
    const { data, error } = await sb.rpc('client_password_reset_claim', { p_limit: 10 });
    if (error) throw new Error(`claim: ${error.message}`);
    const rows = (data ?? []) as ClaimedLink[];
    if (!rows.length) return;

    let token: string | null = null;
    let authError = '';
    try {
      token = await graphToken();
    } catch (e) {
      authError = `graph auth failed: ${(e as Error).message}`;
    }
    for (const row of rows) {
      let problem: string | null = authError || null;
      if (token) {
        try {
          const { subject, html } = resetEmail(row);
          await sendMail(token, row.to_email, subject, html);
        } catch (e) {
          problem = ((e as Error).message || 'send error').slice(0, 500);
        }
      }
      const { error: markError } = await sb.rpc('client_password_reset_mark', { p_reset_id: row.reset_id, p_error: problem });
      if (markError) console.error(`client-password-reset: mark ${row.reset_id}: ${markError.message}`);
      console.log(`client-password-reset: ${row.reset_id} ${problem ? 'failed: ' + problem : 'sent'}`);
    }
    if (rows.length < 10) return;
  }
}

type EdgeRuntimeLike = { waitUntil?: (p: Promise<unknown>) => void };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const work = drain().catch((e) => console.error(`client-password-reset: ${(e as Error).message}`));
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
  else await work;
  return json({ ok: true });
});
