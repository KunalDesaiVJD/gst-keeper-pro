// Fictional GSTR-2A / GSTR-2B rows for the 2A vs 2B reconciliation tests
// (scripts/verify-itc-reco.mjs) and the browser check. No real client, GSTIN
// or figure: "Fictional Fabrics", Gujarat (24), July 2026. The shapes are the
// ones the extension saves in gst_filed_returns.summary: 2A = { b2b: [{ ctin,
// trdnm, supfildt 'DD-Mon-YY', inv: [{ inum, idt, val, pos, rchrg, txval, iamt,
// camt, samt, csamt, itms }] }] }; 2B = getdata { gendt, rtnprd, docdata: { b2b,
// cdnr, b2ba, isd, impg }, itcsumm } with igst/cgst/sgst/cess.

export const CLIENT = { id: 'c-fict-0001', name: 'Fictional Fabrics Pvt Ltd', gstin: '24ABCDE1234F1Z5' };
export const PERIOD = '07/2026';
export const TODAY = '2026-10-15';

export const S = {
  alpha: '24AAAPA0001A1Z1', beta: '27AAAPB0002B1Z2', gamma: '24AAAPC0003C1Z3', delta: '24AAAPD0004D1Z4',
  eps: '24AAAPE0005E1Z5', zeta: '24AAAPF0006F1Z6', eta: '24AAAPG0007G1Z7', theta: '24AAAPH0008H1Z8',
  iota: '24AAAPI0009I1Z9', kappa: '24AAAPJ0010J1Z0', lambda: '29AAAPK0011K1Z1', mu: '24AAAPL0012L1Z2',
  nu: '24AAAPM0013M1Z3', xi: '24AAAPN0014N1Z4', omicron: '24AAAPO0015O1Z5', pi: '24AAAPP0016P1Z6',
  rho: '27AAAPQ0017Q1Z7', sigma: '29AAAPR0018R1Z8', tau: '24AAAPS0019S1Z9', ups: '24AAAPT0020T1Z0',
  phi: '24AAAPU0021U1Z1', chi: '24AAAPV0022V1Z2', psi: '24AAAPW0023W1Z3', omega: '24AAAPX0024X1Z4',
};

// ── 2A (stored shape) ───────────────────────────────────────────────────────
export const intra = (txval, rate = 0.09) => ({ txval, iamt: 0, camt: +(txval * rate).toFixed(2), samt: +(txval * rate).toFixed(2), csamt: 0 });
export const inter = (txval, rate = 0.18) => ({ txval, iamt: +(txval * rate).toFixed(2), camt: 0, samt: 0, csamt: 0 });
export const inv2A = (inum, idt, amounts, more = {}) => {
  const val = amounts.txval + amounts.iamt + amounts.camt + amounts.samt + amounts.csamt;
  const { txval, iamt, camt, samt, csamt } = amounts;
  const itms = [{ num: 1, itm_det: { rt: 18, txval, ...(iamt ? { iamt } : {}), ...(camt ? { camt, samt } : {}), csamt } }];
  const base = { inum, idt, val, pos: '24', rchrg: 'N', inv_typ: 'R', chksum: 'x', itms, ...more };
  // itemsOnly: the invoice carries its figures only in itms (the tax-key fallback path).
  return more.itemsOnly ? { ...base, itemsOnly: undefined } : { ...base, txval, iamt, camt, samt, csamt };
};
export const sup2A = (ctin, trdnm, supfildt, inv, extra = {}) => ({ ctin, trdnm, supfildt, inv, ...extra });

