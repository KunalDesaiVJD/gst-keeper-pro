// Verification harness — the "trust engine". Every PULL is reconciled against
// the portal's own totals; every PUSH is read back and diffed against what we
// sent. Nothing is reported as successful unless its self-check passes.

const TOL = 1; // ₹1 rounding tolerance on tax totals

export interface TaxTotal { igst: number; cgst: number; sgst: number; taxable?: number }

export function within(a: number, b: number, tol = TOL): boolean {
  return Math.abs((a || 0) - (b || 0)) <= tol;
}

export function totalsMatch(expected: TaxTotal, actual: TaxTotal, tol = TOL): { passed: boolean; diff: TaxTotal } {
  const diff: TaxTotal = {
    igst: Math.round(((actual.igst || 0) - (expected.igst || 0)) * 100) / 100,
    cgst: Math.round(((actual.cgst || 0) - (expected.cgst || 0)) * 100) / 100,
    sgst: Math.round(((actual.sgst || 0) - (expected.sgst || 0)) * 100) / 100,
  };
  const passed = within(expected.igst, actual.igst, tol)
    && within(expected.cgst, actual.cgst, tol)
    && within(expected.sgst, actual.sgst, tol);
  return { passed, diff };
}

// Generic deep diff of two JSON payloads (used for PUSH read-back). Returns the
// list of paths whose values differ beyond tolerance.
export function jsonDiff(sent: any, readBack: any, path = ''): string[] {
  const diffs: string[] = [];
  if (typeof sent === 'number' && typeof readBack === 'number') {
    if (!within(sent, readBack)) diffs.push(`${path}: sent ${sent} vs portal ${readBack}`);
    return diffs;
  }
  if (Array.isArray(sent) && Array.isArray(readBack)) {
    if (sent.length !== readBack.length) diffs.push(`${path}: length ${sent.length} vs ${readBack.length}`);
    const n = Math.min(sent.length, readBack.length);
    for (let i = 0; i < n; i++) diffs.push(...jsonDiff(sent[i], readBack[i], `${path}[${i}]`));
    return diffs;
  }
  if (sent && readBack && typeof sent === 'object' && typeof readBack === 'object') {
    for (const k of new Set([...Object.keys(sent), ...Object.keys(readBack)])) {
      diffs.push(...jsonDiff(sent[k], readBack[k], path ? `${path}.${k}` : k));
    }
    return diffs;
  }
  if (String(sent ?? '') !== String(readBack ?? '')) diffs.push(`${path}: sent "${sent}" vs portal "${readBack}"`);
  return diffs;
}
