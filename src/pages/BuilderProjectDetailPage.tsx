import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBuilderEmbedded, useBuilderProjectId } from '@/contexts/BuilderWorkspaceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  ArrowLeft, Plus, Loader2, Pencil, Trash2, Layers, Home, AlertTriangle, Wallet, Receipt,
  CalendarCheck, Wrench, Landmark,
} from 'lucide-react';
import {
  DEFAULT_CHARGE_INCLUSIONS, RATE_CODE_LABEL, classifyUnit, formatINR, formatPct,
  formatSqM, testRrep,
  type BuilderRateCode, type ChargeHead, type ChargeInclusionSettings,
  type UnitCharge, type UnitType,
} from '@/utils/builderRates';
import { CHARGE_HEADS, fetchBuilderSettings } from '@/lib/builderSettings';
import { CHARGE_HEAD_LABEL } from '@/utils/builderRates';
import BulkAddUnitsDialog from '@/components/builder/BulkAddUnitsDialog';
import BulkOpeningBalancesDialog, { type BulkOpeningUnit } from '@/components/builder/BulkOpeningBalancesDialog';

interface ProjectRow {
  id: string;
  client_id: string;
  name: string;
  rera_number: string | null;
  city: string | null;
  is_metro: boolean;
  grouping_label: string;
  carpet_area_source: 'DERIVED' | 'MANUAL';
  manual_residential_carpet_sqm: number;
  manual_commercial_carpet_sqm: number;
  opening_cutoff_date: string | null;
  status: string;
}

interface GroupRow { id: string; project_id: string; name: string; sort_order: number }

type OnboardingStatus = 'LIVE' | 'CLOSED_PRE_ONBOARDING';

interface UnitRow {
  id: string;
  project_id: string;
  group_id: string | null;
  unit_no: string;
  unit_type: UnitType;
  carpet_area_sqm: number;
  base_consideration: number;
  status: string;
  sort_order: number;
  onboarding_status: OnboardingStatus;
}

interface ChargeRow {
  id: string;
  unit_id: string;
  charge_head: ChargeHead;
  label: string | null;
  amount: number;
  include_override: boolean | null;
}

interface OpeningRow {
  unit_id: string;
  as_at_date: string;
  agreement_value: number;
  cumulative_receipts: number;
  cumulative_value_taxed: number;
  cumulative_cgst: number;
  cumulative_sgst: number;
  cumulative_tds_194ia: number;
}

const UNIT_STATUSES = ['Available', 'Booked', 'Cancelled', 'Converted', 'Closed'];

const emptyUnitForm = {
  unit_no: '',
  group_id: '',
  unit_type: 'Residential' as UnitType,
  carpet_area_sqm: '',
  base_consideration: '',
  status: 'Available',
  onboarding_status: 'LIVE' as OnboardingStatus,
};

const emptyOpeningForm = {
  as_at_date: '',
  agreement_value: '',
  cumulative_receipts: '',
  cumulative_value_taxed: '',
  cumulative_cgst: '',
  cumulative_sgst: '',
  cumulative_tds_194ia: '',
};

interface Props {
  /** Jump straight into a unit's edit or opening-balance dialog, instead of the full unit master. */
  focusUnitId?: string;
  focusAction?: 'editUnit' | 'openingBalance';
}

