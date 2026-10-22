// Import 2B's own saves, each made only while the row still holds what the
// page loaded (verification round 5; docs/2B_RECONCILIATION_FLOW.md §15).
// Every save now writes through to the 2B Reconciliation ledger at once, so a
// stale tab writing its old copy back changes the ledger too. So:
//  - a 2B document's treatment is written only while it still holds the
//    treatment the page loaded; a document leaving Reclaim goes through
//    twob_import2b_unreclaim (its reclaim released with it), which refuses
//    one no longer Reclaim, or evidencing another reclaim than the one the
//    page showed (verification round 7: loadReclaimEvidence); the database
//    also refuses a document leaving Reclaim while an entry is reclaimed
//    against it, whoever writes (twob__reclaim_evidence_guard);
//  - a books register row sends only the columns the user changed, and only
//    while the row holds every column as the page loaded it (the
//    twob_import2b_save_book and twob_import2b_prior_save calls check the
//    same, p_expect).
// What is not written is named as changed elsewhere; the page then shows
// the row (or the month) as it is now.
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { releaseReclaim } from '@/lib/twobPendingWrites';
import { canEvidenceReclaim } from '@/lib/twobDocs';
import { periodMonthLabel } from '@/lib/postImport2B';

/** Filters on columns named at run time, typed loosely (the generated table types go too deep). */
type LooseFilter = {
  eq(c: string, v: unknown): LooseFilter;
  is(c: string, v: null): LooseFilter;
  in(c: string, v: unknown[]): LooseFilter;
  select(c: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};
const loose = (q: unknown): LooseFilter => q as LooseFilter;

const chunk = <T,>(a: T[], n = 200): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

// ---- 2B documents' treatments ------------------------------------------------

/**
 * One document's staged treatment: from (as the page loaded it) to (the
 * pick). expectEntry, for a document leaving Reclaim: the entry whose
 * reclaim the page shows it evidencing (loadReclaimEvidence), or null when
 * it shows none.
 */
export interface DocTreatmentChange { id: string; from: string; to: string; expectEntry?: string | null }

/** A reclaim recorded with a 2B document (the entry naming it), as the page shows it. */
export interface ReclaimEvidence {
  id: string;
  reclaimed_via_doc_id: string;
  supplier_name: string | null;
  supplier_invoice_number: string | null;
  reversal_month: string | null;
  reclaim_month: string | null;
  period_month: string;
}

/**
 * The reclaim each of the client's 2B documents evidences, by document id
 * (the entry naming it; the first by id where a pair was recorded before
 * the one-reclaim rule). Read with the month's ledger side, and sent back
 * when a document leaves Reclaim (verification round 7). Throws when the
 * read fails.
 */
export async function loadReclaimEvidence(clientId: string): Promise<Map<string, ReclaimEvidence>> {
  const rows = await fetchAllRows<ReclaimEvidence>('bills_not_in_2b',
    'id, reclaimed_via_doc_id, supplier_name, supplier_invoice_number, reversal_month, reclaim_month, period_month', (q) => q
      .eq('client_id', clientId).not('reclaimed_via_doc_id', 'is', null).order('id'));
  const out = new Map<string, ReclaimEvidence>();
  for (const r of rows) if (!out.has(r.reclaimed_via_doc_id)) out.set(r.reclaimed_via_doc_id, r);
  return out;
}

/** "SUPPLIER X-1 (reversed Sep 26, reclaimed Oct 26)": a reclaim as the page names it. */
export const reclaimEvidenceName = (e: ReclaimEvidence): string => {
  const name = [e.supplier_name, e.supplier_invoice_number].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ') || 'an entry';
  const when = [e.reversal_month && `reversed ${e.reversal_month}`, e.reclaim_month && `reclaimed ${e.reclaim_month}`].filter(Boolean).join(', ');
  return when ? `${name} (${when})` : name;
};

// ---- Reclaim documents that evidence no reclaim (verification round 10) ----

/**
 * The 2B documents Pending items' Link & Reclaim offers an entry: the
 * month's Matched and Mismatched original invoices and debit notes, and its
 * Reclaim ones that evidence no reclaim (no entry names them: a Restore, or
 * Clear Data, leaves a document so, its ITC counted nowhere; the Restore
 * says "reclaim it again on Import 2B", and the document's own select,
 * already showing Reclaim, cannot open the dialog). Reclaiming with one
 * changes nothing on the document (twob_import2b_reclaim, sent Reclaim as
 * the treatment the page shows). One with a change staged is left out until
 * it is saved.
 */
export function reclaimCandidateDocs<D extends { id: string; itc_action: string | null; doc_type?: string | null; is_amendment?: boolean | null }>(
  docs: readonly D[], evidence: ReadonlyMap<string, unknown>, staged: Readonly<Record<string, string>>,
): D[] {
  return docs.filter((d) => canEvidenceReclaim(d)
    && (d.itc_action === 'MATCHED' || d.itc_action === 'MISMATCHED'
      || (d.itc_action === 'RECLAIM' && !evidence.has(d.id) && !staged[d.id])));
}

/**
 * How many of the client's entries are reclaimed in this month without
 * naming a 2B document (a reclaim typed on 2B Reconciliation, or recorded
 * before a reclaim named its document): a Reclaim document no entry names
 * may be one of theirs. null when the read fails.
 */
export async function countUnlinkedReclaims(clientId: string, month: string): Promise<number | null> {
  const label = periodMonthLabel(month);
  if (!label) return null;
  const { count, error } = await supabase.from('bills_not_in_2b').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('reclaim_month', label).is('reclaim_subtype', null).is('reclaimed_via_doc_id', null);
  return error ? null : (count ?? 0);
}

/**
 * The note on a Reclaim original invoice or debit note that evidences no
 * reclaim: not in 5.1, and no entry reclaims it in 5.4, so its ITC counts
 * nowhere, unless one of the month's reclaims that name no document
 * (unlinked; null: not known) is this one. canAct: the page may change the
 * month (an open month), so it says what to do.
 */
export function reclaimNoEvidenceNote(unlinked: number | null, canAct: boolean): string {
  const what = canAct ? ': Link & Reclaim an entry with it (Pending items), or take it out of Reclaim' : '';
  if (unlinked === 0) return `Reclaim, but evidences no reclaim, so its ITC counts nowhere${what}`;
  const unless = unlinked == null ? 'a reclaim of this month recorded without its 2B document is this one'
    : unlinked === 1 ? 'the one reclaim of this month recorded without its 2B document is this one'
      : `one of the ${unlinked} reclaims of this month recorded without their 2B document is this one`;
  return `Reclaim, but no entry names it as its reclaim's evidence: unless ${unless}, its ITC counts nowhere${what}`;
}

/** Said of documents not saved because their treatment changed since the page loaded them. */
export const DOC_CHANGED_ELSEWHERE_MSG = 'changed elsewhere since the page showed them (another tab or another user), so they were not saved. The page shows the month as it is now.';

/**
 * Saves staged treatments of the open month's 2B documents, each only while
 * the document still holds the treatment the page loaded (`from`): grouped
 * by (from, to), one conditional write per group and chunk; out of Reclaim
 * one call per document (twob_import2b_unreclaim: the entry it evidences back
 * in Awaiting reclaim with it), only while the reclaim it evidences is the
 * one the page showed (`expectEntry`). saved: written; changed: not written,
 * the document no longer holding `from`, or evidencing another reclaim (or
 * gone); error: a write failed (the rest not tried), with what was saved
 * before it.
 */
export async function saveDocTreatments(o: {
  actorId: string; clientId: string; period: string; changes: DocTreatmentChange[];
}): Promise<{ saved: string[]; changed: string[]; error: string | null }> {
  const saved: string[] = [];
  const changed: string[] = [];
  const nowIso = new Date().toISOString();
  const groups = new Map<string, DocTreatmentChange[]>();
  for (const c of o.changes) {
    if (c.from === c.to) continue;
    if (c.from === 'RECLAIM') continue;
    const k = `${c.from}\u0000${c.to}`;
    groups.set(k, [...(groups.get(k) || []), c]);
  }
  try {
    for (const list of groups.values()) {
      const { from, to } = list[0];
      for (const part of chunk(list.map((c) => c.id))) {
        const { data, error } = await loose(supabase.from('twob_import_docs')
          .update({ itc_action: to, updated_by: o.actorId, updated_at: nowIso } as never))
          .in('id', part).eq('client_id', o.clientId).eq('period_month', o.period).eq('itc_action', from)
          .select('id');
        if (error) return { saved, changed, error: error.message };
        const wrote = new Set(((data || []) as { id: string }[]).map((r) => r.id));
        part.forEach((id) => (wrote.has(id) ? saved : changed).push(id));
      }
    }
    for (const c of o.changes.filter((x) => x.from === 'RECLAIM' && x.to !== 'RECLAIM')) {
      const res = await releaseReclaim({
        actorId: o.actorId, clientId: o.clientId, period: o.period, docId: c.id, action: c.to, expectEntry: c.expectEntry ?? null,
      });
      if (res.ok) saved.push(c.id);
      else if (res.gone) changed.push(c.id);
      else return { saved, changed, error: res.message };
    }
  } catch (err) {
    return { saved, changed, error: err instanceof Error ? err.message : String(err) };
  }
  return { saved, changed, error: null };
}

// ---- Books register rows ----------------------------------------------------

/** The columns of a books row a save writes and is guarded by. */
export const BOOK_SAVE_COLUMNS = [
  'date', 'supplier_name', 'supplier_invoice_number', 'supplier_gstin', 'taxable_value', 'input_igst', 'input_cgst',
  'input_sgst', 'doc_type', 'book_treatment', 'matched_2b_id',
] as const;
export type BookSaveColumn = (typeof BOOK_SAVE_COLUMNS)[number];
export type BookValues = Partial<Record<BookSaveColumn, string | number | null>>;
/** A books row as loaded (any object with its columns). */
type RowLike = object;
const cell = (r: RowLike, k: string): unknown => (r as Record<string, unknown>)[k];

const AMOUNTS = new Set<string>(['taxable_value', 'input_igst', 'input_cgst', 'input_sgst']);
const docType = (v: unknown) => (v === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'INVOICE');
/** Two values of one column alike, as the page saves them: amounts as numbers (none is 0), text with none as empty, the type as invoice or debit note. */
const same = (k: string, a: unknown, b: unknown): boolean => {
  if (AMOUNTS.has(k)) return Number(a || 0) === Number(b || 0);
  if (k === 'doc_type') return docType(a) === docType(b);
  return String(a ?? '') === String(b ?? '');
};

/** The row's save columns as the page loaded it (what a save is guarded by). */
export function bookExpect(loaded: RowLike): BookValues {
  const out: BookValues = {};
  for (const k of BOOK_SAVE_COLUMNS) {
    const v = cell(loaded, k);
    out[k] = v === undefined ? null : (v as string | number | null);
  }
  return out;
}

/** Only the columns of `next` that differ from the row as loaded: what a save sends (none: nothing to save). */
export function bookChanges(loaded: RowLike, next: BookValues): BookValues {
  const out: BookValues = {};
  for (const k of BOOK_SAVE_COLUMNS) {
    if (!(k in next)) continue;
    if (!same(k, next[k], cell(loaded, k))) out[k] = next[k] ?? null;
  }
  return out;
}

/** Said when a books row was changed or removed elsewhere since the page loaded it. */
export const bookChangedMsg = (row: RowLike) => `Nothing was saved: books row ${[cell(row, 'supplier_name'), cell(row, 'supplier_invoice_number')]
  .map((x) => String(x ?? '').trim()).filter(Boolean).join(' ') || '(no number)'} was changed elsewhere since this page loaded it (another tab or another user). The row is shown again as it is now.`;

/** Whether an error says a books row was changed elsewhere (the database's TWB04, or this page's own check). */
export const isBookChangedError = (message: string) => /^Nothing was saved: (books row .* was changed elsewhere|a books row this page shows is no longer)/.test(message);

/**
 * Saves the changed columns of an open month's books row (no pairing move),
 * only while the row holds every save column as loaded; the database writes
 * it through to the ledger in the same statement (or refuses, and throws).
 * ok: written, row as saved. Not ok: not written, the row changed or
 * removed elsewhere (message says so). Throws with the database's words.
 */
export async function saveBookGuarded<T extends RowLike>(o: { actorId: string; bookId: string; loaded: T; values: BookValues }):
  Promise<{ ok: boolean; row: T | null; message: string }> {
  let q = loose(supabase.from('books_register')
    .update({ ...o.values, updated_by: o.actorId, updated_at: new Date().toISOString() } as never)).eq('id', o.bookId);
  for (const [k, v] of Object.entries(bookExpect(o.loaded))) q = v === null ? q.is(k, null) : q.eq(k, v);
  const { data, error } = await q.select('*');
  if (error) throw new Error(error.message);
  const rows = (data || []) as T[];
  if (rows.length > 0) return { ok: true, row: rows[0], message: '' };
  return { ok: false, row: null, message: bookChangedMsg(o.loaded) };
}

// ---- One page's saves of one books row, one at a time (verification round 6) ----
//
// Two cells of a row left in quick succession (Tab past the SGST that CGST
// fills, or typing in a second cell before the first save lands) made two
// saves at once, each guarded by the row as loaded before either landed: the
// second was refused as changed elsewhere ("another tab or another user"),
// the row reloaded and its typing lost. Now each save of a row waits for this
// page's save of it before, then puts the user's edits (typed against the row
// as the page held it at that moment) on the row as that save left it.

/** Tasks run one at a time per key, in the order queued; a task failing does not stop the next. */
export class RowQueue {
  private tails = new Map<string, Promise<void>>();

  run<R>(key: string, task: () => Promise<R>): Promise<R> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const out = prev.then(task);
    const tail = out.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return out;
  }

  /** Whether a task of this key is queued or running. */
  busy(key: string): boolean {
    return this.tails.has(key);
  }
}

