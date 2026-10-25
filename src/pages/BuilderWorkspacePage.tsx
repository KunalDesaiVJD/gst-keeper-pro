/**
 * The Builder workspace.
 *
 * Four steps in one pinned step bar and nothing else — no rail, no sub-strip.
 *
 *   Ledger      one table, one row per unit, every derived column on it, every
 *               action on the row. Masters, corrections and the deed register
 *               are not places you go: they are things you do to a row.
 *   BU Working  the cut-off event and the differential.
 *   TDR / FSI   project-level reverse charge and the consent gate. It is the one
 *               thing with no unit row to live on, so it keeps a tab.
 *   Returns     assemble the period and hand it to GSTR-1.
 *
 * The sub-navigation is gone because it was never navigation. "Unit overview"
 * was derived columns, "Units & masters" was editing two of them, "Dastavej"
 * was a single date field, and "Corrections" were things that had happened to a
 * unit. All four were facets of one row, split apart because that was how the
 * code was organised rather than how the work is. Putting per-unit facts on the
 * unit row and per-unit actions on the row menu leaves nothing to navigate to.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useMonth } from '@/contexts/MonthContext';
import { BuilderWorkspaceProvider } from '@/contexts/BuilderWorkspaceContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/PageHeader';
import { WS_BTN, WS_CONTROL, WS_FILTER_LABEL, WS_PAGE } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Building, Layers, CalendarCheck, FileSpreadsheet, AlertTriangle, Settings2, Landmark,
  Wallet, Loader2, ChevronLeft, ChevronRight, RotateCcw, MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import { formatINR } from '@/utils/builderRates';
import { isFsiConsentBlocked } from '@/lib/builderFsiData';
import {
  fetchClientBulkOpeningUnits, fetchClientBulkReceiptUnits, fetchClientUnitPositions,
} from '@/lib/builderClientBulkData';

import BuilderSettingsPage from './BuilderSettingsPage';
import BuilderProjectsPage from './BuilderProjectsPage';
import BuilderBookingsPage from './BuilderBookingsPage';
import BuilderBuEventsPage from './BuilderBuEventsPage';
import BuilderFsiPage from './BuilderFsiPage';
import BuilderReturnsPage from './BuilderReturnsPage';
import BuilderItcReversalPage from './BuilderItcReversalPage';
import BuilderProjectSettingsDialog, {
  type BuilderProjectFormRow,
} from '@/components/builder/BuilderProjectSettingsDialog';
import BulkReceiptsDialog, { type BulkReceiptUnit } from '@/components/builder/BulkReceiptsDialog';
import BulkOpeningBalancesDialog, { type BulkOpeningUnit } from '@/components/builder/BulkOpeningBalancesDialog';

const TABS = [
  { key: 'ledger', label: 'Ledger', caption: 'Units, receipts, invoices', icon: <Layers className="h-3.5 w-3.5" /> },
  { key: 'bu', label: 'BU Working', caption: 'Completion & differential', icon: <CalendarCheck className="h-3.5 w-3.5" /> },
  { key: 'fsi', label: 'TDR / FSI', caption: 'Reverse charge, 3.1(d)', icon: <Landmark className="h-3.5 w-3.5" /> },
  { key: 'itc', label: 'ITC Reversal', caption: 'Rules 42 / 43 at BU', icon: <RotateCcw className="h-3.5 w-3.5" /> },
  { key: 'returns', label: 'Returns', caption: 'GSTR-1 & 3B for the month', icon: <FileSpreadsheet className="h-3.5 w-3.5" /> },
];

/** How the client's credit is treated, in the words staff use (positions §7). */
const ITC_TYPE: Record<string, { label: string; hint: string }> = {
  NO_ITC: { label: 'No ITC', hint: 'Every month\'s credit is reversed in full (1% / 5% scheme)' },
  PARTIAL_ITC: { label: 'Partial ITC', hint: 'Credit apportioned by carpet area, commercial share kept' },
  CLAIM_ITC: { label: 'Claims ITC', hint: 'Credit claimed in full' },
};

interface ClientRow { id: string; name: string; gstin: string | null; builder_itc_type: string | null }

interface Snapshot {
  units: number; booked: number; closed: number;
  agreement: number; valueTaxed: number; openAdvance: number; balanceToTax: number; overTaxed: number;
}
type ProjectRow = BuilderProjectFormRow;

