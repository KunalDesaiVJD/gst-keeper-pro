-- Import 2B: add "Not in Books" to the 2B document action set.
-- twob_import_docs.itc_action now allows:
--   MATCHED | INELIGIBLE | ITC_OF_OTHERS | MISMATCHED | NOT_IN_BOOKS

ALTER TABLE public.twob_import_docs DROP CONSTRAINT IF EXISTS twob_import_docs_itc_action_check;
ALTER TABLE public.twob_import_docs
  ADD CONSTRAINT twob_import_docs_itc_action_check
  CHECK (itc_action IN ('MATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS', 'MISMATCHED', 'NOT_IN_BOOKS'));
