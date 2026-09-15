// queue-notice-alerts — server-side notice alert generator.
//
// Runs on a pg_cron schedule (every 15 min for event-triggered drain, plus
// 04:00 UTC / ~09:30 IST for daily digests). Evaluates each active rule in
// notice_alert_rules against current notice state and queues matching alerts
// into email_outbox for the send-gst-email function to deliver.
//
// Scheduled rules handled here:
//   E2  overdue digest        — daily, notices past due without reply
//   E3  due in 7 days         — daily, notices due within 7 days
//   E4  hearing reminder      — notices with hearing_date in next 3 days
//   E5  limitation period     — matters with deadline approaching (30/15/7 days)
//   E11 unassigned > 48h      — daily, notices unassigned for > 48 hours
//
// Body: { mode?: "digest" | "all" }. "digest" runs only daily digests (E2/E3/E11).
// "all" (default) runs everything.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const GST_FIRM = {
  name: 'V. J. Desai & Co. LLP',
  email: 'gst@vjdesai.com',
  team: 'V. J. Desai & Co. (GST Team)',
};

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLOSED_RE = /^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i;

function todayIST(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function renderTemplate(s: string, vars: Record<string, string>): string {
  return (s ?? '').replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? '');
}

interface AlertRule {
  id: string;
  alert_key: string;
  event_type: string | null;
  template_key: string;
  recipient: string;
  is_active: boolean;
  priority: string;
  cooldown_hrs: number | null;
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
  hearing_date: string | null;
  issued_by: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let mode = 'all';
  try {
    const b = await req.json();
    if (b?.mode) mode = String(b.mode);
  } catch { /* no body */ }

  const today = todayIST();
  const todayStr = today.toISOString().slice(0, 10);
  let queued = 0;
  const errors: string[] = [];

  // Load all active rules (scheduled ones have event_type = 'scheduled' or null)
  const { data: rules } = await sb.from('notice_alert_rules').select('*').eq('is_active', true);
  if (!rules?.length) return json({ queued: 0, message: 'no active rules' });

  // Load open notices
  const { data: allNotices } = await sb
    .from('gst_notices')
    .select('id, client_id, notice_type, reference_number, description, issue_date, due_date, extended_due_date, staff_status, priority, assign_to, assign_to_user_id, reply_date, hearing_date, issued_by')
    .is('deleted_at', null);
  if (!allNotices?.length) return json({ queued: 0, message: 'no notices' });

  const open = allNotices.filter((n: NoticeRow) => !CLOSED_RE.test(n.staff_status ?? ''));

  // Load staff for recipient resolution
  const [{ data: profiles }, { data: userRoles }] = await Promise.all([
    sb.from('profiles').select('user_id, first_name, email'),
    sb.from('user_roles').select('user_id, role'),
  ]);
  const staffRoleSet = new Set(
    (userRoles ?? []).filter((r: { role: string }) => r.role !== 'client').map((r: { user_id: string }) => r.user_id),
  );
  const partnerRoleSet = new Set(
    (userRoles ?? []).filter((r: { role: string }) => r.role === 'superadmin' || r.role === 'gst_manager').map((r: { user_id: string }) => r.user_id),
  );
  const teamEmails = (profiles ?? [])
    .filter((p: { user_id: string; email: string | null }) => staffRoleSet.has(p.user_id) && p.email)
    .map((p: { user_id: string; first_name: string | null; email: string }) => ({ userId: p.user_id, name: p.first_name || p.email.split('@')[0], email: p.email }));
  const partnerEmails = (profiles ?? [])
    .filter((p: { user_id: string; email: string | null }) => partnerRoleSet.has(p.user_id) && p.email)
    .map((p: { user_id: string; first_name: string | null; email: string }) => ({ userId: p.user_id, name: p.first_name || p.email.split('@')[0], email: p.email }));

