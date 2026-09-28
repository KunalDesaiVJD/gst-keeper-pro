// Section 16(4) cut-off for availing ITC of a financial year.
//
// From FY 2021-22: 30 November following the end of the FY (s.16(4) as
// amended by the Finance Act 2022). For FY 2017-18 to 2020-21, s.16(5)
// (Finance (No. 2) Act 2024) allows ITC in any return filed up to
// 30 November 2021. The firm's sheet still printed the old 20-Oct-2021 date.

/** "2024-25" → 30 Nov 2025 (local date). */
export const itcCutoffDate = (financialYear: string): Date => {
  const start = Number(financialYear.slice(0, 4));
  if (start >= 2017 && start <= 2020) return new Date(2021, 10, 30);
  return new Date(start + 1, 10, 30);
};

/** 30-11-2025 */
export const fmtDmy = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
