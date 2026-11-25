// The Claude API key (4 November 2026): a GST Manager or the superadmin saves,
// tests and removes it here; nobody else sees this card, and the Edge Function
// ai-key and the database check the same again. The key is typed once, sent once
// and never shown again: only its masked form, who saved it and when, and which
// key the AI uses now (the one saved here first, else the ANTHROPIC_API_KEY secret).
// A key is checked with Anthropic before it is saved (ai-key). With a key in use,
// the model every AI call uses is chosen here from Anthropic's live list for that
// key, newest first (Sonnet 5.5 unless another is chosen); the effort stays medium.
import React, { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { WS_BTN, WS_CONTROL } from '@/components/workspace/theme';
import { Panel } from '@/components/notices/ui/Panel';
import { fmtAgo } from '@/lib/noticeFormat';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  KEY_SOURCE_WORDS, loadClaudeKeyStatus, loadClaudeModels, looksLikeClaudeKey, removeClaudeKey, saveClaudeKey, setClaudeModel, testClaudeKey,
  type ClaudeKeyStatus, type ClaudeKeyTest,
} from '@/lib/claudeKey';
import { cn } from '@/lib/utils';

const QK = ['claude-key-status'];
const QK_MODELS = ['claude-models'];
const DEFAULT = '__default__';

