-- The platform pieces 20261021130000_gst_change_log.sql expects, as on the
-- live project: Supabase's roles, pgcrypto, staff_level_of, and every table
-- the change log attaches to, with the live columns and primary keys (read
-- from the live catalog on 21 Oct 2026; no constraints beyond the keys, the
-- ledgers' client keys and every ON DELETE CASCADE key of the builder tables,
-- which the cascade tests need). Fictional rows only.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TYPE public.app_role AS ENUM ('superadmin', 'gst_manager', 'employee', 'client');
CREATE TYPE public.registration_type AS ENUM ('Regular', 'Composition', 'Tax Deductor', 'ISD', 'IFF');
CREATE TYPE public.filing_status_type AS ENUM ('Prepared', 'Data Pending', 'Mismatch in Data', 'Not Verified', 'Filed');
CREATE TYPE public.return_type AS ENUM ('GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08', 'GSTR-1A', 'GSTR-9', 'GSTR-9C', 'GSTR-1 (IFF)', 'GSTR-3B (Q)');

CREATE TABLE public.clients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  gstin text,
  name text,
  registration_type public.registration_type,
  registration_date date,
  mobile text,
  email text,
  selected_returns public.return_type[],
  assigned_accountant text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  client_user_id text,
  cancellation_date date,
  gst_user_id text,
  gst_password text,
  client_password text,
  is_first_login boolean,
  regular_sub_type text,
  builder_itc_type text,
  commercial_area numeric,
  residential_area numeric,
  target_date_group1 integer,
  target_date_group2 integer,
  registration_cancellation_date date,
  inactive_at_hand boolean,
  gstr1_import_mode text,
  liberal_2b_reconciliation boolean,
  notices_sync_excluded boolean,
  ai_consent_at date,
  ai_consent_note text,
  ai_opt_out boolean,
  notices_handled boolean,
  portal_login_issue text,
  portal_login_issue_message text,
  portal_login_issue_at timestamp with time zone,
  gst_password_changed_at timestamp with time zone,
  einvoice_applicable boolean,
  einvoice_exemption text,
  ai_learning boolean,
  ai_learning_by_name text,
  ai_learning_at timestamp with time zone,
  notices_tracks_off text[],
  liberal_changed_at timestamp with time zone,
  liberal_changed_by uuid,
  liberal_changed_by_name text
);
CREATE TABLE public.profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  first_name text,
  email text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  password text,
  position_id uuid,
  sessions_ended_at timestamp with time zone
);
CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  role public.app_role,
  is_first_login boolean
);
CREATE TABLE public.annual_return_change_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid,
  financial_year text,
  doc_key text,
  version integer,
  path text[],
  row_label text,
  kind text,
  old_value jsonb,
  new_value jsonb,
  action text,
  changed_by text,
  changed_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.client_liberal_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  liberal boolean,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.advance_adjustments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id uuid,
  client_id uuid,
  project_id uuid,
  invoice_no text,
  invoice_date date,
  period_month text,
  rate_pct numeric,
  consideration_adjusted numeric,
  taxable_value_adjusted numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  cess numeric,
  reason text,
  amends_adjustment_id uuid,
  original_period text,
  amendment_reason text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  ra_bill_id uuid
);
CREATE TABLE public.advance_opening_balances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  as_on_period text,
  pos text,
  rate_pct numeric,
  sply_ty text,
  taxable numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  cess numeric,
  notes text,
  entered_by uuid,
  entered_by_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.advance_receipts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  project_id uuid,
  receipt_no text,
  receipt_date date,
  period_month text,
  party_gstin text,
  party_name text,
  pos text,
  rate_pct numeric,
  sply_ty text,
  gross_amount numeric,
  taxable_value numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  cess numeric,
  supply_nature text,
  status text,
  source text,
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.advance_setoff_overrides (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  return_type text,
  severity text,
  findings jsonb,
  findings_fingerprint text,
  requested_by uuid,
  requested_by_name text,
  requested_at timestamp with time zone,
  request_reason text,
  status text,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamp with time zone,
  decision_note text,
  filed_after_override boolean,
  arn text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.annexure3_other_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  amount numeric,
  notes text,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.annual_return_bs_pl_uploads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  doc_type text,
  file_name text,
  file_url text,
  file_size bigint,
  description text,
  uploaded_by uuid,
  uploaded_at timestamp with time zone
);
CREATE TABLE public.annual_return_carry_forward (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  direction text,
  clause_ref text,
  taxable_value numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  cess numeric,
  notes text,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  user_role text,
  client_id uuid,
  client_name text,
  module text,
  action text,
  financial_year text,
  records_deleted integer,
  details jsonb,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.bills_not_in_2b (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  date date,
  supplier_name text,
  supplier_invoice_number text,
  supplier_gstin text,
  taxable_value numeric(15,2),
  input_igst numeric(15,2),
  input_cgst numeric(15,2),
  input_sgst numeric(15,2),
  reversal_month text,
  reclaim_month text,
  period_month text,
  is_locked boolean,
  is_carried_forward boolean,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  version integer,
  reclaim_subtype text,
  source_book_id uuid,
  reclaimed_via_doc_id uuid
);
CREATE TABLE public.bills_not_in_books (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  date date,
  supplier_name text,
  supplier_invoice_number text,
  supplier_gstin text,
  taxable_value numeric(15,2),
  input_igst numeric(15,2),
  input_cgst numeric(15,2),
  input_sgst numeric(15,2),
  book_entry_month text,
  bill_in_2b_month text,
  period_month text,
  is_locked boolean,
  is_carried_forward boolean,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  version integer,
  source_doc_id uuid
);
CREATE TABLE public.books_purchase_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  ledger_head text,
  rate text,
  taxable_value numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  expense_head text,
  notes text,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.books_register (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  date date,
  supplier_name text,
  supplier_invoice_number text,
  supplier_gstin text,
  taxable_value numeric,
  input_igst numeric,
  input_cgst numeric,
  input_sgst numeric,
  book_treatment text,
  matched_2b_id uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  posted_at timestamp with time zone,
  posted_by uuid,
  doc_type text
);
CREATE TABLE public.books_turnover_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  ledger_head text,
  rate text,
  taxable_value numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  notes text,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_advance_adjustments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id uuid,
  receipt_id uuid,
  consideration_adjusted numeric,
  taxable_value_adjusted numeric,
  cgst numeric,
  sgst numeric,
  rate_code text,
  rate_pct numeric,
  period_month text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);
