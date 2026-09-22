# GST Keeper — Portal Sync: Changelog

Notable changes to the browser extension (`extension/`). Newest first.

## 2026-09-22 — Fix: GSTR-3B PDF pull failed behind an auto-popup

**Problem:** Pulling a filed GSTR-3B's ARN + PDF via Filing Status's Portal
button failed with "could not capture the PDF," even though downloading the
same PDF by hand on the portal worked fine.

**Root cause:** The GST portal auto-shows a "System generated summary"
popup (`#statustable`) every time the GSTR-3B return page loads. It sits on
top of the real download button. The extension's download search was also a
loose text match ("download" + "pdf"), which risked grabbing the wrong
control — the page has a second, red "SYSTEM GENERATED GSTR-3B" button that
downloads a different file entirely.

**Fix:** `handleReturnView` in `content.js` now, for GSTR-3B specifically:
1. Checks if the summary popup is open and closes it, waiting until it's
   actually gone (not just clicked).
2. Targets the exact download button by its `data-ng-click="downloadPrePdf()"`
   attribute instead of guessing by text.
3. Falls back to the old generic search only if that exact button isn't
   found (e.g. an unfiled period has no such button).

Confirmed live against a real filed GSTR-3B return.

## 2026-09-20 — Fix: CAPTCHA login submitted on the first keystroke

**Problem:** When logging in manually (Clients → Credentials → Login, or Filing
Status's login icon), the extension clicked the portal's Login button the
instant the CAPTCHA box had *any* text in it — i.e. after your very first
keystroke, with the CAPTCHA still only partially typed. This guaranteed a
wrong-CAPTCHA failure on every manual login.

**Fix:** `handleLogin` in `content.js` no longer submits on "any text present."
It now watches how the CAPTCHA field's value changes:
- If the value **jumps by more than one character in a single change**
  (an automated fill — e.g. a future OCR-based auto-solve setting the whole
  result at once), it auto-clicks Login immediately, same as before.
- If the value **grows one character at a time** (a real person typing), it
  never auto-clicks — it shows a banner asking you to press Enter / click
  Login yourself once you're done, exactly like using the portal directly.

The CAPTCHA field has no `maxlength` to read (confirmed live — it's only
constrained by a numeric `ng-pattern`), so length couldn't be used to detect
"done typing." The portal also blocks a real clipboard paste on this field
(`data-ng-paste` preventDefault), so a multi-character jump can only mean a
script wrote it — never a person pasting — making the two cases reliably
distinguishable.

Everything after a successful auto-submit (bad-password / bad-CAPTCHA
detection, the 3-attempt retry loop) is unchanged.
