# Vendor GSTIN Risk Report

Reports Hub → GSTR-2A/2B Reports → **Vendor GSTIN Risk Report** (`vendor-gstin-risk`,
one client, the FY of the month picked, `periodScope: 'fy'`). One row per supplier
GSTIN, 26 columns (registration, composition, RCM, TDS / TCS, e-invoice, GSTR-1 /
GSTR-3B filing, 2B matching, ITC eligibility and risk, provision, action,
verification date, source, remarks), a management summary and three action lists.
The positions in §4 are **the firm's elected positions, set by engineering
judgement, not confirmed in a firm sign-off**; change them in
`src/lib/vendorRisk/rules.ts` and here together.

## 1. Code

| Part | File |
| --- | --- |
| GSTIN structure and check character (pure) | `src/lib/vendorRisk/gstin.ts` |
| Findings: band, nature, provision, action; thresholds; limitations (pure data) | `src/lib/vendorRisk/rules.ts` |
| Engine (pure: plain data in, rows and summary out) | `src/lib/vendorRisk/engine.ts` |
| Reads, and the vendor master upload | `src/lib/vendorRisk/load.ts` |
| ReportTable for the Big4 Excel / PDF | `src/utils/vendorRiskReports.ts` |
| Preview (tabs: Vendors, Management summary, the lists) | `src/components/reports/views/VendorRiskView.tsx` (`viewKind: 'vendor-risk'`) |
| Pull (Search Taxpayer) | `src/lib/vendorRisk/gstinSearchPull.ts` (below) |
| Checks | `node scripts/verify-vendor-risk.mjs` |

## 2. Sources

Every finding names its source and date in the Reason column ("[GST portal Search
Taxpayer (20-Nov-2026)]"), and the Data Source column lists every source the row read.

- **Vendor universe.** Each `ctin` of the FY's portal GSTR-2A / 2B (April to March,
  `gst_filed_returns`, read by `src/lib/itcReco/sources.ts`), `twob_import_docs`,
  `books_register`, the open items of `bills_not_in_2b` / `bills_not_in_books` and the
  uploaded vendor master (`vendor_master_entries`). The client's own GSTIN is left out.
  A vendor only in the master is a row with "No purchases seen in FY".
- **Names.** Vendor master, else the books (most frequent), else the 2B / 2A trade name.
- **Portal lookups.** `vendor_gstin_latest` (one row per GSTIN). When the view is not
  there (migration not applied) or a GSTIN has no row, the registration fields read
  "Verification required — run Pull (Search Taxpayer)" and the row is No Data unless
  other evidence (the GSTIN itself, 2A's `dtcancel`, the ledgers) gives a finding.
- **Filing.** The lookup's filing table; else 2A / 2B (`cfs`, `cfs3b`, `supfildt`) and
  the GSTR-2A vs 2B reconciliation reasons (`NOT_FILED_BY_SUPPLIER`, filed after the
  cut-off, `VALUE_DIFFERENCE`), run per FY month with `reconcile2A2B` where both are pulled.
- **2B matching.** The ledgers at the FY's latest month holding entries: open Not in 2B
  (`reclaim_month` empty), open Not in books (`book_entry_month` empty); 2B's
  `itcavl = N` and Rule 37A reversal entries.
- **E-invoice.** The lookup's turnover slab and e-invoice flag; IRNs on the vendor's
  2A / 2B / Import 2B documents. Threshold `EINVOICE_THRESHOLD` (`src/lib/einvoice/threshold.ts`).
- **Vendor master upload.** `.xlsx` / `.xls` / `.csv`; the header row (any of the first
  25 rows of a sheet) needs a GSTIN column and a name column, a code column is optional;
  repeated GSTINs kept once; it replaces the client's earlier upload (new rows written
  first, then the earlier ones removed).

## 3. The GSTIN itself (`gstin.ts`)

