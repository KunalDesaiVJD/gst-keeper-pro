-- Notices Phase 1 · one ingest door and a run ledger
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: roadmap Phase 1 task 1; findings S-01..S-04, S-08, S-25).
--
-- The extension wrote four tables straight through PostgREST with its own
-- clock, its own soft-delete rules and no record of what a run did. Now:
--   * sync_ingest() is the one door for portal rows: a per-client advisory lock
--     (two PCs syncing the same client queue up instead of interleaving), server
--     timestamps, last_seen_at that never moves backwards, a content hash per
--     row (portal_hash) so a run can say what was new / changed / removed, and
--     rows marked missing only from a complete, non-empty pull that would not
--     remove more than half of the client's live rows (else "held");
--   * sync_runs / sync_run_items are the ledger: one run per Sync All, one item
--     per client and step, with counts and a failure reason class;
--   * client_sync_status answers "when did this client last sync, and if it
--     failed, why" per step, with staleness at 24 hours;
--   * sync_queue() orders a Sync All by risk: clients with open notices due
--     within 7 days (or overdue) first, then never-synced, then the stalest.
-- Extension 0.5.0 uses these; 0.4.0 keeps working through the old REST path
-- (the sync guard trigger applies the same protections to it).

ALTER TABLE public.gst_notices             ADD COLUMN IF NOT EXISTS portal_hash text;
ALTER TABLE public.gst_case_folder_items   ADD COLUMN IF NOT EXISTS portal_hash text;
ALTER TABLE public.gst_refund_applications ADD COLUMN IF NOT EXISTS portal_hash text;
ALTER TABLE public.gst_drc03_filings       ADD COLUMN IF NOT EXISTS portal_hash text;

