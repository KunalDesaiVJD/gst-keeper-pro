-- The log is append-only for everyone: the public key, the service key and
-- the database owner cannot change, delete or empty it; only a retention
-- function (none exists) could delete, by turning
-- app.gst_change_log_retention on. And what the app and the extension may
-- call, they can; what they must not, they cannot.
SET search_path = public, extensions;

INSERT INTO advance_receipts (id, client_id, period_month, receipt_no, gross_amount)
VALUES ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '09/2026', 'AR-1', 11800);
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE row_id = '60000000-0000-0000-0000-000000000001')::int, 1, 'a row to protect');

-- 1. The public key (the app, the extension): read yes, write no
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000001","x-gst-source":"app"}');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE row_id = '60000000-0000-0000-0000-000000000001')::int, 1, 'the public key reads the log');
SELECT t_raises($$UPDATE gst_change_log SET actor_name = 'Nobody' WHERE row_id = '60000000-0000-0000-0000-000000000001'$$, 'permission denied', 'the public key cannot edit a log row');
SELECT t_raises($$DELETE FROM gst_change_log WHERE row_id = '60000000-0000-0000-0000-000000000001'$$, 'permission denied', 'the public key cannot delete a log row');
SELECT t_raises($$INSERT INTO gst_change_log (table_name, op, actor_source, actor_basis, changed) VALUES ('filing_status', 'UPDATE', 'app', 'header', '{}')$$,
                'permission denied', 'the public key cannot write a made-up log row');
SELECT t_raises($$TRUNCATE gst_change_log$$, 'permission denied', 'the public key cannot empty the log');
SELECT t_raises($$DELETE FROM gst_change_log_tables$$, 'permission denied', 'the public key cannot unlist a table');
-- Round 3: the rows kept until COMMIT are as closed as the log: no made-up
-- row to be written at COMMIT, no kept row taken away before it.
SELECT t_raises($$INSERT INTO gst_change_log_stage (txid, table_name, op, n) VALUES (txid_current(), 'filing_status', 'I', '{"id": "x"}')$$,
                'permission denied', 'the public key cannot add a made-up row to be logged at COMMIT');
SELECT t_raises($$DELETE FROM gst_change_log_stage$$, 'permission denied', 'nor take a kept row away');
SELECT t_raises($$INSERT INTO gst_change_log_pending (txid) VALUES (1)$$, 'permission denied', 'nor mark a transaction');
SELECT t_raises($$SELECT count(*) FROM gst_change_log_stage$$, 'permission denied', 'nor read the rows kept for open transactions');
SELECT t_raises($$SELECT public.gst_change_log_for_filing_status(txid_current(), NULL, 'Nobody', 'app', NULL)$$, 'permission denied',
                'nor write a table''s log itself');
RESET ROLE;

-- 2. The service key (Edge Functions) neither
SET ROLE service_role;
SELECT t_raises($$DELETE FROM gst_change_log$$, 'permission denied', 'the service key cannot delete');
SELECT t_raises($$UPDATE gst_change_log SET op = 'INSERT'$$, 'permission denied', 'the service key cannot edit');
RESET ROLE;

-- 3. Nor the owner, short of DDL
SELECT t_raises($$UPDATE gst_change_log SET actor_name = 'Nobody' WHERE row_id = '60000000-0000-0000-0000-000000000001'$$,
                'cannot be changed or deleted', 'the owner cannot edit a log row');
SELECT t_raises($$DELETE FROM gst_change_log WHERE row_id = '60000000-0000-0000-0000-000000000001'$$,
                'cannot be changed or deleted', 'the owner cannot delete a log row');
SELECT t_raises($$TRUNCATE gst_change_log$$, 'cannot be changed or deleted', 'the owner cannot empty the log');
BEGIN;
SELECT set_config('app.gst_change_log_retention', 'on', true);
SELECT t_raises($$UPDATE gst_change_log SET actor_name = 'Nobody'$$, 'cannot be changed or deleted', 'not even retention edits a row');
DELETE FROM gst_change_log WHERE row_id = '60000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE row_id = '60000000-0000-0000-0000-000000000001')::int, 0,
            'only a retention run (the owner, the setting on) may delete');
