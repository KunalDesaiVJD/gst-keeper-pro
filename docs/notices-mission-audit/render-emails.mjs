// Renders representative notice-alert emails with the repo's own email shell
// (supabase/functions/_shared/email.ts → buildEmailHtml, transpiled into
// emails/email-shell.mjs) and the template text seeded by
// 20260914140000_notice_alerts_phase1.sql. All values are fictional.
//
// Two code paths queue these emails and they pick different shells:
//   * in-app  (src/lib/noticeAlertQueue.ts, "Send digest")  → email_outbox.template_key = rule template
//     key (e.g. 'notice_due_soon'), which has no SHELL entry → falls back to the gold 'reminder_1' look.
//   * cron    (supabase/functions/queue-notice-alerts)        → template_key = 'notice_alert' /
//     'notice_alert_critical' → purple / red "Notice Alert" pill.
import fs from 'node:fs';
import path from 'node:path';
import { buildEmailHtml } from './emails/email-shell.mjs';
import { EMAIL_TEMPLATES, buildData, TODAY } from './mock-data.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'emails');
const render = (s, v) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => v[k] ?? '');
const tpl = (k) => EMAIL_TEMPLATES.find((t) => t.key === k);
const FIRM = { name: 'V. J. Desai & Co. LLP', email: 'gst@vjdesai.com', team: 'V. J. Desai & Co. (GST Team)' }; // hard-coded in the app (gstReminders.ts / queue-notice-alerts)

