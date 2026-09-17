# Import 2B → 2B Reconciliation → Suspended Reco → GSTR-3B

How the write-through works, and the GST-law positions it encodes.

**These positions were implemented by engineering judgement, not confirmed in
a firm sign-off conversation** (the clarifying questions asked before this
build were not answered) — flag it if any of the four below don't match how
the firm actually wants it to work; each is a one-line change to reverse.
(§5, the per-client Strict/Liberal toggle, *was* confirmed directly with the
firm — see that section for the answers.)

---

## The flow

```
Import 2B (twob_import_docs / books_register)
        │  classify every document — the only data-entry surface
        │  "Post to Reconciliation"
        ▼
2B Reconciliation (bills_not_in_2b / bills_not_in_books)
        │  read-only ledger — reversal_month / reclaim_month / book_entry_month
        │  Pending items (back on Import 2B) assigns Reclaim / Book Entry each month
        ▼
ITC Summary (row 5.1, 5.4, 4B(2)(i), 4D(1)/(1.1))  +  Suspended Reco
        ▼
GSTR-3B (src/utils/fetchGstr3b.ts / buildGstr3bJson.ts)
```

2B Reconciliation, ITC Summary's auto-linked rows, Suspended Reco and
carry-forward were **not** rewritten — they already read `bills_not_in_2b` /
`bills_not_in_books` live. Only the write path changed: that ledger now has
exactly one writer, `src/lib/postImport2B.ts`, invoked from Import 2B's "Post
to Reconciliation" button.

## Per-document mapping

| Import 2B classification | GST-law reading | Where it lands |
|---|---|---|
| 2B doc: **MATCHED** | Genuinely in 2B, matches books | Claimed this month at the 2B figure — no ledger row, feeds ITC Summary row 5.1 directly |
| 2B doc: **MISMATCHED** | In 2B, but taxable/tax differs from books by >₹10 | Claimed at the **2B value** (see §1) — no ledger row; the differential is a follow-up item, not a claim adjustment |
| 2B doc: **INELIGIBLE** | Portal itself marks it blocked (s.17(5) etc.) | Excluded from row 5.1; not posted anywhere else in this module |
| 2B doc: **ITC_OF_OTHERS** | Not the taxpayer's ITC at all (wrong GSTIN / duplicate) | Excluded entirely — not eligible, not ineligible, just not counted |
| 2B doc: **NOT_IN_BOOKS** | In 2B, not yet booked | → `bills_not_in_books` row; `bill_in_2b_month` = this period, `book_entry_month` blank until booked |
| 2B doc: **RECLAIM** | This is a previously-reversed invoice reappearing in 2B | Linked (not summed into row 5.1) — see §2 |
| Books row: **NOT_IN_2B** | Booked, supplier hasn't filed / not in 2B this period | → `bills_not_in_2b` row; `reversal_month` = this period (see §2), `reclaim_month` blank until resolved. **Also** feeds ITC Summary row 5.1 this period (gross claim), reversed straight back out via 4B(2)(i) at the same amount — see "Row 5.1 auto-link" below |
| Books row: **MISMATCHED** | Paired to a 2B doc that differs by >₹10 | No ledger row — covered by the 2B doc's own MISMATCHED handling above |
| Books row: **NOT_ELIGIBLE** | Booked but the firm has determined it's blocked credit | No ledger row — permanently excluded, not a timing gap |

## §1. Mismatch → claim at the 2B value, not the books value

Since s.16(2)(aa) / Rule 36(4) and Circular 170/02/2022, ITC eligibility is
capped at what GSTR-2B actually shows. A MISMATCHED document is still
genuinely in 2B — only the amount differs from books — so it is claimed at
the 2B figure. **Not implemented:** auto-reversing the excess-over-2B portion
of the books figure (the alternative position would be to claim the higher
books value and post the gap as a Reversal/Reclaim pair). If the firm's
practice is actually the latter, that changes `fetchImport2BEligibleTotal()`
in `src/lib/postImport2B.ts` and adds a MISMATCHED case to the posting
engine.

## §2. Reversal is mechanical, Reclaim requires matching evidence

