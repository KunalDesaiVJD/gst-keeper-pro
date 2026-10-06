// Annexure exports: an Excel workbook (summary, one sheet per table with a
// Source column, readiness) and a PDF on the firm's letterhead (reportTheme).
// Every row carries its source in words: table · period · ARN · pulled.
// Loaded on demand from the Evidence tab (xlsx and jsPDF stay out of the page).
import * as XLSX from 'xlsx';
import type { RowInput } from 'jspdf-autotable';
import { drawFooters, drawNote, drawSectionTitle, drawStatBand, nowStamp, reportFileName, reportTable, startDoc } from '@/utils/reportTheme';
import type { AnnexureSummary, AnnexureTable, CellValue, Readiness, SourceRef } from './types';
import { HEAD_LABEL } from './types';
import { periodLabel, periodsLabel } from './periods';
import { STATE_WORDS } from './recipes/common';

export interface ExportModel {
  title: string;
  status: string;
  periods: string[];
  summary: AnnexureSummary;
  tables: AnnexureTable[];
  readiness: Readiness | null;
  client: { name: string; gstin: string | null };
  notice: { reference: string | null; form: string | null };
  version: { number: number | null; by: string | null; at: string | null };
}

const INR2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: CellValue): string => (typeof v === 'number' ? INR2.format(Math.abs(v) < 0.005 ? 0 : v) : v ?? '');
const when = (ts: string | null | undefined): string => {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

/** "GSTR-3B · Apr 2023 · ARN AA2405230012345 · pulled 05 Oct 2026, 10:42". */
export const sourceWords = (r: SourceRef): string =>
  [r.label ?? r.table, r.period && /^\d{2}\/\d{4}$/.test(r.period) ? periodLabel(r.period) : r.period, r.arn ? `ARN ${r.arn}` : null, r.pulled_at ? `pulled ${when(r.pulled_at)}` : null]
    .filter(Boolean).join(' · ');
export const sourcesWords = (rs: SourceRef[], total: boolean): string => (rs.length ? rs.map(sourceWords).join('; ') : total ? 'Total of the rows above' : '');

/** jsPDF's standard fonts are WinAnsi: no ₹, no minus sign, no curly quotes beyond its set. */
export const pdfSafe = (t: string): string =>
  t.replace(/₹/g, 'Rs ').replace(/[−‒–—]/g, '-').replace(/•/g, '-').replace(/…/g, '...').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^ -~\u00a0-\u00ff]/g, '?');

const fileBase = (m: ExportModel) => ['Evidence', m.client.name, m.notice.form ?? '', m.notice.reference ?? '', m.title.split(':')[0]];

// ── Excel ──────────────────────────────────────────────────────────────────
function summaryAoa(m: ExportModel): CellValue[][] {
  const s = m.summary;
  const rows: CellValue[][] = [
    [m.title],
    [`${m.client.name}${m.client.gstin ? ` · GSTIN ${m.client.gstin}` : ''}`],
    [`Notice ${m.notice.form ?? ''} ${m.notice.reference ?? ''}`.trim()],
    [`Period: ${periodsLabel(m.periods)}`],
    [`Status: ${m.status}${m.version.number ? ` · version ${m.version.number}` : ''}${m.version.by ? ` · by ${m.version.by}` : ''}${m.version.at ? ` · ${when(m.version.at)}` : ''}`],
    [],
    [s.headline],
    [],
  ];
  if (s.heads.length) {
    rows.push(['Head', 'Per the notice', `Computed (${s.computed_label})`, 'Difference', 'Explained', 'To pay']);
    for (const h of s.heads) rows.push([HEAD_LABEL[h.head], h.notice, h.computed, h.difference, h.explained, h.to_pay]);
    rows.push(['Total', s.notice_total, s.computed_total, null, s.explained_total, s.to_pay_total]);
    if (s.notice_basis) rows.push([`Per the notice: ${s.notice_basis}`]);
    rows.push([]);
  }
  if (s.lines.length) {
    rows.push(['Reconciliation', 'IGST', 'CGST', 'SGST', 'Cess']);
    for (const l of s.lines) rows.push([l.label, l.values.igst ?? null, l.values.cgst ?? null, l.values.sgst ?? null, l.values.cess ?? null]);
    rows.push([]);
  }
  for (const [label, list] of [['Notes', s.notes], ['Not compared', s.missing], ['Documents needed', s.documents ?? []]] as [string, string[]][]) {
    if (!list.length) continue;
    rows.push([label]);
    for (const x of list) rows.push([`• ${x}`]);
    rows.push([]);
  }
  return rows;
}

