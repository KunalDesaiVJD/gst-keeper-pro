/**
 * The Builder workspace — Option A.
 *
 * Three horizontal tabs, because that is the real shape of the work:
 *
 *   Ledger      everything about the project as it stands — the unit grid, and
 *               the flows that write to it (receipts, adjustments, TDR/FSI,
 *               dastavej) reached from inside it rather than from a menu.
 *   BU Working  the cut-off event and the differential. Separate because it is
 *               a one-off per project that fires a large liability, and burying
 *               it inside the ledger would make it easy to miss.
 *   Returns     assemble the period and hand it to GSTR-1.
 *
 * The earlier vertical rail was replaced for a plain reason: it cost a fifth of
 * the screen width permanently, on a module whose central object is a wide
 * table. Eight steps down the side also implied a wizard the work does not
 * follow — a staffer keying June's receipts is not "on step 3".
 *
 * The grid is the front door of the Ledger tab because the question asked most
 * often is "where does this project stand", not "what happened to unit 101".
 * Sub-views sit behind chips inside the tab, so steps 2–7 are one destination.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useMonth } from '@/contexts/MonthContext';
import { BuilderWorkspaceProvider } from '@/contexts/BuilderWorkspaceContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Building, Layers, CalendarCheck, FileSpreadsheet, AlertTriangle, Settings2,
} from 'lucide-react';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import { formatINR } from '@/utils/builderRates';
import { isFsiConsentBlocked } from '@/lib/builderFsiData';
import BuilderUnitGrid, { type UnitGridAction } from '@/components/builder/BuilderUnitGrid';

import BuilderSettingsPage from './BuilderSettingsPage';
import BuilderProjectsPage from './BuilderProjectsPage';
import BuilderProjectDetailPage from './BuilderProjectDetailPage';
import BuilderBookingsPage from './BuilderBookingsPage';
import BuilderBuEventsPage from './BuilderBuEventsPage';
import BuilderDastavejPage from './BuilderDastavejPage';
import BuilderAdjustmentsPage from './BuilderAdjustmentsPage';
import BuilderFsiPage from './BuilderFsiPage';
import BuilderReturnsPage from './BuilderReturnsPage';

/** Primary tabs. Three, horizontal, always visible. */
const TABS = [
  { key: 'ledger', label: 'Ledger', icon: <Layers className="h-4 w-4" /> },
  { key: 'bu', label: 'BU Working', icon: <CalendarCheck className="h-4 w-4" /> },
  { key: 'returns', label: 'Returns', icon: <FileSpreadsheet className="h-4 w-4" /> },
];

/**
 * Sub-views inside Ledger. `units` is the grid; the rest are the existing
 * flows, now reached from within the tab instead of from the sidebar.
 * `needsInvoicing` marks what disappears for a client that raises no invoices.
 */
const LEDGER_VIEWS = [
  { key: 'units', label: 'Units', needsProject: true },
  { key: 'masters', label: 'Project masters', needsProject: true },
  { key: 'money', label: 'Receipts & invoices', needsProject: true },
  { key: 'adjustments', label: 'Adjustments', needsProject: true },
  { key: 'fsi', label: 'TDR / FSI', needsProject: true },
  { key: 'dastavej', label: 'Dastavej reco', needsProject: false },
];

interface ClientRow { id: string; name: string; gstin: string | null }
interface ProjectRow { id: string; name: string; is_metro: boolean }