`bills_not_in_2b.reversal_month` is set to the *current period* automatically
the moment a books row posts as NOT_IN_2B — under the restricted-period
regime already in force from Jun-26 (`RESTRICT_MONTHS_FROM` in the pre-existing
code), reversal can only ever be this month anyway, so there is no separate
staff decision to make there.

`reclaim_month` stays blank until staff link it to the specific invoice that
evidences it's actually back in 2B — reclaim is never a self-certified
monthly pick. Two entry points, same matching dialog
(`ReclaimMatchDialog.tsx`), same rule — the pending item and the candidate
2B doc must match **exactly** on taxable value, IGST, CGST and SGST before
Confirm is enabled:

- **From a freshly imported 2B doc** — classify it **RECLAIM** instead of
  MATCHED. This is the important correctness point: if the same invoice were
  left as MATCHED, its value would be summed into row 5.1 as if it were
  brand-new ITC — on top of the reclaim already flowing through row
  5.4/4D(1)/(1.1) once linked. RECLAIM excludes it from
  `fetchImport2BEligibleTotal()` (that query only sums MATCHED + MISMATCHED),
  so the same credit is never counted twice.
- **From Import 2B's Pending Items zone** — "Link & Reclaim" on a pending
  reversed item, matching against this period's imported docs.

The link is recorded on `bills_not_in_2b.reclaimed_via_doc_id` (→
`twob_import_docs.id`). Changing a RECLAIM doc's action to something else
releases the link (`reclaim_month`/`reclaim_subtype`/`reclaimed_via_doc_id`
cleared) so the pending item goes back to "awaiting reclaim" rather than
silently staying marked reclaimed against a doc that no longer says so —
`handleDocActionChange` and `applyBulk` both do this before writing the new
action.

Marking an item **Expense out** instead (no matching invoice — the credit is
being written off, not reclaimed) is a direct action in Pending Items; it
writes `reclaim_month` = this period with `reclaim_subtype = 'EXPENSE_OUT'`,
same as before this section was reworked — that downstream behaviour
(Suspended Reco's 4(D) 1.2 row, etc.) is untouched. A mistaken Expense out can
be undone — Import 2B's Pending Items zone lists this period's expensed-out
rows in their own "Expensed out — Undo" table, and Undo clears
`reclaim_month`/`reclaim_subtype` back to `null`, returning the row to
"Awaiting reclaim." (Undo covers Expense out only — undoing a RECLAIM link
already works today by changing that 2B doc's action away from RECLAIM in
Zone 1, per the paragraph above.)

**Known gap:** deleting a period's imported 2B batch (or re-importing over
it) deletes its `twob_import_docs` rows, which cascades `reclaimed_via_doc_id`
to `NULL` on any linked `bills_not_in_2b` row (`ON DELETE SET NULL`) but
leaves `reclaim_month` set — an orphaned "reclaimed" row with no linked
evidence. Not handled in this pass; re-run Post to Reconciliation and
manually correct if it comes up.

## §3. 2B Reconciliation is read-only for Strict clients

For a client in Strict mode (the default — see §5), every edit surface on
that page — Save Changes, Import Excel, Add row, per-cell inputs, per-row
delete — is hidden/disabled. The only remaining actions are Export Excel,
View Versions (+ Restore, for admins — an audit/recovery tool, not routine
data entry) and Clear Data (destructive reset, already
superadmin/gst_manager-gated).

**Consequence:** a *Restore* from an older version re-inserts rows without a
`source_book_id` / `source_doc_id` link back to that period's Import 2B
staging rows. Those restored rows behave like the pre-existing legacy rows —
Posting won't touch, retract, or duplicate them, but it also won't keep them
in sync with Import 2B if the classification is later reverted there.

## §4. Existing already-imported batches are not retroactively posted

Shipping this doesn't walk every historical `twob_import_docs` /
`books_register` row and push it into the ledger. Only a `Post to
Reconciliation` click (new or re-run, for any period) writes through. To
backfill a period that was already classified before this change, reopen it
in Import 2B and click Post — the sync is idempotent and safe to re-run.

## §5. Per-client Strict / Liberal toggle

