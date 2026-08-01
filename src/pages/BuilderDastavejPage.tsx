import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { FileSignature, Loader2, Pencil, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatINR } from '@/utils/builderRates';
import { autoPostDastavejDifferential } from '@/lib/builderBuPosting';

interface RecoRow {
  unit_id: string;
  project_id: string;
  project_name: string;
  unit_no: string;
  unit_type: string;
  unit_status: string;
  dastavej_date: string | null;
  dastavej_value: number | null;
  opening_agreement_value: number;
  value_taxed: number;
  bu_event_id: string | null;
  bu_date: string | null;
  booked_at_cutoff: boolean | null;
  variance: number | null;
}

interface PendingUnit {
  id: string;
  unit_no: string;
  project_id: string;
  dastavej_date: string | null;
  dastavej_value: number | null;
}

type Action =
  | { kind: 'NONE'; label: string; tone: 'ok' }
  | { kind: 'AUTO_TAXED'; label: string; tone: 'info' }
  | { kind: 'SCHEDULE_III'; label: string; tone: 'muted' }
  | { kind: 'SUPPLEMENTARY'; label: string; tone: 'warn' }
  | { kind: 'CREDIT_NOTE'; label: string; tone: 'warn' }
  | { kind: 'PENDING'; label: string; tone: 'muted' };

/**
 * What a variance calls for.
 *
 * Registration is not itself a taxable event under the firm's model — by the
 * time the deed is executed the unit is normally already fully taxed through
 * ordinary advances. Where that wasn't true, saving the date posts the
 * shortfall automatically (`autoPostDastavejDifferential`) — AUTO_TAXED is
 * that case made visible, so a receipt on this unit afterward reads as a
 * plain collection, not a fresh advance, and nobody has to wonder why it
 * didn't add tax.
 */
const resolveAction = (r: RecoRow): Action => {
  // Unbooked at its cut-off: Schedule III para 5, sale of a building after
  // completion is not a supply. The deed carries no GST and is omitted entirely.
  if (r.bu_event_id && r.booked_at_cutoff === false) {
    return { kind: 'SCHEDULE_III', label: 'Schedule III — no GST, omitted from returns', tone: 'muted' };
  }
  if (r.dastavej_value === null || r.dastavej_value === undefined) {
    return { kind: 'PENDING', label: 'Deed value not captured', tone: 'muted' };
  }
  const v = Number(r.variance) || 0;
  // The event this row's bu_event_id points at was dated exactly at this
  // deed — the signature of the automatic post rather than a later, separate
  // BU sweep that happened to cover the same unit.
  const autoTaxed = !!r.bu_event_id && !!r.bu_date && r.bu_date === r.dastavej_date;
  if (Math.abs(v) <= 1) {
    return autoTaxed
      ? { kind: 'AUTO_TAXED', label: 'Taxed in full at registration — posted automatically, not owed again', tone: 'info' }
      : { kind: 'NONE', label: 'Reconciled', tone: 'ok' };
  }
  if (v > 0) {
    return {
      kind: 'SUPPLEMENTARY',
      label: 'Deed exceeds value taxed — supplementary invoice',
      tone: 'warn',
    };
  }
  return { kind: 'CREDIT_NOTE', label: 'Deed below value taxed — credit note, check the window', tone: 'warn' };
};

const TONE_CLASS: Record<Action['tone'], string> = {
  ok: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  info: 'bg-sky-100 text-sky-800 border-sky-200',
  warn: 'bg-amber-100 text-amber-800 border-amber-200',
  muted: '',
};

interface Props {
  /** Jump straight into recording the deed for one unit, instead of the full register. */
  focusUnit?: { id: string; unit_no: string; dastavej_date: string | null; dastavej_value: number | null };
  focusProjectId?: string;
}

