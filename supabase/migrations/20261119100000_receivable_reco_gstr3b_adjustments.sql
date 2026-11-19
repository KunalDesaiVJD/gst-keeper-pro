-- GST Receivable Reco: count M-1's GSTR-3B Adjustments in Table 4.
--
-- GSTR-3B folds gstr3b_adjustments rows tagged 4A(5) / 4B(1) into Table 4 on
-- top of ITC Summary (src/utils/buildGstr3bJson.ts). The Builder ITC reversal
-- at completion (Rule 42/43, builder_itc_reversal_workings) is posted as such
-- a 4B(1) row, never into itc_summaries.data. gst_receivable_reco_difference
-- read Net ITC (4C) from ITC Summary alone, so the month after a BU reversal
-- carried the whole of M-1's 4A as credit, a difference the push gate refused
-- (BAPA SITARAM DEVELOPERS, 09/2026 reversal, 10/2026 GSTR-3B).
--
-- Also: a head whose 4C is negative credits 0 (the portal adds the negative
-- to the liability, which the pulled set-off debit already holds).
-- Mirrored by src/lib/gstReceivableRecoCalc.ts and GstReceivableRecoPage.tsx
-- (src/lib/gstr3bTable4Adjustments.ts). Only the function body changes.

CREATE OR REPLACE FUNCTION public.gst_receivable_reco_difference(p_client_id uuid, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  ja_c numeric := 0; ja_s numeric := 0; ja_i numeric := 0;
  jb_c numeric := 0; jb_s numeric := 0; jb_i numeric := 0;
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
    -- M-1's GSTR-3B Adjustments in Table 4 (20261119100000): GSTR-3B adds
    -- 4A(5) rows to All other ITC (before a Partial-ITC apportionment) and
    -- 4B(1) rows to the Rule 38/42/43 reversal (none for a No-ITC builder,
    -- whose 4B(1) is the whole of 4A), on top of ITC Summary. The Builder ITC
    -- reversal at completion is posted this way; as gstReceivableRecoCalc.ts.
    SELECT coalesce(sum(igst) FILTER (WHERE table_ref = '4A(5)'), 0),
           coalesce(sum(cgst) FILTER (WHERE table_ref = '4A(5)'), 0),
           coalesce(sum(sgst) FILTER (WHERE table_ref = '4A(5)'), 0),
           coalesce(sum(igst) FILTER (WHERE table_ref = '4B(1)'), 0),
           coalesce(sum(cgst) FILTER (WHERE table_ref = '4B(1)'), 0),
           coalesce(sum(sgst) FILTER (WHERE table_ref = '4B(1)'), 0)
      INTO ja_i, ja_c, ja_s, jb_i, jb_c, jb_s
      FROM public.gstr3b_adjustments
     WHERE client_id = p_client_id AND period_month = v_prev;
    t4a_c := r14_c + t5_c + ja_c; t4a_s := r14_s + t5_s + ja_s; t4a_i := r14_i + t5_i + ja_i;

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
      IF NOT v_noitc THEN
        r1_c := r1_c + jb_c; r1_s := r1_s + jb_s; r1_i := r1_i + jb_i;
      END IF;
      t4b_c := r1_c + r2_c; t4b_s := r1_s + r2_s; t4b_i := r1_i + r2_i;
    ELSE
      t4b_c := jb_c; t4b_s := jb_s; t4b_i := jb_i;
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
    -- A head whose Net ITC (4C) is negative credits nothing to the ledger: the
    -- portal adds the negative to that head's liability (Table 6.1) and the
    -- ledger's set-off debit (utilised) pays it, so it is not taken off twice.
    av_c := greatest(0, av_c); av_s := greatest(0, av_s); av_i := greatest(0, av_i);
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
$function$;
