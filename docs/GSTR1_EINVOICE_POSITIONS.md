# GSTR-1 e-invoices (IRN): positions

How the app keeps each e-invoice's IRN on the GST portal when it pushes a
client's GSTR-1. Read this before changing `src/lib/einvoice/einvoice.ts`,
`src/lib/einvoice/excel.ts`, the e-invoice parts of the GSTR-1 page, the
extension's GSTR-1 upload or e-invoice pull, or
`supabase/migrations/20261013100000_einvoice_keep_irn.sql`.

**Engineering wrote these positions on 10 Oct 2026 from GSTN's own documents
and an audit of the live data. The firm has not signed them off yet, and
the mechanism has not yet been seen working on the live portal (§9).**

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

So, at push time, every books document in B2B, CDNR, CDNUR or EXP that
matches an e-invoice record with the same figures is **left out** of the
uploaded JSON. The portal keeps its own record, with the IRN. Everything
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
  It sends `einvoice: { keep, planAt }` in `__gstkUploadGstr1`. `keep` lists
  the books documents to leave out, using the exact `section`, `ctin`,
  `doc_type` and `doc_no` from the stored raw_json.
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
| `matched` | On the draft as an e-invoice. Figures (±₹1), date and place of supply are the same. | **Left out** |
| `books_irn` | The books document carries its own IRN (a portal download) and there is no record against it. | **Left out** |
| `pending` | From the Excel: IRN generated, auto-population not done yet. | **Left out** if the books have it with the same figures. If the books do not have it, a warning (§5). |
| `mismatch` | Same document, but its figures, date, place of supply or IRN changed after the IRN. Also a document that appears twice in the books. | **Blocks** |
| `number_differs` | No exact match, but the number differs only in separators or case from an e-invoice that is, or will be, on the draft. | **Blocks** |
| `not_einvoiced` | E-invoiceable, but no IRN was found. | Uploaded |
| `autopop_failed` | The Excel says auto-population failed or gave an error. | Uploaded, with a warning |
| `irn_lost` | It was an e-invoice, but the latest pull no longer shows it with its IRN. | Uploaded, with a warning |
| `not_in_books` | On the draft as an e-invoice, but missing from the books. | Warning |

Rules applied before the statuses:

- A cancelled IRN (Excel status Cancelled) is never used for anything.
- When the pull and the Excel both have a document, the pull wins, because
  the pull shows what is on the draft.
- A books document whose e-invoice **failed** auto-population is always
  uploaded. Leaving it out would drop it from GSTR-1.

`irn_lost` is an addition to the first contract. It applies only when the
page passes `pulledAt`, the time of the latest successful pull. The
document reads as lost in three cases:

- a pulled record that the latest pull did not see (`last_seen_at` more
  than 15 minutes before `pulledAt`);
- an Excel record that says it was auto-populated before the pull day, but
  is not in the pull;
- a books document with its own IRN that the pull does not show.

The portal no longer holds any of these as an e-invoice. Leaving them out
would keep a stale uploaded copy, or no copy at all, so they go up from
the books. Without `pulledAt`, each record is taken at its word.

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
3. **No fresh pull.** E-invoices reach the draft two days after the IRN, and
   one uploaded first is never auto-populated (para 3(c)). So the plan must
   rest on a pull taken on the day of the push. `isPullFresh` checks the
   same IST calendar day. A pull from the extension in the same session,
   just before the upload, is best.
4. **Extension below 0.8.7.** Older versions ignore `einvoice.keep` and
   would upload every document.

## 5. What warns

The upload dialog lists these. Staff go on deliberately:

- **IRN not in books** (`not_in_books`). The e-invoice stays on the portal
  and will be filed with the return. Either the books are missing a
  document, or the IRN should have been cancelled on the IRP.
- **Pending** (`pending`). If the books have it, it is left out and the
  portal adds it with its IRN. If not, it will appear in GSTR-1 anyway once
  auto-populated.
- **Auto-population failed** (`autopop_failed`). The books document goes up
  without its IRN. The Excel's error text says why.
- **IRN lost on the portal** (`irn_lost`). The books document goes up. An
  upload cannot restore the IRN (§10).

## 6. The Excel import

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
- **Saving.** The import writes `einvoice_docs` with `source =
  'einvoice_excel'`, and an `einvoice_pulls` row with the same source.

**Verified:**

- the sheet names and the first fields (user-guide screenshot);
- "E-invoice status", and the fact that GSTN's offline tool imports this
  file and skips rows whose status is "Cancelled" (`service/offline.js`);
- the GSTR-1 template headers (`translation-en.json`, release 3.2.4).

**Not verified** against a downloaded file:

- the exact text of the auto-population headers;
- whether tax amounts have their own columns;
- the label of a pending status. A blank status with a valid IRN is read
  as "unknown", which counts as pending or lost by the IRN date (§3).

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
  refreshes `last_seen_at` on every document it sees.
- `einvoice_pulls`: the last pull or import per (client, period, source).
- `gstr1_upload_versions`: `einvoice_kept` and `ext_version` on UPLOAD rows.

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
   JSON. That would make a same-day pull stale.
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
     only after a pull shows the IRN back.

Returns already filed without IRNs cannot be changed. The audit inferred
these as e-invoice issuers: ACCURATE PMS, SBL-GJ and VISHVAS POLYPACK,
Sep-26. Keep the e-invoice Excel for each such period on file.