function tableAoa(t: AnnexureTable): CellValue[][] {
  const rows: CellValue[][] = [[t.title]];
  if (t.note) rows.push([t.note]);
  rows.push([]);
  if (t.columns.some((c) => c.group)) rows.push([...t.columns.map((c, i) => (c.group && t.columns[i - 1]?.group === c.group ? null : c.group ?? '')), '']);
  rows.push([...t.columns.map((c) => c.label), 'Source']);
  for (const r of t.rows) rows.push([...t.columns.map((c) => r.cells[c.key] ?? null), sourcesWords(r._source, r.kind === 'total')]);
  return rows;
}

/** The grouped header row ("GSTR-1 | GSTR-3B | Difference") as merged cells. */
function groupMerges(t: AnnexureTable): XLSX.Range[] {
  if (!t.columns.some((c) => c.group)) return [];
  const r = t.note ? 3 : 2;
  const out: XLSX.Range[] = [];
  let i = 0;
  while (i < t.columns.length) {
    let j = i;
    while (j + 1 < t.columns.length && t.columns[i].group && t.columns[j + 1].group === t.columns[i].group) j += 1;
    if (j > i) out.push({ s: { r, c: i }, e: { r, c: j } });
    i = j + 1;
  }
  return out;
}

function readinessAoa(r: Readiness): CellValue[][] {
  const rows: CellValue[][] = [['Data the working needs'], [`Period: ${r.period.label}`], [], ['Source', 'Period', 'State', 'Portal status', 'Pulled', 'ARN', 'Used for']];
  for (const s of r.sources) for (const c of s.cells) {
    rows.push([s.label, s.scope === 'fy' ? `FY ending ${periodLabel(c.period)}` : periodLabel(c.period), STATE_WORDS[c.state], c.status ?? '', when(c.pulled_at), c.arn ?? '', c.context ? 'Timing (same FY)' : 'The notice period']);
  }
  return rows;
}

const sheetName = (s: string, used: Set<string>) => {
  const base = s.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').slice(0, 28).trim() || 'Sheet';
  let name = base, i = 2;
  while (used.has(name)) name = `${base.slice(0, 26)} ${i++}`;
  used.add(name);
  return name;
};

export function exportAnnexureXlsx(m: ExportModel): void {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const add = (name: string, aoa: CellValue[][], widths: number[], merges: XLSX.Range[] = []) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = widths.map((wch) => ({ wch }));
    if (merges.length) ws['!merges'] = merges;
    XLSX.utils.book_append_sheet(wb, ws, sheetName(name, used));
  };
  add('Summary', summaryAoa(m), [46, 16, 18, 16, 16, 16]);
  for (const t of m.tables) add(t.title, tableAoa(t), [...t.columns.map((c) => (c.kind === 'money' ? 15 : c.key === 'treatment' || c.key === 'item' ? 44 : 16)), 60], groupMerges(t));
  if (m.readiness?.sources.length) add('Readiness', readinessAoa(m.readiness), [34, 18, 14, 30, 20, 20, 18]);
  XLSX.writeFile(wb, reportFileName(fileBase(m), 'xlsx'));
}

