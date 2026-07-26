-- Corporate HTML email templates for the GST reminder/confirmation feature.
-- Table-based, fully inline-styled markup (safe across Outlook / Gmail / Yahoo).
-- Bodies are full HTML now; the send-gst-email function sends contentType=HTML.
-- {{variables}} are substituted at send time. Date vars (due_date/data_by_date)
-- appear only in the detail box, so a blank value never breaks a sentence.

-- ── Reminder 1 — cordial first reminder (gold accent) ─────────────────────────
update public.email_templates set body = $html$
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;margin:0;padding:24px 0;font-family:'Segoe UI',Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
<tr><td style="height:4px;background:#c9a227;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#0f2b46;padding:22px 28px;">
<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;">V. J. Desai &amp; Co. LLP</div>
<div style="color:#9fb3c8;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:3px;">Chartered Accountants &nbsp;&middot;&nbsp; GST Compliance Desk</div>
</td></tr>
<tr><td style="padding:28px 28px 6px 28px;color:#1f2937;font-size:14px;line-height:1.6;">
<p style="margin:0 0 14px;">Dear {{contact_person}},</p>
<p style="margin:0 0 16px;">This is a gentle reminder that we are awaiting your records to prepare and file your <strong>{{return_type}}</strong> return for <strong>{{period}}</strong>.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin:4px 0 18px;">
<tr><td style="padding:14px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">
<tr><td style="padding:3px 0;color:#64748b;width:110px;">GSTIN</td><td style="padding:3px 0;font-weight:600;">{{gstin}}</td></tr>
<tr><td style="padding:3px 0;color:#64748b;">Return</td><td style="padding:3px 0;font-weight:600;">{{return_type}}</td></tr>
<tr><td style="padding:3px 0;color:#64748b;">Period</td><td style="padding:3px 0;font-weight:600;">{{period}}</td></tr>
<tr><td style="padding:3px 0;color:#64748b;">Filing due</td><td style="padding:3px 0;font-weight:600;color:#b45309;">{{due_date}}</td></tr>
</table>
</td></tr>
</table>
<p style="margin:0 0 16px;">To ensure timely and accurate filing, kindly share your sales &amp; purchase data and bank statements at your earliest convenience. If you have already sent these, please treat this note as acknowledged.</p>
<p style="margin:0 0 6px;">Warm regards,</p>
<p style="margin:0 0 1px;font-weight:600;color:#0f2b46;">{{staff_name}}</p>
<p style="margin:0 0 20px;color:#475569;font-size:13px;">{{firm_name}}</p>
</td></tr>
<tr><td style="background:#f1f5f9;padding:15px 28px;border-top:1px solid #e2e8f0;">
<div style="font-size:12px;color:#64748b;line-height:1.5;">{{firm_name}} &nbsp;&middot;&nbsp; <a href="mailto:{{firm_email}}" style="color:#0f2b46;text-decoration:none;">{{firm_email}}</a><br>Automated reminder from our GST compliance desk. No action needed if your data is already with us.</div>
</td></tr>
</table>
</td></tr>
</table>
$html$ where key = 'reminder_1';

-- ── Reminder 2 — follow-up nudge (amber accent + Data Pending pill) ────────────
update public.email_templates set body = $html$
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;margin:0;padding:24px 0;font-family:'Segoe UI',Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
<tr><td style="height:4px;background:#d97706;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#0f2b46;padding:22px 28px;">
<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;">V. J. Desai &amp; Co. LLP</div>
<div style="color:#9fb3c8;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:3px;">Chartered Accountants &nbsp;&middot;&nbsp; GST Compliance Desk</div>
</td></tr>
<tr><td style="padding:28px 28px 6px 28px;color:#1f2937;font-size:14px;line-height:1.6;">
<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;letter-spacing:.5px;padding:4px 10px;border-radius:99px;text-transform:uppercase;margin-bottom:14px;">Data Pending</span>
<p style="margin:0 0 14px;">Dear {{contact_person}},</p>
<p style="margin:0 0 16px;">Following our earlier note, we have <strong>not yet received</strong> your data for <strong>{{return_type}} &mdash; {{period}}</strong>. To keep your filing on schedule, we request the details below at the earliest.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;margin:4px 0 18px;">
<tr><td style="padding:14px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">
<tr><td style="padding:3px 0;color:#78716c;width:110px;">GSTIN</td><td style="padding:3px 0;font-weight:600;">{{gstin}}</td></tr>
<tr><td style="padding:3px 0;color:#78716c;">Return</td><td style="padding:3px 0;font-weight:600;">{{return_type}}</td></tr>
<tr><td style="padding:3px 0;color:#78716c;">Period</td><td style="padding:3px 0;font-weight:600;">{{period}}</td></tr>
<tr><td style="padding:3px 0;color:#78716c;">Filing due</td><td style="padding:3px 0;font-weight:600;color:#b45309;">{{due_date}}</td></tr>
</table>
</td></tr>
</table>
<p style="margin:0 0 16px;">Kindly share your sales &amp; purchase register and bank statements so we can proceed. If already sent, please disregard this reminder.</p>
<p style="margin:0 0 6px;">Warm regards,</p>
<p style="margin:0 0 1px;font-weight:600;color:#0f2b46;">{{staff_name}}</p>
<p style="margin:0 0 20px;color:#475569;font-size:13px;">{{firm_name}}</p>
</td></tr>
<tr><td style="background:#f1f5f9;padding:15px 28px;border-top:1px solid #e2e8f0;">
<div style="font-size:12px;color:#64748b;line-height:1.5;">{{firm_name}} &nbsp;&middot;&nbsp; <a href="mailto:{{firm_email}}" style="color:#0f2b46;text-decoration:none;">{{firm_email}}</a><br>Automated reminder from our GST compliance desk. No action needed if your data is already with us.</div>
</td></tr>
</table>
</td></tr>
</table>
$html$ where key = 'reminder_2';

