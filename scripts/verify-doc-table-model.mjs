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
// shown; date-time stamps ordered by their moment; a report read top to bottom
// (sorted within its sections, its own TOTAL kept as printed and nothing added
// up, listed after a grouped or sorted view); a period of a merge that could
// not be built (named in every mode, never counted); a helper column left out
// of the search; balances never added across the periods of a merge; the shape
// a merge takes; the hook itself under a stand-in React (its state keeps its
// identity across a table refresh); and speed at 5,000 rows. Prints pass /
// fail; exits 1 on any failure.
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
      export { mergeTables, buildForPeriods } from './src/lib/reportPeriodMerge';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [alias], logLevel: 'error',
});
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const F = await import(pathToFileURL(path.join(root, 'scripts', 'fixtures', 'reportExportFixtures.mjs')).href);

// The hook (useTableKit) under a stand-in React: hooks kept in slots between
// renders, a render repeated while it set state, no effects. Enough to see
// what a re-render with a new table keeps; the exports and toasts are no-ops.
const STUBS = {
  react: `
    let slots = []; let cursor = 0; let dirty = false;
    export const __reset = () => { slots = []; };
    export function __render(fn) {
      for (let n = 0; n < 10; n++) { dirty = false; cursor = 0; const out = fn(); if (!dirty) return out; }
      throw new Error('render loop');
    }
    const same = (a, b) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
    export function useState(init) {
      const k = cursor++;
      if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init;
      return [slots[k], (v) => { const next = typeof v === 'function' ? v(slots[k]) : v; if (!Object.is(next, slots[k])) { slots[k] = next; dirty = true; } }];
    }
    export function useRef(init) { const k = cursor++; if (!(k in slots)) slots[k] = { current: init }; return slots[k]; }
    export function useMemo(fn, deps) {
      const k = cursor++;
      if (slots[k] && same(slots[k].deps, deps)) return slots[k].value;
      slots[k] = { value: fn(), deps };
      return slots[k].value;
    }
    export const useCallback = (fn, deps) => useMemo(() => fn, deps);
    export const useEffect = () => {};
  `,
  sonner: 'export const toast = { success() {}, error() {} };',
  '@/utils/allClientsReports': 'export const renderReportToExcel = async () => {};',
  '@/utils/closingBalanceReportsPdf': 'export const renderReportToPdf = async () => {};',
};
const stubsOf = (filter) => ({
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  },
});
const hookOut = await build({
  stdin: { contents: `export { useTableKit } from './src/components/reports/views/tableKit/useTableKit'; export { __render, __reset } from 'react';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
  plugins: [stubsOf(/^(react|sonner|@\/utils\/allClientsReports|@\/utils\/closingBalanceReportsPdf)$/), alias],
});
const H = await import('data:text/javascript;base64,' + Buffer.from(hookOut.outputFiles[0].text).toString('base64'));

// The kit's table drawn by the real React to static HTML (no effects run): what
// a reviewer sees above and in the rows. `search` is typed in before the HTML.
const ssrOut = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { useTableKit } from './src/components/reports/views/tableKit/useTableKit';
      import { TableKitTable } from './src/components/reports/views/tableKit/TableKitTable';
      export const renderKit = (table, options, search = '') => {
        const View = () => {
          const kit = useTableKit(table, options);
          if (search && kit.state.search !== search) kit.setSearch(search);
          return React.createElement(TableKitTable, { kit });
        };
        return renderToStaticMarkup(React.createElement(View));
      };
    `,
    resolveDir: root, loader: 'tsx',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, jsx: 'automatic', logLevel: 'error',
  plugins: [stubsOf(/^(sonner|@\/utils\/allClientsReports|@\/utils\/closingBalanceReportsPdf)$/), alias],
  define: { 'process.env.NODE_ENV': '"production"' },
  // React's server build requires Node's own modules; a data: URL cannot resolve them, the root can.
  banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
});
const R = await import('data:text/javascript;base64,' + Buffer.from(ssrOut.outputFiles[0].text).toString('base64'));

// ── Harness ─────────────────────────────────────────────────────────────────
const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
// A section that throws (a function missing, a field undefined) fails, it does not stop the run.
const section = async (group, fn) => {
  try { await fn(group); } catch (e) { check(group, 'runs without throwing', false, e?.stack ?? e); }
};
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

// ── 11f. A report read top to bottom (a return, a working paper) ───────────
{
  const g = 'top-down';
  // Sections, a spacer and the return's own TOTAL, as the filed-return view lays them out.
  const ret = {
    title: 'Return', subtitle: 'Client: X', fileNameBase: 'Return_X',
    headers: ['Table', 'Description', 'IGST', 'CGST'],
    rows: [
      ['Outward supplies', '', '', ''],
      ['3.1(a)', 'Taxable', 100, 50],
      ['3.1(b)', 'Zero rated', 300, 0],
      ['3.1(d)', 'Reverse charge', 200, 10],
      ['', '', '', ''],
      ['Eligible ITC', '', '', ''],
      ['4(A)', 'Available', 500, 40],
      ['4(B)', 'Reversed', 0, 5],
      ['', 'TOTAL', 1100, 105],
    ],
    rowKinds: ['section', 'data', 'data', 'data', 'blank', 'section', 'data', 'data', 'total'],
  };
  const base = M.buildModel(ret);
  const rm = { ...base, sortWithinSections: true };
  const igst = col(rm, 'IGST');
  const cgst = col(rm, 'CGST');
  const seq = (v) => v.items.map((it) => (it.type === 'data' ? it.row.cells[0] : it.type === 'section' ? `[${it.label}]` : it.type)).join(' ');
  const sorted = M.buildView(rm, view({ sort: { col: igst, dir: 'desc' } }));
  check(g, 'sorted within sections: each section\'s rows reordered under its own heading', seq(sorted) === '[Outward supplies] 3.1(b) 3.1(d) 3.1(a) blank [Eligible ITC] 4(A) 4(B)', seq(sorted));
  check(g, '… the rows shown in that order, and the view says so', sorted.rows.map((r) => r.cells[0]).join(' ') === '3.1(b) 3.1(d) 3.1(a) 4(A) 4(B)' && sorted.sortedWithinSections === true, sorted.rows.map((r) => r.cells[0]).join(' '));
  const flat = M.buildView(base, view({ sort: { col: igst, dir: 'desc' } }));
  check(g, 'without the option a sort runs over every row, headings left out', seq(flat) === '4(A) 3.1(b) 3.1(d) 3.1(a) 4(B)' && !flat.sortedWithinSections, seq(flat));
  const both = M.buildView(rm, view({ sort: { col: igst, dir: 'asc' }, filters: { [cgst]: { type: 'number', min: 1, max: null } } }));
  check(g, 'filtered and sorted: headings kept for sections with rows, no spacer', seq(both) === '[Outward supplies] 3.1(a) 3.1(d) [Eligible ITC] 4(B) 4(A)', seq(both));
  check(g, 'grouping still wins over sections', M.buildView(rm, view({ sort: { col: igst, dir: 'desc' }, groupBy: 0 })).items.every((it) => it.type !== 'section'));
  const exp = M.viewToReportTable(ret, rm, view({ sort: { col: igst, dir: 'desc' } }), new Set());
  check(g, 'the export keeps the headings and says the sort ran within each section', exp.rowKinds.filter((k) => k === 'section').length === 2 && /View: sorted by IGST, largest first within each section/.test(exp.subtitle), exp.subtitle);

  // sums: false — the return's own TOTAL stands under a filter; nothing is added up.
  const km = { ...rm, keepReportTotals: true, summable: [], columns: rm.columns.map((c) => ({ ...c, summable: false })) };
  const kf = M.buildView(km, view({ filters: { [cgst]: { type: 'number', min: 20, max: null } } }));
  check(g, 'filtered: the report\'s own TOTAL stays pinned, nothing recomputed', kf.footer?.type === 'total' && kf.footer.row.cells[2] === 1100 && !kf.items.some((it) => it.type === 'sum'), JSON.stringify(kf.footer));
  const recomputed = M.buildView(rm, view({ filters: { [cgst]: { type: 'number', min: 20, max: null } } }));
  check(g, '… where the default recomputes it over the rows shown', recomputed.footer?.type === 'sum' && recomputed.footer.sums.get(igst) === 600, JSON.stringify(recomputed.footer));
  const kg = M.buildView(km, view({ groupBy: col(km, 'Description') }));
  check(g, 'groups carry no subtotal', kg.groups?.length === 5 && kg.groups.every((x) => x.sums.size === 0) && kg.items.filter((it) => it.type === 'group').every((it) => it.sums.size === 0));
  const kx = M.viewToReportTable(ret, km, view({ filters: { [cgst]: { type: 'number', min: 20, max: null } }, groupBy: col(km, 'Description') }), new Set());
  check(g, 'the export: no subtotal rows, the TOTAL as printed, the strip says so', !kx.rowKinds.includes('subtotal') && kx.rowKinds[kx.rowKinds.length - 1] === 'total' && kx.rows[kx.rows.length - 1][2] === 1100 && /Totals: as printed for the whole report/.test(kx.subtitle), kx.subtitle);
  const unf = M.viewToReportTable(ret, km, view(), new Set());
  check(g, '… and unfiltered it says nothing about totals', !/Totals:/.test(unf.subtitle), unf.subtitle);

  // Two periods of a working paper: each period's result stays in place.
  const wp = (n) => ({
    title: 'Working paper', subtitle: 'Client: X', fileNameBase: 'WP', headers: ['Step', 'Item', 'Amount'],
    rows: [['1', 'Days late', n], ['2', 'Interest', n * 10], ['Result', 'TOTAL (Interest + Late Fee)', n * 10 + 5]],
    rowKinds: ['data', 'data', 'total'],
  });
  const mt = M.mergeTables([wp(1), wp(0)], ['06/2025', '07/2025']);
  const mbase = M.buildModel(mt);
  const mk = { ...mbase, keepReportTotals: true, sortWithinSections: true, summable: [] };
  const amt = col(mk, 'Amount');
  const nz = M.buildView(mk, view({ filters: { [amt]: { type: 'number', min: null, max: null, nonZero: true } } }));
  const totals = nz.items.filter((it) => it.type === 'total').map((it) => it.row.cells[2]);
  check(g, 'merged, filtered: a period\'s own result kept in place; a period left empty shows none', totals.join(',') === '15' && nz.items.filter((it) => it.type === 'band').length === 1 && !nz.footer, JSON.stringify(totals));
  const ms = M.buildView(mk, view({ sort: { col: amt, dir: 'desc' } }));
  check(g, 'merged, sorted: still in period bands, no Period column', ms.showBands && !ms.showPeriodColumn && ms.items.filter((it) => it.type === 'band').length === 2 && ms.sortedWithinSections, JSON.stringify({ b: ms.showBands, p: ms.showPeriodColumn }));
}

// ── 11g. A period of a merge that could not be built ───────────────────────
// buildForPeriods writes it as its band and one "Not built: <reason>" line. A
// grouped, sorted or filtered view does not show that line, so the model names
// the period (failedPeriods) for every mode, and nothing counts it as built.
await section('not built', async (g) => {
  const roster = (m) => ({
    title: 'Interest Scrutiny', subtitle: `Period: ${m}`, meta: [{ label: 'Period', value: m }],
    headers: ['Client', 'GSTIN', 'Days Late', 'Total Interest'],
    rows: [['A Ltd', '24AAACA1111A1Z1', 5, 10], ['B Ltd', '24AAACB2222B1Z2', 3, 26], ['TOTAL', '', '', 36]],
    fileNameBase: 'Interest_Scrutiny', columnWidths: [20, 18, 10, 14],
  });
  const report = { needs: 'month', build: async ({ month }) => { if (month === '05/2026') throw new Error('fetch failed'); return roster(month); } };
  const t = await M.buildForPeriods(report, ['04/2026', '05/2026', '06/2026'], 'c');
  const m = M.buildModel(t);
  check(g, 'the failed period named with its reason', JSON.stringify(m.failedPeriods) === JSON.stringify([{ key: '05/2026', label: 'May 2026', reason: 'fetch failed' }]), JSON.stringify(m.failedPeriods));
  check(g, 'its "Not built" line is never a document', m.data.length === 4 && m.data.every((r) => !/^Not built/.test(String(r.cells[0]))), m.data.length);
  const amt = col(m, 'Total Interest');
  const plain = M.buildView(m, view());
  check(g, 'the footer counts only the periods built: TOTAL (2 periods)', plain.footer?.label === 'TOTAL (2 periods)' && near(plain.footer.sums.get(amt), 72), plain.footer?.label);
  // The exceptions view opens a merge sorted by the amount and grouped by Period.
  const st = view({ sort: { col: amt, dir: 'desc' }, groupBy: m.periodCol });
  const grouped = M.buildView(m, st);
  check(g, 'grouped and sorted: no May group (it has no rows), the footer still says 2 periods', grouped.groups.map((x) => x.label).join() === 'Apr 2026,Jun 2026' && grouped.footer?.label === 'TOTAL (2 periods)', grouped.footer?.label);
  const ex = M.viewToReportTable(t, m, st, new Set());
  check(g, 'the grouped export names the period not built, in the strip and the meta', /Not built: May 2026 \(fetch failed\)/.test(ex.subtitle) && ex.meta?.some((f) => f.label === 'Not built' && /May 2026/.test(f.value)), ex.subtitle);
  const searched = M.viewToReportTable(t, m, view({ search: 'a ltd' }), new Set());
  check(g, '… and a filtered one', /Not built: May 2026/.test(searched.subtitle), searched.subtitle);
  const allBuilt = M.viewToReportTable(F.merged(M.mergeTables), M.buildModel(F.merged(M.mergeTables)), view(), new Set());
  check(g, 'every period built: nothing said', !/Not built/.test(allBuilt.subtitle) && M.buildModel(F.merged(M.mergeTables)).failedPeriods.length === 0, allBuilt.subtitle);
  // A two-column report (the interest calculator answers a month with no 3B so):
  // its "Not built" line would read as a document by its shape alone.
  const narrow = { title: 'Calc', subtitle: '', headers: ['Item', 'Value'], rows: [], fileNameBase: 'Calc', columnWidths: [30, 14] };
  const t2 = await M.buildForPeriods({ needs: 'client+month', build: async ({ month }) => { if (month === '05/2026') throw new Error('no 3B'); return narrow; } }, ['04/2026', '05/2026'], 'c');
  const m2 = M.buildModel(t2);
  check(g, 'a two-column report: the line is not a document, the period is named', m2.data.length === 0 && m2.failedPeriods.length === 1 && m2.failedPeriods[0].reason === 'no 3B', `${m2.data.length} / ${JSON.stringify(m2.failedPeriods)}`);
  const own = M.buildModel({ headers: ['Client', 'Amount'], rows: [], failedReason: 'query timed out' });
  check(g, 'a table\'s own failedReason counts too', own.failedPeriods.length === 1 && own.failedPeriods[0].reason === 'query timed out', JSON.stringify(own.failedPeriods));
});

// ── 11h. The report's own TOTALs under grouping (sums: false) ──────────────
// A return or working paper adds nothing up, so grouped or sorted across the
// report each period's own TOTAL / Result is listed after the rows, as printed.
await section('own totals kept', async (g) => {
  const wp = (n) => ({
    title: 'Working paper', subtitle: 'Client: X', fileNameBase: 'WP', headers: ['Step', 'Item', 'Amount'],
    rows: [['1', 'Days late', n], ['2', 'Interest', n * 10], ['Result', 'TOTAL (Interest + Late Fee)', n * 10 + 5]],
    rowKinds: ['data', 'data', 'total'],
  });
  const keep = (m) => ({ ...m, keepReportTotals: true, sortWithinSections: true, summable: [], columns: m.columns.map((c) => ({ ...c, summable: false })) });
  const mt = M.mergeTables([wp(1), wp(2)], ['06/2025', '07/2025']);
  const mk = keep(M.buildModel(mt));
  const item = col(mk, 'Item');
  const amt = col(mk, 'Amount');
  const seq = (v) => v.items.map((it) => (it.type === 'band' ? `B:${it.key}${it.totalsOnly ? '*' : ''}` : it.type === 'total' ? `T:${it.row.cells[amt]}` : it.type[0])).join(' ');
  const gv = M.buildView(mk, view({ groupBy: item }));
  check(g, 'merged, grouped: each period\'s Result after the groups, under its band', seq(gv).endsWith('B:06/2025* T:15 B:07/2025* T:25') && gv.reportTotals?.length === 2, seq(gv));
  const gx = M.viewToReportTable(mt, mk, view({ groupBy: item }), new Set());
  const tot = gx.rows.filter((_, k) => gx.rowKinds[k] === 'total').map((r) => r[gx.headers.indexOf('Amount')]);
  check(g, '… and in the export, the strip saying they are the report\'s own', tot.join() === '15,25' && gx.rowKinds.filter((k) => k === 'period').length === 2 && /Totals: the report's own, as printed for each period, listed after the rows/.test(gx.subtitle), `${tot.join()} | ${gx.subtitle}`);
  const nz = M.buildView(mk, view({ groupBy: item, filters: { [amt]: { type: 'number', min: 20, max: null } } }));
  check(g, 'grouped and filtered: a period the filter left empty shows none', seq(nz).endsWith('B:07/2025* T:25') && !seq(nz).includes('T:15'), seq(nz));
  // A merged return sorted across its rows (no sections to sort within).
  const ret = (n) => ({ title: 'GSTR-1 Summary', subtitle: 'x', fileNameBase: 'R', headers: ['Doc Type', 'Taxable Value', 'IGST'], rows: [['B2B', 100 * n, 18 * n], ['B2CL', 50 * n, 9 * n], ['TOTAL', 150 * n, 27 * n]] });
  const rt = M.mergeTables([ret(1), ret(2)], ['04/2026', '05/2026']);
  const rk = { ...keep(M.buildModel(rt)), sortWithinSections: false };
  const sv = M.buildView(rk, view({ sort: { col: 1, dir: 'desc' } }));
  const sk = sv.items.map((it) => it.type).join(',');
  check(g, 'merged return, sorted: both periods\' TOTALs after the rows', sk === 'data,data,data,data,band,total,band,total' && !sv.footer, sk);
  // A single period keeps its grand TOTAL pinned, grouped or not.
  const one = keep(M.buildModel(ret(1)));
  check(g, 'single period, grouped: the grand TOTAL stays pinned, nothing listed twice', M.buildView(one, view({ groupBy: 0 })).footer?.row?.cells[1] === 150 && !M.buildView(one, view({ groupBy: 0 })).reportTotals);
  // A single period whose last TOTAL has a line after it (a PDF link): no grand TOTAL to pin.
  const linked = keep(M.buildModel({ headers: ['Table', 'IGST', 'CGST'], rows: [['3.1(a)', 10, 5], ['3.1(b)', 20, 0], ['TOTAL', 30, 5], ['Filed Return PDF', 'https://x/y.pdf', '']] }));
  const lv = M.buildView(linked, view({ groupBy: 0 }));
  check(g, '… with no grand TOTAL, its TOTAL is listed after the groups', linked.grandTotal === null && lv.reportTotals?.length === 1 && lv.items[lv.items.length - 1].type === 'total', lv.items.map((it) => it.type).join());
  // The default kit (sums on) is unchanged: a TOTAL over both periods.
  const dm = M.buildModel(rt);
  check(g, 'sums on: unchanged, the TOTAL over both periods and no list', M.buildView(dm, view({ groupBy: 0 })).footer?.label === 'TOTAL (2 periods)' && !M.buildView(dm, view({ groupBy: 0 })).reportTotals);
});

// ── 11i. A helper column left out of the search ────────────────────────────
// The annual trend adds a hidden Quarter ("FY 2026-27 Q1 (Apr to Jun)") to its
// rows: searched, "Jun 2026" would find April and May by it.
await section('searchable', async (g) => {
  const months = ['Apr', 'May', 'Jun', 'Jul'];
  const t = {
    title: 'Credit And Liability Statement', subtitle: 'x', fileNameBase: 'C', headers: ['Month', 'Total Liability', 'Quarter'],
    rows: months.map((mo, k) => [`${mo} 2026`, 1000 * (k + 1), k < 3 ? 'FY 2026-27 Q1 (Apr to Jun)' : 'FY 2026-27 Q2 (Jul to Sep)']),
  };
  const m = M.buildModel(t);
  const found = (model, q) => M.applyFilters(model, view({ search: q })).map((r) => r.cells[0]).join();
  const s = M.withSearchable(m, [0, 1]);
  check(g, 'with Quarter left out, "Jun 2026" finds June only', found(s, 'Jun 2026') === 'Jun 2026' && found(m, 'Jun 2026') === 'Apr 2026,May 2026,Jun 2026', `${found(s, 'Jun 2026')} (all columns: ${found(m, 'Jun 2026')})`);
  check(g, '… figures still found as printed, the column\'s own filter untouched', found(s, '3,000.00') === 'Jun 2026' && M.applyFilters(s, view({ filters: { 2: { type: 'contains', text: 'Q2' } } })).length === 1);
  const mt = M.buildModel(F.merged(M.mergeTables));
  const noPeriod = M.withSearchable(mt, mt.headers.map((_, c) => c));
  check(g, 'a merge\'s Period is searched unless left out', M.applyFilters(mt, view({ search: '08/2026' })).length === 3 && M.applyFilters(noPeriod, view({ search: '08/2026' })).length === 0);
  check(g, 'the rows and the grand TOTAL are the same rows', s.data.length === m.data.length && s.grandTotal === m.grandTotal && s.rows.filter((r) => r.kind !== 'data').every((r, k) => r === m.rows.filter((x) => x.kind !== 'data')[k]));
});

// ── 11j. Balances never added across the periods of a merge ────────────────
// A closing-balance roster (Suspended / Credit Ledger, all clients) over three
// months: each month-end lists the same balances, so their sum is meaningless.
await section('balances', async (g) => {
  const sus = (m, alpha) => ({
    title: 'Suspended Ledger — Closing Balance — All Clients', subtitle: `Month: ${m}`, fileNameBase: 'Sus',
    headers: ['Sr No.', 'Client Name', 'GSTIN', 'CGST', 'SGST', 'IGST', 'TOTAL'],
    rows: [[1, 'Alpha Traders', '24AAACA1111A1Z1', alpha, alpha, 0, 2 * alpha], [2, 'Beta Foods', '24AAACB2222B1Z2', 500, 500, 0, 1000]],
    columnWidths: [6, 35, 18, 16, 16, 16, 16],
  });
  // Picked out of calendar order: the latest is June, though its band is not last.
  const t = M.mergeTables([sus('Apr 2026', 1000), sus('Jun 2026', 1200), sus('May 2026', 1000)], ['04/2026', '06/2026', '05/2026']);
  const base = M.buildModel(t);
  const m = { ...base, acrossPeriods: 'latest' };
  const TOT = col(m, 'TOTAL');
  const tile = (model, st) => { const r = M.columnTotals(model, M.buildView(model, st)); return { asAt: r.asAt, ...Object.fromEntries(r.totals.map((x) => [model.headers[x.col], [x.total, x.shown]])) }; };
  const plain = tile(m, view());
  check(g, 'tiles: the latest period\'s balances, as at June', plain.asAt === 'Jun 2026' && plain.TOTAL[0] === 3400 && plain.CGST[0] === 1700 && plain.TOTAL[1] === null, JSON.stringify(plain));
  check(g, '… where by default they are added across the months', tile(base, view()).TOTAL[0] === 9400 && tile(base, view()).asAt === null, JSON.stringify(tile(base, view())));
  const alpha = M.buildView(m, view({ search: 'alpha' }));
  const at = tile(m, view({ search: 'alpha' }));
  check(g, 'searched: the latest month\'s rows shown, no cross-period TOTAL (filtered)', at.TOTAL[1] === 2400 && at.TOTAL[0] === 3400 && alpha.footer === null, `${JSON.stringify(at)} ${JSON.stringify(alpha.footer)}`);
  const apr = M.buildView(m, view({ filters: { [m.periodCol]: { type: 'values', values: ['04/2026'] } } }));
  check(g, 'one period shown: its own TOTAL, as at that period', apr.items.some((it) => it.type === 'band') && tile(m, view({ filters: { [m.periodCol]: { type: 'values', values: ['04/2026'] } } })).asAt === 'Apr 2026' && apr.footer?.label === 'TOTAL (04/2026, filtered)' && apr.footer.sums.get(TOT) === 3000, JSON.stringify(apr.footer));
  const byClient = M.buildView(m, view({ groupBy: col(m, 'Client Name') }));
  check(g, 'grouped by client: no subtotal (a balance added to itself)', byClient.groups.every((x) => x.sums.size === 0), JSON.stringify(byClient.groups.map((x) => [...x.sums])));
  const byPeriod = M.buildView(m, view({ groupBy: m.periodCol }));
  check(g, 'grouped by Period: each month\'s subtotal across clients kept', byPeriod.groups.map((x) => x.sums.get(TOT)).join() === '3000,3400,3000', byPeriod.groups.map((x) => x.sums.get(TOT)).join());
  const ex = M.viewToReportTable(t, m, view({ groupBy: col(m, 'Client Name') }), new Set());
  check(g, 'the export: no subtotal, tiles and strip as at June', !ex.rowKinds.includes('subtotal') && /Totals: as at Jun 2026/.test(ex.subtitle) && ex.kpis.some((k) => k.label === 'TOTAL as at Jun 2026' && k.value === '3,400.00'), `${ex.subtitle} ${JSON.stringify(ex.kpis)}`);
  const withTotals = { ...M.buildModel(F.merged(M.mergeTables)), acrossPeriods: 'latest' };
  check(g, 'a merge with its own TOTALs: no TOTAL (n periods)', M.buildView(withTotals, view()).footer === null && M.buildView(M.buildModel(F.merged(M.mergeTables)), view()).footer?.label === 'TOTAL (2 periods)');
  const single = M.buildModel(sus('Jun 2026', 1200));
  const one = { ...single, acrossPeriods: 'latest' };
  check(g, 'unmerged: unchanged (balances across clients at one date add up)', JSON.stringify(tile(one, view({ search: 'alpha' }))) === JSON.stringify(tile(single, view({ search: 'alpha' }))) && tile(one, view()).asAt === null && M.buildView(one, view({ search: 'alpha' })).footer?.label === 'TOTAL (filtered)');
});

// ── 11k. The shape a merge takes ───────────────────────────────────────────
// A builder may answer an empty month with fewer columns; the merge takes its
// headers from the first period built with rows, so no row is cut short.
await section('merge shape', async (g) => {
  const empty = { title: 'Calc', subtitle: 'Apr', headers: ['Item', 'Value'], rows: [], fileNameBase: 'Calc', columnWidths: [34, 20] };
  const full = { title: 'Calc', subtitle: 'Jun', headers: ['Item', 'IGST', 'CGST', 'SGST'], rows: [['Interest by head', 30, 20, 20], ['TOTAL', 30, 20, 20]], fileNameBase: 'Calc', columnWidths: [34, 14, 14, 14] };
  const t = M.mergeTables([empty, empty, full], ['04/2026', '05/2026', '06/2026']);
  check(g, 'headers and widths from the first period with rows', t.headers.join() === 'Item,IGST,CGST,SGST' && t.columnWidths.join() === '34,14,14,14', t.headers.join());
  check(g, 'with no rows anywhere, the first built', M.mergeTables([empty, { ...empty, headers: ['A', 'B', 'C'] }], ['04/2026', '05/2026']).headers.join() === 'Item,Value');
  const report = { needs: 'client+month', build: async ({ month }) => (month === '05/2026' ? Promise.reject(new Error('timeout')) : month === '04/2026' ? empty : full) };
  const b = await M.buildForPeriods(report, ['04/2026', '05/2026', '06/2026'], 'c');
  const line = b.rows.find((r) => /^Not built/.test(String(r[0])));
  check(g, 'a failed period\'s line is as wide as the merge', b.headers.length === 4 && line?.length === 4, JSON.stringify(line));
});

// ── 11l. The hook: what a re-render with a new table keeps ─────────────────
await section('hook', async (g) => {
  const t1 = {
    title: 'Notices', subtitle: 'x', fileNameBase: 'N', headers: ['Reference', 'Amount'], columnWidths: [20, 14],
    rows: [['N-1', 100], ['N-2', 200], ['N-3', 300]],
    rowFlags: [{ overdue: true, dueIn7: false }, { overdue: false, dueIn7: false }, { overdue: true, dueIn7: false }],
  };
  let table = t1;
  let opts = { resetKey: 'notices' };
  const use = () => H.useTableKit(table, opts);
  H.__reset();
  let kit = H.__render(use);
  kit.setCustomFilter('overdue', { label: 'Overdue', test: (r, tb) => !!tb.rowFlags?.[r.i]?.overdue });
  kit = H.__render(use);
  const before = kit.state;
  check(g, 'a quick filter narrows the rows', kit.view.rows.map((r) => r.cells[0]).join() === 'N-1,N-3');
  // An inline edit (or a Pull refresh): the same report, a new table object.
  table = { ...t1, rows: t1.rows.map((r) => [...r]), rowFlags: [{ overdue: true, dueIn7: false }, { overdue: true, dueIn7: false }, { overdue: false, dueIn7: false }] };
  kit = H.__render(use);
  check(g, 'a new table keeps the state\'s identity (no jump back to the top)', kit.state === before);
  check(g, '… and the quick filter reads the new table', kit.view.rows.map((r) => r.cells[0]).join() === 'N-1,N-2', kit.view.rows.map((r) => r.cells[0]).join());
  kit.setSearch('n-2');
  kit = H.__render(use);
  check(g, 'a choice of the reviewer\'s does change it', kit.state !== before && kit.view.rows.length === 1);

  // searchable and acrossPeriods through the hook; the model kept across renders.
  const months = ['Apr', 'May', 'Jun'];
  table = { title: 'Trend', subtitle: 'x', fileNameBase: 'T', headers: ['Month', 'Total Liability', 'Quarter'], columnWidths: [12, 14, 20], rows: months.map((mo, k) => [`${mo} 2026`, 1000 * (k + 1), 'FY 2026-27 Q1 (Apr to Jun)']) };
  opts = { resetKey: 'trend', searchable: (c) => c.header !== 'Quarter' };
  H.__reset();
  kit = H.__render(use);
  const firstModel = kit.model;
  kit.setSearch('Jun 2026');
  kit = H.__render(use);
  check(g, 'searchable: "Jun 2026" finds June only; an inline test does not rebuild the model', kit.view.rows.map((r) => r.cells[0]).join() === 'Jun 2026' && kit.model === firstModel, kit.view.rows.map((r) => r.cells[0]).join());

  const sus = (m, a) => ({ title: 'Sus', subtitle: m, fileNameBase: 'S', headers: ['Client Name', 'CGST', 'TOTAL'], columnWidths: [20, 14, 14], rows: [['Alpha', a, a], ['Beta', 500, 500]] });
  table = M.mergeTables([sus('Apr', 1000), sus('May', 1200)], ['04/2026', '05/2026']);
  opts = { resetKey: 'sus', acrossPeriods: 'latest' };
  H.__reset();
  kit = H.__render(use);
  check(g, 'acrossPeriods latest: tiles as at May, the latest month\'s balances', kit.totalsAsAt === 'May 2026' && kit.totals.find((x) => x.col === 2)?.total === 1700, `${kit.totalsAsAt} ${JSON.stringify(kit.totals)}`);
  opts = { resetKey: 'sus2' };
  H.__reset();
  kit = H.__render(use);
  check(g, '… by default added up, as before', kit.totalsAsAt === null && kit.totals.find((x) => x.col === 2)?.total === 3200, JSON.stringify(kit.totals));

  table = await M.buildForPeriods({ needs: 'month', build: async ({ month }) => { if (month === '05/2026') throw new Error('fetch failed'); return sus(month, 1000); } }, ['04/2026', '05/2026'], 'c');
  opts = { resetKey: 'failed' };
  H.__reset();
  kit = H.__render(use);
  check(g, 'kit.failedPeriods names the period not built', kit.failedPeriods?.length === 1 && kit.failedPeriods[0].label === 'May 2026', JSON.stringify(kit.failedPeriods));
});

// ── 11m. The table as drawn ────────────────────────────────────────────────
await section('drawn', async (g) => {
  const roster = (m) => ({
    title: 'Interest Scrutiny', subtitle: `Period: ${m}`, fileNameBase: 'IS', columnWidths: [20, 10, 14],
    headers: ['Client', 'Days Late', 'Total Interest'],
    rows: [['A Ltd', 5, 10], ['B Ltd', 3, 26], ['C Ltd', 1, 4], ['TOTAL', '', 40]],
  });
  const t = await M.buildForPeriods({ needs: 'month', build: async ({ month }) => { if (month === '05/2026') throw new Error('fetch failed'); return roster(month); } }, ['04/2026', '05/2026', '06/2026'], 'c');
  const note = (html) => html.includes('May 2026 was not built') && html.includes('fetch failed');
  const modes = {
    flat: [{ resetKey: 'x' }],
    sorted: [{ resetKey: 'x', initialSort: { col: 2, dir: 'desc' } }],
    grouped: [{ resetKey: 'x', initialSort: { col: 2, dir: 'desc' }, initialGroupBy: 3 }],
    filtered: [{ resetKey: 'x' }, 'b ltd'],
    paged: [{ resetKey: 'x', pageThreshold: 2, initialPageSize: 3 }],
  };
  for (const [mode, [options, search]] of Object.entries(modes)) {
    const html = R.renderKit(t, options, search);
    check(g, `${mode}: the period not built is named above the rows`, note(html) && html.indexOf('was not built') < html.indexOf('<table'), html.slice(0, 300));
  }
  check(g, 'every period built: no note', !R.renderKit(M.mergeTables([roster('04/2026'), roster('06/2026')], ['04/2026', '06/2026']), { resetKey: 'y' }).includes('not built'));
  const wp = (n) => ({
    title: 'Working paper', subtitle: 'Client: X', fileNameBase: 'WP', headers: ['Step', 'Item', 'Amount'], columnWidths: [8, 30, 14],
    rows: [['1', 'Days late', n], ['2', 'Interest', n * 10], ['Result', 'TOTAL (Interest + Late Fee)', n * 10 + 5]],
    rowKinds: ['data', 'data', 'total'],
  });
  const html = R.renderKit(M.mergeTables([wp(1), wp(2)], ['06/2025', '07/2025']), { resetKey: 'wp', sums: false, sortWithinSections: true, groupable: [1], initialGroupBy: 1 });
  check(g, 'a working paper grouped: every period\'s Result drawn after the groups', html.includes('its own TOTAL, as printed') && html.includes('15.00') && html.includes('25.00'), html.slice(-600));
});

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
