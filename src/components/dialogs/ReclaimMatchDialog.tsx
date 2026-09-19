import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, AlertTriangle, XCircle, Inbox } from 'lucide-react';

// Reclaiming ITC that was previously reversed (because the invoice wasn't in
// 2B at the time) requires evidence it's actually back — the same invoice
// reappearing in a later GSTR-2B. This dialog makes staff pick which specific
// invoice on the OTHER side matches, and blocks confirming unless every head
// (taxable value, IGST, CGST, SGST) agrees — so the same credit can never be
// counted twice (once as fresh ITC, once as a reclaim) and never reclaimed
// against evidence that doesn't actually support it.
//
// "Agrees" allows up to Rs.2 per head. The match used to be exact to the
// paisa, which sounds safe but wasn't workable: the supplier's GSTR-1 and the
// firm's books round independently — per-line vs per-invoice rounding, and the
// portal's own half-up rounding on each head — so the same invoice routinely
// comes back a rupee or two out. An exact test left staff unable to reclaim
// credit that was plainly, visibly the same invoice, with no way forward but
// Expense out (writing off real credit) or editing the books to fit.
//
// Rs.2 per head is deliberately small enough that it can only absorb rounding:
// it is a fixed rupee amount, not a percentage, so it does not widen with the
// invoice — a Rs.50 lakh invoice gets the same Rs.2 latitude as a Rs.500 one,
// and any genuine difference in rate, quantity or value clears it by orders of
// magnitude. Each head is tested on its own, so the slack cannot be pooled
// into a larger total. The UI still distinguishes an exact match from one
// leaning on the tolerance, and shows the actual difference, so nobody
// confirms a rounding allowance without seeing it.

export interface ReclaimInvoiceLite {
  id: string;
  date: string | null;
  supplierName: string | null;
  supplierInvoiceNumber: string | null;
  supplierGstin: string | null;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorLabel: string;
  anchor: ReclaimInvoiceLite | null;
  candidates: ReclaimInvoiceLite[];
  candidateLabel: string;
  onConfirm: (candidateId: string) => void | Promise<void>;
}

