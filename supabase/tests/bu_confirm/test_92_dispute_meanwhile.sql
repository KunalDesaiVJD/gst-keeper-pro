-- A dispute given while the pop-up is open (round 2, defect: the send set the
-- unit back to PENDING and erased the note and who gave it, with no trace,
-- and the new e-mail asked again for the value the client said was wrong).
-- The pop-up sends the statuses it showed; a unit answered since, a dispute
-- included, is reported and nothing is written. A dispute staff do ask about
-- again is kept in the history.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['owner@client.test', 'accounts@client.test'], NULL) AS r1 \gset
SELECT :'r1'::jsonb ->> 'token' AS tok \gset
UPDATE email_outbox SET status = 'sent';
-- 1. Staff open the pop-up: A-101 pending.
SELECT t_seen(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[]) AS seen \gset
SELECT t_eq(:'seen'::jsonb -> 'a1000000-0000-0000-0000-000000000001' ->> 'status', 'PENDING', 'the pop-up shows A-101 pending');
-- 2. The owner disputes it.
SELECT t_eq(t_results(t_respond(:'tok', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'DISPUTE',
              'Revised to Rs 52,00,000 by supplementary deed of 1 Oct 2026')), 'Owner', 'owner@client.test')), 'A-101:DISPUTED', 'disputed');
-- 3. Staff press Send with A-101 ticked.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['accounts@client.test'], NULL, p_seen => :'seen'::jsonb) AS r2 \gset
SELECT t_eq((:'r2'::jsonb ->> 'sent')::boolean, false, 'not sent');
SELECT t_eq((SELECT (x ->> 'unit_no') || '/' || (x ->> 'status') || '/' || (x ->> 'dispute_notes') || '/' || (x ->> 'responded_by_name') || '/' || (x ->> 'responded_by_email')
               FROM jsonb_array_elements(:'r2'::jsonb -> 'already_answered') x),
            'A-101/DISPUTED/Revised to Rs 52,00,000 by supplementary deed of 1 Oct 2026/Owner/owner@client.test',
            'the dispute is reported, with its note and who gave it');
-- 4. Nothing was written: the dispute stands.
SELECT t_eq((SELECT status || '/' || dispute_notes || '/' || responded_by_email || '/' || (responded_at IS NOT NULL)
               FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'),
            'DISPUTED/Revised to Rs 52,00,000 by supplementary deed of 1 Oct 2026/owner@client.test/true', 'the dispute is kept');
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_requests)::int || '/' || (SELECT count(*) FROM email_outbox)::int, '1/1', 'no request, no e-mail');
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_answer_history)::int, 0, 'and nothing cleared');
SELECT t_eq(t_states(:'tok'), 'A-101:DISPUTED,A-102:PENDING', 'the link shows the dispute');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true, 'filing stays blocked');

-- A caller that sends no statuses never clears a dispute either.
SELECT t_eq((builder_bu_confirm_request_send('e1000000-0000-0000-0000-000000000001', ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[],
               ARRAY['owner@client.test'], NULL, '10000000-0000-0000-0000-000000000001', 'https://gst.vjdesai.com', 'S', '{{confirm_link}}', NULL)
             -> 'already_answered' -> 0 ->> 'status'), 'DISPUTED', 'no statuses sent: a disputed unit is reported');
SELECT t_eq((builder_bu_confirm_request_send('e1000000-0000-0000-0000-000000000001', ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[],
               ARRAY['owner@client.test'], NULL, '10000000-0000-0000-0000-000000000001', 'https://gst.vjdesai.com', 'S', '{{confirm_link}}', NULL,
               '{"a1000000-0000-0000-0000-000000000001": {"status": "DISPUTED", "responded_at": "not a time"}}')
             -> 'already_answered' -> 0 ->> 'status'), 'DISPUTED', 'a garbled status: reported');
-- A pending unit staff saw as pending goes, statuses sent or not.
SELECT t_eq((builder_bu_confirm_request_send('e1000000-0000-0000-0000-000000000001', ARRAY['a1000000-0000-0000-0000-000000000003']::uuid[],
               ARRAY['owner@client.test'], NULL, '10000000-0000-0000-0000-000000000001', 'https://gst.vjdesai.com', 'S', '{{confirm_link}}', NULL)
             ->> 'sent')::boolean, true, 'a unit never sent goes without statuses');

-- 5. Staff read the dispute (the pop-up reloads) and choose to ask again.
SELECT t_seen(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[]) AS seen2 \gset
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['accounts@client.test'], NULL,
              p_actor => '10000000-0000-0000-0000-000000000003', p_seen => :'seen2'::jsonb) AS r3 \gset
SELECT t_eq((:'r3'::jsonb ->> 'sent')::boolean, true, 'asked again on purpose');
SELECT t_eq((SELECT status || '/' || COALESCE(dispute_notes, '-') FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'),
            'PENDING/-', 'the unit is open again');
SELECT t_eq((SELECT h.status || '/' || h.dispute_notes || '/' || h.responded_by_name || '/' || h.responded_by_email || '/' || h.agreement_value
                    || '/' || (h.responded_at IS NOT NULL) || '/' || h.cleared_by || '/' || (h.cleared_by_request::text = :'r3'::jsonb ->> 'request_id')
                    || '/' || (h.request_id::text = :'r1'::jsonb ->> 'request_id')
               FROM builder_bu_confirm_answer_history h),
            'DISPUTED/Revised to Rs 52,00,000 by supplementary deed of 1 Oct 2026/Owner/owner@client.test/4500000/true/10000000-0000-0000-0000-000000000003/true/true',
            'who disputed and why survives in the history');
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_answer_history)::int, 1, 'readable with the public key (RLS open)');
ROLLBACK;
