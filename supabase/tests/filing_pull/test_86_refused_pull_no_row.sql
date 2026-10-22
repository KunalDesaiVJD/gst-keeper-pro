-- Round 3, finding 3: a refused pull leaves no new row behind (it used to
-- leave a 'Prepared' row where the page showed Data Pending), and a refused
-- pull of a row that exists leaves it as it was.

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- ── b. A refused pull leaves no new row ───────────────────────────────────
-- FICTIONAL FABRICS has no GSTR-1 09/2026 row; it was not pushed and has no
-- direct-filing approval, so the pull is refused.
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111'
              AND period_month = '09/2026' AND return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)')), 0, 'no row before');
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', 'AA240926123456X', '2026-10-10',
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refused', 'refused by the direct-filing rule');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111'
              AND period_month = '09/2026' AND return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)')), 0, 'no row after: the page still shows Data Pending');
SELECT t_eq((SELECT filing_status_id IS NULL AND message LIKE 'The pull was not recorded.%' FROM public.filing_status_log
              WHERE event = 'refused' AND period_month = '09/2026' AND return_type = 'GSTR-1'), true, 'logged, naming no row');
-- A refused pull of a row that exists keeps the row as it was.
SET LOCAL ROLE postgres;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, remarks)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', 'Data Received', 'sales register in');
SET LOCAL ROLE anon;
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', 'AA240926123456X', '2026-10-10',
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refused', 'refused again');
SELECT t_eq((SELECT status::text || '/' || remarks FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111'
              AND period_month = '09/2026' AND return_type = 'GSTR-1'), 'Data Received/sales register in', 'the existing row is untouched');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status_log WHERE event = 'refused' AND period_month = '09/2026'
              AND return_type = 'GSTR-1' AND filing_status_id IS NOT NULL), 1, 'and the log names it');

