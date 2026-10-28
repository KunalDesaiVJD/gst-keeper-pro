// The Claude CLI gateway: the firm's own server that runs the Claude command
// line on the firm's Claude subscription, the same gateway the firm's other
// Supabase project calls (its _shared/aiProvider.ts callClaudeCli). One POST
// with a bearer secret:
//   {system, parts: [{kind: "text", text}], model: "sonnet", effort: "medium", timeoutMs}
// (always Sonnet at medium effort, ../_shared/aiModel.ts, whatever a request names)
// answered {text, truncated?, model?} or {error}. No tokens are billed per call,
// so the usage carries none. Secrets: CLAUDE_CLI_GATEWAY_URL and
// CLAUDE_CLI_GATEWAY_SECRET (the values the other project already has).
//
// The gateway takes text only here: a PDF goes as its own text layer, page by
// page, so the quotes are checked against the same text (a long document, or
// the typed pages of a partly scanned one, the runner sends as text itself). A
// scanned PDF (no text layer) is read by the Claude API when ANTHROPIC_API_KEY
// is also set, else it is left with the reason needs_vision.

import { AI_CLI_MODEL, AI_EFFORT } from '../_shared/aiModel.ts';
import { scrub, type CallOutcome, type CallRequest, type CallUsage, type Caller } from './claude.ts';
import { pagesAsText } from './pages.ts';

/** The answer stopped before its JSON object closed: it was cut off, not malformed. */
export class JsonCutOff extends Error {}

/**
 * The first JSON object in a text, made strict the way a model's long answer
 * needs (the written submission of 28 October 2026 failed on it): a line break
 * or tab inside a string escaped, a double quote inside a string that does not
 * end it (a quoted provision, "the supply") escaped, a backslash that starts no
 * escape kept as text, and a comma before a closing bracket dropped. Whether a
 * quote ends its string is read from what follows it: a key's quote is followed
 * by a colon, a value's by the end of its object or array, or by a comma and
 * then the next key or value. Anything after the object is left out.
 */
export function repairJson(s: string): string {
  const a = s.indexOf('{');
  if (a < 0) throw new Error('no JSON object');
  const ws = (i: number) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };
  // Containers open at this point; an object notes whether its next string is a key.
  const stack: { t: '{' | '['; key: boolean }[] = [];
  let out = '';
  let inStr = false;
  let isKey = false;
  const ends = (j: number): boolean => {
    const k = ws(j);
    const c = s[k];
    if (c === undefined) return true;
    if (isKey) return c === ':';
    const top = stack[stack.length - 1];
    if (!top) return true;
    if (c === (top.t === '{' ? '}' : ']')) return true;
    if (c !== ',') return false;
    const n = ws(k + 1);
    const d = s[n];
    if (top.t === '[') return d !== undefined && (/["{[\]\-0-9]/.test(d) || /^(?:true|false|null)\b/.test(s.slice(n, n + 6)));
    // In an object, a value's comma is followed by the next key and its colon.
    return d === '}' || (d === '"' && /^"(?:[^"\\]|\\.)*"\s*:/.test(s.slice(n, n + 300)));
  };
  for (let i = a; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') {
        const nx = s[i + 1];
        if (nx === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) { out += s.slice(i, i + 6); i += 5; }
        else if (nx !== undefined && '"\\/bfnrt'.includes(nx)) { out += ch + nx; i++; }
        else out += '\\\\';
      } else if (ch === '"') {
        if (ends(i + 1)) { inStr = false; out += ch; } else out += '\\"';
      } else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (ch < ' ') out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
      else out += ch;
      continue;
    }
    const top = stack[stack.length - 1];
    if (ch === '"') {
      inStr = true;
      isKey = top?.t === '{' && top.key;
      out += ch;
    } else if (ch === '{' || ch === '[') {
      stack.push({ t: ch, key: ch === '{' });
      out += ch;
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      out += ch;
      if (!stack.length) return out;
    } else if (ch === ':') {
      if (top) top.key = false;
      out += ch;
    } else if (ch === ',') {
      const c = s[ws(i + 1)];
      if (c === '}' || c === ']') continue;
      if (top?.t === '{') top.key = true;
      out += ch;
    } else out += ch;
  }
  throw new JsonCutOff('the JSON object does not close');
}

