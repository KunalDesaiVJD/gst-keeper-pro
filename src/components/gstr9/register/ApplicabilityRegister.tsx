import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { applicability, croreText, panOf, thresholdsFor, type Applicability } from '@/lib/gstr9/applicability';
import { useStaffList } from '@/hooks/useStaffList';
import { loadRegister, saveTurnover, signoffStateOf, type RegisterClient, type TurnoverPatch } from '@/lib/gstr9/register';
import {
  changesSinceSignoff, daysInStage, displayName, isMine, isMyTurn, loadsOf, nextSentence, ownerOf, STAGE_META, toSignoffState,
  type SignoffState,
} from '@/lib/gstr9/signoffFlow';
import { loadSignoffRow } from '@/lib/gstr9/store';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { KpiTile, Note } from '../ui';
import { CountBadge, StepTab, StepTabsList, ViewSwitch } from '../reco/StepTabs';
import { fmtWhen } from '../overview/steps';
import { useSignoffActor } from '../signoff/useSignoffActor';
import { BulkAllotDialog } from './BulkAllotDialog';
import { RegisterSignoffContext, type PersonFilter, type RegisterSignoffValue, type SignoffRowInfo, type StageFilter } from './signoffContext';
import { SignoffCell, signoffLabel, signoffTitle } from './SignoffCell';
import { SignoffHeader, stageFilterLabel } from './SignoffHeader';
import { useInvalidateApplicability } from './useApplicability';

/** What staff decide per client and year (client_annual_turnover). */
interface Entry {
  turnover: number | null;
  opt9: boolean;
  opt9c: boolean;
  note: string;
}

interface Row extends Entry, SignoffRowInfo {
  c: RegisterClient;
  type: string;
  /** Other clients with the same PAN — aggregate turnover is the PAN's. */
  siblings: string[];
  a: Applicability;
  inactive: boolean;
}

type Filter = 'all' | 'file' | 'needed' | 'exempt' | 'na';
/** Whose work: everyone's, allotted to me, or waiting on me now. */
type View = 'all' | 'mine' | 'turn';

const NOT_STARTED = toSignoffState(null);

const EMPTY: Entry = { turnover: null, opt9: false, opt9c: false, note: '' };

const typeLabel = (c: RegisterClient): string => {
  if (c.registration_type === 'Regular' || !c.registration_type) return c.regular_sub_type === 'Builder' ? 'Regular · Builder' : 'Regular';
  if (c.registration_type === 'IFF') return 'Regular (QRMP · IFF)';
  return c.registration_type;
};

const crore = (n: number | null): string => (n === null ? '' : `₹${(n / 1_00_00_000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} crore`);

const g9Label = (r: Row): string => {
  if (r.a.gstr9 === 'not_applicable') return 'Not applicable';
  if (r.a.gstr9 === 'unknown') return 'Turnover needed';
  if (r.a.gstr9 === 'required') return 'Required';
  return r.a.file9 ? 'Exempt — filing (client wishes)' : 'Exempt — not filing';
};

const g9cLabel = (r: Row): string => {
  if (r.a.gstr9c === 'not_applicable' || r.a.gstr9c === 'unknown') return '—';
  if (r.a.gstr9c === 'required') return 'Required';
  if (!r.a.file9) return 'Not required';
  return r.a.file9c ? 'Preparing (client wishes)' : 'Not required';
};

const inFilter = (r: Row, f: Filter): boolean =>
  f === 'all' ? true
    : f === 'file' ? r.a.file9 || r.a.file9c
      : f === 'needed' ? r.a.gstr9 === 'unknown'
        : f === 'exempt' ? r.a.gstr9 === 'exempt' && !r.a.file9
          : r.a.gstr9 === 'not_applicable';

const returnsText = (a: Applicability): string =>
  a.file9 ? (a.file9c ? 'GSTR-9 + 9C' : 'GSTR-9 only')
    : a.gstr9 === 'unknown' ? 'Turnover not typed'
      : a.gstr9 === 'not_applicable' ? 'Not applicable' : 'Exempt — not filing';

