// Builds fictional return PDFs the way the GST portal's pdfmake (pdfkit)
// does: Flate-compressed content streams, two subset fonts (Regular and
// Medium) with Identity-H encoding, a ToUnicode CMap each (bfrange with
// arrays, as pdfkit writes it), and text drawn as hex glyph codes in TJ
// arrays with kerning between pieces. So the words are not in the bytes;
// filedpdf.js has to read them as a viewer does. Each font numbers its
// glyphs differently, so a reader that ignores the font switch fails.
//   node test/_pdffixture.mjs   (rewrites test/fixtures/*.pdf)
import zlib from 'node:zlib';
import fs from 'node:fs';

function glyphs(text, alphabet) {
  return [...text].map((ch) => {
    let i = alphabet.indexOf(ch);
    if (i < 0) { alphabet.push(ch); i = alphabet.length - 1; }
    return i + 1;
  });
}
const hex4 = (n) => n.toString(16).padStart(4, '0');

// lines: [{ text, font: 'R' | 'M', split?: number }]: one text line each;
// split cuts the line into two TJ pieces at that character, with a kern.
export function makePdf(lines) {
  const alpha = { R: [], M: [' '] }; // different code numbering per font
  let content = '1 0 0 -1 0 841.89 cm\n';
  let y = 40;
  for (const ln of lines) {
    const f = ln.font === 'M' ? 'M' : 'R';
    const codes = glyphs(ln.text, alpha[f]);
    const parts = ln.split ? [codes.slice(0, ln.split), codes.slice(ln.split)] : [codes];
    const arr = parts.map((p) => '<' + p.map(hex4).join('') + '>').join(' 12 ');
    content += `BT\n1 0 0 -1 20 ${y} Tm\n/F${f === 'M' ? 2 : 1} 9 Tf\n[${arr}] TJ\nET\n`;
    y += 14;
  }
  const cmap = (a) => {
    const n = a.length;
    const dst = a.map((ch) => '<' + hex4(ch.charCodeAt(0)) + '>').join(' ');
    return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo <<\n  /Registry (Adobe)\n  /Ordering (UCS)\n  /Supplement 0\n>> def\n'
      + '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000><ffff>\nendcodespacerange\n'
      + `1 beginbfrange\n<0001> <${hex4(n)}> [${dst}]\nendbfrange\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  };
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const stream = (dict, data) => {
    const z = zlib.deflateSync(Buffer.from(data, 'latin1'));
    return { dict: `<<\n/Length ${z.length}\n/Filter /FlateDecode${dict}\n>>`, data: z };
  };
  const catalog = add(null);
  const pages = add(null);
  const page = add(null);
  const contents = add(stream('', content));
  const font = (name, a) => {
    const tu = add(stream('', cmap(a)));
    const fd = add(`<<\n/Type /FontDescriptor\n/FontName /${name}\n/Flags 4\n/FontBBox [-737 -271 1148 1056]\n/ItalicAngle 0\n/Ascent 928\n/Descent -244\n/CapHeight 711\n/XHeight 528\n/StemV 0\n>>`);
    const cid = add(`<<\n/Type /Font\n/Subtype /CIDFontType2\n/BaseFont /${name}\n/CIDSystemInfo <<\n/Registry (Adobe)\n/Ordering (Identity)\n/Supplement 0\n>>\n/FontDescriptor ${fd} 0 R\n/CIDToGIDMap /Identity\n/W [0 [500]]\n>>`);
    return add(`<<\n/Type /Font\n/Subtype /Type0\n/BaseFont /${name}\n/Encoding /Identity-H\n/DescendantFonts [${cid} 0 R]\n/ToUnicode ${tu} 0 R\n>>`);
  };
  const f1 = font('ZZAAAA+Roboto-Regular', alpha.R);
  const f2 = font('ZZBBBB+Roboto-Medium', alpha.M);
  const res = add(`<<\n/ProcSet [/PDF /Text]\n/Font <<\n/F1 ${f1} 0 R\n/F2 ${f2} 0 R\n>>\n>>`);
  objs[catalog - 1] = `<<\n/Type /Catalog\n/Pages ${pages} 0 R\n>>`;
  objs[pages - 1] = `<<\n/Type /Pages\n/Count 1\n/Kids [${page} 0 R]\n>>`;
  objs[page - 1] = `<<\n/Type /Page\n/Parent ${pages} 0 R\n/MediaBox [0 0 595.28 841.89]\n/Contents ${contents} 0 R\n/Resources ${res} 0 R\n>>`;
  const chunks = [Buffer.from('%PDF-1.3\n%\xff\xff\xff\xff\n', 'latin1')];
  let off = chunks[0].length;
  const xref = [];
  objs.forEach((o, i) => {
    xref.push(off);
    const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const body = typeof o === 'string' ? Buffer.from(o + '\n', 'latin1')
      : Buffer.concat([Buffer.from(o.dict + '\nstream\n', 'latin1'), o.data, Buffer.from('\nendstream\n', 'latin1')]);
    const tail = Buffer.from('endobj\n', 'latin1');
    chunks.push(head, body, tail);
    off += head.length + body.length + tail.length;
  });
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of xref) x += String(o).padStart(10, '0') + ' 00000 n \n';
  x += `trailer\n<<\n/Size ${objs.length + 1}\n/Root ${catalog} 0 R\n/Info << /Producer (pdfmake) /Creator (pdfmake) >>\n>>\nstartxref\n${off}\n%%EOF\n`;
  chunks.push(Buffer.from(x, 'latin1'));
  return Buffer.concat(chunks);
}

// The fictional returns the tests use (FICTIONAL FABRICS, 24ABCDE1234F1Z5).
export const FIXTURES = {
  'filed-gstr3b.pdf': [
    { text: 'Form GSTR-3B', font: 'M' }, { text: '[See rule 61(5)]' }, { text: 'Year' }, { text: '2026-27' }, { text: 'Period' }, { text: 'September' },
    { text: 'GSTIN of the supplier' }, { text: '24ABCDE1234F1Z5' }, { text: '2(a). Legal name of the registered person' }, { text: 'FICTIONAL FABRICS' },
    { text: '2(c). ARN', font: 'M' }, { text: 'AB240926123456X', split: 7 }, { text: '2(d). Date of ARN', font: 'M' }, { text: '11/10/2026' },
    { text: '3.1 Details of Outward supplies and inward supplies liable to reverse charge' }, { text: '700000.00' },
  ],
  'system-summary-gstr3b.pdf': [
    { text: 'Form GSTR-3B', font: 'M' }, { text: 'System generated summary', font: 'M' },
    { text: '[This summary has been generated based on your FORM GSTR-1, GSTR-1A, GSTR-2B (auto-drafted ITC statement) and GSTR-3B (Previous period).' },
    { text: 'Financial year' }, { text: '2026-27' }, { text: 'Tax period' }, { text: 'September' }, { text: 'GSTIN' }, { text: '24ABCDE1234F1Z5' },
    { text: 'GSTR-1 filing date' }, { text: '10/10/2026' }, { text: 'GSTR-3B summary generation date' }, { text: '10/10/2026' },
  ],
  'filed-gstr1.pdf': [
    { text: 'FORM GSTR-1', font: 'M' }, { text: '[See rule 59(1)]' }, { text: 'Details of outward supplies of goods or services' },
    { text: 'Financial year' }, { text: '2026-27' }, { text: 'Tax period' }, { text: 'September' }, { text: 'GSTIN' }, { text: '24ABCDE1234F1Z5' },
    { text: '(c)' }, { text: 'ARN', font: 'M' }, { text: 'AA240926123456X', split: 4 }, { text: '(d)' }, { text: 'ARN date', font: 'M' }, { text: '10/10/2026' },
  ],
  'filed-gstr1a.pdf': [
    { text: 'FILED FORM GSTR-1A', font: 'M' }, { text: '[See rule 59(1)]' }, { text: 'Amendment of outward supplies of goods or services for current tax period' },
    { text: 'Financial year' }, { text: '2026-27' }, { text: 'Tax period' }, { text: 'September' }, { text: 'GSTIN' }, { text: '24ABCDE1234F1Z5' },
    { text: '(c)' }, { text: 'ARN', font: 'M' }, { text: 'AA240926000001Z' }, { text: '(d)' }, { text: 'ARN date', font: 'M' }, { text: '20/10/2026' },
  ],
  'consolidated-gstr1-1a.pdf': [
    { text: 'FILED Consolidated Summary of FORM GSTR-1 and GSTR-1A', font: 'M' },
    { text: 'Amendment of outward supplies of goods or services for current tax period' },
    { text: 'GSTR-1A – ARN', font: 'M' }, { text: 'AA240926000001Z' }, { text: 'GSTR-1A – ARN Date', font: 'M' }, { text: '20/10/2026' },
    { text: 'GSTR-1' }, { text: 'AA240926123456X' },
  ],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, lines] of Object.entries(FIXTURES)) {
    fs.writeFileSync(new URL('./fixtures/' + name, import.meta.url), makePdf(lines));
    console.log('wrote test/fixtures/' + name);
  }
}
