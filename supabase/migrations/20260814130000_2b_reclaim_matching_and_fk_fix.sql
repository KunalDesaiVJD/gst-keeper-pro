-- Fix a schema landmine + add proper reclaim-by-matching.
--
-- 1) bills_not_in_2b.updated_by / bills_not_in_books.updated_by referenced
--    auth.users(id) from the original Lovable-era schema. This app's custom
--    auth (src/contexts/AuthContext.tsx) never creates auth.users rows for
--    staff — session identity lives in profiles/user_roles — so any write
--    that set updated_by to the current session's user id violated the FK.
--    Every other user-audit column in this schema (twob_import_docs.updated_by,
--    books_register.updated_by, itc_summaries.updated_by, etc.) is a plain
--    uuid with no FK for exactly this reason; bring these two in line.
--
-- 2) Reclaim-by-matching: a freshly imported 2B doc can now be classified
--    RECLAIM, linked to the specific previously-reversed bills_not_in_2b row
--    it evidences the return of. Without this link, a reappearing invoice
--    would either get counted twice (once as fresh row-5.1 ITC via MATCHED,
--    once as a row-5.4/4D reclaim) or require staff to self-certify a
--    reclaim with no evidence it's actually back in 2B.

BEGIN;

ALTER TABLE public.bills_not_in_2b DROP CONSTRAINT IF EXISTS bills_not_in_2b_updated_by_fkey;
ALTER TABLE public.bills_not_in_books DROP CONSTRAINT IF EXISTS bills_not_in_books_updated_by_fkey;

ALTER TABLE public.twob_import_docs DROP CONSTRAINT IF EXISTS twob_import_docs_itc_action_check;
ALTER TABLE public.twob_import_docs
  ADD CONSTRAINT twob_import_docs_itc_action_check
  CHECK (itc_action IN ('MATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS', 'MISMATCHED', 'NOT_IN_BOOKS', 'RECLAIM'));

ALTER TABLE public.bills_not_in_2b
  ADD COLUMN IF NOT EXISTS reclaimed_via_doc_id uuid REFERENCES public.twob_import_docs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bills_not_in_2b_reclaimed_via_doc_id
  ON public.bills_not_in_2b (reclaimed_via_doc_id) WHERE reclaimed_via_doc_id IS NOT NULL;

COMMIT;
