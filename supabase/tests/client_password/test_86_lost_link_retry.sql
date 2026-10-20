-- A client's own retry never voids a lost link unreported. With the mailer
-- down (nothing claims), a link not claimed within 15 minutes is lost; the
-- next request for that client logs it and asks staff before queuing a new
-- link, so staff hear of it even if nobody else ever asks. A staff link that
-- was lost is reported the same way, and staff sending a link over a lost
-- one log it without asking themselves.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c8600000-0000-0000-0000-000000000001', 'Retry Co', '24AAACR8601A1Z1', 'r@example.com', 'x'),
 ('c8600000-0000-0000-0000-000000000002', 'Staff Then Retry Co', '24AAACR8602A1Z2', 's@example.com', 'x'),
 ('c8600000-0000-0000-0000-000000000003', 'Quick Retry Co', '24AAACR8603A1Z3', 'q@example.com', 'x'),
 ('c8600000-0000-0000-0000-000000000004', 'Staff Over Lost Co', '24AAACR8604A1Z4', 'o@example.com', 'x');
INSERT INTO user_roles (user_id, role) VALUES ('c8600000-0000-0000-0000-0000000000aa', 'employee');
INSERT INTO profiles (user_id, first_name) VALUES ('c8600000-0000-0000-0000-0000000000aa', 'Asha');
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.86"}', true);

-- ── 1. Asks, the link is never claimed, asks again 70 minutes later ─────────
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACR8601A1Z1');
RESET ROLE;
UPDATE client_password_resets SET created_at = created_at - interval '70 minutes'
 WHERE client_id = 'c8600000-0000-0000-0000-000000000001';
UPDATE client_password_reset_attempts SET at = at - interval '70 minutes';
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_request('24AAACR8601A1Z1'), '{"ok": true}'::jsonb, 'the same answer');
RESET ROLE;
SELECT t_eq((SELECT string_agg(COALESCE(void_reason, 'open'), ' | ' ORDER BY created_at) FROM client_password_resets
              WHERE client_id = 'c8600000-0000-0000-0000-000000000001'),
  'not sent in time | open', 'the lost link is given up as lost, not as "a newer link", and a new one waits');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c8600000-0000-0000-0000-000000000001' AND status = 'pending'),
  1::bigint, 'staff get one request');
SELECT t_eq((SELECT detail FROM client_password_log
              WHERE client_id = 'c8600000-0000-0000-0000-000000000001' AND action = 'link_failed'),
  'The reset link for r•••@example.com was not sent within 15 minutes, so it was given up.', 'link_failed logged');
SELECT t_eq((SELECT outcome FROM client_password_reset_attempts
              WHERE client_id = 'c8600000-0000-0000-0000-000000000001' ORDER BY at DESC LIMIT 1),
  'queued', 'and the retry still queues a link');

-- Asks again, more than an hour apart each time, the mailer still down:
-- every lost link is logged, staff are asked once.
DO $$
BEGIN
  FOR i IN 1..2 LOOP
    UPDATE client_password_resets SET created_at = created_at - interval '70 minutes'
     WHERE client_id = 'c8600000-0000-0000-0000-000000000001';
    UPDATE client_password_reset_attempts SET at = at - interval '70 minutes';
    PERFORM client_password_reset_request('24AAACR8601A1Z1');
  END LOOP;
END $$;
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c8600000-0000-0000-0000-000000000001' AND action = 'link_failed'),
  3::bigint, 'three lost links, three log rows');
SELECT t_eq((SELECT count(*) FROM client_password_resets
              WHERE client_id = 'c8600000-0000-0000-0000-000000000001' AND void_reason = 'a newer link was asked for'),
  0::bigint, 'none voided unreported');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c8600000-0000-0000-0000-000000000001' AND status = 'pending'),
  1::bigint, 'still one request for staff');

-- ── 2. A request on the Dashboard; staff e-mail a link (that closes it); ────
-- the link is never claimed; the client asks again 70 minutes later.
SELECT client_password_staff_request('c8600000-0000-0000-0000-000000000002', 'no e-mail at the time');
SET LOCAL ROLE anon;
SELECT staff_send_client_reset_link('c8600000-0000-0000-0000-0000000000aa', 'c8600000-0000-0000-0000-000000000002');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c8600000-0000-0000-0000-000000000002' AND status = 'pending'),
  0::bigint, 'staff sending a link closes the request');
UPDATE client_password_resets SET created_at = created_at - interval '70 minutes'
 WHERE client_id = 'c8600000-0000-0000-0000-000000000002';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACR8602A1Z2');
RESET ROLE;
SELECT t_eq((SELECT string_agg(via || ':' || COALESCE(void_reason, 'open'), ' | ' ORDER BY created_at) FROM client_password_resets
              WHERE client_id = 'c8600000-0000-0000-0000-000000000002'),
  'staff:not sent in time | self:open', 'the lost staff link is reported');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c8600000-0000-0000-0000-000000000002' AND status = 'pending'),
  1::bigint, 'staff are asked again');
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c8600000-0000-0000-0000-000000000002' AND action = 'link_failed'),
  1::bigint, 'and it is logged');

-- ── 3. Lost after 15 minutes, not an hour (a working mailer claims in ──────
-- seconds): a retry 16 minutes on, refused by no limit, reports it.
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACR8603A1Z3');
RESET ROLE;
UPDATE client_password_resets SET created_at = created_at - interval '14 minutes'
 WHERE client_id = 'c8600000-0000-0000-0000-000000000003';
SELECT t_eq(client_password_has_open_link('c8600000-0000-0000-0000-000000000003'), true, '14 minutes: still on its way');
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes'
 WHERE client_id = 'c8600000-0000-0000-0000-000000000003';
SELECT t_eq(client_password_has_open_link('c8600000-0000-0000-0000-000000000003'), false, '16 minutes: not on its way');
SET LOCAL ROLE service_role;
SELECT t_eq((SELECT count(*) FROM client_password_reset_claim(10) WHERE client_id = 'c8600000-0000-0000-0000-000000000003'),
  0::bigint, 'and never sent late');
RESET ROLE;
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE client_id = 'c8600000-0000-0000-0000-000000000003'),
  'not sent in time', 'the claim gave it up');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c8600000-0000-0000-0000-000000000003' AND status = 'pending'),
  1::bigint, 'staff asked');

-- ── 4. Staff send a link over a lost one: logged as lost, no request filed ──
-- for staff themselves.
INSERT INTO client_password_resets (client_id, via, sent_to, email_hint, created_at)
VALUES ('c8600000-0000-0000-0000-000000000004', 'self', 'o@example.com', 'o•••@example.com', now() - interval '20 minutes');
SET LOCAL ROLE anon;
SELECT staff_send_client_reset_link('c8600000-0000-0000-0000-0000000000aa', 'c8600000-0000-0000-0000-000000000004');
RESET ROLE;
SELECT t_eq((SELECT string_agg(via || ':' || COALESCE(void_reason, 'open'), ' | ' ORDER BY created_at) FROM client_password_resets
              WHERE client_id = 'c8600000-0000-0000-0000-000000000004'),
  'self:not sent in time | staff:open', 'the lost link is logged as lost');
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c8600000-0000-0000-0000-000000000004' AND action = 'link_failed'),
  1::bigint, 'link_failed logged');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8600000-0000-0000-0000-000000000004'),
  0::bigint, 'no request: staff are acting');
ROLLBACK;
