import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Download, Loader2, RefreshCw, Search } from 'lucide-react';
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
import { loadRegister, saveTurnover, type RegisterClient, type TurnoverPatch, type WorkingState } from '@/lib/gstr9/register';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { KpiTile, Note } from '../ui';
import { CountBadge, StepTab, StepTabsList } from '../reco/StepTabs';
import { fmtWhen } from '../overview/steps';
import { useInvalidateApplicability } from './useApplicability';

/** What staff decide per client and year (client_annual_turnover). */
interface Entry {
  turnover: number | null;
  opt9: boolean;
  opt9c: boolean;
  note: string;
}

interface Row extends Entry {
  id: string;
  c: RegisterClient;
  type: string;
  pan: string | null;
  /** Other clients with the same PAN — aggregate turnover is the PAN's. */
  siblings: string[];
  a: Applicability;
  w?: WorkingState;
  inactive: boolean;
}

type Filter = 'all' | 'file' | 'needed' | 'exempt' | 'na';

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

const workingLabel = (w: WorkingState | undefined): { label: string; tone: 'outline' | 'warning' | 'info' | 'success' } => {
  if (!w || (w.status === 'not_started' && !w.sheets)) return { label: 'Not started', tone: 'outline' };
  if (w.status === 'locked') return { label: 'Locked', tone: 'success' };
  if (w.preparedBy) return { label: 'Ready for review', tone: 'info' };
  return { label: 'In progress', tone: 'warning' };
};

/**
 * The Annual Return home: every client for the year, its aggregate turnover
 * (typed or pasted here, one figure per PAN), and what that means — GSTR-9
 * required above ₹2 crore, GSTR-9C above ₹5 crore (applicability.ts). Below a
 * threshold the return is exempt and is prepared only if the client wishes,
 * which is ticked here per return. Opens each client's working.
 */
