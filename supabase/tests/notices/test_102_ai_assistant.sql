-- Notice Response AI Assistant (migration 20261009100000): every document is
-- registered and read from Supabase, replies become paragraph pairs, an admin
-- picks which ones teach the assistant, and the assistant drafts from them.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, inactive_at_hand, ai_consent_at) VALUES
 ('10200000-0000-0000-0000-000000000001', 'Learning Textiles', '24LEARN0000L1Z5', 'learn', false, ist_today() - 30),
 ('10200000-0000-0000-0000-000000000002', 'Example Traders', '24EXAMP0000E1Z5', 'example', false, ist_today() - 30),
 ('10200000-0000-0000-0000-000000000003', 'No Consent Co', '24NOCON0000N1Z5', 'nocon', false, NULL);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, pdf_url) VALUES
 ('10200000-0000-0000-0000-0000000000a1', '10200000-0000-0000-0000-000000000001', 'notices', 'l1', 'Scrutiny Of Returns',
  'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', ist_today() - 400, 'ZD-ASMT-1', 'AD-CASE-1',
  'https://x.supabase.co/storage/v1/object/public/return-pdfs/l1.pdf'),
 ('10200000-0000-0000-0000-0000000000a2', '10200000-0000-0000-0000-000000000002', 'notices', 'e1', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 5, 'ZD-SCN-2', 'AD-CASE-2',
  'https://x.supabase.co/storage/v1/object/public/return-pdfs/e1.pdf'),
 ('10200000-0000-0000-0000-0000000000a3', '10200000-0000-0000-0000-000000000003', 'notices', 'n1', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 5, 'ZD-SCN-3', 'AD-CASE-3',
  'https://x.supabase.co/storage/v1/object/public/return-pdfs/n1.pdf'),
 ('10200000-0000-0000-0000-0000000000a4', '10200000-0000-0000-0000-000000000001', 'notices', 'l2', 'Notice',
  'Notice to return defaulter u/s 46 for not filing return', ist_today() - 20, 'ZA-3A-1', NULL,
  'https://x.supabase.co/storage/v1/object/public/return-pdfs/l2.pdf');
SELECT t_eq((SELECT form_code FROM gst_notices WHERE id = '10200000-0000-0000-0000-0000000000a1'), 'ASMT-10', 'fixture: ASMT-10');

-- ── Settings ───────────────────────────────────────────────────────────────
SELECT t_eq((SELECT runner || '/' || consent_scope || '/' || read_backfill || '/' || read_documents || '/' || doc_effort || '/' ||
                    assist_daily_cap_usd || '/' || learning_auto_include FROM ai_settings),
            'edge/consented/true/true/low/5/false', 'ships: the Edge runner, consent per client, every document, examples picked by an admin');
SELECT t_eq(ai_read_allowed('10200000-0000-0000-0000-000000000001'), 'off', 'nothing is read while reading is off');
UPDATE ai_settings SET read_enabled = true;
SELECT t_eq(ai_read_allowed('10200000-0000-0000-0000-000000000001'), NULL::text, 'consent on file: may be read');
SELECT t_eq(ai_read_allowed('10200000-0000-0000-0000-000000000003'), 'no_consent', 'no consent: not read');
UPDATE ai_settings SET consent_scope = 'all_clients';
SELECT t_eq(ai_read_allowed('10200000-0000-0000-0000-000000000003'), NULL::text, 'consent scope every client: read');
UPDATE clients SET ai_opt_out = true WHERE id = '10200000-0000-0000-0000-000000000003';
SELECT t_eq(ai_read_allowed('10200000-0000-0000-0000-000000000003'), 'opted_out', 'an opt-out still wins');
UPDATE clients SET ai_opt_out = false WHERE id = '10200000-0000-0000-0000-000000000003';
UPDATE ai_settings SET consent_scope = 'consented', read_enabled = false;

