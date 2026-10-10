# GSTR-1 e-invoices (IRN): positions

How the app keeps each e-invoice's IRN on the GST portal when it pushes a
client's GSTR-1. Read this before changing `src/lib/einvoice/einvoice.ts`,
`src/lib/einvoice/excel.ts`, the e-invoice parts of the GSTR-1 page, the
extension's GSTR-1 upload or e-invoice pull, or
`supabase/migrations/20261013100000_einvoice_keep_irn.sql`.

**Engineering wrote these positions on 10 Oct 2026 from GSTN's own documents
and an audit of the live data, and revised them the same day after a review
(pending documents no longer left out, the reverse-charge / type /
e-commerce GSTIN check, the shipping-bill warning, documents missing from
the return, pulled records marked rather than deleted, the stale-file rule,
the evidence-failure refusal, the one-transaction Excel import and the
plan's row version), and again after a second review (a pull records
itself as running while it saves, a pulled record is lost only when marked
gone, the pull's record decides over the Excel's, Download JSON without a
pull of the day). The firm has not signed them off yet, and the
mechanism has not yet been seen working on the live portal (§9).**

---

## 1. The elected mechanism: keep, don't re-send

The firm wants every invoice's IRN to stay on the portal. The app does that
by **leaving every e-invoice that the portal already holds out of the upload.**

- The GST system auto-populates every e-invoice into the supplier's GSTR-1
  two days after the IRN is generated. The records arrive as Saved records
  with Source "E-invoice", the IRN and the IRN date. (GSTN advisory
  *Auto-population of e-invoice details into GSTR-1*, paras 2 and 5.)
- If the taxpayer edits an auto-populated document, "such edited documents
  will be treated as if they were not auto-populated but uploaded separately
  by taxpayer". The system deletes the Source, IRN and IRN date. (Advisory
  para 6; the later advisory v3, para 8; GSTR-1 user guide, section D, note
  to step 1.6.)
- An uploaded record overwrites the earlier record of the same document.
  (Returns Offline Tool FAQ Q18 and Q54.) GSTN's own offline tool (release
  3.2.4) deletes `irn`, `irngendate` and `srctyp` from any document the user
  edits (`returns1.ctrl.js`, `updateInvoice`). It also warns before
  deleting a document "with details auto-populated from e-invoices".
- If a document is entered or uploaded before the e-invoice reaches GSTR-1,
  auto-population does not overwrite it. The Excel then notes this against
  the document. (Advisory para 3(c).)

So, at push time, every books document in B2B, CDNR, CDNUR or EXP that a
pull taken that day saw **on the draft** as an e-invoice, with the same
figures, type, reverse charge and e-commerce GSTIN, is **left out** of the
uploaded JSON. The portal keeps its own record, with the IRN. A document
whose e-invoice is still pending auto-population is **never** left out: it
blocks the push until a later pull shows it on the draft, or staff tick an
override and it goes up from the books without its IRN (§4.5). Everything
else is uploaded as before. **Table 12 (HSN) and Table 13 (documents
issued) always go in full**, because a summary section is overwritten as a
whole by each upload (FAQ Q35). The advisory v3 also lists HSN among the
auto-populated tables, and the books' HSN replaces it.

**The app never writes `irn`, `irngendate` or `srctyp` into an upload.**
`attachIrn` was removed from both copies (the TS library and
`extension/background.js`). It rested on an assumption that was never
tested: that the portal keeps an IRN sent inside an uploaded JSON. Para 6
says the opposite. It also wrote `srctyp: "e-Invoice"`, while the portal
writes "E-Invoice" (77 of 77 live documents).

### The contract between the page and the extension

- The page plans the push (`reconcileEinvoice`, then `planEinvoiceUpload`).
  It sends `einvoice: { keep, planAt, basisUpdatedAt }` in
  `__gstkUploadGstr1`. `keep` lists the books documents to leave out, using
  the exact `section`, `ctin`, `doc_type` and `doc_no` from the stored
  raw_json. `basisUpdatedAt` is the exact `gstr1_data.updated_at` string of
  the stored row the plan was made on (the one the page just compared with
  its own copy, or the one the pre-push corrections save returned).