/** The JSON object in a text answer: fences and any words around it are dropped, and a long answer's slips mended. */
export function jsonFromText(text: string): unknown {
  const t = text.replace(/^﻿/, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* look inside */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* mend it */ }
  }
  return JSON.parse(repairJson(t));
}

/** The start and end of an answer that could not be read, kept on the run to see why. */
export function rawSample(text: string, n = 300): string {
  const t = text.trim();
  return t.length <= 2 * n ? t : `${t.slice(0, n)} … ${t.slice(-n)}`;
}

export function cliSystem(req: CallRequest): string {
  return `${req.system}\n\nAnswer with one JSON object only: no markdown fences, no words before or after it. `
    + 'Inside a JSON string, write a line break as \\n (never a real line break) and put a quotation in the typographic quotes “ and ” '
    + '(or escape a double quote as \\"), so the object parses. '
    + `It must match this JSON Schema:\n${JSON.stringify(req.schema)}`;
}

/** The request's content as the gateway's text parts; null when a PDF has no text to send. */
export function cliParts(req: CallRequest): { kind: 'text'; text: string }[] | null {
  const parts: { kind: 'text'; text: string }[] = [];
  for (const b of req.content) {
    if (b.type === 'text') parts.push({ kind: 'text', text: b.text });
    else if (b.type === 'document') {
      const text = req.pdfText?.textLayer ? pagesAsText(req.pdfText) : null;
      if (!text) return null;
      parts.push({ kind: 'text', text });
    }
  }
  return parts;
}

export function cliCaller(opts: { url: string; secret: string; fetch?: typeof fetch; timeoutMs?: number }): Caller {
  const f = opts.fetch ?? fetch;
  const c: Caller = async (req: CallRequest): Promise<CallOutcome> => {
    const what = req.what ?? 'the document';
    const model = AI_CLI_MODEL;
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
        body: JSON.stringify({ system: cliSystem(req), parts, model, effort: AI_EFFORT, timeoutMs }),
      });
    } catch (e) {
      usage.duration_ms = Date.now() - started;
      usage.status = 'error';
      if (req.signal?.aborted) return { ok: false, status: 'retry', reason: 'timeout', error: `Reading ${what} took longer than this run had left; it is tried again in the next run.`, usage };
      return { ok: false, status: 'retry', reason: 'connection', error: `The Claude CLI gateway could not be reached: ${scrub(String((e as Error)?.message ?? e)).slice(0, 200)}`, usage };
    }
    usage.duration_ms = Date.now() - started;
    const body = await res.json().catch(() => ({})) as {
      text?: string; error?: string; truncated?: boolean; model?: string;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
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
    // Tokens: the gateway's own count when it sends one, else an estimate (about 4 characters a token).
    const u = body.usage;
    // Kept apart from input_tokens / output_tokens, which price a call: the subscription bills nothing.
    if (u && (Number(u.input_tokens) > 0 || Number(u.output_tokens) > 0)) {
      usage.tokens_in = (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
      usage.tokens_out = Number(u.output_tokens) || 0;
    } else {
      usage.tokens_in = Math.ceil((cliSystem(req).length + JSON.stringify(parts).length) / 4);
      usage.tokens_out = Math.ceil((body.text?.length ?? 0) / 4);
      usage.estimated = true;
    }
    if (body.truncated) {
      usage.status = 'error';
      return { ok: false, status: 'failed', reason: 'max_tokens', error: 'The answer from the Claude CLI was cut off.', usage };
    }
    try {
      return { ok: true, json: jsonFromText(body.text), model: usage.model, usage };
    } catch (e) {
      usage.status = 'error';
      usage.raw_sample = rawSample(body.text);
      if (e instanceof JsonCutOff) {
        return { ok: false, status: 'failed', reason: 'max_tokens', error: 'The answer from the Claude CLI stopped before its end. Draft again, or ask for a shorter document in the guidance.', usage };
      }
      return { ok: false, status: 'failed', reason: 'bad_output', error: body.text.includes('{')
        ? 'The Claude CLI\'s answer could not be read as the expected JSON, even after mending it. Draft again.'
        : 'The Claude CLI answered in words, without the document. Draft again.', usage };
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
