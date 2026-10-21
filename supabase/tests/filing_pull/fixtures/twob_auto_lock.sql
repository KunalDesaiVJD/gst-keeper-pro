-- auto_lock_on_filed as 20261021100000 (twob-simple) defines it on 21 Oct
-- 2026: BEFORE INSERT OR UPDATE, GSTR-3B and GSTR-3B (Q) both locked and
-- carried forward (twob_carry_first). 20261021110000 refuses to apply
-- without it (a pulled GSTR-3B (Q) would be locked but never carried), so
-- run.sh puts it on the stub after checking that refusal. twob_carry_first
-- here only records its calls (t_carry_calls).
CREATE TABLE IF NOT EXISTS public.t_carry_calls (client_id uuid, period text);
GRANT INSERT, SELECT ON public.t_carry_calls TO anon;
CREATE OR REPLACE FUNCTION public.twob_carry_first(p_client_id uuid, p_period text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.t_carry_calls VALUES (p_client_id, p_period);
  RETURN '{}'::jsonb;
END $$;
CREATE OR REPLACE FUNCTION public.auto_lock_on_filed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('twob.write', true);
BEGIN
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.filing_status f
                                   WHERE f.client_id = NEW.client_id AND f.return_type = NEW.return_type
                                     AND f.period_month = NEW.period_month) THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text = 'Filed' AND (TG_OP = 'INSERT' OR OLD.status IS NULL OR OLD.status::text <> 'Filed') THEN
    NEW.filed_date := COALESCE(NEW.filed_date, CURRENT_DATE);
    IF NEW.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || NEW.client_id::text, 0));
      PERFORM set_config('twob.write', 'system', true);
      NEW.is_locked := TRUE;
      UPDATE public.bills_not_in_2b SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month AND is_locked IS DISTINCT FROM TRUE;
      UPDATE public.bills_not_in_books SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month AND is_locked IS DISTINCT FROM TRUE;
      UPDATE public.itc_summaries SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month;
      PERFORM public.twob_carry_first(NEW.client_id, NEW.period_month);
      PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_auto_lock_on_filed ON public.filing_status;
CREATE TRIGGER trigger_auto_lock_on_filed BEFORE INSERT OR UPDATE ON public.filing_status
  FOR EACH ROW EXECUTE FUNCTION public.auto_lock_on_filed();
