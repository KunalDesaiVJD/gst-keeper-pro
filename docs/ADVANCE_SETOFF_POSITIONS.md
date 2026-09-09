# Advance receipt & set-off — elected positions

Advances received (GSTR-1 Table 11A), their adjustment against later invoices
(Table 11B), and amendments to both (Table 11(2)) — for **non-builder** clients.

Read this before changing anything under the Advances module, `advanceSetoffCheck`,
or the Table 11 handling in `buildGstr1Summary.ts` / `buildGstr3bJson.ts` /
`gstr1ManualBuild.ts`. Several behaviours below are the firm's elected
*positions*, not obvious defaults — changing one without reading why it is that
way produces wrong tax, not just a different-looking screen.

Companion docs: `BUILDER_GST_POSITIONS.md` (the builder module, out of scope
here), `2B_RECONCILIATION_FLOW.md` (the inward-side equivalent of this flow).

---

## 0. Why this module exists

A client received an advance, paid tax on it in Table 11A, and in a later month
raised the invoice covering that advance. The invoice was reported at full value
in Table 4/7, but **no Table 11B adjustment was made**. Tax was therefore paid
twice on the same consideration: once on receipt, once on the invoice. The
second payment came out of the cash ledger, and the only remedy left was a
refund claim for excess payment.

Nothing in the app noticed. The build was green, the JSON was schema-valid, the
portal accepted it, and the return filed cleanly. The failure was entirely one
of *omission* — and omission is invisible to every check the app had.

The module's whole purpose is to make that specific omission impossible to reach
silently.

---

## 1. Scope — builders are excluded, deliberately

**Position.** Every check, ledger and report in this module short-circuits when
`clients.regular_sub_type = 'Builder'`.

Promoter clients already have a complete, settled advance mechanism in the
builder module: `builder_receipts` carries the Table 11A leg, and
`builder_advance_adjustments` carries the Table 11B leg, one row per
(receipt × invoice × rate). Their GSTR-1 Table 11 is *generated* by
`builderBuPosting.ts` from those tables, so it is balanced by construction.

Running a generic checker across a builder's return would therefore produce
nothing but false blocks on figures the app itself computed. Worse, it would
create a second opinion about a number the builder engine already owns.

The one place builders appear is the firm-wide open-advance control sheet, as
**read-only rows tagged "Managed by Builder module"**, so a manager still sees
one complete picture without this engine ever writing to a builder's data.

Do not "unify" the two modules. The builder flow is settled; this one is not.

---

## 2. What the JSON can and cannot tell us

GSTR-1 Table 11A and 11B carry **place of supply, supply type and rate — and
nothing else**. There is no counterparty GSTIN and no invoice number:

```jsonc
"at":   [{ "pos": "24", "sply_ty": "INTRA", "itms": [{ "rt": 18, "ad_amt": 1000000, ... }] }]
"txpd": [{ "pos": "24", "sply_ty": "INTRA", "itms": [{ "rt": 18, "ad_amt":  400000, ... }] }]
```

**Position.** This splits the module into two layers that must not be conflated:

| Layer | Derived from | Gives us | Data entry |
|---|---|---|---|
| **Balance** | `gstr1_data.raw_json` already imported | The open advance *balance* per (client, POS, rate, supply type), month by month | None |
| **Register** | `advance_receipts` / `advance_adjustments` | The *linkage*: which party, which project, which invoice absorbed which receipt | Yes |

The balance layer is enough to power every warning. The register layer is what
produces an invoice-wise working paper. Ship the balance layer first: it covers
every existing non-builder client retroactively from the first imported month,
with nothing to key in.

### Register semantics

**Position — one definition of "open".** `registerClosingByKey` is derived from
`receiptPositions`, not computed separately. Two independent definitions is not
a tidiness problem, it is a correctness one: a refunded receipt read as closed
on the Register tab and still-open in the reconciliation, so rule 8 fired on a
definitional difference rather than a missing entry. A check that reports
differences it created itself trains people to ignore it.

