// Number entry and display for the Annual Return grids.
//
// Staff type figures the way they do in the Excel working: plain numbers,
// Indian-grouped numbers ("1,23,456.78"), accounting negatives ("(1,234)"),
// and calculator expressions ("=140758-41040", "=11500+15000", "=D*18%" is
// not supported — cell references don't exist here, but "=26500*9%" is).
// Expressions are evaluated by a tiny parser, never eval().

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INR0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** 1234567.8 → "12,34,567.80". Negative zero and tiny float noise print as 0.00. */
export const fmtMoney = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return INR.format(v);
};

export const fmtWhole = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return INR0.format(Math.round(n));
};

export const fmtRate = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const r = Math.round(n * 100) / 100;
  return `${r}%`;
};

/** Plain number from a typed string: "1,23,456.78", "(500)", "-500", "12.5%". null if not a number. */
export const parsePlain = (raw: string): number | null => {
  let s = raw.trim();
  if (!s) return null;
  // Excel's accounting format shows zero as "-" — that is what a copy carries.
  if (/^[-–—]$/.test(s)) return 0;
  s = s.replace(/^[–—−]/, '-');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[₹,\s]/g, '');
  let pct = false;
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1); }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (pct) n = n / 100;
  return neg ? -n : n;
};

/** Evaluate "+ - * / ( ) %" arithmetic. Throws on anything else. */
export const evalExpression = (expr: string): number => {
  const src = expr.replace(/[₹,\s]/g, '');
  let pos = 0;
  const peek = () => src[pos];
  const eat = (ch: string) => {
    if (src[pos] === ch) { pos++; return true; }
    return false;
  };
  const number = (): number => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(pos));
    if (!m) throw new Error(`Unexpected "${peek() ?? 'end'}"`);
    pos += m[0].length;
    let n = Number(m[0]);
    if (eat('%')) n /= 100;
    return n;
  };
  const factor = (): number => {
    if (eat('+')) return factor();
    if (eat('-')) return -factor();
    if (eat('(')) {
      const v = expression();
      if (!eat(')')) throw new Error('Missing ")"');
      if (eat('%')) return v / 100;
      return v;
    }
    return number();
  };
  const term = (): number => {
    let v = factor();
    for (;;) {
      if (eat('*')) v *= factor();
      else if (eat('/')) {
        const d = factor();
        if (d === 0) throw new Error('Division by zero');
        v /= d;
      } else return v;
    }
  };
  const expression = (): number => {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  };
  const result = expression();
  if (pos !== src.length) throw new Error(`Unexpected "${src[pos]}"`);
  if (!Number.isFinite(result)) throw new Error('Not a number');
  return result;
};

export interface ParsedEntry {
  value: number | null;
  /** The expression as typed (with the leading "="), when it was one. */
  formula?: string;
  error?: string;
}

/** A cell entry: "" → null (cleared), a number, or an "=…" expression. */
export const parseEntry = (raw: string): ParsedEntry => {
  const s = raw.trim();
  if (!s) return { value: null };
  if (s.startsWith('=')) {
    try {
      return { value: round2(evalExpression(s.slice(1))), formula: s };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : 'Invalid expression' };
    }
  }
  const n = parsePlain(s);
  if (n === null) return { value: null, error: `"${s}" is not a number` };
  return { value: n };
};

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The HTML flavour of an Excel / Google Sheets copy, as rows × cells, using the
 * unformatted value where the app provides one (Excel `x:num`, Sheets
 * `data-sheets-value`) — the plain-text flavour carries the DISPLAYED text,
 * e.g. whole rupees or "-" for zero. null when there's no table.
 */
export const parseClipboardHtml = (html: string): string[][] | null => {
  if (!html || !/<table/i.test(html) || typeof DOMParser === 'undefined') return null;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;
    const rows: string[][] = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll('td, th').forEach((td) => {
        let v: string | null = td.getAttribute('x:num');
        if (v === '') v = null; // x:num with no value means "same as the text"
        const sheets = td.getAttribute('data-sheets-value');
        if (v === null && sheets) {
          try {
            const parsed = JSON.parse(sheets) as Record<string, unknown>;
            if (typeof parsed['3'] === 'number') v = String(parsed['3']);
          } catch { /* not JSON — ignore */ }
        }
        const text = (v ?? td.textContent ?? '').replace(/\u00a0/g, ' ').trim();
        cells.push(text);
        const span = Number(td.getAttribute('colspan') || 1);
        for (let k = 1; k < span; k++) cells.push('');
      });
      rows.push(cells);
    });
    return rows.length ? rows : null;
  } catch {
    return null;
  }
};

/** Parse a clipboard block from Excel / Sheets into rows × cells (TSV). */
export const parseClipboard = (text: string): string[][] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l.split('\t'));
};
