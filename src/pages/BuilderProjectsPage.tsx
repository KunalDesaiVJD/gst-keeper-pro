import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuilderEmbedded, useOpenBuilderProject } from '@/contexts/BuilderWorkspaceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Building, Plus, Loader2, ChevronRight, Pencil, Settings2 } from 'lucide-react';
import { RREP_COMMERCIAL_THRESHOLD, formatPct, formatSqM, testRrep } from '@/utils/builderRates';
import BuilderProjectSettingsDialog, {
  type BuilderProjectFormRow,
} from '@/components/builder/BuilderProjectSettingsDialog';

type ProjectRow = BuilderProjectFormRow;

interface AreaRow {
  project_id: string;
  residential_sqm: number;
  commercial_sqm: number;
  unit_count: number;
}

/**
 * Projects for the selected builder client, each showing its live 15% test.
 *
 * The RREP result is the project's most consequential fact: it decides whether
 * commercial units are taxed at 7.5% with no credit or at 18% with proportionate
 * credit, so it is surfaced on the list rather than buried in the detail page.
 */
const BuilderProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const openProject = useOpenBuilderProject();
  const embedded = useBuilderEmbedded();
  const { canManageBuilderProjects } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();

  const [clients, setClients] = useState<{ id: string; name: string; gstin: string | null }[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [areas, setAreas] = useState<Record<string, AreaRow>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);

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
    setDialogOpen(true);
  };

  const openEdit = (p: ProjectRow) => {
    setEditing(p);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Builder Projects"
        subtitle="RERA projects, their commercial mix, and the 15% RREP test"
        icon={<Building className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/builder-setup')} hidden={embedded}>
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
                        <TableRow key={p.id} className="cursor-pointer" onClick={() => openProject(p.id)}>
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
                              <Button variant="ghost" size="icon" onClick={() => openProject(p.id)}>
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

      <BuilderProjectSettingsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clientId={selectedClientId || ''}
        project={editing}
        readOnly={readOnly}
        onSaved={() => selectedClientId && load(selectedClientId)}
      />
    </div>
  );
};

export default BuilderProjectsPage;
