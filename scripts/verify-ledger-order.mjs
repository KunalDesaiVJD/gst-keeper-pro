#!/usr/bin/env node
// Checks the order of the portal ledger reports (src/utils/ledgerOrder.ts and
// the Cash Ledger, Liability Ledger and Credit Ledger (Transaction Detail)
// builders in src/utils/portalLedgerReports.ts) and how LedgerRegisterView
// shows their monthly balances, on fictional rows (scripts/fixtures/ledgerFixtures.mjs)
// handed to the builders in many random orders:
//   - months in their own order across the year boundary (Jan 2027 after
//     Dec 2026, never before Apr 2026 as text would put it);
//   - within a month its Opening Balance first, the dated entries by date, an
//     undated entry (a failed pull's breadcrumb) after them, its Closing
//     Balance last;
//   - one day's entries in the order their running balances chain (the cash
//     ledger: a credit adds; the liability register: a debit adds, found from
//     its own rows); the credit ledger's by the portal's serial number in its
//     row text, else by the balances in it;
//   - a day no unique chain orders (a balance carrying interest or a fee the
//     tax heads leave out): the order the balances fit best, else as stored
//     (the pull stores the portal's own order); real shapes where "credits
//     first" was wrong; a day too long to search kept as stored; the stored
//     order kept wherever the balances prove nothing against it (an unproven
//     start, a fee with no tax, a register with no Opening row), and of
//     orders fitting equally the one nearer it; the subtitle names the day;
//   - every row once: none lost, none repeated;
//   - every row names its month (a Month column), the balance rows too;
//   - the view: each month's balances in place in the ledger's own order, the
//     whole list on screen and in the "filtered" export; sorted (or with no
//     entry shown, the "no entries" line between them), pinned first and last
//     naming their month; a Month filter picks the months' balances,
//     other filters and the search leave them; a balance never added up; the
//     Closing Balance tile the last month's; a merge of two financial years
//     keeps each year's months under its band; a statement without a Month
//     column still opens and closes the list.
//
//   node scripts/verify-ledger-order.mjs
//
// Nothing is read from or written to Supabase (a stand-in serves the fixtures).
// Prints pass / fail; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadViews } from './fixtures/reportViewHarness.mjs';
import * as F from './fixtures/ledgerFixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const SEEDS = Array.from({ length: 40 }, (_, k) => 1000 + k * 7919);

// The builders, with a Supabase stand-in serving globalThis.__ledgerRows by
// table (filtered by client and months, as the builders ask) and recording
// whether an order was asked of the database.
const stub = `
  const g = globalThis;
  const chain = (table) => {
    const st = { eq: [], in: [] };
    const answer = () => {
      if (table === 'clients') return { data: { id: 'c1', name: 'FICTIONAL TRADERS', gstin: '24AAAAA0000A1Z5' }, error: null };
      const rows = (g.__ledgerRows?.[table] ?? []).filter((r) => st.eq.every(([c, v]) => r[c] === v) && st.in.every(([c, vs]) => vs.includes(r[c])));
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const api = {
      select: () => api,
      eq: (c, v) => { st.eq.push([c, v]); return api; },
      in: (c, vs) => { st.in.push([c, vs]); return api; },
      order: () => { (g.__ledgerOrdered ??= []).push(table); return api; },
      maybeSingle: () => Promise.resolve(answer()),
      then: (res, rej) => Promise.resolve(answer()).then(res, rej),
    };
    return api;
  };
  export const supabase = { from: (table) => chain(table) };`;
const load = async (contents) => {
  const out = await build({
    stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
        b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
      },
    }],
    define: { 'import.meta.env': '{}' },
    banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
// Without src/utils/ledgerOrder.ts (the code before the fix) the builders are
// still checked, and the checks that need it fail rather than stop the run.
const M = await load(`export * from './src/utils/portalLedgerReports'; export * from './src/utils/ledgerOrder';`)
  .catch(() => load(`export * from './src/utils/portalLedgerReports';`));
