#!/usr/bin/env node
// Checks that a Reports Hub report built for a whole financial year from any
// one month of it (ReportDefinition.periodScope 'fy') is built once per
// financial year among the months picked, not once per month:
// buildForPeriods in src/lib/reportPeriodMerge.ts, with the catalog's own
// marking in src/lib/reportsCatalog.ts.
//
//   node scripts/verify-report-period-scope.mjs
//
// Covers: Apr + May + Jun of one year build once and come back as the plain
// table (no band, its own FY TOTAL once, in the table and in the full Excel);
// Mar + Apr build twice and merge as two blocks named by their years, in
// order, the subtitle naming both, a year's own word (a ledger's same-day
// note, its months-pulled count) kept and named by its year, a word every
// year carries said once; a year that cannot be built is named by its year; a month-scoped report is built and merged month by month as before;
// the annual trend view's own collapse (oneBlockPerYear) leaves either result
// as it is and still collapses a month-by-month merge; and every catalog
// report is marked 'fy' exactly when its builder reads the same thing for any
// month of a year (each one run on a Supabase stand-in that records every
// query and answers nothing).
//
// Fictional tables only; nothing is read from or written to Supabase. Prints
// pass / fail; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const { build } = requireRoot('esbuild');
const ExcelJS = requireRoot('exceljs');
globalThis.__verifyExcelJS = ExcelJS;

