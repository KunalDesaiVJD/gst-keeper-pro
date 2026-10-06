-- Notices Phase 0 · no cascading deletes (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf, L-14).
--
-- Deleting a client used to cascade through every notices and litigation table:
-- one click on "Delete Company" (Company List), "Delete client" (Clients) or the
-- dashboard's client list erased the client's notices with their staff status,
-- owner and remarks, every litigation matter with its hearings, payments,
-- documents and stage history, and the statutory deadlines.
--
-- The firm's own work on a dispute is now protected: a client that has notices,
-- matters or deadlines on record can no longer be deleted (the delete is refused
-- with a foreign-key error that the app turns into a plain message). Portal copies
-- and logs (refunds, DRC-03, case-folder items, sync log, events, alert log,
-- e-mail outbox) still cascade, but only ever for a client with none of the above.
ALTER TABLE public.gst_notices
  DROP CONSTRAINT IF EXISTS gst_notices_client_id_fkey,
  ADD CONSTRAINT gst_notices_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;

ALTER TABLE public.litigation_matters
  DROP CONSTRAINT IF EXISTS litigation_matters_client_id_fkey,
  ADD CONSTRAINT litigation_matters_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;

ALTER TABLE public.matter_deadlines
  DROP CONSTRAINT IF EXISTS matter_deadlines_client_id_fkey,
  ADD CONSTRAINT matter_deadlines_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;
