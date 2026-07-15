# Live-portal selectors (read-only inspection)

Captured by reading the live GST portal DOM (read-only — no clicks/submits/downloads).
Date of capture: 2026-07-14. Portal: `services.gst.gov.in` + return sub-domains.

> These replace the `TODO(selector)` placeholders in `src/login.ts` and `src/handlers.ts`.
> The portal is an AngularJS app; most action buttons have **no stable `id`** — target them
> by **visible text** (`button:has-text("…")`) or by their container. Verify again if the
> portal is redesigned.

## Wiring status (2026-07-14)

| Area | Selectors | Wired into code | Still needs a live run |
|---|---|---|---|
| Login (username/password/Login btn) | ✅ confirmed | ✅ `login.ts` | — |
| Login CAPTCHA field + image | ⚠️ unverified (`#captcha`/`#imgCaptcha` guess) | left as-is | re-read on a logged-out login page |
| Returns Dashboard period select + tiles | ✅ confirmed | ✅ `handlers.ts` (`selectReturnPeriod`, `tileButton`) | — |
| PULL_2B navigation → GENERATE EXCEL | ✅ confirmed | ✅ `handlers.ts` | post-generate download trigger; xlsx parser → `twob_import_docs` |
| Credit-ledger total balance | ✅ confirmed | ✅ `handlers.ts` (reads total) | **per-head** IGST/CGST/SGST via the detailed date-range ledger (NOT inspected) |
| 2B parse → `twob_import_docs` | ✅ done | ✅ `handlers.ts` + `parseGstr2b.ts` | post-GENERATE download trigger (live-run) |
| Track Return Status (ARN/date/status) | ✅ confirmed | scaffold only | wire the table read → `filing_status` |
| View e-Filed Returns (ARN + PDF) | ✅ confirmed | scaffold only | wire selects+search+download → PDF; confirm download-icon = PDF (live-run) |
| PUSH GSTR-1 / GSTR-3B (save) | ❌ not inspected | scaffold only | the offline-upload/save flow |

**Pull-side inspection COMPLETE** — all pages captured (login, dashboard, 2B, credit ledger, Track
Return Status, View e-Filed Returns). Remaining gaps: (1) login CAPTCHA input/image (still `#captcha`
guess — grab on a logged-out login page), (2) credit-ledger **detailed** per-head view, (3) wiring +
a live run for the filing-status handler and the push-save flows. None can be *finalized* without a
live run on the office PC.

---

## 1. Login — `https://services.gst.gov.in/services/login`  ✅ confirmed

| Field | Selector | Notes |
|---|---|---|
| Username | `#username` | `id="username"`, `name="user_name"`, `type=text`, placeholder "Enter Username" |
| Password | `#user_pass` | `id="user_pass"`, `name="user_pass"`, `type=password`, placeholder "Enter Password". (There is a second hidden password input with empty id — do not use it.) |
| Login button | `button.btn-primary:has-text("Login")` | `<button type="submit" class="btn btn-primary">Login</button>` — no id. `button[type=submit]` alone is ambiguous. |
| CAPTCHA input | `#captcha` *(UNVERIFIED — page navigated before capture; re-check on a logged-out session)* | |
| CAPTCHA image | `#imgCaptcha` *(UNVERIFIED — re-check)* | |

## 2. GSTR-2B download — `https://gstr2b.gst.gov.in/gstr2b/auth/gstr2bdwld`  ✅ confirmed

Page heading: **"Download data for GSTR-2B"**. **No period selector on this page** — the
FY + return period is chosen on the Returns Dashboard *before* arriving here.

| Action | Selector | Notes |
|---|---|---|
| Generate JSON | `button.btn-primary:has-text("GENERATE JSON FILE TO DOWNLOAD")` | no id |
| Generate Excel | `button.btn-primary:has-text("GENERATE EXCEL FILE TO DOWNLOAD")` | no id — preferred (xlsx importer already exists) |
| Back | `button:has-text("BACK")` | |

Flow: Returns Dashboard → pick FY+period → SEARCH → GSTR-2B tile → DOWNLOAD → **this page** →
click "GENERATE EXCEL FILE TO DOWNLOAD" → portal generates → a download link/button appears →
download the .xlsx (then feed the existing Import-2B parser).

## 3. Returns Dashboard (period selector) — `https://return.gst.gov.in/returns/auth/dashboard`  ✅ confirmed

Shared entry point for 2B, GSTR-1, GSTR-3B, filing status. AngularJS; selects are `name`-based (no id).

