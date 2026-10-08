-- Notices · clean-up and settings (the firm's request of 8 October 2026):
--   "so many notices showing on our dashboard which in fact is not the case …
--    our system has not decided intelligently what to close", "a settings
--    section … where I should be able to select for which client we are handling
--    the litigation", and clients with portal password problems "logged in our
--    portal … so that the team can act upon the same".
--
-- 1. Closing sweep, part 4: a notice the portal has moved past closes itself
--    (close_reason auto:…, reviewable and reopenable like every automatic close):
--      * a notice that asks for a reply (ASMT-10, DRC-01, DRC-01A/B/C, RFD-03,
--        RFD-08, ADT-01/02, a hearing notice, summons) closes when a later notice
--        of the same case exists (auto:superseded_in_case) or when its case holds
--        both a reply and an order (auto:replied_and_decided). Orders (DRC-07,
--        RFD-06 …) are never closed by this: their appeal clock is the task.
--      * registration: a query on an application (REG-03), a show cause notice
--        for cancellation (REG-17 / portal "REG-SCN"), a rejection (REG-05) or a
--        rejected cancellation request closes when a later registration notice
--        of the client exists or it is over 120 days old (reply windows are 7 to
--        30 days, the appeal window 3 months plus 1) (auto:registration_concluded);
--        a cancellation order (REG-19) closes only when the registration is
--        active again or revoked by a REG-22 (auto:registration_restored).
--    Only untriaged notices (staff_status NULL), as for every automatic close.
-- 2. clients.notices_handled (default true): off = the firm does not handle this
--    client's litigation. Its notices leave notice_facts (so every task, list,
--    count, plan, report and alert), raise no e-mail, and the notices sync skips
--    it (notices_sync_excluded follows the switch). Back on = everything returns.
-- 3. clients.portal_login_issue: the reason the portal refused the client's
--    saved login (wrong_password, account_locked, password_expired,
--    password_change_required), set by the extension (client_login_issue_set),
--    shown in Notices · Settings for the team, skipped by every sync, and cleared
--    when the user ID or password is changed in Edit Client or a login works.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS notices_handled boolean NOT NULL DEFAULT true;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS portal_login_issue text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS portal_login_issue_message text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS portal_login_issue_at timestamptz;
COMMENT ON COLUMN public.clients.notices_handled IS
  'Notices & Litigation: false = the firm does not handle this client''s litigation; its notices are left out of every task, list and alert, and the notices sync skips it.';
COMMENT ON COLUMN public.clients.portal_login_issue IS
  'Why the GST portal refused this client''s saved login (wrong_password, account_locked, password_expired, password_change_required); NULL = none. Set by the extension, cleared by a new user ID or password or a login that works.';

CREATE OR REPLACE FUNCTION public.clients_notices_switches()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.notices_handled IS DISTINCT FROM OLD.notices_handled THEN
    NEW.notices_sync_excluded := NOT NEW.notices_handled;
  END IF;
  IF NEW.portal_login_issue IS NOT NULL
     AND (NEW.gst_password IS DISTINCT FROM OLD.gst_password OR NEW.gst_user_id IS DISTINCT FROM OLD.gst_user_id) THEN
    NEW.portal_login_issue := NULL;
    NEW.portal_login_issue_message := NULL;
    NEW.portal_login_issue_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_clients_notices_switches ON public.clients;
CREATE TRIGGER trg_clients_notices_switches BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_notices_switches();

-- The extension records a refusal (or clears it with p_reason NULL).
CREATE OR REPLACE FUNCTION public.client_login_issue_set(p_client_id uuid, p_reason text, p_message text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_reason IS NOT NULL AND p_reason NOT IN ('wrong_password', 'account_locked', 'password_expired', 'password_change_required') THEN
    RAISE EXCEPTION 'client_login_issue_set: unknown reason %', p_reason USING ERRCODE = '22023';
  END IF;
  UPDATE public.clients
     SET portal_login_issue = p_reason,
         portal_login_issue_message = CASE WHEN p_reason IS NULL THEN NULL ELSE left(p_message, 500) END,
         portal_login_issue_at = CASE WHEN p_reason IS NULL THEN NULL ELSE now() END
   WHERE id = p_client_id
     AND (portal_login_issue IS DISTINCT FROM p_reason OR p_reason IS NOT NULL);
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.client_login_issue_set(uuid, text, text) TO anon, authenticated, service_role;

-- Notices · Settings: switch litigation handling for one or more clients.
CREATE OR REPLACE FUNCTION public.notices_clients_handled_set(p_client_ids uuid[], p_handled boolean)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.clients SET notices_handled = p_handled
     WHERE id = ANY (p_client_ids) AND notices_handled IS DISTINCT FROM p_handled
    RETURNING 1)
  SELECT count(*)::int FROM u;
