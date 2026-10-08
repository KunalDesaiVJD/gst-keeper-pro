// One run of the reader (the cron wakes it every two minutes while there is
// work): take the lease, refresh the queues when due, then claim and read one
// job after another (notices first, then documents) while the run has time
// left, and give the lease back. Every job is finished in the database, which
// applies or keeps what was read; nothing is kept here.

import { scrub, type CallRequest, type CallUsage, type Caller } from './claude.ts';
import { buildDocResult, DOC_OUTPUT_SCHEMA, DOC_SYSTEM_PROMPT, docUserText, type DocumentClaim } from './documents.ts';
import { DocumentError, documentUrlAllowed, downloadPdf, readPdfText, toBase64, type PdfText } from './pdf.ts';
import { SYSTEM_PROMPT, userText } from './reader/prompt.ts';
import { buildResult, type ReaderClaim } from './reader/result.ts';
import { coerceReading, OUTPUT_SCHEMA } from './reader/schema.ts';

export interface Db {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
}

export interface Deps {
  db: Db;
  claude: Caller | null;
  supabaseUrl: string;
  agentId: string;
  version: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

// A job is started only with this much of the run left (a notice at high effort
// can take a minute or more); the call is stopped when the run is.
export const MIN_JOB_MS = 75_000;
const END_MARGIN_MS = 8_000;

export interface NoticeClaim extends ReaderClaim {
  kind: 'notice';
}

interface Finish {
  status: 'done' | 'failed' | 'retry' | 'cancelled' | 'skipped';
  result?: Record<string, unknown> | null;
  usage?: CallUsage | null;
  error?: string | null;
  reason?: string | null;
  pause?: string;
}

export interface JobReport {
  kind: 'notice' | 'document';
  id: string;
  label: string | null;
  status: string;
  reason?: string | null;
  outcome?: string | null;
  tokens?: { input: number; output: number };
}

export interface TickReport {
  ran: boolean;
  reason?: string;
  synced?: unknown;
  jobs: JobReport[];
  stopped?: string;
  error?: string;
}

const PAUSES: Record<string, string> = {
  api_key: 'The Claude API refused the ANTHROPIC_API_KEY secret. Set a valid key in Supabase (Edge Functions, Secrets).',
  api_permission: 'The Claude API refused requests for this API key\'s organisation.',
  api_billing: 'The Claude API account has a billing problem.',
  cli_auth: 'The Claude CLI gateway refused the CLAUDE_CLI_GATEWAY_SECRET. Set the same secret as the gateway (Edge Functions, Secrets).',
};

function fromDocumentError(e: unknown, result: Record<string, unknown> | null, what: string): Finish {
  if (e instanceof DocumentError) {
    return { status: e.retryable ? 'retry' : 'failed', reason: e.reason, error: `${what}: ${e.message}.`, result };
  }
  return { status: 'retry', reason: 'document', error: `${what}: ${scrub((e as Error).message || String(e)).slice(0, 300)}`, result };
}

async function textOf(bytes: Uint8Array, attempt: number, maxPages: number, needText = false): Promise<PdfText> {
  // A second try reads no text (the first may have been stopped by the CPU
  // limit); a third does not even count the pages. The Claude CLI reads the
  // text instead of the PDF, so with it the second try still reads the text.
  if (attempt >= 3) return { pageCount: null, pages: [], textLayer: false, skipped: 'retry' };
  return await readPdfText(bytes, { maxPages, withText: attempt <= 1 || needText });
}
const needsText = (deps: Deps) => !!deps.claude?.backend && deps.claude.backend !== 'api';

// ── A notice's own PDF: typed facts and issues (notice_read_finish) ────────
export async function readNoticeJob(deps: Deps, claim: NoticeClaim, signal: AbortSignal): Promise<Finish> {
  if (!claim.document_url) return { status: 'failed', reason: 'no_document', error: 'The notice has no PDF to read.' };
  let doc: { bytes: Uint8Array; sha256: string };
  try {
    doc = await downloadPdf(claim.document_url, {
      allow: (u) => documentUrlAllowed(u, deps.supabaseUrl), fetchImpl: deps.fetchImpl, signal,
    });
  } catch (e) {
    return fromDocumentError(e, null, 'The notice PDF');
  }
  const base = { document_sha256: doc.sha256 };
  let text: PdfText;
  try {
    text = await textOf(doc.bytes, claim.attempt ?? 1, claim.max_pages, needsText(deps));
  } catch (e) {
    return fromDocumentError(e, base, 'The notice PDF');
  }
  if (text.pageCount && text.pageCount > claim.max_pages) {
    return {
      status: 'failed', reason: 'too_long', result: { ...base, pages: text.pageCount },
      error: `The PDF has ${text.pageCount} pages; the reader reads at most ${claim.max_pages} (Settings).`,
    };
  }
  const out = await deps.claude!({
    model: claim.model,
    effort: claim.effort,
    system: SYSTEM_PROMPT,
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(doc.bytes) } },
      { type: 'text', text: userText(claim.issue_codes ?? []) },
    ],
    schema: OUTPUT_SCHEMA,
    signal,
    what: 'the notice',
    pdfText: { pages: text.pages, textLayer: text.textLayer },
  });
  const meta = { ...base, pages: text.pageCount, text_layer: text.textLayer };
  if (!out.ok) return { status: out.status, reason: out.reason, error: out.error, usage: out.usage, result: { ...meta, model: out.usage?.model ?? claim.model }, pause: out.pause };
  const result = buildResult(coerceReading(out.json), {
    pages: text.pages, pageCount: text.pageCount ?? 0, textLayer: text.textLayer, sha256: doc.sha256,
  }, claim, out.model);
  return { status: 'done', result: result as unknown as Record<string, unknown>, usage: out.usage };
}

