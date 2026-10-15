#!/usr/bin/env node
// Check of the Big4-style Excel every Reports Hub download goes through
// (src/lib/reportExport/excel.ts).
//
//   node scripts/verify-report-exports.mjs [--out <dir>]
//
// Bundles the renderer with esbuild (the Supabase client is stubbed and
// ExcelJS is handed in from node_modules: nothing here touches a database or
// the network), builds a workbook from every fixture in
// scripts/fixtures/reportExportFixtures.mjs plus the two-month merge, writes
// it, loads the bytes back with ExcelJS and checks what a reviewer would look
// for: sheet names and order, the printed headers, number formats per column
// kind, real dates, double rules under totals, frozen heads, the autofilter,
// notes, the stat band, column-group merges, tones, links, print set-up, and
// the time a 3,500-row by 34-column sheet takes. --out writes each workbook
// for a look in Excel or LibreOffice. Prints a pass / fail table; exits 1 on
// any failure. The PDF half lives in scripts/verify-report-pdf.mjs and shares
// only the fixtures.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const { build } = requireRoot('esbuild');
const ExcelJS = requireRoot('exceljs');
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx > 0 ? path.resolve(process.argv[outIdx + 1] || '.') : null;

// ExcelJS is not bundled: the renderer's dynamic import resolves to the copy
// loaded above, the way the browser build resolves to the UMD bundle.
globalThis.__verifyExcelJS = ExcelJS;
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
          : 'export const supabase = {};',
      loader: 'js',
    }));
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
  },
};
const out = await build({
  stdin: {
    contents: `
      export { buildReportWorkbook, reportToXlsx } from './src/lib/reportExport/excel';
      export { layoutOf, metaOf, sheetName, kpiText, fileBase, guessRowKind, FMT, PALETTE, TONE, FIRM } from './src/lib/reportExport/layout';
      export { mergeTables } from './src/lib/reportPeriodMerge';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stubs], logLevel: 'error',
  loader: { '.png': 'dataurl' },
});
const R = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const F = await import(pathToFileURL(path.join(root, 'scripts', 'fixtures', 'reportExportFixtures.mjs')).href);

// ── Harness ─────────────────────────────────────────────────────────────────
const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const NOW = new Date(Date.UTC(2026, 9, 15, 8, 35)); // 15-Oct-2026 14:05 IST
const FIRST_COL = 2;

const text = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  if (typeof v === 'object' && 'text' in v) return String(v.text);
  if (v instanceof Date) return v.toISOString();
  return String(v);
};
const fillOf = (cell) => cell.fill?.fgColor?.argb ?? null;

/** The row whose cells from column B read the labels, exactly. */
const findHeadRow = (ws, labels) => {
  for (let r = 1; r <= Math.min(ws.rowCount, 80); r++) {
    if (labels.every((l, k) => text(ws.getCell(r, FIRST_COL + k).value) === l)) return r;
  }
  return null;
};
const findCell = (ws, want, maxRow = ws.rowCount) => {
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.max(row.cellCount, 2); c++) if (text(row.getCell(c).value) === want) return row.getCell(c);
  }
  return null;
};
const rangeOf = (s) => {
  const m = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(s);
  if (!m) return null;
  const col = (L) => [...L].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { c1: col(m[1]), r1: +m[2], c2: col(m[3]), r2: +m[4] };
};
const mergesOf = (ws) => (ws.model.merges || []).map(rangeOf).filter(Boolean);
const filterOf = (ws) => {
  const f = ws.autoFilter;
  if (!f) return null;
  if (typeof f === 'string') return rangeOf(f);
  const cell = (x) => (typeof x === 'string' ? rangeOf(`${x}:${x}`) : { c1: x.column, r1: x.row });
  const a = cell(f.from);
  const b = cell(f.to);
  return a && b ? { c1: a.c1, r1: a.r1, c2: b.c1, r2: b.r1 } : null;
};

/** One sheet against its layout: head, formats, dates, totals, tones, links, freeze, filter, notes, print. */
function checkSheet(g, ws, l, opts) {
  const labels = l.columns.map((c) => c.label);
  const head = findHeadRow(ws, labels);
  check(g, `${ws.name}: header row reads the printed labels`, head, labels.join(' | '));
  if (!head) return;
  const hc = ws.getCell(head, FIRST_COL);
  check(g, `${ws.name}: header navy, white bold Arial 9, wrapped`, fillOf(hc) === R.PALETTE.navy && hc.font?.bold && hc.font?.color?.argb === R.PALETTE.white && hc.font?.name === 'Arial' && hc.font?.size === 9 && hc.alignment?.wrapText,
    JSON.stringify({ fill: fillOf(hc), font: hc.font, al: hc.alignment }));
  const misaligned = l.columns.filter((c) => ws.getCell(head, FIRST_COL + c.index).alignment?.horizontal !== c.align);
  check(g, `${ws.name}: every header aligned like its column`, !misaligned.length, misaligned.map((c) => c.header).join(', '));
  check(g, `${ws.name}: column A is the 2-wide margin`, ws.getColumn(1).width === 2, ws.getColumn(1).width);
  check(g, `${ws.name}: header block (firm, title, prepared) at the top`, text(ws.getCell(1, FIRST_COL).value).startsWith(R.FIRM.name)
    && text(ws.getCell(2, FIRST_COL).value) === opts.title && !!findCell(ws, `Prepared 15-Oct-2026 14:05 IST  ·  GST Keeper`, 8),
  `${text(ws.getCell(1, FIRST_COL).value)} / ${text(ws.getCell(2, FIRST_COL).value)}`);

  // Body rows sit right under the head, one per layout row (an empty table has a line saying so).
  const body = head + 1;
  const rowAt = (i) => ws.getRow(body + i);
  // Number formats per column kind, on the first data row holding a number in that column.
  const want = { amount: R.FMT.amount, int: R.FMT.int, rate: R.FMT.rate };
  for (const col of l.columns) {
    if (!(col.kind in want)) continue;
    const i = l.rows.findIndex((r, k) => l.kinds[k] === 'data' && typeof r[col.index] === 'number');
    if (i < 0) continue;
    const cell = rowAt(i).getCell(FIRST_COL + col.index);
    check(g, `${ws.name}: "${col.header}" (${col.kind}) stored as a number in ${col.kind} format, right-aligned`,
      typeof cell.value === 'number' && cell.numFmt === want[col.kind] && cell.alignment?.horizontal === 'right',
      `${JSON.stringify(cell.value)} ${cell.numFmt} ${cell.alignment?.horizontal}`);
  }
  for (const col of l.columns.filter((c) => c.kind === 'date')) {
    const i = l.rows.findIndex((r, k) => l.kinds[k] === 'data' && String(r[col.index] ?? '').trim() !== '');
    if (i < 0) continue;
    const cell = rowAt(i).getCell(FIRST_COL + col.index);
    check(g, `${ws.name}: "${col.header}" holds a real Date (dd-mmm-yyyy)`, cell.value instanceof Date && cell.numFmt === R.FMT.date, `${cell.value} ${cell.numFmt}`);
  }
  // Totals: bold, band fill, a rule above and a double rule below across the table.
  l.kinds.forEach((k, i) => {
    if (k !== 'total') return;
    const cells = l.columns.map((c) => rowAt(i).getCell(FIRST_COL + c.index));
    check(g, `${ws.name}: total row ${i + 1} has a double rule below, a rule above, bold`,
      cells.every((c) => c.border?.bottom?.style === 'double' && c.border?.top?.style === 'thin' && c.font?.bold && fillOf(c) === R.PALETTE.band),
      JSON.stringify(cells[0].border));
  });
  // Period bands are merged across; section rows are soft bands.
  l.kinds.forEach((k, i) => {
    if (k === 'period') {
      // Never merged (sorting from the autofilter refuses merged cells); the fill spans the table.
      const m = mergesOf(ws).find((x) => x.r1 === body + i);
      const lastCell = rowAt(i).getCell(FIRST_COL + l.columns.length - 1);
      check(g, `${ws.name}: period band "${l.rows[i][0]}" spans the table unmerged`, !m && rowAt(i).getCell(FIRST_COL).value === l.rows[i][0] && fillOf(rowAt(i).getCell(FIRST_COL)) === R.PALETTE.band && fillOf(lastCell) === R.PALETTE.band, JSON.stringify(m));
    }
    if (k === 'section') {
      const c = rowAt(i).getCell(FIRST_COL);
      check(g, `${ws.name}: section "${l.rows[i][0]}" bold on the soft band`, c.font?.bold && fillOf(c) === R.PALETTE.bandSoft && c.alignment?.horizontal === 'left');
    }
  });
  // Zebra on alternate data rows.
  const dataIdx = l.kinds.map((k, i) => (k === 'data' ? i : -1)).filter((i) => i >= 0);
  if (dataIdx.length >= 2 && dataIdx[1] === dataIdx[0] + 1 && l.toneColumn !== 0) {
    check(g, `${ws.name}: zebra on the second data row only`, !fillOf(rowAt(dataIdx[0]).getCell(FIRST_COL)) && fillOf(rowAt(dataIdx[1]).getCell(FIRST_COL)) === R.PALETTE.zebra,
      `${fillOf(rowAt(dataIdx[0]).getCell(FIRST_COL))} / ${fillOf(rowAt(dataIdx[1]).getCell(FIRST_COL))}`);
  }
  // Body font.
  if (dataIdx.length) {
    const c = rowAt(dataIdx[0]).getCell(FIRST_COL + l.columns.length - 1);
    check(g, `${ws.name}: body Arial 9 with grid`, c.font?.name === 'Arial' && c.font?.size === 9 && !!c.border?.left, JSON.stringify(c.font));
  }
  // Tones on the status cell.
  if (l.toneColumn >= 0) {
    const i = l.tones.findIndex((t) => t);
    if (i >= 0) {
      const c = rowAt(i).getCell(FIRST_COL + l.toneColumn);
      check(g, `${ws.name}: status cell tinted ${l.tones[i]}, bold`, fillOf(c) === R.TONE[l.tones[i]].fill && c.font?.color?.argb === R.TONE[l.tones[i]].ink && c.font?.bold, `${fillOf(c)} ${JSON.stringify(c.font)}`);
    }
  }
  // Links read "Open".
  l.rows.forEach((r, i) => r.forEach((v, c) => {
    if (typeof v !== 'string' || !/^https?:\/\//.test(v)) return;
    const cell = rowAt(i).getCell(FIRST_COL + c);
    check(g, `${ws.name}: link in row ${i + 1} reads "Open" and points at the URL`, cell.value?.text === 'Open' && cell.value?.hyperlink === v && cell.font?.underline, JSON.stringify(cell.value));
  }));
  // Sentinels quiet.
  l.rows.forEach((r, i) => r.forEach((v, c) => {
    if (v !== 'NOT PULLED') return;
    const cell = rowAt(i).getCell(FIRST_COL + c);
    check(g, `${ws.name}: NOT PULLED italic grey`, cell.font?.italic && cell.font?.color?.argb === R.PALETTE.muted, JSON.stringify(cell.font));
  }));
  if (!l.rows.length) check(g, `${ws.name}: an empty table says so`, text(rowAt(0).getCell(FIRST_COL).value) === 'No records for this report.');

  // Column groups: merged over their spans, just above the head.
  if (l.groups) {
    const merges = mergesOf(ws);
    let c = FIRST_COL;
    const ok = l.groups.every((gr) => {
      const at = c;
      c += gr.span;
      const labelOk = text(ws.getCell(head - 1, at).value) === gr.label && fillOf(ws.getCell(head - 1, at)) === (gr.tone ? R.TONE[gr.tone].ink : R.PALETTE.navyLight);
      return labelOk && (gr.span === 1 || merges.some((m) => m.r1 === head - 1 && m.c1 === at && m.c2 === at + gr.span - 1));
    });
    check(g, `${ws.name}: column groups merged above the head`, ok, JSON.stringify(merges.filter((m) => m.r1 === head - 1)));
  }

  // Freeze below the head, after the margin plus the key columns.
  const v = ws.views?.[0] || {};
  const xs = 1 + (opts.freezeColumns ?? 0);
  check(g, `${ws.name}: frozen below the head (row ${head}) and after column ${xs}`, v.state === 'frozen' && v.ySplit === head && v.xSplit === xs && v.showGridLines === false, JSON.stringify(v));
  // Filter from the head to the last data row; a trailing TOTAL stays outside.
  let end = l.rows.length - 1;
  while (end >= 0 && (l.kinds[end] === 'total' || l.kinds[end] === 'blank')) end--;
  const f = filterOf(ws);
  check(g, `${ws.name}: autofilter from the head to the last data row`, f && f.r1 === head && f.c1 === FIRST_COL && f.c2 === FIRST_COL + l.columns.length - 1 && f.r2 === (end >= 0 ? body + end : head),
    JSON.stringify(ws.autoFilter));
  // Notes under the table.
  if (l.notes.length) {
    const nh = findCell(ws, 'Notes');
    check(g, `${ws.name}: "Notes" and every note under the table`, nh && nh.font?.bold && l.notes.every((n) => findCell(ws, `•  ${n}`)), l.notes[0]);
  }
  // Print: A4, orientation by width, fit to one page wide, print titles, header and footer.
  const ps = ws.pageSetup;
  const orient = l.columns.length > 8 ? 'landscape' : 'portrait';
  check(g, `${ws.name}: A4 ${orient}, fit to width, print titles`, ps.paperSize === 9 && ps.orientation === orient && ps.fitToPage && ps.fitToWidth === 1 && ps.fitToHeight === 0
    && ps.printTitlesRow === `${l.groups ? head - 1 : head}:${head}`, JSON.stringify({ ...ps, margins: undefined }));
  const hdr = ws.headerFooter || {};
  check(g, `${ws.name}: header names firm and title, footer pages`, (hdr.oddHeader || '').includes('&C') && (hdr.oddHeader || '').includes(opts.title.slice(0, 20).replace(/&/g, '&&')) && /Page &P of &N/.test(hdr.oddFooter || ''),
    `${hdr.oddHeader} | ${hdr.oddFooter}`);
}

/** Build, write, load back and check one report. */
async function checkReport(name, table) {
  const g = name;
  const t0 = performance.now();
  const wb = await R.buildReportWorkbook(table, { now: NOW });
  const buf = await wb.xlsx.writeBuffer();
  const ms = performance.now() - t0;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${name}.xlsx`), buf);
  }
  const bytes = await R.reportToXlsx(table, { now: NOW });
  check(g, 'reportToXlsx returns xlsx bytes (a zip)', bytes instanceof Uint8Array && bytes[0] === 0x50 && bytes[1] === 0x4b, bytes?.constructor?.name);
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  check(g, 'workbook creator and title', back.creator === R.FIRM.name && back.title === table.title, `${back.creator} / ${back.title}`);

  // Sheet names and order.
  const used = new Set();
  const expect = [];
  if (table.summary) expect.push(R.sheetName('Summary', used));
  expect.push(R.sheetName(table.sheetName ?? (table.summary ? 'Documents' : 'Report'), used));
  for (const x of table.extraSheets ?? []) expect.push(R.sheetName(x.name, used));
  const names = back.worksheets.map((w) => w.name);
  check(g, `sheets in order: ${expect.join(', ')}`, JSON.stringify(names) === JSON.stringify(expect), names.join(', '));
  check(g, 'no sheet name longer than 31 characters', names.every((n) => n.length <= 31), names.filter((n) => n.length > 31).join(', '));

  const sheets = back.worksheets;
  let k = 0;
  if (table.summary) checkSheet(g, sheets[k++], R.layoutOf(table.summary, table.summary.title), { title: table.title });
  checkSheet(g, sheets[k++], R.layoutOf(table), { title: table.title, freezeColumns: table.freezeColumns });
  for (const x of table.extraSheets ?? []) {
    const ws = sheets[k++];
    checkSheet(g, ws, R.layoutOf(x, x.title), { title: table.title, freezeColumns: x.freezeColumns });
    check(g, `${ws.name}: its title as a heading`, !!findCell(ws, x.title, 14));
  }

  // The stat band, on the first sheet only.
  if (table.kpis?.length) {
    const first = sheets[0];
    const ok = table.kpis.every((kp) => {
      const c = findCell(first, kp.label, 30);
      if (!c) return false;
      const v = first.getCell(c.row + 1, c.col);
      const fill = kp.tone ? R.TONE[kp.tone].fill : R.PALETTE.band;
      return fillOf(c) === R.PALETTE.navy && c.font?.bold && c.alignment?.horizontal === 'center' && text(v.value) === R.kpiText(kp) && fillOf(v) === fill && v.font?.bold;
    });
    check(g, `stat band on "${first.name}": every KPI label over its value`, ok);
    const notes = table.kpis.filter((kp) => kp.note);
    if (notes.length) check(g, 'KPI notes printed under their values', notes.every((kp) => !!findCell(first, kp.note, 30)));
    check(g, 'stat band not repeated on later sheets', sheets.slice(1).every((ws) => !findCell(ws, table.kpis[table.kpis.length - 1].label, 12)));
    // Each box a run of whole columns wide enough for a figure; boxes in later bands line up with the first.
    const boxes = table.kpis.map((kp) => findCell(first, kp.label, 30)).filter(Boolean).map((c) => {
      const m = mergesOf(first).find((x) => x.r1 === c.row && x.c1 === c.col) ?? { c1: c.col, c2: c.col, r1: c.row };
      let w = 0;
      for (let k = m.c1; k <= m.c2; k++) w += first.getColumn(k).width;
      return { ...m, w };
    });
    check(g, 'every KPI box at least 14 characters wide', boxes.every((b) => b.w >= 14), JSON.stringify(boxes.map((b) => b.w)));
    const bandRows = [...new Set(boxes.map((b) => b.r1))];
    const firstBand = boxes.filter((b) => b.r1 === bandRows[0]);
    check(g, `KPI bands line up (${bandRows.length} band${bandRows.length > 1 ? 's' : ''})`, boxes.every((b) => firstBand.some((f) => f.c1 === b.c1 && f.c2 === b.c2)), JSON.stringify(boxes));
  }
  return { ms, sheets: names.length };
}

