-- Booking cancellation + refund tracking.
--
-- Two GST-correction paths, chosen once per cancellation (never both):
--   CREDIT_NOTE — the textbook s.34 route (§11): raise a CANCELLATION credit
--     note immediately, in full, for the consideration already taxed.
--   SETOFF — the firm's elected alternative, built the same way §9's bounce
--     offsets already are: no credit note. Each actual refund PAYMENT — and
--     a single cancellation can be refunded across several payments in
--     several different months — nets against THAT payment's own period's
--     Table 11A pool at the cancelled rate, capped at whatever's available.
--     Unlike a bounce offset, anything that doesn't fit is forfeited
--     permanently rather than carried forward: the portal will not accept a
--     negative Table 11A, and this method's whole basis is "only ever
--     shrink an existing positive pool," not chase a balance across periods.
--
-- builder_receipts.cancelled_via_id stops a cancelled booking's old receipts
-- from being mistaken for a still-open advance once the unit is resold. It
-- does NOT touch builder_period_postings' ADVANCE_11A leg — an already-filed
-- period's Table 11A stays exactly as filed; the correction always lands in
-- whichever period it actually happens, the same rule bounces and
-- re-ratings already follow.

-- ── 1. A cancellation charge is a new taxable supply, at the unit's rate ────
ALTER TABLE public.builder_invoices DROP CONSTRAINT IF EXISTS builder_invoices_invoice_type_check;
ALTER TABLE public.builder_invoices ADD CONSTRAINT builder_invoices_invoice_type_check
  CHECK (invoice_type IN
    ('MILESTONE','BU_DIFFERENTIAL','SUPPLEMENTARY','CONVERSION','DELAY_INTEREST','CANCELLATION_CHARGE'));

-- ── 2. builder_cancellations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_cancellations (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                     uuid NOT NULL REFERENCES public.builder_bookings(id) ON DELETE CASCADE,
  unit_id                        uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  project_id                     uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  cancellation_date              date NOT NULL,
  reason                         text,

  -- The rate the booking's receipts were actually taxed at — a booking
  -- carrying more than one rate (re-rated mid-way) is out of scope for now;
  -- the app blocks that case rather than guessing which rate to reverse.
  rate_code                      text NOT NULL CHECK (rate_code IN
                                   ('AFFORDABLE','OTHER_RESIDENTIAL','COMMERCIAL_RREP','COMMERCIAL_REP')),
  rate_pct                       numeric NOT NULL,
  total_received                 numeric NOT NULL DEFAULT 0 CHECK (total_received >= 0),

  forfeiture_amount              numeric NOT NULL DEFAULT 0 CHECK (forfeiture_amount >= 0),
  cancellation_charge_taxable    numeric NOT NULL DEFAULT 0 CHECK (cancellation_charge_taxable >= 0),
  cancellation_charge_invoice_id uuid REFERENCES public.builder_invoices(id) ON DELETE SET NULL,

  correction_method              text NOT NULL CHECK (correction_method IN ('CREDIT_NOTE','SETOFF')),
  credit_note_id                 uuid REFERENCES public.builder_credit_notes(id) ON DELETE SET NULL,

  refund_payable                 numeric NOT NULL DEFAULT 0,
  refund_paid                    numeric NOT NULL DEFAULT 0,
  status                         text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SETTLED')),

  created_at                     timestamptz NOT NULL DEFAULT now(),
  created_by                     uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_cancellations_unit ON public.builder_cancellations(unit_id);
CREATE INDEX IF NOT EXISTS idx_builder_cancellations_booking ON public.builder_cancellations(booking_id);
CREATE INDEX IF NOT EXISTS idx_builder_cancellations_project ON public.builder_cancellations(project_id);

-- ── 3. builder_refund_payments ──────────────────────────────────────────────
-- One row per actual repayment event, so a cancellation refunded across
-- several months is several independent rows, each its own set-off attempt.
CREATE TABLE IF NOT EXISTS public.builder_refund_payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cancellation_id      uuid NOT NULL REFERENCES public.builder_cancellations(id) ON DELETE CASCADE,
  payment_date         date NOT NULL,
  period_month         text NOT NULL,                       -- 'MM/YYYY', derived from payment_date
  amount               numeric NOT NULL CHECK (amount > 0),  -- actual cash paid back to the member
  instrument_type      text,
  instrument_ref       text,
  notes                text,

  -- Only nonzero when the parent cancellation's correction_method is SETOFF.
  -- Zero for a CREDIT_NOTE cancellation's payments — those are plain cash.
  offset_amount        numeric NOT NULL DEFAULT 0 CHECK (offset_amount >= 0),
  offset_taxable_value numeric NOT NULL DEFAULT 0,
  offset_cgst          numeric NOT NULL DEFAULT 0,
  offset_sgst          numeric NOT NULL DEFAULT 0,
  -- amount - offset_amount: permanently written off, never retried later.
  forfeited_amount     numeric NOT NULL DEFAULT 0 CHECK (forfeited_amount >= 0),

  email_outbox_id      uuid REFERENCES public.email_outbox(id) ON DELETE SET NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_refund_payments_cancellation ON public.builder_refund_payments(cancellation_id);
CREATE INDEX IF NOT EXISTS idx_builder_refund_payments_period ON public.builder_refund_payments(period_month);

-- ── 4. Stop a cancelled booking's receipts being reused as open advances ────
ALTER TABLE public.builder_receipts
  ADD COLUMN IF NOT EXISTS cancelled_via_id uuid REFERENCES public.builder_cancellations(id) ON DELETE SET NULL;

-- ── 5. RLS — open to public, per this app's custom-auth model (see CLAUDE.md:
--        auth.uid() is always NULL at runtime; login/permissions are the gate) ─
ALTER TABLE public.builder_cancellations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS builder_cancellations_all ON public.builder_cancellations;
CREATE POLICY builder_cancellations_all ON public.builder_cancellations FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE public.builder_refund_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS builder_refund_payments_all ON public.builder_refund_payments;
CREATE POLICY builder_refund_payments_all ON public.builder_refund_payments FOR ALL TO public USING (true) WITH CHECK (true);

