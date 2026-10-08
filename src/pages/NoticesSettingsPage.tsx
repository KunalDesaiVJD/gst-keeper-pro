// Notices · Settings (the firm's request of 8 October 2026): which clients'
// litigation the firm handles, and the clients whose GST portal login the
// portal refused, for the team to fix. A client switched off leaves every task,
// list, count and alert of the module and is not synced for notices; back on,
// everything returns (migration 20261010100000). A password issue is set by the
// extension, skipped by every sync, and cleared when the user ID or password is
// changed in Edit Client (or here, once fixed on the portal).
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { Panel } from '@/components/notices/ui/Panel';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterPill } from '@/components/notices/FilterPill';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { fmtAgo } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

export interface ClientSetting {
  id: string;
  name: string;
  gstin: string;
  gst_user_id: string | null;
  notices_handled: boolean;
  notices_sync_excluded: boolean;
  inactive_at_hand: boolean;
  open_notices: number;
  portal_login_issue: string | null;
  portal_login_issue_message: string | null;
  portal_login_issue_at: string | null;
}

export const LOGIN_ISSUE: Record<string, string> = {
  wrong_password: 'Wrong user ID or password',
  account_locked: 'Account locked on the portal',
  password_expired: 'Password expired',
  password_change_required: 'Portal asks for a new password',
};

function useClientSettings() {
  return useQuery({
    queryKey: ['notices-client-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('notices_client_settings');
      if (error) throw error;
      return (data ?? []) as ClientSetting[];
    },
  });
}

