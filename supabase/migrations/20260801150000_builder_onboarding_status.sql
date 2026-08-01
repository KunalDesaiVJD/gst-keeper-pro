-- Builder module: per-unit onboarding status.
--
-- A project can be onboarded into this software mid-stream. Some of its units
-- may already be fully resolved under the firm's earlier records — BU
-- received and/or the dastavej registered, tax fully accounted for outside
-- this software — before this software ever saw the project. Those units
-- must not be picked up by this software's own automatic engines: a BU sweep
-- that includes them, or a dastavej auto-post triggered by (re-)keying their
-- deed date for record purposes, would recompute tax this software has no
-- reliable basis for, since it never saw the unit's true pre-onboarding
-- position.
--
-- 'LIVE' (default) — this software runs its BU sweeps and dastavej
--   auto-post on the unit, same as any unit booked entirely within it.
-- 'CLOSED_PRE_ONBOARDING' — excluded from BU-event sweep candidates
--   (BuilderBuEventsPage) and from the dastavej auto-post differential
--   (autoPostDastavejDifferential); the deed date/value can still be
--   recorded for the register, but no automatic tax posting follows from it.
--
-- Deliberately NOT excluded from the project's carpet-area / RREP test: the
-- 15% test is about the project's physical mix of residential and commercial
-- area, not about which units this software tracks tax for, so a
-- closed-pre-onboarding unit's area still counts. See
-- docs/BUILDER_GST_POSITIONS.md §14.

alter table public.builder_units
  add column if not exists onboarding_status text not null default 'LIVE';

alter table public.builder_units
  drop constraint if exists builder_units_onboarding_status_check;

alter table public.builder_units
  add constraint builder_units_onboarding_status_check
    check (onboarding_status in ('LIVE', 'CLOSED_PRE_ONBOARDING'));

comment on column public.builder_units.onboarding_status is
  'LIVE: BU sweeps and dastavej auto-post run on this unit as normal. '
  'CLOSED_PRE_ONBOARDING: fully resolved before this project was onboarded here; '
  'excluded from BU-event sweep candidates and from the dastavej auto-post '
  'differential, but still counted in the project''s carpet-area/RREP test.';
