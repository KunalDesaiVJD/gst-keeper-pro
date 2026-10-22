-- Round 4, finding 1. A monthly client's GSTR-1 / GSTR-3B is never filed by
-- hand without the superadmin's allowance through its GSTR-1 (IFF) /
-- GSTR-3B (Q) twin row: the attach decides by the period's effective return
-- type (filing_effective_return_type), not only by the row asked for. The
-- twin row of a monthly period is refused, naming the row to use; the
-- client's own GSTR-1 / GSTR-3B row still needs the allowance.

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- ── s1: FICTIONAL FABRICS (monthly) has a GSTR-1 (IFF) row for 08/2026 ───
SELECT t_eq(public.filing_effective_return_type('11111111-1111-1111-1111-111111111111', 'GSTR-1 (IFF)', '08/2026'),
  'GSTR-1', 'the period''s return is GSTR-1');
-- As the page inserts rows when staff set a status (the guard allows it).
INSERT INTO public.filing_status (client_id, return_type, period_month, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-1', '08/2026', 'Prepared'),
       ('11111111-1111-1111-1111-111111111111', 'GSTR-1 (IFF)', '08/2026', 'Prepared');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-1 (IFF)', '08/2026',
  'AA240826555555K', '2026-09-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-1 (IFF)/08-2026/manual-x.pdf')$$,
  'For 08/2026 this client files GSTR-1', 'the IFF twin row of a monthly period is refused');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111'
              AND period_month = '08/2026' AND (status::text = 'Filed' OR arn IS NOT NULL)), 0, 's1: nothing filed');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status_log WHERE client_id = '11111111-1111-1111-1111-111111111111'
              AND period_month = '08/2026' AND event = 'manual_attach'), 0, 's1: nothing logged as attached');
-- Even with the superadmin's allowance for GSTR-1, the IFF row is not the
-- one: the allowance is left unused for the GSTR-1 row.
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '08/2026',
  'filing:GSTR-1', 'Portal down on the due date')).id IS NOT NULL;
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-1 (IFF)', '08/2026',
  'AA240826555555K', '2026-09-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-1 (IFF)/08-2026/manual-x.pdf')$$,
  'attach it on its GSTR-1 row', 'refused with an allowance too');
SELECT t_eq((SELECT used_at IS NULL FROM public.manual_source_allowances WHERE scope = 'filing:GSTR-1' AND period_month = '08/2026'),
  true, 'the allowance is not used up by a refused attach');
-- On its GSTR-1 row the allowance is taken.
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-1', '08/2026',
  'AA240826555555K', '2026-09-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-1/08-2026/manual-x.pdf'))->>'return_type',
  'GSTR-1', 'attached on the GSTR-1 row under the allowance');
SELECT t_eq((SELECT used_at IS NOT NULL FROM public.manual_source_allowances WHERE scope = 'filing:GSTR-1' AND period_month = '08/2026'),
  true, 'and the allowance is used');

-- ── s2: the same with GSTR-3B (Q) in a quarter-end month (09/2026) ───────
SELECT t_eq(public.filing_effective_return_type('11111111-1111-1111-1111-111111111111', 'GSTR-3B (Q)', '09/2026'),
  'GSTR-3B', 'the period''s return is GSTR-3B');
INSERT INTO public.filing_status (client_id, return_type, period_month, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B (Q)', '09/2026', 'Prepared');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-3B (Q)', '09/2026',
  'AB240926555555K', '2026-10-20',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B (Q)/09-2026/manual-x.pdf')$$,
  'For 09/2026 this client files GSTR-3B', 'the 3B (Q) twin row of a monthly period is refused');
SELECT t_eq((SELECT string_agg(return_type::text || ':' || status::text || ':' || COALESCE(arn, '-') || ':' || COALESCE(is_locked, false)::text, ' ')
              FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND period_month = '09/2026'),
  'GSTR-3B (Q):Prepared:-:false', 's2: nothing filed, nothing locked');

-- ── The quarterly client keeps its manual route on its own rows ──────────
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'GSTR-3B (Q)', '09/2026',
  'AB240926777777K', '2026-10-19',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/GSTR-3B (Q)/09-2026/manual-x.pdf'))->>'allowance_id',
  NULL::text, 'IMAGINARY IMPEX''s GSTR-3B (Q) by hand, no allowance');

-- ── A twin row that already holds the ARN (recorded before 21 Oct 2026) ──
-- TWIN TRADERS ticks both GSTR-1 types, so its period's return is GSTR-1;
-- its GSTR-1 (IFF) row holds the ARN. Asking for the IFF row lands there,
-- but only under the allowance for GSTR-1.
SET LOCAL ROLE postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url)
VALUES ('33333333-3333-3333-3333-333333333333', 'GSTR-1 (IFF)', '04/2026', 'Filed', 'AA270426123456X', '2026-05-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/33333333-3333-3333-3333-333333333333/GSTR-1 (IFF)/04-2026/1_twin.pdf');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE anon;
SELECT t_eq(public.filing_effective_return_type('33333333-3333-3333-3333-333333333333', 'GSTR-1 (IFF)', '04/2026'), 'GSTR-1', 'TWIN TRADERS files GSTR-1');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333', 'GSTR-1 (IFF)', '04/2026',
  'AA270426123456X', '2026-05-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/33333333-3333-3333-3333-333333333333/GSTR-1 (IFF)/04-2026/manual-x.pdf')$$,
  'no manual allowance', 'the holder twin needs the allowance for GSTR-1');
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333', '04/2026',
  'filing:GSTR-1', 'Only the consolidated PDF comes from the portal')).id IS NOT NULL;
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333', 'GSTR-1 (IFF)', '04/2026',
  'AA270426123456X', '2026-05-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/33333333-3333-3333-3333-333333333333/GSTR-1 (IFF)/04-2026/manual-x.pdf'))->>'return_type',
  'GSTR-1 (IFF)', 'with it, the PDF goes on the row holding the ARN');
SELECT t_eq((SELECT used_at IS NOT NULL FROM public.manual_source_allowances WHERE client_id = '33333333-3333-3333-3333-333333333333' AND period_month = '04/2026'),
  true, 'and the allowance is used');
