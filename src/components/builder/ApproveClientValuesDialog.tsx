/**
 * Approve the values a client gave when disputing BU agreement values (the
 * firm, 20 Nov 2026). Each disputed unit shows the working's value, what has
 * already been taxed, the client's note and the value read from it (a number
 * the client typed, else the amount in the note), which staff may correct
 * before approving. Approving re-works the units at the approved value.
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ApproveRow {
  unitId: string;
  unitNo: string;
  workingValue: number;
  valueTaxed: number;
  clientValue: number | null;
  note: string | null;
}

const inr = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const parseAmount = (t: string): number | null => {
  const n = Number(String(t).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

export default function ApproveClientValuesDialog(props: {
  open: boolean;
  rows: ApproveRow[];
  busy: boolean;
  onClose: () => void;
  onApprove: (items: { unitId: string; value: number }[], reason: string) => void;
}) {
  const { open, rows, busy, onClose, onApprove } = props;
  const [values, setValues] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(rows.map((r) => [r.unitId, r.clientValue ? String(r.clientValue) : ''])));
    setPicked(new Set(rows.filter((r) => r.clientValue).map((r) => r.unitId)));
    setReason('');
  }, [open, rows]);

  const chosen = useMemo(() => rows.filter((r) => picked.has(r.unitId)), [rows, picked]);
  const bad = chosen.filter((r) => parseAmount(values[r.unitId] || '') === null);
  const totals = useMemo(() => chosen.reduce((t, r) => {
    const v = parseAmount(values[r.unitId] || '') || 0;
    return { working: t.working + r.workingValue, approved: t.approved + v };
  }, { working: 0, approved: 0 }), [chosen, values]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Approve client's values</DialogTitle>
          <DialogDescription>
            The working is re-done at the approved value and the unit is cleared for posting. A recorded
            dastavej value still prevails. Correct a value if the note was read wrongly.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2">
                  <Checkbox
                    checked={rows.length > 0 && picked.size === rows.length}
                    onCheckedChange={(c) => setPicked(c ? new Set(rows.map((r) => r.unitId)) : new Set())}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-2 py-2 text-left">Unit</th>
                <th className="px-2 py-2 text-left">Client's note</th>
                <th className="px-2 py-2 text-right">Working value</th>
                <th className="px-2 py-2 text-right">Already taxed</th>
                <th className="px-2 py-2 text-right">Value to approve</th>
                <th className="px-2 py-2 text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = parseAmount(values[r.unitId] || '');
                const atOrBelowTaxed = v !== null && v <= r.valueTaxed;
                return (
                  <tr key={r.unitId} className="border-t align-top">
                    <td className="px-2 py-2">
                      <Checkbox
                        checked={picked.has(r.unitId)}
                        onCheckedChange={(c) => setPicked((prev) => {
                          const next = new Set(prev);
                          if (c) next.add(r.unitId); else next.delete(r.unitId);
                          return next;
                        })}
                        aria-label={`Approve ${r.unitNo}`}
                      />
                    </td>
                    <td className="px-2 py-2 font-medium whitespace-nowrap">{r.unitNo}</td>
                    <td className="px-2 py-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{r.note || '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{inr(r.workingValue)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{inr(r.valueTaxed)}</td>
                    <td className="px-2 py-2 text-right">
                      <Input
                        inputMode="decimal"
                        className="ml-auto h-8 w-32 text-right tabular-nums"
                        value={values[r.unitId] ?? ''}
                        onChange={(e) => {
                          const t = e.target.value;
                          setValues((prev) => ({ ...prev, [r.unitId]: t }));
                          if (parseAmount(t) !== null) setPicked((prev) => new Set(prev).add(r.unitId));
                        }}
                        placeholder="Value"
                      />
                      {atOrBelowTaxed && (
                        <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-400">
                          {v === r.valueTaxed ? 'Equal to' : 'Below'} the value already taxed: no BU tax
                        </span>
                      )}
                    </td>
                    <td className={cn('px-2 py-2 text-right tabular-nums',
                      v !== null && v < r.workingValue ? 'text-emerald-700 dark:text-emerald-400' : '')}>
                      {v === null ? '—' : inr(v - r.workingValue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            {chosen.length} unit(s): working {inr(totals.working)} → approved {inr(totals.approved)}
          </span>
          <Input
            className="h-8 max-w-sm"
            placeholder="Note (optional), e.g. confirmed with client on call"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {bad.length > 0 && (
          <p className="text-xs text-destructive">Give a value for {bad.map((r) => r.unitNo).join(', ')}.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy || !chosen.length || bad.length > 0}
            onClick={() => onApprove(chosen.map((r) => ({ unitId: r.unitId, value: parseAmount(values[r.unitId] || '')! })), reason.trim())}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Approve {chosen.length} value(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