// ── PDF ────────────────────────────────────────────────────────────────────
export function exportAnnexurePdf(m: ExportModel): void {
  const s = m.summary;
  const { doc, y: y0 } = startDoc('l', {
    title: pdfSafe(`Evidence: ${m.title}`),
    subtitle: pdfSafe(`${m.notice.form ?? ''} ${m.notice.reference ?? ''}`.trim()),
    fields: [
      { label: 'Client', value: pdfSafe(m.client.name) }, { label: 'GSTIN', value: m.client.gstin ?? '-' },
      { label: 'Period', value: periodsLabel(m.periods) }, { label: 'Status', value: m.status },
      { label: 'Version', value: pdfSafe(m.version.number ? `${m.version.number}${m.version.by ? `, ${m.version.by}` : ''}` : 'Not saved') },
    ],
  });
  const H = doc.internal.pageSize.getHeight();
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y0;
  const room = (y: number, need = 30) => { if (y > H - need) { doc.addPage(); return 18; } return y; };
  const fmt = (v: number | null) => (v === null ? '—' : `Rs ${money(v)}`);
  let y = drawStatBand(doc, [
    { label: 'Per the notice', value: fmt(s.notice_total) },
    { label: 'Computed', value: fmt(s.computed_total) },
    { label: 'Explained', value: fmt(s.explained_total) },
    { label: 'To pay', value: fmt(s.to_pay_total), note: s.to_pay_total > 0 ? 'Left after timing and payments' : 'Nothing left' },
  ], y0);
  y = drawNote(doc, pdfSafe(s.headline), y);
  if (s.heads.length) {
    y = drawSectionTitle(doc, 'Per head', room(y));
    reportTable(doc, {
      startY: y, numericFrom: 1,
      head: [['Head', 'Per the notice', 'Computed', 'Difference', 'Explained', 'To pay']],
      body: [...s.heads.map((h) => [HEAD_LABEL[h.head], money(h.notice), money(h.computed), money(h.difference), money(h.explained), money(h.to_pay)]),
        ['Total', money(s.notice_total), money(s.computed_total), '', money(s.explained_total), money(s.to_pay_total)]],
    });
    y = lastY() + 6;
  }
  if (s.lines.length) {
    y = drawSectionTitle(doc, 'Reconciliation', room(y));
    reportTable(doc, {
      startY: y, numericFrom: 1,
      head: [['Line', 'IGST', 'CGST', 'SGST', 'Cess']],
      body: s.lines.map((l) => [pdfSafe(l.label), money(l.values.igst ?? null), money(l.values.cgst ?? null), money(l.values.sgst ?? null), money(l.values.cess ?? null)]),
    });
    y = lastY() + 6;
  }
  for (const t of m.tables) {
    y = drawSectionTitle(doc, pdfSafe(t.title), room(y, 40));
    if (t.note) y = drawNote(doc, pdfSafe(t.note), y);
    const grouped = t.columns.some((c) => c.group);
    const head: RowInput[] = [];
    if (grouped) {
      const g: { content: string; colSpan: number }[] = [];
      for (const c of t.columns) {
        const last = g[g.length - 1];
        const label = c.group ?? '';
        if (last && last.content === pdfSafe(label) && label) last.colSpan += 1;
        else g.push({ content: pdfSafe(label), colSpan: 1 });
      }
      head.push([...g, { content: '', colSpan: 1 }]);
    }
    head.push([...t.columns.map((c) => pdfSafe(c.label)), 'Source']);
    const right = Object.fromEntries(t.columns.map((c, i) => [i, c.kind === 'money' || c.kind === 'int' ? { halign: 'right' as const } : {}]));
    reportTable(doc, {
      startY: y,
      head,
      body: t.rows.map((r) => [...t.columns.map((c) => (c.kind === 'money' ? money(r.cells[c.key] ?? null) : pdfSafe(String(r.cells[c.key] ?? '')))), pdfSafe(sourcesWords(r._source, r.kind === 'total'))]),
      styles: { fontSize: t.columns.length > 10 ? 6 : 7, cellPadding: 1.2 },
      columnStyles: { ...right, [t.columns.length]: { fontSize: 5.5, cellWidth: 52 } },
    });
    y = lastY() + 6;
  }
  for (const [label, list] of [['Notes', s.notes], ['Not compared', s.missing], ['Documents needed', s.documents ?? []]] as [string, string[]][]) {
    if (!list.length) continue;
    y = drawSectionTitle(doc, label, room(y));
    for (const x of list) y = drawNote(doc, pdfSafe(`• ${x}`), room(y, 16));
  }
  drawFooters(doc, nowStamp());
  doc.save(reportFileName(fileBase(m), 'pdf'));
}
