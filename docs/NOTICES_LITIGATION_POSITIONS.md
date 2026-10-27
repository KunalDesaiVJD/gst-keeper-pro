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

## 23. What to do now on every case (asked by the firm, 12 October 2026)

"In refund it says overdue, then using AI a suggestion or recommendation to be mentioned here: what is expected from the user?"

- **Where it shows.** Every open case, except *other*, carries one next step. It shows at the top of the case page as a card with the headline, where the case stands, up to four steps (each marked firm or client, with a date), the date that governs it and why, and whether the case can simply be closed. If the case shows overdue, the card also says why: whether anything can still be done, or whether the date has passed with nothing left to do. The home work list and the Cases table show the headline in one line.
- **Who writes it.** The notice assistant (Edge Function `notice-ai`, actions `advise` and `advise_next`, `advise.ts`) writes it. It reads the case's facts, its correspondence as read (newest 20) and today's date, and the answer is kept in `notice_case_advice`. pg_cron `notice-ai-advise` runs every five minutes and handles up to four cases a run, in this order: cases someone asked for, then cases never advised, then overdue, due this week, and with something new. A case is advised again when its stage, due date, hearing, notices, documents or the number of them read changes (`notice_case_advice_hash`). "Ask again" on the card asks the assistant now; it answers in about half a minute.
- **Until the AI has answered.** The usual step for the form under GST law shows, marked as such (`usualStep` in `src/lib/noticeAdvice.ts`). For example: DRC-01 → reply in DRC-06; DRC-07 → appeal in APL-01 within three months or pay; RFD-06 → appeal a rejection or close once paid; REG-19 → revocation in REG-21 or close.
- **Guidance only.** Nothing is filed, paid or closed by it, and a partner decides. Advice runs under the reader's switch (`ai_settings.read_enabled`). Like the reader, it never adds a hyphen or dash to what staff read.

## 24. Whose work, whose move, closing for good (asked by the firm, 12 October 2026)

- **Kinds of work per client.** Some clients have only refunds or only litigation handled by the firm, and another CA handles the rest. Notices · Settings sets, per client, which kinds the firm handles: notices and demands, refunds, registration, other (`clients.notices_tracks_off`). A kind switched off leaves `notice_facts`, so it disappears from every tile, list, count and e-mail. The client-wide switch (`notices_handled`) stays as it was.
- **Handled elsewhere, per case.** A superadmin or GST manager can mark one case as handled elsewhere from the case page (`notice_case_exclude`; `gst_notices.excluded_at`, with who and why). The whole case leaves `notice_facts`, and so do notices that arrive in it later (trigger `gst_notices_inherit_exclusion`). Notices · Settings lists these cases with a **Bring back** button.
- **Closing a case for good.** Only a superadmin or GST manager can close a case or reopen it (`notice_case_close`, `notice_case_reopen`; the role is checked in the database against `user_roles`). Closing needs a reason and closes every open notice of the case. A closed notice offers no reply option, no appeal clock and no new matter. A closed case gets no AI advice, and the advice never suggests an appeal on a case that is closed or being closed.
- **Whose move.** Every case is *with us*, *with the department* or *closed* (`notice_cases.waiting_on`). A case is with the department when its stage is filed, hearing or appeal, when every open notice is replied, or when the latest paper in it is ours. A case with the department is neither overdue nor due: we have answered. On 12 October 2026 this took litigation overdue from 30 to 14. Home, the kind cards, the Cases tabs and every row show it.
- **AI.** Documents are read by `ai_settings.doc_model`, Haiku by default (Reply Factory → AI → Documents: model). Calls through the CLI gateway record their tokens as `tokens_in` / `tokens_out`, estimated at about four characters a token when the gateway reports none. These are kept apart from the billed `input_tokens` / `output_tokens`, so they never count against the daily cap. They show per document on the case timeline and in the AI Documents list. The case advice is about half as long: at most 3 steps and 2 cautions, with word limits per field.

## 25. Fresh only, and the officers' book (asked by the firm, 12 October 2026)

- **A sync fetches only what is fresh** (extension 0.10.0). The notices list is read in one call and saved whole, so the counts and soft deletes stay right. A notice's PDF is fetched only when the notice is new. A case's folder is fetched only when:
  - the case is new;
  - a notice or task in it is new or changed status on the portal; or
  - the weekly gap fill is due.

  An open case with nothing new is looked at once a week, and every client gets a full pass every 30 days so a silent change in an old case is still caught in the end. The trade-off, accepted for speed, is that a document an officer uploads into an existing case with nothing else changing can take up to a week to appear. If anything about the stored notices cannot be read, the run fetches everything, as before.
- **Officers' book** (`notice_officers`). There is one row per officer, keyed by the name as the case shows it, normalised by `notice_officer_key` so the same officer written twice is one row. It holds a mobile (checked to be a phone number), an e-mail, the office and a note.
  - Staff add a mobile with **Add mobile** under the Officer field, on the case page or the notice page. It then shows on every case of that officer as call, WhatsApp and e-mail links.
  - Notices · Settings lists the book, to edit or remove an entry.
  - The portal's `issued_by` is mostly a state name or "System Generated", so the contact is offered only for a real name.

