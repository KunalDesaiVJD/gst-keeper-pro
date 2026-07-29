-- ─────────────────────────────────────────────────────────────────────────
-- BUILDER MODULE — PHASE 1: masters, classification, opening balances
--
-- Real-estate promoters under Notification 11/2017-CT(R) Entry 3 as
-- substituted by Notification 03/2019-CT(R) w.e.f. 01.04.2019.
--
-- Rate convention (confirmed by the firm): report the TAXABLE VALUE AFTER the
-- 1/3rd deemed land deduction (para 2 of Notif 11/2017), with the NOTIFIED
-- rate — i.e. taxable value = 2/3 of consideration, rate = 1.5 / 7.5 / 18.
-- The effective rates on full consideration are therefore 1% / 5% / 12%.
--
--   Affordable residential            → 1.5% on 2/3rd  (eff. 1%)
--   Other residential                 → 7.5% on 2/3rd  (eff. 5%)
--   Commercial in an RREP             → 7.5% on 2/3rd  (eff. 5%)
--   Commercial in a REP other than RREP → 18% on 2/3rd (eff. 12%)
--
-- RREP = commercial carpet area is not more than 15% of total carpet area of
-- all apartments in the project. Tested at RERA-project level.
--
-- Affordable = RERA carpet area <= 60 sq m (metro) / 90 sq m (non-metro)
--              AND gross amount charged <= Rs. 45,00,000.
--
-- Tables here are masters only. Bookings, receipts, BU events, FSI and the
-- differential engine arrive in later phases.
--
-- RLS: staff-only via is_staff(auth.uid()) — matches the app's existing pattern.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. builder_client_settings ─────────────────────────────────────────────
-- One row per builder client. Captured as a questionnaire when the client is
-- set up, then emailed to the client for written confirmation.
--
-- The charge-head switches decide whether a head forms part of the
-- "gross amount charged" for the apartment. That single base serves BOTH the
-- Rs. 45 lakh affordable test AND the taxable value — they are the same
-- statutory concept, so one switch per head, not two.
CREATE TABLE IF NOT EXISTS public.builder_client_settings (
  client_id                 uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Charge heads forming part of gross amount charged (default: include all)
  incl_plc                  boolean NOT NULL DEFAULT true,  -- preferential location / floor rise
  incl_development          boolean NOT NULL DEFAULT true,  -- development / infrastructure
  incl_parking              boolean NOT NULL DEFAULT true,
  incl_club                 boolean NOT NULL DEFAULT true,
  incl_utility_deposit      boolean NOT NULL DEFAULT true,  -- electricity / water connection
  incl_legal                boolean NOT NULL DEFAULT true,  -- legal / documentation
  incl_maintenance_corpus   boolean NOT NULL DEFAULT true,  -- maintenance deposit / corpus
  incl_other                boolean NOT NULL DEFAULT true,

  -- Extra / additional work billed to members (modifications, upgrades)
  extra_work_rate           text NOT NULL DEFAULT 'EIGHTEEN'
                              CHECK (extra_work_rate IN ('UNIT_RATE','EIGHTEEN')),

  -- Interest recovered from members on delayed instalments.
  -- s.15(2)(d) includes it in the value of the principal supply (unit rate);
  -- the firm's elected practice is a flat 18%. Both supported.
  delay_interest_basis      text NOT NULL DEFAULT 'FLAT_18'
                              CHECK (delay_interest_basis IN ('FLAT_18','UNIT_RATE')),

  -- Where tax was wrongly computed on a GST-inclusive receipt (tax on tax),
  -- how the excess is dealt with.
  excess_tax_treatment      text NOT NULL DEFAULT 'ADJUST'
                              CHECK (excess_tax_treatment IN ('ADJUST','REFUND','ABSORB')),

  -- Default TDR/FSI stance; overridable per project.
  default_fsi_treatment     text NOT NULL DEFAULT 'PAY'
                              CHECK (default_fsi_treatment IN ('PAY','IGNORE')),

  -- Written confirmation trail for the elections above
  confirmation_outbox_id    uuid REFERENCES public.email_outbox(id) ON DELETE SET NULL,
  confirmation_sent_at      timestamptz,
  confirmation_received_at  timestamptz,
  confirmation_document_url text,
  confirmation_notes        text,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid
);

COMMENT ON TABLE public.builder_client_settings IS
  'Per-builder-client elections captured at setup and confirmed by the client in writing.';
COMMENT ON COLUMN public.builder_client_settings.delay_interest_basis IS
  'FLAT_18 = firm practice (18% flat). UNIT_RATE = s.15(2)(d) treatment at the unit rate.';

