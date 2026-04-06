
-- Add authoritative target date columns to clients table
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS target_date_group1 integer DEFAULT 11;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS target_date_group2 integer DEFAULT 20;

-- Populate from existing filing_status data using the most common target_date per group
-- Group 1: GSTR-1, GSTR-1 (IFF), GSTR-7, GSTR-6
WITH group1_dates AS (
  SELECT client_id, target_date, COUNT(*) as cnt
  FROM filing_status
  WHERE return_type IN ('GSTR-1', 'GSTR-1 (IFF)', 'GSTR-7', 'GSTR-6')
    AND target_date IS NOT NULL
  GROUP BY client_id, target_date
  ORDER BY client_id, cnt DESC
),
group1_best AS (
  SELECT DISTINCT ON (client_id) client_id, target_date
  FROM group1_dates
  ORDER BY client_id, cnt DESC
)
UPDATE public.clients c
SET target_date_group1 = g.target_date
FROM group1_best g
WHERE c.id = g.client_id;

-- Group 2: GSTR-3B, GSTR-3B (Q), ITC-04, CMP-08
WITH group2_dates AS (
  SELECT client_id, target_date, COUNT(*) as cnt
  FROM filing_status
  WHERE return_type IN ('GSTR-3B', 'GSTR-3B (Q)', 'ITC-04', 'CMP-08')
    AND target_date IS NOT NULL
  GROUP BY client_id, target_date
  ORDER BY client_id, cnt DESC
),
group2_best AS (
  SELECT DISTINCT ON (client_id) client_id, target_date
  FROM group2_dates
  ORDER BY client_id, cnt DESC
)
UPDATE public.clients c
SET target_date_group2 = g.target_date
FROM group2_best g
WHERE c.id = g.client_id;
