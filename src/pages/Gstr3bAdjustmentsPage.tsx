import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { FileSignature, Plus, Trash2, Loader2, Info, ClipboardEdit } from 'lucide-react';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Client { id: string; name: string; gstin: string; }

interface AdjustmentRow {
  id: string;
  client_id: string;
  period_month: string;
  table_ref: string;
  label: string;
  source: string;
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  reason: string;
  created_at: string;
  created_by: string | null;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inr = (n: number | undefined) =>
  (n || n === 0 ? Number(n) : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TABLE_REF_OPTIONS = [
  { value: '3.1(a)', label: '3.1(a) — Outward taxable supplies' },
  { value: '3.1(b)', label: '3.1(b) — Outward zero-rated supplies' },
  { value: '3.1(c)', label: '3.1(c) — Nil rated / exempt supplies' },
  { value: '3.1(d)', label: '3.1(d) — Inward supplies liable to RCM' },
  { value: '3.1(e)', label: '3.1(e) — Non-GST outward supplies' },
  { value: '4A(5)', label: '4A(5) — All other ITC' },
  { value: '4B(1)', label: '4B(1) — ITC reversed (Rule 38/42/43 & 17(5))' },
  { value: 'Other', label: 'Other' },
];

const SOURCE_OPTIONS = ['Manual', 'GSTR-1A', 'Prior Period'];

const emptyForm = {
  table_ref: '3.1(a)',
  label: '',
  source: 'Manual',
  taxable_value: '',
  igst: '',
  cgst: '',
  sgst: '',
  cess: '',
  reason: '',
};

const Gstr3bAdjustmentsPage: React.FC = () => {
  const { user } = useAuth();
  const isAllowed = user?.role === 'superadmin' || user?.role === 'gst_manager';

  const { selectedClientId: selectedClient, setSelectedClientId: setSelectedClient } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();

  const [clients, setClients] = useState<Client[]>([]);
  const [tab, setTab] = useState('adjustments');

  // ── Manual Adjustments ──────────────────────────────────────────────────
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  // ── GSTR-1A filing status ───────────────────────────────────────────────
  const [gstr1aFiled, setGstr1aFiled] = useState(false);
  const [gstr1aArn, setGstr1aArn] = useState('');
  const [gstr1aRemarks, setGstr1aRemarks] = useState('');
  const [gstr1aRecordId, setGstr1aRecordId] = useState<string | null>(null);
  const [isSavingGstr1a, setIsSavingGstr1a] = useState(false);

  useEffect(() => {
    supabase.from('clients').select('id, name, gstin').order('name').then(({ data }) => setClients((data || []) as Client[]));
  }, []);

  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const startDate = new Date(2024, 3, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 12, 1);
    let cur = new Date(startDate);
    while (cur <= endDate) {
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      months.push({ value: `${mm}/${cur.getFullYear()}`, label: `${MONTH_SHORT[cur.getMonth()]} ${cur.getFullYear()}` });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, []);

  const fetchRows = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setRows([]); return; }
    setIsLoading(true);
    const { data, error } = await supabase
      .from('gstr3b_adjustments')
      .select('*')
      .eq('client_id', selectedClient)
      .eq('period_month', selectedMonth)
      .order('created_at', { ascending: false });
    if (error) toast.error('Failed to load adjustments: ' + error.message);
    setRows((data as AdjustmentRow[]) || []);
    setIsLoading(false);
  }, [selectedClient, selectedMonth]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const fetchGstr1a = useCallback(async () => {
    if (!selectedClient || !selectedMonth) {
      setGstr1aFiled(false); setGstr1aArn(''); setGstr1aRemarks(''); setGstr1aRecordId(null);
      return;
    }
    const { data } = await supabase
      .from('filing_status')
      .select('id, status, arn, remarks')
      .eq('client_id', selectedClient)
      .eq('return_type', 'GSTR-1A')
      .eq('period_month', selectedMonth)
      .maybeSingle();
    const rec = data as { id: string; status: string | null; arn: string | null; remarks: string | null } | null;
    setGstr1aRecordId(rec?.id ?? null);
    setGstr1aFiled(rec?.status === 'Filed');
    setGstr1aArn(rec?.arn || '');
    setGstr1aRemarks(rec?.remarks || '');
  }, [selectedClient, selectedMonth]);

  useEffect(() => { fetchGstr1a(); }, [fetchGstr1a]);

