// CompanyListPage — the destination behind the Notices Dashboard's "Company"
// button, matching Notice Alert's own "View Company List" page: Active/
// Inactive + Status filters, a Search box, a Total Downloaded/Pending
// summary, bulk actions (Delete/Sync Log/Bulk Update/Import/Fetch Company/
// Sync) over checkbox-selected rows, and a table with GSTIN, Trade Name,
// User Name, Last Download Date, Status, Status Message, Action.
//
// "Last Download Date / Status / Status Message" are new to this app — see
// supabase/migrations/20260828100000_client_sync_log.sql. They're populated
// by the extension's existing "Sync All" (Notices) flow only (content.js's
// logSyncAttempt, gated on job.logSync) — no other extension job writes to
// this table, so nothing else about the extension changed.
//
// "Total Downloaded / Total Pending" is an adapted metric, not a literal port:
// Notice Alert's own version reflects a live in-progress sync batch (their
// backend crawls unattended). This extension's Sync All is semi-manual — a
// human still solves each client's CAPTCHA — so there's no live per-run
// counter to mirror faithfully. Downloaded = clients whose most recent
// attempt succeeded; Pending = credentialed clients that have never
// succeeded yet (never attempted, or last attempt failed).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import BulkAddClientsDialog from '@/components/clients/BulkAddClientsDialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import NoticesPageHeader from '@/components/notices/NoticesPageHeader';
import NoticesCardHeader from '@/components/notices/NoticesCardHeader';
import FilterPill from '@/components/notices/FilterPill';
import {
  Building2, ChevronLeft, ChevronRight, Loader2, Search, Trash2, History,
  RefreshCw, Upload, DownloadCloud, Pencil, CheckCircle2, XCircle,
} from 'lucide-react';

interface ClientRow {
  id: string;
  name: string;
  gstin: string;
  gst_user_id: string | null;
  inactive_at_hand: boolean | null;
}

interface SyncLogRow {
  id: string;
  client_id: string;
  action: string;
  status: 'success' | 'failed';
  message: string | null;
  created_at: string;
}

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

