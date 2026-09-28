-- Annual Return workspace: history snapshots that actually happen.
--
-- The first version archived the replaced doc only when OLD.updated_at was
-- older than 10 minutes. The workspace autosaves every few seconds, so a
-- whole afternoon's work by one person kept updated_at fresh and never left a
-- single snapshot — Version history stayed empty. The throttle now looks at
-- the history itself: one snapshot per doc per 10 minutes (and always when a
-- different person saves).
--
-- A restore from Version history must always keep the version it replaces,
-- even inside that window, so save_annual_return_doc() takes
-- p_force_history, passed through to the trigger via a transaction-local
-- setting.

CREATE OR REPLACE FUNCTION public.annual_return_docs_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_client uuid := COALESCE(NEW.client_id, OLD.client_id);
  v_fy text := COALESCE(NEW.financial_year, OLD.financial_year);
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.annual_return_periods p
    WHERE p.client_id = v_client AND p.financial_year = v_fy AND p.status = 'locked'
  ) THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_LOCKED: FY % is locked for this client. Unlock it before editing.', v_fy
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NOT EXISTS (
      SELECT 1 FROM public.annual_return_doc_history h
      WHERE h.doc_id = OLD.id AND h.archived_at > now() - interval '10 minutes'
    )
    OR OLD.updated_by IS DISTINCT FROM NEW.updated_by
    OR current_setting('annual_return.force_history', true) = 'on'
  ) THEN
    INSERT INTO public.annual_return_doc_history
      (doc_id, client_id, financial_year, doc_key, data, version, updated_by, updated_at)
    VALUES
      (OLD.id, OLD.client_id, OLD.financial_year, OLD.doc_key, OLD.data, OLD.version, OLD.updated_by, OLD.updated_at);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.save_annual_return_doc(uuid, text, text, jsonb, integer, text);

CREATE OR REPLACE FUNCTION public.save_annual_return_doc(
  p_client_id uuid,
  p_financial_year text,
  p_doc_key text,
  p_data jsonb,
  p_expected_version integer,
  p_updated_by text,
  p_force_history boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_version integer;
BEGIN
  IF COALESCE(p_force_history, false) THEN
    PERFORM set_config('annual_return.force_history', 'on', true);
  END IF;

  IF COALESCE(p_expected_version, 0) = 0 THEN
    INSERT INTO public.annual_return_docs (client_id, financial_year, doc_key, data, version, updated_by)
    VALUES (p_client_id, p_financial_year, p_doc_key, p_data, 1, p_updated_by)
    ON CONFLICT (client_id, financial_year, doc_key) DO NOTHING
    RETURNING version INTO v_version;
  ELSE
    UPDATE public.annual_return_docs
       SET data = p_data,
           version = version + 1,
           updated_by = p_updated_by,
           updated_at = now()
     WHERE client_id = p_client_id
       AND financial_year = p_financial_year
       AND doc_key = p_doc_key
       AND version = p_expected_version
    RETURNING version INTO v_version;
  END IF;

  PERFORM set_config('annual_return.force_history', 'off', true);

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_VERSION_CONFLICT: % was changed by someone else.', p_doc_key
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v_version;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_annual_return_doc(uuid, text, text, jsonb, integer, text, boolean) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