/** A page's books saves (React refs, read when each save runs): the rows as loaded or last saved, this
 * page's saves as they landed and when each row was last shown again as it is, on one clock; the queue. */
export interface BookSaveState<T extends RowLike> {
  loaded: { current: Map<string, T> };
  saves: { current: Map<string, { at: number; row: T }> };
  shownAgain: { current: Map<string, number> };
  clock: { current: number };
  queue: { current: RowQueue };
}

/** A books save landed: the row as saved is what the next save of it starts from and is guarded by. */
export function bookLanded<T extends RowLike & { id: string }>(st: BookSaveState<T>, row: T): void {
  st.clock.current += 1;
  st.saves.current.set(row.id, { at: st.clock.current, row });
  st.loaded.current.set(row.id, row);
}

/** A books row shown again as it is (a refusal, a Cancel): a save of it queued before this is dropped. */
export function bookShownAgain<T extends RowLike>(st: BookSaveState<T>, id: string): void {
  st.clock.current += 1;
  st.shownAgain.current.set(id, st.clock.current);
}

/**
 * One books save from the page. The user's edits (next: the row's save
 * columns as on screen) are taken now, against the row as the page holds it
 * now; the save runs after this page's earlier save of the row has landed,
 * on the row as that save left it (rebaseBookEdit). save: the page's own
 * save (loaded: the row it is guarded by; row: the edits on it). refuse: the
 * row was not loaded, or changed elsewhere since (base: the row as the page
 * held it); said, and shown again. A save queued before the row was shown
 * again is dropped (false), nothing said.
 */
