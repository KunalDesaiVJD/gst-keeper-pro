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

`runAutoClose()` in `src/lib/noticeAutoClose.ts` batch-closes notices
that have no `staff_status` yet, based on their case-folder contents.
Three patterns:

| Pattern | Trigger | `close_reason` | Rationale |
|---|---|---|---|
| **Closure folder** | Any folder item with `folder_section` in {CLSR, CLOSR, CLOSURE} | `auto:closure` | Portal itself says the case is closed |
| **Refund + Orders** | `notice_type` matches `/refund/i` AND folder has ORDRS/ORDER/ORDERS | `auto:refund_order` | Refund application that got its order — resolved |
| **LUT + Orders** | `notice_type` matches `/letter of undertaking\|lut/i` AND folder has ORDRS/ORDER/ORDERS | `auto:lut_approval` | LUT approved via order — resolved |

**Position:** Only notices with `staff_status IS NULL` are candidates.
If a staff member has already set any status (even "Open"), the sweep
will not touch that notice. This prevents the sweep from overriding
manual triage.

**Position:** The sweep sets `staff_status = 'Closed'` and writes the
`close_reason` tag. It does *not* write `reply_date`, `order_date`, or
any other field — those remain the staff member's responsibility.

## 4. Due-date extraction

`runDueDateSweep()` in `src/lib/noticeAutoClose.ts` fills in `due_date`
for notices where it's null, by parsing the case-folder items' `raw_json`.

Extraction paths, in order:
1. `raw_json.sdtls.duedate`
2. `raw_json.dtscn.duedate`
3. `raw_json.duedate`

Formats recognised: `DD/MM/YYYY` and `YYYY-MM-DD` (ISO).

Only folder items with section in {INTIM, NOTCE, NOTICES, INTIMATIONS,
NOTICE/ACKNOWLEDGEMENT, NOTAC} are considered. When multiple items match,
the **earliest** due date wins.

**Position:** `due_date` extracted this way is a best-effort parse of portal
JSON. It is not authoritative — the portal API doesn't expose due dates on
case-task rows directly. Staff should verify and can override via
`extended_due_date`.

## 5. Soft-delete

The Chrome extension sync now uses upsert + soft-delete (`deleted_at`
timestamp) instead of destructive DELETE+INSERT. All queries in the
notices module filter `deleted_at IS NULL`.

**Position:** A soft-deleted notice can be restored by setting
`deleted_at = NULL`. The sync will re-soft-delete it on the next run if
the portal no longer returns it.

## 6. Close reason taxonomy

The `close_reason` column on `gst_notices` is free-text but follows a
convention:

- `auto:closure` — set by the sweep (§3)
- `auto:refund_order` — set by the sweep (§3)
- `auto:lut_approval` — set by the sweep (§3)
- Anything else — manually typed by staff in the edit dialog or bulk-close

The `auto:` prefix distinguishes machine-set reasons from human ones.
