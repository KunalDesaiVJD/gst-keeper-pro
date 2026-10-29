// A GSTIN read from a scan is checked by its own check character (the 15th,
// computed from the first 14), so a misread character (O for 0, I for 1, S for
// 5) shows as a doubt for staff to confirm instead of standing as read.

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Whether a 15 character GSTIN's check character matches the first 14. */
export function gstinValid(gstin: string): boolean {
  const g = gstin.toUpperCase();
  if (!/^[0-9]{2}[0-9A-Z]{13}$/.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36] === g[14];
}

/** The GSTINs in these texts whose check character does not match, each once. */
export function gstinDoubts(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    for (const m of (t ?? '').toUpperCase().matchAll(/\b[0-9]{2}[A-Z0-9]{13}\b/g)) {
      const g = m[0];
      // A GSTIN holds a PAN: five letters among its characters (a long number is not one).
      if ((g.match(/[A-Z]/g) ?? []).length < 5 || seen.has(g)) continue;
      seen.add(g);
      if (!gstinValid(g)) out.push(`GSTIN ${g} as read from the scan fails its check character: confirm it on the paper.`);
    }
  }
  return out;
}
