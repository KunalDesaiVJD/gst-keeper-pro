-- Command centre, work queue, calendar and search (migration 20261006122000).
BEGIN;
INSERT INTO clients (id, name, gstin) VALUES ('95959595-0000-0000-0000-000000000001', 'Command Centre Mills', '24CCCMD0000C1Z5');

-- n1 overdue, unowned, ₹5 L · n2 due in 3 d, Draft · n3 review pending · n4 draft approved
-- n5 filed, hearing in 5 d · n6 order with an appeal clock · n7 closed · n8 new, no date · n9 filed, nothing pending
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number, case_id, amount_of_demand) VALUES
 ('e9500000-0000-0000-0000-000000000001', '95959595-0000-0000-0000-000000000001', 'notices', 'c1', 'Notice', 'ASMT-10 scrutiny of returns', ist_today() - 20, ist_today() - 3, 'ZD-CC-1', NULL, 500000),
 ('e9500000-0000-0000-0000-000000000002', '95959595-0000-0000-0000-000000000001', 'notices', 'c2', 'Notice', 'DRC-01C intimation', ist_today() - 4, ist_today() + 3, 'ZD-CC-2', NULL, 100000),
 ('e9500000-0000-0000-0000-000000000003', '95959595-0000-0000-0000-000000000001', 'notices', 'c3', 'Notice', 'ASMT-10 scrutiny', ist_today() - 10, ist_today() + 10, 'ZD-CC-3', NULL, NULL),
 ('e9500000-0000-0000-0000-000000000004', '95959595-0000-0000-0000-000000000001', 'notices', 'c4', 'Notice', 'ASMT-10 scrutiny', ist_today() - 10, ist_today() + 12, 'ZD-CC-4', NULL, NULL),
 ('e9500000-0000-0000-0000-000000000005', '95959595-0000-0000-0000-000000000001', 'notices', 'c5', 'Determination Of Tax', 'Show Cause Notice', ist_today() - 40, ist_today() - 10, NULL, 'AD-CC-5', 2000000),
 ('e9500000-0000-0000-0000-000000000006', '95959595-0000-0000-0000-000000000001', 'notices', 'c6', 'Notice', 'DRC-01 SCN', ist_today() - 90, ist_today() - 60, 'ZD-CC-6', NULL, 300000),
 ('e9500000-0000-0000-0000-000000000007', '95959595-0000-0000-0000-000000000001', 'notices', 'c7', 'Notice', 'ASMT-10 scrutiny', ist_today() - 90, ist_today() - 60, 'ZD-CC-7', NULL, 900000),
 ('e9500000-0000-0000-0000-000000000008', '95959595-0000-0000-0000-000000000001', 'notices', 'c8', 'Notice', 'Intimation', ist_today() - 1, NULL, 'ZD-CC-8', NULL, NULL),
 ('e9500000-0000-0000-0000-000000000009', '95959595-0000-0000-0000-000000000001', 'notices', 'c9', 'Notice', 'ASMT-10 scrutiny', ist_today() - 30, ist_today() - 5, 'ZD-CC-9', NULL, NULL);

-- Owners (U1 = 'Riya', U2 = 'Kunal') and stages, as staff edits.
UPDATE gst_notices SET assign_to_user_id = 'a1000000-0000-0000-0000-000000000001', assign_to = 'Riya', edited_by_name = 'Riya', edited_at = now()
 WHERE id IN ('e9500000-0000-0000-0000-000000000002', 'e9500000-0000-0000-0000-000000000003', 'e9500000-0000-0000-0000-000000000006', 'e9500000-0000-0000-0000-000000000009');
UPDATE gst_notices SET assign_to_user_id = 'a1000000-0000-0000-0000-000000000002', assign_to = 'Kunal', edited_by_name = 'Kunal', edited_at = now()
 WHERE id IN ('e9500000-0000-0000-0000-000000000004', 'e9500000-0000-0000-0000-000000000005', 'e9500000-0000-0000-0000-000000000007');
INSERT INTO notice_drafts (notice_id, version, body, author_name) VALUES
 ('e9500000-0000-0000-0000-000000000002', 1, 'v1', 'Riya'),
 ('e9500000-0000-0000-0000-000000000003', 1, 'v1', 'Riya'),
 ('e9500000-0000-0000-0000-000000000004', 1, 'v1', 'Kunal');
