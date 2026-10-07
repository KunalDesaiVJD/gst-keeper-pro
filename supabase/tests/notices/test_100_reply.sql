-- Reply Factory I (migrations 20261008100000–140000): form rules for portal
-- events, the portal reader, form issues, due-date coverage, the AI reading
-- queue (switches, consent, claim, finish, verify), evidence versions, document
-- requests from issue codes with reminders and the client portal, and the status.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, email, inactive_at_hand, notices_sync_excluded) VALUES
 ('c4100000-0000-0000-0000-000000000001', 'Reader Textiles', '24READR0000R1Z5', 'reader', 'accounts@reader.example', false, false),
 ('c4100000-0000-0000-0000-000000000002', 'Quiet Traders', '24QUIET0000Q1Z5', 'quiet', NULL, false, false);

-- ── Form rules for portal events that had none ─────────────────────────────
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number) VALUES
 ('c4200000-0000-0000-0000-000000000001', 'c4100000-0000-0000-0000-000000000001', 'notices', 'r1', 'Refunds',
  'Order for re-credit of the amount to cash or credit ledger on rejection of refund', ist_today() - 5, 'ZR-1'),
 ('c4200000-0000-0000-0000-000000000002', 'c4100000-0000-0000-0000-000000000001', 'notices', 'r2', 'Refunds',
  'Refund Sanction/Rejection Order (RFD-06)', ist_today() - 5, 'ZR-2'),
 ('c4200000-0000-0000-0000-000000000003', 'c4100000-0000-0000-0000-000000000001', 'notices', 'r3', 'Appeal',
  'Hearing notice issued', ist_today() - 2, 'ZA-3'),
 ('c4200000-0000-0000-0000-000000000004', 'c4100000-0000-0000-0000-000000000001', 'notices', 'r4', 'Appeal',
  'Appeal admitted', ist_today() - 2, 'ZA-4'),
 ('c4200000-0000-0000-0000-000000000005', 'c4100000-0000-0000-0000-000000000001', 'notices', 'r5', 'Audit',
  'Notice for Discrepancy under rule 101(4)', ist_today() - 2, 'ZA-5');
SELECT t_eq((SELECT string_agg(reference_number || '=' || coalesce(form_code, '-'), ' ' ORDER BY reference_number)
               FROM gst_notices WHERE client_id = 'c4100000-0000-0000-0000-000000000001'),
            'ZA-3=APL-HEARING ZA-4=APL-02 ZA-5=ADT-02 ZR-1=PMT-03 ZR-2=RFD-06', 'refund orders, appeal hearings, acknowledgements and audit discrepancies are classified');
SELECT t_eq(notice_form_code('Determination Of Tax', 'Show Cause Notice under section 73 — DRC-01 with personal hearing notice issued'), 'DRC-01',
            'a rule added at 100+ never takes a notice an earlier rule matches');

-- ── The portal reader ──────────────────────────────────────────────────────
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, financial_year) VALUES
 ('c4200000-0000-0000-0000-000000000010', 'c4100000-0000-0000-0000-000000000001', 'notices', 'scn', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 3, 'ZD-SCN-10', 'AD2410000010', NULL),
 ('c4200000-0000-0000-0000-000000000011', 'c4100000-0000-0000-0000-000000000001', 'notices', 'scn2', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 3, 'ZD-SCN-11', 'AD2410000011', '2018-19');
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, reference_number, folder_section, raw_json) VALUES
 ('c4100000-0000-0000-0000-000000000001', 'AD2410000010', 'k10', 'ZD-SCN-10', 'NOTCE', $j${"sdtls": {"dtscn": {
    "sec": "SECTION 73 OF SGST", "fy": "2019-2020",
    "tpovl": {"fromm": "APR", "fromy": "2019", "tom": "03", "toy": "2020"},
    "dmddtls": [
      {"dact": "CGST", "dtax": "1,000", "dist": "180", "dpnlty": "100", "dfees": "0", "dothers": "", "dtot": "1280", "tp": {"fromm": "04", "fromy": "2019", "tom": "03", "toy": "2020"}},
      {"dact": "SGST", "dtax": "1000", "dist": "180", "dpnlty": "100", "dfees": "0", "dothers": "0", "dtot": "1280", "tp": {"fromm": "04", "fromy": "2019", "tom": "03", "toy": "2020"}},
      {"dact": "", "dtax": "", "dist": "", "dpnlty": "", "dfees": "", "dothers": ""}],
    "facts": "ITC availed in GSTR-3B exceeds GSTR-2A.", "grounds": "Excess ITC of Rs 2,000 to be reversed with interest.",
    "phdt": "15/11/2026", "pht": "11:30", "venu": "Room 5, Ghatak 12", "pershrng": "Y"}}}$j$::jsonb),
 ('c4100000-0000-0000-0000-000000000001', 'AD2410000011', 'k11', 'ZD-SCN-11', 'NOTCE', $j${"sdtls": {"dtscn": {
    "sec": "74", "fy": "2019-2020", "tpovl": {"fromm": "04", "fromy": "2019", "tom": "03", "toy": "2020"},
    "dmddtls": [{"dact": "IGST", "dtax": "500", "dist": "0", "dpnlty": "500", "dtot": "1000"}]}}}$j$::jsonb);

