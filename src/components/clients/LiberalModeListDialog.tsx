import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { ListChecks, Loader2, Search } from 'lucide-react';

/**
 * Every client's 2B Reconciliation mode at a glance (the firm's option 3,
 * 14 Oct 2026): Liberal clients (2B Reconciliation edited directly, ITC
 * Summary row 5.1 typed rather than taken from 2B) beside Strict ones. A
 * button on the Clients page; the lists only ever show in this pop-up.
 * Who switched a client, and when, comes from the stamp the database keeps
 * (migration 20261017100000); a client switched before that shows as such.
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
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = async () => {
    setError(null);
    setRows(null);
    const cols = 'id, name, gstin, liberal_2b_reconciliation, cancellation_date, inactive_at_hand';
    const withStamp = await supabase.from('clients').select(`${cols}, liberal_changed_at, liberal_changed_by_name`).order('name');
    if (!withStamp.error) { setRows((withStamp.data || []) as Row[]); return; }
    // A database without the stamp columns still lists the modes.
    const plain = await supabase.from('clients').select(cols).order('name');
    if (plain.error) { setError(plain.error.message); return; }
    setRows((plain.data || []) as Row[]);
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
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => { setOpen(false); navigate(`/edit-client/${r.id}`); }}
              className="w-full px-3 py-1.5 text-left hover:bg-muted/50"
              title="Open Edit Client"
            >
              <span className={cn('block text-sm', inactive && 'text-muted-foreground')}>
                {r.name}{inactive ? ' (inactive)' : ''}
              </span>
              {line && <span className="block text-[11px] text-muted-foreground">{line}</span>}
            </button>
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
            Strict: entries go through Import 2B and row 5.1 comes from it. Switched in Edit Client by the Superadmin or a GST Manager.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or GSTIN" className="h-8 pl-8 text-sm" aria-label="Search clients" />
        </div>
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
