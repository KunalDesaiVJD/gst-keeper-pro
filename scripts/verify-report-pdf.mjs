#!/usr/bin/env node
// Check of the Reports Hub PDF (src/lib/reportExport/pdf.ts).
//
//   node scripts/verify-report-pdf.mjs [--out DIR] [--real-logo]
//
// Builds the renderer with esbuild (the Supabase client is stubbed and the
// firm logo replaced by a tiny PNG unless --real-logo: nothing here touches a
// database), prints every fixture in scripts/fixtures/reportExportFixtures.mjs
// plus the two-month merge and the wide register without its pdfColumns (the
// sideways split), then reads each PDF back with PyMuPDF (python3 -I) and
// checks what a reviewer would: the page count and orientation, the title and
// identification strip on page 1, figures in the house style (1,23,456.00,
// brackets, a dash for nil), dates as dd-Mon-yyyy, a link annotation for the
// URL column, no printed column narrower than the minimum or past the margin,
// the head on every page, the running header and footer, and the time to print
// 3,500 rows. --out keeps the PDFs (and a PNG of their first pages) in DIR.
// Prints a pass / fail table; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');
const argv = process.argv.slice(2);
const outArg = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
const realLogo = argv.includes('--real-logo');
const outDir = outArg ? path.resolve(outArg) : fs.mkdtempSync(path.join(os.tmpdir(), 'report-pdf-'));
fs.mkdirSync(outDir, { recursive: true });

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const stub = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const supabase = {};', loader: 'js' }));
    if (!realLogo) {
      b.onResolve({ filter: /^@\/assets\/.*\.png$/ }, (a) => ({ path: a.path, namespace: 'png' }));
      b.onLoad({ filter: /.*/, namespace: 'png' }, () => ({ contents: `export default ${JSON.stringify(TINY_PNG)};`, loader: 'js' }));
    }
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
    // The app imports jsPDF's ES build (as Vite does); its Node build is CommonJS,
    // whose default import under Node's interop is the exports object, not the class.
    b.onResolve({ filter: /^jspdf$/ }, () => ({ path: path.join(root, 'node_modules', 'jspdf', 'dist', 'jspdf.es.min.js') }));
  },
};
const out = await build({
  stdin: {
    contents: `
      export { buildReportPdf, keepTogether, MIN_COL_MM } from './src/lib/reportExport/pdf';
      export { mergeTables } from './src/lib/reportPeriodMerge';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'error',
  loader: { '.png': 'dataurl' },
  banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
});
const R = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const F = await import(pathToFileURL(path.join(root, 'scripts', 'fixtures', 'reportExportFixtures.mjs')).href);

// ── Harness ─────────────────────────────────────────────────────────────────
const results = [];
const check = (group, name, cond, info = '') => results.push({ group, name, ok: !!cond, info: cond ? '' : String(info) });
const NOW = new Date('2026-10-15T08:35:00Z');

// ── Print every fixture ─────────────────────────────────────────────────────
const tables = {
  snapshot: F.snapshot(),
  perClientMonth: F.perClientMonth(),
  reconciliation: F.reconciliation(),
  wide: F.wide(),
  wideSplit: { ...F.wide(), title: 'Wide register (every column)', pdfColumns: undefined, fileNameBase: 'Wide_Register_All' },
  empty: F.empty(),
  big: F.big(3500),
  merged: F.merged(R.mergeTables),
  // Portrait with what the shared fixtures leave out: a title too long for one
  // line beside the logo, a stat band of eight tiles (two rows on portrait, one
  // figure in crores, tones with and without a note), a subtotal and a blank row.
  portraitKpis: (() => {
    const t = F.snapshot();
    const rows = [...t.rows.slice(0, 3), ['', 'Sub-total (Gujarat)', '', 7203, 7203, 2940.75, 0], ['', '', '', '', '', '', ''], ...t.rows.slice(3)];
    return {
      ...t,
      title: 'Suspended ITC closing balance of every client, carried forward month to month',
      subtitle: 'Month: Jul 2026   |   From the Suspended Reco ledger as carried forward, one row per client',
      rows,
      kpis: [
        { label: 'Clients', value: 5 }, { label: 'CGST', value: 18007.5 }, { label: 'SGST', value: 18007.5 }, { label: 'IGST', value: 9802.5 },
        { label: 'Net payable', value: -450.75, tone: 'bad' }, { label: 'Largest balance', value: 123456789.5, note: 'Deccan Pharma' },
        { label: 'Filed', value: '4 of 5', tone: 'good' }, { label: 'Pending', value: 1, tone: 'warn', note: 'Chase today' },
      ],
    };
  })(),
};
const built = {};
for (const [name, table] of Object.entries(tables)) {
  const t0 = performance.now();
  let doc;
  try {
    doc = await R.buildReportPdf(table, { now: NOW });
  } catch (e) {
    check(name, 'builds', false, e?.stack || e);
    continue;
  }
  const ms = performance.now() - t0;
  const file = path.join(outDir, `${name}.pdf`);
  fs.writeFileSync(file, Buffer.from(doc.output('arraybuffer')));
  built[name] = { file, ms, pages: doc.getNumberOfPages(), bytes: fs.statSync(file).size };
}

// ── Read them back with PyMuPDF ─────────────────────────────────────────────
const PY = `
import sys, json
import pymupdf
NAVY = (31/255, 56/255, 100/255)
MM = 25.4 / 72
res = {}
for p in sys.argv[1:]:
    d = pymupdf.open(p)
    pages = []
    for pg in d:
        heads = []
        for dr in pg.get_drawings():
            f = dr.get('fill')
            if f and all(abs(a - b) < 0.01 for a, b in zip(f, NAVY)):
                r = dr['rect']
                heads.append([round(r.x0 * MM, 2), round(r.x1 * MM, 2), round(r.y0 * MM, 2)])
        links = [l.get('uri') for l in pg.get_links() if l.get('uri')]
        pages.append({'text': pg.get_text(), 'heads': heads, 'links': links, 'w': pg.rect.width * MM, 'h': pg.rect.height * MM})
    res[p] = pages
print(json.dumps(res))
`;
const py = spawnSync('python3', ['-I', '-c', PY, ...Object.values(built).map((b) => b.file)], { encoding: 'utf8', maxBuffer: 1 << 28 });
let read = {};
if (py.status !== 0) check('setup', 'PyMuPDF reads the PDFs (python3 -I, pymupdf)', false, (py.stderr || py.error || '').toString().slice(0, 400));
else read = JSON.parse(py.stdout);
const pagesOf = (name) => read[built[name]?.file] ?? [];
const textOf = (name) => pagesOf(name).map((p) => p.text).join('\n');
const flat = (s) => s.replace(/\s+/g, ' ');

// ── Every fixture ───────────────────────────────────────────────────────────
for (const name of Object.keys(tables)) {
  const b = built[name];
  if (!b) continue;
  const pages = pagesOf(name);
  check(name, 'builds', true);
  check(name, `PyMuPDF sees the ${b.pages} page(s) jsPDF wrote`, pages.length === b.pages, `${pages.length} vs ${b.pages}`);
  if (!pages.length) continue;
  const t = tables[name];
  const p1 = flat(pages[0].text);
  check(name, 'page 1 carries the title', p1.includes(flat(t.title)), p1.slice(0, 200));
  check(name, 'footer: firm, prepared stamp, internal use, Page 1 of N', p1.includes('V. J. Desai & Co. LLP') && p1.includes('Prepared 15-Oct-2026 14:05 IST') && p1.includes("For the client's internal use") && p1.includes(`Page 1 of ${pages.length}`));
  check(name, `last page says Page ${pages.length} of ${pages.length}`, flat(pages[pages.length - 1].text).includes(`Page ${pages.length} of ${pages.length}`));
  if (pages.length > 1) check(name, 'page 2 carries the running header (title)', flat(pages[1].text).startsWith(flat(t.title).slice(0, 20)) || flat(pages[1].text).includes(flat(t.title)), flat(pages[1].text).slice(0, 120));
  const heads = pages.flatMap((p) => p.heads);
  const widths = heads.map(([x0, x1]) => x1 - x0);
  check(name, `no printed column narrower than ${R.MIN_COL_MM} mm`, widths.length && Math.min(...widths) >= R.MIN_COL_MM - 0.05, `narrowest ${Math.min(...widths).toFixed(2)} mm`);
  check(name, 'no column past the right margin', pages.every((p) => p.heads.every(([, x1]) => x1 <= p.w - 13.9)), '');
  check(name, 'the table head is on every page', pages.every((p) => p.heads.length > 0), pages.map((p) => p.heads.length).join(','));
  check(name, 'no ₹ or other glyph the core font cannot print', !/[₹?]{2,}|₹/.test(textOf(name)));
}

// ── Shape-specific ──────────────────────────────────────────────────────────
const portrait = (name) => pagesOf(name)[0]?.w < pagesOf(name)[0]?.h;
{
  const n = 'snapshot';
  const t = flat(textOf(n));
  check(n, 'one page, portrait (7 columns)', pagesOf(n).length === 1 && portrait(n));
  check(n, 'strip: Month / Jul 2026; rest of the subtitle under the title', t.includes('Month') && t.includes('Jul 2026') && t.includes('One row per client'));
  check(n, 'figures 1,200.50 and 18,007.50; a negative in brackets; nil as a dash', t.includes('1,200.50') && t.includes('18,007.50') && t.includes('(450.75)') && t.includes('–'), t.slice(0, 400));
  check(n, 'TOTAL row printed', t.includes('TOTAL'));
}
{
  const n = 'perClientMonth';
  const t = flat(textOf(n));
  const links = pagesOf(n).flatMap((p) => p.links);
  check(n, 'landscape (8 columns)', !portrait(n));
  check(n, 'strip: Client, GSTIN, Period', ['Client', 'Everest Textiles', 'GSTIN', '24AAECE5555E1Z5', 'Period', 'Jul 2026'].every((s) => t.includes(s)));
  check(n, 'dates in three spellings all print dd-Mon-yyyy', t.includes('05-Jul-2026') && t.includes('12-Jul-2026') && t.includes('20-Jul-2026'), t);
  check(n, 'the URL prints as "View PDF" with a link annotation', t.includes('View PDF') && links.includes('https://example.invalid/doc/101.pdf') && !t.includes('example.invalid'), JSON.stringify(links));
  check(n, 'the sentinel in the URL column stays a word', t.includes('NOT PULLED'));
  check(n, 'section rows printed (B2B invoices, Credit notes)', t.includes('B2B invoices') && t.includes('Credit notes'));
  check(n, 'credit note in brackets; Indian grouping', t.includes('(2,000.00)') && t.includes('25,500.50') && t.includes('33,500.50'));
}
{
  const n = 'reconciliation';
  const pages = pagesOf(n);
  const p1 = flat(pages[0]?.text ?? '');
  const t = flat(textOf(n));
  check(n, 'landscape; at least 3 pages (summary and list, By supplier, By month)', !portrait(n) && pages.length >= 3, pages.length);
  check(n, 'page 1: strip from meta (Client, GSTIN, Periods, 2A pulled, 2B generated)', ['Client', 'Everest Textiles', '24AAECE5555E1Z5', 'Periods', '2A pulled', '20 Sep 2026', '2B generated'].every((s) => p1.includes(s)), p1.slice(0, 300));
  check(n, 'page 1: the stat band (labels, figures, tone words)', ['Documents', 'Only in 2A', 'Net difference', 'Review', 'Action needed', '20%'].every((s) => p1.includes(s)));
  check(n, 'summary by reason with its notes, then the document list', p1.includes('Summary by reason') && t.includes('beyond the three months read') && t.includes('Document list') && t.indexOf('Summary by reason') < t.indexOf('Document list'));
  check(n, 'column groups printed over the head', ['Document', 'GSTR-2A', 'GSTR-2B', 'Reconciliation'].every((s) => t.includes(s)));
  check(n, 'pdfColumns honoured (no Supplier GSTIN or Doc Type column in the list)', !/Doc type/.test(t) && !t.includes('Supplier GSTIN') || t.indexOf('Supplier GSTIN') > t.indexOf('By supplier'), '');
  check(n, 'extra sheets By supplier and By month printed; the Excel-only sheet is not', t.includes('By supplier') && t.includes('By month') && !t.includes('Notes and evidence'));
  const bySupplierPage = pages.findIndex((p) => flat(p.text).includes('By supplier') && flat(p.text).includes('Bharat Steel Works'));
  check(n, 'By supplier starts on a page of its own', bySupplierPage > 0 && !flat(pages[bySupplierPage].text).includes('Summary by reason'));
}
{
  const n = 'wide';
  const pages = pagesOf(n);
  const t = flat(textOf(n));
  const perPage = pages[0]?.heads.length;
  check(n, 'pdfColumns: 9 printed columns, landscape, one part', perPage === 9 && !portrait(n) && !t.includes('printed in'), perPage);
  check(n, 'Figure 29 printed, Figure 10 left to the Excel', t.includes('Figure 29 Value') && !t.includes('Figure 10 Value'));
}
{
  const n = 'wideSplit';
  const pages = pagesOf(n);
  const t = flat(textOf(n));
  const all = Array.from({ length: 29 }, (_, i) => `Figure ${i + 1} Value`);
  check(n, 'too wide: printed in parts, said so', t.includes('Wider than the page: printed in') && t.includes('Continued, part 2 of'));
  check(n, 'every one of the 29 figure columns is printed', all.every((h) => t.includes(h)), all.filter((h) => !t.includes(h)).join(', '));
  check(n, 'the identity columns repeat on every part', pages.filter((p) => flat(p.text).includes('Supplier Name')).length === pages.length);
  check(n, 'figures stay whole (8,917.50 printed)', t.includes('8,917.50'));
}
{
  const n = 'empty';
  const t = flat(textOf(n));
  check(n, 'one portrait page saying there is nothing to show', pagesOf(n).length === 1 && portrait(n) && t.includes('No records for this selection.'));
}
{
  const n = 'big';
  const b = built[n];
  const pages = pagesOf(n);
  const last = flat(pages[pages.length - 1]?.text ?? '');
  check(n, `3,500 rows: a sane page count (40 to 200), got ${b?.pages}`, b && b.pages >= 40 && b.pages <= 200);
  check(n, `3,500 rows print in under 20 s (took ${b ? (b.ms / 1000).toFixed(2) : '?'} s)`, b && b.ms < 20000);
  check(n, 'the TOTAL row is on the last page; row 3500 printed', last.includes('TOTAL') && last.includes('3,500'), last.slice(-300));
  check(n, `file size reasonable (${b ? Math.round(b.bytes / 1024) : '?'} kB, under 4 MB)`, b && b.bytes < 4 * 1024 * 1024);
}
{
  const n = 'merged';
  const t = flat(textOf(n));
  check(n, 'period bands (Jul 2026, Aug 2026) and per-period totals', t.includes('Jul 2026') && t.includes('Aug 2026') && t.includes('TOTAL (07/2026)') && t.includes('TOTAL (08/2026)'));
  const p1 = flat(pagesOf(n)[0]?.text ?? '');
  check(n, 'strip: Periods / 2 combined, not the first month as the period', p1.includes('Periods 2 combined') && !p1.includes('Period Jul 2026'), p1.slice(0, 200));
}
{
  const n = 'portraitKpis';
  const t = flat(textOf(n));
  check(n, 'portrait; the long title printed whole (wrapped beside the logo)', portrait(n) && t.includes('carried forward month to month') && t.includes('Suspended ITC closing balance'));
  check(n, 'stat band: every tile, a crore figure, tone words (Action needed, In order) and given notes', ['Clients', 'Largest balance', '12,34,56,789.50', '(450.75)', 'Action needed', 'In order', 'Chase today', 'Deccan Pharma'].every((s) => t.includes(s)), t.slice(0, 500));
  check(n, 'subtotal row printed', t.includes('Sub-total (Gujarat)') && t.includes('7,203.00'));
}

// ── Keeping totals and bands with their rows ───────────────────────────────
// A4 portrait (297 mm): the body runs from the start to 280 mm (17 mm kept for
// the footer); continuation pages start at 17 mm under an 8 mm head, so a page
// holds 51 rows of 5 mm. From y = 25 the first page holds 49.
{
  const n = 'keepTogether';
  const rows = (k, kinds) => ({ h: Array(k).fill(5), kinds: kinds ?? Array(k).fill('data') });
  const run = ({ h, kinds }) => R.keepTogether(h, kinds, 8, 25, 297);
  const plain = rows(60);
  check(n, 'nothing stranded: no early breaks', run(plain).length === 0, run(plain));
  const widow = rows(50);
  widow.kinds[49] = 'total';
  check(n, 'a TOTAL that would open page 2 takes the last row with it (break before row 48)', JSON.stringify(run(widow)) === '[48]', run(widow));
  const sub = rows(51);
  sub.kinds[49] = 'subtotal';
  sub.kinds[50] = 'total';
  check(n, 'subtotal then total at the top of a page: both go with the row above', JSON.stringify(run(sub)) === '[48]', run(sub));
  const band = rows(60);
  band.kinds[48] = 'period';
  check(n, 'a period band closing page 1 moves to page 2 with its rows', JSON.stringify(run(band)) === '[48]', run(band));
  const tall = { h: [5, 300, 5], kinds: ['data', 'data', 'total'] };
  check(n, 'a row taller than a page: left to autotable', run(tall).length === 0);
  const onlyTotal = { h: [5, 5], kinds: ['data', 'total'] };
  check(n, 'never leaves a page empty', R.keepTogether(onlyTotal.h, onlyTotal.kinds, 8, 270, 297).length === 0, R.keepTogether(onlyTotal.h, onlyTotal.kinds, 8, 270, 297));
}

// ── PNG previews (with --out) ───────────────────────────────────────────────
if (outArg) {
  const PNG = `
import sys, pymupdf, os
out = sys.argv[1]
for p in sys.argv[2:]:
    d = pymupdf.open(p)
    base = os.path.splitext(os.path.basename(p))[0]
    for i in range(min(3, d.page_count)):
        d[i].get_pixmap(dpi=110).save(os.path.join(out, f"{base}-p{i + 1}.png"))
`;
  spawnSync('python3', ['-I', '-c', PNG, outDir, ...Object.values(built).map((b) => b.file)], { encoding: 'utf8' });
}

// ── Report ──────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
for (const group of ['setup', ...Object.keys(tables), 'keepTogether']) {
  const mine = results.filter((r) => r.group === group);
  if (!mine.length) continue;
  const b = built[group];
  console.log(`\n${group}${b ? `  (${b.pages} page${b.pages === 1 ? '' : 's'}, ${Math.round(b.bytes / 1024)} kB, ${Math.round(b.ms)} ms)` : ''}`);
  for (const r of mine) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.name, 70)}${r.ok ? '' : `  ${r.info}`}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.${outArg ? ` PDFs in ${outDir}` : ''}`);
if (!outArg) fs.rmSync(outDir, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