  const selectedClientData = clients.find((c) => c.id === selectedClient);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    taxable: acc.taxable + (Number(r.taxable_value) || 0),
    igst: acc.igst + (Number(r.igst) || 0),
    cgst: acc.cgst + (Number(r.cgst) || 0),
    sgst: acc.sgst + (Number(r.sgst) || 0),
    cess: acc.cess + (Number(r.cess) || 0),
  }), { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }), [rows]);

  const openAddDialog = (source?: string) => {
    setForm({ ...emptyForm, source: source || 'Manual' });
    setDialogOpen(true);
  };

  const handleSaveAdjustment = async () => {
    if (!selectedClient || !selectedMonth) return;
    if (!form.label.trim()) { toast.error('Enter a description for this adjustment.'); return; }
    if (!form.reason.trim()) { toast.error('A reason is required — it goes into the audit trail.'); return; }
    setIsSaving(true);
    try {
      const { error } = await supabase.from('gstr3b_adjustments').insert({
        client_id: selectedClient,
        period_month: selectedMonth,
        table_ref: form.table_ref,
        label: form.label.trim(),
        source: form.source,
        taxable_value: parseFloat(form.taxable_value) || 0,
        igst: parseFloat(form.igst) || 0,
        cgst: parseFloat(form.cgst) || 0,
        sgst: parseFloat(form.sgst) || 0,
        cess: parseFloat(form.cess) || 0,
        reason: form.reason.trim(),
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success('Adjustment recorded.');
      setDialogOpen(false);
      await fetchRows();
    } catch (e: any) {
      toast.error('Could not save: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (row: AdjustmentRow) => {
    if (!window.confirm(`Remove this adjustment ("${row.label}")? This does not undo anything already pushed or filed.`)) return;
    const { error } = await supabase.from('gstr3b_adjustments').delete().eq('id', row.id);
    if (error) { toast.error('Could not delete: ' + error.message); return; }
    toast.success('Adjustment removed.');
    await fetchRows();
  };

  const handleSaveGstr1a = async () => {
    if (!selectedClient || !selectedMonth) return;
    setIsSavingGstr1a(true);
    try {
      const { error } = await supabase.from('filing_status').upsert(
        {
          id: gstr1aRecordId ?? undefined,
          client_id: selectedClient,
          return_type: 'GSTR-1A',
          period_month: selectedMonth,
          status: gstr1aFiled ? 'Filed' : 'Prepared',
          filed_date: gstr1aFiled ? new Date().toISOString().split('T')[0] : null,
          arn: gstr1aFiled ? (gstr1aArn.trim() || null) : null,
          remarks: gstr1aRemarks.trim() || null,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,return_type,period_month' },
      );
      if (error) throw error;
      toast.success('GSTR-1A status saved.');
      await fetchGstr1a();
    } catch (e: any) {
      toast.error('Could not save: ' + e.message);
    } finally {
      setIsSavingGstr1a(false);
    }
  };

  if (!isAllowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="GSTR-3B Adjustments"
        subtitle="GSTR-1A tracking and manual corrections that GSTR-1 / ITC Summary / RCM don't capture for this period"
        icon={<FileSignature className="h-6 w-6" />}
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Client:</span>
              <div className="w-56">
                <SearchableSelect
                  options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
                  value={selectedClient}
                  onValueChange={setSelectedClient}
                  placeholder="Select Client"
                  searchPlaceholder="Type to search clients..."
                  emptyText="No clients found."
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Month:</span>
              <div className="w-40">
                <SearchableMonthSelect
                  options={monthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select Month"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedClient || !selectedMonth ? (
        <Card>
          <CardContent className="p-4">
            <TableEmptyState
              icon={<FileSignature className="h-6 w-6" />}
              title="No client or month selected"
              description="Select a client and a return period above."
            />
          </CardContent>
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="adjustments">
              Manual Adjustments {rows.length > 0 && <Badge className="ml-2">{rows.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="gstr1a">GSTR-1A</TabsTrigger>
          </TabsList>

          {/* ── Manual Adjustments ─────────────────────────────────────── */}
          <TabsContent value="adjustments" className="mt-4 space-y-4">
            <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs">
                These rows are <strong>not</strong> pulled automatically into the GSTR-3B draft on the GSTR-3B
                page — that page is always computed live from GSTR-1, ITC Summary and RCM for this exact
                period. Use this list as the record of what still needs to be added by hand (e.g. a GSTR-1A
                amendment, or a prior period's output tax being trued up here) before the return is filed.
              </p>
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    {selectedClientData?.name} — {monthOptions.find((m) => m.value === selectedMonth)?.label}
                  </CardTitle>
                  <CardDescription>Adjustments recorded for this client and period</CardDescription>
                </div>
                <Button onClick={() => openAddDialog()}>
                  <Plus className="h-4 w-4 mr-2" /> Add Adjustment
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-4 py-6">No adjustments recorded for this period.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Table</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Taxable value</TableHead>
                        <TableHead className="text-right">IGST</TableHead>
                        <TableHead className="text-right">CGST</TableHead>
                        <TableHead className="text-right">SGST</TableHead>
                        <TableHead className="text-right">Cess</TableHead>
                        <TableHead className="w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-sm font-medium">{r.table_ref}</TableCell>
                          <TableCell className="text-sm">
                            <div>{r.label}</div>
                            <div className="text-xs text-muted-foreground">{r.reason}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{r.source}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{inr(r.taxable_value)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{inr(r.igst)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{inr(r.cgst)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{inr(r.sgst)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{inr(r.cess)}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDelete(r)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold bg-muted/40">
                        <TableCell colSpan={3}>Total</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(totals.taxable)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(totals.igst)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(totals.cgst)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(totals.sgst)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(totals.cess)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── GSTR-1A ────────────────────────────────────────────────── */}
          <TabsContent value="gstr1a" className="mt-4 space-y-4">
            <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs">
                GSTR-1A amends GSTR-1 for the <strong>same</strong> period, before GSTR-3B is filed — used
                correctly, it keeps GSTR-3B in sync rather than causing a mismatch. This tab is a manual
                record of whether one was filed for this period; it doesn't pull from the GST portal. If the
                amendment changed the output tax, log the delta as a Manual Adjustment (source "GSTR-1A")
                as well, so it's visible when preparing GSTR-3B.
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  GSTR-1A — {selectedClientData?.name} — {monthOptions.find((m) => m.value === selectedMonth)?.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="gstr1a-filed"
                    checked={gstr1aFiled}
                    onCheckedChange={(v) => setGstr1aFiled(!!v)}
                  />
                  <label htmlFor="gstr1a-filed" className="text-sm font-medium cursor-pointer select-none">
                    GSTR-1A filed for this period
                  </label>
                </div>
                {gstr1aFiled && (
                  <div className="max-w-xs space-y-2">
                    <Label htmlFor="gstr1a-arn">ARN</Label>
                    <Input id="gstr1a-arn" value={gstr1aArn} onChange={(e) => setGstr1aArn(e.target.value)} placeholder="AA...." />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="gstr1a-remarks">Remarks</Label>
                  <Textarea
                    id="gstr1a-remarks"
                    value={gstr1aRemarks}
                    onChange={(e) => setGstr1aRemarks(e.target.value)}
                    placeholder="What was amended and why"
                    rows={3}
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveGstr1a} disabled={isSavingGstr1a}>
                    {isSavingGstr1a ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Save
                  </Button>
                  {gstr1aFiled && (
                    <Button variant="outline" onClick={() => { setTab('adjustments'); openAddDialog('GSTR-1A'); }}>
                      <ClipboardEdit className="h-4 w-4 mr-2" /> Add adjustment for this GSTR-1A
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Adjustment</DialogTitle>
            <DialogDescription>
              {selectedClientData?.name} — {monthOptions.find((m) => m.value === selectedMonth)?.label}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Table line</Label>
                <Select value={form.table_ref} onValueChange={(v) => setForm((f) => ({ ...f, table_ref: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TABLE_REF_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Source</Label>
                <Select value={form.source} onValueChange={(v) => setForm((f) => ({ ...f, source: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Omitted B2B invoice trued up this month" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Taxable value</Label>
                <Input type="number" value={form.taxable_value} onChange={(e) => setForm((f) => ({ ...f, taxable_value: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>IGST</Label>
                <Input type="number" value={form.igst} onChange={(e) => setForm((f) => ({ ...f, igst: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Cess</Label>
                <Input type="number" value={form.cess} onChange={(e) => setForm((f) => ({ ...f, cess: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>CGST</Label>
                <Input type="number" value={form.cgst} onChange={(e) => setForm((f) => ({ ...f, cgst: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>SGST</Label>
                <Input type="number" value={form.sgst} onChange={(e) => setForm((f) => ({ ...f, sgst: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason (required — goes into the audit trail)</Label>
              <Textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveAdjustment} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Gstr3bAdjustmentsPage;
