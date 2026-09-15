import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Loader2, ExternalLink, Calendar, AlertTriangle, FileText, Clock, User, Activity, IndianRupee, MessageSquare, Check } from 'lucide-react';
import { isClosed } from '@/utils/noticeSummaryReport';

interface NoticeDetail {
  id: string;
  client_id: string;
  notice_type: string | null;
  reference_number: string | null;
  description: string | null;
  issue_date: string | null;
  due_date: string | null;
  extended_due_date: string | null;
  staff_status: string | null;
  priority: string | null;
  assign_to: string | null;
  assign_to_user_id: string | null;
  reply_date: string | null;
  reply_ref_number: string | null;
  order_date: string | null;
  order_number: string | null;
  hearing_date: string | null;
  issued_by: string | null;
  amount_of_demand: number | null;
  remarks: string | null;
  financial_year: string | null;
  close_reason: string | null;
  pdf_url: string | null;
  pulled_at: string | null;
}

interface EventRow {
  id: string;
  event_type: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  actor_name: string | null;
  created_at: string;
}

interface DeadlineRow {
  id: string;
  deadline_type: string;
  deadline_date: string;
  statutory_basis: string | null;
  is_met: boolean;
  notes: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return fmtDate(iso);
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 3600000);
  const d = new Date(iso);
  return Math.round((d.getTime() - ist.getTime()) / 86400000);
}

// Stage stepper: shows lifecycle progression
const STAGES = [
  { key: 'captured', label: 'Captured', color: 'bg-slate-400' },
  { key: 'triage', label: 'Triage', color: 'bg-blue-400' },
  { key: 'awaiting_data', label: 'Awaiting Data', color: 'bg-amber-400' },
  { key: 'reply_drafting', label: 'Reply Drafting', color: 'bg-blue-500' },
  { key: 'partner_review', label: 'Partner Review', color: 'bg-violet-500' },
  { key: 'filed', label: 'Filed', color: 'bg-emerald-500' },
  { key: 'hearing', label: 'Hearing', color: 'bg-amber-500' },
  { key: 'order', label: 'Order Received', color: 'bg-orange-500' },
  { key: 'closed', label: 'Closed', color: 'bg-slate-500' },
];

function mapStatusToStage(status: string | null): string {
  const s = (status || '').toLowerCase().trim();
  if (/^closed|^withdrawn|^dropped|^disposed|^deleted|^adjudged/i.test(s)) return 'closed';
  if (/order/i.test(s)) return 'order';
  if (/hearing/i.test(s)) return 'hearing';
  if (/filed|submitted/i.test(s)) return 'filed';
  if (/partner|review/i.test(s)) return 'partner_review';
  if (/reply|draft/i.test(s)) return 'reply_drafting';
  if (/await|data|document/i.test(s)) return 'awaiting_data';
  if (/triage|assigned|open/i.test(s)) return 'triage';
  return 'captured';
}

const EVENT_ICONS: Record<string, React.ReactNode> = {
  captured: <Badge variant="outline" className="gap-0.5 text-[10px] bg-blue-50 text-blue-700 border-blue-200"><FileText className="h-2.5 w-2.5" /> Captured</Badge>,
  assigned: <Badge variant="outline" className="gap-0.5 text-[10px] bg-violet-50 text-violet-700 border-violet-200"><User className="h-2.5 w-2.5" /> Assigned</Badge>,
  status_changed: <Badge variant="outline" className="gap-0.5 text-[10px] bg-amber-50 text-amber-700 border-amber-200"><Activity className="h-2.5 w-2.5" /> Status</Badge>,
  reply_logged: <Badge variant="outline" className="gap-0.5 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200"><Check className="h-2.5 w-2.5" /> Reply</Badge>,
  closed: <Badge variant="outline" className="gap-0.5 text-[10px] bg-slate-50 text-slate-600 border-slate-200"><Check className="h-2.5 w-2.5" /> Closed</Badge>,
};

