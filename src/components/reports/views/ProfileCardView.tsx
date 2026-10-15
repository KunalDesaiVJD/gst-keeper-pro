// Profile/ID-card renderer for reference-data reports that aren't really
// tables at all — Taxpayer Information (a ['Field','Value'] list) and
// Download Registration Certificate (a single wide row ending in a PDF URL).
// A grid would bury a 9-row name/address/status list under spreadsheet
// chrome it doesn't need; this instead reads like a profile card: an
// identity header (avatar initials + the subtitle's client/GSTIN/period/ARN
// context as chips) followed by a two-column label/value grid, with any URL
// cell promoted to a prominent "View Certificate" button instead of a link
// buried in a row.
//
// The fields are also worked like any other report, through the table kit
// (./tableKit): each field is a row of a small Section / Field / Value table,
// so the search, the section pills and the Fields list narrow the cards, Group
// by Section puts the cards under headings, and "Table" shows the same fields
// as a list with sort, a filter on every column and the filtered Excel / PDF.
// The cards stay the default: a profile is read, not worked.
import React, { useMemo, useState } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WS_BTN } from '@/components/workspace/theme';
import { fmtDate, parseDateCell } from '@/lib/reportExport/layout';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, ExternalLink, FileText, LayoutGrid, ListFilter, Rows3, UserCircle2 } from 'lucide-react';
import {
  TableKitTable, TableKitToolbar, ValuesPanel, facetValues, useTableKit,
  type ModelRow,
} from './tableKit';

interface ProfileCardViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

interface ProfileField {
  label: string;
  value: string | number;
  /** The row of a wide multi-row table the field came from (1-based), else 0. */
  record: number;
}

const NUMERIC_HEADER_RE =
  /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i;

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const isSentinel = (v: string | number): boolean => {
  if (typeof v !== 'string') return false;
  const s = v.trim().toUpperCase();
  return s === 'NOT PULLED' || s === 'TOTAL' || /not captured|not pulled/i.test(v);
};

const isStatusLabel = (label: string) => /^status$/i.test(label.trim());

const statusVariant = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ACKNOWLEDG|APPROV|SANCTION|FILED|ACCEPT|PROCESSED/.test(s)) return 'success';
  if (/PENDING|PROCESSING|SUBMIT/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

// A date field reads as 01-Jul-2017, the house style of every working paper.
const formatValue = (label: string, v: string | number): string => {
  if (typeof v === 'number') {
    return NUMERIC_HEADER_RE.test(label) ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v);
  }
  if (/date/i.test(label) && parseDateCell(v)) return fmtDate(v);
  return v;
};

// Builds the flat list of {label, value} fields this card shows, generically
// off table.headers/table.rows — handles both real shapes seen for this
// archetype: a ['Field','Value'] table with one row per field, and a wide
// single-row table where every header IS the field label (e.g. the
// certificate report, whose last column is a URL).
const buildFields = (table: ReportTable): ProfileField[] => {
  const { headers, rows } = table;
  if (headers.length === 0 || rows.length === 0) return [];

  const isFieldValueShape =
    headers.length === 2 && /^field$/i.test(headers[0].trim()) && /^value$/i.test(headers[1].trim());

  if (isFieldValueShape) {
    return rows
      .filter((row) => !row.some((c) => String(c).trim().toUpperCase() === 'TOTAL'))
      .map((row) => ({ label: String(row[0] ?? ''), value: row[1] ?? '', record: 0 }));
  }

  // Wide shape: every header is its own field label. Flatten every row's
  // columns (multi-row wide tables aren't expected for this archetype today,
  // but this still degrades sanely rather than only showing the first row).
  const fields: ProfileField[] = [];
  rows.forEach((row, ri) => {
    headers.forEach((h, ci) => {
      const cell = row[ci];
      if (cell === undefined || cell === '') return;
      fields.push({ label: h, value: cell, record: rows.length > 1 ? ri + 1 : 0 });
    });
  });
  return fields;
};

// The section a field belongs to, from its label: what a reviewer looks for
// together (who the taxpayer is, who assesses it, where it trades, whether it
// is verified, the papers on record).
const SECTION_RULES: [RegExp, string][] = [
  [/jurisdiction|\bward\b|circle|\brange\b|division|commissionerate/i, 'Jurisdiction'],
  [/address|place of business|location|pin\s?code/i, 'Place of business'],
  [/status|authenticat|aadhaar|verif|e-?kyc/i, 'Status and verification'],
  [/certificate|document|\bpdf\b|\burl\b/i, 'Documents'],
];
const sectionOf = (f: ProfileField): string =>
  (isUrl(f.value) ? 'Documents' : SECTION_RULES.find(([re]) => re.test(f.label))?.[1] ?? 'Registration');

const initials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
};

