-- Notices Phase 3 · Portal Autopilot, part 3: more read in the same session
-- (audit findings S-21, S-22, S-31; follows 20261007121000_portal_emails.sql).
--
-- 1. Applications on the portal: appeals (GST APL-01), rectification of an
--    order, objections to a provisional attachment, the s.128A waiver scheme,
--    compounding and provisional assessment. These are the portal's own
--    "My Applications" types (codes APPEL, ADJRO, ADJAT, ADJWS, COMPD, ADJPA
--    in the portal's public casesearchctrl.js), read with the same case
--    search the refunds and DRC-03 already use. Stored in
--    gst_portal_applications by sync_ingest_applications, which never
--    removes anything on a type that came back empty.
-- 2. GSTR-3A: the return type and period from the portal's summary are kept on
--    the notice (gst_notices.portal_detail -> 'gstr3a'), and the notice closes
--    by itself ('auto:return_filed') once Filing Status shows that return
--    filed for that period: the notice is deemed withdrawn when the return is
--    filed (rule 68, s.46). Reviewable like every automatic close.
-- 3. Registration status (Active / Cancelled / Suspended) and the raw profile
--    from the taxpayer profile, shown on the Autopilot page.
-- The extension writes all three only when this file has been applied; an
-- older database just ignores them.

-- ── 1. Applications ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gst_portal_applications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_type_cd     text NOT NULL,
  portal_key       text NOT NULL,
  arn              text,
  case_id          text,
  form_number      text,
  form_description text,
  status           text,
  filed_date       date,
  raw_json         jsonb,
  portal_hash      text,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  UNIQUE (client_id, case_type_cd, portal_key)
);
CREATE INDEX IF NOT EXISTS idx_gst_portal_applications_client ON public.gst_portal_applications (client_id) WHERE deleted_at IS NULL;
ALTER TABLE public.gst_portal_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gst_portal_applications_all ON public.gst_portal_applications;
CREATE POLICY gst_portal_applications_all ON public.gst_portal_applications FOR ALL TO public USING (true) WITH CHECK (true);
COMMENT ON TABLE public.gst_portal_applications IS
  'Portal "My Applications" (APPEL appeal APL-01, ADJRO rectification, ADJAT objection to provisional attachment, ADJWS s.128A waiver, COMPD compounding, ADJPA provisional assessment). Written by sync_ingest_applications.';