const BuilderWorkspacePage: React.FC = () => {
  const { canViewBuilderReports } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const [params, setParams] = useSearchParams();

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [fsiBlocked, setFsiBlocked] = useState(false);
  const [postingCount, setPostingCount] = useState(0);
  const [periodTax, setPeriodTax] = useState(0);
  const [showSetup, setShowSetup] = useState(false);

  // Tab, sub-view and project live in the URL, so a workspace view is linkable
  // and survives a refresh — an employee mid-period keeps their place.
  const tab = params.get('tab') || 'ledger';
  const view = params.get('view') || 'units';
  const projectId = params.get('project') || '';

  const patch = useCallback((kv: Record<string, string>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(kv).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      return next;
    }, { replace: true });
  }, [setParams]);

  const selectProject = useCallback(
    (id: string) => patch({ project: id, tab: 'ledger', view: 'units' }),
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

  useEffect(() => {
    if (!selectedClientId) { setProjects([]); return; }
    (async () => {
      const { data } = await supabase
        .from('builder_projects').select('id, name, is_metro')
        .eq('client_id', selectedClientId).order('name');
      const rows = (data || []) as ProjectRow[];
      setProjects(rows);
      // A project belonging to another client must not survive a client change,
      // or a view would quietly render foreign data under the new heading.
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

  const project = projects.find((p) => p.id === projectId) || null;

  /**
   * Row actions on the grid. They deep-link into the sub-view that owns the
   * flow rather than duplicating its dialog — the adjustment engine has one
   * implementation and it stays there.
   */
  const gridActions: UnitGridAction[] = useMemo(() => [
    { key: 'receipt', group: 'Money in', label: 'Add receipt or invoice', onSelect: () => patch({ view: 'money' }) },
    { key: 'ledger', group: 'Money in', label: 'Open unit ledger', onSelect: () => patch({ view: 'money' }) },
    { key: 'credit', group: 'Corrections', label: 'Credit note', onSelect: () => patch({ view: 'adjustments' }) },
    { key: 'rerate', group: 'Corrections', label: 'Re-rate (Table 10)', onSelect: () => patch({ view: 'adjustments' }) },
    { key: 'bounce', group: 'Corrections', label: 'Bounce reversal', onSelect: () => patch({ view: 'adjustments' }) },
    { key: 'convert', group: 'Corrections', label: 'Convert to another unit', onSelect: () => patch({ view: 'adjustments' }) },
    { key: 'masters', group: 'Masters', label: 'Edit unit & charge heads', onSelect: () => patch({ view: 'masters' }) },
    { key: 'dastavej', group: 'Masters', label: 'Record dastavej', onSelect: () => patch({ view: 'dastavej' }) },
  ], [patch]);

  if (!canViewBuilderReports()) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-muted-foreground">
          <p className="text-sm">You do not have permission to view the builder module.</p>
        </CardContent>
      </Card>
    );
  }

  const needsProject = (v: string) => LEDGER_VIEWS.find((x) => x.key === v)?.needsProject;

  const renderLedger = () => {
    if (!projectId && needsProject(view)) {
      // No project chosen: the project list *is* the useful thing to show, not
      // an empty state telling you to go and find one.
      return <BuilderProjectsPage />;
    }
    switch (view) {
      case 'units':
        return project
          ? (
            <BuilderUnitGrid
              projectId={project.id}
              isMetro={project.is_metro}
              actions={gridActions}
              onAddUnits={() => patch({ view: 'masters' })}
            />
          )
          : <BuilderProjectsPage />;
      case 'masters': return <BuilderProjectDetailPage />;
      case 'money': return <BuilderBookingsPage />;
      case 'adjustments': return <BuilderAdjustmentsPage />;
      case 'fsi': return <BuilderFsiPage />;
      case 'dastavej': return <BuilderDastavejPage />;
      default: return null;
    }
  };

  return (
    <BuilderWorkspaceProvider projectId={projectId || undefined} selectProject={selectProject}>
      <div className="space-y-4">
        {/* ── Context, chosen once and inherited by every tab ─────────────── */}
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-3">
            <span className="flex items-center gap-2 pb-1 pr-1">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Building className="h-4 w-4 text-primary" />
              </span>
              <span className="text-sm font-semibold">Builder</span>
            </span>
            <div className="min-w-[200px] max-w-xs flex-1">
              <Label className="mb-1 block text-xs">Client</Label>
              <SearchableSelect
                options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin || undefined }))}
                value={selectedClientId || ''}
                onValueChange={setSelectedClientId}
                placeholder="Search builder client..."
                searchPlaceholder="Type to search..."
                emptyText="No builder clients found."
              />
            </div>
            <div className="w-52">
              <Label className="mb-1 block text-xs">Project</Label>
              <Select
                value={projectId || 'NONE'}
                onValueChange={(v) => patch({ project: v === 'NONE' ? '' : v })}
                disabled={!selectedClientId}
              >
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">
                    {projects.length ? 'All projects' : 'No projects yet'}
                  </SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Label className="mb-1 block text-xs">Period</Label>
              <SearchableMonthSelect
                options={monthOptions}
                value={selectedMonth}
                onValueChange={setSelectedMonth}
                placeholder="Period"
              />
            </div>
            <div className="ml-auto flex items-center gap-2 pb-0.5">
              {fsiBlocked && (
                <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-500">
                  <AlertTriangle className="h-3 w-3" /> FSI consent pending
                </Badge>
              )}
              <Button
                variant={showSetup ? 'default' : 'outline'} size="sm"
                onClick={() => setShowSetup((v) => !v)}
                disabled={!selectedClientId}
              >
                <Settings2 className="mr-1.5 h-4 w-4" />
                Client setup
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Setup is a panel, not a step — opened when something changes, which
            for most clients is once, at onboarding. */}
        {showSetup && selectedClientId && (
          <Card><CardContent className="p-0"><BuilderSettingsPage /></CardContent></Card>
        )}

        {!selectedClientId ? (
          <Card>
            <CardContent className="p-10 text-center text-muted-foreground">
              <Building className="mx-auto mb-3 h-8 w-8 opacity-40" />
              <p className="text-sm">Choose a builder client above to begin.</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {/* ── Primary tabs, horizontal ──────────────────────────────── */}
            <div className="flex overflow-x-auto border-b bg-card px-2" role="tablist" aria-label="Builder">
              {TABS.map((t) => {
                const on = t.key === tab;
                return (
                  <button
                    key={t.key} type="button" role="tab" aria-selected={on}
                    onClick={() => patch({ tab: t.key })}
                    className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors
                      ${on ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                  >
                    {t.icon}{t.label}
                    {t.key === 'returns' && postingCount > 0 && (
                      <Badge variant="outline" className="ml-1 text-[10px]">{formatINR(periodTax)}</Badge>
                    )}
                    {t.key === 'returns' && fsiBlocked && (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Ledger sub-views: steps 2–7, one destination ──────────── */}
            {tab === 'ledger' && (
              <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
                {LEDGER_VIEWS.map((v) => {
                  const on = v.key === view;
                  const locked = v.needsProject && !projectId;
                  return (
                    <button
                      key={v.key} type="button"
                      onClick={() => patch({ view: v.key })}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors
                        ${on ? 'bg-primary text-primary-foreground'
                          : locked ? 'text-muted-foreground/60 hover:bg-muted'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                    >
                      {v.label}
                    </button>
                  );
                })}
                {!projectId && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    Pick a project above, or open one from the list.
                  </span>
                )}
              </div>
            )}

            <CardContent className="p-0">
              {tab === 'ledger' && renderLedger()}
              {tab === 'bu' && (projectId
                ? <BuilderBuEventsPage />
                : <div className="p-10 text-center text-sm text-muted-foreground">
                    A BU event belongs to one project. Choose a project above.
                  </div>)}
              {tab === 'returns' && <BuilderReturnsPage />}
            </CardContent>
          </Card>
        )}
      </div>
    </BuilderWorkspaceProvider>
  );
};

export default BuilderWorkspacePage;