-- ── 6. builder_period_postings — add the CANCELLATION_OFFSET leg ───────────
-- Same shape and sign convention as BOUNCE_REVERSAL: a negative Table 11A
-- line that only ever nets down an existing positive pool when the return is
-- assembled (buildBuilderGstr1 buckets every Table 11A leg by rate per
-- period before emitting the JSON) — never posted or displayed on its own.
CREATE OR REPLACE VIEW public.builder_period_postings AS
SELECT
  r.id AS source_id, 'ADVANCE_11A'::text AS source_type, 'Table 11A'::text AS gstr1_table,
  p.client_id, p.id AS project_id, u.id AS unit_id, u.unit_no, r.booking_id,
  r.period_month, r.receipt_date AS doc_date, r.rate_code, r.rate_pct,
  r.consideration, r.taxable_value, r.cgst, r.sgst,
  NULL::text AS original_period,
  r.doc_no
FROM public.builder_receipts r
JOIN public.builder_units u ON u.id = r.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE r.receipt_nature = 'ADVANCE' AND r.cheque_status <> 'Bounced'
  AND r.gst_already_discharged = false AND r.subsumed_by_bu_event_id IS NULL

UNION ALL
SELECT
  a.id, 'ADVANCE_11B', 'Table 11B',
  p.client_id, p.id, u.id, u.unit_no, i.booking_id,
  a.period_month, i.invoice_date, a.rate_code, a.rate_pct,
  -a.consideration_adjusted, -a.taxable_value_adjusted, -a.cgst, -a.sgst,
  NULL::text, NULL::text
FROM public.builder_advance_adjustments a
JOIN public.builder_invoices i ON i.id = a.invoice_id
JOIN public.builder_units u ON u.id = i.unit_id
JOIN public.builder_projects p ON p.id = u.project_id

UNION ALL
SELECT
  i.id, 'INVOICE_B2CS', 'Table 7',
  p.client_id, p.id, u.id, u.unit_no, i.booking_id,
  i.period_month, i.invoice_date, i.rate_code, i.rate_pct,
  i.consideration, i.taxable_value, i.cgst, i.sgst,
  NULL::text, i.doc_no
FROM public.builder_invoices i
JOIN public.builder_units u ON u.id = i.unit_id
JOIN public.builder_projects p ON p.id = u.project_id

UNION ALL
SELECT
  c.id, 'CREDIT_NOTE', 'Table 7',
  p.client_id, p.id, u.id, u.unit_no, c.booking_id,
  c.period_month, c.note_date, c.rate_code, c.rate_pct,
  -c.consideration, -c.taxable_value, -c.cgst, -c.sgst,
  NULL::text, c.doc_no
