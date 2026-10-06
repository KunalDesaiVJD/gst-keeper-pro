# Portal e-mails → a priority notices sync

When the GST portal issues a notice it e-mails the taxpayer's registered
contact. The agent reads the firm's notices inbox and, for every portal e-mail,
calls `portal_email_ingest`: the GSTIN is matched to a client and a
high-priority notices sync is queued, so a 7-day notice is in the app within
hours instead of at the next scheduled run.

- `parse.ts`: pure. It decides whether an e-mail is from the portal (sent from
  `gst.gov.in` or a subdomain, or a forward that carries the portal's `From:`
  header, in Gmail, Outlook or Apple Mail style, or as an attached `.eml`). It
  also extracts the GSTINs (check digit verified), the form code
  (`DRC-01B`, `GSTR-3A`, `REG-17`…) and the notice/order reference number
  (`ZD…`/`ZA…`; an application's ARN only when it is labelled as the reference).
- `inbox.ts`: the IMAP poller (`startInboxWatcher`).

## What it reads, what it keeps

- It reads one mailbox (`IMAP_MAILBOX`), only while the **e-mail trigger** is on
  in the app's Autopilot settings. It opens the mailbox read-only (`EXAMINE`) and
  fetches with `BODY.PEEK`. Nothing is ever deleted, moved, flagged or marked as
  read, so people can keep using the mailbox as normal.
- The first poll looks back two days. After that it reads only new messages. If
  the server renumbers the mailbox, it looks back two days again (re-sending an
  e-mail is harmless: the database keeps each message id once).
- The database stores, per portal e-mail: the message id, when it arrived, the
  sender address, the subject, a snippet of at most 400 characters and the
  extracted fields. The full body is stored nowhere. Digits in an OTP e-mail
  are masked. Other e-mails are read and then dropped.
- The agent keeps a small state file (mailbox id, last UID read, e-mails waiting
  to be retried), with no e-mail content. The log gets one line per poll, with
  counts only.
- If the database refuses an e-mail, it is retried on the next polls for 24
  hours. If the mailbox cannot be read (connection, login), the error shows on
  the Autopilot page and the wait between polls doubles, up to 30 minutes.

## Setting up the inbox

1. Use a **dedicated mailbox**, e.g. `notices@yourfirm.in`, that people read but
   do not tidy away (an e-mail moved out of `IMAP_MAILBOX` before the next poll
   is not seen).
2. Get portal e-mails into it. Either make it the registered e-mail on the GST
   portal, or ask each client to add a rule that forwards (or redirects) mail
   from `gst.gov.in` to it. In Gmail: *Settings → Filters → From:
   gst.gov.in → Forward to*. In Outlook: *Rules → From contains gst.gov.in →
   Forward / Redirect to*. Ordinary forwards, redirects and "forward as
   attachment" all work.
3. Give the agent a password it can use over IMAP:
   - **Google Workspace / Gmail**: turn on 2-Step Verification for the mailbox,
     create an **app password** (Google Account → Security → App passwords), and
     make sure IMAP is allowed (Gmail settings, and the Workspace admin console).
     Host `imap.gmail.com`.
   - **Microsoft 365**: Exchange Online no longer accepts passwords, including app
     passwords, over IMAP. It requires OAuth2, which this watcher does not do
     yet. Forward the Microsoft 365 mailbox to a mailbox that allows IMAP with
     a password, or have OAuth2 added first. Host `outlook.office365.com`.
   - **Other hosts** (Zoho, Rediffmail Pro, cPanel and similar): the mailbox
     password or the provider's app password, with the provider's IMAP host.

## Settings (`agent/.env`)

| Variable | Default | |
|---|---|---|
| `IMAP_HOST` | (none) | IMAP server. With `IMAP_HOST`, `IMAP_USER` or `IMAP_PASSWORD` missing, the inbox is not watched. |
| `IMAP_USER` | (none) | Login, usually the mailbox address. It is also how the inbox is named in the app. |
| `IMAP_PASSWORD` | (none) | App password (see above). Never logged or sent to the database. |
| `IMAP_PORT` | `993` | `143` when `IMAP_SECURE=false`. |
| `IMAP_SECURE` | `true` | `true`: TLS from the start. `false`: STARTTLS, which must succeed before the password is sent. |
| `IMAP_MAILBOX` | `INBOX` | Folder or Gmail label to read. |
| `IMAP_POLL_SECONDS` | `120` | Seconds between polls, at least 30. |
| `PORTAL_SENDERS` | `@(?:[a-z0-9-]+\.)*gst\.gov\.in$` | Regular expression (case-insensitive) for portal sender addresses. It is tested against the bare address. It **replaces** the default, so keep `gst\.gov\.in` in it. |
