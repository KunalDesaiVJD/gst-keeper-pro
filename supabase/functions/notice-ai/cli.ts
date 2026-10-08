// The Claude CLI gateway: the firm's own server that runs the Claude command
// line on the firm's Claude subscription, the same gateway the firm's other
// Supabase project calls (its _shared/aiProvider.ts callClaudeCli). One POST
// with a bearer secret:
//   {system, parts: [{kind: "text", text}], model: "haiku"|"sonnet"|"opus", effort, timeoutMs}
// answered {text, truncated?, model?} or {error}. No tokens are billed per call,
// so the usage carries none. Secrets: CLAUDE_CLI_GATEWAY_URL and
// CLAUDE_CLI_GATEWAY_SECRET (the values the other project already has).
//
// The gateway takes text only here: a PDF goes as its own text layer, page by
// page, so the quotes are checked against the same text. A scanned PDF (no text
// layer) is read by the Claude API when ANTHROPIC_API_KEY is also set, else it
// is left with the reason needs_vision.

import { scrub, type CallOutcome, type CallRequest, type CallUsage, type Caller } from './claude.ts';

export function cliModel(model: string): 'haiku' | 'sonnet' | 'opus' {
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  return 'opus';
}

/** The JSON object in a text answer: fences and any words around it are dropped. */
export function jsonFromText(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* look inside */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('no JSON object');
}

export function cliSystem(req: CallRequest): string {
  return `${req.system}\n\nAnswer with one JSON object only: no markdown fences, no words before or after it. `
    + `It must match this JSON Schema:\n${JSON.stringify(req.schema)}`;
}

/** The request's content as the gateway's text parts; null when a PDF has no text to send. */
export function cliParts(req: CallRequest): { kind: 'text'; text: string }[] | null {
  const parts: { kind: 'text'; text: string }[] = [];
  for (const b of req.content) {
    if (b.type === 'text') parts.push({ kind: 'text', text: b.text });
    else if (b.type === 'document') {
      const pages = req.pdfText?.pages ?? [];
      if (!req.pdfText?.textLayer || !pages.some((p) => p.trim())) return null;
      parts.push({
        kind: 'text',
        text: 'The PDF document, as its text layer, page by page (quote it exactly as written here):\n\n'
          + pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join('\n\n'),
      });
    }
  }
  return parts;
}

export function cliCaller(opts: { url: string; secret: string; fetch?: typeof fetch; timeoutMs?: number }): Caller {
  const f = opts.fetch ?? fetch;
  const c: Caller = async (req: CallRequest): Promise<CallOutcome> => {
    const what = req.what ?? 'the document';
    const model = cliModel(req.model);
    const usage: CallUsage = { input_tokens: 0, output_tokens: 0, duration_ms: 0, request_id: null, status: 'ok', model: `claude-cli:${model}`, calls: 1 };
    const parts = cliParts(req);
    if (!parts) {
      usage.calls = 0;
      return { ok: false, status: 'failed', reason: 'needs_vision', error: `${what[0].toUpperCase()}${what.slice(1)} is a scan with no text layer; the Claude CLI gateway reads text only (set ANTHROPIC_API_KEY too to read scans).`, usage };
    }
    const started = Date.now();
    const timeoutMs = Math.max(30_000, Math.min(opts.timeoutMs ?? 300_000, 300_000));
    let res: Response;
    try {
      res = await f(opts.url, {
        method: 'POST',
        signal: req.signal,
        headers: { Authorization: `Bearer ${opts.secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: cliSystem(req), parts, model, effort: req.effort || 'low', timeoutMs }),
      });
    } catch (e) {
      usage.duration_ms = Date.now() - started;
      usage.status = 'error';
      if (req.signal?.aborted) return { ok: false, status: 'retry', reason: 'timeout', error: `Reading ${what} took longer than this run had left; it is tried again in the next run.`, usage };
      return { ok: false, status: 'retry', reason: 'connection', error: `The Claude CLI gateway could not be reached: ${scrub(String((e as Error)?.message ?? e)).slice(0, 200)}`, usage };
    }
    usage.duration_ms = Date.now() - started;
    const body = await res.json().catch(() => ({})) as { text?: string; error?: string; truncated?: boolean; model?: string };
    if (res.status === 401 || res.status === 403) {
      usage.status = 'error';
      return { ok: false, status: 'retry', reason: 'cli_auth', error: 'The Claude CLI gateway refused the CLAUDE_CLI_GATEWAY_SECRET.', usage, pause: 'cli_auth' };
    }
    if (!res.ok || typeof body.text !== 'string') {
      usage.status = 'error';
      const msg = scrub(String(body.error ?? `HTTP ${res.status}`)).slice(0, 300);
      const retry = res.status >= 500 || res.status === 429 || res.status === 408 || res.status === 0;
      return { ok: false, status: retry ? 'retry' : 'failed', reason: retry ? 'cli_unavailable' : 'cli_error', error: `The Claude CLI gateway: ${msg}`, usage };
    }
    if (body.model) usage.model = `claude-cli:${body.model}`;
    if (body.truncated) {
      usage.status = 'error';
      return { ok: false, status: 'failed', reason: 'max_tokens', error: 'The answer from the Claude CLI was cut off.', usage };
    }
    try {
      return { ok: true, json: jsonFromText(body.text), model: usage.model, usage };
    } catch {
      usage.status = 'error';
      return { ok: false, status: 'failed', reason: 'bad_output', error: 'The Claude CLI\'s answer was not the expected JSON.', usage };
    }
  };
  c.backend = 'cli';
  return c;
}

/** The CLI first; a scan (needs_vision) goes to the Claude API when there is one. */
export function cliWithApiForScans(cli: Caller, api: Caller | null): Caller {
  if (!api) return cli;
  const c: Caller = async (req) => {
    const out = await cli(req);
    return !out.ok && out.reason === 'needs_vision' ? api(req) : out;
  };
  c.backend = 'cli+api';
  return c;
}
