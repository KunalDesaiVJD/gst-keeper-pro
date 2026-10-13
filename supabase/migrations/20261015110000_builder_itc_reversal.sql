-- Builder: final ITC reversal at completion — Rules 42 and 43 (13 Oct 2026,
-- the firm's request; first case Bapa Sitaram Developers).
--
-- At BU / completion, credit taken over the life of the project on what
-- became exempt is reversed: units unbooked at completion are sold after
-- completion, which Schedule III para 5 keeps outside supply, so they count
-- as exempt for s.17(2)/(3). The share is the carpet area exempt over the
-- total carpet area (the Rule 42/43 key for construction), applied per
-- financial year to the project's common credit — inputs and input services
-- under Rule 42, capital goods under Rule 43 — less what each year already
-- reversed under those rules. Engine: src/utils/builderItcReversal.ts.
--
-- One working per project and BU event, with one row per financial year:
--   * past years come from that year's GSTR-9 (Table 6 availed, Table 7
--     reversed) and must be shown to match it before approval;
--   * the BU year is entered by hand (April to the BU month).
-- Only the superadmin approves. Approval writes the net amount into the
-- GSTR-3B of the chosen period as a gstr3b_adjustments row — 4(B)(1) for a
-- reversal, 4(A)(5) for a re-credit — and the working locks; withdrawing the
-- approval deletes that row while the return is unfiled.
--
-- RLS open to public (CLAUDE.md); the gate is the app plus the actor checks
-- in the RPCs below. With no Supabase auth session the actor id is the
-- browser's word, as elsewhere.

BEGIN;

CREATE TABLE IF NOT EXISTS public.builder_itc_reversal_workings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  bu_event_id      uuid REFERENCES public.builder_bu_events(id) ON DELETE SET NULL,
  completion_date  date NOT NULL,
  start_fy         text NOT NULL,              -- '2022-23'
  bu_fy            text NOT NULL,              -- the FY of completion, entered by hand
  total_carpet_sqm numeric NOT NULL DEFAULT 0,
  exempt_carpet_sqm numeric NOT NULL DEFAULT 0,
  basis_note       text,
  posting_period   text NOT NULL,              -- 'MM/YYYY' of the GSTR-3B it goes into
  include_interest boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED')),
  result           jsonb,                      -- engine output frozen at submission
  submitted_by     uuid, submitted_at timestamptz,
  approved_by      uuid, approved_at  timestamptz,
  adjustment_ids   uuid[] NOT NULL DEFAULT '{}',
  notes            text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, bu_event_id)
);

CREATE TABLE IF NOT EXISTS public.builder_itc_reversal_years (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  working_id       uuid NOT NULL REFERENCES public.builder_itc_reversal_workings(id) ON DELETE CASCADE,
  financial_year   text NOT NULL,              -- '2024-25'
  is_bu_year       boolean NOT NULL DEFAULT false,
  -- Common credit availed (GSTR-9 Table 6 for a past year; April to BU month for the BU year)
  inputs_services  jsonb NOT NULL DEFAULT '{"i":0,"c":0,"s":0,"x":0}',   -- Rule 42
  capital_goods    jsonb NOT NULL DEFAULT '{"i":0,"c":0,"s":0,"x":0}',   -- Rule 43
  -- Already reversed in that year under Rules 42 / 43 (GSTR-9 Table 7C / 7D)
  reversed_r42     jsonb NOT NULL DEFAULT '{"i":0,"c":0,"s":0,"x":0}',
  reversed_r43     jsonb NOT NULL DEFAULT '{"i":0,"c":0,"s":0,"x":0}',
  -- GSTR-9 match (past years): the filed return's ARN and date, and how it was matched
  gstr9_arn        text,
  gstr9_filed_on   date,
  gstr9_match      text NOT NULL DEFAULT 'UNVERIFIED' CHECK (gstr9_match IN ('UNVERIFIED', 'MATCHED_DATA', 'CONFIRMED')),
  remarks          text,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (working_id, financial_year)
);
CREATE INDEX IF NOT EXISTS builder_itc_reversal_years_working_idx ON public.builder_itc_reversal_years (working_id);

ALTER TABLE public.builder_itc_reversal_workings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_itc_reversal_years    ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS builder_itc_reversal_workings_all ON public.builder_itc_reversal_workings;
CREATE POLICY builder_itc_reversal_workings_all ON public.builder_itc_reversal_workings FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS builder_itc_reversal_years_all ON public.builder_itc_reversal_years;
CREATE POLICY builder_itc_reversal_years_all ON public.builder_itc_reversal_years FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_itc_reversal_workings, public.builder_itc_reversal_years TO anon, authenticated, service_role;

-- A submitted or approved working is frozen: figures change only after it is
-- sent back to draft (withdraw), which an approved one needs the superadmin for.
CREATE OR REPLACE FUNCTION public.builder_itc_reversal_years_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.builder_itc_reversal_workings
   WHERE id = COALESCE(NEW.working_id, OLD.working_id);
  IF v_status IN ('SUBMITTED', 'APPROVED') THEN
    RAISE EXCEPTION 'This ITC reversal working is %; send it back to draft before changing its figures.', lower(v_status)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_builder_itc_reversal_years_guard ON public.builder_itc_reversal_years;
