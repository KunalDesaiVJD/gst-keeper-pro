# Notices & Litigation — Elected Positions

How the notices module interprets GST portal data, and the positions it
encodes. Read this before changing auto-close logic, due-date extraction,
or the KPI tile definitions.

**These positions were implemented by engineering judgement during
Phases 0–3 of the notices roadmap, not confirmed in a firm sign-off
conversation.** Flag any that don't match how the firm actually wants it
to work; each is a localised change to reverse. Statutory periods and form
rules carry a `confirmed_at` column that stays empty until the firm confirms
them (§9, §10).

---

## 1. "Open" vs "Closed"

A notice is **closed** when `staff_status` matches one of:

```
Closed, Withdrawn, Dropped, Disposed, Deleted, Adjudged
```

(Case-insensitive prefix match. Since Phase 1 the database decides it —
`public.notice_is_closed(staff_status)`, surfaced as `notice_facts.is_open`; the
JS copies in `src/utils/noticeDefinitions.ts` are only a fallback for an old
database.)

Everything else — including `null` (no manual status yet) — is **open**.

**Position:** The portal's own `status` field (e.g. "Reply filed") is
informational only. Only the manually set `staff_status` decides
open/closed. This means a notice stays open even after a reply is filed
until staff explicitly close it (or the sweep does — see §3).

## 2. KPI tile definitions — one canonical set (Phase 1)

