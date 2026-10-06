-- Notices Phase 1 · alerts that fire
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: roadmap Phase 1 task 4; findings L-16, L-42, S-05).
--
-- Before: two copies of the alert logic (browser and an undeployed edge
-- function), no schedule, a duplicate check that raced, digests that ignored
-- replies, and new notices nobody owned. Now the engine lives in the database
-- and pg_cron runs it:
--   every 15 minutes   events: E1 new notice (batched per client and recipient),
--                      E6 assigned, E7 status (template off by default), E8 reply
--                      logged (template off by default), E9 sync anomaly,
--                      E15 portal update on a case (order / notice / hearing)
--   09:30 IST daily    one morning list per owner (E3: due in 7/3/1/0 days and
--                      overdue, skipping replied; E4 hearings in 7/1/0 days; E5
--                      appeal and attachment clocks in 30/7/1/0 days); for
--                      managers also the firm-wide overdue list (E2) and notices
--                      without an owner after 48 hours (E11)
--   Monday 09:45 IST   weekly MIS to managers (E10)
-- Exactly once: every alert has a dedupe key with a UNIQUE index and is
-- inserted with ON CONFLICT DO NOTHING; the whole run is one transaction, so a
-- rerun sends nothing twice. Quiet hours (IST) hold back rules marked
-- quiet_hours until the window ends. New notices get an owner from the client
-- master (clients.assigned_accountant) when the name matches one staff member.
--
-- PREVIEW: notice_settings.alerts_mode starts at 'preview'. Alerts are written
-- to email_outbox with status 'preview' — visible in Reminders → Email outbox,
-- never sent. The firm switches to 'live' after reviewing a week of previews.

-- ── Settings ───────────────────────────────────────────────────────────────
ALTER TABLE public.notice_settings
  ADD COLUMN IF NOT EXISTS alerts_mode text NOT NULL DEFAULT 'preview',
  ADD COLUMN IF NOT EXISTS alerts_mode_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS quiet_start time NOT NULL DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS quiet_end time NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS new_notice_max_age_days int NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS app_base_url text NOT NULL DEFAULT 'https://gst.vjdesai.com';
ALTER TABLE public.notice_settings DROP CONSTRAINT IF EXISTS notice_settings_alerts_mode_check;
ALTER TABLE public.notice_settings ADD CONSTRAINT notice_settings_alerts_mode_check
  CHECK (alerts_mode IN ('off', 'preview', 'live'));
COMMENT ON COLUMN public.notice_settings.alerts_mode IS
  'off: no alerts; preview: alerts are written to email_outbox with status preview and never sent; live: queued for sending.';
COMMENT ON COLUMN public.notice_settings.new_notice_max_age_days IS
  'A notice captured more than this many days after its issue date (a first sync of a client''s history) gets no new-notice alert unless it is still open with a future due date.';

-- ── Outbox: preview status and exactly-once keys ───────────────────────────
ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_status_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled', 'preview'));

-- The browser-side queue gave every recipient of one alert the same key; keep
-- those historic rows but make their keys distinct before the unique index.
UPDATE public.email_outbox o
   SET dedupe_key = o.dedupe_key || ':dup:' || o.id
 WHERE o.dedupe_key IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.email_outbox o2
                WHERE o2.dedupe_key = o.dedupe_key
                  AND (o2.created_at, o2.id) < (o.created_at, o.id));
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_outbox_dedupe_key
  ON public.email_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
DROP INDEX IF EXISTS public.idx_email_outbox_dedupe;

ALTER TABLE public.sync_run_items ADD COLUMN IF NOT EXISTS alert_processed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_sync_run_items_unalerted
  ON public.sync_run_items (created_at) WHERE alert_processed_at IS NULL AND status <> 'ok';

-- ── Rules and templates ────────────────────────────────────────────────────
-- Seeded rows are adjusted only where they still hold their original values,
-- so a rule or template the firm has edited is left alone.
UPDATE public.notice_alert_rules SET recipient = 'assignee',
       description = 'Immediate alert to the notice owner (managers when nobody owns it) when a sync captures a new notice; several new notices for one client arrive as one e-mail'
 WHERE alert_key = 'E1_new_notice' AND recipient = 'team';
UPDATE public.notice_alert_rules SET event_type = 'status_changed,closed,reopened'
 WHERE alert_key = 'E7_status_changed' AND event_type = 'status_changed';
UPDATE public.notice_alert_rules SET name = 'Morning reminders (per owner)', template_key = 'notice_daily_digest',
       description = 'One morning e-mail per owner: replies due in 7, 3, 1 and 0 days and every day while overdue (replied notices skipped), with hearings (E4) and appeal / attachment clocks (E5)'
 WHERE alert_key = 'E3_due_in_7' AND template_key = 'notice_due_soon';
