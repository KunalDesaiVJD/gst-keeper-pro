import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Plus, Trash2, Save, Send, Loader2, Lock, BarChart3, Download, AlertTriangle, Pencil, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import {
  WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR, WS_TR_TOTAL, WS_CELL_INPUT,
} from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  Gstr1Section, ManualRow, ColumnDef, SECTION_COLUMNS, NIL_SUPPLY_TYPES, DOC_TYPES,
  gstinHomeState, recomputeRowTax, assembleGstr1Json, hydrateManualEntriesFromJson, hasMissingHsnSummary,
  findInvalidGstinRows, findInvoiceValueMismatchRows, findInvalidAmendmentPeriodRows,
} from '@/utils/gstr1ManualBuild';
import { buildGstr1Summary } from '@/utils/buildGstr1Summary';

const INVOICE_SECTIONS: Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>[] = ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'at', 'txpd', 'ata', 'txpda'];

const SECTION_LABELS: Record<Gstr1Section, string> = {
  b2b: '4A/4B — B2B (Registered)', b2cl: '5 — B2CL (Large, Unregistered)',
  b2cs: '7 — B2CS (Others)', cdnr: '9B — Credit/Debit Notes (Registered)',
  cdnur: '9B — Credit/Debit Notes (Unregistered)', exp: '6A — Exports',
  at: '11A — Advances Received', txpd: '11B — Advance Adjustment',
  ata: '11(2) — Amended Advances Received', txpda: '11(2) — Amended Advance Adjustment',
  nil: '8 — Nil Rated / Exempted', hsn: '12 — HSN-wise Summary', doc: '13 — Documents Issued',
};

// The Annual Return grid look for the shadcn <Table> parts (TableHead/TableCell
// merge these over their own h-12 / p-4 defaults).
const TH = `h-auto ${WS_TH}`;
const TD = WS_TD;
const CELL_SELECT = 'h-9 w-full justify-between rounded-none border-0 bg-transparent px-2 text-sm font-normal shadow-none focus:ring-1 focus:ring-inset focus:ring-primary focus:ring-offset-0';
const READ_CELL = 'block px-2 py-1.5 text-sm';
const READ_NUM = 'block px-2 py-1.5 text-right text-sm tabular-nums';

let _localIdSeq = 0;
const newRowId = () => `new_${Date.now()}_${_localIdSeq++}`;

interface Props {
  clientId: string;
  clientGstin: string;
  clientName: string;
  periodShort: string; // "Jul-26"
  isFiled: boolean;
  canEdit: boolean;
  actorId: string | null;
  hasGeneratedJson: boolean; // gstr1_data already exists for this (client, period)
  onGenerated: () => void;   // parent refetches gstr1_data + versions
}

