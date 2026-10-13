-- BU agreement value: accept it without the client's confirmation (13 Oct 2026,
-- the firm's request — Bapa Sitaram's BU event sat blocked on a client who had
-- not clicked the confirmation link).
--
-- A unit's agreement value can now be ACCEPTED by the firm instead of
-- confirmed by the client: status OVERRIDDEN, with who, when and why. It
-- unblocks posting and filing exactly as CONFIRMED does. Who may accept:
-- the superadmin and GST Managers by role, and employees whose position
-- carries the new key `override_bu_agreement`. A reason is required of
-- everyone but the superadmin. With no Supabase auth session the actor id is
-- the browser's word (same footing as staff_set_password).
--
-- A client who clicks the link after an override changes nothing: the
-- token RPC only moves PENDING rows.

BEGIN;

ALTER TABLE public.builder_bu_agreement_confirmations
  DROP CONSTRAINT IF EXISTS builder_bu_agreement_confirmations_status_check;
ALTER TABLE public.builder_bu_agreement_confirmations
  ADD CONSTRAINT builder_bu_agreement_confirmations_status_check
  CHECK (status IN ('PENDING', 'CONFIRMED', 'DISPUTED', 'OVERRIDDEN'));

ALTER TABLE public.builder_bu_agreement_confirmations
  ADD COLUMN IF NOT EXISTS overridden_by   uuid,
  ADD COLUMN IF NOT EXISTS overridden_at   timestamptz,
  ADD COLUMN IF NOT EXISTS override_reason text;

-- Posting / filing gate: CONFIRMED or OVERRIDDEN both clear a unit.
CREATE OR REPLACE FUNCTION public.builder_bu_agreement_confirmation_blocked(_client_id uuid, _period_month text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.builder_bu_agreement_confirmations c
    JOIN public.builder_bu_events ev ON ev.id = c.bu_event_id
    WHERE c.client_id = _client_id
      AND ev.posting_period = _period_month
      AND c.status NOT IN ('CONFIRMED', 'OVERRIDDEN')
  );
$$;

-- Accept a unit's agreement value on the firm's own authority.
CREATE OR REPLACE FUNCTION public.builder_bu_agreement_override(
  p_bu_event_id uuid, p_unit_id uuid, p_actor_id uuid, p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text;
  v_client uuid;
  v_value  numeric;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = p_actor_id LIMIT 1;
  IF NOT (v_role IN ('superadmin', 'gst_manager')
          OR (v_role = 'employee' AND EXISTS (
                SELECT 1 FROM public.user_permissions
                 WHERE user_id = p_actor_id AND permission_key = 'override_bu_agreement'))) THEN
    RAISE EXCEPTION 'You are not allowed to accept an agreement value without the client''s confirmation.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_role <> 'superadmin' AND (v_reason IS NULL OR length(v_reason) < 10) THEN
    RAISE EXCEPTION 'Give a reason (at least 10 characters) for accepting the agreement value without the client''s confirmation.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT p.client_id, eu.agreement_value INTO v_client, v_value
    FROM public.builder_bu_event_units eu
    JOIN public.builder_bu_events ev ON ev.id = eu.bu_event_id
    JOIN public.builder_projects p ON p.id = ev.project_id
   WHERE eu.bu_event_id = p_bu_event_id AND eu.unit_id = p_unit_id
   LIMIT 1;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'That unit is not in this BU event.' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.builder_bu_agreement_confirmations AS c
    (bu_event_id, unit_id, client_id, agreement_value_at_request, status,
     overridden_by, overridden_at, override_reason, created_by)
  VALUES (p_bu_event_id, p_unit_id, v_client, COALESCE(v_value, 0), 'OVERRIDDEN',
          p_actor_id, now(), COALESCE(v_reason, 'Accepted by the superadmin'), p_actor_id)
  ON CONFLICT (bu_event_id, unit_id) DO UPDATE
    SET status = 'OVERRIDDEN',
        overridden_by = EXCLUDED.overridden_by,
        overridden_at = EXCLUDED.overridden_at,
        override_reason = EXCLUDED.override_reason
    WHERE c.status <> 'CONFIRMED';   -- a client's own confirmation is never replaced

  RETURN (SELECT status FROM public.builder_bu_agreement_confirmations
           WHERE bu_event_id = p_bu_event_id AND unit_id = p_unit_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.builder_bu_agreement_override(uuid, uuid, uuid, text) TO anon, authenticated, service_role;

COMMIT;