CREATE TABLE IF NOT EXISTS public.sync_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  mode          text,
  ext_version   text,
  machine       text,
  clients_total int,
  clients_done  int NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'done', 'stopped', 'abandoned', 'failed')),
  note          text
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON public.sync_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.sync_run_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid REFERENCES public.sync_runs(id) ON DELETE SET NULL,
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  step           text NOT NULL,
  scope          text,
  status         text NOT NULL CHECK (status IN ('ok', 'held', 'failed', 'skipped')),
  reason_class   text,
  message        text,
  rows_seen      int NOT NULL DEFAULT 0,
  rows_new       int NOT NULL DEFAULT 0,
  rows_changed   int NOT NULL DEFAULT 0,
  rows_unchanged int NOT NULL DEFAULT 0,
  rows_removed   int NOT NULL DEFAULT 0,
  rows_held      int NOT NULL DEFAULT 0,
  ext_version    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_run_items_client_step ON public.sync_run_items (client_id, step, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_run_items_run ON public.sync_run_items (run_id);
COMMENT ON COLUMN public.sync_run_items.reason_class IS
  'Why a step did not fully succeed: login_failed, captcha_timeout, session_mismatch, portal_error, timeout, save_failed, stalled, guard_held, partial, empty, skipped_inactive, other.';

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_run_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sync_runs_public" ON public.sync_runs;
CREATE POLICY "sync_runs_public" ON public.sync_runs FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sync_run_items_public" ON public.sync_run_items;
CREATE POLICY "sync_run_items_public" ON public.sync_run_items FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_runs, public.sync_run_items TO anon, authenticated, service_role;

-- The Company List / Sync health card filter client_sync_log by action and time.
CREATE INDEX IF NOT EXISTS idx_client_sync_log_action_ts ON public.client_sync_log (action, created_at DESC);

CREATE OR REPLACE FUNCTION public.sync_run_start(p_mode text, p_clients_total int DEFAULT NULL,
                                                 p_ext_version text DEFAULT NULL, p_machine text DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- A run nobody finished within 6 hours is marked abandoned when the next one starts.
  WITH stale AS (
    UPDATE public.sync_runs SET status = 'abandoned', finished_at = coalesce(finished_at, now())
     WHERE status = 'running' AND started_at < now() - interval '6 hours'
  )
  INSERT INTO public.sync_runs (mode, clients_total, ext_version, machine)
  VALUES (p_mode, p_clients_total, p_ext_version, p_machine)
  RETURNING id
$$;

CREATE OR REPLACE FUNCTION public.sync_run_finish(p_run_id uuid, p_status text DEFAULT 'done', p_note text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.sync_runs
     SET status = CASE WHEN p_status IN ('done', 'stopped', 'abandoned', 'failed') THEN p_status ELSE 'done' END,
         finished_at = now(),
         note = coalesce(p_note, note),
         clients_done = (SELECT count(DISTINCT client_id) FROM public.sync_run_items WHERE run_id = p_run_id)
   WHERE id = p_run_id
$$;

-- A step that never reached the ingest (login failed, CAPTCHA not typed, portal
-- error, timeout, stalled) is recorded here with its reason class.
CREATE OR REPLACE FUNCTION public.sync_log_step(p_run_id uuid, p_client_id uuid, p_step text, p_status text,
                                                p_reason_class text DEFAULT NULL, p_message text DEFAULT NULL,
                                                p_ext_version text DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.sync_run_items (run_id, client_id, step, status, reason_class, message, ext_version)
  VALUES (p_run_id, p_client_id, p_step,
          CASE WHEN p_status IN ('ok', 'held', 'failed', 'skipped') THEN p_status ELSE 'failed' END,
          p_reason_class, left(p_message, 2000), p_ext_version)
  RETURNING id
$$;

-- A malformed date from the portal (31/02/2026, '') becomes NULL instead of
-- failing the whole client's ingest.
CREATE OR REPLACE FUNCTION public.sync_clean_row(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  k text;
  v_out jsonb := p;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN p; END IF;
  FOREACH k IN ARRAY ARRAY['issue_date', 'due_date', 'filed_date', 'period_from', 'period_to'] LOOP
    IF jsonb_typeof(p -> k) = 'string' THEN
      v_out := jsonb_set(v_out, ARRAY[k],
                         coalesce(to_jsonb(public.notices_parse_portal_date(p ->> k)), 'null'::jsonb));
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;

-- The one door for portal rows. p_step: notices | case_folder | refunds | drc03.
-- (The upsert runs as a data-modifying CTE: PostgreSQL executes it exactly once,
-- and "classified" reads the rows as they were before it, which is what the
-- new / changed / unchanged counts need.)
-- p_scope: the case id for case_folder. p_complete = false when any part of the
-- pull failed, so nothing is marked missing.
CREATE OR REPLACE FUNCTION public.sync_ingest(p_client_id uuid, p_run_id uuid, p_step text, p_rows jsonb,
                                              p_ext_version text DEFAULT NULL, p_complete boolean DEFAULT true,
                                              p_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Bookkeeping keys never count as a portal change.
  c_skip constant text[] := ARRAY['client_id', 'source', 'pulled_at', 'pulled_by', 'last_seen_at', 'first_seen_at',
                                  'deleted_at', 'pdf_url', 'attachments', 'documents', 'portal_hash', 'id',
                                  'created_at', 'updated_at'];
  v_now       timestamptz := now();
  v_keys      text[];
  v_new       int := 0;
  v_changed   int := 0;
  v_unchanged int := 0;
  v_removed   int := 0;
  v_held      int := 0;
  v_live      int := 0;
  v_stale     int := 0;
  v_status    text := 'ok';
  v_reason    text;
  v_message   text;
  v_item      uuid;
  v_sweep     jsonb;
  v_prev_actor text := coalesce(current_setting('app.actor_name', true), '');
BEGIN
  IF p_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'sync_ingest: unknown client %', p_client_id USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'sync_ingest: rows must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_step NOT IN ('notices', 'case_folder', 'refunds', 'drc03') THEN
    RAISE EXCEPTION 'sync_ingest: unknown step %', p_step USING ERRCODE = '22023';
  END IF;
  IF p_step = 'case_folder' AND coalesce(p_scope, '') = '' THEN
    RAISE EXCEPTION 'sync_ingest: case_folder needs the case id in p_scope' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('sync_ingest:' || p_client_id::text || ':' || p_step || ':' || coalesce(p_scope, ''), 0));
  PERFORM set_config('app.actor_name', 'Portal sync', true);

  SELECT coalesce(array_agg(DISTINCT e ->> 'portal_key'), '{}')
    INTO v_keys
    FROM jsonb_array_elements(p_rows) e
   WHERE jsonb_typeof(e) = 'object' AND coalesce(e ->> 'portal_key', '') <> '';

  IF p_step = 'notices' THEN
    WITH incoming AS (
      SELECT DISTINCT ON (x.portal_key) x.*, md5((e.elem - c_skip)::text) AS hash
        FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(raw, ord)
        CROSS JOIN LATERAL (SELECT public.sync_clean_row(r.raw) AS elem, r.ord) AS e
        CROSS JOIN LATERAL jsonb_populate_record(NULL::public.gst_notices, e.elem) AS x
       WHERE jsonb_typeof(e.elem) = 'object' AND coalesce(x.portal_key, '') <> ''
         AND x.portal_key NOT LIKE 'manual:%'
       ORDER BY x.portal_key, e.ord DESC
    ), classified AS (
      SELECT i.hash, t.id AS existing_id, t.portal_hash AS old_hash, t.deleted_at AS old_deleted
        FROM incoming i
        LEFT JOIN public.gst_notices t
          ON t.client_id = p_client_id AND t.source = 'notices' AND t.portal_key = i.portal_key
    ), upserted AS (
      INSERT INTO public.gst_notices AS t
        (client_id, source, portal_key, reference_number, notice_type, description, issue_date, due_date,
         status, issued_by, case_id, pdf_url, pulled_at, last_seen_at, first_seen_at, deleted_at, portal_hash)
      SELECT p_client_id, 'notices', i.portal_key, i.reference_number, i.notice_type, i.description, i.issue_date,
             i.due_date, i.status, i.issued_by, nullif(i.case_id, ''), i.pdf_url, v_now, v_now, v_now, NULL, i.hash
        FROM incoming i
      ON CONFLICT (client_id, source, portal_key) DO UPDATE SET
        reference_number = EXCLUDED.reference_number,
        notice_type      = EXCLUDED.notice_type,
        description      = EXCLUDED.description,
        issue_date       = EXCLUDED.issue_date,
        due_date         = EXCLUDED.due_date,
        status           = EXCLUDED.status,
        issued_by        = EXCLUDED.issued_by,
        case_id          = coalesce(EXCLUDED.case_id, t.case_id),
        pdf_url          = coalesce(EXCLUDED.pdf_url, t.pdf_url),
        pulled_at        = v_now,
        last_seen_at     = greatest(t.last_seen_at, v_now),
        deleted_at       = NULL,
        portal_hash      = EXCLUDED.portal_hash
      RETURNING 1
    )
    SELECT count(*) FILTER (WHERE existing_id IS NULL),
           count(*) FILTER (WHERE existing_id IS NOT NULL
                              AND (old_deleted IS NOT NULL OR (old_hash IS NOT NULL AND old_hash <> hash))),
           count(*) FILTER (WHERE existing_id IS NOT NULL AND old_deleted IS NULL
                              AND (old_hash IS NULL OR old_hash = hash))
      INTO v_new, v_changed, v_unchanged
      FROM classified;

    SELECT count(*), count(*) FILTER (WHERE NOT (t.portal_key = ANY (v_keys)))
      INTO v_live, v_stale
      FROM public.gst_notices t
     WHERE t.client_id = p_client_id AND t.source = 'notices' AND t.deleted_at IS NULL
       AND t.portal_key NOT LIKE 'manual:%';

  ELSIF p_step = 'case_folder' THEN
    WITH incoming AS (
      SELECT DISTINCT ON (x.portal_key) x.*, md5((e.elem - c_skip)::text) AS hash
        FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(raw, ord)
        CROSS JOIN LATERAL (SELECT public.sync_clean_row(r.raw) AS elem, r.ord) AS e
        CROSS JOIN LATERAL jsonb_populate_record(NULL::public.gst_case_folder_items, e.elem) AS x
       WHERE jsonb_typeof(e.elem) = 'object' AND coalesce(x.portal_key, '') <> ''
       ORDER BY x.portal_key, e.ord DESC
    ), classified AS (
      SELECT i.hash, t.id AS existing_id, t.portal_hash AS old_hash, t.deleted_at AS old_deleted
        FROM incoming i
        LEFT JOIN public.gst_case_folder_items t
          ON t.client_id = p_client_id AND t.case_id = p_scope AND t.portal_key = i.portal_key
    ), upserted AS (
      INSERT INTO public.gst_case_folder_items AS t
        (client_id, case_id, portal_key, folder_section, reference_number, attachments, raw_json,
         pulled_at, last_seen_at, first_seen_at, deleted_at, portal_hash)
      SELECT p_client_id, p_scope, i.portal_key, i.folder_section, i.reference_number,
             coalesce(i.attachments, '[]'::jsonb), i.raw_json, v_now, v_now, v_now, NULL, i.hash
        FROM incoming i
      ON CONFLICT (client_id, case_id, portal_key) DO UPDATE SET
        folder_section   = EXCLUDED.folder_section,
        reference_number = EXCLUDED.reference_number,
        -- Keep every attachment already stored; add the ones captured now.
        attachments      = (SELECT coalesce(jsonb_agg(DISTINCT a), '[]'::jsonb)
                              FROM jsonb_array_elements(coalesce(t.attachments, '[]'::jsonb)
                                                        || coalesce(EXCLUDED.attachments, '[]'::jsonb)) a),
        raw_json         = coalesce(EXCLUDED.raw_json, t.raw_json),
        pulled_at        = v_now,
        last_seen_at     = greatest(t.last_seen_at, v_now),
        deleted_at       = NULL,
        portal_hash      = EXCLUDED.portal_hash
      RETURNING 1
    )
    SELECT count(*) FILTER (WHERE existing_id IS NULL),
           count(*) FILTER (WHERE existing_id IS NOT NULL
                              AND (old_deleted IS NOT NULL OR (old_hash IS NOT NULL AND old_hash <> hash))),
           count(*) FILTER (WHERE existing_id IS NOT NULL AND old_deleted IS NULL
                              AND (old_hash IS NULL OR old_hash = hash))
      INTO v_new, v_changed, v_unchanged
      FROM classified;

    SELECT count(*), count(*) FILTER (WHERE NOT (t.portal_key = ANY (v_keys)))
      INTO v_live, v_stale
      FROM public.gst_case_folder_items t
     WHERE t.client_id = p_client_id AND t.case_id = p_scope AND t.deleted_at IS NULL;

  ELSIF p_step = 'refunds' THEN
    WITH incoming AS (
      SELECT DISTINCT ON (x.portal_key) x.*, md5((e.elem - c_skip)::text) AS hash
        FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(raw, ord)
        CROSS JOIN LATERAL (SELECT public.sync_clean_row(r.raw) AS elem, r.ord) AS e
        CROSS JOIN LATERAL jsonb_populate_record(NULL::public.gst_refund_applications, e.elem) AS x
       WHERE jsonb_typeof(e.elem) = 'object' AND coalesce(x.portal_key, '') <> ''
       ORDER BY x.portal_key, e.ord DESC
    ), classified AS (
      SELECT i.hash, t.id AS existing_id, t.portal_hash AS old_hash, t.deleted_at AS old_deleted
        FROM incoming i
        LEFT JOIN public.gst_refund_applications t ON t.client_id = p_client_id AND t.portal_key = i.portal_key
    ), upserted AS (
      INSERT INTO public.gst_refund_applications AS t
        (client_id, portal_key, arn, refund_type, source_ledger, filed_date, claimed_amount, sanctioned_amount,
         status, documents, pulled_at, last_seen_at, first_seen_at, deleted_at, portal_hash)
      SELECT p_client_id, i.portal_key, i.arn, i.refund_type, i.source_ledger, i.filed_date, i.claimed_amount,
             i.sanctioned_amount, i.status, coalesce(i.documents, '[]'::jsonb), v_now, v_now, v_now, NULL, i.hash
        FROM incoming i
      ON CONFLICT (client_id, portal_key) DO UPDATE SET
        arn               = EXCLUDED.arn,
        refund_type       = EXCLUDED.refund_type,
        source_ledger     = EXCLUDED.source_ledger,
        filed_date        = EXCLUDED.filed_date,
        claimed_amount    = EXCLUDED.claimed_amount,
        sanctioned_amount = coalesce(EXCLUDED.sanctioned_amount, t.sanctioned_amount),
        status            = EXCLUDED.status,
        documents         = CASE WHEN jsonb_array_length(EXCLUDED.documents) > 0 THEN EXCLUDED.documents ELSE t.documents END,
        pulled_at         = v_now,
        last_seen_at      = greatest(t.last_seen_at, v_now),
        deleted_at        = NULL,
        portal_hash       = EXCLUDED.portal_hash
      RETURNING 1
    )
    SELECT count(*) FILTER (WHERE existing_id IS NULL),
           count(*) FILTER (WHERE existing_id IS NOT NULL
                              AND (old_deleted IS NOT NULL OR (old_hash IS NOT NULL AND old_hash <> hash))),
           count(*) FILTER (WHERE existing_id IS NOT NULL AND old_deleted IS NULL
                              AND (old_hash IS NULL OR old_hash = hash))
      INTO v_new, v_changed, v_unchanged
      FROM classified;

    SELECT count(*), count(*) FILTER (WHERE NOT (t.portal_key = ANY (v_keys)))
      INTO v_live, v_stale
      FROM public.gst_refund_applications t
     WHERE t.client_id = p_client_id AND t.deleted_at IS NULL;

  ELSE -- drc03
    WITH incoming AS (
      SELECT DISTINCT ON (x.portal_key) x.*, md5((e.elem - c_skip)::text) AS hash
        FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(raw, ord)
        CROSS JOIN LATERAL (SELECT public.sync_clean_row(r.raw) AS elem, r.ord) AS e
        CROSS JOIN LATERAL jsonb_populate_record(NULL::public.gst_drc03_filings, e.elem) AS x
       WHERE jsonb_typeof(e.elem) = 'object' AND coalesce(x.portal_key, '') <> ''
       ORDER BY x.portal_key, e.ord DESC
    ), classified AS (
      SELECT i.hash, t.id AS existing_id, t.portal_hash AS old_hash, t.deleted_at AS old_deleted
        FROM incoming i
        LEFT JOIN public.gst_drc03_filings t ON t.client_id = p_client_id AND t.portal_key = i.portal_key
    ), upserted AS (
      INSERT INTO public.gst_drc03_filings AS t
        (client_id, portal_key, arn, cause_of_payment, filed_date, period_from, period_to, cash_amount,
         credit_amount, status, financial_year, section, taxable_value, igst_amount, cgst_amount, sgst_amount,
         cess_amount, interest_amount, late_fee_amount, penalty_amount, pdf_url,
         pulled_at, last_seen_at, first_seen_at, deleted_at, portal_hash)
      SELECT p_client_id, i.portal_key, i.arn, i.cause_of_payment, i.filed_date, i.period_from, i.period_to,
             i.cash_amount, i.credit_amount, i.status, i.financial_year, i.section, i.taxable_value, i.igst_amount,
             i.cgst_amount, i.sgst_amount, i.cess_amount, i.interest_amount, i.late_fee_amount, i.penalty_amount,
             i.pdf_url, v_now, v_now, v_now, NULL, i.hash
        FROM incoming i
      ON CONFLICT (client_id, portal_key) DO UPDATE SET
        arn              = EXCLUDED.arn,
        cause_of_payment = EXCLUDED.cause_of_payment,
        filed_date       = EXCLUDED.filed_date,
        period_from      = EXCLUDED.period_from,
        period_to        = EXCLUDED.period_to,
        cash_amount      = EXCLUDED.cash_amount,
        credit_amount    = EXCLUDED.credit_amount,
        status           = EXCLUDED.status,
        financial_year   = EXCLUDED.financial_year,
        section          = EXCLUDED.section,
        taxable_value    = EXCLUDED.taxable_value,
        igst_amount      = EXCLUDED.igst_amount,
        cgst_amount      = EXCLUDED.cgst_amount,
        sgst_amount      = EXCLUDED.sgst_amount,
        cess_amount      = EXCLUDED.cess_amount,
        interest_amount  = EXCLUDED.interest_amount,
        late_fee_amount  = EXCLUDED.late_fee_amount,
        penalty_amount   = EXCLUDED.penalty_amount,
        pdf_url          = coalesce(EXCLUDED.pdf_url, t.pdf_url),
        pulled_at        = v_now,
        last_seen_at     = greatest(t.last_seen_at, v_now),
        deleted_at       = NULL,
        portal_hash      = EXCLUDED.portal_hash
      RETURNING 1
    )
    SELECT count(*) FILTER (WHERE existing_id IS NULL),
           count(*) FILTER (WHERE existing_id IS NOT NULL
                              AND (old_deleted IS NOT NULL OR (old_hash IS NOT NULL AND old_hash <> hash))),
           count(*) FILTER (WHERE existing_id IS NOT NULL AND old_deleted IS NULL
                              AND (old_hash IS NULL OR old_hash = hash))
      INTO v_new, v_changed, v_unchanged
      FROM classified;

    SELECT count(*), count(*) FILTER (WHERE NOT (t.portal_key = ANY (v_keys)))
      INTO v_live, v_stale
      FROM public.gst_drc03_filings t
     WHERE t.client_id = p_client_id AND t.deleted_at IS NULL;
  END IF;

  -- Marking rows missing: only from a complete, non-empty pull, and never more
  -- than half of the client's live rows at once (beyond 5).
  IF v_stale > 0 THEN
    IF cardinality(v_keys) = 0 THEN
      v_status := 'held'; v_reason := 'empty'; v_held := v_stale;
      v_message := 'Empty pull: nothing marked missing.';
    ELSIF NOT coalesce(p_complete, true) THEN
      v_status := 'held'; v_reason := 'partial'; v_held := v_stale;
      v_message := 'Part of the pull failed: nothing marked missing.';
    ELSIF v_stale > 5 AND v_stale > v_live / 2.0 THEN
      v_status := 'held'; v_reason := 'guard_held'; v_held := v_stale;
      v_message := format('Would mark %s of %s rows missing: held back for review.', v_stale, v_live);
    ELSIF p_step = 'notices' THEN
      UPDATE public.gst_notices t SET deleted_at = v_now
       WHERE t.client_id = p_client_id AND t.source = 'notices' AND t.deleted_at IS NULL
         AND t.portal_key NOT LIKE 'manual:%' AND NOT (t.portal_key = ANY (v_keys));
      GET DIAGNOSTICS v_removed = ROW_COUNT;
    ELSIF p_step = 'case_folder' THEN
      UPDATE public.gst_case_folder_items t SET deleted_at = v_now
       WHERE t.client_id = p_client_id AND t.case_id = p_scope AND t.deleted_at IS NULL
         AND NOT (t.portal_key = ANY (v_keys));
      GET DIAGNOSTICS v_removed = ROW_COUNT;
    ELSIF p_step = 'refunds' THEN
      UPDATE public.gst_refund_applications t SET deleted_at = v_now
       WHERE t.client_id = p_client_id AND t.deleted_at IS NULL AND NOT (t.portal_key = ANY (v_keys));
      GET DIAGNOSTICS v_removed = ROW_COUNT;
    ELSE
      UPDATE public.gst_drc03_filings t SET deleted_at = v_now
       WHERE t.client_id = p_client_id AND t.deleted_at IS NULL AND NOT (t.portal_key = ANY (v_keys));
      GET DIAGNOSTICS v_removed = ROW_COUNT;
    END IF;
  END IF;

  INSERT INTO public.sync_run_items (run_id, client_id, step, scope, status, reason_class, message, rows_seen,
                                     rows_new, rows_changed, rows_unchanged, rows_removed, rows_held, ext_version)
  VALUES (p_run_id, p_client_id, p_step, p_scope, v_status, v_reason, v_message, cardinality(v_keys),
          v_new, v_changed, v_unchanged, v_removed, v_held, p_ext_version)
  RETURNING id INTO v_item;

  -- Date the case notices and close what the portal shows as finished, right away.
  IF p_step IN ('notices', 'drc03') THEN
    v_sweep := public.notices_sweep(p_client_id);
  END IF;

  PERFORM set_config('app.actor_name', v_prev_actor, true);
  RETURN jsonb_build_object('item_id', v_item, 'status', v_status, 'new', v_new, 'changed', v_changed,
                            'unchanged', v_unchanged, 'removed', v_removed, 'held', v_held,
                            'held_reason', v_message, 'sweep', v_sweep);
END;
$$;

COMMENT ON FUNCTION public.sync_ingest(uuid, uuid, text, jsonb, text, boolean, text) IS
  'The one door for portal rows (notices | case_folder | refunds | drc03): advisory lock per client and step, server timestamps, content hash, guarded soft-delete, a sync_run_items ledger row, and the closing sweep after notices / DRC-03.';

-- Latest attempt and latest success per client and step; stale after 24 hours.
CREATE OR REPLACE VIEW public.client_sync_status WITH (security_invoker = true) AS
WITH last_attempt AS (
  SELECT DISTINCT ON (i.client_id, i.step)
         i.client_id, i.step, i.created_at AS last_attempt_at, i.status AS last_status,
         i.reason_class AS last_reason_class, i.message AS last_message, i.run_id AS last_run_id,
         i.ext_version AS last_ext_version
    FROM public.sync_run_items i
   WHERE i.step <> 'case_folder'
   ORDER BY i.client_id, i.step, i.created_at DESC
), last_success AS (
  SELECT DISTINCT ON (i.client_id, i.step)
         i.client_id, i.step, i.created_at AS last_success_at, i.rows_seen, i.rows_new, i.rows_changed,
         i.rows_removed, i.rows_held
    FROM public.sync_run_items i
   WHERE i.step <> 'case_folder' AND i.status IN ('ok', 'held')
   ORDER BY i.client_id, i.step, i.created_at DESC
)
SELECT a.client_id, a.step, a.last_attempt_at, a.last_status, a.last_reason_class, a.last_message,
       a.last_run_id, a.last_ext_version,
       s.last_success_at, s.rows_seen, s.rows_new, s.rows_changed, s.rows_removed, s.rows_held,
       (s.last_success_at IS NULL OR s.last_success_at < now() - interval '24 hours') AS is_stale
  FROM last_attempt a
  LEFT JOIN last_success s ON s.client_id = a.client_id AND s.step = a.step;
GRANT SELECT ON public.client_sync_status TO anon, authenticated, service_role;

-- Sync All order: open notices due within 7 days (or overdue) first, then
-- clients never synced, then the stalest. Inactive and excluded clients are
-- left out unless named in p_client_ids (a hand-picked selection).
CREATE OR REPLACE FUNCTION public.sync_queue(p_client_ids uuid[] DEFAULT NULL)
RETURNS TABLE (client_id uuid, name text, gstin text, urgent_notices int, last_success_at timestamptz, queue_reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible AS (
    SELECT c.id, c.name, c.gstin
      FROM public.clients c
     WHERE c.gst_user_id IS NOT NULL AND c.gst_user_id <> ''
       AND CASE WHEN p_client_ids IS NULL
                THEN NOT coalesce(c.inactive_at_hand, false) AND NOT coalesce(c.notices_sync_excluded, false)
                ELSE c.id = ANY (p_client_ids) AND NOT coalesce(c.notices_sync_excluded, false) END
  ), urgent AS (
    SELECT f.client_id, count(*)::int AS n
      FROM public.notice_facts f
     WHERE f.is_overdue OR f.is_due_in_7
     GROUP BY f.client_id
  ), synced AS (
    SELECT s.client_id, max(s.last_success_at) AS last_success_at
      FROM public.client_sync_status s
     WHERE s.step = 'notices'
     GROUP BY s.client_id
  )
  SELECT e.id, e.name, e.gstin, coalesce(u.n, 0), y.last_success_at,
         CASE WHEN coalesce(u.n, 0) > 0 THEN 'due within 7 days'
              WHEN y.last_success_at IS NULL THEN 'never synced'
              ELSE 'stalest first' END
    FROM eligible e
    LEFT JOIN urgent u ON u.client_id = e.id
    LEFT JOIN synced y ON y.client_id = e.id
   ORDER BY (coalesce(u.n, 0) > 0) DESC, coalesce(u.n, 0) DESC,
            (y.last_success_at IS NULL) DESC, y.last_success_at ASC NULLS FIRST, e.name
$$;

GRANT EXECUTE ON FUNCTION public.sync_run_start(text, int, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_run_finish(uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_log_step(uuid, uuid, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_ingest(uuid, uuid, text, jsonb, text, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_queue(uuid[]) TO anon, authenticated, service_role;
