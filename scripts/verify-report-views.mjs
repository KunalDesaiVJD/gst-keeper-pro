#!/usr/bin/env node
// Checks what the Reports Hub views themselves show, drawn to static HTML with
// the real React and the real table kit (scripts/fixtures/reportViewHarness.mjs),
// on fictional tables shaped like their builders' and merged over several
// months with the app's own mergeTables / buildForPeriods:
//   - the all-clients closing-balance rosters (sus-all, cred-all) merged: their
//     tiles are the latest month's balances "as at" it, never added across months;
//     ITC Claimed vs Utilized (a month's flow) still adds up;
//   - the annual trend view: months of one financial year merged are that year
//     once, its tiles the year's own TOTAL; its hidden Quarter is not searched;
//   - the variance view: a plain "Not nil" is not the "Mismatches only" switch;
//   - the exceptions list: a month that could not be built is named, never
//     "No exceptions", and not counted as checked;
//   - the interest working paper: every figure of the per-head line kept, its
//     marker a heading, whatever the merge's headers; the builder's empty month
//     keeps the computation's columns;
//   - grouped, merged returns and working papers: each month's own TOTAL /
//     Result listed, on screen and in the "filtered" export, and the hint says so;
//   - the filed-return PDF row: its words searchable and exported beside the link;
//   - the notices list: Amount of Demand never added up.
//
//   node scripts/verify-report-views.mjs
//
// Nothing is read from or written to Supabase (stand-ins only). Prints pass /
// fail; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadViews } from './fixtures/reportViewHarness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');

const V = await loadViews(root, [
  'AllClientsSnapshotView', 'AnnualTrendView', 'VarianceComparisonView', 'ExceptionsListView',
  'WorkingPaperView', 'FiledReturnSummaryView', 'NoticeWorkflowListView',
]);

const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const T = (title, subtitle, headers, rows, extra = {}) => ({ title, subtitle, headers, rows, fileNameBase: title.replace(/\W+/g, '_'), columnWidths: headers.map(() => 14), ...extra });
const has = (text, s) => text.includes(s);
/** Draws a view, never throwing: a crash is a failed check, not a stopped run. */
const draw = (name, table, report, preset) => {
  try {
    return V.draw(name, table, report, preset);
  } catch (e) {
    return { html: '', text: `DRAW FAILED: ${e?.stack ?? e}`, kit: null, options: null };
  }
};
const exported = (r) => {
  try { return r.kit ? V.exported(r.kit, r.options) : null; } catch { return null; }
};
/** A report that builds each month from `byMonth` (a table, or an Error to throw). */
const fakeReport = (key, byMonth) => ({ ...V.report(key), needs: 'month', build: async ({ month }) => { const t = byMonth[month]; if (t instanceof Error) throw t; return t; } });