const Gstr1ManualEntryPanel: React.FC<Props> = ({
  clientId, clientGstin, clientName, periodShort, isFiled, canEdit, actorId, hasGeneratedJson, onGenerated,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<Gstr1Section>('b2b');
  const [collapsed, setCollapsed] = useState(hasGeneratedJson); // start collapsed once a JSON already exists
  const [summaryOpen, setSummaryOpen] = useState(false);

  const [rowsBySection, setRowsBySection] = useState<Record<Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>, ManualRow[]>>({
    b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], exp: [], at: [], txpd: [], ata: [], txpda: [],
  });
  const [nilRows, setNilRows] = useState<ManualRow[]>([]);
  const [docRows, setDocRows] = useState<ManualRow[]>([]);
  const [hsnRows, setHsnRows] = useState<ManualRow[]>([]);

  const homeState = gstinHomeState(clientGstin);

  // Live preview — assembled from whatever is currently in the grid (not yet
  // saved/generated), so the tile counts/values and "Generate Summary" always
  // reflect what's on screen right now, same shape a real import would use.
  const liveJson = useMemo(
    () => assembleGstr1Json({ gstin: clientGstin, periodShort, rowsBySection, nilRows, docRows, hsnRows }),
    [clientGstin, periodShort, rowsBySection, nilRows, docRows, hsnRows],
  );
  const liveSummary = useMemo(() => buildGstr1Summary(liveJson), [liveJson]);
  const tileFor = (key: Gstr1Section) => liveSummary.tiles.find((t) => t.key === key);
  const fmt2 = (n: number | undefined | null) => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fetchEntries = useCallback(async () => {
    if (!clientId || !periodShort) return;
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('gstr1_manual_entries' as any)
        .select('*')
        .eq('client_id', clientId)
        .eq('period_month', periodShort)
        .order('row_order', { ascending: true });

      const rows = (data as any[]) || [];
      let finalDocRows: ManualRow[] = [];
      if (rows.length > 0) {
        const bySection: Record<Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>, ManualRow[]> = { b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], exp: [], at: [], txpd: [], ata: [], txpda: [] };
        const nil: ManualRow[] = [];
        const doc: ManualRow[] = [];
        const hsn: ManualRow[] = [];
        rows.forEach((r) => {
          const row = { id: r.id, ...r.data };
          if (r.section === 'nil') nil.push(row);
          else if (r.section === 'doc') doc.push(row);
          else if (r.section === 'hsn') hsn.push(row);
          else if (bySection[r.section as Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>]) bySection[r.section as Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>].push(row);
        });
        setRowsBySection(bySection);
        setNilRows(nil);
        setDocRows(doc);
        setHsnRows(hsn);
        finalDocRows = doc;
      } else if (hasGeneratedJson) {
        // No manual entry rows saved yet, but a JSON already exists (e.g.
        // generated once before) — hydrate the grid from it so editing
        // continues from where it left off.
        const { data: existing } = await supabase
          .from('gstr1_data').select('raw_json')
          .eq('client_id', clientId).eq('period_month', periodShort).maybeSingle();
        if (existing?.raw_json) {
          const hydrated = hydrateManualEntriesFromJson(existing.raw_json);
          setRowsBySection(hydrated.rowsBySection);
          setNilRows(hydrated.nilRows);
          setDocRows(hydrated.docRows);
          setHsnRows(hydrated.hsnRows);
          finalDocRows = hydrated.docRows;
        }
      } else {
        setRowsBySection({ b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], exp: [], at: [], txpd: [], ata: [], txpda: [] });
        setNilRows([]);
        setDocRows([]);
        setHsnRows([]);
      }
      // Documents Issued is mandatory before upload (unless NIL) and is NEVER
      // prefilled — collapsing the panel by default whenever a JSON already
      // exists (the usual rule, so a finished return stays compact) would
      // hide the one thing staff still have to fill in by hand. Force it
      // open, on the Documents tab, whenever that's still outstanding.
      if (!isFiled && finalDocRows.length === 0) {
        setCollapsed(false);
        setActiveTab('doc');
      }
    } catch (err: any) {
      toast.error('Failed to load manual entries: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, periodShort, hasGeneratedJson, isFiled]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);
  useEffect(() => { setCollapsed(hasGeneratedJson); }, [clientId, periodShort]); // eslint-disable-line react-hooks/exhaustive-deps

  const addRow = (section: Gstr1Section) => {
    if (section === 'nil') setNilRows((prev) => [...prev, { id: newRowId(), sply_ty: 'INTRB2B', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 }]);
    else if (section === 'doc') setDocRows((prev) => [...prev, { id: newRowId(), doc_typ: DOC_TYPES[0].value, from: '', to: '', totnum: 0, cancel: 0 }]);
    else if (section === 'hsn') setHsnRows((prev) => [...prev, { id: newRowId(), _src: 'hsn_b2b', hsn_sc: '', desc: '', uqc: 'NA', qty: 0, rt: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }]);
    else setRowsBySection((prev) => ({ ...prev, [section]: [...prev[section], { id: newRowId() }] }));
  };

  const deleteRow = (section: Gstr1Section, id: string) => {
    if (section === 'nil') setNilRows((prev) => prev.filter((r) => r.id !== id));
    else if (section === 'doc') setDocRows((prev) => prev.filter((r) => r.id !== id));
    else if (section === 'hsn') setHsnRows((prev) => prev.filter((r) => r.id !== id));
    else setRowsBySection((prev) => ({ ...prev, [section]: prev[section].filter((r) => r.id !== id) }));
  };

  const updateRow = (section: Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>, id: string, field: string, value: any) => {
    setRowsBySection((prev) => ({
      ...prev,
      [section]: prev[section].map((r) => {
        if (r.id !== id) return r;
        let next = { ...r, [field]: value };
        // Auto-derive POS from the customer GSTIN's state-code prefix (first
        // 2 digits) — POS is the party's home state for the overwhelming
        // majority of B2B/CDNR invoices, so typing it twice is needless
        // friction. Still editable afterward for the rare bill-to/ship-to
        // mismatch (b2cl/b2cs/cdnur/exp have no ctin column, so this never
        // fires there).
        if (field === 'ctin' && typeof value === 'string' && value.length >= 2) {
          next.pos = value.slice(0, 2).toUpperCase();
        }
        if (['rt', 'txval', 'ad_amt', 'pos', 'typ', 'ctin'].includes(field)) next = recomputeRowTax(section, next, homeState);
        return next;
      }),
    }));
  };

  const updateNilRow = (id: string, field: string, value: any) => setNilRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  // Total Issued auto-calculates from From/To (e.g. 15 to 15 => 1 document),
  // extracting the trailing numeric run so series like "INV001".."INV015"
  // still work, not just plain numbers. Stays a normal editable field —
  // typing directly into Total Issued overrides it until From/To changes again.
  const docSeriesCount = (from: string, to: string): number | null => {
    const f = String(from ?? '').match(/(\d+)\s*$/)?.[1];
    const t = String(to ?? '').match(/(\d+)\s*$/)?.[1];
    if (!f || !t) return null;
    const diff = parseInt(t, 10) - parseInt(f, 10) + 1;
    return diff > 0 ? diff : null;
  };
  const updateDocRow = (id: string, field: string, value: any) =>
    setDocRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, [field]: value };
      if (field === 'from' || field === 'to') {
        const count = docSeriesCount(next.from, next.to);
        if (count !== null) next.totnum = count;
      }
      return next;
    }));

  const updateHsnRow = (id: string, field: string, value: any) => setHsnRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  const persistRows = async () => {
    await supabase.from('gstr1_manual_entries' as any)
      .delete().eq('client_id', clientId).eq('period_month', periodShort);

    const inserts: any[] = [];
    INVOICE_SECTIONS.forEach((section) => {
      rowsBySection[section].forEach((row, idx) => {
        const { id, ...data } = row;
        inserts.push({ client_id: clientId, period_month: periodShort, section, row_order: idx, data, updated_by: actorId });
      });
    });
    nilRows.forEach((row, idx) => {
      const { id, ...data } = row;
      inserts.push({ client_id: clientId, period_month: periodShort, section: 'nil', row_order: idx, data, updated_by: actorId });
    });
    docRows.forEach((row, idx) => {
      const { id, ...data } = row;
      inserts.push({ client_id: clientId, period_month: periodShort, section: 'doc', row_order: idx, data, updated_by: actorId });
    });
    hsnRows.forEach((row, idx) => {
      const { id, ...data } = row;
      inserts.push({ client_id: clientId, period_month: periodShort, section: 'hsn', row_order: idx, data, updated_by: actorId });
    });
    if (inserts.length > 0) {
      const { error } = await supabase.from('gstr1_manual_entries' as any).insert(inserts);
      if (error) throw error;
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await persistRows();
      toast.success('Manual entries saved.');
    } catch (err: any) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerate = async () => {
    // GSTN has made HSN-wise reporting mandatory on GSTR-1 — a return with
    // real taxable value but an empty Table 12 gets rejected by the portal's
    // upload validator with a generic "download the latest offline tool"
    // message that gives no hint HSN is the actual problem. Catch it here so
    // the operator fixes it before wasting a portal round-trip.
    if (hasMissingHsnSummary(rowsBySection, hsnRows)) {
      toast.error('This return has taxable value but no HSN summary (Table 12) rows — the portal will reject the upload. Add at least one row on the "12 — HSN-wise Summary" tab first.');
      return;
    }
    // A single malformed counterparty GSTIN anywhere in the file bounces the
    // whole upload with the same generic "could not be uploaded" message —
    // catch it here with a specific reason instead of finding out on the portal.
    const invalidGstin = findInvalidGstinRows(rowsBySection);
    if (invalidGstin.length > 0) {
      const preview = invalidGstin.slice(0, 5).map((m) => `${SECTION_LABELS[m.section]}: ${m.inum} (${m.ctin})`).join('; ');
      toast.error(
        `${invalidGstin.length} row(s) have a malformed counterparty GSTIN — the portal will reject the upload. ` +
        `Fix these first: ${preview}${invalidGstin.length > 5 ? '…' : ''}`
      );
      return;
    }
    // Invoice/Note Value must equal taxable value + tax exactly (a few paise
    // off is enough to bounce the upload) — usually caused by typing a
    // rounded total from the physical invoice instead of the computed sum.
    const valueMismatches = findInvoiceValueMismatchRows(rowsBySection);
    if (valueMismatches.length > 0) {
      const preview = valueMismatches.slice(0, 5)
        .map((m) => `${SECTION_LABELS[m.section]}: ${m.inum} (entered ₹${m.entered.toFixed(2)}, should be ₹${m.expected.toFixed(2)})`)
        .join('; ');
      toast.error(
        `${valueMismatches.length} invoice(s) have an Invoice/Note Value that doesn't match taxable value + tax — ` +
        `the portal will reject the upload. Fix these first: ${preview}${valueMismatches.length > 5 ? '…' : ''}`
      );
      return;
    }
    // A Table 11(2) amendment row with a blank, malformed or non-earlier
    // original period is dropped silently by assembleGstr1Json's group filter
    // — the operator would see the row on screen and never see it in the JSON.
    const invalidAmendments = findInvalidAmendmentPeriodRows(rowsBySection, periodShort);
    if (invalidAmendments.length > 0) {
      const preview = invalidAmendments.slice(0, 5)
        .map((m) => `${SECTION_LABELS[m.section]}: ${m.omon} — ${m.reason}`)
        .join('; ');
      toast.error(
        `${invalidAmendments.length} amendment row(s) have an invalid original period and would be dropped from the JSON. ` +
        `Fix these first: ${preview}${invalidAmendments.length > 5 ? '…' : ''}`
      );
      return;
    }
    setIsGenerating(true);
    try {
      await persistRows();

      const json = assembleGstr1Json({ gstin: clientGstin, periodShort, rowsBySection, nilRows, docRows, hsnRows });

      const { data: written, error } = await supabase
        .from('gstr1_data')
        .upsert({
          client_id: clientId,
          period_month: periodShort,
          raw_json: json,
          file_name: `Manual entry — ${clientName} — ${periodShort}`,
          imported_by: actorId,
          imported_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id,period_month' })
        .select('id');
      if (error) throw error;
      if (!written || written.length === 0) throw new Error('Write was rejected by the database.');

      await supabase.from('gstr1_upload_versions' as any).insert({
        client_id: clientId,
        period_month: periodShort,
        action_type: 'IMPORT',
        actor_id: actorId,
        file_name: `Manual entry — ${clientName}`,
        status: 'imported',
        summary: 'Generated from manual invoice entry',
      });

      toast.success('GSTR-1 JSON generated from manual entries.');
      setCollapsed(true);
      onGenerated();
    } catch (err: any) {
      toast.error('Failed to generate: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const sectionTotal = (rows: ManualRow[]) => rows.reduce((s, r) => s + (Number(r.txval ?? r.ad_amt) || 0), 0);

  const renderCell = (section: Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>, row: ManualRow, col: ColumnDef) => {
    const value = row[col.key] ?? '';
    if (!canEdit || isFiled) return <span className={cn('block px-2 py-1.5 text-xs', col.type === 'number' && 'text-right tabular-nums')}>{value}</span>;
    // Auto-computed tax columns (IGST/CGST/SGST) are pre-filled from rate +
    // taxable value + POS, rounded to the nearest rupee, but remain plain
    // editable number inputs — typing over one sticks until rt/txval/pos
    // changes again and recomputes it.
    if (col.type === 'state') {
      return (
        <SearchableSelect
          options={[{ value: '', label: '—' }, ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')).concat(['97', '99']).map((code) => ({ value: code, label: code }))]}
          value={value}
          onValueChange={(v) => updateRow(section, row.id, col.key, v)}
          placeholder="POS"
          className={CELL_SELECT}
        />
      );
    }
    if (col.type === 'select') {
      return (
        <Select value={value || undefined} onValueChange={(v) => updateRow(section, row.id, col.key, v)}>
          <SelectTrigger className={CELL_SELECT}><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>{(col.options || []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    return (
      <Input
        type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
        value={value}
        onChange={(e) => updateRow(section, row.id, col.key, col.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
        className={cn(WS_CELL_INPUT, col.type === 'number' && 'text-right tabular-nums')}
      />
    );
  };

  const editable = canEdit && !isFiled;

  /** Hover-revealed row delete, as on the GST Update Sheet. */
  const deleteCell = (section: Gstr1Section, id: string) => (
    <TableCell className={`${TD} p-0 text-center`}>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-destructive opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        onClick={() => deleteRow(section, id)}
        aria-label="Delete row"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </TableCell>
  );

  const emptyRow = (colSpan: number) => (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className={`${TD} py-6 text-center text-xs text-muted-foreground`}>No rows yet.</TableCell>
    </TableRow>
  );

  const addRowButton = (section: Gstr1Section, disabled = false) => (
    <Button size="sm" variant="outline" className={WS_BTN} onClick={() => addRow(section)} disabled={disabled}>
      <Plus className="h-3.5 w-3.5" /> Add row
    </Button>
  );

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-3 gap-y-1.5 space-y-0 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <CardTitle className="flex flex-wrap items-center gap-2 text-[15px] leading-snug">
            Manual GSTR-1 Entry
            {!isFiled && docRows.length === 0 && (
              <Badge variant="destructive" className="gap-1 px-1.5 text-[10px] font-medium">
                <AlertTriangle className="h-3 w-3 text-destructive" /> Documents Issued required
              </Badge>
            )}
            {isFiled && (
              <Badge variant="success" className="gap-1 px-1.5 text-[10px] font-medium">
                <Lock className="h-3 w-3" /> Filed · view-only
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs leading-snug">Key in invoices directly — Generate JSON produces the same file an imported return would have.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!collapsed && (
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => setSummaryOpen(true)}>
              <BarChart3 className="h-3.5 w-3.5" /> Generate Summary
            </Button>
          )}
          {hasGeneratedJson && (
            <Button variant="ghost" size="sm" className={WS_BTN} onClick={() => setCollapsed((c) => !c)}>
              {collapsed ? <><Pencil className="h-3.5 w-3.5" /> Edit Entries</> : <><ChevronUp className="h-3.5 w-3.5" /> Hide</>}
            </Button>
          )}
          {canEdit && !isFiled && !collapsed && (
            <>
              <Button variant="outline" size="sm" className={WS_BTN} onClick={handleSave} disabled={isSaving || isGenerating}>
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
              <Button size="sm" onClick={handleGenerate} disabled={isSaving || isGenerating} className={cn(WS_BTN, 'px-3 bg-success text-success-foreground hover:bg-success/90')}>
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Generate JSON
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className={cn('space-y-2.5 px-4', collapsed && !isFiled ? 'pb-0' : 'pb-3')}>
        {isFiled && (
          <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-2.5 py-1.5 text-xs text-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-strong" />
            <p>GSTR-1 already Filed for this period — manual entries are locked (view-only).</p>
          </div>
        )}

        {collapsed ? null : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading entries…
          </div>
        ) : (
          <>
            {/* Section picker — same tile-grid style as the imported-JSON page's
                "Sections in this return": click a tile to open that section's
                editable table below. Counts/values are live, computed from
                whatever is currently in the grid. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {(['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'at', 'txpd', 'nil', 'hsn', 'doc'] as Gstr1Section[]).map((s) => {
                const tile = tileFor(s);
                return (
                  <SectionTile
                    key={s}
                    label={SECTION_LABELS[s]}
                    count={tile?.count ?? 0}
                    value={tile?.value ? `₹${fmt2(tile.value)}` : undefined}
                    active={activeTab === s}
                    onClick={() => setActiveTab(s)}
                  />
                );
              })}
            </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Gstr1Section)}>
            {INVOICE_SECTIONS.map((section) => (
              <TabsContent key={section} value={section} className="mt-0 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{SECTION_LABELS[section]}</span>
                    {' · '}{rowsBySection[section].length} row(s) · Taxable total <span className="tabular-nums">₹{sectionTotal(rowsBySection[section]).toLocaleString('en-IN')}</span>
                  </p>
                  {editable && addRowButton(section)}
                </div>
                <div className={cn(WS_TABLE_WRAP, 'max-h-[60vh]')}>
                  <Table className={WS_TABLE} containerClassName="overflow-visible">
                    <TableHeader>
                      <TableRow className="border-0 hover:bg-transparent">
                        {SECTION_COLUMNS[section].map((col) => (
                          <TableHead key={col.key} className={cn(TH, col.width, col.type === 'number' && 'text-right')}>{col.label}</TableHead>
                        ))}
                        {editable && <TableHead className={`${TH} w-9`} />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rowsBySection[section].map((row) => (
                        <TableRow key={row.id} className={WS_TR}>
                          {SECTION_COLUMNS[section].map((col) => <TableCell key={col.key} className={`${TD} p-0`}>{renderCell(section, row, col)}</TableCell>)}
                          {editable && deleteCell(section, row.id)}
                        </TableRow>
                      ))}
                      {rowsBySection[section].length === 0 && emptyRow(SECTION_COLUMNS[section].length + 1)}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            ))}

            <TabsContent value="nil" className="mt-0 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">{SECTION_LABELS.nil}</p>
                {editable && addRowButton('nil', nilRows.length >= NIL_SUPPLY_TYPES.length)}
              </div>
              <div className={WS_TABLE_WRAP}>
                <Table className={WS_TABLE} containerClassName="overflow-visible">
                  <TableHeader><TableRow className="border-0 hover:bg-transparent">
                    <TableHead className={TH}>Supply Type</TableHead>
                    <TableHead className={`${TH} text-right`}>Nil Rated</TableHead>
                    <TableHead className={`${TH} text-right`}>Exempted</TableHead>
                    <TableHead className={`${TH} text-right`}>Non-GST</TableHead>
                    {editable && <TableHead className={`${TH} w-9`} />}
                  </TableRow></TableHeader>
                  <TableBody>
                    {nilRows.map((row) => (
                      <TableRow key={row.id} className={WS_TR}>
                        <TableCell className={`${TD} p-0`}>
                          {editable ? (
                            <Select value={row.sply_ty} onValueChange={(v) => updateNilRow(row.id, 'sply_ty', v)}>
                              <SelectTrigger className={CELL_SELECT}><SelectValue /></SelectTrigger>
                              <SelectContent>{NIL_SUPPLY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : <span className={READ_CELL}>{NIL_SUPPLY_TYPES.find((t) => t.value === row.sply_ty)?.label || row.sply_ty}</span>}
                        </TableCell>
                        {(['nil_amt', 'expt_amt', 'ngsup_amt'] as const).map((f) => (
                          <TableCell key={f} className={`${TD} p-0`}>
                            {editable ? (
                              <Input type="number" value={row[f] ?? 0} onChange={(e) => updateNilRow(row.id, f, parseFloat(e.target.value) || 0)} className={`${WS_CELL_INPUT} text-right tabular-nums`} />
                            ) : <span className={READ_NUM}>{Number(row[f] || 0).toLocaleString('en-IN')}</span>}
                          </TableCell>
                        ))}
                        {editable && deleteCell('nil', row.id)}
                      </TableRow>
                    ))}
                    {nilRows.length === 0 && emptyRow(5)}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="hsn" className="mt-0 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">{SECTION_LABELS.hsn}</p>
                {editable && addRowButton('hsn')}
              </div>
              <Note>
                One row per HSN/SAC + rate combination — this is the aggregate the portal expects, not a per-invoice
                breakdown. Counts (Qty) are optional for services (leave UQC as NA).
              </Note>
              <div className={WS_TABLE_WRAP}>
                <Table className={WS_TABLE} containerClassName="overflow-visible">
                  <TableHeader><TableRow className="border-0 hover:bg-transparent">
                    <TableHead className={TH}>HSN Code</TableHead>
                    <TableHead className={TH}>Type</TableHead>
                    <TableHead className={TH}>UQC</TableHead>
                    <TableHead className={`${TH} text-right`}>Qty</TableHead>
                    <TableHead className={`${TH} text-right`}>Rate %</TableHead>
                    <TableHead className={`${TH} text-right`}>Taxable Value</TableHead>
                    <TableHead className={`${TH} text-right`}>IGST</TableHead>
                    <TableHead className={`${TH} text-right`}>CGST</TableHead>
                    <TableHead className={`${TH} text-right`}>SGST</TableHead>
                    <TableHead className={`${TH} text-right`}>Cess</TableHead>
                    {editable && <TableHead className={`${TH} w-9`} />}
                  </TableRow></TableHeader>
                  <TableBody>
                    {hsnRows.map((row) => (
                      <TableRow key={row.id} className={WS_TR}>
                        <TableCell className={`${TD} p-0`}>
                          {editable ? (
                            <Input value={row.hsn_sc || ''} onChange={(e) => updateHsnRow(row.id, 'hsn_sc', e.target.value)} className={WS_CELL_INPUT} />
                          ) : <span className={`${READ_CELL} font-mono`}>{row.hsn_sc}</span>}
                        </TableCell>
                        <TableCell className={`${TD} p-0`}>
                          {editable ? (
                            <Select value={row._src || 'hsn_b2b'} onValueChange={(v) => updateHsnRow(row.id, '_src', v)}>
                              <SelectTrigger className={CELL_SELECT}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="hsn_b2b">B2B / CDNR (registered)</SelectItem>
                                <SelectItem value="hsn_b2c">Other (B2C / Exports)</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : <span className={READ_CELL}>{row._src === 'hsn_b2c' ? 'Other (B2C / Exports)' : 'B2B / CDNR (registered)'}</span>}
                        </TableCell>
                        {(['uqc'] as const).map((f) => (
                          <TableCell key={f} className={`${TD} p-0`}>
                            {editable ? (
                              <Input value={row[f] || ''} onChange={(e) => updateHsnRow(row.id, f, e.target.value)} className={WS_CELL_INPUT} />
                            ) : <span className={READ_CELL}>{row[f]}</span>}
                          </TableCell>
                        ))}
                        {(['qty', 'rt', 'txval', 'iamt', 'camt', 'samt', 'csamt'] as const).map((f) => (
                          <TableCell key={f} className={`${TD} p-0`}>
                            {editable ? (
                              <Input type="number" value={row[f] ?? 0} onChange={(e) => updateHsnRow(row.id, f, parseFloat(e.target.value) || 0)} className={`${WS_CELL_INPUT} text-right tabular-nums`} />
                            ) : <span className={READ_NUM}>{Number(row[f] || 0).toLocaleString('en-IN')}</span>}
                          </TableCell>
                        ))}
                        {editable && deleteCell('hsn', row.id)}
                      </TableRow>
                    ))}
                    {hsnRows.length === 0 && emptyRow(11)}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="doc" className="mt-0 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">{SECTION_LABELS.doc}</p>
                {editable && addRowButton('doc')}
              </div>
              <div className={WS_TABLE_WRAP}>
                <Table className={WS_TABLE} containerClassName="overflow-visible">
                  <TableHeader><TableRow className="border-0 hover:bg-transparent">
                    <TableHead className={TH}>Document Type</TableHead>
                    <TableHead className={`${TH} w-28`}>From</TableHead>
                    <TableHead className={`${TH} w-28`}>To</TableHead>
                    <TableHead className={`${TH} w-24 text-right`}>Total Issued</TableHead>
                    <TableHead className={`${TH} w-24 text-right`}>Cancelled</TableHead>
                    {editable && <TableHead className={`${TH} w-9`} />}
                  </TableRow></TableHeader>
                  <TableBody>
                    {docRows.map((row) => (
                      <TableRow key={row.id} className={WS_TR}>
                        <TableCell className={`${TD} p-0`}>
                          {editable ? (
                            <Select value={row.doc_typ} onValueChange={(v) => updateDocRow(row.id, 'doc_typ', v)}>
                              <SelectTrigger className={CELL_SELECT}><SelectValue /></SelectTrigger>
                              <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.value}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : <span className={READ_CELL}>{row.doc_typ}</span>}
                        </TableCell>
                        {(['from', 'to'] as const).map((f) => (
                          <TableCell key={f} className={`${TD} p-0`}>
                            {editable ? (
                              <Input value={row[f] ?? ''} onChange={(e) => updateDocRow(row.id, f, e.target.value)} className={WS_CELL_INPUT} />
                            ) : <span className={READ_CELL}>{row[f]}</span>}
                          </TableCell>
                        ))}
                        {(['totnum', 'cancel'] as const).map((f) => (
                          <TableCell key={f} className={`${TD} p-0`}>
                            {editable ? (
                              <Input type="number" value={row[f] ?? 0} onChange={(e) => updateDocRow(row.id, f, parseInt(e.target.value) || 0)} className={`${WS_CELL_INPUT} text-right tabular-nums`} />
                            ) : <span className={READ_NUM}>{row[f]}</span>}
                          </TableCell>
                        ))}
                        {editable && deleteCell('doc', row.id)}
                      </TableRow>
                    ))}
                    {docRows.length === 0 && emptyRow(6)}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
          </>
        )}
      </CardContent>

      {/* Live "Generate Summary" preview — assembled from the current grid,
          same table layout as the imported-JSON page's summary dialog. */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle>GSTR-1 Summary (preview) — {clientName || '—'} · {periodShort}</DialogTitle>
                <DialogDescription>
                  Computed live from the entries currently in the grid — not yet saved. Click Generate JSON to persist.
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className={cn(WS_BTN, 'shrink-0')}
                onClick={() => {
                  const blob = new Blob([JSON.stringify(liveJson)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `GSTR1_preview_${(clientName || 'client').replace(/\s+/g, '_')}_${periodShort}.json`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="h-3.5 w-3.5" /> Download JSON (preview)
              </Button>
            </div>
          </DialogHeader>
          <div className={cn(WS_TABLE_WRAP, 'min-h-0')}>
            <table className={`${WS_TABLE} min-w-[900px]`}>
              <thead>
                <tr>
                  <th className={WS_TH}>Description</th>
                  <th className={`${WS_TH} text-center`}>No. of records</th>
                  <th className={`${WS_TH} text-center`}>Document Type</th>
                  <th className={`${WS_TH} text-right`}>Value (₹)</th>
                  <th className={`${WS_TH} text-right`}>Integrated Tax (₹)</th>
                  <th className={`${WS_TH} text-right`}>Central Tax (₹)</th>
                  <th className={`${WS_TH} text-right`}>State/UT Tax (₹)</th>
                  <th className={`${WS_TH} text-right`}>Cess (₹)</th>
                </tr>
              </thead>
              <tbody>
                {liveSummary.sections.map((s, i) => (
                  <tr key={`${s.code}-${i}`} className={WS_TR}>
                    <td className={WS_TD}>
                      <span className="font-semibold text-foreground">{s.code}</span>
                      <span className="text-muted-foreground"> — {s.title}</span>
                    </td>
                    <td className={`${WS_TD} text-center tabular-nums`}>{s.count.toLocaleString('en-IN')}</td>
                    <td className={`${WS_TD} text-center text-muted-foreground`}>{s.docType}</td>
                    <td className={WS_TD_NUM}>{fmt2(s.value)}</td>
                    <td className={WS_TD_NUM}>{fmt2(s.igst)}</td>
                    <td className={WS_TD_NUM}>{fmt2(s.cgst)}</td>
                    <td className={WS_TD_NUM}>{fmt2(s.sgst)}</td>
                    <td className={WS_TD_NUM}>{fmt2(s.cess)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 z-10">
                <tr className={WS_TR_TOTAL}>
                  <td className={`${WS_TD} text-right`} colSpan={3}>Total liability (excl. HSN &amp; Docs)</td>
                  <td className={WS_TD_NUM}>{fmt2(liveSummary.totals.value)}</td>
                  <td className={WS_TD_NUM}>{fmt2(liveSummary.totals.igst)}</td>
                  <td className={WS_TD_NUM}>{fmt2(liveSummary.totals.cgst)}</td>
                  <td className={WS_TD_NUM}>{fmt2(liveSummary.totals.sgst)}</td>
                  <td className={WS_TD_NUM}>{fmt2(liveSummary.totals.cess)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

/** A section tile in the KpiTile look, as a button that opens the section's grid (same as the GSTR-1 page's). */
const SectionTile: React.FC<{ label: string; count: number; value?: string; active: boolean; onClick: () => void }> = ({ label, count, value, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-pressed={active}
    className={cn(
      'flex flex-col rounded-lg border bg-card px-3 py-1.5 text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active && 'border-primary/60 ring-2 ring-primary/60',
    )}
  >
    <span className="line-clamp-2 min-h-[2.2em] text-[11px] font-medium leading-tight text-muted-foreground">{label}</span>
    <span className={cn('text-[15px] font-semibold leading-tight tabular-nums', count === 0 && 'text-muted-foreground')}>{count.toLocaleString('en-IN')}</span>
    <span className="truncate text-[11px] leading-tight tabular-nums text-muted-foreground">{value ?? '\u00A0'}</span>
  </button>
);

export default Gstr1ManualEntryPanel;
