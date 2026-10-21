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
//  - twob_import2b_reclaim (src/lib/twobPendingWrites.ts): a reclaim, the
//    entry and its 2B document together.
// Every save that changes the ledger needs the Import 2B & post permission
// (work_2b_import), as Post did; the database refuses it otherwise.
// A prior month's books rows are saved with their write-through through the
// door (twob_import2b_prior_save, src/lib/twobPriorMonth.ts).
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { PostPlan } from '@/lib/postImport2B';
import { planCountsText } from '@/lib/postImport2B';

type Raw = Record<string, unknown>;

export interface ListCounts { add: number; link: number; change: number; remove: number }
export interface CatchUpResult {
  dryRun: boolean;
  written: number;
  bills2B: ListCounts;
  billsBooks: ListCounts;
  /** Rows not posted, with Post's reason (no date or supplier, a books debit note, a minus row). */
  skipped: { list: string; id: string; number: string | null; reason: string }[];
  /** Entries a catch-up would take back that hold a reclaim, Expense out or book entry: nothing is written. */
  refusals: { entry: string | null; message: string }[];
  /** Where to undo what the refusals name (Import 2B's Pending items, or the reclaiming document). */
  undoHint: string | null;
  version: number | null;
}

const counts = (v: unknown): ListCounts => {
  const d = (v || {}) as Raw;
  return { add: Number(d.add) || 0, link: Number(d.link) || 0, change: Number(d.change) || 0, remove: Number(d.remove) || 0 };
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
      return { list: String(r.list), id: String(r.id), number: typeof r.number === 'string' ? r.number : null, reason: String(r.reason) };
    }),
    refusals: (Array.isArray(d.refusals) ? d.refusals : []).map((x) => {
      const r = x as Raw;
      return { entry: typeof r.entry === 'string' ? r.entry : null, message: String(r.message) };
    }),
    undoHint: typeof d.undo_hint === 'string' ? d.undo_hint : null,
    version: typeof d.version === 'number' ? d.version : null,
  };
};

/**
 * An open month out of step brought up to date (twob_import2b_catch_up),
 * staff with Import 2B & post only. dryRun: what it would write. Throws with
 * the database's words.
 */
export async function catchUpMonth(actorId: string, clientId: string, period: string, dryRun: boolean): Promise<CatchUpResult> {
  const { data, error } = await supabase.rpc('twob_import2b_catch_up', {
    p_actor_id: actorId, p_client_id: clientId, p_period: period, p_dry_run: dryRun,
  });
  if (error) throw new Error(error.message);
  return parseCatchUp(data);
}

/** "1 added, 2 changed, 1 removed": what a list had done to it; '' when nothing. */
export function doneCountsText(ins: number, upd: number, ret: number): string {
  return [ins && `${ins} added`, upd && `${upd} changed`, ret && `${ret} removed`].filter(Boolean).join(', ');
}

/**
 * The preview ("Not in 2B: 1 to add, 2 to remove. Not in Books: 3 to add (1
 * linked to an entry already on the ledger).") or, once applied (done), what
 * was done ("Not in 2B: 1 added, 2 removed.").
 */
export function describeCatchUp(r: CatchUpResult, done = false): string {
  const part = (name: string, c: ListCounts) => {
    const text = done ? doneCountsText(c.add + c.link, c.change, c.remove) : planCountsText(c.add + c.link, c.change, c.remove);
    if (!text) return null;
    const linked = c.link
      ? ` (${c.link} already on the ledger as ${c.link === 1 ? 'an entry' : 'entries'} of their own, ${done ? 'linked' : 'to be linked'} instead of added again)`
      : '';
    return `${name}: ${text}${linked}.`;
  };
  return [part('Not in 2B', r.bills2B), part('Not in Books', r.billsBooks)].filter(Boolean).join(' ');
}

/**
 * A books row of the open month saved with its pairing in one call
 * (twob_import2b_save_book): the 2B document it leaves released, the one it
 * pairs with paired, and the row saved, with their write-throughs, or none of
 * it (a refusal names the entry and what to undo). Throws with the
 * database's words. pairedWas: the paired document's treatment before (its
 * amendments follow it).
 */
export async function saveBookWithPairing(o: {
  actorId: string; bookId: string; values: Record<string, string | number | null>;
  releaseDocId?: string | null; pairDocId?: string | null;
}): Promise<{ pairedWas: string | null }> {
  const { data, error } = await supabase.rpc('twob_import2b_save_book', {
    p_actor_id: o.actorId, p_book_id: o.bookId, p_values: o.values as unknown as Json,
    p_release_doc_id: o.releaseDocId ?? null, p_pair_doc_id: o.pairDocId ?? null,
  });
  if (error) throw new Error(error.message);
  const d = (data || {}) as Raw;
  return { pairedWas: typeof d.paired_was === 'string' ? d.paired_was : null };
}

/** The refusals as sentences ("SUPPLIER INV-1: Oct-26 has booked this entry; undo that book entry first."). */
export const catchUpRefusalLines = (r: CatchUpResult) => r.refusals.map((x) => `${x.entry ? `${x.entry}: ` : ''}${x.message}.`);

/**
 * The plain line a month out of step shows on Import 2B (null: in step), from
 * Post's plan of the month. In a filed month only the Not in 2B side can be
 * brought up to date (through the door, by a GST Manager or the superadmin);
 * its Not in Books side follows the filed 2B, which nothing on this page can
 * change, so it is left out of the line (a line no one can clear would stay
 * for good; the migration's header lists those months for the lead).
 */
export function outOfStepLine(plan: PostPlan | null, isPrior: boolean): { text: string; actionable: boolean } | null {
  if (!plan) return null;
  const n2b = planCountsText(plan.insertBills2B.length, plan.updateBills2B.length, plan.retractBills2B.length);
  const nib = planCountsText(plan.insertBillsBooks.length, plan.updateBillsBooks.length, plan.retractBillsBooks.length);
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