  function resolveRecipients(recipient: string, notice: NoticeRow) {
    if (recipient === 'assignee' && notice.assign_to_user_id) {
      const p = (profiles ?? []).find((x: { user_id: string }) => x.user_id === notice.assign_to_user_id);
      if (p?.email) return [{ userId: p.user_id, name: p.first_name || p.email.split('@')[0], email: p.email }];
    }
    if (recipient === 'partner') return partnerEmails;
    return teamEmails;
  }

  async function isDuplicate(key: string): Promise<boolean> {
    const { data } = await sb.from('email_outbox').select('id').eq('dedupe_key', key).limit(1);
    return (data?.length ?? 0) > 0;
  }

  async function checkCooldown(ruleId: string, noticeId: string, cooldownHrs: number | null): Promise<boolean> {
    if (!cooldownHrs) return false;
    const cutoff = new Date(Date.now() - cooldownHrs * 3600000).toISOString();
    const { data } = await sb.from('notice_alert_log')
      .select('id')
      .eq('rule_id', ruleId)
      .eq('notice_id', noticeId)
      .gte('created_at', cutoff)
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  async function enqueue(opts: {
    ruleId: string; noticeId: string; clientId: string;
    toEmail: string; templateKey: string; vars: Record<string, string>;
    dedupe: string; priority?: string;
  }): Promise<boolean> {
    if (await isDuplicate(opts.dedupe)) return false;

    const { data: tpl } = await sb.from('email_templates')
      .select('subject, body, is_active')
      .eq('key', opts.templateKey).maybeSingle();
    if (!tpl || tpl.is_active === false) return false;

    const subject = renderTemplate(tpl.subject, opts.vars);
    const body = renderTemplate(tpl.body, opts.vars);

    const templateKey = opts.templateKey;
    const shellKey = opts.priority === 'critical' ? 'notice_alert_critical' : 'notice_alert';

    const { error: outboxErr, data: outboxRow } = await sb.from('email_outbox').insert({
      to_email: opts.toEmail,
      kind: 'notice_alert',
      template_key: shellKey,
      subject, body,
      render_vars: opts.vars,
      status: 'pending',
      notice_id: opts.noticeId,
      client_id: opts.clientId,
      dedupe_key: opts.dedupe,
    }).select('id').maybeSingle();

    if (outboxErr) {
      if ((outboxErr as { code?: string }).code === '23505') return false;
      errors.push(`outbox: ${outboxErr.message}`);
      return false;
    }

    await sb.from('notice_alert_log').insert({
      rule_id: opts.ruleId,
      notice_id: opts.noticeId,
      client_id: opts.clientId,
      email_outbox_id: outboxRow?.id ?? null,
      recipient_email: opts.toEmail,
      status: 'sent',
      dedupe_key: opts.dedupe,
    });
    return true;
  }

  // Load clients for name/gstin lookup
  const clientIds = [...new Set(open.map((n: NoticeRow) => n.client_id))];
  const { data: clients } = await sb.from('clients')
    .select('id, name, gstin, contact_person')
    .in('id', clientIds.slice(0, 500));
  const clientMap = new Map((clients ?? []).map((c: { id: string; name: string; gstin: string | null; contact_person: string | null }) => [c.id, c]));

  function buildVars(n: NoticeRow): Record<string, string> {
    const c = clientMap.get(n.client_id);
    const effectiveDue = n.extended_due_date || n.due_date;
    let daysRemaining = '';
    if (effectiveDue) daysRemaining = String(daysBetween(today, new Date(effectiveDue)));
    return {
      notice_type: n.notice_type || 'Notice',
      client_name: c?.name || '',
      gstin: c?.gstin || '',
      reference_number: n.reference_number || '',
      description: n.description || '',
      issue_date: n.issue_date || '',
      due_date: effectiveDue || '',
      days_remaining: daysRemaining,
      priority: n.priority || 'Normal',
      hearing_date: n.hearing_date || '',
      issued_by: n.issued_by || '',
      old_status: '', new_status: n.staff_status || '',
      staff_name: GST_FIRM.team,
      firm_name: GST_FIRM.name,
      firm_email: GST_FIRM.email,
      contact_person: c?.contact_person || c?.name || '',
    };
  }

  // ── E2: overdue digest ──
  const e2Rule = rules.find((r: AlertRule) => r.alert_key === 'E2_overdue_digest');
  if (e2Rule) {
    const overdue = open.filter((n: NoticeRow) => {
      if (n.reply_date) return false;
      const due = n.extended_due_date || n.due_date;
      if (!due) return false;
      return new Date(due) < today;
    });
    if (overdue.length > 0) {
      const dk = `E2_overdue_digest:daily:${todayStr}`;
      if (!(await isDuplicate(dk))) {
        const lines = overdue.slice(0, 50).map((n: NoticeRow) => {
          const due = n.extended_due_date || n.due_date || '?';
          const c = clientMap.get(n.client_id);
          return `• ${c?.name || 'Client'} — ${n.notice_type || 'Notice'} — ${n.reference_number || 'No ref'} (Due: ${due})`;
        });
        const vars: Record<string, string> = {
          overdue_count: String(overdue.length),
          notice_list: lines.join('\n'),
          firm_name: GST_FIRM.name,
          notice_type: 'Overdue Digest',
          gstin: '', reference_number: '', due_date: '', days_remaining: '',
          priority: 'High', staff_name: GST_FIRM.team, firm_email: GST_FIRM.email,
          contact_person: GST_FIRM.team,
        };
        for (const s of teamEmails) {
          const sent = await enqueue({
            ruleId: e2Rule.id, noticeId: overdue[0].id, clientId: overdue[0].client_id,
            toEmail: s.email, templateKey: e2Rule.template_key, vars,
            dedupe: dk + ':' + s.email,
          });
          if (sent) queued++;
        }
      }
    }
  }

  // ── E3: due in 7 days ──
  const e3Rule = rules.find((r: AlertRule) => r.alert_key === 'E3_due_in_7');
  if (e3Rule) {
    const dueSoon = open.filter((n: NoticeRow) => {
      const due = n.extended_due_date || n.due_date;
      if (!due) return false;
      const d = daysBetween(today, new Date(due));
      return d >= 0 && d <= 7;
    });
    for (const n of dueSoon) {
      if (await checkCooldown(e3Rule.id, n.id, e3Rule.cooldown_hrs)) continue;
      const dk = `E3_due_in_7:${n.id}:${todayStr}`;
      if (await isDuplicate(dk)) continue;
      const vars = buildVars(n as NoticeRow);
      const recipients = resolveRecipients('assignee', n as NoticeRow);
      for (const r of recipients) {
        const sent = await enqueue({
          ruleId: e3Rule.id, noticeId: n.id, clientId: n.client_id,
          toEmail: r.email, templateKey: e3Rule.template_key,
          vars: { ...vars, staff_name: r.name }, dedupe: dk + ':' + r.email,
        });
        if (sent) queued++;
      }
    }
  }

  // ── E4: hearing reminder (hearing_date within 3 days) ──
  const e4Rule = rules.find((r: AlertRule) => r.alert_key === 'E4_hearing');
  if (e4Rule) {
    const hearingSoon = open.filter((n: NoticeRow) => {
      if (!n.hearing_date) return false;
      const d = daysBetween(today, new Date(n.hearing_date));
      return d >= 0 && d <= 3;
    });
    for (const n of hearingSoon) {
      if (await checkCooldown(e4Rule.id, n.id, e4Rule.cooldown_hrs)) continue;
      const dk = `E4_hearing:${n.id}:${todayStr}`;
      if (await isDuplicate(dk)) continue;
      const vars = buildVars(n as NoticeRow);
      const recipients = resolveRecipients(e4Rule.recipient, n as NoticeRow);
      for (const r of recipients) {
        const sent = await enqueue({
          ruleId: e4Rule.id, noticeId: n.id, clientId: n.client_id,
          toEmail: r.email, templateKey: e4Rule.template_key,
          vars: { ...vars, staff_name: r.name }, dedupe: dk + ':' + r.email,
          priority: e4Rule.priority,
        });
        if (sent) queued++;
      }
    }
  }

  // ── E5: limitation period alert (matter_deadlines approaching in 30/15/7 days) ──
  const e5Rule = rules.find((r: AlertRule) => r.alert_key === 'E5_limitation');
  if (e5Rule) {
    const { data: deadlines } = await sb.from('matter_deadlines')
      .select('id, notice_id, deadline_type, deadline_date, statutory_basis, is_met')
      .eq('is_met', false);
    const thresholds = [30, 15, 7];
    for (const dl of (deadlines ?? [])) {
      if (!dl.deadline_date) continue;
      const d = daysBetween(today, new Date(dl.deadline_date));
      if (!thresholds.includes(d)) continue;
      if (await checkCooldown(e5Rule.id, dl.notice_id, e5Rule.cooldown_hrs)) continue;
      const dk = `E5_limitation:${dl.id}:${d}d:${todayStr}`;
      if (await isDuplicate(dk)) continue;
      const notice = allNotices.find((n: NoticeRow) => n.id === dl.notice_id);
      if (!notice) continue;
      const vars = buildVars(notice as NoticeRow);
      vars.deadline_type = dl.deadline_type || '';
      vars.deadline_date = dl.deadline_date || '';
      vars.statutory_basis = dl.statutory_basis || '';
      vars.days_remaining = String(d);
      for (const r of partnerEmails) {
        const sent = await enqueue({
          ruleId: e5Rule.id, noticeId: dl.notice_id, clientId: notice.client_id,
          toEmail: r.email, templateKey: e5Rule.template_key,
          vars: { ...vars, staff_name: r.name }, dedupe: dk + ':' + r.email,
          priority: 'critical',
        });
        if (sent) queued++;
      }
    }
  }

  // ── E11: unassigned > 48h ──
  const e11Rule = rules.find((r: AlertRule) => r.alert_key === 'E11_unassigned');
  if (e11Rule) {
    const cutoff = new Date(today.getTime() - 48 * 3600000);
    const unassigned = open.filter((n: NoticeRow) =>
      !n.assign_to_user_id && !n.assign_to && new Date(n.issue_date || 0) < cutoff,
    );
    if (unassigned.length > 0) {
      const dk = `E11_unassigned:daily:${todayStr}`;
      if (!(await isDuplicate(dk))) {
        const lines = unassigned.slice(0, 50).map((n: NoticeRow) => {
          const c = clientMap.get(n.client_id);
          return `• ${c?.name || 'Client'} — ${n.notice_type || 'Notice'} — ${n.reference_number || 'No ref'} (Issued: ${n.issue_date || '?'})`;
        });
        const vars: Record<string, string> = {
          unassigned_count: String(unassigned.length),
          notice_list: lines.join('\n'),
          firm_name: GST_FIRM.name,
          notice_type: 'Unassigned Notices',
          gstin: '', reference_number: '', due_date: '', days_remaining: '',
          priority: 'High', staff_name: GST_FIRM.team, firm_email: GST_FIRM.email,
          contact_person: GST_FIRM.team,
        };
        for (const s of partnerEmails) {
          const sent = await enqueue({
            ruleId: e11Rule.id, noticeId: unassigned[0].id, clientId: unassigned[0].client_id,
            toEmail: s.email, templateKey: e11Rule.template_key, vars,
            dedupe: dk + ':' + s.email,
          });
          if (sent) queued++;
        }
      }
    }
  }

  return json({ queued, errors: errors.slice(0, 10), mode, date: todayStr });
});
