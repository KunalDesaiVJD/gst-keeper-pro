-- Phase 3: Litigation core — matters, stage history, events, documents,
-- hearings, payments, litigation rules, and matter linkage on gst_notices.

----------------------------------------------------------------------
-- 1. litigation_matters
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS litigation_matters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  matter_no text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'demand',
  title text,
  section_of_law text,
  financial_years text[],
  authority text,
  officer text,
  jurisdiction text,
  stage text NOT NULL DEFAULT 'Captured',
  status text NOT NULL DEFAULT 'Open',
  priority text DEFAULT 'Medium',
  owner_user_id uuid,
  reviewer_user_id uuid,
  demand_tax numeric DEFAULT 0,
  demand_interest numeric DEFAULT 0,
  demand_penalty numeric DEFAULT 0,
  demand_cess numeric DEFAULT 0,
  paid_total numeric DEFAULT 0,
  pre_deposit_total numeric DEFAULT 0,
  computed_due_date date,
  override_due_date date,
  limitation_date date,
  hearing_at timestamptz,
  next_action text,
  closed_at timestamptz,
  closed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, matter_no)
);

ALTER TABLE litigation_matters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "litigation_matters_public"
  ON litigation_matters FOR ALL TO public
  USING (true) WITH CHECK (true);

CREATE INDEX idx_lit_matters_client ON litigation_matters (client_id);
CREATE INDEX idx_lit_matters_stage ON litigation_matters (stage);
CREATE INDEX idx_lit_matters_status ON litigation_matters (status);
CREATE INDEX idx_lit_matters_owner ON litigation_matters (owner_user_id);
CREATE INDEX idx_lit_matters_lifecycle ON litigation_matters (lifecycle);

----------------------------------------------------------------------
-- 2. Add matter_id to gst_notices
----------------------------------------------------------------------
ALTER TABLE gst_notices
  ADD COLUMN IF NOT EXISTS matter_id uuid REFERENCES litigation_matters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gst_notices_matter ON gst_notices (matter_id)
  WHERE matter_id IS NOT NULL;

----------------------------------------------------------------------
-- 3. matter_stage_history
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES litigation_matters(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  note text
);

ALTER TABLE matter_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matter_stage_history_public"
  ON matter_stage_history FOR ALL TO public
  USING (true) WITH CHECK (true);

CREATE INDEX idx_stage_history_matter ON matter_stage_history (matter_id, changed_at DESC);

