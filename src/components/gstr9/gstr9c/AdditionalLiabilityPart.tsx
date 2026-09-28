import React, { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GSTR9C_PARTV_KEYS, Gstr9cPartVKey } from '@/lib/gstr9/types';
import { SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { RefStrip } from './bits';
import { FormGrid } from './FormGrid';
import { columnTotals, figs, FORM_HEADS, FormLine, headsText, TAX_HEADS, toRateRow, useGoToStep } from './formLines';

const PART_V_LABEL: Record<Gstr9cPartVKey, string> = {
  A: '5%',
  A1: '6%',
  B: '12%',
  C: '18%',
  D: '28%',
  D1: '40%',
  E: '3%',
  F: '0.25%',
  G: '0.10%',
  G1: 'Others %',
  G2: 'Supplies on which e-commerce operator is required to pay tax u/s 9(5)',
  H: 'Input tax credit',
  I: 'Interest',
  J: 'Late fee',
  K: 'Penalty',
  L: 'Any other amount paid for supplies not included in annual return (GSTR-9)',
  M: 'Erroneous refund to be paid back',
  N: 'Outstanding demands to be settled',
  O: 'Other',
};

/** Rows without a value column (amounts of tax only). */
const TAX_ONLY: Gstr9cPartVKey[] = ['H', 'I', 'J', 'K', 'M', 'N', 'O'];

/** Part V — additional liability due to non-reconciliation. */
const AdditionalLiabilityPart: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const go = useGoToStep();
  const C = docs.gstr9c;
  const A3 = workings.ann3;

  const lines = useMemo<FormLine[]>(
    () =>
      GSTR9C_PARTV_KEYS.map((k) => ({
        id: k,
        code: `V${k}`,
        label: PART_V_LABEL[k],
        mode: 'typed' as const,
        heads: TAX_ONLY.includes(k) ? TAX_HEADS : FORM_HEADS,
        stored: figs(C.partV?.[k]) ?? {},
        fKey: `partV.${k}`,
        write: (d, v) => ({ ...d, partV: { ...d.partV, [k]: toRateRow(v ?? {}) } }),
      })),
    [C.partV],
  );

  return (
    <SectionCard
      title="Part V · Additional liability due to non-reconciliation"
      description="What remains payable after the reconciliation — typed. The firm’s DRC-03 working (Annexure-3) is shown for reference."
      excelRef="9C utility PT V"
      actions={
        <Button type="button" size="sm" variant="outline" onClick={() => go('annexures')}>
          Annexure-3 <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      }
    >
      <RefStrip
        items={[
          { label: 'Annexure-3 payable', value: headsText(A3.payable) },
          { label: 'DRC-03 already paid', value: headsText(A3.alreadyPaid) },
          { label: 'Balance to pay', value: headsText(A3.balance) },
        ]}
      />
      <FormGrid
        label="GSTR-9C Part V"
        lines={lines}
        heads={FORM_HEADS}
        labelWidth={280}
        footer={[{ key: 'total', label: 'Total', tone: 'total', cells: columnTotals(lines, FORM_HEADS) }]}
      />
    </SectionCard>
  );
};

export default AdditionalLiabilityPart;