/** A group of checks; one that throws is a failed check, not a stopped run. */
const run = async (g, fn) => {
  try { await fn(g); } catch (e) { check(g, 'runs', false, e?.stack ?? e); }
};

const serve = (table, rows) => { globalThis.__ledgerRows = { [table]: rows }; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (p) => `${MON[+p.slice(0, 2) - 1]} ${p.slice(3)}`;
// A register row of the report, keyed so the fixture's row can be found: month, description, type, balance.
const regKey = (cells) => `${cells[0]}|${cells[2]}|${cells[3]}|${cells[8]}`;
const regKeyOf = (r) => `${monthOf(r.period_month)}|${r.description}|${r.is_debit === true ? 'Debit' : r.is_debit === false ? 'Credit' : ''}|${r.balance}`;
const fold = (s) => String(s).replace(/\s+/g, ' ').trim();
const sameList = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);
const firstDiff = (a, b) => { const k = a.findIndex((x, i) => x !== b[i]); return `at ${k}: ${a[k]} / ${b[k]}`; };

// ── 1. The period index ─────────────────────────────────────────────────────
await run('period order', async (g) => {
  const ps = ['01/2027', '04/2026', '12/2026', '03/2027', 'junk', '10/2026'];
  const sorted = [...ps].sort((a, b) => M.periodIndex(a) - M.periodIndex(b) || 0);
  check(g, 'months order across the year boundary, never as text (Apr, Oct, Dec 2026, Jan, Mar 2027), an unreadable one last',
    sorted.join(',') === '04/2026,10/2026,12/2026,01/2027,03/2027,junk', sorted.join(','));
});