// ── Run ─────────────────────────────────────────────────────────────────────
const cases = [
  ['snapshot', F.snapshot()],
  ['perClientMonth', F.perClientMonth()],
  ['reconciliation', F.reconciliation()],
  ['wide', F.wide()],
  ['empty', F.empty()],
  ['big', F.big()],
  ['merged', F.merged(R.mergeTables)],
];
const timings = {};
for (const [name, table] of cases) timings[name] = (await checkReport(name, table)).ms;

// Merged: two period bands and both months' totals renamed.
{
  const m = F.merged(R.mergeTables);
  const l = R.layoutOf(m);
  check('merged', 'two period bands, two renamed totals', l.kinds.filter((k) => k === 'period').length === 2 && l.kinds.filter((k) => k === 'total').length === 2, l.kinds.join(','));
}

// Every TOTAL label the report builders use is a total row (the FY and PAN
// statements end with "TOTAL — …"), and a word that only starts like one is not.
{
  const kind = (label) => R.guessRowKind([label, 1, 2, 3]);
  const totals = ['TOTAL', 'Grand Total', 'TOTAL (07/2026)', 'TOTAL — FY 2026-27', 'TOTAL — PAN AAACA1111A', 'Total for the year'];
  check('layout', 'every builder\'s TOTAL label is a total row', totals.every((t) => kind(t) === 'total'), totals.map((t) => `${t}=${kind(t)}`).join(', '));
  check('layout', '"Totally exempt supplies" is data', kind('Totally exempt supplies') === 'data');
}

