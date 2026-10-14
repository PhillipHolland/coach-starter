// Rasterize SVGs to opaque PNGs with headless Chrome. Usage: node render_svg.js in.svg:180:out.png [more jobs...]
const fs = require('fs'), pp = require('/workspace/coach/tools/node_modules/puppeteer-core');
(async () => {
  const b = await pp.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});
  const p = await b.newPage();
  for (const job of process.argv.slice(2)) {
    const [src, size, out] = job.split(':'), n = +size;
    await p.setViewport({width: n, height: n, deviceScaleFactor: 1});
    const data = 'data:image/svg+xml;base64,' + fs.readFileSync(src).toString('base64');
    await p.setContent(`<style>html,body{margin:0;background:#0A0C0E}img{display:block}</style><img src="${data}" width="${n}" height="${n}">`);
    await p.waitForFunction(() => document.images[0].complete);
    await p.screenshot({path: out, clip: {x: 0, y: 0, width: n, height: n}});
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
