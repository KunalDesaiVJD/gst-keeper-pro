// Figure links for GSTR-9 Tables 9 to 19 (figureLinks.ts): where each figure
// shown there comes from. Each target names the source table by its own
// `label` prop and the row id it renders, so FigureFocus finds the row.

import type { FigTarget } from '@/lib/gstr9/figureLinks';

/** Portal data › GSTR-9 system computed › Table 9 (portal/Gstr9Section.tsx). Columns: payable, cash, itcC, itcS, itcI, itcX. */
export const portalT9 = (row: string, col?: string): FigTarget => ({
  step: 'portal',
  tab: { portaltab: 'gstr9', g9portaltab: 't9' },
  table: 'GSTR-9 Table 9 from the portal',
  row,
  col,
  label: 'Portal data › GSTR-9 Table 9',
});

/** GSTR-9 › Table 4, row 4N (PartII.tsx, MatrixTable keyed by code). Columns: t, c, s, i, x. */
export const gstr9T4N = (col?: string): FigTarget => ({
  step: 'gstr9',
  tab: { gstr9tab: '4' },
  table: 'GSTR-9 Table 4',
  row: '4N',
  col,
  label: 'GSTR-9 › Table 4N',
});

/** GSTR-9 › Table 5, row 5N (PartII.tsx, FormTable keyed by code). Columns: t, c, s, i, x. */
export const gstr9T5N = (col?: string): FigTarget => ({
  step: 'gstr9',
  tab: { gstr9tab: '5' },
  table: 'GSTR-9 Table 5',
  row: '5N',
  col,
  label: 'GSTR-9 › Table 5N',
});

/** GSTR-9 › Tables 10 and 11 (PartV.tsx), row t10 or t11. Columns: t, c, s, i, x. */
export const gstr9T10or11 = (row: 't10' | 't11', col?: string): FigTarget => ({
  step: 'gstr9',
  tab: { gstr9tab: '10' },
  table: 'GSTR-9 Tables 10 and 11',
  row,
  col,
  label: `GSTR-9 › Table ${row === 't10' ? '10' : '11'}`,
});

/** ITC reco › 6A1, 12 & 13 tab › "GSTR-9 Tables 12 and 13" (ItcRecoStep.tsx NextYearCard). Columns: i, c, s, x. */
export const itcNextYear = (row: 't12' | 't13', col?: string): FigTarget => ({
  step: 'itc',
  tab: { itctab: 'next' },
  table: 'GSTR-9 Tables 12 and 13',
  row,
  col,
  label: `ITC reco › Table ${row === 't12' ? '12' : '13'}`,
});
