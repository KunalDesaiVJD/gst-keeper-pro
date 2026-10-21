-- Large JSON is kept as a fingerprint (md5, size, keys) and the top-level keys
-- that changed, never whole: GSTR-1 raw_json, the version snapshots, portal
-- pulls. Small JSON (the ITC Summary's data) as the leaves that changed,
-- named by srNo, at most 100. Any JSON over 64 KB is fingerprinted even when
-- not named. A deleted history row is kept whole.
SET search_path = public, extensions;
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app"}');

-- 1. GSTR-1 raw_json: a 1,500-invoice document (~300 KB)
INSERT INTO gstr1_data (id, client_id, period_month, raw_json)
SELECT '70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Sep-26',
       jsonb_build_object('gstin', '24AAAAA0000A1Z5', 'fp', '092026',
         'b2b', (SELECT jsonb_agg(jsonb_build_object('ctin', '24ZZZZZ' || lpad(g::text, 4, '0') || 'Z1Z5',
                   'inv', jsonb_build_array(jsonb_build_object('inum', 'INV-' || g, 'val', g * 118, 'itms',
                     jsonb_build_array(jsonb_build_object('num', 1, 'itm_det', jsonb_build_object('txval', g * 100, 'iamt', g * 18)))))))
                 FROM generate_series(1, 1500) g),
         'hsn', jsonb_build_object('data', jsonb_build_array(jsonb_build_object('hsn_sc', '7308', 'txval', 1000))));
SELECT t_eq((SELECT octet_length(raw_json::text) > 100000 FROM gstr1_data WHERE id = '70000000-0000-0000-0000-000000000001'), true, 'a large document');
SELECT t_eq((SELECT (changed -> 'raw_json' ->> 'summary') || ':' || (changed -> 'raw_json' ->> 'keys') || ':' || ((changed -> 'raw_json' ->> 'bytes')::int > 100000)::text
               FROM gst_change_log WHERE row_id = '70000000-0000-0000-0000-000000000001' AND op = 'INSERT'),
            'true:4:true', 'insert: raw_json as md5, size and key count');
SELECT t_eq((SELECT pg_column_size(changed) < 1000 FROM gst_change_log WHERE row_id = '70000000-0000-0000-0000-000000000001' AND op = 'INSERT'),
            true, 'the log row stays small');
UPDATE gstr1_data SET raw_json = jsonb_set(raw_json, '{hsn,data,0,txval}', '2000') WHERE id = '70000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT changed -> 'raw_json' -> 'keys_changed' FROM gst_change_log
              WHERE row_id = '70000000-0000-0000-0000-000000000001' AND op = 'UPDATE'),
            '["hsn"]'::jsonb, 'update: the top-level keys that changed');
SELECT t_eq((SELECT (changed -> 'raw_json' -> 'old' ->> 'md5') <> (changed -> 'raw_json' -> 'new' ->> 'md5')
               FROM gst_change_log WHERE row_id = '70000000-0000-0000-0000-000000000001' AND op = 'UPDATE'),
            true, 'update: old and new fingerprints differ');
SELECT t_eq((SELECT (changed -> 'raw_json' -> 'new' ->> 'md5') FROM gst_change_log
              WHERE row_id = '70000000-0000-0000-0000-000000000001' AND op = 'UPDATE'),
            (SELECT md5(raw_json::text) FROM gstr1_data WHERE id = '70000000-0000-0000-0000-000000000001'),
            'the fingerprint is the md5 of the document as stored');
DELETE FROM gstr1_data WHERE id = '70000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT changed -> 'raw_json' ->> 'summary' FROM gst_change_log
              WHERE row_id = '70000000-0000-0000-0000-000000000001' AND op = 'DELETE'), 'true', 'delete: fingerprint too');

-- 2. ITC Summary: the leaves that changed, named by srNo
INSERT INTO itc_summaries (id, client_id, period_month, data) VALUES ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '09/2026',
 '{"section4A":[{"srNo":"(1)","particular":"Import of Goods","igst":0,"cgst":0,"sgst":0},{"srNo":"5.1","particular":"ITC for the Month","igst":1000,"cgst":450,"sgst":450}],"section4B":[{"srNo":"(1)","igst":0}]}');
