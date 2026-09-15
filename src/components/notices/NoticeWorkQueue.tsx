import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, ClipboardList } from 'lucide-react';

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
  amount_of_demand: number | null;
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

function daysRemaining(item: QueueItem): number | null {
  const due = effectiveDue(item);
  if (!due) return null;
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 3600000);
  const d = new Date(due);
  return Math.round((d.getTime() - ist.getTime()) / 86400000);
}

function stageColor(status: string | null): string {
  const s = (status || '').toLowerCase();
  if (/^closed|^withdrawn|^dropped|^disposed|^deleted|^adjudged/.test(s)) return 'bg-slate-400';
  if (/order/.test(s)) return 'bg-orange-500';
  if (/hearing/.test(s)) return 'bg-amber-500';
  if (/filed|submitted/.test(s)) return 'bg-emerald-500';
  if (/partner|review/.test(s)) return 'bg-violet-500';
  if (/reply|draft/.test(s)) return 'bg-blue-500';
  if (/await|data|document/.test(s)) return 'bg-amber-400';
  if (/triage|assigned|open/.test(s)) return 'bg-blue-400';
  return 'bg-slate-300';
}

function stageLabel(status: string | null): string {
  const s = (status || '').trim();
  if (!s) return 'Captured';
  return s.length > 20 ? s.slice(0, 18) + '…' : s;
}

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
        .select('id, client_id, notice_type, reference_number, staff_status, priority, due_date, extended_due_date, issue_date, assign_to, assign_to_user_id, amount_of_demand')
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
          <div className="space-y-1 max-h-[320px] overflow-auto">
            {/* Column headers */}
            <div className="flex items-center gap-2 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span className="flex-1">Notice</span>
              <span className="w-20 text-center">Stage</span>
              <span className="w-14 text-right">Days</span>
              <span className="w-20 text-right">Demand</span>
            </div>
            {items.slice(0, 20).map((item) => {
              const days = daysRemaining(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
                  onClick={() => onSelectNotice?.(item.id, item.client_id)}
                >
                  {/* Notice info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{item.notice_type || 'Notice'}</span>
                      {item.priority && item.priority !== '—' && item.priority.toLowerCase() === 'high' && (
                        <Badge variant="outline" className="text-[9px] bg-red-50 text-red-700 border-red-200 px-1 py-0">High</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                      {item.client_name}
                      {item.gstin && <span className="ml-1 font-mono">{item.gstin.slice(-4)}</span>}
                    </div>
                  </div>

                  {/* Stage */}
                  <div className="w-20 flex items-center gap-1">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', stageColor(item.staff_status))} />
                    <span className="text-[10px] text-muted-foreground truncate">{stageLabel(item.staff_status)}</span>
                  </div>

                  {/* Days remaining */}
                  <div className="w-14 text-right">
                    {days !== null ? (
                      <span className={cn(
                        'text-xs font-medium tabular-nums',
                        days < 0 ? 'text-destructive' :
                        days <= 3 ? 'text-amber-600' :
                        days <= 7 ? 'text-yellow-600' :
                        'text-muted-foreground'
                      )}>
                        {days < 0 ? `${days}` : days === 0 ? 'Today' : `${days}`}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Demand */}
                  <div className="w-20 text-right">
                    {item.amount_of_demand ? (
                      <span className="text-[10px] font-medium tabular-nums">
                        ₹{Number(item.amount_of_demand).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
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
