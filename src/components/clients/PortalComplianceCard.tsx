import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, Banknote, FileWarning, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface PortalComplianceCardProps {
  clientId: string;
  clientName: string;
}

interface RowState {
  key: 'notices' | 'refunds' | 'drc03';
  label: string;
  icon: React.ElementType;
  count: number | null;
  pullMessageKey: '__gstkPullNotices' | '__gstkPullRefunds' | '__gstkPullDrc03';
  resultKey: '__gstkPullNoticesResult' | '__gstkPullRefundsResult' | '__gstkPullDrc03Result';
}

/**
 * Feeds the Notices & Orders, Refund and DRC-03 reports (8 reports total) —
 * gst_notices / gst_refund_applications / gst_drc03_filings. Each "Pull"
 * button drives an UNVERIFIED extension automation (see content.js
 * handleNotices/handleRefund/handleDrc03) — there's no proven portal page in
 * this codebase to mirror for these three, so a pull can fail against the
 * real portal even with the extension installed and working. Not period-
 * scoped — the portal shows a client's full history in one list, so these
 * pulls replace ALL of that client's rows in one table each time.
 */
export const PortalComplianceCard: React.FC<PortalComplianceCardProps> = ({ clientId, clientName }) => {
  const [extReady, setExtReady] = useState(false);
  const [busy, setBusy] = useState<null | 'notices' | 'refunds' | 'drc03'>(null);
  const [counts, setCounts] = useState<Record<'notices' | 'refunds' | 'drc03', number | null>>({
    notices: null, refunds: null, drc03: null,
  });

  const rows: RowState[] = [
    { key: 'notices', label: 'Notices & Orders', icon: Bell, count: counts.notices, pullMessageKey: '__gstkPullNotices', resultKey: '__gstkPullNoticesResult' },
    { key: 'refunds', label: 'Refund Applications', icon: Banknote, count: counts.refunds, pullMessageKey: '__gstkPullRefunds', resultKey: '__gstkPullRefundsResult' },
    { key: 'drc03', label: 'DRC-03 Filings', icon: FileWarning, count: counts.drc03, pullMessageKey: '__gstkPullDrc03', resultKey: '__gstkPullDrc03Result' },
  ];

  const refreshCounts = async () => {
    if (!clientId) return;
    const [n, r, d] = await Promise.all([
      supabase.from('gst_notices').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
      supabase.from('gst_refund_applications').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
      supabase.from('gst_drc03_filings').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
    ]);
    setCounts({ notices: n.count ?? 0, refunds: r.count ?? 0, drc03: d.count ?? 0 });
  };

  useEffect(() => { refreshCounts(); }, [clientId]);

  useEffect(() => {
    window.postMessage({ __gstkAppReady: true }, '*');
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkPullNoticesResult) {
        setBusy(null);
        const r = d.__gstkPullNoticesResult;
        if (!r.ok) toast.error('Notices pull: ' + (r.error || 'failed'));
        else { toast.success('Notices & Orders pulled.'); refreshCounts(); }
      }
      if (d.__gstkPullRefundsResult) {
        setBusy(null);
        const r = d.__gstkPullRefundsResult;
        if (!r.ok) toast.error('Refund pull: ' + (r.error || 'failed'));
        else { toast.success(`Refund applications pulled${r.count != null ? ` (${r.count})` : ''}.`); refreshCounts(); }
      }
      if (d.__gstkPullDrc03Result) {
        setBusy(null);
        const r = d.__gstkPullDrc03Result;
        if (!r.ok) toast.error('DRC-03 pull: ' + (r.error || 'failed'));
        else { toast.success(`DRC-03 filings pulled${r.count != null ? ` (${r.count})` : ''}.`); refreshCounts(); }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const pull = (row: RowState) => {
    if (!extReady) { toast.error('Install/enable the GST Keeper browser extension, then reload this page.'); return; }
    setBusy(row.key);
    window.postMessage({ [row.pullMessageKey]: { clientId } }, '*');
    toast.info(`Opening the portal in a new tab — type the CAPTCHA there; ${row.label} will save here automatically when it finishes. This pull is unverified against the real portal, so it may need a selector fix if it doesn't find the expected page.`);
  };

  if (!clientId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notices, Refund &amp; DRC-03</CardTitle>
        <CardDescription>
          Feeds the Notices &amp; Orders, Refund and DRC-03 reports. Each pull is a best-effort portal automation, unverified against the real portal — if it fails, enter the records directly instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.key} className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {row.label} — {row.count === null ? 'Loading…' : row.count === 0 ? 'none on record' : `${row.count} on record`}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => pull(row)}
                disabled={busy !== null}
                className={extReady ? '' : 'text-muted-foreground'}
                title={extReady ? `Pull ${clientName}'s ${row.label} from the portal via the browser extension` : 'GST Keeper extension not detected yet — install/enable it and reload this page'}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-2 ${busy === row.key ? 'animate-spin' : ''}`} />
                Pull
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default PortalComplianceCard;
