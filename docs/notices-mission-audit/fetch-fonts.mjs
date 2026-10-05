// Downloads Inter, Poppins and JetBrains Mono (latin + latin-ext) into ./fonts for the report and mock-ups.
import fs from 'fs'; import path from 'path';
const D = path.join(path.dirname(new URL(import.meta.url).pathname), 'fonts'); fs.mkdirSync(D, { recursive: true });
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' };
const css = await (await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&family=JetBrains+Mono:wght@400;600&display=swap', { headers: UA })).text();
const out = [];
for (const [, subset, blk] of css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g)) {
  if (!['latin', 'latin-ext'].includes(subset)) continue;
  const url = blk.match(/url\((https:[^)]+)\)/)[1]; const fam = blk.match(/font-family: '([^']+)'/)[1].replace(/ /g, ''); const w = blk.match(/font-weight: (\d+)/)[1];
  const fn = `${fam}-${w}-${subset}.woff2`; fs.writeFileSync(path.join(D, fn), Buffer.from(await (await fetch(url)).arrayBuffer())); out.push(blk.replace(url, fn));
}
fs.writeFileSync(path.join(D, 'fonts.css'), out.join('\n')); console.log('fonts', out.length);