SELECT t_eq((SELECT section_of_law || ' ' || financial_year || ' ' || period_from || '…' || period_to
               FROM gst_notices WHERE id = 'c4200000-0000-0000-0000-000000000010'),
            '73 2019-20 2019-04-01…2020-03-31', 'the folder item fills section, FY and tax period');
SELECT t_eq((SELECT demand -> 'cgst' ->> 'tax' || '/' || (demand -> 'sgst' ->> 'interest') || '/' || demand_total || '/' || amount_of_demand
               FROM gst_notices WHERE id = 'c4200000-0000-0000-0000-000000000010'),
            '1000/180/2560/2560', 'demand by head (Indian commas read), the total, and the amount of demand');
SELECT t_eq((SELECT (demand ? 'unspecified')::text FROM gst_notices WHERE id = 'c4200000-0000-0000-0000-000000000010'),
            'false', 'an all-empty demand row adds no head');
SELECT t_eq((SELECT hearing_date || ' ' || hearing_note FROM gst_notices WHERE id = 'c4200000-0000-0000-0000-000000000010'),
            '2026-11-15 11:30 · Room 5, Ghatak 12', 'the hearing from the folder item');
SELECT t_eq((SELECT read_fields -> 'section_of_law' ->> 'source' || '/' || (read_fields -> 'section_of_law' ->> 'verified')
               FROM gst_notices WHERE id = 'c4200000-0000-0000-0000-000000000010'),
            'portal/true', 'portal values are recorded as read from the portal, verified');
SELECT t_eq((SELECT outcome || ' ' || (detail ->> 'grounds') FROM notice_extractions
              WHERE notice_id = 'c4200000-0000-0000-0000-000000000010' AND source = 'portal'),
            'applied Excess ITC of Rs 2,000 to be reversed with interest.', 'the reading is kept with the officer''s grounds');
SELECT t_eq((SELECT count(*) || ' ' || min(source) || ' ' || min(amount) || ' ' || min(period_from)::text FROM notice_issues
              WHERE notice_id = 'c4200000-0000-0000-0000-000000000010'),
            '1 portal 2560 2019-04-01', 'one issue for the demand, from the portal');
-- A typed value is never replaced; the difference is a conflict.
SELECT t_eq((SELECT financial_year FROM gst_notices WHERE id = 'c4200000-0000-0000-0000-000000000011'), '2018-19',
            'the FY staff typed stays');
SELECT t_eq((SELECT outcome || ' ' || (checks -> 'conflicts' -> 'financial_year' ->> 'current') FROM notice_extractions
              WHERE notice_id = 'c4200000-0000-0000-0000-000000000011' AND source = 'portal'),
            'applied 2018-19', 'the portal''s 2019-20 is recorded as a conflict');
-- Reading again changes nothing and adds no rows.
SELECT notice_read_portal('c4200000-0000-0000-0000-000000000010');
SELECT t_eq((SELECT count(*) FROM notice_extractions WHERE notice_id = 'c4200000-0000-0000-0000-000000000010'), 1::bigint, 'one portal reading per notice');
SELECT t_eq((SELECT count(*) FROM notice_issues WHERE notice_id = 'c4200000-0000-0000-0000-000000000010'), 1::bigint, 'no second issue');
SELECT t_eq((SELECT outcome FROM notice_extractions WHERE notice_id = 'c4200000-0000-0000-0000-000000000010'), 'nothing_new', 'nothing new the second time');

