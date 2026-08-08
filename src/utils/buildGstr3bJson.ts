// Build a GSTR-3B JSON (GSTN offline-utility schema) from the app's already-
// computed numbers.
//
// ⚠️ THIS FILES TAX. The output is a DRAFT: a CA must verify it line-by-line,
// and it must be tested in shadow mode before any live push. Several mappings
// are marked REVIEW below because the app doesn't compute them (Table 5 inward
// exempt) or the GSTN mapping is ambiguous (4D → itc_inelg).
//
// Sources:
//   Table 3.1 (outward) + 3.2   ← the client's GSTR-1 raw JSON (computed here)
//   Table 3.1(d) inward RCM     ← RCM Summary totals (rcm_data)
//   Table 4 (ITC) 4A / 4B / 4C  ← ITC Summary (itc_summaries.data)
//   Table 4D(2) ineligible      ← ITC Summary 4D(2)  [4D(1) reclaim already sits inside 4A(5)]
//   Table 5 (exempt inward)     ← NOT computed by the app → left 0 (REVIEW)

export interface ItcRow { srNo: string; igst: number; cgst: number; sgst: number }
export interface ItcData { section4A: ItcRow[]; section4B: ItcRow[]; section4D: ItcRow[] }
export interface RcmTotals { taxable: number; igst: number; cgst: number; sgst: number }

export interface Gstr3bInput {
  gstin: string;
  periodMonth: string;    // "MM/YYYY"
  gstr1Raw: any | null;   // GSTR-1 JSON (outward supplies)
  itc: ItcData | null;    // itc_summaries.data
  rcm: RcmTotals;         // RCM liability/ITC totals for the period
}

export interface TaxHead { igst: number; cgst: number; sgst: number }
export interface Gstr3bSummary {
  outward: { txval: number; igst: number; cgst: number; sgst: number }; // 3.1(a)
  zeroRated: { txval: number; igst: number };                           // 3.1(b)
  nilExempt: number;                                                    // 3.1(c) txval
  rcmLiability: { txval: number; igst: number; cgst: number; sgst: number }; // 3.1(d)
  nonGst: number;                                                       // 3.1(e) txval
  itcAvailable: TaxHead;  // 4A total
  // 4(A) ITC Available bifurcation — the five portal rows (1)–(5).
  itcAvailableRows: { srNo: string; label: string; igst: number; cgst: number; sgst: number }[];
  itcReversed: TaxHead;   // 4B total
  itcNet: TaxHead;        // 4C
  itcIneligible: TaxHead; // 4D(2)
  // 4(D) Other Details — the four portal rows (D)(1), (1.1), (1.2), (2),
  // taken straight from the ITC Summary section 4D.
  itcOtherDetails: { srNo: string; label: string; igst: number; cgst: number; sgst: number }[];
  totalLiability: TaxHead;      // output + RCM
  indicativeNetPayable: TaxHead; // liability − net ITC (indicative; real offset is done on the portal)
}
export interface Gstr3bResult { json: any; summary: Gstr3bSummary; flags: string[] }

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;
const num = (v: any) => (typeof v === 'number' ? v : parseFloat(v) || 0);

function retPeriod(mmYyyy: string): string {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  return mm && yyyy ? `${mm}${yyyy}` : '';
}

// ---- Table 4 helpers -------------------------------------------------------
function row(rows: ItcRow[] | undefined, sr: string): ItcRow {
  return (rows || []).find((r) => r.srNo === sr) || { srNo: sr, igst: 0, cgst: 0, sgst: 0 };
}
const add3 = (...rs: TaxHead[]): TaxHead => rs.reduce(
  (a, r) => ({ igst: a.igst + (r.igst || 0), cgst: a.cgst + (r.cgst || 0), sgst: a.sgst + (r.sgst || 0) }),
  { igst: 0, cgst: 0, sgst: 0 });