// ── Any other document of a case (ai_document_finish) ──────────────────────
export async function readDocumentJob(deps: Deps, claim: DocumentClaim, signal: AbortSignal): Promise<Finish> {
  const attempt = claim.attempt ?? 1;
  type Block = CallRequest['content'][number];
  let content: Block[];
  let info: { pages: string[]; pageCount: number | null; textLayer: boolean; sha256: string | null };
  if (claim.source === 'draft' || !claim.document_url) {
    const body = (claim.body ?? '').trim();
    if (!body) return { status: 'failed', reason: 'no_document', error: 'The document has no text and no PDF.' };
    content = [
      { type: 'text', text: `The document (text):\n\n${body.slice(0, 120_000)}` },
      { type: 'text', text: docUserText(claim) },
    ];
    info = { pages: [], pageCount: null, textLayer: false, sha256: null };
  } else {
    let doc: { bytes: Uint8Array; sha256: string };
    try {
      doc = await downloadPdf(claim.document_url, {
        allow: (u) => documentUrlAllowed(u, deps.supabaseUrl), fetchImpl: deps.fetchImpl, signal,
      });
    } catch (e) {
      return fromDocumentError(e, null, 'The document');
    }
    // The same file read before is not sent again.
    const seen = await deps.db.rpc<{ duplicate?: boolean; error?: string }>('ai_document_hash', {
      p_document_id: claim.document_id, p_agent: deps.agentId, p_sha256: doc.sha256,
    });
    if (seen?.duplicate || seen?.error) return { status: 'skipped', reason: 'duplicate' };
    let text: PdfText;
    try {
      text = await textOf(doc.bytes, attempt, claim.max_pages, needsText(deps));
    } catch (e) {
      return fromDocumentError(e, { document_sha256: doc.sha256 }, 'The document');
    }
    if (text.pageCount && text.pageCount > claim.max_pages) {
      return {
        status: 'skipped', reason: 'too_long', result: { document_sha256: doc.sha256, pages: text.pageCount },
        error: `The PDF has ${text.pageCount} pages; documents are read up to ${claim.max_pages} pages (Settings).`,
      };
    }
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(doc.bytes) } },
      { type: 'text', text: docUserText(claim) },
    ];
    info = { pages: text.pages, pageCount: text.pageCount, textLayer: text.textLayer, sha256: doc.sha256 };
  }
  const out = await deps.claude!({
    model: claim.model,
    effort: claim.effort,
    system: DOC_SYSTEM_PROMPT,
    content,
    schema: DOC_OUTPUT_SCHEMA,
    signal,
    what: 'the document',
    pdfText: { pages: info.pages, textLayer: info.textLayer },
  });
  if (!out.ok) {
    return {
      status: out.status, reason: out.reason, error: out.error, usage: out.usage, pause: out.pause,
      result: { document_sha256: info.sha256, pages: info.pageCount, model: out.usage?.model ?? claim.model },
    };
  }
  const result = buildDocResult(out.json, info, claim, out.model);
  return { status: 'done', result: result as unknown as Record<string, unknown>, usage: out.usage };
}

