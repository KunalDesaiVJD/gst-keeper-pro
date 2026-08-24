-- Case-workflow tracking for gst_notices, so staff can log what's been done
-- about a notice (reply filed, order received, application submitted) and
-- mark it Open/Closed/Priority, instead of the table only ever holding what
-- the portal itself returned. status was always null from the portal (the
-- get/notices API never populates it) — staff_status is what the report's
-- existing "Status" column now actually shows.
ALTER TABLE public.gst_notices
  ADD COLUMN IF NOT EXISTS staff_status text,
  ADD COLUMN IF NOT EXISTS priority boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_ref_number text,
  ADD COLUMN IF NOT EXISTS reply_date date,
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS order_date date,
  ADD COLUMN IF NOT EXISTS submission_arn text,
  ADD COLUMN IF NOT EXISTS submission_date date;
