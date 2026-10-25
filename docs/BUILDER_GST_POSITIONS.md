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

**First occupation (25/10/2026).** Schedule II para 5(b) and Notification
06/2019-CT(R) read "completion certificate ... or first occupation, whichever is
earlier". The BU event takes an optional **first occupation date**; when it is
before the permission, it is the completion date: `builder_bu_events.bu_date`
carries it (so every cut-off, the TDR/FSI time of supply and the ITC reversal
year run from it) and the permission's own date is kept in
`bu_permission_date` (migration `20261025100000`). A unit's cut-off is then the
earlier of that completion date and its dastavej date.

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

**The opening balance is an open advance (firm decision, 10/10/2026).** The
value taxed before onboarding (`builder_opening_balances.cumulative_value_taxed`,
as on 30/06/2026) less whatever of it invoices have already adjusted in Table 11B
is an open advance like a receipt's. It counts in the unit's **Open advance**
(`computeUnitLedger().openAdvance`, split as `receiptOpenAdvance` +
`openingOpenAdvance`) and in the BU working's **Open advance** column
(`openAdvanceBefore` = value taxed to opening − invoiced before). A **milestone
invoice** raised after onboarding now absorbs it too — receipt advances first,
oldest first, then the opening balance — writing a
`builder_opening_balance_adjustments` row (Table 11B, `OPENING_11B`) at the
unit's class rate; before this, a milestone invoice drew on receipts only and
GST was charged again on the full invoice. A BU event nets those earlier
opening adjustments off the opening it carries in. Not offered on a unit with a
cancellation (that money belonged to a sale that may no longer exist), nor to
delay interest (a separate supply).

Units **unbooked at the cut-off** fall under **Schedule III para 5** — sale of a
building after completion is not a supply — and are omitted from GSTR-1 and 3B
entirely.

**Accepted consequence.** GST gives no bad-debt relief. Tax paid at BU on an
uncollected balance is recoverable only through a credit note under s.34, and
only until 30 November following that financial year. Each posted event carries
its deadline.

*`src/utils/builderBuEvent.ts`; the working is persisted per unit.*

**Agreement value: confirmed by the client, or accepted by the firm (firm
decision, 13/10/2026).**

*The rule:*
- Before a BU event posts, every taxable unit's agreement value must be cleared.
- A value is cleared when the client confirms it through the emailed link, or
  when the firm accepts it without the client's confirmation ("Accept without
  confirmation" on the BU working; status `OVERRIDDEN`).
- A unit whose request was never sent also blocks posting.

*Who may accept:*
- The superadmin, who need not give a reason.
- GST Managers, who must give a reason.
- Employees whose role carries `override_bu_agreement`, who must give a reason.

The reason is kept on the unit's confirmation row
(`builder_bu_agreement_override`, migration `20261015100000`). A client's own
confirmation is never replaced.

**Who is asked, and who may answer (firm decision, 21/10/2026).** "BU
confirmation request can be sent to multiple emails in CC if needed & anyone
can provide confirmation for the outstanding figures & the email can be typed
directly on the button pressed."

- "Send confirmation requests" opens a pop-up. Staff type the To addresses
  (filled from the client master, or from the last request, and editable) and
  any CC addresses. "Name <address>" pastes from Outlook are read. Sending
  works when the client master has no e-mail.
- The pop-up lists the outstanding units (pending, disputed or never sent)
  with their agreement values, read again each time it opens, together with
  the event's requests: whether each e-mail went, the To it fills in ("as on
  the last request" is the last request now, not as BU Events loaded it), and
  a unit asked meanwhile in a colleague's request the page had not loaded
  ("Asked since this page loaded, in another request to <To>, CC <CC>").
  Staff may untick any. Confirmed and accepted units are never asked again: a unit confirmed or
  accepted while the pop-up is open is left out of the e-mail, and the send
  says so.
- The send carries the status and answer time of each ticked unit as the
  pop-up showed them. A unit disputed (or otherwise answered) since is not
  asked: nothing is sent, the pop-up shows the dispute, its note and who gave
  it, and unticks the unit. Staff send for the others, or tick it again to
  ask again once the working is right. A send never clears a dispute staff
  have not seen.
