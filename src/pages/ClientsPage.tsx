import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Building2,
  Phone,
  Mail,
  Users,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  LogIn,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { describeClientDeleteError } from '@/lib/clientDeleteError';
import { toast } from 'sonner';
import BulkAddClientsDialog from '@/components/clients/BulkAddClientsDialog';
import { EinvoiceStatusBadge } from '@/components/clients/EinvoiceStatusBadge';
import {
  loadEinvoiceData,
  listDueEinvoiceAlerts,
  einvoiceAttention,
  type DueEinvoiceAlert,
  type EinvoiceClient,
} from '@/lib/einvoice/thresholdAlerts';
import { EinvoiceAlertsPanel } from '@/components/clients/EinvoiceAlertsPanel';
import type { EinvoiceAssessment } from '@/lib/einvoice/threshold';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import {
  buildClientCredentials,
  fetchClientCredentials,
  renderReportToExcel,
  type ClientCredentialRow,
} from '@/utils/allClientsReports';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';
import {
  WS_PAGE, WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TR,
  WS_FILTER_LABEL, WS_CONTROL, WS_TABS_LIST, WS_TAB, WS_TAB_ACTIVE,
} from '@/components/workspace/theme';

interface Client {
  id: string;
  name: string;
  gstin: string;
  mobile: string | null;
  email: string | null;
  registration_type: string;
  selected_returns: string[] | null;
}

type TabId = 'clients' | 'credentials';

/** E-invoice filters behind the e-invoice tiles (also reachable as /clients?einvoice=…). */
type EinvFilter = 'einv' | 'approaching' | 'should_tick';
const EINV_FILTERS: EinvFilter[] = ['einv', 'approaching', 'should_tick'];
const EINV_FILTER_LABEL: Record<EinvFilter, string> = {
  einv: 'E-invoice clients',
  approaching: 'Approaching the threshold',
  should_tick: 'Should be e-invoice (not ticked)',
};

