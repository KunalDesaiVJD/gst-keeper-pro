-- Builder: completion is the earlier of the BU permission and first occupation.
--
-- Schedule II para 5(b) of the CGST Act and Notification 06/2019-CT(R) both
-- turn on "the issuance of completion certificate ... or after its first
-- occupation, whichever is earlier". The BU event carried only the
-- permission's date, so a project occupied before its permission had every
-- unit's cut-off, the TDR/FSI time of supply and the ITC reversal year run
-- from the later date.
--
-- builder_bu_events.bu_date stays the one date every engine reads (cut-off,
-- FSI, ITC reversal, reports). When first occupation came first, the app saves
-- that date as bu_date and keeps the permission's own date beside it, so the
-- record shows both. Additive only: two nullable columns, no data touched.
-- New columns need nothing for the change log (docs/GST_CHANGE_LOG.md).

ALTER TABLE public.builder_bu_events
  ADD COLUMN IF NOT EXISTS first_occupation_date date,
  ADD COLUMN IF NOT EXISTS bu_permission_date date;

COMMENT ON COLUMN public.builder_bu_events.first_occupation_date IS
  'First occupation of the project, when recorded. If earlier than the BU permission it is the completion date and bu_date carries it (Schedule II para 5(b), Notif 06/2019-CT(R)).';
COMMENT ON COLUMN public.builder_bu_events.bu_permission_date IS
  'The date printed on the BU permission, kept when first occupation came earlier and bu_date therefore carries the occupation date.';