- Asking again about a disputed unit clears the dispute on the unit's row
  (the gate reads that row), but the dispute is kept in
  `builder_bu_confirm_answer_history`: the note, who gave it and when, at what
  value, and the request that asked again. BU Events shows the latest one
  under the unit.
- A unit left unticked gets a `NOT_SENT` row. It holds up posting and filing
  like a pending unit until it is asked or accepted, so a partial send never
  opens the filing gate.
- One e-mail per send, not one per unit, with one link
  (`builder_bu_confirm_requests`). The link's page lists every unit in it. The
  reader may confirm all at once, or confirm or dispute each unit. A dispute
  needs a note. A unit whose dispute box is open is left out of "Confirm
  all", because a confirmation cannot be undone.
- Only the people the e-mail went to may answer, and they prove it. The page
  asks the reader's name and e-mail (both required). The e-mail must be one of
  the request's To or CC addresses; for a per-unit link sent before this
  change, one of the addresses that e-mail went to, as recorded once when the
  change was applied (`legacy_emails`, below). The page
  then e-mails a 6-digit code to that address, and only the code typed back
  lets the reader answer (a proof good for 2 hours). Knowing an address is
  not enough: every recipient sees the To and CC addresses in the header, the
  firm's copy sits in gst@vjdesai.com, and BU Events prints them. The code
  goes straight through Microsoft Graph (Edge Function `bu-confirm-code`),
  never through `email_outbox` (which the public key can read), and no copy is
  kept in the firm's Sent Items, so staff cannot read a client's code. The
  page that asked for a code gets its id, and the code is typed back with it:
  only that page can try it, so another reader typing wrong codes "as" the
  owner touches only their own codes. Each code's e-mail is marked with a
  reference of 4 letters taken from the code's id (in its subject and body;
  no digits, so it is never typed as the code), and the page shows the same
  mark next to the Code box ("Type the code from our e-mail marked DRLK").
  The messages name that e-mail, never "the latest e-mail": when two pages
  ask codes for one address (a shared mailbox, or another holder of the
  link), the newest code in the mailbox may be the other page's. Digits that
  are the code of another of our e-mails to that address on that link are
  said to be that and are not counted as a wrong try, so typing the other
  page's code never locks a reader out (finding of 21 Oct 2026: five such
  tries ended the owner's code, two rounds locked the owner out for the
  day). That other code is spent in the same statement
  (`typed_elsewhere_at`): it never gives a proof afterwards, to anyone, and
  its page says "That code was typed on another page, so it no longer works"
  and asks for a new one. Without that, the answer was a free check of a
  guess against every live code on the link, and a hit was then typed
  against its own code id for a proof: one caller holding 5 codes tested 50
  a day instead of 10, and 11 callers holding 40 codes stood about a 0.44%
  daily chance of answering as the owner (verification of `20261021160000`,
  medium). The price: two people sharing a mailbox who each type the other's
  code first both ask again. A code works for 30 minutes and 5 tries.
  Limits (`20261021160000`; finding of 21 Oct 2026: they were counted per
  link, so every link ever sent took 10 codes a day to an address, links with
  nothing left to answer too, and rotating addresses in one IPv6 /64 made a
  new caller each time: 50 codes reached one mailbox from one caller over five
  links, 104 over one link from one /64):
  - A caller is one IPv4 address, or one IPv6 /64 (a single host gets a whole
    /64). Per caller and address, on one link: 5 codes an hour (the refusal
    names the e-mail to type by its mark) and 10 a day. A proof holds on one
    link only, so a reader with several live links needs a code on each:
    counted over every link (a first version of `20261021160000`), the sixth
    link of a reader with six was refused, told to type a code "this page
    asked for" when it had asked for none (verification, low). Over every
    link, 20 a day per caller and address, a limit of its own that says
    "over all our links"; 20 an hour per caller whatever the address or link;
    10 wrong tries a day to one address on a link.
  - Over all callers and every link, at most 30 codes e-mailed a day to one
    address; past 30 only a caller's first 2 codes of the day to that address
    go, and never more than 40 in all. On one link, 60 e-mailed an hour; past
    60 only a caller's first 2, never more than 80. "E-mailed" is a code the
    mailer claimed and did not report failed: codes asked for and never sent
    cost nothing (round 4: six callers asking 5 codes each, never e-mailed,
    locked the owner out for a day), and the mailer checks the ceilings again
    when it claims a code, so codes asked for in parallel cannot pass them
    together.
  - No code is e-mailed on a link where nothing is waiting for an answer
    (every unit confirmed, disputed, accepted, replaced by a newer e-mail that
    went out, or not sent).
  So a mailbox gets at most 40 codes a day, whoever asks and however many
  links it holds. The price of that ceiling: callers on 8 or more networks
  (3 taking 10 codes each, then 5 taking 2) who have 40 codes actually
  e-mailed to an address (each one in that mailbox, so the reader sees why)
  leave its reader without a code for the day. That reader, like one who used up their own limits, waits an hour or a
  day, or writes to the firm, which may accept the value ("Accept without
  confirmation"). Only hashes are stored, in `builder_bu_confirm_codes`
  (private: RLS on, no policies, like `client_password_resets`).
- The page keeps the code step per link in the reader's browser and restores
  it on load: in localStorage the name, the address, the code's id, when it
  was asked and whether the mailer said it was sent; the proof (and when it
  ends) only in sessionStorage, for the tab that checked the code. A phone
  mail app that closes the link's tab to show the inbox no longer loses the
  code already e-mailed, and a reload of the tab keeps the proof; but someone
  else using the same browser who opens the link in a new tab must ask for a
  code and read that mailbox before answering as the address (finding of 21
  Oct 2026: the proof in localStorage let anyone at a shared office PC answer
  as the checked address for 2 hours, with no code). "Not you? Start again"
  forgets the step. A code the mailer did not report on is restored as "We
  could not confirm the code was sent", not "We e-mailed a code" (same
  finding). A code is dropped after its 30 minutes, a proof after its 2
  hours; a browser that blocks storage simply starts afresh. The code is not
  put in the e-mail's subject (its reference is): the firm's Microsoft 365
  message trace lists the subjects of what it sends, so its admins could read
  a client's code there.
