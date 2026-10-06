-- Notices Phase 4 · Reply Factory I, part 1: reading a notice
-- (roadmap Phase 4 "Document intelligence"; audit R-08, R-28, S stage 6).
-- Read docs/REPLY_FACTORY_POSITIONS.md before changing anything here.
--
-- A notice gets typed facts (section, period, DIN, demand by head) and a
-- record of where each came from. The first reader is deterministic and always
-- on: the portal's own case-folder JSON (sdtls.dtscn / drprcdt / dtorder …,
-- including dmddtls, the demand per period and head) is read into the notice
-- the moment the folder item is saved. The second reader, the notice PDF read
-- by the office agent with the Claude API, ships switched off and lands in
-- 20261008110000. Both write notice_extractions and only ever fill empty
-- fields: a value a person typed is never replaced (conflicts are recorded).
--
-- Also here: issue codes (reply_issue_types, the firm's taxonomy with the
-- evidence recipe, the client documents and the proposed reply rule per
-- issue), richer notice_issues (code, period, demand by head, page and quote,
-- verified), form rules for the portal events that had none (refund orders,
-- appeal hearing notices, acknowledgements), and notice_due_coverage() — the
-- date each open notice runs on, with its source.

-- ── 1. Form rules for portal events that had none ──────────────────────────
-- Match orders 100+ run after every existing rule, so these only catch notices
-- nothing else classified. Orders keep their appeal clock (appeal_section);
-- acknowledgements close themselves through the closing sweep.
INSERT INTO public.notice_form_rules
  (form_code, match_order, pattern, label, category, default_priority, reply_days, reply_day_kind, clock_basis, appeal_section, auto_close_reason)
