// Notices & Litigation · Litigation MIS (roadmap Phase 2; audit U-100-1..5,
// U-101-1..4, U-102-1..3, U-103-1..3, U-104-1..3, U-105-1..3, U-106-1..3 and
// cross-cutting ui-c: shell header, house style, URL state, exports gated and
// toasted, failures never shown as ₹0). One filter bar shared by every tab,
// the tab and filters in the URL, an "as at" line, and every number opening a
// list with the same count: the Matters list through its URL filters, or the
// page's own list of the matters behind the number (?show=).
import React, { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Note } from '@/components/gstr9/ui';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { fmtDateTime, fmtFy, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { loadMatterList } from '@/lib/litigationData';
import {
  buildMisData, buildReport, drillView, lifecycleLabel, loadMisExtras, mattersHref, readFilters, type MisFilters, type MisLinks,
} from '@/components/litigation/mis/misData';
import { exportMisExcel, exportMisPdf, type MisTab } from '@/components/litigation/mis/misExport';
import { MisFilterBar } from '@/components/litigation/mis/MisFilterBar';
import { MatterDrill } from '@/components/litigation/mis/MatterDrill';
import { MisOverview } from '@/components/litigation/mis/MisOverview';
import { MisClients } from '@/components/litigation/mis/MisClients';
import { MisBreakdown, type BreakdownBy } from '@/components/litigation/mis/MisBreakdown';
import { MisAgeing } from '@/components/litigation/mis/MisAgeing';
import { MisStaff } from '@/components/litigation/mis/MisStaff';
import { MisHearings } from '@/components/litigation/mis/MisHearings';
import { EmptyBox } from '@/components/litigation/mis/ui';

const TABS: { key: MisTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'clients', label: 'By client' },
  { key: 'breakdown', label: 'By forum & stage' },
  { key: 'ageing', label: 'Clocks & ageing' },
  { key: 'staff', label: 'Per staff' },
  { key: 'hearings', label: 'Hearings' },
];
// The tab names of the old page, so a link written against them still lands.
const ALIASES: Record<string, { tab: MisTab; by?: BreakdownBy }> = {
  exposure: { tab: 'overview' }, 'by-client': { tab: 'clients' }, 'by-stage': { tab: 'breakdown', by: 'stage' },
  'by-lifecycle': { tab: 'breakdown', by: 'lifecycle' }, 'per-staff': { tab: 'staff' },
};

