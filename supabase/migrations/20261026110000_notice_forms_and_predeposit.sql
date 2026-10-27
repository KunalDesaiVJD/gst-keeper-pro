-- Notices & Litigation, the law audit of 26 October 2026 (L3, L6, L11).
-- Additive: new form rules, one appealable list, notice_facts with orders kept
-- out of "overdue", the APL-01's amounts per head on the folder facts, and the
-- pre-deposit worked per head.

-- ── L6. Forms the law treats as orders or as time-critical ─────────────────
INSERT INTO public.notice_form_rules (form_code, match_order, pattern, label, category, default_priority, reply_days, reply_day_kind, clock_basis, appeal_section, auto_close_reason, note) VALUES
  ('ADJOURNMENT', 4, 'adjournment (of (the )?hearing )?granted|intimation for adjournment|adjournment of (the )?(personal )?hearing',
     'Adjournment of a hearing', NULL, 'Low', NULL, 'calendar', NULL, NULL, NULL,
     'A letter adjourning a hearing belongs to the notice it adjourns; it carries no reply of its own (20261026110000).'),
  ('DRC-08', 23, 'drc[- ]?0?8\M', 'Rectification order (DRC-08)', 'Order', 'High', NULL, 'calendar', NULL, 's107', NULL, NULL),
  ('ASMT-13', 41, 'asmt[- ]?13\M|assessment of non[- ]?filers?|best judg(e)?ment assessment',
     'Best judgment assessment order (ASMT-13, s.62)', 'Non filers', 'High', NULL, 'calendar',
     's.62(2): file the return within 60 days of the order (a further 60 days with extra late fee) and the order is deemed withdrawn', 's107', NULL, NULL),
  ('ASMT-15', 52, 'asmt[- ]?15\M|assessment of unregistered', 'Assessment order on an unregistered person (ASMT-15, s.63)', 'ASMT 10', 'High', NULL, 'calendar', NULL, 's107', NULL, NULL),
  ('ASMT-16', 53, 'asmt[- ]?16\M|summary assessment', 'Summary assessment order (ASMT-16, s.64)', 'ASMT 10', 'High', NULL, 'calendar', NULL, 's107', NULL, NULL),
  ('RFD-07', 62, 'rfd[- ]?0?7\M|withhold(ing)? (of )?(the )?refund|adjustment of (sanctioned )?refund', 'Refund adjusted or withheld (RFD-07)', 'Refund', 'High', NULL, 'calendar', NULL, 's107', NULL, NULL),
  ('MOV-01', 65, 'mov[- ]?0?1\M', 'Statement of the person in charge (MOV-01)', 'Ewaybill', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order', NULL),
  ('MOV-02', 66, 'mov[- ]?0?2\M', 'Order for physical verification (MOV-02)', 'Ewaybill', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order', NULL),
  ('MOV-04', 67, 'mov[- ]?0?4\M', 'Physical verification report (MOV-04)', 'Ewaybill', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order', NULL),
  ('MOV-05', 68, 'mov[- ]?0?5\M', 'Release order (MOV-05)', 'Ewaybill', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order', NULL),
  ('MOV-06', 69, 'mov[- ]?0?6\M', 'Order of detention (MOV-06)', 'Ewaybill', 'High', NULL, 'calendar', NULL, NULL, NULL,
     'Followed by MOV-07 (notice) and MOV-09 (order, s.129(3)); the appeal lies against the MOV-09.'),
  ('MOV-10', 72, 'mov[- ]?10\M|notice for confiscation', 'Notice for confiscation (MOV-10, s.130)', 'Ewaybill', 'High', NULL, 'calendar', NULL, NULL, NULL, NULL),
  ('MOV-11', 73, 'mov[- ]?11\M|order of confiscation', 'Order of confiscation (MOV-11, s.130)', 'Ewaybill', 'High', NULL, 'calendar', NULL, 's107', NULL, NULL),
  ('SPL-07', 86, 'spl[- ]?0?7\M|rejection of (the )?(application for )?waiver', 'Rejection of a s.128A waiver (SPL-07)', 'Order', 'High', NULL, 'calendar', NULL, 's107', NULL, NULL),
  ('RVN-01', 87, 'rvn[- ]?0?1\M|revision(al)? (authority|proceedings)|section 108', 'Notice of revision (RVN-01, s.108)', 'Order', 'High', NULL, 'calendar',
     's.108: reply by the date the notice gives; the revisional authority can act within 3 years of the order', NULL, NULL, NULL)
ON CONFLICT (form_code) DO NOTHING;

-- An adjournment letter needs no reply of its own and stays off the dashboard.
INSERT INTO public.notice_type_settings (form_code, response_need, show_on_dashboard, hidden, updated_by_name)
VALUES ('ADJOURNMENT', 'none', false, false, 'Law audit 26 Oct 2026'),
       -- Orders an appeal lies against, as DRC-07 and MOV-09.
       ('DRC-08', 'critical', true, false, 'Law audit 26 Oct 2026'),
       ('ASMT-13', 'critical', true, false, 'Law audit 26 Oct 2026'),
       ('ASMT-15', 'critical', true, false, 'Law audit 26 Oct 2026'),
       ('ASMT-16', 'critical', true, false, 'Law audit 26 Oct 2026'),
       ('RFD-07', 'optional', true, false, 'Law audit 26 Oct 2026'),
       ('MOV-11', 'critical', true, false, 'Law audit 26 Oct 2026'),
       ('SPL-07', 'optional', true, false, 'Law audit 26 Oct 2026'),
       -- Notices that need an answer.
       ('MOV-06', 'optional', true, false, 'Law audit 26 Oct 2026'),
       ('MOV-10', 'critical', true, false, 'Law audit 26 Oct 2026'),
       ('RVN-01', 'critical', true, false, 'Law audit 26 Oct 2026'),
       -- Interception papers that record what happened: nothing to answer.
       ('MOV-01', 'none', false, false, 'Law audit 26 Oct 2026'),
       ('MOV-02', 'none', false, false, 'Law audit 26 Oct 2026'),
       ('MOV-04', 'none', false, false, 'Law audit 26 Oct 2026'),
       ('MOV-05', 'none', false, false, 'Law audit 26 Oct 2026')
ON CONFLICT (form_code) DO NOTHING;

-- DRC-07A carries a s.107 clock in its rule; the appealable list now carries it too.
-- One list, matching every rule with an appeal section (test_117 holds them equal).
CREATE OR REPLACE FUNCTION public.notice_appealable_forms()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY['DRC-07', 'DRC-07A', 'DRC-08', 'ASMT-13', 'ASMT-15', 'ASMT-16', 'RFD-06', 'RFD-07', 'REG-05', 'REG-19',
               'REG-CANCEL-REJ', 'MOV-09', 'MOV-11', 'SPL-07', 'RECT-ORDER', 'APL-04']
$$;

-- ── L3. The APL-01's amounts per head, on the folder facts ──────────────────
CREATE OR REPLACE FUNCTION public.notice_amount_heads(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  -- {cgst: {tx, pen, tot}, sgst: …} of a portal amount block, NULL when absent.
  SELECT CASE WHEN jsonb_typeof(p) = 'object' THEN
    nullif(jsonb_strip_nulls(jsonb_build_object(
      'cgst', CASE WHEN jsonb_typeof(p -> 'cgst') = 'object' THEN jsonb_build_object('tx', public.notice_try_num(p #>> '{cgst,tx}'), 'pen', public.notice_try_num(p #>> '{cgst,pen}'), 'tot', public.notice_try_num(p #>> '{cgst,tot}')) END,
      'sgst', CASE WHEN jsonb_typeof(p -> 'sgst') = 'object' THEN jsonb_build_object('tx', public.notice_try_num(p #>> '{sgst,tx}'), 'pen', public.notice_try_num(p #>> '{sgst,pen}'), 'tot', public.notice_try_num(p #>> '{sgst,tot}')) END,
      'igst', CASE WHEN jsonb_typeof(p -> 'igst') = 'object' THEN jsonb_build_object('tx', public.notice_try_num(p #>> '{igst,tx}'), 'pen', public.notice_try_num(p #>> '{igst,pen}'), 'tot', public.notice_try_num(p #>> '{igst,tot}')) END,
      'cess', CASE WHEN jsonb_typeof(p -> 'cess') = 'object' THEN jsonb_build_object('tx', public.notice_try_num(p #>> '{cess,tx}'), 'pen', public.notice_try_num(p #>> '{cess,pen}'), 'tot', public.notice_try_num(p #>> '{cess,tot}')) END)), '{}'::jsonb)
  END
$$;

CREATE OR REPLACE FUNCTION public.notice_folder_facts(p_section text, p_raw jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE
  j jsonb := CASE WHEN jsonb_typeof(p_raw) = 'object' THEN p_raw ELSE '{}'::jsonb END;
  od jsonb := CASE WHEN jsonb_typeof(p_raw -> 'orddtl') = 'object' THEN p_raw -> 'orddtl' END;
  v_out jsonb := '{}'::jsonb;
  v_ph date;
  v_docs jsonb;
BEGIN
  IF j = '{}'::jsonb THEN RETURN NULL; END IF;
  v_ph := public.notices_parse_portal_date(jsonb_path_query_first(j, 'lax $.**.phdt') #>> '{}');
  IF v_ph IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('hearing', jsonb_strip_nulls(jsonb_build_object(
      'date', v_ph,
      'time', nullif(btrim(jsonb_path_query_first(j, 'lax $.**.pht') #>> '{}'), ''),
      'venue', nullif(btrim(jsonb_path_query_first(j, 'lax $.**.venu') #>> '{}'), ''))));
  END IF;
  v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
    'due', public.notices_parse_portal_date(jsonb_path_query_first(j, 'lax $.**.duedt') #>> '{}'),
    'section_of_law', nullif(btrim(jsonb_path_query_first(j, 'lax $.**.sec') #>> '{}'), ''),
    'fy', nullif(btrim(jsonb_path_query_first(j, 'lax $.**.fy') #>> '{}'), ''),
    'type', nullif(btrim(jsonb_path_query_first(j, 'lax $.sdtls.*.type') #>> '{}'), '')));
  IF od IS NOT NULL THEN
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
      'form', CASE WHEN public.notice_is_appeal_form(j) THEN 'APL-01' END,
      'order_ref', nullif(btrim(coalesce(od ->> 'ordnum', od ->> 'dmdid')), ''),
      'order_date', public.notices_parse_portal_date(od ->> 'orddt'),
      'order_comm_date', public.notices_parse_portal_date(od ->> 'ordcommdt'),
      'disputed_tax', public.notice_try_num(od #>> '{dispamt,total,tx}'),
      'disputed_total', public.notice_try_num(od #>> '{dispamt,total,tot}'),
      -- 20261025170000: the portal fills predepositamt on some appeals only; the
      -- amount paid with the appeal is always in paidamt, with its payment's PRN.
      'predeposit', coalesce(public.notice_try_num(od #>> '{predepositamt,total,tot}'), public.notice_try_num(od #>> '{paidamt,total,tot}')),
      'predeposit_prn', nullif(btrim(od ->> 'prn'), ''),
      'predeposit_pct', coalesce(public.notice_try_num(od ->> 'predepotax'), public.notice_try_num(od #>> '{predepositpenality,percent}')),
      -- 20261026110000 (L3): the amounts per head, for the pre-deposit per Act.
      'amounts', nullif(jsonb_strip_nulls(jsonb_build_object(
          'demand', public.notice_amount_heads(od -> 'initamt'),
          'disputed', public.notice_amount_heads(od -> 'dispamt'),
          'paid', public.notice_amount_heads(coalesce(od -> 'paidamt', od -> 'predepositamt')))), '{}'::jsonb),
      'filed_on', coalesce(public.notices_parse_portal_date(j #>> '{authdtls,dt}'), public.notices_parse_portal_date(j ->> 'insertTimeStamp')),
      'second_appeal', CASE WHEN j ->> 'scndAppeal' = 'true' THEN true END,
      'issues', (SELECT jsonb_agg(btrim(x ->> 'desc')) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j -> 'issuecat') = 'array' THEN j -> 'issuecat' ELSE '[]'::jsonb END) x
                  WHERE nullif(btrim(x ->> 'desc'), '') IS NOT NULL)));
  END IF;
  -- Every document the record lists, downloaded or not (the portal spells the
  -- file name docName in one section and docname in another).
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', d.id, 'name', d.name, 'file', d.file)) ORDER BY d.ord)
    INTO v_docs
    FROM (SELECT DISTINCT ON (x ->> 'id') x ->> 'id' AS id,
                 nullif(btrim(coalesce(x ->> 'name', x ->> 'docttl', x ->> 'docname', x ->> 'docName')), '') AS name,
                 nullif(btrim(coalesce(x ->> 'docname', x ->> 'docName')), '') AS file, o AS ord
            FROM jsonb_path_query(j, 'lax $.** ? (exists(@.id) && (exists(@.docname) || exists(@.docName)))') WITH ORDINALITY q(x, o)
           WHERE jsonb_typeof(x) = 'object' AND nullif(btrim(x ->> 'id'), '') IS NOT NULL
           ORDER BY x ->> 'id', o) d;
  IF v_docs IS NOT NULL THEN v_out := v_out || jsonb_build_object('portal_docs', v_docs); END IF;
  RETURN nullif(v_out, '{}'::jsonb);
END;
$function$;

-- The pre-deposit an appeal needs, per Act (L2, L3):
--   s.107(6): the admitted amount in full, and 10% of the remaining tax in
--             dispute, capped per Act (20 crore CGST / SGST, 40 crore IGST from
--             1 Nov 2024; 25 / 50 before);
--   s.112(8): 10% more before the Tribunal (20% before 1 Nov 2024), capped at
--             20 crore (50 before; IGST twice);
--   penalty-only orders: 10% of the penalty, for appeals filed from 1 Oct 2025
--             (Finance Act 2025; courts hold it does not reach earlier SCNs);
--   s.129 orders (MOV-09): 25% of the penalty (proviso to s.107(6)).
-- p_kind: 'first', 'tribunal' or 's129'. NULL when the record has no heads.
CREATE OR REPLACE FUNCTION public.notice_predeposit_required(p_amounts jsonb, p_kind text, p_filed date)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_filed date := coalesce(p_filed, public.ist_today());
  v_new_caps boolean := v_filed >= '2024-11-01';
  v_pen_from date := coalesce((SELECT effective_from FROM public.litigation_rules WHERE key = 'predeposit_pct.penalty_only'), '2025-10-01');
  v_tax_total numeric := 0;
  v_pen_total numeric := 0;
  v_penalty_only boolean;
  v_pct numeric;
  v_on text;
  v_cap_cr numeric;
  h text;
  v_disp numeric; v_dpen numeric; v_dem numeric; v_dtot numeric; v_paid numeric; v_adm numeric; v_dep numeric; v_cap numeric; v_req numeric;
  v_heads jsonb := '[]'::jsonb;
  v_short text[] := '{}';
  v_sreq numeric := 0;
  v_spaid numeric := 0;
BEGIN
  IF p_amounts IS NULL OR jsonb_typeof(p_amounts -> 'disputed') <> 'object' THEN RETURN NULL; END IF;
  FOREACH h IN ARRAY ARRAY['cgst', 'sgst', 'igst', 'cess'] LOOP
    v_tax_total := v_tax_total + coalesce((p_amounts #>> ARRAY['disputed', h, 'tx'])::numeric, 0);
    v_pen_total := v_pen_total + coalesce((p_amounts #>> ARRAY['disputed', h, 'pen'])::numeric, 0);
  END LOOP;
  v_penalty_only := v_tax_total = 0 AND v_pen_total > 0;

  IF p_kind = 's129' THEN
    v_pct := coalesce(public.litigation_rule_value('predeposit_pct.s129_penalty'), 25); v_on := 'penalty';
  ELSIF v_penalty_only THEN
    v_pct := CASE WHEN v_filed >= v_pen_from THEN coalesce(public.litigation_rule_value('predeposit_pct.penalty_only'), 10) ELSE 0 END;
    v_on := 'penalty';
  ELSIF p_kind = 'tribunal' THEN
    v_pct := CASE WHEN v_new_caps THEN coalesce(public.litigation_rule_value('predeposit_pct.s112'), 10) ELSE 20 END; v_on := 'tax';
  ELSE
    v_pct := coalesce(public.litigation_rule_value('predeposit_pct.s107'), 10); v_on := 'tax';
  END IF;
  v_cap_cr := CASE WHEN p_kind = 'tribunal'
                   THEN CASE WHEN v_new_caps THEN coalesce(public.litigation_rule_value('predeposit_cap_cr.s112'), 20) ELSE 50 END
                   ELSE CASE WHEN v_new_caps THEN coalesce(public.litigation_rule_value('predeposit_cap_cr.s107'), 20) ELSE 25 END END;

  FOREACH h IN ARRAY ARRAY['cgst', 'sgst', 'igst', 'cess'] LOOP
    v_disp := coalesce((p_amounts #>> ARRAY['disputed', h, 'tx'])::numeric, 0);
    v_dpen := coalesce((p_amounts #>> ARRAY['disputed', h, 'pen'])::numeric, 0);
    v_dtot := coalesce((p_amounts #>> ARRAY['disputed', h, 'tot'])::numeric, 0);
    v_dem  := coalesce((p_amounts #>> ARRAY['demand', h, 'tot'])::numeric, v_dtot);
    v_paid := coalesce((p_amounts #>> ARRAY['paid', h, 'tot'])::numeric, 0);
    -- The admitted amount: the demand less what is disputed (s.107(6)(a)).
    v_adm  := CASE WHEN p_kind = 'tribunal' THEN 0 ELSE greatest(v_dem - v_dtot, 0) END;
    v_cap  := v_cap_cr * 10000000 * CASE WHEN h = 'igst' THEN 2 ELSE 1 END;
    v_dep  := least(round(CASE WHEN v_on = 'penalty' THEN v_dpen ELSE v_disp END * v_pct / 100), v_cap);
    v_req  := v_adm + v_dep;
    CONTINUE WHEN v_req = 0 AND v_paid = 0;
    v_heads := v_heads || jsonb_build_object('head', h, 'admitted', v_adm, 'deposit', v_dep, 'required', v_req, 'paid', v_paid,
                                             'ok', v_paid + 1 >= v_req, 'capped', v_dep = v_cap AND v_cap > 0);
    IF v_paid + 1 < v_req THEN v_short := v_short || upper(h); END IF;
    v_sreq := v_sreq + v_req; v_spaid := v_spaid + v_paid;
  END LOOP;

  RETURN jsonb_build_object('kind', p_kind, 'pct', v_pct, 'on', v_on, 'penalty_only', v_penalty_only,
    'heads', v_heads, 'required', v_sreq, 'paid', v_spaid, 'ok', cardinality(v_short) = 0, 'short', to_jsonb(v_short),
    'law', CASE WHEN p_kind = 'tribunal' THEN 's.112(8)' WHEN p_kind = 's129' THEN 'proviso to s.107(6)' ELSE 's.107(6)' END,
    'note', CASE WHEN v_penalty_only AND v_pct = 0 THEN 'Penalty-only order appealed before 1 Oct 2025: no pre-deposit on the penalty.'
                 WHEN v_penalty_only THEN 'Penalty-only order: 10% of the penalty (Finance Act 2025).' END);
END;
$$;
COMMENT ON FUNCTION public.notice_predeposit_required(jsonb, text, date) IS
  'L3 (26 Oct 2026): the pre-deposit an appeal needs per Act (admitted amount, % of the disputed tax or penalty, caps), and whether each head was paid.';

-- The audit (20261025190000) now judges per head where the record has heads.
CREATE OR REPLACE FUNCTION public.notice_predeposit_audit()
RETURNS TABLE(client_id uuid, client_name text, appeal_arn text, order_ref text, source text, item_id uuid, disputed_tax numeric, pct numeric, required numeric, paid numeric, prn text, verdict text, unread_fields text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH r AS (
    SELECT fi.client_id, fi.case_id AS arn, 'case_folder'::text AS source, fi.id AS item_id, fi.raw_json AS j
      FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL AND public.notice_is_appeal_form(fi.raw_json)
    UNION ALL
    SELECT a.client_id, a.arn, 'application', a.id, public.notice_try_jsonb(a.raw_json #>> '{appItem,itemJson}')
      FROM public.gst_portal_applications a
     WHERE a.deleted_at IS NULL AND public.notice_is_appeal_form(public.notice_try_jsonb(a.raw_json #>> '{appItem,itemJson}'))
  ), f AS (
    SELECT r.*, public.notice_folder_facts('APLCN', r.j) AS facts,
           ARRAY(SELECT k FROM jsonb_object_keys(r.j -> 'orddtl') k
                  WHERE k ~* '(deposit|paid|pay|prn|cpin|challan|debit)' AND NOT public.notice_predeposit_known_field(k)
                  ORDER BY k) AS unread
      FROM r
  ), v AS (
    SELECT f.*, (f.facts ->> 'disputed_tax')::numeric AS tax,
           public.notice_predeposit_required(f.facts -> 'amounts',
             CASE WHEN f.facts ->> 'second_appeal' = 'true' THEN 'tribunal'
                  WHEN EXISTS (SELECT 1 FROM public.gst_notices g WHERE g.client_id = f.client_id AND g.deleted_at IS NULL
                                 AND g.form_code = 'MOV-09' AND upper(btrim(g.reference_number)) = upper(btrim(f.facts ->> 'order_ref'))) THEN 's129'
                  ELSE 'first' END,
             (f.facts ->> 'filed_on')::date) AS chk,
           (f.facts ->> 'predeposit')::numeric AS amt
      FROM f
  ), w AS (
    SELECT v.*,
           coalesce((v.chk ->> 'pct')::numeric, (v.facts ->> 'predeposit_pct')::numeric, 10) AS p,
           coalesce((v.chk ->> 'required')::numeric,
                    round(v.tax * coalesce((v.facts ->> 'predeposit_pct')::numeric, 10) / 100)) AS req
      FROM v
  )
  SELECT w.client_id, c.name, w.arn, w.facts ->> 'order_ref', w.source, w.item_id,
         w.tax, w.p, w.req, coalesce((w.chk ->> 'paid')::numeric, w.amt), w.facts ->> 'predeposit_prn',
         CASE WHEN cardinality(w.unread) > 0 THEN 'unread'
              WHEN w.amt IS NULL AND w.chk IS NULL THEN 'no_amount'
              WHEN w.chk IS NOT NULL AND NOT (w.chk ->> 'ok')::boolean THEN 'short'
              WHEN w.chk IS NULL AND w.tax IS NOT NULL AND w.amt + 1 < w.req THEN 'short'
              ELSE 'paid' END,
         w.unread
    FROM w LEFT JOIN public.clients c ON c.id = w.client_id
   ORDER BY (CASE WHEN cardinality(w.unread) > 0 THEN 0 WHEN w.amt IS NULL AND w.chk IS NULL THEN 1
                  WHEN coalesce(NOT (w.chk ->> 'ok')::boolean, w.amt + 1 < w.req) THEN 2 ELSE 3 END), c.name, w.arn, w.source
$function$;

-- The heads behind each verdict, for a person checking a short one.
CREATE OR REPLACE FUNCTION public.notice_predeposit_audit_heads()
RETURNS TABLE(client_name text, appeal_arn text, order_ref text, source text, check_detail jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.name, a.arn, ff ->> 'order_ref', 'application',
         public.notice_predeposit_required(ff -> 'amounts', CASE WHEN ff ->> 'second_appeal' = 'true' THEN 'tribunal' ELSE 'first' END, (ff ->> 'filed_on')::date)
    FROM public.gst_portal_applications a
    JOIN public.clients c ON c.id = a.client_id
   CROSS JOIN LATERAL (SELECT public.notice_folder_facts('APLCN', public.notice_try_jsonb(a.raw_json #>> '{appItem,itemJson}')) AS ff) x
   WHERE a.deleted_at IS NULL AND a.case_type_cd = 'APPEL'
$$;
GRANT EXECUTE ON FUNCTION public.notice_predeposit_audit_heads() TO anon, authenticated, service_role;

-- ── L11. An order is not "overdue": its payment date (s.78) is its own flag ──
-- notice_facts as in 20261014120000, with orders kept out of is_overdue and
-- is_due_in_7 and a new last column, is_payment_overdue.
CREATE OR REPLACE VIEW public.notice_facts WITH (security_invoker = true) AS
WITH base AS (
  SELECT g.*,
         c.name AS client_name,
         c.gstin AS client_gstin,
         c.inactive_at_hand AS client_inactive,
         r.label AS form_label,
         r.category AS rule_category,
         r.default_priority,
         r.clock_basis,
         public.notice_computed_due(g.issue_date, g.case_id, g.form_code) AS computed_due,
         public.ist_today() AS today_ist,
         -- 20261014120000: system generated notices, and DRC-01B / DRC-01C, need no reply and stay off the dashboard.
         CASE WHEN public.notice_is_system_generated(g.issued_by, g.form_code) THEN 'none' ELSE coalesce(ts.response_need, 'critical') END AS response_need,
         (coalesce(ts.show_on_dashboard, true) AND NOT public.notice_is_system_generated(g.issued_by, g.form_code)) AS on_dashboard,
         public.notice_is_system_generated(g.issued_by, g.form_code) AS sys_gen
    FROM public.gst_notices g
    JOIN public.clients c ON c.id = g.client_id
    LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
    LEFT JOIN public.notice_type_settings ts ON ts.form_code = g.form_code
   WHERE g.deleted_at IS NULL
     AND g.source = 'notices'
     -- 20261008180000: a type hidden everywhere is in no list, count, report or e-mail.
     AND NOT coalesce(ts.hidden, false)
     -- 20261010100000: a client whose litigation the firm does not handle is in no task, list, count or e-mail.
     AND coalesce(c.notices_handled, true)
     -- 20261013110000: a case another firm handles is out, and so is a kind of work the firm does not do for this client.
     AND g.excluded_at IS NULL
     AND NOT (public.notice_track(public.notice_category(g.notice_type, g.description, r.category)) = ANY (coalesce(c.notices_tracks_off, '{}'::text[])))
), derived AS (
  SELECT b.*,
         NOT public.notice_is_closed(b.staff_status) AS open_flag,
         (b.reply_date IS NOT NULL) AS replied_flag,
         -- 20261027100000 (P3): a portal due date before the issue date is a portal error; the rule's period stands.
         coalesce(b.extended_due_date, CASE WHEN b.due_date < b.issue_date THEN NULL ELSE b.due_date END, b.computed_due,
                  CASE WHEN b.due_date < b.issue_date THEN b.issue_date + 30 END, b.due_date) AS eff_due,
         (b.extended_due_date IS NULL AND b.due_date < b.issue_date) AS due_before_issue,
         coalesce(nullif(b.case_id, ''), nullif(b.reference_number, ''), b.id::text) AS dispute,
         (NOT public.notice_is_closed(b.staff_status) AND b.matter_id IS NULL
          AND coalesce(b.amount_of_demand, 0) > 0) AS exposure_candidate
    FROM base b
)
SELECT
  d.id, d.client_id, d.client_name, d.client_gstin, d.client_inactive,
  d.source, d.portal_key, d.reference_number, d.case_id, d.notice_type, d.description,
  d.status AS portal_status,
  d.issue_date, d.due_date, d.extended_due_date, d.hearing_date,
  d.reply_date, d.reply_ref_number, d.order_date, d.order_number,
  d.submission_arn, d.submission_date,
  d.staff_status, d.close_reason,
  d.priority, d.default_priority, coalesce(d.priority, d.default_priority) AS effective_priority,
  d.assign_to, d.assign_to_user_id,
  d.amount_of_demand, d.financial_year, d.issued_by, d.remarks, d.pdf_url, d.matter_id,
  d.first_seen_at, d.last_seen_at, d.pulled_at, d.created_at, d.updated_at,
  d.form_code, d.form_label,
  public.notice_category(d.notice_type, d.description, d.rule_category) AS category,
  coalesce(d.notice_type = 'Refunds', false) AS is_refund_case,
  coalesce(d.notice_type = 'Voluntary Payment', false) AS is_drc03_case,
  d.open_flag AS is_open,
  d.replied_flag AS is_replied,
  d.eff_due AS effective_due,
  CASE WHEN d.extended_due_date IS NOT NULL THEN 'extended'
       WHEN d.due_before_issue THEN 'computed'
       WHEN d.due_date IS NOT NULL THEN 'portal'
       WHEN d.computed_due IS NOT NULL THEN 'computed' END AS due_basis,
  CASE WHEN d.due_before_issue
       THEN 'The portal''s due date (' || to_char(d.due_date, 'DD Mon YYYY') || ') is before the issue date'
            || CASE WHEN d.computed_due IS NOT NULL THEN '; the rule''s period is used. Confirm the date on the notice.'
                    ELSE '; 30 days from the issue date are used. Confirm the date on the notice.' END
       WHEN d.extended_due_date IS NULL AND d.due_date IS NULL AND d.computed_due IS NOT NULL
       THEN d.clock_basis END AS due_basis_note,
  (d.eff_due - d.today_ist) AS days_to_due,
  -- 20261012100000: an order under appeal has met its clock (the appeal is the task now).
  coalesce(d.open_flag AND NOT d.replied_flag AND d.response_need <> 'none' AND coalesce(d.stage, '') <> 'appeal' AND NOT (coalesce(d.form_code, '') = ANY (public.notice_appealable_forms())) AND d.eff_due < d.today_ist, false) AS is_overdue,
  coalesce(d.open_flag AND NOT d.replied_flag AND d.response_need <> 'none' AND coalesce(d.stage, '') <> 'appeal' AND NOT (coalesce(d.form_code, '') = ANY (public.notice_appealable_forms())) AND d.eff_due BETWEEN d.today_ist AND d.today_ist + 7, false) AS is_due_in_7,
  coalesce(d.first_seen_at > now() - interval '24 hours', false) AS is_new,
  (d.open_flag AND d.assign_to_user_id IS NULL) AS is_unassigned,
  d.dispute AS dispute_key,
  CASE WHEN d.exposure_candidate
        AND row_number() OVER (PARTITION BY d.client_id, d.dispute, d.exposure_candidate
                               ORDER BY d.issue_date DESC NULLS LAST, d.id) = 1
       THEN d.amount_of_demand ELSE 0 END AS exposure_amount,
  d.today_ist,
  -- Phase 2
  d.stage,
  st.label AS stage_label,
  st.ord AS stage_ord,
  d.stage_changed_at,
  d.stage_changed_by,
  (d.today_ist - (d.stage_changed_at AT TIME ZONE 'Asia/Kolkata')::date) AS days_in_stage,
  d.hearing_note,
  -- Phase 4b: the notice type's reply need and dashboard choice
  d.response_need,
  d.on_dashboard,
  d.sys_gen AS system_generated,
  -- 20261026110000 (L11): an order's payment date (s.78) passed, apart from a reply overdue.
  coalesce(d.open_flag AND coalesce(d.form_code, '') = ANY (public.notice_appealable_forms()) AND coalesce(d.stage, '') <> 'appeal' AND d.eff_due < d.today_ist, false) AS is_payment_overdue
FROM derived d
JOIN public.notice_stages st ON st.key = d.stage;

-- ── Reply options for the new forms (two to five each, test_101) ──────────
-- Orders: rectification under s.161 and the letter recording the intention to
-- appeal, as the other orders. The detention order (MOV-06) shares MOV-07's
-- replies. A revision notice and a notice of confiscation get the general
-- reply and the request for time, as their own templates.
UPDATE public.reply_templates t
   SET forms = t.forms || ARRAY(SELECT f FROM unnest(ARRAY['DRC-08', 'ASMT-13', 'ASMT-15', 'ASMT-16', 'RFD-07', 'MOV-11', 'SPL-07']) f WHERE f <> ALL (t.forms))
 WHERE t.key IN ('order_rectify', 'order_appeal_intent')
   AND NOT (t.forms @> ARRAY['DRC-08', 'ASMT-13', 'ASMT-15', 'ASMT-16', 'RFD-07', 'MOV-11', 'SPL-07']);
UPDATE public.reply_templates t
   SET forms = t.forms || ARRAY['MOV-06']
 WHERE t.key IN ('mov07_contest', 'mov07_pay_release') AND NOT ('MOV-06' = ANY (t.forms));
INSERT INTO public.reply_templates (key, title, summary, stance, forms, sort, body, is_active, updated_by_name)
SELECT replace(g.key, 'general_', 'rvn01_mov10_'), g.title,
       'Use for a notice of revision under section 108 or a notice of confiscation under section 130. ' || g.summary,
       g.stance, ARRAY['RVN-01', 'MOV-10'], g.sort, g.body, true, 'Law audit 26 Oct 2026'
  FROM public.reply_templates g
 WHERE g.key IN ('general_reply', 'general_time')
ON CONFLICT (key) DO NOTHING;