- The extension (0.8.7) reads `updated_at` with `raw_json`. When
  `basisUpdatedAt` is set and `Date.parse(stored.updated_at) !==
  Date.parse(basisUpdatedAt)`, it refuses the push before anything else
  (before it clears the Upload History snapshot or opens a tab): "This
  return changed after the e-invoice plan was made. Reload it and click
  Upload again." Equality, not a later-than test, so no PC clock is
  compared with another, and a document added after the plan is caught
  too.
- The extension honours this from **0.8.7**. It removes exactly those
  documents from the copy it uploads. It drops buyer or export-type groups
  left with no documents, and sections left empty. It never touches any
  other section. `leaveOutKept` in `einvoice.ts` does the same in the app,
  for the manual "Download JSON" path and the tests.
- The result posted back to the page carries `einvoiceKept`, the number of
  documents removed. The UPLOAD row in `gstr1_upload_versions` stores
  `einvoice_kept` and `ext_version`. Its `payload` stays the books JSON. The
  JSON actually sent is that payload minus the kept documents. The keep list
  itself is not stored, so only the count can be checked afterwards.

## 2. Identity and exact matching

A document's identity is `{ section, ctin, doc_type, doc_no }`:

- `section` is one of `b2b`, `cdnr`, `cdnur`, `exp` or `b2cl`.
- `ctin` is the buyer's GSTIN, upper-cased. It is empty for `exp`, `cdnur`
  and `b2cl`.
- `doc_type` is `INV`, `CRN` or `DBN`. Notes take it from `ntty` (C or D).
- `doc_no` is the number exactly as in the JSON, trimmed.

The key (`exactKey`) is `section|ctin|doc_type|DOC_NO`. The number is
upper-cased and any run of whitespace becomes one space. Separators are
kept. This is the **only** key that pairs a books document with an
e-invoice for leaving it out. A credit note and a debit note with the same
number to the same buyer are two documents.

`normDocKey` drops separators and case, so "inv-001" and "INV/001" give the
same value. It is used **only** to spot "number differs" pairs (§4). It
never pairs documents for leaving them out, because the portal tells
documents apart by their exact number.

In the DB, `einvoice_docs.doc_key` holds the exact number. The unique key is
`(client_id, period_month, section, ctin, doc_type, doc_key, source)`.

Amendments (`b2ba`, `cdnra` and the like) are not reconciled. An IRN cannot
be amended on the IRP, so a books amendment goes up as before.

## 3. Statuses, and what each does at push time

`reconcileEinvoice(books, einv, { pulledAt })` sets one status per document:

| Status | Meaning | At push |
|---|---|---|
| `matched` | On the draft as an e-invoice. Figures (±₹1), date, place of supply, invoice type (export type for EXP), reverse charge and e-commerce GSTIN are the same. | **Left out** (an export whose books shipping bill the e-invoice lacks warns, §5) |
| `books_irn` | The books document carries its own IRN (a portal download) and there is no record against it. | **Left out** |
| `pending` | IRN generated, not on the draft yet: an Excel record the pull has no record of, saying pending or giving no status (or, with a pull, saying auto-populated), whose IRN date + 2 days is not before the pull day (today, without a pull). | In the books: **blocks**, unless staff tick the override; then **uploaded** without its IRN (§4.5). Not in the books: a warning (§5). |
| `mismatch` | Same document, but its figures, date, place of supply, invoice type, reverse charge, e-commerce GSTIN or IRN differ from the e-invoice. Also a document that appears twice in the books. | **Blocks** |
| `number_differs` | No exact match, but the number differs only in separators or case from an e-invoice that is, or will be, on the draft. | **Blocks** |
| `not_einvoiced` | E-invoiceable, but no IRN was found. | Uploaded |
| `autopop_failed` | The Excel says auto-population failed or gave an error. | In the books: uploaded, with a warning. Not in the books: missing from GSTR-1, warning (§5) |
| `irn_lost` | It was an e-invoice, but the latest pull no longer shows it with its IRN. | In the books: uploaded, with a warning. Not in the books: missing from GSTR-1, warning (§5) |
| `not_in_books` | On the draft as an e-invoice, but missing from the books. | Warning |

