-- Phase 1: Notice alert infrastructure
-- Tables: notice_events, notice_alert_rules, notice_alert_log,
--         staff_notification_prefs, matter_deadlines
-- Columns: gst_notices.assign_to_user_id, email_outbox extensions
-- Templates: E1-E13 notice alert email templates

-- ─── 1. notice_events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notice_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id     uuid NOT NULL REFERENCES gst_notices(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type    text NOT NULL,
  old_value     jsonb,
  new_value     jsonb,
  actor_id      uuid,
  actor_name    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notice_events_notice ON notice_events(notice_id);
CREATE INDEX IF NOT EXISTS idx_notice_events_type   ON notice_events(event_type);
CREATE INDEX IF NOT EXISTS idx_notice_events_ts     ON notice_events(created_at);

ALTER TABLE notice_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notice_events_public" ON notice_events;
CREATE POLICY "notice_events_public" ON notice_events FOR ALL TO public USING (true) WITH CHECK (true);

-- ─── 2. staff_notification_prefs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_notification_prefs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  channel       text NOT NULL DEFAULT 'email',
  alert_kind    text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, channel, alert_kind)
);

ALTER TABLE staff_notification_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_notification_prefs_public" ON staff_notification_prefs;
CREATE POLICY "staff_notification_prefs_public" ON staff_notification_prefs FOR ALL TO public USING (true) WITH CHECK (true);

-- ─── 3. notice_alert_rules ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notice_alert_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key     text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text,
  event_type    text,
  schedule      text,
  template_key  text NOT NULL,
  recipient     text NOT NULL DEFAULT 'team',
  is_active     boolean NOT NULL DEFAULT true,
  priority      text NOT NULL DEFAULT 'normal',
  quiet_hours   boolean NOT NULL DEFAULT true,
  max_repeats   int,
  cooldown_hrs  int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notice_alert_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notice_alert_rules_public" ON notice_alert_rules;
CREATE POLICY "notice_alert_rules_public" ON notice_alert_rules FOR ALL TO public USING (true) WITH CHECK (true);

