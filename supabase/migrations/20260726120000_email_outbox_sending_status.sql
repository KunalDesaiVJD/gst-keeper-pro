-- Add a transient 'sending' status so the sender can atomically claim a row
-- (UPDATE ... WHERE status='pending' RETURNING) before calling Microsoft Graph,
-- preventing a duplicate send if the manual "Send queued now" button and the
-- daily cron ever run at the same time.
alter table public.email_outbox drop constraint if exists email_outbox_status_check;
alter table public.email_outbox add constraint email_outbox_status_check
  check (status in ('pending','sending','sent','failed','skipped','cancelled'));
