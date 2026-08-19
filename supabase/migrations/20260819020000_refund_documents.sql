-- Refund applications previously carried no document PDFs at all — unlike
-- DRC-03 (a JSON API with per-filing doc IDs), the Refund tracker is
-- DOM-scraped, so document capture requires opening each ARN's own detail
-- view and following whatever links it exposes. A refund application can
-- have up to three separate documents worth keeping: the filed application
-- itself, a query memo (if the officer raised one), and the sanction/
-- rejection order — kept as three columns rather than one so each can be
-- opened directly from a report without guessing which is which.

ALTER TABLE public.gst_refund_applications
  ADD COLUMN IF NOT EXISTS application_pdf_url text,
  ADD COLUMN IF NOT EXISTS query_memo_pdf_url text,
  ADD COLUMN IF NOT EXISTS order_pdf_url text;
