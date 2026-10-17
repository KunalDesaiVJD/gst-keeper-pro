#!/usr/bin/env node
// Checks Not in Books for every kind of GSTR-2B document in Import 2B (firm's
// request of 17 Oct 2026, docs/2B_RECONCILIATION_FLOW.md §10 choice 3): a
// supplier credit note (the firm's "Debit Note", the purchase return) may be
// parked Not in Books like an invoice and a supplier debit note, and every
// reader honours it:
//  - the treatments offered (src/lib/twobDocs.ts allowedActions), and an
//    amendment's default and base when the version it amends is parked
//    (defaultAction, baseFrom, refollowAction);
//  - Post to Reconciliation (src/lib/postImport2B.ts): the ledger row, with
//    its sign, and row 5.1 / 5.3 leaving parked documents out;
//  - the e-mailed list (src/lib/billsNotInBooksMail.ts), at the ledger's
//    figures, its credit in words and never a negative "₹-…";
//  - once booked, the note is reduced in ITC Summary row 5.2, the one row
//    that takes a negative head (src/utils/builderPartialItc.ts
//    takesNegativeHead, src/pages/ITCSummaryPage.tsx), and every reader of
//    5.2 sums it signed: Total (5) and Total 4A, GSTR-3B (4A(5) filed at 0
//    with the excess in 4B(2), net ITC unchanged), the Partial-ITC split, the
//    GST receivable reco and the credit closing report.
//
//   node scripts/verify-import2b-notes.mjs
//   GSTK_ROOT=/path/to/other/checkout node scripts/verify-import2b-notes.mjs
//
// Fictional documents; Supabase is replaced by an in-memory table store, so
// nothing is read from or written to the live project. Exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');

