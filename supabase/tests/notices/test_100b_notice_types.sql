-- Notice types (migration 20261008150000): reply need and dashboard choice per form,
-- the flags and plan that follow from them, and a command centre whose every number
-- still equals its list.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, inactive_at_hand) VALUES
 ('10b00000-0000-0000-0000-000000000001', 'Types Test Traders', '24TYPES0000T1Z5', 'types', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number) VALUES
 ('10b00000-0000-0000-0000-0000000000a1', '10b00000-0000-0000-0000-000000000001', 'notices', 'ty1', 'Scrutiny Of Returns',
  'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', ist_today() - 40, ist_today() - 5, 'ZD-TY-1'),
 ('10b00000-0000-0000-0000-0000000000a2', '10b00000-0000-0000-0000-000000000001', 'notices', 'ty2', 'Appeal',
  'Appeal admitted (APL-02)', ist_today() - 20, ist_today() - 3, 'ZD-TY-2'),
 ('10b00000-0000-0000-0000-0000000000a3', '10b00000-0000-0000-0000-000000000001', 'notices', 'ty3', 'Intimation',
  'Intimation of tax ascertained being payable under section 73(5) (DRC-01A)', ist_today() - 2, ist_today() + 5, 'ZD-TY-3'),
 ('10b00000-0000-0000-0000-0000000000a4', '10b00000-0000-0000-0000-000000000001', 'notices', 'ty4', 'Letter',
  'A letter the rules do not know', ist_today() - 1, ist_today() + 2, 'ZD-TY-4');

SELECT t_eq((SELECT form_code FROM gst_notices WHERE id = '10b00000-0000-0000-0000-0000000000a2'), 'APL-02', 'fixture: APL-02 classified');
SELECT t_eq((SELECT form_code FROM gst_notices WHERE id = '10b00000-0000-0000-0000-0000000000a4') IS NULL, true, 'fixture: one unclassified');

-- ── Seeded settings ────────────────────────────────────────────────────────
SELECT t_eq((SELECT response_need || '/' || show_on_dashboard FROM notice_type_settings WHERE form_code = 'DRC-01'), 'critical/true', 'DRC-01 needs a reply and is shown');
SELECT t_eq((SELECT response_need || '/' || show_on_dashboard FROM notice_type_settings WHERE form_code = 'DRC-01A'), 'optional/true', 'DRC-01A: reply optional');
SELECT t_eq((SELECT response_need || '/' || show_on_dashboard FROM notice_type_settings WHERE form_code = 'APL-02'), 'none/false', 'APL-02: information only, hidden');
SELECT t_eq((SELECT count(*) FROM notice_form_rules r LEFT JOIN notice_type_settings s USING (form_code) WHERE s.form_code IS NULL), 0::bigint,
            'every notice type has its settings row');
SELECT t_eq((SELECT open_count FROM notice_type_overview WHERE form_code = 'APL-02') >= 1, true, 'the overview counts open notices per type');

-- ── notice_type_set ────────────────────────────────────────────────────────
DO $$ BEGIN
  PERFORM notice_type_set('DRC-01', 'urgent');
  RAISE EXCEPTION 'an unknown reply need was accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
DO $$ BEGIN
  PERFORM notice_type_set('NOT-A-FORM', 'none');
  RAISE EXCEPTION 'an unknown notice type was accepted';
EXCEPTION WHEN no_data_found THEN NULL; END $$;
SELECT t_eq((notice_type_set('DRC-01A', NULL, false, 'Partner') ->> 'response_need'), 'optional', 'NULL leaves the reply need as it is');
SELECT t_eq((SELECT show_on_dashboard::text || '/' || updated_by_name FROM notice_type_settings WHERE form_code = 'DRC-01A'), 'false/Partner',
            'the dashboard choice and who made it are kept');
SELECT notice_type_set('DRC-01A', NULL, true, 'Partner');

-- ── notice_facts ───────────────────────────────────────────────────────────
SELECT t_eq((SELECT response_need || '/' || on_dashboard || '/' || is_overdue FROM notice_facts WHERE id = '10b00000-0000-0000-0000-0000000000a1'),
            'critical/true/true', 'a late ASMT-10 is overdue');
SELECT t_eq((SELECT response_need || '/' || on_dashboard || '/' || is_overdue FROM notice_facts WHERE id = '10b00000-0000-0000-0000-0000000000a2'),
            'none/false/false', 'a no-reply notice is never overdue, whatever its date');
SELECT t_eq((SELECT response_need || '/' || on_dashboard || '/' || is_due_in_7 FROM notice_facts WHERE id = '10b00000-0000-0000-0000-0000000000a3'),
            'optional/true/true', 'an optional reply still has its clock');
