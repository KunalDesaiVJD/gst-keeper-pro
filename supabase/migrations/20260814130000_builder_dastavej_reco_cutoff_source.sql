-- builder_dastavej_reco always showed "BU date" for beu.bu_date, even when
-- the row behind it is a single-unit dastavej-triggered auto-post whose
-- bu_date is literally the dastavej (registered sale deed) date, not a real
-- BU permission date — the same conflation raised for Plot No. 148 (Shree
-- Maruti Infra). Exposing cut_off_source lets the UI (BuilderDastavejPage.tsx)
-- label the date correctly instead of relying on the bu_date === dastavej_date
-- proxy it used before. Byte-identical to the view in
-- 20260729160000_builder_phase3_bu_events.sql except this one added column.
CREATE OR REPLACE VIEW public.builder_dastavej_reco AS
SELECT
  u.id                AS unit_id,
  u.project_id,
  p.client_id,
  p.name              AS project_name,
  u.unit_no,
  u.unit_type,
  u.status            AS unit_status,
  u.dastavej_date,
  u.dastavej_value,
  COALESCE(ob.agreement_value, 0) AS opening_agreement_value,
  l.value_taxed,
  beu.bu_event_id,
  ev.bu_date,
  beu.booked_at_cutoff,
  CASE
    WHEN u.dastavej_value IS NULL THEN NULL
    ELSE ROUND(u.dastavej_value - l.value_taxed, 2)
  END                 AS variance,
  beu.cut_off_source
FROM public.builder_units u
JOIN public.builder_projects    p ON p.id = u.project_id
JOIN public.builder_unit_ledger l ON l.unit_id = u.id
LEFT JOIN public.builder_opening_balances ob ON ob.unit_id = u.id
LEFT JOIN public.builder_bu_event_units   beu ON beu.unit_id = u.id
LEFT JOIN public.builder_bu_events        ev  ON ev.id = beu.bu_event_id
WHERE u.dastavej_date IS NOT NULL OR u.dastavej_value IS NOT NULL;

COMMENT ON VIEW public.builder_dastavej_reco IS
  'Deed value vs value offered to tax. Registration itself is not a taxable event under the firm''s model.';
