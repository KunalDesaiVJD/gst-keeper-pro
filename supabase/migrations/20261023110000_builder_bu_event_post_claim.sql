-- Two Post clicks (or two tabs) on one BU event both passed the page's
-- "already posted" check and each raised a full set of differential invoices;
-- the loser's set was left unlinked and double counted in GSTR-1 / 3B.
-- A post now first claims the event with one conditional UPDATE; a second
-- post finds the claim and is refused. A claim older than 10 minutes is
-- treated as abandoned (browser closed mid-post).
ALTER TABLE public.builder_bu_events ADD COLUMN IF NOT EXISTS posting_started_at timestamptz;
