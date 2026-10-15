#!/usr/bin/env node
// Checks the filter / sort / group / total rules of the table kit's pure model
// (src/components/reports/views/tableKit/tableModel.ts): the document list the
// GSTR-2A / 2B document reports, the rate-wise and supplier-wise reports and
// the GSTR-1 family open in, and every other report view built on the kit.
//
//   node scripts/verify-doc-table-model.mjs
//
// Builds the pure model with esbuild and runs it on the fictional tables in
// scripts/fixtures/reportExportFixtures.mjs (a two-month merge built with the
// app's own mergeTables). Covers: value counts leave out their own column's
// filter; AND across columns, OR within one; numeric and date ranges; a stable
// sort with blanks last; merged-period tables (bands, per-period TOTALs, the
// Period filter); TOTAL rows never filtered away when nothing is filtered; the
// layout's TOTAL detection; groups and subtotals; pages; the "filtered" export
// table; a view's own (custom) filters; the column groups over the columns
// shown; date-time stamps ordered by their moment; and speed at 5,000 rows. Prints pass / fail; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

const alias = {
  name: 'alias',
  setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
  },
};
const out = await build({
  stdin: {
    contents: `
      export * from './src/components/reports/views/tableKit/tableModel';
      export { guessRowKind } from './src/lib/reportExport/layout';
      export { mergeTables } from './src/lib/reportPeriodMerge';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [alias], logLevel: 'error',
});
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const F = await import(pathToFileURL(path.join(root, 'scripts', 'fixtures', 'reportExportFixtures.mjs')).href);

// ── Harness ─────────────────────────────────────────────────────────────────
const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const near = (a, b) => Math.abs(a - b) < 0.005;
const view = (patch = {}) => ({ ...M.EMPTY_VIEW, filters: {}, ...patch });
const col = (model, header) => model.headers.indexOf(header);
const facet = (model, state, c) => Object.fromEntries(M.facetValues(model, state, c).map((v) => [v.key, v.count]));
const sumCol = (rows, c) => Math.round(rows.reduce((t, r) => t + (typeof r.cells[c] === 'number' ? r.cells[c] : 0), 0) * 100) / 100;
const allTotalsShown = (model, v) => {
  const shown = new Set(v.items.filter((it) => it.type === 'total').map((it) => it.row.i));
  if (v.footer?.type === 'total') shown.add(v.footer.row.i);
  return model.rows.filter((r) => r.kind === 'total' || r.kind === 'subtotal').every((r) => shown.has(r.i));
};

// ── 1. Layout: where a TOTAL label may sit ─────────────────────────────────
{
  const g = 'layout';
  check(g, 'TOTAL in the fourth column (portal 2A / 2B lists) is a total row', M.guessRowKind(['', '', '', 'TOTAL', 100, 18, 0, 0, '']) === 'total');
  check(g, 'TOTAL in the second column is a total row', M.guessRowKind(['', 'TOTAL', '', 5, 100]) === 'total');
  check(g, 'TOTAL (07/2026) in the first column is a total row', M.guessRowKind(['TOTAL (07/2026)', 100, 18]) === 'total');
  check(g, 'a supplier named "Total Solutions" is a data row', M.guessRowKind(['24AAACT1234A1Z1', 'Total Solutions', 'INV-1', '01-07-2026', 100]) === 'data');
  check(g, 'a band is a period row', M.guessRowKind(['— 07/2026 —', '', '', '']) === 'period');
}

// ── 2. Column kinds ────────────────────────────────────────────────────────
const big = F.big(3500);
const bm = M.buildModel(big);
{
  const g = 'columns';
  const kinds = Object.fromEntries(bm.columns.map((c) => [c.header, `${c.kind}/${c.filter}`]));
  check(g, 'Supplier Name: text, ticked values', kinds['Supplier Name'] === 'text/values', kinds['Supplier Name']);
  check(g, 'Invoice No.: text with 3,500 values, contains', kinds['Invoice No.'] === 'text/contains', kinds['Invoice No.']);
  check(g, 'Invoice Date: date range', kinds['Invoice Date'] === 'date/date', kinds['Invoice Date']);
  check(g, 'Taxable Value: numeric range', kinds['Taxable Value'] === 'amount/number', kinds['Taxable Value']);
  check(g, 'Status: ticked values', kinds.Status === 'text/values', kinds.Status);
  check(g, 'Supplier Name groupable, Invoice No. not', bm.columns[col(bm, 'Supplier Name')].groupable && !bm.columns[col(bm, 'Invoice No.')].groupable);
  check(g, 'summable columns are the ones the report totals', JSON.stringify(bm.summable) === JSON.stringify([5, 6, 7, 8, 9]), JSON.stringify(bm.summable));
  check(g, 'grand TOTAL found and kept out of the documents', bm.grandTotal && bm.grandTotal.i === 3500 && bm.data.length === 3500);
  check(g, 'TOTAL label column', bm.labelCol === 1, bm.labelCol);
}

// ── 3. Facet counts leave out their own filter ─────────────────────────────
{
  const g = 'facets';
  const sup = col(bm, 'Supplier Name');
  const st = col(bm, 'Status');
  const s1 = view({ filters: { [sup]: { type: 'values', values: ['Alpha Traders'] } } });
  const supCounts = facet(bm, s1, sup);
  check(g, 'own facet ignores its own ticks: every supplier still counted', Object.keys(supCounts).length === 5 && supCounts['Bharat Steel Works'] === 700 && supCounts['Alpha Traders'] === 700, JSON.stringify(supCounts));
  const stCounts = facet(bm, s1, st);
  const alphaRejected = big.rows.filter((r) => r[2] === 'Alpha Traders' && r[10] === 'Rejected in IMS').length;
  check(g, 'other facet honours the supplier filter', stCounts['Rejected in IMS'] === alphaRejected && stCounts.Matched === 700 - alphaRejected, JSON.stringify(stCounts));
  const s2 = view({ filters: { [st]: { type: 'values', values: ['Rejected in IMS'] } } });
  const supUnderStatus = facet(bm, s2, sup);
  check(g, 'supplier counts honour the status filter', supUnderStatus['Alpha Traders'] === alphaRejected, JSON.stringify(supUnderStatus));
  const s3 = view({ search: 'Bharat', filters: { [st]: { type: 'values', values: ['Matched'] } } });
  const supUnderSearch = facet(bm, s3, sup);
  check(g, 'counts honour the search; values with no rows stay listed at 0', supUnderSearch['Alpha Traders'] === 0 && supUnderSearch['Bharat Steel Works'] > 0, JSON.stringify(supUnderSearch));
  const keys = M.facetValues(bm, view(), sup).map((v) => v.key);
  check(g, 'values listed in natural order', JSON.stringify(keys) === JSON.stringify(['Alpha Traders', 'Bharat Steel Works', 'Coastal Foods LLP', 'Deccan Pharma Pvt Ltd', 'Everest Textiles']), keys.join(', '));
}

// ── 4. AND across columns, OR within one ───────────────────────────────────
{
  const g = 'and/or';
  const sup = col(bm, 'Supplier Name');
  const st = col(bm, 'Status');
  const state = view({ filters: { [sup]: { type: 'values', values: ['Alpha Traders', 'Bharat Steel Works'] }, [st]: { type: 'values', values: ['Rejected in IMS'] } } });
  const got = M.applyFilters(bm, state);
  const want = big.rows.filter((r) => (r[2] === 'Alpha Traders' || r[2] === 'Bharat Steel Works') && r[10] === 'Rejected in IMS').length;
  check(g, 'two suppliers (OR) and one status (AND)', got.length === want && want > 0, `${got.length} vs ${want}`);
  const orOnly = M.applyFilters(bm, view({ filters: { [sup]: { type: 'values', values: ['Alpha Traders', 'Bharat Steel Works'] } } }));
  check(g, 'OR within one column', orOnly.length === 1400, orOnly.length);
  const searchAnd = M.applyFilters(bm, view({ search: 'alpha rejected' }));
  check(g, 'search terms are ANDed across cells', searchAnd.length === big.rows.filter((r) => r[2] === 'Alpha Traders' && r[10] === 'Rejected in IMS').length, searchAnd.length);
  const searchFormatted = M.applyFilters(bm, view({ search: '1,000.00' }));
  check(g, 'search finds a figure as printed (1,000.00)', searchFormatted.length === 1 && searchFormatted[0].cells[5] === 1000, searchFormatted.length);
}

// ── 5. Numeric and date ranges ─────────────────────────────────────────────
{
  const g = 'ranges';
  const tv = col(bm, 'Taxable Value');
  const ig = col(bm, 'IGST');
  const dt = col(bm, 'Invoice Date');
  const between = M.applyFilters(bm, view({ filters: { [tv]: { type: 'number', min: 1500, max: 2000 } } }));
  const want = big.rows.filter((r) => typeof r[5] === 'number' && r[3] !== '' && r[5] >= 1500 && r[5] <= 2000 && r[1] !== 'TOTAL').length;
  check(g, 'min and max inclusive', between.length === want && between.length === 501, `${between.length} vs ${want}`);
  const minOnly = M.applyFilters(bm, view({ filters: { [tv]: { type: 'number', min: 4000, max: null } } }));
  check(g, 'min only', minOnly.length === 500, minOnly.length);
  const nonZero = M.applyFilters(bm, view({ filters: { [ig]: { type: 'number', min: null, max: null, nonZero: true } } }));
  check(g, 'non-zero on an all-nil column leaves nothing', nonZero.length === 0, nonZero.length);
  const dates = M.applyFilters(bm, view({ filters: { [dt]: { type: 'date', from: '2026-07-05', to: '2026-07-10' } } }));
  const wantD = big.rows.filter((r) => /^\d{2}-07-2026$/.test(r[4]) && +r[4].slice(0, 2) >= 5 && +r[4].slice(0, 2) <= 10).length;
  check(g, 'date from / to inclusive', dates.length === wantD && wantD > 0, `${dates.length} vs ${wantD}`);
  const pcm = M.buildModel(F.perClientMonth());
  const pdt = col(pcm, 'Invoice Date');
  const mixed = M.applyFilters(pcm, view({ filters: { [pdt]: { type: 'date', from: '2026-07-10', to: null } } }));
  check(g, 'dates in three spellings (05-07-2026, 12-Jul-26, 2026-07-20) compare as dates', pcm.columns[pdt].kind === 'date' && mixed.map((r) => r.cells[3]).join() === 'BSW-2026-778,CN-9', mixed.map((r) => r.cells[3]).join());
  const range = M.dateRange(bm, dt);
  check(g, 'the date column\'s range', range && range.min === '2026-07-01' && range.max === '2026-07-28', JSON.stringify(range));
  const negative = M.applyFilters(pcm, view({ filters: { [col(pcm, 'Taxable Value')]: { type: 'number', min: null, max: 0 } } }));
  check(g, 'a credit note (negative) passes max 0', negative.length === 1 && negative[0].cells[3] === 'CN-9', negative.length);
}

// ── 6. Sorting: stable, typed, blanks last ─────────────────────────────────
{
  const g = 'sort';
  const sup = col(bm, 'Supplier Name');
  const asc = M.sortRows(bm, bm.data, { col: sup, dir: 'asc' });
  let stable = true;
  for (let k = 1; k < asc.length; k++) if (asc[k].cells[2] === asc[k - 1].cells[2] && asc[k].i < asc[k - 1].i) stable = false;
  check(g, 'ascending by text, ties keep the report\'s order', stable && asc[0].cells[2] === 'Alpha Traders' && asc[asc.length - 1].cells[2] === 'Everest Textiles');
  const desc = M.sortRows(bm, bm.data, { col: sup, dir: 'desc' });
  let stableD = true;
  for (let k = 1; k < desc.length; k++) if (desc[k].cells[2] === desc[k - 1].cells[2] && desc[k].i < desc[k - 1].i) stableD = false;
  check(g, 'descending is stable too', stableD && desc[0].cells[2] === 'Everest Textiles');
  const tv = col(bm, 'Taxable Value');
  const byValue = M.sortRows(bm, bm.data, { col: tv, dir: 'desc' });
  check(g, 'figures sort by value', byValue[0].cells[5] === 4499 && byValue[byValue.length - 1].cells[5] === 1000, `${byValue[0].cells[5]} … ${byValue[byValue.length - 1].cells[5]}`);
  const dt = col(bm, 'Invoice Date');
  const byDate = M.sortRows(bm, bm.data, { col: dt, dir: 'asc' });
  check(g, 'dates sort by date, not text', byDate[0].cells[4] === '01-07-2026' && byDate[byDate.length - 1].cells[4] === '28-07-2026');
  const rate = M.buildModel({
    headers: ['Rate', 'Taxable Value'],
    rows: [['18%', 10], ['5%', 20], ['', 1], ['12%', 30], ['0.25%', 5], ['TOTAL', 66]],
  });
  const rs = M.sortRows(rate, rate.data, { col: 0, dir: 'asc' }).map((r) => r.cells[0]);
  check(g, 'natural order (0.25% < 5% < 12% < 18%), blank last', rs.join(',') === '0.25%,5%,12%,18%,', rs.join(','));
  const rsd = M.sortRows(rate, rate.data, { col: 0, dir: 'desc' }).map((r) => r.cells[0]);
  check(g, 'blank last when descending too', rsd.join(',') === '18%,12%,5%,0.25%,', rsd.join(','));
  // A ledger's Month column ("Apr 2026"): by the month, never alphabetically.
  const mon = M.buildModel({
    headers: ['Month', 'Type', 'IGST'],
    rows: [['Aug 2026', 'Debit', 1], ['Apr 2026', 'Credit', 2], ['Jan 2027', 'Debit', 3], ['Jun 2026', 'Credit', 4], ['Apr 2026', 'Debit', 5]],
  });
  const ms = M.sortRows(mon, mon.data, { col: 0, dir: 'asc' }).map((r) => r.cells[0]);
  check(g, 'month labels sort by the month (Apr 2026 < Jun 2026 < Aug 2026 < Jan 2027)', ms.join(',') === 'Apr 2026,Apr 2026,Jun 2026,Aug 2026,Jan 2027', ms.join(','));
  const mf = M.facetValues(mon, view(), 0).map((v) => v.key);
  const mg = M.groupRows(mon, mon.data, 0, null).map((x) => x.key);
  check(g, '… and list and group in that order too', mf.join(',') === 'Apr 2026,Jun 2026,Aug 2026,Jan 2027' && mg.join(',') === mf.join(','), `${mf.join(',')} / ${mg.join(',')}`);
  const pcm = M.buildModel(F.perClientMonth());
  const pdfCol = col(pcm, 'PDF');
  const byLink = M.sortRows(pcm, pcm.data, { col: col(pcm, 'Taxable Value'), dir: 'asc' }).map((r) => r.cells[3]);
  check(g, 'credit note (negative) first ascending', byLink[0] === 'CN-9', byLink.join());
  const linkFacet = facet(pcm, view(), pdfCol);
  check(g, 'a link column is ticked by Has link / NOT PULLED / (blank)', linkFacet[M.HAS_LINK] === 1 && linkFacet['NOT PULLED'] === 1 && linkFacet[M.BLANK] === 1, JSON.stringify(linkFacet));
}

// ── 7. TOTAL rows never filtered away when nothing is filtered ─────────────
{
  const g = 'totals';
  const tables = { snapshot: F.snapshot(), perClientMonth: F.perClientMonth(), big, reconciliation: F.reconciliation(), wide: F.wide(), merged: F.merged(M.mergeTables) };
  for (const [name, t] of Object.entries(tables)) {
    const m = M.buildModel(t);
    const states = [view(), view({ sort: { col: m.headers.length - 1, dir: 'desc' } })];
    const groupable = m.columns.find((c) => c.groupable && !c.virtual);
    if (groupable) states.push(view({ groupBy: groupable.index }));
    const plain = M.buildView(m, view());
    check(g, `${name}: every TOTAL row shown, in place or pinned`, allTotalsShown(m, plain));
    if (!m.merged && m.grandTotal) {
      check(g, `${name}: the report's grand TOTAL stays under sorted and grouped views`, states.every((s) => M.buildView(m, s).footer?.type === 'total'));
    }
    check(g, `${name}: documents are never structure rows`, m.data.every((r) => r.kind === 'data'));
  }
  const tv = col(bm, 'Taxable Value');
  const st = col(bm, 'Status');
  const filtered = M.buildView(bm, view({ filters: { [st]: { type: 'values', values: ['Rejected in IMS'] } } }));
  check(g, 'filtered: the TOTAL is recomputed over the rows shown', filtered.footer?.type === 'sum' && filtered.footer.label === 'TOTAL (filtered)' && near(filtered.footer.sums.get(tv), sumCol(filtered.rows, tv)) && !near(filtered.footer.sums.get(tv), bm.grandTotal.cells[tv]));
  check(g, 'filtered: the report\'s own TOTAL is not shown as if it described them', !filtered.items.some((it) => it.type === 'total'));
  const none = M.buildView(bm, view({ search: 'no such thing anywhere' }));
  check(g, 'no row matches: an empty list and a nil TOTAL', none.rows.length === 0 && none.footer?.type === 'sum' && none.footer.sums.get(tv) === 0);
  const noTotal = M.buildModel({ headers: ['Tax Head', 'Amount'], rows: [['IGST', 100], ['CGST', 50]] });
  check(g, 'a report without a TOTAL gets none when nothing is filtered', M.buildView(noTotal, view()).footer === null && noTotal.summable.join() === '1');
  const ft = M.buildView(noTotal, view({ search: 'igst' }));
  check(g, '… and a filtered one when something is', ft.footer?.type === 'sum' && ft.footer.sums.get(1) === 100);
}

