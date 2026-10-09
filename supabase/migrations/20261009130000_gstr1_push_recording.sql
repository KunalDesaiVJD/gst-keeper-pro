-- GSTR-1 push recording fixes (9 Oct 2026, reported by the firm: pushed returns
-- not showing as Pushed in Filing Status, so they could not be pulled or filed).
--
-- 1. A JSON push was recorded only by the GSTR-1 page itself, when the
--    extension's result reached it (markFilingPushed). If the page was closed
--    or reloaded while the portal processed the upload, the push was never
--    recorded — although the extension had already written the outcome to
--    gstr1_data (saveGstr1UploadResult runs in its background worker). The
--    database now records the push from that write: an ACCEPTED upload stamps
--    filing_status.pushed_at and moves the row to 'Pushed' (unless Filed),
--    exactly as mark_filing_pushed does. A partial upload ("processed with
--    errors") still does not count — the same rule the page applies.
--
-- 2. A NIL return no longer needs a push before it can be marked Filed or
--    pulled. The direct-filing rule exists to catch a return whose data was
--    filed on the portal instead of the data in GST Keeper; a period staff have
--    ticked NIL in GST Keeper has no data to diverge from, and the pulled
--    return's summary shows whether it really was nil. NIL pushes through the
--    extension (0.8.4+) still mark the row Pushed.
--
-- 3. Backfill: accepted uploads whose push was never recorded (marker only —
--    a status staff have set since the upload is left alone).

-- ---------------------------------------------------------------------------
-- 1. Record an accepted upload from gstr1_data
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gstr1_data_record_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period text;
  v_at     timestamptz;
  v_rows   int;
BEGIN
  IF NEW.last_upload_status IS DISTINCT FROM 'accepted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.last_upload_status IS NOT DISTINCT FROM NEW.last_upload_status
     AND OLD.last_uploaded_at IS NOT DISTINCT FROM NEW.last_uploaded_at THEN
    RETURN NEW;
  END IF;
  IF NEW.period_month !~ '^[A-Za-z]{3}-[0-9]{2}$' THEN RETURN NEW; END IF;

  v_period := to_char(to_date(NEW.period_month, 'Mon-YY'), 'MM/YYYY');
  v_at := COALESCE(NEW.last_uploaded_at, now());

  PERFORM set_config('app.filing_push', 'on', true);

  -- Whichever GSTR-1 row(s) the client has for the period (regular or IFF).
  UPDATE public.filing_status
     SET pushed_at  = v_at,
         status     = CASE WHEN status::text = 'Filed' THEN status ELSE 'Pushed'::filing_status_type END,
         updated_at = now()
   WHERE client_id = NEW.client_id
     AND period_month = v_period
     AND return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)');
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    INSERT INTO public.filing_status (client_id, return_type, period_month, status, updated_at, pushed_at)
    VALUES (NEW.client_id, 'GSTR-1'::return_type, v_period, 'Pushed'::filing_status_type, now(), v_at)
    ON CONFLICT (client_id, return_type, period_month) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gstr1_data_record_push ON public.gstr1_data;
CREATE TRIGGER trg_gstr1_data_record_push
  AFTER INSERT OR UPDATE OF last_upload_status, last_uploaded_at ON public.gstr1_data
  FOR EACH ROW EXECUTE FUNCTION public.gstr1_data_record_push();

-- ---------------------------------------------------------------------------
-- 2. Guard: a NIL return passes without a push
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.filing_status_guard_direct_filing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pushed timestamptz;
  v_nil    boolean;
BEGIN
  IF NEW.status::text <> 'Filed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'Filed' THEN RETURN NEW; END IF;
  IF NOT public.gstr1_direct_filing_rule_applies(NEW.return_type::text, NEW.period_month) THEN
    RETURN NEW;
  END IF;

  -- An upsert (INSERT ... ON CONFLICT DO UPDATE, as the extension's pull
  -- does) reaches BEFORE INSERT with only the incoming columns, so read the
  -- stored row's marker and NIL flag as well.
  v_pushed := NEW.pushed_at;
  v_nil := COALESCE(NEW.is_nil, false);
  IF v_pushed IS NULL OR NOT v_nil THEN
    SELECT COALESCE(v_pushed, fs.pushed_at), v_nil OR COALESCE(fs.is_nil, false)
      INTO v_pushed, v_nil
      FROM public.filing_status fs
     WHERE fs.client_id = NEW.client_id
       AND fs.return_type = NEW.return_type
       AND fs.period_month = NEW.period_month;
  END IF;
  IF v_pushed IS NOT NULL OR COALESCE(v_nil, false) THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.gstr1_direct_filing_approvals a
     WHERE a.client_id = NEW.client_id
       AND a.return_type = NEW.return_type::text
       AND a.period_month = NEW.period_month
       AND a.status = 'approved'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    '% for % was not pushed through GST Keeper, so it cannot be marked Filed or pulled from the portal until a superadmin approves a direct-filing request (Filing Status → Request approval).',
    NEW.return_type::text, NEW.period_month
    USING ERRCODE = 'check_violation';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill accepted uploads whose push was never recorded
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM set_config('app.filing_push', 'on', true);
  UPDATE public.filing_status fs
     SET pushed_at  = g.last_uploaded_at   -- the status staff set since is left as it is
    FROM public.gstr1_data g
   WHERE fs.pushed_at IS NULL
     AND fs.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)')
     AND g.client_id = fs.client_id
     AND g.last_upload_status = 'accepted'
     AND g.last_uploaded_at IS NOT NULL
     AND g.period_month ~ '^[A-Za-z]{3}-[0-9]{2}$'
     AND to_char(to_date(g.period_month, 'Mon-YY'), 'MM/YYYY') = fs.period_month
     AND public.gstr1_direct_filing_rule_applies(fs.return_type::text, fs.period_month);
END $$;
