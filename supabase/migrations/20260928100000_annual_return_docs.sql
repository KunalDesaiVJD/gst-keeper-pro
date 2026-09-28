-- Annual Return (GSTR-9 / GSTR-9C) rebuild, 28 Sep 2026 — see
-- docs/GSTR9_9C_WORKINGS.md.
--
-- The workings move to one JSONB document per (client, FY, sheet): the
-- shapes live in src/lib/gstr9/types.ts and every formula is computed by
-- src/lib/gstr9/engine.ts, so nothing derived is ever stored. The previous
-- per-table model (pl_output_lines, duties_taxes_*_monthly, gstr9c_* …) had
-- no rows in the live project when this shipped; those tables are left in
-- place, unused, and can be dropped once the firm has signed off.
--
-- Three things the old model lacked:
--   1. Version-checked saves — save_annual_return_doc() refuses a write made
--      against a stale version, so two people editing the same sheet cannot
--      silently overwrite each other.
--   2. A real lock — a trigger rejects every write to a doc while the FY is
--      locked in annual_return_periods (the old lock was a badge only).
--   3. History — the previous version of a doc is archived before it is
--      overwritten (at most one snapshot per doc per 10 minutes per editor,
--      so autosave doesn't flood it).
--
-- RLS is open to public, as everywhere in this app: there is no Supabase
-- Auth session at runtime (auth.uid() is always NULL) — see CLAUDE.md.

CREATE TABLE IF NOT EXISTS public.annual_return_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,                       -- "2024-25"
  doc_key text NOT NULL CHECK (doc_key IN (
    'sales', 'purchases', 'duties_output', 'duties_input', 'rcm', 'portal',
    'gstr9', 'annexures', 'gstr9c', 'notice', 'justifications', 'settings'
  )),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, doc_key)
);

CREATE INDEX IF NOT EXISTS annual_return_docs_client_fy_idx
  ON public.annual_return_docs (client_id, financial_year);

ALTER TABLE public.annual_return_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "annual_return_docs_all" ON public.annual_return_docs;
CREATE POLICY "annual_return_docs_all" ON public.annual_return_docs
  FOR ALL TO public USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.annual_return_doc_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  doc_key text NOT NULL,
  data jsonb NOT NULL,
  version integer NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS annual_return_doc_history_doc_idx
  ON public.annual_return_doc_history (client_id, financial_year, doc_key, archived_at DESC);

ALTER TABLE public.annual_return_doc_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "annual_return_doc_history_all" ON public.annual_return_doc_history;
CREATE POLICY "annual_return_doc_history_all" ON public.annual_return_doc_history
  FOR ALL TO public USING (true) WITH CHECK (true);

-- Who locked the year (display name — the app has no Supabase Auth uid).
ALTER TABLE public.annual_return_periods ADD COLUMN IF NOT EXISTS locked_by text;

-- ---------------------------------------------------------------------------
-- Lock guard + history
-- ---------------------------------------------------------------------------
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
    OLD.updated_at < now() - interval '10 minutes'
    OR OLD.updated_by IS DISTINCT FROM NEW.updated_by
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

DROP TRIGGER IF EXISTS annual_return_docs_guard ON public.annual_return_docs;
CREATE TRIGGER annual_return_docs_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.annual_return_docs
  FOR EACH ROW EXECUTE FUNCTION public.annual_return_docs_guard();

-- ---------------------------------------------------------------------------
-- Version-checked save. p_expected_version = 0 means "I loaded no row".
-- Returns the new version, or raises ANNUAL_RETURN_VERSION_CONFLICT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_annual_return_doc(
  p_client_id uuid,
  p_financial_year text,
  p_doc_key text,
  p_data jsonb,
  p_expected_version integer,
  p_updated_by text
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_version integer;
BEGIN
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

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_VERSION_CONFLICT: % was changed by someone else.', p_doc_key
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v_version;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_annual_return_doc(uuid, text, text, jsonb, integer, text) TO anon, authenticated;
