-- Turnover per client per financial year from the stored GSTR-1 JSONs, for
-- the e-invoice threshold check (src/lib/einvoice/threshold.ts).
--
-- Mirrors gstr1MonthTurnover() / buildGstr1Summary(): taxable value of
-- B2B (4A/4B/6B/6C), B2CL (5), exports (6A), B2CS (7), plus nil-rated /
-- exempt / non-GST (8), net of credit and debit notes at taxable value
-- (9B: debit +, credit −). Advances, HSN and documents are not turnover.
-- Computed in the database so the Clients page does not download every
-- client's JSON to add it up.

CREATE OR REPLACE FUNCTION public.gstr1_json_turnover(j jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH
  items AS (
    -- B2B, B2CL and EXP invoice lines (itm_det.txval, or a flat txval on EXP)
    SELECT COALESCE(NULLIF(it->'itm_det'->>'txval', ''), NULLIF(it->>'txval', ''))::numeric AS v
      FROM jsonb_array_elements(COALESCE(j->'b2b', '[]'::jsonb)) p,
           jsonb_array_elements(COALESCE(p->'inv', '[]'::jsonb)) inv,
           jsonb_array_elements(COALESCE(inv->'itms', '[]'::jsonb)) it
    UNION ALL
    SELECT COALESCE(NULLIF(it->'itm_det'->>'txval', ''), NULLIF(it->>'txval', ''))::numeric
      FROM jsonb_array_elements(COALESCE(j->'b2cl', '[]'::jsonb)) s,
           jsonb_array_elements(COALESCE(s->'inv', '[]'::jsonb)) inv,
           jsonb_array_elements(COALESCE(inv->'itms', '[]'::jsonb)) it
    UNION ALL
    SELECT COALESCE(NULLIF(it->'itm_det'->>'txval', ''), NULLIF(it->>'txval', ''))::numeric
      FROM jsonb_array_elements(COALESCE(j->'exp', '[]'::jsonb)) e,
           jsonb_array_elements(COALESCE(e->'inv', '[]'::jsonb)) inv,
           jsonb_array_elements(COALESCE(inv->'itms', '[]'::jsonb)) it
    UNION ALL
    SELECT NULLIF(r->>'txval', '')::numeric
      FROM jsonb_array_elements(COALESCE(j->'b2cs', '[]'::jsonb)) r
    UNION ALL
    SELECT COALESCE(NULLIF(r->>'nil_amt', '')::numeric, 0)
         + COALESCE(NULLIF(r->>'expt_amt', '')::numeric, 0)
         + COALESCE(NULLIF(r->>'ngsup_amt', '')::numeric, 0)
      FROM jsonb_array_elements(COALESCE(j->'nil'->'inv', '[]'::jsonb)) r
    UNION ALL
    SELECT (CASE WHEN upper(COALESCE(nt->>'ntty', nt->>'typ', 'C')) LIKE 'D%' THEN 1 ELSE -1 END)
           * COALESCE(NULLIF(it->'itm_det'->>'txval', ''), NULLIF(it->>'txval', ''))::numeric
      FROM jsonb_array_elements(COALESCE(j->'cdnr', '[]'::jsonb)) p,
           jsonb_array_elements(COALESCE(p->'nt', '[]'::jsonb)) nt,
           jsonb_array_elements(COALESCE(nt->'itms', '[]'::jsonb)) it
    UNION ALL
    SELECT (CASE WHEN upper(COALESCE(nt->>'ntty', nt->>'typ', 'C')) LIKE 'D%' THEN 1 ELSE -1 END)
           * COALESCE(NULLIF(it->'itm_det'->>'txval', ''), NULLIF(it->>'txval', ''))::numeric
      FROM jsonb_array_elements(COALESCE(j->'cdnur', '[]'::jsonb)) nt,
           jsonb_array_elements(COALESCE(nt->'itms', '[]'::jsonb)) it
  )
  SELECT COALESCE(sum(v), 0) FROM items;
$$;

-- gstr1_data.period_month is the short label ("Sep-26"). Rows in any other
-- shape are skipped rather than guessed at.
CREATE OR REPLACE VIEW public.client_fy_gstr1_turnover AS
SELECT
  g.client_id,
  CASE WHEN extract(month FROM d)::int >= 4
       THEN extract(year FROM d)::int
       ELSE extract(year FROM d)::int - 1 END                         AS fy_start,
  (CASE WHEN extract(month FROM d)::int >= 4
        THEN extract(year FROM d)::int
        ELSE extract(year FROM d)::int - 1 END)::text
    || '-' || lpad((((CASE WHEN extract(month FROM d)::int >= 4
                           THEN extract(year FROM d)::int
                           ELSE extract(year FROM d)::int - 1 END) + 1) % 100)::text, 2, '0')
                                                                       AS financial_year,
  count(*)::int                                                        AS months,
  round(sum(public.gstr1_json_turnover(g.raw_json)), 2)                AS turnover
FROM public.gstr1_data g
CROSS JOIN LATERAL (SELECT to_date(g.period_month, 'Mon-YY') AS d) x
WHERE g.period_month ~ '^[A-Za-z]{3}-[0-9]{2}$'
  AND g.raw_json IS NOT NULL
GROUP BY g.client_id, 2, 3;

GRANT SELECT ON public.client_fy_gstr1_turnover TO anon, authenticated, service_role;