// ── 2B (getdata shape) ──────────────────────────────────────────────────────
const b2bAmt = ({ txval, iamt, camt, samt, csamt }) => ({ txval, igst: iamt, cgst: camt, sgst: samt, cess: csamt });
export const inv2B = (inum, dt, amounts, more = {}) => {
  const a = b2bAmt(amounts);
  return { inum, dt, val: a.txval + a.igst + a.cgst + a.sgst + a.cess, pos: '24', rev: 'N', typ: 'R', itcavl: 'Y', rsn: '', imsStatus: 'N', ...a, ...more };
};
export const nt2B = (ntnum, dt, typ, amounts, more = {}) => {
  const a = b2bAmt(amounts);
  return { ntnum, dt, typ, suptyp: 'R', val: a.txval + a.igst + a.cgst + a.sgst, pos: '24', rev: 'N', itcavl: 'Y', rsn: '', imsStatus: 'N', ...a, ...more };
};
export const sup2B = (ctin, trdnm, supprd, supfildt, docs, key = 'inv') => ({ ctin, trdnm, supprd, supfildt, [key]: docs });
export const summary2B = (period, gendt, docdata, extra = {}) => ({
  gendt, rtnprd: period.replace('/', ''), gstin: CLIENT.gstin, version: '1.0', docdata, itcsumm: { itcavl: {} }, ...extra,
});

export const row = (source, period, summary, { status, updatedAt } = {}) => ({
  source, period, summary,
  status: status ?? (source === '2A' ? 'Pulled' : 'Generated'),
  updatedAt: updatedAt ?? (source === '2A' ? '2026-09-20T05:00:00Z' : '2026-09-21T05:00:00Z'),
});