CREATE TABLE public.builder_booking_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid,
  name text,
  pan text,
  ownership_ratio numeric,
  email text,
  phone text,
  is_primary boolean,
  sort_order integer,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_bookings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id uuid,
  booking_date date,
  total_consideration numeric,
  status text,
  cancelled_on date,
  cancellation_reason text,
  converted_to_booking_id uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid
);
CREATE TABLE public.builder_bounce_offsets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reversal_id uuid,
  period_month text,
  consideration numeric,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);
CREATE TABLE public.builder_bounce_reversals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id uuid,
  unit_id uuid,
  project_id uuid,
  bounced_on date,
  original_period text,
  rate_code text,
  rate_pct numeric,
  consideration numeric,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  adjusted_value numeric,
  status text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_bu_agreement_confirmations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bu_event_id uuid,
  unit_id uuid,
  client_id uuid,
  agreement_value_at_request numeric,
  token text,
  status text,
  outbox_id uuid,
  sent_at timestamp with time zone,
  responded_at timestamp with time zone,
  response_ip text,
  dispute_notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  overridden_by uuid,
  overridden_at timestamp with time zone,
  override_reason text
);
CREATE TABLE public.builder_bu_event_units (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bu_event_id uuid,
  unit_id uuid,
  cut_off_date date,
  cut_off_source text,
  booked_at_cutoff boolean,
  booking_id uuid,
  unit_type text,
  carpet_area_sqm numeric,
  rate_code text,
  rate_pct numeric,
  agreement_value numeric,
  value_taxed_upto_opening numeric,
  invoiced_before numeric,
  open_advance_before numeric,
  received_upto_cutoff numeric,
  differential_value numeric,
  differential_taxable_value numeric,
  differential_cgst numeric,
  differential_sgst numeric,
  interest_days integer,
  interest_amount numeric,
  tie_out_diff numeric,
  invoice_id uuid,
  subsumed_receipt_count integer,
  notes text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_bu_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid,
  bu_date date,
  bu_ref_no text,
  scope text,
  discovered_on date,
  posting_basis text,
  posting_period text,
  status text,
  posted_at timestamp with time zone,
  posted_by uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid
);
CREATE TABLE public.builder_cancellations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid,
  unit_id uuid,
  project_id uuid,
  cancellation_date date,
  reason text,
  rate_code text,
  rate_pct numeric,
  total_received numeric,
  forfeiture_amount numeric,
  cancellation_charge_taxable numeric,
  cancellation_charge_invoice_id uuid,
  correction_method text,
  credit_note_id uuid,
  refund_payable numeric,
  refund_paid numeric,
  status text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);
CREATE TABLE public.builder_client_settings (
  client_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  incl_plc boolean,
  incl_development boolean,
  incl_parking boolean,
  incl_club boolean,
  incl_utility_deposit boolean,
  incl_legal boolean,
  incl_maintenance_corpus boolean,
  incl_other boolean,
  extra_work_rate text,
  delay_interest_basis text,
  excess_tax_treatment text,
  default_fsi_treatment text,
  confirmation_outbox_id uuid,
  confirmation_sent_at timestamp with time zone,
  confirmation_received_at timestamp with time zone,
  confirmation_document_url text,
  confirmation_notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid,
  raises_invoices boolean,
  default_is_metro boolean
);
CREATE TABLE public.builder_conversions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  from_unit_id uuid,
  to_unit_id uuid,
  from_booking_id uuid,
  to_booking_id uuid,
  conversion_date date,
  period_month text,
  carried_value numeric,
  from_rate_code text,
  from_rate_pct numeric,
  to_rate_code text,
  to_rate_pct numeric,
  differential_tax numeric,
  credit_note_id uuid,
  invoice_id uuid,
  status text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);
