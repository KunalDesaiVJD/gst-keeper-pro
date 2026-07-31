import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Save, Send, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  Gstr1Section, ManualRow, ColumnDef, SECTION_COLUMNS, NIL_SUPPLY_TYPES, DOC_TYPES,
  gstinHomeState, recomputeRowTax, assembleGstr1Json, hydrateManualEntriesFromJson,
} from '@/utils/gstr1ManualBuild';

const INVOICE_SECTIONS: Exclude<Gstr1Section, 'nil' | 'doc'>[] = ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp'];

const SECTION_LABELS: Record<Gstr1Section, string> = {
  b2b: '4A/4B — B2B (Registered)', b2cl: '5 — B2CL (Large, Unregistered)',
  b2cs: '7 — B2CS (Others)', cdnr: '9B — Credit/Debit Notes (Registered)',
  cdnur: '9B — Credit/Debit Notes (Unregistered)', exp: '6A — Exports',
  nil: '8 — Nil Rated / Exempted', doc: '13 — Documents Issued',
};

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

  const [rowsBySection, setRowsBySection] = useState<Record<Exclude<Gstr1Section, 'nil' | 'doc'>, ManualRow[]>>({
    b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], exp: [],
  });
  const [nilRows, setNilRows] = useState<ManualRow[]>([]);
  const [docRows, setDocRows] = useState<ManualRow[]>([]);

  const homeState = gstinHomeState(clientGstin);

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
      if (rows.length > 0) {
        const bySection: Record<Exclude<Gstr1Section, 'nil' | 'doc'>, ManualRow[]> = { b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], exp: [] };
        const nil: ManualRow[] = [];
        const doc: ManualRow[] = [];
        rows.forEach((r) => {
          const row = { id: r.id, ...r.data };
          if (r.section === 'nil') nil.push(row);
          else if (r.section === 'doc') doc.push(row);
          else if (bySection[r.section as Exclude<Gstr1Section, 'nil' | 'doc'>]) bySection[r.section as Exclude<Gstr1Section, 'nil' | 'doc'>].push(row);
        });
        setRowsBySection(bySection);
        setNilRows(nil);
        setDocRows(doc);
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
        }
      } else {
        setRowsBySection({ b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], exp: [] });
        setNilRows([]);
        setDocRows([]);
      }
    } catch (err: any) {
      toast.error('Failed to load manual entries: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, periodShort, hasGeneratedJson]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);
  useEffect(() => { setCollapsed(hasGeneratedJson); }, [clientId, periodShort]); // eslint-disable-line react-hooks/exhaustive-deps

  const addRow = (section: Gstr1Section) => {
    if (section === 'nil') setNilRows((prev) => [...prev, { id: newRowId(), sply_ty: 'INTRB2B', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 }]);
    else if (section === 'doc') setDocRows((prev) => [...prev, { id: newRowId(), doc_typ: DOC_TYPES[0].value, from: '', to: '', totnum: 0, cancel: 0 }]);
    else setRowsBySection((prev) => ({ ...prev, [section]: [...prev[section], { id: newRowId() }] }));
  };

  const deleteRow = (section: Gstr1Section, id: string) => {
    if (section === 'nil') setNilRows((prev) => prev.filter((r) => r.id !== id));
    else if (section === 'doc') setDocRows((prev) => prev.filter((r) => r.id !== id));
    else setRowsBySection((prev) => ({ ...prev, [section]: prev[section].filter((r) => r.id !== id) }));
  };

  const updateRow = (section: Exclude<Gstr1Section, 'nil' | 'doc'>, id: string, field: string, value: any) => {
    setRowsBySection((prev) => ({
      ...prev,
      [section]: prev[section].map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [field]: value };
        if (['rt', 'txval', 'pos', 'typ'].includes(field)) return recomputeRowTax(section, next, homeState);
        return next;
      }),
    }));
  };

  const updateNilRow = (id: string, field: string, value: any) => setNilRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  const updateDocRow = (id: string, field: string, value: any) => setDocRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

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
    setIsGenerating(true);
    try {
      await persistRows();

      const json = assembleGstr1Json({ gstin: clientGstin, periodShort, rowsBySection, nilRows, docRows });

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

  const sectionTotal = (rows: ManualRow[]) => rows.reduce((s, r) => s + (Number(r.txval) || 0), 0);

  const renderCell = (section: Exclude<Gstr1Section, 'nil' | 'doc'>, row: ManualRow, col: ColumnDef) => {
    const value = row[col.key] ?? '';
    if (!canEdit || isFiled) return <span className="text-xs px-1 tabular-nums">{value}</span>;
    if (col.computed) return <span className="text-xs px-1 tabular-nums text-muted-foreground">{Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>;
    if (col.type === 'state') {
      return (
        <SearchableSelect
          options={[{ value: '', label: '—' }, ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')).concat(['97', '99']).map((code) => ({ value: code, label: code }))]}
          value={value}
          onValueChange={(v) => updateRow(section, row.id, col.key, v)}
          placeholder="POS"
          className="h-8 text-xs w-full"
        />
      );
    }
    if (col.type === 'select') {
      return (
        <Select value={value || undefined} onValueChange={(v) => updateRow(section, row.id, col.key, v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>{(col.options || []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    return (
      <Input
        type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
        value={value}
        onChange={(e) => updateRow(section, row.id, col.key, col.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
        className="h-8 text-xs"
      />
    );
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Manual GSTR-1 Entry</h3>
            <p className="text-xs text-muted-foreground">Key in invoices directly — Generate JSON produces the same file an imported return would have.</p>
          </div>
          <div className="flex items-center gap-2">
            {hasGeneratedJson && (
              <Button variant="ghost" size="sm" onClick={() => setCollapsed((c) => !c)}>
                {collapsed ? 'Edit Entries' : 'Hide'}
              </Button>
            )}
            {canEdit && !isFiled && !collapsed && (
              <>
                <Button variant="outline" size="sm" onClick={handleSave} disabled={isSaving || isGenerating}>
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                  Save
                </Button>
                <Button size="sm" onClick={handleGenerate} disabled={isSaving || isGenerating} className="bg-success text-success-foreground hover:bg-success/90">
                  {isGenerating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                  Generate JSON
                </Button>
              </>
            )}
          </div>
        </div>

        {isFiled && (
          <div className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm mb-3">
            <Lock className="h-4 w-4 mt-0.5 shrink-0 text-success" />
            <p className="text-foreground/80">GSTR-1 already Filed for this period — manual entries are locked (view-only).</p>
          </div>
        )}

        {collapsed ? null : isLoading ? (
          <div className="py-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Gstr1Section)}>
            <TabsList className="flex-wrap h-auto">
              {(['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'nil', 'doc'] as Gstr1Section[]).map((s) => (
                <TabsTrigger key={s} value={s} className="text-xs">{SECTION_LABELS[s]}</TabsTrigger>
              ))}
            </TabsList>

            {INVOICE_SECTIONS.map((section) => (
              <TabsContent key={section} value={section} className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">
                    {rowsBySection[section].length} row(s) · Taxable total ₹{sectionTotal(rowsBySection[section]).toLocaleString('en-IN')}
                  </p>
                  {canEdit && !isFiled && (
                    <Button size="sm" variant="outline" onClick={() => addRow(section)}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Row
                    </Button>
                  )}
                </div>
                <div className="rounded-md border overflow-auto max-h-[60vh]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted z-10">
                      <TableRow>
                        {SECTION_COLUMNS[section].map((col) => <TableHead key={col.key} className={`text-xs ${col.width || ''}`}>{col.label}</TableHead>)}
                        {canEdit && !isFiled && <TableHead className="w-10" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rowsBySection[section].map((row) => (
                        <TableRow key={row.id}>
                          {SECTION_COLUMNS[section].map((col) => <TableCell key={col.key} className="p-1">{renderCell(section, row, col)}</TableCell>)}
                          {canEdit && !isFiled && (
                            <TableCell className="p-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteRow(section, row.id)}>
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                      {rowsBySection[section].length === 0 && (
                        <TableRow><TableCell colSpan={SECTION_COLUMNS[section].length + 1} className="text-center text-muted-foreground py-6 text-sm">No rows yet.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            ))}

            <TabsContent value="nil" className="mt-4">
              <div className="flex items-center justify-between mb-2">
                {canEdit && !isFiled && (
                  <Button size="sm" variant="outline" onClick={() => addRow('nil')} disabled={nilRows.length >= NIL_SUPPLY_TYPES.length}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Row
                  </Button>
                )}
              </div>
              <div className="rounded-md border overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">Supply Type</TableHead>
                    <TableHead className="text-xs">Nil Rated</TableHead>
                    <TableHead className="text-xs">Exempted</TableHead>
                    <TableHead className="text-xs">Non-GST</TableHead>
                    {canEdit && !isFiled && <TableHead className="w-10" />}
                  </TableRow></TableHeader>
                  <TableBody>
                    {nilRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="p-1">
                          {canEdit && !isFiled ? (
                            <Select value={row.sply_ty} onValueChange={(v) => updateNilRow(row.id, 'sply_ty', v)}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>{NIL_SUPPLY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : <span className="text-xs">{NIL_SUPPLY_TYPES.find((t) => t.value === row.sply_ty)?.label || row.sply_ty}</span>}
                        </TableCell>
                        {(['nil_amt', 'expt_amt', 'ngsup_amt'] as const).map((f) => (
                          <TableCell key={f} className="p-1">
                            {canEdit && !isFiled ? (
                              <Input type="number" value={row[f] ?? 0} onChange={(e) => updateNilRow(row.id, f, parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                            ) : <span className="text-xs tabular-nums">{Number(row[f] || 0).toLocaleString('en-IN')}</span>}
                          </TableCell>
                        ))}
                        {canEdit && !isFiled && (
                          <TableCell className="p-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteRow('nil', row.id)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {nilRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6 text-sm">No rows yet.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="doc" className="mt-4">
              <div className="flex items-center justify-between mb-2">
                {canEdit && !isFiled && (
                  <Button size="sm" variant="outline" onClick={() => addRow('doc')}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Row
                  </Button>
                )}
              </div>
              <div className="rounded-md border overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">Document Type</TableHead>
                    <TableHead className="text-xs">From</TableHead>
                    <TableHead className="text-xs">To</TableHead>
                    <TableHead className="text-xs">Total Issued</TableHead>
                    <TableHead className="text-xs">Cancelled</TableHead>
                    {canEdit && !isFiled && <TableHead className="w-10" />}
                  </TableRow></TableHeader>
                  <TableBody>
                    {docRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="p-1">
                          {canEdit && !isFiled ? (
                            <Select value={row.doc_typ} onValueChange={(v) => updateDocRow(row.id, 'doc_typ', v)}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.value}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : <span className="text-xs">{row.doc_typ}</span>}
                        </TableCell>
                        {(['from', 'to'] as const).map((f) => (
                          <TableCell key={f} className="p-1">
                            {canEdit && !isFiled ? (
                              <Input value={row[f] ?? ''} onChange={(e) => updateDocRow(row.id, f, e.target.value)} className="h-8 text-xs w-28" />
                            ) : <span className="text-xs">{row[f]}</span>}
                          </TableCell>
                        ))}
                        {(['totnum', 'cancel'] as const).map((f) => (
                          <TableCell key={f} className="p-1">
                            {canEdit && !isFiled ? (
                              <Input type="number" value={row[f] ?? 0} onChange={(e) => updateDocRow(row.id, f, parseInt(e.target.value) || 0)} className="h-8 text-xs w-20" />
                            ) : <span className="text-xs tabular-nums">{row[f]}</span>}
                          </TableCell>
                        ))}
                        {canEdit && !isFiled && (
                          <TableCell className="p-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteRow('doc', row.id)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {docRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6 text-sm">No rows yet.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
};

export default Gstr1ManualEntryPanel;