export function queueBookSave<T extends RowLike & { id: string }>(st: BookSaveState<T>, o: {
  id: string; next: BookValues; save: (loaded: T, row: T) => Promise<boolean>; refuse: (base: T | undefined) => Promise<void>;
}): Promise<boolean> {
  const base = st.loaded.current.get(o.id);
  const typed = base ? bookChanges(base, o.next) : {};
  const at = st.clock.current;
  return st.queue.current.run(o.id, async () => {
    if (!base) { await o.refuse(undefined); return false; }
    const own = st.saves.current.get(o.id);
    const now = st.loaded.current.get(o.id);
    const rb = rebaseBookEdit({
      base, typed, now, ownSince: own && own.at > at ? own.row : null, shownAgain: (st.shownAgain.current.get(o.id) ?? -1) > at,
    });
    if (rb.kind === 'shown-again') return false;
    if (rb.kind === 'changed' || !now) { await o.refuse(base); return false; }
    return o.save(now, rb.row);
  });
}

/** Whether two books rows hold the same values in every save column. */
export const sameBookRow = (a: RowLike, b: RowLike): boolean => BOOK_SAVE_COLUMNS.every((k) => same(k, cell(a, k), cell(b, k)));

/**
 * The row a queued books save starts from. base: the row as the page held it
 * (loaded or last saved) when the user left the cell; typed: the user's edits
 * against base (bookChanges); now: the row as the page holds it now; ownSince:
 * the row as this page's own save left it, when one landed since; shownAgain:
 * the row was shown again as it is (a refusal, a Cancel) since.
 *  - ok: now is base, or what this page's own save made of it: the edits go
 *    on it, and the save is guarded by it;
 *  - shown-again: dropped, nothing said (the refusal or Cancel said it);
 *  - changed: now is neither (a reload brought another user's change):
 *    refused as changed elsewhere.
 */
export function rebaseBookEdit<T extends RowLike>(o: {
  base: T; typed: BookValues; now: T | undefined; ownSince: T | null; shownAgain: boolean;
}): { kind: 'ok'; row: T } | { kind: 'shown-again' } | { kind: 'changed' } {
  if (o.shownAgain) return { kind: 'shown-again' };
  if (!o.now) return { kind: 'changed' };
  if (o.now === o.base || sameBookRow(o.now, o.base) || (o.ownSince !== null && sameBookRow(o.now, o.ownSince))) {
    return { kind: 'ok', row: { ...o.now, ...o.typed } as T };
  }
  return { kind: 'changed' };
}