CREATE TABLE public.builder_credit_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id uuid,
  booking_id uuid,
  note_date date,
  note_type text,
  consideration numeric,
  rate_code text,
  rate_pct numeric,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  window_expiry date,
  within_window boolean,
  period_month text,
  doc_series text,
  doc_no text,
  reason text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  original_documents jsonb
);
CREATE TABLE public.builder_dastavej_late_interest (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id uuid,
  project_id uuid,
  dastavej_date date,
  cut_off_period text,
  rate_code text,
  shortfall_value numeric,
  tranches jsonb,
  total_allocated numeric,
  total_interest numeric,
  residual_unrecovered numeric,
  status text,
  paid_date date,
  arn text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);
CREATE TABLE public.builder_excess_tax (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id uuid,
  unit_id uuid,
  project_id uuid,
  identified_on date,
  original_consideration numeric,
  restated_consideration numeric,
  original_tax numeric,
  restated_tax numeric,
  excess_tax numeric,
  treatment text,
  adjusted_value numeric,
  status text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_fsi_consents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fsi_working_id uuid,
  client_id uuid,
  project_id uuid,
  period_month text,
  fsi_value_at_request numeric,
  rcm_at_request numeric,
  outbox_id uuid,
  email_sent_at timestamp with time zone,
  confirmation_received_at timestamp with time zone,
  confirmation_document_url text,
  received_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_fsi_workings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid,
  bu_event_id uuid,
  period_month text,
  tdr_fsi_total_value numeric,
  event_carpet_sqm numeric,
  project_carpet_sqm numeric,
  allocated_value numeric,
  residential_carpet_sqm numeric,
  commercial_carpet_sqm numeric,
  unbooked_residential_carpet_sqm numeric,
  unbooked_residential_value numeric,
  residential_portion numeric,
  residential_rcm_uncapped numeric,
  cap_amount numeric,
  cap_applied boolean,
  residential_rcm numeric,
  commercial_portion numeric,
  commercial_rcm numeric,
  total_rcm numeric,
  cgst numeric,
  sgst numeric,
  treatment text,
  status text,
  posted_at timestamp with time zone,
  posted_by uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid
);
CREATE TABLE public.builder_historical_receipts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id uuid,
  receipt_date date,
  amount numeric,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_invoices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid,
  unit_id uuid,
  invoice_date date,
  invoice_type text,
  milestone_label text,
  consideration numeric,
  rate_code text,
  rate_pct numeric,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  period_month text,
  doc_series text,
  doc_no text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid
);
CREATE TABLE public.builder_itc_reversal_workings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  project_id uuid,
  bu_event_id uuid,
  completion_date date,
  start_fy text,
  bu_fy text,
  total_carpet_sqm numeric,
  exempt_carpet_sqm numeric,
  basis_note text,
  posting_period text,
  include_interest boolean,
  status text,
  result jsonb,
  submitted_by uuid,
  submitted_at timestamp with time zone,
  approved_by uuid,
  approved_at timestamp with time zone,
  adjustment_ids uuid[],
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_itc_reversal_years (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  working_id uuid,
  financial_year text,
  is_bu_year boolean,
  inputs_services jsonb,
  capital_goods jsonb,
  reversed_r42 jsonb,
  reversed_r43 jsonb,
  gstr9_arn text,
  gstr9_filed_on date,
  gstr9_match text,
  remarks text,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  t7_other jsonb,
  portal jsonb
);
CREATE TABLE public.builder_opening_balance_adjustments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id uuid,
  unit_id uuid,
  consideration_adjusted numeric,
  taxable_value_adjusted numeric,
  cgst numeric,
  sgst numeric,
  rate_code text,
  rate_pct numeric,
  period_month text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);