// ── July 2026: one document (or two) per case ───────────────────────────────
// expected: document number → { status, reason, confirmed?, notes? } (2A side
// first; a 2B-only document is keyed '2B:<number>').
export function julyRows(opts = {}) {
  const twoA = {
    b2b: [
      sup2A(S.alpha, 'ALPHA TRADERS', '10-Aug-26', [inv2A('A-101', '05-07-2026', intra(10000))]),
      sup2A(S.beta, 'BETA STEEL', '18-Aug-26', [inv2A('B-201', '28-07-2026', inter(40000), { pos: '24' })]),
      sup2A(S.gamma, 'GAMMA PAPERS', '05-Aug-26', [inv2A('C-301', '12-07-2026', intra(3000))]),
      sup2A(S.delta, 'DELTA DYES', '05-Aug-26', [inv2A('D-401', '14-07-2026', intra(8000))]),
      sup2A(S.eps, 'EPSILON PACKAGING', '05-Aug-26', [inv2A('E-501', '16-07-2026', intra(6000))]),
      sup2A(S.zeta, 'ZETA LOGISTICS', '12-Aug-26', [inv2A('F-601', '20-07-2026', intra(1500)), inv2A('F-602', '21-07-2026', intra(2500))]),
      sup2A(S.eta, 'ETA ENGINEERING', null, [inv2A('G-701', '22-07-2026', intra(700)), inv2A('G-702', '23-07-2026', intra(900), { irn: 'f1c2e3d4', irngendate: '23-07-2026', srctyp: 'E-Invoice' })]),
      sup2A(S.lambda, 'LAMBDA CHEMICALS', '05-Aug-26', [
        inv2A('K-1101', '06-07-2026', inter(50000), { pos: '24', itemsOnly: true }),
        inv2A('K-1102', '07-07-2026', inter(20000), { pos: '24' }),
      ]),
      sup2A(S.mu, 'MU MACHINES', '20-Aug-26', [inv2A('L-1201', '08-07-2026', intra(10000))]),
      sup2A(S.nu, 'NU NONWOVENS', '05-Aug-26', [inv2A('M-1301', '09-07-2026', intra(1000)), inv2A('M-1302', '10-07-2026', intra(2000))]),
      sup2A(S.xi, 'XI EXPORTS', '05-Aug-26', [inv2A('INV/0012', '11-07-2026', intra(1200)), inv2A('N-5', '10-05-2025', intra(500))]),
      sup2A(S.omicron, 'OMICRON OILS', '05-Aug-26', [inv2A('P-1501', '03-07-2026', intra(4000))]),
      sup2A(S.pi, 'PI PROPERTIES', '05-Aug-26', [inv2A('R-1601', '13-07-2026', intra(25000), { rchrg: 'Y' })]),
      sup2A(S.rho, 'RHO RESINS', '05-Aug-26', [
        inv2A('S-1701', '15-07-2026', intra(3000), { pos: '27' }),
        inv2A('S-1702', '10-03-2024', intra(1000), { pos: '24' }),
        inv2A('S-1703', '16-07-2026', inter(2000), { pos: '24' }),
      ]),
      sup2A(S.sigma, 'SIGMA SUPPLIES', '05-Aug-26', [inv2A('T-1801', '17-07-2026', intra(5000), { pos: '29' })]),
      sup2A(S.tau, 'TAU TEXTILES', '05-Aug-26', [inv2A('U-1901', '20-07-2026', intra(6000))],
        { cfs: 'Y', cfs3b: 'N', flprdr1: 'Jul-26', dtcancel: '15-07-2026' }),
      sup2A(S.ups, 'UPSILON YARNS', '05-Aug-26', [
        inv2A('Q-1', '01-07-2026', intra(100)), inv2A('Q-1', '15-07-2026', intra(200)),
        inv2A('Q-2', '10-07-2026', intra(500)), inv2A('Q-2', '10-07-2026', intra(900)),
      ]),
      sup2A(S.phi, 'PHI FABRICATORS', '20-Aug-26', [inv2A('V-2101', '24-07-2026', intra(3300))]),
    ],
    ...(opts.meta2A ? { _meta: opts.meta2A } : {}),
  };
  const b07 = summary2B('07/2026', '14-08-2026', {
    b2b: [
      sup2B(S.alpha, 'ALPHA TRADERS', '072026', '10-08-2026', [inv2B('A-101', '05-07-2026', intra(10000))]),
      sup2B(S.theta, 'THETA THREADS', '062026', '20-07-2026', [inv2B('H-801', '25-06-2026', intra(2000)), inv2B('H-802', '26-06-2026', intra(3000))]),
      sup2B(S.omega, 'OMEGA OPTICS', '062026', '08-07-2026', [inv2B('O-2401', '28-06-2026', intra(1000))]),
      sup2B(S.iota, 'IOTA INKS', '072026', '11-08-2026', [inv2B('J-901', '18-07-2026', intra(4400))]),
      sup2B(S.kappa, 'KAPPA KNITS', '072026', '10-08-2026', [inv2B('W-1001', '19-07-2026', intra(5100))]),
      sup2B(S.lambda, 'LAMBDA CHEMICALS', '072026', '05-08-2026', [
        inv2B('K-1101', '06-07-2026', inter(50500), { pos: '24' }),
        inv2B('K-1102', '07-07-2026', { ...inter(20000), txval: 20000.4 }, { pos: '24' }),
      ]),
      sup2B(S.mu, 'MU MACHINES', '072026', '10-08-2026', [inv2B('L-1201', '08-07-2026', intra(9000))]),
      sup2B(S.nu, 'NU NONWOVENS', '072026', '05-08-2026', [inv2B('M-1302', '10-07-2026', intra(2100))]),
      sup2B(S.xi, 'XI EXPORTS', '072026', '05-08-2026', [inv2B('inv12', '11-07-2026', intra(1200)), inv2B('N-5', '10-05-2026', intra(500))]),
      sup2B(S.omicron, 'OMICRON OILS', '072026', '05-08-2026', [inv2B('P-1501', '30-06-2026', intra(4000))]),
      sup2B(S.pi, 'PI PROPERTIES', '072026', '05-08-2026', [inv2B('R-1601', '13-07-2026', intra(25000), { rev: 'Y' })]),
      sup2B(S.rho, 'RHO RESINS', '072026', '05-08-2026', [
        inv2B('S-1701', '15-07-2026', intra(3000), { pos: '27', itcavl: 'N', rsn: 'P' }),
        inv2B('S-1702', '10-03-2024', intra(1000), { itcavl: 'N', rsn: 'C' }),
        inv2B('S-1703', '16-07-2026', inter(2000), { itcavl: 'N', rsn: 'X' }),
      ]),
      sup2B(S.tau, 'TAU TEXTILES', '072026', '05-08-2026', [inv2B('U-1901', '20-07-2026', intra(6000))]),
      sup2B(S.ups, 'UPSILON YARNS', '072026', '05-08-2026', [
        inv2B('Q-1', '15-07-2026', intra(200)), inv2B('Q-1', '01-07-2026', intra(100)),
        inv2B('Q-2', '10-07-2026', { ...intra(905), camt: 81, samt: 81 }),
      ]),
      sup2B(S.chi, 'CHI CERAMICS', '082026', '10-08-2026', [inv2B('X-2201', '02-08-2026', intra(1800))]),
    ],
    cdnr: [sup2B(S.alpha, 'ALPHA TRADERS', '072026', '10-08-2026', [nt2B('CN-1', '25-07-2026', 'C', intra(1000))], 'nt')],
    b2ba: [sup2B(S.nu, 'NU NONWOVENS', '072026', '05-08-2026', [inv2B('M-1301A', '09-07-2026', intra(1200), { oinum: 'M-1301', oidt: '09-07-2026' })])],
    isd: [{ ctin: S.psi, trdnm: 'PSI HEAD OFFICE', supprd: '072026', supfildt: '12-08-2026', doclist: [{ docnum: 'ISD-1', docdt: '20-07-2026', doctyp: 'I', igst: 500, cgst: 0, sgst: 0, cess: 0, itcelg: 'Y' }] }],
    impg: [{ refdt: '15-07-2026', portcode: 'INNSA1', boenum: 'BE-1', boedt: '15-07-2026', txval: 100000, igst: 18000, cess: 0 }],
    xyz: [{ anything: 1 }],
    // ITC reversal (Rule 37A): a February invoice of the previous year whose supplier never filed GSTR-3B.
    itcrev: { b2b: [sup2B(S.tau, 'TAU TEXTILES', '022026', '11-03-2026', [inv2B('U-0201', '10-02-2026', intra(1000))])] },
  }, {
    docRejdata: { b2b: [sup2B(S.delta, 'DELTA DYES', '072026', '05-08-2026', [inv2B('D-401', '14-07-2026', intra(8000), { imsStatus: 'R' })])] },
  });
  const b08 = summary2B('08/2026', '14-09-2026', {
    b2b: [
      sup2B(S.beta, 'BETA STEEL', '072026', '18-08-2026', [inv2B('B-201', '28-07-2026', inter(40000))]),
      sup2B(S.zeta, 'ZETA LOGISTICS', '072026', '12-08-2026', [inv2B('F-601', '20-07-2026', intra(1500))]),
    ],
    b2ba: [sup2B(S.nu, 'NU NONWOVENS', '082026', '10-09-2026', [inv2B('M-1302', '10-07-2026', intra(2000), { oinum: 'M-1302', oidt: '10-07-2026' })])],
  });
  const b09 = summary2B('09/2026', '14-10-2026', {
    b2b: [sup2B(S.eps, 'EPSILON PACKAGING', '072026', '05-08-2026', [inv2B('E-501', '16-07-2026', intra(6000))])],
  });
  const a06 = { b2b: [
    sup2A(S.theta, 'THETA THREADS', '20-Jul-26', [inv2A('H-801', '25-06-2026', intra(2000))]),
    sup2A(S.omega, 'OMEGA OPTICS', '08-Jul-26', [inv2A('O-2401', '28-06-2026', intra(1000))]),
  ] };

  const rows = [row('2A', '07/2026', twoA, opts.twoAOpts), row('2B', '07/2026', b07)];
  if (opts.b08 !== false) rows.push(opts.b08 === 'not_generated' ? row('2B', '08/2026', {}, { status: 'NOT GENERATED / NOT FOUND' }) : row('2B', '08/2026', b08));
  if (opts.b09 !== false) rows.push(row('2B', '09/2026', b09));
  if (opts.a06 !== false) rows.push(row('2A', '06/2026', a06));
  return rows;
}

