import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { GST_STATE_CODES } from '@/utils/gstr1ManualBuild';
import { taxForRate, type AdvanceReceipt, type SupplyNature } from '@/lib/advanceRegister';
import type { ContractProject } from '@/lib/contractProjects';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ReceiptFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Client's own state code — decides intra vs inter from the POS. */
  homeState: string;
  periodMonth: string;
  /**
   * Contractor projects, where the client has any. A contractor's advance is
   * recovered per project, so a receipt that isn't linked to one can never
   * appear in that project's recovery schedule — which is exactly how the
   * working paper came to report zeros.
   */
  projects?: ContractProject[];
  existing?: AdvanceReceipt | null;
  onSave: (values: Partial<AdvanceReceipt>) => Promise<void>;
}

export const ReceiptFormDialog: React.FC<ReceiptFormDialogProps> = ({
  open, onOpenChange, homeState, periodMonth, projects = [], existing, onSave,
}) => {
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    receipt_no: '', receipt_date: '', party_gstin: '', party_name: '',
    pos: homeState, rate_pct: '18', gross_amount: '', supply_nature: 'SERVICE' as SupplyNature,
    notes: '', project_id: '',
  });

  useEffect(() => {
    if (!open) return;
    setF({
      receipt_no: existing?.receipt_no || '',
      receipt_date: existing?.receipt_date || '',
      party_gstin: existing?.party_gstin || '',
      party_name: existing?.party_name || '',
      pos: existing?.pos || homeState,
      rate_pct: String(existing?.rate_pct ?? 18),
      gross_amount: existing ? String(existing.gross_amount) : '',
      supply_nature: (existing?.supply_nature as SupplyNature) || 'SERVICE',
      notes: existing?.notes || '',
      // A single-project client shouldn't have to pick every time.
      project_id: existing?.project_id || (projects.length === 1 ? projects[0].id : ''),
    });
  }, [open, existing, homeState, projects]);

  const selectedProject = projects.find((p) => p.id === f.project_id) || null;
  const rate = Number(f.rate_pct) || 0;
  const gross = Number(f.gross_amount) || 0;
  const splyTy = f.pos && homeState && f.pos === homeState ? 'INTRA' : 'INTER';
  // An advance is received INCLUSIVE of tax, so the value offered to tax is
  // the receipt grossed down — entering the receipt and having staff compute
  // the taxable value by hand is where arithmetic errors get in.
  const taxable = rate > 0 ? r2(gross / (1 + rate / 100)) : gross;
  const tax = taxForRate(taxable, rate, splyTy);
  const isGoods = f.supply_nature === 'GOODS';

  const valid = !!f.receipt_date && !!f.pos && gross > 0;

  const submit = async () => {
    if (!valid || (projects.length > 0 && !f.project_id)) {
      if (projects.length > 0 && !f.project_id) toast.error('Choose the project this advance belongs to.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...(existing?.id ? { id: existing.id } : {}),
        receipt_no: f.receipt_no.trim(),
        receipt_date: f.receipt_date,
        period_month: existing?.period_month || periodMonth,
        party_gstin: f.party_gstin.trim().toUpperCase(),
        party_name: f.party_name.trim(),
        project_id: f.project_id || null,
        pos: f.pos,
        rate_pct: rate,
        sply_ty: splyTy,
        gross_amount: gross,
        // A goods advance carries no Table 11A liability (Notf. 66/2017), so
        // it is stored with zero taxable value and tax — a memo row, not a
        // liability. Recording it still matters: it stops a later invoice
        // being 11B-adjusted against an advance that was never taxed.
        taxable_value: isGoods ? 0 : taxable,
        igst: isGoods ? 0 : tax.igst,
        cgst: isGoods ? 0 : tax.cgst,
        sgst: isGoods ? 0 : tax.sgst,
        cess: 0,
        supply_nature: f.supply_nature,
        notes: f.notes.trim(),
      });
      onOpenChange(false);
    } catch {
      // onSave has already reported the reason; keep the dialog open with the
      // operator's entry intact rather than letting this become an unhandled
      // rejection.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit receipt voucher' : 'Add receipt voucher'}</DialogTitle>
          <DialogDescription>
            The Table 11A leg. Period {existing?.period_month || periodMonth}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Receipt no.</Label>
            <Input value={f.receipt_no} onChange={(e) => setF({ ...f, receipt_no: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Receipt date *</Label>
            <Input type="date" value={f.receipt_date} onChange={(e) => setF({ ...f, receipt_date: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Party GSTIN</Label>
            <Input value={f.party_gstin} onChange={(e) => setF({ ...f, party_gstin: e.target.value })} placeholder="Blank for unregistered" />
          </div>
          <div>
            <Label className="text-xs">Party name</Label>
            <Input value={f.party_name} onChange={(e) => setF({ ...f, party_name: e.target.value })} />
          </div>
          {projects.length > 0 && (
            <div className="col-span-2">
              <Label className="text-xs">Project *</Label>
              <Select
                value={f.project_id}
                onValueChange={(v) => {
                  // Inherit the project's place of supply and rate — for a
                  // works contract POS is the property's location (s.12(3)),
                  // not the client's own state.
                  const proj = projects.find((p) => p.id === v);
                  setF({
                    ...f,
                    project_id: v,
                    ...(proj ? { pos: proj.pos_state, rate_pct: String(proj.rate_pct) } : {}),
                  });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select the project this advance belongs to" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProject && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Place of supply {selectedProject.pos_state} taken from the project.
                </p>
              )}
            </div>
          )}
          <div>
            <Label className="text-xs">Place of supply *</Label>
            <Select value={f.pos} onValueChange={(v) => setF({ ...f, pos: v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {GST_STATE_CODES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Rate %</Label>
            <Input type="number" value={f.rate_pct} onChange={(e) => setF({ ...f, rate_pct: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Amount received (incl. tax) *</Label>
            <Input type="number" value={f.gross_amount} onChange={(e) => setF({ ...f, gross_amount: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Supply is of</Label>
            <Select value={f.supply_nature} onValueChange={(v) => setF({ ...f, supply_nature: v as SupplyNature })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SERVICE">Service — taxable on receipt</SelectItem>
                <SelectItem value="GOODS">Goods — not taxable on receipt</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
          {isGoods ? (
            <p className="flex items-start gap-2 text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              An advance against a supply of <strong>goods</strong> is not taxable on receipt
              (Notification 66/2017-CT) — tax falls due at the invoice. This is recorded as a memo with no
              Table 11A liability, so a later invoice is not set off against it by mistake.
            </p>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">Taxable value (grossed down)</span><span className="tabular-nums font-semibold">₹{taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{splyTy === 'INTRA' ? 'CGST + SGST' : 'IGST'}</span><span className="tabular-nums font-semibold">₹{(tax.igst + tax.cgst + tax.sgst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Supply type</span><span>{splyTy === 'INTRA' ? 'Intra-state' : 'Inter-state'}</span></div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {existing ? 'Save changes' : 'Add receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiptFormDialog;
