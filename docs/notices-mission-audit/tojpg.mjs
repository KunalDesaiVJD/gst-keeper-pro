// Convert PNGs to compressed JPEGs (max width W) using Chromium's canvas. Usage: node tojpg.mjs outDir W quality file1.png file2.png ...
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path';
const [,, outDir, W='1200', Q='0.8', ...files] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--allow-file-access-from-files'] });
const p = await b.newPage(); await p.goto('file://' + path.resolve(path.dirname(new URL(import.meta.url).pathname), 'blank.html'));
for (const f of files) {
  const out = path.join(outDir, path.basename(f).replace(/\.png$/i, '.jpg'));
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(f).mtimeMs) continue;
  const data = await p.evaluate(async ([src, W, Q]) => { const im = new Image(); im.src = src; await im.decode();
    const s = Math.min(1, W / im.naturalWidth); const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', Q); }, ['file://' + path.resolve(f), +W, +Q]);
  fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
}
await b.close(); console.log('converted', files.length);
