/**
 * Builder Reports: the builder working papers as an audit file.
 *
 * Every paper is one ReportTable, built once and used twice: the preview on
 * this page renders it, and the Excel / PDF exports lay out the very same
 * object through the firm's Big-4 house style (src/lib/reportExport). So what
 * staff check on screen is exactly what is filed, figure for figure.
 *
 * Four working papers and one client statement, picked from a tab bar. A
 * schedule that reads the same data as a paper is one of its sheets rather
 * than a paper of its own (the project liability is the return filtered to a
 * project, a unit's ledger is the register narrowed to one unit, the FSI and
 * Rule 42 / 43 workings hang off the BU event), and the preview shows every
 * sheet. Each paper carries a W/P reference, its preparer and a sign-off sheet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useMonth } from '@/contexts/MonthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import {
  WS_BTN, WS_CONTROL, WS_FILTER_LABEL, WS_PAGE, WS_TAB, WS_TAB_ACTIVE, WS_TABLE_WRAP, WS_TABS_LIST, WS_TR_TOTAL,
} from '@/components/workspace/theme';
import { B_TABLE, B_TD, B_TD_NUM, B_TH, B_TH_NUM, B_TR, B_TR_HEAD } from '@/components/builder/theme';
import { cn } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  CalendarCheck, FileSpreadsheet, FileText, FolderDown, Layers, Loader2, ScrollText, UserRound, Wallet,
  type LucideIcon,
} from 'lucide-react';
import { formatINR } from '@/utils/builderRates';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import {
  REPORT_DESCRIPTION, REPORT_LABEL, fetchAdvanceRollforward, fetchBuWorking, fetchBuilderClients,
  fetchDrc03Register, fetchFsiWorking, fetchItcReversalEvents, fetchItcReversalReport, fetchPeriodReport,
  fetchPostedBuEvents, fetchProjectUnits, fetchProjects, fetchUnitLedger, fetchUnitRegister,
  type ReportContext, type ReportKind,
} from '@/lib/builderReportData';
import {
  WP_REF, advanceRollforwardTable, completionTable, memberStatementTable, projectLiabilityTable,
  returnWorkpaperTable, unitLedgerTable, unitsTable, withWorkingPaperFrame,
} from '@/utils/builderReportTables';
import type { ReportSheet, ReportTable } from '@/utils/allClientsReports';
import { downloadReportXlsx } from '@/lib/reportExport/excel';
import { downloadReportPdf } from '@/lib/reportExport/pdf';

type Client = { id: string; name: string; gstin: string | null };
type Project = { id: string; name: string; rera_number: string | null };
type BuEvent = { id: string; label: string };
type Unit = { id: string; unit_no: string; unit_type: string };

/** The tabs, in the order a period's work runs. The member statement is the Units tab's client copy. */
const TABS: { kind: ReportKind; icon: LucideIcon }[] = [
  { kind: 'MONTHLY_RETURN', icon: FileText },
  { kind: 'UNITS', icon: Layers },
  { kind: 'ADVANCES', icon: Wallet },
  { kind: 'COMPLETION', icon: CalendarCheck },
];

const PREVIEW_ROWS = 200;

