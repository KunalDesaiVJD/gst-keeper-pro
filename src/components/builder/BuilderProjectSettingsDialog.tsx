import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { RREP_COMMERCIAL_THRESHOLD, formatPct, testRrep } from '@/utils/builderRates';

/**
 * The project-level election fields (metro, carpet-area source for the 15%
 * test, doc series, opening cut-off, FSI override) in one place, shared by
 * the Projects list — which still creates new projects — and the workspace's
 * "Project setup" entry point, which edits the one you're already inside
 * without making you leave to find it in a list.
 */

type CarpetAreaSource = 'DERIVED' | 'MANUAL';
type ProjectStatus = 'Active' | 'Completed' | 'Closed';
type GroupingLabel = 'Block' | 'Wing' | 'Tower' | 'Phase';

export interface BuilderProjectFormRow {
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

const toForm = (p: BuilderProjectFormRow) => ({
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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  /** null creates a new project; a project row edits it in place. */
  project: BuilderProjectFormRow | null;
  readOnly?: boolean;
  onSaved: () => void | Promise<void>;
}

const BuilderProjectSettingsDialog: React.FC<Props> = ({
  open, onOpenChange, clientId, project, readOnly, onSaved,
}) => {
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (project) { setForm(toForm(project)); return; }
    // A new project starts from the client's own metro default (almost
    // always non-metro — Gujarat property) rather than a hardcoded false.
    (async () => {
      const { data } = await supabase
        .from('builder_client_settings').select('default_is_metro').eq('client_id', clientId).maybeSingle();
      const row = data as unknown as { default_is_metro: boolean } | null;
      setForm({ ...emptyForm, is_metro: row?.default_is_metro ?? false });
    })();
  }, [open, project, clientId]);

  const formRrep = useMemo(
    () => testRrep(
      parseFloat(form.manual_residential_carpet_sqm) || 0,
      parseFloat(form.manual_commercial_carpet_sqm) || 0,
    ),
    [form.manual_residential_carpet_sqm, form.manual_commercial_carpet_sqm],
  );

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Project name is required'); return; }
    setIsSaving(true);
    try {
      const payload = {
        client_id: clientId,
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
      const { error } = project
        ? await supabase.from('builder_projects').update(payload).eq('id', project.id)
        : await supabase.from('builder_projects').insert(payload);
      if (error) throw error;
      toast.success(project ? 'Project settings saved' : 'Project created');
      onOpenChange(false);
      await onSaved();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{project ? `Project setup — ${project.name}` : 'New project'}</DialogTitle>
          <DialogDescription>
            The RERA project is the unit for the 15% test. BU permission can still arrive block by block.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="p-name">Project name *</Label>
            <Input
              id="p-name" value={form.name} disabled={readOnly}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="p-rera">RERA registration no.</Label>
            <Input
              id="p-rera" value={form.rera_number} disabled={readOnly}
              onChange={(e) => setForm({ ...form, rera_number: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="p-city">City</Label>
            <Input
              id="p-city" value={form.city} disabled={readOnly}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2 flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Metropolitan city</p>
              <p className="text-xs text-muted-foreground">
                Affordable carpet-area limit: {form.is_metro ? '60 sq m' : '90 sq m'}. Metro means Bengaluru,
                Chennai, Delhi NCR, Hyderabad, Kolkata or MMR — Gujarat cities are not metro.
              </p>
            </div>
            <Switch checked={form.is_metro} disabled={readOnly} onCheckedChange={(v) => setForm({ ...form, is_metro: v })} />
          </div>

          <div>
            <Label>Grouping level</Label>
            <Select
              value={form.grouping_label} disabled={readOnly}
              onValueChange={(v) => setForm({ ...form, grouping_label: v as GroupingLabel })}
            >
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
            <Select
              value={form.status} disabled={readOnly}
              onValueChange={(v) => setForm({ ...form, status: v as ProjectStatus })}
            >
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
              value={form.carpet_area_source} disabled={readOnly}
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
              id="p-series" disabled={readOnly}
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
                  id="p-resi" type="number" step="0.001" disabled={readOnly}
                  value={form.manual_residential_carpet_sqm}
                  onChange={(e) => setForm({ ...form, manual_residential_carpet_sqm: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-comm">Commercial carpet area (sq m)</Label>
                <Input
                  id="p-comm" type="number" step="0.001" disabled={readOnly}
                  value={form.manual_commercial_carpet_sqm}
                  onChange={(e) => setForm({ ...form, manual_commercial_carpet_sqm: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2 rounded-lg border p-3 text-sm">
                {formRrep.isIndeterminate ? (
                  <span className="text-muted-foreground">Enter carpet areas to see the 15% test.</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>Commercial share: <strong>{formatPct(formRrep.commercialShare)}</strong>
                      {' '}(RREP at or under {formatPct(RREP_COMMERCIAL_THRESHOLD)})</span>
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
              id="p-cutoff" type="date" disabled={readOnly}
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
              value={form.fsi_treatment || 'INHERIT'} disabled={readOnly}
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
            <Input
              id="p-notes" value={form.notes} disabled={readOnly}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {project ? 'Save changes' : 'Create project'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BuilderProjectSettingsDialog;