- Name and e-mail are kept, with the time, on each unit answered
  (`responded_by_name`, `responded_by_email`, `responded_at`). The BU Events
  page shows "Confirmed by <name> (<email>) on <date>" per unit and on the
  event. The public page shows who answered with the address masked
  ("r…h@client.com").
- The firm's own addresses never answer and get no code: the firm's domain
  (`vjdesai.com`) and any staff member's profile e-mail. They may get a copy,
  but a request needs at least one address outside the firm. The pop-up asks
  the database which typed addresses count as the firm's (a staff member's
  personal address is one) and lists them; a refusal names them. A staff
  member who wants to clear a unit without the client uses "Accept without
  confirmation", with its permission and reason; neither a request sent to
  oneself nor the firm's copy of a client's request can do it.
- Only an open unit takes an answer. A confirmed unit stays confirmed: the
  next reader sees who confirmed it and cannot dispute it there (a client's own
  confirmation is never replaced); the page says an answer given there stands
  and to write to the firm if it is wrong. A disputed unit waits for staff, who
  correct the working and send a new request for it.
  *Open question for the firm:* "anyone can provide confirmation for the
  outstanding figures" could mean that another recipient may confirm a unit
  someone else disputed. Until the firm decides, a dispute stands. That is the
  safer reading: a dispute says the working's value may be wrong.
- A new request for a unit replaces the earlier one for that unit once its
  e-mail is out (outbox `sent`, or the row gone). The earlier link then shows
  the unit as "replaced by a newer request" and takes no answer for it. While
  the newer e-mail waits in the outbox, is stuck sending, or failed (failed,
  skipped or cancelled), the earlier link keeps answering, so the client is
  never told to use an e-mail they have not received. Only a newer request
  that is out replaces a link: a link replaced by a delivered request stays
  replaced when a still newer request fails. A per-unit link counts every
  request as newer. A confirmed or accepted unit shows its answer on every
  link that asked about it. Per-unit links e-mailed before this change keep
  working, on the new page and with the same checks, until a newer request
  about their unit is out; the old per-unit answer function and its lookup
  are closed to the public key. When the change is applied, each row such an
  e-mail made records, once, the addresses it went to (`legacy_emails`: the To
  and CC of its outbox row, or the client master's then when that row was
  gone) and the e-mail itself (`legacy_outbox_id`). Nothing changes them
  later, not even the confirmation functions. Only such a row answers by its
  own token, and only those addresses may answer it, whatever a request asks
  later. Every row carries a token the public key can read, but the token of a
  row a request or Accept made was never e-mailed and opens nothing; and the
  addresses are never read live from `clients.email` or `email_outbox`, which
  the public key can write (round 4, high: one write to the client master let
  anyone confirm every unit through the rows' own tokens and open the filing
  gate). When a newer request counts as out is still read from
  `email_outbox.status`; the public key can write it, but that only reopens an
  earlier link to the people its own e-mail went to, who must still prove
  their address.
