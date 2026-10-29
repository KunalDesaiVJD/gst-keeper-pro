// One run of the reader (the cron wakes it every two minutes while there is
// work): take the lease, refresh the queues when due, then claim and read one
// job after another (notices first, then documents) while the run has time
// left, and give the lease back. Every job is finished in the database, which
// applies or keeps what was read; nothing is kept here.

import { AI_EFFORT, AI_MODEL } from '../_shared/aiModel.ts';
import { scrub, type CallRequest, type CallUsage, type Caller } from './claude.ts';
import { buildDocResult, DOC_OUTPUT_SCHEMA, DOC_SYSTEM_PROMPT, docUserText, type DocumentClaim } from './documents.ts';
import { gstinDoubts } from './gstin.ts';
import { DocumentError, documentUrlAllowed, downloadPdf, pagesAsText, readPdfText, toBase64, type Downloaded, type PdfText } from './pdf.ts';
import { prepareScan, sweepStaging, type PreparedScan } from './scan.ts';
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
  /** The service role key, to read the documents from storage (private or not). */
  storageKey?: string;
  agentId: string;
  version: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** What is left of the run, in milliseconds (set by runTick). */
  timeLeft?: () => number;
}

// A scan is read by the gateway opening the file (scan.ts), which takes 30 to
// 90 seconds: it is started only with this much of the run left, else handed
// back (its try not counted) for the next run to start with.
export const SCAN_MIN_MS = 100_000;
const scanTimeout = (deps: Deps) => Math.max(30_000, (deps.timeLeft?.() ?? 300_000) - 5_000);
const hasTime = (deps: Deps) => (deps.timeLeft?.() ?? Infinity) >= SCAN_MIN_MS;
/** A photo of a page has no pages to count and no text. */
const imageText = (): PdfText => ({ pageCount: 1, pages: [], textLayer: false });

// A job is started only with this much of the run left; the call is stopped when
// the run is (and tried again in the next). Through the Claude CLI gateway a
// document takes 10 to 25 seconds, a notice under 30, so 40 seconds keeps the
// queue moving (was 75, sized for the API at high effort).
export const MIN_JOB_MS = 40_000;
const END_MARGIN_MS = 8_000;

export interface NoticeClaim extends ReaderClaim {
  kind: 'notice';
}

