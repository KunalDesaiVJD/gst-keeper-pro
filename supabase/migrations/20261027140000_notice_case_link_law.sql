-- Notices · linking cases by the shape GST law gives a proceeding (the firm,
-- 27 October 2026: "in Unity, in 1 case 2 DRC-01s are linked which are
-- logically incorrect ... logically 2 cases cannot be linked so check GST law
-- ... make some more stringent or stricter rules for linking the case. We may
-- also use AI for the same. Though superadmin or any user try to override
-- anything but should warn atleast for anything which is unusual").
--
-- How Unity happened: the DRC-01A intimation for 2017-18 (AD2408230098061) was
-- offered, under "May belong with this case", both show cause notices of
-- 2017-18 (AD240923028913Z, which went to a DRC-07 order and an appeal, and
-- AD240923031848T, closed without a demand), each at 45 points (filed within 120 days, same
-- year), and a person linked both, one click each. No paper of either notice
-- names the intimation; the scorer (notice_case_link_candidates) knew nothing
-- of the law, and notice_case_link_set took any link a person asked for.
--
-- The law (§37 of docs/NOTICES_LITIGATION_POSITIONS.md): under sections 73, 74
-- and 74A of the CGST Act a proceeding is one show cause notice (DRC-01, with
-- its summary and reminders) and the one order that ends it (DRC-07, or the
-- proceedings closed); section 129 likewise (MOV-07, MOV-09). Before it may
-- come an intimation (rule 142(1A), DRC-01A), scrutiny (section 61, ASMT-10)
-- or audit (section 65, ADT-01/02), and after it a rectification (section
-- 161), an appeal (section 107, then 112) or a waiver (section 128A). So one
-- case chain holds one proceeding at most: two show cause notices are two
-- cases, whatever year or intimation they share.
--
-- 1. notice_case_steps: what each portal case is in that shape (proceeding,
--    intimation / scrutiny / audit, appeal, waiver, rectification, refund,
--    registration, a notice with no portal case, other) and its notice number.
-- 2. notice_case_link_check: the problems a link would have. Against the law
--    (level "law"): two proceedings in one chain, the registration bucket, a
--    circle. Unusual (level "unusual"): an appeal, waiver or rectification
--    linked as something else or the wrong way round, an appeal against a case
--    holding no order or dated before it, an order already appealed, an
--    intimation dated after the notice, a "related" link between two cases of
--    their own, different years, a refund with a demand, and no portal number
--    on the papers of both.
-- 3. The law gate (trigger notice_case_links_law, after the confidence gate):
--    an automatic related link against the law is never made; it waits in
--    notice_case_link_reviews for a person, saying why. A person's link against
--    the law is refused unless it carries a reason (app.case_link_override).
-- 4. A person links through notice_case_link_set_checked /
--    notice_case_review_decide_checked: anything against the law or unusual is
--    answered "confirm" with the problems; the link is made only when confirmed
--    (a reason of ten letters or more against the law), and every confirmed
--    warning is kept in notice_case_link_overrides with who and why.
-- 5. notice_case_link_checks: the check for several pairs at once (the
--    suggestions and the review list show the warnings before anyone clicks).
-- 6. notice_case_link_ai: the AI's second opinion on a pair (Edge Function
--    notice-link-ai, Sonnet at medium effort like every AI call), from
--    notice_case_link_ai_context; advice only, a person decides.
--
-- Additive: new functions, a trigger, two tables; no existing function changes.

-- ── 1. What each case is ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_proceeding_forms()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT ARRAY['DRC-01', 'DRC-07', 'DRC-07A', 'DRC-08', 'MOV-07', 'MOV-09']::text[] $$;
COMMENT ON FUNCTION public.notice_proceeding_forms() IS
  'Forms that make a case a proceeding of its own: a show cause notice (DRC-01, MOV-07) or the order that ends one (DRC-07, DRC-07A, DRC-08, MOV-09).';