FROM public.builder_credit_notes c
JOIN public.builder_units u ON u.id = c.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE c.within_window = true

UNION ALL
SELECT
  rp.id, 'RECLASS_10_OLD', 'Table 10',
  p.client_id, p.id, u.id, u.unit_no, NULL::uuid,
  rc.posting_period, rc.triggered_on, rc.from_rate_code, rc.from_rate_pct,
  0, -rp.taxable_value, -rp.old_cgst, -rp.old_sgst,
  rp.period_month, NULL::text
FROM public.builder_reclassification_periods rp
JOIN public.builder_reclassifications rc ON rc.id = rp.reclassification_id
JOIN public.builder_units u ON u.id = rc.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE rc.status = 'POSTED'

UNION ALL
SELECT
  rp.id, 'RECLASS_10_NEW', 'Table 10',
  p.client_id, p.id, u.id, u.unit_no, NULL::uuid,
  rc.posting_period, rc.triggered_on, rc.to_rate_code, rc.to_rate_pct,
  0, rp.taxable_value, rp.new_cgst, rp.new_sgst,
  rp.period_month, NULL::text
FROM public.builder_reclassification_periods rp
JOIN public.builder_reclassifications rc ON rc.id = rp.reclassification_id
JOIN public.builder_units u ON u.id = rc.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE rc.status = 'POSTED'

UNION ALL
SELECT
  bo.id, 'BOUNCE_REVERSAL', 'Table 11A',
  p.client_id, p.id, u.id, u.unit_no, NULL::uuid,
  bo.period_month, bo.created_at::date, br.rate_code, br.rate_pct,
  -bo.consideration, -bo.taxable_value, -bo.cgst, -bo.sgst,
  NULL::text, NULL::text
FROM public.builder_bounce_offsets bo
JOIN public.builder_bounce_reversals br ON br.id = bo.reversal_id
JOIN public.builder_units u ON u.id = br.unit_id
JOIN public.builder_projects p ON p.id = br.project_id

UNION ALL
SELECT
  fp.id, 'CANCELLATION_OFFSET', 'Table 11A',
  p.client_id, bc.project_id, bc.unit_id, u.unit_no, NULL::uuid,
  fp.period_month, fp.payment_date, bc.rate_code, bc.rate_pct,
  -fp.offset_amount, -fp.offset_taxable_value, -fp.offset_cgst, -fp.offset_sgst,
  NULL::text, NULL::text
FROM public.builder_refund_payments fp
JOIN public.builder_cancellations bc ON bc.id = fp.cancellation_id
JOIN public.builder_units u ON u.id = bc.unit_id
JOIN public.builder_projects p ON p.id = bc.project_id
WHERE fp.offset_amount > 0;

COMMENT ON VIEW public.builder_period_postings IS
  'Every builder posting that reaches GSTR-1, one row per source document. '
  'original_period is set only on Table 10 amendment legs (omon in the JSON). '
  'doc_no is set only on legs that issue a document of their own — receipt '
  'vouchers, invoices and credit notes — and drives Table 13. '
  'CANCELLATION_OFFSET carries no doc_no: it amends an existing pool, not a '
  'new document, exactly like BOUNCE_REVERSAL.';

-- ── 7. Email — new kind + template for the set-off confirmation ────────────
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind IN ('reminder','confirmation','builder_setup','builder_fsi','builder_cancellation'));
ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('reminder','confirmation','builder_setup','builder_fsi','builder_cancellation'));

INSERT INTO public.email_templates (key, name, kind, step, subject, body, sort_order) VALUES
('builder_cancellation_setoff', 'Builder — cancellation refund set-off confirmation', 'builder_cancellation', NULL,
 $s$Confirming refund treatment on cancellation — unit {{unit_no}}, {{project_name}}$s$,
 $b$Dear {{contact_person}},

Unit {{unit_no}} in {{project_name}} (GSTIN: {{gstin}}) was cancelled on {{cancellation_date}}{{cancellation_reason_clause}}. Per your instruction, the refund due to the member is being set off against fresh bookings collected in {{period}}, rather than adjusted through a formal credit note.

This payment: {{payment_amount}}, dated {{payment_date}}.
Amount set off against {{period}}'s collections: {{offset_amount}}.
{{forfeited_clause}}

We will treat this as confirmed once the GSTR-1 for {{period}} is filed reflecting the reduced Table 11A figure. Please write back if this does not match your records before then.

$b$, 0)
ON CONFLICT (key) DO NOTHING;
