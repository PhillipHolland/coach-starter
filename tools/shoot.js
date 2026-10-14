const pp = require('/workspace/coach/tools/node_modules/puppeteer-core');
(async () => {
  const b = await pp.launch({executablePath:'/usr/bin/google-chrome', args:['--no-sandbox','--hide-scrollbars']});
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  await p.setViewport({width:390, height:844, deviceScaleFactor:2, isMobile:true, hasTouch:true});
  const base = process.argv[2] || 'http://localhost:8765/';
  const out = process.argv[3] || '/workspace/coach/shots';
  const full = process.argv[4] !== 'viewport';
  for (const t of ['today','health','trends','training','more','nutrition','history']) {
    await p.goto(base + '?t=' + t + '#' + t, {waitUntil:'networkidle0'});
    await new Promise(r => setTimeout(r, 1300));
    if (full) { const hgt = await p.evaluate(() => document.documentElement.scrollHeight); await p.setViewport({width:390, height:hgt, deviceScaleFactor:2, isMobile:true, hasTouch:true}); await new Promise(r => setTimeout(r, 400)); }
    await p.screenshot({path:`${out}/${t}.png`});
    await p.setViewport({width:390, height:844, deviceScaleFactor:2, isMobile:true, hasTouch:true});
  }
  // journal sheet
  await p.goto(base + '?r=1#today', {waitUntil:'networkidle0'}); await new Promise(r => setTimeout(r, 800));
  await p.click('[data-journal]'); await new Promise(r => setTimeout(r, 700));
  await p.screenshot({path:`${out}/journal.png`});
  await p.click('#sheetclose'); await new Promise(r => setTimeout(r, 500));
  // day sheet
  await p.evaluate(() => document.querySelector('.dial[data-day]').click()); await new Promise(r => setTimeout(r, 700));
  await p.screenshot({path:`${out}/day.png`});
  await p.click('#sheetclose'); await new Promise(r => setTimeout(r, 500));
  // search
  await p.type('#q', 'bench'); await new Promise(r => setTimeout(r, 400));
  await p.screenshot({path:`${out}/search.png`});
  // menu
  await p.goto(base + '?r=2#trends', {waitUntil:'networkidle0'}); await new Promise(r => setTimeout(r, 900));
  await p.click('#menubtn'); await new Promise(r => setTimeout(r, 700));
  await p.screenshot({path:`${out}/menu.png`});
  await p.click('#sheetclose'); await new Promise(r => setTimeout(r, 500));
  // chart tooltip
  const c = await p.$('.chart'); const bb = await c.boundingBox();
  await p.touchscreen.tap(bb.x + bb.width * 0.7, bb.y + bb.height / 2);
  await p.mouse.move(bb.x + bb.width * 0.7, bb.y + bb.height / 2);
  await new Promise(r => setTimeout(r, 300));
  await p.screenshot({path:`${out}/tooltip.png`});
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close();
})();
