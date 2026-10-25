-- Notices · a standing check on every appeal's pre-deposit (asked by the firm,
-- 25 October 2026, after 20261025170000: "make sure that going forward same
-- mistake should not happen so stringent checking mechanisms").
--
-- The mistake was a portal field the reader did not know: the amount paid sat
-- in orddtl.paidamt while the reader looked only at orddtl.predepositamt, and
-- the timeline said "₹0 paid" on 9 paid appeals. notice_predeposit_audit()
-- lists every appeal the portal has given us (the APL-01 in a case folder and
-- the application on the applications list), what the timeline reads from it
-- (notice_folder_facts, the reader itself, so the two can never differ) and a
-- verdict:
--   paid       the amount read covers the percentage of the tax in dispute;
--   short      an amount is read and is below it;
--   no_amount  the record holds no amount the reader knows;
--   unread     the record holds a field about a deposit or a payment that the
--              reader does not know (a new portal shape): the reader must
--              learn it before the timeline can be trusted for that appeal.
-- Anything but "paid" is for a person to look at, never a payment to assume.
-- supabase/tests/notices/test_116_predeposit.sql holds the reader to every
-- shape seen live. Additive: one new function.

CREATE OR REPLACE FUNCTION public.notice_predeposit_known_field(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  -- The fields of orddtl that the reader knows: amounts it reads, and the
  -- portal's other amounts that are not a pre-deposit paid.
  SELECT p_key IN ('predepositamt', 'paidamt', 'prn', 'predepotax', 'predepositpenality',
                   'dispamt', 'initamt', 'payableamt', 'appealwithdrawreject', 'enfdisamtflag', 'noticeAmountFlag')
$$;

CREATE OR REPLACE FUNCTION public.notice_predeposit_audit()
RETURNS TABLE (
  client_id uuid, client_name text, appeal_arn text, order_ref text, source text, item_id uuid,
  disputed_tax numeric, pct numeric, required numeric, paid numeric, prn text,
  verdict text, unread_fields text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (
    SELECT fi.client_id, fi.case_id AS arn, 'case_folder'::text AS source, fi.id AS item_id, fi.raw_json AS j
      FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL AND public.notice_is_appeal_form(fi.raw_json)
    UNION ALL
    SELECT a.client_id, a.arn, 'application', a.id, public.notice_try_jsonb(a.raw_json #>> '{appItem,itemJson}')
      FROM public.gst_portal_applications a
     WHERE a.deleted_at IS NULL AND public.notice_is_appeal_form(public.notice_try_jsonb(a.raw_json #>> '{appItem,itemJson}'))
  ), f AS (
    SELECT r.*, public.notice_folder_facts('APLCN', r.j) AS facts,
           ARRAY(SELECT k FROM jsonb_object_keys(r.j -> 'orddtl') k
                  WHERE k ~* '(deposit|paid|pay|prn|cpin|challan|debit)' AND NOT public.notice_predeposit_known_field(k)
                  ORDER BY k) AS unread
      FROM r
  ), v AS (
    SELECT f.*, (f.facts ->> 'disputed_tax')::numeric AS tax,
           coalesce((f.facts ->> 'predeposit_pct')::numeric, CASE WHEN f.facts ->> 'second_appeal' = 'true' THEN 20 ELSE 10 END) AS p,
           (f.facts ->> 'predeposit')::numeric AS amt
      FROM f
  )
  SELECT v.client_id, c.name, v.arn, v.facts ->> 'order_ref', v.source, v.item_id,
         v.tax, v.p, round(v.tax * v.p / 100), v.amt, v.facts ->> 'predeposit_prn',
         CASE WHEN cardinality(v.unread) > 0 THEN 'unread'
              WHEN v.amt IS NULL THEN 'no_amount'
              WHEN v.tax IS NOT NULL AND v.amt + 1 < round(v.tax * v.p / 100) THEN 'short'
              ELSE 'paid' END,
         v.unread
    FROM v LEFT JOIN public.clients c ON c.id = v.client_id
   ORDER BY (CASE WHEN cardinality(v.unread) > 0 THEN 0 WHEN v.amt IS NULL THEN 1
                  WHEN v.tax IS NOT NULL AND v.amt + 1 < round(v.tax * v.p / 100) THEN 2 ELSE 3 END), c.name, v.arn, v.source
$$;
REVOKE ALL ON FUNCTION public.notice_predeposit_audit() FROM public;
GRANT EXECUTE ON FUNCTION public.notice_predeposit_audit() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_predeposit_audit() IS
  'Every appeal''s pre-deposit as the timeline reads it, with a verdict (paid, short, no_amount, unread: a portal field the reader does not know). Anything but paid is for a person.';
