import { useState, useEffect, useCallback, useMemo } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

const LAST_SEEN_KEY = 'vjdesai_notif_seen';

interface NotificationEvent {
  id: string;
  event_type: string;
  actor_name: string | null;
  created_at: string;
  notice_id?: string | null;
  matter_id?: string | null;
}

function getLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function setLastSeen(ts: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, ts);
  } catch {
    // storage unavailable
  }
}

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const d = new Date(isoDate);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatEventType(raw: string): string {
  return raw.replace(/_/g, ' ');
}

function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [lastSeen, setLastSeenState] = useState<string | null>(getLastSeen);
  const [open, setOpen] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (!user) return;

    const userId = user.id;

    // Fetch notice_events (actor column is `actor_id`)
    const noticePromise = supabase
      .from('notice_events')
      .select('id, event_type, actor_id, actor_name, notice_id, created_at')
      .neq('actor_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    // Fetch matter_events (actor column is `actor_user_id`)
    const matterPromise = supabase
      .from('matter_events')
      .select(
        'id, event_type, actor_user_id, actor_name, matter_id, created_at',
      )
      .neq('actor_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    const [noticeRes, matterRes] = await Promise.all([
      noticePromise,
      matterPromise,
    ]);

    const noticeEvents: NotificationEvent[] = (noticeRes.data ?? []).map(
      (r) => ({
        id: r.id,
        event_type: r.event_type,
        actor_name: r.actor_name,
        created_at: r.created_at,
        notice_id: r.notice_id,
        matter_id: null,
      }),
    );

    const matterEvents: NotificationEvent[] = (matterRes.data ?? []).map(
      (r) => ({
        id: r.id,
        event_type: r.event_type,
        actor_name: r.actor_name,
        created_at: r.created_at,
        notice_id: null,
        matter_id: r.matter_id,
      }),
    );

    const merged = [...noticeEvents, ...matterEvents]
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, 30);

    setEvents(merged);
  }, [user]);

  // Fetch on mount and when popover opens
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (open) {
      fetchEvents();
    }
  }, [open, fetchEvents]);

  const unreadCount = useMemo(() => {
    if (!lastSeen) return events.length;
    const seenTime = new Date(lastSeen).getTime();
    return events.filter((e) => new Date(e.created_at).getTime() > seenTime)
      .length;
  }, [events, lastSeen]);

  const handleMarkAllRead = () => {
    const now = new Date().toISOString();
    setLastSeen(now);
    setLastSeenState(now);
  };

  const handleEventClick = (ev: NotificationEvent) => {
    setOpen(false);
    if (ev.notice_id) {
      navigate(`/notices-all?noticeId=${ev.notice_id}`);
    } else if (ev.matter_id) {
      navigate(`/litigation/${ev.matter_id}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4 text-muted-foreground transition-colors hover:text-foreground" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-xs text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* Event list */}
        <div className="max-h-80 overflow-y-auto">
          {events.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No new notifications
            </p>
          ) : (
            events.map((ev) => (
              <div
                key={ev.id}
                role="button"
                tabIndex={0}
                onClick={() => handleEventClick(ev)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleEventClick(ev);
                }}
                className="cursor-pointer border-b px-3 py-2 last:border-0 hover:bg-muted"
              >
                <div className="text-xs font-medium">
                  {formatEventType(ev.event_type)}
                </div>
                {ev.actor_name && (
                  <div className="text-xs text-muted-foreground">
                    {ev.actor_name}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  {formatRelativeTime(ev.created_at)}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationBell;
export { NotificationBell };
