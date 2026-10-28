// Where one appeal stands, for the Appeal view (the firm's request of 28
// October 2026: everything about an appeal in one place, so nobody opens the
// order's or the APL-02's notice page to find it). From what the page already
// holds: the appeal (notice_case_appeals), the case's papers
// (notice_case_items) and the dates the law attaches to them
// (notice_case_key_dates): the appeal's own papers and dates, its road from the
// order to the order in appeal, and the next thing to do with its date. Pure,
// so scripts/verify-appeal-workspace.mjs checks it. §33 of
// docs/NOTICES_LITIGATION_POSITIONS.md.
import { addMonths, condonationMonths, type AppealPhase, type AppealStageInput } from '../../supabase/functions/_shared/appealStage.ts';

/** What this module reads of an appeal (a CaseAppeal of src/lib/noticeAppeals.ts). */
export interface AppealIn extends AppealStageInput {
  arn?: string;
  order_ref?: string;
  order_notice_id?: string;
  order_comm_date?: string;
  predeposit?: number;
  predeposit_pct?: number;
  /** 'refund' for an appeal against RFD-06 / RFD-07 (20261028100000). */
  subject?: string;
  refund_rejected?: number;
  pending_days?: number;
  drafts?: Partial<Record<'facts' | 'grounds' | 'submission', { version: number; status: string; at: string }>>;
}

/** What this module reads of a paper of the case (a CaseItem of src/lib/noticeCases.ts). */
export interface PaperIn {
  kind: string;
  id: string;
  date: string | null;
  label: string;
  reference: string | null;
  own_key?: string | null;
  facts?: { form?: string; hearing?: { date: string; time?: string; venue?: string } } | null;
  ai?: { title: string | null } | null;
}

/** What this module reads of a key date (a KeyDate of src/lib/noticeCases.ts). */
export interface DateIn {
  date: string;
  kind: string;
  title: string;
  detail?: string | null;
  tone: string;
  own_key?: string | null;
  item_id?: string | null;
  upcoming: boolean;
  ground?: boolean;
}

const up = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();
const byDate = <T extends { date: string | null }>(a: T, b: T) => (a.date ?? '').localeCompare(b.date ?? '');

/** The papers of this appeal: the order it is against and everything in the appeal's own portal case. */
export function appealPapers<P extends PaperIn>(a: AppealIn, items: P[]): P[] {
  const arn = up(a.arn);
  return items.filter((it) => it.id === a.order_notice_id || (!!arn && up(it.own_key) === arn)).sort(byDate);
}

// The dates of the order that bear on its appeal.
const ORDER_DATE_KINDS = ['appeal_window', 'appeal_filed', 'predeposit', 'payment_due', 'pay_to_close', 'rectification', 'order_check', 'withdrawal'];

/** The dates of this appeal: its hearings and adjournments, and the order's dates that bear on it. */
export function appealKeyDates<D extends DateIn>(a: AppealIn, dates: D[]): D[] {
  const arn = up(a.arn);
  return dates.filter((k) => (!!arn && up(k.own_key) === arn)
    || (!!a.order_notice_id && k.item_id === a.order_notice_id && ORDER_DATE_KINDS.includes(k.kind))).sort(byDate);
}

/** A paper's form: the portal's own (an APL-01's record) or the notice's label (APL-02 · Appeal admitted). */
export function paperForm(p: PaperIn): string {
  const f = up(p.facts?.form);
  if (f) return f;
  const m = /^([A-Z]{2,4}[- ]?\d{1,2}[A-Z]?|APL-HEARING|ADJOURNMENT)\b/i.exec(p.label.trim());
  return m ? up(m[1]).replace(' ', '-') : '';
}

export type StepState = 'done' | 'now' | 'later' | 'missed';
export interface AppealStep { key: string; label: string; state: StepState; date?: string | null; note?: string | null }