/** The current financial year and the five before it, 'YYYY-YY'. */
const fyOptions = (): string[] => {
  const d = new Date();
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return Array.from({ length: 6 }, (_, i) => {
    const y = start - i;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  });
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const PLAIN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
/** Rates, areas, days and counts are not money: no forced paise. */
const NOT_MONEY = /%|rate|carpet|sq m|days|units|documents|count|booked|key/i;
const cellText = (v: string | number, header = ''): string => (
  isNum(v) ? (NOT_MONEY.test(header) ? PLAIN.format(v) : formatINR(v)) : String(v ?? ''));
/** A stat-band figure: money unless it is a whole count or its label says otherwise. */
const kpiText = (label: string, v: string | number): string => (
  isNum(v) ? (NOT_MONEY.test(label) || (Number.isInteger(v) && Math.abs(v) < 10000) ? PLAIN.format(v) : formatINR(v)) : v);

const BuilderReportsPage: React.FC = () => {
  const { canViewBuilderReports, user } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();

  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<BuEvent[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  const [tab, setTab] = useState<ReportKind>('MONTHLY_RETURN');
  /** Units with a unit chosen: the working (ledger) or the member's statement. */
  const [statement, setStatement] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [eventId, setEventId] = useState('');
  const [unitId, setUnitId] = useState('');
  const fys = useMemo(fyOptions, []);
  const [fy, setFy] = useState(fys[0]);

  const [table, setTable] = useState<ReportTable | null>(null);
  const [sheet, setSheet] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState<'' | 'pdf' | 'xlsx'>('');

  const kind: ReportKind = tab === 'UNITS' && unitId && statement ? 'MEMBER_STATEMENT' : tab;
  /** Project: needed by Units and Completion, a filter on the monthly return and the advances. */
  const projectNeeded = tab === 'UNITS' || tab === 'COMPLETION';

  useEffect(() => { void fetchBuilderClients().then(setClients); }, []);

  useEffect(() => {
    if (!selectedClientId) { setProjects([]); setProjectId(''); return; }
    void fetchProjects(selectedClientId).then((p) => {
      setProjects(p);
      setProjectId(p.length === 1 ? p[0].id : '');
    });
  }, [selectedClientId]);

  useEffect(() => {
    setEventId(''); setUnitId('');
    if (!projectId) { setEvents([]); setUnits([]); return; }
    void Promise.all([fetchPostedBuEvents(projectId), fetchProjectUnits(projectId), fetchItcReversalEvents(projectId)])
      .then(([e, u, w]) => {
        // Posted BU events, plus any event an ITC reversal working hangs off that is not posted yet.
        const posted = e.map((x) => ({ id: x.id, label: `${x.bu_date}${x.bu_ref_no ? ` · ${x.bu_ref_no}` : ''}` }));
        const seen = new Set(posted.map((x) => x.id));
        const itcOnly = w.filter((x) => !seen.has(x.bu_event_id))
          .map((x) => ({ id: x.bu_event_id, label: `Completion ${x.completion_date} · ITC working only` }));
        setEvents([...posted, ...itcOnly]);
        setUnits(u);
      });
  }, [projectId]);

  const client = useMemo(() => clients.find((c) => c.id === selectedClientId), [clients, selectedClientId]);
  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  const ctx: ReportContext | null = useMemo(() => (client ? {
    clientName: client.name,
    clientGstin: client.gstin || '',
    projectName: project?.name,
    reraNumber: project?.rera_number || undefined,
    periodMonth: tab === 'MONTHLY_RETURN' ? selectedMonth : undefined,
    financialYear: tab === 'ADVANCES' ? fy : undefined,
    preparedBy: user?.firstName || user?.email || undefined,
  } : null), [client, project, selectedMonth, fy, tab, user]);

  const missing = !client ? 'Choose a builder client'
    : projectNeeded && !projectId ? 'Choose a project'
      : tab === 'COMPLETION' && !eventId ? 'Choose a BU event'
        : tab === 'MONTHLY_RETURN' && !selectedMonth ? 'Choose a period' : '';
  const ready = !missing;

  /** Build the paper — the same object the preview shows and the exports lay out. */
  const build = useCallback(async (): Promise<ReportTable | null> => {
    if (!ready || !ctx || !selectedClientId) return null;
    let t: ReportTable | null = null;
    switch (kind) {
      case 'MONTHLY_RETURN': {
        const r = await fetchPeriodReport({ clientId: selectedClientId, periodMonth: selectedMonth, projectId: projectId || undefined });
        t = projectId ? projectLiabilityTable(ctx, r) : returnWorkpaperTable(ctx, r); break;
      }
      case 'UNITS':
        if (unitId) {
          const r = await fetchUnitLedger(unitId);
          t = r ? unitLedgerTable(ctx, r) : null;
        } else {
          const [reg, drc] = await Promise.all([fetchUnitRegister(selectedClientId, projectId), fetchDrc03Register(projectId)]);
          t = unitsTable(ctx, reg, drc);
        }
        break;
      case 'MEMBER_STATEMENT': {
        const r = await fetchUnitLedger(unitId);
        t = r ? memberStatementTable(ctx, r) : null; break;
      }
      case 'ADVANCES':
        t = advanceRollforwardTable(ctx, await fetchAdvanceRollforward({ clientId: selectedClientId, fy, projectId: projectId || undefined })); break;
      case 'COMPLETION': {
        const [bu, fsi, itc] = await Promise.all([
          fetchBuWorking(eventId), fetchFsiWorking(projectId), fetchItcReversalReport(projectId, eventId),
        ]);
        t = bu ? completionTable(ctx, bu, fsi, itc) : null; break;
      }
    }
    return t ? withWorkingPaperFrame(t, kind, ctx) : null;
  }, [ready, ctx, kind, eventId, unitId, projectId, selectedClientId, selectedMonth, fy]);

  useEffect(() => {
    let live = true;
    if (!ready) { setTable(null); return; }
    setIsLoading(true);
    build()
      .then((t) => { if (live) { setTable(t); setSheet(0); } })
      .catch((e) => { if (live) { toast.error(`Could not build the paper: ${(e as Error).message}`); setTable(null); } })
      .finally(() => { if (live) setIsLoading(false); });
    return () => { live = false; };
  }, [build, ready]);

  const exportAs = async (format: 'pdf' | 'xlsx') => {
    if (!table) return;
    setIsExporting(format);
    try {
      await (format === 'pdf' ? downloadReportPdf : downloadReportXlsx)(table);
      toast.success(`${REPORT_LABEL[kind]} exported`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setIsExporting('');
    }
  };

  const monthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = -18; i <= 2; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const v = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      out.push({ value: v, label: prettyPeriodLabel(v) });
    }
    return out;
  }, []);

  if (!canViewBuilderReports()) {
    return (
      <Card>
        <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
          You do not have permission to view builder reports.
        </CardContent>
      </Card>
    );
  }

  /** The main schedule and every sheet folded into the paper, as the export lays them out (sign-off aside). */
  const views: ReportSheet[] = table ? [
    { name: table.sheetName || 'Report', title: table.title, headers: table.headers, rows: table.rows,
      columnWidths: table.columnWidths, rowKinds: table.rowKinds },
    ...(table.extraSheets || []).filter((x) => x.name !== 'Sign-off'),
  ] : [];
  const view = views[Math.min(sheet, Math.max(views.length - 1, 0))];
  const numericCols = view ? view.headers.map((_, ci) => view.rows.some((r) => isNum(r[ci]))) : [];
  const shownRows = view ? view.rows.slice(0, PREVIEW_ROWS) : [];
  const isTotalRow = (row: (string | number)[], ri: number) =>
    view?.rowKinds?.[ri] === 'total' || String(row[0]).toLowerCase() === 'total';

  const projectOptional = tab === 'MONTHLY_RETURN' || tab === 'ADVANCES';

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        title="Builder Reports"
        subtitle="Audit-style working papers and client statements"
        icon={<FolderDown />}
        actions={(
          <>
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => exportAs('xlsx')} disabled={!table || !!isExporting}>
              {isExporting === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
              Excel
            </Button>
            <Button size="sm" className={WS_BTN} onClick={() => exportAs('pdf')} disabled={!table || !!isExporting}>
              {isExporting === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              PDF
            </Button>
          </>
        )}
      />

      <div className="min-w-0 space-y-3">
        {/* ── The papers ───────────────────────────────────────────────── */}
        <nav aria-label="Working papers" className="overflow-x-auto">
          <div className={WS_TABS_LIST} role="tablist">
            {TABS.map(({ kind: k, icon: Icon }) => {
              const on = tab === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(k)}
                  className={cn(WS_TAB, on && WS_TAB_ACTIVE)}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {REPORT_LABEL[k]}
                  <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px]', on ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground')}>
                    {WP_REF[k]}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <Card>
          <CardContent className="space-y-2 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">
                  {REPORT_LABEL[kind]} <span className="font-mono text-xs font-normal text-muted-foreground">W/P {WP_REF[kind]}</span>
                </p>
                <p className="text-xs text-muted-foreground">{REPORT_DESCRIPTION[kind]}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[220px] max-w-xs flex-1 space-y-0.5">
                <span className={WS_FILTER_LABEL}>Builder client</span>
                <SearchableSelect
                  options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin || undefined }))}
                  value={selectedClientId || ''}
                  onValueChange={setSelectedClientId}
                  placeholder="Search builder client..."
                  searchPlaceholder="Type to search..."
                  emptyText="No builder clients found."
                  className={WS_CONTROL}
                />
              </label>

              <label className="w-56 space-y-0.5">
                <span className={WS_FILTER_LABEL}>Project{projectOptional ? ' (optional)' : ''}</span>
                <Select
                  value={projectId || (projectOptional ? 'ALL' : '')}
                  onValueChange={(v) => setProjectId(v === 'ALL' ? '' : v)}
                >
                  <SelectTrigger className={WS_CONTROL} aria-label="Project"><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>
                    {projectOptional && <SelectItem value="ALL">All projects</SelectItem>}
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>

              {tab === 'MONTHLY_RETURN' && (
                <label className="w-48 space-y-0.5">
                  <span className={WS_FILTER_LABEL}>Period</span>
                  <SearchableMonthSelect
                    options={monthOptions}
                    value={selectedMonth}
                    onValueChange={setSelectedMonth}
                    placeholder="Select period"
                    className={WS_CONTROL}
                  />
                </label>
              )}

              {tab === 'ADVANCES' && (
                <label className="w-36 space-y-0.5">
                  <span className={WS_FILTER_LABEL}>Financial year</span>
                  <Select value={fy} onValueChange={setFy}>
                    <SelectTrigger className={WS_CONTROL} aria-label="Financial year"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {fys.map((f) => <SelectItem key={f} value={f}>FY {f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
              )}

              {tab === 'COMPLETION' && (
                <EventPicker label="BU event" value={eventId} onChange={setEventId} options={events}
                  empty={projectId ? 'No posted BU events in this project.' : ''} />
              )}

              {tab === 'UNITS' && (
                <label className="w-52 space-y-0.5">
                  <span className={WS_FILTER_LABEL}>Unit (optional)</span>
                  <SearchableSelect
                    options={[
                      { value: 'ALL', label: 'All units', sublabel: 'register' },
                      ...units.map((u) => ({ value: u.id, label: u.unit_no, sublabel: u.unit_type })),
                    ]}
                    value={unitId || 'ALL'}
                    onValueChange={(v) => setUnitId(v === 'ALL' ? '' : v)}
                    placeholder="All units"
                    searchPlaceholder="Type a unit number..."
                    emptyText="No units."
                    className={WS_CONTROL}
                  />
                </label>
              )}

              {tab === 'UNITS' && unitId && (
                <div className="space-y-0.5">
                  <span className={WS_FILTER_LABEL}>Paper</span>
                  <div className={cn(WS_TABS_LIST, 'flex')} role="tablist" aria-label="Unit paper">
                    {[
                      { on: !statement, label: 'Unit ledger', icon: Layers, set: false },
                      { on: statement, label: 'Member statement (C-1)', icon: UserRound, set: true },
                    ].map((o) => (
                      <button key={o.label} type="button" role="tab" aria-selected={o.on}
                        onClick={() => setStatement(o.set)}
                        className={cn(WS_TAB, 'h-7 px-3 text-xs', o.on && WS_TAB_ACTIVE)}>
                        <o.icon className="h-3.5 w-3.5" />{o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {!ready && (
          <Card>
            <CardContent className="px-4 py-10 text-center text-sm text-muted-foreground">
              <FolderDown className="mx-auto mb-2 h-6 w-6 opacity-40" />
              {missing} to build this paper.
            </CardContent>
          </Card>
        )}

        {ready && isLoading && (
          <Card>
            <CardContent className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Building the paper…
            </CardContent>
          </Card>
        )}

        {ready && !isLoading && !table && (
          <Card>
            <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing found for this selection.
            </CardContent>
          </Card>
        )}

        {ready && !isLoading && table && view && (
          <>
            {/* Identification strip, as the exported paper prints it. */}
            {table.meta && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border bg-muted/40 px-3 py-1.5 text-xs">
                {table.meta.map((m) => (
                  <span key={m.label}><span className="text-muted-foreground">{m.label}:</span> <span className="font-medium">{m.value}</span></span>
                ))}
              </div>
            )}

            {table.kpis && table.kpis.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                {table.kpis.map((k) => (
                  <KpiTile
                    key={k.label}
                    label={k.label}
                    value={kpiText(k.label, k.value)}
                    hint={k.note}
                    tone={k.tone === 'bad' ? 'error' : k.tone === 'warn' ? 'warn' : k.tone === 'good' ? 'ok' : 'neutral'}
                  />
                ))}
              </div>
            )}

            {/* The sheets of the file, as the Excel copy names them. */}
            {views.length > 1 && (
              <div className="overflow-x-auto">
                <div className={WS_TABS_LIST} role="tablist" aria-label="Sheets">
                  {views.map((v, i) => (
                    <button key={v.name} type="button" role="tab" aria-selected={view === v}
                      onClick={() => setSheet(i)}
                      className={cn(WS_TAB, 'h-7 px-3 text-xs', view === v && WS_TAB_ACTIVE)}>
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <SectionCard
              title={(
                <span className="flex flex-wrap items-center gap-1.5">
                  {view.title}
                  <Badge variant="outline" className="text-[10px] font-medium">Preview</Badge>
                </span>
              )}
              description={view.rows.length > PREVIEW_ROWS
                ? `First ${PREVIEW_ROWS} of ${view.rows.length} rows. The export carries every row and column.`
                : 'Exactly the figures the export carries. The Excel copy keeps numbers as numbers, so it foots and pivots.'}
            >
              {shownRows.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nothing to report for this selection.</p>
              ) : (
                <Table className={B_TABLE} containerClassName={cn(WS_TABLE_WRAP, 'max-h-[65vh]')}>
                  <TableHeader>
                    <TableRow className={B_TR_HEAD}>
                      {view.headers.map((h, ci) => (
                        <TableHead key={`${h}-${ci}`} className={numericCols[ci] ? B_TH_NUM : B_TH}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownRows.map((row, ri) => (
                      <TableRow key={ri} className={cn(B_TR, isTotalRow(row, ri) && WS_TR_TOTAL)}>
                        {row.map((cell, ci) => (
                          <TableCell key={ci} className={cn(numericCols[ci] ? B_TD_NUM : B_TD, view.headers.length > 1 && 'whitespace-nowrap')}>
                            {cellText(cell, view.headers[ci])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {view.notes && view.notes.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {view.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
            </SectionCard>

            <Note>
              Every figure is read back from what the engines already computed and stored, so a working paper cannot
              disagree with the return it supports. Each export carries every sheet above, its W/P reference, preparer
              and a sign-off sheet for the reviewer and partner.
            </Note>
          </>
        )}
      </div>
    </div>
  );
};

const EventPicker: React.FC<{
  label: string; value: string; onChange: (v: string) => void; options: BuEvent[]; empty: string;
}> = ({ label, value, onChange, options, empty }) => (
  <label className="w-64 space-y-0.5">
    <span className={WS_FILTER_LABEL}>{label}</span>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={WS_CONTROL} aria-label={label}><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger>
      <SelectContent>
        {options.map((e) => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}
      </SelectContent>
    </Select>
    {options.length === 0 && empty && <span className="block text-[11px] text-muted-foreground">{empty}</span>}
  </label>
);

export default BuilderReportsPage;
