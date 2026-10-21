-- The logger never fails on what a user saves (round 1 review): a crafted,
-- deeply nested JSON value is walked only 20 levels deep. A save whose rows
-- the logger cannot read at all (only a wrong expression of a table's attach
-- could do that; none in the migration can) is refused, never saved untraced
-- (round 2; round 3: the log is written at COMMIT, so the COMMIT fails and
-- the save with it). Writes as PostgREST runs them.
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

-- 2. A save the logger cannot read (its client expression divides by zero
-- for one row) is refused with the error at COMMIT (t_raises runs the
-- COMMIT's log write), and nothing is saved or logged: no change without its
-- trace (the logger opens no subtransaction, so it cannot keep the row and
-- drop its log). A row the logger can read is saved and logged as usual.
CREATE TABLE public.t_odd2 (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, period_month text, n int, note text,
                            payload jsonb, updated_by uuid);
GRANT ALL ON public.t_odd2 TO anon;
SELECT gst_change_log_attach('t_odd2', p_client => '(CASE WHEN r.n = 0 THEN (1 / r.n)::text ELSE r.client_id::text END)::uuid',
                             p_month => '(CASE WHEN r.n = 0 THEN (1 / r.n)::text ELSE r.period_month END)');
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t45-odd"}');
SELECT t_raises($$INSERT INTO t_odd2 (id, client_id, period_month, n, note) VALUES
 ('45000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', '09/2026', 0, 'first'),
 ('45000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000002', '09/2026', 1, 'second')$$,
  'division by zero', 'a statement the logger cannot read is refused with the error');
SELECT t_eq((SELECT count(*) FROM t_odd2)::int, 0, 'nothing of it was saved');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE table_name = 't_odd2')::int, 0, 'and nothing logged');
INSERT INTO t_odd2 (id, client_id, period_month, n, note) VALUES
 ('45000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000002', '09/2026', 1, 'second');
SELECT t_raises($$UPDATE t_odd2 SET n = 0, note = 'second, changed' WHERE id = '45000000-0000-0000-0000-000000000012'$$,
  'division by zero', 'an update the logger cannot read is refused too');
RESET ROLE;
SELECT t_eq((SELECT n || ' ' || note FROM t_odd2), '1 second', 'the row is as it was');
SELECT t_eq((SELECT string_agg(op || ' ' || client_id || ' ' || period_month || ' ' || actor_name, ', ') FROM gst_change_log WHERE table_name = 't_odd2'),
            'INSERT 20000000-0000-0000-0000-000000000002 09/2026 Gita', 'the row the logger could read: saved and logged');
-- The error names the logger, so whoever reads the database log knows why.
DO $$
DECLARE v_ctx text;
BEGIN
  BEGIN
    UPDATE t_odd2 SET n = 0 WHERE id = '45000000-0000-0000-0000-000000000012';
    SET CONSTRAINTS public.gst_change_log_flush IMMEDIATE;  -- the COMMIT's log write, here
  EXCEPTION WHEN division_by_zero THEN
    GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT;
  END;
  PERFORM t_eq(v_ctx ~ 'gst_change_log_for_t_odd2', true, 'the error''s context names the logger of t_odd2');
END $$;
DROP TABLE public.t_odd2;
DROP FUNCTION public.gst_change_log_for_t_odd2(bigint, uuid, text, text, text);
DELETE FROM gst_change_log_tables WHERE table_name = 't_odd2';
