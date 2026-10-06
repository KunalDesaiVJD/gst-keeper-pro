// The signature block every reply ends with (notice_settings.reply_place and
// reply_signatory; contract §B). A GST manager or the superadmin sets it;
// everyone else reads it. Saving it prepares the replies of every open notice
// again (trg_notice_settings_reply_options), so the toast says so. The no dash
// rule holds here too: the database refuses a dash in either field.
import React, { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { LoadError } from '@/components/notices/autopilot/parts';
import {
  dehyphen, findDashes, invalidateReplyTemplates, placeholderProblems, saveReplySignature, useReplySignature, type Actor,
} from '@/lib/replyFactory';
import { DashCheck, PlaceholderCheck } from './TextChecks';

export const SignatureCard: React.FC<{ canEdit: boolean; actor: Actor | null }> = ({ canEdit, actor }) => {
  const uid = useId();
  const qc = useQueryClient();
  const q = useReplySignature();
  const [place, setPlace] = useState('');
  const [signatory, setSignatory] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setPlace(q.data.reply_place ?? '');
    setSignatory(q.data.reply_signatory ?? '');
  }, [q.data]);

  const hits = [...findDashes(place, 'Place'), ...findDashes(signatory, 'Signatory')];
  const problems = [...placeholderProblems(place, 'Place', false), ...placeholderProblems(signatory, 'Signatory', false)];
  const changed = !!q.data && (place.trim() !== (q.data.reply_place ?? '') || signatory.trim() !== (q.data.reply_signatory ?? ''));

  const save = async () => {
    setSaving(true);
    try {
      await saveReplySignature({ reply_place: place, reply_signatory: signatory }, actor);
      toast.success('Signature block saved. The replies prepared for every open notice now carry it; drafts already started keep their own text.');
      qc.invalidateQueries({ queryKey: ['reply-factory', 'signature'] });
      invalidateReplyTemplates(qc);
    } catch (e) {
      toast.error(`Not saved. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Signature block"
      description={canEdit
        ? 'Every reply ends with this place and signatory. Saving writes the replies prepared for every open notice again.'
        : 'Every reply ends with this place and signatory. Only a GST manager or the superadmin changes them.'}>
      {q.error ? <LoadError what="the signature block" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <Skeleton className="h-16 w-full" />
        : !canEdit ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Place</dt>
              <dd>{q.data?.reply_place || <span className="text-foreground/70">Not set: replies show [place]</span>}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Signatory</dt>
              <dd className="whitespace-pre-line">{q.data?.reply_signatory || <span className="text-foreground/70">Not set: replies show Authorised Signatory</span>}</dd>
            </div>
          </dl>
        ) : (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (!hits.length && !problems.length && changed) save(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`${uid}-place`}>Place</Label>
                <Input id={`${uid}-place`} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="[place]" maxLength={120}
                  aria-describedby={`${uid}-place-hint`} className="h-9 text-sm" />
                <p id={`${uid}-place-hint`} className="text-xs text-muted-foreground">The city the replies are signed at. Left blank, replies show [place].</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${uid}-sig`}>Signatory</Label>
                <Textarea id={`${uid}-sig`} value={signatory} onChange={(e) => setSignatory(e.target.value)} rows={2} placeholder="Authorised Signatory"
                  maxLength={400} aria-describedby={`${uid}-sig-hint`} className="text-sm" />
                <p id={`${uid}-sig-hint`} className="text-xs text-muted-foreground">One or more lines under "For" and the client's name. Left blank, replies show Authorised Signatory.</p>
              </div>
            </div>
            <DashCheck hits={hits} disabled={saving}
              onReplace={() => { setPlace((v) => dehyphen(v)); setSignatory((v) => dehyphen(v)); }} />
            <PlaceholderCheck problems={problems} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {changed && (
                <Button type="button" size="sm" variant="ghost" className={WS_BTN} disabled={saving}
                  onClick={() => { setPlace(q.data?.reply_place ?? ''); setSignatory(q.data?.reply_signatory ?? ''); }}>
                  Undo changes
                </Button>
              )}
              <Button type="submit" size="sm" className={WS_BTN} disabled={saving || !changed || hits.length > 0 || problems.length > 0}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Save the signature block
              </Button>
            </div>
          </form>
        )}
    </SectionCard>
  );
};

export default SignatureCard;
