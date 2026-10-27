// Which drafting a notice page offers at the notice's stage (the firm's
// request of 25 October 2026: drafting options show only where they still make
// sense). A reply is drafted while a reply is due; once it is filed, the
// notice closed, or the proceedings moved on to an order, the reply's drafts
// are kept to read and the AI assistant steps back. An order is not replied
// to: it is appealed (the case's Appeal view drafts the statement of facts,
// grounds and written submission), rectified or paid, and the Draft tab keeps
// the letters for those. A hearing fixed after the reply opens drafting again,
// for the written submission at the hearing. §33 of
// docs/NOTICES_LITIGATION_POSITIONS.md.

/** The forms that are orders an appeal lies against (public.notice_appealable_forms(), 20261025140000). */
// notice_appealable_forms() (20261026110000); test_117 holds the database's list to the form rules.
export const ORDER_FORMS = ['DRC-07', 'DRC-07A', 'DRC-08', 'ASMT-13', 'ASMT-15', 'ASMT-16', 'RFD-06', 'RFD-07', 'REG-05', 'REG-19', 'REG-CANCEL-REJ',
  'MOV-09', 'MOV-11', 'SPL-07', 'RECT-ORDER', 'APL-04'];

export const isOrderForm = (form: string | null | undefined) => !!form && ORDER_FORMS.includes(form.toUpperCase());

/**
 * - reply: a reply is being prepared; everything is offered;
 * - order: the notice is an order; letters on the Draft tab, the appeal on the case's Appeal view;
 * - replied: the reply is filed and no hearing is fixed;
 * - moved_on: the proceedings have moved on to an order or an appeal;
 * - closed: nothing more to do.
 */
export type DraftingPhase = 'reply' | 'order' | 'replied' | 'moved_on' | 'closed';

export interface DraftingFacts {
  stage: string | null;
  form_code: string | null;
  reply_date: string | null;
  is_open?: boolean | null;
}

export function draftingPhase(f: DraftingFacts): DraftingPhase {
  if (f.stage === 'closed' || f.is_open === false) return 'closed';
  if (isOrderForm(f.form_code)) return 'order';
  if (f.stage === 'order' || f.stage === 'appeal') return 'moved_on';
  if (f.reply_date && f.stage !== 'hearing') return 'replied';
  return 'reply';
}

/** The AI assistant drafts replies: only while a reply is being prepared. */
export const assistantOffered = (p: DraftingPhase) => p === 'reply';
/** The Draft tab can be edited: while a reply is prepared, and on an order for its letters. */
export const draftEditable = (p: DraftingPhase) => p === 'reply' || p === 'order';
