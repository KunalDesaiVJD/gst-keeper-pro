// The matter page's right rail (audit U-84-1, U-84-5, U-86-4): the next step
// said once with one button, and the key facts — client, type, forum,
// jurisdiction, officer, section, years, when it was opened, the team, the
// appeal chain — with the next action editable in place.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SectionCard } from '@/components/gstr9/ui';
import { useAuth } from '@/contexts/AuthContext';
import { daysBetween, istToday } from '@/lib/noticeFacts';
import { fmtDate, plural } from '@/lib/noticeFormat';
import { editMatterDetails, forumLabel, istDate, jurisdictionText, lifecycleLabel, type MatterWorkspace } from '@/lib/litigationData';
import { ClockCell } from './ClockCell';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** The appeal chain from the logs (no parent column yet): where it came from and where it went. */
export function appealLinks(ws: MatterWorkspace) {
  const created = ws.events.find((e) => e.event_type === 'created');
  const from = created && obj(created.payload).from_matter_id ? { id: String(obj(created.payload).from_matter_id), no: String(obj(created.payload).from_matter_no ?? 'the matter') } : null;
  const to = ws.events.filter((e) => e.event_type === 'appeal_started').map((e) => ({ id: String(obj(e.payload).child_id), no: String(obj(e.payload).child_no ?? 'appeal') }));
  return { from, to };
}

const Row: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
  <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1 text-xs">
    <dt className="text-muted-foreground">{k}</dt>
    <dd className="min-w-0 break-words font-medium">{children}</dd>
  </div>
);

export const NextStepCard: React.FC<{ ws: MatterWorkspace; hint: string; action: React.ReactNode }> = ({ ws, hint, action }) => {
  const open = ws.clocks.length > 0 || ws.matter.stage !== 'closed';
  return (
    <SectionCard title="Next step" description={hint}>
      {open && ws.matter.stage !== 'closed' && <ClockCell clock={ws.clocks[0] ?? null} open />}
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </SectionCard>
  );
};

export const KeyFacts: React.FC<{ ws: MatterWorkspace; canEdit: boolean; ownerName: string | null; reviewerName: string | null; onChanged: () => void }> = ({ ws, canEdit, ownerName, reviewerName, onChanged }) => {
  const { user } = useAuth();
  const m = ws.matter;
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState(m.next_action ?? '');
  const [saving, setSaving] = useState(false);
  const opened = istDate(m.created_at);
  const chain = appealLinks(ws);
  const saveNext = async () => {
    if (!user) return;
    setSaving(true);
    try { await editMatterDetails(m, { next_action: next.trim() || null }, user); setEditing(false); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return (
    <SectionCard title="Key facts">
      <dl className="divide-y">
        <Row k="Client"><Link to={`/notices-company/${m.client_id}`} className="text-primary underline underline-offset-2">{ws.client?.name ?? 'Client'}</Link></Row>
        <Row k="GSTIN"><span className="font-mono">{ws.client?.gstin ?? '—'}</span></Row>
        <Row k="Type">{lifecycleLabel(m.lifecycle)}</Row>
        <Row k="Forum">{forumLabel(m)}</Row>
        <Row k="Jurisdiction">{jurisdictionText(m) || '—'}</Row>
        <Row k="Officer">{m.officer || '—'}</Row>
        <Row k="Section">{m.section_of_law || '—'}</Row>
        <Row k="Financial years">{(m.financial_years ?? []).join(', ') || '—'}</Row>
        <Row k="Opened">{fmtDate(opened)} · {plural(daysBetween(opened, istToday()), 'day')} ago</Row>
        <Row k="Owner">{ownerName ?? 'Nobody yet'}</Row>
        <Row k="Reviewer">{reviewerName ?? '—'}</Row>
        {chain.from && <Row k="Appeal from"><Link to={`/litigation/${chain.from.id}`} className="text-primary underline underline-offset-2">{chain.from.no}</Link></Row>}
        {chain.to.length > 0 && <Row k="Appealed in">{chain.to.map((t, i) => <React.Fragment key={t.id}>{i > 0 && ', '}<Link to={`/litigation/${t.id}`} className="text-primary underline underline-offset-2">{t.no}</Link></React.Fragment>)}</Row>}
        <Row k="Next action">
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
        </Row>
      </dl>
    </SectionCard>
  );
};
