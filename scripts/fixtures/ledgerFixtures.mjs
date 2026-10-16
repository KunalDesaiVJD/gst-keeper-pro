// Fictional portal ledger rows for scripts/verify-ledger-order.mjs, shaped as
// the extension stores them (content.js parseLedgerTxns / readLedgerRows):
// monthly Opening / Closing Balance rows with no date and no Dr/Cr, entries of
// one day whose running balances fix their order, and the credit ledger's
// scraped row text. Client ids, CPINs and references are made up. Each list is
// in the ledger's true order; the checks shuffle it.

/** A seeded shuffle (mulberry32), so a failure can be replayed. */
export function shuffled(list, seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const reg = (client_id) => (period_month, entry_date, description, is_debit, heads, balance) => ({
  client_id, period_month, entry_date, description, is_debit,
  igst: heads.igst ?? 0, cgst: heads.cgst ?? 0, sgst: heads.sgst ?? 0, cess: heads.cess ?? 0, balance,
});

/**
 * Cash ledger, FY 2026-27, in the true order. April's day of three and May's
 * day of three only chain one way (May's opens with a debit, so "credits
 * first" alone would get it wrong); June has its balances only; September
 * holds a failed pull's breadcrumb; January and March sit across the year
 * boundary (as text, 01/2027 would sort before 04/2026).
 */
export const cashFy2026 = () => {
  const r = reg('cash-1');
  return [
    r('04/2026', null, 'Opening Balance', null, {}, 500),
    r('04/2026', '2026-04-10', 'Amount deposited CPIN 26040001', false, { cgst: 1000, sgst: 1000 }, 2500),
    r('04/2026', '2026-04-10', 'Other than reverse charge (Apr)', true, { cgst: 800, sgst: 800 }, 900),
    r('04/2026', '2026-04-10', 'Reverse charge (Apr)', true, { igst: 400 }, 500),
    r('04/2026', '2026-04-20', 'Amount deposited CPIN 26040002', false, { igst: 300 }, 800),
    r('04/2026', null, 'Closing Balance', null, {}, 800),
    r('05/2026', null, 'Opening Balance', null, {}, 800),
    r('05/2026', '2026-05-15', 'Other than reverse charge (May)', true, { igst: 600 }, 200),
    r('05/2026', '2026-05-15', 'Amount deposited CPIN 26050001', false, { igst: 1000 }, 1200),
    r('05/2026', '2026-05-15', 'Reverse charge (May)', true, { cgst: 600, sgst: 600 }, 0),
    r('05/2026', null, 'Closing Balance', null, {}, 0),
    r('06/2026', null, 'Opening Balance', null, {}, 0),
    r('06/2026', null, 'Closing Balance', null, {}, 0),
    r('09/2026', null, 'PULL FAILED: session kept dropping', null, {}, 0),
    r('01/2027', null, 'Opening Balance', null, {}, 0),
    r('01/2027', '2027-01-05', 'Amount deposited CPIN 27010001', false, { igst: 5000 }, 5000),
    r('01/2027', '2027-01-20', 'Other than reverse charge (Jan)', true, { igst: 2655 }, 2345),
    r('01/2027', null, 'Closing Balance', null, {}, 2345),
    r('03/2027', null, 'Opening Balance', null, {}, 2345),
    r('03/2027', '2027-03-25', 'Amount deposited CPIN 27030001', false, { cess: 1000 }, 3345),
    r('03/2027', '2027-03-25', 'Other than reverse charge (Mar)', true, { cess: 345 }, 3000),
    r('03/2027', null, 'Closing Balance', null, {}, 3000),
  ];
};

/** Cash ledger, FY 2027-28: one month, for a merge of two financial years. */
export const cashFy2027 = () => {
  const r = reg('cash-1');
  return [
    r('04/2027', null, 'Opening Balance', null, {}, 3000),
    r('04/2027', '2027-04-12', 'Other than reverse charge (Apr 27)', true, { igst: 1000 }, 2000),
    r('04/2027', null, 'Closing Balance', null, {}, 2000),
  ];
};

/**
 * A day the balances cannot order: the deposits' balances carry interest the
 * tax heads do not (as the portal's tot_rng_bal does), so nothing chains. The
 * fallback lists the credits first, as stored, then the debit.
 */
export const cashUnchained = () => {
  const r = reg('cash-2');
  return [
    r('08/2026', null, 'Opening Balance', null, {}, 0),
    r('08/2026', '2026-08-15', 'Amount deposited CPIN 26080001', false, { igst: 1000 }, 1050),
    r('08/2026', '2026-08-15', 'Amount deposited CPIN 26080002', false, { igst: 200 }, 1250),
    r('08/2026', '2026-08-15', 'Other than reverse charge (Aug)', true, { igst: 1000 }, 250),
    r('08/2026', null, 'Closing Balance', null, {}, 250),
  ];
};

/**
 * Liability register, FY 2026-27. A debit (the liability) raises the balance
 * and a credit (its discharge) lowers it. April has no Opening Balance row
 * (the portal's own register may not): its four entries of one day chain two
 * ways from an unknown start, and only one ends on the Closing Balance.
 */
export const liabilityFy2026 = () => {
  const r = reg('liab-1');
  return [
    r('04/2026', '2026-05-20', 'Other than reverse charge', true, { igst: 50000 }, 50000),
    r('04/2026', '2026-05-20', 'Reverse charge and supplies made u/s 9(5)', true, { cgst: 1000, sgst: 1000 }, 52000),
    r('04/2026', '2026-05-20', 'Reverse charge and supplies made u/s 9(5)', false, { cgst: 1000, sgst: 1000 }, 50000),
    r('04/2026', '2026-05-20', 'Other than reverse charge', false, { igst: 50000 }, 0),
    r('04/2026', null, 'Closing Balance', null, {}, 0),
    r('05/2026', null, 'Opening Balance', null, {}, 0),
    r('05/2026', '2026-06-20', 'Other than reverse charge', true, { igst: 3000 }, 3000),
    r('05/2026', '2026-06-20', 'Other than reverse charge', false, { igst: 3000 }, 0),
    r('05/2026', null, 'Closing Balance', null, {}, 0),
  ];
};

/** Two entries of one day that chain both ways (no opening, no closing): the fallback, debits first. */
export const liabilityAmbiguous = () => {
  const r = reg('liab-2');
  return [
    r('07/2026', '2026-08-20', 'Other than reverse charge', true, { igst: 100 }, 100),
    r('07/2026', '2026-08-20', 'Other than reverse charge', false, { igst: 100 }, 0),
  ];
};

const money = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A credit ledger row's text as the extension scrapes it: every cell's text, page whitespace and all. */
const creditText = ({ serial, date, ref, taxPeriod, desc, type, amt, bal }) => {
  const total = (h) => h.igst + h.cgst + h.sgst + h.cess;
  const cells = [
    ...(serial === null ? [] : [String(serial)]), date, ref, taxPeriod, desc, type,
    ...[amt.igst, amt.cgst, amt.sgst, amt.cess, total(amt)].map(money),
    ...[bal.igst, bal.cgst, bal.sgst, bal.cess, total(bal)].map(money),
  ];
  return `\n                           ${cells.join('\n                            \n\t\t\t\t\t\t\t')}\n                            `;
};
const head = (h) => ({ igst: 0, cgst: 0, sgst: 0, cess: 0, ...h });
const cred = (client_id) => (period_month, spec) => {
  const amt = head(spec.amt);
  return {
    client_id, period_month, is_debit: spec.type === 'Debit',
    description: creditText({ ...spec, amt, bal: head(spec.bal) }),
    igst: amt.igst, cgst: amt.cgst, sgst: amt.sgst,
  };
};

/**
 * Credit ledger transaction detail, FY 2026-27, in the true order (the
 * portal's serial numbers). Each month's day opens with a debit, so "credits
 * first" alone would get it wrong.
 */
export const creditFy2026 = () => {
  const c = cred('cred-1');
  return [
    c('04/2026', { serial: 2, date: '20/04/2026', ref: 'DI0000000000001', taxPeriod: 'Mar-26', desc: 'Other than reverse charge', type: 'Debit', amt: { igst: 4000 }, bal: { igst: 6000 } }),
    c('04/2026', { serial: 3, date: '20/04/2026', ref: 'AB0000000000001', taxPeriod: 'Mar-26', desc: 'ITC accrued through - Inputs', type: 'Credit', amt: { igst: 2000, cgst: 1000, sgst: 1000 }, bal: { igst: 8000, cgst: 1000, sgst: 1000 } }),
    c('08/2026', { serial: 2, date: '15/08/2026', ref: 'DI0000000000002', taxPeriod: 'Jul-26', desc: 'Other than reverse charge', type: 'Debit', amt: { cgst: 500, sgst: 500 }, bal: { igst: 8000, cgst: 500, sgst: 500 } }),
    c('08/2026', { serial: 3, date: '15/08/2026', ref: 'AB0000000000002', taxPeriod: 'Jul-26', desc: 'ITC accrued through - Inputs', type: 'Credit', amt: { igst: 383 }, bal: { igst: 8383, cgst: 500, sgst: 500 } }),
    c('01/2027', { serial: 2, date: '18/01/2027', ref: 'AB0000000000003', taxPeriod: 'Dec-26', desc: 'ITC accrued through - Inputs', type: 'Credit', amt: { cgst: 700, sgst: 700 }, bal: { igst: 8383, cgst: 1200, sgst: 1200 } }),
    c('01/2027', { serial: 3, date: '20/01/2027', ref: 'DI0000000000003', taxPeriod: 'Dec-26', desc: 'Other than reverse charge', type: 'Debit', amt: { igst: 383 }, bal: { igst: 8000, cgst: 1200, sgst: 1200 } }),
  ];
};

/**
 * The same ledger's row text without a serial number: the day's two rows are
 * then ordered by their balances (the debit first, the only way they chain).
 */
export const creditNoSerial = () => {
  const c = cred('cred-2');
  return [
    c('04/2026', { serial: null, date: '20/04/2026', ref: 'DI0000000000011', taxPeriod: 'Mar-26', desc: 'Other than reverse charge', type: 'Debit', amt: { igst: 4000 }, bal: { igst: 6000 } }),
    c('04/2026', { serial: null, date: '20/04/2026', ref: 'AB0000000000011', taxPeriod: 'Mar-26', desc: 'ITC accrued through - Inputs', type: 'Credit', amt: { igst: 2500 }, bal: { igst: 8500 } }),
  ];
};
