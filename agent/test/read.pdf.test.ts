// The notice PDF (src/read/pdf.ts): fixture PDFs made with pdf-lib, their
// text layer read page by page with pdf.js, scans told apart, and the
// download's limits against a local HTTP server.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DocumentError, documentUrlAllowed, downloadPdf, hasTextLayer, isPdf, itemsToText, readPdfText } from '../src/read/pdf.js';
import { longPdf, noticePdf, scanPdf } from './readFixtures.js';

const SPEC = { gstin: '24AAAAA0000A1Z5', name: 'Navkar Test Traders', ref: 'ZD2410260012345' };
let notice: Uint8Array;
let server: http.Server;
let base = '';

before(async () => {
  notice = await noticePdf(SPEC);
  server = http.createServer((req, res) => {
    const u = req.url || '/';
    if (u === '/notice.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(Buffer.from(notice)); return; }
    if (u === '/no-length.pdf') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.write(Buffer.from(notice)); res.end(); return; }
    if (u === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>not a pdf</html>'); return; }
    if (u === '/slow.pdf') { setTimeout(() => { if (!res.destroyed) { res.writeHead(200); res.end(Buffer.from(notice)); } }, 2000); return; }
    if (u === '/moved.pdf') { res.writeHead(302, { location: '/notice.pdf' }); res.end(); return; }
    if (u === '/away.pdf') { res.writeHead(302, { location: 'http://10.0.0.1/secret.pdf' }); res.end(); return; }
    if (u === '/broken.pdf') { res.writeHead(500); res.end('oops'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

test('a DRC-01-style notice: page count and each page\'s text', async () => {
  const t = await readPdfText(notice, 60);
  assert.equal(t.pageCount, 2);
  assert.equal(t.textLayer, true);
  assert.match(t.pages[0], /^FORM GST DRC-01\n/);
  assert.match(t.pages[0], /GSTIN: 24AAAAA0000A1Z5/);
  assert.match(t.pages[0], /Tax Period: April 2019 to March 2020 F\.Y\. 2019-20/);
  assert.match(t.pages[0], /Tax of Rs\. 50,000 \(CGST 25,000 and SGST\n25,000\) is short paid\./);
  assert.doesNotMatch(t.pages[0], /Personal hearing/, 'page 2 text stays on page 2');
  assert.match(t.pages[1], /^Details of demand/);
  assert.match(t.pages[1], /\nCGST 75,000 13,500 7,500 0 0 96,000\n/, 'table cells read as one line, spaced');
  assert.match(t.pages[1], /Total 1,50,000 27,000 15,000 0 0 1,92,000/);
  assert.match(t.pages[1], /on or before 31\/10\/2026\./);
});

test('a scan has no text layer; a long PDF is counted but not read', async () => {
  const s = await readPdfText(await scanPdf(), 60);
  assert.deepEqual([s.pageCount, s.textLayer], [1, false]);
  const l = await readPdfText(await longPdf(5), 3);
  assert.deepEqual([l.pageCount, l.pages.length, l.textLayer], [5, 0, false]);
  const ok = await readPdfText(await longPdf(3), 3);
  assert.deepEqual([ok.pageCount, ok.pages.length, ok.textLayer], [3, 3, true]);
});

test('text layer: under 40 characters a page on average is a scan', () => {
  assert.equal(hasTextLayer([]), false);
  assert.equal(hasTextLayer(['x'.repeat(39)]), false);
  assert.equal(hasTextLayer(['x'.repeat(40)]), true);
  assert.equal(hasTextLayer(['x'.repeat(70), '  ']), false, '35 a page');
  assert.equal(hasTextLayer(['Digitally signed by the officer', '', '']), false, 'a signature stamp on a scan');
});

test('not a PDF, or a broken one, is refused', async () => {
  assert.equal(isPdf(new TextEncoder().encode('%PDF-1.7\n')), true);
  assert.equal(isPdf(new TextEncoder().encode('<html>')), false);
  await assert.rejects(readPdfText(new TextEncoder().encode('%PDF-1.7\nthis is not really a pdf'), 60),
    (e: unknown) => e instanceof DocumentError && e.reason === 'bad_pdf' && !e.retryable);
});

test('text items: spaces at visible gaps, line breaks where the line changes', () => {
  const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10, hasEOL });
  assert.equal(itemsToText([item('Total', 40, 700, 25), item('1,92,000', 120, 700, 40), item('Next', 40, 682, 20)]), 'Total 1,92,000\nNext');
  assert.equal(itemsToText([item('No', 40, 700, 12), item('tice', 52, 700, 18)]), 'Notice', 'kerned pieces of one word');
  assert.equal(itemsToText([item('a', 40, 700, 5, true), item('b', 40, 682, 5)]), 'a\nb');
  assert.equal(itemsToText([{ type: 'beginMarkedContent' }, item('x', 1, 1, 1)]), 'x');
});

test('download: the PDF, its SHA-256, redirects only within the storage host', async () => {
  const allow = (u: string) => documentUrlAllowed(u, base);
  const d = await downloadPdf(`${base}/notice.pdf`, { allow });
  assert.equal(d.bytes.byteLength, notice.byteLength);
  assert.equal(d.sha256, crypto.createHash('sha256').update(notice).digest('hex'));
  assert.equal((await downloadPdf(`${base}/no-length.pdf`, { allow })).sha256, d.sha256);
  assert.equal((await downloadPdf(`${base}/moved.pdf`, { allow })).sha256, d.sha256, 'same-host redirect');
  await assert.rejects(downloadPdf(`${base}/away.pdf`, { allow }), (e: unknown) => e instanceof DocumentError && e.reason === 'document_url');
});

test('download: limits and failures, each with a reason and whether to retry', async () => {
  const allow = (u: string) => documentUrlAllowed(u, base);
  const fails = async (url: string, reason: string, retryable: boolean, extra: Record<string, unknown> = {}) =>
    assert.rejects(downloadPdf(url, { allow, ...extra }), (e: unknown) => e instanceof DocumentError && e.reason === reason && e.retryable === retryable);
  await fails(`${base}/notice.pdf`, 'too_large', false, { maxBytes: 1000 });
  await fails(`${base}/no-length.pdf`, 'too_large', false, { maxBytes: 1000 });
  await fails(`${base}/page.html`, 'not_pdf', false);
  await fails(`${base}/missing.pdf`, 'no_document', false);
  await fails(`${base}/broken.pdf`, 'download', true);
  await fails(`${base}/slow.pdf`, 'download', true, { timeoutMs: 300 });
  await fails('http://192.168.1.1/notice.pdf', 'document_url', false);
  await fails('file:///etc/passwd', 'document_url', false);
});

test('only the database\'s own host is allowed', () => {
  const supa = 'https://abc.supabase.co';
  assert.equal(documentUrlAllowed('https://abc.supabase.co/storage/v1/object/public/return-pdfs/notices/x.pdf', supa), true);
  assert.equal(documentUrlAllowed('http://abc.supabase.co/storage/v1/object/public/x.pdf', supa), false, 'another scheme');
  assert.equal(documentUrlAllowed('https://evil.example/x.pdf', supa), false);
  assert.equal(documentUrlAllowed('https://abc.supabase.co.evil.example/x.pdf', supa), false);
  assert.equal(documentUrlAllowed('https://user:pw@abc.supabase.co/x.pdf', supa), false);
  assert.equal(documentUrlAllowed('not a url', supa), false);
});
