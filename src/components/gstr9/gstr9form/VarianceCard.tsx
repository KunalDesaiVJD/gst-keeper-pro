import React, { useState } from 'react';
import { ChevronDown, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import {
  cellLabel, inr, remarksForCell, rulesSummary, VARIANCE_CELL_CLASS, VARIANCE_COL_LABEL,
  type VarianceRemark, type VarianceSummary, type VarianceTable,
} from '@/lib/gstr9/variance';
import { summariseWithAi } from '@/lib/gstr9/varianceSummaryApi';
import { FigLink } from '../figure/FigLink';
import { useWorkspace } from '../WorkspaceContext';
import { gstr9FormRow } from './sourceTargets2';
import { useVariance } from './useVariance';

/**
 * Under each GSTR-9 table that has them (Kunal, 26 Nov 2026: "default
 * compressed view, shown in the relevant clause only"): the figures of that
 * table that differ from the portal's system-computed GSTR-9, folded to one
 * line until opened, with the remarks that bear on each and that table's part
 * of the summary (GST Assistant, else the rules). The summary covers every
 * table and is kept once on the working (docs.gstr9.varianceSummary), printed
 * on D1. §12 of docs/GSTR9_9C_WORKINGS.md.
 */

const KIND_LABEL: Record<VarianceRemark['kind'], string> = { reason: 'Reason', gstr9c: 'GSTR-9C', selfcheck: 'Self-check' };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

const fmtAt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const RemarkList: React.FC<{ items: VarianceRemark[] }> = ({ items }) => {
  if (!items.length) return <span className="text-xs font-medium text-destructive-strong">No remark</span>;
  return (
    <ul className="space-y-1">
      {items.slice(0, 4).map((r) => (
        <li key={r.id} className="text-xs leading-snug" title={`${r.label}\n${r.text}${r.effect ? `\nEffect: ${r.effect}` : ''}`}>
          <Badge variant="outline" className="mr-1 px-1 py-0 text-[10px] font-normal">{KIND_LABEL[r.kind]}</Badge>
          <span className="text-muted-foreground">{clip(r.label, 70)}: </span>
          <span>{clip(r.text, 160)}</span>
          {r.effect && <span className="block text-[11px] text-muted-foreground">Effect: {r.effect}</span>}
        </li>
      ))}
      {items.length > 4 && <li className="text-[11px] text-muted-foreground">and {items.length - 4} more</li>}
    </ul>
  );
};

const SummaryView: React.FC<{ s: VarianceSummary; stale: boolean; table: VarianceTable; ids: Set<string> }> = ({ s, stale, table, ids }) => {
  const mine = s.tables.filter((t) => t.table === table);
  const unexplained = s.unexplained.filter((u) => ids.has(u.id));
  return (
  <div className="space-y-2 rounded-md border bg-muted/20 px-3 py-2">
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <Badge variant={s.source === 'ai' ? 'secondary' : 'outline'} className="text-[10px] font-normal">{s.source === 'ai' ? 'GST Assistant' : 'Rules summary'}</Badge>
      <span>
        {fmtAt(s.at)}
        {s.by ? ` · ${s.by}` : ''}
      </span>
      {stale && <span className="font-medium text-destructive-strong">The differences or remarks have changed since: summarise again.</span>}
    </div>
    {s.source === 'rules' && s.note && <p className="text-[11px] text-muted-foreground">The assistant was not used ({s.note}), so this is the rules summary.</p>}
    {mine.length === 0 && <p className="text-sm">{s.overall}</p>}
    {mine.map((t) => (
      <p key={t.table} className="text-sm leading-snug">
        <span className="font-semibold">Table {t.table}. </span>
        {t.summary}
      </p>
    ))}
    {unexplained.length > 0 && (
      <div>
        <p className="text-xs font-semibold text-destructive-strong">Unexplained ({unexplained.length})</p>
        <ul className="ml-4 list-disc text-xs">
          {unexplained.map((u) => (
            <li key={u.id}>
              {u.label}: {u.note}
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
  );
};

export const VarianceCard: React.FC<{ table: VarianceTable }> = ({ table }) => {
  const { docs, workings, update, readOnly, client, financialYear, userName } = useWorkspace();
  const { cells, remarks, digest } = useVariance();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const saved = docs.gstr9.varianceSummary ?? null;
  const portalFetched = workings.g9.t4Source === 'portal';
  const mine = cells.filter((c) => c.table === table);
  if (!portalFetched || !mine.length) return null;
  const ids = new Set(mine.map((c) => c.id));
  const noRemark = mine.filter((c) => remarksForCell(c, remarks).length === 0).length;

  const summarise = async () => {
    setBusy(true);
    try {
      const ai = await summariseWithAi({ clientId: client.id, financialYear, cells, remarks, workings });
      const label = new Map(cells.map((c) => [c.id, cellLabel(c)]));
      const base = { at: new Date().toISOString(), by: userName || null, digest };
      const failed = 'error' in ai ? ai.error : null;
      const next: VarianceSummary =
        'answer' in ai
          ? {
              ...base,
              source: 'ai',
              overall: ai.answer.overall,
              tables: ai.answer.tables,
              unexplained: ai.answer.unexplained.filter((u) => label.has(u.id)).map((u) => ({ id: u.id, label: label.get(u.id)!, note: u.note })),
            }
          : { ...base, source: 'rules', ...rulesSummary(cells, remarks), note: failed ?? undefined };
      update('gstr9', (d) => ({ ...d, varianceSummary: next }), { action: 'Summarised the differences from the system-computed GSTR-9' });
      if (failed) toast.message('Rules summary written', { description: failed });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-cell-variance-foreground/30 bg-cell-variance/20">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
          <span className="font-medium">
            {mine.length === 1 ? '1 figure' : `${mine.length} figures`} of Table {table} differ from the system-computed GSTR-9
          </span>
          <span className="text-muted-foreground">
            {noRemark ? `· ${noRemark} without a remark` : '· every one has a remark'}
            {saved ? (saved.digest !== digest ? ' · summary out of date' : ' · summarised') : ''}
          </span>
        </button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={busy || readOnly}
          title={readOnly ? 'The working is locked' : 'Summarise why the figures of every table differ, from the remarks given (GST Assistant; the rules summary when it is not available)'}
          onClick={() => { setOpen(true); void summarise(); }}
        >
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
          {saved ? 'Summarise again' : 'Summarise with AI'}
        </Button>
      </div>
      {open && (
      <div className="space-y-2 border-t px-3 py-2">
      {saved && <SummaryView s={saved} stale={saved.digest !== digest} table={table} ids={ids} />}
      <div className="max-h-[420px] overflow-auto rounded-md border">
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm" aria-label={`Table ${table}: differences from the system-computed GSTR-9`}>
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="border-b border-r px-2 py-1.5 font-semibold">Row</th>
              <th className="border-b border-r px-2 py-1.5 font-semibold">Head</th>
              <th className="border-b border-r px-2 py-1.5 text-right font-semibold">System-computed</th>
              <th className="border-b border-r px-2 py-1.5 text-right font-semibold">Final</th>
              <th className="border-b border-r px-2 py-1.5 text-right font-semibold">Difference</th>
              <th className="w-[45%] border-b px-2 py-1.5 font-semibold">Remarks that bear on it</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((c) => (
              <tr key={c.id}>
                <td className="border-b border-r px-2 py-1.5 align-top">
                  <span className="mr-1 font-mono text-[10px] font-semibold text-muted-foreground">{c.row}</span>
                  {c.rowLabel}
                </td>
                <td className="whitespace-nowrap border-b border-r px-2 py-1.5 align-top text-xs">{VARIANCE_COL_LABEL[c.col]}</td>
                <td className="whitespace-nowrap border-b border-r px-2 py-1.5 text-right align-top tabular-nums">{inr(c.portal)}</td>
                <td className={cn('whitespace-nowrap border-b border-r px-2 py-1.5 text-right align-top tabular-nums', VARIANCE_CELL_CLASS)}>
                  <FigLink to={gstr9FormRow(c.table, c.rowKey, c.col)}>{inr(c.final)}</FigLink>
                </td>
                <td className="whitespace-nowrap border-b border-r px-2 py-1.5 text-right align-top tabular-nums">{inr(c.diff)}</td>
                <td className="border-b px-2 py-1.5 align-top">
                  <RemarkList items={remarksForCell(c, remarks)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
      )}
    </div>
  );
};
