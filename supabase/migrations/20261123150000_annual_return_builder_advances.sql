-- Builder clients: the customer-advance roll-forward behind GSTR-9C Table 5
-- (the firm's "TURNOVER IN 9C" sheet, 23 Nov 2026). It lives inside the year's
-- gstr9c doc as data->'builderAdv' (src/lib/gstr9/builderAdvances.ts) and fills
-- 5B, 5C, 5H, 5I, 5J and 5O. See docs/GSTR9_9C_WORKINGS.md, "Builder advance
-- roll-forward".
--
-- One open year per client, enforced here:
--   * a year is CLOSED once its Annual Return is locked, or once a GST Manager /
--     the superadmin closes its roll-forward (annual_return_builder_close_year,
--     for back years whose 9C was not prepared in the app);
--   * the roll-forward of a year changes only while that year is open, the year
--     before (when it holds a roll-forward) is closed, and no later year is
--     closed;
--   * its openings (advance, unbilled revenue, received and sales to date) must
--     equal what the year before carries forward; they are typed only for the
--     first year of the chain;
--   * only the superadmin reopens a closed year, with a reason, and never while
--     a later year is closed.

-- ---------------------------------------------------------------------------
-- Close records (append-only history: a reopen stamps the row, never deletes it)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.annual_return_builder_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  closed_by uuid NOT NULL,
  closed_by_name text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  close_reason text NOT NULL,
  reopened_by uuid,
  reopened_by_name text,
  reopened_at timestamptz,
  reopen_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS annual_return_builder_closes_open_uq
  ON public.annual_return_builder_closes (client_id, financial_year)
  WHERE reopened_at IS NULL;

ALTER TABLE public.annual_return_builder_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS annual_return_builder_closes_read ON public.annual_return_builder_closes;
CREATE POLICY annual_return_builder_closes_read ON public.annual_return_builder_closes
  FOR SELECT TO public USING (true);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.annual_return_prev_fy(p_fy text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (left(p_fy, 4)::int - 1)::text || '-' || lpad((left(p_fy, 4)::int % 100)::text, 2, '0');
$$;

CREATE OR REPLACE FUNCTION public.annual_return_builder_num(p jsonb, p_key text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_typeof(p->p_key) = 'number' THEN (p->>p_key)::numeric ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.annual_return_builder_year_closed(p_client_id uuid, p_fy text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.annual_return_builder_closes c
            WHERE c.client_id = p_client_id AND c.financial_year = p_fy AND c.reopened_at IS NULL)
      OR EXISTS (
           SELECT 1 FROM public.annual_return_periods p
            WHERE p.client_id = p_client_id AND p.financial_year = p_fy AND p.status = 'locked');
$$;

-- The roll-forward a year holds (NULL = none).
CREATE OR REPLACE FUNCTION public.annual_return_builder_adv(p_client_id uuid, p_fy text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN jsonb_typeof(d.data->'builderAdv') = 'object' THEN d.data->'builderAdv' END
    FROM public.annual_return_docs d
   WHERE d.client_id = p_client_id AND d.financial_year = p_fy AND d.doc_key = 'gstr9c';
$$;

-- ---------------------------------------------------------------------------
-- Guard on annual_return_docs (gstr9c only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.annual_return_docs_builder_adv_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' AND jsonb_typeof(OLD.data->'builderAdv') = 'object' THEN OLD.data->'builderAdv' END;
  v_new jsonb := CASE WHEN jsonb_typeof(NEW.data->'builderAdv') = 'object' THEN NEW.data->'builderAdv' END;
  v_prev_fy text;
  v_prev jsonb;
  v_carry_adv numeric;
  v_carry_unb numeric;
  v_carry_rec numeric;
  v_carry_sales numeric;
  v_later text;
BEGIN
  IF NEW.doc_key <> 'gstr9c' OR v_old IS NOT DISTINCT FROM v_new THEN
    RETURN NEW;
  END IF;

  IF v_new IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id = NEW.client_id AND c.regular_sub_type = 'Builder'
  ) THEN
    RAISE EXCEPTION 'BUILDER_ADV_NOT_BUILDER: The advance roll-forward is for Builder clients only.';
  END IF;

  IF public.annual_return_builder_year_closed(NEW.client_id, NEW.financial_year) THEN
    RAISE EXCEPTION 'BUILDER_ADV_YEAR_CLOSED: FY % is closed. Its advance roll-forward cannot change.', NEW.financial_year;
  END IF;

  SELECT d.financial_year INTO v_later
    FROM public.annual_return_docs d
   WHERE d.client_id = NEW.client_id AND d.doc_key = 'gstr9c'
     AND d.financial_year > NEW.financial_year
     AND jsonb_typeof(d.data->'builderAdv') = 'object'
     AND public.annual_return_builder_year_closed(d.client_id, d.financial_year)
   ORDER BY d.financial_year
   LIMIT 1;
  IF v_later IS NOT NULL THEN
    RAISE EXCEPTION 'BUILDER_ADV_LATER_CLOSED: FY % is already closed, so FY % cannot change.', v_later, NEW.financial_year;
  END IF;

  IF v_new IS NULL THEN
    RETURN NEW; -- switched off in an open year
  END IF;

  v_prev_fy := public.annual_return_prev_fy(NEW.financial_year);
  v_prev := public.annual_return_builder_adv(NEW.client_id, v_prev_fy);
  IF v_prev IS NOT NULL THEN
    IF NOT public.annual_return_builder_year_closed(NEW.client_id, v_prev_fy) THEN
      RAISE EXCEPTION 'BUILDER_ADV_PREV_OPEN: Close FY % first. Only one year is open at a time.', v_prev_fy;
    END IF;
    v_carry_adv := public.annual_return_builder_num(v_prev, 'closingAdvance');
    v_carry_unb := public.annual_return_builder_num(v_prev, 'closingUnbilled');
    v_carry_sales := public.annual_return_builder_num(v_prev, 'salesBefore') + public.annual_return_builder_num(v_prev, 'revenue');
    v_carry_rec := public.annual_return_builder_num(v_prev, 'receivedBefore')
                 + public.annual_return_builder_num(v_prev, 'closingAdvance')
                 - public.annual_return_builder_num(v_prev, 'openingAdvance')
                 + public.annual_return_builder_num(v_prev, 'revenue');
    IF abs(public.annual_return_builder_num(v_new, 'openingAdvance') - v_carry_adv) > 0.005
       OR abs(public.annual_return_builder_num(v_new, 'openingUnbilled') - v_carry_unb) > 0.005
       OR abs(public.annual_return_builder_num(v_new, 'receivedBefore') - v_carry_rec) > 0.005
       OR abs(public.annual_return_builder_num(v_new, 'salesBefore') - v_carry_sales) > 0.005 THEN
      RAISE EXCEPTION 'BUILDER_ADV_OPENING: The openings must be what FY % carries forward. Reload the page.', v_prev_fy;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS annual_return_docs_builder_adv ON public.annual_return_docs;
CREATE TRIGGER annual_return_docs_builder_adv
  BEFORE INSERT OR UPDATE ON public.annual_return_docs
  FOR EACH ROW EXECUTE FUNCTION public.annual_return_docs_builder_adv_guard();

-- ---------------------------------------------------------------------------
-- Close a year (GST Manager / superadmin) and reopen it (superadmin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.annual_return_builder_close_year(
  p_client_id uuid, p_financial_year text, p_actor_id uuid, p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_role text;
  v_prev_fy text := public.annual_return_prev_fy(p_financial_year);
BEGIN
  SELECT a.name, a.role INTO v_name, v_role FROM public.annual_return_actor(p_actor_id) a;
  IF v_role IS NULL OR v_role NOT IN ('superadmin', 'gst_manager') THEN
    RAISE EXCEPTION 'BUILDER_ADV_NOT_ALLOWED: Only a GST Manager or the superadmin closes a year.';
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'BUILDER_ADV_REASON: Give a reason.';
  END IF;
  -- One close at a time per client.
  PERFORM pg_advisory_xact_lock(hashtext('annual_return_builder:' || p_client_id::text));
  IF public.annual_return_builder_adv(p_client_id, p_financial_year) IS NULL THEN
    RAISE EXCEPTION 'BUILDER_ADV_NONE: FY % has no advance roll-forward to close.', p_financial_year;
  END IF;
  IF public.annual_return_builder_year_closed(p_client_id, p_financial_year) THEN
    RAISE EXCEPTION 'BUILDER_ADV_YEAR_CLOSED: FY % is already closed.', p_financial_year;
  END IF;
  IF public.annual_return_builder_adv(p_client_id, v_prev_fy) IS NOT NULL
     AND NOT public.annual_return_builder_year_closed(p_client_id, v_prev_fy) THEN
    RAISE EXCEPTION 'BUILDER_ADV_PREV_OPEN: Close FY % first.', v_prev_fy;
  END IF;
  INSERT INTO public.annual_return_builder_closes (client_id, financial_year, closed_by, closed_by_name, close_reason)
  VALUES (p_client_id, p_financial_year, p_actor_id, v_name, btrim(p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.annual_return_builder_reopen_year(
  p_client_id uuid, p_financial_year text, p_actor_id uuid, p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_role text;
  v_later text;
BEGIN
  SELECT a.name, a.role INTO v_name, v_role FROM public.annual_return_actor(p_actor_id) a;
  IF v_role IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'BUILDER_ADV_NOT_ALLOWED: Only the superadmin reopens a closed year.';
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'BUILDER_ADV_REASON: Give a reason.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('annual_return_builder:' || p_client_id::text));
  IF EXISTS (SELECT 1 FROM public.annual_return_periods p
              WHERE p.client_id = p_client_id AND p.financial_year = p_financial_year AND p.status = 'locked') THEN
    RAISE EXCEPTION 'BUILDER_ADV_PERIOD_LOCKED: FY % is locked by its sign-off. Unlock the year first.', p_financial_year;
  END IF;
  SELECT d.financial_year INTO v_later
    FROM public.annual_return_docs d
   WHERE d.client_id = p_client_id AND d.doc_key = 'gstr9c'
     AND d.financial_year > p_financial_year
     AND jsonb_typeof(d.data->'builderAdv') = 'object'
     AND public.annual_return_builder_year_closed(d.client_id, d.financial_year)
   ORDER BY d.financial_year
   LIMIT 1;
  IF v_later IS NOT NULL THEN
    RAISE EXCEPTION 'BUILDER_ADV_LATER_CLOSED: Reopen FY % first.', v_later;
  END IF;
  UPDATE public.annual_return_builder_closes
     SET reopened_by = p_actor_id, reopened_by_name = v_name, reopened_at = now(), reopen_reason = btrim(p_reason)
   WHERE client_id = p_client_id AND financial_year = p_financial_year AND reopened_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUILDER_ADV_NOT_CLOSED: FY % is not closed.', p_financial_year;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.annual_return_builder_close_year(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.annual_return_builder_reopen_year(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.annual_return_builder_close_year(uuid, text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.annual_return_builder_reopen_year(uuid, text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.annual_return_builder_year_closed(uuid, text) TO anon, authenticated;
