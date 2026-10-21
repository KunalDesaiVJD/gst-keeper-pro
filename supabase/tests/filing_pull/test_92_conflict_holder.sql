-- Integration round (21 Oct 2026, low): a conflict names the return holding
-- the ARN (detail.arn_on_return_type / arn_on_period), and Accept returns the
-- return it took off Filed (unfiled), so Filing Status can say that a GSTR-3B
-- taken off Filed stays a filed month for Import 2B and 2B Reconciliation
-- until a GST Manager reopens it, and that the accepted month's carry was
-- skipped meanwhile. The old page let July's GSTR-3B hold June's ARN.
-- Where 20261021100000 is in (the combined harness) the repair it names is
-- run too: "Filed by mistake" on July (its ARN gone, so allowed), then Re-run
-- carry forward from June.
SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url, is_locked) VALUES
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'Filed', 'AB2406261234567', '2026-07-20',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/jul.pdf', true);
SET LOCAL session_replication_role = origin;
SELECT to_regclass('public.twob_ever_filed') IS NOT NULL AS with_twob \gset
\if :with_twob
-- July recorded as filed for Import 2B (the row was written before the
-- record trigger), and a June entry waiting to be carried.
INSERT INTO public.twob_ever_filed (client_id, return_type, period_month) VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026');
SET LOCAL session_replication_role = replica;
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, reversal_month)
VALUES ('11111111-1111-1111-1111-111111111111', '06/2026', '2026-06-05', 'JUNE SUPPLIER', 'J-6', '24JUNES0000A1Z5', 1000, 180, 'Jun 26');
SET LOCAL session_replication_role = origin;
\endif
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '06/2026', 'AB2406261234567', '2026-07-20', NULL, NULL,
  '00000000-0000-0000-0000-00000000000c', '{"ext_version":"0.17.0"}'))->>'outcome', 'conflict', 'June''s pull: its ARN sits on July');
SELECT t_eq((SELECT (detail ->> 'arn_on_return_type') || ' ' || (detail ->> 'arn_on_period') || ' ' || (detail ->> 'arn_on_client_id')
               FROM public.filing_status_log WHERE event = 'conflict' AND period_month = '06/2026'),
  'GSTR-3B 07/2026 11111111-1111-1111-1111-111111111111', 'the conflict names the return holding the ARN');

SELECT public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict' AND period_month = '06/2026'), true) AS decided \gset
SELECT t_eq(:'decided'::jsonb ->> 'outcome', 'accepted', 'accepted');
SELECT t_eq((:'decided'::jsonb -> 'unfiled' ->> 'return_type') || ' ' || (:'decided'::jsonb -> 'unfiled' ->> 'period_month'),
  'GSTR-3B 07/2026', 'Accept names the return it took off Filed');
SELECT t_eq((SELECT string_agg(period_month || ':' || status::text || ':' || COALESCE(arn, '-'), ' ' ORDER BY period_month)
               FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month IN ('06/2026', '07/2026')),
  '06/2026:Filed:AB2406261234567 07/2026:Prepared:-', 'June Filed with its ARN; July off Filed, no ARN');

\if :with_twob
-- What the words say: July still counts as filed for Import 2B, so June's
-- carry was skipped ('next_filed'); a GST Manager reopens July (its ARN is
-- gone), then Re-run from June brings June's entry into July.
SELECT t_eq(public.twob_month_is_prior('11111111-1111-1111-1111-111111111111', '07/2026'), true, 'twob: July still counts as filed');
SELECT t_eq((SELECT last_outcome || ' ' || (carried_at IS NULL)::text FROM public.twob_carry_log
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND period_month = '06/2026' AND list = 'bills_not_in_2b'),
  'next_filed true', 'twob: June''s carry was skipped');
SELECT t_eq((public.twob_reopen_filed('00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026',
  'Held June''s ARN') ->> 'is_prior')::boolean, false, 'twob: the GST Manager reopens July (no ARN left on it)');
SELECT t_eq((SELECT array_agg(x ->> 'supplier_invoice_number') FROM jsonb_array_elements(
  public.twob_carry_rerun('00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', '06/2026', true) -> 'bills_not_in_2b' -> 'add') x),
  ARRAY['J-6'], 'twob: Re-run from June would add J-6 to July');
\endif
