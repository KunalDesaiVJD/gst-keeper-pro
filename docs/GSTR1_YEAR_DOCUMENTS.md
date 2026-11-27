# GSTR-1 Documents — Full Year (Reports Hub)

Report key `gstr1-documents-full-year` (27 Nov 2026). For one client and financial
year it lists every document of every section of each month's **filed** GSTR-1 in
one working paper, with a Month column.

## Where the figures come from

- Only the filed return, stored in `gst_filed_returns.full_json`; the app's own books
  draft (`gstr1_data`) is never mixed in.
- **Pull** (`planGstr1JsonYear`, `src/lib/reportPullPlans.ts`) asks for every month of
  the FY, up to last month, that is missing or incomplete, in one run:
  - extension **0.19.1** or later: `gstr1_full_pull`. Per month: the GSTR-1 summary
    (sections, record counts, customers); the portal's offline file if it is ready
    (otherwise the request starts it); without the file, every section read from the
    portal's GSTR-1 view, customer by customer for B2B / CDNR and their amendments,
    state by state for B2CL, three tries a read. What was read is checked against the
    summary's counts and saved with that record in `full_json._gstk`. A month left
    incomplete is tried once more at the end of the run, waiting up to 3 minutes for
    its file. A dropped session logs in again and resumes the same month.
  - an older extension: 0.18.7's `gstr1_json_pull` (the offline file only, up to 90
    seconds a month), with a note to update.
- Month-wise shows each month as Complete (portal file / read section by section),
  Incomplete (what is short, e.g. "B2B 40 of 42 (2 parties did not answer)"),
  Generating, Pull failed, Not filed or Not pulled. Pull reads incomplete months again.
- Not confirmed live (27 Nov 2026): the section addresses `api/gstr1/<section>`;
  `_gstk.sections.<SEC>.api` records which answered and `.problem` what did not.

## What it shows

- **Section summary** (printed first): FY totals per section and sub-section.
- **Documents**: one row per document line of B2B (4A/4B/6B/6C), B2CL (5), exports
  (6A), B2CS (7), CDNR / CDNUR (9B), every amendment table (B2BA, B2CLA, EXPA 9A;
  CDNRA, CDNURA 9C; B2CSA 10; ATA, TXPDA 11), advances (AT, TXPD 11),
  e-commerce (14 SUPECO, 14A, 15 ECOM, 15A). Original document number, date and
  month for amendments; anything else in the portal's row goes to Other details.
- **Month-wise**: each month's pull status and net totals.
- **HSN (Table 12)**, **Documents issued (13)**, **Nil, exempt, non-GST (8)**.

The walk (`src/lib/gstr1Year/flatten.ts`) reads sections by shape, so a section the
portal adds later still appears under its own key rather than being dropped.

## Positions

- Amounts in Documents are as on the return. Totals take credit notes off and add
  debit notes.
- Amendment tables count at their revised figures, as the portal holds them; they
  are not netted against the original month.

Check: `node scripts/verify-gstr1-year-docs.mjs`.
