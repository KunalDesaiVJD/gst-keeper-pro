-- The Liberal / Strict switch outlives the client (round 2 review):
-- client_liberal_log goes with a deleted client (ON DELETE CASCADE), so the
-- change log records the switch on the client row too (liberal_2b_reconciliation,
-- liberal_changed_by, liberal_changed_at). The view shows each switch once:
-- client_liberal_log's row only when this log has none for it (the switches
-- made before the change log went live). The real triggers of
-- 20261017100000_liberal_mode_log.sql write client_liberal_log here.
SET search_path = public, extensions;
\ir ../../migrations/20261017100000_liberal_mode_log.sql

INSERT INTO clients (id, name, gstin, liberal_2b_reconciliation) VALUES ('20000000-0000-0000-0000-000000000027', 'SWITCHED TRADERS', '24SSSSS2727S1Z1', false);
-- A switch made before the change log (only in client_liberal_log).
INSERT INTO client_liberal_log (client_id, liberal, changed_by, changed_by_name, changed_at)
VALUES ('20000000-0000-0000-0000-000000000027', true, '10000000-0000-0000-0000-000000000001', 'Sam', '2026-09-01T10:00:00+05:30');

SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000001","x-gst-source":"app","x-gst-request":"lib-1"}');
UPDATE clients SET liberal_2b_reconciliation = true, liberal_changed_by = '10000000-0000-0000-0000-000000000001',
                   liberal_changed_by_name = 'Sam', liberal_changed_at = now()
 WHERE id = '20000000-0000-0000-0000-000000000027';
SELECT t_eq((SELECT (changed -> 'liberal_2b_reconciliation')::text || ' ' || (changed -> 'liberal_changed_by' ->> 'new') || ' ' || actor_name
               FROM gst_change_log WHERE request_id = 'lib-1'),
            '{"new": true, "old": false} 10000000-0000-0000-0000-000000000001 Sam', 'the switch, who stamped it, and who made it');
SELECT t_eq((SELECT count(*) FROM client_liberal_log WHERE client_id = '20000000-0000-0000-0000-000000000027')::int, 2,
            'client_liberal_log has it too (and the earlier one)');
SELECT t_eq((SELECT string_agg(log || ':' || (changed -> 'liberal_2b_reconciliation' ->> 'new'), ', ' ORDER BY at)
               FROM gst_change_history WHERE client_id = '20000000-0000-0000-0000-000000000027' AND changed ? 'liberal_2b_reconciliation'),
            'client_liberal_log:true, gst_change_log:true', 'the view: the earlier switch from its own log, this one once');

-- Another staff member deletes the client.
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"lib-del"}');
DELETE FROM clients WHERE id = '20000000-0000-0000-0000-000000000027';
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_liberal_log WHERE client_id = '20000000-0000-0000-0000-000000000027')::int, 0,
            'client_liberal_log went with the client');
SET ROLE anon;
SELECT t_eq((SELECT count(*) FROM gst_change_history WHERE client_id = '20000000-0000-0000-0000-000000000027'
              AND op = 'UPDATE' AND changed -> 'liberal_2b_reconciliation' ->> 'new' = 'true')::int, 1,
            'the switch to Liberal is still in the client''s Change history');
SELECT t_eq((SELECT (changed ->> 'liberal_2b_reconciliation') || ' ' || actor_name FROM gst_change_history
              WHERE client_id = '20000000-0000-0000-0000-000000000027' AND op = 'DELETE' AND table_name = 'clients'),
            'true Gita', 'and the deleted client''s row says it was Liberal, deleted by Gita');
RESET ROLE;