CREATE OR REPLACE FUNCTION public.notice_pre_scn_forms()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT ARRAY['DRC-01A', 'DRC-01B', 'DRC-01C', 'ASMT-10', 'ASMT-11', 'ASMT-12', 'ADT-01', 'ADT-02', 'ADT-CLOSURE', 'SUMMONS']::text[] $$;
COMMENT ON FUNCTION public.notice_pre_scn_forms() IS
  'Forms of the steps that may come before a show cause notice: intimation (DRC-01A), return differences (DRC-01B, DRC-01C), scrutiny (ASMT-10 to 12), audit (ADT-01, ADT-02), summons.';

CREATE OR REPLACE FUNCTION public.notice_case_steps(p_client_id uuid)
RETURNS TABLE (
  own_key text, step text, scn_ref text, marker text, track text, refund_app boolean, about_refund boolean,
  has_order boolean, order_form text, order_ref text, order_date date, first_date date, financial_year text,
  title text, form_code text, forms text[])
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.own_key,
         CASE WHEN p.own_key = 'REG' OR p.track = 'registration' THEN 'registration'
              WHEN p.marker IS NOT NULL THEN p.marker
              WHEN p.own_key LIKE 'N:%' THEN 'notice'
              WHEN p.refund_app OR p.track = 'refund' THEN 'refund'
              WHEN p.forms && public.notice_proceeding_forms() THEN 'proceeding'
              WHEN p.forms && public.notice_pre_scn_forms() THEN 'pre_scn'
              ELSE 'other' END,
         -- The show cause notice itself (not its reminder).
         (SELECT f.reference_number FROM public.notice_facts f
           WHERE f.client_id = p_client_id AND f.form_code IN ('DRC-01', 'MOV-07')
             AND public.notice_case_key(f.case_id, f.category, f.id) = p.own_key
             AND coalesce(f.description, '') NOT ILIKE '%reminder%'
           ORDER BY f.issue_date NULLS LAST, f.reference_number LIMIT 1),
         p.marker, p.track, p.refund_app, p.about_refund, p.has_order, p.order_form, p.order_ref, p.order_date,
         p.first_date, p.financial_year, p.title, p.form_code, p.forms
    FROM public.notice_case_parts(p_client_id) p
