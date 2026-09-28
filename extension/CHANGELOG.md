# GST Keeper — Portal Sync: Changelog

Notable changes to the browser extension (`extension/`). Newest first.

## 2026-09-28 — New: GSTR-9 system-computed pull for the Annual Return (v0.3.3)

**What:** a new section-pull mode, `gstr9_pull`, started from Annual Return →
Portal data → "Pull from portal" (the app sends `__gstkPullSection` with
`mode: 'gstr9_pull'` and `period_month: '03/YYYY'`, the FY's closing March).
After login it opens the returns dashboard and `handleGstr9Pull` in
`content.js`:
1. `GET returns2/auth/api/gstr9/details/calc?ret_period=03YYYY&gstin=…` — the
   GSTR-9 system-computed figures (Tables 4, 5, 6, 8, 9);
2. `GET returns/auth/api/formdetails?rtn_prd=03YYYY&rtn_typ=GSTR9` — ARN,
   filed date and status (non-fatal if it fails);
3. saves the raw JSON unchanged to `gst_filed_returns`
   (`return_type 'GSTR9_CALC'`, `period_month '03/YYYY'`) with `updated_at`,
   which the app polls for, parses and shows in a preview before applying.

GET only — it never calls any save / submit / compute / file endpoint.

**Not yet confirmed live.** The endpoint and its parameters were taken from
the portal's own GSTR-9 page script (`gstr9ctrl.js`, `getSumData()` →
`ajax.get("/returns2/auth/api/gstr9/details/calc", { ret_period, gstin })`),
not from a real pull. It still needs a live check. If the first call does not
return `{ status: 1, data }` (HTML / 403 on a cold session), the handler opens
`returns2/auth/annualreturn` once (flag `job.gstr9Warmed`) and retries on that
page; a second failure is written as `status: 'PULL FAILED: …'` (with
`updated_at`, so the app stops waiting) and the app offers Upload / typing
instead. The session-bounce give-up path records the same failure.

**Version bump:** 0.3.2 → 0.3.3. The app blocks the GSTR-9 pull on older
versions, because an extension that doesn't know the mode would fall through
to the default ledger pull after login.

The existing `gstr3b_pull` mode is unchanged; the Annual Return page now also
starts it for all 12 months of a financial year (`period_months`).

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
