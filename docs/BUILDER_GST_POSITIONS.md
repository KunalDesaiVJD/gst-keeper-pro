# Builder module — GST positions on record

The firm's elected positions for GST on real estate promoters, with the
authority for each and where the code implements it.

This exists because several of these are **elections and positions, not
settled law** — the kind of thing that has to be defensible eighteen months
later when nobody remembers the conversation. Where a position departs from the
strict reading, that is stated plainly rather than buried.

Confirmed by V. J. Desai & Co. LLP, July 2026.

---

## 1. Rate matrix

Notification 11/2017-CT(R) Entry 3, as substituted by Notification
03/2019-CT(R) w.e.f. 01.04.2019. SAC 9954.

**Presentation election.** The taxable value is reported **after** the 1/3rd
deemed land deduction (para 2 of Notif 11/2017), at the **notified** rate — not
the full consideration at the effective rate. The tax is identical either way;
only the taxable value shown in GSTR-1 Table 7 and 3B Table 3.1(a) differs.

| Unit | Notified rate (on 2/3rd) | Effective (on full consideration) |
|---|---|---|
| Affordable residential | 1.5% | 1% |
| Other residential | 7.5% | 5% |
| Commercial in an RREP | 7.5% | 5% |
| Commercial in a REP other than RREP | 18% | 12% |

No input tax credit under the first three. Proportionate credit under the
fourth — see §7.

*Implemented in `src/utils/builderRates.ts` (`NOTIFIED_RATE_PCT`,
`EFFECTIVE_RATE_PCT`, `computeTax`).*

**The 1/3rd, disclosed as Non-GST supply.** A further firm election, on top
of the deemed-1/3rd position above: the land deduction is now also reported
as Non-GST supply — GSTR-1 Table 8 (`nil.inv[].ngsup_amt`, `sply_ty:
INTRAB2C` — intra-state to unregistered, consistent with §5) and 3B Table
3.1(e). This is a disclosure practice, not a claim that land is a distinct
supply here: there is one indivisible construction service under a single
booking agreement, and the 1/3rd is a deemed valuation carve-out for that
one supply, not a separate land transaction. The reason to disclose it
anyway is turnover reconciliation — books record the full consideration as
one figure, GST returns only the 2/3rd, and GSTR-9C Table 5 would otherwise
show a gap with nothing on the return to explain it.

`computeTax()` already computes the 1/3rd as `landDeduction` on every
`TaxBreakup`; `builder_period_postings` carries it as its own
`land_deduction` column per posting (zero on the two Table 10 re-rating
legs, since a re-rating only swaps the rate on an already-established
taxable value and never re-derives the land split — see the view's own
`COMMENT`). `buildBuilderGstr1()` in `src/utils/builderGstr1.ts` sums it
across the period and emits the one Table 8 row.

## 2. Affordable residential apartment

Both limbs must hold, tested **per unit**:

- RERA carpet area ≤ **60 sq m** in metropolitan cities, ≤ **90 sq m**
  elsewhere. Gujarat cities are non-metro, so 90 sq m applies — but the limit
  is a per-project setting, not hardcoded.
- Gross amount charged ≤ **₹45,00,000**.

Only the value limb can move. Carpet area is physical; a charge head added
after booking is what pushes a unit over — see §8.

*`testAffordable()`, with the ₹45 lakh headroom shown live as charge heads are
entered. Metro/non-metro is elected per project (`builder_projects.is_metro`),
with a client-level default (`builder_client_settings.default_is_metro`) that
only pre-fills a **new** project's form — every one of this firm's clients
builds on Gujarat property, so that default is almost always non-metro.*

## 3. Gross amount charged

All charge heads are **included by default**: preferential location, development,
parking, club, utility deposit, legal, maintenance/corpus, other. Each is
switchable per client, and overridable per unit.

**One switch per head, not two.** The ₹45 lakh limit and the taxable value read
the same statutory base, so splitting them would only let the two drift apart.

Stamp duty, registration charges and GST itself are never part of the base.

*`builder_client_settings`; captured as a questionnaire and emailed to the
client for written confirmation.*

## 4. The 15% test

An **RREP** is a REP in which the carpet area of commercial apartments is **not
more than 15%** of the total carpet area of all apartments. Boundary inclusive.
Tested at **RERA-project** level, across all blocks.

*`testRrep()`; surfaced on the projects list so the classification is never
buried.*

## 5. Place of supply — intra-state only

