// Import 2B without "Post to Reconciliation" (the firm, 21 Oct 2026: "No need
// of Post to Reconciliation in Import 2B tab, as updation itself would
// automatically change the next report wherever required"; docs §15,
// migration 20261021170000_import2b_autopost.sql).
//
// Every save on Import 2B writes through to the 2B Reconciliation ledger in
// the database, in the same statement, by Post's rules (planImport2BPost in
// src/lib/postImport2B.ts is that plan; the database follows it row for
// row). What the page still calls:
//  - twob_import2b_catch_up: an open month out of step (posted before this
//    change) brought up to date, previewed first;
//  - twob_import2b_delete_2b: Delete 2B in one call;
//  - twob_clear_year: 2B Reconciliation's Clear Data in one call, the entries
//    Import 2B posts written again at once;
//  - twob_import2b_flush_version: the month's version brought up to date once
//    a save is done (versions are coalesced per minute);
//  - twob_import2b_save_book: a books row saved with its pairing (the 2B
//    document it leaves and the one it pairs with), all of it or none;
//  - twob_import2b_reclaim and twob_import2b_unreclaim
//    (src/lib/twobPendingWrites.ts): a reclaim, and a document taken out of
//    Reclaim, the entry and its 2B document together;
//  - twob_import2b_step: what the month's ledger lacks to follow Import 2B,
//    read in one statement (the page's "not in step" line).
// Every save that changes the ledger needs the Import 2B & post permission
// (work_2b_import), as Post did; the database refuses it otherwise.
// A prior month's books rows are saved with their write-through through the
// door (twob_import2b_prior_save, src/lib/twobPriorMonth.ts).
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { PostPlan } from '@/lib/postImport2B';
import { bookNotPostedReason, docChangesNothing, docNotPostedReason } from '@/lib/postImport2B';
import type { TwobDocLike } from '@/lib/twobDocs';

type Raw = Record<string, unknown>;

/**
 * Per list: entries added, linked (an identical own entry of the month taken
 * as the entry instead of adding a twin), changed, taken back, and put back
 * (an own entry linked that way, back to what it held and unlinked: never
 * removed).
 */
export interface ListCounts { add: number; link: number; change: number; remove: number; unlink: number }
export interface CatchUpResult {
  dryRun: boolean;
  written: number;
  bills2B: ListCounts;
  billsBooks: ListCounts;
  /**
   * Rows not posted, with Post's reason (no date or supplier, a books debit
   * note, a minus row). onLedger: what the row posted before stays on the
   * ledger as last saved (a row without a date or supplier), so it is still
   * counted; otherwise the row is not on the ledger.
   */
  skipped: { list: string; id: string; number: string | null; reason: string; onLedger: boolean }[];
  /** Entries a catch-up would take back that hold a reclaim, Expense out or book entry: nothing is written. */
  refusals: { entry: string | null; message: string }[];
  /** Where to undo what the refusals name (Import 2B's Pending items, or the reclaiming document). */
  undoHint: string | null;
  version: number | null;
  /**
   * The plan's digest (twob__autopost_digest): the preview's is sent back
   * with the apply, which writes nothing when the month's plan is no longer
   * the one the confirm showed (verification round 3).
   */
  digest: string | null;
}

const counts = (v: unknown): ListCounts => {
  const d = (v || {}) as Raw;
  return {
    add: Number(d.add) || 0, link: Number(d.link) || 0, change: Number(d.change) || 0,
    remove: Number(d.remove) || 0, unlink: Number(d.unlink) || 0,
  };
};

const parseCatchUp = (data: unknown): CatchUpResult => {
  const d = (data || {}) as Raw;
  return {
    dryRun: d.dry_run === true,
    written: Number(d.written) || 0,
    bills2B: counts(d.bills_not_in_2b),
    billsBooks: counts(d.bills_not_in_books),
    skipped: (Array.isArray(d.skipped) ? d.skipped : []).map((x) => {
      const r = x as Raw;
      return {
        list: String(r.list), id: String(r.id), number: typeof r.number === 'string' ? r.number : null, reason: String(r.reason),
        onLedger: r.on_ledger === true,
      };
    }),
    refusals: (Array.isArray(d.refusals) ? d.refusals : []).map((x) => {
      const r = x as Raw;
      return { entry: typeof r.entry === 'string' ? r.entry : null, message: String(r.message) };
    }),
    undoHint: typeof d.undo_hint === 'string' ? d.undo_hint : null,
    version: typeof d.version === 'number' ? d.version : null,
    digest: typeof d.digest === 'string' ? d.digest : null,
  };
};

