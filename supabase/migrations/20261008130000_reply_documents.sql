-- Notices Phase 4 · Reply Factory I, part 4: client document requests from
-- issue codes (roadmap Phase 4 "Client document requests"; audit R-11, R-25).
-- Read docs/REPLY_FACTORY_POSITIONS.md before changing anything here.
--
-- Builds on the Phase 2 requests (notice_doc_requests, E12 via
-- notice_request_documents_send). New: each request can point at the issue it
-- serves; "Ask for what the issues need" adds the documents the issue codes
-- list (reply_issue_types.documents) that are not already asked for, due three
-- days before the reply is due; reminders go by themselves on the E12 rule's
-- own ladder (max_repeats, cooldown_hrs — seeded 3 and 72 h, never enforced
-- before); and the client can see what is asked and upload it in the client
-- portal. Every e-mail still goes through the alert engine: with alerts off
-- (the state today) nothing is sent.

ALTER TABLE public.notice_doc_requests
  ADD COLUMN IF NOT EXISTS issue_id           uuid,
  ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS client_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_note        text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notice_doc_requests_issue_fkey') THEN
    ALTER TABLE public.notice_doc_requests ADD CONSTRAINT notice_doc_requests_issue_fkey
      FOREIGN KEY (issue_id) REFERENCES public.notice_issues(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notice_doc_requests_source_check') THEN
    ALTER TABLE public.notice_doc_requests ADD CONSTRAINT notice_doc_requests_source_check
      CHECK (source IN ('manual', 'catalogue'));
  END IF;
END $$;
COMMENT ON COLUMN public.notice_doc_requests.source IS 'manual (typed or picked by staff) or catalogue (listed by the issue code).';
COMMENT ON COLUMN public.notice_doc_requests.client_uploaded_at IS 'When the client uploaded it in the client portal (the request is then received).';

-- The firm's own deadline for documents: three days before the reply is due,
-- never sooner than two days from today; five days when no reply date is known.
CREATE OR REPLACE FUNCTION public.notice_doc_due_default(p_notice_id uuid)
RETURNS date
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN f.effective_due IS NULL THEN public.ist_today() + 5
              ELSE greatest(f.effective_due - 3, public.ist_today() + 2) END
    FROM (SELECT 1) one LEFT JOIN public.notice_facts f ON f.id = p_notice_id
$$;

-- Add, for every open issue with a code, the documents its code lists that this
-- notice has not asked for yet (same wording, any status). Returns what was added.
CREATE OR REPLACE FUNCTION public.notice_doc_requests_generate(
  p_notice_id uuid, p_actor_id uuid DEFAULT NULL, p_actor_name text DEFAULT NULL, p_due_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due   date;
  v_added jsonb := '[]'::jsonb;
  r       record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.gst_notices g WHERE g.id = p_notice_id AND g.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'gone');
  END IF;
  v_due := coalesce(p_due_date, public.notice_doc_due_default(p_notice_id));
  FOR r IN
    SELECT DISTINCT ON (lower(btrim(d.item))) i.id AS issue_id, btrim(d.item) AS item
      FROM public.notice_issues i
      JOIN public.reply_issue_types t ON t.code = i.issue_code AND t.is_active
      CROSS JOIN LATERAL unnest(t.documents) WITH ORDINALITY d(item, n)
     WHERE i.notice_id = p_notice_id AND i.status IN ('open', 'contest')
       AND btrim(d.item) <> ''
       AND NOT EXISTS (SELECT 1 FROM public.notice_doc_requests q
                        WHERE q.notice_id = p_notice_id AND lower(btrim(q.item)) = lower(btrim(d.item)))
     ORDER BY lower(btrim(d.item)), i.seq, d.n
  LOOP
    INSERT INTO public.notice_doc_requests (notice_id, item, status, due_date, requested_by, requested_by_name, issue_id, source)
    VALUES (p_notice_id, r.item, 'requested', v_due, p_actor_id, p_actor_name, r.issue_id, 'catalogue');
    v_added := v_added || to_jsonb(r.item);
  END LOOP;
  RETURN jsonb_build_object('added', jsonb_array_length(v_added), 'items', v_added, 'due_date', v_due);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_doc_requests_generate(uuid, uuid, text, date) TO anon, authenticated, service_role;

-- Reminders by themselves, on the E12 rule's ladder: a notice with open
-- requests that are due within a day (or asked three or more days ago) is
-- reminded once per cooldown, at most max_repeats times. The e-mail goes
-- through notice_request_documents_send, so alerts off means nothing is sent
-- and nothing is counted.
CREATE OR REPLACE FUNCTION public.notice_doc_reminders_run()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max   int;
  v_cool  int;
  v_sent  int := 0;
  v_tried int := 0;
  v_res   jsonb;
  r       record;
BEGIN
  SELECT coalesce(ar.max_repeats, 3), coalesce(ar.cooldown_hrs, 72)
    INTO v_max, v_cool
    FROM (SELECT 1) one LEFT JOIN public.notice_alert_rules ar ON ar.alert_key = 'E12_client_docs';
  FOR r IN
    SELECT q.notice_id
      FROM public.notice_doc_requests q
      JOIN public.gst_notices g ON g.id = q.notice_id AND g.deleted_at IS NULL
      JOIN public.notice_facts f ON f.id = g.id AND f.is_open
     WHERE q.status = 'requested'
     GROUP BY q.notice_id
    HAVING max(q.reminders_sent) < v_max
       AND (max(q.last_reminded_at) IS NULL OR max(q.last_reminded_at) <= now() - make_interval(hours => v_cool))
       AND (min(q.due_date) <= public.ist_today() + 1 OR min(q.requested_at) <= now() - interval '3 days')
  LOOP
    v_tried := v_tried + 1;
    v_res := public.notice_request_documents_send(r.notice_id, NULL, NULL, true);
    IF coalesce((v_res ->> 'sent')::boolean, false) THEN v_sent := v_sent + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('notices', v_tried, 'sent', v_sent);
END;
$$;
REVOKE ALL ON FUNCTION public.notice_doc_reminders_run() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notice-doc-reminders') THEN
      PERFORM cron.unschedule('notice-doc-reminders');
    END IF;
    -- 10:30 IST every day.
    PERFORM cron.schedule('notice-doc-reminders', '0 5 * * *', $cmd$select public.notice_doc_reminders_run()$cmd$);
  END IF;
END $$;

-- ── The client portal ──────────────────────────────────────────────────────
-- What the firm has asked this client for: open requests, and those received
-- in the last 30 days.
CREATE OR REPLACE FUNCTION public.client_doc_requests(p_client_id uuid)
RETURNS TABLE (request_id uuid, notice_id uuid, item text, status text, due_date date, requested_at timestamptz,
               client_uploaded_at timestamptz, resolved_at timestamptz, notice_label text, reference_number text,
               issue_title text, document_id uuid)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.notice_id, q.item, q.status, q.due_date, q.requested_at, q.client_uploaded_at, q.resolved_at,
         coalesce(r.label, g.notice_type, 'Notice'), coalesce(g.reference_number, g.case_id), i.title, q.document_id
    FROM public.notice_doc_requests q
    JOIN public.gst_notices g ON g.id = q.notice_id AND g.deleted_at IS NULL
    LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code
    LEFT JOIN public.notice_issues i ON i.id = q.issue_id
   WHERE g.client_id = p_client_id
     AND (q.status = 'requested' OR (q.status = 'received' AND q.resolved_at >= now() - interval '30 days'))
   ORDER BY (q.status = 'requested') DESC, q.due_date NULLS LAST, q.requested_at
$$;
GRANT EXECUTE ON FUNCTION public.client_doc_requests(uuid) TO anon, authenticated, service_role;

-- The client uploaded a file for a request (the file itself is already in
-- storage and matter_documents): the request is received and linked to it.
CREATE OR REPLACE FUNCTION public.client_doc_request_upload(
  p_request_id uuid, p_client_id uuid, p_document_id uuid, p_note text DEFAULT NULL, p_client_name text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q record;
BEGIN
  SELECT q.id, q.status, g.client_id INTO v_q
    FROM public.notice_doc_requests q JOIN public.gst_notices g ON g.id = q.notice_id
   WHERE q.id = p_request_id FOR UPDATE OF q;
  IF v_q.id IS NULL OR v_q.client_id IS DISTINCT FROM p_client_id THEN RETURN 'gone'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.matter_documents d
                  JOIN public.notice_doc_requests q ON q.notice_id = d.notice_id
                 WHERE d.id = p_document_id AND q.id = p_request_id) THEN
    RETURN 'no_document';
  END IF;
  UPDATE public.notice_doc_requests
     SET status = 'received', document_id = p_document_id, client_uploaded_at = now(),
         client_note = nullif(btrim(p_note), ''), resolved_at = now(),
         resolved_by_name = coalesce(nullif(btrim(p_client_name), ''), 'Client') || ' (client portal)'
   WHERE id = p_request_id;
  RETURN CASE WHEN v_q.status = 'requested' THEN 'received' ELSE 'replaced' END;
END;
$$;
GRANT EXECUTE ON FUNCTION public.client_doc_request_upload(uuid, uuid, uuid, text, text) TO anon, authenticated, service_role;

-- The request e-mail tells the client where to upload. Changed only where it
-- still holds the Phase 2 wording.
UPDATE public.email_templates SET body = $t$We are handling a {{notice_type}} (ref. {{reference_number}}) for {{client_name}} (GSTIN {{gstin}}). To prepare the reply we need:

{{document_list}}

You can upload them in the GST Keeper client portal (gst.vjdesai.com: sign in with your GSTIN, then Documents requested), or reply to this e-mail with the documents.$t$
 WHERE key = 'notice_client_docs' AND body = $t$We are handling a {{notice_type}} (ref. {{reference_number}}) for {{client_name}} (GSTIN {{gstin}}). To prepare the reply we need:

{{document_list}}

Please reply to this e-mail with the documents at your earliest convenience.$t$;
