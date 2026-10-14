// Touch-emulated UI audit: layout at iPhone sizes, anchored bars, sheet dismissal, search, tooltips, a11y basics.
// Usage: node audit.js [baseURL] [outDir]   (env COACH_COOKIE='coach_session=…' for the password-gated live site)
const pp = require('/workspace/coach/tools/node_modules/puppeteer-core');
const base = process.argv[2] || 'http://127.0.0.1:8766/', out = process.argv[3] || '/tmp/aud';
const fails = [], notes = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const COOKIE = process.env.COACH_COOKIE || '';
const auth = async p => { if (COOKIE) { const [name, ...v] = COOKIE.split('='); await p.setCookie({name, value:v.join('='), url:base}); } };
const D0 = process.env.COACH_DAY || '2026-10-08';
const ROUTES = ['sleep/D', 'sleep/D/hours', 'sleep/D/consistency', 'sleep/D/efficiency', 'sleep/D/disturbances', 'recovery/D', 'metric/hrv/D', 'metric/resp/D', 'insights/D', 'strain/D', 'workout/D/0', 'session/D/0', 'day/D', 'meals/D', 'age/resting_hr', 'chart/time_in_bed/D', 'chart/z13/D', 'info/strain'].map(r => r.replace('D', D0));
const SAFE = ':root{--top:calc(47px + 8px)!important;--bottom:34px!important}'; // notch + home indicator (standalone)