// The identification strip: parsed from the subtitle, laid across the row.
{
  const wb = await R.buildReportWorkbook(F.perClientMonth(), { now: NOW });
  const ws = wb.worksheets[0];
  const strip = [];
  for (let r = 3; r <= 7; r++) ws.getRow(r).eachCell((c) => { if (c.value?.richText) strip.push({ r, label: c.value.richText[0].text, value: c.value.richText[1].text }); });
  check('header', 'strip from the subtitle: Client, GSTIN, Period', ['Client: ', 'GSTIN: ', 'Period: '].every((l) => strip.some((s) => s.label === l)), JSON.stringify(strip));
  check('header', 'strip pairs share a row where they fit', strip.length >= 2 && strip[0].r === strip[1].r, JSON.stringify(strip));
  check('header', "the subtitle's rest in italic grey", findCell(ws, "Pulled directly from the portal's JSON", 8)?.font?.italic);
  check('header', 'header block at most 7 rows', ws.getRow(8).cellCount === 0 || !text(ws.getCell(8, FIRST_COL).value).startsWith('Prepared'));
  const rule = findCell(ws, 'Prepared 15-Oct-2026 14:05 IST  ·  GST Keeper', 8);
  check('header', 'a navy rule under the block, across the table', rule && ws.getCell(rule.row, FIRST_COL + 7).border?.bottom?.color?.argb === R.PALETTE.navy);
  check('header', 'page header: firm left, title centre, client right', /&L.*V\. J\. Desai && Co\. LLP.*&C.*GSTR-2B.*&R.*Everest Textiles/.test(ws.headerFooter.oddHeader), ws.headerFooter.oddHeader);
}

