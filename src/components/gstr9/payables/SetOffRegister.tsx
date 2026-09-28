import React, { useState } from 'react';
import { ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { METHOD_LABEL, SIDE_LABEL, type SetOff } from '@/lib/gstr9/payables';
import { removeSetOff } from '@/lib/gstr9/store';
import type { Tax } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { fmtWhen, sumTax } from '../overview/steps';
import { useWorkspace } from '../WorkspaceContext';

const HEADS: Array<[keyof Tax, string]> = [['i', 'IGST'], ['c', 'CGST'], ['s', 'SGST'], ['x', 'Cess']];

const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/** Every set-off of the year with its evidence; removed ones stay listed, struck through, with who and why. */
export const SetOffRegister: React.FC = () => {
  const { setOffs, isStaff, locked, canVerify, userName, reloadPayables } = useWorkspace();
  const [removing, setRemoving] = useState<SetOff | null>(null);
  const canRemove = isStaff && (!locked || canVerify);

  if (!setOffs.length) {
    return <p className="text-xs text-muted-foreground">No set-off recorded yet.</p>;
  }
  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[960px] border-collapse text-xs" aria-label="Set-off register">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="border-b px-2 py-1.5 text-left font-semibold">Payable</th>
              <th className="border-b px-2 py-1.5 text-left font-semibold">Set off by</th>
              <th className="border-b px-2 py-1.5 text-left font-semibold">Reference</th>
              {HEADS.map(([h, l]) => <th key={h} className="w-24 border-b px-2 py-1.5 text-right font-semibold">{l}</th>)}
              <th className="w-24 border-b px-2 py-1.5 text-right font-semibold">Total</th>
              <th className="border-b px-2 py-1.5 text-left font-semibold">Evidence</th>
              <th className="border-b px-2 py-1.5 text-left font-semibold">Recorded</th>
              {canRemove && <th className="w-10 border-b px-2 py-1.5"><span className="sr-only">Remove</span></th>}
            </tr>
          </thead>
          <tbody>
            {setOffs.map((o) => {
              const gone = !!o.deletedAt;
              return (
                <tr key={o.id} className={cn('align-top', gone && 'text-muted-foreground')}>
                  <td className={cn('border-b px-2 py-1.5', gone && 'line-through')}>{SIDE_LABEL[o.side]}</td>
                  <td className={cn('border-b px-2 py-1.5', gone && 'line-through')}>
                    {METHOD_LABEL[o.method]}
                    {o.method === 'drc03' && <div className="text-[11px] text-muted-foreground">{o.drc03Id ? 'synced from the portal' : 'imported — copy uploaded'}</div>}
                  </td>
                  <td className={cn('border-b px-2 py-1.5', gone && 'line-through')}>
                    {o.method === 'gstr3b' ? (
                      <>
                        <div>GSTR-3B {o.gstr3bPeriod} · {o.gstr3bTable}</div>
                        <div className="text-[11px] text-muted-foreground">Filed {fmtDate(o.docDate)}{o.reference ? ` · ${o.reference}` : ''}</div>
                      </>
                    ) : (
                      <>
                        <div className="font-mono">{o.reference ?? '—'}</div>
                        <div className="text-[11px] text-muted-foreground">{fmtDate(o.docDate)}</div>
                      </>
                    )}
                    {o.note && <div className="text-[11px] text-muted-foreground">“{o.note}”</div>}
                  </td>
                  {HEADS.map(([h]) => <td key={h} className={cn('border-b px-2 py-1.5 text-right tabular-nums', gone && 'line-through')}>{fmtMoney(o.tax[h])}</td>)}
                  <td className={cn('border-b px-2 py-1.5 text-right font-medium tabular-nums', gone && 'line-through')}>{fmtMoney(sumTax(o.tax))}</td>
                  <td className="border-b px-2 py-1.5">
                    {o.evidenceUrl ? (
                      <a href={o.evidenceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                        {o.evidenceName ? <span className="max-w-[10rem] truncate">{o.evidenceName}</span> : 'Copy'} <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : '—'}
                  </td>
                  <td className="border-b px-2 py-1.5">
                    <div>{o.createdBy ?? '—'}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtWhen(o.createdAt)}</div>
                    {gone && <div className="text-[11px] text-destructive-strong">Removed by {o.deletedBy ?? '—'}, {fmtWhen(o.deletedAt)} — “{o.deleteReason}”</div>}
                  </td>
                  {canRemove && (
                    <td className="border-b px-1 py-1 text-right">
                      {!gone && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRemoving(o)} aria-label={`Remove the ${METHOD_LABEL[o.method]} set-off of ${fmtMoney(sumTax(o.tax))}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <RemoveDialog
        target={removing}
        onClose={() => setRemoving(null)}
        onRemove={async (reason) => {
          if (!removing) return;
          await removeSetOff(removing.id, userName, reason);
          await reloadPayables();
          toast.success('Set-off removed. It stays in the register, struck through, with your reason.');
          setRemoving(null);
        }}
      />
    </>
  );
};

const RemoveDialog: React.FC<{ target: SetOff | null; onClose: () => void; onRemove: (reason: string) => Promise<void> }> = ({ target, onClose, onRemove }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); else setReason(''); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove this set-off?</DialogTitle>
          <DialogDescription>
            {target ? `${METHOD_LABEL[target.method]} ${target.reference ?? target.gstr3bPeriod ?? ''} — ${fmtMoney(sumTax(target.tax))}. ` : ''}
            The payable becomes outstanding again. The set-off is kept in the register, struck through, with your reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="rm-reason" className="text-xs">Reason (required)</Label>
          <Textarea id="rm-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recorded against the wrong side" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              try { await onRemove(reason.trim()); } catch (e) { toast.error(`Could not remove it: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
            }}
          >
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SetOffRegister;
