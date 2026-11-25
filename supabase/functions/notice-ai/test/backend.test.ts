// The key order (saved from the app, then ANTHROPIC_API_KEY), the two-minute
// cache and its clearing, and the backend chosen (the Claude API whenever a key
// is set; the CLI gateway only with none).
import { assertEquals } from '@std/assert';
import { clearClaudeKeyCache, KEY_CACHE_MS, looksLikeClaudeKey, maskKey, resolveClaudeKey } from '../../_shared/claudeKey.ts';
import { pickCaller } from '../backend.ts';

const SAVED = 'sk-ant-api03-savedSAVEDsaved0123456789-a1b2';
const ENVK = 'sk-ant-api03-envENVenvENV0123456789abcd-z9y8';
const env = (m: Record<string, string>) => (k: string) => m[k];

Deno.test('key: the saved key first, then the secret, then none', async () => {
  clearClaudeKeyCache();
  assertEquals(await resolveClaudeKey(async () => ({ key: SAVED }), env({ ANTHROPIC_API_KEY: ENVK })), { key: SAVED, source: 'app', model: 'claude-sonnet-5-5' });
  clearClaudeKeyCache();
  assertEquals(await resolveClaudeKey(async () => ({ key: null }), env({ ANTHROPIC_API_KEY: ENVK })), { key: ENVK, source: 'env', model: 'claude-sonnet-5-5' });
  clearClaudeKeyCache();
  assertEquals(await resolveClaudeKey(async () => { throw new Error('no table'); }, env({ ANTHROPIC_API_KEY: ENVK })), { key: ENVK, source: 'env', model: 'claude-sonnet-5-5' });
  clearClaudeKeyCache();
  assertEquals(await resolveClaudeKey(async () => ({ key: 'not-a-key' }), env({})), { key: null, source: 'none', model: 'claude-sonnet-5-5' });
});

Deno.test('key: read once per two minutes, again after a clear', async () => {
  clearClaudeKeyCache();
  let reads = 0;
  let t = 1_000;
  const read = async () => { reads++; return { key: SAVED }; };
  await resolveClaudeKey(read, env({}), () => t);
  t += KEY_CACHE_MS - 1;
  await resolveClaudeKey(read, env({}), () => t);
  assertEquals(reads, 1);
  t += 2;
  await resolveClaudeKey(read, env({}), () => t);
  assertEquals(reads, 2);
  clearClaudeKeyCache();
  await resolveClaudeKey(read, env({}), () => t);
  assertEquals(reads, 3);
});

Deno.test('key: format and mask', () => {
  assertEquals(looksLikeClaudeKey(SAVED), true);
  assertEquals(looksLikeClaudeKey('sk-proj-123'), false);
  assertEquals(looksLikeClaudeKey('sk-ant-short'), false);
  assertEquals(maskKey(SAVED), 'sk-ant-…a1b2');
});

Deno.test('backend: the Claude API with a key, the gateway only without one', () => {
  const gw = env({ CLAUDE_CLI_GATEWAY_URL: 'https://gw.example/api', CLAUDE_CLI_GATEWAY_SECRET: 's' });
  assertEquals(pickCaller(SAVED, gw)?.backend, 'api');
  assertEquals(pickCaller(null, gw)?.backend, 'cli');
  assertEquals(pickCaller(null, env({})), null);
});

// ── The chosen model (20261104120000), the key check and the live list ──────────
import Anthropic from '@anthropic-ai/sdk';
import {
  buildParams, checkClaudeKey, classifyError, classifyKeyCheck, KEY_CHECK_WORDS, listClaudeModels, NO_CREDIT, toModelChoices,
} from '../claude.ts';
import { rpcKeyReader } from '../backend.ts';

Deno.test('model: the chosen one travels with the key; a bad or missing one is Sonnet', async () => {
  clearClaudeKeyCache();
  assertEquals(await resolveClaudeKey(async () => ({ key: SAVED, model: 'claude-opus-5-5' }), env({})), { key: SAVED, source: 'app', model: 'claude-opus-5-5' });
  clearClaudeKeyCache();
  assertEquals(await resolveClaudeKey(async () => ({ key: null, model: 'claude-haiku-5-5' }), env({ ANTHROPIC_API_KEY: ENVK })), { key: ENVK, source: 'env', model: 'claude-haiku-5-5' });
  clearClaudeKeyCache();
  assertEquals((await resolveClaudeKey(async () => ({ key: SAVED, model: 'gpt-5; drop' }), env({}))).model, 'claude-sonnet-5-5');
  clearClaudeKeyCache();
  // A model that cannot be read never loses the key.
  const reader = rpcKeyReader(async (fn) => { if (fn === 'ai_api_model_read') throw new Error('no function'); return { key: SAVED }; });
  assertEquals(await resolveClaudeKey(reader, env({})), { key: SAVED, source: 'app', model: 'claude-sonnet-5-5' });
  clearClaudeKeyCache();
});