const results = [];
const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info: cond ? '' : String(info) });
const run = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: runs`, false, e?.stack ?? e); } };

// An in-memory stand-in for the supabase client: from(table) with select,
// insert, update and delete, and the filters these modules use. A select
// returns only the columns it names, as PostgREST does, so a figure computed
// from a column the code forgot to read comes out wrong here too. Rows live
// in globalThis.__db (one array per table).
const FAKE_SUPABASE = `
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.lim = null; this.rng = null; this.head = false; this.one = false; this.payload = null; this.cols = null; }
  select(c, o) {
    if (this.op !== 'select') return this;
    this.head = !!(o && o.head);
    this.cols = c && c.trim() !== '*' ? c.split(',').map((x) => x.trim()).filter(Boolean) : null;
    return this;
  }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
  in(c, a) { this.f.push((r) => a.includes(r[c])); return this; }
  is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  not(c, op, v) { if (op !== 'is') throw new Error('fake supabase: not ' + op); this.f.push((r) => (r[c] ?? null) !== v); return this; }
  order() { return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  exec() {
    const db = globalThis.__db;
    const tbl = (db[this.t] = db[this.t] || []);
    const hit = (r) => this.f.every((fn) => fn(r));
    if (this.op === 'insert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => ({ id: 'new-' + (db.__seq = (db.__seq || 0) + 1), ...r }));
      tbl.push(...rows);
      return { data: this.one ? rows[0] : rows, error: null };
    }
    if (this.op === 'update') { const rows = tbl.filter(hit); rows.forEach((r) => Object.assign(r, this.payload)); return { data: rows, error: null }; }
    if (this.op === 'delete') { db[this.t] = tbl.filter((r) => !hit(r)); return { data: null, error: null }; }
    let rows = tbl.filter(hit);
    const count = rows.length;
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim !== null) rows = rows.slice(0, this.lim);
    if (this.head) return { data: null, count, error: null };
    rows = rows.map((r) => (this.cols ? Object.fromEntries(this.cols.map((k) => [k, r[k] ?? null])) : { ...r }));
    return { data: this.one ? rows[0] ?? null : rows, count, error: null };
  }
  then(ok, ko) { let r; try { r = this.exec(); } catch (e) { return Promise.reject(e).then(ok, ko); } return Promise.resolve(r).then(ok, ko); }
}
export const supabase = {
  from: (t) => new Q(t),
  // The e-mail is sent at once by send-gst-email: recorded, reported sent.
  functions: { invoke: async (name, opts) => { (globalThis.__invoked = globalThis.__invoked || []).push({ name, opts }); return { data: { sent: 1 }, error: null }; } },
};
`;

const load = async (contents) => {
  const out = await build({
    stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{
      name: 'stub',
      setup(b) {
        // ExcelJS (the working paper) from the checkout's node_modules, by an
        // absolute URL, since the bundle runs from a data: URL.
        b.onResolve({ filter: /^exceljs$/ }, () => ({ path: pathToFileURL(req.resolve('exceljs')).href, external: true }));
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
        b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: FAKE_SUPABASE, loader: 'js' }));
      },
    }],
    define: { 'import.meta.env': '{}' },
    banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
// One bundle, so the modules share the one fake client.
const M = await load(`
export * as T from './src/lib/twobDocs';
export * as P from './src/lib/postImport2B';
export * as B from './src/lib/billsNotInBooksMail';
export * as I from './src/utils/builderPartialItc';
export * as G from './src/utils/buildGstr3bJson';
export * as R from './src/lib/gstReceivableRecoCalc';
export * as A from './src/utils/allClientsReports';
`);
const { T, P, B, I, G, R, A } = M;

const doc = (o) => ({
  is_amendment: false, original_doc_type: null, reverse_charge: false, bucket: 'available', itc_available: true,
  taxable_value: 0, input_igst: 0, input_cgst: 0, input_sgst: 0, cess: 0,
  base_taxable_value: null, base_input_igst: null, base_input_cgst: null, base_input_sgst: null, base_cess: null,
  ims_reduce_required: null, declared_igst: null, declared_cgst: null, declared_sgst: null, declared_cess: null,
  ...o,
});
const figs = (x) => ({ taxable: x.taxable_value ?? x.taxable, igst: x.input_igst ?? x.igst, cgst: x.input_cgst ?? x.cgst, sgst: x.input_sgst ?? x.sgst });
const same = (a, b) => ['taxable', 'igst', 'cgst', 'sgst'].every((k) => Math.abs((Number(a?.[k]) || 0) - (Number(b?.[k]) || 0)) < 0.005);
const show = (x) => JSON.stringify(x && figs(x));

// ── 1. The treatments offered ───────────────────────────────────────────────
const INVOICE_LIST = ['MATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS', 'MISMATCHED', 'NOT_IN_BOOKS', 'RECLAIM'];
await run('treatments', async () => {
  const list = (d, cur) => T.allowedActions(d, cur);
  check('an invoice offers Not in Books (and the rest of its list)', JSON.stringify(list({ doc_type: 'INVOICE' })) === JSON.stringify(INVOICE_LIST), list({ doc_type: 'INVOICE' }));
  check('a supplier debit note offers exactly what an invoice does, Not in Books included',
    JSON.stringify(list({ doc_type: 'DEBIT_NOTE' })) === JSON.stringify(INVOICE_LIST), list({ doc_type: 'DEBIT_NOTE' }));
  check('a supplier credit note (the firm\'s "Debit Note") offers Not in Books', list({ doc_type: 'CREDIT_NOTE' }).includes('NOT_IN_BOOKS'), list({ doc_type: 'CREDIT_NOTE' }));
  check('… and Matched, Mismatched, Ineligible, ITC of Others as before',
    ['MATCHED', 'MISMATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS'].every((a) => list({ doc_type: 'CREDIT_NOTE' }).includes(a)));
  check('… but never Reclaim (a credit note cannot evidence one)',
    !list({ doc_type: 'CREDIT_NOTE' }).includes('RECLAIM') && !T.canEvidenceReclaim({ doc_type: 'CREDIT_NOTE' }));
  for (const t of ['INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE']) {
    const l = list({ doc_type: t, is_amendment: true });
    check(`an amended ${t.toLowerCase().replace('_', ' ')} offers Not in Books, not Reclaim`, l.includes('NOT_IN_BOOKS') && !l.includes('RECLAIM'), l);
  }
  const held = list({ doc_type: 'CREDIT_NOTE', is_amendment: true }, 'HELD');
  check('a held credit note amendment offers Held first, and Not in Books', held[0] === 'HELD' && held.includes('NOT_IN_BOOKS'), held);
});

// ── 2. Amendments of a parked document ──────────────────────────────────────
await run('amendments', async () => {
  const cnParked = doc({ id: 'e1', doc_type: 'CREDIT_NOTE', itc_action: 'NOT_IN_BOOKS', taxable_value: 100, input_igst: 18 });
  const cnAmend = doc({ doc_type: 'CREDIT_NOTE', is_amendment: true, original_doc_type: 'CREDIT_NOTE', taxable_value: 150, input_igst: 27 });
  const a = T.defaultAction(T.actionInputOf(cnAmend), cnParked);
  check('an amended credit note whose original is parked Not in Books stays Not in Books (as an invoice\'s would)', a === 'NOT_IN_BOOKS', a);
  const base = T.baseFrom(cnParked, cnAmend);
  check('… its base is the parked original (100 / 18)', base.base_taxable_value === 100 && base.base_input_igst === 18, JSON.stringify(base));
  const withBase = { ...cnAmend, ...base };
  check('… it changes revised less original (50 / 9), and reduces ITC (−50 / −9)',
    same(T.effectFigures(withBase), { taxable: 50, igst: 9 }) && same(T.signedEffect(withBase), { taxable: -50, igst: -9 }), show(T.signedEffect(withBase)));
  const invParked = doc({ id: 'e0', doc_type: 'INVOICE', itc_action: 'NOT_IN_BOOKS', taxable_value: 100, input_igst: 18 });
  const invAmend = doc({ doc_type: 'INVOICE', is_amendment: true, taxable_value: 150, input_igst: 27 });
  check('… the same rule as an amended invoice of a parked invoice', T.defaultAction(T.actionInputOf(invAmend), invParked) === 'NOT_IN_BOOKS');

  // Unchanged position: a debit note parked Not in Books and revised into a
  // credit note reduces in full (Matched, zero base); the parked entry stays
  // on the ledger for staff to clear.
  const dnParked = doc({ id: 'e2', doc_type: 'DEBIT_NOTE', itc_action: 'NOT_IN_BOOKS', taxable_value: 100, input_igst: 18 });
  const dnToCn = doc({ doc_type: 'CREDIT_NOTE', is_amendment: true, original_doc_type: 'DEBIT_NOTE', taxable_value: 100, input_igst: 18 });
  const b2 = T.baseFrom(dnParked, dnToCn);
  check('a parked debit note revised into a credit note is still Matched, with a zero base (unchanged)',
    T.defaultAction(T.actionInputOf(dnToCn), dnParked) === 'MATCHED' && b2.base_taxable_value === 0 && b2.base_input_igst === 0, JSON.stringify(b2));

  // A parked credit note revised into a debit note follows it to Not in
  // Books and posts the whole change beside it: −100 there, +200 now, net +100.
  const cnToDn = doc({ doc_type: 'DEBIT_NOTE', is_amendment: true, original_doc_type: 'CREDIT_NOTE', taxable_value: 100, input_igst: 18 });
  const b3 = T.baseFrom(cnParked, cnToDn);
  const net = T.signedEffect({ ...cnToDn, ...b3 }).igst + T.signedEffect(cnParked).igst;
  check('a parked credit note revised into a debit note stays Not in Books; parked and amendment net to the debit note (+18)',
    T.defaultAction(T.actionInputOf(cnToDn), cnParked) === 'NOT_IN_BOOKS' && Math.abs(net - 18) < 0.005, `${T.defaultAction(T.actionInputOf(cnToDn), cnParked)} net ${net}`);

  // Staff park a credit note after its amendment was counted against it as
  // Matched: the amendment follows it (Import 2B's save, syncAmendments).
  const cnMatched = { ...cnParked, itc_action: 'MATCHED' };
  const counted = { ...cnAmend, ...T.baseFrom(cnMatched, cnAmend), itc_action: 'MATCHED' };
  const next = T.refollowAction(T.actionInputOf(counted), 'MATCHED', cnParked, ['MATCHED']);
  check('an amendment counted against a credit note the staff then park moves to Not in Books with it, its base kept',
    next === 'NOT_IN_BOOKS' && T.sameBase(T.baseFrom(cnParked, counted), counted), next);
});

// ── 3. Post to Reconciliation and rows 5.1 / 5.3 ────────────────────────────
const C = 'client-1';
const M9 = '09/2026';
const at = (o) => doc({ client_id: C, period_month: M9, date: '2026-09-10', supplier_name: 'Supplier', supplier_gstin: '24AAAAA0000A1Z5', full_2b: true, ...o });
const DOCS = [
  at({ id: 'inv1', doc_type: 'INVOICE', supplier_invoice_number: 'INV/1', itc_action: 'NOT_IN_BOOKS', taxable_value: 1000, input_igst: 180 }),
  at({ id: 'dn1', doc_type: 'DEBIT_NOTE', supplier_invoice_number: 'DN/1', itc_action: 'NOT_IN_BOOKS', taxable_value: 500, input_cgst: 45, input_sgst: 45 }),
  at({ id: 'cn1', doc_type: 'CREDIT_NOTE', supplier_invoice_number: 'CN/1', itc_action: 'NOT_IN_BOOKS', taxable_value: 200, input_igst: 36 }),
  // IMS "ITC to be reduced: Yes" with a declared amount: the declared tax is what reduces.
  at({ id: 'cn2', doc_type: 'CREDIT_NOTE', supplier_invoice_number: 'CN/2', itc_action: 'NOT_IN_BOOKS', taxable_value: 200, input_igst: 36, ims_reduce_required: 'YES', declared_igst: 10 }),
  at({ id: 'cna', doc_type: 'CREDIT_NOTE', is_amendment: true, original_doc_type: 'CREDIT_NOTE', supplier_invoice_number: 'CN/0A', itc_action: 'NOT_IN_BOOKS', taxable_value: 150, input_igst: 27, base_taxable_value: 100, base_input_igst: 18, base_input_cgst: 0, base_input_sgst: 0, base_cess: 0 }),
  // A credit note revised into a debit note (the base, a credit note's 100, is added).
  at({ id: 'dna', doc_type: 'DEBIT_NOTE', is_amendment: true, original_doc_type: 'CREDIT_NOTE', supplier_invoice_number: 'DN/9A', itc_action: 'NOT_IN_BOOKS', taxable_value: 100, input_igst: 18, base_taxable_value: 100, base_input_igst: 18, base_input_cgst: 0, base_input_sgst: 0, base_cess: 0 }),
  at({ id: 'cn3', doc_type: 'CREDIT_NOTE', supplier_invoice_number: 'CN/3', itc_action: 'MATCHED', taxable_value: 300, input_igst: 54 }),
  at({ id: 'inv2', doc_type: 'INVOICE', supplier_invoice_number: 'INV/2', itc_action: 'MATCHED', taxable_value: 2000, input_igst: 360 }),
];
const WANT = {
  inv1: { taxable: 1000, igst: 180 }, dn1: { taxable: 500, cgst: 45, sgst: 45 },
  cn1: { taxable: -200, igst: -36 }, cn2: { taxable: -200, igst: -10 }, cna: { taxable: -50, igst: -9 }, dna: { taxable: 200, igst: 36 },
};
globalThis.__db = { twob_import_docs: DOCS.map((d) => ({ ...d })), books_register: [], bills_not_in_2b: [], bills_not_in_books: [], twob_versions: [] };

await run('post', async () => {
  const plan = await P.planImport2BPost(C, M9);
  const ins = new Set(plan.insertBillsBooks.map(({ row }) => row.id));
  check('Post plans a Not in Books row for the invoice and the debit note', ins.has('inv1') && ins.has('dn1'), [...ins]);
  check('… and for each credit note marked Not in Books (plain, IMS declared, amended)', ins.has('cn1') && ins.has('cn2') && ins.has('cna'), [...ins]);
  check('… with nothing skipped', plan.skippedDocs.length === 0, plan.skippedDocs.map((s) => `${s.row.supplier_invoice_number}: ${s.reason}`).join('; '));
  check('… and no row for a Matched document', !ins.has('cn3') && !ins.has('inv2'));
  await P.postImport2BToLedger(C, M9, 'user-1', plan);
  const ledger = globalThis.__db.bills_not_in_books;
  const bySrc = new Map(ledger.map((l) => [l.source_doc_id, l]));
  for (const [id, want] of Object.entries(WANT)) {
    const l = bySrc.get(id);
    check(`ledger row for ${DOCS.find((d) => d.id === id).supplier_invoice_number} holds ${JSON.stringify(want)}`, l && same(figs(l), want), show(l));
  }
  check('… every new row open (no book entry month) and in 2B since Sep 26',
    ledger.length > 0 && ledger.every((l) => l.book_entry_month === null && l.bill_in_2b_month === 'Sep 26'));
  const again = await P.planImport2BPost(C, M9);
  check('posting again changes nothing (the figures written are the figures planned)', P.isPostPlanEmpty(again), JSON.stringify({
    ins: again.insertBillsBooks.length, upd: again.updateBillsBooks.map(({ row }) => row.id), ret: again.retractBillsBooks.length }));

  // Back to Matched: the row it posted is retracted, and it counts in 5.3.
  const cn1 = globalThis.__db.twob_import_docs.find((d) => d.id === 'cn1');
  cn1.itc_action = 'MATCHED';
  const back = await P.planImport2BPost(C, M9);
  check('a credit note taken out of Not in Books has its ledger row retracted',
    back.retractBillsBooks.some(({ ledgerId }) => ledgerId === bySrc.get('cn1')?.id) && back.retractBillsBooks.length === 1, JSON.stringify(back.retractBillsBooks));
  const notes = await P.fetchImport2BCreditNotes(C, M9);
  check('row 5.3 is the Matched credit notes only (CN/3 54 + CN/1 36 = 90 IGST): parked ones are left out',
    Math.abs(notes.total.igst - 90) < 0.005 && notes.notesRead, JSON.stringify(notes));
  cn1.itc_action = 'NOT_IN_BOOKS';
  const notes2 = await P.fetchImport2BCreditNotes(C, M9);
  check('… and parked again, CN/1 leaves 5.3 (54)', Math.abs(notes2.total.igst - 54) < 0.005, JSON.stringify(notes2.total));
  const elig = await P.fetchImport2BEligibleTotal(C, M9);
  check('row 5.1 is the Matched invoice only (360): a parked invoice, debit note or amendment is left out', Math.abs(elig.igst - 360) < 0.005 && elig.cgst === 0, JSON.stringify(elig));
});

// ── 4. The e-mailed list ────────────────────────────────────────────────────
await run('mail', async () => {
  const db = globalThis.__db;
  // A credit note parked since the post, not yet posted; and a negative row
  // carried from an earlier month (no document behind it).
  db.twob_import_docs.push(at({ id: 'cn4', doc_type: 'CREDIT_NOTE', supplier_invoice_number: 'CN/4', itc_action: 'NOT_IN_BOOKS', taxable_value: 50, input_cgst: 4.5, input_sgst: 4.5 }));
  db.bills_not_in_books.push({ id: 'carried-1', client_id: C, period_month: M9, date: '2026-05-02', supplier_name: 'Old supplier', supplier_gstin: '24BBBBB0000B1Z5',
    supplier_invoice_number: 'CR-77', taxable_value: -80, input_igst: -14.4, input_cgst: 0, input_sgst: 0, book_entry_month: null, bill_in_2b_month: 'May 26', source_doc_id: null });
  const { rows } = await B.loadBillsNotInBooks(C, M9);
  const byNo = new Map(rows.map((r) => [r.docNo, r]));
  for (const [id, want] of Object.entries(WANT)) {
    const no = DOCS.find((d) => d.id === id).supplier_invoice_number;
    check(`the e-mailed list has ${no} at the ledger's figures ${JSON.stringify(want)}`, same(byNo.get(no), want), show(byNo.get(no)));
  }
  check('… a credit note named "Credit note"', byNo.get('CN/1')?.docType === 'Credit note' && byNo.get('CN/0A')?.docType === 'Amended credit note',
    `${byNo.get('CN/1')?.docType} / ${byNo.get('CN/0A')?.docType}`);
  const cn4 = byNo.get('CN/4');
  check('… an unposted parked credit note, negative (−50 / −4.5 / −4.5), marked not yet posted',
    !!cn4 && cn4.unposted && same(cn4, { taxable: -50, cgst: -4.5, sgst: -4.5 }), show(cn4));
  check('… a carried negative row reads "Credit / adjustment"', byNo.get('CR-77')?.docType === 'Credit / adjustment', byNo.get('CR-77')?.docType);
  const s = B.summariseBills(rows);
  const want = 180 + 90 - 36 - 10 - 9 + 36 - 9 - 14.4;
  check(`the summary nets credit notes off (tax ${want.toFixed(2)})`, Math.abs(s.tax - want) < 0.005, s.tax);

  // The credit in words: never a negative "input tax credit of ₹-…".
  const credit = 180 + 90 + 36;
  const less = 36 + 10 + 9 + 9 + 14.4;
  check(`… split into credit (${credit.toFixed(2)}) and what the credit notes take off (${less.toFixed(2)})`,
    Math.abs(s.credit - credit) < 0.005 && Math.abs(s.reduction - less) < 0.005, JSON.stringify({ credit: s.credit, reduction: s.reduction }));
  const words = B.creditWording?.(s);
  check('the credit reads "₹306.00, less ₹78.40 on credit notes"', words === '₹306.00, less ₹78.40 on credit notes', words);
  const notesOnly = B.summariseBills(rows.filter((r) => r.igst + r.cgst + r.sgst < 0));
  const nWords = B.creditWording?.(notesOnly);
  check('… a list of credit notes only reads as a net reduction, never "₹-78.40"',
    nWords === '₹0.00, less ₹78.40 on credit notes, a net reduction of ₹78.40' && !/₹\s*-/.test(nWords), nWords);
  const plain = B.creditWording?.(B.summariseBills(rows.filter((r) => r.igst + r.cgst + r.sgst >= 0)));
  check('… and a list with no credit note is the plain figure (₹306.00)', plain === '₹306.00', plain);
  check('a supplier\'s negative tax is in brackets', B.rupees?.(-14.4) === '(₹14.40)' && B.rupees?.(36) === '₹36.00', `${B.rupees?.(-14.4)} / ${B.rupees?.(36)}`);

  // The e-mail as queued: the template's own sentence around {{itc_total}}.
  const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20261019100000_bills_not_in_books_email.sql'), 'utf8');
  check('the template says "input tax credit of {{itc_total}}"', mig.includes('Together they carry input tax credit of {{itc_total}}.'));
  db.email_templates = [{ key: 'bills_not_in_books', is_active: true, subject: 'Bills not in your books, {{period}}',
    body: 'We found {{bill_count}} not yet recorded in your books. Together they carry input tax credit of {{itc_total}}.' }];
  const send = (list) => B.sendBillsNotInBooks({ clientId: C, clientName: 'Fictional Traders', gstin: '24CCCCC0000C1Z5', periodMonth: M9,
    to: 'accounts@example.com', cc: '', replyBy: '22 Oct 2026', rows: list, staffName: 'Staff', userId: null });
  const res = await send(rows);
  const mail = (db.email_outbox || []).at(-1);
  check('the e-mail is queued and sent', res.ok && !!mail, JSON.stringify(res));
  check('… its body: "input tax credit of ₹306.00, less ₹78.40 on credit notes."',
    !!mail && mail.body.includes('input tax credit of ₹306.00, less ₹78.40 on credit notes.') && !/₹\s*-/.test(mail.body), mail?.body);
  check('… the supplier table brackets a negative supplier, no "₹-"',
    !!mail && mail.render_vars.table_html.includes('(&#8377;14.40)') && !/&#8377;\s*-/.test(mail.render_vars.table_html), mail?.render_vars?.table_html);
  const res2 = await send(rows.filter((r) => r.igst + r.cgst + r.sgst < 0));
  const mail2 = (db.email_outbox || []).at(-1);
  check('a list of credit notes only: "input tax credit of ₹0.00, less ₹78.40 on credit notes, a net reduction of ₹78.40.", total in brackets',
    res2.ok && mail2 !== mail && mail2.body.includes('less ₹78.40 on credit notes, a net reduction of ₹78.40.') && !/₹\s*-/.test(mail2.body)
      && mail2.render_vars.itc_total === nWords && mail2.render_vars.table_html.includes('(&#8377;78.40)') && !/&#8377;\s*-/.test(mail2.render_vars.table_html),
    `${mail2?.body} | ${mail2?.render_vars?.table_html}`);
  const dialog = fs.readFileSync(path.join(root, 'src/components/import2b/EmailBillsNotInBooksDialog.tsx'), 'utf8');
  check('the pop-up shows the same words (creditWording), not ₹{sum.tax}',
    dialog.includes('credit {creditWording(sum)}') && !dialog.includes('formatINR(sum.tax)'));
});

