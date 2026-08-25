-- Notice Alert's own Priority Status is a 3-tier Low/Medium/High (confirmed
-- live 2026-08-25 via its bulk "Priority" toolbar action and filter
-- dropdown), not the plain boolean this table had. Existing High-priority
-- flags are preserved; everything else becomes unset (no tier), matching
-- Notice Alert's own "-" default.
ALTER TABLE public.gst_notices ADD COLUMN priority_new text;
UPDATE public.gst_notices SET priority_new = CASE WHEN priority THEN 'High' ELSE NULL END;
ALTER TABLE public.gst_notices DROP COLUMN priority;
ALTER TABLE public.gst_notices RENAME COLUMN priority_new TO priority;
ALTER TABLE public.gst_notices ADD CONSTRAINT gst_notices_priority_check CHECK (priority IN ('Low', 'Medium', 'High') OR priority IS NULL);
