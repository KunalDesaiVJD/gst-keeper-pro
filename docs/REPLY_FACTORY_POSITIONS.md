# Reply Factory I — Positions (roadmap Phase 4: read and compute)

How the app reads a notice, splits it into issues with amounts, computes the
firm's position from data it already holds, and asks the client for the rest.
Read this before changing the Phase 4 migrations
(`supabase/migrations/20261008100000`–`161000`), the notice reader in
`agent/src/read/`, the recipes in `src/lib/reply/`, the reply templates
(`docs/REPLY_TEMPLATES.md`), or the Reply Factory pages.

**These positions were written by engineering from the roadmap and the mission
audit (findings R-08, R-10, R-11, R-23, S stage 6). The partner has not signed
them off.** Two of them are decisions the roadmap reserves for the partner
(`docs/notices-mission-audit/roadmap.mjs`, decisions "AI processing" and
"Reply rules"): §3 and §5. Reading notices with the Claude API ships switched
off; nothing of a client's is sent until the partner approves §3, the
client's consent is on file and a manager switches it on.

---

## 1. What Phase 4 does

1. **Reads every notice it can.** First from the portal's own case-folder
   record (deterministic, always on, §2.1); then, when switched on, from the
   notice PDF with the Claude API (§2.2). Readers fill typed facts on the
   notice — section, financial year, tax period, DIN, reply due date, hearing,
   officer, demand by head and component — and create the notice's issues.
2. **Computes the firm's position** for each issue from the portal figures the
   extension pulled — GSTR-1, GSTR-3B, GSTR-2A, GSTR-2B, ledgers, DRC-03 —
   as versioned annexures whose every row carries its source (§6).
3. **Asks the client for the rest** — the documents each issue code lists,
   tracked, reminded on the alert ladder, uploadable in the client portal (§7).
4. **Writes the firm's reply rule per issue type** for the partner to approve
   (§5).
5. **Sorts notice types by whether they need a reply** (critical, optional or
   none) and lets an admin choose which types the dashboard shows (§11).
6. **Prepares several replies for every notice by itself**, in formal legal
   wording without any hyphen or dash, for a person to pick one and start the
   draft (§12).

## 2. Reading a notice

### 2.1 The portal reader (always on)
A notice's own case-folder item (same client, case and reference number) holds
the officer's record: `sdtls.dtscn` (show cause notices), `drprcdt`
(intimations), `dtorder` (orders) and others. `notice_read_portal()` reads, at
the moment the item is saved and once for every existing notice:

| Notice field | From |
|---|---|
| `section_of_law` | `sec`, normalised ("SECTION 73 OF SGST" → 73) |
| `financial_year` | `fy` ("2019-2020" → 2019-20) |
| `period_from`, `period_to` | `tpovl`, else the span of the demand rows |
| `demand`, `demand_total`, `amount_of_demand` | `dmddtls` (also `lbltydtls`, `enfDtls.ntcscn.dmdtls`) summed by head (IGST / CGST / SGST / cess) and component (tax / interest / penalty / fee / others) |
| `hearing_date`, `hearing_note` | `phdt`, `pht`, `venu` |

The officer's facts, grounds and reason text, the payment due date and the
demand rows themselves are kept with the reading (`notice_extractions.detail`)
and shown on the notice page. Portal values are the department's own record and
are recorded as verified. When the notice has no issue yet, the demand becomes
one issue ("Demand in the notice u/s 73 · Apr 2019 – Mar 2020") with source
`portal`; a reading of the PDF may later split it (§2.2).

