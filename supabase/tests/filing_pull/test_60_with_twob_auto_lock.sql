-- With auto_lock_on_filed as 20261021100000 (twob-simple) defines it on
-- 21 Oct 2026 (BEFORE INSERT OR UPDATE, GSTR-3B and GSTR-3B (Q), the first
-- carry): a pull still files once, the carry runs once per filing, the
-- filing date stays the portal's (or blank), never CURRENT_DATE.
CREATE TABLE public.t_carry_calls (client_id uuid, period text);
CREATE FUNCTION public.twob_carry_first(p_client_id uuid, p_period text) RETURNS jsonb
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
SET twob.write = 'system'
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.filing_status f
                                   WHERE f.client_id = NEW.client_id AND f.return_type = NEW.return_type
                                     AND f.period_month = NEW.period_month) THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text = 'Filed' AND (TG_OP = 'INSERT' OR OLD.status IS NULL OR OLD.status::text <> 'Filed') THEN
    NEW.filed_date := COALESCE(NEW.filed_date, CURRENT_DATE);
    IF NEW.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') THEN
      NEW.is_locked := TRUE;
      UPDATE public.bills_not_in_2b SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month AND is_locked IS DISTINCT FROM TRUE;
      UPDATE public.bills_not_in_books SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month AND is_locked IS DISTINCT FROM TRUE;
      UPDATE public.itc_summaries SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month;
      PERFORM public.twob_carry_first(NEW.client_id, NEW.period_month);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_auto_lock_on_filed ON public.filing_status;
CREATE TRIGGER trigger_auto_lock_on_filed BEFORE INSERT OR UPDATE ON public.filing_status
  FOR EACH ROW EXECUTE FUNCTION public.auto_lock_on_filed();
GRANT INSERT, SELECT ON public.t_carry_calls TO anon;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- GSTR-3B (Q), no portal date: Filed, carried once, date blank.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-3B (Q)', '09/2026', 'AB240926222222X', NULL,
  NULL, 'No PDF came with the pull.'))->>'outcome', 'filed', 'filed');
SELECT t_eq((SELECT count(*)::int FROM public.t_carry_calls), 1, 'carried once');
SELECT t_eq((SELECT filed_date FROM public.filing_status WHERE client_id = '22222222-2222-2222-2222-222222222222' AND period_month = '09/2026'),
  NULL::date, 'no CURRENT_DATE from auto_lock_on_filed');
-- Refreshed: no second carry.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-3B (Q)', '09/2026', 'AB240926222222X', current_date - 1))->>'outcome',
  'refreshed', 'refreshed');
SELECT t_eq((SELECT count(*)::int FROM public.t_carry_calls), 1, 'still carried once');
SELECT t_eq((SELECT filed_date FROM public.filing_status WHERE client_id = '22222222-2222-2222-2222-222222222222' AND period_month = '09/2026'),
  current_date - 1, 'the portal date, when it comes');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox), 1, 'one e-mail');
