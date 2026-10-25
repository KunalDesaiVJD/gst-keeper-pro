// queue-gst-reminders — server-side reminder generator (single source of truth,
// used by the daily cron and by the GST Reminders page).
//
// For every client with reminders enabled whose return is still "Data
// Pending", queue the reminder that is due. Two ways a reminder becomes due:
//   - GSTR-1, GSTR-1 (IFF), GSTR-3B, GSTR-3B (Q), GSTR-6, GSTR-7: on the dates
//     of the period's plan (reminder_period_plans), else of the standard
//     schedule (return_reminder_schedules). The rules are in
//     ../_shared/reminderPlan.ts: a reminder goes out on its date, at most one
//     per client, return and period a day, only the latest step whose date has
//     come (a missed earlier step is skipped, never sent late in a burst), and
//     nothing after the due date. Each step carries a dedupe key, so two runs
//     or two clicks never queue it twice.
//   - Any other return type (ITC-04, CMP-08, GSTR-1A, ...): the per-client
//     interval ladder (interval_days since the last reminder, capped at
//     max_reminders), for real Data Pending rows of the current return period.
//
// "Data Pending" isn't only a literal filing_status row with that status —
// the app itself treats NO ROW AT ALL as Data Pending too (Filing Status /
// Dashboard both synthesize that default client-side; nothing gets persisted
// until a staff member actually touches the record). A period nobody has
// opened yet is exactly the client this feature exists to nag, so for the
// planned return types this also builds a synthetic pending entry for any
// enabled, visible client whose selected_returns includes that return and has
// no filing_status row for it at all this period.
//
// Writes `pending` rows to email_outbox; the send-gst-email function delivers them.
//
// Body (all optional):
//   {}                                   the daily run: last month's period and
//                                        this month's (a plan may send inside
//                                        the period month)
//   { mode: 'due', period }              the same, for one period
//   { mode: 'now', period, step,         send one reminder now, whatever the
//     returnTypes?, clientIds? }         dates (still never twice in a day)
//   customEmail: { subject, body }       Send now only: this send's own wording
//   dryRun: true                         list what would be queued, write nothing
//   staffName                            {{staff_name}} in the e-mail
//
// The wording: Send now's customEmail, else the e-mail written for that
// period, return and step (reminder_period_emails), else the step's template.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  PLAN_RETURN_TYPES, STEP_TEMPLATE, type ReminderStep, type ResolvedPlan,
  currentReturnPeriod, dueDateFor, formatDate, parsePeriod, resolvePlan, returnFiledForPeriod,
  shiftPeriod, stepDueToday, todayIST, addDays,
  type PeriodPlanRow, type StandardScheduleRow,
} from '../_shared/reminderPlan.ts';

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

// Interval-ladder return types: due date = filing_status.target_date of the
// month after the period, "send data by" three days earlier.
function ladderDates(periodMonth: string, targetDate?: number | null): { dueDate: string; dataByDate: string } {
  const p = parsePeriod(periodMonth);
  if (!p || !targetDate) return { dueDate: '', dataByDate: '' };
  const next = parsePeriod(shiftPeriod(periodMonth, 1))!;
  const due = `${next.year}-${String(next.month).padStart(2, '0')}-${String(Math.min(28, Math.max(1, targetDate))).padStart(2, '0')}`;
  return { dueDate: formatDate(due), dataByDate: formatDate(addDays(due, -3)) };
}

const isPlanned = (rt: string) => (PLAN_RETURN_TYPES as readonly string[]).includes(rt);

// --- Synthetic "no filing_status row = Data Pending" support, scoped to the
// planned return types. Ports the client-visibility + scheme-aware
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

type Mode = 'due' | 'now';
interface Item {
  client_id: string;
  client_name: string;
  to_email: string;
  return_type: string;
  period: string;
  step: number | null;
  template: string | null;
  /** 'period' = the e-mail written for this period; 'once' = Send now's own wording. */
  custom?: 'period' | 'once';
  due_date: string;
  result: 'queued' | 'would_queue' | 'skipped';
  reason?: string;
}

