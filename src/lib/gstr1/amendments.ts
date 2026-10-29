/**
 * GSTR-1 amendments counted at their difference (docs/GSTR3B_OUTWARD_POSITIONS.md
 * §2, position 12).
 *
 * An amendment table restates an earlier month's document or line in full:
 * 9A (b2ba, b2cla, expa) an invoice, 9C (cdnra, cdnura) a note, Table 10
 * (b2csa) a B2CS line by place of supply and rate, 11(2) (ata, txpda) an
 * advance line by place of supply and rate. What this month owes is the
 * revised figure less what was last reported for the same document or line:
 * the latest earlier amendment of it, else the original where it was first
 * reported. Not found in the client's GSTR-1s in the app: taken as nil, and
 * said so.
 *
 * Each difference is two small GSTR-1 JSONs in the base tables' own shape
 * (`revised` and `earlier`), so the caller sorts and signs them with the
 * same rules as any other document (3.1(a) / (b), notes, reverse charge,
 * Table 3.2). Pure; the database read is loadGstr1History.ts.
 */

type Gj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const list = (v: unknown): Gj[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const norm = (v: unknown): string => String(v ?? '').trim().toUpperCase();

/** The client's other GSTR-1 JSONs by return period, MMYYYY. */
export type Gstr1History = Record<string, Gj>;

export interface AmendmentDifference {
  table: 'b2ba' | 'b2cla' | 'expa' | 'cdnra' | 'cdnura' | 'b2csa' | 'ata' | 'txpda';
  label: string;
  /** The document or line amended, e.g. "invoice 0263/26-27 of 17-06-2026" or "03/2026, POS 24, 18%". */
  ref: string;
  /** The revised document or line, in its base table's shape. */
  revised: Gj;
  /** What was last reported for it, in its base table's shape; null when not found (taken as nil). */
  earlier: Gj | null;
  /** Where `earlier` came from, e.g. "GSTR-1 06/2026" or "Table 9A in GSTR-1 07/2026". */
  source: string;
}

export const AMENDMENT_TABLE_LABELS: Record<AmendmentDifference['table'], string> = {
  b2ba: 'Table 9A B2B invoice (b2ba)',
  b2cla: 'Table 9A B2C large invoice (b2cla)',
  expa: 'Table 9A export invoice (expa)',
  cdnra: 'Table 9C registered note (cdnra)',
  cdnura: 'Table 9C unregistered note (cdnura)',
  b2csa: 'Table 10 B2C small (b2csa)',
  ata: 'Table 11(2) advance received (ata)',
  txpda: 'Table 11(2) advance adjusted (txpda)',
};

/** Rate lines of a Table 10 / 11(2) entry: under itms[] in the portal's shape, flat in older files. */
export const b2csaLines = (a: Gj): Gj[] => (Array.isArray(a.itms) && a.itms.length ? a.itms : [a]);

/** True when a GSTR-1 holds any amendment table. */
export const hasAmendments = (g: Gj | null | undefined): boolean =>
  !!g && (['b2ba', 'b2cla', 'expa', 'cdnra', 'cdnura', 'b2csa', 'ata', 'txpda'] as const).some((t) => list(g[t]).length > 0);

const ord = (mmyyyy: string): number => {
  const s = String(mmyyyy || '');
  return (parseInt(s.slice(2), 10) || 0) * 100 + (parseInt(s.slice(0, 2), 10) || 0);
};
const label = (m: string) => `${m.slice(0, 2)}/${m.slice(2)}`;

/** Earlier GSTR-1s than `current` (MMYYYY), latest first. */
const earlierMonths = (history: Gstr1History, current: string, self?: Gj): string[] =>
  Object.keys(history).filter((m) => history[m] !== self && (!current || ord(m) < ord(current))).sort((a, b) => ord(b) - ord(a));

/**
 * The last report of one document: in each earlier month, latest first, an
 * amendment of it (matched on the original number and date it names), else
 * the document itself (matched on its number and date). The date is matched
 * when both sides carry one.
 */
function findDocument<T>(
  history: Gstr1History, current: string,
  inMonth: (g: Gj) => { amended: (pick: (num: string, dt: string) => boolean) => T | null; original: (pick: (num: string, dt: string) => boolean) => T | null },
  number: string, date: string, self?: Gj,
): { found: T; source: string } | null {
  const want = (n: string, d: string) => norm(n) === norm(number) && (!date || !d || norm(d) === norm(date));
  for (const m of earlierMonths(history, current, self)) {
    const look = inMonth(history[m]);
    const a = look.amended(want);
    if (a) return { found: a, source: `amendment in GSTR-1 ${label(m)}` };
    const o = look.original(want);
    if (o) return { found: o, source: `GSTR-1 ${label(m)}` };
  }
  return null;
}

/**
 * The last report of one Table 10 / 11(2) line (amended month, POS, rate):
 * the latest restatement of that month in a GSTR-1 between, else that
 * month's own Table 7 / 11A / 11B. The month's GSTR-1 not in the app and no
 * restatement: null.
 */
function findLine(
  history: Gstr1History, current: string, omon: string, pos: string, rt: number,
  amendedTable: 'b2csa' | 'ata' | 'txpda', baseLines: (g: Gj) => Gj[],
  isRestated: (a: Gj) => boolean, self?: Gj,
): { lines: Gj[]; source: string } | null {
  for (const m of earlierMonths(history, current, self)) {
    if (ord(m) <= ord(omon)) break;
    const lines: Gj[] = [];
    list(history[m][amendedTable]).filter((a) => norm(a.omon) === norm(omon) && norm(a.pos) === norm(pos) && isRestated(a))
      .forEach((a) => b2csaLines(a).filter((l) => num(l.rt) === rt).forEach((l) => lines.push({ ...l, pos: a.pos, sply_ty: a.sply_ty })));
    if (lines.length) return { lines, source: `amendment in GSTR-1 ${label(m)}` };
  }
  const own = history[omon];
  if (!own || own === self) return null;
  return { lines: baseLines(own).filter((l) => norm(l.pos) === norm(pos) && num(l.rt) === rt), source: `GSTR-1 ${label(omon)}` };
}

/**
 * Every amendment in `g` with its revised and earlier figures. `isRestated`
 * tells a Table 10 restatement from the Builder's re-rating difference (a
 * line below zero, lines netting to nil), which states the difference
 * itself and is counted as it stands, so it is not listed here.
 */
export function amendmentDifferences(g: Gj | null, history: Gstr1History, isRestated: (a: Gj) => boolean): AmendmentDifference[] {
  if (!g || !hasAmendments(g)) return [];
  const current = String(g.fp || '');
  const out: AmendmentDifference[] = [];
  const push = (table: AmendmentDifference['table'], ref: string, revised: Gj, hit: { found: Gj; source: string } | null) =>
    out.push({ table, label: AMENDMENT_TABLE_LABELS[table], ref, revised, earlier: hit ? hit.found : null, source: hit?.source || '' });

  // 9A B2B: party { ctin, inv[] }; the invoice names the original (oinum, oidt).
  list(g.b2ba).forEach((p) => list(p.inv).forEach((inv) => {
    const hit = findDocument<Gj>(history, current, (h) => ({
      amended: (want) => { for (const q of list(h.b2ba)) for (const i of list(q.inv)) if (want(i.oinum, i.oidt)) return { b2b: [{ ctin: q.ctin, inv: [i] }] }; return null; },
      original: (want) => { for (const q of list(h.b2b)) for (const i of list(q.inv)) if (want(i.inum, i.idt)) return { b2b: [{ ctin: q.ctin, inv: [i] }] }; return null; },
    }), inv.oinum || inv.inum, inv.oidt || inv.idt, g);
    push('b2ba', `invoice ${inv.oinum || inv.inum}${inv.oidt ? ` of ${inv.oidt}` : ''}`, { b2b: [{ ctin: p.ctin, inv: [inv] }] }, hit);
  }));
  // 9A B2C large: { pos, inv[] }.
  list(g.b2cla).forEach((s) => list(s.inv).forEach((inv) => {
    const hit = findDocument<Gj>(history, current, (h) => ({
      amended: (want) => { for (const q of list(h.b2cla)) for (const i of list(q.inv)) if (want(i.oinum, i.oidt)) return { b2cl: [{ pos: q.pos, inv: [i] }] }; return null; },
      original: (want) => { for (const q of list(h.b2cl)) for (const i of list(q.inv)) if (want(i.inum, i.idt)) return { b2cl: [{ pos: q.pos, inv: [i] }] }; return null; },
    }), inv.oinum || inv.inum, inv.oidt || inv.idt, g);
    push('b2cla', `invoice ${inv.oinum || inv.inum}${inv.oidt ? ` of ${inv.oidt}` : ''}`, { b2cl: [{ pos: s.pos, inv: [inv] }] }, hit);
  }));
  // 9A exports: { exp_typ, inv[] }.
  list(g.expa).forEach((e) => list(e.inv).forEach((inv) => {
    const hit = findDocument<Gj>(history, current, (h) => ({
      amended: (want) => { for (const q of list(h.expa)) for (const i of list(q.inv)) if (want(i.oinum, i.oidt)) return { exp: [{ exp_typ: q.exp_typ, inv: [i] }] }; return null; },
      original: (want) => { for (const q of list(h.exp)) for (const i of list(q.inv)) if (want(i.inum, i.idt)) return { exp: [{ exp_typ: q.exp_typ, inv: [i] }] }; return null; },
    }), inv.oinum || inv.inum, inv.oidt || inv.idt, g);
    push('expa', `export invoice ${inv.oinum || inv.inum}${inv.oidt ? ` of ${inv.oidt}` : ''}`, { exp: [{ exp_typ: e.exp_typ, inv: [inv] }] }, hit);
  }));
  // 9C registered notes: party { ctin, nt[] }; the note names the original (ont_num, ont_dt).
  list(g.cdnra).forEach((p) => list(p.nt).forEach((nt) => {
    const hit = findDocument<Gj>(history, current, (h) => ({
      amended: (want) => { for (const q of list(h.cdnra)) for (const n of list(q.nt)) if (want(n.ont_num, n.ont_dt)) return { cdnr: [{ ctin: q.ctin, nt: [n] }] }; return null; },
      original: (want) => { for (const q of list(h.cdnr)) for (const n of list(q.nt)) if (want(n.nt_num, n.nt_dt)) return { cdnr: [{ ctin: q.ctin, nt: [n] }] }; return null; },
    }), nt.ont_num || nt.nt_num, nt.ont_dt || nt.nt_dt, g);
    push('cdnra', `note ${nt.ont_num || nt.nt_num}${nt.ont_dt ? ` of ${nt.ont_dt}` : ''}`, { cdnr: [{ ctin: p.ctin, nt: [nt] }] }, hit);
  }));
  // 9C unregistered notes: flat nt rows.
  list(g.cdnura).forEach((nt) => {
    const hit = findDocument<Gj>(history, current, (h) => ({
      amended: (want) => { for (const n of list(h.cdnura)) if (want(n.ont_num, n.ont_dt)) return { cdnur: [n] }; return null; },
      original: (want) => { for (const n of list(h.cdnur)) if (want(n.nt_num, n.nt_dt)) return { cdnur: [n] }; return null; },
    }), nt.ont_num || nt.nt_num, nt.ont_dt || nt.nt_dt, g);
    push('cdnura', `note ${nt.ont_num || nt.nt_num}${nt.ont_dt ? ` of ${nt.ont_dt}` : ''}`, { cdnur: [nt] }, hit);
  });

  // Table 10 and 11(2): one difference per (amended month, POS, rate).
  const lineTable = (
    table: 'b2csa' | 'ata' | 'txpda', restated: (a: Gj) => boolean,
    baseLines: (h: Gj) => Gj[], asJson: (lines: Gj[]) => Gj,
  ) => {
    const by = new Map<string, { omon: string; pos: string; rt: number; lines: Gj[] }>();
    list(g[table]).filter(restated).forEach((a) => b2csaLines(a).forEach((l) => {
      const omon = String(a.omon || '').trim();
      const k = `${omon}|${norm(a.pos)}|${num(l.rt)}`;
      const e = by.get(k) || { omon, pos: String(a.pos ?? '').trim(), rt: num(l.rt), lines: [] };
      e.lines.push({ ...l, pos: a.pos, sply_ty: a.sply_ty });
      by.set(k, e);
    }));
    by.forEach((e) => {
      const hit = findLine(history, current, e.omon, e.pos, e.rt, table, baseLines, restated, g);
      push(table, `${e.omon ? label(e.omon) : 'month not named'}, POS ${e.pos}, ${e.rt}%`, asJson(e.lines),
        hit ? { found: asJson(hit.lines), source: hit.source } : null);
    });
  };
  lineTable('b2csa', isRestated, (h) => list(h.b2cs), (lines) => ({ b2cs: lines }));
  const advLines = (rows: unknown) => list(rows).flatMap((a) => b2csaLines(a).map((l) => ({ ...l, pos: a.pos, sply_ty: a.sply_ty })));
  const advJson = (key: 'at' | 'txpd') => (lines: Gj[]) => ({ [key]: lines.map((l) => ({ pos: l.pos, sply_ty: l.sply_ty, itms: [l] })) });
  lineTable('ata', () => true, (h) => advLines(h.at), advJson('at'));
  lineTable('txpda', () => true, (h) => advLines(h.txpd), advJson('txpd'));
  return out;
}
