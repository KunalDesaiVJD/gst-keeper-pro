// Reads one e-mail and says whether it came from the GST portal and what it is
// about: the GSTINs, the form and the notice/order reference number. Pure: no
// I/O, no clock. The inbox watcher (inbox.ts) feeds it and sends the result to
// portal_email_ingest. Only the subject, a short snippet and the extracted
// fields leave this module, never the body.

export interface PortalEmailInput {
  /** The Message-ID header (or the watcher's uid:<uidValidity>:<uid>@<mailbox> stand-in). */
  messageId: string;
  /** When the e-mail reached the inbox; a Date, an ISO string or epoch ms. */
  date?: Date | string | number | null;
  /** The From header: a bare address or "Name <address>". */
  from?: string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
}

export interface PortalEmail {
  messageId: string;
  /** ISO timestamp, or null when the e-mail carried no usable date (the database then uses now()). */
  receivedAt: string | null;
  /** The sender's bare address in lower case (for a forward, whoever forwarded it); the raw From text if it holds no address. */
  from: string | null;
  subject: string;
  /** At most 400 characters of the plain text: whitespace collapsed, quoted history and "-- " signatures dropped. */
  snippet: string;
  /** Valid GSTINs, upper case, de-duplicated, in order of appearance (a forwarded portal e-mail's own text first). */
  gstins: string[];
  /** The form the e-mail is about, written the way the app writes it: 'DRC-01B', 'GSTR-3A', 'REG-17'. */
  formCode: string | null;
  /** The notice / order reference number, e.g. 'ZD241026000123A'. */
  reference: string | null;
  /** Sent by the portal, or a forward whose body carries the portal's From: header. */
  isPortal: boolean;
}

export interface ParseOptions {
  /** Tested against bare sender addresses. Default DEFAULT_PORTAL_SENDERS. */
  portalSenders?: RegExp;
}

/** gst.gov.in and any subdomain of it (services.gst.gov.in, …). */
export const DEFAULT_PORTAL_SENDERS = /@(?:[a-z0-9-]+\.)*gst\.gov\.in$/i;

const SNIPPET_MAX = 400;
const SUBJECT_MAX = 500;
// Portal e-mails are a few kilobytes; a long forwarded thread is cut here so a
// pathological message cannot make the regexes below slow.
const TEXT_MAX = 256 * 1024;
const HTML_MAX = 512 * 1024;