- A re-send while an earlier request's e-mail still waits in the outbox
  cancels that e-mail when the new request asks everything it asked (or the
  rest is answered), so the client never gets a link that opens "replaced".
  When the new e-mail fails, staff are told, unit by unit, whether an earlier
  link still takes answers: "The earlier link still takes answers for A-101
  until an e-mail goes out. No link to A-102, A-103 has reached the client."
  The send records which of its units had one
  (`builder_bu_confirm_requests.earlier_units`, `20261021160000`; finding of
  21 Oct 2026: the sentence was said of every unit when only some had a link).
  A request sent before that has only `earlier_link` (some unit had one) and
  keeps the old sentence.
- A unit is shown as asked only once its e-mail is out. BU Events shows
  "Asked <date>" when the unit's request went out (dated when it went), and
  otherwise "E-mail of <date> failed: <why>" or "queued, not sent yet", with
  whether an earlier link to the unit still takes answers. The same holds for
  a per-unit e-mail of before 21 Oct 2026: its outbox status
  (`legacy_outbox_id`; a row that is gone counts as out, as the database
  counts it) decides whether the unit was asked and whether that link is an
  earlier link that still answers (finding of 21 Oct 2026: such a unit showed
  "Asked" and "the per-unit link still takes answers" when that e-mail had
  failed). Every request whose
  e-mail failed or waits and that units still wait on gets its own line on
  the event, not only the last one. The pop-up badges such units "Pending ·
  e-mail failed" or "Pending · not sent yet", and says when the To it fills
  in from the last request failed.
- A send locks the event's rows before it checks them, so an answer given
  while it runs is either seen (a confirmation is left out, a dispute stops
  the send) or waits for it. A colleague's request for a ticked unit sent
  while the pop-up was open stops the send too: the pop-up says the unit was
  asked meanwhile, and to whom, and unticks it.
- Nobody writes around the functions. The requests, the per-unit rows and
  the history are open to read (RLS open to public, as everywhere), but the
  public key has no insert, update or delete grant on them, and a trigger
  refuses every write, from any role, that the send, the page's answer or the
  firm's Accept did not make (`builder_bu_confirm_write_guard`). So nobody can
  add their own address to a request, point a link at another client's units,
  or write a confirmation or a responder straight into a unit's row. Deleting a
  BU event, unit or client still takes its rows with it.
- The posting gate is unchanged. The per-unit rows in
  `builder_bu_agreement_confirmations` stay the record it reads; CONFIRMED or
  OVERRIDDEN clears a unit, and PENDING, DISPUTED and NOT_SENT hold it.

*Migration `20261021140000_bu_confirm_cc.sql` (send, lookup, code and answer
functions; template `builder_bu_agreement_confirm_request`, editable under
Reminders, Templates, Builder) and `20261021160000_bu_confirm_followup.sql`
(the code limits per link, over every link and over all callers, the code's
reference, a code typed on another page spent, `earlier_units`); Edge Function `bu-confirm-code`; tests
`supabase/tests/bu_confirm/run.sh`, `deno test --allow-read
supabase/functions/bu-confirm-code/test/` and
`node scripts/verify-bu-confirm.mjs`; `src/lib/builderConfirmRules.ts`,
`src/lib/builderAgreementConfirmData.ts`,
`src/components/builder/SendAgreementConfirmDialog.tsx`,
`src/pages/AgreementConfirmPage.tsx`.*

*At posting time:*
- The posted figures must equal the confirmed or accepted ones. If a unit's
  agreement value or differential moved since the event was prepared, posting
  stops and the event must be prepared again.
