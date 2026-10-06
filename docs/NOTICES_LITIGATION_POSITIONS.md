# Notices & Litigation — Elected Positions

How the notices module interprets GST portal data, and the positions it
encodes. Read this before changing auto-close logic, due-date extraction,
or the KPI tile definitions.

**These positions were implemented by engineering judgement during
Phases 0 and 1 of the notices roadmap, not confirmed in a firm sign-off
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
`useNoticeSet()`; `notices_dashboard_summary()` returns the same counts in one call.

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
