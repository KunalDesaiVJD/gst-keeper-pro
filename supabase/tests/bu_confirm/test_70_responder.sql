-- Who may answer (round 1, defect: answers taken on trust). Only an address
-- the e-mail went to (To or CC) answers; the firm's own addresses never do;
-- a request needs an address outside the firm. A staff member without the
-- override permission cannot clear units by sending a request to themselves.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

-- The employee (post_bu_event, not override_bu_agreement) may not accept a value.
SELECT t_raises($$SELECT builder_bu_agreement_override('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
                   '10000000-0000-0000-0000-000000000003', 'client is slow to reply')$$,
                'not allowed to accept', 'no override permission');

-- Nor send a request only to the firm: the firm's domain, any staff member's
-- profile address (in any case), or a mix of them.
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['junior@vjdesai.com'], NULL,
                                 '10000000-0000-0000-0000-000000000003')$$, 'outside the firm', 'To the firm''s domain only');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['jay.junior@gmail.test'], ARRAY['gst@Accounts.VJDesai.com'],
                                 '10000000-0000-0000-0000-000000000003')$$, 'outside the firm', 'a staff member''s own address and a firm subdomain');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['MIRA.manager@vjdesai.com'], ARRAY['sam@vjdesai.com'])$$,
                'outside the firm', 'two staff profiles');
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_requests)::int + (SELECT count(*) FROM email_outbox)::int, 0, 'nothing written');

-- The repro: the employee sends To their mailbox, CC the client, and answers
-- as someone else. Refused; nothing recorded; the gate stays shut.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY['junior@vjdesai.com'], ARRAY['owner@client.test'], '10000000-0000-0000-0000-000000000003') ->> 'token' AS tok \gset
SELECT t_eq((SELECT to_emails || cc_emails FROM builder_bu_confirm_requests), ARRAY['junior@vjdesai.com', 'owner@client.test'],
            'a firm address may get a copy when a client address is on it');
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(
                   t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM'), t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM'),
                   t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Rajesh Shah', 'rajesh@client.test')$q$, :'tok'),
                'reached you at', 'an address not on the e-mail is refused');
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(
                   t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Junior', 'Junior@VJDesai.com')$q$, :'tok'),
                'staff cannot answer', 'the firm''s address on the e-mail is refused');
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(
                   t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Jay', 'jay.junior@gmail.test')$q$, :'tok'),
                'staff cannot answer', 'a staff member''s own address is refused even off the firm''s domain');
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations WHERE status <> 'PENDING' OR responded_by_email IS NOT NULL)::int, 0,
            'nothing recorded');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true, 'the gate stays shut');

-- The staff check is reached only through the page's functions.
SELECT t_raises($$SELECT builder_bu_confirm_is_staff('sam@vjdesai.com')$$, 'permission denied', 'anon cannot probe staff addresses');

