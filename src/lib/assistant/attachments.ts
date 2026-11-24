// Files the user gives the GST Assistant (24 Nov 2026): a screenshot pasted
// with Ctrl V, an image, a PDF, an Excel / CSV, a Word file or a text file,
// up to 10 MB in all with each question. Read here in the browser, so only
// what Claude can read leaves the tab:
//   image          scaled to at most 2000 px on its long side (a screenshot's
//                  text stays readable, the request stays small)
//   PDF            as it is, for Claude to read page by page
//   Excel / CSV    every sheet as CSV text
//   Word (.docx)   its text
//   text, JSON, XML, Markdown   as text
// Nothing is stored: the files go with the question and are gone after it.
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 5;
/** Text taken from one file; a longer one is cut and the cut is said. */
const MAX_TEXT_CHARS = 200_000;
const MAX_IMAGE_SIDE = 2000;

export interface Attachment {
  id: string;
  name: string;
  size: number;
  kind: 'image' | 'pdf' | 'text';
  mediaType: string;
  /** base64 for an image or PDF, the text for the rest. */
  data: string;
  /** A small picture for the chat (an object URL; never stored). */
  preview?: string;
  note?: string;
}

/** What the chat keeps of a file after the question: its name and kind only. */
export interface AttachmentChip { name: string; size: number; kind: Attachment['kind']; note?: string }

export const ACCEPT = 'image/*,.pdf,.xlsx,.xls,.xlsm,.csv,.docx,.txt,.json,.xml,.md';

export function formatSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '');

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function cut(text: string): { text: string; note?: string } {
  if (text.length <= MAX_TEXT_CHARS) return { text };
  return { text: text.slice(0, MAX_TEXT_CHARS), note: `only the first ${MAX_TEXT_CHARS.toLocaleString('en-IN')} characters were read` };
}

async function readImage(file: File): Promise<{ data: string; mediaType: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This image could not be opened.'));
      i.src = url;
    });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This image could not be read.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    // PNG keeps a screenshot's small text sharp; a photo that comes out large goes as JPEG.
    let out = canvas.toDataURL('image/png');
    let mediaType = 'image/png';
    if (out.length > 3_500_000) { out = canvas.toDataURL('image/jpeg', 0.85); mediaType = 'image/jpeg'; }
    return { data: out.slice(out.indexOf(',') + 1), mediaType };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function readSheets(buf: ArrayBuffer): string {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return wb.SheetNames.map((n) => `### Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`).join('\n\n');
}

async function readDocx(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This Word file has no text that could be read.');
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Reads one file into what the assistant sends; throws a message the user can read. */
export async function readAttachment(file: File): Promise<Attachment> {
  const name = file.name || 'pasted screenshot.png';
  const e = ext(name);
  const base = { id: crypto.randomUUID(), name, size: file.size };
  if (file.size > MAX_TOTAL_BYTES) throw new Error(`${name} is ${formatSize(file.size)}: files can be up to 10 MB.`);
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(e)) {
    const img = await readImage(file);
    return { ...base, kind: 'image', mediaType: img.mediaType, data: img.data, preview: URL.createObjectURL(file) };
  }
  const buf = await file.arrayBuffer();
  if (file.type === 'application/pdf' || e === 'pdf') {
    return { ...base, kind: 'pdf', mediaType: 'application/pdf', data: toBase64(buf) };
  }
  let text: string;
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(e)) text = readSheets(buf);
  else if (e === 'docx') text = await readDocx(buf);
  else if (['txt', 'json', 'xml', 'md', 'log'].includes(e) || file.type.startsWith('text/')) text = new TextDecoder().decode(buf);
  else throw new Error(`${name}: this kind of file cannot be read. Attach an image, PDF, Excel, CSV, Word or text file.`);
  if (!text.trim()) throw new Error(`${name} has no text that could be read.`);
  const c = cut(text);
  return { ...base, kind: 'text', mediaType: 'text/plain', data: c.text, note: c.note };
}

/** Bytes a list of files counts against the 10 MB (their size as given). */
export const totalBytes = (list: { size: number }[]) => list.reduce((s, a) => s + a.size, 0);

/** What goes in the request body. */
export const forRequest = (list: Attachment[]) => list.map((a) => ({ name: a.name, kind: a.kind, media_type: a.mediaType, data: a.data, note: a.note }));

export const chipOf = (a: Attachment): AttachmentChip => ({ name: a.name, size: a.size, kind: a.kind, note: a.note });
