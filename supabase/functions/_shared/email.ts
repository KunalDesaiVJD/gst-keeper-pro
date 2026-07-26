// Corporate email shell — wraps a staff-edited plain-text MESSAGE in the branded
// V. J. Desai & Co. layout (letterhead, details box, signature, footer, status
// pill). This is the single source of truth for what a sent email looks like;
// send-gst-email calls it at send time. Keep in sync with the mirror copy at
// src/lib/emailTemplate.ts (used only for the editor preview).

type EmailVars = Record<string, string | null | undefined>;

interface ShellMeta {
  accent: string;
  pill?: { text: string; bg: string; fg: string };
  box: { bg: string; border: string; label: string };
}

const SHELL: Record<string, ShellMeta> = {
  reminder_1: { accent: '#c9a227', box: { bg: '#f8fafc', border: '#e2e8f0', label: '#64748b' } },
  reminder_2: { accent: '#d97706', pill: { text: 'Data Pending', bg: '#fef3c7', fg: '#92400e' }, box: { bg: '#fffbeb', border: '#fde68a', label: '#78716c' } },
  reminder_final: { accent: '#dc2626', pill: { text: 'Urgent &middot; Final Reminder', bg: '#fee2e2', fg: '#b91c1c' }, box: { bg: '#fef2f2', border: '#fecaca', label: '#7f1d1d' } },
  confirmation: { accent: '#16a34a', pill: { text: '&#10003; Filed Successfully', bg: '#dcfce7', fg: '#166534' }, box: { bg: '#f0fdf4', border: '#bbf7d0', label: '#15803d' } },
  confirmation_nil: { accent: '#16a34a', pill: { text: '&#10003; Nil Return Filed', bg: '#dcfce7', fg: '#166534' }, box: { bg: '#f0fdf4', border: '#bbf7d0', label: '#15803d' } },
};

export function buildEmailHtml(opts: { key: string; kind: string; message: string; vars: EmailVars }): string {
  const { key, kind, message, vars } = opts;
  const meta = SHELL[key] ?? SHELL.reminder_1;
  const g = (k: string) => (vars[k] ?? '').toString().trim();

  const rows: Array<[string, string]> = [['GSTIN', g('gstin')]];
  rows.push(['Return', key === 'confirmation_nil' ? `NIL ${g('return_type')}`.trim() : g('return_type')]);
  rows.push(['Period', g('period')]);
  if (kind === 'confirmation') {
    rows.push(['ARN', g('arn')]);
    rows.push(['Filed on', g('filing_date')]);
  } else {
    rows.push(['Filing due', g('due_date')]);
  }
  const dueColor = key === 'reminder_final' ? '#dc2626' : '#b45309';
  const detailRows = rows
    .filter(([, val]) => val && val !== '')
    .map(([label, val]) =>
      `<tr><td style="padding:3px 0;color:${meta.box.label};width:110px;">${label}</td><td style="padding:3px 0;font-weight:600;${label === 'Filing due' ? `color:${dueColor};` : ''}">${val}</td></tr>`,
    )
    .join('');

  const paras = message
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  const pill = meta.pill
    ? `<span style="display:inline-block;background:${meta.pill.bg};color:${meta.pill.fg};font-size:11px;font-weight:700;letter-spacing:.5px;padding:4px 10px;border-radius:99px;text-transform:uppercase;margin-bottom:14px;">${meta.pill.text}</span>`
    : '';

  const firmName = g('firm_name') || 'V. J. Desai & Co. LLP';
  const firmEmail = g('firm_email') || 'gst@vjdesai.com';
  const staff = g('staff_name') || 'V. J. Desai & Co. (GST Team)';
  const contact = g('contact_person') || g('client_name') || 'Sir/Madam';

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;margin:0;padding:24px 0;font-family:'Segoe UI',Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
<tr><td style="height:4px;background:${meta.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#0f2b46;padding:22px 28px;">
<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;">V. J. Desai &amp; Co. LLP</div>
<div style="color:#9fb3c8;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:3px;">Chartered Accountants &nbsp;&middot;&nbsp; GST Compliance Desk</div>
</td></tr>
<tr><td style="padding:28px 28px 6px 28px;color:#1f2937;font-size:14px;line-height:1.6;">
${pill}
<p style="margin:0 0 14px;">Dear ${contact},</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${meta.box.bg};border:1px solid ${meta.box.border};border-radius:6px;margin:4px 0 18px;">
<tr><td style="padding:14px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">${detailRows}</table></td></tr>
</table>
${paras}
<p style="margin:0 0 6px;">Warm regards,</p>
<p style="margin:0 0 1px;font-weight:600;color:#0f2b46;">${staff}</p>
<p style="margin:0 0 20px;color:#475569;font-size:13px;">${firmName}</p>
</td></tr>
<tr><td style="background:#f1f5f9;padding:15px 28px;border-top:1px solid #e2e8f0;">
<div style="font-size:12px;color:#64748b;line-height:1.5;">${firmName} &nbsp;&middot;&nbsp; <a href="mailto:${firmEmail}" style="color:#0f2b46;text-decoration:none;">${firmEmail}</a><br>Automated message from our GST compliance desk.</div>
</td></tr>
</table>
</td></tr>
</table>`;
}
