// Headless check for the starter kit: Today screenshot (+ optional share card PNG and More tab).
// node tools/shoot_kit.js <baseUrl> <outPrefix> [share] [more]   (needs puppeteer-core; set CHROME=/path/to/chrome)
const pp = require(process.env.PUPPETEER || 'puppeteer-core'); const fs = require('fs');
(async () => {
  const [base, out, ...flags] = process.argv.slice(2);
  const b = await pp.launch({executablePath:process.env.CHROME || '/usr/bin/google-chrome', args:['--no-sandbox', '--hide-scrollbars']});
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text()); });
  await p.setViewport({width:390, height:844, deviceScaleFactor:2, isMobile:true, hasTouch:true});
  await p.goto(base + '#today', {waitUntil:'networkidle0'}); await new Promise(r => setTimeout(r, 1500));
  const h = await p.evaluate(() => document.querySelector('main').scrollHeight);
  await p.setViewport({width:390, height:Math.min(h + 120, 2400), deviceScaleFactor:2, isMobile:true, hasTouch:true}); await new Promise(r => setTimeout(r, 500));
  await p.screenshot({path:out + '.png'});
  await p.setViewport({width:390, height:844, deviceScaleFactor:2, isMobile:true, hasTouch:true});
  const info = await p.evaluate(() => ({theme:document.documentElement.dataset.theme, title:document.title, whoopText:/WHOOP/.test(document.querySelector('main').innerText), rings:!!document.querySelector('.rings3'), checkin:!!document.querySelector('.checkin')}));
  for (const t of ['health', 'trends', 'training', 'more']) { await p.goto(base + '#' + t, {waitUntil:'networkidle0'}); await new Promise(r => setTimeout(r, 400)); }
  for (const r of ['sleep', 'recovery', 'day', 'insights']) { await p.goto(base + '#/' + r + '/' + (await p.evaluate(() => new Date().toISOString().slice(0, 10))), {waitUntil:'networkidle0'}).catch(() => {}); await new Promise(r2 => setTimeout(r2, 400)); }
  await p.goto(base + '#today', {waitUntil:'networkidle0'}); await new Promise(r => setTimeout(r, 800));
  if (flags.includes('share')) {
    await p.evaluate(() => document.querySelector('[data-share]').click()); await new Promise(r => setTimeout(r, 1800));
    const b64 = await p.evaluate(async () => { const im = document.querySelector('#sharepv'); await im.decode(); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); return c.toDataURL('image/png').split(',')[1]; });
    fs.writeFileSync(out + '-share.png', Buffer.from(b64, 'base64'));
    await p.screenshot({path:out + '-sharesheet.png'});
  }
  if (flags.includes('more')) {
    await p.goto(base + '#more', {waitUntil:'networkidle0'}); await new Promise(r => setTimeout(r, 1000));
    await p.screenshot({path:out + '-more.png'});
  }
  console.log(JSON.stringify({...info, errs}));
  await b.close();
})();
