-- Reply options (migration 20261008160000): the hyphen-free wording helpers, options
-- prepared by themselves when a notice arrives or changes, starting a draft from one,
-- and the guard that a reply that cannot be prepared never blocks a sync write.
BEGIN;

-- ── Wording helpers ────────────────────────────────────────────────────────
SELECT t_eq(reply_has_dash('FORM GST DRC-01'), true, 'a hyphen is a dash');
SELECT t_eq(reply_has_dash(E'en – em —'), true, 'so are the Unicode dashes');
SELECT t_eq(reply_has_dash('FORM GST DRC 01 dated 6 October 2026'), false, 'clean text has none');
SELECT t_eq(reply_dehyphen('FY 2023-24, DRC-01 dated 01-04-2023; Rs. 500/- paid'),
            'FY 2023/24, DRC 01 dated 01/04/2023; Rs. 500 paid', 'facts lose their dashes');
SELECT t_eq(reply_inr(12345678.5), 'Rs. 1,23,45,678.50', 'Indian grouping');
SELECT t_eq(reply_inr(999), 'Rs. 999', 'no grouping below a thousand');
SELECT t_eq(reply_inr_words(123456), 'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six only', 'amount in words');
SELECT t_eq(reply_inr_words(250000000.05), 'Rupees Twenty Five Crore and Five Paise only', 'crore and paise');
SELECT t_eq(reply_date_long('2026-04-01'), '1 April 2026', 'long date');
SELECT t_eq(reply_form_name('DRC-01C') || ' | ' || reply_form_name('GSTR-3A'), 'FORM GST DRC 01C | FORM GSTR 3A', 'form names');
SELECT t_eq(reply_form_name('APL-HEARING') IS NULL, true, 'a name that is not a form');
SELECT t_eq(reply_state_act('27AAAAA0000A1Z5'), 'the Maharashtra Goods and Services Tax Act, 2017', 'the State Act from the GSTIN');
SELECT t_eq(reply_state_act('38AAAAA0000A1Z5'), 'the Union Territory Goods and Services Tax Act, 2017', 'Ladakh: the UT Act');

-- ── Nothing with a dash is stored ──────────────────────────────────────────
DO $$ BEGIN
  INSERT INTO reply_templates (key, title, stance, body) VALUES ('zz_dash', 'Show-cause reply', 'contest', 'Body');
  RAISE EXCEPTION 'a title with a hyphen was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO reply_templates (key, title, stance, body) VALUES ('zz_dash', 'Reply', 'contest', E'Para one — para two');
  RAISE EXCEPTION 'a body with an em dash was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  UPDATE reply_issue_types SET para_contest = 'Time-barred' WHERE code = 'ITC_16_4';
  RAISE EXCEPTION 'an issue paragraph with a hyphen was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- ── Templates for the test (the firm's own come from 20261008161000) ──────
DELETE FROM reply_templates;
INSERT INTO reply_templates (key, title, summary, stance, forms, sort, body) VALUES
 ('zz_asmt_explain', 'Explanation of every discrepancy', 'When every difference has a reason.', 'explain', '{ASMT-10}', 10,
  E'To,\nThe {{officer}}\n\nSubject: Reply to {{form_name}} bearing reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}\n\n1. The noticee {{client_name}} (GSTIN {{gstin}}) refers to the notice issued under {{section_text}} proposing {{demand_total_text}}, being {{demand_heads_text}}.\n\n2. The matters raised are:\n{{issues_list}}\n\n{{issues_contest_paras}}\n\nPlace: {{place}}\nDate: {{today_long}}'),
 ('zz_asmt_time', 'Request for more time', 'When documents are still being gathered.', 'adjournment', '{ASMT-10}', 20,
  E'To,\nThe {{officer}}\n\nThe reply to {{form_name}} is due on {{reply_due_long}}. The noticee requests fifteen more days.'),
 ('zz_general', 'General reply', 'For any notice without templates of its own.', 'general', '{}', 90,
  E'To,\nThe {{officer}}\n\nReply to {{form_name}} {{notice_ref}}.');

INSERT INTO clients (id, name, gstin, gst_user_id, inactive_at_hand) VALUES
 ('10c00000-0000-0000-0000-000000000001', 'Options Test Traders', '24OPTNS0000T1Z5', 'opts', false);