const BuilderProjectDetailPage: React.FC<Props> = ({ focusUnitId, focusAction }) => {
  const projectId = useBuilderProjectId();
  const embedded = useBuilderEmbedded();
  const navigate = useNavigate();
  const { canManageBuilderProjects, canManageBuilderUnits, user } = useAuth();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [charges, setCharges] = useState<Record<string, ChargeRow[]>>({});
  const [openings, setOpenings] = useState<Record<string, OpeningRow>>({});
  const [settings, setSettings] = useState<ChargeInclusionSettings>(DEFAULT_CHARGE_INCLUSIONS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [unitDialog, setUnitDialog] = useState(false);
  const [bulkDialog, setBulkDialog] = useState(false);
  const [bulkOpeningDialog, setBulkOpeningDialog] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitRow | null>(null);
  const [unitForm, setUnitForm] = useState(emptyUnitForm);
  const [unitCharges, setUnitCharges] = useState<UnitCharge[]>([]);

  const [groupDialog, setGroupDialog] = useState(false);
  const [groupName, setGroupName] = useState('');

  const [openingDialog, setOpeningDialog] = useState(false);
  const [openingUnit, setOpeningUnit] = useState<UnitRow | null>(null);
  const [openingForm, setOpeningForm] = useState(emptyOpeningForm);

  const canEditUnits = canManageBuilderUnits();
  const canEditProject = canManageBuilderProjects();

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const { data: proj, error } = await supabase
        .from('builder_projects').select('*').eq('id', projectId).maybeSingle();
      if (error) throw error;
      if (!proj) { toast.error('Project not found'); navigate('/builder-projects'); return; }
      const p = proj as unknown as ProjectRow;
      setProject(p);

      const [{ data: grp }, { data: unt }, { data: st }] = await Promise.all([
        supabase.from('builder_project_groups').select('*').eq('project_id', projectId).order('sort_order').order('name'),
        supabase.from('builder_units').select('*').eq('project_id', projectId).order('sort_order').order('unit_no'),
        fetchBuilderSettings(p.client_id).then((s) => ({ data: s })),
      ]);
      setGroups((grp || []) as unknown as GroupRow[]);
      const unitRows = (unt || []) as unknown as UnitRow[];
      setUnits(unitRows);
      setSettings(st as ChargeInclusionSettings);

      const ids = unitRows.map((u) => u.id);
      if (ids.length) {
        const [{ data: chg }, { data: opn }] = await Promise.all([
          supabase.from('builder_unit_charges').select('*').in('unit_id', ids),
          supabase.from('builder_opening_balances').select('*').in('unit_id', ids),
        ]);
        const cmap: Record<string, ChargeRow[]> = {};
        ((chg || []) as unknown as ChargeRow[]).forEach((c) => {
          (cmap[c.unit_id] ||= []).push(c);
        });
        setCharges(cmap);
        const omap: Record<string, OpeningRow> = {};
        ((opn || []) as unknown as OpeningRow[]).forEach((o) => { omap[o.unit_id] = o; });
        setOpenings(omap);
      } else {
        setCharges({}); setOpenings({});
      }
    } catch (e) {
      toast.error(`Could not load project: ${(e as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, navigate]);

  useEffect(() => { void load(); }, [load]);

  const handledFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusUnitId || !focusAction || isLoading) return;
    const key = `${focusUnitId}:${focusAction}`;
    if (handledFocusRef.current === key) return;
    const u = units.find((x) => x.id === focusUnitId);
    if (!u) return;
    handledFocusRef.current = key;
    if (focusAction === 'editUnit') openEditUnit(u);
    else openOpening(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusUnitId, focusAction, isLoading, units]);

  // ── The 15% test, from whichever source the project elected ──────────────
  const rrep = useMemo(() => {
    if (!project) return testRrep(0, 0);
    if (project.carpet_area_source === 'MANUAL') {
      return testRrep(project.manual_residential_carpet_sqm, project.manual_commercial_carpet_sqm);
    }
    let resi = 0, comm = 0;
    units.forEach((u) => {
      if (u.status === 'Cancelled') return;
      if (u.unit_type === 'Residential') resi += Number(u.carpet_area_sqm) || 0;
      else comm += Number(u.carpet_area_sqm) || 0;
    });
    return testRrep(resi, comm);
  }, [project, units]);

  /** Classification for a saved unit, using its stored charges. */
  const classifyStored = useCallback((u: UnitRow) => classifyUnit({
    unitType: u.unit_type,
    carpetAreaSqM: Number(u.carpet_area_sqm) || 0,
    baseConsideration: Number(u.base_consideration) || 0,
    charges: (charges[u.id] || []).map((c) => ({
      charge_head: c.charge_head, amount: Number(c.amount) || 0, include_override: c.include_override,
    })),
    isMetro: project?.is_metro ?? false,
    isRrep: rrep.isRrep,
    settings,
  }), [charges, project, rrep.isRrep, settings]);

  /** Feed for the bulk opening-balances grid — one row per unit, in table order. */
  const bulkOpeningUnits: BulkOpeningUnit[] = useMemo(() => units.map((u) => {
    const cls = classifyStored(u);
    const existing = openings[u.id];
    return {
      unitId: u.id,
      unitNo: u.unit_no,
      rateCode: cls.rateCode,
      ratePct: cls.ratePct,
      isAffordable: cls.affordable.isAffordable,
      defaultAgreementValue: cls.gross.gross,
      existing: existing ? {
        as_at_date: existing.as_at_date,
        agreement_value: existing.agreement_value,
        cumulative_receipts: existing.cumulative_receipts,
        cumulative_value_taxed: existing.cumulative_value_taxed,
        cumulative_cgst: existing.cumulative_cgst,
        cumulative_sgst: existing.cumulative_sgst,
        cumulative_tds_194ia: existing.cumulative_tds_194ia,
      } : undefined,
    };
  }), [units, openings, classifyStored]);

  /** Live classification for whatever is currently in the unit dialog. */
  const formClassification = useMemo(() => classifyUnit({
    unitType: unitForm.unit_type,
    carpetAreaSqM: parseFloat(unitForm.carpet_area_sqm) || 0,
    baseConsideration: parseFloat(unitForm.base_consideration) || 0,
    charges: unitCharges,
    isMetro: project?.is_metro ?? false,
    isRrep: rrep.isRrep,
    settings,
  }), [unitForm, unitCharges, project, rrep.isRrep, settings]);

  // ── Units ────────────────────────────────────────────────────────────────
  const openCreateUnit = () => {
    setEditingUnit(null);
    setUnitForm(emptyUnitForm);
    setUnitCharges([]);
    setUnitDialog(true);
  };

  const openEditUnit = (u: UnitRow) => {
    setEditingUnit(u);
    setUnitForm({
      unit_no: u.unit_no,
      group_id: u.group_id || '',
      unit_type: u.unit_type,
      carpet_area_sqm: String(u.carpet_area_sqm ?? ''),
      base_consideration: String(u.base_consideration ?? ''),
      status: u.status,
      onboarding_status: u.onboarding_status || 'LIVE',
    });
    setUnitCharges((charges[u.id] || []).map((c) => ({
      charge_head: c.charge_head, amount: Number(c.amount) || 0, include_override: c.include_override,
    })));
    setUnitDialog(true);
  };

  /**
   * Write a classification history row when a unit's rate or affordable status
   * differs from what was last recorded. This is the audit trail a retrospective
   * re-rating is built on, so it must record the change even when nothing else
   * about the unit moved.
   */
  const recordClassification = async (
    unitId: string,
    cls: ReturnType<typeof classifyUnit>,
    reason: string,
  ) => {
    const { data: last } = await supabase
      .from('builder_unit_classification_history')
      .select('is_affordable, rate_code')
      .eq('unit_id', unitId)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const unchanged = last
      && (last as { is_affordable: boolean }).is_affordable === cls.affordable.isAffordable
      && (last as { rate_code: string }).rate_code === cls.rateCode;
    if (unchanged) return;

    await supabase.from('builder_unit_classification_history').insert({
      unit_id: unitId,
      is_affordable: cls.affordable.isAffordable,
      rate_code: cls.rateCode,
      rate_pct: cls.ratePct,
      effective_rate_pct: cls.effectiveRatePct,
      gross_consideration: cls.gross.gross,
      carpet_area_sqm: parseFloat(unitForm.carpet_area_sqm) || 0,
      area_limit_sqm: cls.areaLimitSqM,
      is_rrep: cls.isRrep,
      reason: last ? reason : 'INITIAL',
      created_by: user?.id ?? null,
    });
  };

  const handleSaveUnit = async () => {
    if (!projectId) return;
    if (!unitForm.unit_no.trim()) { toast.error('Unit number is required'); return; }
    setIsSaving(true);
    try {
      const payload = {
        project_id: projectId,
        group_id: unitForm.group_id || null,
        unit_no: unitForm.unit_no.trim(),
        unit_type: unitForm.unit_type,
        carpet_area_sqm: parseFloat(unitForm.carpet_area_sqm) || 0,
        base_consideration: parseFloat(unitForm.base_consideration) || 0,
        status: unitForm.status,
        onboarding_status: unitForm.onboarding_status,
        updated_by: user?.id ?? null,
      };

      let unitId = editingUnit?.id;
      if (editingUnit) {
        const { error } = await supabase.from('builder_units').update(payload).eq('id', editingUnit.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('builder_units')
          .insert({ ...payload, created_by: user?.id ?? null })
          .select('id').single();
        if (error) throw error;
        unitId = data.id;
      }
      if (!unitId) throw new Error('Unit id missing after save');

      // Charges are replaced wholesale — simpler than diffing, and the set is small.
      await supabase.from('builder_unit_charges').delete().eq('unit_id', unitId);
      const toInsert = unitCharges.filter((c) => (Number(c.amount) || 0) > 0);
      if (toInsert.length) {
        const { error } = await supabase.from('builder_unit_charges').insert(
          toInsert.map((c) => ({
            unit_id: unitId,
            charge_head: c.charge_head,
            amount: Number(c.amount) || 0,
            include_override: c.include_override ?? null,
          })),
        );
        if (error) throw error;
      }

      await recordClassification(unitId, formClassification, 'VALUE_CHANGE');
      toast.success(editingUnit ? 'Unit updated' : 'Unit created');
      setUnitDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not save unit: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUnit = async (u: UnitRow) => {
    if (!window.confirm(`Delete unit ${u.unit_no}? Its charges and opening balance go with it.`)) return;
    const { error } = await supabase.from('builder_units').delete().eq('id', u.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Unit deleted');
    await load();
  };

  const setChargeAmount = (head: ChargeHead, amount: string) => {
    const val = parseFloat(amount) || 0;
    setUnitCharges((prev) => {
      const rest = prev.filter((c) => c.charge_head !== head);
      return val > 0 ? [...rest, { charge_head: head, amount: val, include_override: null }] : rest;
    });
  };
  const chargeAmountOf = (head: ChargeHead): string => {
    const c = unitCharges.find((x) => x.charge_head === head);
    return c ? String(c.amount) : '';
  };

  // ── Groups ───────────────────────────────────────────────────────────────
  const handleAddGroup = async () => {
    if (!projectId || !groupName.trim()) return;
    const { error } = await supabase.from('builder_project_groups').insert({
      project_id: projectId, name: groupName.trim(), sort_order: groups.length,
    });
    if (error) { toast.error(error.message); return; }
    setGroupName(''); setGroupDialog(false);
    toast.success(`${project?.grouping_label || 'Block'} added`);
    await load();
  };

  const handleDeleteGroup = async (g: GroupRow) => {
    if (!window.confirm(`Delete ${g.name}? Units in it stay, but become ungrouped.`)) return;
    const { error } = await supabase.from('builder_project_groups').delete().eq('id', g.id);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  // ── Opening balances ─────────────────────────────────────────────────────
  const openOpening = (u: UnitRow) => {
    const existing = openings[u.id];
    const cls = classifyStored(u);
    setOpeningUnit(u);
    setOpeningForm(existing ? {
      as_at_date: existing.as_at_date,
      agreement_value: String(existing.agreement_value ?? ''),
      cumulative_receipts: String(existing.cumulative_receipts ?? ''),
      cumulative_value_taxed: String(existing.cumulative_value_taxed ?? ''),
      cumulative_cgst: String(existing.cumulative_cgst ?? ''),
      cumulative_sgst: String(existing.cumulative_sgst ?? ''),
      cumulative_tds_194ia: String(existing.cumulative_tds_194ia ?? ''),
    } : {
      ...emptyOpeningForm,
      as_at_date: project?.opening_cutoff_date || '',
      agreement_value: String(cls.gross.gross || ''),
    });
    setOpeningDialog(true);
  };

  const handleSaveOpening = async () => {
    if (!openingUnit) return;
    if (!openingForm.as_at_date) { toast.error('As-at date is required'); return; }
    setIsSaving(true);
    try {
      const cls = classifyStored(openingUnit);
      const { error } = await supabase.from('builder_opening_balances').upsert({
        unit_id: openingUnit.id,
        as_at_date: openingForm.as_at_date,
        agreement_value: parseFloat(openingForm.agreement_value) || 0,
        cumulative_receipts: parseFloat(openingForm.cumulative_receipts) || 0,
        cumulative_value_taxed: parseFloat(openingForm.cumulative_value_taxed) || 0,
        cumulative_cgst: parseFloat(openingForm.cumulative_cgst) || 0,
        cumulative_sgst: parseFloat(openingForm.cumulative_sgst) || 0,
        cumulative_tds_194ia: parseFloat(openingForm.cumulative_tds_194ia) || 0,
        is_affordable_at_opening: cls.affordable.isAffordable,
        rate_code_at_opening: cls.rateCode,
        updated_by: user?.id ?? null,
      }, { onConflict: 'unit_id' });
      if (error) throw error;
      toast.success('Opening balance saved');
      setOpeningDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const groupName_ = (id: string | null) => groups.find((g) => g.id === id)?.name || '—';

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading project…
      </div>
    );
  }
  if (!project) return null;

  const label = project.grouping_label || 'Block';

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        subtitle={[project.rera_number, project.city].filter(Boolean).join(' · ') || 'Builder project'}
        icon={<Layers className="h-5 w-5" />}
        actions={embedded ? undefined : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/builder-projects')}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button variant="outline" onClick={() => navigate(`/builder-projects/${projectId}/fsi`)}>
              <Landmark className="h-4 w-4 mr-2" /> TDR / FSI
            </Button>
            <Button variant="outline" onClick={() => navigate(`/builder-projects/${projectId}/adjustments`)}>
              <Wrench className="h-4 w-4 mr-2" /> Adjustments
            </Button>
            <Button variant="outline" onClick={() => navigate(`/builder-projects/${projectId}/bu-events`)}>
              <CalendarCheck className="h-4 w-4 mr-2" /> BU Events
            </Button>
            <Button onClick={() => navigate(`/builder-projects/${projectId}/bookings`)}>
              <Receipt className="h-4 w-4 mr-2" /> Bookings & Receipts
            </Button>
          </div>
        )}
      />

      {/* ── The 15% test ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-xs text-muted-foreground">Residential carpet</p>
              <p className="text-sm font-semibold">{formatSqM(rrep.residentialSqM)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Commercial carpet</p>
              <p className="text-sm font-semibold">{formatSqM(rrep.commercialSqM)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Commercial share</p>
              <p className="text-sm font-semibold">
                {rrep.isIndeterminate ? '—' : formatPct(rrep.commercialShare)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Classification</p>
              {rrep.isIndeterminate ? (
                <Badge variant="outline">No area yet</Badge>
              ) : rrep.isRrep ? (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">RREP</Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200">REP (other than RREP)</Badge>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Affordable carpet limit</p>
              <p className="text-sm font-semibold">{project.is_metro ? '60 sq m' : '90 sq m'}</p>
            </div>
          </div>
          {!rrep.isIndeterminate && !rrep.isRrep && (
            <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs">
                Commercial carpet area exceeds 15%, so this is a REP other than an RREP. Commercial units
                here are taxed at 18% on 2/3rd value with proportionate credit, and the residential share
                of input tax is reversed by carpet area.
              </p>
            </div>
          )}
          {project.carpet_area_source === 'MANUAL' && (
            <p className="mt-3 text-xs text-muted-foreground">
              Areas are entered manually on the project, not derived from the unit master.
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="units">
        <TabsList>
          <TabsTrigger value="units">Units ({units.length})</TabsTrigger>
          <TabsTrigger value="groups">{label}s ({groups.length})</TabsTrigger>
        </TabsList>

        {/* ── Units ──────────────────────────────────────────────────────── */}
        <TabsContent value="units" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Unit master</CardTitle>
                <CardDescription>
                  Affordable status and rate are derived, never typed. Adding a charge head can push a unit
                  past ₹45 lakh and out of the 1.5% bracket — the derived columns show that immediately.
                </CardDescription>
              </div>
              {canEditUnits && (
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" onClick={() => setBulkDialog(true)}>
                    <Layers className="h-4 w-4 mr-2" /> Add many
                  </Button>
                  <Button variant="outline" onClick={() => setBulkOpeningDialog(true)} disabled={!units.length}>
                    <Wallet className="h-4 w-4 mr-2" /> Opening balances
                  </Button>
                  <Button onClick={openCreateUnit}><Plus className="h-4 w-4 mr-2" /> Add unit</Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {units.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground">
                  <Home className="h-8 w-8 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No units yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unit</TableHead>
                        <TableHead>{label}</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Carpet (sq m)</TableHead>
                        <TableHead className="text-right">Base value</TableHead>
                        <TableHead className="text-right">Charges</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead>Affordable</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead>Opening</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-28" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {units.map((u) => {
                        const cls = classifyStored(u);
                        const opening = openings[u.id];
                        return (
                          <TableRow key={u.id}>
                            <TableCell className="font-medium">
                              {u.unit_no}
                              {u.onboarding_status === 'CLOSED_PRE_ONBOARDING' && (
                                <Badge variant="outline" className="ml-1.5 text-[10px]">Closed pre-onboarding</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{groupName_(u.group_id)}</TableCell>
                            <TableCell className="text-sm">{u.unit_type}</TableCell>
                            <TableCell className="text-right text-sm">{Number(u.carpet_area_sqm).toFixed(3)}</TableCell>
                            <TableCell className="text-right text-sm">{formatINR(u.base_consideration)}</TableCell>
                            <TableCell className="text-right text-sm">
                              {cls.gross.includedCharges > 0 ? formatINR(cls.gross.includedCharges) : '—'}
                              {cls.gross.excludedCharges > 0 && (
                                <span className="block text-xs text-muted-foreground">
                                  {formatINR(cls.gross.excludedCharges)} excl.
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">{formatINR(cls.gross.gross)}</TableCell>
                            <TableCell>
                              {u.unit_type === 'Commercial' ? (
                                <span className="text-xs text-muted-foreground">n/a</span>
                              ) : cls.affordable.isAffordable ? (
                                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Yes</Badge>
                              ) : (
                                <Badge variant="outline">No</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              <span className="font-medium">{cls.ratePct}%</span>
                              <span className="block text-xs text-muted-foreground">eff. {cls.effectiveRatePct}%</span>
                            </TableCell>
                            <TableCell>
                              {opening ? (
                                <Badge className="bg-sky-100 text-sky-800 border-sky-200">Set</Badge>
                              ) : (
                                <Badge variant="outline">—</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={u.status === 'Available' ? 'outline' : 'default'}>{u.status}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-0.5">
                                {canEditUnits && (
                                  <>
                                    <Button variant="ghost" size="icon" title="Opening balance" onClick={() => openOpening(u)}>
                                      <Wallet className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" title="Edit unit" onClick={() => openEditUnit(u)}>
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" title="Delete unit" onClick={() => handleDeleteUnit(u)}>
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Groups ─────────────────────────────────────────────────────── */}
        <TabsContent value="groups" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{label}s</CardTitle>
                <CardDescription>
                  BU permission often arrives {label.toLowerCase()} by {label.toLowerCase()}, so the
                  differential can fire in several months for one project.
                </CardDescription>
              </div>
              {canEditProject && (
                <Button onClick={() => setGroupDialog(true)}><Plus className="h-4 w-4 mr-2" /> Add {label.toLowerCase()}</Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {groups.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground">
                  <Layers className="h-8 w-8 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No {label.toLowerCase()}s defined. Units can stay ungrouped.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{label}</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Carpet (sq m)</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g) => {
                      const gu = units.filter((u) => u.group_id === g.id);
                      const area = gu.reduce((s, u) => s + (Number(u.carpet_area_sqm) || 0), 0);
                      return (
                        <TableRow key={g.id}>
                          <TableCell className="font-medium">{g.name}</TableCell>
                          <TableCell className="text-right text-sm">{gu.length}</TableCell>
                          <TableCell className="text-right text-sm">{area.toFixed(3)}</TableCell>
                          <TableCell>
                            {canEditProject && (
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteGroup(g)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Unit dialog ──────────────────────────────────────────────────── */}
      {project && (
        <BulkAddUnitsDialog
          open={bulkDialog}
          onOpenChange={setBulkDialog}
          projectId={project.id}
          projectName={project.name}
          groups={groups}
          groupingLabel={project.grouping_label}
          isMetro={project.is_metro}
          isRrep={rrep.isRrep}
          settings={settings}
          existingUnitNos={units.map((u) => u.unit_no)}
          onSaved={load}
        />
      )}

      <BulkOpeningBalancesDialog
        open={bulkOpeningDialog}
        onOpenChange={setBulkOpeningDialog}
        units={bulkOpeningUnits}
        defaultAsAtDate={project?.opening_cutoff_date ?? null}
        onSaved={load}
      />

      <Dialog open={unitDialog} onOpenChange={setUnitDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingUnit ? `Edit unit ${editingUnit.unit_no}` : 'Add unit'}</DialogTitle>
            <DialogDescription>
              Charge heads are child rows of the unit. Whether each one counts toward the ₹45 lakh limit
              follows the client's setup elections.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="u-no">Unit number *</Label>
              <Input id="u-no" value={unitForm.unit_no} onChange={(e) => setUnitForm({ ...unitForm, unit_no: e.target.value })} />
            </div>
            <div>
              <Label>{label}</Label>
              <Select
                value={unitForm.group_id || 'NONE'}
                onValueChange={(v) => setUnitForm({ ...unitForm, group_id: v === 'NONE' ? '' : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Ungrouped</SelectItem>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={unitForm.unit_type} onValueChange={(v) => setUnitForm({ ...unitForm, unit_type: v as UnitType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Residential">Residential</SelectItem>
                  <SelectItem value="Commercial">Commercial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={unitForm.status} onValueChange={(v) => setUnitForm({ ...unitForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNIT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="u-area">RERA carpet area (sq m)</Label>
              <Input
                id="u-area" type="number" step="0.001"
                value={unitForm.carpet_area_sqm}
                onChange={(e) => setUnitForm({ ...unitForm, carpet_area_sqm: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="u-base">Base consideration (excl. GST)</Label>
              <Input
                id="u-base" type="number" step="0.01"
                value={unitForm.base_consideration}
                onChange={(e) => setUnitForm({ ...unitForm, base_consideration: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Onboarding status</Label>
              <Select
                value={unitForm.onboarding_status}
                onValueChange={(v) => setUnitForm({ ...unitForm, onboarding_status: v as OnboardingStatus })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LIVE">Live — this software runs its BU/dastavej working on it</SelectItem>
                  <SelectItem value="CLOSED_PRE_ONBOARDING">
                    Closed before onboarding — already fully resolved elsewhere
                  </SelectItem>
                </SelectContent>
              </Select>
              {unitForm.onboarding_status === 'CLOSED_PRE_ONBOARDING' && (
                <div className="mt-2 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p className="text-xs">
                    This unit is skipped by every BU-event sweep and by the dastavej auto-post differential —
                    this software will never compute or post GST for it. It still counts toward the project's
                    carpet area for the 15% test. Only set this where the firm's own records already show the
                    unit fully and correctly taxed before this project was onboarded here.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-2">
            <Label className="mb-2 block">Charge heads</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {CHARGE_HEADS.map((head) => (
                <div key={head} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate" title={CHARGE_HEAD_LABEL[head]}>
                    {CHARGE_HEAD_LABEL[head]}
                  </span>
                  <Input
                    type="number" step="0.01" className="w-36"
                    value={chargeAmountOf(head)}
                    onChange={(e) => setChargeAmount(head, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Live derivation — the whole point of the dialog */}
          <div className="rounded-lg border p-3 mt-2 space-y-2 bg-muted/30">
            <div className="grid gap-2 sm:grid-cols-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Gross amount charged</p>
                <p className="font-semibold">{formatINR(formClassification.gross.gross)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Affordable</p>
                <p className="font-semibold">
                  {unitForm.unit_type === 'Commercial'
                    ? 'n/a'
                    : formClassification.affordable.isAffordable ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Rate</p>
                <p className="font-semibold">
                  {formClassification.ratePct}% on 2/3rd (eff. {formClassification.effectiveRatePct}%)
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">₹45L headroom</p>
                <p className={`font-semibold ${formClassification.affordable.valueHeadroom < 0 ? 'text-destructive' : ''}`}>
                  {formatINR(formClassification.affordable.valueHeadroom)}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{RATE_CODE_LABEL[formClassification.rateCode]}</p>
            {unitForm.unit_type === 'Residential'
              && !formClassification.affordable.isAffordable
              && formClassification.affordable.areaWithinLimit
              && !formClassification.affordable.valueWithinLimit && (
              <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="text-xs">
                  Carpet area is within the limit but gross consideration exceeds ₹45 lakh, so the unit is
                  not affordable. If it was previously taxed at 1.5%, the concession never applied and 7.5%
                  is due on everything already offered to tax.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveUnit} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingUnit ? 'Save changes' : 'Add unit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Group dialog ─────────────────────────────────────────────────── */}
      <Dialog open={groupDialog} onOpenChange={setGroupDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add {label.toLowerCase()}</DialogTitle></DialogHeader>
          <div>
            <Label htmlFor="g-name">Name</Label>
            <Input
              id="g-name" value={groupName} placeholder={`e.g. ${label} A`}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialog(false)}>Cancel</Button>
            <Button onClick={handleAddGroup}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Opening balance dialog ───────────────────────────────────────── */}
      <Dialog open={openingDialog} onOpenChange={setOpeningDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Opening balance — {openingUnit?.unit_no}</DialogTitle>
            <DialogDescription>
              The position carried in from the client's earlier records. "Value already taxed" is the base
              the BU differential deducts from — enter the value offered to tax, not the money received.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="o-date">As at date *</Label>
              <Input
                id="o-date" type="date" value={openingForm.as_at_date}
                onChange={(e) => setOpeningForm({ ...openingForm, as_at_date: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="o-agree">Agreement value (excl. GST)</Label>
              <Input
                id="o-agree" type="number" step="0.01" value={openingForm.agreement_value}
                onChange={(e) => setOpeningForm({ ...openingForm, agreement_value: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="o-recd">Receipts to date (memo)</Label>
              <Input
                id="o-recd" type="number" step="0.01" value={openingForm.cumulative_receipts}
                onChange={(e) => setOpeningForm({ ...openingForm, cumulative_receipts: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="o-taxed">Value already taxed</Label>
              <Input
                id="o-taxed" type="number" step="0.01" value={openingForm.cumulative_value_taxed}
                onChange={(e) => setOpeningForm({ ...openingForm, cumulative_value_taxed: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="o-cgst">CGST paid</Label>
              <Input
                id="o-cgst" type="number" step="0.01" value={openingForm.cumulative_cgst}
                onChange={(e) => setOpeningForm({ ...openingForm, cumulative_cgst: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="o-sgst">SGST paid</Label>
              <Input
                id="o-sgst" type="number" step="0.01" value={openingForm.cumulative_sgst}
                onChange={(e) => setOpeningForm({ ...openingForm, cumulative_sgst: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="o-tds">TDS u/s 194-IA deducted to date</Label>
              <Input
                id="o-tds" type="number" step="0.01" value={openingForm.cumulative_tds_194ia}
                onChange={(e) => setOpeningForm({ ...openingForm, cumulative_tds_194ia: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpeningDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveOpening} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BuilderProjectDetailPage;
