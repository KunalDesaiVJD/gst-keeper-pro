// One request to the Claude API, the way every part of notice-ai asks: the
// fixed instructions (system), the content (a PDF document block and/or text),
// answered as JSON in the caller's schema (structured outputs). Streamed (a
// reading can be long), adaptive thinking, always at medium effort and with the
// model the caller was made with: the one chosen under Claude API key, else
// Sonnet 5.5 (../_shared/aiModel.ts), whatever model or effort a request names;
// the API's own fallback on a policy decline (fallbacks "default") for the
// models that take it. A reading cut off at max_tokens is asked once more with
// the model's whole output budget. Errors come back classified: retry later,
// failed, or failed and pause (the key was refused, or its account has no API
// credit). Ported from agent/src/read/claude.ts; the key is the one saved from
// the app, else the Edge Functions' ANTHROPIC_API_KEY secret. checkClaudeKey and
// listClaudeModels ask Anthropic's free Models API (no model is called).

import Anthropic, { APIError } from '@anthropic-ai/sdk';
import { AI_EFFORT, AI_MODEL, takesFallback } from '../_shared/aiModel.ts';

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

export const API_BASE_URL = 'https://api.anthropic.com';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// Thinking counts towards max_tokens.
export const TOKEN_BUDGETS = [64_000, 128_000] as const;
// The API takes requests of at most 32 MB; a PDF travels base64-encoded.
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const REQUEST_HEADROOM = 256 * 1024;

export function makeClaudeClient(opts: {
  apiKey: string;
  baseUrl?: string | null;
  fetch?: typeof fetch;
  maxRetries?: number;
  timeoutMs?: number;
}): Anthropic {
  return new Anthropic({
    apiKey: opts.apiKey,
    // Only the key from the secret: never a token from elsewhere.
    authToken: null,
    baseURL: opts.baseUrl || API_BASE_URL,
    maxRetries: opts.maxRetries ?? 2,
    timeout: opts.timeoutMs ?? 6 * 60_000,
    // Cast: supabase-js from npm brings Node's global types, whose RequestInit differs from Deno's.
    ...(opts.fetch ? { fetch: opts.fetch as unknown as NonNullable<ConstructorParameters<typeof Anthropic>[0]>['fetch'] } : {}),
  });
}

export interface CallUsage {
  // Everything billed as input, cache reads and writes included.
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  request_id: string | null;
  status: 'ok' | 'refused' | 'error';
  model: string;
  calls: number;
  fallback?: { from: string; to: string };
  // Tokens of an unbilled call (the CLI gateway), shown to staff but never priced;
  // estimated when the gateway does not report them.
  tokens_in?: number;
  tokens_out?: number;
  estimated?: boolean;
  // The start and end of an answer that could not be read (cli.ts), to see why.
  raw_sample?: string;
  // Read from a scan or a photo (the gateway opened the file itself): its
  // quotes could not be checked against a text layer.
  read_from?: 'scan';
  // What a reading from a scan leaves for staff to confirm (a GSTIN whose check character fails).
  doubts?: string[];
}

export type CallOutcome =
  | { ok: true; json: unknown; model: string; usage: CallUsage }
  | { ok: false; status: 'retry' | 'failed'; reason: string; error: string; usage: CallUsage | null; pause?: string };

export interface CallRequest {
  model: string;
  effort: string;
  system: string;
  content: ContentBlock[];
  schema: Record<string, unknown>;
  budgets?: readonly number[];
  signal?: AbortSignal;
  // What the model reads, for the error messages ("the notice", "the document").
  what?: string;
  // The PDF's own text, page by page, when the request carries a PDF: what the
  // Claude CLI gateway reads instead of the PDF (it takes text only).
  pdfText?: { pages: string[]; textLayer: boolean; read?: number[]; pageCount?: number | null };
  // A scan or photo the gateway opens itself from this project's storage (scan.ts).
  file?: FileRef;
  // How long the call may take (a scan's read is given what is left of the run).
  timeoutMs?: number;
}

/** A file of this project's storage for the gateway to open, and what to tell the model about it. */
export interface FileRef {
  bucket: string;
  path: string;
  filename: string;
  mediaType: string;
  note: string;
}

/** One way of asking Claude: the Claude API (callClaude) or the Claude CLI gateway (cli.ts). */
export type Caller = ((req: CallRequest) => Promise<CallOutcome>) & {
  backend?: 'api' | 'cli' | 'cli+api';
  // The gateway opens files of this project's storage (GST Keeper's own, api/claude-cli.ts).
  files?: boolean;
};

export function apiCaller(client: Anthropic, model: string = AI_MODEL): Caller {
  const c: Caller = (req) => callClaude(client, req, model);
  c.backend = 'api';
  return c;
}

