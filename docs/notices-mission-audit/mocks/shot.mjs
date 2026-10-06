import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const [,, src, out, w='1600', h='1000', s='2'] = process.argv;
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p = await b.newPage({viewport:{width:+w,height:+h},deviceScaleFactor:+s});
await p.goto('file://'+process.cwd()+'/'+src); await p.waitForLoadState('networkidle'); await p.waitForTimeout(600);
await p.screenshot({path:out,fullPage:true}); await b.close();
