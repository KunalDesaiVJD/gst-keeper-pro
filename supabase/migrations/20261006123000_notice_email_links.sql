-- Notices Phase 2 · e-mail deep links and readable alerts, the bell's read
-- state, the forms "Add notice" offers (roadmap Phase 2 task 1 "deep links
-- from every e-mail"; audit U-120-1…3, U-121-1…3, U-122-1…3, U-123-1…3,
-- U-02-3, U-05-2).
--   * Every alert links to the notice's own page, /notices/<id>; the e-mail
--     shell shows that link as an "Open notice" button above the facts
--     (cta_url / cta_label, filled here for every rule).
--   * Internal alerts carry no client greeting and no signature; the facts
--     (client, form, reference, demand, stage, owner, days left) are given
--     once, in the shell's box, and the body is one sentence. The pill and
--     the due line are coloured by days left, not by the rule's priority.
--   * The morning list and the managers' overdue list give client, form,
--     reference, days and amount on each line, linked to the notice; the
--     overdue list is grouped by owner, most overdue first, and says how many
--     more there are. Appeal clocks carry the order's facts.
--   * E-mails to clients (E12, E13) are signed by the staff member who sent
--     them; their bodies no longer repeat the shell's greeting.
--   * Seeded templates are rewritten only where they still hold their seeded
--     text, so a template the firm has edited is left alone.
-- The shell itself lives in supabase/functions/_shared/email.ts (sent mail)
-- and src/lib/emailTemplate.ts (in-app preview).

