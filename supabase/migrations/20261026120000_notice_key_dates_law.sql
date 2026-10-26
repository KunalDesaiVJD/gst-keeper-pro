-- Notices & Litigation, the law audit of 26 October 2026: the case timeline's
-- key dates (L1 to L8, L10, L13) and the appeal clocks (L9). Additive: one new
-- table (Tribunal appeals recorded by hand), new functions and triggers, and
-- notice_case_key_dates / notice_case_appeals replaced in place. Read §34 of
-- docs/NOTICES_LITIGATION_POSITIONS.md.

-- ── L10. Tribunal appeals are filed on the GSTAT portal, which the extension
-- does not read: staff record them here, against the APL-04 they appeal. ────
CREATE TABLE IF NOT EXISTS public.notice_tribunal_appeals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id),
  order_ref   text NOT NULL,                   -- the APL-04's reference
  arn         text,
  filed_on    date NOT NULL,
  predeposit  numeric,
  status      text NOT NULL DEFAULT 'filed' CHECK (status IN ('filed', 'withdrawn', 'decided')),
  note        text,
  recorded_by text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, order_ref)
);
ALTER TABLE public.notice_tribunal_appeals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notice_tribunal_appeals') THEN
    CREATE POLICY notice_tribunal_appeals_all ON public.notice_tribunal_appeals FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notice_tribunal_appeal_save(p_client_id uuid, p_order_ref text, p_arn text, p_filed_on date,
                                                              p_predeposit numeric, p_status text, p_note text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF nullif(btrim(coalesce(p_order_ref, '')), '') IS NULL OR p_filed_on IS NULL THEN
    RETURN jsonb_build_object('error', 'Give the order appealed and the date the appeal was filed.');
  END IF;
  IF p_filed_on > public.ist_today() THEN RETURN jsonb_build_object('error', 'The filing date cannot be in the future.'); END IF;
  INSERT INTO public.notice_tribunal_appeals (client_id, order_ref, arn, filed_on, predeposit, status, note, recorded_by)
  VALUES (p_client_id, upper(btrim(p_order_ref)), nullif(upper(btrim(coalesce(p_arn, ''))), ''), p_filed_on, p_predeposit,
          coalesce(nullif(p_status, ''), 'filed'), nullif(btrim(coalesce(p_note, '')), ''), left(p_actor, 120))
  ON CONFLICT (client_id, order_ref) DO UPDATE SET arn = EXCLUDED.arn, filed_on = EXCLUDED.filed_on, predeposit = EXCLUDED.predeposit,
         status = EXCLUDED.status, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by, updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_tribunal_appeal_save(uuid, text, text, date, numeric, text, text, text) TO anon, authenticated, service_role;

-- ── The appeal filed against an order, wherever it is on record ─────────────
CREATE OR REPLACE FUNCTION public.notice_order_appeal(p_client_id uuid, p_order_ref text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT x FROM (
    SELECT jsonb_build_object('filed_on', coalesce(a.filed_date, (ff ->> 'filed_on')::date), 'arn', a.arn, 'forum', 'appellate authority') AS x,
           coalesce(a.filed_date, (ff ->> 'filed_on')::date) AS d
      FROM public.gst_portal_applications a
      CROSS JOIN LATERAL (SELECT public.notice_folder_facts('APLCN', public.notice_try_jsonb(a.raw_json #>> '{appItem,itemJson}')) AS ff) f
     WHERE a.client_id = p_client_id AND a.deleted_at IS NULL AND a.case_type_cd = 'APPEL'
       AND upper(btrim(coalesce(a.raw_json #>> '{appItem,refId}', ff ->> 'order_ref', ''))) = upper(btrim(p_order_ref))
    UNION ALL
    SELECT jsonb_build_object('filed_on', (ff ->> 'filed_on')::date, 'arn', fi.case_id, 'forum', 'appellate authority'), (ff ->> 'filed_on')::date
      FROM public.gst_case_folder_items fi
      CROSS JOIN LATERAL (SELECT public.notice_folder_facts(fi.folder_section, fi.raw_json) AS ff) f
     WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND upper(coalesce(fi.folder_section, '')) = 'APLCN'
       AND public.notice_is_appeal_form(fi.raw_json) AND upper(btrim(ff ->> 'order_ref')) = upper(btrim(p_order_ref))
    UNION ALL
    SELECT jsonb_build_object('filed_on', t.filed_on, 'arn', t.arn, 'forum', 'tribunal', 'predeposit', t.predeposit, 'status', t.status), t.filed_on
      FROM public.notice_tribunal_appeals t
     WHERE t.client_id = p_client_id AND t.order_ref = upper(btrim(p_order_ref))
  ) q
  WHERE nullif(btrim(coalesce(p_order_ref, '')), '') IS NOT NULL
  ORDER BY d NULLS LAST LIMIT 1
$$;

-- ── L9. An appeal clock is met once an appeal names its order ───────────────
CREATE OR REPLACE FUNCTION public.matter_deadlines_appeal_met()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ref text; v_ap jsonb;
BEGIN
  IF NEW.deadline_type LIKE 'appeal_%' AND NOT coalesce(NEW.is_met, false) THEN
    SELECT coalesce(nullif(btrim(g.reference_number), ''), nullif(btrim(g.order_number), '')) INTO v_ref
      FROM public.gst_notices g WHERE g.id = NEW.notice_id;
    v_ap := public.notice_order_appeal(NEW.client_id, v_ref);
    IF v_ap IS NOT NULL THEN
      NEW.is_met := true;
      NEW.met_at := coalesce((v_ap ->> 'filed_on')::date, public.ist_today())::timestamptz;
      NEW.met_by := 'auto: appeal filed' || coalesce(' ' || (v_ap ->> 'arn'), '');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_matter_deadlines_appeal_met') THEN
    CREATE TRIGGER trg_matter_deadlines_appeal_met BEFORE INSERT OR UPDATE ON public.matter_deadlines
      FOR EACH ROW EXECUTE FUNCTION public.matter_deadlines_appeal_met();
  END IF;
END $$;

-- When an appeal arrives, its client's open appeal clocks are looked at again.
CREATE OR REPLACE FUNCTION public.notice_appeal_arrived_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.matter_deadlines m SET updated_at = now()
   WHERE m.client_id = NEW.client_id AND m.deadline_type LIKE 'appeal_%' AND NOT m.is_met;
  RETURN NULL;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_portal_applications_appeal_met') THEN
    CREATE TRIGGER trg_portal_applications_appeal_met AFTER INSERT OR UPDATE OF raw_json, filed_date ON public.gst_portal_applications
      FOR EACH ROW WHEN (NEW.case_type_cd = 'APPEL') EXECUTE FUNCTION public.notice_appeal_arrived_touch();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_case_folder_appeal_met') THEN
    CREATE TRIGGER trg_case_folder_appeal_met AFTER INSERT ON public.gst_case_folder_items
      FOR EACH ROW WHEN (upper(coalesce(NEW.folder_section, '')) = 'APLCN') EXECUTE FUNCTION public.notice_appeal_arrived_touch();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tribunal_appeals_appeal_met') THEN
    CREATE TRIGGER trg_tribunal_appeals_appeal_met AFTER INSERT OR UPDATE ON public.notice_tribunal_appeals
      FOR EACH ROW EXECUTE FUNCTION public.notice_appeal_arrived_touch();
  END IF;
END $$;

-- Every appeal clock on record is looked at once now.
UPDATE public.matter_deadlines SET updated_at = now() WHERE deadline_type LIKE 'appeal_%' AND NOT is_met;

-- ── The case's appeals, now with Tribunal appeals recorded by hand and the
-- condonation the forum allows (L10). As 20261025180000 otherwise. ──────────
CREATE OR REPLACE FUNCTION public.notice_case_appeals(p_client_id uuid, p_case_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := public.notice_case_root(p_client_id, p_case_key);
  v_out jsonb;
BEGIN
  WITH filed_raw AS (
    SELECT upper(btrim(fi.case_id)) AS arn, public.notice_folder_facts('APLCN', fi.raw_json) AS f, 1 AS pri
      FROM public.gst_case_folder_items fi
     WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND upper(coalesce(fi.folder_section, '')) = 'APLCN'
       AND public.notice_is_appeal_form(fi.raw_json) AND public.notice_case_root(fi.client_id, fi.case_id) = v_key
    UNION ALL
    SELECT upper(btrim(a.arn)),
           coalesce(public.notice_folder_facts('APLCN', public.notice_try_jsonb(a.raw_json #>> '{appItem,itemJson}')), '{}'::jsonb)
             || jsonb_strip_nulls(jsonb_build_object('portal_status', a.status, 'filed_on', a.filed_date,
                  'order_ref', nullif(btrim(a.raw_json #>> '{appItem,refId}'), ''))), 2
      FROM public.gst_portal_applications a
     WHERE a.client_id = p_client_id AND a.deleted_at IS NULL AND a.case_type_cd = 'APPEL' AND nullif(btrim(a.arn), '') IS NOT NULL
       AND public.notice_case_root(a.client_id, upper(btrim(a.arn))) = v_key
    UNION ALL
    -- 20261026120000: a Tribunal appeal staff recorded against an APL-04 of this case.
    SELECT coalesce(t.arn, 'GSTAT:' || t.order_ref),
           jsonb_strip_nulls(jsonb_build_object('order_ref', t.order_ref, 'filed_on', t.filed_on, 'predeposit', t.predeposit,
             'second_appeal', true, 'forum', 'tribunal',
             'portal_status', CASE t.status WHEN 'withdrawn' THEN 'Appeal Withdrawn' WHEN 'decided' THEN 'Disposed' ELSE 'Filed before the Tribunal' END)), 0
      FROM public.notice_tribunal_appeals t
     WHERE t.client_id = p_client_id
       AND EXISTS (SELECT 1 FROM public.notice_facts n WHERE n.client_id = p_client_id AND upper(btrim(n.reference_number)) = t.order_ref
                     AND public.notice_case_key(n.client_id, n.case_id, n.category, n.id) = v_key)
  ), filed AS (
    SELECT arn,
           (SELECT f FROM filed_raw r WHERE r.arn = x.arn AND r.f ? 'order_ref' ORDER BY r.pri LIMIT 1) AS f,
           (SELECT r.f ->> 'portal_status' FROM filed_raw r WHERE r.arn = x.arn AND r.f ? 'portal_status' ORDER BY r.pri LIMIT 1) AS portal_status,
           (SELECT min((r.f ->> 'filed_on')::date) FROM filed_raw r WHERE r.arn = x.arn) AS filed_on
      FROM (SELECT DISTINCT arn FROM filed_raw) x
  ), appeals AS (
    SELECT upper(btrim(f ->> 'order_ref')) AS appeal_key, 'filed'::text AS status, arn, filed_on, portal_status, f
      FROM filed WHERE nullif(btrim(f ->> 'order_ref'), '') IS NOT NULL
    UNION ALL
    (SELECT DISTINCT ON (upper(btrim(n.reference_number))) upper(btrim(n.reference_number)), 'to_file', NULL, NULL, NULL,
           jsonb_strip_nulls(jsonb_build_object('order_ref', btrim(n.reference_number), 'order_date', n.issue_date))
      FROM public.notice_facts n
     WHERE n.client_id = p_client_id AND public.notice_case_key(n.client_id, n.case_id, n.category, n.id) = v_key
       AND n.form_code = ANY (public.notice_appealable_forms()) AND nullif(btrim(n.reference_number), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM filed WHERE upper(btrim(filed.f ->> 'order_ref')) = upper(btrim(n.reference_number)))
     ORDER BY upper(btrim(n.reference_number)), n.issue_date DESC NULLS LAST)
  )
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'appeal_key', a.appeal_key, 'status', a.status, 'arn', a.arn, 'filed_on', a.filed_on, 'portal_status', a.portal_status,
           'order_ref', a.f ->> 'order_ref',
           'order_date', coalesce((a.f ->> 'order_date')::date, o.issue_date),
           'order_comm_date', (a.f ->> 'order_comm_date')::date,
           'order_form', o.form_code, 'order_notice_id', o.id,
           'forum', CASE WHEN o.form_code = 'APL-04' OR a.f ->> 'forum' = 'tribunal' THEN 'tribunal' ELSE 'appellate authority' END,
           'last_day', CASE WHEN o.form_code = 'APL-04'
                              AND coalesce((a.f ->> 'order_comm_date')::date, (a.f ->> 'order_date')::date, o.issue_date) < DATE '2026-04-01'
                            -- Tribunal backlog: orders communicated before 1 Apr 2026 could be appealed until 30 Jun 2026.
                            THEN greatest((coalesce((a.f ->> 'order_comm_date')::date, (a.f ->> 'order_date')::date, o.issue_date) + interval '3 months')::date, DATE '2026-06-30')
                            ELSE (coalesce((a.f ->> 'order_comm_date')::date, (a.f ->> 'order_date')::date, o.issue_date) + interval '3 months')::date END,
           'condonation_months', CASE WHEN o.form_code = 'APL-04' THEN coalesce(public.litigation_rule_value('condonation_months.s112'), 3)::int ELSE 1 END,
           'disputed_tax', a.f -> 'disputed_tax', 'disputed_total', a.f -> 'disputed_total',
           'predeposit', a.f -> 'predeposit', 'predeposit_pct', a.f -> 'predeposit_pct',
           'second_appeal', a.f -> 'second_appeal', 'issues', a.f -> 'issues',
           'demand', o.amount_of_demand,
           'drafts', (SELECT jsonb_object_agg(d.doc_type, jsonb_build_object('version', d.version, 'status', d.status, 'source', d.source,
                                                                              'at', d.created_at, 'by', d.author_name))
                        FROM (SELECT DISTINCT ON (doc_type) * FROM public.notice_appeal_drafts dd
                               WHERE dd.client_id = p_client_id AND dd.appeal_key = a.appeal_key
                               ORDER BY doc_type, version DESC) d)))
           ORDER BY (a.status = 'filed') DESC, a.filed_on DESC NULLS LAST, a.appeal_key)
    INTO v_out
    FROM appeals a
    LEFT JOIN LATERAL (SELECT g.id, g.form_code, g.issue_date, g.amount_of_demand FROM public.gst_notices g
                        WHERE g.client_id = p_client_id AND g.deleted_at IS NULL AND upper(btrim(g.reference_number)) = a.appeal_key
                        ORDER BY g.issue_date DESC NULLS LAST LIMIT 1) o ON true;
  RETURN coalesce(v_out, '[]'::jsonb);
END;
$$;

-- ── The case timeline's key dates (20261025140000, 20261025170000), now with
-- the law of the audit of 26 Oct 2026. ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_key_dates(p_client_id uuid, p_case_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_root text := public.notice_case_root(p_client_id, p_case_key);
  v_today date := public.ist_today();
  v_items jsonb;
  v_ev jsonb := '[]'::jsonb;
  o record;
  h record;
  v_ap jsonb;
  v_comm date;
  v_last date;
  v_condone date;
  v_filed date;
  v_tribunal boolean;
  v_cond_law text;
  v_req numeric;
  v_pct numeric;
  v_sec text;
  v_fy text;
  v_fy_start int;
  v_lim jsonb;
  v_scn_by date;
  v_order_by date;
  v_law text;
  v_basis text;
  v_kind text;
  v_chk jsonb;
  v_has_order boolean;
  v_scn record;
  v_d date;
  v_case_fy text;
  v_case_sec text;
BEGIN
  IF v_root IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kind', c.kind, 'id', c.item_id, 'own_key', c.own_key, 'reference', c.reference, 'date', c.item_date,
           'section', upper(coalesce(c.folder_section, '')), 'label', c.label,
           'form', f.form_code, 'is_open', f.is_open, 'effective_due', f.effective_due, 'issue_date', f.issue_date,
           -- 20261026120000: the year, section, demand and hearing of a notice.
           'fy', f.financial_year, 'sec', g.section_of_law, 'demand', coalesce(g.amount_of_demand, g.demand_total), 'hearing_date', g.hearing_date,
           'facts', public.notice_case_item_facts(c.client_id, c.kind, c.item_id, c.own_key, c.reference))), '[]'::jsonb)
    INTO v_items
    FROM public.notice_case_correspondence c
    LEFT JOIN public.notice_facts f ON c.kind = 'notice' AND f.id = c.item_id
    LEFT JOIN public.gst_notices g ON c.kind = 'notice' AND g.id = c.item_id
   WHERE c.client_id = p_client_id AND c.case_key = v_root;

  -- The case's year and section, from its show cause notices and orders, for a paper that states neither.
  SELECT coalesce(x #>> '{facts,fy}', x ->> 'fy'), coalesce(x #>> '{facts,section_of_law}', x ->> 'sec')
    INTO v_case_fy, v_case_sec
    FROM jsonb_array_elements(v_items) x
   WHERE x ->> 'kind' = 'notice' AND x ->> 'form' IN ('DRC-01', 'DRC-01A', 'DRC-07')
     AND coalesce(x #>> '{facts,fy}', x ->> 'fy') IS NOT NULL
   ORDER BY (coalesce(x #>> '{facts,section_of_law}', x ->> 'sec') IS NOT NULL) DESC, (x ->> 'date') DESC NULLS LAST
   LIMIT 1;

  -- Personal hearings, each once (a notice and an item may name the same one).
  FOR h IN
    SELECT DISTINCT ON ((x #>> '{facts,hearing,date}'), coalesce(x #>> '{facts,hearing,time}', ''))
           (x #>> '{facts,hearing,date}')::date AS d, x #>> '{facts,hearing,time}' AS t, x #>> '{facts,hearing,venue}' AS venue,
           x ->> 'own_key' AS own_key, x ->> 'reference' AS ref, x ->> 'id' AS id, x ->> 'kind' AS kind
      FROM jsonb_array_elements(v_items) x
     WHERE x #>> '{facts,hearing,date}' IS NOT NULL
     ORDER BY (x #>> '{facts,hearing,date}'), coalesce(x #>> '{facts,hearing,time}', ''), (x ->> 'kind' = 'notice') DESC
  LOOP
    v_ev := v_ev || jsonb_build_object('date', h.d, 'kind', 'hearing', 'own_key', h.own_key, 'item_id', h.id,
      'title', 'Personal hearing' || coalesce(' at ' || h.t, ''),
      'detail', concat_ws(' · ', h.venue, CASE WHEN h.ref IS NOT NULL THEN 'fixed by ' || h.ref END),
      'tone', CASE WHEN h.d >= v_today THEN 'warn' ELSE 'muted' END, 'law', 's.75(4)');
  END LOOP;

  -- Adjournments granted, counted in each portal case (at most three, s.75(5)).
  FOR h IN
    SELECT (x ->> 'date')::date AS d, x ->> 'own_key' AS own_key, x ->> 'reference' AS ref, x ->> 'id' AS id,
           row_number() OVER (PARTITION BY x ->> 'own_key' ORDER BY x ->> 'date', x ->> 'reference') AS n
      FROM jsonb_array_elements(v_items) x
     WHERE (x #>> '{facts,type}' ILIKE '%adjourn%' OR x ->> 'form' = 'ADJOURNMENT') AND x ->> 'date' IS NOT NULL
  LOOP
    v_ev := v_ev || jsonb_build_object('date', h.d, 'kind', 'adjournment', 'own_key', h.own_key, 'item_id', h.id,
      'title', 'Adjournment ' || h.n || ' of the 3 the law allows',
      'detail', CASE WHEN h.n >= 3 THEN 'No further adjournment can be granted in these proceedings.'
                     ELSE (3 - h.n) || ' more can be granted, each for sufficient cause.' END,
      'tone', CASE WHEN h.n >= 3 THEN 'danger' ELSE 'info' END, 'law', 's.75(5)');
  END LOOP;

  -- Replies still due on open notices.
  FOR h IN
    SELECT (x ->> 'effective_due')::date AS d, x ->> 'own_key' AS own_key, x ->> 'id' AS id, x ->> 'label' AS label
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' = 'notice' AND (x ->> 'is_open')::boolean AND x ->> 'effective_due' IS NOT NULL
       AND coalesce(x ->> 'form', '') <> ALL (public.notice_appealable_forms() || ARRAY['ADJOURNMENT'])
  LOOP
    v_ev := v_ev || jsonb_build_object('date', h.d, 'kind', 'reply_due', 'own_key', h.own_key, 'item_id', h.id,
      'title', 'Reply due', 'detail', h.label,
      'tone', CASE WHEN h.d < v_today THEN 'danger' WHEN h.d <= v_today + 7 THEN 'warn' ELSE 'info' END);
  END LOOP;

  -- L4, L5. Intimations and show cause notices: the windows to pay and close.
  --   s.73(5): tax and interest before a notice, no penalty; s.74(5): with 15%;
  --   s.73(8): within 30 days of the notice, no penalty; s.74(8): with 25%;
  --   s.74A (FY 2024-25 on): within 60 days of the notice, no penalty, or 25%
  --   where fraud or suppression is alleged (s.74A(8), (9)).
  FOR h IN
    SELECT x ->> 'form' AS form, coalesce((x ->> 'issue_date')::date, (x ->> 'date')::date) AS d, x ->> 'own_key' AS own_key, x ->> 'id' AS id,
           coalesce(x #>> '{facts,section_of_law}', x ->> 'sec') AS sec, coalesce(x #>> '{facts,fy}', x ->> 'fy') AS fy,
           coalesce((x #>> '{facts,due}')::date, (x ->> 'effective_due')::date) AS due
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' = 'notice' AND x ->> 'form' IN ('DRC-01', 'DRC-01A')
       AND coalesce(x #>> '{facts,type}', '') NOT ILIKE '%adjourn%'
  LOOP
    CONTINUE WHEN h.d IS NULL;
    v_fy_start := public.notice_fy_start(h.fy);
    v_sec := replace(upper(substring(coalesce(h.sec, '') FROM '^\s*(74\s*A|73|74)')), ' ', '');
    IF v_sec = '74A' OR v_fy_start >= 2024 THEN
      IF h.form = 'DRC-01A' THEN
        v_ev := v_ev || jsonb_build_object('date', coalesce(h.due, h.d + 30), 'kind', 'pay_to_close', 'own_key', h.own_key, 'item_id', h.id,
          'title', 'Pay before a show cause notice to close',
          'detail', 'Tax and interest paid by DRC-03 before a DRC-01 is issued end the matter with no penalty, or with 15% where fraud or suppression is alleged. The window lasts until the DRC-01; the date shown is the intimation''s reply date.',
          'tone', CASE WHEN coalesce(h.due, h.d + 30) >= v_today THEN 'warn' ELSE 'muted' END, 'law', 's.74A(8), (9)');
      ELSE
        v_ev := v_ev || jsonb_build_object('date', h.d + coalesce(public.litigation_rule_value('reduced_penalty_days.s74a'), 60)::int,
          'kind', 'pay_to_close', 'own_key', h.own_key, 'item_id', h.id,
          'title', 'Last day to pay and close: no penalty, or 25% where fraud is alleged',
          'detail', 'Tax and interest paid within 60 days of the show cause notice conclude the proceedings (s.74A(8)); where fraud or suppression is alleged, with 25% of the tax as penalty (s.74A(9)).',
          'tone', CASE WHEN h.d + 60 >= v_today THEN 'warn' ELSE 'muted' END, 'law', 's.74A(8), (9)');
      END IF;
      CONTINUE;
    END IF;
    CONTINUE WHEN v_sec IS NULL;
    IF h.form = 'DRC-01A' THEN
      v_ev := v_ev || jsonb_build_object('date', coalesce(h.due, h.d + 30), 'kind', 'pay_to_close', 'own_key', h.own_key, 'item_id', h.id,
        'title', CASE WHEN v_sec = '73' THEN 'Pay tax and interest before a show cause notice: no penalty'
                      ELSE 'Pay with a 15% penalty before a show cause notice' END,
        'detail', CASE WHEN v_sec = '73' THEN 'Tax and interest paid by DRC-03 against the DRC-01A before a DRC-01 is issued end the matter with no penalty and no notice (s.73(5), (6)).'
                       ELSE 'Tax, interest and 15% of the tax paid by DRC-03 against the DRC-01A before a DRC-01 is issued end the matter (s.74(5), (6)).' END
                  || ' The window lasts until the DRC-01; the date shown is the intimation''s reply date.',
        'tone', CASE WHEN coalesce(h.due, h.d + 30) >= v_today THEN 'warn' ELSE 'muted' END,
        'law', CASE WHEN v_sec = '73' THEN 's.73(5)' ELSE 's.74(5)' END);
    ELSE
      v_ev := v_ev || jsonb_build_object('date', h.d + 30, 'kind', 'pay_to_close', 'own_key', h.own_key, 'item_id', h.id,
        'title', CASE WHEN v_sec = '73' THEN 'Last day to pay tax and interest with no penalty'
                      ELSE 'Last day to pay with a 25% penalty and close' END,
        'detail', 'Within 30 days of the show cause notice; the proceedings are then deemed concluded.',
        'tone', CASE WHEN h.d + 30 >= v_today THEN 'warn' ELSE 'muted' END,
        'law', CASE WHEN v_sec = '73' THEN 's.73(8)' ELSE 's.74(8)' END);
    END IF;
  END LOOP;

  -- L1. Limitation: the last date for an order, and an SCN issued too late.
  -- One line per portal case, from its latest show cause notice (or intimation,
  -- scrutiny or audit notice when there is no SCN).
  FOR v_scn IN
    SELECT DISTINCT ON (x ->> 'own_key')
           x ->> 'own_key' AS own_key, x ->> 'id' AS id, x ->> 'form' AS form,
           coalesce((x ->> 'issue_date')::date, (x ->> 'date')::date) AS d,
           coalesce(x #>> '{facts,fy}', x ->> 'fy', v_case_fy) AS fy,
           coalesce(x #>> '{facts,section_of_law}', x ->> 'sec', v_case_sec) AS sec
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' = 'notice' AND x ->> 'form' IN ('DRC-01', 'DRC-01A', 'ASMT-10', 'ADT-02')
       AND coalesce(x #>> '{facts,type}', '') NOT ILIKE '%adjourn%'
     ORDER BY x ->> 'own_key', (x ->> 'form' = 'DRC-01') DESC, coalesce(x ->> 'issue_date', x ->> 'date') DESC NULLS LAST
  LOOP
    CONTINUE WHEN v_scn.fy IS NULL OR v_scn.d IS NULL;
    v_sec := replace(upper(substring(coalesce(v_scn.sec, '') FROM '^\s*(74\s*A|73|74)')), ' ', '');
    v_lim := public.notice_limitation(v_scn.fy, v_sec);
    CONTINUE WHEN v_lim IS NULL;
    -- An order (or a closing) of the same portal case, or of the same year in the chain.
    v_has_order := EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) y
                            WHERE y ->> 'kind' = 'notice' AND y ->> 'form' IN ('DRC-07', 'DROPPED', 'ACCEPTED')
                              AND (y ->> 'own_key' = v_scn.own_key
                                   OR public.notice_fy_start(coalesce(y #>> '{facts,fy}', y ->> 'fy')) = public.notice_fy_start(v_scn.fy)));
    IF v_lim ->> 'regime' = '74A' THEN
      v_scn_by := (v_lim ->> 'scn_by')::date; v_law := 's.74A(2)';
      v_order_by := CASE WHEN v_scn.form = 'DRC-01' THEN (v_scn.d + make_interval(months => coalesce((v_lim ->> 'order_months')::int, 12)))::date END;
      v_basis := 's.74A(7): 12 months from the notice, extendable by 6';
    ELSIF v_sec = '74' THEN
      v_scn_by := (v_lim ->> 's74_scn_by')::date; v_order_by := (v_lim ->> 's74_order_by')::date; v_law := 's.74(2)';
      v_basis := 's.74(10): 5 years from the annual return due date of ' || to_char((v_lim ->> 'annual_return_due')::date, 'DD Mon YYYY');
    ELSE
      v_scn_by := (v_lim ->> 's73_scn_by')::date; v_order_by := (v_lim ->> 's73_order_by')::date; v_law := 's.73(2)';
      v_basis := coalesce(v_lim ->> 's73_basis', 's.73(10)') || ', for FY ' || (v_lim ->> 'fy');
    END IF;

    IF v_scn.form = 'DRC-01' AND v_scn_by IS NOT NULL AND v_scn.d > v_scn_by THEN
      v_ev := v_ev || jsonb_build_object('date', v_scn.d, 'kind', 'limitation', 'own_key', v_scn.own_key, 'item_id', v_scn.id,
        'title', 'Show cause notice issued after the last date the law allows',
        'detail', 'For FY ' || (v_lim ->> 'fy') || ' the notice had to issue by ' || to_char(v_scn_by, 'DD Mon YYYY')
                  || ' (' || v_law || '). Raise limitation first, before the merits.',
        'tone', 'danger', 'law', v_law, 'ground', true);
    END IF;

    IF NOT v_has_order AND v_order_by IS NOT NULL THEN
      IF v_order_by >= v_today THEN
        v_ev := v_ev || jsonb_build_object('date', v_order_by, 'kind', 'limitation', 'own_key', v_scn.own_key, 'item_id', v_scn.id,
          'title', 'Last date for an order' || CASE WHEN v_sec IN ('73', '74', '74A') THEN ' under s.' || v_sec ELSE ' under s.73' END
                   || ', FY ' || (v_lim ->> 'fy'),
          'detail', 'An order after this date is time-barred (' || v_basis || ').'
                    || CASE WHEN v_sec IS NULL AND v_lim ->> 's74_order_by' IS NOT NULL
                            THEN ' Where fraud or suppression is alleged (s.74), the order can come up to ' || to_char((v_lim ->> 's74_order_by')::date, 'DD Mon YYYY') || '.' ELSE '' END,
          'tone', CASE WHEN v_order_by <= v_today + 30 THEN 'warn' ELSE 'info' END,
          'law', CASE WHEN v_lim ->> 'regime' = '74A' THEN 's.74A(7)' WHEN v_sec = '74' THEN 's.74(10)' ELSE 's.73(10)' END);
      ELSE
        v_ev := v_ev || jsonb_build_object('date', v_order_by, 'kind', 'limitation', 'own_key', v_scn.own_key, 'item_id', v_scn.id,
          'title', 'Time for an order' || CASE WHEN v_sec IN ('73', '74', '74A') THEN ' under s.' || v_sec ELSE ' under s.73' END
                   || ' ended, no order on record',
          'detail', 'Unless an order exists that is not synced, the proceedings for FY ' || (v_lim ->> 'fy') || ' are time-barred (' || v_basis || ').'
                    || CASE WHEN coalesce(v_sec, '73') = '73' AND (v_lim ->> 's74_order_by')::date >= v_today
                            THEN ' Only proceedings alleging fraud or suppression (s.74) remain possible, up to ' || to_char((v_lim ->> 's74_order_by')::date, 'DD Mon YYYY') || '.'
                            WHEN coalesce(v_sec, '73') = '73' AND v_lim ->> 's74_order_by' IS NOT NULL
                            THEN ' The time under s.74 also ended on ' || to_char((v_lim ->> 's74_order_by')::date, 'DD Mon YYYY') || '. Check the portal, then close with a note.'
                            ELSE ' Check the portal, then close with a note.' END,
          'tone', 'ok', 'law', CASE WHEN v_lim ->> 'regime' = '74A' THEN 's.74A(7)' WHEN v_sec = '74' THEN 's.74(10)' ELSE 's.73(10)' END,
          'time_barred', true);
      END IF;
    END IF;
  END LOOP;

  -- Orders: the time to appeal, whether an appeal was filed in time, its
  -- pre-deposit, the payment date, the windows to close, and (L1, L6, L7, L8,
  -- L13) limitation, deemed withdrawal, revocation, rectification and checks.
  FOR o IN
    SELECT x ->> 'form' AS form, x ->> 'id' AS id, x ->> 'own_key' AS own_key, x ->> 'reference' AS ref, (x ->> 'is_open')::boolean AS is_open,
           coalesce((x ->> 'issue_date')::date, (x ->> 'date')::date) AS d, x -> 'facts' AS facts,
           coalesce(x #>> '{facts,fy}', x ->> 'fy', v_case_fy) AS fy, coalesce(x #>> '{facts,section_of_law}', x ->> 'sec', v_case_sec) AS sec,
           (x ->> 'demand')::numeric AS demand
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' = 'notice' AND x ->> 'form' = ANY (public.notice_appealable_forms())
  LOOP
    CONTINUE WHEN o.d IS NULL;
    v_tribunal := o.form = 'APL-04';
    v_kind := CASE WHEN v_tribunal THEN 'tribunal' WHEN o.form = 'MOV-09' THEN 's129' ELSE 'first' END;
    -- The appeal against this order: its application names the order; a
    -- Tribunal appeal is recorded by hand (notice_tribunal_appeals).
    SELECT x -> 'facts' INTO v_ap
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' IN ('document', 'application') AND x #>> '{facts,order_ref}' IS NOT NULL
       AND upper(x #>> '{facts,order_ref}') = upper(coalesce(o.ref, ''))
     ORDER BY (x #>> '{facts,filed_on}') NULLS LAST
     LIMIT 1;
    IF v_ap IS NULL AND v_tribunal THEN
      SELECT jsonb_strip_nulls(jsonb_build_object('order_ref', t.order_ref, 'filed_on', t.filed_on, 'predeposit', t.predeposit, 'arn', t.arn))
        INTO v_ap FROM public.notice_tribunal_appeals t WHERE t.client_id = p_client_id AND t.order_ref = upper(btrim(coalesce(o.ref, '')));
    END IF;
    v_comm := coalesce((v_ap ->> 'order_comm_date')::date, o.d);
    v_last := (v_comm + interval '3 months')::date;
    -- Tribunal backlog: an order communicated before 1 Apr 2026 could be appealed until 30 Jun 2026.
    IF v_tribunal AND v_comm < DATE '2026-04-01' THEN v_last := greatest(v_last, DATE '2026-06-30'); END IF;
    v_condone := (v_last + CASE WHEN v_tribunal THEN interval '3 months' ELSE interval '1 month' END)::date;
    v_cond_law := CASE WHEN v_tribunal THEN 's.112(6)' ELSE 's.107(4)' END;
    v_filed := (v_ap ->> 'filed_on')::date;
    IF v_ap IS NOT NULL AND v_filed IS NOT NULL THEN
      v_ev := v_ev || jsonb_build_object('date', v_filed, 'kind', 'appeal_filed', 'own_key', o.own_key, 'item_id', o.id,
        'title', CASE WHEN v_filed < v_last THEN 'Appeal filed in time'
                      WHEN v_filed = v_last THEN 'Appeal filed on the last day of the 3 months'
                      WHEN v_filed <= v_condone THEN 'Appeal filed ' || (v_filed - v_last) || ' day' || CASE WHEN v_filed - v_last = 1 THEN '' ELSE 's' END || ' after the 3 months'
                      ELSE 'Appeal filed after the time the law allows' END,
        'detail', 'Against ' || coalesce(o.form || ' ', '') || coalesce(o.ref, 'the order') || ' communicated on ' || to_char(v_comm, 'DD Mon YYYY')
                  || '; the time ran to ' || to_char(v_last, 'DD Mon YYYY') || ' (the day of the order not counted)'
                  || CASE WHEN v_filed > v_last AND v_filed <= v_condone
                          THEN '. The authority may condone a delay up to ' || to_char(v_condone, 'DD Mon YYYY') || ' for sufficient cause' ELSE '' END
                  || CASE WHEN v_ap ->> 'order_comm_date' IS NULL THEN '. Counted from the order''s date: if it reached the client later, the time runs from then' ELSE '' END || '.',
        'tone', CASE WHEN v_filed <= v_last THEN 'ok' WHEN v_filed <= v_condone THEN 'warn' ELSE 'danger' END,
        'law', CASE WHEN v_tribunal THEN 's.112(1)' ELSE 's.107(1)' END);

      -- L2, L3. The pre-deposit, per Act where the record gives the heads.
      v_chk := public.notice_predeposit_required(v_ap -> 'amounts', v_kind, v_filed);
      IF v_chk IS NOT NULL AND jsonb_array_length(v_chk -> 'heads') > 0 THEN
        v_ev := v_ev || jsonb_build_object('date', v_filed, 'kind', 'predeposit', 'own_key', o.own_key, 'item_id', o.id,
          'title', CASE WHEN (v_chk ->> 'ok')::boolean THEN 'Pre-deposit of ' || public.notice_inr((v_chk ->> 'paid')::numeric) || ' paid with the appeal'
                        ELSE 'Pre-deposit short on ' || (SELECT string_agg(s, ', ') FROM jsonb_array_elements_text(v_chk -> 'short') s) END,
          'detail', (SELECT string_agg(upper(hd ->> 'head') || ': ' || public.notice_inr((hd ->> 'paid')::numeric) || ' paid of '
                                       || public.notice_inr((hd ->> 'required')::numeric)
                                       || CASE WHEN (hd ->> 'admitted')::numeric > 0 THEN ' (admitted ' || public.notice_inr((hd ->> 'admitted')::numeric) || ')' ELSE '' END
                                       || CASE WHEN (hd ->> 'capped')::boolean THEN ' (capped)' ELSE '' END, '; ')
                       FROM jsonb_array_elements(v_chk -> 'heads') hd)
                    || '. ' || trim(to_char((v_chk ->> 'pct')::numeric, 'FM990.##')) || '% of the ' || (v_chk ->> 'on') || ' in dispute, per Act'
                    || CASE WHEN v_kind = 'first' THEN ', with the admitted amount in full' ELSE '' END || '.'
                    || coalesce(' ' || (v_chk ->> 'note'), '')
                    || coalesce(' Paid by PRN ' || (v_ap ->> 'predeposit_prn') || '.', '')
                    || CASE WHEN (v_chk ->> 'ok')::boolean THEN ' Recovery of the rest is stayed while the appeal is pending.' ELSE '' END,
          'tone', CASE WHEN (v_chk ->> 'ok')::boolean THEN 'ok' ELSE 'danger' END,
          'prn', v_ap ->> 'predeposit_prn', 'heads', v_chk -> 'heads',
          'law', CASE WHEN v_tribunal THEN 's.112(8), s.112(9)' WHEN v_kind = 's129' THEN 'proviso to s.107(6)' ELSE 's.107(6), s.107(7)' END);
      ELSE
        v_pct := coalesce((v_ap ->> 'predeposit_pct')::numeric,
                          CASE WHEN v_tribunal AND v_filed < DATE '2024-11-01' THEN 20
                               WHEN v_tribunal THEN coalesce(public.litigation_rule_value('predeposit_pct.s112'), 10)
                               ELSE coalesce(public.litigation_rule_value('predeposit_pct.s107'), 10) END);
        IF (v_ap ->> 'disputed_tax') IS NOT NULL AND (v_ap ->> 'predeposit') IS NULL THEN
          -- 20261025170000: no amount on the portal record is not "₹0 paid".
          v_req := round((v_ap ->> 'disputed_tax')::numeric * v_pct / 100);
          v_ev := v_ev || jsonb_build_object('date', v_filed, 'kind', 'predeposit', 'own_key', o.own_key, 'item_id', o.id,
            'title', 'Pre-deposit not shown on the portal record',
            'detail', trim(to_char(v_pct, 'FM990.##')) || '% of the tax in dispute, ' || public.notice_inr((v_ap ->> 'disputed_tax')::numeric)
                      || ', is ' || public.notice_inr(v_req) || '. Check the payment on the APL-01 or the APL-02.',
            'tone', 'info',
            'law', CASE WHEN v_tribunal THEN 's.112(8), s.112(9)' ELSE 's.107(6), s.107(7)' END);
        ELSIF (v_ap ->> 'disputed_tax') IS NOT NULL THEN
          v_req := round((v_ap ->> 'disputed_tax')::numeric * v_pct / 100);
          v_ev := v_ev || jsonb_build_object('date', v_filed, 'kind', 'predeposit', 'own_key', o.own_key, 'item_id', o.id,
            'title', CASE WHEN (v_ap ->> 'predeposit')::numeric + 1 >= v_req
                          THEN 'Pre-deposit of ' || public.notice_inr((v_ap ->> 'predeposit')::numeric) || ' paid with the appeal'
                          ELSE 'Pre-deposit short: ' || public.notice_inr((v_ap ->> 'predeposit')::numeric) || ' paid, ' || public.notice_inr(v_req) || ' required' END,
            'detail', trim(to_char(v_pct, 'FM990.##')) || '% of the tax in dispute, ' || public.notice_inr((v_ap ->> 'disputed_tax')::numeric)
                      || ', is ' || public.notice_inr(v_req) || coalesce(' (total in dispute ' || public.notice_inr((v_ap ->> 'disputed_total')::numeric) || ')', '')
                      || coalesce('. Paid by PRN ' || (v_ap ->> 'predeposit_prn'), '')
                      || '. The record gives no amounts per Act, so CGST, SGST and IGST could not be checked one by one.',
            'tone', CASE WHEN (v_ap ->> 'predeposit')::numeric + 1 >= v_req THEN 'ok' ELSE 'danger' END,
            'prn', v_ap ->> 'predeposit_prn',
            'law', CASE WHEN v_tribunal THEN 's.112(8), s.112(9)' ELSE 's.107(6), s.107(7)' END);
        ELSIF (v_ap ->> 'predeposit') IS NOT NULL THEN
          v_ev := v_ev || jsonb_build_object('date', v_filed, 'kind', 'predeposit', 'own_key', o.own_key, 'item_id', o.id,
            'title', 'Pre-deposit of ' || public.notice_inr((v_ap ->> 'predeposit')::numeric) || ' recorded',
            'detail', 'Recorded with the appeal; the tax in dispute is not on record, so the amount could not be checked against '
                      || trim(to_char(v_pct, 'FM990.##')) || '%.',
            'tone', 'info', 'law', CASE WHEN v_tribunal THEN 's.112(8)' ELSE 's.107(6)' END);
        END IF;
      END IF;
    ELSIF v_ap IS NOT NULL THEN
      v_ev := v_ev || jsonb_build_object('date', v_last, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'Appeal filed (date not on the portal record)', 'detail', 'The time to appeal ran to ' || to_char(v_last, 'DD Mon YYYY') || '.',
        'tone', 'info', 'law', CASE WHEN v_tribunal THEN 's.112(1)' ELSE 's.107(1)' END);
    ELSIF v_today <= v_last THEN
      v_ev := v_ev || jsonb_build_object('date', v_last, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'Last day to appeal ' || coalesce(o.form || ' ', '') || coalesce(o.ref, 'the order'),
        'detail', (v_last - v_today) || ' days left. Then up to ' || to_char(v_condone, 'DD Mon YYYY') || ' only with a delay the authority condones.'
                  || CASE WHEN v_tribunal THEN ' A Tribunal appeal is filed on the GSTAT portal: record it on the Appeal view once filed.' ELSE '' END,
        'tone', 'warn', 'law', CASE WHEN v_tribunal THEN 's.112(1)' ELSE 's.107(1)' END);
    ELSIF v_today <= v_condone THEN
      v_ev := v_ev || jsonb_build_object('date', v_last, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'The time to appeal ended, no appeal on record',
        'detail', 'An appeal can still be filed up to ' || to_char(v_condone, 'DD Mon YYYY') || ' with reasons for the delay.',
        'tone', 'danger', 'law', v_cond_law);
    ELSIF o.is_open OR o.form IN ('DRC-07', 'APL-04') THEN
      v_ev := v_ev || jsonb_build_object('date', v_condone, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'Time to appeal ' || coalesce(o.form || ' ', '') || coalesce(o.ref, 'the order') || ' is over, no appeal on record',
        'detail', 'The time ran to ' || to_char(v_last, 'DD Mon YYYY') || ', the condonable time to ' || to_char(v_condone, 'DD Mon YYYY') || '.'
                  || CASE WHEN v_tribunal THEN ' If a Tribunal appeal was filed on the GSTAT portal, record it on the Appeal view.' ELSE '' END,
        'tone', CASE WHEN o.is_open THEN 'danger' ELSE 'muted' END, 'law', v_cond_law);
    END IF;

    IF o.form = 'DRC-07' THEN
      IF (o.facts ->> 'due') IS NOT NULL THEN
        v_ev := v_ev || jsonb_build_object('date', (o.facts ->> 'due')::date, 'kind', 'payment_due', 'own_key', o.own_key, 'item_id', o.id,
          'title', 'Demand payable by this date',
          'detail', CASE WHEN v_filed IS NOT NULL AND v_filed <= (o.facts ->> 'due')::date THEN 'Recovery of the rest is stayed by the appeal and its pre-deposit.'
                         WHEN v_filed IS NOT NULL THEN 'The appeal was filed after this date; recovery of the rest is stayed from the pre-deposit.'
                         ELSE 'Unpaid after this date, the demand can be recovered (s.79).' END,
          'tone', CASE WHEN v_filed IS NOT NULL OR (o.facts ->> 'due')::date < v_today THEN 'muted' ELSE 'warn' END, 'law', 's.78');
      END IF;
      v_sec := replace(upper(substring(coalesce(o.sec, '') FROM '^\s*(74\s*A|73|74)')), ' ', '');
      v_fy_start := public.notice_fy_start(o.fy);
      IF v_sec = '74' AND (v_fy_start IS NULL OR v_fy_start < 2024) THEN
        v_ev := v_ev || jsonb_build_object('date', v_comm + 30, 'kind', 'pay_to_close', 'own_key', o.own_key, 'item_id', o.id,
          'title', 'Last day to pay with a 50% penalty and close',
          'detail', 'Tax, interest and 50% of the penalty paid within 30 days of the order ends the proceedings.',
          'tone', CASE WHEN v_comm + 30 >= v_today THEN 'warn' ELSE 'muted' END, 'law', 's.74(11)');
      ELSIF v_sec = '74A' OR v_fy_start >= 2024 THEN
        v_ev := v_ev || jsonb_build_object('date', v_comm + 60, 'kind', 'pay_to_close', 'own_key', o.own_key, 'item_id', o.id,
          'title', 'Last day to pay with a 50% penalty and close (where fraud is held)',
          'detail', 'Where the order holds fraud or suppression, tax, interest and 50% of the tax as penalty paid within 60 days of the order end the proceedings.',
          'tone', CASE WHEN v_comm + 60 >= v_today THEN 'warn' ELSE 'muted' END, 'law', 's.74A(9)');
      END IF;

      -- L1. An order passed after its time limit is a ground of appeal.
      v_lim := public.notice_limitation(o.fy, v_sec);
      v_order_by := CASE WHEN v_lim IS NULL OR v_lim ->> 'regime' = '74A' THEN NULL
                         WHEN v_sec = '74' THEN (v_lim ->> 's74_order_by')::date
                         WHEN v_sec = '73' THEN (v_lim ->> 's73_order_by')::date END;
      IF v_order_by IS NOT NULL AND o.d > v_order_by THEN
        v_ev := v_ev || jsonb_build_object('date', o.d, 'kind', 'limitation', 'own_key', o.own_key, 'item_id', o.id,
          'title', 'Order passed after the time limit',
          'detail', 'For FY ' || (v_lim ->> 'fy') || ' an order under s.' || v_sec || ' had to issue by ' || to_char(v_order_by, 'DD Mon YYYY')
                    || CASE WHEN v_sec = '73' THEN ' (' || coalesce(v_lim ->> 's73_basis', 's.73(10)') || ')' ELSE ' (s.74(10))' END
                    || '. A ground of appeal; first check it is not a fresh order on remand (s.75(3)) or a rectification.',
          'tone', 'danger', 'law', CASE WHEN v_sec = '74' THEN 's.74(10)' ELSE 's.73(10)' END, 'ground', true);
      END IF;

      -- L13. The order against its show cause notice: amount (s.75(7)) and hearing (s.75(4)).
      SELECT (y ->> 'demand')::numeric AS amt, (y ->> 'date')::date AS d, y ->> 'reference' AS ref INTO h
        FROM jsonb_array_elements(v_items) y
       WHERE y ->> 'kind' = 'notice' AND y ->> 'form' = 'DRC-01' AND y ->> 'own_key' = o.own_key
         AND coalesce((y ->> 'issue_date')::date, (y ->> 'date')::date) <= o.d
         AND coalesce(y #>> '{facts,type}', '') NOT ILIKE '%adjourn%'
       ORDER BY coalesce(y ->> 'issue_date', y ->> 'date') DESC LIMIT 1;
      IF FOUND THEN
        IF h.amt > 0 AND o.demand > h.amt + 1 THEN
          v_ev := v_ev || jsonb_build_object('date', o.d, 'kind', 'order_check', 'own_key', o.own_key, 'item_id', o.id,
            'title', 'The order demands more than the show cause notice',
            'detail', public.notice_inr(o.demand) || ' in the order against ' || public.notice_inr(h.amt) || ' in the DRC-01'
                      || coalesce(' ' || h.ref, '') || '. An order cannot go beyond the amount or grounds of the notice: a ground of appeal.',
            'tone', 'danger', 'law', 's.75(7)', 'ground', true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) y
                        WHERE y ->> 'own_key' = o.own_key
                          AND (coalesce((y #>> '{facts,hearing,date}')::date, (y ->> 'hearing_date')::date) <= o.d
                               OR (y ->> 'form' IN ('ADJOURNMENT', 'APL-HEARING') AND (y ->> 'date')::date <= o.d)
                               OR (coalesce(y #>> '{facts,type}', '') ILIKE '%hearing%' AND (y ->> 'date')::date <= o.d))) THEN
          v_ev := v_ev || jsonb_build_object('date', o.d, 'kind', 'order_check', 'own_key', o.own_key, 'item_id', o.id,
            'title', 'No personal hearing on record before this order',
            'detail', 'A hearing must be given where it is asked for or an adverse decision is contemplated. Check the case papers; if none was given, it is a ground of appeal.',
            'tone', 'warn', 'law', 's.75(4)', 'ground', true);
        END IF;
      END IF;
    END IF;

    -- L6. A best judgment order falls away if the return is filed in time.
    IF o.form = 'ASMT-13' THEN
      v_d := o.d + coalesce(public.litigation_rule_value('withdrawal_days.s62'), 60)::int;
      v_ev := v_ev || jsonb_build_object('date', v_d, 'kind', 'withdrawal', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'File the return by this date and the order is deemed withdrawn',
        'detail', 'Within 60 days of the order, with the late fee and interest; up to '
                  || to_char(v_d + coalesce(public.litigation_rule_value('withdrawal_ext_days.s62'), 60)::int, 'DD Mon YYYY')
                  || ' with an additional late fee of ₹100 a day.',
        'tone', CASE WHEN v_d >= v_today THEN 'danger' ELSE 'muted' END, 'law', 's.62(2)');
    END IF;

    -- L7. A cancelled registration: the time to apply for revocation.
    IF o.form = 'REG-19' THEN
      v_d := o.d + coalesce(public.litigation_rule_value('revocation_days.reg21'), 90)::int;
      v_has_order := EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) y
                              WHERE y ->> 'kind' = 'notice' AND y ->> 'form' IN ('REG-17', 'REG-SCN')
                                AND (y ->> 'date')::date BETWEEN o.d - 200 AND o.d);
      IF v_d + 180 >= v_today - 30 THEN
        v_ev := v_ev || jsonb_build_object('date', v_d, 'kind', 'revocation', 'own_key', o.own_key, 'item_id', o.id,
          'title', 'Last day to apply for revocation (REG-21)',
          'detail', CASE WHEN v_has_order THEN '' ELSE 'No cancellation notice is on record: if the client asked for the cancellation (REG-16), nothing is due. ' END
                    || 'File the pending returns and pay the dues first. The time can be extended by up to 180 days, to '
                    || to_char(v_d + coalesce(public.litigation_rule_value('revocation_ext_days.reg21'), 180)::int, 'DD Mon YYYY')
                    || '; an appeal under s.107 is the other way.',
          'tone', CASE WHEN v_d < v_today THEN 'muted' WHEN v_has_order THEN 'warn' ELSE 'info' END, 'law', 's.30, rule 23');
      END IF;
    END IF;

    -- L8. Rectification of an error apparent on the record, within 3 months.
    IF o.form IN ('DRC-07', 'DRC-07A', 'ASMT-13', 'ASMT-15', 'ASMT-16', 'RFD-06', 'RFD-07', 'MOV-09', 'MOV-11', 'APL-04') AND o.is_open THEN
      v_d := public.litigation_rule_add(o.d, 'rectification_months.s161');
      IF v_d >= v_today THEN
        v_ev := v_ev || jsonb_build_object('date', v_d, 'kind', 'rectification', 'own_key', o.own_key, 'item_id', o.id,
          'title', 'Last day to ask for rectification of an apparent error',
          'detail', 'Within 3 months of the order (s.161); the authority cannot rectify after 6 months. The time to appeal keeps running while a rectification is pending.',
          'tone', 'info', 'law', 's.161');
      END IF;
    END IF;
  END LOOP;

  RETURN (SELECT coalesce(jsonb_agg(e || jsonb_build_object('upcoming', (e ->> 'date')::date >= v_today)
                                    ORDER BY (e ->> 'date')::date DESC, e ->> 'kind'), '[]'::jsonb)
            FROM jsonb_array_elements(v_ev) e WHERE e ->> 'date' IS NOT NULL);
END;
$function$;
