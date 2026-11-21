-- Client service categories (Kunal, 21 Nov 2026): Edit Client says which of
-- the firm's services a client takes, in any combination, and each module
-- lists only its own clients.
--
--   Returns filing        clients.returns_filing (new, default true)
--                         -> Filing Status and the staff dashboard's filing counts
--   GSTR-9 / 9C           clients.annual_return_assigned (new, default false)
--                         -> the Annual Return register and client picker
--   Notices & Litigation  clients.notices_handled (existing, 20261010100000)
--                         -> notice_facts, the notices sync, Notices -> Clients
--
-- Notices & Litigation reuses notices_handled rather than adding a third
-- column, so Edit Client and Notices -> Settings flip the same switch.
--
-- Existing clients keep what they see today:
--   returns_filing          true for every client (the default)
--   annual_return_assigned  true for a client that already has anything in
--                           the Annual Return module (a working, a sign-off
--                           period, or a turnover / opt-in row), else false
--   notices_handled         unchanged

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS returns_filing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS annual_return_assigned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.returns_filing IS
  'Service category: the firm files this client''s periodic returns. Off = left out of Filing Status (20261121100000).';
COMMENT ON COLUMN public.clients.annual_return_assigned IS
  'Service category: GSTR-9 / 9C assignment. Off = left out of the Annual Return register (20261121100000).';

UPDATE public.clients c
   SET annual_return_assigned = true
 WHERE NOT c.annual_return_assigned
   AND (EXISTS (SELECT 1 FROM public.annual_return_docs d WHERE d.client_id = c.id)
     OR EXISTS (SELECT 1 FROM public.annual_return_periods p WHERE p.client_id = c.id)
     OR EXISTS (SELECT 1 FROM public.client_annual_turnover t WHERE t.client_id = c.id));

-- The change log keeps the client's GST fields (20261021150000); the two
-- categories join them. Same list as there, plus the two new columns.
SELECT public.gst_change_log_attach('clients', p_client => 'r.id', p_month => 'NULL',
  p_only => '{gstin,name,registration_type,registration_date,selected_returns,assigned_accountant,cancellation_date,registration_cancellation_date,regular_sub_type,builder_itc_type,commercial_area,residential_area,target_date_group1,target_date_group2,inactive_at_hand,gstr1_import_mode,notices_handled,notices_tracks_off,einvoice_applicable,einvoice_exemption,gst_user_id,gst_password_changed_at,liberal_2b_reconciliation,liberal_changed_by,liberal_changed_at,returns_filing,annual_return_assigned}');