const REASON_TEXT: Record<string, string> = {
  not_yet: 'not due yet',
  already_sent: 'already sent',
  past_due: 'due date passed',
  sent_today: 'a reminder already went today',
  no_dates: 'no reminder dates',
  no_email: 'no e-mail address',
  no_template: 'template switched off',
  no_plan: 'no schedule for this return',
  not_this_period: 'not filed for this period',
  capped: 'reached the cap',
  interval: 'interval not reached',
  duplicate: 'already queued',
  error: 'could not be queued',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let mode: Mode = 'due';
  let periods: string[] = [currentReturnPeriod(), shiftPeriod(currentReturnPeriod(), 1)];
  let staffName: string | null = null;
  let dryRun = false;
  let manualStep: ReminderStep = 1;
  let onlyReturnTypes: Set<string> | null = null;
  let onlyClients: Set<string> | null = null;
  let onceEmail: { subject: string; body: string } | null = null;
  try {
    const b = await req.json();
    if (b?.mode === 'now') mode = 'now';
    if (b?.period && parsePeriod(String(b.period))) periods = [String(b.period).padStart(7, '0')];
    if (b?.staffName) staffName = String(b.staffName);
    if (b?.dryRun) dryRun = true;
    if ([1, 2, 3].includes(Number(b?.step))) manualStep = Number(b.step) as ReminderStep;
    if (Array.isArray(b?.returnTypes) && b.returnTypes.length) onlyReturnTypes = new Set(b.returnTypes.map(String));
    if (Array.isArray(b?.clientIds) && b.clientIds.length) onlyClients = new Set(b.clientIds.map(String));
    // Send now only: this one send's own subject and wording, instead of the template.
    if (b?.customEmail && String(b.customEmail.subject ?? '').trim() && String(b.customEmail.body ?? '').trim()) {
      onceEmail = { subject: String(b.customEmail.subject), body: String(b.customEmail.body) };
    }
  } catch { /* no body → the daily run */ }
  if (mode === 'now' && periods.length !== 1) return json({ error: 'Choose one period to send now.' }, 400);
  if (onceEmail && mode !== 'now') return json({ error: 'An e-mail of your own goes only with Send now.' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const today = todayIST();
  const items: Item[] = [];
  const done = () => {
    const queued = items.filter((i) => i.result === 'queued').length;
    const wouldQueue = items.filter((i) => i.result === 'would_queue').length;
    return json({ mode, dryRun, today, periods, queued, would_queue: wouldQueue, skipped: items.length - queued - wouldQueue, items });
  };

  const { data: settings } = await sb
    .from('client_reminder_settings')
    .select('client_id, interval_days, escalate, max_reminders')
    .eq('enabled', true);
  const enabled = new Map((settings ?? []).filter((s) => !onlyClients || onlyClients.has(s.client_id)).map((s) => [s.client_id, s]));
  if (enabled.size === 0) return done();
  const clientIds = [...enabled.keys()];

  const [{ data: clientRows }, { data: schemeHistoryRows }, { data: tpls }, { data: standardRows }, { data: planRows }, { data: periodEmailRows }, { data: allRows }, { data: sentRows }] = await Promise.all([
    sb.from('clients')
      .select('id, name, email, gstin, registration_type, selected_returns, registration_date, cancellation_date, registration_cancellation_date, inactive_at_hand')
      .in('id', clientIds),
    sb.from('client_scheme_history')
      .select('client_id, old_scheme, new_scheme, effective_from_date')
      .in('client_id', clientIds)
      .order('effective_from_date', { ascending: true }),
    sb.from('email_templates').select('key, subject, body, is_active').in('key', ['reminder_1', 'reminder_2', 'reminder_final']),
    sb.from('return_reminder_schedules').select('return_type, due_day, due_day_y, reminder_1_day, reminder_2_day, reminder_final_day'),
    sb.from('reminder_period_plans').select('*').in('period_month', periods),
    sb.from('reminder_period_emails').select('period_month, return_type, step, subject, body').in('period_month', periods),
    sb.from('filing_status')
      .select('id, client_id, return_type, period_month, target_date, status')
      .in('period_month', periods)
      .in('client_id', clientIds),
    sb.from('email_outbox')
      .select('client_id, return_type, period_month, reminder_step, created_at')
      .eq('kind', 'reminder')
      .in('period_month', periods)
      .in('client_id', clientIds),
  ]);

  const tplByKey = new Map((tpls ?? []).filter((t) => t.is_active !== false).map((t) => [t.key, t]));
  const periodEmail = new Map((periodEmailRows ?? []).map((e) => [`${e.return_type}__${e.period_month}__${e.step}`, e as { subject: string; body: string }]));
  const standard = (standardRows ?? []) as StandardScheduleRow[];
  const plans = (planRows ?? []) as PeriodPlanRow[];
  const clientById = new Map((clientRows ?? []).map((c) => [c.id as string, c as ClientRow & { name: string; email: string | null; gstin: string | null }]));
  const historyByClient = new Map<string, SchemeHistoryEntry[]>();
  for (const h of (schemeHistoryRows ?? []) as SchemeHistoryEntry[]) {
    const list = historyByClient.get(h.client_id) ?? [];
    list.push(h);
    historyByClient.set(h.client_id, list);
  }

  const key3 = (clientId: string, rt: string, period: string) => `${clientId}__${rt}__${period}`;
  // What already went (any status: a cancelled reminder is not queued again).
  const sentByKey = new Map<string, { steps: Map<number, string>; today: boolean; count: number; last: string }>();
  for (const r of sentRows ?? []) {
    const k = key3(r.client_id, r.return_type as string, r.period_month as string);
    const e = sentByKey.get(k) ?? { steps: new Map<number, string>(), today: false, count: 0, last: '' };
    const day = todayIST(new Date(r.created_at as string).getTime());
    if (r.reminder_step && day > (e.steps.get(r.reminder_step) ?? '')) e.steps.set(r.reminder_step, day);
    if (day === today) e.today = true;
    e.count++;
    if ((r.created_at as string) > e.last) e.last = r.created_at as string;
    sentByKey.set(k, e);
  }

  type PendingRow = { id: string | null; client_id: string; return_type: string; period_month: string; target_date: number | null };
  const existing = new Set((allRows ?? []).map((r) => key3(r.client_id, r.return_type as string, r.period_month as string)));
  const pending: PendingRow[] = (allRows ?? [])
    .filter((r) => r.status === 'Data Pending')
    .map((r) => ({ id: r.id, client_id: r.client_id, return_type: r.return_type as string, period_month: r.period_month as string, target_date: r.target_date }));
  for (const period of periods) {
    for (const client of clientById.values()) {
      if (!isClientVisibleForMonth(client, period)) continue;
      for (const rt of resolveScheduledReturnsForClient(client, period, historyByClient.get(client.id) ?? [])) {
        if (existing.has(key3(client.id, rt, period))) continue;
        pending.push({ id: null, client_id: client.id, return_type: rt, period_month: period, target_date: null });
      }
    }
  }

  const ladderPeriod = currentReturnPeriod();
  for (const row of pending) {
    if (onlyReturnTypes && !onlyReturnTypes.has(row.return_type)) continue;
    const client = clientById.get(row.client_id);
    if (!client) continue;
    const cfg = enabled.get(row.client_id)!;
    const sent = sentByKey.get(key3(row.client_id, row.return_type, row.period_month)) ?? { steps: new Map<number, string>(), today: false, count: 0, last: '' };
    const base: Item = {
      client_id: row.client_id, client_name: client.name, to_email: client.email ?? '',
      return_type: row.return_type, period: row.period_month, step: null, template: null, due_date: '', result: 'skipped',
    };
    const skip = (reason: string) => { items.push({ ...base, reason: REASON_TEXT[reason] ?? reason }); };

    let step: ReminderStep;
    let dueDate = '';
    let dataByDate = '';
    let dedupeKey: string;
    if (isPlanned(row.return_type)) {
      if (!returnFiledForPeriod(row.return_type, row.period_month)) continue;
      const plan: ResolvedPlan | null = resolvePlan(row.period_month, row.return_type, standard, plans);
      if (!plan) { skip('no_plan'); continue; }
      const due = dueDateFor(plan, client.gstin);
      base.due_date = due;
      dueDate = formatDate(due);
      dataByDate = formatDate(plan.dataByDate > due ? due : plan.dataByDate);
      if (mode === 'now') {
        if (sent.today) { skip('sent_today'); continue; }
        step = manualStep;
        dedupeKey = `reminder:now:${today}:${row.client_id}:${row.return_type}:${row.period_month}`;
      } else {
        const d = stepDueToday(plan, today, due, sent.steps, sent.today);
        if (!d.send) { skip(d.reason!); continue; }
        step = d.step!;
        dedupeKey = `reminder:plan:${row.client_id}:${row.return_type}:${row.period_month}:${step}:${plan.dates[step]}`;
      }
    } else {
      // Interval ladder: the current return period only, real Data Pending rows only.
      if (row.period_month !== ladderPeriod && mode === 'due') continue;
      if (!row.id) continue;
      ({ dueDate, dataByDate } = ladderDates(row.period_month, row.target_date));
      if (mode === 'now') {
        if (sent.today) { skip('sent_today'); continue; }
        step = manualStep;
        dedupeKey = `reminder:now:${today}:${row.client_id}:${row.return_type}:${row.period_month}`;
      } else {
        if (cfg.max_reminders != null && sent.count >= cfg.max_reminders) { skip('capped'); continue; }
        if (sent.count > 0 && (Date.now() - new Date(sent.last).getTime()) / 86400000 < cfg.interval_days) { skip('interval'); continue; }
        const n = sent.count + 1;
        step = (!cfg.escalate || n <= 1 ? 1 : n === 2 ? 2 : 3) as ReminderStep;
        dedupeKey = `reminder:ladder:${row.client_id}:${row.return_type}:${row.period_month}:${n}`;
      }
    }

    const key = STEP_TEMPLATE[step];
    base.step = step;
    base.template = key;
    // Send now's own wording, else the e-mail written for this period, else the template.
    const own = onceEmail ?? periodEmail.get(`${row.return_type}__${row.period_month}__${step}`) ?? null;
    if (own) base.custom = onceEmail ? 'once' : 'period';
    const tpl = own ?? tplByKey.get(key);
    if (!tpl) { skip('no_template'); continue; }
    if (!client.email) { skip('no_email'); continue; }
    if (dryRun) { items.push({ ...base, result: 'would_queue' }); continue; }

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
      dedupe_key: dedupeKey,
    });
    if (error) {
      skip((error as { code?: string }).code === '23505' ? 'duplicate' : 'error');
      continue;
    }
    sent.today = true;
    items.push({ ...base, result: 'queued' });
  }
  return done();
});
