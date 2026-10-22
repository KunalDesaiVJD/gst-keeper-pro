-- Round 1, defect 1: a filed return stays on its client, period and return
-- type. Moving it (a plain PATCH of client_id, period_month or return_type)
-- would file another month or client with this one's ARN, date and PDF, and
-- moving it to a throwaway client and deleting that client destroyed it
-- without a trace. Every request as PostgREST runs it (anon).
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/GSTR-3B-AB240826123456X.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'pulled');

SELECT t_raises($$UPDATE public.filing_status SET period_month = '09/2026' WHERE arn = 'AB240826123456X'$$,
  'stays on its client, period and return type', 'a filed row is not moved to another period');
SELECT t_raises($$UPDATE public.filing_status SET client_id = '44444444-4444-4444-4444-444444444444' WHERE arn = 'AB240826123456X'$$,
  'stays on its client, period and return type', 'a filed row is not moved to another client');
SELECT t_raises($$UPDATE public.filing_status SET return_type = 'GSTR-3B (Q)' WHERE arn = 'AB240826123456X'$$,
  'stays on its client, period and return type', 'a filed row is not moved to another return type');
-- Freeing the target slot first changes nothing.
INSERT INTO public.filing_status (client_id, return_type, period_month, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'Prepared');
DELETE FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '09/2026';
SELECT t_raises($$UPDATE public.filing_status SET period_month = '09/2026' WHERE arn = 'AB240826123456X'$$,
  'stays on its client', 'still not moved into a freed slot');

-- An unlocked row (not Filed, ARN kept) holds the return too.
RESET ROLE;
SELECT public.filing_status_unlock('00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', '08/2026');
SET LOCAL ROLE anon;
SELECT t_raises($$UPDATE public.filing_status SET period_month = '07/2026' WHERE arn = 'AB240826123456X'$$,
  'stays on its client', 'an unlocked row holding the ARN is not moved');

-- The throwaway-client trick: the move is refused, and a DELETE of its own
-- is refused.
INSERT INTO public.clients (id, gstin, name) VALUES ('55555555-5555-5555-5555-555555555555', '24AAAAA0000A1Z5', 'TEMP');
SELECT t_raises($$UPDATE public.filing_status SET client_id = '55555555-5555-5555-5555-555555555555' WHERE arn = 'AB240826123456X'$$,
  'stays on its client', 'not moved to a throwaway client');
DELETE FROM public.clients WHERE id = '55555555-5555-5555-5555-555555555555';
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE arn = 'AB240826123456X'), 1, 'the filed row is still there');
SELECT t_raises($$DELETE FROM public.filing_status WHERE arn = 'AB240826123456X'$$, 'cannot be deleted', 'no DELETE of its own');

-- A row holding nothing filed can still be moved, and the move is logged
-- with where it came from.
INSERT INTO public.filing_status (client_id, return_type, period_month, status, remarks)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-1', '07/2026', 'Data Pending', 'typed under the wrong month');
UPDATE public.filing_status SET period_month = '06/2026' WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-1' AND period_month = '07/2026';
SELECT t_eq((SELECT event || '/' || period_month || '/' || (detail->'moved_from'->>'period_month') FROM public.filing_status_log
              WHERE return_type = 'GSTR-1' AND client_id = '11111111-1111-1111-1111-111111111111'),
  'changed/06/2026/07/2026', 'a move is logged with where it came from');

-- The client's own deletion still takes its rows (the cascade, one trigger
-- level down).
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
DELETE FROM public.clients WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111'), 0, 'deleted with its client');
