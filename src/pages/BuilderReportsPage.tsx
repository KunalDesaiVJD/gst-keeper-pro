/**
 * Builder Reports: the builder working papers as an audit file.
 *
 * Every paper is one ReportTable, built once and used twice: the preview on
 * this page renders it, and the Excel / PDF exports lay out the very same
 * object through the firm's Big-4 house style (src/lib/reportExport). So what
 * staff check on screen is exactly what is filed, figure for figure.
 *
 * Papers are grouped as an audit file is: the return and its lead schedules,
 * the unit and event workings behind them, and the client-facing statement.
 * Each carries a W/P reference, its preparer and a sign-off sheet.
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
import { WS_BTN, WS_CONTROL, WS_FILTER_LABEL, WS_PAGE, WS_TABLE_WRAP, WS_TR_TOTAL } from '@/components/workspace/theme';
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
  BookOpen, Building2, CalendarCheck, FileSpreadsheet, FileText, FolderDown, Landmark, Layers, Loader2,
  RefreshCcw, RotateCcw, ScrollText, UserRound, Wallet, type LucideIcon,
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
  WP_REF, advanceRollforwardTable, buWorkingTable, drc03RegisterTable, fsiWorkingTable, itcReversalTable,
  memberStatementTable, projectLiabilityTable, returnWorkpaperTable, unitLedgerTable, unitRegisterTable,
  withWorkingPaperFrame,
} from '@/utils/builderReportTables';
import type { ReportTable } from '@/utils/allClientsReports';
import { downloadReportXlsx } from '@/lib/reportExport/excel';
import { downloadReportPdf } from '@/lib/reportExport/pdf';

type Client = { id: string; name: string; gstin: string | null };
type Project = { id: string; name: string; rera_number: string | null };
type BuEvent = { id: string; label: string };
type Unit = { id: string; unit_no: string; unit_type: string };

interface Need { project?: boolean; period?: boolean; event?: boolean; itcEvent?: boolean; unit?: boolean; fy?: boolean }

/** What each paper needs before it can be produced. */
const NEEDS: Record<ReportKind, Need> = {
  RETURN_WORKPAPER: { period: true },
  PROJECT_LIABILITY: { project: true, period: true },
  UNIT_REGISTER: { project: true },
  ADVANCE_ROLLFORWARD: { fy: true },
  UNIT_LEDGER: { project: true, unit: true },
  BU_WORKING: { project: true, event: true },
  FSI_WORKPAPER: { project: true },
  ITC_REVERSAL: { project: true, itcEvent: true },
  DRC03_REGISTER: { project: true },
  MEMBER_STATEMENT: { project: true, unit: true },
};

const ICON: Record<ReportKind, LucideIcon> = {
  RETURN_WORKPAPER: FileText,
  PROJECT_LIABILITY: Building2,
  UNIT_REGISTER: Layers,
  ADVANCE_ROLLFORWARD: Wallet,
  UNIT_LEDGER: BookOpen,
  BU_WORKING: CalendarCheck,
  FSI_WORKPAPER: Landmark,
  ITC_REVERSAL: RotateCcw,
  DRC03_REGISTER: RefreshCcw,
  MEMBER_STATEMENT: UserRound,
};

