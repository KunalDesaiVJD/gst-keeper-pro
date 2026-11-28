// The short guide for the GSTR-9C cells the GST portal checks against the filed GSTR-9: 5Q
// (annul_turn_decl) and 9Q (tot_amt_paid). Shared by the cell's badge pop-over, the sign-off panel and
// the Portal JSON tab, so every screen says the same few words. Pure; no I/O.

export type G9TieKey = 'gstr9c.g9filed.5Q' | 'gstr9c.g9filed.9Q' | 'gstr9c.5Q' | 'gstr9c.9Q';
const KEYS: readonly string[] = ['gstr9c.g9filed.5Q', 'gstr9c.g9filed.9Q', 'gstr9c.5Q', 'gstr9c.9Q'];
export const isG9TieKey = (k: string): k is G9TieKey => KEYS.includes(k);

export interface G9TieGuide {
  /** The cell it is about. */
  cell: '5Q' | '9Q';
  /** One line: why the cell needs attention. */
  why: string;
  /** Two or three short steps. */
  steps: string[];
}

export function g9TieGuide(key: G9TieKey): G9TieGuide {
  const turnover = key.endsWith('5Q');
  const cell = turnover ? '5Q' : '9Q';
  const what = turnover ? '5N + Table 10 − Table 11' : 'Table 9 paid (cash + ITC) + Table 14 paid, per head';
  if (key.startsWith('gstr9c.g9filed.')) {
    return {
      cell,
      why: `The portal matches ${cell} with your filed GSTR-9 to the paisa.`,
      steps: [`Open the filed GSTR-9 (PDF).`, `Type its ${what} in ${cell}, or click “Same as filed” if it shows the figure below.`],
    };
  }
  return {
    cell,
    why: `${cell} was typed over and no longer equals the filed GSTR-9; the portal will refuse it.`,
    steps: [`Reset ${cell} (↺ on the row), then confirm it from the filed GSTR-9.`],
  };
}