$$;
REVOKE ALL ON FUNCTION public.notice_case_steps(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notice_case_steps(uuid) TO service_role;
COMMENT ON FUNCTION public.notice_case_steps(uuid) IS
  'Each portal case of a client as a step of a proceeding: proceeding (one show cause notice and its order), pre_scn, appeal, waiver, rectification, refund, registration, notice (no portal case) or other; with its notice number.';

-- ── 2. What a link would break ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_link_check(p_client_id uuid, p_child_key text, p_parent_key text, p_kind text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind    text := coalesce(nullif(btrim(p_kind), ''), 'related');
  v_steps   jsonb;
  c         jsonb;
  p         jsonb;
  cs        text;
  ps        text;
  v_sub     text[];
  v_root    text;
  v_chain   text[];
  v_procs   jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_shared  int := 0;
  v_txt     text;
  v_other   text;
  v_order   date;
  v_any_ord boolean;
  v_label   jsonb := '{"proceeding": "a show cause proceeding", "pre_scn": "an intimation, scrutiny or audit", "appeal": "an appeal",
                       "waiver": "a waiver application", "rectification": "a rectification", "refund": "a refund",
                       "registration": "registration", "notice": "a notice with no portal case", "other": "a case"}'::jsonb;
BEGIN
  SELECT jsonb_object_agg(s.own_key, to_jsonb(s)) INTO v_steps FROM public.notice_case_steps(p_client_id) s;
  c := v_steps -> p_child_key;
  p := v_steps -> p_parent_key;
  IF c IS NULL OR p IS NULL THEN
    RETURN jsonb_build_object('against_law', false, 'unusual', true, 'proceedings', '[]'::jsonb, 'shared_numbers', 0,
      'problems', jsonb_build_array(jsonb_build_object('code', 'unknown_case', 'level', 'unusual',
        'text', 'One of the two cases has no notice or document on record, so nothing can be checked.')));
  END IF;
  cs := c ->> 'step';
  ps := p ->> 'step';

  -- The child moves with everything under it; the parent's chain is everything under its root.
  WITH RECURSIVE sub(k, d) AS (
    SELECT p_child_key, 0
    UNION ALL
    SELECT l.child_key, sub.d + 1 FROM public.notice_case_links l JOIN sub ON l.parent_key = sub.k
     WHERE l.client_id = p_client_id AND sub.d < 12
  )
  SELECT array_agg(DISTINCT k) INTO v_sub FROM sub;
  v_root := public.notice_case_root(p_client_id, p_parent_key);
  SELECT coalesce(array_agg(k), '{}') INTO v_chain FROM jsonb_object_keys(v_steps) k
   WHERE NOT (k = ANY (v_sub)) AND public.notice_case_root(p_client_id, k) = v_root;
  SELECT coalesce(jsonb_agg(jsonb_build_object('case_key', v_steps -> k ->> 'own_key', 'scn_ref', v_steps -> k ->> 'scn_ref',
                                               'first_date', v_steps -> k ->> 'first_date', 'financial_year', v_steps -> k ->> 'financial_year',
                                               'order_ref', v_steps -> k ->> 'order_ref')
                            ORDER BY v_steps -> k ->> 'first_date' NULLS LAST, k), '[]'::jsonb)
    INTO v_procs
    FROM unnest(v_sub || v_chain) k
   WHERE v_steps -> k ->> 'step' = 'proceeding';

  -- ── Against the law ──
  IF cs = 'registration' OR ps = 'registration' THEN
    v_out := v_out || jsonb_build_object('code', 'registration', 'level', 'law',
      'text', 'Registration notices and orders are one registration case per client (REG forms under sections 25 to 30); they are never part of a demand, refund or appeal case.');
  END IF;
  IF p_child_key = p_parent_key OR p_parent_key = ANY (v_sub) THEN
    v_out := v_out || jsonb_build_object('code', 'circle', 'level', 'law', 'text', 'The case would be linked into itself or into a case under it.');
  END IF;
  IF jsonb_array_length(v_procs) >= 2 THEN
    SELECT string_agg(coalesce('DRC-01 ' || (x ->> 'scn_ref'), 'the notice') || ' (case ' || (x ->> 'case_key') || ')', ', ')
      INTO v_txt FROM jsonb_array_elements(v_procs) x;
    v_out := v_out || jsonb_build_object('code', 'two_proceedings', 'level', 'law',
      'text', 'This puts ' || jsonb_array_length(v_procs) || ' show cause proceedings in one case: ' || v_txt
        || '. Under sections 73, 74 and 74A of the CGST Act each show cause notice starts a proceeding of its own and ends in its own order (DRC-07, or the proceedings closed), so two notices are two cases, even for the same year or after the same intimation (DRC-01A). Link the intimation, scrutiny, appeal, waiver or rectification to the one notice it belongs to.');
  END IF;

  -- ── Unusual: the kind of link against what the cases are ──
  IF v_kind IN ('appeal', 'waiver', 'rectification') AND cs <> v_kind THEN
    v_out := v_out || jsonb_build_object('code', 'kind_mismatch', 'level', 'unusual',
      'text', 'Linked as ' || CASE v_kind WHEN 'appeal' THEN 'an appeal' WHEN 'waiver' THEN 'a waiver' ELSE 'a rectification' END
        || ', but ' || p_child_key || ' is ' || (v_label ->> cs) || ', not '
        || CASE v_kind WHEN 'appeal' THEN 'an appeal application (APL-01, section 107)' WHEN 'waiver' THEN 'a waiver application (SPL-01 or SPL-02, section 128A)'
                       ELSE 'a rectification application (section 161)' END || '.');
  ELSIF cs IN ('appeal', 'waiver', 'rectification') AND v_kind <> cs THEN
    v_out := v_out || jsonb_build_object('code', 'kind_mismatch', 'level', 'unusual',
      'text', p_child_key || ' is ' || (v_label ->> cs) || '; link it as ' || CASE cs WHEN 'appeal' THEN 'an appeal' WHEN 'waiver' THEN 'a waiver' ELSE 'a rectification' END
        || ', against the case whose order it is about.');
  END IF;
  IF v_kind = 'reapplication' AND NOT (cs = 'refund' AND ps = 'refund') THEN
    v_out := v_out || jsonb_build_object('code', 'kind_mismatch', 'level', 'unusual',
      'text', 'A fresh application links two refund applications only (the same refund filed again under rule 90 or 93).');
  END IF;
  IF ps IN ('appeal', 'waiver', 'rectification') AND cs NOT IN ('appeal', 'waiver', 'rectification', 'notice') THEN
    v_out := v_out || jsonb_build_object('code', 'reversed', 'level', 'unusual',
      'text', 'The other way round: ' || p_parent_key || ' is ' || (v_label ->> ps) || ', which belongs under the case it is against, not above it.');
  END IF;

  -- ── Unusual: an appeal and its order ──
  IF v_kind IN ('appeal', 'rectification') THEN
    SELECT bool_or(coalesce((v_steps -> k ->> 'has_order')::boolean, false) AND v_steps -> k ->> 'step' NOT IN ('appeal', 'waiver', 'rectification')
                   OR (k = p_parent_key AND coalesce((v_steps -> k ->> 'has_order')::boolean, false))),
           max((v_steps -> k ->> 'order_date')::date) FILTER (WHERE coalesce((v_steps -> k ->> 'has_order')::boolean, false))
      INTO v_any_ord, v_order
      FROM unnest(array_append(v_chain, p_parent_key)) k;
    IF NOT coalesce(v_any_ord, false) THEN
      v_out := v_out || jsonb_build_object('code', 'no_order', 'level', 'unusual',
        'text', CASE WHEN v_kind = 'appeal' THEN 'An appeal lies against an order or decision (section 107(1)), ' ELSE 'A rectification is of an order (section 161), ' END
          || 'and ' || p_parent_key || ' and its case hold no order on record.');
    ELSIF v_kind = 'appeal' AND cs = 'appeal' AND (c ->> 'first_date') IS NOT NULL
          AND (coalesce((p ->> 'order_date')::date, v_order)) IS NOT NULL
          AND (c ->> 'first_date')::date < coalesce((p ->> 'order_date')::date, v_order) THEN
      v_out := v_out || jsonb_build_object('code', 'before_order', 'level', 'unusual',
        'text', 'The appeal is dated ' || to_char((c ->> 'first_date')::date, 'DD Mon YYYY') || ', before the order of '
          || to_char(coalesce((p ->> 'order_date')::date, v_order), 'DD Mon YYYY') || ': an appeal is filed after the order is communicated (section 107(1)).');
    END IF;
  END IF;
  IF v_kind = 'appeal' AND cs = 'appeal' THEN
    SELECT string_agg(l.child_key, ', ') INTO v_other FROM public.notice_case_links l
     WHERE l.client_id = p_client_id AND l.parent_key = p_parent_key AND l.kind = 'appeal' AND l.child_key <> p_child_key;
    IF v_other IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('code', 'already_appealed', 'level', 'unusual',
        'text', p_parent_key || ' already has an appeal linked (' || v_other || '). An order is appealed once before the Appellate Authority; an appeal to the Tribunal (section 112) is against the appeal order (APL-04), so it goes under the appeal.');
    END IF;
  END IF;

  -- ── Unusual: steps of one proceeding out of order ──
  IF (cs = 'pre_scn' AND ps = 'proceeding' OR cs = 'proceeding' AND ps = 'pre_scn')
     AND (c ->> 'first_date') IS NOT NULL AND (p ->> 'first_date') IS NOT NULL
     AND (CASE WHEN cs = 'pre_scn' THEN (c ->> 'first_date')::date > (p ->> 'first_date')::date
               ELSE (p ->> 'first_date')::date > (c ->> 'first_date')::date END) THEN
    v_out := v_out || jsonb_build_object('code', 'intimation_after', 'level', 'unusual',
      'text', 'The intimation, scrutiny or audit is dated after the show cause notice; it comes before the notice of its own proceeding (rule 142(1A), sections 61 and 65).');
  END IF;
  IF v_kind = 'related' AND cs NOT IN ('notice', 'pre_scn', 'appeal', 'waiver', 'rectification')
     AND ps NOT IN ('notice', 'pre_scn', 'appeal', 'waiver', 'rectification')
     AND NOT (cs = 'proceeding' AND ps = 'proceeding') THEN
    v_out := v_out || jsonb_build_object('code', 'two_cases', 'level', 'unusual',
      'text', 'Both are cases of their own (' || (v_label ->> cs) || ' and ' || (v_label ->> ps) || '). A related link joins steps of one proceeding: an intimation, scrutiny or audit and the show cause notice that followed it, or a notice with no portal case. Two separate cases stay apart, even for the same year.');
  END IF;
  IF (c ->> 'financial_year') IS NOT NULL AND (p ->> 'financial_year') IS NOT NULL AND (c ->> 'financial_year') <> (p ->> 'financial_year') THEN
    v_out := v_out || jsonb_build_object('code', 'other_year', 'level', 'unusual',
      'text', 'Different financial years (' || (c ->> 'financial_year') || ' and ' || (p ->> 'financial_year') || '): a notice, its order and its appeal are for the same period.');
  END IF;
  IF cs NOT IN ('appeal', 'notice', 'other') AND ps NOT IN ('notice', 'other') AND cs <> 'registration' AND ps <> 'registration'
     AND ((cs = 'refund') <> (ps = 'refund')) THEN
    v_out := v_out || jsonb_build_object('code', 'refund_and_demand', 'level', 'unusual',
      'text', 'One is a refund and the other a demand: a refund case links only to an appeal against its order or to the same refund filed again.');
  END IF;

  -- ── Unusual: nothing on the papers ties them ──
  SELECT count(*)::int INTO v_shared FROM (
    SELECT x.ident FROM public.notice_case_numbers(p_client_id) x WHERE x.own_key IN (p_child_key, p_parent_key)
     GROUP BY x.ident HAVING count(DISTINCT x.own_key) = 2) s;
  IF v_shared = 0 THEN
    v_out := v_out || jsonb_build_object('code', 'no_paper', 'level', 'unusual',
      'text', 'No portal number appears on the papers of both cases, so nothing on the record ties them together. Read both notices before linking.');
  END IF;

  RETURN jsonb_build_object(
    'against_law', EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) x WHERE x ->> 'level' = 'law'),
    'unusual', jsonb_array_length(v_out) > 0,
    'problems', v_out,
    'proceedings', v_procs,
    'shared_numbers', v_shared,
    'child', jsonb_build_object('case_key', p_child_key, 'step', cs, 'title', c ->> 'title', 'form_code', c ->> 'form_code',
                                'financial_year', c ->> 'financial_year', 'first_date', c ->> 'first_date'),
    'parent', jsonb_build_object('case_key', p_parent_key, 'step', ps, 'title', p ->> 'title', 'form_code', p ->> 'form_code',
                                 'financial_year', p ->> 'financial_year', 'first_date', p ->> 'first_date'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_link_check(uuid, text, text, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_case_link_check(uuid, text, text, text) IS
  'What linking p_child_key into p_parent_key would break: problems at level law (two show cause proceedings in one chain, registration, a circle) or unusual (kind, direction, order, dates, year, refund and demand, no shared number), each with a code and words.';

CREATE OR REPLACE FUNCTION public.notice_case_link_checks(p_items jsonb)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('client_id', x ->> 'client_id', 'child_key', x ->> 'child_key', 'parent_key', x ->> 'parent_key',
                                               'kind', x ->> 'kind',
                                               'check', public.notice_case_link_check((x ->> 'client_id')::uuid, x ->> 'child_key', x ->> 'parent_key', x ->> 'kind'))
                            ORDER BY o), '[]'::jsonb)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, o)
   WHERE o <= 40 AND (x ->> 'client_id') IS NOT NULL AND (x ->> 'child_key') IS NOT NULL AND (x ->> 'parent_key') IS NOT NULL
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_link_checks(jsonb) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_case_link_checks(jsonb) IS
  'notice_case_link_check for up to 40 pairs [{client_id, child_key, parent_key, kind}], in order.';

