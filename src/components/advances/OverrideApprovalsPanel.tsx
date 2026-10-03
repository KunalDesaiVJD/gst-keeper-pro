import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TR } from '@/components/workspace/theme';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchPendingOverrides, decideOverride, type AdvanceOverride,
} from '@/lib/advanceSetoffOverrides';

const TH = `h-auto ${WS_TH}`;

const inr = (n: number) => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The GST Manager's inbox for advance set-off override requests.
 *
 * Without this the two-step flow was inert: an employee could raise a request
 * and nobody could act on it, so the return simply stayed blocked. The whole
 * point of making the block overridable is that there is a person who can
 * decide — this is where they decide.
 */
export const OverrideApprovalsPanel: React.FC<{ onDecided?: () => void }> = ({ onDecided }) => {
  const { user, canApproveAdvanceOverride } = useAuth();
  const [rows, setRows] = useState<AdvanceOverride[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const canApprove = canApproveAdvanceOverride();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pending = await fetchPendingOverrides();
      setRows(pending);
      const ids = Array.from(new Set(pending.map((r) => r.client_id)));
      if (ids.length) {
        const { data } = await supabase.from('clients').select('id, name').in('id', ids);
        const map: Record<string, string> = {};
        ((data as { id: string; name: string }[]) || []).forEach((c) => { map[c.id] = c.name; });
        setNames(map);
      }
    } catch (e) {
      toast.error(`Could not load override requests: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (row: AdvanceOverride, decision: 'APPROVED' | 'REJECTED') => {
    const note = (notes[row.id] || '').trim();
    // A rejection without a reason leaves the requester with nothing to act on,
    // so it is required there; an approval's justification is already on the
    // request itself.
    if (decision === 'REJECTED' && note.length < 10) {
      toast.error('Say briefly why it is rejected — the requester needs something to act on.');
      return;
    }
    setBusyId(row.id);
    try {
      await decideOverride({
        overrideId: row.id,
        clientId: row.client_id,
        clientName: names[row.client_id],
        decision,
        note,
        userId: user?.id || null,
        userName: user?.firstName || user?.email || 'Unknown',
        userRole: user?.role || 'unknown',
      });
      toast.success(decision === 'APPROVED' ? 'Override approved.' : 'Override rejected.');
      await load();
      onDecided?.();
    } catch (e) {
      toast.error(`Could not record the decision: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  if (!canApprove) {
    return (
      <Card><CardContent className="px-4 py-3">
        <TableEmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="Only a GST Manager can decide override requests"
          description="You can raise a request from the blocking dialog; a manager approves it here."
        />
      </CardContent></Card>
    );
  }

  return (
    <SectionCard
      title="Override requests awaiting a decision"
      description={<>Filing stays blocked until one of these is approved. An approval authorises only the findings
        shown here — if the return changes afterwards it lapses and the block returns.</>}
      actions={
        <Button variant="outline" size="sm" className={WS_BTN} onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </Button>
      }
    >
      {rows.length === 0 ? (
        <TableEmptyState
          icon={<CheckCircle2 className="h-8 w-8" />}
          title="Nothing waiting"
          description="No advance set-off override request is pending."
        />
      ) : (
        <Table className={WS_TABLE} containerClassName={`${WS_TABLE_WRAP} max-h-[70vh]`}>
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead className={TH}>Client / period</TableHead>
              <TableHead className={TH}>Requested by</TableHead>
              <TableHead className={TH}>Findings</TableHead>
              <TableHead className={`${TH} w-64`}>Decision note</TableHead>
              <TableHead className={`${TH} w-44`} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={`border-0 ${WS_TR}`}>
                <TableCell className={`${WS_TD} align-top`}>
                  <div className="font-medium">{names[row.client_id] || row.client_id}</div>
                  <div className="text-muted-foreground">
                    {row.period_month} · {String(row.return_type).replace('FILING_STATUS:', 'Marking filed — ')}
                  </div>
                </TableCell>
                <TableCell className={`${WS_TD} align-top`}>
                  <div>{row.requested_by_name || '—'}</div>
                  <div className="text-muted-foreground">
                    {new Date(row.requested_at).toLocaleString('en-IN')}
                  </div>
                  <div className="mt-1 italic">“{row.request_reason}”</div>
                </TableCell>
                <TableCell className={`${WS_TD} align-top max-w-[380px]`}>
                  {(Array.isArray(row.findings) ? row.findings : []).map((f, i) => (
                    <div key={i} className="flex items-start gap-1.5 mb-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
                      <div>
                        <div className="font-medium">{f.title}</div>
                        <div className="text-[11px] text-muted-foreground leading-snug">{f.detail}</div>
                        {f.amountAtRisk ? (
                          <div className="text-[11px] tabular-nums">At risk ₹{inr(f.amountAtRisk)}</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </TableCell>
                <TableCell className={`${WS_TD} align-top`}>
                  <Textarea
                    rows={3}
                    className="min-h-0 text-xs md:text-xs"
                    value={notes[row.id] || ''}
                    onChange={(e) => setNotes({ ...notes, [row.id]: e.target.value })}
                    placeholder="Required to reject"
                  />
                </TableCell>
                <TableCell className={`${WS_TD} align-top`}>
                  <div className="flex flex-col gap-1.5">
                    <Button size="sm" className={WS_BTN} disabled={busyId === row.id} onClick={() => decide(row, 'APPROVED')}>
                      {busyId === row.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <ShieldCheck className="h-3.5 w-3.5" />}
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" className={`${WS_BTN} text-destructive`} disabled={busyId === row.id} onClick={() => decide(row, 'REJECTED')}>
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
};

export default OverrideApprovalsPanel;