CREATE TABLE public.builder_opening_balances (
  unit_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  as_at_date date,
  agreement_value numeric,
  cumulative_receipts numeric,
  cumulative_value_taxed numeric,
  cumulative_cgst numeric,
  cumulative_sgst numeric,
  cumulative_tds_194ia numeric,
  is_affordable_at_opening boolean,
  rate_code_at_opening text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid
);
CREATE TABLE public.builder_project_groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid,
  name text,
  sort_order integer,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  name text,
  rera_number text,
  city text,
  is_metro boolean,
  grouping_label text,
  carpet_area_source text,
  manual_residential_carpet_sqm numeric,
  manual_commercial_carpet_sqm numeric,
  doc_series_prefix text,
  opening_cutoff_date date,
  fsi_treatment text,
  status text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid
);
CREATE TABLE public.builder_receipts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid,
  unit_id uuid,
  receipt_date date,
  receipt_nature text,
  amount_entered numeric,
  amount_is_gst_inclusive boolean,
  consideration numeric,
  rate_code text,
  rate_pct numeric,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  tds_194ia numeric,
  bank_credit numeric,
  instrument_type text,
  instrument_ref text,
  cheque_status text,
  bounced_on date,
  replaces_receipt_id uuid,
  gst_already_discharged boolean,
  period_month text,
  doc_series text,
  doc_no text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid,
  subsumed_by_bu_event_id uuid,
  cancelled_via_id uuid
);
CREATE TABLE public.builder_reclassification_periods (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reclassification_id uuid,
  period_month text,
  taxable_value numeric,
  old_cgst numeric,
  old_sgst numeric,
  new_cgst numeric,
  new_sgst numeric,
  differential_tax numeric,
  due_date date,
  interest_days integer,
  interest_amount numeric,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_reclassifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id uuid,
  triggered_on date,
  from_rate_code text,
  from_rate_pct numeric,
  to_rate_code text,
  to_rate_pct numeric,
  gross_before numeric,
  gross_after numeric,
  reason text,
  posting_period text,
  total_value_retaxed numeric,
  total_differential_tax numeric,
  total_interest numeric,
  status text,
  posted_at timestamp with time zone,
  posted_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  reversed_at timestamp with time zone,
  reversed_by uuid,
  reversal_reason text,
  discharge_mode text,
  drc03_status text,
  drc03_arn text,
  drc03_filed_date date,
  drc03_filed_by uuid
);
CREATE TABLE public.builder_refund_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cancellation_id uuid,
  payment_date date,
  period_month text,
  amount numeric,
  instrument_type text,
  instrument_ref text,
  notes text,
  offset_amount numeric,
  offset_taxable_value numeric,
  offset_cgst numeric,
  offset_sgst numeric,
  forfeited_amount numeric,
  email_outbox_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);
CREATE TABLE public.builder_unit_charges (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id uuid,
  charge_head text,
  label text,
  amount numeric,
  include_override boolean,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.builder_unit_classification_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id uuid,
  effective_from date,
  is_affordable boolean,
  rate_code text,
  rate_pct numeric,
  effective_rate_pct numeric,
  gross_consideration numeric,
  carpet_area_sqm numeric,
  area_limit_sqm numeric,
  is_rrep boolean,
  reason text,
  note text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);
