-- Firm decision: when a BU event crystallises the remaining balance as
-- taxable, staff must re-review and re-key every taxable unit's agreement
-- value, and the client must affirmatively confirm it, before the
-- differential can be posted — so a client who later changes the agreement
-- value without telling the firm can never leave the firm exposed.
--
-- Confirmation is a tokenized email link, no client login required: the
-- email carries a unique link the client clicks themselves (Confirm /
-- Dispute), and a SECURITY DEFINER RPC scoped strictly to that token records
-- the response. This mirrors the request/confirm shape of
-- builder_fsi_consents (20260729200000_builder_phase5_fsi_consent.sql)
-- exactly, but runs per unit — many rows per BU event, not one per event —
-- and skips FSI's second staff-approval tier: the client's own token click
-- is the record, and adding a review step on top of every unit's confirmation
-- would be friction nobody asked for.

-- ── 1. builder_bu_agreement_confirmations ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_bu_agreement_confirmations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_event_id               uuid NOT NULL REFERENCES public.builder_bu_events(id) ON DELETE CASCADE,
  unit_id                   uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  client_id                 uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  agreement_value_at_request numeric NOT NULL DEFAULT 0,
  token                     text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status                    text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'DISPUTED')),
  outbox_id                 uuid REFERENCES public.email_outbox(id) ON DELETE SET NULL,
  sent_at                   timestamptz,
  responded_at              timestamptz,
  response_ip               text,
  dispute_notes             text,
  created_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bu_event_id, unit_id)
);
CREATE INDEX IF NOT EXISTS idx_builder_bu_agreement_confirm_client
  ON public.builder_bu_agreement_confirmations(client_id);
CREATE INDEX IF NOT EXISTS idx_builder_bu_agreement_confirm_event
  ON public.builder_bu_agreement_confirmations(bu_event_id);

COMMENT ON TABLE public.builder_bu_agreement_confirmations IS
  'Per-unit client confirmation of the agreement value used for a BU differential, captured via a '
  'tokenized email link (no login). BuilderBuEventsPage.tsx blocks posting the event while any '
  'taxable unit is not CONFIRMED.';

ALTER TABLE public.builder_bu_agreement_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS builder_bu_agreement_confirmations_all ON public.builder_bu_agreement_confirmations;
CREATE POLICY builder_bu_agreement_confirmations_all ON public.builder_bu_agreement_confirmations
  FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_bu_agreement_confirmations TO anon, authenticated;

DROP TRIGGER IF EXISTS trg_builder_bu_agreement_confirmations_updated_at
  ON public.builder_bu_agreement_confirmations;
CREATE TRIGGER trg_builder_bu_agreement_confirmations_updated_at
  BEFORE UPDATE ON public.builder_bu_agreement_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. Token-scoped RPCs ─────────────────────────────────────────────────────
-- The table itself is world-readable (RLS open to public, per this app's
-- custom-auth convention), so these functions are what actually keeps a
-- confirmation restricted to whoever holds the emailed token: a lookup or
-- confirm call with the wrong token matches no row and does nothing.

CREATE OR REPLACE FUNCTION public.builder_bu_agreement_confirmation_lookup(_token text)
RETURNS TABLE(unit_no text, project_name text, agreement_value numeric, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.unit_no, p.name, c.agreement_value_at_request, c.status
  FROM public.builder_bu_agreement_confirmations c
  JOIN public.builder_units u ON u.id = c.unit_id
  JOIN public.builder_projects p ON p.id = u.project_id
  WHERE c.token = _token;
$$;

CREATE OR REPLACE FUNCTION public.builder_bu_agreement_confirm(_token text, _action text, _notes text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_status text;
BEGIN
  IF _action NOT IN ('CONFIRM', 'DISPUTE') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;
  _new_status := CASE WHEN _action = 'CONFIRM' THEN 'CONFIRMED' ELSE 'DISPUTED' END;

  UPDATE public.builder_bu_agreement_confirmations
  SET status = _new_status,
      responded_at = now(),
      dispute_notes = CASE WHEN _action = 'DISPUTE' THEN _notes ELSE dispute_notes END
  WHERE token = _token AND status = 'PENDING';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.builder_bu_agreement_confirmation_blocked(
  _client_id uuid,
  _period_month text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.builder_bu_agreement_confirmations c
    JOIN public.builder_bu_events ev ON ev.id = c.bu_event_id
    WHERE c.client_id = _client_id
      AND ev.posting_period = _period_month
      AND c.status <> 'CONFIRMED'
  );
$$;

COMMENT ON FUNCTION public.builder_bu_agreement_confirmation_blocked IS
  'Blocks posting a BU event while any of its taxable units'' agreement-value confirmations are '
  'outstanding — mirrors builder_fsi_consent_blocked.';

GRANT EXECUTE ON FUNCTION public.builder_bu_agreement_confirmation_lookup(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_bu_agreement_confirm(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_bu_agreement_confirmation_blocked(uuid, text) TO anon, authenticated;

-- ── 3. Email — new kind + template ──────────────────────────────────────────
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind IN ('reminder', 'confirmation', 'builder_setup', 'builder_fsi', 'builder_cancellation',
                   'builder_agreement_confirm'));
ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('reminder', 'confirmation', 'builder_setup', 'builder_fsi', 'builder_cancellation',
                   'builder_agreement_confirm'));

INSERT INTO public.email_templates (key, name, kind, step, subject, body, sort_order) VALUES
('builder_bu_agreement_confirm', 'Builder — BU agreement value confirmation', 'builder_agreement_confirm', NULL,
 $s$Please confirm the agreement value — unit {{unit_no}}, {{project_name}}$s$,
 $b$Dear {{contact_person}},

The building use permission for {{project_name}} is dated {{bu_date}}. Under GST, that date is when the balance consideration for unit {{unit_no}} becomes taxable, whether or not it has been received.

Our working uses the following agreement value for this unit:

   Rs. {{agreement_value}}

Please confirm this is correct by clicking the link below. If it has changed and we have not been informed, please use the dispute option instead so we can correct our working before filing.

{{confirm_link}}

We will hold this unit's differential until we hear from you.

Warm regards,
{{staff_name}}
{{firm_name}}  |  {{firm_email}}  |  {{firm_phone}}$b$, 12)
ON CONFLICT (key) DO NOTHING;
