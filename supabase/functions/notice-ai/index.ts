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
// "text"?, "actor"?} (the assistant, answered when done), {"action": "advise",
// "client_id", "case_key", "actor"?} (what to do now on a case, answered when
// done), {"action": "advise_next"} (pg_cron notice-ai-advise: the next cases
// that need it, in the background), {"action": "status"}.
// How it reaches Claude (backend.ts, 4 November 2026): the Claude API directly,
// with the key saved from the app (Supabase Vault) or else the ANTHROPIC_API_KEY
// secret; the Claude CLI gateway (CLAUDE_CLI_GATEWAY_URL and
// CLAUDE_CLI_GATEWAY_SECRET) only when there is no key. With neither, nothing
// is read and the assistant says so.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every function.
import { createClient } from '@supabase/supabase-js';
import { scrub } from './claude.ts';
import { resolveCaller, rpcKeyReader } from './backend.ts';
import { runAssist } from './assist.ts';
import { runAdvise, runAdviseNext } from './advise.ts';
import { runTick, type Db, type Deps } from './runner.ts';

export const VERSION = 'notice-ai 1.9.0';

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

async function deps(): Promise<Deps> {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const db = supabaseDb(url, key);
  const { caller } = await resolveCaller(rpcKeyReader((fn) => db.rpc(fn)));
  return {
    db,
    claude: caller,
    supabaseUrl: url,
    storageKey: key,
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
      const db = supabaseDb(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
      const { caller: c, keySource, model } = await resolveCaller(rpcKeyReader((fn) => db.rpc(fn)));
      return json({ version: VERSION, key: !!c, backend: c?.backend ?? null, key_source: keySource, model: c?.backend === 'api' ? model : null, files: !!c?.files });
    }
    if (action === 'tick') {
      const d = await deps();
      const run = runTick(d).catch((e) => ({ ran: false, error: scrub(String((e as Error)?.message ?? e)) }));
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
        EdgeRuntime.waitUntil(run.then((r) => console.log(JSON.stringify({ tick: r }))));
        return json({ started: true, agent: d.agentId }, 202);
      }
      return json(await run);
    }
    if (action === 'assist') {
      const r = await runAssist(await deps(), {
        notice_id: typeof body.notice_id === 'string' ? body.notice_id : undefined,
        mode: typeof body.mode === 'string' ? body.mode : undefined,
        issue_id: typeof body.issue_id === 'string' ? body.issue_id : null,
        question: typeof body.question === 'string' ? body.question : null,
        text: typeof body.text === 'string' ? body.text : null,
        actor: typeof body.actor === 'string' ? body.actor : null,
      });
      return json(r, r.error === 'bad_request' ? 400 : 200);
    }
    if (action === 'advise') {
      const r = await runAdvise(await deps(), {
        client_id: typeof body.client_id === 'string' ? body.client_id : undefined,
        case_key: typeof body.case_key === 'string' ? body.case_key : undefined,
        actor: typeof body.actor === 'string' ? body.actor : null,
      });
      return json(r, r.error === 'bad_request' ? 400 : 200);
    }
    if (action === 'advise_next') {
      const run = runAdviseNext(await deps()).catch((e) => ({ error: scrub(String((e as Error)?.message ?? e)) }));
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
        EdgeRuntime.waitUntil(run.then((r) => console.log(JSON.stringify({ advise: r }))));
        return json({ started: true }, 202);
      }
      return json(await run);
    }
    return json({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    return json({ error: scrub(String((e as Error)?.message ?? e)).slice(0, 400) }, 500);
  }
});