- A post is all or nothing. A failure part-way unposts what was written, and an
  already-posted event cannot be posted twice.
- The invoice is dated inside its posting period and numbered
  `<series>BU/<unit>` for Table 13.
- Posting is refused when it would take over receipts that a filed GSTR-1
  already reported.

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

## 7A. Final ITC reversal at completion — Rules 42 and 43 (13/10/2026)

**Where:** Builder › ITC Reversal, one working per project and BU event.
- Engine: `src/utils/builderItcReversal.ts`.
- Data: `src/lib/builderItcReversalData.ts`.
- Schema: migration `20261015110000_builder_itc_reversal.sql`.

**Why it exists.** At BU or completion, the units still unbooked will be sold
after completion. Schedule III para 5 keeps that sale outside supply, and
s.17(3) treats it as exempt for apportionment. Credit taken during
construction on that share is therefore reversed by a final determination.

**The key is carpet area (Te / Tt)**, taken from the BU event's frozen unit
snapshot.

*Te (exempt carpet):*
- every unit unbooked at the cut-off;
- for a Partial-ITC client only, plus the booked residential carpet, whose
  share was exempt throughout.

*Tt:* the total carpet area of the units in the event.

**Per financial year, from the project's first FY to the BU FY:**

    Rule 42: (inputs + input services credit) × Te/Tt − already reversed under Rule 42
    Rule 43: (capital goods credit)           × Te/Tt − already reversed under Rule 43

The year totals are netted per tax head. A positive net goes to GSTR-3B
**4(B)(1)**. A negative net (more reversed over the years than the final
figure) goes back as a re-credit in **4(A)(5)**.

**Where the figures come from:**
- **Past years** are entered exactly as in that year's GSTR-9:
  - Table 6 for credit availed, split into inputs and input services vs
    capital goods;
  - Table 7C / 7D for what was already reversed.
- Each past year must be **matched with its filed GSTR-9** before
  submission:
  - by ticking the check against the app's own figure (GSTR-9 Table 6A
    when pulled, else the as-filed GSTR-3B 4A months);
  - or by confirming it with the filed GSTR-9's ARN.
- A difference from the app's figure is shown and must be explained in the
  remarks.
- **The BU year** (April to the BU month) is entered by hand.

**Past years come from the portal (13/10/2026).**
- *Fetch past years from portal* has the extension (0.10.3+) read each year's
  **filed** GSTR-9. It saves the return as `gst_filed_returns` `GSTR9_FILED`.
- Each year is filled from it (`src/utils/gstr9Filed.ts`):
  - **Rule 42 base:** Table 6B–6D and 6E of types inputs and input services,
    plus 6F, 6G, 6H and 6M;
  - **Rule 43 base:** capital goods from 6B–6E;
  - **already reversed:** 7C (Rule 42) and 7D (Rule 43).
- TRAN-1 and TRAN-2 credit (6K/6L) is left out.
- A year filled this way is read-only and counts as matched with its GSTR-9.
  A year the portal did not return is entered by hand and confirmed against
  the filed GSTR-9's ARN, as before.

