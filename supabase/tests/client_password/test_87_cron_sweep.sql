-- Lost links are found whatever the traffic: pg_cron runs
-- client_password_reset_tick every 5 minutes, which sweeps (a link claimed
-- by a mailer that died, or never claimed at all, is voided and staff are
-- asked) and wakes the mailer again while a link is still waiting.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c8700000-0000-0000-0000-000000000001', 'Quiet Co', '24AAACQ8701A1Z1', 'quiet@example.com', 'x'),
 ('c8700000-0000-0000-0000-000000000002', 'Never Woken Co', '24AAACQ8702A1Z2', 'never@example.com', 'x'),
 ('c8700000-0000-0000-0000-000000000003', 'Waiting Co', '24AAACQ8703A1Z3', 'wait@example.com', 'x');

-- The job exists, every 5 minutes, and runs the tick.
SELECT t_eq((SELECT count(*) FROM cron.job WHERE jobname = 'client-password-reset-sweep'), 1::bigint, 'the job is scheduled once');
SELECT t_eq((SELECT schedule FROM cron.job WHERE jobname = 'client-password-reset-sweep'), '3-59/5 * * * *', 'every 5 minutes');
SELECT t_eq((SELECT command FROM cron.job WHERE jobname = 'client-password-reset-sweep'),
  'select public.client_password_reset_tick()', 'it runs the tick');
SELECT t_eq(has_function_privilege('anon', 'public.client_password_reset_tick()', 'EXECUTE'), false, 'anon cannot run the tick');
SELECT t_eq(has_function_privilege('anon', 'public.client_password_reset_sweep_client(uuid, boolean)', 'EXECUTE'), false,
  'or sweep one client');

-- (a) The mailer claims a link and dies before reporting; nobody asks again.
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACQ8701A1Z1');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS ra FROM client_password_reset_claim(10) \gset
RESET ROLE;
-- (b) A link the mailer never picks up (not woken, or down); nobody asks again.
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACQ8702A1Z2');
RESET ROLE;
-- Three hours on, with no request and no claim in between.
UPDATE client_password_resets SET created_at = created_at - interval '3 hours',
       claimed_at = claimed_at - interval '3 hours', expires_at = expires_at - interval '3 hours';
SELECT t_eq((SELECT count(*) FROM password_reset_requests), 0::bigint, 'nothing reported before the job runs');

-- The job runs as pg_cron would run it.
DELETE FROM net.calls;
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'client-password-reset-sweep'); END $$;
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE id = :'ra'), 'claimed but not sent', '(a) voided');
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE client_id = 'c8700000-0000-0000-0000-000000000002'),
  'not sent in time', '(b) given up');
SELECT t_eq((SELECT string_agg(c.gstin, ',' ORDER BY c.gstin) FROM password_reset_requests q JOIN clients c ON c.id = q.user_id
              WHERE q.status = 'pending'), '24AAACQ8701A1Z1,24AAACQ8702A1Z2', 'staff asked for each');
SELECT t_eq((SELECT count(*) FROM client_password_log WHERE action = 'link_failed'), 2::bigint, 'both logged');
SELECT t_eq((SELECT count(*) FROM net.calls), 0::bigint, 'nothing waiting: the mailer is not woken');

-- Run again: nothing new.
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'client-password-reset-sweep'); END $$;
SELECT t_eq((SELECT count(*) FROM password_reset_requests), 2::bigint, 'no second request');

-- (c) A link waiting a few minutes (its wake-up lost): the tick wakes the
-- mailer again and leaves the link alone.
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACQ8703A1Z3');
RESET ROLE;
UPDATE client_password_resets SET created_at = created_at - interval '6 minutes'
 WHERE client_id = 'c8700000-0000-0000-0000-000000000003';
DELETE FROM net.calls;
SELECT t_eq(client_password_reset_tick(), 0, 'nothing lost');
SELECT t_eq((SELECT count(*) FROM net.calls WHERE url LIKE '%/functions/v1/client-password-reset'), 1::bigint, 'the mailer is woken again');
SELECT t_eq(client_password_has_open_link('c8700000-0000-0000-0000-000000000003'), true, 'the link is still on its way');
SET LOCAL ROLE service_role;
SELECT t_eq((SELECT count(*) FROM client_password_reset_claim(10) WHERE client_id = 'c8700000-0000-0000-0000-000000000003'),
  1::bigint, 'and can still be sent');
RESET ROLE;
ROLLBACK;
