-- ─────────────────────────────────────────────────────────────────────────
-- GST return-data reminders + filing confirmation (email via gst@vjdesai.com)
--
-- Three staff-managed tables:
--   email_templates          — editable copy for reminders + confirmations
--   client_reminder_settings — per-client on/off + interval (staff-set)
--   email_outbox             — every email we intend to send (status queue)
--
-- The actual SEND is deferred: rows land in email_outbox with status
-- 'pending'; a sender (wired to the gst@vjdesai.com API later) flips them to
-- 'sent'/'failed'. Nothing here sends real email.
--
-- RLS: staff-only via is_staff(auth.uid()) — matches the app's existing pattern.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. email_templates ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_templates (
  key         text PRIMARY KEY,                 -- stable id: 'reminder_1' etc.
  name        text NOT NULL,                     -- human label in the editor
  kind        text NOT NULL CHECK (kind IN ('reminder','confirmation')),
  step        int,                               -- ladder position (1/2/3) for reminders
  subject     text NOT NULL,
  body        text NOT NULL,                     -- plain text with {{variables}}
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- ── 2. client_reminder_settings ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_reminder_settings (
  client_id         uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled           boolean NOT NULL DEFAULT false,               -- the on/off switch
  interval_days     int NOT NULL DEFAULT 3 CHECK (interval_days BETWEEN 1 AND 90),
  escalate          boolean NOT NULL DEFAULT true,                -- walk reminder_1 -> _2 -> _final
  max_reminders     int CHECK (max_reminders IS NULL OR max_reminders BETWEEN 1 AND 20),
  send_confirmation boolean NOT NULL DEFAULT true,                -- email on 'Filed'
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

-- ── 3. email_outbox ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  to_email         text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('reminder','confirmation')),
  template_key     text NOT NULL REFERENCES public.email_templates(key),
  return_type      public.return_type,
  period_month     text,                                          -- 'MM/YYYY'
  subject          text NOT NULL,
  body             text NOT NULL,                                 -- rendered (variables filled)
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sent','failed','skipped','cancelled')),
  error            text,
  reminder_step    int,
  filing_status_id uuid REFERENCES public.filing_status(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  sent_at          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON public.email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_client ON public.email_outbox(client_id);
-- One confirmation per (client, return, period) — never double-confirm a filing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_outbox_confirmation
  ON public.email_outbox(client_id, return_type, period_month)
  WHERE kind = 'confirmation';

-- ── updated_at triggers (reuse the existing helper) ─────────────────────────
DROP TRIGGER IF EXISTS trg_email_templates_updated_at ON public.email_templates;
CREATE TRIGGER trg_email_templates_updated_at BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_client_reminder_settings_updated_at ON public.client_reminder_settings;
CREATE TRIGGER trg_client_reminder_settings_updated_at BEFORE UPDATE ON public.client_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS: staff-only ─────────────────────────────────────────────────────────
ALTER TABLE public.email_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage email_templates" ON public.email_templates;
CREATE POLICY "staff manage email_templates" ON public.email_templates
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage client_reminder_settings" ON public.client_reminder_settings;
CREATE POLICY "staff manage client_reminder_settings" ON public.client_reminder_settings
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage email_outbox" ON public.email_outbox;
CREATE POLICY "staff manage email_outbox" ON public.email_outbox
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates          TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_reminder_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_outbox             TO anon, authenticated;

-- ── Seed the 5 templates (idempotent — only inserts if the key is new) ──────
INSERT INTO public.email_templates (key, name, kind, step, subject, body, sort_order) VALUES
('reminder_1', 'Reminder 1 — First (cordial)', 'reminder', 1,
 $s$GST data due — {{return_type}} for {{period}} | {{client_name}}$s$,
 $b$Dear {{contact_person}},

A gentle reminder that your {{return_type}} for {{period}} (GSTIN: {{gstin}}) is due to be filed by {{due_date}}.

So we can prepare and file comfortably before the due date, please share the following by {{data_by_date}}:
  - Sales / outward supply details for {{period}}
  - Purchase / inward supply details
  - Debit & credit notes, if any
  - Anything else relevant to this return

You may simply reply to this email with the documents. If you have already sent them, kindly ignore this reminder.

Warm regards,
{{staff_name}}
{{firm_name}}  |  {{firm_email}}  |  {{firm_phone}}$b$, 1),

('reminder_2', 'Reminder 2 — Follow-up (nudge)', 'reminder', 2,
 $s$Follow-up: awaiting GST data — {{return_type}} {{period}} | {{client_name}}$s$,
 $b$Dear {{contact_person}},

We are yet to receive your data for {{return_type}} — {{period}} (GSTIN: {{gstin}}). The filing due date is {{due_date}}.

Sharing the pending details early lets us review the figures with you before filing. Please send them at your convenience — and do let us know if you would like any help compiling them.

Warm regards,
{{staff_name}}
{{firm_name}}  |  {{firm_email}}  |  {{firm_phone}}$b$, 2),

('reminder_final', 'Reminder 3 — Final / urgent', 'reminder', 3,
 $s$Urgent: {{return_type}} {{period}} due {{due_date}} — data pending | {{client_name}}$s$,
 $b$Dear {{contact_person}},

The due date for your {{return_type}} — {{period}} (GSTIN: {{gstin}}) is {{due_date}}, and your data is still pending with us.

Filing after the due date can attract late fees and interest under GST, and may affect input tax credit for your recipients. To avoid this, please share the required details immediately.

If the return is NIL for this period, just reply "NIL" and we will proceed.

Warm regards,
{{staff_name}}
{{firm_name}}  |  {{firm_email}}  |  {{firm_phone}}$b$, 3),

('confirmation', 'Confirmation — Return filed', 'confirmation', NULL,
 $s$Filed - {{return_type}} for {{period}} | ARN {{arn}} | {{client_name}}$s$,
 $b$Dear {{contact_person}},

We are pleased to confirm that your {{return_type}} for {{period}} (GSTIN: {{gstin}}) has been successfully filed.

    Return    :  {{return_type}}
    Period    :  {{period}}
    Filed on  :  {{filing_date}}
    ARN       :  {{arn}}

No action is needed from your side — this is a confirmation of filing only. The acknowledgment can be downloaded from the GST portal, or requested from us any time.

Thank you for your cooperation.

Warm regards,
{{staff_name}}
{{firm_name}}  |  {{firm_email}}  |  {{firm_phone}}$b$, 4),

('confirmation_nil', 'Confirmation — Nil return filed', 'confirmation', NULL,
 $s$Filed - NIL {{return_type}} for {{period}} | {{client_name}}$s$,
 $b$Dear {{contact_person}},

This confirms that a NIL {{return_type}} for {{period}} (GSTIN: {{gstin}}) has been filed on {{filing_date}} (ARN: {{arn}}). No tax was payable and no action is required from your side.

Warm regards,
{{staff_name}}
{{firm_name}}  |  {{firm_email}}  |  {{firm_phone}}$b$, 5)
ON CONFLICT (key) DO NOTHING;
