-- Client Registration Cancellation Date
--
-- Adds a new column to `clients` that records the date on which the GST
-- registration was actually cancelled. This is DIFFERENT from the existing
-- `cancellation_date` column, which was originally labeled "Cancellation Date"
-- in the UI but has been relabeled to "GSTR 10 Date" — it drives the Filing
-- Status cutoff (client stops appearing in filing lists after that date).
--
-- The new `registration_cancellation_date` is informational only: no downstream
-- logic reads it yet. It exists so the CA can record when the taxpayer's GST
-- registration was cancelled, independent of when the final GSTR-10 return
-- was filed.

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS registration_cancellation_date date;

COMMENT ON COLUMN public.clients.registration_cancellation_date IS
  'Date on which the GST registration was cancelled. Informational; the Filing Status cutoff is driven by cancellation_date (relabeled GSTR 10 Date in the UI).';

COMMIT;
