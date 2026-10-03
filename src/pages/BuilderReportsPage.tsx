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
  WS_BTN, WS_CONTROL, WS_FILTER_LABEL, WS_PAGE, WS_TAB, WS_TAB_ACTIVE, WS_TABLE_WRAP, WS_TABS_LIST,
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
import { FolderDown, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { formatINR } from '@/utils/builderRates';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import {
  REPORT_DESCRIPTION, REPORT_LABEL, fetchBuWorking, fetchBuilderClients,
  fetchPeriodReport, fetchPostedBuEvents, fetchProjectUnits, fetchProjects,
  fetchUnitLedger,
  type ReportContext, type ReportKind,
} from '@/lib/builderReportData';
import {
  buWorkingPdf, memberStatementPdf, projectLiabilityPdf, returnWorkpaperPdf, unitLedgerPdf,
} from '@/utils/builderReportsPdf';
import {
  buWorkingExcel, memberStatementExcel, projectLiabilityExcel, returnWorkpaperExcel,
  unitLedgerExcel,
} from '@/utils/builderReportsExcel';

type Client = { id: string; name: string; gstin: string | null };
type Project = { id: string; name: string; rera_number: string | null };
type BuEvent = { id: string; bu_date: string; bu_ref_no: string | null; posting_period: string };
type Unit = { id: string; unit_no: string; unit_type: string };

const REPORTS: ReportKind[] = [
  'RETURN_WORKPAPER', 'PROJECT_LIABILITY', 'BU_WORKING', 'UNIT_LEDGER', 'MEMBER_STATEMENT',
];

/** What each report needs before it can be produced. */
const NEEDS: Record<ReportKind, { project?: boolean; period?: boolean; event?: boolean; unit?: boolean }> = {
  RETURN_WORKPAPER: { period: true },
  PROJECT_LIABILITY: { project: true, period: true },
  BU_WORKING: { project: true, event: true },
  UNIT_LEDGER: { project: true, unit: true },
  MEMBER_STATEMENT: { project: true, unit: true },
};

interface Preview {
  tiles: { label: string; value: string }[];
  rows: string[][];
  columns: string[];
  truncated: number;
}

const BuilderReportsPage: React.FC = () => {
  const { canViewBuilderReports } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();

  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<BuEvent[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  const [kind, setKind] = useState<ReportKind>('RETURN_WORKPAPER');
  const [projectId, setProjectId] = useState('');
  const [eventId, setEventId] = useState('');
  const [unitId, setUnitId] = useState('');

  const [preview, setPreview] = useState<Preview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

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
    if (!projectId) { setEvents([]); setUnits([]); setEventId(''); setUnitId(''); return; }
    void Promise.all([fetchPostedBuEvents(projectId), fetchProjectUnits(projectId)])
      .then(([e, u]) => { setEvents(e); setUnits(u); setEventId(''); setUnitId(''); });
  }, [projectId]);

  const client = useMemo(() => clients.find((c) => c.id === selectedClientId), [clients, selectedClientId]);
  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  const ctx: ReportContext | null = useMemo(() => (client ? {
    clientName: client.name,
    clientGstin: client.gstin || '',
    projectName: project?.name,
    reraNumber: project?.rera_number || undefined,
    periodMonth: selectedMonth,
  } : null), [client, project, selectedMonth]);

  /** Everything the selected report requires is chosen. */
  const ready = !!client
    && (!needs.project || !!projectId)
    && (!needs.period || !!selectedMonth)
    && (!needs.event || !!eventId)
    && (!needs.unit || !!unitId);

  const missing = !client ? 'Select a client'
    : needs.project && !projectId ? 'Select a project'
      : needs.event && !eventId ? 'Select a posted BU event'
        : needs.unit && !unitId ? 'Select a unit'
          : needs.period && !selectedMonth ? 'Select a period' : '';

  const load = useCallback(async () => {
    if (!ready || !ctx) { setPreview(null); return; }
    setIsLoading(true);
    try {
      if (kind === 'BU_WORKING') {
        const r = await fetchBuWorking(eventId);
        if (!r) { setPreview(null); return; }
        setPreview({
          tiles: [
            { label: 'Units in the event', value: String(r.rows.length) },
            { label: 'Taxable at cut-off', value: String(r.taxable.length) },
            { label: 'Unbooked at cut-off', value: String(r.unbooked.length) },
            { label: 'Differential value', value: formatINR(r.totals.differentialValue) },
            { label: 'Tax on differential', value: formatINR(r.totals.cgst + r.totals.sgst) },
          ],
          columns: ['Unit', 'Cut-off', 'Status', 'Agreement', 'Taxed to opening', 'Differential', 'Tax'],
          rows: r.rows.slice(0, 12).map((u) => [
            u.unitNo, u.cutOffDate, u.bookedAtCutOff ? 'Booked' : 'Unbooked — Sch. III',
            formatINR(u.agreementValue), formatINR(u.valueTaxedUptoOpening),
            u.bookedAtCutOff ? formatINR(u.differentialValue) : '—',
            u.bookedAtCutOff ? formatINR(u.differentialCgst + u.differentialSgst) : '—',
          ]),
          truncated: Math.max(0, r.rows.length - 12),
        });
      } else if (kind === 'PROJECT_LIABILITY' || kind === 'RETURN_WORKPAPER') {
        const r = await fetchPeriodReport({
          clientId: selectedClientId,
          periodMonth: selectedMonth,
          projectId: kind === 'PROJECT_LIABILITY' ? projectId : undefined,
        });
        const t = r.summary.totals;
        setPreview({
          tiles: [
            { label: 'Outward taxable value', value: formatINR(t.taxableValue) },
            { label: 'Outward tax', value: formatINR(t.totalTax) },
            { label: 'Reverse charge on FSI', value: formatINR(r.fsiTotal) },
            { label: 'Documents', value: String(r.documents.length) },
          ],
          columns: ['Rate', 'Documents', 'Taxable value', 'CGST', 'SGST', 'Total tax'],
          rows: r.summary.outward.map((b) => [
            `${b.ratePct}% (eff. ${b.effectiveRatePct}%)`, String(b.count),
            formatINR(b.taxableValue), formatINR(b.cgst), formatINR(b.sgst), formatINR(b.totalTax),
          ]),
          truncated: 0,
        });
      } else {
        const r = await fetchUnitLedger(unitId);
        if (!r) { setPreview(null); return; }
        setPreview({
          tiles: [
            { label: 'Agreement value', value: formatINR(r.agreementValue) },
            { label: 'Value taxed', value: formatINR(r.totals.valueTaxed) },
            { label: 'Balance to tax', value: formatINR(r.balanceToTax) },
            { label: 'Received', value: formatINR(r.totals.received) },
            { label: 'Tax discharged', value: formatINR(r.totals.cgst + r.totals.sgst) },
          ],
          columns: ['Date', 'Entry', 'Reference', 'Consideration', 'Tax', 'Value taxed to date'],
          rows: r.entries.slice(0, 12).map((e) => [
            e.date, e.kind, e.status || e.reference,
            formatINR(e.consideration), formatINR(e.cgst + e.sgst),
            formatINR(e.runningValueTaxed),
          ]),
          truncated: Math.max(0, r.entries.length - 12),
        });
      }
    } catch (e) {
      toast.error(`Could not build the report: ${(e as Error).message}`);
      setPreview(null);
    } finally {
      setIsLoading(false);
    }
  }, [ready, ctx, kind, eventId, unitId, projectId, selectedClientId, selectedMonth]);

  useEffect(() => { void load(); }, [load]);

  const exportAs = async (format: 'pdf' | 'xlsx') => {
    if (!ready || !ctx) return;
    setIsExporting(true);
    try {
      if (kind === 'BU_WORKING') {
        const r = await fetchBuWorking(eventId);
        if (!r) throw new Error('BU event not found');
        (format === 'pdf' ? buWorkingPdf : buWorkingExcel)(ctx, r);
      } else if (kind === 'PROJECT_LIABILITY') {
        const r = await fetchPeriodReport({ clientId: selectedClientId, periodMonth: selectedMonth, projectId });
        (format === 'pdf' ? projectLiabilityPdf : projectLiabilityExcel)(ctx, r);
      } else if (kind === 'RETURN_WORKPAPER') {
        const r = await fetchPeriodReport({ clientId: selectedClientId, periodMonth: selectedMonth });
        (format === 'pdf' ? returnWorkpaperPdf : returnWorkpaperExcel)({ ...ctx, projectName: undefined }, r);
      } else {
        const r = await fetchUnitLedger(unitId);
        if (!r) throw new Error('Unit not found');
        if (kind === 'UNIT_LEDGER') (format === 'pdf' ? unitLedgerPdf : unitLedgerExcel)(ctx, r);
        else (format === 'pdf' ? memberStatementPdf : memberStatementExcel)(ctx, r);
      }
      toast.success(`${REPORT_LABEL[kind]} exported`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setIsExporting(false);
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

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        title="Builder Reports"
        subtitle="Working papers and client statements, in Excel and PDF"
        icon={<FolderDown />}
        actions={
          <>
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => exportAs('xlsx')} disabled={!ready || isExporting}>
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
              Excel
            </Button>
            <Button size="sm" className={WS_BTN} onClick={() => exportAs('pdf')} disabled={!ready || isExporting}>
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              PDF
            </Button>
          </>
        }
      />

      <div className="space-y-1">
        <div className={WS_TABS_LIST} role="tablist" aria-label="Report">
          {REPORTS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={cn(WS_TAB, kind === k && WS_TAB_ACTIVE)}
              onClick={() => setKind(k)}
            >
              {REPORT_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{REPORT_DESCRIPTION[kind]}</p>
      </div>

      <Card>
        <CardContent className="px-3 py-2">
          <div className="flex flex-wrap items-start gap-2">
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

            {needs.project && (
              <label className="w-56 space-y-0.5">
                <span className={WS_FILTER_LABEL}>Project</span>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className={WS_CONTROL} aria-label="Project"><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>
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

            {needs.event && (
              <label className="w-64 space-y-0.5">
                <span className={WS_FILTER_LABEL}>BU event</span>
                <Select value={eventId} onValueChange={setEventId}>
                  <SelectTrigger className={WS_CONTROL} aria-label="BU event"><SelectValue placeholder="Select a posted BU event" /></SelectTrigger>
                  <SelectContent>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.bu_date}{e.bu_ref_no ? ` · ${e.bu_ref_no}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {projectId && events.length === 0 && (
                  <span className="block text-[11px] text-muted-foreground">
                    No posted BU events in this project.
                  </span>
                )}
              </label>
            )}

            {needs.unit && (
              <label className="w-48 space-y-0.5">
                <span className={WS_FILTER_LABEL}>Unit</span>
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger className={WS_CONTROL} aria-label="Unit"><SelectValue placeholder="Select unit" /></SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.unit_no}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
          </div>
        </CardContent>
      </Card>

      {!ready && (
        <Card>
          <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
            <FolderDown className="mx-auto mb-2 h-6 w-6 opacity-40" />
            {missing} to build this report.
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Building…
          </CardContent>
        </Card>
      )}

      {ready && !isLoading && preview && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {preview.tiles.map((t) => (
              <KpiTile key={t.label} label={t.label} value={t.value} />
            ))}
          </div>

          <SectionCard
            title={(
              <span className="flex items-center gap-1.5">
                {REPORT_LABEL[kind]}
                <Badge variant="outline" className="text-[10px] font-medium">Preview</Badge>
              </span>
            )}
            description="The exported file carries the full detail; this is the first slice of it."
          >
            {preview.rows.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nothing to report for this selection.
              </p>
            ) : (
              <>
                <Table className={B_TABLE} containerClassName={cn(WS_TABLE_WRAP, 'max-h-[70vh]')}>
                  <TableHeader>
                    <TableRow className={B_TR_HEAD}>
                      {preview.columns.map((c, i) => (
                        <TableHead key={c} className={i >= 3 ? B_TH_NUM : B_TH}>{c}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row, ri) => (
                      <TableRow key={ri} className={B_TR}>
                        {row.map((cell, ci) => (
                          <TableCell key={ci} className={ci >= 3 ? B_TD_NUM : B_TD}>
                            {cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {preview.truncated > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {preview.truncated} more row{preview.truncated > 1 ? 's' : ''} in the export.
                  </p>
                )}
              </>
            )}
          </SectionCard>

          <Note>
            Every figure is read back from what the engines already computed and stored, so a working
            paper cannot disagree with the return it supports. In the Excel copy the numbers are real
            numbers, not formatted text — they can be footed and pivoted directly.
          </Note>
        </>
      )}
    </div>
  );
};

export default BuilderReportsPage;
