// send-gst-email — delivers queued GST emails.
//
// Drains public.email_outbox (status='pending') by sending each message from
// gst@vjdesai.com via the Microsoft Graph API (application permission Mail.Send,
// client-credentials flow). No attachments. Marks each row sent/failed.
//
// Invoked by:
//   • the "Send queued now" button on the Reminders page (anon key), and
//   • a daily pg_cron job (service-role key).
//
// Secrets (Supabase vault, never in the repo):
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TENANT = Deno.env.get('GRAPH_TENANT_ID')!;
const CLIENT_ID = Deno.env.get('GRAPH_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('GRAPH_CLIENT_SECRET')!;
const SENDER = Deno.env.get('GRAPH_SENDER') ?? 'gst@vjdesai.com';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function graphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.access_token as string;
}

async function sendMail(token: string, to: string, subject: string, body: string): Promise<void> {
  const payload = {
    message: {
      subject: subject || '(no subject)',
      // Templates are corporate HTML; send as HTML so the layout renders.
      body: { contentType: 'HTML', content: body ?? '' },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  };
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // Graph sendMail returns 202 Accepted with an empty body on success.
  if (r.status !== 202) {
    const t = await r.text();
    throw new Error(`sendMail ${r.status}: ${t.slice(0, 400)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Optional body: { limit?: number, id?: string } — id targets one row (for testing).
  let limit = 200;
  let onlyId: string | null = null;
  try {
    const b = await req.json();
    if (b?.limit) limit = Math.min(500, Math.max(1, Number(b.limit)));
    if (b?.id) onlyId = String(b.id);
  } catch { /* no body */ }

  let q = sb.from('email_outbox')
    .select('id, to_email, subject, body')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (onlyId) q = q.eq('id', onlyId);
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 500);
  if (!rows?.length) return json({ sent: 0, failed: 0, message: 'nothing pending' });

  let token: string;
  try {
    token = await graphToken();
  } catch (e) {
    return json({ error: 'graph auth failed: ' + (e as Error).message }, 502);
  }

  let sent = 0, failed = 0, skipped = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const row of rows) {
    // Atomically claim the row so a concurrent run can't send it twice.
    const { data: claim } = await sb.from('email_outbox')
      .update({ status: 'sending' })
      .eq('id', row.id).eq('status', 'pending')
      .select('id');
    if (!claim?.length) continue; // already claimed elsewhere

    if (!row.to_email) {
      await sb.from('email_outbox').update({ status: 'skipped', error: 'no recipient email' }).eq('id', row.id);
      skipped++;
      continue;
    }
    try {
      await sendMail(token, row.to_email, row.subject, row.body);
      await sb.from('email_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .eq('id', row.id);
      sent++;
    } catch (e) {
      const msg = ((e as Error).message ?? 'send error').slice(0, 500);
      await sb.from('email_outbox').update({ status: 'failed', error: msg }).eq('id', row.id);
      errors.push({ id: row.id, error: msg });
      failed++;
    }
  }
  return json({ sent, failed, skipped, errors: errors.slice(0, 10) });
});