const sub3 = (a: TaxHead, b: TaxHead): TaxHead => ({ igst: a.igst - b.igst, cgst: a.cgst - b.cgst, sgst: a.sgst - b.sgst });
const round3 = (t: TaxHead): TaxHead => ({ igst: r2(t.igst), cgst: r2(t.cgst), sgst: r2(t.sgst) });

// ---- Table 3.1 outward, computed from the GSTR-1 raw JSON ------------------
function computeOutward(g: any) {
  const det = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }; // 3.1(a)
  const zero = { txval: 0, iamt: 0, csamt: 0 };                  // 3.1(b)
  let nilExempt = 0;                                             // 3.1(c) txval
  let nonGst = 0;                                                // 3.1(e) txval

  const addDet = (it: any, sign = 1) => {
    det.txval += sign * num(it.txval); det.iamt += sign * num(it.iamt);
    det.camt += sign * num(it.camt); det.samt += sign * num(it.samt); det.csamt += sign * num(it.csamt);
  };
  if (g) {
    (g.b2b || []).forEach((p: any) => (p.inv || []).forEach((inv: any) => (inv.itms || []).forEach((i: any) => addDet(i.itm_det || {}))));
    (g.b2cl || []).forEach((s: any) => (s.inv || []).forEach((inv: any) => (inv.itms || []).forEach((i: any) => addDet(i.itm_det || {}))));
    (g.b2cs || []).forEach((i: any) => addDet(i));
    // Credit note subtracts, debit note adds (same convention as computeGstr1OutputTax).
    (g.cdnr || []).forEach((p: any) => (p.nt || []).forEach((nt: any) => (nt.itms || []).forEach((i: any) => addDet(i.itm_det || {}, nt.typ === 'C' ? -1 : 1))));
    (g.cdnur || []).forEach((nt: any) => (nt.itms || []).forEach((i: any) => addDet(i.itm_det || {}, nt.typ === 'C' ? -1 : 1)));
    // Table 10 — amendments to earlier B2CS entries. Same shape as b2cs, and
    // they carry a real liability (a retrospective re-rating is reported here,
    // not as a debit note), so they belong in 3.1(a) like any other outward row.
    (g.b2csa || []).forEach((i: Record<string, unknown>) => addDet(i));
    // Advances. The advance amount IS the value being offered to tax when the
    // supply is a service — construction is, so Notification 66/2017 does not
    // apply and tax falls due on receipt. Carrying only the tax and not the
    // value left 3.1(a) internally inconsistent, and materially so for a
    // builder, where most of the consideration arrives as advances long before
    // any invoice. AT adds value and tax; TXPD takes both back out when an
    // invoice later absorbs the advance and reports the full value in Table 7.
    (g.at || []).forEach((a: any) => {
      const it = a.itms?.[0] || a;
      det.txval += num(it.ad_amt);
      det.iamt += num(it.iamt); det.camt += num(it.camt); det.samt += num(it.samt);
    });
    (g.txpd || []).forEach((a: any) => {
      const it = a.itms?.[0] || a;
      det.txval -= num(it.ad_amt);
      det.iamt -= num(it.iamt); det.camt -= num(it.camt); det.samt -= num(it.samt);
    });
    // Exports = zero-rated.
    (g.exp || []).forEach((e: any) => (e.inv || []).forEach((inv: any) => (inv.itms || []).forEach((i: any) => { zero.txval += num(i.txval); zero.iamt += num(i.iamt); })));
    // Nil / exempt / non-GST.
    (g.nil?.inv || []).forEach((n: any) => { nilExempt += num(n.nil_amt) + num(n.expt_amt); nonGst += num(n.ngsup_amt); });
  }

  const roundObj = (o: any) => { Object.keys(o).forEach((k) => (o[k] = r2(o[k]))); return o; };
  return { det: roundObj(det), zero: roundObj(zero), nilExempt: r2(nilExempt), nonGst: r2(nonGst) };
}

