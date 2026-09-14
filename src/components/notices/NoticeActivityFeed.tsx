import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity, Bell, UserPlus, FileCheck, MessageSquare, RotateCcw, XCircle } from 'lucide-react';

interface EventRow {
  id: string;
  notice_id: string;
  client_id: string;
  event_type: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  actor_name: string | null;
  created_at: string;
}

const EVENT_META: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  captured: { label: 'Captured', icon: <Bell className="h-3 w-3" />, className: 'bg-blue-50 text-blue-700 border-blue-200' },
  assigned: { label: 'Assigned', icon: <UserPlus className="h-3 w-3" />, className: 'bg-violet-50 text-violet-700 border-violet-200' },
  status_changed: { label: 'Status', icon: <Activity className="h-3 w-3" />, className: 'bg-amber-50 text-amber-700 border-amber-200' },
  reply_logged: { label: 'Reply', icon: <FileCheck className="h-3 w-3" />, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  order_logged: { label: 'Order', icon: <MessageSquare className="h-3 w-3" />, className: 'bg-teal-50 text-teal-700 border-teal-200' },
  closed: { label: 'Closed', icon: <XCircle className="h-3 w-3" />, className: 'bg-slate-50 text-slate-600 border-slate-200' },
  reopened: { label: 'Reopened', icon: <RotateCcw className="h-3 w-3" />, className: 'bg-orange-50 text-orange-700 border-orange-200' },
};

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function eventDescription(ev: EventRow): string {
  const nv = ev.new_value as Record<string, unknown> | null;
  const ov = ev.old_value as Record<string, unknown> | null;
  switch (ev.event_type) {
    case 'assigned':
      return `Assigned to ${nv?.assign_to || 'someone'}`;
    case 'status_changed':
      return `${ov?.staff_status || '?'} → ${nv?.staff_status || '?'}`;
    case 'closed':
      return `Closed${nv?.close_reason ? ` (${nv.close_reason})` : ''}`;
    case 'reopened':
      return `Reopened → ${nv?.staff_status || 'Open'}`;
    case 'reply_logged':
      return `Reply logged${nv?.reply_ref_number ? ` (${nv.reply_ref_number})` : ''}`;
    case 'order_logged':
      return `Order logged${nv?.order_number ? ` (${nv.order_number})` : ''}`;
    case 'captured':
      return 'New notice captured';
    default:
      return ev.event_type;
  }
}

interface Props {
  onSelectNotice?: (noticeId: string, clientId: string) => void;
}

const NoticeActivityFeed: React.FC<Props> = ({ onSelectNotice }) => {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [clientNames, setClientNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('notice_events')
        .select('id, notice_id, client_id, event_type, old_value, new_value, actor_name, created_at')
        .order('created_at', { ascending: false })
        .limit(30);
      if (cancelled) return;
      const rows = (data ?? []) as EventRow[];
      setEvents(rows);

      const clientIds = [...new Set(rows.map((r) => r.client_id))];
      if (clientIds.length > 0) {
        const { data: clients } = await supabase.from('clients').select('id, name').in('id', clientIds);
        if (!cancelled) {
          setClientNames(Object.fromEntries((clients ?? []).map((c) => [c.id, c.name])));
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Activity className="h-4 w-4" /> Recent Activity
        </CardTitle>
        <CardDescription className="text-[11px]">Latest notice events across all clients</CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        {loading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="space-y-1 max-h-[280px] overflow-auto">
            {events.map((ev) => {
              const meta = EVENT_META[ev.event_type] || EVENT_META.status_changed;
              return (
                <button
                  key={ev.id}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/40"
                  onClick={() => onSelectNotice?.(ev.notice_id, ev.client_id)}
                >
                  <div className="mt-0.5 shrink-0">
                    <Badge variant="outline" className={`gap-0.5 text-[10px] ${meta.className}`}>
                      {meta.icon} {meta.label}
                    </Badge>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">{eventDescription(ev)}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {clientNames[ev.client_id] || '...'}{ev.actor_name ? ` · ${ev.actor_name}` : ''} · {formatRelative(ev.created_at)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default NoticeActivityFeed;