**The whole of Table 7, and 7J (14/10/2026, the firm's request).**
- Each year carries every head of GSTR-9 Table 7: 7A (Rule 37), 7B (Rule
  39), 7C (Rule 42), 7D (Rule 43), 7E (s.17(5)), 7F/7G (TRAN), 7H (other).
  The working shows 6O, 7I (7A to 7H) and **7J (6O − 7I)**.
- **The Rule 42/43 base is 7J + 7C + 7D**: credit availed less what Table 7
  reversed under any other head, which was never common credit (blocked,
  unpaid, ISD, TRAN). Those reversals come out of the Rule 42 base first,
  then Rule 43. 7C/7D remain what was already reversed.
- **Locks.** What a filed GSTR-9 gave is locked, in the page and in the DB
  (`builder_itc_reversal_years.portal`, trigger
  `builder_itc_reversal_years_portal_lock`). Only a superadmin can change a
  fetched figure (14/10/2026); for anyone else, refetch to change it. The filed return read in full locks Tables 6 and 7; a year read only as
  the system-computed 6A (`GSTR9_CALC`) locks Table 6, and Table 7 is typed
  from the filed return and ticked as checked.
- A year whose **GSTR-9 is not filed** is editable: prefilled from the
  GSTR-3Bs as filed (4A as availed, 4B(1) as 7C, 4B(2) as 7H) and split by
  hand as the GSTR-9 will show it. The BU year is entered by hand.

**First year.** The project's registration or 01/04/2019, whichever is later.
This is the start of the construction scheme and its carpet-area key. The
working can move it.

**Approval.**
- Staff with *Post BU events* prepare and submit the working. A submitted
  working is frozen.
- **Only the superadmin approves.** Approval writes the net amount into that
  period's GSTR-3B as `gstr3b_adjustments` rows (source "Builder ITC reversal
  (Rule 42/43)"). The GSTR-3B draft adds these into 4(B)(1) or 4(A)(5).
- Those rows cannot be edited or deleted except by withdrawing the approval.
  Withdrawal is superadmin only, and only while the return is unfiled.
- An approval into an already-filed GSTR-3B is refused.

**Elected positions, not confirmed in a firm sign-off:**
- **Posting period.** It defaults to the BU event's posting period. A period
  later than the September following the BU year is flagged, because Rule 42
  ties the final determination to the year of completion.
- **Interest u/s 50** is optional. When switched on, it is worked out at 18%
  on each past year's net reversal, from 1 April after that year to the due
  date of the posting period's GSTR-3B. It is shown for payment through
  Table 5.1 or DRC-03 and is **not** written into the return; the GSTR-3B
  draft has no interest line yet.
- **Cess** on ITC is shown but not carried by the GSTR-3B draft, so it is paid
  by hand.
- **Credit counted.** The working treats the credit entered as the project's
  common credit. Credit used wholly for taxable supplies, or blocked under
  s.17(5), should be left out of the entry, and the remarks should say so.
- **No-ITC clients** have nothing to reverse at completion, because every
  month's credit is already reversed in full.

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

**Never ITC in 4A(3) (25/10/2026).** The GSTR-3B draft folded the FSI legs into
the same reverse-charge total that fills 4A(3), so the blocked tax came back as
credit for every Claim-ITC and Partial-ITC builder (a No-ITC builder showed it
and reversed it), while the GST Receivable reco's own 4A(3) (from `rcm_data`
only) left it out. `fetchGstr3b` now passes the FSI legs as `rcmItcBlocked`:
liability in 3.1(d), nothing in 4A(3), for the residential leg always.

**The commercial leg's credit (25/10/2026, the firm's instruction).** In a REP
other than an RREP the commercial apartments are taxed at 12% with credit, so
the reverse charge on their share of the TDR/FSI is eligible input tax. For a
Claim-ITC or Partial-ITC client the view `builder_rcm_postings` gives it as
`itc_cgst` / `itc_sgst` (half each of `commercial_rcm`), with the project's
RREP test (`project_is_rrep`, the app's `testRrep`: manual carpet areas, else
units not cancelled, no area counting as an RREP); 0 for an RREP or a No-ITC
client. GSTR-3B claims it in 4A(3). It is wholly commercial, so a Partial-ITC
builder's carpet apportionment leaves it out of the base its residential share
is taken from (`computePartialItcSplit`'s `exclusiveItc`, also on ITC Summary,
whose row (3) carries it, and in the ITC & Cash paper). The GST Receivable reco
adds it to M-1's net ITC, unapportioned, in the database
(`gst_receivable_reco_difference`), `gstReceivableRecoCalc.ts` and the page,
so the push gate still tallies (`20261025130000`, `src/lib/builderFsiCredit.ts`).
Do not also key it as a 4A(5) adjustment: it would be claimed twice.

**The 3.1(d) value (25/10/2026).** `taxable_value` was `total_rcm ÷ 18%`, which
understated the supply whenever the 1%/5% cap cut the residential tax (portion
₹1 crore, tax capped at ₹5 lakh, value shown ₹27.78 lakh). It is now the
portions themselves, `residential_value + commercial_value`; a working with no
portions recorded keeps the old figure. The tax is unchanged.

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
| Working papers (W/P refs, sign-off, unit register, advances roll-forward, ITC reversal, DRC-03 register) | `src/utils/builderReportTables.ts`, `src/lib/builderReportData.ts` |
| Schema | `supabase/migrations/*_builder_phase*.sql` |
