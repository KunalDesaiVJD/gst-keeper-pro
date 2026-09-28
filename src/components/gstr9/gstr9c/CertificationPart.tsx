import React, { useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loadPreviousYear } from '@/lib/gstr9/store';
import type { Gstr9cDoc } from '@/lib/gstr9/types';
import { SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';

type CertKey = keyof Gstr9cDoc['certification'];

interface FieldDef {
  key: CertKey;
  label: string;
  type?: 'text' | 'date';
  inputMode?: 'numeric' | 'text';
  maxLength?: number;
  upper?: boolean;
  wide?: boolean;
  check?: (v: string) => string | null;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const SIGNATORY: FieldDef[] = [
  { key: 'signatory_name', label: 'Name of the signatory', wide: true },
  { key: 'membership_no', label: 'Membership no.' },
  { key: 'place', label: 'Place' },
  { key: 'signature_date', label: 'Date', type: 'date' },
  {
    key: 'pan',
    label: 'PAN (for the digital signature)',
    upper: true,
    maxLength: 10,
    check: (v) => (v && !PAN_RE.test(v) ? 'A PAN is 5 letters, 4 digits and a letter (e.g. ABCDE1234F).' : null),
  },
];

const ADDRESS: FieldDef[] = [
  { key: 'building_no', label: 'Building no. / flat no.' },
  { key: 'floor_number', label: 'Floor number' },
  { key: 'premises_name', label: 'Name of the premises / building', wide: true },
  { key: 'road_street', label: 'Road / street', wide: true },
  { key: 'city_town_locality', label: 'City / town / locality / village' },
  { key: 'district', label: 'District' },
  { key: 'state', label: 'State' },
  {
    key: 'pin_code',
    label: 'PIN code',
    inputMode: 'numeric',
    maxLength: 6,
    check: (v) => (v && !/^[1-9][0-9]{5}$/.test(v) ? 'A PIN code is 6 digits.' : null),
  },
];

const CARRY_KEYS: CertKey[] = [...SIGNATORY, ...ADDRESS].map((f) => f.key).filter((k) => k !== 'signature_date');

const Field: React.FC<{ def: FieldDef }> = ({ def }) => {
  const { docs, update, readOnly } = useWorkspace();
  const value = docs.gstr9c.certification?.[def.key] ?? '';
  const id = `gstr9c-cert-${def.key}`;
  const problem = def.check?.(value) ?? null;
  return (
    <div className={cn('space-y-1', def.wide && 'sm:col-span-2')}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {def.label}
      </Label>
      <Input
        id={id}
        className="h-9"
        type={def.type ?? 'text'}
        inputMode={def.inputMode}
        maxLength={def.maxLength}
        value={value}
        disabled={readOnly}
        aria-invalid={!!problem}
        onChange={(e) => {
          const v = def.upper ? e.target.value.toUpperCase() : e.target.value;
          update('gstr9c', (d) => ({ ...d, certification: { ...d.certification, [def.key]: v } }));
        }}
      />
      {problem && <p className="text-[11px] text-destructive-strong">{problem}</p>}
    </div>
  );
};

/** Verification — signatory and address, as the 9C offline utility asks for them. */
const CertificationPart: React.FC = () => {
  const { client, financialYear, docs, update, readOnly } = useWorkspace();
  const confirm = useConfirm();
  const [copying, setCopying] = useState(false);
  const prevFY = (() => {
    const start = Number(financialYear.slice(0, 4)) - 1;
    return `${start}-${String(start + 1).slice(-2)}`;
  })();

  const copyFromPrevious = async () => {
    setCopying(true);
    try {
      const prev = await loadPreviousYear(client.id, financialYear);
      const src = prev?.docs.gstr9c.certification;
      if (!src || !CARRY_KEYS.some((k) => (src[k] ?? '').trim())) {
        toast.info(`No certification details were saved for FY ${prevFY}.`);
        return;
      }
      const cur = docs.gstr9c.certification;
      const filled = CARRY_KEYS.some((k) => (cur?.[k] ?? '').trim());
      if (
        filled &&
        !(await confirm({
          title: `Copy FY ${prevFY} certification details?`,
          description: 'The signatory and address fields already filled in here will be replaced. The date is left as it is.',
          confirmText: 'Replace',
        }))
      ) {
        return;
      }
      update('gstr9c', (d) => {
        const next = { ...d.certification };
        CARRY_KEYS.forEach((k) => { next[k] = src[k] ?? ''; });
        return { ...d, certification: next };
      });
      toast.success(`Copied the signatory and address from FY ${prevFY}. Check the date and place.`);
    } catch (e) {
      toast.error('Could not load the previous year: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCopying(false);
    }
  };

  return (
    <SectionCard
      title="Verification"
      description="“I hereby solemnly affirm and declare that the information given herein above is true and correct to the best of my knowledge and belief and nothing has been concealed therefrom.”"
      excelRef="9C utility PT V (certification)"
      actions={
        !readOnly && (
          <Button type="button" size="sm" variant="outline" onClick={copyFromPrevious} disabled={copying}>
            {copying ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <History className="mr-1 h-3.5 w-3.5" />}
            Copy from FY {prevFY}
          </Button>
        )
      }
    >
      <div className="max-w-3xl space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Signatory</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SIGNATORY.map((f) => <Field key={f.key} def={f} />)}
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Address</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ADDRESS.map((f) => <Field key={f.key} def={f} />)}
          </div>
        </fieldset>
      </div>
    </SectionCard>
  );
};

export default CertificationPart;
