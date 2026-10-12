-- The officers' book (migration 20261014100000).
BEGIN;
SELECT notice_officer_save('AMITA KANTILAL BAROT State Tax Officer', '+91 98250 12345', 'sto@gst.gov.in', 'Ward 5', NULL, 'Partner');
SELECT t_eq((SELECT mobile FROM notice_officers WHERE name_key = notice_officer_key('Amita Kantilal Barot, State Tax Officer')), '+91 98250 12345',
            'the same officer written another way finds the row');
SELECT notice_officer_save('amita kantilal barot state tax officer', '9825099999', NULL, NULL, NULL, 'Partner');
SELECT t_eq((SELECT count(*) FROM notice_officers), 1::bigint, 'saved again: still one officer');
SELECT t_eq((SELECT mobile || '/' || coalesce(email, '-') FROM notice_officers), '9825099999/-', 'with the new number');
DO $$ BEGIN
  PERFORM notice_officer_save('X Officer', 'call me maybe');
  RAISE EXCEPTION 'a bad number was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;
SELECT t_eq(true, true, 'a mobile that is not a number is refused');
ROLLBACK;