| Control | Selector | Notes |
|---|---|---|
| Financial Year | `select[name="fin"]` | options `2026-27`, `2025-26`, … (10) |
| Quarter | `select[name="quarter"]` | `ng-model="dropdownValues.quart"`, e.g. "Quarter 2 (Jul - Sep)" |
| Period (month) | `select[name="mon"]` | **cascades** — options depend on the chosen quarter (e.g. only "July" when Q2). Select fin → quarter → mon in that order. |
| Search | `button.srchbtn` | class `btn btn-primary srchbtn`, text "Search" (there is also a `button.srchbtn1` "Submit" — do not use) |

Flow: set `fin` → `quarter` → `mon` → click `button.srchbtn` → the return **tiles** render on the same
page (GSTR-1, GSTR-2B/Auto-drafted ITC, GSTR-3B, …), each with its own action button (PREPARE ONLINE /
DOWNLOAD / VIEW). **Tile buttons captured below.**

### 3b. Post-search return tiles  ✅ confirmed (June 2026)

After Search, each return renders as a tile: a tile card (`div` inside
`div.col-sm-4.col-xs-12.col-md-4.col-lg-4`) with a **header** naming the return + a body
`div.ct` holding the action buttons. **Every action button is `button.btn.btn-primary.smallbutton`
with generic text ("Download", "View", "Prepare Online") — the SAME text repeats across tiles.**
So NEVER select a button by text alone; **scope to the tile by return name first**, e.g.:

```js
// Playwright — click the GSTR-2B tile's Download (not GSTR-1's / GSTR-2A's)
page.locator('div.col-md-4').filter({ hasText: 'GSTR-2B' })
    .getByRole('button', { name: /^Download$/i }).click();
```

Tiles seen (name → buttons):

| Return (header text contains) | Buttons | Agent target |
|---|---|---|
| `GSTR-1` — "Details of outward supplies…" | VIEW, Download | PULL_GSTR1 (Download) / PUSH via GSTR-1 flow |
| `GSTR-1A` — "Amendment of outward supplies…" | Prepare Online | — |
| `GSTR-2B` — "Auto - drafted ITC Statement for the month" | View, **Download** | **PULL_2B**: click Download → lands on `gstr2b.../gstr2bdwld` → "GENERATE EXCEL FILE TO DOWNLOAD" |
| `GSTR-3B` — "Monthly Return" | Prepare Online, Prepare offline | PUSH_GSTR3B (Prepare Online = online save; Prepare offline = JSON upload) |
| `GSTR-2A` — "Auto Drafted details (For view only)" | View, Download | — |

Status text (e.g. "Status- Filed") appears inside `.ct` as `Status- <word>` — usable to detect a
filed return without opening Track Return Status. Due date shows as "Due Date - dd/mm/yyyy".

## 4. Electronic Credit Ledger — `https://return.gst.gov.in/returns/auth/ledger/itcledger`  ✅ confirmed (landing summary)

The landing view is a **summary only** — no `<table>`, no date-range form, `selectCount: 0`
(the "Financial Year 2026-2027" / "Month July" are **static labels**, not dropdowns). It shows a
single total ITC balance "as on" today's date, plus provisional & blocked balances. That single
figure is exactly what the app's Suspended Reco / `gst_receivable_reco` opening balance needs
(`opening_source='portal'`).

| Field | How to read | Notes |
|---|---|---|
| ITC balance total | `div.rettbl-format span.reg` (the amount `span`), anchored to the "ITC Balance As On Date" label | e.g. `4,64,763.00`. Parse: strip commas → number. |
| "As on" date | text after `ITC Balance As On Date :` | e.g. `14-07-2026` = **today** (see caveat) |
| Provisional Credit Balance | leaf text `Provisional Credit Balance : <amt>` | |
| Blocked Credit Balance | leaf text `Blocked Credit Balance : <amt>` | |
| Client name / GSTIN | shown at top: `ACCURATE PMS PRIVATE LIMITED  24AAMCA2528C1Z3` | use to VERIFY the agent is on the right client's session |

**Caveat / TODO:** this landing balance is *as of today*, and is a **single total** (no per-head
IGST/CGST/SGST/Cess split). If the app later needs (a) the balance as of a specific period-end, or
(b) the per-head breakup, the agent must open the **detailed ledger** (date-range `From/To` + GO,
which shows opening/closing per head) — that sub-view was **not** reached in this inspection. For v1
of the opening-balance pull, the single total-as-on-sync-date is used; document this to the team.