// ── 2. Cash ledger: order, chain, labels, nothing lost ──────────────────────
const cashTable = async (rows) => { serve('gst_cash_ledger_entries', rows); return M.buildCashLedgerReport('cash-1', '06/2026'); };
await run('cash ledger', async (g) => {
  const truth = F.cashFy2026();
  const want = truth.map(regKeyOf);
  let ordered = 0;
  let detail = '';
  for (const seed of SEEDS) {
    const t = await cashTable(F.shuffled(truth, seed));
    const got = t.rows.map(regKey);
    if (sameList(got, want)) ordered += 1;
    else if (!detail) detail = `seed ${seed} ${firstDiff(got, want)}`;
  }
  check(g, `the true order from ${SEEDS.length} random stored orders`, ordered === SEEDS.length, detail);

  globalThis.__ledgerOrdered = [];
  const t = await cashTable(F.shuffled(truth, 7));
  check(g, 'no order asked of the database (the stored order is only the last tie-break)', !globalThis.__ledgerOrdered.includes('gst_cash_ledger_entries'));
  check(g, 'headers: Month first, then the register', t.headers.join(',') === 'Month,Date,Description,Type,IGST,CGST,SGST,Cess,Balance', t.headers.join(','));
  const counts = new Map();
  for (const k of t.rows.map(regKey)) counts.set(k, (counts.get(k) ?? 0) + 1);
  const lost = truth.map(regKeyOf).filter((k) => !counts.has(k));
  check(g, 'every row once: none lost, none repeated', t.rows.length === truth.length && !lost.length && [...counts.values()].every((n) => n === 1), JSON.stringify({ n: t.rows.length, lost }));
  const months = [...new Set(t.rows.map((r) => r[0]))];
  check(g, 'months in their own order (Jan 2027 after Sep 2026)', months.join(',') === 'Apr 2026,May 2026,Jun 2026,Sep 2026,Jan 2027,Mar 2027', months.join(','));
  // Within each month: Opening first, Closing last, dates ascending between.
  let shape = true;
  let why = '';
  for (const m of months) {
    const rs = t.rows.filter((r) => r[0] === m);
    const opening = rs.findIndex((r) => r[2] === 'Opening Balance');
    const closing = rs.findIndex((r) => r[2] === 'Closing Balance');
    const dates = rs.filter((r) => /^\d{4}-/.test(r[1])).map((r) => r[1]);
    const ok = (opening === -1 || opening === 0) && (closing === -1 || closing === rs.length - 1) && sameList(dates, [...dates].sort());
    if (!ok && shape) { shape = false; why = `${m}: ${rs.map((r) => r[2]).join(' / ')}`; }
  }
  check(g, 'each month: its Opening Balance first, entries by date, its Closing Balance last', shape, why);
  check(g, 'the month with balances only (Jun 2026) keeps both, in its place', t.rows.filter((r) => r[0] === 'Jun 2026').map((r) => r[2]).join(',') === 'Opening Balance,Closing Balance');
  const sep = t.rows.findIndex((r) => r[2].startsWith('PULL FAILED'));
  check(g, "a failed pull's breadcrumb kept once, in its month, with no direction", sep >= 0 && t.rows[sep][0] === 'Sep 2026' && t.rows[sep][3] === '' && t.rows.filter((r) => r[2].startsWith('PULL FAILED')).length === 1);
  const balanceRows = t.rows.filter((r) => /^(Opening|Closing) Balance$/.test(r[2]));
  check(g, 'every Opening / Closing Balance row names its month and carries no Debit / Credit',
    balanceRows.length === 10 && balanceRows.every((r) => /^[A-Z][a-z]{2} 20\d\d$/.test(r[0]) && r[3] === ''), JSON.stringify(balanceRows.map((r) => [r[0], r[3]])));
  // The chain: from each month's opening, every entry is the balance before plus a credit / less a debit.
  let chained = 0;
  let broken = '';
  for (let k = 1; k < t.rows.length; k++) {
    const [prev, cur] = [t.rows[k - 1], t.rows[k]];
    if (prev[0] !== cur[0] || !/^(Credit|Debit)$/.test(cur[3])) continue;
    const amt = cur[4] + cur[5] + cur[6] + cur[7];
    if (Math.abs(prev[8] + (cur[3] === 'Credit' ? amt : -amt) - cur[8]) < 0.01) chained += 1;
    else if (!broken) broken = `${cur[0]} ${cur[2]}`;
  }
  check(g, 'the running balance chains through every entry (a credit adds, a debit takes)', chained === 11 && !broken, `${chained} chained; broken at ${broken}`);
  check(g, 'no note when every day is settled', !/Same-day order/.test(t.subtitle), t.subtitle);
  const may = t.rows.filter((r) => r[0] === 'May 2026').map((r) => r[3]).join(',');
  check(g, "May's day opens with a debit, as its balances prove (credits first would be wrong)", may === ',Debit,Credit,Debit,', may);
});

