-- Linked cases seen linked or apart, linked by the numbers they share, suggested
-- otherwise, a person's link and unlink kept (20261024100000).
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('11400000-0000-0000-0000-000000000001', 'Chain Works', '24CHAIN0000C1Z5', 'chainw', 'p1', false),
 ('11400000-0000-0000-0000-000000000002', 'Refund Works', '24REFND0000R1Z5', 'refndw', 'p2', false);

-- 1. An appeal against an order that is only a document in the other case's folder.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, financial_year, amount_of_demand) VALUES
 ('11400000-0000-0000-0000-0000000000a1', '11400000-0000-0000-0000-000000000001', 'notices', 'k1', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 300, 'ZD2401010000001', 'AD2401010000ORG', '2019-20', 500000),
 ('11400000-0000-0000-0000-0000000000a2', '11400000-0000-0000-0000-000000000001', 'notices', 'k2', 'Appeal',
  'Hearing notice issued', ist_today() - 20, 'ZD2401010000003', 'AD2401010000APL', NULL, NULL);
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, reference_number, folder_section, raw_json) VALUES
 ('11400000-0000-0000-0000-000000000001', 'AD2401010000ORG', 'o1', 'ZD240101000007A', 'ORDRS', '{"formNo": "DRC-07", "refdt": "01/01/2026"}'),
 ('11400000-0000-0000-0000-000000000001', 'AD2401010000APL', 'a1', 'AD2401010000099', 'APLCN',
  '{"aplnum": "AD2401010000099", "gstin": "24CHAIN0000C1Z5", "orddtl": {"ordnum": "ZD240101000007A"}}');
SELECT notices_sweep_linked('11400000-0000-0000-0000-000000000001');

SELECT t_eq((SELECT count(*) FROM notice_ref_tokens('24CHAIN0000C1Z5 and ZD240101000007A, DIN 20240156YT0000222E3B')), 1::bigint,
            'a GSTIN and a DIN are not portal numbers; the order number is');
SELECT t_eq((SELECT parent_key || '/' || kind || '/' || source || '/' || via_ref FROM notice_case_links WHERE child_key = 'AD2401010000APL'),
            'AD2401010000ORG/appeal/auto/ZD240101000007A', 'the appeal is linked by itself to the case whose order it names');
SELECT t_eq((SELECT count(*) FROM notice_cases WHERE client_id = '11400000-0000-0000-0000-000000000001'), 1::bigint, 'linked: one chain');
SELECT t_eq((SELECT count(*) FROM notice_cases_flat WHERE client_id = '11400000-0000-0000-0000-000000000001'), 2::bigint, 'apart: both cases');
SELECT t_eq((SELECT root_key || '/' || parent_key || '/' || link_kind FROM notice_cases_flat WHERE case_key = 'AD2401010000APL'),
            'AD2401010000ORG/AD2401010000ORG/appeal', 'the appeal apart says which chain it belongs to');
SELECT t_eq((SELECT root_key FROM notice_cases_flat WHERE case_key = 'AD2401010000ORG'), 'AD2401010000ORG', 'the original is its own root');
SELECT t_eq(jsonb_array_length(notice_case_chain('11400000-0000-0000-0000-000000000001', 'AD2401010000APL') -> 'members'), 2,
            'the chain from either side holds both cases');
SELECT t_eq(notice_case_chain('11400000-0000-0000-0000-000000000001', 'AD2401010000APL') -> 'members' -> 0 -> 'order' ->> 'form', 'DRC-07',
            'the original case is first and holds the DRC-07 order');
SELECT t_eq((SELECT count(DISTINCT x ->> 'own_key')
               FROM jsonb_array_elements(notice_case_items('11400000-0000-0000-0000-000000000001', 'AD2401010000ORG')) x), 2::bigint,
            'the correspondence says which case each item is in');
SELECT t_eq((SELECT (notices_counts -> 'litigation' ->> 'cases')::int FROM (SELECT notice_cases_counts_flat(NULL) AS notices_counts) z) >= 2, true,
            'the counts apart count both cases');

-- 2. A person unlinks: it stays apart through every refresh, until handed back.
SELECT notice_case_link_set('11400000-0000-0000-0000-000000000001', 'AD2401010000APL', NULL, NULL, 'Partner');
SELECT notice_case_links_refresh('11400000-0000-0000-0000-000000000001');
SELECT t_eq((SELECT count(*) FROM notice_case_links WHERE client_id = '11400000-0000-0000-0000-000000000001'), 0::bigint, 'an unlink survives the refresh');
SELECT t_eq((SELECT count(*) FROM notice_cases WHERE client_id = '11400000-0000-0000-0000-000000000001'), 2::bigint, 'two cases again');
SELECT t_eq(jsonb_array_length(notice_case_chain('11400000-0000-0000-0000-000000000001', 'AD2401010000APL') -> 'unlinked'), 1, 'and the chain shows who unlinked it');
SELECT t_eq((SELECT count(*) FROM jsonb_array_elements(notice_case_link_candidates('11400000-0000-0000-0000-000000000001', 'AD2401010000APL'))), 0::bigint,
            'a pair a person unlinked is not suggested again');
SELECT notice_case_link_reset('11400000-0000-0000-0000-000000000001', 'AD2401010000APL');
SELECT t_eq((SELECT source FROM notice_case_links WHERE child_key = 'AD2401010000APL'), 'auto', 'handed back, it is linked by itself again');

