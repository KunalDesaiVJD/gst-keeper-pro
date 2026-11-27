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

## Search Taxpayer lookup (extension 0.19.0; the page flow since 0.19.2)

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
- **At most 150 a Pull** (each looked up on the portal's page, about 10 to 15 seconds;
  `ReportsPage` waits about 15 seconds a GSTIN);
  the note says how many are left for the next click.
- **Extension version.** The plan starts nothing and says "needs browser extension
  v0.19.2" (`GSTIN_SEARCH_VERSION`) only when the installed extension is older (or did not say its
  version). `MIN_EXTENSION_VERSION` is unchanged (0.16.0): every other screen
  keeps working with 0.18.7.
- The job is `{ mode: 'gstin_search', periods: [first month of the FY], gstins, label }`;
  `ReportsPage` passes `gstins` to the extension with the usual `__gstkPullSection`
  message (with the app user's `actorId`), and re-checks an open preview for
  about 5 seconds a GSTIN.

### What the extension does (`extension/content.js`, `handleGstinSearch`, 0.19.2)

**Seen live with 0.19.1 (27 Nov 2026).** 0.19.0 asked guessed API addresses from
fowelcome: `POST services/auth/api/search/tp` got the portal firewall's HTML
"Request Rejected … Your support ID is …" page, and `.../search/taxpayerDetails`
HTTP 403, which it took for a dropped session: the run stopped after one GSTIN
(0 found, 1 failed, 149 not looked up) with the person still logged in. 0.19.2
lets the portal's own page do the search instead.

1. The client's usual login (CAPTCHA typed by a person, the session identity
   check), then `services/auth/fowelcome`.
2. **The Search by GSTIN/UIN page**: the dashboard menu's own link (an `<a>`
   reading "Search by GSTIN/UIN", or one whose `href` holds `searchtp`), else
   `services/auth/searchtp`, else the public `services/searchtp` (which asks a
   CAPTCHA, see below). Each address is tried once; the one whose form shows is
   kept for the run (and opened again after a re-login).
3. **For each GSTIN, on that page**: typed into the GSTIN box (`#for_gstin`, else
   the visible text box whose id / name / placeholder / ng-model names GSTIN or
   UIN) with input / change / keyup / blur (as `setVal` fills every portal form),
   then Search pressed (`#lotsearch`, else the visible button reading "Search";
   once more after 15 s with no answer, never after a refused request). The result
   is the panel's labels for this GSTIN (the page's text names it, or the labels
   changed) or the page's own JSON for it; "No records found" / "invalid GSTIN"
   in the page's message elements (`.err`, `.alert-danger`, `[role=alert]`, …) or
   its JSON is `not_found`. Then **Show Filing Table** (a button or link reading
   so) and the table read; for each FY of the job that the page's FY dropdown
   offers (`2025-2026` or `2025-26`), that FY is chosen (and a Search / Go next to
   it pressed if the table does not change) and its rows read.