// ── 3. A day the balances do not settle: as stored unless they fit better ───
const dayOf = (t) => t.rows.filter((r) => /^\d{4}-/.test(r[1])).map((r) => r[2]);
const NOTE_RE = (day) => new RegExp(`Same-day order: 1 day .*${day}.*listed as the portal gave them unless the balances fit another order better`);
await run('cash ledger, a day the balances do not settle', async (g) => {
  const truth = F.cashUnchained();
  let ok = 0;
  let detail = '';
  for (const seed of SEEDS) {
    serve('gst_cash_ledger_entries', F.shuffled(truth, seed));
    const t = await M.buildCashLedgerReport('cash-2', '08/2026');
    const good = t.rows.length === truth.length
      && t.rows[0][2] === 'Opening Balance' && t.rows[t.rows.length - 1][2] === 'Closing Balance'
      && sameList(dayOf(t), truth.filter((r) => r.entry_date).map((r) => r.description))
      && NOTE_RE('15-Aug-2026').test(t.subtitle);
    if (good) ok += 1;
    else if (!detail) detail = `seed ${seed}: ${t.rows.map((r) => r[2]).join(' / ')} | ${t.subtitle}`;
  }
  check(g, `the order the balances fit best (the true one) from ${SEEDS.length} stored orders; nothing lost; the subtitle names the day`, ok === SEEDS.length, detail);

  for (const [name, make, client, month, day] of [
    ['a deposit after the set-offs (its balance carries a fee)', F.cashLateDeposit, 'cash-3', '08/2026', '18-Aug-2026'],
    ['a transfer out and back before the deposit (the transfer out carries interest)', F.cashTransferPair, 'cash-4', '06/2026', '20-Jun-2026'],
  ]) {
    const want = make().filter((r) => r.entry_date).map((r) => r.description);
    serve('gst_cash_ledger_entries', make());
    const kept = await M.buildCashLedgerReport(client, month);
    check(g, `${name}: stored in the portal's order, kept (credits first was wrong); named in the subtitle`,
      sameList(dayOf(kept), want) && NOTE_RE(day).test(kept.subtitle), `${dayOf(kept).join(' / ')} | ${kept.subtitle}`);
    let mended = 0;
    for (const seed of SEEDS) {
      serve('gst_cash_ledger_entries', F.shuffled(make(), seed));
      if (sameList(dayOf(await M.buildCashLedgerReport(client, month)), want)) mended += 1;
    }
    check(g, `… and from ${SEEDS.length} other stored orders, put back in it by the balances`, mended === SEEDS.length, `${mended}/${SEEDS.length}`);
  }

  // Twelve deposits that each carry a fee: no chain, but only one order in which every balance rises.
  const twelve = F.cashFeeDeposits(12);
  const t0 = Date.now();
  let rose = 0;
  for (const seed of SEEDS.slice(0, 10)) {
    serve('gst_cash_ledger_entries', F.shuffled(twelve, seed));
    if (sameList(dayOf(await M.buildCashLedgerReport('cash-5', '09/2026')), twelve.filter((r) => r.entry_date).map((r) => r.description))) rose += 1;
  }
  const ms = Date.now() - t0;
  check(g, 'twelve deposits of one day, none chaining: each moving the balance its way, from 10 stored orders, in under 5 s', rose === 10 && ms < 5000, `${rose}/10 in ${ms} ms`);
  // Past the search's reach a day keeps its stored order rather than hold the report up.
  const long = F.cashFeeDeposits(14);
  const stored = F.shuffled(long, 11);
  serve('gst_cash_ledger_entries', stored);
  const tl = await M.buildCashLedgerReport('cash-5', '09/2026');
  check(g, 'fourteen such deposits: kept as stored, and named', sameList(dayOf(tl), stored.filter((r) => r.entry_date).map((r) => r.description)) && NOTE_RE('20-Sep-2026').test(tl.subtitle), dayOf(tl).join(' / '));
});