DRC-01B and DRC-01C have no case folder; their form implies the issue
(GSTR-1 v GSTR-3B; GSTR-3B v GSTR-2B), which is created with source `form` and
no amount. Their tax period must be read from the PDF or typed ("Set the
period" on the notice page) before evidence can be computed.

### 2.2 The PDF reader (Claude API, ships off)
The office agent (`agent/src/read/`) claims a reading job, downloads the notice
PDF (the notice's own PDF, else the first PDF attachment of its case-folder
item), extracts the text of each page, and asks the model for a structured
result: every field with the page it is on and a short verbatim quote, the
issues (each with an issue code from §4, period, demand by head, page and
quote), the documents the officer asks for, and a short summary. Then code —
not the model — checks it:

- **Quote check.** A field counts only if its quote is found in the page text
  and the value is consistent with the quote (dates in the usual Indian
  formats, amounts with or without Indian grouping). A scanned PDF has no text
  layer: nothing it says is applied automatically; every value waits for a
  person.
- **Sums.** The issues' amounts must add up to the notice's demand per head
  within ₹1, or the demand is not applied.
- **GSTIN.** A notice addressed to another GSTIN applies nothing at all
  (outcome `gstin_mismatch`), and the notice page says so in red.
- **Dates.** Due date and hearing on or after the issue date; period from ≤ to.

The database (`notice_read_finish`) then applies only checked fields, **only
into empty columns**, marked "auto — verify" (`read_fields.<column>.source =
'ai'`, `verified = false`). A due date read from the PDF fills an empty due
date (`due_date_source = 'read'`): a probable date flagged for checking is
better than none, and the alerts may use it. Issues read from the PDF replace
the portal or form issue only when nobody has touched it and the amounts agree
within ₹1; otherwise they wait on the reading for a person to add.

### 2.3 Never over a person's value
A reader never replaces a value that is already there. A different value is
recorded as a conflict on the reading ("the portal says 2019-20, the notice
says 2018-19 — kept 2018-19"). A value staff changed after a reader filled it
is theirs (the chip disappears). "Confirm" marks a read value verified
(`result: confirmed`, or `corrected` if it was changed first); "Clear" removes
an unverified one (`result: rejected`). These results are how the reader's
accuracy is measured (§9).

## 3. AI processing (decision record — partner to approve)

- **Processor.** The Claude API (Anthropic), under its commercial terms, as a
  processor of the client's notices for the firm. The firm remains responsible
  for the data (DPDP Act 2023: data fiduciary). Check the current commercial
  terms and data-retention options before switching on; zero data retention is
  available only by agreement with Anthropic.
- **Consent.** Per client, recorded as the date of the engagement-letter clause
  (`clients.ai_consent_at`), with an opt-out that overrides it
  (`clients.ai_opt_out`). Without consent nothing of that client's is sent; a
  queued reading of a client whose consent is withdrawn is cancelled unread.
- **What is sent.** The notice PDF as issued, fixed instructions, and the list
  of issue codes. Never client master data, passwords, portal sessions, other
  clients' data or the firm's notes. The PDF itself carries what the department
  printed on it (name, GSTIN, sometimes PAN or bank details); it is sent as a
  whole under the consent, not redacted. Redaction of what the app itself
  composes applies from Phase 5 (drafting).
- **Where.** The API key lives only in `agent/.env` on the office PC; the app
  and the database never hold it.
- **Model.** `claude-opus-5-5` (a setting). The roadmap suggested a smaller
  model for cost; at the current list prices ($4 / $20 per million input /
  output tokens) a five-page notice costs roughly ₹10–20 (the model's
  reasoning is billed as output), well under the
  roadmap's ₹200 per notice, and the larger model reads tables of demand more
  reliably. Server-side fallbacks are on for a refused request.
- **Spend.** A daily cap (`ai_settings.daily_cap_usd`, $10 by default); every
  call is one row of `ai_audit_log` (who asked, which notice, model, tokens,
  estimated cost, the document's hash), readable in the app, writable only by
  the database.
- **What the model never does.** File, reply, pay, close or change a stage.
  It reads; code checks; a person confirms.
- **Known gap (existing, project-wide).** Notice PDFs sit in a storage bucket
  that is public by URL (the Phase 0 stop-gap to make it private did not take
  effect). Fixing it needs the project-wide move to server-side sessions
  (roadmap "Credentials and auth"). It is not made worse by this phase, but the
  partner should know it before approving §3.

## 4. Issue codes

`reply_issue_types` is the firm's taxonomy (19 codes, `OTHER` included). Each
code names the evidence recipe that answers it (§6), the documents the client
must supply (§7), the forms where it is typical, and the firm's reply rule
(§5). Issues carry the code, their tax period, the demand by head, and — when
read from the PDF — the page and quote. Sources: `manual` (typed), `portal`,
`form`, `extracted` (read from the PDF, `verified = false` until a person
confirms it).

## 5. Reply rules (decision record — partner to approve per code)

Each code's `firm_position` is the argument the recipes compute towards and
Phase 5 will draft from. They are proposals (`position_status = 'proposed'`);
a manager approves each in the app (Notices → Reply Factory → Reply rules), or
asks for changes. The proposals, in short (full text in the app and in
`20261008100000_reply_reading.sql`):

| Code | Proposed position |
|---|---|
| LIAB_GSTR1_V_3B | Compare month by month and cumulatively over the year; differences reversed in a later GSTR-3B are timing (interest u/s 50(1) on the cash portion only for the delay); later amendments, credit notes and adjusted advances reconcile further; the residual is admitted and paid by DRC-03 with interest. |
| ITC_2B_V_3B | From January 2022 (s.16(2)(aa)); reconcile timing (later 2B), reclaims (4D(1)), credit outside the 2B comparison (imports, ISD, RCM); residual reversed or paid; s.50(3) interest only on credit utilised. |
| ITC_2A_V_3B | Before January 2022 credit was not conditional on GSTR-2A; explain supplier by supplier; Circulars 183/2022 and 193/2023 certificates where they apply — verify the circular for the period. |
| RCM_LIAB | RCM tax paid in cash equals the credit taken; self-invoices are never in GSTR-2B by design. |
| INTEREST_50 | Cash portion only (proviso to s.50(1), rule 88B(1)), 18% for the days of delay; on wrongly availed credit only where utilised (s.50(3)); reconcile to the officer's figure. |
| LATE_FEE_47 | Per day of delay, capped by turnover slab and the nil-return cap of the period; amnesty notifications where they apply. |
| ITC_16_4 | Earlier of 30 November after the year and the annual return's filing (Finance Act 2022); s.16(5) for 2017-18 to 2020-21; s.16(6) for revoked registrations; credit is taken when the GSTR-3B is filed. |
| ITC_17_5 | Map each expense to the clause cited and its exceptions; reverse only what is blocked. |
| ITC_CANCELLED_SUPPLIER | Allowable where the supplier was registered on the invoice date and s.16(2) is proved; retrospective cancellation alone does not deny bona fide credit — verify current decisions. |
| ITC_NONFILER, ITC_RULE_42_43, TURNOVER_MISMATCH, GSTR9_V_3B, EWB_V_GSTR1, RETURN_NOT_FILED, REGISTRATION_QUERY, REFUND_DEFICIENCY, PROCEDURE_OBJECTION | See the app: each proposes the reconciliation or check that answers it. |

Statements marked "verify" depend on circulars or decisions that change; the
partner should confirm the current position before approving.

## 6. Evidence recipes

- **Data.** Only the portal figures the extension pulled
  (`gst_filed_returns` GSTR-1 / GSTR-3B / GSTR-2A / GSTR-2B, `filing_status`,
  `gst_drc03_filings`, the credit reversal and reclaim statement, the RCM
  statement) — never the app's own GSTR-1 / GSTR-3B drafts. Same rules as the
  annual return workings (`docs/GSTR9_9C_WORKINGS.md` §3, §5, §6): ₹10
  tolerance per head; tax heads never netted; a month not pulled is one "not
  fetched" line; a filed zero is a real zero.
- **Scope.** The issue's period; else the notice's tax period; else its
  financial year. DRC-01B / DRC-01C without a period ask for one.
- **What they compute** (`src/lib/reply/recipes/`): GSTR-1 v GSTR-3B liability;
  GSTR-3B v GSTR-2B credit (from January 2022) and v GSTR-2A (before); the
  financial year together for ASMT-10 and DRC-01A; RCM liability v credit;
  interest u/s 50 on late returns (cash portion estimated from the set-off rule,
  as in `docs/INTEREST_LATE_FEE_POSITIONS.md`) and late fee u/s 47; ITC beyond
  s.16(4); the filing status for a return-defaulter notice. Recipes for blocked
  credit (s.17(5)), cancelled suppliers and rules 42/43 need data the app does
  not hold: they say `needs data` and list the documents instead of inventing
  figures.
- **Versions.** Each run is saved (`reply_annexures`) with its inputs' hash; the
  same inputs save nothing new; new inputs make the next version. A run nobody
  clicked is saved as `Auto`. An issue's "explained" amount follows the recipe
  unless a person typed it.
- **Missing data.** The readiness check lists, per month and source, what is
  ready, not fetched or not filed. "Fetch missing data" queues the pulls on the
  autopilot (origin `evidence`), which its runner (the firm's Chrome, see
  `docs/PORTAL_AUTOPILOT_POSITIONS.md` §1a) picks up; otherwise the page says how
  to pull them with the extension.
- **Engineering positions inside the recipes** (not yet confirmed by the
  partner):
  - a shortfall in one month settled in a later month of the same financial year
    is shown as timing, matched first in, first out;
  - a DRC-03 counts against an issue when its cause matches, or when it is
    linked to the notice and that is the notice's only money issue;
  - credit re-claimed in Table 4D(1) is deducted from 4A(5) before the GSTR-2B
    comparison;
  - the rule 36(4) allowance (20%, 10%, 5%) is applied month by month for
    periods compared with GSTR-2A;
  - for s.16(4), credit is taken to be claimed in the GSTR-3B of the month whose
    GSTR-2B shows the document;
  - explained = the notice's figure less what is left to pay, per head;
  - interest and late fee already paid in GSTR-3B Table 5.1 are set against what
    the recipe computes.
- **Evidence without a click.** Annexures built when a person opens the Evidence
  tab, from the Reply Factory's "Build evidence for all", or in the background
  when staff open the notices module are saved as `Auto`. The background batch
  (`src/lib/reply/autoBuild.ts`) takes up to 15 open ASMT-10, DRC-01A, DRC-01B
  and DRC-01C notices that have no annexure yet, soonest due first
  (`reply_evidence_pending()`), at most once every three hours per browser; while
  the autopilot is on it also queues the portal pulls those workings miss, so the
  next build has the data. On 6 October 2026 only 2 of the 41 such open notices
  on live belonged to a client whose returns had been pulled, so the 70%
  automatic-annexure target depends on the autopilot running.

## 7. Client document requests

- **From issue codes.** "Ask for what the issues need" adds the documents each
  open issue's code lists that the notice has not already asked for (same
  wording, any status), tied to the issue (`source = 'catalogue'`).
- **The firm's deadline.** Three days before the reply is due, never sooner than
  two days from today; five days when no reply date is known.
- **Reminders.** By themselves, daily at 10:30 IST, on the E12 rule's own ladder
  (`max_repeats`, `cooldown_hrs` — 3 and 72 hours as seeded): a notice whose
  open requests are due within a day, or were asked three or more days ago.
  Every e-mail still goes through the alert engine: with alerts off nothing is
  sent and nothing is counted.
- **The client portal.** A client signed in with their GSTIN sees what is asked
  and uploads it (Documents requested); the request becomes received, linked to
  the file, and shows "uploaded by the client". The request e-mail says where to
  upload. As everywhere in this app, the separation between clients is enforced
  by the app's login and screens, not by the database (the same publishable key
  serves all users — roadmap "Credentials and auth").

## 8. Portal events that had no form

Refund re-credit orders (PMT-03), refund sanction or rejection orders (RFD-06),
provisional refund orders (RFD-04), hearing notices in an appeal, appeal
admitted (APL-02), pre-GST recovery (DRC-07A), rectification orders, audit
closure reports, summons and orders rejecting a cancellation application now
have form rules. Acknowledgements (PMT-03, RFD-04, APL-02, audit closure)
close themselves through the closing sweep; orders keep their s.107 appeal
clock; the new rules run after every existing rule, so they never take a notice
another rule matches.

## 9. How the acceptance numbers are measured (`reply_factory_status()`)

- **Due-date coverage of open notices (target ≥ 98%, each with its source).**
  Per open notice, `notice_due_coverage()`: `reply` (the effective due date —
  extended, stored or computed — with where it came from: portal notice list,
  portal case folder, typed, read from the notice, computed from the form's
  reply period), `hearing` (a hearing fixed, no reply due), `appeal` (an order's
  appeal clock), `appeal_lapsed` (an order whose appeal window, condonation
  included, has closed — dated, and listed to review and close), `informational`
  (an acknowledgement that closes by itself), else `missing`. Coverage = not
  missing / open.
- **Automatic annexures (target ≥ 70% of open ASMT-10, DRC-01A, DRC-01B,
  DRC-01C).** Notices with an annexure in status ready or partial that was built
  without a click (`generated_by_name = 'Auto'`).
- **Reading accuracy (targets: due date exact ≥ 98%, demand within ₹1).** From
  people's verifications of values the PDF reader filled: confirmed as read =
  exact; demand within ₹1 of the value a person kept. Shown with the count
  verified; below 20 verifications the page says there are too few to judge.
- **Client documents.** Open, open more than 7 days (the audit's escalation
  point), received in 90 days, uploaded through the portal, median days to
  receive.

## 10. Not built yet

AI drafting of replies (the templates of §12 are filled from facts, not
written by a model), the e-way bill recipe (the app has no e-way bill data),
supplier registration status (needed for the cancelled suppliers recipe), the
clause-wise s.17(5) mapping, rule 43, per-issue interest on wrongly utilised
credit from daily ledger balances, and quarterly (QRMP) filers in the recipes.

## 11. Notice types: which need a reply, and which the dashboard shows (asked by the firm, 6 October 2026)

"Certain kind of notices are not required to reply so create different
categories for type of notice which are critical & optional for respond & also
give option to admin which notices to be shown on dashboard and which not to
show." (`supabase/migrations/20261008150000_notice_types.sql`)

- **Three categories per notice type** (`notice_type_settings.response_need`,
  one row per form code):
  - *Critical, reply required*: a reply or an action is required, with a
    consequence if it is missed: show cause notices (DRC-01, ASMT-14, REG-17,
    REG-23, REG-SCN, RFD-08), scrutiny (ASMT-10), intimations with a reply
    clock (DRC-01B, DRC-01C), queries (REG-03), refund deficiency memos
    (RFD-03), detention (MOV-07), audit
    (ADT-01), attachment and recovery (DRC-22, DRC-13), summons, appeal hearings,
    and orders with an appeal clock that matters (DRC-07, DRC-07A, MOV-09,
    REG-19, APL-04).
  - *Optional, reply allowed*: DRC-01A (rule 142(1A) lets the taxpayer reply or
    pay; it is not required), audit findings (ADT-02), and orders that only
    matter when adverse (RFD-06, REG-05, rectification orders, an order
    rejecting a cancellation application).
  - *None, information only*: acknowledgements and approvals, the firm's own
    filings and payments (proceedings dropped, response accepted, LUT, LUT
    approved, APL-01, APL-02, REG-06, REG-15, REG-22, SPL-05, DRC-03, PMT-03,
    RFD-04, audit closure).
  A notice the rules cannot classify needs a reply and is shown. Return
  defaulter notices (GSTR-3A) started as critical and are hidden everywhere
  since 7 October 2026 (below).
- **What follows from the category.** A no-reply notice is never overdue or due
  in 7 days, has no reply date in the calendar or the plan, gets the next action
  "Read and close" and no reply options; due-date coverage counts it as
  informational. An optional notice keeps its clock and alerts but ranks below a
  required one (plan score × 0.7).
- **The dashboard.** `show_on_dashboard` per type; information-only types start
  hidden, everything else shown. Only a superadmin or GST manager changes either
  setting (Reply Factory → Notice types, or "Notice types" on the command
  centre). A hidden type leaves the command centre only: every list still shows
  it, the top navigation still counts it, and the command centre says how many
  types and open notices it is not showing. A list opened from the command
  centre carries `dash=1` and filters to the dashboard's types, so every number
  still equals its list.
- **Hidden everywhere** (asked by the firm, 7 October 2026, for GSTR-3A: "do not
  show this notice anywhere in any client and keep always considered as non
  priority to respond"; `20261008180000_notice_types_hidden.sql`). A third choice
  in "Where it shows" (Dashboard and lists / Lists only / Hidden everywhere).
  `notice_facts` leaves a hidden type out, so it is in no list, tile, plan,
  calendar, client page, matter, report, digest or export; search, the bell, the
  "View Notice and Orders" report, the command centre's "auto-closed today", the
  autopilot's capture metrics and the background evidence build leave it out too.
  A hidden type needs no reply and is off the dashboard (a CHECK keeps it so), so
  its reply options are withdrawn and the notice reader skips it; an event on a
  hidden notice is written already handled, so no alert e-mail goes out. Its
  notices are still synced and kept (a GSTR-3A still closes itself when the
  return is filed), and the Notice types screen still counts them. Showing the
  type again brings every notice back as it was, with no reply needed until an
  admin changes that.

## 12. Reply options, prepared by themselves (asked by the firm, 6 October 2026)

"When the notice is fetched by the portal, our system should on its own prepare
different replies and give option to users for the multiple response to draft.
Make sure that all the wordings for reply should be legal wordings & should be
prepared without hyphen." (`supabase/migrations/20261008160000_reply_options.sql`,
templates in `20261008161000_reply_templates_seed.sql`, catalogue in
`docs/REPLY_TEMPLATES.md`)

- **When.** A notice inserted by a sync, or a change to a fact a reply uses
  (form, section, period, financial year, DIN, demand, dates, reference,
  officer), to its issues or its annexures, re-renders that notice's options.
  Editing a template, an issue paragraph, a notice type or the signature block
  re-renders every open notice. A reply that cannot be prepared is logged as a
  warning and never blocks the sync's write. Closed notices and no-reply types
  get none.
- **Which.** Every active template for the notice's form: two to five per form
  that needs a reply (64 templates in all; contest in full, part acceptance,
  acceptance and payment, explanation, more time, documents relied upon,
  rectification, stay of recovery, as the form allows), and a paragraph per issue
  code for contesting it and for accepting it; the three general templates when
  the form has none of its own. The catalogue, with the legal basis of each and
  the law points left as fill-ins for the partner to confirm, is
  `docs/REPLY_TEMPLATES.md`.
- **The wording rule.** Formal legal English and no hyphen or dash of any kind
  (U+002D, U+2010 to U+2015, U+2212, the small and fullwidth hyphens, the soft
  hyphen) in any template, issue paragraph, signature setting or rendered reply:
  enforced by constraint. Facts are cleaned before they go in: a dash between
  digits becomes a slash (2023-24 → 2023/24, 01-04-2023 → 01/04/2023), any
  other dash a space (DRC-01 → DRC 01; an identifier such as a DIN or reference
  number that itself holds a hyphen is written with a space in its place, so
  check such a number against the notice before filing), and "Rs. 500/-" loses
  its "/-". Amounts read "Rs. 1,23,456 (Rupees One Lakh Twenty Three Thousand
  Four Hundred Fifty Six only)", dates "6 October 2026", forms "FORM GST DRC 01",
  the State law from the GSTIN's state code ("the Gujarat Goods and Services Tax
  Act, 2017"; the Union Territory Act for a UT without a legislature).