const ModelPicker: React.FC<{ s: ClaudeKeyStatus }> = ({ s }) => {
  const uid = useId();
  const qc = useQueryClient();
  const m = useQuery({ queryKey: QK_MODELS, queryFn: loadClaudeModels, staleTime: 5 * 60_000, retry: false });
  const [busy, setBusy] = useState(false);
  const chosen = s.model ?? DEFAULT;
  const defaultName = m.data?.models.find((x) => x.id === s.default_model)?.name ?? s.default_model ?? 'Sonnet 5.5';

  const choose = async (v: string) => {
    if (v === chosen) return;
    setBusy(true);
    try {
      const next = await setClaudeModel(v === DEFAULT ? '' : v);
      qc.setQueryData(QK, next);
      toast.success(`Every AI call now uses ${next.model_name ?? defaultName}, at medium effort.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1 border-t pt-3">
      <label htmlFor={`${uid}-model`} className="text-xs text-muted-foreground">Model (from Anthropic's current list for this key, newest first; effort stays medium)</label>
      {m.isLoading ? <Skeleton className="h-8 w-72" /> : m.error ? (
        <p className="text-sm text-destructive-strong">{(m.error as Error).message}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={chosen} onValueChange={choose} disabled={busy}>
            <SelectTrigger id={`${uid}-model`} className={cn(WS_CONTROL, 'w-72')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT} className="text-xs">Default: {defaultName}</SelectItem>
              {(m.data?.models ?? []).map((x) => (
                <SelectItem key={x.id} value={x.id} className="text-xs">
                  {x.name}{x.created_at ? ` (${new Date(x.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })})` : ''}
                </SelectItem>
              ))}
              {s.model && !(m.data?.models ?? []).some((x) => x.id === s.model) && (
                <SelectItem value={s.model} className="text-xs" disabled>{s.model_name ?? s.model} (no longer offered)</SelectItem>
              )}
            </SelectContent>
          </Select>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          <Button type="button" size="sm" variant="ghost" className={WS_BTN} disabled={m.isFetching} onClick={() => m.refetch()}>Refresh list</Button>
        </div>
      )}
      {s.model && s.model_set_at && (
        <p className="text-xs text-muted-foreground">Chosen by {s.model_set_by_name ?? 'Unknown'}, {fmtAgo(s.model_set_at)}. The prices under Settings follow the model where Anthropic's list price is known.</p>
      )}
    </div>
  );
};

export const ClaudeKeyCard: React.FC = () => {
  const uid = useId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QK, queryFn: loadClaudeKeyStatus, staleTime: 30_000, retry: false });
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'remove'>(null);
  const [test, setTest] = useState<ClaudeKeyTest | null>(null);

  const s = q.data;
  const typed = key.trim();
  const badFormat = typed.length > 0 && !looksLikeClaudeKey(typed);

  const run = async (what: 'save' | 'remove') => {
    setBusy(what);
    setTest(null);
    try {
      const next = what === 'save' ? await saveClaudeKey(typed, password) : await removeClaudeKey(password);
      qc.setQueryData(QK, next);
      qc.invalidateQueries({ queryKey: QK_MODELS });
      setKey('');
      setPassword('');
      toast.success(what === 'save' ? 'Anthropic accepted the key, and it is saved.' : 'Claude API key removed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      setTest(await testClaudeKey());
    } catch (e) {
      setTest({ ok: false, active: s?.active ?? 'none', error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Claude API key" info="The AI reads notices and drafts replies through the Claude API with this key. It is kept encrypted in Supabase Vault and never sent back to the browser. Saving checks the key with Anthropic first (no model is called), and saving or removing it asks for your own password.">
      {q.isLoading ? <Skeleton className="h-24 w-full" /> : q.error ? (
        <p className="text-sm text-destructive-strong">{(q.error as Error).message}</p>
      ) : (
        <div className="space-y-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Saved key</dt>
            <dd className="font-mono">{s?.saved ? s.masked : <span className="font-sans text-muted-foreground">None saved here</span>}</dd>
            {s?.saved && (<>
              <dt className="text-muted-foreground">Saved by</dt>
              <dd>{s.saved_by_name ?? 'Unknown'}{s.saved_at ? `, ${fmtAgo(s.saved_at)} (${new Date(s.saved_at).toLocaleString('en-IN')})` : ''}</dd>
            </>)}
            <dt className="text-muted-foreground">In use</dt>
            <dd>{KEY_SOURCE_WORDS[s?.active ?? 'none']}{s?.active === 'app' && s.env_set ? ' (the ANTHROPIC_API_KEY secret is the fallback)' : ''}</dd>
            {s && s.active !== 'none' && (<>
              <dt className="text-muted-foreground">Model</dt>
              <dd>{s.model_name ?? (s.model ? s.model : `${s.default_model ?? 'Sonnet 5.5'} (default)`)}, medium effort</dd>
            </>)}
          </dl>

          <form className="space-y-2" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (looksLikeClaudeKey(typed) && password) run('save'); }}>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`${uid}-key`} className="text-xs text-muted-foreground">{s?.saved ? 'Replace with a new key' : 'Key'}</label>
                <Input id={`${uid}-key`} type="password" autoComplete="new-password" spellCheck={false} placeholder="sk-ant-…"
                  value={key} onChange={(e) => setKey(e.target.value)} className={cn(WS_CONTROL, 'font-mono')} aria-invalid={badFormat} />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${uid}-pw`} className="text-xs text-muted-foreground">Your password (to save or remove)</label>
                <Input id={`${uid}-pw`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={WS_CONTROL} />
              </div>
            </div>
            {badFormat && <p className="text-xs text-destructive-strong">That does not look like an Anthropic API key. It starts with sk-ant-. Copy it again from console.anthropic.com.</p>}
            {test && (
              <p className={cn('flex items-center gap-1.5 text-sm', test.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive-strong')} role="status">
                {test.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
                {test.ok ? `OK: Claude answered in ${((test.ms ?? 0) / 1000).toFixed(1)} s.` : test.error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {s?.saved && (
                <Button type="button" size="sm" variant="ghost" className={cn(WS_BTN, 'mr-auto text-destructive-strong')} disabled={!password || !!busy}
                  onClick={() => run('remove')} title={password ? undefined : 'Type your password to remove the key'}>
                  {busy === 'remove' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Remove
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" className={WS_BTN} disabled={!!busy || s?.active === 'none'} onClick={runTest}>
                {busy === 'test' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Test connection
              </Button>
              <Button type="submit" size="sm" className={WS_BTN} disabled={!looksLikeClaudeKey(typed) || !password || !!busy}>
                {busy === 'save' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Save
              </Button>
            </div>
          </form>
          {s && s.active !== 'none' && <ModelPicker s={s} />}
        </div>
      )}
    </Panel>
  );
};

export default ClaudeKeyCard;
