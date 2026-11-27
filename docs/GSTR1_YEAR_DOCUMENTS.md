# GSTR-1 Documents — Full Year (Reports Hub)

Report key `gstr1-documents-full-year` (27 Nov 2026). For one client and financial
year it lists every document of every section of each month's **filed** GSTR-1 in
one working paper, with a Month column.

## Where the figures come from

- Only the portal's own "Offline Download for GSTR-1" of each month, pulled by the
  extension's existing `gstr1_json_pull` mode (0.18.7 and earlier; one run walks
  every month asked) and stored in `gst_filed_returns.full_json`.
- The app's own books draft (`gstr1_data`) is never mixed in: a month not pulled is
  shown as "Not pulled", "Generating on the portal", "Pull failed" or "Not filed".
- **Pull** (`planGstr1JsonYear`, `src/lib/reportPullPlans.ts`) asks for each month
  of the FY, up to last month, with no stored JSON; with all held, it pulls the
  months picked again. A month still generating on the portal (large returns can
  take about 20 minutes) is pulled again on the next click.

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