**Leaving out is only for what a pull saw.** Before 10 Oct 2026 (review
E1) a pending document was left out too, on the promise that the portal
would add it. Nothing ensures that happens before the return is filed: an
e-invoice whose return is filed first is never auto-populated afterwards
(advisory para 3(b)), so a pending document left out of a return filed
before its T+2 would be missing from GSTR-1, with its tax. A pending
document is therefore never left out. The firm still wants every IRN kept,
so the default is to **block** and wait for the pull that shows it on the
draft; uploading it now (the document is then in GSTR-1, without the IRN,
para 3(c)) is a deliberate, recorded choice (§4.5).

**Type, reverse charge and e-commerce GSTIN** (review E3, E13). A document
left out is filed exactly as the e-invoice has it. If the books say reverse
charge N and the e-invoice says Y (every one of SUNRISE GUJ's Aug-26
e-invoices is Y), or R against SEWP, or another e-commerce operator, the
filed return would differ from the books with nothing to say so. So any of
these differences makes the pair `mismatch`, with the same remedy as a
figure difference: correct the books, or re-issue the IRN. Each is compared
only when both sides give a value, so a source that does not carry one
never blocks. The books carry them in the JSON (`rchrg`, `inv_typ` or the
export's `exp_typ`, `etin`); a pulled record keeps them in `raw` (the
document as the portal gave it); an Excel record from its "Reverse Charge",
"Invoice Type" / "Export Type" and "E-Commerce GSTIN" columns. Export types
compare as WPAY / WOPAY whatever the source's wording.
Rules applied before the statuses:

- A cancelled IRN (Excel status Cancelled) is never used for anything.
- When the pull and the Excel both have a document, **the pulled record
  decides**, whatever the Excel says: on the draft, or lost once a pull
  marked it gone. The pull shows what is on the draft; the Excel only what
  the IRP sent (para 7). The Excel fills in only documents the pull has no
  record of (second review N1 / N2: an Excel "auto-populated today" no
  longer outranks a pull that marked the document gone).
- With a successful pull on record, an Excel record the pull did **not**
  see is never on the draft, whatever its status: pending while IRN date +
  2 days is not before the pull day (IST), lost after. Auto-population
  failed stays failed.
- A books document whose e-invoice **failed** auto-population is always
  uploaded. Leaving it out would drop it from GSTR-1.

`irn_lost` is an addition to the first contract. The document reads as
lost when:

- a pulled record carries `gone_at`: a later pull did not see it on the
  draft (§8). This holds with or without `pulledAt`, and it is the **only**
  thing that makes a pulled record lost. No timestamp is compared: the
  page once read a record as lost when its `last_seen_at` was earlier than
  the latest pull's `pulled_at`, and a pull row and records read at two
  moments (a pull saving meanwhile, or two overlapping pulls) then turned
  every e-invoice of the return lost, and the push re-sent them all
  (second review N1 / N2). `einvoice_docs` was empty and extension 0.8.6
  cannot write after the migration, so no row predates `gone_at`;
- with a successful pull, an Excel record the pull has no record of, of
  any status but failed, whose IRN date + 2 days is before the pull day:
  auto-population should have run by then, whatever the Excel says;
- without a successful pull, an Excel record that says pending or gives no
  status whose IRN date + 2 days is before today (IST);
- a books document with its own IRN that the pull does not show.

The portal no longer holds any of these as an e-invoice. Leaving them out
would keep a stale uploaded copy, or no copy at all, so they go up from
the books. An IRN date the Excel does not give leaves the record pending.
Without a successful pull, an Excel record that says auto-populated is
taken at its word: only Download JSON plans without a pull of the day (§5),
and it says so.

**Exports and the shipping bill** (review E3). The e-invoice may carry no
shipping bill (FAQ Q28: shipping details are optional at upload). When an
export is left out to keep its IRN but the books have a shipping bill the
e-invoice lacks, or a different one (number, date or port code), the plan
warns (`warnings.shippingBill`) and the upload dialog lists it. The firm's
choice is to **keep the IRN**: the document stays left out, and staff add
the shipping bill on the portal or through Table 9A. Without it, Table 6A
is filed with no shipping bill, and the IGST refund on a with-payment export
is not sent to ICEGATE until it is added. (A portal edit of the
auto-populated record drops its IRN, para 6; Table 9A in a later return does
not.)

