-- The reader's staging bucket for long scans (29 October 2026, notice-ai 1.7.0).
--
-- A scan or a photo is read by GST Keeper's own Claude CLI gateway
-- (api/claude-cli.ts), which opens the file itself from this project's storage.
-- A scan of up to 12 pages is read where it is stored (return-pdfs); a longer
-- one is read by its first nine pages and its last three, which notice-ai copies
-- into one PDF here, has read, and removes (a part left by a run that died is
-- removed by the next run after an hour). Private: no policies, so only the
-- service-role key (notice-ai, the gateway) reaches it.
-- docs/NOTICES_LITIGATION_POSITIONS.md §38.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ai-cli-temp', 'ai-cli-temp', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
