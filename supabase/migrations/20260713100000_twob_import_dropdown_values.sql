-- Import 2B — finalize the dropdown option values (Phase 3 spec).
--
-- twob_import_docs.itc_action : MATCHED | INELIGIBLE | ITC_OF_OTHERS | MISMATCHED  (default MATCHED)
-- books_register.book_treatment: NOT_IN_2B | MISMATCHED | NOT_ELIGIBLE            (default NOT_IN_2B)
--
-- The single dropdown per row now carries the full disposition, so the separate
-- match_status columns are redundant and are dropped. The matched_*_id links stay
-- (used to pair a mismatched book row with its 2B doc). Tables are empty, so the
-- UPDATE guards are just belt-and-braces.

BEGIN;

-- 2B docs -------------------------------------------------------------------
ALTER TABLE public.twob_import_docs DROP CONSTRAINT IF EXISTS twob_import_docs_itc_action_check;
UPDATE public.twob_import_docs
  SET itc_action = 'MATCHED'
  WHERE itc_action IS NULL OR itc_action NOT IN ('MATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS', 'MISMATCHED');
ALTER TABLE public.twob_import_docs ALTER COLUMN itc_action SET DEFAULT 'MATCHED';
ALTER TABLE public.twob_import_docs
  ADD CONSTRAINT twob_import_docs_itc_action_check
  CHECK (itc_action IN ('MATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS', 'MISMATCHED'));
ALTER TABLE public.twob_import_docs DROP COLUMN IF EXISTS match_status;

-- books register ------------------------------------------------------------
ALTER TABLE public.books_register DROP CONSTRAINT IF EXISTS books_register_book_treatment_check;
UPDATE public.books_register
  SET book_treatment = 'NOT_IN_2B'
  WHERE book_treatment IS NULL OR book_treatment NOT IN ('NOT_IN_2B', 'MISMATCHED', 'NOT_ELIGIBLE');
ALTER TABLE public.books_register ALTER COLUMN book_treatment SET DEFAULT 'NOT_IN_2B';
ALTER TABLE public.books_register ALTER COLUMN book_treatment SET NOT NULL;
ALTER TABLE public.books_register
  ADD CONSTRAINT books_register_book_treatment_check
  CHECK (book_treatment IN ('NOT_IN_2B', 'MISMATCHED', 'NOT_ELIGIBLE'));
ALTER TABLE public.books_register DROP COLUMN IF EXISTS match_status;

COMMIT;
