-- Portal upload tracking for GSTR-1: separate from the old Humonex "push"
-- columns (which are being retired). Extension writes to these when it
-- finishes uploading a return so the app can show per-invoice validation
-- errors returned by the portal without having to re-open the portal tab.

BEGIN;

ALTER TABLE public.gstr1_data
  ADD COLUMN IF NOT EXISTS last_uploaded_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_uploaded_by   uuid,
  ADD COLUMN IF NOT EXISTS last_upload_status text,     -- 'accepted' | 'partial' | 'failed'
  ADD COLUMN IF NOT EXISTS last_upload_summary text,    -- human summary line
  ADD COLUMN IF NOT EXISTS last_upload_errors  jsonb;   -- [{invoiceNo, gstin, reason}, ...]

COMMIT;
