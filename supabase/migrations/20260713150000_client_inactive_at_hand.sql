-- Client "Inactive at hand" flag
--
-- Boolean toggle exposed on Add/Edit Client forms. When true, the client is
-- hidden from Filing Status regardless of registration_date / cancellation_date.
-- Complements the existing `cancellation_date` (GSTR 10 Date) cutoff — the
-- CA might mark a client inactive without a formal cancellation date on file.

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS inactive_at_hand boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.inactive_at_hand IS
  'When true, this client is hidden from Filing Status. Set via the "Inactive at hand" checkbox in Add/Edit Client.';

COMMIT;
