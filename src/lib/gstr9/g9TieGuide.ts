// Plain-language guide for the GSTR-9C lines the GST portal checks against the filed GSTR-9
// (gstr9c.g9filed, gstr9c.5Q, gstr9c.9Q): what the line means, the portal error it stands for, and
// the steps that clear it. Shared by the line's pop-over, the Table 5 / 9 notes, the sign-off panel
// and the Portal JSON tab, so every screen says the same thing. Pure; no I/O.

import type { DiffLine } from './engine';

export type G9TieKey = 'gstr9c.g9filed' | 'gstr9c.5Q' | 'gstr9c.9Q';
export const isG9TieKey = (k: string): k is G9TieKey => k === 'gstr9c.g9filed' || k === 'gstr9c.5Q' || k === 'gstr9c.9Q';

export interface G9TieStep {
  text: string;
  /** Where the step is done: the GSTR-9C table to open in the working, if any. */
  goTo?: { table: '5' | '9'; row: string; label: string };
}

export interface G9TieGuide {
  title: string;
  /** What the line means, in one or two sentences. */
  meaning: string;
  /** The error the portal gives when this is uploaded as it stands. */
  portalError: string;
  steps: G9TieStep[];
}

const FIND_FILED =
  'Open the GSTR-9 as filed: on the GST portal, Returns Dashboard → Annual Return → the financial year → GSTR-9 → View / Download the filed return (PDF). Use the filed copy, not the system-computed draft.';

const T5_STEP: G9TieStep = {
  text: 'On GSTR-9C › Table 5, in the box “GSTR-9 as filed”, type 5N (Total turnover including advances, the last row of Pt. II Table 5), Table 10 and Table 11 exactly as the filed GSTR-9 shows them, paise included (e.g. 7,77,83,451.34, not 7,77,83,451).',
  goTo: { table: '5', row: 'Q', label: 'Open GSTR-9C Table 5' },
};
const T9_STEP: G9TieStep = {
  text: 'On GSTR-9C › Table 9, in the box “GSTR-9 as filed”, type for each head the tax paid in filed GSTR-9 Table 9 (paid through cash + paid through ITC) and in Table 14 (differential tax paid). Type 0 where the filed return shows nil.',
  goTo: { table: '9', row: 'Q', label: 'Open GSTR-9C Table 9' },
};
const AFTER: G9TieStep = {
  text: 'Check that 5Q and 9Q now show “Matched”. Any real difference between the books and the GSTR-9 is explained in 5R / Table 6 and 9R / Table 10, never by changing 5Q or 9Q. Then download the Portal JSON again and upload the new file.',
};

export function g9TieGuide(key: G9TieKey): G9TieGuide {
  if (key === 'gstr9c.g9filed') {
    return {
      title: 'Enter the GSTR-9 as filed',
      meaning:
        'The portal checks GSTR-9C 5Q (turnover declared) and 9Q (amount paid) against the GSTR-9 you actually filed, to the paisa. This working computes its own GSTR-9 from the books, which can differ from what was filed, so the 9C needs the filed figures before it can be signed off or downloaded.',
      portalError: '“The value of annual turnover declared (annul_turn_decl) in table 5 does not match the value declared in GSTR9” and “total amount paid (tot_amt_paid) in table 9 does not match the declaration in GSTR9”, followed by “unreconciled turnover / payment is incorrect”.',
      steps: [{ text: FIND_FILED }, T5_STEP, T9_STEP, AFTER],
    };
  }
  if (key === 'gstr9c.5Q') {
    return {
      title: '5Q must equal the filed GSTR-9',
      meaning:
        '5Q (turnover as declared in GSTR-9) must be the filed GSTR-9’s 5N + Table 10 − Table 11, to the paisa. It differs now, so the portal will refuse the 9C, and 5R (Q − P) with it.',
      portalError: '“The value of annual turnover declared (annul_turn_decl) in table 5 does not match the value declared in GSTR9”, then “the value of unreconciled turnover (unrec_turnovr) in table 5 is incorrect”.',
      steps: [
        { text: FIND_FILED },
        { ...T5_STEP, text: 'Compare the “GSTR-9 as filed” box on GSTR-9C › Table 5 with the filed return and correct any figure typed wrongly: 5N, Table 10 and Table 11, paise included.' },
        { text: 'If 5Q shows “Typed”, someone typed over it: reset it (the ↺ on the row) so it follows the filed GSTR-9.', goTo: { table: '5', row: 'Q', label: 'Open 5Q' } },
        AFTER,
      ],
    };
  }
  return {
    title: '9Q must equal the filed GSTR-9',
    meaning:
      '9Q (total amount paid as declared in GSTR-9) must be, for each head, the tax paid in filed GSTR-9 Table 9 (cash + ITC) plus Table 14, to the paisa. It differs now, so the portal will refuse the 9C, and 9R (Q − P) with it.',
    portalError: '“Value of cgst / sgst in field total amount paid (tot_amt_paid) in table 9 does not match the declaration in gstr9”, then “unreconciled payment in table 9 is incorrect”.',
    steps: [
      { text: FIND_FILED },
      { ...T9_STEP, text: 'Compare the “GSTR-9 as filed” box on GSTR-9C › Table 9 with the filed return, head by head, and correct any figure typed wrongly. Table 14 paid counts too.' },
      { text: 'If 9Q shows “Typed”, someone typed over it: reset it (the ↺ on the row) so it follows the filed GSTR-9.', goTo: { table: '9', row: 'Q', label: 'Open 9Q' } },
      AFTER,
    ],
  };
}

/** The guide for a difference line, when it is one of these. */
export const guideForLine = (d: Pick<DiffLine, 'key'>): G9TieGuide | null => (isG9TieKey(d.key) ? g9TieGuide(d.key) : null);
