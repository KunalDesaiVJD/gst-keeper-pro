-- Annual Return: fewer self-validation questions (Kunal, 26 Nov 2026).
--
-- "Only ask those questions which are really relevant and which can prevent
-- filing a wrong GSTR-9/9C." src/lib/gstr9/selfCheck.ts now asks:
--   always:            books_agree, itc_ineligible, hsn
--   only when needed:  portal_fetched (portal figures missing), rcm_paid (RCM
--                      in the year), late_fee (due date passed), tax_paid (a
--                      payable not yet set off), gstr9c_liability_paid,
--                      gstr9c_signatory (GSTR-9C filed)
--   no longer asked:   gstr9_tables, gstr9c_reasons
-- The questions are put only to the preparer before Mark prepared; the
-- verifier and the final review see the answers, never the questions.
--
-- This replaces annual_return_selfcheck_problem only (annual_return_signoff of
-- 20261125100000 is unchanged): the core list shrinks to the three questions
-- asked of every working, and the Yes/No-only list takes the conditional
-- questions as they are now worded. Everything else is as before.
-- Idempotent (CREATE OR REPLACE); safe to run more than once.

BEGIN;

CREATE OR REPLACE FUNCTION public.annual_return_selfcheck_problem(p_client_id uuid, p_financial_year text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Asked of every working (SELF_CHECK_CORE in selfCheck.ts).
  c_core constant text[] := ARRAY['books_agree', 'itc_ineligible', 'hsn'];
  -- Questions that take Yes or No only.
  c_no_na constant text[] := ARRAY['portal_fetched', 'books_agree', 'rcm_paid', 'late_fee', 'tax_paid', 'gstr9c_liability_paid', 'gstr9c_signatory'];
  v_data jsonb;
  v_sub jsonb;
  v_keys text[];
  v_key text;
  v_ans jsonb;
  v_missing text[] := ARRAY[]::text[];
  v_bad text[] := ARRAY[]::text[];
BEGIN
  SELECT data INTO v_data FROM public.annual_return_docs
   WHERE client_id = p_client_id AND financial_year = p_financial_year AND doc_key = 'selfcheck';
  v_sub := v_data -> 'submitted';
  IF v_data IS NULL OR v_sub IS NULL OR jsonb_typeof(v_sub) <> 'object' THEN
    RETURN 'answer the self-validation before marking it prepared (reload the page if this app is out of date).';
  END IF;
  IF COALESCE((v_sub ->> 'open')::numeric, 1) <> 0 THEN
    RETURN 'a difference is still open — give it a reason (and a GSTR-9C difference its reasons in the form) first.';
  END IF;
  IF COALESCE((v_sub ->> 'jsonErrors')::numeric, 1) <> 0 THEN
    RETURN 'the GSTR-9C portal JSON still has errors — clear them on its Portal JSON tab first.';
  END IF;
  v_keys := c_core;
  IF jsonb_typeof(v_sub -> 'required') = 'array' THEN
    SELECT array_agg(DISTINCT k) INTO v_keys
      FROM (SELECT unnest(c_core) AS k UNION SELECT jsonb_array_elements_text(v_sub -> 'required')) x;
  END IF;
  FOREACH v_key IN ARRAY v_keys LOOP
    v_ans := v_data -> 'answers' -> v_key;
    IF v_ans IS NULL OR jsonb_typeof(v_ans) <> 'object' OR COALESCE(v_ans ->> 'answer', '') NOT IN ('yes', 'no', 'na') THEN
      v_missing := v_missing || v_key;
    ELSIF v_ans ->> 'answer' = 'na' AND v_key = ANY (c_no_na) THEN
      v_bad := v_bad || v_key;
    ELSIF v_ans ->> 'answer' = 'no' AND length(btrim(COALESCE(v_ans ->> 'note', ''))) < 5 THEN
      v_bad := v_bad || v_key;
    END IF;
  END LOOP;
  IF array_length(v_missing, 1) > 0 THEN
    RETURN array_length(v_missing, 1) || ' self-validation question' || CASE WHEN array_length(v_missing, 1) = 1 THEN ' is' ELSE 's are' END
      || ' not answered (' || array_to_string(v_missing, ', ') || ').';
  END IF;
  IF array_length(v_bad, 1) > 0 THEN
    RETURN 'answer ' || array_to_string(v_bad, ', ') || ' properly: a No needs a remark, and these questions take Yes or No.';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.annual_return_selfcheck_problem(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.annual_return_selfcheck_problem(uuid, text) TO anon, authenticated;

COMMIT;
