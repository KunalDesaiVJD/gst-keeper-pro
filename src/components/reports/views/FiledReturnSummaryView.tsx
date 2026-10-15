// Renders the "as-filed" family of reports (GSTR-3B Liability, GSTR-3B/GSTR-1
// as filed on the portal, GSTR-1 Summary, Tax Liability & ITC Summary, GSTR-3B
// Offset Summary): the single most important report in the app, since it's
// the actual return a CA cross-checks against the live portal document.
//
// A return is read table by table, so the report's own order is the default:
// its rows under a heading per part of the return (Table 3.1, Table 4, the
// payment, the filed PDF), its spacer rows, the filed-return PDF row with its
// button, and its grand TOTAL pinned at the bottom. The table kit (./tableKit)
// works on top of that: search, a Section filter, a filter and a sort on every
// column (a sorted row stays under its section heading), "Non-zero rows only",
// Group by where a column repeats, and the "filtered" Excel / PDF of exactly
// what is shown.
//
// Nothing is added up under a filter: a return's rows include their own
// totals (3.1(a) and the total output liability, the sections and TOTAL
// LIABILITY), so a TOTAL of the rows shown would count a figure twice. The
// return's own TOTAL stays as printed and the view says so.
//
// Kept from the first version: the header strip from the subtitle (Status as a
// badge, ARN in a monospace font), the KPI tiles read from recognisable rows
// (only when found, never fabricated), "View" links and the "Not pulled" badge.
import React, { useMemo } from 'react';
import type { ReportTable, RowKind, RowTone } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BadgeProps } from '@/components/ui/badge';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import { fmtNumber } from '@/lib/reportExport/layout';
import { cn } from '@/lib/utils';
import { FileText, Inbox } from 'lucide-react';
import { TableKitPager, TableKitTable, TableKitToolbar, isUrlCell, useTableKit, type ModelRow } from './tableKit';
import { NonZeroToggle, SectionFilter, TopDownHint } from './TopDownControls';
import { cellText, splitPeriods, type Row } from './topDownRows';

interface FiledReturnSummaryViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

const statusVariant = (v: string): NonNullable<BadgeProps['variant']> => {
  const s = v.toLowerCase();
  if (/fail|reject|denied|cancel/.test(s)) return 'destructive';
  if (/pending|processing/.test(s)) return 'warning';
  if (/filed|approv|acknowledg|processed/.test(s)) return 'success';
  return 'secondary';
};

// ───────────────────────────── subtitle parsing ─────────────────────────────

interface SubtitlePart {
  label: string;
  value: string;
}

