-- The notice workspace's data (migration 20261006121000).
BEGIN;
INSERT INTO clients (id, name, gstin, email) VALUES
 ('90909090-0000-0000-0000-000000000001', 'Work Space Pvt Ltd', '24WWWWW0000W1Z5', 'accounts@workspace.test'),
 ('90909090-0000-0000-0000-000000000002', 'No Mail Traders', '24NNNNN0000N1Z5', NULL);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number, amount_of_demand) VALUES
 ('e9000000-0000-0000-0000-000000000001', '90909090-0000-0000-0000-000000000001', 'notices', 'w1', 'Notice', 'ASMT-10 scrutiny', ist_today() - 5, ist_today() + 20, 'ZD-W1', 482690),
 ('e9000000-0000-0000-0000-000000000002', '90909090-0000-0000-0000-000000000002', 'notices', 'w2', 'Notice', 'DRC-01 SCN', ist_today() - 5, ist_today() + 20, 'ZD-W2', NULL);

-- Issues: logged; explained never exceeds the amount.
INSERT INTO notice_issues (notice_id, seq, title, amount, explained_amount, status, created_by_name) VALUES
 ('e9000000-0000-0000-0000-000000000001', 1, 'ITC in GSTR-3B exceeds GSTR-2B', 342180, 342180, 'explained', 'Riya'),
 ('e9000000-0000-0000-0000-000000000001', 2, 'Interest on delayed payment', 43860, 0, 'pay', 'Riya');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'e9000000-0000-0000-0000-000000000001'
              AND event_type = 'issue_added' AND actor_name = 'Riya'), 2::bigint, 'issues logged with the person');
DO $$
BEGIN
  INSERT INTO notice_issues (notice_id, title, amount, explained_amount) VALUES ('e9000000-0000-0000-0000-000000000001', 'Bad', 10, 20);
  RAISE EXCEPTION 'FAILED explained above the amount was accepted';
EXCEPTION WHEN check_violation THEN NULL;
END;
$$;
UPDATE notice_issues SET status = 'contest', updated_by_name = 'Kunal' WHERE seq = 2 AND notice_id = 'e9000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT actor_name || ':' || (old_value->>'status') || '>' || (new_value->>'status') FROM notice_events
              WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND event_type = 'issue_updated'),
            'Kunal:pay>contest', 'issue change logged with old and new');

-- Asking the client moves the notice to Waiting on client.
INSERT INTO notice_doc_requests (notice_id, item, due_date, requested_by_name) VALUES
 ('e9000000-0000-0000-0000-000000000001', 'Purchase register Q4', ist_today() + 5, 'Riya'),
 ('e9000000-0000-0000-0000-000000000001', 'Bank statement March', NULL, 'Riya');
SELECT t_eq((SELECT stage || '/' || stage_changed_by FROM gst_notices WHERE id = 'e9000000-0000-0000-0000-000000000001'),
            'waiting_client/Riya', 'documents requested → waiting on client');

-- The e-mail to the client: a preview while alerts are in preview; once a minute.
SELECT t_eq((SELECT (public.notice_request_documents_send('e9000000-0000-0000-0000-000000000001', NULL, 'Riya'))->>'sent'), 'true', 'request e-mailed');
SELECT t_eq((SELECT status || '|' || to_email FROM email_outbox WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND template_key = 'notice_client_docs'),
            'preview|accounts@workspace.test', 'client e-mail is a preview');
SELECT t_eq((SELECT body LIKE '%Purchase register Q4%' AND body LIKE '%Bank statement March%' FROM email_outbox
              WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND template_key = 'notice_client_docs'), true, 'e-mail lists the open items');
SELECT t_eq((SELECT (public.notice_request_documents_send('e9000000-0000-0000-0000-000000000001', NULL, 'Riya', true))->>'sent'), 'false', 'a second click in the same minute sends nothing');
SELECT t_eq((SELECT public.notice_request_documents_send('e9000000-0000-0000-0000-000000000002', NULL, 'Riya')->>'reason'), 'nothing_open', 'nothing to ask');
INSERT INTO notice_doc_requests (notice_id, item) VALUES ('e9000000-0000-0000-0000-000000000002', 'Ledger');
SELECT t_eq((SELECT public.notice_request_documents_send('e9000000-0000-0000-0000-000000000002', NULL, 'Riya')->>'reason'), 'no_client_email', 'no client e-mail on file');