## 4. What blocks a push

A push is refused, for a client that issues e-invoices (§7), while any of
these hold:

1. **Mismatch.** A document's figures differ from its e-invoice. Staff
   correct the books to the e-invoice, or cancel and re-issue the IRN on
   the IRP within its window, or record the difference by a credit or
   debit note. The app never sends a changed document as if it were the
   e-invoice.
2. **Number differs.** If the books number went up, the portal would hold
   two documents: the e-invoice and the books copy. Staff correct the books
   number to the e-invoice's.
3. **No fresh pull, or a pull of an old file** (and no e-invoice Excel
   imported today). **Firm's decision, 10 Oct 2026:** an e-invoice Excel
   imported today stands in for the pull. Staff downloading the Excel from
   the portal and importing it must not be blocked from pushing; the plan then
   rests on the Excel (documents it shows as auto-populated are left out), its
   import time is recorded in `einvoice_pulls` (source `einvoice_excel`) and
   the upload dialog says "Planned on the e-invoice Excel imported …". A pull
   of today still decides over the Excel where both have a document (§3).
   Without either: E-invoices reach the draft
   two days after the IRN, and one uploaded first is never auto-populated
   (para 3(c)). So the plan must rest on a pull taken on the day of the
   push, of a file the portal generated that day. `isPullFresh` takes the
   `einvoice_pulls` row and accepts only status `ok` or `none` on the same
   IST calendar day. The portal can answer the pull's request
   (`offline/download/generate?flag=0`) at once with a file it generated
   earlier (review E2), so the extension reads the generation date from the
   ZIP entry's name (`returns_<ddmmyyyy>_...`) and stores it as
   `einvoice_pulls.generated_on`. A file generated before today (IST) is
   recorded as status **`stale`**: nothing is saved and nothing is marked
   gone, and the message tells staff how to get a fresh one: on the portal,
   Prepare Offline → Download → Generate JSON file to download, wait for it,
   then pull again. A stale pull is never fresh, so the push stays blocked.
   A name with no date keeps the old behaviour, with a warning added to the
   message. The date is day-precise only, so a file generated earlier the
   same day passes. A pull from the extension in the same session, just
   before the upload, is best.

   **A pull still saving is never fresh** (second review N1). Before its
   first write to `einvoice_docs` the extension writes the pull row as
   status **`running`** ("Pull in progress", `pulled_at` = the pull's own
   time), and writes its final status (`ok`, `none` or `failed`) after its
   last. While the row says running, or this page started a pull that has
   not reported back, the push gate says: "A pull of e-invoices is in
   progress: wait for it to finish, then push. If it was interrupted, pull
   again." The push reads the pull row **before** the records and **again
   after** them, and refuses if the two differ (a pull started or ended in
   between, so the records may be half one pull's). It reads the row once
   more just before it sends the plan, after every other check, and
   refuses if it is running or is not the row the records were read with:
   "A pull of e-invoices saved new records while this push was being
   prepared, so nothing was uploaded." Download JSON refuses the same way.
4. **Extension below 0.8.7.** Older versions ignore `einvoice.keep` and
   would upload every document.
5. **Pending auto-population, in the books** (`plan.pendingBlockers`). The
   e-invoice is not on the draft yet, so the document cannot be left out
   (§3). The upload dialog lists them with a checkbox: "Upload these N
   documents now; their IRN will not be linked (GSTN para 3(c)). To keep the
   IRN, cancel, pull again once the portal shows them, then push." Unticked,
   the push is refused. Ticked, they go up from the books and the push's
   UPLOAD row in Version History gets an "E-invoice override" note naming
   them, only when the upload was accepted or partial: a failed row (one
   written before the file was attached, for example) uploaded nothing and
   gets no note (second review N4). The page appends it once the extension
   has written the row; if the row never appears, or the outcome is not
   known (the portal tab was closed after the file was attached), the note
   is not written and the toast at the start of the push is the only record.
   The push re-reads the records, and a pending document that was not in the
   dialog when it was ticked blocks again. The panel and the dialog never
   say that a pending document is already on the portal, or that the portal
   will add it.
6. **The evidence could not be read** (review E9, E15). For a client that
   is not ticked "E-invoice applicable", the protection rests on
   `client_einvoice_evidence` (§7). Only when that function does not exist
   (PGRST202 / 42883: the migration is not applied) does the tick alone
   decide. Any other error (a network drop, a timeout, a server error) is a
   failed read, not a "no": Upload and Download JSON read the evidence again
   whenever the cached answer is another client's or was not read from the
   evidence, and if it still fails they refuse: "Could not check whether
   this client issues e-invoices, so nothing was uploaded. Try again." The
   page shows a problem line with a Retry button while the read is failing.
7. **The return changed after the plan.** The extension refuses a push
   whose stored row's `updated_at` differs from `basisUpdatedAt` (§1).

## 5. What warns

The upload dialog lists these. Staff go on deliberately:

- **IRN not in books** (`not_in_books`). The e-invoice stays on the portal
  and will be filed with the return. Either the books are missing a
  document, or the IRN should have been cancelled on the IRP.
- **Pending, not in the books** (`warnings.pending`). Not on the draft yet
  and not in the upload: if GSTR-1 is filed before a pull shows it on the
  draft, it is missing from the return. Do not file until a pull shows it,
  or add it to the books. (A pending document that *is* in the books
  blocks, §4.5.)
- **Auto-population failed** (`warnings.autopopFailed`, books copy present).
  The books document goes up without its IRN. The Excel's error text says
  why.
- **IRN lost on the portal** (`warnings.irnLost`, books copy present). The
  books document goes up. An upload cannot restore the IRN (§10).
- **Missing from the return** (`warnings.missingFromReturn`, review E5).
  Auto-population failed, or the IRN was lost, and the books do not have the
  document: it is not in the upload, and not among the documents the pull
  saw on the draft with an IRN. "N e-invoice(s) are not among the IRN
  documents on the portal draft and not in the books: they will be missing
  from GSTR-1 unless added to the books (or the IRN was cancelled). If they
  are on the portal without their IRN, they will be filed as uploaded." The
  pull stores only documents that carry an IRN, so a document edited on the
  portal (its IRN dropped, para 6), or one whose auto-population failed
  because its number was already uploaded, is still on the draft and is
  filed (second review N6). The panel shows such a row as "Not in books, not
  on the draft with its IRN: missing from GSTR-1". It warns rather than
  blocks: a cancelled IRN can look the same.
- **Shipping bill** (`warnings.shippingBill`). An export left out to keep its
  IRN whose books shipping bill the e-invoice lacks: add it on the portal or
  through Table 9A (§3).

### Download JSON

The manual "Download JSON" path plans like the push: it reads the evidence
and the records afresh, refuses a client whose evidence read fails (§4.6),
refuses while a pull is running or when a pull moved while the records were
read (§4.3), and leaves out the same documents. It does **not** leave out
nothing when there is no pull of the day (review E4): such a file, uploaded
by hand, would overwrite every auto-populated e-invoice and drop its IRN.
Instead the toast says exactly what was left out and on whose word: the
pull (today's, the last successful one with its time, or an earlier one
when the last attempt failed or served an old file), the e-invoice Excel,
or the IRN in the books JSON, each with its count. Without a pull of the
day it first says why, in the pull's own terms: none for this period, the
last pull was on another day, today's (or the last) pull got a file the
portal generated earlier and saved nothing (second review N1: it no longer
says "not pulled today" after a stale pull of today), or the last pull did
not finish. Then: "A document edited or deleted on the portal since would
be missing from the return. Pull e-invoices and download again before
uploading it on the portal." (after an old file, whose words already give
the steps to a fresh one: "Download again after that pull"). A file that
leaves nothing out without such a pull says so too.

