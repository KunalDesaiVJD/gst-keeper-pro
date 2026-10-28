-- Queue again the documents notice-ai 1.5.0 now reads (docs/NOTICES_LITIGATION_POSITIONS.md
-- §38): those skipped as too long (it reads a long document in part, its first
-- pages and its last five) and those failed as scans (it reads a partly scanned
-- one by its typed pages; a whole scan fails again at once, nothing sent).
-- Apply only after notice-ai 1.5.0 is deployed: the earlier reader skips them again.
UPDATE public.ai_documents
   SET status = 'queued', attempts = 0, not_before = NULL, error = NULL, reason_class = NULL, finished_at = NULL, agent_id = NULL, claimed_at = NULL
 WHERE status IN ('failed', 'skipped') AND reason_class IN ('too_long', 'needs_vision') AND source <> 'workspace';