const GROUPS: { title: string; hint: string; kinds: ReportKind[] }[] = [
  { title: 'Return & lead schedules', hint: 'What the period files and the schedules that support it', kinds: ['RETURN_WORKPAPER', 'PROJECT_LIABILITY', 'UNIT_REGISTER', 'ADVANCE_ROLLFORWARD'] },
  { title: 'Workings', hint: 'Unit, completion and correction workings behind the figures', kinds: ['UNIT_LEDGER', 'BU_WORKING', 'FSI_WORKPAPER', 'ITC_REVERSAL', 'DRC03_REGISTER'] },
  { title: 'Client-facing', hint: 'Statements to send to the member', kinds: ['MEMBER_STATEMENT'] },
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
const cellText = (v: string | number): string => (isNum(v) ? formatINR(v) : String(v ?? ''));

const BuilderReportsPage: React.FC = () => {
  const { canViewBuilderReports, user } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();

  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<BuEvent[]>([]);
  const [itcEvents, setItcEvents] = useState<BuEvent[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  const [kind, setKind] = useState<ReportKind>('RETURN_WORKPAPER');
  const [projectId, setProjectId] = useState('');
  const [eventId, setEventId] = useState('');
  const [itcEventId, setItcEventId] = useState('');
  const [unitId, setUnitId] = useState('');
  const fys = useMemo(fyOptions, []);
  const [fy, setFy] = useState(fys[0]);

  const [table, setTable] = useState<ReportTable | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState<'' | 'pdf' | 'xlsx'>('');

  const needs = NEEDS[kind];

  useEffect(() => { void fetchBuilderClients().then(setClients); }, []);

  useEffect(() => {
    if (!selectedClientId) { setProjects([]); setProjectId(''); return; }
    void fetchProjects(selectedClientId).then((p) => {
      setProjects(p);
      setProjectId(p.length === 1 ? p[0].id : '');
    });
  }, [selectedClientId]);

  useEffect(() => {
    setEventId(''); setItcEventId(''); setUnitId('');
    if (!projectId) { setEvents([]); setItcEvents([]); setUnits([]); return; }
    void Promise.all([fetchPostedBuEvents(projectId), fetchProjectUnits(projectId), fetchItcReversalEvents(projectId)])
      .then(([e, u, w]) => {
        setEvents(e.map((x) => ({ id: x.id, label: `${x.bu_date}${x.bu_ref_no ? ` · ${x.bu_ref_no}` : ''}` })));
        setUnits(u);
        setItcEvents(w.map((x) => ({ id: x.bu_event_id, label: `Completion ${x.completion_date} · ${x.status.toLowerCase()}` })));
      });
  }, [projectId]);

  const client = useMemo(() => clients.find((c) => c.id === selectedClientId), [clients, selectedClientId]);
  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  const ctx: ReportContext | null = useMemo(() => (client ? {
    clientName: client.name,
    clientGstin: client.gstin || '',
    projectName: needs.project || kind === 'ADVANCE_ROLLFORWARD' ? project?.name : undefined,
    reraNumber: needs.project ? project?.rera_number || undefined : undefined,
    periodMonth: needs.period ? selectedMonth : undefined,
    financialYear: needs.fy ? fy : undefined,
    preparedBy: user?.firstName || user?.email || undefined,
  } : null), [client, project, selectedMonth, fy, needs, kind, user]);

  const missing = !client ? 'Choose a builder client'
    : needs.project && !projectId ? 'Choose a project'
      : needs.event && !eventId ? 'Choose a posted BU event'
        : needs.itcEvent && !itcEventId ? 'Choose an ITC reversal working'
          : needs.unit && !unitId ? 'Choose a unit'
            : needs.period && !selectedMonth ? 'Choose a period' : '';
  const ready = !missing;

  /** Build the paper — the same object the preview shows and the exports lay out. */
  const build = useCallback(async (): Promise<ReportTable | null> => {
    if (!ready || !ctx || !selectedClientId) return null;
    let t: ReportTable | null = null;
    switch (kind) {
      case 'BU_WORKING': {
        const r = await fetchBuWorking(eventId);
        t = r ? buWorkingTable(ctx, r) : null; break;
      }
      case 'FSI_WORKPAPER': t = fsiWorkingTable(ctx, await fetchFsiWorking(projectId)); break;
      case 'PROJECT_LIABILITY':
        t = projectLiabilityTable(ctx, await fetchPeriodReport({ clientId: selectedClientId, periodMonth: selectedMonth, projectId })); break;
      case 'RETURN_WORKPAPER':
        t = returnWorkpaperTable(ctx, await fetchPeriodReport({ clientId: selectedClientId, periodMonth: selectedMonth })); break;
      case 'UNIT_REGISTER': t = unitRegisterTable(ctx, await fetchUnitRegister(selectedClientId, projectId)); break;
      case 'ADVANCE_ROLLFORWARD':
        t = advanceRollforwardTable(ctx, await fetchAdvanceRollforward({ clientId: selectedClientId, fy, projectId: projectId || undefined })); break;
      case 'ITC_REVERSAL': {
        const r = await fetchItcReversalReport(projectId, itcEventId);
        t = r ? itcReversalTable(ctx, r) : null; break;
      }
      case 'DRC03_REGISTER': t = drc03RegisterTable(ctx, await fetchDrc03Register(projectId)); break;
      case 'UNIT_LEDGER':
      case 'MEMBER_STATEMENT': {
        const r = await fetchUnitLedger(unitId);
        t = r ? (kind === 'UNIT_LEDGER' ? unitLedgerTable(ctx, r) : memberStatementTable(ctx, r)) : null; break;
      }
    }
    return t ? withWorkingPaperFrame(t, kind, ctx) : null;
  }, [ready, ctx, kind, eventId, itcEventId, unitId, projectId, selectedClientId, selectedMonth, fy]);

  useEffect(() => {
    let live = true;
    if (!ready) { setTable(null); return; }
    setIsLoading(true);
    build()
      .then((t) => { if (live) setTable(t); })
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

  const numericCols = table
    ? table.headers.map((_, ci) => table.rows.some((r) => isNum(r[ci])))
    : [];
  const shownRows = table ? table.rows.slice(0, PREVIEW_ROWS) : [];
  const isTotalRow = (row: (string | number)[], ri: number) =>
    table?.rowKinds?.[ri] === 'total' || String(row[0]).toLowerCase() === 'total';

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

      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ── The file index ───────────────────────────────────────────── */}
        <nav aria-label="Working papers" className="space-y-3">
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-1">
              <div className="px-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</p>
                <p className="text-[11px] text-muted-foreground/80">{g.hint}</p>
              </div>
              <div className="space-y-1" role="tablist">
                {g.kinds.map((k) => {
                  const Icon = ICON[k];
                  const on = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setKind(k)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        on ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'bg-card hover:bg-muted/60',
                      )}
                    >
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', on ? 'text-primary-foreground' : 'text-primary')} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                          {REPORT_LABEL[k]}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]',
                          on ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {WP_REF[k]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-3">
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

                {(needs.project || kind === 'ADVANCE_ROLLFORWARD') && (
                  <label className="w-56 space-y-0.5">
                    <span className={WS_FILTER_LABEL}>Project{kind === 'ADVANCE_ROLLFORWARD' ? ' (optional)' : ''}</span>
                    <Select
                      value={projectId || (kind === 'ADVANCE_ROLLFORWARD' ? 'ALL' : '')}
                      onValueChange={(v) => setProjectId(v === 'ALL' ? '' : v)}
                    >
                      <SelectTrigger className={WS_CONTROL} aria-label="Project"><SelectValue placeholder="Select project" /></SelectTrigger>
                      <SelectContent>
                        {kind === 'ADVANCE_ROLLFORWARD' && <SelectItem value="ALL">All projects</SelectItem>}
                        {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                )}

                {needs.period && (
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

                {needs.fy && (
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

                {needs.event && (
                  <EventPicker label="BU event" value={eventId} onChange={setEventId} options={events}
                    empty={projectId ? 'No posted BU events in this project.' : ''} />
                )}
                {needs.itcEvent && (
                  <EventPicker label="ITC reversal working" value={itcEventId} onChange={setItcEventId} options={itcEvents}
                    empty={projectId ? 'No ITC reversal working in this project yet.' : ''} />
                )}

                {needs.unit && (
                  <label className="w-48 space-y-0.5">
                    <span className={WS_FILTER_LABEL}>Unit</span>
                    <SearchableSelect
                      options={units.map((u) => ({ value: u.id, label: u.unit_no, sublabel: u.unit_type }))}
                      value={unitId}
                      onValueChange={setUnitId}
                      placeholder="Select unit"
                      searchPlaceholder="Type a unit number..."
                      emptyText="No units."
                      className={WS_CONTROL}
                    />
                  </label>
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

          {ready && !isLoading && table && (
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
                      value={isNum(k.value) ? formatINR(k.value) : k.value}
                      hint={k.note}
                      tone={k.tone === 'bad' ? 'error' : k.tone === 'warn' ? 'warn' : k.tone === 'good' ? 'ok' : 'neutral'}
                    />
                  ))}
                </div>
              )}

              <SectionCard
                title={(
                  <span className="flex flex-wrap items-center gap-1.5">
                    {table.title}
                    <Badge variant="outline" className="text-[10px] font-medium">Preview</Badge>
                  </span>
                )}
                description={table.rows.length > PREVIEW_ROWS
                  ? `First ${PREVIEW_ROWS} of ${table.rows.length} rows. The export carries every row and column.`
                  : 'Exactly the figures the export carries. The Excel copy keeps numbers as numbers, so it foots and pivots.'}
              >
                {shownRows.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">Nothing to report for this selection.</p>
                ) : (
                  <Table className={B_TABLE} containerClassName={cn(WS_TABLE_WRAP, 'max-h-[65vh]')}>
                    <TableHeader>
                      <TableRow className={B_TR_HEAD}>
                        {table.headers.map((h, ci) => (
                          <TableHead key={h} className={numericCols[ci] ? B_TH_NUM : B_TH}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shownRows.map((row, ri) => (
                        <TableRow key={ri} className={cn(B_TR, isTotalRow(row, ri) && WS_TR_TOTAL)}>
                          {row.map((cell, ci) => (
                            <TableCell key={ci} className={cn(numericCols[ci] ? B_TD_NUM : B_TD, 'whitespace-nowrap')}>
                              {cellText(cell)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>

              {(table.extraSheets || []).filter((x) => x.name !== 'Sign-off').length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Also in the export:{' '}
                  {(table.extraSheets || []).map((x) => x.title).join(' · ')}.
                </p>
              )}

              <Note>
                Every figure is read back from what the engines already computed and stored, so a working paper cannot
                disagree with the return it supports. Each export carries its W/P reference, preparer and a sign-off
                sheet for the reviewer and partner.
              </Note>
            </>
          )}
        </div>
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