-- ── The bell: what each user has seen, across computers (U-02-3) ─────────
CREATE TABLE IF NOT EXISTS public.notice_bell_state (
  user_id    uuid PRIMARY KEY,
  seen_at    timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notice_bell_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notice_bell_state_all" ON public.notice_bell_state;
CREATE POLICY "notice_bell_state_all" ON public.notice_bell_state FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.notice_bell_state TO anon, authenticated;
GRANT ALL ON public.notice_bell_state TO service_role;

-- ── Forms a typed-in notice can be given (U-05-2) ──────────────────────────
-- The classifier reads the form from the notice text, so "Add notice" stores
-- the form's label as the notice type; only forms whose label reads back as
-- the same form are offered.
CREATE OR REPLACE VIEW public.notice_form_choices WITH (security_invoker = true) AS
SELECT r.form_code, r.label, r.category, r.default_priority, r.reply_days, r.reply_day_kind, r.clock_basis
  FROM public.notice_form_rules r
 WHERE r.is_active
   AND public.notice_form_code(r.label, NULL) = r.form_code;
GRANT SELECT ON public.notice_form_choices TO anon, authenticated, service_role;

-- ── Formatting helpers ─────────────────────────────────────────────────────
-- "₹4,82,690" (Indian grouping); '' for no amount.
CREATE OR REPLACE FUNCTION public.fmt_inr(p numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p IS NULL THEN ''
              ELSE CASE WHEN p < 0 THEN '-' ELSE '' END || '₹'
                   || CASE WHEN length(s.t) <= 3 THEN s.t
                           ELSE regexp_replace(left(s.t, length(s.t) - 3), '(\d)(?=(\d\d)+$)', '\1,', 'g')
                                || ',' || right(s.t, 3) END
         END
    FROM (SELECT round(abs(p))::text AS t) s
$$;

-- "due in 3 days", "due today", "2 days overdue", "replied 05 Oct 2026".
CREATE OR REPLACE FUNCTION public.notice_due_words(p_due date, p_replied date)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_replied IS NOT NULL THEN 'replied ' || public.fmt_ist_date(p_replied)
    WHEN p_due IS NULL THEN ''
    WHEN p_due < public.ist_today() THEN (public.ist_today() - p_due)
         || CASE WHEN public.ist_today() - p_due = 1 THEN ' day overdue' ELSE ' days overdue' END
    WHEN p_due = public.ist_today() THEN 'due today'
    WHEN p_due = public.ist_today() + 1 THEN 'due tomorrow'
    ELSE 'due in ' || (p_due - public.ist_today()) || ' days'
  END
$$;

-- ── One notice's alert variables (replaces the 117000 version) ────────────
CREATE OR REPLACE FUNCTION public.notice_alert_notice_vars(p_notice_id uuid, p_base_url text)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'notice_id', g.id,
           'client_id', g.client_id,
           'owner', g.assign_to_user_id,
           'critical', coalesce(g.priority, r.default_priority) = 'High',
           'notice_type', coalesce(r.label, g.notice_type, 'Notice'),
           'form_code', coalesce(g.form_code, ''),
           'client_name', c.name,
           'gstin', c.gstin,
           'reference_number', coalesce(g.reference_number, ''),
           'issue_date', public.fmt_ist_date(g.issue_date),
           'due_date', public.fmt_ist_date(e.eff),
           'days_remaining', CASE WHEN g.reply_date IS NULL THEN coalesce((e.eff - public.ist_today())::text, '') ELSE '' END,
           'due_words', public.notice_due_words(e.eff, g.reply_date),
           'priority', coalesce(g.priority, r.default_priority, ''),
           'hearing_date', public.fmt_ist_date(g.hearing_date),
           'issued_by', coalesce(g.issued_by, ''),
           'description', coalesce(g.description, ''),
           'reply_date', public.fmt_ist_date(g.reply_date),
           'reply_ref_number', coalesce(g.reply_ref_number, ''),
           'case_id', coalesce(g.case_id, ''),
           'staff_status', coalesce(g.staff_status, ''),
           'stage', coalesce(st.label, ''),
           'owner_name', coalesce(g.assign_to, ''),
           'amount', CASE WHEN coalesce(g.amount_of_demand, 0) > 0 THEN public.fmt_inr(g.amount_of_demand) ELSE '' END,
           'pdf_url', coalesce(g.pdf_url, ''),
           'notice_url', p_base_url || '/notices/' || g.id,
           'link_html', '<a href="' || p_base_url || '/notices/' || g.id || '">Open this notice in GST Keeper</a>')
    FROM public.gst_notices g
    JOIN public.clients c ON c.id = g.client_id
    LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
    LEFT JOIN public.notice_stages st ON st.key = g.stage
    CROSS JOIN LATERAL (SELECT coalesce(g.extended_due_date, g.due_date,
                                        public.notice_computed_due(g.issue_date, g.case_id, g.form_code)) AS eff) e
   WHERE g.id = p_notice_id AND g.deleted_at IS NULL AND g.source = 'notices'
$$;
REVOKE EXECUTE ON FUNCTION public.notice_alert_notice_vars(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── Queue one alert (replaces the 115000 version) ──────────────────────────
-- The caller's variables now win over the defaults (so a client e-mail can be
-- signed by the staff member who sent it). Adds _audience (internal | client),
-- a headline, the call to action and the shell by days left.
CREATE OR REPLACE FUNCTION public.notice_alert_enqueue(
  p_rule_key text, p_to_email text, p_to_name text, p_user_id uuid, p_vars jsonb, p_dedupe text,
  p_notice_id uuid DEFAULT NULL, p_client_id uuid DEFAULT NULL, p_event_id uuid DEFAULT NULL,
  p_critical boolean DEFAULT false, p_template_key text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode    text;
  v_base    text;
  v_rule    record;
  v_tpl_key text;
  v_tpl     record;
  v_client  boolean := p_rule_key IN ('E12_client_docs', 'E13_client_update');
  v_days    int;
  v_tone    text;
  v_raw     jsonb;
  v_body    jsonb;
  v_id      uuid;
BEGIN
  SELECT s.alerts_mode, s.app_base_url INTO v_mode, v_base FROM public.notice_settings s WHERE s.id;
  IF coalesce(v_mode, 'preview') = 'off' OR coalesce(btrim(p_to_email), '') = '' THEN RETURN false; END IF;
  SELECT r.id, r.is_active, r.template_key INTO v_rule FROM public.notice_alert_rules r WHERE r.alert_key = p_rule_key;
  IF v_rule.id IS NULL OR NOT v_rule.is_active THEN RETURN false; END IF;
  IF p_user_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.staff_notification_prefs np
        WHERE np.user_id = p_user_id AND np.channel = 'email' AND np.alert_kind = p_rule_key AND NOT np.enabled) THEN
    RETURN false;
  END IF;
  v_tpl_key := coalesce(p_template_key, v_rule.template_key);
  SELECT t.subject, t.body, t.is_active INTO v_tpl FROM public.email_templates t WHERE t.key = v_tpl_key;
  IF NOT FOUND OR v_tpl.is_active = false THEN RETURN false; END IF;

  v_raw := jsonb_build_object(
             'contact_person', coalesce(p_to_name, ''),
             'staff_name', CASE WHEN v_client THEN 'V. J. Desai & Co. (GST Team)' ELSE '' END,
             'firm_name', 'V. J. Desai & Co. LLP',
             'firm_email', 'gst@vjdesai.com')
           || coalesce(p_vars, '{}'::jsonb);

  -- Colour by days left: two days or less (or overdue) red, a week amber.
  v_days := CASE WHEN coalesce(v_raw ->> 'days_remaining', '') ~ '^-?\d+$' THEN (v_raw ->> 'days_remaining')::int END;
  v_tone := CASE WHEN v_days IS NOT NULL AND v_days <= 2 THEN 'urgent'
                 WHEN v_days IS NOT NULL AND v_days <= 7 THEN 'soon'
                 WHEN v_days IS NULL AND p_critical THEN 'urgent'
                 ELSE 'normal' END;

  v_raw := v_raw || jsonb_build_object(
    '_audience', CASE WHEN v_client THEN 'client' ELSE 'internal' END,
    'headline', CASE WHEN v_client THEN '' ELSE coalesce(nullif(v_raw ->> 'headline', ''),
      CASE p_rule_key
        WHEN 'E1_new_notice' THEN
          CASE WHEN v_raw ? 'notice_count' THEN (v_raw ->> 'notice_count') || ' new notices captured'
               ELSE 'New notice captured' END || coalesce(' · ' || nullif(v_raw ->> 'due_words', ''), '')
        WHEN 'E6_assigned' THEN 'Assigned to you' || coalesce(' · ' || nullif(v_raw ->> 'due_words', ''), '')
        WHEN 'E7_status_changed' THEN 'Stage changed' || coalesce(' · now ' || nullif(v_raw ->> 'stage', ''), '')
        WHEN 'E8_reply_logged' THEN 'Reply logged'
        WHEN 'E15_portal_update' THEN coalesce(nullif(v_raw ->> 'update_label', ''), 'Portal update') || ' on a case you own'
        WHEN 'E3_due_in_7' THEN 'Your notices for ' || coalesce(v_raw ->> 'report_date', 'today')
        WHEN 'E2_overdue_digest' THEN coalesce(v_raw ->> 'overdue_count', '') || ' overdue notices across the firm'
        WHEN 'E11_unassigned' THEN coalesce(v_raw ->> 'unassigned_count', '') || ' notices without an owner'
        WHEN 'E10_weekly_mis' THEN 'Weekly notices summary'
        WHEN 'E9_sync_anomaly' THEN 'The portal sync needs a look'
        ELSE '' END) END,
    'cta_url', CASE WHEN v_client THEN '' ELSE coalesce(
      nullif(v_raw ->> 'cta_url', ''), nullif(v_raw ->> 'notice_url', ''),
      substring(v_raw ->> 'link_html' from 'href="([^"]+)"'),
      CASE p_rule_key WHEN 'E9_sync_anomaly' THEN v_base || '/notices-company-list?status=failed'
                      WHEN 'E10_weekly_mis' THEN v_base || '/notices-dashboard' END, '') END,
    'cta_label', coalesce(
      nullif(v_raw ->> 'cta_label', ''),
      CASE WHEN v_raw ? 'notice_url' THEN 'Open notice' END,
      substring(v_raw ->> 'link_html' from '>([^<]+)</a>'),
      CASE p_rule_key WHEN 'E9_sync_anomaly' THEN 'Open the client list'
                      WHEN 'E10_weekly_mis' THEN 'Open the command centre' END,
      'Open GST Keeper'),
    '_tone', v_tone);

  SELECT jsonb_object_agg(k, CASE WHEN k LIKE '%\_html' THEN to_jsonb(v) ELSE to_jsonb(public.html_escape(v)) END)
    INTO v_body
    FROM jsonb_each_text(v_raw) AS e(k, v);
  v_body := v_body || jsonb_build_object('_shell', CASE v_tone WHEN 'urgent' THEN 'notice_alert_critical'
                                                               WHEN 'soon' THEN 'notice_alert_soon'
                                                               ELSE 'notice_alert' END);

  INSERT INTO public.email_outbox (to_email, kind, template_key, subject, body, render_vars, status,
                                   notice_id, client_id, dedupe_key)
  VALUES (lower(btrim(p_to_email)), 'notice_alert', v_tpl_key,
          left(regexp_replace(public.render_template(v_tpl.subject, v_raw), '\s+', ' ', 'g'), 250),
          public.render_template(v_tpl.body, v_body), v_body,
          CASE WHEN v_mode = 'live' THEN 'pending' ELSE 'preview' END,
          p_notice_id, p_client_id, p_dedupe)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.notice_alert_log (rule_id, notice_id, client_id, event_id, email_outbox_id, recipient_email, status, dedupe_key)
  VALUES (v_rule.id, p_notice_id, p_client_id, p_event_id, v_id, lower(btrim(p_to_email)),
          CASE WHEN v_mode = 'live' THEN 'queued' ELSE 'preview' END, p_dedupe);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notice_alert_enqueue(text, text, text, uuid, jsonb, text, uuid, uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- ── Morning reminders (replaces the 115000 version) ────────────────────────
-- Same sections and recipients; each line now names client, form and
-- reference, links to the notice, and gives days and amount (U-122-1). Appeal
-- clocks carry the order's date, number and demand (U-123-1, U-123-2). The
-- managers' overdue list is grouped by owner, most overdue first, and ends
-- with how many more there are and a link to the full list.
CREATE OR REPLACE FUNCTION public.notice_alerts_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings record;
  v_today    date := public.ist_today();
  v_base     text;
  v_e2       record;
  v_e3       record;
  v_e4       record;
  v_e5       record;
  v_e11      record;
  v_d        record;
  v_r        record;
  v_queued   int := 0;
  v_vars     jsonb;
  v_lines    text;
  v_html     text;
  v_count    int;
BEGIN
  SELECT * INTO v_settings FROM public.notice_settings WHERE id;
  v_base := v_settings.app_base_url;
  SELECT * INTO v_e2 FROM public.notice_alert_rules WHERE alert_key = 'E2_overdue_digest';
  SELECT * INTO v_e3 FROM public.notice_alert_rules WHERE alert_key = 'E3_due_in_7';
  SELECT * INTO v_e4 FROM public.notice_alert_rules WHERE alert_key = 'E4_hearing_reminder';
  SELECT * INTO v_e5 FROM public.notice_alert_rules WHERE alert_key = 'E5_limitation_alert';
  SELECT * INTO v_e11 FROM public.notice_alert_rules WHERE alert_key = 'E11_unassigned';

  -- Personal lists: a notice goes to its owner; one nobody (reachable) owns goes
  -- to every manager — except its overdue line, which the firm-wide E2 list covers.
  DROP TABLE IF EXISTS pg_temp._digest_items;
  CREATE TEMP TABLE _digest_items ON COMMIT DROP AS
  WITH staff AS (SELECT * FROM public.notice_alert_staff()),
  routed AS (
    SELECT f.*, s.user_id AS to_user, s.name AS to_name, s.email AS to_email,
           (s.user_id IS DISTINCT FROM f.assign_to_user_id) AS unowned
      FROM public.notice_facts f
      JOIN staff s ON s.user_id = f.assign_to_user_id
                   OR (s.is_manager AND NOT EXISTS (SELECT 1 FROM staff o WHERE o.user_id = f.assign_to_user_id))
  ), items AS (
    SELECT r.*, 1 AS sort_key, 'Overdue' AS section, 'overdue' AS short, r.effective_due AS on_date
      FROM routed r WHERE coalesce(v_e3.is_active, false) AND r.is_overdue AND NOT r.unowned
    UNION ALL
    SELECT r.*, 2, 'Reply due today', 'due today', r.effective_due
      FROM routed r WHERE coalesce(v_e3.is_active, false) AND r.is_open AND NOT r.is_replied AND r.days_to_due = 0
    UNION ALL
    SELECT r.*, 3, 'Reply due tomorrow', 'due tomorrow', r.effective_due
      FROM routed r WHERE coalesce(v_e3.is_active, false) AND r.is_open AND NOT r.is_replied AND r.days_to_due = 1
    UNION ALL
    SELECT r.*, 4, 'Reply due in 3 days', 'due in 3 days', r.effective_due
      FROM routed r WHERE coalesce(v_e3.is_active, false) AND r.is_open AND NOT r.is_replied AND r.days_to_due = 3
    UNION ALL
    SELECT r.*, 5, 'Reply due in 7 days', 'due in 7 days', r.effective_due
      FROM routed r WHERE coalesce(v_e3.is_active, false) AND r.is_open AND NOT r.is_replied AND r.days_to_due = 7
    UNION ALL
    SELECT r.*, 6, 'Hearings', CASE r.hearing_date - v_today WHEN 0 THEN 'hearing today' ELSE 'hearing soon' END, r.hearing_date
      FROM routed r WHERE coalesce(v_e4.is_active, false) AND r.is_open AND (r.hearing_date - v_today) IN (0, 1, 7)
  )
  SELECT i.to_user, i.to_name, i.to_email, i.sort_key, i.section, i.short, i.id AS notice_id, i.client_id,
         i.client_name, coalesce(i.form_code, i.form_label, i.notice_type, 'Notice') AS label, i.reference_number,
         i.on_date, i.unowned, NULL::text AS clock_label, i.exposure_amount AS amount, i.stage_label,
         NULL::text AS order_facts
    FROM items i;

  -- Appeal / condonation / attachment clocks run on after the notice is closed.
  INSERT INTO _digest_items
  SELECT s.user_id, s.name, s.email, 7, 'Appeal and attachment clocks', 'clock',
         f.id, f.client_id, f.client_name, coalesce(f.form_code, f.form_label, f.notice_type, 'Notice'), f.reference_number,
         md.deadline_date, s.user_id IS DISTINCT FROM f.assign_to_user_id,
         CASE md.deadline_type
           WHEN 'appeal_s107' THEN 'First appeal (s.107)'
           WHEN 'appeal_s107_condonation' THEN 'First appeal, outer limit with condonation'
           WHEN 'appeal_s112' THEN 'Tribunal appeal (s.112)'
           WHEN 'appeal_s112_condonation' THEN 'Tribunal appeal, outer limit with condonation'
           WHEN 'attachment_expiry' THEN 'Provisional attachment lapses'
           ELSE md.deadline_type END
         || CASE WHEN md.period_confirmed THEN '' ELSE ' (period not yet confirmed by the firm)' END,
         coalesce(nullif(f.amount_of_demand, 0), 0), f.stage_label,
         -- What a partner needs to decide on the appeal (U-123-2).
         concat_ws(' &middot; ',
           CASE WHEN f.order_date IS NOT NULL OR f.order_number IS NOT NULL
                THEN 'order' || CASE WHEN nullif(f.order_number, '') IS NOT NULL THEN ' ' || public.html_escape(f.order_number) ELSE '' END
                     || coalesce(' of ' || public.fmt_ist_date(f.order_date), '') END,
           CASE WHEN md.deadline_type LIKE 'appeal_s107%'
                THEN 'pre-deposit 10% of the tax in dispute (s.107(6))' END,
           CASE WHEN f.matter_id IS NOT NULL
                THEN '<a href="' || v_base || '/litigation/' || f.matter_id || '">open the matter</a>' END)
    FROM public.matter_deadlines md
    JOIN public.notice_facts f ON f.id = md.notice_id
    JOIN public.notice_alert_staff() s
      ON s.user_id = f.assign_to_user_id
      OR (s.is_manager AND NOT EXISTS (SELECT 1 FROM public.notice_alert_staff() o WHERE o.user_id = f.assign_to_user_id))
   WHERE coalesce(v_e5.is_active, false)
     AND md.deadline_type IN ('appeal_s107', 'appeal_s107_condonation', 'appeal_s112', 'appeal_s112_condonation', 'attachment_expiry')
     AND NOT md.is_met
     AND (md.deadline_date - v_today) IN (0, 1, 7, 30);

  FOR v_d IN
    SELECT d.to_user, d.to_name, d.to_email,
           string_agg(d.section_html, E'\n\n' ORDER BY d.sort_key) AS digest_html,
           string_agg(d.n || ' ' || d.short, ', ' ORDER BY d.sort_key) AS summary_line,
           bool_or(d.sort_key <= 2) AS critical
      FROM (
        SELECT x.to_user, x.to_name, x.to_email, x.sort_key, min(x.short) AS short, count(*) AS n,
               '<strong>' || x.section || ' (' || count(*) || ')</strong><br>'
               || string_agg('&bull; <a href="' || v_base || '/notices/' || x.notice_id || '">'
                               || public.html_escape(x.client_name) || ' &middot; '
                               || public.html_escape(coalesce(x.clock_label, x.label))
                               || CASE WHEN x.reference_number IS NOT NULL
                                       THEN ' ' || public.html_escape(x.reference_number) ELSE '' END
                               || '</a> &middot; ' || public.fmt_ist_date(x.on_date)
                               || CASE WHEN x.sort_key = 1 THEN ' &middot; <strong>' || (v_today - x.on_date)
                                                                || CASE WHEN v_today - x.on_date = 1 THEN ' day' ELSE ' days' END
                                                                || ' late</strong>'
                                       WHEN x.sort_key = 7 THEN ' &middot; ' || CASE x.on_date - v_today WHEN 0 THEN 'today'
                                                                                 WHEN 1 THEN 'tomorrow'
                                                                                 ELSE 'in ' || (x.on_date - v_today) || ' days' END
                                       ELSE '' END
                               || CASE WHEN coalesce(x.amount, 0) > 0 THEN ' &middot; ' || public.fmt_inr(x.amount) ELSE '' END
                               || CASE WHEN x.stage_label IS NOT NULL AND x.sort_key <> 7 THEN ' &middot; ' || public.html_escape(x.stage_label) ELSE '' END
                               || CASE WHEN nullif(x.order_facts, '') IS NOT NULL THEN '<br>&nbsp;&nbsp;' || x.order_facts ELSE '' END
                               || CASE WHEN x.unowned THEN ' <em>(no owner)</em>' ELSE '' END,
                             '<br>' ORDER BY x.on_date, x.client_name) AS section_html
          FROM _digest_items x
         GROUP BY x.to_user, x.to_name, x.to_email, x.sort_key, x.section
      ) d
     GROUP BY d.to_user, d.to_name, d.to_email
  LOOP
    v_vars := jsonb_build_object(
      'report_date', public.fmt_ist_date(v_today), 'summary_line', v_d.summary_line,
      'notice_type', 'Morning reminders', 'digest_html', v_d.digest_html,
      'link_html', '<a href="' || v_base || '/notices-queue">Open my work queue</a>');
    IF public.notice_alert_enqueue('E3_due_in_7', v_d.to_email, v_d.to_name, v_d.to_user, v_vars,
         'D:' || v_today || ':' || v_d.to_email, NULL, NULL, NULL, v_d.critical) THEN
      v_queued := v_queued + 1;
    END IF;
  END LOOP;

  -- E2: firm-wide overdue list for the managers, by owner, most overdue first.
  IF coalesce(v_e2.is_active, false) THEN
    SELECT count(*) INTO v_count FROM public.notice_facts WHERE is_overdue;
    IF v_count > 0 THEN
      WITH top AS (
        SELECT f.id, f.client_name, coalesce(f.form_code, f.form_label, f.notice_type, 'Notice') AS label,
               f.reference_number, f.effective_due, v_today - f.effective_due AS late, f.exposure_amount,
               coalesce(f.assign_to, 'No owner') AS owner, f.assign_to IS NULL AS no_owner
          FROM public.notice_facts f
         WHERE f.is_overdue
         ORDER BY v_today - f.effective_due DESC, f.client_name
         LIMIT 60
      ), by_owner AS (
        SELECT t.owner, bool_or(t.no_owner) AS no_owner, max(t.late) AS worst,
               '<strong>' || public.html_escape(t.owner) || ' (' || count(*) || ')</strong><br>'
               || string_agg('&bull; <a href="' || v_base || '/notices/' || t.id || '">'
                               || public.html_escape(t.client_name) || ' &middot; ' || public.html_escape(t.label)
                               || CASE WHEN t.reference_number IS NOT NULL THEN ' ' || public.html_escape(t.reference_number) ELSE '' END || '</a> &middot; '
                               || t.late || CASE WHEN t.late = 1 THEN ' day' ELSE ' days' END || ' overdue (due '
                               || public.fmt_ist_date(t.effective_due) || ')'
                               || CASE WHEN coalesce(t.exposure_amount, 0) > 0 THEN ' &middot; ' || public.fmt_inr(t.exposure_amount) ELSE '' END,
                             '<br>' ORDER BY t.client_name, t.late DESC) AS html,
               string_agg('• ' || t.client_name || ' — ' || t.label || ' — ' || coalesce(t.reference_number, 'no reference')
                            || ' (' || t.late || ' days overdue, ' || t.owner || ')',
                          E'\n' ORDER BY t.client_name, t.late DESC) AS lines
          FROM top t
         GROUP BY t.owner
      )
      SELECT string_agg(b.html, '<br><br>' ORDER BY b.no_owner DESC, b.worst DESC, b.owner),
             string_agg(b.lines, E'\n' ORDER BY b.no_owner DESC, b.worst DESC, b.owner)
        INTO v_html, v_lines
        FROM by_owner b;
      v_vars := jsonb_build_object('overdue_count', v_count, 'notice_type', 'Overdue notices',
                  'report_date', public.fmt_ist_date(v_today),
                  'digest_html', v_html || CASE WHEN v_count > 60
                                                THEN '<br><br>&hellip; and ' || (v_count - 60) || ' more, in the full list.' ELSE '' END,
                  'notice_list', v_lines || CASE WHEN v_count > 60 THEN E'\n… and ' || (v_count - 60) || ' more' ELSE '' END,
                  'link_html', '<a href="' || v_base || '/notices-all?filter=overdue">Open the overdue list</a>');
      FOR v_r IN SELECT * FROM public.notice_alert_recipients('partner', NULL) LOOP
        IF public.notice_alert_enqueue('E2_overdue_digest', v_r.email, v_r.name, v_r.user_id, v_vars,
             'E2:' || v_today || ':' || v_r.email) THEN
          v_queued := v_queued + 1;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- E11: open notices nobody owns 48 hours after the sync found them.
  IF coalesce(v_e11.is_active, false) THEN
    SELECT count(*) INTO v_count FROM public.notice_facts
     WHERE is_unassigned AND first_seen_at < now() - interval '48 hours';
    IF v_count > 0 THEN
      SELECT string_agg('&bull; <a href="' || v_base || '/notices/' || f.id || '">'
                          || public.html_escape(f.client_name) || ' &middot; '
                          || public.html_escape(coalesce(f.form_code, f.form_label, f.notice_type, 'Notice'))
                          || CASE WHEN f.reference_number IS NOT NULL THEN ' ' || public.html_escape(f.reference_number) ELSE '' END || '</a>'
                          || CASE WHEN f.effective_due IS NOT NULL
                                  THEN ' &middot; ' || public.notice_due_words(f.effective_due, f.reply_date) ELSE '' END,
                        '<br>' ORDER BY f.effective_due NULLS LAST, f.client_name),
             string_agg('• ' || f.client_name || ' — ' || coalesce(f.form_label, f.notice_type, 'Notice') || ' — '
                          || coalesce(f.reference_number, 'no reference')
                          || CASE WHEN f.effective_due IS NOT NULL THEN ' (due ' || public.fmt_ist_date(f.effective_due) || ')' ELSE '' END,
                        E'\n' ORDER BY f.effective_due NULLS LAST, f.client_name)
        INTO v_html, v_lines
        FROM (SELECT * FROM public.notice_facts
               WHERE is_unassigned AND first_seen_at < now() - interval '48 hours'
               ORDER BY effective_due NULLS LAST, client_name LIMIT 60) f;
      v_vars := jsonb_build_object('unassigned_count', v_count, 'notice_type', 'Notices without an owner',
                  'digest_html', v_html || CASE WHEN v_count > 60
                                                THEN '<br><br>&hellip; and ' || (v_count - 60) || ' more, in the full list.' ELSE '' END,
                  'notice_list', v_lines || CASE WHEN v_count > 60 THEN E'\n… and ' || (v_count - 60) || ' more' ELSE '' END,
                  'link_html', '<a href="' || v_base || '/notices-all?filter=unassigned">Assign them</a>');
      FOR v_r IN SELECT * FROM public.notice_alert_recipients('partner', NULL) LOOP
        IF public.notice_alert_enqueue('E11_unassigned', v_r.email, v_r.name, v_r.user_id, v_vars,
             'E11:' || v_today || ':' || v_r.email) THEN
          v_queued := v_queued + 1;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('queued', v_queued, 'date', v_today);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notice_alerts_daily() FROM PUBLIC, anon, authenticated;

-- ── Templates: one sentence, no repeated facts, no double signature ────────
UPDATE public.email_templates SET body = $t$A new {{notice_type}} for {{client_name}} was captured from the GST portal.

{{description}}

{{link_html}}$t$
 WHERE key = 'notice_new' AND body = $t$A new {{notice_type}} has been captured from the GST portal.

Client: {{client_name}}
GSTIN: {{gstin}}
Reference: {{reference_number}}
Issued: {{issue_date}}
Due Date: {{due_date}}
Description: {{description}}

{{link_html}}$t$;
UPDATE public.email_templates SET subject = $t${{notice_type}} assigned to you · {{client_name}}$t$
 WHERE key = 'notice_assigned' AND subject = $t${{notice_type}} assigned to you -- {{client_name}}$t$;
UPDATE public.email_templates SET body = $t${{client_name}}'s {{notice_type}} is now yours.

{{description}}

{{link_html}}$t$
 WHERE key = 'notice_assigned' AND body = $t$A notice has been assigned to you.

Client: {{client_name}}
GSTIN: {{gstin}}
Type: {{notice_type}}
Reference: {{reference_number}}
Due Date: {{due_date}}
Priority: {{priority}}

{{link_html}}$t$;
UPDATE public.email_templates SET subject = $t${{update_label}} · {{client_name}} ({{notice_type}})$t$
 WHERE key = 'notice_portal_update' AND subject = $t${{update_label}} -- {{client_name}} ({{notice_type}})$t$;
UPDATE public.email_templates SET body = $t$The GST portal shows a new {{update_label_lower}} on this case. {{item_reference}}

{{link_html}}$t$
 WHERE key = 'notice_portal_update' AND body = $t$The GST portal shows a new {{update_label_lower}} on a case you own.

Client: {{client_name}}
GSTIN: {{gstin}}
Case: {{case_id}}
Item: {{item_reference}}

{{link_html}}$t$;
UPDATE public.email_templates SET subject = $t$Stage changed: {{new_status}} · {{client_name}} ({{notice_type}})$t$
 WHERE key = 'notice_status' AND subject = $t$Notice status updated: {{new_status}} -- {{client_name}} ({{notice_type}})$t$;
UPDATE public.email_templates SET body = $t${{actor_name}} moved this notice from {{old_status}} to {{new_status}}.

{{link_html}}$t$
 WHERE key = 'notice_status' AND body = $t$A notice status has been updated.

Client: {{client_name}}
GSTIN: {{gstin}}
Type: {{notice_type}}
Old Status: {{old_status}}
New Status: {{new_status}}
Updated By: {{actor_name}}

-- {{firm_name}}$t$;
UPDATE public.email_templates SET subject = $t$Reply logged for {{notice_type}} · {{client_name}}$t$
 WHERE key = 'notice_reply' AND subject = $t$Reply logged for {{notice_type}} -- {{client_name}}$t$;
UPDATE public.email_templates SET body = $t${{actor_name}} logged reply {{reply_ref_number}}, filed on {{reply_date}}.

{{link_html}}$t$
 WHERE key = 'notice_reply' AND body = $t$A reply has been logged for a notice.

Client: {{client_name}}
GSTIN: {{gstin}}
Type: {{notice_type}}
Reply Ref: {{reply_ref_number}}
Reply Date: {{reply_date}}
Logged By: {{actor_name}}

-- {{firm_name}}$t$;
UPDATE public.email_templates SET subject = $t${{overdue_count}} overdue notices · {{report_date}}$t$
 WHERE key = 'notice_overdue_digest' AND subject = $t${{overdue_count}} overdue notices -- Daily Digest$t$;
UPDATE public.email_templates SET body = $t$Open notices past their reply date with no reply logged, by owner, most overdue first.

{{digest_html}}

{{link_html}}$t$
 WHERE key = 'notice_overdue_digest' AND body = $t$The following notices are past their due date with no reply logged:

{{notice_list}}

Please prioritise these for immediate action.

-- {{firm_name}}$t$;
UPDATE public.email_templates SET body = $t$Here is what needs you today, {{report_date}}.

{{digest_html}}

{{link_html}}$t$
 WHERE key = 'notice_daily_digest' AND body = $t$Here are the notices that need you today ({{report_date}}).

{{digest_html}}

{{link_html}}$t$;
UPDATE public.email_templates SET subject = $t${{unassigned_count}} notices without an owner for 48 hours$t$
 WHERE key = 'notice_unassigned' AND subject = $t${{unassigned_count}} notices unassigned for 48+ hours$t$;
UPDATE public.email_templates SET body = $t$Open notices nobody owns, 48 hours or more after the sync found them.

{{digest_html}}

{{link_html}}$t$
 WHERE key = 'notice_unassigned' AND body = $t$The following notices have no assigned owner and have been open for more than 48 hours:

{{notice_list}}

Please assign these to a team member.

-- {{firm_name}}$t$;
UPDATE public.email_templates SET subject = $t$Weekly notices summary · {{report_date}}$t$
 WHERE key = 'notice_weekly_mis' AND subject = $t$Weekly Notices MIS -- {{report_date}}$t$;
UPDATE public.email_templates SET body = $t${{mis_content}}

{{link_html}}$t$
 WHERE key = 'notice_weekly_mis' AND body = $t$Weekly Notices Management Information Summary

{{mis_content}}

-- {{firm_name}}$t$;
UPDATE public.email_templates SET subject = $t$Portal sync needs a look · {{client_name}}$t$
 WHERE key = 'notice_sync_anomaly' AND subject = $t$Sync anomaly detected for {{client_name}}$t$;
UPDATE public.email_templates SET body = $t$The portal sync for {{client_name}} needs a look: {{anomaly_description}}

{{link_html}}$t$
 WHERE key = 'notice_sync_anomaly' AND body = $t$The sync process detected an unusual pattern.

Client: {{client_name}}
GSTIN: {{gstin}}
Anomaly: {{anomaly_description}}

Please investigate.

-- {{firm_name}}$t$;
UPDATE public.email_templates SET subject = $t$Documents needed · {{notice_type}} ({{reference_number}})$t$
 WHERE key = 'notice_client_docs' AND subject = $t$Documents Required -- {{notice_type}} ({{reference_number}})$t$;
UPDATE public.email_templates SET body = $t$We are handling a {{notice_type}} (ref. {{reference_number}}) for {{client_name}} (GSTIN {{gstin}}). To prepare the reply we need:

{{document_list}}

Please reply to this e-mail with the documents at your earliest convenience.$t$
 WHERE key = 'notice_client_docs' AND body = $t$Dear {{contact_person}},

We are handling a {{notice_type}} (Ref: {{reference_number}}) for {{client_name}} (GSTIN: {{gstin}}).

We require the following documents:
{{document_list}}

Please share these at your earliest convenience.

Regards,
{{staff_name}}
{{firm_name}}
{{firm_email}}$t$;
UPDATE public.email_templates SET subject = $t$Update · {{notice_type}} ({{reference_number}})$t$
 WHERE key = 'notice_client_update' AND subject = $t$Status Update -- {{notice_type}} ({{reference_number}})$t$;
UPDATE public.email_templates SET body = $t$Here is an update on the {{notice_type}} (ref. {{reference_number}}) for {{client_name}} (GSTIN {{gstin}}).

Current status: {{staff_status}}
Next step: {{next_step}}

We will keep you informed of any developments.$t$
 WHERE key = 'notice_client_update' AND body = $t$Dear {{contact_person}},

Here is an update on the {{notice_type}} (Ref: {{reference_number}}) for {{client_name}} (GSTIN: {{gstin}}).

Current Status: {{staff_status}}
Next Step: {{next_step}}

We will keep you informed of any developments.

Regards,
{{staff_name}}
{{firm_name}}
{{firm_email}}$t$;
UPDATE public.email_templates SET subject = $t${{notice_type}} due in {{days_remaining}} days · {{client_name}}$t$
 WHERE key = 'notice_due_soon' AND subject = $t${{notice_type}} due in {{days_remaining}} days -- {{client_name}}$t$;
UPDATE public.email_templates SET body = $t${{client_name}}'s {{notice_type}} is {{due_words}}.

{{link_html}}$t$
 WHERE key = 'notice_due_soon' AND body = $t$A notice is approaching its due date.

Client: {{client_name}}
GSTIN: {{gstin}}
Type: {{notice_type}}
Reference: {{reference_number}}
Due Date: {{due_date}}
Days Remaining: {{days_remaining}}

Please ensure a reply is filed before the deadline.

-- {{firm_name}}$t$;
UPDATE public.email_templates SET subject = $t$Hearing on {{hearing_date}} · {{client_name}} ({{notice_type}})$t$
 WHERE key = 'notice_hearing' AND subject = $t$Hearing on {{hearing_date}} -- {{client_name}} ({{notice_type}})$t$;
UPDATE public.email_templates SET body = $t$A personal hearing is fixed for {{hearing_date}}.

{{link_html}}$t$
 WHERE key = 'notice_hearing' AND body = $t$A hearing is scheduled.

Client: {{client_name}}
GSTIN: {{gstin}}
Type: {{notice_type}}
Hearing Date: {{hearing_date}}
Officer: {{issued_by}}

Please prepare the required documents.

-- {{firm_name}}$t$;
UPDATE public.email_templates SET subject = $t${{deadline_type}} deadline in {{days_remaining}} days · {{client_name}}$t$
 WHERE key = 'notice_limitation' AND subject = $t${{deadline_type}} deadline in {{days_remaining}} days -- {{client_name}}$t$;
UPDATE public.email_templates SET body = $t${{deadline_type}}: file by {{deadline_date}} ({{statutory_basis}}).

{{link_html}}$t$
 WHERE key = 'notice_limitation' AND body = $t$A statutory limitation period is approaching.

Client: {{client_name}}
GSTIN: {{gstin}}
Deadline Type: {{deadline_type}}
Deadline Date: {{deadline_date}}
Statutory Basis: {{statutory_basis}}
Days Remaining: {{days_remaining}}

Action is required before this date to preserve rights.

-- {{firm_name}}$t$;

-- ── Calendar: open matters' hearings too (replaces the 122000 version) ────
-- A matter hearing has no notice: notice_id is NULL and detail is 'matter:<id>'.
CREATE OR REPLACE FUNCTION public.notice_calendar(p_from date, p_to date)
RETURNS TABLE (day date, kind text, notice_id uuid, client_id uuid, client_name text, form_code text,
               reference text, title text, stage text, owner_id uuid, owner text, detail text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH f AS MATERIALIZED (SELECT * FROM public.notice_facts WHERE is_open)
  SELECT f.effective_due, 'reply', f.id, f.client_id, f.client_name, f.form_code,
         coalesce(f.reference_number, f.case_id), coalesce(f.form_label, f.notice_type), f.stage,
         f.assign_to_user_id, f.assign_to, f.due_basis
    FROM f
   WHERE NOT f.is_replied AND f.effective_due BETWEEN p_from AND p_to
  UNION ALL
  SELECT f.hearing_date, 'hearing', f.id, f.client_id, f.client_name, f.form_code,
         coalesce(f.reference_number, f.case_id), coalesce(f.form_label, f.notice_type), f.stage,
         f.assign_to_user_id, f.assign_to, NULL
    FROM f
   WHERE f.hearing_date BETWEEN p_from AND p_to
  UNION ALL
  SELECT d.deadline_date,
         CASE WHEN d.deadline_type = 'attachment_expiry' THEN 'attachment' ELSE 'appeal' END,
         f.id, f.client_id, f.client_name, f.form_code,
         coalesce(f.reference_number, f.case_id), coalesce(f.form_label, f.notice_type), f.stage,
         f.assign_to_user_id, f.assign_to, d.deadline_type
    FROM public.matter_deadlines d
    JOIN f ON f.id = d.notice_id
   WHERE NOT d.is_met AND d.deadline_date BETWEEN p_from AND p_to
     AND d.deadline_type NOT IN ('reply_due', 'hearing')
  UNION ALL
  SELECT (h.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date, 'hearing', NULL, m.client_id, c.name, NULL,
         m.matter_no, coalesce(m.title, 'Matter ' || m.matter_no), m.stage,
         m.owner_user_id, NULL, 'matter:' || m.id
    FROM public.matter_hearings h
    JOIN public.litigation_matters m ON m.id = h.matter_id
    JOIN public.clients c ON c.id = m.client_id
   WHERE m.status <> 'Closed'
     AND (h.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
$$;
GRANT EXECUTE ON FUNCTION public.notice_calendar(date, date) TO anon, authenticated, service_role;

-- A matter reopened from Closed loses the earlier closure's reason.
CREATE OR REPLACE FUNCTION public.litigation_matters_stage_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.stage := coalesce(public.notice_stage_key(NEW.stage), NEW.stage, 'new');
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Closed' AND NEW.stage IN ('new', 'triaged') THEN NEW.stage := 'closed'; END IF;
  ELSIF NEW.stage IS NOT DISTINCT FROM OLD.stage AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'Closed' AND NEW.stage <> 'closed' THEN NEW.stage := 'closed';
    ELSIF NEW.status <> 'Closed' AND NEW.stage = 'closed' THEN NEW.stage := 'triaged';
    END IF;
  END IF;
  IF NEW.stage = 'closed' THEN
    NEW.status := 'Closed';
    NEW.closed_at := coalesce(NEW.closed_at, now());
  ELSE
    IF NEW.status = 'Closed' THEN NEW.status := 'Open'; END IF;
    NEW.closed_at := NULL;
    IF TG_OP = 'UPDATE' AND OLD.stage = 'closed' AND NEW.closed_reason IS NOT DISTINCT FROM OLD.closed_reason THEN
      NEW.closed_reason := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
