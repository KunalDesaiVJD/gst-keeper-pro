-- Make templates staff-editable as plain text.
--
-- Split content from layout: the template `body` now holds only the editable
-- MESSAGE (plain paragraphs, {{variables}} allowed). The corporate shell
-- (letterhead, details box, signature, footer, colours, status pill) is applied
-- at SEND time by send-gst-email using buildEmailHtml(). email_outbox carries a
-- render_vars snapshot so the sender can build the framed email.
--
-- Staff edit only the wording under Settings -> GST Reminders; the layout is
-- preset and cannot be broken by an edit.

alter table public.email_outbox add column if not exists render_vars jsonb;

update public.email_templates set body = $msg$This is a gentle reminder that we are awaiting your records to prepare and file your {{return_type}} return for {{period}}.

To ensure timely and accurate filing, kindly share your sales & purchase data and bank statements at your earliest convenience. If you have already sent these, please treat this note as acknowledged.$msg$ where key = 'reminder_1';

update public.email_templates set body = $msg$Following our earlier note, we have not yet received your data for {{return_type}} — {{period}}. To keep your filing on schedule, we request the details below at the earliest.

Kindly share your sales & purchase register and bank statements so we can proceed. If already sent, please disregard this reminder.$msg$ where key = 'reminder_2';

update public.email_templates set body = $msg$The filing due date for your {{return_type}} — {{period}} is approaching and your data is still pending with us. Late filing attracts late fees and interest under the GST law, which we would like to help you avoid.

Please share your data today so we can file within time. If it has just been sent, kindly ignore this notice and accept our thanks.$msg$ where key = 'reminder_final';

update public.email_templates set body = $msg$We are pleased to confirm that your {{return_type}} return for {{period}} has been filed successfully on the GST portal.

Please retain the ARN shown above for your records. Thank you for your timely cooperation — it is a pleasure to serve you.$msg$ where key = 'confirmation';

update public.email_templates set body = $msg$This is to confirm that a NIL {{return_type}} return for {{period}} has been filed successfully on the GST portal, as there were no transactions to report for the period.

Please retain the ARN shown above for your records. Thank you for your continued association.$msg$ where key = 'confirmation_nil';
