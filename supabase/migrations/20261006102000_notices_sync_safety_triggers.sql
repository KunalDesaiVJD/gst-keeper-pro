-- Notices Phase 0 · sync safety rails, database side
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: L-05, L-06, L-07, S-04, S-08).
--
-- These hold for every writer, including extension copies older than 0.4.0 that
-- staff may still have loaded (the extension is distributed as an unpacked folder).
--
-- 1. A sync write never blanks what an earlier pull captured.
--    The extension upserts whole rows with pdf_url / case_id set to NULL
--    whenever a PDF download fails or the portal row has no such field, and
--    PostgREST's merge-duplicates writes those NULLs over good values. A sync write
--    is recognised by last_seen_at / pulled_at moving (staff edits never touch them).
--    due_date is deliberately NOT held: case rows carry no portal due date, and the
--    sweep (notices_sweep, run right after each client's sync and nightly) refills it
--    from the case folder, so a newer notice in the same case moves the date forward.
--
-- 2. Manual notices (portal_key 'manual:…', added through Add Notice) are never
--    marked missing by a sync: the portal does not return them, so every Sync All
--    would otherwise soft-delete them.
--
-- 3. A hard DELETE on gst_notices becomes a soft delete. Extension copies older than
--    0.3.0 still run "DELETE gst_notices?client_id=…" and wipe staff work; this keeps
--    the row (with its status, owner, remarks) and only sets deleted_at.
--    Maintenance can still hard-delete inside a transaction with
--      SET LOCAL app.allow_notice_hard_delete = 'on';

CREATE OR REPLACE FUNCTION public.gst_notices_sync_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at
     OR NEW.pulled_at IS DISTINCT FROM OLD.pulled_at THEN
    NEW.pdf_url      := COALESCE(NEW.pdf_url, OLD.pdf_url);
    NEW.case_id      := COALESCE(NEW.case_id, OLD.case_id);
    NEW.hearing_date := COALESCE(NEW.hearing_date, OLD.hearing_date);
  END IF;

  IF OLD.portal_key LIKE 'manual:%'
     AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gst_notices_sync_guard ON public.gst_notices;
CREATE TRIGGER gst_notices_sync_guard
  BEFORE UPDATE ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_sync_guard();

CREATE OR REPLACE FUNCTION public.gst_notices_soft_delete_instead()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_notice_hard_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  UPDATE public.gst_notices
     SET deleted_at = now()
   WHERE id = OLD.id AND deleted_at IS NULL;
  RETURN NULL; -- keep the row
END;
$$;

DROP TRIGGER IF EXISTS gst_notices_soft_delete_instead ON public.gst_notices;
CREATE TRIGGER gst_notices_soft_delete_instead
  BEFORE DELETE ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_soft_delete_instead();
