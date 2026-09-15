import { supabase } from '@/integrations/supabase/client';
import { renderTemplate, GST_FIRM } from '@/lib/gstReminders';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AlertRule {
  id: string;
  alert_key: string;
  event_type: string | null;
  template_key: string;
  recipient: string;
  is_active: boolean;
  priority: string;
  cooldown_hrs: number | null;
  max_repeats: number | null;
}

interface NoticeEvent {
  id: string;
  notice_id: string;
  client_id: string;
  event_type: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
}

interface NoticeRow {
  id: string;
  client_id: string;
  notice_type: string | null;
  reference_number: string | null;
  description: string | null;
  issue_date: string | null;
  due_date: string | null;
  extended_due_date: string | null;
  staff_status: string | null;
  priority: string | null;
  assign_to: string | null;
  assign_to_user_id: string | null;
  reply_date: string | null;
  reply_ref_number: string | null;
  order_date: string | null;
  order_number: string | null;
  hearing_date: string | null;
  issued_by: string | null;
}

interface StaffInfo {
  userId: string;
  name: string;
  email: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayIST(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function dedupeKey(ruleKey: string, noticeId: string, extra?: string): string {
  return extra ? `${ruleKey}:${noticeId}:${extra}` : `${ruleKey}:${noticeId}`;
}

async function isDuplicate(key: string): Promise<boolean> {
  const { data } = await supabase
    .from('email_outbox')
    .select('id')
    .eq('dedupe_key', key)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function isCoolingDown(ruleId: string, noticeId: string, cooldownHrs: number | null): Promise<boolean> {
  if (!cooldownHrs) return false;
  const cutoff = new Date(Date.now() - cooldownHrs * 3600000).toISOString();
  const { data } = await supabase
    .from('notice_alert_log')
    .select('id')
    .eq('rule_id', ruleId)
    .eq('notice_id', noticeId)
    .gte('created_at', cutoff)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function getClient(clientId: string) {
  const { data } = await supabase
    .from('clients')
    .select('name, gstin, email, contact_person')
    .eq('id', clientId)
    .maybeSingle();
  return data;
}

async function getStaffEmail(userId: string): Promise<StaffInfo | null> {
  const { data } = await supabase
    .from('profiles')
    .select('user_id, first_name, email')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data?.email) return null;
  return { userId: data.user_id, name: data.first_name || data.email.split('@')[0], email: data.email };
}

async function getTeamEmails(): Promise<StaffInfo[]> {
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    supabase.from('profiles').select('user_id, first_name, email'),
    supabase.from('user_roles').select('user_id, role'),
  ]);
  const staffRoles = new Set(
    (roles ?? []).filter((r) => r.role !== 'client').map((r) => r.user_id),
  );
  return (profiles ?? [])
    .filter((p) => staffRoles.has(p.user_id) && p.email)
    .map((p) => ({ userId: p.user_id, name: p.first_name || p.email!.split('@')[0], email: p.email! }));
}

async function getPartnerEmails(): Promise<StaffInfo[]> {
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    supabase.from('profiles').select('user_id, first_name, email'),
    supabase.from('user_roles').select('user_id, role'),
  ]);
  const partners = new Set(
    (roles ?? []).filter((r) => r.role === 'superadmin' || r.role === 'gst_manager').map((r) => r.user_id),
  );
  return (profiles ?? [])
    .filter((p) => partners.has(p.user_id) && p.email)
    .map((p) => ({ userId: p.user_id, name: p.first_name || p.email!.split('@')[0], email: p.email! }));
}

