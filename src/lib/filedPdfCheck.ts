// Reads a return PDF in the browser with the extension's own checker
// (extension/filedpdf.js, one copy for both): its text, the ARN and ARN date
// printed on it, and whether it is the filed return asked for (not the
// System generated summary, not a GSTR-1A for a GSTR-1, showing the ARN).
// Used when a staff member attaches a filed return by hand.
import '../../extension/filedpdf.js';

export interface FiledPdfCheck { ok: boolean; reason: string | null; form: string | null; arnDate: string | null; chars?: number }

interface FiledPdfApi {
  extractText: (bytes: Uint8Array) => Promise<{ text: string; chars: number; problem: string | null }>;
  checkText: (text: string, want: { arn: string; returnType: string }) => FiledPdfCheck;
}

const api = (): FiledPdfApi => (globalThis as unknown as { GSTKFiledPdf: FiledPdfApi }).GSTKFiledPdf;

export interface ReadFiledPdf {
  /** Readable text, or why not. */
  problem: string | null;
  /** The ARN printed after an "ARN" label, if any. */
  arn: string | null;
  /** The "Date of ARN" / "ARN date" printed on it, yyyy-mm-dd. */
  arnDate: string | null;
  /** The first words of the title. */
  form: string | null;
  check: (want: { arn: string; returnType: string }) => FiledPdfCheck;
}

export async function readFiledPdf(file: Blob): Promise<ReadFiledPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const t = await api().extractText(bytes);
  const flat = t.text.replace(/\s+/g, ' ').trim();
  const arn = /\bARN\s*:?\s*([A-Z]{2}[0-9]{6}[A-Z0-9]{7})\b/.exec(flat)?.[1] ?? null;
  const base = api().checkText(t.text, { arn: arn ?? '', returnType: '' });
  return {
    problem: t.problem === 'not a PDF' ? 'This file is not a PDF.' : t.problem ? `The PDF could not be read (${t.problem}).` : null,
    arn,
    arnDate: base.arnDate,
    form: flat.slice(0, 60) || null,
    check: (want) => (t.problem ? { ok: false, reason: `The PDF could not be read (${t.problem}).`, form: null, arnDate: null } : api().checkText(t.text, want)),
  };
}
