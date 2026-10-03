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
  Wallet, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import { formatINR } from '@/utils/builderRates';
import { isFsiConsentBlocked } from '@/lib/builderFsiData';
import { fetchClientBulkOpeningUnits, fetchClientBulkReceiptUnits } from '@/lib/builderClientBulkData';

import BuilderSettingsPage from './BuilderSettingsPage';
import BuilderProjectsPage from './BuilderProjectsPage';
import BuilderBookingsPage from './BuilderBookingsPage';
import BuilderBuEventsPage from './BuilderBuEventsPage';
import BuilderFsiPage from './BuilderFsiPage';
import BuilderReturnsPage from './BuilderReturnsPage';
import BuilderProjectSettingsDialog, {
  type BuilderProjectFormRow,
} from '@/components/builder/BuilderProjectSettingsDialog';
import BulkReceiptsDialog, { type BulkReceiptUnit } from '@/components/builder/BulkReceiptsDialog';
import BulkOpeningBalancesDialog, { type BulkOpeningUnit } from '@/components/builder/BulkOpeningBalancesDialog';

const TABS = [
  { key: 'ledger', label: 'Ledger', icon: <Layers className="h-3.5 w-3.5" /> },
  { key: 'bu', label: 'BU Working', icon: <CalendarCheck className="h-3.5 w-3.5" /> },
  { key: 'fsi', label: 'TDR / FSI', icon: <Landmark className="h-3.5 w-3.5" /> },
  { key: 'returns', label: 'Returns', icon: <FileSpreadsheet className="h-3.5 w-3.5" /> },
];

interface ClientRow { id: string; name: string; gstin: string | null }
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
        .from('clients').select('id, name, gstin')
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

  const needsProject = (
    <Card>
      <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
        This works on one project. Choose one above.
      </CardContent>
    </Card>
  );

  const tabIdx = Math.max(0, TABS.findIndex((t) => t.key === tab));
  const activeProject = projects.find((p) => p.id === projectId);

  return (
    <BuilderWorkspaceProvider projectId={projectId || undefined} selectProject={selectProject}>
      <div className={WS_PAGE}>
        {/* ── Context, chosen once and inherited by every tab ─────────────── */}
        <PageHeader
          compact
          title="Builder"
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
          </CardContent>
        </Card>

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
            {/* Step bar: pinned while scrolling, so every tab is one click away. */}
            <div className="sticky top-0 z-30 -mx-4 border-b bg-background px-4 md:-mx-6 md:px-6">
              <div className="flex items-center gap-1.5 py-1.5 md:pr-12">
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  disabled={tabIdx === 0}
                  onClick={() => patch({ tab: TABS[tabIdx - 1].key })}
                  aria-label={tabIdx > 0 ? `Previous: ${TABS[tabIdx - 1].label}` : 'Previous'}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <nav aria-label="Builder" className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5" role="tablist">
                    {TABS.map((t, i) => {
                      const on = t.key === tab;
                      return (
                        <button
                          key={t.key} type="button" role="tab" aria-selected={on}
                          onClick={() => patch({ tab: t.key })}
                          className={cn(
                            'flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            on ? 'bg-primary font-medium text-primary-foreground' : 'text-foreground hover:bg-muted',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-semibold',
                              on ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground',
                            )}
                          >
                            {i + 1}
                          </span>
                          {t.icon}{t.label}
                          {t.key === 'returns' && postingCount > 0 && (
                            <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px] font-medium leading-none">{formatINR(periodTax)}</Badge>
                          )}
                          {(t.key === 'returns' || t.key === 'fsi') && fsiBlocked && (
                            <AlertTriangle className={cn('h-3.5 w-3.5', on ? 'text-primary-foreground' : 'text-warning')} aria-label="FSI consent pending" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </nav>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 shrink-0"
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
