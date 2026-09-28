import {
  AnnualReturnDocs,
  DocKey,
  DtiMonth,
  DtoMonth,
  FY_MONTHS,
  GSTR9C_PARTV_KEYS,
  GSTR9C_T11_KEYS,
  GSTR9C_T16_KEYS,
  GSTR9C_T5_KEYS,
  GSTR9C_T9_OTHER_KEYS,
  GSTR9C_T9_RATE_KEYS,
  MonthKey,
  PortalMeta,
  PortalMonth,
  PortalTable9,
  RateWiseRow,
  T4_KEYS,
  T5_KEYS,
  Tax,
  TaxIn,
  ValTax,
} from './types';

export const zTax = (): Tax => ({ i: 0, c: 0, s: 0, x: 0 });
export const zVal = (): ValTax => ({ t: 0, i: 0, c: 0, s: 0, x: 0 });
/** A blank typed-tax cell: SGST mirrors CGST until typed. */
export const zIn = (): TaxIn => ({ i: 0, c: 0, s: null, x: 0 });
export const zRate = (): RateWiseRow => zVal();

const byMonth = <T,>(make: () => T): Record<MonthKey, T> =>
  Object.fromEntries(FY_MONTHS.map((m) => [m, make()])) as Record<MonthKey, T>;

const emptyDtoMonth = (): DtoMonth => ({ sales: zIn(), creditNote: zIn() });
const emptyDtiMonth = (): DtiMonth => ({
  purchase: zIn(),
  debitNote: zIn(),
  suspRev: zIn(),
  suspRev180: zIn(),
  suspReclaim: zIn(),
  suspReclaim180: zIn(),
});

export const emptyPortalMonth = (): PortalMonth => ({
  outTax: zTax(),
  itcExclRcm: zTax(),
  rcm: zVal(),
  itc4a5: zTax(),
  itc4b1: zTax(),
  itc4b2: zTax(),
  itc4d: zTax(),
  itc4aTotal: zTax(),
});

const emptyMeta = (): PortalMeta => ({ source: null });

const t9Row = () => ({ payable: 0, cash: 0, itcI: 0, itcC: 0, itcS: 0, itcX: 0 });
const t9Other = () => ({ payable: 0, cash: 0 });
export const emptyTable9 = (): PortalTable9 => ({
  igst: t9Row(),
  cgst: t9Row(),
  sgst: t9Row(),
  cess: t9Row(),
  interest: t9Other(),
  lateFee: t9Other(),
  penalty: t9Other(),
  other: t9Other(),
});

const extTax = () => ({ ...zTax(), interest: 0, penalty: 0, lateFee: 0, others: 0 });

const recordOf = <K extends string, T>(keys: readonly K[], make: () => T): Record<K, T> =>
  Object.fromEntries(keys.map((k) => [k, make()])) as Record<K, T>;

/** Default RCM categories — the four blocks of the firm's RCM sheet, all empty. */
export const defaultRcmCategories = () => [];

