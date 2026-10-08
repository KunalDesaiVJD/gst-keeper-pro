-- A notice type hidden everywhere (migration 20261008180000; the firm's request of
-- 7 October 2026 for GSTR-3A): in no list, count, search or e-mail, no reply needed,
-- kept on record, and back as it was when shown again.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, inactive_at_hand) VALUES
 ('10d00000-0000-0000-0000-000000000001', 'Hidden Type Traders', '24HIDDN0000H1Z5', 'hidden', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number) VALUES
 ('10d00000-0000-0000-0000-0000000000a1', '10d00000-0000-0000-0000-000000000001', 'notices', 'hd1', 'Notice',
  'Notice to return defaulter u/s 46 for not filing return', ist_today() - 300, ist_today() - 285, 'ZA-3A-HIDDEN-1'),
 ('10d00000-0000-0000-0000-0000000000a2', '10d00000-0000-0000-0000-000000000001', 'notices', 'hd2', 'Scrutiny Of Returns',
  'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', ist_today() - 3, ist_today() + 4, 'ZD-ASMT-SHOWN-1');

SELECT t_eq((SELECT form_code FROM gst_notices WHERE id = '10d00000-0000-0000-0000-0000000000a1'), 'GSTR-3A', 'fixture: the return defaulter notice is GSTR-3A');
SELECT t_eq((SELECT form_code FROM gst_notices WHERE id = '10d00000-0000-0000-0000-0000000000a2'), 'ASMT-10', 'fixture: ASMT-10');

-- ── GSTR-3A starts hidden ──────────────────────────────────────────────────
SELECT t_eq((SELECT response_need || '/' || show_on_dashboard || '/' || hidden FROM notice_type_settings WHERE form_code = 'GSTR-3A'),
            'none/false/true', 'GSTR-3A: hidden everywhere, no reply needed, off the dashboard');
SELECT t_eq(notice_type_hidden('GSTR-3A'), true, 'notice_type_hidden knows it');
SELECT t_eq(notice_type_hidden('ASMT-10') OR notice_type_hidden(NULL), false, 'other types and unclassified notices are not hidden');
DO $$ BEGIN
  UPDATE notice_type_settings SET hidden = true WHERE form_code = 'DRC-01';
  RAISE EXCEPTION 'a hidden type that needs a reply was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- ── Nowhere to be seen ─────────────────────────────────────────────────────
SELECT t_eq((SELECT count(*) FROM notice_facts WHERE client_id = '10d00000-0000-0000-0000-000000000001'), 1::bigint,
            'notice_facts leaves the hidden notice out');
SELECT t_eq((SELECT count(*) FROM notice_plan WHERE id = '10d00000-0000-0000-0000-0000000000a1'), 0::bigint, 'not in the plan');
SELECT t_eq((SELECT count(*) FROM notice_calendar(ist_today() - 400, ist_today() + 400) WHERE notice_id = '10d00000-0000-0000-0000-0000000000a1'),
            0::bigint, 'not on the calendar');
SELECT t_eq(jsonb_array_length(notices_search('ZA-3A-HIDDEN') -> 'notices'), 0, 'search never finds it');
SELECT t_eq(jsonb_array_length(notices_search('ZD-ASMT-SHOWN') -> 'notices'), 1, 'search still finds the others');
SELECT t_eq((SELECT (o.open_count >= 1 AND o.hidden)::text FROM notice_type_overview o WHERE o.form_code = 'GSTR-3A'), 'true',
            'the Notice types screen still counts it, marked hidden');
SELECT t_eq((SELECT count(*) FROM gst_notices WHERE id = '10d00000-0000-0000-0000-0000000000a1' AND deleted_at IS NULL), 1::bigint,
            'and it stays on record');

-- ── No reply and no e-mail ─────────────────────────────────────────────────
SELECT t_eq((SELECT count(*) FROM notice_reply_options WHERE notice_id = '10d00000-0000-0000-0000-0000000000a1' AND status = 'ready'), 0::bigint,
            'no reply options are drafted for it');