const BuilderWorkspacePage: React.FC = () => {
  const { canViewBuilderReports, canManageBuilderProjects, canEnterBuilderReceipts, canManageBuilderUnits } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const [params, setParams] = useSearchParams();

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [fsiBlocked, setFsiBlocked] = useState(false);
  const [postingCount, setPostingCount] = useState(0);
  const [periodTax, setPeriodTax] = useState(0);
  const [showSetup, setShowSetup] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);

  // Client-wide bulk runs — every project the client has, in one grid.
  const [clientReceiptsOpen, setClientReceiptsOpen] = useState(false);
  const [clientReceiptUnits, setClientReceiptUnits] = useState<BulkReceiptUnit[]>([]);
  const [clientOpeningsOpen, setClientOpeningsOpen] = useState(false);
  const [clientOpeningUnits, setClientOpeningUnits] = useState<BulkOpeningUnit[]>([]);
  const [bulkLoading, setBulkLoading] = useState<'' | 'receipts' | 'openings'>('');

  const openClientReceipts = useCallback(async () => {
    if (!selectedClientId) return;
    setBulkLoading('receipts');
    try {
      const { units } = await fetchClientBulkReceiptUnits(selectedClientId);
      if (!units.length) { toast.info('No units available to collect against yet — add units to a project first.'); return; }
      setClientReceiptUnits(units);
      setClientReceiptsOpen(true);
    } catch (e) {
      toast.error(`Could not load receipts: ${(e as Error).message}`);
    } finally {
      setBulkLoading('');
    }
  }, [selectedClientId]);

  const openClientOpenings = useCallback(async () => {
    if (!selectedClientId) return;
    setBulkLoading('openings');
    try {
      const units = await fetchClientBulkOpeningUnits(selectedClientId);
      if (!units.length) { toast.info('No units on any project for this client yet.'); return; }
      setClientOpeningUnits(units);
      setClientOpeningsOpen(true);
    } catch (e) {
      toast.error(`Could not load opening balances: ${(e as Error).message}`);
    } finally {
      setBulkLoading('');
    }
  }, [selectedClientId]);

  // Tab and project live in the URL, so a view is linkable and survives a
  // refresh — an employee mid-period keeps their place.
  const tab = params.get('tab') || 'ledger';
  const projectId = params.get('project') || '';

  const patch = useCallback((kv: Record<string, string>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(kv).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      return next;
    }, { replace: true });
  }, [setParams]);

  const selectProject = useCallback(
    (id: string) => patch({ project: id, tab: 'ledger' }),
    [patch],
  );

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('clients').select('id, name, gstin, builder_itc_type')
        .eq('regular_sub_type', 'Builder').order('name');
      setClients((data || []) as ClientRow[]);
    })();
  }, []);

  const loadProjects = useCallback(async (clientId: string) => {
    const { data } = await supabase
      .from('builder_projects').select('*')
      .eq('client_id', clientId).order('name');
    return (data || []) as unknown as ProjectRow[];
  }, []);

  useEffect(() => {
    if (!selectedClientId) { setProjects([]); return; }
    (async () => {
      const rows = await loadProjects(selectedClientId);
      setProjects(rows);
      // A project belonging to another client must not survive a client change,
      // or a tab would quietly render foreign data under the new heading.
      if (projectId && !rows.some((p) => p.id === projectId)) patch({ project: '' });
      else if (!projectId && rows.length === 1) patch({ project: rows[0].id });
    })();
  }, [selectedClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedClientId || !selectedMonth) {
      setFsiBlocked(false); setPostingCount(0); setPeriodTax(0);
      return;
    }
    (async () => {
      const [{ data: rows }, blocked] = await Promise.all([
        supabase.from('builder_period_postings').select('cgst, sgst')
          .eq('client_id', selectedClientId).eq('period_month', selectedMonth),
        isFsiConsentBlocked(selectedClientId, selectedMonth),
      ]);
      const list = (rows || []) as { cgst: number; sgst: number }[];
      setPostingCount(list.length);
      setPeriodTax(list.reduce((s, r) => s + (Number(r.cgst) || 0) + (Number(r.sgst) || 0), 0));
      setFsiBlocked(blocked === true);
    })();
  }, [selectedClientId, selectedMonth, tab]);

  // The project's position at a glance, read through the same loader the bulk
  // runs use, so it agrees with the Ledger to the rupee. Refreshed whenever the
  // Ledger reloads (every save there ends in one) or a bulk run writes.
  const loadSnapshot = useCallback(async () => {
    if (!selectedClientId || !projectId) { setSnapshot(null); return; }
    try {
      const units = await fetchClientUnitPositions(selectedClientId, projectId);
      const sum = (f: (u: typeof units[number]) => number) => units.reduce((a, u) => a + f(u), 0);
      setSnapshot({
        units: units.length,
        booked: units.filter((u) => !!u.bookingDate && u.status !== 'Cancelled').length,
        closed: units.filter((u) => u.closedAtBu || u.closedPreOnboarding).length,
        agreement: sum((u) => u.agreementValue),
        valueTaxed: sum((u) => u.valueTaxed),
        openAdvance: sum((u) => u.openAdvance),
        balanceToTax: sum((u) => Math.max(0, u.balanceToTax)),
        overTaxed: units.filter((u) => u.balanceToTax < -1).length,
      });
    } catch {
      setSnapshot(null);
    }
  }, [selectedClientId, projectId]);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot, tab]);
  useEffect(() => {
    const again = () => { void loadSnapshot(); };
    window.addEventListener('builder:ledger-loaded', again);
    window.addEventListener('builder:data-changed', again);
    return () => {
      window.removeEventListener('builder:ledger-loaded', again);
      window.removeEventListener('builder:data-changed', again);
    };
  }, [loadSnapshot]);

  // The getting-started steps open the panels this page owns.
  useEffect(() => {
    const setup = () => setShowSetup(true);
    const settings = () => setProjectSettingsOpen(true);
    window.addEventListener('builder:open-setup', setup);
    window.addEventListener('builder:open-project-settings', settings);
    return () => {
      window.removeEventListener('builder:open-setup', setup);
      window.removeEventListener('builder:open-project-settings', settings);
    };
  }, []);

  const monthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = -18; i <= 2; i++) {
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
          You do not have permission to view the builder module.
        </CardContent>
      </Card>
    );
  }

  // A step that works on one project offers the client's projects right here,
  // rather than sending the eye back up to the selector.
  const needsProject = (
    <Card>
      <CardContent className="px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">This step works on one project. Which one?</p>
        {projects.length > 0 ? (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {projects.map((p) => (
              <Button key={p.id} variant="outline" size="sm" className={WS_BTN} onClick={() => patch({ project: p.id })}>
                <Building className="h-3.5 w-3.5" /> {p.name}
              </Button>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">This client has no projects yet: add one on the Ledger step.</p>
        )}
      </CardContent>
    </Card>
  );

  const tabIdx = Math.max(0, TABS.findIndex((t) => t.key === tab));
  const activeProject = projects.find((p) => p.id === projectId);
  const activeClient = clients.find((c) => c.id === selectedClientId);
  const itcType = activeClient?.builder_itc_type ? ITC_TYPE[activeClient.builder_itc_type] : null;

  return (
    <BuilderWorkspaceProvider projectId={projectId || undefined} selectProject={selectProject}>
      <div className={WS_PAGE}>
        {/* ── Context, chosen once and inherited by every tab ─────────────── */}
        <PageHeader
          compact
          title="Builder"
          subtitle="GST on real estate projects"
          icon={<Building />}
          actions={(
            <>
              {fsiBlocked && (
                <Badge variant="warning" className="gap-1 text-[10px] font-medium">
                  <AlertTriangle className="h-3 w-3 text-warning" /> FSI consent pending
                </Badge>
              )}
              {canEnterBuilderReceipts() && (
                <Button
                  variant="outline" size="sm" className={WS_BTN}
                  onClick={openClientReceipts}
                  disabled={!selectedClientId || bulkLoading !== ''}
                  title="Record this month's receipts across every project this client has, block by block"
                >
                  {bulkLoading === 'receipts'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Wallet className="h-3.5 w-3.5" />}
                  Record receipts
                </Button>
              )}
              {canManageBuilderUnits() && (
                <Button
                  variant="outline" size="sm" className={WS_BTN}
                  onClick={openClientOpenings}
                  disabled={!selectedClientId || bulkLoading !== ''}
                  title="Set opening balances across every project this client has, block by block"
                >
                  {bulkLoading === 'openings'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Layers className="h-3.5 w-3.5" />}
                  Opening balances
                </Button>
              )}
              <Button
                variant={showSetup ? 'default' : 'outline'} size="sm" className={WS_BTN}
                onClick={() => setShowSetup((v) => !v)}
                disabled={!selectedClientId}
              >
                <Settings2 className="h-3.5 w-3.5" />
                Client setup
              </Button>
            </>
          )}
        />

        <Card>
          <CardContent className="px-3 py-2">
            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)] lg:max-w-4xl">
              <label className="min-w-0 space-y-0.5">
                <span className={WS_FILTER_LABEL}>Client</span>
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
              <label className="min-w-0 space-y-0.5">
                <span className={WS_FILTER_LABEL}>Project</span>
                <Select
                  value={projectId || 'NONE'}
                  onValueChange={(v) => patch({ project: v === 'NONE' ? '' : v })}
                  disabled={!selectedClientId}
                >
                  <SelectTrigger className={WS_CONTROL} aria-label="Project"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">
                      {projects.length ? 'All projects' : 'No projects yet'}
                    </SelectItem>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="min-w-0 space-y-0.5">
                <span className={WS_FILTER_LABEL}>Period</span>
                <SearchableMonthSelect
                  options={monthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Period"
                  className={WS_CONTROL}
                />
              </label>
            </div>
            {activeClient && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2 text-[11px]">
                {activeClient.gstin && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">{activeClient.gstin}</span>
                )}
                {itcType ? (
                  <Badge variant="outline" className="text-[11px] font-medium" title={itcType.hint}>{itcType.label}</Badge>
                ) : (
                  <Badge variant="warning" className="text-[11px] font-medium" title="Set it on the client master: it decides GSTR-3B Table 4">
                    ITC treatment not set
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  {projects.length} project{projects.length === 1 ? '' : 's'}
                </span>
                {activeProject && (
                  <>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {activeProject.is_metro ? 'Metro (60 sq m limit)' : 'Non-metro (90 sq m limit)'}
                    </span>
                    {activeProject.rera_number && (
                      <span className="text-muted-foreground">RERA {activeProject.rera_number}</span>
                    )}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* The project at a glance: the figures every step works from. The
            Ledger shows its own, as of the chosen period, so not twice there. */}
        {selectedClientId && projectId && tab !== 'ledger' && snapshot && snapshot.units > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <KpiTile
              label="Units"
              value={snapshot.units}
              hint={`${snapshot.booked} booked · ${snapshot.units - snapshot.booked} unbooked`}
            />
            <KpiTile label="Agreement value" value={formatINR(snapshot.agreement)} />
            <KpiTile label="Value taxed to date" value={formatINR(snapshot.valueTaxed)} />
            <KpiTile label="Open advance" value={formatINR(snapshot.openAdvance)} hint="Taxed, not yet invoiced" />
            <KpiTile label="Balance to tax" value={formatINR(snapshot.balanceToTax)} hint="Falls due at BU" />
            <KpiTile
              label="Closed / flags"
              value={`${snapshot.closed} closed`}
              hint={snapshot.overTaxed ? `${snapshot.overTaxed} taxed above agreement` : 'No unit taxed above agreement'}
              tone={snapshot.overTaxed ? 'error' : 'neutral'}
            />
          </div>
        )}

        {/* Setup is a panel, not a step — opened when something changes, which
            for most clients is once, at onboarding. */}
        {showSetup && selectedClientId && (
          <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-3">
            {/* Project masters belong here rather than on the ledger toolbar:
                importing units, naming phases and keying opening balances are
                onboarding jobs done once, and a button for them sat on screen
                every day for the sake of a few minutes at the start. Editing a
                single unit's charge heads is still on that unit's row menu,
                which is where it is actually needed — a charge added later is
                what pushes a unit past ₹45 lakh. */}
            {projectId && (
              <Card className="divide-y">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">Project masters</p>
                    <p className="text-[11px] text-muted-foreground">
                      Units, phases and opening balances for{' '}
                      {activeProject?.name || 'this project'}.
                    </p>
                  </div>
                  <Button
                    variant="outline" size="sm" className={WS_BTN}
                    onClick={() => window.dispatchEvent(new CustomEvent('builder:open-masters'))}
                  >
                    Open
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <Settings2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">Project settings</p>
                    <p className="text-[11px] text-muted-foreground">
                      Metro status, carpet-area source, doc series, opening cut-off and FSI treatment for{' '}
                      {activeProject?.name || 'this project'}.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className={WS_BTN} onClick={() => setProjectSettingsOpen(true)}>
                    Edit
                  </Button>
                </div>
              </Card>
            )}
            <BuilderSettingsPage />
          </div>
        )}

        {!selectedClientId ? (
          <Card>
            <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
              <Building className="mx-auto mb-2 h-6 w-6 opacity-40" />
              Choose a builder client above to begin.
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Step bar: pinned while scrolling, so every step is one click away. */}
            <div className="sticky top-0 z-30 -mx-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
              <div className="flex items-center gap-1.5 py-1.5 md:pr-12">
                <Button
                  variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                  disabled={tabIdx === 0}
                  onClick={() => patch({ tab: TABS[tabIdx - 1].key })}
                  aria-label={tabIdx > 0 ? `Previous: ${TABS[tabIdx - 1].label}` : 'Previous'}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <nav aria-label="Builder" className="min-w-0 flex-1 overflow-x-auto">
                  <ol className="flex min-w-max items-center gap-1" role="tablist">
                    {TABS.map((t, i) => {
                      const on = t.key === tab;
                      const done = i < tabIdx;
                      return (
                        <li key={t.key} className="flex items-center gap-1">
                          {i > 0 && <span aria-hidden className={cn('h-px w-3 lg:w-6', done || on ? 'bg-primary/60' : 'bg-border')} />}
                          <button
                            type="button" role="tab" aria-selected={on}
                            onClick={() => patch({ tab: t.key })}
                            className={cn(
                              'flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-muted',
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                                on ? 'bg-primary-foreground/20' : done ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {i + 1}
                            </span>
                            <span className="flex flex-col leading-tight">
                              <span className="flex items-center gap-1.5 text-sm font-medium">
                                {t.icon}{t.label}
                                {t.key === 'returns' && postingCount > 0 && (
                                  <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px] font-medium leading-none">{formatINR(periodTax)}</Badge>
                                )}
                                {(t.key === 'returns' || t.key === 'fsi') && fsiBlocked && (
                                  <AlertTriangle className={cn('h-3.5 w-3.5', on ? 'text-primary-foreground' : 'text-warning')} aria-label="FSI consent pending" />
                                )}
                              </span>
                              <span className={cn('hidden text-[10.5px] xl:block', on ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                                {t.caption}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
                <Button
                  variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                  disabled={tabIdx === TABS.length - 1}
                  onClick={() => patch({ tab: TABS[tabIdx + 1].key })}
                  aria-label={tabIdx < TABS.length - 1 ? `Next: ${TABS[tabIdx + 1].label}` : 'Next'}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div>
              {tab === 'ledger' && (projectId ? <BuilderBookingsPage /> : <BuilderProjectsPage />)}
              {tab === 'bu' && (projectId ? <BuilderBuEventsPage /> : needsProject)}
              {tab === 'fsi' && (projectId ? <BuilderFsiPage /> : needsProject)}
              {tab === 'itc' && (projectId ? <BuilderItcReversalPage /> : needsProject)}
              {tab === 'returns' && <BuilderReturnsPage />}
            </div>
          </>
        )}

        <BuilderProjectSettingsDialog
          open={projectSettingsOpen}
          onOpenChange={setProjectSettingsOpen}
          clientId={selectedClientId || ''}
          project={projects.find((p) => p.id === projectId) || null}
          readOnly={!canManageBuilderProjects()}
          onSaved={async () => {
            if (selectedClientId) setProjects(await loadProjects(selectedClientId));
          }}
          onDeleted={async () => {
            patch({ project: '' });
            if (selectedClientId) setProjects(await loadProjects(selectedClientId));
          }}
        />

        <BulkReceiptsDialog
          open={clientReceiptsOpen}
          onOpenChange={setClientReceiptsOpen}
          units={clientReceiptUnits}
          docSeriesPrefix={null}
          defaultMonth={selectedMonth}
          onSaved={async () => {
            // Re-pull so a re-opened dialog reflects the balances just recorded.
            if (selectedClientId) {
              const { units } = await fetchClientBulkReceiptUnits(selectedClientId);
              setClientReceiptUnits(units);
            }
            // The Ledger tab (BuilderBookingsPage) loaded its own copy of this
            // data on mount and has no other way to learn this dialog — a
            // sibling under the workspace, not a child — just wrote to it.
            window.dispatchEvent(new CustomEvent('builder:data-changed'));
          }}
        />

        <BulkOpeningBalancesDialog
          open={clientOpeningsOpen}
          onOpenChange={setClientOpeningsOpen}
          units={clientOpeningUnits}
          defaultAsAtDate={null}
          onSaved={async () => {
            if (selectedClientId) setClientOpeningUnits(await fetchClientBulkOpeningUnits(selectedClientId));
            window.dispatchEvent(new CustomEvent('builder:data-changed'));
          }}
        />
      </div>
    </BuilderWorkspaceProvider>
  );
};

export default BuilderWorkspacePage;