ROLLBACK;
SELECT t_eq((SELECT actor_source FROM gst_change_log WHERE row_id = '60000000-0000-0000-0000-000000000001'), 'system', 'the row is as written');

-- 4. Who may call what (as PostgREST checks it)
SELECT t_eq(has_table_privilege('anon', 'public.gst_change_log', 'SELECT'), true, 'anon reads the log');
SELECT t_eq(has_table_privilege('anon', 'public.gst_change_history', 'SELECT'), true, 'anon reads the history view');
SELECT t_eq(has_table_privilege('anon', 'public.gst_change_log_tables', 'SELECT'), true, 'anon reads the table list');
SELECT t_eq(has_table_privilege('anon', 'public.gst_change_log', 'INSERT') OR has_table_privilege('anon', 'public.gst_change_log', 'UPDATE')
            OR has_table_privilege('anon', 'public.gst_change_log', 'DELETE') OR has_table_privilege('anon', 'public.gst_change_log', 'TRUNCATE'),
            false, 'anon has no write on the log');
SELECT t_eq(has_table_privilege('service_role', 'public.gst_change_log', 'DELETE'), false, 'service_role has no delete on the log');
SELECT t_eq(has_function_privilege('anon', 'public.gst_change_log_whoami()', 'execute'), true, 'the app can ask who it is recorded as');
SELECT t_eq(has_function_privilege('anon', 'public.manual_source_allow(uuid,uuid,text,text,text)', 'execute'), true, 'the superadmin screen can allow');
SELECT t_eq(has_function_privilege('anon', 'public.manual_source_revoke(uuid,uuid)', 'execute'), true, 'the superadmin screen can revoke');
SELECT t_eq(has_function_privilege('anon', 'public.gst_change_log_attach(text,text,text,text,text[],text[],text[],text,text,text[])', 'execute'),
            false, 'the public key cannot attach or re-point the logger');
SELECT t_eq(has_function_privilege('service_role', 'public.gst_change_log_attach(text,text,text,text,text[],text[],text[],text,text,text[])', 'execute'),
            false, 'nor the service key');
SELECT t_eq(has_function_privilege('anon', 'public.gst_change_log_context()', 'execute'), false, 'the context is internal');
SELECT t_eq(has_function_privilege('anon', 'public.gst_change_log_client_of(text,uuid)', 'execute'), false, 'the client lookup is internal');
SELECT t_eq(has_function_privilege('anon', 'public.gst_change_log_flush()', 'execute') OR has_function_privilege('anon', 'public.gst_change_log_stage_row()', 'execute')
            OR has_function_privilege('service_role', 'public.gst_change_log_flush()', 'execute'), false, 'the row trigger and the flush are internal');
SELECT t_eq((SELECT count(*) FROM gst_change_log_tables t
              WHERE has_function_privilege('anon', 'public.' || public.gst_change_log_fn_name(t.table_name) || '(bigint,uuid,text,text,text)', 'execute')
                 OR has_function_privilege('authenticated', 'public.' || public.gst_change_log_fn_name(t.table_name) || '(bigint,uuid,text,text,text)', 'execute'))::int,
            0, 'no API role may run a table''s log writer');
SELECT t_eq(has_table_privilege('anon', 'public.gst_change_log_stage', 'SELECT') OR has_table_privilege('anon', 'public.gst_change_log_stage', 'INSERT')
            OR has_table_privilege('service_role', 'public.gst_change_log_stage', 'INSERT') OR has_table_privilege('anon', 'public.gst_change_log_pending', 'INSERT'),
            false, 'the kept rows and the marks are open to no API role');

-- 5. whoami, as the app calls it (a read)
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"who-1"}');
SELECT t_eq(gst_change_log_whoami(), '{"actor_id": "10000000-0000-0000-0000-000000000002", "actor_name": "Gita", "source": "app", "request_id": "who-1"}'::jsonb,
            'whoami echoes what the log will record');
SELECT t_request('anon', '{"x-gst-actor":"20000000-0000-0000-0000-000000000002","x-gst-source":"app"}');
SELECT t_eq(gst_change_log_whoami() ->> 'actor_name', 'MOONLIGHT FABRICS (client)', 'a client portal user is named as the client');
RESET ROLE;