-- ── 3. Confirmed warnings, kept ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_case_link_overrides (
  id          bigserial PRIMARY KEY,
  client_id   uuid NOT NULL,  -- no foreign key: the record outlives a removed client
  child_key   text NOT NULL,
  parent_key  text NOT NULL,
  kind        text,
  against_law boolean NOT NULL DEFAULT false,
  problems    jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason      text,
  by_name     text,
  via         text NOT NULL DEFAULT 'link',
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notice_case_link_overrides_client ON public.notice_case_link_overrides (client_id, at DESC);
COMMENT ON TABLE public.notice_case_link_overrides IS
  'Links a person made although the law check warned (notice_case_link_check): what it said, whether it was against the law, the reason given and who.';
ALTER TABLE public.notice_case_link_overrides ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notice_case_link_overrides'
                   AND policyname = 'notice_case_link_overrides_all') THEN
    CREATE POLICY notice_case_link_overrides_all ON public.notice_case_link_overrides FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 4. The law gate ────────────────────────────────────────────────────────
-- After the confidence gate (trg_notice_case_links_gate fires first: triggers
-- run in name order). Automatic links of a kind other than related cannot
-- bring a second proceeding in (an appeal, waiver, rectification or refund is
-- linked alone), so only related ones are checked.
CREATE OR REPLACE FUNCTION public.notice_case_links_law()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v      jsonb;
  v_law  text;
  v_over text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_key IS NOT DISTINCT FROM OLD.parent_key AND NEW.kind IS NOT DISTINCT FROM OLD.kind THEN
    RETURN NEW;
  END IF;
  IF NEW.source = 'auto' AND coalesce(NEW.kind, 'related') <> 'related' THEN
    RETURN NEW;
  END IF;
  v := public.notice_case_link_check(NEW.client_id, NEW.child_key, NEW.parent_key, NEW.kind);
  IF NOT coalesce((v ->> 'against_law')::boolean, false) THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(x ->> 'text', ' ') INTO v_law FROM jsonb_array_elements(v -> 'problems') x WHERE x ->> 'level' = 'law';

  IF NEW.source = 'auto' THEN
    -- Never linked by itself: a person sees why.
    INSERT INTO public.notice_case_link_reviews AS r
           (client_id, issue, child_key, parent_key, kind, confidence, reasons, via_ref, status, proposed_at)
    VALUES (NEW.client_id, 'low_confidence', NEW.child_key, NEW.parent_key, NEW.kind, 0,
            ARRAY['Against GST law: ' || v_law] || CASE WHEN NEW.reason IS NOT NULL THEN ARRAY[NEW.reason] ELSE '{}'::text[] END,
            NEW.via_ref, 'open', now())
    ON CONFLICT (client_id, issue, child_key, parent_key) DO UPDATE
       SET kind = excluded.kind, confidence = 0, reasons = excluded.reasons, via_ref = excluded.via_ref, proposed_at = now();
    RETURN NULL;
  END IF;

  v_over := nullif(btrim(coalesce(current_setting('app.case_link_override', true), '')), '');
  IF v_over IS NULL THEN
    RAISE EXCEPTION 'Not linked, against GST law: %', v_law
      USING ERRCODE = 'P0001', HINT = 'Link from the case page: it shows why and takes a reason to link anyway.';
  END IF;
  NEW.reason := coalesce(NEW.reason, 'Linked by a person') || '. Linked against the rule (the law check said: '
    || (SELECT string_agg(x ->> 'code', ', ') FROM jsonb_array_elements(v -> 'problems') x WHERE x ->> 'level' = 'law')
    || '). Reason given: ' || left(v_over, 300);
  RETURN NEW;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notice_case_links_law' AND tgrelid = 'public.notice_case_links'::regclass) THEN
    CREATE TRIGGER trg_notice_case_links_law
      BEFORE INSERT OR UPDATE ON public.notice_case_links
      FOR EACH ROW EXECUTE FUNCTION public.notice_case_links_law();
  END IF;
