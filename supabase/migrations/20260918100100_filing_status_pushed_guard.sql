-- Guard + setter for the 'Pushed' filing status (see the migration immediately
-- before this one, which adds the enum value).
--
-- Deliberately a SEPARATE migration: Postgres will not let a new enum value be
-- USED in the same transaction that added it, and mark_filing_pushed() casts to
-- 'Pushed'. Keeping them apart means each file applies cleanly on its own.

-- ── The guard ────────────────────────────────────────────────────────────────
-- Blocks only a TRANSITION INTO 'Pushed'. A row that is already 'Pushed' stays
-- fully editable — uploading its return PDF, editing remarks or the ARN, and
-- moving it on to 'Filed' (or back to a prepared status) all still work. It is
-- putting a row INTO 'Pushed' that is reserved for the system.
CREATE OR REPLACE FUNCTION public.filing_status_guard_pushed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status::text = 'Pushed'
     AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'Pushed')
     AND coalesce(current_setting('app.filing_push', true), '') <> 'on'
  THEN
    RAISE EXCEPTION
      'Filing status "Pushed" is set automatically when a push to the GST portal succeeds. It cannot be selected by hand.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_filing_status_guard_pushed ON public.filing_status;
CREATE TRIGGER trg_filing_status_guard_pushed
  BEFORE INSERT OR UPDATE ON public.filing_status
  FOR EACH ROW EXECUTE FUNCTION public.filing_status_guard_pushed();

-- ── The only way in ──────────────────────────────────────────────────────────
-- Opens the guard for the current transaction only (set_config's third argument
-- is is_local), then records the push.
--
-- 'Filed' outranks 'Pushed' and is never walked back: a stale tab re-pushing a
-- return that has since been filed must not erase its ARN and filed date. The
-- check rides on the ON CONFLICT ... WHERE so it is atomic rather than a
-- read-then-write race.
--
-- Returns the status the row ended up at, so the caller can tell the difference
-- between "recorded as Pushed" and "left alone because it was already Filed".
CREATE OR REPLACE FUNCTION public.mark_filing_pushed(
  p_client_id    uuid,
  p_return_type  text,
  p_period_month text,
  p_actor        uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result text;
BEGIN
  PERFORM set_config('app.filing_push', 'on', true);

  INSERT INTO public.filing_status AS fs
    (client_id, return_type, period_month, status, updated_by, updated_at)
  VALUES
    (p_client_id, p_return_type::return_type, p_period_month,
     'Pushed'::filing_status_type, p_actor, now())
  ON CONFLICT (client_id, return_type, period_month) DO UPDATE
     SET status     = 'Pushed'::filing_status_type,
         updated_by = COALESCE(EXCLUDED.updated_by, fs.updated_by),
         updated_at = now()
   WHERE fs.status::text <> 'Filed'
  RETURNING fs.status::text INTO v_result;

  -- No row came back: the conflicting row was 'Filed', so it was left untouched.
  RETURN COALESCE(v_result, 'Filed');
END;
$$;

-- The app talks to Postgres with the anon key and establishes no Supabase auth
-- session, so anon is the role that actually calls this.
GRANT EXECUTE ON FUNCTION public.mark_filing_pushed(uuid, text, text, uuid)
  TO anon, authenticated, service_role;
