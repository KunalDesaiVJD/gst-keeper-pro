#!/usr/bin/env node
// Every AI call in GST Keeper is Claude Sonnet at medium effort (the firm's rule,
// 25 Oct 2026). This check fails when code could ask for anything else:
//   1. the one definition (supabase/functions/_shared/aiModel.ts) and the office
//      agent's copy (agent/src/read/aiModel.ts) say Sonnet, "sonnet", medium;
//   2. no source file names a Claude model id, or the model itself, other than
//      through those constants (a test may, to prove a request is pinned);
//   3. only the known callers talk to Claude (the SDK or the CLI gateway), and
//      each sends the constants, never a request's own model or effort;
//   4. no effort other than medium is written in the AI code;
//   5. the database refuses any other model or effort (20261025190000), and no
//      later migration names another model.
// Run by `npm run typecheck`; on its own: node scripts/verify-ai-model.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fail = [];

const SHARED = 'supabase/functions/_shared/aiModel.ts';
const AGENT_COPY = 'agent/src/read/aiModel.ts';
const MODEL = 'claude-sonnet-5-5';
const CLI_MODEL = 'sonnet';
const EFFORT = 'medium';

// 1. The definition and its copy.
const constants = (p) => {
  const s = read(p);
  const get = (name) => s.match(new RegExp(`export const ${name} = '([^']*)';`))?.[1];
  return { AI_MODEL: get('AI_MODEL'), AI_CLI_MODEL: get('AI_CLI_MODEL'), AI_EFFORT: get('AI_EFFORT') };
};
for (const p of [SHARED, AGENT_COPY]) {
  const c = constants(p);
  if (c.AI_MODEL !== MODEL || c.AI_CLI_MODEL !== CLI_MODEL || c.AI_EFFORT !== EFFORT) {
    fail.push(`${p}: must define AI_MODEL '${MODEL}', AI_CLI_MODEL '${CLI_MODEL}', AI_EFFORT '${EFFORT}' (found ${JSON.stringify(c)})`);
  }
}

// The source the app, the Edge Functions and the office agent run.
const SKIP_DIR = new Set(['node_modules', 'dist', 'test', 'tests', '__tests__', 'fixtures']);
function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && !/\.(test|spec)\.\w+$/.test(e.name)) out.push(path.join(dir, e.name).replace(/\\/g, '/'));
  }
  return out;
}
const files = [...walk('src'), ...walk('supabase/functions'), ...walk('agent/src')];