interface Props {
  noticeId: string | null;
  clientId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NoticeDrawer: React.FC<Props> = ({ noticeId, clientId, open, onOpenChange }) => {
  const [notice, setNotice] = useState<NoticeDetail | null>(null);
  const [clientName, setClientName] = useState('');
  const [gstin, setGstin] = useState('');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!noticeId || !open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ data: n }, { data: evts }, { data: dls }] = await Promise.all([
        supabase.from('gst_notices')
          .select('id, client_id, notice_type, reference_number, description, issue_date, due_date, extended_due_date, staff_status, priority, assign_to, assign_to_user_id, reply_date, reply_ref_number, order_date, order_number, hearing_date, issued_by, amount_of_demand, remarks, financial_year, close_reason, pdf_url, pulled_at')
          .eq('id', noticeId).maybeSingle(),
        supabase.from('notice_events')
          .select('id, event_type, old_value, new_value, actor_name, created_at')
          .eq('notice_id', noticeId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.from('matter_deadlines')
          .select('id, deadline_type, deadline_date, statutory_basis, is_met, notes')
          .eq('notice_id', noticeId)
          .order('deadline_date', { ascending: true }),
      ]);
      if (cancelled) return;
      setNotice(n as NoticeDetail | null);
      setEvents((evts ?? []) as EventRow[]);
      setDeadlines((dls ?? []) as DeadlineRow[]);
      if (n?.client_id) {
        const { data: c } = await supabase.from('clients').select('name, gstin').eq('id', n.client_id).maybeSingle();
        if (!cancelled && c) { setClientName(c.name || ''); setGstin(c.gstin || ''); }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [noticeId, open]);

  const effectiveDue = notice?.extended_due_date || notice?.due_date;
  const closed = notice ? isClosed(notice.staff_status) : false;
  const currentStage = notice ? mapStatusToStage(notice.staff_status) : 'captured';
  const currentStageIdx = STAGES.findIndex((s) => s.key === currentStage);
  const daysLeft = daysUntil(effectiveDue);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            {notice?.notice_type || 'Notice'}
            {notice?.reference_number && (
              <span className="font-mono text-xs text-muted-foreground">({notice.reference_number})</span>
            )}
          </SheetTitle>
          <SheetDescription>
            {clientName}{gstin ? ` · ${gstin}` : ''}
            {notice?.financial_year && <span className="ml-2 text-[10px]">FY {notice.financial_year}</span>}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !notice ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Notice not found.</p>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Status badges */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className={closed
                ? 'bg-slate-100 text-slate-600 border-slate-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }>
                {notice.staff_status || 'No status'}
              </Badge>
              {notice.priority && notice.priority !== '—' && (
                <Badge variant="outline" className={
                  notice.priority.toLowerCase() === 'high' ? 'bg-red-50 text-red-700 border-red-200' :
                  notice.priority.toLowerCase() === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                  'bg-slate-50 text-slate-600 border-slate-200'
                }>
                  {notice.priority} priority
                </Badge>
              )}
              {notice.close_reason && (
                <Badge variant="outline" className="text-[10px] bg-slate-50">{notice.close_reason}</Badge>
              )}
            </div>

            {/* Due date warning banner */}
            {!closed && daysLeft !== null && daysLeft <= 7 && (
              <div className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium',
                daysLeft < 0 ? 'bg-destructive/10 text-destructive border border-destructive/20' :
                daysLeft === 0 ? 'bg-destructive/10 text-destructive border border-destructive/20' :
                'bg-amber-50 text-amber-800 border border-amber-200'
              )}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {daysLeft < 0 ? `Overdue by ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''}` :
                 daysLeft === 0 ? 'Due today' :
                 `Due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}
              </div>
            )}

            {notice.description && (
              <p className="text-sm text-muted-foreground">{notice.description}</p>
            )}

            {/* Stage stepper */}
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Lifecycle Stage</p>
              <div className="flex items-center gap-0.5 overflow-x-auto">
                {STAGES.map((stage, idx) => {
                  const isComplete = idx < currentStageIdx;
                  const isCurrent = idx === currentStageIdx;
                  return (
                    <React.Fragment key={stage.key}>
                      {idx > 0 && (
                        <div className={cn(
                          'h-0.5 w-4 shrink-0',
                          isComplete ? 'bg-primary' : 'bg-muted'
                        )} />
                      )}
                      <div className="flex shrink-0 flex-col items-center gap-1" title={stage.label}>
                        <div className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white',
                          isCurrent ? stage.color + ' ring-2 ring-offset-1 ring-primary' :
                          isComplete ? 'bg-primary' : 'bg-muted'
                        )}>
                          {isComplete ? <Check className="h-3 w-3" /> : idx + 1}
                        </div>
                        <span className={cn(
                          'text-[9px] whitespace-nowrap',
                          isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground'
                        )}>
                          {stage.label}
                        </span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Fact tiles — 4 key metrics */}
            <div className="grid grid-cols-2 gap-2">
              <Card className="border">
                <CardContent className="p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Demand</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums">
                    {notice.amount_of_demand != null ? `₹${Number(notice.amount_of_demand).toLocaleString('en-IN')}` : '—'}
                  </p>
                </CardContent>
              </Card>
              <Card className="border">
                <CardContent className="p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Due Date</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums">{fmtDate(effectiveDue)}</p>
                  {notice.extended_due_date && (
                    <p className="text-[10px] text-muted-foreground">Extended from {fmtDate(notice.due_date)}</p>
                  )}
                </CardContent>
              </Card>
              <Card className="border">
                <CardContent className="p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Assigned To</p>
                  <p className="mt-0.5 text-sm font-medium">{notice.assign_to || '—'}</p>
                </CardContent>
              </Card>
              <Card className="border">
                <CardContent className="p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Issued By</p>
                  <p className="mt-0.5 text-sm font-medium">{notice.issued_by || '—'}</p>
                </CardContent>
              </Card>
            </div>

            {/* Tabbed content */}
            <Tabs defaultValue="activity" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
                <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
                <TabsTrigger value="deadlines" className="text-xs">Deadlines</TabsTrigger>
                <TabsTrigger value="documents" className="text-xs">Docs</TabsTrigger>
              </TabsList>

              {/* Activity tab */}
              <TabsContent value="activity" className="mt-3">
                {events.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-auto">
                    {events.map((ev) => (
                      <div key={ev.id} className="flex items-start gap-2 rounded-md border px-2.5 py-2">
                        <div className="mt-0.5 shrink-0">
                          {EVENT_ICONS[ev.event_type] || (
                            <Badge variant="outline" className="text-[10px]">{ev.event_type.replace(/_/g, ' ')}</Badge>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs">
                            {ev.event_type === 'status_changed' && ev.old_value && ev.new_value
                              ? `${(ev.old_value as any).staff_status || '?'} → ${(ev.new_value as any).staff_status || '?'}`
                              : ev.event_type === 'assigned' && ev.new_value
                              ? `Assigned to ${(ev.new_value as any).assign_to || 'someone'}`
                              : ev.event_type === 'reply_logged' && ev.new_value
                              ? `Reply logged${(ev.new_value as any).reply_ref_number ? ` (${(ev.new_value as any).reply_ref_number})` : ''}`
                              : ev.event_type === 'closed' && ev.new_value
                              ? `Closed${(ev.new_value as any).close_reason ? ` (${(ev.new_value as any).close_reason})` : ''}`
                              : ev.event_type === 'captured'
                              ? 'New notice captured'
                              : ev.event_type.replace(/_/g, ' ')}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {ev.actor_name && <span>{ev.actor_name} · </span>}
                            {fmtRelative(ev.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Details tab */}
              <TabsContent value="details" className="mt-3">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <FieldRow label="Issue Date" value={fmtDate(notice.issue_date)} icon={<Calendar className="h-3 w-3" />} />
                    <FieldRow label="Due Date" value={fmtDate(effectiveDue)} icon={<Clock className="h-3 w-3" />} />
                    {notice.extended_due_date && <FieldRow label="Extended Due" value={fmtDate(notice.extended_due_date)} />}
                    {notice.hearing_date && <FieldRow label="Hearing Date" value={fmtDate(notice.hearing_date)} />}
                    <FieldRow label="Reply Date" value={fmtDate(notice.reply_date)} />
                    <FieldRow label="Reply Ref" value={notice.reply_ref_number || '—'} />
                    <FieldRow label="Order Date" value={fmtDate(notice.order_date)} />
                    <FieldRow label="Order No" value={notice.order_number || '—'} />
                    {notice.amount_of_demand != null && (
                      <FieldRow label="Demand" value={`₹${Number(notice.amount_of_demand).toLocaleString('en-IN')}`} icon={<IndianRupee className="h-3 w-3" />} />
                    )}
                    {notice.financial_year && <FieldRow label="Financial Year" value={notice.financial_year} />}
                  </div>
                  {notice.remarks && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Remarks</p>
                        <p className="mt-1 text-sm whitespace-pre-wrap">{notice.remarks}</p>
                      </div>
                    </>
                  )}
                </div>
              </TabsContent>

              {/* Deadlines tab */}
              <TabsContent value="deadlines" className="mt-3">
                {deadlines.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No statutory deadlines recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {deadlines.map((dl) => {
                      const days = daysUntil(dl.deadline_date);
                      return (
                        <div key={dl.id} className={cn(
                          'flex items-start justify-between rounded-md border px-3 py-2',
                          dl.is_met ? 'bg-emerald-50/50 border-emerald-200' :
                          days !== null && days < 0 ? 'bg-destructive/5 border-destructive/20' :
                          days !== null && days <= 7 ? 'bg-amber-50/50 border-amber-200' : ''
                        )}>
                          <div>
                            <p className="text-xs font-medium">{dl.deadline_type}</p>
                            {dl.statutory_basis && (
                              <p className="text-[10px] text-muted-foreground">{dl.statutory_basis}</p>
                            )}
                            {dl.notes && (
                              <p className="mt-1 text-[10px] text-muted-foreground">{dl.notes}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium tabular-nums">{fmtDate(dl.deadline_date)}</p>
                            {dl.is_met ? (
                              <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">Met</Badge>
                            ) : days !== null && (
                              <span className={cn(
                                'text-[10px] font-medium',
                                days < 0 ? 'text-destructive' : days <= 7 ? 'text-amber-600' : 'text-muted-foreground'
                              )}>
                                {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d left`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {/* Documents tab */}
              <TabsContent value="documents" className="mt-3">
                <div className="space-y-2">
                  {notice.pdf_url ? (
                    <a href={notice.pdf_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-xs text-primary hover:bg-muted/40 transition-colors">
                      <FileText className="h-4 w-4" />
                      <div className="flex-1">
                        <p className="font-medium">Notice Document</p>
                        <p className="text-[10px] text-muted-foreground">Synced from GST portal</p>
                      </div>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <p className="py-6 text-center text-xs text-muted-foreground">No documents attached.</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <Separator />
            <div className="flex gap-2 pb-2">
              <Link to={`/notices-company/${clientId}`} className="text-xs text-primary hover:underline">
                Company profile
              </Link>
              <span className="text-muted-foreground">·</span>
              <Link to={`/notices-all?noticeId=${noticeId}`} className="text-xs text-primary hover:underline">
                Open in list
              </Link>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

function FieldRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 py-1">
      {icon && <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>}
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm">{value}</p>
      </div>
    </div>
  );
}

export default NoticeDrawer;