/**
 * An open month out of step brought up to date (twob_import2b_catch_up),
 * staff with Import 2B & post only. dryRun: what it would write, with its
 * digest. digest (the apply): the preview's; the database writes nothing
 * and throws "changed while the confirm was open" when the month's plan is
 * no longer the one previewed. Throws with the database's words.
 */
export async function catchUpMonth(
  actorId: string, clientId: string, period: string, dryRun: boolean, digest: string | null = null,
): Promise<CatchUpResult> {
  const { data, error } = await supabase.rpc('twob_import2b_catch_up', {
    p_actor_id: actorId, p_client_id: clientId, p_period: period, p_dry_run: dryRun, p_digest: digest,
  });
  if (error) throw new Error(error.message);
  return parseCatchUp(data);
}

/** "1 added, 2 changed, 1 removed": what a list had done to it; '' when nothing. */
export function doneCountsText(ins: number, upd: number, ret: number): string {
  return [ins && `${ins} added`, upd && `${upd} changed`, ret && `${ret} removed`].filter(Boolean).join(', ');
}

/**
 * A list's counts in words, each kind named apart (verification round 3:
 * before, a link read "to add" and a put-back "to remove", though a link
 * adds nothing and a put-back removes nothing): "1 to add, 1 to link, 2 to
 * change, 1 to remove, 1 to put back"; once done "1 added, 1 linked, ...".
 * '' when nothing.
 */
export function countsText(c: ListCounts, done = false): string {
  const w = done
    ? { add: 'added', link: 'linked', change: 'changed', remove: 'removed', unlink: 'put back' }
    : { add: 'to add', link: 'to link', change: 'to change', remove: 'to remove', unlink: 'to put back' };
  return (['add', 'link', 'change', 'remove', 'unlink'] as const)
    .map((k) => (c[k] || 0) && `${c[k]} ${w[k]}`).filter(Boolean).join(', ');
}

/**
 * The preview ("Not in 2B: 1 to add, 2 to remove. Not in Books: 1 to link
 * (...)") or, once applied (done), what was done ("Not in 2B: 1 added, 2
 * removed."). A link is an entry already on the ledger, linked to its Import
 * 2B row instead of added again; a put-back is an entry of the ledger's own,
 * back as it was and unlinked, not removed.
 */
export function describeCatchUp(r: { bills2B: ListCounts; billsBooks: ListCounts }, done = false): string {
  const part = (name: string, c: ListCounts, row: string) => {
    const text = countsText(c, done);
    if (!text) return null;
    const link = c.link || 0;
    const unlink = c.unlink || 0;
    const notes = [
      link && (link === 1
        ? `the one ${done ? 'linked' : 'to link'}: an entry already on the ledger as one of its own, linked to its ${row} instead of being added again`
        : `the ${link} ${done ? 'linked' : 'to link'}: entries already on the ledger as their own, linked to their ${row}s instead of being added again`),
      unlink && (unlink === 1
        ? `the one ${done ? 'put back' : 'to put back'}: an entry of the ledger's own, back as it was and unlinked, not removed`
        : `the ${unlink} ${done ? 'put back' : 'to put back'}: entries of the ledger's own, back as they were and unlinked, not removed`),
    ].filter(Boolean);
    return `${name}: ${text}${notes.length ? ` (${notes.join('; ')})` : ''}.`;
  };
  return [part('Not in 2B', r.bills2B, 'books row'), part('Not in Books', r.billsBooks, '2B document')].filter(Boolean).join(' ');
}

/**
 * The rows a catch-up leaves out, for its confirm, grouped by reason: those
 * whose entry stays on the ledger as last saved (still counted: a row
 * without a date or supplier that posted before) apart from those not on
 * the ledger (verification round 3: before, both read "Not posted", though
 * the first are still reversed or listed).
 */
