import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BriefcaseBusiness, History, ListChecks, Loader2, Plus, PlusCircle, Save, Shield, Trash2, Users,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import SuperadminPasswordDialog from '@/components/dialogs/SuperadminPasswordDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import {
  WS_BTN, WS_CONTROL, WS_PAGE, WS_TAB, WS_TABLE, WS_TABLE_WRAP, WS_TAB_ACTIVE, WS_TABS_LIST,
  WS_TD, WS_TH, WS_TR,
} from '@/components/workspace/theme';
import {
  PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABEL, ROLE_ONLY_CONTROLS, permissionsInGroup,
} from '@/lib/permissionCatalog';
import { setStaffLevel, STAFF_LEVEL_LABEL, type StaffLevel } from '@/lib/staffLevels';

/**
 * User Control — roles plus extra permissions.
 *
 * An employee holds ONE role (staff_positions, its keys in
 * staff_position_permissions) and may be given EXTRA permissions on top of it
 * (staff_user_extra_permissions, set through staff_set_user_extras). The
 * database derives each user's user_permissions = role keys ∪ extras
 * (migrations 20261014120000, 20261025100000) and refuses direct grants, so
 * every existing check keeps reading the same table.
 */

interface Position {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  /** Carried over from per-person permissions on 12 Oct; retired 25 Oct. */
  is_legacy: boolean;
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

type Tab = 'people' | 'positions' | 'catalog' | 'log';

const ROLE_LABEL: Record<Staff['role'], string> = { gst_manager: 'GST Manager', employee: 'Employee' };
const NONE = '__none__';
const KNOWN = new Set(PERMISSIONS.map((p) => p.key));

const LOG_LABEL: Record<string, string> = {
  grant: 'Added to role',
  revoke: 'Removed from role',
  assign: 'Role given',
  unassign: 'Role taken away',
  'grant extra': 'Extra given',
  'revoke extra': 'Extra taken away',
  create: 'Role created',
  rename: 'Role renamed',
  retire: 'Role retired',
  reactivate: 'Role reactivated',
  delete: 'Role deleted',
};

/** A key the app no longer checks (e.g. manage_clients) shows as itself. */
const labelOf = (k: string) => PERMISSION_LABEL[k] || `${k} (no longer used)`;

interface UserControlPageProps {
  /** Rendered inside the Settings "User Control" tab: smaller heading, no page chrome. */
  embedded?: boolean;
}

const UserControlPage: React.FC<UserControlPageProps> = ({ embedded = false }) => {
  const { user, canManagePositions, canChangeStaffLevel } = useAuth();
  const confirm = useConfirm();
  // A level change waiting for the superadmin's password (staff_set_level).
  const [levelAsk, setLevelAsk] = useState<{ person: Staff; level: StaffLevel } | null>(null);
  // Set while the level list closes to make way for the password prompt, so
  // the list does not take focus back from the password box.
  const passwordNext = useRef(false);

  const [tab, setTab] = useState<Tab>('people');
  const [positions, setPositions] = useState<Position[]>([]);
  const [grants, setGrants] = useState<Record<string, Set<string>>>({});
  const [extras, setExtras] = useState<Record<string, Set<string>>>({});
  // False until 20261025100000 is applied: extras cannot be read or set.
  const [extrasReady, setExtrasReady] = useState(true);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<{ name: string; description: string; keys: Set<string> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  // The person whose extra permissions are open in the dialog.
  const [extraFor, setExtraFor] = useState<Staff | null>(null);
  const [extraDraft, setExtraDraft] = useState<Set<string>>(new Set());
  const [extraSaving, setExtraSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pos, perms, roles, profiles, logRows, extra] = await Promise.all([
        supabase.from('staff_positions').select('id, name, description, sort_order, is_active, is_legacy').order('sort_order').order('name'),
        supabase.from('staff_position_permissions').select('position_id, permission_key'),
        supabase.from('user_roles').select('user_id, role').in('role', ['gst_manager', 'employee']),
        supabase.from('profiles').select('user_id, first_name, email, position_id'),
        supabase.from('staff_position_log').select('*').order('at', { ascending: false }).limit(200),
        supabase.from('staff_user_extra_permissions').select('user_id, permission_key'),
      ]);
      for (const r of [pos, perms, roles, profiles]) if (r.error) throw r.error;

      setPositions((pos.data || []) as Position[]);
      const g: Record<string, Set<string>> = {};
      (perms.data || []).forEach((p) => {
        (g[p.position_id] ||= new Set()).add(p.permission_key);
      });
      setGrants(g);

      setExtrasReady(!extra.error);
      const x: Record<string, Set<string>> = {};
      (extra.data || []).forEach((p) => {
        (x[p.user_id] ||= new Set()).add(p.permission_key);
      });
      setExtras(x);

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
      toast.error('Could not load roles: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = positions.find((p) => p.id === selectedId) || null;

  // Open the selected role in the editor.
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
  const positionById = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);

  /** The keys a person's role gives them (none while the role is retired). */
  const roleKeys = useCallback((s: Staff): Set<string> => {
    const pos = s.position_id ? positionById.get(s.position_id) : undefined;
    return pos && pos.is_active ? grants[pos.id] || new Set() : new Set();
  }, [positionById, grants]);

  const dirty = !!(draft && selected && (
    draft.name.trim() !== selected.name
    || (draft.description.trim() || null) !== (selected.description || null)
    || draft.keys.size !== (grants[selected.id]?.size || 0)
    || [...draft.keys].some((k) => !grants[selected.id]?.has(k))
  ));

  const createPosition = async () => {
    const name = newName.trim();
    if (!name) { toast.error('Give the role a name'); return; }
    const { data, error } = await supabase.from('staff_positions')
      .insert({ name, created_by: user?.id ?? null, sort_order: 100 })
      .select('id').single();
    if (error) { toast.error(error.code === '23505' ? 'A role with that name already exists' : error.message); return; }
    setNewName('');
    await load();
    setSelectedId(data.id);
    toast.success(`Role "${name}" created: tick its permissions and save`);
  };

  const savePosition = async () => {
    if (!selected || !draft) return;
    const name = draft.name.trim();
    if (!name) { toast.error('Give the role a name'); return; }
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
      toast.success(`Saved: applies to ${n} ${n === 1 ? 'person' : 'people'} in this role`);
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
          ? `${n} ${n === 1 ? 'person holds' : 'people hold'} this role. They keep it, and their extra permissions, but lose the role's permissions until it is reactivated or they are moved.`
          : 'It is hidden from the role list for new assignments and can be reactivated later.',
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
        ? `${n} ${n === 1 ? 'person' : 'people'} will be left with no role and lose every permission it gave them (their extra permissions stay).`
        : 'This cannot be undone.',
      confirmText: 'Delete role',
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
      ? `${s.first_name} is now ${positionById.get(positionId)?.name ?? 'in that role'}`
      : `${s.first_name} has no role: only their extra permissions`);
    await load();
  };

  const openExtras = (s: Staff) => {
    setExtraFor(s);
    setExtraDraft(new Set(extras[s.user_id] || []));
  };

  const saveExtras = async () => {
    if (!extraFor || !user) return;
    setExtraSaving(true);
    try {
      const { error } = await supabase.rpc('staff_set_user_extras', {
        p_actor_id: user.id, p_user_id: extraFor.user_id, p_keys: [...extraDraft],
      });
      if (error) throw error;
      toast.success(`${extraFor.first_name}'s extra permissions saved`);
      setExtraFor(null);
      await load();
    } catch (e) {
      toast.error('Could not save: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExtraSaving(false);
    }
  };

  const changeLevel = async (password: string): Promise<boolean> => {
    if (!levelAsk || !user) return false;
    const { person, level } = levelAsk;
    try {
      await setStaffLevel(user.id, password, person.user_id, level);
      toast.success(level === 'employee' && !person.position_id
        ? `${person.first_name} is now an Employee: choose their role to give them permissions`
        : `${person.first_name} is now ${level === 'gst_manager' ? 'a GST Manager' : 'an Employee'}`);
      void load();
      return true;
    } catch (e) {
      toast.error('Not done: ' + (e instanceof Error ? e.message : String(e)));
      return false;
    }
  };

  // Kept after every hook so hook order stays stable.
  if (!canManagePositions()) return <Navigate to="/dashboard" replace />;

  const employees = staff.filter((s) => s.role === 'employee');
  const unassigned = employees.filter((s) => !s.position_id).length;
  const withExtras = employees.filter((s) => (extras[s.user_id]?.size || 0) > 0).length;
  const activePositions = positions.filter((p) => p.is_active && !p.is_legacy);
  const shownPositions = positions.filter((p) => !p.is_legacy || holders(p.id).length > 0);

  // The extra-permissions dialog's figures.
  const dlgRole = extraFor ? roleKeys(extraFor) : new Set<string>();
  const dlgRoleName = extraFor?.position_id ? positionById.get(extraFor.position_id)?.name : undefined;
  const dlgUnknown = [...extraDraft].filter((k) => !KNOWN.has(k));
  const dlgTotal = new Set([...dlgRole, ...extraDraft]).size;

  return (
    <div className={embedded ? 'space-y-3' : WS_PAGE}>
      <PageHeader
        compact
        embedded={embedded}
        title="User Control"
        subtitle="Each employee gets a role, plus any extra permissions you give them"
        icon={<Shield />}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KpiTile label="Employees" value={employees.length} />
        <KpiTile label="Roles" value={activePositions.length} hint={positions.some((p) => !p.is_active && !p.is_legacy) ? `${positions.filter((p) => !p.is_active && !p.is_legacy).length} retired` : undefined} />
        <KpiTile label="With extra permissions" value={withExtras} hint="on top of their role" />
        <KpiTile label="Without a role" value={unassigned} tone={unassigned ? 'warn' : 'ok'} hint={unassigned ? 'only their extras' : undefined} />
        <KpiTile label="GST Managers" value={staff.length - employees.length} hint="every permission, by level" />
      </div>

      <div className={WS_TABS_LIST} role="tablist">
        {([
          ['people', 'People', <Users key="i" className="h-4 w-4" />],
          ['positions', 'Roles', <BriefcaseBusiness key="i" className="h-4 w-4" />],
          ['catalog', 'Permission list', <ListChecks key="i" className="h-4 w-4" />],
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
      ) : tab === 'people' ? (
        <SectionCard
          title="People"
          description={`Pick a role for each employee; use "Give extra" for anything one person needs beyond their role. GST Managers and the Superadmin have every permission by level. ${canChangeStaffLevel() ? 'Changing a level asks for your password.' : 'Only the superadmin changes a level.'}`}
        >
          {!extrasReady && (
            <Note tone="warn">Extra permissions are not switched on in the database yet. Roles work as before.</Note>
          )}
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE} aria-label="Staff access">
              <thead>
                <tr>
                  <th className={WS_TH}>Name</th>
                  <th className={WS_TH}>Level</th>
                  <th className={WS_TH}>Role</th>
                  <th className={WS_TH}>Extra permissions</th>
                  <th className={cn(WS_TH, 'border-r-0')}>Can do</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const pos = s.position_id ? positionById.get(s.position_id) : undefined;
                  const mine = [...(extras[s.user_id] || [])];
                  const total = new Set([...roleKeys(s), ...mine]).size;
                  return (
                    <tr key={s.user_id} className={WS_TR}>
                      <td className={WS_TD}>
                        <span className="font-medium">{s.first_name}</span>
                        {s.email && <span className="block text-xs text-muted-foreground">{s.email}</span>}
                      </td>
                      <td className={cn(WS_TD, canChangeStaffLevel() && 'min-w-[150px]')}>
                        {canChangeStaffLevel() ? (
                          <Select
                            value={s.role}
                            onValueChange={(v) => {
                              if (v === s.role) return;
                              passwordNext.current = true;
                              setLevelAsk({ person: s, level: v as StaffLevel });
                            }}
                          >
                            <SelectTrigger className={WS_CONTROL} aria-label={`Level of ${s.first_name}`}><SelectValue /></SelectTrigger>
                            <SelectContent onCloseAutoFocus={(e) => { if (passwordNext.current) { e.preventDefault(); passwordNext.current = false; } }}>
                              <SelectItem value="employee">{STAFF_LEVEL_LABEL.employee}</SelectItem>
                              <SelectItem value="gst_manager">{STAFF_LEVEL_LABEL.gst_manager}</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span title="Only the superadmin changes a level">
                            <Badge variant={s.role === 'gst_manager' ? 'default' : 'secondary'} className="text-[10px]">{ROLE_LABEL[s.role]}</Badge>
                          </span>
                        )}
                      </td>
                      {s.role === 'gst_manager' ? (
                        <>
                          <td className={cn(WS_TD, 'text-xs text-muted-foreground')}>Not needed</td>
                          <td className={cn(WS_TD, 'text-xs text-muted-foreground')}>Not needed</td>
                          <td className={cn(WS_TD, 'border-r-0 text-xs text-muted-foreground')}>Everything</td>
                        </>
                      ) : (
                        <>
                          <td className={cn(WS_TD, 'min-w-[210px]')}>
                            <Select
                              value={s.position_id || NONE}
                              onValueChange={(v) => void assign(s, v === NONE ? null : v)}
                            >
                              <SelectTrigger className={WS_CONTROL} aria-label={`Role of ${s.first_name}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>No role</SelectItem>
                                {positions.filter((p) => (p.is_active && !p.is_legacy) || p.id === s.position_id).map((p) => (
                                  <SelectItem key={p.id} value={p.id} disabled={p.is_legacy}>
                                    {p.name}{p.is_legacy ? ' (old, choose a role)' : p.is_active ? '' : ' (retired)'}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {pos && !pos.is_active && !pos.is_legacy && (
                              <span className="mt-1 block text-xs text-warning">Role retired: its permissions are off</span>
                            )}
                          </td>
                          <td className={cn(WS_TD, 'min-w-[220px]')}>
                            <div className="flex flex-wrap items-center gap-1">
                              {mine.map((k) => (
                                <Badge key={k} variant="outline" className="text-[11px] font-normal">{labelOf(k)}</Badge>
                              ))}
                              <Button
                                variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-primary"
                                disabled={!extrasReady}
                                onClick={() => openExtras(s)}
                              >
                                <PlusCircle className="h-3.5 w-3.5" /> {mine.length ? 'Change' : 'Give extra'}
                              </Button>
                            </div>
                          </td>
                          <td className={cn(WS_TD, 'border-r-0 whitespace-nowrap text-xs')}>
                            {total === 0
                              ? <span className="text-warning">Nothing: choose a role</span>
                              : <span className="tabular-nums">{total} of {PERMISSIONS.length}</span>}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : tab === 'positions' ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <SectionCard
            className="lg:col-span-1"
            title="Roles"
            description="A role is the usual set of permissions for a job. A change applies to everyone in it."
          >
            <div className="flex gap-2">
              <Input
                className={WS_CONTROL} placeholder="New role, e.g. Article Assistant"
                value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void createPosition(); }}
              />
              <Button size="sm" className={WS_BTN} onClick={() => void createPosition()}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            <div className="divide-y rounded-md border">
              {shownPositions.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No roles yet. Add one above.</p>
              )}
              {shownPositions.map((p) => {
                const n = holders(p.id).length;
                const k = grants[p.id]?.size || 0;
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
                        {k} permission{k === 1 ? '' : 's'} · {n} {n === 1 ? 'person' : 'people'}
                      </span>
                    </span>
                    {p.is_legacy
                      ? <Badge variant="warning" className="text-[10px]">Old</Badge>
                      : !p.is_active && <Badge variant="outline" className="text-[10px]">Retired</Badge>}
                  </button>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            className="lg:col-span-2"
            title={draft ? draft.name || 'Role' : 'Permissions'}
            description={selected
              ? `${holders(selected.id).map((s) => s.first_name).join(', ') || 'Nobody holds this role yet'}`
              : 'Select a role on the left'}
            actions={selected && draft && !selected.is_legacy ? (
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
                Select or add a role to set what its holders can do.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="pos-name" className="text-xs">Name</Label>
                    <Input id="pos-name" className={WS_CONTROL} value={draft.name} disabled={selected.is_legacy}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pos-desc" className="text-xs">What the job is</Label>
                    <Input id="pos-desc" className={WS_CONTROL} value={draft.description} disabled={selected.is_legacy}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  </div>
                </div>
                {selected.is_legacy && (
                  <Note tone="warn">
                    Old per-person role, being retired: it keeps working for the people still on it, but cannot be
                    changed or given to anyone. Choose a role for each of them on the People tab.
                  </Note>
                )}
                {!selected.is_active && !selected.is_legacy && (
                  <Note tone="warn">Retired: its holders have none of these permissions until it is reactivated.</Note>
                )}
                <PermissionPicker
                  isOn={(k) => draft.keys.has(k)}
                  disabled={selected.is_legacy}
                  onChange={(keys, on) => {
                    const next = new Set(draft.keys);
                    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
                    setDraft({ ...draft, keys: next });
                  }}
                />
                <Note tone="info">
                  One person needs something more than their role? Do not make a new role for them: open People and
                  use <b>Give extra</b> on their row.
                </Note>
              </div>
            )}
          </SectionCard>
        </div>
      ) : tab === 'catalog' ? (
        <SectionCard
          title="Permission list"
          description="Every permission an employee can hold, what it allows, and who has it."
        >
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE} aria-label="Permission list">
              <thead>
                <tr>
                  <th className={WS_TH}>Permission</th>
                  <th className={WS_TH}>What it allows</th>
                  <th className={WS_TH}>In roles</th>
                  <th className={cn(WS_TH, 'border-r-0')}>Given as an extra to</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSION_GROUPS.map((g) => {
                  const items = permissionsInGroup(g.key);
                  if (!items.length) return null;
                  return (
                    <React.Fragment key={g.key}>
                      <tr>
                        <td colSpan={4} className={cn(WS_TD, 'border-r-0 bg-muted/50 text-xs font-semibold uppercase tracking-wide')}>{g.label}</td>
                      </tr>
                      {items.map((p) => {
                        const inRoles = activePositions.filter((pos) => grants[pos.id]?.has(p.key));
                        const asExtra = employees.filter((s) => extras[s.user_id]?.has(p.key));
                        return (
                          <tr key={p.key} className={WS_TR}>
                            <td className={cn(WS_TD, 'font-medium')}>{p.label}</td>
                            <td className={cn(WS_TD, 'text-xs text-muted-foreground')}>{p.description}</td>
                            <td className={cn(WS_TD, 'text-xs')}>
                              {inRoles.length ? inRoles.map((r) => r.name).join(', ') : <span className="text-muted-foreground">None</span>}
                            </td>
                            <td className={cn(WS_TD, 'border-r-0 text-xs')}>
                              {asExtra.length ? asExtra.map((s) => s.first_name).join(', ') : <span className="text-muted-foreground">Nobody</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Note tone="position">
            Never given to an employee, by role or as an extra; GST Managers and the Superadmin only:{' '}
            {ROLE_ONLY_CONTROLS.join('; ')}.
          </Note>
        </SectionCard>
      ) : (
        <SectionCard title="Change log" description="Every role created, renamed or retired, permission added or removed, extra given or taken, and person moved (latest 200).">
          <div className={cn(WS_TABLE_WRAP, 'max-h-[60vh]')}>
            <table className={WS_TABLE} aria-label="Role change log">
              <thead>
                <tr>
                  <th className={WS_TH}>When</th>
                  <th className={WS_TH}>Change</th>
                  <th className={WS_TH}>Role</th>
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
                    <td className={WS_TD}>{LOG_LABEL[l.action] || l.action}</td>
                    <td className={WS_TD}>{l.position_name || '—'}</td>
                    <td className={WS_TD}>
                      {[l.user_id ? nameOf.get(l.user_id) || l.user_id.slice(0, 8) : '', l.permission_key ? labelOf(l.permission_key) : '']
                        .filter(Boolean).join(': ')}
                    </td>
                    <td className={cn(WS_TD, 'border-r-0')}>{l.actor_id ? nameOf.get(l.actor_id) || (l.actor_id === user?.id ? 'You' : 'Superadmin') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <Dialog open={!!extraFor} onOpenChange={(open) => { if (!open) setExtraFor(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{extraFor?.first_name}: extra permissions</DialogTitle>
            <DialogDescription>
              {dlgRoleName
                ? <>Ticked and greyed out comes with the role <b>{dlgRoleName}</b>. Tick anything else {extraFor?.first_name} needs.</>
                : <>{extraFor?.first_name} has no role. Tick what they need, or give them a role on the People tab.</>}
            </DialogDescription>
          </DialogHeader>
          <PermissionPicker
            isOn={(k) => dlgRole.has(k) || extraDraft.has(k)}
            isLocked={(k) => dlgRole.has(k)}
            isExtra={(k) => !dlgRole.has(k) && extraDraft.has(k)}
            onChange={(keys, on) => {
              const next = new Set(extraDraft);
              keys.filter((k) => !dlgRole.has(k)).forEach((k) => (on ? next.add(k) : next.delete(k)));
              setExtraDraft(next);
            }}
          />
          {dlgUnknown.length > 0 && (
            <Note tone="warn">
              Also held, but no longer checked anywhere in the app: {dlgUnknown.join(', ')}.{' '}
              <button
                type="button" className="text-primary hover:underline"
                onClick={() => setExtraDraft(new Set([...extraDraft].filter((k) => KNOWN.has(k))))}
              >
                Remove
              </button>
            </Note>
          )}
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {dlgTotal} permission{dlgTotal === 1 ? '' : 's'} in all
              {' '}({dlgRole.size} from the role, {[...extraDraft].filter((k) => !dlgRole.has(k)).length} extra)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => setExtraFor(null)}>Cancel</Button>
              <Button size="sm" className={WS_BTN} onClick={() => void saveExtras()} disabled={extraSaving}>
                {extraSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SuperadminPasswordDialog
        open={!!levelAsk}
        title={levelAsk ? `Make ${levelAsk.person.first_name} ${levelAsk.level === 'gst_manager' ? 'a GST Manager' : 'an Employee'}` : ''}
        confirmText="Change level"
        onOpenChange={(open) => { if (!open) setLevelAsk(null); }}
        onConfirm={changeLevel}
      />
    </div>
  );
};

/** The permission list as grouped tick boxes, shared by the role editor and the extras dialog. */
const PermissionPicker: React.FC<{
  isOn: (key: string) => boolean;
  /** Ticked by something else (the role) and not changeable here. */
  isLocked?: (key: string) => boolean;
  /** Marked as an extra on top of the role. */
  isExtra?: (key: string) => boolean;
  disabled?: boolean;
  onChange: (keys: string[], on: boolean) => void;
}> = ({ isOn, isLocked = () => false, isExtra = () => false, disabled = false, onChange }) => (
  <div className="space-y-3">
    {PERMISSION_GROUPS.map((g) => {
      const items = permissionsInGroup(g.key);
      if (!items.length) return null;
      const open = items.filter((p) => !isLocked(p.key));
      const all = open.length > 0 && open.every((p) => isOn(p.key));
      return (
        <div key={g.key} className="rounded-md border">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1.5">
            <span className="text-sm font-semibold">{g.label}</span>
            {!disabled && open.length > 0 && (
              <button
                type="button" className="text-xs text-primary hover:underline"
                onClick={() => onChange(open.map((p) => p.key), !all)}
              >
                {all ? 'Clear group' : 'Tick all'}
              </button>
            )}
          </div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {items.map((p) => {
              const locked = isLocked(p.key);
              return (
                <label
                  key={p.key} htmlFor={`perm-${p.key}`}
                  className={cn('flex items-start gap-2.5 px-3 py-2', locked || disabled ? 'cursor-default' : 'cursor-pointer hover:bg-muted/30')}
                >
                  <Checkbox
                    id={`perm-${p.key}`} className="mt-0.5"
                    checked={isOn(p.key)}
                    disabled={locked || disabled}
                    onCheckedChange={(c) => onChange([p.key], !!c)}
                  />
                  <span className="space-y-0.5">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {p.label}
                      {locked && <Badge variant="secondary" className="text-[10px] font-normal">from role</Badge>}
                      {isExtra(p.key) && <Badge variant="outline" className="text-[10px] font-normal">extra</Badge>}
                    </span>
                    <span className="block text-xs text-muted-foreground">{p.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      );
    })}
  </div>
);

export default UserControlPage;