Without a pull, an Excel record with no status or "pending" is judged
against today: pending while IRN date + 2 days is not before today, so it
is **not** left out (the books copy is in the file, its IRN will not be
linked), lost after (§3). Only an Excel record that says auto-populated is
taken at its word and left out (with, as before, a books document carrying
its own IRN), which is what the toast's warning is for.
Pending documents in the books are in the file (their IRN will not be
linked), and the pending-not-in-books (second review N5),
missing-from-return and shipping-bill warnings are repeated.

## 6. The Excel import

**Since extension 0.9.0 the pull downloads it.** The e-invoice pull opens the
month's GSTR-1 (Prepare Online), presses "Download details from e-invoices
(Excel)" and hands the file to the GSTR-1 page, which imports it as below for
the pull's client and month, without the confirmation a hand-chosen file gets
(the pull was the request). Up to 500 e-invoices only: a larger month comes
through "E-invoice download history" and is imported by hand.

GSTN's **"Download details from e-invoices (Excel)"** is on the GSTR-1
dashboard: Returns dashboard → period → GSTR-1 → Prepare Online. It is
built from the IRP's data and lists every e-invoice of the period,
cancelled ones included. For each document it gives:

- the IRN and the IRN date;
- the e-invoice status (Valid or Cancelled);
- the date of auto-population or deletion;
- the auto-population status (Auto-populated, Deleted, Auto-population
  failed or Deletion failed);