/** The request as it is sent: the caller's model at the one effort, whatever it named. */
export function pinned<T extends { model: string; effort: string }>(req: T, model: string = AI_MODEL): T {
  return { ...req, model, effort: AI_EFFORT };
}

export function buildParams(req: CallRequest, maxTokens: number, model: string = AI_MODEL): Params {
  return {
    model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: AI_EFFORT, format: { type: 'json_schema', schema: req.schema } },
    system: req.system,
    messages: [{ role: 'user', content: req.content }],
    // The models that take it get the API's own fallback on a policy decline
    // (Haiku, for one, has none).
    ...(takesFallback(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
  };
}

// Tokens billed for one response. With a fallback, usage.iterations has one
// entry per attempt and the top-level usage only the attempt that answered.
export function billedTokens(usage: Partial<BetaMessage['usage']> | undefined | null): { input: number; output: number } {
  if (!usage) return { input: 0, output: 0 };
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const its = Array.isArray(usage.iterations) ? usage.iterations : [];
  const rows: Array<Record<string, unknown>> = its.length ? (its as unknown as Array<Record<string, unknown>>) : [usage as Record<string, unknown>];
  return rows.reduce<{ input: number; output: number }>((s, r) => ({
    input: s.input + n(r.input_tokens) + n(r.cache_creation_input_tokens) + n(r.cache_read_input_tokens),
    output: s.output + n(r.output_tokens),
  }), { input: 0, output: 0 });
}

// The answer is the text after the last fallback block: a model that declined
// mid-answer leaves a partial before it, which is not part of the answer.
export function answerText(msg: Pick<BetaMessage, 'content'>): string {
  let start = 0;
  msg.content.forEach((b, i) => { if (b.type === 'fallback') start = i + 1; });
  return msg.content.slice(start).map((b) => (b.type === 'text' ? b.text : '')).join('');
}

// Keys never reach a log or the database, even inside an error message.
export function scrub(s: string): string {
  return s.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…');
}

const brief = (e: unknown) => scrub(((e as Error)?.message || String(e)).replace(/\s+/g, ' ')).slice(0, 300);

/** What the admin is told when the key's account has no API credit (the Claude API and the key check alike). */
export const NO_CREDIT = 'Anthropic knows this key, but its account has no API credit. Add credit at console.anthropic.com › Settings › Billing (a Claude subscription does not cover the API).';

/** An API error saying the account has no credit: a 400 invalid_request_error "credit balance is too low", or a 402. */
export function isNoCredit(e: unknown): boolean {
  if (!(e instanceof Anthropic.APIError)) return false;
  if (e.status === 402) return true;
  return e.status === 400 && /credit balance/i.test(String(e.message ?? ''));
}

export interface ErrorClass {
  status: 'retry' | 'failed';
  reason: string;
  error: string;
  pause?: string;
}

export function classifyError(e: unknown, stopped: boolean, what = 'the document'): ErrorClass {
  if (e instanceof Anthropic.APIUserAbortError || stopped) {
    return { status: 'retry', reason: 'timeout', error: `Reading ${what} took longer than this run had left; it is tried again in the next run.` };
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return { status: 'retry', reason: 'api_key', error: 'The Claude API refused the key in use (the one saved under Claude API key, else the ANTHROPIC_API_KEY secret).', pause: 'api_key' };
  }
  if (isNoCredit(e)) return { status: 'retry', reason: 'api_billing', error: NO_CREDIT, pause: 'api_billing' };
  if (e instanceof Anthropic.PermissionDeniedError) {
    return { status: 'retry', reason: 'api_permission', error: `The Claude API refused this request for the key's organisation: ${brief(e)}`, pause: 'api_permission' };
  }
  if (e instanceof Anthropic.RateLimitError) return { status: 'retry', reason: 'rate_limited', error: 'The Claude API rate limit was reached.' };
  if (e instanceof Anthropic.InternalServerError) return { status: 'retry', reason: 'api_unavailable', error: `The Claude API is unavailable (${(e as APIError).status}).` };
  if (e instanceof Anthropic.APIConnectionError) return { status: 'retry', reason: 'connection', error: `The Claude API could not be reached: ${brief(e)}` };
  if (e instanceof Anthropic.BadRequestError) {
    const m = brief(e);
    if (/pdf pages|maximum of \d+ pdf|too many pages/i.test(m)) return { status: 'failed', reason: 'too_long', error: `${what[0].toUpperCase()}${what.slice(1)} has more pages than the Claude API takes in one request.` };
    return { status: 'failed', reason: 'bad_request', error: `The Claude API rejected the request: ${m}` };
  }
  if (e instanceof Anthropic.NotFoundError) return { status: 'failed', reason: 'model_unavailable', error: `The model is not available to this API key (choose another under Claude API key): ${brief(e)}` };
  if (e instanceof Anthropic.APIError) {
    const st = e.status ?? 0;
    if (st === 413) return { status: 'failed', reason: 'too_large', error: `${what[0].toUpperCase()}${what.slice(1)} is too large for the Claude API.` };
    if (st >= 500 || st === 408 || st === 409) return { status: 'retry', reason: 'api_unavailable', error: `The Claude API is unavailable (${st}).` };
    return { status: 'failed', reason: 'bad_request', error: `The Claude API rejected the request (${st}): ${brief(e)}` };
  }
  // The SDK's own errors without an HTTP status: the answer's stream was cut off.
  if (e instanceof Anthropic.AnthropicError) return { status: 'retry', reason: 'connection', error: `The answer from the Claude API was cut off: ${brief(e)}` };
  return { status: 'retry', reason: 'api_error', error: `The request failed: ${brief(e)}` };
}

export function requestBytes(content: ContentBlock[]): number {
  let n = 0;
  for (const b of content) {
    if (b.type === 'document' && b.source.type === 'base64') n += b.source.data.length;
    else if (b.type === 'text') n += b.text.length * 3;
  }
  return n;
}

export async function callClaude(client: Anthropic, asked: CallRequest, model: string = AI_MODEL): Promise<CallOutcome> {
  const req = pinned(asked, model);
  const what = req.what ?? 'the document';
  if (requestBytes(req.content) + REQUEST_HEADROOM > MAX_REQUEST_BYTES) {
    return { ok: false, status: 'failed', reason: 'too_large', error: `${what[0].toUpperCase()}${what.slice(1)} is too large to send to the Claude API (32 MB a request).`, usage: null };
  }
  const started = Date.now();
  const usage: CallUsage = { input_tokens: 0, output_tokens: 0, duration_ms: 0, request_id: null, status: 'ok', model, calls: 0 };
  const ids: string[] = [];
  const count = (u: Partial<BetaMessage['usage']> | undefined | null, requestId: string | null | undefined, model?: string) => {
    const b = billedTokens(u);
    usage.input_tokens += b.input;
    usage.output_tokens += b.output;
    usage.calls += 1;
    if (requestId) ids.push(requestId);
    if (model) usage.model = model;
    usage.request_id = ids.length ? ids.join(' ') : null;
    usage.duration_ms = Date.now() - started;
  };

  const budgets = req.budgets ?? TOKEN_BUDGETS;
  for (const budget of budgets) {
    let stream: ReturnType<typeof client.beta.messages.stream> | null = null;
    let msg: BetaMessage;
    try {
      stream = client.beta.messages.stream(buildParams(req, budget, model), { signal: req.signal });
      msg = await stream.finalMessage();
    } catch (e) {
      // What the API had counted before the failure (input tokens arrive with
      // the stream's first event) is still billed.
      count(stream?.currentMessage?.usage, (e instanceof APIError ? e.requestID : null) ?? stream?.request_id ?? null);
      usage.status = 'error';
      const c = classifyError(e, !!req.signal?.aborted, what);
      return { ok: false, ...c, usage };
    }
    count(msg.usage, stream.request_id ?? null, msg.model);
    const fb = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaFallbackBlock => b.type === 'fallback').at(-1);
    if (fb) usage.fallback = { from: fb.from.model, to: fb.to.model };

    switch (msg.stop_reason) {
      case 'refusal': {
        usage.status = 'refused';
        const cat = msg.stop_details?.category;
        return { ok: false, status: 'failed', reason: 'refused', error: `The model declined to read ${what}${cat ? ` (${cat})` : ''}.`, usage };
      }
      case 'max_tokens':
        if (budget !== budgets[budgets.length - 1]) continue;
        usage.status = 'error';
        return { ok: false, status: 'failed', reason: 'max_tokens', error: 'The answer did not fit in the model\'s output budget.', usage };
      case 'model_context_window_exceeded':
        usage.status = 'error';
        return { ok: false, status: 'failed', reason: 'too_long', error: `${what[0].toUpperCase()}${what.slice(1)} is too long for the model's context window.`, usage };
      case 'end_turn':
      case 'stop_sequence': {
        try {
          return { ok: true, json: JSON.parse(answerText(msg)), model: msg.model, usage };
        } catch {
          usage.status = 'error';
          return { ok: false, status: 'failed', reason: 'bad_output', error: 'The model\'s answer was not the expected JSON.', usage };
        }
      }
      default:
        usage.status = 'error';
        return { ok: false, status: 'failed', reason: 'bad_output', error: `The model stopped unexpectedly (${msg.stop_reason ?? 'no reason'}).`, usage };
    }
  }
  usage.status = 'error';
  return { ok: false, status: 'failed', reason: 'max_tokens', error: 'The answer did not fit in the model\'s output budget.', usage };
}

