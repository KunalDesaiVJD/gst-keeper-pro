/**
 * What an earlier month last reported in Table 7 (B2CS), by place of supply
 * and rate, so a Table 10 (b2csa) amendment of that month counts in this
 * month's GSTR-3B 3.1(a) at its difference: revised less earlier.
 *
 * The earlier figure for (month, POS, rate) is the latest of: a Table 10
 * restatement of that month in any GSTR-1 between it and this one, else that
 * month's own Table 7. A month whose GSTR-1 is not in the app is `null`: its
 * earlier figure is taken as nil and the draft says so
 * (docs/GSTR3B_OUTWARD_POSITIONS.md §2, position 12). Pure; the database
 * read is loadB2csaBaselines.ts.
 */

export interface B2csHeads { txval: number; iamt: number; camt: number; samt: number; csamt: number }
export interface B2csaBaseline {
  /** Where the earlier figure came from, e.g. "GSTR-1 03/2026" or "Table 10 in GSTR-1 06/2026". */
  source: string;
  byKey: Record<string, B2csHeads>;
}
/** By the amended month (`omon`, MMYYYY). */
export type B2csaBaselines = Record<string, B2csaBaseline | null>;

type Gj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const list = (v: unknown): Gj[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/** A B2CS line's key: place of supply and rate. */
export const b2csKey = (pos: unknown, rt: unknown): string => `${String(pos ?? '').trim()}|${num(rt)}`;
/** Table 10 rate lines: under itms[] in the portal's shape, flat in older files. */
export const b2csaLines = (a: Gj): Gj[] => (Array.isArray(a.itms) && a.itms.length ? a.itms : [a]);
/** MMYYYY to a sortable YYYYMM. */
const ord = (mmyyyy: string): number => {
  const s = String(mmyyyy || '');
  return (parseInt(s.slice(2), 10) || 0) * 100 + (parseInt(s.slice(0, 2), 10) || 0);
};
const heads = (): B2csHeads => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
const addTo = (to: B2csHeads, d: Gj) => {
  to.txval += num(d.txval); to.iamt += num(d.iamt); to.camt += num(d.camt); to.samt += num(d.samt); to.csamt += num(d.csamt);
};

/**
 * Pure: the baselines for every month the given GSTR-1's restated Table 10
 * entries amend, from the client's other GSTR-1s by return period (MMYYYY).
 * `isRestated` tells a restatement from a re-rating difference (which is
 * folded as it stands and needs no baseline).
 */
export function buildB2csaBaselines(raw: Gj, months: Record<string, Gj>, isRestated: (a: Gj) => boolean): B2csaBaselines {
  const current = String(raw?.fp || '');
  const out: B2csaBaselines = {};
  const omons = new Set(list(raw?.b2csa).filter(isRestated).map((a) => String(a.omon || '').trim()).filter(Boolean));
  omons.forEach((omon) => {
    const own = months[omon];
    let base: B2csaBaseline | null = null;
    if (own) {
      const byKey: Record<string, B2csHeads> = {};
      list(own.b2cs).forEach((r) => { const k = b2csKey(r.pos, r.rt); addTo((byKey[k] = byKey[k] || heads()), r); });
      base = { source: `GSTR-1 ${omon.slice(0, 2)}/${omon.slice(2)}`, byKey };
    }
    // Later restatements of the same month, oldest first, so the latest wins.
    Object.keys(months)
      .filter((m) => ord(m) > ord(omon) && (!current || ord(m) < ord(current)))
      .sort((a, b) => ord(a) - ord(b))
      .forEach((m) => {
        const restated: Record<string, B2csHeads> = {};
        list(months[m].b2csa).filter((a) => String(a.omon || '').trim() === omon && isRestated(a)).forEach((a) =>
          b2csaLines(a).forEach((l) => { const k = b2csKey(a.pos, l.rt); addTo((restated[k] = restated[k] || heads()), l); }));
        if (!Object.keys(restated).length) return;
        base = { source: `Table 10 in GSTR-1 ${m.slice(0, 2)}/${m.slice(2)}`, byKey: { ...(base?.byKey || {}), ...restated } };
      });
    out[omon] = base;
  });
  return out;
}
