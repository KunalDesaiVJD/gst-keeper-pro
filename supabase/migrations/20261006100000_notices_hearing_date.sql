-- Notices Phase 0 · schema truth (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf, L-01 / L-03).
--
-- The notice drawer (NoticeDrawer.tsx), the in-app alert queue (noticeAlertQueue.ts),
-- the queue-notice-alerts edge function and the hearing e-mail template all read
-- gst_notices.hearing_date, but no migration ever created it, so PostgREST rejected
-- each of those selects outright: the drawer showed "Notice not found" for every
-- notice and no alert could be queued. Commit 50e12fc removed the column from
-- useNoticeSet for the same reason; later code re-introduced it.
--
-- Add it as a plain date (alerts are day-based). It is filled in by staff today and
-- by the sync / document reader in later phases.
ALTER TABLE public.gst_notices ADD COLUMN IF NOT EXISTS hearing_date date;

COMMENT ON COLUMN public.gst_notices.hearing_date IS
  'Next personal-hearing date for this notice (IST calendar date). Read by the notice drawer and the E4 hearing reminder.';