**Position — an amended leg replaces the leg it supersedes**, the same rule as
§7 applied to the register. A leg pointed at by another leg's
`amends_adjustment_id` drops out of every calculation rather than netting
against it.

**Position — only `INVOICE` legs are reported in Table 11B.** A refund,
cancellation or write-back closes the receipt in the register but is not
emitted as an adjustment of advance. Where the firm's position turns out to be
that a refunded advance also needs an 11B, the return will be short by that
amount and rule 8 surfaces it — which is a real finding, not an artefact. See
§10.

**Position — FIFO is the default allocation, not the rule.** Oldest advance
absorbed first needs no judgement and ages the ledger correctly. It is a
*suggestion* the set-off workspace pre-fills; only staff know which advance a
given invoice actually relates to, so every line stays editable.

---

## 3. The balance formula

**Position — an amendment REPLACES the figure it corrects; it is not added to
it.** A GSTR-1 amendment row states the *revised* value in full, the same way
Table 9A restates a whole corrected invoice. So an amendment does not
contribute its own amount to the balance — it substitutes for the original
month's amount at the same key.

**Position — an amendment belongs to the month it corrects, not the month it is
filed in.** `ata` and `txpda` carry `omon` (the original period, `MMYYYY`). The
ledger applies them against `omon`, never against the filing period. Applying
them to the filing month would show an advance as still open in every month
between the original receipt and the correction, which is factually wrong and
would fire false blocks on all of them.

Together, for a client at reporting month `M`, per key `(pos, rate_pct,
sply_ty)`:

```
effective11A(m) = latest ata where omon = m   ??  at(m)
effective11B(m) = latest txpda where omon = m ??  txpd(m)

open_advance(M) = opening_balance
                + Σ over m ≤ M [ effective11A(m) − effective11B(m) ]
```

"Latest" is by filing period: where the same key has been amended more than
once, the most recently filed correction is the one that stands.

A useful by-product falls out of writing it this way: `effective − original` is
the **differential**, which is exactly the figure that has to be entered in
GSTR-3B Adjustments (§7.2). The engine computes it rather than leaving staff to
work it out.

**Position — the as-amended view applies every amendment known today**,
regardless of which period it was filed in. It states the true current
position, which is what the warning engine must reason about. The as-filed view
is the historical record and is what reconciles to the portal.

**Position — two views, both retained.**

- **As-filed** — what was actually reported in each month's return, amendments
  sitting in the month they were filed. This is what reconciles to the portal.
- **As-amended** — the restated position, amendments substituted back at `omon`.
  This is the true open advance and the one the warning engine uses.

A reconciliation between the two is a report in its own right (R4), because it
is precisely what an officer asks for in scrutiny.

### Opening balances

`advance_opening_balances` exists only for clients whose advance history
predates the app's first imported return. Without it the engine would treat a
pre-app advance as never having existed and would never prompt for its set-off.
It is a manual, one-time, per-client entry and must be signed off by a manager —
an opening balance that is wrong is a permanently wrong ledger.

---

## 4. Advances on goods are not taxable

**Position.** `advance_receipts.supply_nature` distinguishes `SERVICE` from
`GOODS`, and only `SERVICE` advances create a Table 11A liability.

Notification 66/2017-CT removed the tax-on-receipt requirement for advances
against a supply of **goods** for all registered persons. Tax on a goods advance
falls due at the invoice, not the receipt.

This cuts both ways and both errors matter:

- A register that silently taxes a goods advance creates a liability that does
  not exist — the mirror image of the failure this module was built to prevent.
- A goods advance still belongs in the register as a memo, so staff can see it
  and so a later invoice is not mistakenly 11B-adjusted against it.

Works contracts, construction and government contracts are supplies of service,
so contractor advances are taxable on receipt.

---

## 5. Warning severities and where they fire

One shared checker, `src/lib/advanceSetoffCheck.ts`, returning
`{ severity, findings[], fingerprint }`. It is called from **three** gates:

