-- Import 2B — Phase 4: write-through into the live reconciliation ledger.
--
-- Import 2B (twob_import_docs / books_register) becomes the single entry
-- point for classification. A "Post to Reconciliation" action syncs the
-- exception buckets into the existing bills_not_in_2b / bills_not_in_books
-- running sheets, which stay the source ITC Summary / Suspended Reco /
-- carry-forward already read from — that engine is unchanged.
--
-- source_book_id / source_doc_id mark rows the sync engine owns, so re-posting
-- can safely insert/update/retract them without touching rows added the old
-- way (manually on 2B Reconciliation) or carried-forward copies (which are
-- never linked back to a specific period's staging row).

BEGIN;

ALTER TABLE public.twob_import_docs
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by uuid;

ALTER TABLE public.books_register
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by uuid;

ALTER TABLE public.bills_not_in_2b
  ADD COLUMN IF NOT EXISTS source_book_id uuid REFERENCES public.books_register(id) ON DELETE SET NULL;

ALTER TABLE public.bills_not_in_books
  ADD COLUMN IF NOT EXISTS source_doc_id uuid REFERENCES public.twob_import_docs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bills_not_in_2b_source_book_id
  ON public.bills_not_in_2b (source_book_id) WHERE source_book_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bills_not_in_books_source_doc_id
  ON public.bills_not_in_books (source_doc_id) WHERE source_doc_id IS NOT NULL;

COMMIT;