export const ApplicabilityRegister: React.FC<{ financialYear: string; onOpen: (clientId: string) => void }> = ({ financialYear, onOpen }) => {
  const { user, isStaffRole } = useAuth();
  const by = user?.firstName || user?.email || 'staff';
  const readOnly = !isStaffRole();
  const invalidate = useInvalidateApplicability();

  const [clients, setClients] = useState<RegisterClient[]>([]);
  const [entries, setEntries] = useState<Map<string, Entry>>(new Map());
  const [working, setWorking] = useState<Map<string, WorkingState>>(new Map());
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
    return {
      ...e,
      id: c.id,
      c,
      type: typeLabel(c),
      pan,
      siblings: pan ? (byPan.get(pan) ?? []).filter((id) => id !== c.id) : [],
      a: applicability({
        financialYear,
        registrationType: c.registration_type,
        registrationDate: c.registration_date,
        cancellationDate: c.cancellation_date || c.registration_cancellation_date,
        turnover: e.turnover,
        gstr9OptIn: e.opt9,
        gstr9cOptIn: e.opt9c,
      }),
      w: working.get(c.id),
      inactive: !!c.inactive_at_hand,
    };
  }), [clients, entries, working, byPan, financialYear]);

  const visible = useMemo(() => allRows.filter((r) => showInactive || !r.inactive || r.a.file9), [allRows, showInactive]);
  const counts = useMemo(() => {
    const n = (f: Filter) => visible.filter((r) => inFilter(r, f)).length;
    return { all: visible.length, file: n('file'), needed: n('needed'), exempt: n('exempt'), na: n('na') };
  }, [visible]);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () => visible.filter((r) => inFilter(r, filter) && (!needle || `${r.c.name} ${r.c.gstin ?? ''}`.toLowerCase().includes(needle))),
    [visible, filter, needle],
  );

  const th = thresholdsFor(financialYear);
  const applicable = visible.filter((r) => r.a.gstr9 !== 'not_applicable');
  const entered = applicable.filter((r) => r.turnover !== null).length;
  const file9 = visible.filter((r) => r.a.file9);
  const file9c = visible.filter((r) => r.a.file9c);
  const states = file9.map((r) => workingLabel(r.w).label);
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
      key: 'working',
      header: 'Working',
      type: 'display',
      align: 'left',
      width: 196,
      value: (r) => workingLabel(r.w).label,
      title: (r) => (r.w?.lastSavedAt ? `Last saved ${fmtWhen(r.w.lastSavedAt)}` : undefined),
      render: (r) => {
        if (!r.a.file9 && !r.w?.sheets) return <span className="text-[11px] text-muted-foreground">—</span>;
        const s = workingLabel(r.w);
        return (
          <span
            className="inline-flex items-center gap-1.5"
            // A button inside a grid cell: keep the grid from taking its click and keys.
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Badge variant={s.tone} className="text-[10px] font-normal">{s.label}</Badge>
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Open the working of ${r.c.name}`}
            >
              Open <ArrowRight className="h-3 w-3" aria-hidden />
            </button>
          </span>
        );
      },
    },
    {
      key: 'note',
      header: 'Note',
      type: 'text',
      align: 'left',
      width: 200,
      value: (r) => r.note,
      onEdit: (r, e) => ({ ...r, note: e.text.slice(0, 300) }),
      title: (r) => r.note || 'e.g. why the client wishes the return filed',
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [th, onOpen, entries, clients]);

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
      Working: r.a.file9 || r.w?.sheets ? workingLabel(r.w).label : '',
      'Last saved': r.w?.lastSavedAt ? fmtWhen(r.w.lastSavedAt) : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 40 }, { wch: 17 }, { wch: 12 }, { wch: 22 }, { wch: 20 }, { wch: 30 }, { wch: 26 }, { wch: 30 }, { wch: 16 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `FY ${financialYear}`);
    XLSX.writeFile(wb, `GSTR-9 9C applicability FY ${financialYear}.xlsx`);
  };

  const fmtCount = (a: number, b?: number) => (b === undefined ? a : `${a} / ${b}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-heading text-lg font-semibold leading-tight">All clients · FY {financialYear}</h2>
        <p className="min-w-[14rem] flex-1 text-xs leading-snug text-muted-foreground">
          Type each client&apos;s aggregate turnover for the year (paste a column from Excel works). GSTR-9 is required above {croreText(th.gstr9)},
          GSTR-9C above {croreText(th.gstr9c)}; below that the return is exempt and is prepared only if the client wishes.
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
        <KpiTile label="Exempt — not filing" value={counts.exempt} hint={`Turnover up to ${croreText(th.gstr9)}`} />
        <KpiTile
          label="Workings of those filing"
          value={`${states.filter((s) => s === 'Locked').length} locked`}
          hint={`${states.filter((s) => s === 'In progress' || s === 'Ready for review').length} in progress · ${states.filter((s) => s === 'Not started').length} not started`}
        />
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)} className="space-y-2">
        <StepTabsList
          label="Show"
          value={filter}
          actions={
            <>
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
          emptyText={loading ? 'Loading clients…' : needle ? 'No client matches the search.' : 'No client in this view.'}
        />
      </Tabs>

      <Note tone="position">
        FY {financialYear}: GSTR-9 is required above {croreText(th.gstr9)} of aggregate turnover — up to that the year is exempt ({th.gstr9Basis}).
        GSTR-9C is required above {croreText(th.gstr9c)} ({th.gstr9cBasis}). Aggregate turnover is the PAN&apos;s (all its GSTINs together: taxable,
        exempt, exports and inter-state supplies, without the taxes and reverse-charge inward supplies), so GSTINs of one PAN carry the same figure.
        Composition taxpayers (GSTR-4), tax deductors (GSTR-7) and ISDs do not file GSTR-9. The turnover is the same figure as on the client&apos;s page
        (late-fee slab), typed once.
      </Note>
    </div>
  );
};

export default ApplicabilityRegister;
