# Notices & Litigation — Staff Operating Procedure

Quick-reference guide for the GST team. The module is under **Notices & Litigation**
in the sidebar; its pages are the tabs at the top of every module page: Command
centre · Work queue · All notices · Matters · Hearings · Calendar · Clients ·
Autopilot · Reports. **Ctrl K** (⌘K on a Mac) searches anywhere: a client's name or GSTIN, a
reference number, case ID / ARN, reply or order number, or the DIN printed on a
notice.

---

## Daily workflow

1. **Open the Command centre** (`/notices-dashboard`). The line under the title says
   whether the portal sync and the alerts are healthy.
2. **Read the tiles**: overdue, due in 7 days, new in 24 h, without an owner, in
   partner review, exposure. Every number opens a list with exactly the same count —
   if they ever differ, report it.
3. **Work Today's plan.** It ranks every open notice by how close its deadline is,
   how much money is involved and how ready the reply is, and gives each one button
   for the next step (Assign, Triage, Remind client, Write the draft, Review, Log
   reply, Prepare hearing, Decide on the order…). Tabs: Mine · Team · Unassigned ·
   For review. The **Work queue** tab is the same list, full page.
4. **CAPTCHAs (once the Portal Autopilot is switched on)** — the office agent
   fetches the portal for every client each morning and the urgent ones after lunch,
   but each login needs a CAPTCHA typed by one of us. When the header shows
   "n waiting for a CAPTCHA" (and at 09:00), open **Autopilot → CAPTCHA wall**, type
   each CAPTCHA and press Enter: the next one is ready while the agent reads the
   client you just let in. "Can't read it" gets a new one; "Skip this client" leaves
   it for today. Keep the wall open until it says nothing is waiting. You can
   work in another tab meanwhile: the tab title shows how many are waiting (and,
   if you allow it, a desktop notice), and the agent keeps fetching as long as you
   type one at least every 10 minutes. See "Portal Autopilot" below.
5. **Sync by hand** — "Sync now" asks which clients (stale and failed first) and either
   sends them to the office agent (their CAPTCHAs then come to the wall) or starts
   the Chrome extension on your PC (v0.6.0 recommended; its toolbar popup can start
   the same run). Clients with deadlines in the next 7 days go first; only new
   documents are downloaded. If nobody types a CAPTCHA for 10 minutes, an extension
   run skips that client and says so. The closing sweep runs by itself after each
   client and nightly.
6. **Check Hearings and the Calendar** for the week (personal hearings, reply dues,
   appeal and attachment clocks). Either exports to your calendar (.ics).

## Portal Autopilot (Notices → Autopilot)

An always-on office PC runs the agent, which uses the same extension in its own
browser. It ships **switched off**; a manager switches it on in the Settings tab.
Positions and the CAPTCHA posture: `docs/PORTAL_AUTOPILOT_POSITIONS.md`.

- **CAPTCHA wall** — CAPTCHAs for clients waiting to be logged in. People type every
  CAPTCHA; nothing is solved by software. The page counts what you typed today.
- **Queue** — today's jobs: waiting, running, done, failed (with the reason), and
  Retry / Cancel.