// ── 1. Closing-balance rosters over several months ──────────────────────────
{
  const g = 'closing balances merged';
  const sus = (month) => T('Suspended Ledger — Closing Balance — All Clients', `Month: ${month}`,
    ['Sr No.', 'Client Name', 'GSTIN', 'CGST', 'SGST', 'IGST', 'TOTAL'],
    [[1, 'ALPHA TRADERS', '24AAAAA0000A1Z5', 1000, 1000, 0, 2000], [2, 'BETA TRADERS', '24BBBBB0000B1Z5', 500, 500, 0, 1000]]);
  const one = draw('AllClientsSnapshotView', sus('Jun 2026'), V.report('sus-all'));
  check(g, 'one month: the tiles are its totals, not "as at" (unchanged)', one.kit?.totalsAsAt === null && /TOTAL\s*3,000\.00/.test(one.text) && !/as at/.test(one.text), one.text.slice(0, 600));

  const merged = V.mergeTables([sus('Jun 2026'), sus('Jul 2026')], ['06/2026', '07/2026']);
  const m = draw('AllClientsSnapshotView', merged, V.report('sus-all'));
  check(g, 'Jun + Jul: the kit takes the latest month (acrossPeriods latest)', m.options?.acrossPeriods === 'latest' && m.kit?.totalsAsAt === 'Jul 2026', JSON.stringify([m.options?.acrossPeriods, m.kit?.totalsAsAt]));
  check(g, '… the TOTAL tile reads 3,000.00 "as at Jul 2026", not 6,000.00', /TOTAL\s*3,000\.00\s*as at Jul 2026/.test(m.text) && !has(m.text, '6,000.00'), m.text.slice(0, 700));
  check(g, '… CGST 1,500.00 as at Jul 2026 (the firm\'s closing CGST)', /CGST\s*1,500\.00\s*as at Jul 2026/.test(m.text), m.text.slice(0, 700));
  check(g, '… no "TOTAL (2 periods)" adding the two month-ends', !/TOTAL \(\d+ periods?\)/.test(m.text));

  const s = draw('AllClientsSnapshotView', merged, V.report('sus-all'), (kit) => kit.setSearch('alpha'));
  check(g, 'searched "alpha": its July balance (2,000.00 of 3,000.00 as at Jul 2026), not the two months added (4,000.00)', /TOTAL\s*2,000\.00\s*of 3,000\.00 as at Jul 2026/.test(s.text) && !has(s.text, '4,000.00'), s.text.slice(0, 700));
  const grouped = draw('AllClientsSnapshotView', merged, V.report('sus-all'), (kit) => kit.setGroup(1));
  check(g, 'grouped by client: no subtotal adding a client\'s two month-ends', grouped.kit?.view.groups?.length === 2 && grouped.kit.view.groups.every((x) => x.sums.size === 0), JSON.stringify(grouped.kit?.view.groups?.map((x) => [x.label, [...x.sums]])));
  const xp = exported(m);
  check(g, 'the "filtered" export\'s KPIs are as at Jul 2026, 3,000.00', !!xp?.kpis?.some((k) => k.label === 'TOTAL as at Jul 2026' && /3,000\.00/.test(k.value)), JSON.stringify(xp?.kpis));

  // The Credit Ledger roster throws before Jun 2026: May is not built.
  const cred = (month) => T('Credit Ledger — Closing Balance — All Clients', `Month: ${month}`,
    ['Sr No.', 'Client Name', 'GSTIN', 'CGST', 'SGST', 'IGST', 'TOTAL', 'GST Payable CGST', 'GST Payable SGST', 'GST Payable IGST', 'GST Payable TOTAL'],
    [[1, 'ALPHA TRADERS', '24AAAAA0000A1Z5', 300, 300, 0, 600, 0, 0, 0, 0], [2, 'BETA TRADERS', '24BBBBB0000B1Z5', 100, 100, 0, 200, 50, 50, 0, 100]]);
  const credReport = fakeReport('cred-all', {
    '05/2026': new Error('Credit Ledger reconciliation is available from Jun-26 onward only. Pick Jun-26 or later.'),
    '06/2026': cred('Jun 2026'),
    '07/2026': cred('Jul 2026'),
  });
  const built = await V.buildForPeriods(credReport, ['05/2026', '06/2026', '07/2026'], '');
  const c = draw('AllClientsSnapshotView', built, credReport);
  check(g, 'cred-all May (not built) + Jun + Jul: TOTAL 800.00 as at Jul 2026', /TOTAL\s*800\.00\s*as at Jul 2026/.test(c.text) && !has(c.text, '1,600.00'), c.text.slice(0, 900));
  check(g, '… a long name keeps its whole label: "GST Payable CGST", 50.00 as at Jul 2026', /GST Payable CGST\s*50\.00\s*as at Jul 2026/.test(c.text), c.text.slice(0, 900));
  check(g, '… the Rows tile counts the 2 months built, not 3', /Rows\s*4\s*2 periods/.test(c.text), c.text.slice(0, 400));
  check(g, '… and May is named as not built', has(c.text, 'May 2026 was not built'));

  // ITC Claimed vs Utilized: its Balance is the month's claimed less utilised, a flow.
  const itc = (month, k) => T('ITC Claimed vs ITC Utilized', `Month: ${month}`, ['Sr No.', 'Client Name', 'GSTIN', 'ITC Claimed', 'ITC Utilized', 'Balance / Carried Forward'],
    [[1, 'ALPHA TRADERS', '24AAAAA0000A1Z5', 1000 * k, 600 * k, 400 * k], ['', 'TOTAL', '', 1000 * k, 600 * k, 400 * k]]);
  const im = draw('AllClientsSnapshotView', V.mergeTables([itc('Jun 2026', 1), itc('Jul 2026', 2)], ['06/2026', '07/2026']), V.report('itc-claimed-vs-utilized-all'));
  check(g, 'ITC Claimed vs Utilized merged still adds the months (a flow): 3,000.00 claimed, no "as at"', im.kit?.totalsAsAt === null && /ITC Claimed\s*3,000\.00/.test(im.text) && !/as at/.test(im.text), im.text.slice(0, 600));
}

