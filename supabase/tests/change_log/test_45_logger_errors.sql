-- The logger never loses which row, client and month changed (round 1
-- review): a crafted, deeply nested JSON value is walked only 20 levels deep,
-- and when the logger cannot read a statement it still logs every row with
-- its key, client, month, who and the columns that changed, as fingerprints
-- where large. Writes as PostgREST runs them.
SET search_path = public, extensions;
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app","x-gst-request":"t45-deep"}');

-- 1. ITC Summary with 1,500 levels of padding: the 5.1 change is logged in full.
INSERT INTO itc_summaries (id, client_id, period_month, data)
SELECT '45000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10/2026',
       jsonb_build_object('section4A', '[{"srNo":"5.1","igst":1000}]'::jsonb,
                          'pad', (repeat('{"a":', 1500) || '1' || repeat('}', 1500))::jsonb);
UPDATE itc_summaries
   SET data = jsonb_build_object('section4A', '[{"srNo":"5.1","igst":999999}]'::jsonb,
                                 'pad', (repeat('{"a":', 1500) || '2' || repeat('}', 1500))::jsonb)
 WHERE id = '45000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT data #>> '{section4A,0,igst}' FROM itc_summaries WHERE id = '45000000-0000-0000-0000-000000000001'), '999999', 'the save went through');
SELECT t_eq((SELECT client_id::text || ' ' || period_month || ' ' || actor_name || ' ' || (changed ? '_error')::text
               FROM gst_change_log WHERE row_id = '45000000-0000-0000-0000-000000000001' AND op = 'UPDATE'),
            '20000000-0000-0000-0000-000000000001 10/2026 Esha false', 'logged with its row, client, month and person, no error');
SELECT t_eq((SELECT changed -> 'data' -> 'changes' @> '[{"path": "section4A[5.1].igst", "old": 1000, "new": 999999}]'
               FROM gst_change_log WHERE row_id = '45000000-0000-0000-0000-000000000001' AND op = 'UPDATE'),
            true, 'the figure: 5.1 IGST 1000 -> 999999');
SELECT t_eq((SELECT (e ->> 'deep') || ':' || (e -> 'old' ->> 'summary') || ':' || (length(e ->> 'path') - length(replace(e ->> 'path', '.', ''))) FROM gst_change_log l,
                    jsonb_array_elements(l.changed -> 'data' -> 'changes') e
              WHERE l.row_id = '45000000-0000-0000-0000-000000000001' AND l.op = 'UPDATE' AND e ->> 'path' LIKE 'pad%'),
            'true:true:19', 'the padding: one leaf at 20 levels, kept as fingerprints');
SELECT t_eq((SELECT jsonb_array_length(changed -> 'data' -> 'changes') FROM gst_change_log
              WHERE row_id = '45000000-0000-0000-0000-000000000001' AND op = 'UPDATE'), 2, 'two leaves');
-- 100 and 400 levels: the same.
UPDATE itc_summaries SET data = jsonb_build_object('pad', (repeat('{"b":', 400) || '3' || repeat('}', 400))::jsonb)
 WHERE id = '45000000-0000-0000-0000-000000000001';
UPDATE itc_summaries SET data = jsonb_build_object('pad', (repeat('{"b":', 100) || '4' || repeat('}', 100))::jsonb)
 WHERE id = '45000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE row_id = '45000000-0000-0000-0000-000000000001' AND changed ? '_error')::int, 0,
            'deep documents never make the logger fail');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE row_id = '45000000-0000-0000-0000-000000000001')::int, 4, 'every save logged');
RESET ROLE;

-- 2. A statement the logger cannot read (its client expression divides by
-- zero for one row): each row is still logged with its key, client, month,
-- who and what changed.
CREATE TABLE public.t_odd2 (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, period_month text, n int, note text,
                            payload jsonb, updated_by uuid);
GRANT ALL ON public.t_odd2 TO anon;
SELECT gst_change_log_attach('t_odd2', p_client => '(CASE WHEN r.n = 0 THEN (1 / r.n)::text ELSE r.client_id::text END)::uuid',
                             p_month => '(CASE WHEN r.n = 0 THEN (1 / r.n)::text ELSE r.period_month END)');
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t45-odd"}');
INSERT INTO t_odd2 (id, client_id, period_month, n, note, payload) VALUES
 ('45000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', '09/2026', 0, 'first', ('{"big":"' || repeat('x', 600) || '"}')::jsonb),
 ('45000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000002', '09/2026', 1, 'second', NULL);
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM t_odd2)::int, 2, 'the save went through');
SELECT t_eq((SELECT string_agg(row_id || ' ' || COALESCE(client_id::text, '-') || ' ' || COALESCE(period_month, '-') || ' ' || actor_name
                               || ' ' || (changed ->> '_partial') || ' ' || (changed ->> 'note'), ', ' ORDER BY row_id)
               FROM gst_change_log WHERE table_name = 't_odd2' AND op = 'INSERT'),
            '45000000-0000-0000-0000-000000000011 20000000-0000-0000-0000-000000000001 09/2026 Gita true first, '
            || '45000000-0000-0000-0000-000000000012 20000000-0000-0000-0000-000000000002 09/2026 Gita true second',
            'every row logged with its key, client, month and person');
SELECT t_eq((SELECT (changed ->> '_error') || ':' || (changed -> 'payload' ->> 'summary') FROM gst_change_log
              WHERE table_name = 't_odd2' AND op = 'INSERT' AND row_id = '45000000-0000-0000-0000-000000000011'),
            'division by zero:true', 'with the error, and JSON as a fingerprint');
-- An update the logger cannot read, without a header: the stamp it wrote names the person.
SELECT t_request('anon', NULL);
SET ROLE anon;
UPDATE t_odd2 SET n = 0, note = 'second, changed', updated_by = '10000000-0000-0000-0000-000000000001'
 WHERE id = '45000000-0000-0000-0000-000000000012';
SELECT t_request('anon', '{"x-gst-source":"extension"}');
UPDATE t_odd2 SET note = 'first, changed' WHERE id = '45000000-0000-0000-0000-000000000011';
RESET ROLE;
SELECT t_eq((SELECT string_agg(row_id || ' ' || COALESCE(client_id::text, '-') || ' ' || COALESCE(actor_name, '-') || ' ' || actor_basis
                               || ' ' || (changed -> 'note' ->> 'old') || '->' || (changed -> 'note' ->> 'new'), ', ' ORDER BY id)
               FROM gst_change_log WHERE table_name = 't_odd2' AND op = 'UPDATE'),
            '45000000-0000-0000-0000-000000000012 20000000-0000-0000-0000-000000000002 Sam row second->second, changed, '
            || '45000000-0000-0000-0000-000000000011 20000000-0000-0000-0000-000000000001 - none first->first, changed',
            'updates: the changed columns old and new; who from the header or a written stamp, else no one');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE table_name = 't_odd2' AND (row_id IS NULL OR client_id IS NULL))::int, 0,
            'never a row without its key or client');
DROP TABLE public.t_odd2;
DELETE FROM gst_change_log_tables WHERE table_name = 't_odd2';
