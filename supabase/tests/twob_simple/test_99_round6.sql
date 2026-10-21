-- Integration round (21 Oct 2026, the controls-integration verification), as
-- PostgREST runs it (anon): "Filed by mistake" (twob_reopen_filed) never
-- reopens a return filed on the portal. Unlock leaves the row's ARN (and,
-- from 20261021110000, its filing source, filed_source) on it, so the month
-- stays prior until the superadmin's Take off Filed clears them; the twin of
-- the period (GSTR-3B / GSTR-3B (Q)) counts too. Part 1 runs on this suite's
-- own database (the status changed by hand, as before 20261021110000) and on
-- the combined one; part 2 only where 20261021110000 is in (the combined
-- harness): the extension's pull, Unlock, the refusal, Take off Filed, then
-- the reopen. The reopen racing a pull is test_96_reopen_race.sh. Each block
-- fails on the version of twob_reopen_filed before this round (it checked
-- only that the status was no longer Filed).
\set P 'a6000000-0000-0000-0000-000000000001'
\set Q 'a6000000-0000-0000-0000-000000000002'
\set R 'a6000000-0000-0000-0000-000000000003'
\set S 'a6000000-0000-0000-0000-000000000004'

-- ---------------------------------------------------------------------------
-- 1 (medium). Unlocked, the return keeps its ARN: no reopen, the month stays
-- prior and its entries stay closed to staff. With the ARN cleared (as Take
-- off Filed does) the reopen goes through.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'P', 'R6 unlocked keeps its ARN', '24RSIXP0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, reversal_month)
VALUES (:'P', '07/2026', '2026-07-05', 'SUPPLIER A', 'A-1', '24AAAAA0000A1Z5', 1000, 180, 'Jul 26');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn) VALUES (:'P', 'GSTR-3B', '07/2026', 'Filed', 'AA2407260000061');
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false WHERE client_id = :'P' AND period_month = '07/2026';
SELECT public.t_eq((SELECT arn FROM public.filing_status WHERE client_id = :'P' AND period_month = '07/2026'), 'AA2407260000061',
  '1: unlocked, the row keeps its ARN');
SELECT public.t_raises(format($q$SELECT public.twob_reopen_filed(public.t_manager(), '%s', 'GSTR-3B', '07/2026', 'not a mistake really')$q$, :'P'),
  'Filed on the portal: GSTR-3B 07/2026 still holds ARN AA2407260000061', '1: a GST Manager cannot reopen a return holding its ARN');
SELECT public.t_raises(format($q$SELECT public.twob_reopen_filed(public.t_superadmin(), '%s', 'GSTR-3B', '07/2026', 'not a mistake really')$q$, :'P'),
  'the superadmin takes it off Filed first', '1: ... nor the superadmin, who is told to take it off Filed first');
SELECT public.t_eq(public.twob_month_is_prior(:'P', '07/2026'), true, '1: July stays prior');
SELECT public.t_eq((SELECT reopened_at IS NULL FROM public.twob_ever_filed WHERE client_id = :'P' AND period_month = '07/2026'), true,
  '1: ... its record is not reopened');
SELECT public.t_raises(format($q$UPDATE public.bills_not_in_2b SET input_igst = 999, reversal_month = NULL WHERE client_id = '%s' AND period_month = '07/2026'$q$, :'P'),
  'This month is filed', '1: ... and its entries stay closed to staff');
UPDATE public.filing_status SET arn = NULL, filed_date = NULL WHERE client_id = :'P' AND period_month = '07/2026';
SELECT public.twob_reopen_filed(public.t_manager(), :'P', 'GSTR-3B', '07/2026', 'ARN was another month''s') AS p_state \gset
SELECT public.t_eq((:'p_state'::jsonb ->> 'is_prior')::boolean, false, '1: its ARN cleared, the reopen goes through');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1b (medium). The period's twin counts: a GSTR-3B (Q) row of the month that
-- holds the ARN keeps the GSTR-3B from being reopened.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'Q', 'R6 twin holds the ARN', '24RSIXQ0000A1Z5');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'Q', 'GSTR-3B', '09/2026', 'Filed');
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false, filed_date = NULL WHERE client_id = :'Q' AND return_type = 'GSTR-3B' AND period_month = '09/2026';
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn) VALUES (:'Q', 'GSTR-3B (Q)', '09/2026', 'Prepared Pending', 'AA2409260000062');
SELECT public.t_raises(format($q$SELECT public.twob_reopen_filed(public.t_manager(), '%s', 'GSTR-3B', '09/2026', 'set by mistake')$q$, :'Q'),
  'Filed on the portal: GSTR-3B (Q) 09/2026 still holds ARN AA2409260000062', '1b: the twin holding the ARN keeps the month filed');
UPDATE public.filing_status SET arn = NULL WHERE client_id = :'Q' AND return_type = 'GSTR-3B (Q)' AND period_month = '09/2026';
SELECT public.t_ok(format($q$SELECT public.twob_reopen_filed(public.t_manager(), '%s', 'GSTR-3B', '09/2026', 'set by mistake')$q$, :'Q'),
  '1b: neither row holding an ARN, the reopen goes through');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1c (medium, the database side of the GSTR-3B (Q) rows on Filing Status). A