// What each July document must come out as (main scenario).
export const JULY_EXPECTED = {
  'A-101': { status: 'matched', reason: 'MATCHED' },
  'B-201': { status: 'only_left', reason: 'IN_LATER_2B', confirmed: true, evidence: 'Found in the 2B of Aug 2026' },
  'C-301': { status: 'only_left', reason: 'IMS_PENDING', confirmed: false },
  'D-401': { status: 'itc_differs', reason: 'IMS_REJECTED', confirmed: true },
  'E-501': { status: 'only_left', reason: 'IMS_ACCEPTED_LATER', confirmed: true, evidence: 'Found in the 2B of Sep 2026' },
  'F-601': { status: 'only_left', reason: 'IN_LATER_2B', confirmed: true, detail: '12th or 13th' },
  'F-602': { status: 'only_left', reason: 'IMS_PENDING', confirmed: false, detail: '12th or 13th' },
  'G-701': { status: 'only_left', reason: 'NOT_FILED_BY_SUPPLIER' },
  'G-702': { status: 'only_left', reason: 'NOT_FILED_BY_SUPPLIER', detail: 'e-invoice' },
  '2B:H-801': { status: 'only_right', reason: 'EARLIER_PERIOD', confirmed: true, evidence: 'Found in the 2A of Jun 2026' },
  '2B:H-802': { status: 'only_right', reason: 'EARLIER_PERIOD', confirmed: false, evidence: 'Not in the 2A of Jun 2026 either' },
  '2B:O-2401': { status: 'only_right', reason: 'EARLIER_PERIOD_IN_TIME', confirmed: true, evidence: 'Found in the 2A of Jun 2026', detail: 'in time for the 2B of Jun 2026' },
  '2B:J-901': { status: 'only_right', reason: 'ONLY_2B_UNEXPLAINED' },
  '2B:W-1001': { status: 'only_right', reason: 'ONLY_2B_UNEXPLAINED' },
  'K-1101': { status: 'differs', reason: 'VALUE_DIFFERENCE', detail: 'taxable value 2B more by 500' },
  'K-1102': { status: 'matched', reason: 'MATCHED' },
  'L-1201': { status: 'differs', reason: 'CHANGED_AFTER_2B', confirmed: false },
  'M-1301': { status: 'differs', reason: 'AMENDED', confirmed: true },
  'M-1302': { status: 'differs', reason: 'AMENDED', confirmed: true, detail: 'amended figures in the 2B of Aug 2026' },
  'INV/0012': { status: 'matched', reason: 'MATCHED' },
  'N-5': { status: 'only_left', reason: 'IMS_PENDING', notes: ['EARLIER_YEAR_DOC'] },
  '2B:N-5': { status: 'only_right', reason: 'ONLY_2B_UNEXPLAINED' },
  'P-1501': { status: 'differs', reason: 'DATE_DIFFERS' },
  'R-1601': { status: 'matched', reason: 'MATCHED', notes: ['RCM'] },
  'S-1701': { status: 'matched', reason: 'MATCHED', notes: ['ITC_NA_POS'] },
  'S-1702': { status: 'matched', reason: 'MATCHED', notes: ['ITC_NA_TIME', 'EARLIER_YEAR_DOC'] },
  'S-1703': { status: 'matched', reason: 'MATCHED', notes: ['ITC_NA_OTHER'] },
  'T-1801': { status: 'only_left', reason: 'IMS_PENDING', notes: ['ITC_NA_POS'] },
  'U-1901': { status: 'matched', reason: 'MATCHED', notes: ['SUPPLIER_3B_PENDING', 'SUPPLIER_CANCELLED'] },
  '2B:U-0201': { status: 'only_right', reason: 'ITC_REVERSAL', confirmed: true },
  'V-2101': { status: 'only_left', reason: 'ONLY_2A_UNEXPLAINED', detail: 'not in the 2B of Aug 2026 either' },
  '2B:X-2201': { status: 'only_right', reason: 'ONLY_2B_UNEXPLAINED', detail: 'later than this month' },
  '2B:CN-1': { status: 'not_compared', reason: 'NOT_COMPARED_SECTION' },
  '2B:ISD-1': { status: 'not_compared', reason: 'NOT_COMPARED_SECTION' },
  '2B:BE-1': { status: 'not_compared', reason: 'NOT_COMPARED_SECTION' },
};

/** The fixture as gst_filed_returns rows (for the browser check's fake database). */
export const dbRows = (rows, clientId = CLIENT.id) => rows.map((r, i) => ({
  id: `fr-${i + 1}`, client_id: clientId, period_month: r.period, return_type: r.source === '2A' ? 'GSTR2A' : 'GSTR2B',
  status: r.status, summary: r.summary, updated_at: r.updatedAt, arn: null, filed_date: null,
}));
