import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Building, Plus, Loader2, ChevronRight, Pencil, AlertTriangle, Settings2 } from 'lucide-react';
import {
  RREP_COMMERCIAL_THRESHOLD, formatPct, formatSqM, testRrep,
} from '@/utils/builderRates';

type CarpetAreaSource = 'DERIVED' | 'MANUAL';
type ProjectStatus = 'Active' | 'Completed' | 'Closed';
type GroupingLabel = 'Block' | 'Wing' | 'Tower' | 'Phase';

interface ProjectRow {
  id: string;
  client_id: string;
  name: string;
  rera_number: string | null;
  city: string | null;
  is_metro: boolean;
  grouping_label: GroupingLabel;
  carpet_area_source: CarpetAreaSource;
  manual_residential_carpet_sqm: number;
  manual_commercial_carpet_sqm: number;
  doc_series_prefix: string | null;
  opening_cutoff_date: string | null;
  fsi_treatment: 'PAY' | 'IGNORE' | null;
  status: ProjectStatus;
  notes: string | null;
}

interface AreaRow {
  project_id: string;
  residential_sqm: number;
  commercial_sqm: number;
  unit_count: number;
}

const emptyForm = {
  name: '',
  rera_number: '',
  city: '',
  is_metro: false,
  grouping_label: 'Block' as GroupingLabel,
  carpet_area_source: 'DERIVED' as CarpetAreaSource,
  manual_residential_carpet_sqm: '',
  manual_commercial_carpet_sqm: '',
  doc_series_prefix: '',
  opening_cutoff_date: '',
  fsi_treatment: '' as '' | 'PAY' | 'IGNORE',
  status: 'Active' as ProjectStatus,
  notes: '',
};

/**
 * Projects for the selected builder client, each showing its live 15% test.
 *
 * The RREP result is the project's most consequential fact: it decides whether
 * commercial units are taxed at 7.5% with no credit or at 18% with proportionate
 * credit, so it is surfaced on the list rather than buried in the detail page.
 */
const BuilderProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const { canManageBuilderProjects } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();

  const [clients, setClients] = useState<{ id: string; name: string; gstin: string | null }[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [areas, setAreas] = useState<Record<string, AreaRow>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [form, setForm] = useState(emptyForm);

  const readOnly = !canManageBuilderProjects();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, name, gstin')
        .eq('regular_sub_type', 'Builder')
        .order('name');
      setClients((data || []) as { id: string; name: string; gstin: string | null }[]);
    })();
  }, []);

  const load = useCallback(async (clientId: string) => {
    setIsLoading(true);
    try {
      const [{ data: proj, error }, { data: area }] = await Promise.all([
        supabase.from('builder_projects').select('*').eq('client_id', clientId).order('name'),
        supabase.from('builder_project_areas').select('*').eq('client_id', clientId),
      ]);
      if (error) throw error;
      setProjects((proj || []) as unknown as ProjectRow[]);
      const map: Record<string, AreaRow> = {};
      ((area || []) as unknown as AreaRow[]).forEach((a) => { map[a.project_id] = a; });
      setAreas(map);
    } catch (e) {
      toast.error(`Could not load projects: ${(e as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClientId) void load(selectedClientId);
    else { setProjects([]); setAreas({}); }
  }, [selectedClientId, load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (p: ProjectRow) => {
    setEditing(p);
    setForm({
      name: p.name,
      rera_number: p.rera_number || '',
      city: p.city || '',
      is_metro: p.is_metro,
      grouping_label: p.grouping_label,
      carpet_area_source: p.carpet_area_source,
      manual_residential_carpet_sqm: String(p.manual_residential_carpet_sqm ?? ''),
      manual_commercial_carpet_sqm: String(p.manual_commercial_carpet_sqm ?? ''),
      doc_series_prefix: p.doc_series_prefix || '',
      opening_cutoff_date: p.opening_cutoff_date || '',
      fsi_treatment: (p.fsi_treatment || '') as '' | 'PAY' | 'IGNORE',
      status: p.status,
      notes: p.notes || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedClientId) return;
    if (!form.name.trim()) { toast.error('Project name is required'); return; }
    setIsSaving(true);
    try {
      const payload = {
        client_id: selectedClientId,
        name: form.name.trim(),
        rera_number: form.rera_number.trim() || null,
        city: form.city.trim() || null,
        is_metro: form.is_metro,
        grouping_label: form.grouping_label,
        carpet_area_source: form.carpet_area_source,
        manual_residential_carpet_sqm: parseFloat(form.manual_residential_carpet_sqm) || 0,
        manual_commercial_carpet_sqm: parseFloat(form.manual_commercial_carpet_sqm) || 0,
        doc_series_prefix: form.doc_series_prefix.trim() || null,
        opening_cutoff_date: form.opening_cutoff_date || null,
        fsi_treatment: form.fsi_treatment || null,
        status: form.status,
        notes: form.notes.trim() || null,
      };
      const { error } = editing
        ? await supabase.from('builder_projects').update(payload).eq('id', editing.id)
        : await supabase.from('builder_projects').insert(payload);
      if (error) throw error;
      toast.success(editing ? 'Project updated' : 'Project created');
      setDialogOpen(false);
      await load(selectedClientId);
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Live preview of the 15% test inside the dialog, for MANUAL projects.
  const formRrep = useMemo(
    () => testRrep(
      parseFloat(form.manual_residential_carpet_sqm) || 0,
      parseFloat(form.manual_commercial_carpet_sqm) || 0,
    ),
    [form.manual_residential_carpet_sqm, form.manual_commercial_carpet_sqm],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Builder Projects"
        subtitle="RERA projects, their commercial mix, and the 15% RREP test"
        icon={<Building className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/builder-setup')}>
              <Settings2 className="h-4 w-4 mr-2" /> Client setup
            </Button>
            {selectedClientId && !readOnly && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" /> New project
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="max-w-md">
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
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading projects…
        </div>
      )}

      {selectedClientId && !isLoading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projects</CardTitle>
            <CardDescription>
              A project is an RREP while commercial carpet area stays at or under{' '}
              {formatPct(RREP_COMMERCIAL_THRESHOLD)} of total carpet area. Cross that line and commercial
              units move from 7.5% with no credit to 18% with proportionate credit.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {projects.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <Building className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No projects yet for this client.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>RERA no.</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Residential</TableHead>
                      <TableHead className="text-right">Commercial</TableHead>
                      <TableHead className="text-right">Commercial %</TableHead>
                      <TableHead>Classification</TableHead>
                      <TableHead>Affordable limit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((p) => {
                      const a = areas[p.id];
                      const rrep = testRrep(a?.residential_sqm || 0, a?.commercial_sqm || 0);
                      return (
                        <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/builder-projects/${p.id}`)}>
                          <TableCell className="font-medium">
                            {p.name}
                            {p.city && <span className="block text-xs text-muted-foreground">{p.city}</span>}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.rera_number || '—'}</TableCell>
                          <TableCell className="text-right text-sm">{a?.unit_count ?? 0}</TableCell>
                          <TableCell className="text-right text-sm">{formatSqM(rrep.residentialSqM)}</TableCell>
                          <TableCell className="text-right text-sm">{formatSqM(rrep.commercialSqM)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {rrep.isIndeterminate ? '—' : formatPct(rrep.commercialShare)}
                          </TableCell>
                          <TableCell>
                            {rrep.isIndeterminate ? (
                              <Badge variant="outline">No area yet</Badge>
                            ) : rrep.isRrep ? (
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">RREP</Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                                REP (other than RREP)
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{p.is_metro ? '60 sq m' : '90 sq m'}</TableCell>
                          <TableCell>
                            <Badge variant={p.status === 'Active' ? 'default' : 'outline'}>{p.status}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              {!readOnly && (
                                <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" onClick={() => navigate(`/builder-projects/${p.id}`)}>
                                <ChevronRight className="h-4 w-4" />
                              </Button>
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
      )}

      {/* ── Create / edit dialog ────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit project' : 'New project'}</DialogTitle>
            <DialogDescription>
              The RERA project is the unit for the 15% test. BU permission can still arrive block by block.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="p-name">Project name *</Label>
              <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="p-rera">RERA registration no.</Label>
              <Input id="p-rera" value={form.rera_number} onChange={(e) => setForm({ ...form, rera_number: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="p-city">City</Label>
              <Input id="p-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>

            <div className="sm:col-span-2 flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Metropolitan city</p>
                <p className="text-xs text-muted-foreground">
                  Affordable carpet-area limit: {form.is_metro ? '60 sq m' : '90 sq m'}. Metro means Bengaluru,
                  Chennai, Delhi NCR, Hyderabad, Kolkata or MMR — Gujarat cities are not metro.
                </p>
              </div>
              <Switch checked={form.is_metro} onCheckedChange={(v) => setForm({ ...form, is_metro: v })} />
            </div>

            <div>
              <Label>Grouping level</Label>
              <Select value={form.grouping_label} onValueChange={(v) => setForm({ ...form, grouping_label: v as GroupingLabel })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['Block', 'Wing', 'Tower', 'Phase'] as GroupingLabel[]).map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as ProjectStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['Active', 'Completed', 'Closed'] as ProjectStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Carpet area for the 15% test</Label>
              <Select
                value={form.carpet_area_source}
                onValueChange={(v) => setForm({ ...form, carpet_area_source: v as CarpetAreaSource })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DERIVED">Derived from the unit master</SelectItem>
                  <SelectItem value="MANUAL">Entered manually</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-series">Document series prefix</Label>
              <Input
                id="p-series"
                value={form.doc_series_prefix}
                placeholder="e.g. SKY/25-26"
                onChange={(e) => setForm({ ...form, doc_series_prefix: e.target.value })}
              />
            </div>

            {form.carpet_area_source === 'MANUAL' && (
              <>
                <div>
                  <Label htmlFor="p-resi">Residential carpet area (sq m)</Label>
                  <Input
                    id="p-resi" type="number" step="0.001"
                    value={form.manual_residential_carpet_sqm}
                    onChange={(e) => setForm({ ...form, manual_residential_carpet_sqm: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="p-comm">Commercial carpet area (sq m)</Label>
                  <Input
                    id="p-comm" type="number" step="0.001"
                    value={form.manual_commercial_carpet_sqm}
                    onChange={(e) => setForm({ ...form, manual_commercial_carpet_sqm: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2 rounded-lg border p-3 text-sm">
                  {formRrep.isIndeterminate ? (
                    <span className="text-muted-foreground">Enter carpet areas to see the 15% test.</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span>Commercial share: <strong>{formatPct(formRrep.commercialShare)}</strong></span>
                      {formRrep.isRrep ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">RREP</Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-200">REP (other than RREP)</Badge>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            <div>
              <Label htmlFor="p-cutoff">Opening cut-off date</Label>
              <Input
                id="p-cutoff" type="date"
                value={form.opening_cutoff_date}
                onChange={(e) => setForm({ ...form, opening_cutoff_date: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                The date this app takes over from the client's earlier records.
              </p>
            </div>
            <div>
              <Label>TDR / FSI treatment</Label>
              <Select
                value={form.fsi_treatment || 'INHERIT'}
                onValueChange={(v) => setForm({ ...form, fsi_treatment: v === 'INHERIT' ? '' : (v as 'PAY' | 'IGNORE') })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INHERIT">Follow the client default</SelectItem>
                  <SelectItem value="PAY">Pay RCM @18%</SelectItem>
                  <SelectItem value="IGNORE">Do not pay — needs written instruction</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.fsi_treatment === 'IGNORE' && (
              <div className="sm:col-span-2 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="text-xs">
                  Returns for the period carrying this project's FSI liability will stay blocked until the
                  client's written instruction is attached and the GST Manager has approved it.
                </p>
              </div>
            )}

            <div className="sm:col-span-2">
              <Label htmlFor="p-notes">Notes</Label>
              <Input id="p-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? 'Save changes' : 'Create project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BuilderProjectsPage;
