-- Notices · pre-deposit read from the amount paid with the appeal (asked by the
-- firm, 25 October 2026: "all pre-deposits are paid and nothing is pending").
--
-- notice_case_key_dates showed "Pre-deposit short: ₹0 paid" on 9 appeals whose
-- pre-deposit was paid (e.g. Unity Organics AD240224018334L, ₹1,59,004 by PRN
-- IP2402240010857, as its APL-02 says). The APL-01's portal record carries the
-- pre-deposit in orddtl.predepositamt on only some appeals; the amount paid with
-- the appeal is always in orddtl.paidamt, with the payment's PRN in orddtl.prn.
-- 1. notice_folder_facts reads predeposit from predepositamt, else paidamt, and
--    keeps the PRN (predeposit_prn).
-- 2. notice_case_key_dates names the PRN on the pre-deposit line, and an appeal
--    whose record holds no amount at all says so (info), never "₹0 paid".
-- Additive: CREATE OR REPLACE of the two functions, same signatures.

CREATE OR REPLACE FUNCTION public.notice_folder_facts(p_section text, p_raw jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.notice_case_key_dates(p_client_id uuid, p_case_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_n int;
  v_sec text;
  v_fy_ok boolean;
BEGIN
  IF v_root IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kind', c.kind, 'id', c.item_id, 'own_key', c.own_key, 'reference', c.reference, 'date', c.item_date,
           'section', upper(coalesce(c.folder_section, '')), 'label', c.label,
           'form', f.form_code, 'is_open', f.is_open, 'effective_due', f.effective_due, 'issue_date', f.issue_date,
           'facts', public.notice_case_item_facts(c.client_id, c.kind, c.item_id, c.own_key, c.reference))), '[]'::jsonb)
    INTO v_items
    FROM public.notice_case_correspondence c
    LEFT JOIN public.notice_facts f ON c.kind = 'notice' AND f.id = c.item_id
   WHERE c.client_id = p_client_id AND c.case_key = v_root;

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
     WHERE x #>> '{facts,type}' ILIKE '%adjourn%' AND x ->> 'date' IS NOT NULL
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
       AND coalesce(x ->> 'form', '') <> ALL (public.notice_appealable_forms())
  LOOP
    v_ev := v_ev || jsonb_build_object('date', h.d, 'kind', 'reply_due', 'own_key', h.own_key, 'item_id', h.id,
      'title', 'Reply due', 'detail', h.label,
      'tone', CASE WHEN h.d < v_today THEN 'danger' WHEN h.d <= v_today + 7 THEN 'warn' ELSE 'info' END);
  END LOOP;

  -- Show cause notices and intimations: the windows to pay and close with a
  -- reduced penalty (s.73 and s.74 periods only; from FY 2024-25 s.74A applies).
  FOR h IN
    SELECT x ->> 'form' AS form, coalesce((x ->> 'issue_date')::date, (x ->> 'date')::date) AS d, x ->> 'own_key' AS own_key, x ->> 'id' AS id,
           x #>> '{facts,section_of_law}' AS sec, x #>> '{facts,fy}' AS fy, (x #>> '{facts,due}')::date AS due
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' = 'notice' AND x ->> 'form' IN ('DRC-01', 'DRC-01A')
       -- An adjournment letter is filed under the notice it adjourns, not a notice of its own.
       AND coalesce(x #>> '{facts,type}', '') NOT ILIKE '%adjourn%'
  LOOP
    v_sec := substring(coalesce(h.sec, '') FROM '^(73|74)\M');
    v_fy_ok := h.fy IS NULL OR substring(h.fy FROM '^(\d{4})')::int < 2024;
    CONTINUE WHEN v_sec IS NULL OR NOT v_fy_ok OR h.d IS NULL;
    IF h.form = 'DRC-01A' AND v_sec = '74' THEN
      v_ev := v_ev || jsonb_build_object('date', coalesce(h.due, h.d + 30), 'kind', 'pay_to_close', 'own_key', h.own_key, 'item_id', h.id,
        'title', 'Last day to pay with a 15% penalty before a show cause notice',
        'detail', 'Tax, interest and 15% of the tax paid by DRC-03 against the DRC-01A ends the matter.',
        'tone', CASE WHEN coalesce(h.due, h.d + 30) >= v_today THEN 'warn' ELSE 'muted' END, 'law', 's.74(5)');
    ELSIF h.form = 'DRC-01' THEN
      v_ev := v_ev || jsonb_build_object('date', h.d + 30, 'kind', 'pay_to_close', 'own_key', h.own_key, 'item_id', h.id,
        'title', CASE WHEN v_sec = '73' THEN 'Last day to pay tax and interest with no penalty'
                      ELSE 'Last day to pay with a 25% penalty and close' END,
        'detail', 'Within 30 days of the show cause notice; the proceedings are then deemed concluded.',
        'tone', CASE WHEN h.d + 30 >= v_today THEN 'warn' ELSE 'muted' END,
        'law', CASE WHEN v_sec = '73' THEN 's.73(8)' ELSE 's.74(8)' END);
    END IF;
  END LOOP;

  -- Orders: the time to appeal, whether an appeal was filed in time, its
  -- pre-deposit, the payment date and the window to close with 50% penalty.
  FOR o IN
    SELECT x ->> 'form' AS form, x ->> 'id' AS id, x ->> 'own_key' AS own_key, x ->> 'reference' AS ref, (x ->> 'is_open')::boolean AS is_open,
           coalesce((x ->> 'issue_date')::date, (x ->> 'date')::date) AS d, x -> 'facts' AS facts
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' = 'notice' AND x ->> 'form' = ANY (public.notice_appealable_forms())
  LOOP
    CONTINUE WHEN o.d IS NULL;
    v_tribunal := o.form = 'APL-04';
    -- The appeal against this order: its application names the order.
    SELECT x -> 'facts' INTO v_ap
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' IN ('document', 'application') AND x #>> '{facts,order_ref}' IS NOT NULL
       AND upper(x #>> '{facts,order_ref}') = upper(coalesce(o.ref, ''))
     ORDER BY (x #>> '{facts,filed_on}') NULLS LAST
     LIMIT 1;
    v_comm := coalesce((v_ap ->> 'order_comm_date')::date, o.d);
    v_last := (v_comm + interval '3 months')::date;
    v_condone := (v_comm + CASE WHEN v_tribunal THEN interval '6 months' ELSE interval '4 months' END)::date;
    v_cond_law := CASE WHEN v_tribunal THEN 's.112(6)' ELSE 's.107(4)' END;
    v_filed := (v_ap ->> 'filed_on')::date;
    IF v_ap IS NOT NULL AND v_filed IS NOT NULL THEN
      v_ev := v_ev || jsonb_build_object('date', v_filed, 'kind', 'appeal_filed', 'own_key', o.own_key, 'item_id', o.id,
        'title', CASE WHEN v_filed < v_last THEN 'Appeal filed in time'
                      WHEN v_filed = v_last THEN 'Appeal filed on the last day of the 3 months'
                      WHEN v_filed <= v_condone THEN 'Appeal filed ' || (v_filed - v_last) || ' day' || CASE WHEN v_filed - v_last = 1 THEN '' ELSE 's' END || ' after the 3 months'
                      ELSE 'Appeal filed after the time the law allows' END,
        'detail', 'Against ' || coalesce(o.form || ' ', '') || coalesce(o.ref, 'the order') || ' communicated on ' || to_char(v_comm, 'DD Mon YYYY')
                  || '; the 3 months ran to ' || to_char(v_last, 'DD Mon YYYY') || ' (the day of the order not counted)'
                  || CASE WHEN v_filed > v_last AND v_filed <= v_condone
                          THEN '. The authority may condone a delay up to ' || to_char(v_condone, 'DD Mon YYYY') || ' for sufficient cause' ELSE '' END
                  || CASE WHEN v_ap ->> 'order_comm_date' IS NULL THEN '. Counted from the order''s date: if it reached the client later, the time runs from then' ELSE '' END || '.',
        'tone', CASE WHEN v_filed <= v_last THEN 'ok' WHEN v_filed <= v_condone THEN 'warn' ELSE 'danger' END,
        'law', CASE WHEN v_tribunal THEN 's.112(1)' ELSE 's.107(1)' END);
      v_pct := coalesce((v_ap ->> 'predeposit_pct')::numeric, CASE WHEN v_tribunal THEN 20 ELSE 10 END);
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
                    || '. Once paid, recovery of the rest is stayed while the appeal is pending.',
          'tone', CASE WHEN (v_ap ->> 'predeposit')::numeric + 1 >= v_req THEN 'ok' ELSE 'danger' END,
          'prn', v_ap ->> 'predeposit_prn',
          'law', CASE WHEN v_tribunal THEN 's.112(8), s.112(9)' ELSE 's.107(6), s.107(7)' END);
      END IF;
    ELSIF v_ap IS NOT NULL THEN
      v_ev := v_ev || jsonb_build_object('date', v_last, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'Appeal filed (date not on the portal record)', 'detail', 'The 3 months to appeal ran to ' || to_char(v_last, 'DD Mon YYYY') || '.',
        'tone', 'info', 'law', CASE WHEN v_tribunal THEN 's.112(1)' ELSE 's.107(1)' END);
    ELSIF v_today <= v_last THEN
      v_ev := v_ev || jsonb_build_object('date', v_last, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'Last day to appeal ' || coalesce(o.form || ' ', '') || coalesce(o.ref, 'the order'),
        'detail', (v_last - v_today) || ' days left. Then up to ' || to_char(v_condone, 'DD Mon YYYY') || ' only with a delay the authority condones.',
        'tone', 'warn', 'law', CASE WHEN v_tribunal THEN 's.112(1)' ELSE 's.107(1)' END);
    ELSIF v_today <= v_condone THEN
      v_ev := v_ev || jsonb_build_object('date', v_last, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'The 3 months to appeal ended, no appeal on record',
        'detail', 'An appeal can still be filed up to ' || to_char(v_condone, 'DD Mon YYYY') || ' with reasons for the delay.',
        'tone', 'danger', 'law', v_cond_law);
    ELSIF o.is_open OR o.form IN ('DRC-07', 'APL-04') THEN
      v_ev := v_ev || jsonb_build_object('date', v_condone, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'Time to appeal ' || coalesce(o.form || ' ', '') || coalesce(o.ref, 'the order') || ' is over, no appeal on record',
        'detail', 'The 3 months ran to ' || to_char(v_last, 'DD Mon YYYY') || ', the condonable time to ' || to_char(v_condone, 'DD Mon YYYY') || '.',
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
      v_sec := substring(coalesce(o.facts ->> 'section_of_law', '') FROM '^(74)\M');
      v_fy_ok := (o.facts ->> 'fy') IS NULL OR substring(o.facts ->> 'fy' FROM '^(\d{4})')::int < 2024;
      IF v_sec = '74' AND v_fy_ok THEN
        v_ev := v_ev || jsonb_build_object('date', v_comm + 30, 'kind', 'pay_to_close', 'own_key', o.own_key, 'item_id', o.id,
          'title', 'Last day to pay with a 50% penalty and close',
          'detail', 'Tax, interest and 50% of the penalty paid within 30 days of the order ends the proceedings.',
          'tone', CASE WHEN v_comm + 30 >= v_today THEN 'warn' ELSE 'muted' END, 'law', 's.74(11)');
      END IF;
    END IF;
  END LOOP;

  RETURN (SELECT coalesce(jsonb_agg(e || jsonb_build_object('upcoming', (e ->> 'date')::date >= v_today)
                                    ORDER BY (e ->> 'date')::date DESC, e ->> 'kind'), '[]'::jsonb)
            FROM jsonb_array_elements(v_ev) e WHERE e ->> 'date' IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.notice_case_key_dates(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.notice_case_key_dates(uuid, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_case_key_dates(uuid, text) IS
  'The dates GST law attaches to a case''s papers (time to appeal, pre-deposit, hearings, adjournments, replies due, payment and pay-to-close windows), for its timeline.';