1. `handleUpload()` — GSTR-1 "Upload to GST Portal" (`GSTR1DataPage.tsx`)
2. "Push to GST Portal" — GSTR-3B (`Gstr3bPage.tsx`)
3. Filing Status → `Filed`

**Position — one function, three call sites, no duplicated rules.** Three
independently written checks drift, and a drifted check is worse than none: it
teaches staff that the gate is unreliable, and an unreliable gate gets
overridden by reflex.

| # | Condition | Severity | Action offered |
|---|---|---|---|
| 1 | Open balance > 0, draft `txpd` empty, invoices present at the same POS + rate totalling ≥ the open balance | **HARD** | Generate 11B rows, or override |
| 2 | `txpd` present but short of the matched suggestion by more than the materiality threshold **and** more than 10% | **HARD** | Adjust to suggested, or override |
| 3 | `txpd` > open balance (over-adjustment — a short payment, not an overpayment) | **HARD** | Fix |
| 4 | `ata` / `txpda` present whose `omon` period is already `Filed`, with no matching GSTR-3B Adjustment row | **HARD** | Review restatement |
| 5 | Open balance > 0, no matching invoice this month | Soft | Acknowledge |
| 6 | Advance open longer than 6 months | Soft (dashboard, digest) | Review |
| 7 | Draft has `at` but no corresponding receipt in the register (register clients only) | Soft | Add receipt |
| 8 | Register closing ≠ JSON-derived closing | Soft | Reconcile |

**Position — the materiality threshold is configurable and defaults to ₹1,000.**
A gate that fires on three rupees of rounding becomes a reflex click within a
week, and a reflex click is indistinguishable from no gate at all. The threshold
protects the *credibility* of the hard block, which is the only thing that makes
it work.

**Position — rule 1 requires a matching invoice, not merely a positive balance.**
Blocking on balance alone would stop every return for a client holding a
long-running advance, in months where nothing was billed against it. That is
rule 5's job, as a soft notice.

**Position — the fix must be reachable from inside the blocking dialog.** The
dialog lists the matched receipts with a suggested set-off and a single
"Generate 11B & re-validate" button. If the correct action requires navigating
to another page, staff will override instead — the block would then be
generating overrides rather than corrections.

---

## 6. Override governance

**Position — the hard block is always overridable, and never quietly.**

Genuine cases exist: an invoice raised to a party who also happens to hold an
unrelated open advance, an advance being refunded rather than adjusted, a
deliberate deferral. A block that cannot be passed would be routed around by
filing outside the app, which is strictly worse than a recorded override.

So the override is not prevented. It is made *expensive, attributable and
permanent.*

### Who

New permission key `override_advance_setoff`, and **two** helpers on the auth
context rather than one — raising a request and deciding it are different
powers, and collapsing them into a single `canOverride` would quietly hand an
employee the manager's half.

| | `canRequestAdvanceOverride()` | `canApproveAdvanceOverride()` |
|---|---|---|
| `superadmin` | Always | Always |
| `gst_manager` | Always | Always |
| `employee` | Only if granted `override_advance_setoff` | **Never** — not row-grantable |

**Position — the GST Manager owns this control.** They grant and revoke the key
in User Control, and they are the approver in the two-step flow below. This
mirrors `canManualOverride` (`AuthContext.tsx`), which restricts overriding
portal figures to manager and above, with the employee knob restored here
because a request-and-approve flow makes a junior grant safe.

**Position — approval is never row-grantable.** An employee who could approve
their own request would turn the two-step flow back into a one-step dismissal,
which is precisely what the hard block exists to prevent.

### How

1. An employee hitting a hard block gets **"Request override"** with a mandatory
   reason (minimum 20 characters). Status becomes `PENDING`. **Filing stays
   blocked.**
2. The GST Manager sees the request badged on the Dashboard and on Filing
   Status, reviews the finding against the draft figures, and **approves** or
   **rejects** with a note.
3. A manager hitting the block themselves gets a one-step self-override,
   recorded identically with `requested_by = decided_by`.

### What is recorded

`advance_setoff_overrides` — a dedicated table, not just an `audit_log` row,
because it carries approval state and has to be printable:

