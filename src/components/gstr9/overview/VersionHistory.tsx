import React, { useCallback, useEffect, useRef, useState } from 'react';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { tin } from '@/lib/gstr9/engine';
import { normalizeDoc } from '@/lib/gstr9/defaults';
import { loadDocHistory, type DocHistoryEntry } from '@/lib/gstr9/store';
import { DOC_KEYS, FY_MONTHS, type AnnualReturnDocs, type DocKey } from '@/lib/gstr9/types';
import { SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { fmtWhen, nzT, portalMonthApplied, rupees } from './steps';

const DOC_NAME: Record<DocKey, string> = {
  sales: 'Sales (PL-OUTPUT)',
  purchases: 'Purchases & ITC (PL-INPUT)',
  duties_output: 'Duties & Taxes — output',
  duties_input: 'Duties & Taxes — input',
  rcm: 'RCM',
  portal: 'Portal data',
  gstr9: 'GSTR-9 (typed cells)',
  annexures: 'Annexures',
  gstr9c: 'GSTR-9C',
  notice: 'Notice format',
  justifications: 'Justifications',
  settings: 'Settings',
};

/** A one-line summary of a stored version, so staff can tell versions apart. */
function describe(key: DocKey, raw: unknown): string {
  try {
    const d = normalizeDoc(key, raw) as AnnualReturnDocs[DocKey];
    switch (key) {
      case 'sales': {
        const s = d as AnnualReturnDocs['sales'];
        return `${s.partA.length} taxable + ${s.partB.length} non-taxable ledgers${s.auditReportTotal !== null ? ` · audit ${rupees(s.auditReportTotal)}` : ''}`;
      }
      case 'purchases':
        return `${(d as AnnualReturnDocs['purchases']).rows.length} ledgers`;
      case 'rcm':
        return `${(d as AnnualReturnDocs['rcm']).categories.length} categories`;
      case 'duties_output': {
        const o = d as AnnualReturnDocs['duties_output'];
        const n = FY_MONTHS.filter((m) => nzT(tin(o.months[m].sales)) || nzT(tin(o.months[m].creditNote))).length;
        return `${n}/12 months · ${o.adjustments.length} adjustments`;
      }
      case 'duties_input': {
        const i = d as AnnualReturnDocs['duties_input'];
        const n = FY_MONTHS.filter((m) => nzT(tin(i.months[m].purchase)) || nzT(tin(i.months[m].debitNote))).length;
        return `${n}/12 months · ${i.adjustments.length} adjustments`;
      }
      case 'portal': {
        const p = d as AnnualReturnDocs['portal'];
        const docs = { portal: p } as AnnualReturnDocs;
        const n = FY_MONTHS.filter((m) => portalMonthApplied(docs, m)).length;
        return `GSTR-9 ${p.gstr9Meta?.source ? p.gstr9Meta.source.replace(/_/g, ' ') : 'not fetched'} · 3B ${n}/12 months`;
      }
      case 'justifications':
        return `${Object.keys((d as AnnualReturnDocs['justifications']).lines || {}).length} reasons`;
      case 'settings':
        return `tolerance ${rupees((d as AnnualReturnDocs['settings']).tolerance)}`;
      default:
        return '';
    }
  } catch {
    return '';
  }
}

/** Every overwritten version of one sheet, with a restore. */
export const VersionHistory: React.FC = () => {
  const { client, financialYear, update, readOnly, flush } = useWorkspace();
  const confirm = useConfirm();
  const [key, setKey] = useState<DocKey | ''>('');
  const [entries, setEntries] = useState<DocHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  const load = useCallback(
    async (k: DocKey) => {
      const mine = ++req.current;
      setLoading(true);
      setError(null);
      try {
        const rows = await loadDocHistory(client.id, financialYear, k);
        if (mine === req.current) setEntries(rows);
      } catch (e) {
        if (mine === req.current) {
          setEntries(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (mine === req.current) setLoading(false);
      }
    },
    [client.id, financialYear],
  );

  useEffect(() => {
    if (key) void load(key);
  }, [key, load]);

  const restore = async (e: DocHistoryEntry) => {
    const name = DOC_NAME[e.docKey] ?? e.docKey;
    const ok = await confirm({
      title: `Restore ${name} to version ${e.version}?`,
      description: `The sheet goes back to how ${e.updatedBy || 'it was'} left it on ${fmtWhen(e.updatedAt)}, and every figure that depends on it is recomputed. The version it replaces is kept in this history, so it can be restored again.`,
      confirmText: 'Restore',
    });
    if (!ok) return;
    update(e.docKey, () => normalizeDoc(e.docKey, e.data));
    toast.success(`${name} restored to version ${e.version}.`);
    try {
      await flush();
    } finally {
      void load(e.docKey);
    }
  };

  return (
    <SectionCard
      title="Version history"
      description="Every time a sheet is saved over, the earlier version is kept. Pick a sheet to see its versions."
      actions={
        <div className="w-60">
          <Select value={key} onValueChange={(v) => setKey(v as DocKey)}>
            <SelectTrigger aria-label="Sheet" className="h-8 text-xs">
              <SelectValue placeholder="Choose a sheet…" />
            </SelectTrigger>
            <SelectContent>
              {DOC_KEYS.map((k) => (
                <SelectItem key={k} value={k} className="text-xs">{DOC_NAME[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {!key ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><History className="h-4 w-4" /> Choose a sheet to list its earlier versions.</p>
      ) : loading && !entries ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading versions…</p>
      ) : error ? (
        <p className="text-xs text-destructive">Could not load the history: {error}</p>
      ) : !entries?.length ? (
        <p className="text-xs text-muted-foreground">No earlier versions of {DOC_NAME[key]} yet — one is kept each time the sheet is saved over.</p>
      ) : (
        <div className="relative overflow-x-auto rounded-md border">
          <table className="w-full min-w-[560px] border-collapse text-xs" aria-label={`Versions of ${DOC_NAME[key]}`}>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="w-20 border-b px-2 py-1.5 text-left font-semibold">Version</th>
                <th scope="col" className="border-b px-2 py-1.5 text-left font-semibold">Saved by</th>
                <th scope="col" className="border-b px-2 py-1.5 text-left font-semibold">Saved at</th>
                <th scope="col" className="border-b px-2 py-1.5 text-left font-semibold">Contents</th>
                {!readOnly && <th scope="col" className="w-24 border-b px-2 py-1.5"><span className="sr-only">Restore</span></th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="border-b px-2 py-1.5 tabular-nums">v{e.version}</td>
                  <td className="border-b px-2 py-1.5">{e.updatedBy || '—'}</td>
                  <td className="border-b px-2 py-1.5 tabular-nums">{fmtWhen(e.updatedAt)}</td>
                  <td className="border-b px-2 py-1.5 text-muted-foreground">{describe(e.docKey, e.data)}</td>
                  {!readOnly && (
                    <td className="border-b px-2 py-1 text-right">
                      <Button size="sm" variant="outline" className="h-7" onClick={() => restore(e)}>
                        <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
};

export default VersionHistory;