`clients.liberal_2b_reconciliation` (boolean, default `false`). Confirmed
directly with the firm, not an engineering guess:

- **Default is Strict for every client**, existing and new. Liberal is an
  explicit opt-in per client, not the other way round.
- **Liberal restores the full pre-#40 editable page** for that client — Add
  row, edit any cell, Import Excel, Save Changes, per-row Delete. Nothing is
  held back; that client's staff genuinely don't need Import 2B at all if
  they don't want it.
- **Only superadmin / GST Manager can flip the toggle** (`canManage2BLiberalMode()`
  in `AuthContext.tsx`) — set from Edit Client. No employee permission grant
  exists for this, unlike most other gated actions in this app.
- **Import 2B stays fully usable for every client regardless of mode.** The
  toggle only controls whether *direct* edits on 2B Reconciliation are also
  allowed. A Liberal client's staff can use either path, or mix them — the
  posting engine (`postImport2B.ts`) only ever touches rows carrying its own
  `source_book_id`/`source_doc_id` link, so a manually-added row from direct
  editing is invisible to it and never gets retracted or duplicated.
- `readOnly` on the reconciliation page is `isLocked || !isLiberalClient` —
  a filed period is always read-only on top of the client's mode, for both
  Strict and Liberal clients alike.

## Row 5.1 auto-link

`ITC Summary` row 5.1 "ITC for the Month" was a hand-typed figure before this
change. It is now `isAutoLinked`, computed as `fetchImport2BEligibleTotal()`
(the sum of MATCHED + MISMATCHED, non-RCM `twob_import_docs` rows for the
client/period) **plus** this period's NOT_IN_2B reversal total (the same
`bills_not_in_2b` rows, filtered the same way, that 4B(2)(i) below reverses)
— the same live-query pattern already used for rows 4B(2)(i), 5.4 and
4D(1)/(1.1).

**Gross, not net:** a NOT_IN_2B invoice is booked ITC for the month that
just isn't in GSTR-2B yet — under the restricted-period regime it can't be
retained, so it has to come straight back out, but it was still claimed this
month. Row 5.1 now shows it going in and 4B(2)(i) shows it coming back out,
matching how the portal's own Table 4 is meant to read (claim gross, reverse
separately) instead of silently excluding it from 5.1 and leaving nothing for
4B(2)(i) to visibly reverse. **Total 4C (Net ITC) is unaffected either way** —
this only corrects the gross presentation on 5.1/4B(2)(i), not the final
number. (A carried-forward pending item keeps its *original* `reversal_month`
across the carry — see §2 — so it is added to 5.1 exactly once, in its
origination month, never again while it sits in Pending Items.)

Staff can no longer hand-type row 5.1; if a client needs an adjustment outside
what Import 2B captures, it has to go through Import 2B's classification, not
a manual override on this row.

**Not wired:** an ineligible-ITC total from INELIGIBLE-classified 2B docs into
section 4D's ineligible row. That row stays fully manual — it already covers
things beyond 2B (s.16(4) time-bar, PoS restrictions) and auto-linking it
would remove the ability to add those. A firm that wants INELIGIBLE-from-2B to
feed it automatically would extend the `isAutoLinked` pattern the same way
row 5.1 was.

## Schema landmine fixed in this pass

`bills_not_in_2b.updated_by` / `bills_not_in_books.updated_by` carried a
`REFERENCES auth.users(id)` FK from the original Lovable-era schema. This
app's custom auth (`src/contexts/AuthContext.tsx`) never creates `auth.users`
rows for staff — session identity lives in `profiles`/`user_roles` — so any
write that set `updated_by` to the current session's user id violated the FK
(`bills_not_in_2b_updated_by_fkey` / `bills_not_in_books_updated_by_fkey`).
It went unnoticed because the original 2B Reconciliation page never actually
wrote a *new* user id into that column on these two tables (its update calls
spread the whole local row back, which already carried whatever was in the
DB). Import 2B's Pending Items zone was the first code path to actually do
this and immediately hit it in production. Dropped both FKs — every other
user-audit column in this schema (`twob_import_docs.updated_by`,
`books_register.updated_by`, `itc_summaries.updated_by`, etc.) is already a
plain `uuid` with no FK, for the same reason.