// ── One run ────────────────────────────────────────────────────────────────
export async function runTick(deps: Deps, opts: { seconds?: number } = {}): Promise<TickReport> {
  const now = deps.now ?? Date.now;
  const started = now();
  const keyOk = !!deps.claude;
  const begin = await deps.db.rpc<{ lease: boolean; read_enabled: boolean; runner: string; seconds: number; sync_due: boolean }>(
    'ai_runner_begin', { p_agent: deps.agentId, p_seconds: opts.seconds ?? 140, p_key_ok: keyOk, p_version: deps.version });
  if (!begin?.lease) {
    return { ran: false, reason: !keyOk ? 'no_key' : !begin?.read_enabled ? 'off' : begin?.runner !== 'edge' ? 'runner' : 'busy', jobs: [] };
  }
  const seconds = opts.seconds ?? begin.seconds ?? 140;
  const deadline = started + seconds * 1000 - END_MARGIN_MS;
  const report: TickReport = { ran: true, jobs: [] };
  let pause: string | undefined;
  let error: string | null = null;
  try {
    if (begin.sync_due) report.synced = await deps.db.rpc('ai_sync');
    for (;;) {
      if (deadline - now() < MIN_JOB_MS) { report.stopped = 'time'; break; }
      const claim = await deps.db.rpc<Record<string, unknown> | null>('ai_claim_next', { p_agent: deps.agentId });
      if (!claim) { report.stopped = 'empty'; break; }
      if (claim.idle || claim.capped) { report.stopped = claim.capped ? 'capped' : String(claim.idle); break; }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), Math.max(deadline - now(), 1_000));
      try {
        if (claim.kind === 'notice') {
          const c = claim as unknown as NoticeClaim;
          const f = await readNoticeJob(deps, c, ctl.signal);
          if (f.pause) {
            pause = f.pause;
            await deps.db.rpc('ai_job_release', { p_agent: deps.agentId, p_kind: 'notice', p_id: c.extraction_id });
            report.jobs.push({ kind: 'notice', id: c.extraction_id, label: c.reference_number, status: 'released', reason: f.reason });
            break;
          }
          const r = await deps.db.rpc<{ status?: string; outcome?: string; error?: string }>('notice_read_finish', {
            p_extraction_id: c.extraction_id, p_agent: deps.agentId, p_status: f.status === 'skipped' ? 'failed' : f.status,
            p_result: f.result ?? null, p_usage: f.usage ?? null,
            p_error: f.error ? scrub(f.error).slice(0, 1000) : null, p_reason_class: f.reason ?? null,
          });
          report.jobs.push({
            kind: 'notice', id: c.extraction_id, label: c.reference_number, status: r?.error ?? r?.status ?? f.status,
            reason: f.reason, outcome: r?.outcome ?? null,
            tokens: f.usage ? { input: f.usage.input_tokens, output: f.usage.output_tokens } : undefined,
          });
        } else {
          const c = claim as unknown as DocumentClaim;
          const f = await readDocumentJob(deps, c, ctl.signal);
          if (f.pause) {
            pause = f.pause;
            await deps.db.rpc('ai_job_release', { p_agent: deps.agentId, p_kind: 'document', p_id: c.document_id });
            report.jobs.push({ kind: 'document', id: c.document_id, label: c.document_label, status: 'released', reason: f.reason });
            break;
          }
          // A duplicate was already settled by ai_document_hash.
          if (f.status === 'skipped' && f.reason === 'duplicate') {
            report.jobs.push({ kind: 'document', id: c.document_id, label: c.document_label, status: 'skipped', reason: 'duplicate' });
            continue;
          }
          const r = await deps.db.rpc<{ status?: string; pairs?: number; error?: string }>('ai_document_finish', {
            p_document_id: c.document_id, p_agent: deps.agentId, p_status: f.status,
            p_result: f.result ?? null, p_usage: f.usage ?? null,
            p_error: f.error ? scrub(f.error).slice(0, 1000) : null, p_reason_class: f.reason ?? null,
          });
          report.jobs.push({
            kind: 'document', id: c.document_id, label: c.document_label, status: r?.error ?? r?.status ?? f.status,
            reason: f.reason, outcome: typeof r?.pairs === 'number' ? `${r.pairs} pair(s)` : null,
            tokens: f.usage ? { input: f.usage.input_tokens, output: f.usage.output_tokens } : undefined,
          });
        }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (e) {
    error = scrub((e as Error).message || String(e)).slice(0, 400);
    report.error = error;
  } finally {
    const worked = report.jobs.filter((j) => j.status !== 'released').length;
    await deps.db.rpc('ai_runner_end', {
      p_agent: deps.agentId, p_done: worked,
      p_error: pause ? PAUSES[pause] ?? `Paused: ${pause}` : error,
      p_key_ok: pause === 'api_key' ? false : null,
    }).catch(() => {});
  }
  if (pause) report.stopped = `paused:${pause}`;
  return report;
}
