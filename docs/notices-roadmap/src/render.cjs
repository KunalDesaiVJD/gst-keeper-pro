// Render report.html → PDF (A4) with running header/footer via Playwright.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const [,, input, output] = process.argv;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  await page.goto('file://' + path.resolve(input), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const footer = `<div style="width:100%;font-family:Inter,'DejaVu Sans',Arial,sans-serif;font-size:7.5pt;color:#64748b;padding:0 16mm;display:flex;justify-content:space-between;align-items:center">
      <span>V. J. Desai &amp; Co. LLP · GST Keeper · Notices &amp; Litigation — Roadmap and Blueprint · Draft v1.0 · 13 Sep 2026</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
  const header = `<div style="width:100%;font-family:Inter,'DejaVu Sans',Arial,sans-serif;font-size:7.5pt;color:#94a3b8;padding:0 16mm;display:flex;justify-content:flex-end">Confidential — prepared for the firm's internal use</div>`;
  await page.pdf({
    path: output, format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: header, footerTemplate: footer,
    margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
  });
  await browser.close();
  console.log('pdf saved', output);
})();