-- The last open request received → Evidence.
UPDATE notice_doc_requests SET status = 'received', resolved_by_name = 'Riya', resolved_at = now()
 WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND item = 'Purchase register Q4';
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e9000000-0000-0000-0000-000000000001'), 'waiting_client', 'still waiting on one');
UPDATE notice_doc_requests SET status = 'waived', resolved_by_name = 'Riya', resolved_at = now()
 WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND item = 'Bank statement March';
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e9000000-0000-0000-0000-000000000001'), 'evidence', 'all in → evidence');

-- Drafts: v1 → Draft; review → Partner review; changes → Draft; v2 supersedes; approval keeps Partner review.
INSERT INTO notice_drafts (notice_id, version, body, author_name) VALUES ('e9000000-0000-0000-0000-000000000001', 1, 'Reply v1', 'Riya');
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e9000000-0000-0000-0000-000000000001'), 'draft', 'first draft → draft');
UPDATE notice_drafts SET status = 'in_review' WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND version = 1;
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e9000000-0000-0000-0000-000000000001'), 'partner_review', 'sent for review');
UPDATE notice_drafts SET status = 'changes_requested', review_note = 'Cite the 2B months', reviewed_by_name = 'Partner'
 WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND version = 1;
SELECT t_eq((SELECT stage || '/' || stage_changed_by FROM gst_notices WHERE id = 'e9000000-0000-0000-0000-000000000001'),
            'draft/Partner', 'changes requested → back to draft, by the partner');
INSERT INTO notice_drafts (notice_id, version, body, author_name) VALUES ('e9000000-0000-0000-0000-000000000001', 2, 'Reply v2', 'Riya');
SELECT t_eq((SELECT string_agg(version || ':' || status, ',' ORDER BY version) FROM notice_drafts WHERE notice_id = 'e9000000-0000-0000-0000-000000000001'),
            '1:superseded,2:draft', 'a new version supersedes the open one');
UPDATE notice_drafts SET status = 'in_review' WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND version = 2;
UPDATE notice_drafts SET status = 'approved', reviewed_by_name = 'Partner', reviewed_at = now()
 WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND version = 2;
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e9000000-0000-0000-0000-000000000001'), 'partner_review', 'approved waits to be filed');
-- (one transaction here, so the events share a timestamp: compared as a set)
SELECT t_eq((SELECT string_agg(event_type, ',' ORDER BY event_type) FROM notice_events
              WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND event_type LIKE 'draft%'),
            'draft_approved,draft_changes_requested,draft_saved,draft_saved,draft_sent_for_review,draft_sent_for_review', 'draft history logged');

-- Payments and uploads on the notice.
INSERT INTO notice_payments (notice_id, kind, drc03_arn, amount, paid_on, created_by_name)
VALUES ('e9000000-0000-0000-0000-000000000001', 'drc03', 'AD-DRC-1', 43860, ist_today(), 'Riya');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND event_type = 'payment_linked'), 1::bigint, 'payment linked');
INSERT INTO matter_documents (notice_id, kind, title, storage_path, source, uploaded_by_name)
VALUES ('e9000000-0000-0000-0000-000000000001', 'evidence', 'Purchase register Q4.xlsx', 'notices/x/uploads/y.xlsx', 'upload', 'Riya');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'e9000000-0000-0000-0000-000000000001' AND event_type = 'document_added'), 1::bigint, 'upload logged');
DO $$
BEGIN
  INSERT INTO matter_documents (kind, title, storage_path, source) VALUES ('evidence', 'Orphan', 'x', 'upload');
  RAISE EXCEPTION 'FAILED a document with neither notice nor matter was accepted';
EXCEPTION WHEN check_violation THEN NULL;
END;
$$;
ROLLBACK;
