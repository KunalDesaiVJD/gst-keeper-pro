/**
 * The Builder workspace — one place, eight steps, in the order the work
 * actually happens.
 *
 * Before this, the module was seven separate destinations reached from four
 * different places, and the thing that makes builder GST hard — that it is a
 * *sequence*, where each month's return depends on masters set up once and on
 * events posted in order — was invisible. Splitting it across a menu asked the
 * employee to hold that sequence in their head.
 *
 * Three ideas hold it together:
 *
 *   One context, hoisted. Client, project and period are chosen once at the top
 *   and every step inherits them. Previously each page picked its own, so
 *   moving between them meant re-selecting, and it was possible to look at one
 *   client's bookings next to another's return without noticing.
 *
 *   The sequence is the navigation. Steps run setup → masters → money in →
 *   BU → deed → corrections → FSI → return. That is the actual dependency
 *   order: you cannot post a BU differential before the receipts exist, and you
 *   cannot file before the FSI consent is resolved.
 *
 *   State on the step, not in a manual. Each step reports what it is waiting
 *   for — no charge elections confirmed, no units, nothing posted this period,
 *   an FSI consent outstanding — so the next action is visible without opening
 *   anything.
 *
 * Reports stays outside deliberately: it is the output of a finished period,
 * read by a different person at a different time, not a step in preparing one.
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
  Settings2, Layers, Receipt, CalendarCheck, FileSignature, Wrench, Landmark,
  FileSpreadsheet, ChevronLeft, ChevronRight, Building, AlertTriangle, Check,
} from 'lucide-react';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import { isFsiConsentBlocked } from '@/lib/builderFsiData';

import BuilderSettingsPage from './BuilderSettingsPage';
import BuilderProjectsPage from './BuilderProjectsPage';
import BuilderProjectDetailPage from './BuilderProjectDetailPage';
import BuilderBookingsPage from './BuilderBookingsPage';
import BuilderBuEventsPage from './BuilderBuEventsPage';
import BuilderDastavejPage from './BuilderDastavejPage';
import BuilderAdjustmentsPage from './BuilderAdjustmentsPage';
import BuilderFsiPage from './BuilderFsiPage';
import BuilderReturnsPage from './BuilderReturnsPage';

interface StepDef {
  key: string;
  label: string;
  /** One line on what this step is for — shown under the rail on wide screens. */
  hint: string;
  icon: React.ReactNode;
  /** Steps that operate on one project cannot open without one. */
  needsProject: boolean;
}

const STEPS: StepDef[] = [
  { key: 'setup', label: 'Client setup', hint: 'Charge heads, FSI and interest elections', icon: <Settings2 className="h-4 w-4" />, needsProject: false },
  { key: 'project', label: 'Project & units', hint: 'Masters, the 15% test, opening balances', icon: <Layers className="h-4 w-4" />, needsProject: false },
  { key: 'bookings', label: 'Bookings & receipts', hint: 'Advances, invoices, TDS', icon: <Receipt className="h-4 w-4" />, needsProject: true },
  { key: 'bu', label: 'BU events', hint: 'The cut-off and the differential', icon: <CalendarCheck className="h-4 w-4" />, needsProject: true },
  { key: 'dastavej', label: 'Dastavej reco', hint: 'Registered sale deeds against the ledger', icon: <FileSignature className="h-4 w-4" />, needsProject: false },
  { key: 'adjustments', label: 'Adjustments', hint: 'Re-rating, credit notes, bounces', icon: <Wrench className="h-4 w-4" />, needsProject: true },
  { key: 'fsi', label: 'TDR / FSI', hint: 'Reverse charge and the consent gate', icon: <Landmark className="h-4 w-4" />, needsProject: true },
  { key: 'returns', label: 'Returns', hint: 'Assemble and push to GSTR-1', icon: <FileSpreadsheet className="h-4 w-4" />, needsProject: false },
];

interface ClientRow { id: string; name: string; gstin: string | null }
interface ProjectRow { id: string; name: string; rera_number: string | null }

/** What each step is waiting for, so the rail can say it without being opened. */
interface Readiness {
  settingsConfirmed: boolean;
  projectCount: number;
  unitCount: number;
  postingCount: number;
  fsiBlocked: boolean;
}

