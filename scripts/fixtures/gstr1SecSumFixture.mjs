// A GSTR-1 summary (api/gstr1/summary, GSTN's RETSUM shape) as the extension
// stores it in gst_filed_returns.summary: the same 46 sections, in the same
// order, with the same keys (amendment sections with their act_* figures, the
// credit note, export and e-commerce sections with their sub_sections, NIL
// with its three amounts, DOC_ISSUE with its counts) as a stored pull read on
// 2026-10-16. The figures are fictional; the one thing kept from the real pull
// is how they relate: ttl_tax is the TAXABLE value, ttl_val the INVOICE value
// (taxable value plus tax, in whole rupees), and HSN rows carry ttl_tax with
// ttl_val 0.
//
//   const s = gstr1Summary({ gstin, period: '06/2026', figures: { EXP: { rec: 1, tax: 412345.67, igst: 74222.22, val: 486568, sub: 'EXPWP' }, ... } });
//
// Used by scripts/verify-gstr1-taxable.mjs.

const CHK = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ZERO = { ttl_rec: 0, ttl_tax: 0, ttl_val: 0, ttl_cess: 0, ttl_cgst: 0, ttl_igst: 0, ttl_sgst: 0 };
const ACT = { act_tax: 0, act_val: 0, act_cess: 0, act_cgst: 0, act_igst: 0, act_sgst: 0 };

// The portal's own order: plain sections, amendment sections (…A), then the
// ones carrying sub_sections.
const PLAIN = ['AT', 'ATA', 'B2B', 'B2BA', 'B2BA_4A', 'B2BA_4B', 'B2BA_6C', 'B2BA_SEZWOP', 'B2BA_SEZWP', 'B2B_4A', 'B2B_4B', 'B2B_6C',
  'B2B_SEZWOP', 'B2B_SEZWP', 'B2CL', 'B2CLA', 'B2CS', 'B2CSA', 'ECOM', 'ECOMA', 'ECOMA_DE', 'ECOMA_REG', 'ECOMA_SEZWOP', 'ECOMA_SEZWP',
  'ECOMA_UNREG', 'ECOM_DE', 'ECOM_REG', 'ECOM_SEZWOP', 'ECOM_SEZWP', 'ECOM_UNREG', 'HSN', 'HSN_B2B', 'HSN_B2C', 'NIL', 'TTL_LIAB',
  'TXPD', 'TXPDA', 'DOC_ISSUE'];
const WITH_SUB = [
  ['CDNR', 'sec_nm', ['CDNR_4A', 'CDNR_4B', 'CDNR_6C', 'CDNR_SEZWOP', 'CDNR_SEZWP']],
  ['CDNRA', 'sec_nm', ['CDNRA_4A', 'CDNRA_4B', 'CDNRA_6C', 'CDNRA_SEZWOP', 'CDNRA_SEZWP']],
  ['CDNUR', 'typ', ['B2CL', 'EXPWOP', 'EXPWP']],
  ['CDNURA', 'typ', ['B2CL', 'EXPWOP', 'EXPWP']],
  ['EXP', 'typ', ['EXPWOP', 'EXPWP']],
  ['EXPA', 'typ', ['EXPWOP', 'EXPWP']],
  ['SUPECOM', 'sec_nm', ['SUPECOM_14A', 'SUPECOM_14B']],
  ['SUPECOMA', 'sec_nm', ['SUPECOMA_14A', 'SUPECOMA_14B']],
];
const isAmendment = (name) => /^(ATA|B2BA|B2CLA|B2CSA|ECOMA|TXPDA|CDNRA|CDNURA|EXPA|SUPECOMA)(_|$)/.test(name);

/** A section's ttl_* from { rec, tax, val, igst, cgst, sgst, cess }. */
const figuresOf = (f = {}) => ({
  ttl_rec: f.rec ?? 0, ttl_tax: f.tax ?? 0, ttl_val: f.val ?? 0,
  ttl_cess: f.cess ?? 0, ttl_cgst: f.cgst ?? 0, ttl_igst: f.igst ?? 0, ttl_sgst: f.sgst ?? 0,
});

/**
 * One GSTR-1 summary. `figures` names the sections that are not nil:
 * { B2B: { rec, tax, val, igst, cgst, sgst, cess }, EXP: { …, sub: 'EXPWP' },
 *   NIL: { rec, nil, expt, ngsup }, DOC_ISSUE: { rec, issued, cancelled } }.
 */
export function gstr1Summary({ gstin, period, figures = {} }) {
  const sec = (name) => {
    if (name === 'NIL') {
      const f = figures.NIL ?? {};
      return { chksum: CHK, sec_nm: 'NIL', ttl_rec: f.rec ?? 0, ttl_expt_amt: f.expt ?? 0, ttl_ngsup_amt: f.ngsup ?? 0, ttl_nilsup_amt: f.nil ?? 0 };
    }
    if (name === 'DOC_ISSUE') {
      const f = figures.DOC_ISSUE ?? {};
      const issued = f.issued ?? 0, cancelled = f.cancelled ?? 0;
      return { chksum: CHK, sec_nm: 'DOC_ISSUE', ttl_rec: f.rec ?? 0, net_doc_issued: issued - cancelled, ttl_doc_issued: issued, ttl_doc_cancelled: cancelled };
    }
    const own = figures[name] ? figuresOf(figures[name]) : ZERO;
    return { chksum: CHK, sec_nm: name, ...(isAmendment(name) ? ACT : {}), ...own };
  };
  const sec_sum = PLAIN.map(sec);
  for (const [name, key, subs] of WITH_SUB) {
    const top = sec(name);
    const f = figures[name];
    top.sub_sections = subs.map((s) => ({
      ...(key === 'typ' ? { typ: s } : {}), chksum: CHK, ...(key === 'sec_nm' ? { sec_nm: s } : {}),
      ...(isAmendment(name) ? ACT : {}),
      ...(f && f.sub === s ? figuresOf(f) : ZERO),
    }));
    sec_sum.push(top);
  }
  const [mm, yyyy] = period.split('/');
  return { gstin, chksum: CHK, sec_sum, newSumFlag: true, ret_period: `${mm}${yyyy}`, isCptyLimitExceeded: false };
}

/** The same summary as an older pull without ttl_tax anywhere (the fallback's case). */
export function withoutTtlTax(summary) {
  const strip = (s) => {
    const { ttl_tax: _drop, ...rest } = s;
    return rest.sub_sections ? { ...rest, sub_sections: rest.sub_sections.map(strip) } : rest;
  };
  return { ...summary, sec_sum: summary.sec_sum.map(strip) };
}

/** A GSTR-3B summary's Table 3.1, as the extension stores it. */
export function gstr3bSummary({ a = {}, b = {}, c = {}, d = {}, e = {} }) {
  const h = (x) => ({ camt: x.cgst ?? 0, iamt: x.igst ?? 0, samt: x.sgst ?? 0, csamt: x.cess ?? 0, txval: x.tx ?? 0 });
  return { sup_details: { osup_det: h(a), osup_zero: h(b), osup_nil_exmp: h(c), isup_rev: h(d), osup_nongst: h(e) } };
}
