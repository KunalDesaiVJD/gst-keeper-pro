// Field-level diffing of two GSTR-1 / GSTR-3B payloads.
//
// The version tables record who pushed and when. That answers "something
// changed between v3 and v4" and nothing else. This turns two stored payloads
// into the answer a reviewer actually needs: which row, which figure, from what
// to what — so a wrong number can be traced to the version that introduced it
// and, from the row already in the history table, to the person who pushed it.
//
// Both returns are flattened to the same shape — a map of stable identity key
// to a labelled row of values — and then compared. Identity is what makes the
// diff readable: matching a B2B invoice by customer GSTIN + invoice number +
// tax rate means an edited figure reads as "this line changed", not as one
// invoice deleted and another added.

export type DiffKind = 'added' | 'removed' | 'changed';

export interface DiffFieldChange {
  field: string;
  before: string | number | null;
  after: string | number | null;
}

export interface DiffRow {
  kind: DiffKind;
  /** GST table or section this row belongs to, e.g. "B2B" or "3.1(a) Outward taxable supplies". */
  section: string;
  /** Human identity of the row within the section, e.g. "24ABCDE1234F1Z5 · INV-042 · 18%". */
  row: string;
  fields: DiffFieldChange[];
}

interface FlatRow {
  section: string;
  row: string;
  values: Record<string, string | number>;
}
type FlatMap = Map<string, FlatRow>;

// GSTN's field codes are unreadable to anyone not fluent in the JSON schema,
// and this history is meant to be read by the person checking the mistake.
const FIELD_LABELS: Record<string, string> = {
  txval: 'Taxable value',
  iamt: 'Integrated tax',
  camt: 'Central tax',
  samt: 'State/UT tax',
  csamt: 'Cess',
  rt: 'Rate %',
  val: 'Invoice value',
  idt: 'Invoice date',
  pos: 'Place of supply',
  rchrg: 'Reverse charge',
  inv_typ: 'Invoice type',
  nt_num: 'Note no.',
  nt_dt: 'Note date',
  ntty: 'Note type',
  inter: 'Inter-State',
  intra: 'Intra-State',
  ad_amt: 'Advance amount',
  qty: 'Quantity',
  uqc: 'UQC',
  desc: 'Description',
  sply_ty: 'Supply type',
  typ: 'Type',
  sbpcode: 'Port code',
  sbnum: 'Shipping bill no.',
  sbdt: 'Shipping bill date',
  expt_amt: 'Exempted amount',
  nil_amt: 'Nil rated amount',
  ngsup_amt: 'Non-GST amount',
  num: 'Count',
  from: 'From',
  to: 'To',
  totnum: 'Total issued',
  cancel: 'Cancelled',
  net_issue: 'Net issued',
};

export const diffFieldLabel = (field: string): string => FIELD_LABELS[field] || field;

const TAX_FIELDS = ['txval', 'iamt', 'camt', 'samt', 'csamt'] as const;

// Payloads come back from jsonb as unknown; these keep the traversal typed
// without scattering `any` through a file whose whole job is reading foreign JSON.
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

// Only keep fields that are actually present, so an absent optional field
// doesn't read as "changed to 0" when the other side omits it.
const pick = (obj: unknown, keys: readonly string[]): Record<string, string | number> => {
  const out: Record<string, string | number> = {};
  const o = (obj ?? {}) as Record<string, unknown>;
  keys.forEach((k) => {
    if (o[k] === undefined || o[k] === null) return;
    out[k] = typeof o[k] === 'number' ? (o[k] as number) : String(o[k]);
  });
  return out;
};

const taxOf = (obj: unknown) => pick(obj, TAX_FIELDS);

// ── GSTR-3B ─────────────────────────────────────────────────────────────────
// A fixed set of table rows, so identity is just the row's own label.

