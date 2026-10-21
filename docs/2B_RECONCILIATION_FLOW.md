# Import 2B → 2B Reconciliation → Suspended Reco → GSTR-3B

How the write-through works, and the GST-law positions it encodes.

**These positions were implemented by engineering judgement, not confirmed in
a firm sign-off conversation** (the clarifying questions asked before this
build were not answered) — flag it if any of the four below don't match how
the firm actually wants it to work; each is a one-line change to reverse.
(§5, the per-client Strict/Liberal toggle, *was* confirmed directly with the
firm — see that section for the answers — and so were §10's two choices on
credit notes and amendments.)

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

The table is written for invoices. A supplier debit note follows it exactly; a
credit note and an amendment differ, see §10.

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
2B doc must agree on taxable value, IGST, CGST and SGST, **within ₹2 per
head**, before Confirm is enabled:

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
silently staying marked reclaimed against a doc that no longer says so.
`handleDocActionChange` and `applyBulk` only stage the change; `saveActions`
releases the links of every staged row leaving RECLAIM before it writes the
new actions.

**The ₹2 rounding tolerance (added 2026-09-19).** This was an exact match to
the paisa until the firm asked for it to be relaxed. Exact sounds like the
safe default, but it isn't workable: the supplier's GSTR-1 and the firm's
books round independently — per-line versus per-invoice, and the portal
applies its own half-up rounding to each head — so the same invoice routinely
returns a rupee or two out. Staff were left unable to reclaim credit that was
visibly the same invoice, with only two ways out, both bad: **Expense out**
(writing off real, recoverable credit) or editing the books to fit the
portal.

The tolerance is deliberately narrow, and the shape matters as much as the
number:

- **A flat ₹2, not a percentage.** It does not widen with the invoice — a
  ₹50 lakh invoice gets exactly the same ₹2 of latitude as a ₹500 one. Any
  genuine difference in rate, quantity or value clears it by orders of
  magnitude, so the tolerance can only ever absorb rounding.
- **Per head, never pooled.** Taxable value, IGST, CGST and SGST are each
  tested on their own, so four heads cannot contribute ₹2 apiece into an ₹8
  aggregate difference.
- **Exact and tolerated matches stay visually distinct.** The dialog shows a
  green tick for an exact match, an amber warning for one leaning on the
  tolerance (with the actual rupee difference), and a red cross for anything
  beyond it. Staff always see when they are spending the allowance.

`ReclaimMatchDialog.tsx` is the only gate on this — `handleReclaimConfirm` in
`Import2BTab.tsx` just writes the link and re-validates nothing, so the
constant `RECLAIM_ROUNDING_TOLERANCE` in that file is the single place the
number lives.

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

**Formerly a known gap (closed 14 Oct 2026, §10):** re-importing a period
used to delete and re-insert its `twob_import_docs` rows, which reset every
classification and left linked `bills_not_in_2b` rows "reclaimed" with no
evidence (`ON DELETE SET NULL` on `reclaimed_via_doc_id`, `reclaim_month`
left set) and posted `bills_not_in_books` rows unlinked, so the same ITC
could be claimed twice. A re-import now merges (§10), and "Delete imported
2B" releases the reclaim links and removes the linked, unlocked Not in Books
rows before it deletes.

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
  in `AuthContext.tsx`) — set from Edit Client, or with Make Strict / Make
  Liberal on a client's row in the Clients page's Liberal / Strict pop-up. No employee permission grant
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
- **Liberal also makes ITC Summary row 5.1 a typed figure** (since 17 Aug
  2026; No-ITC builders too, since 19 Aug). Nothing on the Liberal 2B
  Reconciliation page can feed it: that page holds only the Not in 2B / Not in
  Books lists. An audit on 14 Oct 2026 found Aug-26 ITC typed there for 11
  Liberal clients with no 2B behind it (₹1.95 crore). The firm kept the mode
  (its option 3) on three conditions, built the same day:
  - a typed 5.1 (Liberal / No-ITC) and any row 5.2 are marked in red, **"Typed,
    not from 2B"**, on ITC Summary with what 2B gives and the difference, and
    on GSTR-3B Table 4 (`fetchGstr3b` → `itcTyped`);
  - every switch is logged with who and when (`clients.liberal_changed_*`,
    `client_liberal_log`, migration 20261017100000);
  - Clients → **Liberal / Strict** lists both at a glance, in a pop-up.

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

