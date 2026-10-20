-- A request a limit refuses is never a silent drop: the client still hears
-- "a link is on its way", so either a link from a moment ago is still open
-- or staff get one pending request on the Dashboard. The per-address limit
-- counts an IPv6 address by its /64 block; the limit for all clients is 300
-- links an hour (the firm has about 130 clients), not 60.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c6000000-0000-0000-0000-000000000001', 'Busy Address Co', '24AAACA0001A1Z1', 'a@example.com', 'x'),
 ('c6000000-0000-0000-0000-000000000002', 'Cap One Co', '24AAACA0002A1Z2', 'b@example.com', 'x'),
 ('c6000000-0000-0000-0000-000000000003', 'Cap Two Co', '24AAACA0003A1Z3', 'c@example.com', 'x'),
 ('c6000000-0000-0000-0000-000000000004', 'Many Asks Co', '24AAACA0004A1Z4', 'd@example.com', 'x'),
 ('c6000000-0000-0000-0000-000000000005', 'Filler Co', '24AAACA0005A1Z5', 'e@example.com', 'x'),
 ('c6000000-0000-0000-0000-000000000006', 'Ipv6 Co', '24AAACA0006A1Z6', 'f@example.com', 'x');
CREATE TABLE public.t_answers (label text, answer jsonb);
GRANT ALL ON public.t_answers TO anon;

-- ── The per-address limit: refused, staff asked instead (once) ─────────────
SELECT set_config('request.headers', '{"cf-connecting-ip": "203.0.113.50"}', true);
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24ZZZZZ000' || g || 'Z1Z' || g) FROM generate_series(0, 9) g;
INSERT INTO t_answers SELECT 'address limited', client_password_reset_request('24AAACA0001A1Z1');
INSERT INTO t_answers SELECT 'address limited again', client_password_reset_request('24aaaca0001a1z1');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c6000000-0000-0000-0000-000000000001'), 0::bigint,
  'no link from a busy address');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c6000000-0000-0000-0000-000000000001' AND status = 'pending'),
  1::bigint, 'but one staff request, however often asked');
SELECT t_eq((SELECT string_agg(outcome, ',') FROM client_password_reset_attempts WHERE client_id = 'c6000000-0000-0000-0000-000000000001'),
  'staff_request,staff_request', 'each recorded as refused, staff asked');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c6000000-0000-0000-0000-000000000001' AND action = 'fallback_request'),
  'Asked for a reset link, but too many requests came from the same address this hour. A request is waiting on the Dashboard.',
  'the private log says why');

-- ── IPv6: the limit counts the /64 block, not each address ─────────────────
SELECT t_eq(client_password_ip_key('2001:db8:aa:bb:1:2:3:4'), '2001:db8:aa:bb::/64', 'an IPv6 address counts as its /64');
SELECT t_eq(client_password_ip_key('2001:DB8:AA:BB::FFFF'), '2001:db8:aa:bb::/64', 'any address in it, any spelling');
SELECT t_eq(client_password_ip_key('::ffff:203.0.113.50'), '203.0.113.50', 'an IPv4-mapped address counts as the IPv4 one');
SELECT t_eq(client_password_ip_key(' 203.0.113.50 '), '203.0.113.50', 'IPv4 as it is');
SELECT t_eq(client_password_ip_key('unknown'), 'unknown', 'anything else as written');
SELECT t_eq(client_password_ip_key(NULL), NULL::text, 'no address, no key');
SET LOCAL ROLE anon;
DO $$
BEGIN
  FOR g IN 1..10 LOOP
    PERFORM set_config('request.headers', json_build_object('cf-connecting-ip', '2001:db8:aa:bb::' || to_hex(g))::text, true);
    PERFORM client_password_reset_request('24YYYYY000' || (g % 10) || 'Y1Z' || (g % 10));
  END LOOP;
END $$;
SELECT set_config('request.headers', '{"cf-connecting-ip": "2001:db8:aa:bb:ffff:1:2:3"}', true);
INSERT INTO t_answers SELECT 'same /64', client_password_reset_request('24AAACA0006A1Z6');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c6000000-0000-0000-0000-000000000006'), 0::bigint,
  'ten addresses of one /64 are one address: the eleventh request is refused');
SELECT t_eq((SELECT ip || ' ' || outcome FROM client_password_reset_attempts WHERE client_id = 'c6000000-0000-0000-0000-000000000006'),
  '2001:db8:aa:bb::/64 staff_request', 'counted against the block; staff asked');