$$;
GRANT EXECUTE ON FUNCTION public.notices_clients_handled_set(uuid[], boolean) TO anon, authenticated, service_role;

-- Notices · Settings: every client with what the page shows (open notices counted
-- on gst_notices itself, so a client switched off still shows how many it has).
CREATE OR REPLACE FUNCTION public.notices_client_settings()
RETURNS TABLE (id uuid, name text, gstin text, gst_user_id text, notices_handled boolean, notices_sync_excluded boolean,
               inactive_at_hand boolean, open_notices bigint, portal_login_issue text, portal_login_issue_message text,
               portal_login_issue_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.name, c.gstin, c.gst_user_id, c.notices_handled, coalesce(c.notices_sync_excluded, false),
         coalesce(c.inactive_at_hand, false),
         (SELECT count(*) FROM public.gst_notices g
           WHERE g.client_id = c.id AND g.deleted_at IS NULL AND g.source = 'notices'
             AND NOT public.notice_is_closed(g.staff_status) AND NOT public.notice_type_hidden(g.form_code)),
         c.portal_login_issue, c.portal_login_issue_message, c.portal_login_issue_at
    FROM public.clients c
   ORDER BY c.name;
$$;
GRANT EXECUTE ON FUNCTION public.notices_client_settings() TO anon, authenticated, service_role;

-- ── notice_facts: a client not handled is left out (same columns) ──────────
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
         coalesce(ts.response_need, 'critical') AS response_need,
         coalesce(ts.show_on_dashboard, true) AS on_dashboard
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
), derived AS (
  SELECT b.*,
         NOT public.notice_is_closed(b.staff_status) AS open_flag,
         (b.reply_date IS NOT NULL) AS replied_flag,
         coalesce(b.extended_due_date, b.due_date, b.computed_due) AS eff_due,
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
       WHEN d.due_date IS NOT NULL THEN 'portal'
       WHEN d.computed_due IS NOT NULL THEN 'computed' END AS due_basis,
  CASE WHEN d.extended_due_date IS NULL AND d.due_date IS NULL AND d.computed_due IS NOT NULL
       THEN d.clock_basis END AS due_basis_note,
  (d.eff_due - d.today_ist) AS days_to_due,
  coalesce(d.open_flag AND NOT d.replied_flag AND d.response_need <> 'none' AND d.eff_due < d.today_ist, false) AS is_overdue,
  coalesce(d.open_flag AND NOT d.replied_flag AND d.response_need <> 'none' AND d.eff_due BETWEEN d.today_ist AND d.today_ist + 7, false) AS is_due_in_7,
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
  d.on_dashboard
FROM derived d
JOIN public.notice_stages st ON st.key = d.stage;

-- ── No e-mail about a hidden type or a client not handled ─────────────────
CREATE OR REPLACE FUNCTION public.notice_events_hidden_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.alert_processed_at IS NULL AND NEW.notice_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.gst_notices g
                   JOIN public.clients c ON c.id = g.client_id
                   LEFT JOIN public.notice_type_settings s ON s.form_code = g.form_code
                  WHERE g.id = NEW.notice_id
                    AND (coalesce(s.hidden, false) OR NOT coalesce(c.notices_handled, true))) THEN
    NEW.alert_processed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- ── Closing sweep, part 4: notices the portal has moved past ───────────────
