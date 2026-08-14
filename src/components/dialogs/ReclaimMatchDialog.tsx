import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, AlertTriangle, Inbox } from 'lucide-react';

// Reclaiming ITC that was previously reversed (because the invoice wasn't in
// 2B at the time) requires evidence it's actually back — the same invoice
// reappearing in a later GSTR-2B. This dialog makes staff pick which specific
// invoice on the OTHER side matches, and blocks confirming unless every head
// (taxable value, IGST, CGST, SGST) is an exact match — so the same credit
// can never be counted twice (once as fresh ITC, once as a reclaim) and never
// reclaimed against evidence that doesn't actually support it.

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

const exactlyMatches = (a: ReclaimInvoiceLite, b: ReclaimInvoiceLite) => {
  const eq = (x: number, y: number) => Math.abs((x || 0) - (y || 0)) < 0.01;
  return eq(a.taxableValue, b.taxableValue) && eq(a.igst, b.igst) && eq(a.cgst, b.cgst) && eq(a.sgst, b.sgst);
};

const ReclaimMatchDialog: React.FC<Props> = ({
  open, onOpenChange, anchorLabel, anchor, candidates, candidateLabel, onConfirm,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const selected = useMemo(() => candidates.find((c) => c.id === selectedId) || null, [candidates, selectedId]);
  const matches = selected && anchor ? exactlyMatches(anchor, selected) : false;

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
            Pick the {candidateLabel} this invoice matches. Reclaim only posts when every amount matches exactly.
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
                  const doesMatch = anchor ? exactlyMatches(anchor, c) : false;
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
                        {doesMatch
                          ? <CheckCircle2 className="h-4 w-4 text-success inline" />
                          : <AlertTriangle className="h-4 w-4 text-warning inline" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ScrollArea>

        {selected && !matches && (
          <p className="text-xs text-warning flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Amounts don't match exactly — this can't be confirmed as a reclaim of the same invoice.
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