----------------------------------------------------------------------
-- 4. matter_events (activity log for matters)
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES litigation_matters(id) ON DELETE CASCADE,
  notice_id uuid REFERENCES gst_notices(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_user_id uuid,
  actor_name text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE matter_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matter_events_public"
  ON matter_events FOR ALL TO public
  USING (true) WITH CHECK (true);

CREATE INDEX idx_matter_events_matter ON matter_events (matter_id, created_at DESC);
CREATE INDEX idx_matter_events_type ON matter_events (event_type);

----------------------------------------------------------------------
-- 5. matter_documents
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES litigation_matters(id) ON DELETE CASCADE,
  notice_id uuid REFERENCES gst_notices(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'notice',
  title text NOT NULL,
  storage_path text,
  mime text,
  size_bytes bigint,
  source text NOT NULL DEFAULT 'upload',
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE matter_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matter_documents_public"
  ON matter_documents FOR ALL TO public
  USING (true) WITH CHECK (true);

CREATE INDEX idx_matter_docs_matter ON matter_documents (matter_id);
CREATE INDEX idx_matter_docs_kind ON matter_documents (kind);

----------------------------------------------------------------------
-- 6. matter_hearings
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_hearings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES litigation_matters(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  mode text DEFAULT 'physical',
  venue text,
  officer text,
  attended_by uuid[],
  outcome text,
  adjourned boolean NOT NULL DEFAULT false,
  next_date timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE matter_hearings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matter_hearings_public"
  ON matter_hearings FOR ALL TO public
  USING (true) WITH CHECK (true);

CREATE INDEX idx_matter_hearings_matter ON matter_hearings (matter_id);
CREATE INDEX idx_matter_hearings_date ON matter_hearings (scheduled_at);

----------------------------------------------------------------------
-- 7. matter_payments
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES litigation_matters(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'voluntary',
  drc03_arn text,
  tax numeric DEFAULT 0,
  interest numeric DEFAULT 0,
  penalty numeric DEFAULT 0,
  cess numeric DEFAULT 0,
  paid_on date,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE matter_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matter_payments_public"
  ON matter_payments FOR ALL TO public
  USING (true) WITH CHECK (true);

CREATE INDEX idx_matter_payments_matter ON matter_payments (matter_id);

----------------------------------------------------------------------
-- 8. litigation_rules (configuration table for statutory periods)
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS litigation_rules (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  unit text NOT NULL DEFAULT 'days',
  effective_from date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE litigation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "litigation_rules_public"
  ON litigation_rules FOR ALL TO public
  USING (true) WITH CHECK (true);

-- Seed statutory defaults
INSERT INTO litigation_rules (key, value, unit, note) VALUES
  ('reply_days.drc01', 30, 'days', 'DRC-01 SCN reply period (s.73/74)'),
  ('reply_days.asmt10', 30, 'days', 'ASMT-10 scrutiny notice reply'),
  ('reply_days.drc01b', 7, 'days', 'DRC-01B ITC mismatch (Rule 88C)'),
  ('reply_days.drc01c', 7, 'days', 'DRC-01C 2B vs 3B mismatch (Rule 88D)'),
  ('reply_days.rfd08', 15, 'days', 'RFD-08 refund SCN reply'),
  ('reply_days.reg18', 7, 'days', 'REG-18 cancellation SCN reply (working days)'),
  ('reply_days.reg24', 7, 'days', 'REG-24 revocation SCN reply (working days)'),
  ('reply_days.gstr3a', 15, 'days', 'GSTR-3A non-filer notice'),
  ('appeal_months.s107', 3, 'months', 'First appeal u/s 107 — 3 months from order'),
  ('appeal_condonation.s107', 1, 'months', 'Condonation window u/s 107(4)'),
  ('appeal_months.s112', 3, 'months', 'Tribunal appeal u/s 112 — 3 months from APL-04'),
  ('appeal_condonation.s112', 3, 'months', 'Condonation window u/s 112'),
  ('rectification_months.s161', 3, 'months', 'Rectification application — 3 months from order'),
  ('rectification_authority_months.s161', 6, 'months', 'Authority rectification — 6 months from order'),
  ('predeposit_pct.s107', 10, 'percent', 'Pre-deposit for first appeal — 10% of disputed tax'),
  ('predeposit_pct.s112', 10, 'percent', 'Additional pre-deposit for tribunal — 10% of disputed tax'),
  ('predeposit_pct.s129_penalty', 25, 'percent', 'Pre-deposit for s.129 detention penalty appeal'),
  ('reduced_penalty_days.s73', 30, 'days', 'Reduced penalty payment window u/s 73'),
  ('reduced_penalty_days.s74', 30, 'days', 'Reduced penalty payment window u/s 74'),
  ('reduced_penalty_days.s74a', 60, 'days', 'Reduced penalty payment window u/s 74A'),
  ('recovery_months.s78', 3, 'months', 'Recovery start — 3 months after order service'),
  ('drc22_validity.s83', 365, 'days', 'DRC-22 provisional attachment validity — 1 year'),
  ('revocation_days.reg21', 90, 'days', 'Revocation application — 90 days from cancellation')
ON CONFLICT (key) DO NOTHING;

----------------------------------------------------------------------
-- 9. Widen email_outbox and email_templates kind CHECK for new kinds
----------------------------------------------------------------------
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN (
    'reminder', 'confirmation',
    'builder_setup', 'builder_fsi', 'builder_cancellation', 'builder_agreement_confirm',
    'notice_alert', 'digest', 'hearing', 'assignment', 'mis'
  ));

ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind IN (
    'reminder', 'confirmation',
    'builder_setup', 'builder_fsi', 'builder_cancellation', 'builder_agreement_confirm',
    'notice_alert', 'digest', 'hearing', 'assignment', 'mis'
  ));

-- Add matter_id to email_outbox for matter-level alerts
ALTER TABLE email_outbox
  ADD COLUMN IF NOT EXISTS matter_id uuid REFERENCES litigation_matters(id) ON DELETE SET NULL;
