-- Dispute year on every case and notice (Meet, 25 Oct 2026).
--
-- The Cases list and All notices showed an FY only when the portal stated one
-- on the notice (gst_notices.financial_year): about one notice in nine. The
-- year a dispute relates to is usually written somewhere else we already hold:
-- the notice's period, the AI reading of its papers, the portal record in its
-- case folder (a refund's return periods, a DRC-03's period), another notice
-- of the same case, or the case it is linked to (an appeal and its order).
--
-- This migration is additive: three helpers and three views, nothing changed.
-- The years are worked out, never written back to gst_notices, so a sync or a
-- person's typed FY still decides; a stated FY always wins over a derived one.
--
--   notice_dispute_years       one row per notice in notice_facts
--   notice_case_dispute_years  one row per case, scope 'apart' (the portal case,
--                              as notice_cases_flat) and 'linked' (the chain,
--                              as notice_cases)
--
-- basis says where the years came from, best first:
--   notice    stated on the notice (portal FY, or read and kept in read_fields)
--   period    the notice's tax period
--   document  the AI reading of the notice's papers, or of the case's
--   portal    the portal record in the case folder (return periods, LUT FY)
--   case      another notice or paper of the same case (notice rows only)
--   linked    the case it is linked to (an appeal takes its order's year)
-- Registration has no dispute year: applies is false there.

-- Every financial year from a to b (either order), GST era only, at most ten.
CREATE OR REPLACE FUNCTION public.notice_fys_between(a date, b date)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN coalesce(a, b) IS NULL THEN '{}'::text[] ELSE coalesce((
    SELECT array_agg(y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0') ORDER BY y)
    FROM generate_series(
      greatest(least(sa, sb), 2017),
      least(greatest(sa, sb), least(sa, sb) + 9)) y), '{}'::text[]) END
  FROM (SELECT
    extract(year FROM coalesce(a, b))::int - CASE WHEN extract(month FROM coalesce(a, b)) < 4 THEN 1 ELSE 0 END AS sa,
    extract(year FROM coalesce(b, a))::int - CASE WHEN extract(month FROM coalesce(b, a)) < 4 THEN 1 ELSE 0 END AS sb) x
$$;

-- The financial years a text names: '2019-20', 'FY 2019-2020', '2017-2022'
-- (2017-18 to 2021-22), '2019-20, 2020-21'. A date ('2023-03-31') is not a year.
CREATE OR REPLACE FUNCTION public.notice_fy_list(p text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(DISTINCT y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0')
                            ORDER BY y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0')), '{}'::text[])
  FROM (
    SELECT m[1]::int AS y1,
           CASE WHEN length(m[2]) = 4 THEN m[2]::int ELSE (m[1]::int / 100) * 100 + m[2]::int END AS y2
    FROM regexp_matches(coalesce(p, ''), '(?<!\d)(20\d\d)\s*[-–/]\s*(\d{4}|\d{2})(?![-\d])', 'g') m
  ) r
  CROSS JOIN LATERAL generate_series(greatest(r.y1, 2017), least(r.y2 - 1, r.y1 + 9)) y
  WHERE r.y2 > r.y1
$$;

-- A date from 'YYYY-MM-DD', 'DD/MM/YYYY', 'YYYYMM' or 'MMYYYY' text; NULL if it is none.
CREATE OR REPLACE FUNCTION public.notice_loose_date(p text)
RETURNS date LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t text := btrim(coalesce(p, ''));
BEGIN
  IF t ~ '^\d{4}-\d{2}-\d{2}' THEN RETURN left(t, 10)::date;
  ELSIF t ~ '^\d{2}/\d{2}/\d{4}$' THEN RETURN to_date(t, 'DD/MM/YYYY');
  ELSIF t ~ '^20\d{2}(0[1-9]|1[0-2])$' THEN RETURN to_date(t || '01', 'YYYYMMDD');
  ELSIF t ~ '^(0[1-9]|1[0-2])20\d{2}$' THEN RETURN to_date('01' || t, 'DDMMYYYY');
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE OR REPLACE VIEW public.notice_dispute_year_sources AS
WITH n AS (
  SELECT f.id, f.client_id, f.financial_year,
         public.notice_case_key(f.case_id, f.category, f.id) AS raw_key
  FROM public.notice_facts f
)
-- 1 stated on the notice
SELECT n.id AS notice_id, n.client_id, n.raw_key AS case_key, 1 AS rank, 'notice'::text AS basis, y AS fy
FROM n CROSS JOIN LATERAL unnest(public.notice_fy_list(n.financial_year)) y
UNION ALL
SELECT n.id, n.client_id, n.raw_key, 1, 'notice', y
FROM n JOIN public.gst_notices g ON g.id = n.id
CROSS JOIN LATERAL unnest(public.notice_fy_list(g.read_fields -> 'financial_year' ->> 'value')) y
-- 2 the notice's period
UNION ALL
SELECT n.id, n.client_id, n.raw_key, 2, 'period', y
FROM n JOIN public.gst_notices g ON g.id = n.id
CROSS JOIN LATERAL unnest(public.notice_fys_between(g.period_from, g.period_to)) y
-- 3 the AI reading of the notice's own papers (its FY, else its period)
UNION ALL
SELECT n.id, n.client_id, n.raw_key, 3, 'document', y
FROM n JOIN public.ai_documents d ON d.notice_id = n.id
 AND (coalesce(d.overview ->> 'financial_year', '') <> '' OR coalesce(d.overview ->> 'period_from', '') <> '')
CROSS JOIN LATERAL unnest(CASE
  WHEN cardinality(public.notice_fy_list(d.overview ->> 'financial_year')) > 0 THEN public.notice_fy_list(d.overview ->> 'financial_year')
  ELSE public.notice_fys_between(public.notice_loose_date(d.overview ->> 'period_from'), public.notice_loose_date(d.overview ->> 'period_to')) END) y
-- 4 the portal record in the case folder: return periods, a DRC-03's period, an LUT's FY
-- (an item the portal later took away still says which year the case is about)
UNION ALL
SELECT NULL, i.client_id, i.case_id, 4, 'portal', y
FROM public.gst_case_folder_items i
CROSS JOIN LATERAL unnest(
  public.notice_fys_between(public.notice_loose_date(i.raw_json ->> 'fromRetPrd'), public.notice_loose_date(i.raw_json ->> 'toRetPrd'))
  || public.notice_fy_list(i.raw_json ->> 'fy')
  || public.notice_fy_list(i.raw_json #>> '{vp,pysum,fy}')) y
WHERE nullif(btrim(i.case_id), '') IS NOT NULL AND jsonb_typeof(i.raw_json) = 'object'
  AND i.raw_json ?| ARRAY['fromRetPrd', 'fy', 'vp']
-- 5 the AI reading of the case's other papers
UNION ALL
SELECT NULL, d.client_id, d.case_id, 5, 'document', y
FROM public.ai_documents d
CROSS JOIN LATERAL unnest(CASE
  WHEN cardinality(public.notice_fy_list(d.overview ->> 'financial_year')) > 0 THEN public.notice_fy_list(d.overview ->> 'financial_year')
  ELSE public.notice_fys_between(public.notice_loose_date(d.overview ->> 'period_from'), public.notice_loose_date(d.overview ->> 'period_to')) END) y
WHERE d.notice_id IS NULL AND nullif(btrim(d.case_id), '') IS NOT NULL
  AND (coalesce(d.overview ->> 'financial_year', '') <> '' OR coalesce(d.overview ->> 'period_from', '') <> '');

COMMENT ON VIEW public.notice_dispute_year_sources IS
  'Every financial year a notice or case is said to relate to, with where it was read (rank 1 best). Read through notice_dispute_years / notice_case_dispute_years.';

CREATE OR REPLACE VIEW public.notice_case_dispute_years AS
WITH src AS MATERIALIZED (SELECT * FROM public.notice_dispute_year_sources),
keys AS (
  -- every case key the lists show, with the chain it belongs to
  SELECT DISTINCT f.client_id,
         public.notice_case_key(f.case_id, f.category, f.id) AS raw_key,
         public.notice_case_key(f.client_id, f.case_id, f.category, f.id) AS root_key,
         CASE WHEN f.system_generated THEN 'other' ELSE public.notice_track(f.category) END AS track
  FROM public.notice_facts f
),
best AS (
  -- per portal case: the years at its best rank
  SELECT s.client_id, s.case_key, min(s.rank) AS rank
  FROM src s GROUP BY 1, 2
),
apart AS (
  SELECT s.client_id, s.case_key,
         array_agg(DISTINCT s.fy ORDER BY s.fy) AS years,
         min(s.basis) AS basis
  FROM src s
  JOIN best b ON b.client_id = s.client_id AND b.case_key = s.case_key AND b.rank = s.rank
  GROUP BY 1, 2
),
chain_best AS (
  SELECT k.client_id, k.root_key, min(s.rank) AS rank
  FROM keys k JOIN src s ON s.client_id = k.client_id AND s.case_key = k.raw_key
  GROUP BY 1, 2
),
chain AS (
  SELECT k.client_id, k.root_key,
         array_agg(DISTINCT s.fy ORDER BY s.fy) AS years,
         min(s.basis) AS basis
  FROM keys k
  JOIN src s ON s.client_id = k.client_id AND s.case_key = k.raw_key
  JOIN chain_best cb ON cb.client_id = k.client_id AND cb.root_key = k.root_key AND cb.rank = s.rank
  GROUP BY 1, 2
),
track AS (
  SELECT client_id, raw_key AS case_key, bool_or(track <> 'registration') AS applies FROM keys GROUP BY 1, 2
)
-- apart: the portal case alone, else the case it is linked to
SELECT 'apart'::text AS scope, k.client_id, k.raw_key AS case_key, t.applies,
       CASE WHEN NOT t.applies THEN '{}'::text[] ELSE coalesce(a.years, pa.years, ch.years, '{}'::text[]) END AS dispute_years,
       CASE WHEN NOT t.applies THEN NULL
            WHEN a.years IS NOT NULL THEN a.basis
            WHEN pa.years IS NOT NULL OR ch.years IS NOT NULL THEN 'linked' END AS basis
FROM (SELECT DISTINCT client_id, raw_key, root_key FROM keys) k
JOIN track t ON t.client_id = k.client_id AND t.case_key = k.raw_key
LEFT JOIN apart a ON a.client_id = k.client_id AND a.case_key = k.raw_key
LEFT JOIN LATERAL (
  SELECT p.years FROM public.notice_case_links l
  JOIN apart p ON p.client_id = l.client_id AND p.case_key = l.parent_key
  WHERE l.client_id = k.client_id AND l.child_key = k.raw_key LIMIT 1) pa ON true
LEFT JOIN chain ch ON ch.client_id = k.client_id AND ch.root_key = k.root_key AND k.root_key <> k.raw_key
UNION ALL
-- linked: the whole chain, as notice_cases shows it
SELECT 'linked', k.client_id, k.root_key, t.applies,
       CASE WHEN NOT t.applies THEN '{}'::text[] ELSE coalesce(ch.years, '{}'::text[]) END,
       CASE WHEN NOT t.applies OR ch.years IS NULL THEN NULL ELSE ch.basis END
FROM (SELECT DISTINCT client_id, root_key FROM keys) k
JOIN (SELECT client_id, root_key, bool_or(track <> 'registration') AS applies FROM keys GROUP BY 1, 2) t
  ON t.client_id = k.client_id AND t.root_key = k.root_key
LEFT JOIN chain ch ON ch.client_id = k.client_id AND ch.root_key = k.root_key;

COMMENT ON VIEW public.notice_case_dispute_years IS
  'The financial years each case''s dispute relates to: scope apart (portal case, as notice_cases_flat) and linked (chain, as notice_cases). basis: notice, period, document, portal, linked; NULL when unknown. applies is false for registration.';

CREATE OR REPLACE VIEW public.notice_dispute_years AS
WITH src AS MATERIALIZED (SELECT * FROM public.notice_dispute_year_sources WHERE notice_id IS NOT NULL),
own AS (
  SELECT s.notice_id, min(s.rank) AS rank
  FROM src s GROUP BY 1
),
own_years AS (
  SELECT s.notice_id, array_agg(DISTINCT s.fy ORDER BY s.fy) AS years, min(s.basis) AS basis
  FROM src s JOIN own o ON o.notice_id = s.notice_id AND o.rank = s.rank
  GROUP BY 1
),
n AS (
  SELECT f.id, f.client_id,
         public.notice_case_key(f.case_id, f.category, f.id) AS raw_key,
         public.notice_case_key(f.client_id, f.case_id, f.category, f.id) AS root_key,
         (f.system_generated OR public.notice_track(f.category) <> 'registration') AS applies
  FROM public.notice_facts f
)
SELECT n.id, n.client_id, n.raw_key AS case_key, n.root_key, n.applies,
       CASE WHEN NOT n.applies THEN '{}'::text[] ELSE coalesce(o.years, c.dispute_years, '{}'::text[]) END AS dispute_years,
       CASE WHEN NOT n.applies THEN NULL
            WHEN o.years IS NOT NULL THEN o.basis
            WHEN cardinality(c.dispute_years) > 0 THEN CASE WHEN c.basis = 'linked' THEN 'linked' ELSE 'case' END END AS basis
FROM n
LEFT JOIN own_years o ON o.notice_id = n.id
LEFT JOIN public.notice_case_dispute_years c ON c.scope = 'apart' AND c.client_id = n.client_id AND c.case_key = n.raw_key;

COMMENT ON VIEW public.notice_dispute_years IS
  'The financial years each notice''s dispute relates to (a stated FY first, then its period, its papers, its case, the case it is linked to). basis NULL when unknown; applies is false for registration.';

GRANT SELECT ON public.notice_dispute_year_sources, public.notice_case_dispute_years, public.notice_dispute_years TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notice_fys_between(date, date), public.notice_fy_list(text), public.notice_loose_date(text)
  TO anon, authenticated, service_role;