- an error description.

(Advisory paras 9 and 10; advisory v3 paras 12 to 14.) Up to 500 documents
download at once. Larger files come through "E-invoice download history" as
a ZIP that holds the workbook (`EINV_<GSTIN>_<FY>.zip`). The page unzips it
before parsing. The file shows what the IRP sent and does not reflect later
edits in GSTR-1 (para 7). That is why the pull wins (§3).

The Excel is the only source for these cases:

- e-invoices not yet on the draft (pending);
- e-invoices that failed auto-population;
- IRNs that an earlier upload has already wiped from the draft.

`parseEinvoiceExcel(workbook, { supplierGstin })` reads it:

- **Sheets.** "Read me" supplies the GSTIN, Tax Period (MMYYYY), Financial
  Year and "Date Updated till". The page must check the GSTIN and period
  against the selected client and month before saving. The document sheets
  are "b2b, sez, de", "cdnr", "cdnur" and "exp", as the user-guide
  screenshot shows. "hsn(b2b)" and "hsn(b2c)" are skipped.
- **Header row.** It is the row with a cell reading exactly `IRN`. Each
  column is mapped by the pattern of its header, never by position.
- **Rows.** The rows of one document (one per rate) are summed into one
  document. The document value is taken once. Amounts like "1,23,456.00"
  are read as numbers. Dates may be dd-MMM-yyyy, dd-mm-yyyy, ISO or Excel
  serial numbers.
- **Taxes.** Tax amounts come from their own columns when the sheet has
  them. Otherwise they are Rate × Taxable value × Applicable %: IGST
  between states, for SEZ and for exports; CGST and SGST halves within the
  state. Supplies without payment of tax carry no tax.
- **Unreadable data.** A sheet or row the parser cannot read goes in
  `skipped` with a reason. The parser never throws.
- **Reverse charge, type, e-commerce GSTIN, shipping bill.** "Reverse
  Charge" (Y / N), "Invoice Type" / "Note Supply Type" / "Export Type",
  "E-Commerce GSTIN" and, on the exp sheet, "Shipping Bill Number",
  "Shipping Bill Date" and "Port Code" are read for the checks in §3. They
  are saved in the record's `raw`, where the page also finds them for a
  pulled record.
- **Saving.** One call, `einvoice_excel_replace(client, period, docs,
  message, actor)`, in **one transaction**: it deletes the period's
  `einvoice_excel` rows, inserts the new ones and upserts the
  `einvoice_pulls` row with the same source (review E10, E16). Any error (a
  CHECK, the unique key, a bad value) rolls all three back, so a failed
  import leaves the earlier one exactly as it was. Whatever happens, the
  page then re-reads the records, so the panel and the dialog never show
  records that are gone.

**Verified:**

- the sheet names and the first fields (user-guide screenshot);
- "E-invoice status", and the fact that GSTN's offline tool imports this
  file and skips rows whose status is "Cancelled" (`service/offline.js`);
- the GSTR-1 template headers (`translation-en.json`, release 3.2.4).

**Not verified** against a downloaded file:

