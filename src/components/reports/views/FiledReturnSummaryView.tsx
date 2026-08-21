// Renders the "as-filed" family of reports (GSTR-3B Liability, GSTR-3B/GSTR-1
// as filed on the portal, GSTR-1 Summary, Tax Liability & ITC Summary, GSTR-3B
// Offset Summary) — the single most important report in the app, since it's
// the actual return a CA cross-checks against the live portal document.
//
// Layout, top to bottom:
//   1. A header strip built from table.subtitle ("Client | GSTIN | Period |
//      ARN | Filed | Status" style pieces, "|"-separated) — Status becomes a
//      colored Badge, ARN renders in a monospace font.
//   2. A row of KPI cards, pulled by scanning table.rows for recognizable
//      label rows (Total Liability/Payable, Net ITC, Cash Paid, Interest) —
//      only rendered when confidently found, never fabricated.
//   3. A search box that filters by row label/text across every section.
//   4. The table body itself, split into collapsible sections wherever a
//      blank spacer row (every cell === '') appears in the source data, each
//      section keeping its own sticky header. A row whose label is literally
//      "Filed Return PDF" renders specially as a prominent View button.
//   5. Any literal grand-total row (a cell that is exactly "TOTAL") is pinned
//      in its own strip at the bottom, always visible regardless of search.
import React, { useMemo, useState } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  Search,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  FileText,
  Receipt,
  Wallet,
  Banknote,
  Percent,
  Inbox,
} from 'lucide-react';

interface FiledReturnSummaryViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

type Row = (string | number)[];

// ─────────────────────────── generic cell/row helpers ───────────────────────────

const isUrl = (v: string | number): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const isSentinelCell = (v: string | number): boolean => {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  return s.toUpperCase() === 'NOT PULLED' || /not captured|not pulled/i.test(s);
};

const isSpacerRow = (row: Row): boolean => row.length > 0 && row.every((c) => c === '');

const isGrandTotalRow = (row: Row): boolean =>
  row.some((c) => typeof c === 'string' && c.trim().toUpperCase() === 'TOTAL');

/** Every string cell in the row, joined and lowercased — used for keyword matching (KPI / PDF-row / search). */
const rowText = (row: Row): string =>
  row
    .filter((c): c is string => typeof c === 'string')
    .join(' ')
    .toLowerCase();

/** First non-empty string cell, original case — used for section headings and the row's own display label. */
const rowLabel = (row: Row): string => {
  for (const c of row) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim();
  }
  return '';
};

const isFiledPdfRow = (row: Row): boolean => /filed return pdf/i.test(rowText(row));

const isNumericHeader = (h: string): boolean =>
  /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i.test(h);

