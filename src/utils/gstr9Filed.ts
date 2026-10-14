// The filed GSTR-9 as the extension saves it (gst_filed_returns,
// return_type 'GSTR9_FILED', extension 0.10.3): the details the portal's own
// GSTR-9 form loads, in the GSTR-9 JSON schema. This reads what the Builder
// Rule 42/43 working needs from Tables 6 and 7.
//
//   Table 6 (ITC availed): supp_non_rchrg (6B), supp_rchrg_unreg (6C),
//     supp_rchrg_reg (6D), iog (6E) — each a list of {itc_typ: 'ip'|'cg'|'is',
//     iamt, camt, samt, csamt}; ios (6F, services), isd (6G), itc_clmd (6H),
//     other (6M) — amounts only.
//   Table 7 (ITC reversed): rule37 (7A), rule39 (7B), rule42 (7C), rule43
//     (7D), sec17 (7E), revsl_tran1 (7F), revsl_tran2 (7G), other (7H, a list).
//
// Rows can come as a single object or a list; amounts may be strings.

import { ZERO, add, t7, tax, type T7Other, type Tax } from '@/utils/builderItcReversal';

type Row = Record<string, unknown>;

const amt = (r: Row | null | undefined): Tax => tax({
  i: Number(r?.iamt) || 0, c: Number(r?.camt) || 0, s: Number(r?.samt) || 0, x: Number(r?.csamt) || 0,
});
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v as Row[] : v && typeof v === 'object' ? [v as Row] : []);

/** Find `table6` / `table7` wherever the portal nests them. */
const findTable = (data: unknown, key: string, depth = 0): Row | null => {
  if (!data || typeof data !== 'object' || depth > 4) return null;
  const o = data as Row;
  if (o[key] && typeof o[key] === 'object') return o[key] as Row;
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith('_')) continue; // the extension's kept raw answers (_captures)
    const hit = findTable(v, key, depth + 1);
    if (hit) return hit;
  }
  return null;
};

export interface FiledGstr9Itc {
  /** Inputs and input services availed (Rule 42 base): 6B–6H by type ip/is, plus 6M. */
  inputsServices: Tax;
  /** Capital goods availed (Rule 43 base): 6B–6E by type cg. */
  capitalGoods: Tax;
  /** Reversed under Rule 42 / Rule 43 (Table 7C / 7D). */
  reversedR42: Tax;
  reversedR43: Tax;
  /** The rest of Table 7: 7A, 7B, 7E, 7F, 7G, 7H. */
  otherReversed: T7Other;
  /** Total availed per Table 6 (both of the above). */
  availed: Tax;
  /** Table 6 came with its rows (by type); false = only its total was read. */
  detail6: boolean;
  /** Table 7 came with its rows (7A to 7H); false = only its total (7I) was read. */
  detail7: boolean;
  /** 7I as filed, when the return gave Table 7's total (rows or not). */
  reversedTotal: Tax | null;
  /** Table 6 taken as 6O from Table 7 (its own rows not read), all as inputs and input services. */
  tab6oFrom7?: boolean;
  /** False when the return carried no Table 6 or 7 at all. */
  found: boolean;
}

const DETAIL6 = ['supp_non_rchrg', 'supp_rchrg_unreg', 'supp_rchrg_reg', 'iog', 'ios', 'isd', 'itc_clmd'];
const DETAIL7 = ['rule37', 'rule37A', 'rule38', 'rule39', 'rule42', 'rule43', 'sec17', 'revsl_tran1', 'revsl_trans1', 'other'];
const isAmount = (o: Row | null) => !!o && ['iamt', 'camt', 'samt', 'csamt'].some((k) => k in o);

/**
 * Reads Tables 6 and 7. The filed return's own summary page (extension
 * 0.11.x) gives each table's total only ({iamt, camt, …}, kept as table6 /
 * table6Total, table7 / table7Total); its tiles give the rows. A total-only
 * Table 6 is taken as inputs and input services; a total-only Table 7 is 7I.
 */
export function parseFiledGstr9(data: unknown): FiledGstr9Itc {
  const raw6 = findTable(data, 'table6');
  const raw7 = findTable(data, 'table7');
  const detail6 = !!raw6 && DETAIL6.some((k) => k in raw6);
  const detail7 = !!raw7 && DETAIL7.some((k) => k in raw7);
  const total6 = detail6 ? null : (isAmount(raw6) ? raw6 : findTable(data, 'table6Total'));
  const total7 = isAmount(raw7) && !detail7 ? raw7 : findTable(data, 'table7Total');
  const t6 = detail6 ? raw6 : null;
  const t7t = detail7 ? raw7 : null;
  // Table 7's rows carry 6O (tab6o) and 7I (tot_itc_revd) as filed: the
  // surest totals when Table 6's own rows were not read.
  const tab6o = t7t && t7t.tab6o && typeof t7t.tab6o === 'object' ? t7t.tab6o as Row : null;
  const totRevd = t7t && t7t.tot_itc_revd && typeof t7t.tot_itc_revd === 'object' ? t7t.tot_itc_revd as Row : null;
  let inputsServices = tab6o && !detail6 ? amt(tab6o) : total6 ? amt(total6) : ZERO;
  let capitalGoods = ZERO;

  if (t6) {
    for (const key of ['supp_non_rchrg', 'supp_rchrg_unreg', 'supp_rchrg_reg', 'iog']) {
      for (const r of rows(t6[key])) {
        const typ = String(r.itc_typ || r.typ || '').toLowerCase();
        if (typ === 'cg') capitalGoods = add(capitalGoods, amt(r));
        else inputsServices = add(inputsServices, amt(r));
      }
    }
    for (const key of ['ios', 'isd', 'itc_clmd', 'other']) {
      for (const r of rows(t6[key])) inputsServices = add(inputsServices, amt(r));
    }
  }

  const sum = (...keys: string[]): Tax => keys.reduce((a, k) => rows(t7t?.[k]).reduce((b, r) => add(b, amt(r)), a), ZERO);
  return {
    inputsServices,
    capitalGoods,
    reversedR42: sum('rule42'),
    reversedR43: sum('rule43'),
    otherReversed: t7({
      // 7A takes Rule 37 and 37A; Rule 38 (where the form has it) goes to 7H.
      a: sum('rule37', 'rule37A'), b: sum('rule39'), e: sum('sec17'),
      f: sum('revsl_tran1', 'revsl_trans1'), g: sum('revsl_tran2', 'revsl_trans2'), h: sum('other', 'rule38'),
    }),
    availed: add(inputsServices, capitalGoods),
    detail6,
    detail7,
    reversedTotal: totRevd ? amt(totRevd) : total7 ? amt(total7) : null,
    found: !!(t6 || t7t || total6 || total7),
    tab6oFrom7: !!(tab6o && !detail6),
  };
}
