-- GST email automation via pg_cron + pg_net.
--
-- pg_cron.schedule upserts by job name, so re-applying this migration is safe.
-- Auth uses the PUBLIC anon key read from Vault (secret 'gst_cron_anon_key',
-- created out-of-band) — no key literal lives in the repo. The edge functions
-- themselves use the service role (their own env) to read/write email_outbox.

-- 04:00 UTC (~09:30 IST) daily: queue any due data reminders for the current
-- return period (previous calendar month). No-op unless a client is enabled and
-- its return is still Data Pending and a reminder is due.
select cron.schedule('gst-queue-reminders-daily', '0 4 * * *', $cron$
  select net.http_post(
    url := 'https://gcquafqxbykxkbexcdpy.supabase.co/functions/v1/queue-gst-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);

-- Hourly: deliver whatever is pending in the outbox — queued reminders plus a
-- backstop for any filing confirmation whose immediate send failed. Batched at
-- 25/run so each invocation finishes well inside the pg_net timeout.
select cron.schedule('gst-send-outbox-hourly', '0 * * * *', $cron$
  select net.http_post(
    url := 'https://gcquafqxbykxkbexcdpy.supabase.co/functions/v1/send-gst-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_anon_key')
    ),
    body := '{"limit":25}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);
