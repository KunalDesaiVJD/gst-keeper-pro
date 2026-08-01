/**
 * Set the opening position for many units in one sitting.
 *
 * Opening balance is a one-time onboarding job: the day this software takes
 * over from the client's earlier records, every unit already mid-flight needs
 * a starting figure. Doing that unit by unit — open, type six numbers, close,
 * repeat — is the "very difficult to enter" complaint this replaces. Here the
 * as-at date is set once for the whole batch (it is, after all, one moment:
 * the day the project was onboarded), and only "Agreement value" is required
 * per row — a unit with nothing typed into it is left alone, not zeroed.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, Wallet } from 'lucide-react';
import { formatINR, type BuilderRateCode } from '@/utils/builderRates';

export interface BulkOpeningUnit {
  unitId: string;
  unitNo: string;
  rateCode: BuilderRateCode;
  ratePct: number;
  isAffordable: boolean;
  /** The unit's derived gross consideration, used to prefill Agreement value when nothing is on file yet. */
  defaultAgreementValue: number;
  existing?: {
    as_at_date: string;
    agreement_value: number;
    cumulative_receipts: number;
    cumulative_value_taxed: number;
    cumulative_cgst: number;
    cumulative_sgst: number;
    cumulative_tds_194ia: number;
  };
}

interface RowForm {
  agreement_value: string;
  cumulative_receipts: string;
  cumulative_value_taxed: string;
  cumulative_cgst: string;
  cumulative_sgst: string;
  cumulative_tds_194ia: string;
}

const toRowForm = (u: BulkOpeningUnit): RowForm => (u.existing ? {
  agreement_value: String(u.existing.agreement_value ?? ''),
  cumulative_receipts: String(u.existing.cumulative_receipts ?? ''),
  cumulative_value_taxed: String(u.existing.cumulative_value_taxed ?? ''),
  cumulative_cgst: String(u.existing.cumulative_cgst ?? ''),
  cumulative_sgst: String(u.existing.cumulative_sgst ?? ''),
  cumulative_tds_194ia: String(u.existing.cumulative_tds_194ia ?? ''),
} : {
  agreement_value: '',
  cumulative_receipts: '',
  cumulative_value_taxed: '',
  cumulative_cgst: '',
  cumulative_sgst: '',
  cumulative_tds_194ia: '',
});

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  units: BulkOpeningUnit[];
  defaultAsAtDate: string | null;
  onSaved: () => void | Promise<void>;
}