const ClientsPage: React.FC = () => {
  const navigate = useNavigate();
  const { canAddEditClients, canDeleteClients, user } = useAuth();
  // Exporting the full credentials list (plain-text passwords) is limited to
  // Superadmin and GST Manager; other staff can still view the table on screen.
  const canExportCreds = user?.role === 'superadmin' || user?.role === 'gst_manager';
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<TabId>('clients');
  const [searchTerm, setSearchTerm] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // E-invoice: per-client assessment + the tile filter.
  const [searchParams] = useSearchParams();
  const [einvAssessments, setEinvAssessments] = useState<Map<string, EinvoiceAssessment>>(new Map());
  const [einvClients, setEinvClients] = useState<Map<string, EinvoiceClient>>(new Map());
  const [einvFilter, setEinvFilter] = useState<EinvFilter | null>(() => {
    const q = searchParams.get('einvoice') as EinvFilter | null;
    return q && EINV_FILTERS.includes(q) ? q : null;
  });
  const [einvDue, setEinvDue] = useState<DueEinvoiceAlert[]>([]);

  // Credentials tab state.
  const [creds, setCreds] = useState<ClientCredentialRow[]>([]);
  const [showPasswords, setShowPasswords] = useState(false);
  const [credSearch, setCredSearch] = useState('');
  const [exporting, setExporting] = useState<null | 'xlsx' | 'pdf'>(null);
  const [extReady, setExtReady] = useState(false);

  const fetchClients = useCallback(async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, gstin, mobile, email, registration_type, selected_returns')
      .order('name');

    if (error) {
      console.error('Error fetching clients:', error);
      toast.error('Failed to load clients');
      return;
    }
    setClients(data || []);
    setIsLoading(false);
  }, []);

  // One round of queries for every client's turnover, plus the clients due a
  // threshold email. Nothing is sent from here — staff press Send in the
  // "E-invoice alerts to send" panel.
  const loadEinvoice = useCallback(async () => {
    try {
      const { assessments, clientsById } = await loadEinvoiceData();
      setEinvAssessments(assessments);
      setEinvClients(clientsById);
      setEinvDue(await listDueEinvoiceAlerts(assessments, clientsById));
    } catch (err) {
      console.error('E-invoice assessment failed:', err);
    }
  }, []);

  const loadCreds = useCallback(() => {
    fetchClientCredentials().then(setCreds).catch(() => { /* surfaced on export */ });
  }, []);

  useEffect(() => {
    void loadEinvoice();
  }, [loadEinvoice]);

  useEffect(() => {
    fetchClients();
    loadCreds();

    // Real-time subscription — a credential edit in Edit Client updates both
    // the list and the credentials table without a reload.
    const channel = supabase
      .channel('clients-page-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        fetchClients();
        loadCreds();
        void loadEinvoice();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchClients, loadCreds, loadEinvoice]);

  // Detect the GST Keeper browser extension (for the Credentials "Login" button).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkPortalLoginResult) {
        if (d.__gstkPortalLoginResult.ok) toast.success('Portal opening in a new tab — type the CAPTCHA there to finish logging in.');
        else toast.error('Could not start login: ' + d.__gstkPortalLoginResult.error);
      }
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t = setInterval(ping, 1000);
    const stop = setTimeout(() => clearInterval(t), 6000);
    return () => { window.removeEventListener('message', onMsg); clearInterval(t); clearTimeout(stop); };
  }, []);

  const handlePortalLogin = (clientId: string) => {
    if (!extReady) {
      toast.error('Install/enable the GST Keeper browser extension to log in from here.');
      return;
    }
    window.postMessage({ __gstkPortalLogin: { clientId } }, '*');
  };

  const handleDeleteClient = async (id: string, name: string) => {
    if (!(await confirm({ title: 'Delete client?', description: `This permanently deletes "${name}" and all of its data.`, destructive: true, confirmText: 'Delete' }))) return;

    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Failed to delete client: ' + describeClientDeleteError(error));
    } else {
      toast.success('Client deleted successfully');
      fetchClients();
    }
  };

  const handleExportCreds = async (format: 'xlsx' | 'pdf') => {
    if (!canExportCreds) {
      toast.error('Only Superadmin or GST Manager can export credentials.');
      return;
    }
    setExporting(format);
    try {
      const table = await buildClientCredentials();
      if (format === 'xlsx') renderReportToExcel(table);
      else renderReportToPdf(table);
      toast.success('Client credentials exported.');
    } catch (err: any) {
      toast.error(`Failed: ${err.message || 'Unknown error'}`);
    } finally {
      setExporting(null);
    }
  };

  const isTicked = (id: string) => {
    const c = einvClients.get(id);
    return !!c?.einvoice_applicable && !c?.einvoice_exemption;
  };
  const matchesEinv = (id: string, f: EinvFilter): boolean => {
    if (f === 'einv') return isTicked(id);
    const att = einvoiceAttention(einvAssessments.get(id), isTicked(id));
    if (f === 'should_tick') return att === 'should_tick';
    return att === 'approaching' || att === 'next_fy';
  };
  const einvCounts = {
    einv: clients.filter((c) => matchesEinv(c.id, 'einv')).length,
    approaching: clients.filter((c) => matchesEinv(c.id, 'approaching')).length,
    should_tick: clients.filter((c) => matchesEinv(c.id, 'should_tick')).length,
  };
  const toggleEinvFilter = (f: EinvFilter) => {
    setActiveTab('clients');
    setEinvFilter((cur) => (cur === f ? null : f));
  };

  const filteredClients = clients.filter(client =>
    (client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.gstin.toLowerCase().includes(searchTerm.toLowerCase())) &&
    (!einvFilter || matchesEinv(client.id, einvFilter))
  );

  const filteredCreds = useMemo(() => {
    const q = credSearch.trim().toLowerCase();
    if (!q) return creds;
    return creds.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.gstin || '').toLowerCase().includes(q) ||
      (c.gst_user_id || '').toLowerCase().includes(q)
    );
  }, [creds, credSearch]);

  if (isLoading) {
    return (
      <div className={WS_PAGE}>
        <Card>
          <CardContent className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading clients…
          </CardContent>
        </Card>
      </div>
    );
  }

  const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'clients', label: 'Clients', icon: Users },
    { id: 'credentials', label: 'Credentials', icon: KeyRound },
  ];

  const credsWithLogin = creds.filter((c) => !!c.gst_user_id).length;
  const credsMissing = creds.length - credsWithLogin;

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        title="Clients"
        subtitle="Manage your client database"
        icon={<Users />}
        actions={
          activeTab === 'clients'
            ? (canAddEditClients() ? (
                <>
                  <BulkAddClientsDialog onSuccess={() => fetchClients()} triggerClassName={WS_BTN} />
                  <Button size="sm" onClick={() => navigate('/add-client')} className={WS_BTN}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Client
                  </Button>
                </>
              ) : undefined)
            : (canExportCreds ? (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleExportCreds('xlsx')}
                  disabled={exporting === 'xlsx'}
                  className={WS_BTN}
                  aria-label="Export credentials as Excel"
                >
                  {exporting === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                  Excel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExportCreds('pdf')}
                  disabled={exporting === 'pdf'}
                  className={WS_BTN}
                  aria-label="Export credentials as PDF"
                >
                  {exporting === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                  PDF
                </Button>
              </>
            ) : undefined)
        }
      />

      {/* Summary tiles — each opens the tab it describes. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <TileButton active={activeTab === 'clients'} onClick={() => setActiveTab('clients')} title="Show the client list">
          <KpiTile
            label="Clients"
            value={clients.length}
            hint={searchTerm.trim() ? `${filteredClients.length} match the search` : 'All clients on record'}
          />
        </TileButton>
        <TileButton active={activeTab === 'credentials'} onClick={() => setActiveTab('credentials')} title="Show GST portal credentials">
          <KpiTile label="GST portal login saved" value={credsWithLogin} hint="Clients with a GST user ID" tone={credsWithLogin ? 'ok' : 'neutral'} />
        </TileButton>
        <TileButton active={false} onClick={() => setActiveTab('credentials')} title="Show GST portal credentials">
          <KpiTile label="No GST portal login" value={credsMissing} hint="Add it in Edit Client" tone={credsMissing ? 'warn' : 'ok'} />
        </TileButton>
        <TileButton active={einvFilter === 'einv'} onClick={() => toggleEinvFilter('einv')} title="Show only e-invoice clients">
          <KpiTile label="E-invoice clients" value={einvCounts.einv} hint="Ticked as e-invoice applicable" tone={einvCounts.einv ? 'ok' : 'neutral'} />
        </TileButton>
        <TileButton active={einvFilter === 'approaching'} onClick={() => toggleEinvFilter('approaching')} title="Show clients approaching the ₹5 crore e-invoice limit">
          <KpiTile label="Approaching threshold" value={einvCounts.approaching} hint="₹4 crore+ or applies next FY" tone={einvCounts.approaching ? 'warn' : 'ok'} />
        </TileButton>
        <TileButton active={einvFilter === 'should_tick'} onClick={() => toggleEinvFilter('should_tick')} title="Show clients that must e-invoice but are not ticked">
          <KpiTile label="Should be e-invoice (not ticked)" value={einvCounts.should_tick} hint="Preceding FY above ₹5 crore" tone={einvCounts.should_tick ? 'error' : 'ok'} />
        </TileButton>
      </div>

      <EinvoiceAlertsPanel
        due={einvDue}
        actor={{ id: user?.id ?? null, name: user?.firstName ?? null }}
        onSent={() => void loadEinvoice()}
      />

      {/* Tab strip */}
      <div role="tablist" aria-label="Clients and credentials" className={WS_TABS_LIST}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={cn(WS_TAB, isActive && WS_TAB_ACTIVE)}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'clients' ? (
        <>
          {/* Search */}
          <Card>
            <CardContent className="flex flex-wrap items-end gap-2 px-3 py-2">
              <label className="block w-full max-w-md space-y-0.5">
                <span className={WS_FILTER_LABEL}>Search</span>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or GSTIN..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className={cn(WS_CONTROL, 'pl-8')}
                  />
                </div>
              </label>
              {einvFilter && (
                <Button variant="outline" size="sm" className={WS_BTN} onClick={() => setEinvFilter(null)}>
                  {EINV_FILTER_LABEL[einvFilter]}
                  <X className="h-3.5 w-3.5" aria-label="Clear e-invoice filter" />
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Client list */}
          {filteredClients.length === 0 ? (
            <Card>
              <CardContent className="p-4">
                <TableEmptyState
                  icon={<Building2 className="h-6 w-6" />}
                  title={clients.length === 0 ? 'No clients yet' : 'No matching clients'}
                  description={
                    clients.length === 0
                      ? 'Add your first client to get started.'
                      : einvFilter
                        ? `No clients match the search and the "${EINV_FILTER_LABEL[einvFilter]}" filter.`
                        : 'No clients found matching your search.'
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <div className={cn(WS_TABLE_WRAP, 'max-h-[70vh]')}>
              <table className={cn(WS_TABLE, 'min-w-[960px]')}>
                <thead>
                  <tr>
                    <th className={cn(WS_TH, 'w-10 text-center')}>#</th>
                    <th className={WS_TH}>Client Name</th>
                    <th className={WS_TH}>GSTIN</th>
                    <th className={WS_TH}>Contact</th>
                    <th className={WS_TH}>Registration</th>
                    <th className={WS_TH}>Returns</th>
                    <th className={WS_TH}>E-invoice</th>
                    {(canAddEditClients() || canDeleteClients()) && (
                      <th className={cn(WS_TH, 'w-20 text-center')}>Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((client, i) => (
                    <tr key={client.id} className={WS_TR}>
                      <td className={cn(WS_TD, 'text-center tabular-nums text-muted-foreground')}>{i + 1}</td>
                      <td className={cn(WS_TD, 'font-medium text-foreground')}>
                        <span className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                          {client.name}
                        </span>
                      </td>
                      <td className={cn(WS_TD, 'whitespace-nowrap font-mono')}>{client.gstin}</td>
                      <td className={cn(WS_TD, 'text-muted-foreground')}>
                        {client.mobile || client.email ? (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            {client.mobile && (
                              <span className="flex items-center gap-1 whitespace-nowrap">
                                <Phone className="h-3 w-3" />
                                {client.mobile}
                              </span>
                            )}
                            {client.email && (
                              <span className="flex items-center gap-1 break-all">
                                <Mail className="h-3 w-3 shrink-0" />
                                {client.email}
                              </span>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className={WS_TD}>
                        <Badge variant="outline" className="whitespace-nowrap text-[10px] font-medium">
                          {client.registration_type}
                        </Badge>
                      </td>
                      <td className={WS_TD}>
                        <div className="flex flex-wrap gap-1">
                          {client.selected_returns?.map((ret) => (
                            <Badge key={ret} variant="secondary" className="whitespace-nowrap text-[10px] font-medium">
                              {ret}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className={WS_TD}>
                        <EinvoiceStatusBadge
                          ticked={isTicked(client.id)}
                          exemption={einvClients.get(client.id)?.einvoice_exemption}
                          assessment={einvAssessments.get(client.id)}
                        />
                      </td>
                      {(canAddEditClients() || canDeleteClients()) && (
                        <td className={cn(WS_TD, 'py-0.5 text-center')}>
                          <div className="flex items-center justify-center gap-0.5">
                            {canAddEditClients() && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Edit Client"
                                aria-label={`Edit client ${client.name}`}
                                onClick={() => navigate(`/edit-client/${client.id}`)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDeleteClients() && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Delete Client"
                                aria-label={`Delete client ${client.name}`}
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteClient(client.id, client.name)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Credentials toolbar */}
          <Card>
            <CardContent className="px-3 py-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <label className="min-w-[220px] max-w-md flex-1 space-y-0.5">
                  <span className={WS_FILTER_LABEL}>Search</span>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search name / GSTIN / User ID..."
                      value={credSearch}
                      onChange={(e) => setCredSearch(e.target.value)}
                      className={cn(WS_CONTROL, 'pl-8')}
                    />
                  </div>
                </label>
                <Button variant="outline" size="sm" className={WS_BTN} onClick={() => setShowPasswords((v) => !v)}>
                  {showPasswords
                    ? <><EyeOff className="h-3.5 w-3.5" /> Hide passwords</>
                    : <><Eye className="h-3.5 w-3.5" /> Reveal passwords</>}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Credentials table — every client, live-updating */}
          <div className={cn(WS_TABLE_WRAP, 'max-h-[65vh]')}>
            <table className={cn(WS_TABLE, 'min-w-[720px]')}>
              <thead>
                <tr>
                  <th className={cn(WS_TH, 'w-10 text-center')}>#</th>
                  <th className={WS_TH}>Client Name</th>
                  <th className={WS_TH}>GSTIN</th>
                  <th className={WS_TH}>GST User ID</th>
                  <th className={WS_TH}>GST Password</th>
                  <th className={cn(WS_TH, 'w-16 text-center')}>Login</th>
                </tr>
              </thead>
              <tbody>
                {filteredCreds.map((c, i) => (
                  <tr key={`${c.gstin || c.name}-${i}`} className={WS_TR}>
                    <td className={cn(WS_TD, 'text-center tabular-nums text-muted-foreground')}>{i + 1}</td>
                    <td className={cn(WS_TD, 'font-medium')}>{c.name}</td>
                    <td className={cn(WS_TD, 'whitespace-nowrap font-mono')}>{c.gstin || '—'}</td>
                    <td className={cn(WS_TD, 'font-mono')}>{c.gst_user_id || '—'}</td>
                    <td className={cn(WS_TD, 'font-mono')}>
                      {c.gst_password ? (showPasswords ? c.gst_password : '••••••••') : '—'}
                    </td>
                    <td className={cn(WS_TD, 'py-0.5 text-center')}>
                      <button
                        type="button"
                        onClick={() => handlePortalLogin(c.id)}
                        disabled={!c.gst_user_id}
                        className={`inline-flex items-center justify-center h-7 w-7 rounded ${
                          !c.gst_user_id ? 'text-muted-foreground/40 cursor-not-allowed'
                            : extReady ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground hover:bg-muted'
                        }`}
                        title={!c.gst_user_id ? 'No GST credentials saved'
                          : extReady ? `Log ${c.name} into the GST portal (you do the CAPTCHA)`
                            : 'GST Keeper extension not detected yet — install/enable it and reload this page'}
                        aria-label={`Log ${c.name} into the GST portal`}
                      >
                        <LogIn className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredCreds.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-sm text-muted-foreground">
                      {creds.length === 0 ? 'No clients found.' : 'No clients match your search.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

/** A KPI tile that toggles the tab it describes (as on GST Running Update). */
const TileButton: React.FC<{ active: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={active}
    className={cn(
      'rounded-lg text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full',
      active && 'ring-2 ring-primary/60',
    )}
  >
    {children}
  </button>
);

export default ClientsPage;
