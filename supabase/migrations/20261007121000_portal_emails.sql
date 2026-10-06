-- Notices Phase 3 · Portal Autopilot, part 2: portal e-mails trigger a sync
-- (follows 20261007120000_autopilot_queue.sql).
--
-- The GST portal e-mails the registered contact when it issues a notice. With
-- clients forwarding those e-mails to the firm's notices inbox (or the firm as
-- the registered contact), the office agent reads the inbox, picks the GSTIN,
-- form and reference out of each portal e-mail and calls portal_email_ingest:
-- a matched client gets a high-priority notices job straight away, so a
-- short-clock notice is in the app within hours instead of at the next run.
-- Only the subject, a short snippet and the extracted fields are stored, never
-- the whole e-mail. Routine portal e-mails (an OTP, a filing acknowledgement, a
-- payment receipt: no notice form, no Z… reference, no notice wording) are
-- recorded as 'ignored' and queue nothing, since every sync costs a CAPTCHA.
-- When the notice arrives, the e-mail is linked to it and the capture time is
-- kept, which is how the 4-hour target is measured.

CREATE TABLE IF NOT EXISTS public.portal_emails (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       text NOT NULL UNIQUE,
  received_at      timestamptz NOT NULL,
  from_addr        text,
  subject          text,
  snippet          text,
  gstins           text[] NOT NULL DEFAULT '{}',
  form_code        text,
  reference_number text,
  client_id        uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'unmatched'
                     CHECK (status IN ('queued', 'already_queued', 'autopilot_off', 'unmatched', 'ignored', 'synced')),
  job_id           uuid REFERENCES public.portal_jobs(id) ON DELETE SET NULL,
  notice_id        uuid REFERENCES public.gst_notices(id) ON DELETE SET NULL,
  notice_seen_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_emails_received ON public.portal_emails (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_emails_open ON public.portal_emails (client_id, reference_number) WHERE notice_id IS NULL;
ALTER TABLE public.portal_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_emails_all ON public.portal_emails;
CREATE POLICY portal_emails_all ON public.portal_emails FOR ALL TO public USING (true) WITH CHECK (true);

-- Where the agent last read the inbox (shown on the Autopilot page).
ALTER TABLE public.autopilot_settings
  ADD COLUMN IF NOT EXISTS inbox_last_poll_at  timestamptz,
  ADD COLUMN IF NOT EXISTS inbox_last_error    text,
  ADD COLUMN IF NOT EXISTS inbox_address       text;

-- One e-mail, once (message_id). Returns {status, client_id, job_id, email_id}.
CREATE OR REPLACE FUNCTION public.portal_email_ingest(
  p_message_id text, p_received_at timestamptz, p_from text DEFAULT NULL, p_subject text DEFAULT NULL,
  p_snippet text DEFAULT NULL, p_gstins text[] DEFAULT '{}', p_form_code text DEFAULT NULL,
  p_reference text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.portal_emails;
  v_gstins   text[];
  v_client   uuid;
  v_ref      text := nullif(upper(btrim(coalesce(p_reference, ''))), '');
  v_form     text;
  v_notice_like boolean;
  v_status   text;
  v_job      uuid;
  v_res      jsonb;
  v_set      public.autopilot_settings;
  v_notice   uuid;
  v_seen     timestamptz;
  v_id       uuid;
BEGIN
  IF coalesce(btrim(p_message_id), '') = '' THEN
    RAISE EXCEPTION 'portal_email_ingest: message id required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.portal_emails WHERE message_id = btrim(p_message_id);
  IF FOUND THEN
    RETURN jsonb_build_object('status', v_existing.status, 'client_id', v_existing.client_id,
                              'job_id', v_existing.job_id, 'email_id', v_existing.id, 'duplicate', true);
  END IF;

  SELECT coalesce(array_agg(DISTINCT g), '{}') INTO v_gstins
    FROM (SELECT upper(btrim(x)) AS g FROM unnest(coalesce(p_gstins, '{}')) x) s
   WHERE g ~ '^[0-9]{2}[A-Z0-9]{13}$';

  -- The first GSTIN that is one client's (a GSTIN shared by two client rows matches neither).
  SELECT c.id INTO v_client
    FROM unnest(v_gstins) WITH ORDINALITY AS g(gstin, ord)
    JOIN public.clients c ON upper(btrim(c.gstin)) = g.gstin
   WHERE (SELECT count(*) FROM public.clients c2 WHERE upper(btrim(c2.gstin)) = g.gstin) = 1
   ORDER BY g.ord
   LIMIT 1;

  -- The form from the subject when the agent found none (wording without a code).
  v_form := coalesce(nullif(upper(btrim(coalesce(p_form_code, ''))), ''), public.notice_form_code(NULL, p_subject));
  v_notice_like := EXISTS (SELECT 1 FROM public.notice_form_rules r WHERE r.form_code = v_form AND r.is_active)
                   OR coalesce(v_ref, '') ~ '^Z[A-Z0-9]'
                   OR coalesce(p_subject, '') ~* '(notice|order|intimation|show cause|scrutiny|demand|defaulter|assessment|audit|summons|hearing|deficiency|cancell|suspen|attachment|rectification|appeal)';

  SELECT * INTO v_set FROM public.autopilot_settings WHERE id;
  IF v_client IS NULL THEN
    v_status := 'unmatched';
  ELSIF NOT v_notice_like THEN
    v_status := 'ignored';
  ELSIF NOT (coalesce(v_set.enabled, false) AND coalesce(v_set.email_trigger, false)) THEN
    v_status := 'autopilot_off';
  ELSE
    v_res := public.autopilot_enqueue(ARRAY[v_client], 'PULL_NOTICES_BUNDLE', '{}'::jsonb, 'email', 90, NULL, 'Portal e-mail', 'all');
    v_status := CASE WHEN coalesce((v_res ->> 'queued')::int, 0) > 0 THEN 'queued' ELSE 'already_queued' END;
    SELECT j.id INTO v_job FROM public.portal_jobs j
     WHERE j.client_id = v_client AND j.active_key = 'PULL_NOTICES_BUNDLE'
       AND j.status IN ('queued', 'claimed', 'running', 'needs_human', 'waiting_captcha')
     ORDER BY j.created_at DESC LIMIT 1;
  END IF;

  -- Already in the app (an earlier run caught it first)?
  IF v_client IS NOT NULL AND v_ref IS NOT NULL THEN
    SELECT n.id, coalesce(n.first_seen_at, n.pulled_at) INTO v_notice, v_seen
      FROM public.gst_notices n
     WHERE n.client_id = v_client AND upper(n.reference_number) = v_ref AND n.deleted_at IS NULL
     ORDER BY n.first_seen_at NULLS LAST LIMIT 1;
  END IF;

  INSERT INTO public.portal_emails (message_id, received_at, from_addr, subject, snippet, gstins, form_code,
                                    reference_number, client_id, status, job_id, notice_id, notice_seen_at)
  VALUES (btrim(p_message_id), coalesce(p_received_at, now()), left(p_from, 200), left(p_subject, 500),
          left(p_snippet, 600), v_gstins, v_form, v_ref, v_client,
          v_status, v_job, v_notice, v_seen)
  ON CONFLICT (message_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('status', v_status, 'client_id', v_client, 'job_id', v_job, 'email_id', v_id,
                            'notice_id', v_notice);
END;
$$;
GRANT EXECUTE ON FUNCTION public.portal_email_ingest(text, timestamptz, text, text, text, text[], text, text)
  TO anon, authenticated, service_role;

-- The agent says where it read the inbox and whether that worked.
CREATE OR REPLACE FUNCTION public.portal_inbox_report(p_address text, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.autopilot_settings
     SET inbox_last_poll_at = now(), inbox_last_error = left(nullif(btrim(p_error), ''), 500),
         inbox_address = coalesce(nullif(btrim(p_address), ''), inbox_address)
   WHERE id
$$;
GRANT EXECUTE ON FUNCTION public.portal_inbox_report(text, text) TO anon, authenticated, service_role;

-- When the notice arrives, the e-mail that announced it is linked to it.
CREATE OR REPLACE FUNCTION public.portal_emails_link_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reference_number IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  UPDATE public.portal_emails e
     SET notice_id = NEW.id,
         notice_seen_at = coalesce(NEW.first_seen_at, now()),
         status = CASE WHEN e.status IN ('queued', 'already_queued') THEN 'synced' ELSE e.status END
   WHERE e.client_id = NEW.client_id AND e.notice_id IS NULL
     AND e.reference_number = upper(NEW.reference_number)
     AND e.received_at > now() - interval '30 days';
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS portal_emails_link_notice ON public.gst_notices;
CREATE TRIGGER portal_emails_link_notice
  AFTER INSERT OR UPDATE OF reference_number, deleted_at ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.portal_emails_link_notice();