-- ── Forms that imply their issue ───────────────────────────────────────────
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, due_date) VALUES
 ('c4200000-0000-0000-0000-000000000020', 'c4100000-0000-0000-0000-000000000001', 'notices', 'b', 'Notice',
  'Intimation of difference in liability reported in GSTR-1 and GSTR-3B (DRC-01B)', ist_today() - 1, 'ZD-01B', ist_today() + 6),
 ('c4200000-0000-0000-0000-000000000021', 'c4100000-0000-0000-0000-000000000001', 'notices', 'c', 'Notice',
  'Intimation of difference in ITC (DRC-01C)', ist_today() - 1, 'ZD-01C', NULL);
SELECT t_eq((SELECT string_agg(g.form_code || ':' || i.issue_code || ':' || i.source, ' ' ORDER BY g.form_code)
               FROM notice_issues i JOIN gst_notices g ON g.id = i.notice_id
              WHERE g.id IN ('c4200000-0000-0000-0000-000000000020', 'c4200000-0000-0000-0000-000000000021')),
            'DRC-01B:LIAB_GSTR1_V_3B:form DRC-01C:ITC_2B_V_3B:form', 'DRC-01B and DRC-01C get their issue');

-- ── Due-date coverage ──────────────────────────────────────────────────────
UPDATE gst_notices SET hearing_date = ist_today() + 9 WHERE id = 'c4200000-0000-0000-0000-000000000003';
SELECT notice_clocks_refresh('c4200000-0000-0000-0000-000000000002');
SELECT t_eq((SELECT string_agg(g.reference_number || '=' || c.kind, ' ' ORDER BY g.reference_number)
               FROM notice_due_coverage() c JOIN gst_notices g ON g.id = c.notice_id
              WHERE g.client_id = 'c4100000-0000-0000-0000-000000000001'),
            'ZA-3=hearing ZA-4=informational ZA-5=missing ZD-01B=reply ZD-01C=reply ZD-SCN-10=hearing ZD-SCN-11=missing ZR-1=informational ZR-2=appeal',
            'each open notice runs on a reply date, a hearing, an appeal clock, closes by itself, or is missing');
SELECT t_eq((SELECT c.source FROM notice_due_coverage() c WHERE c.notice_id = 'c4200000-0000-0000-0000-000000000020'),
            'portal notice list', 'a reply date says where it came from');

-- ── AI reading: switches and consent ───────────────────────────────────────
UPDATE gst_notices SET pdf_url = 'https://example.test/storage/v1/object/public/notice-pdfs/notice-01c.pdf' WHERE id = 'c4200000-0000-0000-0000-000000000021';
SELECT t_eq(ai_read_allowed('c4100000-0000-0000-0000-000000000001'), 'off', 'reading ships off');
SELECT t_eq((SELECT count(*) FROM notice_extractions WHERE source = 'ai'), 0::bigint, 'nothing was queued while off');
SELECT t_eq(notice_read_request('c4200000-0000-0000-0000-000000000021', NULL, 'Asha') ->> 'reason', 'off', 'a request while off says so');
-- The office agent reads here (since 20261009100000 the Edge Function is the default runner).
UPDATE ai_settings SET read_enabled = true, runner = 'office_agent';
SELECT t_eq(notice_read_request('c4200000-0000-0000-0000-000000000021', NULL, 'Asha') ->> 'reason', 'no_consent', 'no consent, nothing queued');
SELECT t_eq(ai_set_consent(ARRAY['c4100000-0000-0000-0000-000000000001']::uuid[], ist_today(), 'Engagement letter clause'), 1, 'consent recorded');
SELECT t_eq(notice_read_request('c4200000-0000-0000-0000-000000000011', NULL, 'Asha') ->> 'reason', 'no_document', 'no PDF and no folder document');
SELECT t_eq((notice_read_request('c4200000-0000-0000-0000-000000000021', NULL, 'Asha') ->> 'queued')::boolean, true, 'queued');
SELECT t_eq(notice_read_request('c4200000-0000-0000-0000-000000000021', NULL, 'Asha') ->> 'reason', 'already', 'asked twice: one job');
SELECT t_eq((SELECT priority || ' ' || document_label FROM notice_extractions WHERE notice_id = 'c4200000-0000-0000-0000-000000000021'),
            '80 Notice PDF', 'a person''s request comes first');
