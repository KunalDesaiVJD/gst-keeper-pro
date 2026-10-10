-- Notices home (the firm's request of 10 October 2026: the redesigned home was too
-- basic): each kind's figures now also say when the next thing is due, how old the
-- oldest overdue case is, and how the overdue cases spread by age.
-- Replaces notice_cases_counts(jsonb) of 20261011100000 (same arguments, more keys).
CREATE OR REPLACE FUNCTION public.notice_cases_counts(p_filters jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_object_agg(t.track, t.counts), '{}'::jsonb)
    FROM (
      SELECT c.track, jsonb_build_object(
               'cases', count(*),
               'open', count(*) FILTER (WHERE c.is_open),
               'new', count(*) FILTER (WHERE c.new_items > 0),
               'new_items', coalesce(sum(c.new_items), 0),
               'overdue', count(*) FILTER (WHERE c.is_overdue),
               'due7', count(*) FILTER (WHERE c.is_due_in_7),
               'hearings', count(*) FILTER (WHERE c.next_hearing IS NOT NULL),
               'unassigned', count(*) FILTER (WHERE c.is_unassigned),
               'exposure', coalesce(sum(c.exposure), 0),
               'in_appeal', count(*) FILTER (WHERE c.is_open AND c.stage = 'appeal'),
               'next_due', min(c.next_due) FILTER (WHERE c.is_open AND c.next_due >= c.today_ist),
               'next_hearing', min(c.next_hearing),
               'oldest_overdue_days', max(c.today_ist - c.next_due) FILTER (WHERE c.is_overdue),
               'overdue_age', jsonb_build_object(
                 'd30', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due <= 30),
                 'd90', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due BETWEEN 31 AND 90),
                 'd365', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due BETWEEN 91 AND 365),
                 'older', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due > 365))) AS counts
        FROM public.notice_cases c
       WHERE public.notice_master_match(p_filters, c.client_id, c.financial_year, c.assign_to_user_id, c.form_code, c.effective_priority)
       GROUP BY c.track
    ) t
$$;
GRANT EXECUTE ON FUNCTION public.notice_cases_counts(jsonb) TO anon, authenticated, service_role;
