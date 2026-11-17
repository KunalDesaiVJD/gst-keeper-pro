-- Suspended Reco for a No-ITC promoter (Builder + builder_itc_type NO_ITC),
-- 17 Nov 2026 (docs/2B_RECONCILIATION_FLOW.md §8).
--
-- 1. The current total follows ITC Summary, not the Not in 2B list. A No-ITC
--    promoter's GSTR-3B reverses all of 4A at 4B(1); 4B(2)(i), (ii), (iii) are
--    saved as 0, so the portal's suspended balance never takes the Not in 2B
--    list's reversals. Since Import 2B posts Not in 2B entries with a reversal
--    month (20261021170000), the old formula counted them as if reversed into
--    the suspended balance, giving a difference that could never close.
-- 2. The closing balance as per books may be typed on the page (books_*),
--    as before Import 2B posted the list; until one is typed it is the Not in
--    2B list, as for every client. Ordinary clients are unchanged.
--
-- The push gate keeps waiving the Suspended Reco difference for these clients
-- (gstr3b_push_gate, v_noitc); the pull is still required.
-- Undo: ALTER TABLE public.suspended_reco DROP COLUMN books_cgst, DROP COLUMN
-- books_sgst, DROP COLUMN books_igst; re-create suspended_reco_difference
-- from 20261021120000; SELECT public.gst_change_log_attach('suspended_reco').

ALTER TABLE public.suspended_reco ADD COLUMN IF NOT EXISTS books_cgst numeric;
ALTER TABLE public.suspended_reco ADD COLUMN IF NOT EXISTS books_sgst numeric;
ALTER TABLE public.suspended_reco ADD COLUMN IF NOT EXISTS books_igst numeric;

COMMENT ON COLUMN public.suspended_reco.books_cgst IS
  'No-ITC promoter only: the closing balance as per books typed on Suspended Reco (NULL = the Not in 2B list).';

-- Typed books only for a No-ITC promoter: anyone else's books side is the Not
-- in 2B list, so a typed figure there would be one the page never shows.
CREATE OR REPLACE FUNCTION public.suspended_reco_books_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.books_cgst IS NOT NULL OR NEW.books_sgst IS NOT NULL OR NEW.books_igst IS NOT NULL)
     AND (TG_OP = 'INSERT' OR NEW.books_cgst IS DISTINCT FROM OLD.books_cgst
          OR NEW.books_sgst IS DISTINCT FROM OLD.books_sgst OR NEW.books_igst IS DISTINCT FROM OLD.books_igst)
     AND NOT EXISTS (SELECT 1 FROM public.clients
                      WHERE id = NEW.client_id AND regular_sub_type = 'Builder' AND builder_itc_type = 'NO_ITC') THEN
    RAISE EXCEPTION 'The closing balance as per books is typed only for a No-ITC builder; for this client it comes from the Not in 2B list.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suspended_reco_books_guard ON public.suspended_reco;
CREATE TRIGGER trg_suspended_reco_books_guard
  BEFORE INSERT OR UPDATE ON public.suspended_reco
  FOR EACH ROW EXECUTE FUNCTION public.suspended_reco_books_guard();

