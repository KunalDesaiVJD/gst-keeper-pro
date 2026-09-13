const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const [,, input, output, w, h, scale] = process.argv;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(w) || 1600, height: Number(h) || 1000 }, deviceScaleFactor: Number(scale) || 2 });
  await page.goto('file://' + path.resolve(input));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: output, fullPage: true });
  await browser.close();
  console.log('saved', output);
})();
