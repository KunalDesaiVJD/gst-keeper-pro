// ai-key: the Claude API key, set from the app (Reply Factory → AI → Claude API
// key; 4 November 2026, migration 20261104100000_ai_api_key_vault.sql).
//
// Request (POST, JSON): { action, actorId, sessionsEndedAt?, password?, key? }
//   status  what may be shown: the masked key, who saved it and when, and which
//           key the AI functions use now (the saved one, the ANTHROPIC_API_KEY
//           secret, or none)
//   save    { password, key }: the key, checked to start with sk-ant-, then
//           checked with Anthropic (the free Models API, no model is called; 10 s,
//           asked once more if Anthropic could not be reached) and saved into
//           Vault only when Anthropic accepts it: refused (400), no API credit
//           (400) or Anthropic unreachable (503) each answer one plain sentence
//   test    one tiny call to Claude with the key and model in use, answered OK or the error
//   remove  { password }: the saved key overwritten in Vault and forgotten
//   models  the models of the key's account the AI can use, from Anthropic's
//           live list, newest first, with the one chosen
//   set_model { model }: the model every AI call uses (checked against that live
//           list; empty goes back to Sonnet 5.5); the effort stays medium
//           (20261104120000_ai_api_model.sql)
// Only a superadmin or a GST Manager: the app has no server-checked session
// (custom sign-in, CLAUDE.md), so like doc-open this checks the actor id the
// page sends against the database, and a save or a removal also needs their
// own password, checked by the database function itself. The key goes to the
// database once and never comes back: no answer, log line or error carries it.
import { createClient } from '@supabase/supabase-js';
import { callClaude, checkClaudeKey, KEY_CHECK_WORDS, listClaudeModels, makeClaudeClient, NO_CREDIT, scrub } from '../notice-ai/claude.ts';
import { AI_EFFORT, AI_MODEL, isClaudeModelId } from '../_shared/aiModel.ts';
import { clearClaudeKeyCache, looksLikeClaudeKey, resolveClaudeKey } from '../_shared/claudeKey.ts';

export const VERSION = 'ai-key 1.1.0';

const SHAPE = 'That does not look like an Anthropic API key. It starts with sk-ant-. Copy it again from console.anthropic.com.';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 4096;
const TEST_TIMEOUT_MS = 30_000;

// What the database functions raise, said to the person as it is (they name nothing secret).
const PLAIN = [
  'Only a GST Manager or the superadmin can manage the Claude API key.',
  'Your password is not correct.',
  'That is not a Claude API key: it must start with sk-ant-.',
  'That is not a Claude model.',
];

