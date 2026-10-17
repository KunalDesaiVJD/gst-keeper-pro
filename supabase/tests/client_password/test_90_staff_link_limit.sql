-- staff_send_client_reset_link trusts the actor id (the app-wide trust model,
-- and user_roles is readable), so the limits bind every link whoever asked:
-- five an hour per client, the client's own and staff links together, and
-- 300 an hour in all. Staff get a clear error; setting a password still works.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c9000000-0000-0000-0000-000000000001', 'Target Co', '24AAACT0001A1Z1', 't@example.com', 'x'),
 ('c9000000-0000-0000-0000-000000000002', 'Other Co', '24AAACT0002A1Z2', 'o@example.com', 'x'),
 ('c9000000-0000-0000-0000-000000000003', 'Filler Co', '24AAACT0003A1Z3', 'f@example.com', 'x');
INSERT INTO user_roles (user_id, role) VALUES ('a9000000-0000-0000-0000-00000000000c', 'employee');
INSERT INTO profiles (user_id, first_name) VALUES ('a9000000-0000-0000-0000-00000000000c', 'Junior');

-- Two of the client's own links in the hour ...
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACT0001A1Z1');
RESET ROLE;
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACT0001A1Z1');
RESET ROLE;
-- ... then staff links: three more make five, the sixth is refused.
DO $$
BEGIN
  FOR g IN 3..5 LOOP
    UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
    SET LOCAL ROLE anon;
    PERFORM t_eq(staff_send_client_reset_link('a9000000-0000-0000-0000-00000000000c', 'c9000000-0000-0000-0000-000000000001') ->> 'queued',
      'true', 'link ' || g || ' (a staff one)');
    RESET ROLE;
  END LOOP;
END $$;
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SET LOCAL ROLE anon;
SELECT t_eq(t_error($$SELECT staff_send_client_reset_link('a9000000-0000-0000-0000-00000000000c', 'c9000000-0000-0000-0000-000000000001')$$),
  'Five reset links went to this client in the last hour. Set a password instead.', 'the sixth in the hour is refused, with a clear error');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c9000000-0000-0000-0000-000000000001'), 5::bigint,
  'five links in the hour, no more');
SELECT t_eq((SELECT count(*) FROM net.calls), 5::bigint, 'five e-mails, no more');
-- The client's own third request is refused too (five in all), and needs
-- nothing more: the newest link is open.
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACT0001A1Z1');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c9000000-0000-0000-0000-000000000001'), 5::bigint,
  'the client cannot add a sixth either');
SELECT t_eq((SELECT string_agg(outcome, ',' ORDER BY outcome) FROM client_password_reset_attempts), 'queued,queued,rate_limited',
  'refused, a link being open');
SELECT t_eq((SELECT count(*) FROM password_reset_requests), 0::bigint, 'so no staff request');
-- Setting a password is never limited.
SET LOCAL ROLE anon;
SELECT t_eq(staff_set_client_password('a9000000-0000-0000-0000-00000000000c', 'c9000000-0000-0000-0000-000000000001', 'Staff#20266'),
  true, 'staff can still set a password');
RESET ROLE;
-- An hour later, links go again.
UPDATE client_password_resets SET created_at = created_at - interval '1 hour';
SET LOCAL ROLE anon;
SELECT t_eq(staff_send_client_reset_link('a9000000-0000-0000-0000-00000000000c', 'c9000000-0000-0000-0000-000000000001') ->> 'queued',
  'true', 'an hour later');
RESET ROLE;

-- 300 links an hour in all, staff ones too.
INSERT INTO client_password_resets (client_id, via, sent_to, created_at, voided_at)
SELECT 'c9000000-0000-0000-0000-000000000003', 'staff', 'f@example.com', now() - interval '10 minutes', now()
  FROM generate_series(1, 300 - (SELECT count(*) FROM client_password_resets WHERE created_at > now() - interval '1 hour')::int);
SET LOCAL ROLE anon;
SELECT t_eq(t_error($$SELECT staff_send_client_reset_link('a9000000-0000-0000-0000-00000000000c', 'c9000000-0000-0000-0000-000000000002')$$),
  'Too many reset links went out in the last hour. Set a password instead.', 'past 300 an hour in all');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c9000000-0000-0000-0000-000000000002'), 0::bigint, 'nothing queued');
ROLLBACK;