CREATE OR REPLACE FUNCTION public.notices_sweep_superseded(p_client_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_n integer := 0;
  v_k integer;
BEGIN
  -- A notice that asks for a reply, once its case has moved on.
  WITH cand AS (
    SELECT n.id,
           CASE
             WHEN EXISTS (SELECT 1 FROM public.gst_notices n2
                           WHERE n2.client_id = n.client_id AND n2.case_id = n.case_id AND n2.deleted_at IS NULL
                             AND n2.id <> n.id AND n2.issue_date > n.issue_date)
               THEN 'auto:superseded_in_case'
             WHEN EXISTS (SELECT 1 FROM public.gst_case_folder_items i
                           WHERE i.client_id = n.client_id AND i.case_id = n.case_id AND i.deleted_at IS NULL
                             AND upper(btrim(coalesce(i.folder_section, ''))) IN ('REPLY', 'REPLIES'))
              AND EXISTS (SELECT 1 FROM public.gst_case_folder_items i
                           WHERE i.client_id = n.client_id AND i.case_id = n.case_id AND i.deleted_at IS NULL
                             AND upper(btrim(coalesce(i.folder_section, ''))) IN ('ORDRS', 'ORDER', 'ORDERS'))
               THEN 'auto:replied_and_decided'
           END AS reason
      FROM public.gst_notices n
     WHERE n.deleted_at IS NULL AND n.staff_status IS NULL AND n.source = 'notices'
       AND n.case_id IS NOT NULL AND n.issue_date IS NOT NULL
       AND n.form_code IN ('ASMT-10', 'ASMT-02', 'DRC-01', 'DRC-01A', 'DRC-01B', 'DRC-01C', 'RFD-03', 'RFD-08',
                           'ADT-01', 'ADT-02', 'APL-HEARING', 'SUMMONS')
       AND (p_client_id IS NULL OR n.client_id = p_client_id)
  )
  UPDATE public.gst_notices g SET staff_status = 'Closed', close_reason = c.reason
    FROM cand c
   WHERE g.id = c.id AND c.reason IS NOT NULL AND g.staff_status IS NULL;
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;

  -- Registration: a query, a show cause notice or a rejection that is concluded.
  UPDATE public.gst_notices n SET staff_status = 'Closed', close_reason = 'auto:registration_concluded'
   WHERE n.deleted_at IS NULL AND n.staff_status IS NULL AND n.source = 'notices'
     AND n.form_code IN ('REG-03', 'REG-SCN', 'REG-17', 'REG-05', 'REG-CANCEL-REJ')
     AND (p_client_id IS NULL OR n.client_id = p_client_id)
     AND (n.issue_date < public.ist_today() - 120
          OR EXISTS (SELECT 1 FROM public.gst_notices n2
                      WHERE n2.client_id = n.client_id AND n2.deleted_at IS NULL AND n2.id <> n.id
                        AND n2.form_code LIKE 'REG-%' AND n2.issue_date > n.issue_date));
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;

  -- A cancellation order, once the registration is active again or revoked.
  UPDATE public.gst_notices n SET staff_status = 'Closed', close_reason = 'auto:registration_restored'
   WHERE n.deleted_at IS NULL AND n.staff_status IS NULL AND n.source = 'notices'
     AND n.form_code = 'REG-19'
     AND (p_client_id IS NULL OR n.client_id = p_client_id)
     AND (EXISTS (SELECT 1 FROM public.gst_notices n2
                   WHERE n2.client_id = n.client_id AND n2.deleted_at IS NULL AND n2.form_code = 'REG-22'
                     AND n2.issue_date > n.issue_date)
          OR EXISTS (SELECT 1 FROM public.gst_taxpayer_profile p
                      WHERE p.client_id = n.client_id AND coalesce(p.gstin_status, '') ~* '^\s*active'));
  GET DIAGNOSTICS v_k = ROW_COUNT;
  RETURN v_n + v_k;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notices_sweep_superseded(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notices_sweep(p_client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_due int := 0;
  v_closed int := 0;
  v_by_form int := 0;
  v_prev_actor text := coalesce(current_setting('app.actor_name', true), '');
  r record;
BEGIN
  PERFORM set_config('app.actor_name', 'Closing sweep', true);

  WITH items AS (
    SELECT fi.client_id, fi.case_id, fi.reference_number,
           upper(btrim(coalesce(fi.folder_section, ''))) AS sec,
           public.notices_item_due_date(fi.raw_json) AS due,
           public.notices_parse_portal_date(CASE WHEN jsonb_typeof(fi.raw_json) = 'object' THEN fi.raw_json ->> 'refdt' END) AS issued
      FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL
       AND (p_client_id IS NULL OR fi.client_id = p_client_id)
  ),
  replied AS (
    SELECT fi.client_id, fi.case_id,
           COALESCE(fi.raw_json -> 'reply' ->> 'ntcno', CASE WHEN jsonb_typeof(fi.raw_json) = 'object' THEN fi.raw_json ->> 'ntcno' END) AS against
      FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL
       AND upper(btrim(coalesce(fi.folder_section, ''))) IN ('REPLY', 'REPLIES')
       AND (p_client_id IS NULL OR fi.client_id = p_client_id)
  ),
  due_items AS (
    SELECT i.*
      FROM items i
     WHERE i.due IS NOT NULL
       AND i.sec IN ('INTIM', 'INTIMATIONS', 'NOTCE', 'NOTICE', 'NOTICES', 'NOTAC', 'NOTICE/ACKNOWLEDGEMENT')
       AND NOT EXISTS (SELECT 1 FROM replied rp
                        WHERE rp.client_id = i.client_id AND rp.case_id = i.case_id
                          AND rp.against IS NOT NULL AND rp.against = i.reference_number)
  ),
  pick AS (
    SELECT n.id,
           COALESCE(
             (SELECT d.due FROM due_items d
               WHERE d.client_id = n.client_id AND d.case_id = n.case_id AND d.reference_number = n.reference_number
               ORDER BY d.due DESC LIMIT 1),
             (SELECT d.due FROM due_items d
               WHERE d.client_id = n.client_id AND d.case_id = n.case_id
               ORDER BY d.issued DESC NULLS LAST, d.due DESC LIMIT 1)
           ) AS due
      FROM public.gst_notices n
     WHERE n.deleted_at IS NULL AND n.case_id IS NOT NULL
       AND (n.due_date IS NULL OR n.due_date_source = 'case_folder')
       AND (p_client_id IS NULL OR n.client_id = p_client_id)
  )
  UPDATE public.gst_notices n
     SET due_date = p.due, due_date_source = 'case_folder'
    FROM pick p
   WHERE n.id = p.id AND p.due IS NOT NULL AND n.due_date IS DISTINCT FROM p.due;
  GET DIAGNOSTICS v_due = ROW_COUNT;

  FOR r IN
    WITH cand AS (
      SELECT n.id, n.client_id, n.case_id, n.reference_number, coalesce(n.notice_type, '') AS ntype
        FROM public.gst_notices n
       WHERE n.deleted_at IS NULL AND n.staff_status IS NULL AND n.case_id IS NOT NULL
         AND (p_client_id IS NULL OR n.client_id = p_client_id)
    ),
    secs AS (
      SELECT fi.client_id, fi.case_id,
             bool_or(upper(btrim(coalesce(fi.folder_section, ''))) IN ('CLSR', 'CLOSR', 'CLOSURE')) AS has_closure,
             bool_or(upper(btrim(coalesce(fi.folder_section, ''))) IN ('ORDRS', 'ORDER', 'ORDERS')) AS has_order,
             bool_or(upper(btrim(coalesce(fi.folder_section, ''))) IN ('ORDRS', 'ORDER', 'ORDERS')
                     AND jsonb_typeof(fi.raw_json -> 'sdtls' -> 'payadviceordervo') = 'object') AS has_payment_order,
             bool_or(coalesce(fi.raw_json -> 'sdtls' -> 'sancordervo' ->> 'ordertype', '') ~* 'reject') AS has_rejection
        FROM public.gst_case_folder_items fi
       WHERE fi.deleted_at IS NULL
         AND (p_client_id IS NULL OR fi.client_id = p_client_id)
       GROUP BY fi.client_id, fi.case_id
    )
    SELECT c.id, c.client_id,
           CASE
             WHEN s.has_closure THEN 'auto:closure'
             WHEN c.ntype ~* 'refund' AND s.has_payment_order AND NOT coalesce(s.has_rejection, false) THEN 'auto:refund_paid'
             WHEN c.ntype ~* '(letter of undertaking|\mlut\M)' AND s.has_order THEN 'auto:lut_approval'
             WHEN c.ntype ~* 'voluntary payment' AND EXISTS (
                    SELECT 1 FROM public.gst_drc03_filings d
                     WHERE d.client_id = c.client_id AND d.deleted_at IS NULL
                       AND (d.arn = c.case_id OR d.arn = c.reference_number)
                       AND coalesce(d.status, '') ~* 'acknowledg') THEN 'auto:drc03_acknowledged'
           END AS reason
      FROM cand c
      LEFT JOIN secs s ON s.client_id = c.client_id AND s.case_id = c.case_id
  LOOP
    CONTINUE WHEN r.reason IS NULL;
    UPDATE public.gst_notices
       SET staff_status = 'Closed', close_reason = r.reason
     WHERE id = r.id AND staff_status IS NULL;
    IF FOUND THEN v_closed := v_closed + 1; END IF;
  END LOOP;

  -- Part 3: acknowledgements and favourable orders, by form rule.
  UPDATE public.gst_notices n
     SET staff_status = 'Closed', close_reason = 'auto:' || fr.auto_close_reason
    FROM public.notice_form_rules fr
   WHERE fr.form_code = n.form_code AND fr.is_active AND fr.auto_close_reason IS NOT NULL
     AND n.deleted_at IS NULL AND n.staff_status IS NULL
     AND (p_client_id IS NULL OR n.client_id = p_client_id);
  GET DIAGNOSTICS v_by_form = ROW_COUNT;
  v_closed := v_closed + v_by_form;

  -- Part 4 (20261010100000): notices the portal has moved past.
  v_closed := v_closed + public.notices_sweep_superseded(p_client_id);

  PERFORM set_config('app.actor_name', v_prev_actor, true);
  RETURN jsonb_build_object('closed', v_closed, 'due_dates_set', v_due, 'client_id', p_client_id, 'ran_at', now());
END;
$$;

-- Run once now over every client.
SELECT public.notices_sweep(NULL);

NOTIFY pgrst, 'reload schema';
