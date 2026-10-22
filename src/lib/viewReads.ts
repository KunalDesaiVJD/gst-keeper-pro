// A page that shows one (client, month) at a time, and reads it again after
// each save: every read is keyed to the (client, month) it was started for,
// so a result for another one is dropped, and a read for a (client, month)
// no longer shown never overtakes the reads of the one that is (Import 2B,
// verification round 3: a books save of Oct-26 still in flight when the
// month was switched to Sep-26 numbered its refresh after Sep's load, so
// Sep's load dropped its own ledger side and the page went on showing Oct's
// Pending items, with working buttons, under Sep-26).

/** The key of a (client, month). */
export const viewKey = (clientId: string | null | undefined, month: string | null | undefined): string =>
  `${clientId || ''}|${month || ''}`;

export interface ViewReads {
  /**
   * Starts a read of `view`: its ticket, or null when `view` is not the one
   * shown (nothing is counted then, so it overtakes nothing).
   */
  begin(view: string): number | null;
  /** Whether a read's result may be shown: its view is still shown and no newer read of it began. */
  isLatest(view: string, ticket: number | null): boolean;
}

/**
 * Numbered reads of the view `shown()` returns. One count for every read,
 * never restarted, and the latest read begun for each view: a read from an
 * earlier visit to a view (switched away and back while it was in flight)
 * is never the latest of the later visit (verification round 4: the count
 * restarted when a view was shown again, so an Oct-26 refresh held from the
 * first visit carried the same number as one of the second visit's and
 * landed over it, showing an entry expensed out meanwhile as still awaiting
 * reclaim, with working buttons).
 */
export function createViewReads(shown: () => string): ViewReads {
  let n = 0;
  const latest = new Map<string, number>();
  return {
    begin(v) {
      if (v !== shown()) return null;
      n += 1;
      latest.set(v, n);
      return n;
    },
    isLatest(v, ticket) {
      return ticket !== null && latest.get(v) === ticket && v === shown();
    },
  };
}
