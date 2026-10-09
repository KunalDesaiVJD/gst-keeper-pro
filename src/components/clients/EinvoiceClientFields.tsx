import React from 'react';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EINVOICE_EXEMPTIONS } from '@/lib/einvoice/threshold';

const NONE = '__none__';

/**
 * The client form's e-invoice fields (Add Client and Edit Client):
 * "E-invoice applicable" tick and the exempt class. Choosing an exemption
 * unticks and locks the tick — an exempt client is never an e-invoice client,
 * and is left out of the threshold alerts.
 */
export const EinvoiceClientFields: React.FC<{
  applicable: boolean;
  exemption: string;
  onChange: (next: { applicable: boolean; exemption: string }) => void;
}> = ({ applicable, exemption, onChange }) => {
  const exempt = !!exemption;
  return (
    <>
      <div className="space-y-2">
        <Label>E-invoicing</Label>
        <label
          htmlFor="einvoiceApplicable"
          className={`flex items-start gap-2 p-3 border rounded-lg transition-colors ${
            exempt ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
          } ${applicable && !exempt ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
        >
          <Checkbox
            id="einvoiceApplicable"
            checked={applicable && !exempt}
            disabled={exempt}
            onCheckedChange={(v) => onChange({ applicable: v === true, exemption })}
            className="mt-0.5"
          />
          <div>
            <span className="text-sm font-normal block">E-invoice applicable (IRN on B2B invoices, notes and exports)</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {exempt
                ? 'Not available — this client is in an exempt class (see the next field).'
                : 'Tick when this client must generate IRNs. Clients approaching or above the ₹5 crore turnover limit are flagged on the Clients page and emailed.'}
            </p>
          </div>
        </label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="einvoiceExemption">Exempt from e-invoicing</Label>
        <Select
          value={exemption || NONE}
          onValueChange={(v) => {
            const next = v === NONE ? '' : v;
            onChange({ applicable: next ? false : applicable, exemption: next });
          }}
        >
          <SelectTrigger id="einvoiceExemption">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {EINVOICE_EXEMPTIONS.map((e) => (
              <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Classes not required to e-invoice whatever their turnover (e.g. transporters / GTA). Exempt clients get no threshold alerts.
        </p>
      </div>
    </>
  );
};

export default EinvoiceClientFields;
