-- Round 1, defects 11 and 12. Unlock is for whoever the page offers it to
-- (canUnlockSheets: a GST Manager, the superadmin, an employee whose
-- position holds unlock_sheets), not a narrower set. Take off Filed unlocks
-- a GSTR-3B row, so staff can work the return again.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/GSTR-3B-AB240826123456X.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'pulled');

-- An employee without the key: refused, in words that name it.
SELECT t_raises($$SELECT public.filing_status_unlock('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', '08/2026')$$,
  'needs the Unlock sheets permission', 'employee without unlock_sheets refused');
-- An employee whose position holds unlock_sheets: unlocked.
SELECT t_eq(public.filing_status_unlock('00000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', '08/2026'), 1,
  'employee with unlock_sheets unlocks');
SELECT t_eq((SELECT status::text || '/' || is_locked::text || '/' || arn FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND period_month = '08/2026'),
  'Prepared Pending/false/AB240826123456X', 'unlocked, ARN kept');
SELECT t_eq((SELECT actor_id::text FROM public.filing_status_log WHERE event = 'unlocked'), '00000000-0000-0000-0000-00000000000d', 'who unlocked is logged');

-- Take off Filed: the row is unlocked too.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'AB240926123456X', current_date - 1,
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'pulled');
SELECT t_eq((SELECT is_locked FROM public.filing_status WHERE arn = 'AB240926123456X'), true, 'locked when filed');
SELECT t_eq((public.filing_status_unfile('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status WHERE arn = 'AB240926123456X'), 'Wrong return attached')).is_locked, false, 'taken off Filed and unlocked');
SELECT t_eq((SELECT status::text || '/' || is_locked::text || '/' || COALESCE(arn, '-') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '09/2026'),
  'Prepared/false/-', 'staff can work it again');
-- A GSTR-1 keeps its own lock as it was.
RESET ROLE;
SELECT public.mark_filing_pushed('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', NULL);
SET LOCAL ROLE anon;
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', 'AA240926123456X', current_date - 1,
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'GSTR-1 pulled');
UPDATE public.filing_status SET is_locked = true WHERE arn = 'AA240926123456X';
SELECT t_eq((public.filing_status_unfile('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status WHERE arn = 'AA240926123456X'), 'Wrong return attached')).is_locked, true, 'GSTR-1 lock untouched');