-- 3. A partly rejected refund and an appeal whose papers name nothing: suggested, then linked by a person.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, financial_year, amount_of_demand) VALUES
 ('11400000-0000-0000-0000-0000000000b1', '11400000-0000-0000-0000-000000000002', 'notices', 'r1', 'Refunds',
  'Refund Sanction/Rejection Order (RFD-06)', ist_today() - 60, 'ZF2401010000006', 'AA2401010000RFD', '2023-24', NULL),
 ('11400000-0000-0000-0000-0000000000b2', '11400000-0000-0000-0000-000000000002', 'notices', 'r2', 'Appeal',
  'Hearing in the appeal against the refund order', ist_today() - 20, 'ZD2401010000077', 'AD2401010000RAP', '2023-24', NULL),
 ('11400000-0000-0000-0000-0000000000b3', '11400000-0000-0000-0000-000000000002', 'notices', 'r3', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 900, 'ZD2401010000010', 'AD2401010000OLD', '2018-19', 10000);
SELECT notices_sweep_linked('11400000-0000-0000-0000-000000000002');
SELECT t_eq((SELECT count(*) FROM notice_case_links WHERE client_id = '11400000-0000-0000-0000-000000000002'), 0::bigint, 'nothing in common: not linked by itself');
SELECT t_eq(notice_case_link_candidates('11400000-0000-0000-0000-000000000002', 'AD2401010000RAP') -> 0 ->> 'other_key', 'AA2401010000RFD',
            'the refund case is the first suggestion for the appeal');
SELECT t_eq(notice_case_link_candidates('11400000-0000-0000-0000-000000000002', 'AD2401010000RAP') -> 0 ->> 'kind', 'appeal', 'as an appeal');
SELECT t_eq(notice_case_link_candidates('11400000-0000-0000-0000-000000000002', 'AA2401010000RFD') -> 0 ->> 'child_key', 'AD2401010000RAP',
            'and from the refund''s side the appeal is offered, as the child');
SELECT t_eq((SELECT count(*) FROM jsonb_array_elements(notice_case_link_candidates('11400000-0000-0000-0000-000000000002', 'AD2401010000RAP')) x
              WHERE x ->> 'other_key' = 'AD2401010000OLD'), 0::bigint, 'an unrelated old case is not suggested');
SELECT t_eq((SELECT count(*) FROM jsonb_array_elements(notice_case_link_candidates('11400000-0000-0000-0000-000000000002', 'AD2401010000RAP', -1000))), 2::bigint,
            'the picker lists every other case');
SELECT notice_case_link_set('11400000-0000-0000-0000-000000000002', 'AD2401010000RAP', 'AA2401010000RFD', 'appeal', 'Partner');
SELECT t_eq((SELECT track || '/' || notices FROM notice_cases WHERE client_id = '11400000-0000-0000-0000-000000000002' AND case_key = 'AA2401010000RFD'),
            'litigation/2', 'linked, the refund and its appeal are one case');
SELECT t_eq((SELECT count(*) FROM notice_cases_flat WHERE client_id = '11400000-0000-0000-0000-000000000002'), 3::bigint, 'apart, still three cases');
SELECT notice_case_links_refresh('11400000-0000-0000-0000-000000000002');
SELECT t_eq((SELECT source || '/' || reason FROM notice_case_links WHERE child_key = 'AD2401010000RAP'), 'manual/Linked by Partner', 'a person''s link survives the refresh');
DO $$ BEGIN
  PERFORM notice_case_link_set('11400000-0000-0000-0000-000000000002', 'AA2401010000RFD', 'AD2401010000RAP', 'related', 'Partner');
  RAISE EXCEPTION 'no error';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;

-- 4. The appeal's papers name the refund order: linked by itself.
SELECT notice_case_link_set('11400000-0000-0000-0000-000000000002', 'AD2401010000RAP', NULL, NULL, 'Partner');
SELECT notice_case_link_reset('11400000-0000-0000-0000-000000000002', 'AD2401010000RAP');
UPDATE gst_notices SET description = 'Hearing in the appeal against order ZF2401010000006' WHERE id = '11400000-0000-0000-0000-0000000000b2';
SELECT notices_sweep_linked('11400000-0000-0000-0000-000000000002');
SELECT t_eq((SELECT parent_key || '/' || kind || '/' || source FROM notice_case_links WHERE child_key = 'AD2401010000RAP'),
            'AA2401010000RFD/appeal/auto', 'an appeal naming the refund order is linked by itself');
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = '11400000-0000-0000-0000-0000000000b1'), 'appeal', 'and the refund order is in appeal');
SELECT notice_case_link_set('11400000-0000-0000-0000-000000000002', 'AD2401010000RAP', NULL, NULL, 'Partner');
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = '11400000-0000-0000-0000-0000000000b1'), 'order', 'unlinked, the order is an order again');

-- 5. The two views stay in step: the apart view is the linked one plus the chain.
SELECT t_eq((SELECT string_agg(column_name::text, ',' ORDER BY ordinal_position) FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'notice_cases'),
            (SELECT string_agg(column_name::text, ',' ORDER BY ordinal_position) FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'notice_cases_flat'
                AND column_name NOT IN ('root_key', 'parent_key', 'link_kind', 'link_source')),
            'notice_cases_flat has every column of notice_cases, in order');
ROLLBACK;