UPDATE notice_settings SET reply_place = 'Ahmedabad';
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number,
                         issued_by, financial_year) VALUES
 ('10c00000-0000-0000-0000-0000000000a1', '10c00000-0000-0000-0000-000000000001', 'notices', 'op1', 'Scrutiny Of Returns',
  'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', '2026-09-01', '2026-10-01', 'ZD-OP-1',
  'the Deputy Commissioner of State Tax, Ghatak-12', '2023-24'),
 ('10c00000-0000-0000-0000-0000000000a2', '10c00000-0000-0000-0000-000000000001', 'notices', 'op2', 'Letter',
  'A letter the rules do not know', '2026-09-02', NULL, 'ZD-OP-2', NULL, NULL),
 ('10c00000-0000-0000-0000-0000000000a3', '10c00000-0000-0000-0000-000000000001', 'notices', 'op3', 'Appeal',
  'Appeal admitted (APL-02)', '2026-09-03', NULL, 'ZD-OP-3', NULL, NULL);

-- ── Prepared when the notice arrives ───────────────────────────────────────
SELECT t_eq((SELECT string_agg(template_key, ',' ORDER BY sort) FROM notice_reply_options WHERE notice_id = '10c00000-0000-0000-0000-0000000000a1'),
            'zz_asmt_explain,zz_asmt_time', 'an ASMT-10 gets its form''s replies');
SELECT t_eq((SELECT string_agg(template_key, ',') FROM notice_reply_options WHERE notice_id = '10c00000-0000-0000-0000-0000000000a2'),
            'zz_general', 'an unclassified notice gets the general reply');
SELECT t_eq((SELECT count(*) FROM notice_reply_options WHERE notice_id = '10c00000-0000-0000-0000-0000000000a3'), 0::bigint,
            'a notice that needs no reply gets none');
SELECT t_eq((SELECT count(*) FROM notice_reply_options WHERE reply_has_dash(body) OR body ~ '\{\{'), 0::bigint,
            'no dash and no unfilled placeholder in any reply');
SELECT t_eq((SELECT body ~ 'The Deputy Commissioner of State Tax, Ghatak 12' FROM notice_reply_options WHERE template_key = 'zz_asmt_explain'),
            true, 'the officer, without the article and the dash');
SELECT t_eq((SELECT body ~ 'for the financial year 2023/24' FROM notice_reply_options WHERE template_key = 'zz_asmt_explain'),
            true, 'the financial year without a dash');
SELECT t_eq((SELECT body ~ 'FORM GST ASMT 10 bearing reference number ZD OP 1 dated 1 September 2026 for' FROM notice_reply_options
              WHERE template_key = 'zz_asmt_explain'), true, 'form, reference and date; no DIN clause without a DIN');
SELECT t_eq((SELECT body ~ 'section 61 of the Central Goods and Services Tax Act, 2017 read with the corresponding provision of the Gujarat Goods and Services Tax Act, 2017'
               FROM notice_reply_options WHERE template_key = 'zz_asmt_explain'), true, 'the form''s own section and the State Act');
SELECT t_eq((SELECT body ~ 'proposing the amount proposed in the notice, being the amounts set out therein' FROM notice_reply_options
              WHERE template_key = 'zz_asmt_explain'), true, 'graceful phrases where the notice holds no demand');
SELECT t_eq((SELECT body ~ 'Place: Ahmedabad' FROM notice_reply_options WHERE template_key = 'zz_asmt_explain'), true, 'the firm''s place');

-- ── Kept current: a fact changes, an issue is added ────────────────────────
CREATE TEMP TABLE before_render AS SELECT template_key, inputs_hash FROM notice_reply_options WHERE notice_id = '10c00000-0000-0000-0000-0000000000a1';
UPDATE gst_notices SET remarks = 'a note that no reply uses' WHERE id = '10c00000-0000-0000-0000-0000000000a1';
SELECT t_eq((SELECT count(*) FROM notice_reply_options o JOIN before_render b USING (template_key)
              WHERE o.notice_id = '10c00000-0000-0000-0000-0000000000a1' AND o.inputs_hash = b.inputs_hash), 2::bigint,
            'a change no reply uses leaves the options alone');
UPDATE gst_notices SET demand = '{"cgst": {"tax": 60000, "interest": 5400, "penalty": 6000}, "sgst": {"tax": 60000, "interest": 5400, "penalty": 6000}}',
                       demand_total = 142800, din = 'ZD2409260012345'
 WHERE id = '10c00000-0000-0000-0000-0000000000a1';
SELECT t_eq((SELECT body ~ 'proposing Rs\. 1,42,800 \(Rupees One Lakh Forty Two Thousand Eight Hundred only\), being tax of Rs\. 1,20,000, interest of Rs\. 10,800 and penalty of Rs\. 12,000'
               FROM notice_reply_options WHERE template_key = 'zz_asmt_explain'), true, 'the demand in figures, words and heads');
SELECT t_eq((SELECT body ~ 'dated 1 September 2026, bearing Document Identification Number ZD2409260012345, for' FROM notice_reply_options
              WHERE template_key = 'zz_asmt_explain'), true, 'the DIN once read');
