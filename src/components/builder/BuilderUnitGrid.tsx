/**
 * Option A — the unit ledger grid.
 *
 * One row per unit, every derived figure on it, the whole project readable
 * without a click. This is the front door of the Ledger tab because the
 * question a CA staffer asks most often is not "what happened to unit 101" but
 * "where does this project stand" — and that question was previously answerable
 * only by opening units one at a time.
 *
 * The column that earns its place is **₹45L headroom**. Affordability is
 * derived from carpet area and gross consideration, so a unit sitting ₹10,000
 * under the limit is one charge head away from moving from 1.5% to 7.5% on
 * everything already collected. Showing the distance to the limit turns a
 * retrospective re-rating from a surprise into something you can see coming.
 *
 * Sorting is deliberate rather than alphabetical: units nearest the limit float
 * up when you sort by headroom, which is the review order that matters.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Loader2, MoreHorizontal, Search, ArrowUpDown, Home, AlertTriangle,
} from 'lucide-react';
import {
  DEFAULT_CHARGE_INCLUSIONS, RATE_CODE_LABEL, AFFORDABLE_VALUE_LIMIT,
  classifyUnit, formatINR, testRrep,
  type ChargeHead, type ChargeInclusionSettings, type UnitType,
} from '@/utils/builderRates';
import { fetchBuilderSettings } from '@/lib/builderSettings';

interface UnitRow {
  id: string; unit_no: string; unit_type: UnitType;
  carpet_area_sqm: number; base_consideration: number; status: string;
}
interface ChargeRow { unit_id: string; charge_head: ChargeHead; amount: number; include_override: boolean | null }
interface LedgerRow { unit_id: string; value_taxed: number; total_received: number; open_advance: number }

export interface UnitGridAction {
  key: string;
  label: string;
  /** Grouped under a heading in the row menu. */
  group: string;
  onSelect: (unit: { id: string; unit_no: string }) => void;
}

type SortKey = 'unit' | 'headroom' | 'balance' | 'gross';