-- p_rows: [{case_type_cd, portal_key, arn, case_id, form_number, form_description,
-- status, filed_date 'YYYY-MM-DD' or 'DD/MM/YYYY', raw_json}]; p_case_types: the types this pull
-- read. Returns {status, new, changed, unchanged, removed}.
CREATE OR REPLACE FUNCTION public.sync_ingest_applications(p_client_id uuid, p_run_id uuid, p_rows jsonb,
                                                           p_case_types text[], p_ext_version text DEFAULT NULL,
                                                           p_complete boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now       timestamptz := now();
  v_seen      int;
  v_new       int;
  v_changed   int;
  v_unchanged int;
  v_removed   int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sync_ingest:' || p_client_id::text));

  CREATE TEMP TABLE IF NOT EXISTS _apps_in (
    case_type_cd text, portal_key text, arn text, case_id text, form_number text, form_description text,
    status text, filed_date date, raw_json jsonb, hash text) ON COMMIT DROP;
  TRUNCATE _apps_in;
  INSERT INTO _apps_in
  SELECT DISTINCT ON (r.case_type_cd, r.portal_key)
         r.case_type_cd, r.portal_key, nullif(btrim(r.arn), ''), nullif(btrim(r.case_id), ''),
         nullif(btrim(r.form_number), ''), nullif(btrim(r.form_description), ''), nullif(btrim(r.status), ''),
         public.notices_parse_portal_date(r.filed_date),
         r.raw_json,
         md5(concat_ws('|', r.arn, r.case_id, r.form_number, r.status, r.filed_date))
    FROM jsonb_to_recordset(CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows ELSE '[]'::jsonb END)
         AS r(case_type_cd text, portal_key text, arn text, case_id text, form_number text, form_description text,
              status text, filed_date text, raw_json jsonb)
   WHERE coalesce(btrim(r.portal_key), '') <> '' AND r.case_type_cd = ANY (coalesce(p_case_types, '{}'))
   ORDER BY r.case_type_cd, r.portal_key;

  SELECT count(*),
         count(*) FILTER (WHERE a.id IS NULL),
         count(*) FILTER (WHERE a.id IS NOT NULL AND (a.deleted_at IS NOT NULL OR a.portal_hash IS DISTINCT FROM i.hash)),
         count(*) FILTER (WHERE a.id IS NOT NULL AND a.deleted_at IS NULL AND a.portal_hash IS NOT DISTINCT FROM i.hash)
    INTO v_seen, v_new, v_changed, v_unchanged
    FROM _apps_in i
    LEFT JOIN public.gst_portal_applications a
      ON a.client_id = p_client_id AND a.case_type_cd = i.case_type_cd AND a.portal_key = i.portal_key;

  INSERT INTO public.gst_portal_applications AS t
         (client_id, case_type_cd, portal_key, arn, case_id, form_number, form_description, status, filed_date,
          raw_json, portal_hash, first_seen_at, last_seen_at, deleted_at)
  SELECT p_client_id, i.case_type_cd, i.portal_key, i.arn, i.case_id, i.form_number, i.form_description, i.status,
         i.filed_date, i.raw_json, i.hash, v_now, v_now, NULL
    FROM _apps_in i
  ON CONFLICT (client_id, case_type_cd, portal_key) DO UPDATE SET
    arn = EXCLUDED.arn, case_id = coalesce(EXCLUDED.case_id, t.case_id), form_number = EXCLUDED.form_number,
    form_description = EXCLUDED.form_description, status = EXCLUDED.status, filed_date = EXCLUDED.filed_date,
    raw_json = coalesce(EXCLUDED.raw_json, t.raw_json), portal_hash = EXCLUDED.portal_hash,
    last_seen_at = greatest(t.last_seen_at, v_now), deleted_at = NULL;

  -- A type that came back with rows is complete: what it no longer lists is
  -- gone. A type that came back empty removes nothing.
  IF coalesce(p_complete, false) THEN
    UPDATE public.gst_portal_applications a
       SET deleted_at = v_now
     WHERE a.client_id = p_client_id AND a.deleted_at IS NULL
       AND a.case_type_cd IN (SELECT DISTINCT case_type_cd FROM _apps_in)
       AND NOT EXISTS (SELECT 1 FROM _apps_in i WHERE i.case_type_cd = a.case_type_cd AND i.portal_key = a.portal_key);
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  INSERT INTO public.sync_run_items (run_id, client_id, step, status, rows_seen, rows_new, rows_changed,
                                     rows_unchanged, rows_removed, ext_version)
  VALUES (p_run_id, p_client_id, 'applications', 'ok', v_seen, v_new, v_changed, v_unchanged, v_removed, p_ext_version);

  RETURN jsonb_build_object('status', 'ok', 'new', v_new, 'changed', v_changed, 'unchanged', v_unchanged,
                            'removed', v_removed);
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_ingest_applications(uuid, uuid, jsonb, text[], text, boolean) TO anon, authenticated, service_role;

-- ── 2. GSTR-3A: kept detail, closed on filing ──────────────────────────────
ALTER TABLE public.gst_notices ADD COLUMN IF NOT EXISTS portal_detail jsonb;
COMMENT ON COLUMN public.gst_notices.portal_detail IS
  'Detail the portal gives beyond the list row, by kind: gstr3a = {retTyp, ret_period, orderId} from the GSTR-3A summary.';

-- MM/YYYY from the summary's ret_period ('042026', '04/2026', 'April, 2026'); NULL when unsure.
CREATE OR REPLACE FUNCTION public.notice_gstr3a_period(p jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN s ~ '^(0[1-9]|1[0-2])20[0-9]{2}$' THEN substr(s, 1, 2) || '/' || substr(s, 3, 4)
    WHEN s ~ '^(0[1-9]|1[0-2])/20[0-9]{2}$' THEN s
    WHEN s ~* '^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ ,./-]+20[0-9]{2}$' THEN
      lpad(array_position(ARRAY['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
                          lower(substr(s, 1, 3)))::text, 2, '0') || '/' || substring(s from '(20[0-9]{2})$')
  END
  FROM (SELECT btrim(coalesce(p ->> 'ret_period', '')) AS s) v
$$;
-- Filing Status return types that settle a GSTR-3A for this return type.
CREATE OR REPLACE FUNCTION public.notice_gstr3a_return_types(p_ret_typ text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE upper(regexp_replace(coalesce(p_ret_typ, ''), '[^0-9A-Za-z]', '', 'g'))
    WHEN '3B' THEN ARRAY['GSTR-3B', 'GSTR-3B (Q)']
    WHEN 'GSTR3B' THEN ARRAY['GSTR-3B', 'GSTR-3B (Q)']
    WHEN '1' THEN ARRAY['GSTR-1', 'GSTR-1 (IFF)']
    WHEN 'GSTR1' THEN ARRAY['GSTR-1', 'GSTR-1 (IFF)']
    ELSE ARRAY[]::text[] END
$$;

CREATE OR REPLACE FUNCTION public.notices_close_gstr3a_filed(p_client_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n    int := 0;
  v_prev text := coalesce(current_setting('app.actor_name', true), '');
BEGIN
  IF to_regclass('public.filing_status') IS NULL THEN RETURN 0; END IF;
  PERFORM set_config('app.actor_name', 'Closing sweep', true);
  EXECUTE $sql$
    UPDATE public.gst_notices n
       SET staff_status = 'Closed', close_reason = 'auto:return_filed'
     WHERE n.deleted_at IS NULL
       AND coalesce(n.stage, 'new') IN ('new', 'triaged', 'evidence', 'waiting_client', 'draft')
       AND n.form_code = 'GSTR-3A' AND jsonb_typeof(n.portal_detail -> 'gstr3a') = 'object'
       AND ($1 IS NULL OR n.client_id = $1)
       AND EXISTS (SELECT 1 FROM public.filing_status fs
                    WHERE fs.client_id = n.client_id
                      AND fs.return_type::text = ANY (public.notice_gstr3a_return_types(n.portal_detail -> 'gstr3a' ->> 'retTyp'))
                      AND fs.period_month = public.notice_gstr3a_period(n.portal_detail -> 'gstr3a')
                      AND (fs.filed_date IS NOT NULL OR fs.status::text = 'Filed'))
  $sql$ USING p_client_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.actor_name', v_prev, true);
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notices_close_gstr3a_filed(uuid) TO anon, authenticated, service_role;

-- p_rows: [{portal_key, detail: {gstr3a: {...}}}] for this client's portal
-- notices. Returns how many notices changed.
CREATE OR REPLACE FUNCTION public.sync_notice_details(p_client_id uuid, p_rows jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE public.gst_notices n
     SET portal_detail = coalesce(n.portal_detail, '{}'::jsonb) || r.detail
    FROM jsonb_to_recordset(CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows ELSE '[]'::jsonb END)
         AS r(portal_key text, detail jsonb)
   WHERE n.client_id = p_client_id AND n.portal_key = r.portal_key AND n.deleted_at IS NULL
     AND jsonb_typeof(r.detail) = 'object'
     AND (n.portal_detail IS NULL OR NOT n.portal_detail @> r.detail);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.notices_close_gstr3a_filed(p_client_id);
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_notice_details(uuid, jsonb) TO anon, authenticated, service_role;

-- Marking a return filed closes the client's GSTR-3A for that return and period.
CREATE OR REPLACE FUNCTION public.filing_status_close_gstr3a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.filed_date IS NOT NULL OR NEW.status::text = 'Filed' THEN
    PERFORM public.notices_close_gstr3a_filed(NEW.client_id);
  END IF;
  RETURN NULL;
END;
$$;
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'filing_status' AND column_name IN ('status', 'filed_date')) = 2 THEN
    EXECUTE 'DROP TRIGGER IF EXISTS filing_status_close_gstr3a ON public.filing_status';
    EXECUTE 'CREATE TRIGGER filing_status_close_gstr3a AFTER INSERT OR UPDATE OF status, filed_date ON public.filing_status '
         || 'FOR EACH ROW EXECUTE FUNCTION public.filing_status_close_gstr3a()';
  END IF;
END $$;

-- ── 3. Registration status ─────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.gst_taxpayer_profile') IS NOT NULL THEN
    ALTER TABLE public.gst_taxpayer_profile
      ADD COLUMN IF NOT EXISTS gstin_status text,
      ADD COLUMN IF NOT EXISTS cancellation_date date,
      ADD COLUMN IF NOT EXISTS profile_json jsonb;
  END IF;
END $$;
