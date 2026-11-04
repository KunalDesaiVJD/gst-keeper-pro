// notice-link-ai: the AI's second opinion on linking two notice cases
// (link.ts; migration 20261027140000). Reaches Claude the way notice-ai does
// (notice-ai/backend.ts: the Claude API with the key saved from the app or the
// ANTHROPIC_API_KEY secret; the Claude CLI gateway only when there is no key), always Sonnet at medium effort. Its
// own function, so notice-ai is never redeployed for it.
//
// Body: {"client_id", "child_key", "parent_key", "kind"?, "actor"?}: answered
// with {"opinion": {verdict, kind, confidence, reasons, law}} or {"error"}.
// {"action": "status"} says whether a way to Claude is set.
import { createClient } from '@supabase/supabase-js';
import { scrub } from '../notice-ai/claude.ts';
import { resolveCaller, rpcKeyReader } from '../notice-ai/backend.ts';
import { judgeLink, type LinkDeps } from './link.ts';

export const VERSION = 'notice-link-ai 1.2.0';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function deps(): Promise<LinkDeps> {
  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } });
  const db = {
    async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
      const { data, error } = await sb.rpc(fn, args ?? {});
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data as T;
    },
    async insert(table: string, row: Record<string, unknown>): Promise<void> {
      const { error } = await sb.from(table).insert(row);
      if (error) throw new Error(`${table}: ${error.message}`);
    },
  };
  const { caller } = await resolveCaller(rpcKeyReader((fn) => db.rpc(fn)));
  return { db, claude: caller };
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
      const c = (await deps()).claude;
      return json({ version: VERSION, key: !!c, backend: c?.backend ?? null });
    }
    const r = await judgeLink(await deps(), {
      client_id: str('client_id'), child_key: str('child_key'), parent_key: str('parent_key'), kind: str('kind') ?? null, actor: str('actor') ?? null,
    });
    if (r.error) return json({ error: r.error }, r.error === 'bad_request' ? 400 : 200);
    return json({ opinion: r.opinion });
  } catch (e) {
    return json({ error: scrub(String((e as Error)?.message ?? e)).slice(0, 400) }, 500);
  }
});
