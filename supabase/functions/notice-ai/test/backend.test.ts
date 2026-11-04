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
  assertEquals(await resolveClaudeKey(async () => ({ key: SAVED }), env({ ANTHROPIC_API_KEY: ENVK })), { key: SAVED, source: 'app' });
  clearClaudeKeyCache();
  assertEquals(await resolveClaudeKey(async () => ({ key: null }), env({ ANTHROPIC_API_KEY: ENVK })), { key: ENVK, source: 'env' });
  clearClaudeKeyCache();
  assertEquals(await resolveClaudeKey(async () => { throw new Error('no table'); }, env({ ANTHROPIC_API_KEY: ENVK })), { key: ENVK, source: 'env' });
  clearClaudeKeyCache();
  assertEquals(await resolveClaudeKey(async () => ({ key: 'not-a-key' }), env({})), { key: null, source: 'none' });
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
