// Table 4(D)(1) of GSTR-3B, "ITC reclaimed which was reversed under Table
// 4(B)(2) in earlier tax period", is on ITC Summary the sum of its two parts:
//   1.1 Reclaim of ITC Reversed for Previous months (row 5.4's reclaim), and
//   1.2 Reclaim of ITC Reversed due to 180 days rule/Others.
// Row (1) is never a figure of its own: ITC Summary, the GSTR-3B page and its
// JSON all take it from here, so a summary saved while row (1) held 1.1 alone
// reads right too. 4(D) is a memorandum: the reclaims are already inside
// 4(A)(5) (rows 5.4 and 5.5), so nothing adds 4(D) to the credit.
// Pure (no Supabase, no React), so scripts/verify-itc-4d.mjs runs it under Node.

export interface Heads4D { igst: number; cgst: number; sgst: number }

interface Row4D { srNo?: string | null; igst?: unknown; cgst?: unknown; sgst?: unknown }

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number): number => Math.round(n * 100) / 100;
const find = <T extends Row4D>(rows: readonly T[], sr: string): T | undefined => rows.find((r) => r?.srNo === sr);
const headsOf = (r: Row4D | undefined): Heads4D => ({ igst: num(r?.igst), cgst: num(r?.cgst), sgst: num(r?.sgst) });

/** 4(D)(1): rows 1.1 + 1.2 where the summary has them, else its row (1) as saved. */
export function reclaimed4D1(rows: readonly Row4D[] | null | undefined): Heads4D {
  const list = rows ?? [];
  const p1 = find(list, '1.1');
  const p2 = find(list, '1.2');
  if (!p1 && !p2) return headsOf(find(list, '(1)'));
  const a = headsOf(p1);
  const b = headsOf(p2);
  return { igst: r2(a.igst + b.igst), cgst: r2(a.cgst + b.cgst), sgst: r2(a.sgst + b.sgst) };
}

/** The section's rows with row (1) set to 1.1 + 1.2; the rows as given when it has neither part. */
export function with4D1Total<T extends Row4D>(rows: T[]): T[];
export function with4D1Total<T extends Row4D>(rows: T[] | null | undefined): T[] | null | undefined;
export function with4D1Total<T extends Row4D>(rows: T[] | null | undefined): T[] | null | undefined {
  if (!rows || !rows.some((r) => r?.srNo === '1.1' || r?.srNo === '1.2')) return rows;
  const total = reclaimed4D1(rows);
  return rows.map((r) => (r?.srNo === '(1)' ? { ...r, ...total } : r));
}
