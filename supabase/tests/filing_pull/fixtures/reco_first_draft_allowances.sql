-- The reco branch's first draft of the shared allowance block (never applied
-- live), as round 1 of the review found it: manual_source_allow / _revoke
-- returned jsonb, the guard read app.manual_source, and manual_source_use
-- stood for manual_source_take. run.sh applies it before 20261021110000 to
-- check that the filing migration still applies over it.
CREATE TABLE IF NOT EXISTS public.manual_source_allowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL CHECK (period_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  scope text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  allowed_by uuid NOT NULL,
  allowed_at timestamptz NOT NULL DEFAULT now(),
  used_by uuid,
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS manual_source_allowances_one_live ON public.manual_source_allowances (client_id, period_month, scope) WHERE revoked_at IS NULL;
ALTER TABLE public.manual_source_allowances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manual_source_allowances_public ON public.manual_source_allowances;
CREATE POLICY manual_source_allowances_public ON public.manual_source_allowances FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_source_allowances TO anon, authenticated, service_role;

-- Rows change only inside manual_source_allow / manual_source_revoke /
-- manual_source_use (app.manual_source = 'on' for that moment), never by a
-- direct write. A client's deletion still removes its rows (the cascade runs
-- one trigger level down).
CREATE OR REPLACE FUNCTION public.manual_source_allowances_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('app.manual_source', true), '') = 'on'
     OR (TG_OP = 'DELETE' AND pg_trigger_depth() > 1) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Manual entries are allowed and revoked only by the superadmin, on the page concerned.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS trg_manual_source_allowances_guard ON public.manual_source_allowances;
CREATE TRIGGER trg_manual_source_allowances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.manual_source_allowances
  FOR EACH ROW EXECUTE FUNCTION public.manual_source_allowances_guard();

-- The superadmin allows a manual entry for one client, month and scope
-- (e.g. 'reco:suspended', 'filing:GSTR-3B'). One live allowance per client,
-- month and scope: revoke the old one first.
CREATE OR REPLACE FUNCTION public.manual_source_allow(
  p_actor_id uuid, p_client_id uuid, p_period text, p_scope text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := btrim(coalesce(p_scope, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row public.manual_source_allowances;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can allow a manual entry.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_period IS NULL OR p_period !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    RAISE EXCEPTION 'The month must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_scope !~ '^[a-z0-9_]+:[A-Za-z0-9][A-Za-z0-9 ()/._-]*$' OR length(v_scope) > 60 THEN
    RAISE EXCEPTION 'Unknown scope "%".', v_scope USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Give a reason of at least 5 characters.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'No such client.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('manual_source:' || p_client_id::text || ':' || p_period || ':' || v_scope, 0));
  IF EXISTS (SELECT 1 FROM public.manual_source_allowances
              WHERE client_id = p_client_id AND period_month = p_period AND scope = v_scope AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'A manual entry is already allowed for this client and month. Revoke it first.'
      USING ERRCODE = 'unique_violation';
  END IF;
  PERFORM set_config('app.manual_source', 'on', true);
  INSERT INTO public.manual_source_allowances (client_id, period_month, scope, reason, allowed_by)
  VALUES (p_client_id, p_period, v_scope, v_reason, p_actor_id)
  RETURNING * INTO v_row;
  PERFORM set_config('app.manual_source', '', true);
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.manual_source_revoke(p_actor_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.manual_source_allowances;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can revoke a manual entry.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_row FROM public.manual_source_allowances WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such allowance.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This allowance is already revoked.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.manual_source', 'on', true);
  UPDATE public.manual_source_allowances SET revoked_at = now(), revoked_by = p_actor_id
   WHERE id = p_id RETURNING * INTO v_row;
  PERFORM set_config('app.manual_source', '', true);
  RETURN to_jsonb(v_row);
END;
$$;

-- Uses the live, unused allowance for a client, month and scope, once: marks
-- it used and returns its id. Called only from SECURITY DEFINER functions
-- (here reco_manual_opening); never granted to the public key.
CREATE OR REPLACE FUNCTION public.manual_source_use(
  p_actor_id uuid, p_client_id uuid, p_period text, p_scope text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.manual_source_allowances
   WHERE client_id = p_client_id AND period_month = p_period AND scope = p_scope
     AND revoked_at IS NULL AND used_at IS NULL
   FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No manual entry is allowed for this client and month. Pull it from the portal, or ask the superadmin to allow a manual entry.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('app.manual_source', 'on', true);
  UPDATE public.manual_source_allowances SET used_by = p_actor_id, used_at = now() WHERE id = v_id;
  PERFORM set_config('app.manual_source', '', true);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manual_source_use(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manual_source_use(uuid, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manual_source_allow(uuid, uuid, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manual_source_revoke(uuid, uuid) TO anon, authenticated, service_role;