/** One field's value as the card shows it: a certificate button, a status badge, the sentinel, or the text. */
const FieldValue: React.FC<{ label: string; value: string | number; compact?: boolean }> = ({ label, value, compact }) => {
  const url = isUrl(value) ? value : null;
  if (url) {
    return (
      <Button asChild size="sm" className={cn('gap-1 px-2.5 text-xs', compact ? 'h-6' : 'h-8')}>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          View Certificate
          <ExternalLink className="h-3 w-3" />
        </a>
      </Button>
    );
  }
  if (isStatusLabel(label) && value !== '') {
    return <Badge variant={statusVariant(String(value))} className="text-[10px] font-medium">{String(value)}</Badge>;
  }
  if (isSentinel(value)) {
    return (
      <Badge variant="outline" className="border-dashed text-[10px] font-normal text-muted-foreground">
        Not pulled
      </Badge>
    );
  }
  if (compact) return <>{formatValue(label, value)}</>;
  return (
    <p className={cn('break-words text-sm font-medium text-foreground', NUMERIC_HEADER_RE.test(label) && 'tabular-nums')}>
      {formatValue(label, value)}
    </p>
  );
};

type Mode = 'cards' | 'table';

export const ProfileCardView: React.FC<ProfileCardViewProps> = ({ table, report }) => {
  const fields = useMemo(() => buildFields(table), [table]);
  const multi = fields.some((f) => f.record > 0);

  // The fields as a report of their own: one row per field. Every row is a
  // field (rowKinds), so a label that reads like "Total…" is never taken for
  // a TOTAL row, nor a field with an empty value for a heading.
  const fieldsTable = useMemo<ReportTable>(() => ({
    title: table.title,
    subtitle: table.subtitle,
    headers: [...(multi ? ['Record'] : []), 'Section', 'Field', 'Value'],
    rows: fields.map((f) => [...(multi ? [`Record ${f.record}`] : []), sectionOf(f), f.label, f.value]),
    rowKinds: fields.map(() => 'data' as const),
    fileNameBase: table.fileNameBase,
    columnWidths: [...(multi ? [10] : []), 22, 32, 60],
    ...(table.meta ? { meta: table.meta } : {}),
  }), [table, fields, multi]);
  const sectionCol = multi ? 1 : 0;
  const fieldCol = sectionCol + 1;
  const valueCol = sectionCol + 2;

  const kit = useTableKit(fieldsTable, {
    resetKey: report.key,
    groupable: multi ? [0, sectionCol] : [sectionCol],
    statusColumn: null,
    rowNoun: ['field', 'fields'],
    // The Value column mixes names and dates, so the working paper would print
    // a date as stored (2017-07-01); it reads as on the card instead.
    transformExport: (t) => {
      const f = t.headers.indexOf('Field');
      const v = t.headers.indexOf('Value');
      if (f < 0 || v < 0) return t;
      return {
        ...t,
        rows: t.rows.map((r, i) => ((t.rowKinds?.[i] ?? 'data') !== 'data' ? r : r.map((c, k) => (
          k === v && typeof c === 'string' && /date/i.test(String(r[f])) && parseDateCell(c) ? fmtDate(c) : c
        )))),
      };
    },
  });
  const { model, view, state } = kit;
  const [mode, setMode] = useState<Mode>('cards');

  const subtitleChips = table.subtitle
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  // The headline is whichever field reads as a name (Legal Name / Trade
  // Name), falling back to the report's own title for shapes that have none.
  // It names the taxpayer whatever is filtered.
  const nameField = fields.find((f) => /legal name|trade name|^name$/i.test(f.label) && typeof f.value === 'string');
  const headline = (nameField?.value as string) || table.title;

  // Sections in the order the report lists their fields (who the taxpayer
  // is first), not alphabetically.
  const sectionRank = useMemo(() => {
    const order = [...new Set(fieldsTable.rows.map((r) => String(r[sectionCol])))];
    return (key: string) => order.indexOf(key);
  }, [fieldsTable, sectionCol]);
  // Section pills: a click shows that section's fields (several: any of them).
  const sections = useMemo(
    () => facetValues(model, state, sectionCol).sort((a, b) => sectionRank(a.key) - sectionRank(b.key)),
    [model, state, sectionCol, sectionRank],
  );
  const sectionFilter = state.filters[sectionCol];
  const ticked = new Set(sectionFilter?.type === 'values' ? sectionFilter.values : []);
  const toggleSection = (key: string) => {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    kit.setFilter(sectionCol, next.size ? { type: 'values', values: [...next] } : undefined);
  };
  const fieldFilter = state.filters[fieldCol];
  const fieldsTicked = fieldFilter?.type === 'values' ? fieldFilter.values.length : 0;

  if (fields.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-1.5 py-8 text-center text-muted-foreground">
          <UserCircle2 className="h-5 w-5 opacity-50" />
          <p className="text-sm">No profile data available for this report yet.</p>
        </CardContent>
      </Card>
    );
  }

  const fieldCard = (row: ModelRow) => {
    const label = String(row.cells[fieldCol] ?? '');
    const value = row.cells[valueCol] ?? '';
    return (
      <div key={row.i} className={cn('min-w-0 border-b border-dashed pb-2', isUrl(value) && 'sm:col-span-2 lg:col-span-3')}>
        <p className="text-[11px] font-medium text-muted-foreground">
          {multi && <span className="mr-1 text-muted-foreground/70">{String(row.cells[0])} ·</span>}
          {label}
        </p>
        <div className="mt-0.5"><FieldValue label={label} value={value} /></div>
      </div>
    );
  };
  const grid = 'grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-0 border-b bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {initials(headline)}
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate text-[15px] leading-snug">{headline}</CardTitle>
            {subtitleChips.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {subtitleChips.map((chip, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] font-normal">
                    {chip}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-4 pb-3 pt-3">
        {/* Sections and fields: what to look at; the counts follow the search and the other filter. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {sections.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by section">
              <span className="mr-0.5 text-xs font-medium text-muted-foreground">Section</span>
              {sections.map((s) => {
                const on = ticked.has(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleSection(s.key)}
                    title={on ? `Showing ${s.label}: click to stop` : `Show the ${s.label} fields only`}
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
                      on ? 'border-primary bg-primary/10 text-foreground' : 'bg-card hover:bg-muted',
                      s.count === 0 && !on && 'opacity-50',
                    )}
                  >
                    {s.label}
                    <span className="tabular-nums text-muted-foreground">{s.count}</span>
                  </button>
                );
              })}
            </div>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn(WS_BTN, 'h-7', fieldsTicked > 0 && 'border-primary text-primary')}>
                <ListFilter className="h-3.5 w-3.5" />
                {fieldsTicked ? `Fields: ${fieldsTicked} of ${model.data.length}` : 'Fields'}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3">
              <p className="mb-1.5 text-sm font-semibold">Fields</p>
              <ValuesPanel model={model} state={state} col={fieldCol} filter={fieldFilter} onChange={(f) => kit.setFilter(fieldCol, f)} />
            </PopoverContent>
          </Popover>
        </div>

        <TableKitToolbar
          kit={kit}
          searchPlaceholder="Search fields and values…"
          columns={mode === 'table'}
          right={(
            <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="Show as">
              {([['cards', 'Cards', LayoutGrid], ['table', 'Table', Rows3]] as const).map(([m, label, Icon]) => (
                <Button
                  key={m}
                  type="button"
                  variant={mode === m ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={mode === m}
                  className={cn('h-6 gap-1 px-2 text-[11px]', mode === m && 'font-semibold')}
                  onClick={() => setMode(m)}
                >
                  <Icon className="h-3 w-3" /> {label}
                </Button>
              ))}
            </div>
          )}
        />

        {mode === 'table' ? (
          <TableKitTable
            kit={kit}
            label={table.title}
            noMatchText="No field matches these filters."
            containerClassName="max-h-[60vh] rounded-md border bg-card"
            cellClassName={(_row, col) => (col === valueCol ? 'max-w-[560px] whitespace-normal break-words' : col === fieldCol ? 'font-medium' : undefined)}
            renderCell={(row, col) => {
              if (col !== valueCol) return undefined;
              return <FieldValue label={String(row.cells[fieldCol] ?? '')} value={row.cells[valueCol] ?? ''} compact />;
            }}
          />
        ) : view.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No field matches these filters.{' '}
            <button type="button" className="text-primary hover:underline" onClick={kit.clearAll}>Clear all</button>
          </p>
        ) : view.groups ? (
          // Grouped: each section under its heading, in the kit's group order.
          <div className="space-y-4">
            {(state.sort?.col === sectionCol ? view.groups : [...view.groups].sort((a, b) => sectionRank(a.key) - sectionRank(b.key))).map((g) => {
              const open = !kit.collapsed.has(g.key);
              return (
                <section key={g.key} aria-label={g.label}>
                  <h3 className="mb-2 border-b pb-1">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => kit.toggleCollapsed(g.key)}
                      className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-primary hover:underline"
                    >
                      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {g.label}
                      <span className="font-normal normal-case tracking-normal text-muted-foreground">({g.rows.length})</span>
                    </button>
                  </h3>
                  {open && <div className={grid}>{g.rows.map(fieldCard)}</div>}
                </section>
              );
            })}
          </div>
        ) : (
          <div className={grid}>{view.rows.map(fieldCard)}</div>
        )}
      </CardContent>
    </Card>
  );
};
