// The matter's history (audit U-88-1..4): readable sentences by IST day, an
// icon per kind of event, filters (stage · hearings · money · documents ·
// notes · the linked notices' own events), and a note box. It reloads with
// the page after every action, so its count never goes stale.
import React, { useState } from 'react';
import { CalendarClock, FileText, Flag, IndianRupee, Loader2, MessageSquare, Scale, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { describeEvent } from '@/lib/noticeEventText';
import { fmtDate } from '@/lib/noticeFormat';
import { addMatterNote, istDate, type MatterWorkspace } from '@/lib/litigationData';
import { describeMatterEvent, eventGroup, type EventGroup } from './matterEventText';
import { noticeLabel } from './MatterNoticesTab';
import { cn } from '@/lib/utils';

type Filter = 'all' | EventGroup | 'notices';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'stage', label: 'Stage' }, { key: 'hearing', label: 'Hearings' }, { key: 'money', label: 'Money' },
  { key: 'documents', label: 'Documents' }, { key: 'notes', label: 'Notes' }, { key: 'notices', label: 'Notices' },
];
const ICON: Record<string, React.ElementType> = {
  stage: Flag, hearing: CalendarClock, money: IndianRupee, documents: FileText, notes: MessageSquare, other: ScrollText, notices: Scale,
};

interface Line { id: string; at: string; group: Filter; title: string; detail?: string; who: string }

export const MatterActivityTab: React.FC<{ ws: MatterWorkspace; canEdit: boolean; onChanged: () => void }> = ({ ws, canEdit, onChanged }) => {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const notices = new Map(ws.notices.map((n) => [n.id as string, n]));
  const lines: Line[] = [
    ...ws.events.map((e) => { const d = describeMatterEvent(e); return { id: e.id, at: e.created_at, group: eventGroup(e.event_type) as Filter, ...d, who: e.actor_name ?? 'System' }; }),
    ...ws.noticeEvents.map((e) => {
      const d = describeEvent(e);
      const n = notices.get(e.notice_id);
      return { id: `n-${e.id}`, at: e.created_at, group: 'notices' as Filter, title: `${n ? noticeLabel(n) : 'Notice'}: ${d.title}`, detail: d.detail, who: e.actor_name ?? '' };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const shown = lines.filter((l) => filter === 'all' || l.group === filter);
  const days = new Map<string, Line[]>();
  shown.forEach((l) => { const d = istDate(l.at); days.set(d, [...(days.get(d) ?? []), l]); });

  const save = async () => {
    if (!user || !text.trim()) return;
    setSaving(true);
    try { await addMatterNote(ws.matter.id, text.trim(), user); setText(''); onChanged(); }
    catch (e) { toast.error(`Couldn't save the note: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="space-y-1.5">
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Note" className="text-sm"
            placeholder="Add a note — a call with the officer, what the client said, a decision taken…" />
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" disabled={!text.trim() || saving} onClick={save}>{saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Add note</Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {FILTERS.map((f) => {
          const n = f.key === 'all' ? lines.length : lines.filter((l) => l.group === f.key).length;
          return (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
              className={cn('inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}>
              {f.label} <span className="tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded{filter === 'all' ? ' yet' : ' of this kind'}.</p> : (
        <ol className="space-y-3">
          {[...days.entries()].map(([day, list]) => (
            <li key={day}>
              <h4 className="mb-1 text-xs font-semibold text-foreground/70">{fmtDate(day)}</h4>
              <ul className="space-y-2 border-l pl-3">
                {list.map((l) => {
                  const Icon = ICON[l.group] ?? ScrollText;
                  return (
                    <li key={l.id} className="relative flex gap-2 text-sm">
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0">
                        <span className={cn(l.group === 'notes' && 'font-medium')}>{l.title}</span>
                        {l.detail && <span className={cn('block break-words text-xs', l.group === 'notes' ? 'whitespace-pre-wrap text-foreground' : 'text-muted-foreground')}>{l.detail}</span>}
                        <span className="block text-[11px] text-muted-foreground">
                          {new Date(l.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })} IST
                        </span>
                      </span>
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