-- ── Reminder 3 — final / urgent (red accent + Urgent pill) ────────────────────
update public.email_templates set body = $html$
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;margin:0;padding:24px 0;font-family:'Segoe UI',Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
<tr><td style="height:4px;background:#dc2626;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#0f2b46;padding:22px 28px;">
<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;">V. J. Desai &amp; Co. LLP</div>
<div style="color:#9fb3c8;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:3px;">Chartered Accountants &nbsp;&middot;&nbsp; GST Compliance Desk</div>
</td></tr>
<tr><td style="padding:28px 28px 6px 28px;color:#1f2937;font-size:14px;line-height:1.6;">
<span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:700;letter-spacing:.5px;padding:4px 10px;border-radius:99px;text-transform:uppercase;margin-bottom:14px;">Urgent &middot; Final Reminder</span>
<p style="margin:0 0 14px;">Dear {{contact_person}},</p>
<p style="margin:0 0 16px;">The filing due date for your <strong>{{return_type}} &mdash; {{period}}</strong> is approaching and your data is <strong>still pending</strong> with us. Late filing attracts <strong>late fees and interest</strong> under the GST law, which we would like to help you avoid.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;margin:4px 0 18px;">
<tr><td style="padding:14px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">
<tr><td style="padding:3px 0;color:#7f1d1d;width:110px;">GSTIN</td><td style="padding:3px 0;font-weight:600;">{{gstin}}</td></tr>
<tr><td style="padding:3px 0;color:#7f1d1d;">Return</td><td style="padding:3px 0;font-weight:600;">{{return_type}}</td></tr>
<tr><td style="padding:3px 0;color:#7f1d1d;">Period</td><td style="padding:3px 0;font-weight:600;">{{period}}</td></tr>
<tr><td style="padding:3px 0;color:#7f1d1d;">Filing due</td><td style="padding:3px 0;font-weight:700;color:#dc2626;">{{due_date}}</td></tr>
</table>
</td></tr>
</table>
<p style="margin:0 0 16px;">Please share your data <strong>today</strong> so we can file within time. If it has just been sent, kindly ignore this notice and accept our thanks.</p>
<p style="margin:0 0 6px;">Regards,</p>
<p style="margin:0 0 1px;font-weight:600;color:#0f2b46;">{{staff_name}}</p>
<p style="margin:0 0 20px;color:#475569;font-size:13px;">{{firm_name}}</p>
</td></tr>
<tr><td style="background:#f1f5f9;padding:15px 28px;border-top:1px solid #e2e8f0;">
<div style="font-size:12px;color:#64748b;line-height:1.5;">{{firm_name}} &nbsp;&middot;&nbsp; <a href="mailto:{{firm_email}}" style="color:#0f2b46;text-decoration:none;">{{firm_email}}</a><br>Automated final reminder from our GST compliance desk.</div>
</td></tr>
</table>
</td></tr>
</table>
$html$ where key = 'reminder_final';

