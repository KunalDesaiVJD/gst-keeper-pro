import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { addComment, type NoticeEvent, type NoticeRow } from '@/lib/noticeWorkspace';
import { describeEvent } from '@/lib/noticeEventText';
import { fmtDate, fmtDateTime } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

/** Everything that happened to the notice, newest first, from the database's event log; plus notes. */
export const ActivityTab: React.FC<{ notice: NoticeRow; events: NoticeEvent[]; canEdit: boolean; onChanged: () => void }> = ({ notice, events, canEdit, onChanged }) => {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!user || !text.trim()) return;
    setSaving(true);
    try { await addComment(notice, text.trim(), user); setText(''); onChanged(); }
    catch (e) { toast.error(`Couldn't save the note: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };

  const days = new Map<string, NoticeEvent[]>();
  events.forEach((e) => {
    const d = new Date(e.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    days.set(d, [...(days.get(d) ?? []), e]);
  });

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="space-y-1.5">
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note — a call with the officer, what the client said…" aria-label="Note" className="text-sm" />
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" disabled={!text.trim() || saving} onClick={save}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Add note
            </Button>
          </div>
        </div>
      )}
      {events.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
        <ol className="space-y-3">
          {[...days.entries()].map(([day, list]) => (
            <li key={day}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{fmtDate(day)}</div>
              <ul className="space-y-1.5 border-l pl-3">
                {list.map((e) => {
                  const d = describeEvent(e);
                  return (
                    <li key={e.id} className="relative text-sm">
                      <span aria-hidden className={cn('absolute -left-[17px] top-1.5 h-2 w-2 rounded-full',
                        e.source === 'staff' ? 'bg-primary' : e.source === 'sync' ? 'bg-info' : 'bg-muted-foreground/50')} />
                      <span className={cn(e.event_type === 'comment' && 'font-medium')}>{d.title}</span>
                      {d.detail && <span className={cn('block text-xs', e.event_type === 'comment' ? 'whitespace-pre-wrap text-foreground' : 'text-muted-foreground')}>{d.detail}</span>}
                      <span className="block text-[11px] text-muted-foreground">{fmtDateTime(e.created_at).split(', ')[1]}{e.source && e.source !== 'staff' ? ` · ${e.source}` : ''}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default ActivityTab;