async function enqueueAlert(opts: {
  ruleId: string;
  noticeId: string;
  clientId: string;
  eventId?: string;
  toEmail: string;
  templateKey: string;
  vars: Record<string, string>;
  dedupe: string;
}): Promise<boolean> {
  const dup = await isDuplicate(opts.dedupe);
  if (dup) return false;

  const { data: tpl } = await supabase
    .from('email_templates')
    .select('subject, body, is_active')
    .eq('key', opts.templateKey)
    .maybeSingle();
  if (!tpl || tpl.is_active === false) return false;

  const subject = renderTemplate(tpl.subject, opts.vars);
  const body = renderTemplate(tpl.body, opts.vars);

  const { error: outboxErr, data: outboxRow } = await supabase
    .from('email_outbox')
    .insert({
      to_email: opts.toEmail,
      kind: 'notice_alert' as never,
      template_key: opts.templateKey,
      subject,
      body,
      render_vars: opts.vars,
      status: 'pending',
      notice_id: opts.noticeId,
      client_id: opts.clientId,
      dedupe_key: opts.dedupe,
    })
    .select('id')
    .maybeSingle();

  if (outboxErr) {
    if ((outboxErr as { code?: string }).code === '23505') return false;
    console.warn('[noticeAlertQueue] outbox insert error:', outboxErr.message);
    return false;
  }

  await supabase.from('notice_alert_log').insert({
    rule_id: opts.ruleId,
    notice_id: opts.noticeId,
    client_id: opts.clientId,
    event_id: opts.eventId ?? null,
    email_outbox_id: outboxRow?.id ?? null,
    recipient_email: opts.toEmail,
    status: 'sent',
    dedupe_key: opts.dedupe,
  });

  return true;
}

function buildNoticeVars(notice: NoticeRow, client: { name: string; gstin: string | null; contact_person?: string | null }): Record<string, string> {
  const effectiveDue = notice.extended_due_date || notice.due_date;
  const today = todayIST();
  let daysRemaining = '';
  if (effectiveDue) {
    const due = new Date(effectiveDue);
    daysRemaining = String(daysBetween(today, due));
  }
  return {
    notice_type: notice.notice_type || 'Notice',
    client_name: client.name,
    gstin: client.gstin || '',
    reference_number: notice.reference_number || '',
    description: notice.description || '',
    issue_date: notice.issue_date || '',
    due_date: effectiveDue || '',
    days_remaining: daysRemaining,
    priority: notice.priority || 'Normal',
    hearing_date: notice.hearing_date || '',
    issued_by: notice.issued_by || '',
    old_status: '',
    new_status: notice.staff_status || '',
    reply_date: notice.reply_date || '',
    reply_ref_number: notice.reply_ref_number || '',
    order_date: notice.order_date || '',
    order_number: notice.order_number || '',
    actor_name: '',
    staff_name: GST_FIRM.team,
    firm_name: GST_FIRM.name,
    firm_email: GST_FIRM.email,
    contact_person: client.contact_person || client.name,
  };
}

// ─── Event-triggered alerts (E1, E6, E7, E8) ───────────────────────────────

export async function processEventAlert(event: NoticeEvent): Promise<number> {
  const { data: rules } = await supabase
    .from('notice_alert_rules')
    .select('*')
    .eq('event_type', event.event_type)
    .eq('is_active', true);
  if (!rules?.length) return 0;

  const { data: notice } = await supabase
    .from('gst_notices')
    .select('id, client_id, notice_type, reference_number, description, issue_date, due_date, extended_due_date, staff_status, priority, assign_to, assign_to_user_id, reply_date, reply_ref_number, order_date, order_number, hearing_date, issued_by')
    .eq('id', event.notice_id)
    .maybeSingle();
  if (!notice) return 0;

  const client = await getClient(event.client_id);
  if (!client) return 0;

  let queued = 0;

  for (const rule of rules) {
    if (await isCoolingDown(rule.id, event.notice_id, rule.cooldown_hrs)) continue;

    const vars = buildNoticeVars(notice as NoticeRow, client);
    if (event.old_value && typeof event.old_value === 'object') {
      vars.old_status = String((event.old_value as Record<string, unknown>).staff_status ?? '');
    }
    if (event.new_value && typeof event.new_value === 'object') {
      vars.new_status = String((event.new_value as Record<string, unknown>).staff_status ?? vars.new_status);
    }
    vars.actor_name = event.actor_name || '';

    const recipients = await resolveRecipients(rule.recipient, notice as NoticeRow);
    for (const recip of recipients) {
      const key = dedupeKey(rule.alert_key, event.notice_id, event.id);
      const sent = await enqueueAlert({
        ruleId: rule.id,
        noticeId: event.notice_id,
        clientId: event.client_id,
        eventId: event.id,
        toEmail: recip.email,
        templateKey: rule.template_key,
        vars: { ...vars, staff_name: recip.name },
        dedupe: key,
      });
      if (sent) queued++;
    }
  }

  return queued;
}

