-- return-pdfs is no longer public (docs/DOCUMENT_LINKS.md, step 2; the firm's
-- go-ahead of 26 Oct 2026). Its public address (/storage/v1/object/public/…)
-- stops answering: the app shows every stored file as /d/<id> through doc-open
-- (20261025210000), and notice-ai reads with the service role on the
-- authenticated endpoint. The extension's upload is unchanged (INSERT policy).
-- Undo: set public = true.
update storage.buckets set public = false where id = 'return-pdfs' and public;