## 26. Sync scope, what is failing, hiding one notice (asked by the firm, 12 October 2026)

- **Inactive clients are synced for notices.** An inactive registration still gets notices, so `inactive_at_hand` no longer leaves a client out of the notices sync, the "not synced" count or Sync All (extension 0.10.1, `sync_queue`, `autopilot_enqueue` for notices jobs, `notices_command_centre`, the Clients page). Returns pulls still skip inactive clients. A client the firm does not handle stays out (`notices_handled`).
- **Failing means something staff can fix.** Only a refused login or password, a CAPTCHA, or the wrong GSTIN in the session counts as failing (`sync_reason_actionable`). "The scheduled Chrome was offline", a portal error, or a client whose portal list simply has no notices is no longer shown as failing or "not synced". The home line reads, for example, "19 clients not synced (19 login failed)".
- **One notice can be hidden.** A superadmin or GST manager can hide a single notice with More → Not required (hide) on the notice page (`notice_exclude`, `excluded_scope = 'notice'`). The rest of its case stays. Only a whole case hidden as handled elsewhere (`excluded_scope = 'case'`) also hides notices that arrive in it later. Notices · Settings → Hidden cases and notices brings either back.
- **DRC-01B and DRC-01C need no urgent reply.** Their reply is optional and their default priority is Low. The firm explains or pays these intimations at its convenience.

## 27. Not important notices, and the date on every paper (asked by the firm, 12 October 2026)

- **Not important.** A notice the portal issues as "System generated", and every DRC-01B and DRC-01C, is not relevant for a reply (`notice_is_system_generated`; `notice_facts.system_generated`):
  - it needs no reply, so it is never overdue or due;
  - it stays off the dashboard and sits under Other (`notice_cases.track`);
  - its reply templates are switched off (kept, so they can be switched back on).

  It stays on record and can still be opened. On 12 October 2026 this moved 13 cases to Other and took litigation overdue from 30 to 19.