```
id, client_id, period_month, return_type,
severity, findings jsonb, findings_fingerprint,
requested_by, requested_at, request_reason,
status,                      -- PENDING | APPROVED | REJECTED | LAPSED
decided_by, decided_at, decision_note,
filed_after_override, arn
```

A mirror row is also written to `audit_log` (`module='advances'`) so the
firm-wide trail stays single-source.

### Three rules that stop it becoming a rubber stamp

1. **Scoped.** One client, one period, one return type. An override never
   carries forward to the next month.
2. **Lapses on change.** `findings_fingerprint` hashes the findings the approver
   actually saw. Edit the draft afterwards and the fingerprint changes, the
   override moves to `LAPSED`, and the block returns. Approving once must not
   authorise filing anything.
3. **Permanently visible.** Every override appears in the Version History
   dialog, on the Filing Status row, in the R6 certificate PDF, and in a
   firm-wide overrides report. An override is a decision the firm can defend in
   assessment — not a popup someone dismissed.

---

## 7. Table 11(2) amendments — the hardest position

`ata` (amendment to 11A) and `txpda` (amendment to 11B) are the JSON keys for
Table 11(2), *"Amendment of information furnished in Table No. 11(1) for earlier
tax periods"*. Each row carries `omon`, the original `MMYYYY` being corrected.

**Position — an amendment row states the REVISED figure, not the differential.**
This is how GSTR-1 amendment tables work throughout (9A, 9C, 10, 11(2)): the
taxpayer restates the corrected value in full, and the differential against what
was originally reported is left implicit.

Three consequences follow, and all three are load-bearing:

### 7.1 Amendments are excluded from the GSTR-1 liability grand total

`buildGstr1Summary`'s `totals` covers this period's liability. A restated
earlier-period figure is not this period's liability, so `ata` is **not** added
to `forTotal`. It is reported on its own rows and in its own `amendmentTotals`.

> **Known inconsistency, deliberately left alone.** Table 10 (`b2csa`), also an
> amendment table, *is* currently inside `forTotal`. That predates this module.
> Changing it would silently move the totals on returns already produced and
> checked against the portal, so it is out of scope here and recorded as an open
> question in §10 rather than fixed in passing.

### 7.2 Amendments are NOT auto-netted into GSTR-3B 3.1(a)

**Position.** `buildGstr3bJson` does not fold `ata`/`txpda` into 3.1(a). It
raises a flag naming the amount, the `omon` being restated, and the module to
use instead.

The differential that belongs in this period's 3B depends on what was actually
reported in the *earlier* period's 3B — which the amendment JSON does not carry
and the app cannot infer. Auto-netting a restated figure would silently
overstate or understate 3.1(a), which is the exact class of invisible tax error
this module exists to eliminate. Trading a silent omission for a silent
miscalculation would be no improvement at all.

The correct path already exists: a **GSTR-3B Adjustments** row against `3.1(a)`
with source `Prior Period`, entered by a manager who has looked at both periods.
The flag points there by name.

### 7.3 An amendment against a filed period is a hard finding

Rule 4 in §5. An `ata`/`txpda` restating a period already marked `Filed`, with
no corresponding GSTR-3B Adjustment row, means the GSTR-1 side of a correction
has been made and the 3B side has not. That is a live under- or over-payment,
and it blocks.

---

## 8. Reports — Big4-style working papers

**Position — every month-wise view has a PDF, and the PDF is the artefact of
record.** A screen that cannot be printed, filed and produced two years later in
assessment does not close the loop the module was built to close.

The theme is the existing working-paper theme in
`src/utils/builderReportTheme.ts` — typographic rather than decorative, status
carried by a **word** never by colour alone (a working paper gets photocopied),
figures right-aligned in columns. It is promoted to a shared
`src/utils/reportTheme.ts`, with `builderReportTheme.ts` re-exporting from it so
existing builder output is byte-identical.

