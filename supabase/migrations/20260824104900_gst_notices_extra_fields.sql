-- Closing the remaining column gap against Notice Alert's export (compared
-- live 2026-08-24): case_id and issued_by are auto-captured from fields the
-- portal already returns (get/notices' own issuedBy; case/task/get's own
-- arn, for LUT/DRC-03-voluntary-payment rows) but the extension previously
-- discarded — no manual entry needed for those two. The rest have no portal
-- source and are staff-editable, same convention as the reply/order/
-- submission tracking columns already added.
ALTER TABLE public.gst_notices
  ADD COLUMN IF NOT EXISTS case_id text,
  ADD COLUMN IF NOT EXISTS issued_by text,
  ADD COLUMN IF NOT EXISTS extended_due_date date,
  ADD COLUMN IF NOT EXISTS amount_of_demand numeric,
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS financial_year text,
  ADD COLUMN IF NOT EXISTS assign_to text;
