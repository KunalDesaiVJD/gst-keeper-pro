import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_CONTROL } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Building2,
  Loader2,
  Phone
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { describeClientDeleteError } from '@/lib/clientDeleteError';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { useAuth } from '@/contexts/AuthContext';

interface Client {
  id: string;
  name: string;
  gstin: string;
  mobile: string | null;
  email: string | null;
  registration_type: string;
  selected_returns: string[] | null;
}

const ClientManagementSection: React.FC = () => {
  const navigate = useNavigate();
  const { canAddEditClients, canDeleteClients } = useAuth();
  const confirm = useConfirm();
  const [searchTerm, setSearchTerm] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

  useEffect(() => {
    fetchClients();

    const channel = supabase
      .channel('client-mgmt-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        fetchClients();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchClients]);

  const handleDeleteClient = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete client?',
      description: `"${name}" and its associated records will be permanently removed. This cannot be undone.`,
      destructive: true,
      confirmText: 'Delete',
    });
    if (!ok) return;

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

  const filteredClients = clients.filter(client =>
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.gstin.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          Client Management
        </span>
      }
      description={`${clients.length} clients in database`}
      actions={
        canAddEditClients() && (
          <Button onClick={() => navigate('/add-client')} size="sm" className={WS_BTN}>
            <Plus className="h-3.5 w-3.5" />
            Add Client
          </Button>
        )
      }
    >
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or GSTIN..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={cn(WS_CONTROL, 'pl-8')}
          />
        </div>

        {/* Client List */}
        <div className="max-h-80 overflow-y-auto rounded-md border">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filteredClients.length === 0 ? (
            <TableEmptyState
              icon={<Building2 className="h-6 w-6" />}
              title={clients.length === 0 ? 'No clients yet' : 'No matching clients'}
              description={
                clients.length === 0
                  ? 'Add your first client to start tracking GST filings.'
                  : 'Try a different name or GSTIN.'
              }
            />
          ) : (
            filteredClients.slice(0, 10).map((client) => (
              <div
                key={client.id}
                className="flex items-center justify-between gap-2 border-b px-3 py-1.5 transition-colors last:border-b-0 hover:bg-muted/30"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{client.name}</p>
                    <p className="text-xs text-muted-foreground truncate font-mono">{client.gstin}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="hidden sm:flex items-center gap-2">
                    {client.mobile && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {client.mobile}
                      </span>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px] font-medium hidden md:inline-flex">
                    {client.registration_type}
                  </Badge>
                  <div className="flex items-center gap-1">
                    {canAddEditClients() && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7"
                        title="Edit client"
                        aria-label={`Edit client ${client.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/edit-client/${client.id}`);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canDeleteClients() && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClient(client.id, client.name);
                        }}
                        title="Delete client"
                        aria-label={`Delete client ${client.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          {filteredClients.length > 10 && (
            <Button 
              variant="ghost" 
              className="h-8 w-full rounded-none text-xs text-muted-foreground"
              onClick={() => navigate('/clients')}
            >
              View all {filteredClients.length} clients →
            </Button>
          )}
        </div>
    </SectionCard>
  );
};

export default ClientManagementSection;
