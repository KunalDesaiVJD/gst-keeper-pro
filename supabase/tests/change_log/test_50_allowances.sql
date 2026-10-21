-- The superadmin's manual-upload allowances (the shared table): given and
-- taken back only through manual_source_allow / manual_source_revoke, by the
-- superadmin; each step is in the change log with who did it and the reason.
-- (On a database where this migration made them; the filing / reco branches
-- own the functions when they ran first.)
SET search_path = public, extensions;
SET ROLE anon;

SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app"}');
SELECT t_raises($$SELECT manual_source_allow('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '09/2026', 'filing:GSTR-3B', 'Portal password wrong')$$,
                'Only the superadmin', 'a GST Manager cannot allow a manual upload');
SELECT t_raises($$INSERT INTO manual_source_allowances (client_id, period_month, scope, reason, allowed_by)
                  VALUES ('20000000-0000-0000-0000-000000000001', '09/2026', 'filing:GSTR-3B', 'Portal password wrong', '10000000-0000-0000-0000-000000000001')$$,
                'Only the superadmin gives or takes back', 'a direct write is refused');

SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000001","x-gst-source":"app","x-gst-request":"allow-1"}');
SELECT t_raises($$SELECT manual_source_allow('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '09/2026', 'filing:GSTR-3B', 'no')$$,
                'at least 5 characters', 'a reason is needed');
SELECT (manual_source_allow('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '09/2026', 'filing:GSTR-3B',
        'Portal password wrong since 18 Oct')).id IS NOT NULL AS allowed;
SELECT t_eq((SELECT op || ':' || actor_name || ':' || actor_basis || ':' || (changed ->> 'reason') || ':' || (changed ->> 'scope') || ':' || period_month
               FROM gst_change_log WHERE table_name = 'manual_source_allowances' AND request_id = 'allow-1'),
            'INSERT:Sam:header:Portal password wrong since 18 Oct:filing:GSTR-3B:09/2026', 'the allowance is logged with who and why');

SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000001","x-gst-source":"app","x-gst-request":"revoke-1"}');
SELECT (manual_source_revoke('10000000-0000-0000-0000-000000000001',
        (SELECT id FROM manual_source_allowances WHERE client_id = '20000000-0000-0000-0000-000000000001' AND scope = 'filing:GSTR-3B' AND revoked_at IS NULL))).revoked_at IS NOT NULL AS revoked;
SELECT t_eq((SELECT op || ':' || actor_name || ':' || (changed -> 'revoked_by' ->> 'new') FROM gst_change_log
              WHERE table_name = 'manual_source_allowances' AND request_id = 'revoke-1'),
            'UPDATE:Sam:10000000-0000-0000-0000-000000000001', 'taking it back is logged');

-- Without the header, the row's own stamps say who (allowed_by, then revoked_by).
SELECT t_request('anon', NULL);
SELECT (manual_source_allow('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '09/2026', 'reco:suspended',
        'Portal down on the due date')).id IS NOT NULL AS allowed;
SELECT t_eq((SELECT actor_name || ':' || actor_basis FROM gst_change_log WHERE table_name = 'manual_source_allowances' ORDER BY id DESC LIMIT 1),
            'Sam:row', 'no header: allowed_by names the superadmin');
RESET ROLE;