-- ── Registering the case folder ────────────────────────────────────────────
INSERT INTO gst_case_folder_items (id, client_id, case_id, portal_key, reference_number, folder_section, raw_json, attachments) VALUES
 ('10200000-0000-0000-0000-0000000000f1', '10200000-0000-0000-0000-000000000001', 'AD-CASE-1', 'f1', 'ZD-ASMT-1', 'NOTCE', '{}'::jsonb,
  '[{"label": "ASMT10.pdf", "url": "https://x.supabase.co/storage/v1/object/public/return-pdfs/f1-asmt10.pdf"},
    {"label": "Annexure A.pdf", "url": "https://x.supabase.co/storage/v1/object/public/return-pdfs/f1-annex.pdf"}]'::jsonb),
 ('10200000-0000-0000-0000-0000000000f2', '10200000-0000-0000-0000-000000000001', 'AD-CASE-1', 'f2', 'ZD-REPLY-1', 'REPLY',
  '{"reply": {"ntcno": "ZD-ASMT-1", "reason": "Reply to ASMT 10 with reconciliation", "maindocs": [{"docName": "REPLY.pdf"}]}}'::jsonb,
  '[{"label": "REPLY.pdf", "url": "https://x.supabase.co/storage/v1/object/public/return-pdfs/f2-reply.pdf"},
    {"label": "SALES REGISTER.pdf", "url": "https://x.supabase.co/storage/v1/object/public/return-pdfs/f2-sales.pdf"}]'::jsonb),
 ('10200000-0000-0000-0000-0000000000f3', '10200000-0000-0000-0000-000000000001', 'AD-CASE-1', 'f3', 'ZD-ORD-1', 'ORDRS', '{}'::jsonb,
  '[{"label": "ASMT12.pdf", "url": "https://x.supabase.co/storage/v1/object/public/return-pdfs/f3-order.pdf"}]'::jsonb),
 ('10200000-0000-0000-0000-0000000000f4', '10200000-0000-0000-0000-000000000001', 'AD-CASE-9', 'f4', 'ZR-APP-1', 'APLCN', '{}'::jsonb,
  '[{"label": "GST RFD-01W.pdf", "url": "https://x.supabase.co/storage/v1/object/public/return-pdfs/f4-app.pdf"},
    {"label": "notes.txt", "url": "https://x.supabase.co/storage/v1/object/public/return-pdfs/f4-notes.txt"}]'::jsonb);
SELECT t_eq((SELECT string_agg(label || ':' || role || ':' || priority, ' ' ORDER BY priority DESC, label)
               FROM ai_documents WHERE client_id = '10200000-0000-0000-0000-000000000001' AND source = 'folder'),
            'REPLY.pdf:reply:40 ASMT12.pdf:order:25 ASMT10.pdf:notice:22 Annexure A.pdf:notice:22 SALES REGISTER.pdf:reply_support:12 GST RFD-01W.pdf:application:6',
            'each PDF registered by its section: the reply first, its annexures low, a notice copy after the notice readings');
SELECT t_eq((SELECT notice_id::text || '/' || (context ->> 'reply_reason') FROM ai_documents WHERE label = 'REPLY.pdf'),
            '10200000-0000-0000-0000-0000000000a1/Reply to ASMT 10 with reconciliation', 'the reply knows its notice and the reason typed on the portal');
SELECT t_eq((SELECT count(*) FROM ai_documents WHERE status = 'queued' AND client_id = '10200000-0000-0000-0000-000000000001'), 6::bigint,
            'all queued');
UPDATE gst_case_folder_items SET deleted_at = now() WHERE id = '10200000-0000-0000-0000-0000000000f4';
SELECT t_eq((SELECT status || '/' || reason_class FROM ai_documents WHERE label = 'GST RFD-01W.pdf'), 'cancelled/deleted',
            'an item deleted on the portal is not read');
SELECT t_eq((ai_sync() ->> 'documents')::int, 0, 'sync finds nothing the triggers missed');

-- ── Positions typed by staff are kept as examples ──────────────────────────
INSERT INTO notice_issues (id, notice_id, seq, title, detail, amount, status, source, issue_code, created_by_name) VALUES
 ('10200000-0000-0000-0000-0000000000b1', '10200000-0000-0000-0000-0000000000a2', 1, 'Excess ITC over GSTR 2A',
  'ITC availed in GSTR 3B exceeds the credit reflected in GSTR 2A for the year', 120000, 'open', 'manual', 'ITC_2A_V_3B', 'Partner'),
 ('10200000-0000-0000-0000-0000000000b2', '10200000-0000-0000-0000-0000000000a2', 2, 'Late fee',
  'Late fee for delayed filing of GSTR 3B', 2000, 'open', 'manual', 'LATE_FEE_47', 'Partner');