UPDATE notice_drafts SET status = 'in_review' WHERE notice_id IN ('e9500000-0000-0000-0000-000000000003', 'e9500000-0000-0000-0000-000000000004');
UPDATE notice_drafts SET status = 'approved', reviewed_by_name = 'Partner' WHERE notice_id = 'e9500000-0000-0000-0000-000000000004';
UPDATE gst_notices SET reply_date = ist_today() - 20, reply_ref_number = 'R5' WHERE id = 'e9500000-0000-0000-0000-000000000005';
UPDATE gst_notices SET hearing_date = ist_today() + 5, hearing_note = '11:30, Range III' WHERE id = 'e9500000-0000-0000-0000-000000000005';
UPDATE gst_notices SET reply_date = ist_today() - 70, order_date = ist_today() - 10, order_number = 'O6' WHERE id = 'e9500000-0000-0000-0000-000000000006';
UPDATE gst_notices SET stage = 'closed', close_reason = 'Dropped', edited_at = now() + interval '1 second' WHERE id = 'e9500000-0000-0000-0000-000000000007';
UPDATE gst_notices SET reply_date = ist_today() - 2 WHERE id = 'e9500000-0000-0000-0000-000000000009';
-- The DIN sits only inside a case-folder item of n5's case.
INSERT INTO gst_case_folder_items (client_id, case_id, folder_section, reference_number, portal_key, raw_json, attachments)
VALUES ('95959595-0000-0000-0000-000000000001', 'AD-CC-5', 'NOTCE', 'ZD-CC-5N', 'NOTCE:ZD-CC-5N', '{"din": "20261012ABCDEF"}', '[]');

SELECT t_eq((SELECT string_agg(portal_key || ':' || stage, ',' ORDER BY portal_key) FROM gst_notices WHERE client_id = '95959595-0000-0000-0000-000000000001'),
            'c1:new,c2:draft,c3:partner_review,c4:partner_review,c5:hearing,c6:order,c7:closed,c8:new,c9:filed', 'fixture stages');
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e9500000-0000-0000-0000-000000000005'), 'hearing', 'n5 at hearing');

-- One next action per open notice; nothing pending is out of the plan.
SELECT t_eq((SELECT string_agg(portal_key || '=' || next_action, ',' ORDER BY portal_key) FROM notice_plan),
            'c1=assign,c2=write_draft,c3=review_draft,c4=file_reply,c5=prepare_hearing,c6=decide_order,c8=assign,c9=await_order',
            'next actions');
SELECT t_eq((SELECT string_agg(portal_key, ',' ORDER BY portal_key) FROM notice_plan WHERE NOT in_plan), 'c9', 'awaiting the order is not work');
SELECT t_eq((SELECT plan_due_kind || ':' || (plan_due - ist_today()) FROM notice_plan WHERE portal_key = 'c5'), 'hearing:5', 'hearing drives a filed notice');
SELECT t_eq((SELECT plan_due_kind || ':' || (plan_due = (ist_today() - 10 + interval '3 months')::date)::text FROM notice_plan WHERE portal_key = 'c6'),
            'appeal:true', 'the appeal clock drives an order');
SELECT t_eq((SELECT portal_key FROM notice_plan WHERE in_plan ORDER BY plan_score DESC LIMIT 1), 'c1', 'the overdue ₹5 L notice ranks first');
SELECT t_eq((SELECT readiness_pct FROM notice_plan WHERE portal_key = 'c4'), 95, 'approved draft is 95% ready');

-- Every dashboard number equals the row count of the list it opens (the
-- lists the app opens are these same filters over the same views).
DO $$
DECLARE
  cc jsonb := public.notices_command_centre('a1000000-0000-0000-0000-000000000001');
  r jsonb;
