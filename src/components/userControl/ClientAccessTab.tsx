import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import {
  WS_BTN, WS_CONTROL, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR,
} from '@/components/workspace/theme';

/**
 * Settings → User Control → Client access.
 *
 * A GST Manager or the superadmin limits an employee to the clients allotted
 * to them. Off (the default) = every client, as before. On = only the ticked
 * clients, everywhere in the app: the database itself holds it (policy
 * staff_client_scope_guard on every client table, 20261125140000), so a
 * screen that forgets to filter still shows nothing else. Saved only through
 * staff_set_client_allotment, every change in staff_client_allotment_log.
 */

export interface ClientAccessPerson {
  user_id: string;
  first_name: string;
  email: string | null;
}

interface ClientRow { id: string; name: string; gstin: string | null }
interface LogRow { id: number; at: string; actor_id: string | null; user_id: string; action: string; client_name: string | null }

const ACTION_LABEL: Record<string, string> = {
  'limit on': 'Limited to allotted clients',
  'limit off': 'Sees every client again',
  allot: 'Client allotted',
  remove: 'Client taken off',
};

const ClientAccessTab: React.FC<{ people: ClientAccessPerson[]; actorId: string; nameOf: (id: string | null) => string }> = ({ people, actorId, nameOf }) => {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [limited, setLimited] = useState<Record<string, boolean>>({});
  const [allotted, setAllotted] = useState<Record<string, Set<string>>>({});
  const [log, setLog] = useState<LogRow[]>([]);

  const [personId, setPersonId] = useState('');
  const [draftOn, setDraftOn] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [onlyTicked, setOnlyTicked] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, s, a, l] = await Promise.all([
      supabase.from('clients').select('id, name, gstin').order('name'),
      supabase.from('staff_client_scope').select('user_id, restricted'),
      supabase.from('staff_client_allotments').select('user_id, client_id'),
      supabase.from('staff_client_allotment_log').select('id, at, actor_id, user_id, action, client_name').order('at', { ascending: false }).limit(200),
    ]);
    if (c.error) toast.error('Could not load clients: ' + c.error.message);
    setReady(!s.error && !a.error);
    setClients((c.data || []) as ClientRow[]);
    const lim: Record<string, boolean> = {};
    (s.data || []).forEach((r) => { lim[r.user_id] = r.restricted; });
    setLimited(lim);
    const al: Record<string, Set<string>> = {};
    (a.data || []).forEach((r) => { (al[r.user_id] ||= new Set()).add(r.client_id); });
    setAllotted(al);
    setLog((l.data || []) as LogRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const person = people.find((p) => p.user_id === personId) || null;

  const pick = (id: string) => {
    setPersonId(id);
    setDraftOn(!!limited[id]);
    setDraft(new Set(allotted[id] || []));
    setQuery('');
    setOnlyTicked(false);
  };

  const dirty = !!person && (
    draftOn !== !!limited[person.user_id]
    || draft.size !== (allotted[person.user_id]?.size || 0)
    || [...draft].some((id) => !allotted[person.user_id]?.has(id))
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => (!onlyTicked || draft.has(c.id))
      && (!q || c.name.toLowerCase().includes(q) || (c.gstin || '').toLowerCase().includes(q)));
  }, [clients, query, onlyTicked, draft]);

  const toggle = (id: string, on: boolean) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };
  const tickShown = (on: boolean) => {
    setDraft((prev) => {
      const next = new Set(prev);
      shown.forEach((c) => { if (on) next.add(c.id); else next.delete(c.id); });
      return next;
    });
  };

  const save = async () => {
    if (!person) return;
    if (draftOn && draft.size === 0) {
      toast.error('Tick at least one client, or switch the limit off: with no client ticked they would see nothing.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('staff_set_client_allotment', {
      p_actor_id: actorId, p_user_id: person.user_id, p_restricted: draftOn, p_client_ids: [...draft],
    });
    setSaving(false);
    if (error) { toast.error('Not saved: ' + error.message); return; }
    toast.success(draftOn
      ? `${person.first_name} now sees only ${draft.size} allotted client${draft.size === 1 ? '' : 's'} (from their next page load)`
      : `${person.first_name} sees every client`);
    await load();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!ready) {
    return <Note tone="warn">Client allotment is not switched on in the database yet (migration 20261125140000). Every employee sees every client, as before.</Note>;
  }

  const shownTicked = shown.filter((c) => draft.has(c.id)).length;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <SectionCard
        title="Employees"
        description="Off: sees every client (the default). On: sees and works on only the clients allotted. GST Managers and the Superadmin always see every client."
      >
        <div className={WS_TABLE_WRAP}>
          <table className={WS_TABLE} aria-label="Client access by employee">
            <thead>
              <tr>
                <th className={WS_TH}>Employee</th>
                <th className={cn(WS_TH, 'border-r-0')}>Clients</th>
              </tr>
            </thead>
            <tbody>
              {people.length === 0 && (
                <tr className={WS_TR}><td className={cn(WS_TD, 'border-r-0 text-muted-foreground')} colSpan={2}>No employees yet.</td></tr>
              )}
              {people.map((p) => {
                const on = !!limited[p.user_id];
                const n = allotted[p.user_id]?.size || 0;
                return (
                  <tr
                    key={p.user_id}
                    className={cn(WS_TR, 'cursor-pointer', personId === p.user_id && 'bg-primary/5')}
                    onClick={() => pick(p.user_id)}
                  >
                    <td className={WS_TD}>
                      <span className="font-medium">{p.first_name}</span>
                      {p.email && <span className="block text-xs text-muted-foreground">{p.email}</span>}
                    </td>
                    <td className={cn(WS_TD, 'border-r-0 whitespace-nowrap text-xs')}>
                      {on
                        ? <Badge variant={n ? 'default' : 'destructive'} className="text-[10px]">{n} allotted</Badge>
                        : <span className="text-muted-foreground">All clients</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        className="lg:col-span-2"
        title={person ? `Clients for ${person.first_name}` : 'Clients'}
        description={person ? 'Tick the clients this employee works on, then Save.' : 'Choose an employee on the left.'}
        actions={person && (
          <Button size="sm" className={WS_BTN} disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </Button>
        )}
      >
        {person && (
          <>
            <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <Switch checked={draftOn} onCheckedChange={setDraftOn} aria-label="Only allotted clients" />
              <span className="font-medium">Only allotted clients</span>
              <span className="text-xs text-muted-foreground">
                {draftOn ? `sees ${draft.size} of ${clients.length} clients` : 'off: sees every client'}
              </span>
            </label>
            {draftOn && draft.size === 0 && (
              <Note tone="warn">No client ticked: this employee would see no client at all.</Note>
            )}
            {!draftOn && draft.size > 0 && (
              <Note tone="info">The ticked clients are kept, but apply only once the limit is switched on.</Note>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name or GSTIN" className={cn(WS_CONTROL, 'pl-7')}
                />
              </div>
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={onlyTicked} onCheckedChange={(v) => setOnlyTicked(v === true)} /> Ticked only
              </label>
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => tickShown(true)} disabled={!shown.length}>
                Tick {shown.length === clients.length ? 'all' : `these ${shown.length}`}
              </Button>
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => tickShown(false)} disabled={!shownTicked}>
                Untick {shown.length === clients.length ? 'all' : 'these'}
              </Button>
            </div>
            <div className={cn(WS_TABLE_WRAP, 'max-h-[460px] overflow-y-auto')}>
              <table className={WS_TABLE} aria-label={`Clients allotted to ${person.first_name}`}>
                <thead>
                  <tr>
                    <th className={cn(WS_TH, 'w-10')} aria-label="Allotted" />
                    <th className={WS_TH}>Client</th>
                    <th className={cn(WS_TH, 'border-r-0')}>GSTIN</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr className={WS_TR}><td className={cn(WS_TD, 'border-r-0 text-muted-foreground')} colSpan={3}>No client matches.</td></tr>
                  )}
                  {shown.map((c) => (
                    <tr key={c.id} className={cn(WS_TR, 'cursor-pointer')} onClick={() => toggle(c.id, !draft.has(c.id))}>
                      <td className={WS_TD} onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={draft.has(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} aria-label={`Allot ${c.name}`} />
                      </td>
                      <td className={WS_TD}>{c.name}</td>
                      <td className={cn(WS_TD, 'border-r-0 font-mono text-xs')}>{c.gstin || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard className="lg:col-span-3" title="Allotment log" description="Every change to who sees which clients, newest first.">
        <div className={WS_TABLE_WRAP}>
          <table className={WS_TABLE} aria-label="Client allotment log">
            <thead>
              <tr>
                <th className={WS_TH}>When</th>
                <th className={WS_TH}>Employee</th>
                <th className={WS_TH}>Change</th>
                <th className={WS_TH}>Client</th>
                <th className={cn(WS_TH, 'border-r-0')}>By</th>
              </tr>
            </thead>
            <tbody>
              {log.length === 0 && (
                <tr className={WS_TR}><td className={cn(WS_TD, 'border-r-0 text-muted-foreground')} colSpan={5}>No changes yet.</td></tr>
              )}
              {log.map((r) => (
                <tr key={r.id} className={WS_TR}>
                  <td className={cn(WS_TD, 'whitespace-nowrap text-xs tabular-nums')}>{new Date(r.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className={WS_TD}>{nameOf(r.user_id)}</td>
                  <td className={WS_TD}>{ACTION_LABEL[r.action] || r.action}</td>
                  <td className={WS_TD}>{r.client_name || ''}</td>
                  <td className={cn(WS_TD, 'border-r-0')}>{nameOf(r.actor_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
};

export default ClientAccessTab;
