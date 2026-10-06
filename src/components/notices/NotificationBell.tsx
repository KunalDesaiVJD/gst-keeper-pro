// The bell (audit U-02-1…4): what changed on notices and matters, written by
// the database for every writer — staff, the portal sync, the closing sweep —
// so system events show too. Each line names the client and the notice and
// says what changed (describeEvent), opens the notice workspace, and unread
// lines stand out. "For me" = notices and matters I own. What has been seen is
// kept per user in public.notice_bell_state, so it carries across computers.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { describeEvent } from '@/lib/noticeEventText';
import { stageLabel } from '@/lib/noticeStages';
import { fmtAgo, fmtDate, fmtInrShort, sentenceCase } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

interface BellItem {
  key: string;
  /** The notice or matter the event is about (consecutive events on it are grouped). */
  target: string;
  at: string;
  context: string;
  title: string;
  detail?: string;
  href: string;
  mine: boolean;
  more: number;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const MATTER_FIELDS: Record<string, string> = {
  title: 'title', lifecycle: 'type', section_of_law: 'section', authority: 'authority', officer: 'officer',
  jurisdiction: 'jurisdiction', priority: 'priority', owner_user_id: 'owner', reviewer_user_id: 'reviewer',
  demand_tax: 'tax demanded', demand_interest: 'interest demanded', demand_penalty: 'penalty demanded',
  demand_cess: 'cess demanded', next_action: 'next action', computed_due_date: 'due date',
  override_due_date: 'due date', limitation_date: 'limitation date', financial_years: 'years',
};

function describeMatterEvent(type: string, payload: unknown, actor: string | null): { title: string; detail?: string } {
  const who = actor || 'System';
  const p = obj(payload);
  switch (type) {
    case 'created': return { title: `${who} opened the matter` };
    case 'stage_changed': return { title: `${who} moved it ${p.from ? `${stageLabel(str(p.from))} → ` : 'to '}${stageLabel(str(p.to))}` };
    case 'closed': return { title: `${who} closed the matter`, detail: str(p.reason) || undefined };
    case 'reopened': return { title: `${who} reopened the matter` };
    case 'notices_linked': return { title: `${who} linked ${p.count ?? 'a'} notice${p.count === 1 ? '' : 's'}` };
    case 'notice_unlinked': return { title: `${who} unlinked a notice` };
    case 'hearing_added': return { title: `${who} fixed a hearing${p.scheduled_at ? ` on ${fmtDate(str(p.scheduled_at).slice(0, 10))}` : ''}`, detail: str(p.venue) || undefined };
    case 'payment_added': {
      const total = ['tax', 'interest', 'penalty', 'cess', 'amount'].reduce((s, k) => s + (Number(p[k]) || 0), 0);
      return { title: `${who} recorded a ${str(p.kind || 'payment').replace(/_/g, ' ')}${total ? ` of ${fmtInrShort(total)}` : ''}` };
    }
    case 'field_changed': return { title: `${who} changed the ${MATTER_FIELDS[str(p.field)] ?? str(p.field).replace(/_/g, ' ')}` };
    default: return { title: `${who}: ${type.replace(/_/g, ' ')}` };
  }
}

async function loadBell(userId: string): Promise<BellItem[]> {
  const [ne, me] = await Promise.all([
    supabase.from('notice_events')
      .select('id, notice_id, client_id, event_type, old_value, new_value, actor_id, actor_name, source, created_at')
      .or(`actor_id.is.null,actor_id.neq.${userId}`)
      .order('created_at', { ascending: false }).limit(60),
    supabase.from('matter_events')
      .select('id, matter_id, event_type, actor_user_id, actor_name, payload, created_at')
      .or(`actor_user_id.is.null,actor_user_id.neq.${userId}`)
      .order('created_at', { ascending: false }).limit(30),
  ]);
  if (ne.error) throw ne.error;
  const nEvents = ne.data ?? [];
  const mEvents = me.error ? [] : me.data ?? [];

  const noticeIds = [...new Set(nEvents.map((e) => e.notice_id))];
  const matterIds = [...new Set(mEvents.map((e) => e.matter_id))];
  const [notices, matters] = await Promise.all([
    noticeIds.length
      ? supabase.from('gst_notices').select('id, client_id, form_code, notice_type, reference_number, assign_to_user_id').in('id', noticeIds)
      : Promise.resolve({ data: [], error: null }),
    matterIds.length
      ? supabase.from('litigation_matters').select('id, client_id, matter_no, owner_user_id').in('id', matterIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const noticeById = new Map((notices.data ?? []).map((n) => [n.id, n]));
  const matterById = new Map((matters.data ?? []).map((m) => [m.id, m]));
  const clientIds = [...new Set([...nEvents.map((e) => e.client_id), ...(matters.data ?? []).map((m) => m.client_id)].filter(Boolean))];
  const clients = clientIds.length ? await supabase.from('clients').select('id, name').in('id', clientIds) : { data: [] as { id: string; name: string }[] };
  const clientName = new Map((clients.data ?? []).map((c) => [c.id, c.name]));

  const items: BellItem[] = [
    ...nEvents.map((e) => {
      const n = noticeById.get(e.notice_id);
      const what = [n?.form_code || (n?.notice_type ? sentenceCase(n.notice_type) : ''), n?.reference_number].filter(Boolean).join(' ');
      const d = describeEvent(e);
      return {
        key: `n-${e.id}`, target: `n-${e.notice_id}`, at: e.created_at,
        context: [clientName.get(e.client_id) ?? 'A client', what].filter(Boolean).join(' · '),
        title: d.title, detail: d.detail, href: `/notices/${e.notice_id}`,
        mine: n?.assign_to_user_id === userId, more: 0,
      };
    }),
    ...mEvents.map((e) => {
      const m = matterById.get(e.matter_id);
      const d = describeMatterEvent(e.event_type, e.payload, e.actor_name);
      return {
        key: `m-${e.id}`, target: `m-${e.matter_id}`, at: e.created_at,
        context: [m ? clientName.get(m.client_id) ?? 'A client' : 'A matter', m?.matter_no ? `matter ${m.matter_no}` : ''].filter(Boolean).join(' · '),
        title: d.title, detail: d.detail, href: `/litigation/${e.matter_id}`,
        mine: !!m && m.owner_user_id === userId, more: 0,
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return items;
}

/** Consecutive events on the same notice within an hour read as one line. */
function group(items: BellItem[]): BellItem[] {
  const out: BellItem[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.target === it.target && new Date(last.at).getTime() - new Date(it.at).getTime() < 3_600_000) last.more += 1;
    else out.push({ ...it });
  }
  return out;
}

const localKey = (userId: string) => `vjdesai_notif_seen:${userId}`;

function useSeenAt(userId: string | null) {
  const [seenAt, setSeenAtState] = useState<string | null>(() => {
    if (!userId) return null;
    try { return localStorage.getItem(localKey(userId)); } catch { return null; }
  });
  useEffect(() => {
    if (!userId) return;
    let live = true;
    supabase.from('notice_bell_state').select('seen_at').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (live && data?.seen_at) setSeenAtState((cur) => (!cur || data.seen_at > cur ? data.seen_at : cur)); });
    return () => { live = false; };
  }, [userId]);
  const markSeen = (ts: string) => {
    if (!userId || (seenAt && ts <= seenAt)) return;
    setSeenAtState(ts);
    try { localStorage.setItem(localKey(userId), ts); } catch { /* storage unavailable */ }
    void supabase.from('notice_bell_state').upsert({ user_id: userId, seen_at: ts }, { onConflict: 'user_id' }).then(() => undefined);
  };
  return { seenAt, markSeen };
}

function NotificationBell() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'mine' | 'all'>('all');
  const { seenAt, markSeen } = useSeenAt(userId);
  const q = useQuery({
    queryKey: ['notice-bell', userId],
    queryFn: () => loadBell(userId as string),
    enabled: !!userId,
    // The sync and the sweep write events while the page is open.
    refetchInterval: 120_000,
    staleTime: 30_000,
  });
  const items = useMemo(() => q.data ?? [], [q.data]);
  const isUnread = (it: BellItem) => !seenAt || it.at > seenAt;
  const unread = items.filter(isUnread).length;
  const shown = useMemo(() => group(tab === 'mine' ? items.filter((i) => i.mine) : items), [items, tab]);
  const newest = items[0]?.at ?? null;
  const openedAt = useRef(0);

  const onOpenChange = (o: boolean) => {
    if (o) { openedAt.current = Date.now(); qc.invalidateQueries({ queryKey: ['notice-bell', userId] }); }
    // Closing after a look marks what was listed as seen.
    else if (newest && Date.now() - openedAt.current > 1500) markSeen(newest);
    setOpen(o);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8"
          aria-label={unread ? `Notifications, ${unread > 9 ? '9+' : unread} unread` : 'Notifications'}>
          <Bell className="h-4 w-4 text-muted-foreground transition-colors hover:text-foreground" aria-hidden />
          {unread > 0 && (
            <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-[1rem] rounded-full bg-destructive-strong px-1 text-center text-[10px] font-semibold leading-4 text-background">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <span className="sr-only" aria-live="polite">{unread ? `${unread} unread notifications` : ''}</span>

      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <div className="flex items-center gap-1" role="group" aria-label="Show">
            {(['mine', 'all'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}
                className={cn('rounded-full px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tab === t ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-muted')}>
                {t === 'mine' ? 'For me' : 'All'}
              </button>
            ))}
          </div>
          {unread > 0 && newest && (
            <button type="button" onClick={() => markSeen(newest)} className="text-xs text-primary underline-offset-2 hover:underline">
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[26rem] overflow-y-auto">
          {q.isLoading ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Loading…</p>
          ) : q.error ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Couldn't load notifications.{' '}
              <button type="button" onClick={() => q.refetch()} className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
                <RefreshCw className="h-3 w-3" aria-hidden /> Retry
              </button>
            </div>
          ) : shown.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {tab === 'mine' ? 'Nothing new on the notices and matters you own.' : 'Nothing new.'}
            </p>
          ) : (
            <ul>
              {shown.map((it) => {
                const fresh = isUnread(it);
                return (
                  <li key={it.key} className="border-b last:border-0">
                    <Link to={it.href} onClick={() => onOpenChange(false)}
                      className={cn('flex items-start gap-2 px-3 py-2 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none', fresh && 'bg-primary/5')}>
                      <span aria-hidden className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', fresh ? 'bg-primary' : 'bg-transparent')} />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-xs', fresh ? 'font-semibold' : 'font-medium')}>{it.context}</span>
                        <span className="block text-xs text-foreground/80">{it.title}{it.more ? ` · and ${it.more} more` : ''}</span>
                        {it.detail && <span className="block truncate text-[11px] text-muted-foreground">{it.detail}</span>}
                        {fresh && <span className="sr-only">(new)</span>}
                      </span>
                      <time dateTime={it.at} className="shrink-0 text-[11px] text-muted-foreground">{fmtAgo(it.at)}</time>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationBell;
export { NotificationBell };