const num = (v: number) => (v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const isoToDisplay = (iso: string | null) => {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

// Rs.2 per head, inclusive. See the note at the top of the file for why this
// is a flat rupee figure rather than a percentage.
export const RECLAIM_ROUNDING_TOLERANCE = 2;

// Below this the two figures are the same number, just floating-point noise
// apart — that is an exact match, not a use of the tolerance.
const EXACT_EPSILON = 0.01;

type MatchVerdict = 'exact' | 'rounding' | 'mismatch';

const headDeltas = (a: ReclaimInvoiceLite, b: ReclaimInvoiceLite): number[] => [
  Math.abs((a.taxableValue || 0) - (b.taxableValue || 0)),
  Math.abs((a.igst || 0) - (b.igst || 0)),
  Math.abs((a.cgst || 0) - (b.cgst || 0)),
  Math.abs((a.sgst || 0) - (b.sgst || 0)),
];

const verdictFor = (a: ReclaimInvoiceLite, b: ReclaimInvoiceLite): MatchVerdict => {
  const deltas = headDeltas(a, b);
  if (deltas.every((d) => d < EXACT_EPSILON)) return 'exact';
  // Each head stands on its own — the slack is never pooled across heads.
  if (deltas.every((d) => d <= RECLAIM_ROUNDING_TOLERANCE + 1e-9)) return 'rounding';
  return 'mismatch';
};

const largestDelta = (a: ReclaimInvoiceLite, b: ReclaimInvoiceLite): number =>
  Math.max(...headDeltas(a, b));

const ReclaimMatchDialog: React.FC<Props> = ({
  open, onOpenChange, anchorLabel, anchor, candidates, candidateLabel, onConfirm,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const selected = useMemo(() => candidates.find((c) => c.id === selectedId) || null, [candidates, selectedId]);
  const verdict: MatchVerdict | null = selected && anchor ? verdictFor(anchor, selected) : null;
  const matches = verdict === 'exact' || verdict === 'rounding';

  const handleClose = (next: boolean) => {
    if (!next) setSelectedId(null);
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (!selected || !matches) return;
    setConfirming(true);
    try {
      await onConfirm(selected.id);
      setSelectedId(null);
      onOpenChange(false);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link &amp; Reclaim</DialogTitle>
          <DialogDescription>
            Pick the {candidateLabel} this invoice matches. Every amount must agree, within
            ₹{RECLAIM_ROUNDING_TOLERANCE} per head for rounding.
          </DialogDescription>
        </DialogHeader>

        {anchor && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
            <p className="font-medium text-foreground">{anchorLabel}</p>
            <p>{isoToDisplay(anchor.date)} · {anchor.supplierName} · {anchor.supplierInvoiceNumber} · <span className="font-mono">{anchor.supplierGstin}</span></p>
            <p className="tabular-nums">Taxable {num(anchor.taxableValue)} · IGST {num(anchor.igst)} · CGST {num(anchor.cgst)} · SGST {num(anchor.sgst)}</p>
          </div>
        )}

        <ScrollArea className="max-h-72 w-full">
          {candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Inbox className="h-6 w-6" />
              No {candidateLabel} to match against.
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/60">
                  <th className="border border-border p-2 w-8"></th>
                  <th className="border border-border p-2 text-left">Date</th>
                  <th className="border border-border p-2 text-left">Supplier / Invoice</th>
                  <th className="border border-border p-2 text-right">Taxable</th>
                  <th className="border border-border p-2 text-right">IGST</th>
                  <th className="border border-border p-2 text-right">CGST</th>
                  <th className="border border-border p-2 text-right">SGST</th>
                  <th className="border border-border p-2 text-center w-16">Match</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const isSelected = c.id === selectedId;
                  const rowVerdict = anchor ? verdictFor(anchor, c) : 'mismatch';
                  const rowDelta = anchor ? largestDelta(anchor, c) : 0;
                  return (
                    <tr
                      key={c.id}
                      className={`cursor-pointer ${isSelected ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <td className="border border-border p-2 text-center">
                        <input type="radio" checked={isSelected} onChange={() => setSelectedId(c.id)} aria-label={`Select ${c.supplierInvoiceNumber || 'row'}`} />
                      </td>
                      <td className="border border-border p-2 whitespace-nowrap tabular-nums">{isoToDisplay(c.date)}</td>
                      <td className="border border-border p-2">{c.supplierName} · {c.supplierInvoiceNumber}</td>
                      <td className="border border-border p-2 text-right tabular-nums">{num(c.taxableValue)}</td>
                      <td className="border border-border p-2 text-right tabular-nums">{num(c.igst)}</td>
                      <td className="border border-border p-2 text-right tabular-nums">{num(c.cgst)}</td>
                      <td className="border border-border p-2 text-right tabular-nums">{num(c.sgst)}</td>
                      <td className="border border-border p-2 text-center">
                        {rowVerdict === 'exact' && (
                          <CheckCircle2 className="h-4 w-4 text-success inline" aria-label="Exact match" />
                        )}
                        {rowVerdict === 'rounding' && (
                          <AlertTriangle
                            className="h-4 w-4 text-warning inline"
                            aria-label={`Within rounding tolerance — off by ₹${num(rowDelta)}`}
                          />
                        )}
                        {rowVerdict === 'mismatch' && (
                          <XCircle
                            className="h-4 w-4 text-destructive inline"
                            aria-label={`Does not match — off by ₹${num(rowDelta)}`}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ScrollArea>

        {selected && anchor && verdict === 'rounding' && (
          <p className="text-xs text-warning flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Off by ₹{num(largestDelta(anchor, selected))} at most — within the ₹{RECLAIM_ROUNDING_TOLERANCE}
            {' '}rounding tolerance, so this can be confirmed.
          </p>
        )}

        {selected && anchor && verdict === 'mismatch' && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            Off by ₹{num(largestDelta(anchor, selected))} — more than the ₹{RECLAIM_ROUNDING_TOLERANCE} allowed
            {' '}for rounding, so this can't be confirmed as a reclaim of the same invoice.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!selected || !matches || confirming}>
            {confirming ? 'Linking…' : 'Confirm Reclaim'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReclaimMatchDialog;
