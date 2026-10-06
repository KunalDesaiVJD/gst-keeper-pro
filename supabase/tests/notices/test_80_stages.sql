-- One stage vocabulary (migration 20261006120000).
BEGIN;
INSERT INTO clients (id, name, gstin) VALUES ('80808080-0000-0000-0000-000000000001', 'Stage Works', '24SSSSS0000S1Z5');

INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number, staff_status) VALUES
 ('e8000000-0000-0000-0000-000000000001', '80808080-0000-0000-0000-000000000001', 'notices', 's1', 'Notice', 'ASMT-10 scrutiny', ist_today() - 5, ist_today() + 20, 's1', NULL),
 ('e8000000-0000-0000-0000-000000000002', '80808080-0000-0000-0000-000000000001', 'notices', 's2', 'Notice', 'DRC-01 SCN', ist_today() - 5, ist_today() + 20, 's2', 'Pending with officer'),
 ('e8000000-0000-0000-0000-000000000003', '80808080-0000-0000-0000-000000000001', 'notices', 's3', 'Notice', 'DRC-01 SCN', ist_today() - 5, ist_today() + 20, 's3', 'reply drafted'),
 ('e8000000-0000-0000-0000-000000000004', '80808080-0000-0000-0000-000000000001', 'notices', 's4', 'Notice', 'DRC-01 SCN', ist_today() - 5, ist_today() + 20, 's4', 'Withdrawn');

-- On insert: stage from the status; a stage spelling becomes its label, other wording is kept.
SELECT t_eq((SELECT string_agg(stage || '=' || coalesce(staff_status, '∅'), ',' ORDER BY portal_key) FROM gst_notices
              WHERE client_id = '80808080-0000-0000-0000-000000000001'),
            'new=∅,triaged=Pending with officer,draft=Draft,closed=Withdrawn', 'stage from the status on insert');
SELECT t_eq((SELECT count(*) FROM gst_notices WHERE client_id = '80808080-0000-0000-0000-000000000001' AND stage_changed_at IS NULL), 0::bigint,
            'every row knows when it entered its stage');

-- Setting the stage writes the status mirror and one stage_changed event, attributed to the person.
UPDATE gst_notices SET stage = 'evidence', edited_by_id = '80808080-0000-0000-0000-0000000000aa', edited_by_name = 'Riya', edited_at = now()
 WHERE id = 'e8000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT staff_status || '/' || stage_changed_by FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000001'),
            'Evidence/Riya', 'stage writes the status and who moved it');
SELECT t_eq((SELECT string_agg(event_type || ':' || (old_value->>'stage') || '>' || (new_value->>'stage'), ',') FROM notice_events
              WHERE notice_id = 'e8000000-0000-0000-0000-000000000001' AND source = 'staff'),
            'stage_changed:new>evidence', 'one stage_changed event, no duplicate status event');

-- Back to New clears the status (untriaged again — the sweep may close it).
UPDATE gst_notices SET stage = 'new', edited_at = now() + interval '1 second' WHERE id = 'e8000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT staff_status IS NULL FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000001'), true, 'New means no status');

-- A writer that sets only staff_status (the closing sweep, an older screen) moves the stage.
UPDATE gst_notices SET staff_status = 'Partner Review' WHERE id = 'e8000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT stage || '/' || staff_status FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000002'),
            'partner_review/Partner review', 'status-only write moves the stage');
SELECT set_config('app.actor_name', 'Closing sweep', true);
UPDATE gst_notices SET staff_status = 'Closed', close_reason = 'auto:accepted' WHERE id = 'e8000000-0000-0000-0000-000000000002';
SELECT set_config('app.actor_name', '', true);
SELECT t_eq((SELECT stage || '/' || stage_changed_by FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000002'),
            'closed/Closing sweep', 'sweep closure closes the stage');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'e8000000-0000-0000-0000-000000000002' AND event_type = 'closed'), 1::bigint,
            'one closed event');

-- Reopening clears the earlier close reason; closing over a closed variant keeps the variant.
UPDATE gst_notices SET stage = 'triaged', edited_at = now() WHERE id = 'e8000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT coalesce(close_reason, '∅') || '/' || staff_status FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000002'),
            '∅/Triaged', 'reopen clears the close reason');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'e8000000-0000-0000-0000-000000000002' AND event_type = 'reopened'), 1::bigint,
            'reopened event');
UPDATE gst_notices SET stage = 'closed', close_reason = 'Duplicate', edited_at = now() WHERE id = 'e8000000-0000-0000-0000-000000000004';
SELECT t_eq((SELECT staff_status FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000004'), 'Withdrawn', 'closed variant kept');

-- Facts move the stage forward when nobody set it in the same write.
UPDATE gst_notices SET assign_to_user_id = '80808080-0000-0000-0000-0000000000aa', assign_to = 'Riya'
 WHERE id = 'e8000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000001'), 'new', 'an automatic owner is not triage');