const parseSubtitleParts = (subtitle: string): SubtitlePart[] =>
  subtitle
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((part) => {
      const idx = part.indexOf(':');
      if (idx === -1) return { label: '', value: part };
      return { label: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
    });

// ───────────────────────────── the return's sections ─────────────────────────────

const PDF_ROW_RE = /filed return pdf/i;
const isPdfRow = (row: Row): boolean => row.some((c) => typeof c === 'string' && PDF_ROW_RE.test(c));

const T31 = 'Table 3.1: Outward supplies and inward supplies liable to reverse charge';
const T4 = 'Table 4: Eligible ITC';
const T51 = 'Table 5.1: Interest and late fee';
const PAID = 'Payment of tax (as filed, aggregate)';
const FILED = 'Filed return';

/**
 * The part of the return a row belongs to, per report, by the return's own
 * table numbers (null: the part above continues, as "Total Output Tax
 * Liability" does under 3.1). A part must be a run of rows in the report's
 * order, since a heading is drawn where it starts.
 */
const SECTION_OF: Record<string, (row: Row) => string | null> = {
  'gstr3b-filed': (row) => {
    const l = cellText(row[0]);
    if (/^3\.1/.test(l)) return T31;
    if (/^4\(/.test(l)) return T4;
    if (/^5\.1/.test(l)) return T51;
    if (/^total (cash paid|itc utili[sz]ed|payable)/i.test(l)) return PAID;
    return null;
  },
  'gstr3b-liability': (row) => {
    const code = cellText(row[0]);
    if (/^3\.1/.test(code)) return T31;
    if (/^4\(/.test(code)) return T4;
    if (/as[- ]filed/i.test(cellText(row[1]))) return PAID;
    return null;
  },
  'gstr3b-offset-summary': (row) => (/liability/i.test(cellText(row[0])) ? 'Liability (as filed)' : 'How it was discharged (as filed, aggregate)'),
  'tax-liability-itc-summary': (row) => {
    const l = cellText(row[0]);
    if (/3\.1|output tax liability/i.test(l)) return 'Output tax liability (Table 3.1)';
    if (/\bitc\b/i.test(l)) return 'Input tax credit (Table 4)';
    if (/cash paid|payable/i.test(l)) return PAID;
    return null;
  },
  'gstr1-summary': (row) => {
    const n = parseInt(cellText(row[0]), 10);
    if (!Number.isFinite(n)) return null;
    if (n <= 8) return 'Outward supplies (Tables 4 to 8)';
    if (n <= 10) return 'Credit and debit notes, B2C amendments (Tables 9B and 10)';
    if (n === 11) return 'Advances (Table 11)';
    return 'Memo: HSN summary and documents issued (Tables 12 and 13)';
  },
  'gstr1-filed': (row) => (/^total liability$/i.test(cellText(row[0])) ? 'Total liability (as filed)' : 'Sections as filed'),
};

/** A row's own words: its first text that is not a table number. */
const rowLabel = (row: Row): string => row.map(cellText).find((s) => s !== '' && !/^\d+(\.\d+)?(\([a-z]\))?$/i.test(s)) ?? cellText(row[0]);

/**
 * Any other report of this kind: the blocks between its spacer rows, each
 * named by its first and last line (as the first version of this view did),
 * when there are at least two.
 */
const spacerSections = (rows: { cells: Row; kind: RowKind }[]): (string | null)[] => {
  const out: (string | null)[] = rows.map(() => null);
  const blocks: number[][] = [];
  let cur: number[] = [];
  rows.forEach((r, k) => {
    if (r.kind === 'blank') { if (cur.length) blocks.push(cur); cur = []; return; }
    if (r.kind === 'data') cur.push(k);
  });
  if (cur.length) blocks.push(cur);
  if (blocks.length < 2) return out;
  for (const b of blocks) {
    const first = rowLabel(rows[b[0]].cells);
    const last = rowLabel(rows[b[b.length - 1]].cells);
    out[b[0]] = last && last !== first ? `${first} to ${last}` : first;
  }
  return out;
};

/**
 * The filed-return PDF row as one cell in the first column: the link (drawn as
 * a "View filed PDF" button, exported as a "View PDF" link), or why there is
 * none. Left where the report put it, a link would sit in a figures column and
 * make it read as a column of links.
 */
const pdfRowCells = (cells: Row, width: number): Row => {
  const out: Row = Array(width).fill('');
  const url = cells.find((c) => isUrlCell(c));
  const note = cells.map(cellText).find((s) => s !== '' && !PDF_ROW_RE.test(s) && !isUrlCell(s));
  out[0] = url ?? `Filed return PDF: ${note || 'not captured yet'}`;
  return out;
};

/**
 * The report with a heading row before each part of the return and every
 * row's kind given, per month of a merge. The kit filters, sorts and exports
 * this table, so a "filtered" Excel keeps the same headings.
 */
const withSections = (table: ReportTable, key: string): ReportTable => {
  const width = table.headers.length;
  const rows: Row[] = [];
  const kinds: RowKind[] = [];
  const tones: (RowTone | null)[] = [];
  const push = (cells: Row, kind: RowKind, from = -1) => {
    rows.push(cells);
    kinds.push(kind);
    tones.push(from >= 0 ? table.rowTones?.[from] ?? null : null);
  };
  const rule = SECTION_OF[key];
  for (const block of splitPeriods(table)) {
    if (block.band) push(block.band.cells, 'period', block.band.i);
    const generic = rule ? null : spacerSections(block.rows);
    let current: string | null = null;
    block.rows.forEach((r, k) => {
      if (r.kind !== 'data') { push(r.cells, r.kind, r.i); return; }
      const pdf = isPdfRow(r.cells);
      const title = pdf ? FILED : rule ? rule(r.cells) : generic?.[k] ?? null;
      if (title && title !== current) {
        push([title, ...Array(Math.max(width - 1, 0)).fill('')], 'section');
        current = title;
      }
      push(pdf ? pdfRowCells(r.cells, width) : r.cells, 'data', r.i);
    });
  }
  return { ...table, rows, rowKinds: kinds, rowTones: table.rowTones ? tones : undefined };
};

// ───────────────────────────────── KPI tiles ─────────────────────────────────

const KPI_DEFS: { title: string; test: RegExp }[] = [
  { title: 'Total liability', test: /^total\b.*\bliability\b/i },
  { title: 'Net ITC', test: /\bnet itc\b/i },
  { title: 'ITC utilised', test: /\bitc utili[sz]ed\b/i },
  { title: 'Cash paid', test: /\bcash paid\b/i },
  { title: 'Total payable', test: /\btotal payable\b/i },
  { title: 'Interest', test: /^(5\.1\s+)?interest$/i },
  { title: 'Late fee', test: /^(5\.1\s+)?late fee$/i },
];

const HEAD_RE = /^(igst|cgst|sgst|utgst|cess)$/i;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A row's one figure: its Total / Amount column; else its tax heads added up
 * (IGST + CGST + SGST + Cess, as a return states a liability or a credit);
 * else its first amount (an aggregate the portal does not split by head).
 * Never a count of records.
 */
const figureOf = (row: Row, headers: string[]): { value: number; heads: string[] } | null => {
  const total = headers.findIndex((h) => /^(total|total tax|amount)$/i.test(h.trim()));
  if (total >= 0 && isNum(row[total])) return { value: row[total] as number, heads: [] };
  const heads = headers.map((h, i) => (HEAD_RE.test(h.trim()) ? i : -1)).filter((i) => i >= 0 && isNum(row[i]));
  if (heads.length) return { value: heads.reduce((t, i) => t + (row[i] as number), 0), heads: heads.map((i) => headers[i].trim()) };
  const k = row.findIndex((c, i) => isNum(c) && !/records|count|docs?\b|documents/i.test(headers[i] ?? ''));
  return k >= 0 ? { value: row[k] as number, heads: [] } : null;
};

/** One tile: its figure and the line of the return it was read from (with the heads it adds up). */
interface KpiMatch { title: string; value: number; from: string }

const computeKpis = (table: ReportTable): KpiMatch[] => {
  const kinds = table.rowKinds;
  const found: KpiMatch[] = [];
  for (const def of KPI_DEFS) {
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i];
      if (kinds?.[i] === 'section' || kinds?.[i] === 'period') continue;
      const words = row.find((c): c is string => typeof c === 'string' && def.test.test(c.trim()));
      if (!words) continue;
      const fig = figureOf(row, table.headers);
      if (fig === null) continue;
      const how = fig.heads.length > 1 ? ` (${fig.heads.join(' + ')})` : '';
      found.push({ title: def.title, value: fig.value, from: `${words.trim()}${how}` });
      break;
    }
  }
  return found;
};

/** Text longer than this wraps in its cell rather than widening the table. */
const LONG_TEXT = 48;

/** The kit's scrolling table box, at a page's width. */
const NARROW_CONTAINER = 'min-h-[160px] max-h-[65vh] max-w-4xl flex-[0_1_auto] rounded-md border bg-card';

const rupees = (v: number): string => `₹${Math.abs(v) < 0.005 ? '0.00' : fmtNumber(v)}`;

// ────────────────────────────────── component ──────────────────────────────────

export const FiledReturnSummaryView: React.FC<FiledReturnSummaryViewProps> = ({ table, report }) => {
  const subtitleParts = useMemo(() => parseSubtitleParts(table.subtitle), [table.subtitle]);
  const sectioned = useMemo(() => withSections(table, report.key), [table, report.key]);
  // One month's headline figures; a merge of several months has none (as its own export does).
  const merged = useMemo(() => sectioned.rowKinds?.includes('period') ?? false, [sectioned]);
  const kpis = useMemo(() => (merged ? [] : computeKpis(sectioned)), [sectioned, merged]);

  // Group by is offered on a column whose values repeat (a Doc Type, a table
  // number shared by two lines, any line of a merge): grouping unique lines
  // would only re-list them.
  const groupable = useMemo(() => {
    const data = sectioned.rows.filter((r, i) => sectioned.rowKinds?.[i] === 'data' && !isPdfRow(r));
    return sectioned.headers.map((_, c) => c).filter((c) => {
      const seen = new Set<string>();
      for (const r of data) {
        const s = typeof r[c] === 'string' ? cellText(r[c]) : '';
        if (!s || /^https?:\/\//i.test(s)) continue;
        if (seen.has(s)) return true;
        seen.add(s);
      }
      return false;
    });
  }, [sectioned]);

  const kit = useTableKit(sectioned, {
    resetKey: report.key,
    sortWithinSections: true,
    sums: false,
    groupable,
    statusColumn: null,
    // Nothing is added up, so the band of figures would only repeat the strip's row count.
    transformExport: (t) => ({ ...t, kpis: undefined }),
  });
  const hasTotal = !!kit.model.grandTotal || kit.model.hasReportTotals;
  const narrow = kit.cols.length <= 3;

  const ReportIcon = report.icon;

  if (table.rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-1.5 py-8 text-muted-foreground">
          <Inbox className="h-5 w-5 opacity-60" />
          <p className="text-sm">No data available for this report yet.</p>
        </CardContent>
      </Card>
    );
  }

  const pdfRow = (row: ModelRow) => isUrlCell(row.cells[0]) || cellText(row.cells[0]).toLowerCase().startsWith('filed return pdf');

  const renderCell = (row: ModelRow, col: number): React.ReactNode | undefined => {
    const text = row.cells[col];
    // A long description wraps at a readable width (a table cell's own max-width is not honoured).
    if (!pdfRow(row) && typeof text === 'string' && text.length > LONG_TEXT && !kit.isFigure(col)) {
      return <span className="block max-w-[36rem] whitespace-normal">{text}</span>;
    }
    if (col !== 0 || !pdfRow(row)) return undefined;
    const v = row.cells[0];
    return (
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-medium not-italic text-foreground">
          <FileText className="h-3.5 w-3.5 text-primary" />
          Filed return PDF
        </span>
        {isUrlCell(v) ? (
          <Button asChild size="sm" className="h-7 gap-1 px-2.5 text-xs">
            <a href={v} target="_blank" rel="noreferrer">
              <FileText className="h-3.5 w-3.5" />
              View filed PDF
            </a>
          </Button>
        ) : (
          <span>{cellText(v).replace(/^filed return pdf:\s*/i, '')}</span>
        )}
      </span>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header strip */}
      <Card className="shrink-0">
        <CardHeader className="space-y-0 px-4 pb-2 pt-3">
          <div className="flex items-center gap-2">
            <ReportIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-[15px] leading-snug">{table.title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {subtitleParts.map((part, i) => {
              const isStatus = /^status$/i.test(part.label);
              const isArn = /arn$/i.test(part.label);
              return (
                <div key={i} className={cn('min-w-[100px]', !part.label && part.value.length > 60 && 'basis-full text-muted-foreground')}>
                  {part.label && (
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {part.label}
                    </div>
                  )}
                  {isStatus ? (
                    <Badge variant={statusVariant(part.value)} className="mt-0.5 text-[10px] font-medium">
                      {part.value || '—'}
                    </Badge>
                  ) : (
                    <div className={cn('mt-0.5 text-xs font-medium', isArn && 'font-mono tracking-wide', !part.label && part.value.length > 60 && 'font-normal leading-snug')}>
                      {part.value || '—'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* KPI strip: the return's own headline figures, never the rows a filter leaves. */}
      {kpis.length > 0 && (
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi) => (
            <KpiTile key={kpi.title} label={kpi.title} value={rupees(kpi.value)} hint={kpi.from} />
          ))}
        </div>
      )}

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-3 pt-3">
          <TableKitToolbar
            kit={kit}
            searchPlaceholder="Search this return: table, description, amount…"
            left={<><SectionFilter kit={kit} /><NonZeroToggle kit={kit} /></>}
          />
          <TopDownHint
            kit={kit}
            filteredNote={hasTotal ? 'The TOTAL is the return\'s own, as printed for every table; it is not recomputed for the rows shown.' : 'Nothing is added up: a return\'s rows include their own totals.'}
          />
          <TableKitTable
            kit={kit}
            label={table.title}
            renderCell={renderCell}
            rowClassName={(row) => (pdfRow(row) ? 'bg-primary/[0.05] hover:bg-primary/10' : undefined)}
            // A return's descriptions are read in full: they wrap rather than being cut.
            cellClassName={(row, col) => (!kit.isFigure(col) ? cn('max-w-none whitespace-normal', pdfRow(row) && col === 0 && !isUrlCell(row.cells[0]) && 'italic text-muted-foreground') : undefined)}
            // A two or three column return reads better at the width of a page than across the screen.
            containerClassName={narrow ? NARROW_CONTAINER : undefined}
            noMatchText="No line of this return matches these filters."
          />
          <TableKitPager kit={kit} />
        </CardContent>
      </Card>
    </div>
  );
};