/** The appeal's road, from the order to the order in appeal. */
export function appealSteps(a: AppealIn, phase: AppealPhase, papers: PaperIn[], dates: DateIn[], all: AppealIn[] = [], today = new Date().toISOString().slice(0, 10)): AppealStep[] {
  const filed = a.status === 'filed';
  const tribunal = a.forum === 'tribunal' || up(a.order_form) === 'APL-04';
  const refund = a.subject === 'refund';
  const steps: AppealStep[] = [];
  steps.push({ key: 'order', label: `Order${a.order_form ? ` (${a.order_form})` : ''}`, state: 'done', date: a.order_comm_date ?? a.order_date ?? null,
    note: refund && a.refund_rejected ? `Refund of ₹${a.refund_rejected.toLocaleString('en-IN')} rejected` : null });

  // The pre-deposit (s.107(6), s.112(8)); an order that only rejects a refund confirms no demand to deposit against.
  if (!refund) {
    const dep = dates.find((k) => k.kind === 'predeposit');
    if (filed && (a.predeposit ?? 0) > 0) {
      steps.push({ key: 'predeposit', label: 'Pre-deposit', state: dep?.tone === 'danger' ? 'missed' : 'done', date: a.filed_on ?? null,
        note: `₹${(a.predeposit as number).toLocaleString('en-IN')}${a.predeposit_pct ? ` (${a.predeposit_pct}%)` : ''}${dep?.tone === 'danger' ? `: ${dep.title}` : ''}` });
    } else if (filed) {
      steps.push({ key: 'predeposit', label: 'Pre-deposit', state: dep?.tone === 'ok' ? 'done' : 'missed', date: dep?.date ?? null, note: dep?.title ?? 'Not on the appeal\'s record' });
    } else {
      steps.push({ key: 'predeposit', label: 'Pre-deposit', state: phase === 'time_over' ? 'missed' : 'now', date: null,
        note: dep?.title ?? (tribunal ? '10% more of the tax in dispute, beyond what was paid before the appellate authority (s.112(8))'
          : '10% of the tax in dispute, with the admitted amount in full (s.107(6))') });
    }
  }

  const graceEnd = a.last_day ? addMonths(a.last_day, condonationMonths(a)) : null;
  steps.push(filed
    ? { key: 'filed', label: tribunal ? 'Filed before the Tribunal' : 'Appeal filed (APL-01)', state: 'done', date: a.filed_on ?? null, note: a.arn && !a.arn.startsWith('GSTAT:') ? a.arn : null }
    : phase === 'time_over'
      ? { key: 'filed', label: 'Appeal filed (APL-01)', state: 'missed', date: graceEnd, note: 'The time to appeal is over' }
      : { key: 'filed', label: 'Appeal filed (APL-01)', state: 'now', date: phase === 'late' ? graceEnd : a.last_day ?? null,
          note: phase === 'late' ? 'With a request to condone the delay' : 'Last day' });

  if (!tribunal) {
    const admitted = papers.find((p) => paperForm(p) === 'APL-02');
    const admittedByPortal = /admit/i.test(a.portal_status ?? '');
    steps.push(admitted || admittedByPortal
      ? { key: 'admitted', label: 'Admitted (APL-02)', state: 'done', date: admitted?.date ?? null }
      : { key: 'admitted', label: 'Admitted (APL-02)', state: filed && phase === 'filed' ? 'now' : 'later', date: null, note: filed ? 'Awaiting the acknowledgement' : null });
  }

  const hearings = dates.filter((k) => k.kind === 'hearing');
  const adjourned = dates.filter((k) => k.kind === 'adjournment').length;
  const next = hearings.find((k) => k.upcoming && k.date >= today);
  const last = [...hearings].reverse().find((k) => !k.upcoming || k.date < today);
  const adjNote = adjourned ? `, ${adjourned} adjournment${adjourned === 1 ? '' : 's'}` : '';
  steps.push(next
    ? { key: 'hearing', label: 'Hearing', state: 'now', date: next.date, note: `${next.title}${adjNote}` }
    : last
      ? { key: 'hearing', label: 'Hearing', state: 'done', date: last.date, note: `${hearings.length} on record${adjNote}` }
      : { key: 'hearing', label: 'Hearing', state: 'later', date: null, note: filed ? 'Not fixed yet' : null });

  const sub = a.drafts?.submission;
  steps.push(sub?.status === 'final'
    ? { key: 'submission', label: 'Written submission', state: 'done', date: sub.at?.slice(0, 10) ?? null, note: `Version ${sub.version}, final` }
    : { key: 'submission', label: 'Written submission', state: filed && phase === 'filed' && (next || sub) ? 'now' : 'later', date: null,
        note: sub ? `Version ${sub.version} in draft` : next ? 'To prepare before the hearing' : null });

  const decidedBy = all.find((x) => x.appeal_key !== a.appeal_key && up(x.order_form) === 'APL-04' && !!x.order_date && (!a.filed_on || x.order_date >= a.filed_on));
  steps.push(phase === 'decided'
    ? { key: 'decided', label: tribunal ? 'Order of the Tribunal' : 'Order in appeal (APL-04)', state: 'done', date: decidedBy?.order_date ?? null, note: a.portal_status ?? null }
    : phase === 'withdrawn'
      ? { key: 'decided', label: 'Withdrawn', state: 'done', date: null, note: a.portal_status ?? null }
      : { key: 'decided', label: tribunal ? 'Order of the Tribunal' : 'Order in appeal (APL-04)', state: 'later', date: null,
          note: filed && (a.pending_days ?? 0) >= 365 ? 'Pending over a year (s.107(13))' : null });
  return steps;
}

