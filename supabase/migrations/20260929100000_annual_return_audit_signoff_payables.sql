-- Annual Return: complete revision log, reviewer sign-off & lock, and the
-- payable / set-off register.
--
-- 1. annual_return_change_log — one row per changed figure: which sheet, the
--    place inside it (path + the row's ledger/description), old and new
--    value, who and when. Written by an AFTER trigger on annual_return_docs,
--    so every save is logged whichever screen made it. The app can read the
--    log but not write, change or delete it (select-only RLS; the trigger and
--    RPCs are SECURITY DEFINER).
-- 2. annual_return_doc_history becomes select-only too (snapshots are written
--    by the guard trigger and the lock), with a reason per snapshot.
-- 3. Period status changes go through set_annual_return_status(): locking
--    needs the role of a GST manager or superadmin, records who verified it,
--    the checklist, a note and the payables at lock, and snapshots every
--    sheet. Direct writes to annual_return_periods are no longer allowed.
-- 4. annual_return_payable_setoffs — how each payable was discharged: only by
--    a DRC-03 imported into the system (synced from the portal, or its copy
--    uploaded with ARN and date), or by an effect given in a GSTR-3B whose
--    period, filing date and copy are on record. Not blocked by the lock:
--    DRC-03s are usually paid after the return is filed.
--
-- RLS stays open to public for reads (the app has no auth session, see
-- CLAUDE.md); these tables are audit records, so writes go only through the
-- SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------------
-- 1. Change log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.annual_return_change_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  doc_key text NOT NULL,
  version integer,
  path text[] NOT NULL DEFAULT '{}',
  row_label text,
  kind text NOT NULL CHECK (kind IN ('edit', 'add', 'remove', 'status', 'setoff')),
  old_value jsonb,
  new_value jsonb,
  action text,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS annual_return_change_log_scope_idx
  ON public.annual_return_change_log (client_id, financial_year, changed_at DESC, id DESC);

ALTER TABLE public.annual_return_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "annual_return_change_log_read" ON public.annual_return_change_log;
CREATE POLICY "annual_return_change_log_read" ON public.annual_return_change_log
  FOR SELECT TO public USING (true);

/** The name of a row in a sheet's list (ledger, description …), for the log's "place". */
CREATE OR REPLACE FUNCTION public.annual_return_row_label(e jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(COALESCE(e->>'ledger', e->>'description', e->>'label', e->>'name', e->>'particulars', e->>'hsn', '')), '')
$$;

-- Leaf-level difference of two JSON documents.
--  * Objects are compared key by key.
--  * Lists whose items all carry a string "id" (ledger rows, adjustments …)
--    are matched by id, so inserting a row does not shift every row after it;
--    a new row is one 'add', a deleted row one 'remove', with the whole row.
--  * A missing value and an empty one (null / 0 / "" / false) are the same,
--    so a sheet gaining a new zero field is not logged as an edit.
--  * Bookkeeping keys (at, by, diffAt, fetchedAt, updatedAt) are not logged.
CREATE OR REPLACE FUNCTION public.annual_return_json_diff(
  a jsonb,
  b jsonb,
  p text[] DEFAULT '{}',
  lbl text DEFAULT NULL
)
RETURNS TABLE (path text[], row_label text, old_value jsonb, new_value jsonb, kind text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  ta text := CASE WHEN a IS NULL OR a = 'null'::jsonb THEN 'null' ELSE jsonb_typeof(a) END;
  tb text := CASE WHEN b IS NULL OR b = 'null'::jsonb THEN 'null' ELSE jsonb_typeof(b) END;
  k text;
  n integer;
  i integer;
  cnt bigint := 0;
  got bigint;
  keyed boolean;
  map_a jsonb;
  map_b jsonb;
  el_a jsonb;
  el_b jsonb;
  rl text;
BEGIN
  IF cardinality(p) > 0 AND p[cardinality(p)] = ANY (ARRAY['at', 'by', 'diffAt', 'fetchedAt', 'updatedAt']) THEN
    RETURN;
  END IF;
  IF ta = tb AND (ta = 'null' OR a = b) THEN
    RETURN;
  END IF;

  -- A list against nothing is a list against an empty list.
  IF ta = 'null' AND tb = 'array' THEN a := '[]'::jsonb; ta := 'array'; END IF;
  IF tb = 'null' AND ta = 'array' THEN b := '[]'::jsonb; tb := 'array'; END IF;

  IF ta = 'array' AND tb = 'array' THEN
    keyed := jsonb_array_length(a || b) > 0 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(a || b) e
      WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'id') IS DISTINCT FROM 'string'
    );
    IF keyed THEN
      SELECT COALESCE(jsonb_object_agg(e->>'id', e), '{}'::jsonb) INTO map_a FROM jsonb_array_elements(a) e;
      SELECT COALESCE(jsonb_object_agg(e->>'id', e), '{}'::jsonb) INTO map_b FROM jsonb_array_elements(b) e;
      FOR k IN SELECT e->>'id' FROM jsonb_array_elements(b) e UNION SELECT e->>'id' FROM jsonb_array_elements(a) e LOOP
        el_a := map_a->k;
        el_b := map_b->k;
        rl := COALESCE(public.annual_return_row_label(el_b), public.annual_return_row_label(el_a), lbl);
        IF el_a IS NULL THEN
          RETURN QUERY SELECT p || ('#' || k), rl, NULL::jsonb, el_b, 'add'::text;
        ELSIF el_b IS NULL THEN
          RETURN QUERY SELECT p || ('#' || k), rl, el_a, NULL::jsonb, 'remove'::text;
        ELSE
          RETURN QUERY SELECT * FROM public.annual_return_json_diff(el_a, el_b, p || ('#' || k), rl);
        END IF;
      END LOOP;
      RETURN;
    END IF;
    n := GREATEST(jsonb_array_length(a), jsonb_array_length(b));
    FOR i IN 0 .. n - 1 LOOP
      RETURN QUERY SELECT * FROM public.annual_return_json_diff(a->i, b->i, p || i::text, lbl);
    END LOOP;
    RETURN;
  END IF;

  IF (ta = 'object' OR ta = 'null') AND (tb = 'object' OR tb = 'null') THEN
    FOR k IN
      SELECT jsonb_object_keys(COALESCE(CASE WHEN ta = 'object' THEN a END, '{}'::jsonb))
      UNION
      SELECT jsonb_object_keys(COALESCE(CASE WHEN tb = 'object' THEN b END, '{}'::jsonb))
    LOOP
      RETURN QUERY SELECT * FROM public.annual_return_json_diff(
        CASE WHEN ta = 'object' THEN a->k END,
        CASE WHEN tb = 'object' THEN b->k END,
        p || k, lbl);
      GET DIAGNOSTICS got = ROW_COUNT;
      cnt := cnt + got;
    END LOOP;
    -- An override set to all-zero (null → {i:0,…}) or cleared back: still a change.
    IF cnt = 0 AND ta <> tb THEN
      RETURN QUERY SELECT p, lbl, CASE WHEN ta = 'null' THEN NULL ELSE a END, CASE WHEN tb = 'null' THEN NULL ELSE b END, 'edit'::text;
    END IF;
    RETURN;
  END IF;

  -- Scalars (or a scalar against a container): an empty value against an empty one is no change.
  IF (ta = 'null' OR a IN ('0'::jsonb, '""'::jsonb, 'false'::jsonb))
     AND (tb = 'null' OR b IN ('0'::jsonb, '""'::jsonb, 'false'::jsonb)) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT p, lbl, CASE WHEN ta = 'null' THEN NULL ELSE a END, CASE WHEN tb = 'null' THEN NULL ELSE b END, 'edit'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.annual_return_docs_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text := NULLIF(current_setting('annual_return.action', true), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.annual_return_change_log
      (client_id, financial_year, doc_key, version, path, kind, old_value, action, changed_by)
    VALUES
      (OLD.client_id, OLD.financial_year, OLD.doc_key, OLD.version, '{}', 'remove', OLD.data,
       COALESCE(v_action, 'Sheet deleted'), OLD.updated_by);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.data = NEW.data THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.annual_return_change_log
    (client_id, financial_year, doc_key, version, path, row_label, kind, old_value, new_value, action, changed_by)
  SELECT NEW.client_id, NEW.financial_year, NEW.doc_key, NEW.version, d.path, d.row_label, d.kind,
         d.old_value, d.new_value, COALESCE(v_action, 'Edited'), NEW.updated_by
  FROM public.annual_return_json_diff(CASE WHEN TG_OP = 'UPDATE' THEN OLD.data END, NEW.data) d;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS annual_return_docs_log ON public.annual_return_docs;
CREATE TRIGGER annual_return_docs_log
  AFTER INSERT OR UPDATE OR DELETE ON public.annual_return_docs
  FOR EACH ROW EXECUTE FUNCTION public.annual_return_docs_log();

-- ---------------------------------------------------------------------------
-- 2. Version snapshots: read-only for the app, with a reason
-- ---------------------------------------------------------------------------
ALTER TABLE public.annual_return_doc_history ADD COLUMN IF NOT EXISTS reason text;

DROP POLICY IF EXISTS "annual_return_doc_history_all" ON public.annual_return_doc_history;
DROP POLICY IF EXISTS "annual_return_doc_history_read" ON public.annual_return_doc_history;
CREATE POLICY "annual_return_doc_history_read" ON public.annual_return_doc_history
  FOR SELECT TO public USING (true);

CREATE OR REPLACE FUNCTION public.annual_return_docs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid := COALESCE(NEW.client_id, OLD.client_id);
  v_fy text := COALESCE(NEW.financial_year, OLD.financial_year);
  v_forced boolean := current_setting('annual_return.force_history', true) = 'on';
  v_other_user boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.annual_return_periods p
    WHERE p.client_id = v_client AND p.financial_year = v_fy AND p.status = 'locked'
  ) THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_LOCKED: FY % is locked for this client. Unlock it before editing.', v_fy
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_other_user := OLD.updated_by IS DISTINCT FROM NEW.updated_by;
    IF v_forced OR v_other_user OR NOT EXISTS (
      SELECT 1 FROM public.annual_return_doc_history h
      WHERE h.doc_id = OLD.id AND h.archived_at > now() - interval '10 minutes'
    ) THEN
      INSERT INTO public.annual_return_doc_history
        (doc_id, client_id, financial_year, doc_key, data, version, updated_by, updated_at, reason)
      VALUES
        (OLD.id, OLD.client_id, OLD.financial_year, OLD.doc_key, OLD.data, OLD.version, OLD.updated_by, OLD.updated_at,
         CASE WHEN v_forced THEN 'Before restore'
              WHEN v_other_user THEN 'Before ' || COALESCE(NEW.updated_by, 'another user') || '''s edit'
              ELSE 'Autosave checkpoint' END);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Save RPC: + p_action, the label the change log records ("Imported as-filed
-- GSTR-3B", "Restored version 12" …; default "Edited").
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_annual_return_doc(uuid, text, text, jsonb, integer, text, boolean);

CREATE OR REPLACE FUNCTION public.save_annual_return_doc(
  p_client_id uuid,
  p_financial_year text,
  p_doc_key text,
  p_data jsonb,
  p_expected_version integer,
  p_updated_by text,
  p_force_history boolean DEFAULT false,
  p_action text DEFAULT NULL
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

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_VERSION_CONFLICT: % was changed by someone else.', p_doc_key
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v_version;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_annual_return_doc(uuid, text, text, jsonb, integer, text, boolean, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sign-off and lock
-- ---------------------------------------------------------------------------
ALTER TABLE public.annual_return_periods
  ADD COLUMN IF NOT EXISTS prepared_by_name text,
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS prepared_note text,
  ADD COLUMN IF NOT EXISTS reviewed_by_name text,
  ADD COLUMN IF NOT EXISTS reviewed_role text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS review_checklist jsonb,
  ADD COLUMN IF NOT EXISTS payables_at_lock jsonb;

DROP POLICY IF EXISTS "annual_return_periods_all" ON public.annual_return_periods;
DROP POLICY IF EXISTS "annual_return_periods_read" ON public.annual_return_periods;
CREATE POLICY "annual_return_periods_read" ON public.annual_return_periods
  FOR SELECT TO public USING (true);

-- Move the period from p_from (what the user was looking at) to p_to.
-- Locking: p_role must be superadmin or gst_manager; the reviewer, role,
-- checklist, note and payables are recorded and every sheet is snapshotted.
-- Unlocking: superadmin, gst_manager or a user with unlock_sheets (p_role =
-- 'unlock_sheets'); the sign-off is cleared (the log keeps it).
CREATE OR REPLACE FUNCTION public.set_annual_return_status(
  p_client_id uuid,
  p_financial_year text,
  p_from text,
  p_to text,
  p_by text,
  p_role text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_checklist jsonb DEFAULT NULL,
  p_payables jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur text;
  v_action text;
BEGIN
  IF p_to NOT IN ('not_started', 'in_progress', 'locked') THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_BAD_STATUS: %', p_to USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_cur FROM public.annual_return_periods
   WHERE client_id = p_client_id AND financial_year = p_financial_year
   FOR UPDATE;
  IF v_cur IS NULL THEN
    IF p_from <> 'not_started' THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_STATUS_CHANGED: not_started' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.annual_return_periods (client_id, financial_year, status)
    VALUES (p_client_id, p_financial_year, 'not_started');
    v_cur := 'not_started';
  ELSIF v_cur <> p_from THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_STATUS_CHANGED: %', v_cur USING ERRCODE = 'P0001';
  END IF;

  IF p_to = 'locked' THEN
    IF COALESCE(p_role, '') NOT IN ('superadmin', 'gst_manager') THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only a GST manager or a superadmin can verify and lock the year.'
        USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.annual_return_doc_history
      (doc_id, client_id, financial_year, doc_key, data, version, updated_by, updated_at, reason)
    SELECT id, client_id, financial_year, doc_key, data, version, updated_by, updated_at,
           'Locked — verified by ' || COALESCE(p_by, 'reviewer')
      FROM public.annual_return_docs
     WHERE client_id = p_client_id AND financial_year = p_financial_year;
    UPDATE public.annual_return_periods
       SET status = 'locked', locked_at = now(), locked_by = p_by,
           reviewed_by_name = p_by, reviewed_role = p_role, reviewed_at = now(),
           review_note = p_note, review_checklist = p_checklist, payables_at_lock = p_payables,
           updated_at = now()
     WHERE client_id = p_client_id AND financial_year = p_financial_year;
    v_action := 'Verified and locked';
  ELSE
    IF v_cur = 'locked' AND COALESCE(p_role, '') NOT IN ('superadmin', 'gst_manager', 'unlock_sheets') THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only a superadmin, a GST manager or a user with the unlock-sheets permission can unlock.'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.annual_return_periods
       SET status = p_to, locked_at = NULL, locked_by = NULL,
           reviewed_by_name = CASE WHEN v_cur = 'locked' THEN NULL ELSE reviewed_by_name END,
           reviewed_role = CASE WHEN v_cur = 'locked' THEN NULL ELSE reviewed_role END,
           reviewed_at = CASE WHEN v_cur = 'locked' THEN NULL ELSE reviewed_at END,
           review_note = CASE WHEN v_cur = 'locked' THEN NULL ELSE review_note END,
           review_checklist = CASE WHEN v_cur = 'locked' THEN NULL ELSE review_checklist END,
           payables_at_lock = CASE WHEN v_cur = 'locked' THEN NULL ELSE payables_at_lock END,
           updated_at = now()
     WHERE client_id = p_client_id AND financial_year = p_financial_year;
    v_action := CASE WHEN v_cur = 'locked' THEN 'Unlocked'
                     WHEN p_to = 'in_progress' THEN 'Marked in progress'
                     ELSE 'Status changed' END;
  END IF;

  INSERT INTO public.annual_return_change_log
    (client_id, financial_year, doc_key, path, kind, old_value, new_value, action, changed_by)
  VALUES
    (p_client_id, p_financial_year, 'period', ARRAY['status'], 'status', to_jsonb(v_cur),
     jsonb_strip_nulls(jsonb_build_object('status', p_to, 'role', p_role, 'note', p_note, 'checklist', p_checklist)),
     v_action, p_by);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_annual_return_status(uuid, text, text, text, text, text, text, jsonb, jsonb) TO anon, authenticated;

-- "Ready for review" by the preparer (or withdrawn with p_clear).
CREATE OR REPLACE FUNCTION public.mark_annual_return_prepared(
  p_client_id uuid,
  p_financial_year text,
  p_by text,
  p_note text DEFAULT NULL,
  p_clear boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur text;
BEGIN
  SELECT status INTO v_cur FROM public.annual_return_periods
   WHERE client_id = p_client_id AND financial_year = p_financial_year
   FOR UPDATE;
  IF v_cur = 'locked' THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_LOCKED: FY % is locked for this client.', p_financial_year USING ERRCODE = 'P0001';
  END IF;
  IF v_cur IS NULL THEN
    INSERT INTO public.annual_return_periods (client_id, financial_year, status)
    VALUES (p_client_id, p_financial_year, 'in_progress');
  END IF;
  UPDATE public.annual_return_periods
     SET status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
         prepared_by_name = CASE WHEN p_clear THEN NULL ELSE p_by END,
         prepared_at = CASE WHEN p_clear THEN NULL ELSE now() END,
         prepared_note = CASE WHEN p_clear THEN NULL ELSE p_note END,
         updated_at = now()
   WHERE client_id = p_client_id AND financial_year = p_financial_year;
  INSERT INTO public.annual_return_change_log
    (client_id, financial_year, doc_key, path, kind, new_value, action, changed_by)
  VALUES
    (p_client_id, p_financial_year, 'period', ARRAY['prepared'], 'status',
     jsonb_strip_nulls(jsonb_build_object('note', p_note)),
     CASE WHEN p_clear THEN 'Withdrew ready for review' ELSE 'Marked ready for review' END, p_by);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_annual_return_prepared(uuid, text, text, text, boolean) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Payable set-off register
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.annual_return_payable_setoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  side text NOT NULL CHECK (side IN ('output', 'input')),
  method text NOT NULL CHECK (method IN ('drc03', 'gstr3b')),
  drc03_id uuid REFERENCES public.gst_drc03_filings(id),
  reference text,
  doc_date date,
  gstr3b_period text,
  gstr3b_table text,
  evidence_url text,
  evidence_name text,
  igst numeric(14, 2) NOT NULL DEFAULT 0,
  cgst numeric(14, 2) NOT NULL DEFAULT 0,
  sgst numeric(14, 2) NOT NULL DEFAULT 0,
  cess numeric(14, 2) NOT NULL DEFAULT 0,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by text,
  delete_reason text,
  CONSTRAINT annual_return_setoff_amounts CHECK (igst >= 0 AND cgst >= 0 AND sgst >= 0 AND cess >= 0 AND igst + cgst + sgst + cess > 0),
  -- A DRC-03 set-off needs the DRC-03 itself: synced from the portal, or its uploaded copy with ARN and date.
  CONSTRAINT annual_return_setoff_drc03_evidence CHECK (
    method <> 'drc03' OR drc03_id IS NOT NULL
    OR (NULLIF(btrim(reference), '') IS NOT NULL AND doc_date IS NOT NULL AND evidence_url IS NOT NULL)
  ),
  -- A GSTR-3B set-off needs the return period, its filing date and the filed 3B's copy.
  CONSTRAINT annual_return_setoff_gstr3b_evidence CHECK (
    method <> 'gstr3b'
    OR (gstr3b_period ~ '^(0[1-9]|1[0-2])/[0-9]{4}$' AND doc_date IS NOT NULL AND evidence_url IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS annual_return_payable_setoffs_scope_idx
  ON public.annual_return_payable_setoffs (client_id, financial_year);

ALTER TABLE public.annual_return_payable_setoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "annual_return_payable_setoffs_read" ON public.annual_return_payable_setoffs;
CREATE POLICY "annual_return_payable_setoffs_read" ON public.annual_return_payable_setoffs
  FOR SELECT TO public USING (true);

CREATE OR REPLACE FUNCTION public.add_annual_return_setoff(
  p_client_id uuid,
  p_financial_year text,
  p_side text,
  p_method text,
  p_by text,
  p_igst numeric,
  p_cgst numeric,
  p_sgst numeric,
  p_cess numeric,
  p_drc03_id uuid DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_doc_date date DEFAULT NULL,
  p_gstr3b_period text DEFAULT NULL,
  p_gstr3b_table text DEFAULT NULL,
  p_evidence_url text DEFAULT NULL,
  p_evidence_name text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  d public.gst_drc03_filings%ROWTYPE;
  used record;
  v_label text;
BEGIN
  IF p_drc03_id IS NOT NULL THEN
    SELECT * INTO d FROM public.gst_drc03_filings WHERE id = p_drc03_id;
    IF NOT FOUND OR d.client_id <> p_client_id OR d.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_SETOFF_INVALID: that DRC-03 is not on record for this client.' USING ERRCODE = 'P0001';
    END IF;
    -- A DRC-03 cannot be used for more than it paid, head by head (₹1 rounding allowed).
    SELECT COALESCE(sum(igst), 0) AS i, COALESCE(sum(cgst), 0) AS c, COALESCE(sum(sgst), 0) AS s, COALESCE(sum(cess), 0) AS x
      INTO used FROM public.annual_return_payable_setoffs
     WHERE drc03_id = p_drc03_id AND deleted_at IS NULL;
    IF used.i + COALESCE(p_igst, 0) > COALESCE(d.igst_amount, 0) + 1
       OR used.c + COALESCE(p_cgst, 0) > COALESCE(d.cgst_amount, 0) + 1
       OR used.s + COALESCE(p_sgst, 0) > COALESCE(d.sgst_amount, 0) + 1
       OR used.x + COALESCE(p_cess, 0) > COALESCE(d.cess_amount, 0) + 1 THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_SETOFF_INVALID: the amount is more than what is left on DRC-03 %.', COALESCE(d.arn, '')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.annual_return_payable_setoffs
    (client_id, financial_year, side, method, drc03_id, reference, doc_date, gstr3b_period, gstr3b_table,
     evidence_url, evidence_name, igst, cgst, sgst, cess, note, created_by)
  VALUES
    (p_client_id, p_financial_year, p_side, p_method, p_drc03_id,
     COALESCE(NULLIF(btrim(p_reference), ''), d.arn), COALESCE(p_doc_date, d.filed_date), p_gstr3b_period, p_gstr3b_table,
     COALESCE(p_evidence_url, d.pdf_url), p_evidence_name,
     COALESCE(p_igst, 0), COALESCE(p_cgst, 0), COALESCE(p_sgst, 0), COALESCE(p_cess, 0), p_note, p_by)
  RETURNING id INTO v_id;

  v_label := CASE WHEN p_method = 'drc03' THEN 'DRC-03 ' || COALESCE(NULLIF(btrim(p_reference), ''), d.arn, '')
                  ELSE 'GSTR-3B ' || COALESCE(p_gstr3b_period, '') END;
  INSERT INTO public.annual_return_change_log
    (client_id, financial_year, doc_key, path, row_label, kind, new_value, action, changed_by)
  SELECT client_id, financial_year, 'payables', ARRAY[side, '#' || id::text], v_label, 'setoff', to_jsonb(s),
         'Set off ' || side || ' payable', p_by
    FROM public.annual_return_payable_setoffs s WHERE id = v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_annual_return_setoff(uuid, text, text, text, text, numeric, numeric, numeric, numeric, uuid, text, date, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.remove_annual_return_setoff(p_id uuid, p_by text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.annual_return_payable_setoffs%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_SETOFF_INVALID: give a reason for removing a set-off.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.annual_return_payable_setoffs
     SET deleted_at = now(), deleted_by = p_by, delete_reason = p_reason
   WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_SETOFF_INVALID: that set-off is not on record (or already removed).' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.annual_return_change_log
    (client_id, financial_year, doc_key, path, row_label, kind, old_value, new_value, action, changed_by)
  VALUES
    (s.client_id, s.financial_year, 'payables', ARRAY[s.side, '#' || s.id::text],
     CASE WHEN s.method = 'drc03' THEN 'DRC-03 ' || COALESCE(s.reference, '') ELSE 'GSTR-3B ' || COALESCE(s.gstr3b_period, '') END,
     'setoff', to_jsonb(s), jsonb_build_object('reason', p_reason), 'Removed set-off', p_by);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_annual_return_setoff(uuid, text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Evidence files (DRC-03 / GSTR-3B copies): upload and read only — a copy on
-- record cannot be replaced or deleted from the app.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('annual-return-evidence', 'annual-return-evidence', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Annual return evidence upload" ON storage.objects;
CREATE POLICY "Annual return evidence upload" ON storage.objects
  FOR INSERT TO public WITH CHECK (bucket_id = 'annual-return-evidence');
DROP POLICY IF EXISTS "Annual return evidence read" ON storage.objects;
CREATE POLICY "Annual return evidence read" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'annual-return-evidence');

NOTIFY pgrst, 'reload schema';
