-- Not every promoter raises milestone invoices.
--
-- Many collect against the agreement and never issue a tax invoice until the BU
-- differential falls due, so every invoice-shaped control on screen is dead
-- weight for them — and worse, an invitation to record a document that was
-- never issued. Asked once at client setup; when false the app hides invoicing,
-- and Table 7 and Table 11B simply never arise for that client.
--
-- Defaults true so existing clients are unchanged until someone answers.
ALTER TABLE public.builder_client_settings
  ADD COLUMN IF NOT EXISTS raises_invoices boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.builder_client_settings.raises_invoices IS
  'False for promoters who collect against the agreement without issuing '
  'milestone tax invoices. Hides invoicing; Table 7 and 11B cannot arise.';
