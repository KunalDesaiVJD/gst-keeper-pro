// 0.15.0: is a captured PDF the filed return? Read on the portal tab before
// anything is stored, so the System generated summary (GSTR-3B), a GSTR-1A
// or another month's return never lands on a Filing Status row again.
//
// The portal builds its return PDFs in the browser with pdfmake (pdfkit):
// Flate-compressed content streams, Roboto subset fonts with Identity-H
// encoding and a ToUnicode map. The words are therefore not in the bytes as
// text; this reads them the way a PDF viewer does (inflate the streams, map
// each glyph code through its font's ToUnicode CMap) and then checks:
//  - not the "System generated summary";
//  - the form in the title is the return asked for (a GSTR-1A, or the
//    "Consolidated Summary of FORM GSTR-1 and GSTR-1A", is never a GSTR-1);
//  - the ARN the portal gave for the return is printed in it.
// Anything it cannot read is "not certain": the caller then stores no PDF
// and records why. Also reads the ARN date printed on the return.
//
// A classic script (content script before content.js) that is also loaded by
// the app (src/lib/filedPdfCheck.ts) and the Node tests: it only defines
// globalThis.GSTKFiledPdf. Inflate uses DecompressionStream (Chrome, Node 18+).
(function () {
  const latin1 = (bytes, from, to) => {
    let s = '';
    const end = to == null ? bytes.length : to;
    for (let i = from || 0; i < end; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + 8192)));
    }
    return s;
  };

  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('no DecompressionStream');
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const chunks = [];
    const reader = ds.readable.getReader();
    let total = 0;
    for (;;) {
      let r;
      try { r = await reader.read(); } catch (e) { break; } // a stream cut short still gives what it had
      if (r.done) break;
      chunks.push(r.value);
      total += r.value.length;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  // Every "N G obj ... endobj": its dictionary text and, for a stream, its
  // (still compressed) data.
  function readObjects(bytes) {
    const src = latin1(bytes);
    const objs = new Map();
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(src))) {
      const num = Number(m[1]);
      const start = m.index + m[0].length;
      const end = src.indexOf('endobj', start);
      if (end < 0) break;
      const body = src.slice(start, end);
      const si = body.search(/\bstream\r?\n/);
      let dict = body;
      let data = null;
      if (si >= 0) {
        dict = body.slice(0, si);
        const dataStart = start + si + body.slice(si).match(/^stream\r?\n/)[0].length;
        let dataEnd = src.lastIndexOf('endstream', end);
        if (dataEnd < dataStart) dataEnd = end;
        while (dataEnd > dataStart && (src.charCodeAt(dataEnd - 1) === 10 || src.charCodeAt(dataEnd - 1) === 13)) dataEnd--;
        data = bytes.subarray(dataStart, dataEnd);
      }
      objs.set(num, { dict, data });
      re.lastIndex = end;
    }
    return objs;
  }

  async function streamText(obj) {
    if (!obj || !obj.data) return null;
    if (/\/FlateDecode/.test(obj.dict)) {
      try { return latin1(await inflate(obj.data)); } catch (e) { return null; }
    }
    if (/\/Filter/.test(obj.dict)) return null; // another filter: not read
    return latin1(obj.data);
  }

  const hexBytes = (h) => {
    const s = h.replace(/[^0-9a-fA-F]/g, '');
    const even = s.length % 2 ? s + '0' : s;
    const out = [];
    for (let i = 0; i < even.length; i += 2) out.push(parseInt(even.slice(i, i + 2), 16));
    return out;
  };
  const utf16be = (bytes) => {
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    if (bytes.length % 2) s += String.fromCharCode(bytes[bytes.length - 1]);
    return s;
  };

  // A ToUnicode CMap: glyph code -> text, and how many bytes a code has.
  function parseCMap(text) {
    const map = new Map();
    let width = 2;
    const cs = text.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
    if (cs) width = Math.max(1, cs[1].length / 2);
    for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
      const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g;
      let m;
      while ((m = re.exec(block))) map.set(parseInt(m[1], 16), utf16be(hexBytes(m[2])));
    }
    for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
      const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]*>)/g;
      let m;
      while ((m = re.exec(block))) {
        const lo = parseInt(m[1], 16);
        const hi = parseInt(m[2], 16);
        if (hi < lo || hi - lo > 65535) continue;
        if (m[3][0] === '[') {
          const items = m[3].match(/<([0-9a-fA-F]*)>/g) || [];
          items.forEach((it, i) => { if (lo + i <= hi) map.set(lo + i, utf16be(hexBytes(it.slice(1, -1)))); });
        } else {
          const base = hexBytes(m[3].slice(1, -1));
          for (let c = lo; c <= hi; c++) {
            const b = base.slice();
            b[b.length - 1] = (b[b.length - 1] + (c - lo)) & 0xff;
            map.set(c, utf16be(b));
          }
        }
      }
    }
    return { map, width };
  }

  const refNum = (s) => { const m = /(\d+)\s+\d+\s+R/.exec(s || ''); return m ? Number(m[1]) : null; };

  // A literal (...) string's bytes, escapes undone.
  function literalBytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c !== '\\') { out.push(s.charCodeAt(i) & 0xff); continue; }
      const n = s[++i];
      if (n === undefined) break;
      if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(s[i + 1] || '')) oct += s[++i];
        out.push(parseInt(oct, 8) & 0xff);
      } else if (n === 'n') out.push(10);
      else if (n === 'r') out.push(13);
      else if (n === 't') out.push(9);
      else if (n === 'b') out.push(8);
      else if (n === 'f') out.push(12);
      else if (n === '\r' || n === '\n') { if (n === '\r' && s[i + 1] === '\n') i++; }
      else out.push(n.charCodeAt(0) & 0xff);
    }
    return out;
  }

  function decodeBytes(bytes, font) {
    if (!font) return String.fromCharCode.apply(null, bytes);
    let s = '';
    for (let i = 0; i + font.width <= bytes.length; i += font.width) {
      let code = 0;
      for (let k = 0; k < font.width; k++) code = (code << 8) | bytes[i + k];
      const t = font.map.get(code);
      s += t != null ? t : '';
    }
    return s;
  }

  // The text a content stream shows, one line per text block or move.
  function contentText(content, fonts) {
    let out = '';
    let font = null;
    let i = 0;
    const n = content.length;
    const operands = [];
    while (i < n) {
      const c = content[i];
      if (c === '(') {
        let depth = 1;
        let j = i + 1;
        let lit = '';
        while (j < n && depth > 0) {
          const d = content[j];
          if (d === '\\') { lit += d + (content[j + 1] || ''); j += 2; continue; }
          if (d === '(') depth++;
          else if (d === ')') { depth--; if (depth === 0) break; }
          lit += d;
          j++;
        }
        operands.push({ str: decodeBytes(literalBytes(lit), font) });
        i = j + 1;
      } else if (c === '<' && content[i + 1] !== '<') {
        const j = content.indexOf('>', i);
        if (j < 0) break;
        operands.push({ str: decodeBytes(hexBytes(content.slice(i + 1, j)), font) });
        i = j + 1;
      } else if (c === '[') {
        operands.push({ arrayStart: true });
        i++;
      } else if (c === ']') {
        const parts = [];
        while (operands.length && !operands[operands.length - 1].arrayStart) {
          const o = operands.pop();
          if (o.str != null) parts.unshift(o.str);
        }
        operands.pop();
        operands.push({ str: parts.join('') });
        i++;
      } else if (c === '/') {
        const m = /^\/[^\s/<>[\]()]+/.exec(content.slice(i, i + 128));
        operands.push({ name: m ? m[0].slice(1) : '' });
        i += m ? m[0].length : 1;
      } else if (c === '%') {
        const j = content.indexOf('\n', i);
        i = j < 0 ? n : j + 1;
      } else if (/\s/.test(c)) {
        i++;
      } else {
        const m = /^[^\s/<>[\]()%]+/.exec(content.slice(i, i + 64));
        const tok = m ? m[0] : c;
        i += tok.length;
        if (/^[-+.0-9]/.test(tok)) { operands.push({ num: Number(tok) }); continue; }
        if (tok === 'Tf') {
          const nameOp = operands.slice().reverse().find((o) => o.name != null);
          font = nameOp ? fonts.get(nameOp.name) || null : null;
        } else if (tok === 'Tj' || tok === 'TJ' || tok === "'" || tok === '"') {
          const s = operands.slice().reverse().find((o) => o.str != null);
          if (tok === "'" || tok === '"') out += '\n';
          if (s) out += s.str;
        } else if (tok === 'BT' || tok === 'ET' || tok === 'Td' || tok === 'TD' || tok === 'T*' || tok === 'Tm') {
          if (!out.endsWith('\n')) out += '\n';
        }
        operands.length = 0;
      }
    }
    return out;
  }

  // All the text of a PDF, in drawing order. { text, chars, problem }.
  async function extractText(bytes) {
    if (!bytes || bytes.length < 8 || latin1(bytes, 0, 5) !== '%PDF-') {
      return { text: '', chars: 0, problem: 'not a PDF' };
    }
    let objs;
    try { objs = readObjects(bytes); } catch (e) { return { text: '', chars: 0, problem: 'unreadable PDF' }; }
    // Fonts by resource name (/F1 ...), from every /Font dictionary.
    const fontByObj = new Map();
    const fonts = new Map();
    const fontObj = async (num) => {
      if (fontByObj.has(num)) return fontByObj.get(num);
      let f = null;
      const o = objs.get(num);
      const tu = o && refNum((/\/ToUnicode\s+(\d+\s+\d+\s+R)/.exec(o.dict) || [])[1]);
      if (tu != null) {
        const cm = await streamText(objs.get(tu));
        if (cm) f = parseCMap(cm);
      }
      fontByObj.set(num, f);
      return f;
    };
    for (const o of objs.values()) {
      const dicts = [];
      const fd = /\/Font\s*<<([\s\S]*?)>>/g;
      let m;
      while ((m = fd.exec(o.dict))) dicts.push(m[1]);
      const fr = /\/Font\s+(\d+)\s+\d+\s+R/.exec(o.dict);
      if (fr && objs.get(Number(fr[1]))) dicts.push(objs.get(Number(fr[1])).dict);
      for (const d of dicts) {
        const er = /\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g;
        let e;
        while ((e = er.exec(d))) {
          if (!fonts.has(e[1])) fonts.set(e[1], await fontObj(Number(e[2])));
        }
      }
    }
    // Content streams, page by page in object order.
    let text = '';
    const seen = new Set();
    const pages = [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page\b/.test(o.dict)).sort((a, b) => a[0] - b[0]);
    const contentRefs = [];
    for (const [, p] of pages) {
      const c = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(p.dict);
      if (!c) continue;
      for (const r of c[1].match(/(\d+)\s+\d+\s+R/g) || []) contentRefs.push(refNum(r));
    }
    for (const num of contentRefs) {
      if (num == null || seen.has(num)) continue;
      seen.add(num);
      const s = await streamText(objs.get(num));
      if (s) text += contentText(s, fonts) + '\n';
    }
    const chars = text.replace(/\s+/g, '').length;
    return { text, chars, problem: chars ? null : 'no readable text' };
  }

  const FORM_HEADS = [
    // [return types, the form the title must name]
    [['GSTR-1', 'GSTR-1 (IFF)'], /^(?:FILED\s+)?(?:FORM\s+GSTR-1(?![0-9A-Z])|INVOICE\s+FURNISHING\s+FACILITY)/i],
    [['GSTR-1A'], /^(?:FILED\s+)?FORM\s+GSTR-1A\b/i],
    [['GSTR-3B', 'GSTR-3B (Q)'], /^(?:FILED\s+)?FORM\s+GSTR-3B\b/i],
    [['GSTR-6'], /^(?:FILED\s+)?FORM\s+GSTR-6\b/i],
    [['GSTR-7'], /^(?:FILED\s+)?FORM\s+GSTR-7\b/i],
    [['CMP-08'], /^(?:FILED\s+)?FORM\s+GST\s+CMP\s*-\s*08\b/i],
  ];

  function arnDateIn(flat) {
    const m = /(?:Date\s+of\s+ARN|ARN\s+Date)\s*:?\s*(\d{2})[/-](\d{2})[/-](\d{4})/i.exec(flat);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
  }

  // Is this text the filed return asked for, showing this ARN?
  // { ok, reason, form, arnDate }.
  function checkText(text, want) {
    const arn = String((want && want.arn) || '').toUpperCase().replace(/\s+/g, '');
    const rt = String((want && want.returnType) || '');
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    const compact = flat.replace(/\s+/g, '').toUpperCase();
    const head = flat.slice(0, 200);
    const arnDate = arnDateIn(flat);
    const fail = (reason) => ({ ok: false, reason, form: head.slice(0, 60), arnDate });
    if (!flat) return fail('The PDF has no text that could be read, so it could not be checked.');
    if (/system\s+generated\s+summary/i.test(head)) {
      return fail('The portal gave the System generated summary, not the filed return.');
    }
    if (/GSTR-?1A/i.test(head) && rt !== 'GSTR-1A') {
      return fail('The PDF is a GSTR-1A, not the ' + rt + '.');
    }
    const rule = FORM_HEADS.find(([types]) => types.includes(rt));
    if (rule && !rule[1].test(head)) {
      return fail('The PDF is not a filed ' + rt + ' (it starts "' + head.slice(0, 50) + '").');
    }
    if (!/^[A-Z0-9]{15}$/.test(arn)) return fail('No ARN to look for.');
    if (!compact.includes(arn)) {
      return fail('The PDF does not show ARN ' + arn + '.');
    }
    return { ok: true, reason: null, form: head.slice(0, 60), arnDate };
  }

  function dataUrlToBytes(dataUrl) {
    const b64 = String(dataUrl || '').split(',')[1] || '';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Reads and checks a captured PDF. { ok, reason, form, arnDate, chars }.
  async function checkBytes(bytes, want) {
    const t = await extractText(bytes);
    if (t.problem) {
      return { ok: false, reason: t.problem === 'not a PDF'
        ? 'The file the portal gave is not a PDF.'
        : 'The PDF could not be read (' + t.problem + '), so it was not stored.', form: null, arnDate: null, chars: t.chars };
    }
    return Object.assign(checkText(t.text, want), { chars: t.chars });
  }

  globalThis.GSTKFiledPdf = {
    extractText,
    checkText,
    checkBytes,
    checkDataUrl: (dataUrl, want) => checkBytes(dataUrlToBytes(dataUrl), want),
    dataUrlToBytes,
  };
})();
