import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import {
  DirectFilingApproval,
  decideDirectFilingApproval,
  fetchPendingDirectFilingApprovals,
  fetchRecentDecidedDirectFilingApprovals,
  fetchUserNames,
} from '@/lib/directFilingApprovals';

const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * Superadmin-only: every open direct-filing request (any client, any period)
 * with Approve / Reject, plus the last 20 decisions folded away.
 */
const DirectFilingApprovalsPanel: React.FC<{
  userId: string | null;
  /** Known client names (the page's client list); missing ones are fetched. */
  clientNames: Record<string, string>;
  /** Bump to reload (e.g. after a request is raised from a row). */
  refreshKey?: number;
  /** Called after a decision so the page can re-read its rows. */
  onDecided?: () => void;
}> = ({ userId, clientNames, refreshKey, onDecided }) => {
  const [pending, setPending] = useState<DirectFilingApproval[]>([]);
  const [decided, setDecided] = useState<DirectFilingApproval[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [extraClients, setExtraClients] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([fetchPendingDirectFilingApprovals(), fetchRecentDecidedDirectFilingApprovals(20)]);
      setPending(p);
      setDecided(d);
      const all = [...p, ...d];
      setNames(await fetchUserNames(all.flatMap((a) => [a.requested_by, a.decided_by])));
      const missing = [...new Set(all.map((a) => a.client_id))].filter((id) => !clientNames[id]);
      if (missing.length) {
        const { data } = await supabase.from('clients').select('id, name').in('id', missing);
        const extra: Record<string, string> = {};
        (data || []).forEach((c: { id: string; name: string }) => { extra[c.id] = c.name; });
        setExtraClients(extra);
      }
    } catch (e) {
      console.error('Error loading direct-filing approvals:', e);
      toast.error('Could not load direct-filing approval requests.');
    } finally {
      setLoading(false);
    }
  }, [clientNames]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const clientName = (id: string) => clientNames[id] || extraClients[id] || 'Unknown client';
  const userName = (id: string | null) => (id ? names[id] || 'Unknown' : '—');

  const decide = async (a: DirectFilingApproval, approve: boolean) => {
    const note = (notes[a.id] || '').trim();
    if (!approve && !note) { toast.error('Add a note to say why the request is rejected.'); return; }
    setBusyId(a.id);
    const r = await decideDirectFilingApproval({ id: a.id, approve, note, decidedBy: userId });
    setBusyId(null);
    if (!r.ok) { toast.error(r.error); await load(); return; }
    toast.success(`${a.return_type} ${a.period_month} for ${clientName(a.client_id)} ${approve ? 'approved' : 'rejected'}.`);
    setNotes((n) => { const next = { ...n }; delete next[a.id]; return next; });
    await load();
    onDecided?.();
  };

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          Direct-filing approvals
          <Badge variant={pending.length ? 'warning' : 'success'} className="px-1.5 text-[10px] tabular-nums">
            {pending.length} pending
          </Badge>
        </span>
      }
      description="GSTR-1s filed directly on the portal instead of being pushed from GST Keeper. Each needs your approval before it can be marked Filed or pulled from the portal."
    >
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
      ) : pending.length === 0 ? (
        <p className="text-xs text-muted-foreground">No requests are waiting.</p>
      ) : (
        <div className={WS_TABLE_WRAP}>
          <table className={WS_TABLE}>
            <thead>
              <tr>
                <th className={WS_TH}>Client</th>
                <th className={WS_TH}>Return</th>
                <th className={WS_TH}>Period</th>
                <th className={cn(WS_TH, 'min-w-[16rem]')}>What happened</th>
                <th className={WS_TH}>Requested</th>
                <th className={cn(WS_TH, 'min-w-[14rem] border-r-0')}>Decision</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((a) => (
                <tr key={a.id} className={WS_TR}>
                  <td className={cn(WS_TD, 'font-medium')}>{clientName(a.client_id)}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap')}>{a.return_type}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums')}>{a.period_month}</td>
                  <td className={cn(WS_TD, 'whitespace-pre-wrap text-xs')}>{a.reason}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>
                    <div>{userName(a.requested_by)}</div>
                    <div className="text-muted-foreground">{fmtWhen(a.requested_at)}</div>
                  </td>
                  <td className={cn(WS_TD, 'border-r-0')}>
                    <div className="space-y-1.5">
                      <Textarea
                        value={notes[a.id] || ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                        rows={2}
                        placeholder="Note (required to reject)"
                        className="min-h-0 text-xs"
                        disabled={busyId === a.id}
                      />
                      <div className="flex gap-1.5">
                        <Button size="sm" className={WS_BTN} disabled={busyId === a.id} onClick={() => decide(a, true)}>
                          {busyId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(WS_BTN, 'text-destructive hover:text-destructive')}
                          disabled={busyId === a.id || !(notes[a.id] || '').trim()}
                          title={(notes[a.id] || '').trim() ? 'Reject this request' : 'Add a note to reject'}
                          onClick={() => decide(a, false)}
                        >
                          <X className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {decided.length > 0 && (
        <Collapsible open={showDecided} onOpenChange={setShowDecided}>
          <CollapsibleTrigger asChild>
            <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showDecided && 'rotate-180')} />
              Recent decisions ({decided.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className={WS_TABLE_WRAP}>
              <table className={WS_TABLE}>
                <thead>
                  <tr>
                    <th className={WS_TH}>Client</th>
                    <th className={WS_TH}>Return</th>
                    <th className={WS_TH}>Period</th>
                    <th className={WS_TH}>Outcome</th>
                    <th className={cn(WS_TH, 'min-w-[14rem]')}>What happened</th>
                    <th className={cn(WS_TH, 'min-w-[10rem]')}>Note</th>
                    <th className={WS_TH}>Requested</th>
                    <th className={cn(WS_TH, 'border-r-0')}>Decided</th>
                  </tr>
                </thead>
                <tbody>
                  {decided.map((a) => (
                    <tr key={a.id} className={WS_TR}>
                      <td className={WS_TD}>{clientName(a.client_id)}</td>
                      <td className={cn(WS_TD, 'whitespace-nowrap')}>{a.return_type}</td>
                      <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums')}>{a.period_month}</td>
                      <td className={WS_TD}>
                        <Badge variant={a.status === 'approved' ? 'success' : 'destructive'} className="px-1.5 text-[10px] capitalize">{a.status}</Badge>
                      </td>
                      <td className={cn(WS_TD, 'whitespace-pre-wrap text-xs')}>{a.reason}</td>
                      <td className={cn(WS_TD, 'whitespace-pre-wrap text-xs')}>{a.decision_note || '—'}</td>
                      <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>
                        <div>{userName(a.requested_by)}</div>
                        <div className="text-muted-foreground">{fmtWhen(a.requested_at)}</div>
                      </td>
                      <td className={cn(WS_TD, 'whitespace-nowrap border-r-0 text-xs')}>
                        <div>{userName(a.decided_by)}</div>
                        <div className="text-muted-foreground">{fmtWhen(a.decided_at)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </SectionCard>
  );
};

export default DirectFilingApprovalsPanel;