END $$;

-- ── 5. A person links, warned first ────────────────────────────────────────
-- Answers {status: 'linked' | 'confirm' | 'reason_needed', check}. Without
-- p_confirm, a link with any problem is not made: the page shows the problems
-- and asks again with p_confirm (the reason; ten letters or more when the link
-- is against the law). Unlinking (p_parent_key NULL) is never checked.
CREATE OR REPLACE FUNCTION public.notice_case_link_set_checked(
  p_client_id uuid, p_child_key text, p_parent_key text, p_kind text, p_by text DEFAULT NULL, p_confirm text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v    jsonb;
  v_ok text := nullif(btrim(coalesce(p_confirm, '')), '');
BEGIN
  IF p_parent_key IS NULL THEN
    PERFORM public.notice_case_link_set(p_client_id, p_child_key, NULL, NULL, p_by);
    RETURN jsonb_build_object('status', 'linked', 'check', NULL);
  END IF;
  v := public.notice_case_link_check(p_client_id, p_child_key, p_parent_key, p_kind);
  IF coalesce((v ->> 'unusual')::boolean, false) AND v_ok IS NULL THEN
    RETURN jsonb_build_object('status', 'confirm', 'check', v);
  END IF;
  IF coalesce((v ->> 'against_law')::boolean, false) AND length(coalesce(v_ok, '')) < 10 THEN
    RETURN jsonb_build_object('status', 'reason_needed', 'check', v);
  END IF;
  PERFORM set_config('app.case_link_override', coalesce(v_ok, ''), true);
  PERFORM public.notice_case_link_set(p_client_id, p_child_key, p_parent_key, p_kind, p_by);
  PERFORM set_config('app.case_link_override', '', true);
  IF coalesce((v ->> 'unusual')::boolean, false) THEN
    INSERT INTO public.notice_case_link_overrides (client_id, child_key, parent_key, kind, against_law, problems, reason, by_name, via)
    VALUES (p_client_id, p_child_key, p_parent_key, coalesce(p_kind, 'related'), coalesce((v ->> 'against_law')::boolean, false),
            v -> 'problems', left(v_ok, 1000), left(p_by, 120), 'link');
  END IF;
  RETURN jsonb_build_object('status', 'linked', 'check', v);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_link_set_checked(uuid, text, text, text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_case_review_decide_checked(
  p_client_id uuid, p_issue text, p_child_key text, p_parent_key text, p_decision text, p_kind text DEFAULT NULL,
  p_by text DEFAULT NULL, p_confirm text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v    jsonb;
  v_ok text := nullif(btrim(coalesce(p_confirm, '')), '');
BEGIN
  IF p_decision IS DISTINCT FROM 'link' OR nullif(btrim(coalesce(p_parent_key, '')), '') IS NULL THEN
    PERFORM public.notice_case_review_decide(p_client_id, p_issue, p_child_key, p_parent_key, p_decision, p_kind, p_by);
    RETURN jsonb_build_object('status', 'decided', 'check', NULL);
  END IF;
  v := public.notice_case_link_check(p_client_id, p_child_key, p_parent_key, p_kind);
  IF coalesce((v ->> 'unusual')::boolean, false) AND v_ok IS NULL THEN
    RETURN jsonb_build_object('status', 'confirm', 'check', v);
  END IF;
  IF coalesce((v ->> 'against_law')::boolean, false) AND length(coalesce(v_ok, '')) < 10 THEN
    RETURN jsonb_build_object('status', 'reason_needed', 'check', v);
  END IF;
  PERFORM set_config('app.case_link_override', coalesce(v_ok, ''), true);
  PERFORM public.notice_case_review_decide(p_client_id, p_issue, p_child_key, p_parent_key, p_decision, p_kind, p_by);
  PERFORM set_config('app.case_link_override', '', true);
  IF coalesce((v ->> 'unusual')::boolean, false) THEN
    INSERT INTO public.notice_case_link_overrides (client_id, child_key, parent_key, kind, against_law, problems, reason, by_name, via)
    VALUES (p_client_id, p_child_key, p_parent_key, coalesce(p_kind, 'related'), coalesce((v ->> 'against_law')::boolean, false),
            v -> 'problems', left(v_ok, 1000), left(p_by, 120), 'review');
  END IF;
  RETURN jsonb_build_object('status', 'decided', 'check', v);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_review_decide_checked(uuid, text, text, text, text, text, text, text) TO anon, authenticated, service_role;

-- ── 6. The AI's second opinion ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_case_link_ai (
  id          bigserial PRIMARY KEY,
  client_id   uuid NOT NULL,  -- no foreign key: the record outlives a removed client
  child_key   text NOT NULL,
  parent_key  text NOT NULL,
  kind        text,
  verdict     text NOT NULL CHECK (verdict IN ('link', 'keep_apart', 'unsure')),
  kind_ai     text,
  confidence  int,
  reasons     text[],
  law         text[],
  model       text,
  asked_by    text,
  asked_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notice_case_link_ai_pair ON public.notice_case_link_ai (client_id, child_key, parent_key, asked_at DESC);
COMMENT ON TABLE public.notice_case_link_ai IS
  'The AI''s opinions on linking two cases (Edge Function notice-link-ai): verdict, the kind it would use, how sure, why and the law it rests on. Advice only.';
ALTER TABLE public.notice_case_link_ai ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notice_case_link_ai'
                   AND policyname = 'notice_case_link_ai_all') THEN
    CREATE POLICY notice_case_link_ai_all ON public.notice_case_link_ai FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

-- What the AI reads about a pair: the law check, and each case's step, notices
-- and documents as read (summaries only).
CREATE OR REPLACE FUNCTION public.notice_case_link_ai_context(p_client_id uuid, p_child_key text, p_parent_key text, p_kind text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT * FROM public.notice_case_steps(p_client_id) WHERE own_key IN (p_child_key, p_parent_key)
  ), one AS (
    SELECT s.own_key, jsonb_build_object(
      'case_key', s.own_key, 'step', s.step, 'title', s.title, 'forms', s.forms, 'financial_year', s.financial_year,
      'first_date', s.first_date, 'order', CASE WHEN s.has_order THEN jsonb_build_object('form', s.order_form, 'ref', s.order_ref, 'date', s.order_date) END,
      'notices', coalesce((SELECT jsonb_agg(jsonb_build_object('form', f.form_code, 'type', f.notice_type, 'ref', f.reference_number,
                                                               'date', f.issue_date, 'year', f.financial_year, 'amount', nullif(f.exposure_amount, 0),
                                                               'description', left(f.description, 300)) ORDER BY f.issue_date NULLS LAST)
                             FROM public.notice_facts f
                            WHERE f.client_id = p_client_id AND public.notice_case_key(f.case_id, f.category, f.id) = s.own_key), '[]'::jsonb),
      'documents', coalesce((SELECT jsonb_agg(jsonb_build_object('title', d.title, 'kind', d.doc_kind, 'date', d.doc_date, 'ref', d.reference,
                                                                 'summary', left(d.summary, 700)) ORDER BY d.doc_date NULLS LAST)
                               FROM (SELECT * FROM public.ai_documents d
                                      WHERE d.client_id = p_client_id AND d.case_id = s.own_key AND d.summary IS NOT NULL
                                      ORDER BY d.doc_date DESC NULLS LAST LIMIT 12) d), '[]'::jsonb)) AS j
      FROM s
  )
  SELECT jsonb_build_object(
    'kind', coalesce(p_kind, 'related'),
    'client', (SELECT c.name FROM public.clients c WHERE c.id = p_client_id),
    'check', public.notice_case_link_check(p_client_id, p_child_key, p_parent_key, p_kind),
    'shared_numbers', coalesce((SELECT jsonb_agg(x.ident) FROM (
        SELECT n.ident FROM public.notice_case_numbers(p_client_id) n WHERE n.own_key IN (p_child_key, p_parent_key)
         GROUP BY n.ident HAVING count(DISTINCT n.own_key) = 2) x), '[]'::jsonb),
    'child', (SELECT j FROM one WHERE own_key = p_child_key),
    'parent', (SELECT j FROM one WHERE own_key = p_parent_key))
$$;
REVOKE ALL ON FUNCTION public.notice_case_link_ai_context(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notice_case_link_ai_context(uuid, text, text, text) TO service_role;

-- Every automatic related link through the law gate now.
SELECT public.notice_case_links_refresh(NULL);