- **Needs a person** — clients the portal refused, grouped by the fix: a changed
  password (update it in Edit Client, or "Ask the client"), a locked account ("Ask
  the client to reset" — they get an OTP), CAPTCHAs never typed (open the wall), a
  cancelled registration (mark the client inactive). "Ask the client" e-mails go out
  only once client e-mails are switched on (they are off now).
- **Fetch a report** — queue any portal pull (returns, 2B, ledgers, refunds…) for
  chosen clients and periods; results land in the same reports as an extension pull.
- **Portal e-mails** — notice e-mails from the portal read from the firm's notices
  inbox; each queues its client straight away (when the e-mail trigger is on).
- **Acceptance** — per day: share of clients fresh or with a named reason, time at
  the CAPTCHAs (and minutes the wall was open), how fast new notices arrived.
- **Settings** (managers) — on/off and pause, schedule (05:30 all, 13:00 urgent),
  browsers at once, keep portal sessions (ask the partner first), e-mail trigger.

Every sync now also reads **applications on the portal** (appeals and others; shown on
the client's page) and the **registration status**, and a **GSTR-3A** closes itself
once Filing Status shows that return filed.

## The notice page

Every notice has its own page, `/notices/<id>` — opened from any list, the bell,
search or an e-mail. At the top: what the notice is, its due date (and whether it was
computed or extended), priority, owner and stage, with the one main action for its
next step; "Ask client", "Extension" and "More" (log reply / order, hearing, matter,
open on the portal, notice PDF, case folder) beside it.

- **Stage** — one list for notices and matters: New → Triaged → Evidence → Waiting on
  client → Draft → Partner review → Filed → Hearing → Order → Appeal → Closed. Change
  it from the header; closing always asks why. Logging a reply moves it to Filed,
  logging an order to Order, requesting documents to Waiting on client, sending a
  draft for review to Partner review — you do not need to set those by hand.
- **Issues** — list what the notice alleges, the amount for each, how much your own
  data explains and the firm's position. The figures at the top of the page add
  them up (amount, explained, short).
- **Draft reply** — start from the issues, save versions, send for partner review. A
  GST manager or the superadmin approves or asks for changes.
- **Documents** — the notice PDF, the portal's case folder and your uploads in one
  list. "Ask client" records what you need from the client with a date, and can
  e-mail the request (signed by you); "Remind" sends a reminder for what is still
  open. Mark each item received or waived.
- **Activity** — who did what, in plain words, including what the sync and the
  sweep did. Add a note here.
- **Payments** — link the client's DRC-03 (found by ARN) or record a pre-deposit.
- **Hearings** and **Deadlines** — the hearing and every statutory clock (reply,
  appeal and its condonation limit, attachment lapse). Mark a deadline met, or
  override it with a reason; export to your calendar.

## Lists

**All notices** has one filter bar (Show · Stage · Owner · Category · Form · FY ·
Priority), with the active filters as chips you can clear. Sort by any column. Tick
rows to change stage, priority or owner in bulk — every bulk change can be undone
from the message that confirms it. Export to Excel. On a phone the list becomes
cards.

## Owners, adding notices and clients

- **Assign** from the owner chip on a row or the notice page: Me, the client's
  accountant (suggested), or anyone on the staff list. A new notice takes its client's
  accountant as owner automatically when that name matches one staff member.
- **Add notice** (Command centre or All notices) is for notices the portal sync does
  not bring. Attach the PDF first, pick the form (it sets the reply window and the
  default priority), and set owner, priority and FY in the same dialog. A reference
  or case ID already on record is caught as you type — open that one instead. The new
  notice opens in its page.
- A client with notices or litigation matters **cannot be deleted** — mark the client
  inactive in Edit Client instead.

## Auto-close sweep

The sweep runs **by itself**: right after each client's sync, and every night at
03:00 IST. Command centre → "Closed automatically today" (and Reports → Closed
automatically) lists what it closed and why, so you can reopen any of them.

1. **Auto-close** — notices with no status yet whose case folder shows they are
   finished are closed, with a reason (closure folder, refund paid, LUT approved,
   DRC-03 acknowledged, proceedings dropped, response accepted, informational order).
   A refund with only a sanction/rejection order stays open — a rejection may need an
   appeal.
2. **Due dates** — case notices get the due date of their own document in the case
   folder, or else of the latest notice in the case not yet replied to.

The sweep never touches a notice you have already moved.

## Due dates you did not type

- When the portal gives no due date, the app **computes** one from the form's usual
  reply period (e.g. DRC-01B: 7 days); the notice page marks it "computed" with the
  basis. The periods are **not yet confirmed by the firm**. If the notice states a
  different date, record it with "Extension" (granted) on the notice page.
- The **Deadlines** tab is written automatically. A date you override stays yours;
  the computed date is shown beside it.

## E-mail alerts (switched off until turned on one by one)

- **Today (6 Oct 2026) notice e-mails are off**: the mode is **Off** and every rule is
  switched off, so nothing is written or sent — to staff or to clients. "Ask client"
  and "Remind client" still record the request on the notice and say "Not e-mailed".
- **To turn them on one at a time** (a GST manager or the superadmin): Settings → GST
  Reminders → Notice Alerts. Set the mode to **Preview** (alerts are written to the
  Email outbox for review, never sent) or **Live** (sent), then switch on one rule,
  check what it produces in the Email outbox, and only then switch on the next.
  Only switched-on rules write anything, in either mode. The rules: new notices to
  their owner (every 15 minutes, one e-mail per client), assigned to you, stage
  changes, replies logged, portal updates on a case, the 09:30 morning list, the
  managers' overdue and unassigned lists, the Monday MIS, sync problems, and the two
  e-mails to clients (documents needed, status update).
- Routine alerts (assigned to you, stage changes, replies, portal updates) between
  20:00 and 08:00 wait until 08:00; a new notice is sent straight away.
- Every alert has an **Open notice** button that lands on the notice's page; lists
  link each line to its notice.

## The bell

The bell (top right) lists what changed on notices and matters — by the team, the
portal sync and the sweep — naming the client and the notice. Unread lines are
highlighted and counted on the bell; "For me" shows only notices and matters you own.
What you have read is remembered across computers.

## Reports

Reports ▾ in the module tabs: Notice summary, GSTIN-wise count, Refunds, DRC-03
payments, Litigation MIS, Closed automatically. Their counts open the same lists.

## Tips

- **Extended due date** takes priority over the portal's date for overdue
  calculations — record an extension when it is granted.
- A notice with **no due date** never shows as overdue or due in 7 days; it is in the
  Open count and on the "No due date" filter — give it a date.
- Positions behind these rules (what counts as open, the ranking, auto-close) are in
  `docs/NOTICES_LITIGATION_POSITIONS.md`.