UPDATE gst_notices SET assign_to_user_id = NULL, assign_to = NULL WHERE id = 'e8000000-0000-0000-0000-000000000001';
UPDATE gst_notices SET assign_to_user_id = '80808080-0000-0000-0000-0000000000aa', assign_to = 'Riya',
       edited_by_name = 'Kunal', edited_at = now() + interval '2 seconds'
 WHERE id = 'e8000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000001'), 'triaged', 'a person setting the owner triages');
UPDATE gst_notices SET hearing_date = ist_today() + 10 WHERE id = 'e8000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000001'), 'triaged', 'a hearing before filing does not move the stage');
UPDATE gst_notices SET reply_date = ist_today(), reply_ref_number = 'R-80' WHERE id = 'e8000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT stage || '/' || staff_status FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000001'), 'filed/Filed', 'a reply files it');
UPDATE gst_notices SET hearing_date = ist_today() + 12 WHERE id = 'e8000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000001'), 'hearing', 'a hearing after filing');
UPDATE gst_notices SET order_date = ist_today(), order_number = 'O-80' WHERE id = 'e8000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000001'), 'order', 'an order');
UPDATE gst_notices SET reply_date = NULL WHERE id = 'e8000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000001'), 'order', 'never backwards');

-- An explicit stage in the same write wins over the facts.
UPDATE gst_notices SET stage = 'evidence', reply_date = ist_today(), edited_at = now() + interval '3 seconds'
 WHERE id = 'e8000000-0000-0000-0000-000000000003';
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e8000000-0000-0000-0000-000000000003'), 'evidence', 'explicit stage wins');

-- The canonical set carries the stage.
SELECT t_eq((SELECT stage_label || '/' || days_in_stage FROM notice_facts WHERE id = 'e8000000-0000-0000-0000-000000000003'),
            'Evidence/0', 'facts carry stage label and days in stage');
SELECT t_eq((SELECT is_open FROM notice_facts WHERE id = 'e8000000-0000-0000-0000-000000000004'), false, 'closed stage is not open');

-- Matters share the keys; status follows the stage and the reverse.
INSERT INTO litigation_matters (id, client_id, matter_no, status) VALUES
 ('e8000000-0000-0000-0000-0000000000b1', '80808080-0000-0000-0000-000000000001', 'M-80-1', 'Open'),
 ('e8000000-0000-0000-0000-0000000000b2', '80808080-0000-0000-0000-000000000001', 'M-80-2', 'Closed');
SELECT t_eq((SELECT string_agg(stage || '/' || status, ',' ORDER BY matter_no) FROM litigation_matters
              WHERE client_id = '80808080-0000-0000-0000-000000000001'),
            'new/Open,closed/Closed', 'matters start New; created closed is closed');
UPDATE litigation_matters SET stage = 'closed' WHERE id = 'e8000000-0000-0000-0000-0000000000b1';
SELECT t_eq((SELECT status || '/' || (closed_at IS NOT NULL)::text FROM litigation_matters WHERE id = 'e8000000-0000-0000-0000-0000000000b1'),
            'Closed/true', 'closing the stage closes the matter');
UPDATE litigation_matters SET status = 'Open' WHERE id = 'e8000000-0000-0000-0000-0000000000b1';
SELECT t_eq((SELECT stage || '/' || (closed_at IS NULL)::text FROM litigation_matters WHERE id = 'e8000000-0000-0000-0000-0000000000b1'),
            'triaged/true', 'reopening by status reopens the stage');
-- A client still on the old labels writes 'Reply drafting': stored as its key.
UPDATE litigation_matters SET stage = 'Reply drafting' WHERE id = 'e8000000-0000-0000-0000-0000000000b1';
SELECT t_eq((SELECT stage FROM litigation_matters WHERE id = 'e8000000-0000-0000-0000-0000000000b1'),
            'draft', 'an old matter stage label is stored as its key');
INSERT INTO matter_stage_history (matter_id, from_stage, to_stage)
VALUES ('e8000000-0000-0000-0000-0000000000b1', 'Triage', 'Reply drafting');
SELECT t_eq((SELECT from_stage || '>' || to_stage FROM matter_stage_history
              WHERE matter_id = 'e8000000-0000-0000-0000-0000000000b1' ORDER BY ctid DESC LIMIT 1),
            'triaged>draft', 'stage history stores keys');
DO $$
BEGIN
  UPDATE litigation_matters SET stage = 'Banana' WHERE id = 'e8000000-0000-0000-0000-0000000000b1';
  RAISE EXCEPTION 'FAILED an unknown stage was accepted';
EXCEPTION WHEN foreign_key_violation THEN NULL;
END;
$$;
ROLLBACK;
