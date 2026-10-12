import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BriefcaseBusiness, History, Loader2, Plus, Save, Shield, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import {
  WS_BTN, WS_CONTROL, WS_PAGE, WS_TAB, WS_TABLE, WS_TABLE_WRAP, WS_TAB_ACTIVE, WS_TABS_LIST,
  WS_TD, WS_TH, WS_TR,
} from '@/components/workspace/theme';
import {
  PERMISSION_GROUPS, PERMISSION_LABEL, ROLE_ONLY_CONTROLS, permissionsInGroup,
} from '@/lib/permissionCatalog';

/**
 * User Control — positions.
 *
 * An employee's controls come from the ONE position they hold; the position
 * carries the permission keys. The database derives each user's
 * user_permissions from it (migration 20261014120000_staff_positions.sql) and
 * refuses direct grants, so every existing check keeps reading the same table.
 */

interface Position {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

interface Staff {
  user_id: string;
  first_name: string;
  email: string | null;
  role: 'gst_manager' | 'employee';
  position_id: string | null;
}

interface LogRow {
  id: number;
  at: string;
  action: string;
  position_name: string | null;
  user_id: string | null;
  permission_key: string | null;
  actor_id: string | null;
}

type Tab = 'positions' | 'people' | 'log';

const ROLE_LABEL: Record<Staff['role'], string> = { gst_manager: 'GST Manager', employee: 'Employee' };
const NONE = '__none__';

interface UserControlPageProps {
  /** Rendered inside the Settings "User Control" tab: smaller heading, no page chrome. */
  embedded?: boolean;
}

const UserControlPage: React.FC<UserControlPageProps> = ({ embedded = false }) => {
  const { user, canManagePositions } = useAuth();
  const confirm = useConfirm();

  const [tab, setTab] = useState<Tab>('positions');
  const [positions, setPositions] = useState<Position[]>([]);
  const [grants, setGrants] = useState<Record<string, Set<string>>>({});
  const [staff, setStaff] = useState<Staff[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<{ name: string; description: string; keys: Set<string> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pos, perms, roles, profiles, logRows] = await Promise.all([
        supabase.from('staff_positions').select('id, name, description, sort_order, is_active').order('sort_order').order('name'),
        supabase.from('staff_position_permissions').select('position_id, permission_key'),
        supabase.from('user_roles').select('user_id, role').in('role', ['gst_manager', 'employee']),
        supabase.from('profiles').select('user_id, first_name, email, position_id'),
        supabase.from('staff_position_log').select('*').order('at', { ascending: false }).limit(200),
      ]);
      for (const r of [pos, perms, roles, profiles]) if (r.error) throw r.error;

      setPositions((pos.data || []) as Position[]);
      const g: Record<string, Set<string>> = {};
      (perms.data || []).forEach((p) => {
        (g[p.position_id] ||= new Set()).add(p.permission_key);
      });
      setGrants(g);

      const roleOf = new Map<string, Staff['role']>();
      (roles.data || []).forEach((r) => { if (!roleOf.has(r.user_id)) roleOf.set(r.user_id, r.role as Staff['role']); });
      const seen = new Set<string>();
      const list: Staff[] = [];
      (profiles.data || []).forEach((p) => {
        const role = roleOf.get(p.user_id);
        if (!role || !p.first_name || seen.has(p.user_id)) return;
        seen.add(p.user_id);
        list.push({ user_id: p.user_id, first_name: p.first_name, email: p.email, role, position_id: p.position_id });
      });
      list.sort((a, b) => a.first_name.localeCompare(b.first_name));
      setStaff(list);
      setLog((logRows.data || []) as LogRow[]);
    } catch (e) {
      toast.error('Could not load positions: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = positions.find((p) => p.id === selectedId) || null;

  // Open the selected position in the editor.
  useEffect(() => {
    if (!selected) { setDraft(null); return; }
    setDraft({
      name: selected.name,
      description: selected.description || '',
      keys: new Set(grants[selected.id] || []),
    });
  }, [selected, grants]);

  const holders = useCallback(
    (positionId: string) => staff.filter((s) => s.position_id === positionId),
    [staff],
  );
  const nameOf = useMemo(() => new Map(staff.map((s) => [s.user_id, s.first_name])), [staff]);
  const positionName = useMemo(() => new Map(positions.map((p) => [p.id, p.name])), [positions]);

  const dirty = !!(draft && selected && (
    draft.name.trim() !== selected.name
    || (draft.description.trim() || null) !== (selected.description || null)
    || draft.keys.size !== (grants[selected.id]?.size || 0)
    || [...draft.keys].some((k) => !grants[selected.id]?.has(k))
  ));

  const createPosition = async () => {
    const name = newName.trim();
    if (!name) { toast.error('Give the position a name'); return; }
    const { data, error } = await supabase.from('staff_positions')
      .insert({ name, created_by: user?.id ?? null, sort_order: 100 })
      .select('id').single();
    if (error) { toast.error(error.code === '23505' ? 'A position with that name already exists' : error.message); return; }
    setNewName('');
    await load();
    setSelectedId(data.id);
    toast.success(`Position "${name}" created — tick its permissions and save`);
  };

  const savePosition = async () => {
    if (!selected || !draft) return;
    const name = draft.name.trim();
    if (!name) { toast.error('Give the position a name'); return; }
    setSaving(true);
    try {
      if (name !== selected.name || (draft.description.trim() || null) !== (selected.description || null)) {
        const { error } = await supabase.from('staff_positions')
          .update({ name, description: draft.description.trim() || null, updated_at: new Date().toISOString() })
          .eq('id', selected.id);
        if (error) throw error;
      }
      const before = grants[selected.id] || new Set<string>();
      const add = [...draft.keys].filter((k) => !before.has(k));
      const remove = [...before].filter((k) => !draft.keys.has(k));
      if (remove.length) {
        const { error } = await supabase.from('staff_position_permissions')
          .delete().eq('position_id', selected.id).in('permission_key', remove);
        if (error) throw error;
      }
      if (add.length) {
        const { error } = await supabase.from('staff_position_permissions')
          .insert(add.map((k) => ({ position_id: selected.id, permission_key: k, granted_by: user?.id ?? null })));
        if (error) throw error;
      }
      const n = holders(selected.id).length;
      toast.success(`Saved — applies to ${n} ${n === 1 ? 'person' : 'people'} in this position`);
      await load();
    } catch (e) {
      toast.error('Could not save: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!selected) return;
    const n = holders(selected.id).length;
    if (selected.is_active) {
      const ok = await confirm({
        title: `Retire "${selected.name}"?`,
        description: n
          ? `${n} ${n === 1 ? 'person holds' : 'people hold'} this position. They keep it, but lose all its permissions until it is reactivated or they are moved.`
          : 'It is hidden from the position list for new assignments and can be reactivated later.',
        confirmText: 'Retire',
      });
      if (!ok) return;
    }
    const { error } = await supabase.from('staff_positions')
      .update({ is_active: !selected.is_active, updated_at: new Date().toISOString() }).eq('id', selected.id);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  const deletePosition = async () => {
    if (!selected) return;
    const n = holders(selected.id).length;
    const ok = await confirm({
      title: `Delete "${selected.name}"?`,
      description: n
        ? `${n} ${n === 1 ? 'person' : 'people'} will be left with no position and lose every permission it gave them.`
        : 'This cannot be undone.',
      confirmText: 'Delete position',
    });
    if (!ok) return;
    const { error } = await supabase.from('staff_positions').delete().eq('id', selected.id);
    if (error) { toast.error(error.message); return; }
    setSelectedId('');
    await load();
  };

  const assign = async (s: Staff, positionId: string | null) => {
    const { error } = await supabase.rpc('staff_assign_position', {
      p_user_id: s.user_id, p_position_id: positionId, p_actor_id: user?.id ?? null,
    } as never);
    if (error) { toast.error(error.message); return; }
    toast.success(positionId
      ? `${s.first_name} is now ${positionName.get(positionId)}`
      : `${s.first_name} has no position — no permissions`);
    await load();
  };

  // Kept after every hook so hook order stays stable.
  if (!canManagePositions()) return <Navigate to="/dashboard" replace />;

  const employees = staff.filter((s) => s.role === 'employee');
  const unassigned = employees.filter((s) => !s.position_id).length;
  const activePositions = positions.filter((p) => p.is_active);

  return (
    <div className={embedded ? 'space-y-3' : WS_PAGE}>
      <PageHeader
        compact
        embedded={embedded}
        title="User Control"
        subtitle="Employees get their controls through positions"
        icon={<Shield />}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiTile label="Positions" value={activePositions.length} hint={positions.length > activePositions.length ? `${positions.length - activePositions.length} retired` : undefined} />
        <KpiTile label="Employees" value={employees.length} />
        <KpiTile label="Without a position" value={unassigned} tone={unassigned ? 'warn' : 'ok'} hint={unassigned ? 'they have no permissions' : undefined} />
        <KpiTile label="GST Managers" value={staff.length - employees.length} hint="every permission, by role" />
      </div>

      <div className={WS_TABS_LIST} role="tablist">
        {([
          ['positions', 'Positions', <BriefcaseBusiness key="i" className="h-4 w-4" />],
          ['people', 'People', <Users key="i" className="h-4 w-4" />],
          ['log', 'Change log', <History key="i" className="h-4 w-4" />],
        ] as const).map(([k, label, icon]) => (
          <button
            key={k} type="button" role="tab" aria-selected={tab === k}
            className={cn(WS_TAB, tab === k && WS_TAB_ACTIVE)}
            onClick={() => setTab(k)}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : tab === 'positions' ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <SectionCard
            className="lg:col-span-1"
            title="Positions"
            description="Pick one to edit its permissions. A change applies to everyone in it."
          >
            <div className="flex gap-2">
              <Input
                className={WS_CONTROL} placeholder="New position, e.g. GST Executive"
                value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void createPosition(); }}
              />
              <Button size="sm" className={WS_BTN} onClick={() => void createPosition()}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            <div className="divide-y rounded-md border">
              {positions.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No positions yet. Add one above.</p>
              )}
              {positions.map((p) => {
                const n = holders(p.id).length;
                return (
                  <button
                    key={p.id} type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40',
                      selectedId === p.id && 'bg-primary/[0.08]',
                      !p.is_active && 'text-muted-foreground',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {grants[p.id]?.size || 0} permission{(grants[p.id]?.size || 0) === 1 ? '' : 's'} · {n} {n === 1 ? 'person' : 'people'}
                      </span>
                    </span>
                    {!p.is_active && <Badge variant="outline" className="text-[10px]">Retired</Badge>}
                  </button>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            className="lg:col-span-2"
            title={draft ? draft.name || 'Position' : 'Permissions'}
            description={selected
              ? `${holders(selected.id).map((s) => s.first_name).join(', ') || 'Nobody holds this position yet'}`
              : 'Select a position on the left'}
            actions={selected && draft ? (
              <>
                <Button variant="outline" size="sm" className={WS_BTN} onClick={() => void toggleActive()}>
                  {selected.is_active ? 'Retire' : 'Reactivate'}
                </Button>
                <Button variant="outline" size="sm" className={cn(WS_BTN, 'text-destructive')} onClick={() => void deletePosition()}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
                <Button size="sm" className={WS_BTN} onClick={() => void savePosition()} disabled={!dirty || saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                </Button>
              </>
            ) : undefined}
          >
            {!selected || !draft ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
                <BriefcaseBusiness className="mb-3 h-10 w-10 opacity-40" />
                Select or add a position to set what its holders can do.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="pos-name" className="text-xs">Name</Label>
                    <Input id="pos-name" className={WS_CONTROL} value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pos-desc" className="text-xs">What the job is</Label>
                    <Input id="pos-desc" className={WS_CONTROL} value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  </div>
                </div>
                {!selected.is_active && (
                  <Note tone="warn">Retired: its holders have none of these permissions until it is reactivated.</Note>
                )}
                {PERMISSION_GROUPS.map((g) => {
                  const items = permissionsInGroup(g.key);
                  if (!items.length) return null;
                  const all = items.every((p) => draft.keys.has(p.key));
                  return (
                    <div key={g.key} className="rounded-md border">
                      <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1.5">
                        <span className="text-sm font-semibold">{g.label}</span>
                        <button
                          type="button" className="text-xs text-primary hover:underline"
                          onClick={() => {
                            const keys = new Set(draft.keys);
                            items.forEach((p) => (all ? keys.delete(p.key) : keys.add(p.key)));
                            setDraft({ ...draft, keys });
                          }}
                        >
                          {all ? 'Clear group' : 'Tick all'}
                        </button>
                      </div>
                      <div className="grid gap-x-4 sm:grid-cols-2">
                        {items.map((p) => (
                          <label key={p.key} htmlFor={`perm-${p.key}`} className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-muted/30">
                            <Checkbox
                              id={`perm-${p.key}`} className="mt-0.5"
                              checked={draft.keys.has(p.key)}
                              onCheckedChange={(c) => {
                                const keys = new Set(draft.keys);
                                if (c) keys.add(p.key); else keys.delete(p.key);
                                setDraft({ ...draft, keys });
                              }}
                            />
                            <span className="space-y-0.5">
                              <span className="block text-sm font-medium">{p.label}</span>
                              <span className="block text-xs text-muted-foreground">{p.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <Note tone="position">
                  Never given through a position — GST Manager or Superadmin by role only:{' '}
                  {ROLE_ONLY_CONTROLS.join('; ')}.
                </Note>
              </div>
            )}
          </SectionCard>
        </div>
      ) : tab === 'people' ? (
        <SectionCard
          title="People and their positions"
          description="Each employee holds one position and gets exactly its permissions. GST Managers and the Superadmin have every permission by role."
        >
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE} aria-label="Staff positions">
              <thead>
                <tr>
                  <th className={WS_TH}>Name</th>
                  <th className={WS_TH}>Role</th>
                  <th className={WS_TH}>Position</th>
                  <th className={cn(WS_TH, 'border-r-0')}>Permissions</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const keys = s.position_id ? grants[s.position_id] : undefined;
                  const pos = positions.find((p) => p.id === s.position_id);
                  return (
                    <tr key={s.user_id} className={WS_TR}>
                      <td className={WS_TD}>
                        <span className="font-medium">{s.first_name}</span>
                        {s.email && <span className="block text-xs text-muted-foreground">{s.email}</span>}
                      </td>
                      <td className={WS_TD}>
                        <Badge variant={s.role === 'gst_manager' ? 'default' : 'secondary'} className="text-[10px]">{ROLE_LABEL[s.role]}</Badge>
                      </td>
                      <td className={cn(WS_TD, 'min-w-[220px]')}>
                        <Select
                          value={s.position_id || NONE}
                          onValueChange={(v) => void assign(s, v === NONE ? null : v)}
                        >
                          <SelectTrigger className={WS_CONTROL}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>No position</SelectItem>
                            {positions.filter((p) => p.is_active || p.id === s.position_id).map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}{p.is_active ? '' : ' (retired)'}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={cn(WS_TD, 'border-r-0 text-xs text-muted-foreground')}>
                        {s.role === 'gst_manager'
                          ? 'All, by role'
                          : !s.position_id
                            ? <span className="text-warning">None — assign a position</span>
                            : pos && !pos.is_active
                              ? <span className="text-warning">None — position retired</span>
                              : [...(keys || [])].map((k) => PERMISSION_LABEL[k] || k).join(', ') || 'None'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="Change log" description="Every position created, renamed, retired, permission granted or revoked, and person moved (latest 200).">
          <div className={cn(WS_TABLE_WRAP, 'max-h-[60vh]')}>
            <table className={WS_TABLE} aria-label="Position change log">
              <thead>
                <tr>
                  <th className={WS_TH}>When</th>
                  <th className={WS_TH}>Change</th>
                  <th className={WS_TH}>Position</th>
                  <th className={WS_TH}>Person / permission</th>
                  <th className={cn(WS_TH, 'border-r-0')}>By</th>
                </tr>
              </thead>
              <tbody>
                {log.length === 0 && (
                  <tr><td colSpan={5} className={cn(WS_TD, 'border-r-0 py-6 text-center text-muted-foreground')}>No changes yet.</td></tr>
                )}
                {log.map((l) => (
                  <tr key={l.id} className={WS_TR}>
                    <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums')}>{new Date(l.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className={cn(WS_TD, 'capitalize')}>{l.action}</td>
                    <td className={WS_TD}>{l.position_name || '—'}</td>
                    <td className={WS_TD}>
                      {l.user_id ? nameOf.get(l.user_id) || l.user_id.slice(0, 8) : ''}
                      {l.permission_key ? PERMISSION_LABEL[l.permission_key] || l.permission_key : ''}
                    </td>
                    <td className={cn(WS_TD, 'border-r-0')}>{l.actor_id ? nameOf.get(l.actor_id) || (l.actor_id === user?.id ? 'You' : 'Superadmin') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
};

export default UserControlPage;
