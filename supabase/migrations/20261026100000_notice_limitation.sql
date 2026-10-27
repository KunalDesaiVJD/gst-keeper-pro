-- Notices & Litigation, the law audit of 26 October 2026 (L1, L4, L15, and the
-- rule rows the other fixes read). Additive: new tables and functions, new
-- litigation_rules rows, and add_working_days now skipping holidays.
--
-- L1. Time limits for an order and its show cause notice, per financial year:
--   s.73(10): 3 years from the due date of the year's annual return, the SCN at
--             least 3 months before (s.73(2)); for FY 2017-18 to 2019-20 the
--             order dates set under s.168A (N. 9/2023-CT and 56/2023-CT; their
--             validity is before the courts);
--   s.74(10): 5 years, the SCN at least 6 months before (s.74(2));
--   s.74A   : FY 2024-25 onwards, SCN within 42 months of the due date
--             (s.74A(2)), the order within 12 months of the SCN, extendable by
--             6 (s.74A(7)).
-- Every row is unconfirmed until a partner confirms it (Notices · Law rules).

CREATE TABLE IF NOT EXISTS public.gst_limitation_years (
  fy                 text PRIMARY KEY,                 -- '2019-20'
  fy_start           int  NOT NULL UNIQUE,
  annual_return_due  date NOT NULL,
  annual_return_note text,
  s73_order_by       date,                             -- NULL from FY 2024-25 (s.74A)
  s73_basis          text,
  s74_order_by       date,
  s74a_scn_by        date,
  confirmed_at       timestamptz,
  confirmed_by       text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gst_limitation_years ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gst_limitation_years') THEN
    CREATE POLICY gst_limitation_years_all ON public.gst_limitation_years FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;
COMMENT ON TABLE public.gst_limitation_years IS
  'Per financial year: the annual return due date and the last dates for an order under s.73(10) (s.168A where notified) and s.74(10), and for an SCN under s.74A(2). Read by notice_limitation(); confirmed by a partner.';

INSERT INTO public.gst_limitation_years (fy, fy_start, annual_return_due, annual_return_note, s73_order_by, s73_basis, s74_order_by, s74a_scn_by) VALUES
  ('2017-18', 2017, '2020-02-05', 'GSTR-9 due 3, 5 or 7 Feb 2020 by state group (N. 6/2020-CT)', '2023-12-31', 's.168A, N. 9/2023-CT', '2025-02-05', NULL),
  ('2018-19', 2018, '2020-12-31', 'GSTR-9 due date extended to 31 Dec 2020', '2024-04-30', 's.168A, N. 56/2023-CT', '2025-12-31', NULL),
  ('2019-20', 2019, '2021-03-31', 'GSTR-9 due date extended to 31 Mar 2021', '2024-08-31', 's.168A, N. 56/2023-CT', '2026-03-31', NULL),
  ('2020-21', 2020, '2022-02-28', 'GSTR-9 due date extended to 28 Feb 2022', '2025-02-28', 's.73(10)', '2027-02-28', NULL),
  ('2021-22', 2021, '2022-12-31', NULL, '2025-12-31', 's.73(10)', '2027-12-31', NULL),
  ('2022-23', 2022, '2023-12-31', NULL, '2026-12-31', 's.73(10)', '2028-12-31', NULL),
  ('2023-24', 2023, '2024-12-31', NULL, '2027-12-31', 's.73(10)', '2029-12-31', NULL),
  ('2024-25', 2024, '2025-12-31', 's.74A applies from FY 2024-25', NULL, NULL, NULL, '2029-06-30'),
  ('2025-26', 2025, '2026-12-31', 's.74A applies from FY 2024-25', NULL, NULL, NULL, '2030-06-30')
ON CONFLICT (fy) DO NOTHING;

-- The rule rows the fixes of this audit read (L2, L3, L4, L6, L7, L10).
INSERT INTO public.litigation_rules (key, value, unit, effective_from, note) VALUES
  ('predeposit_cap_cr.s107', 20, 'crore', '2024-11-01', 'First appeal pre-deposit cap per Act, CGST or SGST (s.107(6)(b)); IGST twice this; 25 crore before 1 Nov 2024'),
  ('predeposit_cap_cr.s112', 20, 'crore', '2024-11-01', 'Tribunal pre-deposit cap per Act, CGST or SGST (s.112(8)(b)); IGST twice this; 50 crore before 1 Nov 2024'),
  ('predeposit_pct.penalty_only', 10, 'percent', '2025-10-01', 'Penalty-only order: 10% of the penalty (provisos to s.107(6) and s.112(8), Finance Act 2025); courts hold it does not reach earlier SCNs'),
  ('scn_months.s74a', 42, 'months', '2024-04-01', 'SCN under s.74A within 42 months of the annual return due date (s.74A(2))'),
  ('order_months.s74a', 12, 'months', '2024-04-01', 'Order under s.74A within 12 months of the SCN (s.74A(7))'),
  ('order_ext_months.s74a', 6, 'months', '2024-04-01', 'Extension of the s.74A order time by up to 6 months (proviso to s.74A(7))'),
  ('withdrawal_days.s62', 60, 'days', '2023-10-01', 'Return filed within 60 days of an ASMT-13: the best judgment order is deemed withdrawn (s.62(2))'),
  ('withdrawal_ext_days.s62', 60, 'days', '2023-10-01', 'A further 60 days with additional late fee (proviso to s.62(2))'),
  ('revocation_ext_days.reg21', 180, 'days', '2023-10-01', 'Revocation time extendable by up to 180 days (proviso to rule 23(1))'),
  ('condonation_months.s112', 3, 'months', NULL, 'Tribunal: delay of up to 3 months condonable (s.112(6))')
ON CONFLICT (key) DO NOTHING;

UPDATE public.litigation_rules
   SET note = 'Tribunal pre-deposit: 10% of the remaining tax in dispute (s.112(8), from 1 Nov 2024; 20% before)',
       effective_from = coalesce(effective_from, '2024-11-01')
 WHERE key = 'predeposit_pct.s112' AND confirmed_at IS NULL;

-- A rule's value, NULL when the row is missing.
CREATE OR REPLACE FUNCTION public.litigation_rule_value(p_key text)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT lr.value FROM public.litigation_rules lr WHERE lr.key = p_key
$$;

-- The FY a text names, as its first year ('2019-20', 'FY 2019/20' → 2019).
CREATE OR REPLACE FUNCTION public.notice_fy_start(p text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p ~ '(19|20)\d{2}' THEN substring(p FROM '((?:19|20)\d{2})')::int END
$$;

-- The time limits of a year's proceedings under a section ('73', '74',
-- '74A', or NULL when the notice does not say).
CREATE OR REPLACE FUNCTION public.notice_limitation(p_fy text, p_section text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  y public.gst_limitation_years;
  v_sec text := upper(substring(coalesce(p_section, '') FROM '^\s*(?:s(?:ec(?:tion)?)?\.?\s*)?(74\s*A|73|74)'));
BEGIN
  SELECT * INTO y FROM public.gst_limitation_years l WHERE l.fy_start = public.notice_fy_start(p_fy);
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_sec := replace(v_sec, ' ', '');
  IF y.fy_start >= 2024 THEN
    RETURN jsonb_build_object('fy', y.fy, 'regime', '74A', 'annual_return_due', y.annual_return_due,
      'scn_by', y.s74a_scn_by, 'scn_law', 's.74A(2)', 'order_months', public.litigation_rule_value('order_months.s74a'),
      'order_law', 's.74A(7)', 'confirmed', y.confirmed_at IS NOT NULL);
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object('fy', y.fy, 'regime', coalesce(nullif(v_sec, '74A'), 'unknown'),
    'annual_return_due', y.annual_return_due,
    's73_order_by', y.s73_order_by, 's73_scn_by', (y.s73_order_by - interval '3 months')::date, 's73_basis', y.s73_basis,
    's74_order_by', y.s74_order_by, 's74_scn_by', (y.s74_order_by - interval '6 months')::date,
    'confirmed', y.confirmed_at IS NOT NULL));
END;
$$;
COMMENT ON FUNCTION public.notice_limitation(text, text) IS
  'L1 (26 Oct 2026): the last dates for an SCN and an order of a financial year under s.73, s.74 or s.74A, from gst_limitation_years.';

-- L15. Holidays in the working-day clocks (REG-03, REG-17, REG-23). The fixed
-- national holidays are seeded; the firm adds the movable and state ones in
-- Notices · Settings. A holiday switched off is kept (is_active false).
CREATE TABLE IF NOT EXISTS public.gst_holidays (
  day        date PRIMARY KEY,
  name       text NOT NULL,
  scope      text NOT NULL DEFAULT 'national',
  is_active  boolean NOT NULL DEFAULT true,
  added_by   text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gst_holidays ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gst_holidays') THEN
    CREATE POLICY gst_holidays_all ON public.gst_holidays FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;
INSERT INTO public.gst_holidays (day, name, scope, added_by)
SELECT make_date(y, m, d), n, 'national', 'Seed 20261026100000'
  FROM generate_series(2025, 2028) y
 CROSS JOIN (VALUES (1, 26, 'Republic Day'), (8, 15, 'Independence Day'), (10, 2, 'Gandhi Jayanti'), (12, 25, 'Christmas')) h(m, d, n)
ON CONFLICT (day) DO NOTHING;

CREATE OR REPLACE FUNCTION public.add_working_days(p_from date, p_days integer)
RETURNS date LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  d date := p_from;
  n int := 0;
BEGIN
  IF p_from IS NULL OR p_days IS NULL THEN RETURN NULL; END IF;
  WHILE n < p_days LOOP
    d := d + 1;
    -- Sundays and the holidays the firm keeps (20261026100000).
    IF extract(isodow FROM d) <> 7
       AND NOT EXISTS (SELECT 1 FROM public.gst_holidays h WHERE h.day = d AND h.is_active) THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION public.gst_holiday_set(p_day date, p_name text, p_active boolean, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_day IS NULL OR nullif(btrim(coalesce(p_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('error', 'Give the date and the name of the holiday.');
  END IF;
  INSERT INTO public.gst_holidays (day, name, scope, is_active, added_by)
  VALUES (p_day, left(btrim(p_name), 120), 'firm', coalesce(p_active, true), left(p_actor, 120))
  ON CONFLICT (day) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active,
                                  added_by = EXCLUDED.added_by, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.gst_holiday_set(date, text, boolean, text) TO anon, authenticated, service_role;
