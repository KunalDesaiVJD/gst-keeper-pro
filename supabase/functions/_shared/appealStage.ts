// Which appeal documents can still be drafted (the firm's request of 25
// October 2026: once an appeal is filed, its statement of facts and grounds of
// appeal are on record with the APL 01 and are not drafted again; the written
// submission for the hearing still is). One rule, read by the Appeal view
// (src/lib/noticeAppeals.ts) and by the Edge Function notice-appeal-ai, which
// refuses a request the rule does not allow. §33 of
// docs/NOTICES_LITIGATION_POSITIONS.md.

export type AppealDocKey = 'facts' | 'grounds' | 'submission';

/** What the rule reads of an appeal (an entry of notice_case_appeals). */
export interface AppealStageInput {
  appeal_key: string;
  status: 'filed' | 'to_file' | string;
  portal_status?: string | null;
  filed_on?: string | null;
  last_day?: string | null;
  order_form?: string | null;
  order_date?: string | null;
  /** 'tribunal' for an appeal against an order in appeal (APL 04), 20261026120000. */
  forum?: string | null;
  /** The months of delay the forum may condone: 1 under s.107(4), 3 under s.112(6). */
  condonation_months?: number | null;
}

/**
 * Where the appeal stands:
 * - preparing: not filed, within the three months to appeal;
 * - late: not filed, the three months over but the delay still condonable (one month, s.107(4); three before
 *   the Tribunal, s.112(6));
 * - time_over: not filed and both over;
 * - filed: filed and pending (submitted, admitted, a hearing fixed, a reply submitted);
 * - withdrawn: the portal says the appeal was withdrawn;
 * - decided: the portal says it was disposed of, or an order in appeal (APL 04) of the case came after the filing.
 */
export type AppealPhase = 'preparing' | 'late' | 'time_over' | 'filed' | 'withdrawn' | 'decided';

/** The same day n months on, or the month's last day when it has none (31 Jan + 1 month = 28 Feb), as Postgres. */
export const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
};

/** The months of delay the forum may condone. */
export const condonationMonths = (a: AppealStageInput) =>
  a.condonation_months ?? (a.forum === 'tribunal' || (a.order_form ?? '').toUpperCase() === 'APL-04' ? 3 : 1);

export function appealPhase(a: AppealStageInput, all: AppealStageInput[] = [], today = new Date().toISOString().slice(0, 10)): AppealPhase {
  if (a.status === 'filed') {
    const s = (a.portal_status ?? '').toLowerCase();
    if (/withdraw/.test(s)) return 'withdrawn';
    if (/dispos|order issued|decided|rejected|dismiss|allowed|closed/.test(s)) return 'decided';
    const decidedBy = all.find((x) => x.appeal_key !== a.appeal_key && (x.order_form ?? '').toUpperCase() === 'APL-04'
      && !!x.order_date && (!a.filed_on || x.order_date >= a.filed_on));
    return decidedBy ? 'decided' : 'filed';
  }
  if (!a.last_day || today <= a.last_day) return 'preparing';
  return today <= addMonths(a.last_day, condonationMonths(a)) ? 'late' : 'time_over';
}

export interface AppealDocState {
  /** The document can be drafted, improved and saved. */
  open: boolean;
  /** Why not, in a sentence for the page; null when open. */
  why: string | null;
}

export function appealDocState(doc: AppealDocKey, phase: AppealPhase): AppealDocState {
  switch (phase) {
    case 'preparing': case 'late': return { open: true, why: null };
    case 'time_over': return { open: false, why: 'The time to appeal and the time the authority may condone are both over, so no appeal can be filed against this order now.' };
    case 'withdrawn': return { open: false, why: 'The appeal was withdrawn, so nothing more is drafted for it.' };
    case 'decided': return { open: false, why: 'The appeal has been decided, so nothing more is drafted for it. A further appeal is prepared against the order in appeal.' };
    case 'filed':
      return doc === 'submission' ? { open: true, why: null }
        : { open: false, why: `The ${doc === 'facts' ? 'statement of facts was' : 'grounds of appeal were'} filed with the APL 01 and stand as filed.` };
  }
}