-- New notices are read by themselves, but not GSTR-3A or acknowledgements.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, pdf_url) VALUES
 ('c4200000-0000-0000-0000-000000000030', 'c4100000-0000-0000-0000-000000000001', 'notices', 'n1', 'Scrutiny Of Returns',
  'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', ist_today(), 'ZD-ASMT', 'https://example.test/storage/v1/object/public/notice-pdfs/asmt.pdf'),
 ('c4200000-0000-0000-0000-000000000031', 'c4100000-0000-0000-0000-000000000001', 'notices', 'n2', 'Notice',
  'Notice to return defaulter u/s 46 for not filing return (GSTR-3A)', ist_today(), 'ZD-3A', 'https://example.test/storage/v1/object/public/notice-pdfs/3a.pdf'),
 ('c4200000-0000-0000-0000-000000000032', 'c4100000-0000-0000-0000-000000000002', 'notices', 'n3', 'Scrutiny Of Returns',
  'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', ist_today(), 'ZD-QUIET', 'https://example.test/storage/v1/object/public/notice-pdfs/q.pdf');
SELECT t_eq((SELECT string_agg(g.reference_number, ' ' ORDER BY g.reference_number) FROM notice_extractions x JOIN gst_notices g ON g.id = x.notice_id
              WHERE x.source = 'ai'),
            'ZD-01C ZD-ASMT', 'auto-read: the ASMT-10 of the client with consent; not the GSTR-3A, not a client without consent');
-- A notice the rules cannot classify gets no issue from the form reader.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number) VALUES
 ('c4200000-0000-0000-0000-000000000035', 'c4100000-0000-0000-0000-000000000001', 'notices', 'n6', NULL, NULL, ist_today(), 'ZD-BLANK');
SELECT t_eq((SELECT count(*) FROM notice_issues WHERE notice_id = 'c4200000-0000-0000-0000-000000000035'), 0::bigint,
            'an unclassified notice gets no form issue');
-- A client's first sync brings old and closed notices: those are not read by themselves.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, pdf_url, staff_status) VALUES
 ('c4200000-0000-0000-0000-000000000033', 'c4100000-0000-0000-0000-000000000001', 'notices', 'n4', 'Scrutiny Of Returns',
  'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', ist_today() - 200, 'ZD-OLD',
  'https://example.test/storage/v1/object/public/notice-pdfs/old.pdf', NULL),
 ('c4200000-0000-0000-0000-000000000034', 'c4100000-0000-0000-0000-000000000001', 'notices', 'n5', 'Scrutiny Of Returns',
  'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', ist_today(), 'ZD-SHUT',
  'https://example.test/storage/v1/object/public/notice-pdfs/shut.pdf', 'Closed');
SELECT t_eq((SELECT count(*) FROM notice_extractions x JOIN gst_notices g ON g.id = x.notice_id
              WHERE x.source = 'ai' AND g.reference_number IN ('ZD-OLD', 'ZD-SHUT')), 0::bigint,
            'auto-read skips a notice issued long ago and a closed one');

-- ── Claim, cap, finish ─────────────────────────────────────────────────────
DO $$ DECLARE j jsonb; BEGIN
  j := notice_read_claim('office-pc-1');
  PERFORM t_eq(j ->> 'reference_number', 'ZD-01C', 'the person''s request is claimed first');
  PERFORM t_eq(j ->> 'client_gstin' || ' ' || (j ->> 'model') || ' ' || (j ->> 'document_url'),
               '24READR0000R1Z5 claude-opus-5-5 https://example.test/storage/v1/object/public/notice-pdfs/notice-01c.pdf', 'the job carries what the reader needs');
  PERFORM t_eq(jsonb_array_length(j -> 'issue_codes') > 15, true, 'and the issue codes');