(async () => {
  const b = await pp.launch({executablePath:'/usr/bin/google-chrome', args:['--no-sandbox','--hide-scrollbars']});
  const sizes = [[375, 667], [390, 844], [430, 932], [844, 390]];
  for (const [w, h] of sizes) for (const mode of ['safari', 'standalone']) {
    if (mode === 'standalone' && w !== 390 && w !== 844) continue;
    const tag = `${w}x${h}-${mode}`;
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('pageerror ' + e.message));
    p.on('console', m => { if (m.type() === 'error' || /Content Security Policy/.test(m.text())) errs.push('console ' + m.text()); });
    p.on('requestfailed', r => errs.push('reqfail ' + r.url()));
    p.on('response', r => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
    await p.setViewport({width:w, height:h, deviceScaleFactor:2, isMobile:true, hasTouch:true});
    await auth(p);
    await p.goto(base + '#today', {waitUntil:'networkidle0'});
    if (mode === 'standalone') await p.addStyleTag({content:SAFE});
    await p.waitForSelector('.dial[data-page]');
    const rects = () => p.evaluate(() => { const r = s => { const x = document.querySelector(s).getBoundingClientRect(); return [x.top, x.bottom, x.left, x.right].map(v => Math.round(v * 10) / 10).join(','); };
      return {tab:r('#tabbar'), top:r('#topbar'), docScroll:document.scrollingElement.scrollTop, winY:scrollY}; });
    const r0 = await rects();
    ok(+r0.tab.split(',')[1] === h, `${tag}: tabbar bottom ${r0.tab} not at viewport bottom ${h}`);
    ok(+r0.top.split(',')[0] === 0, `${tag}: topbar not at top ${r0.top}`);
    for (const t of ['today', 'health', 'trends', 'training', 'more', 'nutrition', 'history']) {
      await p.evaluate(t => { const b = document.querySelector(`.tabbar [data-tab="${t}"]`); if (b) b.click(); else location.hash = t; }, t); await sleep(300);
      const lay = await p.evaluate(() => {
        const V = document.getElementById('view'), tb = document.getElementById('tabbar').getBoundingClientRect(), tp = document.getElementById('topbar').getBoundingClientRect();
        V.scrollTop = 0; const first = V.firstElementChild.getBoundingClientRect();
        V.scrollTop = V.scrollHeight; const kids = [...V.children].filter(e => e.offsetHeight); const last = kids[kids.length - 1].getBoundingClientRect();
        const over = [...V.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1) && !e.closest('.chips'); }).map(e => e.className || e.tagName).slice(0, 5);
        const clipped = [...V.querySelectorAll('.t,.s,.v,.big,.huge,.lbl,.ring-lbl,h3,.caption,.sub')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible').map(e => e.className + ':' + e.textContent.slice(0, 30)).slice(0, 5);
        return {firstTop:first.top, topBottom:tp.bottom, lastBottom:last.bottom, tabTop:tb.top, docW:document.documentElement.scrollWidth, docCW:document.documentElement.clientWidth, bodyW:document.body.scrollWidth, viewW:V.scrollWidth - V.clientWidth, vw:innerWidth, over, clipped};
      });
      const smallIn = await p.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]),textarea,select')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id || e.name || e.tagName));
      ok(!smallIn.length, `${tag}/${t}: inputs under 16px (iOS focus-zoom): ${smallIn}`);
      ok(lay.firstTop >= lay.topBottom - 1, `${tag}/${t}: first content (${lay.firstTop}) under topbar (${lay.topBottom})`);
      ok(lay.lastBottom <= lay.tabTop + 1, `${tag}/${t}: last content (${lay.lastBottom}) hidden behind tabbar (${lay.tabTop})`);
      ok(lay.docW === lay.docCW && lay.bodyW <= lay.docCW && lay.viewW <= 0, `${tag}/${t}: horizontal overflow doc ${lay.docW}/${lay.docCW} body ${lay.bodyW} view +${lay.viewW}`);
      ok(!lay.over.length, `${tag}/${t}: elements off-screen: ${lay.over.join(' | ')}`);
      ok(!lay.clipped.length, `${tag}/${t}: text overflowing: ${lay.clipped.join(' | ')}`);
      if (w === 390 && h === 844 && mode === 'safari') await p.screenshot({path:`${out}/${t}.png`});
    }
    // scroll + overscroll test: bars must not move
    await p.evaluate(() => document.querySelector('.tabbar [data-tab="trends"]').click()); await sleep(200);
    const before = await rects();
    await p.evaluate(() => { const V = document.getElementById('view'); V.scrollTop = V.scrollHeight; window.scrollTo(0, 400); });
    await p.touchscreen.touchStart(w / 2, h * 0.6); for (let i = 1; i <= 8; i++) { await p.touchscreen.touchMove(w / 2, h * 0.6 - i * 40); } await p.touchscreen.touchEnd(); // overscroll at bottom
    await sleep(200);
    await p.evaluate(() => { document.getElementById('view').scrollTop = 0; }); 
    await p.touchscreen.touchStart(w / 2, h * 0.3); for (let i = 1; i <= 8; i++) { await p.touchscreen.touchMove(w / 2, h * 0.3 + i * 40); } await p.touchscreen.touchEnd(); // overscroll at top
    await sleep(300);
    const after = await rects();
    ok(before.tab === after.tab && before.top === after.top && after.docScroll === 0 && after.winY === 0, `${tag}: bars moved on scroll/overscroll ${JSON.stringify([before, after])}`);
    // ---- sheets ----
    const sheetOpen = () => p.evaluate(() => !document.getElementById('sheet').hidden && document.getElementById('sheet').classList.contains('show'));
    const closedWait = async () => { await sleep(450); return !(await sheetOpen()); };
    const openMenu = async () => { await p.evaluate(() => { if (!document.getElementById('methodrow')) document.querySelector('.tabbar [data-tab="more"]').click(); }); await sleep(250); await p.evaluate(() => document.getElementById('methodrow').click()); await sleep(450); return sheetOpen(); };
    const hlen0 = await p.evaluate(() => history.length);
    ok(await openMenu(), `${tag}: menu didn't open`);
    const lockInfo = await p.evaluate(() => ({ov:getComputedStyle(document.getElementById('view')).overflowY, inert:document.getElementById('view').inert, x:(r => [r.width, r.height])(document.getElementById('sheetclose').getBoundingClientRect()), xr:document.getElementById('sheetclose').getBoundingClientRect().right, tab:document.getElementById('tabbar').getBoundingClientRect().bottom, sb:getComputedStyle(document.getElementById('sheetbody')).paddingBottom, focus:document.activeElement.id}));
    ok(lockInfo.ov === 'hidden' && lockInfo.inert, `${tag}: page not locked under sheet ${JSON.stringify(lockInfo)}`);
    ok(Math.round(lockInfo.x[0]) >= 44 && Math.round(lockInfo.x[1]) >= 44 && lockInfo.xr <= w, `${tag}: X target ${lockInfo.x}`);
    ok(lockInfo.focus === 'sheetclose', `${tag}: focus not moved into sheet (${lockInfo.focus})`);
    ok(lockInfo.tab === h, `${tag}: tabbar moved when sheet opened`);
    // scrim tap (top area above the sheet)
    await p.touchscreen.tap(w / 2, 20 + (mode === 'standalone' ? 0 : 0)); ok(await closedWait(), `${tag}: scrim tap didn't close menu`);
    ok(await openMenu(), `${tag}: reopen`); await p.keyboard.press('Escape'); ok(await closedWait(), `${tag}: Escape didn't close`);
    ok(await openMenu(), `${tag}: reopen`); await p.evaluate(() => history.back()); ok(await closedWait(), `${tag}: back didn't close`);
    ok(await openMenu(), `${tag}: reopen`); await p.evaluate(() => document.getElementById('sheetclose').click()); ok(await closedWait(), `${tag}: X didn't close`);
    const focusBack = await p.evaluate(() => document.activeElement.id); ok(focusBack === 'methodrow', `${tag}: focus not restored (${focusBack})`);
    // swipe: short slow drag springs back, long drag closes, quick flick closes
    const grab = async (dy, steps, delay) => { const g = await p.evaluate(() => { const r = document.getElementById('grab').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 10]; });
      await p.touchscreen.touchStart(g[0], g[1]); for (let i = 1; i <= steps; i++) { await p.touchscreen.touchMove(g[0], g[1] + dy * i / steps); if (delay) await sleep(delay); } await p.touchscreen.touchEnd(); };
    ok(await openMenu(), `${tag}: reopen`); await grab(50, 10, 40); await sleep(450);
    ok(await sheetOpen() && await p.evaluate(() => document.getElementById('sheet').style.transform === ''), `${tag}: 50px slow drag should spring back`);
    await grab(130, 10, 20); ok(await closedWait(), `${tag}: 130px drag didn't close`);
    ok(await openMenu(), `${tag}: reopen`); await grab(40, 3, 0); ok(await closedWait(), `${tag}: quick flick didn't close`);
    // menu item closes + navigates
    // no top-bar menu any more: the More tab holds every former menu item
    ok(await p.evaluate(() => !document.getElementById('menubtn') && !!document.querySelector('#topbar #q')), `${tag}: menu button still present or search missing`);
    const moreItems = await p.evaluate(() => ['nutrition', 'history', 'journal', 'insights'].every(k => document.querySelector(`#view [data-go="${k}"]`)) && !!document.querySelector('#view [data-method]') && !!document.querySelector('#view a[href="/logout"]'));
    ok(moreItems, `${tag}: More tab missing a former menu item`);
    await p.evaluate(() => document.querySelector('#view [data-go="history"]').click()); await sleep(500);
    ok(await p.evaluate(() => document.querySelector('.tabbar .on').dataset.tab === 'more' && location.hash === '#history'), `${tag}: More > History didn't navigate`);
    await p.evaluate(() => document.querySelector('.tabbar [data-tab="more"]').click()); await sleep(300);
    await p.evaluate(() => document.querySelector('#view [data-go="insights"]').click()); await sleep(500);
    const ins = await p.evaluate(() => { const r = document.getElementById('insights').getBoundingClientRect(); return [document.querySelector('.tabbar .on').dataset.tab, Math.round(r.top), Math.round(document.getElementById('topbar').getBoundingClientRect().bottom)]; });
    ok(ins[0] === 'trends' && ins[1] >= ins[2] - 1 && ins[1] < ins[2] + 40, `${tag}: insights nav ${ins}`);
    // ---- detail pages: push, back chevron, history back, Esc, edge swipe, scroll restore, tab bar on top ----
    await p.evaluate(() => document.querySelector('.tabbar [data-tab="today"]').click()); await sleep(300);
    const pg = () => p.evaluate(() => ({n:document.querySelectorAll('.page.in').length, total:document.querySelectorAll('.page').length, hash:location.hash, view:document.getElementById('view').scrollTop}));
    await p.evaluate(() => { document.getElementById('view').scrollTop = 260; }); await sleep(100);
    const y0 = await p.evaluate(() => document.getElementById('view').scrollTop);
    await p.evaluate(() => document.querySelector('.dial[data-page^="sleep/"]').click()); await sleep(500);
    let st = await pg(); ok(st.n === 1 && /^#\/sleep\/\d{4}-\d\d-\d\d$/.test(st.hash), `${tag}: sleep page push ${JSON.stringify(st)}`);
    const onTop = await p.evaluate(() => { const r = document.getElementById('tabbar').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !!e.closest('#tabbar'); });
    ok(onTop, `${tag}: tab bar covered by page`);
    const pl = await p.evaluate(() => { const b = document.querySelector('.page.in:last-child .pbody'), tb = document.getElementById('tabbar').getBoundingClientRect(), hd = document.querySelector('.page.in:last-child .phead').getBoundingClientRect();
      b.scrollTop = b.scrollHeight; const kids = [...b.children].filter(e => e.offsetHeight), last = kids[kids.length - 1].getBoundingClientRect();
      const over = [...b.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(e => e.className.baseVal ?? e.className).slice(0, 4);
      const bk = document.querySelector('.page.in:last-child .pback').getBoundingClientRect(); b.scrollTop = 0;
      return {last:last.bottom, tab:tb.top, over, hd:hd.top, back:[bk.width, bk.height], focus:document.activeElement.className}; });
    ok(pl.last <= pl.tab + 1, `${tag}: page content hidden behind tab bar ${JSON.stringify(pl)}`);
    ok(!pl.over.length, `${tag}: page elements off-screen ${pl.over.join('|')}`);
    ok(pl.hd === 0 && Math.round(pl.back[0]) >= 44 && Math.round(pl.back[1]) >= 44, `${tag}: page header ${JSON.stringify(pl)}`);
    ok(pl.focus === 'pback', `${tag}: focus not on back button (${pl.focus})`);
    // nested push + back chevron
    await p.evaluate(() => document.querySelector('.page.in:last-child [data-page$="/hours"]').click()); await sleep(500);
    st = await pg(); ok(st.n === 2 && /\/hours$/.test(st.hash), `${tag}: sub-score page ${JSON.stringify(st)}`);
    await p.evaluate(() => document.querySelector('.page.in:last-child .pback').click()); await sleep(500);
    st = await pg(); ok(st.n === 1 && /^#\/sleep\/[\d-]+$/.test(st.hash), `${tag}: back chevron ${JSON.stringify(st)}`);
    // range switch keeps the page and its scroll
    const rs = await p.evaluate(async () => { const b = document.querySelector('.page.in:last-child .pbody'); b.scrollTop = 1500; const y = b.scrollTop; document.querySelector('.page.in:last-child [data-prange="30"]').click(); await new Promise(r => setTimeout(r, 150));
      const n = document.querySelectorAll('.page.in:last-child .tcard').length, on = document.querySelector('.page.in:last-child [data-prange="30"]').classList.contains('on'), y2 = b.scrollTop; document.querySelector('.page.in:last-child [data-prange="7"]').click(); await new Promise(r => setTimeout(r, 100)); b.scrollTop = 0; return [y, y2, n, on]; });
    ok(rs[2] > 5 && rs[3] && Math.abs(rs[0] - rs[1]) < 2, `${tag}: range switch ${rs}`);
    // chart column tap opens that day
    await p.evaluate(() => document.querySelector('.page.in:last-child .tcard .hit').dispatchEvent(new MouseEvent('click', {bubbles:true}))); await sleep(500);
    st = await pg(); ok(st.n === 2 && /^#\/sleep\//.test(st.hash), `${tag}: chart column tap ${JSON.stringify(st)}`);
    await p.evaluate(() => history.back()); await sleep(500);
    // history back
    await p.evaluate(() => history.back()); await sleep(500);
    st = await pg(); ok(st.n === 0 && st.hash === '#today' && Math.abs(st.view - y0) < 2, `${tag}: history back / scroll restore ${JSON.stringify(st)} y0=${y0}`);
    // Esc
    await p.evaluate(() => document.querySelector('.dial[data-page^="recovery/"]').click()); await sleep(500);
    await p.keyboard.press('Escape'); await sleep(500); st = await pg(); ok(st.n === 0 && st.hash === '#today', `${tag}: Esc ${JSON.stringify(st)}`);
    // edge swipe: short slow drag springs back, long drag pops
    await p.evaluate(() => document.querySelector('.dial[data-page^="strain/"]').click()); await sleep(500);
    const edge = async (dx, steps, delay) => { await p.touchscreen.touchStart(6, h * 0.5); for (let i = 1; i <= steps; i++) { await p.touchscreen.touchMove(6 + dx * i / steps, h * 0.5 + i); if (delay) await sleep(delay); } await p.touchscreen.touchEnd(); await sleep(500); };
    await edge(50, 10, 40); st = await pg(); ok(st.n === 1 && await p.evaluate(() => document.querySelector('.page.in').style.transform === ''), `${tag}: short edge swipe should spring back ${JSON.stringify(st)}`);
    await edge(w * 0.6, 12, 10); st = await pg(); ok(st.n === 0 && st.hash === '#today', `${tag}: edge swipe back ${JSON.stringify(st)}`);
    // swipe that starts away from the edge must not pop
    await p.evaluate(() => document.querySelector('.dial[data-page^="strain/"]').click()); await sleep(500);
    await p.touchscreen.touchStart(w * 0.4, h * 0.5); for (let i = 1; i <= 10; i++) await p.touchscreen.touchMove(w * 0.4 + i * 18, h * 0.5); await p.touchscreen.touchEnd(); await sleep(400);
    st = await pg(); ok(st.n === 1, `${tag}: mid-screen swipe popped the page`);
    // tab tap while a page is open closes it and switches tab
    await p.evaluate(() => document.querySelector('.tabbar [data-tab="training"]').click()); await sleep(600);
    st = await pg(); ok(st.n === 0 && st.hash === '#training', `${tag}: tab tap from page ${JSON.stringify(st)}`);
    // workout and session pages from the training log
    await p.evaluate(() => document.querySelector('#view [data-page^="session/"]').click()); await sleep(500);
    st = await pg(); ok(st.n === 1 && /^#\/session\//.test(st.hash), `${tag}: session page ${JSON.stringify(st)}`);
    await p.evaluate(() => history.back()); await sleep(500);
    await p.evaluate(() => document.querySelector('.tabbar [data-tab="today"]').click()); await sleep(300);
    // every route: renders, no overflow
    for (const r of ROUTES) {
      await p.evaluate(r => { location.hash = '#/' + r; }, r); await sleep(450);
      const q = await p.evaluate(() => { const top = [...document.querySelectorAll('.page.in')].pop(); if (!top) return null; const b = top.querySelector('.pbody');
        const over = [...b.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(e => e.className.baseVal ?? e.className).slice(0, 3);
        return {route:top.dataset.route, len:b.textContent.length, over, empty:/Couldn.t open/.test(b.textContent), docW:document.documentElement.scrollWidth, docCW:document.documentElement.clientWidth, bodyW:b.scrollWidth - b.clientWidth}; });
      ok(q && q.route === r && q.len > 40 && !q.empty, `${tag}: route ${r} ${JSON.stringify(q)}`);
      ok(q && !q.over.length && q.docW === q.docCW && q.bodyW <= 0, `${tag}: route ${r} overflow ${JSON.stringify(q)}`);
      if (w === 390 && h === 844 && mode === 'safari' && /^(sleep|recovery|strain)\/[\d-]+$/.test(r)) await p.screenshot({path:`${out}/page-${r.split('/')[0]}.png`});
    }
    await p.evaluate(() => { history.replaceState(null, '', '#today'); }); await p.goto(base + '#today', {waitUntil:'networkidle0'}); if (mode === 'standalone') await p.addStyleTag({content:SAFE}); await sleep(200);
    // journal sheet
    await p.evaluate(() => document.querySelector('[data-journal]').click()); await sleep(450); ok(await sheetOpen(), `${tag}: journal didn't open`);
    await p.keyboard.press('Escape'); ok(await closedWait(), `${tag}: journal Esc`);
    ok((await p.evaluate(() => history.length)) >= hlen0, 'history');
    // ---- search ----
    await p.focus('#q'); await sleep(100);
    const kb = await p.evaluate(() => [document.body.classList.contains('kb'), getComputedStyle(document.getElementById('tabbar')).visibility, !document.getElementById('qcancel').hidden]);
    ok(kb[0] && kb[1] === 'hidden' && kb[2], `${tag}: keyboard state ${kb}`);
    await p.keyboard.type('bench'); await sleep(200);
    const sr = await p.evaluate(() => [!document.getElementById('searchview').hidden, document.querySelectorAll('#searchview .li').length]);
    ok(sr[0] && sr[1] > 0, `${tag}: search results ${sr}`);
    await p.evaluate(() => document.querySelector('#searchview [data-day]').click()); await sleep(500);
    ok(await p.evaluate(() => document.querySelectorAll('.page.in').length === 1 && /^#\/day\//.test(location.hash)), `${tag}: day page from search`);
    await p.evaluate(() => history.back()); await sleep(500);
    ok(await p.evaluate(() => !document.querySelector('.page.in') && !document.getElementById('searchview').hidden), `${tag}: back should close day page but keep search`);
    await p.evaluate(() => history.back()); await sleep(300);
    ok(await p.evaluate(() => document.getElementById('searchview').hidden && document.getElementById('q').value === ''), `${tag}: back should close search`);
    await p.focus('#q'); await p.keyboard.type('zzzqqq'); await sleep(150);
    ok(await p.evaluate(() => /No results/.test(document.getElementById('searchview').textContent)), `${tag}: empty search state`);
    await p.keyboard.press('Escape'); await sleep(250);
    ok(await p.evaluate(() => document.getElementById('searchview').hidden && !document.body.classList.contains('kb')), `${tag}: Esc closes search`);
    for (const qq of ['oct 3', 'yesterday', 'sauna', 'turkey']) { await p.focus('#q'); await p.keyboard.type(qq); await sleep(120); const n = await p.evaluate(() => document.querySelectorAll('#searchview .li').length); ok(n > 0, `${tag}: search "${qq}" no results`); await p.evaluate(() => document.getElementById('qcancel').click()); await sleep(250); }
    ok(await p.evaluate(() => document.getElementById('searchview').hidden), `${tag}: Cancel closes search`);
    // ---- tooltip ----
    await p.evaluate(() => document.querySelector('.tabbar [data-tab="trends"]').click()); await sleep(300);
    const cbox = await p.evaluate(() => { document.querySelector('.chart').scrollIntoView({block:'center'}); const r = document.querySelector('.chart').getBoundingClientRect(); return [r.left + r.width * 0.9, r.top + r.height / 2]; });
    await p.touchscreen.touchStart(cbox[0], cbox[1]); await sleep(50);
    const tip = await p.evaluate(() => { const t = document.getElementById('tip'), r = t.getBoundingClientRect(); return [!t.hidden, r.left >= 0, r.right <= innerWidth, t.textContent]; });
    await p.touchscreen.touchEnd();
    ok(tip[0] && tip[1] && tip[2], `${tag}: tooltip ${tip}`);
    // ---- collapsing dials, date switcher, health monitor sheet ----
    await p.evaluate(() => document.querySelector('.tabbar [data-tab="today"]').click()); await sleep(300);
    const col = await p.evaluate(async () => { const V = document.getElementById('view'); V.scrollTop = 0; await new Promise(r => setTimeout(r, 250)); const a = document.body.classList.contains('collapsed');
      V.scrollTop = 600; await new Promise(r => setTimeout(r, 350)); const m = document.getElementById('mbar').getBoundingClientRect(), tb = document.getElementById('topbar').getBoundingClientRect();
      const b2 = document.body.classList.contains('collapsed'), vis = getComputedStyle(document.getElementById('mbar')).visibility; V.scrollTop = 0; await new Promise(r => setTimeout(r, 300));
      return [a, b2, vis, Math.abs(m.top - tb.bottom) < 1, document.body.classList.contains('collapsed'), [...document.querySelectorAll('.mbar .mi')].map(e => e.textContent).join('/')]; });
    ok(!col[0] && col[1] && col[2] === 'visible' && col[3] && !col[4] && col[5] === 'Sleep/Recovery/Strain', `${tag}: collapsing header ${col}`);
    const dsw = await p.evaluate(async () => { document.querySelector('[data-step="-1"]').click(); await new Promise(r => setTimeout(r, 200)); const l1 = document.querySelector('.datepill b').textContent;
      document.querySelector('[data-step="1"]').click(); await new Promise(r => setTimeout(r, 200)); return [l1, document.querySelector('.datepill b').textContent, document.querySelector('[data-step="1"]').disabled]; });
    ok(dsw[0] === 'YESTERDAY' && dsw[1] === 'TODAY' && dsw[2], `${tag}: date switcher ${dsw}`);
    await p.evaluate(() => document.querySelector('.tabbar [data-tab="health"]').click()); await sleep(300);
    await p.evaluate(() => document.querySelector('[data-metric="hrv"]').click()); await sleep(500);
    ok(await p.evaluate(() => /^#\/metric\/hrv\//.test(location.hash) && !!document.querySelector('.page.in .wchart')), `${tag}: metric page`);
    await p.keyboard.press('Escape'); await sleep(500); ok(await p.evaluate(() => !document.querySelector('.page.in')), `${tag}: metric page esc`);
    // deep-link reload: parents rebuilt underneath, back walks up the chain to the tab
    await p.goto('about:blank'); await p.goto(base + `#/metric/hrv/${D0}`, {waitUntil:'networkidle0'}); await sleep(400);
    let dl = await p.evaluate(() => ({pages:[...document.querySelectorAll('.page.in')].map(e => e.dataset.route), hash:location.hash, tab:document.querySelector('.tabbar .on').dataset.tab}));
    ok(dl.pages.join('>') === `recovery/${D0}>metric/hrv/${D0}` && dl.tab === 'today', `${tag}: deep link ${JSON.stringify(dl)}`);
    await p.reload({waitUntil:'networkidle0'}); await sleep(400);
    dl = await p.evaluate(() => [...document.querySelectorAll('.page.in')].map(e => e.dataset.route).join('>')); ok(dl === `recovery/${D0}>metric/hrv/${D0}`, `${tag}: deep link after reload ${dl}`);
    await p.evaluate(() => document.querySelector('.page.in:last-child .pback').click()); await sleep(500);
    dl = await p.evaluate(() => [[...document.querySelectorAll('.page.in')].map(e => e.dataset.route).join('>'), location.hash]); ok(dl[0] === `recovery/${D0}` && dl[1] === `#/recovery/${D0}`, `${tag}: deep link back 1 ${dl}`);
    await p.evaluate(() => document.querySelector('.page.in:last-child .pback').click()); await sleep(500);
    dl = await p.evaluate(() => [document.querySelectorAll('.page.in').length, location.hash]); ok(dl[0] === 0 && dl[1] === '#today', `${tag}: deep link back 2 ${dl}`);
    await p.goto('about:blank'); await p.goto(base + '#/session/' + D0 + '/0', {waitUntil:'networkidle0'}); await sleep(300);
    ok(await p.evaluate(() => document.querySelector('.tabbar .on').dataset.tab === 'training' && document.querySelectorAll('.page.in').length === 1), `${tag}: session deep link base tab`);
    await p.goto(base + '#today', {waitUntil:'networkidle0'}); await sleep(200);
    // ---- filters + show more ----
    await p.evaluate(() => { location.hash = 'history'; }); await sleep(300);
    for (const f of ['workout', 'meal', 'weight', 'supplements', 'journal', 'whoop', 'all']) { await p.evaluate(f => document.querySelector(`[data-filter="${f}"]`).click(), f); await sleep(80); }
    if (await p.$('[data-more]')) { await p.evaluate(() => document.querySelector('[data-more]').click()); await sleep(100); }
    for (const r of ['7', '90', 'all', '30']) { await p.evaluate(() => document.querySelector('.tabbar [data-tab="trends"]').click()); await sleep(100); await p.evaluate(r => document.querySelector(`[data-range="${r}"]`).click(), r); await sleep(100); }
    ok(!errs.length, `${tag}: errors: ${errs.join(' | ')}`);
    notes.push(`${tag}: done`);
    await p.close();
  }
  // a11y: unnamed buttons, focus order, reduced motion
  const p = await b.newPage(); await p.setViewport({width:390, height:844, isMobile:true, hasTouch:true});
  await p.emulateMediaFeatures([{name:'prefers-reduced-motion', value:'reduce'}]);
  await auth(p); await p.goto(base, {waitUntil:'networkidle0'}); await p.waitForSelector('.dial[data-page]');
  const unnamed = await p.evaluate(() => [...document.querySelectorAll('button,[role=button]')].filter(e => !(e.getAttribute('aria-label') || e.textContent.trim())).map(e => e.outerHTML.slice(0, 80)));
  ok(!unnamed.length, `a11y: unnamed buttons ${unnamed.join(' | ')}`);
  const order = []; for (let i = 0; i < 12; i++) { await p.keyboard.press('Tab'); order.push(await p.evaluate(() => { const e = document.activeElement; return e.id || e.dataset.tab || e.dataset.go || e.dataset.day || e.dataset.journal || e.tagName; })); }
  notes.push('focus order: ' + order.join(' > '));
  await p.evaluate(() => document.querySelector('.tabbar [data-tab="more"]').click()); await sleep(100); await p.evaluate(() => document.getElementById('methodrow').click()); await sleep(300);
  const rm = await p.evaluate(() => getComputedStyle(document.getElementById('sheet')).transitionDuration);
  ok(/^0s/.test(rm), `reduced motion: sheet transition ${rm}`);
  // keyboard: Tab stays in dialog (rest inert)
  const inDlg = []; for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); inDlg.push(await p.evaluate(() => !!document.activeElement.closest('#sheet'))); }
  ok(inDlg.every(Boolean), `a11y: focus escaped the dialog ${inDlg}`);
  // a11y on pages: reduced motion = no slide, background inert, focus trapped in the page + tab bar
  await p.keyboard.press('Escape'); await sleep(100);
  await p.evaluate(() => document.querySelector('.tabbar [data-tab="today"]').click()); await sleep(200);
  await p.evaluate(() => document.querySelector('.dial[data-page^="sleep/"]').click()); await sleep(80);
  const pa = await p.evaluate(() => ({tr:getComputedStyle(document.querySelector('.page')).transitionDuration, inert:document.getElementById('view').inert && document.getElementById('topbar').inert}));
  ok(/^0s/.test(pa.tr) && pa.inert, `a11y: page reduced motion / inert ${JSON.stringify(pa)}`);
  const unnamed2 = await p.evaluate(() => [...document.querySelectorAll('.page button,.page [role=button]')].filter(e => !(e.getAttribute('aria-label') || e.textContent.trim())).map(e => e.outerHTML.slice(0, 80)));
  ok(!unnamed2.length, `a11y: unnamed page buttons ${unnamed2.join(' | ')}`);
  await b.close();
  console.log(notes.join('\n')); console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'ALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
