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
}

export interface TwobApplyResult {
  ok: boolean;
  dryRun: boolean;
  changes: TwobChangeResult[];
  refusals: { index: number; entry: string | null; message: string }[];
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
      };
    }),
    refusals: (Array.isArray(d.refusals) ? d.refusals : []).map((r) => {
      const x = r as Raw;
      return { index: Number(x.index) || 0, entry: typeof x.entry === 'string' ? x.entry : null, message: String(x.message) };
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

/** "This month: 2 removed, 1 changed. Also changes Aug-26 (2), Sep-26 (2)." */
export function describePriorPreview(r: TwobApplyResult, period: string): string {
  const count = (a: string) => r.changes.filter((c) => !c.refusal && c.action === a).length;
  const parts = [
    count('add') && `${count('add')} added`,
    count('change') && `${count('change')} changed`,
    count('remove') && `${count('remove')} removed`,
  ].filter(Boolean);
  const here = `${monthName(period)}: ${parts.length ? parts.join(', ') : 'nothing changes'}.`;
  const later = r.laterMonths.length
    ? ` Also changes ${r.laterMonths.map((m) => `${monthName(m.period)} (${m.count})`).join(', ')}.`
    : ' No later month holds these entries.';
  const booksGone = r.changes.filter((c) => !c.refusal && c.booksRow === 'remove').length;
  const booksChanged = r.changes.filter((c) => !c.refusal && c.booksRow === 'change').length;
  const books = [
    booksGone && `${booksGone} Import 2B books ${booksGone === 1 ? 'row goes' : 'rows go'} too, so Post does not add ${booksGone === 1 ? 'it' : 'them'} back`,
    booksChanged && `${booksChanged} Import 2B books ${booksChanged === 1 ? 'row changes' : 'rows change'} the same way`,
  ].filter(Boolean);
  return here + later + (books.length ? ` ${books.join('; ')}.` : '');
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
  notify: { error: (msg: string) => void };
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
 * Whether the next month already holds carried entries on each list. Filing
 * carries a month's lists into the next month only when it holds none yet
 * (the filing trigger, docs §13); Filing Status asks first, to say which.
 */
export interface NextMonthCarried { nextPeriod: string; nextPrior: boolean; carried2B: number; carriedBooks: number }

export async function nextMonthCarried(clientId: string, period: string): Promise<NextMonthCarried> {
  const [mm, yyyy] = (period || '').split('/').map(Number);
  const next = mm === 12 ? `01/${yyyy + 1}` : `${String(mm + 1).padStart(2, '0')}/${yyyy}`;
  const state = await fetchTwobMonthState(clientId, period);
  const m = state.laterMonths.find((x) => x.period === next);
  return { nextPeriod: next, nextPrior: isPriorPeriod(next, state.priorThrough), carried2B: m?.carried2B ?? 0, carriedBooks: m?.carriedBooks ?? 0 };
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

/** The returns of a month recorded as Filed for Import 2B and 2B Reconciliation and not reopened ("clientId|returnType"). */
export async function fetchEverFiled(period: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('twob_ever_filed').select('client_id, return_type')
    .eq('period_month', period).is('reopened_at', null);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => `${r.client_id}|${r.return_type}`));
}

export interface RerunEntry { id: string; date: string | null; supplierName: string | null; number: string | null; tax: number; message: string | null }
export interface RerunList { add: RerunEntry[]; remove: RerunEntry[]; keep: RerunEntry[]; conflict: RerunEntry[] }
export interface RerunResult { period: string; nextPeriod: string; dryRun: boolean; bills2B: RerunList; billsBooks: RerunList }

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
  return { add: list(d.add), remove: list(d.remove), keep: list(d.keep), conflict: list(d.conflict) };
};

/** Re-run carry forward (a GST Manager or the superadmin): the preview (dryRun) or the change. */
export async function rerunCarry(actorId: string, clientId: string, period: string, dryRun: boolean): Promise<RerunResult> {
  const { data, error } = await supabase.rpc('twob_carry_rerun', {
    p_actor_id: actorId, p_client_id: clientId, p_period: period, p_dry_run: dryRun,
  });
  if (error) throw new Error(error.message);
  const d = (data || {}) as Raw;
  return {
    period: String(d.period), nextPeriod: String(d.next_period), dryRun: d.dry_run === true,
    bills2B: parseRerunList(d.bills_not_in_2b), billsBooks: parseRerunList(d.bills_not_in_books),
  };
}

const entryLabel = (e: RerunEntry) => [e.supplierName, e.number].filter(Boolean).join(' ') || 'an entry';
const listNames = (list: RerunEntry[]) => `${list.slice(0, 4).map(entryLabel).join(', ')}${list.length > 4 ? ` and ${list.length - 4} more` : ''}`;

/** The Re-run preview as sentences for the confirm. */
export function describeRerun(r: RerunResult): { lines: string[]; nothingToDo: boolean } {
  const lines: string[] = [];
  const next = monthName(r.nextPeriod);
  const list = (name: string, l: RerunList) => {
    if (l.add.length) lines.push(`${name}: add ${l.add.length} to ${next} (${listNames(l.add)}).`);
    if (l.remove.length) lines.push(`${name}: remove ${l.remove.length} carried ${l.remove.length === 1 ? 'copy' : 'copies'} from ${next} that ${monthName(r.period)} no longer holds (${listNames(l.remove)}).`);
    if (l.keep.length) lines.push(`${name}: keep ${l.keep.length} carried ${l.keep.length === 1 ? 'copy' : 'copies'} that ${monthName(r.period)} no longer holds, because ${l.keep.length === 1 ? 'it holds' : 'they hold'} ${next}'s own decision (${listNames(l.keep)}).`);
    for (const c of l.conflict) lines.push(`${name}: ${entryLabel(c)} is left as it is: ${c.message || 'its copy holds a decision'}.`);
  };
  list('Not in 2B', r.bills2B);
  list('Not in Books', r.billsBooks);
  const nothingToDo = !r.bills2B.add.length && !r.bills2B.remove.length && !r.billsBooks.add.length && !r.billsBooks.remove.length;
  return { lines, nothingToDo };
}
