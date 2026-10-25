-- The Calendar shows every open case's key dates (the UX audit of 25 October
-- 2026): one call over a date range instead of one notice_case_key_dates per
-- case. Additive: a new function reading the existing one; reply dues and
-- hearings stay with notice_calendar, so they are left out here.
CREATE OR REPLACE FUNCTION public.notice_case_key_dates_range(p_from date, p_to date)
RETURNS TABLE (
  day date, kind text, title text, detail text, law text, tone text,
  client_id uuid, client_name text, case_key text, item_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (e->>'date')::date, e->>'kind', e->>'title', e->>'detail', e->>'law', e->>'tone',
         c.client_id, c.client_name, c.case_key, NULLIF(e->>'item_id', '')::uuid
  FROM notice_cases c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(notice_case_key_dates(c.client_id, c.case_key), '[]'::jsonb)) e
  WHERE c.is_open
    AND c.track <> 'other'
    AND e->>'kind' NOT IN ('reply_due', 'hearing')
    AND (e->>'date')::date BETWEEN p_from AND p_to
$$;

GRANT EXECUTE ON FUNCTION public.notice_case_key_dates_range(date, date) TO anon, authenticated, service_role;
