import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ClipboardList, ExternalLink, AlertTriangle, Clock, Calendar } from 'lucide-react';

interface QueueItem {
  id: string;
  client_id: string;
  client_name: string;
  gstin: string | null;
  notice_type: string | null;
  reference_number: string | null;
  staff_status: string | null;
  priority: string | null;
  due_date: string | null;
  extended_due_date: string | null;
  issue_date: string | null;
  assign_to: string | null;
}

function effectiveDue(item: QueueItem): string | null {
  return item.extended_due_date || item.due_date;
}

function urgencyScore(item: QueueItem): number {
  const due = effectiveDue(item);
  if (!due) return 999;
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 3600000);
  const d = new Date(due);
  const days = Math.round((d.getTime() - ist.getTime()) / 86400000);
  if (days < 0) return -1000 + days;
  return days;
}

function dueLabel(item: QueueItem): { text: string; className: string } | null {
  const due = effectiveDue(item);
  if (!due) return null;
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 3600000);
  const d = new Date(due);
  const days = Math.round((d.getTime() - ist.getTime()) / 86400000);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, className: 'bg-destructive/10 text-destructive border-destructive/20' };
  if (days === 0) return { text: 'Due today', className: 'bg-destructive/10 text-destructive border-destructive/20' };
  if (days <= 3) return { text: `${days}d left`, className: 'bg-amber-100 text-amber-800 border-amber-200' };
  if (days <= 7) return { text: `${days}d left`, className: 'bg-yellow-50 text-yellow-700 border-yellow-200' };
  return { text: `${days}d left`, className: 'bg-slate-100 text-slate-600 border-slate-200' };
}

const priorityBadge = (p: string | null) => {
  if (!p || p === '—') return null;
  const cls = p.toLowerCase() === 'high' ? 'bg-red-50 text-red-700 border-red-200'
    : p.toLowerCase() === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-slate-50 text-slate-600 border-slate-200';
  return <Badge variant="outline" className={`text-[10px] ${cls}`}>{p}</Badge>;
};

interface Props {
  onSelectNotice?: (noticeId: string, clientId: string) => void;
}

const NoticeWorkQueue: React.FC<Props> = ({ onSelectNotice }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data: notices } = await supabase
        .from('gst_notices')
        .select('id, client_id, notice_type, reference_number, staff_status, priority, due_date, extended_due_date, issue_date, assign_to, assign_to_user_id')
        .eq('assign_to_user_id', user.id)
        .is('deleted_at', null)
        .limit(200);

      if (cancelled || !notices?.length) { setLoading(false); return; }

      const clientIds = [...new Set(notices.map((n) => n.client_id))];
      const { data: clients } = await supabase.from('clients').select('id, name, gstin').in('id', clientIds);
      const clientMap = new Map((clients ?? []).map((c) => [c.id, c]));

      const closedRe = /^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i;
      const queue: QueueItem[] = notices
        .filter((n) => !closedRe.test(n.staff_status ?? ''))
        .map((n) => {
          const c = clientMap.get(n.client_id);
          return {
            ...n,
            client_name: c?.name || 'Unknown',
            gstin: c?.gstin || null,
          } as QueueItem;
        })
        .sort((a, b) => urgencyScore(a) - urgencyScore(b));

      if (!cancelled) { setItems(queue); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return (
    <Card>
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <ClipboardList className="h-4 w-4" /> My Work Queue
            </CardTitle>
            <CardDescription className="text-[11px]">
              {loading ? 'Loading...' : `${items.length} open notice${items.length === 1 ? '' : 's'} assigned to you`}
            </CardDescription>
          </div>
          <Link to="/notices-all?filter=mine">
            <Button size="sm" variant="ghost" className="h-7 text-xs text-primary">View all</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        {loading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No notices assigned to you right now.</p>
        ) : (
          <div className="space-y-1.5 max-h-[280px] overflow-auto">
            {items.slice(0, 20).map((item) => {
              const due = dueLabel(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
                  onClick={() => onSelectNotice?.(item.id, item.client_id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{item.notice_type || 'Notice'}</span>
                      {priorityBadge(item.priority)}
                      {due && <Badge variant="outline" className={`text-[10px] ${due.className}`}>{due.text}</Badge>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                      {item.client_name} · {item.reference_number || 'No ref'}
                    </div>
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

export default NoticeWorkQueue;
