
-- Fix inconsistent target dates: for each client+return_type group, 
-- set all records to the most recently updated target_date value
WITH latest_targets AS (
  SELECT DISTINCT ON (client_id, return_type) 
    client_id, return_type, target_date
  FROM filing_status 
  WHERE target_date IS NOT NULL
  ORDER BY client_id, return_type, updated_at DESC NULLS LAST
)
UPDATE filing_status fs
SET target_date = lt.target_date
FROM latest_targets lt
WHERE fs.client_id = lt.client_id 
  AND fs.return_type = lt.return_type 
  AND (fs.target_date IS NULL OR fs.target_date != lt.target_date);