// ── GSTIN ──────────────────────────────────────────────────────────────────

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The check character of a GSTIN from its first 14 characters (base-36 Luhn mod 36), or '' if they are not [0-9A-Z]. */
export function gstinCheckChar(first14: string): string {
  const s = first14.toUpperCase();
  if (!/^[0-9A-Z]{14}$/.test(s)) return '';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = B36.indexOf(s[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
}

/**
 * A valid GSTIN: state code 01–38, 97 or 99, letters among characters 3–14
 * (every format carries a PAN, TAN or UIN there, so a 15-digit number is never
 * taken) and the right check character.
 */
export function isValidGstin(value: string): boolean {
  const g = value.toUpperCase();
  if (!/^\d{2}[0-9A-Z]{13}$/.test(g)) return false;
  const state = Number(g.slice(0, 2));
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return false;
  if (!/[A-Z]/.test(g.slice(2, 14))) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

const GSTIN_TOKEN_RE = /(?<![A-Za-z0-9])(\d{2}[A-Za-z0-9]{13})(?![A-Za-z0-9])/g;

function gstinsIn(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const m of t.matchAll(GSTIN_TOKEN_RE)) {
      const g = m[1].toUpperCase();
      if (isValidGstin(g) && !out.includes(g)) out.push(g);
    }
  }
  return out;
}

// ── Form code ──────────────────────────────────────────────────────────────

// Prefixes taken on their own. The others are common words or abbreviations in
// GST mail ("ITC 10 lakh"), so they count only after "Form" / "Form GST".
const FORM_PREFIXES_BARE = new Set(['GSTR', 'DRC', 'ASMT', 'REG', 'RFD', 'ADT', 'MOV', 'APL']);
const FORM_RE =
  /(?<![A-Za-z0-9])(form[\s-]*(?:gst[\s-]*)?)?(GSTR|DRC|ASMT|REG|RFD|ADT|MOV|APL|CMP|PMT|SPL|INS|ITC)[\s\-–—_]*(\d{1,2})(?:-?([A-Ca-c]))?(?![A-Za-z0-9])/gi;

// Forms the taxpayer files (returns, applications, replies, payments). A notice
// e-mail names them too — "you have not filed GSTR-3B", "reply in FORM GST
// DRC-06", "pay through DRC-03" — so the form the portal issued wins over them.
const TAXPAYER_FORMS = new Set([
  'RFD-01', 'RFD-09', 'RFD-10', 'RFD-11', 'REG-01', 'REG-04', 'REG-14', 'REG-16', 'REG-18', 'REG-21',
  'REG-24', 'ASMT-01', 'ASMT-11', 'ASMT-17', 'DRC-03', 'DRC-06', 'DRC-20', 'APL-01', 'APL-05',
  'SPL-01', 'SPL-02', 'CMP-02', 'CMP-04', 'PMT-06', 'PMT-09', 'ITC-01', 'ITC-02', 'ITC-03', 'ITC-04',
]);
const isTaxpayerForm = (code: string) => TAXPAYER_FORMS.has(code) || (code.startsWith('GSTR-') && code !== 'GSTR-3A');

function formsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FORM_RE)) {
    const prefix = m[2].toUpperCase();
    if (!m[1] && !FORM_PREFIXES_BARE.has(prefix)) continue;
    const n = Number(m[3]);
    if (!n) continue;
    const suffix = (m[4] || '').toUpperCase();
    out.push(prefix === 'GSTR' ? `GSTR-${n}${suffix}` : `${prefix}-${String(n).padStart(2, '0')}${suffix}`);
  }
  return out;
}

/** 'Form GST DRC 01B' → 'DRC-01B', 'GSTR 3A' → 'GSTR-3A', 'reg17' → 'REG-17'; null when no form code is in the text. */
export function normaliseFormCode(text: string): string | null {
  return formsIn(text)[0] ?? null;
}

// The first form the portal issued (subject before body), else the first form at all.
function pickForm(texts: string[]): string | null {
  const all = texts.flatMap(formsIn);
  return all.find((c) => !isTaxpayerForm(c)) ?? all[0] ?? null;
}

// ── Reference number ───────────────────────────────────────────────────────

// "Reference No.", "Ref. No", "Reference Number", "Reference ID", "Ref #",
// "Reference:", "Notice No.", "Order No.", "Intimation No." — optionally
// "& Date" — then the 15-character token.
const REF_LABEL_RE = new RegExp(
  String.raw`(?<![A-Za-z])(?:ref(?:erence)?\.?\s*(?:nos?|number|num|id)\b\.?|ref(?:erence)?\.?\s*#|reference(?=\s*[:\-–—])|(?:notice|order|intimation)\s*(?:no|number|num)\b\.?)` +
    String.raw`(?:\s*(?:&|and)\s*date(?:\s+of\s+issue)?)?[\s:.\-–—#=]*([A-Za-z0-9]{15})(?![A-Za-z0-9])`,
  'gi',
);
// An application's or a payment's own reference number is not the notice's.
const NOT_A_NOTICE_LABEL_RE = /(?:application|acknowledge?ment|payment|bank|transaction|challan)[\s-]*$/i;
// Portal notice / order references: Z + letter + state code + 10 digits + a digit or check letter.
const PORTAL_REF_RE = /(?<![A-Za-z0-9])(Z[A-Za-z](\d{2})\d{10}[A-Za-z0-9])(?![A-Za-z0-9])/g;

const validState = (st: number) => (st >= 1 && st <= 38) || st === 97 || st === 99;