SELECT t_eq((SELECT count(*) FROM ai_learning_pairs WHERE notice_id = '10200000-0000-0000-0000-0000000000a2'), 0::bigint, 'no position, no example');
UPDATE notice_issues SET position = 'The credit was availed on invoices of registered suppliers who filed their GSTR 1 late; the difference stands reconciled supplier wise.'
 WHERE id = '10200000-0000-0000-0000-0000000000b1';
SELECT t_eq((SELECT origin || '/' || issue_code || '/' || included || '/' || verified || '/' || (allegation LIKE 'Excess ITC over GSTR 2A%')
               FROM ai_learning_pairs WHERE issue_id = '10200000-0000-0000-0000-0000000000b1'),
            'position/ITC_2A_V_3B/false/true/true', 'a typed position is the firm''s answer to its issue, not yet chosen');
SELECT t_eq((SELECT source || '/' || status || '/' || role FROM ai_documents WHERE source_ref = 'workspace:10200000-0000-0000-0000-0000000000a2'),
            'workspace/done/reply', 'under the notice''s workspace response, never sent to be read');
UPDATE notice_issues SET position = 'ok' WHERE id = '10200000-0000-0000-0000-0000000000b1';
SELECT t_eq((SELECT count(*) FROM ai_learning_pairs WHERE issue_id = '10200000-0000-0000-0000-0000000000b1'), 0::bigint,
            'a position cleared (under 20 characters) is forgotten');
UPDATE notice_issues SET position = 'The credit was availed on invoices of registered suppliers who filed their GSTR 1 late; the difference stands reconciled supplier wise.'
 WHERE id = '10200000-0000-0000-0000-0000000000b1';

-- ── Drafts, once sent for review ───────────────────────────────────────────
INSERT INTO notice_drafts (id, notice_id, version, body, status, author_name) VALUES
 ('10200000-0000-0000-0000-0000000000d1', '10200000-0000-0000-0000-0000000000a2', 1, 'Working text', 'draft', 'Staff');
SELECT t_eq((SELECT count(*) FROM ai_documents WHERE source = 'draft'), 0::bigint, 'a draft still being written is not read');
UPDATE notice_drafts SET status = 'in_review', body = 'Para 1. The credit is supported by invoices.' WHERE id = '10200000-0000-0000-0000-0000000000d1';
SELECT t_eq((SELECT role || '/' || status || '/' || priority || '/' || body FROM ai_documents WHERE source_ref = 'draft:10200000-0000-0000-0000-0000000000a2'),
            'reply/queued/45/Para 1. The credit is supported by invoices.', 'sent for review: read as a response');

-- ── The background backfill and the claim ──────────────────────────────────
UPDATE ai_settings SET read_enabled = true;
SELECT t_eq((ai_sync() ->> 'notices')::int, 2, 'every notice needing a reply, with a PDF and consent, is queued (not GSTR-3A, not without consent)');
SELECT t_eq((SELECT string_agg(g.reference_number || ':' || x.priority, ' ' ORDER BY g.reference_number)
               FROM notice_extractions x JOIN gst_notices g ON g.id = x.notice_id WHERE x.source = 'ai' AND g.client_id::text LIKE '10200000%'),
            'ZD-ASMT-1:45 ZD-SCN-2:45', 'in the background (30), but a case whose reply or draft waits goes first (45)');
SELECT t_eq(notice_read_claim('office-pc-1'), NULL::jsonb, 'the office agent claims nothing while the Edge Function is the runner');
UPDATE ai_settings SET runner = 'office_agent';
SELECT t_eq(ai_claim_next('edge:1') ->> 'idle', 'runner', 'and the Edge Function nothing while the office agent is');
UPDATE ai_settings SET runner = 'edge';