const BuilderDastavejPage: React.FC<Props> = ({ focusUnit, focusProjectId }) => {
  const { canManageBuilderUnits, user } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();

  const [clients, setClients] = useState<{ id: string; name: string; gstin: string | null }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [rows, setRows] = useState<RecoRow[]>([]);
  const [pending, setPending] = useState<PendingUnit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [dialog, setDialog] = useState(false);
  const [editUnit, setEditUnit] = useState<{ id: string; unit_no: string } | null>(null);
  const [form, setForm] = useState({ dastavej_date: '', dastavej_value: '' });

  const canEdit = canManageBuilderUnits();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('clients').select('id, name, gstin')
        .eq('regular_sub_type', 'Builder').order('name');
      setClients((data || []) as { id: string; name: string; gstin: string | null }[]);
    })();
  }, []);

  useEffect(() => {
    if (!selectedClientId) { setProjects([]); return; }
    (async () => {
      const { data } = await supabase
        .from('builder_projects').select('id, name').eq('client_id', selectedClientId).order('name');
      setProjects((data || []) as { id: string; name: string }[]);
      setProjectFilter('ALL');
    })();
  }, [selectedClientId]);

  const load = useCallback(async () => {
    if (!selectedClientId) { setRows([]); setPending([]); return; }
    setIsLoading(true);
    try {
      let q = supabase.from('builder_dastavej_reco').select('*').eq('client_id', selectedClientId);
      if (projectFilter !== 'ALL') q = q.eq('project_id', projectFilter);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data || []) as unknown as RecoRow[]);

      // Units with no deed recorded at all, so one can be captured from here.
      const projectIds = projectFilter === 'ALL' ? projects.map((p) => p.id) : [projectFilter];
      if (projectIds.length) {
        const { data: units } = await supabase
          .from('builder_units')
          .select('id, unit_no, project_id, dastavej_date, dastavej_value')
          .in('project_id', projectIds)
          .is('dastavej_date', null)
          .order('unit_no');
        setPending((units || []) as unknown as PendingUnit[]);
      } else setPending([]);
    } catch (e) {
      toast.error(`Could not load: ${(e as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientId, projectFilter, projects]);

  useEffect(() => { void load(); }, [load]);

  // Scope the project select once its options are in, rather than racing the
  // client-change effect above that resets it to "All projects".
  useEffect(() => {
    if (focusProjectId && projects.some((p) => p.id === focusProjectId)) {
      setProjectFilter(focusProjectId);
    }
  }, [projects, focusProjectId]);

  const handledFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusUnit || handledFocusRef.current === focusUnit.id) return;
    handledFocusRef.current = focusUnit.id;
    openEdit(focusUnit.id, focusUnit.unit_no, focusUnit.dastavej_date, focusUnit.dastavej_value);
  }, [focusUnit]);

  const openEdit = (unitId: string, unitNo: string, date: string | null, value: number | null) => {
    setEditUnit({ id: unitId, unit_no: unitNo });
    setForm({ dastavej_date: date || '', dastavej_value: value === null ? '' : String(value) });
    setDialog(true);
  };

  const handleSave = async () => {
    if (!editUnit) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('builder_units').update({
        dastavej_date: form.dastavej_date || null,
        dastavej_value: form.dastavej_value === '' ? null : parseFloat(form.dastavej_value),
      }).eq('id', editUnit.id);
      if (error) throw error;

      // A date was actually set (not cleared) — the deed is a completed
      // transfer either way, so check whether it's still owed anything.
      if (form.dastavej_date) {
        try {
          const result = await autoPostDastavejDifferential({
            unitId: editUnit.id, dastavejDate: form.dastavej_date, userId: user?.id ?? null,
          });
          if (result.action === 'POSTED') {
            toast.success(
              `Dastavej saved — ${formatINR(result.differentialValue)} taxed at registration `
              + `(CGST ${formatINR(result.cgst)}, SGST ${formatINR(result.sgst)}), since it wasn't `
              + 'fully covered by advances yet.',
            );
          } else if (result.action === 'SCHEDULE_III') {
            toast.info('Dastavej saved — this unit was unbooked at that date, recorded under Schedule III.');
          } else if (result.action === 'EXCLUDED') {
            toast.info(
              'Dastavej saved for the register — this unit is flagged closed before onboarding, so no '
              + 'automatic differential is computed for it.',
            );
          } else if (result.action === 'ALREADY_TAXED') {
            toast.success('Dastavej saved — already fully taxed by advances, nothing further to post.');
          } else {
            toast.success('Dastavej details saved');
          }
        } catch (autoErr) {
          // The date is saved regardless; only the automatic differential
          // failed, and that's worth surfacing rather than swallowing.
          toast.error(`Dastavej saved, but the automatic differential failed: ${(autoErr as Error).message}`);
        }
      } else {
        toast.success('Dastavej details saved');
      }
      setDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const summary = useMemo(() => {
    const acc = { reconciled: 0, autoTaxed: 0, supplementary: 0, creditNote: 0, scheduleIII: 0, pending: 0 };
    rows.forEach((r) => {
      const a = resolveAction(r);
      if (a.kind === 'NONE') acc.reconciled += 1;
      else if (a.kind === 'AUTO_TAXED') acc.autoTaxed += 1;
      else if (a.kind === 'SUPPLEMENTARY') acc.supplementary += 1;
      else if (a.kind === 'CREDIT_NOTE') acc.creditNote += 1;
      else if (a.kind === 'SCHEDULE_III') acc.scheduleIII += 1;
      else acc.pending += 1;
    });
    return acc;
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dastavej Reconciliation"
        subtitle="Registered deed value against the value actually offered to tax"
        icon={<FileSignature className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[220px] max-w-xs">
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
            <div className="w-56">
              <Label className="mb-1.5 block">Project</Label>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All projects</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p className="text-xs">
          Registration usually creates no fresh GST — by the time the deed is executed the unit is normally
          already fully taxed through ordinary advances, and this page exists to catch variances. Where it
          isn't — the unit registered before advances caught up — saving the date taxes the shortfall
          automatically, right here, so nothing is left open until some future BU event. Where the deed is
          registered at a jantri value above the agreement value, GST still follows the actual transaction
          value u/s 15; the reconciliation just needs to be documented, because it is a standard audit query.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && selectedClientId && (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <p className="text-xs text-muted-foreground">Reconciled</p>
                  <p className="text-sm font-semibold">{summary.reconciled}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Taxed at registration</p>
                  <p className="text-sm font-semibold">{summary.autoTaxed}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Supplementary due</p>
                  <p className="text-sm font-semibold">{summary.supplementary}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Credit note due</p>
                  <p className="text-sm font-semibold">{summary.creditNote}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Schedule III</p>
                  <p className="text-sm font-semibold">{summary.scheduleIII}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Value not captured</p>
                  <p className="text-sm font-semibold">{summary.pending}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Registered units ({rows.length})</CardTitle>
              <CardDescription>
                A unit unbooked at its BU cut-off falls under Schedule III — its later sale is not a supply,
                so the deed carries no GST and appears in no return.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">
                  No units with dastavej details recorded yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Dastavej date</TableHead>
                        <TableHead>BU date</TableHead>
                        <TableHead className="text-right">Deed value</TableHead>
                        <TableHead className="text-right">Value taxed</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const action = resolveAction(r);
                        return (
                          <TableRow key={r.unit_id}>
                            <TableCell className="text-sm text-muted-foreground">{r.project_name}</TableCell>
                            <TableCell className="font-medium">
                              {r.unit_no}
                              <span className="block text-xs text-muted-foreground">{r.unit_type}</span>
                            </TableCell>
                            <TableCell className="text-sm">{r.dastavej_date || '—'}</TableCell>
                            <TableCell className="text-sm">{r.bu_date || '—'}</TableCell>
                            <TableCell className="text-right text-sm">
                              {r.dastavej_value === null ? '—' : formatINR(r.dastavej_value)}
                            </TableCell>
                            <TableCell className="text-right text-sm">{formatINR(r.value_taxed)}</TableCell>
                            <TableCell className="text-right text-sm font-medium">
                              {r.variance === null ? '—' : formatINR(r.variance)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={TONE_CLASS[action.tone]}>
                                {action.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {canEdit && (
                                <Button
                                  variant="ghost" size="icon"
                                  onClick={() => openEdit(r.unit_id, r.unit_no, r.dastavej_date, r.dastavej_value)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
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

          {pending.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Awaiting registration ({pending.length})</CardTitle>
                <CardDescription>
                  Units with no deed recorded. A dastavej dated before the BU permission pulls that unit's
                  cut-off earlier, so capturing it matters before a BU event is prepared.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unit</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pending.slice(0, 50).map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{u.unit_no}</TableCell>
                          <TableCell>
                            {canEdit && (
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => openEdit(u.id, u.unit_no, u.dastavej_date, u.dastavej_value)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {pending.length > 50 && (
                    <p className="text-xs text-muted-foreground px-4 py-2">
                      Showing the first 50 of {pending.length}.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!selectedClientId && !isLoading && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <FileSignature className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Select a builder client.</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Dastavej — unit {editUnit?.unit_no}</DialogTitle>
            <DialogDescription>
              The deed date is one half of the unit's BU cut-off: whichever of the BU date and this date
              is earlier.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="d-date">Dastavej date</Label>
              <Input
                id="d-date" type="date" value={form.dastavej_date}
                onChange={(e) => setForm({ ...form, dastavej_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="d-value">Deed value (excl. GST)</Label>
              <Input
                id="d-value" type="number" step="0.01" value={form.dastavej_value}
                onChange={(e) => setForm({ ...form, dastavej_value: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                The consideration in the deed, not the jantri value.
              </p>
            </div>
          </div>

          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="text-xs">
              Saving a date on a unit not yet closed against any event checks it immediately: fully taxed
              already → nothing happens; a shortfall → it's posted right now, dated to this deed. Changing
              the date on a unit <strong>already</strong> covered by a posted event does not re-run that
              working — unpost it and prepare it again if the cut-off should move.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BuilderDastavejPage;
