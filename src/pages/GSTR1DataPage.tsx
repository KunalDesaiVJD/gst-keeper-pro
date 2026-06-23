import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileJson, Loader2, Trash2 } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Client {
  id: string;
  name: string;
  gstin: string;
}

interface GSTR1Record {
  id: string;
  client_id: string;
  period_month: string;
  raw_json: any;
  file_name: string | null;
  imported_at: string;
}

// GSTR-1 JSON section types
interface B2BInvoice {
  ctin: string;
  inv: Array<{
    inum: string;
    idt: string;
    val: number;
    pos: string;
    rchrg: string;
    inv_typ: string;
    itms: Array<{
      num: number;
      itm_det: {
        rt: number;
        txval: number;
        iamt?: number;
        camt?: number;
        samt?: number;
        csamt?: number;
      };
    }>;
  }>;
}

const GSTR1DataPage: React.FC = () => {
  const { user, isStaffRole } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [gstr1Data, setGstr1Data] = useState<GSTR1Record | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [activeTab, setActiveTab] = useState('b2b');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isStaff = isStaffRole();

  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const startDate = new Date(2024, 3, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 12, 1);
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const yearShort = String(currentDate.getFullYear()).slice(-2);
      const value = `${monthNames[currentDate.getMonth()]}-${yearShort}`;
      months.push({ value, label: value });
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    return months.sort((a, b) => {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const parseDate = (s: string) => { const [m, y] = s.split('-'); return (2000 + parseInt(y)) * 12 + monthNames.indexOf(m); };
      return parseDate(b.value) - parseDate(a.value);
    });
  }, []);

  const fetchClients = useCallback(async () => {
    const { data } = await supabase.from('clients').select('id, name, gstin').order('name');
    setClients(data || []);
  }, []);

  const fetchGSTR1Data = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setGstr1Data(null); return; }
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('gstr1_data')
        .select('*')
        .eq('client_id', selectedClient)
        .eq('period_month', selectedMonth)
        .maybeSingle();
      if (error) throw error;
      setGstr1Data(data as GSTR1Record | null);
    } catch (err: any) {
      toast.error('Failed to fetch data: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClient, selectedMonth]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchGSTR1Data(); }, [fetchGSTR1Data]);

  // Opens the persistent hidden <input type="file"> below. Using a stable ref
  // (instead of a dynamically-created input with an onchange closure) means
  // handleFileChange always reads the LATEST selectedClient / selectedMonth
  // when the user picks a file, even if they tweaked the dropdowns between
  // clicking Import JSON and picking the file in the OS file dialog.
  const handleImportClick = () => {
    if (!selectedClient || !selectedMonth) {
      toast.error('Please select a client and month first');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    if (!selectedClient || !selectedMonth) {
      toast.error('Please select a client and month first');
      return;
    }

    setIsImporting(true);
    try {
      const text = await file.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('Selected file is not valid JSON.');
      }

      const { data: written, error } = await supabase
        .from('gstr1_data')
        .upsert({
          client_id: selectedClient,
          period_month: selectedMonth,
          raw_json: json,
          file_name: file.name,
          imported_by: user?.id,
          imported_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id,period_month' })
        .select('id');

      if (error) throw error;
      // .select() after .upsert() returns the affected row. If RLS or a
      // constraint silently dropped the write, the array will be empty and
      // we surface that instead of pretending the import succeeded.
      if (!written || written.length === 0) {
        throw new Error('Write was rejected by the database (no row returned). Check that you are signed in.');
      }

      toast.success(`GSTR-1 JSON imported for ${selectedClient ? selectedMonth : ''}.`);
      await fetchGSTR1Data();
    } catch (err: any) {
      toast.error('Failed to import: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!gstr1Data) return;
    if (!confirm('Are you sure you want to delete this GSTR-1 data?')) return;
    try {
      await supabase.from('gstr1_data').delete().eq('id', gstr1Data.id);
      toast.success('GSTR-1 data deleted');
      setGstr1Data(null);
    } catch (err: any) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  const json = gstr1Data?.raw_json || {};

  const formatNumber = (num: number | undefined | null) => {
    if (!num && num !== 0) return '';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  // Flatten B2B data
  const b2bRows = useMemo(() => {
    const rows: any[] = [];
    (json.b2b || []).forEach((party: any) => {
      (party.inv || []).forEach((inv: any) => {
        (inv.itms || []).forEach((itm: any) => {
          rows.push({
            ctin: party.ctin,
            inum: inv.inum,
            idt: inv.idt,
            val: inv.val,
            pos: inv.pos,
            rchrg: inv.rchrg,
            inv_typ: inv.inv_typ,
            rt: itm.itm_det?.rt,
            txval: itm.itm_det?.txval,
            iamt: itm.itm_det?.iamt,
            camt: itm.itm_det?.camt,
            samt: itm.itm_det?.samt,
            csamt: itm.itm_det?.csamt,
          });
        });
      });
    });
    return rows;
  }, [json.b2b]);

  // Flatten B2CL data
  const b2clRows = useMemo(() => {
    const rows: any[] = [];
    (json.b2cl || []).forEach((state: any) => {
      (state.inv || []).forEach((inv: any) => {
        (inv.itms || []).forEach((itm: any) => {
          rows.push({
            pos: state.pos,
            inum: inv.inum,
            idt: inv.idt,
            val: inv.val,
            rt: itm.itm_det?.rt,
            txval: itm.itm_det?.txval,
            iamt: itm.itm_det?.iamt,
            csamt: itm.itm_det?.csamt,
          });
        });
      });
    });
    return rows;
  }, [json.b2cl]);

  // B2CS data
  const b2csRows = useMemo(() => {
    return (json.b2cs || []).map((item: any) => ({
      pos: item.pos,
      typ: item.typ,
      rt: item.rt,
      txval: item.txval,
      iamt: item.iamt,
      camt: item.camt,
      samt: item.samt,
      csamt: item.csamt,
    }));
  }, [json.b2cs]);

  // CDNR data
  const cdnrRows = useMemo(() => {
    const rows: any[] = [];
    (json.cdnr || []).forEach((party: any) => {
      (party.nt || []).forEach((nt: any) => {
        (nt.itms || []).forEach((itm: any) => {
          rows.push({
            ctin: party.ctin,
            ntNum: nt.nt_num,
            ntDt: nt.nt_dt,
            ntTyp: nt.typ,
            val: nt.val,
            pos: nt.pos,
            rt: itm.itm_det?.rt,
            txval: itm.itm_det?.txval,
            iamt: itm.itm_det?.iamt,
            camt: itm.itm_det?.camt,
            samt: itm.itm_det?.samt,
            csamt: itm.itm_det?.csamt,
          });
        });
      });
    });
    return rows;
  }, [json.cdnr]);

  // CDNUR data
  const cdnurRows = useMemo(() => {
    const rows: any[] = [];
    (json.cdnur || []).forEach((nt: any) => {
      (nt.itms || []).forEach((itm: any) => {
        rows.push({
          ntNum: nt.nt_num,
          ntDt: nt.nt_dt,
          ntTyp: nt.typ,
          val: nt.val,
          pos: nt.pos,
          rt: itm.itm_det?.rt,
          txval: itm.itm_det?.txval,
          iamt: itm.itm_det?.iamt,
          csamt: itm.itm_det?.csamt,
        });
      });
    });
    return rows;
  }, [json.cdnur]);

  // EXP data
  const expRows = useMemo(() => {
    const rows: any[] = [];
    (json.exp || []).forEach((exp: any) => {
      (exp.inv || []).forEach((inv: any) => {
        (inv.itms || []).forEach((itm: any) => {
          rows.push({
            expTyp: exp.exp_typ,
            inum: inv.inum,
            idt: inv.idt,
            val: inv.val,
            sbpcode: inv.sbpcode,
            sbnum: inv.sbnum,
            sbdt: inv.sbdt,
            rt: itm.rt,
            txval: itm.txval,
            iamt: itm.iamt,
            csamt: itm.csamt,
          });
        });
      });
    });
    return rows;
  }, [json.exp]);

  // HSN data
  const hsnRows = useMemo(() => {
    return (json.hsn?.data || []).map((item: any) => ({
      hsn_sc: item.hsn_sc,
      desc: item.desc,
      uqc: item.uqc,
      qty: item.qty,
      rt: item.rt,
      txval: item.txval,
      iamt: item.iamt,
      camt: item.camt,
      samt: item.samt,
      csamt: item.csamt,
    }));
  }, [json.hsn]);

  // NIL data
  const nilData = useMemo(() => {
    return json.nil || {};
  }, [json.nil]);

  // AT (Advances) data
  const atRows = useMemo(() => {
    return (json.at || []).map((item: any) => ({
      pos: item.pos,
      sply_ty: item.sply_ty,
      rt: item.itms?.[0]?.rt || item.rt,
      ad_amt: item.itms?.[0]?.ad_amt || item.ad_amt,
      iamt: item.itms?.[0]?.iamt || item.iamt,
      camt: item.itms?.[0]?.camt || item.camt,
      samt: item.itms?.[0]?.samt || item.samt,
      csamt: item.itms?.[0]?.csamt || item.csamt,
    }));
  }, [json.at]);

  // TXPD (Advance Adjustments) data
  const txpdRows = useMemo(() => {
    return (json.txpd || []).map((item: any) => ({
      pos: item.pos,
      sply_ty: item.sply_ty,
      rt: item.itms?.[0]?.rt || item.rt,
      ad_amt: item.itms?.[0]?.ad_amt || item.ad_amt,
      iamt: item.itms?.[0]?.iamt || item.iamt,
      camt: item.itms?.[0]?.camt || item.camt,
      samt: item.itms?.[0]?.samt || item.samt,
      csamt: item.itms?.[0]?.csamt || item.csamt,
    }));
  }, [json.txpd]);

  // DOC data
  const docRows = useMemo(() => {
    const rows: any[] = [];
    (json.doc_issue?.doc_det || []).forEach((doc: any) => {
      (doc.docs || []).forEach((d: any) => {
        rows.push({
          doc_num: doc.doc_num,
          doc_typ: doc.doc_typ,
          from: d.from,
          to: d.to,
          totnum: d.totnum,
          cancel: d.cancel,
          net_issue: d.net_issue,
        });
      });
    });
    return rows;
  }, [json.doc_issue]);

  const renderEmptyState = (label: string) => (
    <div className="text-center py-8 text-muted-foreground">
      No {label} data found in this GSTR-1 file
    </div>
  );

  const selectedClientName = clients.find(c => c.id === selectedClient)?.name || '';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <FileJson className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">GSTR-01</h1>
            <p className="text-muted-foreground">Import and view GSTR-01 JSON data client-wise & month-wise</p>
          </div>
        </div>
        {isStaff && (
          <div className="flex items-center gap-2">
            <Button onClick={handleImportClick} disabled={isImporting || !selectedClient || !selectedMonth}>
              {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Import JSON
            </Button>
            {gstr1Data && (
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </Button>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Client:</span>
              <div className="w-56">
                <SearchableSelect
                  options={clients.map(c => ({ value: c.id, label: c.name }))}
                  value={selectedClient}
                  onValueChange={setSelectedClient}
                  placeholder="Select Client"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Month:</span>
              <div className="w-32">
                <SearchableMonthSelect
                  options={monthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select Month"
                />
              </div>
            </div>
            {gstr1Data && (
              <div className="text-xs text-muted-foreground ml-auto">
                File: <span className="font-medium">{gstr1Data.file_name}</span> • Imported: {new Date(gstr1Data.imported_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Data Display */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !selectedClient || !selectedMonth ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Select a client and month to view GSTR-1 data
          </CardContent>
        </Card>
      ) : !gstr1Data ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No GSTR-1 data imported for <span className="font-semibold">{selectedClientName}</span> - <span className="font-semibold">{selectedMonth}</span>.
            {isStaff && ' Click "Import JSON" to upload.'}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
                <TabsTrigger value="b2b">B2B ({b2bRows.length})</TabsTrigger>
                <TabsTrigger value="b2cl">B2CL ({b2clRows.length})</TabsTrigger>
                <TabsTrigger value="b2cs">B2CS ({b2csRows.length})</TabsTrigger>
                <TabsTrigger value="cdnr">CDNR ({cdnrRows.length})</TabsTrigger>
                <TabsTrigger value="cdnur">CDNUR ({cdnurRows.length})</TabsTrigger>
                <TabsTrigger value="exp">EXP ({expRows.length})</TabsTrigger>
                <TabsTrigger value="hsn">HSN ({hsnRows.length})</TabsTrigger>
                <TabsTrigger value="nil">NIL</TabsTrigger>
                <TabsTrigger value="at">AT ({atRows.length})</TabsTrigger>
                <TabsTrigger value="txpd">TXPD ({txpdRows.length})</TabsTrigger>
                <TabsTrigger value="doc">DOC ({docRows.length})</TabsTrigger>
              </TabsList>

              {/* B2B Tab */}
              <TabsContent value="b2b">
                {b2bRows.length === 0 ? renderEmptyState('B2B') : (
                  <ScrollArea className="w-full">
                    <div className="min-w-[1200px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                            <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">GSTIN</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Invoice No.</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Date</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Value</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">POS</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Rev. Chrg</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Type</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Rate</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Taxable Value</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">IGST</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">CGST</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">SGST</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Cess</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {b2bRows.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="border border-border text-center">{i + 1}</TableCell>
                              <TableCell className="border border-border font-mono text-xs">{row.ctin}</TableCell>
                              <TableCell className="border border-border">{row.inum}</TableCell>
                              <TableCell className="border border-border">{row.idt}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.val)}</TableCell>
                              <TableCell className="border border-border">{row.pos}</TableCell>
                              <TableCell className="border border-border">{row.rchrg}</TableCell>
                              <TableCell className="border border-border">{row.inv_typ}</TableCell>
                              <TableCell className="border border-border text-right">{row.rt}%</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.txval)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.iamt)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.camt)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.samt)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.csamt)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                )}
              </TabsContent>

              {/* B2CL Tab */}
              <TabsContent value="b2cl">
                {b2clRows.length === 0 ? renderEmptyState('B2CL') : (
                  <ScrollArea className="w-full">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                          <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B]">POS</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B]">Invoice No.</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B]">Date</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Value</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Rate</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Taxable Value</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">IGST</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {b2clRows.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border">{row.pos}</TableCell>
                            <TableCell className="border border-border">{row.inum}</TableCell>
                            <TableCell className="border border-border">{row.idt}</TableCell>
                            <TableCell className="border border-border text-right">{formatNumber(row.val)}</TableCell>
                            <TableCell className="border border-border text-right">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right">{formatNumber(row.txval)}</TableCell>
                            <TableCell className="border border-border text-right">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                )}
              </TabsContent>

              {/* B2CS Tab */}
              <TabsContent value="b2cs">
                {b2csRows.length === 0 ? renderEmptyState('B2CS') : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                        <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">POS</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">Type</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Rate</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Taxable Value</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">IGST</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">CGST</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">SGST</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Cess</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {b2csRows.map((row: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="border border-border text-center">{i + 1}</TableCell>
                          <TableCell className="border border-border">{row.pos}</TableCell>
                          <TableCell className="border border-border">{row.typ}</TableCell>
                          <TableCell className="border border-border text-right">{row.rt}%</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.txval)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.iamt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.camt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.samt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.csamt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              {/* CDNR Tab */}
              <TabsContent value="cdnr">
                {cdnrRows.length === 0 ? renderEmptyState('CDNR') : (
                  <ScrollArea className="w-full">
                    <div className="min-w-[1200px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                            <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">GSTIN</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Note No.</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Date</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Type</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Value</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Rate</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Taxable Value</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">IGST</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">CGST</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">SGST</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Cess</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cdnrRows.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="border border-border text-center">{i + 1}</TableCell>
                              <TableCell className="border border-border font-mono text-xs">{row.ctin}</TableCell>
                              <TableCell className="border border-border">{row.ntNum}</TableCell>
                              <TableCell className="border border-border">{row.ntDt}</TableCell>
                              <TableCell className="border border-border">{row.ntTyp}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.val)}</TableCell>
                              <TableCell className="border border-border text-right">{row.rt}%</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.txval)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.iamt)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.camt)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.samt)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.csamt)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                )}
              </TabsContent>

              {/* CDNUR Tab */}
              <TabsContent value="cdnur">
                {cdnurRows.length === 0 ? renderEmptyState('CDNUR') : (
                  <ScrollArea className="w-full">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                          <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B]">Note No.</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B]">Date</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B]">Type</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Value</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B]">POS</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Rate</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Taxable Value</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">IGST</TableHead>
                          <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cdnurRows.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border">{row.ntNum}</TableCell>
                            <TableCell className="border border-border">{row.ntDt}</TableCell>
                            <TableCell className="border border-border">{row.ntTyp}</TableCell>
                            <TableCell className="border border-border text-right">{formatNumber(row.val)}</TableCell>
                            <TableCell className="border border-border">{row.pos}</TableCell>
                            <TableCell className="border border-border text-right">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right">{formatNumber(row.txval)}</TableCell>
                            <TableCell className="border border-border text-right">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                )}
              </TabsContent>

              {/* EXP Tab */}
              <TabsContent value="exp">
                {expRows.length === 0 ? renderEmptyState('Export') : (
                  <ScrollArea className="w-full">
                    <div className="min-w-[1100px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                            <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Export Type</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Invoice No.</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Date</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Value</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Port Code</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">SB No.</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">SB Date</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Rate</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Taxable Value</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">IGST</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Cess</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {expRows.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="border border-border text-center">{i + 1}</TableCell>
                              <TableCell className="border border-border">{row.expTyp}</TableCell>
                              <TableCell className="border border-border">{row.inum}</TableCell>
                              <TableCell className="border border-border">{row.idt}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.val)}</TableCell>
                              <TableCell className="border border-border">{row.sbpcode}</TableCell>
                              <TableCell className="border border-border">{row.sbnum}</TableCell>
                              <TableCell className="border border-border">{row.sbdt}</TableCell>
                              <TableCell className="border border-border text-right">{row.rt}%</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.txval)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.iamt)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.csamt)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                )}
              </TabsContent>

              {/* HSN Tab */}
              <TabsContent value="hsn">
                {hsnRows.length === 0 ? renderEmptyState('HSN') : (
                  <ScrollArea className="w-full">
                    <div className="min-w-[1000px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                            <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">HSN Code</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">Description</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B]">UQC</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Qty</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Rate</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Taxable Value</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">IGST</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">CGST</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">SGST</TableHead>
                            <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Cess</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {hsnRows.map((row: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="border border-border text-center">{i + 1}</TableCell>
                              <TableCell className="border border-border font-mono">{row.hsn_sc}</TableCell>
                              <TableCell className="border border-border">{row.desc}</TableCell>
                              <TableCell className="border border-border">{row.uqc}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.qty)}</TableCell>
                              <TableCell className="border border-border text-right">{row.rt}%</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.txval)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.iamt)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.camt)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.samt)}</TableCell>
                              <TableCell className="border border-border text-right">{formatNumber(row.csamt)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                )}
              </TabsContent>

              {/* NIL Tab */}
              <TabsContent value="nil">
                {!nilData.inv ? renderEmptyState('Nil Rated') : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">Description</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Nil Rated</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Exempted</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Non-GST</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(nilData.inv || []).map((item: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="border border-border">{item.sply_ty === 'INTRB2B' ? 'Inter-State B2B' : item.sply_ty === 'INTRAB2B' ? 'Intra-State B2B' : item.sply_ty === 'INTRB2C' ? 'Inter-State B2C' : item.sply_ty === 'INTRAB2C' ? 'Intra-State B2C' : item.sply_ty}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(item.nil_amt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(item.expt_amt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(item.ngsup_amt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              {/* AT Tab */}
              <TabsContent value="at">
                {atRows.length === 0 ? renderEmptyState('Advance Tax') : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                        <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">POS</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">Supply Type</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Rate</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Advance Amount</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">IGST</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">CGST</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">SGST</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Cess</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {atRows.map((row: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="border border-border text-center">{i + 1}</TableCell>
                          <TableCell className="border border-border">{row.pos}</TableCell>
                          <TableCell className="border border-border">{row.sply_ty}</TableCell>
                          <TableCell className="border border-border text-right">{row.rt}%</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.ad_amt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.iamt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.camt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.samt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.csamt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              {/* TXPD Tab */}
              <TabsContent value="txpd">
                {txpdRows.length === 0 ? renderEmptyState('Advance Adjustment') : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                        <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">POS</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">Supply Type</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Rate</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Advance Amount</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">IGST</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">CGST</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">SGST</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Cess</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txpdRows.map((row: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="border border-border text-center">{i + 1}</TableCell>
                          <TableCell className="border border-border">{row.pos}</TableCell>
                          <TableCell className="border border-border">{row.sply_ty}</TableCell>
                          <TableCell className="border border-border text-right">{row.rt}%</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.ad_amt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.iamt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.camt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.samt)}</TableCell>
                          <TableCell className="border border-border text-right">{formatNumber(row.csamt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              {/* DOC Tab */}
              <TabsContent value="doc">
                {docRows.length === 0 ? renderEmptyState('Document Issued') : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                        <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">Doc Type</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">Sr. No.</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">From</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B]">To</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Total</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Cancelled</TableHead>
                        <TableHead className="font-bold text-white border border-[#2E5A6B] text-right">Net Issued</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {docRows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="border border-border text-center">{i + 1}</TableCell>
                          <TableCell className="border border-border">{row.doc_typ}</TableCell>
                          <TableCell className="border border-border">{row.doc_num}</TableCell>
                          <TableCell className="border border-border">{row.from}</TableCell>
                          <TableCell className="border border-border">{row.to}</TableCell>
                          <TableCell className="border border-border text-right">{row.totnum}</TableCell>
                          <TableCell className="border border-border text-right">{row.cancel}</TableCell>
                          <TableCell className="border border-border text-right">{row.net_issue}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default GSTR1DataPage;
