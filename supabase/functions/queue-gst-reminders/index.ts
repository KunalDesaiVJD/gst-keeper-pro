// queue-gst-reminders — server-side reminder generator (single source of truth,
// used by both the "Queue due reminders" button and the daily cron).
//
// For every client with reminders enabled whose return for `period` is still
// "Data Pending", enqueue the next ladder reminder (reminder_1 → reminder_2 →
// reminder_final) if it's due — interval elapsed since the last, under the cap.
// Writes `pending` rows to email_outbox; the send-gst-email function delivers them.
//
// Body: { period?: "MM/YYYY", staffName?: string }. Default period = previous
// calendar month (the current GST return period).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const GST_FIRM = {
  name: 'V. J. Desai & Co. LLP',
  email: 'gst@vjdesai.com',
  phone: '',
  team: 'V. J. Desai & Co. (GST Team)',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function prettyPeriod(mmYYYY?: string | null): string {
  if (!mmYYYY) return '';
  const m = /^(\d{1,2})\/(\d{4})$/.exec(mmYYYY.trim());
  if (!m) return mmYYYY;
  const mi = Number(m[1]) - 1;
  return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ${m[2]}` : mmYYYY;
}

function renderTemplate(s: string, vars: Record<string, string>): string {
  return (s ?? '').replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? '');
}

function computeDates(periodMonth: string, targetDate?: number | null): { dueDate: string; dataByDate: string } {
  const m = /^(\d{1,2})\/(\d{4})$/.exec(periodMonth || '');
  if (!m || !targetDate) return { dueDate: '', dataByDate: '' };
  let mo = Number(m[1]) + 1;
  let yr = Number(m[2]);
  if (mo > 12) { mo = 1; yr += 1; }
  const due = new Date(yr, mo - 1, Math.min(28, Math.max(1, targetDate)));
  const dataBy = new Date(due.getTime() - 3 * 86400000);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  return { dueDate: fmt(due), dataByDate: fmt(dataBy) };
}

function prevMonthPeriod(): string {
  const now = new Date();
  const p = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${String(p.getMonth() + 1).padStart(2, '0')}/${p.getFullYear()}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let period = prevMonthPeriod();
  let staffName: string | null = null;
  try {
    const b = await req.json();
    if (b?.period && /^\d{1,2}\/\d{4}$/.test(b.period)) period = b.period;
    if (b?.staffName) staffName = String(b.staffName);
  } catch { /* no body → defaults */ }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let queued = 0, skipped = 0;

  const { data: settings } = await sb
    .from('client_reminder_settings')
    .select('client_id, interval_days, escalate, max_reminders')
    .eq('enabled', true);
  const enabled = new Map((settings ?? []).map((s) => [s.client_id, s]));
  if (enabled.size === 0) return json({ queued, skipped, period, note: 'no clients enabled' });

  const { data: pending } = await sb
    .from('filing_status')
    .select('id, client_id, return_type, period_month, target_date')
    .eq('period_month', period)
    .eq('status', 'Data Pending')
    .in('client_id', [...enabled.keys()]);
  if (!pending?.length) return json({ queued, skipped, period, note: 'nothing Data Pending' });

  const { data: tpls } = await sb
    .from('email_templates')
    .select('key, subject, body, is_active')
    .in('key', ['reminder_1', 'reminder_2', 'reminder_final']);
  const tplByKey = new Map((tpls ?? []).filter((t) => t.is_active !== false).map((t) => [t.key, t]));

  const now = Date.now();
  for (const row of pending) {
    const cfg = enabled.get(row.client_id)!;
    const { data: prev } = await sb
      .from('email_outbox')
      .select('created_at')
      .eq('client_id', row.client_id).eq('return_type', row.return_type)
      .eq('period_month', row.period_month).eq('kind', 'reminder')
      .order('created_at', { ascending: false });
    const count = prev?.length ?? 0;
    if (cfg.max_reminders != null && count >= cfg.max_reminders) { skipped++; continue; }
    if (count > 0) {
      const days = (now - new Date(prev![0].created_at as string).getTime()) / 86400000;
      if (days < cfg.interval_days) { skipped++; continue; }
    }
    const step = count + 1;
    const key = !cfg.escalate ? 'reminder_1' : step <= 1 ? 'reminder_1' : step === 2 ? 'reminder_2' : 'reminder_final';
    const tpl = tplByKey.get(key);
    if (!tpl) { skipped++; continue; }
    const { data: client } = await sb.from('clients').select('name, email, gstin').eq('id', row.client_id).maybeSingle();
    if (!client?.email) { skipped++; continue; }
    const { dueDate, dataByDate } = computeDates(row.period_month, row.target_date);
    const vars: Record<string, string> = {
      contact_person: client.name, client_name: client.name, gstin: client.gstin ?? '',
      return_type: row.return_type, period: prettyPeriod(row.period_month),
      due_date: dueDate, data_by_date: dataByDate, arn: '', filing_date: '',
      staff_name: staffName || GST_FIRM.team, firm_name: GST_FIRM.name,
      firm_email: GST_FIRM.email, firm_phone: GST_FIRM.phone,
    };
    const { error } = await sb.from('email_outbox').insert({
      client_id: row.client_id, to_email: client.email, kind: 'reminder', template_key: key,
      return_type: row.return_type, period_month: row.period_month,
      subject: renderTemplate(tpl.subject, vars), body: renderTemplate(tpl.body, vars),
      render_vars: vars,
      status: 'pending', reminder_step: step, filing_status_id: row.id,
    });
    if (error) { skipped++; continue; }
    queued++;
  }
  return json({ queued, skipped, period });
});