UPDATE itc_summaries SET data = jsonb_set(jsonb_set(data, '{section4A,1,igst}', '1200'), '{section4A,1,reasons}', '"Late bill of Sep"')
 WHERE id = '70000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT changed -> 'data' FROM gst_change_log WHERE row_id = '70000000-0000-0000-0000-000000000002' AND op = 'UPDATE'),
            '{"more": false, "changes": [{"path": "section4A[5.1].igst", "old": 1000, "new": 1200}, {"path": "section4A[5.1].reasons", "old": null, "new": "Late bill of Sep"}]}'::jsonb,
            'ITC data: 5.1 IGST 1000 -> 1200 and the reason added');
-- More than 100 leaves: the first 100 and a flag
UPDATE itc_summaries SET data = jsonb_build_object('rows', (SELECT jsonb_agg(jsonb_build_object('srNo', 'r' || g, 'igst', g)) FROM generate_series(1, 150) g))
 WHERE id = '70000000-0000-0000-0000-000000000002';
UPDATE itc_summaries SET data = jsonb_build_object('rows', (SELECT jsonb_agg(jsonb_build_object('srNo', 'r' || g, 'igst', g + 1)) FROM generate_series(1, 150) g))
 WHERE id = '70000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT jsonb_array_length(changed -> 'data' -> 'changes') || ':' || (changed -> 'data' ->> 'more') FROM gst_change_log
              WHERE row_id = '70000000-0000-0000-0000-000000000002' AND op = 'UPDATE' ORDER BY id DESC LIMIT 1),
            '100:true', 'at most 100 leaves, and a flag that there were more');
-- Over 64 KB, though not named: fingerprinted
UPDATE itc_summaries SET data = jsonb_build_object('rows', (SELECT jsonb_agg(jsonb_build_object('srNo', 'r' || g, 'text', repeat('x', 40) || g)) FROM generate_series(1, 3000) g))
 WHERE id = '70000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT changed -> 'data' ->> 'summary' FROM gst_change_log
              WHERE row_id = '70000000-0000-0000-0000-000000000002' AND op = 'UPDATE' ORDER BY id DESC LIMIT 1),
            'true', 'JSON over 64 KB is fingerprinted');

-- 3. A version snapshot: not logged on insert (it is the record); edited or deleted, it is
RESET ROLE;
INSERT INTO twob_versions (id, client_id, period_month, table_type, version_number, version_data, is_current)
VALUES ('70000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '09/2026', 'bills_not_in_books', 4,
        '{"rows":[{"supplier":"ABC","igst":100}]}', true);
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000001","x-gst-source":"app"}');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE row_id = '70000000-0000-0000-0000-000000000003')::int, 0, 'a new version is its own record');
UPDATE twob_versions SET is_current = false WHERE id = '70000000-0000-0000-0000-000000000003';
UPDATE twob_versions SET version_data = '{"rows":[{"supplier":"ABC","igst":999}]}' WHERE id = '70000000-0000-0000-0000-000000000003';
SELECT t_eq((SELECT string_agg(k, ',' ORDER BY id, k) FROM (SELECT id, jsonb_object_keys(changed) AS k FROM gst_change_log
              WHERE row_id = '70000000-0000-0000-0000-000000000003' AND op = 'UPDATE') x),
            'is_current,version_data', 'a version switched off, and a snapshot edited, are both logged');
DELETE FROM twob_versions WHERE id = '70000000-0000-0000-0000-000000000003';
SELECT t_eq((SELECT changed -> 'version_data' FROM gst_change_log WHERE row_id = '70000000-0000-0000-0000-000000000003' AND op = 'DELETE'),
            '{"rows":[{"supplier":"ABC","igst":999}]}'::jsonb, 'a deleted version is kept whole in the log');
RESET ROLE;
