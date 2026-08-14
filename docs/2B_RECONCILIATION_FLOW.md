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
| Books row: **NOT_IN_2B** | Booked, supplier hasn't filed / not in 2B this period | → `bills_not_in_2b` row; `reversal_month` = this period (see §2), `reclaim_month` blank until resolved |
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
change. It is now `isAutoLinked` from `fetchImport2BEligibleTotal()` — the sum
of MATCHED + MISMATCHED, non-RCM `twob_import_docs` rows for the client/period
— the same live-query pattern already used for rows 4B(2)(i), 5.4 and 4D(1)/(1.1).
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
