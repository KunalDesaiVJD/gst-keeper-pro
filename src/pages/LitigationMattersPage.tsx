import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { NoticesPageHeader } from '@/components/notices/NoticesPageHeader';
import { NoticesCardHeader } from '@/components/notices/NoticesCardHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Briefcase, Plus, Loader2, AlertTriangle, Calendar, User, Filter, X } from 'lucide-react';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';

interface Matter {
  id: string;
  matter_no: string | null;
  client_id: string | null;
  lifecycle: string | null;
  stage: string | null;
  status: string | null;
  title: string | null;
  section_of_law: string | null;
  priority: string | null;
  authority: string | null;
  owner_user_id: string | null;
  demand_tax: number | null;
  demand_interest: number | null;
  demand_penalty: number | null;
  demand_cess: number | null;
  computed_due_date: string | null;
  override_due_date: string | null;
  created_at: string;
}

interface Client {
  id: string;
  name: string | null;
  gstin: string | null;
}

interface Profile {
  user_id: string;
  first_name: string | null;
}

const LIFECYCLES = [
  'demand', 'appeal', 'refund', 'scrutiny', 'audit', 'registration',
  'recovery', 'enforcement', 'voluntary_payment', 'non_filer',
  'ewaybill', 'summons', 'amnesty', 'tribunal', 'rectification',
] as const;

const STAGES = [
  'Captured', 'Triage', 'Awaiting client data', 'Reply drafting',
  'Partner review', 'Filed/submitted', 'Hearing', 'Order received',
  'Appeal decision', 'Appeal filed', 'Closed',
] as const;

const PRIORITIES = ['High', 'Medium', 'Low'] as const;

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const formatINR = (amount: number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

// Stage indicator: a colour dot + label, matching NoticeWorkQueue, rather than
// a tinted shadcn Badge with hard-coded light-mode-only palette classes.
const stageDotClass = (stage: string | null): string => {
  switch (stage) {
    case 'Captured':
    case 'Triage':
      return 'bg-blue-400';
    case 'Awaiting client data':
      return 'bg-amber-400';
    case 'Reply drafting':
      return 'bg-blue-500';
    case 'Partner review':
      return 'bg-violet-500';
    case 'Filed/submitted':
      return 'bg-emerald-500';
    case 'Hearing':
      return 'bg-amber-500';
    case 'Order received':
      return 'bg-orange-500';
    case 'Appeal decision':
    case 'Appeal filed':
      return 'bg-red-500';
    case 'Closed':
      return 'bg-slate-400';
    default:
      return 'bg-slate-300';
  }
};

const priorityChipClass = (p: string | null): string => {
  switch (p) {
    case 'High': return 'bg-destructive/10 text-destructive';
    case 'Medium': return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
    default: return 'bg-muted text-muted-foreground';
  }
};

const isOverdue = (dateStr: string | null): boolean => {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
};

const isWithin7Days = (dateStr: string | null): boolean => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date(new Date().toDateString());
  const diff = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 7;
};