VALUES
  ('PMT-03', 100, 're-?credit of the amount to cash or credit ledger',
   'Re-credit to the ledger after a refund rejection (PMT-03)', 'Refund', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order'),
  ('RFD-06', 101, 'refund sanction ?/ ?rejection order|refund sanction order|refund rejection order|rfd[- ]?0?6\M',
   'Refund sanction or rejection order (RFD-06)', 'Refund', 'Medium', NULL, 'calendar', NULL, 's107', NULL),
  ('RFD-04', 102, 'provisional refund order|rfd[- ]?0?4\M',
   'Provisional refund order (RFD-04)', 'Refund', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order'),
  ('APL-HEARING', 103, '\mappeal\M.*hearing notice|hearing notice issued',
   'Hearing notice in an appeal', 'Appeal', 'High', NULL, 'calendar', NULL, NULL, NULL),
  ('APL-02', 104, 'appeal admitted|apl[- ]?0?2\M',
   'Appeal admitted (APL-02)', 'Appeal', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order'),
  ('DRC-07A', 105, 'drc[- ]?0?7 ?a\M',
   'Pre-GST demand for recovery (DRC-07A)', 'Recovery', 'High', NULL, 'calendar', NULL, 's107', NULL),
  ('RECT-ORDER', 106, 'rectification of orders.*(order rectified|application rejected)',
   'Order on a rectification application', 'Order', 'Medium', NULL, 'calendar', NULL, 's107', NULL),
  ('ADT-CLOSURE', 107, '\maudit\M.*closure report|closure report',
   'Audit closure report', 'Audit', 'Low', NULL, 'calendar', NULL, NULL, 'informational_order'),
  ('SUMMONS', 108, 'notice to summon|\msummons?\M',
   'Summons to appear (s.70)', 'Enforcement', 'High', NULL, 'calendar', NULL, NULL, NULL),
  ('REG-CANCEL-REJ', 109, 'cancellation rejection order|rejection of (the )?application for cancellation',
   'Order rejecting an application for cancellation', 'Registration', 'Medium', NULL, 'calendar', NULL, 's107', NULL)
ON CONFLICT (form_code) DO NOTHING;

-- An audit discrepancy notice "under rule 101(4)" is ADT-02; widen only the seeded text.
UPDATE public.notice_form_rules
   SET pattern = pattern || '|discrepanc(y|ies) under rule 101'
 WHERE form_code = 'ADT-02' AND pattern NOT LIKE '%rule 101%';

-- ── 2. Typed facts on the notice, and where each came from ─────────────────
ALTER TABLE public.gst_notices
  ADD COLUMN IF NOT EXISTS section_of_law text,
  ADD COLUMN IF NOT EXISTS period_from    date,
  ADD COLUMN IF NOT EXISTS period_to      date,
  ADD COLUMN IF NOT EXISTS din            text,
  ADD COLUMN IF NOT EXISTS demand         jsonb,
  ADD COLUMN IF NOT EXISTS demand_total   numeric,
  ADD COLUMN IF NOT EXISTS read_fields    jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.gst_notices.section_of_law IS 'Section the notice is issued under, e.g. 73, 74, 61 (read from the portal or the notice; staff may type it).';
COMMENT ON COLUMN public.gst_notices.period_from IS 'First month of the tax period the notice covers (first day of the month).';
COMMENT ON COLUMN public.gst_notices.period_to IS 'Last month of the tax period the notice covers (last day of the month).';
COMMENT ON COLUMN public.gst_notices.din IS 'Document identification number printed on the notice.';
COMMENT ON COLUMN public.gst_notices.demand IS
  'Demand by head and component: {"igst"|"cgst"|"sgst"|"cess": {"tax","interest","penalty","fee","others"}} (rupees).';
COMMENT ON COLUMN public.gst_notices.demand_total IS 'Total of demand (all heads and components).';
COMMENT ON COLUMN public.gst_notices.read_fields IS
  'Fields filled by a reader: {"<column>": {"source": "portal"|"ai"|"form", "extraction_id", "value", "at", "verified", "verified_by", "verified_at", "result"}}. A value staff changed no longer equals "value"; readers only fill empty columns.';

-- ── 3. Issue codes: the firm's taxonomy ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reply_issue_types (
  code            text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]+$'),
  title           text NOT NULL,
  family          text NOT NULL CHECK (family IN ('liability', 'itc', 'interest_fee', 'return', 'registration', 'refund', 'procedure', 'other')),
  description     text,
  recipe_key      text,
  documents       text[] NOT NULL DEFAULT '{}',
  forms           text[] NOT NULL DEFAULT '{}',
  firm_position   text,
  position_status text NOT NULL DEFAULT 'proposed' CHECK (position_status IN ('proposed', 'approved', 'changes_requested')),
  approved_by_name text,
  approved_at     timestamptz,
  sort            int  NOT NULL DEFAULT 100,
  is_active       boolean NOT NULL DEFAULT true,
  updated_by_name text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.reply_issue_types IS
  'Issue codes (roadmap Phase 4): the evidence recipe that answers each, the documents the client must supply, and the firm''s reply rule. Positions are proposed by engineering until a partner approves them (docs/REPLY_FACTORY_POSITIONS.md).';
ALTER TABLE public.reply_issue_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reply_issue_types_all ON public.reply_issue_types;
CREATE POLICY reply_issue_types_all ON public.reply_issue_types FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reply_issue_types TO anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_reply_issue_types_updated_at ON public.reply_issue_types;
CREATE TRIGGER trg_reply_issue_types_updated_at BEFORE UPDATE ON public.reply_issue_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.reply_issue_types (code, title, family, description, recipe_key, documents, forms, firm_position, sort) VALUES
  ('LIAB_GSTR1_V_3B', 'Output tax: GSTR-1 higher than GSTR-3B', 'liability',
   'Tax on outward supplies reported in GSTR-1 (and IFF) exceeds the tax paid through GSTR-3B for the same months.',
   'gstr1_vs_3b',
   ARRAY['Sales register for the period', 'Credit and debit note register', 'Details of amendments made in later GSTR-1s', 'DRC-03 challans for any tax already paid'],
   ARRAY['DRC-01B', 'ASMT-10', 'DRC-01A', 'DRC-01'],
   'Compare month by month and cumulatively over the financial year. A difference that reverses in a later month''s GSTR-3B is a timing difference: the tax was paid with the later return, and interest u/s 50(1) is due only on the cash portion for the days of delay. Amendments and credit notes in later GSTR-1s and advances adjusted (Table 11) reconcile further items. Any residual short payment is admitted and paid through DRC-03 with interest.',
   10),
  ('ITC_2B_V_3B', 'ITC claimed in GSTR-3B exceeds GSTR-2B', 'itc',
   'Input tax credit availed in GSTR-3B exceeds the credit shown in GSTR-2B (s.16(2)(aa), from 1 January 2022).',
   'gstr3b_vs_2b',
   ARRAY['Purchase register for the period', 'Supplier invoices for the differences', 'Proof of payment to suppliers', 'Workings of ITC reversed and reclaimed (Table 4D(1))'],
   ARRAY['DRC-01C', 'ASMT-10', 'DRC-01A', 'DRC-01'],
   'Reconcile month by month and by head: invoices that appear in a later month''s GSTR-2B (timing), reclaims of credit reversed earlier (4D(1)), and credit outside the GSTR-2B comparison (imports, ISD, reverse charge). The residual excess is reversed or paid through DRC-03; interest u/s 50(3) only on credit wrongly availed and utilised.',
   20),
  ('ITC_2A_V_3B', 'ITC claimed exceeds GSTR-2A (periods before 2022)', 'itc',
   'Credit availed for periods before January 2022 is higher than the suppliers'' GSTR-1 reported in GSTR-2A.',
   'gstr3b_vs_2a',
   ARRAY['Purchase register for the period', 'Supplier invoices for the differences', 'Proof of payment to suppliers', 'Supplier or CA certificates for the differences (Circulars 183/2022 and 193/2023)'],
   ARRAY['ASMT-10', 'DRC-01A', 'DRC-01'],
   'Before 1 January 2022 credit was not conditional on the invoice appearing in GSTR-2A (rule 36(4) limits apart). Differences are explained supplier by supplier; for FY 2017-18 to 2021 the procedure in Circulars 183/2022 and 193/2023 (supplier or CA certificate) applies — verify the circular for the period.',
   30),
  ('RCM_LIAB', 'Reverse charge: liability or credit mismatch', 'liability',
   'Reverse-charge liability (3.1(d)) not paid, or reverse-charge credit higher than the tax paid on it.',
   'rcm',
   ARRAY['Reverse-charge register', 'Self-invoices and payment vouchers', 'Challans for reverse-charge tax paid in cash'],
   ARRAY['ASMT-10', 'DRC-01A', 'DRC-01'],
   'Reverse-charge tax is paid in cash (3.1(d)) and the same amount is taken as credit (4A(2)/(3)). Self-invoices never appear in GSTR-2B by design; show month by month that credit did not exceed the tax paid.',
   40),
  ('INTEREST_50', 'Interest on delayed payment (s.50)', 'interest_fee',
   'Interest demanded for tax paid late or credit wrongly utilised.',
   'interest',
   ARRAY['Electronic cash ledger for the period'],
   ARRAY['DRC-01', 'DRC-01A', 'ASMT-10', 'DRC-07'],
   'Interest u/s 50(1) on tax paid late is due only on the portion paid in cash (proviso to s.50(1), rule 88B(1)), at 18% for the days of delay. Interest on credit wrongly availed is due only where it was utilised (s.50(3), rule 88B(3)). Recompute and reconcile with the officer''s figure.',
   50),
  ('LATE_FEE_47', 'Late fee for delayed returns (s.47)', 'interest_fee',
   'Late fee for returns filed after the due date.',
   'late_fee',
   ARRAY[]::text[],
   ARRAY['DRC-01', 'DRC-01A', 'ASMT-10'],
   'Late fee per day of delay as notified for the return and period, capped by the turnover slab and the nil-return cap in force for that period; amnesty notifications where they apply.',
   60),
  ('ITC_16_4', 'ITC beyond the s.16(4) time limit', 'itc',
   'Credit taken after the last date for the invoice''s financial year.',
   'itc_16_4',
   ARRAY['Purchase invoices with dates', 'GSTR-3B filing acknowledgements for the months in which the credit was taken'],
   ARRAY['ASMT-10', 'DRC-01A', 'DRC-01'],
   'The last date is the earlier of 30 November after the end of the financial year and the date the annual return is filed (Finance Act 2022). Credit for FY 2017-18 to 2020-21 taken in returns filed up to 30 November 2021 is protected by s.16(5); s.16(6) covers registrations restored on revocation. Credit is taken when the GSTR-3B is filed.',
   70),
  ('ITC_17_5', 'Blocked credit u/s 17(5)', 'itc',
   'Credit on items the law blocks (motor vehicles, food and beverages, works contracts for immovable property, personal use and others).',
   'itc_17_5',
   ARRAY['Expense ledgers with the GST paid', 'Registration and usage records of vehicles', 'Contracts for works on immovable property'],
   ARRAY['ASMT-10', 'DRC-01A', 'DRC-01'],
   'Map each expense to the clause the officer cites and to its exception (for example vehicles used to transport goods or for further supply; works contracts for plant and machinery). Reverse only what falls inside a clause and outside its exceptions.',
   80),
  ('ITC_CANCELLED_SUPPLIER', 'ITC from suppliers whose registration was cancelled', 'itc',
   'Credit on invoices from suppliers whose registration was later cancelled, often with retrospective effect.',
   'cancelled_suppliers',
   ARRAY['Tax invoices from these suppliers', 'E-way bills and goods receipt notes', 'Bank statements showing payment (UTRs)', 'Supplier registration status on the invoice dates'],
   ARRAY['DRC-01', 'DRC-01A', 'ASMT-10'],
   'Credit is allowable where the supplier was registered on the invoice date and the s.16(2) conditions (invoice, receipt of goods or services, payment, tax charged) are proved; a cancellation with retrospective effect does not by itself deny a bona fide recipient''s credit — verify the current decisions before relying on this.',
   90),
  ('ITC_NONFILER', 'ITC from suppliers who did not file or pay', 'itc',
   'Credit on invoices of suppliers who did not file their returns or pay the tax.',
   'gstr3b_vs_2a',
   ARRAY['Supplier invoices', 'Proof of payment to suppliers', 'Supplier confirmations or CA certificates'],
   ARRAY['DRC-01', 'DRC-01A', 'ASMT-10'],
   'Show the s.16(2) conditions met by the recipient; for periods covered by Circulars 183/2022 and 193/2023 use the certificates they prescribe — verify the circular for the period.',
   100),
  ('ITC_RULE_42_43', 'Reversal for exempt or non-business use (rules 42/43)', 'itc',
   'Common credit not reversed for exempt supplies or non-business use.',
   'rule_42',
   ARRAY['Turnover split between taxable and exempt supplies', 'Workings of common credit', 'Capital goods register'],
   ARRAY['ASMT-10', 'DRC-01A', 'DRC-01'],
   'Recompute D1 and D2 under rule 42 (and rule 43 for capital goods) on the actual turnover split, including the annual true-up; reverse any shortfall with interest.',
   110),
  ('TURNOVER_MISMATCH', 'Turnover differs from the income-tax return or books', 'liability',
   'Turnover in GST returns is lower than in the ITR, 26AS or financial statements.',
   NULL,
   ARRAY['Income-tax return and 26AS for the year', 'Audited financial statements', 'Reconciliation of turnover between books and GST returns'],
   ARRAY['ASMT-10', 'DRC-01A', 'DRC-01'],
   'Reconcile item by item: non-GST and exempt receipts, other income, closing adjustments and timing of invoicing; tax is due only on the unexplained taxable supplies.',
   120),
  ('GSTR9_V_3B', 'Annual return differs from GSTR-3B', 'return',
   'Figures in GSTR-9 / 9C differ from the GSTR-3B returns of the year.',
   'gstr9_vs_3b',
   ARRAY['GSTR-9 and GSTR-9C as filed'],
   ARRAY['ASMT-10', 'DRC-01A'],
   'Reconcile with the firm''s GSTR-9 working (Annual Return module): differences paid with the annual return through DRC-03 or adjusted in later GSTR-3Bs are shown with their ARNs.',
   130),
  ('EWB_V_GSTR1', 'E-way bills not matching GSTR-1', 'liability',
   'Supplies covered by e-way bills do not appear in GSTR-1.',
   NULL,
   ARRAY['E-way bill register for the period', 'Cancelled e-way bills', 'Delivery challans for non-supply movements'],
   ARRAY['ASMT-10', 'DRC-01A'],
   'Separate movements that are not supplies (job work, returns, stock transfers within the same registration) and cancelled e-way bills; reconcile the remainder to invoices reported in GSTR-1.',
   140),
  ('RETURN_NOT_FILED', 'Return not filed', 'return',
   'A return was not filed by its due date (GSTR-3A and similar).',
   'filing_status',
   ARRAY[]::text[],
   ARRAY['GSTR-3A'],
   'File the return with late fee and interest; the notice closes itself once Filing Status shows the return filed (NOTICES_LITIGATION_POSITIONS §18).',
   150),
  ('REGISTRATION_QUERY', 'Registration query or cancellation', 'registration',
   'Clarification on a registration application or a notice proposing cancellation.',
   NULL,
   ARRAY['Proof of the principal place of business', 'Rent agreement or ownership proof', 'Electricity bill or similar utility bill', 'Identity and address proof of the authorised signatory'],
   ARRAY['REG-03', 'REG-17', 'REG-SCN', 'REG-23'],
   'Answer each point raised with the document that proves it; for a proposed cancellation, show the business is operating and returns are filed (or file them).',
   160),
  ('REFUND_DEFICIENCY', 'Refund deficiency or show cause notice', 'refund',
   'A deficiency memo or a notice proposing to reject a refund claim.',
   NULL,
   ARRAY['Shipping bills or export invoices', 'Bank realisation certificates or FIRCs', 'Statements 3 / 3A / 5B as applicable', 'Undertakings and declarations prescribed for the refund type'],
   ARRAY['RFD-03', 'RFD-08'],
   'Answer each ground with the prescribed statement and evidence; recompute the refund under rule 89 where the formula is disputed.',
   170),
  ('PROCEDURE_OBJECTION', 'Procedural objection', 'procedure',
   'Limitation, missing DIN, jurisdiction, demand under both CGST and IGST, natural justice, ingredients of s.74.',
   NULL,
   ARRAY[]::text[],
   ARRAY['DRC-01', 'DRC-07'],
   'Check limitation (s.73(10) / s.74(10)), the DIN (CBIC Circular 122/41/2019 and the State equivalent), jurisdiction, a personal hearing where adverse action is proposed (s.75(4)), and for s.74 the specific allegation of fraud or suppression; raise each that applies before the merits.',
   180),
  ('OTHER', 'Other issue', 'other', 'An issue that fits no code above.', NULL, ARRAY[]::text[], ARRAY[]::text[], NULL, 999)
ON CONFLICT (code) DO NOTHING;

-- ── 4. Richer issues ───────────────────────────────────────────────────────
ALTER TABLE public.notice_issues
  ADD COLUMN IF NOT EXISTS issue_code      text,
  ADD COLUMN IF NOT EXISTS period_from     date,
  ADD COLUMN IF NOT EXISTS period_to       date,
  ADD COLUMN IF NOT EXISTS demand          jsonb,
  ADD COLUMN IF NOT EXISTS page            int,
  ADD COLUMN IF NOT EXISTS quote           text,
  ADD COLUMN IF NOT EXISTS verified        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS verified_by_name text,
  ADD COLUMN IF NOT EXISTS verified_at     timestamptz,
  ADD COLUMN IF NOT EXISTS extraction_id   uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notice_issues_issue_code_fkey') THEN
    ALTER TABLE public.notice_issues ADD CONSTRAINT notice_issues_issue_code_fkey
      FOREIGN KEY (issue_code) REFERENCES public.reply_issue_types(code) ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE public.notice_issues DROP CONSTRAINT IF EXISTS notice_issues_source_check;
ALTER TABLE public.notice_issues ADD CONSTRAINT notice_issues_source_check
  CHECK (source IN ('manual', 'extracted', 'portal', 'form'));
COMMENT ON COLUMN public.notice_issues.source IS
  'manual (typed by staff), portal (the demand in the portal''s case folder), form (implied by the form, e.g. DRC-01B), extracted (read from the notice PDF — verify).';
COMMENT ON COLUMN public.notice_issues.verified IS 'false until a person confirms an issue a reader created from the notice PDF.';
CREATE INDEX IF NOT EXISTS idx_notice_issues_code ON public.notice_issues (issue_code) WHERE issue_code IS NOT NULL;

-- ── 5. Readings: one row per read of a notice ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_extractions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id        uuid NOT NULL REFERENCES public.gst_notices(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL,
  source           text NOT NULL CHECK (source IN ('portal', 'ai')),
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled', 'superseded')),
  outcome          text CHECK (outcome IN ('applied', 'needs_review', 'conflict', 'gstin_mismatch', 'nothing_new', 'rejected')),
  priority         int  NOT NULL DEFAULT 50,
  attempts         int  NOT NULL DEFAULT 0,
  not_before       timestamptz,
  agent_id         text,
  claimed_at       timestamptz,
  finished_at      timestamptz,
  requested_by     uuid,
  requested_by_name text,
  document_url     text,
  document_label   text,
  document_sha256  text,
  pages            int,
  text_layer       boolean,
  model            text,
  usage            jsonb,
  fields           jsonb,
  issues           jsonb,
  checks           jsonb,
  detail           jsonb,
  error            text,
  reason_class     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.notice_extractions IS
  'Each reading of a notice: source portal (the case-folder JSON, deterministic) or ai (the PDF read by the office agent with the Claude API, queued here). fields: {"<field>": {"value", "page", "quote", "quote_ok", "conflict"}}; issues: the issues read; checks: quote, sum, GSTIN and date checks.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_extractions_portal ON public.notice_extractions (notice_id) WHERE source = 'portal';
CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_extractions_ai_active ON public.notice_extractions (notice_id)
  WHERE source = 'ai' AND status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_notice_extractions_queue ON public.notice_extractions (status, priority DESC, created_at)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_notice_extractions_notice ON public.notice_extractions (notice_id, created_at DESC);
ALTER TABLE public.notice_extractions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notice_extractions_all ON public.notice_extractions;
CREATE POLICY notice_extractions_all ON public.notice_extractions FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_extractions TO anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_notice_extractions_updated_at ON public.notice_extractions;
CREATE TRIGGER trg_notice_extractions_updated_at BEFORE UPDATE ON public.notice_extractions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 6. Small readers ───────────────────────────────────────────────────────
-- "2019-2020" / "2019-20" / "FY 2019-20" → "2019-20".
CREATE OR REPLACE FUNCTION public.reply_norm_fy(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN m IS NULL THEN NULL
              ELSE m[1] || '-' || right(m[2], 2) END
    FROM (SELECT regexp_match(coalesce(p, ''), '(20\d{2})\s*[-/–]\s*((?:20)?\d{2})') AS m) x
$$;

-- "73", "SECTION 61 OF SGST", "61 OF THE CGST ACT, 2017", "Section 74(1)" → "73" / "61" / "74(1)".
CREATE OR REPLACE FUNCTION public.reply_norm_section(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (regexp_match(coalesce(p, ''), '(\d{1,3}[A-Z]?(?:\s*\(\s*\d+[A-Za-z]?\s*\))?)'))[1]
$$;

-- Month "04" / "4" / "APR" / "April" and year → the first day of that month.
CREATE OR REPLACE FUNCTION public.reply_month_start(p_month text, p_year text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  m int; y int; t text := upper(left(btrim(coalesce(p_month, '')), 3));
BEGIN
  y := nullif(regexp_replace(coalesce(p_year, ''), '\D', '', 'g'), '')::int;
  IF y IS NULL OR y < 2000 OR y > 2100 THEN RETURN NULL; END IF;
  IF t ~ '^\d+$' THEN m := t::int;
  ELSE m := array_position(ARRAY['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'], t);
  END IF;
  IF m IS NULL OR m < 1 OR m > 12 THEN RETURN NULL; END IF;
  RETURN make_date(y, m, 1);
END $$;

-- A portal amount ("123456", "1,23,456.00", 123456, "") → numeric, or 0.
CREATE OR REPLACE FUNCTION public.reply_amount(j jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(j)
           WHEN 'number' THEN (j #>> '{}')::numeric
           WHEN 'string' THEN coalesce(nullif(regexp_replace(j #>> '{}', '[^0-9.\-]', '', 'g'), '')::numeric, 0)
           ELSE 0 END
$$;

-- Demand rows (dmddtls and its variants) summed by head and component.
CREATE OR REPLACE FUNCTION public.reply_demand_from_rows(p_rows jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  WITH r AS (
    SELECT lower(coalesce(nullif(e ->> 'dact', ''), nullif(e ->> 'acttyp', ''), nullif(e ->> 'act', ''), '')) AS act,
           public.reply_amount(coalesce(e -> 'dtax', e -> 'tx', e -> 'tax'))          AS tax,
           public.reply_amount(coalesce(e -> 'dist', e -> 'intr', e -> 'ist'))        AS interest,
           public.reply_amount(coalesce(e -> 'dpnlty', e -> 'pnlty'))                 AS penalty,
           public.reply_amount(coalesce(e -> 'dfees', e -> 'fees', e -> 'fee'))       AS fee,
           public.reply_amount(coalesce(e -> 'dothers', e -> 'others', e -> 'fine'))  AS others
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows ELSE '[]'::jsonb END) e
  ), h AS (
    SELECT CASE WHEN act LIKE '%igst%' OR act = 'integrated' THEN 'igst'
                WHEN act LIKE '%cgst%' OR act = 'central' THEN 'cgst'
                WHEN act LIKE '%sgst%' OR act LIKE '%utgst%' OR act = 'state' THEN 'sgst'
                WHEN act LIKE '%cess%' THEN 'cess'
                ELSE 'unspecified' END AS head,
           sum(tax) tax, sum(interest) interest, sum(penalty) penalty, sum(fee) fee, sum(others) others
      FROM r GROUP BY 1
    HAVING sum(abs(tax) + abs(interest) + abs(penalty) + abs(fee) + abs(others)) > 0
  )
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
           jsonb_object_agg(head, jsonb_build_object('tax', tax, 'interest', interest, 'penalty', penalty, 'fee', fee, 'others', others))
         END
    FROM h
$$;

CREATE OR REPLACE FUNCTION public.reply_demand_total(p_demand jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(sum(coalesce((v ->> 'tax')::numeric, 0) + coalesce((v ->> 'interest')::numeric, 0)
                      + coalesce((v ->> 'penalty')::numeric, 0) + coalesce((v ->> 'fee')::numeric, 0)
                      + coalesce((v ->> 'others')::numeric, 0)), 0)
    FROM jsonb_each(CASE WHEN jsonb_typeof(p_demand) = 'object' THEN p_demand ELSE '{}'::jsonb END) x(k, v)
$$;

-- ── 7. Applying a reading to the notice: fill empty fields only ────────────
-- p_fields: {"<column>": value} for the columns below. A column that already
-- holds a value is never replaced; a different value is returned as a conflict.
CREATE OR REPLACE FUNCTION public.notice_apply_reading(
  p_notice_id uuid, p_extraction_id uuid, p_source text, p_fields jsonb, p_verified boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n         public.gst_notices;
  v_applied   text[] := '{}';
  v_conflicts jsonb := '{}'::jsonb;
  v_rf        jsonb;
  k           text;
  v           jsonb;
  cur         text;
  newv        text;
BEGIN
  SELECT * INTO v_n FROM public.gst_notices WHERE id = p_notice_id FOR UPDATE;
  IF v_n.id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  v_rf := coalesce(v_n.read_fields, '{}'::jsonb);

  FOR k, v IN SELECT * FROM jsonb_each(coalesce(p_fields, '{}'::jsonb)) LOOP
    CONTINUE WHEN v IS NULL OR jsonb_typeof(v) = 'null';
    CONTINUE WHEN k NOT IN ('section_of_law', 'financial_year', 'period_from', 'period_to', 'din', 'demand',
                            'due_date', 'hearing_date', 'hearing_note', 'issued_by', 'amount_of_demand');
    cur := CASE k
      WHEN 'section_of_law' THEN v_n.section_of_law
      WHEN 'financial_year' THEN v_n.financial_year
      WHEN 'period_from' THEN v_n.period_from::text
      WHEN 'period_to' THEN v_n.period_to::text
      WHEN 'din' THEN v_n.din
      WHEN 'demand' THEN v_n.demand::text
      WHEN 'due_date' THEN v_n.due_date::text
      WHEN 'hearing_date' THEN v_n.hearing_date::text
      WHEN 'hearing_note' THEN v_n.hearing_note
      WHEN 'issued_by' THEN v_n.issued_by
      WHEN 'amount_of_demand' THEN nullif(v_n.amount_of_demand, 0)::text
    END;
    newv := CASE WHEN jsonb_typeof(v) = 'string' THEN v #>> '{}' ELSE v::text END;
    IF cur IS NOT NULL THEN
      IF k <> 'demand' AND cur IS DISTINCT FROM newv AND NOT (k = 'amount_of_demand' AND abs(cur::numeric - newv::numeric) <= 1) THEN
        v_conflicts := v_conflicts || jsonb_build_object(k, jsonb_build_object('current', cur, 'read', v));
      END IF;
      CONTINUE;
    END IF;
    v_applied := v_applied || k;
    v_rf := v_rf || jsonb_build_object(k, jsonb_build_object(
      'source', p_source, 'extraction_id', p_extraction_id, 'value', v, 'at', now(),
      'verified', coalesce(p_verified, false)));
  END LOOP;

  IF cardinality(v_applied) > 0 THEN
    UPDATE public.gst_notices g SET
      section_of_law   = CASE WHEN 'section_of_law' = ANY (v_applied) THEN p_fields ->> 'section_of_law' ELSE g.section_of_law END,
      financial_year   = CASE WHEN 'financial_year' = ANY (v_applied) THEN p_fields ->> 'financial_year' ELSE g.financial_year END,
      period_from      = CASE WHEN 'period_from' = ANY (v_applied) THEN (p_fields ->> 'period_from')::date ELSE g.period_from END,
      period_to        = CASE WHEN 'period_to' = ANY (v_applied) THEN (p_fields ->> 'period_to')::date ELSE g.period_to END,
      din              = CASE WHEN 'din' = ANY (v_applied) THEN p_fields ->> 'din' ELSE g.din END,
      demand           = CASE WHEN 'demand' = ANY (v_applied) THEN p_fields -> 'demand' ELSE g.demand END,
      demand_total     = CASE WHEN 'demand' = ANY (v_applied) THEN public.reply_demand_total(p_fields -> 'demand') ELSE g.demand_total END,
      due_date         = CASE WHEN 'due_date' = ANY (v_applied) THEN (p_fields ->> 'due_date')::date ELSE g.due_date END,
      due_date_source  = CASE WHEN 'due_date' = ANY (v_applied) THEN 'read' ELSE g.due_date_source END,
      hearing_date     = CASE WHEN 'hearing_date' = ANY (v_applied) THEN (p_fields ->> 'hearing_date')::date ELSE g.hearing_date END,
      hearing_note     = CASE WHEN 'hearing_note' = ANY (v_applied) THEN p_fields ->> 'hearing_note' ELSE g.hearing_note END,
      issued_by        = CASE WHEN 'issued_by' = ANY (v_applied) THEN p_fields ->> 'issued_by' ELSE g.issued_by END,
      amount_of_demand = CASE WHEN 'amount_of_demand' = ANY (v_applied) THEN (p_fields ->> 'amount_of_demand')::numeric ELSE g.amount_of_demand END,
      read_fields      = v_rf
     WHERE g.id = p_notice_id;
  END IF;
  RETURN jsonb_build_object('applied', to_jsonb(v_applied), 'conflicts', v_conflicts);
END;
$$;
REVOKE ALL ON FUNCTION public.notice_apply_reading(uuid, uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- ── 8. The portal reader ───────────────────────────────────────────────────
-- The notice's own case-folder item (same client, case and reference) holds
-- the officer's section, financial year, tax period, hearing, the facts and
-- grounds, and dmddtls — the demand per period and head.
CREATE OR REPLACE FUNCTION public.notice_portal_detail(j jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(public.notices_item_detail(j),
                  CASE WHEN jsonb_typeof(j -> 'sdtls' -> 'drprcdt') = 'object' THEN j -> 'sdtls' -> 'drprcdt' END,
                  CASE WHEN jsonb_typeof(j -> 'sdtls' -> 'drprcsr') = 'object' THEN j -> 'sdtls' -> 'drprcsr' END,
                  CASE WHEN jsonb_typeof(j -> 'sdtls' -> 'adjrn') = 'object' THEN j -> 'sdtls' -> 'adjrn' END,
                  CASE WHEN jsonb_typeof(j -> 'sdtls') = 'object' THEN j -> 'sdtls' END)
$$;

CREATE OR REPLACE FUNCTION public.notice_read_portal(p_notice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n      record;
  v_raw    jsonb;
  d        jsonb;
  v_rows   jsonb;
  v_fields jsonb := '{}'::jsonb;
  v_demand jsonb;
  v_from   date;
  v_to     date;
  v_hdate  date;
  v_note   text;
  v_detail jsonb;
  v_id     uuid;
  v_res    jsonb;
  v_code   text;
BEGIN
  SELECT g.id, g.client_id, g.case_id, g.reference_number, g.form_code, g.issue_date
    INTO v_n FROM public.gst_notices g WHERE g.id = p_notice_id AND g.deleted_at IS NULL;
  IF v_n.id IS NULL OR v_n.case_id IS NULL OR v_n.reference_number IS NULL THEN RETURN NULL; END IF;

  SELECT fi.raw_json INTO v_raw
    FROM public.gst_case_folder_items fi
   WHERE fi.client_id = v_n.client_id AND fi.case_id = v_n.case_id
     AND fi.reference_number = v_n.reference_number AND fi.deleted_at IS NULL AND fi.raw_json IS NOT NULL
   ORDER BY fi.last_seen_at DESC NULLS LAST
   LIMIT 1;
  IF v_raw IS NULL OR jsonb_typeof(v_raw) <> 'object' THEN RETURN NULL; END IF;
  d := public.notice_portal_detail(v_raw);
  IF d IS NULL THEN RETURN NULL; END IF;

  v_rows := CASE WHEN jsonb_typeof(d -> 'dmddtls') = 'array' THEN d -> 'dmddtls'
                 WHEN jsonb_typeof(d -> 'lbltydtls') = 'array' THEN d -> 'lbltydtls'
                 WHEN jsonb_typeof(v_raw -> 'enfDtls' -> 'ntcscn' -> 'dmdtls') = 'array' THEN v_raw -> 'enfDtls' -> 'ntcscn' -> 'dmdtls' END;
  v_demand := public.reply_demand_from_rows(v_rows);

  -- The tax period: the overall period, else the span of the demand rows.
  v_from := public.reply_month_start(d -> 'tpovl' ->> 'fromm', d -> 'tpovl' ->> 'fromy');
  v_to := (public.reply_month_start(d -> 'tpovl' ->> 'tom', d -> 'tpovl' ->> 'toy') + interval '1 month - 1 day')::date;
  IF v_from IS NULL AND v_rows IS NOT NULL THEN
    SELECT min(public.reply_month_start(e -> 'tp' ->> 'fromm', e -> 'tp' ->> 'fromy')),
           max((public.reply_month_start(e -> 'tp' ->> 'tom', e -> 'tp' ->> 'toy') + interval '1 month - 1 day')::date)
      INTO v_from, v_to
      FROM jsonb_array_elements(v_rows) e;
  END IF;

  v_hdate := public.notices_parse_portal_date(coalesce(d ->> 'phdt', v_raw -> 'sdtls' ->> 'phdt'));
  v_note := nullif(concat_ws(' · ', nullif(coalesce(d ->> 'pht', v_raw -> 'sdtls' ->> 'pht'), ''),
                                 nullif(coalesce(d ->> 'venu', v_raw -> 'sdtls' ->> 'venu'), '')), '');

  v_fields := jsonb_strip_nulls(jsonb_build_object(
    'section_of_law', public.reply_norm_section(d ->> 'sec'),
    'financial_year', public.reply_norm_fy(coalesce(d ->> 'fy', v_raw -> 'sdtls' ->> 'fy')),
    'period_from', v_from,
    'period_to', CASE WHEN v_from IS NOT NULL THEN v_to END,
    'demand', v_demand,
    'amount_of_demand', CASE WHEN v_demand IS NOT NULL AND public.reply_demand_total(v_demand) > 0 THEN public.reply_demand_total(v_demand) END,
    'hearing_date', v_hdate,
    'hearing_note', CASE WHEN v_hdate IS NOT NULL THEN v_note END));

  v_detail := jsonb_strip_nulls(jsonb_build_object(
    'facts', nullif(btrim(d ->> 'facts'), ''),
    'grounds', nullif(btrim(d ->> 'grounds'), ''),
    'reason', nullif(btrim(d ->> 'reason'), ''),
    'subject', nullif(btrim(v_raw -> 'sdtls' ->> 'ntcsubj'), ''),
    'personal_hearing', CASE d ->> 'pershrng' WHEN 'Y' THEN true WHEN 'N' THEN false END,
    'payment_due', public.notices_parse_portal_date(d ->> 'pymtDuedt'),
    'ineligible_itc', CASE WHEN jsonb_typeof(coalesce(d -> 'IneligibleITC', v_raw -> 'sdtls' -> 'IneligibleITC')) = 'array'
                           THEN coalesce(d -> 'IneligibleITC', v_raw -> 'sdtls' -> 'IneligibleITC') END,
    'demand_rows', v_rows));

  INSERT INTO public.notice_extractions AS x (notice_id, client_id, source, status, fields, detail, finished_at, checks)
  VALUES (p_notice_id, v_n.client_id, 'portal', 'done',
          (SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('value', v)), '{}'::jsonb) FROM jsonb_each(v_fields) f(k, v)),
          v_detail, now(),
          jsonb_build_object('demand_rows', coalesce(jsonb_array_length(v_rows), 0)))
  ON CONFLICT (notice_id) WHERE source = 'portal' DO UPDATE
     SET fields = EXCLUDED.fields, detail = EXCLUDED.detail, finished_at = now(), status = 'done', checks = EXCLUDED.checks
  RETURNING x.id INTO v_id;

  -- Portal data is the department's own record: applied as verified.
  v_res := public.notice_apply_reading(p_notice_id, v_id, 'portal', v_fields, true);
  UPDATE public.notice_extractions
     SET outcome = CASE WHEN jsonb_array_length(v_res -> 'applied') > 0 THEN 'applied'
                        WHEN v_res -> 'conflicts' <> '{}'::jsonb THEN 'conflict' ELSE 'nothing_new' END,
         checks = checks || jsonb_build_object('conflicts', v_res -> 'conflicts')
   WHERE id = v_id;

  -- The demand as one issue, when the notice has none yet: one per notice,
  -- coded when the form implies the issue.
  IF v_demand IS NOT NULL AND public.reply_demand_total(v_demand) > 0
     AND NOT EXISTS (SELECT 1 FROM public.notice_issues i WHERE i.notice_id = p_notice_id) THEN
    v_code := (SELECT t.code FROM public.reply_issue_types t
                WHERE t.is_active AND v_n.form_code = ANY (t.forms) AND v_n.form_code IN ('DRC-01B', 'DRC-01C')
                ORDER BY t.sort LIMIT 1);
    INSERT INTO public.notice_issues (notice_id, seq, title, detail, amount, status, source, issue_code,
                                      period_from, period_to, demand, verified, extraction_id, created_by_name)
    VALUES (p_notice_id, 1,
            'Demand in the notice' || coalesce(' u/s ' || (v_fields ->> 'section_of_law'), '')
              || CASE WHEN v_from IS NOT NULL THEN ' · ' || to_char(v_from, 'Mon YYYY') || ' – ' || to_char(v_to, 'Mon YYYY') ELSE '' END,
            left(coalesce(v_detail ->> 'grounds', v_detail ->> 'reason', v_detail ->> 'facts'), 2000),
            public.reply_demand_total(v_demand), 'open', 'portal', v_code,
            v_from, CASE WHEN v_from IS NOT NULL THEN v_to END, v_demand, true, v_id, 'Portal');
  END IF;
  RETURN v_res || jsonb_build_object('extraction_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.notice_read_portal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notice_read_portal(uuid) TO anon, authenticated, service_role;

-- A form that implies its single issue (DRC-01B: GSTR-1 v 3B; DRC-01C: 3B v
-- 2B) gets that issue, without amounts, when the notice has none.
CREATE OR REPLACE FUNCTION public.notice_read_form(p_notice_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form text;
  v_code text;
BEGIN
  SELECT g.form_code INTO v_form FROM public.gst_notices g WHERE g.id = p_notice_id AND g.deleted_at IS NULL;
  IF v_form IS NULL OR v_form NOT IN ('DRC-01B', 'DRC-01C') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.notice_issues i WHERE i.notice_id = p_notice_id) THEN RETURN false; END IF;
  v_code := CASE v_form WHEN 'DRC-01B' THEN 'LIAB_GSTR1_V_3B' ELSE 'ITC_2B_V_3B' END;
  INSERT INTO public.notice_issues (notice_id, seq, title, amount, status, source, issue_code, verified, created_by_name)
  SELECT p_notice_id, 1, t.title, 0, 'open', 'form', t.code, true, 'Form'
    FROM public.reply_issue_types t WHERE t.code = v_code;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.notice_read_form(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notice_read_form(uuid) TO anon, authenticated, service_role;

-- Read when the folder item arrives or changes, and when a notice gets its form.
CREATE OR REPLACE FUNCTION public.gst_case_folder_items_read()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NEW.reference_number IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.raw_json IS NOT DISTINCT FROM OLD.raw_json THEN RETURN NULL; END IF;
  FOR v_id IN
    SELECT g.id FROM public.gst_notices g
     WHERE g.client_id = NEW.client_id AND g.case_id = NEW.case_id
       AND g.reference_number = NEW.reference_number AND g.deleted_at IS NULL
  LOOP
    PERFORM public.notice_read_portal(v_id);
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_case_folder_items_read ON public.gst_case_folder_items;
CREATE TRIGGER trg_gst_case_folder_items_read
  AFTER INSERT OR UPDATE OF raw_json, deleted_at ON public.gst_case_folder_items
  FOR EACH ROW EXECUTE FUNCTION public.gst_case_folder_items_read();

CREATE OR REPLACE FUNCTION public.gst_notices_read_on_form()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' OR NEW.form_code IS DISTINCT FROM OLD.form_code
     OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.reference_number IS DISTINCT FROM OLD.reference_number THEN
    PERFORM public.notice_read_portal(NEW.id);
    PERFORM public.notice_read_form(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_notices_read_on_form ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_read_on_form
  AFTER INSERT OR UPDATE OF form_code, case_id, reference_number ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_read_on_form();

-- ── 9. Verifying what a reader filled ──────────────────────────────────────
-- confirm: the value stays and is marked verified (result: confirmed, or
-- corrected when staff changed it first). clear: an unverified value from a
-- reader is removed (result: rejected).
CREATE OR REPLACE FUNCTION public.notice_read_verify(
  p_notice_id uuid, p_field text, p_action text, p_actor_name text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n   public.gst_notices;
  v_e   jsonb;
  v_cur text;
  v_res text;
BEGIN
  SELECT * INTO v_n FROM public.gst_notices WHERE id = p_notice_id FOR UPDATE;
  IF v_n.id IS NULL THEN RETURN 'gone'; END IF;
  v_e := v_n.read_fields -> p_field;
  IF v_e IS NULL THEN RETURN 'nothing'; END IF;
  v_cur := CASE p_field
    WHEN 'section_of_law' THEN v_n.section_of_law WHEN 'financial_year' THEN v_n.financial_year
    WHEN 'period_from' THEN v_n.period_from::text WHEN 'period_to' THEN v_n.period_to::text
    WHEN 'din' THEN v_n.din WHEN 'demand' THEN v_n.demand::text WHEN 'due_date' THEN v_n.due_date::text
    WHEN 'hearing_date' THEN v_n.hearing_date::text WHEN 'hearing_note' THEN v_n.hearing_note
    WHEN 'issued_by' THEN v_n.issued_by WHEN 'amount_of_demand' THEN v_n.amount_of_demand::text END;
  IF p_action = 'confirm' THEN
    v_res := CASE WHEN v_cur IS NOT DISTINCT FROM (CASE WHEN jsonb_typeof(v_e -> 'value') = 'string' THEN v_e ->> 'value' ELSE (v_e -> 'value')::text END)
                       OR (p_field = 'amount_of_demand' AND abs(coalesce(v_cur::numeric, 0) - coalesce((v_e ->> 'value')::numeric, 0)) <= 1)
                  THEN 'confirmed' ELSE 'corrected' END;
    UPDATE public.gst_notices SET read_fields = jsonb_set(read_fields, ARRAY[p_field],
      v_e || jsonb_build_object('verified', true, 'verified_by', p_actor_name, 'verified_at', now(),
                                'result', coalesce(v_e ->> 'result', v_res)))
     WHERE id = p_notice_id;
    RETURN v_res;
  ELSIF p_action = 'clear' THEN
    IF coalesce((v_e ->> 'verified')::boolean, false) THEN RETURN 'verified'; END IF;
    UPDATE public.gst_notices g SET
      section_of_law = CASE WHEN p_field = 'section_of_law' THEN NULL ELSE g.section_of_law END,
      financial_year = CASE WHEN p_field = 'financial_year' THEN NULL ELSE g.financial_year END,
      period_from = CASE WHEN p_field = 'period_from' THEN NULL ELSE g.period_from END,
      period_to = CASE WHEN p_field = 'period_to' THEN NULL ELSE g.period_to END,
      din = CASE WHEN p_field = 'din' THEN NULL ELSE g.din END,
      demand = CASE WHEN p_field = 'demand' THEN NULL ELSE g.demand END,
      demand_total = CASE WHEN p_field = 'demand' THEN NULL ELSE g.demand_total END,
      due_date = CASE WHEN p_field = 'due_date' AND g.due_date_source = 'read' THEN NULL ELSE g.due_date END,
      due_date_source = CASE WHEN p_field = 'due_date' AND g.due_date_source = 'read' THEN NULL ELSE g.due_date_source END,
      hearing_date = CASE WHEN p_field = 'hearing_date' THEN NULL ELSE g.hearing_date END,
      hearing_note = CASE WHEN p_field = 'hearing_note' THEN NULL ELSE g.hearing_note END,
      issued_by = CASE WHEN p_field = 'issued_by' THEN NULL ELSE g.issued_by END,
      amount_of_demand = CASE WHEN p_field = 'amount_of_demand' THEN NULL ELSE g.amount_of_demand END,
      read_fields = jsonb_set(g.read_fields, ARRAY[p_field],
        v_e || jsonb_build_object('verified', true, 'verified_by', p_actor_name, 'verified_at', now(), 'result', 'rejected', 'cleared', true))
     WHERE g.id = p_notice_id;
    RETURN 'rejected';
  END IF;
  RAISE EXCEPTION 'notice_read_verify: action must be confirm or clear' USING ERRCODE = '22023';
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_read_verify(uuid, text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_issue_verify(p_issue_id uuid, p_actor_name text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.notice_issues
       SET verified = true, verified_by_name = p_actor_name, verified_at = now(), updated_by_name = p_actor_name
     WHERE id = p_issue_id AND NOT verified
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;
GRANT EXECUTE ON FUNCTION public.notice_issue_verify(uuid, text) TO anon, authenticated, service_role;

-- ── 10. The date each open notice runs on, and its source ──────────────────
-- reply: the effective due date (extended → stored → computed; the stored
-- date's own source says portal list, case folder, typed or read from the
-- notice); hearing: a hearing fixed with no reply due; appeal: an order's
-- appeal clock; appeal_lapsed: an order whose appeal window, condonation
-- included, has closed (the date it closed — review and close the notice, or
-- record the appeal); informational: an acknowledgement that closes by itself.
CREATE OR REPLACE FUNCTION public.notice_due_coverage()
RETURNS TABLE (notice_id uuid, form_code text, kind text, due_on date, source text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.id, f.form_code,
         CASE WHEN f.effective_due IS NOT NULL THEN 'reply'
              WHEN f.hearing_date IS NOT NULL THEN 'hearing'
              WHEN ap.deadline_date IS NOT NULL THEN 'appeal'
              WHEN lapsed.outer_limit IS NOT NULL AND lapsed.outer_limit < public.ist_today() THEN 'appeal_lapsed'
              WHEN r.auto_close_reason IS NOT NULL THEN 'informational'
              ELSE 'missing' END,
         coalesce(f.effective_due, f.hearing_date, ap.deadline_date,
                  CASE WHEN lapsed.outer_limit < public.ist_today() THEN lapsed.outer_limit END),
         CASE WHEN f.effective_due IS NOT NULL THEN
                CASE f.due_basis WHEN 'extended' THEN 'extended by staff'
                                 WHEN 'computed' THEN 'computed from the form''s reply period'
                                 ELSE CASE g.due_date_source WHEN 'case_folder' THEN 'portal case folder'
                                                             WHEN 'manual' THEN 'typed by staff'
                                                             WHEN 'read' THEN 'read from the notice (verify)'
                                                             ELSE 'portal notice list' END END
              WHEN f.hearing_date IS NOT NULL THEN 'hearing date'
              WHEN ap.deadline_date IS NOT NULL THEN 'appeal period from the order date'
              WHEN lapsed.outer_limit IS NOT NULL AND lapsed.outer_limit < public.ist_today() THEN 'appeal period over (review and close)'
              WHEN r.auto_close_reason IS NOT NULL THEN 'no reply needed (closes by itself)'
         END
    FROM public.notice_facts f
    JOIN public.gst_notices g ON g.id = f.id
    LEFT JOIN public.notice_form_rules r ON r.form_code = f.form_code
    LEFT JOIN LATERAL (
      SELECT d.deadline_date FROM public.matter_deadlines d
       WHERE d.notice_id = f.id AND d.deadline_type IN ('appeal_s107', 'appeal_s112')
       ORDER BY d.deadline_date LIMIT 1) ap ON true
    LEFT JOIN LATERAL (
      SELECT public.litigation_rule_add(public.litigation_rule_add(coalesce(g.order_date, g.issue_date),
               'appeal_months.' || CASE WHEN r.appeal_section = 's112' THEN 's112' ELSE 's107' END),
               'appeal_condonation.' || CASE WHEN r.appeal_section = 's112' THEN 's112' ELSE 's107' END) AS outer_limit
       WHERE r.appeal_section IS NOT NULL AND coalesce(g.order_date, g.issue_date) IS NOT NULL) lapsed ON true
   WHERE f.is_open
$$;
GRANT EXECUTE ON FUNCTION public.notice_due_coverage() TO anon, authenticated, service_role;

-- ── 11. Read every notice that already has its folder item ─────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT g.id FROM public.gst_notices g
      JOIN public.gst_case_folder_items fi ON fi.client_id = g.client_id AND fi.case_id = g.case_id
                                         AND fi.reference_number = g.reference_number AND fi.deleted_at IS NULL
     WHERE g.deleted_at IS NULL
  LOOP
    PERFORM public.notice_read_portal(r.id);
  END LOOP;
  FOR r IN SELECT g.id FROM public.gst_notices g WHERE g.deleted_at IS NULL AND g.form_code IN ('DRC-01B', 'DRC-01C') LOOP
    PERFORM public.notice_read_form(r.id);
  END LOOP;
END $$;
