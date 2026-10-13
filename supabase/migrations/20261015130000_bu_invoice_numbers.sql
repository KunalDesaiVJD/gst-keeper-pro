-- BU differential invoice numbers in the characters Rule 46(b) allows
-- (13 Oct 2026). Posting numbered them "<series>BU/<unit no>" with the unit
-- number as typed, so Bapa Sitaram's became "BU/Shed No.-004" — a space and a
-- dot the portal does not take in Table 13, and it rejected the whole Sep-26
-- GSTR-1 ("Download the latest version of Offline tool …"). Same rule as
-- buInvoiceNo() in src/lib/builderBuPosting.ts: upper case, only A-Z 0-9 / -,
-- at most 16 characters. Only invoices whose number breaks the rule change.

BEGIN;

UPDATE public.builder_invoices
   SET doc_no = left(regexp_replace(upper(doc_no), '[^A-Z0-9/-]', '', 'g'), 16)
 WHERE invoice_type = 'BU_DIFFERENTIAL'
   AND doc_no IS NOT NULL
   AND doc_no !~ '^[A-Za-z0-9/-]{1,16}$';

COMMIT;