// 4(A)/4(B)/4(D) rows are identified by GSTN's `ty` code; spell them out.
const ITC_TY_LABELS: Record<string, string> = {
  IMPG: 'Import of goods',
  IMPS: 'Import of services',
  ISRC: 'Inward supplies liable to reverse charge',
  ISD: 'Inward supplies from ISD',
  OTH: 'All other ITC',
  RUL: 'As per rules 38, 42 & 43 and section 17(5)',
  GST: 'Composition / exempt / nil rated supply',
  NONGST: 'Non-GST supply',
};

export function flattenGstr3b(json: unknown): FlatMap {
  const m: FlatMap = new Map();
  const j = rec(json);
  const put = (key: string, section: string, row: string, values: Record<string, string | number>) => {
    if (Object.keys(values).length > 0) m.set(key, { section, row, values });
  };

  const T31 = 'Table 3.1 — Outward and reverse charge supplies';
  const sd = rec(j.sup_details);
  put('3.1a', T31, '(a) Outward taxable supplies (other than zero rated, nil rated, exempted)', taxOf(sd.osup_det));
  put('3.1b', T31, '(b) Outward taxable supplies (zero rated)', taxOf(sd.osup_zero));
  put('3.1c', T31, '(c) Other outward supplies (nil rated, exempted)', taxOf(sd.osup_nil_exmp));
  put('3.1d', T31, '(d) Inward supplies liable to reverse charge', taxOf(sd.isup_rev));
  put('3.1e', T31, '(e) Non-GST outward supplies', taxOf(sd.osup_nongst));

  arr(rec(j.inter_sup).unreg_details).forEach((raw) => {
    const r = rec(raw);
    put(`3.2u|${str(r.pos)}`, 'Table 3.2 — Inter-State supplies to unregistered persons',
      `Place of supply ${str(r.pos) || '—'}`, pick(r, ['txval', 'iamt']));
  });

  const itc = rec(j.itc_elg);
  const itcSection = (value: unknown, prefix: string, section: string) =>
    arr(value).forEach((raw) => {
      const r = rec(raw);
      const ty = str(r.ty);
      put(`${prefix}|${ty}`, section, ITC_TY_LABELS[ty] || ty || '—', pick(r, ['iamt', 'camt', 'samt', 'csamt']));
    });

  itcSection(itc.itc_avl, '4A', 'Table 4(A) — ITC available');
  itcSection(itc.itc_rev, '4B', 'Table 4(B) — ITC reversed');
  put('4C', 'Table 4(C) — Net ITC available', 'Net ITC available (A) − (B)', pick(itc.itc_net, ['iamt', 'camt', 'samt', 'csamt']));
  itcSection(itc.itc_rclmd, '4D1', 'Table 4(D)(1) — ITC reclaimed');
  itcSection(itc.itc_inelg, '4D2', 'Table 4(D)(2) — Ineligible ITC');

  arr(rec(j.inward_sup).isup_details).forEach((raw) => {
    const r = rec(raw);
    const ty = str(r.ty);
    put(`5|${ty}`, 'Table 5 — Exempt, nil rated and non-GST inward supplies',
      ITC_TY_LABELS[ty] || ty || '—', pick(r, ['inter', 'intra']));
  });

  return m;
}

// ── GSTR-1 ──────────────────────────────────────────────────────────────────
// Arrays keyed by real-world identity. Invoice-level fields and rate-line
// fields are emitted as separate rows so an edited rate line points at that
// line, and a changed invoice value points at the invoice — rather than one
// change smearing across every line of the invoice.

