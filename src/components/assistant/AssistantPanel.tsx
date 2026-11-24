// The GST Assistant panel (23 Nov 2026): a side panel on every staff screen.
// It answers from the firm's docs and live figures, takes the user to a screen,
// shows a numbered screenshot and a guided walk for doing a task by hand, and
// fills figures into the screen's own fields only after the user approves them
// (the screen's own Save stores them, with every check it has). Claude Sonnet
// 5.5 through the Edge Function gst-assistant; every request's tokens are
// recorded per user (Settings → AI Assistant).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, Camera, Check, FileText, Image as ImageIcon, Loader2, MapPin, Paperclip, PenLine, PlayCircle, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { askAssistant, markAction, type AssistantAction } from '@/lib/assistant/api';
import { takeSnapshot, findTarget } from '@/lib/assistant/pageSnapshot';
import { annotatedScreenshot } from '@/lib/assistant/screenshot';
import { applyFill } from '@/lib/assistant/fill';
import { ACCEPT, MAX_FILES, MAX_TOTAL_BYTES, chipOf, formatSize, readAttachment, totalBytes, type Attachment, type AttachmentChip } from '@/lib/assistant/attachments';
import GuideOverlay, { type GuideStep } from './GuideOverlay';

interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions?: AssistantAction[];
  error?: boolean;
  files?: AttachmentChip[];
}

const STORE = 'gst_assistant_chat_v1';
const SUGGESTIONS = [
  'What is pending on this screen?',
  'How do I import 2B and reconcile it for this month?',
  'Why does ITC in GSTR-3B differ from 2B?',
  'Take me to Filing Status for this client',
];

const FileChip: React.FC<{ f: AttachmentChip; onRemove?: () => void; light?: boolean }> = ({ f, onRemove, light }) => (
  <span className={cn('inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]', light ? 'border-primary-foreground/30 bg-primary-foreground/10' : 'bg-card')} title={f.note ?? f.name}>
    {f.kind === 'image' ? <ImageIcon className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
    <span className="truncate">{f.name}</span>
    <span className="shrink-0 opacity-70">{formatSize(f.size)}</span>
    {onRemove && <button type="button" aria-label={`Remove ${f.name}`} className="shrink-0 opacity-70 hover:opacity-100" onClick={onRemove}><X className="h-3 w-3" /></button>}
  </span>
);

function load(): { conversationId: string | null; history: unknown[]; items: ChatItem[] } {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    if (v && Array.isArray(v.items)) return v;
  } catch { /* fresh */ }
  return { conversationId: null, history: [], items: [] };
}

// A small reader for the model's plain markdown: paragraphs, lists, bold, code.
function Rich({ text }: { text: string }) {
  const inline = (s: string, k: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={`${k}${i}`}>{p.slice(2, -2)}</strong>
      : p.startsWith('`') && p.endsWith('`') ? <code key={`${k}${i}`} className="rounded bg-muted px-1 text-[12px]">{p.slice(1, -1)}</code>
        : <React.Fragment key={`${k}${i}`}>{p}</React.Fragment>);
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((b, bi) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const Tag = ordered ? 'ol' : 'ul';
          return <Tag key={bi} className={cn('space-y-0.5 pl-5', ordered ? 'list-decimal' : 'list-disc')}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*]|\d+[.)])\s+/, ''), `${bi}-${li}-`)}</li>)}</Tag>;
        }
        if (/^#{1,4}\s/.test(lines[0])) return <p key={bi} className="font-semibold">{inline(lines.join(' ').replace(/^#+\s*/, ''), `${bi}-`)}</p>;
        return <p key={bi}>{lines.map((l, li) => <React.Fragment key={li}>{li > 0 && <br />}{inline(l, `${bi}-${li}-`)}</React.Fragment>)}</p>;
      })}
    </div>
  );
}

const AssistantPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(load);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState<{ title: string; steps: GuideStep[]; origin: string } | null>(null);
  const [shots, setShots] = useState<Record<string, { url: string; found: number[] } | 'none' | 'taking'>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const location = useLocation();
  const navigate = useNavigate();
  const endRef = useRef<HTMLDivElement>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  // Files for the next question (kept in memory only, never stored).
  const [files, setFiles] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (list: File[]) => {
    if (!list.length) return;
    setReading(true);
    const added: Attachment[] = [];
    let total = totalBytes(files);
    for (const f of list) {
      if (files.length + added.length >= MAX_FILES) { toast.error(`Up to ${MAX_FILES} files with one question.`); break; }
      if (total + f.size > MAX_TOTAL_BYTES) { toast.error(`${f.name || 'This file'} would take the files over 10 MB for this question.`); continue; }
      try {
        const a = await readAttachment(f);
        added.push(a);
        total += a.size;
        if (a.note) toast.warning(`${a.name}: ${a.note}.`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    setReading(false);
    if (added.length) setFiles((cur) => [...cur, ...added]);
  }, [files]);

  const removeFile = (id: string) => setFiles((cur) => {
    const gone = cur.find((x) => x.id === id);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    return cur.filter((x) => x.id !== id);
  });

  // Switched off by the firm (Settings → AI Assistant): no button at all.
  useEffect(() => {
    supabase.from('assistant_settings' as never).select('enabled').maybeSingle().then(({ data }) => {
      if (data && (data as { enabled?: boolean }).enabled === false) setEnabled(false);
    });
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(state)); } catch { /* full */ }
  }, [state]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [state.items.length, busy, open]);
  useEffect(() => {
    let live = true;
    if (!selectedClientId) { setClientName(null); return; }
    supabase.from('clients').select('name').eq('id', selectedClientId).maybeSingle().then(({ data }) => { if (live) setClientName((data as { name?: string } | null)?.name ?? null); });
    return () => { live = false; };
  }, [selectedClientId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ask = useCallback(async (q: string) => {
    const sending = files;
    const question = q.trim() || (sending.length ? 'Please review the attached file(s) and tell me what to do with them in GST Keeper.' : '');
    if (!question || busy || reading) return;
    setInput('');
    setFiles([]);
    const mine: ChatItem = { id: crypto.randomUUID(), role: 'user', text: q.trim(), files: sending.map(chipOf) };
    setState((s) => ({ ...s, items: [...s.items, mine] }));
    setBusy(true);
    // The screen as it is now (the panel itself left out).
    const page = takeSnapshot({ route: location.pathname + location.search, clientId: selectedClientId || null, clientName, period: selectedMonth || null });
    const res = await askAssistant({ question, conversationId: state.conversationId, history: state.history, page, attachments: sending });
    for (const a of sending) if (a.preview) URL.revokeObjectURL(a.preview);
    setBusy(false);
    if (!res.ok) {
      setState((s) => ({ ...s, items: [...s.items, { id: crypto.randomUUID(), role: 'assistant', text: res.error || 'The assistant could not answer.', error: true }] }));
      return;
    }
    setState((s) => ({
      conversationId: res.conversationId ?? s.conversationId,
      history: res.history ?? s.history,
      items: [...s.items, { id: crypto.randomUUID(), role: 'assistant', text: res.reply ?? '', actions: res.actions ?? [] }],
    }));
  }, [busy, reading, files, location.pathname, location.search, selectedClientId, clientName, selectedMonth, state.conversationId, state.history]);

  const go = async (a: Extract<AssistantAction, { kind: 'navigate' }>) => {
    if (a.client_id) setSelectedClientId(a.client_id);
    if (a.period && /^\d{2}\/\d{4}$/.test(a.period)) setSelectedMonth(a.period);
    if (a.route.includes(':')) { toast.error('That screen needs a record picked first.'); return; }
    navigate(a.route);
    setDone((d) => ({ ...d, [a.id]: 'Opened' }));
    void markAction(a.id, 'applied', 'opened');
    if (a.tab) window.setTimeout(() => findTarget(a.tab)?.click(), 900);
  };

  const screenshot = async (a: Extract<AssistantAction, { kind: 'guide' }>) => {
    setShots((s) => ({ ...s, [a.id]: 'taking' }));
    // The panel steps aside for the picture, then comes back.
    setOpen(false);
    await new Promise((r) => setTimeout(r, 350));
    const shot = await annotatedScreenshot(a.steps, location.pathname);
    setOpen(true);
    setShots((s) => ({ ...s, [a.id]: shot ?? 'none' }));
  };

  const startGuide = (a: Extract<AssistantAction, { kind: 'guide' }>) => {
    setGuide({ title: a.title, steps: a.steps, origin: a.origin ?? location.pathname });
    setOpen(false);
    void markAction(a.id, 'applied', 'guide started');
  };

  const fill = async (a: Extract<AssistantAction, { kind: 'fill' }>, save: boolean) => {
    setOpen(false);
    await new Promise((r) => setTimeout(r, 300));
    const res = await applyFill(a.fields, { saveButton: a.save_button, save });
    const failed = res.outcomes.filter((o) => !o.ok);
    const note = [
      `${res.outcomes.length - failed.length} of ${res.outcomes.length} filled`,
      ...failed.map((o) => `${o.field.target}: ${o.note}`),
      res.saved ? `${a.save_button} pressed: check the screen's message` : res.saveNote ?? (save ? '' : 'Review the figures, then press Save'),
    ].filter(Boolean).join('. ');
    setDone((d) => ({ ...d, [a.id]: note }));
    void markAction(a.id, failed.length === res.outcomes.length ? 'failed' : res.saved ? 'saved' : 'applied', note);
    if (failed.length) toast.warning(note); else toast.success(res.saved ? 'Filled and saved through the screen' : 'Filled: review and press Save');
    if (failed.length || !res.saved) {
      // Point at what is left for the person.
      const target = failed[0]?.field.target ?? a.save_button;
      if (target) setGuide({ title: a.title, origin: location.pathname, steps: [{ target, instruction: failed[0] ? `Fill “${failed[0].field.target}” with ${failed[0].field.value} by hand.` : `Check the figures, then press ${a.save_button}.` }] });
    }
  };

  const cancel = (a: AssistantAction) => {
    setDone((d) => ({ ...d, [a.id]: 'Cancelled' }));
    void markAction(a.id, 'cancelled');
  };

  const reset = () => { setState({ conversationId: null, history: [], items: [] }); setShots({}); setDone({}); };

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        data-assistant-root
        onClick={() => setOpen(true)}
        aria-label="Open the GST Assistant (Ctrl J)"
        title="GST Assistant (Ctrl J)"
        className={cn('fixed bottom-5 right-5 z-50 flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg transition-all hover:shadow-xl', open && 'hidden')}
      >
        <Sparkles className="h-4 w-4" /> GST Assistant
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" data-assistant-root className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="flex items-center gap-2 text-base"><Bot className="h-5 w-5 text-primary" /> GST Assistant</SheetTitle>
            <SheetDescription className="text-xs">
              {location.pathname}{clientName ? ` · ${clientName}` : ''}{selectedMonth ? ` · ${selectedMonth}` : ''}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {state.items.length === 0 && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Ask about any GST screen or figure. I can take you to a screen, show you the steps on your screen, or fill figures for you to check and save. Attach a file or paste a screenshot (Ctrl V) for me to review.</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => void ask(s)} className="rounded-full border bg-card px-3 py-1 text-xs text-foreground/80 hover:bg-muted">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {state.items.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[92%] rounded-lg px-3 py-2', m.role === 'user' ? 'bg-primary text-primary-foreground' : m.error ? 'border border-destructive/40 bg-destructive/5 text-foreground' : 'border bg-card text-foreground')}>
                  {m.text && (m.role === 'user' ? <p className="whitespace-pre-wrap">{m.text}</p> : <Rich text={m.text} />)}
                  {m.files?.length ? <div className={cn('flex flex-wrap gap-1', m.text && 'mt-1.5')}>{m.files.map((f, i) => <FileChip key={i} f={f} light={m.role === 'user'} />)}</div> : null}
                  {m.actions?.map((a) => (
                    <div key={a.id} className="mt-2 rounded-md border bg-muted/30 p-2.5">
                      {a.kind === 'navigate' && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs">{a.reason}</span>
                          <Button size="sm" className="h-8 shrink-0 gap-1 px-2.5 text-xs" disabled={!!done[a.id]} onClick={() => void go(a)}><MapPin className="h-3.5 w-3.5" />{done[a.id] ?? 'Take me there'}</Button>
                        </div>
                      )}
                      {a.kind === 'guide' && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold">{a.title}</div>
                          <ol className="list-decimal space-y-0.5 pl-5 text-xs">
                            {a.steps.map((s, i) => <li key={i}>{s.instruction}{s.target ? <span className="text-muted-foreground"> ({s.target})</span> : null}</li>)}
                          </ol>
                          {typeof shots[a.id] === 'object' && (
                            <a href={(shots[a.id] as { url: string }).url} download="gst-assistant-steps.png" title="Download the screenshot">
                              <img src={(shots[a.id] as { url: string }).url} alt={`Screenshot with the steps of ${a.title} numbered`} className="w-full rounded border" />
                            </a>
                          )}
                          {shots[a.id] === 'none' && <p className="text-xs text-muted-foreground">No screenshot could be taken here. The guided walk still shows each step.</p>}
                          <div className="flex flex-wrap gap-1.5">
                            <Button size="sm" className="h-8 gap-1 px-2.5 text-xs" onClick={() => startGuide(a)}><PlayCircle className="h-3.5 w-3.5" />Guide me</Button>
                            <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 text-xs" disabled={shots[a.id] === 'taking'} onClick={() => void screenshot(a)}>
                              {shots[a.id] === 'taking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}Screenshot with steps
                            </Button>
                          </div>
                        </div>
                      )}
                      {a.kind === 'fill' && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold"><PenLine className="h-3.5 w-3.5" />{a.title}</div>
                          <p className="text-xs text-muted-foreground">{a.summary}</p>
                          <div className="overflow-hidden rounded border bg-card">
                            <table className="w-full text-xs">
                              <thead><tr className="bg-muted"><th className="px-2 py-1 text-left font-semibold">Field</th><th className="px-2 py-1 text-right font-semibold">Now</th><th className="px-2 py-1 text-right font-semibold">New</th></tr></thead>
                              <tbody>
                                {a.fields.map((f, i) => (
                                  <tr key={i} className="border-t">
                                    <td className="px-2 py-1">{f.target}{f.row ? <div className="text-[11px] text-muted-foreground">{f.row}</div> : null}</td>
                                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{f.current ?? ''}</td>
                                    <td className="px-2 py-1 text-right font-medium tabular-nums">{f.value}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {done[a.id] ? (
                            <p className="flex items-start gap-1 text-xs"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />{done[a.id]}</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => void fill(a, false)}>Fill, I will save</Button>
                              {a.save_button && <Button size="sm" className="h-8 px-2.5 text-xs" onClick={() => void fill(a, true)}>Fill and press {a.save_button}</Button>}
                              <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => cancel(a)}>Cancel</Button>
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground">Figures go into the screen's own fields. The screen's Save checks them as for a typed change, and Change History records the save as yours.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the screen and the firm's notes…</div>}
            <div ref={endRef} />
          </div>

          <form
            className={cn('border-t p-3', dragging && 'bg-primary/5 ring-2 ring-inset ring-primary/40')}
            onSubmit={(e) => { e.preventDefault(); void ask(input); }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void addFiles([...e.dataTransfer.files]); }}
          >
            {(files.length > 0 || reading) && (
              <div className="mb-2 space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {files.map((f) => (
                    f.preview
                      ? <span key={f.id} className="relative"><img src={f.preview} alt={f.name} className="h-12 w-16 rounded border object-cover" /><button type="button" aria-label={`Remove ${f.name}`} onClick={() => removeFile(f.id)} className="absolute -right-1.5 -top-1.5 rounded-full border bg-card p-0.5 shadow"><X className="h-3 w-3" /></button></span>
                      : <FileChip key={f.id} f={chipOf(f)} onRemove={() => removeFile(f.id)} />
                  ))}
                  {reading && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Reading the file…</span>}
                </div>
                <p className="text-[11px] text-muted-foreground">{formatSize(totalBytes(files))} of 10 MB. The files go with this question only and are not kept.</p>
              </div>
            )}
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
              onPaste={(e) => {
                const pasted = [...e.clipboardData.files];
                if (pasted.length) { e.preventDefault(); void addFiles(pasted.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `screenshot ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}${i ? ` (${i + 1})` : ''}.png`, { type: f.type })))); }
              }}
              placeholder="Ask, say what to enter, or paste a screenshot…"
              rows={2}
              className="resize-none text-sm"
              disabled={busy}
            />
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-muted-foreground" onClick={reset} disabled={busy}><RotateCcw className="h-3.5 w-3.5" />New chat</Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-muted-foreground" onClick={() => fileInput.current?.click()} disabled={busy || reading || files.length >= MAX_FILES} title="Attach images, PDF, Excel, CSV, Word or text files, up to 10 MB"><Paperclip className="h-3.5 w-3.5" />Attach</Button>
              </div>
              <Button type="submit" size="sm" className="h-8 gap-1 px-3 text-xs" disabled={busy || reading || (!input.trim() && !files.length)}><Send className="h-3.5 w-3.5" />Ask</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {guide && (
        <GuideOverlay
          title={guide.title}
          steps={guide.steps}
          origin={guide.origin}
          onClose={() => { setGuide(null); }}
        />
      )}
      {guide && (
        <button type="button" data-assistant-root className="fixed bottom-5 right-5 z-[61] flex h-9 items-center gap-1 rounded-full border bg-card px-3 text-xs shadow" onClick={() => { setGuide(null); setOpen(true); }}>
          <X className="h-3.5 w-3.5" /> Back to the assistant
        </button>
      )}
    </>
  );
};

export default AssistantPanel;
