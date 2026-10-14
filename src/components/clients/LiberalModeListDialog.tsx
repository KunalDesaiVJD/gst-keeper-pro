import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { ArrowLeftRight, ListChecks, Loader2, Search } from 'lucide-react';

/**
 * Every client's 2B Reconciliation mode at a glance (the firm's option 3,
 * 14 Oct 2026): Liberal clients (2B Reconciliation edited directly, ITC
 * Summary row 5.1 typed rather than taken from 2B) beside Strict ones. A
 * button on the Clients page; the lists only ever show in this pop-up.
 * Who switched a client, and when, comes from the stamp the database keeps
 * (migration 20261017100000); a client switched before that shows as such.
 * The Superadmin and a GST Manager switch a client right here (Make Strict /
 * Make Liberal, with Undo), stamped exactly as Edit Client stamps it.
 */
type Row = {
  id: string;
  name: string;
  gstin: string | null;
  liberal_2b_reconciliation: boolean | null;
  liberal_changed_at?: string | null;
  liberal_changed_by_name?: string | null;
  cancellation_date?: string | null;
  inactive_at_hand?: boolean | null;
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

const LiberalModeListDialog: React.FC<{ triggerClassName?: string }> = ({ triggerClassName }) => {
  const navigate = useNavigate();
  const { user, canManage2BLiberalMode } = useAuth();
  const canSwitch = canManage2BLiberalMode();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  // The guard reads a ref so a double click cannot send two switches.
  const busyRef = useRef<Set<string>>(new Set());
  // The last switch, shown in the pop-up with its Undo (a toast's button
  // cannot be clicked while the pop-up is open).
  const [last, setLast] = useState<{ row: Row; liberal: boolean; undone: boolean } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = async () => {
    setError(null);
    setLast(null);
    setRows(null);
    const cols = 'id, name, gstin, liberal_2b_reconciliation, cancellation_date, inactive_at_hand';
    const withStamp = await supabase.from('clients').select(`${cols}, liberal_changed_at, liberal_changed_by_name`).order('name');
    if (!withStamp.error) { setRows((withStamp.data || []) as Row[]); return; }
    // A database without the stamp columns still lists the modes.
    const plain = await supabase.from('clients').select(cols).order('name');
    if (plain.error) { setError(plain.error.message); return; }
    setRows((plain.data || []) as Row[]);
  };

  // One switch: guarded on the mode the list shows, so a client someone else
  // switched meanwhile is not flipped back; the stamp (who) rides on the same
  // UPDATE and the database sets the time and writes client_liberal_log.
  const switchMode = async (r: Row, next: boolean, undo = false) => {
    if (!canSwitch || busyRef.current.has(r.id)) return;
    busyRef.current.add(r.id);
    setBusy(new Set(busyRef.current));
    try {
      const { data, error: err } = await supabase
        .from('clients')
        .update({
          liberal_2b_reconciliation: next,
          liberal_changed_at: new Date().toISOString(),
          liberal_changed_by: user?.id ?? null,
          liberal_changed_by_name: user?.firstName || user?.email || null,
        })
        .eq('id', r.id)
        .eq('liberal_2b_reconciliation', !next)
        .select('liberal_2b_reconciliation, liberal_changed_at, liberal_changed_by_name');
      if (err) throw err;
      if (!data || data.length === 0) {
        toast.error(`${r.name} was already switched by someone else. The lists are refreshed.`);
        void load();
        return;
      }
      const saved = { ...r, ...data[0] };
      setRows((rs) => (rs || []).map((x) => (x.id === r.id ? saved : x)));
      setLast({ row: saved, liberal: next, undone: undo });
    } catch (e: any) {
      toast.error(`Could not switch ${r.name}: ${e?.message || e}`);
    } finally {
      busyRef.current.delete(r.id);
      setBusy(new Set(busyRef.current));
    }
  };

  const { liberal, strict } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = (rows || []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.gstin || '').toLowerCase().includes(needle));
    return { liberal: shown.filter((r) => r.liberal_2b_reconciliation), strict: shown.filter((r) => !r.liberal_2b_reconciliation) };
  }, [rows, q]);

  const who = (r: Row, mode: 'Liberal' | 'Strict') => {
    if (r.liberal_changed_at) {
      return `${mode} since ${fmtWhen(r.liberal_changed_at)} · ${r.liberal_changed_by_name ? `by ${r.liberal_changed_by_name}` : 'who switched it was not recorded'}`;
    }
    return mode === 'Liberal' ? 'Liberal from before switches were logged (14 Oct 2026)' : '';
  };

  const list = (items: Row[], mode: 'Liberal' | 'Strict') => (
    <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border">
      {items.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">No client</li>}
      {items.map((r) => {
        const inactive = !!r.inactive_at_hand || !!r.cancellation_date;
        const line = who(r, mode);
        const saving = busy.has(r.id);
        return (
          <li key={r.id} className="flex items-center gap-2 pr-2 hover:bg-muted/50">
            <button
              type="button"
              onClick={() => { setOpen(false); navigate(`/edit-client/${r.id}`); }}
              className="min-w-0 flex-1 px-3 py-1.5 text-left"
              title="Open Edit Client"
            >
              <span className={cn('block truncate text-sm', inactive && 'text-muted-foreground')}>
                {r.name}{inactive ? ' (inactive)' : ''}
              </span>
              {line && <span className="block text-[11px] text-muted-foreground">{line}</span>}
            </button>
            {canSwitch && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => void switchMode(r, mode === 'Strict')}
                className={cn('h-7 shrink-0 gap-1 px-2 text-xs', mode === 'Strict' && 'text-destructive hover:text-destructive')}
                aria-label={`Make ${r.name} ${mode === 'Liberal' ? 'Strict' : 'Liberal'}`}
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowLeftRight className="h-3 w-3" />}
                {mode === 'Liberal' ? 'Make Strict' : 'Make Liberal'}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) void load(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={triggerClassName}>
          <ListChecks className="h-3.5 w-3.5" />
          Liberal / Strict
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>2B Reconciliation mode of every client</DialogTitle>
          <DialogDescription>
            Liberal: staff edit 2B Reconciliation directly, and ITC Summary row 5.1 is typed, not taken from 2B (marked in red there).
            Strict: entries go through Import 2B and row 5.1 comes from it.
            {canSwitch
              ? ' Switch a client with Make Strict / Make Liberal on its row; every switch is logged with your name.'
              : ' Only the Superadmin or a GST Manager can switch a client.'}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or GSTIN" className="h-8 pl-8 text-sm" aria-label="Search clients" />
        </div>
        {last && (
          <div role="status" className="flex items-start justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <div>
              <span className="font-medium">
                {last.row.name} {last.undone ? 'is back to' : 'is now'} {last.liberal ? 'Liberal' : 'Strict'}.
              </span>{' '}
              <span className="text-muted-foreground">
                {last.liberal
                  ? 'Staff can edit its 2B Reconciliation directly; ITC Summary row 5.1 is typed for it.'
                  : 'Its 2B Reconciliation is read-only; ITC Summary row 5.1 comes from Import 2B.'}
              </span>
            </div>
            {!last.undone && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 shrink-0 px-2 text-xs"
                disabled={busy.has(last.row.id)}
                onClick={() => void switchMode(last.row, !last.liberal, true)}
              >
                Undo
              </Button>
            )}
          </div>
        )}
        {error && <p className="text-sm text-destructive">Could not load the clients: {error}</p>}
        {!rows && !error && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        )}
        {rows && (
          <div className="grid gap-4 md:grid-cols-2">
            <section>
              <h3 className="mb-1.5 text-sm font-semibold text-destructive">Liberal ({liberal.length})</h3>
              {list(liberal, 'Liberal')}
            </section>
            <section>
              <h3 className="mb-1.5 text-sm font-semibold">Strict ({strict.length})</h3>
              {list(strict, 'Strict')}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LiberalModeListDialog;