const CompanyListPage: React.FC = () => {
  const { isStaffRole, canAddEditClients, canDeleteClients } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Pre-selects Status from the Notices Dashboard's "Failed Logins" tile
  // (?status=failed) — read once on mount, same one-way-in convention as
  // every other dashboard-tile drill-down link in this app.
  const [searchParams] = useSearchParams();
  const initialStatusParam = searchParams.get('status');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'never'>(
    initialStatusParam === 'failed' || initialStatusParam === 'success' || initialStatusParam === 'never' ? initialStatusParam : 'all',
  );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [bulkActiveValue, setBulkActiveValue] = useState<'active' | 'inactive'>('active');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [syncLogOpen, setSyncLogOpen] = useState(false);

  const [extReady, setExtReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [fetching, setFetching] = useState(false);
  // Sync and Fetch Company now share the same underlying extension message
  // (__gstkPullSectionAllClients, scoped via clientIds) since both are
  // selection-scoped in the same way — this ref tracks which one is
  // in-flight so the single result handler below clears the right loading
  // state and shows the right toast. A ref (not state) avoids the stale-
  // closure trap: the message listener effect below only runs once on
  // mount, so a captured `syncing`/`fetching` state value would always read
  // its initial false.
  const pendingActionRef = useRef<'sync' | 'fetch' | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [clientsRes, logsRes] = await Promise.all([
      // This page is entirely scoped to Notices Dashboard work (Sync/Fetch
      // Company, Total Downloaded/Pending, etc.) — a client opted out via
      // "Exclude from Notices Dashboard sync" shouldn't appear here at all,
      // not just be unselectable. The general client registry (/clients)
      // is untouched, so nothing about managing that client is lost.
      supabase.from('clients').select('id, name, gstin, gst_user_id, inactive_at_hand').eq('notices_sync_excluded', false).order('name'),
      supabase.from('client_sync_log').select('id, client_id, action, status, message, created_at').order('created_at', { ascending: false }),
    ]);
    setClients((clientsRes.data || []) as ClientRow[]);
    setSyncLogs((logsRes.data || []) as SyncLogRow[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // Extension handshake — same ping/pong pattern used on the Notices Dashboard.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkPullSectionAllClientsResult) {
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        if (action === 'fetch') setFetching(false); else setSyncing(false);
        const verb = action === 'fetch' ? 'Fetch Company' : 'Sync';
        if (d.__gstkPullSectionAllClientsResult.ok) {
          toast.success(`${verb} started for ${d.__gstkPullSectionAllClientsResult.count} compan${d.__gstkPullSectionAllClientsResult.count === 1 ? 'y' : 'ies'}. Complete the CAPTCHA for each as it comes up.`);
        } else {
          toast.error(d.__gstkPullSectionAllClientsResult.error || `${verb} failed to start.`);
        }
      }
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    return () => { window.removeEventListener('message', onMsg); clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  // Latest sync-log row per client (logs are already ordered newest-first).
  const latestLogByClient = useMemo(() => {
    const m = new Map<string, SyncLogRow>();
    for (const l of syncLogs) if (!m.has(l.client_id)) m.set(l.client_id, l);
    return m;
  }, [syncLogs]);

  const filtered = useMemo(() => {
    let list = clients;
    if (activeFilter === 'active') list = list.filter((c) => !c.inactive_at_hand);
    if (activeFilter === 'inactive') list = list.filter((c) => !!c.inactive_at_hand);
    if (statusFilter !== 'all') {
      list = list.filter((c) => {
        const log = latestLogByClient.get(c.id);
        if (statusFilter === 'never') return !log;
        return log?.status === statusFilter;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.gstin.toLowerCase().includes(q) || (c.gst_user_id || '').toLowerCase().includes(q));
    return list;
  }, [clients, activeFilter, statusFilter, search, latestLogByClient]);

  useEffect(() => { setPage(0); }, [activeFilter, statusFilter, search, rowsPerPage]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const pageRows = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const totalDownloaded = clients.filter((c) => latestLogByClient.get(c.id)?.status === 'success').length;
  const totalPending = clients.filter((c) => c.gst_user_id && latestLogByClient.get(c.id)?.status !== 'success').length;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      pageRows.forEach((c) => { if (checked) next.add(c.id); else next.delete(c.id); });
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) { toast.error('Select at least one company first.'); return; }
    if (!(await confirm({ title: `Delete ${selected.size} compan${selected.size === 1 ? 'y' : 'ies'}?`, description: 'This permanently deletes each selected company and all of its data.', destructive: true, confirmText: 'Delete' }))) return;
    const { error } = await supabase.from('clients').delete().in('id', Array.from(selected));
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Deleted.');
    setSelected(new Set());
    fetchAll();
  };

  const handleDeleteOne = async (id: string, name: string) => {
    if (!(await confirm({ title: 'Delete company?', description: `This permanently deletes "${name}" and all of its data.`, destructive: true, confirmText: 'Delete' }))) return;
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Deleted.');
    fetchAll();
  };

  const applyBulkUpdate = async () => {
    if (selected.size === 0) return;
    setBulkSaving(true);
    const { error } = await supabase.from('clients').update({ inactive_at_hand: bulkActiveValue === 'inactive' }).in('id', Array.from(selected));
    setBulkSaving(false);
    if (error) { toast.error('Bulk update failed: ' + error.message); return; }
    toast.success(`${selected.size} compan${selected.size === 1 ? 'y' : 'ies'} updated.`);
    setBulkUpdateOpen(false);
    setSelected(new Set());
    fetchAll();
  };

  // Both selection-scoped, matching Notice Alert's own Company List buttons
  // exactly (confirmed live 2026-08-26): neither runs against every company
  // — each requires checking rows first and only acts on those. That's
  // distinct from the Notices Dashboard's separate "Sync All" button, which
  // intentionally still covers every credentialed client with no selection.
  const handleSync = () => {
    if (selected.size === 0) { toast.error('Select at least one company first.'); return; }
    if (!extReady) { toast.error('GST Keeper browser extension not detected. Install/enable it to sync.'); return; }
    // Clients with "Exclude from Notices Dashboard sync" set (Edit Client)
    // never load onto this page at all (see fetchAll's query), so `selected`
    // can't contain one — no filtering needed here.
    const clientIds = Array.from(selected);
    pendingActionRef.current = 'sync';
    setSyncing(true);
    // 'notices_bundle': same mode the Notices Dashboard's own "Sync All" now
    // uses — pulls Notices & Orders, then chains through Refunds and DRC-03
    // for each selected client before moving to the next, instead of
    // stopping after Notices alone (see chainOrStop in content.js).
    window.postMessage({ __gstkPullSectionAllClients: { mode: 'notices_bundle', clientIds } }, '*');
  };

  const handleFetchCompany = () => {
    if (selected.size === 0) { toast.error('Select at least one company first.'); return; }
    if (!extReady) { toast.error('GST Keeper browser extension not detected.'); return; }
    pendingActionRef.current = 'fetch';
    setFetching(true);
    window.postMessage({ __gstkPullSectionAllClients: { mode: 'taxpayerprofile', clientIds: Array.from(selected) } }, '*');
  };

  const selectedLogs = selected.size > 0 ? syncLogs.filter((l) => selected.has(l.client_id)) : syncLogs.slice(0, 50);
  const clientNameById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  return (
    <div className="space-y-4 animate-fade-in">
      <NoticesPageHeader
        title="Company List"
        icon={Building2}
        subtitle={
          <>
            <span>Total Downloaded: <span className="font-semibold text-foreground tabular-nums">{totalDownloaded}</span></span>
            <span>Total Pending: <span className="font-semibold text-foreground tabular-nums">{totalPending}</span></span>
          </>
        }
        actions={
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={fetchAll} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <NoticesTopNav />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill
            label="Active/InActive"
            allLabel="All"
            value={activeFilter}
            onChange={(v) => setActiveFilter(v as typeof activeFilter)}
            options={[]}
            extraOptions={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
          <FilterPill
            label="Status"
            allLabel="All"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[]}
            extraOptions={[
              { value: 'success', label: 'Success' },
              { value: 'failed', label: 'Failed' },
              { value: 'never', label: 'Never synced' },
            ]}
          />
        </div>
      </div>

      <Card>
        <NoticesCardHeader title="Companies" badge={filtered.length} />
        <CardContent className="pt-3 pb-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative w-[240px]">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, GSTIN, or User ID" className="h-7 pl-8 text-[11px]" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {canDeleteClients() && (
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleDeleteSelected}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete Company
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSyncLogOpen(true)}>
                <History className="mr-1.5 h-3.5 w-3.5" /> Sync Log
              </Button>
              {canAddEditClients() && (
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setBulkUpdateOpen(true)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Bulk Update
                </Button>
              )}
              {canAddEditClients() && <BulkAddClientsDialog triggerLabel="Import" triggerClassName="h-7 text-[11px]" onSuccess={fetchAll} />}
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleFetchCompany} disabled={fetching}>
                {fetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="mr-1.5 h-3.5 w-3.5" />}
                Fetch Company
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleSync} disabled={syncing}>
                {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                Sync
              </Button>
            </div>
          </div>

          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 bg-muted px-2 py-1.5">
                    <Checkbox
                      checked={pageRows.length > 0 && pageRows.every((c) => selected.has(c.id))}
                      onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
                    />
                  </TableHead>
                  <TableHead className="bg-muted px-2 py-1.5 text-[10px] font-semibold uppercase">GSTIN</TableHead>
                  <TableHead className="bg-muted px-2 py-1.5 text-[10px] font-semibold uppercase">Trade Name</TableHead>
                  <TableHead className="bg-muted px-2 py-1.5 text-[10px] font-semibold uppercase">User Name</TableHead>
                  <TableHead className="bg-muted px-2 py-1.5 text-[10px] font-semibold uppercase">Last Download Date</TableHead>
                  <TableHead className="bg-muted px-2 py-1.5 text-center text-[10px] font-semibold uppercase">Status</TableHead>
                  <TableHead className="bg-muted px-2 py-1.5 text-[10px] font-semibold uppercase">Status Message</TableHead>
                  <TableHead className="bg-muted px-2 py-1.5 text-[10px] font-semibold uppercase">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
                ) : pageRows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">No companies match these filters.</TableCell></TableRow>
                ) : (
                  pageRows.map((c) => {
                    const log = latestLogByClient.get(c.id);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="px-2 py-1"><Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} /></TableCell>
                        <TableCell className="px-2 py-1">
                          <Link to={`/notices-company/${c.id}`} className="font-mono text-[10px] text-primary hover:underline">{c.gstin}</Link>
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate px-2 py-1 text-[11px]" title={c.name}>{c.name}</TableCell>
                        <TableCell className="px-2 py-1 text-[11px] text-muted-foreground">{c.gst_user_id || '—'}</TableCell>
                        <TableCell className="px-2 py-1 text-[11px] tabular-nums text-muted-foreground">{log ? new Date(log.created_at).toLocaleString() : '—'}</TableCell>
                        <TableCell
                          className="px-2 py-1 text-center"
                          title={!log ? 'Never synced' : log.status === 'success' ? 'Success' : 'Failed'}
                        >
                          <span className="inline-flex items-center gap-1.5 text-[11px]">
                            <span
                              className={cn(
                                'inline-block h-2 w-2 rounded-sm',
                                !log ? 'bg-muted-foreground/40' : log.status === 'success' ? 'bg-success' : 'bg-destructive',
                              )}
                            />
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate px-2 py-1 text-[11px] text-muted-foreground" title={log?.message || ''}>{log?.message || 'Not synced yet'}</TableCell>
                        <TableCell className="px-2 py-1">
                          <div className="flex items-center gap-0.5">
                            {canAddEditClients() && (
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => navigate(`/edit-client/${c.id}`)}><Pencil className="h-3 w-3" /></Button>
                            )}
                            {canDeleteClients() && (
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => handleDeleteOne(c.id, c.name)}><Trash2 className="h-3 w-3" /></Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              Rows per page:
              <Select value={String(rowsPerPage)} onValueChange={(v) => setRowsPerPage(Number(v))}>
                <SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROWS_PER_PAGE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">{filtered.length === 0 ? '0' : `${page * rowsPerPage + 1}-${Math.min(filtered.length, (page + 1) * rowsPerPage)}`} of {filtered.length}</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}><ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Update — sets Active/Inactive for every selected company. */}
      <Dialog open={bulkUpdateOpen} onOpenChange={setBulkUpdateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Update</DialogTitle>
            <DialogDescription>Applies to the {selected.size} selected compan{selected.size === 1 ? 'y' : 'ies'}.</DialogDescription>
          </DialogHeader>
          <Select value={bulkActiveValue} onValueChange={(v) => setBulkActiveValue(v as typeof bulkActiveValue)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkUpdateOpen(false)}>Cancel</Button>
            <Button onClick={applyBulkUpdate} disabled={bulkSaving || selected.size === 0}>
              {bulkSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Log — full sync-attempt history, scoped to the current selection when any rows are checked. */}
      <Dialog open={syncLogOpen} onOpenChange={setSyncLogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sync Log</DialogTitle>
            <DialogDescription>
              {selected.size > 0 ? `History for the ${selected.size} selected compan${selected.size === 1 ? 'y' : 'ies'}.` : 'Most recent 50 sync attempts across every company.'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Company</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Status</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Message</TableHead>
                  <TableHead className="bg-muted text-[10px] font-semibold uppercase">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedLogs.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No sync attempts recorded yet.</TableCell></TableRow>
                ) : (
                  selectedLogs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-[11px]">{clientNameById.get(l.client_id) || '—'}</TableCell>
                      <TableCell className="text-[11px]">
                        <span className={cn('inline-flex items-center gap-1', l.status === 'success' ? 'text-success' : 'text-destructive')}>
                          {l.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          {l.status === 'success' ? 'Success' : 'Failed'}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-[11px] text-muted-foreground" title={l.message || ''}>{l.message || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{new Date(l.created_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncLogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CompanyListPage;
