-- The per-address limit (ten requests an hour) and the all-clients limit (300
-- links an hour) are hard limits, whatever arrives at once. Each count reads
-- only committed rows, and the per-client locks serialize only one client's
-- requests, so requests for different clients in flight together each
-- counted without the others and all got through (about one per PostgREST
-- connection). Now every request and every staff link takes the limits lock
-- first and holds it to commit; nothing else takes it, and nothing takes it
-- while holding a client's row or lock.
--
-- Runs real concurrent sessions (dblink), as anon requests from the gateway,
-- so it commits its own rows and removes them at the end (test_99 runs after
-- it and needs the hour's link count low again).
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE FUNCTION pg_temp.t_cleanup() RETURNS void LANGUAGE sql AS $$
  DELETE FROM password_reset_requests WHERE user_id::text LIKE 'c9800000%';
  DELETE FROM client_password_reset_attempts
   WHERE client_id::text LIKE 'c9800000%' OR ip IN ('203.0.113.98', '198.51.100.98');
  DELETE FROM clients WHERE id::text LIKE 'c9800000%';
  DELETE FROM user_roles WHERE user_id::text LIKE 'c9800000%';
  DELETE FROM profiles WHERE user_id::text LIKE 'c9800000%';
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
CREATE FUNCTION pg_temp.t_hour_links() RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM client_password_resets WHERE created_at > now() - interval '1 hour'
$$;
CREATE FUNCTION pg_temp.t_key(p_client uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT hashtextextended('client_password_reset:' || p_client::text, 0)
$$;

SELECT pg_temp.t_cleanup();
SELECT dblink_connect(c, format('host=%s port=%s dbname=%s user=%s',
         COALESCE(NULLIF(split_part(current_setting('unix_socket_directories'), ',', 1), ''), 'localhost'),
         current_setting('port'), current_database(), current_user))
  FROM unnest(ARRAY['s1', 's2', 's3']) AS c;
SELECT dblink_exec(c, 'SET lock_timeout = ''5s''') FROM unnest(ARRAY['s1', 's2', 's3']) AS c;
SELECT pid AS s1pid FROM dblink('s1', 'SELECT pg_backend_pid()') AS t(pid int) \gset
SELECT pid AS s2pid FROM dblink('s2', 'SELECT pg_backend_pid()') AS t(pid int) \gset
SELECT pid AS s3pid FROM dblink('s3', 'SELECT pg_backend_pid()') AS t(pid int) \gset
-- Each session is an anon PostgREST request.
SELECT dblink_exec(c, 'SET ROLE anon') FROM unnest(ARRAY['s1', 's2', 's3']) AS c;

INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c9800000-0000-0000-0000-000000000001', 'Address One Co', '24AAACT9801A1Z1', 'acc@one.example', 'x'),
 ('c9800000-0000-0000-0000-000000000002', 'Address Two Co', '24AAACT9802A1Z2', 'acc@two.example', 'x'),
 ('c9800000-0000-0000-0000-000000000003', 'Address Three Co', '24AAACT9803A1Z3', 'acc@three.example', 'x'),
 ('c9800000-0000-0000-0000-000000000004', 'Cap Request Co', '24AAACT9804A1Z4', 'acc@caprequest.example', 'x'),
 ('c9800000-0000-0000-0000-000000000005', 'Cap Staff One Co', '24AAACT9805A1Z5', 'acc@capstaff1.example', 'x'),
 ('c9800000-0000-0000-0000-000000000006', 'Cap Staff Two Co', '24AAACT9806A1Z6', 'acc@capstaff2.example', 'x'),
 ('c9800000-0000-0000-0000-000000000007', 'Order Request Co', '24AAACT9807A1Z7', 'acc@orderreq.example', 'x'),
 ('c9800000-0000-0000-0000-000000000008', 'Order Staff Co', '24AAACT9808A1Z8', 'acc@orderstaff.example', 'x'),
 ('c9800000-0000-0000-0000-0000000000ff', 'Filler Co', '24AAACT9899A1Z9', 'f@filler.example', 'x');
INSERT INTO user_roles (user_id, role) VALUES ('c9800000-0000-0000-0000-0000000000e1', 'employee');
INSERT INTO profiles (user_id, first_name) VALUES ('c9800000-0000-0000-0000-0000000000e1', 'Riya');

-- ── (a) Per address: nine requests this hour, three more at once ──────────
INSERT INTO client_password_reset_attempts (ip, outcome, at)
SELECT '203.0.113.98', 'no_client', now() - interval '10 minutes' FROM generate_series(1, 9);
SELECT dblink_exec(c, $$SET request.headers = '{"x-real-ip": "203.0.113.98"}'$$) FROM unnest(ARRAY['s1', 's2', 's3']) AS c;
-- The test session holds the log, so a request that queues a link stops just
-- before it commits (after both counts); the next ones are sent once it is
-- waiting there.
BEGIN;
LOCK TABLE client_password_log IN ACCESS EXCLUSIVE MODE;
SELECT pg_temp.t_send('s1', $$SELECT client_password_reset_request('24AAACT9801A1Z1')$$);
SELECT pg_temp.t_wait_blocked(:s1pid, '(a) the first request');
SELECT pg_temp.t_send('s2', $$SELECT client_password_reset_request('24AAACT9802A1Z2')$$);
SELECT pg_temp.t_wait_blocked(:s2pid, '(a) the second request');
SELECT pg_temp.t_send('s3', $$SELECT client_password_reset_request('24AAACT9803A1Z3')$$);
SELECT pg_temp.t_wait_blocked(:s3pid, '(a) the third request');
COMMIT;
SELECT t_eq(pg_temp.t_result('s1') || ' ' || pg_temp.t_result('s2') || ' ' || pg_temp.t_result('s3'), 'ok ok ok',
  '(a) all three requests complete');
SELECT t_eq((SELECT count(DISTINCT request_id) FROM client_password_reset_attempts
              WHERE ip = '203.0.113.98' AND at > now() - interval '1 hour'),
  12::bigint, '(a) twelve requests from the address this hour');
SELECT t_eq((SELECT string_agg(outcome, ',' ORDER BY client_id) FROM client_password_reset_attempts
              WHERE client_id::text LIKE 'c9800000-0000-0000-0000-00000000000_' AND ip = '203.0.113.98'),
  'queued,staff_request,staff_request', '(a) only the tenth gets a link; the two after it are refused (staff asked)');
SELECT t_eq((SELECT count(*) FROM client_password_resets
              WHERE client_id IN ('c9800000-0000-0000-0000-000000000001', 'c9800000-0000-0000-0000-000000000002',
                                  'c9800000-0000-0000-0000-000000000003')),
  1::bigint, '(a) one link made');

-- ── (b) All clients: 299 links this hour, three more at once ──────────────
-- A client's request (from another address) and two staff links.
INSERT INTO client_password_resets (client_id, via, sent_to, created_at, claimed_at, sent_at, expires_at, token_hash)
SELECT 'c9800000-0000-0000-0000-0000000000ff', 'self', 'f@filler.example', now() - interval '30 minutes',
       now() - interval '30 minutes', now() - interval '30 minutes', now() + interval '30 minutes',
       md5('t98a' || i) || md5('t98b' || i)
  FROM generate_series(1, 299 - pg_temp.t_hour_links()) i;
SELECT t_eq(pg_temp.t_hour_links(), 299::bigint, '(b) 299 links this hour');
SELECT dblink_exec('s1', $$SET request.headers = '{"x-real-ip": "198.51.100.98"}'$$);
BEGIN;
LOCK TABLE client_password_log IN ACCESS EXCLUSIVE MODE;
SELECT pg_temp.t_send('s1', $$SELECT client_password_reset_request('24AAACT9804A1Z4')$$);
SELECT pg_temp.t_wait_blocked(:s1pid, '(b) the request');
SELECT pg_temp.t_send('s2', $$SELECT staff_send_client_reset_link('c9800000-0000-0000-0000-0000000000e1',
                                                                 'c9800000-0000-0000-0000-000000000005')$$);
SELECT pg_temp.t_wait_blocked(:s2pid, '(b) the first staff link');
SELECT pg_temp.t_send('s3', $$SELECT staff_send_client_reset_link('c9800000-0000-0000-0000-0000000000e1',
                                                                 'c9800000-0000-0000-0000-000000000006')$$);
SELECT pg_temp.t_wait_blocked(:s3pid, '(b) the second staff link');
COMMIT;
SELECT t_eq(pg_temp.t_result('s1'), 'ok', '(b) the request completes');
SELECT t_eq(pg_temp.t_result('s2'), 'Too many reset links were asked for in the last hour. Set a password instead.',
  '(b) the first staff link after it is refused');
SELECT t_eq(pg_temp.t_result('s3'), 'Too many reset links were asked for in the last hour. Set a password instead.',
  '(b) and the second');
SELECT t_eq(pg_temp.t_hour_links(), 300::bigint, '(b) 300 links this hour, not more');
SELECT t_eq((SELECT outcome FROM client_password_reset_attempts WHERE client_id = 'c9800000-0000-0000-0000-000000000004'),
  'queued', '(b) the request got the 300th');

-- ── (c) The limits lock comes before any client's row or lock ─────────────
-- While the test session holds it, a request and a staff link wait for it
-- holding nothing of their client's.
DELETE FROM client_password_resets WHERE client_id = 'c9800000-0000-0000-0000-0000000000ff';
BEGIN;
SELECT client_password_reset_limits_lock();
SELECT pg_temp.t_send('s2', $$SELECT client_password_reset_request('24AAACT9807A1Z7')$$);
SELECT pg_temp.t_wait_blocked(:s2pid, '(c) the request');
SELECT pg_temp.t_send('s3', $$SELECT staff_send_client_reset_link('c9800000-0000-0000-0000-0000000000e1',
                                                                 'c9800000-0000-0000-0000-000000000008')$$);
SELECT pg_temp.t_wait_blocked(:s3pid, '(c) the staff link');
SELECT t_eq(t_error($$SELECT 1 FROM clients WHERE id IN ('c9800000-0000-0000-0000-000000000007',
                                                        'c9800000-0000-0000-0000-000000000008') FOR UPDATE NOWAIT$$),
  NULL::text, '(c) neither holds its client''s row while it waits');
SELECT t_eq(pg_try_advisory_xact_lock(pg_temp.t_key('c9800000-0000-0000-0000-000000000007'))
            AND pg_try_advisory_xact_lock(pg_temp.t_key('c9800000-0000-0000-0000-000000000008')),
  true, '(c) nor its client''s lock');
ROLLBACK;
SELECT t_eq(pg_temp.t_result('s2') || ' ' || pg_temp.t_result('s3'), 'ok ok', '(c) both then run');

-- ── (d) Nothing else takes it ──────────────────────────────────────────────
-- The sweep, the claim, the mailer's report, an e-mail change and a staff
-- password run while it is held (a wait would hit the 5 s lock_timeout).
SELECT dblink_exec('s1', 'RESET ROLE');
BEGIN;
SELECT client_password_reset_limits_lock();
SELECT t_eq(pg_temp.t_run('s1', 'SELECT client_password_reset_tick()'), 'ok', '(d) the cron tick does not wait for it');
SELECT t_eq(pg_temp.t_run('s1', 'SELECT count(*) FROM client_password_reset_claim(50)'), 'ok', '(d) nor the claim');
SELECT t_eq(pg_temp.t_run('s1', $$SELECT client_password_reset_mark(r.id, NULL) FROM client_password_resets r
                                   WHERE r.client_id = 'c9800000-0000-0000-0000-000000000004'$$), 'ok',
  '(d) nor the mailer''s report');
SELECT t_eq(pg_temp.t_run('s1', $$UPDATE clients SET email = 'new@one.example'
                                   WHERE id = 'c9800000-0000-0000-0000-000000000001'$$), 'ok',
  '(d) nor an e-mail change');
SELECT t_eq(pg_temp.t_run('s1', $$SELECT staff_set_client_password('c9800000-0000-0000-0000-0000000000e1',
                                   'c9800000-0000-0000-0000-000000000002', 'Staff#20266')$$), 'ok',
  '(d) nor a staff password');
ROLLBACK;

SELECT dblink_disconnect(c) FROM unnest(ARRAY['s1', 's2', 's3']) AS c;
SELECT pg_temp.t_cleanup();