// ── 8. Multi-period merged tables ──────────────────────────────────────────
{
  const g = 'merged';
  const t = F.merged(M.mergeTables);
  const m = M.buildModel(t);
  check(g, 'two periods from the bands, a Period column', m.merged && m.periods.map((p) => p.key).join() === '07/2026,08/2026' && m.periodCol === m.headers.length && m.columns[m.periodCol].virtual, JSON.stringify(m.periods));
  check(g, 'six documents, two per-period TOTALs, no grand TOTAL', m.data.length === 6 && m.rows.filter((r) => r.kind === 'total').length === 2 && m.grandTotal === null);
  const plain = M.buildView(m, view());
  const kinds = plain.items.map((it) => it.type).join(',');
  check(g, 'unfiltered: bands, sections, rows and both TOTAL (MM/YYYY) rows in the report\'s order', kinds === 'band,section,data,data,section,data,total,band,section,data,data,section,data,total', kinds);
  check(g, 'unfiltered: a TOTAL over both periods under the list', plain.footer?.type === 'sum' && plain.footer.label === 'TOTAL (2 periods)' && near(plain.footer.sums.get(5), 2 * 33500.5));
  check(g, 'Period values listed in band order with counts', JSON.stringify(M.facetValues(m, view(), m.periodCol)) === JSON.stringify([{ key: '07/2026', label: 'Jul 2026', count: 3 }, { key: '08/2026', label: 'Aug 2026', count: 3 }]));
  const aug = M.buildView(m, view({ filters: { [m.periodCol]: { type: 'values', values: ['08/2026'] } } }));
  check(g, 'Period filter: only August\'s rows, under August\'s band', aug.rows.length === 3 && aug.rows.every((r) => m.periods[r.period].key === '08/2026') && aug.items[0].type === 'band' && aug.items[0].key === '08/2026' && !aug.items.some((it) => it.type === 'band' && it.key === '07/2026'));
  const augSum = aug.items.find((it) => it.type === 'sum');
  check(g, 'Period filter: August\'s TOTAL recomputed and labelled filtered', augSum && augSum.label === 'TOTAL (08/2026, filtered)' && near(augSum.sums.get(5), 33500.5));
  const cn = M.buildView(m, view({ search: 'coastal' }));
  check(g, 'search: one row per period, bands kept, empty sections dropped', cn.rows.length === 2 && cn.items.map((it) => it.type).join(',') === 'band,section,data,sum,band,section,data,sum', cn.items.map((it) => it.type).join(','));
  const sorted = M.buildView(m, view({ sort: { col: 5, dir: 'desc' } }));
  check(g, 'sorted: no bands or per-period TOTALs among the rows, the Period column instead', sorted.items.every((it) => it.type === 'data') && !sorted.showBands && sorted.showPeriodColumn && sorted.rows.length === 6);
  check(g, 'sorted: the TOTAL over both periods still under the list', sorted.footer?.type === 'sum' && near(sorted.footer.sums.get(5), 67001));
  const byPeriod = M.buildView(m, view({ groupBy: m.periodCol }));
  check(g, 'grouped by Period: one group per period with its subtotal, no Period column', byPeriod.groups.length === 2 && byPeriod.groups[1].label === 'Aug 2026' && near(byPeriod.groups[1].sums.get(5), 33500.5) && !byPeriod.showPeriodColumn);
  // August's subtotal is the larger, sorted both ways: the months stay Jul, Aug; the rows inside follow the sort.
  const mk = (rows) => ({ title: 'T', subtitle: 'S', headers: ['Name', 'Amount'], rows: [...rows, ['TOTAL', rows.reduce((s, r) => s + r[1], 0)]], fileNameBase: 'T' });
  const m2 = M.buildModel(M.mergeTables([mk([['A', 10], ['B', 20]]), mk([['C', 500], ['D', 1]])], ['07/2026', '08/2026']));
  const months = (dir) => M.buildView(m2, view({ groupBy: m2.periodCol, sort: { col: 1, dir } })).groups.map((x) => `${x.label}:${x.rows.map((r) => r.cells[0]).join('')}`).join(',');
  check(g, 'grouped by Period and sorted by a figure: months stay in calendar order', months('asc') === 'Jul 2026:AB,Aug 2026:DC' && months('desc') === 'Jul 2026:BA,Aug 2026:CD', `${months('asc')} / ${months('desc')}`);
  const sortPeriod = M.sortRows(m, m.data, { col: m.periodCol, dir: 'desc' });
  check(g, 'sorting by Period follows the bands, not the text', m.periods[sortPeriod[0].period].key === '08/2026');
  const exp = M.viewToReportTable(t, m, view({ sort: { col: 5, dir: 'asc' } }), new Set());
  check(g, 'export of a sorted merge: Period column first, no bands', exp.headers[0] === 'Period' && exp.rows[0][0] === 'Jul 2026' && exp.rows[0][6] === -2000 && !exp.rowKinds.includes('period') && exp.rowKinds.filter((k) => k === 'total').length === 1, JSON.stringify(exp.rows[0]));
  const exp2 = M.viewToReportTable(t, m, view({ filters: { [m.periodCol]: { type: 'values', values: ['07/2026'] } } }), new Set());
  const ek = exp2.rowKinds.join(',');
  check(g, 'export of a Period filter: July\'s band, rows, its recomputed TOTAL and the filtered TOTAL', ek === 'period,section,data,data,section,data,total,total' && exp2.rows[0][0] === '— 07/2026 —', ek);
  check(g, 'export strip names the filter', /Filter: Period is Jul 2026/.test(exp2.subtitle) && /Rows shown: 3 of 6/.test(exp2.subtitle), exp2.subtitle);
}