// The Supabase client as a stand-in: every chain is recorded when awaited and
// answers no rows (or no row, for maybeSingle / single).
const SUPABASE_STUB = `
  const log = () => (globalThis.__sbLog ??= []);
  const chain = (desc) => new Proxy(function () {}, {
    get(_t, k) {
      if (typeof k === 'symbol') return undefined;
      if (k === 'then') {
        return (res, rej) => {
          log().push(desc);
          const one = /\\.(maybeSingle|single)\\(\\[\\]\\)$/.test(desc);
          return Promise.resolve(one ? { data: null, error: null } : { data: [], error: null, count: 0 }).then(res, rej);
        };
      }
      return chain(desc + '.' + k);
    },
    apply(_t, _this, args) {
      let a;
      try { a = JSON.stringify(args); } catch { a = '[?]'; }
      return chain(desc + '(' + a + ')');
    },
  });
  export const supabase = chain('sb');
`;
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
    b.onResolve({ filter: /^exceljs$/ }, () => ({ path: 'exceljs', namespace: 'stub' }));
    b.onResolve({ filter: /^@\/assets\/.*\.png$/ }, () => ({ path: 'png', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
      contents: a.path === 'exceljs' ? 'export default globalThis.__verifyExcelJS;'
        : a.path === 'png' ? `export default ${JSON.stringify(PNG_1PX)};`
          : SUPABASE_STUB,
      loader: 'js',
    }));
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
  },
};
const out = await build({
  stdin: {
    contents: `
      export { buildForPeriods, mergeTables } from './src/lib/reportPeriodMerge';
      export * as PeriodMerge from './src/lib/reportPeriodMerge';
      export { REPORTS_CATALOG } from './src/lib/reportsCatalog';
      export { buildModel, facetLabel, latestPeriod } from './src/components/reports/views/tableKit/tableModel';
      export { oneBlockPerYear, monthColumn } from './src/components/reports/views/annualTrendRules';
      export { reportToXlsx } from './src/lib/reportExport/excel';
      export { metaOf } from './src/lib/reportExport/layout';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stubs], logLevel: 'error',
  define: { 'import.meta.env': '{}' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' },
  banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
});
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const section = async (group, fn) => {
  try { await fn(group); } catch (e) { check(group, 'ran without throwing', false, e?.stack ?? e); }
};

// ── Fixtures ────────────────────────────────────────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The financial year of MM/YYYY as the builders name it, and its twelve month labels. */
const yearOf = (mmYyyy) => {
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  const start = mm >= 4 ? yyyy : yyyy - 1;
  const months = Array.from({ length: 12 }, (_, i) => `${MON[(3 + i) % 12]} ${i >= 9 ? start + 1 : start}`);
  return { label: `FY ${start}-${String(start + 1).slice(-2)}`, months };
};
/** The GSTR-3B annual summary's shape: the year's twelve months from any one of them, three pulled, its FY TOTAL. */
const annualOf = (mmYyyy) => {
  const { label, months } = yearOf(mmYyyy);
  return {
    title: 'GSTR 3B Annual Summary Report',
    subtitle: `Client: FICTIONAL TRADERS   |   GSTIN: 24ABCDE1234F1Z5   |   ${label}   |   As filed on the portal for each month (3/12 months pulled).`,
    headers: ['Month', 'Outward Liability', 'RCM Liability', 'Total Liability', 'ITC Available', 'Net ITC', 'Total Payable (as filed)'],
    rows: [
      ...months.map((m, i) => (i < 3 ? [m, 1000, 0, 1000, 600, 600, 400] : [m, 'NOT PULLED', '', '', '', '', ''])),
      [`TOTAL — ${label}`, 3000, 0, 3000, 1800, 1800, 1200],
    ],
    fileNameBase: `GSTR3B_Annual_Summary_FICTIONAL_TRADERS_${label.replace(/\s+/g, '_')}`,
    columnWidths: [14, 18, 16, 16, 16, 14, 20],
  };
};
/** A report that records the month of every build; `fail` maps a month to the error it throws. */
const recorder = (extra, makeTable, fail = {}) => {
  const calls = [];
  return {
    calls,
    report: {
      key: 'stub', title: 'Stub', description: '', category: 'gstr3b', status: 'ready', icon: () => null,
      needs: 'client+month', viewKind: 'annual-trend', ...extra,
      build: async ({ month }) => {
        calls.push(month);
        if (fail[month]) throw new Error(fail[month]);
        return makeTable(month);
      },
    },
  };
};
const fyTotals = (t) => t.rows.filter((r) => /^TOTAL — FY/.test(String(r[0]))).map((r) => r[0]);
const bands = (t) => t.rows.filter((r) => /^— .+ —$/.test(String(r[0]))).map((r) => r[0]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. One financial year picked ────────────────────────────────────────────
await section('one year picked', async (g) => {
  const { calls, report } = recorder({ periodScope: 'fy' }, annualOf);
  const t = await M.buildForPeriods(report, ['04/2026', '05/2026', '06/2026'], 'c');
  check(g, 'Apr + May + Jun 2026: built once, from Apr 2026', same(calls, ['04/2026']), JSON.stringify(calls));
  check(g, '… the plain table, as one month gives it (no band, no merge)', same(t, annualOf('04/2026')) && bands(t).length === 0, JSON.stringify(bands(t)));
  check(g, '… FY 2026-27 TOTAL once', same(fyTotals(t), ['TOTAL — FY 2026-27']), JSON.stringify(fyTotals(t)));
  check(g, '… no "periods combined", no "_3periods"', !/periods combined/.test(t.subtitle) && !/periods$/.test(t.fileNameBase), `${t.subtitle} | ${t.fileNameBase}`);

  const r2 = recorder({ periodScope: 'fy' }, annualOf);
  await M.buildForPeriods(r2.report, ['06/2026', '04/2026', '05/2026'], 'c');
  check(g, 'picked Jun, Apr, May: built once, from the first picked (Jun 2026)', same(r2.calls, ['06/2026']), JSON.stringify(r2.calls));

  const r3 = recorder({ periodScope: 'fy' }, annualOf);
  const all = await M.buildForPeriods(r3.report, ['04/2026', '05/2026', '06/2026', '07/2026', '08/2026', '09/2026', '10/2026', '11/2026', '12/2026', '01/2027', '02/2027', '03/2027'], 'c');
  check(g, '"This FY" (all twelve months): built once', r3.calls.length === 1 && fyTotals(all).length === 1, JSON.stringify(r3.calls));

  const model = M.buildModel(t);
  check(g, 'the table kit reads it as one period (not merged, no Period column)', !model.merged && model.periodCol === -1 && model.data.length === 12, JSON.stringify([model.merged, model.periodCol, model.data.length]));

  // The full Excel of the dialog and of the Reports list's button: the year once.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await M.reportToXlsx(t, { now: new Date(Date.UTC(2026, 9, 16, 6, 0)) }));
  let totals = 0;
  wb.worksheets[0].eachRow((row) => row.eachCell((c) => { if (/^TOTAL — FY 2026-27$/.test(String(c.value ?? ''))) totals++; }));
  check(g, 'the full Excel prints the TOTAL — FY 2026-27 row once', totals === 1, totals);

  const one = recorder({ periodScope: 'fy' }, annualOf, { '04/2026': 'nothing pulled for this client' });
  let err = '';
  try { await M.buildForPeriods(one.report, ['04/2026', '05/2026'], 'c'); } catch (e) { err = e.message; }
  check(g, 'a year that cannot be built fails with its builder\'s own reason, as one month would', err === 'nothing pulled for this client' && one.calls.length === 1, err);
});

// ── 2. Two financial years picked ───────────────────────────────────────────
await section('two years picked', async (g) => {
  const { calls, report } = recorder({ periodScope: 'fy' }, annualOf);
  const t = await M.buildForPeriods(report, ['03/2026', '04/2026'], 'c');
  check(g, 'Mar 2026 + Apr 2026: built twice, once per year', same(calls, ['03/2026', '04/2026']), JSON.stringify(calls));
  check(g, '… two blocks named by their years, in order', same(bands(t), ['— FY 2025-26 —', '— FY 2026-27 —']), JSON.stringify(bands(t)));
  check(g, '… each year\'s own TOTAL once', same(fyTotals(t), ['TOTAL — FY 2025-26', 'TOTAL — FY 2026-27']), JSON.stringify(fyTotals(t)));
  check(g, '… 24 months', t.rows.filter((r) => /^[A-Z][a-z]{2} \d{4}$/.test(String(r[0]))).length === 24);
  check(g, '… the subtitle names both years, not only the first', /FY 2025-26, FY 2026-27/.test(t.subtitle) && /2 periods combined/.test(t.subtitle), t.subtitle);
  const meta = M.metaOf(t).fields;
  check(g, '… and so does the Excel / PDF strip', meta.some((f) => f.label === 'Financial year' && f.value === 'FY 2025-26, FY 2026-27') && meta.some((f) => f.label === 'Periods'), JSON.stringify(meta));

  const r2 = recorder({ periodScope: 'fy' }, annualOf);
  const t2 = await M.buildForPeriods(r2.report, ['05/2026', '03/2026', '04/2026', '02/2026'], 'c');
  check(g, 'picked May, Mar, Apr, Feb: the first picked of each year, the years in order', same(r2.calls, ['03/2026', '05/2026']) && same(bands(t2), ['— FY 2025-26 —', '— FY 2026-27 —']), JSON.stringify([r2.calls, bands(t2)]));

  const model = M.buildModel(t);
  check(g, 'the kit\'s Period bands and facet read as the years', model.merged && same(model.periods.map((p) => p.label), ['FY 2025-26', 'FY 2026-27'])
    && M.facetLabel(model, model.periodCol, 'FY 2025-26') === 'FY 2025-26', JSON.stringify(model.periods));
  check(g, '… the latest is FY 2026-27', model.periods[M.latestPeriod(model, model.data)]?.label === 'FY 2026-27');

  const f = recorder({ periodScope: 'fy' }, annualOf, { '03/2026': 'no months eligible' });
  const tf = await M.buildForPeriods(f.report, ['03/2026', '04/2026'], 'c');
  const fm = M.buildModel(tf);
  check(g, 'a year that cannot be built is named by its year', same(fm.failedPeriods, [{ key: 'FY 2025-26', label: 'FY 2025-26', reason: 'no months eligible' }]) && fm.data.length === 12, JSON.stringify(fm.failedPeriods));
  const none = recorder({ periodScope: 'fy' }, annualOf, { '03/2026': 'a', '04/2026': 'b' });
  let err = '';
  try { await M.buildForPeriods(none.report, ['03/2026', '04/2026'], 'c'); } catch (e) { err = e.message; }
  check(g, 'neither year built: the error names each year', err === 'FY 2025-26: a  FY 2026-27: b', err);
});

// ── 2b. Two years: each year's own word kept, named by its year ────────────
/** A ledger's shape: its year's subtitle, carrying a note only where `notes` gives that year one. */
const ledgerOf = (notes) => (mmYyyy) => {
  const { label, months } = yearOf(mmYyyy);
  return {
    title: 'Cash Ledger',
    subtitle: `Client: FICTIONAL TRADERS   |   GSTIN: 24ABCDE1234F1Z5   |   ${label}${notes[label] ? `   |   ${notes[label]}` : ''}`,
    headers: ['Month', 'Date', 'Description', 'Type', 'Balance'],
    rows: [[months[0], '', 'Opening Balance', '', 0], [months[0], '', 'Closing Balance', '', 0]],
    fileNameBase: `Cash_Ledger_${label.replace(/\s+/g, '_')}`,
  };
};
const segs = (t) => t.subtitle.split('   |   ');
const NOTE26 = 'Same-day order: 1 day the running balance does not put in one order (18-Aug-2026)';
const NOTE25 = 'Same-day order: 1 day the running balance does not put in one order (20-Jun-2025)';
await section("two years: each year's own word", async (g) => {
  const later = await M.buildForPeriods(recorder({ periodScope: 'fy' }, ledgerOf({ 'FY 2026-27': NOTE26 })).report, ['03/2026', '04/2026'], 'c');
  check(g, 'a note only the later year carries is kept, named by its year',
    same(segs(later), ['Client: FICTIONAL TRADERS', 'GSTIN: 24ABCDE1234F1Z5', 'FY 2025-26, FY 2026-27', `FY 2026-27: ${NOTE26}`, '2 periods combined']), later.subtitle);
  const earlier = await M.buildForPeriods(recorder({ periodScope: 'fy' }, ledgerOf({ 'FY 2025-26': NOTE25 })).report, ['03/2026', '04/2026'], 'c');
  check(g, '… one only the first year carries is named by its year, not shown as if for both',
    segs(earlier).includes(`FY 2025-26: ${NOTE25}`) && !segs(earlier).includes(NOTE25), earlier.subtitle);
  const both = await M.buildForPeriods(recorder({ periodScope: 'fy' }, ledgerOf({ 'FY 2025-26': NOTE25, 'FY 2026-27': NOTE26 })).report, ['03/2026', '04/2026'], 'c');
  check(g, '… each year its own, in order', segs(both).indexOf(`FY 2025-26: ${NOTE25}`) === 3 && segs(both).indexOf(`FY 2026-27: ${NOTE26}`) === 4, both.subtitle);
  const alike = await M.buildForPeriods(recorder({ periodScope: 'fy' }, ledgerOf({ 'FY 2025-26': NOTE26, 'FY 2026-27': NOTE26 })).report, ['03/2026', '04/2026'], 'c');
  check(g, '… a word every year carries said once, unnamed', segs(alike).filter((x) => x.includes(NOTE26)).length === 1 && segs(alike).includes(NOTE26), alike.subtitle);

  // The annual summary's months-pulled count differs by year.
  const pulledOf = (mmYyyy) => {
    const t = annualOf(mmYyyy);
    return yearOf(mmYyyy).label === 'FY 2025-26' ? { ...t, subtitle: t.subtitle.replace('3/12', '12/12') } : t;
  };
  const counts = await M.buildForPeriods(recorder({ periodScope: 'fy' }, pulledOf).report, ['03/2026', '04/2026'], 'c');
  check(g, "each year's months-pulled count, named by its year",
    segs(counts).some((x) => x.startsWith('FY 2025-26: As filed') && x.includes('12/12')) && segs(counts).some((x) => x.startsWith('FY 2026-27: As filed') && x.includes('3/12'))
    && !segs(counts).some((x) => x.startsWith('As filed')), counts.subtitle);
  const { fields: meta, rest } = M.metaOf(counts);
  check(g, '… the Excel / PDF strip still names both years', meta.some((f) => f.label === 'Financial year' && f.value === 'FY 2025-26, FY 2026-27'), JSON.stringify(meta));
  check(g, "… and each year's note is on the note line, read whole, not a strip field cut off by the next",
    !meta.some((f) => /^FY \d{4}/.test(f.label)) && rest.includes('FY 2025-26: As filed') && rest.includes('FY 2026-27: As filed'), JSON.stringify({ meta, rest }));
  // In the Excel the note line wraps across the table's width (as the PDF's
  // letterhead does), not one line running past it.
  const wbn = new ExcelJS.Workbook();
  await wbn.xlsx.load(await M.reportToXlsx(both, { now: new Date(Date.UTC(2026, 9, 16, 6, 0)) }));
  const wsn = wbn.worksheets[0];
  let noteRow = null;
  wsn.eachRow((row, i) => { if (!noteRow && /^FY 2025-26: Same-day order/.test(String(row.getCell(2).value ?? ''))) noteRow = i; });
  const noteCell = noteRow ? wsn.getCell(noteRow, 2) : null;
  const across = noteRow ? wsn.getCell(noteRow, 2 + both.headers.length - 1).master?.address === noteCell.address : false;
  check(g, "… and in the Excel the ledger's two notes are one note line wrapped across the whole table, tall enough for its lines",
    !!noteCell && noteCell.alignment?.wrapText === true && across && (wsn.getRow(noteRow).height ?? 0) > 13,
    JSON.stringify({ noteRow, wrap: noteCell?.alignment, across, h: noteRow && wsn.getRow(noteRow).height }));
  const ledgerMeta = M.metaOf(both);
  check(g, "… so is a ledger's long same-day note", !ledgerMeta.fields.some((f) => /Same-day order/.test(`${f.label}: ${f.value}`)) && ledgerMeta.rest.includes(`FY 2026-27: ${NOTE26}`), JSON.stringify(ledgerMeta));

  const failed = await M.buildForPeriods(recorder({ periodScope: 'fy' }, ledgerOf({ 'FY 2026-27': NOTE26 }), { '03/2026': 'no rows' }).report, ['03/2026', '04/2026'], 'c');
  check(g, 'a year that cannot be built adds nothing to the subtitle (its block says why)',
    !segs(failed).some((x) => x.startsWith('FY 2025-26:')) && segs(failed).includes('FY 2025-26, FY 2026-27'), failed.subtitle);
});

// ── 3. Month-scoped reports: unchanged ──────────────────────────────────────
await section('month scope unchanged', async (g) => {
  const monthly = (m) => ({
    title: 'GSTR-1 Summary', subtitle: `Client: X   |   Period: ${m}`, headers: ['Doc Type', 'Taxable Value', 'IGST'],
    rows: [['B2B', 100, 18], ['TOTAL', 100, 18]], fileNameBase: 'G1', columnWidths: [14, 14, 14],
  });
  for (const extra of [{}, { periodScope: 'month' }]) {
    const { calls, report } = recorder({ viewKind: 'filed-return-summary', ...extra }, monthly);
    const t = await M.buildForPeriods(report, ['04/2026', '05/2026', '06/2026'], 'c');
    const label = extra.periodScope ? 'periodScope month' : 'no periodScope';
    check(g, `${label}: built once per month`, same(calls, ['04/2026', '05/2026', '06/2026']), JSON.stringify(calls));
    check(g, `${label}: merged month by month, as mergeTables does`, same(t, M.mergeTables(['04/2026', '05/2026', '06/2026'].map(monthly), ['04/2026', '05/2026', '06/2026'])), JSON.stringify(bands(t)));
  }
  const { calls, report } = recorder({ needs: 'client' }, () => monthly(''));
  await M.buildForPeriods(report, ['04/2026', '05/2026'], 'c');
  check(g, 'a report with no period ignores the months picked', same(calls, ['']), JSON.stringify(calls));
  const fyNoPick = recorder({ periodScope: 'fy' }, () => monthly(''));
  await M.buildForPeriods(fyNoPick.report, [], 'c');
  check(g, 'an FY report with no month picked is built once, as before', same(fyNoPick.calls, ['']), JSON.stringify(fyNoPick.calls));
});

// ── 4. The annual trend view's own collapse, now a safety net ───────────────
await section('annual trend safety net', async (g) => {
  const col = M.monthColumn(annualOf('04/2026').headers);
  const { report } = recorder({ periodScope: 'fy' }, annualOf);
  const one = await M.buildForPeriods(report, ['04/2026', '05/2026', '06/2026'], 'c');
  const y1 = M.oneBlockPerYear(one, col);
  check(g, 'one year, already once: left as it is, no note', y1.table === one && y1.note === null, y1.note);
  const two = await M.buildForPeriods(recorder({ periodScope: 'fy' }, annualOf).report, ['03/2026', '04/2026'], 'c');
  const y2 = M.oneBlockPerYear(two, col);
  check(g, 'two years, each once: left as it is, no note', y2.table === two && y2.note === null, y2.note);
  const old = M.mergeTables(['04/2026', '05/2026', '06/2026'].map(annualOf), ['04/2026', '05/2026', '06/2026']);
  const y3 = M.oneBlockPerYear(old, col);
  check(g, 'a month-by-month merge is still collapsed to the year once', fyTotals(y3.table).length === 1 && /shown once/.test(y3.note ?? ''), JSON.stringify([fyTotals(y3.table), y3.note]));
});

// ── 5. The catalog: 'fy' exactly where the builder reads a whole year ──────
// Each period report is built for Jun 2026, Jul 2026 (same year) and Jun 2025
// on the stand-in: a whole-year report records the same queries and gives the
// same answer for Jun and Jul, and a different one for Jun 2025.
await section('catalog', async (g) => {
  const signature = async (r, month) => {
    globalThis.__sbLog = [];
    let answer;
    try {
      const t = await r.build({ month, clientId: '00000000-0000-0000-0000-00000000c11e' });
      answer = { title: t.title, subtitle: t.subtitle, headers: t.headers, rows: t.rows };
    } catch (e) {
      answer = { error: String(e?.message ?? e) };
    }
    return JSON.stringify({ queries: globalThis.__sbLog, answer });
  };
  const wrong = [];
  const fy = [];
  for (const r of M.REPORTS_CATALOG) {
    if (r.needs !== 'month' && r.needs !== 'client+month') {
      if (r.periodScope) wrong.push(`${r.key}: takes no period but is marked ${r.periodScope}`);
      continue;
    }
    const jun = await signature(r, '06/2026');
    const jul = await signature(r, '07/2026');
    const lastYear = await signature(r, '06/2025');
    const wholeYear = jun === jul && jun !== lastYear;
    if (wholeYear) fy.push(r.key);
    if (wholeYear !== (r.periodScope === 'fy')) wrong.push(`${r.key}: builder reads ${wholeYear ? 'a whole year' : 'one month'}, marked ${r.periodScope ?? '(none)'}`);
  }
  check(g, 'every period report marked as its builder reads', wrong.length === 0, wrong.join('; '));
  const expected = ['sus-one', 'cred-one', 'gstr3b-annual-summary', 'credit-reversal-reclaim-statement', 'rcm-liability-itc-ledger',
    'credit-ledger-transaction-detail', 'liability-ledger', 'cash-ledger', 'credit-and-liability-statement'];
  check(g, `the nine whole-year reports: ${expected.join(', ')}`, same([...fy].sort(), [...expected].sort()), JSON.stringify(fy));
  const pulls = M.REPORTS_CATALOG.filter((r) => r.periodScope === 'fy' && r.pull);
  check(g, 'their Pull still asks for the months picked (needsMonth unchanged)', pulls.length === 7 && pulls.every((r) => r.pull.needsMonth === true), JSON.stringify(pulls.map((r) => [r.key, r.pull.needsMonth])));
});

// ── Report ──────────────────────────────────────────────────────────────────
let group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.info.slice(0, 900)}`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