-- ── 2. builder_projects ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_projects (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  rera_number           text,
  city                  text,

  -- Metropolitan for the affordable carpet-area limit: 60 sq m vs 90 sq m.
  -- Metro = Bengaluru, Chennai, Delhi NCR, Hyderabad, Kolkata, MMR.
  is_metro              boolean NOT NULL DEFAULT false,

  -- Label for the intermediate grouping level; varies by project type.
  grouping_label        text NOT NULL DEFAULT 'Block'
                          CHECK (grouping_label IN ('Block','Wing','Tower','Phase')),

  -- The 15% RREP test needs total/commercial carpet area. Normally derived
  -- from the unit master; MANUAL is for projects onboarded without a full
  -- unit list yet.
  carpet_area_source    text NOT NULL DEFAULT 'DERIVED'
                          CHECK (carpet_area_source IN ('DERIVED','MANUAL')),
  manual_residential_carpet_sqm numeric NOT NULL DEFAULT 0,
  manual_commercial_carpet_sqm  numeric NOT NULL DEFAULT 0,

  -- Document numbering series is kept per project.
  doc_series_prefix     text,

  -- Cut-off from which this app takes over from the client's prior records.
  opening_cutoff_date   date,

  -- NULL inherits builder_client_settings.default_fsi_treatment
  fsi_treatment         text CHECK (fsi_treatment IS NULL OR fsi_treatment IN ('PAY','IGNORE')),

  status                text NOT NULL DEFAULT 'Active'
                          CHECK (status IN ('Active','Completed','Closed')),
  notes                 text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_projects_client ON public.builder_projects(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_projects_rera
  ON public.builder_projects(client_id, rera_number)
  WHERE rera_number IS NOT NULL AND rera_number <> '';

COMMENT ON COLUMN public.builder_projects.is_metro IS
  'true => 60 sq m affordable limit; false => 90 sq m. Gujarat cities are non-metro.';

-- ── 3. builder_project_groups ──────────────────────────────────────────────
-- Generic intermediate level. What it is called is driven by
-- builder_projects.grouping_label (Block / Wing / Tower / Phase).
CREATE TABLE IF NOT EXISTS public.builder_project_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_builder_groups_project ON public.builder_project_groups(project_id);

-- ── 4. builder_units ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_units (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  group_id            uuid REFERENCES public.builder_project_groups(id) ON DELETE SET NULL,
  unit_no             text NOT NULL,
  unit_type           text NOT NULL CHECK (unit_type IN ('Residential','Commercial')),

  -- RERA carpet area (s.2(k) RERA), in square metres.
  carpet_area_sqm     numeric NOT NULL DEFAULT 0 CHECK (carpet_area_sqm >= 0),

  -- Base consideration for the unit, EXCLUSIVE of GST. Charge heads
  -- (PLC, parking, club, ...) are child rows in builder_unit_charges.
  base_consideration  numeric NOT NULL DEFAULT 0 CHECK (base_consideration >= 0),

  status              text NOT NULL DEFAULT 'Available'
                        CHECK (status IN ('Available','Booked','Cancelled','Converted','Closed')),

  -- Registered sale deed. Under the firm's model the unit cut-off is the
  -- EARLIER of the block's BU date and this date. Consumed from Phase 3.
  dastavej_date       date,
  dastavej_value      numeric,

  sort_order          int NOT NULL DEFAULT 0,
  notes               text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  UNIQUE (project_id, unit_no)
);
CREATE INDEX IF NOT EXISTS idx_builder_units_project ON public.builder_units(project_id);
CREATE INDEX IF NOT EXISTS idx_builder_units_group   ON public.builder_units(group_id);

COMMENT ON COLUMN public.builder_units.carpet_area_sqm IS
  'RERA carpet area in sq m — the figure the affordable test and the 15% RREP test both use.';

-- ── 5. builder_unit_charges ────────────────────────────────────────────────
-- Parent-child: the unit is the parent, these are the extras billed alongside.
-- include_override lets a single unit depart from the client-level election;
-- NULL means "follow builder_client_settings".
CREATE TABLE IF NOT EXISTS public.builder_unit_charges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id           uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  charge_head       text NOT NULL CHECK (charge_head IN (
                      'PLC','DEVELOPMENT','PARKING','CLUB',
                      'UTILITY_DEPOSIT','LEGAL','MAINTENANCE_CORPUS','OTHER')),
  label             text,                      -- free text, mainly for OTHER
  amount            numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  include_override  boolean,                   -- NULL = inherit client setting
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_builder_unit_charges_unit ON public.builder_unit_charges(unit_id);
-- Standard heads appear once per unit; OTHER may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_unit_charges_head
  ON public.builder_unit_charges(unit_id, charge_head)
  WHERE charge_head <> 'OTHER';

-- ── 6. builder_unit_classification_history ─────────────────────────────────
-- Effective-dated. Never updated in place: every change of affordable status
-- or rate writes a new row. This is the audit trail behind a retrospective
-- re-rating when a unit's gross consideration crosses Rs. 45 lakh, and the
-- source for the period-wise differential and s.50 interest schedule built
-- in a later phase.
CREATE TABLE IF NOT EXISTS public.builder_unit_classification_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id             uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  effective_from      date NOT NULL DEFAULT CURRENT_DATE,

  is_affordable       boolean NOT NULL,
  rate_code           text NOT NULL CHECK (rate_code IN
                        ('AFFORDABLE','OTHER_RESIDENTIAL','COMMERCIAL_RREP','COMMERCIAL_REP')),
  rate_pct            numeric NOT NULL,        -- notified rate on 2/3rd value: 1.5 / 7.5 / 18
  effective_rate_pct  numeric NOT NULL,        -- on full consideration: 1 / 5 / 12

  -- Inputs the decision was made on, frozen for audit
  gross_consideration numeric NOT NULL DEFAULT 0,
  carpet_area_sqm     numeric NOT NULL DEFAULT 0,
  area_limit_sqm      numeric NOT NULL DEFAULT 90,
  is_rrep             boolean NOT NULL DEFAULT true,

  reason              text NOT NULL DEFAULT 'INITIAL'
                        CHECK (reason IN ('INITIAL','VALUE_CHANGE','AREA_CHANGE',
                                          'PROJECT_MIX_CHANGE','MANUAL','CONVERSION')),
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_class_hist_unit
  ON public.builder_unit_classification_history(unit_id, effective_from DESC);

-- ── 7. builder_opening_balances ────────────────────────────────────────────
-- Onboarding position per unit at builder_projects.opening_cutoff_date.
-- "value_taxed" is the base the BU differential deducts from — deliberately
-- the value on which GST was DISCHARGED, not the amount received.
CREATE TABLE IF NOT EXISTS public.builder_opening_balances (
  unit_id                 uuid PRIMARY KEY REFERENCES public.builder_units(id) ON DELETE CASCADE,
  as_at_date              date NOT NULL,
  agreement_value         numeric NOT NULL DEFAULT 0,  -- excl. GST, incl. included charge heads
  cumulative_receipts     numeric NOT NULL DEFAULT 0,  -- memo: money actually received
  cumulative_value_taxed  numeric NOT NULL DEFAULT 0,  -- taxable base already offered to tax
  cumulative_cgst         numeric NOT NULL DEFAULT 0,
  cumulative_sgst         numeric NOT NULL DEFAULT 0,
  cumulative_tds_194ia    numeric NOT NULL DEFAULT 0,
  is_affordable_at_opening boolean,
  rate_code_at_opening    text CHECK (rate_code_at_opening IS NULL OR rate_code_at_opening IN
                            ('AFFORDABLE','OTHER_RESIDENTIAL','COMMERCIAL_RREP','COMMERCIAL_REP')),
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid
);

COMMENT ON COLUMN public.builder_opening_balances.cumulative_value_taxed IS
  'Taxable value already offered to tax. The BU differential deducts THIS, not cumulative_receipts.';

-- ── 8. Area summary view — feeds the 15% RREP test ─────────────────────────
CREATE OR REPLACE VIEW public.builder_project_areas AS
SELECT
  p.id                                  AS project_id,
  p.client_id,
  p.carpet_area_source,
  COALESCE(u.residential_sqm, 0)        AS derived_residential_sqm,
  COALESCE(u.commercial_sqm, 0)         AS derived_commercial_sqm,
  COALESCE(u.unit_count, 0)             AS unit_count,
  CASE WHEN p.carpet_area_source = 'MANUAL'
       THEN p.manual_residential_carpet_sqm
       ELSE COALESCE(u.residential_sqm, 0) END AS residential_sqm,
  CASE WHEN p.carpet_area_source = 'MANUAL'
       THEN p.manual_commercial_carpet_sqm
       ELSE COALESCE(u.commercial_sqm, 0) END  AS commercial_sqm
FROM public.builder_projects p
LEFT JOIN (
  SELECT project_id,
         SUM(CASE WHEN unit_type = 'Residential' THEN carpet_area_sqm ELSE 0 END) AS residential_sqm,
         SUM(CASE WHEN unit_type = 'Commercial'  THEN carpet_area_sqm ELSE 0 END) AS commercial_sqm,
         COUNT(*) AS unit_count
  FROM public.builder_units
  WHERE status <> 'Cancelled'
  GROUP BY project_id
) u ON u.project_id = p.id;

COMMENT ON VIEW public.builder_project_areas IS
  'Carpet areas per project for the 15% RREP test. Honours carpet_area_source (DERIVED vs MANUAL).';

-- ── 9. updated_at triggers ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_builder_client_settings_updated_at ON public.builder_client_settings;
CREATE TRIGGER trg_builder_client_settings_updated_at BEFORE UPDATE ON public.builder_client_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_builder_projects_updated_at ON public.builder_projects;
CREATE TRIGGER trg_builder_projects_updated_at BEFORE UPDATE ON public.builder_projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_builder_units_updated_at ON public.builder_units;
CREATE TRIGGER trg_builder_units_updated_at BEFORE UPDATE ON public.builder_units
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_builder_unit_charges_updated_at ON public.builder_unit_charges;
CREATE TRIGGER trg_builder_unit_charges_updated_at BEFORE UPDATE ON public.builder_unit_charges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_builder_opening_balances_updated_at ON public.builder_opening_balances;
CREATE TRIGGER trg_builder_opening_balances_updated_at BEFORE UPDATE ON public.builder_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 10. RLS: staff-only ────────────────────────────────────────────────────
ALTER TABLE public.builder_client_settings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_projects                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_project_groups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_units                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_unit_charges                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_unit_classification_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_opening_balances             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage builder_client_settings" ON public.builder_client_settings;
CREATE POLICY "staff manage builder_client_settings" ON public.builder_client_settings
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_projects" ON public.builder_projects;
CREATE POLICY "staff manage builder_projects" ON public.builder_projects
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_project_groups" ON public.builder_project_groups;
CREATE POLICY "staff manage builder_project_groups" ON public.builder_project_groups
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_units" ON public.builder_units;
CREATE POLICY "staff manage builder_units" ON public.builder_units
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_unit_charges" ON public.builder_unit_charges;
CREATE POLICY "staff manage builder_unit_charges" ON public.builder_unit_charges
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_class_hist" ON public.builder_unit_classification_history;
CREATE POLICY "staff manage builder_class_hist" ON public.builder_unit_classification_history
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_opening_balances" ON public.builder_opening_balances;
CREATE POLICY "staff manage builder_opening_balances" ON public.builder_opening_balances
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_client_settings             TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_projects                    TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_project_groups              TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_units                       TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_unit_charges                TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_unit_classification_history TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_opening_balances            TO anon, authenticated;
GRANT SELECT ON public.builder_project_areas TO anon, authenticated;

-- ── 11. Email template for the setup-confirmation letter ───────────────────
-- Reuses the existing email_templates / email_outbox queue. Widen the two
-- 'kind' checks to admit 'builder_setup'.
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind IN ('reminder','confirmation','builder_setup'));

ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('reminder','confirmation','builder_setup'));

