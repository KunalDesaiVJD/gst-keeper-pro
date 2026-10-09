-- GSTR-1: push tracking, direct-filing approvals, and e-invoice (IRN) support.
--
-- 1. filing_status.pushed_at — a durable "this return was pushed to the GST
--    portal through GST Keeper" marker. The 'Pushed' status alone is not
--    enough: staff move a row on to other statuses after a push, and the
--    status is overwritten when the row becomes Filed. mark_filing_pushed()
--    (the only route to 'Pushed') now stamps it too.
--
-- 2. gstr1_direct_filing_approvals + a guard trigger. From the Sep-2026
--    return period, a GSTR-1 / GSTR-1 (IFF) that was never pushed through GST
--    Keeper (pushed_at IS NULL) cannot become Filed — whether by the Filing
--    Status dropdown or by the extension's "Pull from portal" — until a
--    superadmin approves a request explaining why it was filed directly on
--    the portal. The request is how the superadmin learns what went wrong.
--
-- 3. E-invoice: clients.einvoice_applicable / einvoice_exemption, the
--    einvoice_docs store of IRNs captured from the portal (never deleted on a
--    re-pull, so an IRN the portal later loses — e.g. after a JSON upload
--    without it — is still attached on the next push), and
--    einvoice_threshold_alerts (one alert per client, FY and level) with its
--    email template.
--
-- RLS is open to public on every new table — this app has no Supabase auth
-- session (auth.uid() is always NULL); login, staff-only routing and the
-- permission keys are the gate. See CLAUDE.md.

-- ---------------------------------------------------------------------------
-- 1. pushed_at
-- ---------------------------------------------------------------------------
ALTER TABLE public.filing_status ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

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
DECLARE
  v_result text;
BEGIN
  PERFORM set_config('app.filing_push', 'on', true);

  -- Record the push even when the row is already Filed (its status stays).
  UPDATE public.filing_status
     SET pushed_at = now()
   WHERE client_id = p_client_id
     AND return_type::text = p_return_type
     AND period_month = p_period_month
     AND status::text = 'Filed';

  INSERT INTO public.filing_status AS fs
    (client_id, return_type, period_month, status, updated_by, updated_at, pushed_at)
  VALUES
    (p_client_id, p_return_type::return_type, p_period_month,
     'Pushed'::filing_status_type, p_actor, now(), now())
  ON CONFLICT (client_id, return_type, period_month) DO UPDATE
     SET status     = 'Pushed'::filing_status_type,
         updated_by = COALESCE(EXCLUDED.updated_by, fs.updated_by),
         updated_at = now(),
         pushed_at  = now()
   WHERE fs.status::text <> 'Filed'
  RETURNING fs.status::text INTO v_result;

  RETURN COALESCE(v_result, 'Filed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_filing_pushed(uuid, text, text, uuid)
  TO anon, authenticated, service_role;

-- Backfill: rows sitting at 'Pushed', and GSTR-1 periods whose stored JSON was
-- uploaded through the extension (accepted or processed-with-errors).
UPDATE public.filing_status
   SET pushed_at = updated_at
 WHERE pushed_at IS NULL AND status::text = 'Pushed';

UPDATE public.filing_status fs
   SET pushed_at = g.last_uploaded_at
  FROM public.gstr1_data g
 WHERE fs.pushed_at IS NULL
   AND fs.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)')
   AND g.client_id = fs.client_id
   AND g.last_upload_status IN ('accepted', 'partial')
   AND g.last_uploaded_at IS NOT NULL
   AND g.period_month ~ '^[A-Za-z]{3}-[0-9]{2}$'
   AND to_char(to_date(g.period_month, 'Mon-YY'), 'MM/YYYY') = fs.period_month;

-- ---------------------------------------------------------------------------
-- 2. Direct-filing approvals + guard
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gstr1_direct_filing_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  return_type    text NOT NULL,            -- 'GSTR-1' | 'GSTR-1 (IFF)'
  period_month   text NOT NULL,            -- MM/YYYY
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
  reason         text NOT NULL,            -- what happened, in the requester's words
  requested_by   uuid,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text
);

CREATE INDEX IF NOT EXISTS gstr1_direct_filing_approvals_key
  ON public.gstr1_direct_filing_approvals (client_id, return_type, period_month);
-- At most one open request per return.
CREATE UNIQUE INDEX IF NOT EXISTS gstr1_direct_filing_approvals_one_pending
  ON public.gstr1_direct_filing_approvals (client_id, return_type, period_month)
  WHERE status = 'pending';

ALTER TABLE public.gstr1_direct_filing_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gstr1_direct_filing_approvals_public ON public.gstr1_direct_filing_approvals;
CREATE POLICY gstr1_direct_filing_approvals_public ON public.gstr1_direct_filing_approvals
  FOR ALL TO public USING (true) WITH CHECK (true);

