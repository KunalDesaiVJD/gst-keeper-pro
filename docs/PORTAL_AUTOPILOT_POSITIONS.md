# Portal Autopilot — Positions and the CAPTCHA posture

How the Portal Autopilot (roadmap Phase 3) reaches the GST portal, what it
will and will not do, and how its numbers are measured. Read this before
changing anything in `agent/`, the agent hooks in `extension/`, or the
autopilot migrations (`supabase/migrations/20261007120000`–`123000`).

**These positions were written by engineering from the roadmap and the
mission audit. The partner has not signed them off yet.** The autopilot ships
switched off (`autopilot_settings.enabled = false`) and nothing reaches the
portal until a manager switches it on in Notices → Autopilot → Settings. §1
and §5 are the decision record the roadmap asks the partner to confirm
before that (`docs/notices-mission-audit/roadmap.mjs`, decisions "CAPTCHA
posture", "Agent host", "Portal e-mail inbox").

---

## 1. The CAPTCHA posture (decision record)

- **People type every CAPTCHA.** Each portal login CAPTCHA is shown on the
  app's CAPTCHA wall (`/notices-autopilot?tab=wall`) and typed by a member of
  staff. No CAPTCHA solver, OCR model or third-party solving service is built,
  configured or used. The old agent's "solver seam"
  (`agent/src/captchaSolver.ts`) has been deleted, not left empty.
- **No CAPTCHA is fetched for nobody.** The agent opens a portal login only
  while somebody has the wall open (`autopilot_presence`, a ping every 2 s
  while the wall is on screen; open = a ping in the last 30 s). Otherwise the
  job is parked as `waiting_captcha` and the portal is not contacted at all.
- A person can say a CAPTCHA is unreadable ("Can't read it" — the agent
  reloads the login page for a new one) or skip a client for the day ("Skip
  this client" — recorded as `skipped_at_wall`).
- A CAPTCHA that nobody answers within `captcha_refresh_secs` (150 s) is
  replaced by a fresh one while the wall stays open; a wrong one is retried by
  the extension up to three times, as for a person.
- CAPTCHA images are deleted from the database (`portal_jobs.human_prompt`)
  the moment they are answered.

## 2. What the agent is

An always-on PC **in the office** runs `agent/` (Node + Playwright). Each of
up to four "workers" is one Chromium profile with the **same GST Keeper
extension the staff use**, copied from the repo at every start. The agent
starts a job in the extension (`startAgentJob`), relays the CAPTCHA, and
waits; logging in with the saved password, reading notices, refunds, DRC-03,
applications and the profile, and saving them through `sync_ingest` is the
extension's own code, unchanged from a person's Sync. So the portal sees what
it sees when a member of staff syncs: the same pages, the same calls, in the
same order.

The agent **never** files, submits, saves a return, pays, offsets ITC or
replies to a notice. The old agent's save-to-portal scaffolds were deleted.
Report pulls are limited to the extension's pull modes
(`autopilot_report_modes()`).

## 3. Where it runs, and how hard it pushes

- **Office-local only**, on the office network staff use. No cloud runner, no
  datacenter address, no proxy, no IP rotation, no browser-fingerprint or
  "stealth" tricks, no header the extension does not already send. The
  GitHub Actions workflow and the Render / Docker files that ran the old agent
  in the cloud were removed (the portal had refused datacenter addresses; the
  agent does not try to get round that). The agent's browser is an ordinary,
  visible Chromium window on the office PC by default; it does not hide that it
  is automated (no user-agent or `navigator.webdriver` masking). **If the portal
  ever refuses the agent's browser, the agent is not disguised** — staff keep
  syncing with the extension in their own browsers, as before.
- **Pace:** one client per browser at a time; 2 browsers by default, 4 at
  most (`concurrency`); a 1.5–3 s pause between clients; the extension's
  incremental pulls (stored PDFs are not downloaded again, case folders only
  for new or open cases, one full pass a week).
- **When:** a morning run (05:30 IST, every active client), an afternoon run
  (13:00 IST, `afternoon_scope` = priority: notices due within 7 days or
  overdue, never synced, not synced for 20 h, or failing), a sync when a
  portal e-mail arrives (§6), and reports staff ask for. The clock is a
  pg_cron job every 5 minutes (`autopilot_tick`); a slot fires once per IST
  day. At `close_at` (23:30 IST) anything still waiting is closed with a
  named reason (`captcha_timeout`, `not_reached`, `agent_offline`).
- **Kill switch:** Settings → master switch (or Pause). Off means no job is
  claimed (`portal_job_claim` returns nothing) and a job waiting for a
  CAPTCHA is parked; a client already logged in finishes its pull.

## 4. Credentials and sessions

- Portal passwords stay where they are (the client master). The extension
  reads a client's password at the moment it fills the login form, as for a
  person; the agent never logs or stores it.
- The agent uses only the app's **publishable (anon) key** — no service-role
  key on the office PC (the old agent needed one).
- **Portal sessions never leave the office PC.** By default the agent logs
  out after each client and clears the browser's cookies, like a person. With
  "Keep portal sessions" on (off by default — ask the partner first), a
  client's portal cookies are kept **encrypted** (AES-256-GCM, key
  `AGENT_SESSION_KEY` in `agent/.env`) on the PC for up to 50 minutes, so a
  second job for the same client needs no CAPTCHA. Without a key nothing is
  kept. The database table `portal_sessions` is no longer used.

## 5. Client authorisation (decision record)

Automated access to the GST portal with stored credentials is against GSTN's
terms of use and carries IT Act exposure (see the 2023 GSTN advisory; this
was already stated in the old agent's README). The firm's position, to be
confirmed by the partner: the autopilot is used only for clients whose
**written authorisation for the firm to access the portal on their behalf
with stored credentials is on file**. Until a client's authorisation is on
file, mark the client "Exclude from notices sync" (Edit Client) — the
autopilot skips such clients exactly as Sync now does.

## 6. Portal e-mails (S stage 5)

The agent reads a dedicated notices inbox (IMAP, read-only — it never
deletes, moves or marks a message) when the e-mail trigger is on. Only
e-mails from `gst.gov.in` (or forwarded portal e-mails) are considered. It
stores the subject, a 400-character snippet and the extracted GSTIN, form
code and reference (`portal_emails`) — never the whole e-mail or its
attachments; OTP digits are masked. A GSTIN that is exactly one client's
queues a priority-90 notices sync for that client — but only for an e-mail
that reads as a notice (a form in `notice_form_rules`, a `Z…` reference, or
notice wording such as notice, order, intimation, show cause, demand,
defaulter); routine portal e-mails (OTPs, filing acknowledgements, payment
receipts) are recorded as `ignored` and queue nothing, since every sync costs
a CAPTCHA. When the notice arrives the e-mail is linked to it and the capture
time kept. Setting up the inbox (a notices@ mailbox, clients' forwarding rules
or the firm as registered contact) is the firm's decision. Microsoft 365
mailboxes no longer accept a password over IMAP (they need OAuth, which the
agent does not do); Google Workspace with an app password works
(`agent/src/mail/README.md`).

## 7. E-mails the autopilot can send

Both are alert rules, **off** like every alert until switched on one by one
(the user's instruction of 6 Oct 2026):

- **E16 · CAPTCHAs waiting** — 09:00 IST nudge to the team when clients are
  waiting for a CAPTCHA. The header badge and the command centre show the same
  count in the app regardless.
- **E17 · Client: portal access** — from the Autopilot page's "Ask the
  client" on a rejected password or a locked account. Its templates ask the
  client to share a new password through their usual secure channel and **not
  by e-mail**.

## 8. Header rewriting (S-29, unchanged, decision pending)

The agent adds or rewrites no request header. The extension already rewrites
the `Referer` of one portal call — the GSTR-3A summary used to rebuild a
GSTR-3A notice PDF — because the portal's firewall rejects it otherwise
(background.js, since 2026-09-03). Running the same extension, the agent's
browser does the same. **Pending the partner's decision (audit S-29):** keep
it, or drop it and keep GSTR-3A notices without a rebuilt PDF (the notice row,
its period and the auto-close in §9 do not depend on it).

## 9. What one sync reads (0.6.0)

Notices & orders (with case tasks and case folders), refund applications,
DRC-03, **applications on the portal** (appeals APL-01, rectification,
objection to provisional attachment, s.128A waiver, compounding, provisional
assessment — the portal's own "My Applications" codes, from its public
`casesearchctrl.js`), and the **taxpayer profile** (registration status
Active / Cancelled / Suspended). A type that fails or comes back empty
removes nothing. **GSTR-3A:** the summary's return type and period are kept
on the notice (`gst_notices.portal_detail -> 'gstr3a'`, `ret_period` is
`MMYYYY` per the portal's own `gstr3actrl.js`), and the notice closes itself
(`auto:return_filed`) once Filing Status shows that return filed for that
period — see NOTICES_LITIGATION_POSITIONS.md §18.

Not built yet (S-22 remainder): Electronic Liability Register Part II, Rule
86A blocked credit, DRC-01B / DRC-01C Part-B reply status, bulk filing status.
Their endpoints are not guessed: each is to be confirmed from the portal's own
public scripts (as above) or from a recorded staff session before it is
built.

## 10. How the acceptance numbers are measured (`autopilot_metrics`)

One row per IST day; working days are Monday–Saturday. Eligible = clients
with portal credentials, not inactive, not excluded from the notices sync
(today's list).

- **Fresh or named** (target ≥ 95% for 10 consecutive working days): a client
  is fresh when a notices pull succeeded in the 24 h before the day's end; it
  has a **named reason** when it is not fresh but a login or notices attempt
  in those 24 h failed with a reason class.
- **Human time on fetching** (target ≤ 20 min a day): minutes somebody had the
  CAPTCHA wall open and visible (`autopilot_wall_minutes`), plus — shown
  separately — the typing time measured per CAPTCHA.
- **In the app within 24 h:** new portal notices (issued at most 10 days
  before capture) captured before the end of the day after their issue date.
  The portal gives a date, not a time, so this is the closest honest measure.
- **Within 4 h for 7-day forms:** short-clock forms (`notice_form_rules.reply_days ≤ 7`)
  announced by a portal e-mail, captured within 4 hours of that e-mail.