const LitigationMattersPage: React.FC = () => {
  const { isStaffRole, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [matters, setMatters] = useState<Matter[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [lifecycleFilter, setLifecycleFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [clientSearch, setClientSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  // GstinWiseNoticeCountPage links here as /litigation?client=<uuid>; the text
  // search above cannot hold a uuid, so the deep link gets its own filter.
  const [clientIdFilter, setClientIdFilter] = useState<string>(() => searchParams.get('client') || '');

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    client_id: '',
    lifecycle: '',
    title: '',
    section_of_law: '',
    priority: 'Medium',
    authority: 'CGST',
  });

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const fetchData = async () => {
    setLoading(true);
    try {
      const [mRes, cRes, pRes] = await Promise.all([
        supabase.from('litigation_matters').select('*').order('created_at', { ascending: false }),
        supabase.from('clients').select('id, name, gstin'),
        supabase.from('profiles').select('user_id, first_name'),
      ]);
      if (mRes.data) setMatters(mRes.data as Matter[]);
      if (cRes.data) setClients(cRes.data as Client[]);
      if (pRes.data) setProfiles(pRes.data as Profile[]);
    } catch {
      toast.error('Failed to load litigation matters');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const clientMap = new Map(clients.map(c => [c.id, c]));
  const profileMap = new Map(profiles.map(p => [p.user_id, p.first_name || 'Staff']));

  const filtered = matters.filter(m => {
    if (clientIdFilter && m.client_id !== clientIdFilter) return false;
    if (statusFilter === 'open' && m.stage === 'Closed') return false;
    if (statusFilter === 'closed' && m.stage !== 'Closed') return false;
    if (lifecycleFilter !== 'all' && m.lifecycle !== lifecycleFilter) return false;
    if (stageFilter !== 'all' && m.stage !== stageFilter) return false;
    if (ownerFilter === 'mine' && m.owner_user_id !== user?.id) return false;
    if (ownerFilter === 'unassigned' && m.owner_user_id) return false;
    if (clientSearch) {
      const cl = clientMap.get(m.client_id || '');
      const term = clientSearch.toLowerCase();
      if (!cl) return false;
      if (!(cl.name || '').toLowerCase().includes(term) && !(cl.gstin || '').toLowerCase().includes(term)) return false;
    }
    return true;
  });

  const handleCreate = async () => {
    if (!form.client_id || !form.lifecycle || !form.title) {
      toast.error('Client, lifecycle and title are required');
      return;
    }
    setSubmitting(true);
    try {
      const { count } = await supabase.from('litigation_matters').select('id', { count: 'exact', head: true });
      const seq = (count || 0) + 1;
      const matter_no = `M-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;

      const { error } = await supabase.from('litigation_matters').insert({
        matter_no,
        client_id: form.client_id,
        lifecycle: form.lifecycle,
        title: form.title,
        section_of_law: form.section_of_law || null,
        priority: form.priority,
        authority: form.authority,
        stage: 'Captured',
        status: 'open',
        owner_user_id: user?.id || null,
      });
      if (error) throw error;
      toast.success(`Matter ${matter_no} created`);
      setShowCreate(false);
      setForm({ client_id: '', lifecycle: '', title: '', section_of_law: '', priority: 'Medium', authority: 'CGST' });
      fetchData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create matter');
    } finally {
      setSubmitting(false);
    }
  };

  const clearClientIdFilter = () => {
    setClientIdFilter('');
    const next = new URLSearchParams(searchParams);
    next.delete('client');
    setSearchParams(next, { replace: true });
  };

  const focusedClient = clientIdFilter ? clientMap.get(clientIdFilter) : undefined;

  return (
    <div className="space-y-4 animate-fade-in">
      <NoticesPageHeader
        title="Litigation Matters"
        icon={Briefcase}
        subtitle={
          <>
            <span>{filtered.length} of {matters.length} matters</span>
            {clientIdFilter && (
              <span className="inline-flex items-center gap-1">
                <span>Client: {focusedClient?.name || 'selected client'}</span>
                <button
                  type="button"
                  onClick={clearClientIdFilter}
                  className="inline-flex items-center rounded-full bg-muted px-1.5 py-0 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  <X className="mr-0.5 h-3 w-3" /> Clear
                </button>
              </span>
            )}
          </>
        }
        actions={
          <Button size="sm" className="h-8 text-xs" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Create Matter
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <NoticesTopNav />
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[110px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Lifecycle</Label>
              <Select value={lifecycleFilter} onValueChange={setLifecycleFilter}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All lifecycles</SelectItem>
                  {LIFECYCLES.map(lc => (
                    <SelectItem key={lc} value={lc} className="text-xs capitalize">{lc.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Stage</Label>
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {STAGES.map(s => (
                    <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Client</Label>
              <Input
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Search name or GSTIN"
                className="w-[180px] h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Owner</Label>
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="w-[130px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="mine">Mine</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <NoticesCardHeader title="Matters" badge={filtered.length} />
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <AlertTriangle className="h-8 w-8" />
              <p className="text-sm">No litigation matters found</p>
            </div>
          ) : (
            <Table containerClassName="max-h-[calc(100vh-320px)] overflow-auto rounded-md border">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Matter No</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Client</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Lifecycle</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Stage</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Priority</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Due Date</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Demand</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(m => {
                  const cl = clientMap.get(m.client_id || '');
                  const ownerName = m.owner_user_id ? profileMap.get(m.owner_user_id) || 'Staff' : null;
                  const totalDemand = num(m.demand_tax) + num(m.demand_interest) + num(m.demand_penalty) + num(m.demand_cess);
                  const effectiveDue = m.override_due_date || m.computed_due_date;

                  return (
                    <TableRow
                      key={m.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/litigation/${m.id}`)}
                    >
                      <TableCell className="text-xs font-medium">{m.matter_no || '---'}</TableCell>
                      <TableCell className="text-xs">
                        {cl ? (
                          <Link
                            to={`/notices-company/${cl.id}`}
                            onClick={e => e.stopPropagation()}
                            className="font-medium text-primary hover:underline"
                          >
                            {cl.name || '---'}
                          </Link>
                        ) : (
                          <div>---</div>
                        )}
                        {cl?.gstin && <div className="font-mono text-[10px] text-muted-foreground">{cl.gstin}</div>}
                      </TableCell>
                      <TableCell className="text-xs capitalize">{(m.lifecycle || '---').replace(/_/g, ' ')}</TableCell>
                      <TableCell className="text-xs">
                        {m.stage ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px]">
                            <span className={cn('inline-block h-2 w-2 rounded-sm shrink-0', stageDotClass(m.stage))} />
                            {m.stage}
                          </span>
                        ) : '---'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {m.priority ? (
                          <span className={cn('rounded-full px-1.5 py-0 text-[9px] font-bold', priorityChipClass(m.priority))}>
                            {m.priority}
                          </span>
                        ) : '---'}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {effectiveDue ? (
                          <span className={cn(
                            isOverdue(effectiveDue) && 'font-medium text-destructive',
                            !isOverdue(effectiveDue) && isWithin7Days(effectiveDue) && 'font-medium text-amber-600',
                          )}>
                            {new Date(effectiveDue).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">---</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {totalDemand > 0 ? formatINR(totalDemand) : <span className="text-muted-foreground">&mdash;</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {ownerName ? (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3 w-3 text-muted-foreground" />
                            {ownerName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
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

      {/* Create Matter Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Litigation Matter</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Client <span className="text-destructive">*</span></Label>
              <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name}{c.gstin ? ` (${c.gstin})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Lifecycle <span className="text-destructive">*</span></Label>
              <Select value={form.lifecycle} onValueChange={v => setForm(f => ({ ...f, lifecycle: v }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select lifecycle" />
                </SelectTrigger>
                <SelectContent>
                  {LIFECYCLES.map(lc => (
                    <SelectItem key={lc} value={lc} className="text-xs capitalize">{lc.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Title <span className="text-destructive">*</span></Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="h-8 text-xs"
                placeholder="e.g. DRC-01 demand FY 2023-24"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Section of law</Label>
              <Input
                value={form.section_of_law}
                onChange={e => setForm(f => ({ ...f, section_of_law: e.target.value }))}
                className="h-8 text-xs"
                placeholder="e.g. s.73 / s.74A"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => (
                      <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Authority</Label>
                <Select value={form.authority} onValueChange={v => setForm(f => ({ ...f, authority: v }))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CGST" className="text-xs">CGST</SelectItem>
                    <SelectItem value="SGST" className="text-xs">SGST</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={submitting}>
              {submitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LitigationMattersPage;