- **Facts the app does not hold** are written as a graceful phrase ("the amount
  proposed in the notice") or a fill-in in square brackets ("[ARN of FORM GST
  DRC 03]", "[place]") that the person completes in the draft; nothing is
  invented.
- **Using one.** "Use this reply" renders the template again with today's facts
  and starts the next draft version; earlier open versions are superseded, never
  overwritten, and the notice moves to the draft stage. The draft then goes
  through the usual partner review. Nothing is filed or sent by the app.
- **Who owns the words.** The templates are the firm's: editable, versioned, and
  each a starting point that a partner should review before the first use
  (decision pending, like §5). The signature block uses
  `notice_settings.reply_place` and `reply_signatory`.

## 13. The Notice Response AI Assistant (asked by the firm, 7 October 2026)

"AI learning through human behaviour should be preserved for future usage of same
kind of notice para & response … AI shall read each & every notices and
attachments and responses. Everything should be done through claude CLI file
already available in supabase. … admin can select which past & ongoing client
responses should be part of this learning capabilities." (migration
`20261009100000_ai_assistant.sql`, Edge Function `supabase/functions/notice-ai/`,
app: Reply Factory → AI and Learning, the notice page's AI assistant tab)

- **Where it runs.** In Supabase, not on a PC: the Edge Function `notice-ai`.
  It reaches Claude through the firm's **Claude CLI gateway** (the firm's choice,
  8 October 2026: the same gateway its other Supabase project uses, on the firm's
  Claude subscription; secrets `CLAUDE_CLI_GATEWAY_URL` and
  `CLAUDE_CLI_GATEWAY_SECRET`). The gateway takes text, so a PDF goes as its own
  text layer page by page and quotes are checked against that same text. A scanned
  PDF with no text layer is read by the Claude API when `ANTHROPIC_API_KEY` is also
  set, and otherwise left with the reason `needs_vision`. Without the gateway
  secrets the API key is used for everything (`NOTICE_AI_BACKEND=api` forces it).
  Calls through the gateway bill no tokens, so the dollar caps only bind API calls.
  pg_cron (`notice-ai-tick`, every 2 minutes) wakes it; one run at a time holds a
  lease (`ai_runner_status`) and reads until about 75 s of its time are left.
  `ai_settings.runner = 'office_agent'` hands the reading back to the office
  agent of Phase 4; the assistant stays on the Edge Function either way.