END $$;
-- Consent withdrawn before the claim: the job is dropped, not read.
SELECT ai_set_consent(ARRAY['c4100000-0000-0000-0000-000000000001']::uuid[], NULL);
SELECT t_eq(notice_read_claim('office-pc-1'), NULL::jsonb, 'no consent: nothing to claim');
SELECT t_eq((SELECT x.status || ' ' || x.reason_class FROM notice_extractions x JOIN gst_notices g ON g.id = x.notice_id WHERE g.reference_number = 'ZD-ASMT'),
            'cancelled no_consent', 'the queued job is cancelled with the reason');
SELECT ai_set_consent(ARRAY['c4100000-0000-0000-0000-000000000001']::uuid[], ist_today(), 'Engagement letter clause');
SELECT t_eq(notice_read_request('c4200000-0000-0000-0000-000000000030') ->> 'queued', 'true', 're-queued after consent');
-- The day's cap stops claims.
INSERT INTO ai_audit_log (purpose, status, cost_usd) VALUES ('notice_read', 'ok', 10);
SELECT t_eq(notice_read_claim('office-pc-1') ->> 'capped', 'true', 'over the daily cap: nothing is claimed');
DELETE FROM ai_audit_log;

-- Finish the DRC-01C read: checked fields fill empty columns, the issues replace the form's issue.
SELECT t_eq((notice_read_finish(
  (SELECT id FROM notice_extractions WHERE notice_id = 'c4200000-0000-0000-0000-000000000021' AND source = 'ai'), 'office-pc-1', 'done',
  $r${"fields": {
     "gstin": {"value": "24READR0000R1Z5", "page": 1, "quote": "GSTIN 24READR0000R1Z5", "quote_ok": true},
     "section_of_law": {"value": "73", "page": 1, "quote": "section 73", "quote_ok": true},
     "din": {"value": "20241056YY0000999X", "page": 1, "quote": "DIN 20241056YY0000999X", "quote_ok": true},
     "due_date": {"value": "2026-11-30", "page": 1, "quote": "reply by 30/11/2026", "quote_ok": true},
     "period_from": {"value": "2023-04-01", "page": 1, "quote": "April 2023", "quote_ok": true},
     "period_to": {"value": "2023-06-30", "page": 1, "quote": "June 2023", "quote_ok": true},
     "officer": {"value": "Assistant Commissioner", "page": 2, "quote": "made up", "quote_ok": false},
     "demand": {"value": {"igst": {"tax": 15000, "interest": 0, "penalty": 0, "fee": 0, "others": 0}}, "page": 1, "quote": "15,000", "quote_ok": true}},
   "issues": [{"issue_code": "ITC_2B_V_3B", "title": "ITC in 3B over 2B, Apr–Jun 2023", "amount": 15000,
               "demand": {"igst": {"tax": 15000}}, "period_from": "2023-04-01", "period_to": "2023-06-30", "page": 1, "quote": "excess ITC"}],
   "checks": {"gstin": {"expected": "24READR0000R1Z5", "found": "24READR0000R1Z5", "ok": true}, "sums": {"ok": true}},
   "detail": {"summary": "DRC-01C for Apr–Jun 2023."}, "pages": 2, "text_layer": true, "document_sha256": "abc", "model": "claude-opus-5-5"}$r$::jsonb,
  '{"input_tokens": 20000, "output_tokens": 1500, "duration_ms": 9000, "request_id": "req_1", "status": "ok"}'::jsonb)) ->> 'outcome',
  'applied', 'the reading is applied');
SELECT t_eq((SELECT section_of_law || ' ' || din || ' ' || due_date || ' ' || due_date_source || ' ' || coalesce(issued_by, '-') || ' ' || amount_of_demand
               FROM gst_notices WHERE id = 'c4200000-0000-0000-0000-000000000021'),
            '73 20241056YY0000999X 2026-11-30 read - 15000', 'only checked fields, only into empty columns; the officer whose quote failed is left out');
SELECT t_eq((SELECT read_fields -> 'due_date' ->> 'source' || '/' || (read_fields -> 'due_date' ->> 'verified')
               FROM gst_notices WHERE id = 'c4200000-0000-0000-0000-000000000021'), 'ai/false', 'marked auto — verify');
