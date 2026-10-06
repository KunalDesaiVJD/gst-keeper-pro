// Import for the notices sync (audit U-54-2..4): a sheet of GSTIN · portal user
// ID · owner that updates clients already in the app, matched by GSTIN, with a
// preview of what changes. It never creates clients (no filing-status back-fill
// launched from here) and never takes passwords (those go in Update password).
import React, { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/gstr9/badge';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { supabase } from '@/integrations/supabase/client';
import { plural } from '@/lib/noticeFormat';
import type { ClientBase } from './syncHealth';

interface Change { id: string; name: string; gstin: string; userFrom: string | null; userTo: string | null; ownerFrom: string | null; ownerTo: string | null }
interface Preview { changes: Change[]; unchanged: number; notFound: string[]; errors: string[] }

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const USER_KEYS = ['portaluserid', 'gstportaluserid', 'userid', 'gstuserid', 'username', 'portalusername'];
const OWNER_KEYS = ['owner', 'assignedaccountant', 'accountant'];

function readSheet(rows: Record<string, unknown>[], clients: ClientBase[]): Preview {
  const byGstin = new Map(clients.map((c) => [c.gstin.toUpperCase(), c]));
  const out: Preview = { changes: [], unchanged: 0, notFound: [], errors: [] };
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const cells = new Map(Object.entries(row).map(([k, v]) => [norm(k), String(v ?? '').trim()]));
    const gstin = (cells.get('gstin') ?? '').toUpperCase();
    const user = USER_KEYS.map((k) => cells.get(k)).find((v) => v !== undefined) ?? '';
    const owner = OWNER_KEYS.map((k) => cells.get(k)).find((v) => v !== undefined) ?? '';
    if (!gstin && !user && !owner) return;
    if (!/^[0-9A-Z]{15}$/.test(gstin)) { out.errors.push(`Row ${i + 2}: "${gstin || '(blank)'}" is not a 15-character GSTIN`); return; }
    if (seen.has(gstin)) { out.errors.push(`Row ${i + 2}: ${gstin} appears twice; the first row is used`); return; }
    seen.add(gstin);
    const c = byGstin.get(gstin);
    if (!c) { out.notFound.push(gstin); return; }
    const userTo = user && user !== (c.gst_user_id ?? '') ? user : null;
    const ownerTo = owner && owner !== (c.assigned_accountant ?? '') ? owner : null;
    if (!userTo && !ownerTo) { out.unchanged += 1; return; }
    out.changes.push({ id: c.id, name: c.name, gstin, userFrom: c.gst_user_id, userTo, ownerFrom: c.assigned_accountant, ownerTo });
  });
  return out;
}