// 3.2 inter-state supplies to unregistered persons — POS-wise from B2CL + inter B2CS.
function computeInterUnreg(g: any) {
  const byPos: Record<string, { txval: number; iamt: number }> = {};
  const bump = (pos: string, txval: number, iamt: number) => {
    if (!pos) return;
    byPos[pos] = byPos[pos] || { txval: 0, iamt: 0 };
    byPos[pos].txval += num(txval); byPos[pos].iamt += num(iamt);
  };
  if (g) {
    (g.b2cl || []).forEach((s: any) => (s.inv || []).forEach((inv: any) => (inv.itms || []).forEach((i: any) => bump(s.pos, num(i.itm_det?.txval), num(i.itm_det?.iamt)))));
    (g.b2cs || []).forEach((i: any) => { if ((i.sply_ty || '').toUpperCase() === 'INTER') bump(i.pos, num(i.txval), num(i.iamt)); });
  }
  return Object.entries(byPos).map(([pos, v]) => ({ pos, txval: r2(v.txval), iamt: r2(v.iamt) }));
}

export function buildGstr3bJson(input: Gstr3bInput): Gstr3bResult {
  const flags: string[] = [];
  const g = input.gstr1Raw;
  const itc = input.itc;
  if (!g) flags.push('No GSTR-1 data — outward (Table 3.1 a/b/c/e, 3.2) is all zero.');
  if (!itc) flags.push('No ITC Summary — Table 4 (ITC) is all zero.');

  const out = computeOutward(g);

  // ---- Table 4 (ITC) ----
  const A: ItcRow[] = itc?.section4A || [];
  const B: ItcRow[] = itc?.section4B || [];
  const D: ItcRow[] = itc?.section4D || [];

  const impg = row(A, '(1)');   // 4A(1) import of goods
  const imps = row(A, '(2)');   // 4A(2) import of services
  // 4A(3) RCM ITC — computed directly from the SAME live RCM totals used for
  // Table 3.1(d) below, not read from ITC Summary's stored section4A row(3).
  // That stored row is only refreshed when someone opens and re-saves the
  // ITC Summary page; if RCM data changes after that (a real case: a client
  // whose ITC Summary was saved before a new RCM entry — e.g. a different
  // rate/head — was added), the two tables silently drift apart. GSTR-3B
  // always pushes wrong figures for the drifted head until someone happens
  // to re-save ITC Summary. Deriving both from the same source makes that
  // drift structurally impossible instead of relying on a save workflow.
  const isrc: ItcRow = { srNo: '(3)', igst: r2(input.rcm.igst), cgst: r2(input.rcm.cgst), sgst: r2(input.rcm.sgst) };
  const isd = row(A, '(4)');    // 4A(4) ISD
  // 4A(5) "all other ITC" = 5.1 + 5.2 − 5.3 + 5.4 + 5.5
  const oth4a = round3(add3(row(A, '5.1'), row(A, '5.2'), sub3({ igst: 0, cgst: 0, sgst: 0 }, row(A, '5.3')), row(A, '5.4'), row(A, '5.5')));

  const revRul = row(B, '(1)');                       // 4B(1) rule 38/42/43 & 17(5)
  const revOth = round3(add3(row(B, '(i)'), row(B, '(ii)'), row(B, '(iii)'))); // 4B(2) others

  const inelgOth = row(D, '(2)');                     // 4D(2) 16(4) & PoS
  // Full 4(D) Other Details, as shown in ITC Summary and the portal GSTR-3B.
  const itcOtherDetails = [
    { srNo: '(1)', label: 'ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period', ...round3(row(D, '(1)')) },
    { srNo: '(1.1)', label: 'Reclaim of ITC Reversed for Previous months', ...round3(row(D, '1.1')) },
    { srNo: '(1.2)', label: 'Reclaim of ITC Reversed due to 180 days rule/Others', ...round3(row(D, '1.2')) },
    { srNo: '(2)', label: 'Ineligible ITC under section 16(4) & ITC restricted due to PoS rules', ...round3(inelgOth) },
  ];
  // REVIEW: GSTN itc_inelg has ty RUL + OTH; the app has no distinct 4D "RUL" input → 0.
  flags.push('4D itc_inelg: mapped 4D(2) → OTH; RUL defaulted to 0 (confirm with the CA).');
  flags.push('Table 5 (exempt / nil / non-GST INWARD supplies) is not computed by the app → left 0 (fill manually if applicable).');

  const itcAvail = round3(add3(impg, imps, isrc, isd, oth4a));
  // 4(A) ITC Available bifurcation, as shown in ITC Summary and the portal.
  const itcAvailableRows = [
    { srNo: '(1)', label: 'Import of goods', ...round3(impg) },
    { srNo: '(2)', label: 'Import of services', ...round3(imps) },
    { srNo: '(3)', label: 'Inward supplies liable to reverse charge (other than 1 & 2 above)', ...round3(isrc) },
    { srNo: '(4)', label: 'Inward supplies from ISD', ...round3(isd) },
    { srNo: '(5)', label: 'All other ITC', ...round3(oth4a) },
  ];
  const itcRev = round3(add3(revRul, revOth));
  const itcNet = round3(sub3(itcAvail, itcRev));

  const rcm = { txval: r2(input.rcm.taxable), iamt: r2(input.rcm.igst), camt: r2(input.rcm.cgst), samt: r2(input.rcm.sgst), csamt: 0 };

  const json = {
    gstin: input.gstin,
    ret_period: retPeriod(input.periodMonth),
    sup_details: {
      osup_det: out.det,                                   // 3.1(a)
      osup_zero: out.zero,                                 // 3.1(b)
      osup_nil_exmp: { txval: out.nilExempt },             // 3.1(c)
      isup_rev: rcm,                                       // 3.1(d) inward RCM
      osup_nongst: { txval: out.nonGst },                  // 3.1(e)
    },
    inter_sup: {
      unreg_details: computeInterUnreg(g),                 // 3.2
      comp_details: [],
      uin_details: [],
    },
    itc_elg: {
      itc_avl: [
        { ty: 'IMPG', ...impg },
        { ty: 'IMPS', ...imps },
        { ty: 'ISRC', ...isrc },
        { ty: 'ISD', ...isd },
        { ty: 'OTH', ...oth4a },
      ].map(stripSr),
      itc_rev: [
        { ty: 'RUL', ...revRul },
        { ty: 'OTH', ...revOth },
      ].map(stripSr),
      itc_net: itcNet,
      itc_inelg: [
        { ty: 'RUL', igst: 0, cgst: 0, sgst: 0 },
        { ty: 'OTH', ...inelgOth },
      ].map(stripSr),
    },
    // Table 5 — not computed; provided as a zeroed placeholder for the CA to fill.
    inward_sup: {
      isup_details: [
        { ty: 'GST', inter: 0, intra: 0 },
        { ty: 'NONGST', inter: 0, intra: 0 },
      ],
    },
  };

  const totalLiability = round3(add3(
    { igst: out.det.iamt, cgst: out.det.camt, sgst: out.det.samt },
    { igst: rcm.iamt, cgst: rcm.camt, sgst: rcm.samt },
  ));
  const summary: Gstr3bSummary = {
    outward: { txval: out.det.txval, igst: out.det.iamt, cgst: out.det.camt, sgst: out.det.samt },
    zeroRated: { txval: out.zero.txval, igst: out.zero.iamt },
    nilExempt: out.nilExempt,
    rcmLiability: { txval: rcm.txval, igst: rcm.iamt, cgst: rcm.camt, sgst: rcm.samt },
    nonGst: out.nonGst,
    itcAvailable: itcAvail,
    itcAvailableRows,
    itcReversed: itcRev,
    itcNet,
    itcIneligible: round3(inelgOth),
    itcOtherDetails,
    totalLiability,
    indicativeNetPayable: round3(sub3(totalLiability, itcNet)),
  };

  return { json, summary, flags };
}

function stripSr(o: any) { const { srNo, ...rest } = o; return rest; }
