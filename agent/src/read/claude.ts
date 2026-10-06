// One notice, read by the Claude API: the PDF (base64 document block) and the
// fixed instructions, answered as JSON in the reader's schema (structured
// outputs). Streamed, with adaptive thinking at the effort set in the app, and
// the API's own fallback on a policy decline (fallbacks "default"). Nothing
// about the client is sent. Errors come back classified: retry later, failed,
// or failed and pause the reader (the key was refused).

import Anthropic, { APIError } from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, userText, type IssueCode } from './prompt.js';
import { coerceReading, OUTPUT_SCHEMA, type ReadingOut } from './schema.js';

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const API_BASE_URL = 'https://api.anthropic.com';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// Models whose fallbacks: "default" is documented; any other model the app is
// set to is asked without a fallback rather than refused with a 400.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
// Thinking counts towards max_tokens; a reading cut off there is asked once
// more with the model's whole output budget.
export const TOKEN_BUDGETS = [64_000, 128_000] as const;
// The API takes requests of at most 32 MB; the PDF travels base64-encoded.
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const REQUEST_HEADROOM = 256 * 1024;

export function makeClaudeClient(opts: { apiKey: string; baseUrl?: string | null; maxRetries?: number; timeoutMs?: number }): Anthropic {
  return new Anthropic({
    apiKey: opts.apiKey,
    // Only the key from agent/.env: never a token or profile from elsewhere.
    authToken: null,
    baseURL: opts.baseUrl || API_BASE_URL,
    maxRetries: opts.maxRetries ?? 2,
    timeout: opts.timeoutMs ?? 10 * 60_000,
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

export type ClaudeOutcome =
  | { ok: true; reading: ReadingOut; model: string; usage: CallUsage }
  | { ok: false; status: 'retry' | 'failed'; reason: string; error: string; usage: CallUsage | null; pause?: string };

export interface ReadRequest {
  pdfBase64: string;
  model: string;
  effort: string;
  issueCodes: IssueCode[];
  signal?: AbortSignal;
}

export function buildParams(req: ReadRequest, maxTokens: number): StreamParams {
  const effort = (EFFORTS as readonly string[]).includes(req.effort) ? (req.effort as Effort) : 'high';
  const params: StreamParams = {
    model: req.model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.pdfBase64 } },
        { type: 'text', text: userText(req.issueCodes) },
      ],
    }],
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
// mid-answer leaves a partial before it, which is not part of the reading.
export function answerText(msg: Pick<BetaMessage, 'content'>): string {
  let start = 0;
  msg.content.forEach((b, i) => { if (b.type === 'fallback') start = i + 1; });
  return msg.content.slice(start).map((b) => (b.type === 'text' ? b.text : '')).join('');
}

export interface ErrorClass {
  status: 'retry' | 'failed';
  reason: string;
  error: string;
  pause?: string;
}

const brief = (e: unknown) => scrub(((e as Error)?.message || String(e)).replace(/\s+/g, ' ')).slice(0, 300);

// Keys never reach a log or the database, even inside an error message.
export function scrub(s: string): string {
  return s.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…');
}