export function catchUpSkippedLines(r: Pick<CatchUpResult, 'skipped'>): string[] {
  const group = (onLedger: boolean) => {
    const byReason = new Map<string, string[]>();
    r.skipped.filter((x) => x.onLedger === onLedger)
      .forEach(({ number, reason }) => byReason.set(reason, [...(byReason.get(reason) || []), number || '(no number)']));
    return [...byReason].map(([reason, nos]) => {
      const n = nos.length;
      const list = `${nos.slice(0, 5).join(', ')}${n > 5 ? ` and ${n - 5} more` : ''}`;
      return onLedger
        ? `On the 2B Reconciliation ledger as last saved, ${n} ${n === 1 ? 'row' : 'rows'} (${list}): ${reason.toLowerCase()}; ${n === 1 ? 'its entry stays and is still counted' : 'their entries stay and are still counted'} until given, then ${n === 1 ? 'it follows' : 'they follow'}.`
        : `Not on the 2B Reconciliation ledger, ${n} ${n === 1 ? 'row' : 'rows'} (${list}): ${reason}.`;
    });
  };
  return [...group(true), ...group(false)];
}

/**
 * A books row of the open month saved with its pairing in one call
 * (twob_import2b_save_book): the 2B document it leaves released, the one it
 * pairs with paired, and the row saved, with their write-throughs, or none of
 * it (a refusal names the entry and what to undo). expect: the row's columns
 * as the page loaded it (bookExpect); the database saves nothing, and this
 * throws "was changed elsewhere", when the row no longer holds them
 * (verification round 5). Throws with the database's words. pairedWas: the
 * paired document's treatment before (its amendments follow it); row: the
 * row as saved.
 */
export async function saveBookWithPairing(o: {
  actorId: string; bookId: string; values: Record<string, string | number | null>;
  releaseDocId?: string | null; pairDocId?: string | null; expect?: Record<string, string | number | null> | null;
}): Promise<{ pairedWas: string | null; row: Record<string, unknown> | null }> {
  const { data, error } = await supabase.rpc('twob_import2b_save_book', {
    p_actor_id: o.actorId, p_book_id: o.bookId, p_values: o.values as unknown as Json,
    p_release_doc_id: o.releaseDocId ?? null, p_pair_doc_id: o.pairDocId ?? null,
    p_expect: (o.expect ?? null) as unknown as Json,
  });
  if (error) throw new Error(error.message);
  const d = (data || {}) as Raw;
  const row = d.row && typeof d.row === 'object' ? d.row as Record<string, unknown> : null;
  return { pairedWas: typeof d.paired_was === 'string' ? d.paired_was : null, row };
}

/** The refusals as sentences ("SUPPLIER INV-1: Oct-26 has booked this entry; undo that book entry first."). */
export const catchUpRefusalLines = (r: CatchUpResult) => r.refusals.map((x) => `${x.entry ? `${x.entry}: ` : ''}${x.message}.`);

/**
 * What the month's 2B Reconciliation ledger lacks to follow its Import 2B
 * (twob_import2b_step: one statement, so a save landing meanwhile is wholly
 * in it or not at all): per list the entries a save or "Bring the
 * reconciliation up to date" would add, link, change, take back and put
 * back, and up to four of their names. prior: the month is filed.
 */
export interface StepResult {
  prior: boolean;
  bills2B: ListCounts & { names: string[] };
  billsBooks: ListCounts & { names: string[] };
}

const stepList = (v: unknown): ListCounts & { names: string[] } => {
  const d = (v || {}) as Raw;
  return { ...counts(d), names: Array.isArray(d.names) ? d.names.map(String) : [] };
};

/** Reads the month's step (twob_import2b_step). Throws with the database's words. */
export async function fetchStep(clientId: string, period: string): Promise<StepResult | null> {
  const { data, error } = await supabase.rpc('twob_import2b_step', { p_client_id: clientId, p_period: period });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const d = data as Raw;
  return { prior: d.prior === true, bills2B: stepList(d.bills_not_in_2b), billsBooks: stepList(d.bills_not_in_books) };
}

/** Post's plan (planImport2BPost) as a step, for checks that build a plan by hand. */
export function stepFromPlan(plan: PostPlan, prior = false): StepResult {
  const names = (rows: { row: { supplier_name: string | null; supplier_invoice_number: string | null } }[]) =>
    [...new Set(rows.map(({ row }) => [(row.supplier_name || '').trim(), row.supplier_invoice_number].filter(Boolean).join(' ')).filter(Boolean))].sort().slice(0, 4);
  return {
    prior,
    bills2B: { add: plan.insertBills2B.length, link: 0, change: plan.updateBills2B.length, remove: plan.retractBills2B.length, unlink: 0,
      names: names([...plan.insertBills2B, ...plan.updateBills2B]) },
    billsBooks: { add: plan.insertBillsBooks.length, link: 0, change: plan.updateBillsBooks.length, remove: plan.retractBillsBooks.length, unlink: 0,
      names: names([...plan.insertBillsBooks, ...plan.updateBillsBooks]) },
  };
}

