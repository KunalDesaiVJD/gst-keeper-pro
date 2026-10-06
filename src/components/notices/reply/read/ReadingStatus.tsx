// The notice PDF and the AI reader (roadmap Phase 4; audit R-08, R-15): the
// latest reading's state and what it did, and "Read the PDF" — disabled with
// the reason when reading is switched off, the client has no consent or opted
// out, there is no PDF, or a read is already queued. Nothing is sent to the
// Claude API from the browser: the office agent reads queued notices.
import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ScanText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import {
  aiDetail, appliedBy, conflictsOf, requestRead, type Extraction, type ReadBlock, type Reading,
} from '@/lib/noticeReading';
import type { NoticeRow } from '@/lib/noticeWorkspace';
import { fmtAgo, fmtDateTime, fmtInr, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const LINK = 'font-medium text-primary underline underline-offset-2';

const CANCELLED: Record<string, string> = {
  off: 'reading was switched off', no_consent: 'the client\'s consent was withdrawn', opted_out: 'the client opted out',
  no_client: 'the client is not on record',
};

const online = (v: boolean | null | undefined) =>
  v ? 'the agent is online now' : v === false ? 'the agent is offline right now' : 'the agent\'s state is not known';

function statusLine(ai: Extraction | null, n: NoticeRow, agentOnline: boolean | null | undefined): { text: string; tone: 'plain' | 'error' } {
  if (!ai) return { text: 'Not read by AI yet.', tone: 'plain' };
  const o = (ai.checks && typeof ai.checks === 'object' && !Array.isArray(ai.checks) ? ai.checks : {}) as Record<string, unknown>;
  switch (ai.status) {
    case 'queued':
      if (ai.not_before && new Date(ai.not_before).getTime() > Date.now()) {
        return { text: `Waiting to try again after ${fmtDateTime(ai.not_before)}${ai.error ? ` — last try: ${ai.error}` : ''}.`, tone: 'plain' };
      }
      return {
        text: `Queued ${fmtAgo(ai.created_at)}${ai.requested_by_name ? ` by ${ai.requested_by_name}` : ' by itself'}. The office agent reads it within minutes when it is running — ${online(agentOnline)}.`,
        tone: 'plain',
      };
    case 'running':
      return { text: `The office agent is reading it now (started ${fmtAgo(ai.claimed_at)}).`, tone: 'plain' };
    case 'failed':
      return { text: `Could not read the PDF${ai.error ? `: ${ai.error}` : ''}. Nothing was changed on the notice.`, tone: 'error' };
    case 'cancelled':
      return { text: `Cancelled before it was read${ai.reason_class ? ` — ${CANCELLED[ai.reason_class] ?? ai.reason_class.replace(/_/g, ' ')}` : ''}.`, tone: 'plain' };
    default: {
      const when = `Read ${fmtAgo(ai.finished_at ?? ai.updated_at)}${ai.pages ? ` · ${plural(ai.pages, 'page')}` : ''}`;
      if (ai.outcome === 'gstin_mismatch') return { text: `${when} — the PDF is addressed to another GSTIN, so nothing was applied.`, tone: 'error' };
      if (ai.outcome === 'nothing_new') return { text: `${when} — nothing new: what it found was already on the notice.`, tone: 'plain' };
      const filled = appliedBy(ai, n).length;
      const added = Number(o.issues_added ?? 0);
      const kept = conflictsOf(ai, n).length;
      if (ai.outcome === 'needs_review') {
        return { text: `${when} — ${plural(filled, 'value')} filled; the issues it found were not added because the notice already has issues someone worked on.`, tone: 'plain' };
      }
      const bits = [plural(filled, 'value') + ' filled', added ? `${plural(added, 'issue')} added` : '', kept ? `${kept} kept as they were` : ''].filter(Boolean);
      return { text: `${when} — ${bits.join(', ')}. Check everything marked "verify".`, tone: 'plain' };
    }
  }
}

function BlockReason({ block }: { block: ReadBlock }) {
  switch (block) {
    case 'off': return <>Reading notices with AI is switched off — a GST manager turns it on in the Reply Factory's <Link to="/notices-reply-factory?tab=ai" className={LINK}>AI reading</Link> tab.</>;
    case 'no_consent': return <>No AI consent is on file for this client — <Link to="/notices-reply-factory?tab=consent" className={LINK}>record the consent</Link> first.</>;
    case 'opted_out': return <>The client opted out of AI processing — see <Link to="/notices-reply-factory?tab=consent" className={LINK}>consent</Link>.</>;
    case 'no_document': return <>There is no PDF of this notice yet — the next portal sync fetches it.</>;
    default: return null;
  }
}

const READ_REASON: Record<string, string> = {
  off: 'Reading notices with AI is switched off.', no_consent: 'No AI consent is on file for this client.',
  opted_out: 'The client opted out of AI processing.', no_document: 'There is no PDF of this notice yet.',
  already: 'A read of this notice is already queued.', no_client: 'The client is not on record.', gone: 'This notice is no longer on record.',
};

export const ReadingStatus: React.FC<{
  notice: NoticeRow;
  reading: Reading | undefined;
  block: ReadBlock | null;
  canEdit: boolean;
  onQueued: () => void;
}> = ({ notice, reading, block, canEdit, onQueued }) => {
  const { user } = useAuth();
  const statusId = useId();
  const reasonId = useId();
  const [busy, setBusy] = useState(false);
  const ai = reading?.ai ?? null;
  const line = statusLine(ai, notice, reading?.status?.agentOnline);
  const lastDone = reading?.aiDone && reading.aiDone.id !== ai?.id ? reading.aiDone : null;
  const { summary, documentsAsked } = aiDetail(reading?.aiDone);
  const readIssues = reading?.aiDone?.outcome === 'needs_review' && Array.isArray(reading.aiDone.issues) ? reading.aiDone.issues : [];

  const read = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const r = await requestRead(notice.id, user);
      if (r.queued) toast.success('Queued. The office agent reads the PDF within minutes when it is running.');
      else toast.info(READ_REASON[r.reason ?? ''] ?? 'Not queued.');
      onQueued();
    } catch (e) {
      toast.error(`Couldn't queue the read: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-2.5 py-2 text-xs">
      <div className="min-w-0 flex-[1_1_16rem] space-y-1">
        <p id={statusId} className={cn('break-words', line.tone === 'error' && 'font-medium text-destructive-strong')}>
          <span className="font-semibold">Notice PDF: </span>{line.text}
          {lastDone && <> Last read {fmtAgo(lastDone.finished_at)}.</>}
        </p>
        {summary && <p className="break-words"><span className="font-semibold">In short: </span>{summary}</p>}
        {documentsAsked.length > 0 && (
          <p className="break-words"><span className="font-semibold">The notice asks for: </span>{documentsAsked.join('; ')}</p>
        )}
        {readIssues.length > 0 && <p className="font-semibold">Issues it read, not added — compare them with the Issues tab:</p>}
        {readIssues.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4">
            {readIssues.slice(0, 6).map((raw, i) => {
              const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
              return <li key={i} className="break-words">{String(o.title ?? `Issue ${i + 1}`)}{o.amount ? ` · ${fmtInr(Number(o.amount))}` : ''}</li>;
            })}
          </ul>
        )}
        {block && block !== 'already' && <p id={reasonId} className="break-words text-muted-foreground"><BlockReason block={block} /></p>}
      </div>
      {canEdit && (
        <Button type="button" size="sm" variant="outline" className={cn(WS_BTN, 'shrink-0')} disabled={!!block || busy}
          aria-describedby={block && block !== 'already' ? `${statusId} ${reasonId}` : statusId} onClick={read}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ScanText className="h-3.5 w-3.5" aria-hidden />}
          {reading?.aiDone ? 'Read the PDF again' : 'Read the PDF'}
        </Button>
      )}
    </div>
  );
};

export default ReadingStatus;
