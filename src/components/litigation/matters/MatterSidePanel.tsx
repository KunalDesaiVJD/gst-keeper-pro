// The matter at a glance (audit U-84-1, U-84-5, U-86-4; rebalanced 7 October
// 2026 into one panel across the page): the next step's hint and clock, and the
// key facts — type, forum, jurisdiction, officer, section, years, when it was
// opened, the appeal chain — with the next action editable in place.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Panel } from '@/components/notices/ui/Panel';
import { useAuth } from '@/contexts/AuthContext';
import { daysBetween, istToday } from '@/lib/noticeFacts';
import { fmtDate, plural } from '@/lib/noticeFormat';
import { editMatterDetails, forumLabel, istDate, jurisdictionText, lifecycleLabel, type MatterWorkspace } from '@/lib/litigationData';
import { ClockCell } from './ClockCell';
import { cn } from '@/lib/utils';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** The appeal chain from the logs (no parent column yet): where it came from and where it went. */
export function appealLinks(ws: MatterWorkspace) {
  const created = ws.events.find((e) => e.event_type === 'created');
  const from = created && obj(created.payload).from_matter_id ? { id: String(obj(created.payload).from_matter_id), no: String(obj(created.payload).from_matter_no ?? 'the matter') } : null;
  const to = ws.events.filter((e) => e.event_type === 'appeal_started').map((e) => ({ id: String(obj(e.payload).child_id), no: String(obj(e.payload).child_no ?? 'appeal') }));
  return { from, to };
}

/** One fact: its label above, its value below (a grid of these fills a row). */
const Fact: React.FC<{ k: string; wide?: boolean; children: React.ReactNode }> = ({ k, wide, children }) => (
  <div className={cn('min-w-0', wide && 'col-span-2')}>
    <dt className="text-[11px] text-muted-foreground">{k}</dt>
    <dd className="min-w-0 break-words text-sm font-medium">{children}</dd>
  </div>
);

/**
 * The matter at a glance, one panel across the page (rebalanced 7 October 2026:
 * no right column; client, GSTIN, owner and reviewer are in the header). The
 * next step's hint and clock sit in its title row; the header carries its button.
 */
export const MatterFacts: React.FC<{ ws: MatterWorkspace; hint: string; canEdit: boolean; onChanged: () => void }> = ({ ws, hint, canEdit, onChanged }) => {
  const { user } = useAuth();
  const m = ws.matter;
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState(m.next_action ?? '');
  const [saving, setSaving] = useState(false);
  const opened = istDate(m.created_at);
  const chain = appealLinks(ws);
  const open = m.stage !== 'closed';
  const saveNext = async () => {
    if (!user) return;
    setSaving(true);
    try { await editMatterDetails(m, { next_action: next.trim() || null }, user); setEditing(false); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return (
    <Panel title={open ? `Next: ${hint}` : 'At a glance'}
      actions={open && ws.clocks[0] ? <ClockCell clock={ws.clocks[0]} open /> : undefined}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Fact k="Type">{lifecycleLabel(m.lifecycle)}</Fact>
        <Fact k="Forum">{forumLabel(m)}</Fact>
        <Fact k="Jurisdiction">{jurisdictionText(m) || '—'}</Fact>
        <Fact k="Officer">{m.officer || '—'}</Fact>
        <Fact k="Section">{m.section_of_law || '—'}</Fact>
        <Fact k="Financial years">{(m.financial_years ?? []).join(', ') || '—'}</Fact>
        <Fact k="Opened">{fmtDate(opened)} · {plural(daysBetween(opened, istToday()), 'day')} ago</Fact>
        {chain.from && <Fact k="Appeal from"><Link to={`/litigation/${chain.from.id}`} className="text-primary underline underline-offset-2">{chain.from.no}</Link></Fact>}
        {chain.to.length > 0 && <Fact k="Appealed in">{chain.to.map((t, i) => <React.Fragment key={t.id}>{i > 0 && ', '}<Link to={`/litigation/${t.id}`} className="text-primary underline underline-offset-2">{t.no}</Link></React.Fragment>)}</Fact>}
        <Fact k="Next action" wide>
          {editing ? (
            <span className="block space-y-1">
              <Textarea rows={2} value={next} onChange={(e) => setNext(e.target.value)} aria-label="Next action" className="text-xs font-normal" />
              <span className="flex gap-1">
                <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={saveNext}>{saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Save</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditing(false); setNext(m.next_action ?? ''); }}>Cancel</Button>
              </span>
            </span>
          ) : (
            <span className="flex items-start gap-1">
              <span className="min-w-0 flex-1">{m.next_action || <span className="font-normal text-muted-foreground">not set</span>}</span>
              {canEdit && (
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => { setNext(m.next_action ?? ''); setEditing(true); }} aria-label="Edit the next action">
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
            </span>
          )}
        </Fact>
      </dl>
    </Panel>
  );
};