- the exact text of the auto-population headers;
- whether tax amounts have their own columns;
- the label of a pending status. A blank status with a valid IRN is read
  as "unknown", which counts as pending or lost by the IRN date (§3), as an
  explicit pending status does: lost once IRN date + 2 days is before the
  pull day, or before today when there is no successful pull.

## 7. Who is an e-invoice client: evidence, PAN-wide

The e-invoice panel, the pull and the push gate follow
**`client_einvoice_evidence(client)`**, not the turnover assessment and not
the exemption. It returns `issues_einvoices` with a plain reason. A client
issues e-invoices when it, or any registration on the same PAN (GSTIN
characters 3 to 12), meets any of these:

- it is ticked "E-invoice applicable";
- it has e-invoice records (`einvoice_docs`);
- a stored GSTR-1 JSON, imported (`gstr1_data`) or filed
  (`gst_filed_returns`), carries an IRN (64 hex characters) or `srctyp`
  E-Invoice.

E-invoicing follows the PAN's aggregate turnover (rule 48(4)), so one
registration's IRNs make every registration on the PAN an e-invoice client.

When the evidence cannot be read for a client that is not ticked, the app
does not guess: Upload and Download JSON refuse until it can (§4.6). Only a
database without the function lets the tick decide alone.
Evidence on the client itself is preferred to a sister registration's.
`client_einvoice_evidence_all()` gives the same for every client, for the
Clients page.

**A GTA or other exempt client that issues IRNs is still handled.** The
evidence ignores `clients.einvoice_exemption`. SUNRISE LOGISTICS (GUJ)
appears to be a GTA (inferred: every B2B invoice is reverse charge), yet
put 52 of 52 B2B invoices on the IRP in Aug-26. "Must e-invoice" (turnover, exemption:
`threshold.ts`) drives the alerts. "Issues e-invoices" (evidence) drives
the protection.

Live on 10 Oct 2026, the evidence finds these 7 clients:

- SUNRISE LOGISTICS (GUJ) and SUNRISE LOGISTICS-MH (same PAN);
- SHYAM GIRDHAR;
- SBL-UK, plus SBL-GJ, SBL-GOA and SHREEJIKRUPA BUILDCON (same PAN).

It does **not** find ACCURATE PMS, VISHVAS POLYPACK or PRIDE DRUGS, whose
turnover suggests e-invoicing. No stored JSON of theirs carries an IRN.
Tick them by hand once the firm confirms.

## 8. Records

