// Prior months of Import 2B and 2B Reconciliation: the simple rule (firm's
// decision, 21 Oct 2026; docs/2B_RECONCILIATION_FLOW.md §13, migration
// 20261021100000_twob_prior_month_simple.sql).
//
// A month is prior when the client's GSTR-3B for it is Filed, a GSTR-3B (Q)
// is Filed for its quarter, or a later month's GSTR-3B is Filed (once Filed
// it stays prior when the sheets are unlocked). In a prior month only a GST
// Manager or the superadmin changes anything, and only books entries: the
// Not in 2B and Not in Books lists and the Import 2B books register. Every
// such change goes through one database function, twob_prior_books_apply,
// which applies it in the month and on every later month's carried copy of
// the entry, and is shown first as a preview ("Also changes Aug-26 (1)").
// The database refuses every other write to a prior month (twob_guard), for
// everyone, so the screens and the database agree: the screens read the
// month's state from twob_month_state, never work it out themselves.
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

/** The line a prior month shows, and the database's refusal of a direct write. */
export const PRIOR_MONTH_MSG = 'This month is filed. Only a GST Manager or the superadmin can change its books entries, from Import 2B or 2B Reconciliation.';

/** For the GST Manager / superadmin on a prior month. */
export const PRIOR_MONTH_MANAGER_MSG = 'This month is filed. You can change its books entries; each change also reaches the later months that hold the entry, and you see what it changes before it is saved. Its 2B documents and the reversal, reclaim and book entry months stay as filed.';

/** Why a 2B document control is off in a prior month. */
export const PRIOR_MONTH_DOCS_MSG = 'This month is filed. Its 2B documents and the reversal, reclaim and book entry months cannot change.';

/** Why a Not in Books entry posted from a 2B document cannot change in a prior month (it follows the filed 2B, not the books). */
export const PRIOR_NIB_FROM_2B_MSG = 'This Not in Books entry comes from a 2B document and follows the filed 2B, so it is neither changed nor removed in a filed month. Only books entries change.';

/**
 * Why a carried Not in Books copy cannot change in a prior month: it is a
 * copy of an invoice an earlier month holds as an entry from a 2B document,
 * and follows the filed 2B like that entry (twob_nib_2b_copies; docs §13).
 * Copies of typed entries, and copies whose entry is gone, change through
 * the door like any books entry.
 */
export const PRIOR_NIB_CARRIED_MSG = 'This Not in Books entry is a copy of an entry from a 2B document and follows the filed 2B, so it is neither changed nor removed in a filed month. Only books entries change.';

/** When the copies that follow a 2B document could not be read: every carried Not in Books entry stays read-only. */
export const PRIOR_NIB_UNKNOWN_MSG = 'Could not read whether this carried Not in Books entry follows a 2B document, so it is read-only here. Reload the page to try again.';

/**
 * Whether a Not in Books row of a prior month is read-only for everyone, and
 * why: one from a 2B document, or a carried copy that follows one
 * (follows2B: the month's such copies, from fetchNibFollows2B; null when they
 * could not be read, and then every carried copy is read-only).
 */
export const priorNibLockReason = (
  isPrior: boolean,
  row: { id?: string; source_doc_id?: string | null; is_carried_forward?: boolean | null },
  follows2B: ReadonlySet<string> | null = null,
): string | null => {
  if (!isPrior) return null;
  if (row.source_doc_id) return PRIOR_NIB_FROM_2B_MSG;
  if (!row.is_carried_forward) return null;
  if (!follows2B) return PRIOR_NIB_UNKNOWN_MSG;
  return row.id && follows2B.has(row.id) ? PRIOR_NIB_CARRIED_MSG : null;
};

/** The month's carried Not in Books rows that follow a 2B document (twob_nib_2b_copies). Throws when it cannot be read. */
export async function fetchNibFollows2B(clientId: string, period: string): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('twob_nib_2b_copies', { p_client_id: clientId, p_period: period });
  if (error) throw new Error(error.message);
  return new Set(((data || []) as string[]).map(String));
}

export interface TwobLaterMonth {
  period: string;
  rows2B: number;
  carried2B: number;
  rowsBooks: number;
  carriedBooks: number;
}