// ── The key check and the model list: Anthropic's free Models API ─────────────

export const KEY_CHECK_TIMEOUT_MS = 10_000;

/** What Anthropic said of a key: it works, it is refused, its account has no credit, or Anthropic could not be asked. */
export type KeyCheck = 'ok' | 'refused' | 'no_credit' | 'unavailable';

/** The sentences the admin reads for each answer but ok. */
export const KEY_CHECK_WORDS: Record<Exclude<KeyCheck, 'ok'>, string> = {
  refused: 'Anthropic did not accept this key. Check that it was copied whole and has not been turned off.',
  no_credit: 'Anthropic knows this key, but its account has no API credit, so it was not saved. Add credit at console.anthropic.com › Settings › Billing (a Claude subscription does not cover the API), then paste it again.',
  unavailable: 'Anthropic could not be reached to check the key, so it was not saved. Try again in a minute.',
};

export function classifyKeyCheck(e: unknown): Exclude<KeyCheck, 'ok'> {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'refused';
  if (e instanceof Anthropic.APIError) {
    const t = (e as APIError & { type?: string | null }).type ?? (e.error as { error?: { type?: string } } | undefined)?.error?.type;
    if (t === 'authentication_error' || t === 'permission_error') return 'refused';
    if (isNoCredit(e)) return 'no_credit';
  }
  // A network error, a timeout, a 5xx or 529, a rate limit or any other answer.
  return 'unavailable';
}