interface Finish {
  // release: handed back to the queue, its try not counted (too little of the run left for a scan).
  status: 'done' | 'failed' | 'retry' | 'cancelled' | 'skipped' | 'release';
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

async function textOf(bytes: Uint8Array, attempt: number, maxPages: number, needText = false, partial = false): Promise<PdfText> {
  // A second try reads no text (the first may have been stopped by the CPU
  // limit); a third does not even count the pages. The Claude CLI reads the
  // text instead of the PDF, so with it the second try still reads the text,
  // and a document's later tries read fewer of its pages instead of none.
  if (needText && partial) {
    return await readPdfText(bytes, { maxPages: attempt <= 1 ? maxPages : Math.min(maxPages, attempt === 2 ? 20 : 8), withText: true, partial });
  }
  if (attempt >= 3) return { pageCount: null, pages: [], textLayer: false, skipped: 'retry' };
  return await readPdfText(bytes, { maxPages, withText: attempt <= 1 || needText, partial });
}
const needsText = (deps: Deps) => !!deps.claude?.backend && deps.claude.backend !== 'api';

// ── A notice's own PDF: typed facts and issues (notice_read_finish) ────────
export async function readNoticeJob(deps: Deps, claim: NoticeClaim, signal: AbortSignal): Promise<Finish> {
  if (!claim.document_url) return { status: 'failed', reason: 'no_document', error: 'The notice has no PDF to read.' };
  const files = !!deps.claude?.files;
  let doc: Downloaded;
  try {
    doc = await downloadPdf(claim.document_url, {
      allow: (u) => documentUrlAllowed(u, deps.supabaseUrl), fetchImpl: deps.fetchImpl, signal, storageKey: deps.storageKey, allowImages: files,
    });
  } catch (e) {
    return fromDocumentError(e, null, 'The notice PDF');
  }
  // The same PDF read before for this notice (back at a new address after a
  // portal refresh) is not read again: the earlier reading stands.
  const seen = await deps.db.rpc<{ duplicate?: boolean; error?: string }>('notice_read_hash', {
    p_extraction_id: claim.extraction_id, p_agent: deps.agentId, p_sha256: doc.sha256,
  });
  if (seen?.duplicate || seen?.error) return { status: 'skipped', reason: 'same_file' };
  const base = { document_sha256: doc.sha256 };
  let text: PdfText;
  try {
    text = doc.mediaType === 'application/pdf' ? await textOf(doc.bytes, claim.attempt ?? 1, claim.max_pages, needsText(deps)) : imageText();
  } catch (e) {
    return fromDocumentError(e, base, 'The notice PDF');
  }
  // A scan or a photo goes to the gateway as where it is stored (scan.ts), a long one by its first and last pages.
  const scan = files && !text.textLayer;
  if (!scan && text.pageCount && text.pageCount > claim.max_pages) {
    return {
      status: 'failed', reason: 'too_long', result: { ...base, pages: text.pageCount },
      error: `The PDF has ${text.pageCount} pages; the reader reads at most ${claim.max_pages} (Settings).`,
    };
  }
  let prepared: PreparedScan | null = null;
  if (scan) {
    if (!hasTime(deps)) return { status: 'release', reason: 'needs_time' };
    try {
      prepared = await prepareScan(deps, claim.document_url, doc, text.pageCount);
    } catch (e) {
      return fromDocumentError(e, base, 'The notice PDF');
    }
  }
  try {
    const out = await deps.claude!({
      model: AI_MODEL,
      effort: AI_EFFORT,
      system: SYSTEM_PROMPT,
      content: [
        ...(prepared ? [] : [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: toBase64(doc.bytes) } }]),
        { type: 'text', text: userText(claim.issue_codes ?? []) },
      ],
      schema: OUTPUT_SCHEMA,
      signal,
      what: 'the notice',
      pdfText: { pages: text.pages, textLayer: text.textLayer },
      ...(prepared ? { file: prepared.file, timeoutMs: scanTimeout(deps) } : {}),
    });
    const meta = { ...base, pages: text.pageCount, text_layer: text.textLayer };
    if (!out.ok) return { status: out.status, reason: out.reason, error: out.error, usage: out.usage, result: { ...meta, model: out.usage?.model ?? AI_MODEL }, pause: out.pause };
    const result = buildResult(coerceReading(out.json), {
      pages: text.pages, pageCount: text.pageCount ?? 0, textLayer: text.textLayer, sha256: doc.sha256,
    }, claim, out.model);
    const doubts = prepared ? gstinDoubts([JSON.stringify(result)]) : [];
    return { status: 'done', result: result as unknown as Record<string, unknown>, usage: doubts.length ? { ...out.usage, doubts } : out.usage };
  } finally {
    await prepared?.cleanup();
  }
}