const BuilderWorkspacePage: React.FC = () => {
  const { canViewBuilderReports } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const [params, setParams] = useSearchParams();

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [readiness, setReadiness] = useState<Readiness>({
    settingsConfirmed: false, projectCount: 0, unitCount: 0, postingCount: 0, fsiBlocked: false,
  });

  // Step and project live in the URL so a workspace view is linkable and
  // survives a refresh — an employee mid-period should not lose their place.
  const step = params.get('step') || 'setup';
  const projectId = params.get('project') || '';

  const setStep = useCallback((k: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', k);
      return next;
    }, { replace: true });
  }, [setParams]);

  const setProjectId = useCallback((id: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('project', id); else next.delete('project');
      return next;
    }, { replace: true });
  }, [setParams]);

  /** Opening a project from the list selects it and moves on to its masters. */
  const selectProject = useCallback((id: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('project', id);
      next.set('step', 'project');
      return next;
    }, { replace: true });
  }, [setParams]);

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
        .from('builder_projects').select('id, name, rera_number')
        .eq('client_id', selectedClientId).order('name');
      const rows = (data || []) as ProjectRow[];
      setProjects(rows);
      // Keep the selection honest: a project from another client must not
      // survive a client change, or a step would silently show foreign data.
      if (projectId && !rows.some((p) => p.id === projectId)) setProjectId('');
      else if (!projectId && rows.length === 1) setProjectId(rows[0].id);
    })();
  }, [selectedClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Readiness, one cheap pass ────────────────────────────────────────────
  useEffect(() => {
    if (!selectedClientId) {
      setReadiness({ settingsConfirmed: false, projectCount: 0, unitCount: 0, postingCount: 0, fsiBlocked: false });
      return;
    }
    (async () => {
      const [settings, projs, units, postings, blocked] = await Promise.all([
        supabase.from('builder_client_settings')
          .select('confirmation_received_at').eq('client_id', selectedClientId).maybeSingle(),
        supabase.from('builder_projects')
          .select('id', { count: 'exact', head: true }).eq('client_id', selectedClientId),
        projectId
          ? supabase.from('builder_units').select('id', { count: 'exact', head: true }).eq('project_id', projectId)
          : Promise.resolve({ count: 0 }),
        selectedMonth
          ? supabase.from('builder_period_postings').select('source_id', { count: 'exact', head: true })
            .eq('client_id', selectedClientId).eq('period_month', selectedMonth)
          : Promise.resolve({ count: 0 }),
        selectedMonth ? isFsiConsentBlocked(selectedClientId, selectedMonth) : Promise.resolve(false),
      ]);
      setReadiness({
        // Confirmed means the client replied in writing, not merely that we asked:
        // the elections change the GST charged to their members.
        settingsConfirmed: !!(settings as { data?: { confirmation_received_at?: string } })
          ?.data?.confirmation_received_at,
        projectCount: (projs as { count?: number }).count || 0,
        unitCount: (units as { count?: number }).count || 0,
        postingCount: (postings as { count?: number }).count || 0,
        fsiBlocked: blocked === true,
      });
    })();
  }, [selectedClientId, projectId, selectedMonth, step]);

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

  /** A short status word per step, and whether it wants attention. */
  const statusOf = useCallback((k: string): { text: string; tone: 'ok' | 'warn' | 'idle' } => {
    switch (k) {
      case 'setup':
        return readiness.settingsConfirmed
          ? { text: 'Confirmed', tone: 'ok' }
          : { text: 'Not confirmed', tone: 'warn' };
      case 'project':
        if (!readiness.projectCount) return { text: 'No projects', tone: 'warn' };
        if (projectId && !readiness.unitCount) return { text: 'No units', tone: 'warn' };
        return { text: `${readiness.projectCount} project${readiness.projectCount === 1 ? '' : 's'}`, tone: 'ok' };
      case 'fsi':
        return readiness.fsiBlocked
          ? { text: 'Consent pending', tone: 'warn' }
          : { text: '', tone: 'idle' };
      case 'returns':
        if (readiness.fsiBlocked) return { text: 'Blocked', tone: 'warn' };
        return readiness.postingCount
          ? { text: `${readiness.postingCount} posting${readiness.postingCount === 1 ? '' : 's'}`, tone: 'ok' }
          : { text: 'Nothing posted', tone: 'idle' };
      default:
        return { text: '', tone: 'idle' };
    }
  }, [readiness, projectId]);

  const activeIdx = Math.max(0, STEPS.findIndex((s) => s.key === step));
  const activeStep = STEPS[activeIdx];
  const needsProjectNow = activeStep?.needsProject && !projectId;

  if (!canViewBuilderReports()) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-muted-foreground">
          <p className="text-sm">You do not have permission to view the builder module.</p>
        </CardContent>
      </Card>
    );
  }

  const renderStep = () => {
    if (!selectedClientId) {
      return (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Building className="mx-auto mb-3 h-8 w-8 opacity-40" />
            <p className="text-sm">Choose a builder client above to begin.</p>
          </CardContent>
        </Card>
      );
    }
    if (needsProjectNow) {
      return (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Layers className="mx-auto mb-3 h-8 w-8 opacity-40" />
            <p className="text-sm">
              {activeStep.label} works on one project. Pick one above
              {readiness.projectCount === 0 ? ', or create one first.' : '.'}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setStep('project')}>
              Go to Project &amp; units
            </Button>
          </CardContent>
        </Card>
      );
    }
    switch (step) {
      case 'setup': return <BuilderSettingsPage />;
      case 'project': return projectId ? <BuilderProjectDetailPage /> : <BuilderProjectsPage />;
      case 'bookings': return <BuilderBookingsPage />;
      case 'bu': return <BuilderBuEventsPage />;
      case 'dastavej': return <BuilderDastavejPage />;
      case 'adjustments': return <BuilderAdjustmentsPage />;
      case 'fsi': return <BuilderFsiPage />;
      case 'returns': return <BuilderReturnsPage />;
      default: return null;
    }
  };

  return (
    <BuilderWorkspaceProvider projectId={projectId || undefined} selectProject={selectProject}>
      <div className="space-y-5">
        {/* ── Context bar. Chosen once; every step inherits it. ───────────── */}
        <Card className="sticky top-0 z-20 border-primary/20 bg-card/95 backdrop-blur">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-2 pr-1">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Building className="h-4 w-4 text-primary" />
                </span>
                <span className="text-sm font-semibold">Builder</span>
              </div>
              <div className="min-w-[200px] flex-1 max-w-xs">
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
              <div className="w-56">
                <Label className="mb-1 block text-xs">Project</Label>
                <Select
                  value={projectId || 'NONE'}
                  onValueChange={(v) => setProjectId(v === 'NONE' ? '' : v)}
                  disabled={!selectedClientId}
                >
                  <SelectTrigger><SelectValue placeholder="All / none" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">
                      {projects.length ? 'No project selected' : 'No projects yet'}
                    </SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-44">
                <Label className="mb-1 block text-xs">Period</Label>
                <SearchableMonthSelect
                  options={monthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select period"
                />
              </div>
              {readiness.fsiBlocked && (
                <Badge variant="outline" className="mb-1 gap-1 border-amber-500/50 text-amber-700 dark:text-amber-500">
                  <AlertTriangle className="h-3 w-3" /> FSI consent pending
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5 lg:flex-row">
          {/* ── Step rail ───────────────────────────────────────────────── */}
          <nav className="lg:w-64 lg:shrink-0" aria-label="Builder steps">
            <ol className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
              {STEPS.map((s, i) => {
                const isActive = s.key === step;
                const status = statusOf(s.key);
                const locked = s.needsProject && !projectId;
                return (
                  <li key={s.key} className="shrink-0 lg:shrink">
                    <button
                      type="button"
                      onClick={() => setStep(s.key)}
                      aria-current={isActive ? 'step' : undefined}
                      className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors
                        ${isActive
                          ? 'border-primary bg-primary/5'
                          : 'border-transparent hover:border-border hover:bg-muted/50'}`}
                    >
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold
                          ${isActive ? 'bg-primary text-primary-foreground'
                            : status.tone === 'ok' ? 'bg-emerald-500/15 text-emerald-600'
                            : status.tone === 'warn' ? 'bg-amber-500/15 text-amber-600'
                            : 'bg-muted text-muted-foreground'}`}
                      >
                        {status.tone === 'ok' && !isActive ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className={`block whitespace-nowrap text-sm lg:whitespace-normal
                          ${isActive ? 'font-semibold' : 'font-medium'} ${locked ? 'text-muted-foreground' : ''}`}
                        >
                          {s.label}
                        </span>
                        <span className="hidden text-xs text-muted-foreground lg:block">{s.hint}</span>
                        {status.text && (
                          <span className={`hidden text-xs lg:block
                            ${status.tone === 'warn' ? 'text-amber-600' : 'text-muted-foreground'}`}
                          >
                            {status.text}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {/* ── Step content ────────────────────────────────────────────── */}
          <div className="min-w-0 flex-1 space-y-5">
            {renderStep()}

            {/* Sequential movement, because the steps are a sequence. */}
            {selectedClientId && (
              <div className="flex items-center justify-between border-t pt-4">
                <Button
                  variant="outline" size="sm"
                  disabled={activeIdx <= 0}
                  onClick={() => setStep(STEPS[activeIdx - 1].key)}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {activeIdx > 0 ? STEPS[activeIdx - 1].label : 'Back'}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Step {activeIdx + 1} of {STEPS.length}
                </span>
                <Button
                  variant="outline" size="sm"
                  disabled={activeIdx >= STEPS.length - 1}
                  onClick={() => setStep(STEPS[activeIdx + 1].key)}
                >
                  {activeIdx < STEPS.length - 1 ? STEPS[activeIdx + 1].label : 'Next'}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </BuilderWorkspaceProvider>
  );
};

export default BuilderWorkspacePage;
