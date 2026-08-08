-- Third GSTR-1 import mode: 'json_manual'. Like 'json', the client's JSON is
-- imported/uploaded as usual — but staff can additionally open the manual
-- entry grid (Gstr1ManualEntryPanel) against the imported return and edit
-- every section (B2B, B2CS, B2CL, CDNR, CDNUR, EXP, NIL, Documents), not just
-- HSN/Documents via the existing "Edit HSN Summary" tool. Access to changing
-- a client's import mode at all is now gated by the edit_gstr1_import_mode
-- permission (frontend-enforced, see AuthContext.tsx / UserControlPage.tsx —
-- user_permissions.permission_key has no DB-side allow-list).

BEGIN;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_gstr1_import_mode_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_gstr1_import_mode_check
    CHECK (gstr1_import_mode IN ('json', 'manual', 'json_manual'));

COMMIT;
