-- Staff send one request: several To and CC typed in, one outbox row carrying
-- them all, one link, every unit pointed at the request. Works with no e-mail
-- on the client master. Refusals record nothing.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY[' Owner@Client.test ', 'accounts@client.test', 'owner@client.test'],
              ARRAY['ca@firm.test', 'ACCOUNTS@client.test', '', 'partner@firm.test']) AS r \gset
SELECT (:'r'::jsonb ->> 'token') AS tok, (:'r'::jsonb ->> 'request_id') AS req,
       (:'r'::jsonb ->> 'outbox_id') AS ob, (:'r'::jsonb ->> 'link') AS link \gset

SELECT t_eq((SELECT email FROM clients WHERE id = 'c1000000-0000-0000-0000-000000000001'), NULL::text, 'the client master has no e-mail');
SELECT t_eq(:'tok' ~ '^[0-9a-f]{48}$', true, 'a 192-bit token');
SELECT t_eq(:'link', 'https://gst.vjdesai.com/agreement-confirm/' || :'tok', 'one link for the request');
SELECT t_eq((:'r'::jsonb ->> 'units')::int, 3, 'three units asked about');

-- One e-mail, every address on it.
SELECT t_eq((SELECT count(*) FROM email_outbox)::int, 1, 'one outbox row, not one per unit');
SELECT t_eq((SELECT to_email FROM email_outbox), 'owner@client.test, accounts@client.test', 'To: both addresses, once each');
SELECT t_eq((SELECT cc_email FROM email_outbox), 'ca@firm.test, partner@firm.test', 'CC: blanks and a To address left out');
SELECT t_eq((SELECT kind || '/' || template_key || '/' || status FROM email_outbox),
            'builder_agreement_confirm/builder_bu_agreement_confirm_request/pending', 'queued with the new template');
SELECT t_eq((SELECT client_id FROM email_outbox), 'c1000000-0000-0000-0000-000000000001'::uuid, 'for the event''s client');
SELECT t_eq((SELECT created_by FROM email_outbox), '10000000-0000-0000-0000-000000000001'::uuid, 'sent by the actor');
SELECT t_eq((SELECT position(:'link' IN body) > 0 AND position('{{confirm_link}}' IN body) = 0 FROM email_outbox), true, 'the link is in the body');
SELECT t_eq((SELECT render_vars ->> 'confirm_link' FROM email_outbox), :'link', 'and in the render vars');
SELECT t_eq((SELECT render_vars ->> 'project_name' FROM email_outbox), 'Test Heights', 'the other vars kept');

-- The request.
SELECT t_eq((SELECT to_emails FROM builder_bu_confirm_requests), ARRAY['owner@client.test', 'accounts@client.test'], 'request To');
SELECT t_eq((SELECT cc_emails FROM builder_bu_confirm_requests), ARRAY['ca@firm.test', 'partner@firm.test'], 'request CC');
SELECT t_eq((SELECT array_agg(x ORDER BY x) FROM builder_bu_confirm_requests, unnest(unit_ids) x),
            ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                  'a1000000-0000-0000-0000-000000000003']::uuid[], 'request units');
SELECT t_eq((SELECT outbox_id::text FROM builder_bu_confirm_requests), :'ob', 'request points at its e-mail');
SELECT t_eq((SELECT sent_at IS NOT NULL AND created_by = '10000000-0000-0000-0000-000000000001' FROM builder_bu_confirm_requests), true, 'sent at, by');

-- The per-unit rows the posting gate reads.
SELECT t_eq((SELECT string_agg(u.unit_no || ':' || c.status || ':' || c.agreement_value_at_request, ',' ORDER BY u.unit_no)
               FROM builder_bu_agreement_confirmations c JOIN builder_units u ON u.id = c.unit_id),
            'A-101:PENDING:4500000,A-102:PENDING:5200000,A-103:PENDING:3900000', 'one PENDING row per unit, at the working''s value');
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations WHERE request_id::text = :'req' AND outbox_id::text = :'ob')::int, 3, 'each points at the request and its e-mail');
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_requests)::int, 1, 'anon reads the requests (RLS open)');

-- Refusals.
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY[]::text[], NULL)$$, 'at least one To', 'no To');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['  ', ''], ARRAY['ca@firm.test'])$$, 'at least one To', 'only blanks in To');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client'], NULL)$$, 'Not a valid e-mail address: owner@client', 'To without a domain');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], ARRAY['ca firm@firm.test'])$$, 'Not a valid e-mail address', 'CC with a space');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['a@x.test;b@x.test'], NULL)$$, 'Not a valid e-mail address', 'two addresses in one entry');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY(SELECT 'p' || g || '@client.test' FROM generate_series(1, 21) g), NULL)$$, 'At most 20', 'too many To');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000004']::uuid[], ARRAY['owner@client.test'], NULL)$$, 'not a taxable unit', 'an unbooked unit');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000005']::uuid[], ARRAY['owner@client.test'], NULL)$$, 'not a taxable unit', 'a unit of another event');
SELECT t_raises($$SELECT t_send(ARRAY[]::uuid[], ARRAY['owner@client.test'], NULL)$$, 'Tick at least one unit', 'no units');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000005']::uuid[], ARRAY['owner@client.test'], NULL,
                                 '10000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002')$$, 'posted', 'a posted event');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL,
                                 '10000000-0000-0000-0000-000000000004')$$, 'not allowed', 'an employee without post_bu_event');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL, NULL)$$, 'not allowed', 'no actor');
SELECT t_raises($$SELECT builder_bu_confirm_request_send('e1000000-0000-0000-0000-000000000001', ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[],
                   ARRAY['owner@client.test'], NULL, '10000000-0000-0000-0000-000000000001', 'javascript:alert(1)', 'S', '{{confirm_link}}', NULL)$$,
                  'link address is not valid', 'a link base that is not a web address');
SELECT t_raises($$SELECT builder_bu_confirm_request_send('e1000000-0000-0000-0000-000000000001', ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[],
                   ARRAY['owner@client.test'], NULL, '10000000-0000-0000-0000-000000000001', 'https://gst.vjdesai.com', 'S', 'No link here.', NULL)$$,
                  'no {{confirm_link}}', 'a body without the link');
SELECT t_eq((SELECT count(*) FROM email_outbox)::int, 1, 'refusals queue nothing');
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_requests)::int, 1, 'refusals create no request');

-- The GST Manager and an employee holding post_bu_event may send.
SELECT t_eq((t_send(ARRAY['a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL,
                    '10000000-0000-0000-0000-000000000002') ->> 'units')::int, 1, 'the GST Manager sends');
SELECT t_eq((t_send(ARRAY['a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL,
                    '10000000-0000-0000-0000-000000000003') ->> 'units')::int, 1, 'an employee with post_bu_event sends');
ROLLBACK;