export const emptyDocs = (): AnnualReturnDocs => ({
  sales: { partA: [], partB: [], auditReportTotal: null },
  purchases: { rows: [], suspendedOtherAdj: zIn() },
  duties_output: { months: byMonth(emptyDtoMonth), adjustments: [] },
  duties_input: { lastYearEffect: zIn(), months: byMonth(emptyDtiMonth), adjustments: [] },
  rcm: { categories: [] },
  portal: {
    gstr9: {
      table4: recordOf(T4_KEYS, zVal),
      table5: recordOf(T5_KEYS, () => 0),
      t6A: zTax(),
      t6G: zTax(),
      t8A: zTax(),
      table9: emptyTable9(),
    },
    gstr9Meta: emptyMeta(),
    months: byMonth(emptyPortalMonth),
    monthMeta: byMonth(emptyMeta),
    manual: {},
  },
  gstr9: {
    t6A1: null,
    t6G: null,
    t6K: zIn(),
    t6L: zIn(),
    t6M: zIn(),
    t7: {
      r37: zIn(),
      r37A: zIn(),
      r38: zIn(),
      r39: zIn(),
      r42: zIn(),
      r43: zIn(),
      s17_5: null,
      tran1: zIn(),
      tran2: zIn(),
      otherDesc: 'Suspended ITC reversed (as per books)',
      otherExtra: [],
    },
    t8E: zIn(),
    t8F: zIn(),
    t8H1: zIn(),
    t9Payable: { igst: null, cgst: null, sgst: null, cess: null },
    t10: zVal(),
    t11: zVal(),
    t12: null,
    t13: zIn(),
    t14: recordOf(['igst', 'cgst', 'sgst', 'cess', 'interest'] as const, () => ({ payable: 0, paid: 0 })),
    t15: {
      refundClaimed: zTax(),
      refundSanctioned: zTax(),
      refundRejected: zTax(),
      refundPending: zTax(),
      demandTotal: extTax(),
      demandPaid: extTax(),
      demandPending: extTax(),
    },
    t16: { compositionSupplies: 0, deemedSupply: zVal(), approvalNotReturned: zVal() },
    t17: [],
    t18: [],
    t19: { cgst: { payable: 0, paid: 0 }, sgst: { payable: 0, paid: 0 } },
    t5Extra: { dr_nt: 0, amd_pos: 0, amd_neg: 0 },
    t4BooksExtra: { at: zVal(), dr_nt: zVal(), amd_pos: zVal(), amd_neg: zVal() },
  },
  annexures: {
    a1NonGstIncome: 0,
    a1SaleReturn: zVal(),
    a3RcmToPay: null,
    a3ExcessItc: null,
    a3Other: [],
    a3AlreadyPaid: zIn(),
    a4: recordOf(['c8', 'c10', 'c11', 'c12', 'c13'] as const, zIn),
  },
  gstr9c: {
    t5A: null,
    t5: recordOf(GSTR9C_T5_KEYS, () => 0),
    t5Q: null,
    t6Reasons: '',
    t7: { B: null, C: null, D: null, D1: null },
    t7F: null,
    t8Reasons: '',
    t9: recordOf(GSTR9C_T9_RATE_KEYS, () => null),
    t9Other: recordOf(GSTR9C_T9_OTHER_KEYS, zTax),
    t9Q: null,
    t10Reasons: '',
    t11: recordOf(GSTR9C_T11_KEYS, zRate),
    t12A: null,
    t12B: null,
    t12C: null,
    t13Reasons: '',
    t15Reasons: '',
    t16: recordOf(GSTR9C_T16_KEYS, () => 0),
    partV: recordOf(GSTR9C_PARTV_KEYS, zRate),
    certification: {
      place: '',
      signatory_name: '',
      membership_no: '',
      signature_date: '',
      building_no: '',
      floor_number: '',
      premises_name: '',
      road_street: '',
      city_town_locality: '',
      district: '',
      state: '',
      pin_code: '',
      pan: '',
    },
  },
  notice: {
    deemedSupplies: null,
    unreturnedGoods: null,
    pendingDemands: null,
    prevYearT14: zIn(),
    prevYear8C: null,
    ineligible4D: null,
    ineligible164: zIn(),
    itcUsed4A5: null,
    reversed4B2: null,
  },
  justifications: { lines: {} },
  settings: { tolerance: 10 },
});

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Deep-merge a stored doc over its defaults so a doc saved by an older
 * build (or a partial import) always has every field the engine reads.
 * Arrays and nulls from storage win as-is; objects merge key by key.
 * A stored `null` only survives where the default is also nullable (i.e.
 * the default itself is null), otherwise the default object is kept.
 */
export function mergeDefaults<T>(def: T, stored: unknown): T {
  if (stored === undefined) return def;
  if (def === null) return (stored as T) ?? def;
  if (Array.isArray(def)) return (Array.isArray(stored) ? stored : def) as T;
  if (isPlainObject(def)) {
    if (!isPlainObject(stored)) return def;
    const out: Record<string, unknown> = { ...stored };
    for (const k of Object.keys(def)) {
      out[k] = mergeDefaults((def as Record<string, unknown>)[k], stored[k]);
    }
    return out as T;
  }
  if (typeof def === 'number') {
    const n = typeof stored === 'number' ? stored : Number(stored);
    return (Number.isFinite(n) ? n : def) as T;
  }
  if (typeof def === 'string') return (typeof stored === 'string' ? stored : def) as T;
  if (typeof def === 'boolean') return (typeof stored === 'boolean' ? stored : def) as T;
  return (stored as T) ?? def;
}

export function normalizeDoc<K extends DocKey>(key: K, stored: unknown): AnnualReturnDocs[K] {
  return mergeDefaults(emptyDocs()[key], stored);
}

export function normalizeDocs(stored: Partial<Record<DocKey, unknown>>): AnnualReturnDocs {
  const def = emptyDocs();
  const out = {} as AnnualReturnDocs;
  (Object.keys(def) as DocKey[]).forEach((k) => {
    (out as Record<DocKey, unknown>)[k] = mergeDefaults(def[k], stored[k]);
  });
  return out;
}

let idCounter = 0;
/** Short client-side row id (rows live inside JSON docs, not their own table). */
export const newId = (): string => {
  idCounter = (idCounter + 1) % 1e6;
  return `${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
};
