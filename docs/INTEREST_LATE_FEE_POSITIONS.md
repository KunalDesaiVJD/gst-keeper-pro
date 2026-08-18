# Interest, Late Fee & Rule 42 ITC-Reversal — elected positions

Same governance as `docs/BUILDER_GST_POSITIONS.md`: the positions below were
**confirmed directly with the firm** (2026-08-18, via the phase-4 scoping
questions) except where marked otherwise. Change the constants in
`src/utils/interestLateFee.ts` if any of these stop matching how the firm
actually wants it computed — each is a small, isolated change.

---

## 1. Interest under s.50(1) / Rule 88B(1) — net-of-ITC basis

**Confirmed with the firm:** interest is computed only on the portion of tax
actually discharged from the **electronic cash ledger** (i.e. liability net
of ITC set-off), not on gross liability before set-off. This matches Rule
88B(1) and the portal's own post-2021 behavior for the ordinary case (a
return filed late, no s.73/74 proceeding in progress).

**Not implemented:** interest on gross liability (the stricter position an
officer might still assess in a s.73/74 proceeding), and Rule 88B(2)
(interest on ITC wrongly availed *and utilized*, a 24% p.a. rate) — these
are a different calculation from "my return was filed late," out of scope
for this batch.

The cash-portion figure is computed by reusing `computeItcOffset()`
(`gstr3bReports.ts`) — the same Rule 88A cross-utilization result already
shown on the GSTR 3B Offset Summary report — so "interest basis" and
"offset summary" can never silently disagree with each other.

## 2. Day-count convention

**Elected, not yet confirmed with the firm:** interest accrues from the day
**after** the due date through and including the day of filing, at 18% p.a.,
using a flat **365-day year** (no leap-year adjustment). This is the
simplification most GST software (and the portal's own interest ready-
reckoner) uses in practice — a materially different position (actual/actual
or 366 in a leap year) would move the figure by a small amount. Flag it if
the firm wants exact calendar day-count instead; it's a one-line change to
`DAYS_IN_YEAR` in `interestLateFee.ts`.

A return filed **on or before** the due date has zero days late and zero
interest — the calculator doesn't floor negative days at zero silently
without saying so; it just never has a negative "days late" to floor,
since due-date arithmetic and filed-date arithmetic both use whole calendar
days.

An **unfiled** return's interest is computed as-of *today* (still accruing)
rather than left blank — flagged in the report's subtitle so it isn't
mistaken for a final figure.

## 3. Rounding

Every computed rupee figure (interest, late fee, ITC reversal) rounds to
**2 decimal places**, matching `r2()` in `buildGstr3bJson.ts` — this app's
one consistent money-rounding convention throughout. Not rounded to the
nearest whole rupee.

## 4. Late fee under s.47 — turnover-tiered slabs

**Elected, needs a firm review before relying on it for a live filing
season:** the slabs below are current as of this app's last GSTN
notification research (Notification 19/2021-CT and 20/2021-CT lineage) —
**late-fee caps have been revised by notification multiple times and can
change again.** Verify the numbers in `LATE_FEE_SLABS` in
`interestLateFee.ts` against the current notification before trusting this
for an upcoming filing season; this is exactly the kind of figure that goes
stale silently if nobody checks it.

| Return | Case | Per-day fee | Cap |
|---|---|---|---|
| GSTR-3B / GSTR-1 | NIL return | ₹20/day (₹10 CGST + ₹10 SGST) | ₹500 |
| GSTR-3B / GSTR-1 | Turnover ≤ ₹1.5cr | ₹50/day (₹25 + ₹25) | ₹2,000 |
| GSTR-3B / GSTR-1 | Turnover ₹1.5cr–₹5cr | ₹50/day | ₹5,000 |
| GSTR-3B / GSTR-1 | Turnover > ₹5cr | ₹50/day | ₹10,000 |

"NIL return" here means a period with zero GSTR-3B computed liability
(outward + RCM) — the app doesn't know whether the client would have
answered the portal's own "NIL return" question the same way (e.g. a return
with only exempt supplies but a non-zero RCM liability is not NIL despite
having no output tax), so this is an approximation of the portal's NIL test,
not an exact replica of it.

**Turnover tier requires `client_annual_turnover.aggregate_turnover`
entered for the relevant financial year.** If it's missing, the report
falls back to the middle tier (₹5,000 cap) and says so explicitly rather
than silently guessing high or low.

## 5. Rule 42 ITC reversal — Rule 43 explicitly out of scope

**Confirmed with the firm:** build Rule 42 (inputs / input services used
partly for exempt supplies) only. Rule 43 (capital goods, reversed over a
60-month useful life) needs a capital-goods ITC ledger this app doesn't
track anywhere and isn't part of this batch.

Rule 42 reversal (D1) is computed as:

```
Common Credit = ITC Available (Table 4A total, this period)
              − itc_directly_attributable_exempt   (optional "T1" input)

D1 = Common Credit × (exempt_turnover ÷ aggregate_turnover)
```

**Known simplifications, not implemented:**
- The real Rule 42 formula also nets out T2 (ITC for non-business purposes)
  and T3 (blocked credit under s.17(5)) before computing common credit —
  this app has no field for either, so Common Credit here is "Total ITC
  minus the one exclusion the firm can enter," not the full T1–T4
  breakdown. This **overstates** the reversal whenever meaningful T2/T3
  exists for a client.
- Real Rule 42 is a **monthly provisional** reversal (using the *previous*
  financial year's turnover ratio, or an estimate) trued up **annually**
  in September following. This report applies whatever ratio is entered
  for the turnover fields as a flat estimate — it does not distinguish
  "provisional this month" from "final annual true-up." Treat the output
  as a working paper input, not a final Rule 42 annual computation.
- Exempt turnover, per the Explanation to Rule 42, includes nil-rated,
  wholly-exempt and non-taxable outward supply but **excludes** zero-rated
  exports/SEZ supplies. Whoever enters `exempt_turnover` needs to exclude
  exports themselves — the app doesn't enforce or derive this split.

Given these simplifications, both Rule 42 reports (the single-client
detailed working and the all-clients scrutiny list) are marked
**approximate**, same status tier as the app's other "this app's own
computed draft, verify before relying on it" reports.
