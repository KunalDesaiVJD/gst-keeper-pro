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
 * A day the balances do not settle: the first deposit's balance carries
 * interest the tax heads do not (as the portal's tot_rng_bal does), so it
 * chains from nothing. The rest chain only in the true order, so that order
 * fits the balances best whatever order the rows are stored in.
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
 * Two shapes of real days the balances do not settle (made-up figures). One
 * entry's balance carries interest, a fee or other amounts the stored tax
 * heads leave out, so it chains to nothing; the rest chain only in the true
 * order, which is the order the pull stores them in.
 *  - cashLateDeposit: a deposit after the day's set-offs, its balance carrying
 *    a fee ("credits first" put it ahead of the set-offs it followed);
 *  - cashTransferPair: a transfer out and back (PMT-09) before the day's
 *    deposit and set-offs, the transfer out carrying interest ("credits
 *    first" put the transfer back ahead of the transfer out). The deposit
 *    chains from the balance before the day too.
 */
export const cashLateDeposit = () => {
  const r = reg('cash-3');
  return [
    r('08/2026', null, 'Opening Balance', null, {}, 0),
    r('08/2026', '2026-08-18', 'Amount deposited CPIN 26080011', false, { igst: 40000 }, 40000),
    r('08/2026', '2026-08-18', 'Other than reverse charge (Aug)', true, { igst: 39000 }, 1000),
    r('08/2026', '2026-08-18', 'Reverse charge (Aug)', true, { cgst: 500, sgst: 500 }, 0),
    r('08/2026', '2026-08-18', 'Amount deposited CPIN 26080012', false, { igst: 12000 }, 14000),
    r('08/2026', null, 'Closing Balance', null, {}, 14000),
  ];
};
export const cashTransferPair = () => {
  const r = reg('cash-4');
  return [
    r('06/2026', null, 'Opening Balance', null, {}, 50000),
    r('06/2026', '2026-06-19', 'TDS Credit', false, { igst: 1000 }, 51000),
    r('06/2026', '2026-06-20', 'Transfer out (PMT-09)', true, { igst: 48000 }, 300),
    r('06/2026', '2026-06-20', 'Transfer in (PMT-09)', false, { cgst: 25350, sgst: 25350 }, 51000),
    r('06/2026', '2026-06-20', 'Amount deposited CPIN 26060021', false, { igst: 100000 }, 151000),
    r('06/2026', '2026-06-20', 'Other than reverse charge (Jun)', true, { igst: 150500 }, 500),
    r('06/2026', '2026-06-20', 'Reverse charge (Jun)', true, { cgst: 250, sgst: 250 }, 0),
    r('06/2026', null, 'Closing Balance', null, {}, 0),
  ];
};

/**
 * One day of `n` deposits, each balance carrying a fee its tax head leaves
 * out, so none chains; their balances still only rise in the true order.
 */
export const cashFeeDeposits = (n) => {
  const r = reg('cash-5');
  let bal = 0;
  return [
    r('09/2026', null, 'Opening Balance', null, {}, 0),
    ...Array.from({ length: n }, (_, k) => {
      bal += 1000 + k * 10 + 5;
      return r('09/2026', '2026-09-20', `Amount deposited CPIN 260900${String(k + 1).padStart(2, '0')}`, false, { igst: 1000 + k * 10 }, bal);
    }),
    r('09/2026', null, 'Closing Balance', null, {}, bal),
  ];
};

/**
 * Shapes where the balances prove nothing against the stored order, which
 * must then stay as stored (each in the portal's own order):
 *  - cashAfterUnsettled: a day after a day the balances did not settle (its
 *    start not proven), whose first deposit chains only from that day's end;
 *  - cashFeeOnly: a late fee set off with no tax (the stored heads all 0),
 *    which "chains" from any balance equal to its own;
 *  - liabilityFeeOnly: a nil-tax return's late fee owed and paid (no tax on
 *    either row);
 *  - liabilityMirroredFees: a register with no Opening row, every liability
 *    and its discharge carrying the same fee, so nothing chains as owed, and
 *    one pair chains by chance the other way.
 * And cashNearest: a day stored with two deposits swapped, which the
 * balances put right in two ways equally; the nearer the stored is taken.
 */
export const cashAfterUnsettled = () => {
  const r = reg('cash-6');
  return [
    r('08/2026', null, 'Opening Balance', null, {}, 0),
    r('08/2026', '2026-08-18', 'Amount deposited CPIN 26080021 (with interest)', false, { igst: 10000 }, 10200),
    r('08/2026', '2026-08-18', 'Other than reverse charge (with interest)', true, { igst: 10000 }, 0),
    r('08/2026', '2026-08-20', 'Amount deposited CPIN 26080022', false, { igst: 5000 }, 5000),
    r('08/2026', '2026-08-20', 'Amount deposited CPIN 26080023 (with fee)', false, { igst: 300 }, 5350),
    r('08/2026', '2026-08-20', 'Other than reverse charge (with fee)', true, { igst: 5300 }, 0),
    r('08/2026', '2026-08-24', 'Amount deposited CPIN 26080024', false, { igst: 1864 }, 1864),
    r('08/2026', null, 'Closing Balance', null, {}, 1864),
  ];
};
export const cashFeeOnly = () => {
  const r = reg('cash-7');
  return [
    r('08/2026', null, 'Opening Balance', null, {}, 0),
    r('08/2026', '2026-08-20', 'Amount deposited CPIN 26080031 (with late fee)', false, { igst: 10000 }, 11890),
    r('08/2026', '2026-08-20', 'Other than reverse charge', true, { igst: 10000 }, 1890),
    r('08/2026', '2026-08-20', 'Late fee set off (no tax)', true, {}, 0),
    r('08/2026', '2026-08-24', 'Amount deposited CPIN 26080032', false, { igst: 1864 }, 1864),
    r('08/2026', null, 'Closing Balance', null, {}, 1864),
  ];
};
export const liabilityFeeOnly = () => {
  const r = reg('liab-3');
  return [
    r('06/2026', null, 'Opening Balance', null, {}, 0),
    r('06/2026', '2026-07-18', 'Other than reverse charge (nil tax, late fee)', true, {}, 700),
    r('06/2026', '2026-07-18', 'Other than reverse charge (late fee paid)', false, {}, 0),
    r('06/2026', null, 'Closing Balance', null, {}, 0),
  ];
};
export const liabilityMirroredFees = () => {
  const r = reg('liab-4');
  return [
    r('06/2026', '2026-07-18', 'Other than reverse charge', true, { igst: 5927 }, 6852),
    r('06/2026', '2026-07-18', 'Reverse charge', true, { igst: 140 }, 7417),
    r('06/2026', '2026-07-18', 'Supplies u/s 9(5)', true, { igst: 6857 }, 14974),
    r('06/2026', '2026-07-18', 'Other than reverse charge', false, { igst: 5927 }, 8122),
    r('06/2026', '2026-07-18', 'Reverse charge', false, { igst: 140 }, 7557),
    r('06/2026', '2026-07-18', 'Supplies u/s 9(5)', false, { igst: 6857 }, 0),
    r('06/2026', null, 'Closing Balance', null, {}, 0),
  ];
};
/**
 * Days after a day the balances did not settle (a deposit carrying interest),
 * which a chain opened from that unknown balance would put in another order:
 *  - cashTransferAfterUnsettled: a PMT-09 transfer out, then back in partly
 *    to the interest head (the in leg moves the tax heads less);
 *  - cashFeeTransferAfterUnsettled: a late fee set off with no tax, then a
 *    transfer whose out leg carries interest, then a set-off.
 * Each is stored in the portal's order and must stay so.
 */
export const cashTransferAfterUnsettled = () => {
  const r = reg('cash-9');
  return [
    r('08/2026', null, 'Opening Balance', null, {}, 0),
    r('08/2026', '2026-08-18', 'Amount deposited CPIN 26080051 (with interest)', false, { igst: 10000 }, 10200),
    r('08/2026', '2026-08-18', 'Other than reverse charge (Aug 18)', true, { igst: 6000 }, 4200),
    r('08/2026', '2026-08-22', 'Transfer out (PMT-09)', true, { cgst: 3000 }, 1200),
    r('08/2026', '2026-08-22', 'Transfer in (PMT-09, part to interest)', false, { igst: 2500 }, 4200),
    r('08/2026', '2026-08-24', 'Amount deposited CPIN 26080052', false, { igst: 1864 }, 6064),
    r('08/2026', null, 'Closing Balance', null, {}, 6064),
  ];
};
export const cashFeeTransferAfterUnsettled = () => {
  const r = reg('cash-10');
  return [
    r('08/2026', null, 'Opening Balance', null, {}, 0),
    r('08/2026', '2026-08-18', 'Amount deposited CPIN 26080061 (with interest)', false, { igst: 10000 }, 10200),
    r('08/2026', '2026-08-18', 'Other than reverse charge (Aug 18)', true, { igst: 6000 }, 4200),
    r('08/2026', '2026-08-22', 'Late fee set off (no tax)', true, {}, 3700),
    r('08/2026', '2026-08-22', 'Transfer out (PMT-09, with interest)', true, { cgst: 800 }, 2700),
    r('08/2026', '2026-08-22', 'Transfer in (PMT-09)', false, { igst: 1000 }, 3700),
    r('08/2026', '2026-08-22', 'Other than reverse charge (Aug 22)', true, { igst: 3000 }, 700),
    r('08/2026', '2026-08-24', 'Amount deposited CPIN 26080062', false, { igst: 1864 }, 2564),
    r('08/2026', null, 'Closing Balance', null, {}, 2564),
  ];
};

/**
 * A day after a day the balances did not settle that chains at every step
 * from that day's last balance, and nets to nothing (a 3B day: TDS and TCS
 * credits, a deposit, then the set-offs). `readBack` returns it in another
 * order (TDS, deposit, set-offs, TCS), whose steps only move the balance
 * their own way: the chain, fitting strictly better, puts it right.
 */
export const cashChainAfterUnsettled = (readBack = false) => {
  const r = reg('cash-11');
  const tds = r('08/2026', '2026-08-20', 'TDS Credit', false, { igst: 90000 }, 96200);
  const tcs = r('08/2026', '2026-08-20', 'TCS Credit', false, { cgst: 20, sgst: 20 }, 96240);
  const dep = r('08/2026', '2026-08-20', 'Amount deposited CPIN 26080071', false, { sgst: 570000 }, 666240);
  const orc = r('08/2026', '2026-08-20', 'Other than reverse charge (Aug 20)', true, { sgst: 650000 }, 16240);
  const rc = r('08/2026', '2026-08-20', 'Reverse charge (Aug 20)', true, { cgst: 5020, sgst: 5020 }, 6200);
  return [
    r('08/2026', null, 'Opening Balance', null, {}, 2000),
    r('08/2026', '2026-08-11', 'Amount deposited CPIN 26080070 (with interest)', false, { igst: 10000 }, 12200),
    r('08/2026', '2026-08-11', 'Other than reverse charge (Aug 11)', true, { igst: 6000 }, 6200),
    ...(readBack ? [tds, dep, orc, rc, tcs] : [tds, tcs, dep, orc, rc]),
    r('08/2026', '2026-08-24', 'Amount deposited CPIN 26080072', false, { igst: 1800 }, 8000),
    r('08/2026', null, 'Closing Balance', null, {}, 8000),
  ];
};

/**
 * A liability register day with no Opening row, the reverse charge carrying
 * interest; `swapped` stores its two liabilities the other way round. Two
 * orders fit as many chains, only one ends on the Closing Balance.
 */
export const liabilitySwappedDebits = (swapped = false) => {
  const r = reg('liab-5');
  const otrc = r('06/2026', '2026-07-22', 'Other than reverse charge (liability)', true, { cgst: 5000, sgst: 5000 }, 10000);
  const rc = r('06/2026', '2026-07-22', 'Reverse charge (liability, with interest)', true, { igst: 2000 }, 12100);
  return [
    ...(swapped ? [rc, otrc] : [otrc, rc]),
    r('06/2026', '2026-07-22', 'Other than reverse charge (paid in cash)', false, { cgst: 2000, sgst: 2000 }, 8100),
    r('06/2026', '2026-07-22', 'Reverse charge (paid, with interest)', false, { igst: 2000 }, 6000),
    r('06/2026', '2026-07-22', 'Other than reverse charge (paid by ITC)', false, { cgst: 3000, sgst: 3000 }, 0),
    r('06/2026', null, 'Closing Balance', null, {}, 0),
  ];
};

/** cashNearest: the day as the portal lists it; `swapped` stores its two deposits the other way round. */
export const cashNearest = (swapped = false) => {
  const r = reg('cash-8');
  const a = r('08/2026', '2026-08-20', 'Amount deposited CPIN 26080041', false, { igst: 300 }, 600);
  const b = r('08/2026', '2026-08-20', 'Amount deposited CPIN 26080042', false, { igst: 300 }, 900);
  return [
    r('08/2026', null, 'Opening Balance', null, {}, 300),
    ...(swapped ? [b, a] : [a, b]),
    r('08/2026', '2026-08-20', 'Other than reverse charge (with fee)', true, { igst: 100 }, 200),
    r('08/2026', '2026-08-24', 'Amount deposited CPIN 26080043', false, { igst: 1000 }, 1200),
    r('08/2026', null, 'Closing Balance', null, {}, 1200),
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

/** Two entries of one day that chain both ways (no opening, no closing): not guessed, kept as stored. */
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
