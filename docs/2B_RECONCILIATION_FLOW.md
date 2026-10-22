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
        │  every save writes through, in the database, in the same
        │  statement (no Post since 21 Oct 2026, §15)
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
`bills_not_in_books` live. Only the write path changed: what Import 2B puts
on that ledger has exactly one writer, by the rules of `planImport2BPost`
(`src/lib/postImport2B.ts`). Until 21 Oct 2026 that was Import 2B's "Post to
Reconciliation" button; since then it is the database itself, on every save
of Import 2B (`20261021170000_import2b_autopost.sql`, §15), so ITC Summary,
Suspended Reco, GST Receivable Reco, carry-forward, the e-mails and the
reports change as soon as a save is made.

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
the write-through never retracts them; when the Import 2B row they came from
next writes through, an identical one (same document key) is linked to it
instead of a second entry being added (§15, adoption), and from then on it
follows Import 2B. One that is not identical stays as it is, unlinked.

## §4. Existing already-imported batches are not retroactively posted

Shipping this didn't walk every historical `twob_import_docs` /
`books_register` row and push it into the ledger, and neither did the
write-through of 21 Oct 2026 (§15): a month classified before and never
posted, or changed after its last Post, is *out of step*. Import 2B says so
in a plain line on the month, and staff who may post bring it up to date
with **Bring the reconciliation up to date** (previewed first; the same
rules, idempotent, safe to re-run). Until 21 Oct 2026 this was a click on
Post to Reconciliation.

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
| Marking GSTR-3B **Filed** | `toast.error` on click | \|diff\| > ₹20 | `FilingStatusPage.tsx`, `handleStatusChange` (gone since 21 Oct 2026: Filed comes only from the portal pull, `docs/FILING_STATUS_PULL_ONLY.md`) |
| **Push to GST Portal** | Button `disabled`, hard-blocked | diff ≠ 0 | `Gstr3bPage.tsx`, `hasRecoDiff` |

*Since 21 Oct 2026 the push row is the database's `gstr3b_push_gate`, which
also needs both recos pulled and gates the JSON download and the extension's
push (§14). The waiver below carries over unchanged.*

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
  *Since 21 Oct 2026 the GST Managers override too, with a reason (§14).*

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
  red with the reason on the row, and the write-through (formerly Post to
  Reconciliation) skips it and takes back what it posted (`bookHasMinus`,
  `bookNotPostedReason`, `postImport2B.ts`; the database's plan gives the same
  reason, §15; a row posted before and left without a date or supplier says
  it is on the ledger as last saved, since that entry stays and still
  counts). Before, ORVIX's Sep-26 entry
  2/CN/2026-27 (−360 CGST and SGST, Not in 2B) went into the ledger as a
  minus reversal: row 5.1 came out 360 short of the matched invoices and
  4B(2) minus 360, which the portal refuses (the push check stopped it).
