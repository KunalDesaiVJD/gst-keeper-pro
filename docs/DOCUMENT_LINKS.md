# Document links (/d/&lt;id&gt;)

Every stored file (the `return-pdfs`, `annual-return-evidence` and
`chat-attachments` buckets) is shown in the app as
`https://gst.vjdesai.com/d/<id>`, never by its storage address
(`https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>`),
which names the backend and the path and opens for anyone who has it.

## How it works

- `<id>` is base64url of the first 9 bytes of `sha256("<bucket>/<object name>")`
  (12 characters). The app makes it while rendering
  (`supabase/functions/_shared/docLink.ts`, `src/lib/docLinks.ts`); the database
  makes the same one (`public.doc_link_id`) to find the file. The database keeps
  the address book `doc_links` (filled from `storage.objects` by the migration,
  and again on the first open of an id not yet known, because storage's table
  cannot take a trigger).
- `/d/:id` (`src/pages/DocumentOpenPage.tsx`) sends a signed-out person to the
  login page and back. Signed in, it asks the Edge Function `doc-open`, which
  checks the person (any staff level whose sessions were not ended; a client
  only a file whose path carries the client's own id), reads the file with the
  service role and streams it. The page shows it from memory, so the address
  bar keeps `/d/<id>`. `?download=<name>` saves it under that name.
- Every open, refusal and miss is kept in `doc_link_opens`. `doc_links` and
  `doc_link_opens` have RLS on and no policies (read by `doc-open` only).
- Links: `docHref(url)` / `openDoc(url)` where code renders a link, and the
  rewriter (`installDocLinkRewriter`, started in `App.tsx`) under them: any
  `<a href>` naming a storage address is turned into its short link as it
  appears, so a link added later cannot show the address. Exports
  (`src/lib/reportExport/`, the DRC-03 workbook) write the absolute short link;
  the notice-alert e-mail's "Notice PDF" link is the short link (takes effect
  when `send-gst-email` is next deployed). A .zip of PDFs reads through
  `doc-open` (`fetchStoredFile`).
- The stored values (`pdf_url`, case folder `raw_json`, `ai_documents`
  keys, …) are not changed: they stay storage addresses, and are turned into
  short links only when shown.

What `doc-open` trusts: the app has no server-checked session (custom sign-in,
see CLAUDE.md), so like `gst-push` it trusts the actor id the page sends and
checks it against the database. That id is never shown in the app.

## Making the buckets private

`return-pdfs` is private since 26 Oct 2026 (`20261026080000`): its public
address answers "Bucket not found". The anon key (which is in the website's
code) may still read and list it through the storage API's authenticated
endpoint (`Anyone can view return PDFs`) until step 3. The other two buckets
are still public. In order:

1. **Done (this change):** nobody sees a storage address in the app, an export
   or an alert e-mail.
2. **Done 26 Oct 2026 for `return-pdfs`: bucket private** (`update storage.buckets set public = false where id =
   'return-pdfs'`; reversible). Only once this app is live, since a link not
   yet short would stop. The two readers that fetched the public address
   without a key now read with one (`storageReadUrl`, the public address read
   on `/storage/v1/object/authenticated/…`): `notice-ai`'s `downloadPdf`
   (`supabase/functions/notice-ai/pdf.ts`, the service role; deployed) and the
   office agent's `agent/src/read/pdf.ts` (the anon key, which reads while the
   anon SELECT policy stands; off by default, and takes effect when the office
   PC's agent is updated). The extension is not affected: it
   uploads with `POST /storage/v1/object/return-pdfs/<path>` (INSERT policy)
   and only *returns* the public address as a string, which the app still
   turns into a short link.
3. **Close the anon key's read and list** (drop the SELECT and UPDATE policies
   on `return-pdfs`). Needs an extension release: its upload sends
   `x-upsert: true`, and Supabase's upsert needs SELECT and UPDATE. The
   extension would instead upload through a signed upload URL (or an Edge
   Function) that the service role hands out. A separate PR, studying the
   extension first.

`annual-return-evidence` and `chat-attachments` follow the same steps (their
uploaders are the app only: `src/lib/gstr9/store.ts`,
`src/components/chat/MentionInput.tsx`).
