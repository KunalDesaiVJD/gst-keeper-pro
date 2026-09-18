-- Field-level version history for GSTR-1 and GSTR-3B pushes.
--
-- Both version tables already record WHO pushed and WHEN, plus a one-line
-- summary. That is enough to see that something changed between two attempts,
-- and useless for finding WHAT changed — which row, which figure, from what to
-- what. Tracing a mistake back to the person and the field currently means
-- opening the portal and comparing by eye.
--
-- Storing the exact payload pushed at each version turns the history into a
-- real audit trail: any two versions can be diffed on demand, so a wrong figure
-- can be traced to the version that introduced it and, from the row already
-- there, to the person who pushed it.
--
-- The diff is computed at read time rather than stored, so it stays correct if
-- the labelling improves, and so any pair of versions can be compared, not just
-- consecutive ones. The payload is the evidence; the diff is a view of it.

ALTER TABLE public.gstr1_upload_versions
  ADD COLUMN IF NOT EXISTS payload jsonb;

ALTER TABLE public.gstr3b_push_versions
  ADD COLUMN IF NOT EXISTS payload jsonb;

COMMENT ON COLUMN public.gstr1_upload_versions.payload IS
  'The GSTR-1 JSON exactly as it stood for this action. Diffed against an earlier version to show which invoice/row changed and by how much.';

COMMENT ON COLUMN public.gstr3b_push_versions.payload IS
  'The GSTR-3B JSON exactly as pushed for this attempt. Diffed against an earlier version to show which table row changed and by how much.';
