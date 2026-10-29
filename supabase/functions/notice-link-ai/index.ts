// notice-link-ai: the AI's second opinion on linking two notice cases
// (link.ts; migration 20261027140000). Reaches Claude the way notice-ai does
// (the Claude CLI gateway when CLAUDE_CLI_GATEWAY_URL and
// CLAUDE_CLI_GATEWAY_SECRET are set, else ANTHROPIC_API_KEY;
// NOTICE_AI_BACKEND=api forces the API), always Sonnet at medium effort. Its
// own function, so notice-ai is never redeployed for it.
//
// Body: {"client_id", "child_key", "parent_key", "kind"?, "actor"?}: answered
// with {"opinion": {verdict, kind, confidence, reasons, law}} or {"error"}.
// {"action": "status"} says whether a way to Claude is set.
import { createClient } from '@supabase/supabase-js';
import { apiCaller, makeClaudeClient, scrub, type Caller } from '../notice-ai/claude.ts';
import { cliCaller, cliWithApiForScans } from '../notice-ai/cli.ts';
import { judgeLink, type LinkDeps } from './link.ts';

export const VERSION = 'notice-link-ai 1.1.0';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function caller(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Caller | null {
  const apiKey = (env('ANTHROPIC_API_KEY') ?? '').trim();
  const api = apiKey ? apiCaller(makeClaudeClient({ apiKey })) : null;
  const url = (env('CLAUDE_CLI_GATEWAY_URL') ?? '').trim();
  const secret = env('CLAUDE_CLI_GATEWAY_SECRET') ?? '';
  if ((env('NOTICE_AI_BACKEND') ?? '').trim().toLowerCase() === 'api' || !url || !secret) return api;
  return cliWithApiForScans(cliCaller({ url, secret, files: (env('CLAUDE_CLI_GATEWAY_FILES') ?? '').trim() === '1' }), api);
}

function deps(): LinkDeps {
  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    db: {
      async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
        const { data, error } = await sb.rpc(fn, args ?? {});
        if (error) throw new Error(`${fn}: ${error.message}`);
        return data as T;
      },
      async insert(table: string, row: Record<string, unknown>): Promise<void> {
        const { error } = await sb.from(table).insert(row);
        if (error) throw new Error(`${table}: ${error.message}`);
      },
    },
    claude: caller(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body */ }
  const str = (k: string) => (typeof body[k] === 'string' ? body[k] as string : undefined);
  try {
    if (str('action') === 'status') {
      const c = caller();
      return json({ version: VERSION, key: !!c, backend: c?.backend ?? null });
    }
    const r = await judgeLink(deps(), {
      client_id: str('client_id'), child_key: str('child_key'), parent_key: str('parent_key'), kind: str('kind') ?? null, actor: str('actor') ?? null,
    });
    if (r.error) return json({ error: r.error }, r.error === 'bad_request' ? 400 : 200);
    return json({ opinion: r.opinion });
  } catch (e) {
    return json({ error: scrub(String((e as Error)?.message ?? e)).slice(0, 400) }, 500);
  }
});