| # | Report | Content |
|---|---|---|
| R1 | Advance Ledger — Month-wise Statement | Opening / 11A / 11B / 11A-amend / 11B-amend / Closing, per month, with drill-down schedule |
| R2 | Advance Ageing Statement | As-on-date, POS + rate wise, buckets 0-3 / 3-6 / 6-12 / >12 months |
| R3 | Advance Set-off Register | Receipt → invoice legs, invoice-wise, with tax heads |
| R4 | As-Filed vs As-Amended Reconciliation | The `ata`/`txpda` restatement bridge |
| R5 | Firm-wide Open Advance Control Sheet | All clients on one page, oldest-advance age, this month's 11B |
| R6 | Pre-Filing Exception & Override Certificate | Per client-period: findings, action taken, requester, approver, reason, timestamp, ARN |
| R7 | Project-wise Advance & Recovery Working Paper | Contract value / Billed / Advance / Recovered / Balance / Retention / Open GST |

All seven register in the Reports Hub under a new `advances` category
(`reportRegistry.ts`, `reportsCatalog.ts`) so they archive the same way every
other report does.

R6 is the one that protects the firm: it turns "someone clicked override" into a
signed working paper naming who decided what, and why.

---

## 9. Government contractors — project-wise

**Position.** `clients.regular_sub_type = 'Contractor'` unlocks a projects
layer, structurally parallel to Builder but sharing none of its code.

`contract_projects`: work order number and date, department, contract value,
`pos_state`, mobilisation advance %, recovery rule, retention %, bank guarantee
number / amount / expiry.

**Position — contractor advance recovery is a schedule, not a one-shot set-off.**
A mobilisation advance is received once against a bank guarantee and recovered
proportionately from *every* RA bill (commonly 10% of each) until exhausted. So
one receipt carries **many** adjustment legs, one per RA bill. The expected
recovery (`recovery_pct × RA bill value`) is computed and shown as a **variance**
against what was actually reported in Table 11B — an under-recovery is a real
finding, not a rounding difference.

**Position — place of supply is inherited from the project, not the client.**
Works contract on immovable property takes POS from the location of the property
(s.12(3)). Carrying `pos_state` on the project and inheriting it onto receipts
and invoices removes the IGST/CGST misclassification at source, which is a
second, independent error class this layer eliminates for free.

Bank guarantee expiry feeds the existing reminders module (`gstReminders.ts`).

---

## 10. Open questions — not yet decided

Recorded so they are not silently decided by whoever writes the code next.

1. ~~Can an employee request an override at all?~~ **Decided (Sept 2026):** yes
   — an employee requests with a reason, a GST Manager approves. §6 is the
   binding description.
2. **Which column leads in R1** — as-amended primary with as-filed as memo, or
   the reverse. Affects how the working paper reads in assessment.
3. **Table 10 (`b2csa`) in `forTotal`** — see §7.1. Whether the existing
   inclusion is correct, and if not, from which period to change it, given
   returns already filed on the current basis.
4. **QRMP clients.** The checker is written per month. For a quarterly filer the
   GSTR-1/IFF period and the 3B period differ, and the gate needs to reason
   about the quarter. Not yet designed.
5. **How is a refunded advance reported?** The register closes the receipt on a
   `REFUND_TO_PARTY` leg but emits no Table 11B entry for it. If the firm's
   position is that a refund voucher does belong in 11B, `buildTxpdFromLegs`
   needs to include that reason and the migration comment needs amending.
   Until then rule 8 will flag the difference rather than hide it.
6. **The materiality threshold is a code constant, not a setting yet.**
   `ADVANCE_MATERIALITY_DEFAULT` in `advanceSetoffCheck.ts`. Exposing it in
   Settings needs a firm-wide settings store, which this app does not have —
   deliberately not invented for one number.
7. **`ata` / `txpda` key names and row shape are taken from the GSTN offline
   utility schema and have not yet been seen in a real import** by this app.
   Verify against the first genuine amended return before relying on the parser
   in anger, and widen the parser if the live shape differs.

---

*Positions recorded September 2026. Amend this document in the same commit as
any change to the behaviour it describes.*
