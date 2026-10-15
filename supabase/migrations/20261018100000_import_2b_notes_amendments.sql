-- Import 2B reads the whole B2B family of the GSTR-2B Excel: invoices (B2B),
-- supplier debit and credit notes (B2B-CDNR), amendments of both (B2BA,
-- B2B-CDNRA), and the Rule 37A reversal and IMS rejected sheets of each.
-- Until now only the B2B invoice sheets were read; notes and amendments were
-- dropped without a word, so the reconciliation was wrong (14 Oct 2026).
--
-- The firm's positions (14 Oct 2026, docs/2B_RECONCILIATION_FLOW.md §10):
--  - A supplier debit note is claimed like an invoice (ITC Summary row 5.1).
--  - A supplier credit note reduces ITC through row 5.3 "Debit Note", which
--    fills itself from the 2B credit notes for Strict clients (staff stop
--    typing it); Liberal and No-ITC clients keep typing it.
--  - An amendment counts only its difference: revised minus the version
--    already counted (base_*), following that version's treatment. The
--    confirmed original is never touched. With no earlier version in Import
--    2B, the amendment is HELD (counted nowhere) until staff decide.
--
-- Columns on twob_import_docs:
--   doc_type             INVOICE / DEBIT_NOTE / CREDIT_NOTE (amounts stay
--                        positive as on the 2B; the type gives the sign)
--   is_amendment         from an amendment sheet
--   original_doc_*       the original document the amendment names
--   amends_doc_id        the earlier version found in Import 2B (if any)
--   amends_period        its period, MM/YYYY
--   base_*               what that version counted (its full figures), so the
--                        difference stays fixed even if the original is
--                        later deleted
--   ims_reduce_required  credit notes: IMS "Whether ITC to be reduced"
--   declared_*           credit notes: IMS "Amount declared for ITC reduction"
--   full_2b              written by an import that read every B2B sheet; a
--                        month with such rows has its credit notes in Import
--                        2B, so row 5.3 may fill itself. Older imports
--                        (invoices only) keep row 5.3 as typed.
-- books_register gets doc_type (INVOICE / DEBIT_NOTE) so a books entry is
-- matched only against 2B documents of its own type. A credit note missing
-- from 2B has no ledger entry: row 5.3 reduces ITC by what 2B gives.
--
-- RLS: unchanged; both tables keep their open policies (USING true / WITH
-- CHECK true) from 20260711130000_twob_import_staging.sql.
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS first.

BEGIN;

ALTER TABLE public.twob_import_docs
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'INVOICE',
  ADD COLUMN IF NOT EXISTS is_amendment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_doc_number text,
  ADD COLUMN IF NOT EXISTS original_doc_date date,
  ADD COLUMN IF NOT EXISTS original_doc_type text,
  ADD COLUMN IF NOT EXISTS amends_doc_id uuid,
  ADD COLUMN IF NOT EXISTS amends_period text,
  ADD COLUMN IF NOT EXISTS base_taxable_value numeric(15,2),
  ADD COLUMN IF NOT EXISTS base_input_igst numeric(15,2),
  ADD COLUMN IF NOT EXISTS base_input_cgst numeric(15,2),
  ADD COLUMN IF NOT EXISTS base_input_sgst numeric(15,2),
  ADD COLUMN IF NOT EXISTS base_cess numeric(15,2),
  ADD COLUMN IF NOT EXISTS ims_reduce_required text,
  ADD COLUMN IF NOT EXISTS declared_igst numeric(15,2),
  ADD COLUMN IF NOT EXISTS declared_cgst numeric(15,2),
  ADD COLUMN IF NOT EXISTS declared_sgst numeric(15,2),
  ADD COLUMN IF NOT EXISTS declared_cess numeric(15,2),
  ADD COLUMN IF NOT EXISTS full_2b boolean NOT NULL DEFAULT false;

ALTER TABLE public.twob_import_docs DROP CONSTRAINT IF EXISTS twob_import_docs_doc_type_check;
ALTER TABLE public.twob_import_docs ADD CONSTRAINT twob_import_docs_doc_type_check
  CHECK (doc_type IN ('INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE'));
ALTER TABLE public.twob_import_docs DROP CONSTRAINT IF EXISTS twob_import_docs_original_doc_type_check;
ALTER TABLE public.twob_import_docs ADD CONSTRAINT twob_import_docs_original_doc_type_check
  CHECK (original_doc_type IS NULL OR original_doc_type IN ('INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE'));
ALTER TABLE public.twob_import_docs DROP CONSTRAINT IF EXISTS twob_import_docs_ims_reduce_required_check;
ALTER TABLE public.twob_import_docs ADD CONSTRAINT twob_import_docs_ims_reduce_required_check
  CHECK (ims_reduce_required IS NULL OR ims_reduce_required IN ('YES', 'NO'));

-- HELD: an amendment whose earlier version is not in Import 2B; counted nowhere.
ALTER TABLE public.twob_import_docs DROP CONSTRAINT IF EXISTS twob_import_docs_itc_action_check;
ALTER TABLE public.twob_import_docs ADD CONSTRAINT twob_import_docs_itc_action_check
  CHECK (itc_action IN ('MATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS', 'MISMATCHED', 'NOT_IN_BOOKS', 'RECLAIM', 'HELD'));

ALTER TABLE public.twob_import_docs DROP CONSTRAINT IF EXISTS twob_import_docs_amends_doc_id_fkey;
ALTER TABLE public.twob_import_docs ADD CONSTRAINT twob_import_docs_amends_doc_id_fkey
  FOREIGN KEY (amends_doc_id) REFERENCES public.twob_import_docs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS twob_import_docs_amends_doc_idx ON public.twob_import_docs (amends_doc_id) WHERE amends_doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS twob_import_docs_client_gstin_idx ON public.twob_import_docs (client_id, supplier_gstin);

ALTER TABLE public.books_register
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'INVOICE';
ALTER TABLE public.books_register DROP CONSTRAINT IF EXISTS books_register_doc_type_check;
ALTER TABLE public.books_register ADD CONSTRAINT books_register_doc_type_check
  CHECK (doc_type IN ('INVOICE', 'DEBIT_NOTE'));

COMMIT;