-- First return period the rule applies to (Sep-2026, filed in Oct 2026).
-- Earlier periods keep their old behaviour.
CREATE OR REPLACE FUNCTION public.gstr1_direct_filing_rule_applies(p_return_type text, p_period text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_return_type IN ('GSTR-1', 'GSTR-1 (IFF)')
     AND p_period ~ '^[0-9]{2}/[0-9]{4}$'
     AND (split_part(p_period, '/', 2)::int * 100 + split_part(p_period, '/', 1)::int) >= 202609;
$$;

CREATE OR REPLACE FUNCTION public.filing_status_guard_direct_filing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pushed timestamptz;
BEGIN
  IF NEW.status::text <> 'Filed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'Filed' THEN RETURN NEW; END IF;
  IF NOT public.gstr1_direct_filing_rule_applies(NEW.return_type::text, NEW.period_month) THEN
    RETURN NEW;
  END IF;

  -- An upsert (INSERT ... ON CONFLICT DO UPDATE, as the extension's pull
  -- does) reaches BEFORE INSERT with only the incoming columns, so read the
  -- stored row's marker as well.
  v_pushed := NEW.pushed_at;
  IF v_pushed IS NULL THEN
    SELECT pushed_at INTO v_pushed
      FROM public.filing_status
     WHERE client_id = NEW.client_id
       AND return_type = NEW.return_type
       AND period_month = NEW.period_month;
  END IF;
  IF v_pushed IS NOT NULL THEN RETURN NEW; END IF;

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

DROP TRIGGER IF EXISTS trg_filing_status_guard_direct_filing ON public.filing_status;
CREATE TRIGGER trg_filing_status_guard_direct_filing
  BEFORE INSERT OR UPDATE ON public.filing_status
  FOR EACH ROW EXECUTE FUNCTION public.filing_status_guard_direct_filing();

-- ---------------------------------------------------------------------------
-- 3. E-invoice
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS einvoice_applicable boolean NOT NULL DEFAULT false,
  -- An exempt category (rule 48(4) / Notification 13/2020-CT as amended):
  -- when set, the client never needs e-invoicing and is left out of the
  -- threshold alerts, whatever its turnover.
  ADD COLUMN IF NOT EXISTS einvoice_exemption text;

CREATE TABLE IF NOT EXISTS public.einvoice_docs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month  text NOT NULL,              -- MM/YYYY (GSTR-1 return period)
  section       text NOT NULL,              -- b2b | cdnr | cdnur | exp | b2cl
  doc_type      text NOT NULL,              -- INV | CRN | DBN
  doc_no        text NOT NULL,
  doc_key       text NOT NULL,              -- normalised doc_no (A-Z0-9 only)
  ctin          text NOT NULL DEFAULT '',   -- buyer GSTIN ('' for exports / unregistered)
  doc_date      text,                       -- dd-mm-yyyy as on the portal
  irn           text NOT NULL,
  irn_date      text,                       -- irngendate as on the portal
  inv_typ       text,
  pos           text,
  doc_value     numeric NOT NULL DEFAULT 0, -- document value incl. tax
  taxable       numeric NOT NULL DEFAULT 0,
  igst          numeric NOT NULL DEFAULT 0,
  cgst          numeric NOT NULL DEFAULT 0,
  sgst          numeric NOT NULL DEFAULT 0,
  cess          numeric NOT NULL DEFAULT 0,
  raw           jsonb,
  source        text NOT NULL DEFAULT 'portal_gstr1',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period_month, section, ctin, doc_key)
);
CREATE INDEX IF NOT EXISTS einvoice_docs_client_period ON public.einvoice_docs (client_id, period_month);

ALTER TABLE public.einvoice_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS einvoice_docs_public ON public.einvoice_docs;
CREATE POLICY einvoice_docs_public ON public.einvoice_docs
  FOR ALL TO public USING (true) WITH CHECK (true);

-- Last e-invoice pull per client + period (outcome shown on the GSTR-1 page).
CREATE TABLE IF NOT EXISTS public.einvoice_pulls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month  text NOT NULL,
  status        text NOT NULL,              -- ok | none | pending | failed
  docs_found    integer NOT NULL DEFAULT 0,
  message       text,
  pulled_by     uuid,
  pulled_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period_month)
);
ALTER TABLE public.einvoice_pulls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS einvoice_pulls_public ON public.einvoice_pulls;
CREATE POLICY einvoice_pulls_public ON public.einvoice_pulls
  FOR ALL TO public USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.einvoice_threshold_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year  text NOT NULL,            -- FY whose turnover triggered it, e.g. "2026-27"
  level           text NOT NULL CHECK (level IN ('approaching', 'crossed')),
  turnover        numeric NOT NULL,
  email_outbox_id uuid,
  notified_at     timestamptz NOT NULL DEFAULT now(),
  dismissed_at    timestamptz,
  UNIQUE (client_id, financial_year, level)
);
ALTER TABLE public.einvoice_threshold_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS einvoice_threshold_alerts_public ON public.einvoice_threshold_alerts;
CREATE POLICY einvoice_threshold_alerts_public ON public.einvoice_threshold_alerts
  FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind = ANY (ARRAY['reminder', 'confirmation', 'builder_setup', 'builder_fsi',
    'builder_cancellation', 'builder_agreement_confirm', 'notice_alert', 'einvoice_threshold']));
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind = ANY (ARRAY['reminder', 'confirmation', 'builder_setup', 'builder_fsi',
    'builder_cancellation', 'builder_agreement_confirm', 'notice_alert', 'einvoice_threshold']));

INSERT INTO public.email_templates (key, name, kind, step, subject, body, is_active, sort_order)
VALUES (
  'einvoice_threshold_alert',
  'E-invoice turnover threshold',
  'einvoice_threshold',
  NULL,
  'E-invoicing: your turnover is {{status_phrase}} — {{client_name}}',
  'Dear {{contact_person}},

Your aggregate turnover for FY {{financial_year}} is ₹{{turnover}}, which is {{status_phrase}} the ₹5 crore limit above which e-invoicing (IRN on every B2B invoice, credit note, debit note and export invoice) becomes mandatory under rule 48(4) of the CGST Rules.

{{action_line}}

Please get in touch if you have any questions.

Regards,
{{staff_name}}
{{firm_name}}
{{firm_email}} · {{firm_phone}}',
  true,
  900
)
ON CONFLICT (key) DO NOTHING;