-- The client on the e-mail answers. A client login's profile is not staff.
SELECT t_eq(t_results(t_respond(:'tok', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Owner', ' OWNER@client.test ')),
            'A-101:CONFIRMED', 'an address on the e-mail answers');
SELECT t_eq((SELECT responded_by_email FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'),
            'owner@client.test', 'and is the one recorded');
SELECT t_eq((SELECT bool_and(responded_by_email = ANY (r.to_emails || r.cc_emails))
               FROM builder_bu_agreement_confirmations c JOIN builder_bu_confirm_requests r ON r.id = c.request_id
              WHERE c.responded_by_email IS NOT NULL), true, 'every recorded responder was on the e-mail');
ROLLBACK;

-- A per-unit link e-mailed before this change: the addresses that e-mail went
-- to (the client master's when its outbox row is gone), as recorded when the
-- change was applied, answer; no one else.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
UPDATE clients SET email = 'Accounts <Accounts@Client.test>; rajesh@client.test' WHERE id = 'c1000000-0000-0000-0000-000000000001';
SELECT t_old_app($f$
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, sent_at)
SELECT eu.bu_event_id, eu.unit_id, 'c1000000-0000-0000-0000-000000000001', eu.agreement_value, 'PENDING', now()
  FROM builder_bu_event_units eu
 WHERE eu.bu_event_id = 'e1000000-0000-0000-0000-000000000001' AND eu.booked_at_cutoff;
$f$);
SELECT t_old_app($f$
WITH mail AS (
  INSERT INTO email_outbox (client_id, to_email, kind, template_key, subject, body, status)
  VALUES ('c1000000-0000-0000-0000-000000000001', 'old.owner@client.test', 'builder_agreement_confirm',
          'builder_bu_agreement_confirm', 'Please confirm the agreement value', 'x', 'sent')
  RETURNING id)
UPDATE builder_bu_agreement_confirmations SET outbox_id = (SELECT id FROM mail)
 WHERE unit_id = 'a1000000-0000-0000-0000-000000000001';
$f$);
-- This change is applied: A-101 records its e-mail's To, A-102 and A-103
-- (their outbox rows gone) the client master's addresses as they then stood.
SELECT t_eq(t_legacy_snapshot(), 3, 'three per-unit e-mails recorded');
SELECT t_eq((SELECT string_agg(array_to_string(legacy_emails, ' '), ' | ' ORDER BY unit_id) FROM builder_bu_agreement_confirmations),
            'old.owner@client.test | accounts@client.test rajesh@client.test | accounts@client.test rajesh@client.test', 'what each records');
SELECT max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000001') AS t1,
       max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000002') AS t2,
       max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000003') AS t3
  FROM builder_bu_agreement_confirmations \gset
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Xavier', 'someone@client.test')$q$, :'t1'),
                'reached you at', 'per-unit link: a stranger is refused');
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Sam', 'sam@vjdesai.com')$q$, :'t1'),
                'staff cannot answer', 'per-unit link: staff are refused');
SELECT t_eq(t_results(t_respond(:'t1', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Old Owner', 'old.owner@client.test')),
            'A-101:CONFIRMED', 'the address that e-mail went to answers');
SELECT t_eq(t_results(t_respond(:'t2', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')), 'Accounts', 'accounts@client.test')),
            'A-102:CONFIRMED', 'the client master''s address answers ("Name <addr>" read)');
SELECT t_eq(t_results(t_respond(:'t3', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000003', 'DISPUTE', 'Revised')), 'Rajesh', 'Rajesh@client.test')),
            'A-103:DISPUTED', 'so does its second address');
ROLLBACK;

-- The pop-up learns which typed addresses count as the firm's own (round 2,
-- defect: a staff member's personal address passed the pop-up and the
-- refusal did not name it). Only for someone who may send.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_eq(builder_bu_confirm_firm_addresses('10000000-0000-0000-0000-000000000003',
              ARRAY['owner@client.test', ' Jay.Junior@Gmail.test ', 'gst@vjdesai.com', 'a@mail.vjdesai.com', 'mira.manager@vjdesai.com', 'owner@client.test']),
            ARRAY['jay.junior@gmail.test', 'gst@vjdesai.com', 'a@mail.vjdesai.com', 'mira.manager@vjdesai.com'],
            'the firm''s domain, its subdomains and staff profile e-mails, in the order typed');
SELECT t_eq(builder_bu_confirm_firm_addresses('10000000-0000-0000-0000-000000000001', ARRAY['owner@client.test']), '{}'::text[], 'none');
SELECT t_raises($$SELECT builder_bu_confirm_firm_addresses('10000000-0000-0000-0000-000000000004', ARRAY['sam@vjdesai.com'])$$,
                'not allowed', 'an employee without post_bu_event cannot probe');
SELECT t_raises($$SELECT builder_bu_confirm_firm_addresses(NULL, ARRAY['sam@vjdesai.com'])$$, 'not allowed', 'nor can no one');
SELECT t_raises($$SELECT builder_bu_confirm_firm_addresses('10000000-0000-0000-0000-000000000009', ARRAY['sam@vjdesai.com'])$$, 'not allowed', 'nor a client login');
-- The refusal names the addresses that count as the firm's.
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['jay.junior@gmail.test'], ARRAY['gst@vjdesai.com'],
                                 '10000000-0000-0000-0000-000000000003')$$,
                'These are the firm''s own and cannot answer: jay.junior@gmail.test, gst@vjdesai.com.', 'the refusal names them');
ROLLBACK;