const LitigationMISPage: React.FC = () => {
  const { isStaffRole, canExportData } = useAuth();
  const [sp, setSp] = useSearchParams();
  // The Matters list's own rows and cache key, so both screens count the same matters.
  const list = useQuery({ queryKey: ['matter-list'], queryFn: loadMatterList });
  const extras = useQuery({ queryKey: ['litigation-mis-extras'], queryFn: loadMisExtras, staleTime: 60_000 });
  const data = useMemo(() => (list.data && extras.data ? buildMisData(list.data, extras.data) : undefined), [list.data, extras.data]);
  const loadError = list.error ?? extras.error;
  const fetching = list.isFetching || extras.isFetching;
  const refetch = () => { list.refetch(); extras.refetch(); };
  const [busy, setBusy] = useState<null | 'tab' | 'all' | 'pdf'>(null);

  const rawTab = sp.get('tab') ?? 'overview';
  const alias = ALIASES[rawTab];
  const tab: MisTab = alias?.tab ?? (TABS.some((t) => t.key === rawTab) ? (rawTab as MisTab) : 'overview');
  const byRaw = sp.get('by') ?? alias?.by;
  const by: BreakdownBy = byRaw === 'stage' || byRaw === 'lifecycle' ? byRaw : 'forum';
  const show = sp.get('show');
  const filters = useMemo(() => readFilters(sp), [sp]);
  const report = useMemo(() => (data ? buildReport(data, filters) : null), [data, filters]);
  const drill = useMemo(() => (report && data ? drillView(show, report, data.staff) : null), [show, report, data]);

  const links: MisLinks = useMemo(() => {
    const href = (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(sp);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      const s = next.toString();
      return `/litigation-mis${s ? `?${s}` : ''}`;
    };
    return {
      drill: (key, patch = {}) => href({ ...patch, show: key }),
      tab: (t, patch = {}) => href({ ...patch, tab: t === 'overview' ? undefined : t, by: patch.by, show: undefined }),
      matters: (extra = {}) => mattersHref({ ...filters, ...extra }),
    };
  }, [sp, filters]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setSp(next);
  };
  const onTab = (t: string) => update({ tab: t === 'overview' ? undefined : t, by: undefined, show: undefined });
  const onFilters = (patch: MisFilters) => update(patch as Record<string, string | undefined>);

  const updatedAt = Math.max(list.dataUpdatedAt, extras.dataUpdatedAt);
  const asAt = updatedAt ? fmtDateTime(new Date(updatedAt).toISOString()) : '';
  const filterText = [
    filters.client && `Client: ${data?.clients.find((c) => c.id === filters.client)?.name ?? 'one client'}`,
    filters.owner && `Owner: ${filters.owner === 'none' ? 'Unassigned' : data?.staff.find((s) => s.userId === filters.owner)?.name ?? 'one person'}`,
    filters.lifecycle && `Lifecycle: ${lifecycleLabel(filters.lifecycle)}`,
    filters.priority && `Priority: ${filters.priority}`,
    filters.fy && (filters.fy === 'none' ? 'FY not stated' : `FY ${fmtFy(filters.fy)}`),
    filters.form && `Form: ${filters.form === 'none' ? 'not recognised' : filters.form}`,
  ].filter(Boolean).join(' · ');

  const runExport = async (kind: 'tab' | 'all' | 'pdf') => {
    if (!report) return;
    setBusy(kind);
    try {
      const name = kind === 'pdf' ? await exportMisPdf(report, asAt, filterText) : await exportMisExcel(kind === 'all' ? 'all' : tab, report, asAt, filterText);
      toast.success(`Saved ${name}`);
    } catch (e) {
      toast.error(`Couldn't export the MIS: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const exportButton = (kind: 'tab' | 'all' | 'pdf', label: string, Icon: typeof Download) => (
    <Button key={kind} size="sm" variant="outline" className={WS_BTN} disabled={!report || busy !== null} onClick={() => runExport(kind)}>
      {busy === kind ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Icon className="h-3.5 w-3.5" aria-hidden />} {label}
    </Button>
  );
  const exports = canExportData() ? [
    exportButton('tab', 'Excel: this tab', Download),
    exportButton('all', 'Excel: all', Download),
    exportButton('pdf', 'PDF pack', FileText),
  ] : null;

  const refreshButton = (
    <Button key="refresh" size="sm" variant="outline" className={WS_BTN} onClick={refetch} disabled={fetching} title={`Open matters as at ${asAt} IST`}>
      <RefreshCw className={cn('h-3.5 w-3.5', fetching && 'animate-spin')} aria-hidden /> Refresh
    </Button>
  );

  return (
    <NoticesShell section="Litigation MIS" master>
      <MisFilterBar master data={data} filters={filters} onChange={onFilters} actions={[refreshButton, ...(exports ?? [])]} />

      {loadError ? (
        <Note tone="warn">
          Couldn't load the litigation MIS, so no figure is shown: {loadError instanceof Error ? loadError.message : String(loadError)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={refetch}><RefreshCw className="mr-1 h-3 w-3" aria-hidden /> Retry</Button>
        </Note>
      ) : !report || !data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[74px]" />)}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : data.matters.length === 0 ? (
        <EmptyBox>
          No litigation matter yet. Open one from a notice or from the{' '}
          <Link to="/litigation" className="text-primary underline underline-offset-2">Matters</Link> list.
        </EmptyBox>
      ) : (
        <Tabs value={tab} onValueChange={onTab} className="space-y-3">
          <div className="sm:hidden">
            <Select value={tab} onValueChange={onTab}>
              <SelectTrigger className="h-9 text-sm" aria-label="MIS view"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TABS.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <TabsList className={cn(TAB_LIST_CLASS, 'hidden sm:flex')} aria-label="MIS view">
            {TABS.map((t) => <TabsTrigger key={t.key} value={t.key} className={TAB_TRIGGER_CLASS}>{t.label}</TabsTrigger>)}
          </TabsList>

          {show && (drill
            ? <MatterDrill view={drill} closeTo={links.drill('')} />
            : <Note tone="warn">That list is no longer available. <Link to={links.drill('')} className="underline underline-offset-2">Close it</Link></Note>)}

          <TabsContent value="overview" className="mt-0"><MisOverview r={report} links={links} /></TabsContent>
          <TabsContent value="clients" className="mt-0"><MisClients r={report} links={links} /></TabsContent>
          <TabsContent value="breakdown" className="mt-0"><MisBreakdown r={report} links={links} by={by} /></TabsContent>
          <TabsContent value="ageing" className="mt-0"><MisAgeing r={report} links={links} /></TabsContent>
          <TabsContent value="staff" className="mt-0"><MisStaff r={report} links={links} /></TabsContent>
          <TabsContent value="hearings" className="mt-0">
            <MisHearings next14={report.hearings.next14} later={report.hearings.later} allHearings={data.allHearings} links={links} />
          </TabsContent>
        </Tabs>
      )}
    </NoticesShell>
  );
};

export default LitigationMISPage;
