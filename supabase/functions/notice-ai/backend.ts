// How notice-ai, notice-appeal-ai and notice-link-ai reach Claude (4 November
// 2026): the Claude API directly (claude.ts) whenever a key is set, the key
// saved from the app first, then the ANTHROPIC_API_KEY secret
// (../_shared/claudeKey.ts). The Claude CLI gateway (cli.ts,
// CLAUDE_CLI_GATEWAY_URL / CLAUDE_CLI_GATEWAY_SECRET) is used only when there is
// no key at all, until its secrets are taken off. The Claude API calls use the
// model chosen with the key (Sonnet 5.5 when none is); the gateway stays Sonnet.

import { AI_MODEL } from '../_shared/aiModel.ts';
import { resolveClaudeKey, type KeyReader, type KeySource } from '../_shared/claudeKey.ts';
import { apiCaller, makeClaudeClient, type Caller } from './claude.ts';
import { cliCaller } from './cli.ts';

export function pickCaller(apiKey: string | null, env: (k: string) => string | undefined = (k) => Deno.env.get(k), model: string = AI_MODEL): Caller | null {
  if (apiKey) return apiCaller(makeClaudeClient({ apiKey }), model);
  const url = (env('CLAUDE_CLI_GATEWAY_URL') ?? '').trim();
  const secret = env('CLAUDE_CLI_GATEWAY_SECRET') ?? '';
  if (!url || !secret) return null;
  return cliCaller({ url, secret, files: (env('CLAUDE_CLI_GATEWAY_FILES') ?? '').trim() === '1' });
}

/** The caller and where its key came from ('app', 'env', or 'none' for the gateway or nothing). */
export async function resolveCaller(read: KeyReader, env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Promise<{ caller: Caller | null; keySource: KeySource; model: string }> {
  const k = await resolveClaudeKey(read, env);
  return { caller: pickCaller(k.key, env, k.model), keySource: k.source, model: k.key ? k.model : AI_MODEL };
}

/** The service-role reader of the key saved from the app, and of the model chosen with it. */
export function rpcKeyReader(rpc: (fn: string) => Promise<unknown>): KeyReader {
  return async () => {
    const r = (await rpc('ai_api_key_read')) as { key?: string | null } | null;
    let model: string | null = null;
    // A model that cannot be read is the default, never a reason to lose the key.
    try { model = (await rpc('ai_api_model_read')) as string | null; } catch { model = null; }
    return { ...(r ?? {}), model };
  };
}
