import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  ArrowLeft, Loader2, Landmark, Send, Mail, CheckCircle2, ShieldCheck,
  AlertTriangle, Info, Paperclip,
} from 'lucide-react';
import { formatINR, formatSqM } from '@/utils/builderRates';
import {
  FSI_RCM_RATE_PCT, FSI_STATUS_LABEL, consentProgress,
  type FsiStatus, type FsiTreatment,
} from '@/utils/builderFsi';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import {
  approveFsiConsent, postFsiWorking, prepareFsiWorking, recordFsiConfirmation,
  requestFsiConsent, saveFsiWorking, type PreparedFsi,
} from '@/lib/builderFsiData';
import { fetchBuilderSettings } from '@/lib/builderSettings';

interface ProjectRow {
  id: string; client_id: string; name: string;
  fsi_treatment: 'PAY' | 'IGNORE' | null;
}
interface EventRow {
  id: string; bu_date: string; bu_ref_no: string | null;
  posting_period: string; status: string;
}
interface WorkingRow {
  id: string; bu_event_id: string; period_month: string;
  tdr_fsi_total_value: number; allocated_value: number;
  event_carpet_sqm: number; project_carpet_sqm: number;
  residential_carpet_sqm: number; commercial_carpet_sqm: number;
  unbooked_residential_carpet_sqm: number; unbooked_residential_value: number;
  residential_portion: number; residential_rcm_uncapped: number;
  cap_amount: number; cap_applied: boolean; residential_rcm: number;
  commercial_portion: number; commercial_rcm: number;
  total_rcm: number; cgst: number; sgst: number;
  treatment: FsiTreatment; status: FsiStatus; notes: string | null;
}
interface ConsentRow {
  fsi_working_id: string; email_sent_at: string | null;
  confirmation_received_at: string | null; approved_at: string | null;
  confirmation_document_url: string | null; notes: string | null;
  fsi_value_at_request: number; rcm_at_request: number;
}