- **The date on the paper.** Every item of a case's correspondence is dated, in this order:
  - the date on the paper: a notice's date of issue, or for a document the date the AI read printed on it (`notice_doc_date_ok`: between July 2017 and today);
  - otherwise the date the portal gives (`notice_folder_item_date`, which now also reads a reply's date and declaration, a payment's date, a filing date and a draft's date).

  It is never the day it was synced. On 12 October 2026 every one of the 1,326 items had a date.

## 28. Linked cases seen linked or apart; linked by the numbers they share (asked by the firm, 24 October 2026)

"In Tamnna-GJ one appeal is filed against a case and both are showing but not linked"; "in MJ Surgical one refund was partially rejected and an appeal was filed, both showing but not linked"; the portal should "understand how and in what manner it is linked", seen "as linked way and also unlinked way". Migration `20261024100000_notice_case_chains.sql`, tests `test_114_case_chains.sql`.

- **Why they stayed apart.** §22 linked an appeal only when its application (folder sections APLCN / ORDRS) named the reference of a *notice* in the other case. An order that is only a document in the other case's folder (an RFD-06 refund order, a DRC-07 filed as a folder item), or a number in another field, was never matched.
- **Certain, linked by itself** (`notice_case_links_refresh`): two cases of the same client whose papers carry the same portal number are one chain. A portal number is 15 characters, two letters, two digits, eleven letters or digits (references, order numbers, ARNs, case IDs; a GSTIN or a DIN is never taken), read from every notice field, its description and portal detail, every case folder item's reference and raw JSON, and what the AI read in the case's documents (`notice_case_idents`). A number on papers of more than three cases says nothing certain and is ignored.
- **Which way round.** The appeal, waiver or rectification belongs to the case it is against; between two of a kind, or neither, the later case belongs to the earlier; a case-less notice joins the portal case. Refund applications sharing a number are a *fresh application* (`reapplication`). Never into a circle, never the registration bucket (`REG`). Each link says why (`notice_case_links.reason`: the number both carry).
- **Suggested otherwise** (`notice_case_link_candidates`, shown at 40 and above on the case page): an appeal (waiver, rectification) against a case holding an order +40, filed within 120 days of the order +30 (within about a year +10, dated before it −20), same financial year +15, same amount +15 or the amount equal to the refund rejected +20, an appeal about a refund against a refund case +20 (about a demand against a demand case +10), the order has no appeal linked yet +10; two refund applications +25. The firm's rule stands: linked by itself only when certain, otherwise offered.
- **A person decides.** Staff who can edit notices link any case (Link a case, kind and direction), unlink one (the pair is kept apart through every refresh, `notice_case_link_blocks`), or hand it back to the system (Let the system decide, `notice_case_link_reset`). Unlinking an appeal puts the order it had moved to the appeal stage back in the order stage, unless another appeal still names it.
- **Linked or apart.** Cases → Linked shows one row per chain (`notice_cases`), with the number of linked cases and their kinds. Cases → Apart shows every portal case on its own row (`notice_cases_flat`, counts `notice_cases_counts_flat`), each saying what it is linked to. On the case page, Linked cases shows the chain as a tree, the original case first, each case saying in what manner it is linked ("Appeal against the RFD-06 order ZF… of 12 Mar 2025 (refund partly rejected)", the refund outcome from what the AI read in the orders) and how (by itself, with the number; or by whom). Correspondence shows every linked case, each item marked with its own case, or one case alone (`?part=<case>`, `notice_case_items.own_key`). `notice_cases_flat` must change with `notice_cases` (test_114 compares their columns).
- **Tightened after the first live run** (`20261024110000_notice_case_links_owned.sql`). On live the first rule linked an M J Surgical refund into its LUT case (the RFD-01 names the LUT it exports under), and two refunds through a third case's ID that both replies quote. A link by itself now needs a number that is one of the two cases' own (its case ID, the reference of a notice or order in it, a folder item's reference outside applications and replies: `notice_case_numbers.owns`; `notice_case_numbers` replaces `notice_case_idents`, which stays unused), and neither case of the kind *other* (LUT, voluntary payment, acceptance). Both stay open to suggestions and to a person. The refund outcome ("partly rejected") is shown only when the amount the AI read as rejected is below the amount sanctioned: on live it often read the claim as the rejection.
- **Applications filed on the portal** (`20261024120000_notice_case_applications.sql`). An appeal only submitted (APL-01, "Appeal Submitted") has no case folder or notice yet: the portal keeps it only in its applications list (`gst_portal_applications`, with the s.128A waivers and rectifications), whose `appItem.refId` is the order it is against. The linker reads that list: an application is a case by its ARN (appeal, waiver or rectification by its case type), its ARN is its own number and its refId the order's, so it is linked under the case holding that order as soon as the application arrives (trigger `trg_gst_portal_applications_link`). Until it has a folder or notice of its own it is listed in that case's correspondence (kind *application*, from us) and in the chain as "filed on the portal, no notice yet". Live on 24 October: M J Surgical's appeal AD241225010791I against the refund order ZD240925036738Y (case AA240725124515C), Tamnna Infrastructure-Gujarat's AD241025009582I against ZD240725066729V (case AD240624007234I).
- **Linked by itself only at 90% or more; below that a person decides** (asked by the firm, 25 October 2026: "whenever AI is confused while tagging and having low confidence less than 90% then the system may ask human"; `20261025100000_notice_case_link_review.sql`, section 8 of `test_114_case_chains.sql`). Every link the system would make is scored first (`notice_case_link_confidence`) by the strongest number both cases carry: the order of one case 95, a case ID 90, a notice reference 85, another number one case owns 75, else 60; two or more numbers in common +4; an appeal, waiver or rectification naming the order +3; a link that is only *related* between two portal cases −10; at most 99. A trigger on `notice_case_links` (`trg_notice_case_links_gate`, auto rows only; a person's link is never gated) makes the link only at `notice_case_link_min_confidence()` = 90 or above, with the score and "(N% sure)" in its reason; below it, the pair goes to `notice_case_link_reviews` and is not linked. Live on 25 October: appeals, waivers and rectifications naming their order 98%, SBL's refunds filed again 94%, the case-less Sorath notice 95%, M J Surgical's refund filed again 90%; four links of 75% (Crownglobe's reapplication, two of SBL's and one of Unity Organics' related notices) now wait for a person.
- **Links to check** (Cases page, called Needs a person until 25 October 2026, a banner shown only while any wait, `notice_case_review_queue`, the master client filter applies) lists three things, each with how sure the system was and why: a link under 90% (Link, choosing the kind, or Not linked, which keeps the pair apart through every refresh); an appeal, waiver or rectification linked to no order, with the best suggestion if any (Link to it, or Nothing to link); two cases that look like the same case, the same order reference or the same order form, financial year and amount within ₹1, in different chains (Link as related, or Not the same case). Every decision is kept with who made it and when (`notice_case_review_decide`); a linked or kept-apart pair leaves the list, and a dismissed item stays away until the facts change. Tamnna-GJ's two DRC-07 cases, each with its own appeal, were checked on 25 October and are different cases: different financial years, orders and amounts.

## 29. One page for refunds (asked by the firm, 25 October 2026)

A refund showed in four places (Refunds, Cases → Refunds, the case page, the case folder) and the Refunds list "looked very poor". The firm chose (from three drawn options) a quarter grid plus a register, and a page per refund:

- `/refunds-all`: four numbers (claimed, sanctioned, rejected, still open) and what needs action; for one client the **quarter grid** (a row per financial year, a column per quarter, a lane per type of refund, a quarter missing between a type's first and latest refund marked "not filed", a total per year); for all clients one line per client with the same numbers; then the **register**, grouped by financial year with a total per year.
- `/refunds/:clientId/:arn`: one page per refund, for all of them (only about a quarter have a case page, since a case needs a notice): next step, steps with dates, amounts with their source, linked cases (`notice_case_links`, §28), and the portal history with each paper's documents. Cases → Refunds, the case page and the case folder of a refund point to it.

A refund sits in the quarter its period starts in: `fromRetPrd` / `toRetPrd` of the RFD-01 item in its case folder (114 of 133 refunds on 25 October 2026), else the period the AI read in its papers, else, marked, the month it was filed.

Position, by engineering judgement: the portal leaves `sanctioned_amount` empty, so sanctioned, rejected, provisional and paid are read from what the AI read in the refund's own **orders** (`ai_documents.overview`, `doc_kind = 'order'`), never from a notice (whose "rejected" is only the amount proposed for rejection); a figure above the claim is dropped, and so is a "rejected" that with the sanction exceeds the claim. The sanction read this way feeds the status map, so a refund sanctioned in part gets its appeal clock (s.107) and counts under Needs action while the window runs. Each figure on the refund page says which document it came from. Code: `src/components/notices/reports/ledgerData.ts` (`readRefund`), `refundModel.ts`, `RefundGrid.tsx`, `RefundRegister.tsx`, `RefundSummary.tsx`, `src/pages/RefundPage.tsx`.

**Year and period everywhere** (the firm: "Need Year & Period of the refund on all pages of refund"): every screen that shows a refund (Cases → Refunds, a refund's case page, its case folder, the refund page, the Refunds page) shows the same chip, the financial year and the period of the claim, from the same source as the grid (`refundWhen`, `RefundWhenChip`).

**What a refund is linked to** (the firm: "in refund page, how case to be linked here? I guess there is some logical confusion"). The suggestions of §28 offered any two refund applications of a client filed within 120 days of an order as "a fresh application after it": every refund case listed the client's other quarters and types (live, 25 October 2026: 19 suggestions on one M J Surgical refund, all wrong). A refund belongs with another case in two ways only: an appeal (APL-01), waiver or rectification against its order, as before; and the same refund filed again after a deficiency memo, a rejection or a withdrawal, which is the same type of refund for the same (overlapping) period (`notice_refund_ident`: `gst_refund_applications.refund_type` and the RFD-01's period). Refunds of another type or period are never offered (score 0), and a refund with any other case at most 20 (offered from 40), both still listed by the manual picker. After the change, 5 suggestions remain across every refund case, each a refund filed twice for the same type and quarter. The case page of a refund says this in words, shows each linked refund's year and period, and names the suggestion "this refund filed again" or "an appeal against this refund". Migration `20261025150000_refund_link_candidates.sql`.

**An appeal against a refund** (the firm: "refund is filed for refund case and also it is showing here but it is not opening ... no documents ... not linked with any refund"). An appeal the appellate authority has not taken up has no notice and no case folder, so it had no page: M J Surgical's AD241225010791I (against the RFD-06 ZD240925036738Y of refund AA240725124515C, Apr to Jun 2025) was linked to its refund (98%) but only listed, unclickable, under Applications on the portal, and that refund has no case page either. The portal's own record of the appeal in My Applications (`gst_portal_applications.raw_json`, `appItem.itemJson`) carries the order, its dates, the period, the amount in dispute, the refund claimed and granted, the ground and the files filed with it; `src/lib/portalAppeal.ts` reads it. Applications on the portal now says what each appeal is against and opens its refund page (or the case of the order); the refund page shows the appeal's facts and lists its files as on the portal, not downloaded (the extension does not fetch an appeal's own files yet). A refund with an appeal linked against it no longer asks to decide on an appeal: it waits on the appeal.

**The client page, shorter** (the firm: "the page is too long and also irrelevant information"): a refund's portal case is no longer listed again among the case folders (on M J Surgical, 46 case folders were mostly the refunds' own); refunds are the four numbers and what needs action, with the way to the client's quarter grid and register; DRC-03 shows the latest five.

## 30. Every event of a case on its timeline, and one way into a case (asked by the firm, 25 October 2026)

"Make sure that all events are shown here properly. APL-01 is missing here. Document also and chronological event also ... what all events are there in GST law and what all should be shown here for proper decision making"; "if I click on any case then I go to [the notice] instead of [the case] ... If user click on work on it then only detailed case should be opened." Migration `20261025140000_notice_case_timeline.sql`, tests `test_115_case_timeline.sql`.

- **Why the APL-01 was missing.** A case folder item was hidden as "the folder's copy of a notice already listed" whenever any notice of the chain carried its reference. An appeal's application (APLCN) carries the number of the order it is against, so once §28 linked the appeal under its order, the APL-01 was taken for the DRC-07 and dropped (live: 10 items, 9 of them appeals, among them Tamnna Infrastructure-Gujarat's AD2406260074481). A copy is now only an item of the notice's own portal case (or of a case-less notice), never an application or a reply; a notice's files and AI reading come only from that copy too, so an appeal's documents never land on the order. An appeal's own application reads "APL-01 · Appeal filed against <order>", dated the day it was filed.
- **What the portal's record says** (`notice_folder_facts`, `notice_case_item_facts`, carried by `notice_case_items` as `facts`): an appeal's order, the date it was communicated, the tax and total in dispute, the pre-deposit and its rate, the filing date, the issues, the portal status, and every document filed with it; a hearing's date, time and place; a due date; the section and financial year. Documents the record lists but the extension has not downloaded are named "on the portal, not downloaded yet": on live 253 of 366 applications have files the extension never fetched, because the portal spells their name `docname` (the extension reads `docName`); that is a separate extension change.
- **Key dates** (`notice_case_key_dates`), on the same rail as the papers:
  - the time to appeal an order: 3 months from communication (s.107(1)), condonable one more month (s.107(4)); against an appeal order, 3 months to the Tribunal (s.112(1)), condonable 3 more (s.112(6)). The 3 months end on the same date three months on, the day of the order not counted (s.9 General Clauses Act): an order of 9 March may be appealed on 9 June. Counted from the date the appeal record gives as the order's communication, else the order's date, and then says so;
  - whether an appeal was filed in time, on the last day, late within the condonable time, or beyond;
  - the pre-deposit against 10% of the tax in dispute (before the Tribunal a further 10% from 1 Nov 2024, 20% before; worked per Act since §34) (s.107(6), s.112(8)), and the stay of recovery it brings (s.107(7));
    the amount paid is the APL-01 record's `orddtl.predepositamt`, else `orddtl.paidamt` (the portal fills the first on only some appeals; the second always, with the payment's PRN in `orddtl.prn`, shown on the line and the APL-01 card); a record with no amount at all reads "Pre-deposit not shown on the portal record" (info), never "₹0 paid" (20261025170000: 9 paid appeals had shown short); `notice_predeposit_audit()` (20261025190000) gives every appeal on record a verdict, `paid`, `short`, `no_amount` or `unread` (an `orddtl` field about a deposit or payment the reader does not know, so a new portal shape is caught before it shows a wrong figure), read through the same `notice_folder_facts`; anything but `paid` is for a person, never a payment assumed; `test_116_predeposit.sql` holds the reader to every shape seen live;
  - each personal hearing once, and adjournments counted per portal case against the three the law allows (s.75(5));
  - replies due on open notices (not on orders);
  - the demand's payment date (s.78), muted once an appeal stays recovery;
  - the windows to pay and close with a reduced penalty, for periods before FY 2024-25 only (from then s.74A applies): s.73(8) none, s.74(5) 15% before a notice (by the DRC-01A's date), s.74(8) 25% within 30 days of the notice, s.74(11) 50% within 30 days of the order. An adjournment letter the portal files as a DRC-01 is not a notice of its own.
  Each says its provision. These positions were implemented by engineering judgement and are for a partner to confirm.
- **The case page** shows the timeline after the case's facts, oldest first (newest first on a click), each key date in line with the papers, upcoming ones marked, the notice the page was opened from outlined. A paper is read on the timeline; only its "Work on it" opens the notice's workspace.
- **One way into a case.** Every list, search, alert, calendar and hearing entry opens the notice's case with its timeline (`noticeCaseHref`: the case when the row has it, else `/notices-open/:id`, which finds the case), the notice marked; "Work on it" beside it opens the workspace. The client page's case folders open the case, not the raw folder (the case page keeps a Portal case folder button). Task links that open a workspace tab on purpose (a draft, deadlines, payments, the assistant, the Reply Factory) stay as they are; Refunds' links are left to its own redesign.

## 31. The dispute year on every case and notice (asked by the firm, 25 October 2026)

Cases and All notices each have a **Dispute year** column (`DisputeYearCell`), read from the views `notice_case_dispute_years` (per case: scope `apart` as `notice_cases_flat`, `linked` as `notice_cases`, a chain taking every year of its cases) and `notice_dispute_years` (per notice), migration `20261025160000`. Before this, a year showed only when the portal stated one on the notice (141 of 1,178 notices); the views find one for 448.

- **Where the year comes from, best first** (`basis`, shown under a derived year): the FY stated on the notice (the portal's, or one read and kept in `read_fields`); the notice's period (`period_from` / `period_to`, every FY it spans); the AI reading of the notice's papers (`ai_documents.overview`: its FY, else its period); the portal record in the case folder (a refund's `fromRetPrd` / `toRetPrd`, a DRC-03's FY, an LUT's FY); the AI reading of the case's other papers; for a notice that names none, its case; and last the case it is linked to (an appeal takes its order's year). Only the best kind found is used: a stated FY is never mixed with a year read from a period.
- **Nothing is written back.** `gst_notices.financial_year` stays as the portal or a person left it; the FY filter still reads it.
- **Unknown stays unknown.** A notice with no year anywhere shows "Not stated"; no year is guessed from the issue date (DRC-01B / DRC-01C intimations, refunds of an excess cash balance and audit notices are the usual cases). Registration is not about a year and shows a dash.
- The Excel export carries "Dispute year" (with where it came from) beside "FY on the notice".

