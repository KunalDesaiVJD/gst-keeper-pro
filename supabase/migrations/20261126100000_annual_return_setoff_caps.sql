-- Annual Return · Payables: caps and locks on recording a set-off (26 Nov 2026).
--
-- add_annual_return_setoff (20260929100000) capped only a set-off against a
-- DRC-03 synced from the portal, and took no lock, so two set-offs recorded at
-- the same moment could each see the DRC-03's full amount. This keeps every
-- existing behaviour (signature, checks, messages, what is stored, the change
-- log row) and adds:
--
--  1. Locks. The synced DRC-03 row is read FOR UPDATE; an uploaded DRC-03 copy
--     (no synced row) takes a transaction advisory lock on its client + ARN;
--     a GSTR-3B effect locks its as-filed GSTR-3B row (gst_filed_returns) FOR
--     UPDATE when there is one, and always an advisory lock on its client +
--     period + table. Two set-offs against the same evidence run one at a time.
--
--  2. A DRC-03 is one payment whichever way it is evidenced. Set-offs against
--     a synced DRC-03 are counted by its id AND by its ARN (an uploaded copy of
--     the same ARN), across every working (every FY) of the client, and an
--     uploaded copy whose ARN matches a synced DRC-03 of the client is capped
--     at that DRC-03's amounts, head by head (₹1 rounding allowed, as before).
--
--  3. An uploaded DRC-03 copy whose ARN is not synced: the system holds no
--     amount for it (the copy is a file; gst_drc03_filings has no row), so no
--     amount cap is possible. What is stored is capped instead: an ARN already
--     on record for another client (synced, or used in its set-offs) is refused.
--     Syncing the DRC-03 brings it under the amount cap of 2.
--
--  4. A GSTR-3B effect is capped at the figure of that table in the as-filed
--     GSTR-3B the extension pulled (gst_filed_returns, return_type GSTR3B,
--     the period's summary JSON), head by head, across every working of the
--     client: the set-offs given against one period's 3.1(a) can never exceed
--     what 3.1(a) carries. This is an upper bound (the table also carries the
--     month's own liability), so it never refuses a genuine effect. Read as the
--     app reads it (src/lib/gstr9/portalParser.ts parseGstr3bSummary):
--     3.1(a) sup_details.osup_det, 3.1(b) osup_zero, 3.1(d) isup_rev,
--     4(B)(1) itc_elg.itc_rev ty RUL, 4(B)(2) itc_rev ty OTH. With no pulled
--     GSTR-3B for the period, or no table named, there is no figure to cap at
--     and the set-off is recorded as before (its copy is the evidence).
--
-- Idempotent (CREATE OR REPLACE, IF NOT EXISTS); one transaction, so it can be
-- pasted into the Supabase SQL editor as it is. Not yet applied.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A portal number: a JSON number, or a string such as "1,234.50"; anything else is 0.
CREATE OR REPLACE FUNCTION public.annual_return_json_num(v jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN v IS NULL THEN 0
    WHEN jsonb_typeof(v) = 'number' THEN (v #>> '{}')::numeric
    WHEN jsonb_typeof(v) = 'string'
         AND btrim(replace(v #>> '{}', ',', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN btrim(replace(v #>> '{}', ',', ''))::numeric
    ELSE 0
  END;
$$;

-- The tax of one GSTR-3B table in an as-filed summary, or NULL when the summary
-- does not carry the return (unwrapped as portalParser.ts unwrap does).
CREATE OR REPLACE FUNCTION public.annual_return_3b_table_tax(
  p_summary jsonb, p_table text,
  OUT i numeric, OUT c numeric, OUT s numeric, OUT x numeric
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  cur jsonb := p_summary;
  depth int := 0;
  o jsonb;
  ty text;
BEGIN
  WHILE depth < 5 AND cur IS NOT NULL AND jsonb_typeof(cur) = 'object' LOOP
    EXIT WHEN cur ? 'sup_details' OR cur ? 'itc_elg';
    cur := COALESCE(cur -> 'data', cur -> 'result', cur -> 'payload');
    depth := depth + 1;
  END LOOP;
  IF cur IS NULL OR jsonb_typeof(cur) <> 'object' OR NOT (cur ? 'sup_details' OR cur ? 'itc_elg') THEN
    RETURN; -- all NULL
  END IF;

  IF p_table IN ('3.1(a)', '3.1(b)', '3.1(d)') THEN
    o := cur -> 'sup_details' -> (CASE p_table WHEN '3.1(a)' THEN 'osup_det' WHEN '3.1(b)' THEN 'osup_zero' ELSE 'isup_rev' END);
    IF o IS NULL OR jsonb_typeof(o) <> 'object' THEN
      i := 0; c := 0; s := 0; x := 0;
      RETURN;
    END IF;
    i := public.annual_return_json_num(o -> 'iamt');
    c := public.annual_return_json_num(o -> 'camt');
    s := public.annual_return_json_num(o -> 'samt');
    x := public.annual_return_json_num(o -> 'csamt');
    RETURN;
  ELSIF p_table IN ('4(B)(1)', '4(B)(2)') THEN
    ty := CASE p_table WHEN '4(B)(1)' THEN 'RUL' ELSE 'OTH' END;
    SELECT COALESCE(sum(public.annual_return_json_num(e -> 'iamt')), 0),
           COALESCE(sum(public.annual_return_json_num(e -> 'camt')), 0),
           COALESCE(sum(public.annual_return_json_num(e -> 'samt')), 0),
           COALESCE(sum(public.annual_return_json_num(e -> 'csamt')), 0)
      INTO i, c, s, x
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(cur -> 'itc_elg' -> 'itc_rev') = 'array' THEN cur -> 'itc_elg' -> 'itc_rev' ELSE '[]'::jsonb END
           ) e
     WHERE upper(e ->> 'ty') = ty;
    RETURN;
  END IF;
  -- Any other table: no figure (NULL), not capped.
END;
$$;

CREATE INDEX IF NOT EXISTS annual_return_payable_setoffs_3b_idx
  ON public.annual_return_payable_setoffs (client_id, gstr3b_period, gstr3b_table)
  WHERE deleted_at IS NULL AND method = 'gstr3b';

CREATE INDEX IF NOT EXISTS annual_return_payable_setoffs_ref_idx
  ON public.annual_return_payable_setoffs (upper(btrim(reference)))
  WHERE deleted_at IS NULL AND method = 'drc03';

-- ---------------------------------------------------------------------------
-- The set-off door, with caps and locks
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_annual_return_setoff(
  p_client_id uuid,
  p_financial_year text,
  p_side text,
  p_method text,
  p_by text,
  p_igst numeric,
  p_cgst numeric,
  p_sgst numeric,
  p_cess numeric,
  p_drc03_id uuid DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_doc_date date DEFAULT NULL,
  p_gstr3b_period text DEFAULT NULL,
  p_gstr3b_table text DEFAULT NULL,
  p_evidence_url text DEFAULT NULL,
  p_evidence_name text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  d public.gst_drc03_filings%ROWTYPE;
  cap public.gst_drc03_filings%ROWTYPE;
  used record;
  fig record;
  r3b public.gst_filed_returns%ROWTYPE;
  v_label text;
  v_arn text := upper(NULLIF(btrim(p_reference), ''));
  v_cap_arn text;
BEGIN
  IF p_drc03_id IS NOT NULL THEN
    -- Locked, so two set-offs against the same DRC-03 run one after the other.
    SELECT * INTO d FROM public.gst_drc03_filings WHERE id = p_drc03_id FOR UPDATE;
    IF NOT FOUND OR d.client_id <> p_client_id OR d.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_SETOFF_INVALID: that DRC-03 is not on record for this client.' USING ERRCODE = 'P0001';
    END IF;
    cap := d;
  ELSIF p_method = 'drc03' AND v_arn IS NOT NULL THEN
    -- An uploaded copy: one at a time per client and ARN, synced row or not.
    PERFORM pg_advisory_xact_lock(hashtextextended('annual_return_setoff:drc03:' || p_client_id::text || ':' || v_arn, 0));
    -- The ARN of another client's DRC-03 is not this client's payment.
    IF EXISTS (SELECT 1 FROM public.gst_drc03_filings f
                WHERE f.client_id <> p_client_id AND f.deleted_at IS NULL AND upper(btrim(f.arn)) = v_arn)
       OR EXISTS (SELECT 1 FROM public.annual_return_payable_setoffs o
                   WHERE o.client_id <> p_client_id AND o.deleted_at IS NULL AND o.method = 'drc03'
                     AND upper(btrim(o.reference)) = v_arn) THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_SETOFF_INVALID: DRC-03 % is on record for another client.', btrim(p_reference)
        USING ERRCODE = 'P0001';
    END IF;
    -- The same ARN synced for this client: capped at what it paid.
    SELECT * INTO cap FROM public.gst_drc03_filings f
     WHERE f.client_id = p_client_id AND f.deleted_at IS NULL AND upper(btrim(f.arn)) = v_arn
     ORDER BY f.pulled_at DESC
     LIMIT 1
       FOR UPDATE;
  END IF;

  IF cap.id IS NOT NULL THEN
    v_cap_arn := upper(NULLIF(btrim(cap.arn), ''));
    -- A DRC-03 cannot be used for more than it paid, head by head (₹1 rounding allowed),
    -- whether a set-off named it by its synced row or by its ARN on an uploaded copy.
    SELECT COALESCE(sum(igst), 0) AS i, COALESCE(sum(cgst), 0) AS c, COALESCE(sum(sgst), 0) AS s, COALESCE(sum(cess), 0) AS x
      INTO used FROM public.annual_return_payable_setoffs o
     WHERE o.deleted_at IS NULL
       AND (o.drc03_id = cap.id
            OR (o.drc03_id IS NULL AND o.method = 'drc03' AND o.client_id = p_client_id
                AND v_cap_arn IS NOT NULL AND upper(btrim(o.reference)) = v_cap_arn));
    IF used.i + COALESCE(p_igst, 0) > COALESCE(cap.igst_amount, 0) + 1
       OR used.c + COALESCE(p_cgst, 0) > COALESCE(cap.cgst_amount, 0) + 1
       OR used.s + COALESCE(p_sgst, 0) > COALESCE(cap.sgst_amount, 0) + 1
       OR used.x + COALESCE(p_cess, 0) > COALESCE(cap.cess_amount, 0) + 1 THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_SETOFF_INVALID: the amount is more than what is left on DRC-03 %.', COALESCE(cap.arn, '')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_method = 'gstr3b' AND p_gstr3b_period IS NOT NULL AND NULLIF(btrim(p_gstr3b_table), '') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'annual_return_setoff:gstr3b:' || p_client_id::text || ':' || p_gstr3b_period || ':' || btrim(p_gstr3b_table), 0));
    SELECT * INTO r3b FROM public.gst_filed_returns
     WHERE client_id = p_client_id AND return_type = 'GSTR3B' AND period_month = p_gstr3b_period
       FOR UPDATE;
    IF FOUND THEN
      SELECT * INTO fig FROM public.annual_return_3b_table_tax(r3b.summary, btrim(p_gstr3b_table));
      IF fig.i IS NOT NULL THEN
        -- Every working of the client: one GSTR-3B table is given as an effect only up to its figure.
        SELECT COALESCE(sum(igst), 0) AS i, COALESCE(sum(cgst), 0) AS c, COALESCE(sum(sgst), 0) AS s, COALESCE(sum(cess), 0) AS x
          INTO used FROM public.annual_return_payable_setoffs o
         WHERE o.client_id = p_client_id AND o.deleted_at IS NULL AND o.method = 'gstr3b'
           AND o.gstr3b_period = p_gstr3b_period AND btrim(o.gstr3b_table) = btrim(p_gstr3b_table);
        IF used.i + COALESCE(p_igst, 0) > fig.i + 1
           OR used.c + COALESCE(p_cgst, 0) > fig.c + 1
           OR used.s + COALESCE(p_sgst, 0) > fig.s + 1
           OR used.x + COALESCE(p_cess, 0) > fig.x + 1 THEN
          RAISE EXCEPTION 'ANNUAL_RETURN_SETOFF_INVALID: the amount is more than what is left in % of the GSTR-3B for % as filed.',
            btrim(p_gstr3b_table), p_gstr3b_period
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.annual_return_payable_setoffs
    (client_id, financial_year, side, method, drc03_id, reference, doc_date, gstr3b_period, gstr3b_table,
     evidence_url, evidence_name, igst, cgst, sgst, cess, note, created_by)
  VALUES
    (p_client_id, p_financial_year, p_side, p_method, p_drc03_id,
     COALESCE(NULLIF(btrim(p_reference), ''), d.arn), COALESCE(p_doc_date, d.filed_date), p_gstr3b_period, p_gstr3b_table,
     COALESCE(p_evidence_url, d.pdf_url), p_evidence_name,
     COALESCE(p_igst, 0), COALESCE(p_cgst, 0), COALESCE(p_sgst, 0), COALESCE(p_cess, 0), p_note, p_by)
  RETURNING id INTO v_id;

  v_label := CASE WHEN p_method = 'drc03' THEN 'DRC-03 ' || COALESCE(NULLIF(btrim(p_reference), ''), d.arn, '')
                  ELSE 'GSTR-3B ' || COALESCE(p_gstr3b_period, '') END;
  INSERT INTO public.annual_return_change_log
    (client_id, financial_year, doc_key, path, row_label, kind, new_value, action, changed_by)
  SELECT client_id, financial_year, 'payables', ARRAY[side, '#' || id::text], v_label, 'setoff', to_jsonb(s),
         'Set off ' || side || ' payable', p_by
    FROM public.annual_return_payable_setoffs s WHERE id = v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_annual_return_setoff(uuid, text, text, text, text, numeric, numeric, numeric, numeric, uuid, text, date, text, text, text, text, text) TO anon, authenticated;

COMMIT;
