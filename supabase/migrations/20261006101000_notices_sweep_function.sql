-- Notices Phase 0 · a closing sweep that works and runs by itself
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: L-02, L-10, L-11).
--
-- The old sweep (src/lib/noticeAutoClose.ts) filtered gst_case_folder_items.notice_id,
-- a column that never existed, so every click failed and nothing was ever auto-closed
-- or dated. Its due-date paths did not match the portal JSON either. This replaces it
-- with one database function, called:
--   · by the extension right after each client's notices pull (extension >= 0.4.0),
--   · nightly by pg_cron (03:00 IST), for every client,
--   · by the dashboard's "run the closing sweep" link.
-- Positions are recorded in docs/NOTICES_LITIGATION_POSITIONS.md §3–§4.

-- DD/MM/YYYY, DD-MM-YYYY or ISO (with or without a time) → date; anything else → NULL.
CREATE OR REPLACE FUNCTION public.notices_parse_portal_date(v text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE m text[];
BEGIN
  IF v IS NULL OR btrim(v) = '' THEN RETURN NULL; END IF;
  m := regexp_match(btrim(v), '^(\d{2})[/-](\d{2})[/-](\d{4})');
  IF m IS NOT NULL THEN RETURN make_date(m[3]::int, m[2]::int, m[1]::int); END IF;
  m := regexp_match(btrim(v), '^(\d{4})-(\d{2})-(\d{2})');
  IF m IS NOT NULL THEN RETURN make_date(m[1]::int, m[2]::int, m[3]::int); END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL; -- e.g. 31/02/2026
END;
$$;

-- A folder item's own detail sits one level under sdtls, under one of several keys
-- depending on its sub-type (same list as subDetail() in AdditionalNoticeFolderPage.tsx).
CREATE OR REPLACE FUNCTION public.notices_item_detail(j jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_typeof(j -> 'sdtls') = 'object' THEN COALESCE(
    CASE WHEN jsonb_typeof(j -> 'sdtls' -> 'dtscn') = 'object' THEN j -> 'sdtls' -> 'dtscn' END,
    CASE WHEN jsonb_typeof(j -> 'sdtls' -> 'srscn') = 'object' THEN j -> 'sdtls' -> 'srscn' END,
    CASE WHEN jsonb_typeof(j -> 'sdtls' -> 'remnd') = 'object' THEN j -> 'sdtls' -> 'remnd' END,
    CASE WHEN jsonb_typeof(j -> 'sdtls' -> 'dtorder') = 'object' THEN j -> 'sdtls' -> 'dtorder' END,
    CASE WHEN jsonb_typeof(j -> 'sdtls' -> 'sancordervo') = 'object' THEN j -> 'sdtls' -> 'sancordervo' END,
    CASE WHEN jsonb_typeof(j -> 'sdtls' -> 'payadviceordervo') = 'object' THEN j -> 'sdtls' -> 'payadviceordervo' END
  ) END
$$;

-- Reply due date of one folder item, read where the folder page reads it:
--   intimations  raw.duedt, or detail.replyDuedt
--   notices      detail.duedt
--   RFD-08       raw.sdtls.duedate
CREATE OR REPLACE FUNCTION public.notices_item_due_date(j jsonb)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT public.notices_parse_portal_date(COALESCE(
    CASE WHEN jsonb_typeof(j) = 'object' THEN j ->> 'duedt' END,
    public.notices_item_detail(j) ->> 'replyDuedt',
    public.notices_item_detail(j) ->> 'duedt',
    CASE WHEN jsonb_typeof(j -> 'sdtls') = 'object' THEN j -> 'sdtls' ->> 'duedate' END))
$$;

CREATE OR REPLACE FUNCTION public.notices_sweep(p_client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_due int := 0;
  v_closed int := 0;
  r record;
BEGIN
  -- 1 · Due dates for case-linked notices that have none. A notice takes the due
  -- date of its own folder item (same reference number); otherwise that of the
  -- most recently issued notice / intimation in its case that has not been replied
  -- to. (The old sweep took the EARLIEST date, so a case with a fresh notice read
  -- as overdue on the first notice's long-past deadline.)
  WITH items AS (
    SELECT fi.client_id, fi.case_id, fi.reference_number,
           upper(btrim(coalesce(fi.folder_section, ''))) AS sec,
           public.notices_item_due_date(fi.raw_json) AS due,
           public.notices_parse_portal_date(CASE WHEN jsonb_typeof(fi.raw_json) = 'object' THEN fi.raw_json ->> 'refdt' END) AS issued
      FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL
       AND (p_client_id IS NULL OR fi.client_id = p_client_id)
  ),
  replied AS (
    SELECT fi.client_id, fi.case_id,
           COALESCE(fi.raw_json -> 'reply' ->> 'ntcno', CASE WHEN jsonb_typeof(fi.raw_json) = 'object' THEN fi.raw_json ->> 'ntcno' END) AS against
      FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL
       AND upper(btrim(coalesce(fi.folder_section, ''))) IN ('REPLY', 'REPLIES')
       AND (p_client_id IS NULL OR fi.client_id = p_client_id)
  ),
  due_items AS (
    SELECT i.*
      FROM items i
     WHERE i.due IS NOT NULL
       AND i.sec IN ('INTIM', 'INTIMATIONS', 'NOTCE', 'NOTICE', 'NOTICES', 'NOTAC', 'NOTICE/ACKNOWLEDGEMENT')
       AND NOT EXISTS (SELECT 1 FROM replied rp
                        WHERE rp.client_id = i.client_id AND rp.case_id = i.case_id
                          AND rp.against IS NOT NULL AND rp.against = i.reference_number)
  ),
  pick AS (
    SELECT n.id,
           COALESCE(
             (SELECT d.due FROM due_items d
               WHERE d.client_id = n.client_id AND d.case_id = n.case_id AND d.reference_number = n.reference_number
               ORDER BY d.due DESC LIMIT 1),
             (SELECT d.due FROM due_items d
               WHERE d.client_id = n.client_id AND d.case_id = n.case_id
               ORDER BY d.issued DESC NULLS LAST, d.due DESC LIMIT 1)
           ) AS due
      FROM public.gst_notices n
     WHERE n.deleted_at IS NULL AND n.case_id IS NOT NULL AND n.due_date IS NULL
       AND (p_client_id IS NULL OR n.client_id = p_client_id)
  )
  UPDATE public.gst_notices n
     SET due_date = p.due
    FROM pick p
   WHERE n.id = p.id AND p.due IS NOT NULL AND n.due_date IS NULL;
  GET DIAGNOSTICS v_due = ROW_COUNT;

  -- 2 · Auto-close, only rows nobody has triaged yet (staff_status IS NULL).
  FOR r IN
    WITH cand AS (
      SELECT n.id, n.client_id, n.case_id, n.reference_number, coalesce(n.notice_type, '') AS ntype
        FROM public.gst_notices n
       WHERE n.deleted_at IS NULL AND n.staff_status IS NULL AND n.case_id IS NOT NULL
         AND (p_client_id IS NULL OR n.client_id = p_client_id)
    ),
    secs AS (
      SELECT fi.client_id, fi.case_id,
             bool_or(upper(btrim(coalesce(fi.folder_section, ''))) IN ('CLSR', 'CLOSR', 'CLOSURE')) AS has_closure,
             bool_or(upper(btrim(coalesce(fi.folder_section, ''))) IN ('ORDRS', 'ORDER', 'ORDERS')) AS has_order,
             bool_or(upper(btrim(coalesce(fi.folder_section, ''))) IN ('ORDRS', 'ORDER', 'ORDERS')
                     AND jsonb_typeof(fi.raw_json -> 'sdtls' -> 'payadviceordervo') = 'object') AS has_payment_order,
             bool_or(coalesce(fi.raw_json -> 'sdtls' -> 'sancordervo' ->> 'ordertype', '') ~* 'reject') AS has_rejection
        FROM public.gst_case_folder_items fi
       WHERE fi.deleted_at IS NULL
         AND (p_client_id IS NULL OR fi.client_id = p_client_id)
       GROUP BY fi.client_id, fi.case_id
    )
    SELECT c.id, c.client_id,
           CASE
             WHEN s.has_closure THEN 'auto:closure'
             -- A refund closes on its payment order (RFD-05) only, never on a
             -- sanction/rejection order alone: a rejection starts an appeal clock.
             WHEN c.ntype ~* 'refund' AND s.has_payment_order AND NOT coalesce(s.has_rejection, false) THEN 'auto:refund_paid'
             WHEN c.ntype ~* '(letter of undertaking|\mlut\M)' AND s.has_order THEN 'auto:lut_approval'
             -- A DRC-03 voluntary-payment case closes once that payment is acknowledged.
             WHEN c.ntype ~* 'voluntary payment' AND EXISTS (
                    SELECT 1 FROM public.gst_drc03_filings d
                     WHERE d.client_id = c.client_id AND d.deleted_at IS NULL
                       AND (d.arn = c.case_id OR d.arn = c.reference_number)
                       AND coalesce(d.status, '') ~* 'acknowledg') THEN 'auto:drc03_acknowledged'
           END AS reason
      FROM cand c
      LEFT JOIN secs s ON s.client_id = c.client_id AND s.case_id = c.case_id
  LOOP
    CONTINUE WHEN r.reason IS NULL;
    UPDATE public.gst_notices
       SET staff_status = 'Closed', close_reason = r.reason
     WHERE id = r.id AND staff_status IS NULL;
    IF FOUND THEN
      v_closed := v_closed + 1;
      INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, new_value, actor_name)
      VALUES (r.id, r.client_id, 'closed',
              jsonb_build_object('staff_status', NULL),
              jsonb_build_object('staff_status', 'Closed', 'close_reason', r.reason),
              'Closing sweep');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('closed', v_closed, 'due_dates_set', v_due, 'client_id', p_client_id, 'ran_at', now());
END;
$$;

COMMENT ON FUNCTION public.notices_sweep(uuid) IS
  'Closing sweep for the notices module: fills case due dates from the case folder and auto-closes untriaged rows by rule (closure folder, paid refund, approved LUT, acknowledged DRC-03). NULL = every client.';

-- Nightly at 03:00 IST for every client (the extension also calls it per client after each sync).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notices-sweep-nightly') THEN
    PERFORM cron.unschedule('notices-sweep-nightly');
  END IF;
  PERFORM cron.schedule('notices-sweep-nightly', '30 21 * * *', 'select public.notices_sweep(null)');
END;
$$;
