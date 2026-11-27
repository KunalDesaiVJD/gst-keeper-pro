-- Client "Inactive from" date (27 Nov 2026)
--
-- When a client is marked "Inactive at hand" in Edit Client, the firm now also
-- records the date it became inactive. The Annual Return (GSTR-9 / 9C) of the
-- year that date falls in still opens, covering only the months the client was
-- active: 1 April (or the registration date) to the day before the earlier of
-- this date and registration_cancellation_date (src/lib/gstr9/activePeriod.ts,
-- docs/GSTR9_9C_WORKINGS.md §13). Later years are not applicable.
--
-- No policy change: clients keeps its existing open-to-public policies and the
-- staff_client_scope_guard. Idempotent.

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS inactive_from date;

COMMENT ON COLUMN public.clients.inactive_from IS
  'The client is inactive from this date (that day is not active). Set with "Inactive at hand" in Edit Client. The Annual Return of that FY covers only the months before it.';

COMMIT;
