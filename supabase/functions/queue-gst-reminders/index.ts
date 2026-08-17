// queue-gst-reminders — server-side reminder generator (single source of truth,
// used by both the "Queue due reminders" button and the daily cron).
//
// For every client with reminders enabled whose return for `period` is still
// "Data Pending", enqueue the next ladder reminder (reminder_1 → reminder_2 →
// reminder_final) if it's due. Two ways a step becomes "due":
//   - Return type has a row in return_reminder_schedules (currently GSTR-1,
//     GSTR-3B, GSTR-6, GSTR-7 — see that table): fixed, firm-wide calendar
//     days, same for every client. A step fires once today's day-of-month
//     (IST) has reached its scheduled day; a missed cron day still catches up
//     on the next run (one step per run, never more).
//   - No schedule row for that return type (ITC-04, CMP-08, GSTR-1A, …):
//     falls back to the original per-client interval ladder — interval_days
//     elapsed since the last reminder, capped at max_reminders.
//
// "Data Pending" isn't only a literal filing_status row with that status —
// the app itself treats NO ROW AT ALL as Data Pending too (Filing Status /
// Dashboard both synthesize that default client-side; nothing gets persisted
// until a staff member actually touches the record). A period nobody has
// opened yet is exactly the client this feature exists to nag, so for the
// four scheduled return types this also builds a synthetic pending entry for
// any enabled, visible client whose selected_returns includes that return
// (or its IFF/Q variant) and has no filing_status row for it at all this
// period. Scoped to the scheduled types only — the interval-ladder types
// (ITC-04, CMP-08, GSTR-1A) still require a real row, same as before.
//
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

// 'GSTR-1 (IFF)' / 'GSTR-3B (Q)' are filing-frequency variants of their base
// return and follow the base return's fixed reminder schedule.
function baseReturnType(rt: string): string {
  if (rt === 'GSTR-1 (IFF)') return 'GSTR-1';
  if (rt === 'GSTR-3B (Q)') return 'GSTR-3B';
  return rt;
}

// Cron runs in UTC; the firm's reminder days are calendar days IST (UTC+5:30).
function todayDayIST(): number {
  return new Date(Date.now() + 5.5 * 3600 * 1000).getUTCDate();
}

// --- Synthetic "no filing_status row = Data Pending" support, scoped to the
// four scheduled return types. Ports the client-visibility + scheme-aware
// return resolution that src/lib/filingRecords.ts (generateFilingRecords /
// isClientVisibleForMonth) uses to decide what shows on the Filing Status
// page / Dashboard, so this function nags on exactly the same population.

interface ClientRow {
  id: string;
  registration_type: string;
  selected_returns: string[] | null;
  registration_date: string;
  cancellation_date?: string | null;
  registration_cancellation_date?: string | null;
  inactive_at_hand?: boolean | null;
}

interface SchemeHistoryEntry {
  client_id: string;
  old_scheme: string;
  new_scheme: string;
  effective_from_date: string;
}

const RETURN_TYPES_BY_REGISTRATION: Record<string, string[]> = {
  'Regular': ['GSTR-1', 'GSTR-3B', 'ITC-04'],
  'Composition': ['CMP-08'],
  'Tax Deductor': ['GSTR-7'],
  'ISD': ['GSTR-6'],
  'IFF': ['GSTR-1 (IFF)', 'GSTR-3B (Q)'],
};

// The tab-level variant set checked for each scheduled base return type,
// mirroring generateFilingRecords' returnTypesToCheck for the GSTR-1/GSTR-3B tabs.
const SCHEDULE_VARIANTS: Record<string, string[]> = {
  'GSTR-1': ['GSTR-1', 'GSTR-1 (IFF)'],
  'GSTR-3B': ['GSTR-3B', 'GSTR-3B (Q)'],
  'GSTR-6': ['GSTR-6'],
  'GSTR-7': ['GSTR-7'],
};

