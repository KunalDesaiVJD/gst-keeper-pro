-- Notice alert automation via pg_cron + pg_net.
--
-- Two cron jobs:
--   1. Daily digest at 04:00 UTC (~09:30 IST): runs queue-notice-alerts
--      with mode=digest for overdue/due-soon/unassigned digests (E2/E3/E11).
--   2. Raise the send-gst-email cadence from hourly to every 15 minutes
--      so notice alerts drain the outbox faster.
--
-- Auth uses the same Vault secret as the existing email cron jobs.

-- Daily notice alert digest at ~09:30 IST
select cron.schedule('notice-alerts-daily-digest', '0 4 * * *', $cron$
  select net.http_post(
    url := 'https://gcquafqxbykxkbexcdpy.supabase.co/functions/v1/queue-notice-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_anon_key')
    ),
    body := '{"mode":"all"}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);

-- Raise outbox drain from hourly to every 15 minutes (upsert by job name
-- replaces the existing schedule safely).
select cron.schedule('gst-send-outbox-hourly', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://gcquafqxbykxkbexcdpy.supabase.co/functions/v1/send-gst-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_anon_key')
    ),
    body := '{"limit":50}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);
