import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Loader2, ClipboardList, Download } from 'lucide-react';

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
  assign_to_user_id: string | null;
  amount_of_demand: number | null;
  owner_initials: string | null;
}

function effectiveDue(item: QueueItem): string | null {
  return item.extended_due_date || item.due_date;
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

function urgencyScore(item: QueueItem): number {
  const due = effectiveDue(item);
  if (!due) return 999;
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 3600000);
  return Math.round((new Date(due).getTime() - ist.getTime()) / 86400000);
}

function stageColor(status: string | null): string {
  const s = (status || '').toLowerCase();
  if (/order/.test(s)) return 'bg-orange-500';
  if (/hearing/.test(s)) return 'bg-amber-500';
  if (/filed|submitted/.test(s)) return 'bg-emerald-500';
  if (/partner|review/.test(s)) return 'bg-violet-500';
  if (/reply|draft/.test(s)) return 'bg-blue-500';
  if (/await|data|document/.test(s)) return 'bg-amber-400';
  if (/appeal/.test(s)) return 'bg-red-500';
  if (/triage|assigned|open/.test(s)) return 'bg-blue-400';
  return 'bg-slate-300';
}

function stageLabel(status: string | null): string {
  const s = (status || '').trim();
  if (!s) return 'Captured';
  return s.length > 22 ? s.slice(0, 20) + '…' : s;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDemand(n: number | null): string {
  if (!n) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

type TabKey = 'team' | 'mine' | 'unassigned';
const CLOSED_RE = /^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i;

interface Props {
  onSelectNotice?: (noticeId: string, clientId: string) => void;
}

const NoticeWorkQueue: React.FC<Props> = ({ onSelectNotice }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [allItems, setAllItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('team');

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data: notices } = await supabase
        .from('gst_notices')
        .select('id, client_id, notice_type, reference_number, staff_status, priority, due_date, extended_due_date, issue_date, assign_to, assign_to_user_id, amount_of_demand')
        .is('deleted_at', null)
        .limit(1000);

      if (cancelled || !notices?.length) { setLoading(false); return; }

      const clientIds = [...new Set(notices.map((n) => n.client_id))];
      const { data: clients } = await supabase.from('clients').select('id, name, gstin').in('id', clientIds);
      const clientMap = new Map((clients ?? []).map((c) => [c.id, c]));

      const { data: profiles } = await supabase.from('profiles').select('user_id, first_name, last_name');
      const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, `${(p.first_name ?? '')[0] ?? ''}${(p.last_name ?? '')[0] ?? ''}`.toUpperCase() || '?']));

      const queue: QueueItem[] = notices
        .filter((n) => !CLOSED_RE.test(n.staff_status ?? ''))
        .map((n) => {
          const c = clientMap.get(n.client_id);
          return {
            ...n,
            client_name: c?.name || 'Unknown',
            gstin: c?.gstin || null,
            owner_initials: n.assign_to_user_id ? (profileMap.get(n.assign_to_user_id) || '?') : null,
          } as QueueItem;
        })
        .sort((a, b) => urgencyScore(a) - urgencyScore(b));

      if (!cancelled) { setAllItems(queue); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const items = useMemo(() => {
    if (tab === 'mine') return allItems.filter((i) => i.assign_to_user_id === user?.id);
    if (tab === 'unassigned') return allItems.filter((i) => !i.assign_to_user_id);
    return allItems;
  }, [allItems, tab, user?.id]);

  const counts = useMemo(() => ({
    team: allItems.length,
    mine: allItems.filter((i) => i.assign_to_user_id === user?.id).length,
    unassigned: allItems.filter((i) => !i.assign_to_user_id).length,
  }), [allItems, user?.id]);

  const staleCount = allItems.filter((i) => !effectiveDue(i) && !i.staff_status).length;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <ClipboardList className="h-4 w-4" /> Work queue — what needs action
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Sorted by statutory deadline. Click a row to open the notice drawer.
          </p>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {(['team', 'mine', 'unassigned'] as TabKey[]).map((t) => (
            <button
              key={t}
              type="button"
              className={cn(
                'rounded-md px-3 py-1 text-[11px] font-medium transition-colors',
                tab === t
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setTab(t)}
            >
              {t === 'team' ? 'Team' : t === 'mine' ? 'Mine' : 'Unassigned'} · {counts[t]}
            </button>
          ))}
        </div>
      </div>
      <CardContent className="pb-3 pt-2">
        <div className="mb-2 flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => navigate('/notices-all?filter=mine')}>
            <Download className="mr-1 h-3 w-3" /> Export
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">
            Open · Due ≤ 30d
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            No open notices in this view.
          </p>
        ) : (
          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-muted/60 text-[10px] font-semibold uppercase">Client</TableHead>
                  <TableHead className="bg-muted/60 text-[10px] font-semibold uppercase">Notice / Matter</TableHead>
                  <TableHead className="bg-muted/60 text-[10px] font-semibold uppercase">Stage</TableHead>
                  <TableHead className="bg-muted/60 text-[10px] font-semibold uppercase">Due</TableHead>
                  <TableHead className="bg-muted/60 text-right text-[10px] font-semibold uppercase">Days</TableHead>
                  <TableHead className="bg-muted/60 text-right text-[10px] font-semibold uppercase">Demand ₹</TableHead>
                  <TableHead className="bg-muted/60 text-center text-[10px] font-semibold uppercase">Owner</TableHead>
                  <TableHead className="bg-muted/60 text-[10px] font-semibold uppercase"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.slice(0, 15).map((item) => {
                  const days = daysRemaining(item);
                  return (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => onSelectNotice?.(item.id, item.client_id)}
                    >
                      <TableCell className="max-w-[180px]">
                        <span className="block text-xs font-semibold truncate">{item.client_name}</span>
                        <span className="block text-[10px] font-mono text-muted-foreground">{item.gstin || '—'}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs">{item.notice_type || 'Notice'}</span>
                        <div className="mt-0.5 flex items-center gap-1">
                          {item.priority?.toLowerCase() === 'high' && (
                            <span className="rounded-full bg-destructive/10 px-1.5 py-0 text-[9px] font-bold text-destructive">High</span>
                          )}
                          {item.priority?.toLowerCase() === 'medium' && (
                            <span className="rounded-full bg-amber-500/10 px-1.5 py-0 text-[9px] font-bold text-amber-700 dark:text-amber-400">Medium</span>
                          )}
                          {item.reference_number && (
                            <span className="rounded-full bg-muted px-1.5 py-0 text-[9px] text-muted-foreground">{item.reference_number}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-[11px]">
                          <span className={cn('inline-block h-2 w-2 rounded-sm shrink-0', stageColor(item.staff_status))} />
                          {stageLabel(item.staff_status)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDate(effectiveDue(item))}
                      </TableCell>
                      <TableCell className="text-right">
                        {days !== null ? (
                          <span className={cn(
                            'text-xs font-bold tabular-nums',
                            days < 0 ? 'text-destructive' :
                            days <= 3 ? 'text-amber-600' :
                            days <= 7 ? 'text-yellow-600' :
                            'text-muted-foreground',
                          )}>
                            {days < 0 ? String(days) : days === 0 ? 'Today' : String(days)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatDemand(item.amount_of_demand)}
                      </TableCell>
                      <TableCell className="text-center">
                        {item.owner_initials ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                            {item.owner_initials}
                          </span>
                        ) : (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                            ?
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-semibold text-primary">
                          {item.assign_to_user_id ? 'Open ›' : 'Assign ›'}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Showing {Math.min(items.length, 15)} of {items.length}
              {staleCount > 0 && (
                <> · {staleCount} open rows have no due date or stage</>
              )}
            </span>
            <Link to="/notices-all" className="font-semibold text-primary hover:underline">
              View full work queue →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default NoticeWorkQueue;