const BuilderUnitGrid: React.FC<{
  projectId: string;
  isMetro: boolean;
  /** Actions offered on each row — supplied by the workspace so the grid stays presentational. */
  actions?: UnitGridAction[];
  onAddUnits?: () => void;
}> = ({ projectId, isMetro, actions = [], onAddUnits }) => {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [charges, setCharges] = useState<Record<string, ChargeRow[]>>({});
  const [ledger, setLedger] = useState<Record<string, LedgerRow>>({});
  const [settings, setSettings] = useState<ChargeInclusionSettings>(DEFAULT_CHARGE_INCLUSIONS);
  const [isLoading, setIsLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('unit');

  const load = useCallback(async () => {
    if (!projectId) { setUnits([]); return; }
    setIsLoading(true);
    try {
      const { data: proj } = await supabase
        .from('builder_projects').select('client_id').eq('id', projectId).maybeSingle();
      const clientId = (proj as { client_id?: string })?.client_id;

      const [{ data: u }, st] = await Promise.all([
        supabase.from('builder_units').select('id, unit_no, unit_type, carpet_area_sqm, base_consideration, status')
          .eq('project_id', projectId).order('sort_order').order('unit_no'),
        clientId ? fetchBuilderSettings(clientId) : Promise.resolve(DEFAULT_CHARGE_INCLUSIONS),
      ]);
      const rows = (u || []) as unknown as UnitRow[];
      setUnits(rows);
      setSettings(st as ChargeInclusionSettings);

      const ids = rows.map((r) => r.id);
      if (ids.length) {
        const [{ data: c }, { data: l }] = await Promise.all([
          supabase.from('builder_unit_charges').select('unit_id, charge_head, amount, include_override').in('unit_id', ids),
          supabase.from('builder_unit_ledger').select('unit_id, value_taxed, total_received, open_advance').in('unit_id', ids),
        ]);
        const cm: Record<string, ChargeRow[]> = {};
        ((c || []) as unknown as ChargeRow[]).forEach((x) => { (cm[x.unit_id] ||= []).push(x); });
        setCharges(cm);
        const lm: Record<string, LedgerRow> = {};
        ((l || []) as unknown as LedgerRow[]).forEach((x) => { lm[x.unit_id] = x; });
        setLedger(lm);
      } else { setCharges({}); setLedger({}); }
    } finally { setIsLoading(false); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  /** The 15% test, from the unit master. Drives commercial units' rate. */
  const rrep = useMemo(() => {
    let resi = 0, comm = 0;
    units.forEach((u) => {
      if (u.status === 'Cancelled') return;
      if (u.unit_type === 'Residential') resi += Number(u.carpet_area_sqm) || 0;
      else comm += Number(u.carpet_area_sqm) || 0;
    });
    return testRrep(resi, comm);
  }, [units]);

  const rows = useMemo(() => units.map((u) => {
    const cls = classifyUnit({
      unitType: u.unit_type,
      carpetAreaSqM: Number(u.carpet_area_sqm) || 0,
      baseConsideration: Number(u.base_consideration) || 0,
      charges: (charges[u.id] || []).map((c) => ({
        charge_head: c.charge_head, amount: Number(c.amount) || 0, include_override: c.include_override,
      })),
      isMetro, isRrep: rrep.isRrep, settings,
    });
    const led = ledger[u.id];
    const chargeTotal = (charges[u.id] || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const taxed = Number(led?.value_taxed) || 0;
    // Headroom is only meaningful for a residential unit — a commercial unit is
    // never affordable whatever it costs.
    const headroom = u.unit_type === 'Residential'
      ? AFFORDABLE_VALUE_LIMIT - cls.gross.gross
      : null;
    return {
      u, cls, chargeTotal, taxed,
      received: Number(led?.total_received) || 0,
      balance: cls.gross.gross - taxed,
      headroom,
    };
  }), [units, charges, ledger, isMetro, rrep.isRrep, settings]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((r) => r.u.unit_no.toLowerCase().includes(needle)
        || r.u.status.toLowerCase().includes(needle)
        || RATE_CODE_LABEL[r.cls.rateCode].toLowerCase().includes(needle))
      : rows;
    const sorted = [...filtered];
    if (sort === 'unit') {
      sorted.sort((a, b) => a.u.unit_no.localeCompare(b.u.unit_no, undefined, { numeric: true }));
    } else if (sort === 'headroom') {
      // Nulls (commercial) last; smallest positive headroom first — the units
      // closest to losing the concession are the ones worth looking at.
      sorted.sort((a, b) => {
        if (a.headroom === null) return 1;
        if (b.headroom === null) return -1;
        return a.headroom - b.headroom;
      });
    } else if (sort === 'balance') sorted.sort((a, b) => b.balance - a.balance);
    else sorted.sort((a, b) => b.cls.gross.gross - a.cls.gross.gross);
    return sorted;
  }, [rows, q, sort]);

  const totals = useMemo(() => shown.reduce((t, r) => ({
    base: t.base + (Number(r.u.base_consideration) || 0),
    charges: t.charges + r.chargeTotal,
    gross: t.gross + r.cls.gross.gross,
    received: t.received + r.received,
    taxed: t.taxed + r.taxed,
    balance: t.balance + r.balance,
  }), { base: 0, charges: 0, gross: 0, received: 0, taxed: 0, balance: 0 }), [shown]);

  const atRisk = rows.filter((r) => r.headroom !== null && r.headroom >= 0 && r.headroom < 100000).length;
  const grouped = useMemo(() => {
    const g: Record<string, UnitGridAction[]> = {};
    actions.forEach((a) => { (g[a.group] ||= []).push(a); });
    return Object.entries(g);
  }, [actions]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading units…
      </div>
    );
  }

  if (!units.length) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        <Home className="mx-auto mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm">No units on this project yet.</p>
        {onAddUnits && (
          <Button size="sm" className="mt-4" onClick={onAddUnits}>Import the unit list</Button>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar — search and the sort that actually matters. */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Filter units…" className="h-8 w-52 pl-8 text-sm"
          />
        </div>
        <Button
          variant="outline" size="sm" className="h-8"
          onClick={() => setSort(sort === 'headroom' ? 'unit' : 'headroom')}
        >
          <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
          {sort === 'headroom' ? 'Sorted by ₹45L headroom' : 'Sort by ₹45L headroom'}
        </Button>
        {atRisk > 0 && (
          <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-500">
            <AlertTriangle className="h-3 w-3" />
            {atRisk} unit{atRisk === 1 ? '' : 's'} within ₹1 lakh of the limit
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {shown.length} of {units.length} units · project is {rrep.isIndeterminate ? 'unclassified' : rrep.isRrep ? 'an RREP' : 'a REP other than RREP'}
        </span>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow>
              <TableHead>Unit</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Carpet</TableHead>
              <TableHead className="text-right">Base</TableHead>
              <TableHead className="text-right">Charges</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead className="text-right">₹45L headroom</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Taxed</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
              {actions.length > 0 && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.u.id}>
                <TableCell className="font-medium">{r.u.unit_no}</TableCell>
                <TableCell className="text-sm">{r.u.unit_type === 'Residential' ? 'Resi' : 'Comm'}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{r.u.carpet_area_sqm || '—'}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatINR(r.u.base_consideration)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {r.chargeTotal ? formatINR(r.chargeTotal) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right text-sm font-medium tabular-nums">{formatINR(r.cls.gross.gross)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{r.cls.ratePct}%</Badge>
                  <span className="block text-[10px] text-muted-foreground">eff. {r.cls.effectiveRatePct}%</span>
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {r.headroom === null ? <span className="text-muted-foreground">n/a</span> : (
                    <span className={r.headroom < 0
                      ? 'text-destructive'
                      : r.headroom < 100000 ? 'text-amber-600 dark:text-amber-500' : undefined}
                    >
                      {formatINR(r.headroom)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatINR(r.received)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatINR(r.taxed)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatINR(r.balance)}</TableCell>
                <TableCell className="text-sm">{r.u.status}</TableCell>
                {actions.length > 0 && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Actions for unit {r.u.unit_no}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {grouped.map(([group, items], gi) => (
                          <React.Fragment key={group}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {group}
                            </DropdownMenuLabel>
                            {items.map((a) => (
                              <DropdownMenuItem
                                key={a.key}
                                onSelect={() => a.onSelect({ id: r.u.id, unit_no: r.u.unit_no })}
                              >
                                {a.label}
                              </DropdownMenuItem>
                            ))}
                          </React.Fragment>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">{shown.length} units</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.base)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.charges)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.gross)}</TableCell>
              <TableCell colSpan={2} />
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.received)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.taxed)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.balance)}</TableCell>
              <TableCell colSpan={actions.length > 0 ? 2 : 1} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
};

export default BuilderUnitGrid;
