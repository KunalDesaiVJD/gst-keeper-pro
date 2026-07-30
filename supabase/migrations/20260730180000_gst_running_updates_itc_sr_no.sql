-- GST Update Sheet: record which ITC Summary line an ITC correction's effect
-- was given under. `itc_section` is the ITC Summary section (4A / 4B / 4D) and
-- `itc_sr_no` is the row within it (e.g. "(1)", "5.4"). Mandatory on the page
-- for Reversal/Claim/Reclaim corrections once remarks are written.

BEGIN;

ALTER TABLE public.gst_running_updates
  ADD COLUMN IF NOT EXISTS itc_section text,
  ADD COLUMN IF NOT EXISTS itc_sr_no text;

COMMIT;