// ── 9. Groups ──────────────────────────────────────────────────────────────
{
  const g = 'groups';
  const sup = col(bm, 'Supplier Name');
  const tv = col(bm, 'Taxable Value');
  const v = M.buildView(bm, view({ groupBy: sup }));
  check(g, 'five groups, every row once', v.groups.length === 5 && v.groups.reduce((s, x) => s + x.rows.length, 0) === 3500);
  check(g, 'subtotals add up to the grand TOTAL', near(v.groups.reduce((s, x) => s + x.sums.get(tv), 0), bm.grandTotal.cells[tv]));
  const byTv = M.buildView(bm, view({ groupBy: sup, sort: { col: tv, dir: 'desc' } }));
  const order = byTv.groups.map((x) => x.sums.get(tv));
  check(g, 'sorted by a figure: groups by their subtotal, largest first', order.every((x, k) => k === 0 || order[k - 1] >= x), order.join(' > '));
  const inGroup = byTv.groups[0].rows.map((r) => r.cells[tv]);
  check(g, '… and rows within a group by the figure', inGroup.every((x, k) => k === 0 || inGroup[k - 1] >= x));
  const collapsed = M.buildView(bm, view({ groupBy: sup }), new Set(['Alpha Traders']));
  check(g, 'a collapsed group shows its heading only', collapsed.items.filter((it) => it.type === 'data').length === 2800 && collapsed.items[0].type === 'group' && collapsed.items[0].collapsed);
  const exp = M.viewToReportTable(big, bm, view({ groupBy: sup }), new Set());
  const counts = exp.rowKinds.reduce((a, k) => ({ ...a, [k]: (a[k] || 0) + 1 }), {});
  check(g, 'export: a heading, rows and a subtotal per group, then the TOTAL', counts.section === 5 && counts.subtotal === 5 && counts.data === 3500 && counts.total === 1 && exp.rowKinds[exp.rowKinds.length - 1] === 'total', JSON.stringify(counts));
  check(g, 'export: the grand TOTAL is the report\'s own when nothing is filtered', near(exp.rows[exp.rows.length - 1][tv], bm.grandTotal.cells[tv]));
}