BEGIN
  PERFORM t_eq((cc->'tiles'->>'open')::bigint, (SELECT count(*) FROM notice_facts WHERE is_open), 'open tile = list');
  PERFORM t_eq((cc->'tiles'->'overdue'->>'count')::bigint, (SELECT count(*) FROM notice_facts WHERE is_overdue), 'overdue tile = list');
  PERFORM t_eq((cc->'tiles'->'due7'->>'count')::bigint, (SELECT count(*) FROM notice_facts WHERE is_due_in_7), 'due-in-7 tile = list');
  PERFORM t_eq((cc->'tiles'->'new'->>'count')::bigint, (SELECT count(*) FROM notice_facts WHERE is_new), 'new tile = list');
  PERFORM t_eq((cc->'tiles'->>'unassigned')::bigint, (SELECT count(*) FROM notice_facts WHERE is_unassigned), 'unassigned tile = list');
  PERFORM t_eq((cc->'tiles'->'review'->>'count')::bigint, (SELECT count(*) FROM notice_facts WHERE is_open AND stage = 'partner_review'), 'review tile = list');
  PERFORM t_eq((cc->'tiles'->>'waiting_client')::bigint, (SELECT count(*) FROM notice_facts WHERE is_open AND stage = 'waiting_client'), 'waiting tile = list');
  PERFORM t_eq((cc->'tiles'->'exposure'->>'notices')::bigint, (SELECT count(*) FROM notice_facts WHERE is_open AND exposure_amount > 0), 'exposure notices = list');
  PERFORM t_eq((cc->'tiles'->'exposure'->>'notices_amount')::numeric, (SELECT sum(exposure_amount) FROM notice_facts WHERE is_open), 'exposure amount = list total');
  PERFORM t_eq((cc->'plan_counts'->>'team')::bigint, (SELECT count(*) FROM notice_plan WHERE in_plan), 'team queue = list');
  PERFORM t_eq((cc->'plan_counts'->>'mine')::bigint,
               (SELECT count(*) FROM notice_plan WHERE in_plan AND assign_to_user_id = 'a1000000-0000-0000-0000-000000000001'), 'my queue = list');
  PERFORM t_eq((cc->'plan_counts'->>'unassigned')::bigint, (SELECT count(*) FROM notice_plan WHERE in_plan AND assign_to_user_id IS NULL), 'unassigned queue = list');
  PERFORM t_eq((cc->'plan_counts'->>'review')::bigint, (SELECT count(*) FROM notice_plan WHERE in_plan AND next_action = 'review_draft'), 'review queue = list');
  FOR r IN SELECT * FROM jsonb_array_elements(cc->'pipeline') LOOP
    PERFORM t_eq((r->>'count')::bigint, (SELECT count(*) FROM notice_facts WHERE is_open AND stage = r->>'stage'), 'pipeline ' || (r->>'stage') || ' = list');
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(cc->'next14') LOOP
    PERFORM t_eq((r->>'total')::bigint, (SELECT count(*) FROM notice_calendar((r->>'date')::date, (r->>'date')::date)), 'day ' || (r->>'date') || ' = list');
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(cc->'clients') LOOP
    PERFORM t_eq((r->>'open')::bigint, (SELECT count(*) FROM notice_facts WHERE client_id = (r->>'client_id')::uuid AND is_open), 'client open = list');
    PERFORM t_eq((r->>'overdue')::bigint, (SELECT count(*) FROM notice_facts WHERE client_id = (r->>'client_id')::uuid AND is_overdue), 'client overdue = list');
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(cc->'exposure_by_stage') LOOP
    PERFORM t_eq((r->>'notices')::numeric, (SELECT coalesce(sum(exposure_amount), 0) FROM notice_facts WHERE is_open AND stage = r->>'stage'), 'exposure ' || (r->>'stage') || ' = list');
  END LOOP;
  PERFORM t_eq((cc->'nav'->>'queue')::bigint, (SELECT count(*) FROM notice_plan WHERE in_plan), 'queue tab = list');
  PERFORM t_eq((cc->'nav'->>'open')::bigint, (SELECT count(*) FROM notice_facts WHERE is_open), 'all-notices tab = list');
  PERFORM t_eq((cc->'nav'->>'hearings')::bigint, (SELECT count(*) FROM notice_hearings_upcoming(NULL)), 'hearings tab = list');
  PERFORM t_eq((cc->'nav'->>'hearings')::int, 1, 'fixture: one upcoming hearing');
  -- The fixture itself, so a broken definition cannot pass by agreeing with itself.
  PERFORM t_eq((cc->'tiles'->>'open')::int, 8, 'fixture: 8 open');
  PERFORM t_eq((cc->'tiles'->'overdue'->>'count')::int, 1, 'fixture: 1 overdue (n1; n5, n6, n9 replied)');
  PERFORM t_eq((cc->'plan_counts'->>'team')::int, 7, 'fixture: 7 to work');
  PERFORM t_eq((cc->'plan_counts'->>'mine')::int, 3, 'fixture: Riya has 3');
  PERFORM t_eq((cc->'tiles'->'review'->>'approved')::int, 1, 'fixture: 1 approved draft');
  PERFORM t_eq((SELECT (e->>'hearing')::int FROM jsonb_array_elements(cc->'next14') e WHERE (e->>'date')::date = ist_today() + 5), 1, 'fixture: hearing in 5 days');
  PERFORM t_eq((SELECT (e->>'reply')::int FROM jsonb_array_elements(cc->'next14') e WHERE (e->>'date')::date = ist_today() + 3), 1, 'fixture: reply due in 3 days');
END;
$$;

-- Ctrl K.
SELECT t_eq((SELECT public.notices_search('zd-cc-2')->'notices'->0->>'id'), 'e9500000-0000-0000-0000-000000000002', 'reference finds its notice first');
SELECT t_eq((SELECT public.notices_search('24CCCMD')->'clients'->0->>'open'), '8', 'GSTIN finds the client with its open count');
SELECT t_eq((SELECT public.notices_search('20261012ABCD')->'notices'->0->>'matched_on'), 'folder', 'a DIN inside the case folder finds the notice');
SELECT t_eq((SELECT public.notices_search('AD-CC-5')->'notices'->0->>'matched_on'), 'case', 'case ID / ARN');
SELECT t_eq((SELECT jsonb_array_length(public.notices_search('z')->'notices')), 0, 'one character searches nothing');
ROLLBACK;
