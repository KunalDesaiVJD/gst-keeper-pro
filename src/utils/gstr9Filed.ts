// The filed GSTR-9 as the extension saves it (gst_filed_returns,
// return_type 'GSTR9_FILED', extension 0.10.3): the details the portal's own
// GSTR-9 form loads, in the GSTR-9 JSON schema. This reads what the Builder
// Rule 42/43 working needs from Tables 6 and 7.
//
//   Table 6 (ITC availed): supp_non_rchrg (6B), supp_rchrg_unreg (6C),
//     supp_rchrg_reg (6D), iog (6E) — each a list of {itc_typ: 'ip'|'cg'|'is',
//     iamt, camt, samt, csamt}; ios (6F, services), isd (6G), itc_clmd (6H),
//     other (6M) — amounts only.
//   Table 7 (ITC reversed): rule42, rule43 (and others we do not need).
//
// Rows can come as a single object or a list; amounts may be strings.

import { ZERO, add, tax, type Tax } from '@/utils/builderItcReversal';

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
  for (const v of Object.values(o)) {
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
  /** Total availed per Table 6 (both of the above). */
  availed: Tax;
  /** False when the return carried no Table 6 or 7 at all. */
  found: boolean;
}

export function parseFiledGstr9(data: unknown): FiledGstr9Itc {
  const t6 = findTable(data, 'table6');
  const t7 = findTable(data, 'table7');
  let inputsServices = ZERO;
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

  return {
    inputsServices,
    capitalGoods,
    reversedR42: amt(rows(t7?.rule42)[0]),
    reversedR43: amt(rows(t7?.rule43)[0]),
    availed: add(inputsServices, capitalGoods),
    found: !!(t6 || t7),
  };
}
