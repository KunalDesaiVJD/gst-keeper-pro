-- Round 3: the log is written at COMMIT from the rows each save kept. What a
-- savepoint rolls back is neither kept nor logged, what stays is logged once,
-- a write made at COMMIT by another deferred trigger is logged too, and
-- nothing is left waiting. As PostgREST runs it (role anon, the app's header).
SET search_path = public, extensions;
CREATE TEMP TABLE t94_ids (n int PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO t94_ids (n) SELECT g FROM generate_series(1, 9) g;
GRANT SELECT ON t94_ids TO anon;
CREATE OR REPLACE FUNCTION pg_temp.t94(p_n int) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM t94_ids WHERE n = p_n $$;
GRANT EXECUTE ON FUNCTION pg_temp.t94(int) TO anon;

-- 1. A savepoint rolled back takes its rows (and the transaction's mark, when
-- it made it) with it; a later write marks the transaction again.
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t94-a"}');
BEGIN;
SAVEPOINT a;
INSERT INTO bills_not_in_2b (id, client_id, period_month, supplier_name) VALUES (pg_temp.t94(1), '20000000-0000-0000-0000-000000000001', '09/2026', 'ROLLED BACK 1');
ROLLBACK TO SAVEPOINT a;
INSERT INTO bills_not_in_2b (id, client_id, period_month, supplier_name) VALUES (pg_temp.t94(2), '20000000-0000-0000-0000-000000000001', '09/2026', 'KEPT 2');
SAVEPOINT b;
UPDATE bills_not_in_2b SET supplier_name = 'ROLLED BACK RENAME' WHERE id = pg_temp.t94(2);
INSERT INTO bills_not_in_2b (id, client_id, period_month, supplier_name) VALUES (pg_temp.t94(3), '20000000-0000-0000-0000-000000000001', '09/2026', 'ROLLED BACK 3');
ROLLBACK TO SAVEPOINT b;
COMMIT;
SELECT t_eq((SELECT string_agg(op || ' ' || row_label, ', ' ORDER BY id) FROM gst_change_log WHERE request_id = 't94-a'), 'INSERT KEPT 2',
            'only what the transaction kept: the rolled-back insert, rename and insert are not in the log');

-- 2. A function that tries a change and undoes it (an exception block, as a
-- preview does), then saves for real.
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t94-b"}');
DO $$
BEGIN
  BEGIN
    INSERT INTO bills_not_in_2b (id, client_id, period_month, supplier_name) VALUES (pg_temp.t94(4), '20000000-0000-0000-0000-000000000001', '09/2026', 'PREVIEW 4');
    RAISE EXCEPTION 'preview only';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  INSERT INTO bills_not_in_2b (id, client_id, period_month, supplier_name) VALUES (pg_temp.t94(5), '20000000-0000-0000-0000-000000000001', '09/2026', 'SAVED 5');
END $$;
SELECT t_eq((SELECT string_agg(op || ' ' || row_label, ', ' ORDER BY id) FROM gst_change_log WHERE request_id = 't94-b'), 'INSERT SAVED 5',
            'a previewed change undone in the function is not logged; the saved one is');

-- 3. The log written early (SET CONSTRAINTS ... IMMEDIATE), then more saves in
-- the same transaction: each change logged once.
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t94-c"}');
BEGIN;
UPDATE bills_not_in_2b SET input_igst = 1 WHERE id = pg_temp.t94(5);
SET CONSTRAINTS public.gst_change_log_flush IMMEDIATE;
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE request_id = 't94-c')::int, 1, 'written early: the first change is in the log');
SET CONSTRAINTS public.gst_change_log_flush DEFERRED;
UPDATE bills_not_in_2b SET input_igst = 2 WHERE id = pg_temp.t94(5);
UPDATE bills_not_in_2b SET input_igst = 3 WHERE id = pg_temp.t94(5);
COMMIT;
SELECT t_eq((SELECT string_agg(COALESCE(changed -> 'input_igst' ->> 'old', '-') || '>' || (changed -> 'input_igst' ->> 'new'), ', ' ORDER BY id)
               FROM gst_change_log WHERE request_id = 't94-c'), '->1.00, 1.00>2.00, 2.00>3.00', 'then the later ones, each once, in order');
RESET ROLE;

-- 4. A write made at COMMIT by another deferred trigger (after the log was
-- written) is logged too: the log write clears the mark, the late write sets
-- it again, and its own log write runs before the COMMIT ends.
CREATE TABLE public.t94_late (id int PRIMARY KEY);
CREATE FUNCTION public.t94_late_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.bills_not_in_2b SET supplier_name = 'WRITTEN AT COMMIT' WHERE id = (SELECT id FROM t94_ids WHERE n = 5);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER zz_t94_late AFTER INSERT ON public.t94_late DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.t94_late_write();
GRANT ALL ON public.t94_late TO anon;
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app","x-gst-request":"t94-d"}');
BEGIN;
UPDATE bills_not_in_2b SET input_igst = 4 WHERE id = pg_temp.t94(5);
INSERT INTO t94_late VALUES (1);
COMMIT;
SELECT t_eq((SELECT string_agg(x.keys, ', ' ORDER BY x.id) FROM (SELECT l.id, (SELECT string_agg(k, '+' ORDER BY k) FROM jsonb_object_keys(l.changed) k) AS keys
               FROM gst_change_log l WHERE l.request_id = 't94-d') x), 'input_igst, supplier_name',
            'the save, then the write made at COMMIT, both logged with the request');
SELECT t_eq((SELECT string_agg(DISTINCT actor_name, ',') FROM gst_change_log WHERE request_id = 't94-d'), 'Esha', 'by the person of the request');
RESET ROLE;
DROP TABLE public.t94_late;
DROP FUNCTION public.t94_late_write();

-- 5. Nothing waits after a COMMIT or a ROLLBACK.
SET ROLE anon;
BEGIN;
DELETE FROM bills_not_in_2b WHERE id = pg_temp.t94(5);
ROLLBACK;
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM gst_change_log_stage)::int + (SELECT count(*) FROM gst_change_log_pending)::int, 0,
            'no kept row and no mark is left after COMMIT or ROLLBACK');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE row_id = pg_temp.t94(5)::text AND op = 'DELETE')::int, 0, 'a rolled-back delete is not logged');
SELECT t_request('anon', NULL);