const listText = (c: ListCounts) => countsText(c);

/**
 * The plain line a month out of step shows on Import 2B (null: in step), from
 * the month's step. In a filed month only the Not in 2B side can be
 * brought up to date (through the door, by a GST Manager or the superadmin);
 * its Not in Books side follows the filed 2B, which nothing on this page can
 * change, so it is left out of the line (a line no one can clear would stay
 * for good; the migration's header lists those months for the lead).
 */
export function outOfStepLine(step: StepResult | null, isPrior: boolean): { text: string; actionable: boolean } | null {
  if (!step) return null;
  const n2b = listText(step.bills2B);
  const nib = listText(step.billsBooks);
  if (isPrior) {
    if (!n2b) return null;
    return {
      text: `The Not in 2B list of this filed month's 2B Reconciliation ledger is not in step with its Import 2B books register (saved before saves wrote through): ${n2b}.`,
      actionable: true,
    };
  }
  if (!n2b && !nib) return null;
  return {
    text: `The 2B Reconciliation ledger is not in step with this month's Import 2B (saved before saves wrote through, or changed on 2B Reconciliation since): `
      + [n2b && `Not in 2B ${n2b}`, nib && `Not in Books ${nib}`].filter(Boolean).join('; ') + '.',
    actionable: true,
  };
}

/**
 * A filed month's Not in Books side out of step, named for the confirm of
 * "Bring the reconciliation up to date" there (it follows the filed 2B and
 * does not change); null when in step.
 */
export function priorStepLeftOut(step: StepResult | null): string | null {
  if (!step) return null;
  const c = step.billsBooks;
  const n = c.add + c.link + c.change + c.remove + (c.unlink || 0);
  if (n === 0) return null;
  const parts = [
    c.add && `${c.add} not on it`,
    c.link && `${c.link} on it but not linked to ${c.link === 1 ? 'its' : 'their'} 2B document`,
    c.change && `${c.change} at other figures`,
    c.remove + (c.unlink || 0) && `${c.remove + (c.unlink || 0)} on it that the 2B documents no longer post`,
  ].filter(Boolean).join(', ');
  const names = c.names.slice(0, 4);
  return `This filed month's Not in Books list differs from its 2B documents for ${n} ${n === 1 ? 'entry' : 'entries'} (${parts}${names.length ? `: ${names.join(', ')}${n > names.length ? ' and more' : ''}` : ''}). It follows the filed 2B, not the books, and does not change here.`;
}

/** Import 2B's Delete 2B in one call (twob_import2b_delete_2b). Throws with the database's words. */
export async function deleteImported2BMonth(actorId: string, clientId: string, period: string): Promise<{ deleted: number; keptFiled: number }> {
  const { data, error } = await supabase.rpc('twob_import2b_delete_2b', { p_actor_id: actorId, p_client_id: clientId, p_period: period });
  if (error) throw new Error(error.message);
  const d = (data || {}) as Raw;
  return { deleted: Number(d.deleted) || 0, keptFiled: Number(d.kept_filed) || 0 };
}

/**
 * 2B Reconciliation's Clear Data in one call (twob_clear_year): the year's
 * open months cleared and the entries Import 2B posts written again at once;
 * filed months kept. Throws with the database's words.
 */
export async function clearYear(actorId: string, clientId: string, months: string[]): Promise<{ deleted: number; reposted: number; cleared: string[]; kept: string[] }> {
  const { data, error } = await supabase.rpc('twob_clear_year', { p_actor_id: actorId, p_client_id: clientId, p_months: months });
  if (error) throw new Error(error.message);
  const d = (data || {}) as Raw;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return { deleted: Number(d.deleted) || 0, reposted: Number(d.reposted) || 0, cleared: list(d.cleared), kept: list(d.kept) };
}