SELECT t_eq((SELECT bool_and(alert_processed_at IS NOT NULL) FROM notice_events WHERE notice_id = '10d00000-0000-0000-0000-0000000000a1'), true,
            'its capture is written already handled: no new notice e-mail');
SELECT t_eq((SELECT bool_and(alert_processed_at IS NULL) FROM notice_events WHERE notice_id = '10d00000-0000-0000-0000-0000000000a2'), true,
            'the ASMT-10 capture still waits for the alert run');

-- ── Command centre ─────────────────────────────────────────────────────────
INSERT INTO notice_events (notice_id, client_id, event_type, actor_name) VALUES
 ('10d00000-0000-0000-0000-0000000000a1', '10d00000-0000-0000-0000-000000000001', 'closed', 'Closing sweep'),
 ('10d00000-0000-0000-0000-0000000000a2', '10d00000-0000-0000-0000-000000000001', 'closed', 'Closing sweep');
SELECT t_eq((notices_command_centre() -> 'health' ->> 'auto_closed_today')::int, 1, 'auto-closed today counts what its list shows');
SELECT t_eq((notices_command_centre() -> 'dashboard' ->> 'hidden_types')::int,
            (SELECT count(*)::int FROM notice_type_settings WHERE NOT show_on_dashboard AND NOT hidden),
            '"types off the dashboard" are the ones still listed');

-- ── Saving a type ──────────────────────────────────────────────────────────
DO $$ BEGIN
  PERFORM notice_type_set('GSTR-3A', 'critical', NULL, 'Partner');
  RAISE EXCEPTION 'a reply need was set on a hidden type';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
DO $$ BEGIN
  PERFORM notice_type_set('GSTR-3A', NULL, true, 'Partner');
  RAISE EXCEPTION 'a hidden type was put on the dashboard';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
SELECT t_eq((notice_type_set('GSTR-3A', NULL, false, 'Partner', false) ->> 'hidden')::boolean, false, 'shown again (lists only)');
SELECT t_eq((SELECT response_need || '/' || on_dashboard FROM notice_facts WHERE id = '10d00000-0000-0000-0000-0000000000a1'),
            'none/false', 'it is back, as it was: no reply needed, off the dashboard');
INSERT INTO notice_events (notice_id, client_id, event_type, actor_name) VALUES
 ('10d00000-0000-0000-0000-0000000000a1', '10d00000-0000-0000-0000-000000000001', 'assigned', 'Partner');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = '10d00000-0000-0000-0000-0000000000a1' AND alert_processed_at IS NULL), 1::bigint,
            'a shown type''s events wait for the alert run again');
SELECT t_eq((notice_type_set('GSTR-3A', NULL, NULL, 'Partner', true) ->> 'show_on_dashboard')::boolean, false, 'hidden again');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = '10d00000-0000-0000-0000-0000000000a1' AND alert_processed_at IS NULL), 0::bigint,
            'hiding a type marks its waiting events handled');
SELECT t_eq((SELECT count(*) FROM notice_facts WHERE id = '10d00000-0000-0000-0000-0000000000a1'), 0::bigint, 'and it is gone again');

-- Hiding any type makes it quiet: ASMT-10 as an example.
SELECT t_eq((notice_type_set('ASMT-10', NULL, NULL, 'Partner', true) ->> 'response_need'), 'none', 'hiding a type sets its reply need to none');
SELECT t_eq((SELECT count(*) FROM reply_evidence_pending(100) WHERE notice_id = '10d00000-0000-0000-0000-0000000000a2'), 0::bigint,
            'no evidence is built in the background for a hidden type');
SELECT t_eq((SELECT count(*) FROM notice_facts WHERE client_id = '10d00000-0000-0000-0000-000000000001'), 0::bigint,
            'both hidden: the client has nothing listed');
SELECT t_eq((notice_type_set('ASMT-10', 'critical', true, 'Partner', false) ->> 'response_need'), 'critical',
            'shown again with its reply need and dashboard choice in one save');
SELECT t_eq((SELECT count(*) FROM reply_evidence_pending(100) WHERE notice_id = '10d00000-0000-0000-0000-0000000000a2'), 1::bigint,
            'and its evidence is built again');
ROLLBACK;