For a **Strict** client staff can no longer hand-type row 5.1; if a client needs
an adjustment outside what Import 2B captures, it has to go through Import 2B's
classification, not a manual override on this row. (A Liberal or No-ITC
client's 5.1 is typed, and marked so: §5.)

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

> Since 21 Oct 2026 (§13) the carry copies a list only into a next month that
> holds none yet, and Re-run carry forward previews and keeps later decisions.
> The delete-then-insert described below is gone.

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

> Since 21 Oct 2026 the carry no longer deletes and copies again; see §13.

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

## §9. The superadmin edits every working sheet (firm decision, 13 Oct 2026)

> Since 21 Oct 2026 (§13) this no longer holds for Import 2B and 2B
> Reconciliation: in a filed month the superadmin, like a GST Manager, changes
> only books entries, through the preview.

The superadmin can add, edit and delete on every GST Working sheet, whatever
would otherwise stop them. The superadmin is the only role this applies to;
everyone else keeps the rules as they are.

**What no longer stops the superadmin:**

- **2B Reconciliation:**
  - Strict mode;
  - a filed period;
  - carried-forward rows, whose columns are all editable;
  - the current-month-only restriction on the Reversal / Reclaim / Book Entry /
    In-2B month lists.
- **Import 2B:** a filed period. Import, pull, post, classify and delete all
  work.
- **ITC Summary:** a filed period.
- **RCM Summary:** filed months and a fully filed year.
- **Suspended Reco:** Override is offered even when the opening was set by
  hand.

**What the screens show:**

- A filed period still shows its lock note. For the superadmin the note says
  edits do not reach the filed return.
- Nothing is re-filed. A change after filing has to be carried to the portal by
  amendment or in a later return, as for any other correction.

**Still fixed, even for the superadmin:**

- **ITC Summary auto-linked rows** (5.1, 5.4, 4B(2)(i), 4D(1), partial ITC).
  They are recomputed from their sources on every load, so a typed value would
  not survive a reload. Change the source rows instead.
- **2B document figures on Import 2B** (portal data).
- **Edit / delete of recorded advance set-off legs and opening advances.** The
  app has no screen for these yet.

## §10. Debit notes, credit notes and amendments (firm decision, 14 Oct 2026)

Until 14 Oct 2026 Import 2B read only the invoice sheets of the GSTR-2B Excel
(B2B, B2B (ITC Reversal), B2B(Rejected)). Debit and credit notes and every
amendment were dropped without a word, so a month with notes reconciled
wrong. Before Import 2B (until 05/2026) staff had entered credit notes by hand
as negative rows; since then nothing carried them.

**What is read** (`src/utils/parseGstr2b.ts`): the whole B2B family, twelve
sheets: B2B, B2BA, B2B-CDNR, B2B-CDNRA in the available bucket; their Rule 37A
reversal sheets (B2B (ITC Reversal), B2BA (ITC Reversal), B2B-DNR, B2B-DNRA)
and IMS rejected sheets (B2B(Rejected), B2BA(Rejected), B2B-CDNR(Rejected),
B2B-CDNRA(Rejected)). Sheet names are matched ignoring spaces and case. Any
other sheet with rows (ECO, ISD, imports) is named in a warning, to be handled
by hand. Amounts are stored positive, as on the 2B; `doc_type` (INVOICE /
DEBIT_NOTE / CREDIT_NOTE) gives the sign. The meaning of every document lives
in one module, `src/lib/twobDocs.ts`.

**The firm's choices (asked and answered 14 Oct 2026):**

1. **Credit notes fill ITC Summary row 5.3 "Debit Note"** (the firm's own
   name for the purchase return). For a Strict client, row 5.3 is the month's
   Matched and Mismatched credit notes and is no longer typed, so a note is
   never deducted twice. Liberal and No-ITC clients keep typing 5.3, marked in
   red with what 2B gives (as row 5.1). Other adjustments staff used to park in
   5.3 belong in 4B(2)(ii). Row 5.3 fills itself only for a month imported
   with the new parser (`full_2b`); older months keep the 5.3 they were filed
   with.
2. **An amendment counts only its difference.** The confirmed original (in an
   earlier month, often filed) is never touched. The amendment row is linked
   to the version Import 2B already counted (`amends_doc_id`, `base_*`: that
   version's figures) and counts revised minus counted this month, following
   that version's treatment: Matched (or Mismatched or reclaimed) → the
   difference is claimed in 5.1, or reduced if negative; Not in Books → the
   difference is posted to Not in Books beside the original (it may be
   negative); Ineligible / ITC of Others → excluded. A number or date
   correction shows ₹0. When no earlier version is in Import 2B (imported
   before Import 2B, or never imported) the row is **Held**: counted nowhere
   until staff choose its treatment. Matched on such a row would claim the
   full revised value, as if the original was never claimed, so the row says
   so, Save asks first, and **Enter counted** on the row records what the
   earlier version counted (`base_*` with no `amends_doc_id`): the row then
   counts only the difference. A second amendment counts against the first;
   one that amends a held amendment stays Held until that one is settled.
3. **A credit note may be parked Not in Books, like an invoice** (asked 17
   Oct 2026: "Debit note should have selection of not in books same like
   Invoice", the firm's Debit Note being the purchase return, the supplier's
   credit note in 2B; supplier debit notes already had it). Until booked it is
   left out of 5.3 and sits on the ledger as a negative row (`signedEffect`);
   its amendment follows it there. Once booked, reduce row 5.2 by the note,
   head by head, negative where needed: 5.2 is the one ITC Summary row that
   takes a negative head (`takesNegativeHead` in `src/utils/builderPartialItc.ts`;
   5.3 is auto-linked and read-only for a Strict `full_2b` month). Every
   reader of 5.2 sums it as signed: Total (5) and Total 4A, the Partial-ITC
   carpet-area split, the GST receivable reco and the credit closing report.
   A head that takes 4A(5) below zero is filed as 0 in GSTR-3B with the
   excess in 4B(2) Others, net ITC unchanged (below, "Negative 4A(5)").
   Caveat for the firm to confirm: IMS reduces the auto-drafted 4A(5) by an
   accepted or deemed accepted credit note, so parking one files 4A(5) above
   the portal's figure; the portal's own way to defer is to keep the note
   Pending in IMS.
   `node scripts/verify-import2b-notes.mjs` checks every reader.

**Engineering positions (not asked; reversible):**

- **Debit notes** are claimed like invoices (5.1), with every invoice
  treatment. Their s.16(4) clock runs from the debit note's own date.
- **A credit note starts Matched, reducing ITC this month**, since IMS has
  accepted it (or deemed it accepted) and the portal has already reduced the
  auto-filled 3B; staff may park it Not in Books (choice 3). It never
  evidences a reclaim. A credit note with ITC Availability No still
  reduces (the GSTR-2B instructions keep the reversal on credit notes), unless
  the recipient declared in IMS that no ITC is to be reduced (then
  Ineligible). With "Yes" and a declared amount, the declared tax is what
  reduces.
- **A credit note missing from 2B has no entry**: the books register takes
  invoices and debit notes only, since row 5.3 follows 2B. A booked credit
  note (the client's debit note) waits for its 2B row and has no effect
  until then (the firm's decision, 20 Oct 2026). Enforced since then: the
  books register refuses a minus amount, a minus row already saved is marked
  red, and Post to Reconciliation skips it and takes back what it posted
  (`bookHasMinus`, `postImport2B.ts`). Before, ORVIX's Sep-26 entry
  2/CN/2026-27 (−360 CGST and SGST, Not in 2B) went into the ledger as a
  minus reversal: row 5.1 came out 360 short of the matched invoices and
  4B(2) minus 360, which the portal refuses (the push check stopped it).
- **A books "Debit note" is the client's purchase return** (the firm's
  decision, 20 Oct 2026: "When DN is there in Books but [not] in 2B then it is
  not required to give effect in books unless the opposite person gives effect
  in their books"). The books register's Type "Debit note (purchase return)" is
  the client's own debit note, the other side of the supplier's credit note. It
  is entered at plus amounts and has **no effect** until the supplier reports
  the credit note: Post to Reconciliation never posts it and takes back what it
  posted before (`bookIsPurchaseReturn`, `BOOK_DEBIT_NOTE_REASON`); once the
  credit note is in 2B its own row reduces ITC (row 5.3, or Not in Books until
  booked). It pairs only with 2B credit notes; the books totals and Purchase
  Rate Wise count it as a minus. A supplier's debit note (which adds ITC) is
  booked as a purchase: enter it as an Invoice; it pairs with the 2B debit note
  of exactly its number. Before, ORVIX's Sep-26 entry 2/CN/2026-27 re-entered
  at +360 CGST and SGST as a "Debit note" Not in 2B posted a +360 reversal: row
  5.1 came out 19,107.52 instead of 18,747.52 and 4B(2)(i) 360 instead of 0
  (net ITC 17,740.74 either way). Only that one books debit note existed live.
- **Rule 37A reversal rows and IMS rejected rows start Ineligible**, so they
  never reach 5.1 (before this change they defaulted to Matched; none existed
  live). A Rule 37A reversal is typed in 4B(2)(ii).
- **Matching is by kind**: a books invoice is paired only with a 2B invoice
  (or a supplier's debit note of exactly its number), a books debit note
  (purchase return) only with a 2B credit note. A similar-numbered document of
  another kind gives a warning, never a pairing.
- **Colours**: invoices plain, debit notes amber, credit notes rose,
  amendments violet, with a legend that filters.
- **Re-import merges.** A document is the same one when its type, amendment
  flag, supplier and normalised number (and amended number) agree. A matched
  row keeps its id, treatment, pairing and posting; a new one is inserted; a
  row missing from the file is deleted unless something depends on it (a
  reclaim, a Not in Books entry on the ledger, or a later amendment), in
  which case it is kept and named. Neither the posting stamp (Post stamps the
  whole month) nor a books pairing (the re-match turns that books row Not in
  2B) keeps a row, so a document that has left 2B stops counting. New rows
  are written first, so a failure never empties a month. A filed month is
  refused, except for the superadmin after a warning. One import runs at a
  time per client and month in a browser (Web Locks), since the portal pull's
  result reaches every open tab, and every write on the page (Save, Link &
  Reclaim, Post, Delete 2B, Enter counted, the books register, Zone 4) waits
  while one runs. Delete 2B, Post and Save also hold that lock while they
  write (taken after their confirm dialogs), so an import refuses while one
  of them runs and they refuse while an import runs; Post posts only the plan
  it confirmed, read again under the lock. The merge updates a kept row's
  figures and links by id (never an upsert) and not its treatment, books
  pairing or posting stamp, so a change made while it ran (in another
  session too) stays, and a row deleted meanwhile (Delete 2B in another
  browser) stays deleted and is named, rather than coming back Matched; a
  treatment the import itself changes is written only where the row still
  holds the one it read. A books treatment
  picked by hand against the matcher (Mismatched with no 2B document paired,
  or Not in 2B on a row still paired to one) is kept by the re-match and
  named, never rewritten.
- **Finding the earlier version.** Among the client's earlier months, or an
  original in the same file (a late filer's invoice and its amendment can sit
  in one 2B): an original of the amended type, number and date (when both
  dates are known, so a number reused after April is not taken), or an
  earlier amendment of the same document, matched within its family whatever
  its note type (an earlier amendment may have flipped it). A re-import counts
  an amendment against a different version when one is found now (imported
  since, out of order); an import names later months' amendments that were
  counted against an older version, to be re-imported.
- **What the base is.** The earlier version's figures, but zero when it
  counted nothing (Ineligible or ITC of Others): a revision that makes it
  eligible, the usual place of supply correction, claims in full. A revision
  the 2B marks ITC Availability No (or, for a credit note, IMS "no ITC to be
  reduced") starts Ineligible, and the import and the row name the earlier
  version's counted figures, which stay claimed in their month and are
  reversed by hand in 4B(2); when that version is parked Not in Books (never
  claimed) they name its ledger entry to clear instead. A version the portal
  had made ineligible (rejected in IMS, ITC Availability No, or IMS "no ITC
  to be reduced" on a credit note) and the revision makes available starts
  Matched, credit notes included. The base and treatment follow the earlier
  version's treatment as it stands: when staff re-treat it (Save, a books
  pairing that takes it out of Not in Books, a re-import's sheet move), the
  amendments counted against it take the base afresh and, where they still
  followed its old treatment, the new one, down a chain; a re-import does the
  same for an amendment whose base no longer fits. A filed month is not
  rewritten: those rows are named and their line warns.
- **Reverse charge flag changed.** A reverse charge version sat in RCM
  Summary, never in 5.1 / 5.3, so an amendment that drops the flag has a zero
  base and is Held for staff (the RCM claim of that month is undone by hand).
  An amendment into reverse charge goes to RCM Summary; the import names the
  5.1 / 5.3 claim of the version it amends, to be reversed by hand.
- **Partial reads.** A B2B-family sheet skipped whole, or with rows skipped,
  is named before importing. The month's credit notes count as read
  (`full_2b`, which lets row 5.3 fill itself) only when B2B-CDNR is in the
  file and neither credit note sheet lost a row.
- **Negative 4A(5).** When credit notes (row 5.3, or a negative row 5.2
  head) take a head of Total (5) below zero,
  GSTR-3B puts 0 in 4A(5) and the excess in 4B(2) Others (net ITC unchanged),
  and ITC Summary marks Total (5). For a Partial-ITC builder the carpet-area
  split then gives a negative 4B(1) in that head: GSTR-3B files it as 0 and
  takes it off 4B(2) Others (net ITC unchanged again).
- **Filed months are not rewritten**: 06 to 08/2026 were imported with
  invoices only and keep their typed 5.3. Missed debit notes go into a later
  return within the s.16(4) limit.
- **A note amendment that flips the type** (B2B-CDNRA: a credit note revised
  into a debit note, or the reverse) adds the base instead of subtracting it,
  and the whole change sits in the revised type's row: a credit note of 100
  revised into a debit note of 100 adds 200 to row 5.1 (the reduction undone
  and the debit note claimed), not 100 to 5.1 and minus 100 to 5.3. Net ITC is
  the same either way; one row keeps one treatment. Whether to add or subtract
  follows the earlier version's own type; where that differs from the type
  the 2B names as original (a chain already flipped), the base is stored
  negative. A debit note parked Not in Books and revised into a credit note
  stores a zero base: it was never claimed, so the credit note reduces in
  full and the parked entry stays on the ledger for staff to clear
  (`flipsNoteType`, `baseFrom` in `twobDocs.ts`).
- **Posting** (`postImport2B.ts`): an amendment marked Not in Books posts its
  difference (it may be negative); one whose difference is zero (a number or
  date correction) is not posted, and a ledger row it posted before is
  retracted, since a ₹0 row would sit in Pending items forever. A credit note
  marked Not in Books posts negative, its figures with their sign.
- **Totals throw on a read error**: `fetchImport2BEligibleTotal` and
  `fetchImport2BCreditNotes` page through every row and throw instead of
  returning zeros, so a failed read can never save a 5.1 or 5.3 of zero (ITC
  Summary shows an error toast and refuses Save until a load succeeds;
  GSTR-3B and its preview already catch errors from `fetchGstr3b`).


## §11. E-mailing the client its bills not in books (15 Oct 2026)

Import 2B's **Email bills not in books** button sends the selected client, for
the selected month, every document its suppliers reported in GSTR-2B that it
has not yet recorded in its books, as an Excel working paper attached to the
`bills_not_in_books` template (Reminders → Templates, "Lists to clients").
`src/lib/billsNotInBooksMail.ts` holds the logic.

- **The list** is the month's open Not in Books ledger rows
  (`bills_not_in_books` with no `book_entry_month`, which carry earlier months
  forward), plus this month's 2B documents marked Not in Books but not yet
  posted. Amounts are the ledger's, with their sign: a credit note parked Not
  in Books (§10, choice 3) is negative, and an amendment counts at its
  difference, so it can be negative too. The e-mail and the pop-up never
  show a negative credit (`creditWording`): with negative rows in the list it
  reads "₹X, less ₹Y on credit notes" (after the template's "input tax credit
  of") when every reduction is a credit note, "on amendments" when every one
  is an amendment, and "on credit notes, amendments and adjustments"
  otherwise: a carried "Credit / adjustment" row has no document behind it
  and may be a credit note parked in an earlier month. ", a net reduction of
  ₹Z" follows when the reductions outweigh the rest; a supplier's negative
  tax is in brackets. The GSTR-3B page and ITC Summary mark typed ITC head by
  head (`src/lib/itcHeads.ts`), so a 5.2 of IGST −800 against CGST/SGST +400
  is shown, with its heads. A ledger
  row that repeats a listed document (same supplier, number and figures, dated
  within a day) is sent once and named in the pop-up, so staff can clean the
  ledger. SWENI's ledger held 27 such pairs, carried from older months.
- **The working paper** follows the house style of the GSTR-9 papers (Arial 9,
  navy heads, `#,##0.00` with brackets, totals with a double rule, frozen
  head, filter, landscape print fitted to width, a "Your remarks" column for
  the client). It has two sheets: the documents, and a supplier summary.
- **The e-mail** goes through `email_outbox` (now with `cc_email` and
  `attachments`) and is sent at once by `send-gst-email`, which since version 5
  sends Graph file attachments, copies and several recipients. The pop-up fills
  the client's e-mail, takes a CC and a reply-by date (5 days ahead by
  default), and shows when it was last sent. The client's name drops the
  firm's own "NO ITC" / "PARTIAL ITC" marker in everything the client sees.
- Unsaved row actions block the send, as they block Post to Reconciliation.

## §12. Import 2B is for GSTR-2B only (15 Oct 2026)

The firm's decision: Import 2B carries only the GSTR-2B pull and import used for
the return. The GSTR-2A card that sat on it (an Excel import and portal pull into
`gstr2a_import_docs`) is gone, with its parser. Nothing read that table: the
GSTR-2A reports on the Reports Hub and the reply recipes read the portal's own
GSTR-2A pull (`gst_filed_returns`, return type GSTR2A), which is unchanged. The
table and its 118 rows are kept. The extension's `__gstkPull2A` bridge is left in
place, unused by the app.

## §13. Prior months: the simple rule (firm decision, 21 Oct 2026)

The firm asked for this after two cases. SORATH BUILDERS: 16 Not in 2B rows
were deleted in filed July 2026, and August still held their carried copies.
TAMNNA: an invoice was corrected in July, the later months kept the old one,
and Re-run carry forward then wiped a later month's reclaims.

The firm's words: changes in a prior month must reach every later month; only
a GST Manager or the superadmin may make them; they must not move the checks
that stop a GSTR-3B push; and nothing may change that moves the credit or the
Suspended closing balance. Only books entries may be added, edited or removed.

Migration `20261021100000_twob_prior_month_simple.sql`, app helper
`src/lib/twobPriorMonth.ts`, tests `supabase/tests/twob_simple/run.sh`.

**Which month is prior.** A month is prior when, for the client:

- its GSTR-3B is Filed; or
- a GSTR-3B (Q) is Filed for its quarter (Filing Status records it at the
  quarter end, so the quarter's three months are all prior); or
- any later month's GSTR-3B or GSTR-3B (Q) is Filed.

Unlocking the sheets does not open the month again. Every return ever marked
Filed is kept in `twob_ever_filed`. The screens never work this out
themselves: they read `twob_month_state(client, period)`, which also lists the
later months that hold Not in 2B or Not in Books rows.

A return marked Filed by mistake: once its status is changed back, a GST
Manager or the superadmin reopens it with the "Filed by mistake" button on
its Filing Status row, writing why (`twob_reopen_filed`). The record keeps who
and why. Filing Status says so whenever a GSTR-3B is moved away from Filed.

**Who may change what in a prior month.**

- Only a GST Manager or the superadmin, and only books entries: Not in 2B and
  Not in Books rows, and the Import 2B books register.
- Refused for everyone, the superadmin too: the 2B documents
  (`twob_import_docs`), the reversal, reclaim, Expense out, book entry and
  in-2B months, Clear Data, Restore, Import Excel, and 2B import or pull.
- An entry's date, supplier, number and GSTIN may always change. Removing it or
  changing its amounts is refused while the entry, or a later copy of it, holds
  a reclaim, an Expense out or a book entry. The message names the month. When
  that month is open, the decision can be undone there first: "Sep-26 has
  reclaimed this entry; undo that reclaim first." When it is filed, it cannot:
  "Aug-26 (filed) has booked this entry, so it cannot be removed or its
  amounts changed." A month column that does not read as a month is named as
  such: "Sep-26 holds a reclaim month that is not a month (2425788); clear it
  in Sep-26 first." (Live, 46 book entry months hold numbers.)
- Removing it or changing its amounts is also refused when a later copy sits
  in a month not yet filed whose own reversal it is (its reversal month is
  that later month): "Its reversal month is Sep-26, which is not filed yet;
  correct it in Sep-26." (4 rows of 10,037 on 21 Oct 2026.)
- An added entry takes the month itself as its reversal (in-2B) month, or
  none: "Jul 26" for July. Any other month is refused.
- An added entry the month already holds, or that a later month holds
  (carried, or as that month's own entry: a bill booked late), is not added
  anywhere, and the rest of the save or Post goes ahead. The preview names it:
  "Sep-26 already holds this entry on its Not in 2B list; it is not added
  again". So a later month never gets a second copy, and one such entry never
  stops a whole Post.
- A Not in Books entry posted from a 2B document (it has a `source_doc_id`)
  follows the filed 2B, not the books: it is neither added, changed nor
  removed in a prior month, through the door or on screen. "This Not in Books
  entry comes from a 2B document and follows the filed 2B, so it is neither
  changed nor removed in a filed month. Only books entries change in a filed
  month." Only Not in 2B entries, the books register and Not in Books entries
  typed without a 2B source change. Import 2B's Post in a prior month posts
  the books side only and names the Not in Books entries it leaves out.
- A date or amount that is not one (a cleared date cell, "12a") is refused in
  words: "An entry needs a date.", "12a is not an amount."
- One save names each entry once.
- A books register debit note is still never posted (§10). The register still
  takes no minus amounts.

This replaces §9 for these two screens: the superadmin no longer edits
everything in a filed month of Import 2B or 2B Reconciliation.

**One door.** Every permitted change goes through
`twob_prior_books_apply(p_actor_id, p_client_id, p_period, p_changes, p_dry_run)`:

- Each change is made in the month and on the carried copy of the entry in
  every later month. A copy is the same entry: the same GSTIN (or both blank
  and the same supplier name), number, date and amounts, and the same
  reversal month (Not in 2B) or in-2B month (Not in Books), "Jul 26" and
  "jul-2026" alike.
- The copies stop at the first later month that holds the same entry as its
  own entry (NAVRATNA: April 2026 bills typed into filed Dec-25 with reversal
  Apr 26, entered again in Apr-26 and carried on to Oct-26). That month and
  the months after it hold that entry and its copies, so they are left as
  they are, and their reclaims do not refuse the change. The preview says so:
  "Apr-26 holds this entry as its own entry, so Apr-26 and the months after
  it are left as they are."
- Twins (two identical entries) match one copy per later month on that key, a
  copy without its own decision first. If only a decided copy is left, a
  removal or amount change is refused; a change of date, supplier, number or
  GSTIN still goes through.
- The entries and their later copies are locked before they are checked, so a
  reclaim saved in a later month at the same moment is seen and refuses the
  removal; it is never deleted with it.
- An entry posted from Import 2B's books register keeps that row in step: a
  removed entry takes its books row with it (while that row would post it
  again, paired with a 2B document or not: a filed month's documents never
  pair again, and Post posts every Not in 2B invoice; 48 such paired rows
  live), and a corrected entry corrects the books row too. So the next Post
  neither adds a removed entry back nor undoes a correction. The preview says
  so.
- An added entry gets a carried copy in every later month up to the later of
  two months: the latest one that holds a carried list on that list, and the
  month after the client's latest filed month (the open month). A month in
  between gets one too, even when it holds no list yet. It never goes
  further. The preview names the months: "Each added entry is also added to
  Aug-26, Sep-26."
- It is one transaction: all of it or none of it.
- `p_dry_run` returns what it would change. The screens show that first:
  "Jul-26: 16 removed. Also changes Aug-26 (16), Sep-26 (16)." Nothing is
  saved until it is confirmed.

**The guard.** `twob_guard` on `bills_not_in_2b`, `bills_not_in_books`,
`books_register` and `twob_import_docs` refuses every other write to a prior
month with: "This month is filed. Only a GST Manager or the superadmin can
change its books entries, from Import 2B or 2B Reconciliation." Still allowed:

- the filing lock and Unlock sheets (a change of the lock columns only);
- a link cleared because the row it names was deleted (the key's ON DELETE SET
  NULL). Clearing a link by hand is refused: it would switch off the door's
  own checks;
- the rows of a client being deleted;
- the writes of this migration's own functions. They set `twob.write` with
  `set_config` while they run and put it back. PostgREST cannot set it, so
  the browser cannot. (No function stores the setting: the live project's
  `postgres` role is not a superuser and may not.)

In every month:

- moving a row to another month or another client is refused;
- deleting a carried entry that holds a decision made in its own month or
  later (a reclaim, Expense out or book entry whose month is that month or a
  later one) is refused: "OTHER SUPPLIER T-2: Aug-26 has reclaimed this entry;
  undo that reclaim first, then remove it." A page opened before this change
  still runs the old delete-and-copy carry and Re-run; this stops it wiping a
  reclaim (TAMNNA). A decision carried in from an earlier month (its month is
  earlier: 489 of the 491 decided carried Not in 2B rows of open months live)
  is deleted as before: the old copy brings it back from the month it was
  made in. Restore, Clear Data and 2B Reconciliation's Save of an open month
  undo those decisions first, as they mean to remove the entry (the Save asks
  first);
- adding a carried entry beside the same document's carried entry that holds
  a decision is refused: "OTHER SUPPLIER T-2: Sep-26 already holds this
  carried entry, with a reclaim, Expense out or book entry; it is not added
  again." When a page opened before this change carries the old way and its
  delete is refused, its add is refused too (checked once per statement;
  twins added together pass). An old page's Restore adds the month's own
  entries back, which this does not catch: it can still double an open month
  until the page is reloaded. That risk is accepted; everyone reloads after
  the deploy.

**The carry never wipes, and runs once.** When a month is filed (a status
change, a row added as Filed, a quarterly return, the extension's
mark-filed), each of its two lists is carried into the next month only:

- the first time (`twob_carry_log` records each month's carry per list; every
  month filed before this change counts as carried, since the old filing
  carried it then);
- only when the next month is not filed itself;
- only when the next month holds no carried rows on that list.

Otherwise nothing is carried. Filing again (after Unlock sheets, or the
extension sending Filed again) never carries anything, so an entry a later
month removed never comes back. Nothing ever carries by itself into a filed
month or past the next month (`twob_carry_first`, run by the filing trigger
only; the app no longer carries after filing).

A month filed after its next month (on live, Filed needs the ARN and the PDF,
so a month whose PDF comes late is often marked after the month that follows
it) carries nothing. Filing Status says so after filing, list by list, from
the carry record: "Not in 2B: not carried, because Aug-26 is filed already. If
the next month lacks entries of this month, a GST Manager or the superadmin
uses Re-run carry forward on this record: it shows what it adds first." The
same words name a list the next month already held ("not carried, because
Sep-26 already held carried entries on it") and a month carried before ("not
carried again"). An out-of-order filing is repaired only by Re-run.

**Re-run carry forward** (Filing Status) is for a GST Manager or the
superadmin only, and always shows a preview first (`twob_carry_rerun`, with
`p_dry_run`). It runs from a filed month into the month after it, one month
at a time. Per list it pairs the month's entries with the next month's rows,
twins one to one, and:

- adds the entries the next month lacks;
- does not add an entry the next month holds as its own entry ("Sep-26 holds
  this entry as its own entry; it is not added again");
- leaves alone an entry whose next-month copy is the same invoice at other
  amounts and holds a decision (TAMNNA's T-2: July at 600, August's copy at
  500 and reclaimed). Adding July's 600 beside it would let the invoice be
  reclaimed twice. The preview names both amounts and the reclaim to undo;
- leaves alone, the same way, an entry whose next-month copy holds a decision
  and has the same supplier and amounts under another number or date, or the
  same number, date and amounts under another supplier or GSTIN (corrected
  there to what 2B shows, then reclaimed).

Into an open next month (the latest filed month's; refused while a month
after it holds carried entries) it also removes carried copies of entries the
month no longer holds, keeps those holding a reclaim, Expense out or book
entry and says so, and replaces an undecided copy at other amounts.

Into a filed next month (the repair of an out-of-order filing) it only adds:
it removes and replaces nothing there, names the copies the month no longer
holds as left, and names a copy at other amounts as a conflict to correct
through the door. The next month's figures are recorded first
(`twob_filed_figures`), so no check moves except the Suspended Reco books
side. Then the GST Manager re-runs that month into the next, and so on up to
the open month: "Then re-run Aug-26 to carry them on into Sep-26."

This replaces the delete-and-copy of §6 and §7, and the late filing carry of
round 2.

**One lock order.** Every writer of a client's 2B lists (the door, Re-run,
the carry, and marking a GSTR-3B Filed) takes the client's lock before it
locks any row, so two of them never wait on each other in turn.

**The push checks.** A permitted change never moves a filed month's saved
figures and never moves any check that stops a GSTR-3B push, except the books
side of Suspended Reco. Applying this change moves none of them either.

The 2B Reconciliation figures of a month (4B(2)(i), 5.4, 4D(1.2)) come from
its live Not in 2B list, as before, until the door first changes that month.
Just before that first change the door records them (`twob_filed_figures`,
summed as the app sums them, for the month and the later filed months the
call may write). From then on every check reads the recorded figures:

- Suspended Reco (page and push check, `computeSuspendedRecoDiff`);
- GST Receivable Reco of the next month (page and calculation);
- ITC Summary's auto-linked rows;
- the GSTR-3B page (`fetchGstr3b`, through `fetchItcAutoLinkTotals`).

The saved ITC Summary (`itc_summaries.data`) is not used for this: it changes
only on a manual Save and is stale for 47 of 822 locked summaries (TAMNNA
Sep-26: saved 5.4 is 0, the live and pushed 5.4 is 11,696.72 a head).
Reopening a return marked Filed by mistake drops the records of the months it
no longer keeps prior.

Every check that reads these figures fails closed: when they cannot be read
(the table missing before the migration is applied, a network error), the
GSTR-3B page blocks Push and says why (`src/lib/pushRecoGate.ts`), the
GSTR-3B draft is not built, and ITC Summary and Suspended Reco show the
reason and do not save until a reload reads them.

**The screens.**

- Import 2B: in a prior month a line says the month is filed. 2B import, pull
  and delete are off. Reclaim, Expense out, undo and book entry are off. In
  an open month they check that the entry is still there (a filed month's
  correction may have removed its copy since the page was opened): if not,
  nothing is saved, the page says so and reloads, and a 2B document never
  becomes Reclaim without its entry. A GST
  Manager or the superadmin can add, edit and delete books register rows and
  Post; each shows the preview and asks first. Everyone else sees the month
  read-only.
- 2B Reconciliation, Liberal client: a GST Manager or the superadmin can change
  the date, supplier, number, GSTIN and amounts, add entries and delete them.
  Save previews the later months first.
- 2B Reconciliation, Strict client: a GST Manager or the superadmin can delete
  entries; adding and correcting go through Import 2B. Import Excel and Restore
  are off in a prior month; Version history says why.
- 2B Reconciliation, prior month: a Not in Books entry from a 2B document is
  read-only for everyone and has no delete button; its empty delete cell says
  why.
- Restore (the superadmin, Version history) works only on the client's latest
  month that holds entries on either list, and is off elsewhere with the
  reason: "Restore works only on the latest month that holds entries
  (Oct-26)". It replaces the month's two lists in one call
  (`twob_restore_version`), which refuses the same months, so a refused
  Restore changes nothing.
- Import 2B, Post in a prior month: the books side only; the Not in Books
  entries from the month's 2B documents it would add, change or remove are
  named and left out.
- Clear Data clears only the year's open months and names the months it kept.
- 2B Reconciliation, Liberal client, prior month: a GST Manager or the
  superadmin corrects carried entries' date, supplier, number, GSTIN and
  amounts too, not only the month's own entries.
- 2B Reconciliation, open month: deleting a carried entry that holds a
  reclaim, Expense out or book entry asks first, then undoes it and deletes
  the entry in the same Save. The version history moves on only once every
  write of the Save went through.
- Filing Status: after filing, the words say list by list what was carried,
  read from the carry record. Re-run carry forward shows on a month recorded
  as filed, and shows what it adds, removes, keeps and leaves alone, and asks
  first; into a filed month it says it only adds. "Filed by mistake" shows on
  a GSTR-3B no longer Filed but still recorded as filed.
- GSTR-3B: a Suspended Reco or GST Receivable Reco check that cannot run
  blocks Push with its reason.

**Write paths, open and prior.**

| Path | Open month | Prior month |
|---|---|---|
| Import 2B: Excel import, portal pull, delete 2B, amendments | as before | refused |
| Import 2B: reclaim, Expense out, undo, book entry | as before; nothing saved when the entry is gone | refused |
| Import 2B: books register add, edit, treatment, type, delete | as before | GST Manager / superadmin, through the door |
| Import 2B: Post to Reconciliation | as before | GST Manager / superadmin, through the door; books side only, the Not in Books side from 2B documents named and left out |
| 2B Reconciliation: Save (Liberal) | as before; a deleted carried entry's decision is undone first, after a confirm | GST Manager / superadmin, through the door; months stay as filed |
| 2B Reconciliation: delete | as before | GST Manager / superadmin, through the door |
| 2B Reconciliation: Import Excel | as before | refused |
| 2B Reconciliation: Restore | the superadmin, the client's latest month holding entries only (`twob_restore_version`) | refused |
| Clear Data (2B Reconciliation) | as before | the month is kept |
| Filing Status: Filed (lock and first carry) | the first carry, once, into an open next month with no carried list | the same; never into a filed month, never again on a re-file |
| Filing Status / 2B Reconciliation: Unlock sheets | allowed | allowed; the month stays prior |
| Filing Status: Re-run carry forward | refused (file the month first) | GST Manager / superadmin, previewed, one month at a time: into the open next month adds, removes and keeps; into a filed next month adds only |
| Filing Status: Filed by mistake | not shown | GST Manager / superadmin, with a reason, once the status is not Filed |
| 2B Reconciliation: Clear Data | the month's carried decisions are undone first | refused; the month is kept |
| A page opened before this change: old carry, old Re-run, old Restore | its delete refused while a carried entry holds the month's own decision; a carried add refused beside a decided carried entry; an old Restore can still double the month until reloaded | refused |
| Extension: mark filed | as Filed above | as Filed above |
| Deleting a client | allowed | allowed |
| Any other direct write | allowed | refused by the guard |

**Live data at the time (21 Oct 2026).** SORATH BUILDERS: nothing to remove.
A delete-and-copy re-run on 20 Oct 2026 (09:46 UTC) already brought August and
September in line with July (75 Not in 2B rows each, every carried copy with a
July counterpart). The Re-run preview for Aug-26 shows 0 to add and 0 to
remove. July's books register still holds PERFECT INDUSTRIES 19/26-27 (Not in
2B, no longer linked); a July Post names it as already in July and posts the
rest. Delete that books row if it should not be there.

Of the 122 filed client-months with Import 2B rows, 16 had something a Post
would write (the app's own plan, run against the round-1 and round-2 doors,
21 Oct 2026). Once the Not in Books side is left out of a prior month's Post
and a books name with a stray space no longer plans an update, none of them
writes anything on its first Post:

- Their Not in Books side, from the month's 2B documents, is named and left
  out: NAVRATNA Sep-26 (52 to add), SHIVASHRAY Jul-26 (15), KWIKTEAM Sep-26
  (14), RAYWINGS Jul-26 (6) and Aug-26 (2), TISHA Sep-26 (5 to remove), POINT
  PACKERS Sep-26 (4), ELENZA CALLISTA Jul-26 (3), PRIDE DRUGS Jul-26 (3:
  MAHAVIR 347, RETAILEZ LKO1-622965, SHREE HARI 119), ABHIJEET RAMNIKBHAI
  SATANI Jul-26 (1), REVTI Aug-26 (1) and TAMNNA Jul-26 (1: JAY
  INFRASTRUCTURE 16/2026-27, held by September and October, booked Sep 26).
  If such an entry belongs on the list, add it in the open month.
- The Not in 2B updates were names with a stray space (PRIDE Sep-26 3, ELENZA
  ARISTA Jul-26 1, MICROCIRCUITS Aug-26 1, ELENZA CALLISTA Jul-26 4): no
  longer planned.
- SORATH Jul-26: PERFECT INDUSTRIES 19/26-27 is named as already in July
  (above).

Months that are prior but not yet Filed themselves (a later month was filed
first) carry nothing when they are filed: AMBER GUM Jun-26, GROWQ Apr-26,
NAVRATNA Dec-25 (4 April 2026 bills typed into it; April holds them as its
own), REVTI Jul-26 (11 Not in 2B, 67 Not in Books), SHIVON Jun-26 and SWENI
Nov-24 (6 Not in Books bills of Nov-2025) on 21 Oct 2026. Filing Status says
so when they are filed; Re-run brings their entries on where they belong. V J
DESAI & CO LLP Jun-26 is not one of these: June and July were filed in order,
and July's list was emptied by staff before July was filed. Filing June
again now carries nothing.