export function flattenGstr1(json: unknown): FlatMap {
  const m: FlatMap = new Map();
  const j = rec(json);
  const put = (key: string, section: string, row: string, values: Record<string, string | number>) => {
    if (Object.keys(values).length > 0) m.set(key, { section, row, values });
  };

  // Invoice-style sections: a header row plus one row per rate line.
  const putDoc = (section: string, keyBase: string, label: string, doc: unknown, headerFields: readonly string[]) => {
    const d = rec(doc);
    put(keyBase, section, label, pick(d, headerFields));
    arr(d.itms).forEach((raw) => {
      const det = rec(rec(raw).itm_det);
      const rt = num(det.rt);
      put(`${keyBase}|rt:${rt}`, section, `${label} · ${rt}%`, taxOf(det));
    });
  };

  const B2B = 'B2B — Registered persons';
  arr(j.b2b).forEach((raw) => {
    const g = rec(raw);
    arr(g.inv).forEach((rawInv) => {
      const inv = rec(rawInv);
      putDoc(B2B, `b2b|${str(g.ctin)}|${str(inv.inum)}`,
        `${str(g.ctin) || '—'} · ${str(inv.inum) || '—'}`, inv, ['idt', 'val', 'pos', 'rchrg', 'inv_typ']);
    });
  });

  const B2CL = 'B2CL — Large unregistered (inter-State)';
  arr(j.b2cl).forEach((raw) => {
    const g = rec(raw);
    arr(g.inv).forEach((rawInv) => {
      const inv = rec(rawInv);
      putDoc(B2CL, `b2cl|${str(g.pos)}|${str(inv.inum)}`,
        `POS ${str(g.pos) || '—'} · ${str(inv.inum) || '—'}`, inv, ['idt', 'val']);
    });
  });

  // No document identity here — the row IS (place of supply, type, rate).
  arr(j.b2cs).forEach((raw) => {
    const r = rec(raw);
    const rt = num(r.rt);
    put(`b2cs|${str(r.pos)}|${str(r.typ)}|${rt}`, 'B2CS — Small unregistered (consolidated)',
      `POS ${str(r.pos) || '—'} · ${str(r.typ) || '—'} · ${rt}%`,
      { ...taxOf(r), ...pick(r, ['sply_ty']) });
  });

  const CDNR = 'CDNR — Credit/debit notes (registered)';
  arr(j.cdnr).forEach((raw) => {
    const g = rec(raw);
    arr(g.nt).forEach((rawNt) => {
      const nt = rec(rawNt);
      putDoc(CDNR, `cdnr|${str(g.ctin)}|${str(nt.nt_num)}`,
        `${str(g.ctin) || '—'} · ${str(nt.nt_num) || '—'}`, nt, ['nt_dt', 'ntty', 'val', 'pos']);
    });
  });

  arr(j.cdnur).forEach((raw) => {
    const nt = rec(raw);
    putDoc('CDNUR — Credit/debit notes (unregistered)', `cdnur|${str(nt.nt_num)}`,
      str(nt.nt_num) || '—', nt, ['nt_dt', 'ntty', 'val', 'pos', 'typ']);
  });

  const EXP = 'EXP — Exports';
  arr(j.exp).forEach((raw) => {
    const g = rec(raw);
    arr(g.inv).forEach((rawInv) => {
      const inv = rec(rawInv);
      putDoc(EXP, `exp|${str(g.exp_typ)}|${str(inv.inum)}`,
        `${str(g.exp_typ) || '—'} · ${str(inv.inum) || '—'}`, inv, ['idt', 'val', 'sbpcode', 'sbnum', 'sbdt']);
    });
  });

  // Advances received / adjusted: keyed by place of supply and rate.
  const putAdvance = (value: unknown, section: string, prefix: string) =>
    arr(value).forEach((raw) => {
      const g = rec(raw);
      arr(g.itms).forEach((rawIt) => {
        const it = rec(rawIt);
        const rt = num(it.rt);
        put(`${prefix}|${str(g.pos)}|${rt}`, section, `POS ${str(g.pos) || '—'} · ${rt}%`,
          pick(it, ['ad_amt', 'iamt', 'camt', 'samt', 'csamt']));
      });
    });
  putAdvance(j.at, 'AT — Advances received (Table 11A)', 'at');
  putAdvance(j.txpd, 'TXPD — Advances adjusted (Table 11B)', 'txpd');

  arr(rec(j.nil).inv).forEach((raw) => {
    const r = rec(raw);
    put(`nil|${str(r.sply_ty)}`, 'NIL — Nil rated, exempted and non-GST',
      str(r.sply_ty) || '—', pick(r, ['nil_amt', 'expt_amt', 'ngsup_amt']));
  });

  arr(rec(j.hsn).data).forEach((raw) => {
    const r = rec(raw);
    const rt = num(r.rt);
    put(`hsn|${str(r.hsn_sc)}|${rt}|${str(r.uqc)}`, 'HSN summary (Table 12)',
      `${str(r.hsn_sc) || '—'} · ${rt}%`,
      { ...pick(r, ['desc', 'uqc', 'qty']), ...taxOf(r) });
  });

  arr(rec(j.doc_issue).doc_det).forEach((rawD) => {
    const d = rec(rawD);
    arr(d.docs).forEach((rawR) => {
      const r = rec(rawR);
      put(`doc|${str(d.doc_num)}|${str(r.num)}`, 'Documents issued (Table 13)',
        `Doc type ${str(d.doc_num) || '—'} · Sr ${str(r.num) || '—'}`,
        pick(r, ['from', 'to', 'totnum', 'cancel', 'net_issue']));
    });
  });

  return m;
}

