import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TR } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Search, Users } from 'lucide-react';

const NO_EDIT = 'Needs the E-mail templates & reminder rules permission — ask a GST Manager to add it to your position';

interface ClientLite {
  id: string;
  name: string;
  gstin: string | null;
  email: string | null;
  registration_type: string | null;
  inactive_at_hand: boolean | null;
  cancellation_date: string | null;
  registration_cancellation_date: string | null;
}
interface Setting { enabled: boolean; send_confirmation: boolean }
const DEFAULT: Setting = { enabled: false, send_confirmation: true };

type Show = 'all' | 'on' | 'off' | 'no_email';

/** Who gets reminders and filing confirmations, for every client on one list. */
const ReminderClientsTab: React.FC = () => {
  const { user, canManageEmailTemplates } = useAuth();
  const canEdit = canManageEmailTemplates();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [settings, setSettings] = useState<Record<string, Setting>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [withInactive, setWithInactive] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c, error: ce }, { data: s, error: se }] = await Promise.all([
      supabase.from('clients').select('id, name, gstin, email, registration_type, inactive_at_hand, cancellation_date, registration_cancellation_date').order('name'),
      supabase.from('client_reminder_settings').select('client_id, enabled, send_confirmation'),
    ]);
    if (ce || se) toast.error(`Could not load the clients: ${(ce ?? se)!.message}`);
    setClients((c ?? []) as ClientLite[]);
    setSettings(Object.fromEntries((s ?? []).map((r) => [r.client_id as string, { enabled: !!r.enabled, send_confirmation: r.send_confirmation !== false }])));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const isInactive = (c: ClientLite) => !!(c.inactive_at_hand || c.cancellation_date || c.registration_cancellation_date);
  const get = (id: string) => settings[id] ?? DEFAULT;

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients.filter((c) => {
      if (!withInactive && isInactive(c)) return false;
      const s = get(c.id);
      if (show === 'on' && !s.enabled) return false;
      if (show === 'off' && s.enabled) return false;
      if (show === 'no_email' && c.email?.trim()) return false;
      return !needle || [c.name, c.gstin, c.email].some((v) => (v ?? '').toLowerCase().includes(needle));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, settings, q, show, withInactive]);

  const active = clients.filter((c) => !isInactive(c));
  const onCount = active.filter((c) => get(c.id).enabled).length;
  const noEmailOn = active.filter((c) => get(c.id).enabled && !c.email?.trim()).length;

  const write = async (ids: string[], patch: Partial<Setting>) => {
    if (!canEdit) { toast.error(NO_EDIT); return false; }
    setSaving(true);
    const payload = ids.map((id) => ({ client_id: id, ...get(id), ...patch, updated_by: user?.id ?? null }));
    const { error } = await supabase.from('client_reminder_settings').upsert(payload, { onConflict: 'client_id' });
    setSaving(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return false; }
    setSettings((prev) => {
      const n = { ...prev };
      for (const id of ids) n[id] = { ...get(id), ...patch };
      return n;
    });
    return true;
  };

  const bulk = async (enabled: boolean) => {
    const ids = [...picked];
    if (!ids.length) return;
    if (await write(ids, { enabled })) {
      toast.success(`Reminders ${enabled ? 'on' : 'off'} for ${ids.length} client${ids.length === 1 ? '' : 's'}.`);
      setPicked(new Set());
    }
  };

  const SHOWS: { v: Show; label: string }[] = [
    { v: 'all', label: 'All' }, { v: 'on', label: 'Reminders on' }, { v: 'off', label: 'Reminders off' }, { v: 'no_email', label: 'No e-mail' },
  ];

  return (
    <SectionCard
      title={<span className="flex items-center gap-2"><Users className="h-4 w-4" /> Clients</span>}
      description={`Reminders are on for ${onCount} of ${active.length} active clients. Turn them on or off here, or on each client's page.`}
    >
      {noEmailOn > 0 && (
        <p className="mb-2 flex items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-2.5 py-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5" /> {noEmailOn} client{noEmailOn === 1 ? ' has' : 's have'} reminders on but no e-mail address, so nothing reaches them. Use the No e-mail filter to find them.
        </p>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, GSTIN or e-mail" className="h-8 w-60 pl-7 text-xs" />
        </div>
        {SHOWS.map((s) => (
          <Button key={s.v} size="sm" variant={show === s.v ? 'default' : 'outline'} className={WS_BTN} onClick={() => setShow(s.v)}>{s.label}</Button>
        ))}
        <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={withInactive} onCheckedChange={(v) => setWithInactive(!!v)} /> Show inactive and cancelled</label>
        {picked.size > 0 && (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{picked.size} selected</span>
            <Button size="sm" className={WS_BTN} disabled={saving || !canEdit} title={canEdit ? undefined : NO_EDIT} onClick={() => void bulk(true)}>Turn on</Button>
            <Button size="sm" variant="outline" className={WS_BTN} disabled={saving || !canEdit} title={canEdit ? undefined : NO_EDIT} onClick={() => void bulk(false)}>Turn off</Button>
          </span>
        )}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className={cn(WS_TABLE_WRAP, 'max-h-[60vh]')}>
          <table className={WS_TABLE}>
            <thead>
              <tr>
                <th className={cn(WS_TH, 'w-0')}>
                  <Checkbox
                    checked={visible.length > 0 && visible.every((c) => picked.has(c.id))}
                    onCheckedChange={(v) => setPicked(v ? new Set(visible.map((c) => c.id)) : new Set())}
                    aria-label="All shown"
                  />
                </th>
                <th className={WS_TH}>Client</th>
                <th className={WS_TH}>E-mail</th>
                <th className={WS_TH}>Scheme</th>
                <th className={WS_TH}>Reminders</th>
                <th className={WS_TH}>Filing confirmation</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && <tr><td className={cn(WS_TD, 'py-8 text-center text-muted-foreground')} colSpan={6}>No clients match.</td></tr>}
              {visible.map((c) => {
                const s = get(c.id);
                return (
                  <tr key={c.id} className={WS_TR}>
                    <td className={WS_TD}>
                      <Checkbox
                        checked={picked.has(c.id)}
                        onCheckedChange={(v) => setPicked((p) => { const n = new Set(p); if (v) n.add(c.id); else n.delete(c.id); return n; })}
                        aria-label={c.name}
                      />
                    </td>
                    <td className={WS_TD}>
                      <Link to={`/edit-client/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                      <div className="text-xs text-muted-foreground">{c.gstin ?? '—'}{isInactive(c) ? ' · inactive' : ''}</div>
                    </td>
                    <td className={cn(WS_TD, 'text-xs')}>
                      {c.email?.trim() ? c.email : <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" /> None</span>}
                    </td>
                    <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{c.registration_type ?? '—'}</td>
                    <td className={WS_TD}>
                      <Switch checked={s.enabled} disabled={saving || !canEdit} onCheckedChange={(v) => void write([c.id], { enabled: v })} aria-label={`Reminders for ${c.name}`} />
                    </td>
                    <td className={WS_TD}>
                      <Switch checked={s.send_confirmation} disabled={saving || !canEdit} onCheckedChange={(v) => void write([c.id], { send_confirmation: v })} aria-label={`Filing confirmation for ${c.name}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
};

export default ReminderClientsTab;