## 32. One layout for the module (the UX audit of 25 October 2026, "fix all")

Engineering judgement on layout, not a tax position; nothing here changes a count, a flag or a clock.

- **Tabs.** Home, Cases (its badge is the open cases of notices and demands, refunds and registration), Notices, Calendar, Refunds, Clients; More holds Reports (Notice summary, DRC-03 payments, Litigation MIS) and Setup (Portal sync, Autopilot, Reply Factory, Settings). Matters and the Litigation MIS stay out of the menu while no matter is on record.
- **Record pages** (a case, a notice, a refund, a matter, a client) keep the tabs and search and carry one breadcrumb, tab › client › record (`NoticesShell record crumbs`).
- **Home** counts once (the attention tiles), then My work (`?work=mine|team|unassigned|review`, `?when=overdue|due7`) beside the next 14 days. My work runs newest notice first (`loadCases` `sort: 'newest'`, the case's `last_issue_date`; Review by the notice's `issue_date`), with the form (DRC-07, ASMT-10) and the dispute year (`notice_case_dispute_years`) in their own columns. Overdue by age and Just in were taken off Home on 25 Oct 2026 (Meet): the Overdue tile and the rows' "new" badges say both, and My work takes the width. The Work queue page is retired (`/notices-queue` → Home's My work), as is Hearings (`/notices-hearings` → the Calendar's agenda).
- **Cases** opens on All (every kind but Other) with one control row; Status and Stage read as one column, "Where it stands"; the unsure links show as a "Links to check" banner only while any wait.
- **Case page**: the next step, then the timeline (Papers, or the portal's own folder as **Portal view**, `?view=portal`) beside a facts rail. The separate case folder page is gone; `/notices-case-folder/:client/:case` redirects there, or to the refund page for a refund.
- **Notice page**: Issues, Evidence and Draft are steps 1 to 3; Payments, Hearings and Deadlines show only when they hold something; the facts sit in a side rail.
- **Calendar** also shows each open case's key dates (time to appeal, pre-deposit, pay to close, `notice_case_key_dates_range`, 20261025160000; a case's appeal date the matter's appeal clock already shows that day is left out), and has an Agenda view of the next 60 days.
- **Clients** (`/notices-company-list`) is the portfolio list once called GSTIN-wise count (`/notices-gstin-wise-count` redirects); the sync table is **Portal sync** (`/notices-portal-sync`). A client's page leads with its open cases.
- **Names**: Autopilot's "Needs a person" tab is "Runs to retry"; Cases' is "Links to check". Notice types are set only under Reply Factory → Notice types.

## 33. The Appeal view of a case, with AI drafts (asked by the firm, 25 October 2026)

"Once appeal is filed, like work on case, work on appeal section also need to be created: draft documents for filing an appeal like AI generated statement of facts, grounds of appeal and also suggested detailed written submission based on evidence and reading previous cases & our submissions. Where case is under appeal, user can have 2 split views, 1. Case and 2. Appeal." Implemented by engineering judgement; the choices below are reversible defaults, not a firm sign-off.

- **When the Appeal view shows.** The case page has a **Case | Appeal** switch (`?side=appeal`) when the case holds an appeal on record (an APL-01 in its case folder, or the portal's APPEL application, `notice_case_appeals`), and also, as **Prepare appeal**, when it holds an order an appeal lies against (`notice_appealable_forms()`) whose three months and one month of condonation (s.107(1) and (4)) have not run out, or that already has a draft. An order past that time with no draft and no appeal shows no switch.
- **An appeal is keyed by the order it is against** (`appeal_key` = the order's reference). Drafts made while preparing the appeal stay with it once it is filed and its ARN arrives. Two appeals against one order would share drafts (not seen on live).
- **Three documents, every version kept** (`notice_appeal_drafts`): the statement of facts, the grounds of appeal and the detailed written submission. Staff save a new version (`notice_appeal_draft_save`, refused when someone saved a newer one meanwhile) and mark one **final**. Word download (.docx) and copy; nothing is filed by the app.
- **What the AI reads** (`notice_appeal_context`, Edge Function `notice-appeal-ai`, which reaches Claude through notice-ai's own `claude.ts` / `cli.ts` and the same secrets, so notice-ai is never redeployed for it): the appeal's portal facts (order, dates, amounts in dispute, pre-deposit, the portal's issue category); the order as read (its reading and its documents' paragraphs, up to 40); the appeal's own papers as filed (when it is filed); every document of the case as read (30, oldest first), named as staff named them and marked as evidence with the type staff gave (`case_document_labels`, PR #207); the firm's replies in the case (the latest draft of each notice) and the issues with staff's positions; the appeal's other documents (the grounds build on the facts, the submission on both, the submission on the grounds as filed); the staff member's guidance; and precedents.
- **Precedents ("previous cases and our submissions")**: the firm's appeals filed on other cases (their APL-01 papers as read), its replies on other cases, and the final appeal documents of the same kind on other appeals, ranked by the words they share with the order. **Another client's work is used only when that client is chosen under Reply Factory → Learning** (`clients.ai_learning`) or the document itself is (`learning_included`), the same gate as the reply assistant's examples; this client's own other cases always count. On 25 October 2026 no client is chosen, so only the same client's earlier cases are used until the firm chooses some. The model is told never to carry another client's names, GSTINs, amounts or facts.
- **The rules of the reply assistant hold**: the AI switch and consent (`ai_settings.read_enabled`, `ai_read_allowed`), the assistant's daily cap (logged as purpose `assist`), no invented citation (`[citation to confirm]`), placeholders for missing facts with questions for the client, cautions (limitation, condonation, pre-deposit), and **no hyphen or dash** in any saved text (`reply_dehyphen`, on the AI's answer and on staff's saves).
- **The AI drafts in the background**: the request returns at once with the run's id (`notice_appeal_ai_runs`); the page looks again every 5 seconds while it runs, and the answer arrives as a new version. One run per document at a time; a run older than 10 minutes counts as failed.
- Migration `20261025180000_notice_appeal_workspace.sql` (additive); the pre-deposit status and the key dates stay with §30.

**Drafting only where it still makes sense (asked by the firm, 25 October 2026):** "When appeal is filed, portal should intelligently remove drafting option of statement of facts & grounds of appeal; similarly check other perspective in other notices & cases also, but drafting of written submission should be there through AI assistance." One rule for the appeal (`supabase/functions/_shared/appealStage.ts`, read by the Appeal view and by `notice-appeal-ai`, which refuses what it does not allow, `doc_closed`), one for the notice page (`src/lib/noticeDrafting.ts`):

- **An appeal's stage** (`appealPhase`): *preparing* (not filed, within three months) and *late* (the month of condonation) draft all three documents; *filed* (submitted, admitted, a hearing fixed, a reply submitted) drafts only the **written submission**, and the statement of facts and grounds stand as filed with the APL 01 (their tabs show only when drafts were made before filing, to read, copy or download); *withdrawn* (the portal's status), *decided* (a disposed status, or an APL 04 of the case dated on or after the filing) and *time over* draft nothing and keep their drafts to read. For a filed appeal the AI is told to argue the grounds as filed, in their order, and to name in cautions any new ground the papers suggest (it needs the authority's leave) rather than add it.
- **A notice's stage** (`draftingPhase`): while a reply is prepared (*reply*), everything as before. An **order** (the forms of `notice_appealable_forms()`) is not replied to: its Draft tab is named **Letters** (rectification, stay of recovery, payment and close, the reply options of its form), the AI assistant tab is not offered, the reply steps are not numbered, there is no extension or Log reply, and the page points to the case's Appeal view (*Prepare the appeal* / *Open the appeal*, the primary action once the order is assigned, shown only when the Appeal view has an appeal to offer). A notice whose proceedings have **moved on** (stage Order or Appeal on a notice that is not itself the order), a notice whose **reply is filed** (until a hearing is fixed, which opens drafting again for the written submission at the hearing), and a **closed** notice keep their drafts to read, with no AI assistant and no editing; their Draft tab shows only when it holds a draft.
- On the case page the **Work on it** button shows on the Case side only; on the Appeal side the documents are the work.

## 34. The law audit of 26 October 2026 (L1 to L16, "start fixes all L1 to L16")

Migrations `20261026100000` (limitation, holidays), `20261026110000` (forms, the pre-deposit per Act, orders not overdue), `20261026120000` (key dates, appeal clocks, Tribunal appeals), `20261026130000` (sign-off). Test `supabase/tests/notices/test_117_law_audit.sql`. Every figure below is a default set by engineering judgement and **unconfirmed** until a partner confirms it in Notices · Settings → Law rules.

- **Limitation (L1).** `gst_limitation_years` holds, per FY, the annual return due date and the last dates for an order under s.73(10) (the s.168A dates of N. 9/2023 and 56/2023 for FY 2017-18 to 2019-20, whose validity is before the courts) and s.74(10), and for an SCN under s.74A(2) from FY 2024-25. `notice_limitation(fy, section)` reads it. The case timeline shows the last date for an order while none is on record, a time-barred case when that date passed with no order, an SCN issued after the last date (s.73(2): 3 months before the order date; s.74(2): 6 months), and an order passed after its time limit, each marked as a ground. A section the notice does not state is read as s.73, with the s.74 date named.
- **Pre-deposit (L2, L3).** `notice_predeposit_required(amounts, kind, filed)` works it per Act from the APL-01's own heads (`orddtl.initamt`, `dispamt`, `paidamt` / `predepositamt`, read into `notice_folder_facts.amounts`): the admitted amount (demand less disputed) in full plus 10% of the tax in dispute, capped at ₹20 crore CGST or SGST and ₹40 crore IGST from 1 Nov 2024 (25 / 50 before); before the Tribunal a further 10% (20% before 1 Nov 2024), capped at 20 crore (50 before); a penalty-only order 10% of the penalty for appeals filed from 1 Oct 2025, nothing before; a s.129 order (MOV-09) 25% of the penalty. A record with no heads falls back to the total, and says so. The 20% the timeline used for every Tribunal appeal is gone.
- **s.74A and DRC-01A (L4, L5).** For FY 2024-25 on, pay-to-close within 60 days of the SCN with no penalty or 25% where fraud is alleged, and 50% within 60 days of an order holding fraud (s.74A(8), (9)). A DRC-01A's window is worded as lasting until a DRC-01 is issued (s.73(5), s.74(5)); the date shown is the intimation's reply date.
- **Forms (L6).** New rules: ADJOURNMENT (no reply of its own), DRC-08, ASMT-13, ASMT-15, ASMT-16, RFD-07, MOV-01/02/04/05 (informational), MOV-06, MOV-10, MOV-11, SPL-07, RVN-01. `notice_appealable_forms()` is now exactly the active rules with an appeal section (DRC-07A, ASMT-16, MOV-11 and SPL-07 added); `ORDER_FORMS` in `src/lib/noticeDrafting.ts` matches. An ASMT-13 shows the s.62(2) deemed-withdrawal date (60 days, a further 60 with extra late fee).
- **Revocation and rectification (L7, L8).** A REG-19 shows the last day for REG-21 (90 days, extendable by 180) and says a cancellation the client asked for needs nothing; an open order shows the s.161 rectification date (3 months), noting the appeal clock keeps running.
- **Appeal clocks met (L9).** A trigger on `matter_deadlines` marks an `appeal_%` clock met once an APL-01, an APPEL application or a recorded Tribunal appeal names the order (`notice_order_appeal`); arrivals touch the client's open clocks.
- **The Tribunal (L10).** Condonation is 3 months under s.112(6) (`appealStage.ts`, `condonationMonths`), 1 under s.107(4). GSTAT appeals are not on the GST portal, so staff record them on the Appeal view (`notice_tribunal_appeals`, `notice_tribunal_appeal_save`); orders communicated before 1 Apr 2026 may be appealed until 30 Jun 2026.
- **Orders are not overdue (L11).** `notice_facts.is_overdue` / `is_due_in_7` leave out appealable forms: an order's date is a payment date (s.78), flagged as `is_payment_overdue`.
- **Refunds (L12).** The refund page shows its time limits (`refundClocks`): the relevant date estimated from type and period, the 2 years of s.54(1), the fresh claim after a deficiency memo with the pending time left out (rule 90(3), memos from 26 Dec 2022), the order due in 60 days (s.54(7)) and the 6% interest of s.56 after it. A cash ledger refund has no time limit.
- **Order checks (L13).** A DRC-07 demanding more than its DRC-01 (s.75(7)) and an order with no hearing on record before it (s.75(4)) are shown as grounds.
- **Wording (L14)** of the usual steps for DRC-01, DRC-07, REG-05, REG-19, and new ones for ASMT-13, APL-04, MOV-09.
- **Holidays (L15).** `add_working_days` skips the active `gst_holidays` besides Sundays; the national fixed holidays are seeded, the firm adds the rest in Notices · Settings.
- **Sign-off (L16).** `litigation_rule_confirm`, `notice_form_rule_confirm`, `gst_limitation_year_confirm`, for a GST Manager or the superadmin, set `confirmed_at` / `confirmed_by` and may correct the figure.


## 35. The loopholes of the law audit (P2 to P8, "then start p2-p8")

Migration `20261027100000` (plus the parts of `20261026110000` / `120000` named below), test `test_118_loopholes.sql`.

- **P2.** `gst_notices` is open to the public key (no Supabase session), so any write could hide a case. A trigger (`gst_notices_exclusion_guard`) now refuses any change to `excluded_at` / `excluded_reason` / `excluded_scope` / `excluded_by_name` unless it comes through `notice_case_exclude` or `notice_exclude`, which set a transaction flag after checking the level. Closing stays open to staff, as every page closes notices. The person is still named by the browser (`p_actor_id`): the lasting fix is a signed session, an Edge Function issuing a JWT at login so the database knows who acts. That is the firm's decision to make.
- **P3.** A portal due date before the issue date is taken as a portal error: the rule's period is used, else 30 days from the issue date, and `due_basis_note` says so (`notice_facts`, `20261026110000`). `notice_stale_demands()` lists open demands at New past their date of at least `escalate_demand_rs` (₹5 lakh, a Law rule), on Notices Home for GST Managers and the superadmin. Nothing is e-mailed: the alert engine stays off until the firm turns it on (P1).
- **P4.** `notice_case_unread_papers()` names a case's papers the assistant could not read (scans needing vision, files that are not PDFs, documents too long), on the case page and the Appeal view. They are not yet named inside the AI's own context, which needs a redeploy of the Edge Functions.
- **P5.** `notice_case_appeals.pending_days`, shown on the Appeal view. The timeline flags an appeal pending 12 months or more (s.107(13)), and any DRC-13, DRC-16 or DRC-22 after an appeal was filed (s.107(7), s.112(9)).
- **P6.** On a DRC-07, a DRC-03 linked to the case, or one whose cause names the SCN, order or demand paid since the case began, is flagged to be adjusted in DRC-03A (rule 142(2B)). The liability register is not read: that needs the extension.
- **P7** (open cases' folders read daily) and **P8**'s private-bucket item need the Chrome extension, so they are left to their own change. P8's matters (none exist) wait on the firm: retire them, or create them from appealed orders. The 399 reply clocks of hidden GSTR-3A notices are left as they are.
