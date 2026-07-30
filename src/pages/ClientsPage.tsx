import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import BulkAddClientsDialog from '@/components/clients/BulkAddClientsDialog';
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

  // Credentials tab state.
  const [creds, setCreds] = useState<ClientCredentialRow[]>([]);
  const [showPasswords, setShowPasswords] = useState(true);
  const [credSearch, setCredSearch] = useState('');
  const [exporting, setExporting] = useState<null | 'xlsx' | 'pdf'>(null);

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

  const loadCreds = useCallback(() => {
    fetchClientCredentials().then(setCreds).catch(() => { /* surfaced on export */ });
  }, []);

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
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchClients, loadCreds]);

  const handleDeleteClient = async (id: string, name: string) => {
    if (!(await confirm({ title: 'Delete client?', description: `This permanently deletes "${name}" and all of its data.`, destructive: true, confirmText: 'Delete' }))) return;

    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Failed to delete client: ' + error.message);
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

  const filteredClients = clients.filter(client =>
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.gstin.toLowerCase().includes(searchTerm.toLowerCase())
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'clients', label: 'Clients', icon: Users },
    { id: 'credentials', label: 'Credentials', icon: KeyRound },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Clients"
        subtitle="Manage your client database"
        icon={<Users className="h-6 w-6" />}
        actions={
          activeTab === 'clients'
            ? (canAddEditClients() ? (
                <>
                  <BulkAddClientsDialog onSuccess={() => fetchClients()} />
                  <Button onClick={() => navigate('/add-client')} className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Add Client
                  </Button>
                </>
              ) : undefined)
            : (canExportCreds ? (
              <>
                <Button
                  variant="default"
                  onClick={() => handleExportCreds('xlsx')}
                  disabled={exporting === 'xlsx'}
                  className="flex items-center gap-2"
                  aria-label="Export credentials as Excel"
                >
                  {exporting === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleExportCreds('pdf')}
                  disabled={exporting === 'pdf'}
                  className="flex items-center gap-2"
                  aria-label="Export credentials as PDF"
                >
                  {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  PDF
                </Button>
              </>
            ) : undefined)
        }
      />

      {/* Tab strip */}
      <div className="flex flex-wrap gap-2 p-1 bg-muted/50 rounded-lg w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'clients' ? (
        <>
          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or GSTIN..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Client Cards */}
          <div className="grid gap-4">
            {filteredClients.map((client) => (
              <Card key={client.id} className="hover:shadow-card-hover transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="h-6 w-6 text-primary" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="font-semibold text-foreground">{client.name}</h3>
                        <p className="text-sm text-muted-foreground">GSTIN: {client.gstin}</p>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {client.mobile && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {client.mobile}
                            </span>
                          )}
                          {client.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {client.email}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 pt-2">
                          <Badge variant="outline" className="text-xs">
                            {client.registration_type}
                          </Badge>
                          {client.selected_returns?.map((ret) => (
                            <Badge key={ret} variant="secondary" className="text-xs">
                              {ret}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canAddEditClients() && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit Client"
                          aria-label={`Edit client ${client.name}`}
                          onClick={() => navigate(`/edit-client/${client.id}`)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canDeleteClients() && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete Client"
                          aria-label={`Delete client ${client.name}`}
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteClient(client.id, client.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredClients.length === 0 && (
              <Card>
                <CardContent className="p-6">
                  <TableEmptyState
                    icon={<Building2 className="h-6 w-6" />}
                    title={clients.length === 0 ? 'No clients yet' : 'No matching clients'}
                    description={
                      clients.length === 0
                        ? 'Add your first client to get started.'
                        : 'No clients found matching your search.'
                    }
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Credentials toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative max-w-md flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name / GSTIN / User ID..."
                value={credSearch}
                onChange={(e) => setCredSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowPasswords((v) => !v)}>
              {showPasswords
                ? <><EyeOff className="h-4 w-4 mr-1.5" /> Hide passwords</>
                : <><Eye className="h-4 w-4 mr-1.5" /> Reveal passwords</>}
            </Button>
          </div>

          {/* Credentials table — every client, live-updating */}
          <Card>
            <CardContent className="p-4">
              <div className="overflow-auto max-h-[65vh] rounded-md border border-border">
                <table className="w-full text-sm border-collapse min-w-[720px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-primary text-primary-foreground">
                      <th className="border border-primary-foreground/20 p-2 text-center w-10">#</th>
                      <th className="border border-primary-foreground/20 p-2 text-left">Client Name</th>
                      <th className="border border-primary-foreground/20 p-2 text-left">GSTIN</th>
                      <th className="border border-primary-foreground/20 p-2 text-left">GST User ID</th>
                      <th className="border border-primary-foreground/20 p-2 text-left">GST Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCreds.map((c, i) => (
                      <tr key={`${c.gstin || c.name}-${i}`} className="odd:bg-muted/30">
                        <td className="border border-border p-2 text-center tabular-nums">{i + 1}</td>
                        <td className="border border-border p-2 font-medium">{c.name}</td>
                        <td className="border border-border p-2 font-mono text-xs">{c.gstin || '—'}</td>
                        <td className="border border-border p-2 font-mono text-xs">{c.gst_user_id || '—'}</td>
                        <td className="border border-border p-2 font-mono text-xs">
                          {c.gst_password ? (showPasswords ? c.gst_password : '••••••••') : '—'}
                        </td>
                      </tr>
                    ))}
                    {filteredCreds.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center p-6 text-muted-foreground">
                          {creds.length === 0 ? 'No clients found.' : 'No clients match your search.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default ClientsPage;
