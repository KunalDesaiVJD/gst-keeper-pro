// notice-appeal-ai: the Appeal workspace's drafts (Notices §33, migration
// 20261025180000). Drafts or improves an appeal's statement of facts, grounds
// of appeal or written submission (appeal.ts), reaching Claude the way
// notice-ai does (the Claude CLI gateway when CLAUDE_CLI_GATEWAY_URL and
// CLAUDE_CLI_GATEWAY_SECRET are set, else ANTHROPIC_API_KEY; NOTICE_AI_BACKEND=api
// forces the API). Its own function, so notice-ai's reader and assistant are
// never redeployed for it.
//
// Body: {"client_id", "case_key", "appeal_key", "doc_type": "facts" | "grounds" |
// "submission", "mode": "draft" | "improve", "text"?, "instructions"?, "actor"?}:
// answered at once with the run's id ({"started": true, "run_id"}), drafted in
// the background; the page watches notice_appeal_ai_runs. {"action": "status"}
// says whether a way to Claude is set.
import { createClient } from '@supabase/supabase-js';
import { apiCaller, makeClaudeClient, scrub, type Caller } from '../notice-ai/claude.ts';
import { cliCaller, cliWithApiForScans } from '../notice-ai/cli.ts';
import { beginAppeal, type AppealDeps } from './appeal.ts';

export const VERSION = 'notice-appeal-ai 1.3.0';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function caller(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Caller | null {
  const apiKey = (env('ANTHROPIC_API_KEY') ?? '').trim();
  const api = apiKey ? apiCaller(makeClaudeClient({ apiKey })) : null;
  const url = (env('CLAUDE_CLI_GATEWAY_URL') ?? '').trim();
  const secret = env('CLAUDE_CLI_GATEWAY_SECRET') ?? '';
  if ((env('NOTICE_AI_BACKEND') ?? '').trim().toLowerCase() === 'api' || !url || !secret) return api;
  return cliWithApiForScans(cliCaller({ url, secret, files: (env('CLAUDE_CLI_GATEWAY_FILES') ?? '').trim() === '1' }), api);
}

function deps(): AppealDeps {
  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    db: {
      async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
        const { data, error } = await sb.rpc(fn, args ?? {});
        if (error) throw new Error(`${fn}: ${error.message}`);
        return data as T;
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
    const r = await beginAppeal(deps(), {
      client_id: str('client_id'), case_key: str('case_key'), appeal_key: str('appeal_key'), doc_type: str('doc_type'),
      mode: str('mode'), text: str('text') ?? null, instructions: str('instructions') ?? null, actor: str('actor') ?? null,
    });
    if (r.error || !r.done) return json({ error: r.error ?? 'failed' }, r.error === 'bad_request' ? 400 : 200);
    const done = r.done.catch((e) => ({ error: scrub(String((e as Error)?.message ?? e)) }));
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(done.then((x) => console.log(JSON.stringify({ appeal: { run: r.run_id, status: (x as Record<string, unknown>).status ?? (x as Record<string, unknown>).error } }))));
      return json({ started: true, run_id: r.run_id }, 202);
    }
    return json(await done);
  } catch (e) {
    return json({ error: scrub(String((e as Error)?.message ?? e)).slice(0, 400) }, 500);
  }
});