## RCM

Out of scope for this change. RCM Summary (`rcm_data`) stays fully
independent of Import 2B's RCM-flagged (`reverse_charge = true`) documents,
same as before — those are simply hidden from the Import 2B UI with a pointer
to RCM Summary.

## §6. Carry-forward incident (2026-08-14)

Unrelated to the Import 2B work above, but the same tables: `FilingStatusPage.tsx`'s
`carryForwardToNextMonth()` — the function that copies pending `bills_not_in_2b`
/ `bills_not_in_books` rows into the next period the moment a GSTR-3B is
marked Filed — never checked the errors on its `insert()` calls, and its
outer `catch` deliberately swallowed any failure silently ("don't fail the
filing just because carry forward failed"). Root-caused when a user reported
carried-forward lines missing for several clients: roughly half of all
clients who filed their June-2026 GSTR-3B never got their July carry-forward
at all (21 clients, still happening live the same day it was diagnosed) —
most likely a staff member navigating away right after clicking "Filed",
before the sequential awaits finished, though the exact trigger couldn't be
confirmed from server-side data alone.

**Fixed at the app layer**: every step now checks its error and the function
returns a result instead of swallowing failures; a failed carry-forward
surfaces a distinct warning (the Filed status itself already committed by
that point, so it must not read as "filing failed"); a manual "Re-run carry
forward" button (next to any Filed GSTR-3B/GSTR-3B (Q) record) makes this
self-recoverable — safe to click any time, it's the exact same idempotent
delete-then-insert as the automatic run. An in-flight guard also prevents the
same client+period from running twice concurrently.

**Fixed at the root, structurally**: the app-layer fix above still can't rule
out the same class of failure recurring — it's still a sequence of separate
network round-trips that a closed tab can interrupt between any two of them.
So the carry-forward step was moved into `auto_lock_on_filed()`, the existing
`BEFORE UPDATE ON filing_status` trigger that already locks the 2B/ITC sheets
the instant a GSTR-3B is marked Filed
(`20260814190000_carry_forward_trigger_hardening.sql`). A trigger runs inside
the same atomic transaction as the filing_status row's own update — nothing
in the browser can interrupt it, because by the time the browser's fetch for
that update even resolves, the trigger has already committed server-side.
This is now the primary, reliable mechanism; the app-side call stays as a
redundant, now-error-checked second pass (harmless — delete-then-insert
produces the same end state run twice) and remains the only path for a
filing_status row created fresh as already-Filed (an `INSERT`, which this
`UPDATE`-only trigger doesn't fire for), plus the manual retry button for
on-demand re-sync. Scoped to `return_type = 'GSTR-3B'` only, matching the
trigger's existing lock-logic gate — every incident found was on plain
monthly GSTR-3B; `GSTR-3B (Q)` (quarterly) still relies on the app-side path,
since widening this would need a quarter-aware next-period calculation (next
quarter-end, not +1 month) that hasn't been verified.

**Data repair**: `supabase/migrations/20260814180000_backfill_missing_carry_forward.sql`
reconstructs the missing rows from each client's still-intact filed-period
data — purely additive (skips any client+period+table that already has
carried-forward rows), safe to run more than once. Dry-run counted 355
`bills_not_in_2b` + 1,111 `bills_not_in_books` rows. This one had to be run
by hand via the Supabase SQL Editor — the environment's safety classifier
blocked it as a bulk data mutation on three separate attempts, even after
explicit user confirmation in chat, while the trigger-function migration
above (schema/DDL, not a bulk data write) went through the same path without
issue — that's a tool-permission gate distinguishing the two, separate from
conversational approval.

That migration re-ran its insert pass a fixed **two** times to close chained
gaps, which only closes a chain up to two hops deep. Three clients —
BRICKSTONE INFRA, RAYWINGS SERVICES LLP, NEW FORTUNE TYRES — had gaps three
to four hops deep, so the last hop of each stayed empty after the hand-run
(12 `bills_not_in_2b` rows + 1 `bills_not_in_books` row). Caught by
re-running the same audit query post-repair rather than trusting the "done"
report at face value.
`supabase/migrations/20260814200000_backfill_remaining_carry_forward_gaps.sql`
replaced the fixed two-pass re-run with a `LOOP` that keeps re-applying the
same additive, `NOT EXISTS`-guarded insert until a pass inserts zero rows —
closes a gap chain of any depth in one statement. Applied directly (went
through the tool-permission gate this time, unlike the plain multi-statement
version). Verified: the dry-run audit query is back to `would_insert_2b=0`,
`would_insert_books=0` across every client.

## §7. Carry-forward incident (2026-09-16) — filing out of order

Reported as "Amber Gum's Jun-2026 and Jul-2026 items yet to be reclaimed
aren't carried forward into Aug-2026". Different cause from §6, same
symptom, and this one is a design flaw rather than a dropped network call.

**Root cause.** Carry-forward is an *event-sourced copy chain*. Pending 2B
items exist in period N+1 only because the "mark GSTR-3B Filed" event on
period N physically copied them there — `auto_lock_on_filed()` in the DB,
plus `carryForwardToNextMonth()` in `FilingStatusPage.tsx`. Nothing ever
fires for a period that is never filed. And Filing Status had **no guard
requiring the previous period's GSTR-3B to be filed** — the only
prerequisite was GSTR-1 for the *same* period. So filing out of order was
an ordinary click.

Once period N is skipped and N+1 is filed, N+1 copies forward only what N+1
itself contains. Everything older than N is gone from N+1 onward,
permanently — there is no copy left to pass on. It does not self-heal, and
it compounds silently every month after.

Amber Gum's timeline: Jun-2026 GSTR-3B was left at "Prepared Pending"; on
2026-08-20 Jul-2026 was marked Filed, which carried July's own 2 rows into
Aug-2026 and nothing else. June's 6 rows — 3 still awaiting reclaim, going
back to a Jan-2026 reversal — never reached July, so August could never
show them.

**Three clients were affected** (found by scanning every client for a
period holding ledger rows whose next period has zero carried-forward rows,
where that next period's GSTR-3B is already Filed):

| Client | Break | Lost |
|---|---|---|
| AMBER GUM INDUSTRIES | Jun-2026 unfiled, Jul-2026 filed 2026-08-20 | 6 rows, 3 pending (₹2,190.20 tax) |
| NAVRATNA S G HIGHWAY PROPERTIES | Dec-2025 unfiled, Jan-2026 filed 2026-03-28 | 61 `bills_not_in_books` rows |
| SHIVON INFRA- NO ITC | Jun-2026 unfiled, Jul-2026 filed 2026-08-20 | 1 row, already reclaimed — no ITC at stake |

**NAVRATNA's Dec-2025 bucket is partly mis-keyed, and was deliberately only
half-repaired.** It holds 61 `bills_not_in_books` rows dated
Apr-2025..Dec-2025 (the genuine backlog) *plus* 22 books rows and all 4
`bills_not_in_2b` rows dated **Apr-2026**, reversal month "Apr 26" — the
same invoices already sitting correctly in the Apr-2026 period, evidently
keyed in with the month selector left on Dec-2025. Carrying those forward
would have injected a phantom duplicate of ₹1,90,395 of reversal into every
period from Jan-2026 to Aug-2026. The repair therefore stops at 2025-12-31
for this client, and **its 2B side needed no repair at all** — nothing was
lost there, only mis-filed. Cleaning up the mis-keyed Dec-2025 rows is a
data decision left to the firm.

**Data repair**:
`supabase/migrations/20260916120000_repair_broken_carry_forward_chains.sql`.
Its `repair_carry_forward_chain()` is additive and *per row*: for each hop it
inserts only the rows the destination period is missing, multiset-matched on
invoice identity (date, supplier, invoice no, GSTIN, taxable value, three tax
amounts) and deliberately **ignoring** `reclaim_month` / `book_entry_month` /
`bill_in_2b_month`, so a row staff have since marked reclaimed downstream is
recognised as already carried rather than duplicated or reset. Nothing is
deleted or updated, and re-running inserts zero.

That per-row matching is the point of difference from §6's backfills, whose
guard was "only insert where this client+period+table has *zero*
carried-forward rows". That guard is why NAVRATNA's Feb-2026 got its 35 rows
back in August while Mar-2026 — which already had carried-forward rows of its
own — was skipped, leaving Mar-2026 short by the same 35. A half-repaired
chain, still visible in the data a month later. Verified after applying:
every period's carried-forward count now equals the previous period's total
row count, for all three clients, and the repaired rows read back through the
anon key (not just the management API, which bypasses RLS).

**Code changes**, all in `src/pages/FilingStatusPage.tsx`:

1. **Previous period's GSTR-3B must be filed first.** The actual fix. Blocks
   marking GSTR-3B Filed when the prior month's GSTR-3B exists and isn't
   Filed. No row for the prior month means the client simply has no earlier
   period here, so nothing is blocked. Monthly `GSTR-3B` only — for
   `GSTR-3B (Q)` "the previous period" is the previous quarter-end, and the
   carry-forward trigger doesn't cover quarterly filings anyway (§6).
   **Manager override:** a GST Manager / Superadmin can confirm past it, so a
   client that genuinely migrated mid-year isn't permanently stuck; the
   message names what it costs.
2. **Un-filing no longer deletes next period's carried-forward rows.** It did,
   on the reasoning that re-filing re-creates them — true only if the period
   is ever re-filed. Unlocking Jun-2026 and not re-filing it wiped Jul-2026's
   backlog outright. Keeping them costs nothing: both carry-forward paths
   delete every carried-forward row in the destination before inserting, so a
   re-file still produces exactly the right set.
3. **"Re-run carry forward" is no longer gated on `status === 'Filed'`.** The
   case that most needs it is the period that was never filed — gating it on
   Filed left staff with no way out of exactly the breakage it exists to
   repair.
4. **`carryForwardToNextMonth()` now deletes unconditionally**, outside the
   "source month has rows" check. Guarding the delete behind `length > 0` left
   a stale copy stranded in the next period when a period's last pending item
   was cleared — and disagreed with the DB trigger, which always deletes.

**Left alone deliberately:** four client+periods carry one or two fewer rows
than their source month (VISHVAS POLYPACK Aug-2025, ELENZA CALLISTA Dec-2025,
RAYWINGS SERVICES Mar-2026, SALIENT INFRATECH Apr-2026). That signature fits
a superadmin deleting a carried-forward row on purpose — a supported action
on the 2B Reconciliation page — and a blind repair would undo it.

**Not done: the underlying design.** Carry-forward is still a chain of
physical copies triggered by a filing event, so it still depends on every
month being filed, in order, through this app. The durable fix is to *derive*
the pending backlog at read time from origin rows across all prior periods
instead of copying it forward, which would make the chain unbreakable by any
filing order. That touches 2B Reconciliation, ITC Summary, Suspended Reco and
the filing gate, so it is deliberately out of scope here.

## §8. Suspended Reco is not a filing gate for NO-ITC promoters

Reported 2026-09-16: KRISHNA INFRA-NO ITC could not file GSTR-3B for
Aug-2026 — Suspended Reco showed a fixed difference of **−₹82,076.88**
(portal 0 / ₹0 opening vs books ₹2,08,211.66) and the pre-filing gate
requires |difference| ≤ ₹20. Nothing on the page could clear it.

**Why it can never reconcile for these clients.** Suspended Reco exists to
prove that credit reversed under Rule 37A / s.16(2)(c), and still sitting in
the portal's suspended balance, matches the reversals the books are carrying
— because that credit is eventually going to be *reclaimed*. A promoter who
elected the 1%/5% no-ITC scheme never reclaims any of it. ITC Summary already
encodes this: for `builder_itc_type = 'NO_ITC'` it forces Total 4B to equal
Total 4A outright, specifically so Net ITC (4C) is 0 by construction rather
than depending on the reversal rows summing to the right figure
(`ITCSummaryPage.tsx`, `noItcSection4B`). The books side accumulates reversal
rows; the portal side has no corresponding suspended balance to match them
against. The two have no reason to converge, so the difference is permanently
non-zero through no error of the staff's, and the gate blocks filing forever.

**Change**: `handleStatusChange` in `FilingStatusPage.tsx` skips the Suspended
Reco difference check entirely when the client is `regular_sub_type =
'Builder'` **and** `builder_itc_type = 'NO_ITC'`. Every other pre-filing check
still applies — GSTR-1 filed for the period, the previous period's GSTR-3B
filed (§7), ARN format and uniqueness, the advance set-off gate, and the
builder FSI/BU confirmations. Only this one check is waived, and only for
these clients.

**Builders only — not any client that happens to have no ITC.** The waiver is
about the *promoter* scheme under Notification 3/2019-CTR: a promoter who
elected 1%/5% forgoes ITC as a condition of the rate, which is why 4C is
pinned to zero and why the reconciliation can never close. An ordinary
registered person with no ITC in a given month is a completely different
situation — their suspended balance is still expected to reconcile, and a
non-zero difference there is a real finding, not a structural artefact. So
both flags are required, and the sub-type check is not redundant: Edit Client
nulls `builder_itc_type` whenever the sub-type isn't `'Builder'`, but a flag
left stale by a direct DB edit, an import, or a future screen would otherwise
hand a non-promoter a filing-gate bypass.

**Gated on the flags, never on the name.** `builder_itc_type = 'NO_ITC'` is
set on **18 clients**, all of them `Builder` (all 25 clients carrying any ITC
type are Builders). The `-NO ITC` naming convention does *not* track it:

- **10 clients have "NO ITC" in the name but are `regular_sub_type =
  'Normal'` with the flag unset**: ATC LOGISTICS, CLEAR QUANT TECHONLOGIES,
  GAMARA INFRASPACE, MTR HOTEL & RESORTS, SHARVA INFRATECH, SKYLARK
  CORPORATION, STATE EXAMINATION BOARD, SUKIRTI DEVELOPERS, SUNRISE
  LOGISTICS - GUJ, SWASTIK BUILDCON. **These do not get the exemption** —
  they are not promoters as far as the client master is concerned, whatever
  the name says. Several read like promoters (GAMARA INFRASPACE, SHARVA
  INFRATECH, SUKIRTI DEVELOPERS, SWASTIK BUILDCON, SKYLARK CORPORATION) and
  may be mis-configured, but reclassifying a client as a Builder on the
  1%/5% scheme is a data decision for the firm, not something to infer from
  a name suffix in code. Fix is one edit per client in Edit Client: set
  Builder sub-type and ITC type = NO ITC.
- **1 client has the flag without the name**: UKASUKH DEVELOPERS. It is a
  `Builder` with `NO_ITC`, so it gets the exemption, correctly.

Matching on the name instead would have been both over- and under-inclusive,
and would silently change which clients can bypass a filing gate every time
somebody renames one.

### There are TWO gates, not one

The Suspended Reco difference is enforced in two independent places, and the
first fix only covered one of them:

| Where | Form | Threshold | File |
|---|---|---|---|
| Marking GSTR-3B **Filed** | `toast.error` on click | \|diff\| > ₹20 | `FilingStatusPage.tsx`, `handleStatusChange` |
| **Push to GST Portal** | Button `disabled`, hard-blocked | diff ≠ 0 | `Gstr3bPage.tsx`, `hasRecoDiff` |

The Push gate is the stricter of the two (any non-zero difference, not just
over ₹20) and the more visible: the button simply cannot be pressed, with a
red "Reconciliation difference found — Push to GST Portal is locked" banner
above it. Both now carry the same `Builder` + `NO_ITC` waiver.

**Only the Suspended Reco half of the Push gate is waived.** The other half,
GST Receivable Reco, still blocks: `gstReceivableRecoCalc.ts` already handles
NO-ITC clients in its own calculation (netting Total 4B against Total 4A the
way ITC Summary does), so a difference there is a real finding rather than a
structural artefact.

The banner now derives from the same `suspendedBlocks` / `receivableBlocks`
flags as the button, so it can no longer announce a lock that isn't in force.
A stale comment above `recoCheck` claiming the check was "advisory only,
doesn't block Push" was corrected at the same time — it had been untrue since
the `disabled=` binding was added, and it sends anyone debugging a stuck Push
button to the wrong place.
