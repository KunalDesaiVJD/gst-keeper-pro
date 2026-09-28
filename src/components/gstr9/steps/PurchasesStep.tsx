import React, { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calculator, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { maxAbs, totalTax, type StepKey } from '@/lib/gstr9/engine';
import { ExportMenu } from '../ExportMenu';
import { fmtMoney } from '../grid/money';
import { KpiTile, Note, OpenDifferences, useDiffLine } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { HeadLanding } from '../purchases/HeadLanding';
import { PurchaseSectionGrid } from '../purchases/PurchaseSectionGrid';
import { PurchasesSummary } from '../purchases/PurchasesSummary';
import { fillFromRate, rateFlag, SECTION_META, SECTIONS } from '../purchases/purchaseRows';

const HEAD_NAMES = { i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess' } as const;

/**
 * Step 3 — Purchases & ITC (P&L): the firm's PL-INPUT sheet. Three ledger
 * grids (purchase, expense, capital goods) tagged to the GSTR-9C expense
 * heads, then rows 71–81 (net ITC for the year against Duties & Taxes).
 */
const PurchasesStep: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const p = workings.purchases;
  const rows = docs.purchases.rows;
  const diffLine = useDiffLine('purchases.dt');

  const go = useCallback(
    (key: StepKey) => {
      const next = new URLSearchParams(params);
      next.set('step', key);
      setParams(next);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [params, setParams],
  );

  const flagged = useMemo(
    () => rows.map((r) => ({ r, f: rateFlag(r, p.rows[r.id]) })).filter((x) => x.f !== null),
    [rows, p.rows],
  );
  const fillable = useMemo(() => rows.filter((r) => fillFromRate(r) !== r).length, [rows]);

  const fillTax = () => {
    if (!fillable) {
      toast.info('No ledger has a rate with blank tax — nothing to fill.');
      return;
    }
    update('purchases', (d) => ({ ...d, rows: d.rows.map(fillFromRate) }));
    toast.success(`Filled tax from the rate on ${fillable} ledger${fillable === 1 ? '' : 's'}.`);
  };

  const diff = p.diffVsDt;
  const diffMag = maxAbs(diff);
  const diffHint =
    (['i', 'c', 's', 'x'] as const)
      .filter((h) => Math.abs(diff[h]) >= 0.005)
      .map((h) => `${HEAD_NAMES[h]} ${fmtMoney(diff[h])}`)
      .join(' · ') || 'All heads match';
  const diffTone: 'ok' | 'error' | 'warn' | 'neutral' = diffMag < 0.005 ? 'ok' : diffLine?.open ? 'error' : 'neutral';

  const empty = rows.length === 0;

  return (
    <div className="space-y-4">
      <OpenDifferences step="purchases" />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile label="ITC as per P&L (row 71)" value={fmtMoney(totalTax(p.totalPl))} hint={`${rows.length} ledger${rows.length === 1 ? '' : 's'} · value ${fmtMoney(p.totalPl.t)}`} />
        <KpiTile label="Net ITC for the year (row 79)" value={fmtMoney(totalTax(p.netItc))} hint="After suspended ITC and RCM" />
        <KpiTile label="As per Duties & Taxes (row 80)" value={fmtMoney(totalTax(p.dtNet))} hint="Net, after last-year effect" />
        <KpiTile label="Difference P&L − D&T (row 81)" value={fmtMoney(totalTax(diff))} hint={diffHint} tone={diffTone} />
        <KpiTile
          label="Rate checks"
          value={flagged.length}
          hint={flagged.length ? 'Implied rate ≠ GST rate' : rows.length ? 'Every implied rate is a GST rate' : 'No ledgers yet'}
          tone={flagged.length ? 'warn' : rows.length ? 'ok' : 'neutral'}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Paste each section straight from PL-INPUT, columns C–H (Head in books → Rate). SGST mirrors CGST until you type over it; tax is
          filled from the rate where a row has none.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && !empty && (
            <Button type="button" variant="outline" size="sm" onClick={fillTax} disabled={!fillable} title="Fill IGST (inter-state) or CGST/SGST (intra-state) from the rate, only on ledgers with no tax typed">
              <Calculator className="mr-1 h-3.5 w-3.5" /> Fill tax from rate{fillable ? ` (${fillable})` : ''}
            </Button>
          )}
          <ExportMenu only={['excel']} />
        </div>
      </div>

      {empty && (
        <Note>
          <span className="inline-flex items-center gap-1 font-medium">
            <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" /> Start by pasting from the PL-INPUT sheet.
          </span>{' '}
          For each section, copy columns C–H (Head in books, Taxable value, IGST, CGST, SGST, Rate) of its rows in the sheet —{' '}
          {SECTIONS.map((s) => `${SECTION_META[s].letter}: ${SECTION_META[s].sheetRows}`).join(', ')} — then click inside the matching grid
          below and press Ctrl+V. Rows are added as needed; totals and the net ITC fill in as you go.
        </Note>
      )}

      {flagged.length > 0 && (
        <Note tone="warn">
          <span className="font-medium">
            {flagged.length} ledger{flagged.length === 1 ? '' : 's'} where tax is not the GST rate on the value
          </span>{' '}
          — usually a partial or blocked credit, or a ledger mixing rates:{' '}
          {flagged.slice(0, 3).map((x, i) => (
            <React.Fragment key={x.r.id}>
              {i > 0 && '; '}
              <span className="font-medium">{x.r.ledger || '(no name)'}</span>
              {p.rows[x.r.id]?.impliedRate !== null && p.rows[x.r.id]?.impliedRate !== undefined && ` at ${p.rows[x.r.id]!.impliedRate}%`}
            </React.Fragment>
          ))}
          {flagged.length > 3 && `; and ${flagged.length - 3} more`}. Hover the highlighted cell for detail.
        </Note>
      )}

      {SECTIONS.map((s) => (
        <PurchaseSectionGrid key={s} section={s} />
      ))}

      <PurchasesSummary onGo={go} />

      <HeadLanding onGo={go} />
    </div>
  );
};

export default PurchasesStep;