// ── 2, 3. The annual trend view ─────────────────────────────────────────────
const MONTHS = ['Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027', 'Feb 2027', 'Mar 2027'];
const credLiab = (fy = 'FY 2026-27', months = MONTHS) => T('Credit And Liability Statement', `Client: FICTIONAL TRADERS   |   GSTIN: 24ABCDE1234F1Z5   |   ${fy}`,
  ['Month', 'Total Liability', 'ITC Set Off (as filed)', 'Paid in Cash (as filed)'],
  [...months.map((mo, i) => (i < 3 ? [mo, 1000, 600, 400] : [mo, 'NOT PULLED', '', ''])), [`TOTAL — ${fy}`, 3000, 1800, 1200]]);
{
  const g = 'annual trend merged';
  const report = V.report('credit-and-liability-statement');
  const merged = V.mergeTables([credLiab(), credLiab(), credLiab()], ['04/2026', '05/2026', '06/2026']);
  const r = draw('AnnualTrendView', merged, report);
  check(g, 'Apr + May + Jun of one FY: the tile is the year\'s TOTAL (3,000.00), not three times it (9,000.00)', /Total Liability\s*3,000\.00/.test(r.text) && !has(r.text, '9,000.00'), r.text.slice(0, 700));
  check(g, '… the year once: 12 months, no "TOTAL (3 periods)"', r.kit?.model.data.length === 12 && !r.kit.model.merged && !/TOTAL \(\d+ periods\)/.test(r.text), JSON.stringify([r.kit?.model.data.length, r.kit?.model.merged]));
  check(g, '… and says so: "Apr, May, Jun 2026 are in the same financial year: shown once"', has(r.text, 'Apr, May, Jun 2026 are in the same financial year: shown once'), r.text.slice(0, 500));
  const xp = exported(r);
  check(g, '… the "filtered" export says so too, its TOTAL the year\'s own', !!xp && /shown once/.test(xp.subtitle) && xp.rows.filter((row, i) => xp.rowKinds?.[i] === 'total').length === 1, JSON.stringify(xp && [xp.subtitle, xp.rowKinds]));
  const byQuarter = draw('AnnualTrendView', merged, report, (kit) => kit.setGroup(kit.table.headers.length - 1));
  const q1 = byQuarter.kit?.view.groups?.[0];
  check(g, '… grouped by quarter: Q1 subtotal 3,000.00 over 3 months', q1?.rows.length === 3 && q1.sums.get(1) === 3000, JSON.stringify(q1 && [q1.label, q1.rows.length, [...q1.sums]]));

  const fy2 = MONTHS.map((mo) => mo.replace('2026', '2025').replace('2027', '2026'));
  const two = V.mergeTables([credLiab('FY 2025-26', fy2), credLiab()], ['03/2026', '04/2026']);
  const t = draw('AnnualTrendView', two, report);
  check(g, 'Mar 2026 + Apr 2026 (two FYs): two blocks, the tiles both years added (6,000.00)', t.kit?.model.merged && t.kit.model.periods.length === 2 && /Total Liability\s*6,000\.00/.test(t.text) && !/shown once/.test(t.text), t.text.slice(0, 600));
}
{
  const g = 'annual trend search';
  const report = V.report('credit-and-liability-statement');
  const r = draw('AnnualTrendView', credLiab(), report, (kit) => kit.setSearch('Jun 2026'));
  const shown = r.kit?.view.rows.map((x) => x.cells[0]);
  check(g, '"Jun 2026" finds June only, not April and May through the hidden Quarter', shown?.join() === 'Jun 2026', JSON.stringify(shown));
  check(g, '… its TOTAL (filtered) is June\'s 1,000.00 (of 3,000.00 for the year)', /Total Liability\s*1,000\.00\s*of 3,000\.00 for the year/.test(r.text), r.text.slice(0, 500));
  const d = draw('AnnualTrendView', credLiab(), report, (kit) => kit.setSearch('Dec'));
  check(g, '"Dec" finds December only', d.kit?.view.rows.map((x) => x.cells[0]).join() === 'Dec 2026', JSON.stringify(d.kit?.view.rows.map((x) => x.cells[0])));
}

