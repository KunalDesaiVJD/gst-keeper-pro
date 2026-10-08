// The notice page's Assistant tab (Notices Phase 7): the Notice Response AI
// Assistant drafts a reply part for each issue, rewrites a text in the firm's
// style, or answers a question, from the notice, its case's documents as read
// and the firm's own past answers an admin chose to keep (Reply Factory,
// Learning). Staff edit what it wrote before using it; what they use, as
// edited, becomes the firm's example for the next notice of the kind.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, FileInput, History, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN, WS_CONTROL } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { saveDraft, type Workspace } from '@/lib/noticeWorkspace';
import { fmtAgo } from '@/lib/noticeFormat';
import {
  askAssistant, assistExamples, assistFeedback, assistOutput, assistRunsKey, caseDocsKey, loadAssistRuns, loadCaseDocuments,
  PAIR_ORIGIN, requestCaseDocuments, type AssistExample, type AssistMode, type AssistRun,
} from '@/lib/noticeAi';
import { cn } from '@/lib/utils';

interface Part { issue_seq: number; heading: string; text: string; examples: string[]; keep: boolean }

const MODES: { key: AssistMode; label: string }[] = [
  { key: 'draft', label: 'Draft reply' },
  { key: 'improve', label: 'Improve text' },
  { key: 'ask', label: 'Ask' },
];

const usd = (n: number | null | undefined) => (n ? `$${Number(n).toFixed(2)}` : null);

/** "E2" chip: the firm's past answer it drew on. */
const ExampleChip: React.FC<{ n: number; ex: AssistExample | undefined }> = ({ n, ex }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="rounded border border-primary/30 bg-primary/5 px-1.5 text-[11px] font-medium text-primary hover:bg-primary/10">E{n}</button>
    </PopoverTrigger>
    <PopoverContent className="w-[26rem] max-w-[90vw] space-y-2 text-xs" align="start">
      {ex ? (
        <>
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary" className="text-[10px]">{PAIR_ORIGIN[ex.origin] ?? ex.origin}</Badge>
            {ex.form_code && <Badge variant="secondary" className="text-[10px]">{ex.form_code}</Badge>}
            {ex.issue_code && ex.issue_code !== 'OTHER' && <Badge variant="secondary" className="text-[10px]">{ex.issue_code}</Badge>}
          </div>
          <p className="line-clamp-4 text-muted-foreground">{ex.allegation}</p>
          <p className="line-clamp-[8] whitespace-pre-wrap">{ex.response}</p>
        </>
      ) : <p className="text-muted-foreground">This example is no longer kept.</p>}
    </PopoverContent>
  </Popover>
);

