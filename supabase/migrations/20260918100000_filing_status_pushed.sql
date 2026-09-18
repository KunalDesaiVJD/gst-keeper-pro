-- 'Pushed' — the filing status a return reaches when this app has successfully
-- pushed its data to the GST portal, but nobody has filed it yet.
--
-- It sits strictly BETWEEN the prepared statuses and 'Filed'. It is NOT a
-- filing: the portal still needs Confirm / Offset Liability / File and the
-- authorised signatory's EVC or DSC, none of which this app can do. Nothing
-- that gates on 'Filed' (the GSTR-1-before-GSTR-3B sequence check, the
-- auto-lock, the ARN requirement) treats 'Pushed' as filed, and that is
-- deliberate.
--
-- The whole point of the status is that it is EVIDENCE of a system event, so a
-- human must never be able to type it in. Two things enforce that:
--   1. the UI never offers it as a selectable option, and
--   2. this trigger, which rejects any write that moves a row into 'Pushed'
--      unless it comes through mark_filing_pushed() below.
-- (2) is the one that actually holds: RLS on this project is open to `public`
-- by design (the app has no Supabase auth session), so the anon key can write
-- any column from anywhere. A UI-only rule would be decoration.

ALTER TYPE filing_status_type ADD VALUE IF NOT EXISTS 'Pushed';