function frame({ from, to, subject, html, note }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${subject}</title>
<style>body{margin:0;background:#e5e7eb;font-family:system-ui,Segoe UI,Arial,sans-serif}
.hdr{background:#fff;border-bottom:1px solid #d1d5db;padding:14px 22px;font-size:13px;color:#111827}
.hdr div{margin:2px 0}.hdr b{display:inline-block;width:64px;color:#6b7280;font-weight:500}
.note{background:#fef9c3;color:#713f12;font-size:11px;padding:6px 22px;border-bottom:1px solid #fde68a}</style></head>
<body><div class="note">Audit preview frame (not part of the email): ${note}</div>
<div class="hdr"><div><b>From</b>${from}</div><div><b>To</b>${to}</div><div><b>Subject</b><strong>${subject}</strong></div></div>
${html}</body></html>`;
}

export function renderEmails() {
  const files = [];
  const { tables, story } = buildData();
  const byId = (id) => tables.gst_notices.find((n) => n.id === id);
  const client = (cid) => tables.clients.find((c) => c.id === cid);
  const n3 = byId(story.c6_asmt10.id); // Mock Builders LLP — ASMT-10 due in 2 days, assigned to Associate Two
  const c3 = client(n3.client_id);
  const eff = n3.extended_due_date || n3.due_date;
  // shared notice vars (as buildNoticeVars / buildVars produce them — raw ISO dates, portal notice_type)
  const base = {
    notice_type: n3.notice_type || 'Notice', client_name: c3.name, gstin: c3.gstin, reference_number: n3.reference_number || '',
    description: n3.description || '', issue_date: n3.issue_date || '', due_date: eff || '',
    days_remaining: String(Math.round((Date.parse(eff) - Date.parse(TODAY)) / 86400000)), priority: n3.priority || 'Normal', hearing_date: '', issued_by: n3.issued_by || '',
    old_status: '', new_status: n3.staff_status || '', staff_name: 'Associate Two', firm_name: FIRM.name, firm_email: FIRM.email,
  };

  // 1. E3 due-in-7 via the in-app path (template_key 'notice_due_soon' → reminder_1 fallback shell)
  {
    const t = tpl('notice_due_soon');
    const vars = { ...base, contact_person: c3.name }; // client.contact_person || client.name
    const html = buildEmailHtml({ key: 'notice_due_soon', kind: 'notice_alert', message: render(t.body, vars), vars });
    files.push(['120-email-due-soon-inapp', frame({ from: FIRM.email, to: 'associate.two@example.com', subject: render(t.subject, vars), html, note: 'E3 "Notice due in 7 days" as queued by the in-app Send digest (noticeAlertQueue.ts): template_key=notice_due_soon has no shell entry, so send-gst-email falls back to the generic reminder_1 look. Values fictional.' })]);
  }
  // 2. Same alert via the cron function (template_key 'notice_alert' → purple pill)
  {
    const t = tpl('notice_due_soon');
    const vars = { ...base, contact_person: c3.name };
    const html = buildEmailHtml({ key: 'notice_alert', kind: 'notice_alert', message: render(t.body, vars), vars });
    files.push(['121-email-due-soon-cron', frame({ from: FIRM.email, to: 'associate.two@example.com', subject: render(t.subject, vars), html, note: 'Same E3 alert as queued by supabase/functions/queue-notice-alerts (template_key=notice_alert → purple "Notice Alert" shell). Values fictional.' })]);
  }
  // 3. E2 overdue digest via the in-app path (vars = overdue_count, notice_list, firm_name only)
  {
    const t = tpl('notice_overdue_digest');
    const CLOSED = /^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i;
    const overdue = tables.gst_notices.filter((n) => !n.deleted_at && !CLOSED.test(n.staff_status || '') && !n.reply_date && (n.extended_due_date || n.due_date) && (n.extended_due_date || n.due_date) < TODAY);
    const lines = overdue.slice(0, 50).map((n) => `• ${n.notice_type || 'Notice'} — ${n.reference_number || 'No ref'} (Due: ${n.extended_due_date || n.due_date || '?'})`);
    const vars = { overdue_count: String(lines.length), notice_list: lines.join('\n'), firm_name: FIRM.name };
    const html = buildEmailHtml({ key: 'notice_overdue_digest', kind: 'notice_alert', message: render(t.body, vars), vars });
    files.push(['122-email-overdue-digest-inapp', frame({ from: FIRM.email, to: 'demo.manager@example.com', subject: render(t.subject, vars), html, note: 'E2 daily overdue digest as built by the in-app path: vars carry no gstin/notice_type/client, so the details box renders empty, the greeting falls back to "Sir/Madam", and list lines omit the client name. Values fictional.' })]);
  }
  // 4. E5 limitation warning via cron, priority critical → red shell
  {
    const t = tpl('notice_limitation');
    const n5 = byId(story.c8_case_drc01_order.id); const c5 = client(n5.client_id);
    const dl = tables.matter_deadlines.find((x) => x.notice_id === n5.id && /First appeal/.test(x.deadline_type));
    const vars = { ...base, notice_type: n5.notice_type, client_name: c5.name, gstin: c5.gstin, reference_number: n5.reference_number || '', due_date: n5.extended_due_date || n5.due_date || '', days_remaining: '30', priority: n5.priority || 'Normal', deadline_type: dl.deadline_type, deadline_date: dl.deadline_date, statutory_basis: dl.statutory_basis, staff_name: 'Partner Demo', contact_person: c5.name };
    const html = buildEmailHtml({ key: 'notice_alert_critical', kind: 'notice_alert', message: render(t.body, vars), vars });
    // queue-notice-alerts fires E5 only when the deadline is exactly 30/15/7 days away, so this is the
    // email as it would be queued on deadline − 30 days (not on the mock's "today").
    const sendOn = new Date(Date.parse(dl.deadline_date) - 30 * 86400000).toISOString().slice(0, 10);
    files.push(['123-email-limitation-critical-cron', frame({ from: FIRM.email, to: 'partner.demo@example.com', subject: render(t.subject, vars), html, note: `E5 limitation warning as the cron function would queue it on ${sendOn} — it fires only when a deadline is exactly 30/15/7 days away (here the ${dl.deadline_date} first-appeal limitation); priority critical → notice_alert_critical shell. Values fictional.` })]);
  }
  for (const [id, html] of files) fs.writeFileSync(path.join(OUT, id + '.html'), html);
  return files.map(([id]) => ({ id, file: path.join(OUT, id + '.html') }));
}

if (process.argv[1] && process.argv[1].endsWith('render-emails.mjs')) console.log(renderEmails());
