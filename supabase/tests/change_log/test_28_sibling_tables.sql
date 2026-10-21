-- The GST tables the sibling migrations of 21 Oct 2026 make are logged too
-- (round 2 review), once they exist when the change log is applied (its
-- header: apply it last; attach skips a table that does not exist yet):
-- every return ever filed, a filed month's frozen figures (a GST Manager's
-- reopen deletes them), each list's carry, and the BU confirmation e-mails
-- (never their link's token). Writes as the sibling functions make them
-- (SECURITY DEFINER, here the owner), with the app's header.
SET search_path = public, extensions;

SELECT t_eq((SELECT string_agg(table_name || ':' || mode, ',' ORDER BY table_name) FROM gst_change_log_tables
              WHERE table_name IN ('twob_ever_filed', 'twob_filed_figures', 'twob_carry_log', 'builder_bu_confirm_requests',
                                   'builder_bu_confirm_answer_history', 'builder_bu_confirm_codes')),
            'builder_bu_confirm_answer_history:history,builder_bu_confirm_requests:full,twob_carry_log:full,twob_ever_filed:full,twob_filed_figures:full',
            'attached; the one-time codes (private) are not');

SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t28-file"}');
INSERT INTO twob_ever_filed (client_id, return_type, period_month) VALUES ('20000000-0000-0000-0000-000000000001', 'GSTR-3B', '07/2026');
INSERT INTO twob_filed_figures (client_id, period_month, reversal_igst, reclaim_cgst, reclaim_sgst, expense_out_igst, frozen_by)
VALUES ('20000000-0000-0000-0000-000000000001', '07/2026', 1800, 450, 450, 90, '10000000-0000-0000-0000-000000000002');
INSERT INTO twob_carry_log (client_id, period_month, list, next_period, carried_at, carried_how, carried_rows, last_outcome)
VALUES ('20000000-0000-0000-0000-000000000001', '07/2026', 'bills_not_in_2b', '08/2026', now(), 'carried', 12, 'carried');

-- A GST Manager reopens July (twob_reopen_filed): the frozen figures go.
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t28-reopen"}');
UPDATE twob_ever_filed SET reopened_at = now(), reopened_by = '10000000-0000-0000-0000-000000000002', reopen_reason = 'Marked Filed by mistake'
 WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026';
DELETE FROM twob_filed_figures WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026';
SELECT t_eq((SELECT string_agg(table_name || ':' || op || ':' || period_month || ':' || actor_name, ',' ORDER BY id)
               FROM gst_change_log WHERE request_id = 't28-reopen'),
            'twob_ever_filed:UPDATE:07/2026:Gita,twob_filed_figures:DELETE:07/2026:Gita', 'the reopen and the deleted figures, by Gita');
SELECT t_eq((SELECT (changed ->> 'reversal_igst') || ' ' || (changed ->> 'reclaim_cgst') || ' ' || (changed ->> 'expense_out_igst')
               FROM gst_change_log WHERE request_id = 't28-reopen' AND table_name = 'twob_filed_figures'),
            '1800 450 90', 'the frozen 4B(2), 5.4 and 4D(1.2) as they were, kept in the log');
SELECT t_eq((SELECT changed -> 'reopen_reason' ->> 'new' FROM gst_change_log WHERE request_id = 't28-reopen' AND table_name = 'twob_ever_filed'),
            'Marked Filed by mistake', 'and why');
SELECT t_eq((SELECT row_label FROM gst_change_log WHERE request_id = 't28-file' AND table_name = 'twob_carry_log'), 'bills_not_in_2b',
            'a carry is named by its list');

-- A BU confirmation e-mail: who it went to and which units, never the token.
INSERT INTO builder_projects (id, client_id, name) VALUES ('28000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Confirm Court');
INSERT INTO builder_units (id, project_id, unit_no) VALUES ('28000000-0000-0000-0000-000000000002', '28000000-0000-0000-0000-000000000001', 'C-1');
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app","x-gst-request":"t28-bu"}');
INSERT INTO builder_bu_confirm_requests (id, client_id, to_emails, unit_ids, created_by, token)
VALUES ('28000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '{buyer@example.com}',
        '{28000000-0000-0000-0000-000000000002}', '10000000-0000-0000-0000-000000000003', 'secret-link-token-28');
UPDATE builder_bu_confirm_requests SET sent_at = now(), token = 'secret-link-token-29' WHERE id = '28000000-0000-0000-0000-000000000003';
INSERT INTO builder_bu_confirm_answer_history (id, unit_id, status, dispute_notes, cleared_by)
VALUES ('28000000-0000-0000-0000-000000000004', '28000000-0000-0000-0000-000000000002', 'DISPUTED', 'Value differs', '10000000-0000-0000-0000-000000000003');
DELETE FROM builder_units WHERE id = '28000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT string_agg(table_name || ':' || op, ',' ORDER BY id) FROM gst_change_log WHERE request_id = 't28-bu'
              AND table_name LIKE 'builder_bu_confirm%'),
            'builder_bu_confirm_requests:INSERT,builder_bu_confirm_requests:UPDATE,builder_bu_confirm_answer_history:DELETE',
            'the e-mail sent, and the cleared answer kept whole when its unit went (its insert is its own record)');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE changed::text ~ 'secret-link-token')::int, 0, 'the link''s token never reaches the log');
SELECT t_eq((SELECT changed ->> 'to_emails' FROM gst_change_log WHERE request_id = 't28-bu' AND table_name = 'builder_bu_confirm_requests' AND op = 'INSERT'),
            '["buyer@example.com"]', 'who it went to');
SELECT t_eq((SELECT client_id::text || ' ' || (changed ->> 'dispute_notes') FROM gst_change_log WHERE request_id = 't28-bu'
              AND table_name = 'builder_bu_confirm_answer_history'),
            '20000000-0000-0000-0000-000000000001 Value differs', 'the answer with its client, though its unit went first');
SELECT t_request('anon', NULL);