const formatCell = (v: string | number): string => {
  if (typeof v !== 'number') return String(v ?? '');
  if (v === 0) return '0';
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

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

// ───────────────────────────── section grouping ─────────────────────────────

interface Section {
  heading: string;
  rows: Row[];
}

const buildSections = (rows: Row[]): { sections: Section[]; grandTotalRows: Row[] } => {
  const sections: Section[] = [];
  const grandTotalRows: Row[] = [];
  let current: Row[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = rowLabel(current[0]);
    const last = rowLabel(current[current.length - 1]);
    const heading = last && last !== first ? `${first} – ${last}` : first;
    sections.push({ heading, rows: current });
    current = [];
  };

  for (const row of rows) {
    if (isSpacerRow(row)) {
      flush();
      continue;
    }
    if (isGrandTotalRow(row)) {
      grandTotalRows.push(row);
      continue;
    }
    current.push(row);
  }
  flush();

  return { sections, grandTotalRows };
};

// ───────────────────────────────── KPI cards ─────────────────────────────────

interface KpiDef {
  title: string;
  test: RegExp;
  icon: React.ComponentType<{ className?: string }>;
}

const KPI_DEFS: KpiDef[] = [
  { title: 'Total Liability', test: /total.*(liability|payable)/i, icon: Receipt },
  { title: 'Net ITC', test: /net itc/i, icon: Wallet },
  { title: 'Cash Paid', test: /cash paid/i, icon: Banknote },
  { title: 'Interest Payable', test: /interest/i, icon: Percent },
];

interface KpiMatch {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}

const computeKpis = (rows: Row[]): KpiMatch[] => {
  const found: KpiMatch[] = [];
  for (const def of KPI_DEFS) {
    for (const row of rows) {
      if (isSpacerRow(row) || isGrandTotalRow(row)) continue;
      if (!def.test.test(rowText(row))) continue;
      const numeric = row.find((c): c is number => typeof c === 'number');
      if (typeof numeric === 'number') {
        found.push({ title: def.title, value: numeric, icon: def.icon });
        break;
      }
    }
  }
  return found;
};

// ────────────────────────────────── component ──────────────────────────────────

export const FiledReturnSummaryView: React.FC<FiledReturnSummaryViewProps> = ({ table, report }) => {
  const [search, setSearch] = useState('');
  const [closedSections, setClosedSections] = useState<Set<number>>(new Set());

  const subtitleParts = useMemo(() => parseSubtitleParts(table.subtitle), [table.subtitle]);
  const { sections, grandTotalRows } = useMemo(() => buildSections(table.rows), [table.rows]);
  const kpis = useMemo(() => computeKpis(table.rows), [table.rows]);
  const statusColIdx = useMemo(() => table.headers.findIndex((h) => /^status$/i.test(h)), [table.headers]);

  const query = search.trim().toLowerCase();

  const visibleSections = useMemo(() => {
    if (!query) return sections;
    return sections
      .map((sec) => ({
        ...sec,
        rows: sec.rows.filter((r) => rowText(r).includes(query) || rowLabel(r).toLowerCase().includes(query)),
      }))
      .filter((sec) => sec.rows.length > 0);
  }, [sections, query]);

  const totalRowCount = useMemo(() => sections.reduce((n, s) => n + s.rows.length, 0), [sections]);
  const matchedRowCount = useMemo(() => visibleSections.reduce((n, s) => n + s.rows.length, 0), [visibleSections]);

  const toggleSection = (idx: number) => {
    setClosedSections((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const ReportIcon = report.icon;

  if (table.rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Inbox className="h-8 w-8" />
          <p className="text-sm">No data available for this report yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ReportIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-base">{table.title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {subtitleParts.map((part, i) => {
              const isStatus = /^status$/i.test(part.label);
              const isArn = /^arn$/i.test(part.label);
              return (
                <div key={i} className="min-w-[100px]">
                  {part.label && (
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                      {part.label}
                    </div>
                  )}
                  {isStatus ? (
                    <Badge variant={statusVariant(part.value)} className="mt-0.5">
                      {part.value || '—'}
                    </Badge>
                  ) : (
                    <div className={cn('text-sm font-medium mt-0.5', isArn && 'font-mono tracking-wide')}>
                      {part.value || '—'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* KPI strip */}
      {kpis.length > 0 && (
        <div
          className={cn(
            'grid gap-3 grid-cols-2',
            kpis.length === 3 ? 'sm:grid-cols-3' : kpis.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-2',
          )}
        >
          {kpis.map((kpi, i) => {
            const Icon = kpi.icon;
            return (
              <Card key={i}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-md bg-primary/10 p-2 shrink-0">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground truncate">{kpi.title}</div>
                    <div className="text-lg font-semibold tabular-nums">₹{formatCell(kpi.value)}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this return…"
            className="pl-8 h-8 text-sm"
          />
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {query ? `${matchedRowCount} of ${totalRowCount}` : totalRowCount} row{totalRowCount === 1 ? '' : 's'}
        </span>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {visibleSections.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No rows match &quot;{search}&quot;.
            </CardContent>
          </Card>
        )}

        {visibleSections.map((section, idx) => {
          const isOpen = !closedSections.has(idx);
          const showHeading = !(section.rows.length === 1 && isFiledPdfRow(section.rows[0]));
          return (
            <Card key={idx} className="overflow-hidden">
              <Collapsible open={isOpen} onOpenChange={() => toggleSection(idx)}>
                {showHeading && (
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
                    >
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {section.heading || `Section ${idx + 1}`}
                      </span>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                )}
                <CollapsibleContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow>
                          {table.headers.map((h, i) => (
                            <TableHead
                              key={i}
                              className={cn(
                                'px-3 py-2 text-xs font-semibold whitespace-nowrap bg-muted/60',
                                isNumericHeader(h) && 'text-right',
                              )}
                            >
                              {h}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {section.rows.map((row, ri) => {
                          if (isFiledPdfRow(row)) {
                            const urlCell = row.find((c) => isUrl(c));
                            return (
                              <TableRow key={ri} className="bg-primary/5 hover:bg-primary/10">
                                <TableCell colSpan={table.headers.length || 1} className="px-3 py-3">
                                  <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <span className="text-sm font-medium">{rowLabel(row) || 'Filed Return PDF'}</span>
                                    {urlCell ? (
                                      <Button asChild size="sm" className="gap-1.5">
                                        <a href={String(urlCell)} target="_blank" rel="noreferrer">
                                          <FileText className="h-3.5 w-3.5" />
                                          View Filed PDF
                                        </a>
                                      </Button>
                                    ) : (
                                      <span className="text-xs text-muted-foreground italic">Not captured</span>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          }
                          return (
                            <TableRow key={ri}>
                              {row.map((cell, ci) => {
                                const header = table.headers[ci] || '';
                                if (isUrl(cell)) {
                                  return (
                                    <TableCell key={ci} className="px-3 py-2 text-xs whitespace-nowrap">
                                      <a
                                        href={cell}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-primary hover:underline"
                                      >
                                        <ExternalLink className="h-3 w-3" /> View
                                      </a>
                                    </TableCell>
                                  );
                                }
                                if (ci === statusColIdx && String(cell) !== '') {
                                  return (
                                    <TableCell key={ci} className="px-3 py-2 text-xs whitespace-nowrap">
                                      <Badge variant={statusVariant(String(cell))} className="text-[10px] py-0">
                                        {String(cell)}
                                      </Badge>
                                    </TableCell>
                                  );
                                }
                                if (isSentinelCell(cell)) {
                                  return (
                                    <TableCell key={ci} className="px-3 py-2 text-xs">
                                      <Badge
                                        variant="outline"
                                        className="border-dashed text-muted-foreground font-normal text-[10px]"
                                      >
                                        Not pulled
                                      </Badge>
                                    </TableCell>
                                  );
                                }
                                return (
                                  <TableCell
                                    key={ci}
                                    className={cn(
                                      'px-3 py-2 text-xs',
                                      isNumericHeader(header)
                                        ? 'text-right whitespace-nowrap tabular-nums'
                                        : 'max-w-[320px]',
                                    )}
                                  >
                                    {formatCell(cell)}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>

      {/* Pinned grand-total row(s) — always visible, exempt from search */}
      {grandTotalRows.length > 0 && (
        <Card className="border-primary/30 sticky bottom-0 shadow-md">
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableBody>
                {grandTotalRows.map((row, ri) => (
                  <TableRow key={ri} className="bg-primary/5 font-semibold hover:bg-primary/10">
                    {row.map((cell, ci) => {
                      const header = table.headers[ci] || '';
                      return (
                        <TableCell
                          key={ci}
                          className={cn(
                            'px-3 py-2 text-xs',
                            isNumericHeader(header) ? 'text-right whitespace-nowrap tabular-nums' : '',
                          )}
                        >
                          {formatCell(cell)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