SELECT t_eq((SELECT response_need || '/' || on_dashboard FROM notice_facts WHERE id = '10b00000-0000-0000-0000-0000000000a4'),
            'critical/true', 'an unclassified notice needs a reply and is shown');

-- ── notice_plan ────────────────────────────────────────────────────────────
SELECT t_eq((SELECT next_action || '/' || coalesce(plan_due::text, 'none') FROM notice_plan WHERE id = '10b00000-0000-0000-0000-0000000000a2'),
            'read_close/none', 'a no-reply notice is read and closed; no reply date drives it');
SELECT t_eq((SELECT p2.plan_score < p1.plan_score
               FROM notice_plan p1, notice_plan p2
              WHERE p1.id = '10b00000-0000-0000-0000-0000000000a4' AND p2.id = '10b00000-0000-0000-0000-0000000000a3'), true,
            'an optional reply ranks below a required one due sooner');

-- ── Calendar and coverage ──────────────────────────────────────────────────
SELECT t_eq((SELECT count(*) FROM notice_calendar(ist_today() - 10, ist_today() + 10)
              WHERE notice_id = '10b00000-0000-0000-0000-0000000000a2' AND kind = 'reply'), 0::bigint,
            'no reply-due row for a no-reply notice');
SELECT t_eq((SELECT kind || '/' || source FROM notice_due_coverage() WHERE notice_id = '10b00000-0000-0000-0000-0000000000a2'),
            'informational/no reply needed for this notice type', 'coverage counts it as informational');

-- ── Command centre: the dashboard's types only; nav stays whole ────────────
SELECT t_eq((notices_command_centre(NULL) -> 'tiles' ->> 'open')::bigint,
            (SELECT count(*) FROM notice_facts WHERE is_open AND on_dashboard), 'open tile = open notices of the dashboard''s types');
SELECT t_eq((notices_command_centre(NULL) -> 'nav' ->> 'open')::bigint,
            (SELECT count(*) FROM notice_facts WHERE is_open), 'the top nav still counts every open notice');
SELECT t_eq((notices_command_centre(NULL) -> 'tiles' -> 'overdue' ->> 'count')::bigint,
            (SELECT count(*) FROM notice_facts WHERE is_overdue AND on_dashboard), 'overdue tile = its list with dash=1');
SELECT t_eq((notices_command_centre(NULL) -> 'tiles' -> 'due7' ->> 'count')::bigint,
            (SELECT count(*) FROM notice_facts WHERE is_due_in_7 AND on_dashboard), 'due-in-7 tile = its list with dash=1');
SELECT t_eq((notices_command_centre(NULL) -> 'plan_counts' ->> 'team')::bigint,
            (SELECT count(*) FROM notice_plan WHERE in_plan AND on_dashboard), 'plan count = the queue with dash=1');
SELECT t_eq((notices_command_centre(NULL) -> 'nav' ->> 'queue')::bigint,
            (SELECT count(*) FROM notice_plan WHERE in_plan), 'the queue in the top nav stays whole');
SELECT t_eq((notices_command_centre(NULL) -> 'dashboard' ->> 'hidden_open')::bigint,
            (SELECT count(*) FROM notice_facts WHERE is_open AND NOT on_dashboard), 'what is hidden is reported');
SELECT t_eq((notices_command_centre(NULL) -> 'dashboard' ->> 'hidden_types')::bigint,
            (SELECT count(*) FROM notice_type_settings WHERE NOT show_on_dashboard AND NOT hidden),
            'and how many types (those still in the lists; 20261008180000)');

-- Hiding a type moves its notices off the dashboard and nowhere else.
SELECT notice_type_set('ASMT-10', NULL, false, 'Partner');
SELECT t_eq((SELECT on_dashboard FROM notice_facts WHERE id = '10b00000-0000-0000-0000-0000000000a1'), false, 'hidden from the dashboard');
SELECT t_eq((SELECT is_overdue FROM notice_facts WHERE id = '10b00000-0000-0000-0000-0000000000a1'), true, 'still overdue in its list');
SELECT t_eq((notices_command_centre(NULL) -> 'tiles' -> 'overdue' ->> 'count')::bigint,
            (SELECT count(*) FROM notice_facts WHERE is_overdue AND on_dashboard), 'the overdue tile still equals its list');
SELECT t_eq((notices_command_centre(NULL) -> 'dashboard' ->> 'hidden_overdue')::bigint >= 1, true, 'and the hidden overdue one is reported');
ROLLBACK;