function plainError(message: string | undefined, fallback: string): string {
  const m = message ?? '';
  return PLAIN.find((p) => m.includes(p)) ?? fallback;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const answer = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return answer(405, { error: 'POST only' });

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return answer(413, { error: 'The request is too large.' });
    body = JSON.parse(raw || '{}');
  } catch {
    return answer(400, { error: 'The request could not be read.' });
  }
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const action = str('action');
  const actorId = str('actorId');
  if (!UUID_RE.test(actorId)) return answer(401, { error: 'Please log in again.' });

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } });

  // Who is acting: a superadmin or a GST Manager, still signed in.
  const { data: roles, error: roleErr } = await sb.from('user_roles').select('role').eq('user_id', actorId);
  if (roleErr) return answer(500, { error: 'Who is signed in could not be checked. Try again.' });
  if (!(roles ?? []).some((r: { role: string }) => r.role === 'superadmin' || r.role === 'gst_manager')) {
    return answer(403, { error: 'Only a GST Manager or the superadmin can manage the Claude API key.' });
  }
  const { data: prof } = await sb.from('profiles').select('sessions_ended_at').eq('user_id', actorId).maybeSingle();
  const ended = prof?.sessions_ended_at as string | null | undefined;
  const signedInEnded = str('sessionsEndedAt') || null;
  if (ended && (!signedInEnded || new Date(ended).getTime() > new Date(signedInEnded).getTime())) {
    return answer(401, { error: 'You were logged out by an administrator. Please log in again.' });
  }

  const readSaved = async () => {
    const { data, error } = await sb.rpc('ai_api_key_read');
    if (error) throw new Error('read');
    return data as { key?: string | null } | null;
  };
  const readKeyAndModel = async () => {
    const r = await readSaved();
    const { data: model } = await sb.rpc('ai_api_model_read');
    return { ...(r ?? {}), model: (model as string | null) ?? null };
  };
  const modelStatus = async () => {
    const { data, error } = await sb.rpc('ai_api_model_status', { p_actor_id: actorId });
    // Before 20261104120000 is applied: nothing chosen.
    return error ? {} : (data as Record<string, unknown>);
  };
  const status = async () => {
    const { data, error } = await sb.rpc('ai_api_key_status', { p_actor_id: actorId });
    if (error) throw new Error(plainError(error.message, 'The key\'s details could not be read.'));
    const k = await resolveClaudeKey(readKeyAndModel);
    return {
      ...(data as Record<string, unknown>), ...(await modelStatus()),
      active: k.source, model_in_use: k.model, default_model: AI_MODEL, effort: AI_EFFORT,
      env_set: !!(Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim(),
    };
  };
  // Never the key: the status, the error type and the start of Anthropic's message.
  const log = (line: string) => console.log(JSON.stringify({ ai_key_check: line }));

  try {
    if (action === 'status') return answer(200, await status());

    if (action === 'save') {
      const key = str('key').trim();
      if (!looksLikeClaudeKey(key)) return answer(400, { error: SHAPE });
      if (!str('password')) return answer(400, { error: 'Your password is not correct.' });
      const check = await checkClaudeKey(key, { log });
      if (check !== 'ok') return answer(check === 'unavailable' ? 503 : 400, { error: KEY_CHECK_WORDS[check], check });
      const { error } = await sb.rpc('ai_api_key_set', { p_actor_id: actorId, p_password: str('password'), p_key: key });
      if (error) return answer(400, { error: plainError(error.message, 'The key could not be saved. Try again.') });
      clearClaudeKeyCache();
      return answer(200, await status());
    }

    if (action === 'remove') {
      const { error } = await sb.rpc('ai_api_key_remove', { p_actor_id: actorId, p_password: str('password') });
      if (error) return answer(400, { error: plainError(error.message, 'The key could not be removed. Try again.') });
      clearClaudeKeyCache();
      return answer(200, await status());
    }

    if (action === 'test') {
      clearClaudeKeyCache();
      const k = await resolveClaudeKey(readKeyAndModel);
      if (!k.key) return answer(200, { ok: false, active: k.source, error: 'No Claude API key is set: save one here, or set ANTHROPIC_API_KEY in Supabase.' });
      const client = makeClaudeClient({ apiKey: k.key, maxRetries: 0, timeoutMs: TEST_TIMEOUT_MS });
      const signal = AbortSignal.timeout(TEST_TIMEOUT_MS);
      const out = await callClaude(client, {
        model: k.model, effort: AI_EFFORT, budgets: [2048], signal, what: 'the test',
        system: 'This is a connection test. Answer with ok set to true.',
        content: [{ type: 'text', text: 'Connection test.' }],
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      }, k.model);
      const result = out.ok
        ? { ok: true, active: k.source, model: out.model, ms: out.usage.duration_ms }
        : { ok: false, active: k.source, error: out.reason === 'api_key' ? KEY_CHECK_WORDS.refused : scrub(out.error).slice(0, 300) };
      await sb.rpc('ai_api_key_log_test', { p_actor_id: actorId, p_outcome: result.ok ? 'ok' : String(result.error) });
      return answer(200, result);
    }

    if (action === 'models' || action === 'set_model') {
      const k = await resolveClaudeKey(readKeyAndModel);
      if (!k.key) return answer(400, { error: 'Save a Claude API key first: the models are those its account can use.' });
      const wanted = str('model').trim();
      if (action === 'set_model' && !wanted) {
        const { error } = await sb.rpc('ai_api_model_set', { p_actor_id: actorId, p_model: null, p_model_name: null });
        if (error) return answer(400, { error: plainError(error.message, 'The model could not be saved. Try again.') });
        clearClaudeKeyCache();
        return answer(200, await status());
      }
      if (action === 'set_model' && !isClaudeModelId(wanted)) return answer(400, { error: 'That is not a Claude model.' });
      const live = await listClaudeModels(k.key, { log });
      if (live.check !== 'ok') {
        const why = live.check === 'unavailable' ? 'Anthropic could not be reached to list the models. Try again in a minute.' : live.check === 'no_credit' ? NO_CREDIT : KEY_CHECK_WORDS.refused;
        return answer(live.check === 'unavailable' ? 503 : 400, { error: why, check: live.check });
      }
      if (action === 'models') return answer(200, { models: live.value, model_in_use: k.model, default_model: AI_MODEL, effort: AI_EFFORT });
      const pick = live.value.find((m) => m.id === wanted);
      if (!pick) return answer(400, { error: 'Anthropic does not offer that model to this key, or it cannot read PDFs and answer in the form the AI needs. Choose one from the list.' });
      const { error } = await sb.rpc('ai_api_model_set', { p_actor_id: actorId, p_model: pick.id, p_model_name: pick.name });
      if (error) return answer(400, { error: plainError(error.message, 'The model could not be saved. Try again.') });
      clearClaudeKeyCache();
      return answer(200, await status());
    }

    return answer(400, { error: 'Unknown action.' });
  } catch (e) {
    return answer(500, { error: scrub(String((e as Error)?.message ?? e)).slice(0, 300) });
  }
});
