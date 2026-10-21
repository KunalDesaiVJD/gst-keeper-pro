import React, { useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { decideConflict, type FilingLogRow } from '@/lib/filingPull';
import { revokeManualSource, type ManualSourceAllowance } from '@/lib/manualSourceAllowances';

const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * The exceptions to "pulled only", in one place: the superadmin's manual
 * allowances for the month (given, used, taken back, each with its reason)
 * and the pull conflicts waiting for the superadmin (any month). Everyone
 * sees them; only the superadmin acts.
 */
const FilingExceptionsPanel: React.FC<{
  periodMonth: string;
  isSuperadmin: boolean;
  userId: string | null;
  clientNames: Record<string, string>;
  userNames: Record<string, string>;
  allowances: ManualSourceAllowance[];
  conflicts: FilingLogRow[];
  onChanged: () => void;
}> = ({ periodMonth, isSuperadmin, userId, clientNames, userNames, allowances, conflicts, onChanged }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const name = (id: string | null | undefined) => (id ? userNames[id] || 'Unknown' : '—');
  const client = (id: string) => clientNames[id] || 'Unknown client';
  const filingAllowances = allowances.filter((a) => a.scope.startsWith('filing:'));
  if (!filingAllowances.length && !conflicts.length && !isSuperadmin) return null;

  const revoke = async (a: ManualSourceAllowance) => {
    if (!userId) return;
    setBusy(a.id);
    try {
      await revokeManualSource(userId, a.id);
      toast.success('Allowance taken back.');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };
  const decide = async (c: FilingLogRow, accept: boolean) => {
    if (!userId) return;
    setBusy(c.id);
    try {
      await decideConflict(userId, c.id, accept);
      toast.success(accept ? 'The pulled ARN is on the return now.' : 'Kept as it was.');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message, { duration: 10000 });
    } finally { setBusy(null); }
  };
  const pulledArn = (c: FilingLogRow) => ((c.detail?.pulled as { arn?: string } | undefined)?.arn) || '—';

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          Exceptions to the portal pull
          <Badge variant={conflicts.length ? 'warning' : 'success'} className="px-1.5 text-[10px] tabular-nums">{conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}</Badge>
          <Badge variant="info" className="px-1.5 text-[10px] tabular-nums">{filingAllowances.length} manual allowance{filingAllowances.length === 1 ? '' : 's'} in {periodMonth}</Badge>
        </span>
      }
      description="GSTR-1 and GSTR-3B are marked Filed only by the portal pull. A manual upload of one needs the superadmin's allowance for that client, period and return, with a reason. A pull that brings a different ARN changes nothing until the superadmin decides."
    >
      {conflicts.length > 0 && (
        <div className={WS_TABLE_WRAP}>
          <table className={WS_TABLE} aria-label="Pull conflicts">
            <thead>
              <tr>
                <th className={WS_TH}>Client</th>
                <th className={WS_TH}>Return</th>
                <th className={WS_TH}>Period</th>
                <th className={WS_TH}>Holds</th>
                <th className={WS_TH}>Portal gave</th>
                <th className={cn(WS_TH, 'min-w-[16rem]')}>What the pull found</th>
                <th className={cn(WS_TH, 'border-r-0')}>{isSuperadmin ? 'Decision' : 'When'}</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.id} className={WS_TR}>
                  <td className={cn(WS_TD, 'font-medium')}>{client(c.client_id)}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap')}>{c.return_type}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums')}>{c.period_month}</td>
                  <td className={cn(WS_TD, 'font-mono text-xs')}>{c.old_arn || '—'}</td>
                  <td className={cn(WS_TD, 'font-mono text-xs')}>{pulledArn(c)}</td>
                  <td className={cn(WS_TD, 'whitespace-pre-wrap text-xs')}>{c.message}</td>
                  <td className={cn(WS_TD, 'border-r-0 text-xs')}>
                    {isSuperadmin ? (
                      <div className="flex gap-1.5">
                        <Button size="sm" className={WS_BTN} disabled={busy === c.id} onClick={() => decide(c, true)} title="Put the pulled ARN, date and PDF on the return">
                          {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Accept
                        </Button>
                        <Button size="sm" variant="outline" className={WS_BTN} disabled={busy === c.id} onClick={() => decide(c, false)} title="Keep the return as it is">
                          <X className="h-3.5 w-3.5" /> Keep
                        </Button>
                      </div>
                    ) : fmtWhen(c.at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filingAllowances.length > 0 ? (
        <div className={WS_TABLE_WRAP}>
          <table className={WS_TABLE} aria-label="Manual allowances">
            <thead>
              <tr>
                <th className={WS_TH}>Client</th>
                <th className={WS_TH}>Return</th>
                <th className={cn(WS_TH, 'min-w-[14rem]')}>Reason</th>
                <th className={WS_TH}>Allowed</th>
                <th className={WS_TH}>State</th>
                {isSuperadmin && <th className={cn(WS_TH, 'border-r-0')}>Take back</th>}
              </tr>
            </thead>
            <tbody>
              {filingAllowances.map((a) => (
                <tr key={a.id} className={WS_TR}>
                  <td className={cn(WS_TD, 'font-medium')}>{client(a.client_id)}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap')}>{a.scope.replace(/^filing:/, '')}</td>
                  <td className={cn(WS_TD, 'whitespace-pre-wrap text-xs')}>{a.reason}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>
                    <div>{name(a.allowed_by)}</div>
                    <div className="text-muted-foreground">{fmtWhen(a.allowed_at)}</div>
                  </td>
                  <td className={cn(WS_TD, 'text-xs')}>
                    {a.revoked_at ? <Badge variant="outline" className="px-1.5 text-[10px]">Taken back {fmtWhen(a.revoked_at)} by {name(a.revoked_by)}</Badge>
                      : a.used_at ? <Badge variant="info" className="px-1.5 text-[10px]">Used {fmtWhen(a.used_at)} by {name(a.used_by)}</Badge>
                        : <Badge variant="warning" className="px-1.5 text-[10px]">Not used yet</Badge>}
                  </td>
                  {isSuperadmin && (
                    <td className={cn(WS_TD, 'border-r-0')}>
                      {!a.revoked_at && (
                        <Button size="sm" variant="outline" className={WS_BTN} disabled={busy === a.id} onClick={() => revoke(a)}
                          title={a.used_at ? 'Take it back: what was attached stays, marked manual. A new allowance can then be given.' : 'Take it back before it is used'}>
                          {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Take back
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No manual upload was allowed for {periodMonth}.{isSuperadmin ? ' Allow one from the return\'s row, with a reason, when a pull cannot be done.' : ''}</p>
      )}
    </SectionCard>
  );
};

export default FilingExceptionsPanel;