DO $$
DECLARE j jsonb; k jsonb; d jsonb;
BEGIN
  j := ai_claim_next('edge:1');
  PERFORM t_eq(j ->> 'kind' || ':' || (j ->> 'reference_number'), 'notice:ZD-SCN-2', 'a notice first; the newest of equals');
  PERFORM t_eq((j ->> 'max_pages')::int || '/' || (j ->> 'effort'), '60/high', 'at the notice settings');
  PERFORM notice_read_finish((j ->> 'extraction_id')::uuid, 'edge:1', 'failed', NULL, NULL, 'test', 'test');
  k := ai_claim_next('edge:1');
  PERFORM t_eq(k ->> 'reference_number', 'ZD-ASMT-1', 'then the ASMT-10');
  d := ai_claim_next('edge:1');
  PERFORM t_eq(d ->> 'kind' || ':' || (d ->> 'document_label'), 'document:Reply draft v1', 'then the draft (its notice is read)');
  PERFORM t_eq(d ->> 'body', 'Para 1. The credit is supported by invoices.', 'a draft is sent as its text');
  PERFORM ai_document_finish((d ->> 'document_id')::uuid, 'edge:1', 'retry', NULL, NULL, 'rate limited', 'rate_limited');
  PERFORM t_eq((SELECT status || '/' || (not_before > now()) FROM ai_documents WHERE id = (d ->> 'document_id')::uuid), 'queued/true',
               'a retry waits');
  d := ai_claim_next('edge:1');
  PERFORM t_eq(d ->> 'document_label' || '/' || (d ->> 'effort'), 'ASMT12.pdf/low',
               'the order next, at the document effort: the reply waits while its notice is read');
  PERFORM ai_document_finish((d ->> 'document_id')::uuid, 'edge:1', 'done',
    '{"doc_kind": "order", "title": "ASMT 12 order", "summary": "Proceedings dropped.", "outcome": "dropped", "doc_date": "2025-12-01", "paragraphs": [], "key_facts": [], "pages": 2, "text_layer": true, "document_sha256": "sha-order"}'::jsonb,
    '{"input_tokens": 10000, "output_tokens": 1000, "status": "ok"}'::jsonb);
  PERFORM t_eq((SELECT status || '/' || outcome || '/' || doc_date FROM ai_documents WHERE id = (d ->> 'document_id')::uuid),
               'done/dropped/2025-12-01', 'the order''s reading is kept');
  PERFORM t_eq((SELECT cost_usd FROM ai_audit_log WHERE purpose = 'doc_read' ORDER BY id DESC LIMIT 1), 0.06::numeric,
               'its cost is logged (10k in at $4, 1k out at $20)');
  -- The ASMT-10 reading finishes with its paragraphs.
  PERFORM notice_read_finish((k ->> 'extraction_id')::uuid, 'edge:1', 'done',
    '{"fields": {}, "issues": [{"title": "Excess ITC over GSTR 2A", "detail": "ITC in 3B exceeds 2A", "text": "Para 2. On scrutiny it is seen that ITC availed in GSTR 3B exceeds GSTR 2A by Rs. 1,20,000.", "issue_code": "ITC_2A_V_3B", "amount": 120000, "quote_ok": true, "page": 1, "quote": "exceeds GSTR 2A"}], "checks": {}, "detail": {"summary": "ASMT-10"}, "pages": 2, "text_layer": true, "document_sha256": "sha-notice", "model": "claude-opus-5-5"}'::jsonb,
    '{"input_tokens": 1000, "output_tokens": 100, "status": "ok"}'::jsonb);
  d := ai_claim_next('edge:1');
  PERFORM t_eq(d ->> 'document_label', 'REPLY.pdf', 'now the reply');
  PERFORM t_eq(d -> 'case_paragraphs' -> 0 ->> 'text', 'Para 2. On scrutiny it is seen that ITC availed in GSTR 3B exceeds GSTR 2A by Rs. 1,20,000.',
               'with the notice''s paragraphs as read');
  PERFORM t_eq(d -> 'context' ->> 'reply_reason', 'Reply to ASMT 10 with reconciliation', 'and what was typed on the portal');
  PERFORM t_eq(ai_document_hash((d ->> 'document_id')::uuid, 'edge:1', 'sha-reply') ->> 'duplicate', 'false', 'a new file');
  PERFORM t_eq((ai_document_finish((d ->> 'document_id')::uuid, 'edge:1', 'done',
    '{"doc_kind": "reply", "title": "Reply to ASMT 10", "summary": "Explains the 2A difference.", "paragraphs": [{"kind": "response", "text": "The difference arose as suppliers filed late."}],
      "pairs": [{"notice_id": "10200000-0000-0000-0000-0000000000a1", "seq": 1, "issue_code": "ITC_2A_V_3B", "issue_title": "Excess ITC over GSTR 2A",
                 "allegation": "Para 2. On scrutiny it is seen that ITC availed in GSTR 3B exceeds GSTR 2A by Rs. 1,20,000.",
                 "response": "The difference arose because the suppliers filed their GSTR 1 after the due date; the credit is reconciled invoice wise in Annexure A.", "page": 1, "verified": true},
                {"seq": 2, "issue_code": "NOT_A_CODE", "allegation": "Interest under section 50.", "response": "Interest is paid by DRC 03.", "verified": false},
                {"allegation": "", "response": "dropped"}],
      "pages": 3, "text_layer": true, "document_sha256": "sha-reply"}'::jsonb,
    '{"input_tokens": 5000, "output_tokens": 500, "status": "ok"}'::jsonb) ->> 'pairs')::int, 2, 'the reply''s pairs are kept (an empty one is not)');
  -- Copies are not read twice.
  d := ai_claim_next('edge:1');
  PERFORM t_eq(d ->> 'role', 'notice', 'the notice copies next');
  PERFORM t_eq(ai_document_hash((d ->> 'document_id')::uuid, 'edge:1', 'sha-notice') ->> 'of', 'notice', 'a copy of the notice PDF already read');
  PERFORM t_eq((SELECT status || '/' || reason_class FROM ai_documents WHERE id = (d ->> 'document_id')::uuid), 'skipped/same_as_notice', 'is skipped');
  d := ai_claim_next('edge:1');
  PERFORM t_eq(ai_document_hash((d ->> 'document_id')::uuid, 'edge:1', 'sha-order') ->> 'duplicate', 'true', 'the order''s file again: a duplicate');
  PERFORM t_eq(ai_document_finish((d ->> 'document_id')::uuid, 'edge:1', 'done', '{}'::jsonb) ->> 'error', 'not_yours', 'a skipped job cannot be finished');
