import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useMonth } from '@/contexts/MonthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { FolderDown, FileSpreadsheet, FileText, Loader2, Info } from 'lucide-react';
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
        <CardContent className="p-10 text-center text-muted-foreground">
          <p className="text-sm">You do not have permission to view builder reports.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Builder Reports"
        subtitle="Working papers and client statements, in Excel and PDF"
        icon={<FolderDown className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => exportAs('xlsx')} disabled={!ready || isExporting}>
              {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
              Excel
            </Button>
            <Button onClick={() => exportAs('pdf')} disabled={!ready || isExporting}>
              {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
              PDF
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <Label className="mb-1.5 block">Report</Label>
            <div className="flex flex-wrap gap-2">
              {REPORTS.map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={kind === k ? 'default' : 'outline'}
                  onClick={() => setKind(k)}
                >
                  {REPORT_LABEL[k]}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">{REPORT_DESCRIPTION[kind]}</p>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[220px] max-w-xs">
              <Label className="mb-1.5 block">Builder client</Label>
              <SearchableSelect
                options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin || undefined }))}
                value={selectedClientId || ''}
                onValueChange={setSelectedClientId}
                placeholder="Search builder client..."
                searchPlaceholder="Type to search..."
                emptyText="No builder clients found."
              />
            </div>

            {needs.project && (
              <div className="w-56">
                <Label className="mb-1.5 block">Project</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {needs.period && (
              <div className="w-48">
                <Label className="mb-1.5 block">Period</Label>
                <SearchableMonthSelect
                  options={monthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select period"
                />
              </div>
            )}

            {needs.event && (
              <div className="w-64">
                <Label className="mb-1.5 block">BU event</Label>
                <Select value={eventId} onValueChange={setEventId}>
                  <SelectTrigger><SelectValue placeholder="Select a posted BU event" /></SelectTrigger>
                  <SelectContent>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.bu_date}{e.bu_ref_no ? ` · ${e.bu_ref_no}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {projectId && events.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No posted BU events in this project.
                  </p>
                )}
              </div>
            )}

            {needs.unit && (
              <div className="w-48">
                <Label className="mb-1.5 block">Unit</Label>
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.unit_no}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!ready && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <FolderDown className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">{missing} to build this report.</p>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Building…
        </div>
      )}

      {ready && !isLoading && preview && (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {preview.tiles.map((t) => (
                  <div key={t.label}>
                    <p className="text-xs text-muted-foreground">{t.label}</p>
                    <p className="text-sm font-semibold">{t.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {REPORT_LABEL[kind]}
                <Badge variant="outline">Preview</Badge>
              </CardTitle>
              <CardDescription>
                The exported file carries the full detail; this is the first slice of it.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {preview.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">
                  Nothing to report for this selection.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {preview.columns.map((c, i) => (
                          <TableHead key={c} className={i >= 3 ? 'text-right' : ''}>{c}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((row, ri) => (
                        <TableRow key={ri}>
                          {row.map((cell, ci) => (
                            <TableCell key={ci} className={`text-sm ${ci >= 3 ? 'text-right' : ''}`}>
                              {cell}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {preview.truncated > 0 && (
                    <p className="text-xs text-muted-foreground px-4 py-2">
                      {preview.truncated} more row{preview.truncated > 1 ? 's' : ''} in the export.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="text-xs">
              Every figure is read back from what the engines already computed and stored, so a working
              paper cannot disagree with the return it supports. In the Excel copy the numbers are real
              numbers, not formatted text — they can be footed and pivoted directly.
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default BuilderReportsPage;