function pickReference(texts: string[]): string | null {
  // A labelled token wins wherever it is; it may be any 15-character code
  // (even an ARN or a GSTIN), since the e-mail itself calls it the reference.
  for (const t of texts) {
    for (const m of t.matchAll(REF_LABEL_RE)) {
      const before = t.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
      if (NOT_A_NOTICE_LABEL_RE.test(before)) continue;
      const tok = m[1].toUpperCase();
      if (/[A-Z]/.test(tok) && /\d/.test(tok)) return tok;
    }
  }
  // Else the first portal-shaped reference. ARNs (AA…/AD…) and GSTINs never match this shape.
  for (const t of texts) {
    for (const m of t.matchAll(PORTAL_REF_RE)) {
      if (validState(Number(m[2]))) return m[1].toUpperCase();
    }
  }
  return null;
}

// ── HTML to text ───────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', lsquo: '‘',
  rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
  rarr: '→', larr: '←', raquo: '»', laquo: '«', zwnj: '', zwj: '', shy: '',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const cp = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    const v = ENTITIES[ent.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tbody', 'thead', 'blockquote',
  'section', 'article', 'header', 'footer', 'center', 'pre',
]);
const SKIPPED_TAGS = new Set(['script', 'style', 'head', 'title', 'xml']);

/** Plain text from HTML: blocks and rows become lines, cells are separated, tags dropped, entities decoded. */
export function htmlToText(html: string): string {
  const s = html.length > HTML_MAX ? html.slice(0, HTML_MAX) : html;
  // One pass, left to right: regexes over a whole document go quadratic on
  // unclosed comments and tags, which a hostile e-mail can supply.
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      out.push(s.slice(i));
      break;
    }
    out.push(s.slice(i, lt));
    if (!/[A-Za-z/!?]/.test(s[lt + 1] ?? '')) {
      out.push('<'); // "a < b" is text
      i = lt + 1;
      continue;
    }
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      if (end < 0) break; // an unclosed comment runs to the end
      out.push(' ');
      i = end + 3;
      continue;
    }
    const gt = s.indexOf('>', lt + 1);
    if (gt < 0) break; // an unclosed tag runs to the end
    i = gt + 1;
    const tag = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(s.slice(lt, Math.min(gt, lt + 64)));
    if (!tag) continue; // <!DOCTYPE …>, <?xml …?>
    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();
    if (!closing && SKIPPED_TAGS.has(name)) {
      const close = new RegExp(`</\\s*${name}\\s*>`, 'gi');
      close.lastIndex = i;
      const m = close.exec(s);
      if (!m) break; // unclosed: nothing after it is text
      i = m.index + m[0].length;
      out.push(' ');
    } else if (name === 'br') {
      out.push('\n');
    } else if (name === 'li' || name === 'hr') {
      if (!closing) out.push('\n'); // a list item per line
    } else if (name === 'tr') {
      if (closing) out.push('\n'); // a row per line
    } else if (name === 'td' || name === 'th') {
      if (closing) out.push(' \t ');
    } else if (BLOCK_TAGS.has(name)) {
      out.push('\n');
    }
  }
  return decodeEntities(out.join(''))
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0\u2000-\u200b\u3000]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Addresses, header blocks, quoted history ───────────────────────────────

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

