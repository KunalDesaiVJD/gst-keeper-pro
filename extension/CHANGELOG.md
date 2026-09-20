# GST Keeper — Portal Sync: Changelog

Notable changes to the browser extension (`extension/`). Newest first.

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
