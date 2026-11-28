#!/usr/bin/env node
// Checks the GSTR-9C portal JSON (src/lib/gstr9/gstr9cJson.ts) against the
// government's GSTR-9C offline utility v2.9 (FY 2025-26): its JSON shape, its
// codes, its validations and its formulas. Needs no client data:
//
//   node scripts/verify-gstr9c-json.mjs
//
// The utility's own figures below come from the sample JSON it keeps on its
// Master sheet (cell J7), so the formulas are checked against numbers the
// utility itself computed. Read docs/GSTR9C_PORTAL_JSON.md first.

import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (rel) => {
  const out = buildSync({ entryPoints: [path.join(root, rel)], bundle: true, format: 'esm', platform: 'node', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const E = await load('src/lib/gstr9/engine.ts');
const D = await load('src/lib/gstr9/defaults.ts');
const J = await load('src/lib/gstr9/gstr9cJson.ts');

const GSTIN = '27AAAAA0000A1Z5';
const FY = '2025-26';
const ctx = { clientName: 'Test', gstin: GSTIN, financialYear: FY, noItcBuilder: false };

let failed = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) failed += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
};
const eq = (label, got, want) => ok(`${label}: ${got}`, Math.abs(got - want) < 0.005, `want ${want}`);
// The GSTR-9 as filed, typed the same as the working's (what staff type when nothing changed after filing).
// A doc whose filedG9 is null on purpose is left without it.
const fileAsWorking = (d, c = ctx) => {
  if (d.gstr9c.filedG9 !== undefined) return d;
  const g = E.computeWorkings(d, c).g9;
  d.gstr9c.filedG9 = {
    turnover: g.t5.N.t + g.t10.t - g.t11.t,
    paid: { i: g.t9.igst.paid + g.t14.igst.paid, c: g.t9.cgst.paid + g.t14.cgst.paid, s: g.t9.sgst.paid + g.t14.sgst.paid, x: g.t9.cess.paid + g.t14.cess.paid },
  };
  return d;
};
const build = (d, opts = {}) => (fileAsWorking(d), J.buildGstr9cPortalJson({ gstin: GSTIN, financialYear: FY, workings: E.computeWorkings(d, ctx), doc: d.gstr9c, today: new Date(2026, 10, 23), ...opts }));
const rules = (b) => b.checks.filter((c) => c.severity === 'error').map((c) => c.rule);

// 1. An empty working gives the utility's skeleton, with no errors.
{
  const b = build(D.emptyDocs());
  ok('empty working: no errors', b.errors === 0, JSON.stringify(b.checks));
  const a = b.payload.gstr9cdata.audited_data;
  ok('fp is 0320 + last two digits of the FY', a.fp === '032026');
  ok('no isauditor / certificate / signature for FY 2020-21 onwards', !('isauditor' in a) && !('certificate' in b.payload.gstr9cdata) && !('audited_sign' in b.payload.gstr9cdata));
  ok('Table 11 always carries its ten rate rows (zero-filled, as the utility)', a.table11.rate.length === 10 && a.table11.rate.map((r) => r.desc).join() === '5,6,12,18,28,40,3,0.25,0.1,Others');
  ok('Table 9 always carries 9P, 9Q, 9R', !!a.table9.tot_amt_payable && !!a.table9.tot_amt_paid && !!a.table9.unrec_amt);
  ok('no reasons tables without reasons', !['table6', 'table8', 'table10', 'table13', 'table15'].some((k) => k in a));
  ok('Part V with nothing typed is an empty add_liab', JSON.stringify(a.add_liab) === '{}');
  ok('schema check passes', J.validateGstr9cPortalJson(b.payload).length === 0, J.validateGstr9cPortalJson(b.payload).join('; '));
  ok('file name as the utility writes it', b.fileName === `${GSTIN}_23112026_R9C_Output_JSON.json`);
}

// 2. A filled working: every table, the codes, and the formulas tie to the working.
{
  const d = D.emptyDocs();
  const C = d.gstr9c;
  C.t5A = 1_25_00_000.456; // rounds to paise
  Object.assign(C.t5, { B: 1000, C: 2000, D: 300, E: 4000, F: 50, H: 600, I: 700, J: 80, K: 0, L: 0, M: -10, N: 25.5, O: 5 });
  C.t5Q = 1_24_90_000;
  C.t7 = { B: 10_000, C: 20_000, D: 5_000, D1: 1_000 };
  C.t7F = 1_24_50_000;
  C.t9.E = { t: 1_00_00_000, i: 5_00_000, c: 4_00_000, s: 4_00_000, x: 0 };
  C.t9.K1 = { t: 1000, i: 0, c: 15, s: 15, x: 0 };
  C.t9.K2 = { t: 500, i: 0, c: 45, s: 45, x: 0 };
  C.t9Other.L = { i: 100, c: 0, s: 0, x: 0 };
  C.t9Q = { i: 5_00_100, c: 4_00_060, s: 4_00_060, x: 0 };
  // The GSTR-9 the portal checks 5Q and 9Q against (5N + 10 − 11; Table 9 + 14 paid) says the same.
  d.gstr9.t10 = { t: 1_24_90_000, i: 0, c: 0, s: 0, x: 0 };
  Object.assign(d.gstr9.t14, { igst: { payable: 5_00_100, paid: 5_00_100 }, cgst: { payable: 4_00_060, paid: 4_00_060 }, sgst: { payable: 4_00_060, paid: 4_00_060 } });
  C.t11.C = { t: 1000, i: 0, c: 90, s: 90, x: 0 };
  C.t16 = { A: 10, B: 10, C: 0, D: 0, E: 1, F: 0 };
  C.partV.C = { t: 1000, i: 0, c: 90, s: 90, x: 0 };
  C.partV.G2 = { t: 0, i: 0, c: 5, s: 5, x: 0 };
  C.partV.I = { t: 0, i: 0, c: 3, s: 3, x: 0 }; // interest with no value: EM13 warning, not an error
  C.t6Reasons = 'Unbilled revenue at year end\n\nCredit notes after March';
  C.actName = 'Companies Act, 2013';
  fileAsWorking(d);
  const w = E.computeWorkings(d, ctx);
  const b = J.buildGstr9cPortalJson({ gstin: GSTIN, financialYear: FY, workings: w, doc: C, today: new Date(2026, 10, 23) });
  ok('filled working: no errors', b.errors === 0, JSON.stringify(b.checks.filter((c) => c.severity === 'error')));
  ok('no TIE warning (the JSON ties to the 9C forms)', !b.checks.some((c) => c.rule === 'TIE'), JSON.stringify(b.checks.filter((c) => c.rule === 'TIE')));
  ok('EM13 warning for Part V I with tax and no value', b.checks.some((c) => c.rule === 'EM13' && c.row === 'V I'));
  const a = b.payload.gstr9cdata.audited_data;
  eq('5A rounded to paise', a.table5.turnovr, 12500000.46);
  eq('5P = the working 5P', a.table5.annul_turn_adj, Math.round(w.gstr9c.t5.P * 100) / 100);
  eq('5R = Q − P', a.table5.unrec_turnovr, a.table5.annul_turn_decl - a.table5.annul_turn_adj);
  eq('7A = 5P', a.table7.annul_turn_adj, a.table5.annul_turn_adj);
  eq('7D1 carried', a.table7.rev_sup_ecom, 1000);
  eq('7G = the working 7G', a.table7.unrec_tax_turn, w.gstr9c.t7.G);
  ok('9 rate codes: 18 and Others ("0.10" style codes kept)', a.table9.rate.map((r) => r.desc).join() === '18,Others');
  ok('9K2 goes to oth_ecom (tax only)', a.table9.oth_ecom && a.table9.oth_ecom.cgst === 45 && !('tax_val' in a.table9.oth_ecom));
  ok('9L goes to inter', a.table9.inter && a.table9.inter.igst === 100);
  eq('9P CGST = working', a.table9.tot_amt_payable.cgst, w.gstr9c.t9.P.c);
  eq('9R IGST = Q − P', a.table9.unrec_amt.igst, a.table9.tot_amt_paid.igst - a.table9.tot_amt_payable.igst);
  ok('Part V codes, G2 as oth_ecom with no value', a.add_liab.tax_pay.map((r) => r.desc).join() === '18,oth_ecom,INT' && a.add_liab.tax_pay[1].val === 0);
  ok('reasons: one per non-blank line, RSN1…', JSON.stringify(a.table6) === JSON.stringify({ rsn: [{ number: 'RSN1', desc: 'Unbilled revenue at year end' }, { number: 'RSN2', desc: 'Credit notes after March' }] }));
  ok('act_name carried', a.act_name === 'Companies Act, 2013');
  ok('REASON warning for 7G with no Table 8 reason', b.checks.some((c) => c.rule === 'REASON' && c.table === '8'));
  ok('schema check passes', J.validateGstr9cPortalJson(b.payload).length === 0, J.validateGstr9cPortalJson(b.payload).join('; '));
  ok('text is the payload', b.text === JSON.stringify(b.payload));
}

// 3. 14T is S − R on the form and in the JSON (the firm's sheet keeps R − S).
{
  const d = D.emptyDocs();
  d.purchases.rows.push({ id: 'g', section: 'purchase', ledger: 'Import', supplyType: 'inter', rate: 18, taxable: 1000, igst: 180, cgst: 0, sgst: null, cess: 0, head: 'imported_goods' });
  fileAsWorking(d);
  const w = E.computeWorkings(d, ctx);
  const S = w.gstr9c.t14.S;
  const R = w.gstr9c.t14.R;
  ok('14R carries the purchase ITC', R.i === 180, `R.i ${R.i}`);
  eq('form 14T IGST = S − R', w.gstr9c.t14.T.i, S.i - R.i);
  eq("firm's sheet T IGST = R − S", w.c14.T.i, R.i - S.i);
  const line = w.diffs.find((x) => x.key === 'gstr9c.14T');
  ok('difference line reads S − R', line && line.direction === 'S − R');
  const a = J.buildGstr9cPortalJson({ gstin: GSTIN, financialYear: FY, workings: w, doc: d.gstr9c }).payload.gstr9cdata.audited_data;
  eq('JSON 14T = S − R', a.table14.unrec_itc.itc_avail, a.table14.itc_claim.itc_avail - a.table14.tot_elig_itc.itc_avail);
  ok('JSON 14D (imported goods) item', a.table14.items.some((x) => x.desc === 'IMPGDS' && x.itc_avail === 180 && x.val === 1000), JSON.stringify(a.table14.items));
}

// 4. A reason recorded against the old sign of 14T still stands.
{
  const d = D.emptyDocs();
  d.purchases.rows.push({ id: 'g', section: 'purchase', ledger: 'Import', supplyType: 'inter', rate: 18, taxable: 1000, igst: 180, cgst: 0, sgst: null, cess: 0, head: 'imported_goods' });
  const w0 = E.computeWorkings(d, ctx);
  const line0 = w0.diffs.find((x) => x.key === 'gstr9c.14T');
  const old = { t: -line0.diff.t, i: -line0.diff.i, c: -line0.diff.c, s: -line0.diff.s, x: -line0.diff.x };
  d.justifications.lines['gstr9c.14T'] = { text: 'Reason', diffAt: old };
  const w = E.computeWorkings(d, ctx);
  ok('the line has a difference to justify', Math.abs(line0.diff.i) > 1, JSON.stringify(line0.diff));
  ok('old-sign justification is not "Re-check"', !w.diffs.find((x) => x.key === 'gstr9c.14T').stale);
  d.justifications.lines['gstr9c.14T'] = { text: 'Reason', diffAt: { t: 0, i: 999, c: 0, s: 0, x: 0 } };
  ok('a moved difference still asks to re-check', E.computeWorkings(d, ctx).diffs.find((x) => x.key === 'gstr9c.14T').stale);
}

// 5. The utility's own checks stop the JSON.
{
  const d = D.emptyDocs();
  let b = J.buildGstr9cPortalJson({ gstin: '27AAAAA0000A1Z', financialYear: FY, workings: E.computeWorkings(d, ctx), doc: d.gstr9c });
  ok('EM3: invalid GSTIN stops the file', rules(b).includes('EM3') && b.payload === null);
  b = J.buildGstr9cPortalJson({ gstin: GSTIN, financialYear: '2026-27', workings: E.computeWorkings(d, ctx), doc: d.gstr9c });
  ok('EM12: an FY the utility does not offer', rules(b).includes('EM12'));
  b = J.buildGstr9cPortalJson({ gstin: GSTIN, financialYear: '2023-24', workings: E.computeWorkings(d, ctx), doc: d.gstr9c });
  ok('FY: the pre-2024-25 layout is left to the utility', rules(b).includes('FY'));

  const d2 = D.emptyDocs();
  d2.gstr9c.actName = 'The Companies Act, 2013 and the LLP Act';
  ok('EM18: Name of Act over 30 characters', rules(build(d2)).includes('EM18'));

  const d3 = D.emptyDocs();
  d3.gstr9c.t8Reasons = Array.from({ length: 11 }, (_, i) => `Reason ${i + 1}`).join('\n');
  ok('EM1: more than ten reasons', rules(build(d3)).includes('EM1'));
  d3.gstr9c.t8Reasons = 'x'.repeat(1001);
  ok('EM1: a reason over 1000 characters', rules(build(d3)).includes('EM1'));
  d3.gstr9c.t8Reasons = 'Difference of ₹1,200 – 18% on "advances"';
  ok('HASH: ₹ % – and " are refused', rules(build(d3)).includes('HASH'));
  const cleaned = J.cleanReasonText(d3.gstr9c.t8Reasons);
  ok(`cleanReasonText gives accepted text: "${cleaned}"`, J.REASON_CHARS_REGEX.test(cleaned));
  d3.gstr9c.t8Reasons = cleaned;
  ok('…and the JSON is written', build(d3).errors === 0);
  ok("HASH_REGEX lets through what the utility's range lets through (: ; = ? @ [ ])", J.REASON_CHARS_REGEX.test('Ref: A=1; B? @ [x]'));

  const d4 = D.emptyDocs();
  d4.gstr9c.t5.G = 100;
  ok('5G must be nil from FY 2020-21', rules(build(d4)).includes('EM12'));

  const d5 = D.emptyDocs();
  d5.gstr9c.t5A = 12345678901234; // 14 digits
  ok('AMT13: more than 13 digits', rules(build(d5)).includes('AMT13'));
  d5.gstr9c.t5A = -1234567890123; // 13 digits, negative allowed
  ok('negative amounts are allowed (Negative_Amt)', build(d5).errors === 0);
}

// 6. The schema check catches what the utility would not write.
{
  const good = build(D.emptyDocs()).payload;
  const bad = (f) => { const j = structuredClone(good); f(j.gstr9cdata.audited_data); return J.validateGstr9cPortalJson(j); };
  ok('an unknown key', bad((a) => { a.table5.extra = 1; }).some((m) => m.includes('not a key')));
  ok('a wrong 5P', bad((a) => { a.table5.annul_turn_adj += 1; }).some((m) => m.includes('5P')));
  ok('a wrong rate code', bad((a) => { a.table11.rate[8].desc = '0.10'; }).some((m) => m.includes('not one of')));
  ok('three decimals', bad((a) => { a.table12.itc_avail = 1.005; a.table12.itc_avail_audited = 1.005; a.table12.unrec_itc = -1.005; }).some((m) => m.includes('2 decimals')));
  ok('14T must be S − R', bad((a) => { a.table14 = { tot_elig_itc: { itc_avail: 10 }, itc_claim: { itc_avail: 4 }, unrec_itc: { itc_avail: 6 } }; }).some((m) => m.includes('14T')));
  ok('reasons numbered RSN1…', bad((a) => { a.table6 = { rsn: [{ number: 'RSN2', desc: 'x' }] }; }).some((m) => m.includes('RSN1')));
}

// 7. The formulas against figures the utility itself computed (Master!J7 sample JSON).
{
  const sample = {
    gstr9cdata: { audited_data: {
      gstin: '19DBTAX0005B1ZH', fp: '032019', act_name: '',
      table5: { turnovr: 0, unbil_rev_beg: 511, unadj_adv_end: 5222, dmd_sup: 5333, crd_nts_issued: 54444, trd_dis: 55555, turnovr_apr_jun: 0, unbil_rev_end: 5666, unadj_adv_beg: 57777, crd_note_acc: 58888, adj_dta: 599999, turnovr_comp: 510000, adj_turn_sec: 5110000, adj_turn_fef: 512000, adj_turn_othrsn: 51300000, annul_turn_adj: 55819623, annul_turn_decl: 2500, unrec_turnovr: -55817123 },
      table7: { annul_turn_adj: 0, othr_turnovr: 71, zero_sup: 72, rev_sup: 0, rev_sup_ecom: 0, tax_turn_adj: -143, tax_turn_annul: 2500, unrec_tax_turn: 2643 },
      table11: { rate: [] },
      table12: { itc_avail: 0, itc_book_earl: 0, itc_book_curr: 0, itc_avail_audited: 0, itc_claim: 0, unrec_itc: 0 },
      table16: { cgst: 0, sgst: 0, igst: 0, cess: 0, inter: 0, pen: 0 },
      add_liab: {},
    } },
  };
  const probs = J.validateGstr9cPortalJson(sample);
  ok("5P / 5R from the utility's own sample tie with the formula", !probs.some((m) => m.includes('table5')), probs.join('; '));
  // The sample's 7A is 0 although its 5P is 55,819,623 (an old FY 2018-19 build); only that one line may differ.
  ok("7E / 7G from the utility's own sample tie with the formula", !probs.some((m) => m.includes('7E') || m.includes('7G')), probs.join('; '));
}

// 8. The portal's GSTR-9 checks (27 Nov 2026): 5Q = GSTR-9 5N + 10 − 11, 9Q = GSTR-9 Table 9 + 14 paid, per head.
{
  // Table 10 tax paid through Table 14 (the case the portal refused): 9Q's default carries it.
  const d = D.emptyDocs();
  d.gstr9.t10 = { t: 0, i: 0, c: 17598.93, s: 17598.93, x: 0 };
  Object.assign(d.gstr9.t14, { cgst: { payable: 17598.93, paid: 17598.93 }, sgst: { payable: 17598.93, paid: 17598.93 } });
  const w = E.computeWorkings(d, ctx);
  eq('9Q default carries Table 14 CGST paid', w.gstr9c.t9.Q.c, 17598.93);
  eq('9Q default carries Table 14 SGST paid', w.gstr9c.t9.Q.s, 17598.93);
  const line9 = w.diffs.find((x) => x.key === 'gstr9c.9Q');
  ok('9Q tie line present and matched', !!line9 && !line9.open);
  const b = build(d);
  ok('defaults tie: no G9TIE error', !rules(b).includes('G9TIE'), JSON.stringify(b.checks));

  // 9Q typed as Table 9 alone (the refused upload): blocked, and no reason closes it.
  d.gstr9c.t9Q = { i: 0, c: 0, s: 0, x: 0 };
  d.justifications = { ...(d.justifications ?? {}), 'gstr9c.9Q': { text: 'explained', by: 'x', at: '2026-11-27' } };
  const w2 = E.computeWorkings(d, ctx);
  const l2 = w2.diffs.find((x) => x.key === 'gstr9c.9Q');
  ok('9Q typed off the GSTR-9: open, whatever the reason', !!l2 && l2.open && !!l2.mustTie);
  ok('9Q typed off the GSTR-9: JSON refused (G9TIE)', rules(build(d)).filter((r) => r === 'G9TIE').length === 2);

  // 5Q typed off the GSTR-9 turnover: blocked.
  const d3 = D.emptyDocs();
  d3.gstr9c.t5Q = 1000;
  const w3 = E.computeWorkings(d3, ctx);
  ok('5Q typed off the GSTR-9: open', !!w3.diffs.find((x) => x.key === 'gstr9c.5Q' && x.open));
  ok('5Q typed off the GSTR-9: JSON refused (G9TIE)', rules(build(d3)).includes('G9TIE'));
  // 28 Nov 2026 (Elenza Arista again): the working's 5N is whole rupees, the filed GSTR-9's 5N is 7,77,83,451.34.
  const d4 = D.emptyDocs();
  d4.gstr9c.filedG9 = null;
  const w4 = E.computeWorkings(d4, ctx);
  ok('5Q not confirmed: an open line that no reason closes', !!w4.diffs.find((x) => x.key === 'gstr9c.g9filed.5Q' && x.open && x.mustTie));
  ok('9Q not confirmed: an open line that no reason closes', !!w4.diffs.find((x) => x.key === 'gstr9c.g9filed.9Q' && x.open && x.mustTie));
  // "Same as filed" stores the working's figure in the cell: the lines close.
  {
    const ds = D.emptyDocs();
    const ws = E.computeWorkings(ds, ctx);
    ds.gstr9c.filedG9 = { turnover: ws.gstr9c.g9Tie.working.turnover, paid: ws.gstr9c.g9Tie.working.paid };
    const wt = E.computeWorkings(ds, ctx);
    ok('Same as filed: no confirm lines left', !wt.diffs.some((x) => x.key.startsWith('gstr9c.g9filed.') && x.open));
    ok('Same as filed: 5Q and 9Q tie', !wt.diffs.some((x) => (x.key === 'gstr9c.5Q' || x.key === 'gstr9c.9Q') && x.open));
    ds.gstr9c.filedG9 = { turnover: ws.gstr9c.g9Tie.working.turnover };
    ok('only 5Q confirmed: 9Q still open', !!E.computeWorkings(ds, ctx).diffs.find((x) => x.key === 'gstr9c.g9filed.9Q' && x.open)
      && !E.computeWorkings(ds, ctx).diffs.some((x) => x.key === 'gstr9c.g9filed.5Q'));
  }
  ok('filed GSTR-9 not entered: JSON refused (G9FILED)', rules(J.buildGstr9cPortalJson({ gstin: GSTIN, financialYear: FY, workings: w4, doc: d4.gstr9c })).includes('G9FILED'));
  // The first layout (5N, 10, 11, Table 9 / 14 paid) is still read.
  {
    const dl = D.emptyDocs();
    dl.gstr9c.filedG9 = { t5N: 100.5, t10: 10, t11: 0.25, paid9: { i: 0, c: 1, s: 1, x: 0 }, paid14: { i: 0, c: 0.5, s: 0.5, x: 0 } };
    const wl = E.computeWorkings(dl, ctx);
    ok('first layout still read', Math.abs(wl.gstr9c.t5.Q - 110.25) < 0.001 && Math.abs(wl.gstr9c.t9.Q.c - 1.5) < 0.001);
  }
  d4.gstr9c.filedG9 = { turnover: 7_77_83_451.34, paid: { i: 0, c: 4_94_918.33, s: 4_94_918.33, x: 0 } };
  const w5 = E.computeWorkings(d4, ctx);
  eq('5Q follows the filed GSTR-9, paise included', w5.gstr9c.t5.Q, 7_77_83_451.34);
  eq('9Q follows the filed GSTR-9 (CGST)', w5.gstr9c.t9.Q.c, 4_94_918.33);
  ok('filed entered: no g9filed line, 5Q and 9Q tie', !w5.diffs.some((x) => (x.key.startsWith('gstr9c.g9filed.') || x.key === 'gstr9c.5Q' || x.key === 'gstr9c.9Q') && x.open));
  ok('working vs filed shown for information', !!w5.diffs.find((x) => x.key === 'gstr9c.g9vsfiled.turnover' && x.informational));
  const b5 = J.buildGstr9cPortalJson({ gstin: GSTIN, financialYear: FY, workings: w5, doc: d4.gstr9c, today: new Date(2026, 10, 28) });
  ok('filed entered: JSON written with 5Q as filed', b5.errors === 0 && b5.payload.gstr9cdata.audited_data.table5.annul_turn_decl === 77783451.34, JSON.stringify(b5.checks.filter((c) => c.severity === 'error')));
  // 5Q typed back to the working's whole-rupee figure: refused, as the portal would.
  d4.gstr9c.t5Q = 7_77_83_451;
  ok('5Q a paisa off the filed GSTR-9: open and refused', !!E.computeWorkings(d4, ctx).diffs.find((x) => x.key === 'gstr9c.5Q' && x.open)
    && rules(J.buildGstr9cPortalJson({ gstin: GSTIN, financialYear: FY, workings: E.computeWorkings(d4, ctx), doc: d4.gstr9c })).includes('G9TIE'));
  // Large amounts with paise pass the two-decimal check (the float product × 100 is off by > 1e-6).
  ok('large amounts with paise pass the schema check', !J.validateGstr9cPortalJson(b5.payload).some((m) => m.includes('decimals')), J.validateGstr9cPortalJson(b5.payload).join('; '));
  {
    const big = structuredClone(b5.payload);
    big.gstr9cdata.audited_data.table7.tax_turn_annul = 270168546.6; // × 100 is 27016854659.999996
    big.gstr9cdata.audited_data.table7.unrec_tax_turn = Math.round((270168546.6 - big.gstr9cdata.audited_data.table7.tax_turn_adj) * 100) / 100;
    ok('270168546.6 is two decimals (the case that stopped a client\'s JSON)', !J.validateGstr9cPortalJson(big).some((m) => m.includes('decimals')), J.validateGstr9cPortalJson(big).join('; '));
  }
  // A client with no 9C has no such lines.
  ok('no 9C: no tie lines', !E.computeWorkings(D.emptyDocs(), { ...ctx, no9c: true }).diffs.some((x) => x.key.startsWith('gstr9c.5Q') || x.key.startsWith('gstr9c.9Q') || x.key.startsWith('gstr9c.g9filed')));
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall GSTR-9C JSON checks passed');