// ── 4. Variance: "Mismatches only" ──────────────────────────────────────────
{
  const g = 'variance mismatches only';
  const itc2b = T('GSTR 3B vs GSTR 2B ITC Report', 'Client: FICTIONAL TRADERS   |   Period: Jun 2026', ['Tax Head', 'As per GSTR-2B', 'As per GSTR-3B', 'Variance'],
    [['IGST', 1000, 1000.3, 0.3], ['CGST', 500, 650, 150], ['SGST', 500, 499.5, -0.5], ['Total', 2000, 2149.8, 149.8]]);
  const plain = { type: 'number', min: null, max: null, nonZero: true };
  const r = draw('VarianceComparisonView', itc2b, V.report('gstr3b-vs-gstr2b-itc'), (kit) => kit.setFilter(3, plain));
  const button = /<button[^>]*aria-pressed="(true|false)"[^>]*>(?:(?!<\/button>).)*Mismatches only/s.exec(r.html);
  check(g, 'a plain "Not nil" on the Variance column does not light the switch', button?.[1] === 'false', button?.[0]?.slice(0, 200));
  check(g, '… it keeps the rounding rows (3 shown) while the tile says 1 mismatched: the tile is not lit either', r.kit?.view.rows.length === 3 && /aria-pressed="false"[^>]*>(?:(?!<\/button>).)*Mismatched/s.test(r.html), r.kit?.view.rows.length);
  // The switch's own filter (what a click sets; the upgrade over a plain "Not
  // nil" is checked in verify-variance-annual-views.mjs): lit, and the list
  // keeps the one row the tile counts.
  const own = { type: 'number', min: null, max: null, nonZero: true, tolerance: 0.5 };
  const m = draw('VarianceComparisonView', itc2b, V.report('gstr3b-vs-gstr2b-itc'), (kit) => kit.setFilter(3, own));
  const lit = /<button[^>]*aria-pressed="(true|false)"[^>]*>(?:(?!<\/button>).)*Mismatches only/s.exec(m.html);
  check(g, 'the switch\'s own filter lights it, and the list agrees with the tile (1 row)', lit?.[1] === 'true' && m.kit?.view.rows.length === 1, JSON.stringify([lit?.[1], m.kit?.view.rows.length]));
}