- `einvoice_docs`: one row per document per source. `irn_status`,
  `autopop_status`, `autopop_date` and `error` come from the Excel. A pull
  upserts every document it sees with `last_seen_at = now` and `gone_at =
  null`. Only after every upsert succeeds does it select the period's
  `portal_gstr1` rows (id and identity), work out in the extension which
  ones this pull did not see, and set `gone_at = now` on those, by id, in
  chunks. It **never deletes** them (review E6, E11): the row keeps the only
  copy of that IRN in the app, and reads as `irn_lost` ("IRN lost on the
  portal") instead of "No IRN found". Selecting by identity rather than by
  `last_seen_at < now` uses no clock, so no PC's clock decides what is gone
  (review E7). `last_seen_at` is a record only: the page never compares it
  (§3). A stale pull (§4.3) saves nothing and marks nothing.
- **Two pulls of the same return can still mark each other's rows.** Each
  marks gone whatever it did not see itself, so if two pulls of one period
  overlap (two PCs, seconds apart) and the draft changed between their
  files, a document only the other pull saw can end up marked gone: it then
  reads `irn_lost` and goes up from the books (on the draft it would have
  been left out). And the pull that finishes first writes its final status
  over the other's `running` while the other may still be saving, so a push
  read in that moment is not refused. Pull a return from one PC at a time.
- `einvoice_pulls`: the last pull or import per (client, period, source).
  `pulled_at` is exactly the `now` the pull stamped on `last_seen_at` (the
  pulling PC's clock). `generated_on` is the date the portal generated the
  pulled file. `status` is `running`, `ok`, `none`, `pending`, `failed` or
  `stale`. **`running`** is written before the pull's first record and
  replaced by its final status after its last (§4.3); a failure part-way
  through the save ends `failed`, never `running`; a file for another client
  or period, or a stale one, writes no record and goes straight to its final
  status. If the final write itself fails (the connection drops), the row
  stays `running` and the push stays refused until a pull finishes: pull
  again. `recorded_at` is the database's own time of the row's last write,
  set by a trigger on every insert and update, whatever the writer sends.
- `gstr1_upload_versions`: `einvoice_kept` and `ext_version` on UPLOAD rows;
  the pending override note in the summary (§4.5).

**"Pull again to confirm"** (review E12). After a push that reached the
portal, the panel asks for a pull to confirm the IRNs are intact. The push
time comes from Version History: the newest UPLOAD row that records
`einvoice_kept` (the push carried an e-invoice plan; an `ext_version` of
0.8.7 alone is not enough, second review N8) that was accepted or partial,
or a failed one whose outcome a later Refresh errors found accepted or
partial. It is not `gstr1_data.last_uploaded_at`, which Refresh errors
rewrites. A successful pull that finished after that time clears it. Both
times are the database's: the row's `action_at` and the pull row's
`recorded_at` (second review N3; the pull's own `pulled_at` is the pulling
PC's clock, which may run fast). A pull row without `recorded_at` falls back
to `pulled_at`. "Already on the portal" counts only `matched` and
`books_irn` documents.

## 9. What has NOT been verified live

No push that leaves documents out has reached the portal yet. Before the
firm relies on it:

1. **One controlled live push.** Use one e-invoice client and one open
   period with several auto-populated e-invoices.
   - Pull. Push with the plan, so `einvoice_kept` is greater than 0. Pull
     again.
   - Every kept document must still show Source E-Invoice and the same IRN.
   - Every uploaded document must be there with the books figures.
   - On the portal: B2B, then Display/Hide Columns, then Check All.
2. **The Excel's real headers.** Import a real file and check that
   `skipped` is empty and the totals match the portal.
3. **What an upload over an auto-populated document does.** Para 6 says it
   drops the IRN. No live push has shown it either way (the audit found
   none conclusive).
4. **Whether `flag=0` returns a cached older generation** of the GSTR-1
   JSON. The extension's own notes say a period generated before answers
   at once with the cached file. The stale-file rule (§4.3) now refuses a
   file generated on an earlier day; one generated earlier the same day
   still passes. Every pull that confirms a push (9.1, §10(b)) must be of a
   file generated after that push: generate a fresh file on the portal
   first.
5. **IFF months for QRMP clients.** The pull asks `rtn_typ=GSTR1`.

## 10. Remediation: returns already pushed without IRNs

Two Sep-26 returns went up as books JSONs with no IRN, before this
mechanism existed:

- **SUNRISE LOGISTICS (GUJ), Sep-26.** Pushed 9 Oct 2026, 10:11 UTC,
  accepted, with 48 B2B and 2 CDNR documents. Not filed.
- **SHYAM GIRDHAR, Sep-26.** Pushed 10 Oct 2026, 06:06 UTC, partial, with
  21 B2B and 1 CDNR documents. The error report has not been read.

If the portal treated those uploads as edits (para 6), the IRNs are no
longer on the draft. For each of the two returns:

1. Download the e-invoice Excel for Sep-26 and import it. It keeps the IRN
   record whatever the draft now shows.
2. Pull. Documents still on the draft with an IRN read as `matched`. Those
   the Excel says were auto-populated earlier, but the pull lacks, read as
   `irn_lost`.
3. For SHYAM, run Refresh errors first, to learn which records the portal
   rejected. That is also the first live evidence of how the portal treats
   an upload over an e-invoice.
4. Decide, per return (a firm decision):
   - **(a) Accept.** File as it stands. The IRNs stay valid on the IRP.
     GSTR-1 shows the documents as the taxpayer's own.
   - **(b) Delete the affected documents on the portal and wait for
     auto-population to run again.** GSTN does not document whether a
     deleted document is auto-populated again. Para 3(c) covers only
     documents that already exist. Try it on one document first, and file
     only after a pull of a freshly generated file (§4.3) shows the IRN
     back.

Returns already filed without IRNs cannot be changed. The audit inferred
these as e-invoice issuers: ACCURATE PMS, SBL-GJ and VISHVAS POLYPACK,
Sep-26. Keep the e-invoice Excel for each such period on file.
