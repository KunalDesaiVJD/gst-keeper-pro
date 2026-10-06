import React, { useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Note } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { deleteIssue, saveIssue, type IssueInput, type NoticeIssue } from '@/lib/noticeWorkspace';
import { fmtInr } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const STATUS: Record<string, { label: string; tone: 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  open: { label: 'Open', tone: 'secondary' },
  explained: { label: 'Explained', tone: 'success' },
  pay: { label: 'Pay (DRC-03)', tone: 'warning' },
  contest: { label: 'Contest', tone: 'destructive' },
};

const EMPTY: IssueInput = { title: '', detail: null, amount: 0, explained_amount: 0, position: null, annexure: null, status: 'open' };

/**
 * The issues the notice raises and the firm's position on each (target-notice:
 * "Issues raised and the system's position"). Typed by staff now; Phase 4 reads
 * them from the PDF into the same rows.
 */
export const IssuesTab: React.FC<{ noticeId: string; issues: NoticeIssue[]; canEdit: boolean; onChanged: () => void }> = ({ noticeId, issues, canEdit, onChanged }) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<(IssueInput & { id?: string; seq?: number }) | null>(null);
  const [saving, setSaving] = useState(false);
  const total = issues.reduce((s, i) => s + Number(i.amount || 0), 0);
  const explained = issues.reduce((s, i) => s + Number(i.explained_amount || 0), 0);

  const save = async () => {
    if (!editing || !user) return;
    if (!editing.title.trim()) { toast.error('Say what the issue is.'); return; }
    if (Number(editing.explained_amount) > Number(editing.amount)) { toast.error('The explained amount cannot be more than the amount in the notice.'); return; }
    setSaving(true);
    try {
      await saveIssue(noticeId, { ...editing, title: editing.title.trim(), seq: editing.seq ?? issues.length + 1 }, user);
      setEditing(null);
      onChanged();
    } catch (e) {
      toast.error(`Couldn't save the issue: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  const remove = async (i: NoticeIssue) => {
    if (!user) return;
    const ok = await confirm({ title: 'Remove this issue?', description: `"${i.title}" and its position will be removed. This is logged in Activity.`, confirmText: 'Remove', destructive: true });
    if (!ok) return;
    try { await deleteIssue(i.id, user); onChanged(); }
    catch (e) { toast.error(`Couldn't remove: ${e instanceof Error ? e.message : String(e)}`); }
  };

  return (
    <div className="space-y-2">
      {issues.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No issues listed yet. List what the notice alleges, with the amount for each, to see how much your own data explains.
          {canEdit && <div className="mt-3"><Button size="sm" onClick={() => setEditing({ ...EMPTY })}><Plus className="mr-1 h-4 w-4" /> Add the first issue</Button></div>}
        </div>
      ) : (<>
        {/* Phones: one card per issue (U-40-5). */}
        <ul className="space-y-2 md:hidden" aria-label="Issues">
          {issues.map((i, n) => (
            <li key={i.id} className="rounded-md border p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{n + 1}. {i.title}</div>
                  {i.detail && <div className="text-xs text-muted-foreground">{i.detail}</div>}
                </div>
                <Badge variant={STATUS[i.status]?.tone ?? 'secondary'} className="shrink-0 text-[11px]">{STATUS[i.status]?.label ?? i.status}</Badge>
              </div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 text-xs">
                <dt className="text-muted-foreground">Per notice</dt><dd className="text-right tabular-nums">{fmtInr(i.amount)}</dd>
                <dt className="text-muted-foreground">Explained</dt><dd className={cn('text-right tabular-nums', Number(i.explained_amount) > 0 && 'font-semibold text-success-strong')}>{fmtInr(i.explained_amount)}</dd>
              </dl>
              {i.position && <p className="mt-1.5 text-xs">{i.position}</p>}
              {i.annexure && <div className="mt-1 flex flex-wrap gap-1">{i.annexure.split(/[,;]\s*/).map((a) => <Badge key={a} variant="secondary" className="text-[10px]">{a}</Badge>)}</div>}
              {i.source === 'extracted' && <Badge variant="info" className="mt-1 text-[10px]">read from PDF — verify</Badge>}
              {canEdit && (
                <div className="mt-1.5 flex justify-end gap-1">
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing({ ...i })}><Pencil className="mr-1 h-3.5 w-3.5" /> Edit</Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => remove(i)}><Trash2 className="mr-1 h-3.5 w-3.5" /> Remove</Button>
                </div>
              )}
            </li>
          ))}
          <li className="flex justify-between rounded-md bg-muted/50 px-2.5 py-1.5 text-xs font-semibold">
            <span>Total {fmtInr(total)}</span><span>{total ? `${Math.round((100 * explained) / total)}% explained` : ''}</span>
          </li>
        </ul>
        <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
          <table className={WS_TABLE}>
            <thead>
              <tr>
                <th scope="col" className={cn(WS_TH, 'w-8')}>#</th>
                <th scope="col" className={WS_TH}>Issue as read from the notice</th>
                <th scope="col" className={cn(WS_TH, 'text-right')}>Per notice</th>
                <th scope="col" className={WS_TH}>Position</th>
                <th scope="col" className={cn(WS_TH, 'text-right')}>Explained</th>
                <th scope="col" className={WS_TH}>Status</th>
                {canEdit && <th scope="col" className={cn(WS_TH, 'w-16')}><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {issues.map((i, n) => (
                <tr key={i.id} className={WS_TR}>
                  <td className={cn(WS_TD, 'text-muted-foreground')}>{n + 1}</td>
                  <td className={cn(WS_TD, 'min-w-[12rem]')}>
                    <div className="font-medium">{i.title}</div>
                    {i.detail && <div className="text-xs text-muted-foreground">{i.detail}</div>}
                    {i.source === 'extracted' && <Badge variant="info" className="mt-0.5 text-[10px]">read from PDF — verify</Badge>}
                  </td>
                  <td className={WS_TD_NUM}>{fmtInr(i.amount)}</td>
                  <td className={cn(WS_TD, 'min-w-[14rem] text-xs')}>
                    {i.position || <span className="text-muted-foreground">—</span>}
                    {i.annexure && <div className="mt-0.5 flex flex-wrap gap-1">{i.annexure.split(/[,;]\s*/).map((a) => <Badge key={a} variant="secondary" className="text-[10px]">{a}</Badge>)}</div>}
                  </td>
                  <td className={cn(WS_TD_NUM, Number(i.explained_amount) > 0 && 'text-success-strong font-semibold')}>{fmtInr(i.explained_amount)}</td>
                  <td className={WS_TD}><Badge variant={STATUS[i.status]?.tone ?? 'secondary'} className="text-[11px]">{STATUS[i.status]?.label ?? i.status}</Badge></td>
                  {canEdit && (
                    <td className={cn(WS_TD, 'whitespace-nowrap')}>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit issue ${n + 1}`} onClick={() => setEditing({ ...i })}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove issue ${n + 1}`} onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={WS_TR_TOTAL}>
                <td className={WS_TD} />
                <td className={WS_TD}>Total</td>
                <td className={WS_TD_NUM}>{fmtInr(total)}</td>
                <td className={WS_TD} />
                <td className={WS_TD_NUM}>{fmtInr(explained)}</td>
                <td className={WS_TD} colSpan={canEdit ? 2 : 1}>{total ? `${Math.round((100 * explained) / total)}% explained` : ''}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </>)}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Note tone="position" className="flex-1">Positions are the firm's elected defaults for each issue type; the reviewer can override any row. Phase 4 will read the issues from the notice PDF.</Note>
        {canEdit && issues.length > 0 && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditing({ ...EMPTY })}><Plus className="mr-1 h-3.5 w-3.5" /> Add issue</Button>}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit issue' : 'Add an issue'}</DialogTitle>
            <DialogDescription>What the notice alleges, the amount for it, and how much your own data explains.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="issue-title" className="text-xs">Issue <span className="text-destructive">*</span></Label>
                <Input id="issue-title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="e.g. ITC claimed in GSTR-3B exceeds GSTR-2B" className="h-9" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="issue-detail" className="text-xs">Table / period</Label>
                <Input id="issue-detail" value={editing.detail ?? ''} onChange={(e) => setEditing({ ...editing, detail: e.target.value || null })} placeholder="e.g. Table 4A(5) v 2B · Apr-23 → Mar-24" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="issue-amount" className="text-xs">Per notice (₹)</Label>
                <NumberInput id="issue-amount" value={editing.amount ?? ''} onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) || 0 })} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="issue-explained" className="text-xs">Explained by your data (₹)</Label>
                <NumberInput id="issue-explained" value={editing.explained_amount ?? ''} onChange={(e) => setEditing({ ...editing, explained_amount: Number(e.target.value) || 0 })} className="h-9" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="issue-position" className="text-xs">Position</Label>
                <Textarea id="issue-position" rows={3} value={editing.position ?? ''} onChange={(e) => setEditing({ ...editing, position: e.target.value || null })}
                  placeholder="e.g. ₹3,10,400 = invoices dated Mar-24 that appear in 2B of Apr–May-24 (timing)" className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="issue-annexure" className="text-xs">Annexures</Label>
                <Input id="issue-annexure" value={editing.annexure ?? ''} onChange={(e) => setEditing({ ...editing, annexure: e.target.value || null })} placeholder="A-1, A-2" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="issue-status" className="text-xs">Status</Label>
                <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                  <SelectTrigger id="issue-status" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IssuesTab;