function isQuarterEndMonth(month: number): boolean {
  return [3, 6, 9, 12].includes(month);
}

function isClientVisibleForMonth(client: ClientRow, periodMonth: string): boolean {
  const [monthStr, yearStr] = periodMonth.split('/');
  const periodDate = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
  const regDate = new Date(client.registration_date);
  const regMonth = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
  if (periodDate < regMonth) return false;

  const cancelRaw = client.cancellation_date || client.registration_cancellation_date;
  if (cancelRaw) {
    const cancelDate = new Date(cancelRaw);
    const cancelMonth = new Date(cancelDate.getFullYear(), cancelDate.getMonth(), 1);
    return periodDate <= cancelMonth;
  }
  if (client.inactive_at_hand) return false;
  return true;
}

function getEffectiveScheme(periodMonth: string, currentScheme: string, history: SchemeHistoryEntry[]): string {
  if (!history.length) return currentScheme;
  const [mm, yyyy] = periodMonth.split('/');
  const periodDate = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
  let effectiveScheme = history[0].old_scheme;
  for (const entry of history) {
    const effectiveDate = new Date(entry.effective_from_date);
    const effectiveMonthStart = new Date(effectiveDate.getFullYear(), effectiveDate.getMonth(), 1);
    if (periodDate >= effectiveMonthStart) effectiveScheme = entry.new_scheme;
    else break;
  }
  return effectiveScheme;
}