// ── 5. Exceptions: a month not built ────────────────────────────────────────
{
  const g = 'exceptions with a month not built';
  const headers = ['Client Name', 'GSTIN', 'Days Late', 'IGST', 'CGST', 'SGST', 'Total Interest'];
  const apr = T('Scrutiny of Interest due to Late Payment of 3B', 'Month: Apr 2026   |   Exceptions only — clients with computed interest > 0.', headers,
    [['ALPHA TRADERS', '24AAAAA0000A1Z5', 12, 0, 300, 300, 600], ['BETA TRADERS', '24BBBBB0000B1Z5', 3, 50, 0, 0, 50], ['', '', '', '', '', 'TOTAL', 650]]);
  const fail = new Error('connection reset');
  const rep = fakeReport('interest-scrutiny', { '04/2026': apr, '05/2026': fail });
  const built = await V.buildForPeriods(rep, ['04/2026', '05/2026'], '');
  const r = draw('ExceptionsListView', built, rep);
  check(g, 'Apr flagged, May not built: the list does not open grouped by Period (the May band would go)', r.kit && r.kit.state.groupBy === null, JSON.stringify(r.kit?.state.groupBy));
  check(g, '… the badge counts the month checked: "2 flagged across 1 period"', has(r.text, '2 flagged across 1 period'), r.text.slice(0, 400));
  check(g, '… May is named as not built', has(r.text, 'May 2026 was not built'));
  const both = draw('ExceptionsListView', await V.buildForPeriods(fakeReport('interest-scrutiny', { '04/2026': apr, '05/2026': apr }), ['04/2026', '05/2026'], ''), rep);
  check(g, 'both months built: opens grouped by Period, "4 flagged across 2 periods" (unchanged)', both.kit?.state.groupBy === headers.length && has(both.text, '4 flagged across 2 periods'), JSON.stringify([both.kit?.state.groupBy, both.text.slice(0, 300)]));

  const empty = T('Scrutiny of Interest due to Late Payment of 3B', 'Month: Apr 2026   |   Exceptions only — clients with computed interest > 0. No client shows computed interest for this period.', headers, []);
  const e = draw('ExceptionsListView', await V.buildForPeriods(fakeReport('interest-scrutiny', { '04/2026': empty, '05/2026': fail }), ['04/2026', '05/2026'], ''), rep);
  check(g, 'Apr clean, May not built: never "No exceptions this period"', !has(e.text, 'No exceptions this period') && !has(e.text, 'Every client cleared'), e.text.slice(0, 600));
  check(g, '… May named as not built, Apr as clean, May as not checked', has(e.text, 'May 2026 was not built') && /No client is flagged in the one period that could be built;\s*the period above was not checked/.test(e.text), e.text.slice(0, 800));
  const calm = draw('ExceptionsListView', empty, rep);
  check(g, 'one clean month: "No exceptions this period" (unchanged)', has(calm.text, 'No exceptions this period'));
}

