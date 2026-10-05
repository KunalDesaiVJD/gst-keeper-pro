import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { val } from '@/lib/gstr9/engine';
import { useWorkspace } from '../WorkspaceContext';
import { MatrixRow, MatrixTable, Note, SectionCard } from '../ui';
import { landsIn } from './salesEntry';

const T5_LINES: Array<{ code: 'A' | 'B' | 'C' | 'C1' | 'D' | 'E' | 'F'; label: string }> = [
  { code: 'A', label: 'Zero rated supply (export) without payment of tax' },
  { code: 'B', label: 'Supply to SEZs without payment of tax' },
  { code: 'C', label: 'Tax payable by the recipient on reverse charge' },
  { code: 'C1', label: 'Tax payable by the e-commerce operator u/s 9(5)' },
  { code: 'D', label: 'Exempted' },
  { code: 'E', label: 'Nil rated' },
  { code: 'F', label: 'Non-GST supply (includes no supply)' },
];

const LedgerNames: React.FC<{ names: string[] }> = ({ names }) => {
  if (!names.length) return null;
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` +${names.length - 3} more` : '';
  return (
    <span className="text-[11px] text-muted-foreground" title={names.join(', ')}>
      {shown}
      {more}
    </span>
  );
};

/** GSTR-9 Table 5 as it will be filled from Part B (books), so staff see where each row lands. */
const Table5Preview: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const t5 = workings.g9.t5;
  const notIn = workings.sales.partBByNature.not_in_gstr9;

  // Ledger names per Table 5 row (display only; the figures are the engine's).
  const names = useMemo(() => {
    const out: Record<string, string[]> = {};
    docs.sales.partB.forEach((r, i) => {
      const code = landsIn(r).code;
      if (!out[code]) out[code] = [];
      out[code].push((r.ledger || '').trim() || `Row ${i + 1}`);
    });
    return out;
  }, [docs.sales.partB]);

  const rows: MatrixRow[] = [
    ...T5_LINES.map<MatrixRow>((l) => ({
      key: l.code,
      code: `5${l.code}`,
      label: l.label,
      value: t5[l.code],
      note: <LedgerNames names={names[`5${l.code}`] ?? []} />,
    })),
    { key: 'G', code: '5G', label: 'Sub-total (A to F)', value: t5.G, total: true },
    {
      key: 'H',
      code: '5H',
      label: 'Credit notes on A to F (−)',
      value: t5.H,
      note: <LedgerNames names={names['5H'] ?? []} />,
    },
  ];
  if (names['—']?.length) {
    rows.push({
      key: 'not',
      code: '—',
      label: 'Not reportable in GSTR-9 (audit-report total only)',
      value: val(notIn.pos + notIn.neg),
      note: <LedgerNames names={names['—']} />,
    });
  }

  const openGstr9 = () => {
    const next = new URLSearchParams(params);
    next.set('step', 'gstr9');
    setParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <SectionCard
      title="GSTR-9 Table 5 from Part B"
      description="Where each non-taxable ledger lands in the annual return."
      excelRef="GSTR-9 F24:F32"
      actions={
        <Button type="button" size="sm" variant="ghost" onClick={openGstr9}>
          Open GSTR-9 <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      }
    >
      <MatrixTable label="GSTR-9 Table 5 (books)" rows={rows} heads={['t']} headLabels={{ t: 'Value (books)' }} />
      <Note tone="position">
        Part B natures cover every Table 5 row (5A, 5B, 5C, 5C1, 5D, 5E, 5F, or not reportable) and negative rows go to 5H. The
        sheet picks Part B rows by position (5A = D41, 5B = D43, 5F = D44:D48, 5H = −D42).
      </Note>
    </SectionCard>
  );
};

export default Table5Preview;