END $$;
SELECT t_eq((SELECT string_agg(origin || ':' || issue_code || ':' || coalesce(form_code, '-') || ':' || included, ' ' ORDER BY seq)
               FROM ai_learning_pairs WHERE document_id = (SELECT id FROM ai_documents WHERE label = 'REPLY.pdf')),
            'portal_reply:ITC_2A_V_3B:ASMT-10:false portal_reply:OTHER:ASMT-10:false', 'filed reply pairs, with the notice''s form; unknown codes are OTHER; not yet chosen');
-- ── The admin chooses ──────────────────────────────────────────────────────
SELECT t_eq((SELECT string_agg(source || ':' || phase || ':' || pairs || ':' || pairs_included, ' ' ORDER BY source)
               FROM ai_learning_responses WHERE client_id::text LIKE '10200000%'),
            'draft:ongoing:0:0 folder:past:2:0 workspace:ongoing:1:0', 'every response, past (filed) or ongoing, with its pairs');
SELECT t_eq(ai_learning_select(ARRAY(SELECT id FROM ai_documents WHERE label = 'REPLY.pdf'), true, 'Partner'), 2, 'a filed reply chosen');
SELECT t_eq((SELECT bool_and(included) AND bool_and(decided_by_name = 'Partner') FROM ai_learning_pairs
              WHERE document_id = (SELECT id FROM ai_documents WHERE label = 'REPLY.pdf')), true, 'all its pairs teach the assistant');
SELECT t_eq(ai_learning_select_where(ARRAY['10200000-0000-0000-0000-000000000002'::uuid], 'ongoing', true, 'Partner'), 1,
            'in bulk: a client''s ongoing responses');
SELECT t_eq(ai_learning_pair_set(ARRAY(SELECT id FROM ai_learning_pairs WHERE issue_code = 'OTHER' AND origin = 'portal_reply'), false, 'Partner'), 1,
            'one pair left out');
SELECT t_eq((SELECT count(*) FROM ai_learning_pairs WHERE included), 2::bigint, 'two examples');