SELECT t_eq((SELECT string_agg(issue_code || ':' || source || ':' || verified::text || ':' || amount, ' ') FROM notice_issues
              WHERE notice_id = 'c4200000-0000-0000-0000-000000000021'),
            'ITC_2B_V_3B:extracted:false:15000', 'the read issue replaces the untouched form issue');
SELECT t_eq((SELECT count(*) || ' ' || min(cost_usd)::text || ' ' || min(input_tokens) FROM ai_audit_log WHERE purpose = 'notice_read'),
            '1 0.1100 20000', 'one audit row with its cost (20k in at $4, 1.5k out at $20 per million)');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'c4200000-0000-0000-0000-000000000021' AND event_type = 'read_by_ai'), 1::bigint,
            'the activity shows the reading');
-- A PDF addressed to another GSTIN applies nothing.
DO $$ DECLARE j jsonb; r jsonb; BEGIN
  j := notice_read_claim('office-pc-1');
  PERFORM t_eq(j ->> 'reference_number', 'ZD-ASMT', 'next job');
  r := notice_read_finish((j ->> 'extraction_id')::uuid, 'office-pc-1', 'done',
    '{"fields": {"section_of_law": {"value": "61", "page": 1, "quote": "section 61", "quote_ok": true}},
      "checks": {"gstin": {"expected": "24READR0000R1Z5", "found": "27OTHER0000O1Z5", "ok": false}}}'::jsonb, NULL);
  PERFORM t_eq(r ->> 'outcome', 'gstin_mismatch', 'another GSTIN');
  PERFORM t_eq((SELECT section_of_law FROM gst_notices WHERE id = 'c4200000-0000-0000-0000-000000000030'), NULL::text, 'nothing applied');
END $$;
-- Retries back off, then fail after three tries.
DO $$ DECLARE x uuid; BEGIN
  PERFORM notice_read_request('c4200000-0000-0000-0000-000000000020');
  UPDATE gst_notices SET pdf_url = 'https://example.test/storage/v1/object/public/notice-pdfs/01b.pdf' WHERE id = 'c4200000-0000-0000-0000-000000000020';
  PERFORM notice_read_request('c4200000-0000-0000-0000-000000000020', NULL, 'Asha');
  x := (notice_read_claim('office-pc-1') ->> 'extraction_id')::uuid;
  PERFORM t_eq(notice_read_finish(x, 'office-pc-2', 'done', '{}'::jsonb) ->> 'error', 'not_yours', 'another agent cannot finish it');
  PERFORM t_eq(notice_read_finish(x, 'office-pc-1', 'retry', NULL, NULL, 'HTTP 529', 'overloaded') ->> 'status', 'queued', 'first failure: retried later');
  PERFORM t_eq((SELECT not_before > now() FROM notice_extractions WHERE id = x), true, 'with a backoff');
  UPDATE notice_extractions SET not_before = NULL, attempts = 2 WHERE id = x;
  PERFORM t_eq((notice_read_claim('office-pc-1') ->> 'extraction_id')::uuid, x, 'claimed again');
  PERFORM t_eq(notice_read_finish(x, 'office-pc-1', 'retry', NULL, NULL, 'HTTP 529', 'overloaded') ->> 'status', 'failed', 'the third failure is final');
END $$;
SELECT t_eq(notice_reads_release('office-pc-1'), 0, 'nothing left running');

-- ── Verifying what a reader filled ─────────────────────────────────────────
SELECT t_eq(notice_read_verify('c4200000-0000-0000-0000-000000000021', 'due_date', 'confirm', 'Asha'), 'confirmed', 'confirmed as read');
UPDATE gst_notices SET din = '20241056YY0000999Y' WHERE id = 'c4200000-0000-0000-0000-000000000021';
SELECT t_eq(notice_read_verify('c4200000-0000-0000-0000-000000000021', 'din', 'confirm', 'Asha'), 'corrected', 'staff changed it first: corrected');
SELECT t_eq(notice_read_verify('c4200000-0000-0000-0000-000000000021', 'section_of_law', 'clear', 'Asha'), 'rejected', 'an unverified value can be cleared');
SELECT t_eq((SELECT coalesce(section_of_law, 'none') FROM gst_notices WHERE id = 'c4200000-0000-0000-0000-000000000021'), 'none', 'and is gone');
SELECT t_eq(notice_read_verify('c4200000-0000-0000-0000-000000000021', 'due_date', 'clear', 'Asha'), 'verified', 'a verified value is not cleared');
SELECT t_eq(notice_issue_verify((SELECT id FROM notice_issues WHERE notice_id = 'c4200000-0000-0000-0000-000000000021'), 'Asha'), true, 'an issue is confirmed');