async function resolveRecipients(recipient: string, notice: NoticeRow): Promise<StaffInfo[]> {
  switch (recipient) {
    case 'assignee': {
      if (notice.assign_to_user_id) {
        const s = await getStaffEmail(notice.assign_to_user_id);
        return s ? [s] : await getTeamEmails();
      }
      return await getTeamEmails();
    }
    case 'partner':
      return await getPartnerEmails();
    case 'team':
      return await getTeamEmails();
    default:
      return await getTeamEmails();
  }
}

// ─── Flush: fire-and-forget the edge function ───────────────────────────────

export function flushOutbox(): void {
  void supabase.functions.invoke('send-gst-email', { body: {} }).catch(() => {});
}

// ─── Scheduled digest alerts (called from a manual "Run alerts" button) ─────

export async function runScheduledAlerts(): Promise<{ queued: number; errors: string[] }> {
  const today = todayIST();
  const errors: string[] = [];
  let queued = 0;

  const { data: openNotices } = await supabase
    .from('gst_notices')
    .select('id, client_id, notice_type, reference_number, description, issue_date, due_date, extended_due_date, staff_status, priority, assign_to, assign_to_user_id, reply_date, reply_ref_number, order_date, order_number, hearing_date, issued_by')
    .is('deleted_at', null);

  if (!openNotices?.length) return { queued, errors };

  const closedRe = /^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i;
  const open = openNotices.filter((n) => !closedRe.test(n.staff_status ?? ''));

  // E2: overdue digest
  const overdue = open.filter((n) => {
    if (n.reply_date) return false;
    const due = n.extended_due_date || n.due_date;
    if (!due) return false;
    return new Date(due) < today;
  });
  if (overdue.length > 0) {
    const todayStr = today.toISOString().slice(0, 10);
    const dk = dedupeKey('E2_overdue_digest', 'daily', todayStr);
    if (!(await isDuplicate(dk))) {
      const noticeListLines = overdue.slice(0, 50).map((n) => {
        const due = n.extended_due_date || n.due_date || '?';
        return `• ${n.notice_type || 'Notice'} — ${n.reference_number || 'No ref'} (Due: ${due})`;
      });
      const vars: Record<string, string> = {
        overdue_count: String(overdue.length),
        notice_list: noticeListLines.join('\n'),
        firm_name: GST_FIRM.name,
      };
      const { data: rule } = await supabase.from('notice_alert_rules').select('id, template_key').eq('alert_key', 'E2_overdue_digest').maybeSingle();
      if (rule) {
        const team = await getTeamEmails();
        for (const s of team) {
          const sent = await enqueueAlert({
            ruleId: rule.id,
            noticeId: overdue[0].id,
            clientId: overdue[0].client_id,
            toEmail: s.email,
            templateKey: rule.template_key,
            vars,
            dedupe: dk + ':' + s.email,
          });
          if (sent) queued++;
        }
      }
    }
  }

  // E3: due in 7 days
  const dueSoon = open.filter((n) => {
    const due = n.extended_due_date || n.due_date;
    if (!due) return false;
    const d = new Date(due);
    const days = daysBetween(today, d);
    return days >= 0 && days <= 7;
  });
  for (const n of dueSoon) {
    const dk = dedupeKey('E3_due_in_7', n.id, today.toISOString().slice(0, 10));
    if (await isDuplicate(dk)) continue;
    const client = await getClient(n.client_id);
    if (!client) continue;
    const vars = buildNoticeVars(n as NoticeRow, client);
    const { data: rule } = await supabase.from('notice_alert_rules').select('id, template_key').eq('alert_key', 'E3_due_in_7').maybeSingle();
    if (!rule) continue;
    const recipients = await resolveRecipients('assignee', n as NoticeRow);
    for (const r of recipients) {
      const sent = await enqueueAlert({
        ruleId: rule.id, noticeId: n.id, clientId: n.client_id,
        toEmail: r.email, templateKey: rule.template_key,
        vars: { ...vars, staff_name: r.name }, dedupe: dk + ':' + r.email,
      });
      if (sent) queued++;
    }
  }

  // E4: hearing reminder (hearing_date within 3 days)
  const hearingSoon = open.filter((n) => {
    if (!n.hearing_date) return false;
    const d = daysBetween(today, new Date(n.hearing_date));
    return d >= 0 && d <= 3;
  });
  for (const n of hearingSoon) {
    const dk = dedupeKey('E4_hearing', n.id, today.toISOString().slice(0, 10));
    if (await isDuplicate(dk)) continue;
    if (await isCoolingDown('', n.id, 24)) continue;
    const client = await getClient(n.client_id);
    if (!client) continue;
    const vars = buildNoticeVars(n as NoticeRow, client);
    const { data: rule } = await supabase.from('notice_alert_rules').select('id, template_key, recipient').eq('alert_key', 'E4_hearing').maybeSingle();
    if (!rule) continue;
    const recipients = await resolveRecipients(rule.recipient || 'assignee', n as NoticeRow);
    for (const r of recipients) {
      const sent = await enqueueAlert({
        ruleId: rule.id, noticeId: n.id, clientId: n.client_id,
        toEmail: r.email, templateKey: rule.template_key,
        vars: { ...vars, staff_name: r.name }, dedupe: dk + ':' + r.email,
      });
      if (sent) queued++;
    }
  }

  // E5: limitation period (matter_deadlines approaching in 30/15/7 days)
  const { data: deadlines } = await supabase
    .from('matter_deadlines')
    .select('id, notice_id, deadline_type, deadline_date, statutory_basis, is_met')
    .eq('is_met', false);
  const limitThresholds = [30, 15, 7];
  for (const dl of (deadlines ?? [])) {
    if (!dl.deadline_date) continue;
    const d = daysBetween(today, new Date(dl.deadline_date));
    if (!limitThresholds.includes(d)) continue;
    const dk = dedupeKey('E5_limitation', dl.id, `${d}d:${today.toISOString().slice(0, 10)}`);
    if (await isDuplicate(dk)) continue;
    const notice = openNotices?.find((n) => n.id === dl.notice_id);
    if (!notice) continue;
    const client = await getClient(notice.client_id);
    if (!client) continue;
    const vars = buildNoticeVars(notice as NoticeRow, client);
    vars.deadline_type = dl.deadline_type || '';
    vars.deadline_date = dl.deadline_date || '';
    vars.statutory_basis = dl.statutory_basis || '';
    vars.days_remaining = String(d);
    const { data: rule } = await supabase.from('notice_alert_rules').select('id, template_key').eq('alert_key', 'E5_limitation').maybeSingle();
    if (!rule) continue;
    const partners = await getPartnerEmails();
    for (const r of partners) {
      const sent = await enqueueAlert({
        ruleId: rule.id, noticeId: dl.notice_id, clientId: notice.client_id,
        toEmail: r.email, templateKey: rule.template_key,
        vars: { ...vars, staff_name: r.name }, dedupe: dk + ':' + r.email,
      });
      if (sent) queued++;
    }
  }

  // E11: unassigned > 48h
  const cutoff = new Date(today.getTime() - 48 * 3600000);
  const unassigned = open.filter((n) => !n.assign_to_user_id && !n.assign_to && new Date(n.issue_date || 0) < cutoff);
  if (unassigned.length > 0) {
    const todayStr = today.toISOString().slice(0, 10);
    const dk = dedupeKey('E11_unassigned', 'daily', todayStr);
    if (!(await isDuplicate(dk))) {
      const lines = unassigned.slice(0, 50).map((n) =>
        `• ${n.notice_type || 'Notice'} — ${n.reference_number || 'No ref'} (Issued: ${n.issue_date || '?'})`,
      );
      const vars: Record<string, string> = {
        unassigned_count: String(unassigned.length),
        notice_list: lines.join('\n'),
        firm_name: GST_FIRM.name,
      };
      const { data: rule } = await supabase.from('notice_alert_rules').select('id, template_key').eq('alert_key', 'E11_unassigned').maybeSingle();
      if (rule) {
        const team = await getTeamEmails();
        for (const s of team) {
          const sent = await enqueueAlert({
            ruleId: rule.id, noticeId: unassigned[0].id, clientId: unassigned[0].client_id,
            toEmail: s.email, templateKey: rule.template_key,
            vars, dedupe: dk + ':' + s.email,
          });
          if (sent) queued++;
        }
      }
    }
  }

  return { queued, errors };
}