-- ── Examples for a new paragraph ───────────────────────────────────────────
SELECT t_eq((SELECT string_agg(origin, ',' ORDER BY score DESC) FROM ai_learning_examples(
               'ITC availed in GSTR 3B exceeds the amount reflected in GSTR 2A', 'ITC_2A_V_3B', 'ASMT-10', NULL, 5)),
            'portal_reply,position', 'the closest first (same words, code and form)');
SELECT t_eq((SELECT count(*) FROM ai_learning_examples('ITC availed in GSTR 3B exceeds GSTR 2A', 'ITC_2A_V_3B', NULL,
               '10200000-0000-0000-0000-0000000000a2', 5)), 1::bigint, 'not the notice''s own answer');
SELECT t_eq((SELECT count(*) FROM ai_learning_examples('Interest under section 50', NULL, NULL, NULL, 5)), 0::bigint,
            'pairs left out are never given');
SELECT t_eq((SELECT count(*) FROM ai_learning_examples('', 'LATE_FEE_47', NULL, NULL, 5)), 0::bigint, 'nothing for a code nobody answered');

-- ── The assistant ──────────────────────────────────────────────────────────
SELECT t_eq(ai_assist_begin('10200000-0000-0000-0000-0000000000a3', 'draft') ->> 'error', 'no_consent', 'no consent: no assistant');
SELECT t_eq(ai_assist_begin('10200000-0000-0000-0000-0000000000a2', 'ask') ->> 'error', 'no_question', 'a question is needed to ask');
DO $$
DECLARE b jsonb; f jsonb;
BEGIN
  b := ai_assist_begin('10200000-0000-0000-0000-0000000000a2', 'draft', NULL, NULL, NULL, 'Staff');
  PERFORM t_eq(b ->> 'error', NULL::text, 'a draft starts');
  PERFORM t_eq(jsonb_array_length(b -> 'context' -> 'issues'), 2, 'with the notice''s issues');
  PERFORM t_eq(b -> 'context' -> 'examples' -> 0 ->> 'origin', 'portal_reply', 'and the chosen examples closest to them');
  PERFORM t_eq((SELECT count(*) FROM jsonb_array_elements(b -> 'context' -> 'examples') e WHERE e ->> 'id' IN
                  (SELECT id::text FROM ai_learning_pairs WHERE NOT included)), 0::bigint, 'never one left out');
  PERFORM t_eq(b -> 'context' -> 'draft' ->> 'status', 'in_review', 'and the latest draft');
  PERFORM t_eq(b -> 'settings' ->> 'effort', 'high', 'at the assistant''s effort');
  f := ai_assist_finish((b ->> 'run_id')::uuid, 'done',
    jsonb_build_object('paragraphs', jsonb_build_array(
      jsonb_build_object('issue_seq', 1, 'heading', 'Excess ITC — GSTR-2A', 'text', 'The credit for 2019-20 is reconciled; suppliers filed late.',
                         'examples_used', jsonb_build_array(b -> 'context' -> 'examples' -> 0 ->> 'id', '00000000-0000-0000-0000-000000000000')))),
    '{"input_tokens": 20000, "output_tokens": 2000, "status": "ok"}'::jsonb);
  PERFORM t_eq(f ->> 'status', 'done', 'the answer is kept');
  PERFORM t_eq(f -> 'output' -> 'paragraphs' -> 0 ->> 'heading', 'Excess ITC, GSTR 2A', 'without hyphens or dashes, as every reply');
  PERFORM t_eq(f ->> 'answer', E'Excess ITC, GSTR 2A\nThe credit for 2019/20 is reconciled; suppliers filed late.', 'its text, ready to use');
  PERFORM t_eq(jsonb_array_length(f -> 'examples_used'), 1, 'only examples it was given count as used');
  PERFORM t_eq((SELECT uses FROM ai_learning_pairs WHERE id = (b -> 'context' -> 'examples' -> 0 ->> 'id')::uuid), 1, 'counted on the example');
  PERFORM t_eq(ai_assist_spend_today_usd(), 0.12::numeric, 'the assistant''s own spend');
  PERFORM t_eq(ai_assist_feedback((b ->> 'run_id')::uuid, 'used',
    jsonb_build_array(jsonb_build_object('issue_id', '10200000-0000-0000-0000-0000000000b1',
                                         'text', 'The credit for 2019/20 is reconciled supplier wise; the suppliers filed GSTR 1 late.'))), 1,
               'used as edited: one example');
  PERFORM t_eq((SELECT origin || '/' || (ai_text LIKE 'The credit for 2019/20 is reconciled; suppliers%') || '/' || response
                  FROM ai_learning_pairs WHERE issue_id = '10200000-0000-0000-0000-0000000000b1' AND origin = 'assistant_edit'),
               'assistant_edit/true/The credit for 2019/20 is reconciled supplier wise; the suppliers filed GSTR 1 late.',
               'the firm''s final words, with what the assistant had suggested');
