// How notice-ai, notice-appeal-ai and notice-link-ai reach Claude (4 November
// 2026): the Claude API directly (claude.ts) whenever a key is set, the key
// saved from the app first, then the ANTHROPIC_API_KEY secret
// (../_shared/claudeKey.ts). The Claude CLI gateway (cli.ts,
// CLAUDE_CLI_GATEWAY_URL / CLAUDE_CLI_GATEWAY_SECRET) is used only when there is
// no key at all, until its secrets are taken off.

import { resolveClaudeKey, type KeyReader, type KeySource } from '../_shared/claudeKey.ts';
import { apiCaller, makeClaudeClient, type Caller } from './claude.ts';
import { cliCaller } from './cli.ts';

export function pickCaller(apiKey: string | null, env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Caller | null {
  if (apiKey) return apiCaller(makeClaudeClient({ apiKey }));
  const url = (env('CLAUDE_CLI_GATEWAY_URL') ?? '').trim();
  const secret = env('CLAUDE_CLI_GATEWAY_SECRET') ?? '';
  if (!url || !secret) return null;
  return cliCaller({ url, secret, files: (env('CLAUDE_CLI_GATEWAY_FILES') ?? '').trim() === '1' });
}

/** The caller and where its key came from ('app', 'env', or 'none' for the gateway or nothing). */
export async function resolveCaller(read: KeyReader, env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Promise<{ caller: Caller | null; keySource: KeySource }> {
  const k = await resolveClaudeKey(read, env);
  return { caller: pickCaller(k.key, env), keySource: k.source };
}

/** The service-role reader of the key saved from the app. */
export function rpcKeyReader(rpc: (fn: string) => Promise<unknown>): KeyReader {
  return async () => (await rpc('ai_api_key_read')) as { key?: string | null } | null;
}