UPDATE public.notice_alert_rules SET description = 'Managers: every open, unreplied notice past its due date, firm-wide'
 WHERE alert_key = 'E2_overdue_digest' AND description = 'Morning digest of all overdue notices';
UPDATE public.notice_alert_rules SET description = 'Section of the morning reminders: hearings in 7, 1 and 0 days'
 WHERE alert_key = 'E4_hearing_reminder' AND description = 'Reminder 7 days and 1 day before a hearing';
UPDATE public.notice_alert_rules SET description = 'Section of the morning reminders: appeal (s.107 / s.112), condonation and DRC-22 attachment clocks in 30, 7, 1 and 0 days'
 WHERE alert_key = 'E5_limitation_alert' AND description = 'Appeal/tribunal deadline approaching (T-30, T-7)';

INSERT INTO public.email_templates (key, kind, name, step, subject, body, sort_order, is_active) VALUES
  ('notice_new_batch', 'notice_alert', 'New Notices Captured (several)', NULL,
   '{{notice_count}} new notices for {{client_name}} ({{gstin}})',
   E'{{notice_count}} new notices for {{client_name}} were captured from the GST portal:\n\n{{notice_list_html}}\n\n{{link_html}}',
   113, true),
  ('notice_daily_digest', 'notice_alert', 'Morning Reminders', NULL,
   'Notices for {{report_date}}: {{summary_line}}',
   E'Here are the notices that need you today ({{report_date}}).\n\n{{digest_html}}\n\n{{link_html}}',
   114, true),
  ('notice_portal_update', 'notice_alert', 'Portal Update on a Case', NULL,
   '{{update_label}} -- {{client_name}} ({{notice_type}})',
   E'The GST portal shows a new {{update_label_lower}} on a case you own.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nCase: {{case_id}}\nItem: {{item_reference}}\n\n{{link_html}}',
   115, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.notice_alert_rules (alert_key, name, description, event_type, schedule, template_key, recipient, priority, quiet_hours, max_repeats, cooldown_hrs)
VALUES ('E15_portal_update', 'Portal update on a case', 'Owner alert when the case folder on the portal shows a new order, notice or hearing',
        'order_received,notice_issued,hearing_fixed', NULL, 'notice_portal_update', 'assignee', 'normal', true, NULL, NULL)
ON CONFLICT (alert_key) DO NOTHING;

-- Deep link instead of the double signature on the two seeded alerts staff get most.
UPDATE public.email_templates
   SET body = E'A new {{notice_type}} has been captured from the GST portal.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nReference: {{reference_number}}\nIssued: {{issue_date}}\nDue Date: {{due_date}}\nDescription: {{description}}\n\n{{link_html}}'
 WHERE key = 'notice_new'
   AND body = E'A new {{notice_type}} has been captured from the GST portal.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nReference: {{reference_number}}\nIssued: {{issue_date}}\nDue Date: {{due_date}}\nDescription: {{description}}\n\nPlease review and take action.\n\n-- {{firm_name}}';
UPDATE public.email_templates
   SET body = E'A notice has been assigned to you.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nReference: {{reference_number}}\nDue Date: {{due_date}}\nPriority: {{priority}}\n\n{{link_html}}'
 WHERE key = 'notice_assigned'
   AND body = E'A notice has been assigned to you.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nReference: {{reference_number}}\nDue Date: {{due_date}}\nPriority: {{priority}}\n\nPlease review and update the status.\n\n-- {{firm_name}}';

-- ── Helpers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.html_escape(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- {{name}} placeholders; a missing variable renders empty.
CREATE OR REPLACE FUNCTION public.render_template(p_text text, p_vars jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_out text := coalesce(p_text, '');
  m text[];
BEGIN
  FOR m IN SELECT DISTINCT regexp_matches(coalesce(p_text, ''), '\{\{(\w+)\}\}', 'g') LOOP
    v_out := replace(v_out, '{{' || m[1] || '}}', coalesce(p_vars ->> m[1], ''));
  END LOOP;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.fmt_ist_date(p date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN p IS NULL THEN '' ELSE to_char(p, 'DD Mon YYYY') END $$;

-- Staff who can receive alerts: a non-client role and an e-mail address.
CREATE OR REPLACE FUNCTION public.notice_alert_staff()
RETURNS TABLE (user_id uuid, name text, email text, is_manager boolean)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id,
         coalesce(nullif(btrim(p.first_name), ''), split_part(btrim(p.email), '@', 1)),
         lower(btrim(p.email)),
         bool_or(r.role::text IN ('superadmin', 'gst_manager'))
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.user_id AND r.role::text <> 'client'
   WHERE coalesce(btrim(p.email), '') <> ''
   GROUP BY p.user_id, p.first_name, p.email
$$;

-- assignee: the owner, or the managers when nobody (reachable) owns it;
-- partner: the managers; team: every staff member.
CREATE OR REPLACE FUNCTION public.notice_alert_recipients(p_recipient text, p_owner uuid)
RETURNS TABLE (user_id uuid, name text, email text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH staff AS (SELECT * FROM public.notice_alert_staff()),
  owner AS (SELECT s.* FROM staff s WHERE s.user_id = p_owner)
  SELECT o.user_id, o.name, o.email FROM owner o WHERE p_recipient = 'assignee'
  UNION
  SELECT s.user_id, s.name, s.email FROM staff s
   WHERE s.is_manager
     AND (p_recipient = 'partner' OR (p_recipient = 'assignee' AND NOT EXISTS (SELECT 1 FROM owner)))
  UNION
  SELECT s.user_id, s.name, s.email FROM staff s WHERE p_recipient = 'team'
$$;

CREATE OR REPLACE FUNCTION public.notice_alerts_in_quiet_hours()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN s.quiet_start = s.quiet_end THEN false
           WHEN s.quiet_start < s.quiet_end
             THEN (now() AT TIME ZONE 'Asia/Kolkata')::time >= s.quiet_start
                  AND (now() AT TIME ZONE 'Asia/Kolkata')::time < s.quiet_end
           ELSE (now() AT TIME ZONE 'Asia/Kolkata')::time >= s.quiet_start
                OR (now() AT TIME ZONE 'Asia/Kolkata')::time < s.quiet_end
         END
    FROM public.notice_settings s WHERE s.id
$$;

-- Writes one alert to the outbox (status preview or pending), once per dedupe
-- key, and logs it. Variables are HTML-escaped for the body except *_html ones,
-- which the engine builds from escaped parts; the subject uses them unescaped.
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
  v_rule    record;
  v_tpl_key text;
  v_tpl     record;
  v_raw     jsonb;
  v_body    jsonb;
  v_id      uuid;
BEGIN
  SELECT s.alerts_mode INTO v_mode FROM public.notice_settings s WHERE s.id;
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

  v_raw := coalesce(p_vars, '{}'::jsonb) || jsonb_build_object(
             'contact_person', coalesce(p_to_name, ''),
             'staff_name', 'GST Keeper (automated alert)',
             'firm_name', 'V. J. Desai & Co. LLP',
             'firm_email', 'gst@vjdesai.com');
  SELECT jsonb_object_agg(k, CASE WHEN k LIKE '%\_html' THEN to_jsonb(v) ELSE to_jsonb(public.html_escape(v)) END)
    INTO v_body
    FROM jsonb_each_text(v_raw) AS e(k, v);
  v_body := v_body || jsonb_build_object('_shell', CASE WHEN p_critical THEN 'notice_alert_critical' ELSE 'notice_alert' END);

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

-- ── Auto-owner from the client master ──────────────────────────────────────
-- clients.assigned_accountant holds a name ("Riya", "Riya / 3"); it becomes
-- the owner when it matches exactly one staff member's first name (or the
-- first word of the name does).
CREATE OR REPLACE FUNCTION public.notice_owner_for_client(p_client_id uuid)
RETURNS TABLE (user_id uuid, name text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH acc AS (
    SELECT lower(btrim(regexp_replace(coalesce(c.assigned_accountant, ''), '\s*/\s*\d+\s*$', ''))) AS full_name
      FROM public.clients c WHERE c.id = p_client_id
  ), staff AS (
    SELECT p.user_id, btrim(p.first_name) AS first_name, lower(btrim(p.first_name)) AS fname
      FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.user_id AND r.role::text <> 'client'
     WHERE coalesce(btrim(p.first_name), '') <> ''
     GROUP BY p.user_id, p.first_name
  ), hit AS (
    SELECT DISTINCT s.user_id, s.first_name
      FROM staff s, acc
     WHERE acc.full_name <> '' AND (s.fname = acc.full_name OR s.fname = split_part(acc.full_name, ' ', 1))
  )
  SELECT h.user_id, h.first_name FROM hit h WHERE (SELECT count(*) FROM hit) = 1
$$;

CREATE OR REPLACE FUNCTION public.gst_notices_auto_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
BEGIN
  IF NEW.assign_to_user_id IS NULL AND coalesce(btrim(NEW.assign_to), '') = '' THEN
    SELECT * INTO v FROM public.notice_owner_for_client(NEW.client_id) LIMIT 1;
    IF v.user_id IS NOT NULL THEN
      NEW.assign_to_user_id := v.user_id;
      NEW.assign_to := v.name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_notices_auto_owner ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_auto_owner
  BEFORE INSERT ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_auto_owner();

-- For notices already on file: give every open, ownerless notice its client's
-- accountant (logged as "Auto-assign"). Run on request, not by the migration.
CREATE OR REPLACE FUNCTION public.notices_auto_assign_open()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_prev text := coalesce(current_setting('app.actor_name', true), '');
BEGIN
  PERFORM set_config('app.actor_name', 'Auto-assign', true);
  UPDATE public.gst_notices n
     SET assign_to_user_id = o.user_id, assign_to = o.name
    FROM (SELECT DISTINCT g.client_id FROM public.gst_notices g
           WHERE g.deleted_at IS NULL AND g.assign_to_user_id IS NULL) c
    CROSS JOIN LATERAL public.notice_owner_for_client(c.client_id) o
   WHERE n.client_id = c.client_id AND n.deleted_at IS NULL AND n.assign_to_user_id IS NULL
     AND coalesce(btrim(n.assign_to), '') = '' AND NOT public.notice_is_closed(n.staff_status);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.actor_name', v_prev, true);
  RETURN v_count;
END;
$$;

-- ── Events: E1, E6, E7, E8, E15 (every 15 minutes) and E9 ──────────────────
CREATE OR REPLACE FUNCTION public.notice_alerts_process_events(p_limit int DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiet    boolean := coalesce(public.notice_alerts_in_quiet_hours(), false);
  v_settings record;
  v_rule     record;
  v_ev       record;
  v_n        record;
  v_r        record;
  v_b        record;
  v_queued   int := 0;
  v_done     int := 0;
  v_deferred int := 0;
  v_defer    boolean;
  v_vars     jsonb;
  v_link     text;
BEGIN
  SELECT * INTO v_settings FROM public.notice_settings WHERE id;

  DROP TABLE IF EXISTS pg_temp._alert_events;
  CREATE TEMP TABLE _alert_events ON COMMIT DROP AS
    SELECT e.id, e.notice_id, e.client_id, e.event_type, e.old_value, e.new_value, e.actor_id, e.actor_name, e.created_at
      FROM public.notice_events e WHERE false;
  WITH locked AS (
    SELECT e.id FROM public.notice_events e
     WHERE e.alert_processed_at IS NULL
     ORDER BY e.created_at, e.id
     LIMIT p_limit
       FOR UPDATE SKIP LOCKED
  )
  INSERT INTO _alert_events
  SELECT e.id, e.notice_id, e.client_id, e.event_type, e.old_value, e.new_value, e.actor_id, e.actor_name, e.created_at
    FROM public.notice_events e JOIN locked l ON l.id = e.id;

  -- E1: new notices, one e-mail per client and recipient for this batch.
  SELECT * INTO v_rule FROM public.notice_alert_rules WHERE alert_key = 'E1_new_notice';
  IF v_rule.id IS NOT NULL AND v_rule.is_active AND (NOT v_quiet OR NOT v_rule.quiet_hours) THEN
    FOR v_b IN
      WITH cap AS (
        SELECT ev.id AS event_id, ev.actor_id, ev.created_at, f.*
          FROM _alert_events ev
          JOIN public.notice_facts f ON f.id = ev.notice_id
         WHERE ev.event_type = 'captured'
           AND (f.issue_date IS NULL
                OR f.issue_date >= (ev.created_at AT TIME ZONE 'Asia/Kolkata')::date - v_settings.new_notice_max_age_days
                OR (f.is_open AND f.effective_due >= public.ist_today()))
      ), routed AS (
        SELECT cap.*, rc.user_id AS to_user, rc.name AS to_name, rc.email AS to_email
          FROM cap
          CROSS JOIN LATERAL public.notice_alert_recipients(v_rule.recipient, cap.assign_to_user_id) rc
         WHERE rc.user_id IS DISTINCT FROM cap.actor_id
      )
      SELECT r.client_id, r.to_user, r.to_name, r.to_email,
             min(r.client_name) AS client_name, min(r.client_gstin) AS gstin,
             count(*) AS cnt,
             array_agg(r.event_id ORDER BY r.event_id) AS event_ids,
             (array_agg(r.id ORDER BY r.issue_date DESC NULLS LAST, r.id))[1] AS first_notice,
             bool_or(r.effective_priority = 'High') AS critical,
             string_agg('&bull; ' || public.html_escape(coalesce(r.form_label, r.notice_type, 'Notice'))
                          || ' &mdash; ' || public.html_escape(coalesce(r.reference_number, 'no reference'))
                          || CASE WHEN r.effective_due IS NOT NULL
                                  THEN ' &mdash; due ' || public.fmt_ist_date(r.effective_due) ELSE '' END,
                        '<br>' ORDER BY r.effective_due NULLS LAST, r.issue_date DESC NULLS LAST) AS list_html
        FROM routed r
       GROUP BY r.client_id, r.to_user, r.to_name, r.to_email
    LOOP
      IF v_b.cnt = 1 THEN
        SELECT * INTO v_n FROM public.notice_facts WHERE id = v_b.first_notice;
        v_link := v_settings.app_base_url || '/notices-all?noticeId=' || v_n.id;
        v_vars := jsonb_build_object(
          'notice_type', coalesce(v_n.form_label, v_n.notice_type, 'Notice'), 'client_name', v_n.client_name,
          'gstin', v_n.client_gstin, 'reference_number', coalesce(v_n.reference_number, ''),
          'issue_date', public.fmt_ist_date(v_n.issue_date), 'due_date', public.fmt_ist_date(v_n.effective_due),
          'description', coalesce(v_n.description, ''), 'priority', coalesce(v_n.effective_priority, ''),
          'link_html', '<a href="' || v_link || '">Open this notice in GST Keeper</a>');
        IF public.notice_alert_enqueue('E1_new_notice', v_b.to_email, v_b.to_name, v_b.to_user, v_vars,
             'E1:' || md5(array_to_string(v_b.event_ids, ',')) || ':' || v_b.to_email,
             v_n.id, v_b.client_id, v_b.event_ids[1], v_b.critical) THEN
          v_queued := v_queued + 1;
        END IF;
      ELSE
        v_link := v_settings.app_base_url || '/notices-all?client=' || v_b.client_id || '&filter=new';
        v_vars := jsonb_build_object(
          'notice_count', v_b.cnt, 'client_name', v_b.client_name, 'gstin', v_b.gstin,
          'notice_type', v_b.cnt || ' new notices', 'notice_list_html', v_b.list_html,
          'link_html', '<a href="' || v_link || '">Open these notices in GST Keeper</a>');
        -- Several notices for one client go out as one e-mail, logged against E1.
        IF public.notice_alert_enqueue('E1_new_notice', v_b.to_email, v_b.to_name, v_b.to_user, v_vars,
             'E1:' || md5(array_to_string(v_b.event_ids, ',')) || ':' || v_b.to_email,
             v_b.first_notice, v_b.client_id, v_b.event_ids[1], v_b.critical, 'notice_new_batch') THEN
          v_queued := v_queued + 1;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- One-to-one event rules (E6, E7, E8, E15): for each event and each active rule listening for it.
  FOR v_ev IN SELECT * FROM _alert_events ORDER BY created_at, id LOOP
    v_defer := false;
    FOR v_rule IN
      SELECT * FROM public.notice_alert_rules r
       WHERE r.is_active AND r.alert_key <> 'E1_new_notice' AND r.event_type IS NOT NULL
         AND v_ev.event_type = ANY (string_to_array(replace(r.event_type, ' ', ''), ','))
    LOOP
      IF v_quiet AND v_rule.quiet_hours THEN v_defer := true; CONTINUE; END IF;
      -- An owner removed is not an assignment to tell anyone about.
      CONTINUE WHEN v_ev.event_type = 'assigned' AND (v_ev.new_value ->> 'assign_to_user_id') IS NULL;
      SELECT * INTO v_n FROM public.notice_facts WHERE id = v_ev.notice_id;
      CONTINUE WHEN v_n.id IS NULL;
      v_link := v_settings.app_base_url || '/notices-all?noticeId=' || v_n.id;
      v_vars := jsonb_build_object(
        'notice_type', coalesce(v_n.form_label, v_n.notice_type, 'Notice'), 'client_name', v_n.client_name,
        'gstin', v_n.client_gstin, 'reference_number', coalesce(v_n.reference_number, ''),
        'issue_date', public.fmt_ist_date(v_n.issue_date), 'due_date', public.fmt_ist_date(v_n.effective_due),
        'days_remaining', coalesce(v_n.days_to_due::text, ''), 'priority', coalesce(v_n.effective_priority, ''),
        'hearing_date', public.fmt_ist_date(v_n.hearing_date), 'issued_by', coalesce(v_n.issued_by, ''),
        'old_status', coalesce(v_ev.old_value ->> 'staff_status', ''),
        'new_status', coalesce(v_ev.new_value ->> 'staff_status', v_n.staff_status, ''),
        'reply_date', public.fmt_ist_date(v_n.reply_date), 'reply_ref_number', coalesce(v_n.reply_ref_number, ''),
        'actor_name', coalesce(v_ev.actor_name, ''), 'case_id', coalesce(v_n.case_id, ''),
        'item_reference', coalesce(v_ev.new_value ->> 'reference_number', ''),
        'update_label', CASE v_ev.event_type WHEN 'order_received' THEN 'Order on the portal'
                                             WHEN 'notice_issued' THEN 'Notice on the portal'
                                             WHEN 'hearing_fixed' THEN 'Hearing fixed'
                                             ELSE initcap(replace(v_ev.event_type, '_', ' ')) END,
        'update_label_lower', CASE v_ev.event_type WHEN 'order_received' THEN 'order'
                                                   WHEN 'notice_issued' THEN 'notice'
                                                   WHEN 'hearing_fixed' THEN 'hearing date'
                                                   ELSE replace(v_ev.event_type, '_', ' ') END,
        'link_html', '<a href="' || v_link || '">Open this notice in GST Keeper</a>');
      FOR v_r IN
        SELECT * FROM public.notice_alert_recipients(v_rule.recipient,
                 CASE WHEN v_ev.event_type = 'assigned' THEN (v_ev.new_value ->> 'assign_to_user_id')::uuid
                      ELSE v_n.assign_to_user_id END)
      LOOP
        CONTINUE WHEN v_r.user_id IS NOT DISTINCT FROM v_ev.actor_id;
        IF public.notice_alert_enqueue(v_rule.alert_key, v_r.email, v_r.name, v_r.user_id, v_vars,
             v_rule.alert_key || ':' || v_ev.id || ':' || v_r.email,
             v_n.id, v_n.client_id, v_ev.id, v_rule.priority = 'critical') THEN
          v_queued := v_queued + 1;
        END IF;
      END LOOP;
    END LOOP;
    IF v_defer THEN
      v_deferred := v_deferred + 1;
    ELSE
      UPDATE public.notice_events SET alert_processed_at = now() WHERE id = v_ev.id;
      v_done := v_done + 1;
    END IF;
  END LOOP;

  -- E9: sync runs that held back a removal, read the wrong GSTIN, failed to save or stalled.
  SELECT * INTO v_rule FROM public.notice_alert_rules WHERE alert_key = 'E9_sync_anomaly';
  IF v_rule.id IS NOT NULL AND v_rule.is_active AND (NOT v_quiet OR NOT v_rule.quiet_hours) THEN
    FOR v_ev IN
      SELECT i.*, c.name AS client_name, c.gstin
        FROM public.sync_run_items i JOIN public.clients c ON c.id = i.client_id
       WHERE i.alert_processed_at IS NULL AND i.status <> 'ok'
         AND (i.status = 'held' OR i.reason_class IN ('session_mismatch', 'save_failed', 'stalled'))
       ORDER BY i.created_at
       LIMIT 200
    LOOP
      v_vars := jsonb_build_object('client_name', v_ev.client_name, 'gstin', v_ev.gstin,
                  'notice_type', 'Sync ' || v_ev.step,
                  'anomaly_description', coalesce(v_ev.message, v_ev.reason_class, v_ev.status));
      FOR v_r IN SELECT * FROM public.notice_alert_recipients(v_rule.recipient, NULL) LOOP
        IF public.notice_alert_enqueue('E9_sync_anomaly', v_r.email, v_r.name, v_r.user_id, v_vars,
             'E9:' || v_ev.id || ':' || v_r.email, NULL, v_ev.client_id, NULL, true) THEN
          v_queued := v_queued + 1;
        END IF;
      END LOOP;
    END LOOP;
  END IF;
  UPDATE public.sync_run_items SET alert_processed_at = now()
   WHERE alert_processed_at IS NULL AND status <> 'ok'
     AND NOT (v_quiet AND EXISTS (SELECT 1 FROM public.notice_alert_rules r
                                   WHERE r.alert_key = 'E9_sync_anomaly' AND r.is_active AND r.quiet_hours));

  RETURN jsonb_build_object('queued', v_queued, 'events_processed', v_done, 'events_deferred', v_deferred,
                            'quiet_hours', v_quiet);
END;
$$;

-- ── Morning reminders (09:30 IST) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_alerts_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings record;
  v_today    date := public.ist_today();
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
  v_count    int;
BEGIN
  SELECT * INTO v_settings FROM public.notice_settings WHERE id;
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
         i.client_name, coalesce(i.form_label, i.notice_type, 'Notice') AS label, i.reference_number,
         i.on_date, i.unowned, NULL::text AS clock_label
    FROM items i;

  -- Appeal / condonation / attachment clocks run on after the notice is closed.
  INSERT INTO _digest_items
  SELECT s.user_id, s.name, s.email, 7, 'Appeal and attachment clocks', 'clock',
         f.id, f.client_id, f.client_name, coalesce(f.form_label, f.notice_type, 'Notice'), f.reference_number,
         md.deadline_date, s.user_id IS DISTINCT FROM f.assign_to_user_id,
         CASE md.deadline_type
           WHEN 'appeal_s107' THEN 'First appeal (s.107)'
           WHEN 'appeal_s107_condonation' THEN 'First appeal, outer limit with condonation'
           WHEN 'appeal_s112' THEN 'Tribunal appeal (s.112)'
           WHEN 'appeal_s112_condonation' THEN 'Tribunal appeal, outer limit with condonation'
           WHEN 'attachment_expiry' THEN 'Provisional attachment lapses'
           ELSE md.deadline_type END
         || CASE WHEN md.period_confirmed THEN '' ELSE ' (period not yet confirmed by the firm)' END
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
               || string_agg('&bull; ' || public.html_escape(x.client_name) || ' &mdash; '
                               || public.html_escape(coalesce(x.clock_label, x.label))
                               || CASE WHEN x.reference_number IS NOT NULL
                                       THEN ' ' || public.html_escape(x.reference_number) ELSE '' END
                               || ' &mdash; ' || public.fmt_ist_date(x.on_date)
                               || CASE WHEN x.sort_key = 1 THEN ' (' || (v_today - x.on_date) || ' days late)' ELSE '' END
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
      'link_html', '<a href="' || v_settings.app_base_url || '/notices-dashboard">Open the work queue in GST Keeper</a>');
    IF public.notice_alert_enqueue('E3_due_in_7', v_d.to_email, v_d.to_name, v_d.to_user, v_vars,
         'D:' || v_today || ':' || v_d.to_email, NULL, NULL, NULL, v_d.critical) THEN
      v_queued := v_queued + 1;
    END IF;
  END LOOP;

  -- E2: firm-wide overdue list for the managers.
  IF coalesce(v_e2.is_active, false) THEN
    SELECT count(*),
           string_agg('• ' || f.client_name || ' — ' || coalesce(f.form_label, f.notice_type, 'Notice') || ' — '
                        || coalesce(f.reference_number, 'no reference') || ' (due ' || public.fmt_ist_date(f.effective_due)
                        || ', ' || coalesce(f.assign_to, 'no owner') || ')',
                      E'\n' ORDER BY f.effective_due, f.client_name)
      INTO v_count, v_lines
      FROM (SELECT * FROM public.notice_facts WHERE is_overdue ORDER BY effective_due, client_name LIMIT 60) f;
    IF v_count > 0 THEN
      SELECT count(*) INTO v_count FROM public.notice_facts WHERE is_overdue;
      v_vars := jsonb_build_object('overdue_count', v_count, 'notice_type', 'Overdue notices',
                  'notice_list', v_lines || CASE WHEN v_count > 60 THEN E'\n… and ' || (v_count - 60) || ' more' ELSE '' END);
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
    SELECT count(*),
           string_agg('• ' || f.client_name || ' — ' || coalesce(f.form_label, f.notice_type, 'Notice') || ' — '
                        || coalesce(f.reference_number, 'no reference')
                        || CASE WHEN f.effective_due IS NOT NULL THEN ' (due ' || public.fmt_ist_date(f.effective_due) || ')' ELSE '' END,
                      E'\n' ORDER BY f.effective_due NULLS LAST, f.client_name)
      INTO v_count, v_lines
      FROM (SELECT * FROM public.notice_facts
             WHERE is_unassigned AND first_seen_at < now() - interval '48 hours'
             ORDER BY effective_due NULLS LAST, client_name LIMIT 60) f;
    IF v_count > 0 THEN
      SELECT count(*) INTO v_count FROM public.notice_facts
       WHERE is_unassigned AND first_seen_at < now() - interval '48 hours';
      v_vars := jsonb_build_object('unassigned_count', v_count, 'notice_type', 'Notices without an owner',
                  'notice_list', v_lines || CASE WHEN v_count > 60 THEN E'\n… and ' || (v_count - 60) || ' more' ELSE '' END);
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

-- ── Weekly MIS (Monday 09:45 IST) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_alerts_weekly()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today   date := public.ist_today();
  v_sum     jsonb := public.notices_dashboard_summary(NULL);
  v_new     int;
  v_closed  int;
  v_replies int;
  v_exposure numeric;
  v_stale   int;
  v_synced  int;
  v_owners  text;
  v_content text;
  v_r       record;
  v_queued  int := 0;
BEGIN
  SELECT count(*) INTO v_new FROM public.notice_facts WHERE first_seen_at >= now() - interval '7 days';
  SELECT count(*) FILTER (WHERE event_type = 'closed'), count(*) FILTER (WHERE event_type = 'reply_logged')
    INTO v_closed, v_replies
    FROM public.notice_events WHERE created_at >= now() - interval '7 days';
  SELECT coalesce(sum(amount), 0) INTO v_exposure FROM public.notice_exposure;
  SELECT count(*) FILTER (WHERE is_stale), count(*) INTO v_stale, v_synced
    FROM public.client_sync_status WHERE step = 'notices';
  SELECT string_agg('• ' || coalesce(o.owner, 'No owner') || ': ' || o.open_n || ' open, ' || o.overdue_n || ' overdue',
                    E'\n' ORDER BY o.overdue_n DESC, o.open_n DESC)
    INTO v_owners
    FROM (SELECT f.assign_to AS owner, count(*) AS open_n, count(*) FILTER (WHERE f.is_overdue) AS overdue_n
            FROM public.notice_facts f WHERE f.is_open
           GROUP BY f.assign_to) o;

  v_content := 'Open notices: ' || (v_sum ->> 'open') || ' (overdue ' || (v_sum ->> 'overdue')
            || ', due in 7 days ' || (v_sum ->> 'due_in_7') || ', without an owner ' || (v_sum ->> 'unassigned') || ')'
            || E'\nThis week: ' || v_new || ' new, ' || v_closed || ' closed, ' || v_replies || ' replies logged'
            || E'\nExposure (open disputes and matters): ₹ ' || to_char(round(v_exposure), 'FM99,99,99,99,99,999')
            || E'\nClients not synced in 24 hours: ' || v_stale || ' of ' || v_synced
            || E'\n\nBy owner:\n' || coalesce(v_owners, '• none');

  FOR v_r IN SELECT * FROM public.notice_alert_recipients('partner', NULL) LOOP
    IF public.notice_alert_enqueue('E10_weekly_mis', v_r.email, v_r.name, v_r.user_id,
         jsonb_build_object('report_date', public.fmt_ist_date(v_today), 'mis_content', v_content,
                            'notice_type', 'Weekly MIS'),
         'E10:' || to_char(v_today, 'IYYY-IW') || ':' || v_r.email) THEN
      v_queued := v_queued + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('queued', v_queued, 'week', to_char(v_today, 'IYYY-IW'));
END;
$$;

-- ── Entry point ────────────────────────────────────────────────────────────
-- p_mode: events (every 15 min) | daily (09:30 IST) | weekly (Monday) | all
-- (events + daily, for the "Run alerts now" button). Safe to run any number
-- of times: an alert already written is never written again.
CREATE OR REPLACE FUNCTION public.notice_alerts_run(p_mode text DEFAULT 'events')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb := jsonb_build_object('mode', p_mode,
                                    'alerts_mode', (SELECT alerts_mode FROM public.notice_settings WHERE id));
BEGIN
  IF p_mode NOT IN ('events', 'daily', 'weekly', 'all') THEN
    RAISE EXCEPTION 'notice_alerts_run: unknown mode %', p_mode USING ERRCODE = '22023';
  END IF;
  IF p_mode IN ('events', 'all') THEN
    v_out := v_out || jsonb_build_object('events', public.notice_alerts_process_events());
  END IF;
  IF p_mode IN ('daily', 'all') THEN
    v_out := v_out || jsonb_build_object('daily', public.notice_alerts_daily());
  END IF;
  IF p_mode = 'weekly' THEN
    v_out := v_out || jsonb_build_object('weekly', public.notice_alerts_weekly());
  END IF;
  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.notice_alerts_run(text) IS
  'Notice alert engine entry point (pg_cron): events every 15 min, daily at 09:30 IST, weekly on Monday. Writes email_outbox rows (status preview until notice_settings.alerts_mode = live).';

-- Only the entry points are callable through the API; the helpers write e-mails
-- to any address and stay internal.
REVOKE EXECUTE ON FUNCTION public.notice_alert_enqueue(text, text, text, uuid, jsonb, text, uuid, uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notice_alert_staff() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notice_alert_recipients(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notice_alerts_process_events(int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notice_alerts_daily() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notice_alerts_weekly() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notice_alerts_run(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notices_auto_assign_open() TO anon, authenticated, service_role;

-- ── Schedule ───────────────────────────────────────────────────────────────
-- Replaces the edge-function digest job; the outbox drain (send-gst-email,
-- every 15 minutes) is unchanged. The nightly sweep also re-writes the clocks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notice-alerts-daily-digest') THEN
    PERFORM cron.unschedule('notice-alerts-daily-digest');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notice-alerts-events') THEN
    PERFORM cron.unschedule('notice-alerts-events');
  END IF;
  PERFORM cron.schedule('notice-alerts-events', '*/15 * * * *', $cmd$select public.notice_alerts_run('events')$cmd$);
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notice-alerts-daily') THEN
    PERFORM cron.unschedule('notice-alerts-daily');
  END IF;
  PERFORM cron.schedule('notice-alerts-daily', '0 4 * * *', $cmd$select public.notice_alerts_run('daily')$cmd$);
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notice-alerts-weekly-mis') THEN
    PERFORM cron.unschedule('notice-alerts-weekly-mis');
  END IF;
  PERFORM cron.schedule('notice-alerts-weekly-mis', '15 4 * * 1', $cmd$select public.notice_alerts_run('weekly')$cmd$);
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notices-sweep-nightly') THEN
    PERFORM cron.unschedule('notices-sweep-nightly');
  END IF;
  PERFORM cron.schedule('notices-sweep-nightly', '30 21 * * *',
                        $cmd$select public.notices_sweep(null), public.notice_clocks_refresh(null)$cmd$);
END;
$$;
