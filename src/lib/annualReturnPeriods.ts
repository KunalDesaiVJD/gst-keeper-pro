// Shared FY <-> month helpers for the Annual Return module, so every card
// that needs "the 12 months of this financial year" (Portal Capture, the
// reconciliation engine, later phases) generates the exact same list in the
// exact same "Mon-YY" format gst_filed_returns.period_month is keyed by.

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

/** FY "2025-26" -> ["Apr-25", "May-25", ..., "Mar-26"] */
export const monthsForFY = (fy: string): string[] => {
  const [startStr] = fy.split('-');
  const startYear = Number(startStr);
  const endYear = startYear + 1;
  return MONTHS.map((m, i) => {
    const year = i < 9 ? startYear : endYear;
    return `${m}-${String(year).slice(-2)}`;
  });
};

/** Current FY (Apr–Mar) plus the previous 2 and next 1. */
export const fyOptions = (): string[] => {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const years: string[] = [];
  for (let i = -2; i <= 1; i++) {
    const y = startYear + i;
    years.push(`${y}-${String(y + 1).slice(-2)}`);
  }
  return years;
};