The GSTN mod-36 check character (the same algorithm as `src/lib/gstr1/validate.ts` and
`notice-ai/gstin.ts`), the state code (01–38, 97, 99), the PAN and its holder status
(4th character), the 13th character (registration number under the PAN). Kinds by
shape: normal (14th `Z`); TDS deductor (TAN-shaped, 14th `D`) and UIN / NRTP (the GSTR-1
offline tool's formats); **TCS (14th `C`) and OIDAR (`99…OS…`) are heuristics**, said as
"appears to be". Composition, casual, SEZ or ISD cannot be told from the shape. Several
GSTINs under one PAN are noted as "Multiple registrations" (never a risk by itself).

## 4. Positions (elected)

1. **Bands.** Critical: invalid GSTIN with ITC booked or documents (Medium when only in
   the master), not found on the portal, cancelled, retrospective cancellation, suspended,
   2A cancellation date. High: composition taxpayer with tax charged, e-invoice liable by
   the portal (slab ≥ ₹5 crore or the e-invoice flag) with B2B documents lacking an IRN,
   GSTR-1 / 3B missing for 2 or more due periods, Rule 37A reversal in 2B, material open
   Not in 2B, booked with tax but in no 2B of the year. Medium: name mismatch, one period
   not filed, late filing, saved-but-not-filed GSTR-1, 3B pending per 2A, value
   differences, ITC not available in 2B, minor Not in 2B, duplicate booking, TDS / TCS
   GSTIN, a non-Active status, some invoices with an IRN and some without, a lookup older
   than 90 days. Low: active on the portal, with filing evidence, and nothing above.
   No Data / Verification Required: anything else, in particular no lookup.
2. **Confirmed / Potential risk / Verification required.** Confirmed: a portal record or
   the GSTIN shows it. Potential: the evidence points to it. Verification required: not
   enough data. The row's nature is the strongest among its top-band findings.
3. **Missing data is never non-compliance.** A lookup not run or a return not pulled is
   No Data; the filing table is judged only when it holds the FY (any return type); a
   cancelled vendor's periods after the effective date are not due.
4. **No blanket ineligibility.** Cancelled: documents before the date are "conditionally
   eligible" (s.16(2)(c)); on or after: "potentially ineligible", with the note that courts
   have allowed ITC where the supplier filed and paid. Composition: "no ITC arises" on a bill
   of supply; tax charged after opting in is not ITC (s.10(4)), before opting in it is.
   RCM: s.9(3) / 9(4), pay then claim. TDS / TCS GSTINs (s.51 / 52) are not supplier
   registrations: "verify".
5. **Material mismatch:** open Not in 2B tax ≥ ₹25,000, or ≥ 10% of the vendor's ITC in
   the books for the year and at least ₹1,000 (`MATERIAL_*`).
6. **Persistent non-filing:** 2 or more due periods without a filing (`PERSISTENT_MISSING`);
   due dates GSTR-3B 20th (quarterly 24th), GSTR-1 11th (quarterly 13th); a vendor whose
   filings are all quarter-end months is read as quarterly (an inference).
7. **E-invoice:** applicable when the slab's lower bound is ≥ ₹5 crore or the portal flag
   says so (Confirmed), or when an IRN is seen on any of its documents (Potential; checked
   from the first IRN's date); "No" for an exempt class (SEZ unit, government) or a slab
   wholly at or below ₹5 crore (with the remark that an earlier year may still apply).
8. **Hold list:** only findings where a provision supports withholding the ITC (invalid /
   not found GSTIN, retrospective cancellation, suspension, composition tax charged, e-invoice
   without IRN, persistent non-filing, material mismatch, booked but in no 2B), phrased
   "hold pending verification"; the 180-day payment condition still runs.
9. **ITC involved** is the vendor's ITC available in the year's 2B, else in the books.

## 5. Limitations

The IRP's e-invoice enablement search is CAPTCHA protected and not automated; the
cancellation reason only where the portal search shows it; lookups not run are
"Verification required"; the turnover slab is the latest year the portal shows; the
filing table as last pulled (`LIMITATIONS` in `rules.ts`, printed on the report).

## Search Taxpayer lookup (extension 0.19.0)

The report's **Pull** looks up the client's suppliers on the GST portal's
logged-in *Search Taxpayer* and keeps every answer in
`vendor_gstin_lookups` (migration `20261127140000_vendor_gstin_risk.sql`).
A GSTIN's registration is public and the same for every client, so a lookup
row has no `client_id`; `via_client_id` records only whose portal login made it.

### What a Pull asks for (`src/lib/vendorRisk/gstinSearchPull.ts`)

`planVendorGstinSearch({ clientId, periods, extVersion })`:

- **Which GSTINs.** The client's suppliers over the financial year of the months
  picked, from every place the app holds them: each `ctin` in the pulled
  GSTR-2A / GSTR-2B summaries (`gst_filed_returns`), `twob_import_docs.supplier_gstin`,
  `books_register.supplier_gstin` and the uploaded vendor master
  (`vendor_master_entries.gstin`, any upload of the client). Only GSTINs with a
  known shape and a good check character (`checkGstin(...).valid`), never the
  client's own.
- **Only what is stale.** A GSTIN with an `ok` or `not_found` lookup in the last
  30 days (`vendor_gstin_latest.looked_up_at`) is left out; never looked up first,
  then the oldest. With none stale, all of them again (a refresh, said in a note).
- **At most 150 a Pull** (about three paced portal requests each, ~10 minutes);
  the note says how many are left for the next click.
- **Extension version.** The plan starts nothing and says "needs browser extension
  v0.19.0" only when the installed extension is older (or did not say its
  version). `MIN_EXTENSION_VERSION` is unchanged (0.16.0): every other screen
  keeps working with 0.18.7.
- The job is `{ mode: 'gstin_search', periods: [first month of the FY], gstins, label }`;
  `ReportsPage` passes `gstins` to the extension with the usual `__gstkPullSection`
  message (with the app user's `actorId`), and re-checks an open preview for
  about 5 seconds a GSTIN.

### What the extension does (`extension/content.js`, `handleGstinSearch`)

1. The client's usual login (CAPTCHA typed by a person, the session identity
   check), then `services/auth/fowelcome`.
2. For each GSTIN, from that page (same origin, the session's cookies), one
   request at a time, **1.5 s apart**:
   - the taxpayer's details;
   - if found, the return filing table; asked once more with the job's FY
     (`2025-26`) when the plain ask brings none.
3. One `vendor_gstin_lookups` row per GSTIN, inserted through the extension's
   usual `/rest/v1` path (`saveVendorGstinLookup` in `background.js`, which sends
   `x-gst-source: extension` and `x-gst-actor` = the job's `actorId`):
   `status` `ok` / `not_found` / `error`, `error` (the reason or the portal's
   words), `looked_up_by` (the app user), `via_client_id`, `extension_version`,
   and `payload` = the portal's answers as they came, with the address that gave
   each (`{ details: {url, status, body}, returns: [...] }`; for an error, every
   address tried). `looked_up_at` is the database's clock.

**It stops, never loops:** a dropped session (HTTP 401 / 403, the login page, a
"session expired" answer), a CAPTCHA asked for, no Search Taxpayer address
answering at all, three failed lookups in a row, or two saves GST Keeper did not
take. The GSTIN in flight gets an `error` row; the rest are not asked, and the
banner counts found / not found / failed / not reached. Pull again takes the rest
(they are still stale). A reload resumes after the last saved GSTIN.

**No CAPTCHA is ever solved or bypassed.** The public search
(`services/api/search/taxpayerDetails`) needs one and is never called; only the
logged-in `/services/auth/` services are.

### Endpoints (not confirmed live, 27 Nov 2026)

Tried in order for the first GSTIN; the first that answers (a taxpayer, or "no
such GSTIN") is kept for the rest of the job. An address answering 404 / 405 or
an HTML page is skipped, and a JSON 404 that is only the server's own "Not
Found" is not taken for "no such GSTIN".

| Purpose | Request |
| --- | --- |
| Details | `POST https://services.gst.gov.in/services/auth/api/search/tp` `{ gstin }` |
| Details | `POST https://services.gst.gov.in/services/auth/api/search/taxpayerDetails` `{ gstin }` |
| Details | `GET https://services.gst.gov.in/services/auth/api/search/tp?gstin=` |
| Filing table | `POST https://services.gst.gov.in/services/auth/api/search/taxpayerReturnDetails` `{ gstin }`, then `{ gstin, fy }` |
| Filing table | `GET https://services.gst.gov.in/services/auth/api/search/taxpayerReturnDetails?gstin=` (`&fy=`) |

"No such GSTIN" is read from the answer's words (`no record`, `not found`,
`invalid GSTIN`, …, codes `SWEB_9035`, `SWEB_9022`, `FO8000`): also not confirmed
live. Once the first live run is seen, the `payload` of its rows shows what the
portal sent; fit the list and the mapping to it.

### Field mapping (portal key → column)

The taxpayer object is the answer itself or its `data` / `taxpayerInfo` /
`taxpayerDetails` / `result` wrapper (a JSON string there is parsed).

| Column | Portal key |
| --- | --- |
| `legal_name` | `lgnm` |
| `trade_name` | `tradeNam` (or `tradeName`) |
| `reg_status` | `sts` (as worded: Active, Cancelled, Suspended, …) |
| `reg_date` | `rgdt`, dd/mm/yyyy → ISO date (an impossible date is NULL) |
| `cancel_date` | `cxdt`, dd/mm/yyyy → ISO date (blank → NULL) |
| `cancel_reason` | `cxRsn` / `cancelReason` / `cnclRsn` (key not confirmed) |
| `taxpayer_type` | `dty` |
| `constitution` | `ctb` |
| `state_jurisdiction` | `stj` |
| `centre_jurisdiction` | `ctj` |
| `address` | `pradr.adr`, else `pradr.addr` parts (`bno, bnm, flno, st, loc, city, dst, stcd, pncd`) joined |
| `nature_of_business` | `nba` (array; a single string becomes one item) |
| `ato_slab` | `aggreTurnOver` + ` (FY ` + `aggreTurnOverFY` + `)` |
| `einvoice_status` | `einvoiceStatus` (a boolean becomes Yes / No), else NULL |
| `filings` | every object with `rtntype` in the filing answer (`filingStatus: [[...]]` or any array): `{ rtntype, fy, taxp, dof (ISO), status, mof }`; `[]` when the answer holds an empty list; NULL when no table was read |

### Tests

`extension/test/23-gstin-search.test.mjs` (the real `background.js` and
`content.js` against a fake portal and database): the job carries its GSTINs and
no other mode's does, the mapping, `not_found`, the fallback address, session
expiry, CAPTCHA, no address, a server 404, three errors in a row, a bounce to the
login page, a database refusing the rows, and a resumed run.