export const AssistantTab: React.FC<{ ws: Workspace; canEdit: boolean; onChanged: () => void; onOpenDraft: () => void }> = ({ ws, canEdit, onChanged, onOpenDraft }) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const n = ws.notice;
  const [mode, setMode] = useState<AssistMode>('draft');
  const [issueId, setIssueId] = useState<string>('all');
  const [question, setQuestion] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[]>([]);

  const runs = useQuery({ queryKey: assistRunsKey(n.id), queryFn: () => loadAssistRuns(n.id) });
  const docs = useQuery({ queryKey: caseDocsKey(n.id), queryFn: () => loadCaseDocuments(n.client_id, n.case_id, n.id) });
  const run: AssistRun | undefined = useMemo(() => (runs.data ?? []).find((r) => r.id === shown) ?? (shown ? undefined : runs.data?.[0]), [runs.data, shown]);
  const out = useMemo(() => assistOutput(run), [run]);
  const examples = useMemo(() => assistExamples(run), [run]);
  const exIndex = useMemo(() => new Map(examples.map((e, i) => [e.id, i + 1])), [examples]);

  useEffect(() => {
    setParts(out.paragraphs.map((p) => ({ issue_seq: p.issue_seq, heading: p.heading, text: p.text, examples: p.examples_used, keep: true })));
  }, [run?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const docsRead = (docs.data ?? []).filter((d) => d.status === 'done').length;
  const docsAll = (docs.data ?? []).filter((d) => d.status !== 'cancelled' && d.status !== 'skipped').length;
  const docsWaiting = (docs.data ?? []).filter((d) => d.status === 'queued' || d.status === 'running').length;

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await askAssistant({
        noticeId: n.id, mode, issueId: mode === 'draft' && issueId !== 'all' ? issueId : null,
        question: mode === 'ask' ? question : null, text: mode === 'improve' ? text : null, actor: user?.firstName ?? null,
      });
      if (r.error) setError(r.error);
      if (r.run) setShown(r.run.id);
      await qc.invalidateQueries({ queryKey: assistRunsKey(n.id) });
    } finally {
      setBusy(false);
    }
  };

  const chosen = parts.filter((p) => p.keep && p.text.trim());
  const block = chosen.map((p) => [p.heading.trim(), p.text.trim()].filter(Boolean).join('\n')).join('\n\n');

  const useInDraft = async () => {
    if (!run || !user || !chosen.length) return;
    setSaving(true);
    try {
      const latest = ws.drafts[0] ?? null;
      const body = latest?.body?.trim() ? `${latest.body.trim()}\n\n${block}` : block;
      await saveDraft(n.id, body, latest, { id: user.id, firstName: user.firstName });
      const kept = await assistFeedback(run.id, 'used', chosen.map((p) => ({
        issue_id: ws.issues.find((i) => i.seq === p.issue_seq)?.id ?? null, text: [p.heading.trim(), p.text.trim()].filter(Boolean).join('\n'),
      })), user.firstName ?? null);
      toast.success(`Added to the draft${kept ? `; ${kept} part${kept === 1 ? '' : 's'} kept as the firm's example` : ''}.`);
      await qc.invalidateQueries({ queryKey: assistRunsKey(n.id) });
      onChanged();
      onOpenDraft();
    } catch (e) {
      toast.error(`Couldn't add it to the draft: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    if (!run) return;
    await assistFeedback(run.id, 'discarded', [], user?.firstName ?? null).catch(() => 0);
    await qc.invalidateQueries({ queryKey: assistRunsKey(n.id) });
  };

  const copy = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast.success('Copied.'); } catch { toast.error("Couldn't copy."); }
  };

  const readNow = async () => {
    try {
      const k = await requestCaseDocuments(n.id);
      toast.success(k ? `${k} document${k === 1 ? '' : 's'} moved to the front of the queue.` : 'Nothing is waiting to be read.');
      qc.invalidateQueries({ queryKey: caseDocsKey(n.id) });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  const disabled = busy || (mode === 'ask' && !question.trim()) || (mode === 'improve' && !text.trim());
  const runMode = (run?.mode ?? 'draft') as AssistMode;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as AssistMode)} className="rounded-md border p-0.5" aria-label="What the assistant does">
          {MODES.map((m) => (
            <ToggleGroupItem key={m.key} value={m.key} className="h-7 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{m.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        {mode === 'draft' && (
          <Select value={issueId} onValueChange={setIssueId}>
            <SelectTrigger className={cn(WS_CONTROL, 'w-56')} aria-label="Issue"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All issues{ws.issues.length ? ` (${ws.issues.length})` : ''}</SelectItem>
              {ws.issues.map((i) => <SelectItem key={i.id} value={i.id} className="text-xs">{i.seq}. {i.title}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" className={WS_BTN} disabled={disabled} onClick={ask}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {mode === 'draft' ? 'Draft' : mode === 'improve' ? 'Improve' : 'Ask'}
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Case documents read {docsRead}/{docsAll}{docsWaiting ? ` · ${docsWaiting} waiting` : ''}
          {canEdit && docsWaiting > 0 && <button type="button" onClick={readNow} className="ml-1 font-medium text-primary hover:underline">Read now</button>}
        </span>
      </div>

      {mode === 'ask' && (
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about this notice, e.g. which documents does it ask for?"
          className="h-8 text-sm" onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) ask(); }} aria-label="Question" />
      )}
      {mode === 'improve' && (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Paste the text to rewrite in the firm's style" className="text-sm" aria-label="Text to improve" />
      )}

      {busy && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the notice, its documents and the firm's examples. This takes up to a minute or two.</p>}
      {error && <Note tone="warn">{error}</Note>}

      {!busy && run && run.status === 'done' && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{MODES.find((m) => m.key === runMode)?.label ?? runMode}</span>
            <span>{fmtAgo(run.created_at)}{run.requested_by_name ? ` by ${run.requested_by_name}` : ''}</span>
            {usd(run.cost_usd) && <span>{usd(run.cost_usd)}</span>}
            {examples.length > 0 ? <span>{examples.length} example{examples.length === 1 ? '' : 's'} given</span> : <span>no examples kept yet</span>}
            {run.feedback && <Badge variant={run.feedback === 'used' ? 'success' : 'secondary'} className="text-[10px]">{run.feedback === 'used' ? 'Used' : 'Discarded'}</Badge>}
          </div>

          {runMode === 'ask' ? (
            <div className="space-y-2">
              {run.question && <p className="text-xs text-muted-foreground">{run.question}</p>}
              <p className="whitespace-pre-wrap text-sm">{out.answer}</p>
              <Button size="sm" variant="outline" className={WS_BTN} onClick={() => copy(out.answer)}><Copy className="h-3.5 w-3.5" /> Copy</Button>
            </div>
          ) : (
            <>
              {parts.map((p, k) => (
                <div key={k} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={p.keep} onCheckedChange={(v) => setParts((ps) => ps.map((x, j) => (j === k ? { ...x, keep: !!v } : x)))} aria-label="Use this part" />
                    <Input value={p.heading} onChange={(e) => setParts((ps) => ps.map((x, j) => (j === k ? { ...x, heading: e.target.value } : x)))}
                      className="h-7 flex-1 border-0 px-1 text-sm font-semibold shadow-none focus-visible:ring-1" aria-label="Heading" />
                    <div className="flex gap-1">{p.examples.map((id) => exIndex.has(id) && <ExampleChip key={id} n={exIndex.get(id)!} ex={examples.find((e) => e.id === id)} />)}</div>
                  </div>
                  <Textarea value={p.text} onChange={(e) => setParts((ps) => ps.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)))}
                    rows={Math.min(14, Math.max(4, Math.ceil(p.text.length / 110)))} className="text-sm leading-relaxed" aria-label={`Part ${k + 1}`} />
                </div>
              ))}
              {(out.client_questions.length > 0 || out.cautions.length > 0) && (
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  {out.client_questions.length > 0 && (
                    <div><p className="mb-1 font-semibold">Ask the client</p><ul className="list-disc space-y-0.5 pl-4">{out.client_questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>
                  )}
                  {out.cautions.length > 0 && (
                    <div><p className="mb-1 font-semibold">Check before filing</p><ul className="list-disc space-y-0.5 pl-4">{out.cautions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {canEdit && (
                  <Button size="sm" className={WS_BTN} disabled={saving || !chosen.length} onClick={useInDraft}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileInput className="h-3.5 w-3.5" />} Use in draft ({chosen.length})
                  </Button>
                )}
                <Button size="sm" variant="outline" className={WS_BTN} disabled={!chosen.length} onClick={() => copy(block)}><Copy className="h-3.5 w-3.5" /> Copy</Button>
                {!run.feedback && <Button size="sm" variant="ghost" className={WS_BTN} onClick={discard}><X className="h-3.5 w-3.5" /> Discard</Button>}
                <span className="text-[11px] text-muted-foreground">Edit before use: what you use, as edited, teaches the assistant.</span>
              </div>
            </>
          )}
        </div>
      )}
      {!busy && run && run.status === 'failed' && !error && <Note tone="warn">{run.error ?? 'The assistant could not answer.'}</Note>}
      {!busy && !run && !runs.isLoading && (
        <p className="text-xs text-muted-foreground">
          Draft a reply part for each issue, improve a text, or ask a question. Answers draw on this notice, its case's documents and the firm's
          past replies chosen under <Link to="/notices-reply-factory?tab=learning" className="font-medium text-primary hover:underline">Reply Factory, Learning</Link>.
        </p>
      )}

      {(runs.data?.length ?? 0) > 1 && (
        <details className="text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground"><History className="h-3.5 w-3.5" /> Earlier answers ({(runs.data?.length ?? 1) - 1})</summary>
          <ul className="mt-1 divide-y rounded-md border">
            {(runs.data ?? []).map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setShown(r.id)} className={cn('flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/40', r.id === run?.id && 'bg-muted/50')}>
                  {r.id === run?.id ? <Check className="h-3 w-3 text-primary" /> : <span className="w-3" />}
                  <span className="font-medium">{MODES.find((m) => m.key === r.mode)?.label ?? r.mode}</span>
                  <span className="truncate text-muted-foreground">{r.question ?? ''}</span>
                  <span className="ml-auto whitespace-nowrap text-muted-foreground">{fmtAgo(r.created_at)}{r.status === 'failed' ? ' · failed' : r.feedback ? ` · ${r.feedback}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {runs.error && (
        <Button size="sm" variant="outline" className={WS_BTN} onClick={() => runs.refetch()}><RefreshCw className="h-3.5 w-3.5" /> Retry loading the answers</Button>
      )}
    </div>
  );
};

export default AssistantTab;