-- ── Evidence versions ──────────────────────────────────────────────────────
DO $$ DECLARE i uuid; a jsonb; BEGIN
  i := (SELECT id FROM notice_issues WHERE notice_id = 'c4200000-0000-0000-0000-000000000021');
  a := reply_annexure_save('c4200000-0000-0000-0000-000000000021', i, 'gstr3b_vs_2b', 'ready', 'ITC 3B v 2B',
        ARRAY['04/2023', '05/2023', '06/2023'], '2023-24', '{"igst": {"difference": 9000}}', '[]', '{}', 'h1', 9000, 6000);
  PERFORM t_eq((a ->> 'version')::int, 1, 'first version');
  PERFORM t_eq((SELECT explained_amount || ' ' || (explained_by IS NOT NULL) FROM notice_issues WHERE id = i), '9000 true', 'the issue''s explained amount follows the recipe');
  a := reply_annexure_save('c4200000-0000-0000-0000-000000000021', i, 'gstr3b_vs_2b', 'ready', 'ITC 3B v 2B',
        ARRAY['04/2023'], '2023-24', '{}', '[]', '{}', 'h1', 9000, 6000);
  PERFORM t_eq((a ->> 'unchanged')::boolean, true, 'same inputs: no new version');
  a := reply_annexure_save('c4200000-0000-0000-0000-000000000021', i, 'gstr3b_vs_2b', 'ready', 'ITC 3B v 2B',
        ARRAY['04/2023'], '2023-24', '{}', '[]', '{}', 'h2', 12000, 3000, 'Asha');
  PERFORM t_eq((a ->> 'version')::int, 2, 'new inputs: version 2');
  PERFORM t_eq((SELECT count(*) FILTER (WHERE is_current) || '/' || count(*) FROM reply_annexures WHERE notice_id = 'c4200000-0000-0000-0000-000000000021'),
               '1/2', 'one current version');
  UPDATE notice_issues SET explained_amount = 5000, explained_by = NULL WHERE id = i;
  PERFORM reply_annexure_save('c4200000-0000-0000-0000-000000000021', i, 'gstr3b_vs_2b', 'ready', 'ITC 3B v 2B',
        ARRAY['04/2023'], '2023-24', '{}', '[]', '{}', 'h3', 14000, 1000);
  PERFORM t_eq((SELECT explained_amount FROM notice_issues WHERE id = i), 5000::numeric, 'a typed explained amount is never replaced');
END $$;
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'c4200000-0000-0000-0000-000000000021' AND event_type = 'evidence_built'), 3::bigint,
            'each new version is in the activity');

-- ── Document requests from issue codes ─────────────────────────────────────
INSERT INTO notice_doc_requests (notice_id, item, due_date) VALUES ('c4200000-0000-0000-0000-000000000021', 'Purchase register for the period', ist_today() + 1);
SELECT t_eq((notice_doc_requests_generate('c4200000-0000-0000-0000-000000000021', NULL, 'Asha') ->> 'added')::int, 3,
            'the code''s documents not already asked for are added');
SELECT t_eq((SELECT count(*) FROM notice_doc_requests WHERE notice_id = 'c4200000-0000-0000-0000-000000000021' AND source = 'catalogue' AND issue_id IS NOT NULL),
            3::bigint, 'each tied to its issue');
SELECT t_eq((notice_doc_requests_generate('c4200000-0000-0000-0000-000000000021') ->> 'added')::int, 0, 'asked once');
SELECT t_eq((SELECT min(due_date) FILTER (WHERE source = 'catalogue') FROM notice_doc_requests WHERE notice_id = 'c4200000-0000-0000-0000-000000000021'),
            greatest(date '2026-11-30' - 3, ist_today() + 2), 'due three days before the reply date');