// ── 6, 7. The interest working paper ───────────────────────────────────────
const junWorking = (igst = 30, cgst = 20, sgst = 20) => [
  ['Return Type', 'GSTR-3B', '', ''],
  ['Status', 'Filed', '', ''],
  ['Due Date', '20/07/2026', '', ''],
  ['Filed Date', '30/07/2026', '', ''],
  ['Days Late', 10, '', ''],
  ['', '', '', ''],
  ['Interest (Rule 88B, net of ITC set-off)', 'IGST', 'CGST', 'SGST'],
  ['', igst, cgst, sgst],
  ['Total Interest', igst + cgst + sgst, '', ''],
  ['', '', '', ''],
  ['Late Fee (s.47)', 'Turnover tier: up to 1.5 crore', '', ''],
  ['CGST', 250, '', ''],
  ['SGST', 250, '', ''],
  ['Total Late Fee', 500, '', ''],
  ['', '', '', ''],
  ['TOTAL (Interest + Late Fee)', igst + cgst + sgst + 500, '', ''],
];
const calcSub = 'Client: CG TRADERS   |   GSTIN: 24CCCCC0000C1Z5   |   Period: Jun 2026   |   Approximate — net-of-ITC basis (Rule 88B(1)).';
{
  const g = 'interest working paper, narrow merge';
  // A merge shaped by an empty month's two columns (as mergeTables did before
  // it took its shape from the first month built with rows).
  const narrow = T('Interest and Late Fee Calculator', `${calcSub.split('   |   ').slice(0, 2).join('   |   ')}   |   2 periods combined`, ['Item', 'Value'], [
    ['— 05/2026 —', ''],
    ['— 06/2026 —', ''],
    ...junWorking(),
  ]);
  const r = draw('WorkingPaperView', narrow, V.report('interest-late-fee-calculator'));
  const rows = r.kit?.table.rows ?? [];
  const byHead = rows.find((row) => /by head$/.test(String(row[1])));
  check(g, 'the per-head line keeps IGST 30, CGST 20 and SGST 20 under their heads', !!byHead && JSON.stringify(byHead.slice(-3)) === '[30,20,20]' && r.kit.table.headers.slice(-3).join() === 'IGST,CGST,SGST', JSON.stringify([r.kit?.table.headers, byHead]));
  check(g, '… the marker line is its part\'s heading, not a step', !rows.some((row, i) => r.kit.table.rowKinds?.[i] === 'data' && /^Interest \(Rule 88B/.test(String(row[1]))) && rows.some((row, i) => r.kit.table.rowKinds?.[i] === 'section' && /^Interest \(Rule 88B/.test(String(row[0]))), JSON.stringify(rows.slice(0, 12)));
  const xp = exported(r);
  const xpHead = xp?.rows.find((row) => /by head$/.test(String(row[1])));
  check(g, '… and the "filtered" export carries all three', !!xpHead && JSON.stringify(xpHead.slice(-3)) === '[30,20,20]', JSON.stringify(xpHead));
}
{
  const g = 'merged returns and working papers grouped';
  const calc = (month, k) => T('Interest and Late Fee Calculator', calcSub.replace('Jun 2026', month), ['Item', 'IGST', 'CGST', 'SGST'], junWorking(30 * k, 20 * k, 20 * k));
  const merged = V.mergeTables([calc('Apr 2026', 1), calc('May 2026', 2)], ['04/2026', '05/2026']);
  const r = draw('WorkingPaperView', merged, V.report('interest-late-fee-calculator'), (kit) => kit.setGroup(1));
  const totals = r.kit?.view.items.filter((it) => it.type === 'total').length;
  check(g, 'working paper grouped by Item: both months\' Results listed after the groups', r.kit?.view.groups && totals === 2, JSON.stringify([!!r.kit?.view.groups, totals]));
  check(g, '… the hint says so: "Each period\'s own Result follows the groups, as printed."', has(r.text, 'Each period\'s own Result follows the groups, as printed.'), (/Grouped by[^\n]*/.exec(r.text) ?? [''])[0]);
  check(g, '… and does not speak of a filter that is not there', !has(r.text, 'not of the steps shown'), (/Grouped by[^\n]*/.exec(r.text) ?? [''])[0]);
  const xp = exported(r);
  check(g, '… the "filtered" export has both Results', xp?.rowKinds?.filter((k) => k === 'total').length === 2, JSON.stringify(xp?.rowKinds));
  const f = draw('WorkingPaperView', merged, V.report('interest-late-fee-calculator'), (kit) => kit.setSearch('late'));
  check(g, 'working paper searched: the filter note is said', has(f.text, 'not of the steps shown'), (/Filtered[^\n]*/.exec(f.text) ?? [''])[0]);

  const g1 = (month, k) => T('GSTR 1 Summary Report', `Client: CG TRADERS   |   GSTIN: 24CCCCC0000C1Z5   |   Period: ${month}`, ['Table', 'Doc Type', 'Taxable Value', 'IGST', 'CGST', 'SGST'], [
    ['4A', 'B2B Invoices', 1000 * k, 180 * k, 0, 0],
    ['5A', 'B2C Large', 500 * k, 90 * k, 0, 0],
    ['7', 'B2C Others', 200 * k, 0, 18 * k, 18 * k],
    ['TOTAL (liability-bearing tables)', '', 1700 * k, 270 * k, 18 * k, 18 * k],
  ]);
  const gm = V.mergeTables([g1('Apr 2026', 1), g1('May 2026', 2)], ['04/2026', '05/2026']);
  const s = draw('FiledReturnSummaryView', gm, V.report('gstr1-summary'), (kit) => kit.setGroup(1));
  const st = s.kit?.view.items.filter((it) => it.type === 'total').length;
  check(g, 'GSTR-1 Summary merged, grouped by Doc Type: both months\' TOTALs listed', s.kit?.view.groups && st === 2, JSON.stringify([!!s.kit?.view.groups, st]));
  check(g, '… the hint: "Each period\'s own TOTAL follows the groups, as printed."', has(s.text, 'Each period\'s own TOTAL follows the groups, as printed.'), (/Grouped by[^\n]*/.exec(s.text) ?? [''])[0]);
  check(g, '… not "as printed for every table" over rows that hide nothing', !has(s.text, 'as printed for every table') && !has(s.text, 'not recomputed for the rows shown'), (/Grouped by[^\n]*/.exec(s.text) ?? [''])[0]);
  const sx = exported(s);
  check(g, '… the "filtered" export has both TOTALs', sx?.rowKinds?.filter((k) => k === 'total').length === 2, JSON.stringify(sx?.rowKinds));
  const sf = draw('FiledReturnSummaryView', gm, V.report('gstr1-summary'), (kit) => kit.setSearch('b2b'));
  check(g, 'searched: "Its TOTAL lines are the return\'s own, as printed; they are not recomputed for the rows shown."', has(sf.text, 'Its TOTAL lines are the return\'s own, as printed; they are not recomputed for the rows shown.'), (/Filtered[^\n]*/.exec(sf.text) ?? [''])[0]);
}

// ── 8. The filed-return PDF row ─────────────────────────────────────────────
{
  const g = 'filed return PDF row';
  const url = 'https://example.invalid/storage/returns/gstr3b-jun-2026.pdf';
  const g3b = T('GSTR-3B (Filed on Portal)', 'Client: CG TRADERS   |   GSTIN: 24CCCCC0000C1Z5   |   Jun 2026   |   ARN: AA2406260000001   |   Filed: 20-07-2026   |   Status: Filed',
    ['Table / Head', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess'], [
      ['3.1(a) Outward taxable (other than zero rated, nil, exempt)', 100000, 18000, 0, 0, 0],
      ['4(A) ITC Available — All other ITC', 50000, 9000, 0, 0, 0],
      ['4(C) Net ITC available', 50000, 9000, 0, 0, 0],
      ['Total cash paid', 9000, '', '', '', ''],
      ['', 'Filed Return PDF', url, '', '', ''],
    ]);
  const r = draw('FiledReturnSummaryView', g3b, V.report('gstr3b-filed'), (kit) => kit.setSearch('filed return'));
  const shown = r.kit?.view.rows ?? [];
  check(g, 'searching "filed return" finds the PDF row', shown.length === 1 && shown[0].cells.includes(url), JSON.stringify(shown.map((x) => x.cells)));
  const xp = exported(r);
  const pdfRow = xp?.rows.find((row) => row.includes(url));
  check(g, '… the "filtered" export prints its words beside the link', !!pdfRow && pdfRow[0] === 'Filed Return PDF' && pdfRow.indexOf(url) === 1, JSON.stringify(pdfRow));
  const all = draw('FiledReturnSummaryView', g3b, V.report('gstr3b-filed'));
  check(g, 'on screen: the words once and the "View filed PDF" button to the link', (all.html.match(/Filed return PDF/g) ?? []).length === 1 && new RegExp(`href="${url.replace(/[.]/g, '\\.')}"[^>]*>(?:(?!</a>).)*View filed PDF`, 's').test(all.html) && !all.text.includes(url), (all.html.match(/Filed return PDF/g) ?? []).length);
  const none = draw('FiledReturnSummaryView', { ...g3b, rows: g3b.rows.map((row) => (row.includes(url) ? ['', 'Filed Return PDF', 'Not captured yet — pull it from Filing Status', '', '', ''] : row)) }, V.report('gstr3b-filed'));
  check(g, 'no PDF captured: says why, in the first column (unchanged)', has(none.text, 'Not captured yet — pull it from Filing Status'), none.text.slice(-400));
}

// ── 9. Notices: Amount of Demand never added up ─────────────────────────────
{
  const g = 'notices amount of demand';
  const headers = ['Reference No.', 'Case ID', 'Type', 'Description', 'Issue Date', 'Due Date', 'Extended Due Date', 'Status', 'Priority',
    'Reply Ref No.', 'Reply Date', 'Order No.', 'Order Date', 'Submission ARN', 'Submission Date',
    'Amount of Demand', 'Remarks', 'Issued By', 'Financial Year', 'Assign To', 'PDF'];
  const row = (ref, type, status, amount) => [ref, 'AD1', type, `${type} for FY 2023-24`, '01-06-2026', '30-06-2026', '—', status, 'High', '—', '—', '—', '—', '—', '—', amount, '—', 'Officer', '2023-24', '—', '—'];
  const notices = T('View Notice and Orders', 'Client: CG TRADERS   |   GSTIN: 24CCCCC0000C1Z5   |   All periods on record, most recent first', headers,
    [row('ZD240626000001', 'DRC-01', 'Open', 500000), row('ZD240626000002', 'DRC-07', 'Open', 500000), row('ZD240626000003', 'ASMT-10', 'Closed', 120000)],
    { rowIds: ['n1', 'n2', 'n3'], clientIds: ['c1', 'c1', 'c1'] });
  const r = draw('NoticeWorkflowListView', notices, V.report('view-notices-and-orders', 'View Notice and Orders'));
  check(g, 'no "Amount of demand" tile adding a dispute\'s notice and its order', r.kit && !/Amount of demand/.test(r.text), (/Amount of demand[^\n]*/.exec(r.text) ?? [''])[0]);
  check(g, '… the column is not summed', r.kit?.model.summable.length === 0, JSON.stringify(r.kit?.model.summable));
  const f = draw('NoticeWorkflowListView', notices, V.report('view-notices-and-orders', 'View Notice and Orders'), (kit) => kit.setFilter(7, { type: 'values', values: ['Open'] }));
  check(g, 'filtered to Open: no TOTAL (filtered) of 10,00,000.00 for one dispute', f.kit?.view.filtered && f.kit.view.footer === null && !has(f.text, '10,00,000.00'), JSON.stringify(f.kit?.view.footer));
  const xp = exported(f);
  check(g, '… nor in the "filtered" export', !!xp && !(xp.rowKinds ?? []).includes('total') && !(xp.kpis ?? []).some((k) => /demand/i.test(k.label)), JSON.stringify([xp?.rowKinds, xp?.kpis]));
}

// ── The interest builder's empty month (no Supabase: a stand-in client) ─────
{
  const g = 'interest calculator builder';
  const { build } = createRequire(path.join(root, 'package.json'))('esbuild');
  const stub = `
    // Every query answers nothing, except the client asked for by id.
    const answer = (table) => ({ data: table === 'clients' ? { id: 'c1', name: 'CG TRADERS', gstin: '24CCCCC0000C1Z5', target_date_group1: 20, target_date_group2: 22 } : null, error: null });
    const chain = (table) => new Proxy({}, { get: (_t, k) => (k === 'then' ? (res) => res(answer(table)) : () => chain(table)) });
    export const supabase = { from: (table) => chain(table), rpc: () => chain('rpc') };`;
  const out = await build({
    stdin: { contents: `export { buildInterestLateFeeCalculatorReport } from './src/utils/interestScrutinyReports';`, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
    plugins: [{
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
        b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
      },
    }],
  });
  const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
  const t = await M.buildInterestLateFeeCalculatorReport('c1', '04/2026');
  check(g, 'a month with no GSTR-3B: no rows, the computation\'s four columns all the same', t.rows.length === 0 && t.headers.join() === 'Item,IGST,CGST,SGST' && t.columnWidths.length === 4, JSON.stringify([t.rows.length, t.headers]));
}

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
let group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.info.slice(0, 400)}]`}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
