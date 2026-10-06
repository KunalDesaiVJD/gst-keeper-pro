// The issues the notice raises and the firm's position on each (target-notice
// "Issues raised and the system's position"; audit R-08; per-notice spec
// "Issues table"): the issue type (reply_issue_types), period, demand by head,
// where the row came from — the portal's case folder, the form, the notice PDF
// (page and quote, "verify" until a person confirms) or typed — and how much
// the firm's own data explains. A figure typed here is the person's: the
// Evidence tab's recipes leave it alone (explained_by = null).
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Note } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { DemandTable } from '@/components/notices/reply/read/DemandTable';
import { useAuth } from '@/contexts/AuthContext';
import { deleteIssue, issueTypesQuery, saveIssue, type IssueInput, type IssueType, type NoticeIssue } from '@/lib/noticeWorkspace';
import { demandRows, fmtPeriod, monthEnd, monthStart, toMonth, verifyIssue } from '@/lib/noticeReading';
import { fmtDateTime, fmtInr } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const STATUS: Record<string, { label: string; tone: 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  open: { label: 'Open', tone: 'secondary' },
  explained: { label: 'Explained', tone: 'success' },
  pay: { label: 'Pay (DRC-03)', tone: 'warning' },
  contest: { label: 'Contest', tone: 'destructive' },
};

const FAMILY: [string, string][] = [
  ['liability', 'Output tax and liability'], ['itc', 'Input tax credit'], ['interest_fee', 'Interest and late fee'], ['return', 'Returns'],
  ['registration', 'Registration'], ['refund', 'Refunds'], ['procedure', 'Procedure'], ['other', 'Other'],
];

function sourceOf(i: NoticeIssue): { label: string; tone: 'info' | 'warning' | 'success' | 'secondary'; title?: string } {
  if (i.source === 'extracted') {
    return i.verified
      ? { label: 'From the PDF · confirmed', tone: 'success', title: `Confirmed by ${i.verified_by_name || 'staff'} on ${fmtDateTime(i.verified_at)}` }
      : { label: 'Read from the PDF — verify', tone: 'warning', title: 'Read from the notice PDF; not checked by a person yet' };
  }
  if (i.source === 'portal') return { label: 'Portal', tone: 'info', title: 'The demand in the portal\'s case folder' };
  if (i.source === 'form') return { label: 'From the form', tone: 'secondary', title: 'The issue the form itself raises' };
  return { label: 'Typed', tone: 'secondary' };
}

type Editing = IssueInput & { id?: string; seq?: number; origExplained?: number };

const EMPTY: Editing = {
  title: '', detail: null, amount: 0, explained_amount: 0, position: null, annexure: null, status: 'open',
  issue_code: null, period_from: null, period_to: null,
};

const toEditing = (i: NoticeIssue): Editing => ({
  id: i.id, seq: i.seq, title: i.title, detail: i.detail, amount: i.amount, explained_amount: i.explained_amount, position: i.position,
  annexure: i.annexure, status: i.status, issue_code: i.issue_code, period_from: i.period_from, period_to: i.period_to,
  origExplained: Number(i.explained_amount || 0),
});

/** Type, period, detail, where it came from and, for a read issue, its page and words. */
const IssueFacts: React.FC<{ i: NoticeIssue; n: number; type: IssueType | undefined; canEdit: boolean; busy: boolean; onConfirm: () => void }> = ({ i, n, type, canEdit, busy, onConfirm }) => {
  const src = sourceOf(i);
  const period = fmtPeriod(i.period_from, i.period_to);
  return (
    <div className="space-y-0.5">
      {type && type.title !== i.title && <div className="break-words text-xs"><span className="text-muted-foreground">Type: </span>{type.title}</div>}
      {!i.issue_code && ['open', 'contest'].includes(i.status) && <div className="text-xs text-muted-foreground">No issue type yet — set one to get its evidence and documents</div>}
      {(period || i.detail) && <div className="break-words text-xs text-muted-foreground">{[period, i.detail].filter(Boolean).join(' · ')}</div>}
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <Badge variant={src.tone} className="whitespace-nowrap px-1.5 py-0 text-[10px] font-normal" title={src.title}>{src.label}</Badge>
        {canEdit && i.source === 'extracted' && !i.verified && (
          <Button type="button" size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" disabled={busy} onClick={onConfirm}>
            {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}Confirm<span className="sr-only"> issue {n}</span>
          </Button>
        )}
      </div>
      {i.quote && (
        <p className="line-clamp-3 break-words text-[11px] italic text-muted-foreground" title={i.quote}>
          {i.page ? `Page ${i.page}: ` : ''}“{i.quote}”
        </p>
      )}
    </div>
  );
};