export const ImportPortalIdsDialog: React.FC<{ clients: ClientBase[]; onDone: () => void }> = ({ clients, onDone }) => {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const missing = useMemo(() => clients.filter((c) => !c.gst_user_id).length, [clients]);

  const reset = (o: boolean) => { setOpen(o); if (!o) { setPreview(null); setFileName(''); } };

  const download = () => {
    const rows = [...clients].sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ GSTIN: c.gstin, Client: c.name, 'Portal user ID': c.gst_user_id ?? '', Owner: c.assigned_accountant ?? '' }));
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['GSTIN', 'Client', 'Portal user ID', 'Owner'] });
    ws['!cols'] = [{ wch: 18 }, { wch: 34 }, { wch: 20 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Portal user IDs');
    XLSX.writeFile(wb, 'Portal user IDs.xlsx');
  };

  const read = async (file: File | undefined) => {
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      setFileName(file.name);
      setPreview(readSheet(rows, clients));
    } catch (e) {
      toast.error(`Couldn't read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const apply = async () => {
    if (!preview?.changes.length) return;
    setSaving(true);
    let failed = 0;
    for (const ch of preview.changes) {
      const patch: { gst_user_id?: string; assigned_accountant?: string } = {};
      if (ch.userTo) patch.gst_user_id = ch.userTo;
      if (ch.ownerTo) patch.assigned_accountant = ch.ownerTo;
      const { error } = await supabase.from('clients').update(patch).eq('id', ch.id);
      if (error) failed += 1;
    }
    setSaving(false);
    const done = preview.changes.length - failed;
    if (failed) toast.error(`${plural(done, 'client')} updated; ${failed} could not be saved. Try those again.`);
    else toast.success(`${plural(done, 'client')} updated. Add each new client's portal password with Update password before syncing.`);
    reset(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={WS_BTN}><Upload className="h-3.5 w-3.5" aria-hidden /> Import portal IDs</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import portal user IDs</DialogTitle>
          <DialogDescription>
            Sets the GST portal user ID and the owner of clients already in the app, matched by GSTIN. New clients are added
            under <Link to="/clients" className="underline underline-offset-2">Clients</Link>; passwords are never imported.
          </DialogDescription>
        </DialogHeader>

        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Columns: <b>GSTIN</b> and <b>Portal user ID</b>, optionally <b>Owner</b> (who looks after the client). A blank cell leaves the value as it is.
            <div className="mt-1.5">
              <Button size="sm" variant="outline" className={WS_BTN} onClick={download}>
                <Download className="h-3.5 w-3.5" aria-hidden /> Download the client list ({plural(clients.length, 'client')}, {missing} without a portal user ID)
              </Button>
            </div>
          </li>
          <li>
            <Label htmlFor={`${uid}-file`} className="text-sm font-normal">Upload the filled-in sheet (.xlsx, .xls or .csv)</Label>
            <input ref={fileRef} id={`${uid}-file`} type="file" accept=".xlsx,.xls,.csv"
              className="mt-1.5 block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-card file:px-2.5 file:py-1.5 file:text-xs file:font-medium"
              onChange={(e) => read(e.target.files?.[0])} />
          </li>
        </ol>

        {preview && (
          <div className="space-y-2" aria-live="polite">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium">{fileName}:</span>
              <Badge variant="info" className="text-[11px]">{plural(preview.changes.length, 'client')} to update</Badge>
              <Badge variant="secondary" className="text-[11px]">{preview.unchanged} unchanged</Badge>
              {preview.notFound.length > 0 && <Badge variant="warning" className="text-[11px]">{preview.notFound.length} not in the app</Badge>}
              {preview.errors.length > 0 && <Badge variant="destructive" className="text-[11px]">{plural(preview.errors.length, 'row')} skipped</Badge>}
            </div>
            {preview.changes.length > 0 && (
              <div className={`${WS_TABLE_WRAP} max-h-64`}>
                <table className={WS_TABLE}>
                  <thead><tr>
                    <th scope="col" className={WS_TH}>Client</th>
                    <th scope="col" className={WS_TH}>Portal user ID</th>
                    <th scope="col" className={WS_TH}>Owner</th>
                  </tr></thead>
                  <tbody>
                    {preview.changes.map((ch) => (
                      <tr key={ch.id} className={WS_TR}>
                        <td className={WS_TD}><div className="font-medium">{ch.name}</div><div className="font-mono text-[11px] text-muted-foreground">{ch.gstin}</div></td>
                        <td className={`${WS_TD} text-xs`}>{ch.userTo ? <>{ch.userFrom || 'none'} → <b>{ch.userTo}</b></> : 'unchanged'}</td>
                        <td className={`${WS_TD} text-xs`}>{ch.ownerTo ? <>{ch.ownerFrom || 'none'} → <b>{ch.ownerTo}</b></> : 'unchanged'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.notFound.length > 0 && (
              <p className="text-xs">Not in the app (add them under <Link to="/clients" className="underline underline-offset-2">Clients</Link> first): <span className="font-mono">{preview.notFound.join(', ')}</span></p>
            )}
            {preview.errors.length > 0 && <ul className="list-disc pl-5 text-xs">{preview.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>Cancel</Button>
          <Button onClick={apply} disabled={!preview?.changes.length || saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />} Update {plural(preview?.changes.length ?? 0, 'client')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportPortalIdsDialog;
