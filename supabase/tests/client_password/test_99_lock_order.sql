-- One lock order everywhere: the clients row, then the client's advisory
-- lock. An Edit Client save that changes the GSTIN (a key column: its update
-- holds the row FOR UPDATE) and the e-mail takes them in that order, its
-- trigger taking the advisory lock. Anything that took the advisory lock
-- first and then touched the row (every insert into a table with a foreign
-- key to clients does, FOR KEY SHARE) deadlocked with it. Now whatever waits
-- takes the row first, and the sweep and the claim, which never wait, skip a
-- client whose row or lock is busy.
--
-- Runs real concurrent sessions (dblink), so it commits its own rows and
-- removes them at the end. Named to run last.
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE FUNCTION pg_temp.t_cleanup() RETURNS void LANGUAGE sql AS $$
  DELETE FROM password_reset_requests WHERE user_id::text LIKE 'c9900000%';
  DELETE FROM client_password_reset_attempts WHERE client_id::text LIKE 'c9900000%';
  DELETE FROM clients WHERE id::text LIKE 'c9900000%';
  DELETE FROM user_roles WHERE user_id::text LIKE 'c9900000%';
  DELETE FROM profiles WHERE user_id::text LIKE 'c9900000%';
$$;
-- Waits until a session is blocked on a lock (up to 10 seconds).
CREATE FUNCTION pg_temp.t_wait_blocked(p_pid int, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  FOR i IN 1..200 LOOP
    IF cardinality(pg_blocking_pids(p_pid)) > 0 THEN RETURN; END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;
  RAISE EXCEPTION 'FAILED %: the session never waited on a lock', p_label;
END $$;
-- Runs p_sql in another session without waiting; its result is 'ok' or the error.
CREATE FUNCTION pg_temp.t_send(p_conn text, p_sql text) RETURNS void LANGUAGE sql AS $$
  SELECT dblink_send_query(p_conn, format('SELECT coalesce(t_error(%L), %L)', p_sql, 'ok'))
$$;
CREATE FUNCTION pg_temp.t_result(p_conn text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  SELECT r INTO v FROM dblink_get_result(p_conn) AS t(r text);
  PERFORM 1 FROM dblink_get_result(p_conn) AS t(r text);
  RETURN v;
END $$;
-- Runs p_sql in another session and waits for it: 'ok' or the error.
CREATE FUNCTION pg_temp.t_run(p_conn text, p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM dblink(p_conn, format('SELECT coalesce(t_error(%L), %L)', p_sql, 'ok')) AS t(r text)
$$;
CREATE FUNCTION pg_temp.t_key(p_client uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT hashtextextended('client_password_reset:' || p_client::text, 0)
$$;

SELECT pg_temp.t_cleanup();
SELECT dblink_connect(c, format('host=%s port=%s dbname=%s user=%s',
         COALESCE(NULLIF(split_part(current_setting('unix_socket_directories'), ',', 1), ''), 'localhost'),
         current_setting('port'), current_database(), current_user))
  FROM unnest(ARRAY['s1', 's2']) AS c;
SELECT dblink_exec(c, 'SET lock_timeout = ''5s''') FROM unnest(ARRAY['s1', 's2']) AS c;
SELECT pid AS s1pid FROM dblink('s1', 'SELECT pg_backend_pid()') AS t(pid int) \gset
SELECT pid AS s2pid FROM dblink('s2', 'SELECT pg_backend_pid()') AS t(pid int) \gset

INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c9900000-0000-0000-0000-000000000001', 'Race Co', '24AAACK9901A1Z1', 'old@race.example', 'x'),
 ('c9900000-0000-0000-0000-000000000002', 'Busy Sweep Co', '24AAACK9902A1Z2', 'acc@busysweep.example', 'x'),
 ('c9900000-0000-0000-0000-000000000003', 'Busy Claim Co', '24AAACK9903A1Z3', 'old@busyclaim.example', 'x'),
 ('c9900000-0000-0000-0000-000000000004', 'Order Mark Co', '24AAACK9904A1Z4', 'acc@ordermark.example', 'x'),
 ('c9900000-0000-0000-0000-000000000005', 'Order Staff Link Co', '24AAACK9905A1Z5', 'acc@orderstaff.example', 'x'),
 ('c9900000-0000-0000-0000-000000000006', 'Order Request Co', '24AAACK9906A1Z6', 'acc@orderrequest.example', 'x'),
 ('c9900000-0000-0000-0000-000000000007', 'Order Staff Request Co', '24AAACK9907A1Z7', 'acc@orderreq.example', 'x');
INSERT INTO user_roles (user_id, role) VALUES ('c9900000-0000-0000-0000-0000000000e1', 'employee');
INSERT INTO profiles (user_id, first_name) VALUES ('c9900000-0000-0000-0000-0000000000e1', 'Riya');

-- ── (a) A GSTIN + e-mail change while a request is half way ───────────────
-- The test session holds the links table so that the request (s2) stops
-- after taking its locks; then the Edit Client save (s1) starts; then the
-- links table is let go and both run on.
BEGIN;
LOCK TABLE client_password_resets IN ACCESS EXCLUSIVE MODE;
SELECT pg_temp.t_send('s2', $$SELECT client_password_reset_request('24AAACK9901A1Z1')$$);
SELECT pg_temp.t_wait_blocked(:s2pid, '(a) the request');
SELECT pg_temp.t_send('s1', $$UPDATE clients SET gstin = '24AAACK9911A1Z1', email = 'new@race.example'
                              WHERE id = 'c9900000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.t_wait_blocked(:s1pid, '(a) the Edit Client save');
COMMIT;
SELECT t_eq(pg_temp.t_result('s2'), 'ok', '(a) the request completes (no deadlock)');
SELECT t_eq(pg_temp.t_result('s1'), 'ok', '(a) the GSTIN and e-mail change completes (no deadlock)');
SELECT t_eq((SELECT gstin || ' ' || email FROM clients WHERE id = 'c9900000-0000-0000-0000-000000000001'),
  '24AAACK9911A1Z1 new@race.example', '(a) the change is saved');
SELECT t_eq((SELECT string_agg(void_reason, ',') FROM client_password_resets
              WHERE client_id = 'c9900000-0000-0000-0000-000000000001'),
  'the e-mail address changed', '(a) the link the request queued, to the old address, is voided');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9900000-0000-0000-0000-000000000001' AND status = 'pending'),
  1::bigint, '(a) and staff are asked instead');

-- ── (b) The sweep and the claim never wait on a busy client ───────────────
-- A lost link (claimed 16 minutes ago, never reported).
INSERT INTO client_password_resets (id, client_id, via, sent_to, email_hint, created_at, claimed_at, expires_at, token_hash) VALUES
 ('c9900000-0000-0000-0000-0000000000b2', 'c9900000-0000-0000-0000-000000000002', 'self', 'acc@busysweep.example',
  'a•••@busysweep.example', now() - interval '17 minutes', now() - interval '16 minutes', now() + interval '44 minutes',
  repeat('b2', 32));
-- A waiting link to an address changed in the same moment (no trigger saw it).
INSERT INTO client_password_resets (id, client_id, via, sent_to, email_hint, created_at) VALUES
 ('c9900000-0000-0000-0000-0000000000b3', 'c9900000-0000-0000-0000-000000000003', 'self', 'old@busyclaim.example',
  'o•••@busyclaim.example', now() - interval '1 minute');
ALTER TABLE clients DISABLE TRIGGER USER;
UPDATE clients SET email = 'new@busyclaim.example' WHERE id = 'c9900000-0000-0000-0000-000000000003';
ALTER TABLE clients ENABLE TRIGGER USER;

-- The row is held as an Edit Client save changing the GSTIN holds it, just
-- before its trigger asks for the client's lock.
BEGIN;
SELECT 1 FROM clients WHERE id = 'c9900000-0000-0000-0000-000000000002' FOR UPDATE;
SELECT t_eq(pg_temp.t_run('s2', 'SELECT client_password_reset_sweep()'), 'ok', '(b) the sweep does not wait on a busy client');
SELECT t_eq((SELECT voided_at IS NULL FROM client_password_resets WHERE id = 'c9900000-0000-0000-0000-0000000000b2'),
  true, '(b) it leaves that client to the next sweep');
ROLLBACK;
SELECT client_password_reset_sweep();
SELECT t_eq((SELECT voided_at IS NOT NULL FROM client_password_resets WHERE id = 'c9900000-0000-0000-0000-0000000000b2'),
  true, '(b) which reports the lost link');

BEGIN;
SELECT 1 FROM clients WHERE id = 'c9900000-0000-0000-0000-000000000003' FOR UPDATE;
SELECT t_eq(pg_temp.t_run('s2', 'SELECT count(*) FROM client_password_reset_claim(10)'), 'ok',
  '(b) the claim does not wait on a busy client');
SELECT t_eq((SELECT voided_at IS NULL AND token_hash IS NULL FROM client_password_resets
              WHERE id = 'c9900000-0000-0000-0000-0000000000b3'),
  true, '(b) it leaves that link to the next claim, with no token minted');
ROLLBACK;
SELECT count(*) FROM client_password_reset_claim(10);
SELECT t_eq((SELECT (token_hash IS NULL)::text || ' ' || void_reason FROM client_password_resets
              WHERE id = 'c9900000-0000-0000-0000-0000000000b3'),
  'true the e-mail address changed', '(b) which voids it, no token minted');

-- ── (c) Whatever waits takes the row before the client's lock ─────────────
-- While the row is held, each of these waits for it without holding the
-- client's advisory lock, so a save that holds the row can take it.
INSERT INTO client_password_resets (id, client_id, via, sent_to, email_hint, created_at, claimed_at, expires_at, token_hash) VALUES
 ('c9900000-0000-0000-0000-0000000000c4', 'c9900000-0000-0000-0000-000000000004', 'self', 'acc@ordermark.example',
  'a•••@ordermark.example', now(), now(), now() + interval '60 minutes', repeat('c4', 32));

BEGIN;
SELECT 1 FROM clients WHERE id = 'c9900000-0000-0000-0000-000000000004' FOR UPDATE;
SELECT pg_temp.t_send('s2', $$SELECT client_password_reset_mark('c9900000-0000-0000-0000-0000000000c4', NULL)$$);
SELECT pg_temp.t_wait_blocked(:s2pid, '(c) mark');
SELECT t_eq(pg_try_advisory_xact_lock(pg_temp.t_key('c9900000-0000-0000-0000-000000000004')), true,
  '(c) client_password_reset_mark waits for the row before taking the client''s lock');
ROLLBACK;
SELECT t_eq(pg_temp.t_result('s2'), 'ok', '(c) and then reports');

BEGIN;
SELECT 1 FROM clients WHERE id = 'c9900000-0000-0000-0000-000000000005' FOR UPDATE;
SELECT pg_temp.t_send('s2', $$SELECT staff_send_client_reset_link('c9900000-0000-0000-0000-0000000000e1',
                                                                 'c9900000-0000-0000-0000-000000000005')$$);
SELECT pg_temp.t_wait_blocked(:s2pid, '(c) staff link');
SELECT t_eq(pg_try_advisory_xact_lock(pg_temp.t_key('c9900000-0000-0000-0000-000000000005')), true,
  '(c) staff_send_client_reset_link waits for the row before taking the client''s lock');
ROLLBACK;
SELECT t_eq(pg_temp.t_result('s2'), 'ok', '(c) and then queues the link');

BEGIN;
SELECT 1 FROM clients WHERE id = 'c9900000-0000-0000-0000-000000000006' FOR UPDATE;
SELECT pg_temp.t_send('s2', $$SELECT client_password_reset_request('24AAACK9906A1Z6')$$);
SELECT pg_temp.t_wait_blocked(:s2pid, '(c) request');
SELECT t_eq(pg_try_advisory_xact_lock(pg_temp.t_key('c9900000-0000-0000-0000-000000000006')), true,
  '(c) client_password_reset_for_client waits for the row before taking the client''s lock');
ROLLBACK;
SELECT t_eq(pg_temp.t_result('s2'), 'ok', '(c) and then queues the link');

BEGIN;
SELECT 1 FROM clients WHERE id = 'c9900000-0000-0000-0000-000000000007' FOR UPDATE;
SELECT pg_temp.t_send('s2', $$SELECT client_password_staff_request('c9900000-0000-0000-0000-000000000007', 'test')$$);
SELECT pg_temp.t_wait_blocked(:s2pid, '(c) staff request');
SELECT t_eq(pg_try_advisory_xact_lock(pg_temp.t_key('c9900000-0000-0000-0000-000000000007')), true,
  '(c) client_password_staff_request waits for the row before taking the client''s lock');
ROLLBACK;
SELECT t_eq(pg_temp.t_result('s2'), 'ok', '(c) and then files the request');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id IN ('c9900000-0000-0000-0000-000000000005', 'c9900000-0000-0000-0000-000000000006',
                                'c9900000-0000-0000-0000-000000000007') AND status = 'pending'),
  1::bigint, '(c) every call did its work once it had the row');
SELECT t_eq((SELECT count(*) FROM client_password_resets
              WHERE client_id IN ('c9900000-0000-0000-0000-000000000005', 'c9900000-0000-0000-0000-000000000006')
                AND voided_at IS NULL),
  2::bigint, '(c) both links queued');

SELECT dblink_disconnect(c) FROM unnest(ARRAY['s1', 's2']) AS c;
SELECT pg_temp.t_cleanup();
