// One request to the Claude API, the way every part of notice-ai asks: the
// fixed instructions (system), the content (a PDF document block and/or text),
// answered as JSON in the caller's schema (structured outputs). Streamed (a
// reading can be long), adaptive thinking at the effort set in the app, and the
// API's own fallback on a policy decline (fallbacks "default"). A reading cut off
// at max_tokens is asked once more with the model's whole output budget. Errors
// come back classified: retry later, failed, or failed and pause (the key was
// refused). Ported from agent/src/read/claude.ts; the key is the Edge Functions'
// ANTHROPIC_API_KEY secret.

import Anthropic, { APIError } from '@anthropic-ai/sdk';

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const API_BASE_URL = 'https://api.anthropic.com';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// Models whose fallbacks: "default" is documented; any other model the app is
// set to is asked without a fallback rather than refused with a 400.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
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
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
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
  pdfText?: { pages: string[]; textLayer: boolean };
}

/** One way of asking Claude: the Claude API (callClaude) or the Claude CLI gateway (cli.ts). */
export type Caller = ((req: CallRequest) => Promise<CallOutcome>) & { backend?: 'api' | 'cli' | 'cli+api' };

export function apiCaller(client: Anthropic): Caller {
  const c: Caller = (req) => callClaude(client, req);
  c.backend = 'api';
  return c;
}

// Haiku 4.5 takes no effort level and no adaptive thinking, and answers at most
// 64K tokens: it is asked without them.
export const isHaiku = (model: string) => /haiku/i.test(model);

export function buildParams(req: CallRequest, maxTokens: number): Params {
  const effort = (EFFORTS as readonly string[]).includes(req.effort) ? (req.effort as Effort) : 'high';
  const params: Params = isHaiku(req.model)
    ? {
      model: req.model,
      max_tokens: Math.min(maxTokens, 64_000),
      output_config: { format: { type: 'json_schema', schema: req.schema } },
      system: req.system,
      messages: [{ role: 'user', content: req.content }],
    }
    : {
      model: req.model,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort, format: { type: 'json_schema', schema: req.schema } },
      system: req.system,
      messages: [{ role: 'user', content: req.content }],
    };
  if (FALLBACK_MODELS.has(req.model)) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
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
    return { status: 'retry', reason: 'api_key', error: 'The Claude API refused the ANTHROPIC_API_KEY secret.', pause: 'api_key' };
  }
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
  if (e instanceof Anthropic.NotFoundError) return { status: 'failed', reason: 'model_unavailable', error: `The model is not available to this API key: ${brief(e)}` };
  if (e instanceof Anthropic.APIError) {
    const st = e.status ?? 0;
    if (st === 402) return { status: 'retry', reason: 'api_billing', error: 'The Claude API account has a billing problem.', pause: 'api_billing' };
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

export async function callClaude(client: Anthropic, req: CallRequest): Promise<CallOutcome> {
  const what = req.what ?? 'the document';
  if (requestBytes(req.content) + REQUEST_HEADROOM > MAX_REQUEST_BYTES) {
    return { ok: false, status: 'failed', reason: 'too_large', error: `${what[0].toUpperCase()}${what.slice(1)} is too large to send to the Claude API (32 MB a request).`, usage: null };
  }
  const started = Date.now();
  const usage: CallUsage = { input_tokens: 0, output_tokens: 0, duration_ms: 0, request_id: null, status: 'ok', model: req.model, calls: 0 };
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

  const budgets = isHaiku(req.model) ? [64_000] : req.budgets ?? TOKEN_BUDGETS;
  for (const budget of budgets) {
    let stream: ReturnType<typeof client.beta.messages.stream> | null = null;
    let msg: BetaMessage;
    try {
      stream = client.beta.messages.stream(buildParams(req, budget), { signal: req.signal });
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