Every tile, list, report, e-mail and MIS reads the same rows: the view
`public.notice_facts` (migrations `20261006111000`, replaced in `…116000`) — live
`source = 'notices'` rows of `gst_notices` (`deleted_at IS NULL`) with the flags
computed once, in the database, against **today in IST** (`ist_today()`). Refund
and DRC-03 tiles read `refund_facts` / `drc03_facts`; exposure reads
`notice_exposure`. The app loads them through `src/lib/noticeFacts.ts` /
`src/lib/noticeQueries.ts` (reports count with the list's own filters, `components/notices/reports/noticeCounts.ts`); `notices_dashboard_summary()` returns the same counts in one call.

| Flag / tile | Definition |
|---|---|
| **Open** (`is_open`) | `NOT notice_is_closed(staff_status)` |
| **Replied** (`is_replied`) | `reply_date` is set |
| **Overdue** (`is_overdue`) | open AND not replied AND effective due < today IST |
| **Due in 7 days** (`is_due_in_7`) | open AND not replied AND today ≤ effective due ≤ today + 7 |
| **New (24h)** (`is_new`) | `first_seen_at` within the last 24 hours |
| **Unassigned** (`is_unassigned`) | open AND no `assign_to_user_id` |
| **Exposure** (`exposure_amount`) | the demand of an open notice not linked to a matter, counted **once per dispute** (`dispute_key` = case id, else reference, else id; the latest notice of the dispute carries it) — plus, in `notice_exposure`, open matters' demand − paid − pre-deposit |

**Effective due date** = `extended_due_date` (staff) → `due_date` (portal, or the
case folder — §4) → the **computed** short clock (§9), recorded in `due_basis`
(`extended` / `portal` / `computed`) and, for a computed date, `due_basis_note`
(the rule's basis). A notice with none of the three can never be overdue or
due-in-7.

**Position (changed in Phase 1):** "Due in 7 days" now excludes replied notices,
like "Overdue" (it used to count them, so the tile and the reminder disagreed).

**Acceptance check:** `supabase/tests/notices/test_20_facts.sql` asserts that every
dashboard number equals the row count of the list it opens.

## 3. Auto-close sweep

**Updated in Phase 0 (6 Oct 2026).** The sweep is now a database function,
`public.notices_sweep(p_client_id uuid default null)`
(`supabase/migrations/20261006101000_notices_sweep_function.sql`). It runs by itself:
right after each client's notices pull and again after its DRC-03 pull (extension
0.4.0+), nightly at 03:00 IST for every client (pg_cron job `notices-sweep-nightly`),
and when someone clicks "run the closing sweep". The old client-side version filtered
a column that never existed (`gst_case_folder_items.notice_id`) and never ran.

Folder items are joined to notices on `(client_id, case_id)`. Rules, first match wins:

| Rule | Trigger | `close_reason` |
|---|---|---|
| **Closure folder** | any item in section CLSR / CLOSR / CLOSURE | `auto:closure` |
| **Refund paid** | `notice_type` matches /refund/ AND an ORDRS item carries a payment order (`sdtls.payadviceordervo`, RFD-05) AND no order is a rejection (`sdtls.sancordervo.ordertype` matches /reject/) | `auto:refund_paid` |
| **LUT approved** | `notice_type` matches /letter of undertaking/ or the word LUT AND an ORDRS item exists | `auto:lut_approval` |
| **DRC-03 acknowledged** | `notice_type` matches /voluntary payment/ AND a live `gst_drc03_filings` row of the same client has `arn` = the notice's `case_id` or reference AND a status matching /acknowledg/ | `auto:drc03_acknowledged` |

**Position (changed):** a refund case no longer closes on *any* ORDRS item. A
sanction/rejection order (RFD-06) can be a rejection that starts an appeal clock;
closing on it hid that clock. Refunds now close only on a payment order with no
rejection on file; everything else stays open for staff.

**Position:** Only notices with `staff_status IS NULL` are candidates. If a staff
member has set any status (even "Open"), the sweep does not touch that notice.

**Position:** The sweep sets `staff_status = 'Closed'`, writes the `close_reason` tag
and logs a `closed` event (actor "Closing sweep"). It does not write `reply_date`,
`order_date` or any other field.

**Phase 1 — closing by form rule** (sweep part 3, migration `20261006116000`). A form
rule (§9) can carry an `auto_close_reason`; an untriaged notice (`staff_status IS
NULL`) classified to that form closes with `close_reason = 'auto:' || reason`:

| Form rule | Portal wording (pattern) | `close_reason` |
|---|---|---|
| DROPPED | "proceedings dropped" | `auto:proceedings_dropped` |
| ACCEPTED | "acceptance of response", "acknowledgement of acceptance" | `auto:accepted` |
| LUT-APPROVED | "deemed approved", "LUT … approved" | `auto:lut_approval` |
| REG-06 / REG-15 / REG-22 | registration certificate, amendment order, revocation of cancellation | `auto:informational_order` |
| SPL-APPROVED | "approval of waiver" | `auto:informational_order` |

On the live data (6 Oct 2026) the sweep has closed 333 untriaged notices in all:
120 acceptances of a response or payment, 125 informational orders (registration
certificates, amendment and revocation orders, waiver approvals), 44 LUT approvals,
22 dropped proceedings, 17 acknowledged DRC-03s, 4 closures on the portal and 1 paid
refund. 670 stay open.

Still not automated: GSTR-3A notices closing when the defaulted return is filed (326
are open and overdue on the live data — the largest single block); DRC-07 /
rejection orders moving to "Order received". The appeal clock for those orders does
exist now (§10).

## 4. Due-date extraction

**Updated in Phase 0.** Part of the same `notices_sweep` function. It fills
`due_date` on case-linked notices (`case_id` set) where it is null, reading the paths
the case-folder page already reads (verified against the live portal JSON):

| Folder item | Path |
|---|---|
| Intimations (INTIM) | `raw_json.duedt`, else `sdtls.<sub>.replyDuedt` |
| Notices (NOTCE) | `sdtls.<sub>.duedt` |
| RFD-08 (NOTAC) | `raw_json.sdtls.duedate` |

`<sub>` is whichever of `dtscn`, `srscn`, `remnd`, `dtorder`, `sancordervo`,
`payadviceordervo` is present. Formats: `DD/MM/YYYY`, `DD-MM-YYYY`, ISO.

**Position (changed):** a notice takes the due date of **its own** folder item (same
reference number). Failing that, it takes the due date of the **most recently issued**
notice / intimation in its case **that has not been replied to** (a REPLY item whose
`ntcno` equals the item's reference counts as a reply). The old sweep took the
*earliest* date, so a case with a fresh notice read as overdue on the first notice's
long-past deadline.

**Position (changed in Phase 1):** a date the sweep found in the case folder is kept
(`due_date_source = 'case_folder'`); a sync write that sends NULL no longer blanks it
in between (sync guard v2, migration `20261006112000`), and the next sweep moves it
forward when a newer notice arrives in the case. Portal rows (`get/notices`) keep the
portal's own due date (`due_date_source = 'portal'`). Staff override with
`extended_due_date`.

## 5. Soft-delete and sync safety

The sync upserts and soft-deletes (`deleted_at`) instead of DELETE + INSERT; every
query in the module filters `deleted_at IS NULL`. **Since Phase 0:**

- **No deletion on a bad pull.** Extension 0.4.0+ marks rows missing only after a
  complete, non-empty pull; a pass that would remove more than half of a client's
  rows (and more than 5) is held back and logged (`client_sync_log.action =
  'notices_guard'`). The app refuses to sync from older extension copies.
- **Sync never blanks captured values.** A database trigger (`gst_notices_sync_guard`)
  keeps the existing `pdf_url`, `case_id` and `hearing_date` when a sync write sends
  them as NULL (a failed PDF download used to erase a working link).
- **Manual notices are never marked missing** (`portal_key` starting `manual:`; the
  portal never returns them).
- **A hard DELETE becomes a soft delete** (`gst_notices_soft_delete_instead`), which
  neutralises old extension copies that still delete. Maintenance can bypass with
  `SET LOCAL app.allow_notice_hard_delete = 'on'` inside a transaction.

**Position:** a soft-deleted notice can be restored by setting `deleted_at = NULL`;
the sync re-soft-deletes it only after a complete pull that no longer returns it.

**Phase 1 — one ingest door and a run ledger** (migration `20261006113000`). Extension
0.5.0 writes every portal row through `public.sync_ingest(client, run, step, rows,
…)` (steps `notices`, `case_folder`, `refunds`, `drc03`) instead of four tables over
REST. The function takes a per-client advisory lock (two PCs on one client queue up),
stamps server time, hashes each row (`portal_hash`) to count **new / changed /
unchanged / removed**, and soft-deletes only after a complete, non-empty pull — a
pass that would remove more than 5 rows and more than half is **held** (counted in
`rows_held`). Each step writes one `sync_run_items` row under a `sync_runs` row (one
per Sync All) with a reason class on failure (`captcha_timeout`, `session_mismatch`,
`timeout`, `portal_error`, `stalled`, `other`…). `client_sync_status` shows per client
and step when it last synced and why it failed, stale after 24 hours; `sync_queue()`
orders Sync All by risk (due within 7 days or overdue first, then never synced, then
stalest). 0.4.x still writes over REST with the Phase 0 guards, but leaves no ledger.

## 6. Close reason taxonomy

`close_reason` is free text with a convention:

- `auto:closure`, `auto:refund_paid`, `auto:lut_approval`, `auto:drc03_acknowledged` —
  set by the sweep (§3). (`auto:refund_order` was retired in Phase 0; existing rows
  keep it.)
- Anything else — typed by staff in the edit dialog or bulk close. The edit dialog now
  loads the saved reason, so saving the dialog no longer wipes it.

The `auto:` prefix distinguishes machine-set reasons from human ones.

## 7. Client deletion (Phase 0)

**Position:** a client that has notices, litigation matters or statutory deadlines
cannot be deleted (`ON DELETE RESTRICT` on `gst_notices`, `litigation_matters`,
`matter_deadlines`; migration `20261006103000`). The delete screens say so and suggest
marking the client inactive instead. Portal copies and logs still cascade for a client
with none of the above.

## 8. Notice owner (Phase 0)

**Position:** the owner is `assign_to_user_id` (a staff member's user id); `assign_to`
keeps the display name. The edit dialog is a staff picker that writes both. Owners
typed as free text earlier were back-filled where the name matched exactly one staff
member's first name (migration `20261006104000`); the rest show a "pick the staff
member" hint in the dialog.

## 9. Form rules and classification (Phase 1)

`public.notice_form_rules` (migrations `20261006110000`, `…116000`) maps the portal's
wording to a form: `pattern` (case-insensitive regex over type + description), tried
in `match_order`; first match wins and is stored in `gst_notices.form_code` by a
trigger on insert and whenever the type or description changes (editing a rule
reclassifies everything). Each rule carries the label, category, default priority,
the **short clock** (`reply_days`, calendar or working days, and `clock_basis` — the
provision or practice it comes from), the appeal section for orders, and an optional
`auto_close_reason` (§3).

**Positions:**
- The category from a rule refines only the generic buckets ("Notice", "Order",
  "Uncategorised"); a specific category from the legacy classifier is kept.
- The default priority applies on insert only; a priority staff set is never
  overwritten (`effective_priority` = staff priority, else the rule's).
- The computed short clock applies only to portal-list rows (no `case_id`) issued
  on or after `notice_settings.computed_clock_from` (the first day of the month the
  rules went live), so years-old notices do not all turn overdue at once. Working
  days skip Sundays only (no holiday calendar yet).
- `confirmed_at` / `confirmed_by` stay empty until the firm confirms a rule's period.
  **Every reply period in the seed is unconfirmed** and shows as such in the drawer.

## 10. Statutory clocks (Phase 1)

`public.notice_clocks_refresh(notice)` (migration `20261006114000`) writes
`matter_deadlines`, one row per notice and clock: `reply_due` (the effective due date
while open; met when a reply is logged), `hearing`, `appeal_s107` / `appeal_s112` from
the order date (a staff-logged order, or the notice itself when it is an appealable
order — REG-19, DRC-07, MOV-09 for s.107; APL-04 for s.112) plus the condonation
outer limits, and `attachment_expiry` (DRC-22, one year). Triggers keep it current on
every notice change and when a rule or setting changes; the nightly job re-runs it.

**Positions:**
- Periods come from `litigation_rules` (`appeal_months.*`, `appeal_condonation.*`,
  `drc22_validity.s83`); each row records its basis, the date it runs from, the rule
  key and `period_confirmed` (false until the firm confirms the rule).
- An appeal or attachment clock is kept until 30 days after its last possible day,
  then dropped — orders from years ago carry no live clock.
- A date a person overrides (`source = 'override'`) is never replaced;
  `computed_date` keeps showing what the rule says beside it.

## 11. Events (Phase 1)

`notice_events` is written by database triggers (migration `20261006112000`), not by
the screens: on `gst_notices` — captured, removed, restored, closed / reopened /
status changed, assigned, due changed, hearing fixed, reply / submission / order
logged, priority changed, matter linked / unlinked; on `gst_case_folder_items` — reply
filed, order received, closure on portal, notice issued, folder item added / removed.
The actor is the staff member the app stamps on the row (`edited_by_id` /
`edited_by_name`), else the routine that names itself (`app.actor_name`: "Portal
sync", "Closing sweep", "Auto-assign"), else "System". Bulk actions log one event per
notice. The bell shows staff and system events.

## 12. Alerts (Phase 1) — preview first

The engine is in the database (`notice_alerts_run`, migrations `20261006115000`,
`…117000`) and pg_cron runs it: **every 15 minutes** for events (E1 new notice —
batched per client and recipient, E6 assigned, E7 status, E8 reply logged, E9 sync
anomaly, E15 portal update on a case), **09:30 IST daily** for one morning list per
owner (due in 7/3/1/0 days and overdue, **skipping replied**; hearings in 7/1/0 days;
appeal and attachment clocks in 30/7/1/0 days) plus, for managers, the firm-wide
overdue list and notices without an owner after 48 hours, and **Monday 09:45 IST**
for the weekly MIS.

**Positions:**
- **Preview mode is the default** (`notice_settings.alerts_mode = 'preview'`): alerts
  are written to `email_outbox` with status `preview` — visible in Reminders → Email
  outbox, never sent. Switching to `live` is a deliberate step for a GST manager /
  superadmin (Reminders → Notice alerts), after reviewing a week of previews.
- Exactly once: every alert has a dedupe key with a unique index and is inserted with
  `ON CONFLICT DO NOTHING`; a rerun of any job sends nothing twice.
- Quiet hours 20:00–08:00 IST hold back the rules marked `quiet_hours` — E6
  assigned, E7 status, E8 reply logged, E15 portal update — until the window ends
  (they are not dropped). E1 new notice and E9 sync anomaly are not held.
- E1 covers notices first seen within `new_notice_max_age_days` (30) of their issue
  date, so a first sync of an old backlog does not mail hundreds of "new" notices.
- **Auto-owner:** a new notice takes its client's `assigned_accountant` as owner when
  that name matches exactly one staff member's first name (logged as "Auto-assign").
  Existing ownerless notices are **not** back-filled by the migration;
  `notices_auto_assign_open()` does it on request.
- Links in the e-mails point at `notice_settings.app_base_url`
  (`https://gst.vjdesai.com`).

## 13. One stage vocabulary (Phase 2)

Notices and matters share one list, held in `notice_stages` and stored as a key in
`gst_notices.stage` and `litigation_matters.stage` (foreign keys; migration
`20261006120000`):

**New → Triaged → Evidence → Waiting on client → Draft → Partner review → Filed →
Hearing → Order → Appeal → Closed.**

- `staff_status` stays as a mirror for the Phase 0–1 logic that reads it (the closing
  sweep, `notice_is_closed`, the alert engine). Setting the stage writes it (the
  stage's label; empty for New; `Closed` unless a closed wording such as `Withdrawn`
  is already there). A writer that sets only `staff_status` moves the stage to match.
- **Facts move the stage forward, never back**, when nobody set the stage in the same
  write: a staff member gives a New notice an owner → Triaged; a reply is logged
  before Filed → Filed; an order is logged → Order; a hearing (today or later) is fixed
  once Filed → Hearing. The workspace adds: documents requested → Waiting on client;
  the last request received or waived → Evidence; a draft sent for review → Partner
  review; changes requested → Draft. An owner set by **Auto-assign** does not triage
  a notice — a person has to act on it first.
- A notice reopened from Closed goes to Triaged and loses its close reason.
- Matters: a legacy label written by an older screen (`'Reply drafting'`) is turned
  into its key by a trigger before the foreign key is checked; the matter's
  `status` (Open / Closed) follows its stage, and the reverse.
- Closing always asks a reason from the firm's list (§6) — singly and in bulk — and
  every bulk change offers Undo.

## 14. Today's plan: ranking and the next action (Phase 2)

`notice_plan` (migration `20261006122000`) gives every open notice the date that
drives it, how ready it is, one next action and a score. Today's plan on the command
centre and the Work queue page read it, so their counts agree.

- **The driving date:** an Order or Appeal runs on its appeal / attachment clock;
  Filed and Hearing on the hearing date; before filing, the reply due date — or a
  hearing fixed earlier than it.
- **Readiness (0–100 %)** comes from the stage: New 0, Triaged 10, Evidence 30–50 (by
  how much of the issues' amount the firm's data explains), Waiting on client 25–50
  (by documents received), Draft 60, Partner review 75–95 (by the draft's state),
  Filed 100, Hearing 50, Order 20, Appeal 30.
- **Score = urgency × value × (0.6 + 0.4 × readiness) × priority.** Urgency: overdue
  1.5–2.5 (rising over 60 days late), due today 1.2, then 1.2 / (1 + days ÷ 3), no
  date 0.15. Value: 1 + ln(1 + amount ÷ ₹1 lakh), amount = exposure, else demand, else
  the issues' total. Priority: High × 1.3, Low × 0.8. Ready work on a big, close
  deadline comes first; an untouched notice is not buried, because urgency dominates.
- **Next action:** no owner → Assign; a hearing within 7 days on a Filed / Hearing
  notice → Prepare hearing; then by stage — New → Triage, Triaged → Start work,
  Evidence → Build evidence, Waiting on client → Chase the client (while documents
  are open), Draft → Write the draft, Partner review → Review (draft in review) or
  File the reply (approved), Order → Decide on the order, Appeal → Follow the appeal.
  Filed / Hearing with nothing due are waiting on the officer and stay off the plan.
- **Order shown (the firm's decision of 7 October 2026):** notices run from new to old.
  Today's plan, the Work queue, All notices (every filter) and each client's notices
  open newest first by date of issue (the latest captured first on the same day,
  undated notices last). The score above is unchanged and one click away: "Most
  urgent" on Today's plan (remembered per browser, and carried to the Work queue it
  links to) and "Most urgent" in the Work queue's order picker; list headers still sort
  by due date, demand, stage and the rest.
- **Types hidden everywhere** (the firm's decision of 7 October 2026, for GSTR-3A) are
  in none of these: `notice_facts` leaves them out, so the plan, the queue, every list,
  tile, calendar and alert leave them out too (REPLY_FACTORY_POSITIONS.md §11).

## 15. The notice workspace (Phase 2)

One page per notice at `/notices/<id>` replaces the drawer; every e-mail, the bell,
search and every list link to it.

- **Issues** (`notice_issues`): what the notice alleges, the amount per notice, how
  much the firm's data explains, the position and annexures. Typed by staff for now;
  Phase 4 reads them from the PDF into the same rows (`source = 'extracted'`, marked
  "verify").
- **Draft reply** (`notice_drafts`): versions; "Send for partner review" →
  Partner review; only a GST manager or superadmin approves or asks for changes.
- **Documents from the client** (`notice_doc_requests`, alert **E12**): requests have
  a due date and are received or waived with a note. "E-mail the client" goes through
  the alert engine — a preview while alerts are in preview — and is signed by the
  staff member who sent it; reminders count up. A notice with open requests is
  "Waiting on client" and its next action is "Remind client".
- **Uploads** go to the `return-pdfs` bucket under `notices/<client>/uploads/<notice>/`
  and are listed with the portal's case-folder items and the notice PDF.
- **Payments** (`notice_payments`): a DRC-03 found by ARN in the portal pulls, or a
  pre-deposit / other payment typed in. They count against the demand on the page.
- **Deadlines:** statutory clocks from `matter_deadlines` (§10) can be marked met or
  overridden with a reason (`source = 'override'`), and exported to a calendar (ICS).

## 16. Alert e-mails (Phase 2)

Migration `20261006123000`:

- Every alert links to `/notices/<id>`; the e-mail shell shows that link as an
  **Open notice** button above the facts (and "Notice PDF" when there is one). The
  morning list opens the Work queue; the managers' overdue list opens the overdue
  list.
- Alerts to staff carry **no client greeting and no signature**. They open with a
  one-line headline ("Assigned to you · due in 2 days") and give the facts once:
  client, GSTIN, notice, reference, demand, stage, owner, reply due with days left,
  hearing, priority.
- **Colour follows days left, not the rule's priority:** two days or less (or
  overdue) red, a week amber, otherwise calm.
- Morning-list and overdue-list lines name client, form and reference, link to the
  notice and give days and amount; the overdue list is grouped by owner (nobody's
  first), most overdue first, and says how many more there are. Appeal-clock lines
  carry the order's number and date, the s.107(6) pre-deposit reminder for first
  appeals and a link to the matter.
- Client e-mails (E12, E13) keep the greeting and are signed by the staff member.
- Seeded templates were rewritten only where they still held their seeded text.
- **Deploy note:** the shell that sent mail uses is `supabase/functions/_shared/email.ts`
  (mirrored in `src/lib/emailTemplate.ts` for the in-app preview). The
  `send-gst-email` edge function must be redeployed before alerts go `live`, or sent
  mail keeps the old shell (it still works — the template bodies keep their text link
  — but without the button and with the old greeting).

## 17. Every number opens its list (Phase 2)

The command centre's figures come from one call, `notices_command_centre()`, defined
over `notice_facts` and `notice_plan` — the same views the lists read — so each tile,
plan tab, pipeline stage, calendar day and client count opens a list with the same
number (tested in `test_95_command_centre`, checked again in the browser pass). Ctrl K
searches clients by name or GSTIN and notices by reference, case ID / ARN, reply or
order number, form, and the DIN or reference inside case-folder items
(`notices_search()`).

**Sync health before the run ledger** (migration `20261006124000`): the run ledger
(`sync_run_items`) starts with extension v0.5.0. Until a client has been synced with
it, `client_sync_status` takes that client's last known state from the older
`client_sync_log` — its last good notices pull, or a failed login after it — so
"never synced" means no sync on record at all, and an old failed login still shows
as a login failure.

## 18. GSTR-3A closes when its return is filed (Phase 3)

A GSTR-3A notice ("notice to return defaulter u/s 46") says on its face that it
is deemed withdrawn if the return is filed before an assessment order. From
extension v0.6.0 the sync keeps the summary's return type and period on the notice
(`gst_notices.portal_detail -> 'gstr3a'`; `ret_period` is `MMYYYY`, as the portal's
own `gstr3actrl.js` reads it), and `notices_close_gstr3a_filed()` closes the notice
with `close_reason = 'auto:return_filed'` once Filing Status has that return filed
(`filed_date` set or status "Filed") for that client and period. It runs after each
sync's detail write and whenever a Filing Status row is marked filed (trigger
`filing_status_close_gstr3a`).

**Positions:** GSTR-3B settles a `3B` notice (monthly or quarterly row for the same
`MM/YYYY`), GSTR-1 or IFF a `1` notice. Annual (GSTR-9 / GSTR-4 annual) and final
(GSTR-10) GSTR-3A notices, quarterly periods and anything the period cannot be read
from stay open for a person. Only notices still at New, Triaged, Evidence, Waiting on
client or Draft close; one at Filed, Hearing, Order or Appeal has had something else
happen and is left alone. Like every automatic close it shows under "Closed
automatically today (reviewable)" and can be reopened.

The portal's own wording rebuilt into the GSTR-3A PDF now ends with a line saying
it is rebuilt by GST Keeper from the portal's GSTR-3A data (audit S-31).

## 19. Master filters, financial years and balanced pages (asked by the firm, 7 October 2026)

"Litigation year filters required, total litigation amount per year is not
needed. Master filters required to filter out anything." and "I need every page
to be balanced, properly structured and keep less text heavy and shall have
minimalist view." (migration `20261009110000_master_filters.sql`,
`src/lib/masterFilters.ts`, `MasterFilterBar`)

- **Five master filters, one row, every list page.** Client, financial year,
  owner, form and priority sit under the module's tabs on the command centre,
  the work queue, all notices, matters, hearings, the calendar, the MIS and the
  reports, and travel with the tabs (`?client=&fy=&owner=&form=&priority=`).
  Each page's own bar keeps only what is particular to it. The command centre
  applies them in the database (`notices_command_centre(p_user_id, p_filters)`,
  `notice_master_match`, `matter_master_match`) exactly as the lists do, so
  every number still equals the list it opens (test_103).
- **One year, however it is written.** "2019-2020", "FY 2019/20" and "2019-20"
  are the same year (`notice_fy_key`). A notice or matter with no year at all
  (905 live notices on 7 October 2026) is found under "Not stated" rather than
  under no filter. A matter matches a year when any of its years does, a form
  when any of its notices has it.
- **No totals per year.** The per-year amounts are gone from the MIS and the
  notice summary (the summary's FY tab with them); the year is a filter instead.
- **Balanced pages.** Panels sit in pairs (or threes) of equal height; an
  explanation is behind an (i) instead of a paragraph; a section with nothing in
  it is one line, not an empty card; the same figure is not shown twice on a
  page (the Reply Factory overview lost the row of tiles its sections repeated);
  a list opened from a count opens full width under the row it belongs to, and
  nothing is open by default.

## 20. Notices the portal has moved past; clients not handled; password issues (asked by the firm, 8 October 2026)

"So many notices showing on our dashboard which in fact is not the case …
everything has been synced but our system has not decided intelligently what to
close", "a settings section in notice section only where I should be able to
select for which client we are handling the litigation", and clients with password
problems "logged in our portal … so that the team can act". (Migration
`20261010100000_notices_cleanup_settings.sql`, page Notices · Settings.)

**Closing sweep, part 4** (`notices_sweep_superseded`, run by every sweep). Only
untriaged notices, reviewable and reopenable like every automatic close:

| Rule | Forms | `close_reason` |
|---|---|---|
| A later notice of the same case exists | ASMT-10, ASMT-02, DRC-01, DRC-01A/B/C, RFD-03, RFD-08, ADT-01/02, hearing notice, summons | `auto:superseded_in_case` |
| The case holds a reply and an order | the same | `auto:replied_and_decided` |
| A later registration notice of the client, or over 120 days old | REG-03, REG-17 / REG-SCN, REG-05, rejected cancellation request | `auto:registration_concluded` |
| The registration is active again, or a REG-22 revoked the cancellation | REG-19 | `auto:registration_restored` |

**Position:** orders (DRC-07, RFD-06, rectification orders, a cancellation that
stands) are never closed by these rules: their appeal clock is the task. 120 days
covers every registration reply window (7 to 30 days) and the appeal window (three
months plus one month of condonation). On the live data (8 October 2026) the first
run closed 247 notices and left 73 open, from 320: 153 registration notices, 113
case notices that had moved on (38 DRC-01, 16 DRC-01A, 14 hearing notices, 11
ASMT-10, 9 RFD-08 …).

**Clients not handled** (`clients.notices_handled`, Settings). Off: the client's
notices leave `notice_facts`, so every task, list, count, plan, report and alert;
events about them raise no e-mail; the notices sync skips the client
(`notices_sync_excluded` follows the switch). Back on, everything returns: nothing
is deleted. Changing it needs the permission to add and edit clients.

**A changed password re-queues the client** (migration `20261010110000`, asked the
same day). `clients.gst_password_changed_at` is stamped whenever the portal
password or user ID changes, wherever it is changed (Clients > Credentials, Edit
Client). A login or notices failure recorded before that moment no longer counts
as failing, in the command centre and the Clients list alike: the client shows as
"Password changed · not synced yet" until its next sync, which logs in with the new
password. A failure after the change counts again. One time, on 8 October, the
clients whose record had been edited after their last login failure were given
that edit as their change time (3 of 15 then failing).

**Password issues** (`clients.portal_login_issue`). Set by extension 0.8.2 when the
portal refuses the saved login (wrong user ID or password, locked account, expired
password, a required change); listed in Settings with the portal's words; skipped by
every person's and scheduled sync; cleared by a new user ID or password in Edit
Client, by "Fixed", or by a login that works.

Portal Autopilot positions (CAPTCHA posture, office-only agent, sessions, the
inbox, acceptance measures) are in `docs/PORTAL_AUTOPILOT_POSITIONS.md`.

**A CAPTCHA failure is not a password issue** (asked by the firm, 8 October 2026;
extension 0.8.3, migration `20261010120000`). Three CAPTCHAs the portal would not
take, or no answer at all, are filed as `captcha_failed` ("CAPTCHA not accepted"),
retried by the next sync and never recorded in `clients.portal_login_issue`. Only a
portal refusal (wrong user ID or password, locked, expired, change required) is
`login_failed`. A trigger on `sync_run_items` files an older extension's CAPTCHA
failures the same way (`login_failure_is_captcha`: a message about the CAPTCHA that
names neither the user ID nor the password); an unexpected page after Login is
`portal_error`.

## 21. One case per issue, a dashboard per kind, pages per kind (asked by the firm, 9 October 2026)

The firm asked for notices to be grouped by issue, with "different dashboard view for
every single issue", the correspondence of an issue merged but every new arrival from
the department visible, and refund (and other non-demand) pages without the demand
fields that do not apply. Migration `20261011100000_notice_cases.sql`.

- **Kinds** (`notice_track(category)`): *Notices & demands* (DRC, ASMT, audit,
  enforcement, recovery, rectification, appeal), *Refunds*, *Registration*, *Other*
  (LUT, voluntary payments, approvals: record only). The command centre and the new
  Cases page (`/notices-cases`) have a tab per kind; each kind shows its own tiles.
  The "Notices & demands" tiles count cases of that kind only.
- **A case** (`notice_case_key`, view `notice_cases`) is the portal case ID. Registration
  correspondence, which the portal files under no case, is one case per client (`REG`).
  A notice with neither is its own case. A case's kind is the most serious kind among
  its notices (litigation, then refund, then registration). The case is worked on its
  *lead* notice (the open one due first, else the latest). The master filters apply to
  the lead.
- **Correspondence** (view `notice_case_correspondence`, `notice_case_items`) is every
  notice and every case folder document of the case, each from the department or from
  the taxpayer. The folder's copy of a notice already listed (same reference) is merged
  into that notice, not listed again. An item is **new** when it arrived on a later sync
  than the client's first one (the first sync brings the whole history), in the last
  30 days, and after the case was last opened (`notice_case_seen`, one row per case for
  the whole firm). Opening the case page marks it seen.
- **The overview** (`notice_case_overview`): section, financial year, period, DIN, reply
  due, hearing, officer and demand. Each value is taken from the notice itself, else from
  the case's other notices (newest first), else from what the AI read in the case's
  documents (`ai_documents.overview`, newest document first), and says which. A reply
  date or hearing older than 30 days in an old document is not offered. A value the PDF
  reader found but could not check against the page is shown marked "not checked"
  rather than left blank.
- **Refunds** show the application as filed (ARN, reason, period and amount from the
  RFD-01 in the case folder; status from the refund list), the amounts the AI read in
  the orders (provisional, sanctioned, rejected, net payable, paid), and the steps
  RFD-01 → 02 → 03/08 → 04 → 06 → 05. A step is ticked when its form is among the case's
  notices or is named by a file in its case folder. **Registration** shows the
  application and its step. **Other** shows only what the item is.
- **The notice page by kind** (`tabsFor`): a notice or demand keeps every tab. A refund
  or registration notice shows the AI assistant and Draft tabs only when its type needs
  a reply (critical, e.g. RFD-08, REG-03, REG-17), plus Documents, Activity and
  Deadlines. Other shows Documents and Activity. The stage rail, the demand tiles,
  hearings, evidence and matters appear only for notices and demands. A record-only
  notice's main action is "Read and close".
- **Lines under a page's title** say something only when something is wrong (the firm:
  "irrelevant on almost every screen"): sync failures by cause, a failed run, the AI
  reader stopped or capped, autopilot paused, failed or waiting.

## 22. Linked cases; link when certain, suggest otherwise (asked by the firm, 9 October 2026)

Migration `20261012100000_notice_case_links.sql`. The firm's rule: "everything should be auto
linked if 100% confidence, or if it is not then recommendation options".

- **Certain, linked by itself** (`notice_case_links`, source `auto`, rebuilt by the sweep and
  whenever a case folder item arrives): a case folder item that names a notice of another
  case (an appeal or waiver application's reference or `orddtl.ordnum`, an order's
  `orginalOrderNo`) links its case into that notice's case. Every case view uses the root
  (`notice_case_root`), so an appeal, its hearings, the SCN and the order are one case.
  A DRC-03 whose cause of payment names a notice's reference is linked to it. An appeal
  application's pre-deposit is recorded on the order it appeals (`notice_payments.auto_ref`).
- **The order's clock:** an order with an appeal filed against it moves to the stage
  *appeal*. It stays open with its demand as exposure, and is never overdue or due in 7.
  An order whose s.128A waiver was approved (SPL-APPROVED) closes (`auto:waiver_settled`).
- **Not certain, suggested** (`notice_link_suggestions`): DRC-03s scored on financial year,
  paid after the notice, a cause mentioning a notice or audit, and an amount matching the
  demand (shown at 40 and above on the Payments tab). For an appeal case with no link, the
  client's orders are offered, best first. A person's link (`notice_case_link_set`, source
  `manual`) survives every refresh.