const inStageFilter = (r: SignoffRowInfo, f: StageFilter): boolean => {
  if (f === 'unallotted') return !r.s.preparer && r.s.stage !== 'locked';
  if (f === 'changed') return changesSinceSignoff(r.s) > 0;
  if (f === 'stuck') return (daysInStage(r.s) ?? 0) >= 14;
  return r.s.stage === f;
};

const holds = (r: SignoffRowInfo, id: string) => [r.s.preparer, r.s.verifier, r.s.reviewer].some((p) => p?.id === id);

const dayText = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

const VIEW_KEY = (userId: string) => `ar-register-view:${userId}`;

/**
 * The Annual Return home: every client for the year, its aggregate turnover
 * (typed or pasted here, one figure per PAN), and what that means — GSTR-9
 * required above ₹2 crore, GSTR-9C above ₹5 crore (applicability.ts). Below a
 * threshold the return is exempt and is prepared only if the client wishes,
 * which is ticked here per return. Opens each client's working.
 */
export const ApplicabilityRegister: React.FC<{ financialYear: string; onOpen: (clientId: string, extra?: Record<string, string>) => void }> = ({ financialYear, onOpen }) => {
  const { user, isStaffRole } = useAuth();
  const by = user?.firstName || user?.email || 'staff';
  const readOnly = !isStaffRole();
  const invalidate = useInvalidateApplicability();
  const me = useSignoffActor();
  const { staff, loading: staffLoading, error: staffError, reload: reloadStaff } = useStaffList();

  const [clients, setClients] = useState<RegisterClient[]>([]);
  const [entries, setEntries] = useState<Map<string, Entry>>(new Map());
  const [working, setWorking] = useState<Map<string, SignoffState>>(new Map());
  const [view, setViewState] = useState<View>(() => {
    try {
      const v = me.id ? localStorage.getItem(VIEW_KEY(me.id)) : null;
      return v === 'mine' || v === 'turn' || v === 'all' ? v : 'all';
    } catch { return 'all'; }
  });
  const viewChosen = useRef(false);
  const setView = useCallback((v: View) => {
    viewChosen.current = true;
    setViewState(v);
    try { if (me.id) localStorage.setItem(VIEW_KEY(me.id), v); } catch { /* storage unavailable */ }
  }, [me.id]);
  const [stageFilter, setStageFilter] = useState<StageFilter | null>(null);
  const [personFilter, setPersonFilter] = useState<PersonFilter | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const restoreFocusRef = useRef<(() => void) | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const seq = useRef(0);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await loadRegister(financialYear);
      if (mine !== seq.current) return;
      setClients(d.clients);
      setWorking(d.working);
      setEntries(new Map([...d.turnover].map(([id, t]) => [id, {
        turnover: t.aggregate_turnover === null ? null : Number(t.aggregate_turnover),
        opt9: t.gstr9_opt_in,
        opt9c: t.gstr9c_opt_in,
        note: t.applicability_note ?? '',
      }])));
    } catch (e) {
      if (mine === seq.current) toast.error('Could not load the clients: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [financialYear]);

  useEffect(() => { void load(); }, [load]);

  const byPan = useMemo(() => {
    const m = new Map<string, string[]>();
    clients.forEach((c) => {
      const p = panOf(c.gstin);
      if (p) m.set(p, [...(m.get(p) ?? []), c.id]);
    });
    return m;
  }, [clients]);

  const allRows = useMemo<Row[]>(() => clients.map((c) => {
    const e = entries.get(c.id) ?? EMPTY;
    const pan = panOf(c.gstin);
    const a = applicability({
      financialYear,
      registrationType: c.registration_type,
      registrationDate: c.registration_date,
      cancellationDate: c.cancellation_date || c.registration_cancellation_date,
      turnover: e.turnover,
      gstr9OptIn: e.opt9,
      gstr9cOptIn: e.opt9c,
    });
    const st = working.get(c.id) ?? NOT_STARTED;
    return {
      ...e,
      id: c.id,
      name: c.name,
      gstin: c.gstin,
      c,
      type: typeLabel(c),
      pan,
      siblings: pan ? (byPan.get(pan) ?? []).filter((id) => id !== c.id) : [],
      a,
      s: st,
      returns: returnsText(a),
      inScope: a.file9 || a.gstr9 === 'unknown' || st.sheets > 0 || (st.stage !== 'not_started' && st.stage !== 'preparing'),
      inactive: !!c.inactive_at_hand,
    };
  }), [clients, entries, working, byPan, financialYear]);

  const visible = useMemo(() => allRows.filter((r) => showInactive || !r.inactive || r.a.file9), [allRows, showInactive]);
  const counts = useMemo(() => {
    const n = (f: Filter) => visible.filter((r) => inFilter(r, f)).length;
    return { all: visible.length, file: n('file'), needed: n('needed'), exempt: n('exempt'), na: n('na') };
  }, [visible]);
  const needle = q.trim().toLowerCase();
  const inView = useCallback((r: Row, v: View) => (v === 'all' ? true : v === 'mine' ? isMine(r.s, me) : r.inScope && isMyTurn(r.s, me)), [me]);
  // The register before the Sign-off column's own filters: what their counts are taken over.
  const base = useMemo(
    () => visible.filter((r) => inFilter(r, filter) && inView(r, view) && (!needle || `${r.c.name} ${r.c.gstin ?? ''}`.toLowerCase().includes(needle))),
    [visible, filter, needle, view, inView],
  );
  const baseIds = useMemo(() => new Set(base.map((r) => r.id)), [base]);
  const rows = useMemo(
    () => visible.filter((r) => r.id === openFor || (baseIds.has(r.id) && (!stageFilter || (r.inScope && inStageFilter(r, stageFilter)))
      && (!personFilter || (personFilter === 'unallotted' ? r.inScope && inStageFilter(r, 'unallotted') : holds(r, personFilter === 'me' ? me.id : personFilter))))),
    // The row whose popover is open stays while it is open: acting on it (in "My turn") must not pull it away mid-action.
    [visible, baseIds, stageFilter, personFilter, me.id, openFor],
  );
  const viewCounts = useMemo(() => ({
    mine: visible.filter((r) => isMine(r.s, me)).length,
    turn: visible.filter((r) => r.inScope && isMyTurn(r.s, me)).length,
  }), [visible, me]);
  // An employee with work waiting starts on "My turn" (until they choose a view themselves).
  useEffect(() => {
    if (viewChosen.current || loading || me.isManager || !me.id) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(VIEW_KEY(me.id)); } catch { /* storage unavailable */ }
    if (!stored && viewCounts.turn > 0) { viewChosen.current = true; setViewState('turn'); }
  }, [loading, me.isManager, me.id, viewCounts.turn]);

  const stageCounts = useMemo(() => {
    const c: Partial<Record<StageFilter, number>> = {};
    const fs: StageFilter[] = ['unallotted', 'not_started', 'preparing', 'sent_back', 'prepared', 'verified', 'locked', 'changed', 'stuck'];
    const scoped = base.filter((r) => r.inScope);
    fs.forEach((f) => { c[f] = scoped.filter((r) => inStageFilter(r, f)).length; });
    return c;
  }, [base]);
  const personCounts = useMemo(() => {
    const m = new Map<string, number>();
    base.forEach((r) => {
      new Set([r.s.preparer?.id, r.s.verifier?.id, r.s.reviewer?.id].filter((x): x is string => !!x))
        .forEach((id) => m.set(id, (m.get(id) ?? 0) + 1));
    });
    return m;
  }, [base]);
  const loads = useMemo(() => loadsOf(working.values()), [working]);
  const staffById = useMemo(() => new Map(staff.map((x) => [x.userId, x])), [staff]);
  const allotScope = useMemo(() => rows.filter((r) => r.inScope && r.s.stage !== 'locked'), [rows]);

  const patchRow = useCallback((clientId: string, st: SignoffState) => {
    setWorking((m) => { const n = new Map(m); n.set(clientId, st); return n; });
  }, []);
  const refreshRow = useCallback(async (clientId: string) => {
    const row = await loadSignoffRow(clientId, financialYear);
    if (!row) return null;
    const st = signoffStateOf(row);
    patchRow(clientId, st);
    return st;
  }, [financialYear, patchRow]);
  const openSignoff = useCallback((id: string, restore: () => void) => {
    restoreFocusRef.current = restore;
    setOpenFor(id);
  }, []);

  const signoffCtx = useMemo<RegisterSignoffValue>(() => ({
    me, financialYear, staff, staffById, staffLoading, staffError, reloadStaff, loads,
    openFor, setOpenFor, restoreFocusRef, patchRow, refreshRow, onOpen,
    stageFilter, setStageFilter, personFilter, setPersonFilter, stageCounts, personCounts,
    allotScope, openBulk: () => setBulkOpen(true),
  }), [me, financialYear, staff, staffById, staffLoading, staffError, reloadStaff, loads, openFor, patchRow, refreshRow, onOpen,
    stageFilter, personFilter, stageCounts, personCounts, allotScope]);

  const th = thresholdsFor(financialYear);
  const applicable = visible.filter((r) => r.a.gstr9 !== 'not_applicable');
  const entered = applicable.filter((r) => r.turnover !== null).length;
  const file9 = visible.filter((r) => r.a.file9);
  const file9c = visible.filter((r) => r.a.file9c);
  const allotted = file9.filter((r) => r.s.preparer || ['prepared', 'verified', 'locked'].includes(r.s.stage)).length;
  const at = (st: SignoffState['stage'][]) => file9.filter((r) => st.includes(r.s.stage)).length;
  const lockedN = at(['locked']);
  const toPrepare = at(['not_started', 'preparing']) + file9.filter((r) => r.s.stage === 'sent_back' && r.s.returned?.to === 'preparer').length;
  const toVerify = at(['prepared']) + file9.filter((r) => r.s.stage === 'sent_back' && r.s.returned?.to === 'verifier').length;
  const toReview = at(['verified']);
  const sentBack = at(['sent_back']);
  const changedN = file9.filter((r) => changesSinceSignoff(r.s) > 0).length;
  const stuck = file9.filter((r) => (daysInStage(r.s) ?? 0) >= 14).length;
  const allotUnallotted = () => {
    setFilter('file');
    setView('all');
    setPersonFilter(null);
    setStageFilter('unallotted');
    setQ('');
    setBulkOpen(true);
  };
  const turnoverOf = (id: string) => (entries.get(id) ?? EMPTY).turnover;

  const persist = useCallback(async (patches: TurnoverPatch[], undo: Map<string, Entry>) => {
    try {
      await saveTurnover(financialYear, patches, by);
      invalidate();
    } catch (e) {
      toast.error('Not saved: ' + (e instanceof Error ? e.message : String(e)));
      setEntries(undo);
    }
  }, [financialYear, by, invalidate]);

  const onRowsChange = (next: Row[]) => {
    const prevById = new Map(rows.map((r) => [r.id, r]));
    const patches: TurnoverPatch[] = [];
    const after = new Map(entries);
    next.forEach((r) => {
      const prev = prevById.get(r.id);
      if (!prev || prev === r) return;
      const p: TurnoverPatch = { clientId: r.id };
      const e: Entry = { turnover: r.turnover, opt9: r.opt9, opt9c: r.opt9c, note: r.note };
      if (r.turnover !== prev.turnover) p.aggregate_turnover = r.turnover;
      if (r.opt9 !== prev.opt9) {
        p.gstr9_opt_in = r.opt9;
        // 9C reconciles the GSTR-9 it goes with: no GSTR-9, no 9C by choice either.
        if (!r.opt9 && prev.opt9c) { p.gstr9c_opt_in = false; e.opt9c = false; }
      }
      if (r.opt9c !== prev.opt9c) p.gstr9c_opt_in = r.opt9c;
      if (r.note !== prev.note) p.applicability_note = r.note.trim() || null;
      if (Object.keys(p).length > 1) {
        patches.push(p);
        after.set(r.id, e);
      }
    });
    if (!patches.length) return;
    const undo = entries;
    setEntries(after);
    void persist(patches, undo);

    // Aggregate turnover is the PAN's: offer it to the PAN's other GSTINs that have none yet.
    if (patches.length === 1 && patches[0].aggregate_turnover != null) {
      const row = next.find((r) => r.id === patches[0].clientId);
      const blank = (row?.siblings ?? []).filter((id) => turnoverOf(id) === null);
      if (row && blank.length) {
        const v = patches[0].aggregate_turnover;
        toast(`Aggregate turnover is for the whole PAN ${row.pan}.`, {
          description: `${blank.length} other GSTIN${blank.length === 1 ? '' : 's'} of this PAN ${blank.length === 1 ? 'has' : 'have'} no turnover for FY ${financialYear} yet.`,
          action: {
            label: `Use ${crore(v)} for ${blank.length === 1 ? 'it' : 'them'}`,
            onClick: () => {
              const cur = entriesRef.current;
              const m = new Map(cur);
              blank.forEach((id) => m.set(id, { ...(m.get(id) ?? EMPTY), turnover: v }));
              setEntries(m);
              void persist(blank.map((id) => ({ clientId: id, aggregate_turnover: v })), cur);
            },
          },
        });
      }
    }
  };

  const columns = useMemo<GridColumn<Row>[]>(() => [
    {
      key: 'client',
      header: 'Client',
      type: 'display',
      align: 'left',
      width: 240,
      sticky: true,
      value: (r) => r.c.name,
      title: (r) => r.c.name,
      render: (r) => (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={() => onOpen(r.id)}
          className="block max-w-[228px] truncate rounded text-left font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`Open the working of ${r.c.name}`}
        >
          {r.c.name}
        </button>
      ),
    },
    {
      key: 'signoff',
      header: <SignoffHeader />,
      type: 'display',
      align: 'left',
      width: 232,
      value: (r) => signoffLabel(r),
      title: (r) => signoffTitle(r),
      activate: (r, restore) => { if (r.inScope || r.s.preparer || r.s.verifier || r.s.reviewer) openSignoff(r.id, restore); },
      render: (r) => <SignoffCell row={r} />,
    },
    {
      key: 'gstin',
      header: 'GSTIN',
      type: 'display',
      align: 'left',
      width: 172,
      value: (r) => r.c.gstin ?? '',
      title: (r) => (r.siblings.length ? `PAN ${r.pan} has ${r.siblings.length + 1} GSTINs here — aggregate turnover is the PAN's, all GSTINs together` : undefined),
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-[11px]">{r.c.gstin}</span>
          {r.siblings.length > 0 && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">PAN ×{r.siblings.length + 1}</span>}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Registration',
      type: 'display',
      align: 'left',
      width: 136,
      value: (r) => r.type,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span>{r.type}</span>
          {r.inactive && <span className="text-[10px] text-muted-foreground">· inactive</span>}
        </span>
      ),
    },
    {
      key: 'turnover',
      header: 'Aggregate turnover (₹)',
      type: 'money',
      width: 160,
      value: (r) => r.turnover,
      editable: (r) => r.a.gstr9 !== 'not_applicable',
      onEdit: (r, e) => ({ ...r, turnover: e.num === null ? null : Math.round(e.num * 100) / 100 }),
      tone: (r) => {
        if (r.turnover === null) return r.a.gstr9 === 'unknown' ? 'warn' : undefined;
        const other = r.siblings.map(turnoverOf).find((v) => v !== null && Math.abs((v ?? 0) - (r.turnover ?? 0)) > 0.5);
        return other !== undefined ? 'warn' : undefined;
      },
      title: (r) => {
        if (r.a.gstr9 === 'not_applicable') return r.a.notApplicable;
        if (r.turnover === null) return 'Type the aggregate turnover of the year — all GSTINs of the PAN together';
        const other = r.siblings.map((id) => ({ id, v: turnoverOf(id) })).find((x) => x.v !== null && Math.abs((x.v ?? 0) - (r.turnover ?? 0)) > 0.5);
        const name = other ? clients.find((c) => c.id === other.id)?.gstin : null;
        return [crore(r.turnover), other ? `Differs from ${name} (${crore(other.v)}) — aggregate turnover is the PAN's, the same for every GSTIN` : ''].filter(Boolean).join(' · ');
      },
    },
    {
      key: 'g9',
      header: 'GSTR-9',
      type: 'select',
      width: 196,
      align: 'left',
      options: [
        { value: 'no', label: 'Exempt — not filing', aliases: ['no', 'n', 'not filing', 'exempt'] },
        { value: 'yes', label: 'Exempt — filing (client wishes)', aliases: ['yes', 'y', 'file', 'filing'] },
      ],
      value: (r) => (r.a.gstr9 === 'exempt' ? (r.opt9 ? 'yes' : 'no') : g9Label(r)),
      editable: (r) => r.a.gstr9 === 'exempt',
      onEdit: (r, e) => (e.text ? { ...r, opt9: e.text === 'yes' } : r),
      title: (r) =>
        r.a.gstr9 === 'not_applicable' ? r.a.notApplicable
          : r.a.gstr9 === 'unknown' ? 'Type the turnover to decide'
            : r.a.gstr9 === 'required' ? `Aggregate turnover above ${croreText(th.gstr9)}`
              : `Up to ${croreText(th.gstr9)}: exempt (${th.gstr9Basis}). Choose “filing” if the client wishes it filed.`,
      render: (r) => {
        const l = g9Label(r);
        if (r.a.gstr9 === 'required') return <Badge className="text-[10px]">Required</Badge>;
        if (r.a.gstr9 === 'unknown') return <Badge variant="warning" className="text-[10px] font-normal">Turnover needed</Badge>;
        if (r.a.gstr9 === 'not_applicable') return <span className="text-[11px] text-muted-foreground">Not applicable</span>;
        return r.a.file9
          ? <Badge variant="info" className="text-[10px] font-normal">{l}</Badge>
          : <span className="text-[11px] text-muted-foreground">{l}</span>;
      },
    },
    {
      key: 'g9c',
      header: 'GSTR-9C',
      type: 'select',
      width: 172,
      align: 'left',
      options: [
        { value: 'no', label: 'Not required', aliases: ['no', 'n'] },
        { value: 'yes', label: 'Preparing (client wishes)', aliases: ['yes', 'y', 'prepare', 'preparing'] },
      ],
      value: (r) => (r.a.gstr9c === 'exempt' && r.a.file9 ? (r.opt9c ? 'yes' : 'no') : g9cLabel(r)),
      editable: (r) => r.a.gstr9c === 'exempt' && r.a.file9,
      onEdit: (r, e) => (e.text ? { ...r, opt9c: e.text === 'yes' } : r),
      title: (r) =>
        r.a.gstr9c === 'required' ? `Aggregate turnover above ${croreText(th.gstr9c)} — ${th.gstr9cBasis}`
          : r.a.gstr9c === 'exempt' ? (r.a.file9 ? `Up to ${croreText(th.gstr9c)}: not required. Choose “preparing” if the client wishes it.` : 'GSTR-9 is not being filed, so there is no 9C')
            : undefined,
      render: (r) => {
        if (r.a.gstr9c === 'required') return <Badge className="text-[10px]">Required</Badge>;
        if (r.a.file9c) return <Badge variant="info" className="text-[10px] font-normal">{g9cLabel(r)}</Badge>;
        return <span className="text-[11px] text-muted-foreground">{g9cLabel(r)}</span>;
      },
    },
    {
      key: 'note',
      header: 'Note',
      type: 'text',
      align: 'left',
      width: 176,
      value: (r) => r.note,
      onEdit: (r, e) => ({ ...r, note: e.text.slice(0, 300) }),
      title: (r) => r.note || 'e.g. why the client wishes the return filed',
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [th, onOpen, entries, clients, openSignoff]);

  /** The sign-off as spreadsheet columns (no notes — they stay in the working). */
  const signoffExport = (r: Row): Record<string, string | number> => {
    const st = r.s;
    const out = !r.inScope && !st.preparer;
    const o = ownerOf(st);
    const name = (p: { name: string } | null | undefined) => (p ? displayName(p.name) : '');
    return {
      Stage: out ? '' : !r.inScope ? 'Not filing' : STAGE_META[st.stage].label,
      With: out || !r.inScope ? '' : o.kind === 'person' ? displayName(o.person.name) : o.kind === 'managers' ? 'Any GST manager' : o.kind === 'unallotted' ? 'Unallotted' : '',
      'Days in stage': daysInStage(st) ?? '',
      Preparer: name(st.preparer),
      'Prepared by': name(st.prepared),
      'Prepared on': dayText(st.prepared?.at),
      Verifier: name(st.verifier),
      'Verified by': name(st.verified),
      'Verified on': dayText(st.verified?.at),
      Reviewer: name(st.reviewer),
      'Locked by': name(st.locked),
      'Locked on': dayText(st.locked?.at),
      'Changes since sign-off': changesSinceSignoff(st) || '',
      Next: out || !r.inScope ? '' : nextSentence(st) ?? '',
      'Last saved': st.lastSavedAt ? fmtWhen(st.lastSavedAt) : '',
    };
  };

  const exportXlsx = () => {
    const data = rows.map((r) => ({
      Client: r.c.name,
      GSTIN: r.c.gstin ?? '',
      PAN: r.pan ?? '',
      Registration: r.type + (r.inactive ? ' (inactive)' : ''),
      'Aggregate turnover (₹)': r.turnover ?? '',
      'GSTR-9': g9Label(r),
      'GSTR-9C': g9cLabel(r),
      Note: r.note,
      ...signoffExport(r),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 40 }, { wch: 17 }, { wch: 12 }, { wch: 22 }, { wch: 20 }, { wch: 30 }, { wch: 26 }, { wch: 30 },
      { wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 36 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `FY ${financialYear}`);
    XLSX.writeFile(wb, `GSTR-9 9C applicability FY ${financialYear}.xlsx`);
  };

  const fmtCount = (a: number, b?: number) => (b === undefined ? a : `${a} / ${b}`);

  return (
    <RegisterSignoffContext.Provider value={signoffCtx}>
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-heading text-lg font-semibold leading-tight">All clients · FY {financialYear}</h2>
        <p className="min-w-[14rem] flex-1 text-xs leading-snug text-muted-foreground">
          Type each client&apos;s aggregate turnover for the year (paste a column from Excel works). GSTR-9 is required above {croreText(th.gstr9)},
          GSTR-9C above {croreText(th.gstr9c)}; below that the return is exempt and is prepared only if the client wishes. Allot each working and
          follow it through Prepared → Verified → Reviewed &amp; locked in the Sign-off column.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          label="Turnover entered"
          value={fmtCount(entered, applicable.length)}
          hint={applicable.length - entered ? `${applicable.length - entered} still to type` : 'Every client that files has a turnover'}
          tone={applicable.length - entered ? 'warn' : 'ok'}
        />
        <KpiTile label="GSTR-9 to file" value={file9.length} hint={`${file9.filter((r) => r.a.gstr9 === 'required').length} required · ${file9.filter((r) => r.a.gstr9 === 'exempt').length} at the client's wish`} />
        <KpiTile label="GSTR-9C to prepare" value={file9c.length} hint={`${file9c.filter((r) => r.a.gstr9c === 'required').length} required · ${file9c.filter((r) => r.a.gstr9c === 'exempt').length} at the client's wish`} />
        <KpiTile
          label="Allotted"
          value={fmtCount(allotted, file9.length)}
          hint={allotted < file9.length
            ? me.isManager
              ? <button type="button" onClick={allotUnallotted} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Allot {file9.length - allotted} without a preparer →</button>
              : `${file9.length - allotted} without a preparer`
            : file9.length ? 'Every working has a preparer' : 'Nothing to file yet'}
          tone={allotted < file9.length ? 'warn' : file9.length ? 'ok' : 'neutral'}
        />
        <KpiTile
          label="Sign-off"
          value={`${lockedN} / ${file9.length} locked`}
          hint={`${toPrepare} to prepare · ${toVerify} to verify · ${toReview} to review${sentBack ? ` · ${sentBack} sent back` : ''}${changedN ? ` · ${changedN} changed since` : ''}${stuck ? ` · ${stuck} stuck 14d+` : ''}`}
          tone={file9.length && lockedN === file9.length ? 'ok' : sentBack || changedN || stuck ? 'warn' : 'neutral'}
        />
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)} className="space-y-2">
        <StepTabsList
          label="Show"
          value={filter}
          actions={
            <>
              <ViewSwitch<View>
                label="Whose work"
                value={view}
                onChange={setView}
                options={[
                  { value: 'all', label: 'Everyone' },
                  { value: 'mine', label: `Mine${viewCounts.mine ? ` (${viewCounts.mine})` : ''}`, title: 'Allotted to me — to prepare, verify or review — and not yet locked' },
                  { value: 'turn', label: `My turn${viewCounts.turn ? ` (${viewCounts.turn})` : ''}`, title: 'Waiting on me now' },
                ]}
              />
              <div className="relative w-56">
                <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or GSTIN…" className="h-8 pl-7 text-xs" aria-label="Search clients" />
              </div>
              <div className="flex items-center gap-2">
                <Switch id="ar-show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
                <Label htmlFor="ar-show-inactive" className="text-xs font-normal">Show inactive</Label>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void load()} disabled={loading} aria-label="Reload">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={exportXlsx} disabled={!rows.length}>
                <Download className="mr-1 h-3.5 w-3.5" /> Excel
              </Button>
            </>
          }
        >
          <StepTab value="all">All <CountBadge n={counts.all} label="clients" /></StepTab>
          <StepTab value="file">To file <CountBadge n={counts.file} label="clients" /></StepTab>
          <StepTab value="needed">Turnover needed <CountBadge n={counts.needed} label="clients" /></StepTab>
          <StepTab value="exempt">Exempt — not filing <CountBadge n={counts.exempt} label="clients" /></StepTab>
          <StepTab value="na">Not applicable <CountBadge n={counts.na} label="clients" /></StepTab>
        </StepTabsList>

        {(stageFilter || personFilter) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Sign-off:</span>
            {stageFilter && (
              <button type="button" onClick={() => setStageFilter(null)} aria-label={`Remove the filter ${stageFilterLabel(stageFilter)}`}
                className="inline-flex h-7 items-center gap-1 rounded-full border bg-card px-2.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {stageFilterLabel(stageFilter)} <X className="h-3 w-3" aria-hidden />
              </button>
            )}
            {personFilter && (
              <button type="button" onClick={() => setPersonFilter(null)} aria-label="Remove the person filter"
                className="inline-flex h-7 items-center gap-1 rounded-full border bg-card px-2.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {personFilter === 'me' ? 'Allotted to me' : personFilter === 'unallotted' ? 'No preparer' : `Allotted to ${displayName(staffById.get(personFilter)?.name ?? 'someone')}`}
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
        )}

        <SheetGrid<Row>
          label={`GSTR-9 / 9C applicability, FY ${financialYear}`}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          onRowsChange={readOnly ? undefined : onRowsChange}
          readOnly={readOnly}
          rowTone={(r) => (r.inactive || r.a.gstr9 === 'not_applicable' ? 'muted' : undefined)}
          pasteOrder={['turnover', 'g9', 'g9c', 'note']}
          maxHeight="max(360px, calc(100vh - 330px))"
          emptyText={loading ? 'Loading clients…' : needle ? 'No client matches the search.' : stageFilter || personFilter ? 'No working matches these sign-off filters.' : view !== 'all' ? (view === 'turn' ? 'Nothing is waiting on you.' : 'Nothing is allotted to you.') : 'No client in this view.'}
        />
      </Tabs>
      <BulkAllotDialog open={bulkOpen} onOpenChange={setBulkOpen} rows={allotScope} />

      <Note tone="position">
        FY {financialYear}: GSTR-9 is required above {croreText(th.gstr9)} of aggregate turnover — up to that the year is exempt ({th.gstr9Basis}).
        GSTR-9C is required above {croreText(th.gstr9c)} ({th.gstr9cBasis}). Aggregate turnover is the PAN&apos;s (all its GSTINs together: taxable,
        exempt, exports and inter-state supplies, without the taxes and reverse-charge inward supplies), so GSTINs of one PAN carry the same figure.
        Composition taxpayers (GSTR-4), tax deductors (GSTR-7) and ISDs do not file GSTR-9. The turnover is the same figure as on the client&apos;s page
        (late-fee slab), typed once.
      </Note>
    </div>
    </RegisterSignoffContext.Provider>
  );
};

export default ApplicabilityRegister;
