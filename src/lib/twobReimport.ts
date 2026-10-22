// Import 2B's re-import (a merge into the month): which documents the
// earlier import holds that the new file no longer has are kept, not deleted
// (docs/2B_RECONCILIATION_FLOW.md §15).
//
// Kept, and listed for staff to decide: a Reclaim; a document with a Not in
// Books entry on the 2B Reconciliation ledger (any entry, whatever it holds:
// verification round 3 put back the rule Import 2B had before saves wrote
// through, since a re-import cannot tell a document that has left 2B from
// one the file missed, and deleting it took its entry off the ledger with
// nothing said); one a reclaim names as its evidence; and one an amendment
// is counted against, when that amendment stays itself (one in another
// month, one of this month the merge still points at it by the link it
// writes, or a stale one kept in turn). A posting stamp alone does not keep
// a row, and neither does a books pairing (a soft link: the re-match turns
// that books row Not in 2B), so a document that has left 2B stops counting
// in rows 5.1 and 5.3.

export interface StaleKeepInput {
  /** The earlier import's documents the file no longer has. */
  stale: readonly { id: string; itc_action: string }[];
  /** source_doc_id of every Not in Books entry that names one of them. */
  ledgerEntryDocIds: Iterable<string>;
  /** reclaimed_via_doc_id of every Not in 2B entry that names one of them. */
  reclaimEvidenceDocIds: Iterable<string>;
  /** Documents (any month) whose amends_doc_id is one of them. */
  dependants: readonly { id: string; amends_doc_id: string }[];
  /** The amends link the merge writes for each document it keeps (by id). */
  writtenLink: ReadonlyMap<string, string | null>;
}

/** The ids of the stale documents to keep. */
export function staleDocsToKeep(o: StaleKeepInput): Set<string> {
  const staleIds = new Set(o.stale.map((e) => e.id));
  const keep = new Set(o.stale.filter((e) => e.itc_action === 'RECLAIM').map((e) => e.id));
  for (const id of o.ledgerEntryDocIds) if (staleIds.has(id)) keep.add(id);
  for (const id of o.reclaimEvidenceDocIds) if (staleIds.has(id)) keep.add(id);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of o.dependants) {
      if (keep.has(r.amends_doc_id) || !staleIds.has(r.amends_doc_id)) continue;
      if (o.writtenLink.has(r.id) && o.writtenLink.get(r.id) !== r.amends_doc_id) continue;
      if (staleIds.has(r.id) && !keep.has(r.id)) continue;
      keep.add(r.amends_doc_id);
      grew = true;
    }
  }
  return keep;
}

/** The warning for the documents kept: what keeps them, and that staff decide. */
export const KEPT_REASONS = 'a reclaim, a Not in Books entry on the 2B Reconciliation ledger, or a later amendment';