-- The client portal.
SELECT t_eq((SELECT count(*) FROM client_doc_requests('c4100000-0000-0000-0000-000000000001')), 4::bigint, 'the client sees what is asked');
SELECT t_eq((SELECT count(*) FROM client_doc_requests('c4100000-0000-0000-0000-000000000002')), 0::bigint, 'another client sees none of it');
INSERT INTO matter_documents (id, notice_id, kind, title, storage_path, source, uploaded_by_name)
VALUES ('c4300000-0000-0000-0000-000000000001', 'c4200000-0000-0000-0000-000000000021', 'client', 'purchase-register.xlsx',
        'notices/c41/client-uploads/x.xlsx', 'client_portal', 'Reader Textiles');
SELECT t_eq(client_doc_request_upload((SELECT id FROM notice_doc_requests WHERE item = 'Purchase register for the period'),
                                      'c4100000-0000-0000-0000-000000000002', 'c4300000-0000-0000-0000-000000000001'), 'gone',
            'a request of another client is refused');
SELECT t_eq(client_doc_request_upload((SELECT id FROM notice_doc_requests WHERE item = 'Purchase register for the period'),
                                      'c4100000-0000-0000-0000-000000000001', 'c4300000-0000-0000-0000-000000000001', 'April to June', 'Reader Textiles'),
            'received', 'the upload receives the request');
SELECT t_eq((SELECT status || ' ' || client_note || ' ' || resolved_by_name FROM notice_doc_requests WHERE item = 'Purchase register for the period'),
            'received April to June Reader Textiles (client portal)', 'with the client''s note');
-- Reminders on the E12 ladder: one open request is due today.
UPDATE notice_doc_requests SET due_date = ist_today()
 WHERE id = (SELECT id FROM notice_doc_requests WHERE notice_id = 'c4200000-0000-0000-0000-000000000021' AND status = 'requested' ORDER BY item LIMIT 1);
UPDATE notice_settings SET alerts_mode = 'off';
SELECT t_eq((notice_doc_reminders_run() ->> 'sent')::int, 0, 'alerts off: no reminder is sent');
SELECT t_eq((SELECT max(reminders_sent) FROM notice_doc_requests WHERE notice_id = 'c4200000-0000-0000-0000-000000000021'), 0, 'and none is counted');
UPDATE notice_settings SET alerts_mode = 'preview';
UPDATE notice_alert_rules SET is_active = true WHERE alert_key = 'E12_client_docs';
UPDATE email_templates SET is_active = true WHERE key = 'notice_client_docs';
SELECT t_eq((notice_doc_reminders_run() ->> 'sent')::int, 1, 'a reminder for the notice with requests due');
SELECT t_eq((SELECT max(reminders_sent) FROM notice_doc_requests WHERE notice_id = 'c4200000-0000-0000-0000-000000000021' AND status = 'requested'), 1,
            'counted');
SELECT t_eq((notice_doc_reminders_run() ->> 'notices')::int, 0, 'not again within the cooldown');

-- ── Evidence nobody has built yet (background builds) ──────────────────────
SELECT t_eq((SELECT count(*) FROM reply_evidence_pending(500) WHERE notice_id = 'c4200000-0000-0000-0000-000000000021'), 0::bigint,
            'a notice with an annexure is not pending');
SELECT t_eq((SELECT bool_and(p.form_code IN ('ASMT-10', 'DRC-01A', 'DRC-01B', 'DRC-01C')) FROM reply_evidence_pending(500) p), true,
            'only the forms the acceptance counts');
SELECT t_eq((SELECT count(*) FROM reply_evidence_pending(500) p JOIN gst_notices g ON g.id = p.notice_id
              WHERE g.deleted_at IS NOT NULL OR notice_is_closed(g.staff_status)), 0::bigint, 'only open notices');
SELECT t_eq((SELECT count(*) FROM reply_evidence_pending(1)) <= 1, true, 'the limit holds');

-- ── The status ─────────────────────────────────────────────────────────────
SELECT t_eq((SELECT reply_factory_status() -> 'annexures' ->> 'automatic') IS NOT NULL, true, 'the status reads');
SELECT t_eq((reply_factory_status() -> 'accuracy' ->> 'due_date_exact')::int, 1, 'the confirmed due date counts as exact');
SELECT t_eq((reply_factory_status() -> 'reading' ->> 'issues_portal')::int >= 1, true, 'portal issues are counted');
ROLLBACK;
