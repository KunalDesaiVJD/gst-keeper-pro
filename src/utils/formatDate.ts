// Converts a Postgres ISO date ('YYYY-MM-DD') to the app's display
// convention (DD/MM/YYYY) — every other report in the app formats dates
// this way; the notice/refund/DRC-03 report builders were the one place
// still pushing the raw DB string straight into the table. Confirmed live
// 2026-09-03: "Refund — All Clients" showing "2026-08-04" instead of
// "04/08/2026". Anything that isn't a plain ISO date (already-formatted
// string, null, a sentinel like "—") passes through unchanged rather than
// risk mangling an unexpected shape.
export const isoDateToDMY = (v: string | null | undefined): string => {
  if (!v) return '—';
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return v;
  return `${m[3]}/${m[2]}/${m[1]}`;
};

// Inverse of isoDateToDMY — needed wherever a DD/MM/YYYY display cell has to
// feed a native <input type="date">, which only accepts/emits YYYY-MM-DD.
// Passes through anything that isn't a plain DD/MM/YYYY string unchanged.
export const dmyToISODate = (v: string | null | undefined): string => {
  if (!v) return '';
  const s = String(v).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return s === '—' ? '' : s;
  return `${m[3]}-${m[2]}-${m[1]}`;
};
