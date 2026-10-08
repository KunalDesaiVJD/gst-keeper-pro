-- Notices: a CAPTCHA failure is not a password issue (the firm's request of
-- 8 October 2026: "some client logins are failed due to captcha error also so
-- that must not be considered as password issue but should specify the reasons
-- in the status").
--
-- Before extension 0.8.3, three CAPTCHAs the portal would not take were logged
-- as reason_class 'login_failed', the class a refused password uses, so the
-- client showed as "Login failed — password changed?". 0.8.3 logs them as
-- 'captcha_failed' (retried, never a password issue). This migration
--   1. reclassifies the rows already written that way, and
--   2. adds a guard so an older extension's CAPTCHA failure is filed the same
--      way: a login failure whose message is about the CAPTCHA (or the old
--      "after 3 automatic retries" fallback) and says nothing about the user ID
--      or password becomes 'captcha_failed'.
-- A CAPTCHA failure never sets clients.portal_login_issue (only a refusal does).

CREATE OR REPLACE FUNCTION public.login_failure_is_captcha(p_message text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_message, '') ~* '(captcha|letters\s+shown|characters\s+(shown|displayed|in\s+the\s+image)|automatic\s+retr)'
     AND coalesce(p_message, '') !~* '(password|user\s*(name|id)|credential|lock|block|expire)'
$$;
COMMENT ON FUNCTION public.login_failure_is_captcha(text) IS
  'True when a failed login''s message is about the CAPTCHA only (not the user ID or password): filed as captcha_failed, not login_failed.';

CREATE OR REPLACE FUNCTION public.sync_run_items_login_reason()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.step = 'login' AND NEW.reason_class = 'login_failed' AND public.login_failure_is_captcha(NEW.message) THEN
    NEW.reason_class := 'captcha_failed';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS sync_run_items_login_reason ON public.sync_run_items;
CREATE TRIGGER sync_run_items_login_reason
  BEFORE INSERT ON public.sync_run_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_run_items_login_reason();

UPDATE public.sync_run_items
   SET reason_class = 'captcha_failed'
 WHERE step = 'login' AND reason_class = 'login_failed' AND public.login_failure_is_captcha(message);

UPDATE public.portal_jobs
   SET reason_class = 'captcha_failed'
 WHERE reason_class = 'login_failed' AND public.login_failure_is_captcha(error);

COMMENT ON COLUMN public.sync_run_items.reason_class IS
  'Why a step did not fully succeed: login_failed (the portal refused the user ID or password), captcha_failed (the portal did not accept the CAPTCHA; retried, not a password issue), captcha_timeout, session_mismatch, portal_error, timeout, save_failed, stalled, guard_held, partial, empty, skipped_inactive, other.';