// 2. Model ids and CLI model names.
const MODEL_ID = /\bclaude-(?:opus|sonnet|haiku|fable|instant|\d)[\w.-]*/gi;
const CLI_NAME = /['"`](?:opus|haiku|fable)['"`]/gi;
// Display only: the name of the model an earlier record says it used.
const DISPLAY_ONLY = new Set(['src/lib/noticeFormat.ts']);
for (const f of files) {
  if (f === SHARED || f === AGENT_COPY) continue;
  const s = read(f);
  for (const m of s.match(MODEL_ID) ?? []) fail.push(`${f}: names the model "${m}"; use AI_MODEL from ${SHARED}`);
  if (!DISPLAY_ONLY.has(f)) for (const m of s.match(CLI_NAME) ?? []) fail.push(`${f}: names the model ${m}; every call is ${CLI_MODEL}`);
}

// 3. Who talks to Claude, and how.
const CALLERS = {
  'supabase/functions/notice-ai/claude.ts': [/model: AI_MODEL,/, /effort: AI_EFFORT,/, /const req = pinned\(asked\);/],
  'supabase/functions/notice-ai/cli.ts': [/const model = AI_CLI_MODEL;/, /model, effort: AI_EFFORT, timeoutMs/],
  'agent/src/read/claude.ts': [/model: AI_MODEL,/, /effort: AI_EFFORT,/, /model: AI_MODEL, effort: AI_EFFORT \}/],
};
const TALKS = [/@anthropic-ai\/sdk['"]/, /\bnew Anthropic\(/, /\.messages\.(?:create|stream|countTokens)\(/, /api\.anthropic\.com\/v1/];
for (const f of files) {
  const s = read(f);
  const sdkValue = TALKS.some((re) => re.test(s)) && !/^import type Anthropic from '@anthropic-ai\/sdk';$/m.test(s);
  if (sdkValue && !CALLERS[f]) fail.push(`${f}: talks to the Claude API outside the pinned callers (${Object.keys(CALLERS).join(', ')})`);
  if (/CLAUDE_CLI_GATEWAY/.test(s) && /\bfetch\(/.test(s) && !CALLERS[f]) fail.push(`${f}: calls the Claude CLI gateway outside notice-ai/cli.ts`);
}
for (const [f, needs] of Object.entries(CALLERS)) {
  const s = read(f);
  for (const re of needs) if (!re.test(s)) fail.push(`${f}: no longer pins the call (${re})`);
  if (/model: req\.model|effort: req\.effort|req\.effort \|\||effort: claim\.effort|model: claim\.model/.test(s)) fail.push(`${f}: sends a request's own model or effort`);
}

// 4. Effort literals in the AI code.
const AI_CODE = files.filter((f) => f.startsWith('supabase/functions/notice-') || f.startsWith('agent/src/read/') || f === 'src/lib/replyFactory.ts' || f.startsWith('src/components/notices/reply/factory/'));
for (const f of AI_CODE) {
  const s = read(f);
  for (const m of s.matchAll(/\beffort\w*['"]?\s*[:=]\s*(?:[\w?.]+\s*(?:\?\?|\|\|)\s*)?['"`](\w+)['"`]/g)) {
    if (m[1] !== EFFORT) fail.push(`${f}: sets an effort "${m[1]}"; every call is ${EFFORT}`);
  }
  if (/\bclaim\.(?:model|effort)\b|settings\??\.(?:model|effort|doc_model|doc_effort|assist_effort)\b/.test(s)) fail.push(`${f}: reads a model or effort from the settings; use AI_MODEL / AI_EFFORT`);
}

// 5. The database.
const MIG_DIR = 'supabase/migrations';
const GUARD_MIG = '20261025190000_ai_model_sonnet_medium.sql';
const migs = fs.readdirSync(path.join(ROOT, MIG_DIR)).filter((f) => f.endsWith('.sql')).sort();
if (!migs.includes(GUARD_MIG)) fail.push(`${MIG_DIR}/${GUARD_MIG} is missing`);
else {
  const s = read(`${MIG_DIR}/${GUARD_MIG}`);
  if (!/ai_settings_sonnet_medium_only CHECK \(\s*model = 'claude-sonnet-5-5' AND doc_model = 'claude-sonnet-5-5'\s*AND effort = 'medium' AND doc_effort = 'medium' AND assist_effort = 'medium'\)/.test(s)) {
    fail.push(`${MIG_DIR}/${GUARD_MIG}: the CHECK must hold every model and effort column to Sonnet, medium`);
  }
}
for (const f of migs.filter((m) => m > GUARD_MIG)) {
  const s = read(`${MIG_DIR}/${f}`);
  for (const m of s.match(MODEL_ID) ?? []) if (m !== MODEL) fail.push(`${MIG_DIR}/${f}: names the model "${m}"`);
  if (/ai_settings_sonnet_medium_only/.test(s) && /DROP CONSTRAINT/i.test(s)) fail.push(`${MIG_DIR}/${f}: drops the Sonnet medium constraint`);
  if (/ALTER TABLE\s+(?:public\.)?ai_settings[\s\S]*?ADD COLUMN[^;]*(?:model|effort)/i.test(s)) fail.push(`${MIG_DIR}/${f}: adds a model or effort column to ai_settings; add it to ai_settings_sonnet_medium_only too and to this check`);
}

if (fail.length) {
  console.error(fail.map((l) => `  ${l}`).join('\n'));
  console.error(`\nverify-ai-model: FAILED, ${fail.length} problem(s). Every AI call is Claude Sonnet at medium effort (${SHARED}).`);
  process.exit(1);
}
console.log(`verify-ai-model: ok, every AI call is ${MODEL} at ${EFFORT} effort (${files.length} files checked).`);