SELECT set_config('request.headers', '{"cf-connecting-ip": "2001:db8:aa:bc::1"}', true);
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACA0006A1Z6');
RESET ROLE;
SELECT t_eq((SELECT requested_ip FROM client_password_resets WHERE client_id = 'c6000000-0000-0000-0000-000000000006'),
  '2001:db8:aa:bc::1', 'the next /64 is not limited');
SELECT set_config('request.headers', '', true);

-- ── Per client: refused with a link still open, nothing more is needed; ───
-- with none open, staff are asked.
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACA0004A1Z4');
INSERT INTO t_answers SELECT 'again at once', client_password_reset_request('24AAACA0004A1Z4');
RESET ROLE;
SELECT t_eq((SELECT outcome FROM client_password_reset_attempts WHERE client_id = 'c6000000-0000-0000-0000-000000000004'
              ORDER BY outcome LIMIT 1), 'queued', 'the first asks queues a link');
SELECT t_eq((SELECT count(*) FROM client_password_reset_attempts WHERE client_id = 'c6000000-0000-0000-0000-000000000004'
              AND outcome = 'rate_limited'), 1::bigint, 'asking again at once is refused');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c6000000-0000-0000-0000-000000000004'), 0::bigint,
  'and needs no staff request: the link is on its way');
-- The e-mail fails (staff asked), and staff dismiss that request ...
SET LOCAL ROLE service_role;
SELECT reset_id AS r4 FROM client_password_reset_claim(10) WHERE client_id = 'c6000000-0000-0000-0000-000000000004' \gset
SELECT client_password_reset_mark(:'r4', 'sendMail 500');
RESET ROLE;
UPDATE password_reset_requests SET status = 'cancelled' WHERE user_id = 'c6000000-0000-0000-0000-000000000004';
-- ... the client asks again within the minute: refused, no link open, so staff are asked.
SET LOCAL ROLE anon;
INSERT INTO t_answers SELECT 'limited, nothing open', client_password_reset_request('24AAACA0004A1Z4');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c6000000-0000-0000-0000-000000000004'), 1::bigint,
  'still one link in the minute');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c6000000-0000-0000-0000-000000000004' AND status = 'pending'),
  1::bigint, 'a client refused with no open link gets a staff request');
SELECT t_eq((SELECT count(*) FROM client_password_reset_attempts WHERE client_id = 'c6000000-0000-0000-0000-000000000004'
              AND outcome = 'staff_request'), 1::bigint, 'recorded as refused, staff asked');

-- ── All clients: 300 links an hour; past it, staff asked instead (once) ────
INSERT INTO client_password_resets (client_id, via, sent_to, created_at, voided_at)
SELECT 'c6000000-0000-0000-0000-000000000005', 'self', 'e@example.com', now() - interval '30 minutes', now()
  FROM generate_series(1, 300 - (SELECT count(*) FROM client_password_resets WHERE created_at > now() - interval '1 hour')::int - 1);
SET LOCAL ROLE anon;
INSERT INTO t_answers SELECT 'the 300th', client_password_reset_request('24AAACA0002A1Z2');
INSERT INTO t_answers SELECT 'past 300', client_password_reset_request('24AAACA0003A1Z3');
INSERT INTO t_answers SELECT 'past 300 again', client_password_reset_request('24AAACA0003A1Z3');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE created_at > now() - interval '1 hour'), 300::bigint, 'three hundred links in the hour');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c6000000-0000-0000-0000-000000000002'), 1::bigint,
  'the 300th link goes (sixty is not the limit)');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c6000000-0000-0000-0000-000000000003'), 0::bigint,
  'past 300 an hour: no link');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c6000000-0000-0000-0000-000000000003' AND status = 'pending'),
  1::bigint, 'but one staff request, not two');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c6000000-0000-0000-0000-000000000003' AND action = 'fallback_request'),
  'Asked for a reset link, but the hourly limit for all clients was reached. A request is waiting on the Dashboard.', 'logged why');

-- Every client refused above has a link or a staff request.
SELECT t_eq((SELECT count(*) FROM clients c
              WHERE c.id::text LIKE 'c6000000%' AND c.id <> 'c6000000-0000-0000-0000-000000000005'
                AND NOT client_password_has_open_link(c.id)
                AND NOT EXISTS (SELECT 1 FROM password_reset_requests q WHERE q.user_id = c.id AND q.status = 'pending')),
  0::bigint, 'nobody who asked is left with neither a link nor a staff request');
SELECT t_eq((SELECT count(DISTINCT answer) FROM t_answers), 1::bigint, 'the same answer every time');
SELECT t_eq((SELECT answer FROM t_answers LIMIT 1), '{"ok": true}'::jsonb, 'which says nothing');
ROLLBACK;