/**
 * The month's version brought up to date once a save is done
 * (twob_import2b_flush_version; coalesced per minute). Never throws: a
 * version is an audit record, and a failure here must not hide a save that
 * went through. Returns the current version, or null.
 */
export async function flushVersion(actorId: string | null, clientId: string, period: string): Promise<{ version: number | null; at: string | null } | null> {
  try {
    const { data, error } = await supabase.rpc('twob_import2b_flush_version', { p_actor_id: actorId, p_client_id: clientId, p_period: period });
    if (error) return null;
    const d = (data || {}) as Raw;
    return { version: typeof d.version === 'number' ? d.version : null, at: typeof d.at === 'string' ? d.at : null };
  } catch {
    return null;
  }
}

// ---- Who may save what (Import 2B & post; verification round 3) ---------------
// A save that changes the 2B Reconciliation ledger needs the Import 2B & post
// permission (work_2b_import), as Post did; the database refuses the rest of
// them for a user without it (twob__autopost_touch) and lets every save that
// changes nothing on the ledger through, as before this change. The page
// asks the same up front, so an employee without the permission keeps the
// saves that change nothing there (another treatment between Matched,
// Mismatched, Ineligible, ITC of Others and Held; a Mismatched or Not
// Eligible books row; a Not in 2B row still without a date or supplier) and
// is told which ones need it.

/** What an employee without Import 2B & post reads on Import 2B: which saves change the ledger. */
export const LEDGER_SAVES_NOTE = 'Saves that change the 2B Reconciliation ledger need the Import 2B & post permission (ask a GST Manager to add it to your position): '
  + 'a 2B document put into or taken out of Not in Books (or out of Reclaim), or its counted figures while Not in Books; '
  + 'a books row that is Not in 2B with a date and supplier (added, edited, its Type or treatment changed), or one already on the ledger; '
  + 'deleting a books row whose entry would leave the ledger. '
  + 'You can still save the rest as before: a treatment between Matched, Mismatched, Ineligible, ITC of Others and Held, '
  + 'books rows that are Mismatched or Not Eligible, and Not in 2B rows not yet complete. Pending items stay open to you.';

/** Said when a save that would change the ledger is refused up front. */
export const NEEDS_POST_SAVE_MSG = 'Not saved: this change would change the 2B Reconciliation ledger, which needs the Import 2B & post permission. Ask a GST Manager to add it to your position.';

/**
 * Whether changing a 2B document's treatment changes the 2B Reconciliation
 * ledger (the database's write-through, twob__autopost_plan_docs): into Not
 * in Books when the document posts (a date and supplier, and not an
 * amendment that changes no figure), out of Not in Books when it has an
 * entry, and out of Reclaim (the entry it reclaims goes back to Awaiting
 * reclaim). hasEntry: the document has an entry on the ledger (posted
 * before). Into Reclaim is the reclaim's own call, open to every staff
 * level as Pending items' Link & Reclaim is: it changes the ledger only
 * when the document had an entry (taken back with it).
 */
export function docChangeTouchesLedger(
  doc: TwobDocLike & { date?: string | null; supplier_name?: string | null },
  from: string, to: string, hasEntry: boolean,
): boolean {
  if (from === to) return false;
  if (from === 'RECLAIM') return true;
  if (to === 'NOT_IN_BOOKS') return hasEntry || (!docNotPostedReason(doc) && !docChangesNothing(doc));
  if (from === 'NOT_IN_BOOKS') return hasEntry;
  return false;
}

/**
 * Whether saving a books row (as it will be saved: treatment, type, date,
 * supplier and amounts) changes the ledger (twob__autopost_plan_books): a row
 * with an entry on the ledger (it is changed or taken back), or a Not in 2B
 * row that posts (not a debit note, no minus amount, a date and a supplier).
 * pairsNibWithEntry: the save pairs it with a 2B document that is Not in
 * Books with an entry (the document turns Mismatched and its entry leaves).
 */
export function bookSaveTouchesLedger(
  after: { book_treatment: string; doc_type?: string | null; date?: string | null; supplier_name?: string | null;
    taxable_value?: number | null; input_igst?: number | null; input_cgst?: number | null; input_sgst?: number | null },
  hasEntry: boolean, pairsNibWithEntry = false,
): boolean {
  if (hasEntry || pairsNibWithEntry) return true;
  return after.book_treatment === 'NOT_IN_2B' && bookNotPostedReason(after) === null;
}