-- quarterly return recorded at the quarter end, taken back with no ARN, is
-- reopened under its own return type, and its quarter's months open.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'R', 'R6 quarterly', '24RSIXR0000A1Z5');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'R', 'GSTR-3B (Q)', '09/2026', 'Filed');
SELECT public.t_eq(public.twob_month_is_prior(:'R', '07/2026'), true, '1c: the quarter''s first month is prior');
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false, filed_date = NULL WHERE client_id = :'R' AND period_month = '09/2026';
SELECT public.t_raises(format($q$SELECT public.twob_reopen_filed(public.t_manager(), '%s', 'GSTR-3B', '09/2026', 'set by mistake')$q$, :'R'),
  'not recorded as filed', '1c: the monthly return type does not name it');
SELECT public.twob_reopen_filed(public.t_manager(), :'R', 'GSTR-3B (Q)', '09/2026', 'set by mistake') AS r_state \gset
SELECT public.t_eq((:'r_state'::jsonb ->> 'is_prior')::boolean, false, '1c: reopened as GSTR-3B (Q)');
SELECT public.t_eq(public.twob_month_is_prior(:'R', '07/2026'), false, '1c: ... and its quarter''s months are open');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2 (medium, combined). The live sequence of the verification: the
-- extension's pull files July (portal), Unlock (an employee holding
-- unlock_sheets, or a GST Manager) keeps the ARN and the source, the GST
-- Manager's "Filed by mistake" is refused, a source alone refuses it too,
-- the superadmin's Take off Filed clears both, then the reopen goes through
-- and a new pull files July again.
-- ---------------------------------------------------------------------------
SELECT to_regprocedure('public.filing_status_unlock(uuid,uuid,text)') IS NOT NULL
   AND to_regprocedure('public.filing_record_pull(uuid,text,text,text,date,text,text,uuid,jsonb)') IS NOT NULL AS combined \gset
\if :combined
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'S', 'R6 pulled then unlocked', '24RSIXS0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, reversal_month)
VALUES (:'S', '07/2026', '2026-07-05', 'SUPPLIER A', 'A-1', '24AAAAA0000A1Z5', 1000, 180, 'Jul 26');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.filing_record_pull(:'S', 'GSTR-3B', '07/2026', 'AA2407260000064', '2026-08-20', NULL, NULL, public.t_manager(), '{}') ->> 'outcome' AS s_pull \gset
SELECT public.t_eq(:'s_pull'::text, 'filed', '2: the pull files July');
SELECT public.filing_status_unlock(public.t_manager(), :'S', '07/2026') AS s_unlocked \gset
SELECT public.t_eq((SELECT status::text || ' ' || arn || ' ' || (to_jsonb(f) ->> 'filed_source') FROM public.filing_status f WHERE client_id = :'S' AND period_month = '07/2026'),
  'Prepared Pending AA2407260000064 portal', '2: unlocked, the row keeps its ARN and source');
SELECT public.t_raises(format($q$SELECT public.twob_reopen_filed(public.t_manager(), '%s', 'GSTR-3B', '07/2026', 'not a mistake really')$q$, :'S'),
  'Filed on the portal: GSTR-3B 07/2026 still holds ARN AA2407260000064', '2: Unlock, then reopen: refused');
SELECT public.t_eq(public.twob_month_is_prior(:'S', '07/2026'), true, '2: July stays prior');
SELECT public.t_raises(format($q$UPDATE public.bills_not_in_2b SET input_igst = 999, reversal_month = NULL WHERE client_id = '%s' AND period_month = '07/2026'$q$, :'S'),
  'This month is filed', '2: ... its entries stay closed to staff');
-- A source with no ARN (a fixture write; no route clears the ARN alone).
UPDATE public.filing_status SET arn = NULL WHERE client_id = :'S' AND period_month = '07/2026';
SELECT public.t_raises(format($q$SELECT public.twob_reopen_filed(public.t_manager(), '%s', 'GSTR-3B', '07/2026', 'not a mistake really')$q$, :'S'),
  'still holds its filing source (portal)', '2: a filing source alone refuses it too');
UPDATE public.filing_status SET arn = 'AA2407260000064' WHERE client_id = :'S' AND period_month = '07/2026';
SELECT public.filing_status_unfile(public.t_superadmin(), (SELECT id FROM public.filing_status WHERE client_id = :'S' AND period_month = '07/2026'),
  'The ARN was another month''s') IS NOT NULL AS s_unfiled \gset
SELECT public.t_eq((SELECT status::text || ' ' || COALESCE(arn, '-') || ' ' || COALESCE(to_jsonb(f) ->> 'filed_source', '-') FROM public.filing_status f WHERE client_id = :'S' AND period_month = '07/2026'),
  'Prepared - -', '2: Take off Filed clears the ARN and the source');
SELECT public.twob_reopen_filed(public.t_manager(), :'S', 'GSTR-3B', '07/2026', 'The ARN was another month''s') AS s_state \gset
SELECT public.t_eq((:'s_state'::jsonb ->> 'is_prior')::boolean, false, '2: then the GST Manager reopens July');
SELECT public.filing_record_pull(:'S', 'GSTR-3B', '07/2026', 'AA2407260000064', '2026-08-20', NULL, NULL, public.t_manager(), '{}') ->> 'outcome' AS s_repull \gset
SELECT public.t_eq(:'s_repull'::text, 'filed', '2: pulled again, July is filed');
SELECT public.t_eq(public.twob_month_is_prior(:'S', '07/2026'), true, '2: ... and prior again');
RESET ROLE;
\else
SELECT 'part 2 needs 20261021110000 (the combined harness runs it)' AS skipped;
\endif
