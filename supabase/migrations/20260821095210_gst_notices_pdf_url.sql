-- Notice/Order PDF capture. Confirmed live (2026-08-21): the portal's own
-- get/notices list response already carries docId + applnId per row, and
-- GET /document/{docId}/{applnId} serves the PDF directly — no encrypted
-- token needed, same simple pattern as the Registration Certificate. One PDF
-- per notice/order row, unlike Refund's multiple-document-types-per-ARN.
ALTER TABLE public.gst_notices ADD COLUMN IF NOT EXISTS pdf_url text;