CREATE TABLE public.builder_units (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid,
  group_id uuid,
  unit_no text,
  unit_type text,
  carpet_area_sqm numeric,
  base_consideration numeric,
  status text,
  dastavej_date date,
  dastavej_value numeric,
  sort_order integer,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid,
  bu_event_id uuid,
  onboarding_status text
);
CREATE TABLE public.client_annual_turnover (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  aggregate_turnover numeric,
  exempt_turnover numeric,
  itc_directly_attributable_exempt numeric,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  gstr9_opt_in boolean,
  gstr9c_opt_in boolean,
  applicability_note text,
  updated_by_name text
);
CREATE TABLE public.client_scheme_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  old_scheme text,
  new_scheme text,
  effective_from_date date,
  changed_by uuid,
  changed_at timestamp with time zone DEFAULT now(),
  notes text
);
CREATE TABLE public.contract_projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  code text,
  name text,
  department text,
  work_order_no text,
  work_order_date date,
  contract_value numeric,
  pos_state text,
  rate_pct numeric,
  mobilisation_advance_pct numeric,
  recovery_rule text,
  recovery_pct numeric,
  recovery_at_bill_no integer,
  bg_no text,
  bg_amount numeric,
  bg_expiry date,
  retention_pct numeric,
  status text,
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.contract_ra_bills (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid,
  client_id uuid,
  bill_no integer,
  bill_ref text,
  bill_date date,
  period_month text,
  gross_value numeric,
  taxable_value numeric,
  rate_pct numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  retention_held numeric,
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.duties_taxes_input_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  month text,
  purchase_igst numeric,
  purchase_cgst numeric,
  purchase_sgst numeric,
  debit_note_igst numeric,
  debit_note_cgst numeric,
  debit_note_sgst numeric,
  suspended_reversed_igst numeric,
  suspended_reversed_cgst numeric,
  suspended_reversed_sgst numeric,
  suspended_reversed_180d_igst numeric,
  suspended_reversed_180d_cgst numeric,
  suspended_reversed_180d_sgst numeric,
  suspended_reclaim_igst numeric,
  suspended_reclaim_cgst numeric,
  suspended_reclaim_sgst numeric,
  suspended_reclaim_180d_igst numeric,
  suspended_reclaim_180d_cgst numeric,
  suspended_reclaim_180d_sgst numeric,
  as_per_3b_igst numeric,
  as_per_3b_cgst numeric,
  as_per_3b_sgst numeric,
  other_adjustment_igst numeric,
  other_adjustment_cgst numeric,
  other_adjustment_sgst numeric,
  other_adjustment_reason text,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.duties_taxes_output_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  month text,
  sales_igst numeric,
  sales_cgst numeric,
  sales_sgst numeric,
  credit_note_igst numeric,
  credit_note_cgst numeric,
  credit_note_sgst numeric,
  as_per_3b_igst numeric,
  as_per_3b_cgst numeric,
  as_per_3b_sgst numeric,
  other_adjustment_igst numeric,
  other_adjustment_cgst numeric,
  other_adjustment_sgst numeric,
  other_adjustment_reason text,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.einvoice_docs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  section text,
  doc_type text,
  doc_no text,
  doc_key text,
  ctin text,
  doc_date text,
  irn text,
  irn_date text,
  inv_typ text,
  pos text,
  doc_value numeric,
  taxable numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  cess numeric,
  raw jsonb,
  source text,
  first_seen_at timestamp with time zone,
  last_seen_at timestamp with time zone,
  irn_status text,
  autopop_status text,
  autopop_date text,
  error text,
  gone_at timestamp with time zone
);
CREATE TABLE public.expense_head_mappings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  ledger_head text,
  expense_head text,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.filing_status (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  return_type public.return_type,
  period_month text,
  status public.filing_status_type,
  target_date integer,
  filed_date date,
  remarks text,
  is_locked boolean,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  arn text,
  return_pdf_url text,
  is_nil boolean,
  pushed_at timestamp with time zone
);
CREATE TABLE public.gst_cash_ledger_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  entry_date date,
  description text,
  is_debit boolean,
  igst numeric,
  cgst numeric,
  sgst numeric,
  cess numeric,
  balance numeric,
  pulled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gst_challans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  cpin text,
  challan_date date,
  payment_mode text,
  total_amount numeric,
  cgst_amount numeric,
  sgst_amount numeric,
  igst_amount numeric,
  cess_amount numeric,
  status text,
  pulled_at timestamp with time zone,
  pulled_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gst_credit_ledger_transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  is_debit boolean,
  description text,
  igst numeric,
  cgst numeric,
  sgst numeric,
  pulled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gst_credit_reversal_reclaim_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  is_opening_balance boolean,
  return_period text,
  transaction_date date,
  reference_no text,
  description text,
  itc_claimed_igst numeric,
  itc_claimed_cgst numeric,
  itc_claimed_sgst numeric,
  itc_claimed_cess numeric,
  itc_reversed_igst numeric,
  itc_reversed_cgst numeric,
  itc_reversed_sgst numeric,
  itc_reversed_cess numeric,
  itc_reclaimed_igst numeric,
  itc_reclaimed_cgst numeric,
  itc_reclaimed_sgst numeric,
  itc_reclaimed_cess numeric,
  closing_balance_igst numeric,
  closing_balance_cgst numeric,
  closing_balance_sgst numeric,
  closing_balance_cess numeric,
  pulled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gst_filed_returns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  return_type text,
  arn text,
  filed_date date,
  status text,
  summary jsonb,
  updated_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  full_json jsonb,
  full_json_pulled_at timestamp with time zone
);
CREATE TABLE public.gst_liability_ledger_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  entry_date date,
  description text,
  is_debit boolean,
  igst numeric,
  cgst numeric,
  sgst numeric,
  cess numeric,
  balance numeric,
  pulled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gst_rcm_liability_itc_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  is_opening_balance boolean,
  return_period text,
  transaction_date date,
  reference_no text,
  description text,
  liability_3_1d_igst numeric,
  liability_3_1d_cgst numeric,
  liability_3_1d_sgst numeric,
  liability_3_1d_cess numeric,
  itc_4a2_igst numeric,
  itc_4a2_cess numeric,
  itc_4a3_igst numeric,
  itc_4a3_cgst numeric,
  itc_4a3_sgst numeric,
  itc_4a3_cess numeric,
  closing_balance_igst numeric,
  closing_balance_cgst numeric,
  closing_balance_sgst numeric,
  closing_balance_cess numeric,
  pulled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gst_receivable_reco (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  opening_cgst numeric,
  opening_sgst numeric,
  opening_igst numeric,
  opening_source text,
  opening_csv_period_month text,
  opening_csv_uploaded_at timestamp with time zone,
  opening_csv_uploaded_by uuid,
  opening_override_justification text,
  opening_override_at timestamp with time zone,
  opening_override_by uuid,
  books_closing_cgst numeric,
  books_closing_sgst numeric,
  books_closing_igst numeric,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  opening_portal_pulled_at timestamp with time zone,
  opening_portal_pulled_by uuid,
  utilized_cgst numeric,
  utilized_sgst numeric,
  utilized_igst numeric,
  drc_cgst numeric,
  drc_sgst numeric,
  drc_igst numeric
);
CREATE TABLE public.gst_running_updates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  update_effect_month text,
  update_in_return text,
  update_type text,
  update_instructions_by text,
  matter_brief text,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  interest numeric,
  effect_month text,
  remarks text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid,
  instructions_by_employee_id uuid,
  itc_section text,
  itc_sr_no text
);
CREATE TABLE public.gst_taxpayer_profile (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  legal_name text,
  trade_name text,
  constitution_of_business text,
  registration_date date,
  jurisdiction_state text,
  jurisdiction_centre text,
  principal_place_address text,
  aadhaar_authentication_status text,
  registration_certificate_url text,
  pulled_at timestamp with time zone,
  pulled_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  gstin_status text,
  cancellation_date date,
  profile_json jsonb
);
CREATE TABLE public.gst_update_row_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  row_id uuid,
  changed_by_employee_id uuid,
  changed_at timestamp with time zone DEFAULT now(),
  group_version_id uuid,
  field_name text,
  old_value jsonb,
  new_value jsonb
);
CREATE TABLE public.gst_update_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  version_number integer,
  version_data jsonb,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  is_current boolean,
  restored_from_version_id uuid,
  filter_context jsonb,
  action_type text
);
CREATE TABLE public.gstr1_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  raw_json jsonb,
  file_name text,
  imported_by uuid,
  imported_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  last_pushed_at timestamp with time zone,
  last_push_status text,
  last_push_by uuid,
  last_push_message text,
  last_uploaded_at timestamp with time zone,
  last_uploaded_by uuid,
  last_upload_status text,
  last_upload_summary text,
  last_upload_errors jsonb
);
CREATE TABLE public.gstr1_direct_filing_approvals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  return_type text,
  period_month text,
  status text,
  reason text,
  requested_by uuid,
  requested_at timestamp with time zone,
  decided_by uuid,
  decided_at timestamp with time zone,
  decision_note text
);
CREATE TABLE public.gstr1_manual_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  section text,
  row_order integer,
  data jsonb,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr1_upload_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  version_number integer,
  action_type text,
  actor_id uuid,
  action_at timestamp with time zone DEFAULT now(),
  file_name text,
  status text,
  summary text,
  errors jsonb,
  payload jsonb,
  einvoice_kept integer,
  ext_version text
);
CREATE TABLE public.gstr1_upload_versions_quarantine (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  version_number integer,
  action_type text,
  actor_id uuid,
  action_at timestamp with time zone DEFAULT now(),
  file_name text,
  status text,
  summary text,
  errors jsonb,
  payload jsonb,
  quarantined_reason text,
  quarantined_at timestamp with time zone
);
CREATE TABLE public.gstr2a_import_docs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  bucket text,
  supplier_gstin text,
  supplier_name text,
  supplier_invoice_number text,
  invoice_type text,
  date date,
  invoice_value numeric,
  place_of_supply text,
  taxable_value numeric,
  input_igst numeric,
  input_cgst numeric,
  input_sgst numeric,
  cess numeric,
  reverse_charge boolean,
  gstr1_filing_date date,
  gstr1_period text,
  source text,
  irn text,
  import_batch_id uuid,
  imported_at timestamp with time zone DEFAULT now(),
  imported_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid
);
CREATE TABLE public.gstr3b_adjustments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  table_ref text,
  label text,
  source text,
  taxable_value numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  cess numeric,
  reason text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr3b_push_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  version_number integer,
  actor_id uuid,
  action_at timestamp with time zone DEFAULT now(),
  status text,
  summary text,
  filled_count integer,
  skipped jsonb,
  payload jsonb
);
CREATE TABLE public.gstr9_output_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  category text,
  taxable_value numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9_table14_differential_tax (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  tax_head text,
  payable numeric,
  paid numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9_table15_demands_refunds (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  row_key text,
  central_tax numeric,
  state_tax numeric,
  integrated_tax numeric,
  cess numeric,
  interest numeric,
  penalty numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9_table16_composition_deemed_approval (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  row_key text,
  taxable_value numeric,
  central_tax numeric,
  state_tax numeric,
  integrated_tax numeric,
  cess numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9c_certification (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  place text,
  signatory_name text,
  membership_no text,
  signature_date date,
  building_no text,
  floor_number text,
  premises_name text,
  road_street text,
  city_town_locality text,
  district text,
  state text,
  pin_code text,
  pan text,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9c_part_v_additional_liability (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  row_key text,
  taxable_value numeric,
  central_tax numeric,
  state_tax numeric,
  integrated_tax numeric,
  cess numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9c_table11_additional_liability (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  row_key text,
  taxable_value numeric,
  central_tax numeric,
  state_tax numeric,
  integrated_tax numeric,
  cess numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9c_table12_net_itc (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  itc_per_financials numeric,
  itc_earlier_fy_claimed_this_fy numeric,
  itc_this_fy_claimed_later_fy numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9c_table16_tax_payable_unreconciled_itc (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  row_key text,
  amount numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9c_table5_turnover_reco (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  row_key text,
  amount numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9c_table7_taxable_turnover_reco (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  row_key text,
  amount numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gstr9c_table9_rate_wise_liability_reco (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  row_key text,
  taxable_value numeric,
  central_tax numeric,
  state_tax numeric,
  integrated_tax numeric,
  cess numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.itc_reversal_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  rule text,
  igst numeric,
  cgst numeric,
  sgst numeric,
  notes text,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.itc_summaries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  data jsonb,
  is_locked boolean,
  edit_history jsonb,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.itc_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  version_number integer,
  version_data jsonb,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  is_current boolean,
  action_type text,
  restored_from_version_id uuid
);
CREATE TABLE public.pl_input_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  section text,
  ledger_head text,
  expense_head text,
  sr_no integer,
  rate text,
  taxable_value numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  notes text,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.pl_output_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  part text,
  ledger_head text,
  bifurcation text,
  sr_no integer,
  rate text,
  taxable_value numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  notes text,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.portal_gstr1_category_figures (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  category text,
  taxable_value numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  source text,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.portal_tax_payment_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  tax_head text,
  payable numeric,
  paid_cash numeric,
  paid_itc numeric,
  interest numeric,
  late_fee numeric,
  penalty numeric,
  entered_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.rcm_annual_return_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  month text,
  category text,
  taxable_value numeric,
  igst numeric,
  cgst numeric,
  sgst numeric,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.rcm_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  master_id uuid,
  financial_year text,
  month text,
  particulars text,
  rate text,
  supply_type text,
  taxable_value numeric,
  cgst_2_5 numeric,
  cgst_9 numeric,
  sgst_2_5 numeric,
  sgst_9 numeric,
  igst_5 numeric,
  igst_18 numeric,
  is_locked boolean,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.rcm_masters (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_name text,
  rate text,
  supply_type text,
  is_active boolean,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.rcm_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  version_number integer,
  version_data jsonb,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  is_current boolean,
  action_type text,
  restored_from_version_id uuid
);
CREATE TABLE public.reconciliation_reasons (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  financial_year text,
  line_key text,
  reason text,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.suspended_reco (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  portal_cgst numeric,
  portal_sgst numeric,
  portal_igst numeric,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  opening_cgst numeric,
  opening_sgst numeric,
  opening_igst numeric,
  opening_source text,
  opening_csv_period_month text,
  opening_csv_uploaded_at timestamp with time zone,
  opening_csv_uploaded_by uuid,
  opening_override_justification text,
  opening_override_at timestamp with time zone,
  opening_override_by uuid,
  opening_portal_pulled_at timestamp with time zone,
  opening_portal_pulled_by uuid
);
CREATE TABLE public.twob_import_docs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  date date,
  supplier_name text,
  supplier_invoice_number text,
  supplier_gstin text,
  taxable_value numeric,
  input_igst numeric,
  input_cgst numeric,
  input_sgst numeric,
  invoice_type text,
  invoice_value numeric,
  place_of_supply text,
  cess numeric,
  gstr1_period text,
  gstr1_filing_date date,
  source text,
  irn text,
  source_sheet text,
  bucket text,
  reverse_charge boolean,
  itc_available boolean,
  itc_reason text,
  itc_action text,
  matched_book_id uuid,
  import_batch_id uuid,
  imported_at timestamp with time zone DEFAULT now(),
  imported_by uuid,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  posted_at timestamp with time zone,
  posted_by uuid,
  doc_type text,
  is_amendment boolean,
  original_doc_number text,
  original_doc_date date,
  original_doc_type text,
  amends_doc_id uuid,
  amends_period text,
  base_taxable_value numeric(15,2),
  base_input_igst numeric(15,2),
  base_input_cgst numeric(15,2),
  base_input_sgst numeric(15,2),
  base_cess numeric(15,2),
  ims_reduce_required text,
  declared_igst numeric(15,2),
  declared_cgst numeric(15,2),
  declared_sgst numeric(15,2),
  declared_cess numeric(15,2),
  full_2b boolean
);
CREATE TABLE public.twob_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid,
  period_month text,
  table_type text,
  version_number integer,
  version_data jsonb,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  is_current boolean,
  action_type text,
  restored_from_version_id uuid
);
ALTER TABLE public.bills_not_in_books ADD FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.bills_not_in_2b ADD FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.builder_projects ADD FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.builder_units ADD FOREIGN KEY (project_id) REFERENCES public.builder_projects(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bookings ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
-- Every other ON DELETE CASCADE key of the builder tables, as live (21 Oct
-- 2026): a deleted unit or project takes its bookings, receipts, invoices ...
ALTER TABLE public.builder_advance_adjustments ADD FOREIGN KEY (invoice_id) REFERENCES public.builder_invoices(id) ON DELETE CASCADE;
ALTER TABLE public.builder_advance_adjustments ADD FOREIGN KEY (receipt_id) REFERENCES public.builder_receipts(id) ON DELETE CASCADE;
ALTER TABLE public.builder_booking_members ADD FOREIGN KEY (booking_id) REFERENCES public.builder_bookings(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bounce_offsets ADD FOREIGN KEY (reversal_id) REFERENCES public.builder_bounce_reversals(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bounce_reversals ADD FOREIGN KEY (project_id) REFERENCES public.builder_projects(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bounce_reversals ADD FOREIGN KEY (receipt_id) REFERENCES public.builder_receipts(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bounce_reversals ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bu_agreement_confirmations ADD FOREIGN KEY (bu_event_id) REFERENCES public.builder_bu_events(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bu_agreement_confirmations ADD FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bu_agreement_confirmations ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bu_event_units ADD FOREIGN KEY (bu_event_id) REFERENCES public.builder_bu_events(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bu_event_units ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_bu_events ADD FOREIGN KEY (project_id) REFERENCES public.builder_projects(id) ON DELETE CASCADE;
ALTER TABLE public.builder_cancellations ADD FOREIGN KEY (booking_id) REFERENCES public.builder_bookings(id) ON DELETE CASCADE;
ALTER TABLE public.builder_cancellations ADD FOREIGN KEY (project_id) REFERENCES public.builder_projects(id) ON DELETE CASCADE;
ALTER TABLE public.builder_cancellations ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_client_settings ADD FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.builder_conversions ADD FOREIGN KEY (from_unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_conversions ADD FOREIGN KEY (to_unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_credit_notes ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_dastavej_late_interest ADD FOREIGN KEY (project_id) REFERENCES public.builder_projects(id) ON DELETE CASCADE;
ALTER TABLE public.builder_dastavej_late_interest ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_excess_tax ADD FOREIGN KEY (project_id) REFERENCES public.builder_projects(id) ON DELETE CASCADE;
ALTER TABLE public.builder_excess_tax ADD FOREIGN KEY (receipt_id) REFERENCES public.builder_receipts(id) ON DELETE CASCADE;
ALTER TABLE public.builder_excess_tax ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_fsi_consents ADD FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.builder_fsi_consents ADD FOREIGN KEY (fsi_working_id) REFERENCES public.builder_fsi_workings(id) ON DELETE CASCADE;
ALTER TABLE public.builder_fsi_consents ADD FOREIGN KEY (project_id) REFERENCES public.builder_projects(id) ON DELETE CASCADE;
ALTER TABLE public.builder_fsi_workings ADD FOREIGN KEY (bu_event_id) REFERENCES public.builder_bu_events(id) ON DELETE CASCADE;
ALTER TABLE public.builder_fsi_workings ADD FOREIGN KEY (project_id) REFERENCES public.builder_projects(id) ON DELETE CASCADE;
ALTER TABLE public.builder_historical_receipts ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_invoices ADD FOREIGN KEY (booking_id) REFERENCES public.builder_bookings(id) ON DELETE CASCADE;
ALTER TABLE public.builder_invoices ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_itc_reversal_workings ADD FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.builder_itc_reversal_workings ADD FOREIGN KEY (project_id) REFERENCES public.builder_projects(id) ON DELETE CASCADE;
ALTER TABLE public.builder_itc_reversal_years ADD FOREIGN KEY (working_id) REFERENCES public.builder_itc_reversal_workings(id) ON DELETE CASCADE;
ALTER TABLE public.builder_opening_balance_adjustments ADD FOREIGN KEY (invoice_id) REFERENCES public.builder_invoices(id) ON DELETE CASCADE;
ALTER TABLE public.builder_opening_balance_adjustments ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_opening_balances ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_project_groups ADD FOREIGN KEY (project_id) REFERENCES public.builder_projects(id) ON DELETE CASCADE;
ALTER TABLE public.builder_receipts ADD FOREIGN KEY (booking_id) REFERENCES public.builder_bookings(id) ON DELETE CASCADE;
ALTER TABLE public.builder_receipts ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_reclassification_periods ADD FOREIGN KEY (reclassification_id) REFERENCES public.builder_reclassifications(id) ON DELETE CASCADE;
ALTER TABLE public.builder_reclassifications ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_refund_payments ADD FOREIGN KEY (cancellation_id) REFERENCES public.builder_cancellations(id) ON DELETE CASCADE;
ALTER TABLE public.builder_unit_charges ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;
ALTER TABLE public.builder_unit_classification_history ADD FOREIGN KEY (unit_id) REFERENCES public.builder_units(id) ON DELETE CASCADE;

-- Every table open to public, as live (CLAUDE.md).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', t || '_open', t);
  END LOOP;
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- As live (20261017100000_staff_levels_guard.sql).
CREATE FUNCTION public.staff_level_of(p_user_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN bool_or(role = 'superadmin') THEN 'superadmin'
    WHEN bool_or(role = 'gst_manager') THEN 'gst_manager'
    WHEN bool_or(role = 'employee') THEN 'employee'
  END
    FROM public.user_roles WHERE user_id = p_user_id;
$$;

CREATE FUNCTION public.t_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAILED %: expected [%], got [%]', p_label, p_expected, p_actual;
  END IF;
END $$;
-- Passes when p_sql raises an error whose message contains p_like.
CREATE FUNCTION public.t_raises(p_sql text, p_like text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_like in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FAILED %: raised [%], expected it to mention [%]', p_label, SQLERRM, p_like;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAILED %: did not raise', p_label;
END $$;
-- Sets what PostgREST sets for one request: the role's claims and the headers.
CREATE FUNCTION public.t_request(p_role text, p_headers jsonb) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('role', p_role)::text, false),
         set_config('request.headers', COALESCE(p_headers, '{}'::jsonb)::text, false);
$$;
GRANT EXECUTE ON FUNCTION public.t_eq(anyelement, anyelement, text), public.t_raises(text, text, text), public.t_request(text, jsonb) TO anon;
