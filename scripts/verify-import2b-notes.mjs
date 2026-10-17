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
//    figures.
//
//   node scripts/verify-import2b-notes.mjs
//   GSTK_ROOT=/path/to/other/checkout node scripts/verify-import2b-notes.mjs
//
// Fictional documents; Supabase is replaced by an in-memory table store, so
// nothing is read from or written to the live project. Exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

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
export const supabase = { from: (t) => new Q(t) };
`;

const load = async (contents) => {
  const out = await build({
    stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    external: ['exceljs'],
    plugins: [{
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
        b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: FAKE_SUPABASE, loader: 'js' }));
      },
    }],
    define: { 'import.meta.env': '{}' },
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
// One bundle, so the three modules share the one fake client.
const M = await load(`
export * as T from './src/lib/twobDocs';
export * as P from './src/lib/postImport2B';
export * as B from './src/lib/billsNotInBooksMail';
`);
const { T, P, B } = M;

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
});

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.info}]`}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