// ── 3b. Where the balances prove nothing against it, the stored order stays ──
await run('stored order kept where the balances prove nothing', async (g) => {
  const descs = (rows) => rows.filter((r) => r.entry_date).map((r) => r.description);
  for (const [name, make, client] of [
    ['a day after an unsettled day (its start unproven): its first deposit stays first', F.cashAfterUnsettled, 'cash-6'],
    ['a late fee set off with no tax: not moved ahead of the deposit that funded it', F.cashFeeOnly, 'cash-7'],
  ]) {
    serve('gst_cash_ledger_entries', make());
    const t = await M.buildCashLedgerReport(client, '08/2026');
    check(g, name, sameList(dayOf(t), descs(make())), dayOf(t).join(' / '));
  }
  for (const [name, make, client] of [
    ["a nil-tax return's late fee owed and paid: the debit raises the register, the fee owed before it is paid", F.liabilityFeeOnly, 'liab-3'],
    ['no Opening row, every liability and its discharge with the same fee: as stored, a debit raising the register', F.liabilityMirroredFees, 'liab-4'],
  ]) {
    const o = M.orderRegisterRows(make(), M.LIABILITY_ORDER);
    check(g, name, o.convention === 'debit-adds' && sameList(o.lines.map((l) => l.row.description), make().map((r) => r.description)),
      `${o.convention}: ${o.lines.map((l) => l.row.description).join(' / ')}`);
  }
  for (const [name, make, client] of [
    ['after an unsettled day, a transfer out and back: not swapped by a chain from the unknown balance; both days named', F.cashTransferAfterUnsettled, 'cash-9'],
    ['after an unsettled day, a fee with no tax then a transfer: the fee stays first; both days named', F.cashFeeTransferAfterUnsettled, 'cash-10'],
  ]) {
    serve('gst_cash_ledger_entries', make());
    const tt = await M.buildCashLedgerReport(client, '08/2026');
    check(g, name, sameList(dayOf(tt), descs(make())) && /Same-day order: 2 days .*18-Aug-2026, 22-Aug-2026/.test(tt.subtitle), `${dayOf(tt).join(' / ')} | ${tt.subtitle}`);
  }
  serve('gst_cash_ledger_entries', F.cashChainAfterUnsettled(true));
  const ca = await M.buildCashLedgerReport('cash-11', '08/2026');
  check(g, 'after an unsettled day, a day read back out of order that chains at every step from the balance listed before it: put right, only the unsettled day named',
    sameList(dayOf(ca), descs(F.cashChainAfterUnsettled(false))) && /Same-day order: 1 day .*11-Aug-2026/.test(ca.subtitle), `${dayOf(ca).join(' / ')} | ${ca.subtitle}`);
  const sw = M.orderRegisterRows(F.liabilitySwappedDebits(true), M.LIABILITY_ORDER);
  const swRows = sw.lines.map((l) => l.row);
  check(g, 'a liability day stored with its two liabilities swapped: put right, ending on the Closing Balance (not an order the balances prove wrong)',
    sameList(swRows.map((r) => r.description), F.liabilitySwappedDebits(false).map((r) => r.description)), swRows.map((r) => `${r.description} [${r.balance}]`).join(' / '));
  serve('gst_cash_ledger_entries', F.cashNearest(true));
  const t = await M.buildCashLedgerReport('cash-8', '08/2026');
  check(g, 'two deposits stored the wrong way round, two orders fitting equally: the one nearer the stored (the portal\'s)',
    sameList(dayOf(t), descs(F.cashNearest(false))), dayOf(t).join(' / '));
});

// ── 4. Liability register: its convention found from its own rows ───────────
await run('liability ledger', async (g) => {
  const truth = F.liabilityFy2026();
  const want = truth.map(regKeyOf);
  let ordered = 0;
  let detail = '';
  for (const seed of SEEDS) {
    serve('gst_liability_ledger_entries', F.shuffled(truth, seed));
    const t = await M.buildLiabilityLedgerReport('liab-1', '06/2026');
    const got = t.rows.map(regKey);
    if (sameList(got, want) && !/Same-day order/.test(t.subtitle)) ordered += 1;
    else if (!detail) detail = `seed ${seed} ${firstDiff(got, want)} ${t.subtitle}`;
  }
  check(g, `the true order from ${SEEDS.length} random stored orders (April's day settled by its Closing Balance)`, ordered === SEEDS.length, detail);
  const o = M.orderRegisterRows(F.shuffled(truth, 3), { convention: 'auto', prefer: 'credit-adds' });
  check(g, 'a debit raises the balance: found from the rows even when told to prefer the other way', o.convention === 'debit-adds' && !o.unsettled.length, JSON.stringify({ c: o.convention, u: o.unsettled }));
  const amb = F.liabilityAmbiguous();
  let stable = 0;
  for (const seed of SEEDS) {
    const stored = F.shuffled(amb, seed);
    const r = M.orderRegisterRows(stored, M.LIABILITY_ORDER);
    if (r.lines.length === 2 && r.lines[0].row === stored[0] && r.lines[1].row === stored[1] && r.unsettled.length === 1 && r.unsettled[0].date === '2026-08-20') stable += 1;
  }
  check(g, 'a day that chains both ways is not guessed: kept as stored, and reported', stable === SEEDS.length, `${stable}/${SEEDS.length}`);
});

