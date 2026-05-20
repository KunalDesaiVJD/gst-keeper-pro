CREATE OR REPLACE FUNCTION public.clear_inapplicable_filing_status_after_scheme_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  applicable_returns public.return_type[];
BEGIN
  applicable_returns := CASE NEW.new_scheme
    WHEN 'Regular' THEN ARRAY['GSTR-1', 'GSTR-3B', 'ITC-04']::public.return_type[]
    WHEN 'IFF' THEN ARRAY['GSTR-1 (IFF)', 'GSTR-3B (Q)']::public.return_type[]
    WHEN 'Composition' THEN ARRAY['CMP-08']::public.return_type[]
    WHEN 'Tax Deductor' THEN ARRAY['GSTR-7']::public.return_type[]
    WHEN 'ISD' THEN ARRAY['GSTR-6']::public.return_type[]
    ELSE ARRAY[]::public.return_type[]
  END;

  UPDATE public.filing_status fs
  SET status = 'Data Pending',
      arn = NULL,
      filed_date = NULL,
      is_locked = false,
      updated_at = now()
  WHERE fs.client_id = NEW.client_id
    AND to_date('01/' || fs.period_month, 'DD/MM/YYYY') >= date_trunc('month', NEW.effective_from_date)::date
    AND NOT (fs.return_type = ANY(applicable_returns))
    AND (fs.status = 'Filed' OR fs.arn IS NOT NULL OR fs.filed_date IS NOT NULL OR fs.is_locked = true);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_inapplicable_filing_status_after_scheme_change_trigger ON public.client_scheme_history;

CREATE TRIGGER clear_inapplicable_filing_status_after_scheme_change_trigger
AFTER INSERT ON public.client_scheme_history
FOR EACH ROW
EXECUTE FUNCTION public.clear_inapplicable_filing_status_after_scheme_change();