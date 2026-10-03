import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Plus, Loader2, Trash2, Pencil, ShieldAlert, Building2, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, SectionCard } from '@/components/gstr9/ui';
import {
  WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR, WS_FILTER_LABEL, WS_CONTROL,
} from '@/components/workspace/theme';
import { GST_STATE_CODES } from '@/utils/gstr1ManualBuild';
import {
  fetchProjects, fetchRaBills, saveProject, deleteProject, saveRaBill, deleteRaBill,
  recoverySchedule, projectWorkingPaper, bgDaysRemaining,
  type ContractProject, type ContractRaBill, type RecoveryRule,
} from '@/lib/contractProjects';
import type { AdvanceReceipt, AdvanceAdjustment } from '@/lib/advanceRegister';
import { buildProjectReport } from '@/lib/advanceReportData';
import { projectWorkingPaperPdf } from '@/utils/advanceReportsPdf';

const inr = (n: number) => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  clientId: string;
  clientName: string;
  clientGstin: string;
  homeState: string;
  periodMonth: string;
  receipts: AdvanceReceipt[];
  adjustments: AdvanceAdjustment[];
  canEdit: boolean;
  actor: { id: string | null; name: string };
  onChanged: () => void;
}

const TH = `h-auto ${WS_TH}`;

export const ContractProjectsPanel: React.FC<Props> = ({
  clientId, clientName, clientGstin, homeState, periodMonth, receipts, adjustments,
  canEdit, actor, onChanged,
}) => {
  const confirm = useConfirm();
  const [projects, setProjects] = useState<ContractProject[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [bills, setBills] = useState<ContractRaBill[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const [editingProject, setEditingProject] = useState<ContractProject | null>(null);
  const [billDialog, setBillDialog] = useState(false);
  const [editingBill, setEditingBill] = useState<ContractRaBill | null>(null);

  const project = projects.find((p) => p.id === selectedId) || null;

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchProjects(clientId);
      setProjects(list);
      setSelectedId((cur) => (cur && list.some((p) => p.id === cur) ? cur : (list[0]?.id || '')));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { if (clientId) loadProjects(); }, [clientId, loadProjects]);
  useEffect(() => {
    if (!selectedId) { setBills([]); return; }
    // Guarded: switching projects quickly could land an earlier project's
    // bills on a later project's schedule.
    let cancelled = false;
    fetchRaBills(selectedId).then((b) => { if (!cancelled) setBills(b); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const schedule = useMemo(
    () => (project ? recoverySchedule({ project, bills, receipts, adjustments }) : []),
    [project, bills, receipts, adjustments],
  );
  const wp = useMemo(
    () => (project ? projectWorkingPaper({ project, bills, receipts, adjustments, homeState }) : null),
    [project, bills, receipts, adjustments, homeState],
  );
  const bgDays = project ? bgDaysRemaining(project) : null;

  // Refetches rather than printing the screen's state, for the same reason the
  // other working papers do: a paper that disagrees with its own source is
  // worse than none.
  const [exporting, setExporting] = useState(false);
  const exportWorkingPaper = async () => {
    if (!project) return;
    setExporting(true);
    try {
      const data = await buildProjectReport(clientId, project.id, homeState);
      if (!data) { toast.error('Project not found.'); return; }
      projectWorkingPaperPdf({ clientId, clientName, clientGstin, periodMonth }, data);
    } catch (e) {
      toast.error(`Could not generate the working paper: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const removeProject = async () => {
    if (!project) return;
    const ok = await confirm({
      title: `Delete project "${project.name}"?`,
      description:
        'RA bills under it are deleted too. Advance receipts are NOT deleted — they are the record of tax '
        + 'already paid in Table 11A — they are just unlinked from this project.',
      confirmText: 'Delete project',
      destructive: true,
    });
    if (!ok) return;
    await deleteProject(project.id);
    await loadProjects();
    onChanged();
    toast.success('Project deleted.');
  };

  const removeBill = async (b: ContractRaBill) => {
    const ok = await confirm({ title: `Delete RA bill ${b.bill_no}?`, confirmText: 'Delete', destructive: true });
    if (!ok) return;
    await deleteRaBill(b.id);
    setBills(await fetchRaBills(selectedId));
    toast.success('RA bill deleted.');
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 px-3 py-2">
          <label className="w-full min-w-0 space-y-0.5 sm:w-72">
            <span className={WS_FILTER_LABEL}>Project</span>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className={WS_CONTROL}><SelectValue placeholder={projects.length ? 'Select project' : 'No projects yet'} /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {loading && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />}
          <div className="ml-auto flex flex-wrap gap-2">
            {project && (
              <Button size="sm" variant="outline" className={WS_BTN} onClick={exportWorkingPaper} disabled={exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                Working paper
              </Button>
            )}
            {canEdit && (
              <>
                <Button size="sm" variant="outline" className={WS_BTN} onClick={() => { setEditingProject(null); setProjectDialog(true); }}>
                  <Plus className="h-3.5 w-3.5" /> New project
                </Button>
                {project && (
                  <>
                    <Button size="sm" variant="outline" className={WS_BTN} onClick={() => { setEditingProject(project); setProjectDialog(true); }}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" className={`${WS_BTN} text-destructive`} onClick={removeProject}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {!project ? (
        <Card><CardContent className="px-4 py-3">
          <TableEmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No contract projects yet"
            description="Add the work order to track its mobilisation advance and the recovery from each RA bill."
          />
        </CardContent></Card>
      ) : (
        <>
          {/* A lapsed bank guarantee on a live advance is the contractor's
              problem long before it is a GST one — but we hold the date. */}
          {bgDays !== null && bgDays < 60 && (wp?.balanceAdvance || 0) > 0 && (
            <div
              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                bgDays < 0 ? 'border-destructive/40 bg-destructive/5' : 'border-warning/40 bg-warning/10'
              }`}
            >
              <ShieldAlert className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${bgDays < 0 ? 'text-destructive' : 'text-warning'}`} />
              <div>
                <span className="font-semibold text-foreground">
                  Bank guarantee {bgDays < 0 ? 'has expired' : `expires in ${bgDays} days`}
                </span>
                <span className="text-muted-foreground">
                  {' '}({project.bg_no || 'no reference'}, {project.bg_expiry}) with ₹{inr(wp?.balanceAdvance || 0)} of
                  advance still unrecovered.
                </span>
              </div>
            </div>
          )}

          {wp && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiTile label="Contract value" value={`₹${inr(wp.contractValue)}`} />
              <KpiTile label="Billed to date" value={`₹${inr(wp.billedToDate)}`} hint={`${wp.billedPctOfContract}% of contract`} />
              <KpiTile label="Advance received" value={`₹${inr(wp.advanceReceived)}`} />
              <KpiTile label="Recovered" value={`₹${inr(wp.recovered)}`} />
              <KpiTile label="Balance advance" value={`₹${inr(wp.balanceAdvance)}`} />
              <KpiTile
                label="Open GST on advance"
                value={`₹${inr(wp.openGstOnAdvance.igst + wp.openGstOnAdvance.cgst + wp.openGstOnAdvance.sgst)}`}
                hint={project.pos_state === homeState ? 'CGST + SGST' : 'IGST — project outside home state'}
              />
              <KpiTile label="Retention (expected)" value={`₹${inr(wp.retentionExpected)}`} hint={`held ₹${inr(wp.retentionHeld)}`} />
              <KpiTile
                label="Recovery shortfall"
                value={`₹${inr(wp.recoveryShortfall)}`}
                hint={wp.recoveryShortfall > 0 ? 'Under-recovered against the schedule' : 'On schedule'}
                tone={wp.recoveryShortfall > 0 ? 'warn' : 'ok'}
              />
            </div>
          )}

          <SectionCard
            title="RA bills and advance recovery"
            description={<>
              Expected recovery comes from the contract terms
              ({project.recovery_rule === 'LUMPSUM_AT_BILL_N'
                ? `whole advance at RA bill ${project.recovery_at_bill_no ?? '—'}`
                : `${project.recovery_pct}% of each RA bill`}).
              A variance means the advance is still taxed while the value has already been billed.
            </>}
            actions={canEdit ? (
              <Button size="sm" className={WS_BTN} onClick={() => { setEditingBill(null); setBillDialog(true); }}>
                <Plus className="h-3.5 w-3.5" /> Add RA bill
              </Button>
            ) : undefined}
          >
            {schedule.length === 0 ? (
              <TableEmptyState title="No RA bills recorded for this project yet." />
            ) : (
              <Table className={WS_TABLE} containerClassName={`${WS_TABLE_WRAP} max-h-[70vh]`}>
                <TableHeader>
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className={TH}>RA bill</TableHead>
                    <TableHead className={TH}>Period</TableHead>
                    <TableHead className={`${TH} text-right`}>Billed (taxable)</TableHead>
                    <TableHead className={`${TH} text-right`}>Expected recovery</TableHead>
                    <TableHead className={`${TH} text-right`}>Actually adjusted</TableHead>
                    <TableHead className={`${TH} text-right`}>Variance</TableHead>
                    <TableHead className={`${TH} text-right`}>Advance left</TableHead>
                    {canEdit && <TableHead className={`${TH} w-16`} />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.map((row) => (
                    <TableRow key={row.bill.id} className={`border-0 ${WS_TR}`}>
                      <TableCell className={`${WS_TD} font-medium whitespace-nowrap`}>
                        {row.bill.bill_ref || `RA-${row.bill.bill_no}`}
                        {row.beforeAdvance && (
                          <Badge variant="secondary" className="ml-2 text-[10px] font-medium">pre-advance</Badge>
                        )}
                      </TableCell>
                      <TableCell className={WS_TD}>{row.bill.period_month}</TableCell>
                      <TableCell className={WS_TD_NUM}>{inr(row.bill.taxable_value)}</TableCell>
                      <TableCell className={WS_TD_NUM}>{inr(row.expected)}</TableCell>
                      <TableCell className={WS_TD_NUM}>{inr(row.actual)}</TableCell>
                      {/* Variance carries a WORD as well as a tint — these get printed. */}
                      <TableCell className={`${WS_TD_NUM} ${row.variance > 0.5 ? 'text-destructive font-semibold' : ''}`}>
                        {row.variance > 0.5 ? `${inr(row.variance)} short` : inr(row.variance)}
                      </TableCell>
                      <TableCell className={WS_TD_NUM}>{inr(row.advanceOutstanding)}</TableCell>
                      {canEdit && (
                        <TableCell className={`${WS_TD} py-0.5`}>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingBill(row.bill); setBillDialog(true); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeBill(row.bill)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </>
      )}

      <ProjectDialog
        open={projectDialog}
        onOpenChange={setProjectDialog}
        clientId={clientId}
        homeState={homeState}
        existing={editingProject}
        actor={actor}
        onSaved={async () => { await loadProjects(); onChanged(); }}
      />
      {project && (
        <RaBillDialog
          open={billDialog}
          onOpenChange={setBillDialog}
          project={project}
          homeState={homeState}
          periodMonth={periodMonth}
          nextBillNo={(bills.reduce((m, b) => Math.max(m, b.bill_no), 0) || 0) + 1}
          existing={editingBill}
          actor={actor}
          onSaved={async () => setBills(await fetchRaBills(project.id))}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

const ProjectDialog: React.FC<{
  open: boolean; onOpenChange: (v: boolean) => void;
  clientId: string; homeState: string;
  existing: ContractProject | null;
  actor: { id: string | null; name: string };
  onSaved: () => Promise<void>;
}> = ({ open, onOpenChange, clientId, homeState, existing, actor, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    code: '', name: '', department: '', work_order_no: '', work_order_date: '',
    contract_value: '', pos_state: homeState, rate_pct: '18',
    mobilisation_advance_pct: '10', recovery_rule: 'PCT_PER_RA_BILL' as RecoveryRule,
    recovery_pct: '10', recovery_at_bill_no: '', bg_no: '', bg_amount: '', bg_expiry: '',
    retention_pct: '5',
  });

  useEffect(() => {
    if (!open) return;
    setF({
      code: existing?.code || '', name: existing?.name || '', department: existing?.department || '',
      work_order_no: existing?.work_order_no || '', work_order_date: existing?.work_order_date || '',
      contract_value: existing ? String(existing.contract_value) : '',
      pos_state: existing?.pos_state || homeState,
      rate_pct: String(existing?.rate_pct ?? 18),
      mobilisation_advance_pct: String(existing?.mobilisation_advance_pct ?? 10),
      recovery_rule: (existing?.recovery_rule as RecoveryRule) || 'PCT_PER_RA_BILL',
      recovery_pct: String(existing?.recovery_pct ?? 10),
      recovery_at_bill_no: existing?.recovery_at_bill_no ? String(existing.recovery_at_bill_no) : '',
      bg_no: existing?.bg_no || '', bg_amount: existing ? String(existing.bg_amount) : '',
      bg_expiry: existing?.bg_expiry || '', retention_pct: String(existing?.retention_pct ?? 5),
    });
  }, [open, existing, homeState]);

  const submit = async () => {
    if (!f.name.trim() || !f.pos_state) { toast.error('Project name and place of supply are required.'); return; }
    setSaving(true);
    try {
      await saveProject({
        ...(existing?.id ? { id: existing.id } : {}),
        client_id: clientId,
        code: f.code.trim(), name: f.name.trim(), department: f.department.trim(),
        work_order_no: f.work_order_no.trim(),
        work_order_date: f.work_order_date || null,
        contract_value: Number(f.contract_value) || 0,
        pos_state: f.pos_state,
        rate_pct: Number(f.rate_pct) || 0,
        mobilisation_advance_pct: Number(f.mobilisation_advance_pct) || 0,
        recovery_rule: f.recovery_rule,
        recovery_pct: Number(f.recovery_pct) || 0,
        recovery_at_bill_no: f.recovery_at_bill_no ? Number(f.recovery_at_bill_no) : null,
        bg_no: f.bg_no.trim(), bg_amount: Number(f.bg_amount) || 0,
        bg_expiry: f.bg_expiry || null,
        retention_pct: Number(f.retention_pct) || 0,
      }, actor);
      await onSaved();
      onOpenChange(false);
      toast.success(existing ? 'Project updated.' : 'Project added.');
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit project' : 'New contract project'}</DialogTitle>
          <DialogDescription>The work order, its mobilisation advance, and how that advance is recovered.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Code</Label><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div><Label className="text-xs">Project name *</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><Label className="text-xs">Department / agency</Label><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></div>
          <div><Label className="text-xs">Work order no.</Label><Input value={f.work_order_no} onChange={(e) => setF({ ...f, work_order_no: e.target.value })} /></div>
          <div><Label className="text-xs">Work order date</Label><Input type="date" value={f.work_order_date} onChange={(e) => setF({ ...f, work_order_date: e.target.value })} /></div>
          <div><Label className="text-xs">Contract value</Label><Input type="number" value={f.contract_value} onChange={(e) => setF({ ...f, contract_value: e.target.value })} /></div>
          <div className="col-span-2">
            <Label className="text-xs">Place of supply * — location of the property, not the client&apos;s state (s.12(3))</Label>
            <Select value={f.pos_state} onValueChange={(v) => setF({ ...f, pos_state: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GST_STATE_CODES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Rate %</Label><Input type="number" value={f.rate_pct} onChange={(e) => setF({ ...f, rate_pct: e.target.value })} /></div>
          <div><Label className="text-xs">Mobilisation advance %</Label><Input type="number" value={f.mobilisation_advance_pct} onChange={(e) => setF({ ...f, mobilisation_advance_pct: e.target.value })} /></div>
          <div className="col-span-2">
            <Label className="text-xs">Recovery rule</Label>
            <Select value={f.recovery_rule} onValueChange={(v) => setF({ ...f, recovery_rule: v as RecoveryRule })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PCT_PER_RA_BILL">Percentage of every RA bill</SelectItem>
                <SelectItem value="LUMPSUM_AT_BILL_N">Whole advance at one RA bill</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {f.recovery_rule === 'PCT_PER_RA_BILL' ? (
            <div><Label className="text-xs">Recovery % per bill</Label><Input type="number" value={f.recovery_pct} onChange={(e) => setF({ ...f, recovery_pct: e.target.value })} /></div>
          ) : (
            <div><Label className="text-xs">Recover at RA bill no.</Label><Input type="number" value={f.recovery_at_bill_no} onChange={(e) => setF({ ...f, recovery_at_bill_no: e.target.value })} /></div>
          )}
          <div><Label className="text-xs">Retention %</Label><Input type="number" value={f.retention_pct} onChange={(e) => setF({ ...f, retention_pct: e.target.value })} /></div>
          <div><Label className="text-xs">Bank guarantee no.</Label><Input value={f.bg_no} onChange={(e) => setF({ ...f, bg_no: e.target.value })} /></div>
          <div><Label className="text-xs">BG amount</Label><Input type="number" value={f.bg_amount} onChange={(e) => setF({ ...f, bg_amount: e.target.value })} /></div>
          <div><Label className="text-xs">BG expiry</Label><Input type="date" value={f.bg_expiry} onChange={(e) => setF({ ...f, bg_expiry: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {existing ? 'Save changes' : 'Add project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------

const RaBillDialog: React.FC<{
  open: boolean; onOpenChange: (v: boolean) => void;
  project: ContractProject; homeState: string; periodMonth: string; nextBillNo: number;
  existing: ContractRaBill | null;
  actor: { id: string | null; name: string };
  onSaved: () => Promise<void>;
}> = ({ open, onOpenChange, project, homeState, periodMonth, nextBillNo, existing, actor, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ bill_no: '', bill_ref: '', bill_date: '', period_month: '', taxable_value: '', retention_held: '' });

  useEffect(() => {
    if (!open) return;
    setF({
      bill_no: String(existing?.bill_no ?? nextBillNo),
      bill_ref: existing?.bill_ref || '',
      bill_date: existing?.bill_date || '',
      period_month: existing?.period_month || periodMonth,
      taxable_value: existing ? String(existing.taxable_value) : '',
      retention_held: existing ? String(existing.retention_held) : '',
    });
  }, [open, existing, nextBillNo, periodMonth]);

  const taxable = Number(f.taxable_value) || 0;
  const rate = Number(project.rate_pct) || 0;
  // Supply type follows the PROJECT's place of supply, not the client's state.
  const splyTy = project.pos_state === homeState ? 'INTRA' : 'INTER';
  const half = Math.round((rate / 200) * taxable * 100) / 100;
  const igst = Math.round((rate / 100) * taxable * 100) / 100;

  const submit = async () => {
    if (!f.bill_date || !taxable) { toast.error('Bill date and taxable value are required.'); return; }
    setSaving(true);
    try {
      await saveRaBill({
        ...(existing?.id ? { id: existing.id } : {}),
        project_id: project.id,
        client_id: project.client_id,
        bill_no: Number(f.bill_no) || nextBillNo,
        bill_ref: f.bill_ref.trim(),
        bill_date: f.bill_date,
        period_month: f.period_month,
        taxable_value: taxable,
        gross_value: Math.round((taxable * (1 + rate / 100)) * 100) / 100,
        rate_pct: rate,
        igst: splyTy === 'INTER' ? igst : 0,
        cgst: splyTy === 'INTRA' ? half : 0,
        sgst: splyTy === 'INTRA' ? half : 0,
        retention_held: Number(f.retention_held) || 0,
      }, actor);
      await onSaved();
      onOpenChange(false);
      toast.success(existing ? 'RA bill updated.' : 'RA bill added.');
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit RA bill' : 'Add RA bill'}</DialogTitle>
          <DialogDescription>{project.name}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Bill no. *</Label><Input type="number" value={f.bill_no} onChange={(e) => setF({ ...f, bill_no: e.target.value })} /></div>
          <div><Label className="text-xs">Bill reference</Label><Input value={f.bill_ref} onChange={(e) => setF({ ...f, bill_ref: e.target.value })} placeholder="RA-1" /></div>
          <div><Label className="text-xs">Bill date *</Label><Input type="date" value={f.bill_date} onChange={(e) => setF({ ...f, bill_date: e.target.value })} /></div>
          <div><Label className="text-xs">Return period</Label><Input value={f.period_month} onChange={(e) => setF({ ...f, period_month: e.target.value })} placeholder="MM/YYYY" /></div>
          <div><Label className="text-xs">Taxable value *</Label><Input type="number" value={f.taxable_value} onChange={(e) => setF({ ...f, taxable_value: e.target.value })} /></div>
          <div><Label className="text-xs">Retention held</Label><Input type="number" value={f.retention_held} onChange={(e) => setF({ ...f, retention_held: e.target.value })} /></div>
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">{splyTy === 'INTRA' ? 'CGST + SGST' : 'IGST'} at {rate}%</span><span className="tabular-nums font-semibold">₹{inr(splyTy === 'INTRA' ? half * 2 : igst)}</span></div>
          <div className="flex justify-between text-muted-foreground">
            <span>Supply type</span>
            <span>{splyTy === 'INTRA' ? 'Intra-state' : 'Inter-state'} — from the project&apos;s place of supply ({project.pos_state})</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {existing ? 'Save changes' : 'Add RA bill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ContractProjectsPanel;