export interface TwobMonthState {
  /** The month is prior (filed, or a later month is filed). */
  isPrior: boolean;
  /** The latest prior month of the client (MM/YYYY), or null. */
  priorThrough: string | null;
  /** The later months that hold Not in 2B / Not in Books rows. */
  laterMonths: TwobLaterMonth[];
}

export const OPEN_MONTH: TwobMonthState = { isPrior: false, priorThrough: null, laterMonths: [] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "08/2026" -> "Aug-26". */
export const monthName = (period: string): string => {
  const [mm, yyyy] = (period || '').split('/');
  const m = Number(mm);
  return m >= 1 && m <= 12 && yyyy ? `${MONTHS[m - 1]}-${yyyy.slice(-2)}` : period;
};

/** "08/2026" -> "07/2026". */
const previousPeriod = (period: string): string => {
  const [mm, yyyy] = (period || '').split('/').map(Number);
  if (!mm || !yyyy) return period;
  return mm === 1 ? `12/${yyyy - 1}` : `${String(mm - 1).padStart(2, '0')}/${yyyy}`;
};

/** "08/2026" -> a number that orders months. */
export const periodKey = (period: string): number => {
  const [mm, yyyy] = (period || '').split('/').map(Number);
  return mm && yyyy ? yyyy * 12 + mm - 1 : NaN;
};

/** Whether a month is prior, by the client's latest prior month (twob_month_state's priorThrough). */
export const isPriorPeriod = (period: string, priorThrough: string | null): boolean =>
  !!priorThrough && periodKey(period) <= periodKey(priorThrough);

/** A GST Manager or the superadmin: the only ones who change a prior month's books entries. */
export const canChangePriorBooks = (role: string | null | undefined): boolean => role === 'superadmin' || role === 'gst_manager';

/**
 * Whether a 2B Reconciliation cell (date, supplier, number, GSTIN, amount) is
 * shown read-only. A carried entry's cells are read-only, except for the
 * superadmin and, in a prior month, for a GST Manager or the superadmin, who
 * correct carried entries there too (each Save goes through the door, which
 * reaches every later copy). editableForCF: a column carried entries may
 * always edit.
 */
export const ledgerCellReadOnly = (o: {
  readOnly: boolean; isCarriedForward: boolean; editableForCF: boolean;
  isSuperadmin: boolean; isPrior: boolean; canPriorBooks: boolean;
}): boolean => o.readOnly || (o.isCarriedForward && !o.editableForCF && !o.isSuperadmin && !(o.isPrior && o.canPriorBooks));

type Raw = Record<string, unknown>;

/** The month's state, as the database sees it. Throws when it cannot be read. */
export async function fetchTwobMonthState(clientId: string, period: string): Promise<TwobMonthState> {
  const { data, error } = await supabase.rpc('twob_month_state', { p_client_id: clientId, p_period: period });
  if (error) throw new Error(`Could not read whether ${monthName(period)} is filed: ${error.message}`);
  const d = (data || {}) as Raw;
  const later = Array.isArray(d.later_months) ? (d.later_months as Raw[]) : [];
  return {
    isPrior: d.is_prior === true,
    priorThrough: typeof d.prior_through === 'string' ? d.prior_through : null,
    laterMonths: later.map((m) => ({
      period: String(m.period),
      rows2B: Number(m.rows_2b) || 0,
      carried2B: Number(m.carried_2b) || 0,
      rowsBooks: Number(m.rows_books) || 0,
      carriedBooks: Number(m.carried_books) || 0,
    })),
  };
}

// ---- Books entries of a prior month -----------------------------------------

export type TwobBooksTable = 'bills_not_in_2b' | 'bills_not_in_books' | 'books_register';

/** One change as the database takes it. values: only the columns that change (insert: the new entry). */
export interface TwobChange {
  table: TwobBooksTable;
  op: 'insert' | 'update' | 'delete';
  id?: string;
  values?: Record<string, string | number | null>;
}

export interface TwobChangeResult {
  index: number;
  table: TwobBooksTable;
  op: TwobChange['op'];
  entry: string | null;
  /** This month: 'add' | 'change' | 'remove' | 'none' (nothing differed). */
  action: string | null;
  id: string | null;
  /** The later months' copies it reaches. */
  later: { period: string; action: string; id: string }[];
  /** A Not in 2B entry posted from Import 2B: what happens to its books register row ('remove' | 'change'), or null. */
  booksRow: string | null;
  refusal: string | null;
  /** An added entry the month or a later month already holds: not added (the rest goes ahead). */
  note: string | null;
}

export interface TwobApplyResult {
  ok: boolean;
  dryRun: boolean;
  changes: TwobChangeResult[];
  refusals: { index: number; entry: string | null; message: string }[];
  /**
   * held: an added entry not added, because the month or a later month
   * already holds it. stop: a later month holds the changed entry's invoice
   * as its own entry too (that entry and its copies stay as they are).
   */
  notes: { index: number; entry: string | null; message: string; kind: 'held' | 'stop' }[];
  /** Copies reached per later month. */
  laterMonths: { period: string; count: number }[];
}

const parseApply = (data: unknown): TwobApplyResult => {
  const d = (data || {}) as Raw;
  const changes = (Array.isArray(d.changes) ? d.changes : []) as Raw[];
  return {
    ok: d.ok === true,
    dryRun: d.dry_run === true,
    changes: changes.map((c) => {
      const t = (c.this || {}) as Raw;
      return {
        index: Number(c.index) || 0,
        table: c.table as TwobBooksTable,
        op: c.op as TwobChange['op'],
        entry: typeof c.entry === 'string' ? c.entry : null,
        action: typeof t.action === 'string' ? t.action : null,
        id: typeof t.id === 'string' ? t.id : null,
        later: (Array.isArray(c.later) ? c.later : []).map((l) => {
          const x = l as Raw;
          return { period: String(x.period), action: String(x.action), id: String(x.id) };
        }),
        booksRow: typeof t.books_row === 'string' ? t.books_row : null,
        refusal: typeof c.refusal === 'string' ? c.refusal : null,
        note: typeof c.note === 'string' ? c.note : null,
      };
    }),
    refusals: (Array.isArray(d.refusals) ? d.refusals : []).map((r) => {
      const x = r as Raw;
      return { index: Number(x.index) || 0, entry: typeof x.entry === 'string' ? x.entry : null, message: String(x.message) };
    }),
    notes: (Array.isArray(d.notes) ? d.notes : []).map((r) => {
      const x = r as Raw;
      return {
        index: Number(x.index) || 0, entry: typeof x.entry === 'string' ? x.entry : null, message: String(x.message),
        kind: x.kind === 'stop' ? 'stop' as const : 'held' as const,
      };
    }),
    laterMonths: (Array.isArray(d.later_months) ? d.later_months : []).map((m) => {
      const x = m as Raw;
      return { period: String(x.period), count: Number(x.count) || 0 };
    }),
  };
};

/**
 * Sends a prior month's books changes through twob_prior_books_apply.
 * dryRun: what it would do, writing nothing. Applying is all or nothing:
 * a refusal (or any error) throws with the database's words.
 */
export async function applyPriorBooks(
  actorId: string, clientId: string, period: string, changes: TwobChange[], dryRun: boolean,
): Promise<TwobApplyResult> {
  const { data, error } = await supabase.rpc('twob_prior_books_apply', {
    p_actor_id: actorId, p_client_id: clientId, p_period: period,
    p_changes: changes as unknown as Json, p_dry_run: dryRun,
  });
  if (error) throw new Error(error.message);
  return parseApply(data);
}

/** The refusals as one sentence each ("PERFECT INDUSTRIES 19/26-27: Sep-26 has reclaimed this entry; undo that reclaim first."). */
export const refusalLines = (r: TwobApplyResult): string[] =>
  r.refusals.map((x) => `${x.entry ? `${x.entry}: ` : ''}${x.message}.`);

/** The notes, one sentence each ("PERFECT INDUSTRIES 19/26-27: Jul-26 already holds this entry on its Not in 2B list; it is not added again."). */
export const noteLines = (r: TwobApplyResult, kind?: 'held' | 'stop'): string[] =>
  r.notes.filter((x) => !kind || x.kind === kind).map((x) => `${x.entry ? `${x.entry}: ` : ''}${x.message}.`);

/** Whether applying would write anything (every change refused or held: nothing). */
export const previewChangesSomething = (r: TwobApplyResult): boolean =>
  r.changes.some((c) => !c.refusal && !!c.action && c.action !== 'none') || r.laterMonths.length > 0;

/** "Jul-26: 2 removed, 1 changed. Also changes Aug-26 (2), Sep-26 (2)." */
export function describePriorPreview(r: TwobApplyResult, period: string): string {
  const count = (a: string) => r.changes.filter((c) => !c.refusal && c.action === a).length;
  const parts = [
    count('add') && `${count('add')} added`,
    count('change') && `${count('change')} changed`,
    count('remove') && `${count('remove')} removed`,
  ].filter(Boolean);
  const here = `${monthName(period)}: ${parts.length ? parts.join(', ') : 'nothing changes'}.`;
  // An added entry reaches every later month up to the open month (docs §13): say which.
  const addMonths = [...new Set(r.changes.filter((c) => !c.refusal && c.action === 'add').flatMap((c) => c.later.map((l) => l.period)))]
    .sort((a, b) => periodKey(a) - periodKey(b));
  const later = (r.laterMonths.length
    ? ` Also changes ${r.laterMonths.map((m) => `${monthName(m.period)} (${m.count})`).join(', ')}.`
    : ' No other month changes.')
    + (addMonths.length ? ` Each added entry is also added to ${addMonths.map(monthName).join(', ')}.` : '');
  const stops = noteLines(r, 'stop');
  const stopped = stops.length
    ? ` Not changed: ${stops.slice(0, 5).join(' ')}${stops.length > 5 ? ` And ${stops.length - 5} more.` : ''}`
    : '';
  const booksGone = r.changes.filter((c) => !c.refusal && c.booksRow === 'remove').length;
  const booksChanged = r.changes.filter((c) => !c.refusal && c.booksRow === 'change').length;
  const books = [
    booksGone && `${booksGone} Import 2B books ${booksGone === 1 ? 'row goes' : 'rows go'} too, so Post does not add ${booksGone === 1 ? 'it' : 'them'} back`,
    booksChanged && `${booksChanged} Import 2B books ${booksChanged === 1 ? 'row changes' : 'rows change'} the same way`,
  ].filter(Boolean);
  const notes = noteLines(r, 'held');
  const notAdded = notes.length
    ? ` Not added, already held: ${notes.slice(0, 5).join(' ')}${notes.length > 5 ? ` And ${notes.length - 5} more.` : ''}`
    : '';
  return here + later + (books.length ? ` ${books.join('; ')}.` : '') + stopped + notAdded;
}

type ConfirmFn = (opts: { title: string; description?: string; confirmText?: string; destructive?: boolean }) => Promise<boolean>;

export interface PriorApplyOutcome {
  /** Applied (false: refused, cancelled or failed; a message was shown). */
  applied: boolean;
  result: TwobApplyResult | null;
}

/**
 * The prior-month save every screen uses: the preview first (refusals shown,
 * nothing saved), then the confirm naming what changes in this month and in
 * each later month, then the change itself. Messages go through notify.
 * confirmAlways: false skips the confirm when nothing beyond this month
 * changes (a books register cell).
 */
export async function previewAndApplyPriorBooks(opts: {
  actorId: string;
  clientId: string;
  period: string;
  changes: TwobChange[];
  confirm: ConfirmFn;
  title: string;
  confirmText?: string;
  destructive?: boolean;
  confirmAlways?: boolean;
  notify: { error: (msg: string) => void; info?: (msg: string) => void };
}): Promise<PriorApplyOutcome> {
  const { actorId, clientId, period, changes, confirm, notify } = opts;
  if (changes.length === 0) return { applied: false, result: null };
  let preview: TwobApplyResult;
  try {
    preview = await applyPriorBooks(actorId, clientId, period, changes, true);
  } catch (err) {
    notify.error((err as Error).message);
    return { applied: false, result: null };
  }
  if (!preview.ok) {
    notify.error(`Nothing was saved. ${refusalLines(preview).join(' ')}`);
    return { applied: false, result: preview };
  }
  if (!previewChangesSomething(preview)) {
    if (preview.notes.length) (notify.info || notify.error)(`Nothing to save. ${noteLines(preview).join(' ')}`);
    return { applied: false, result: preview };
  }
  const reachesLater = preview.laterMonths.length > 0;
  if ((opts.confirmAlways ?? true) || reachesLater) {
    const ok = await confirm({
      title: opts.title,
      description: describePriorPreview(preview, period),
      confirmText: opts.confirmText || 'Save',
      destructive: opts.destructive,
    });
    if (!ok) return { applied: false, result: preview };
  }
  try {
    const result = await applyPriorBooks(actorId, clientId, period, changes, false);
    return { applied: true, result };
  } catch (err) {
    notify.error(`Nothing was saved: ${(err as Error).message}`);
    return { applied: false, result: null };
  }
}

// ---- The carry -----------------------------------------------------------------

/**
 * What filing a month did to each of its lists (twob_carry_log, written by
 * the filing trigger; docs §13). The carry is made once, into the next month
 * only, when that month is not filed and holds no carried entries on the
 * list; otherwise nothing is carried, and a GST Manager or the superadmin
 * repairs it with Re-run carry forward, previewed.
 */
export interface CarryOutcome {
  list: 'bills_not_in_2b' | 'bills_not_in_books';
  nextPeriod: string;
  /**
   * carried | next_held | next_filed (the next month is filed itself) |
   * next_prior (it counts as filed: a later month is filed) | done_before |
   * backfill | rerun | reopened (Filed by mistake, reopened) | refiled (filed
   * again after that: nothing carried again) | rerun_pending (a Re-run of
   * the month before brought entries in after the month was filed)
   */
  outcome: string;
  rows: number;
  /** How the first carry was made (carried | next_held | backfill | rerun), or null: never carried yet. */
  how?: string | null;
}

type CarryRow = { client_id?: string; list: string; next_period: string; last_outcome: string; carried_rows: number | null; carried_how: string | null };
const toCarryOutcome = (r: CarryRow): CarryOutcome => ({
  list: r.list === 'bills_not_in_books' ? 'bills_not_in_books' : 'bills_not_in_2b',
  nextPeriod: r.next_period, outcome: r.last_outcome, rows: Number(r.carried_rows) || 0, how: r.carried_how ?? null,
});

export async function fetchCarryOutcome(clientId: string, period: string): Promise<CarryOutcome[]> {
  const { data, error } = await supabase.from('twob_carry_log')
    .select('list, next_period, last_outcome, carried_rows, carried_how')
    .eq('client_id', clientId).eq('period_month', period);
  if (error) throw new Error(error.message);
  return ((data || []) as CarryRow[]).map(toCarryOutcome);
}

/**
 * The month's lists that filing never carried (twob_carry_log rows with
 * carried_at NULL: the next month was filed, or counted as filed, when this
 * month was marked Filed, by hand or by the extension's markFiled), per
 * client. Filing Status marks those rows until a Re-run has run from the
 * month (which records it).
 */
export async function fetchCarryGaps(period: string): Promise<Map<string, CarryOutcome[]>> {
  const { data, error } = await supabase.from('twob_carry_log')
    .select('client_id, list, next_period, last_outcome, carried_rows, carried_how')
    .eq('period_month', period).is('carried_at', null);
  if (error) throw new Error(error.message);
  const out = new Map<string, CarryOutcome[]>();
  for (const r of (data || []) as CarryRow[]) {
    const id = String(r.client_id);
    out.set(id, [...(out.get(id) || []), toCarryOutcome(r)]);
  }
  return out;
}

/**
 * The words after filing, list by list, from what the filing did
 * (fetchCarryOutcome). null: it could not be read.
 */
export function describeFilingCarry(returnType: string, period: string, outcomes: CarryOutcome[] | null): { tone: 'success' | 'warning'; text: string } {
  const head = `${returnType} filed. 2B and ITC sheets are now locked.`;
  if (!outcomes || outcomes.length === 0) {
    return { tone: 'warning', text: `${head} Could not read what was carried into the next month; open it on 2B Reconciliation to check.` };
  }
  const { lines, notCarried, fix } = carryLines(period, outcomes);
  return { tone: notCarried ? 'warning' : 'success', text: `${head} ${lines.join(' ')}${fix}` };
}

const listName = (l: CarryOutcome['list']) => (l === 'bills_not_in_2b' ? 'Not in 2B' : 'Not in Books');
const RERUN_HINT = ' If the next month lacks entries of this month, a GST Manager or the superadmin uses Re-run carry forward on this record: it shows what it adds first.';

/** The carry record's outcomes as sentences, list by list. */
function carryLines(period: string, outcomes: CarryOutcome[]): { lines: string[]; notCarried: boolean; fix: string } {
  const order = (l: CarryOutcome['list']) => (l === 'bills_not_in_2b' ? 0 : 1);
  let notCarried = false;
  const lines = [...outcomes].sort((a, b) => order(a.list) - order(b.list)).map((o) => {
    const next = monthName(o.nextPeriod);
    if (o.outcome === 'carried') {
      return o.rows ? `${listName(o.list)}: ${o.rows} ${o.rows === 1 ? 'entry' : 'entries'} carried into ${next}.` : `${listName(o.list)}: nothing to carry.`;
    }
    notCarried = true;
    if (o.outcome === 'rerun_pending') {
      return `${listName(o.list)}: Re-run carry forward brought entries of ${monthName(previousPeriod(period))} into ${monthName(period)} after it was filed; re-run ${monthName(period)} to carry them on into ${next}.`;
    }
    if (o.outcome === 'refiled') {
      return `${listName(o.list)}: not carried again. ${monthName(period)} was reopened as Filed by mistake after its entries were carried into ${next}, and filing it again carries nothing by itself, so ${next} may lack the entries added since.`;
    }
    if (o.outcome === 'reopened') return `${listName(o.list)}: ${monthName(period)} was reopened as Filed by mistake; its entries are carried again only by Re-run carry forward.`;
    if (o.outcome === 'next_held') return `${listName(o.list)}: not carried, because ${next} already held carried entries on it (its own reclaims and book entries stay).`;
    if (o.outcome === 'next_filed') return `${listName(o.list)}: not carried, because ${next} is filed already.`;
    if (o.outcome === 'next_prior') return `${listName(o.list)}: not carried, because ${next} counts as filed: a later month is filed.`;
    if (o.how === 'rerun') return `${listName(o.list)}: not carried again; Re-run carry forward brought its entries into ${next} before.`;
    return `${listName(o.list)}: not carried again; it was carried when ${monthName(period)} was first filed.`;
  });
  return { lines, notCarried, fix: notCarried ? RERUN_HINT : '' };
}

/**
 * The warning Filing Status keeps on a filed GSTR-3B row whose lists filing
 * never carried (fetchCarryGaps), until a Re-run from the month: the same
 * words as after filing, without the filing line.
 */
export function describeCarryGap(period: string, gaps: CarryOutcome[]): string {
  const { lines } = carryLines(period, gaps);
  const head = gaps.every((g) => g.outcome === 'rerun_pending')
    ? `${monthName(period)} holds entries Re-run carry forward brought in after it was filed, and they are not in the next month yet.`
    : `${monthName(period)}'s entries were not carried into the next month when it was marked Filed.`;
  return `${head} ${lines.join(' ')}${RERUN_HINT}`;
}

/**
 * A GSTR-3B / GSTR-3B (Q) marked Filed by mistake, its status since changed:
 * a GST Manager or the superadmin reopens its month for Import 2B and 2B
 * Reconciliation, writing why (twob_reopen_filed). Returns the month's state.
 */
export async function reopenFiled(actorId: string, clientId: string, returnType: string, period: string, reason: string): Promise<TwobMonthState> {
  const { error } = await supabase.rpc('twob_reopen_filed', {
    p_actor_id: actorId, p_client_id: clientId, p_return_type: returnType, p_period: period, p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return fetchTwobMonthState(clientId, period);
}

/**
 * What a Filing Status row offers for Import 2B and 2B Reconciliation (docs
 * §13), keyed on the row's own return type: the GSTR-3B tab also shows a
 * quarterly client's GSTR-3B (Q) row, recorded as such in twob_ever_filed.
 *  - carryGap: the "Entries not carried into the next month" warning;
 *  - rerun: Re-run carry forward (a GST Manager or the superadmin);
 *  - reopen: "Filed by mistake", only on a row that holds no filed return:
 *    not Filed, no ARN and no filing source. Unlock keeps both (the return is
 *    still filed on the portal), and twob_reopen_filed refuses such a row;
 *    the superadmin's Take off Filed clears them first.
 */
export function filingRowTwobActions(
  r: { client_id: string; return_type: string; status: string | null; arn: string | null; filed_source?: string | null },
  o: { everFiled: Set<string>; carryGaps: Map<string, unknown[]>; canChangePriorBooks: boolean },
): { carryGap: boolean; rerun: boolean; reopen: boolean } {
  const recorded = (r.return_type === 'GSTR-3B' || r.return_type === 'GSTR-3B (Q)') && o.everFiled.has(`${r.client_id}|${r.return_type}`);
  return {
    carryGap: recorded && (o.carryGaps.get(r.client_id)?.length ?? 0) > 0,
    rerun: recorded && o.canChangePriorBooks,
    reopen: recorded && o.canChangePriorBooks && r.status !== 'Filed' && !r.arn && !r.filed_source,
  };
}

/** The returns of a month recorded as Filed for Import 2B and 2B Reconciliation and not reopened ("clientId|returnType"). */
export async function fetchEverFiled(period: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('twob_ever_filed').select('client_id, return_type')
    .eq('period_month', period).is('reopened_at', null);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => `${r.client_id}|${r.return_type}`));
}

export interface RerunEntry { id: string; date: string | null; supplierName: string | null; number: string | null; tax: number; message: string | null }
/** left: carried copies the month no longer holds, left in a filed next month (Re-run only adds there). */
export interface RerunList { add: RerunEntry[]; remove: RerunEntry[]; keep: RerunEntry[]; conflict: RerunEntry[]; left: RerunEntry[] }
/**
 * nextFiled: the next month counts as filed (an out-of-order filing repaired):
 * Re-run only adds there. nextOwnFiled: its own return is marked Filed (else it
 * counts as filed only because a later month is).
 */
export interface RerunResult { period: string; nextPeriod: string; nextFiled: boolean; nextOwnFiled: boolean; dryRun: boolean; bills2B: RerunList; billsBooks: RerunList }

const parseRerunList = (v: unknown): RerunList => {
  const d = (v || {}) as Raw;
  const list = (x: unknown): RerunEntry[] => (Array.isArray(x) ? x : []).map((e) => {
    const r = e as Raw;
    return {
      id: String(r.id), date: typeof r.date === 'string' ? r.date : null,
      supplierName: typeof r.supplier_name === 'string' ? r.supplier_name : null,
      number: typeof r.supplier_invoice_number === 'string' ? r.supplier_invoice_number : null,
      tax: Number(r.tax) || 0, message: typeof r.message === 'string' ? r.message : null,
    };
  });
  return { add: list(d.add), remove: list(d.remove), keep: list(d.keep), conflict: list(d.conflict), left: list(d.left) };
};

/** Re-run carry forward (a GST Manager or the superadmin): the preview (dryRun) or the change. */
export async function rerunCarry(actorId: string, clientId: string, period: string, dryRun: boolean): Promise<RerunResult> {
  const { data, error } = await supabase.rpc('twob_carry_rerun', {
    p_actor_id: actorId, p_client_id: clientId, p_period: period, p_dry_run: dryRun,
  });
  if (error) throw new Error(error.message);
  const d = (data || {}) as Raw;
  return {
    period: String(d.period), nextPeriod: String(d.next_period), nextFiled: d.next_filed === true,
    nextOwnFiled: d.next_own_filed === undefined ? d.next_filed === true : d.next_own_filed === true, dryRun: d.dry_run === true,
    bills2B: parseRerunList(d.bills_not_in_2b), billsBooks: parseRerunList(d.bills_not_in_books),
  };
}

const entryLabel = (e: RerunEntry) => [e.supplierName, e.number].filter(Boolean).join(' ') || 'an entry';
const listNames = (list: RerunEntry[]) => `${list.slice(0, 4).map(entryLabel).join(', ')}${list.length > 4 ? ` and ${list.length - 4} more` : ''}`;

/** The Re-run preview as sentences for the confirm. */
export function describeRerun(r: RerunResult): { lines: string[]; nothingToDo: boolean } {
  const lines: string[] = [];
  const next = monthName(r.nextPeriod);
  if (r.nextFiled) {
    lines.push(r.nextOwnFiled
      ? `${next} is filed: Re-run only adds the entries it lacks there, and removes or replaces nothing.`
      : `${next} counts as filed (a later month is filed): Re-run only adds the entries it lacks there, and removes or replaces nothing.`);
  }
  const list = (name: string, l: RerunList) => {
    if (l.add.length) lines.push(`${name}: add ${l.add.length} to ${next} (${listNames(l.add)}).`);
    if (l.remove.length) lines.push(`${name}: remove ${l.remove.length} carried ${l.remove.length === 1 ? 'copy' : 'copies'} from ${next} that ${monthName(r.period)} no longer holds (${listNames(l.remove)}).`);
    if (l.keep.length) lines.push(`${name}: keep ${l.keep.length} carried ${l.keep.length === 1 ? 'copy' : 'copies'} in ${next} that ${monthName(r.period)} no longer holds, because ${l.keep.length === 1 ? 'it holds' : 'they hold'} a reclaim, Expense out or book entry (${listNames(l.keep)}).`);
    if (l.left.length) lines.push(`${name}: ${l.left.length} carried ${l.left.length === 1 ? 'copy' : 'copies'} in ${next} that ${monthName(r.period)} no longer holds ${l.left.length === 1 ? 'stays' : 'stay'} (${listNames(l.left)}); a GST Manager removes ${l.left.length === 1 ? 'it' : 'them'} there through Import 2B or 2B Reconciliation if ${l.left.length === 1 ? 'it does' : 'they do'} not belong.`);
    for (const c of l.conflict) lines.push(`${name}: ${entryLabel(c)} is left as it is: ${c.message || 'its copy holds a decision'}.`);
  };
  list('Not in 2B', r.bills2B);
  list('Not in Books', r.billsBooks);
  const nothingToDo = !r.bills2B.add.length && !r.bills2B.remove.length && !r.billsBooks.add.length && !r.billsBooks.remove.length;
  if (r.nextFiled && !nothingToDo) {
    const [mm, yyyy] = r.nextPeriod.split('/').map(Number);
    const after = mm === 12 ? `01/${yyyy + 1}` : `${String(mm + 1).padStart(2, '0')}/${yyyy}`;
    lines.push(r.nextOwnFiled
      ? `Then re-run ${next} to carry them on into ${monthName(after)}.`
      : `Once ${next} is marked Filed itself, re-run it to carry them on into ${monthName(after)}.`);
  }
  return { lines, nothingToDo };
}

// ---- Restore (2B Reconciliation) ------------------------------------------------

/**
 * One saved version's rows, as twob_restore_version takes them (snake_case).
 * is_carried_forward: null when the version does not say (the database then
 * refuses the restore).
 */
export type RestoreRow = Record<string, string | number | boolean | null>;

/**
 * What a restore did: the month's own entries restored, its carried entries
 * kept as they stand, and the version's own entries left out because the
 * month now holds them as carried entries (named, "SUP X-9").
 */
export interface RestoreResult { own2B: number; ownBooks: number; carriedKept: number; leftOut: string[] }

/**
 * Replaces an open month's own entries on its two lists with a saved
 * version's, in one call (twob_restore_version, the superadmin). Its carried
 * entries stay as they stand (a filed month's correction reaches them, and no
 * version of this month records it; docs §13). The database refuses a filed
 * month and any month but the client's latest month holding entries; the
 * screen says so first (restoreBlockedReason).
 */
export async function restoreVersion(actorId: string, clientId: string, period: string, bills2B: RestoreRow[], billsBooks: RestoreRow[]): Promise<RestoreResult> {
  const { data, error } = await supabase.rpc('twob_restore_version', {
    p_actor_id: actorId, p_client_id: clientId, p_period: period,
    p_bills_2b: bills2B as unknown as Json, p_bills_books: billsBooks as unknown as Json,
  });
  if (error) throw new Error(error.message);
  const d = (data || {}) as Raw;
  return {
    own2B: Number(d.bills_not_in_2b) || 0, ownBooks: Number(d.bills_not_in_books) || 0,
    carriedKept: (Number(d.carried_kept_2b) || 0) + (Number(d.carried_kept_books) || 0),
    leftOut: (Array.isArray(d.left_out) ? (d.left_out as Raw[]) : [])
      .map((e) => [e.supplier_name, e.supplier_invoice_number].filter((x) => typeof x === 'string' && x.trim()).join(' ') || 'an entry'),
  };
}

/**
 * Why Restore is off for a month, or null: a filed month is never restored,
 * and an open month only when no later month holds entries (a restore would
 * not reach them; docs §13).
 */
export function restoreBlockedReason(state: TwobMonthState): string | null {
  if (state.isPrior) return `${PRIOR_MONTH_DOCS_MSG} Restore works on open months only.`;
  const later = state.laterMonths.filter((m) => m.rows2B + m.rowsBooks > 0).sort((a, b) => periodKey(b.period) - periodKey(a.period))[0];
  return later
    ? `Restore works only on the latest month that holds entries (${monthName(later.period)}): a restore here would not reach the entries ${monthName(later.period)} holds.`
    : null;
}