// Speed: 3,500 rows by 34 columns, built and written.
{
  const w = F.wide();
  const rows = Array.from({ length: 3500 }, (_, i) => w.rows[i % w.rows.length].map((v, c) => (c === 0 ? i + 1 : v)));
  rows.push(['', 'TOTAL', '', '', '', ...Array.from({ length: 29 }, (_, k) => rows.reduce((s, r) => s + r[5 + k], 0))]);
  const table = { ...w, title: 'Wide register, 3,500 rows', rows, fileNameBase: 'Wide_3500' };
  const t0 = performance.now();
  const wb = await R.buildReportWorkbook(table, { now: NOW });
  const t1 = performance.now();
  const buf = await wb.xlsx.writeBuffer();
  const t2 = performance.now();
  timings['3500x34'] = t2 - t0;
  check('speed', `3,500 x 34 built in ${Math.round(t1 - t0)} ms, written in ${Math.round(t2 - t1)} ms (under 5 s)`, t2 - t0 < 5000, `${Math.round(t2 - t0)} ms`);
  check('speed', `3,500 x 34 file size ${(buf.byteLength / 1048576).toFixed(1)} MB (under 8 MB)`, buf.byteLength < 8 * 1048576);
  if (outDir) fs.writeFileSync(path.join(outDir, 'wide3500.xlsx'), buf);
}

// fileBase keeps a safe download name.
check('api', 'fileBase makes a safe file name', R.fileBase('GSTR-2A vs 2B: Everest/Jul 2026') === 'GSTR-2A_vs_2B_Everest_Jul_2026', R.fileBase('GSTR-2A vs 2B: Everest/Jul 2026'));

// ── Report ──────────────────────────────────────────────────────────────────
const groups = [...new Set(results.map((r) => r.group))];
const pad = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
console.log(`\n${pad('Group', 16)} ${pad('Check', 92)} Result`);
console.log('-'.repeat(118));
for (const r of results) console.log(`${pad(r.group, 16)} ${pad(r.name, 92)} ${r.ok ? 'pass' : `FAIL  ${r.info.slice(0, 300)}`}`);
console.log('-'.repeat(118));
for (const g of groups) {
  const rs = results.filter((r) => r.group === g);
  console.log(`${pad(g, 16)} ${rs.filter((r) => r.ok).length}/${rs.length} pass${timings[g] !== undefined ? `   (${Math.round(timings[g])} ms)` : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks pass${failed ? `; ${failed} FAIL` : ''}.`);
if (outDir) console.log(`Workbooks written to ${outDir}`);
process.exit(failed ? 1 : 0);
