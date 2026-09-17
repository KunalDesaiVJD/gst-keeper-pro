import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2, Download } from 'lucide-react';

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

interface ProfileOption {
  user_id: string;
  name: string;
  initials: string;
}

// Mirrors the stageColor() regexes below, so every option a user can pick
// lands on a colour rather than the grey fallback.
const STAGE_OPTIONS = [
  'Open',
  'Awaiting data',
  'Reply drafted',
  'Partner review',
  'Filed',
  'Hearing',
  'Order',
  'Appeal',
  'Closed',
];

const PRIORITY_TIERS = ['Low', 'Medium', 'High'];

// The table shows ten rows (max-h-[620px] below, ~62px each) and scrolls for
// the rest, rather than growing the page to fit every row.
const ROW_LIMIT = 50;

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

// Newest first. Sorting by deadline surfaced notices from 2017 at the top of
// a queue where nothing is upcoming, so the first screen was always the least
// current work.
function recencyKey(item: QueueItem): string {
  return item.issue_date || effectiveDue(item) || '';
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

function csvCell(v: string | number | null): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type TabKey = 'team' | 'mine' | 'unassigned' | 'hearings';
const CLOSED_RE = /^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i;

interface Props {
  onSelectNotice?: (noticeId: string, clientId: string) => void;
  onSweep?: () => void;
  sweeping?: boolean;
}

const NoticeWorkQueue: React.FC<Props> = ({ onSelectNotice, onSweep, sweeping }) => {
  const { user, canEditNoticeStatus } = useAuth();
  const navigate = useNavigate();
  const [allItems, setAllItems] = useState<QueueItem[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('team');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [bulkPriority, setBulkPriority] = useState('');
  const [stageOpen, setStageOpen] = useState(false);
  const [bulkStage, setBulkStage] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [saving, setSaving] = useState(false);

  const canEdit = canEditNoticeStatus();

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

      const { data: profileRows } = await supabase.from('profiles').select('user_id, first_name, last_name');
      const opts: ProfileOption[] = (profileRows ?? []).map((p) => {
        const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed';
        const initials = `${(p.first_name ?? '')[0] ?? ''}${(p.last_name ?? '')[0] ?? ''}`.toUpperCase() || '?';
        return { user_id: p.user_id, name, initials };
      });
      const profileMap = new Map(opts.map((p) => [p.user_id, p.initials]));

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
        .sort((a, b) => recencyKey(b).localeCompare(recencyKey(a)));

      if (!cancelled) { setAllItems(queue); setProfiles(opts); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const items = useMemo(() => {
    if (tab === 'mine') return allItems.filter((i) => i.assign_to_user_id === user?.id);
    if (tab === 'unassigned') return allItems.filter((i) => !i.assign_to_user_id);
    if (tab === 'hearings') return allItems.filter((i) => /hearing/i.test(i.staff_status ?? ''));
    return allItems;
  }, [allItems, tab, user?.id]);

  const counts = useMemo(() => ({
    team: allItems.length,
    mine: allItems.filter((i) => i.assign_to_user_id === user?.id).length,
    unassigned: allItems.filter((i) => !i.assign_to_user_id).length,
    hearings: allItems.filter((i) => /hearing/i.test(i.staff_status ?? '')).length,
  }), [allItems, user?.id]);

  const staleCount = allItems.filter((i) => !effectiveDue(i) && !i.staff_status).length;

  const visibleRows = useMemo(() => items.slice(0, ROW_LIMIT), [items]);
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Scoped to the rows actually on screen — selections made on another tab are
  // left alone rather than wiped, so a bulk action can span tabs.
  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      visibleRows.forEach((r) => { if (checked) next.add(r.id); else next.delete(r.id); });
      return next;
    });
  };

  const selectedIds = () => Array.from(selected);

  const patchLocal = (ids: string[], patch: Partial<QueueItem>) => {
    setAllItems((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, ...patch } : r)));
  };

  const applyAssign = async () => {
    const ids = selectedIds();
    if (!assignTo || ids.length === 0) return;
    const profile = profiles.find((p) => p.user_id === assignTo);
    setSaving(true);
    const { error } = await supabase
      .from('gst_notices')
      .update({ assign_to_user_id: assignTo, assign_to: profile?.name ?? null })
      .in('id', ids);
    setSaving(false);
    if (error) { toast.error('Failed to assign: ' + error.message); return; }
    patchLocal(ids, { assign_to_user_id: assignTo, assign_to: profile?.name ?? null, owner_initials: profile?.initials ?? '?' });
    toast.success(`Assigned ${ids.length} notice${ids.length === 1 ? '' : 's'} to ${profile?.name ?? 'user'}.`);
    setAssignOpen(false);
    setAssignTo('');
    setSelected(new Set());
  };

  const applyPriority = async () => {
    const ids = selectedIds();
    if (!bulkPriority || ids.length === 0) return;
    setSaving(true);
    const { error } = await supabase.from('gst_notices').update({ priority: bulkPriority }).in('id', ids);
    setSaving(false);
    if (error) { toast.error('Failed to set priority: ' + error.message); return; }
    patchLocal(ids, { priority: bulkPriority });
    toast.success(`Set priority on ${ids.length} notice${ids.length === 1 ? '' : 's'}.`);
    setPriorityOpen(false);
    setBulkPriority('');
    setSelected(new Set());
  };

  const applyStage = async () => {
    const ids = selectedIds();
    if (!bulkStage || ids.length === 0) return;
    setSaving(true);
    const payload: Record<string, string | null> = { staff_status: bulkStage };
    payload.close_reason = bulkStage === 'Closed' ? (closeReason || null) : null;
    const { error } = await supabase.from('gst_notices').update(payload).in('id', ids);
    setSaving(false);
    if (error) { toast.error('Failed to change stage: ' + error.message); return; }
    // A row moved to a closed stage drops out of the queue entirely, matching
    // the CLOSED_RE filter the initial fetch applies.
    if (CLOSED_RE.test(bulkStage)) {
      setAllItems((prev) => prev.filter((r) => !ids.includes(r.id)));
    } else {
      patchLocal(ids, { staff_status: bulkStage });
    }
    toast.success(`Moved ${ids.length} notice${ids.length === 1 ? '' : 's'} to ${bulkStage}.`);
    setStageOpen(false);
    setBulkStage('');
    setCloseReason('');
    setSelected(new Set());
  };

  const emailTeam = () => {
    const chosen = allItems.filter((r) => selected.has(r.id));
    if (chosen.length === 0) return;
    const lines = chosen.map((r) => {
      const days = daysRemaining(r);
      const dueTxt = effectiveDue(r) ? formatDate(effectiveDue(r)) : 'no due date';
      const daysTxt = days === null ? '' : days < 0 ? ` (${Math.abs(days)}d overdue)` : ` (${days}d left)`;
      return `• ${r.client_name} [${r.gstin || '—'}] — ${r.notice_type || 'Notice'}${r.reference_number ? ` ${r.reference_number}` : ''} — due ${dueTxt}${daysTxt} — stage ${stageLabel(r.staff_status)}`;
    });
    const subject = `GST notices needing action (${chosen.length})`;
    const body = `The following notices need action:\n\n${lines.join('\n')}\n`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const exportCsv = () => {
    if (items.length === 0) return;
    const header = ['Client', 'GSTIN', 'Notice / Matter', 'Reference', 'Stage', 'Due', 'Days', 'Demand', 'Owner'];
    const body = items.map((r) => [
      r.client_name,
      r.gstin,
      r.notice_type || 'Notice',
      r.reference_number,
      stageLabel(r.staff_status),
      effectiveDue(r) || '',
      daysRemaining(r),
      r.amount_of_demand,
      r.assign_to || '',
    ].map(csvCell).join(','));
    const csv = [header.join(','), ...body].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `work-queue-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selCount = selected.size;
  const bulkDisabledTitle = !canEdit
    ? 'You do not have permission to edit notices'
    : selCount === 0 ? 'Select one or more rows first' : undefined;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Work queue — what needs action</h2>
          <p className="text-[11px] text-muted-foreground">
            Newest first. Click a row to open the notice drawer; select rows for bulk actions.
          </p>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {(['team', 'mine', 'unassigned', 'hearings'] as TabKey[]).map((t) => (
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
              {t === 'team' ? 'Team' : t === 'mine' ? 'Mine' : t === 'unassigned' ? 'Unassigned' : 'Hearings'} · {counts[t]}
            </button>
          ))}
        </div>
      </div>
      <CardContent className="pb-3 pt-2">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/50">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={(c) => toggleAllVisible(c === true)}
              aria-label="Select all rows"
            />
            {selCount > 0 ? `${selCount} selected` : 'Select all'}
          </label>
          <Button
            size="sm" variant="outline" className="h-7 text-[11px]"
            disabled={!canEdit || selCount === 0} title={bulkDisabledTitle}
            onClick={() => setAssignOpen(true)}
          >
            Assign ▾
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 text-[11px]"
            disabled={!canEdit || selCount === 0} title={bulkDisabledTitle}
            onClick={() => setPriorityOpen(true)}
          >
            Set priority ▾
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 text-[11px]"
            disabled={!canEdit || selCount === 0} title={bulkDisabledTitle}
            onClick={() => setStageOpen(true)}
          >
            Change stage ▾
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 text-[11px]"
            disabled={selCount === 0} title={selCount === 0 ? 'Select one or more rows first' : undefined}
            onClick={emailTeam}
          >
            ✉ Email GST team
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={exportCsv} disabled={items.length === 0}>
            <Download className="mr-1 h-3 w-3" /> Export
          </Button>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
            Open notices · earliest due first
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
          // The scroll constraint goes on the Table's own container — wrapping
          // it in a second overflow-auto div silently breaks sticky headers.
          <Table containerClassName="max-h-[620px] overflow-auto rounded-md border">
            <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-muted w-[26px]">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={(c) => toggleAllVisible(c === true)}
                      aria-label="Select all rows"
                    />
                  </TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Client</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Notice / Matter</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Stage</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Due</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Days</TableHead>
                  <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Demand ₹</TableHead>
                  <TableHead className="bg-muted text-center text-[10px] font-semibold uppercase">Owner</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((item) => {
                  const days = daysRemaining(item);
                  return (
                    <TableRow
                      key={item.id}
                      data-state={selected.has(item.id) ? 'selected' : undefined}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => onSelectNotice?.(item.id, item.client_id)}
                    >
                      <TableCell className="w-[26px] px-2" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(item.id)}
                          onCheckedChange={() => toggleRow(item.id)}
                          aria-label={`Select ${item.client_name}`}
                        />
                      </TableCell>
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
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground" title={item.assign_to ?? undefined}>
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
        )}

        {!loading && items.length > 0 && (
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Showing {visibleRows.length} of {items.length}
              {staleCount > 0 && (
                <> · {staleCount} open rows have no due date or stage —{' '}
                  <button
                    type="button"
                    className="font-semibold text-primary hover:underline disabled:opacity-60"
                    disabled={sweeping}
                    onClick={(e) => { e.stopPropagation(); onSweep?.(); }}
                  >
                    {sweeping ? 'running the closing sweep…' : 'run the closing sweep'}
                  </button>
                </>
              )}
            </span>
            <Link to="/notices-all" className="shrink-0 font-semibold text-primary hover:underline">
              View full work queue →
            </Link>
          </div>
        )}
      </CardContent>

      <Dialog open={assignOpen} onOpenChange={(o) => { setAssignOpen(o); if (!o) setAssignTo(''); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign</DialogTitle>
            <DialogDescription>Applies to the {selCount} selected notice{selCount === 1 ? '' : 's'}.</DialogDescription>
          </DialogHeader>
          <Select value={assignTo} onValueChange={setAssignTo}>
            <SelectTrigger><SelectValue placeholder="Select a team member…" /></SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.user_id} value={p.user_id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={applyAssign} disabled={saving || !assignTo}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? 'Saving…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={priorityOpen} onOpenChange={(o) => { setPriorityOpen(o); if (!o) setBulkPriority(''); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set priority</DialogTitle>
            <DialogDescription>Applies to the {selCount} selected notice{selCount === 1 ? '' : 's'}.</DialogDescription>
          </DialogHeader>
          <Select value={bulkPriority} onValueChange={setBulkPriority}>
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {PRIORITY_TIERS.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setPriorityOpen(false)}>Cancel</Button>
            <Button onClick={applyPriority} disabled={saving || !bulkPriority}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stageOpen} onOpenChange={(o) => { setStageOpen(o); if (!o) { setBulkStage(''); setCloseReason(''); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change stage</DialogTitle>
            <DialogDescription>Applies to the {selCount} selected notice{selCount === 1 ? '' : 's'}.</DialogDescription>
          </DialogHeader>
          <Select value={bulkStage} onValueChange={setBulkStage}>
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {STAGE_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {bulkStage === 'Closed' && (
            <Input
              placeholder="Close reason (optional)"
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              className="text-xs"
            />
          )}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setStageOpen(false)}>Cancel</Button>
            <Button onClick={applyStage} disabled={saving || !bulkStage}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default NoticeWorkQueue;
