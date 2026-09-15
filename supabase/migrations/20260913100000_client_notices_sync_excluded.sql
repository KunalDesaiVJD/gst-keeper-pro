-- Client "Exclude from Notices Dashboard sync" flag
--
-- Boolean toggle exposed on Edit Client. Most clients don't need their
-- Notices/Refunds/DRC-03 case data pulled at all — this lets staff opt a
-- specific client OUT of the Notices Dashboard's "Sync All" and Company
-- List's notices sync selection, without affecting anything else (Reports
-- Hub's own per-client Pull buttons still work regardless of this flag —
-- a staff member explicitly choosing that client and clicking Pull is a
-- deliberate one-off action, not the "I don't care about notices for this
-- client" default this flag expresses).
--
-- Defaults to false (included) so every existing client keeps today's
-- behavior until someone actively opts them out.

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS notices_sync_excluded boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.notices_sync_excluded IS
  'When true, this client is skipped by Notices Dashboard''s "Sync All" (extension/background.js startAllClientsSectionPull, notices/notices_bundle modes only) and hidden from Company List''s notices sync selection. Set via the "Exclude from Notices Dashboard sync" checkbox in Edit Client. Does not affect Reports Hub''s own per-client Pull buttons.';

COMMIT;