- **Off until switched on.** `read_enabled` ships false; the admin switches it on
  in Reply Factory → AI. Which clients are read is `consent_scope`: the clients
  with consent (the default, as Phase 4), or every client by the firm's choice.
- **What it reads.** Every notice PDF (as Phase 4), and every document in a case
  folder: the department's notices and orders, the client's replies and their
  supporting papers, applications. A reply in review or approved in the app is
  read too. Each document is read once (the same file under two names is read
  once, by its hash); replies first, then orders and notices, then the rest.
  Pages beyond `doc_max_pages` (40) are left out and the reading says so.
- **What it keeps.** For each reply, the paragraphs of the notice it answers
  (P1, P2 …) paired with the reply's own words for each (`ai_learning_pairs`),
  with the issue code and form; facts are kept only as the document states them,
  with a quote that is checked against the text. A reading that cannot be checked
  is not used for learning.
- **The admin chooses what it learns from.** Reply Factory → Learning lists every
  past and ongoing response (portal replies, the app's drafts, issue positions)
  with client, form, year and phase; the admin ticks which count, one by one or
  all those a filter shows, and can untick single pairs. Nothing counts until
  chosen (`learning_auto_include` false).
- **How it helps.** On a notice's AI assistant tab: draft a reply to an issue,
  improve a draft, or ask a question. It finds the chosen examples closest to the
  paragraph (same issue code and form first, then by wording), shows which it
  used (E1, E2 …), and writes in the firm's legal English with no hyphen or dash
  (cleaned in the database, as §12). It never carries another client's facts into
  a reply: names, GSTINs, amounts and dates come only from this notice. What it
  writes is a suggestion: "Use in draft" saves it as the next draft version, and
  the partner review is unchanged. When a person edits the assistant's words and
  uses them, the edited version becomes a learning pair of its own.
- **Cost and caps.** Reading and the assistant have separate daily caps
  (`daily_cap_usd` $10, `assist_daily_cap_usd` $5); every call is in the audit
  log with its tokens and cost. Documents are read at low effort, the assistant
  at high. A full backfill of the firm's roughly 2,000 documents is about $0.08 to
  $0.11 each, some $160 to $220 in all, spread over the days the cap allows.
- **Not decided by the firm yet.** Reading every client (rather than those with
  consent), and whether the assistant's examples may be drawn from any client's
  responses (they are, once chosen; only the reasoning and wording travel) are
  engineering defaults pending a partner's confirmation.

## 14. Every client read; the overview kept; learning by client (asked by the firm, 9 October 2026)

- **Every client's documents are read** (`ai_settings.consent_scope = 'all_clients'`,
  the firm's instruction: "on any single client AI needs to review all the documents &
  keep updating the basic overview"). Work cancelled for want of consent is queued again
  by itself when consent is given, an opt-out is lifted, or the scope widens
  (`ai_requeue_consent`). Before this, a client whose consent was recorded after its
  documents were registered never had them read.
- **The overview**: each document's reading also returns the case facts it states
  (`overview`: section, year, period, DIN, reply due, hearing, officer, demand by head;
  refund amounts; registration application). Nothing is guessed from another document.
  Dates must be YYYY-MM-DD, amounts digits only, else empty. `notice_case_overview` fills
  a notice's blanks from them (NOTICES_LITIGATION_POSITIONS §21). Documents read before
  this were queued again, behind the unread ones.
- **Pace**: a run takes a new job while 40 seconds remain (was 75): through the Claude
  CLI gateway a document takes 10 to 25 seconds.
- **Learning is chosen client by client** (migration `20261011110000`):
  `clients.ai_learning`. Choosing a client chooses all its responses read so far and
  every one read later (`trg_ai_documents_learning_default`). Leaving it out leaves them
  all out. A single response or pair can still be left out under its client.