// ── Any other document of a case (ai_document_finish) ──────────────────────
export async function readDocumentJob(deps: Deps, claim: DocumentClaim, signal: AbortSignal): Promise<Finish> {
  const attempt = claim.attempt ?? 1;
  const files = !!deps.claude?.files;
  let prepared: PreparedScan | null = null;
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
    let doc: Downloaded;
    try {
      doc = await downloadPdf(claim.document_url, {
        allow: (u) => documentUrlAllowed(u, deps.supabaseUrl), fetchImpl: deps.fetchImpl, signal, storageKey: deps.storageKey, allowImages: files,
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
      text = doc.mediaType === 'application/pdf' ? await textOf(doc.bytes, attempt, claim.max_pages, needsText(deps), true) : imageText();
    } catch (e) {
      return fromDocumentError(e, { document_sha256: doc.sha256 }, 'The document');
    }
    // A long typed document is read in part, as text. A scan, or a partly
    // scanned one, goes to the gateway as where it is stored when it opens
    // files (scan.ts, read as the pages look); without that, a partly scanned
    // one goes through the CLI by its typed pages, as text. Text is checked
    // against the quotes; a scan's reading is not.
    let asText: string | null = null;
    if (text.textLayer) asText = text.read ? pagesAsText(text) : null;
    else if (!files && (text.read || deps.claude?.backend === 'cli')) asText = pagesAsText(text);
    const scan = files && !text.textLayer;
    if (!scan && text.pageCount && text.pageCount > claim.max_pages && !asText) {
      return {
        status: 'skipped', reason: 'too_long', result: { document_sha256: doc.sha256, pages: text.pageCount },
        error: `The PDF has ${text.pageCount} pages and no text layer to read in part; a scan is read up to ${claim.max_pages} pages (Settings).`,
      };
    }
    if (scan) {
      if (!hasTime(deps)) return { status: 'release', reason: 'needs_time' };
      try {
        prepared = await prepareScan(deps, claim.document_url, doc, text.pageCount);
      } catch (e) {
        return fromDocumentError(e, { document_sha256: doc.sha256 }, 'The document');
      }
    }
    content = [
      ...(prepared ? [] : [asText
        ? { type: 'text' as const, text: asText }
        : { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: toBase64(doc.bytes) } }]),
      { type: 'text', text: docUserText(claim) },
    ];
    info = { pages: text.pages, pageCount: text.pageCount, textLayer: text.textLayer || !!asText, sha256: doc.sha256 };
  }
  let out: Awaited<ReturnType<Caller>>;
  try {
    out = await deps.claude!({
      model: AI_MODEL,
      effort: AI_EFFORT,
      system: DOC_SYSTEM_PROMPT,
      content,
      schema: DOC_OUTPUT_SCHEMA,
      signal,
      what: 'the document',
      pdfText: { pages: info.pages, textLayer: info.textLayer },
      ...(prepared ? { file: prepared.file, timeoutMs: scanTimeout(deps) } : {}),
    });
  } finally {
    await prepared?.cleanup();
  }
  if (!out.ok) {
    return {
      status: out.status, reason: out.reason, error: out.error, usage: out.usage, pause: out.pause,
      result: { document_sha256: info.sha256, pages: info.pageCount, model: out.usage?.model ?? AI_MODEL },
    };
  }
  const result = buildDocResult(out.json, info, claim, out.model);
  const doubts = prepared ? gstinDoubts([JSON.stringify(result)]) : [];
  return { status: 'done', result: result as unknown as Record<string, unknown>, usage: doubts.length ? { ...out.usage, doubts } : out.usage };
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
  deps = { ...deps, timeLeft: () => deadline - now() };
  let pause: string | undefined;
  let error: string | null = null;
  try {
    if (begin.sync_due) report.synced = await deps.db.rpc('ai_sync');
    if (deps.claude?.files) await sweepStaging(deps);
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
          // A scan with too little of the run left goes to the next run, which starts with it.
          if (f.status === 'release') {
            await deps.db.rpc('ai_job_release', { p_agent: deps.agentId, p_kind: 'notice', p_id: c.extraction_id });
            report.jobs.push({ kind: 'notice', id: c.extraction_id, label: c.reference_number, status: 'released', reason: f.reason });
            report.stopped = 'time';
            break;
          }
          if (f.pause) {
            pause = f.pause;
            await deps.db.rpc('ai_job_release', { p_agent: deps.agentId, p_kind: 'notice', p_id: c.extraction_id });
            report.jobs.push({ kind: 'notice', id: c.extraction_id, label: c.reference_number, status: 'released', reason: f.reason });
            break;
          }
          // Read before (notice_read_hash dropped the queued reading): nothing to finish.
          if (f.status === 'skipped' && f.reason === 'same_file') {
            report.jobs.push({ kind: 'notice', id: c.extraction_id, label: c.reference_number, status: 'skipped', reason: 'same_file' });
            continue;
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
          if (f.status === 'release') {
            await deps.db.rpc('ai_job_release', { p_agent: deps.agentId, p_kind: 'document', p_id: c.document_id });
            report.jobs.push({ kind: 'document', id: c.document_id, label: c.document_label, status: 'released', reason: f.reason });
            report.stopped = 'time';
            break;
          }
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
