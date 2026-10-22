// Import 2B's own saves, each made only while the row still holds what the
// page loaded (verification round 5; docs/2B_RECONCILIATION_FLOW.md §15).
// Every save now writes through to the 2B Reconciliation ledger at once, so a
// stale tab writing its old copy back changes the ledger too. So:
//  - a 2B document's treatment is written only while it still holds the
//    treatment the page loaded; a document leaving Reclaim goes through
//    twob_import2b_unreclaim (its reclaim released with it), which refuses
//    one no longer Reclaim; the database also refuses a document leaving
//    Reclaim while an entry is reclaimed against it, whoever writes
//    (twob__reclaim_evidence_guard);
//  - a books register row sends only the columns the user changed, and only
//    while the row holds every column as the page loaded it (the
//    twob_import2b_save_book and twob_import2b_prior_save calls check the
//    same, p_expect).
// What is not written is named as changed elsewhere; the page then shows
// the row (or the month) as it is now.
import { supabase } from '@/integrations/supabase/client';
import { releaseReclaim } from '@/lib/twobPendingWrites';

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

/** One document's staged treatment: from (as the page loaded it) to (the pick). */
export interface DocTreatmentChange { id: string; from: string; to: string }

/** Said of documents not saved because their treatment changed since the page loaded them. */
export const DOC_CHANGED_ELSEWHERE_MSG = 'changed elsewhere since the page showed them (another tab or another user), so they were not saved. The page shows the month as it is now.';

/**
 * Saves staged treatments of the open month's 2B documents, each only while
 * the document still holds the treatment the page loaded (`from`): grouped
 * by (from, to), one conditional write per group and chunk; out of Reclaim
 * one call per document (twob_import2b_unreclaim: the entry it evidences back
 * in Awaiting reclaim with it). saved: written; changed: not written, the
 * document no longer holding `from` (or gone); error: a write failed (the
 * rest not tried), with what was saved before it.
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
      const res = await releaseReclaim({ actorId: o.actorId, clientId: o.clientId, period: o.period, docId: c.id, action: c.to });
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
