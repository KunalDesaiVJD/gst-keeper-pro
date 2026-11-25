// The Claude API key the Edge Functions use (4 November 2026): the key saved
// from the app (Reply Factory → AI → Claude API key, kept in Supabase Vault,
// 20261104100000_ai_api_key_vault.sql, read by the service-role-only RPC
// ai_api_key_read) first, else the ANTHROPIC_API_KEY secret. The key read from
// the database is kept in this function instance's memory for two minutes at
// most, so a call does not read it every time; ai-key clears its own copy when
// the key is saved or removed, and every other instance sees the change within
// those two minutes. The key is never logged, returned or put in an error.
// The model chosen with it (ai_api_model_read, 20261104120000) is read and kept
// the same way; nothing chosen, or a choice that cannot be read, is AI_MODEL.

import { AI_MODEL, isClaudeModelId } from './aiModel.ts';

export type KeySource = 'app' | 'env' | 'none';
export interface ResolvedKey { key: string | null; source: KeySource; model: string }

/** Reads the saved key (the RPC ai_api_key_read) and the chosen model (ai_api_model_read) through a service-role client. */
export type KeyReader = () => Promise<{ key?: string | null; model?: string | null } | null>;

export const KEY_CACHE_MS = 2 * 60_000;

let cached: { key: string | null; model: string; at: number } | null = null;

export function clearClaudeKeyCache(): void {
  cached = null;
}

export function looksLikeClaudeKey(s: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(s);
}

export function maskKey(s: string): string {
  return `sk-ant-…${s.slice(-4)}`;
}

export async function resolveClaudeKey(
  read: KeyReader,
  env: (k: string) => string | undefined = (k) => Deno.env.get(k),
  now: () => number = Date.now,
): Promise<ResolvedKey> {
  if (!cached || now() - cached.at > KEY_CACHE_MS) {
    let saved: string | null = null;
    let model = AI_MODEL;
    try {
      const r = await read();
      const k = typeof r?.key === 'string' ? r.key.trim() : '';
      saved = k && looksLikeClaudeKey(k) ? k : null;
      if (isClaudeModelId(r?.model)) model = r.model;
    } catch {
      // The database could not be read (or the migration is not there): the secret, if any.
      saved = null;
    }
    cached = { key: saved, model, at: now() };
  }
  if (cached.key) return { key: cached.key, source: 'app', model: cached.model };
  const fromEnv = (env('ANTHROPIC_API_KEY') ?? '').trim();
  return fromEnv ? { key: fromEnv, source: 'env', model: cached.model } : { key: null, source: 'none', model: AI_MODEL };
}
