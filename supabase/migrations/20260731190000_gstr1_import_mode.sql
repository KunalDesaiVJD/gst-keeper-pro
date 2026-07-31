-- GSTR-1 import mode per client: some clients hand over their Tally-exported
-- GSTR-1 JSON directly (import via this app); others only send raw bills and
-- their GSTR-1 is prepared entirely outside this app (Excel / portal online
-- entry). For the latter, the Import JSON / Upload buttons on the GSTR-1 page
-- are not applicable and should be hidden.

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS gstr1_import_mode text NOT NULL DEFAULT 'json';

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_gstr1_import_mode_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_gstr1_import_mode_check
    CHECK (gstr1_import_mode IN ('json', 'manual'));

COMMIT;
