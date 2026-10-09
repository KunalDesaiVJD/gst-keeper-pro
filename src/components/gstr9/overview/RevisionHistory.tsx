import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, Loader2, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { describeChange, hiddenFromClients, SHEET_LABEL, type ChangeLogEntry } from '@/lib/gstr9/audit';
import { loadChangeLog } from '@/lib/gstr9/store';
import { SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { fmtWhen } from './steps';

const PAGE = 200;
const ALL = '__all';

/**
 * Every change to this client's working, newest first: who, when, which sheet
 * and place, the figure before and after. Written by the database on each
 * save (annual_return_change_log) — it cannot be edited or deleted from the app.
 * A client login is not shown the allotment, the send-backs or any sign-off note.
 */
export const RevisionHistory: React.FC<{ className?: string; compact?: boolean }> = ({ className, compact }) => {
  const { client, financialYear, lastSavedAt, period, isStaff } = useWorkspace();
  const [rows, setRows] = useState<ChangeLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string>(ALL);
  const [who, setWho] = useState<string>(ALL);
  const [q, setQ] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (append: boolean) => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const beforeId = append && rows.length ? rows[rows.length - 1].id : undefined;
      const page = await loadChangeLog(client.id, financialYear, { limit: PAGE, beforeId, docKey: sheet === ALL ? undefined : sheet });
      if (mine !== seq.current) return;
      setRows((prev) => (append ? [...prev, ...page] : page));
      setMore(page.length === PAGE);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [client.id, financialYear, sheet, rows]);

  // First page on open, when the sheet filter changes, and after each save / status change.
  const loadFirst = useRef(load);
  loadFirst.current = load;
  useEffect(() => {
    const t = setTimeout(() => void loadFirst.current(false), 400);
    return () => clearTimeout(t);
  }, [client.id, financialYear, sheet, lastSavedAt, period?.updated_at]);

  // Paging still runs on every row loaded; the rest of the screen reads only what this viewer may see.
  const visible = useMemo(() => (isStaff ? rows : rows.filter((r) => !hiddenFromClients(r))), [rows, isStaff]);
  const users = useMemo(() => [...new Set(visible.map((r) => r.changedBy).filter((x): x is string => !!x))].sort(), [visible]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return visible
      .filter((r) => who === ALL || r.changedBy === who)
      .map((r) => ({ r, d: describeChange(r, { forClient: !isStaff }) }))
      .filter(({ d }) => !needle || `${d.sheet} ${d.place} ${d.from} ${d.to} ${d.what} ${d.who}`.toLowerCase().includes(needle));
  }, [visible, who, q, isStaff]);

  return (
    <SectionCard
      className={className}
      title={<span className="inline-flex items-center gap-1.5"><History className="h-4 w-4" /> Revision history</span>}
      description="Every change to this working — who, when, where, and the figure before and after. Recorded by the database on each autosave; it cannot be edited or deleted."
      actions={
        <Button type="button" size="sm" variant="outline" onClick={() => void load(false)} disabled={loading} aria-label="Refresh the revision history">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sheet} onValueChange={setSheet}>
          <SelectTrigger className="h-8 w-52 text-xs" aria-label="Sheet"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sheets</SelectItem>
            {Object.entries(SHEET_LABEL).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={who} onValueChange={setWho}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="Changed by"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Everyone</SelectItem>
            {users.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search place, ledger or figure…" className="h-8 pl-7 text-xs" aria-label="Search the revision history" />
        </div>
      </div>

      {error && <p className="text-xs text-destructive-strong">Could not load the history: {error}</p>}

      {/* In the side panel: 60% of the screen. On the Review step's tab: the screen below the filters. */}
      <div className={cn('overflow-auto rounded-md border', compact && 'max-h-[60vh]')} style={compact ? undefined : { maxHeight: 'max(320px, calc(100vh - 360px))' }}>
        <table className="w-full border-collapse text-xs" aria-label="Revision history">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="text-left text-muted-foreground">
              <th className="border-b px-2 py-1.5 font-semibold">When</th>
              <th className="border-b px-2 py-1.5 font-semibold">Who</th>
              <th className="border-b px-2 py-1.5 font-semibold">Sheet · place</th>
              <th className="border-b px-2 py-1.5 text-right font-semibold">From</th>
              <th className="border-b px-2 py-1.5 text-right font-semibold">To</th>
              {!compact && <th className="border-b px-2 py-1.5 font-semibold">Action</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, d }) => (
              <tr key={r.id} className={cn('align-top', r.kind === 'status' && 'bg-primary/5', r.kind === 'setoff' && 'bg-success/5')}>
                <td className="whitespace-nowrap border-b px-2 py-1 tabular-nums text-muted-foreground">{fmtWhen(d.when)}</td>
                <td className="whitespace-nowrap border-b px-2 py-1">{d.who}</td>
                <td className="border-b px-2 py-1">
                  <div className="font-medium">{d.sheet}</div>
                  <div className="text-muted-foreground">{d.place}</div>
                  {compact && <div className="text-[11px] text-muted-foreground">{d.what}</div>}
                </td>
                <td className="border-b px-2 py-1 text-right tabular-nums text-muted-foreground">{d.from}</td>
                <td className="border-b px-2 py-1 text-right font-medium tabular-nums">{d.to}</td>
                {!compact && <td className="border-b px-2 py-1 text-muted-foreground">{d.what}</td>}
              </tr>
            ))}
            {!shown.length && !loading && (
              <tr><td colSpan={compact ? 5 : 6} className="px-2 py-6 text-center text-muted-foreground">
                {visible.length ? 'No change matches these filters.' : 'No changes recorded yet. Every edit from now on is listed here.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{visible.length} change{visible.length === 1 ? '' : 's'} loaded{shown.length !== visible.length ? ` · ${shown.length} shown` : ''}</span>
        {more && (
          <Button type="button" size="sm" variant="ghost" onClick={() => void load(true)} disabled={loading}>
            Load older changes
          </Button>
        )}
      </div>
    </SectionCard>
  );
};

export default RevisionHistory;
