-- ─────────────────────────────────────────────────────────────────────────
-- BUILDER: TDR/FSI reverse charge, the 3.1(d) value and the commercial credit
-- (25 Oct 2026, docs/BUILDER_GST_POSITIONS.md §12)
--
-- 1. VALUE. builder_rcm_postings.taxable_value was total_rcm / 18%. Where the
--    1% / 5% cap cuts the residential leg's tax, that value understated the
--    supply (FSI portion ₹1 crore, tax capped at ₹5 lakh, value shown ₹27.78
--    lakh). The value is now the portions themselves: the unbooked
--    residential portion plus the commercial portion. The tax is unchanged.
--
-- 2. CREDIT. The residential leg's credit is never available (the 1% / 5%
--    scheme forgoes it). The commercial leg's is, where the commercial
--    apartments are taxed at 12% with credit: a REP other than an RREP
--    (commercial carpet over 15%), for a Claim-ITC or Partial-ITC client.
--    itc_cgst / itc_sgst carry that credit; GSTR-3B takes it in 4A(3), wholly
--    commercial and so outside the Partial-ITC carpet apportionment, and the
--    GST Receivable reco counts it in M-1's net ITC the same way.
--
-- The RREP test is the app's testRrep (src/utils/builderRates.ts): manual
-- carpet areas when the project says MANUAL, else the carpet of units not
-- cancelled; no area yet counts as an RREP.
-- New columns are appended, so CREATE OR REPLACE VIEW keeps every reader.
-- ─────────────────────────────────────────────────────────────────────────

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
  -- The value of the supply, not the tax worked back at 18%: the cap cuts the
  -- tax, never the value. A working with no portions recorded keeps the old figure.
  CASE WHEN coalesce(w.residential_portion, 0) + coalesce(w.commercial_portion, 0) > 0
       THEN ROUND(coalesce(w.residential_portion, 0) + coalesce(w.commercial_portion, 0), 2)
       ELSE ROUND(w.total_rcm / 0.18, 2) END AS taxable_value,
  w.cgst,
  w.sgst,
  ROUND(coalesce(w.residential_portion, 0), 2) AS residential_value,
  ROUND(coalesce(w.commercial_portion, 0), 2)  AS commercial_value,
  rr.is_rrep              AS project_is_rrep,
  -- Eligible credit: the commercial leg, in a REP other than an RREP, for a
  -- client that claims credit. Never the residential leg.
  CASE WHEN NOT rr.is_rrep AND c.builder_itc_type IN ('CLAIM_ITC', 'PARTIAL_ITC')
       THEN ROUND(coalesce(w.commercial_rcm, 0) / 2, 2) ELSE 0 END AS itc_cgst,
  CASE WHEN NOT rr.is_rrep AND c.builder_itc_type IN ('CLAIM_ITC', 'PARTIAL_ITC')
       THEN ROUND(coalesce(w.commercial_rcm, 0) / 2, 2) ELSE 0 END AS itc_sgst
FROM public.builder_fsi_workings w
JOIN public.builder_projects  p  ON p.id = w.project_id
JOIN public.builder_bu_events ev ON ev.id = w.bu_event_id
JOIN public.clients           c  ON c.id = p.client_id
CROSS JOIN LATERAL (
  SELECT CASE WHEN a.resi + a.comm <= 0 THEN true ELSE a.comm / (a.resi + a.comm) <= 0.15 END AS is_rrep
  FROM (
    SELECT
      CASE WHEN p.carpet_area_source = 'MANUAL' THEN greatest(0, coalesce(p.manual_residential_carpet_sqm, 0))
           ELSE (SELECT coalesce(sum(u.carpet_area_sqm), 0) FROM public.builder_units u
                  WHERE u.project_id = p.id AND u.unit_type = 'Residential' AND u.status <> 'Cancelled') END AS resi,
      CASE WHEN p.carpet_area_source = 'MANUAL' THEN greatest(0, coalesce(p.manual_commercial_carpet_sqm, 0))
           ELSE (SELECT coalesce(sum(u.carpet_area_sqm), 0) FROM public.builder_units u
                  WHERE u.project_id = p.id AND u.unit_type = 'Commercial' AND u.status <> 'Cancelled') END AS comm
  ) a
) rr
WHERE w.status = 'POSTED' AND w.treatment = 'PAY';

