// queue-notice-alerts — thin wrapper over the database alert engine.
//
// The alert logic lives in Postgres (public.notice_alerts_run, migration
// 20261006115000_notice_alerts_engine.sql) and pg_cron runs it directly:
// events every 15 minutes, the morning reminders at 09:30 IST, the weekly MIS
// on Mondays. This function only exists so an older schedule or a manual call
// that still targets it runs the same engine — there is one implementation.
//
// Body: { mode?: "events" | "daily" | "weekly" | "all" } (default "all";
// the old "digest" mode maps to "daily").
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let mode = 'all';
  try {
    const b = await req.json();
    if (b?.mode) mode = String(b.mode) === 'digest' ? 'daily' : String(b.mode);
  } catch { /* no body */ }
  if (!['events', 'daily', 'weekly', 'all'].includes(mode)) return json({ error: `unknown mode ${mode}` }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await sb.rpc('notice_alerts_run', { p_mode: mode });
  if (error) return json({ error: error.message }, 500);
  return json(data);
});