-- ─── 4. notice_alert_log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notice_alert_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         uuid REFERENCES notice_alert_rules(id),
  notice_id       uuid REFERENCES gst_notices(id) ON DELETE CASCADE,
  client_id       uuid REFERENCES clients(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES notice_events(id),
  email_outbox_id uuid REFERENCES email_outbox(id),
  recipient_email text,
  status          text NOT NULL DEFAULT 'sent',
  suppress_reason text,
  dedupe_key      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notice_alert_log_notice ON notice_alert_log(notice_id);
CREATE INDEX IF NOT EXISTS idx_notice_alert_log_rule   ON notice_alert_log(rule_id);
CREATE INDEX IF NOT EXISTS idx_notice_alert_log_dedupe ON notice_alert_log(dedupe_key);

ALTER TABLE notice_alert_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notice_alert_log_public" ON notice_alert_log;
CREATE POLICY "notice_alert_log_public" ON notice_alert_log FOR ALL TO public USING (true) WITH CHECK (true);

-- ─── 5. matter_deadlines ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matter_deadlines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id       uuid NOT NULL REFERENCES gst_notices(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  deadline_type   text NOT NULL,
  deadline_date   date NOT NULL,
  statutory_basis text,
  source          text NOT NULL DEFAULT 'computed',
  is_met          boolean NOT NULL DEFAULT false,
  met_at          timestamptz,
  met_by          text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matter_deadlines_notice ON matter_deadlines(notice_id);
CREATE INDEX IF NOT EXISTS idx_matter_deadlines_date   ON matter_deadlines(deadline_date);
CREATE INDEX IF NOT EXISTS idx_matter_deadlines_type   ON matter_deadlines(deadline_type);

ALTER TABLE matter_deadlines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "matter_deadlines_public" ON matter_deadlines;
CREATE POLICY "matter_deadlines_public" ON matter_deadlines FOR ALL TO public USING (true) WITH CHECK (true);

-- ─── 6. assign_to_user_id on gst_notices ────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gst_notices' AND column_name = 'assign_to_user_id'
  ) THEN
    ALTER TABLE gst_notices ADD COLUMN assign_to_user_id uuid;
  END IF;
END $$;

-- ─── 7. Extend email_outbox for notice alerts ──────────────────────────────
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind IN ('reminder', 'confirmation', 'builder_setup', 'builder_fsi', 'builder_cancellation',
                   'builder_agreement_confirm', 'notice_alert'));
ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('reminder', 'confirmation', 'builder_setup', 'builder_fsi', 'builder_cancellation',
                   'builder_agreement_confirm', 'notice_alert'));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_outbox' AND column_name = 'notice_id'
  ) THEN
    ALTER TABLE email_outbox ADD COLUMN notice_id uuid REFERENCES gst_notices(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_outbox' AND column_name = 'dedupe_key'
  ) THEN
    ALTER TABLE email_outbox ADD COLUMN dedupe_key text;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_outbox' AND column_name = 'client_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE email_outbox ALTER COLUMN client_id DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_outbox_dedupe ON email_outbox(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_email_outbox_notice ON email_outbox(notice_id);

-- ─── 8. Seed notice alert rules ─────────────────────────────────────────────
INSERT INTO notice_alert_rules (alert_key, name, description, event_type, schedule, template_key, recipient, priority, quiet_hours, max_repeats, cooldown_hrs) VALUES
  ('E1_new_notice',       'New notice captured',          'Immediate alert when sync captures a new notice',             'captured',       NULL,          'notice_new',          'team',     'critical', false, NULL, NULL),
  ('E2_overdue_digest',   'Daily overdue digest',         'Morning digest of all overdue notices',                       NULL,             '0 4 * * *',   'notice_overdue_digest','team',     'normal',   true,  1,    24),
  ('E3_due_in_7',         'Due in 7 days warning',        'Alert when a notice becomes due within 7 days',               NULL,             '0 4 * * *',   'notice_due_soon',     'assignee', 'normal',   true,  1,    168),
  ('E4_hearing_reminder', 'Hearing date reminder',        'Reminder 7 days and 1 day before a hearing',                  NULL,             '0 4 * * *',   'notice_hearing',      'assignee', 'critical', false, 2,    24),
  ('E5_limitation_alert', 'Limitation period warning',    'Appeal/tribunal deadline approaching (T-30, T-7)',            NULL,             '0 4 * * *',   'notice_limitation',   'partner',  'critical', false, 2,    168),
  ('E6_assigned',         'Notice assigned to you',       'Alert when a notice is assigned to a staff member',           'assigned',       NULL,          'notice_assigned',     'assignee', 'normal',   true,  NULL, NULL),
  ('E7_status_changed',   'Status changed',               'Alert when notice status changes',                            'status_changed', NULL,          'notice_status',       'team',     'low',      true,  NULL, NULL),
  ('E8_reply_logged',     'Reply logged',                 'Confirmation when a reply is logged on a notice',             'reply_logged',   NULL,          'notice_reply',        'assignee', 'normal',   true,  NULL, NULL),
  ('E9_sync_anomaly',     'Sync anomaly detected',        'Alert when sync detects unusual patterns',                    NULL,             NULL,          'notice_sync_anomaly', 'partner',  'critical', false, NULL, 24),
  ('E10_weekly_mis',      'Weekly MIS summary',           'Monday morning MIS report for the partner',                   NULL,             '30 4 * * 1',  'notice_weekly_mis',   'partner',  'normal',   true,  1,    168),
  ('E11_unassigned',      'Unassigned notice reminder',   'Daily reminder for notices with no owner after 48h',          NULL,             '0 4 * * *',   'notice_unassigned',   'team',     'normal',   true,  NULL, 24),
  ('E12_client_docs',     'Request documents from client', 'Email client requesting documents for a notice',             NULL,             NULL,          'notice_client_docs',  'client',   'normal',   true,  3,    72),
  ('E13_client_update',   'Client status update',         'Periodic update to client on their notice status',            NULL,             NULL,          'notice_client_update','client',   'normal',   true,  NULL, 168)
ON CONFLICT (alert_key) DO NOTHING;

-- ─── 9. Seed notice email templates ─────────────────────────────────────────
INSERT INTO email_templates (key, kind, name, step, subject, body, sort_order, is_active) VALUES
  ('notice_new', 'notice_alert', 'New Notice Captured', NULL,
   'New {{notice_type}} for {{client_name}} ({{gstin}})',
   E'A new {{notice_type}} has been captured from the GST portal.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nReference: {{reference_number}}\nIssued: {{issue_date}}\nDue Date: {{due_date}}\nDescription: {{description}}\n\nPlease review and take action.\n\n-- {{firm_name}}',
   100, true),
  ('notice_overdue_digest', 'notice_alert', 'Daily Overdue Digest', NULL,
   '{{overdue_count}} overdue notices -- Daily Digest',
   E'The following notices are past their due date with no reply logged:\n\n{{notice_list}}\n\nPlease prioritise these for immediate action.\n\n-- {{firm_name}}',
   101, true),
  ('notice_due_soon', 'notice_alert', 'Notice Due Soon', NULL,
   '{{notice_type}} due in {{days_remaining}} days -- {{client_name}}',
   E'A notice is approaching its due date.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nReference: {{reference_number}}\nDue Date: {{due_date}}\nDays Remaining: {{days_remaining}}\n\nPlease ensure a reply is filed before the deadline.\n\n-- {{firm_name}}',
   102, true),
  ('notice_hearing', 'notice_alert', 'Hearing Reminder', NULL,
   'Hearing on {{hearing_date}} -- {{client_name}} ({{notice_type}})',
   E'A hearing is scheduled.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nHearing Date: {{hearing_date}}\nOfficer: {{issued_by}}\n\nPlease prepare the required documents.\n\n-- {{firm_name}}',
   103, true),
  ('notice_limitation', 'notice_alert', 'Limitation Period Warning', NULL,
   '{{deadline_type}} deadline in {{days_remaining}} days -- {{client_name}}',
   E'A statutory limitation period is approaching.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nDeadline Type: {{deadline_type}}\nDeadline Date: {{deadline_date}}\nStatutory Basis: {{statutory_basis}}\nDays Remaining: {{days_remaining}}\n\nAction is required before this date to preserve rights.\n\n-- {{firm_name}}',
   104, true),
  ('notice_assigned', 'notice_alert', 'Notice Assigned', NULL,
   '{{notice_type}} assigned to you -- {{client_name}}',
   E'A notice has been assigned to you.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nReference: {{reference_number}}\nDue Date: {{due_date}}\nPriority: {{priority}}\n\nPlease review and update the status.\n\n-- {{firm_name}}',
   105, true),
  ('notice_status', 'notice_alert', 'Status Changed', NULL,
   'Notice status updated: {{new_status}} -- {{client_name}} ({{notice_type}})',
   E'A notice status has been updated.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nOld Status: {{old_status}}\nNew Status: {{new_status}}\nUpdated By: {{actor_name}}\n\n-- {{firm_name}}',
   106, false),
  ('notice_reply', 'notice_alert', 'Reply Logged', NULL,
   'Reply logged for {{notice_type}} -- {{client_name}}',
   E'A reply has been logged for a notice.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nReply Ref: {{reply_ref_number}}\nReply Date: {{reply_date}}\nLogged By: {{actor_name}}\n\n-- {{firm_name}}',
   107, false),
  ('notice_sync_anomaly', 'notice_alert', 'Sync Anomaly', NULL,
   'Sync anomaly detected for {{client_name}}',
   E'The sync process detected an unusual pattern.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nAnomaly: {{anomaly_description}}\n\nPlease investigate.\n\n-- {{firm_name}}',
   108, true),
  ('notice_weekly_mis', 'notice_alert', 'Weekly MIS Summary', NULL,
   'Weekly Notices MIS -- {{report_date}}',
   E'Weekly Notices Management Information Summary\n\n{{mis_content}}\n\n-- {{firm_name}}',
   109, true),
  ('notice_unassigned', 'notice_alert', 'Unassigned Notices', NULL,
   '{{unassigned_count}} notices unassigned for 48+ hours',
   E'The following notices have no assigned owner and have been open for more than 48 hours:\n\n{{notice_list}}\n\nPlease assign these to a team member.\n\n-- {{firm_name}}',
   110, true),
  ('notice_client_docs', 'notice_alert', 'Request Documents from Client', NULL,
   'Documents Required -- {{notice_type}} ({{reference_number}})',
   E'Dear {{contact_person}},\n\nWe are handling a {{notice_type}} (Ref: {{reference_number}}) for {{client_name}} (GSTIN: {{gstin}}).\n\nWe require the following documents:\n{{document_list}}\n\nPlease share these at your earliest convenience.\n\nRegards,\n{{staff_name}}\n{{firm_name}}\n{{firm_email}}',
   111, true),
  ('notice_client_update', 'notice_alert', 'Client Status Update', NULL,
   'Status Update -- {{notice_type}} ({{reference_number}})',
   E'Dear {{contact_person}},\n\nHere is an update on the {{notice_type}} (Ref: {{reference_number}}) for {{client_name}} (GSTIN: {{gstin}}).\n\nCurrent Status: {{staff_status}}\nNext Step: {{next_step}}\n\nWe will keep you informed of any developments.\n\nRegards,\n{{staff_name}}\n{{firm_name}}\n{{firm_email}}',
   112, true)
ON CONFLICT (key) DO NOTHING;