-- ── Confirmation — return filed (green accent + Filed pill) ────────────────────
update public.email_templates set body = $html$
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;margin:0;padding:24px 0;font-family:'Segoe UI',Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
<tr><td style="height:4px;background:#16a34a;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#0f2b46;padding:22px 28px;">
<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;">V. J. Desai &amp; Co. LLP</div>
<div style="color:#9fb3c8;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:3px;">Chartered Accountants &nbsp;&middot;&nbsp; GST Compliance Desk</div>
</td></tr>
<tr><td style="padding:28px 28px 6px 28px;color:#1f2937;font-size:14px;line-height:1.6;">
<span style="display:inline-block;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;letter-spacing:.5px;padding:4px 10px;border-radius:99px;text-transform:uppercase;margin-bottom:14px;">&#10003; Filed Successfully</span>
<p style="margin:0 0 14px;">Dear {{contact_person}},</p>
<p style="margin:0 0 16px;">We are pleased to confirm that your <strong>{{return_type}}</strong> return for <strong>{{period}}</strong> has been <strong>filed successfully</strong> on the GST portal.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin:4px 0 18px;">
<tr><td style="padding:14px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">
<tr><td style="padding:3px 0;color:#15803d;width:110px;">GSTIN</td><td style="padding:3px 0;font-weight:600;">{{gstin}}</td></tr>
<tr><td style="padding:3px 0;color:#15803d;">Return</td><td style="padding:3px 0;font-weight:600;">{{return_type}}</td></tr>
<tr><td style="padding:3px 0;color:#15803d;">Period</td><td style="padding:3px 0;font-weight:600;">{{period}}</td></tr>
<tr><td style="padding:3px 0;color:#15803d;">ARN</td><td style="padding:3px 0;font-weight:600;">{{arn}}</td></tr>
<tr><td style="padding:3px 0;color:#15803d;">Filed on</td><td style="padding:3px 0;font-weight:600;">{{filing_date}}</td></tr>
</table>
</td></tr>
</table>
<p style="margin:0 0 16px;">Please retain the ARN above for your records. Thank you for your timely cooperation &mdash; it is a pleasure to serve you.</p>
<p style="margin:0 0 6px;">Warm regards,</p>
<p style="margin:0 0 1px;font-weight:600;color:#0f2b46;">{{staff_name}}</p>
<p style="margin:0 0 20px;color:#475569;font-size:13px;">{{firm_name}}</p>
</td></tr>
<tr><td style="background:#f1f5f9;padding:15px 28px;border-top:1px solid #e2e8f0;">
<div style="font-size:12px;color:#64748b;line-height:1.5;">{{firm_name}} &nbsp;&middot;&nbsp; <a href="mailto:{{firm_email}}" style="color:#0f2b46;text-decoration:none;">{{firm_email}}</a><br>Automated filing confirmation from our GST compliance desk.</div>
</td></tr>
</table>
</td></tr>
</table>
$html$ where key = 'confirmation';

-- ── Confirmation — NIL return filed (green accent) ────────────────────────────
update public.email_templates set body = $html$
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;margin:0;padding:24px 0;font-family:'Segoe UI',Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
<tr><td style="height:4px;background:#16a34a;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#0f2b46;padding:22px 28px;">
<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;">V. J. Desai &amp; Co. LLP</div>
<div style="color:#9fb3c8;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:3px;">Chartered Accountants &nbsp;&middot;&nbsp; GST Compliance Desk</div>
</td></tr>
<tr><td style="padding:28px 28px 6px 28px;color:#1f2937;font-size:14px;line-height:1.6;">
<span style="display:inline-block;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;letter-spacing:.5px;padding:4px 10px;border-radius:99px;text-transform:uppercase;margin-bottom:14px;">&#10003; Nil Return Filed</span>
<p style="margin:0 0 14px;">Dear {{contact_person}},</p>
<p style="margin:0 0 16px;">This is to confirm that a <strong>NIL {{return_type}}</strong> return for <strong>{{period}}</strong> has been <strong>filed successfully</strong> on the GST portal, as there were no transactions to report for the period.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin:4px 0 18px;">
<tr><td style="padding:14px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">
<tr><td style="padding:3px 0;color:#15803d;width:110px;">GSTIN</td><td style="padding:3px 0;font-weight:600;">{{gstin}}</td></tr>
<tr><td style="padding:3px 0;color:#15803d;">Return</td><td style="padding:3px 0;font-weight:600;">NIL {{return_type}}</td></tr>
<tr><td style="padding:3px 0;color:#15803d;">Period</td><td style="padding:3px 0;font-weight:600;">{{period}}</td></tr>
<tr><td style="padding:3px 0;color:#15803d;">ARN</td><td style="padding:3px 0;font-weight:600;">{{arn}}</td></tr>
<tr><td style="padding:3px 0;color:#15803d;">Filed on</td><td style="padding:3px 0;font-weight:600;">{{filing_date}}</td></tr>
</table>
</td></tr>
</table>
<p style="margin:0 0 16px;">Please retain the ARN above for your records. Thank you for your continued association.</p>
<p style="margin:0 0 6px;">Warm regards,</p>
<p style="margin:0 0 1px;font-weight:600;color:#0f2b46;">{{staff_name}}</p>
<p style="margin:0 0 20px;color:#475569;font-size:13px;">{{firm_name}}</p>
</td></tr>
<tr><td style="background:#f1f5f9;padding:15px 28px;border-top:1px solid #e2e8f0;">
<div style="font-size:12px;color:#64748b;line-height:1.5;">{{firm_name}} &nbsp;&middot;&nbsp; <a href="mailto:{{firm_email}}" style="color:#0f2b46;text-decoration:none;">{{firm_email}}</a><br>Automated filing confirmation from our GST compliance desk.</div>
</td></tr>
</table>
</td></tr>
</table>
$html$ where key = 'confirmation_nil';