INSERT INTO notice_issues (notice_id, seq, title, amount, issue_code) VALUES
 ('10c00000-0000-0000-0000-0000000000a1', 1, 'ITC claimed in GSTR-3B exceeds GSTR-2B', 90000, 'ITC_2B_V_3B'),
 ('10c00000-0000-0000-0000-0000000000a1', 2, 'Interest on delayed payment', 30000, 'INTEREST_50');
SELECT t_eq((SELECT body ~ E'\\(a\\) ITC claimed in GSTR 3B exceeds GSTR 2B amounting to Rs\\. 90,000;\n\\(b\\) Interest on delayed payment amounting to Rs\\. 30,000\\.'
               FROM notice_reply_options WHERE template_key = 'zz_asmt_explain'), true, 'the issues, lettered');
SELECT t_eq((SELECT body ~ 'Issue \(b\): Interest on delayed payment \(Rs\. 30,000\)' FROM notice_reply_options WHERE template_key = 'zz_asmt_explain'),
            true, 'a paragraph per issue');

-- ── Use one: the next draft, today's facts, the stage moves ────────────────
SELECT t_eq((notice_reply_option_use((SELECT id FROM notice_reply_options WHERE template_key = 'zz_asmt_explain'), NULL, 'Asha') ->> 'version')::int,
            1, 'the first draft');
SELECT t_eq((SELECT d.body = o.body AND d.source_template_key = 'zz_asmt_explain' AND d.status = 'draft'
               FROM notice_drafts d JOIN notice_reply_options o ON o.id = d.source_option_id
              WHERE d.notice_id = '10c00000-0000-0000-0000-0000000000a1'), true, 'it carries the option''s text and source');
SELECT t_eq((SELECT status || '/' || used_by_name FROM notice_reply_options WHERE template_key = 'zz_asmt_explain'), 'used/Asha', 'the option is marked used');
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = '10c00000-0000-0000-0000-0000000000a1'), 'draft', 'the notice moves to draft');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = '10c00000-0000-0000-0000-0000000000a1' AND event_type = 'reply_option_used'),
            1::bigint, 'and the event is on its activity');
SELECT t_eq((notice_reply_option_use((SELECT id FROM notice_reply_options WHERE template_key = 'zz_asmt_time'), NULL, 'Asha') ->> 'version')::int,
            2, 'another option starts the next version');
SELECT t_eq((SELECT status FROM notice_drafts WHERE notice_id = '10c00000-0000-0000-0000-0000000000a1' AND version = 1), 'superseded',
            'the earlier draft is superseded, never overwritten');

-- ── An edited template prepares its options again ──────────────────────────
UPDATE reply_templates SET body = body || E'\n\nThanking you.' WHERE key = 'zz_general';
SELECT t_eq((SELECT version FROM reply_templates WHERE key = 'zz_general'), 2, 'an edit is a new version');
SELECT t_eq((SELECT body ~ 'Thanking you\.$' FROM notice_reply_options o JOIN gst_notices g ON g.id = o.notice_id
              WHERE o.template_key = 'zz_general' AND g.reference_number = 'ZD-OP-2'), true, 'and the options follow it');
-- ── The type needs no reply after all; a closed notice ─────────────────────
SELECT notice_type_set('ASMT-10', 'none', NULL, 'Partner');
SELECT t_eq((SELECT count(*) FROM notice_reply_options WHERE notice_id = '10c00000-0000-0000-0000-0000000000a1' AND status = 'ready'), 0::bigint,
            'its unused options go');
SELECT t_eq((SELECT count(*) FROM notice_reply_options WHERE notice_id = '10c00000-0000-0000-0000-0000000000a1' AND status = 'used'), 2::bigint,
            'the used ones stay with their drafts');
SELECT notice_type_set('ASMT-10', 'critical', NULL, 'Partner');
UPDATE gst_notices SET staff_status = 'Closed', close_reason = 'Test' WHERE id = '10c00000-0000-0000-0000-0000000000a2';
SELECT t_eq(notice_reply_options_refresh('10c00000-0000-0000-0000-0000000000a2'), 0, 'a closed notice is left as it is');
SELECT t_eq(notice_reply_options_refresh('10c00000-0000-0000-0000-0000000000a2', true) >= 1, true, 'unless forced');

-- ── A reply that cannot be prepared never blocks the write ─────────────────
UPDATE gst_notices SET demand = '{"igst": {"tax": "not a number"}}' WHERE id = '10c00000-0000-0000-0000-0000000000a1';
SELECT t_eq((SELECT demand ->> 'igst' FROM gst_notices WHERE id = '10c00000-0000-0000-0000-0000000000a1'), '{"tax": "not a number"}',
            'the notice still saved');

ROLLBACK;
