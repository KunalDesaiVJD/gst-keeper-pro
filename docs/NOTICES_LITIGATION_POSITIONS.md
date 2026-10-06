# Notices & Litigation — Elected Positions

How the notices module interprets GST portal data, and the positions it
encodes. Read this before changing auto-close logic, due-date extraction,
or the KPI tile definitions.

**These positions were implemented by engineering judgement during
Phase 0.3–0.6 of the notices roadmap, not confirmed in a firm sign-off
conversation.** Flag any that don't match how the firm actually wants it
to work; each is a localised change to reverse.

---

## 1. "Open" vs "Closed"

A notice is **closed** when `staff_status` matches one of:

```
Closed, Withdrawn, Dropped, Disposed, Deleted, Adjudged
```

(Case-insensitive prefix match — see `isClosed` in
`src/utils/noticeSummaryReport.ts`.)

Everything else — including `null` (no manual status yet) — is **open**.

**Position:** The portal's own `status` field (e.g. "Reply filed") is
informational only. Only the manually set `staff_status` decides
open/closed. This means a notice stays open even after a reply is filed
until staff explicitly close it (or the sweep does — see §3).

## 2. KPI tile definitions

Four tiles on the dashboard, each a strict filter over the notice list:

| Tile | Filter | Source |
|---|---|---|
| **Open** | `!isClosed(staff_status)` | `isOpen()` |
| **Overdue** | Open AND no `reply_date` AND effective due < today IST | `isOverdue()` |
| **Due in 7 days** | Open AND effective due >= today AND <= today+7 | `isDueIn7()` |
| **New (24h)** | `first_seen_at` within last 24 hours | `isNew()` |

**Effective due date** = `extended_due_date ?? due_date`. If both are null,
the notice can never be overdue or due-in-7.

Canonical implementations: `src/utils/noticeDefinitions.ts`.

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

Not yet automated (Phase 1 of the roadmap): GSTR-3A notices closing when the defaulted
return is filed; DRC-07 / rejection orders moving to "Order received" with an appeal
deadline instead of staying open.

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

**Position:** case rows carry no portal due date, so each sync writes NULL there and
the sweep (which runs right after) refills it; a newer notice in the case therefore
moves the date forward. Portal rows (`get/notices`) keep the portal's own due date.
Staff override with `extended_due_date`.

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