INSERT INTO public.email_templates (key, name, kind, step, subject, body, sort_order) VALUES
('builder_setup_confirmation', 'Builder — setup elections confirmation', 'builder_setup', NULL,
 $s$Confirmation of GST treatment — real estate project(s) | {{client_name}}$s$,
 $b$Dear {{contact_person}},

We are setting up your real estate projects (GSTIN: {{gstin}}) on our GST system. Before we begin, please confirm the following, as each affects the GST charged to your members and the returns we file on your behalf.

1. CHARGES FORMING PART OF THE UNIT PRICE
   The following are treated as part of the "gross amount charged" for each unit. This base decides both the Rs. 45 lakh affordable-housing limit and the taxable value:

{{charge_heads}}

2. EXTRA / ADDITIONAL WORK
   Modifications and upgrades billed to members: {{extra_work_rate}}

3. INTEREST ON DELAYED INSTALMENTS
   Interest recovered from members for late payment: {{delay_interest_basis}}

4. TDR / FSI UNDER REVERSE CHARGE
   Default treatment for this client: {{fsi_treatment}}

Please reply to this email confirming the above, or telling us what should change. We will hold the setup until we hear from you.

Warm regards,
{{staff_name}}
{{firm_name}}  |  {{firm_email}}  |  {{firm_phone}}$b$, 10)
ON CONFLICT (key) DO NOTHING;