- **A books "Debit note" is the client's purchase return** (the firm's
  decision, 20 Oct 2026: "When DN is there in Books but [not] in 2B then it is
  not required to give effect in books unless the opposite person gives effect
  in their books"). The books register's Type "Debit note (purchase return)" is
  the client's own debit note, the other side of the supplier's credit note. It
  is entered at plus amounts and has **no effect** until the supplier reports
  the credit note: the write-through (formerly Post to Reconciliation) never
  posts it and takes back what it posted before (`bookIsPurchaseReturn`,
  `BOOK_DEBIT_NOTE_REASON`, shown on the row); once the
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
  which case it is kept and named. Neither the posting stamp (Post stamped the
  whole month; nothing stamps it now) nor a books pairing (the re-match turns that books row Not in
  2B) keeps a row, so a document that has left 2B stops counting. New rows
  are written first, so a failure never empties a month. A filed month is
  refused, except for the superadmin after a warning. One import runs at a
  time per client and month in a browser (Web Locks), since the portal pull's
  result reaches every open tab, and every write on the page (Save, Link &
  Reclaim, Bring the reconciliation up to date, Delete 2B, Enter counted,
  the books register, Zone 4) waits while one runs. Delete 2B, the catch-up
  and Save also hold that lock while they write (taken after their confirm
  dialogs), so an import refuses while one of them runs and they refuse
  while an import runs. Every one of these writes through in the database
  under the client's lock (§15), so two browsers never post one row twice.
  The merge updates a kept row's
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
- **Posting** (the write-through, by `planImport2BPost`'s rules): an amendment marked Not in Books posts its
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
- Unsaved row actions block the send (as they blocked Post to Reconciliation
  while it existed): what is sent is the saved ledger, and every save writes
  through to it at once (§15).

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
and why. Filing Status says so whenever a GSTR-3B is moved away from Filed
(from 20261021110000 only Unlock, a GST Manager's, and Take off Filed, the
superadmin's, do that: Filed itself comes only from the portal pull or an
attach the superadmin allowed, `docs/FILING_STATUS_PULL_ONLY.md`).

A return filed on the portal is never "Filed by mistake". Unlock leaves the
row's ARN and filing source (`filed_source`) on it, because the return is
still filed there, so the month stays prior: `twob_reopen_filed` refuses while
any row of the return (GSTR-3B or GSTR-3B (Q) for the period) is Filed, or
holds an ARN or a filing source ("Filed on the portal: ... still holds ARN
..."), and the row shows no "Filed by mistake" button. When the ARN really
belongs to another return, the superadmin's Take off Filed clears it first;
then a GST Manager can reopen the month. Reopen takes the client's lock before
it reads the rows, so a pull filing the month meanwhile is either seen and the
reopen refused, or runs after it and records the month as filed again.

Accepting a pull conflict (`filing_pull_conflict_decide`) takes the other
return holding the ARN off Filed, but its month stays recorded as filed here:
if that return is a GSTR-3B / GSTR-3B (Q) not filed on the portal, a GST
Manager reopens it with "Filed by mistake" on its row, then uses Re-run carry
forward on the accepted return's row (its carry was skipped while the other
month counted as filed). The Accept words on Filing Status say so, naming the
other return's month.

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
  anywhere, and the rest of the save goes ahead. The preview names it:
  "Sep-26 already holds this entry on its Not in 2B list; it is not added
  again". So a later month never gets a second copy, and one such entry never
  stops a whole save. The rows the same save removes or changes do not count
  as they were: an entry removed and added again in one save (the only way
  to give it this month's reversal month) is added, in this month and in the
  later months whose copies the removal took; an entry renamed away and a
  new entry under its old number are both kept; an entry changed in the same
  save counts with its new figures.
- A Not in Books entry posted from a 2B document (it has a `source_doc_id`)
  follows the filed 2B, not the books: it is neither added, changed nor
  removed in a prior month, through the door or on screen. "This Not in Books
  entry comes from a 2B document and follows the filed 2B, so it is neither
  changed nor removed in a filed month. Only books entries change in a filed
  month." Only Not in 2B entries, the books register and Not in Books entries
  typed without a 2B source change. Import 2B in a prior month writes the
  books side only (a books register save writes its Not in 2B entry through
  the door, §15); Bring the reconciliation up to date there names the Not in
  Books entries it leaves out in its confirm, and the page's standing line
  leaves that side out (nothing there can change it).
- A carried Not in Books copy follows a 2B document too when an earlier
  month holds the same invoice (GSTIN or supplier, number, date) as an entry
  from a 2B document (a copy does not carry the `source_doc_id`):
  `twob_nib_2b_copies` names such copies, and they are neither changed nor
  removed in a prior month: "This Not in Books entry is a copy of an entry
  from a 2B document and follows the filed 2B, so it is neither changed nor
  removed in a filed month." So the open month keeps waiting for its book
  entry. Every other carried Not in Books copy (of a typed entry, or whose
  entry is gone, as the chains that start mid-history) is a books entry and
  changes through the door, with its later copies. (Live on 21 Oct 2026:
  40,812 of 45,024 Not in Books rows are carried; 276 carried copies of 2B
  entries sat in prior months; 774 carried copies in prior months, 8 clients,
  had no entry upstream: SORATH 352.)
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
  every later month. A copy is a carried row of the same document: the same
  GSTIN (or both blank and the same supplier name), number, date and amounts.
- A later month's carried rows of a document stand for the rows of it the
  months before hold: this month's rows (own and carried) and the own entries
  of the months in between (NAVRATNA: April 2026 bills typed into filed
  Dec-25, entered again in Apr-26 and carried on to Oct-26). They are paired
  one to one, per later month: first on the same reversal month (Not in 2B)
  or in-2B month (Not in Books), "Jul 26" and "jul-2026" alike, then on the
  document alone (a copy whose in-2B or reversal month was filled in or
  cleared after the carry: SORATH's Apr-25 entries, blank, whose copies hold
  "Nov 24"). The months in between take theirs first, then this month's
  unchanged rows, then the changed ones. So a change reaches this entry's
  copies only, never a later month's own entry or that entry's copies, and
  their reclaims do not refuse it; when a month holds fewer copies than the
  rows they stand for, the unchanged rows keep theirs. The preview names a
  later month's own entry of the same invoice: "Apr-26 holds this entry as
  its own entry too; that entry and its copies stay as they are."
- Twins (two identical entries) are paired the same way, one copy per later
  month, a copy without its own decision first. If only a decided copy is
  left, a removal or amount change is refused; a change of date, supplier,
  number or GSTIN still goes through.
- The entries and their later copies are locked before they are checked, so a
  reclaim saved in a later month at the same moment is seen and refuses the
  removal; it is never deleted with it.
- An entry posted from Import 2B's books register keeps that row in step: a
  removed entry takes its books row with it (while that row would post it
  again, paired with a 2B document or not: a filed month's documents never
  pair again, and every Not in 2B invoice is posted; 48 such paired rows
  live), and a corrected entry corrects the books row too. So the next
  write-through of that row (Post until 21 Oct 2026, §15) neither adds a
  removed entry back nor undoes a correction. The preview says so.
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
only; the app no longer carries after filing). A list the month holds
nothing on has nothing to carry and is recorded as carried, whatever the
next month is: no warning, and the words say "nothing to carry".

A return marked Filed by mistake and reopened (`twob_reopen_filed`): its carry
record is marked not carried (`last_outcome` 'reopened', how it was carried
kept). Filed for real, the month carries nothing again by itself ('refiled'),
and a next month that holds the mistaken filing's list does not count as
carried ('next_held' stays a gap). Filing Status then marks the row: "not
carried again. Jul-26 was reopened as Filed by mistake after its entries were
carried into Aug-26, and filing it again carries nothing by itself, so Aug-26
may lack the entries added since." A Re-run brings them in.

A month filed after its next month (on live, Filed needs the ARN and the PDF,
so a month whose PDF comes late is often marked after the month that follows
it) carries nothing. Filing Status says so after filing, list by list, from
the carry record: "Not in 2B: not carried, because Aug-26 is filed already. If
the next month lacks entries of this month, a GST Manager or the superadmin
uses Re-run carry forward on this record: it shows what it adds first." When
the next month is not filed itself and only counts as filed because a later
month is, the record says `next_prior` and the words say so: "not carried,
because Aug-26 counts as filed: a later month is filed." The same words name
a list the next month already held ("not carried, because Sep-26 already held
carried entries on it") and a month carried before ("not carried again").

Filing Status also keeps a warning on the month's GSTR-3B row, from the carry
record (`twob_carry_log` rows with `carried_at` NULL), whichever way the month
was marked Filed: on the page, or by the extension's mark-filed when its PDF
came. It stays until a Re-run has run from that month, which is recorded
(`carried_how` and `last_outcome` 'rerun'); filing the month again after that
carries nothing. A Re-run with nothing to add (the next month holds every
entry already: AMBER GUM, GROWQ and SHIVON live) is still recorded when the
row carries the warning, so the warning goes. An out-of-order filing is
repaired only by Re-run.

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
  there to what 2B shows, then reclaimed). Same-supplier, same-amount
  entries (a monthly rent) pair with such copies first on the same number,
  then on the same date; when more entries than copies are left after that,
  every one of them is named and none is added, as any of them may be the
  corrected one (it never pairs by the order of the row ids).

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
the open month: "Then re-run Aug-26 to carry them on into Sep-26." The month
the entries were added to is marked in the carry record ('rerun_pending'), so
Filing Status warns on its row too ("Aug-26 holds entries Re-run carry
forward brought in after it was filed ... re-run Aug-26 to carry them on into
Sep-26") until its own Re-run; filing it again does not clear it. A next
month that only counts as filed (a later month is) has no Re-run of its own
on Filing Status until it is marked Filed itself, and the preview says so:
"Aug-26 counts as filed (a later month is filed): Re-run only adds ... Once
Aug-26 is marked Filed itself, re-run it to carry them on into Sep-26."

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
reason and do not save until a reload reads them. The push check fails
closed on every one of its reads, not only these figures: the previous
month's ITC Summary, filing status, RCM and Not in 2B list, the client, and
the month's own Suspended Reco and GST Receivable Reco rows. A read that
errors blocks Push with that read named, never a difference worked out from
zeros. Suspended Reco reads its month the same way (`readSuspendedRecoInputs`:
the Suspended Reco row, the Not in 2B list, the ITC Summary), refuses Save,
Upload, Not Applicable and Override while its figures are loading or any of
them could not be read, shows the read that failed, and starts each load
from zeros, so it never saves another client's or month's Current Total for
Filing Status to check. GST Receivable Reco shows 0 for 4C with the reason
when the previous month's figures could not be read, never the figures of
the client shown before.

**The screens.**

- Import 2B: in a prior month a line says the month is filed. 2B import, pull
  and delete are off. Reclaim, Expense out, undo and book entry are off. In
  an open month they check that the entry is still there (a filed month's
  correction may have removed its copy since the page was opened): if not,
  nothing is saved, the page says so and reloads, and a 2B document never
  becomes Reclaim without its entry. A GST
  Manager or the superadmin can add, edit and delete books register rows,
  each saved together with its Not in 2B entry through the door
  (`twob_import2b_prior_save`, §15), and bring a month out of step up to date
  (books side); each shows the preview, the ledger's changes and the later
  months included, and asks first. Everyone else sees the month read-only.
- 2B Reconciliation, Liberal client: a GST Manager or the superadmin can change
  the date, supplier, number, GSTIN and amounts, add entries and delete them.
  Save previews the later months first.
- 2B Reconciliation, Strict client: a GST Manager or the superadmin can delete
  entries; adding and correcting go through Import 2B. Import Excel and Restore
  are off in a prior month; Version history says why.
- 2B Reconciliation, prior month: a Not in Books entry from a 2B document,
  and a carried copy of one (`twob_nib_2b_copies`; every carried copy when
  that cannot be read), is read-only for everyone and has no delete button;
  its empty delete cell says why.
- Restore (the superadmin, Version history) works only on the client's latest
  month that holds entries on either list, and is off elsewhere with the
  reason: "Restore works only on the latest month that holds entries
  (Oct-26)". It replaces the month's own entries on both lists in one call
  (`twob_restore_version_linked` since 22 Oct 2026, §15: each entry Import 2B
  posted comes back linked to the books row or 2B document that posts it;
  `twob_restore_version` stays for a page of before), which refuses the same
  months, so a refused Restore changes nothing. The month's carried entries stay as they stand:
  a GST Manager's correction of a filed month reaches them and no version of
  this month records it, so a restore never brings back the SORATH copies a
  correction removed, nor drops a copy the door added. To undo a reclaim or
  book entry on a carried entry, undo it there. A version's own entry that
  the month now holds as a carried entry (typed here, then moved to the filed
  month it belongs to, whose correction carried it back in) is left out and
  named, so the month never holds it twice. A version that does not say
  which of its rows were carried is refused.
- Import 2B, Bring the reconciliation up to date in a prior month (Post until
  21 Oct 2026): the books side only; the Not in Books entries from the
  month's 2B documents it would add, change or remove are named and left out.
- Clear Data clears only the year's open months and names the months it kept.
- 2B Reconciliation, Liberal client, prior month: a GST Manager or the
  superadmin corrects carried entries' date, supplier, number, GSTIN and
  amounts too, not only the month's own entries.
- 2B Reconciliation, open month: deleting a carried entry that holds a
  reclaim, Expense out or book entry asks first, then undoes it and deletes
  the entry in the same Save. The version history moves on only once every
  write of the Save went through. Before it writes anything, the Save reads
  again the rows it updates or deletes: when one is gone, or its date,
  supplier, number, GSTIN or amounts differ from what the page loaded (a GST
  Manager's correction of a filed month reached this month's copy since),
  nothing is saved, the page names the entry and reloads. An update sends
  only the columns changed on the page, and only while the row still holds
  the loaded figures; so a page left open never puts back the old amounts
  of a corrected entry (TAMNNA again), nor reports saved when nothing was.
- Filing Status: after filing, the words say list by list what was carried,
  read from the carry record. A filed GSTR-3B row whose lists were never
  carried shows a warning with the same words until a Re-run from it, also
  when the extension marked it Filed. Re-run carry forward shows on a month
  recorded as filed, and shows what it adds, removes, keeps and leaves alone,
  and asks first; into a filed month it says it only adds. "Filed by
  mistake" shows on a GSTR-3B no longer Filed but still recorded as filed.
- GSTR-3B: a Suspended Reco or GST Receivable Reco check that cannot run
  blocks Push with its reason.

**Write paths, open and prior.**

| Path | Open month | Prior month |
|---|---|---|
| Import 2B: Excel import, portal pull, delete 2B, amendments | written through to the ledger in the same statement (§15); Delete 2B in one call (`twob_import2b_delete_2b`) | refused |
| Import 2B: reclaim | one call, entry and document together (`twob_import2b_reclaim`, §15); nothing saved when the entry is gone | refused |
| Import 2B: Expense out, undo, book entry, undo book entry | as before; nothing saved when the entry is gone; a decision a carried entry brought in from a filed month has no Undo, and the database refuses changing it (§15) | refused |
| Import 2B: books register add, edit, treatment, type, delete | written through (§15; a pairing in one call, `twob_import2b_save_book`); Import 2B & post, the delete Delete 2B rows | GST Manager / superadmin, through the door, with the row's Not in 2B write-through (`twob_import2b_prior_save`; an identical unlinked entry the month holds is linked, not added) |
| Import 2B: Bring the reconciliation up to date (Post to Reconciliation until 21 Oct 2026) | staff who may post, previewed (`twob_import2b_catch_up`) | GST Manager / superadmin, through the door; books side only, the Not in Books side from 2B documents named and left out |
| 2B Reconciliation: Save (Liberal) | as before, but only the columns changed, and nothing when a row changed elsewhere since the page loaded; a deleted carried entry's decision is undone first, after a confirm | GST Manager / superadmin, through the door; months stay as filed |
| 2B Reconciliation: delete | as before | GST Manager / superadmin, through the door |
| 2B Reconciliation: Import Excel | as before | refused |
| 2B Reconciliation: Restore | the superadmin, the client's latest month holding entries only (`twob_restore_version_linked`, entries back linked to their Import 2B rows, §15); its own entries only, its carried entries kept | refused |
| Clear Data (2B Reconciliation) | one call a month (`twob_clear_year`); Import 2B's entries written again at once (§15; the dialog says so) | the month is kept |
| Filing Status: Filed by the pull or an allowed attach (lock and first carry) | the first carry, once, into an open next month with no carried list | the same; never into a filed month, never again on a re-file |
| Filing Status / 2B Reconciliation: Unlock sheets | allowed | allowed; the month stays prior |
| Filing Status: Re-run carry forward | refused (file the month first) | GST Manager / superadmin, previewed, one month at a time: into the open next month adds, removes and keeps; into a filed next month adds only, and marks it to be re-run on; recorded even with nothing to add |
| Filing Status: Filed by mistake | not shown | GST Manager / superadmin, with a reason, once the status is not Filed; its carry record is marked not carried |
| 2B Reconciliation: Clear Data | the month's own carried decisions are undone first (one carried in from a filed month goes with its row) | refused; the month is kept |
| A page opened before this change: old carry, old Re-run, old Restore | its delete refused while a carried entry holds the month's own decision; a carried add refused beside a decided carried entry; an old Restore can still double the month until reloaded | refused |
| Extension: pull (`filing_record_pull`; markFiled is gone from 0.15.0) | as Filed above | as Filed above; when nothing was carried, Filing Status marks the row until a Re-run |
| Deleting a client | allowed | allowed |
| Any other direct write | allowed | refused by the guard |

**Live data at the time (21 Oct 2026).** SORATH BUILDERS: nothing to remove.
A delete-and-copy re-run on 20 Oct 2026 (09:46 UTC) already brought August and
September in line with July (75 Not in 2B rows each, every carried copy with a
July counterpart). The Re-run preview for Aug-26 shows 0 to add and 0 to
remove. July's books register still holds PERFECT INDUSTRIES 19/26-27 (Not in
2B, no longer linked); a July Post named it as already in July and posted the
rest (since §15, a books save in July does the same through the door). Delete
that books row if it should not be there.

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
Nov-24 (6 Not in Books bills of Nov-2025; Dec-24 has no GSTR-3B row, so it
only counts as filed) on 21 Oct 2026. Filing Status says so when they are
filed, by hand or by the extension, and marks their row; Re-run brings their
entries on where they belong. AMBER GUM, GROWQ and SHIVON's next months
already hold their entries: their Re-run has nothing to add and only clears
the warning. REVTI's goes into filed Aug-26, which Filing Status then marks
until it is re-run into Sep-26. Remove NAVRATNA's 4 April bills from Dec-25
through 2B Reconciliation before its Re-run. V J
DESAI & CO LLP Jun-26 is not one of these: June and July were filed in order,
and July's list was emptied by staff before July was filed. Filing June
again now carries nothing.
## §14. Recos pulled only; one GSTR-3B push gate (firm decision, 21 Oct 2026)

*Written as §13 on its branch; renumbered when merged with the prior-month
rule (§13), 21 Oct 2026.*

The firm's words: "In case of Nil return too, pulling of data of Suspended &
GST Receivable Reco directly from portal is required. Manual uploading of
credit ledger to be restricted. Unless pulling is done, pushing GSTR-3B to
portal to be banned." and "Unless there is [no] difference in Suspended & GST
Receivable Reco, 3B should not be pushed, except superadmin/GST Manager
overrides the opening balance." With them: when a pull cannot be done, the
superadmin may allow a manual entry for that one client, month and reco, with
a reason, and everything must be traceable. Migration
`20261021120000_reco_pull_push_gate.sql`, extension 0.16.0.

**Where the portal side comes from (from the Jun-2026 period).**

| Figure | Source | Who | Refused otherwise |
|---|---|---|---|
| Opening (both recos), ITC utilised and DRC-03 (GST Receivable Reco) | The extension's Pull, through `reco_record_pull` | A staff member, named by the app (`opening_portal_pulled_by`, server time); a pull nobody can be named for is refused | `reco_source_guard`: a direct write, the old Upload / Not Applicable, or a Save that changes them |
| The same, when a pull cannot be done | CSV upload or Not Applicable, through `reco_manual_opening` | Any staff member, once, after the superadmin allowed it (`manual_source_allowances`, scope `reco:suspended` / `reco:receivable`), and only while the month is not pulled | Without an unused, unrevoked allowance; over a pulled month |
| Opening override | The Override button, through `reco_override_opening` | The superadmin and GST Managers (who acts is checked there), with a reason of at least 5 characters; from 06/2026 only over a pulled (or allowed manual) opening | Employees; no reason; any direct write of the override fields (`opening_override_guard`, every period) |
| Clear Data (Suspended Reco) | `reco_clear` | Staff; the log names who cleared | A direct delete still works but is logged with nobody named |
| Books closing (GST Receivable Reco), the current-total snapshot (Suspended Reco) | Typed / computed, Save | Staff, as before | — |

- A reco row stays with its client and month: an update that changes either
  is refused, for every period (a row moved from an old month, or between
  months or clients, would carry a pull, an override or a cleared difference
  with it).
- A pull clears the CSV stamps and the allowance link, and closes the
  month's live manual allowance, used or not: it is revoked, with the puller
  as `revoked_by` (logged: "The manual entry allowed for the month (used /
  not used) was closed by this pull."). So the shared table tells "closed by
  a pull" (revoked) from "used for a manual entry" (used, not revoked), and
  a pulled month never shows "manual (allowed by ...)". It keeps
  an override made against the same portal figure (`opening_override_base`,
  the figure the first override replaced), and clears one made against
  another figure; the log says which ("Override by X kept / cleared"). So
  Pull on GST Receivable Reco, which pulls both ledgers, no longer wipes a
  Suspended Reco override when the portal has not moved. An override made
  before the migration has no base: its figure is unknown, not different, so
  the first pull keeps it and takes the pulled figure as its base ("kept (no
  base was recorded; base set from this pull)"); a re-override of such a row
  leaves the base empty for that pull to set. Live, 8 Suspended Reco
  overrides are of this kind. Before 0.16.0 a re-pull wrote the pulled figure
  over an override and left its stamps: an override with no base whose last
  pull is later than the override (`reco_override_superseded`) no longer
  applies, so the next pull clears it ("cleared: a later pull had already
  replaced it") instead of keeping it under the new figure, and a re-override
  of such a row takes the pulled opening as its base (round 3 of the review).
  Live, 2 rows: NAVRATNA S G HIGHWAY 06/2026 and SORATH BUILDERS 08/2026,
  both Filed; they keep the "Overridden" label until they are pulled again.
- The pull saves only for the client the portal page shows: both ledger
  steps check the page header's GSTIN first, as the push does (0.16.0), and
  stop with nothing saved when it is another client's.
- **A month with no balance on the portal.** When the reversal statement loads
  for the month but has no balance row and the page says there are no
  records, the pull saves 0, marked "no balance on the portal"
  (`opening_portal_empty`). A Nil client passes by pulling; no allowance is
  needed. Without such words on the page nothing is saved. The portal's exact
  wording for an empty month is not confirmed live yet.
- The popup's full sync has no app user, so it reads the two ledgers but does
  not save them: Pull on a reco page does.
- The pages show where the opening came from: **Pulled from portal \<date\> by
  \<name\>** (", no balance on the portal" for an empty month), **Manual
  (allowed by X: reason)**, **Manual entry revoked**, or **Not pulled** (also
  "CSV, not allowed" for an upload made before this change). The (i) popover
  lists the history from `reco_opening_log` (pull with the extension version,
  manual entry, override, insert, clear; who, when, why). Who is the person
  the door checked (the pull, manual entry, override and Clear Data doors);
  a direct delete names nobody, and a client's deletion is logged as
  "Client deleted". The log has no foreign key to clients, so it outlives a
  deleted client. It is written by a trigger and only read by the app.
- Upload and Not Applicable are shown only while an unused allowance is open
  and the month is not pulled. The superadmin allows or revokes it on the
  reco page itself ("Allow manual entry", reason required); the control is
  not shown over a pulled month, and it reads "manual (allowed by X:
  reason)" only for the allowance the opening shown was entered under. A
  revoked allowance makes the entry count as not pulled again, and the page
  says "Manual entry revoked". One live allowance per client, month and
  scope; an allowance counts only for its own client, month and reco.
- On GST Receivable Reco, Override, Upload and Not Applicable are refused
  while a books closing is typed but not saved ("Save your changes first"):
  they reload the row and would drop it. The gate note then says it has not
  checked the figures typed ("Based on the saved figures. Save to check
  again.") instead of "ready".
- The Excel exports of both recos have an "Opening source" line under the
  opening (pulled by, manual allowed by X with the reason, overridden by Y
  with the reason), and the Credit Ledger reports (all clients, one client
  by month) have an Opening Source column.
- `manual_source_allowances` and `manual_source_allow` / `_revoke` / `_take`
  are byte for byte the filing branch's (20261021110000);
  `supabase/tests/reco_gate/shared_block.sh` compares them and applies the two
  migrations in both orders.
- DRC-03 is no longer typed on GST Receivable Reco: it is the ledger's.
- **ITC utilised, a change of figure.** A pulled (or allowed) GST Receivable
  Reco takes ITC utilised from the credit ledger, and a pull that saw no
  "other than reverse charge" set-off debit means 0: that is the portal's
  figure (the client paid in cash, or had nothing to pay). Before, the page
  put its GSTR-1 estimate there. The estimate is shown only on a row not yet
  pulled ("Estimate, not pulled"). 0.16.0 saves 0 when ledger rows were read
  without a set-off debit, and nothing when no row was read.
  Rows already on file move at the app deploy: a pulled row whose utilised
  figures are empty (what 0.14.0 wrote for a pull that saw no set-off debit)
  read the GSTR-1 estimate before and reads 0 now, so its difference and the
  gate change (on a copy of the live rows, 32 of 34 such rows, e.g. 06/2026
  ₹18,125.14 became ₹19,925.14). The 20261021120000 header counts them
  before the apply (step 1); staff are told at the release, and a 09/2026
  GSTR-3B still to be pushed has its GST Receivable Reco pulled again with
  0.17.0 before the gate is relied on.
- Periods before 06/2026 keep the typed opening, as before.

**The gate.** `gstr3b_push_gate(client, period)` decides for the GSTR-3B
page's push, its JSON download (which can be uploaded to the portal by hand)
and the extension, which asks it again before it opens the portal. All three
therefore agree. It passes only when:

1. Suspended Reco is pulled, or allowed manual, and its difference is 0 under
   every head and in total, after the ₹10 tolerance per head (Builder +
   NO_ITC: the difference is waived as in §8; the pull is still needed, and
   the same Pull run fetches both ledgers);
2. GST Receivable Reco is pulled, or allowed manual, and its difference is 0
   under every head and in total, after the ₹10 tolerance.

Heads that offset do not pass (round 2 of the review): IGST ₹1,000 on the
portal against CGST ₹500 + SGST ₹500 in the books totals 0 but puts the
credit under the wrong head. The reason then names each head ("has a
difference under IGST ₹1000.00, CGST ₹-500.00, SGST ₹-500.00 (total ₹0.00).
Each head must tally, not only the total."), and the reco pages say
"Differs" ("Heads differ: each must tally"). The same per-head rule applies
before 06/2026 (no tolerance there).

Nil returns are not exempt. A missing row blocks. An override by the
superadmin or a GST Manager is how a difference in the opening is cleared;
it is not a bypass. The gate fails closed: an error inside it, an error
calling it, an empty or malformed answer, or the page still loading it, all
block, with the reason. Before 06/2026 it checks only the Suspended Reco
difference, with no tolerance, as the page did; there the GSTR-3B page names
the opening's source plainly (typed, CSV, Not Applicable), not as "not
pulled".

**A recorded push carries the database's own check.** When a Push History row
is written (`gstr3b_push_versions`, by the extension or the page), a trigger
asks `gstr3b_push_gate` itself and stores that answer in `gate`, in place of
what was sent (whether the sender said it passed is kept as `gate.sent_ok`).
An `ok` row whose gate does not pass is still recorded, because the portal
has the draft, but it does not mark the return Pushed, and Push History shows
it as "Reco check failed: not marked Pushed" with the reasons. This covers an
extension older than 0.16.0, which pushes without asking, and a forged row.
The gate, client and month of a recorded push never change afterwards.
`mark_filing_pushed`, the other way into Pushed (the GSTR-1 page and the
extension's GSTR-1 NIL push), refuses a GSTR-3B or GSTR-3B (Q) whose gate
does not pass, with the reasons (round 3 of the review); no page calls it for
a GSTR-3B. Filing Status shows such a return as not Pushed; it does not yet show the
flag itself (the page is being reworked on the filing branch).
"Ready" on the pages says what it rests on, per reco: pulled, an allowed
manual entry, a waived Builder difference, or no pull needed before
Jun 2026; the reco pages show only the answer for the client on screen.

**The GSTR-3B page keeps everything with its client and month** (round 3 of
the review, `src/lib/gstr3bSelection.ts`). The draft, the gate answer and the
filing status are each kept with the client and month they were loaded for
and shown only while that pair is selected: a switch clears them and loads
the new pair's, and an answer that comes back after a switch is dropped. The
JSON download and the push take the draft, client and month of the click,
check that the draft's GSTIN and return period are that client's and month's,
ask the gate for that pair, and stop ("... was stopped: the client or month
changed. Nothing was sent.") if another pair is selected by the time the
checks and confirmations end. Both buttons are locked while the draft
builds, and the push until that return's filing status is read. Before, a
draft still building for the client selected before could be downloaded or
pushed under the new client's passing gate (another client's figures typed
into this client's portal form), and a late gate answer from a JSON or Push
click showed "ready" for the client selected since. The GSTR-3B preview
dialog (`Gstr3bPreviewDialog`, unused today) keeps its draft the same way.

The differences are `suspended_reco_difference` and
`gst_receivable_reco_difference`, ports of `src/lib/suspendedRecoCalc.ts`
and `src/lib/gstReceivableRecoCalc.ts`. `supabase/tests/reco_gate/parity.mjs`
runs both on the same rows (12 of 12 agree, and on a copy of the live 09/2026
and 10/2026 rows). **A change to either formula must be made in both.**

**Filing Status.** It no longer marks a GSTR-3B Filed by hand
(20261021110000, merged with this on 21 Oct 2026): Filed is recorded from the
portal pull, or an attach the superadmin allowed, as what the portal already
holds, so neither the old ₹20 Suspended Reco check (§8) nor the gate stands
there; the gate stands before the push and the JSON.

**With the prior-month rule (§13).** §13 makes the two differences read a
prior month's 4B(2)(i), 5.4 and 4(D) 1.2 as recorded at its first change
after filing (`twob_filed_figures`), so a GST Manager's correction of a filed
month moves only the Suspended Reco books side; and it makes every read of
the push check fail closed. Merged (21 Oct 2026): the database's ports
(`suspended_reco_difference`, `gst_receivable_reco_difference`) read those
recorded figures too (the month's own for Suspended Reco, M-1's for GST
Receivable Reco), exactly as `src/lib/suspendedRecoCalc.ts` and
`src/lib/gstReceivableRecoCalc.ts` do, and `parity.mjs` has a client with
recorded figures. The GSTR-3B page asks only `gstr3b_push_gate`, which fails
closed on any error; `src/lib/pushRecoGate.ts` stays as the TypeScript
mirror §13's tests run. Without 20261021100000 there are no recorded figures
and the ports read the live lists, as this section's own branch did.

**Still open.** The empty-month rule above relies on the
portal's "no records" words: confirm them on one Nil client after the
release (the extension's diagnostic box shows what it read).

## §15. No Post: every Import 2B save writes through (firm decision, 21 Oct 2026)

The firm: "No need of Post to Reconciliation in Import 2B tab, as updation
itself would automatically change the next report wherever required."

Import 2B has no **Post to Reconciliation** button any more. Every save on
the tab changes the 2B Reconciliation ledger (`bills_not_in_2b` /
`bills_not_in_books`) in the database, in the same transaction as the save:
the save and its ledger rows are kept together or not at all. ITC Summary
(rows 5.1, 5.4, 4B(2)(i), 4D), Suspended Reco, GST Receivable Reco,
carry-forward, the e-mailed list (§11) and the reports still read the
ledger, unchanged, so they change as soon as the save is made.
Migration `20261021170000_import2b_autopost.sql`; page `Import2BTab.tsx`
with `src/lib/import2bAutopost.ts` and `src/lib/twobPendingWrites.ts`.

**What writes through (an open month).** Triggers on `books_register` and
`twob_import_docs` re-plan the rows a statement touched and write the ledger
before the statement ends; a save that writes more than one row is one call:

| Save on Import 2B | What the ledger does |
|---|---|
| Books register: add, edit, Type, treatment | the row's Not in 2B entry is added, changed or taken back |
| Books register: a cell that pairs or unpairs the row with a 2B document (the Doc no. / GSTIN / amounts, the Type, a re-import's re-match) | one call, `twob_import2b_save_book`: the document it leaves released, the one it pairs with paired, the row saved, with their entries, or none of it |
| Books register: delete | its entry is taken back, unless filed (locked) or holding a reclaim, Expense out or book entry (then it stays, unlinked, as the delete always left it; the page says so first); an own entry it was linked to instead of adding one goes back to what it held and stays, unlinked |
| 2B documents: Save of treatments (one, bulk), Enter counted | the document's Not in Books entry is added, changed or taken back |
| Reclaim (from a document or from Pending items) | one call, `twob_import2b_reclaim`: the entry reclaimed and the document Reclaim (its Not in Books entry taken back), or neither |
| A document taken out of Reclaim (Save of a staged treatment) | one call, `twob_import2b_unreclaim` (since 22 Oct 2026): the entry back in Awaiting reclaim and the document's new treatment saved with its write-through, or neither (before, two calls: a failure between them left the reclaim undone and the document counted nowhere); only while the document is Reclaim and evidences the reclaim the page shows on its row, or none when it shows none (round 7), else nothing is written and the document is named as changed elsewhere |
| Import / re-import / portal pull (each of its writes) | new Not in Books documents post; changed figures follow; a document the merge deletes takes back its entry; a row whose figures or treatment the write-through refuses keeps them and is named, and the rest of the file is imported |
| Delete 2B | one call, `twob_import2b_delete_2b` (permission Delete 2B rows): the reclaims the documents made are released, their Not in Books entries deleted (an own entry a document was linked to goes back to what it held and stays), then the documents; a filed (locked) entry and its document are kept and counted |
| Clear Data (2B Reconciliation) | `twob_clear_year`, one call a month: the open month cleared, then Import 2B's entries written again at once (Import 2B still holds the rows; the dialog says so before CLEAR is typed); filed months kept |

**The rules are Post's, unchanged** (`planImport2BPost` in
`src/lib/postImport2B.ts`; `twob__autopost_plan` is the same plan in SQL,
tested row for row against it on the same data): only Not in 2B books
invoices and Not in Books 2B documents post; a books debit note (purchase
return) and a minus row never post and take back what they posted; a row
without a date or a supplier is not posted and keeps what it posted; a HELD
amendment never posts; an amendment that changes no figure does not post and
takes back what it posted; a Not in Books credit note posts negative; an
update writes the date, supplier, number, GSTIN and amounts only, never a
reversal, reclaim, Expense out, book entry or in-2B month; a new entry takes
the month as its reversal (in-2B) month; an amendment's difference is
rounded to the paisa as JavaScript's `Math.round` rounds it (half up, so
-0.005 is 0.00), so a figure typed with a third decimal plans the same in
both. A row left off the ledger says why on the row ("Not on the ledger:
missing date"; the debit note and minus reasons as in §10), from
`bookNotPostedReason` / `docNotPostedReason`, which the database's plan
repeats word for word; a books row posted before and since left without a
date or supplier says "On the ledger as last saved (SUPPLIER, date, ₹tax):
missing date; it follows once given", since its entry stays and is still
reversed; a Not in Books 2B document posted before and since re-imported
without a date or supplier says the same ("On the 2B Reconciliation ledger
as last saved (...): missing date (the 2B file gives none); it follows once
given"; round 2), never "Not on the ledger" while its entry is there.

**Where it differs from Post** (so nothing is lost or doubled silently now
that no one reviews a Post dialog):

- A save that would take back an entry holding a reclaim, an Expense out or a
  book entry is refused, names it and says where to undo it ("Not saved: this
  change would take an entry off the 2B Reconciliation ledger that holds a
  reclaim, Expense out or book entry. KAVERI TRADERS K/101: Jul-26 has
  expensed out this entry; undo that first. Undo it on Import 2B, then save
  again: an Expense out under Pending items, Expensed out (Undo)."). Post
  deleted the entry with its decision. Every such decision can be undone on
  Import 2B: Expensed out (Undo), **Booked** (Undo book entry: the month's
  booked Not in Books entries are listed under Pending items since 21 Oct
  2026, so a Strict client's book entry no longer needs the superadmin on 2B
  Reconciliation), and a reclaim by changing the treatment of the 2B
  document that reclaims it.
- An entry to add that the month already holds as its own, unlinked, not
  carried, identical (the document key: GSTIN or supplier, number, date and
  amounts) **and with this month as its reversal month** (Not in 2B) or
  in-2B month (Not in Books), as the entry Post adds carries, is linked
  instead of added twice, one to one (rows typed on 2B Reconciliation, or
  put back by Restore, §3). Post added a twin beside it, so the month
  reversed the bill twice in 4B(2)(i). An own entry with a blank or another
  month's reversal month is a different entry for every report (4B(2)(i)
  counts only this month's): the add goes beside it, exactly as Post's did
  (verification round 2). What a linked entry held is kept on it
  (`adopted_from`); when its row stops posting (another treatment, a debit
  note, deleted, Delete 2B), it goes back to what it held and is unlinked,
  never removed, its decision kept: the ledger then ends where Post's twin,
  added and taken back, left it (`autopost.test.mjs` 10). In a filed month
  too: the door would leave such an entry out as "already held" and the
  month would stay out of step for good (SORATH BUILDERS 07/2026), so
  `twob_import2b_prior_save` links it (a link moves no figure; the preview
  says "already on the ledger, to be linked to its books row"), and a books
  row deleted or no longer posting there puts it back the same way, through
  the door ("of the ledger's own, to be put back as it was and unlinked (not
  removed)"). A filed month's own entry with a blank or another month stays
  apart; the door holds the add beside it ("Not added, already held"), and
  that month's line stays until the firm decides which of the two is the
  entry.
- A book entry or Expense out a carried entry brought into an open month from
  a filed month stays as filed (verification round 2): Import 2B's Pending
  items list it under Booked / Expensed out without Undo ("Booked in Aug-26
  (filed): stays"), and the database refuses changing it on any screen
  ("NIB SUPPLIER N-1: Aug-26 (filed) booked this entry. A filed month's
  decision stays as filed, and this month's carried copy keeps it. Nothing
  was saved.", `twob__carried_decision_guard`). The filed month still holds
  it and its reports counted it; undone on the copy alone, the entry would
  come back into the month's Awaiting book entry, the e-mailed list (§11)
  and the next carry. A decision of the month itself (or a later one), or one
  whose month was reopened, changes as before; Clear Data and 2B
  Reconciliation's delete of such a carried row still go through (the row
  goes with its filed decision; the next carry copies it back).
- Nothing stamps the month as posted (`posted_at` is left as it was).
- A re-import keeps a document that has left 2B while it has a Not in Books
  entry on the ledger, whatever that entry holds, and lists it ("kept,
  because something depends on it ... change it if they have left 2B"), as
  Import 2B did before saves wrote through (verification round 3,
  `staleDocsToKeep` in `src/lib/twobReimport.ts`; rounds 1 and 2 had dropped
  such a document with its entry when the entry held no decision, so the
  ledger lost an entry with only "Removed 1 document no longer in 2B" said).
  A reclaim's evidence and an amendment counted against it keep it too.

**Who may.** A save that changes the ledger is the **Import 2B & post**
permission's (`work_2b_import`; a GST Manager and the superadmin hold every
permission), as Post was: the reading taken here of "updation itself would
automatically change the next report" is that the person who may change the
reports is still the one who may post. Every other save stays open to every
staff level, as before this change (verification round 3; rounds 1 and 2
had locked the whole of Import 2B for an employee without the permission,
with a note saying every save changes the ledger, which was not so). The
page asks each save first what the database will decide
(`docChangeTouchesLedger`, `bookSaveTouchesLedger` in
`src/lib/import2bAutopost.ts`, checked against the database's own verdict
on the same saves in `round3.test.mjs`): a 2B document put into Not in Books
(when it posts: a date and supplier, and not an amendment that changes no
figure) or taken out of it (when it has an entry), or out of Reclaim; its
counted figures while Not in Books; a books row that is or becomes Not in
2B with a date and supplier (not a debit note, no minus amount), or one
already on the ledger; a books row deleted whose entry would leave the
ledger. Those are refused up front ("Not saved: this change would change
the 2B Reconciliation ledger, which needs the Import 2B & post
permission"), and a row whose every save would change the ledger is shown
read-only with the reason; the rest (a treatment between Matched,
Mismatched, Ineligible, ITC of Others and Held; Mismatched and Not
Eligible books rows, a row the matcher pairs with a 2B document included;
a Not in 2B row still without a date or supplier; a new blank row) saves as
before. The note on the page says which saves change the ledger
(`LEDGER_SAVES_NOTE`). The Pending items decisions (Link & Reclaim, Expense
out, book entry and their undo) and Delete 2B (Delete 2B rows) stay as they
were. The database refuses a save that would change the ledger when the
user the request names (`x-gst-actor`) lacks it, and nothing of the save is
kept; a save that changes nothing on the ledger goes through for any staff.
Since verification round 4: a books row's pairing (`twob_import2b_save_book`,
the call the page sends when the matcher pairs a row with a 2B document)
asks no permission itself; its write-throughs refuse, for the call's own
user (`p_actor_id`, `twob__acting_user`), only the part that would change
the ledger (pairing a Not in Books document that has an entry; a Not in 2B
row with a date and supplier), so an employee without the permission saves
a Mismatched row against a Matched document, as the direct writes of before
let them (round 3 had refused every such call, though the page and this
note said it saves). A books row or 2B document deleted so that its entry
leaves the ledger, or an own entry it was linked to is put back, is such a
save too (`twob__autopost_gone`, round 4; before, only the page asked). The
app names its user on every request (`changeLogFetch`), the app of before
this release too, so the check applies to it from the moment the migration
is applied (the header says to grant the permission first); a request
naming no user (a system writer) is not checked. If the firm prefers every
staff save to post, drop the checks in `twob__autopost_touch` and
`twob__autopost_gone` and the page's `mayPost` and rename the permission.

**Race-safe.** The client's lock (the one every writer of a client's 2B
lists takes: the door, the carry, Re-run, filing) is held while the plan is
read and written; the entries taken back are locked and read again first, so
a reclaim saved meanwhile refuses the save rather than being deleted; a
unique index allows one ledger row per books row and one per 2B document.
Two people saving the same month: the second waits and finds the first's
entry, so one row is posted once (`test_9b_autopost_race.sh`). A month
marked Filed while a save of it waits stops that save: "Not saved: Dec-26
was just marked filed. Reload the page." A save takes its row's lock and
then the client's (in its write-through); the reclaim and pairing calls take
theirs in that same order. The calls that take the client's lock first and
then the month's rows (Delete 2B, Clear Data, the catch-up) take those rows
without waiting: when a save of the month is running at that moment they
stop at once ("Nothing was changed: Sep-26 of this client is being saved by
someone else right now. Try again in a moment.") and the save goes through,
where before PostgreSQL broke the deadlock by aborting one of them
(`test_9e_autopost_locks.sh`).

**A prior month (§13).** The guard still refuses every direct write, and
the triggers post nothing there. A GST Manager or the superadmin saves a
books register row through `twob_import2b_prior_save`: the row and its Not
in 2B entry go through the door (`twob_prior_books_apply`), the later
months' carried copies included, in one transaction, after a preview that
shows the row, the ledger's change ("The 2B Reconciliation ledger follows:
Not in 2B 1 to change") and the later months, and asks first. The save
writes only what its preview showed (verification round 3): the dry run
returns the preview's digest (`twob__prior_digest`: every change the door
names, what happens to it here and in each later month, the figures of the
entries the save brings with it, without row ids), the save sends it back,
and the save, made under the client's lock, is digested the same way and
undone when the digest differs ("Nothing was saved: Jul-26 of this client
changed while the confirm was open ... Look at it again and save once
more"; a door refusal the preview did not have, such as a row removed
meanwhile, says the same with the door's reason). The door runs once for
the save (verification round 4): before, the save first made the preview a
second time under the lock, which ran the door three more times, and 1,000
books rows took 1.9 s (2.5 s with the change log), near the 3 s anon calls
run under; now about 1.0 s (1.3 s with the change log;
`test_9h_autopost_round4.sql` counts that no second preview is made). A
cell left without a change saves nothing. The Not in Books side follows the
filed 2B and is never posted in a prior month. Employees: read-only, as
before.

**A month out of step.** A month saved before this change (and never
posted, or changed after its last Post), or one whose entries were changed
on 2B Reconciliation since, reads as out of step: Import 2B shows a plain
line ("The 2B Reconciliation ledger is not in step with this month's Import
2B ...: Not in Books 6 to add."), read in one statement from the database
(`twob_import2b_step`, any staff: what a save or the catch-up would add,
link, change, take back or put back, counted as Post's plan counts it; one
snapshot, so a save of another user landing meanwhile is in it wholly or not
at all), and a read overtaken by a newer one (quick saves) never replaces
it (round 2; before, four separate reads could show a difference that was
not there). The line names each kind apart ("Not in 2B 1 to add, 1 to
link, 2 to change, 1 to remove, 1 to put back"; round 3: before, a link
read "to add" and a put-back "to remove", though a link adds nothing and a
put-back removes nothing). For staff who may
post (permission Import 2B & post), **Bring the reconciliation up to date**:
a preview of what it adds, links, changes, takes back and puts back, with
the rows it leaves out and why, those whose entry stays on the ledger as
last saved (a row without a date or supplier that posted before: still
counted) listed apart from those not on it (round 3; before, both read
"Not posted"), then the same rules applied (`twob_import2b_catch_up`);
afterwards the toast says what was done ("Not in 2B: 1 added."). It
writes only the plan its confirm showed (round 3): the preview returns the
plan's digest (`twob__autopost_digest`: every row's list, operation,
entry, source row, figures and reason), the apply sends it back, and the
database plans again under the client's lock and writes nothing when it
differs ("Nothing was changed: Sep-26 of this client changed while the
confirm was open ... Click Bring the reconciliation up to date again"), as
Post re-planned under the lock and posted nothing when the plan differed
(before, an entry corrected on 2B Reconciliation while the confirm was open
was changed back without the confirm saying so). A refusal names where to
undo. Nothing was posted by the migration. In a filed month only its Not in 2B side can be brought up to
date (GST Manager or superadmin, through the door, `twob_import2b_prior_save`
with `p_whole_month`); the line shows only that side (its Not in Books side
follows the filed 2B, which nothing on the page can change, so a line about
it could never go; the confirm names it). The map of 21 Oct 2026
(origin/main f9890f7) found 15 client-months out of step, 13 of them filed
(12 of those on the Not in Books side only); the migration header lists them
with a read-only query that gives the same list live.

**2B Reconciliation while Import 2B writes** (round 3). Every Import 2B save
now writes the ledger at once, so 2B Reconciliation hears of a change to its
month far more often than when only Post wrote it (`src/lib/twobLiveSync.ts`).
A change to another month or client is ignored (the page used to reload on
any row of the client). While the page holds unsaved edits or rows marked
for deletion, nothing is reloaded: a banner says "Someone changed this
month's ledger; reload to see it; your unsaved changes stay until you save
or discard", with Reload. Save then sends only the rows the user added,
changed or deleted, each guarded by the figures it loaded (the
`findChangedElsewhere` rule, a filed month's Save too), and when any of
them changed elsewhere it writes nothing and asks to reload ("This month
changed since you loaded it ... Reload / Keep my changes"); the version it
records is the month read back from the database. A reload or a Discard
clears the edits and the pending deletes together (before, a reload left the
pending deletes armed, so the next Save deleted a row the screen showed
again, an entry Import 2B posted or a reversal among them). A clean page
reloads once per burst of changes (an import writes many rows), with one
note. Import Excel (which reloads the month) is refused while edits are
unsaved.

Round 4 (verification of 22 Oct 2026):

- **Save guards every column a row holds**, not only its figures: its
  reversal, reclaim and in-2B months, its reclaim, Expense out and
  reclaiming document, its book entry, its Import 2B link and what a link
  kept (`checkRowsUnchanged`, `updateOpenMonthRow`, `deleteOpenMonthRows`
  in `src/lib/twobPendingWrites.ts`; the bookkeeping stamps aside). Guarded
  on the figures alone, a Save wrote a staged Expense out over a reclaim
  Import 2B recorded meanwhile (the document stayed Reclaim, its ITC in no
  row: 5.4 dropped to 0), and a pending delete removed an entry reclaimed
  meanwhile. Now the check before the Save names such a row and nothing is
  written ("This month changed since you loaded it ... Nothing was saved.
  Reload / Keep my changes"); each update and delete is also made only while
  the row holds all of it, so a change landing between the check and the
  write stops there too.
- **The Save decides from the rows read back**: the "Delete entries with a
  reclaim or book entry?" confirm and the decision a delete of a carried
  entry undoes come from the rows as the check read them, not the copies
  loaded.
- **A Save that stops before its first write keeps the edits** and pending
  deletes (with the banner when a row changed elsewhere; "Nothing was saved;
  your changes are still on the page"). Before, every failure reloaded the
  month, and the edits were lost though nothing had been written. A Save
  that stops after some rows were written still shows the month as it is
  now and says which rows stayed saved (`writeOpenMonthSave`,
  `OpenMonthSaveError.wrote`).
- **A change heard while the page saves is kept** and looked at again when
  the Save ends, against the month the Save reloaded: what the page does not
  show yet reloads it (or, with edits kept, raises the banner). Before, it
  was dropped, and the page went on without it. A change the page already
  shows as it is (its own Save, heard after its reload) is not news
  (`changeShown`); before, every change stamped by the same user was ignored
  for 5 s after a Save, from any tab.

**Import 2B keeps to the month it shows** (round 3). Every read and save
result is keyed to the (client, month) it was started for
(`src/lib/viewReads.ts`): a result for another one is dropped, and a refresh
started for a month no longer selected (a books save of Oct-26 finishing
after the switch to Sep-26) is not even counted, so it never overtakes the
selected month's load (before, it did, and Sep-26's page went on showing
Oct-26's Pending items with working buttons; Expense out then stamped
"Sep 26" on the Oct-26 entry, counted in no month's 4D(1.2)). Pending items
and the line show only for the month they were read for; their buttons act
only on it, and the database writes a pending decision only while the entry
is in that client and month (`updatePendingEntry`, scoped). A row added,
saved or deleted is shown only while its month is still selected; a reclaim
dialog or counted-figures dialog left open closes when the month changes.
Round 4: the reads are numbered with one count that never restarts, keeping
the latest read of each (client, month); before, the count restarted when a
month was shown again, so a refresh held from an earlier visit (Oct-26, then
Sep-26, then Oct-26 again) carried the same number as the later visit's and
landed over it, showing an entry expensed out meanwhile as awaiting reclaim,
with working buttons. And a Pending items decision is written only while
the entry still holds the decision the list showed (Expense out: no
reclaim month and no Expense out; its Undo: that Expense out with the month
shown; a book entry: none; its Undo: that book entry; as each list reads
it, round 5 below); otherwise nothing is written and the page reloads
("This entry was changed elsewhere since the page showed it ..."). Before,
Expense out from a list read before another tab's reclaim wrote over the
reclaim (the document stayed Reclaim, its ITC counted nowhere), and an Undo
would have cleared such a reclaim and left its document named.

**Round 5: the money rules are the database's** (verification of 22 Oct
2026). They hold whichever screen, tab or app version writes; the app's own
changes are small.

- **One reclaim per 2B document.** A reclaim (`twob_import2b_reclaim`)
  sends the treatment the page shows (`p_expect_action`); nothing is
  written when the document holds another one now (another user changed it,
  or reclaimed with it: "This 2B document was changed elsewhere since the
  page showed it: it is Reclaim now, not Matched") or is already the
  evidence of a reclaim ("... already the evidence of the reclaim of ...;
  one document evidences one reclaim"). Before, a tab not reloaded reclaimed
  a second entry with a document another user had just reclaimed with, and
  5.4 counted its ITC twice. For any other writer the rule is held by a
  trigger since round 6 (below); a unique index on
  `bills_not_in_2b(reclaimed_via_doc_id)` holds it a second time where the
  data allows: the migration creates it only when no document is named by
  two entries, and otherwise goes on without it and says which. On live it
  is not created (one filed July document is named by two reclaims, recorded
  before; its header lists it). A Restore of a version holding two reclaims
  on one document brings back the first; round 6 brings the other back in
  Awaiting reclaim (round 5 dropped only its link, and its reclaim still
  counted in 5.4).
- **A document stays Reclaim while an entry is reclaimed against it**, and
  is not deleted (`twob__reclaim_evidence_guard`): a change of its treatment
  or a delete is refused ("... is the evidence of the reclaim of ..., so it
  stays Reclaim"; "Not deleted: ..."), except through Import 2B's Save out
  of Reclaim (`twob_import2b_unreclaim`) and Delete 2B, which put the entry
  back in Awaiting reclaim first, in the same transaction. Before, a stale
  tab's Save made such a document Mismatched (its ITC in 5.1 and again
  through the reclaim in 5.4), and a re-import's delete of it left the
  reclaim counted with no document. Out of Reclaim refuses a document no
  longer Reclaim. The treatment Save writes each document only while it
  holds the treatment the page loaded (`saveDocTreatments`,
  `src/lib/import2bGuardedSaves.ts`); a document not written is named
  ("changed elsewhere since the page showed them ... so they were not
  saved") and the page shows the month as it is now. A client being deleted
  takes its documents and reclaims with it.
- **An entry names its reclaiming document only while it holds the
  reclaim** (`twob__reclaim_via_tidy`): a reclaim cleared, or made an
  Expense out (2B Reconciliation's Reclaim cell, Pending items, an app of
  before), lets its document go in the same write. Pending items' Expense
  out and its Undo are written while the entry is in the list as the list
  reads it (Awaiting reclaim: no reclaim month and no Expense out; Expensed
  out: that Expense out with the month shown) and clear the document in the
  same write; round 4 also asked for no reclaiming document, which the list
  does not, so an entry whose reclaim was cleared on 2B Reconciliation was
  refused on every try as "changed elsewhere".
- **A books row is saved only while it holds what the page loaded.** A
  cell, the Type or the Treatment sends only the columns changed
  (`bookChanges`), guarded by every column as loaded: the open month's write
  (`saveBookGuarded`), the pairing call (`twob_import2b_save_book`,
  `p_expect`) and a filed month's preview and save
  (`twob_import2b_prior_save`, `p_expect`; its digest covers only the time
  between the two, not a page already stale before the preview). A row
  changed elsewhere meanwhile is not saved: "Nothing was saved: books row
  ... was changed elsewhere since this page loaded it ... The row is shown
  again as it is now." Before, a stale tab's correction of one cell wrote its
  whole old row back: another user's Not Eligible became Not in 2B again
  (its reversal back on the ledger and in 4B(2)(i)), and a GST Manager's
  correction of a filed month was undone in that month and every later one.
  A save that lands shows the row as saved, unless the user typed in it
  meanwhile; a load begun before it shows it as saved too (before,
  switching month away and back during a save showed the old figures beside
  a Pending items entry with the new ones, and the next blur of an untouched
  cell wrote the old figures back). One page's saves of one row run one at a
  time since round 6 (below).
- **Lows.** 2B Reconciliation's own Save of a carried entry holding its own
  decision (the decision undone, then the row deleted) is no longer read as
  someone else's change: a row's change is read with its delete in the same
  burst (`changesShown`). A Save or Restore numbers its version from the
  database at that moment (`nextVersionNumber`), and a reload heard live
  reloads the version list (before, a second "Version 1" beside Import 2B's
  snapshot). The Import 2B & post description in Settings says which saves
  need it and that the others are open to all staff.

**Round 6: the reclaim's rules for every writer, and Restore held to them**
(verification of 22 Oct 2026).

- **An entry names a 2B document only while that document is Reclaim and
  no other entry names it**, whoever writes (`twob__reclaim_via_check`, the
  trigger `trg_twob_zz_reclaim_via_one` on `bills_not_in_2b`): a new naming
  of a document that is Matched, Mismatched, Ineligible or any other
  treatment is refused ("Not saved: the 2B document ... is Matched on Import
  2B, not Reclaim ..."), and so is a second naming of one document ("... is
  already the evidence of the reclaim of ...; one document evidences one
  reclaim"). The document's row and its own lock are held while it checks,
  so two tabs naming one document at once, or a document taken out of
  Reclaim while a tab names it, are seen by whichever comes second. It holds
  without the unique index, as live stands: before, a tab of the app of
  before left open (or any direct write) still reclaimed a second entry
  with one document on live, where the index could not be made. An entry
  that already names its document keeps it (only a new naming is checked),
  so the filed July pair recorded before stays as filed: Jul-26 is a filed
  month, so nothing in the app changes it, and correcting that record
  is the firm's decision (a reviewed one-off SQL; the migration header,
  step 1). Import 2B's reclaim (`twob_import2b_reclaim`) makes the document
  Reclaim, then names it, in one call. **The app of before's Reclaim names
  the document before making it Reclaim, two requests, so it is refused from
  the moment the migration is applied until its tab is reloaded into this
  app**; deploy the app straight after applying.
- **A document named by a reclaim recorded before while it was not Reclaim**
  (live has one, in a filed month) can only be made Reclaim again: any other
  treatment would count its ITC beside the reclaim, or not at all.
- **Restore brings a version's reclaim back only while its document is in
  the month, is Reclaim now, and evidences no other reclaim** (an entry the
  month keeps, or the version's first one naming it). Otherwise the entry
  comes back in Awaiting reclaim and the Restore names it with why ("its 2B
  document is Matched now, not Reclaim", "... is no longer in this month",
  "... already evidences the reclaim of ...": `reclaims_back`, said by the
  page after the Restore). Before, a Restore of a version taken while an
  entry was reclaimed, after the document had been taken out of Reclaim,
  brought the reclaim back against a Matched document: its ITC counted in
  5.1 and again in 5.4, and Pending items no longer listed the entry, so
  only another Restore undid it. A reclaim the version holds without naming
  a document is held to the same terms against the month's original invoice
  or debit note of the same document since round 7 (below); only one with no
  such document in the month comes back as the version holds it.
- **One page's saves of one books row run one at a time** (`queueBookSave`,
  `src/lib/import2bGuardedSaves.ts`). Two cells left in quick succession
  (Tab past the SGST that CGST fills, or typing in a second cell before the
  first save lands) each wait for the save before, then put the user's
  edits, taken when the cell was left, on the row as that save left it.
  Before, the second save was guarded by the row as loaded before the first
  landed, refused as "changed elsewhere (another tab or another user)", the
  row reloaded and the second edit lost. A row really changed elsewhere is
  still refused, once, and the saves queued behind that refusal are dropped
  with it.

**Round 7: Restore of a version of before, out of Reclaim as shown, one
lock order** (verification of 22 Oct 2026). The lead kept round 6's
stricter reclaim check (the app of before's two-request Reclaim is refused
from the apply; the app is deployed right after it).

- **A version's reclaim that names no 2B document is held to its
  document.** Every version written before this release (Post's, a 2B
  Reconciliation Save's, their RESTORE copies) and every version the app of
  before writes during the change-over holds a reclaim without naming its
  document, and when the month's entry of the same id is gone (a Clear
  Data, an earlier Restore) or names none, round 6 brought the reclaim back
  with no document: if the document had been taken out of Reclaim since, its
  ITC counted in 5.1 and again in 5.4, nothing was said, and the document,
  evidencing nothing, could move freely after. Now Restore finds the month's
  original invoice or debit note of the same document (`twob_doc_ident`:
  GSTIN, or the supplier when there is none, the number as normalised, and
  the date; a Reclaim one evidencing nothing first). While that document is
  Reclaim and evidences no other reclaim (an entry the month keeps, or the
  version's first one), the reclaim comes back linked to it
  (`reclaimed_via_doc_id`), so `twob__reclaim_evidence_guard` holds the
  document Reclaim from then on; otherwise the entry comes back in Awaiting
  reclaim and the Restore names it with why, as in round 6. Only a reclaim
  with no such document in the month (typed on 2B Reconciliation for a
  Liberal client) comes back as the version holds it. A document whose
  number or date the books wrote otherwise than the 2B (other than in case,
  spaces, punctuation or leading zeros) is not found, so such a reclaim
  comes back as typed.
- **Out of Reclaim only for the reclaim the page shows.** Import 2B reads,
  with its ledger side, the reclaim each 2B document evidences
  (`loadReclaimEvidence`), shows it on a Reclaim document's row ("Evidence
  of the reclaim of SUPPLIER X-1 (reversed Sep 26, reclaimed Oct 26)"; once
  a new treatment is staged, "Save puts the reclaim of ... back in Awaiting
  reclaim"), and its Save out of Reclaim sends it
  (`twob_import2b_unreclaim(..., p_expect_entry)`: that entry, or null when
  the row shows none). The call reads the entries naming the document with
  them held, after the client's lock, and writes nothing unless they are
  exactly that one ("The reclaim this 2B document evidences was changed
  elsewhere since the page showed it ...: it is now the evidence of the
  reclaim of ..."); the page names the document as changed elsewhere and
  shows the month as it is now. Before, a tab not reloaded, after another
  user had taken the document out of Reclaim and reclaimed another entry
  with it, released that new reclaim without a word.
- **One lock order for Restore and the saves.** Every writer of a reclaim
  takes the document's row, then the client's lock, then the entries;
  Restore took the client's lock first and a document only as an entry
  named it (round 6's check), so a Restore and an out of Reclaim (or a
  pairing) of the same document at the same moment deadlocked and one of
  them was rolled back. Restore now takes the month's Reclaim documents
  (the only ones an entry may name) FOR SHARE, in id order, before the
  client's lock, waiting for a save of one that is running; one made
  Reclaim between the two locks is taken without waiting once the client's
  lock is held, and a save of it running at that moment stops the Restore
  with a plain message ("Nothing was restored: a 2B document of Oct-26 is
  being saved on Import 2B right now. Try again in a moment.").
- **The RESTORE version records the month as the Restore left it.**
  `twob_restore_version_linked` returns the month's two lists after it
  (`rows_2b`, `rows_books`), and 2B Reconciliation records them as the
  RESTORE version (`restoreVersion`'s `versionData`, in the shape a Save
  records: `versionRows2B` / `versionRowsBooks`, `src/lib/twobPriorMonth.ts`).
  Before, the page recorded the version restored, so an entry the Restore
  brought back in Awaiting reclaim (or left out) read as reclaimed in the
  history and its export, and a Restore of that version brought the reclaim
  back again.

**The e-mail pop-up's reasons** (round 3, §11). A Not in Books document of
the month not on the ledger is named with its own reason: no date or
supplier in the 2B file, a filed month (its Not in Books list follows the
filed 2B), or a month out of step, which points to "Bring the
reconciliation up to date" (`unpostedSentence`; before, one sentence named
the first two even for a month out of step).

**Version snapshots: coalesced per minute.** The write-through marks the
month changed, with whose save it was (`twob_autopost_state.changed_by`); a
write-through takes a snapshot itself when the month's last one is more
than a minute old, and the page, after its own save, asks for the months
its saves marked to be brought up to date (`twob_import2b_flush_version`:
every month of the client marked behind, a later month's amendment
included). A snapshot within a minute of the month's current write-through
version brings that version up to date in place; otherwise it adds the next
version. A version is recorded as the saver's, never as whoever's page
asked for it, and a plain page load takes none. So a burst of saves (an
import's many writes, a Save of many rows) is one version, and a month gets
at most about one version a minute while people work on it. The versions
have Post's shape (`table_type` 'import2b', camelCase rows), so View
Versions and Restore read them unchanged; the page shows "Reconciliation
updated ... · vN". Since round 2 each row also records what Restore needs to
put the entry back as it was: its Import 2B link (`sourceBookId` /
`sourceDocId`, `adoptedFrom`), its Expense out (`reclaimSubtype`) and the
2B document its reclaim names (`reclaimedViaDocId`); 2B Reconciliation's
own Save records them too.

**Restore puts entries back linked** (round 2, `twob_restore_version_linked`).
Before, a restored entry came back unlinked, so the next save of its books
row added a second entry beside it (TAMNNA: I-1 restored at 300, then saved
at 330: 4B(2)(i) 300 + 330). Now each restored entry takes back the link of
the version (versions from this release), or, for a version of before, the
link the month's entry of the same id holds now (Post kept an entry's id
across its changes); failing both, an entry with this month as its reversal
(in-2B) month is linked by the document it is (GSTIN or supplier, number and
date, its amounts aside) to a books row (2B document) of the month that
posts and has none, as an own entry (it goes back to what was restored if
that row stops posting). Only while that row is still in the month, once per
row; an entry keeps its id when no row holds it. The next save of the row
then changes the entry instead of adding one; the restored figures show as
"not in step" on Import 2B until then. The toast says how many were linked.
An Expense out comes back as an Expense out, and a reclaim with its 2B
document only on the terms of rounds 6 and 7 (above).

**Speed** (local PostgreSQL, `test_9c_autopost_timing.sql`, 1,000 rows,
written as the app sends them): an import of 1,000 Not in Books documents
(two inserts of 500) 0.1 s; 1,000 treatment changes in chunks of 100 about
0.1 to 0.2 s each way; 1,000 books rows 0.07 s; the catch-up of 1,000 +
1,000 rows 0.25 s (preview 0.01 s); Delete 2B of 1,000 documents 0.15 s;
Clear Data of a month of 1,000 + 500 entries, cleared and written again,
0.2 s (one call a month: a year of such months in one call had run past the
3 s anon calls run under). The line read over a month of 1,000 + 1,000 rows
never posted 0.03 s; 1,000 books rows added beside 1,000 own entries of the
month (500 linked, 500 with a twin beside) 0.17 s
(`test_9f_autopost_round2.sql`). A re-import that changes the figures of 1,000
documents sends them one request each (8 at a time): the write-through adds
about 0.5 to 0.75 ms of database time a request to writing the document and
its entry by hand (the test asserts under 1 s for the 1,000; 0.7 s for 1,000
statements in one transaction), against tens of ms for each request's round
trip. The user check runs on every save and is written out in the trigger
(through `staff_level_of` it cost more than the rest of the write-through).
A filed month brought up to date through the door, 1,000 books rows, with
its preview's digest: about 1.0 s (1.3 s with the change log), the door run
once for the save (`test_9h_autopost_round4.sql`; round 4).
With the change log (`20261021150000`) applied first, as live, its own
logging adds about 0.35 ms a statement to both.

**Who acts.** The ledger rows written take `updated_by` from the request's
`x-gst-actor` (else the saved row's `updated_by`), so the change log
(`gst_change_log`) names the person on both the Import 2B row and its
ledger entry.

**Tests.** `supabase/tests/twob_simple/run.sh` applies the migration twice
after 20261021100000 as a role that is not a superuser and runs, besides
§13's tests: `test_9a_autopost.sql` (every save kind, the refusals, the
adoption, versions, Delete 2B, Clear Data, the catch-up, a prior month
through the door, employees refused), `test_9b_autopost_race.sh` (two
sessions), `test_9c_autopost_timing.sql`, `test_9d_autopost_round1.sql` (a
reclaim and a pairing refused leave nothing behind and go through once the
decision is undone; who may change the ledger; a filed month's twin linked;
rounding; versions as the saver's; the catch-up's undo hint),
`test_9e_autopost_locks.sh` (Delete 2B and Clear Data against a save at the
same moment), `test_9f_autopost_round2.sql` (the second round: which own
entry is linked, and how it is put back, in an open and a filed month; a
filed decision on a carried copy; Restore linked; the line in one read-only
statement; out of Reclaim in one call; timing), `test_9g_autopost_round3.sql`
and `round3.test.mjs` (the third round: the catch-up and a filed month's save
write only what their confirm showed; the rows left out on the ledger as last
saved or not; a Pending items button acting only on its own month; the e-mail
pop-up's reason per document; an employee asked up front exactly what the
database lets through), `test_9h_autopost_round4.sql` and `round4.test.mjs`
(the fourth round: 2B Reconciliation's Save and Import 2B's Pending items
never write over a decision recorded elsewhere meanwhile, a Save stopped
before its first write saying so; an employee's pairing that changes nothing
on the ledger saved through the page's own call, one that would refused; a
delete taking an entry off the ledger needing the permission; a filed
month's save running the door once, at 1,000 rows),
`test_9i_autopost_round5.sql` and `round5.test.mjs` (the fifth round: a
second reclaim on one document refused, by the call and by the index; a
reclaim or an out of Reclaim on a document whose treatment changed refused;
a document Reclaim while reclaimed against, its Save, bulk change and
delete refused, Delete 2B and a client's delete going through; a reclaim
cleared or expensed out letting its document go; Restore keeping one
reclaim per document; a stale books save refused in an open and a filed
month, through the page's own calls; Pending items over an entry still
naming a document; the next version number from the database; each check
recorded, so run on the code of before each fails or passes on its own),
`test_9j_autopost_round6.sql`, `test_9k_reclaim_race.sh` and
`round6.test.mjs` (the sixth round: Restore and a reclaim's document, the
rest named; an entry naming only a Reclaim document no other names, held
without the unique index beside a filed pair recorded before, against the
app of before's own writes and two sessions at once; two saves of one books
row from one page both kept through the page's queue; each check recorded
as in round 5), `test_9l_autopost_round7.sql`,
`test_9m_restore_lock_order.sh` and `round7.test.mjs` (the seventh round: a
version of before's reclaim restored against its document, linked or back
in Awaiting reclaim and named, typed only with no such document; out of
Reclaim refused for a reclaim other than the one the page shows, through the
page's own calls; a Restore and an out of Reclaim of one document at the
same moment, both orders, without a deadlock; the RESTORE version as the
Restore left the month; each check recorded as in round 5) and
`autopost.test.mjs` (twin
clients: the write-through on one, the app's own `planImport2BPost` +
`postImport2BToLedger` on the other, the ledgers compared after every save
kind, the pairing and reclaim calls included; the database's plan and its
line against `planImport2BPost` on a month out of step; own entries of a
blank, another and this month, adopted then taken back or deleted). `app_writes.test.mjs` checks the words (the standing line of a
filed month, the catch-up toast, the filed month's preview).
`node scripts/verify-import2b-notes.mjs` checks the rules in the browser
code, that the page has no Post, that reclaims, pairings and a document out
of Reclaim are one call each, that the line is the database's, and the
round-2 words (a document's entry as last saved, the debit note's words only
once saved, no Undo for a filed decision), and the round-3 rules (the re-import
keep rule, reads keyed to the month shown, each save asked up front, the
line's and the e-mail pop-up's words, the digests sent back) and the round-4
rules (a read of an earlier visit to a month never the latest, each Pending
items decision written only while the entry holds what the list showed, the
pairing call asking no permission itself and a delete off the ledger
needing it, a filed month's save running the door once) and the round-5
rules (the reclaim's expected treatment and the database's one reclaim per
document, the treatment Save and books saves guarded by what was loaded,
changed columns only, a landed save shown as saved, the Settings words) and
the round-6 rules (the naming trigger held without the index, the reclaim
call's order, Restore's reclaims back and the page's words, a books row's
saves one at a time) and the round-7 rules (Restore's document found for a
reclaim naming none, out of Reclaim sent and checked with the reclaim shown,
Restore's lock order, the RESTORE version from the Restore's rows);
`node scripts/verify-twob-live.mjs` checks 2B Reconciliation's live updates
(which changes concern the month, the banner instead of a reload under unsaved
edits, Save sending only the changed rows, a reload clearing the pending
deletes with the edits; round 4: which changes the page already shows, a
change heard during a Save looked at again when it ends, every column
guarded, the delete confirm from the rows read back, the edits kept when
nothing was written; round 5: a row's change read with its delete, the
version list reloaded live and version numbers from the database).

**Open questions for the firm.**

- Who may: Import 2B & post for the saves that change the ledger, every
  staff level for the rest (above, round 3), or every staff save?
- The refusal above: should a save instead take back the entry and its
  decision (as Post did), or keep the entry unlinked?
- Clear Data now writes Import 2B's entries again at once (the dialog says
  so). If the firm wants Clear Data to leave the month empty, Import 2B's
  rows must be cleared too.
- A 2B Reconciliation (Liberal) edit of an entry that Import 2B posted is
  overwritten by the next write-through of its source row, as Post's next run
  did.
- An own entry of the month next to a books row of the same bill: linked when
  it carries this month's reversal month (no twin), a twin beside it
  otherwise (as Post). Should a blank-month entry typed on 2B Reconciliation
  be treated as this month's?
- A decision carried in from a filed month cannot be undone on the open
  month's copy (2B Reconciliation, Liberal, too). If one was wrong, the
  filed month's figures were wrong: the fix is a later return, not the copy.
- Delete 2B does not re-match the books register (as before); a books row
  paired with a deleted document keeps its treatment until it is saved again.
- The 15 out-of-step client-months are left for staff to bring up to date
  (or not) one by one; the 12 filed months that differ only on their Not in
  Books side no longer show a line.
