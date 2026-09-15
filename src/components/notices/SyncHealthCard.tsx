import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw } from 'lucide-react';

interface SyncHealthCardProps {
  lastSync: string | null;
  clientsSynced24h: number;
  totalClientsWithCreds?: number;
  failedLogins: number;
  newNotices24h: number;
  changedRows24h: number;
  extensionVersion: string | null;
  extensionReady: boolean;
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / 3600000;
  if (diffH < 24) {
    return 'Today ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }) + ' ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
}

interface ActivityItem {
  time: string;
  text: string;
  tag?: string;
}

function ActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('notice_events')
        .select('event_type, old_value, new_value, actor_name, created_at, client_id')
        .order('created_at', { ascending: false })
        .limit(5);
      if (cancelled || !data?.length) return;

      const clientIds = [...new Set(data.map((e: any) => e.client_id))];
      const { data: clients } = await supabase.from('clients').select('id, name').in('id', clientIds);
      const cMap = new Map((clients ?? []).map((c: any) => [c.id, c.name]));

      const feed: ActivityItem[] = data.map((e: any) => {
        const d = new Date(e.created_at);
        const now = new Date();
        const diffH = (now.getTime() - d.getTime()) / 3600000;
        let time: string;
        if (diffH < 24) {
          time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
        } else {
          time = d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
        }
        const client = cMap.get(e.client_id) || '';
        const nv = e.new_value as Record<string, unknown> | null;
        let text = '';
        let tag: string | undefined;
        switch (e.event_type) {
          case 'captured':
            text = `New ${nv?.notice_type || 'notice'} · ${client}`;
            break;
          case 'assigned':
            text = `${e.actor_name || 'Staff'} assigned notice to ${nv?.assign_to || 'someone'} · ${client}`;
            break;
          case 'closed':
            text = `${e.actor_name || 'System'} closed notice · ${client}`;
            break;
          case 'status_changed':
            text = `${e.actor_name || 'Staff'} ${nv?.staff_status || ''} · ${client}`;
            break;
          case 'reply_logged':
            text = `${e.actor_name || 'Staff'} filed reply · ${client}`;
            break;
          default:
            text = `${e.event_type} · ${client}`;
        }
        return { time, text, tag };
      });
      if (!cancelled) setItems(feed);
    })();
    return () => { cancelled = true; };
  }, []);

  if (items.length === 0) return null;

  return (
    <>
      <div className="my-2.5 border-t" />
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2 text-[11px]">
            <span className="w-11 shrink-0 tabular-nums text-muted-foreground">{item.time}</span>
            <span className="min-w-0">
              {item.text}
              {item.tag && (
                <span className="ml-1 rounded-full bg-destructive/10 px-1.5 py-0 text-[9px] font-bold text-destructive">{item.tag}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function SyncHealthCard({
  lastSync,
  clientsSynced24h,
  totalClientsWithCreds,
  failedLogins,
  newNotices24h,
  changedRows24h,
  extensionVersion,
  extensionReady,
}: SyncHealthCardProps) {
  const isHealthy = extensionReady && failedLogins === 0;
  const needsAttention = extensionReady && failedLogins > 0;

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: 'Last Sync All (notices + refunds + DRC-03)',
      value: formatSyncTime(lastSync),
    },
    {
      label: 'Clients synced / with credentials',
      value: `${clientsSynced24h}${totalClientsWithCreds ? ` / ${totalClientsWithCreds}` : ''}`,
    },
    {
      label: 'Failed logins (latest attempt)',
      value: failedLogins > 0 ? (
        <span className="text-destructive font-semibold">{failedLogins} · fix →</span>
      ) : (
        <span>0</span>
      ),
    },
    {
      label: 'New rows this sync · changed',
      value: `${newNotices24h} · ${changedRows24h}`,
    },
    {
      label: 'Emails sent today (digest + alerts)',
      value: '0',
    },
    {
      label: 'Extension',
      value: extensionReady && extensionVersion ? (
        <span>v{extensionVersion} · connected</span>
      ) : (
        <span className="text-muted-foreground">Not detected</span>
      ),
    },
  ];

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
            Sync &amp; alerts
          </h2>
          <p className="text-[11px] text-muted-foreground">Portal pulls, failed logins, emails sent</p>
        </div>
        {isHealthy && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
            Healthy
          </span>
        )}
        {needsAttention && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
            Attention
          </span>
        )}
        {!extensionReady && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
            Offline
          </span>
        )}
      </div>
      <CardContent className="pt-3 pb-3">
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">{row.label}</span>
              <span className="shrink-0 text-xs font-semibold">{row.value}</span>
            </div>
          ))}
        </div>
        <ActivityFeed />

        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Next scheduled unattended sync: 06:00 IST</span>
          <span className="shrink-0 font-semibold text-primary">Sync log →</span>
        </div>
      </CardContent>
    </Card>
  );
}
