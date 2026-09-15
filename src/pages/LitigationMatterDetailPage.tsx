import React, { useEffect, useState } from 'react';
import { Navigate, useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useStaffList } from '@/hooks/useStaffList';
import {
  Briefcase, Loader2, ArrowLeft, Calendar, User, FileText, Scale, Clock,
  DollarSign, Gavel, Upload, Plus, Activity, AlertTriangle, CheckCircle2,
  XCircle, RotateCcw,
} from 'lucide-react';

interface Matter {
  id: string;
  client_id: string;
  matter_no: string;
  lifecycle: string;
  title: string | null;
  section_of_law: string | null;
  financial_years: string[] | null;
  authority: string | null;
  officer: string | null;
  jurisdiction: string | null;
  stage: string;
  status: string;
  priority: string | null;
  owner_user_id: string | null;
  reviewer_user_id: string | null;
  demand_tax: number;
  demand_interest: number;
  demand_penalty: number;
  demand_cess: number;
  paid_total: number;
  pre_deposit_total: number;
  computed_due_date: string | null;
  override_due_date: string | null;
  limitation_date: string | null;
  hearing_at: string | null;
  next_action: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface LinkedNotice {
  id: string;
  notice_type: string | null;
  reference_number: string | null;
  description: string | null;
  issue_date: string | null;
  due_date: string | null;
  staff_status: string | null;
  amount_of_demand: number | null;
}

interface MatterEvent {
  id: string;
  event_type: string;
  actor_name: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

interface Hearing {
  id: string;
  scheduled_at: string;
  mode: string | null;
  venue: string | null;
  officer: string | null;
  outcome: string | null;
  adjourned: boolean;
  next_date: string | null;
  notes: string | null;
}

interface Payment {
  id: string;
  kind: string;
  drc03_arn: string | null;
  tax: number;
  interest: number;
  penalty: number;
  cess: number;
  paid_on: string | null;
  remarks: string | null;
}

interface MatterDoc {
  id: string;
  kind: string;
  title: string;
  source: string;
  created_at: string;
}

const STAGES = [
  'Captured', 'Triage', 'Awaiting client data', 'Reply drafting',
  'Partner review', 'Filed/submitted', 'Hearing', 'Order received',
  'Appeal decision', 'Appeal filed', 'Closed',
];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function fmtMoney(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(iso);
}

function stageBadgeClass(stage: string): string {
  const s = stage.toLowerCase();
  if (s.startsWith('captured') || s.startsWith('triage')) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (s.includes('awaiting') || s.includes('drafting')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (s.includes('partner')) return 'bg-violet-50 text-violet-700 border-violet-200';
  if (s.includes('filed') || s.includes('submitted')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (s.includes('hearing')) return 'bg-orange-50 text-orange-700 border-orange-200';
  if (s.includes('order')) return 'bg-red-50 text-red-700 border-red-200';
  if (s.includes('appeal')) return 'bg-purple-50 text-purple-700 border-purple-200';
  if (s.includes('closed')) return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

const LitigationMatterDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { isStaffRole, user } = useAuth();
  const navigate = useNavigate();
  const { staff } = useStaffList();

  const [matter, setMatter] = useState<Matter | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientGstin, setClientGstin] = useState('');
  const [notices, setNotices] = useState<LinkedNotice[]>([]);
  const [events, setEvents] = useState<MatterEvent[]>([]);
  const [hearings, setHearings] = useState<Hearing[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [documents, setDocuments] = useState<MatterDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [newStage, setNewStage] = useState('');
  const [stageNote, setStageNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [hearingDialogOpen, setHearingDialogOpen] = useState(false);
  const [hearingDate, setHearingDate] = useState('');
  const [hearingMode, setHearingMode] = useState('physical');
  const [hearingVenue, setHearingVenue] = useState('');
  const [hearingOfficer, setHearingOfficer] = useState('');

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentKind, setPaymentKind] = useState('voluntary');
  const [payTax, setPayTax] = useState('');
  const [payInterest, setPayInterest] = useState('');
  const [payPenalty, setPayPenalty] = useState('');
  const [payCess, setPayCess] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payRemarks, setPayRemarks] = useState('');

  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');

  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const [outcomeHearingId, setOutcomeHearingId] = useState('');
  const [outcomeText, setOutcomeText] = useState('');
  const [outcomeAdjourned, setOutcomeAdjourned] = useState(false);
  const [outcomeNextDate, setOutcomeNextDate] = useState('');
  const [outcomeNotes, setOutcomeNotes] = useState('');

  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docKind, setDocKind] = useState('order');
  const [docSource, setDocSource] = useState('manual');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ data: m }, { data: n }, { data: ev }, { data: h }, { data: p }, { data: d }] = await Promise.all([
        supabase.from('litigation_matters').select('*').eq('id', id).maybeSingle(),
        supabase.from('gst_notices').select('id, notice_type, reference_number, description, issue_date, due_date, staff_status, amount_of_demand').eq('matter_id', id).is('deleted_at', null),
        supabase.from('matter_events').select('id, event_type, actor_name, payload, created_at').eq('matter_id', id).order('created_at', { ascending: false }).limit(50),
        supabase.from('matter_hearings').select('*').eq('matter_id', id).order('scheduled_at', { ascending: false }),
        supabase.from('matter_payments').select('*').eq('matter_id', id).order('created_at', { ascending: false }),
        supabase.from('matter_documents').select('id, kind, title, source, created_at').eq('matter_id', id).order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      setMatter(m as Matter | null);
      setNotices((n ?? []) as LinkedNotice[]);
      setEvents((ev ?? []) as MatterEvent[]);
      setHearings((h ?? []) as Hearing[]);
      setPayments((p ?? []) as Payment[]);
      setDocuments((d ?? []) as MatterDoc[]);

      if (m?.client_id) {
        const { data: c } = await supabase.from('clients').select('name, gstin').eq('id', m.client_id).maybeSingle();
        if (!cancelled && c) {
          setClientName(c.name || '');
          setClientGstin(c.gstin || '');
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!matter) {
    return (
      <div className="space-y-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">Matter not found.</p>
        <Button variant="outline" onClick={() => navigate('/litigation')}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Matters
        </Button>
      </div>
    );
  }

  const effectiveDue = matter.override_due_date || matter.computed_due_date;
  const totalDemand = matter.demand_tax + matter.demand_interest + matter.demand_penalty + matter.demand_cess;
  const outstanding = totalDemand - matter.paid_total;
  const ownerStaff = staff.find((s) => s.userId === matter.owner_user_id);
  const reviewerStaff = staff.find((s) => s.userId === matter.reviewer_user_id);

  const logEvent = async (eventType: string, payload?: Record<string, unknown>) => {
    await supabase.from('matter_events').insert({
      matter_id: matter.id,
      event_type: eventType,
      actor_user_id: user?.id ?? null,
      actor_name: user?.name || user?.firstName || null,
      payload: payload ?? null,
    });
  };

  const handleStageChange = async () => {
    if (!newStage) return;
    setSaving(true);
    const oldStage = matter.stage;
    const { error } = await supabase
      .from('litigation_matters')
      .update({ stage: newStage, updated_at: new Date().toISOString() })
      .eq('id', matter.id);
    if (error) { toast.error(error.message); setSaving(false); return; }
    await supabase.from('matter_stage_history').insert({
      matter_id: matter.id,
      from_stage: oldStage,
      to_stage: newStage,
      changed_by: user?.id ?? null,
      note: stageNote || null,
    });
    await logEvent('stage_changed', { from: oldStage, to: newStage, note: stageNote || null });
    setMatter({ ...matter, stage: newStage });
    setStageDialogOpen(false);
    setNewStage('');
    setStageNote('');
    setSaving(false);
    toast.success(`Stage updated to ${newStage}`);
  };

  const handleAssign = async (userId: string) => {
    const { error } = await supabase
      .from('litigation_matters')
      .update({ owner_user_id: userId || null, updated_at: new Date().toISOString() })
      .eq('id', matter.id);
    if (error) { toast.error(error.message); return; }
    const s = staff.find((st) => st.userId === userId);
    await logEvent('assigned', { owner: s?.name || userId });
    setMatter({ ...matter, owner_user_id: userId || null });
    toast.success('Owner updated');
  };

  const handlePriorityChange = async (p: string) => {
    const { error } = await supabase
      .from('litigation_matters')
      .update({ priority: p, updated_at: new Date().toISOString() })
      .eq('id', matter.id);
    if (error) { toast.error(error.message); return; }
    await logEvent('priority_changed', { priority: p });
    setMatter({ ...matter, priority: p });
  };

  const handleClose = async () => {
    if (!closeReason.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('litigation_matters')
      .update({ status: 'Closed', closed_at: now, closed_reason: closeReason, stage: 'Closed', updated_at: now })
      .eq('id', matter.id);
    if (error) { toast.error(error.message); setSaving(false); return; }
    await supabase.from('matter_stage_history').insert({
      matter_id: matter.id, from_stage: matter.stage, to_stage: 'Closed',
      changed_by: user?.id ?? null, note: closeReason,
    });
    await logEvent('closed', { reason: closeReason });
    setMatter({ ...matter, status: 'Closed', stage: 'Closed', closed_at: now, closed_reason: closeReason });
    setCloseDialogOpen(false);
    setCloseReason('');
    setSaving(false);
    toast.success('Matter closed');
  };

  const handleReopen = async () => {
    const { error } = await supabase
      .from('litigation_matters')
      .update({ status: 'Open', closed_at: null, closed_reason: null, stage: 'Triage', updated_at: new Date().toISOString() })
      .eq('id', matter.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from('matter_stage_history').insert({
      matter_id: matter.id, from_stage: 'Closed', to_stage: 'Triage',
      changed_by: user?.id ?? null, note: 'Reopened',
    });
    await logEvent('reopened');
    setMatter({ ...matter, status: 'Open', stage: 'Triage', closed_at: null, closed_reason: null });
    toast.success('Matter reopened');
  };

  const handleAddHearing = async () => {
    if (!hearingDate) return;
    setSaving(true);
    const { error } = await supabase.from('matter_hearings').insert({
      matter_id: matter.id,
      scheduled_at: hearingDate,
      mode: hearingMode,
      venue: hearingVenue || null,
      officer: hearingOfficer || null,
    });
    if (error) { toast.error(error.message); setSaving(false); return; }
    await logEvent('hearing_scheduled', { date: hearingDate, mode: hearingMode });
    await supabase.from('litigation_matters')
      .update({ hearing_at: hearingDate, updated_at: new Date().toISOString() })
      .eq('id', matter.id);
    setMatter({ ...matter, hearing_at: hearingDate });
    setHearingDialogOpen(false);
    setHearingDate('');
    setHearingVenue('');
    setHearingOfficer('');
    setSaving(false);
    toast.success('Hearing scheduled');
    const { data: h } = await supabase.from('matter_hearings').select('*').eq('matter_id', matter.id).order('scheduled_at', { ascending: false });
    setHearings((h ?? []) as Hearing[]);
  };

  const handleAddPayment = async () => {
    setSaving(true);
    const t = parseFloat(payTax) || 0;
    const i = parseFloat(payInterest) || 0;
    const p = parseFloat(payPenalty) || 0;
    const c = parseFloat(payCess) || 0;
    const total = t + i + p + c;
    const { error } = await supabase.from('matter_payments').insert({
      matter_id: matter.id, kind: paymentKind,
      tax: t, interest: i, penalty: p, cess: c,
      paid_on: payDate || null, remarks: payRemarks || null,
    });
    if (error) { toast.error(error.message); setSaving(false); return; }
    const newPaid = matter.paid_total + total;
    await supabase.from('litigation_matters')
      .update({ paid_total: newPaid, updated_at: new Date().toISOString() })
      .eq('id', matter.id);
    await logEvent('payment_added', { kind: paymentKind, amount: total });
    setMatter({ ...matter, paid_total: newPaid });
    setPaymentDialogOpen(false);
    setPayTax(''); setPayInterest(''); setPayPenalty(''); setPayCess('');
    setPayDate(''); setPayRemarks('');
    setSaving(false);
    toast.success('Payment recorded');
    const { data: ps } = await supabase.from('matter_payments').select('*').eq('matter_id', matter.id).order('created_at', { ascending: false });
    setPayments((ps ?? []) as Payment[]);
  };

  const handleAssignReviewer = async (userId: string) => {
    const { error } = await supabase
      .from('litigation_matters')
      .update({ reviewer_user_id: userId || null, updated_at: new Date().toISOString() })
      .eq('id', matter.id);
    if (error) { toast.error(error.message); return; }
    const s = staff.find((st) => st.userId === userId);
    await logEvent('reviewer_assigned', { reviewer: s?.name || userId });
    setMatter({ ...matter, reviewer_user_id: userId || null });
    toast.success('Reviewer updated');
  };

  const handleRecordOutcome = async () => {
    if (!outcomeHearingId) return;
    setSaving(true);
    const { error } = await supabase.from('matter_hearings')
      .update({
        outcome: outcomeText || null,
        adjourned: outcomeAdjourned,
        next_date: outcomeNextDate || null,
        notes: outcomeNotes || null,
      })
      .eq('id', outcomeHearingId);
    if (error) { toast.error(error.message); setSaving(false); return; }
    await logEvent('hearing_outcome', { outcome: outcomeText, adjourned: outcomeAdjourned });
    if (outcomeAdjourned && outcomeNextDate) {
      await supabase.from('litigation_matters')
        .update({ hearing_at: outcomeNextDate, updated_at: new Date().toISOString() })
        .eq('id', matter.id);
      setMatter({ ...matter, hearing_at: outcomeNextDate });
    }
    setOutcomeDialogOpen(false);
    setOutcomeHearingId('');
    setOutcomeText('');
    setOutcomeAdjourned(false);
    setOutcomeNextDate('');
    setOutcomeNotes('');
    setSaving(false);
    toast.success('Hearing outcome recorded');
    const { data: h } = await supabase.from('matter_hearings').select('*').eq('matter_id', matter.id).order('scheduled_at', { ascending: false });
    setHearings((h ?? []) as Hearing[]);
  };

  const handleAddDocument = async () => {
    if (!docTitle.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('matter_documents').insert({
      matter_id: matter.id,
      kind: docKind,
      title: docTitle.trim(),
      source: docSource,
    });
    if (error) { toast.error(error.message); setSaving(false); return; }
    await logEvent('document_added', { title: docTitle, kind: docKind });
    setDocDialogOpen(false);
    setDocTitle('');
    setDocKind('order');
    setDocSource('manual');
    setSaving(false);
    toast.success('Document added');
    const { data: d } = await supabase.from('matter_documents').select('id, kind, title, source, created_at').eq('matter_id', matter.id).order('created_at', { ascending: false });
    setDocuments((d ?? []) as MatterDoc[]);
  };

  const handleDemandUpdate = async (field: string, value: string) => {
    const num = parseFloat(value) || 0;
    const { error } = await supabase
      .from('litigation_matters')
      .update({ [field]: num, updated_at: new Date().toISOString() })
      .eq('id', matter.id);
    if (error) { toast.error(error.message); return; }
    setMatter({ ...matter, [field]: num });
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/litigation')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          title={matter.matter_no}
          icon={<Briefcase className="h-5 w-5" />}
          embedded
        />
      </div>

      {/* Header card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{matter.title || matter.matter_no}</h2>
              <p className="text-sm text-muted-foreground">
                <Link to={`/notices-company/${matter.client_id}`} className="text-primary hover:underline">{clientName}</Link>
                {clientGstin && <span className="ml-1.5 font-mono text-xs">({clientGstin})</span>}
              </p>
              {matter.section_of_law && <p className="text-xs text-muted-foreground">{matter.section_of_law}</p>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className={stageBadgeClass(matter.stage)}>{matter.stage}</Badge>
              <Badge variant="outline" className="capitalize">{matter.lifecycle}</Badge>
              {matter.priority && (
                <Badge variant="outline" className={
                  matter.priority.toLowerCase() === 'high' ? 'bg-red-50 text-red-700 border-red-200' :
                  matter.priority.toLowerCase() === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                  'bg-slate-50 text-slate-600 border-slate-200'
                }>{matter.priority}</Badge>
              )}
              {matter.status === 'Closed' && (
                <Badge variant="outline" className="bg-slate-100 text-slate-600">Closed: {matter.closed_reason}</Badge>
              )}
            </div>
          </div>

          <Separator className="my-3" />

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Due Date</p>
              <p className="text-sm">{fmtDate(effectiveDue)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Limitation</p>
              <p className="text-sm">{fmtDate(matter.limitation_date)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Next Hearing</p>
              <p className="text-sm">{fmtDate(matter.hearing_at)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Authority</p>
              <p className="text-sm">{matter.authority || '—'} {matter.officer && `· ${matter.officer}`}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Owner</p>
              <Select value={matter.owner_user_id || ''} onValueChange={handleAssign}>
                <SelectTrigger className="h-7 w-[160px] text-xs">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.userId} value={s.userId}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Priority</p>
              <Select value={matter.priority || 'Medium'} onValueChange={handlePriorityChange}>
                <SelectTrigger className="h-7 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Reviewer</p>
              <Select value={matter.reviewer_user_id || ''} onValueChange={handleAssignReviewer}>
                <SelectTrigger className="h-7 w-[160px] text-xs">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.userId} value={s.userId}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {matter.next_action && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Next Action</p>
                <p className="text-sm">{matter.next_action}</p>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setNewStage(matter.stage); setStageDialogOpen(true); }}>
              Change Stage
            </Button>
            {matter.status === 'Open' ? (
              <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={() => setCloseDialogOpen(true)}>
                <XCircle className="mr-1 h-3 w-3" /> Close
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleReopen}>
                <RotateCcw className="mr-1 h-3 w-3" /> Reopen
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setHearingDialogOpen(true)}>
              <Calendar className="mr-1 h-3 w-3" /> Schedule Hearing
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPaymentDialogOpen(true)}>
              <DollarSign className="mr-1 h-3 w-3" /> Record Payment
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Financial summary */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {[
          { label: 'Tax', value: matter.demand_tax, field: 'demand_tax' },
          { label: 'Interest', value: matter.demand_interest, field: 'demand_interest' },
          { label: 'Penalty', value: matter.demand_penalty, field: 'demand_penalty' },
          { label: 'Cess', value: matter.demand_cess, field: 'demand_cess' },
        ].map((d) => (
          <Card key={d.field}>
            <CardContent className="p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Demand {d.label}</p>
              <Input
                type="number"
                className="mt-1 h-7 text-sm font-semibold tabular-nums"
                defaultValue={d.value || ''}
                onBlur={(e) => handleDemandUpdate(d.field, e.target.value)}
              />
            </CardContent>
          </Card>
        ))}
        <Card className={cn(outstanding > 0 ? 'border-destructive/30 bg-destructive/5' : 'border-emerald-200 bg-emerald-50')}>
          <CardContent className="p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Outstanding</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{fmtMoney(outstanding)}</p>
            <p className="text-[10px] text-muted-foreground">Paid: {fmtMoney(matter.paid_total)} / Pre-deposit: {fmtMoney(matter.pre_deposit_total)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Notices, Hearings, Payments, Documents, Activity */}
      <Tabs defaultValue="notices">
        <TabsList>
          <TabsTrigger value="notices" className="text-xs">Notices ({notices.length})</TabsTrigger>
          <TabsTrigger value="hearings" className="text-xs">Hearings ({hearings.length})</TabsTrigger>
          <TabsTrigger value="payments" className="text-xs">Payments ({payments.length})</TabsTrigger>
          <TabsTrigger value="documents" className="text-xs">Documents ({documents.length})</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs">Activity ({events.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="notices">
          <Card>
            <CardContent className="p-0">
              {notices.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">No notices linked to this matter.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">Type</TableHead>
                      <TableHead className="text-[11px]">Reference</TableHead>
                      <TableHead className="text-[11px]">Description</TableHead>
                      <TableHead className="text-[11px]">Issue Date</TableHead>
                      <TableHead className="text-[11px]">Due Date</TableHead>
                      <TableHead className="text-[11px]">Status</TableHead>
                      <TableHead className="text-right text-[11px]">Demand</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notices.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell className="text-xs">{n.notice_type || '—'}</TableCell>
                        <TableCell className="text-xs font-mono">{n.reference_number || '—'}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{n.description || '—'}</TableCell>
                        <TableCell className="text-xs">{fmtDate(n.issue_date)}</TableCell>
                        <TableCell className="text-xs">{fmtDate(n.due_date)}</TableCell>
                        <TableCell className="text-xs">{n.staff_status || '—'}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {n.amount_of_demand ? fmtMoney(n.amount_of_demand) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hearings">
          <Card>
            <CardContent className="p-0">
              {hearings.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">No hearings scheduled.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">Date</TableHead>
                      <TableHead className="text-[11px]">Mode</TableHead>
                      <TableHead className="text-[11px]">Venue</TableHead>
                      <TableHead className="text-[11px]">Officer</TableHead>
                      <TableHead className="text-[11px]">Outcome</TableHead>
                      <TableHead className="text-[11px]">Adjourned</TableHead>
                      <TableHead className="text-[11px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hearings.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="text-xs">{fmtDate(h.scheduled_at)}</TableCell>
                        <TableCell className="text-xs capitalize">{h.mode || '—'}</TableCell>
                        <TableCell className="text-xs">{h.venue || '—'}</TableCell>
                        <TableCell className="text-xs">{h.officer || '—'}</TableCell>
                        <TableCell className="text-xs">{h.outcome || '—'}</TableCell>
                        <TableCell className="text-xs">{h.adjourned ? 'Yes' : '—'}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px]"
                            onClick={() => {
                              setOutcomeHearingId(h.id);
                              setOutcomeText(h.outcome || '');
                              setOutcomeAdjourned(h.adjourned);
                              setOutcomeNextDate(h.next_date || '');
                              setOutcomeNotes(h.notes || '');
                              setOutcomeDialogOpen(true);
                            }}
                          >
                            {h.outcome ? 'Edit' : 'Record Outcome'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">No payments recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">Kind</TableHead>
                      <TableHead className="text-right text-[11px]">Tax</TableHead>
                      <TableHead className="text-right text-[11px]">Interest</TableHead>
                      <TableHead className="text-right text-[11px]">Penalty</TableHead>
                      <TableHead className="text-right text-[11px]">Cess</TableHead>
                      <TableHead className="text-[11px]">Paid On</TableHead>
                      <TableHead className="text-[11px]">Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs capitalize">{p.kind.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtMoney(p.tax)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtMoney(p.interest)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtMoney(p.penalty)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtMoney(p.cess)}</TableCell>
                        <TableCell className="text-xs">{fmtDate(p.paid_on)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.remarks || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-sm">Documents</CardTitle>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDocDialogOpen(true)}>
                <Plus className="mr-1 h-3 w-3" /> Add Document
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {documents.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">No documents attached.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">Title</TableHead>
                      <TableHead className="text-[11px]">Kind</TableHead>
                      <TableHead className="text-[11px]">Source</TableHead>
                      <TableHead className="text-[11px]">Added</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-xs">{d.title}</TableCell>
                        <TableCell className="text-xs capitalize">{d.kind}</TableCell>
                        <TableCell className="text-xs capitalize">{d.source}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtRelative(d.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardContent className="py-3">
              {events.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">No activity yet.</p>
              ) : (
                <div className="space-y-2">
                  {events.map((ev) => (
                    <div key={ev.id} className="flex items-start gap-2 text-xs">
                      <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                      <div className="min-w-0">
                        <span className="font-medium">{ev.event_type.replace(/_/g, ' ')}</span>
                        {ev.actor_name && <span className="text-muted-foreground"> by {ev.actor_name}</span>}
                        <span className="ml-1 text-muted-foreground">{fmtRelative(ev.created_at)}</span>
                        {ev.payload && typeof ev.payload === 'object' && Object.keys(ev.payload).length > 0 && (
                          <p className="text-muted-foreground">
                            {Object.entries(ev.payload).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Change Stage dialog */}
      <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change Stage</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>New Stage</Label>
              <Select value={newStage} onValueChange={setNewStage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Textarea value={stageNote} onChange={(e) => setStageNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStageDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleStageChange} disabled={saving || !newStage}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close Matter</DialogTitle></DialogHeader>
          <div>
            <Label>Reason</Label>
            <Select value={closeReason} onValueChange={setCloseReason}>
              <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dropped">Dropped</SelectItem>
                <SelectItem value="paid">Paid / Settled</SelectItem>
                <SelectItem value="won">Won</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
                <SelectItem value="partly">Partly Allowed</SelectItem>
                <SelectItem value="withdrawn">Withdrawn</SelectItem>
                <SelectItem value="auto:closure">Auto-closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleClose} disabled={saving || !closeReason} variant="destructive">
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Close Matter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add hearing dialog */}
      <Dialog open={hearingDialogOpen} onOpenChange={setHearingDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule Hearing</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Date & Time</Label>
              <Input type="datetime-local" value={hearingDate} onChange={(e) => setHearingDate(e.target.value)} />
            </div>
            <div>
              <Label>Mode</Label>
              <Select value={hearingMode} onValueChange={setHearingMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="physical">Physical</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Venue</Label>
              <Input value={hearingVenue} onChange={(e) => setHearingVenue(e.target.value)} />
            </div>
            <div>
              <Label>Officer</Label>
              <Input value={hearingOfficer} onChange={(e) => setHearingOfficer(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHearingDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddHearing} disabled={saving || !hearingDate}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record hearing outcome dialog */}
      <Dialog open={outcomeDialogOpen} onOpenChange={setOutcomeDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Hearing Outcome</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Outcome</Label>
              <Select value={outcomeText} onValueChange={setOutcomeText}>
                <SelectTrigger><SelectValue placeholder="Select outcome" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Adjourned">Adjourned</SelectItem>
                  <SelectItem value="Part heard">Part Heard</SelectItem>
                  <SelectItem value="Order reserved">Order Reserved</SelectItem>
                  <SelectItem value="Order passed">Order Passed</SelectItem>
                  <SelectItem value="Dismissed">Dismissed</SelectItem>
                  <SelectItem value="Allowed">Allowed</SelectItem>
                  <SelectItem value="Partly allowed">Partly Allowed</SelectItem>
                  <SelectItem value="Ex-parte">Ex-Parte</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="adjourned-check"
                checked={outcomeAdjourned}
                onChange={(e) => setOutcomeAdjourned(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="adjourned-check">Adjourned to next date</Label>
            </div>
            {outcomeAdjourned && (
              <div>
                <Label>Next Hearing Date</Label>
                <Input type="datetime-local" value={outcomeNextDate} onChange={(e) => setOutcomeNextDate(e.target.value)} />
              </div>
            )}
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={outcomeNotes} onChange={(e) => setOutcomeNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutcomeDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleRecordOutcome} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save Outcome
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add document metadata dialog */}
      <Dialog open={docDialogOpen} onOpenChange={setDocDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. DRC-01 Notice, Appeal Memo" />
            </div>
            <div>
              <Label>Kind</Label>
              <Select value={docKind} onValueChange={setDocKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="notice">Notice</SelectItem>
                  <SelectItem value="order">Order</SelectItem>
                  <SelectItem value="reply">Reply</SelectItem>
                  <SelectItem value="appeal">Appeal</SelectItem>
                  <SelectItem value="submission">Submission</SelectItem>
                  <SelectItem value="hearing_notes">Hearing Notes</SelectItem>
                  <SelectItem value="evidence">Evidence</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Source</Label>
              <Select value={docSource} onValueChange={setDocSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual Upload</SelectItem>
                  <SelectItem value="portal">GST Portal</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="department">Department</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddDocument} disabled={saving || !docTitle.trim()}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add payment dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Kind</Label>
              <Select value={paymentKind} onValueChange={setPaymentKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pre_deposit">Pre-deposit</SelectItem>
                  <SelectItem value="voluntary">Voluntary (DRC-03)</SelectItem>
                  <SelectItem value="recovery">Recovery</SelectItem>
                  <SelectItem value="refund_received">Refund Received</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Tax</Label><Input type="number" value={payTax} onChange={(e) => setPayTax(e.target.value)} /></div>
              <div><Label>Interest</Label><Input type="number" value={payInterest} onChange={(e) => setPayInterest(e.target.value)} /></div>
              <div><Label>Penalty</Label><Input type="number" value={payPenalty} onChange={(e) => setPayPenalty(e.target.value)} /></div>
              <div><Label>Cess</Label><Input type="number" value={payCess} onChange={(e) => setPayCess(e.target.value)} /></div>
            </div>
            <div><Label>Paid On</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
            <div><Label>Remarks</Label><Input value={payRemarks} onChange={(e) => setPayRemarks(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddPayment} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LitigationMatterDetailPage;