// ── 10. Pages ──────────────────────────────────────────────────────────────
{
  const g = 'pages';
  const v = M.buildView(bm, view());
  const p0 = M.paginate(v.items, 0, 250);
  const plast = M.paginate(v.items, 99, 250);
  check(g, '3,500 rows in 14 pages of 250', p0.pages === 14 && p0.items.length === 250 && plast.page === 13 && plast.to === 3500);
  const sup = col(bm, 'Supplier Name');
  const gv = M.buildView(bm, view({ groupBy: sup }));
  const p3 = M.paginate(gv.items, 3, 250);
  check(g, 'a page opening inside a group repeats its heading, marked continued', p3.items[0].type === 'group' && p3.items[0].continued === true && p3.items.length === 251);
  const mm = M.buildModel(F.merged(M.mergeTables));
  const mv = M.buildView(mm, view());
  const mp = M.paginate(mv.items, 1, 3);
  check(g, 'a page opening inside a period repeats its band (and section)', mp.items[0].type === 'band' && mp.items[0].continued && mp.items[1].type === 'section', mp.items.map((it) => it.type).join(','));
}

// ── 11. Export of what is shown ────────────────────────────────────────────
{
  const g = 'export';
  const st = col(bm, 'Status');
  const tv = col(bm, 'Taxable Value');
  const state = view({ filters: { [st]: { type: 'values', values: ['Rejected in IMS'] }, [tv]: { type: 'number', min: 2000, max: null } }, sort: { col: tv, dir: 'desc' } });
  const hidden = new Set([col(bm, 'SGST'), col(bm, 'Sr.')]);
  const t = M.viewToReportTable(big, bm, state, hidden);
  const v = M.buildView(bm, state);
  check(g, 'hidden columns left out', t.headers.length === big.headers.length - 2 && !t.headers.includes('SGST') && !t.headers.includes('Sr.'), t.headers.join(','));
  check(g, 'rows: the filtered documents in the order shown, then the filtered TOTAL', t.rows.length === v.rows.length + 1 && t.rowKinds.filter((k) => k === 'data').length === v.rows.length && t.rows[t.rows.length - 1].includes('TOTAL (filtered)'));
  const tvPos = t.headers.indexOf('Taxable Value');
  const firstTwo = t.rows.slice(0, 2).map((r) => r[tvPos]);
  check(g, 'sort carried into the export', firstTwo[0] >= firstTwo[1], firstTwo.join(' >= '));
  check(g, 'TOTAL row adds up the rows exported', near(t.rows[t.rows.length - 1][tvPos], t.rows.slice(0, -1).reduce((s, r) => s + r[tvPos], 0)));
  check(g, 'TOTAL label moved off the hidden Sr. column', t.rows[t.rows.length - 1][0] === 'TOTAL (filtered)' || t.rows[t.rows.length - 1].includes('TOTAL (filtered)'));
  check(g, 'strip: filter, view, rows shown and hidden columns', /Filter: Taxable Value at least 2,000.00; Status is Rejected in IMS/.test(t.subtitle) && /View: sorted by Taxable Value, largest first/.test(t.subtitle) && /Rows shown: [\d,]+ of 3,500/.test(t.subtitle) && /Columns hidden: Sr\., SGST/.test(t.subtitle), t.subtitle);
  check(g, 'no "|" inside a strip value (it splits the subtitle)', t.subtitle.split('|').length === big.subtitle.split('|').length + 4, t.subtitle);
  check(g, 'file name marks the view', t.fileNameBase === 'GSTR2A_Portal_Big_filtered');
  check(g, 'stat band: rows shown and the shown figures', t.kpis[0].label === 'Rows shown' && t.kpis.some((k) => k.label === 'Taxable Value'), JSON.stringify(t.kpis));
  check(g, 'widths follow the columns', t.columnWidths.length === t.headers.length);
  const rec = F.reconciliation();
  const rm = M.buildModel(rec);
  const rt = M.viewToReportTable(rec, rm, view({ filters: { [col(rm, 'Status')]: { type: 'values', values: ['Figures differ'] } } }), new Set([col(rm, 'Doc Type')]));
  check(g, 'meta strip extended, groups re-spanned, tones kept', rt.meta.some((f) => f.label === 'Filter') && rt.columnGroups.reduce((s, x) => s + x.span, 0) === rt.headers.length && rt.columnGroups[0].span === 6 && rt.rowTones.filter(Boolean).every((x) => x === 'bad'), JSON.stringify(rt.columnGroups));
  check(g, 'PDF columns remapped to the kept columns', rt.pdfColumns.every((k) => k < rt.headers.length) && rt.pdfColumns.map((k) => rt.headers[k]).join() === 'Month,Supplier Name,Doc No.,Doc Date,2A Total Tax,2B Total Tax,Total Tax Difference (2B minus 2A),Status,Reason', rt.pdfColumns.map((k) => rt.headers[k]).join());
  const plainExport = M.viewToReportTable(big, bm, view(), new Set());
  check(g, 'nothing filtered: every document and the report\'s own TOTAL', plainExport.rows.length === 3501 && plainExport.rows[3500][1] === 'TOTAL' && near(plainExport.rows[3500][5], big.rows[3500][5]));
  const twoA = M.buildModel({
    headers: ['Supplier GSTIN', 'Supplier Name', 'Invoice No.', 'Invoice Date', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Supplier Filed On'],
    rows: [['24AAACA1111A1Z1', 'Alpha Traders', 'A-1', '05-07-2026', 1000, 0, 90, 90, '11-Aug-26'], ['', '', '', 'TOTAL', 1000, 0, 90, 90, '']],
  });
  check(g, 'portal 2A layout: TOTAL under Invoice Date is the grand TOTAL', twoA.grandTotal?.i === 1 && twoA.data.length === 1 && twoA.labelCol === 3);
  const twoAExp = M.viewToReportTable({ title: 'x', subtitle: '', headers: twoA.headers, rows: [], fileNameBase: 'x', columnWidths: [] }, twoA, view(), new Set([3]));
  check(g, 'TOTAL label carried to a shown column when its own is hidden', twoAExp.rows[1].includes('TOTAL'), JSON.stringify(twoAExp.rows[1]));
  // A recomputed label never lands in a date or figure column (they do not wrap in the PDF).
  const twoAT = { title: 'x', subtitle: '', headers: twoA.headers, rows: twoA.rows.map((r) => r.cells), fileNameBase: 'x', columnWidths: [] };
  const twoAF = M.viewToReportTable(twoAT, twoA, view({ search: 'alpha' }), new Set());
  check(g, 'portal 2A layout: "TOTAL (filtered)" under Invoice No., not Invoice Date', twoAF.rows[1][2] === 'TOTAL (filtered)' && twoAF.rows[1][3] === '', JSON.stringify(twoAF.rows[1]));
  const twoAG = M.viewToReportTable(twoAT, twoA, view({ groupBy: 1 }), new Set());
  const sub = twoAG.rows[twoAG.rowKinds.indexOf('subtotal')];
  check(g, 'a subtotal names its group under the grouped column', sub[1] === 'Subtotal: Alpha Traders' && sub[3] === '', JSON.stringify(sub));
  check(g, 'label position skips a hidden Invoice No. back to Supplier Name', M.labelPosition(twoA, [0, 1, 3, 4]) === 1);
  // A rate-wise shape whose only text column (Rate) is hidden: no label is ever
  // printed over a figure (the TOTAL keeps every sum; the label is dropped).
  const rw = { title: 'x', subtitle: '', headers: ['Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total Tax'], rows: [['5%', 1000, 0, 25, 25, 50], ['18%', 2000, 360, 0, 0, 360], ['TOTAL', 3000, 360, 25, 25, 410]], fileNameBase: 'x', columnWidths: [] };
  const rwm = M.buildModel(rw);
  check(g, 'no text column shown: no label position over a figure', M.labelPosition(rwm, [1, 2, 3, 4, 5]) === -1, String(M.labelPosition(rwm, [1, 2, 3, 4, 5])));
  const rwOwn = M.viewToReportTable(rw, rwm, view(), new Set([0]));
  const rwOwnTotal = rwOwn.rows[rwOwn.rowKinds.indexOf('total')];
  check(g, 'own TOTAL with Rate hidden keeps the taxable value', rwOwnTotal && rwOwnTotal[0] === 3000 && rwOwnTotal[4] === 410, JSON.stringify(rwOwnTotal));
  const rwF = M.viewToReportTable(rw, rwm, view({ search: '18' }), new Set([0]));
  const rwFTotal = rwF.rows[rwF.rowKinds.indexOf('total')];
  check(g, 'filtered TOTAL with Rate hidden keeps the taxable value', rwFTotal && rwFTotal[0] === 2000 && rwFTotal[1] === 360, JSON.stringify(rwFTotal));
}

// ── 11b. Rates written as text order by value ──────────────────────────────
{
  const g = 'rates';
  const rates = ['18%', '0.25%', '1%', '0%', '28%', '1.5%', '0.1%', '12%', '3%', '7.5%', '5%'];
  const t = { title: 'x', subtitle: '', headers: ['Rate', 'Taxable Value'], rows: rates.map((r, i) => [r, 100 + i]), fileNameBase: 'x', columnWidths: [] };
  const m = M.buildModel(t);
  const want = '0%,0.1%,0.25%,1%,1.5%,3%,5%,7.5%,12%,18%,28%';
  const sorted = M.sortRows(m, m.data, { col: 0, dir: 'asc' }).map((r) => r.cells[0]).join();
  check(g, 'ascending sort by value', sorted === want, sorted);
  const facets = M.facetValues(m, view(), 0).map((f) => f.key).join();
  check(g, 'facet list by value', facets === want, facets);
  const grouped = M.buildView(m, view({ groupBy: 0 })).groups.map((x) => x.label).join();
  check(g, 'groups by value', grouped === want, grouped);
}

// ── 11c. A view's own (custom) filters ─────────────────────────────────────
{
  const g = 'custom';
  const sup = col(bm, 'Supplier Name');
  const st = col(bm, 'Status');
  const tv = col(bm, 'Taxable Value');
  const rejected = { id: 'rej', label: 'Rejected in IMS only', test: (r) => r.cells[st] === 'Rejected in IMS' };
  const byValues = M.applyFilters(bm, view({ filters: { [st]: { type: 'values', values: ['Rejected in IMS'] } } }));
  const byCustom = M.applyFilters(bm, view({ custom: [rejected] }));
  check(g, 'a custom filter narrows the rows like the column filter it mirrors', byCustom.length === byValues.length && byCustom.length > 0, `${byCustom.length} vs ${byValues.length}`);
  const alphaRejected = big.rows.filter((r) => r[2] === 'Alpha Traders' && r[10] === 'Rejected in IMS').length;
  const both = M.applyFilters(bm, view({ filters: { [sup]: { type: 'values', values: ['Alpha Traders'] } }, custom: [rejected] }));
  check(g, 'ANDed with the column filters', both.length === alphaRejected, `${both.length} vs ${alphaRejected}`);
  const counts = facet(bm, view({ custom: [rejected] }), sup);
  check(g, 'value counts honour it (every column\'s, its own has none)', counts['Alpha Traders'] === alphaRejected, JSON.stringify(counts));
  check(g, 'it counts as filtered: a TOTAL recomputed over the rows shown', M.isFiltered(view({ custom: [rejected] })) && M.buildView(bm, view({ custom: [rejected] })).footer?.label === 'TOTAL (filtered)' && near(M.buildView(bm, view({ custom: [rejected] })).footer.sums.get(tv), sumCol(byCustom, tv)));
  check(g, 'no custom filter, or an empty list, is not filtered', !M.isFiltered(view()) && !M.isFiltered(view({ custom: [] })));
  const chips = M.activeFilters(bm, view({ search: 'alpha', custom: [rejected] }));
  check(g, 'a chip named by its label, after the search and the column filters', chips.length === 2 && chips[1].col === 'custom' && chips[1].id === 'rej' && chips[1].text === 'Rejected in IMS only', JSON.stringify(chips));
  const exp = M.viewToReportTable(big, bm, view({ custom: [rejected] }), new Set());
  check(g, 'the export strip names it and counts the rows it left', /Filter: Rejected in IMS only/.test(exp.subtitle) && exp.rowKinds.filter((k) => k === 'data').length === byCustom.length, exp.subtitle);
}

// ── 11d. Column groups over the columns shown, figure helpers ──────────────
{
  const g = 'kit';
  const rec = F.reconciliation();
  const rm = M.buildModel(rec);
  const spans = (gs) => (gs ? gs.map((x) => `${x.label}:${x.span}${x.tone ? `:${x.tone}` : ''}`).join('|') : 'null');
  const all = M.respanColumnGroups(rec, rm, rm.headers.map((_, c) => c));
  check(g, 'every column shown: the report\'s own groups', spans(all) === 'Document:7|GSTR-2A:2|GSTR-2B:2|Difference (2B minus 2A):1:bad|Reconciliation:2', spans(all));
  const some = M.respanColumnGroups(rec, rm, [1, 3, 5, 9, 10, 11, 12]);
  check(g, 'hidden columns leave their group, a group with none shown goes, tones kept', spans(some) === 'Document:3|GSTR-2B:2|Difference (2B minus 2A):1:bad|Reconciliation:1', spans(some));
  check(g, 'no groups, or groups not spanning the headers: null', M.respanColumnGroups(big, bm, [0, 1]) === null && M.respanColumnGroups({ columnGroups: [{ label: 'x', span: 2 }] }, rm, [0, 1]) === null);
  const mt = F.merged(M.mergeTables);
  const mm = M.buildModel(mt);
  const mg = M.respanColumnGroups({ columnGroups: [{ label: 'Who', span: 3 }, { label: 'Figures', span: mm.headers.length - 3 }] }, mm, [mm.periodCol, 0, 1, 5]);
  check(g, 'the Period column sits under a blank group', spans(mg) === ':1|Who:2|Figures:1', spans(mg));
  const names = rm.columns.map((c) => c.name);
  check(g, 'a short label shared by two columns names them by their full header', names[8] === '2A Total Tax' && names[10] === '2B Total Tax' && names[11] === 'Total Tax Difference (2B minus 2A)' && names[3] === 'Supplier name' && rm.columns[11].label === 'Total tax', names.join(' | '));
  check(g, '… so a chip says which', M.describeFilter(rm, 11, { type: 'number', min: 1, max: null, nonZero: false }) === 'Total Tax Difference (2B minus 2A) at least 1.00', M.describeFilter(rm, 11, { type: 'number', min: 1, max: null }));
  check(g, 'unique labels name the column as shown', bm.columns.every((c) => c.name === c.label));
  const tv = col(bm, 'Taxable Value');
  check(g, 'figure columns and their house style', M.isFigureColumn(bm, tv) && !M.isFigureColumn(bm, col(bm, 'Supplier Name')) && M.figureText(bm, tv, 123456.5) === '1,23,456.50' && M.figureText(bm, tv, -5) === '(5.00)', M.figureText(bm, tv, 123456.5));
}

// ── 11e. Date-time stamps (an upload log's Date/Time) order by their moment ─
{
  const g = 'stamps';
  const t = {
    headers: ['Version', 'Date/Time', 'Reason'],
    rows: [
      [1, '15/8/2026, 10:23:45 am', 'GSTIN invalid'],
      [2, '2/9/2026, 9:05:00 am', 'Duplicate invoice'],
      [3, '15/8/2026, 1:02:03 pm', 'Rate mismatch'],
      [4, '—', 'No date'],
      [5, '15/8/2026, 12:10:00 am', 'Past midnight'],
    ],
  };
  const m = M.buildModel(t);
  const dt = col(m, 'Date/Time');
  check(g, 'the column stays text (the time is part of what it says)', m.columns[dt].kind === 'text', m.columns[dt].kind);
  const asc = M.sortRows(m, m.data, { col: dt, dir: 'asc' }).map((r) => r.cells[0]).join(',');
  check(g, 'oldest first: 12:10 am, 10:23 am, 1:02 pm on 15 Aug, then 2 Sep, blank last', asc === '5,1,3,2,4', asc);
  const desc = M.sortRows(m, m.data, { col: dt, dir: 'desc' }).map((r) => r.cells[0]).join(',');
  check(g, 'newest first, blank still last', desc === '2,3,1,5,4', desc);
  const keys = M.facetValues(m, view(), dt).map((v) => v.key).filter((k) => k !== '—');
  check(g, 'its value list runs in time order', keys.join(' | ') === '15/8/2026, 12:10:00 am | 15/8/2026, 10:23:45 am | 15/8/2026, 1:02:03 pm | 2/9/2026, 9:05:00 am', keys.join(' | '));
  check(g, 'stampOf reads am / pm and rejects a plain date', M.stampOf('1/1/2026, 12:00:00 pm') === Date.UTC(2026, 0, 1, 12) && M.stampOf('01/01/2026') === null);
  const said = M.describeSort(m, { col: dt, dir: 'desc' });
  check(g, 'the export strip says "newest first", not "Z to A"', said === 'sorted by Date/Time, newest first', said);
  check(g, 'a text column that is not all stamps still sorts A to Z', M.describeSort(m, { col: col(m, 'Reason'), dir: 'asc' }) === 'sorted by Reason, A to Z');
}

// ── 12. Speed ──────────────────────────────────────────────────────────────
{
  const g = 'speed';
  const t = F.big(5000);
  const t0 = performance.now();
  const m = M.buildModel(t);
  const t1 = performance.now();
  const sup = col(m, 'Supplier Name');
  const st = col(m, 'Status');
  const state = view({ search: 'traders', filters: { [st]: { type: 'values', values: ['Matched'] } }, sort: { col: 5, dir: 'desc' } });
  for (let k = 0; k < 10; k++) M.buildView(m, state);
  const t2 = performance.now();
  for (let k = 0; k < 10; k++) M.facetValues(m, state, sup);
  const t3 = performance.now();
  M.buildView(m, view({ groupBy: sup, sort: { col: 5, dir: 'desc' } }));
  const t4 = performance.now();
  check(g, `5,000 rows: model ${Math.round(t1 - t0)} ms (< 400)`, t1 - t0 < 400);
  check(g, `filter + sort ${((t2 - t1) / 10).toFixed(1)} ms per pass (< 60)`, (t2 - t1) / 10 < 60);
  check(g, `value counts ${((t3 - t2) / 10).toFixed(1)} ms per column (< 40)`, (t3 - t2) / 10 < 40);
  check(g, `grouping ${Math.round(t4 - t3)} ms (< 80)`, t4 - t3 < 80);
}

// ── Report ─────────────────────────────────────────────────────────────────
const width = Math.max(...results.map((r) => r.group.length));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.group.padEnd(width)}  ${r.name}${r.ok ? '' : `\n      ${r.info}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
