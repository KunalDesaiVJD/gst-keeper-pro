-- Notices Phase 1 · classifier and short clocks
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: roadmap Phase 1 task 7; findings L-22, L-23).
--
-- The portal's notice list carries no form code — only a type ("Notice",
-- "Order", or the case type on case-task rows) and a free-text description —
-- so DRC-01B intimations, REG-17 show-cause notices and GSTR-3A defaulter
-- notices all landed in generic "Notice"/"Order" buckets with no priority and,
-- often, no due date. notice_form_rules turns that text into a form code with:
--   * a dashboard category (NULL = keep the older text-based category),
--   * a default priority, set once when a notice is first captured (a staff
--     value is never overwritten),
--   * the short reply clock the law fixes, used only when the portal gives no
--     due date (shown as "computed" with its basis), and
--   * whether the form is an appealable order (s.107 / s.112), for the
--     statutory clocks writer.
-- The rules are data: the first active rule in match_order wins; editing a
-- rule re-classifies every notice. Every period is an elected default the
-- firm must confirm (confirmed_at / confirmed_by) — see
-- docs/NOTICES_LITIGATION_POSITIONS.md §9.

CREATE TABLE IF NOT EXISTS public.notice_form_rules (
  form_code        text PRIMARY KEY,
  match_order      int  NOT NULL,
  pattern          text NOT NULL,
  label            text NOT NULL,
  category         text,
  default_priority text CHECK (default_priority IN ('Low', 'Medium', 'High')),
  reply_days       int  CHECK (reply_days IS NULL OR reply_days > 0),
  reply_day_kind   text NOT NULL DEFAULT 'calendar' CHECK (reply_day_kind IN ('calendar', 'working')),
  clock_basis      text,
  appeal_section   text CHECK (appeal_section IN ('s107', 's112')),
  is_active        boolean NOT NULL DEFAULT true,
  confirmed_at     timestamptz,
  confirmed_by     text,
  note             text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notice_form_rules IS
  'Maps portal notice text to a form code, category, default priority and short reply clock. pattern is a case-insensitive regex matched against "notice_type | description"; the first active rule in match_order wins.';

ALTER TABLE public.notice_form_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notice_form_rules_public" ON public.notice_form_rules;
CREATE POLICY "notice_form_rules_public" ON public.notice_form_rules FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_form_rules TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notice_form_rules_updated_at ON public.notice_form_rules;
CREATE TRIGGER trg_notice_form_rules_updated_at BEFORE UPDATE ON public.notice_form_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Specific forms before generic ones: DRC-01A/B/C before DRC-01, APL-04
-- before DRC-07 ("summary of the order"), every named SCN before the generic
-- "show cause notice" catch-all on DRC-01. ON CONFLICT DO NOTHING: re-running
-- this file never overwrites a rule the firm has edited.
INSERT INTO public.notice_form_rules
  (form_code, match_order, pattern, label, category, default_priority, reply_days, reply_day_kind, clock_basis, appeal_section)
VALUES
  ('DRC-01B', 10, 'drc[- ]?0?1[- ]?b\M|liability mismatch|difference in (the )?liability',
   'Intimation of liability difference, GSTR-1 vs GSTR-3B (DRC-01B)', 'Demand Notice', 'High', 7, 'calendar',
   'Rule 88C: pay the difference or explain it in Part B of DRC-01B within 7 days; GSTR-1 stays blocked until then', NULL),
  ('DRC-01C', 11, 'drc[- ]?0?1[- ]?c\M|itc mismatch|difference in (the )?(input tax credit|itc)',
   'Intimation of ITC difference, GSTR-2B vs GSTR-3B (DRC-01C)', 'Demand Notice', 'High', 7, 'calendar',
   'Rule 88D: pay or reverse the difference, or explain it in Part B of DRC-01C, within 7 days', NULL),
  ('DRC-01A', 12, 'drc[- ]?0?1[- ]?a\M|tax ascertained',
   'Intimation of tax ascertained before a show cause notice (DRC-01A)', 'DRC 01', 'High', NULL, 'calendar', NULL, NULL),
  ('APL-04', 15, 'apl[- ]?0?4\M|order in appeal|appellate authority',
   'Summary of the appellate order (APL-04)', 'Appeal', 'High', NULL, 'calendar', NULL, 's112'),
  ('DRC-13', 20, 'drc[- ]?13\M|garnishee|recovery from (a )?third person',
   'Garnishee notice to a third person (DRC-13)', 'Recovery', 'High', NULL, 'calendar', NULL, NULL),
  ('DRC-22', 21, 'drc[- ]?22\M|provisional attachment',
   'Provisional attachment of property (DRC-22)', 'Recovery', 'High', 7, 'calendar',
   'Rule 159(5): objection to the attachment within 7 days; the attachment lapses one year after the order (s.83(2))', NULL),
  ('DRC-07', 22, 'drc[- ]?0?7\M|summary of (the )?order',
   'Summary of the demand order (DRC-07)', 'DRC 01', 'High', NULL, 'calendar', NULL, 's107'),
  ('REG-17', 30, 'reg[- ]?17\M|show cause notice for cancellation|scn for cancellation',
   'Show cause notice for cancellation of registration (REG-17)', 'Registration', 'High', 7, 'working',
   'Rule 22(1)-(2): reply in REG-18 within 7 working days of service', NULL),
  ('REG-23', 31, 'reg[- ]?23\M|show cause.{0,40}revocation|revocation.{0,60}show cause',
   'Show cause notice on a revocation application (REG-23)', 'Registration', 'High', 7, 'working',
   'Rule 23(3): reply in REG-24 within 7 working days of service', NULL),
  ('REG-03', 32, 'reg[- ]?0?3\M|seeking (additional|further) information',
   'Query on a registration application (REG-03)', 'Registration', 'Medium', 7, 'working',
   'Rule 9(2): reply in REG-04 within 7 working days of the notice', NULL),
  ('REG-19', 33, 'reg[- ]?19\M|order (of|for) cancellation of registration',
   'Order cancelling registration (REG-19)', 'Registration', 'High', NULL, 'calendar', NULL, 's107'),
  ('REG-05', 34, 'reg[- ]?0?5\M|rejection of (the )?application for (new )?registration',
   'Order rejecting a registration application (REG-05)', 'Registration', 'Medium', NULL, 'calendar', NULL, 's107'),
  ('GSTR-3A', 40, 'gstr[- ]?3a\M|return defaulter|not filing return',
   'Notice to a return defaulter (GSTR-3A, s.46)', 'Non filers', 'High', 15, 'calendar',
   's.46 read with Rule 68: file the return within 15 days, or face best-judgment assessment under s.62', NULL),
  ('ASMT-14', 50, 'asmt[- ]?14\M',
   'Show cause notice before assessment under s.63 (ASMT-14)', 'ASMT 10', 'High', 15, 'calendar',
   'Rule 100(2): reply within 15 days of the notice', NULL),
  ('ASMT-10', 51, 'asmt[- ]?10\M|scrutiny of returns?|discrepanc(y|ies) in (the )?return',
   'Scrutiny notice (ASMT-10)', 'ASMT 10', 'Medium', 30, 'calendar',
   'Rule 99(2): explain in ASMT-11 within 30 days, or the time the notice allows', NULL),
  ('RFD-08', 60, 'rfd[- ]?0?8\M|show cause.{0,30}refund|refund.{0,30}show cause',
   'Show cause notice on a refund claim (RFD-08)', NULL, 'High', 15, 'calendar',
   'Rule 92(3): reply in RFD-09 within 15 days of the notice', NULL),
  ('RFD-03', 61, 'rfd[- ]?0?3\M|deficiency memo',
   'Refund deficiency memo (RFD-03)', NULL, 'Medium', NULL, 'calendar', NULL, NULL),
  ('MOV-07', 70, 'mov[- ]?0?7\M',
   'Notice after detention of goods (MOV-07)', 'Ewaybill', 'High', NULL, 'calendar', NULL, NULL),
  ('MOV-09', 71, 'mov[- ]?0?9\M',
   'Order of demand after detention (MOV-09)', 'Ewaybill', 'High', NULL, 'calendar', NULL, 's107'),
  ('ADT-01', 80, 'adt[- ]?0?1\M|conduct of audit|notice for audit',
   'Notice for audit (ADT-01)', 'Audit', 'Medium', NULL, 'calendar', NULL, NULL),
  ('ADT-02', 81, 'adt[- ]?0?2\M|audit report|findings of (the )?audit',
   'Audit findings (ADT-02)', 'Audit', 'Medium', NULL, 'calendar', NULL, NULL),
  ('DRC-01', 90, 'drc[- ]?0?1\M|show cause notice|determination of tax',
   'Show cause notice for a tax demand (DRC-01)', 'DRC 01', 'High', 30, 'calendar',
   's.73/74 read with Rule 142(2): reply in DRC-06 within 30 days, or the time the notice allows', NULL),
  ('LUT', 95, 'letter of undertaking|\mlut\M|rfd[- ]?11\M',
   'Letter of undertaking (acknowledgement)', 'LUT', 'Low', NULL, 'calendar', NULL, NULL),
  ('DRC-03', 96, 'voluntary payment|drc[- ]?0?3\M',
   'Voluntary payment (DRC-03)', NULL, 'Low', NULL, 'calendar', NULL, NULL)
ON CONFLICT (form_code) DO NOTHING;

ALTER TABLE public.gst_notices ADD COLUMN IF NOT EXISTS form_code text;
COMMENT ON COLUMN public.gst_notices.form_code IS
  'Portal form code derived from notice_type/description by notice_form_rules (maintained by trigger).';
CREATE INDEX IF NOT EXISTS idx_gst_notices_form_code ON public.gst_notices (form_code) WHERE form_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notice_form_code(p_type text, p_desc text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT r.form_code
    FROM public.notice_form_rules r
   WHERE r.is_active
     AND (coalesce(p_type, '') || ' | ' || coalesce(p_desc, '')) ~* r.pattern
   ORDER BY r.match_order, r.form_code
   LIMIT 1
$$;

-- The category the app used before form codes (src/utils/noticeCategoryClassifier.ts,
-- now a thin reader of notice_facts.category): description keywords first, then
-- the case type map, then the raw notice_type. Kept for rows no rule assigns a
-- category to, so existing buckets keep their meaning.
CREATE OR REPLACE FUNCTION public.notice_category_legacy(p_type text, p_desc text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_desc, '') ~* 'registration' THEN 'Registration'
    WHEN coalesce(p_desc, '') ~* 'return defaulter|not filing return' THEN 'Non filers'
    WHEN coalesce(p_desc, '') ~* 'ITC mismatch|liability mismatch|DRC-01B|DRC-01C' THEN 'Demand Notice'
    ELSE CASE coalesce(nullif(p_type, ''), 'Uncategorised')
      WHEN 'Determination Of Tax' THEN 'DRC 01'
      WHEN 'Letter Of Undertaking' THEN 'LUT'
      WHEN 'Scrutiny Of Returns' THEN 'ASMT 10'
      WHEN 'Enforcement Case' THEN 'Enforcement'
      WHEN 'Rectification Of Orders' THEN 'Order Rectification'
      WHEN 'Pre-Gst Recovery' THEN 'Recovery'
      WHEN 'Waiver Scheme U/S 128a' THEN 'Others'
      ELSE coalesce(nullif(p_type, ''), 'Uncategorised')
    END
  END
$$;

-- Keeps form_code current, and gives a newly captured notice its default
-- priority (the form's, else High when it carries a demand). Only on INSERT,
-- and only when no priority was supplied — a staff choice is never replaced.
CREATE OR REPLACE FUNCTION public.gst_notices_classify()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_priority text;
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.notice_type IS DISTINCT FROM OLD.notice_type
     OR NEW.description IS DISTINCT FROM OLD.description THEN
    NEW.form_code := public.notice_form_code(NEW.notice_type, NEW.description);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.priority IS NULL THEN
    SELECT r.default_priority INTO v_priority
      FROM public.notice_form_rules r
     WHERE r.form_code = NEW.form_code AND r.is_active;
    NEW.priority := coalesce(v_priority, CASE WHEN coalesce(NEW.amount_of_demand, 0) > 0 THEN 'High' END);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gst_notices_classify ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_classify
  BEFORE INSERT OR UPDATE OF notice_type, description ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_classify();

-- Editing the rules re-classifies every notice that would now get a different code.
CREATE OR REPLACE FUNCTION public.notice_form_rules_reclassify()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.gst_notices n
     SET form_code = public.notice_form_code(n.notice_type, n.description)
   WHERE n.form_code IS DISTINCT FROM public.notice_form_code(n.notice_type, n.description);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notice_form_rules_reclassify ON public.notice_form_rules;
CREATE TRIGGER trg_notice_form_rules_reclassify
  AFTER INSERT OR UPDATE OR DELETE ON public.notice_form_rules
  FOR EACH STATEMENT EXECUTE FUNCTION public.notice_form_rules_reclassify();

-- Classify what is already on file (priorities of existing rows are left alone).
UPDATE public.gst_notices n
   SET form_code = public.notice_form_code(n.notice_type, n.description)
 WHERE n.form_code IS DISTINCT FROM public.notice_form_code(n.notice_type, n.description);