export interface AppealNext { text: string; why: string | null; due: string | null; tone: 'action' | 'wait' | 'done' }

/** The one next thing to do on the appeal, with its date. */
export function appealNext(a: AppealIn, phase: AppealPhase, dates: DateIn[], today = new Date().toISOString().slice(0, 10)): AppealNext {
  const tribunal = a.forum === 'tribunal' || up(a.order_form) === 'APL-04';
  const form = tribunal ? 'APL-05' : 'APL-01';
  const deposit = a.subject === 'refund' ? '' : ' with the pre-deposit';
  switch (phase) {
    case 'preparing':
      return { text: `File the appeal (${form})${deposit} by the last day`, due: a.last_day ?? null, tone: 'action',
        why: `Three months from the order's communication (${tribunal ? 's.112(1)' : 's.107(1)'}). Draft the statement of facts first; the grounds and the written submission build on it.` };
    case 'late': {
      const end = a.last_day ? addMonths(a.last_day, condonationMonths(a)) : null;
      return { text: `File the appeal (${form})${deposit} with a request to condone the delay`, due: end, tone: 'action',
        why: `The three months ran out on the last day; the ${tribunal ? 'Tribunal may condone three more months (s.112(6))' : 'appellate authority may condone one more month (s.107(4))'} for sufficient cause.` };
    }
    case 'time_over':
      return { text: 'The time to appeal is over', due: null, tone: 'done', why: 'Neither the three months nor the delay the forum may condone are left. The drafts kept here are to read.' };
    case 'withdrawn':
      return { text: 'The appeal was withdrawn', due: null, tone: 'done', why: 'Nothing more is drafted for it.' };
    case 'decided':
      return { text: 'The appeal is decided: read the order in appeal', due: null, tone: 'done',
        why: tribunal ? null : 'A further appeal against it goes to the Tribunal (APL-05) within three months; it shows here as an appeal to prepare.' };
    case 'filed': {
      const next = dates.find((k) => k.kind === 'hearing' && k.upcoming && k.date >= today);
      const final = a.drafts?.submission?.status === 'final';
      if (next) {
        return final
          ? { text: 'Attend the hearing with the written submission', due: next.date, tone: 'action', why: `${next.title}${next.detail ? ` · ${next.detail}` : ''}. The submission is final.` }
          : { text: 'Make the written submission final before the hearing', due: next.date, tone: 'action', why: `${next.title}${next.detail ? ` · ${next.detail}` : ''}.` };
      }
      if ((a.pending_days ?? 0) >= 365) {
        return { text: 'Ask the appellate authority for a hearing date', due: null, tone: 'action',
          why: 'The appeal has been pending for over a year; s.107(13) asks for a decision within a year where it can. Keep the stay of recovery on record.' };
      }
      return final
        ? { text: 'With the appellate authority: waiting for a hearing date', due: null, tone: 'wait', why: 'The written submission is final and ready for the hearing.' }
        : { text: 'Prepare the written submission while the hearing is awaited', due: null, tone: 'wait', why: 'It argues the grounds as filed with the APL-01, for the hearing once it is fixed.' };
    }
  }
}
