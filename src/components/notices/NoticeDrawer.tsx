import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, ExternalLink, Calendar, AlertTriangle, FileText, Clock, User } from 'lucide-react';
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!noticeId || !open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ data: n }, { data: evts }] = await Promise.all([
        supabase.from('gst_notices')
          .select('id, client_id, notice_type, reference_number, description, issue_date, due_date, extended_due_date, staff_status, priority, assign_to, assign_to_user_id, reply_date, reply_ref_number, order_date, order_number, hearing_date, issued_by, amount_of_demand, remarks, financial_year, close_reason, pdf_url, pulled_at')
          .eq('id', noticeId).maybeSingle(),
        supabase.from('notice_events')
          .select('id, event_type, old_value, new_value, actor_name, created_at')
          .eq('notice_id', noticeId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      if (cancelled) return;
      setNotice(n as NoticeDetail | null);
      setEvents((evts ?? []) as EventRow[]);
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

  const field = (label: string, value: string | number | null | undefined, icon?: React.ReactNode) => {
    const v = value === null || value === undefined || value === '' ? '—' : String(value);
    return (
      <div className="flex items-start gap-2 py-1.5">
        {icon && <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>}
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-sm">{v}</p>
        </div>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            {notice?.notice_type || 'Notice'} {notice?.reference_number && <span className="font-mono text-xs text-muted-foreground">({notice.reference_number})</span>}
          </SheetTitle>
          <SheetDescription>
            {clientName}{gstin ? ` · ${gstin}` : ''}
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

            {notice.description && (
              <p className="text-sm text-muted-foreground">{notice.description}</p>
            )}

            <Separator />

            {/* Key dates */}
            <div className="grid grid-cols-2 gap-x-4">
              {field('Issue Date', fmtDate(notice.issue_date), <Calendar className="h-3.5 w-3.5" />)}
              {field('Due Date', fmtDate(effectiveDue), <AlertTriangle className="h-3.5 w-3.5" />)}
              {notice.extended_due_date && field('Extended Due', fmtDate(notice.extended_due_date))}
              {notice.hearing_date && field('Hearing Date', fmtDate(notice.hearing_date))}
            </div>

            <Separator />

            {/* Tracking fields */}
            <div className="grid grid-cols-2 gap-x-4">
              {field('Assigned To', notice.assign_to, <User className="h-3.5 w-3.5" />)}
              {field('Issued By', notice.issued_by)}
              {field('Reply Date', fmtDate(notice.reply_date))}
              {field('Reply Ref', notice.reply_ref_number)}
              {field('Order Date', fmtDate(notice.order_date))}
              {field('Order No', notice.order_number)}
              {notice.amount_of_demand !== null && field('Amount of Demand', `₹${Number(notice.amount_of_demand).toLocaleString('en-IN')}`)}
              {notice.financial_year && field('Financial Year', notice.financial_year)}
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

            {notice.pdf_url && (
              <a href={notice.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> View document
              </a>
            )}

            {/* Activity timeline */}
            {events.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Activity</p>
                  <div className="space-y-2">
                    {events.map((ev) => (
                      <div key={ev.id} className="flex items-start gap-2 text-xs">
                        <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                        <div className="min-w-0">
                          <span className="font-medium">{ev.event_type.replace(/_/g, ' ')}</span>
                          {ev.actor_name && <span className="text-muted-foreground"> by {ev.actor_name}</span>}
                          <span className="ml-1 text-muted-foreground">{fmtRelative(ev.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />
            <div className="flex gap-2">
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

export default NoticeDrawer;