// ── 5. Booked: row 5.2 takes the negative head, and every reader sums it ───
const H3 = (igst, cgst, sgst) => ({ igst, cgst, sgst });
const same3 = (a, b) => ['igst', 'cgst', 'sgst'].every((h) => Math.abs((Number(a?.[h]) || 0) - b[h]) < 0.005);
const show3 = (x) => JSON.stringify(x && H3(x.igst, x.cgst, x.sgst));
await run('row 5.2', async () => {
  // Every row of both ITC Summary templates (ordinary and Partial-ITC), read
  // from the page itself.
  const page = fs.readFileSync(path.join(root, 'src/pages/ITCSummaryPage.tsx'), 'utf8');
  const tplRows = (name) => {
    const i = page.indexOf(`const ${name} = (): ITCData => ({`);
    const body = page.slice(i, page.indexOf('\n});', i));
    return ['section4A', 'section4B', 'section4D'].flatMap((sec) => {
      const k = body.indexOf(`${sec}: [`);
      const part = body.slice(k, body.indexOf('\n  ],', k));
      return [...part.matchAll(/\{ srNo: '([^']*)',[^\n]*\}/g)].map((m) => ({ sec, srNo: m[1], editable: /editable: true/.test(m[0]) }));
    });
  };
  for (const name of ['getDefaultITCData', 'getPartialITCData']) {
    const rows = tplRows(name);
    const neg = rows.filter((r) => I.takesNegativeHead?.(r.sec, r.srNo));
    check(`${name}: row 5.2 alone takes a negative head (and is typed); the other ${rows.filter((r) => r.editable).length - 1} typed rows refuse one`,
      rows.length >= 15 && neg.length === 1 && neg[0].sec === 'section4A' && neg[0].srNo === '5.2' && neg[0].editable,
      JSON.stringify(neg) + ` of ${rows.length}`);
  }
  check('… 5.3 (auto-linked for a Strict month), 5.1, 4B and 4D rows refuse one',
    !['5.1', '5.3', '5.4', '5.5', '(1)'].some((sr) => I.takesNegativeHead?.('section4A', sr))
      && !I.takesNegativeHead?.('section4B', '5.2') && !I.takesNegativeHead?.('section4D', '5.2') && !I.takesNegativeHead?.('section4B', '(ii)'));
  check('the ITC Summary cell refuses a negative only where takesNegativeHead says no, with no floor of 0 on 5.2',
    page.includes('const negativeOk = takesNegativeHead(section, row.srNo);') && page.includes('if (numVal < 0 && !negativeOk) {')
      && page.includes('min={negativeOk ? undefined : 0}') && (page.match(/numVal < 0/g) || []).length === 1);
  check('… and 5.2 shows what is typed while focused, so a leading "-" is not reset to the figure',
    page.includes('value={shown}') && page.includes('setCellDraft({ key: draftKey, text: e.target.value });')
      && page.includes("onBlur={negativeOk ? () => setCellDraft(null) : undefined}"));

  // A month: 5.1 claims 1,000 / 500 / 500; the booked credit note (1,500 IGST,
  // 100 + 100 CGST/SGST) is reduced in 5.2, taking IGST of 4A(5) below zero.
  const A4 = (r51, r52) => [
    { srNo: '(1)', ...H3(0, 0, 0) }, { srNo: '(2)', ...H3(0, 0, 0) }, { srNo: '(3)', ...H3(0, 0, 0) }, { srNo: '(4)', ...H3(0, 0, 0) },
    { srNo: '(5)', ...H3(0, 0, 0), isHeader: true },
    { srNo: '5.1', ...r51 }, { srNo: '5.2', ...r52 }, { srNo: '5.3', ...H3(0, 0, 0) }, { srNo: '5.4', ...H3(0, 0, 0) }, { srNo: '5.5', ...H3(0, 0, 0) },
  ];
  const B4 = [
    { srNo: '(1)', ...H3(0, 0, 0) }, { srNo: '(2)', ...H3(0, 0, 0), isHeader: true },
    { srNo: '(i)', ...H3(50, 0, 0) }, { srNo: '(ii)', ...H3(0, 0, 0) }, { srNo: '(iii)', ...H3(0, 0, 0) },
  ];
  const D4 = [{ srNo: '(1)', ...H3(0, 0, 0) }, { srNo: '1.1', ...H3(0, 0, 0) }, { srNo: '1.2', ...H3(0, 0, 0) }, { srNo: '(2)', ...H3(0, 0, 0) }];
  const NEG = A4(H3(1000, 500, 500), H3(-1500, -100, -100));
  // The same month with the note taken off 5.1 instead: what a signed 5.2 must equal.
  const NET = A4(H3(-500, 400, 400), H3(0, 0, 0));
  check('Total (5) = 5.1 + 5.2 − 5.3 + 5.4 + 5.5 with a negative 5.2 head (−500 / 400 / 400)',
    same3(I.computeSection4ATotal5(NEG), H3(-500, 400, 400)), show3(I.computeSection4ATotal5(NEG)));
  check('… and Total 4A the same (rows 1 to 4 nil)', same3(I.computeTotal4A(NEG), H3(-500, 400, 400)), show3(I.computeTotal4A(NEG)));

  const g3 = (section4A, extra = {}) => G.buildGstr3bJson({ gstin: '24AAAAA0000A1Z5', periodMonth: '09/2026', gstr1Raw: null,
    itc: { section4A, section4B: extra.section4B || B4, section4D: D4 }, rcm: { taxable: 0, igst: 0, cgst: 0, sgst: 0 }, alreadyFiled: false, ...extra.input });
  const r = g3(NEG);
  const avl = (x) => x.json.itc_elg.itc_avl.find((e) => e.ty === 'OTH');
  const rev = (x, ty) => x.json.itc_elg.itc_rev.find((e) => e.ty === ty);
  check('GSTR-3B files 4A(5) at 0 for the head the negative 5.2 takes below zero (IGST), the others as they are (0 / 400 / 400)',
    same3(avl(r), H3(0, 400, 400)) && same3(r.summary.itcAvailableRows.find((x) => x.srNo === '(5)'), H3(0, 400, 400)), show3(avl(r)));
  check('… and puts the excess (500 IGST) in 4B(2) Others, beside the 50 reversed (550 / 0 / 0); 4B(1) nil',
    same3(rev(r, 'OTH'), H3(550, 0, 0)) && same3(rev(r, 'RUL'), H3(0, 0, 0)), `${show3(rev(r, 'OTH'))} ${show3(rev(r, 'RUL'))}`);
  check('… net ITC unchanged: 4C = Total 4A − 4B as typed (−550 / 400 / 400), and the same as the note taken off 5.1',
    same3(r.json.itc_elg.itc_net, H3(-550, 400, 400)) && same3(r.summary.itcNet, g3(NET).summary.itcNet), show3(r.json.itc_elg.itc_net));
  check('… with a flag naming the negative row 5.2', r.flags.some((f) => f.includes('4A(5) All other ITC came out negative (IGST 500.00)') && f.includes('row 5.2')),
    r.flags.filter((f) => f.startsWith('4A(5)')).join(' | '));
  const small = g3(A4(H3(1000, 500, 500), H3(-200, -100, -100)));
  check('a negative 5.2 head that leaves 4A(5) above zero is filed as it nets (800 / 400 / 400), nothing moved to 4B(2)',
    same3(avl(small), H3(800, 400, 400)) && same3(rev(small, 'OTH'), H3(50, 0, 0)) && !small.flags.some((f) => f.startsWith('4A(5)')), show3(avl(small)));

  // Partial-ITC builder: the carpet-area split runs on the signed Total 4A.
  const PB = [
    { srNo: '(1)', particular: 'Calculation of Ineligible ITC under Rule - 38, 42 & 43, and Section 17(5)', ...H3(0, 0, 0) },
    { srNo: '', particular: 'i) On ITC as per 4A', ...H3(0, 0, 0) },
    { srNo: '', particular: 'ii) Previous Month Adjustment', ...H3(0, 0, 0) },
    { srNo: '', particular: 'iii) On Other reversal', ...H3(0, 0, 0) },
    { srNo: '(2)', particular: 'Others', ...H3(0, 0, 0) },
    { srNo: '', particular: 'ITC Reversal for the current month as per 2B RECO', ...H3(50, 0, 0) },
    { srNo: '', particular: 'ITC Reversal for the previous months, if any.', ...H3(0, 0, 0) },
  ];
  const split = (a) => I.computePartialItcSplit({ section4A: a, section4B: PB, commercialArea: 600, residentialArea: 400 });
  const sNeg = split(NEG);
  check('the Partial-ITC split takes 40% of the signed Total 4A (−200 / 160 / 160), the same as the note taken off 5.1',
    same3(sNeg.onITCAsPerA, H3(-200, 160, 160)) && same3(sNeg.main1Calculated, split(NET).main1Calculated), show3(sNeg.onITCAsPerA));
  const pb = g3(NEG, { section4B: PB, input: { builderItcType: 'PARTIAL_ITC', commercialArea: 600, residentialArea: 400 } });
  const pbNet = g3(NET, { section4B: PB, input: { builderItcType: 'PARTIAL_ITC', commercialArea: 600, residentialArea: 400 } });
  check('… GSTR-3B for that builder: 4A(5) and 4B(1) never below zero, net ITC the same as the note taken off 5.1',
    ['igst', 'cgst', 'sgst'].every((h) => avl(pb)[h] >= 0 && rev(pb, 'RUL')[h] >= 0) && same3(pb.summary.itcNet, pbNet.summary.itcNet),
    `4A(5) ${show3(avl(pb))} 4B(1) ${show3(rev(pb, 'RUL'))} 4B(2) ${show3(rev(pb, 'OTH'))} net ${show3(pb.summary.itcNet)} vs ${show3(pbNet.summary.itcNet)}`);

  // Credit closing (Reports): opening + Total 4A − 4B, signed.
  const gr = { opening_igst: 2000, opening_cgst: 2000, opening_sgst: 2000 };
  const cc = A.computeCreditClosing(gr, { section4A: NEG, section4B: B4, section4D: D4 }, null, '09/2026');
  const ccNet = A.computeCreditClosing(gr, { section4A: NET, section4B: B4, section4D: D4 }, null, '09/2026');
  check('the credit closing report takes the negative 5.2 head off the credit (1,450 / 2,400 / 2,400), as if off 5.1',
    Math.abs(cc.closingIgst - 1450) < 0.005 && Math.abs(cc.closingCgst - 2400) < 0.005 && Math.abs(cc.closingSgst - 2400) < 0.005
      && cc.closingIgst === ccNet.closingIgst && cc.closingCgst === ccNet.closingCgst,
    JSON.stringify({ igst: cc.closingIgst, cgst: cc.closingCgst, sgst: cc.closingSgst }));

  // GST receivable reco (the GSTR-3B push's check): the previous month's ITC Summary.
  const db = globalThis.__db;
  const RC = 'client-r';
  db.gst_receivable_reco = [{ client_id: RC, period_month: '10/2026', opening_igst: 2000, opening_cgst: 2000, opening_sgst: 2000,
    books_closing_igst: 0, books_closing_cgst: 0, books_closing_sgst: 0, utilized_igst: 0, utilized_cgst: 0, utilized_sgst: 0, drc_igst: 0, drc_cgst: 0, drc_sgst: 0 }];
  db.filing_status = [{ client_id: RC, period_month: '09/2026', return_type: 'GSTR-3B', status: 'Filed' }];
  db.clients = [{ id: RC, builder_itc_type: null, commercial_area: null, residential_area: null }];
  db.itc_summaries = [{ client_id: RC, period_month: '09/2026', data: { section4A: NEG, section4B: B4, section4D: D4 } }];
  const d1 = await R.computeGstReceivableRecoDiff(RC, '10/2026');
  db.itc_summaries = [{ client_id: RC, period_month: '09/2026', data: { section4A: NET, section4B: B4, section4D: D4 } }];
  const d2 = await R.computeGstReceivableRecoDiff(RC, '10/2026');
  check('the GST receivable reco reads the negative 5.2 head signed (closing 1,450 / 2,400 / 2,400), as if off 5.1',
    same3(d1, H3(1450, 2400, 2400)) && same3(d1, d2), `${show3(d1)} vs ${show3(d2)}`);
});

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.info}]`}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
