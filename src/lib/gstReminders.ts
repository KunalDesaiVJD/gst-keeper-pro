import { supabase } from '@/integrations/supabase/client';

// Firm identity used to fill the {{firm_*}} template variables. gst@vjdesai.com
// is fixed (the sending address); phone is left blank for the firm to fill in
// the template footer or here later.
export const GST_FIRM = {
  name: 'V. J. Desai & Co. LLP',
  email: 'gst@vjdesai.com',
  phone: '',
  team: 'V. J. Desai & Co. (GST Team)',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'MM/YYYY' → 'July 2025' (falls back to the raw string if unparseable). */
export function prettyPeriod(mmYYYY?: string | null): string {
  if (!mmYYYY) return '';
  const m = /^(\d{1,2})\/(\d{4})$/.exec(mmYYYY.trim());
  if (!m) return mmYYYY;
  const mi = Number(m[1]) - 1;
  return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ${m[2]}` : mmYYYY;
}

/** Substitute {{var}} tokens; an unknown/absent variable renders as ''. */
export function renderTemplate(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? '');
}

type EnqueueResult = 'queued' | 'skipped' | 'error';

/**
 * Queue the filing-confirmation email for a client whose return was just marked
 * "Filed". Writes a `pending` row to email_outbox — the actual send happens
 * later via the gst@vjdesai.com sender. Best-effort and idempotent (the DB
 * unique index blocks a second confirmation for the same client/return/period).
 * Never throws to the caller.
 */
export async function enqueueConfirmation(opts: {
  clientId: string;
  returnType: string;
  periodMonth: string;
  arn: string;
  filedDate: string;
  filingStatusId?: string | null;
  staffName?: string | null;
}): Promise<EnqueueResult> {
  try {
    // Confirmation is ON by default; only skip if the client explicitly turned it off.
    const { data: st } = await supabase
      .from('client_reminder_settings')
      .select('send_confirmation')
      .eq('client_id', opts.clientId)
      .maybeSingle();
    if (st && st.send_confirmation === false) return 'skipped';

    const { data: client } = await supabase
      .from('clients')
      .select('name, email, gstin')
      .eq('id', opts.clientId)
      .maybeSingle();
    if (!client?.email) return 'skipped'; // no address on file → nothing to send

    const { data: tpl } = await supabase
      .from('email_templates')
      .select('subject, body, is_active')
      .eq('key', 'confirmation')
      .maybeSingle();
    if (!tpl || tpl.is_active === false) return 'skipped';

    const vars: Record<string, string> = {
      contact_person: client.name,
      client_name: client.name,
      gstin: client.gstin ?? '',
      return_type: opts.returnType,
      period: prettyPeriod(opts.periodMonth),
      arn: opts.arn,
      filing_date: opts.filedDate,
      staff_name: opts.staffName || GST_FIRM.team,
      firm_name: GST_FIRM.name,
      firm_email: GST_FIRM.email,
      firm_phone: GST_FIRM.phone,
      due_date: '',
      data_by_date: '',
    };

    const { error } = await supabase.from('email_outbox').insert({
      client_id: opts.clientId,
      to_email: client.email,
      kind: 'confirmation',
      template_key: 'confirmation',
      return_type: opts.returnType as never,
      period_month: opts.periodMonth,
      subject: renderTemplate(tpl.subject, vars),
      body: renderTemplate(tpl.body, vars),
      status: 'pending',
      filing_status_id: opts.filingStatusId ?? null,
    });
    if (error) {
      // 23505 = the confirmation for this (client, return, period) is already queued.
      if ((error as { code?: string }).code === '23505') return 'skipped';
      throw error;
    }
    return 'queued';
  } catch (e) {
    console.warn('[gstReminders] enqueueConfirmation failed (non-fatal):', (e as Error)?.message);
    return 'error';
  }
}

/** Statutory due date from the filing's target_date (day-of-month), filed in the
 *  month AFTER the return period; data cut-off = 3 days before that. Blank when
 *  target_date is unknown. */
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

/**
 * Queue GST data reminders for a period. For every enabled client whose return
 * for `periodMonth` is still "Data Pending", enqueue the next ladder reminder if
 * one is due (interval elapsed since the last, under the optional cap). Writes
 * `pending` rows to email_outbox; the gst@vjdesai.com sender delivers them.
 * Never throws. Returns how many were queued vs skipped.
 */
export async function enqueueReminders(periodMonth: string, staffName?: string | null): Promise<{ queued: number; skipped: number }> {
  let queued = 0, skipped = 0;
  try {
    const { data: settings } = await supabase
      .from('client_reminder_settings')
      .select('client_id, interval_days, escalate, max_reminders')
      .eq('enabled', true);
    const enabled = new Map((settings ?? []).map(s => [s.client_id, s]));
    if (enabled.size === 0) return { queued, skipped };

    const { data: pending } = await supabase
      .from('filing_status')
      .select('id, client_id, return_type, period_month, target_date')
      .eq('period_month', periodMonth)
      .eq('status', 'Data Pending')
      .in('client_id', [...enabled.keys()]);
    if (!pending?.length) return { queued, skipped };

    const { data: tpls } = await supabase
      .from('email_templates')
      .select('key, subject, body, is_active')
      .in('key', ['reminder_1', 'reminder_2', 'reminder_final']);
    const tplByKey = new Map((tpls ?? []).filter(t => t.is_active !== false).map(t => [t.key, t]));

    const now = Date.now();
    for (const row of pending) {
      const cfg = enabled.get(row.client_id)!;
      const { data: prev } = await supabase
        .from('email_outbox')
        .select('created_at')
        .eq('client_id', row.client_id).eq('return_type', row.return_type)
        .eq('period_month', row.period_month).eq('kind', 'reminder')
        .order('created_at', { ascending: false });
      const count = prev?.length ?? 0;
      if (cfg.max_reminders != null && count >= cfg.max_reminders) { skipped++; continue; }
      if (count > 0) {
        const days = (now - new Date(prev![0].created_at as string).getTime()) / 86400000;
        if (days < cfg.interval_days) { skipped++; continue; } // not due yet
      }
      const step = count + 1;
      const key = !cfg.escalate ? 'reminder_1' : step <= 1 ? 'reminder_1' : step === 2 ? 'reminder_2' : 'reminder_final';
      const tpl = tplByKey.get(key);
      if (!tpl) { skipped++; continue; }
      const { data: client } = await supabase.from('clients').select('name, email, gstin').eq('id', row.client_id).maybeSingle();
      if (!client?.email) { skipped++; continue; }
      const { dueDate, dataByDate } = computeDates(row.period_month, row.target_date);
      const vars: Record<string, string> = {
        contact_person: client.name, client_name: client.name, gstin: client.gstin ?? '',
        return_type: row.return_type, period: prettyPeriod(row.period_month),
        due_date: dueDate, data_by_date: dataByDate, arn: '', filing_date: '',
        staff_name: staffName || GST_FIRM.team, firm_name: GST_FIRM.name,
        firm_email: GST_FIRM.email, firm_phone: GST_FIRM.phone,
      };
      const { error } = await supabase.from('email_outbox').insert({
        client_id: row.client_id, to_email: client.email, kind: 'reminder', template_key: key,
        return_type: row.return_type as never, period_month: row.period_month,
        subject: renderTemplate(tpl.subject, vars), body: renderTemplate(tpl.body, vars),
        status: 'pending', reminder_step: step, filing_status_id: row.id,
      });
      if (error) { skipped++; continue; }
      queued++;
    }
  } catch (e) {
    console.warn('[gstReminders] enqueueReminders failed (non-fatal):', (e as Error)?.message);
  }
  return { queued, skipped };
}