COMMENT ON VIEW public.builder_rcm_postings IS
  'Inward reverse charge into 3B Table 3.1(d), valued at the FSI portions. Paid in cash; itc_cgst / itc_sgst are the commercial leg''s credit where it is available (a REP other than an RREP, Claim-ITC or Partial-ITC), else 0.';

GRANT SELECT ON public.builder_rcm_postings TO anon, authenticated;

-- GST Receivable reco: M-1's net ITC counts the FSI commercial credit, as
-- M-1's GSTR-3B claimed it. Otherwise as 20261021120000.
CREATE OR REPLACE FUNCTION public.gst_receivable_reco_difference(p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key integer := public.reco_period_key(p_period);
  v_prev text := public.reco_prev_period(p_period);
  r record;
  v_row boolean := false;
  o_c numeric := 0; o_s numeric := 0; o_i numeric := 0;
  bk_c numeric := 0; bk_s numeric := 0; bk_i numeric := 0;
  dr_c numeric := 0; dr_s numeric := 0; dr_i numeric := 0;
  u_c numeric := 0; u_s numeric := 0; u_i numeric := 0;
  av_c numeric := 0; av_s numeric := 0; av_i numeric := 0;
  v_itc jsonb;
  v_filed boolean;
  rcm_c numeric; rcm_s numeric; rcm_i numeric;
  lr_c numeric; lr_s numeric; lr_i numeric;
  lc_c numeric; lc_s numeric; lc_i numeric;
  rows_a jsonb; rows_b jsonb;
  a51 jsonb; a52 jsonb; a53 jsonb; a55 jsonb;
  t5_c numeric; t5_s numeric; t5_i numeric;
  r14_c numeric := 0; r14_s numeric := 0; r14_i numeric := 0;
  t4a_c numeric; t4a_s numeric; t4a_i numeric;
  t4b_c numeric := 0; t4b_s numeric := 0; t4b_i numeric := 0;
  e jsonb;
  n integer := 0;
  v_type text; v_comm numeric; v_res numeric;
  v_noitc boolean; v_partial boolean; v_ratio numeric;
  adj jsonb; prevrev jsonb;
  ii_c numeric; ii_s numeric; ii_i numeric;
  r2_c numeric; r2_s numeric; r2_i numeric;
  i_c numeric; i_s numeric; i_i numeric;
  iii_c numeric; iii_s numeric; iii_i numeric;
  r1_c numeric; r1_s numeric; r1_i numeric;
  cl_c numeric; cl_s numeric; cl_i numeric;
  ff record;
  fx_c numeric := 0; fx_s numeric := 0;
BEGIN
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'The month must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_key < 202606 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM public.gst_receivable_reco WHERE client_id = p_client_id AND period_month = p_period;
  IF FOUND THEN
    v_row := true;
    o_c := coalesce(r.opening_cgst, 0); o_s := coalesce(r.opening_sgst, 0); o_i := coalesce(r.opening_igst, 0);
    bk_c := coalesce(r.books_closing_cgst, 0); bk_s := coalesce(r.books_closing_sgst, 0); bk_i := coalesce(r.books_closing_igst, 0);
    dr_c := coalesce(r.drc_cgst, 0); dr_s := coalesce(r.drc_sgst, 0); dr_i := coalesce(r.drc_igst, 0);
    u_c := coalesce(r.utilized_cgst, 0); u_s := coalesce(r.utilized_sgst, 0); u_i := coalesce(r.utilized_igst, 0);
  END IF;

  SELECT data INTO v_itc FROM public.itc_summaries WHERE client_id = p_client_id AND period_month = v_prev;
  SELECT EXISTS (SELECT 1 FROM public.filing_status
                  WHERE client_id = p_client_id AND period_month = v_prev
                    AND return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') AND status::text = 'Filed')
    INTO v_filed;

  IF public.reco_truthy(v_itc) AND v_filed THEN
    rows_a := public.reco_arr(v_itc->'section4A');
    rows_b := public.reco_arr(v_itc->'section4B');
    SELECT coalesce(sum(coalesce(cgst_2_5, 0) + coalesce(cgst_9, 0)), 0),
           coalesce(sum(coalesce(sgst_2_5, 0) + coalesce(sgst_9, 0)), 0),
           coalesce(sum(coalesce(igst_5, 0) + coalesce(igst_18, 0)), 0)
      INTO rcm_c, rcm_s, rcm_i
      FROM public.rcm_data WHERE client_id = p_client_id AND month = public.reco_short_month(v_prev);
    SELECT coalesce(sum(coalesce(input_cgst, 0)), 0), coalesce(sum(coalesce(input_sgst, 0)), 0), coalesce(sum(coalesce(input_igst, 0)), 0)
      INTO lr_c, lr_s, lr_i
      FROM public.bills_not_in_2b
     WHERE client_id = p_client_id AND period_month = v_prev AND reversal_month IS NOT NULL
       AND public.reco_month_matches(reversal_month, v_prev);
    SELECT coalesce(sum(coalesce(input_cgst, 0)), 0), coalesce(sum(coalesce(input_sgst, 0)), 0), coalesce(sum(coalesce(input_igst, 0)), 0)
      INTO lc_c, lc_s, lc_i
      FROM public.bills_not_in_2b
     WHERE client_id = p_client_id AND period_month = v_prev AND reclaim_month IS NOT NULL
       AND reclaim_subtype IS DISTINCT FROM 'EXPENSE_OUT'
       AND public.reco_month_matches(reclaim_month, v_prev);
    -- M-1 changed after filing (20261021100000, docs §13): its 4B(2)(i) and
    -- 5.4 as recorded then, not its live lists, as gstReceivableRecoCalc.ts.
    IF to_regclass('public.twob_filed_figures') IS NOT NULL THEN
      SELECT * INTO ff FROM public.twob_filed_figures WHERE client_id = p_client_id AND period_month = v_prev;
      IF FOUND THEN
        lr_c := coalesce(ff.reversal_cgst, 0); lr_s := coalesce(ff.reversal_sgst, 0); lr_i := coalesce(ff.reversal_igst, 0);
        lc_c := coalesce(ff.reclaim_cgst, 0); lc_s := coalesce(ff.reclaim_sgst, 0); lc_i := coalesce(ff.reclaim_igst, 0);
      END IF;
    END IF;

    a51 := public.reco_find_sr(rows_a, '5.1'); a52 := public.reco_find_sr(rows_a, '5.2');
    a53 := public.reco_find_sr(rows_a, '5.3'); a55 := public.reco_find_sr(rows_a, '5.5');
    t5_c := public.reco_num(a51->'cgst') + public.reco_num(a52->'cgst') - public.reco_num(a53->'cgst') + lc_c + public.reco_num(a55->'cgst');
    t5_s := public.reco_num(a51->'sgst') + public.reco_num(a52->'sgst') - public.reco_num(a53->'sgst') + lc_s + public.reco_num(a55->'sgst');
    t5_i := public.reco_num(a51->'igst') + public.reco_num(a52->'igst') - public.reco_num(a53->'igst') + lc_i + public.reco_num(a55->'igst');

    -- Rows (1) to (4): the first four elements, row (3) the live RCM ITC.
    FOR e IN SELECT x FROM jsonb_array_elements(rows_a) WITH ORDINALITY AS t(x, i) ORDER BY i LIMIT 4 LOOP
      IF jsonb_typeof(e->'srNo') = 'string' AND e->>'srNo' = '(3)' THEN
        r14_c := r14_c + rcm_c; r14_s := r14_s + rcm_s; r14_i := r14_i + rcm_i;
      ELSE
        r14_c := r14_c + public.reco_num(e->'cgst'); r14_s := r14_s + public.reco_num(e->'sgst'); r14_i := r14_i + public.reco_num(e->'igst');
      END IF;
    END LOOP;
    t4a_c := r14_c + t5_c; t4a_s := r14_s + t5_s; t4a_i := r14_i + t5_i;

    SELECT builder_itc_type, commercial_area, residential_area INTO v_type, v_comm, v_res
      FROM public.clients WHERE id = p_client_id;
    v_noitc := v_type IS NOT DISTINCT FROM 'NO_ITC';
    v_partial := v_type IS NOT DISTINCT FROM 'PARTIAL_ITC' OR v_noitc;
    IF v_partial THEN
      v_comm := CASE WHEN v_noitc THEN 0 ELSE coalesce(v_comm, 0) END;
      v_res := CASE WHEN v_noitc THEN 1 ELSE coalesce(v_res, 0) END;
      v_ratio := CASE WHEN v_comm + v_res > 0 THEN v_res / (v_comm + v_res) ELSE 0 END;
      adj := public.reco_find_particular(rows_b, 'Previous Month Adjustment');
      ii_c := public.reco_num(adj->'cgst'); ii_s := public.reco_num(adj->'sgst'); ii_i := public.reco_num(adj->'igst');
      prevrev := public.reco_find_particular(rows_b, 'previous months, if any');
      r2_c := lr_c + public.reco_num(prevrev->'cgst'); r2_s := lr_s + public.reco_num(prevrev->'sgst'); r2_i := lr_i + public.reco_num(prevrev->'igst');
      i_c := public.reco_round2(t4a_c * v_ratio); i_s := public.reco_round2(t4a_s * v_ratio); i_i := public.reco_round2(t4a_i * v_ratio);
      iii_c := public.reco_round2(-r2_c * v_ratio); iii_s := public.reco_round2(-r2_s * v_ratio); iii_i := public.reco_round2(-r2_i * v_ratio);
      r1_c := public.reco_round2(i_c + ii_c + iii_c); r1_s := public.reco_round2(i_s + ii_s + iii_s); r1_i := public.reco_round2(i_i + ii_i + iii_i);
      t4b_c := r1_c + r2_c; t4b_s := r1_s + r2_s; t4b_i := r1_i + r2_i;
    ELSE
      FOR e IN SELECT x FROM jsonb_array_elements(rows_b) WITH ORDINALITY AS t(x, i) ORDER BY i LOOP
        CONTINUE WHEN public.reco_truthy(e->'isHeader');
        IF jsonb_typeof(e->'particular') = 'string' AND position('current month as per 2B RECO' IN e->>'particular') > 0 THEN
          t4b_c := t4b_c + lr_c; t4b_s := t4b_s + lr_s; t4b_i := t4b_i + lr_i;
        ELSE
          t4b_c := t4b_c + public.reco_num(e->'cgst'); t4b_s := t4b_s + public.reco_num(e->'sgst'); t4b_i := t4b_i + public.reco_num(e->'igst');
        END IF;
      END LOOP;
    END IF;
    av_c := t4a_c - t4b_c; av_s := t4a_s - t4b_s; av_i := t4a_i - t4b_i;
    -- TDR/FSI reverse charge credit of a commercial leg in a REP other than an
    -- RREP (20261025130000): 4A(3) in M-1's GSTR-3B, wholly commercial, so it
    -- is never carpet-apportioned; as src/lib/gstReceivableRecoCalc.ts.
    SELECT coalesce(sum(itc_cgst), 0), coalesce(sum(itc_sgst), 0) INTO fx_c, fx_s
      FROM public.builder_rcm_postings WHERE client_id = p_client_id AND period_month = v_prev;
    av_c := av_c + fx_c; av_s := av_s + fx_s;
  END IF;

  cl_c := greatest(0, o_c + av_c - u_c - dr_c);
  cl_s := greatest(0, o_s + av_s - u_s - dr_s);
  cl_i := greatest(0, o_i + av_i - u_i - dr_i);
  RETURN jsonb_build_object(
    'row', v_row,
    'opening', jsonb_build_object('cgst', o_c, 'sgst', o_s, 'igst', o_i),
    'availed', jsonb_build_object('cgst', av_c, 'sgst', av_s, 'igst', av_i),
    'utilised', jsonb_build_object('cgst', u_c, 'sgst', u_s, 'igst', u_i),
    'drc', jsonb_build_object('cgst', dr_c, 'sgst', dr_s, 'igst', dr_i),
    'closing', jsonb_build_object('cgst', cl_c, 'sgst', cl_s, 'igst', cl_i),
    'books', jsonb_build_object('cgst', bk_c, 'sgst', bk_s, 'igst', bk_i),
    'prev_return_filed', v_filed,
    'cgst', public.reco_tol(cl_c - bk_c), 'sgst', public.reco_tol(cl_s - bk_s), 'igst', public.reco_tol(cl_i - bk_i),
    'total', public.reco_tol((cl_c + cl_s + cl_i) - (bk_c + bk_s + bk_i)));
END;
$$;

GRANT EXECUTE ON FUNCTION public.gst_receivable_reco_difference(uuid, text) TO anon, authenticated, service_role;