// ── 5. Credit ledger transaction detail ─────────────────────────────────────
await run('credit ledger (transaction detail)', async (g) => {
  const truth = F.creditFy2026();
  const want = truth.map((r) => `${monthOf(r.period_month)}|${fold(r.description)}`);
  let ordered = 0;
  let detail = '';
  for (const seed of SEEDS) {
    serve('gst_credit_ledger_transactions', F.shuffled(truth, seed));
    const t = await M.buildCreditLedgerTransactionsReport('cred-1', '06/2026');
    const got = t.rows.slice(0, -1).map((r) => `${r[0]}|${fold(r[2])}`);
    const net = t.rows[t.rows.length - 1];
    if (sameList(got, want) && /^NET/.test(net[2]) && t.rows.length === truth.length + 1) ordered += 1;
    else if (!detail) detail = `seed ${seed} ${firstDiff(got, want)}`;
  }
  check(g, `the portal's serial order, months across the year boundary, from ${SEEDS.length} random stored orders; NET last`, ordered === SEEDS.length, detail);
  const read = M.readCreditLedgerText(truth[1].description);
  check(g, "the row text read: serial, date, amount and balance totals", read.serial === 3 && read.date === '2026-04-20' && read.amount === 4000 && read.balance === 10000, JSON.stringify(read));
  const ns = F.creditNoSerial();
  let byBalance = 0;
  for (const seed of SEEDS) {
    serve('gst_credit_ledger_transactions', F.shuffled(ns, seed));
    const t = await M.buildCreditLedgerTransactionsReport('cred-2', '04/2026');
    if (t.rows[0][1] === 'Debit' && t.rows[1][1] === 'Credit' && t.rows.length === 3 && !/Same-day order/.test(t.subtitle)) byBalance += 1;
  }
  check(g, 'without a serial number, the balances in the row text order the day (the debit first)', byBalance === SEEDS.length, `${byBalance}/${SEEDS.length}`);
});

// ── 6. The view ─────────────────────────────────────────────────────────────
const V = await loadViews(root, ['LedgerRegisterView']);
const report = V.report('cash-ledger', 'Cash Ledger', { needs: 'client+month', viewKind: 'ledger-register' });
const draw = (table, preset) => {
  try { return V.draw('LedgerRegisterView', table, report, preset); } catch (e) { return { html: '', text: `DRAW FAILED: ${e?.stack ?? e}`, kit: null, options: null }; }
};
/** The table's rows as drawn: [Month, Description] of each line with a month in its first cell. */
const MONTH_CELL = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20\d\d$/;
// Read from the HTML row by row (a cell's badge is a block of its own, so the text's lines would split a row).
const cellsOf = (html) => html.split(/<\/tr>/).map((tr) => tr.split(/<\/t[dh]>/).slice(0, -1).map((td) => td
  .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim()));