Parse hint (agent):
```js
const raw = await page.locator('div.rettbl-format span.reg').first().innerText(); // "4,64,763.00"
const itcBalance = Number(raw.replace(/,/g,''));
```

## 5. Track Return Status — `https://return.gst.gov.in/returns/auth/trackreturnstatus`  ✅ confirmed

Gives ARN / return-type / period / filed-date / status per filed return. **No PDF here** — the
filed-return PDF is on **View e-Filed Returns** (separate page, still to inspect).

Search controls:

| Control | Selector | Notes |
|---|---|---|
| Search mode | `input[name="aaa"]` radios: value `ackNo` (ARN), **`retFilePer`** (Return Filing Period), `status` | pick `retFilePer` |
| Financial Year | `select[name="fin"]` | **"2026-2027"** full format (NOT the dashboard's "2026-27") |
| Search | `button.srchbtn` | text "Search" |

Results table = the page's single `<table>`. Rows: `table tbody tr`. **Cell order (0-indexed):**

| idx | Column | Example | Agent use |
|---|---|---|---|
| 0 | ARN | `AA240626641125D` | `arn` (15-char; validate `^[A-Z0-9]{15}$`) |
| 1 | Return Type | `GSTR-1/IFF` | map portal label → `return_type` enum (see below) |
| 2 | Financial Year | `2026-2027` | + col 3 → period MM/YYYY |
| 3 | Tax Period | `June` (month) or quarter | month-name → MM; with FY → `MM/YYYY` |
| 4 | Date of filing | `09/07/2026` (dd/MM/yyyy) | `filed_date` → ISO yyyy-MM-dd |
| 5 | Status | `Filed` | only import when `Filed` |
| 6 | Mode of filing | `ONLINE` | informational |

Return-type label mapping (portal → app `return_type` enum): `GSTR-1/IFF`→`GSTR-1` (or `GSTR-1 (IFF)`
if IFF/quarterly — disambiguate by tax period being a month within a quarter), `GSTR3B`/`GSTR-3B`→`GSTR-3B`,
`GSTR-3B`(quarterly)→`GSTR-3B (Q)`, `CMP-08`→`CMP-08`, `ITC-04`→`ITC-04`, `GSTR-6`→`GSTR-6`, `GSTR-7`→`GSTR-7`.

## 6. View e-Filed Returns — `https://return.gst.gov.in/returns/auth/efiledReturns`  ✅ confirmed

**Single source for ARN + filed-date + the PDF** (its table has the Acknowledgement Number AND the
download). More clicks than Track Return Status (needs 4 selects → one return at a time) but gives
the PDF, so it's the page for the full filing-status auto-import.

Search controls (id-based here; `Select` is the empty first option):

| Control | Selector | Notes |
|---|---|---|
| Financial Year | `#finYr` | "2026-27" **short** format |
| Filing frequency | `#optValue` | Annual / Half Yearly / Monthly / Quarterly … (5 opts) |
| Tax Period (month) | the 3rd `<select>` (no id/name) — `select` after `#optValue` | January…December (+"Select") |
| Return Type | `#retTyp` | `GSTR-1/IFF/GSTR-1A`, `GSTR3B`, … (17 opts) |
| Search | `button.btn-primary.pull-right` | text "Search" |

Results table (`table`) columns: Return Type · Financial Year · Tax Period · **Acknowledgement Number**
· **Date of filing** · Mode of filing · Filed By · **View/Download**. In the last cell:

| Control | Selector | Action |
|---|---|---|
| View | `a.btn-edit:has-text("View")` | opens the return view page (NOT needed for the pull) |
| **Download PDF** | `a[title="download"]` (contains `i.fa-download`) | **direct PDF download** — this fills `return_pdf_url` |

Agent flow (PULL_FILING_STATUS): per client, per period, for each return type the client files →
set `#finYr` + `#optValue` + month + `#retTyp` → `button.btn-primary.pull-right` → if a row exists,
read ARN (col "Acknowledgement Number") + Date of filing, click `a[title="download"]` to grab the
PDF → upload to `return-pdfs` bucket → upsert `filing_status`. (Alternatively, Track Return Status
gives ARN/date/status for ALL returns in one FY search but no PDF — use it for a fast status sweep.)
**TODO(live-run):** confirm the download-icon yields a PDF (vs opening a viewer) + the `#optValue`
option labels.
