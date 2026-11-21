import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TR, WS_FILTER_LABEL, WS_CONTROL,
} from '@/components/workspace/theme';

/**
 * Clients → Services: every client on one screen with its three service
 * categories (migration 20261121100000). Tick or untick any box, then Save:
 * only the changed clients are written, and each module lists only the
 * clients ticked for it. Notices & Litigation is clients.notices_handled,
 * the same switch as Notices · Settings → Clients we handle.
 */
type Col = 'returns_filing' | 'annual_return_assigned' | 'notices_handled';
interface Row { id: string; name: string; gstin: string; returns_filing: boolean; annual_return_assigned: boolean; notices_handled: boolean }
type Flags = Pick<Row, Col>;

const COLS: { col: Col; label: string; hint: string }[] = [
  { col: 'returns_filing', label: 'Returns filing', hint: 'Filing Status' },
  { col: 'annual_return_assigned', label: 'GSTR-9 / 9C', hint: 'Annual Return' },
  { col: 'notices_handled', label: 'Notices & Litigation', hint: 'Notices & Litigation' },
];

const sameFlags = (a: Flags, b: Flags) => COLS.every(({ col }) => a[col] === b[col]);

const ClientServicesGrid: React.FC<{ canEdit: boolean; onSaved?: () => void }> = ({ canEdit, onSaved }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Map<string, Flags>>(new Map());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('clients')
        .select('id, name, gstin, returns_filing, annual_return_assigned, notices_handled')
        .order('name').order('id').range(from, from + 999);
      if (error) { toast.error('Could not load the clients: ' + error.message); return; }
      out.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    setRows(out);
    setDraft(new Map());
  }, []);
  useEffect(() => { load(); }, [load]);

  const flagsOf = (r: Row): Flags => draft.get(r.id) ?? r;
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => !s || r.name.toLowerCase().includes(s) || (r.gstin ?? '').toLowerCase().includes(s));
  }, [rows, search]);

  const setFlags = (changes: { row: Row; col: Col; on: boolean }[]) => setDraft((prev) => {
    const next = new Map(prev);
    changes.forEach(({ row, col, on }) => {
      const f = { ...(next.get(row.id) ?? row), [col]: on } as Flags;
      if (sameFlags(f, row)) next.delete(row.id); else next.set(row.id, f);
    });
    return next;
  });

  const changed = (rows ?? []).filter((r) => draft.has(r.id));
  const noService = changed.filter((r) => COLS.every(({ col }) => !flagsOf(r)[col]));
  const ticked = (col: Col) => (rows ?? []).filter((r) => flagsOf(r)[col]).length;

  // Unsaved ticks are lost on leaving the page: the browser asks first.
  useEffect(() => {
    if (!draft.size) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft.size]);

  const save = async () => {
    if (!changed.length || noService.length) return;
    setSaving(true);
    // Clients with the same new ticks go in one update.
    const groups = new Map<string, { patch: Flags; ids: string[] }>();
    changed.forEach((r) => {
      const f = flagsOf(r);
      const patch = { returns_filing: f.returns_filing, annual_return_assigned: f.annual_return_assigned, notices_handled: f.notices_handled };
      const key = JSON.stringify(patch);
      const g = groups.get(key) ?? { patch, ids: [] };
      g.ids.push(r.id);
      groups.set(key, g);
    });
    for (const { patch, ids } of groups.values()) {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase.from('clients').update(patch).in('id', ids.slice(i, i + 200));
        if (error) {
          setSaving(false);
          toast.error('Could not save the services: ' + error.message + '. Some clients may be saved; the list is reloaded.');
          await load();
          return;
        }
      }
    }
    setSaving(false);
    toast.success(`Services saved for ${changed.length} client${changed.length === 1 ? '' : 's'}`);
    await load();
    onSaved?.();
  };

  if (!rows) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-2">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 px-3 py-2">
          <label className="block w-full max-w-md space-y-0.5">
            <span className={WS_FILTER_LABEL}>Search</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search by name or GSTIN..." value={search} onChange={(e) => setSearch(e.target.value)} className={cn(WS_CONTROL, 'pl-8')} />
            </div>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {draft.size ? `${draft.size} client${draft.size === 1 ? '' : 's'} changed, not saved` : 'No unsaved changes'}
            </span>
            {canEdit && (
              <>
                <Button size="sm" variant="outline" className={WS_BTN} disabled={!draft.size || saving} onClick={() => setDraft(new Map())}>Discard</Button>
                <Button size="sm" className={WS_BTN} disabled={!draft.size || saving || noService.length > 0} onClick={save}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {noService.length > 0 && (
        <p className="text-sm text-destructive">
          {noService.length} client{noService.length === 1 ? ' has' : 's have'} no service ticked and would show in no module: {noService.slice(0, 5).map((r) => r.name).join(', ')}{noService.length > 5 ? '…' : ''}. Tick at least one to save.
        </p>
      )}

      <div className={cn(WS_TABLE_WRAP, 'max-h-[70vh]')}>
        <table className={cn(WS_TABLE, 'min-w-[720px]')}>
          <thead>
            <tr>
              <th className={cn(WS_TH, 'w-10 text-center')}>#</th>
              <th className={WS_TH}>Client Name</th>
              <th className={WS_TH}>GSTIN</th>
              {COLS.map(({ col, label, hint }) => {
                const on = shown.filter((r) => flagsOf(r)[col]).length;
                return (
                  <th key={col} className={cn(WS_TH, 'text-center')}>
                    <div className="flex flex-col items-center gap-1">
                      <span>{label}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">{hint} · {ticked(col)} of {rows.length}</span>
                      {canEdit && (
                        <Checkbox
                          aria-label={`Tick ${label} for every client shown`}
                          title="Tick or untick for every client shown"
                          checked={shown.length > 0 && on === shown.length ? true : on > 0 ? 'indeterminate' : false}
                          onCheckedChange={(v) => setFlags(shown.map((row) => ({ row, col, on: v === true })))}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const f = flagsOf(r);
              const dirty = draft.has(r.id);
              const none = COLS.every(({ col }) => !f[col]);
              return (
                <tr key={r.id} className={cn(WS_TR, dirty && 'bg-primary/5', none && 'bg-destructive/10')}>
                  <td className={cn(WS_TD, 'text-center tabular-nums text-muted-foreground')}>{i + 1}</td>
                  <td className={cn(WS_TD, 'font-medium text-foreground')}>{r.name}{dirty && <span className="ml-1.5 text-[10px] font-normal text-primary">changed</span>}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap font-mono')}>{r.gstin}</td>
                  {COLS.map(({ col, label }) => (
                    <td key={col} className={cn(WS_TD, 'text-center')}>
                      <Checkbox
                        aria-label={`${label} for ${r.name}`}
                        checked={f[col]}
                        disabled={!canEdit || saving}
                        onCheckedChange={(v) => setFlags([{ row: r, col, on: v === true }])}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ClientServicesGrid;