const ByHead: React.FC<{ i: NoticeIssue; n: number; open: boolean; onToggle: () => void }> = ({ i, n, open, onToggle }) =>
  demandRows(i.demand).length ? (
    <button type="button" className="text-[11px] font-medium text-primary underline underline-offset-2" aria-expanded={open}
      aria-controls={`issue-demand-${i.id}`} onClick={onToggle}>
      {open ? 'Hide' : 'By head'}<span className="sr-only"> for issue {n}</span>
    </button>
  ) : null;

export const IssuesTab: React.FC<{ noticeId: string; issues: NoticeIssue[]; canEdit: boolean; onChanged: () => void }> = ({ noticeId, issues, canEdit, onChanged }) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const types = useQuery(issueTypesQuery);
  const typeOf = (code: string | null) => (code ? types.data?.find((t) => t.code === code) : undefined);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setShown((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const total = issues.reduce((s, i) => s + Number(i.amount || 0), 0);
  const explained = issues.reduce((s, i) => s + Number(i.explained_amount || 0), 0);
  const cols = canEdit ? 7 : 6;

  const save = async () => {
    if (!editing || !user) return;
    if (!editing.title.trim()) { toast.error('Say what the issue is.'); return; }
    if (Number(editing.explained_amount) > Number(editing.amount)) { toast.error('The explained amount cannot be more than the amount in the notice.'); return; }
    if (editing.period_from && editing.period_to && editing.period_from > editing.period_to) { toast.error('The period starts after it ends.'); return; }
    setSaving(true);
    try {
      const { origExplained, explained_amount, ...rest } = editing;
      // A typed figure is the person's (a recipe leaves it alone); an unchanged one is not written, so a newer recipe figure stays.
      const typed = !editing.id || Number(explained_amount || 0) !== origExplained;
      await saveIssue(noticeId, {
        ...rest, title: editing.title.trim(), seq: editing.seq ?? issues.length + 1,
        ...(typed ? { explained_amount: Number(explained_amount || 0), explained_by: null } : {}),
      }, user);
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

  const confirmIssue = async (i: NoticeIssue) => {
    if (!user) return;
    setBusy(i.id);
    try {
      const done = await verifyIssue(i.id, user);
      toast.success(done ? `Issue confirmed: ${i.title}` : 'Already confirmed.');
      onChanged();
    } catch (e) { toast.error(`Couldn't confirm: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  };

  const pickType = (v: string) => {
    if (!editing) return;
    const code = v === '__none' ? null : v;
    const t = typeOf(code);
    setEditing({ ...editing, issue_code: code, title: editing.title.trim() ? editing.title : t?.title ?? '' });
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
                  <div className="break-words font-medium">{n + 1}. {i.title}</div>
                  <IssueFacts i={i} n={n + 1} type={typeOf(i.issue_code)} canEdit={canEdit} busy={busy === i.id} onConfirm={() => confirmIssue(i)} />
                </div>
                <Badge variant={STATUS[i.status]?.tone ?? 'secondary'} className="shrink-0 text-[11px]">{STATUS[i.status]?.label ?? i.status}</Badge>
              </div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 text-xs">
                <dt className="text-muted-foreground">Per notice</dt><dd className="text-right tabular-nums">{fmtInr(i.amount)}</dd>
                <dt className="text-muted-foreground">Explained{i.explained_by ? ' (evidence)' : ''}</dt>
                <dd className={cn('text-right tabular-nums', Number(i.explained_amount) > 0 && 'font-semibold text-success-strong')}>{fmtInr(i.explained_amount)}</dd>
              </dl>
              <div className="mt-1"><ByHead i={i} n={n + 1} open={shown.has(i.id)} onToggle={() => toggle(i.id)} /></div>
              {shown.has(i.id) && <div id={`issue-demand-${i.id}`} className="mt-1"><DemandTable demand={i.demand} caption={`Demand by head for issue ${n + 1}`} /></div>}
              {i.position && <p className="mt-1.5 break-words text-xs">{i.position}</p>}
              {i.annexure && <div className="mt-1 flex flex-wrap gap-1">{i.annexure.split(/[,;]\s*/).map((a) => <Badge key={a} variant="secondary" className="text-[10px]">{a}</Badge>)}</div>}
              {canEdit && (
                <div className="mt-1.5 flex justify-end gap-1">
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing(toEditing(i))}><Pencil className="mr-1 h-3.5 w-3.5" /> Edit<span className="sr-only"> issue {n + 1}</span></Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => remove(i)}><Trash2 className="mr-1 h-3.5 w-3.5" /> Remove<span className="sr-only"> issue {n + 1}</span></Button>
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
                <React.Fragment key={i.id}>
                  <tr className={WS_TR}>
                    <td className={cn(WS_TD, 'align-top text-muted-foreground')}>{n + 1}</td>
                    <td className={cn(WS_TD, 'min-w-[14rem] align-top')}>
                      <div className="break-words font-medium">{i.title}</div>
                      <IssueFacts i={i} n={n + 1} type={typeOf(i.issue_code)} canEdit={canEdit} busy={busy === i.id} onConfirm={() => confirmIssue(i)} />
                    </td>
                    <td className={cn(WS_TD_NUM, 'align-top')}>
                      <div>{fmtInr(i.amount)}</div>
                      <ByHead i={i} n={n + 1} open={shown.has(i.id)} onToggle={() => toggle(i.id)} />
                    </td>
                    <td className={cn(WS_TD, 'min-w-[14rem] align-top text-xs')}>
                      {i.position || <span className="text-muted-foreground">—</span>}
                      {i.annexure && <div className="mt-0.5 flex flex-wrap gap-1">{i.annexure.split(/[,;]\s*/).map((a) => <Badge key={a} variant="secondary" className="text-[10px]">{a}</Badge>)}</div>}
                    </td>
                    <td className={cn(WS_TD_NUM, 'align-top', Number(i.explained_amount) > 0 && 'font-semibold text-success-strong')}>
                      <div>{fmtInr(i.explained_amount)}</div>
                      {i.explained_by && <div className="text-[11px] font-normal text-muted-foreground" title="Set by an annexure on the Evidence tab; a figure typed here replaces it">from evidence</div>}
                    </td>
                    <td className={cn(WS_TD, 'align-top')}><Badge variant={STATUS[i.status]?.tone ?? 'secondary'} className="text-[11px]">{STATUS[i.status]?.label ?? i.status}</Badge></td>
                    {canEdit && (
                      <td className={cn(WS_TD, 'whitespace-nowrap align-top')}>
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit issue ${n + 1}`} onClick={() => setEditing(toEditing(i))}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove issue ${n + 1}`} onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </td>
                    )}
                  </tr>
                  {shown.has(i.id) && (
                    <tr id={`issue-demand-${i.id}`}>
                      <td className={WS_TD} />
                      <td className={cn(WS_TD, 'bg-muted/20')} colSpan={cols - 1}>
                        <DemandTable demand={i.demand} caption={`Demand by head for issue ${n + 1}`} className="max-w-2xl" />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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
        <Note tone="position" className="flex-1">Positions are the firm's elected defaults for each issue type; the reviewer can override any row. Issues read from the notice PDF are marked "verify" until a person confirms them.</Note>
        {canEdit && issues.length > 0 && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditing({ ...EMPTY })}><Plus className="mr-1 h-3.5 w-3.5" /> Add issue</Button>}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit issue' : 'Add an issue'}</DialogTitle>
            <DialogDescription>What the notice alleges, its type and period, the amount for it, and how much your own data explains.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="issue-type" className="text-xs">Issue type</Label>
                <Select value={editing.issue_code ?? '__none'} onValueChange={pickType}>
                  <SelectTrigger id="issue-type" className="h-9 text-sm"><SelectValue placeholder="Choose the issue type" /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value="__none">No type</SelectItem>
                    {FAMILY.map(([fam, label]) => {
                      const list = (types.data ?? []).filter((t) => t.family === fam && (t.is_active || t.code === editing.issue_code));
                      return list.length ? (
                        <SelectGroup key={fam}>
                          <SelectLabel className="text-xs">{label}</SelectLabel>
                          {list.map((t) => <SelectItem key={t.code} value={t.code}>{t.title}</SelectItem>)}
                        </SelectGroup>
                      ) : null;
                    })}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">The type decides the evidence the Evidence tab builds and the documents asked of the client.</p>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="issue-title" className="text-xs">Issue <span className="text-destructive">*</span></Label>
                <Input id="issue-title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="e.g. ITC claimed in GSTR-3B exceeds GSTR-2B" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="issue-from" className="text-xs">Period from</Label>
                <Input id="issue-from" type="month" value={toMonth(editing.period_from)} className="h-9"
                  onChange={(e) => setEditing({ ...editing, period_from: e.target.value ? monthStart(e.target.value) : null })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="issue-to" className="text-xs">Period to</Label>
                <Input id="issue-to" type="month" value={toMonth(editing.period_to)} className="h-9"
                  onChange={(e) => setEditing({ ...editing, period_to: e.target.value ? monthEnd(e.target.value) : null })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="issue-detail" className="text-xs">Table / detail</Label>
                <Input id="issue-detail" value={editing.detail ?? ''} onChange={(e) => setEditing({ ...editing, detail: e.target.value || null })} placeholder="e.g. Table 4A(5) v 2B" className="h-9" />
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
