-- Import 2B: e-mail the client its bills not in books, with the list attached
-- as an Excel working paper (15 Oct 2026).
--
-- The firm sends every client e-mail through email_outbox, drained by the
-- send-gst-email Edge Function (Microsoft Graph, from gst@vjdesai.com). Until
-- now a message had one recipient and no attachment. This adds:
--   email_outbox.cc_email     comma separated copies (optional)
--   email_outbox.attachments  [{ name, content_type, content_base64 }] sent as
--                             Graph file attachments; kept on the row as the
--                             record of what went out
--   kind 'bills_not_in_books' on email_outbox and email_templates
--   the staff-editable template 'bills_not_in_books' (Reminders → Templates)
-- to_email may now hold several addresses separated by commas or semicolons.
--
-- RLS: unchanged; both tables keep their open "app manage" policies.
-- Idempotent.

BEGIN;

ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS cc_email text,
  ADD COLUMN IF NOT EXISTS attachments jsonb;

ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('reminder', 'confirmation', 'builder_setup', 'builder_fsi', 'builder_cancellation',
                  'builder_agreement_confirm', 'notice_alert', 'einvoice_threshold', 'bills_not_in_books'));

ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind IN ('reminder', 'confirmation', 'builder_setup', 'builder_fsi', 'builder_cancellation',
                  'builder_agreement_confirm', 'notice_alert', 'einvoice_threshold', 'bills_not_in_books'));

CREATE INDEX IF NOT EXISTS idx_email_outbox_client_kind_period
  ON public.email_outbox (client_id, kind, period_month);

INSERT INTO public.email_templates (key, name, kind, step, subject, body, is_active, sort_order)
VALUES (
  'bills_not_in_books',
  'Bills in GSTR-2B not in your books',
  'bills_not_in_books',
  NULL,
  'Purchase bills in your GSTR-2B not yet in your books · {{period}} | {{client_name}}',
  E'While reconciling your GSTR-2B for {{period}} with your purchase records, we found {{bill_count}} that your suppliers have reported on the GST portal but that are not yet recorded in your books. Together they carry input tax credit of {{itc_total}}.\n\n'
  || E'The attached Excel lists each one with the supplier, the document number and date, and the tax on it. Please record them in your books, or note against each line why it should not be recorded (for example, goods not received, wrong GSTIN, or a duplicate). The last column is left for your remarks.\n\n'
  || E'We claim input tax credit on these documents once they are recorded in your books, so a prompt reply lets us claim it in the right month. We would be grateful for your response by {{reply_by}}.\n\n'
  || E'If anything is unclear, simply reply to this email and we will help.',
  true,
  900
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
