// Every PDF the extension has captured for a client, in one place — the
// direct answer to "I don't want to pull from the portal again just to see
// a DRC-03 PDF I already fetched." See clientDocuments.ts for where each
// document type actually lives; this page just lists and serves them.
import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Files, Search, Loader2, ExternalLink, Download, FileX2 } from 'lucide-react';
import { useClient } from '@/contexts/ClientContext';
import { supabase } from '@/integrations/supabase/client';
import { fetchClientDocuments, type ClientDocument, type DocumentSource } from '@/lib/clientDocuments';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';

interface ClientLite { id: string; name: string; gstin: string; }

const SOURCE_BADGE: Record<DocumentSource, 'info' | 'warning' | 'success' | 'secondary'> = {
  'Filed Return': 'success',
  'DRC-03': 'warning',
  'Refund Application': 'info',
  'Registration Certificate': 'secondary',
};

const DocumentsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [docs, setDocs] = useState<ClientDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<DocumentSource | 'all'>('all');
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    supabase.from('clients').select('id, name, gstin').order('name').then(({ data }) => {
      setClients((data || []) as ClientLite[]);
    });
  }, []);

  useEffect(() => {
    if (!selectedClientId) { setDocs([]); return; }
    setLoading(true);
    fetchClientDocuments(selectedClientId)
      .then(setDocs)
      .catch(() => toast.error('Could not load documents for this client.'))
      .finally(() => setLoading(false));
  }, [selectedClientId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (sourceFilter !== 'all' && d.source !== sourceFilter) return false;
      if (!q) return true;
      return d.title.toLowerCase().includes(q) || d.detail.toLowerCase().includes(q);
    });
  }, [docs, search, sourceFilter]);

  const sourceCounts = useMemo(() => {
    const m = new Map<DocumentSource, number>();
    for (const d of docs) m.set(d.source, (m.get(d.source) || 0) + 1);
    return m;
  }, [docs]);

  const handleDownloadAll = async () => {
    if (filtered.length === 0) return;
    setDownloadingAll(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const seenNames = new Set<string>();
      let failed = 0;
      for (const d of filtered) {
        try {
          const res = await fetch(d.url);
          if (!res.ok) { failed++; continue; }
          const blob = await res.blob();
          let name = `${d.source}_${d.title}`.replace(/[^A-Za-z0-9 _.-]/g, '_').slice(0, 120) + '.pdf';
          let i = 2;
          while (seenNames.has(name)) { name = name.replace(/\.pdf$/, '') + `_${i++}.pdf`; }
          seenNames.add(name);
          zip.file(name, blob);
        } catch { failed++; }
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Documents_${clients.find((c) => c.id === selectedClientId)?.name || 'client'}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (failed > 0) toast.warning(`Downloaded — ${failed} file(s) couldn't be fetched and were skipped.`);
      else toast.success(`Downloaded ${filtered.length} document(s) as a zip.`);
    } catch {
      toast.error('Could not build the zip file.');
    } finally {
      setDownloadingAll(false);
    }
  };

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Documents"
        subtitle="Every PDF already captured from the GST portal for this client — view or download without pulling again."
        icon={<Files className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium whitespace-nowrap text-muted-foreground">Client</span>
              <div className="w-64">
                <SearchableSelect
                  options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
                  value={selectedClientId}
                  onValueChange={setSelectedClientId}
                  placeholder="Select a client"
                />
              </div>
            </div>
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search documents…" className="pl-8 h-9 text-sm" />
            </div>
            <div className="w-56">
              <SearchableSelect
                options={[
                  { value: 'all', label: `All Sources (${docs.length})` },
                  ...(Object.keys(SOURCE_BADGE) as DocumentSource[])
                    .filter((s) => (sourceCounts.get(s) || 0) > 0)
                    .map((s) => ({ value: s, label: `${s} (${sourceCounts.get(s) || 0})` })),
                ]}
                value={sourceFilter}
                onValueChange={(v) => setSourceFilter(v as DocumentSource | 'all')}
                placeholder="Source"
              />
            </div>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={handleDownloadAll} disabled={!selectedClientId || filtered.length === 0 || downloadingAll}>
              {downloadingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
              Download All ({filtered.length})
            </Button>
          </div>

          {!selectedClientId && (
            <div className="text-center py-16 text-sm text-muted-foreground">Pick a client to see their documents.</div>
          )}

          {selectedClientId && loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading documents…
            </div>
          )}

          {selectedClientId && !loading && docs.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <FileX2 className="h-8 w-8" />
              <p className="text-sm">No documents captured yet for this client.</p>
              <p className="text-xs">Run a Pull on DRC-03, Refund, or a Filing Status return, and they'll show up here.</p>
            </div>
          )}

          {selectedClientId && !loading && docs.length > 0 && (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Source</TableHead>
                    <TableHead className="text-xs font-semibold">Document</TableHead>
                    <TableHead className="text-xs font-semibold">Detail</TableHead>
                    <TableHead className="text-xs font-semibold">Date</TableHead>
                    <TableHead className="text-xs font-semibold text-right">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-10">No documents match "{search}".</TableCell>
                    </TableRow>
                  )}
                  {filtered.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="py-2"><Badge variant={SOURCE_BADGE[d.source]} className="text-[10px] py-0">{d.source}</Badge></TableCell>
                      <TableCell className="py-2 text-sm font-medium">{d.title}</TableCell>
                      <TableCell className="py-2 text-sm text-muted-foreground">{d.detail}</TableCell>
                      <TableCell className="py-2 text-sm tabular-nums">{d.date || '—'}</TableCell>
                      <TableCell className="py-2 text-right">
                        <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                          <ExternalLink className="h-3.5 w-3.5" /> View
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DocumentsPage;
