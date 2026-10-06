import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import {
  createMatter, fetchMatters, isMatterOpen, LIFECYCLES, lifecycleForForm, lifecycleLabel, linkNoticesToMatter, matterMoney, type LitigationMatter,
} from '@/lib/litigationData';
import { fmtFy, fmtInrShort, noticeTitle } from '@/lib/noticeFormat';
import { stageLabel, type StageKey } from '@/lib/noticeStages';
import type { NoticeRef } from './NoticeContext';

/** The lifecycle a matter opened from this form usually has (a DRC-07 order is usually appealed). */
function lifecycleFor(n: NoticeRef): string {
  const t = `${n.form_code ?? ''} ${n.notice_type ?? ''} ${n.description ?? ''}`;
  return /DRC-07/i.test(t) ? 'appeal' : lifecycleForForm(t);
}
const forumFor = (lifecycle: string) => (lifecycle === 'appeal' ? 'appellate' : lifecycle === 'tribunal' ? 'tribunal' : 'adjudicating');
const noticeLabel = (n: NoticeRef) => [n.form_code, n.reference_number || n.case_id].filter(Boolean).join(' ') || noticeTitle(n);

/**
 * Create a matter from the notice, or add the notice to an existing matter of
 * the same client (audit U-45-1/2): pre-filled title, lifecycle and demand;
 * the same case's matters listed first; confirmed with a toast that opens it.
 */
export const MatterDialog: React.FC<{
  notice: NoticeRef & { stage?: string | null };
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}> = ({ notice, open, onOpenChange, onDone }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [title, setTitle] = useState('');
  const [lifecycle, setLifecycle] = useState('demand');
  const [tax, setTax] = useState<number | null>(null);
  const [interest, setInterest] = useState<number | null>(null);
  const [penalty, setPenalty] = useState<number | null>(null);
  const [matters, setMatters] = useState<LitigationMatter[] | null>(null);
  const [existing, setExisting] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('new');
    setTitle(noticeTitle(notice));
    setLifecycle(lifecycleFor(notice));
    setTax(notice.amount_of_demand ?? null);
    setInterest(null);
    setPenalty(null);
    setExisting('');
    setMatters(null);
    fetchMatters({ clientId: notice.client_id }).then(({ data }) => {
      const open = (data ?? []).filter(isMatterOpen);
      setMatters(open);
      if (open.length) setExisting(open[0].id);
    });
  }, [open, notice]);

  const done = (matterId: string, matterNo: string, created: boolean) => {
    toast.success(`${created ? 'Matter' : 'Added to matter'} ${matterNo}`, {
      action: { label: 'Open', onClick: () => navigate(`/litigation/${matterId}`) },
    });
    onOpenChange(false);
    onDone();
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      if (mode === 'existing') {
        const m = matters?.find((x) => x.id === existing);
        if (!m) return;
        const { error } = await linkNoticesToMatter(m.id, [notice.id], user, [noticeLabel(notice)]);
        if (error) throw error;
        done(m.id, m.matter_no, false);
        return;
      }
      const stage = (notice.stage && notice.stage !== 'closed' ? notice.stage : 'triaged') as StageKey;
      const fy = fmtFy(notice.financial_year);
      const { data, error } = await createMatter({
        client_id: notice.client_id, lifecycle, title: title.trim() || noticeTitle(notice), stage,
        financial_years: fy ? [fy] : null, authority: forumFor(lifecycle),
        demand_tax: tax ?? 0, demand_interest: interest ?? 0, demand_penalty: penalty ?? 0,
        computed_due_date: notice.effective_due ?? null, owner_user_id: user.id,
      }, user.id, user.firstName);
      if (error || !data) throw error ?? new Error('The matter was not created');
      const link = await linkNoticesToMatter(data.id, [notice.id], user, [noticeLabel(notice)]);
      if (link.error) throw link.error;
      done(data.id, data.matter_no, true);
    } catch (e) {
      toast.error(`Couldn't save the matter: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Litigation matter · {notice.client_name}</DialogTitle>
          <DialogDescription>{notice.reference_number || notice.case_id || 'No reference'} · {noticeTitle(notice)}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'new' | 'existing')} className="flex flex-wrap gap-4">
          <Label className="flex items-center gap-2 text-xs font-normal"><RadioGroupItem value="new" /> New matter</Label>
          <Label className="flex items-center gap-2 text-xs font-normal">
            <RadioGroupItem value="existing" disabled={!matters?.length} /> Add to an existing matter{matters ? ` (${matters.length})` : ''}
          </Label>
        </RadioGroup>
        {mode === 'new' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="matter-title" className="text-xs">Title</Label>
              <Input id="matter-title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="matter-lifecycle" className="text-xs">Type</Label>
              <Select value={lifecycle} onValueChange={setLifecycle}>
                <SelectTrigger id="matter-lifecycle" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{LIFECYCLES.map((l) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="matter-tax" className="text-xs">Tax in dispute (₹)</Label>
              <NumberInput id="matter-tax" value={tax ?? ''} onChange={(e) => setTax(e.target.value === '' ? null : Number(e.target.value))} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="matter-interest" className="text-xs">Interest (₹)</Label>
              <NumberInput id="matter-interest" value={interest ?? ''} onChange={(e) => setInterest(e.target.value === '' ? null : Number(e.target.value))} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="matter-penalty" className="text-xs">Penalty (₹)</Label>
              <NumberInput id="matter-penalty" value={penalty ?? ''} onChange={(e) => setPenalty(e.target.value === '' ? null : Number(e.target.value))} className="h-9" />
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="matter-existing" className="text-xs">Matter</Label>
            <Select value={existing} onValueChange={setExisting}>
              <SelectTrigger id="matter-existing" className="h-9 text-sm"><SelectValue placeholder="Pick a matter" /></SelectTrigger>
              <SelectContent>
                {(matters ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.matter_no} · {m.title || lifecycleLabel(m.lifecycle)} · {stageLabel(m.stage)} · {fmtInrShort(matterMoney(m).outstanding)} outstanding
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || (mode === 'existing' && !existing)}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {mode === 'new' ? 'Create matter' : 'Add to matter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MatterDialog;