// ── Compare ─────────────────────────────────────────────────────────────────

// Rupee figures are rounded to 2dp upstream; this only absorbs float noise so
// a re-push of identical data doesn't report phantom changes.
const EPSILON = 0.005;

const sameValue = (a: string | number | undefined, b: string | number | undefined): boolean => {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < EPSILON;
  return String(a) === String(b);
};

function diffFlat(prev: FlatMap, next: FlatMap): DiffRow[] {
  const rows: DiffRow[] = [];
  const keys = new Set<string>([...prev.keys(), ...next.keys()]);

  keys.forEach((k) => {
    const a = prev.get(k);
    const b = next.get(k);

    if (!a && b) {
      rows.push({
        kind: 'added', section: b.section, row: b.row,
        fields: Object.entries(b.values).map(([field, after]) => ({ field, before: null, after })),
      });
      return;
    }
    if (a && !b) {
      rows.push({
        kind: 'removed', section: a.section, row: a.row,
        fields: Object.entries(a.values).map(([field, before]) => ({ field, before, after: null })),
      });
      return;
    }
    if (!a || !b) return;

    const fields: DiffFieldChange[] = [];
    new Set([...Object.keys(a.values), ...Object.keys(b.values)]).forEach((field) => {
      if (!sameValue(a.values[field], b.values[field])) {
        fields.push({ field, before: a.values[field] ?? null, after: b.values[field] ?? null });
      }
    });
    if (fields.length > 0) rows.push({ kind: 'changed', section: b.section, row: b.row, fields });
  });

  // Group by section, then by row, so the reader scans a table at a time.
  return rows.sort((x, y) => x.section.localeCompare(y.section) || x.row.localeCompare(y.row));
}

export const diffGstr3b = (prev: unknown, next: unknown): DiffRow[] =>
  diffFlat(flattenGstr3b(prev), flattenGstr3b(next));

export const diffGstr1 = (prev: unknown, next: unknown): DiffRow[] =>
  diffFlat(flattenGstr1(prev), flattenGstr1(next));

/** Short headline for a version row, e.g. "4 changed, 1 added". */
export function summariseDiff(rows: DiffRow[]): string {
  if (rows.length === 0) return 'No change';
  const n = (k: DiffKind) => rows.filter((r) => r.kind === k).length;
  return [
    n('changed') ? `${n('changed')} changed` : '',
    n('added') ? `${n('added')} added` : '',
    n('removed') ? `${n('removed')} removed` : '',
  ].filter(Boolean).join(', ');
}
