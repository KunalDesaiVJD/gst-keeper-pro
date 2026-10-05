-- Annual Return (GSTR-9 / GSTR-9C): figures that come from a source are
-- locked to the superadmin.
--
-- Two kinds of figure in the workings are not typed by staff:
--   * portal data (doc_key 'portal'): the GSTR-9 system-computed figures and
--     the as-filed GSTR-3B, pulled by the browser extension or uploaded. Staff
--     may still import them (pull / upload); typing over one — which marks its
--     path in data->'manual' — is the superadmin's alone;
--   * figures the working fills in from another table or return, stored as an
--     override field that is null while the filled-in figure is used (GSTR-9
--     6A1, 6G, 7E, Table 9 payable, Table 12; Annexure-3 excess ITC (from
--     Table 12); GSTR-9C 5A, 5Q, 7B–7D1, 7F, Table 9, 9Q, 12A–12C; the notice
--     format rows read from GSTR-9, the GSTR-3B and Annexure-4).
--
-- The app has no database session, so the role is the one the app declares
-- (save_annual_return_doc's p_role), as for the verify-and-lock RPC. A save
-- that changes one of these figures with another role is refused; one by the
-- superadmin is labelled in the change log. A save that declares no role (an
-- app build from before this lock) is not checked. Keep the list in step with
-- src/lib/gstr9/sourceLock.ts.

-- A jsonb value with its null leaves and empty objects removed (NULL when
-- nothing is left), so "not typed" compares equal however it is spelt:
-- absent, null, {"i": null, "c": null}, {"f": {}} …
CREATE OR REPLACE FUNCTION public.annual_return_strip(v jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  r jsonb := '{}'::jsonb;
  k text;
  x jsonb;
  s jsonb;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v) <> 'object' THEN
    RETURN v;
  END IF;
  FOR k, x IN SELECT e.key, e.value FROM jsonb_each(v) e LOOP
    s := public.annual_return_strip(x);
    IF s IS NOT NULL THEN
      r := r || jsonb_build_object(k, s);
    END IF;
  END LOOP;
  RETURN CASE WHEN r = '{}'::jsonb THEN NULL ELSE r END;
END;
$$;

-- The locked fields of each sheet, as dot paths into its data.
CREATE OR REPLACE FUNCTION public.annual_return_locked_fields(p_doc_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_doc_key
    WHEN 'portal' THEN ARRAY['manual', 'f']
    WHEN 'gstr9' THEN ARRAY['t6A1', 't6G', 't7.s17_5', 't9Payable', 't12']
    WHEN 'annexures' THEN ARRAY['a3ExcessItc']
    WHEN 'gstr9c' THEN ARRAY['t5A', 't5Q', 't7', 't7F', 't9', 't9Q', 't12A', 't12B', 't12C']
    WHEN 'notice' THEN ARRAY['deemedSupplies', 'unreturnedGoods', 'pendingDemands', 'prevYear8C', 'ineligible4D', 'itcUsed4A5', 'reversed4B2']
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION public.annual_return_docs_source_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := NULLIF(current_setting('annual_return.role', true), '');
  v_key text := CASE WHEN TG_OP = 'DELETE' THEN OLD.doc_key ELSE NEW.doc_key END;
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN OLD.data END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN NEW.data END;
  v_paths text[] := public.annual_return_locked_fields(v_key);
  v_changed text[] := ARRAY[]::text[];
  p text;
BEGIN
  -- A save that declares no role (an app build from before this lock) is not checked:
  -- the role is self-declared anyway, so this guards the app's own flows, not a hostile client.
  IF v_role IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Portal data: every figure typed by hand (old or new) keeps its value.
  IF v_key = 'portal' THEN
    v_paths := v_paths || ARRAY(
      SELECT k FROM jsonb_object_keys(COALESCE(v_old->'manual', '{}'::jsonb)) k
      UNION
      SELECT k FROM jsonb_object_keys(COALESCE(v_new->'manual', '{}'::jsonb)) k
    );
  END IF;

  FOREACH p IN ARRAY v_paths LOOP
    IF public.annual_return_strip(v_old #> string_to_array(p, '.'))
       IS DISTINCT FROM public.annual_return_strip(v_new #> string_to_array(p, '.')) THEN
      v_changed := v_changed || p;
    END IF;
  END LOOP;

  IF cardinality(v_changed) > 0 THEN
    IF v_role <> 'superadmin' THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_SOURCE_LOCKED: % (%) can be changed only by a superadmin.', v_key, array_to_string(v_changed, ', ')
        USING ERRCODE = 'P0001';
    END IF;
    -- The change log (annual_return_docs_log, AFTER) records the label.
    PERFORM set_config(
      'annual_return.action',
      COALESCE(NULLIF(current_setting('annual_return.action', true), ''), 'Edited') || ' — superadmin, locked figure',
      true
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS annual_return_docs_source_lock ON public.annual_return_docs;
CREATE TRIGGER annual_return_docs_source_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.annual_return_docs
  FOR EACH ROW EXECUTE FUNCTION public.annual_return_docs_source_lock();

-- ---------------------------------------------------------------------------
-- Save RPC: + p_role, the role the app declares for the user.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_annual_return_doc(uuid, text, text, jsonb, integer, text, boolean, text);

CREATE OR REPLACE FUNCTION public.save_annual_return_doc(
  p_client_id uuid,
  p_financial_year text,
  p_doc_key text,
  p_data jsonb,
  p_expected_version integer,
  p_updated_by text,
  p_force_history boolean DEFAULT false,
  p_action text DEFAULT NULL,
  p_role text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_version integer;
BEGIN
  PERFORM set_config('annual_return.force_history', CASE WHEN COALESCE(p_force_history, false) THEN 'on' ELSE 'off' END, true);
  PERFORM set_config('annual_return.action', COALESCE(p_action, ''), true);
  PERFORM set_config('annual_return.role', COALESCE(p_role, ''), true);

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
  PERFORM set_config('annual_return.action', '', true);
  PERFORM set_config('annual_return.role', '', true);

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_VERSION_CONFLICT: % was changed by someone else.', p_doc_key
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v_version;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_annual_return_doc(uuid, text, text, jsonb, integer, text, boolean, text, text) TO anon, authenticated;