const NoticesSettingsPage: React.FC = () => {
  const { canAddEditClients } = useAuth();
  const canEdit = canAddEditClients();
  const qc = useQueryClient();
  const q = useClientSettings();
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'all' | 'on' | 'off'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const rows = q.data ?? [];
  const issues = rows.filter((r) => r.portal_login_issue);
  const handledCount = rows.filter((r) => r.notices_handled).length;
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => (show === 'all' || (show === 'on') === r.notices_handled)
      && (!s || r.name.toLowerCase().includes(s) || (r.gstin ?? '').toLowerCase().includes(s)));
  }, [rows, search, show]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notices-client-settings'] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['notice-facts'] });
  };
  const setHandled = async (ids: string[], handled: boolean) => {
    if (!ids.length) return;
    setBusy(true);
    const { error } = await supabase.rpc('notices_clients_handled_set', { p_client_ids: ids, p_handled: handled });
    setBusy(false);
    if (error) { toast.error(`Could not save: ${error.message}`); return; }
    toast.success(`${ids.length === 1 ? 'Client' : `${ids.length} clients`} ${handled ? 'handled again: back in every list and sync' : 'switched off: left out of every task, list and sync'}.`);
    setPicked(new Set());
    refresh();
  };
  const markFixed = async (r: ClientSetting) => {
    const { error } = await supabase.rpc('client_login_issue_set', { p_client_id: r.id, p_reason: null, p_message: null });
    if (error) { toast.error(`Could not save: ${error.message}`); return; }
    toast.success(`${r.name} will be synced again.`);
    refresh();
  };
  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));
  const toggleAll = () => setPicked(allShownPicked ? new Set() : new Set(shown.map((r) => r.id)));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <NoticesShell section="Settings">
      <div className="space-y-3">
        <Panel
          title={<span className="inline-flex items-center gap-1.5"><KeyRound className="h-4 w-4" aria-hidden /> Portal password issues · {issues.length}</span>}
          info="The GST portal refused these clients' saved login. Every sync skips them until the password is fixed: change it in Edit Client (that clears the issue by itself), or press Fixed once it is corrected on the portal."
        >
          {q.isLoading ? <Skeleton className="h-16 w-full" />
            : issues.length === 0 ? <p className="text-sm text-muted-foreground">No client has a password issue. Every client with credentials is synced.</p>
            : (
              <div className={WS_TABLE_WRAP}>
                <table className={WS_TABLE}>
                  <thead><tr>
                    <th scope="col" className={WS_TH}>Client</th>
                    <th scope="col" className={WS_TH}>Issue</th>
                    <th scope="col" className={WS_TH}>The portal said</th>
                    <th scope="col" className={WS_TH}>Since</th>
                    <th scope="col" className={WS_TH}><span className="sr-only">Actions</span></th>
                  </tr></thead>
                  <tbody>
                    {issues.map((r) => (
                      <tr key={r.id} className={WS_TR}>
                        <td className={WS_TD}><div className="text-sm font-medium">{r.name}</div><div className="font-mono text-[11px] text-muted-foreground">{r.gstin} · {r.gst_user_id ?? 'no user ID'}</div></td>
                        <td className={cn(WS_TD, 'text-sm font-medium text-destructive-strong')}>{LOGIN_ISSUE[r.portal_login_issue ?? ''] ?? r.portal_login_issue}</td>
                        <td className={cn(WS_TD, 'max-w-[26rem] text-xs')}>{r.portal_login_issue_message ?? '—'}</td>
                        <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{fmtAgo(r.portal_login_issue_at)}</td>
                        <td className={cn(WS_TD, 'whitespace-nowrap text-right')}>
                          {canEdit && <Button asChild size="sm" variant="outline" className={WS_BTN}><Link to={`/edit-client/${r.id}`}>Change password</Link></Button>}{' '}
                          {canEdit && <Button size="sm" variant="ghost" className={WS_BTN} onClick={() => markFixed(r)}>Fixed</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Panel>

        <Panel
          title={`Clients whose litigation we handle · ${handledCount} of ${rows.length}`}
          info="Switched off: the client's notices leave the command centre, the work queue, every list, report and alert, and the notices sync skips the client. Switch it back on and everything returns, with nothing lost."
          actions={canEdit && picked.size > 0 ? (
            <>
              <span className="text-xs text-muted-foreground">{picked.size} selected</span>
              <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={() => setHandled([...picked], true)}>Handle</Button>
              <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={() => setHandled([...picked], false)}>Switch off</Button>
            </>
          ) : undefined}
        >
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Client or GSTIN" className="h-9 pl-8 text-sm" aria-label="Search clients" />
            </div>
            <FilterPill label="Show" allLabel="All" value={show} onChange={(v) => setShow((v as 'on' | 'off') || 'all')} options={[]}
              extraOptions={[{ value: 'on', label: 'Handled' }, { value: 'off', label: 'Not handled' }]} />
          </div>
          {q.isLoading ? <Skeleton className="h-64 w-full" /> : q.error ? <p className="text-sm text-destructive-strong">Could not load the clients: {(q.error as Error).message}</p> : (
            <div className={WS_TABLE_WRAP}>
              <table className={WS_TABLE}>
                <thead><tr>
                  {canEdit && <th scope="col" className={cn(WS_TH, 'w-8')}><Checkbox checked={allShownPicked} onCheckedChange={toggleAll} aria-label="Select every client shown" /></th>}
                  <th scope="col" className={WS_TH}>Client</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Open notices</th>
                  <th scope="col" className={WS_TH}>Notes</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>We handle it</th>
                </tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className={cn(WS_TR, !r.notices_handled && 'opacity-70')}>
                      {canEdit && <td className={WS_TD}><Checkbox checked={picked.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>}
                      <td className={WS_TD}><div className="text-sm font-medium">{r.name}</div><div className="font-mono text-[11px] text-muted-foreground">{r.gstin}</div></td>
                      <td className={WS_TD_NUM}>
                        {r.notices_handled && r.open_notices > 0
                          ? <Link to={`/notices-all?client=${r.id}`} className="text-primary underline underline-offset-2">{r.open_notices}</Link>
                          : r.open_notices}
                      </td>
                      <td className={cn(WS_TD, 'text-xs text-muted-foreground')}>
                        {[!r.gst_user_id && 'no portal user ID', r.inactive_at_hand && 'inactive', r.portal_login_issue && (LOGIN_ISSUE[r.portal_login_issue] ?? 'password issue'),
                          r.notices_handled && r.notices_sync_excluded && 'not synced'].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className={cn(WS_TD, 'text-right')}>
                        <Switch checked={r.notices_handled} disabled={!canEdit || busy} onCheckedChange={(v) => setHandled([r.id], v)}
                          aria-label={`We handle ${r.name}'s litigation`} />
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={5} className={cn(WS_TD, 'text-center text-sm text-muted-foreground')}>No client matches.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {!canEdit && <p className="pt-2 text-[11px] text-muted-foreground">Changing these needs the permission to add and edit clients.</p>}
        </Panel>
      </div>
    </NoticesShell>
  );
};

export default NoticesSettingsPage;
