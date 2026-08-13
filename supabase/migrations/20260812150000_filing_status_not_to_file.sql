-- Add 'Not to File' to filing_status_type enum — for a client/return/period
-- combination that genuinely doesn't need a return filed (e.g. dormant GSTIN,
-- return type not applicable that period), distinct from every other status
-- which implies a filing is still pending in some form.
ALTER TYPE filing_status_type ADD VALUE IF NOT EXISTS 'Not to File';
