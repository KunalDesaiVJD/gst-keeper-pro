-- A User ID several GSTINs share (two registrations of one PAN; it signs in
-- to either): asking with it is a request for each of them, a link to each
-- one with an e-mail and a staff request for each one without, each under its
-- own per-client limits. A GSTIN still names only its own client.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_user_id, client_password) VALUES
 ('c8000000-0000-0000-0000-000000000001', 'Pan Group Gujarat', '24AAAAA1111A1Z1', 'guj@pangroup.example', 'AAAAA1111A', 'x'),
 ('c8000000-0000-0000-0000-000000000002', 'Pan Group Maharashtra', '27AAAAA1111A1Z2', 'mah@pangroup.example', 'aaaaa1111a', 'x'),
 ('c8000000-0000-0000-0000-000000000003', 'Pan Group Delhi', '07AAAAA1111A1Z3', NULL, ' AAAAA1111A ', 'x'),
 ('c8000000-0000-0000-0000-000000000004', 'Someone Else', '24BBBBB2222B1Z4', 'else@example.com', 'BBBBB2222B', 'x');
CREATE TABLE public.t_answers (label text, answer jsonb);
GRANT ALL ON public.t_answers TO anon;

SET LOCAL ROLE anon;
INSERT INTO t_answers SELECT 'shared', client_password_reset_request('aaaaa1111a');
RESET ROLE;
SELECT t_eq((SELECT string_agg(c.gstin || '>' || r.sent_to, ', ' ORDER BY c.gstin) FROM client_password_resets r JOIN clients c ON c.id = r.client_id),
  '24AAAAA1111A1Z1>guj@pangroup.example, 27AAAAA1111A1Z2>mah@pangroup.example', 'a link to each client with an e-mail, at its own address');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8000000-0000-0000-0000-000000000003' AND status = 'pending'),
  1::bigint, 'a staff request for the one without');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id <> 'c8000000-0000-0000-0000-000000000003'), 0::bigint,
  'and none for the others');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c8000000-0000-0000-0000-000000000004'), 0::bigint,
  'nothing for a client with another User ID');
SELECT t_eq((SELECT count(*) FROM net.calls), 2::bigint, 'the mailer is woken for each link');
SELECT t_eq((SELECT count(DISTINCT request_id) || ' request, ' || string_agg(outcome, ',' ORDER BY outcome)
               FROM client_password_reset_attempts), '1 request, no_email,queued,queued', 'one request, a row per client');

-- Each under its own limits: asked again at once, both are refused (their
-- links are open); a minute later for one of them only, that one gets a new link.
SET LOCAL ROLE anon;
INSERT INTO t_answers SELECT 'shared again', client_password_reset_request('AAAAA1111A');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets), 2::bigint, 'no new links within the minute');
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes' WHERE client_id = 'c8000000-0000-0000-0000-000000000002';
SET LOCAL ROLE anon;
INSERT INTO t_answers SELECT 'shared, a minute on for one', client_password_reset_request('AAAAA1111A');
RESET ROLE;
SELECT t_eq((SELECT string_agg(c.gstin || '=' || n, ', ' ORDER BY c.gstin)
               FROM (SELECT client_id, count(*) AS n FROM client_password_resets GROUP BY client_id) x JOIN clients c ON c.id = x.client_id),
  '24AAAAA1111A1Z1=1, 27AAAAA1111A1Z2=2', 'only the client whose minute had passed got a new link');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c8000000-0000-0000-0000-000000000002' AND voided_at IS NULL),
  1::bigint, 'its older link voided');
SELECT t_eq((SELECT count(*) FROM password_reset_requests), 1::bigint, 'still one staff request in all');

-- A GSTIN names only its own client.
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SET LOCAL ROLE anon;
INSERT INTO t_answers SELECT 'one GSTIN', client_password_reset_request('24AAAAA1111A1Z1');
RESET ROLE;
SELECT t_eq((SELECT string_agg(c.gstin || '=' || n, ', ' ORDER BY c.gstin)
               FROM (SELECT client_id, count(*) AS n FROM client_password_resets GROUP BY client_id) x JOIN clients c ON c.id = x.client_id),
  '24AAAAA1111A1Z1=2, 27AAAAA1111A1Z2=2', 'the GSTIN asked for itself only');

-- Each link works for its own client: the e-mail tells it to sign in with the GSTIN.
SET LOCAL ROLE service_role;
SELECT token AS tm FROM client_password_reset_claim(10) WHERE gstin = '27AAAAA1111A1Z2' \gset
RESET ROLE;
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_complete(:'tm', 'Mahara#2026') ->> 'user_id', '27AAAAA1111A1Z2', 'the link sets that client''s password');
SELECT t_eq(t_login('27AAAAA1111A1Z2', 'Mahara#2026'), true, 'which works');
SELECT t_eq(t_login('24AAAAA1111A1Z1', 'Mahara#2026'), false, 'and not the other''s');
RESET ROLE;
SELECT t_eq((SELECT count(DISTINCT answer) FROM t_answers), 1::bigint, 'the same answer every time');
ROLLBACK;
