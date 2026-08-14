-- Per-client Strict / Liberal 2B Reconciliation mode.
--
-- Strict (default): 2B Reconciliation is read-only; entries, reversals,
-- reclaims and book entries all go through Import 2B (see
-- docs/2B_RECONCILIATION_FLOW.md). This is the behaviour shipped in #40.
--
-- Liberal: 2B Reconciliation reverts to the pre-#40 fully editable page for
-- that client — Add row, edit any cell, Import Excel, Save Changes, per-row
-- Delete — and staff need not use Import 2B for that client at all. Import 2B
-- stays fully usable regardless of mode; the toggle only controls whether
-- direct edits on 2B Reconciliation are also allowed.
--
-- Defaults to false (Strict) for every existing and new client — opt specific
-- clients into Liberal individually from the client edit form.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS liberal_2b_reconciliation boolean NOT NULL DEFAULT false;