CREATE OR REPLACE FUNCTION public.suspended_reco_difference(p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$

DECLARE
  v_key integer := public.reco_period_key(p_period);
  v_new boolean;
  o_c numeric := 0; o_s numeric := 0; o_i numeric := 0;
  rv_c numeric; rv_s numeric; rv_i numeric;
  rn_c numeric; rn_s numeric; rn_i numeric;
  rx_c numeric; rx_s numeric; rx_i numeric;
  b_c numeric; b_s numeric; b_i numeric;
  v_itc jsonb;
  f4b jsonb; f55 jsonb; f4d jsonb;
  ii_c numeric := 0; ii_s numeric := 0; ii_i numeric := 0;
  r55_c numeric := 0; r55_s numeric := 0; r55_i numeric := 0;
  d_c numeric := 0; d_s numeric := 0; d_i numeric := 0;
  p_c numeric; p_s numeric; p_i numeric;
  x_c numeric; x_s numeric; x_i numeric;
  v_row boolean;
  ff record;
  v_noitc boolean := false;
  r4i_c numeric := 0; r4i_s numeric := 0; r4i_i numeric := 0;
  r54_c numeric := 0; r54_s numeric := 0; r54_i numeric := 0;
  f4i jsonb; f54 jsonb;
  tb_c numeric; tb_s numeric; tb_i numeric;
BEGIN
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'The month must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_new := v_key >= 202606;
  SELECT coalesce(opening_cgst, 0), coalesce(opening_sgst, 0), coalesce(opening_igst, 0), true,
         books_cgst, books_sgst, books_igst
    INTO o_c, o_s, o_i, v_row, tb_c, tb_s, tb_i
    FROM public.suspended_reco WHERE client_id = p_client_id AND period_month = p_period;
  o_c := coalesce(o_c, 0); o_s := coalesce(o_s, 0); o_i := coalesce(o_i, 0);
  -- A No-ITC promoter (Builder + NO_ITC, 20261117100000): see below.
  SELECT coalesce(regular_sub_type = 'Builder' AND builder_itc_type = 'NO_ITC', false)
    INTO v_noitc FROM public.clients WHERE id = p_client_id;
  v_noitc := coalesce(v_noitc, false);

  SELECT coalesce(sum(input_cgst), 0), coalesce(sum(input_sgst), 0), coalesce(sum(input_igst), 0)
    INTO rv_c, rv_s, rv_i
    FROM public.bills_not_in_2b
   WHERE client_id = p_client_id AND period_month = p_period AND reversal_month IS NOT NULL
     AND public.reco_month_matches(reversal_month, p_period);

  SELECT coalesce(sum(input_cgst) FILTER (WHERE reclaim_subtype IS DISTINCT FROM 'EXPENSE_OUT'), 0),
         coalesce(sum(input_sgst) FILTER (WHERE reclaim_subtype IS DISTINCT FROM 'EXPENSE_OUT'), 0),
         coalesce(sum(input_igst) FILTER (WHERE reclaim_subtype IS DISTINCT FROM 'EXPENSE_OUT'), 0),
         coalesce(sum(input_cgst) FILTER (WHERE reclaim_subtype = 'EXPENSE_OUT'), 0),
         coalesce(sum(input_sgst) FILTER (WHERE reclaim_subtype = 'EXPENSE_OUT'), 0),
         coalesce(sum(input_igst) FILTER (WHERE reclaim_subtype = 'EXPENSE_OUT'), 0)
    INTO rn_c, rn_s, rn_i, rx_c, rx_s, rx_i
    FROM public.bills_not_in_2b
   WHERE client_id = p_client_id AND period_month = p_period AND reclaim_month IS NOT NULL
     AND public.reco_month_matches(reclaim_month, p_period);

  -- A prior month changed after filing (20261021100000, docs §13): its
  -- 4B(2)(i), 5.4 and 4(D) 1.2 as recorded just before its first change
  -- (twob_filed_figures), as src/lib/suspendedRecoCalc.ts reads them; only
  -- the books side follows the books. Without 20261021100000 there are no
  -- recorded figures and the live list is the month's figure, as before.
  IF to_regclass('public.twob_filed_figures') IS NOT NULL THEN
    SELECT * INTO ff FROM public.twob_filed_figures WHERE client_id = p_client_id AND period_month = p_period;
    IF FOUND THEN
      rv_c := coalesce(ff.reversal_cgst, 0); rv_s := coalesce(ff.reversal_sgst, 0); rv_i := coalesce(ff.reversal_igst, 0);
      rn_c := coalesce(ff.reclaim_cgst, 0); rn_s := coalesce(ff.reclaim_sgst, 0); rn_i := coalesce(ff.reclaim_igst, 0);
      rx_c := coalesce(ff.expense_out_cgst, 0); rx_s := coalesce(ff.expense_out_sgst, 0); rx_i := coalesce(ff.expense_out_igst, 0);
    END IF;
  END IF;

  SELECT data INTO v_itc FROM public.itc_summaries WHERE client_id = p_client_id AND period_month = p_period;
  IF public.reco_truthy(v_itc) THEN
    SELECT e INTO f4b FROM jsonb_array_elements(public.reco_arr(v_itc->'section4B')) WITH ORDINALITY AS t(e, i)
     WHERE (jsonb_typeof(e->'srNo') = 'string' AND e->>'srNo' IN ('(ii)', '4(B)(2)(ii)'))
        OR (jsonb_typeof(e->'particular') = 'string' AND position('ITC Reversal for previous months' IN e->>'particular') > 0)
     ORDER BY i LIMIT 1;
    IF f4b IS NOT NULL THEN
      ii_c := public.reco_num(f4b->'cgst'); ii_s := public.reco_num(f4b->'sgst'); ii_i := public.reco_num(f4b->'igst');
    END IF;
    f55 := public.reco_find_sr(v_itc->'section4A', '5.5');
    IF f55 IS NOT NULL THEN
      r55_c := public.reco_num(f55->'cgst'); r55_s := public.reco_num(f55->'sgst'); r55_i := public.reco_num(f55->'igst');
    END IF;
    f4d := public.reco_find_sr(v_itc->'section4D', '1.2');
    d_c := public.reco_num(f4d->'cgst'); d_s := public.reco_num(f4d->'sgst'); d_i := public.reco_num(f4d->'igst');
  END IF;

  p_c := rv_c + ii_c - rn_c - r55_c - greatest(rx_c, d_c);
  p_s := rv_s + ii_s - rn_s - r55_s - greatest(rx_s, d_s);
  p_i := rv_i + ii_i - rn_i - r55_i - greatest(rx_i, d_i);

  -- No-ITC promoter: the GSTR-3B carries no 4B(2) (ITC Summary reverses all
  -- of 4A at 4B(1) and saves (i), (ii), (iii) as 0), so the portal's
  -- suspended balance moves only by what that ITC Summary says. The current
  -- total is ITC Summary's own (4B(2)(i) + 4B(2)(ii)) - (5.4 + 5.5 + 4(D) 1.2),
  -- never the Not in 2B list's reversal and reclaim months.
  IF v_noitc THEN
    p_c := 0; p_s := 0; p_i := 0;
    IF public.reco_truthy(v_itc) THEN
      SELECT e INTO f4i FROM jsonb_array_elements(public.reco_arr(v_itc->'section4B')) WITH ORDINALITY AS t(e, i)
       WHERE (jsonb_typeof(e->'srNo') = 'string' AND e->>'srNo' IN ('(i)', '4(B)(2)(i)'))
       ORDER BY i LIMIT 1;
      IF f4i IS NOT NULL THEN
        r4i_c := public.reco_num(f4i->'cgst'); r4i_s := public.reco_num(f4i->'sgst'); r4i_i := public.reco_num(f4i->'igst');
      END IF;
      f54 := public.reco_find_sr(v_itc->'section4A', '5.4');
      IF f54 IS NOT NULL THEN
        r54_c := public.reco_num(f54->'cgst'); r54_s := public.reco_num(f54->'sgst'); r54_i := public.reco_num(f54->'igst');
      END IF;
      p_c := r4i_c + ii_c - r54_c - r55_c - d_c;
      p_s := r4i_s + ii_s - r54_s - r55_s - d_s;
      p_i := r4i_i + ii_i - r54_i - r55_i - d_i;
    END IF;
  END IF;

  SELECT coalesce(sum(input_cgst), 0), coalesce(sum(input_sgst), 0), coalesce(sum(input_igst), 0)
    INTO b_c, b_s, b_i
    FROM public.bills_not_in_2b
   WHERE client_id = p_client_id AND period_month = p_period
     AND coalesce(reclaim_month, '') = '' AND coalesce(reversal_month, '') <> '';

  -- No-ITC promoter: the books closing is the figure typed on the page, when
  -- one is typed (books_*); else the Not in 2B list, as for every client.
  IF v_noitc AND (tb_c IS NOT NULL OR tb_s IS NOT NULL OR tb_i IS NOT NULL) THEN
    b_c := coalesce(tb_c, 0); b_s := coalesce(tb_s, 0); b_i := coalesce(tb_i, 0);
  END IF;

  x_c := public.reco_round2(o_c + p_c - b_c);
  x_s := public.reco_round2(o_s + p_s - b_s);
  x_i := public.reco_round2(o_i + p_i - b_i);
  IF v_new THEN
    x_c := public.reco_tol(x_c); x_s := public.reco_tol(x_s); x_i := public.reco_tol(x_i);
  END IF;
  RETURN jsonb_build_object(
    'row', coalesce(v_row, false),
    'opening', jsonb_build_object('cgst', o_c, 'sgst', o_s, 'igst', o_i),
    'portal', jsonb_build_object('cgst', p_c, 'sgst', p_s, 'igst', p_i),
    'books', jsonb_build_object('cgst', b_c, 'sgst', b_s, 'igst', b_i),
    'no_itc', v_noitc,
    'cgst', x_c, 'sgst', x_s, 'igst', x_i,
    'total', public.reco_round2(x_c + x_s + x_i));
END;

$$;

GRANT EXECUTE ON FUNCTION public.suspended_reco_difference(uuid, text) TO anon, authenticated, service_role;

-- New columns on a logged table: attach it again so they are logged.
SELECT public.gst_change_log_attach('suspended_reco');
