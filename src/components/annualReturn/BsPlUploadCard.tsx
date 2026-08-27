import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Upload, FileText, Trash2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const DOC_TYPES = ['balance_sheet', 'profit_loss', 'other'] as const;
type DocType = typeof DOC_TYPES[number];
const DOC_TYPE_LABEL: Record<DocType, string> = { balance_sheet: 'Balance Sheet', profit_loss: 'Profit & Loss', other: 'Other' };

interface UploadRow {
  id: string; doc_type: DocType; file_name: string; file_url: string; file_size: number | null;
  description: string | null; uploaded_at: string;
}

const fmtSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface Props { clientId: string; financialYear: string; }

/**
 * The Annual Return module's first real file-upload capability — attaching
 * the audited Balance Sheet and Profit & Loss statement (the source
 * documents GSTR-9C's turnover/ITC reconciliation tables refer to) to a
 * client/year. Reuses the existing 'return-pdfs' storage bucket (already
 * used by FilingStatusPage and AddNoticeDialog) under an
 * 'annual-return/' prefix.
 */
export const BsPlUploadCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<DocType>('balance_sheet');
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('annual_return_bs_pl_uploads')
      .select('id, doc_type, file_name, file_url, file_size, description, uploaded_at')
      .eq('client_id', clientId).eq('financial_year', financialYear).order('uploaded_at', { ascending: false });
    if (error) { toast.error('Could not load uploads: ' + error.message); setLoading(false); return; }
    setRows((data || []) as UploadRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); setFile(null); setDescription(''); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async () => {
    if (!file) { toast.error('Choose a file first.'); return; }
    setUploading(true);
    try {
      const path = `annual-return/${clientId}/${financialYear}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
      const { error: uploadError } = await supabase.storage.from('return-pdfs').upload(path, file);
      if (uploadError) throw uploadError;
      const fileUrl = supabase.storage.from('return-pdfs').getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from('annual_return_bs_pl_uploads').insert({
        client_id: clientId, financial_year: financialYear, doc_type: docType,
        file_name: file.name, file_url: fileUrl, file_size: file.size,
        description: description.trim() || null, uploaded_by: user?.id || null,
      });
      if (error) throw error;
      toast.success('Uploaded.');
      setFile(null);
      setDescription('');
      await load();
    } catch (err) {
      toast.error('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (row: UploadRow) => {
    setDeletingId(row.id);
    try {
      const { error } = await supabase.from('annual_return_bs_pl_uploads').delete().eq('id', row.id);
      if (error) throw error;
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success('Removed.');
    } catch (err) {
      toast.error('Could not remove: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Balance Sheet &amp; P&amp;L Uploads</CardTitle>
        <CardDescription>The audited financials GSTR-9C's Tables 5, 7, 9, 12 and 14 reconcile against — attached here for the working papers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_1fr_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABEL[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">File</Label>
            <Input type="file" accept=".pdf,.xls,.xlsx" className="h-9" disabled={uploading} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description (optional)</Label>
            <Input className="h-9" value={description} disabled={uploading} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Signed copy, schedule III format" />
          </div>
          <Button size="sm" disabled={uploading || !file} onClick={handleUpload}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            Upload
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No files uploaded for this client/year yet.</p>
        ) : (
          <div className="divide-y border rounded-md">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{r.file_name}</span>
                    <Badge variant="outline" className="text-[10px]">{DOC_TYPE_LABEL[r.doc_type]}</Badge>
                    {r.file_size ? <span className="text-xs text-muted-foreground">{fmtSize(r.file_size)}</span> : null}
                  </div>
                  {r.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.description}</p>}
                </div>
                <a href={r.file_url} target="_blank" rel="noreferrer" aria-label={`Download ${r.file_name}`}>
                  <Button size="icon" variant="ghost" className="h-8 w-8"><Download className="h-4 w-4" /></Button>
                </a>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" disabled={deletingId === r.id} onClick={() => handleDelete(r)} aria-label={`Remove ${r.file_name}`}>
                  {deletingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BsPlUploadCard;