END $$;
UPDATE ai_settings SET assist_daily_cap_usd = 0.1;
SELECT t_eq(ai_assist_begin('10200000-0000-0000-0000-0000000000a2', 'ask', NULL, 'What is due?') ->> 'error', 'capped',
            'over the assistant''s cap: no more today');
UPDATE ai_settings SET assist_daily_cap_usd = 5;
SELECT t_eq((ai_assist_finish((ai_assist_begin('10200000-0000-0000-0000-0000000000a2', 'ask', NULL, 'What is due?') ->> 'run_id')::uuid,
              'failed', NULL, NULL, 'The model declined.', 'refused')) ->> 'status', 'failed', 'a failed run says so');

-- ── The runner's lease and the cron tick ───────────────────────────────────
SELECT t_eq((ai_runner_begin('edge:a', 140, false) ->> 'lease')::boolean, false, 'no key: no lease');
SELECT t_eq((SELECT last_error FROM ai_runner_status), 'No ANTHROPIC_API_KEY secret is set for the Edge Functions.', 'and it says why');
SELECT t_eq((ai_runner_begin('edge:a', 140, true) ->> 'lease')::boolean, true, 'with a key: the lease');
SELECT t_eq((ai_runner_begin('edge:b', 140, true) ->> 'lease')::boolean, false, 'a second run waits');
SELECT t_eq(ai_tick_dispatch(), false, 'the cron does not wake a second run');
DO $$ BEGIN PERFORM ai_runner_end('edge:a', 3); END $$;
SELECT t_eq((SELECT lease_until IS NULL AND last_error IS NULL FROM ai_runner_status), true, 'the lease is given back; work clears the error');
SELECT t_eq(ai_tick_dispatch(), true, 'work waiting: the cron wakes the function');
SELECT t_eq((SELECT count(*) FROM cron.job WHERE jobname = 'notice-ai-tick' AND schedule = '*/2 * * * *'), 1::bigint, 'every two minutes');
UPDATE ai_settings SET read_enabled = false;
SELECT t_eq(ai_tick_dispatch(), false, 'reading off: never');
SELECT t_eq(ai_claim_next('edge:1') ->> 'idle', 'off', 'and nothing is claimed');
UPDATE ai_settings SET read_enabled = true;

-- Work left by a stopped run goes back on the queue.
UPDATE ai_documents SET status = 'running', agent_id = 'edge:dead', claimed_at = now() - interval '20 minutes', attempts = 1
 WHERE label = 'SALES REGISTER.pdf';
SELECT t_eq(ai_jobs_reap(), 1, 'a stale job is taken back');
SELECT t_eq((SELECT status FROM ai_documents WHERE label = 'SALES REGISTER.pdf'), 'queued', 'and queued again');

-- ── Requests and the page's numbers ────────────────────────────────────────
SELECT t_eq(ai_documents_request('10200000-0000-0000-0000-0000000000a1') >= 1, true, 'read this case''s documents now');
SELECT t_eq((SELECT min(priority) FROM ai_documents WHERE case_id = 'AD-CASE-1' AND status = 'queued'), 70, 'first in the queue');
SELECT t_eq((SELECT (s -> 'documents' ->> 'done')::int || '/' || (s -> 'learning' ->> 'pairs_included') || '/' || (s -> 'runner' ->> 'key_ok')
               FROM (SELECT ai_read_status() AS s) x), '2/3/true', 'the AI page''s numbers (the edited paragraph joined its chosen response)');
ROLLBACK;
