-- ─────────────────────────────────────────────────────────────────────────
-- BUILDER MODULE — PHASE 5: TDR / FSI reverse charge, and the consent gate
--
-- THE LIABILITY. Development rights, FSI and long-term lease premium are taxed
-- on the promoter under reverse charge at 18% (Notif 05 and 06/2019-CT(R)),
-- with the portion attributable to residential apartments BOOKED before the
-- completion certificate exempt (Notif 04/2019). Time of supply is the CC date
-- — the BU date — which is why this hangs off a BU event rather than a month.
--
-- So two legs, and they behave differently:
--
--   RESIDENTIAL  proportion attributable to UNBOOKED residential apartments,
--                taxed at 18%, but CAPPED at 1% / 5% of the value of those
--                unbooked apartments. The cap is computed per unit, because an
--                affordable unit caps at 1% and any other at 5%.
--
--   COMMERCIAL   proportion attributable to commercial apartments, taxed at
--                18% in full. No exemption, no cap.
--
-- Allocation across blocks is by carpet area, so a phased BU crystallises the
-- liability piece by piece rather than all at once.
--
-- The ITC of this RCM is NOT available — the 1%/5% scheme requires the credit
-- to be forgone — so it lands in 3B Table 3.1(d), is paid in cash, and is
-- reversed out of Table 4. It never touches GSTR-1.
--
-- THE CONSENT GATE. Some clients instruct the firm not to discharge RCM on
-- FSI. That instruction has to be on record, in writing, before the affected
-- return is filed: an email out from gst@vjdesai.com, the client's reply
-- attached, and a GST Manager's approval. Until all three exist, the period is
-- blocked.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. builder_fsi_workings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_fsi_workings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  bu_event_id           uuid NOT NULL REFERENCES public.builder_bu_events(id) ON DELETE CASCADE,
  period_month          text NOT NULL,              -- 'MM/YYYY' the RCM falls in

  -- Consideration for the development rights / FSI / lease premium, and the
  -- share of it this BU event carries (allocated by carpet area).
  tdr_fsi_total_value   numeric NOT NULL DEFAULT 0 CHECK (tdr_fsi_total_value >= 0),
  event_carpet_sqm      numeric NOT NULL DEFAULT 0,
  project_carpet_sqm    numeric NOT NULL DEFAULT 0,
  allocated_value       numeric NOT NULL DEFAULT 0,

  -- The split that drives both legs.
  residential_carpet_sqm          numeric NOT NULL DEFAULT 0,
  commercial_carpet_sqm           numeric NOT NULL DEFAULT 0,
  unbooked_residential_carpet_sqm numeric NOT NULL DEFAULT 0,
  unbooked_residential_value      numeric NOT NULL DEFAULT 0,

  -- Residential leg: 18% on the unbooked proportion, then capped.
  residential_portion   numeric NOT NULL DEFAULT 0,
  residential_rcm_uncapped numeric NOT NULL DEFAULT 0,
  cap_amount            numeric NOT NULL DEFAULT 0,
  cap_applied           boolean NOT NULL DEFAULT false,
  residential_rcm       numeric NOT NULL DEFAULT 0,

  -- Commercial leg: 18% in full.
  commercial_portion    numeric NOT NULL DEFAULT 0,
  commercial_rcm        numeric NOT NULL DEFAULT 0,

  total_rcm             numeric NOT NULL DEFAULT 0,
  cgst                  numeric NOT NULL DEFAULT 0,
  sgst                  numeric NOT NULL DEFAULT 0,

  -- PAY posts the RCM. IGNORE holds it back and arms the consent gate.
  treatment             text NOT NULL DEFAULT 'PAY' CHECK (treatment IN ('PAY','IGNORE')),
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','POSTED','IGNORED')),
  posted_at             timestamptz,
  posted_by             uuid,
  notes                 text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  -- One working per BU event; re-preparing replaces it.
  UNIQUE (bu_event_id)
);
CREATE INDEX IF NOT EXISTS idx_builder_fsi_project ON public.builder_fsi_workings(project_id);
CREATE INDEX IF NOT EXISTS idx_builder_fsi_period  ON public.builder_fsi_workings(period_month);

COMMENT ON COLUMN public.builder_fsi_workings.cap_amount IS
  'Sum over unbooked residential units of value x its own effective rate — 1% affordable, 5% other.';
COMMENT ON COLUMN public.builder_fsi_workings.commercial_rcm IS
  'Commercial leg carries no exemption and no cap: 18% of the attributable portion.';

-- ── 2. builder_fsi_consents ────────────────────────────────────────────────
-- The written instruction behind an IGNORE. All three of email-out,
-- confirmation-in and GST Manager approval must exist before the period files.
CREATE TABLE IF NOT EXISTS public.builder_fsi_consents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fsi_working_id        uuid NOT NULL REFERENCES public.builder_fsi_workings(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id            uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  period_month          text NOT NULL,

  -- Frozen at the time of asking, so the letter and the record agree even if
  -- the working is later re-prepared.
  fsi_value_at_request  numeric NOT NULL DEFAULT 0,
  rcm_at_request        numeric NOT NULL DEFAULT 0,

  outbox_id             uuid REFERENCES public.email_outbox(id) ON DELETE SET NULL,
  email_sent_at         timestamptz,
  confirmation_received_at timestamptz,
  confirmation_document_url text,
  received_by           uuid,

  -- GST Manager or superadmin only — never an employee.
  approved_by           uuid,
  approved_at           timestamptz,

  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fsi_working_id)
);
CREATE INDEX IF NOT EXISTS idx_builder_fsi_consent_client
  ON public.builder_fsi_consents(client_id, period_month);

