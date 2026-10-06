-- Notices Phase 1 · classifier tuned to the portal's real wording
-- (follows 20261006110000_notices_form_rules.sql; positions doc §9).
--
-- Read against the 1,003 live notices on 2026-10-06 (counts only):
--   * the portal lists notices by short labels — "Registration SCN",
--     "Cancellation SCN", "Order of Amendment", "Summary Order",
--     "Registration Rejection Order" — that the first rules missed;
--   * a case row's description is its latest task, so "Determination Of Tax"
--     rows read "Order for Determination of Tax" (the order, appealable) or
--     "Order for proceedings dropped" (finished), not only the notice;
--   * ~200 open rows are acknowledgements with nothing to do: DRC-03
--     "Acknowledgement of acceptance", LUT "deemed approved", "Registration
--     Certificate", "Order of Amendment", waiver approvals, dropped
--     proceedings.
-- Changes:
--   1. notice_form_rules.auto_close_reason: the closing sweep closes an
--      untriaged notice (no staff status) whose form carries one, with
--      close_reason 'auto:<reason>' — data, so the firm can switch any off;
--   2. new and widened rules for that wording;
--   3. a form's category refines only the generic "Notice" / "Order" /
--      "Uncategorised" buckets — a specific bucket (Registration, Non filers,
--      Demand Notice, or a case type such as Enforcement) is never overridden.

ALTER TABLE public.notice_form_rules ADD COLUMN IF NOT EXISTS auto_close_reason text;
COMMENT ON COLUMN public.notice_form_rules.auto_close_reason IS
  'When set, the closing sweep closes untriaged notices of this form with close_reason auto:<value> (acknowledgements and favourable orders).';

-- Widen three seeded patterns, only where they still hold the seeded text.
UPDATE public.notice_form_rules
   SET pattern = 'reg[- ]?17\M|show cause notice for cancellation|scn for cancellation|cancellation scn'
 WHERE form_code = 'REG-17' AND pattern = 'reg[- ]?17\M|show cause notice for cancellation|scn for cancellation';
UPDATE public.notice_form_rules
   SET pattern = 'reg[- ]?0?5\M|rejection of (the )?application for (new )?registration|registration rejection order|rejection of application for amendment'
 WHERE form_code = 'REG-05' AND pattern = 'reg[- ]?0?5\M|rejection of (the )?application for (new )?registration';
UPDATE public.notice_form_rules
   SET pattern = 'drc[- ]?0?7\M|summary of (the )?order|summary order|order for determination of tax'
 WHERE form_code = 'DRC-07' AND pattern = 'drc[- ]?0?7\M|summary of (the )?order';

INSERT INTO public.notice_form_rules
  (form_code, match_order, pattern, label, category, default_priority, reply_days, reply_day_kind, clock_basis, appeal_section, auto_close_reason)
VALUES
  ('DROPPED', 5, 'proceedings (are )?dropped|drop(ping)? (the )?proceedings',
   'Proceedings dropped', NULL, 'Low', NULL, 'calendar', NULL, NULL, 'proceedings_dropped'),
  ('ACCEPTED', 6, 'acceptance of response|acknowledgement of acceptance',
   'Response or payment accepted', NULL, 'Low', NULL, 'calendar', NULL, NULL, 'accepted'),
  ('LUT-APPROVED', 7, 'deemed approved|lut.{0,40}approved',
   'Letter of undertaking approved', 'LUT', 'Low', NULL, 'calendar', NULL, NULL, 'lut_approval'),
  ('REG-06', 35, 'registration certificate',
   'Registration certificate (REG-06)', 'Registration', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order'),
  ('REG-15', 36, 'order of amendment',
   'Order approving an amendment (REG-15)', 'Registration', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order'),
  ('REG-22', 37, 'order for revocation of cancellation',
   'Order revoking a cancellation (REG-22)', 'Registration', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order'),
  ('REG-SCN', 38, 'registration scn',
   'Show cause notice on registration', 'Registration', 'High', NULL, 'calendar', NULL, NULL, NULL),
  ('SPL-APPROVED', 85, 'approval of waiver',
   'Waiver scheme approved (SPL-05)', NULL, 'Low', NULL, 'calendar', NULL, NULL, 'informational_order')
ON CONFLICT (form_code) DO NOTHING;

-- The category: a generic bucket takes the form's category, a specific one stays.
CREATE OR REPLACE FUNCTION public.notice_category(p_type text, p_desc text, p_rule_category text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
           WHEN public.notice_category_legacy(p_type, p_desc) IN ('Notice', 'Order', 'Uncategorised')
             THEN coalesce(p_rule_category, public.notice_category_legacy(p_type, p_desc))
           ELSE public.notice_category_legacy(p_type, p_desc)
         END
$$;

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
         public.ist_today() AS today_ist
    FROM public.gst_notices g
    JOIN public.clients c ON c.id = g.client_id
    LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
   WHERE g.deleted_at IS NULL
     AND g.source = 'notices'
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
  coalesce(d.open_flag AND NOT d.replied_flag AND d.eff_due < d.today_ist, false) AS is_overdue,
  coalesce(d.open_flag AND NOT d.replied_flag AND d.eff_due BETWEEN d.today_ist AND d.today_ist + 7, false) AS is_due_in_7,
  coalesce(d.first_seen_at > now() - interval '24 hours', false) AS is_new,
  (d.open_flag AND d.assign_to_user_id IS NULL) AS is_unassigned,
  d.dispute AS dispute_key,
  CASE WHEN d.exposure_candidate
        AND row_number() OVER (PARTITION BY d.client_id, d.dispute, d.exposure_candidate
                               ORDER BY d.issue_date DESC NULLS LAST, d.id) = 1
       THEN d.amount_of_demand ELSE 0 END AS exposure_amount,
  d.today_ist
FROM derived d;

-- ── Closing sweep (replaces the version in 20261006112000) ────────────────
-- Adds part 3: a form rule's auto_close_reason closes untriaged notices.
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

  PERFORM set_config('app.actor_name', v_prev_actor, true);
  RETURN jsonb_build_object('closed', v_closed, 'due_dates_set', v_due, 'client_id', p_client_id, 'ran_at', now());
END;
$$;

COMMENT ON FUNCTION public.notices_sweep(uuid) IS
  'Closing sweep for the notices module: keeps case due dates current from the case folder; auto-closes untriaged rows by rule (closure folder, paid refund, approved LUT, acknowledged DRC-03) and by form (notice_form_rules.auto_close_reason). NULL = every client.';