function addressesIn(s: string): string[] {
  return (s.slice(0, 1000).match(EMAIL_RE) || []).map((a) => a.toLowerCase().replace(/^[.'-]+/, ''));
}

// No two neighbouring quantifiers may match the same character, or a long run
// of spaces makes this quadratic.
const HEADER_FIELD_RE = /^[\s>*]*(from|sent|date|to|cc|bcc|subject|reply-to)[\s*]*:[\s*]*([\s\S]*)$/i;

function headerField(line: string): { key: string; value: string } | null {
  const m = HEADER_FIELD_RE.exec(line);
  return m ? { key: m[1].toLowerCase(), value: m[2] } : null;
}

// Lines that open quoted history in Gmail, Outlook, Apple Mail and Android mail.
const HISTORY_MARKER_RE = /^[\s>]*(?:-{2,}\s*(?:forwarded message|original message)\s*-{2,}|begin forwarded message\s*:?)\s*$/i;
// Outlook's rule line (and a dashed line) above a "From: … Sent: …" block.
const RULE_LINE_RE = /^[\s>]*(?:_{8,}|-{8,})\s*$/;
const WROTE_END_RE = /\bwrote\s*:\s*$/i;

/** "On Fri, 2 Oct 2026 at 10:14, GST Network <x@gst.gov.in> wrote:", which Gmail may wrap onto a second line. */
function wroteLine(lines: string[], i: number): { text: string; next: number } | null {
  const line = lines[i];
  if (!/^[\s>]*on\b/i.test(line) || line.length > 300) return null;
  if (WROTE_END_RE.test(line)) return { text: line, next: i + 1 };
  const second = lines[i + 1];
  if (second !== undefined && second.length < 200 && WROTE_END_RE.test(second)) return { text: line + ' ' + second, next: i + 2 };
  return null;
}

function precededByMarker(lines: string[], i: number): boolean {
  for (let j = i - 1, seen = 0; j >= 0 && seen < 3; j--) {
    if (!lines[j].trim()) continue;
    seen++;
    if (HISTORY_MARKER_RE.test(lines[j]) || RULE_LINE_RE.test(lines[j])) return true;
  }
  return false;
}

interface ForwardBlock {
  /** Line of the forwarded From: header (or the "… wrote:" line). */
  at: number;
  /** First line of the forwarded message's own text. */
  bodyStart: number;
}

/**
 * The first forwarded (or quoted) portal e-mail in the body: a From: header
 * with a portal address that sits in a header block (Sent:/Date:/To:/Subject:
 * right below it, or a forward marker just above), or a "… <portal> wrote:" line.
 */
function findPortalForward(lines: string[], portal: RegExp): ForwardBlock | null {
  for (let i = 0; i < lines.length; i++) {
    const wrote = wroteLine(lines, i);
    if (wrote) {
      if (addressesIn(wrote.text).some((a) => portal.test(a))) return { at: i, bodyStart: wrote.next };
      continue;
    }
    const h = headerField(lines[i]);
    if (!h || h.key !== 'from') continue;
    let addrs = addressesIn(h.value);
    if (!addrs.length && i + 1 < lines.length && !headerField(lines[i + 1])) addrs = addressesIn(lines[i + 1]);
    if (!addrs.some((a) => portal.test(a))) continue;

    let end = i + 1;
    let fields = 0;
    for (let j = i + 1; j < lines.length && j <= i + 12; j++) {
      const hj = headerField(lines[j]);
      if (hj) {
        if (hj.key === 'from') break;
        fields++;
        end = j + 1;
        continue;
      }
      if (!lines[j].trim()) break;
      // A wrapped header value continues on this line only when another header follows it.
      if (j + 1 < lines.length && headerField(lines[j + 1])) {
        end = j + 1;
        continue;
      }
      break;
    }
    if (fields > 0 || precededByMarker(lines, i)) return { at: i, bodyStart: end };
  }
  return null;
}

/** The lines before the first quoted-history marker or "-- " signature delimiter. */
function cutHistory(lines: string[]): string[] {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^-- ?$/.test(l) || HISTORY_MARKER_RE.test(l) || wroteLine(lines, i)) return lines.slice(0, i);
    if (RULE_LINE_RE.test(l) && lines.slice(i + 1, i + 3).some((x) => headerField(x)?.key === 'from')) return lines.slice(0, i);
    const h = headerField(l);
    if (h?.key === 'from') {
      const keys = lines.slice(i + 1, i + 5).map((x) => headerField(x)?.key);
      if (keys.includes('sent') || (addressesIn(h.value).length > 0 && keys.some((k) => k === 'date' || k === 'to' || k === 'subject'))) {
        return lines.slice(0, i);
      }
    }
  }
  return lines;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
// Text the database takes: no control characters (a NUL fails the RPC every
// time) and no half of a surrogate pair (an emoji cut by a length limit).
const dbText = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
const OTP_RE = /\b(?:otp|one[\s-]*time[\s-]*pass(?:word|code))\b/i;
const maskDigits = (s: string) => s.replace(/\b\d{4,8}\b/g, '••••••');

function buildSnippet(lines: string[], forwarded: boolean): string {
  const kept = cutHistory(lines);
  const body = forwarded
    ? kept.map((l) => l.replace(/^(?:\s*>)+ ?/, '')) // the forwarded portal text, quote marks removed
    : kept.filter((l) => !/^\s*>/.test(l)); // our own text, quoted lines dropped
  return collapse(body.join('\n')).slice(0, SNIPPET_MAX).trimEnd();
}

function toIso(d: PortalEmailInput['date']): string | null {
  if (d === null || d === undefined || d === '') return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function plainRegex(re: RegExp): RegExp {
  // A g or y flag would make .test() stateful.
  return /[gy]/.test(re.flags) ? new RegExp(re.source, re.flags.replace(/[gy]/g, '')) : re;
}

// ── The parser ─────────────────────────────────────────────────────────────

export function parsePortalEmail(input: PortalEmailInput, opts: ParseOptions = {}): PortalEmail {
  const portal = plainRegex(opts.portalSenders ?? DEFAULT_PORTAL_SENDERS);
  const subjectRaw = collapse((input.subject ?? '').slice(0, 4 * SUBJECT_MAX));
  const text = (input.text ?? '').slice(0, TEXT_MAX).replace(/\r\n?/g, '\n');
  const htmlText = input.html ? htmlToText(input.html) : '';

  const fromRaw = (input.from ?? '').slice(0, 1000).trim();
  // "Name <address>": the address in brackets, never one written into the display name.
  const bracketed = /<\s*([^<>\s]+@[^<>\s]+?)\s*>/.exec(fromRaw)?.[1];
  const from = (bracketed ? addressesIn(bracketed)[0] : undefined) ?? addressesIn(fromRaw)[0] ?? (fromRaw ? fromRaw.slice(0, 200) : null);
  const senderIsPortal = !!from && portal.test(from);

  // Read the text part; the HTML part when there is no text or the forward only shows there.
  const sources = [text, htmlText].filter((s, i, all) => s.trim() && all.indexOf(s) === i);
  let bodyLines = (sources[0] ?? '').split('\n');
  let fwd: ForwardBlock | null = null;
  let fwdSource = -1;
  for (let k = 0; k < sources.length && !fwd; k++) {
    const lines = sources[k].split('\n');
    const found = findPortalForward(lines, portal);
    if (found) {
      fwd = found;
      fwdSource = k;
      bodyLines = lines;
    }
  }
  const isPortal = senderIsPortal || fwd !== null;

  // Where to look for GSTINs, forms and references: the subject, then — for a
  // forward — the forwarded portal text before the forwarder's own note (a
  // signature there may carry the forwarder's GSTIN), then everything else.
  const corpus: string[] = [subjectRaw];
  sources.forEach((s, k) => {
    if (k === fwdSource && fwd) {
      corpus.push(bodyLines.slice(fwd.at).join('\n'), bodyLines.slice(0, fwd.at).join('\n'));
    } else {
      corpus.push(s);
    }
  });

  const snippetLines = fwd ? bodyLines.slice(fwd.bodyStart) : bodyLines;
  let snippet = buildSnippet(snippetLines, fwd !== null);
  let subject = subjectRaw.slice(0, SUBJECT_MAX);
  // An OTP e-mail keeps its digits out of the database.
  if (OTP_RE.test(subjectRaw) || sources.some((s) => OTP_RE.test(s.slice(0, 4000)))) {
    snippet = maskDigits(snippet);
    subject = maskDigits(subject);
  }

  return {
    messageId: dbText(input.messageId).trim(),
    receivedAt: toIso(input.date),
    from: from === null ? null : dbText(from),
    subject: dbText(subject),
    snippet: dbText(snippet),
    gstins: gstinsIn(corpus),
    formCode: pickForm(corpus),
    reference: pickReference(corpus),
    isPortal,
  };
}