// Which of the scheduled return-type variants an eligible client resolves to
// this period — mirrors generateFilingRecords' per-client resolution
// (effective scheme + quarter-end gating for the (Q) variant), scoped to
// just GSTR-1/3B/6/7.
function resolveScheduledReturnsForClient(
  client: ClientRow,
  periodMonth: string,
  history: SchemeHistoryEntry[],
): string[] {
  const effectiveScheme = getEffectiveScheme(periodMonth, client.registration_type, history);
  const effectiveReturns = RETURN_TYPES_BY_REGISTRATION[effectiveScheme] || [];
  const selectedReturns = history.length ? effectiveReturns : (client.selected_returns || []);
  const isQuarterlyClient = effectiveScheme === 'IFF' || effectiveScheme === 'Composition';
  const [monthStr] = periodMonth.split('/');
  const isQuarterEnd = isQuarterEndMonth(parseInt(monthStr));

  const resolved: string[] = [];
  for (const base of Object.keys(SCHEDULE_VARIANTS)) {
    for (const rt of SCHEDULE_VARIANTS[base]) {
      if (!selectedReturns.includes(rt)) continue;
      if (rt === 'GSTR-3B (Q)' && (!isQuarterEnd || !isQuarterlyClient)) continue;
      if (rt === 'GSTR-3B' && isQuarterlyClient) continue;
      resolved.push(rt);
      break;
    }
  }
  return resolved;
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

  // All filing_status rows (any status) for enabled clients this period — used
  // both to pick real Data Pending rows and to know which (client, return_type)
  // pairs already have a row at all, so synthetic entries aren't added on top.
  const { data: allRows } = await sb
    .from('filing_status')
    .select('id, client_id, return_type, period_month, target_date, status')
    .eq('period_month', period)
    .in('client_id', [...enabled.keys()]);

  type PendingRow = { id: string | null; client_id: string; return_type: string; period_month: string; target_date: number | null };
  const rowKey = (clientId: string, rt: string) => `${clientId}__${rt}`;
  const existingByKey = new Map((allRows ?? []).map((r) => [rowKey(r.client_id, r.return_type), r]));

  const pending: PendingRow[] = (allRows ?? [])
    .filter((r) => r.status === 'Data Pending')
    .map((r) => ({ id: r.id, client_id: r.client_id, return_type: r.return_type, period_month: r.period_month, target_date: r.target_date }));

  const { data: clientRows } = await sb
    .from('clients')
    .select('id, registration_type, selected_returns, registration_date, cancellation_date, registration_cancellation_date, inactive_at_hand')
    .in('id', [...enabled.keys()]);

  const { data: schemeHistoryRows } = await sb
    .from('client_scheme_history')
    .select('client_id, old_scheme, new_scheme, effective_from_date')
    .in('client_id', [...enabled.keys()])
    .order('effective_from_date', { ascending: true });
  const historyByClient = new Map<string, SchemeHistoryEntry[]>();
  for (const h of (schemeHistoryRows ?? []) as SchemeHistoryEntry[]) {
    const list = historyByClient.get(h.client_id) ?? [];
    list.push(h);
    historyByClient.set(h.client_id, list);
  }

  for (const client of (clientRows ?? []) as ClientRow[]) {
    if (!isClientVisibleForMonth(client, period)) continue;
    const history = historyByClient.get(client.id) ?? [];
    const resolvedTypes = resolveScheduledReturnsForClient(client, period, history);
    for (const rt of resolvedTypes) {
      if (existingByKey.has(rowKey(client.id, rt))) continue;
      pending.push({ id: null, client_id: client.id, return_type: rt, period_month: period, target_date: null });
    }
  }

  if (!pending.length) return json({ queued, skipped, period, note: 'nothing Data Pending' });

  const { data: tpls } = await sb
    .from('email_templates')
    .select('key, subject, body, is_active')
    .in('key', ['reminder_1', 'reminder_2', 'reminder_final']);
  const tplByKey = new Map((tpls ?? []).filter((t) => t.is_active !== false).map((t) => [t.key, t]));

  const { data: schedules } = await sb
    .from('return_reminder_schedules')
    .select('return_type, due_day, reminder_1_day, reminder_2_day, reminder_final_day');
  const scheduleByReturnType = new Map((schedules ?? []).map((s) => [s.return_type as string, s]));

  const now = Date.now();
  const todayDay = todayDayIST();
  for (const row of pending) {
    const cfg = enabled.get(row.client_id)!;
    const schedule = scheduleByReturnType.get(baseReturnType(row.return_type));
    const { data: prev } = await sb
      .from('email_outbox')
      .select('created_at')
      .eq('client_id', row.client_id).eq('return_type', row.return_type)
      .eq('period_month', row.period_month).eq('kind', 'reminder')
      .order('created_at', { ascending: false });
    const count = prev?.length ?? 0;
    const step = count + 1;
    let key: string;
    let targetDateForEmail: number | null;

    if (schedule) {
      // Fixed firm-wide calendar-day ladder — always exactly 3 steps, no
      // per-client interval/cap/escalate; a step fires once its scheduled
      // day-of-month has arrived (catches up on the next run if a day was
      // missed, one step per run).
      if (step > 3) { skipped++; continue; }
      const stepDay = step === 1 ? schedule.reminder_1_day : step === 2 ? schedule.reminder_2_day : schedule.reminder_final_day;
      if (todayDay < stepDay) { skipped++; continue; }
      key = step === 1 ? 'reminder_1' : step === 2 ? 'reminder_2' : 'reminder_final';
      targetDateForEmail = schedule.due_day;
    } else {
      // No fixed schedule for this return type — original per-client interval ladder.
      if (cfg.max_reminders != null && count >= cfg.max_reminders) { skipped++; continue; }
      if (count > 0) {
        const days = (now - new Date(prev![0].created_at as string).getTime()) / 86400000;
        if (days < cfg.interval_days) { skipped++; continue; }
      }
      key = !cfg.escalate ? 'reminder_1' : step <= 1 ? 'reminder_1' : step === 2 ? 'reminder_2' : 'reminder_final';
      targetDateForEmail = row.target_date;
    }

    const tpl = tplByKey.get(key);
    if (!tpl) { skipped++; continue; }
    const { data: client } = await sb.from('clients').select('name, email, gstin').eq('id', row.client_id).maybeSingle();
    if (!client?.email) { skipped++; continue; }
    const { dueDate, dataByDate } = computeDates(row.period_month, targetDateForEmail);
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