CREATE TRIGGER trg_builder_itc_reversal_years_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.builder_itc_reversal_years
  FOR EACH ROW EXECUTE FUNCTION public.builder_itc_reversal_years_guard();

-- Approve (superadmin only): write the net figures into that period's GSTR-3B.
-- p_lines: [{table_ref:'4B(1)'|'4A(5)', label, igst, cgst, sgst, cess, reason}]
CREATE OR REPLACE FUNCTION public.builder_itc_reversal_approve(p_working_id uuid, p_actor_id uuid, p_lines jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w   record;
  l   jsonb;
  v_id uuid;
  v_ids uuid[] := '{}';
BEGIN
  IF (SELECT role::text FROM public.user_roles WHERE user_id = p_actor_id LIMIT 1) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can approve an ITC reversal.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO w FROM public.builder_itc_reversal_workings WHERE id = p_working_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Working not found.' USING ERRCODE = 'no_data_found'; END IF;
  IF w.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Only a submitted working can be approved (this one is %).', lower(w.status) USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.filing_status fs
              WHERE fs.client_id = w.client_id AND fs.period_month = w.posting_period
                AND fs.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') AND fs.status::text = 'Filed') THEN
    RAISE EXCEPTION 'GSTR-3B for % is already filed — choose a later period for the reversal.', w.posting_period
      USING ERRCODE = 'check_violation';
  END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    IF l->>'table_ref' NOT IN ('4B(1)', '4A(5)') THEN
      RAISE EXCEPTION 'Unexpected GSTR-3B table %.', l->>'table_ref' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.gstr3b_adjustments
      (client_id, period_month, table_ref, label, source, taxable_value, igst, cgst, sgst, cess, reason, created_by)
    VALUES (w.client_id, w.posting_period, l->>'table_ref', l->>'label', 'Builder ITC reversal (Rule 42/43)', 0,
            COALESCE((l->>'igst')::numeric, 0), COALESCE((l->>'cgst')::numeric, 0),
            COALESCE((l->>'sgst')::numeric, 0), COALESCE((l->>'cess')::numeric, 0),
            l->>'reason', p_actor_id)
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;

  UPDATE public.builder_itc_reversal_workings
     SET status = 'APPROVED', approved_by = p_actor_id, approved_at = now(),
         adjustment_ids = v_ids, updated_at = now()
   WHERE id = p_working_id;
  RETURN v_ids;
END;
$$;

-- Withdraw an approval (superadmin only, return not yet filed): the GSTR-3B
-- rows go, the working returns to draft.
CREATE OR REPLACE FUNCTION public.builder_itc_reversal_withdraw(p_working_id uuid, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE w record;
BEGIN
  SELECT * INTO w FROM public.builder_itc_reversal_workings WHERE id = p_working_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Working not found.' USING ERRCODE = 'no_data_found'; END IF;
  IF w.status = 'APPROVED' THEN
    IF (SELECT role::text FROM public.user_roles WHERE user_id = p_actor_id LIMIT 1) IS DISTINCT FROM 'superadmin' THEN
      RAISE EXCEPTION 'Only the superadmin can withdraw an approved ITC reversal.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF EXISTS (SELECT 1 FROM public.filing_status fs
                WHERE fs.client_id = w.client_id AND fs.period_month = w.posting_period
                  AND fs.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') AND fs.status::text = 'Filed') THEN
      RAISE EXCEPTION 'GSTR-3B for % is filed with this reversal in it; it cannot be withdrawn.', w.posting_period
        USING ERRCODE = 'check_violation';
    END IF;
    PERFORM set_config('app.itc_reversal', 'on', true);
    DELETE FROM public.gstr3b_adjustments WHERE id = ANY (w.adjustment_ids);
    PERFORM set_config('app.itc_reversal', 'off', true);
  END IF;
  UPDATE public.builder_itc_reversal_workings
     SET status = 'DRAFT', approved_by = NULL, approved_at = NULL, submitted_by = NULL, submitted_at = NULL,
         adjustment_ids = '{}', result = NULL, updated_at = now()
   WHERE id = p_working_id;
END;
$$;

-- The GSTR-3B rows an approval wrote change only through withdraw.
CREATE OR REPLACE FUNCTION public.gstr3b_adjustments_builder_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.source = 'Builder ITC reversal (Rule 42/43)'
     AND COALESCE(current_setting('app.itc_reversal', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'This GSTR-3B row comes from an approved Builder ITC reversal; withdraw the approval on Builder › ITC Reversal instead.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_gstr3b_adjustments_builder_guard ON public.gstr3b_adjustments;
CREATE TRIGGER trg_gstr3b_adjustments_builder_guard
  BEFORE UPDATE OR DELETE ON public.gstr3b_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.gstr3b_adjustments_builder_guard();

GRANT EXECUTE ON FUNCTION public.builder_itc_reversal_approve(uuid, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_itc_reversal_withdraw(uuid, uuid) TO anon, authenticated, service_role;

COMMIT;
