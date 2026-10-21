-- The GST working tables the sibling migrations of 21 Oct 2026 create, with
-- their columns and keys as those files write them (no constraints beyond the
-- keys and the cascades): 20261021100000 (prior months: twob_ever_filed,
-- twob_filed_figures, twob_carry_log) and 20261021140000 (BU confirmation
-- e-mails, live since 21 Oct: two tables and five columns on
-- builder_bu_agreement_confirmations). run.sh loads this before the change
-- log, as both sort before it and the live project will have them.
CREATE TABLE public.twob_ever_filed (
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  return_type    text NOT NULL,
  period_month   text NOT NULL,
  first_filed_at timestamptz NOT NULL DEFAULT now(),
  reopened_at    timestamptz,
  reopened_by    uuid,
  reopen_reason  text,
  PRIMARY KEY (client_id, return_type, period_month)
);
CREATE TABLE public.twob_filed_figures (
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month      text NOT NULL,
  reversal_igst     numeric NOT NULL DEFAULT 0,
  reversal_cgst     numeric NOT NULL DEFAULT 0,
  reversal_sgst     numeric NOT NULL DEFAULT 0,
  reclaim_igst      numeric NOT NULL DEFAULT 0,
  reclaim_cgst      numeric NOT NULL DEFAULT 0,
  reclaim_sgst      numeric NOT NULL DEFAULT 0,
  expense_out_igst  numeric NOT NULL DEFAULT 0,
  expense_out_cgst  numeric NOT NULL DEFAULT 0,
  expense_out_sgst  numeric NOT NULL DEFAULT 0,
  frozen_at         timestamptz NOT NULL DEFAULT now(),
  frozen_by         uuid,
  PRIMARY KEY (client_id, period_month)
);
CREATE TABLE public.twob_carry_log (
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  list         text NOT NULL,
  next_period  text,
  carried_at   timestamptz,
  carried_how  text,
  carried_rows integer NOT NULL DEFAULT 0,
  last_outcome text,
  last_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, period_month, list)
);
CREATE TABLE public.builder_bu_confirm_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq          bigint GENERATED ALWAYS AS IDENTITY,
  token        text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  bu_event_id  uuid,
  client_id    uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  to_emails    text[],
  cc_emails    text[] NOT NULL DEFAULT '{}',
  unit_ids     uuid[],
  earlier_link boolean NOT NULL DEFAULT false,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  outbox_id    uuid
);
CREATE TABLE public.builder_bu_confirm_answer_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_event_id        uuid,
  unit_id            uuid REFERENCES public.builder_units(id) ON DELETE CASCADE,
  request_id         uuid,
  status             text,
  agreement_value    numeric,
  dispute_notes      text,
  responded_by_name  text,
  responded_by_email text,
  responded_at       timestamptz,
  cleared_at         timestamptz NOT NULL DEFAULT now(),
  cleared_by         uuid,
  cleared_by_request uuid
);
ALTER TABLE public.builder_bu_agreement_confirmations
  ADD COLUMN IF NOT EXISTS request_id         uuid REFERENCES public.builder_bu_confirm_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responded_by_name  text,
  ADD COLUMN IF NOT EXISTS responded_by_email text,
  ADD COLUMN IF NOT EXISTS legacy_outbox_id   uuid,
  ADD COLUMN IF NOT EXISTS legacy_emails      text[];
GRANT ALL ON public.twob_ever_filed, public.twob_filed_figures, public.twob_carry_log,
  public.builder_bu_confirm_requests, public.builder_bu_confirm_answer_history TO anon, authenticated, service_role;