/** One line for a log about a failed check: the status, the error type and the start of the message, the key scrubbed. */
export function keyCheckLogLine(e: unknown): string {
  if (e instanceof Anthropic.APIError) {
    const t = (e as APIError & { type?: string | null }).type ?? '';
    return scrub(`${e.status ?? '-'} ${t} ${String(e.message ?? '')}`.replace(/\s+/g, ' ')).slice(0, 200);
  }
  return scrub(String((e as Error)?.name ?? 'error')).slice(0, 200);
}

/**
 * Asks the Models API (GET /v1/models, free, calls no model) with this key, once
 * more on "unavailable" unless the caller stopped it. `list` gets the answer's
 * models when it is wanted.
 */
export async function withModelsApi<T>(
  apiKey: string,
  ask: (client: Anthropic) => Promise<T>,
  opts: { fetch?: typeof fetch; signal?: AbortSignal; log?: (line: string) => void } = {},
): Promise<{ check: 'ok'; value: T } | { check: Exclude<KeyCheck, 'ok'> }> {
  const client = makeClaudeClient({ apiKey, maxRetries: 0, timeoutMs: KEY_CHECK_TIMEOUT_MS, fetch: opts.fetch });
  let last: Exclude<KeyCheck, 'ok'> = 'unavailable';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { check: 'ok', value: await ask(client) };
    } catch (e) {
      last = classifyKeyCheck(e);
      opts.log?.(keyCheckLogLine(e));
      if (last !== 'unavailable' || opts.signal?.aborted) break;
    }
  }
  return { check: last };
}

/** Checks a key before it is saved. */
export async function checkClaudeKey(apiKey: string, opts: { fetch?: typeof fetch; signal?: AbortSignal; log?: (line: string) => void } = {}): Promise<KeyCheck> {
  const r = await withModelsApi(apiKey, (c) => c.models.list({ limit: 1 }, { signal: opts.signal }), opts);
  return r.check;
}

/** One model the AI can use: it reads PDFs, answers in a JSON schema, thinks adaptively and takes medium effort. */
export interface ModelChoice {
  id: string;
  name: string;
  created_at: string | null;
  max_input_tokens: number | null;
}

type ModelInfo = Anthropic.Models.ModelInfo;

export function usableModel(m: ModelInfo): boolean {
  if (!/^claude-/.test(m.id)) return false;
  const c = m.capabilities;
  if (!c) return false;
  return !!(c.pdf_input?.supported && c.structured_outputs?.supported && c.thinking?.types?.adaptive?.supported && c.effort?.medium?.supported);
}

/** The models of the key's account the AI can use, newest first. */
export function toModelChoices(list: ModelInfo[]): ModelChoice[] {
  return list.filter(usableModel)
    .map((m) => ({ id: m.id, name: m.display_name || m.id, created_at: m.created_at ?? null, max_input_tokens: m.max_input_tokens ?? null }))
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
}

/** The live list (every page), or why it could not be had. */
export async function listClaudeModels(apiKey: string, opts: { fetch?: typeof fetch; signal?: AbortSignal; log?: (line: string) => void } = {}) {
  return withModelsApi(apiKey, async (c) => {
    const all: ModelInfo[] = [];
    for await (const m of c.models.list({ limit: 100 }, { signal: opts.signal })) {
      all.push(m);
      if (all.length >= 500) break;
    }
    return toModelChoices(all);
  }, opts);
}