const BulkOpeningBalancesDialog: React.FC<Props> = ({
  open, onOpenChange, units, defaultAsAtDate, onSaved,
}) => {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [asAtDate, setAsAtDate] = useState('');
  const [rows, setRows] = useState<Record<string, RowForm>>({});

  useEffect(() => {
    if (!open) return;
    setAsAtDate(defaultAsAtDate || units.find((u) => u.existing)?.existing?.as_at_date || '');
    const next: Record<string, RowForm> = {};
    units.forEach((u) => { next[u.unitId] = toRowForm(u); });
    setRows(next);
  }, [open, units, defaultAsAtDate]);

  const setField = (unitId: string, field: keyof RowForm, value: string) => {
    setRows((prev) => ({ ...prev, [unitId]: { ...prev[unitId], [field]: value } }));
  };

  const active = units
    .map((u) => ({ u, form: rows[u.unitId] }))
    .filter((r) => r.form && (parseFloat(r.form.agreement_value) || 0) > 0);

  const totals = active.reduce((t, r) => ({
    agreement: t.agreement + (parseFloat(r.form.agreement_value) || 0),
    taxed: t.taxed + (parseFloat(r.form.cumulative_value_taxed) || 0),
    cgst: t.cgst + (parseFloat(r.form.cumulative_cgst) || 0),
    sgst: t.sgst + (parseFloat(r.form.cumulative_sgst) || 0),
  }), { agreement: 0, taxed: 0, cgst: 0, sgst: 0 });

  const handleSave = async () => {
    if (!asAtDate) { toast.error('As-at date is required'); return; }
    if (!active.length) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('builder_opening_balances').upsert(
        active.map(({ u, form }) => ({
          unit_id: u.unitId,
          as_at_date: asAtDate,
          agreement_value: parseFloat(form.agreement_value) || 0,
          cumulative_receipts: parseFloat(form.cumulative_receipts) || 0,
          cumulative_value_taxed: parseFloat(form.cumulative_value_taxed) || 0,
          cumulative_cgst: parseFloat(form.cumulative_cgst) || 0,
          cumulative_sgst: parseFloat(form.cumulative_sgst) || 0,
          cumulative_tds_194ia: parseFloat(form.cumulative_tds_194ia) || 0,
          is_affordable_at_opening: u.isAffordable,
          rate_code_at_opening: u.rateCode,
          updated_by: user?.id ?? null,
        })),
        { onConflict: 'unit_id' },
      );
      if (error) throw error;
      toast.success(`Opening balance set for ${active.length} unit${active.length === 1 ? '' : 's'}.`);
      onOpenChange(false);
      await onSaved();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Opening balances — all units
          </DialogTitle>
          <DialogDescription>
            One as-at date for the whole project — the day it was onboarded into this software. Only rows
            with an agreement value are saved, so a unit left blank is not touched. "Value already taxed" is
            the base the BU differential deducts from — enter what was offered to tax, not what was received.
          </DialogDescription>
        </DialogHeader>

        <div className="max-w-xs">
          <Label className="mb-1.5 block text-xs">As at date *</Label>
          <Input type="date" value={asAtDate} onChange={(e) => setAsAtDate(e.target.value)} />
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead className="w-36 text-right">Agreement value</TableHead>
                <TableHead className="w-36 text-right">Value taxed</TableHead>
                <TableHead className="w-32 text-right">CGST</TableHead>
                <TableHead className="w-32 text-right">SGST</TableHead>
                <TableHead className="w-32 text-right">Receipts (memo)</TableHead>
                <TableHead className="w-32 text-right">TDS to date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((u) => {
                const form = rows[u.unitId] || toRowForm(u);
                const isActive = (parseFloat(form.agreement_value) || 0) > 0;
                return (
                  <TableRow key={u.unitId} className={isActive ? 'bg-primary/5' : undefined}>
                    <TableCell className="font-medium">
                      {u.unitNo}
                      {u.existing && <span className="block text-xs text-muted-foreground">on file</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{u.ratePct}%</Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal" className="h-8 text-right tabular-nums"
                        value={form.agreement_value}
                        onChange={(e) => setField(u.unitId, 'agreement_value', e.target.value)}
                        placeholder={u.defaultAgreementValue ? formatINR(u.defaultAgreementValue) : '—'}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal" className="h-8 text-right tabular-nums"
                        value={form.cumulative_value_taxed}
                        onChange={(e) => setField(u.unitId, 'cumulative_value_taxed', e.target.value)}
                        placeholder="—"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal" className="h-8 text-right tabular-nums"
                        value={form.cumulative_cgst}
                        onChange={(e) => setField(u.unitId, 'cumulative_cgst', e.target.value)}
                        placeholder="—"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal" className="h-8 text-right tabular-nums"
                        value={form.cumulative_sgst}
                        onChange={(e) => setField(u.unitId, 'cumulative_sgst', e.target.value)}
                        placeholder="—"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal" className="h-8 text-right tabular-nums"
                        value={form.cumulative_receipts}
                        onChange={(e) => setField(u.unitId, 'cumulative_receipts', e.target.value)}
                        placeholder="—"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal" className="h-8 text-right tabular-nums"
                        value={form.cumulative_tds_194ia}
                        onChange={(e) => setField(u.unitId, 'cumulative_tds_194ia', e.target.value)}
                        placeholder="—"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-semibold">
                  {active.length} of {units.length} units
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.agreement)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.taxed)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.cgst)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.sgst)}</TableCell>
                <TableCell />
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving || !active.length || !asAtDate}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save {active.length || ''} opening balance{active.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkOpeningBalancesDialog;
