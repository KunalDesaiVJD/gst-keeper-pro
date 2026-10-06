# Notices Module — Staff Operating Procedure

Quick-reference guide for the GST team working with the Notices Dashboard.

---

## Daily workflow

1. **Open the Notices Dashboard** (`/notices-dashboard`).
2. **Check the KPI tiles** at the top:
   - **Open** — total notices not yet closed. Click to filter.
   - **Overdue** — open notices past their due date with no reply logged.
     These need immediate attention.
   - **Due in 7 days** — upcoming deadlines. Plan your week around these.
   - **New (24h)** — notices first seen in the last 24 hours from a sync.
3. **Sync** — click "Sync All" to trigger a fresh pull from the portal
   via the Chrome Extension (v0.4.0 or later — the app refuses older copies;
   see `extension/README.md` → Updating). The closing sweep (auto-close and
   due dates) runs by itself after each client and again nightly — there is
   no need to click it.
4. **Triage new notices** — open each new notice, review the portal data,
   and set a `staff_status` (e.g. "Under Review", "Reply Drafted").

## Setting status on a notice

Click the pencil icon on any notice row in the workflow list to open the
edit dialog. Fields available:

| Field | Purpose |
|---|---|
| **Priority** | High / Medium / Low tier |
| **Reply Ref No.** / **Reply Date** | Track that a reply was filed |
| **Order No.** / **Order Date** | Track an order received |
| **Submission ARN** / **Submission Date** | Track a submission filed |
| **Extended Due Date** | Override the portal due date if an extension was granted |
| **Amount of Demand** | Numeric amount demanded |
| **Financial Year** | e.g. 2025-2026 |
| **Assign To** | Staff member responsible |
| **Close Reason** | Why this notice is being closed (e.g. "resolved", "withdrawn", "auto:closure") |
| **Remarks** | Free-text notes |

## Bulk operations

Select multiple notices using checkboxes, then use:
- **Bulk Set Priority** — assign the same priority to all selected notices.
- **Bulk Set Status** — assign the same `staff_status` to all selected.
  When setting status to "Closed", you can also fill in a close reason.

## Auto-close sweep

The sweep runs **by itself**: right after each client's sync, and every night at
03:00 IST. The "run the closing sweep" link on the dashboard runs it on demand.

1. **Auto-close** — notices with no status yet whose case folder shows they are
   finished are closed, with a reason:
   - closure folder → `auto:closure`
   - refund with a **payment order** (and no rejection) → `auto:refund_paid`
   - LUT with an order → `auto:lut_approval`
   - DRC-03 voluntary payment acknowledged → `auto:drc03_acknowledged`
   A refund with only a sanction/rejection order stays open — a rejection may need
   an appeal.
2. **Due dates** — case notices get the due date of their own document in the
   case folder, or else of the latest notice in the case not yet replied to.

The sweep never touches a notice you have already given a status.

## Owner, manual notices and deleting clients

- **Assign To** in the edit dialog is a staff picker. Pick the person, not a typed
  name — that is what puts the notice in their "Mine" queue and sends them the
  "assigned to you" e-mail.
- **Add Notice** is for notices the portal sync does not bring (physical notices,
  summons, e-way bill matters). They are never removed by a sync. Adding a reference
  already on record is refused.
- A client with notices or litigation matters **cannot be deleted** — mark the
  client inactive in Edit Client instead.

## Reports

Under the **Report** dropdown in the top nav:
- **Notice Summary** — filterable list of all notices with workflow fields.
  Export to Excel.
- **GSTIN Wise Notice Count** — count of notices, refunds, and DRC-03
  filings grouped by client/GSTIN.

## Tips

- **Extended Due Date** takes priority over the portal's due date for
  overdue calculations. If you've been granted an extension, log it here.
- A notice with **no due date** (neither from the portal nor manually set)
  will never show as "Overdue" or "Due in 7 days" — it stays in the
  Open count only.
- The `auto:` prefix on close reasons means the sweep set it. You can
  override it by editing the notice and changing the close reason.
- Use the **Company List** (`/notices-company-list`) to see notices
  grouped by client, and click through to individual company profiles.
