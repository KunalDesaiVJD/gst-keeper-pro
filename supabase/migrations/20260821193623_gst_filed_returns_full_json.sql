-- The GSTR-1 "Offline Download" ZIP the portal itself generates (Services >
-- Returns > GSTR > Offline Download for GSTR-1, "Generate JSON File to
-- Download") is the SAME invoice-level JSON schema this app already uses for
-- its own pre-filing draft (gstr1_data.raw_json) — confirmed live
-- (2026-08-21): GET /returns/auth/api/offline/download/generate?flag=0&
-- rtn_prd=MMYYYY&rtn_typ=GSTR1 returns {status:1, data:{url}} pointing to a
-- ZIP on files.gst.gov.in containing that JSON once generation finishes
-- (can take up to 20 minutes). Stored separately from `summary` (the
-- lighter section-total JSON from gstr1_pull) since this is a materially
-- bigger payload only some reports need — the invoice-level rate-wise/HSN/
-- customer-wise breakdowns can now reuse the app's existing GSTR-1 parsers
-- against the real FILED return instead of the books draft.
ALTER TABLE public.gst_filed_returns ADD COLUMN IF NOT EXISTS full_json jsonb;
ALTER TABLE public.gst_filed_returns ADD COLUMN IF NOT EXISTS full_json_pulled_at timestamptz;
