// notice-ai: the Notice Response AI Assistant's Edge Function (Notices Phase 7).
// Reads every notice, attachment and reply with the Claude API from Supabase
// itself, and drafts replies from the firm's own past answers. The database
// holds every rule (migration 20261009100000_ai_assistant.sql); this function
// only reads documents and asks the Claude API. Read
// docs/REPLY_FACTORY_POSITIONS.md §13 before changing it.
//
// Body: {"action": "tick"} (pg_cron every two minutes, or "Run now" in the
// app: one run of the reader, in the background), {"action": "assist",
// "notice_id", "mode": "draft" | "ask" | "improve", "issue_id"?, "question"?,
// "text"?, "actor"?} (the assistant, answered when done), {"action": "status"}.
// Secrets: ANTHROPIC_API_KEY (without it nothing is read and the assistant says
// so); SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every function.
import { createClient } from '@supabase/supabase-js';
import { makeClaudeClient, scrub } from './claude.ts';
import { runAssist } from './assist.ts';
import { runTick, type Db, type Deps } from './runner.ts';

export const VERSION = 'notice-ai 1.0.0';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function supabaseDb(url: string, key: string): Db {
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
      const { data, error } = await sb.rpc(fn, args ?? {});
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data as T;
    },
  };
}

function deps(): Deps {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  return {
    db: supabaseDb(url, key),
    claude: apiKey ? makeClaudeClient({ apiKey }) : null,
    supabaseUrl: url,
    agentId: `edge:${crypto.randomUUID().slice(0, 8)}`,
    version: VERSION,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body: a tick */ }
  const action = typeof body.action === 'string' ? body.action : 'tick';
  try {
    if (action === 'status') {
      return json({ version: VERSION, key: !!Deno.env.get('ANTHROPIC_API_KEY') });
    }
    if (action === 'tick') {
      const d = deps();
      const run = runTick(d).catch((e) => ({ ran: false, error: scrub(String((e as Error)?.message ?? e)) }));
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
        EdgeRuntime.waitUntil(run.then((r) => console.log(JSON.stringify({ tick: r }))));
        return json({ started: true, agent: d.agentId }, 202);
      }
      return json(await run);
    }
    if (action === 'assist') {
      const r = await runAssist(deps(), {
        notice_id: typeof body.notice_id === 'string' ? body.notice_id : undefined,
        mode: typeof body.mode === 'string' ? body.mode : undefined,
        issue_id: typeof body.issue_id === 'string' ? body.issue_id : null,
        question: typeof body.question === 'string' ? body.question : null,
        text: typeof body.text === 'string' ? body.text : null,
        actor: typeof body.actor === 'string' ? body.actor : null,
      });
      return json(r, r.error === 'bad_request' ? 400 : 200);
    }
    return json({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    return json({ error: scrub(String((e as Error)?.message ?? e)).slice(0, 400) }, 500);
  }
});