const fmtWhen = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const BuilderFsiPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { canPostBuEvent, canApproveFsiConsent, user } = useAuth();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [workings, setWorkings] = useState<Record<string, WorkingRow>>({});
  const [consents, setConsents] = useState<Record<string, ConsentRow>>({});
  const [defaultTreatment, setDefaultTreatment] = useState<FsiTreatment>('PAY');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [dialog, setDialog] = useState<EventRow | null>(null);
  const [fsiValue, setFsiValue] = useState('');
  const [treatment, setTreatment] = useState<FsiTreatment>('PAY');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<PreparedFsi | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<WorkingRow | null>(null);
  const [docUrl, setDocUrl] = useState('');
  const [confirmNotes, setConfirmNotes] = useState('');

  const canPost = canPostBuEvent();
  const canApprove = canApproveFsiConsent();

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

      const s = await fetchBuilderSettings(p.client_id);
      setDefaultTreatment((p.fsi_treatment || s.default_fsi_treatment) as FsiTreatment);

      // Only POSTED BU events have a settled booked-vs-unbooked split, which is
      // what the exemption turns on.
      const { data: evt } = await supabase
        .from('builder_bu_events').select('*')
        .eq('project_id', projectId).eq('status', 'POSTED')
        .order('bu_date', { ascending: false });
      const eventRows = (evt || []) as unknown as EventRow[];
      setEvents(eventRows);

      if (eventRows.length) {
        const { data: wk } = await supabase
          .from('builder_fsi_workings').select('*')
          .in('bu_event_id', eventRows.map((e) => e.id));
        const wmap: Record<string, WorkingRow> = {};
        ((wk || []) as unknown as WorkingRow[]).forEach((w) => { wmap[w.bu_event_id] = w; });
        setWorkings(wmap);

        const ids = Object.values(wmap).map((w) => w.id);
        if (ids.length) {
          const { data: cs } = await supabase
            .from('builder_fsi_consents').select('*').in('fsi_working_id', ids);
          const cmap: Record<string, ConsentRow> = {};
          ((cs || []) as unknown as ConsentRow[]).forEach((c) => { cmap[c.fsi_working_id] = c; });
          setConsents(cmap);
        } else setConsents({});
      } else { setWorkings({}); setConsents({}); }
    } catch (e) {
      toast.error(`Could not load: ${(e as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, navigate]);

  useEffect(() => { void load(); }, [load]);

  const openDialog = (ev: EventRow) => {
    const existing = workings[ev.id];
    setDialog(ev);
    setFsiValue(existing ? String(existing.tdr_fsi_total_value) : '');
    setTreatment(existing?.treatment || defaultTreatment);
    setNotes(existing?.notes || '');
    setPreview(null);
  };

  const runPreview = useCallback(async () => {
    if (!dialog || !projectId) return;
    const val = parseFloat(fsiValue) || 0;
    setIsPreparing(true);
    try {
      setPreview(await prepareFsiWorking({
        buEventId: dialog.id, projectId, tdrFsiTotalValue: val,
      }));
    } catch (e) {
      toast.error(`Could not prepare: ${(e as Error).message}`);
    } finally {
      setIsPreparing(false);
    }
  }, [dialog, projectId, fsiValue]);

  useEffect(() => { if (dialog) void runPreview(); }, [dialog, runPreview]);

  const handleSave = async () => {
    if (!dialog || !preview || !projectId) return;
    setIsSaving(true);
    try {
      await saveFsiWorking({
        projectId,
        buEventId: dialog.id,
        prepared: preview,
        tdrFsiTotalValue: parseFloat(fsiValue) || 0,
        treatment,
        notes: notes.trim() || null,
        userId: user?.userId ?? null,
      });
      toast.success('FSI working saved — commit it when you are satisfied');
      setDialog(null);
      await load();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCommit = async (w: WorkingRow) => {
    const msg = w.treatment === 'PAY'
      ? `Post ${formatINR(w.total_rcm)} to 3B Table 3.1(d) for ${prettyPeriodLabel(w.period_month)}? `
        + 'It is payable in cash and the credit is not available under the 1%/5% scheme.'
      : `Hold back ${formatINR(w.total_rcm)} for ${prettyPeriodLabel(w.period_month)}? `
        + "The period will not file until the client's written instruction is on record and a "
        + 'GST Manager has approved it.';
    if (!window.confirm(msg)) return;
    setIsSaving(true);
    try {
      await postFsiWorking({ workingId: w.id, treatment: w.treatment, userId: user?.userId ?? null });
      toast.success(w.treatment === 'PAY' ? 'Posted to Table 3.1(d)' : 'Held back — consent now required');
      await load();
    } catch (e) {
      toast.error(`Could not commit: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestConsent = async (w: WorkingRow, ev: EventRow) => {
    if (!project) return;
    setIsSaving(true);
    try {
      const res = await requestFsiConsent({
        workingId: w.id,
        clientId: project.client_id,
        projectId: project.id,
        projectName: project.name,
        periodMonth: w.period_month,
        buDate: ev.bu_date,
        fsiValue: w.allocated_value,
        rcmAmount: w.total_rcm,
        staffName: user?.firstName ?? null,
        userId: user?.userId ?? null,
      });
      if (!res.ok) { toast.error(res.reason || 'Could not send.'); return; }
      toast.success('Instruction request queued to the client from gst@vjdesai.com');
      await load();
    } catch (e) {
      toast.error(`Could not send: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRecordConfirmation = async () => {
    if (!confirmDialog) return;
    setIsSaving(true);
    try {
      await recordFsiConfirmation({
        workingId: confirmDialog.id,
        documentUrl: docUrl.trim() || null,
        notes: confirmNotes.trim() || null,
        userId: user?.userId ?? null,
      });
      toast.success('Confirmation recorded — awaiting GST Manager approval');
      setConfirmDialog(null);
      setDocUrl(''); setConfirmNotes('');
      await load();
    } catch (e) {
      toast.error(`Could not record: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async (w: WorkingRow) => {
    if (!window.confirm(
      "Approve the client's instruction not to discharge this liability? "
      + 'This releases the period for filing.',
    )) return;
    setIsSaving(true);
    try {
      await approveFsiConsent({ workingId: w.id, userId: user?.userId ?? null });
      toast.success('Approved — the period is released for filing');
      await load();
    } catch (e) {
      toast.error(`Could not approve: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const blockedCount = useMemo(
    () => Object.values(workings).filter(
      (w) => w.treatment === 'IGNORE' && w.status === 'IGNORED' && w.total_rcm > 0
        && !consentProgress(consents[w.id]
          ? {
            emailSentAt: consents[w.id].email_sent_at,
            confirmationReceivedAt: consents[w.id].confirmation_received_at,
            approvedAt: consents[w.id].approved_at,
          } : null).complete,
    ).length,
    [workings, consents],
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading FSI workings…
      </div>
    );
  }
  if (!project) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.name} — TDR / FSI`}
        subtitle="Reverse charge on development rights, crystallising at each BU date"
        icon={<Landmark className="h-5 w-5" />}
        actions={
          <Button variant="outline" onClick={() => navigate(`/builder-projects/${projectId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Project
          </Button>
        }
      />

      <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p className="text-xs">
          Two legs. The <strong>residential</strong> portion attributable to units <em>unbooked</em> at the
          cut-off is taxed at {FSI_RCM_RATE_PCT}% but capped at 1%/5% of those units' value; units booked
          before the permission are exempt. The <strong>commercial</strong> portion is taxed at{' '}
          {FSI_RCM_RATE_PCT}% in full — no exemption, no cap. Both are paid in cash through 3B Table
          3.1(d); the credit is blocked under the 1%/5% scheme.
        </p>
      </div>

      {blockedCount > 0 && (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p className="text-xs">
            {blockedCount} FSI liability{blockedCount > 1 ? ' items are' : ' is'} being held back without a
            complete consent. Those periods will not file until the client's written instruction is
            attached and a GST Manager has approved it.
          </p>
        </div>
      )}

      {events.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Landmark className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              No posted BU events yet. The FSI liability crystallises on the BU date, so the event has to
              be posted before its working can be prepared.
            </p>
          </CardContent>
        </Card>
      ) : (
        events.map((ev) => {
          const w = workings[ev.id];
          const c = w ? consents[w.id] : undefined;
          const progress = consentProgress(c ? {
            emailSentAt: c.email_sent_at,
            confirmationReceivedAt: c.confirmation_received_at,
            approvedAt: c.approved_at,
          } : null);

          return (
            <Card key={ev.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      BU dated {ev.bu_date}
                      {ev.bu_ref_no && <span className="text-muted-foreground font-normal">· {ev.bu_ref_no}</span>}
                      {w && (
                        <Badge className={
                          w.status === 'POSTED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : w.status === 'IGNORED' ? 'bg-amber-100 text-amber-800 border-amber-200'
                              : ''
                        }>
                          {FSI_STATUS_LABEL[w.status]}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Posts to {prettyPeriodLabel(ev.posting_period)}
                      {w && ` · FSI value ${formatINR(w.tdr_fsi_total_value)}`}
                    </CardDescription>
                  </div>
                  {canPost && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openDialog(ev)}>
                        {w ? 'Re-prepare' : 'Prepare working'}
                      </Button>
                      {w && w.status === 'DRAFT' && (
                        <Button size="sm" onClick={() => handleCommit(w)} disabled={isSaving}>
                          <Send className="h-4 w-4 mr-2" /> Commit
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>

              {w && (
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <div>
                      <p className="text-xs text-muted-foreground">Allocated to this BU</p>
                      <p className="text-sm font-semibold">{formatINR(w.allocated_value)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatSqM(w.event_carpet_sqm)} of {formatSqM(w.project_carpet_sqm)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Unbooked residential</p>
                      <p className="text-sm font-semibold">{formatSqM(w.unbooked_residential_carpet_sqm)}</p>
                      <p className="text-xs text-muted-foreground">{formatINR(w.unbooked_residential_value)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Residential RCM</p>
                      <p className="text-sm font-semibold">{formatINR(w.residential_rcm)}</p>
                      {w.cap_applied && (
                        <p className="text-xs text-amber-700">
                          capped from {formatINR(w.residential_rcm_uncapped)}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Commercial RCM</p>
                      <p className="text-sm font-semibold">{formatINR(w.commercial_rcm)}</p>
                      <p className="text-xs text-muted-foreground">no cap</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total → 3.1(d)</p>
                      <p className="text-sm font-semibold">{formatINR(w.total_rcm)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatINR(w.cgst)} + {formatINR(w.sgst)}
                      </p>
                    </div>
                  </div>

                  {w.cap_applied && (
                    <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-900">
                      <Info className="h-4 w-4 shrink-0 mt-0.5" />
                      <p className="text-xs">
                        The statutory cap bites: {FSI_RCM_RATE_PCT}% on the attributable portion would be{' '}
                        {formatINR(w.residential_rcm_uncapped)}, but the liability is limited to{' '}
                        {formatINR(w.cap_amount)} — 1%/5% of the value of the unbooked residential units,
                        summed per unit at each one's own rate.
                      </p>
                    </div>
                  )}

                  {/* ── Consent trail ─────────────────────────────────── */}
                  {w.treatment === 'IGNORE' && w.total_rcm > 0 && (
                    <div className="rounded-lg border p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-medium">Client instruction</p>
                        <Badge className={progress.complete
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : 'bg-red-100 text-red-800 border-red-200'}>
                          {progress.complete ? 'Filing released' : `Blocked — ${progress.nextStep}`}
                        </Badge>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3 text-sm">
                        <div className="flex items-start gap-2">
                          <Mail className={`h-4 w-4 mt-0.5 ${progress.emailSent ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                          <div>
                            <p className="text-xs text-muted-foreground">Request sent</p>
                            <p className="font-medium">{fmtWhen(c?.email_sent_at ?? null)}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className={`h-4 w-4 mt-0.5 ${progress.confirmationReceived ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                          <div>
                            <p className="text-xs text-muted-foreground">Confirmation received</p>
                            <p className="font-medium">{fmtWhen(c?.confirmation_received_at ?? null)}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <ShieldCheck className={`h-4 w-4 mt-0.5 ${progress.approved ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                          <div>
                            <p className="text-xs text-muted-foreground">GST Manager approval</p>
                            <p className="font-medium">{fmtWhen(c?.approved_at ?? null)}</p>
                          </div>
                        </div>
                      </div>

                      {c?.confirmation_document_url && (
                        <p className="text-xs text-muted-foreground break-all">
                          <Paperclip className="h-3 w-3 inline mr-1" />
                          {c.confirmation_document_url}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {canPost && !progress.emailSent && (
                          <Button size="sm" variant="outline" onClick={() => handleRequestConsent(w, ev)} disabled={isSaving}>
                            <Mail className="h-4 w-4 mr-2" /> Request instruction
                          </Button>
                        )}
                        {canPost && progress.emailSent && !progress.confirmationReceived && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setConfirmDialog(w)}>
                              <CheckCircle2 className="h-4 w-4 mr-2" /> Record confirmation
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleRequestConsent(w, ev)} disabled={isSaving}>
                              Resend
                            </Button>
                          </>
                        )}
                        {progress.confirmationReceived && !progress.approved && (
                          canApprove ? (
                            <Button size="sm" onClick={() => handleApprove(w)} disabled={isSaving}>
                              <ShieldCheck className="h-4 w-4 mr-2" /> Approve
                            </Button>
                          ) : (
                            <p className="text-xs text-muted-foreground self-center">
                              Only a GST Manager or Superadmin can approve this.
                            </p>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })
      )}

      {/* ── Prepare dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>FSI working — BU dated {dialog?.bu_date}</DialogTitle>
            <DialogDescription>
              Enter the whole project's development-rights cost; this BU event takes its share by carpet
              area. Booked-versus-unbooked is read from the event's own working, frozen at the cut-off.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="f-val">TDR / FSI value for the project</Label>
              <Input
                id="f-val" type="number" step="0.01" value={fsiValue}
                onChange={(e) => setFsiValue(e.target.value)}
                onBlur={() => void runPreview()}
              />
            </div>
            <div>
              <Label>Treatment</Label>
              <Select value={treatment} onValueChange={(v) => setTreatment(v as FsiTreatment)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PAY">Pay the reverse charge</SelectItem>
                  <SelectItem value="IGNORE">Hold back — client instruction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="f-notes">Notes</Label>
              <Input id="f-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {treatment === 'IGNORE' && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs">
                Holding this back blocks the period from filing until the client's written instruction is
                on record and a GST Manager has approved it. The position is the client's, and the file
                has to show that.
              </p>
            </div>
          )}

          <div className="rounded-lg border p-3 bg-muted/30">
            {isPreparing ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Computing…
              </div>
            ) : !preview ? (
              <p className="text-sm text-muted-foreground">Enter a value to see the working.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm">Allocated to this BU (by carpet area)</TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatINR(preview.working.allocatedValue)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm">Portion — unbooked residential</TableCell>
                      <TableCell className="text-right text-sm">
                        {formatINR(preview.working.residentialPortion)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm pl-6 text-muted-foreground">
                        at {FSI_RCM_RATE_PCT}%
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatINR(preview.working.residentialRcmUncapped)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm pl-6 text-muted-foreground">
                        cap — 1%/5% of unbooked residential value
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatINR(preview.working.capAmount)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm font-medium">Residential RCM</TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatINR(preview.working.residentialRcm)}
                        {preview.working.capApplied && (
                          <span className="block text-xs text-amber-700">cap applied</span>
                        )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm">
                        Portion — commercial, at {FSI_RCM_RATE_PCT}% uncapped
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatINR(preview.working.commercialRcm)}
                      </TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/50">
                      <TableCell className="font-semibold">Total → 3B Table 3.1(d)</TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatINR(preview.working.totalRcm)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving || isPreparing || !preview}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save working
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirmation dialog ──────────────────────────────────────────── */}
      <Dialog open={!!confirmDialog} onOpenChange={(o) => !o && setConfirmDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record the client's confirmation</DialogTitle>
            <DialogDescription>
              Attach their written instruction. A GST Manager still has to approve it before the period
              will file.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="c-doc">Link to the confirmation</Label>
              <Input
                id="c-doc" value={docUrl} placeholder="Link to the email or scanned letter"
                onChange={(e) => setDocUrl(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="c-notes">Notes</Label>
              <Input id="c-notes" value={confirmNotes} onChange={(e) => setConfirmNotes(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button onClick={handleRecordConfirmation} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BuilderFsiPage;
