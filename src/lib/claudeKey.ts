// The Claude API key set from the app (4 November 2026): the browser talks only
// to the Edge Function ai-key, sends a key once (to save it) and never gets it
// back, only its masked form. The key lives in Supabase Vault
// (20261104100000_ai_api_key_vault.sql); nothing of it is kept in the browser.
import { currentActorId } from '@/lib/changeLogHeaders';

const ENV = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const SUPABASE_URL = ENV.VITE_SUPABASE_URL ?? '';
const ANON = ENV.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const FN_URL = `${SUPABASE_URL}/functions/v1/ai-key`;

export type KeySource = 'app' | 'env' | 'none';

export interface ClaudeKeyStatus {
  saved: boolean;
  masked: string | null;
  saved_by_name: string | null;
  saved_at: string | null;
  active: KeySource;
  env_set: boolean;
}

export interface ClaudeKeyTest { ok: boolean; active: KeySource; model?: string; ms?: number; error?: string }

export const looksLikeClaudeKey = (s: string): boolean => /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(s.trim());

function sessionsEndedAt(): string | null {
  try {
    const u = JSON.parse(localStorage.getItem('vjdesai_user') || 'null') as { sessionsEndedAt?: string | null } | null;
    return u?.sessionsEndedAt ?? null;
  } catch {
    return null;
  }
}

async function call<T>(action: string, extra: Record<string, string> = {}): Promise<T> {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ action, actorId: currentActorId(), sessionsEndedAt: sessionsEndedAt(), ...extra }),
  }).catch(() => null);
  if (!res) throw new Error('The server could not be reached. Try again.');
  const body = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
  return body;
}

export const loadClaudeKeyStatus = () => call<ClaudeKeyStatus>('status');
export const saveClaudeKey = (key: string, password: string) => call<ClaudeKeyStatus>('save', { key: key.trim(), password });
export const removeClaudeKey = (password: string) => call<ClaudeKeyStatus>('remove', { password });
export const testClaudeKey = () => call<ClaudeKeyTest>('test');

export const KEY_SOURCE_WORDS: Record<KeySource, string> = {
  app: 'The key saved here',
  env: 'The ANTHROPIC_API_KEY secret in Supabase',
  none: 'None: the AI uses the old Claude CLI gateway if it is still set, else nothing',
};