-- ── 3. RCM postings view — 3B Table 3.1(d) ─────────────────────────────────
-- Deliberately separate from builder_period_postings: that feed is outward
-- supply for GSTR-1, this is inward reverse charge that never appears there.
CREATE OR REPLACE VIEW public.builder_rcm_postings AS
SELECT
  w.id                    AS source_id,
  'FSI_RCM'::text         AS source_type,
  'Table 3.1(d)'::text    AS gstr3b_table,
  p.client_id,
  p.id                    AS project_id,
  p.name                  AS project_name,
  w.bu_event_id,
  w.period_month,
  ev.bu_date,
  w.allocated_value,
  w.residential_rcm,
  w.commercial_rcm,
  w.total_rcm             AS taxable_tax,
  -- 18% RCM: the taxable value it sits on.
  ROUND(w.total_rcm / 0.18, 2) AS taxable_value,
  w.cgst,
  w.sgst
FROM public.builder_fsi_workings w
JOIN public.builder_projects  p  ON p.id = w.project_id
JOIN public.builder_bu_events ev ON ev.id = w.bu_event_id
WHERE w.status = 'POSTED' AND w.treatment = 'PAY';

COMMENT ON VIEW public.builder_rcm_postings IS
  'Inward reverse charge into 3B Table 3.1(d). Paid in cash; the ITC is blocked under the 1%/5% scheme.';

-- ── 4. Filing gate ─────────────────────────────────────────────────────────
-- True when a client has an FSI liability held back for the period without a
-- complete, approved consent on file. The Filing Status page blocks on this.
CREATE OR REPLACE FUNCTION public.builder_fsi_consent_blocked(
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
    FROM public.builder_fsi_workings w
    JOIN public.builder_projects p ON p.id = w.project_id
    LEFT JOIN public.builder_fsi_consents c ON c.fsi_working_id = w.id
    WHERE p.client_id = _client_id
      AND w.period_month = _period_month
      AND w.treatment = 'IGNORE'
      AND w.total_rcm > 0
      AND (
        c.id IS NULL
        OR c.confirmation_received_at IS NULL
        OR c.approved_at IS NULL
      )
  );
$$;

COMMENT ON FUNCTION public.builder_fsi_consent_blocked IS
  'Blocks filing while an ignored FSI liability lacks its written instruction and GST Manager approval.';

-- ── 5. Triggers, RLS, grants ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_builder_fsi_workings_updated_at ON public.builder_fsi_workings;
CREATE TRIGGER trg_builder_fsi_workings_updated_at BEFORE UPDATE ON public.builder_fsi_workings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_builder_fsi_consents_updated_at ON public.builder_fsi_consents;
CREATE TRIGGER trg_builder_fsi_consents_updated_at BEFORE UPDATE ON public.builder_fsi_consents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.builder_fsi_workings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_fsi_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage builder_fsi_workings" ON public.builder_fsi_workings;
CREATE POLICY "staff manage builder_fsi_workings" ON public.builder_fsi_workings
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "staff manage builder_fsi_consents" ON public.builder_fsi_consents;
CREATE POLICY "staff manage builder_fsi_consents" ON public.builder_fsi_consents
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_fsi_workings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_fsi_consents TO anon, authenticated;
GRANT SELECT ON public.builder_rcm_postings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_fsi_consent_blocked(uuid, text) TO anon, authenticated;

-- ── 6. The consent letter ──────────────────────────────────────────────────
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind IN ('reminder','confirmation','builder_setup','builder_fsi'));

ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('reminder','confirmation','builder_setup','builder_fsi'));

INSERT INTO public.email_templates (key, name, kind, step, subject, body, sort_order) VALUES
('builder_fsi_consent', 'Builder — TDR/FSI reverse charge instruction', 'builder_fsi', NULL,
 $s$Your instruction required — GST on development rights (TDR/FSI) | {{project_name}}$s$,
 $b$Dear {{contact_person}},

The building use permission for {{project_name}} is dated {{bu_date}}. Under GST, that date is when the liability on the development rights / FSI for this project crystallises.

Our working for {{period}} is as follows:

   Value of development rights / FSI attributable to this permission : Rs. {{fsi_value}}
   Reverse charge at 18%, after the exemption for units booked
   before the permission and after the statutory cap               : Rs. {{rcm_amount}}

This amount is payable by you under reverse charge, in cash, and the credit for it is not available under the 1%/5% scheme.

You have indicated that you do not wish to discharge this liability. We can only proceed on that basis with your written instruction on record. Please reply to this email confirming that you instruct us to file the return for {{period}} without providing for the above amount, and that you accept responsibility for that position.

We will hold the filing until we hear from you.

Warm regards,
{{staff_name}}
{{firm_name}}  |  {{firm_email}}  |  {{firm_phone}}$b$, 11)
ON CONFLICT (key) DO NOTHING;