const linesOf = (html) => cellsOf(html).filter((c) => c.length >= 9 && MONTH_CELL.test(c[0]));
const seqOf = (lines) => lines.map((c) => `${c[0]}:${c[2]}`);
const BAL = /^(Opening|Closing) balance/;
await run('view: balances in place', async (g) => {
  const table = await cashTable(F.shuffled(F.cashFy2026(), 11));
  const r = draw(table);
  const lines = linesOf(r.html);
  const want = table.rows.map((c) => `${c[0]}:${c[2].replace(/^Opening Balance$/, 'Opening balance').replace(/^Closing Balance$/, 'Closing balance')}`);
  check(g, "the ledger's own order: each month's opening before its entries, its closing after", sameList(seqOf(lines), want), sameList(seqOf(lines), want) ? '' : `${firstDiff(seqOf(lines), want)} | ${seqOf(lines).join(' / ')}`);
  const balLines = lines.filter((c) => BAL.test(c[2]));
  check(g, 'in place, a balance names its month in the Month column beside it', balLines.length === 10 && balLines.every((c) => c[2] === 'Opening balance' || c[2] === 'Closing balance'), balLines.map((c) => c.join('|')).join(' / '));
  const footer = cellsOf(r.html).filter((c) => /^(Total debits|Total credits|Net)/.test(c[2] ?? ''));
  check(g, 'totals by direction, the Balance column never added up', footer.length === 3 && footer.every((c) => c[8] === ''), JSON.stringify(footer));
  check(g, "the Closing Balance tile is the last month's (Mar 2027: 3,000.00)", /Closing Balance\s*3,000\.00/.test(r.text.replace(/\n/g, ' ')), r.text.slice(0, 600));
  const ex = r.kit ? V.exported(r.kit, r.options) : null;
  const exSeq = ex ? ex.rows.filter((c) => MONTH_CELL.test(String(c[0]))).map((c) => `${c[0]}:${c[2]}`) : [];
  check(g, 'the "filtered" export: the same order, balances in place', sameList(exSeq, want), ex ? firstDiff(exSeq, want) : 'no export');
  const exBal = ex ? ex.rows.filter((c, k) => BAL.test(String(c[2])) && ex.rowKinds[k] === 'subtotal') : [];
  check(g, '… each balance a subtotal line, never summed', exBal.length === 10, String(exBal.length));
});
await run('view: sorted, filtered, searched', async (g) => {
  const table = await cashTable(F.cashFy2026());
  const igst = table.headers.indexOf('IGST');
  const sorted = draw(table, (kit) => kit.setSort({ col: igst, dir: 'desc' }));
  const ls = linesOf(sorted.html);
  const top = ls.slice(0, 5).map((c) => c[2]);
  const bottom = ls.slice(-5).map((c) => c[2]);
  check(g, 'sorted: the openings pinned first and the closings last, each naming its month',
    sameList(top, ['Opening balance · Apr 2026', 'Opening balance · May 2026', 'Opening balance · Jun 2026', 'Opening balance · Jan 2027', 'Opening balance · Mar 2027'])
    && sameList(bottom, ['Closing balance · Apr 2026', 'Closing balance · May 2026', 'Closing balance · Jun 2026', 'Closing balance · Jan 2027', 'Closing balance · Mar 2027']),
    `${top.join(' / ')} … ${bottom.join(' / ')}`);
  const exS = sorted.kit ? V.exported(sorted.kit, sorted.options) : null;
  const exTop = exS ? exS.rows.filter((c) => BAL.test(String(c[2]))).map((c) => c[2]) : [];
  check(g, '… and so in the "filtered" export, labelled in plain text', exTop[0] === 'Opening balance, Apr 2026' && exTop[exTop.length - 1] === 'Closing balance, Mar 2027' && exTop.length === 10, exTop.join(' / '));
  const may = draw(table, (kit) => kit.setFilter(0, { type: 'values', values: ['May 2026'] }));
  const lm = seqOf(linesOf(may.html));
  check(g, "a Month filter picks that month's balances too", sameList(lm, ['May 2026:Opening balance', 'May 2026:Other than reverse charge (May)', 'May 2026:Amount deposited CPIN 26050001', 'May 2026:Reverse charge (May)', 'May 2026:Closing balance']), lm.join(' / '));
  const debits = draw(table, (kit) => kit.setFilter(table.headers.indexOf('Type'), { type: 'values', values: ['Debit'] }));
  const ld = linesOf(debits.html);
  check(g, 'a Debit filter leaves every month bounded by its balances, in place',
    ld.filter((c) => BAL.test(c[2])).length === 10 && ld.filter((c) => !BAL.test(c[2])).every((c) => c[3] === 'Debit')
    && seqOf(ld).slice(0, 4).join('/') === 'Apr 2026:Opening balance/Apr 2026:Other than reverse charge (Apr)/Apr 2026:Reverse charge (Apr)/Apr 2026:Closing balance',
    seqOf(ld).join(' / '));
  const searched = draw(table, (kit) => kit.setSearch('CPIN 2701'));
  const lq = seqOf(linesOf(searched.html));
  check(g, 'the search finds entries only; the balances stay where they are', lq.includes('Jan 2027:Amount deposited CPIN 27010001') && lq.filter((s) => /balance$/.test(s)).length === 10 && lq.length === 11, lq.join(' / '));
  // Nothing shown: the balances first and last, each naming its month, the "no entries" line between.
  const none = draw(table, (kit) => kit.setSearch('no such entry'));
  const rows = cellsOf(none.html).filter((c) => c.length >= 9 && MONTH_CELL.test(c[0]) || /No entries match/.test(c[0] ?? ''));
  const names = rows.map((c) => (MONTH_CELL.test(c[0]) ? c[2] : 'MESSAGE'));
  check(g, 'a search matching nothing: openings first, the "no entries" line, closings last, each naming its month',
    names.length === 11 && names[5] === 'MESSAGE' && names.slice(0, 5).every((n) => /^Opening balance · /.test(n)) && names.slice(6).every((n) => /^Closing balance · /.test(n)), names.join(' / '));
  // A ledger of balances only (one month pulled, nothing moved).
  serve('gst_cash_ledger_entries', F.cashFy2026().filter((r) => r.period_month === '06/2026'));
  const only = await M.buildCashLedgerReport('cash-1', '06/2026');
  const ob = cellsOf(draw(only).html).filter((c) => (c.length >= 9 && MONTH_CELL.test(c[0])) || /No entries in this ledger/.test(c[0] ?? '')).map((c) => (MONTH_CELL.test(c[0]) ? c[2] : 'MESSAGE'));
  check(g, 'a ledger of balances only: its opening, the "no entries" line, its closing', sameList(ob, ['Opening balance · Jun 2026', 'MESSAGE', 'Closing balance · Jun 2026']), ob.join(' / '));
});
await run('view: merges and statements', async (g) => {
  const fy26 = await cashTable(F.cashFy2026());
  serve('gst_cash_ledger_entries', F.cashFy2027());
  const fy27 = await M.buildCashLedgerReport('cash-1', '06/2027');
  const merged = V.mergeTables([fy26, fy27], ['06/2026', '06/2027']);
  const r = draw(merged);
  const text = r.text;
  const at = (s) => text.indexOf(s);
  const lines = linesOf(r.html);
  const apr27 = seqOf(lines.filter((c) => c[0] === 'Apr 2027'));
  check(g, "a merge of two financial years: each year's months under its band, balances in place",
    at('Jun 2026') >= 0 && at('Jun 2026') < at('Apr 2026') && at('Mar 2027 |') < at('Jun 2027') && at('Jun 2027') < at('Apr 2027 |')
    && sameList(apr27, ['Apr 2027:Opening balance', 'Apr 2027:Other than reverse charge (Apr 27)', 'Apr 2027:Closing balance']),
    apr27.join(' / '));
  check(g, '… the Closing Balance tile the later year\'s last month (2,000.00)', /Closing Balance\s*2,000\.00/.test(text.replace(/\n/g, ' ')));

  // A financial-year statement without a Month column: one opening first, its last entry closing.
  const statement = {
    title: 'Electronic Credit Reversal and Re-claimed Statement', subtitle: 'Client: FICTIONAL TRADERS', fileNameBase: 'stmt',
    headers: ['S.No.', 'Date', 'Description', 'ITC Claimed IGST', 'ITC Reversed IGST', 'Closing IGST', 'Balance'],
    rows: [
      [1, '-', 'Opening Balance', '-', '-', 100, 100],
      [2, '2026-05-20', 'GSTR-3B Apr', 50, 0, 150, 150],
      [3, '2026-06-20', 'GSTR-3B May', 0, 30, 120, 120],
    ],
    columnWidths: [6, 12, 22, 12, 12, 12, 12],
  };
  const s = draw(statement, null);
  const sl = cellsOf(s.html).filter((c) => c.length >= 7 && /balance|GSTR-3B/i.test(c[2] ?? ''));
  const names = sl.map((c) => c[2]);
  check(g, 'a statement without a Month column: its opening first, its last entry closing it', sameList(names, ['Opening balance', 'GSTR-3B Apr', 'GSTR-3B May', 'Closing balance (last entry)']), names.join(' / '));
});

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
let group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.info.slice(0, 600)}]`}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
