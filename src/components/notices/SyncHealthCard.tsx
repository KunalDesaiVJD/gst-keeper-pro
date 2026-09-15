import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface SyncHealthCardProps {
  lastSync: string | null;
  clientsSynced24h: number;
  failedLogins: number;
  newNotices24h: number;
  changedRows24h: number;
  extensionVersion: string | null;
  extensionReady: boolean;
}

function formatRelativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return 'Unknown';
  }
}

function StatusIndicator({
  failedLogins,
  extensionReady,
}: Pick<SyncHealthCardProps, 'failedLogins' | 'extensionReady'>) {
  if (!extensionReady) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
        <span className="text-xs text-red-600">Extension offline</span>
      </div>
    );
  }
  if (failedLogins > 0) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
        <span className="text-xs text-yellow-600">Attention needed</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
      <span className="text-xs text-green-600">Healthy</span>
    </div>
  );
}

export default function SyncHealthCard({
  lastSync,
  clientsSynced24h,
  failedLogins,
  newNotices24h,
  changedRows24h,
  extensionVersion,
  extensionReady,
}: SyncHealthCardProps) {
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: 'Last Sync',
      value: lastSync ? (
        <span title={lastSync}>{formatRelativeTime(lastSync)}</span>
      ) : (
        <span className="text-muted-foreground">Never</span>
      ),
    },
    {
      label: 'Clients Synced',
      value: clientsSynced24h,
    },
    {
      label: 'Failed Logins',
      value: (
        <span className={failedLogins > 0 ? 'text-red-600' : undefined}>
          {failedLogins}
        </span>
      ),
    },
    {
      label: 'New Notices',
      value: newNotices24h,
    },
    {
      label: 'Changed Rows',
      value: changedRows24h,
    },
    {
      label: 'Extension Version',
      value: extensionReady && extensionVersion ? (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {extensionVersion}
        </Badge>
      ) : (
        <span className="text-muted-foreground">Not detected</span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          Sync &amp; Alerts Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <span className="text-xs font-medium">{row.value}</span>
          </div>
        ))}
        <div className="pt-2 border-t">
          <StatusIndicator
            failedLogins={failedLogins}
            extensionReady={extensionReady}
          />
        </div>
      </CardContent>
    </Card>
  );
}