export function classifyError(e: unknown, stopped: boolean): ErrorClass {
  if (e instanceof Anthropic.APIUserAbortError || stopped) {
    return { status: 'retry', reason: stopped ? 'agent_stopped' : 'timeout', error: stopped ? 'The agent stopped while the notice was being read.' : 'The reading took too long and was stopped.' };
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return { status: 'failed', reason: 'api_key', error: 'The Claude API refused the API key in agent/.env.', pause: 'api_key' };
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return { status: 'failed', reason: 'api_permission', error: `The Claude API refused this request for the key's organisation: ${brief(e)}`, pause: 'api_permission' };
  }
  if (e instanceof Anthropic.RateLimitError) return { status: 'retry', reason: 'rate_limited', error: 'The Claude API rate limit was reached.' };
  if (e instanceof Anthropic.InternalServerError) return { status: 'retry', reason: 'api_unavailable', error: `The Claude API is unavailable (${(e as APIError).status}).` };
  if (e instanceof Anthropic.APIConnectionError) return { status: 'retry', reason: 'connection', error: `The Claude API could not be reached: ${brief(e)}` };
  if (e instanceof Anthropic.BadRequestError) return { status: 'failed', reason: 'bad_request', error: `The Claude API rejected the request: ${brief(e)}` };
  if (e instanceof Anthropic.NotFoundError) return { status: 'failed', reason: 'model_unavailable', error: `The model is not available to this API key: ${brief(e)}` };
  if (e instanceof Anthropic.APIError) {
    const st = e.status ?? 0;
    if (st === 402) return { status: 'failed', reason: 'api_billing', error: 'The Claude API account has a billing problem.', pause: 'api_billing' };
    if (st === 413) return { status: 'failed', reason: 'too_large', error: 'The notice is too large for the Claude API.' };
    if (st >= 500 || st === 408 || st === 409) return { status: 'retry', reason: 'api_unavailable', error: `The Claude API is unavailable (${st}).` };
    return { status: 'failed', reason: 'bad_request', error: `The Claude API rejected the request (${st}): ${brief(e)}` };
  }
  // The SDK's own errors without an HTTP status: the answer's stream was cut off.
  if (e instanceof Anthropic.AnthropicError) return { status: 'retry', reason: 'connection', error: `The answer from the Claude API was cut off: ${brief(e)}` };
  return { status: 'retry', reason: 'api_error', error: `The reading failed: ${brief(e)}` };
}

export async function readNotice(client: Anthropic, req: ReadRequest): Promise<ClaudeOutcome> {
  if (req.pdfBase64.length + REQUEST_HEADROOM > MAX_REQUEST_BYTES) {
    return { ok: false, status: 'failed', reason: 'too_large', error: 'The PDF is too large to send to the Claude API (32 MB a request).', usage: null };
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

  for (const budget of TOKEN_BUDGETS) {
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
      const c = classifyError(e, !!req.signal?.aborted);
      return { ok: false, ...c, usage };
    }
    count(msg.usage, stream.request_id ?? null, msg.model);
    const fb = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaFallbackBlock => b.type === 'fallback').at(-1);
    if (fb) usage.fallback = { from: fb.from.model, to: fb.to.model };

    switch (msg.stop_reason) {
      case 'refusal': {
        usage.status = 'refused';
        const cat = msg.stop_details?.category;
        return { ok: false, status: 'failed', reason: 'refused', error: `The model declined to read this notice${cat ? ` (${cat})` : ''}.`, usage };
      }
      case 'max_tokens':
        if (budget !== TOKEN_BUDGETS[TOKEN_BUDGETS.length - 1]) continue;
        usage.status = 'error';
        return { ok: false, status: 'failed', reason: 'max_tokens', error: 'The reading did not fit in the model\'s output budget.', usage };
      case 'model_context_window_exceeded':
        usage.status = 'error';
        return { ok: false, status: 'failed', reason: 'too_long', error: 'The notice is too long for the model\'s context window.', usage };
      case 'end_turn':
      case 'stop_sequence': {
        let json: unknown;
        try {
          json = JSON.parse(answerText(msg));
        } catch {
          usage.status = 'error';
          return { ok: false, status: 'failed', reason: 'bad_output', error: 'The model\'s answer was not the expected JSON.', usage };
        }
        return { ok: true, reading: coerceReading(json), model: msg.model, usage };
      }
      default:
        usage.status = 'error';
        return { ok: false, status: 'failed', reason: 'bad_output', error: `The model stopped unexpectedly (${msg.stop_reason ?? 'no reason'}).`, usage };
    }
  }
  usage.status = 'error';
  return { ok: false, status: 'failed', reason: 'max_tokens', error: 'The reading did not fit in the model\'s output budget.', usage };
}