Deno.test('model: medium effort always; fallbacks only for the models that take them', () => {
  const req = { model: 'x', effort: 'max', system: 's', content: [{ type: 'text' as const, text: 't' }], schema: { type: 'object' } };
  const haiku = buildParams(req, 100, 'claude-haiku-5-5') as unknown as Record<string, unknown>;
  assertEquals(haiku.model, 'claude-haiku-5-5');
  assertEquals((haiku.output_config as { effort: string }).effort, 'medium');
  assertEquals('fallbacks' in haiku || 'betas' in haiku, false);
  const opus = buildParams(req, 100, 'claude-opus-5-5') as unknown as Record<string, unknown>;
  assertEquals(opus.fallbacks, 'default');
  assertEquals((buildParams(req, 100) as unknown as Record<string, unknown>).model, 'claude-sonnet-5-5');
});

const apiErr = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, message, new Headers());

Deno.test('no credit: the call pauses with the plain sentence, not a failed document', () => {
  const c = classifyError(apiErr(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), false);
  assertEquals(c, { status: 'retry', reason: 'api_billing', error: NO_CREDIT, pause: 'api_billing' });
  assertEquals(classifyError(apiErr(402, 'billing_error', 'billing'), false).pause, 'api_billing');
  assertEquals(classifyError(apiErr(400, 'invalid_request_error', 'bad schema'), false).reason, 'bad_request');
  assertEquals(classifyError(apiErr(401, 'authentication_error', 'invalid x-api-key'), false).pause, 'api_key');
});

Deno.test('key check: ok, refused, no credit, unavailable', () => {
  assertEquals(classifyKeyCheck(apiErr(401, 'authentication_error', 'invalid x-api-key')), 'refused');
  assertEquals(classifyKeyCheck(apiErr(403, 'permission_error', 'no')), 'refused');
  assertEquals(classifyKeyCheck(apiErr(400, 'invalid_request_error', 'Your credit balance is too low')), 'no_credit');
  assertEquals(classifyKeyCheck(apiErr(529, 'overloaded_error', 'busy')), 'unavailable');
  assertEquals(classifyKeyCheck(apiErr(404, 'not_found_error', 'x')), 'unavailable');
  assertEquals(classifyKeyCheck(new TypeError('fetch failed')), 'unavailable');
  for (const w of Object.values(KEY_CHECK_WORDS)) assertEquals(/sk-ant-/.test(w), false);
});

const models = [
  { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-09-01T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000, capabilities: caps(true) },
  { type: 'model', id: 'claude-fable-5-1', display_name: 'Claude Fable 5.1', created_at: '2026-10-01T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000, capabilities: caps(true) },
  { type: 'model', id: 'claude-3-old', display_name: 'Old', created_at: '2024-01-01T00:00:00Z', max_input_tokens: 200000, max_tokens: 4096, capabilities: caps(false) },
  { type: 'model', id: 'claude-no-caps', display_name: 'No caps', created_at: '2026-11-01T00:00:00Z', max_input_tokens: null, max_tokens: null, capabilities: null },
];
function caps(on: boolean) {
  const s = { supported: on };
  return { pdf_input: s, structured_outputs: s, thinking: { supported: on, types: { adaptive: s, enabled: { supported: false } } }, effort: { supported: on, low: s, medium: s, high: s, max: s, xhigh: s } };
}

Deno.test('models: only those that read PDFs, answer in JSON, think adaptively at medium effort; newest first', () => {
  // deno-lint-ignore no-explicit-any
  assertEquals(toModelChoices(models as any).map((m) => m.id), ['claude-fable-5-1', 'claude-haiku-5-5']);
});

// A fake Models API: answers in turn, recording what it was asked (never logging the key).
function modelsApi(answers: Array<{ status: number; body: unknown } | 'network'>) {
  const asked: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    const a = answers.shift() ?? { status: 500, body: {} };
    if (a === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, asked };
}
const page = (data: unknown[]) => ({ data, has_more: false, first_id: null, last_id: null });

Deno.test('key check: GET /v1/models, once more only when Anthropic could not be reached', async () => {
  let api = modelsApi([{ status: 200, body: page([]) }]);
  assertEquals(await checkClaudeKey(SAVED, { fetch: api.f }), 'ok');
  assertEquals(api.asked, ['GET /v1/models']);

  api = modelsApi(['network', { status: 200, body: page([]) }]);
  assertEquals(await checkClaudeKey(SAVED, { fetch: api.f }), 'ok');
  assertEquals(api.asked.length, 2);

  api = modelsApi([{ status: 503, body: {} }, { status: 503, body: {} }, { status: 200, body: page([]) }]);
  assertEquals(await checkClaudeKey(SAVED, { fetch: api.f }), 'unavailable');
  assertEquals(api.asked.length, 2);

  const lines: string[] = [];
  api = modelsApi([{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${SAVED}` } } }]);
  assertEquals(await checkClaudeKey(SAVED, { fetch: api.f, log: (l) => lines.push(l) }), 'refused');
  assertEquals(api.asked.length, 1);
  assertEquals(lines.some((l) => l.includes(SAVED)), false);
  assertEquals(lines[0].startsWith('401 authentication_error'), true);

  api = modelsApi([{ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } }]);
  assertEquals(await checkClaudeKey(SAVED, { fetch: api.f }), 'no_credit');
  assertEquals(api.asked.length, 1);
});

Deno.test('models: the live list, filtered', async () => {
  const api = modelsApi([{ status: 200, body: page(models) }]);
  const r = await listClaudeModels(SAVED, { fetch: api.f });
  assertEquals(r.check, 'ok');
  if (r.check === 'ok') assertEquals(r.value.map((m) => m.name), ['Claude Fable 5.1', 'Claude Haiku 5.5']);
});
