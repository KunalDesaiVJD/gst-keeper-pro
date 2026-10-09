-- Push recording for every GSTR-1 / GSTR-3B return, on the row Filing Status
-- actually shows (audit of 9 Oct 2026, after 20261009130000).
--
-- 1. filing_effective_return_type(): the return type Filing Status shows for a
--    client and period. An IFF (QRMP) client's GSTR-1 is the 'GSTR-1 (IFF)' row
--    and its quarter-end GSTR-3B the 'GSTR-3B (Q)' row, but every push writer
--    used the plain type, so a push landed on a row nobody sees (DINESH PATEL
--    Sep-26: hidden 'GSTR-1' Pushed, visible 'GSTR-1 (IFF)' Prepared).
--
-- 2. filing_record_push(): the one way a push is recorded. It stamps every row
--    of the return's family (GSTR-1 + GSTR-1 (IFF), GSTR-3B + GSTR-3B (Q)) that
--    exists and makes sure the effective row exists. mark_filing_pushed() and
--    the gstr1_data trigger now both go through it.
--
-- 3. A GSTR-3B push is recorded by the database when its 'ok' version row is
--    written, as GSTR-1 has been since 20261009130000. Until now only the
--    GSTR-3B page recorded it, so a closed or reloaded page lost the push.
--
-- 4. The direct-filing guard accepts the push marker from either GSTR-1 row of
--    the period (DINESH PATEL Sep-26's accepted push sits on the hidden row),
--    but the NIL flag only from the row being filed: the GSTR-1 page unticks
--    NIL on the visible row alone, so a stale tick on the hidden one must not
--    open it.
--
-- 5. Data fixes: (c) phantom version-history rows are quarantined, then (a)
--    pushed_at stamps with no accepted upload behind them are cleared, then (b)
--    what the hidden sibling row holds is copied to the visible row. (c) runs
--    first because (a) and (b) read the version history as evidence.

-- ---------------------------------------------------------------------------
-- 1. Effective return type
-- ---------------------------------------------------------------------------
-- Mirrors generateFilingRecords() / getEffectiveScheme() in
-- src/lib/filingRecords.ts: the scheme for the period comes from
-- client_scheme_history (the old scheme of the first change until a change's
-- month begins), else registration_type; the return list is the scheme's
-- template (RETURN_TYPES_BY_REGISTRATION) when the client has any history,
-- else clients.selected_returns. Same-day changes are ordered by changed_at,
-- id, which the page leaves to the database's row order.
CREATE OR REPLACE FUNCTION public.filing_effective_return_type(
  p_client_id    uuid,
  p_base         text,
  p_period_month text   -- MM/YYYY
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scheme   text;
  v_selected text[];
  v_has_hist boolean;
  v_period   date;
  v_month    int;
  v_list     text[];
BEGIN
  IF p_base NOT IN ('GSTR-1', 'GSTR-1 (IFF)', 'GSTR-3B', 'GSTR-3B (Q)') THEN
    RETURN p_base;
  END IF;

  SELECT c.registration_type::text, c.selected_returns::text[]
    INTO v_scheme, v_selected
    FROM public.clients c
   WHERE c.id = p_client_id;

  IF p_period_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    v_period := to_date('01/' || p_period_month, 'DD/MM/YYYY');
    v_month  := split_part(p_period_month, '/', 1)::int;
  END IF;

  v_has_hist := EXISTS (SELECT 1 FROM public.client_scheme_history h WHERE h.client_id = p_client_id);

  -- getEffectiveScheme() falls back to the current scheme for a period it
  -- cannot parse, history or not.
  IF v_has_hist AND v_period IS NOT NULL THEN
    v_scheme := COALESCE(
      (SELECT h.new_scheme FROM public.client_scheme_history h
        WHERE h.client_id = p_client_id
          AND date_trunc('month', h.effective_from_date)::date <= v_period
        ORDER BY h.effective_from_date DESC, h.changed_at DESC, h.id DESC
        LIMIT 1),
      (SELECT h.old_scheme FROM public.client_scheme_history h
        WHERE h.client_id = p_client_id
        ORDER BY h.effective_from_date, h.changed_at, h.id
        LIMIT 1));
  END IF;

  v_list := CASE
    WHEN v_has_hist THEN CASE v_scheme
      WHEN 'Regular'      THEN ARRAY['GSTR-1', 'GSTR-3B', 'ITC-04']
      WHEN 'Composition'  THEN ARRAY['CMP-08']
      WHEN 'Tax Deductor' THEN ARRAY['GSTR-7']
      WHEN 'ISD'          THEN ARRAY['GSTR-6']
      WHEN 'IFF'          THEN ARRAY['GSTR-1 (IFF)', 'GSTR-3B (Q)']
      ELSE ARRAY[]::text[]
    END
    ELSE COALESCE(v_selected, ARRAY[]::text[])
  END;

  IF p_base IN ('GSTR-1', 'GSTR-1 (IFF)') THEN
    RETURN CASE WHEN 'GSTR-1 (IFF)' = ANY (v_list) AND NOT ('GSTR-1' = ANY (v_list))
                THEN 'GSTR-1 (IFF)' ELSE 'GSTR-1' END;
  END IF;

  -- Filing Status shows 'GSTR-3B (Q)' only in a quarter-end month of a
  -- quarterly scheme, and never 'GSTR-3B' for one; outside the quarter end the
  -- plain type is the only one there is.
  RETURN CASE WHEN v_scheme IN ('IFF', 'Composition')
               AND v_month IN (3, 6, 9, 12)
               AND 'GSTR-3B (Q)' = ANY (v_list)
              THEN 'GSTR-3B (Q)' ELSE 'GSTR-3B' END;
END;
$$;

-- The app calls it with the anon key (no Supabase auth session).
GRANT EXECUTE ON FUNCTION public.filing_effective_return_type(uuid, text, text)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Recording a push
-- ---------------------------------------------------------------------------
-- Opens the 'Pushed' guard for the rest of the transaction (set_config's
-- is_local), then stamps every existing row of the family: a Filed row gets
-- only the marker, any other row becomes Pushed. The effective row is
-- inserted as Pushed when it is missing, even when a hidden sibling exists,
-- so the push always shows on the row Filing Status lists. Returns that
-- row's status: 'Filed' (left alone) or 'Pushed'.
--
-- A Filed row the filed-requirements trigger would now reject (legacy rows
-- filed before ARN and PDF were mandatory: 90 across the GSTR-1 and GSTR-3B
-- types, none after 02/2026) is left unstamped. Re-validating it on this
-- UPDATE would raise and take the push down, and with it the gstr1_data or
-- gstr3b_push_versions write whose trigger called this.
CREATE OR REPLACE FUNCTION public.filing_record_push(
  p_client_id    uuid,
  p_base         text,
  p_period_month text,
  p_actor        uuid,
  p_at           timestamptz
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_family    text[];
  v_effective text;
  v_result    text;
BEGIN
  PERFORM set_config('app.filing_push', 'on', true);

  v_family := CASE
    WHEN p_base IN ('GSTR-1', 'GSTR-1 (IFF)') THEN ARRAY['GSTR-1', 'GSTR-1 (IFF)']
    WHEN p_base IN ('GSTR-3B', 'GSTR-3B (Q)') THEN ARRAY['GSTR-3B', 'GSTR-3B (Q)']
    ELSE ARRAY[p_base]
  END;
  v_effective := public.filing_effective_return_type(p_client_id, p_base, p_period_month);

  UPDATE public.filing_status
     SET pushed_at = p_at
   WHERE client_id = p_client_id
     AND period_month = p_period_month
     AND return_type::text = ANY (v_family)
     AND status::text = 'Filed'
     AND upper(btrim(arn)) ~ '^[A-Z0-9]{15}$'
     AND NULLIF(btrim(return_pdf_url), '') IS NOT NULL;

  UPDATE public.filing_status
     SET status     = 'Pushed'::filing_status_type,
         pushed_at  = p_at,
         updated_at = now(),
         updated_by = COALESCE(p_actor, updated_by)
   WHERE client_id = p_client_id
     AND period_month = p_period_month
     AND return_type::text = ANY (v_family)
     AND status::text IS DISTINCT FROM 'Filed';

  INSERT INTO public.filing_status
    (client_id, return_type, period_month, status, updated_by, updated_at, pushed_at)
  VALUES
    (p_client_id, v_effective::return_type, p_period_month,
     'Pushed'::filing_status_type, p_actor, now(), p_at)
  ON CONFLICT (client_id, return_type, period_month) DO NOTHING;

  SELECT status::text INTO v_result
    FROM public.filing_status
   WHERE client_id = p_client_id
     AND period_month = p_period_month
     AND return_type::text = v_effective;

  RETURN COALESCE(v_result, 'Pushed');
END;
$$;

-- Internal: it takes any timestamp, so only the SECURITY DEFINER callers below
-- (which run as the owner) may call it. Supabase grants new functions to anon
-- and authenticated by default, hence the explicit revoke.
REVOKE ALL ON FUNCTION public.filing_record_push(uuid, text, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- Same signature and grants as before: the app and the extension (NIL push)
-- call it with 'GSTR-1' or 'GSTR-3B' and now reach the IFF / quarterly row.
CREATE OR REPLACE FUNCTION public.mark_filing_pushed(
  p_client_id    uuid,
  p_return_type  text,
  p_period_month text,
  p_actor        uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.filing_record_push(p_client_id, p_return_type, p_period_month, p_actor, now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_filing_pushed(uuid, text, text, uuid)
  TO anon, authenticated, service_role;

-- Accepted-only, as in 20261009130000; the push is stamped at the upload's own
-- time and attributed to whoever started it.
CREATE OR REPLACE FUNCTION public.gstr1_data_record_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.last_upload_status IS DISTINCT FROM 'accepted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.last_upload_status IS NOT DISTINCT FROM NEW.last_upload_status
     AND OLD.last_uploaded_at IS NOT DISTINCT FROM NEW.last_uploaded_at THEN
    RETURN NEW;
  END IF;
  IF NEW.period_month !~ '^[A-Za-z]{3}-[0-9]{2}$' THEN RETURN NEW; END IF;

  PERFORM public.filing_record_push(
    NEW.client_id,
    'GSTR-1',
    to_char(to_date(NEW.period_month, 'Mon-YY'), 'MM/YYYY'),
    NEW.last_uploaded_by,
    COALESCE(NEW.last_uploaded_at, now()));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gstr1_data_record_push ON public.gstr1_data;
CREATE TRIGGER trg_gstr1_data_record_push
  AFTER INSERT OR UPDATE OF last_upload_status, last_uploaded_at ON public.gstr1_data
  FOR EACH ROW EXECUTE FUNCTION public.gstr1_data_record_push();

-- ---------------------------------------------------------------------------
-- 3. Record a GSTR-3B push from its version row
-- ---------------------------------------------------------------------------
-- Only 'ok' counts; 'partial' and 'failed' are history, not a push (the same
-- rule as GSTR-1's partial upload). period_month here is MM/YYYY (every
-- stored row, and both writers pass the app's selected month); anything else
-- is not a period this can place.
CREATE OR REPLACE FUNCTION public.gstr3b_push_versions_record_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'ok' THEN RETURN NULL; END IF;
  IF NEW.period_month !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN RETURN NULL; END IF;

  PERFORM public.filing_record_push(
    NEW.client_id, 'GSTR-3B', NEW.period_month, NEW.actor_id, NEW.action_at);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gstr3b_push_versions_record_push ON public.gstr3b_push_versions;
CREATE TRIGGER trg_gstr3b_push_versions_record_push
  AFTER INSERT ON public.gstr3b_push_versions
  FOR EACH ROW EXECUTE FUNCTION public.gstr3b_push_versions_record_push();

-- ---------------------------------------------------------------------------
-- 4. Guard: the marker on either GSTR-1 row counts, NIL only on this row
-- ---------------------------------------------------------------------------
-- Push recorders before this migration stamped the hidden 'GSTR-1' row of an
-- IFF client, and filing_record_push() stamps every row of the family, so the
-- marker is read from both. The NIL flag is not: the GSTR-1 page ticks and
-- unticks it on the visible row only, and 5b has already copied the old
-- page's tick on the hidden row across (AMADIUS INFRA Sep-26). A hidden tick
-- that outlived an untick would otherwise let the return be Filed with no
-- push and no approval. The aggregates also keep NEW's own NIL flag when no
-- row is stored yet, which the old single-row SELECT INTO overwrote with NULL.
CREATE OR REPLACE FUNCTION public.filing_status_guard_direct_filing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pushed timestamptz;
  v_nil    boolean;
BEGIN
  IF NEW.status::text <> 'Filed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'Filed' THEN RETURN NEW; END IF;
  IF NOT public.gstr1_direct_filing_rule_applies(NEW.return_type::text, NEW.period_month) THEN
    RETURN NEW;
  END IF;

  -- An upsert (INSERT ... ON CONFLICT DO UPDATE, as the extension's pull
  -- does) reaches BEFORE INSERT with only the incoming columns, so read the
  -- stored rows' marker, and the stored NIL flag of NEW's own type, as well.
  v_pushed := NEW.pushed_at;
  v_nil := COALESCE(NEW.is_nil, false);
  IF v_pushed IS NULL OR NOT v_nil THEN
    SELECT COALESCE(v_pushed, max(fs.pushed_at)),
           v_nil OR COALESCE(bool_or(fs.is_nil) FILTER (WHERE fs.return_type = NEW.return_type), false)
      INTO v_pushed, v_nil
      FROM public.filing_status fs
     WHERE fs.client_id = NEW.client_id
       AND fs.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)')
       AND fs.period_month = NEW.period_month;
  END IF;
  IF v_pushed IS NOT NULL OR COALESCE(v_nil, false) THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.gstr1_direct_filing_approvals a
     WHERE a.client_id = NEW.client_id
       AND a.return_type = NEW.return_type::text
       AND a.period_month = NEW.period_month
       AND a.status = 'approved'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    '% for % was not pushed through GST Keeper, so it cannot be marked Filed or pulled from the portal until a superadmin approves a direct-filing request (Filing Status → Request approval).',
    NEW.return_type::text, NEW.period_month
    USING ERRCODE = 'check_violation';
END;
$$;

-- ---------------------------------------------------------------------------
-- 5c. Phantom version-history rows
-- ---------------------------------------------------------------------------
-- The GSTR-1 page backfills a synthetic IMPORT + UPLOAD pair ('... backfilled
-- from existing record') for a client and period with no history, from its
-- gstr1Data state, which still holds the PREVIOUS client's row right after the
-- client is switched. So other clients' imports and accepted uploads were
-- written into the new client's history (audit: ABHIJEET RAMNIKBHAI SATANI
-- Sep-26 holds BALMUKUND INFRA's 'Builder Returns — 09/2026' upload of 12:54:55.53;
-- TAMNNA INFRASTRUCTURE-GUJARAT Aug-26's 'timeout' is SHYAM GIRDHAR's).
--
-- Moved only when provably a copy:
--   IMPORT: action_at to the millisecond and file_name equal another client's
--     gstr1_data import (or a non-backfilled version row of another client),
--     and this client has no gstr1_data or non-backfilled version with that
--     file name.
--   UPLOAD: the backfill writes no file name, so it is tied through its batch
--     IMPORT (version_number - 1), which must be a proven copy from the same
--     client, whose gstr1_data last_uploaded_at equals this action_at to the
--     millisecond or, when that client has uploaded again since, whose own
--     UPLOAD or REFRESH_ERRORS version row has the same status within a second
--     (the page writes that row just after the stamp the backfill copies: 7
--     rows, 23 to 494 ms, e.g. ELENZA CALLISTA BUILDCON Jul-26 v2 is VISHVAS
--     POLYPACK's error refresh of 07 Aug 10:00:32.892).
-- On 9 Oct 2026 this moves 66 of 140 backfilled IMPORT rows and 34 of 50
-- backfilled UPLOAD rows (100); 21 client periods are left with no history.
-- Left in place: 40 IMPORT backfills naming a file of their own client (8 of
-- them that client's import of another month: a month switch, same bug), 33
-- IMPORT backfills no gstr1_data row matches any more (genuine, or copied from
-- a source since re-imported), the 15 UPLOAD backfills batched with one of
-- those 73, and SHREE MARUTI INFRA Jul-26 v1/v2, whose times are ELENZA
-- ARISTA's but whose 'Builder Returns — 07/2026' is a name SHREE MARUTI also
-- uses.
CREATE TABLE IF NOT EXISTS public.gstr1_upload_versions_quarantine (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month       text NOT NULL,
  version_number     integer NOT NULL,
  action_type        text NOT NULL,
  actor_id           uuid,
  action_at          timestamptz NOT NULL DEFAULT now(),
  file_name          text,
  status             text,
  summary            text,
  errors             jsonb,
  payload            jsonb,
  quarantined_reason text,
  quarantined_at     timestamptz DEFAULT now()
);

ALTER TABLE public.gstr1_upload_versions_quarantine ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gstr1_upload_versions_quarantine_public ON public.gstr1_upload_versions_quarantine;
CREATE POLICY gstr1_upload_versions_quarantine_public ON public.gstr1_upload_versions_quarantine
  FOR ALL TO public USING (true) WITH CHECK (true);

WITH bf AS (
  SELECT v.*
    FROM public.gstr1_upload_versions v
   WHERE v.summary LIKE '%backfilled from existing record%'
),
imp AS (
  SELECT bf.id, src.client_id AS source_client
    FROM bf
    CROSS JOIN LATERAL (
      SELECT x.client_id FROM (
        SELECT g.client_id
          FROM public.gstr1_data g
         WHERE g.client_id <> bf.client_id
           AND g.file_name = bf.file_name
           AND date_trunc('milliseconds', g.imported_at) = date_trunc('milliseconds', bf.action_at)
        UNION ALL
        SELECT v.client_id
          FROM public.gstr1_upload_versions v
         WHERE v.client_id <> bf.client_id
           AND v.file_name = bf.file_name
           AND COALESCE(v.summary, '') NOT LIKE '%backfilled from existing record%'
           AND date_trunc('milliseconds', v.action_at) = date_trunc('milliseconds', bf.action_at)
      ) x
      LIMIT 1
    ) src
   WHERE bf.action_type = 'IMPORT'
     AND NOT EXISTS (SELECT 1 FROM public.gstr1_data g
                      WHERE g.client_id = bf.client_id AND g.file_name = bf.file_name)
     AND NOT EXISTS (SELECT 1 FROM public.gstr1_upload_versions v
                      WHERE v.client_id = bf.client_id AND v.file_name = bf.file_name
                        AND COALESCE(v.summary, '') NOT LIKE '%backfilled from existing record%')
),
upl AS (
  SELECT t.id, t.source_client, t.import_version, t.by_data
    FROM (
      SELECT u.id, imp.source_client, s.version_number AS import_version,
             EXISTS (SELECT 1 FROM public.gstr1_data g
                      WHERE g.client_id = imp.source_client
                        AND g.file_name = s.file_name
                        AND date_trunc('milliseconds', g.last_uploaded_at) = date_trunc('milliseconds', u.action_at)
             ) AS by_data,
             -- The source has uploaded again since, so its gstr1_data no
             -- longer holds this time; its own version row of that upload or
             -- error refresh still does.
             EXISTS (SELECT 1 FROM public.gstr1_upload_versions w
                      WHERE w.client_id = imp.source_client
                        AND w.action_type IN ('UPLOAD', 'REFRESH_ERRORS')
                        AND COALESCE(w.summary, '') NOT LIKE '%backfilled from existing record%'
                        AND w.status IS NOT DISTINCT FROM u.status
                        AND w.action_at BETWEEN u.action_at - interval '1 second'
                                            AND u.action_at + interval '1 second'
             ) AS by_version
        FROM bf u
        JOIN bf s
          ON s.client_id = u.client_id
         AND s.period_month = u.period_month
         AND s.version_number = u.version_number - 1
         AND s.action_type = 'IMPORT'
        JOIN imp ON imp.id = s.id
       WHERE u.action_type = 'UPLOAD'
    ) t
   WHERE t.by_data OR t.by_version
),
moved AS (
  SELECT imp.id,
         format('Copy of client %s''s import (same file name and time to the millisecond) written by the GSTR-1 page''s stale history backfill',
                imp.source_client) AS reason
    FROM imp
  UNION ALL
  SELECT upl.id,
         format('Copy of client %s''s upload (%s), backfilled with the copied import v%s',
                upl.source_client,
                CASE WHEN upl.by_data THEN 'same time to the millisecond'
                     ELSE 'its own upload version within a second, same status' END,
                upl.import_version)
    FROM upl
)
INSERT INTO public.gstr1_upload_versions_quarantine
  (id, client_id, period_month, version_number, action_type, actor_id, action_at,
   file_name, status, summary, errors, payload, quarantined_reason)
SELECT v.id, v.client_id, v.period_month, v.version_number, v.action_type, v.actor_id, v.action_at,
       v.file_name, v.status, v.summary, v.errors, v.payload, m.reason
  FROM moved m
  JOIN public.gstr1_upload_versions v ON v.id = m.id
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.gstr1_upload_versions v
 USING public.gstr1_upload_versions_quarantine q
 WHERE q.id = v.id;

-- ---------------------------------------------------------------------------
-- 5a. pushed_at with no accepted upload behind it
-- ---------------------------------------------------------------------------
-- 20261009100000's backfill stamped pushed_at from 'partial' uploads, which
-- the push rule does not count, and the stamp lets a return be marked Filed
-- without an approval. Cleared on non-Filed GSTR-1 rows when either
--   (i) the client and period have no accepted upload at all (gstr1_data or
--       non-phantom version history) and no NIL flag, a NIL push needing none; or
--   (ii) the stamp is, to the millisecond, the stored upload's own time while
--       that upload is not accepted: the backfill's signature, which (i) misses
--       when an earlier accepted upload exists.
-- On 9 Oct 2026 this clears:
--   PRIDE DRUGS & PHARMA PRIVATE LIMITED  GSTR-1        09/2026  2026-10-07 06:22:50.785 UTC  (i): six uploads, all partial
--   DINESH PATEL                          GSTR-1 (IFF)  09/2026  2026-10-08 05:47:42.945 UTC  (ii): the 08 Oct partial; the
--     accepted push of 07 Oct 13:30 UTC sits on the hidden 'GSTR-1' row and reaches this row in 5b.
DO $$
BEGIN
  PERFORM set_config('app.filing_push', 'on', true);

  WITH accepted AS (
    SELECT g.client_id, to_char(to_date(g.period_month, 'Mon-YY'), 'MM/YYYY') AS period
      FROM public.gstr1_data g
     WHERE g.last_upload_status = 'accepted'
       AND g.period_month ~ '^[A-Za-z]{3}-[0-9]{2}$'
    UNION
    SELECT v.client_id, to_char(to_date(v.period_month, 'Mon-YY'), 'MM/YYYY')
      FROM public.gstr1_upload_versions v
     WHERE v.action_type = 'UPLOAD'
       AND v.status = 'accepted'
       AND v.period_month ~ '^[A-Za-z]{3}-[0-9]{2}$'
  ),
  unaccepted_stamp AS (
    SELECT g.client_id, to_char(to_date(g.period_month, 'Mon-YY'), 'MM/YYYY') AS period,
           date_trunc('milliseconds', g.last_uploaded_at) AS at
      FROM public.gstr1_data g
     WHERE g.last_upload_status IS DISTINCT FROM 'accepted'
       AND g.last_uploaded_at IS NOT NULL
       AND g.period_month ~ '^[A-Za-z]{3}-[0-9]{2}$'
  )
  UPDATE public.filing_status fs
     SET pushed_at = NULL
   WHERE fs.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)')
     AND fs.status::text IS DISTINCT FROM 'Filed'
     AND fs.pushed_at IS NOT NULL
     AND (
       (NOT EXISTS (SELECT 1 FROM accepted a
                     WHERE a.client_id = fs.client_id AND a.period = fs.period_month)
        AND NOT EXISTS (SELECT 1 FROM public.filing_status n
                         WHERE n.client_id = fs.client_id
                           AND n.period_month = fs.period_month
                           AND n.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)')
                           AND n.is_nil))
       OR EXISTS (SELECT 1 FROM unaccepted_stamp u
                   WHERE u.client_id = fs.client_id
                     AND u.period = fs.period_month
                     AND u.at = date_trunc('milliseconds', fs.pushed_at))
     );
END $$;

-- ---------------------------------------------------------------------------
-- 5b. Copy what the hidden sibling holds to the visible row
-- ---------------------------------------------------------------------------
-- Where both rows of a family exist, the effective row takes the sibling's NIL
-- flag, its Pushed status (never over Filed) and its pushed_at when an
-- accepted upload backs it (for GSTR-3B, an 'ok' push version). The sibling
-- stays as it is. On 9 Oct 2026:
--   DINESH PATEL   09/2026  GSTR-1 (IFF) <- 'GSTR-1': Pushed, pushed_at 2026-10-07 13:30:23.107459 UTC
--                  (the page's mark after the accepted upload, version 4 at 13:30:23.198)
--   AMADIUS INFRA  09/2026  GSTR-1 (IFF) <- 'GSTR-1': is_nil
DO $$
BEGIN
  PERFORM set_config('app.filing_push', 'on', true);

  WITH accepted AS (
    SELECT g.client_id, to_char(to_date(g.period_month, 'Mon-YY'), 'MM/YYYY') AS period
      FROM public.gstr1_data g
     WHERE g.last_upload_status = 'accepted'
       AND g.period_month ~ '^[A-Za-z]{3}-[0-9]{2}$'
    UNION
    SELECT v.client_id, to_char(to_date(v.period_month, 'Mon-YY'), 'MM/YYYY')
      FROM public.gstr1_upload_versions v
     WHERE v.action_type = 'UPLOAD'
       AND v.status = 'accepted'
       AND v.period_month ~ '^[A-Za-z]{3}-[0-9]{2}$'
  ),
  unaccepted_stamp AS (
    SELECT g.client_id, to_char(to_date(g.period_month, 'Mon-YY'), 'MM/YYYY') AS period,
           date_trunc('milliseconds', g.last_uploaded_at) AS at
      FROM public.gstr1_data g
     WHERE g.last_upload_status IS DISTINCT FROM 'accepted'
       AND g.last_uploaded_at IS NOT NULL
       AND g.period_month ~ '^[A-Za-z]{3}-[0-9]{2}$'
  ),
  pairs AS (
    SELECT e.id AS eff_id,
           s.is_nil AS s_nil,
           s.status::text AS s_status,
           CASE
             WHEN s.pushed_at IS NULL THEN NULL
             WHEN s.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)') THEN
               CASE WHEN EXISTS (SELECT 1 FROM accepted a
                                  WHERE a.client_id = s.client_id AND a.period = s.period_month)
                     AND NOT EXISTS (SELECT 1 FROM unaccepted_stamp u
                                      WHERE u.client_id = s.client_id AND u.period = s.period_month
                                        AND u.at = date_trunc('milliseconds', s.pushed_at))
                    THEN s.pushed_at END
             ELSE
               CASE WHEN EXISTS (SELECT 1 FROM public.gstr3b_push_versions p
                                  WHERE p.client_id = s.client_id AND p.period_month = s.period_month
                                    AND p.status = 'ok')
                    THEN s.pushed_at END
           END AS s_pushed_at
      FROM public.filing_status e
      JOIN public.filing_status s
        ON s.client_id = e.client_id
       AND s.period_month = e.period_month
       AND s.return_type <> e.return_type
       AND ((e.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)') AND s.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)'))
         OR (e.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') AND s.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)')))
     WHERE e.return_type::text = public.filing_effective_return_type(e.client_id, e.return_type::text, e.period_month)
  )
  UPDATE public.filing_status e
     SET is_nil    = e.is_nil OR p.s_nil,
         pushed_at = COALESCE(e.pushed_at, p.s_pushed_at),
         status    = CASE WHEN p.s_status = 'Pushed' AND e.status::text IS DISTINCT FROM 'Filed'
                          THEN 'Pushed'::filing_status_type ELSE e.status END
    FROM pairs p
   WHERE e.id = p.eff_id
     AND ((p.s_nil AND NOT e.is_nil)
       OR (p.s_pushed_at IS NOT NULL AND e.pushed_at IS NULL)
       OR (p.s_status = 'Pushed' AND e.status::text IS DISTINCT FROM 'Pushed' AND e.status::text IS DISTINCT FROM 'Filed'))
     -- Same reason as in filing_record_push(): never re-validate a legacy Filed row.
     AND (e.status::text IS DISTINCT FROM 'Filed'
          OR (upper(btrim(e.arn)) ~ '^[A-Z0-9]{15}$' AND NULLIF(btrim(e.return_pdf_url), '') IS NOT NULL));
END $$;
