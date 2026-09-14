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
   via the Chrome Extension. Then click **Sweep** to run the auto-close
   and due-date extraction pass.
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

The **Sweep** button runs two passes:

1. **Auto-close** — notices that have no `staff_status` yet and whose
   case folder shows a closure or final order are automatically closed:
   - CLOSURE folder section found -> `auto:closure`
   - Refund type + ORDERS section -> `auto:refund_order`
   - LUT type + ORDERS section -> `auto:lut_approval`

2. **Due-date extraction** — notices with no `due_date` get one parsed
   from their case-folder items' portal JSON.

The sweep never touches notices where you have already set a status.

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
