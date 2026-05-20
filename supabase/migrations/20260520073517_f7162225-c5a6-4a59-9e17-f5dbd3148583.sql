CREATE OR REPLACE FUNCTION public.validate_filing_status_filed_requirements()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.arn := NULLIF(upper(btrim(NEW.arn)), '');

  IF NEW.status <> 'Filed' THEN
    NEW.arn := NULL;
    NEW.filed_date := NULL;
  END IF;

  IF NEW.status = 'Filed' THEN
    IF NEW.arn IS NULL THEN
      RAISE EXCEPTION 'ARN is mandatory before marking return as Filed';
    END IF;

    IF NEW.arn !~ '^[A-Z0-9]{15}$' THEN
      RAISE EXCEPTION 'ARN must be exactly 15 alphanumeric characters';
    END IF;

    IF NEW.return_pdf_url IS NULL OR btrim(NEW.return_pdf_url) = '' THEN
      RAISE EXCEPTION 'Return PDF is mandatory before marking return as Filed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_filing_status_filed_requirements_trigger ON public.filing_status;

CREATE TRIGGER validate_filing_status_filed_requirements_trigger
BEFORE INSERT OR UPDATE ON public.filing_status
FOR EACH ROW
EXECUTE FUNCTION public.validate_filing_status_filed_requirements();

WITH stale_rows AS (
  SELECT fs.id
  FROM public.filing_status fs
  JOIN public.clients c ON c.id = fs.client_id
  WHERE EXISTS (
    SELECT 1
    FROM public.client_scheme_history h
    WHERE h.client_id = fs.client_id
  )
  AND NOT (
    fs.return_type = ANY (
      CASE COALESCE((
        SELECT h2.new_scheme
        FROM public.client_scheme_history h2
        WHERE h2.client_id = fs.client_id
          AND date_trunc('month', h2.effective_from_date)::date <= to_date('01/' || fs.period_month, 'DD/MM/YYYY')
        ORDER BY h2.effective_from_date DESC, h2.changed_at DESC
        LIMIT 1
      ), (
        SELECT h3.old_scheme
        FROM public.client_scheme_history h3
        WHERE h3.client_id = fs.client_id
        ORDER BY h3.effective_from_date ASC, h3.changed_at ASC
        LIMIT 1
      ), c.registration_type::text)
        WHEN 'Regular' THEN ARRAY['GSTR-1', 'GSTR-3B', 'ITC-04']::public.return_type[]
        WHEN 'IFF' THEN ARRAY['GSTR-1 (IFF)', 'GSTR-3B (Q)']::public.return_type[]
        WHEN 'Composition' THEN ARRAY['CMP-08']::public.return_type[]
        WHEN 'Tax Deductor' THEN ARRAY['GSTR-7']::public.return_type[]
        WHEN 'ISD' THEN ARRAY['GSTR-6']::public.return_type[]
        ELSE ARRAY[]::public.return_type[]
      END
    )
  )
  AND (fs.arn IS NOT NULL OR fs.filed_date IS NOT NULL OR fs.status = 'Filed' OR fs.is_locked = true)
)
UPDATE public.filing_status fs
SET status = 'Data Pending',
    arn = NULL,
    filed_date = NULL,
    is_locked = false,
    updated_at = now()
FROM stale_rows sr
WHERE fs.id = sr.id;