4. **Two sources, merged.** `inject.js` (page world) copies every
   services.gst.gov.in request whose address names search / taxpayer / return
   details (address, method, request body and headers, status, the answer) into
   `sessionStorage.__gstkGS`; the content script reads the copies made since its
   Search press. The JSON taxpayer and filing list are mapped as below; every
   column the JSON does not give is read off the page (label → value, a list's
   items for Nature of Business Activities and the jurisdictions). `payload`:
   `flow` (`page` / `replay`), `page` (the address), `sources` (per column:
   `json`, `page` or `replay`; filings `json`, `page`, `json+page`), `json` (the
   page's requests and answers), `dom.labels` (every label read and its value),
   `dom.filings`, `fys` (each FY: shown / read / not offered), `refused`,
   `replayOff`. An error row keeps the requests seen, the page's messages and a
   text snapshot of the page, so a wrong selector or mapping can be fixed from it.
5. **The faster path.** After a lookup whose details and filing table both came
   as JSON from the page's own `/services/auth/` requests carrying the GSTIN,
   those requests are sent again (same address, method, body and headers, the
   GSTIN swapped) for the next GSTINs. Any answer that is not that JSON (the
   firewall's page, a 403, …) turns this off for the rest of the run and that
   GSTIN is looked up on the page. The public CAPTCHA API
   (`services/api/search/taxpayerDetails`) is never called by GST Keeper.
6. One `vendor_gstin_lookups` row per GSTIN, inserted through the extension's
   usual `/rest/v1` path (`saveVendorGstinLookup` in `background.js`, which sends
   `x-gst-source: extension` and `x-gst-actor` = the job's `actorId`):
   `status` `ok` / `not_found` / `error`, `error` (the reason or the portal's
   words), `looked_up_by` (the app user), `via_client_id`, `extension_version`,
   `payload` as above. `looked_up_at` is the database's clock.

### Guardrails (`gsConf`)

| Situation | What happens |
| --- | --- |
| "Request Rejected" page, HTTP 403 / 404 / 405, an HTML answer to a request | "endpoint refused": the GSTIN is retried once (page reloaded), then an `error` row naming the refusal (and its support ID) and "the session was still open"; the run goes on. Never "session ended". |
| The session really ended | Only on evidence: the tab is on the login / error page, the page shows a login form, or fowelcome (opened to check after a failure on a page that shows no Logout) does. Then the client's usual login runs again, at most twice a run; the lookups resume from the GSTIN not yet saved (nothing is saved twice). A third loss stops the run with the reason. |
| A CAPTCHA on the search page | Never filled or solved. The banner reads "Type the CAPTCHA on the portal page to continue"; Search is pressed only once the box holds what a person (or the firm's own CAPTCHA extension) typed, steady for one poll. Not typed within 3 minutes: an `error` row for that GSTIN, and the next one. |
| No answer | 45 s a GSTIN (a CAPTCHA wait not counted), one retry after reloading the page, then an `error` row and the next GSTIN. |
| A "No records found" left on the page | The page is reloaded before the next GSTIN, so it is never read as that GSTIN's answer. |
| Failures in a row | The run stops after 5 failed lookups in a row, with the last reason; 4 then a success goes on. |
| GST Keeper does not take the rows | Two failed saves stop the run. |
| Pace and progress | 2 to 3 s between GSTINs; the banner shows "n of N" with found / not found / failed. A reload resumes after the last saved GSTIN; Pull again takes what was not reached (still stale). |

**No CAPTCHA is ever solved or bypassed**, and no OCR, solver, proxy or cloud
runner is involved: the CAPTCHA, where the page asks one, is a person's.

### Not confirmed live (27 Nov 2026)

- The logged-in Search by GSTIN/UIN address (`services/auth/searchtp`) and the
  menu text; the page's selectors (`#for_gstin`, `#lotsearch`, the result labels,
  "Show Filing Table", the FY dropdown and whether it needs its own Search) follow
  the public Search Taxpayer page.
- Whether the logged-in page asks a CAPTCHA (handled either way).
- The page's own request addresses and whether a replay of them is accepted (the
  replay turns itself off on the first refusal).
- The "No records found" / "invalid GSTIN" wording (codes `SWEB_9035`,
  `SWEB_9022`, `FO8000` in a JSON answer).

After the first live run, read a row's `payload` (`page`, `sources`, `json`,
`dom.labels`, `snapshot` on an error) and fit the selectors or the label list
(`gsLabelMap`) to it.

### Field mapping (portal key → column)

From the page's own JSON (or a replay of its request). A column the JSON does not
give is read off the page by its label (`gsLabelMap`): Legal Name of Business,
Trade Name, Effective Date of registration, Constitution of Business, GSTIN / UIN
Status, Taxpayer Type, Administrative Office / Other Office (state or centre by
the "(JURISDICTION - STATE / CENTER)" beside it), Principal Place of Business,
Nature of Business Activities, Date of Cancellation, Aggregate Turnover (its FY
from the label), e-invoice where shown; the filing table by its column headers
(Return Type, Financial Year, Tax Period, Date of filing, Status, Mode).

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

`extension/test/23-gstin-search.test.mjs` (the real `background.js`, `content.js`
and `inject.js` against a fake portal with a small DOM and a fake database): the
job carries its GSTINs and no other mode's does; the menu's link, typing, Search,
the result and Show Filing Table; the mapping from the page's JSON and from the
page alone (FY dropdown chosen per FY); the replay, and a refused replay falling
back to the page; "Request Rejected" and a 403 with the person still logged in
never stop the run; a real logout logs in again and resumes; a third session loss
stops; a CAPTCHA waited for (never filled), one never typed giving an error row;
`not_found` and the clean reload after it; five failures in a row stop, four do
not; a database refusing the rows; a resumed run; no search page anywhere; and
`inject.js` copying only on services.gst.gov.in.
