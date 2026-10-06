-- Notices Phase 2 · sync status before the run ledger
-- (follows 20261006113000_sync_run_ledger.sql; found on the live project on
-- 2026-10-06 after the Phase 2 migrations went in).
--
-- client_sync_status read only sync_run_items, which the extension writes from
-- v0.5.0. On the live project no sync had run since then (the last good notices
-- pull in client_sync_log was 13 Sep 2026), so the command centre, the Clients
-- list, the client profile and the extension popup said every client had
-- "never synced" — 95 of 95 — although 108 clients had synced before.
--
-- Now a client the ledger has not seen for a step keeps its last known state
-- from client_sync_log: the latest 'notices' row (success → ok) and the latest
-- 'login_failed' row (step 'login', reason login_failed). As soon as the ledger
-- has a row for that client and step, the ledger alone answers. Columns and
-- their order are unchanged.

CREATE OR REPLACE VIEW public.client_sync_status WITH (security_invoker = true) AS
WITH last_attempt AS (
  SELECT DISTINCT ON (i.client_id, i.step)
         i.client_id, i.step, i.created_at AS last_attempt_at, i.status AS last_status,
         i.reason_class AS last_reason_class, i.message AS last_message, i.run_id AS last_run_id,
         i.ext_version AS last_ext_version
    FROM public.sync_run_items i
   WHERE i.step <> 'case_folder'
   ORDER BY i.client_id, i.step, i.created_at DESC
), last_success AS (
  SELECT DISTINCT ON (i.client_id, i.step)
         i.client_id, i.step, i.created_at AS last_success_at, i.rows_seen, i.rows_new, i.rows_changed,
         i.rows_removed, i.rows_held
    FROM public.sync_run_items i
   WHERE i.step <> 'case_folder' AND i.status IN ('ok', 'held')
   ORDER BY i.client_id, i.step, i.created_at DESC
), ledger AS (
  SELECT a.client_id, a.step, a.last_attempt_at, a.last_status, a.last_reason_class, a.last_message,
         a.last_run_id, a.last_ext_version,
         s.last_success_at, s.rows_seen, s.rows_new, s.rows_changed, s.rows_removed, s.rows_held
    FROM last_attempt a
    LEFT JOIN last_success s ON s.client_id = a.client_id AND s.step = a.step
), legacy AS (
  SELECT l.client_id,
         CASE WHEN l.action = 'login_failed' THEN 'login' ELSE 'notices' END AS step,
         max(l.created_at) AS last_attempt_at,
         (array_agg(l.status ORDER BY l.created_at DESC))[1] AS last_raw_status,
         (array_agg(l.message ORDER BY l.created_at DESC))[1] AS last_message,
         max(l.created_at) FILTER (WHERE l.status = 'success') AS last_success_at
    FROM public.client_sync_log l
   WHERE l.action IN ('notices', 'login_failed') AND l.client_id IS NOT NULL
   GROUP BY l.client_id, CASE WHEN l.action = 'login_failed' THEN 'login' ELSE 'notices' END
)
SELECT x.client_id, x.step, x.last_attempt_at, x.last_status, x.last_reason_class, x.last_message,
       x.last_run_id, x.last_ext_version,
       x.last_success_at, x.rows_seen, x.rows_new, x.rows_changed, x.rows_removed, x.rows_held,
       (x.last_success_at IS NULL OR x.last_success_at < now() - interval '24 hours') AS is_stale
  FROM ledger x
UNION ALL
SELECT g.client_id, g.step, g.last_attempt_at,
       CASE WHEN g.last_raw_status = 'success' THEN 'ok' ELSE 'failed' END,
       CASE WHEN g.step = 'login' THEN 'login_failed'
            WHEN g.last_raw_status = 'success' THEN NULL
            ELSE 'portal_error' END,
       g.last_message, NULL::uuid, NULL::text,
       g.last_success_at, NULL::int, NULL::int, NULL::int, NULL::int, NULL::int,
       (g.last_success_at IS NULL OR g.last_success_at < now() - interval '24 hours')
  FROM legacy g
 WHERE NOT EXISTS (SELECT 1 FROM ledger x WHERE x.client_id = g.client_id AND x.step = g.step);
GRANT SELECT ON public.client_sync_status TO anon, authenticated, service_role;