Under **s.12(3)(a) IGST Act** the place of supply for a service in relation to
immovable property is the location of the property. With a Gujarat GSTIN and
Gujarat property, every supply is intra-state: **CGST + SGST, never IGST**.

Consequently **Table 5 (B2CL), CDNUR and 3B Table 3.2 cannot arise** and are
deliberately not built. Buyers are unregistered individuals, so there is no
Table 4A either. Intra-state B2C credit and debit notes net **inside Table 7**.

## 6. BU as the cut-off

The **BU permission is the completion certificate**. A unit's cut-off is the
**earlier of the BU date and its dastavej date** — *dastavej* meaning the
**registered sale deed**, not the banakhat. *(Confirmed explicitly; the banakhat
reading would fire each unit's full liability at booking instead.)*

**The firm's practice.** For every unit booked before its cut-off, the entire
balance consideration becomes taxable in the BU month, received or not.
Anchored in **s.31(5)(c) r/w s.13(2)(a)**: where payment is linked to the
completion of an event, the invoice falls due when that event completes.

The base deducted is value on which GST was **discharged up to the opening of
the BU month** — not money received. Receipts inside the BU month are therefore
**subsumed** into the differential rather than taxed separately.

**The differential invoice is always raised gross, opening balance included
(firm decision, 13/08/2026, per the firm's own Sales Guide).** A unit whose
earlier consideration sits only in its `builder_opening_balances` snapshot —
pre-onboarding history with no itemized receipts to attach an adjustment to —
used to have that snapshot netted straight into the invoice leg
(`invoiceValue = agreement − invoiced − opening`). Where the opening balance
fully covered the agreement, that formula produced an invoice of ₹0: no Table
7 entry, no Table 11B entry, nothing in the return at all — the Plot No. 148
case (Shree Maruti Infra) that exposed this. The return must show the
transaction on both legs regardless of whether any *new* tax is owed: the
full sale gross in **Table 7**, offset by an equal **Table 11B** advance
adjustment sourced from the opening balance
(`builder_opening_balance_adjustments`, distinct from `builder_advance_adjustments`
because there is no `builder_receipts` row for pre-onboarding money to key
off). `computeDifferential()` in `src/utils/builderBuEvent.ts` now computes
`invoiceValue = agreement − invoiced` (opening no longer subtracted here) and
pools the opening balance into `advanceToAdjust` alongside real advances,
real advances drawn down first. **Net new tax owed is unchanged** —
`differentialValue` is the same figure either way — only the gross-vs-net
*presentation* changed.

Units **unbooked at the cut-off** fall under **Schedule III para 5** — sale of a
building after completion is not a supply — and are omitted from GSTR-1 and 3B
entirely.

**Accepted consequence.** GST gives no bad-debt relief. Tax paid at BU on an
uncollected balance is recoverable only through a credit note under s.34, and
only until 30 November following that financial year. Each posted event carries
its deadline.

*`src/utils/builderBuEvent.ts`; the working is persisted per unit.*

## 7. Partial ITC

For a REP other than an RREP, residential construction is an exempt supply for
apportionment under **s.17(2)/(3) r/w Rules 42 and 43**. The key is **carpet
area**, applied flat: the residential share of input tax is reversed, the
commercial share survives.

**Monthly only — no annual true-up.** An elected simplification.

The split is derived from the project master and offered on the ITC Summary
page; adopting it is a deliberate action, because the areas drive a real
reversal.

**No-ITC clients (`builder_itc_type = 'NO_ITC'`).** *As of 19/08/2026*, No-ITC
uses the **plain** Table 4(B) template — the same one a Full-ITC builder gets
— not the carpet-area apportionment machinery below. Row 5.1 ("ITC for the
Month") is manual/editable, the same carve-out Liberal-mode clients already
had, so staff enter the ITC found each period directly. **4(B)(1) is then
locked to mirror the whole of Total 4A** — not derived from 2B
reconciliation's own eligible/reversal split, deliberately: "allowing" vs
"disallowing" per 2B reconciliation only means something for a client who can
claim *some* credit, and never applies to a No-ITC builder. 4(B)(2) "Others"
and its (i)/(ii)/(iii) sub-rows are locked to 0 for the same reason — nothing
should ever land there for a No-ITC client. This guarantees Net ITC (4C) = 0
by construction (4A − 4A), not by relying on 2B reconciliation happening to
classify every purchase correctly. Neither `buildGstr3bJson.ts` nor ITC
Summary itself runs `computePartialItcSplit` for a No-ITC client anymore —
`buildGstr3bJson.ts` bypasses reading `section4B` for them entirely and
computes 4(B)(1)/(2) straight from `itcAvail`.

*Between 14/08/2026 and 19/08/2026*, No-ITC was instead treated as the 100%
case of the Partial-ITC apportionment mechanism: 4A showed the true ITC 2B
reconciliation found (for audit trail), and 4(B)(1) auto-reversed all of it —
carpet-area ratio forced to 1 rather than read from `commercial_area`/
`residential_area`. That version's own reconciliation gap (4(B)(1)'s total
didn't foot from the i)/ii)/iii) sub-rows shown under it, and neither did
4(B)(2)'s) is what led to the revert — see PRs #76/#77 for the display fix
that was layered on before the decision to drop the apportionment entirely for
this client type. Before 14/08/2026, `NO_ITC` existed on the client record and
setup form but was never read downstream at all — 2B Reconciliation classified
a No-ITC client's invoices like any other client's, flowing straight into row
5.1 and Net ITC as a real, claimable-looking figure with nothing to suppress
it (fixed live on Elenza Callista Buildcon).

## 8. Retrospective re-rating

**The ₹45L test floors at money already recognised, not just the unit
master.** `base_consideration` + charges is the primary figure, but a unit
cannot legitimately have been charged or received MORE than its true agreed
price — so if opening balance + every receipt/invoice to date (net of
absorption) exceeds base + charges, that running total governs instead
(`knownConsideration` on `classifyUnit()`, fed from `computeUnitLedger()`'s
`considerationRecognized`). This catches a unit whose master was never kept
in sync with what's actually being collected — including one booked years
ago that only crosses via a receipt entered this month — without waiting for
anyone to notice and go update the base consideration by hand. The unit list
flags this case with a warning icon rather than silently absorbing it, since
the master figure is still wrong and should be corrected even though the
classification is already right in the meantime.

**The rate freezes on filing, not on crossing.** For any period whose GSTR-1
has not yet been filed, a unit's classification is always the live one —
`classifyUnit()` off today's base consideration and charges — and every
receipt/invoice already recorded for that unfiled period is kept in sync
with it automatically (`resyncUnfiledPostings()` in
`src/lib/builderAdjustmentsData.ts`), in either direction, with no amendment
of any kind. There is nothing to amend: nothing has been filed yet, so a
mistaken charge caught and corrected before filing simply never happened, as
far as the return is concerned.

Once a period's GSTR-1 **is filed**, that period is closed — the DB itself
blocks editing a receipt or invoice dated into it
(`builder_receipts_period_lock` / `builder_invoices_period_lock`,
`supabase/migrations/20260811140000_builder_filed_period_lock.sql`) — so from
that point on its figures can only be corrected by a formal amendment, never
a silent rewrite. **This is where "a unit taxed at 1.5% whose gross
consideration later crosses ₹45 lakh was never affordable" applies**: if a
unit's live classification has moved off AFFORDABLE while a *filed* period
still carries 1.5% postings, that crossing is real and permanent for that
period, and the higher rate is due on everything already filed.

**Discharged by DRC-03, not a GSTR-1 amendment (firm decision, 11/08/2026).**
Originally this correction went through Table 10 as a formal amendment (old
rate reversed, same taxable value re-reported at the correct one — every
buyer being unregistered rules out a debit note). That mechanism is now used
only as a manual, DB-only exception (`builder_reclassifications.discharge_mode
= 'GSTR1_AMENDMENT'`, never offered in the UI). The default for every
re-rating going forward is `discharge_mode = 'DRC03'`: the differential tax
and s.50 interest are computed exactly as before, but paid by voluntary
payment on the GST portal, and never reported in GSTR-1 or 3B. Two reasons
drove the change:

- **Duplicate effect.** A Table 10 amendment assumes the return as originally
  filed is still what the portal shows. Where the client's own team has
  separately hand-corrected the portal already — the E-1004 case this
  section used to describe — a later Table 10 amendment on top of that
  reproduces the correction a second time.
- **Pre-onboarding history is otherwise unreachable.** `findReclassCandidates()`
  only ever reads `builder_period_postings`, which excludes
  `builder_opening_balances` by construction (see
  `supabase/migrations/20260811150000_builder_reclass_drc03.sql`). A unit
  booked years before this firm's onboarding has its entire pre-onboarding
  history in a single lump snapshot, invisible to a return amendment no
  matter what. Staff can instead reconstruct it, date by date, in
  `builder_historical_receipts` — floored at 01.04.2019, the date
  Notification 03/2019-CT(R) starts and the earliest date `builderRates.ts`
  models any rate for; anything earlier is a pre-scheme regime this module
  was never built to compute and stays a manual firm judgment call. Those
  entered periods feed the same schedule/interest engine as app-tracked
  periods and land in the same DRC-03 workpaper for the unit
  (`findHistoricalReclassCandidates()`/`mergeCandidates()` in
  `src/lib/builderAdjustmentsData.ts`).

Posted automatically, no staff review — the correction is arithmetic once a
crossing is detected (`findReclassCandidates()`/`findHistoricalReclassCandidates()`
/`autoReclassifyProject()`). Once posted, a superadmin/GST-Manager can record
that the DRC-03 was actually filed (ARN + date, `BuilderAdjustmentsPage.tsx`)
— a record only; the app does not file DRC-03 itself.

The schedule is **period-wise**, because interest under **s.50** runs from
each original period's due date. A single aggregate at the trigger date
would understate it materially on an older unit.

**No downgrade on a filed period.** A later fall below ₹45 lakh does not
reopen or restate a correction already posted against a filed period — only
an unfiled period's postings track the live rate freely, up or down.

**A posted correction can still be voided if the crossing was itself a
mistake** — e.g. the triggering charge was entered in error and removed
before anyone noticed the period had, in the meantime, been filed at the
wrong rate. Superadmin only, reason recorded
(`builder_reclassifications.status = 'REVERSED'`); voiding removes it from
the DRC-03 workpaper but does **not** rewrite the already-filed period itself
(the DB trigger prevents that regardless) — correcting a figure that has
already gone to the portal needs handling case-by-case.

## 9. Bounce reversals — *position*

| Situation | Treatment |
|---|---|
| Bounce **before** the return is filed | Reverse outright; nothing reported |
| Bounce after filing, on an **un-invoiced advance** | Reverse, offsetting against later months at the **same rate in the same project**, carrying forward what will not fit |
| Bounce after filing, on an **invoiced** amount, booking intact | **No adjustment.** Liability stands |

The third line is the position. There is no ground under s.34 — the supply did
not change, the payment failed — and GST has no bad-debt relief. If the booking
is subsequently cancelled, that is a cancellation and takes the credit-note
route.

Offsets carry forward rather than being lost, because the portal rejects a
negative Table 11A.

**Cheque bounce charges recovered from the member are not taxable** — Circular
178/10/2022-GST treats them as a deterrent against breach, not consideration.

## 10. Delay interest — *position, and a known divergence*

Interest recovered from members for late instalments is billed at a **flat
18%**, treated as a supply **separate from construction**, so **no 1/3rd land
deduction** applies and the whole amount is the taxable value.

**This departs from s.15(2)(d)**, which would include such interest in the value
of the principal supply and so carry the unit's own rate. The divergence is
**conservative**: 18% sits at or above every unit rate, so it over-collects
rather than under-declares, and carries no exposure to the department. It does
raise the member's cost.

Implemented as a per-client setting (`FLAT_18` | `UNIT_RATE`) defaulting to the
flat rate, so it can be changed per client without code.

## 11. Credit notes

The **s.34** window runs to **30 November following the financial year of the
original document**, measured from that document's date, not from today's.

Past it the note is still recorded — the trail matters — but flagged out of
window and **excluded from both the postings feed and the ledger**, because the
tax cannot be adjusted. **Circular 188/20/2022-GST** leaves the unregistered
buyer's own refund under s.54 as the remaining route, and the app produces the
supporting statement.

**Cancellation charges.** Earnest-money forfeiture is treated as a
non-taxable penalty; explicit cancellation or administrative charges are taxed
at the unit's rate. Per Circular 178/10/2022-GST — a position, not settled law.

## 12. TDR / FSI reverse charge

Notifications 04, 05 and 06/2019-CT(R). Time of supply is the CC date, so the
working hangs off a **posted** BU event — that is where booked-versus-unbooked
was frozen.

| Leg | Basis | Cap |
|---|---|---|
| Residential | portion attributable to **unbooked** residential apartments, at 18% | **1%/5% of those units' value**, summed **per unit** |
| Commercial | portion attributable to commercial apartments, at 18% | **none** — no exemption, no cap, booked or not |

The cap is summed per unit because an affordable unit caps at 1% and any other
at 5%; a mixed inventory has no single blended rate that is correct.

Allocation across blocks is **by carpet area**, applied before the split into
legs, so a phased BU crystallises the liability piece by piece.

The credit is blocked under the 1%/5% scheme, so this is paid in cash through
**3B Table 3.1(d)** and never reaches GSTR-1.

**The consent gate.** A client instructing the firm not to discharge this
liability must have that instruction on record before the period files: request
out from gst@vjdesai.com, the client's written reply attached, and **GST
Manager approval** — three steps, strictly ordered, enforced by
`builder_fsi_consent_blocked()`. Filing Status refuses to mark the period Filed
until all three exist.

## 13. TDS under section 194-IA

**No GST effect.** GST is computed on the **full consideration**, never on the
99% banked. The buyer deducts 1% where consideration is ≥ ₹50 lakh, on the
aggregate consideration including PLC, parking and club charges.

Per **Circular 23/2017**, GST is excluded from the TDS base where shown
separately.

The app warns rather than enforces, and shows a bank-credit variance so an
unrecorded deduction surfaces before it becomes a 1% short payment.

GST TDS under **s.51** applies only to government and PSU recipients and is out
of scope.

---

## 14. Onboarding status — units closed before this software saw the project

A project is not always onboarded into this software at inception. Some
units in it may already be **fully resolved under the firm's earlier
records** by the time it is — BU received, the dastavej registered, tax
accounted for — with no reliable pre-onboarding trail of advances and
invoices for this software to reconstruct. Running the BU/dastavej engines
on such a unit would recompute tax against a history this software never
actually held, which is worse than not computing it at all.

**The flag.** `builder_units.onboarding_status`: `'LIVE'` (default) or
`'CLOSED_PRE_ONBOARDING'`.

**What it excludes.** A unit marked `CLOSED_PRE_ONBOARDING` is:
- Omitted from BU-event sweep candidates (`BuilderBuEventsPage`'s
  `availableUnits`) — a project-wide or block-wide sweep will never select
  it, whatever the sweep's own cut-off date.
- Skipped by the dastavej auto-post differential
  (`autoPostDastavejDifferential`) — its deed date and value can still be
  **recorded** on the Dastavej Reconciliation page for the register, but no
  automatic BU-differential posting follows from saving it.

**What it does *not* exclude — and why.** The unit still counts toward the
project's carpet area for the **15% RREP test** (§4). That test classifies
the *project*, by its physical mix of residential and commercial area; it
has nothing to do with which units this software tracks tax for. Excluding
a closed unit's area would misstate the project's classification for every
other unit still live in the software.

**What the firm still owes it.** Nothing, by design — a
`CLOSED_PRE_ONBOARDING` unit is asserted to be already fully and correctly
taxed outside this software. If that assertion turns out to be wrong for a
given unit, the fix is to flip it back to `LIVE` and, if needed, capture an
opening balance (§the opening-balance grid on the project's unit master) so
the ordinary engines can pick up from the true position — not to leave it
flagged while trying to tax it here.

*Set on the unit's row in the unit master; read in
`src/pages/BuilderBuEventsPage.tsx` and `src/lib/builderBuPosting.ts`.*

## Out of scope by election

| | Reason |
|---|---|
| 80% procurement test, cement and capital-goods URD reverse charge | Excluded at the firm's instruction |
| Ongoing projects on the 8%/12% option, Annexure I/II | No client is on the old regime |
| Landowner/developer JV and area sharing | Deferred; schema left open |
| Plotted development | Deferred; a developed plot is sale of land per Circular 177/09/2022 |
| Society redevelopment | Deferred |
| Multiple GSTINs per builder | Deferred |
| Actual land value per *Munjaal Manishbhai Bhatt v. UOI* | Deemed 1/3rd only |
| Excel bulk import | Manual entry for now |

## Where to find things

| | |
|---|---|
| Rates, the 15% test, affordability, Rule 35, 194-IA | `src/utils/builderRates.ts` |
| Ledger, receipt derivation, advance absorption, period roll-up | `src/utils/builderLedger.ts` |
| Land deduction as Non-GST supply (GSTR-1 Table 8, 3B Table 3.1(e)) | `src/utils/builderGstr1.ts` (`buildBuilderGstr1`) |
| Cut-off, differential, s.50 interest, credit-note deadline | `src/utils/builderBuEvent.ts` |
| Re-rating, conversions, bounce offsets, restatement, delay interest | `src/utils/builderAdjustments.ts` |
| TDR/FSI legs, the cap, the consent gate, carpet split | `src/utils/builderFsi.ts` |
| Schema | `supabase/migrations/*_builder_phase*.sql` |
