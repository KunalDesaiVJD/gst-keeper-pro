-- Builder ITC reversal: figures fetched from the portal are the superadmin's
-- to change (14 Oct 2026, the firm's request).
--
-- 20261016100000 locked them for everyone. Now a write that changes a locked
-- column is let through when the person saving it (updated_by, which the app
-- stamps with the signed-in user) is a superadmin; for anyone else it is
-- refused. For them the test is "did a locked figure change" (against the
-- row as it was), so a superadmin's correction does not block their later
-- saves of the same year; a refetch (portal rewritten) must still match what
-- was fetched. As elsewhere in this app there is no Supabase auth
-- session, so updated_by is the browser's word; the page offers the edit only
-- to a superadmin.

BEGIN;

CREATE OR REPLACE FUNCTION public.builder_itc_reversal_years_portal_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  k text;
  same_fetch boolean;
  changed boolean;
BEGIN
  IF NEW.portal IS NULL OR jsonb_typeof(NEW.portal->'fields') <> 'object' THEN
    RETURN NEW;
  END IF;
  IF NEW.updated_by IS NOT NULL AND public.has_role(NEW.updated_by, 'superadmin') THEN
    RETURN NEW;
  END IF;
  same_fetch := TG_OP = 'UPDATE' AND NEW.portal IS NOT DISTINCT FROM OLD.portal;
  FOR k IN SELECT jsonb_object_keys(NEW.portal->'fields') LOOP
    IF same_fetch THEN
      changed := (to_jsonb(NEW)->k) IS DISTINCT FROM (to_jsonb(OLD)->k);
    ELSE
      changed := (to_jsonb(NEW)->k) IS DISTINCT FROM (NEW.portal->'fields'->k);
    END IF;
    IF changed THEN
      RAISE EXCEPTION 'FY %: % was fetched from the filed GSTR-9; only a superadmin can change it.',
        NEW.financial_year, k USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

COMMIT;
