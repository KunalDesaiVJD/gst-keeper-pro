import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuilderEmbedded, useOpenBuilderProject } from '@/contexts/BuilderWorkspaceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_CONTROL, WS_FILTER_LABEL, WS_PAGE, WS_TABLE_WRAP } from '@/components/workspace/theme';
import { B_TABLE, B_TD, B_TD_NUM, B_TH, B_TH_NUM, B_TR, B_TR_HEAD } from '@/components/builder/theme';
import { cn } from '@/lib/utils';
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

  const stats = projects.reduce(
    (acc, p) => {
      const a = areas[p.id];
      const rrep = testRrep(a?.residential_sqm || 0, a?.commercial_sqm || 0);
      acc.units += a?.unit_count ?? 0;
      if (rrep.isIndeterminate) acc.noArea += 1;
      else if (rrep.isRrep) acc.rrep += 1;
      else acc.rep += 1;
      return acc;
    },
    { units: 0, rrep: 0, rep: 0, noArea: 0 },
  );

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        embedded={embedded}
        title="Builder Projects"
        subtitle="RERA projects, their commercial mix, and the 15% RREP test"
        icon={<Building />}
        actions={
          <>
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => navigate('/builder-setup')} hidden={embedded}>
              <Settings2 className="h-3.5 w-3.5" /> Client setup
            </Button>
            {selectedClientId && !readOnly && (
              <Button size="sm" className={WS_BTN} onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> New project
              </Button>
            )}
          </>
        }
      />

      {!embedded && (
        <Card>
          <CardContent className="px-3 py-2">
            <label className="block max-w-md space-y-0.5">
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
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading projects…
          </CardContent>
        </Card>
      )}

      {selectedClientId && !isLoading && projects.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiTile label="Projects" value={projects.length} />
          <KpiTile label="Units" value={stats.units} />
          <KpiTile label="RREP" value={stats.rrep} tone={stats.rrep ? 'ok' : 'neutral'} />
          <KpiTile
            label="REP (other than RREP)"
            value={stats.rep}
            hint={stats.noArea ? `${stats.noArea} with no area yet` : undefined}
            tone={stats.rep ? 'warn' : 'neutral'}
          />
        </div>
      )}

      {selectedClientId && !isLoading && (
        <SectionCard
          title="Projects"
          description={(
            <>
              A project is an RREP while commercial carpet area stays at or under{' '}
              {formatPct(RREP_COMMERCIAL_THRESHOLD)} of total carpet area. Cross that line and commercial
              units move from 7.5% with no credit to 18% with proportionate credit.
            </>
          )}
        >
          {projects.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <Building className="mx-auto mb-2 h-6 w-6 opacity-40" />
              No projects yet for this client.
            </div>
          ) : (
            <Table className={B_TABLE} containerClassName={WS_TABLE_WRAP}>
              <TableHeader>
                <TableRow className={B_TR_HEAD}>
                  <TableHead className={B_TH}>Project</TableHead>
                  <TableHead className={B_TH}>RERA no.</TableHead>
                  <TableHead className={B_TH_NUM}>Units</TableHead>
                  <TableHead className={B_TH_NUM}>Residential</TableHead>
                  <TableHead className={B_TH_NUM}>Commercial</TableHead>
                  <TableHead className={B_TH_NUM}>Commercial %</TableHead>
                  <TableHead className={B_TH}>Classification</TableHead>
                  <TableHead className={B_TH}>Affordable limit</TableHead>
                  <TableHead className={B_TH}>Status</TableHead>
                  <TableHead className={cn(B_TH, 'w-16')} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => {
                  const a = areas[p.id];
                  const rrep = testRrep(a?.residential_sqm || 0, a?.commercial_sqm || 0);
                  return (
                    <TableRow key={p.id} className={cn(B_TR, 'cursor-pointer')} onClick={() => openProject(p.id)}>
                      <TableCell className={cn(B_TD, 'font-medium')}>
                        {p.name}
                        {p.city && <span className="block text-[11px] font-normal text-muted-foreground">{p.city}</span>}
                      </TableCell>
                      <TableCell className={cn(B_TD, 'text-muted-foreground')}>{p.rera_number || '—'}</TableCell>
                      <TableCell className={B_TD_NUM}>{a?.unit_count ?? 0}</TableCell>
                      <TableCell className={B_TD_NUM}>{formatSqM(rrep.residentialSqM)}</TableCell>
                      <TableCell className={B_TD_NUM}>{formatSqM(rrep.commercialSqM)}</TableCell>
                      <TableCell className={cn(B_TD_NUM, 'font-medium')}>
                        {rrep.isIndeterminate ? '—' : formatPct(rrep.commercialShare)}
                      </TableCell>
                      <TableCell className={B_TD}>
                        {rrep.isIndeterminate ? (
                          <Badge variant="outline" className="text-[10px] font-medium">No area yet</Badge>
                        ) : rrep.isRrep ? (
                          <Badge variant="success" className="text-[10px] font-medium">RREP</Badge>
                        ) : (
                          <Badge variant="warning" className="text-[10px] font-medium">
                            REP (other than RREP)
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className={B_TD}>{p.is_metro ? '60 sq m' : '90 sq m'}</TableCell>
                      <TableCell className={B_TD}>
                        <Badge variant={p.status === 'Active' ? 'info' : 'outline'} className="text-[10px] font-medium">{p.status}</Badge>
                      </TableCell>
                      <TableCell className={cn(B_TD, 'py-0.5')}>
                        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                          {!readOnly && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)} aria-label="Edit project">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openProject(p.id)} aria-label="Open project">
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </SectionCard>
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
