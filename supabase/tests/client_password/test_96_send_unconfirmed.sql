-- A link the mailer claimed but whose send it could not report (the e-mail
-- may well have gone: the report back failed) is voided after 15 minutes,
-- and nothing says it was never sent: the log and the staff request say the
-- send could not be confirmed. The mailer retries the report
-- (supabase/functions/client-password-reset/mark.ts), so a report may arrive
-- twice: the first one stands and a repeat changes nothing.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c9600000-0000-0000-0000-000000000001', 'Unconfirmed Send Co', '24AAACS9601A1Z1', 'acc@unconfirmed.example', 'x'),
 ('c9600000-0000-0000-0000-000000000002', 'Twice Reported Co', '24AAACS9602A1Z2', 'acc@twice.example', 'x'),
 ('c9600000-0000-0000-0000-000000000003', 'Twice Failed Co', '24AAACS9603A1Z3', 'acc@failed.example', 'x');

-- ── (1) Claimed, never reported: the send could not be confirmed. ─────────
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACS9601A1Z1'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r1 FROM client_password_reset_claim(10) WHERE client_id = 'c9600000-0000-0000-0000-000000000001' \gset
RESET ROLE;
UPDATE client_password_resets SET claimed_at = claimed_at - interval '16 minutes', created_at = created_at - interval '16 minutes'
 WHERE id = :'r1';
SET LOCAL ROLE service_role; SELECT client_password_reset_sweep(); RESET ROLE;
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE id = :'r1'), 'the send could not be confirmed',
  '(1) voided: the send could not be confirmed');
SELECT t_eq((SELECT detail FROM client_password_log
              WHERE client_id = 'c9600000-0000-0000-0000-000000000001' AND action = 'link_failed'),
  'The send of the reset link to a•••@unconfirmed.example could not be confirmed within 15 minutes, so the link was voided.',
  '(1) the log does not say it was never sent');
SELECT t_eq((SELECT detail FROM client_password_log
              WHERE client_id = 'c9600000-0000-0000-0000-000000000001' AND action = 'fallback_request'),
  'The send of the reset link could not be confirmed. A request is waiting on the Dashboard.',
  '(1) nor does the reason staff were asked');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9600000-0000-0000-0000-000000000001' AND status = 'pending'), 1::bigint,
  '(1) staff asked');
-- The report arrives late (the e-mail did go): recorded, the link stays void.
SET LOCAL ROLE service_role; SELECT client_password_reset_mark(:'r1', NULL); RESET ROLE;
SELECT t_eq((SELECT detail FROM client_password_log
              WHERE client_id = 'c9600000-0000-0000-0000-000000000001' AND action = 'link_sent'),
  'Reset link e-mailed to a•••@unconfirmed.example. It was already void (the send could not be confirmed), so it does not work.',
  '(1) a late report is recorded, and says the link does not work');

-- ── (2) A report repeated by the mailer's retry changes nothing. ──────────
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACS9602A1Z2'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r2 FROM client_password_reset_claim(10) WHERE client_id = 'c9600000-0000-0000-0000-000000000002' \gset
SELECT client_password_reset_mark(:'r2', NULL);
RESET ROLE;
SELECT sent_at AS sent2 FROM client_password_resets WHERE id = :'r2' \gset
SET LOCAL ROLE service_role; SELECT client_password_reset_mark(:'r2', NULL); RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c9600000-0000-0000-0000-000000000002' AND action = 'link_sent'), 1::bigint,
  '(2) one link_sent row, however often it is reported');
SELECT t_eq((SELECT sent_at FROM client_password_resets WHERE id = :'r2'), :'sent2'::timestamptz,
  '(2) the first report stands');

-- And a failure reported twice: one log row, one staff request.
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACS9603A1Z3'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r3 FROM client_password_reset_claim(10) WHERE client_id = 'c9600000-0000-0000-0000-000000000003' \gset
SELECT client_password_reset_mark(:'r3', 'graph 503');
SELECT client_password_reset_mark(:'r3', 'graph 503');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c9600000-0000-0000-0000-000000000003' AND action = 'link_failed'), 1::bigint,
  '(2) one link_failed row for a repeated failure');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9600000-0000-0000-0000-000000000003'), 1::bigint,
  '(2) and one staff request');
ROLLBACK;
