/* Coach PWA (starter kit) — vanilla JS, no dependencies. Data: /data.json (+ /wear/YYYY-MM.json archives). Config: data.json -> config. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
let TZ = 'UTC';   // set from data.json profile.timezone at boot
/* WHOOP-style palette: recovery zones green/yellow/red, strain blue, muted sleep blue, white accent. */
const C = {acc:'#ffffff', green:'#16ec06', yellow:'#ffde00', red:'#ff0026', strain:'#0093e7', sleep:'#7ba1bb', violet:'#a89bd9', orange:'#ff9f0a', pink:'#ff6b8b', blue:'#00a3ff', gray:'#6b7177'};
const TYPE_C = {PUSH:C.acc, PULL:C.blue, LEGS:C.violet, RUN:C.orange, REST:C.gray};
/* ---------- config: theme, units, wearable ---------- */
const PALETTES = {
  recovery:{acc:'#ffffff', green:'#16ec06', yellow:'#ffde00', red:'#ff0026', strain:'#0093e7', sleep:'#7ba1bb', blue:'#00a3ff', gray:'#6b7177'},
  glass:{acc:'#ffffff', green:'#16ec06', yellow:'#ffde00', red:'#ff3b5c', strain:'#3aa8ff', sleep:'#9db8ff', blue:'#5ab8ff', gray:'#7c84a0'},
  light:{acc:'#0d0f12', green:'#0d9e00', yellow:'#c08f00', red:'#e0002a', strain:'#0077c2', sleep:'#4f7894', blue:'#0a84ff', gray:'#9aa0a6'}};
const THEMES = [['recovery', 'Recovery'], ['glass', 'Glass'], ['light', 'Light']];
let THEME = 'recovery', U = 'lb', WK = 'none', WN = 'Check-in', LBL = {Rec:'Recovery', rec:'recovery'}, HAS_STRAIN = false;
const ink = a => `rgba(${THEME === 'light' ? '0,0,0' : '255,255,255'},${a})`;
const PU = () => !!(((D.config || {}).features || {}).pullups || D.pullup_max.length || D.gtg.length);
const toKg = v => v == null ? null : U === 'kg' ? v : v / 2.20462;
const wpW = wp => U === 'kg' ? (wp.weight_kg ? `${Math.round(wp.weight_kg * 10) / 10} kg` : '') : (wp.weight_lb ? `${wp.weight_lb} lb` : '');
function applyTheme(t) {
  THEME = PALETTES[t] ? t : 'recovery'; Object.assign(C, PALETTES[THEME]);
  Object.assign(TYPE_C, {PUSH:C.acc, PULL:C.blue, LEGS:C.violet, RUN:C.orange, REST:C.gray});
  document.documentElement.dataset.theme = THEME;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = THEME === 'light' ? '#f2f3f5' : THEME === 'glass' ? '#0a0d1a' : '#0b0b0b';
}
function applyConfig() {
  const cf = D.config || {};
  TZ = (D.profile && D.profile.timezone) || cf.timezone || 'UTC';
  U = (D.profile && D.profile.units) === 'kg' ? 'kg' : 'lb';
  WK = (D.wear && D.wear.source) || cf.wearable || 'none';
  WN = {whoop:'WHOOP', oura:'Oura', fitbit:'Fitbit', none:'Check-in'}[WK] || 'Wearable';
  LBL = WK === 'whoop' || WK === 'none' ? {Rec:'Recovery', rec:'recovery'} : {Rec:'Readiness', rec:'readiness'};
  HAS_STRAIN = WK === 'whoop';
  applyTheme(localStorage.getItem('coach.theme') || cf.theme || 'recovery');
  if (cf.site_title) document.title = cf.site_title;
}
/* Wearable wording: the UI copy was written for WHOOP; for other sources, rewrite visible text only (never attributes
   used for routing), so "WHOOP" becomes the source name and "Recovery" becomes "Readiness". */
function brandDom(el) {
  if (!el || WK === 'whoop') return;
  const swap = t => t.replace(/\bWHOOP\b/g, WN).replace(/\bRecovery\b/g, LBL.Rec).replace(/\brecovery\b/g, LBL.rec);
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
  while ((n = tw.nextNode())) { const v = n.nodeValue; if (/WHOOP|[Rr]ecovery/.test(v)) n.nodeValue = swap(v); }
  el.querySelectorAll('[aria-label]').forEach(x => { const v = x.getAttribute('aria-label'); if (/WHOOP|[Rr]ecovery/.test(v)) x.setAttribute('aria-label', swap(v)); });
}
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const TRAIN_SPORTS = new Set(['weightlifting','weightlifting_msk','running','rucking','stairmaster','cycling','functional-fitness','hiit','swimming','rowing','crossfit','powerlifting','spin','boxing','climbing']);
const JOURNAL = [
  ['alcohol','Alcohol','int','drinks','wine'], ['caffeine','Caffeine','int','servings','coffee'], ['caffeine_last','Last caffeine','time','','clock'],
  ['late_meal','Late meal','bool','','moon'], ['screen_in_bed','Screens in bed','bool','','device-mobile'], ['stress','Stress','scale','','smiley-nervous'],
  ['hydration','Hydration','float','oz','drop'], ['sauna','Sauna','bool','','thermometer-hot'], ['cold','Cold exposure','bool','','snowflake'],
  ['creatine','Creatine','link','from habits','pill'], ['supplements','Supplements','link','from habits','check-circle'],
  ['intimacy','Intimacy','bool','','lock'], ['reading','Reading before bed','bool','','book-open'], ['meditation','Meditation / breathwork','bool','','flower-lotus'],
  ['sunlight','Morning sunlight','bool','','sun-horizon'], ['energy','Energy','scale','','lightning'], ['mood','Mood','scale','','smiley'],
  ['soreness','Soreness','scale','','bandaids'], ['illness','Illness / injury','text','','first-aid'], ['note','Notes','text','','note-pencil'],
];
const JMAP = Object.fromEntries(JOURNAL.map(j => [j[0], j]));

let D, W = {}, TODAY, tab = 'today';
let range = localStorage.getItem('coach.range') || '30';
let liftKey = null, histFilter = 'all', histLimit = 21, logLimit = 10;
const CH = {};
let chartSeq = 0;

/* ---------- dates ---------- */
const dt = s => new Date(s + 'T12:00:00Z');
const iso = d => d.toISOString().slice(0, 10);
const add = (s, n) => { const d = dt(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dow = s => (dt(s).getUTCDay() + 6) % 7;
const diffDays = (a, b) => Math.round((dt(b) - dt(a)) / 864e5);
const fd = (s, o) => dt(s).toLocaleDateString('en-US', Object.assign({timeZone:'UTC'}, o));
const fShort = s => fd(s, {month:'short', day:'numeric'});
const fLong = s => fd(s, {weekday:'long', month:'short', day:'numeric'});
const fMed = s => fd(s, {weekday:'short', month:'short', day:'numeric'});
const fTime = t => t ? new Date(t).toLocaleTimeString('en-US', {timeZone:TZ, hour:'numeric', minute:'2-digit'}).replace(/\s(?=[AP]M$)/, '\u00a0') : '';
const ctToday = () => new Intl.DateTimeFormat('en-CA', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
const relDay = s => s === TODAY ? 'Today' : s === add(TODAY, -1) ? 'Yesterday' : fMed(s);

/* ---------- formatting ---------- */
const n0 = v => v == null || isNaN(v) ? '–' : Math.round(v).toLocaleString('en-US');
const n1 = v => v == null || isNaN(v) ? '–' : (Math.round(v * 10) / 10).toFixed(1);
const hm = h => { if (h == null) return '–'; const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const recColor = s => s == null ? C.gray : s >= 67 ? C.green : s >= 34 ? C.yellow : C.red;
const avg = (a, min = 1) => { const v = a.filter(x => x != null && !isNaN(x)); return v.length >= min ? v.reduce((p, c) => p + c, 0) / v.length : null; };
const sdev = a => { const m = avg(a); return a.length > 1 ? Math.sqrt(a.reduce((p, c) => p + (c - m) ** 2, 0) / (a.length - 1)) : 0; };
const title = s => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bMsk\b/, 'MSK');

/* ---------- data access ---------- */
const wd = d => W[d] || {};
const rec = d => (wd(d).recovery || {});
const slp = d => (wd(d).sleep || {});
const cyc = d => (wd(d).cycle || {});
const by = (arr, k = 'date') => arr.reduce((m, x) => ((m[x[k]] = m[x[k]] || []).push(x), m), {});
let FOOD, LIFTS, GTG, WEIGHTS;
function derive() {
  FOOD = by(D.food); LIFTS = by(D.workouts); GTG = by(D.gtg);
  WEIGHTS = [...D.weights].sort((a, b) => a.date < b.date ? -1 : 1);
}
const foodTot = d => (FOOD[d] || []).reduce((t, f) => ({cal:t.cal + (f.cal || 0), protein:t.protein + (f.protein || 0), fat:t.fat + (f.fat || 0), sugar:t.sugar + (f.sugar || 0), n:t.n + 1}), {cal:0, protein:0, fat:0, sugar:0, n:0});
const supps = d => D.supplement_log[d] || [];
const whoopTrain = d => (wd(d).workouts || []).filter(w => TRAIN_SPORTS.has(w.sport));
const trained = d => (LIFTS[d] || []).length > 0 || whoopTrain(d).length > 0;
const dayType = d => D.split[DOW[dow(d)]] || 'REST';
const saunaDay = d => (wd(d).workouts || []).some(w => w.sport === 'sauna') || supps(d).includes('sauna') || (D.journal[d] || {}).sauna === true;
function streak() {
  let s = 0, d = trained(TODAY) ? TODAY : add(TODAY, -1);
  for (let i = 0; i < 400; i++, d = add(d, -1)) {
    if (trained(d)) s++; else if (dayType(d) !== 'REST') break;
  }
  return s;
}
const weekStart = d => add(d, -dow(d));

/* ---------- UI primitives ---------- */
/* Phosphor icons (MIT): one tiny same-origin symbol file per icon, dist/i/<name>.svg (written by build.py). ic(name) = regular weight, ic(name, 1) = fill. */
const ic = (n, f, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="/i/${n}${f ? '-fill' : ''}.svg#i"/></svg>`;
const chev = ic('caret-right', 0, 'chev');
const chk = on => on ? ic('check-circle', 1, 'chk on') : ic('circle', 0, 'chk');
/* icons used dynamically: wine coffee clock moon device-mobile smiley-nervous drop thermometer-hot snowflake pill check-circle lock book-open flower-lotus sun-horizon lightning smiley bandaids first-aid note-pencil watch arrow-up arrow-down minus sun heartbeat chart-line-up barbell fork-knife clock-counter-clockwise notebook lightning info person-simple-run person-simple-walk person-arms-spread bicycle heart wind sign-out wave-sine drop-half-bottom thermometer-simple flame arrow-up-right */
function ring(pct, color, center, small, size = 104) {
  const r = 42, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct || 0));
  return `<div class="ring" style="max-width:${size}px"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="${r}"/>
  ${p > 0 ? `<circle class="val" cx="50" cy="50" r="${r}" stroke="${color}" stroke-dasharray="${c.toFixed(1)}" data-off="${(c * (1 - p)).toFixed(1)}" stroke-dashoffset="${RM ? (c * (1 - p)).toFixed(1) : c.toFixed(1)}" transform="rotate(-90 50 50)"/>` : ''}</svg>
  <div class="ctr"><b class="num">${center}</b>${small ? `<small>${small}</small>` : ''}</div></div>`;
}
const bar = (pct, color) => `<div class="bar"><span style="width:${Math.max(0, Math.min(100, pct * 100)).toFixed(1)}%;background:${color}"></span></div>`;
const metric = (label, val, target, unit, color) => `<div class="metric"><div class="row"><span>${label}</span><span class="sub"><b style="color:var(--txt)">${n0(val)}</b>${target ? ` / ${n0(target)}` : ''} ${unit}${target ? '' : ' · no target'}</span></div>${target ? bar(val / target, val > target && /Sugar|Fat/.test(label) ? C.red : color) : ''}</div>`;
const tile = (lbl, v, unit = '', color = '') => `<div class="tile"><div class="lbl">${lbl}</div><div class="v"${color ? ` style="color:${color}"` : ''}>${v}${unit ? `<span class="unit">${unit}</span>` : ''}</div></div>`;
const BTN = ' role="button" tabindex="0"';
const card = (head, body, opts = {}) => `<div class="card${opts.tap || /data-page/.test(opts.attr || '') ? ' tap' : ''}${opts.cls ? ' ' + opts.cls : ''}"${opts.tap ? ` data-go="${opts.tap}"` : ''}${opts.attr || ''}${opts.tap || /data-(day|journal|page)/.test(opts.attr || '') ? BTN : ''}>${head ? `<div class="ch"><h2>${head}</h2><div class="meta">${opts.meta || ''}${opts.tap ? chev : ''}</div></div>` : ''}${body}</div>`;
const li = (ico, t, s, r, attr = '', bare) => `<div class="li${attr ? ' tap' : ''}"${attr}${attr ? BTN : ''}>${bare ? ico : `<div class="ico">${ico}</div>`}<div class="body"><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div>${r != null ? `<div class="r">${r}</div>` : ''}</div>`;
/* Meal journal row: photo thumbnail (or fork-knife), macros, Macro Score chip. Rows with a photo / score / tip open the meal sheet. */
const mealMacros = f => `${n0(f.protein)} g protein · ${n0(f.fat)} g fat${f.carbs != null ? ` · ${n0(f.carbs)} g carbs` : ''} · ${n0(f.sugar)} g sugar`;
const scoreCls = n => n >= 8 ? 'good' : n >= 5 ? 'mid' : 'low';
const mealRow = f => {
  const i = D.food.indexOf(f), rich = f.photo || f.score != null || f.tip;
  const ico = f.photo ? `<div class="ico mthumb" data-lightbox="${i}"><img src="/m/${esc(f.photo)}-t.jpg" alt="" loading="lazy" decoding="async" width="44" height="44"></div>` : `<div class="ico">${ic('fork-knife')}</div>`;
  const sc = f.score != null ? `<span class="mscore ${scoreCls(f.score)}">${f.score}/10</span> ` : '';
  return li(ico, sc + esc(f.note || 'Meal'), mealMacros(f) + (f.time ? ' · ' + fTime(f.time) : ''), `${n0(f.cal)}<small>kcal</small>`, rich ? ` data-meal="${i}"` : '', true);
};
function openMeal(i, trigger) {
  const f = D.food[+i]; if (!f) return;
  const m = (l, v, u) => `<div class="mstat"><div class="caption">${l}</div><div class="num">${v == null ? '–' : n0(v)}<span class="unit">${u}</span></div></div>`;
  let h = f.photo ? `<div class="mphoto" data-lightbox="${i}"><img src="/m/${esc(f.photo)}.jpg" alt="${esc(f.note || 'Meal photo')}" decoding="async"></div>` : '';
  h += `<p class="sub" style="margin:0 0 12px">${fLong(f.date)}${f.time ? ' · ' + fTime(f.time) : ''}</p>`;
  h += card('', `<div class="mstats">${m('Calories', f.cal, 'kcal')}${m('Protein', f.protein, 'g')}${m('Fat', f.fat, 'g')}${m('Carbs', f.carbs, 'g')}${m('Sugar', f.sugar, 'g')}</div><p class="caption" style="margin-top:10px">Estimated from the photo and description.</p>`);
  if (f.score != null || f.tip) h += card('Macro Score', `${f.score != null ? `<div class="row"><span class="mscore lg ${scoreCls(f.score)}">${f.score}<small>/10</small></span></div>` : ''}${f.tip ? `<div class="li mtip"><div class="ico">${ic('lightbulb')}</div><div class="body"><div class="t">Swap tip</div><div class="s">${esc(f.tip)}</div></div></div>` : ''}`);
  openSheet(f.note || 'Meal', h, 'meal', trigger);
}
/* Meal photo lightbox: shared-element zoom from the thumbnail, glass close + caption, swipe-down / backdrop / Esc to dismiss,
   pinch + double-tap zoom. Transform/opacity only (compositor, 60fps); spring-like easing; honors prefers-reduced-motion. */
const LB = {};
const LB_EASE = 'cubic-bezier(.32,.72,0,1)', LB_SPRING = 'cubic-bezier(.34,1.32,.64,1)';
function openLightbox(i, from) {
  const f = D.food[+i]; if (!f || !f.photo || LB.el) return;
  const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div'); el.className = 'lb'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', f.note || 'Meal photo');
  const sc = f.score != null ? `<span class="mscore ${scoreCls(f.score)}">${f.score}/10</span>` : '';
  el.innerHTML = `<div class="lb-bg"></div><img class="lb-img" alt="${esc(f.note || 'Meal photo')}" src="/m/${esc(f.photo)}.jpg" draggable="false">
<button class="lb-x glass" aria-label="Close">${ic('x')}</button>
<div class="lb-cap glass"><div class="t">${sc}${esc(f.note || 'Meal')}</div><div class="s">${n0(f.cal)} kcal · ${mealMacros(f)}</div></div>`;
  document.body.appendChild(el);
  const img = el.querySelector('.lb-img'), bg = el.querySelector('.lb-bg'), chrome = [el.querySelector('.lb-x'), el.querySelector('.lb-cap')];
  const thumb = from && from.querySelector ? (from.matches('img') ? from : from.querySelector('img')) : null;
  Object.assign(LB, {el, img, bg, chrome, thumb, rm, s:1, x:0, y:0, ret:document.activeElement, wasLocked:document.documentElement.classList.contains('locked')});
  lockPage(true);
  const fit = () => {   // fitted full-screen rect inside the safe area
    const vw = innerWidth, vh = innerHeight, r = (img.naturalWidth || 4) / (img.naturalHeight || 3);
    let w = vw, h = vw / r; if (h > vh * .86) { h = vh * .86; w = h * r; }
    return {w, h, l:(vw - w) / 2, t:(vh - h) / 2};
  };
  const place = () => { const b = fit(); LB.box = b; Object.assign(img.style, {width:b.w + 'px', height:b.h + 'px', left:b.l + 'px', top:b.t + 'px'}); };
  const fromT = () => { if (!thumb) return 'translate3d(0,24px,0) scale(.92)'; const r = thumb.getBoundingClientRect(), b = LB.box;
    return `translate3d(${r.left + r.width / 2 - (b.l + b.w / 2)}px,${r.top + r.height / 2 - (b.t + b.h / 2)}px,0) scale(${Math.max(r.width / b.w, r.height / b.h)})`; };
  LB.fromT = fromT;
  const go = () => {
    place();
    if (thumb) { const r = thumb.getBoundingClientRect(), b = LB.box, s = Math.max(r.width / b.w, r.height / b.h);   // crop like object-fit:cover
      img.style.clipPath = `inset(${(b.h - r.height / s) / 2}px ${(b.w - r.width / s) / 2}px round ${10 / s}px)`; }
    img.style.transform = rm ? 'none' : fromT(); img.style.opacity = rm || thumb ? '1' : '0';
    if (thumb) thumb.style.visibility = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const d = rm ? 180 : 460;
      img.style.transition = rm ? `opacity ${d}ms` : `transform ${d}ms ${LB_EASE}, clip-path ${d}ms ${LB_EASE}, opacity ${d}ms`;
      img.style.transform = 'translate3d(0,0,0) scale(1)'; img.style.clipPath = 'inset(0 round 0px)'; img.style.opacity = '1';
      el.classList.add('show');
    }));
    setTimeout(() => el.querySelector('.lb-x').focus({preventScroll:true}), 60);
  };
  img.complete && img.naturalWidth ? go() : (img.onload = go, img.onerror = go);
  LB.onResize = () => { place(); lbApply(false); }; addEventListener('resize', LB.onResize);
  LB.onKey = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); closeLightbox(); } };
  document.addEventListener('keydown', LB.onKey, true);
  el.querySelector('.lb-x').addEventListener('click', e => { e.stopPropagation(); closeLightbox(); });
  wireLightbox();
}
function lbApply(anim, ease = LB_SPRING) {
  const {img, bg, chrome} = LB; const drag = LB.s === 1 ? Math.max(0, LB.y) : 0, k = Math.min(1, drag / 360);
  img.style.transition = anim && !LB.rm ? `transform 380ms ${ease}` : 'none';
  bg.style.transition = chrome[0].style.transition = chrome[1].style.transition = anim ? 'opacity 300ms' : 'none';
  img.style.transform = `translate3d(${LB.x}px,${LB.y}px,0) scale(${LB.s * (1 - k * .25)})`;
  bg.style.opacity = String(1 - k); for (const c of chrome) c.style.opacity = LB.s > 1 || drag > 8 ? '0' : '';
}
function clampPan() { const b = LB.box, mx = Math.max(0, (b.w * LB.s - innerWidth) / 2), my = Math.max(0, (b.h * LB.s - innerHeight) / 2);
  LB.x = Math.max(-mx, Math.min(mx, LB.x)); LB.y = Math.max(-my, Math.min(my, LB.y)); }
function zoomAt(s, cx, cy) { const b = LB.box, ox = cx - (b.l + b.w / 2), oy = cy - (b.t + b.h / 2), k = s / LB.s;
  LB.x = ox - (ox - LB.x) * k; LB.y = oy - (oy - LB.y) * k; LB.s = s; if (s === 1) LB.x = LB.y = 0; clampPan(); }
function wireLightbox() {
  const {el, img} = LB; const pts = new Map(); let g = null, lastTap = 0, moved = false;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid = () => { const [a, b] = [...pts.values()]; return {x:(a.x + b.x) / 2, y:(a.y + b.y) / 2}; };
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.lb-x,.lb-cap')) return;
    el.setPointerCapture(e.pointerId); pts.set(e.pointerId, {x:e.clientX, y:e.clientY}); moved = false;
    if (pts.size === 2) g = {type:'pinch', d0:dist(), s0:LB.s, m0:mid(), x0:LB.x, y0:LB.y};
    else g = {type:'pan', sx:e.clientX, sy:e.clientY, x0:LB.x, y0:LB.y, t:performance.now(), py:e.clientY, pt:performance.now(), v:0};
  });
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !g) return; pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if (g.type === 'pinch' && pts.size === 2) { const m = mid(), s = Math.max(.8, Math.min(5, g.s0 * dist() / g.d0));
      LB.x = g.x0; LB.y = g.y0; LB.s = g.s0; zoomAt(s, g.m0.x, g.m0.y); LB.x += m.x - g.m0.x; LB.y += m.y - g.m0.y; moved = true; lbApply(false); return; }
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy; if (Math.hypot(dx, dy) > 6) moved = true;
    const now = performance.now(); g.v = (e.clientY - g.py) / Math.max(1, now - g.pt); g.py = e.clientY; g.pt = now;
    if (LB.s > 1) { LB.x = g.x0 + dx; LB.y = g.y0 + dy; clampPan(); }
    else { LB.x = dx * .35; LB.y = dy > 0 ? dy : dy * .25; }   // swipe down to dismiss; resist other directions
    lbApply(false);
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
    if (g && g.type === 'pinch') { if (pts.size) { const p = [...pts.values()][0]; g = {type:'pan', sx:p.x, sy:p.y, x0:LB.x, y0:LB.y, py:p.y, pt:performance.now(), v:0}; return; }
      if (LB.s < 1.05) zoomAt(1, 0, 0); g = null; lbApply(true); return; }
    if (pts.size) return; const was = g; g = null; if (!was) return;
    if (!moved) {   // tap: double-tap zooms, single tap on the backdrop closes
      const now = performance.now();
      if (now - lastTap < 280) { clearTimeout(LB.tapT); lastTap = 0; zoomAt(LB.s > 1 ? 1 : 2.5, e.clientX, e.clientY); lbApply(true); return; }
      lastTap = now; const onImg = e.target === img;
      LB.tapT = setTimeout(() => { if (!onImg && LB.s === 1) closeLightbox(); }, 280); return;
    }
    if (LB.s === 1 && (LB.y > 120 || (was.v > .6 && LB.y > 20))) { closeLightbox(); return; }
    if (LB.s === 1) { LB.x = LB.y = 0; } lbApply(true);
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.max(1, Math.min(5, LB.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), e.clientX, e.clientY); lbApply(false); }, {passive:false});
}
function closeLightbox() {
  const {el, img, thumb, rm} = LB; if (!el || LB.closing) return; LB.closing = true;
  removeEventListener('resize', LB.onResize); document.removeEventListener('keydown', LB.onKey, true);
  const d = rm ? 160 : 400; el.classList.remove('show'); el.classList.add('hide');
  const vis = thumb && thumb.isConnected && (r => r.bottom > 0 && r.top < innerHeight)(thumb.getBoundingClientRect());
  img.style.transition = rm ? `opacity ${d}ms` : `transform ${d}ms ${LB_EASE}, clip-path ${d}ms ${LB_EASE}, opacity ${d}ms`;
  if (rm) img.style.opacity = '0';
  else if (vis) { const r = thumb.getBoundingClientRect(), b = LB.box, s = Math.max(r.width / b.w, r.height / b.h);
    img.style.transform = LB.fromT(); img.style.clipPath = `inset(${(b.h - r.height / s) / 2}px ${(b.w - r.width / s) / 2}px round ${10 / s}px)`; }
  else { img.style.transform = `translate3d(0,${Math.max(LB.y, 0) + 80}px,0) scale(.9)`; img.style.opacity = '0'; }
  LB.bg.style.transition = 'opacity ' + d + 'ms'; LB.bg.style.opacity = '0';
  setTimeout(() => {
    if (thumb) thumb.style.visibility = ''; el.remove();
    if (!LB.wasLocked) lockPage(false);
    const r = LB.ret; for (const k of Object.keys(LB)) delete LB[k]; if (r && r.focus) r.focus({preventScroll:true});
  }, d + 20);
}
const header = (t, sub) => `<h1 class="lt">${t}</h1><p class="lt-sub">${sub}</p>`;

/* ---------- charts (inline SVG, tap-to-inspect) ---------- */
function chart(cfg) {
  const id = 'c' + (++chartSeq); CH[id] = cfg;
  const Wd = 343, H = cfg.h || 140, L = 2, R = 34, T = 10, B = 20;
  const start = cfg.start, n = diffDays(start, cfg.end) + 1;
  const slot = (Wd - L - R) / n;
  const pts = cfg.pts.filter(p => p.v != null && p.d >= start && p.d <= cfg.end);
  const vals = pts.map(p => p.v).concat(cfg.goal != null ? [cfg.goal] : [], cfg.band ? [cfg.band.lo, cfg.band.hi] : []).concat(pts.filter(p => p.v2 != null).map(p => p.v2));
  let lo = cfg.min != null ? cfg.min : Math.min(...vals), hi = cfg.max != null ? cfg.max : Math.max(...vals);
  if (!vals.length) { lo = 0; hi = 1; }
  if (cfg.min == null || cfg.max == null) { const pad = (hi - lo) * 0.08 || Math.max(1, Math.abs(hi) * 0.05); if (cfg.min == null) lo -= pad; if (cfg.max == null) hi += pad; }
  if (cfg.type === 'bar' && cfg.min == null) lo = 0;
  const raw = (hi - lo) / 3, mag = Math.pow(10, Math.floor(Math.log10(raw || 1))), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  if (cfg.min == null) lo = Math.floor(lo / step + 1e-9) * step;
  if (cfg.max == null) hi = Math.ceil(hi / step - 1e-9) * step;
  if (cfg.min != null && cfg.max != null && cfg.ticks) { /* fixed */ }
  const X = d => L + (diffDays(start, d) + 0.5) * slot;
  const Y = v => T + (hi - v) / (hi - lo || 1) * (H - T - B);
  cfg._ = {X, Y, Wd, H, T, B, L, R, pts};
  let g = '';
  const tstep = cfg.min != null && cfg.max != null && cfg.max - cfg.min === 100 ? 25 : step;
  for (let v = Math.ceil(lo / tstep - 1e-9) * tstep; v <= hi + 1e-9; v += tstep) {
    const y = Y(v);
    g += `<line class="gl" x1="${L}" x2="${Wd - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="ax" x="${Wd - R + 6}" y="${(y + 3.5).toFixed(1)}">${cfg.yfmt ? cfg.yfmt(v) : (tstep < 1 ? v.toFixed(1) : (Math.round(v) + 0).toLocaleString('en-US'))}</text>`;
  }
  const ticks = n <= 7 ? [...Array(n).keys()] : [0, Math.floor((n - 1) / 3), Math.floor(2 * (n - 1) / 3), n - 1];
  for (const i of ticks) {
    const d = add(start, i), x = L + (i + 0.5) * slot;
    g += `<text class="ax" x="${x.toFixed(1)}" y="${H - 4}" text-anchor="${n <= 7 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${n <= 7 ? fd(d, {weekday:'narrow'}) : fShort(d)}</text>`;
  }
  let body = '';
  if (cfg.band) { const y1 = Y(Math.min(hi, cfg.band.hi)), y2 = Y(Math.max(lo, cfg.band.lo)); body += `<rect x="${L}" y="${y1.toFixed(1)}" width="${Wd - R - L}" height="${Math.max(0, y2 - y1).toFixed(1)}" style="fill:rgba(var(--ink),.07)"/><line class="gl" x1="${L}" x2="${Wd - R}" y1="${Y(cfg.band.m).toFixed(1)}" y2="${Y(cfg.band.m).toFixed(1)}" stroke-dasharray="3 3"/>`; }
  if (cfg.goal != null) body += `<line class="goal" x1="${L}" x2="${Wd - R}" y1="${Y(cfg.goal).toFixed(1)}" y2="${Y(cfg.goal).toFixed(1)}" stroke="${cfg.goalColor || C.orange}"/>`;
  if (cfg.type === 'bar') {
    const bw = Math.max(2, Math.min(18, slot * 0.62));
    for (const p of pts) {
      const y = Y(p.v), y0 = Y(Math.max(lo, 0));
      body += `<rect x="${(X(p.d) - bw / 2).toFixed(1)}" y="${Math.min(y, y0).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, Math.abs(y0 - y)).toFixed(1)}" rx="${Math.min(3, bw / 2).toFixed(1)}" fill="${p.c || cfg.color}" opacity="${p.d === TODAY ? 1 : 0.85}"/>`;
    }
    const p2 = pts.filter(p => p.v2 != null);
    if (p2.length > 1) body += `<path class="ln" stroke="${cfg.color2 || C.gray}" stroke-dasharray="3 3" d="M${p2.map(p => `${X(p.d).toFixed(1)},${Y(p.v2).toFixed(1)}`).join(' L')}"/>`;
  } else if (pts.length) {
    /* break the line across gaps (e.g. no WHOOP data in August) instead of drawing a straight line through them */
    const gap = cfg.gap || 10, segs = [[pts[0]]];
    for (let i = 1; i < pts.length; i++) { if (diffDays(pts[i - 1].d, pts[i].d) > gap) segs.push([]); segs[segs.length - 1].push(pts[i]); }
    const gid = 'g' + id;
    body += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${cfg.color}" stop-opacity=".28"/><stop offset="1" stop-color="${cfg.color}" stop-opacity="0"/></linearGradient></defs>`;
    for (const sg of segs.filter(sg => sg.length > 1)) {
      const path = 'M' + sg.map(p => `${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' L');
      body += `<path d="${path} L${X(sg[sg.length - 1].d).toFixed(1)},${H - B} L${X(sg[0].d).toFixed(1)},${H - B}Z" fill="url(#${gid})"/><path class="ln" stroke="${cfg.color}" d="${path}"/>`;
    }
    const last = pts[pts.length - 1];
    body += pts.length <= 31 ? pts.map(p => `<circle cx="${X(p.d).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${p === last ? 4 : 2.5}" fill="${p.c || cfg.color}"/>`).join('') : `<circle cx="${X(last.d).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="4" fill="${cfg.color}"/>`;
  }
  const empty = !pts.length ? `<text class="ax" x="${(Wd - R) / 2}" y="${H / 2}" text-anchor="middle" style="font-size:13px">No data in this range</text>` : '';
  return `<div class="chart" data-id="${id}"><svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${esc(cfg.label || 'chart')}">${g}${body}${empty}<line class="cur" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="curdot" r="5" style="fill:var(--txt);stroke:var(--bg)" stroke-width="2" visibility="hidden"/></svg></div>`;
}
function bindCharts(root) {
  const tip = $('#tip');
  root.querySelectorAll('.chart').forEach(el => {
    const cfg = CH[el.dataset.id]; if (!cfg || !cfg._.pts.length) return;
    const svg = el.querySelector('svg'), cur = el.querySelector('.cur'), dot = el.querySelector('.curdot');
    let hideT;
    let down = null;
    const near = e => { const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * cfg._.Wd; let best = null, bd = 1e9;
      for (const p of cfg._.pts) { const dd = Math.abs(cfg._.X(p.d) - sx); if (dd < bd) { bd = dd; best = p; } } return best; };
    const show = e => {
      const r = svg.getBoundingClientRect(), best = near(e);
      if (!best) return;
      const x = cfg._.X(best.d), y = cfg._.Y(best.v);
      cur.setAttribute('x1', x); cur.setAttribute('x2', x); cur.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
      tip.innerHTML = `<span class="muted">${fMed(best.d)}</span><b>${cfg.tfmt ? cfg.tfmt(best) : n1(best.v)}</b>${cfg.textra ? `<span class="muted">${cfg.textra(best)}</span>` : ''}`;
      tip.hidden = false;
      const px = r.left + x / cfg._.Wd * r.width, py = r.top + y / cfg._.H * r.height - 12;
      const tw = tip.offsetWidth; tip.style.left = Math.max(tw / 2 + 8, Math.min(innerWidth - tw / 2 - 8, px)) + 'px'; tip.style.top = Math.max(60, py) + 'px';
      clearTimeout(hideT);
    };
    const hide = () => { hideT = setTimeout(() => { tip.hidden = true; cur.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); }, 1400); };
    el.addEventListener('pointerdown', e => { down = {x:e.clientX, y:e.clientY, t:performance.now()}; show(e); el.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) show(e); });
    /* a quick tap (no drag) opens that day's page; dragging inspects */
    el.addEventListener('pointerup', e => { const dn = down; down = null; hide();
      if (cfg.page && dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) < 8 && performance.now() - dn.t < 350) { const b = near(e); if (b) { tip.hidden = true; pushPage(cfg.page(b.d)); } } }); el.addEventListener('pointerleave', hide); el.addEventListener('pointercancel', hide);
  });
}
function animateRings(root) {
  if (RM) return;
  requestAnimationFrame(() => requestAnimationFrame(() => root.querySelectorAll('.ring .val, .bigring .val').forEach(c => c.setAttribute('stroke-dashoffset', c.dataset.off))));
}

/* ---------- TODAY ---------- */
let dayView = null;   // date shown on Today (null = today); stepped with the < TODAY > pill
const viewDay = () => dayView && dayView < TODAY ? dayView : TODAY;
const firstDay = () => [D.wear.first_day, D.food[0]?.date, WEIGHTS[0]?.date].filter(Boolean).sort()[0] || TODAY;
const dayLabel = d => d === TODAY ? 'Today' : d === add(TODAY, -1) ? 'Yesterday' : fMed(d);
/* small fixed ring for the collapsed header */
const miniRing = (pct, color) => { const r = 9, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct || 0));
  return `<svg class="mring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="${r}" fill="none" style="stroke:rgba(var(--ink),.14)" stroke-width="3"/>${p ? `<circle cx="12" cy="12" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}" transform="rotate(-90 12 12)"/>` : ''}</svg>`; };
function dials(d) {
  const r = rec(d), s = slp(d), cy = cyc(d);
  return [['Sleep', (s.performance || 0) / 100, C.sleep, s.performance != null ? s.performance + '<span class="pc">%</span>' : '–', s.performance != null ? s.performance + '%' : 'no data', 'sleep'],
    [LBL.Rec + (r.estimate ? '*' : ''), (r.score || 0) / 100, recColor(r.score), r.score != null ? r.score + '<span class="pc">%</span>' : '–', r.score != null ? r.score + '%' : 'no data', 'recovery'],
    HAS_STRAIN ? ['Strain', (cy.strain || 0) / 21, C.strain, n1(cy.strain), cy.strain != null ? n1(cy.strain) : 'no data', 'strain']
      : WK === 'oura' ? ['Activity', (cy.activity_score || 0) / 100, C.strain, cy.activity_score != null ? String(cy.activity_score) : '–', cy.activity_score != null ? cy.activity_score + ' of 100' : 'no data', 'day']
      : ['Steps', Math.min(1, (cy.steps || 0) / ((D.targets || {}).steps || 10000)), C.strain, cy.steps != null ? (cy.steps >= 1000 ? (cy.steps / 1000).toFixed(1) + 'k' : String(cy.steps)) : '–', cy.steps != null ? cy.steps + ' steps' : 'no data', 'day']];
}
function checkinCard(d) {
  const j = D.journal[d] || {}, v = (x, f) => x == null ? '–' : f ? f(x) : x;
  return card('Morning check-in', `<div class="checkin"><div><b class="num">${v(j.sleep_hours, x => hm(x))}</b><small>Sleep</small></div><div><b class="num">${v(j.energy, x => x + '/5')}</b><small>Energy</small></div><div><b class="num">${v(j.soreness, x => x + '/5')}</b><small>Soreness</small></div></div>
    ${j.sleep_hours == null && j.energy == null ? `<div class="caption" style="margin-top:12px">No check-in yet. Log one: <code>log.py checkin --sleep 7.5 --energy 4 --soreness 2</code></div>` : ''}`, {meta:fShort(d)});
}
function appearanceCard() {
  return card('Appearance', `<div class="themes" role="radiogroup" aria-label="Theme">${THEMES.map(([k, l]) => `<button role="radio" aria-checked="${THEME === k}" class="${THEME === k ? 'on' : ''}" data-theme-set="${k}"><span class="sw t-${k}"></span>${l}</button>`).join('')}</div>`);
}
function vToday() {
  const d = viewDay(), isT = d === TODAY, s = slp(d), syncT = D.wear.synced_at ? fTime(D.wear.synced_at) : null;
  let h = '';
  if (ctToday() !== TODAY) h += `<div class="card" style="color:var(--yellow)">Showing data from ${fMed(TODAY)}. Run publish.sh to refresh.</div>`;
  h += `<div class="dayrow"><span class="pill streakpill" title="Training streak">${ic('fire')}<b>${streak()}</b></span>
    <div class="datepill" role="group" aria-label="Day"><button data-step="-1" aria-label="Previous day"${d <= firstDay() ? ' disabled' : ''}>${ic('caret-left')}</button><b aria-live="polite">${dayLabel(d).toUpperCase()}</b><button data-step="1" aria-label="Next day"${isT ? ' disabled' : ''}>${ic('caret-right')}</button></div>
    <span class="dayrow-r caption">${syncT ? 'synced ' + syncT : ''}</span></div>`;
  h += `<h1 class="sr">Today, ${fLong(d)}</h1>`;
  if (WK === 'none') h += checkinCard(d); else h += `<div class="hero" id="hero"><div class="rings3">${dials(d).map(([l, p, c, ctr, aria, rt]) =>
    `<div class="dial" data-page="${rt}/${d}"${BTN} aria-label="${l} ${aria}, open details">${ring(p, c, ctr, '', 112)}<div class="ring-lbl">${l}${ic('caret-right', 0, 'lchev')}</div></div>`).join('')}</div>
    <div class="hero-sub">${s.hours_asleep != null ? `${hm(s.hours_asleep)} asleep${s.need_hours ? ' of ' + hm(s.need_hours) + ' needed' : ''}` : 'No WHOOP sleep for this day'}${rec(d).estimate ? '<br><span class="caption">*Readiness is an estimate computed from your HRV and resting HR, not a Fitbit score.</span>' : ''}</div></div>`;
  const mon = monitor(d), st = stressDay(d);
  if (WK !== 'none') h += `<div class="duo"><div class="card mini tap" data-go="health"${BTN}><div class="ch"><h2>Health monitor</h2><div class="meta">${chev}</div></div>
      ${mon.n ? `<div class="mrow"><span class="mbadge" style="background:${mon.ok === mon.n ? 'rgba(22,236,6,.16)' : 'rgba(255,222,0,.14)'};color:${mon.ok === mon.n ? C.green : C.yellow}">${ic(mon.ok === mon.n ? 'check-circle' : 'info')}</span><div><div class="mlab" style="color:${mon.ok === mon.n ? C.green : C.yellow}">${mon.ok === mon.n ? 'Within range' : 'Outside range'}</div><div class="caption">${mon.ok}/${mon.n} metrics</div></div></div>` : '<div class="caption">Needs 7+ days of data</div>'}</div>
    <div class="card mini tap" data-go="stress"${BTN}><div class="ch"><h2>Stress</h2><div class="meta">${chev}</div></div>
      ${st ? `<div class="mrow"><span class="mbadge num" style="background:rgba(0,163,255,.14);color:${st.color}">${st.score.toFixed(1)}</span><div><div class="mlab" style="color:${st.color}">${st.level}</div><div class="caption">daily score</div></div></div>` : '<div class="caption">Needs 7+ days of data</div>'}</div></div>`;
  if (isT && WK === 'whoop') h += bedCoach("Tonight's sleep");
  if (HAS_STRAIN) h += card('Strain & recovery', srChart(d), {meta:'7 days'});
  // plan
  const dtp = dayType(d), lifts = LIFTS[d] || [], ww = wd(d).workouts || [];
  let plan = `<div class="row" style="margin-bottom:${lifts.length || ww.length ? 12 : 0}px"><div><div class="huge" style="color:${TYPE_C[dtp] || C.acc}">${dtp}</div><div class="sub">${isT ? 'Tomorrow: ' + dayType(add(d, 1)) : fLong(d)}</div></div>
    <span class="pill" style="color:${trained(d) ? C.green : 'var(--txt2)'}"><i></i>${trained(d) ? 'Done' : dtp === 'REST' ? 'Rest day' : isT ? 'Planned' : 'Missed'}</span></div>`;
  lifts.forEach((l, i) => { plan += `<div class="hr"></div><div class="row tap srow" data-page="session/${d}/${i}"${BTN}><span class="sub">Logged ${esc(l.type)} · ${exSummary(l)}</span>${chev}</div>${exGrid(l.exercises, l)}<div class="sharerow">${shareBtn(d, i)}</div>`; });
  if (ww.length) plan += `<div class="hr"></div><div class="acts">${ww.map((w, i) => actRow(d, w, i)).join('')}</div>`;
  h += card(isT ? "Today's plan" : 'Training', plan);
  // weight
  const goal = D.profile.goal_weight, start = D.profile.start_weight, wl = WEIGHTS.filter(w => w.date <= d).pop();
  if (wl) {
    const togo = wl.value - goal, pr = start && goal ? Math.max(0, Math.min(1, (start - wl.value) / (start - goal))) : 0;
    h += card('Weight', `<div class="row" style="align-items:flex-end"><div><span class="huge">${n1(wl.value).replace(/\.0$/, '')}</span><span class="unit">${U}</span><div class="sub">${relDay(wl.date)}</div></div>
      <div style="text-align:right"><div class="big">${n1(Math.max(togo, 0)).replace(/\.0$/, '')}<span class="unit">${U} to go</span></div><div class="sub">Goal ${goal} ${U}</div></div></div>
      ${start && start !== wl.value ? `<div class="metric" style="margin-top:16px"><div class="row"><span class="sub">From ${start} ${U}</span><span class="sub">${Math.round(pr * 100)}% of the way</span></div>${bar(pr, C.acc)}</div>` : '<div class="caption" style="margin-top:12px">Starting weight. Progress shows from the next weigh-in.</div>'}`, {tap:'trends'});
  } else h += card('Weight', '<div class="empty">First weigh-in Sunday</div>');
  const ft = foodTot(d), t = D.targets;
  h += card('Nutrition', metric('Calories', ft.cal, t.calories, 'kcal', C.acc) + metric('Protein', ft.protein, t.protein_g, 'g', C.blue) +
    metric('Sugar', ft.sugar, t.sugar_g, 'g', C.pink), {tap:'nutrition', meta:`${ft.n} meal${ft.n === 1 ? '' : 's'}`});
  const taken = supps(d), on = x => taken.includes(x.id) || (x.id === 'sauna' && saunaDay(d));
  h += card('Habits & supplements', `<div class="list">${D.supplements.map(x => li(chk(on(x)), esc(x.name), esc(x.detail || ''), null, '', true)).join('')}</div>`,
    {meta:`${D.supplements.filter(on).length}/${D.supplements.length}`});
  const g = GTG[d] || [], pm = D.pullup_max.filter(x => x.date <= d).pop();
  if (PU()) h += card('Pull-ups', `<div class="grid3">${tile('Strict max', pm ? pm.reps : '–')}${tile('GtG reps', g.reduce((a, x) => a + x.reps, 0))}${tile('Negatives', g.reduce((a, x) => a + (x.negatives || 0), 0))}</div>
    ${D.pullup_context ? `<div class="caption" style="margin-top:12px">${esc(D.pullup_context)}</div>` : ''}`, {tap:'training'});
  h += card('Journal', journalSummary(d), {attr:' data-journal="' + d + '"'});
  return h;
}
/* compact pinned header (Sleep / Recovery / Strain) shown once the big dials scroll away */
function miniBar(d) {
  return `<div class="mbar-in">${dials(d).map(([l, p, c, , aria]) => `<button class="mi" data-page="${l.toLowerCase()}/${d}" aria-label="${l} ${aria}, open details">${miniRing(p, c)}<span>${l}</span></button>`).join('')}</div>`;
}
let heroIO = null;
function watchHero() {
  if (heroIO) { heroIO.disconnect(); heroIO = null; }
  const mb = $('#mbar'), hero = $('#hero');
  if (tab !== 'today' || !hero) { document.body.classList.remove('collapsed'); mb.hidden = true; return; }
  mb.innerHTML = miniBar(viewDay()); mb.hidden = false; brandDom(mb);
  const topH = $('#topbar').getBoundingClientRect().bottom;
  mb.style.top = topH + 'px';   // pin flush under the top bar (its height includes the safe-area inset)
  heroIO = new IntersectionObserver(([e]) => document.body.classList.toggle('collapsed', e.intersectionRatio < 0.3 && e.boundingClientRect.top < topH + 10),
    {root:$('#view'), rootMargin:`-${Math.round(topH)}px 0px 0px 0px`, threshold:[0, 0.3, 0.6, 1]});
  heroIO.observe(hero);
}
addEventListener('resize', () => { if (heroIO) watchHero(); });
/* 7-day dual-axis chart: strain (blue, 0-21, left) and recovery (zone-colored points on a gray line, 0-100%, right) */
function srChart(end, pg = x => 'day/' + x) {
  const Wd = 343, H = 210, L = 26, R = 34, T = 22, B = 34, n = 7, start = add(end, -6), slot = (Wd - L - R) / n;
  const X = i => L + (i + 0.5) * slot, Ys = v => T + (21 - v) / 21 * (H - T - B), Yr = v => T + (100 - v) / 100 * (H - T - B);
  let g = '', lab = '';
  for (const v of [0, 7, 14, 21]) g += `<line class="gl" x1="${L}" x2="${Wd - R}" y1="${Ys(v).toFixed(1)}" y2="${Ys(v).toFixed(1)}"/><text class="ax" x="${L - 6}" y="${(Ys(v) + 3.5).toFixed(1)}" text-anchor="end" fill="${C.strain2 || '#00a3ff'}" style="fill:#4fa8e8">${v}</text>`;
  for (const [v, c] of [[0, '#ff5a68'], [33, '#ff5a68'], [66, C.yellow], [100, C.green]]) g += `<text class="ax" x="${Wd - R + 6}" y="${(Yr(v) + 3.5).toFixed(1)}" style="fill:${c}">${v}%</text>`;
  const days = [...Array(n).keys()].map(i => add(start, i));
  const hi = days.indexOf(TODAY) >= 0 ? days.indexOf(TODAY) : (end === viewDay() ? n - 1 : -1);
  if (hi >= 0) g += `<rect x="${(X(hi) - slot / 2 + 2).toFixed(1)}" y="${T - 14}" width="${(slot - 4).toFixed(1)}" height="${H - T - B + 44}" rx="6" style="fill:rgba(var(--ink),.07)"/>`;
  days.forEach((d, i) => { g += `<text class="ax" x="${X(i).toFixed(1)}" y="${H - 18}" text-anchor="middle"${i === hi ? ' style="fill:var(--txt);font-weight:700"' : ''}>${fd(d, {weekday:'short'})}</text><text class="ax" x="${X(i).toFixed(1)}" y="${H - 5}" text-anchor="middle"${i === hi ? ' style="fill:var(--txt);font-weight:700"' : ''}>${+d.slice(8)}</text>`; });
  const sp = days.map((d, i) => [i, cyc(d).strain]).filter(p => p[1] != null), rp = days.map((d, i) => [i, rec(d).score]).filter(p => p[1] != null);
  const line = (pts, Y, c) => pts.length > 1 ? `<path class="ln" stroke="${c}" stroke-width="2" d="M${pts.map(([i, v]) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' L')}"/>` : '';
  g += line(rp, Yr, ink(.35)) + line(sp, Ys, C.strain);
  for (const d of days) { const i = days.indexOf(d), sv = cyc(d).strain, rv = rec(d).score;
    const ys = sv != null ? Ys(sv) : null, yr = rv != null ? Yr(rv) : null, sAbove = ys != null && (yr == null || ys <= yr);
    if (rv != null) { g += `<circle cx="${X(i).toFixed(1)}" cy="${yr.toFixed(1)}" r="5" fill="#1a1d21" stroke="${recColor(rv)}" stroke-width="2.5"/>`;
      lab += `<text class="vl" x="${X(i).toFixed(1)}" y="${(sAbove ? yr + 17 : yr - 9).toFixed(1)}" text-anchor="middle" style="fill:${recColor(rv)}">${rv}%</text>`; }
    if (sv != null) { g += `<circle cx="${X(i).toFixed(1)}" cy="${ys.toFixed(1)}" r="5" fill="#1a1d21" stroke="${C.strain}" stroke-width="2.5"/>`;
      lab += `<text class="vl" x="${X(i).toFixed(1)}" y="${(sAbove ? ys - 9 : ys + 17).toFixed(1)}" text-anchor="middle" style="fill:#4fa8e8">${n1(sv)}</text>`; } }
  const hit = days.map((d, i) => W[d] ? `<rect class="hit" x="${(X(i) - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" data-page="${pg(d)}" role="button" tabindex="0" aria-label="${esc(fMed(d))}: strain ${n1(cyc(d).strain)}, recovery ${rec(d).score ?? '–'}%"/>` : '').join('');
  return `<div class="srchart"><svg viewBox="0 0 ${Wd} ${H}" role="group" aria-label="Strain and recovery, last 7 days">${g}${lab}${hit}</svg>
    <div class="legend"><span><i style="background:${C.strain}"></i>Strain (0–21, left)</span><span><i style="background:rgba(var(--ink),.35)"></i>Recovery % (right, zone-colored)</span></div></div>`;
}
/* ---------- HEALTH ---------- */
const MON = [['hrv', 'HRV', 'ms', d => rec(d).hrv, 0, 3], ['rhr', 'Resting HR', 'bpm', d => rec(d).rhr, 0, 2], ['resp', 'Respiratory rate', 'rpm', d => slp(d).respiratory_rate, 1, 0.4],
  ['spo2', 'Blood oxygen', '%', d => rec(d).spo2, 1, 1], ['skin', 'Skin temp', '°F', d => rec(d).skin_temp_c != null ? rec(d).skin_temp_c * 9 / 5 + 32 : null, 1, 0.9]];
/* personal normal band: mean ± max(1.5 SD, a small floor) of the 30 days before d (needs 7+ days) */
function band(fn, d, floor) {
  const v = [...Array(30).keys()].map(i => fn(add(d, -(i + 1)))).filter(x => x != null);
  if (v.length < 7) return null;
  const m = avg(v), w = Math.max(1.5 * sdev(v), floor);
  return {m, lo:m - w, hi:m + w, n:v.length};
}
function monitor(d) {
  const rows = MON.map(([k, l, u, fn, dec, fl]) => { const v = fn(d), b = band(fn, d, fl); return {k, l, u, fn, dec, fl, v, b, ok:v != null && b && v >= b.lo && v <= b.hi}; });
  const scored = rows.filter(r => r.v != null && r.b);
  return {rows, n:scored.length, ok:scored.filter(r => r.ok).length};
}
/* Daily stress 0–3: overnight HRV below and RHR above your 30-day baseline (z-scores), blended 70/30 with journal stress (1–5). */
function stressDay(d) {
  const hb = band(x => rec(x).hrv, d, 0), rb = band(x => rec(x).rhr, d, 0), r = rec(d);
  if (!hb || !rb || r.hrv == null || r.rhr == null) return null;
  const sd = b => Math.max((b.hi - b.m) / 1.5, 0.5), zh = (hb.m - r.hrv) / sd(hb), zr = (r.rhr - rb.m) / sd(rb);
  const phys = Math.max(0, Math.min(3, 1 + 0.5 * (zh + zr))), j = (D.journal[d] || {}).stress;
  const score = j != null ? 0.7 * phys + 0.3 * (j - 1) * 0.75 : phys;
  const level = score < 1 ? 'Low' : score < 2 ? 'Medium' : 'High';
  return {score, level, color:score < 1 ? '#4fa8e8' : score < 2 ? C.yellow : '#ff5a68', zh, zr, phys, j};
}
function vHealth() {
  const d = TODAY, mon = monitor(d), st = stressDay(d), p = D.profile, wp = D.wear.profile || {};
  let h = header('Health', `${fLong(d)} · age ${p.age ?? '–'}`);
  h += coachAgeCard();
  h += `<h2 class="sec" id="monitor">Health monitor <small>vs your 30-day normal range</small></h2>`;
  h += card('', `<div class="mrow" style="margin-bottom:12px"><span class="mbadge" style="background:rgba(22,236,6,.16);color:${mon.ok === mon.n ? C.green : C.yellow}">${ic(mon.ok === mon.n ? 'check-circle' : 'info')}</span><div><div class="mlab" style="color:${mon.ok === mon.n ? C.green : C.yellow}">${mon.ok === mon.n ? 'Within range' : 'Outside range'}</div><div class="caption">${mon.ok}/${mon.n} metrics · ${fMed(d)}</div></div></div>
    <div class="list">${mon.rows.map(r => li(`<span class="dot" style="background:${r.v == null || !r.b ? 'var(--txt3)' : r.ok ? C.green : C.yellow}"></span>`, r.l,
      r.b ? `normal ${r.dec ? n1(r.b.lo) : n0(r.b.lo)}–${r.dec ? n1(r.b.hi) : n0(r.b.hi)}${r.u === '%' ? '' : ' '}${r.u}` : 'needs 7+ days', `${r.v == null ? '–' : r.dec ? n1(r.v) : n0(r.v)}<small>${r.u}</small>`, ` data-metric="${r.k}"`)).join('')}</div>`);
  h += `<h2 class="sec" id="stress">Stress <small>daily, not live</small></h2>`;
  const sp = []; for (let x = add(d, -13); x <= d; x = add(x, 1)) { const q = stressDay(x); if (q) sp.push({d:x, v:+q.score.toFixed(2), c:q.color}); }
  h += card('', st ? `<div class="chart-head"><div><div class="caption">Today</div><div class="big" style="color:${st.color}">${st.score.toFixed(1)}<span class="unit">${st.level.toUpperCase()}</span></div></div>
      <div class="sub" style="text-align:right;font-size:12px;line-height:16px">HRV ${st.zh >= 0 ? st.zh.toFixed(1) + ' SD below' : (-st.zh).toFixed(1) + ' SD above'} normal<br>RHR ${st.zr >= 0 ? st.zr.toFixed(1) + ' SD above' : (-st.zr).toFixed(1) + ' SD below'} normal${st.j != null ? `<br>journal stress ${st.j}/5` : ''}</div></div>
      ${chart({start:add(d, -13), end:d, pts:sp, type:'bar', color:C.blue, min:0, max:3, label:'Daily stress 14 days', tfmt:q => q.v.toFixed(1), h:110})}
      <div class="caption" style="margin-top:10px">0–3 scale like WHOOP's, but computed once a day from overnight HRV and resting HR vs your 30-day baseline (70%) and your journal stress answer (30%) when there is one. WHOOP's live Stress Monitor uses continuous heart rate, which its developer API doesn't provide.</div>`
    : '<div class="empty">Needs 7+ days of HRV and RHR.</div>');
  // sleep detail (latest)
  const s = slp(d);
  if (s.hours_asleep != null) h += `<h2 class="sec">Last night</h2>` + card('Sleep', sleepDetail(s), {attr:` data-page="sleep/${d}"`});
  // body
  const bmi = wp.height_m && WEIGHTS.length ? toKg(WEIGHTS[WEIGHTS.length - 1].value) / wp.height_m ** 2 : null;
  h += `<h2 class="sec">Body</h2>` + card('', `<dl class="kv"><dt>Age</dt><dd>${p.age ?? '–'} (born ${p.birth_date ? fShort(p.birth_date) + ', ' + p.birth_date.slice(0, 4) : '–'})</dd>
    ${wp.height_m ? `<dt>Height</dt><dd>${Math.floor(wp.height_m * 39.37 / 12)}′ ${Math.round(wp.height_m * 39.37 % 12)}″</dd>` : ''}
    <dt>Weight</dt><dd>${WEIGHTS.length ? WEIGHTS[WEIGHTS.length - 1].value + ' ' + U + ' (log)' : '–'}${wpW(wp) ? ` · ${wpW(wp)} (${WN})` : ''}</dd>
    ${bmi ? `<dt>BMI</dt><dd>${n1(bmi)}</dd>` : ''}${wp.max_heart_rate ? `<dt>Max HR (WHOOP)</dt><dd>${wp.max_heart_rate} bpm</dd>` : ''}</dl>`);
  return h;
}
/* Coach Age: computed at build/publish time by research/coach_age.py (see build.py); pending card until it exists. */
const CA_NOTE = 'Coach Age is an estimate based on published mortality research; not WHOOP Age and not medical advice.';
function coachAgeCard() {
  const ca = D.coach_age || {status:'pending'}, chrono = D.profile.age;
  const orb = (big, sub, sub2) => `<div class="orbwrap"><div class="orb${RM ? '' : ' live'}"><div class="orb-in"><div class="orb-n num">${big}</div><div class="orb-l">${sub}</div>${sub2 ? `<div class="orb-s">${sub2}</div>` : ''}</div></div></div>`;
  if (ca.status !== 'ok') return card('', orb('—', 'Coach Age', 'calculating') + `<div class="ca-pending"><b>Coach Age: calculating, coming soon.</b><div class="caption">Chronological age: ${chrono ?? 'add profile.birth_date'}.</div></div>`, {attr:' id="coachage"'});
  const d = ca.delta_years, yrs = v => `${n1(Math.abs(v))} year${Math.abs(v) >= 0.95 && Math.abs(v) < 1.05 ? '' : 's'}`;
  const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + n1(Math.abs(v));
  let h = orb(n1(ca.coach_age), 'Coach Age', Math.abs(d) < 0.05 ? 'same as your age' : `${yrs(d)} ${d > 0 ? 'older' : 'younger'}`);
  h += `<div class="ca-meta"><span>80% range <b>${n1(ca.ci80[0])}–${n1(ca.ci80[1])}</b></span><span class="badge conf-${esc(ca.confidence)}">${esc(ca.confidence)} confidence</span></div>
    <div class="caption" style="text-align:center;margin-bottom:14px">vs. calendar age ${n1(ca.chronological_age)} · ${ca.coverage.days_with_whoop} of ${ca.coverage.window_days} days of WHOOP data · ${ca.coverage.components_ok}/${ca.coverage.components_total} inputs scored</div>`;
  // pace + cardiometabolic tiles
  const p = ca.pace || {}, m = ca.metabolic_age;
  const paceTile = p.status === 'ok'
    ? `<div class="tile"><div class="lbl">Pace of aging</div><div class="big num">${n1(p.pace)}x</div><div class="ticks sm"><span class="mark" style="left:${(Math.max(0, Math.min(1, (p.pace + 1) / 4)) * 100).toFixed(1)}%"></span></div><div class="row caption"><span>-1.0x</span><span>3.0x</span></div></div>`
    : `<div class="tile"><div class="lbl">Pace of aging</div><div class="mid">Unlocks ~${p.unlock_date ? fShort(p.unlock_date).replace(' ', '\u00a0') : 'soon'}</div>${bar((p.points || 0) / (p.min_points || 21), '#ffc46b')}<div class="caption" style="margin-top:6px">${p.points || 0} of ${p.min_points || 21} qualifying days</div></div>`;
  const metTile = m ? `<div class="tile"><div class="lbl">Cardiometabolic age</div><div class="big num">${n1(m.value)}</div><div class="caption">${sign(m.delta_years)} y · 80% ${n1(m.ci80[0])}–${n1(m.ci80[1])}</div></div>` : '';
  h += `<div class="grid2 ca-tiles">${paceTile}${metTile}</div>`;
  // components, sorted by impact (build.py sorts: scored first, by |years|)
  h += `<div class="hr"></div><h3 class="caph">What's driving it <span class="caption">sorted by impact</span></h3><div class="list">${(ca.components || []).map(c => {
    const ok = c.status === 'ok', unit = (c.unit || '').split(' (')[0].replace('^2', '²'), val = c.value == null ? '–' : `${typeof c.value === 'number' ? (Math.abs(c.value) >= 100 ? n0(c.value) : +c.value.toFixed(1)) : esc(c.value)}${unit ? (unit[0] === '%' ? '' : ' ') + esc(unit) : ''}`;
    const src = c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.source)}</a>` : esc(c.source || '');
    return `<div class="li ca-c tap" data-page="age/${esc(c.id)}"${BTN}><div class="body"><div class="t">${esc(c.label)} <span class="badge b-${c.badge}">${c.badge}</span></div>
      <div class="s">${ok ? val : `not enough data (${c.n || 0} of ${c.min_n} days)`}${c.note ? ' · ' + esc(c.note) : ''}</div><div class="s src">${src}</div></div>
      <div class="r">${ok ? `<span style="color:${c.years > 0.05 ? '#ff5a68' : c.years < -0.05 ? C.green : 'var(--txt2)'}">${sign(c.years)}</span><small>years</small>` : '<small>–</small>'}</div>${chev}</div>`; }).join('')}</div>`;
  if ((ca.whatifs || []).length) h += `<div class="hr"></div><h3 class="caph">What-if <span class="caption">same model, today's data</span></h3><div class="list">${ca.whatifs.map(w =>
    li('', esc(w.label), `${sign(w.coach_age - ca.coach_age)} vs. now`, `${n1(w.coach_age)}<small>Coach Age</small>`, '', true)).join('')}</div>`;
  h += `<button class="btn2" data-method>${ic('book-open')} Method & sources</button><div class="caption ca-note">${CA_NOTE}</div>`;
  return card('', h, {attr:' id="coachage"'});
}
async function openMethod(trigger) {
  let body;
  try { const r = await fetch('/coach-age-method.html'); if (!r.ok) throw 0; body = await r.text(); }
  catch (e) { body = '<p>Couldn\u2019t load the method notes. Check your connection and try again.</p>'; }
  openSheet('Method & sources', `<div class="card md"><p class="caption">${CA_NOTE}</p>${body}</div>`, 'method', trigger);
}
function sleepDetail(s) {
  const st = s.stages || {}, tot = (st.light || 0) + (st.deep || 0) + (st.rem || 0) + (st.awake || 0) || 1, nb = s.need_breakdown || {};
  return `<div class="row" style="margin-bottom:12px"><div><span class="big">${hm(s.hours_asleep)}</span><span class="unit">asleep</span></div><div class="sub">need ${hm(s.need_hours)} · ${s.need_hours ? Math.round(s.hours_asleep / s.need_hours * 100) + '% of need' : '–'}</div></div>
    <div class="stack">${['awake', 'light', 'deep', 'rem'].map(k => `<span style="width:${((st[k] || 0) / tot * 100).toFixed(1)}%;background:${STC[k]}"></span>`).join('')}</div>
    <div class="legend">${[['awake', 'Awake'], ['light', 'Light'], ['deep', 'SWS (deep)'], ['rem', 'REM']].map(([k, l]) => `<span><i style="background:${STC[k]}"></i>${l} ${hm(st[k])}</span>`).join('')}</div>
    <div class="hr" style="margin:16px 0"></div>
    <dl class="kv"><dt>In bed</dt><dd>${fTime(s.start)} – ${fTime(s.end)}</dd><dt>Time in bed</dt><dd>${hm(s.hours_in_bed)}</dd><dt>Performance</dt><dd>${s.performance ?? '–'}%</dd><dt>Efficiency</dt><dd>${n1(s.efficiency)}%</dd><dt>Consistency</dt><dd>${s.consistency ?? '–'}%</dd>
    <dt>Disturbances</dt><dd>${s.disturbances ?? '–'}</dd><dt>Sleep cycles</dt><dd>${s.cycles ?? '–'}</dd><dt>Respiratory rate</dt><dd>${n1(s.respiratory_rate)} rpm</dd>
    <dt>Need: minimum</dt><dd>${hm(nb.baseline)}</dd><dt>Need: debt</dt><dd>${hm(nb.debt)}</dd><dt>Need: strain</dt><dd>${hm(nb.strain)}</dd>${nb.nap ? `<dt>Need: nap credit</dt><dd>${hm(nb.nap)}</dd>` : ''}
    ${s.no_data_hours ? `<dt>No data</dt><dd>${hm(s.no_data_hours)}</dd>` : ''}${s.state && s.state !== 'SCORED' ? `<dt>Score state</dt><dd>${esc(s.state)}</dd>` : ''}</dl>`;
}
function openMetric(k) { pushPage(`metric/${k}/${TODAY}`); }
function openMetricSheet(k) {
  const r = monitor(TODAY).rows.find(x => x.k === k); if (!r) return;
  const pts = []; for (let x = add(TODAY, -29); x <= TODAY; x = add(x, 1)) { const v = r.fn(x); if (v != null) pts.push({d:x, v}); }
  openSheet(r.l, `${card('', `<div class="chart-head"><div><div class="caption">Today</div><div class="big">${r.v == null ? '–' : r.dec ? n1(r.v) : n0(r.v)}<span class="unit">${r.u}</span></div></div><div class="caption" style="text-align:right">${r.b ? `30-day mean ${r.dec ? n1(r.b.m) : n0(r.b.m)} ${r.u}<br>normal ${r.dec ? n1(r.b.lo) : n0(r.b.lo)}–${r.dec ? n1(r.b.hi) : n0(r.b.hi)}` : 'needs 7+ days'}</div></div>
    ${chart({start:add(TODAY, -29), end:TODAY, pts, color:r.ok || !r.b ? C.green : C.yellow, band:r.b, label:r.l + ' 30 days', tfmt:q => (r.dec ? n1(q.v) : n0(q.v)) + ' ' + r.u, h:150})}
    <div class="caption" style="margin-top:10px">Shaded: your normal range, the 30-day mean ± 1.5 standard deviations (with a small minimum width).</div>`)}`, 'metric');
}

/* ---------- MORE ---------- */
function vMore() {
  const go = ([k, i, l, sub]) => li(ic(i), l, sub, chev, ` data-go="${k}"`);
  const browse = [['nutrition', 'fork-knife', 'Nutrition', `${plural(foodTot(TODAY).n, "meal")} today · meal log, 7-day calories`], ['history', 'clock-counter-clockwise', 'History', 'Everything, by day · filters'],
    ['journal', 'notebook', 'Journal', "Today's answers"], ['insights', 'lightning', 'Insights', 'Behaviors vs next-day recovery']];
  return header('More', 'Nutrition, history, journal and settings')
    + card('Browse', `<div class="list">${browse.map(go).join('')}</div>`)
    + card('About the numbers', `<div class="list"><button type="button" class="li tap" data-method id="methodrow"><div class="ico">${ic('book-open')}</div><div class="body"><div class="t">Method & sources</div><div class="s">How Coach Age is estimated, with sources</div></div>${chev}</button></div>`)
    + appearanceCard()
    + infoCards()
    + card('Account', `<div class="list">${signOutLi}</div>`);
}
const signOutLi = `<a class="li tap signout" href="/logout"><div class="ico">${ic('sign-out')}</div><div class="body"><div class="t">Sign out</div><div class="s">This device will need the password again</div></div></a>`;
function journalSummary(d) {
  const j = D.journal[d] || {}, keys = Object.keys(j);
  if (!keys.length) return `<div class="sub">No answers yet. Log with <code>log.py journal alcohol 0</code>, <code>journal stress 2</code>…</div>`;
  return `<div style="display:flex;flex-wrap:wrap;gap:8px">${keys.filter(k => JMAP[k] && JMAP[k][2] !== 'text').map(k => `<span class="pill j">${ic(JMAP[k][4])}${esc(JMAP[k][1])}: ${esc(jval(k, j[k]))}</span>`).join('')}</div>
    ${j.note ? `<div class="sub" style="margin-top:12px">${esc(j.note)}</div>` : ''}`;
}
const jval = (k, v) => { const m = JMAP[k]; if (!m) return String(v); if (m[2] === 'bool') return v ? 'Yes' : 'No'; if (m[2] === 'scale') return v + '/5'; const u = m[3] && m[2] !== 'text' && m[2] !== 'time' ? ' ' + (v === 1 ? m[3].replace(/s$/, '') : m[3]) : ''; return v + u; };
const wfmt = x => x.weight == null ? '' : `${x.weight % 1 ? x.weight : Math.round(x.weight)}${x.per_hand ? ' ' + (x.unit || U) + ' ea' : ' ' + (x.unit || U)}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const exList = ex => (ex || []).filter(x => !x.text);
const exCount = ex => plural((ex || []).length, 'exercise');
const setsStr = x => Array.isArray(x.sets) ? x.sets.join(' / ') : x.sets ? `${x.sets}×${x.reps}` : '';
const repsNum = r => typeof r === 'number' ? r : /^\d+$/.test(r) ? +r : null;
function exTotals(ex) {
  let s = 0, r = 0, exact = true;
  for (const x of exList(ex)) for (const v of x.sets || []) { s++; const n = repsNum(v); if (n == null) exact = false; else r += n; }
  return {s, r, exact};
}
function exSummary(l) {
  const t = exTotals(l.exercises), bits = [exCount(l.exercises)];
  if (t.s) bits.push(plural(t.s, 'set'), (t.exact ? '' : '≥') + plural(t.r, 'rep'));
  return bits.join(' · ');
}
const saunaTag = l => l.sauna === false ? `<span class="pill nos">${ic('thermometer-cold')}No sauna</span>` : l.sauna === true ? `<span class="pill">${ic('thermometer-hot')}Sauna</span>` : '';
function exGrid(ex, l) {
  const rows = (ex || []).map(x => x.text
    ? `<div class="exrow txt"><span class="exi">${ic('note')}</span><div class="exnm">${esc(x.name)}</div></div>`
    : `<div class="exrow"><span class="exi">${ic('barbell')}</span><div class="exnm">${esc(x.name)}${x.note ? `<small>${esc(x.note)}</small>` : ''}</div><div class="exv num">${x.weight != null ? `<b>${wfmt(x)}</b>` : ''}<span>${esc(setsStr(x))}</span></div></div>`).join('');
  const foot = l && l.sauna != null ? `<div class="exfoot">${saunaTag(l)}</div>` : '';
  return `<div class="exs">${rows}</div>${foot}`;
}
function zonesBar(z) {
  if (!z) return '';
  const cols = ['#3a3f44', '#00a3ff', '#16ec06', '#ffde00', '#ff9f0a', '#ff0026'], tot = z.reduce((a, b) => a + (b || 0), 0) || 1;
  return `<div class="stack" style="margin-top:8px">${z.map((m, i) => m ? `<span style="width:${(m / tot * 100).toFixed(1)}%;background:${cols[i]}" title="Zone ${i}: ${m} min"></span>` : '').join('')}</div>`;
}
function whoopLi(w) {
  const dist = (w.distance_m ? ` · ${(w.distance_m / 1609.34).toFixed(2)} mi` : '') + (w.altitude_gain_m ? ` · +${Math.round(w.altitude_gain_m * 3.281)} ft` : '');
  return `<div class="li" style="display:block"><div class="row"><div><div class="t">${esc(title(w.sport))}</div><div class="s">${fTime(w.start)} – ${fTime(w.end)}${dist}${w.avg_hr ? ` · ${w.avg_hr}/${w.max_hr} bpm` : ''}</div></div>
    <div class="r">${w.strain != null ? `<span style="color:${C.strain}">${n1(w.strain)}</span>` : '–'}<small>${w.kcal != null ? `${w.kcal} kcal · ${n0(w.kj ?? w.kcal * 4.184)} kJ` : 'strain'}</small></div></div>${zonesBar(w.zones_min)}${w.zones_min ? `<div class="legend">${w.zones_min.map((m, i) => m ? `<span>Z${i} ${Math.round(m)}m</span>` : '').join('')}${w.percent_recorded != null && w.percent_recorded < 1 ? `<span>${Math.round(w.percent_recorded * 100)}% recorded</span>` : ''}</div>` : ''}</div>`;
}

/* ---------- TRENDS ---------- */
function rangeStart() {
  if (range === 'all') { const f = [D.wear.first_day, WEIGHTS[0]?.date, D.food[0]?.date].filter(Boolean).sort()[0] || add(TODAY, -29); return f; }
  return add(TODAY, -(+range - 1));
}
function series(fn) { const out = []; for (let d = rangeStart(); d <= TODAY; d = add(d, 1)) { const v = fn(d); if (v != null) out.push(Object.assign({d}, typeof v === 'object' ? v : {v})); } return out; }
function trendCard(name, cfg, unit, agg = 'avg', note = '') {
  const vals = cfg.pts.map(p => p.v);
  const a = agg === 'last' ? vals[vals.length - 1] : avg(vals);
  const big = vals.length ? (cfg.dec ? n1(a) : n0(a)) : '–';
  return card(name, `<div class="chart-head"><div><div class="caption">${agg === 'last' ? 'Latest' : 'Average'}</div><div class="big">${big}<span class="unit">${unit}</span></div></div>${note ? `<div class="caption" style="text-align:right">${note}</div>` : ''}</div>${chart(Object.assign({start:rangeStart(), end:TODAY}, cfg))}`);
}
function vTrends() {
  let h = header('Trends', 'Drag to inspect · tap a day to open it');
  h += `<div class="seg" role="group" aria-label="Range">${[['7', '7D'], ['30', '30D'], ['90', '90D'], ['all', 'All']].map(([k, l]) => `<button data-range="${k}" class="${range === k ? 'on' : ''}" aria-pressed="${range === k}">${l}</button>`).join('')}</div>`;
  const recP = series(d => rec(d).score != null ? {v:rec(d).score, c:recColor(rec(d).score)} : null);
  h += trendCard('Recovery', {pts:recP, page:d => 'recovery/' + d, type:'bar', color:C.green, min:0, max:100, label:'Recovery', tfmt:p => p.v + '%', textra:p => `HRV ${n0(rec(p.d).hrv)} ms · RHR ${n0(rec(p.d).rhr)}`}, '%', 'avg',
    `${recP.filter(p => p.v >= 67).length} green · ${recP.filter(p => p.v < 34).length} red`);
  h += trendCard('Heart rate variability', {pts:series(d => rec(d).hrv), page:d => 'metric/hrv/' + d, color:C.violet, label:'HRV', tfmt:p => n1(p.v) + ' ms'}, 'ms', 'avg');
  h += trendCard('Resting heart rate', {pts:series(d => rec(d).rhr), page:d => 'metric/rhr/' + d, color:C.red, label:'RHR', tfmt:p => p.v + ' bpm'}, 'bpm', 'avg');
  h += trendCard('Hours asleep', {page:d => 'sleep/' + d, pts:series(d => slp(d).hours_asleep != null ? {v:slp(d).hours_asleep, v2:slp(d).need_hours} : null), type:'bar', color:C.sleep, color2:ink(.5), label:'Sleep hours', dec:1, yfmt:v => v.toFixed(0) + 'h',
    tfmt:p => hm(p.v) + ' asleep', textra:p => `need ${hm(slp(p.d).need_hours)} · ${slp(p.d).performance ?? '–'}% perf`}, 'h', 'avg', 'dashed line = sleep need');
  h += trendCard('Sleep performance', {page:d => 'sleep/' + d, pts:series(d => slp(d).performance), color:C.sleep, min:0, max:100, label:'Sleep performance', tfmt:p => p.v + '%', textra:p => `efficiency ${n0(slp(p.d).efficiency)}% · consistency ${n0(slp(p.d).consistency)}%`}, '%', 'avg');
  h += trendCard('Day strain', {page:d => 'strain/' + d, pts:series(d => cyc(d).strain), type:'bar', color:C.strain, min:0, label:'Strain', dec:1, tfmt:p => n1(p.v), textra:p => `${n0(cyc(p.d).kcal)} kcal`}, '', 'avg');
  h += trendCard('Weight', {pts:WEIGHTS.map(w => ({d:w.date, v:w.value})), gap:21, color:C.acc, goal:D.profile.goal_weight, label:'Weight', dec:1, tfmt:p => n1(p.v) + ' ' + U}, U, 'last', D.profile.goal_weight ? `goal ${D.profile.goal_weight} ${U}` : '');
  const fp = series(d => FOOD[d] ? foodTot(d) : null);
  h += trendCard('Calories', {page:d => 'meals/' + d, pts:fp.map(p => ({d:p.d, v:p.cal})), type:'bar', color:C.acc, goal:D.targets.calories, goalColor:ink(.55), label:'Calories', tfmt:p => n0(p.v) + ' kcal', textra:p => `${n0(foodTot(p.d).protein)} g protein`}, 'kcal', 'avg', `target ${n0(D.targets.calories)}`);
  h += trendCard('Protein', {page:d => 'meals/' + d, pts:fp.map(p => ({d:p.d, v:p.protein})), type:'bar', color:C.blue, goal:D.targets.protein_g, goalColor:ink(.55), label:'Protein', tfmt:p => n0(p.v) + ' g'}, 'g', 'avg', `target ${D.targets.protein_g} g`);
  h += `<h2 class="sec" id="insights">Insights <small>Next-day recovery</small></h2>` + insightsCard();
  return h;
}
/* Behaviors: yes/no per day; compare next-day recovery (WHOOP Monthly Performance Assessment style). */
function behaviors() {
  const J = D.journal, jb = (k, f) => d => { const j = J[d]; if (!j || j[k] == null) return null; return f ? f(j[k]) : !!j[k]; };
  const tracked = d => !!W[d] && (W[d].workouts || W[d].cycle);
  return [
    ['Alcohol', jb('alcohol', v => v > 0)], ['Caffeine', jb('caffeine', v => v > 0)], ['Late meal', jb('late_meal')],
    ['Screens in bed', jb('screen_in_bed')], ['High stress (4–5)', jb('stress', v => v >= 4)], ['Hydration 80+ oz', jb('hydration', v => v >= 80)],
    ['Sauna', d => saunaDay(d) ? true : (J[d] && J[d].sauna === false) || tracked(d) ? false : null, 'WHOOP activities + journal'],
    ['Cold exposure', jb('cold')], ['Intimacy', jb('intimacy')], ['Reading before bed', jb('reading')], ['Meditation', jb('meditation')],
    ['Morning sunlight', jb('sunlight')],
    ['Consistent wake time', d => { const w = wakeM(d), m = median(prior(wakeM, d, 14)); return w == null || m == null ? null : Math.abs(w - m) <= 30; }, 'WHOOP wake within 30 min of 14-day median'],
    ['Creatine', d => D.supplement_log[d] ? D.supplement_log[d].includes('creatine') : null, 'habits checklist'],
    ['Trained (lift/run)', d => W[d] || LIFTS[d] ? trained(d) : null, 'WHOOP + log'],
  ];
}
/* Next-day recovery after yes vs no days. Hidden below 3 yes + 3 no; flagged "Early" below 10 on either side and
   "Within noise" when the gap is under ~2 standard errors. Behaviors that mostly fall on training days get a note and,
   when there's enough data, a training-days-only comparison, because hard sessions lower next-day recovery on their own. */
function insightsCard() {
  let rows = ''; const none = [];
  const days = [...new Set(Object.keys(W).concat(Object.keys(D.journal), Object.keys(D.supplement_log)))];
  for (const [name, f, src] of behaviors()) {
    const yes = [], no = [];
    for (const d of days) { const b = f(d), nx = rec(add(d, 1)).score; if (b == null || nx == null) continue; (b ? yes : no).push({v:nx, tr:trained(d)}); }
    const ok = yes.length >= 3 && no.length >= 3;
    let note = `${yes.length} yes · ${no.length} no${src ? ' · ' + src : ''}`, flag = '';
    if (ok) {
      const vy = yes.map(x => x.v), vn = no.map(x => x.v), ay = avg(vy), an = avg(vn), df = ay - an;
      const se = Math.sqrt(sdev(vy) ** 2 / vy.length + sdev(vn) ** 2 / vn.length);
      const early = Math.min(vy.length, vn.length) < 10, noise = Math.abs(df) < 2 * se;
      flag = early ? 'Early' : noise ? 'Within noise' : '';
      const ty = yes.filter(x => x.tr).length / yes.length, tn = no.filter(x => x.tr).length / no.length;
      if (!/^Trained/.test(name) && Math.abs(ty - tn) >= 0.3) {
        note += ` · ${Math.round(ty * 100)}% vs ${Math.round(tn * 100)}% were training days`;
        const y2 = yes.filter(x => x.tr).map(x => x.v), n2 = no.filter(x => x.tr).map(x => x.v);
        if (y2.length >= 3 && n2.length >= 3) note += ` · training days only: ${Math.round(avg(y2))}% vs ${Math.round(avg(n2))}%`;
      }
      const col = flag || Math.abs(df) < 2 ? 'var(--txt2)' : df > 0 ? C.green : 'var(--red-t)';
      rows += `<div class="b"><div>${esc(name)}</div>${flag ? `<div class="flag">${flag}</div>` : ''}<div class="caption">${note}</div></div>`;
      rows += `<div class="n">${Math.round(ay)}%</div><div class="n">${Math.round(an)}%</div><div class="n" style="color:${col};font-weight:600">${df > 0 ? '+' : df < 0 ? '−' : ''}${Math.abs(Math.round(df))}</div>`;
    } else if (!yes.length && !no.length) none.push(name);
    else rows += `<div class="b"><div>${esc(name)}</div><div class="caption">${note}</div></div><div class="na">Needs 3+ of each</div>`;
  }
  if (none.length) rows += `<div class="b" style="grid-column:1/5"><div>Not enough data yet</div><div class="caption">${none.map(esc).join(', ')}: no days with a next-morning recovery to compare yet. Each shows up here once there are 3+ yes and 3+ no days.</div></div>`;
  return card('', `<div class="ins"><div class="h b">Behavior</div><div class="h">Yes</div><div class="h">No</div><div class="h">Δ</div>${rows}</div>
    <div class="caption" style="margin-top:12px">Average recovery the morning after days with each behavior vs days without it. Shown once there are 3+ “yes” and 3+ “no” days. <b>Early</b> = under 10 days on one side; <b>Within noise</b> = the gap is smaller than normal day-to-day swings. These are associations, not causes: something you mostly do on hard training days (like a post-workout sauna) will look worse partly because of the training itself.</div>`);
}

/* ---------- TRAINING ---------- */
function vTraining() {
  let h = header('Training', `Streak ${streak()} · ${weekSessions()} of ${Object.values(D.split).filter(v => v !== 'REST').length} sessions this week`);
  // heatmap (18 weeks)
  const weeks = 18, start = add(weekStart(TODAY), -7 * (weeks - 1));
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = add(start, i);
    if (d > TODAY) { cells += '<i class="fut"></i>'; continue; }
    const ws = whoopTrain(d), mx = Math.max(0, ...ws.map(w => w.strain || 0));
    const lvl = (LIFTS[d] || []).length ? 4 : ws.length ? (mx >= 14 ? 4 : mx >= 10 ? 3 : mx >= 6 ? 2 : 1) : 0;
    cells += `<i class="${lvl ? 'l' + lvl : ''}${d === TODAY ? ' now' : ''}" data-day="${d}" title="${d}"></i>`;
  }
  h += card('Consistency', `<div class="heat" role="img" aria-label="Training days, last 18 weeks">${cells}</div><div class="row caption" style="margin-top:8px"><span>${fShort(start)}</span><span>Less <span class="dots" style="color:var(--strain2)"><i></i><i style="background:rgba(0,163,255,.3)"></i><i style="background:rgba(0,163,255,.55)"></i><i style="background:rgba(0,163,255,.8)"></i><i class="on"></i></span> More</span></div>`,
    {meta:'18 weeks'});
  // lift progression
  const ex = {};
  let ord = 0;
  for (const w of [...D.workouts].reverse()) for (const x of w.exercises) if (x.key && x.weight != null) { if (!ex[x.key]) ex[x.key] = {name:x.name, pts:[], o:ord++}; ex[x.key].pts.unshift({d:w.date, v:x.weight, x}); }
  const keys = Object.keys(ex).sort((a, b) => ex[b].pts.length - ex[a].pts.length || ex[a].o - ex[b].o);
  if (keys.length) {
    if (!liftKey || !ex[liftKey]) liftKey = keys[0];
    const e = ex[liftKey], f = e.pts[0], l = e.pts[e.pts.length - 1];
    const s0 = e.pts.length ? e.pts[0].d : TODAY;
    h += `<h2 class="sec">Lift progression</h2><div class="chips">${keys.map(k => `<button class="chip${k === liftKey ? ' on' : ''}" data-lift="${esc(k)}" aria-pressed="${k === liftKey}">${esc(ex[k].name)}</button>`).join('')}</div>`;
    h += card(esc(e.name), `<div class="chart-head"><div><div class="caption">Latest</div><div class="big">${l.v}<span class="unit">${l.x.per_hand ? (l.x.unit || U) + ' ea' : (l.x.unit || U)}</span></div></div><div class="caption" style="text-align:right">${esc(setsStr(l.x))} · ${relDay(l.d)}<br>${e.pts.length > 1 ? `${l.v - f.v >= 0 ? '+' : ''}${l.v - f.v} ${l.x.unit || U} since ${fShort(f.d)}` : 'First session logged'}</div></div>` +
      chart({start:add(s0 < add(TODAY, -27) ? s0 : add(TODAY, -27), 0), end:TODAY, pts:e.pts, color:C.acc, label:e.name, gap:1e9, tfmt:p => p.v + ' ' + (p.x.unit || U), textra:p => setsStr(p.x), h:120}));
  }
  // pull-ups
  const P = D.pullup_max;
  if (PU()) h += card('Strict pull-up max', `<div class="chart-head"><div><div class="caption">Current</div><div class="big">${P.length ? P[P.length - 1].reps : '–'}<span class="unit">reps</span></div></div><div class="caption" style="text-align:right">${esc(D.pullup_context || '')}<br>${P.length} test${P.length === 1 ? '' : 's'}</div></div>` +
    (P.length ? chart({start:add(TODAY, -27) < P[0].date ? add(TODAY, -27) : P[0].date, end:TODAY, pts:P.map(p => ({d:p.date, v:p.reps})), color:C.blue, min:0, gap:1e9, label:'Pull-up max', tfmt:p => p.v + ' reps', h:110}) : ''));
  // log
  const dates = [...new Set(D.workouts.map(w => w.date).concat(Object.keys(W).filter(d => (W[d].workouts || []).length)))].sort().reverse();
  h += `<h2 class="sec">Workout log <small>${dates.length} days</small></h2>`;
  for (const d of dates.slice(0, logLimit)) {
    let b = '';
    (LIFTS[d] || []).forEach((l, i) => { b += `<div class="row tap srow" data-page="session/${d}/${i}"${BTN} aria-label="${esc(l.type)} session, ${relDay(d)}"><span class="pill" style="color:${TYPE_C[l.type] || C.acc}"><i></i>${esc(l.type)}</span><span class="caption">${exSummary(l)} ${chev}</span></div>${exGrid(l.exercises, l)}<div class="sharerow">${shareBtn(d, i)}</div>`; });
    const ww = wd(d).workouts || [];
    if (ww.length) b += `${b ? '<div class="hr"></div>' : ''}<div class="acts">${ww.map((w, i) => actRow(d, w, i)).join('')}</div>`;
    h += card(`<span class="tap dlink" data-page="day/${d}"${BTN}>${relDay(d)} ${chev}</span>`, b, {meta:`strain ${n1(cyc(d).strain)}`});
  }
  if (dates.length > logLimit) h += `<button class="morebtn" data-more="log">Show more</button>`;
  return h;
}
const weekSessions = () => { let n = 0; for (let d = weekStart(TODAY); d <= TODAY; d = add(d, 1)) if (trained(d)) n++; return n; };

/* ---------- NUTRITION ---------- */
function vNutrition() {
  const t = D.targets, ft = foodTot(TODAY);
  let h = header('Nutrition', `${fLong(TODAY)} · targets ${n0(t.calories)} kcal · ${t.protein_g} g protein`);
  h += card('Today', `<div class="grid2" style="text-align:center;margin-bottom:16px">
    <div>${ring(ft.cal / t.calories, C.acc, n0(ft.cal), 'of ' + n0(t.calories), 120)}<div class="ring-lbl">Calories</div><div class="caption">${n0(Math.max(0, t.calories - ft.cal))} left</div></div>
    <div>${ring(ft.protein / t.protein_g, C.blue, n0(ft.protein) + '<span class="unit">g</span>', 'of ' + t.protein_g + ' g', 120)}<div class="ring-lbl">Protein</div><div class="caption">${n0(Math.max(0, t.protein_g - ft.protein))} g left</div></div></div>` +
    metric('Fat', ft.fat, t.fat_g, 'g', C.orange) + metric('Sugar', ft.sugar, t.sugar_g, 'g', C.pink), {meta:`${ft.n} meals`});
  const pts = []; for (let d = add(TODAY, -6); d <= TODAY; d = add(d, 1)) if (FOOD[d]) pts.push({d, v:foodTot(d).cal});
  h += card('Last 7 days', chart({start:add(TODAY, -6), end:TODAY, pts, page:d => 'meals/' + d, type:'bar', color:C.acc, goal:t.calories, goalColor:ink(.55), label:'Calories 7 days', tfmt:p => n0(p.v) + ' kcal', textra:p => n0(foodTot(p.d).protein) + ' g protein', h:120}), {meta:'kcal'});
  h += `<h2 class="sec">Meal log</h2>`;
  const ds = Object.keys(FOOD).sort().reverse();
  if (!ds.length) h += card('', '<div class="empty">No meals logged yet.</div>');
  for (const d of ds) {
    const tt = foodTot(d);
    h += card(relDay(d), `<div class="list">${FOOD[d].map(mealRow).join('')}</div>`,
      {meta:`${n0(tt.cal)} kcal · ${n0(tt.protein)} g ${chev}`, attr:` data-page="meals/${d}"`});
  }
  return h;
}

/* ---------- HISTORY + SEARCH index ---------- */
function feed() {
  const items = [];
  const push = (d, type, ico, t, s, r, extra = '') => items.push({d, type, ico, t, s, r, text:`${t} ${s} ${extra} ${d} ${fLong(d)}`.toLowerCase()});
  const dates = new Set([...Object.keys(W), ...Object.keys(FOOD), ...Object.keys(LIFTS), ...D.weights.map(w => w.date), ...Object.keys(D.supplement_log), ...Object.keys(D.journal), ...Object.keys(GTG), ...D.pullup_max.map(p => p.date)]);
  for (const d of dates) {
    for (const w of D.weights.filter(x => x.date === d)) push(d, 'weight', ic('scales'), `Weight ${w.value} ${U}`, 'Weigh-in', '');
    for (const l of LIFTS[d] || []) push(d, 'workout', ic('barbell'), `${l.type} workout`, l.exercises.filter(x => !x.text).map(x => x.name).join(', '), '', l.note);
    for (const w of wd(d).workouts || []) push(d, 'workout', ic(w.sport === 'sauna' ? 'thermometer-hot' : 'watch'), title(w.sport), `${fTime(w.start)} · ${w.kcal ?? '–'} kcal${w.avg_hr ? ' · avg ' + w.avg_hr + ' bpm' : ''}`, w.strain != null ? n1(w.strain) : '', 'whoop');
    for (const f of FOOD[d] || []) push(d, 'meal', ic('fork-knife'), f.note || 'Meal', `${n0(f.protein)} g protein · ${n0(f.fat)} g fat`, `${n0(f.cal)}<small>kcal</small>`, 'meal food');
    if (supps(d).length) push(d, 'supplements', ic('pill'), `Supplements ${supps(d).length}/${D.supplements.length}`, supps(d).map(id => (D.supplements.find(s => s.id === id) || {name:id}).name).join(', '), '');
    if (D.journal[d]) { const j = D.journal[d]; push(d, 'journal', ic('notebook'), 'Journal', Object.keys(j).filter(k => JMAP[k]).map(k => `${JMAP[k][1]}: ${jval(k, j[k])}`).join(' · '), '', JSON.stringify(j)); }
    for (const g of GTG[d] || []) push(d, 'workout', ic('arrow-fat-up'), `GtG ${g.reps} reps`, `${g.negatives || 0} negatives`, '', 'grease the groove pull-up');
    for (const p of D.pullup_max.filter(x => x.date === d)) push(d, 'workout', ic('arrow-fat-up'), `Pull-up max ${p.reps}`, 'Strict max test', '', 'pullup');
    const r = rec(d), s = slp(d), c = cyc(d);
    if (W[d] && (r.score != null || s.hours_asleep != null)) push(d, 'whoop', `<span style="color:${recColor(r.score)};font-weight:700;font-size:13px">${r.score ?? '–'}</span>`, `Recovery ${r.score ?? '–'}%`, `HRV ${n0(r.hrv)} · RHR ${n0(r.rhr)} · sleep ${hm(s.hours_asleep)} · strain ${n1(c.strain)}`, '', 'whoop recovery sleep');
  }
  return items.sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
}
let FEED = null;
const FILTERS = [['all', 'All'], ['workout', 'Workouts'], ['meal', 'Meals'], ['weight', 'Weight'], ['supplements', 'Supplements'], ['journal', 'Journal'], ['whoop', 'WHOOP']];
function vHistory() {
  FEED = FEED || feed();
  let h = header('History', `${new Set(FEED.map(i => i.d)).size} days · since ${fShort(FEED.length ? FEED[FEED.length - 1].d : TODAY)}`);
  h += `<div class="chips">${FILTERS.map(([k, l]) => `<button class="chip${histFilter === k ? ' on' : ''}" data-filter="${k}" aria-pressed="${histFilter === k}">${l}</button>`).join('')}</div>`;
  const items = FEED.filter(i => histFilter === 'all' || i.type === histFilter);
  const days = [...new Set(items.map(i => i.d))];
  if (!days.length) h += card('', '<div class="empty">Nothing here yet.</div>');
  for (const d of days.slice(0, histLimit)) h += dayFeedCard(d, items.filter(i => i.d === d));
  if (days.length > histLimit) h += `<button class="morebtn" data-more="hist">Show more</button>`;
  return h;
}
const dayFeedCard = (d, items, q) => `<div class="feed-day"><div class="dh"><b>${relDay(d)}</b><span class="caption">${dayType(d)}</span></div>${card('', `<div class="list">${items.map(i => li(i.ico, hl(i.t, q), hl(i.s, q), i.r || null, ` data-day="${d}"`)).join('')}</div>`)}</div>`;
const hl = (s, q) => { s = esc(s); if (!q) return s; const i = s.toLowerCase().indexOf(q); return i < 0 ? s : s.slice(0, i) + '<mark>' + s.slice(i, i + q.length) + '</mark>' + s.slice(i + q.length); };

function parseDateQuery(q) {
  q = q.trim().toLowerCase();
  if (q === 'today') return TODAY; if (q === 'yesterday') return add(TODAY, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  let m = q.match(/^(\d{1,2})\/(\d{1,2})$/); if (m) return `${TODAY.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const mons = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  m = q.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})$/); if (m && mons.includes(m[1])) return `${TODAY.slice(0, 4)}-${String(mons.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const wdx = ['mon','tue','wed','thu','fri','sat','sun'].indexOf(q.slice(0, 3));
  if (wdx >= 0 && q.length >= 3 && 'monday tuesday wednesday thursday friday saturday sunday'.includes(q)) { let d = TODAY; while (dow(d) !== wdx) d = add(d, -1); return d; }
  return null;
}
function runSearch(q) {
  const sv = $('#searchview'); q = q.trim().toLowerCase();
  if (!q) { sv.hidden = true; return; }
  FEED = FEED || feed(); sv.hidden = false;
  let h = '';
  const dq = parseDateQuery(q);
  if (dq) h += `<div class="grp">Date</div>${card('', `<div class="list">${li(ic('calendar-blank'), fLong(dq), dayType(dq) + ' day', '', ` data-day="${dq}"`)}</div>`)}`;
  // exercises (aggregate)
  const exm = {};
  for (const w of D.workouts) for (const x of w.exercises) if (x.name.toLowerCase().includes(q)) (exm[x.name] = exm[x.name] || []).push({d:w.date, x});
  if (Object.keys(exm).length) h += `<div class="grp">Exercises</div>` + card('', `<div class="list">${Object.entries(exm).map(([n, a]) => li(ic('barbell'), hl(n, q), a.map(o => `${fShort(o.d)}: ${o.x.weight != null ? o.x.weight + (o.x.per_hand ? ' ' + (o.x.unit || U) + ' ea' : ' ' + (o.x.unit || U)) + ' · ' : ''}${setsStr(o.x)}`).join(' · '), '', ` data-day="${a[a.length - 1].d}"`)).join('')}</div>`);
  const res = FEED.filter(i => i.text.includes(q));
  const groups = [['meal', 'Meals'], ['workout', 'Workouts'], ['journal', 'Journal & notes'], ['weight', 'Weight'], ['supplements', 'Supplements'], ['whoop', 'WHOOP days']];
  for (const [k, l] of groups) {
    const g = res.filter(i => i.type === k).slice(0, 25);
    if (g.length) h += `<div class="grp">${l} <span class="dim">${res.filter(i => i.type === k).length}</span></div>` + card('', `<div class="list">${g.map(i => li(i.ico, hl(i.t, q), `${relDay(i.d)} · ${hl(i.s, q)}`, i.r || null, ` data-day="${i.d}"`)).join('')}</div>`);
  }
  sv.innerHTML = h || `<div class="empty" style="text-align:center">No results for “${esc(q)}”</div>`; brandDom(sv);
}

/* ---------- overlays (sheets + search) ----------
   Each open overlay pushes one history entry, so the browser back gesture closes the top one. Every other way of
   closing (X, scrim, Esc, swipe, picking an item) also goes through history, so back/forward stay consistent. */
const OV = [];
let afterPop = null;
function pushOverlay(name, close) { OV.push({name, close}); history.pushState({ov:OV.length, pages:PG.map(p => p.route)}, ''); }
function popOverlays(n, then) {
  n = Math.min(n, OV.length);
  if (!n) { if (then) then(); return; }
  afterPop = then || null; history.go(-n);
}
/* close every overlay and page (pages we pushed go back through history; deep-link parents are dropped directly) */
function closeAll(then) {
  const n = OV.length + pgOwn;
  const fin = () => { while (PG.length) dropPage(false); pgOwn = 0; if (location.hash.startsWith('#/')) history.replaceState(null, '', '#' + tab); if (then) then(); };
  if (!n) return fin();
  afterPop = fin; history.go(-n);
}
const topIs = name => OV.length > 0 && OV[OV.length - 1].name === name;

const SH = {open:false, ret:null, hideT:0};
function lockPage(on) {
  document.documentElement.classList.toggle('locked', on);
  for (const id of ['view', 'topbar', 'tabbar', 'searchview', 'pages']) { const e = document.getElementById(id); if (on) e.setAttribute('inert', ''); else e.removeAttribute('inert'); }
  if (!on) setInert();
}
function openSheet(t, body, kind = 'day', trigger) {
  $('#sheettitle').textContent = t;
  const sb = $('#sheetbody'), s = $('#sheet'), sc = $('#scrim');
  sb.innerHTML = body; sb.scrollTop = 0; $('#tip').hidden = true; brandDom(sb);
  if (!SH.open) {
    SH.open = true; SH.ret = trigger || (document.activeElement !== document.body ? document.activeElement : null);
    pushOverlay('sheet', hideSheet);
    clearTimeout(SH.hideT);
    s.style.transform = ''; sc.style.opacity = ''; s.hidden = false; sc.hidden = false;
    lockPage(true);
    requestAnimationFrame(() => requestAnimationFrame(() => { s.classList.add('show'); sc.classList.add('show'); }));
    SH.focusT = setTimeout(() => { if (SH.open) $('#sheetclose').focus({preventScroll:true}); }, 60);
  }
  bindCharts(sb); animateRings(sb);
}
function closeSheet(then) { if (SH.open && topIs('sheet')) popOverlays(1, then); else if (then) then(); }
function hideSheet() {
  if (!SH.open) return;
  SH.open = false; clearTimeout(SH.focusT);
  const s = $('#sheet'), sc = $('#scrim');
  s.classList.remove('show', 'drag'); sc.classList.remove('show', 'drag'); s.style.transform = ''; sc.style.opacity = '';
  $('#tip').hidden = true;
  lockPage(false);
  SH.hideT = setTimeout(() => { s.hidden = true; sc.hidden = true; }, RM ? 0 : 360);
  const r = SH.ret; SH.ret = null;
  if (r && r.focus && document.contains(r) && r !== document.body) r.focus({preventScroll:true});
}
/* Swipe down to dismiss: from the grabber/header always, from the body when it's scrolled to the top.
   Closes past 80 px or on a quick flick (> 0.35 px/ms); otherwise springs back via the CSS transition. */
function wireSheetDrag() {
  const s = $('#sheet'), sc = $('#scrim'), sb = $('#sheetbody');
  let y0 = null, x0 = 0, dy = 0, fromBody = false, active = false, samples = [];
  const begin = (x, y, inBody) => { if (inBody && sb.scrollTop > 0) return; y0 = y; x0 = x; dy = 0; fromBody = inBody; active = false; samples = [{y, t:performance.now()}]; };
  const move = (x, y, e) => {
    if (y0 == null) return;
    dy = y - y0;
    if (!active) {
      if (Math.abs(dy) < 6 && Math.abs(x - x0) < 6) return;
      if (Math.abs(x - x0) > Math.abs(dy) || (dy < 0 && fromBody)) { y0 = null; return; }
      active = true; s.classList.add('drag'); sc.classList.add('drag');
    }
    if (e && e.cancelable) e.preventDefault();
    const d = dy >= 0 ? dy : dy / 6;
    s.style.transform = `translateY(${d.toFixed(1)}px)`;
    sc.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / Math.max(1, s.offsetHeight)));
    samples.push({y, t:performance.now()}); if (samples.length > 6) samples.shift();
  };
  const end = () => {
    if (y0 == null) return;
    y0 = null; if (!active) return; active = false;
    const a = samples[0], b = samples[samples.length - 1], v = (b.y - a.y) / Math.max(1, b.t - a.t);
    s.classList.remove('drag'); sc.classList.remove('drag');
    if (dy > 80 || (v > 0.35 && dy > 12)) closeSheet();
    else { s.style.transform = ''; sc.style.opacity = ''; }
  };
  s.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.chart,.chips,button.xbtn')) { y0 = null; return; }
    begin(e.touches[0].clientX, e.touches[0].clientY, !e.target.closest('#grab,#sheethead'));
  }, {passive:true});
  s.addEventListener('touchmove', e => move(e.touches[0].clientX, e.touches[0].clientY, e), {passive:false});
  s.addEventListener('touchend', end); s.addEventListener('touchcancel', end);
  for (const el of [$('#grab'), $('#sheethead')]) {   // mouse / pen
    el.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' || e.target.closest('button')) return; begin(e.clientX, e.clientY, false); el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') move(e.clientX, e.clientY, e); });
    el.addEventListener('pointerup', e => { if (e.pointerType !== 'touch') end(); });
    el.addEventListener('pointercancel', e => { if (e.pointerType !== 'touch') end(); });
  }
}

/* Search is a full-screen overlay: it gets a history entry too (back closes it), plus Cancel and Esc. */
const SR = {open:false};
function openSearch() { if (SR.open) return; SR.open = true; pushOverlay('search', hideSearch); }
function hideSearch() {
  SR.open = false; const q = $('#q');
  q.value = ''; $('#qclear').hidden = true; $('#searchview').hidden = true; $('#searchview').innerHTML = '';
  document.body.classList.remove('searching'); $('#qcancel').hidden = true;
  if (document.activeElement === q) q.blur();
}
function closeSearch() { if (SR.open && topIs('search')) popOverlays(1); else hideSearch(); }

function openDay(d) { pushPage('day/' + d); }
function journalGrid(d, answeredOnly) {
  const j = D.journal[d] || {}, sl = supps(d);
  const derived = {creatine: D.supplement_log[d] ? (sl.includes('creatine') ? 'Yes' : 'No') : null, supplements: D.supplement_log[d] ? `${sl.length}/${D.supplements.length}` : null};
  const cells = JOURNAL.filter(m => m[2] !== 'text').map(([k, l, t, u, ico]) => {
    let v = t === 'link' ? derived[k] : j[k] != null ? jval(k, j[k]) : null;
    if (k === 'sauna' && v == null && saunaDay(d)) v = 'Yes (WHOOP)';
    if (answeredOnly && v == null) return '';
    if (t === 'scale' && j[k] != null) v = `<span class="dots" style="color:${k === 'stress' || k === 'soreness' ? C.orange : C.acc}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= j[k] ? 'on' : ''}"></i>`).join('')}</span> ${j[k]}`;
    return `<div class="jt${v == null ? ' no-answer' : ''}"><div class="k">${ic(ico)}${esc(l)}</div><div class="v">${v ?? 'Not answered'}</div></div>`;
  }).join('');
  const texts = ['illness', 'note'].filter(k => j[k]).map(k => `<div class="metric"><div class="caption">${JMAP[k][1]}</div><div>${esc(j[k])}</div></div>`).join('');
  return `<div class="jgrid">${cells}</div>${texts ? `<div class="hr"></div>${texts}` : ''}`;
}
function openJournal(d) {
  openSheet('Journal', `<p class="sub" style="margin:-4px 0 16px">${fLong(d)}</p>${journalGrid(d, false)}
    <div class="caption" style="margin-top:16px">Answer from the box: <code>log.py journal alcohol 0</code>, <code>journal stress 3</code>, <code>journal sunlight yes</code>, <code>journal note "…"</code>. Add <code>--date YYYY-MM-DD</code> for other days. Creatine and supplements come from the habits checklist; sauna also counts WHOOP sauna sessions.</div>`);
}
function infoCards() {
  const p = D.profile, wp = D.wear.profile || {}, t = D.targets;
  return `${card('Profile', `<dl class="kv"><dt>Name</dt><dd>${esc(p.name)}</dd><dt>Age</dt><dd>${p.age ?? '–'}${p.sex ? ' · ' + esc(p.sex) : ''}</dd><dt>Time zone</dt><dd>${esc(p.timezone || TZ)}</dd><dt>Wake time</dt><dd>${(([h, m]) => `${(h + 11) % 12 + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`)((p.wake_time || '07:00').split(':').map(Number))}</dd>
    ${wp.height_m ? `<dt>Height</dt><dd>${Math.floor(wp.height_m * 39.37 / 12)}′ ${Math.round(wp.height_m * 39.37 % 12)}″</dd>` : ''}
    ${wpW(wp) ? `<dt>${WN} weight</dt><dd>${wpW(wp)}</dd>` : ''}${wp.max_heart_rate ? `<dt>Max HR</dt><dd>${wp.max_heart_rate} bpm</dd>` : ''}
    <dt>Goal weight</dt><dd>${p.goal_weight ?? '–'} ${U}</dd><dt>Start</dt><dd>${p.start_weight ?? '–'} ${U} · ${p.start_date ? fShort(p.start_date) : ''}</dd></dl>`)}
    ${card('Targets', `<dl class="kv"><dt>Calories</dt><dd>${n0(t.calories)} kcal</dd><dt>Protein</dt><dd>${t.protein_g} g</dd>${t.sugar_g ? `<dt>Sugar</dt><dd>≤ ${t.sugar_g} g</dd>` : ''}${t.fat_g ? `<dt>Fat</dt><dd>${t.fat_g} g</dd>` : ''}</dl>
      <div class="caption" style="margin-top:12px">Change with <code>log.py target protein 180</code></div>`)}
    ${card('Split', `<dl class="kv">${DOW.map(k => `<dt>${k}</dt><dd style="color:${TYPE_C[D.split[k]] || 'inherit'}">${D.split[k]}</dd>`).join('')}</dl>`)}
    ${card('Sync', `<dl class="kv"><dt>WHOOP synced</dt><dd>${D.wear.synced_at ? fMed(D.wear.synced_at.slice(0, 10)) + ', ' + fTime(D.wear.synced_at) : '–'}</dd>
      <dt>WHOOP history</dt><dd>${D.wear.first_day ? 'since ' + fShort(D.wear.first_day) : '–'}</dd><dt>Data updated</dt><dd>${D.updated_at ? fMed(D.updated_at.slice(0, 10)) + ', ' + fTime(D.updated_at) : '–'}</dd><dt>Last checked</dt><dd>${RF.checked ? fTime(RF.checked) : '–'}</dd><dt>App version</dt><dd>${APPV}</dd>
      <dt>Published</dt><dd>${fMed(D.generated_at.slice(0, 10))}, ${fTime(D.generated_at)}</dd></dl>`)}
    ${card('How to update', `<div class="sub">On the box: <code>cd /workspace/coach</code>, log with <code>./log.py …</code>, then <code>./publish.sh</code>. The publish step syncs WHOOP, rebuilds and deploys.</div>`)}`;
}
/* ---------- pages: shared helpers ----------
   Full-screen detail pages (Sleep / Recovery / Strain, metric, workout, session, day, meals, Coach Age component,
   chart pages). Thresholds marked "ours" are this app's heuristics; WHOOP doesn't publish its cut-offs. */
const PRANGES = [['7', '7D'], ['30', '30D'], ['90', '3M'], ['180', '6M']];
let prange = localStorage.getItem('coach.prange') || '7';
if (!PRANGES.some(p => p[0] === prange)) prange = '7';
const daysEnd = (end, n) => [...Array(n).keys()].map(i => add(end, i - n + 1));
const prior = (fn, d, n = 30) => [...Array(n).keys()].map(i => fn(add(d, -(i + 1)))).filter(v => v != null && !isNaN(v));
const avgPrior = (fn, d, n = 30, min = 5) => avg(prior(fn, d, n), min);
const pctl = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.min(lo + 1, s.length - 1); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const median = a => pctl(a, 0.5);
const clock = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; const hh = Math.floor(m / 60), mm = m % 60; return `${(hh + 11) % 12 + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
const clockS = m => clock(m).replace(/ ([AP])M$/, (x, a) => a.toLowerCase());
/* sleep start/end carry their own local offset ("2026-10-07T23:19-05:00"): read the wall-clock HH:MM as recorded */
const hhmm = t => t && t.length >= 16 ? +t.slice(11, 13) * 60 + +t.slice(14, 16) : null;
const after6 = m => m == null ? null : m >= 720 ? m - 1080 : m + 360;   // minutes after 6 PM, for a 7 PM–11 AM axis
const bedM = d => after6(hhmm(slp(d).start)), wakeM = d => after6(hhmm(slp(d).end));
const durMin = w => w.start && w.end ? Math.max(0, (new Date(w.end) - new Date(w.start)) / 6e4) : 0;
const STRENGTH = new Set(['weightlifting', 'weightlifting_msk', 'powerlifting', 'functional-fitness', 'crossfit']);
const zsegs = (d, a, b) => { if (!W[d]) return null; const z = [0, 0, 0, 0, 0, 0]; for (const w of wd(d).workouts || []) (w.zones_min || []).forEach((m, i) => { z[i] += m || 0; }); return z.slice(a, b + 1); };
const zsum = (d, a, b) => { const z = zsegs(d, a, b); return z ? z.reduce((x, y) => x + y, 0) : null; };
const strengthMin = d => W[d] ? (wd(d).workouts || []).filter(w => STRENGTH.has(w.sport)).reduce((t, w) => t + durMin(w), 0) : null;
const mfmt = m => m == null ? '–' : m > 0 && m < 0.5 ? '<1m' : m < 60 ? Math.round(m) + 'm' : hm(m / 60);
const hvnPct = d => { const s = slp(d); return s.hours_asleep != null && s.need_hours ? s.hours_asleep / s.need_hours * 100 : null; };
const dph = s => s.disturbances != null && s.hours_asleep ? s.disturbances / s.hours_asleep : null;
const restor = d => { const q = slp(d).stages; return q ? (q.deep || 0) + (q.rem || 0) : null; };
const fF = c => c == null ? null : c * 9 / 5 + 32;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
/* 3-step quality: Poor / Sufficient / Optimal */
const BANDS = {perf:[70, 85], hvn:[70, 85], cons:[70, 80], eff:[80, 90], dph:[1.2, 2.0]};
const lvl = (v, [a, b], lowerBetter) => v == null ? -1 : lowerBetter ? (v <= a ? 2 : v <= b ? 1 : 0) : (v >= b ? 2 : v >= a ? 1 : 0);
const LVL = ['Poor', 'Sufficient', 'Optimal'], LVLC = ['#ff9f0a', '#a8b0b6', '#3ce58a'], ZONEC = [C.red, C.yellow, C.green];
const seg3 = (i, cols = LVLC, names = LVL) => `<span class="seg3" role="img" aria-label="${i < 0 ? 'no data' : names[i]}">${[0, 1, 2].map(k => `<i${k === i ? ` style="background:${cols[k]}"` : ''}></i>`).join('')}</span>`;
const legend3 = (cols = LVLC, names = LVL) => `<div class="legend3">${names.map((x, i) => `<span><i style="background:${cols[i]}"></i>${x}</span>`).join('')}</div>`;
function arrow(v, a, goodUp, tol = 0) {
  if (v == null || a == null) return '';
  const d = v - a;
  if (Math.abs(d) <= tol) return '<span class="arr flat" aria-label="about average">●</span>';
  const up = d > 0, cls = goodUp == null ? 'neu' : up === goodUp ? 'good' : 'bad';
  return `<span class="arr ${cls}" aria-label="${up ? 'above' : 'below'} average">${up ? '▲' : '▼'}</span>`;
}
const infoBtn = (route, what) => `<button class="ibtn" data-page="${route}" aria-label="About ${esc(what)}">${ic('info')}</button>`;
const ttl = d => dayLabel(d);
/* big WHOOP-style detail ring; band = optional [from, to] fractions drawn as a target arc */
function bigRing(p, color, center, label, extra = '', band) {
  const r = 104, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, p || 0));
  const arc = (a0, a1) => `<circle class="band" cx="130" cy="130" r="${r}" stroke-dasharray="${(c * (a1 - a0)).toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-c * a0).toFixed(1)}" transform="rotate(-90 130 130)"/>`;
  return `<div class="bigring"><svg viewBox="0 0 260 260" aria-hidden="true"><circle class="trk" cx="130" cy="130" r="${r}"/>${band ? arc(band[0], band[1]) : ''}${f > 0 ? `<circle class="val" cx="130" cy="130" r="${r}" stroke="${color}" stroke-dasharray="${c.toFixed(1)}" data-off="${(c * (1 - f)).toFixed(1)}" stroke-dashoffset="${RM ? (c * (1 - f)).toFixed(1) : c.toFixed(1)}" transform="rotate(-90 130 130)"/>` : ''}</svg>
  <div class="bctr"><div class="bnum num" style="color:${color}">${center}</div><div class="blbl">${label}</div>${extra}</div></div>`;
}
/* value row: icon, label, today's value with the 30-day average underneath and a direction arrow */
const vrow = (icon, label, val, avgTxt, arr, route) => `<div class="vrow${route ? ' tap' : ''}"${route ? ` data-page="${route}"${BTN}` : ''}><span class="vi">${ic(icon)}</span><span class="vl">${label}</span><span class="vv"><span class="vtop">${arr}<b class="num">${val}</b></span><small class="num">${avgTxt || ''}</small></span>${route ? chev : '<span class="nochev"></span>'}</div>`;
const vlegend = '<div class="vleg"><span class="caps">Today</span> vs. <span class="caps dim">last 30 days</span><span class="arrk"><span class="arr good">▲</span><span class="arr bad">▼</span> better / worse</span></div>';
const rangeSeg = () => `<div class="seg pseg" role="group" aria-label="Trend range">${PRANGES.map(([k, l]) => `<button data-prange="${k}" class="${prange === k ? 'on' : ''}" aria-pressed="${prange === k}">${l}</button>`).join('')}</div>`;
const sec2 = (t, sub) => `<h2 class="sec2">${t}${sub ? `<small>${sub}</small>` : ''}</h2>`;
const empty = t => card('', `<div class="empty">${t}</div>`);
/* ---------- pages: trend charts ----------
   wchart(o): WHOOP-style weekly chart. o.days = ISO dates, o.kind = bar | stack | line | dual | float,
   o.get(d) -> number | [segments] | [a, b]; o.fmt(v) value label; o.page(d) route for tapping a column; o.sel = highlighted day.
   Values are printed on every column for 7 days; longer ranges show sparse date ticks. */
function wchart(o) {
  const days = o.days, n = days.length, Wd = 343, H = o.h || 180, L = 4, R = o.kind === "float" ? 26 : 4, T = n <= 7 ? 24 : 12, B = n <= 7 ? 34 : 20;
  const slot = (Wd - L - R) / n, X = i => L + (i + 0.5) * slot, lab = n <= 7, vals = days.map(d => { const v = o.get(d); return Array.isArray(v) ? (v.some(x => x != null) ? v : null) : v; });
  const fmt = o.fmt || (v => n0(v)), float = o.kind === 'float';
  let lo, hi;
  if (float) { lo = 60; hi = 1020; }
  else {
    const flat = [];
    vals.forEach(v => { if (v == null) return; if (o.kind === 'stack') flat.push(v.reduce((a, s) => a + (s || 0), 0)); else if (Array.isArray(v)) flat.push(...v.filter(x => x != null)); else flat.push(v); });
    if (o.band) flat.push(o.band.lo, o.band.hi);
    const bars = o.kind === 'bar' || o.kind === 'stack';
    lo = bars ? 0 : flat.length ? Math.min(...flat) : 0; hi = o.max ?? (flat.length ? Math.max(...flat) : 1);
    if (!bars) { const pad = (hi - lo) * 0.3 || Math.max(1, Math.abs(hi) * 0.05); lo -= pad; hi += pad * (lab ? 1.3 : 1); }
    else if (o.max == null) hi = hi * (lab ? 1.18 : 1.05) || 1;
    if (o.min != null) lo = o.min;
  }
  if (hi === lo) hi = lo + 1;
  const Y = float ? v => T + (v - lo) / (hi - lo) * (H - T - B) : v => T + (hi - v) / (hi - lo) * (H - T - B);
  const y0 = H - B, bw = Math.max(2, Math.min(24, slot * 0.56)), selI = days.indexOf(o.sel);
  let g = '', b = '', t = '';
  for (const y of float ? [60, 300, 540, 780, 1020].map(Y) : [0, 1, 2, 3].map(k => T + k * (H - T - B) / 3)) g += `<line class="gl" x1="${L}" x2="${Wd - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  if (float) for (const [m, l] of [[60, '7p'], [300, '11p'], [540, '3a'], [780, '7a'], [1020, '11a']]) t += `<text class="ax" x="${Wd - 2}" y="${(Y(m) + 3.5).toFixed(1)}" text-anchor="end">${l}</text>`;
  if (selI >= 0) g += `<rect x="${(X(selI) - slot / 2 + 1).toFixed(1)}" y="2" width="${(slot - 2).toFixed(1)}" height="${H - 4}" rx="6" style="fill:rgba(var(--ink),.07)"/>`;
  if (o.band && !float) { const y1 = Y(o.band.hi), y2 = Y(o.band.lo); g += `<rect x="${L}" y="${y1.toFixed(1)}" width="${Wd - L - R}" height="${Math.max(0, y2 - y1).toFixed(1)}" style="fill:rgba(var(--ink),.07)"/><line class="gl" x1="${L}" x2="${Wd - R}" y1="${Y(o.band.m).toFixed(1)}" y2="${Y(o.band.m).toFixed(1)}" stroke-dasharray="3 3"/>`; }
  const col = (d, v, i) => typeof o.color === 'function' ? o.color(d, v) : o.colors ? o.colors[i] : o.color || C.sleep;
  const vl = (x, y, s, c) => lab ? `<text class="vl" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle"${c ? ` style="fill:${c}"` : ''}>${s}</text>` : '';
  if (o.kind === 'bar') days.forEach((d, i) => { const v = vals[i]; if (v == null) return; const y = Y(Math.max(lo, Math.min(hi, v))); b += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${Math.min(y, y0 - 1.5).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, y0 - y).toFixed(1)}" rx="2" fill="${col(d, v)}"/>`; t += vl(X(i), y - 6, fmt(v)); });
  if (o.kind === 'stack') days.forEach((d, i) => { const v = vals[i]; if (v == null) return; let acc = 0; v.forEach((s, k) => { if (!s) return; const ya = Y(acc), yb = Y(acc + s); b += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${yb.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, ya - yb).toFixed(1)}" fill="${o.colors[k]}"/>`; acc += s; }); t += vl(X(i), Y(acc) - 6, fmt(acc)); });
  const path = (pts, c, dash) => { const segs = [[]]; pts.forEach(p => { if (p == null) { if (segs[segs.length - 1].length) segs.push([]); } else segs[segs.length - 1].push(p); }); return segs.filter(s => s.length > 1).map(s => `<path class="ln" stroke="${c}"${dash ? ' stroke-dasharray="4 4"' : ''} d="M${s.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}"/>`).join(''); };
  if (o.kind === 'line') {
    const c = o.color || C.sleep, pts = vals.map((v, i) => v == null ? null : [X(i), Y(v)]);
    b += path(pts, c);
    days.forEach((d, i) => { if (vals[i] == null) return; if (n <= 31) b += `<circle cx="${X(i).toFixed(1)}" cy="${Y(vals[i]).toFixed(1)}" r="${i === selI ? 4.5 : 3}" fill="#15181b" stroke="${c}" stroke-width="2"/>`; t += vl(X(i), Y(vals[i]) - 9, fmt(vals[i])); });
  }
  if (o.kind === 'dual') {
    [0, 1].forEach(k => { const c = o.colors[k], pts = vals.map((v, i) => v == null || v[k] == null ? null : [X(i), Y(v[k])]); b += path(pts, c, k === 1);
      days.forEach((d, i) => { const v = vals[i]; if (!v || v[k] == null) return; if (n <= 31) b += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v[k]).toFixed(1)}" r="3" fill="#15181b" stroke="${c}" stroke-width="2"/>`;
        const above = v[k] >= v[1 - k]; t += vl(X(i), above ? Y(v[k]) - 8 : Y(v[k]) + 15, fmt(v[k]), c); }); });
  }
  if (float) {
    (o.lines || []).forEach(ln => { const pts = ln.map((v, i) => v == null ? null : [X(i), Y(v)]); b += path(pts, ink(.55), true); });
    days.forEach((d, i) => { const v = vals[i]; if (!v || v[0] == null || v[1] == null) return; const ya = Y(v[0]), yb = Y(v[1]);
      b += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${ya.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, yb - ya).toFixed(1)}" rx="3" fill="${o.color || C.sleep}"/>`;
      if (lab && o.labels) { const [s1, s2] = o.labels(d); t += vl(X(i), ya - 5, s1) + vl(X(i), yb + 12, s2); } });
  }
  // x labels
  const step = n <= 7 ? 1 : Math.ceil(n / 6);
  days.forEach((d, i) => {
    const on = i === selI ? ' style="fill:var(--txt);font-weight:700"' : '';
    if (n <= 7) t += `<text class="ax" x="${X(i).toFixed(1)}" y="${H - 18}" text-anchor="middle"${on}>${fd(d, {weekday:'short'})}</text><text class="ax" x="${X(i).toFixed(1)}" y="${H - 5}" text-anchor="middle"${on}>${+d.slice(8)}</text>`;
    else if ((n - 1 - i) % step === 0) t += `<text class="ax" x="${Math.min(Wd - 18, Math.max(16, X(i))).toFixed(1)}" y="${H - 5}" text-anchor="middle"${on}>${fShort(d)}</text>`;
  });
  if (!vals.some(v => v != null)) t += `<text class="ax" x="${Wd / 2}" y="${H / 2}" text-anchor="middle" style="font-size:13px">No data in this range</text>`;
  // tap targets: one transparent column per day
  let hit = '';
  if (o.page) days.forEach((d, i) => { const v = vals[i]; if (v == null) return; hit += `<rect class="hit" x="${(X(i) - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" data-page="${o.page(d)}"${n <= 7 ? ' role="button" tabindex="0"' : ''} aria-label="${esc(fMed(d))}: ${esc(Array.isArray(v) ? v.map(x => x == null ? '–' : typeof x === 'number' && o.kind !== 'float' ? fmt(x) : '').filter(Boolean).join(' / ') : fmt(v))}, open day"/>`; });
  const leg = o.legend ? `<div class="legend">${o.legend.map((l, k) => `<span><i style="background:${(o.colors || [o.color])[k] || ink(.55)}${o.kind === 'dual' && k === 1 ? ';height:2px;border-radius:0' : ''}"></i>${l}</span>`).join('')}</div>` : '';
  return `<div class="wchart"><svg viewBox="0 0 ${Wd} ${H}" role="${o.page ? 'group' : 'img'}" aria-label="${esc(o.label || 'trend chart')}">${g}${b}${t}${hit}</svg>${leg}</div>`;
}
/* ---------- pages: chart registry ---------- */
const STC = {awake:'#d7dadd', light:'#9c9af0', deep:'#ef8fe6', rem:'#a259e6'};
const ZC = ['#8f9aa3', '#3b9ae1', '#3ccf8e', '#f2a65a', '#f0603c'];   // HR zones 1–5
const recZoneC = (d, v) => recColor(v);
const CH_DEF = {
  sleep_perf: {t:'Sleep performance', g:'sleep', kind:'bar', get:d => slp(d).performance, fmt:v => v + '%', color:C.sleep, max:100, sfmt:v => Math.round(v) + '%'},
  hvn_hours: {t:'Hours vs. needed', g:'sleep', kind:'dual', get:d => slp(d).hours_asleep != null && slp(d).need_hours ? [slp(d).hours_asleep, slp(d).need_hours] : null, fmt:hm, colors:[C.sleep, '#d7dadd'], legend:['Hours of sleep', 'Sleep needed'], stat:d => slp(d).hours_asleep, sfmt:hm},
  hvn_pct: {t:'Hours vs. needed %', g:'sleep', kind:'bar', get:hvnPct, fmt:v => Math.round(v) + '%', color:C.sleep, sfmt:v => Math.round(v) + '%'},
  restorative: {t:'Restorative sleep', g:'sleep', kind:'stack', get:d => { const q = slp(d).stages; return q ? [q.rem || 0, q.deep || 0] : null; }, colors:[STC.rem, STC.deep], legend:['REM', 'Deep (SWS)'], fmt:hm, stat:restor, sfmt:hm},
  consistency: {t:'Sleep consistency', g:'sleep', kind:'bar', get:d => slp(d).consistency, fmt:v => v + '%', color:C.sleep, max:100, sfmt:v => Math.round(v) + '%'},
  time_in_bed: {t:'Time in bed', g:'sleep', kind:'float', get:d => bedM(d) != null && wakeM(d) != null ? [bedM(d), wakeM(d)] : null, labels:d => [clockS(hhmm(slp(d).start)), clockS(hhmm(slp(d).end))], color:C.sleep, stat:d => slp(d).hours_in_bed, sfmt:hm, h:220},
  efficiency: {t:'Sleep efficiency', g:'sleep', kind:'line', get:d => slp(d).efficiency, fmt:v => Math.round(v) + '%', color:C.sleep, sfmt:v => Math.round(v) + '%'},
  sleep_debt: {t:'Sleep debt', g:'sleep', kind:'bar', get:d => slp(d).need_breakdown ? slp(d).need_breakdown.debt : null, fmt:hm, color:'#d7dadd', sfmt:hm, desc:'The debt part of WHOOP\u2019s sleep need for that night: sleep you were short on recent nights.'},
  disturbances: {t:'Disturbances', g:'sleep', kind:'stack', get:d => { const s = slp(d), r = dph(s); if (r == null) return null; return r > BANDS.dph[1] ? [0, 0, s.disturbances] : r > BANDS.dph[0] ? [0, s.disturbances, 0] : [s.disturbances, 0, 0]; }, colors:['#5c6670', '#a8b0b6', '#ff9f0a'], legend:['Low', 'Medium', 'High (per hour asleep, ours)'], fmt:v => n0(v), stat:d => slp(d).disturbances, sfmt:v => n1(v),
    desc:'WHOOP\u2019s Sleep Stress isn\u2019t in its developer API. This stands in for it: the count of wake events, colored by events per hour asleep (low \u2264 1.2, medium \u2264 2.0, high above; our cut-offs).'},
  recovery: {t:'Recovery', g:'recovery', kind:'bar', get:d => rec(d).score, fmt:v => v + '%', color:recZoneC, max:100, sfmt:v => Math.round(v) + '%'},
  hrv: {t:'Heart rate variability', g:'recovery', kind:'line', get:d => rec(d).hrv, fmt:n0, color:C.violet, unit:'ms', sfmt:n0, metric:'hrv'},
  rhr: {t:'Resting heart rate', g:'recovery', kind:'line', get:d => rec(d).rhr, fmt:n0, color:'#ff5a68', unit:'bpm', sfmt:n0, metric:'rhr'},
  resp: {t:'Respiratory rate', g:'recovery', kind:'line', get:d => slp(d).respiratory_rate, fmt:n1, color:'#4fc3d9', unit:'rpm', sfmt:n1, metric:'resp'},
  spo2: {t:'Blood oxygen', g:'recovery', kind:'line', get:d => rec(d).spo2, fmt:n1, color:'#e8e8e8', unit:'%', sfmt:n1, metric:'spo2'},
  skin: {t:'Skin temperature', g:'recovery', kind:'line', get:d => fF(rec(d).skin_temp_c), fmt:n1, color:'#f2a65a', unit:'°F', sfmt:n1, metric:'skin'},
  rec_sleep: {t:'Sleep performance', g:'recovery', kind:'bar', get:d => slp(d).performance, fmt:v => v + '%', color:C.sleep, max:100, sfmt:v => Math.round(v) + '%'},
  strain: {t:'Strain', g:'strain', kind:'bar', get:d => cyc(d).strain, fmt:n1, color:C.strain, max:21, sfmt:n1},
  z13: {t:'HR zones 1–3', g:'strain', kind:'stack', get:d => zsegs(d, 1, 3), colors:ZC.slice(0, 3), legend:['Zone 1', 'Zone 2', 'Zone 3'], fmt:mfmt, stat:d => zsum(d, 1, 3), sfmt:mfmt, desc:'Minutes in zones 1–3 during recorded activities. WHOOP\u2019s API gives zones per workout, not all day, so walking you didn\u2019t log as an activity isn\u2019t counted.'},
  z45: {t:'HR zones 4–5', g:'strain', kind:'stack', get:d => zsegs(d, 4, 5), colors:ZC.slice(3), legend:['Zone 4', 'Zone 5'], fmt:mfmt, stat:d => zsum(d, 4, 5), sfmt:mfmt, desc:'Minutes in zones 4–5 (80%+ of max heart rate) during recorded activities.'},
  strength: {t:'Strength activity time', g:'strain', kind:'bar', get:strengthMin, fmt:mfmt, color:'#d7dadd', sfmt:mfmt, desc:'Duration of WHOOP weightlifting activities.'},
  calories: {t:'Calories burned', g:'strain', kind:'bar', get:d => cyc(d).kcal, fmt:v => n0(v), color:'#d7dadd', unit:'kcal', sfmt:n0, desc:'WHOOP\u2019s whole-day energy expenditure (kcal = kJ ÷ 4.184).'},
};
const chartOpts = (key, end, n, h) => { const c = CH_DEF[key]; return Object.assign({}, c, {days:daysEnd(end, n), sel:end, page:d => `${c.g}/${d}`, label:`${c.t}, ${n} days`, h:h || c.h}); };
function wTrendCard(key, end, n) {
  const c = CH_DEF[key], fn = c.stat || c.get, vals = daysEnd(end, n).map(fn).filter(v => v != null && !isNaN(v));
  const a = avg(vals);
  return `<div class="card tcard"><div class="ch tap" data-page="chart/${key}/${end}"${BTN} aria-label="${esc(c.t)}, open full chart"><h2>${c.t}</h2><div class="meta">${a != null ? `<span class="num">avg ${c.sfmt(a)}${c.unit ? ' ' + c.unit : ''}</span>` : ''}${chev}</div></div>${wchart(chartOpts(key, end, n))}</div>`;
}
function trendsSection(keys, end) {
  const n = +prange;
  return `${sec2(n === 7 ? 'Weekly trends' : `Trends · last ${PRANGES.find(p => p[0] === prange)[1]}`, 'tap a day to open it')}${rangeSeg()}${keys.map(k => wTrendCard(k, end, n)).join('')}`;
}
function pChart(key, end) {
  const c = CH_DEF[key]; if (!c) return null;
  if (!isDate(end)) end = TODAY;
  const n = +prange, fn = c.stat || c.get, vals = daysEnd(end, n).map(d => [d, fn(d)]).filter(x => x[1] != null && !isNaN(x[1]));
  const vs = vals.map(x => x[1]), a = avg(vs), u = c.unit ? ' ' + c.unit : '';
  let h = rangeSeg() + `<div class="card">${wchart(chartOpts(key, end, n, (c.h || 180) + 60))}</div>`;
  if (vs.length) {
    const mx = vals.reduce((p, x) => x[1] > p[1] ? x : p), mn = vals.reduce((p, x) => x[1] < p[1] ? x : p);
    h += card('Summary', `<dl class="kv"><dt>Average</dt><dd>${c.sfmt(a)}${u}</dd><dt>Highest</dt><dd>${c.sfmt(mx[1])}${u} · ${fShort(mx[0])}</dd><dt>Lowest</dt><dd>${c.sfmt(mn[1])}${u} · ${fShort(mn[0])}</dd><dt>Days with data</dt><dd>${vs.length} of ${n}</dd></dl>`);
  }
  if (c.desc) h += card('', `<div class="sub">${c.desc}</div>`);
  if (c.metric) h += `<button class="btn2" data-page="metric/${c.metric}/${end}">${ic('chart-line-up')} Baseline band & details</button>`;
  h += `<div class="caption pnote">Tap a column to open that day. Gaps are days without WHOOP data.</div>`;
  return {title:c.t, body:h};
}
/* ---------- pages: sleep ---------- */
function sleepScores(d) {
  const s = slp(d), hp = hvnPct(d), r = dph(s);
  return [['hours', 'moon', 'Hours vs. needed', hp, lvl(hp, BANDS.hvn), hp == null ? '–' : Math.round(hp) + '%'],
    ['consistency', 'clock', 'Sleep consistency', s.consistency, lvl(s.consistency, BANDS.cons), s.consistency == null ? '–' : s.consistency + '%'],
    ['efficiency', 'bed', 'Sleep efficiency', s.efficiency, lvl(s.efficiency, BANDS.eff), s.efficiency == null ? '–' : Math.round(s.efficiency) + '%'],
    ['disturbances', 'wave-sine', 'Disturbances', r, lvl(r, BANDS.dph, true), s.disturbances == null ? '–' : String(s.disturbances)]];
}
/* bedtime = wake − need ÷ typical efficiency, but never earlier than 8:30 PM */
function bedPlan() {
  const s = slp(TODAY), need = s.need_hours; if (!need) return null;
  const [wh, wm0] = (D.profile.wake_time || '07:00').split(':').map(Number), wm = wh * 60 + wm0 + 1440;
  const eff = (avg(prior(x => slp(x).efficiency, add(TODAY, 1), 30), 5) || 85) / 100;
  const ideal = wm - need * 60 / eff, cap = 20.5 * 60, bed = Math.max(ideal, cap), got = (wm - bed) * eff / 60;
  return {need, eff, wm, ideal, bed, capped:ideal < cap, got, nb:s.need_breakdown || {}};
}
/* minutes since 00:00 local on TODAY (so 1 AM the next morning reads 1500) */
function nowMinCT() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:TZ, hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(new Date()).map(x => [x.type, x.value]));
  return (ctToday() > TODAY ? 1440 : 0) + +p.hour * 60 + +p.minute;
}
function bedCoach(titleTxt = 'What to do tonight') {
  const b = bedPlan();
  if (!b) return card(titleTxt, '<div class="caption">Needs a scored sleep from WHOOP.</div>');
  const ck = m => clock(m).replace(' ', '\u00a0'), big = m => clock(m).replace(/ ([AP]M)$/, '<span class="unit">$1</span>');
  const debt = b.nb.debt || 0, now = nowMinCT(), late = now > b.bed && now < b.wm - 60;
  const bed = late ? Math.ceil(now / 5) * 5 + 10 : b.bed, got = Math.max(0, (b.wm - bed) * b.eff / 60), pct = Math.round(got / b.need * 100);
  const lead = late
    ? `It's past the ${ck(b.bed)} plan. In bed by <b>${ck(bed)}</b> still gets about <b>${hm(got)}</b> asleep before your ${ck(b.wm)} wake, ${pct}% of your <b>${hm(b.need)}</b> need.`
    : b.capped
      ? `Your full need tonight is <b>${hm(b.need)}</b>. Covering it would mean lights out at ${ck(b.ideal)}, so the plan caps bedtime at ${ck(b.bed)}: about <b>${hm(got)}</b> asleep at your ${Math.round(b.eff * 100)}% efficiency, ${pct}% of need.`
      : `In bed by <b>${ck(b.bed)}</b> covers your full <b>${hm(b.need)}</b> need at your ${Math.round(b.eff * 100)}% average efficiency.`;
  return card(titleTxt, `<div class="tonight"><div><div class="tn-ico">${ic('bed')}</div><div class="big num">${big(bed)}</div><div class="lbl2">In bed by</div></div>
    <div class="tn-dash"></div><div><div class="tn-ico">${ic('alarm')}</div><div class="big num">${big(b.wm)}</div><div class="lbl2">Wake</div></div></div>
    <div class="coach">${lead}${debt >= 0.25 ? ` <b>${hm(debt)}</b> of it is sleep debt, which comes off over several nights: 3–4 nights near this bedtime beat one long lie-in.` : ''}
    Keep the wake time steady and move bedtime earlier in 15–30 minute steps.</div>
    <div class="caption">Need from WHOOP: healthy minimum ${hm(b.nb.baseline)} + debt ${hm(b.nb.debt)} + strain ${hm(b.nb.strain)}${b.nb.nap ? ` − nap ${hm(Math.abs(b.nb.nap))}` : ''}. Wake time ${ck(b.wm)} from your profile.</div>`, {cls:'coachcard'});
}
function lastNight(d) {
  const s = slp(d), st = s.stages || {}, a = avgPrior(x => slp(x).hours_asleep, d);
  const inBed = s.hours_in_bed || (st.light || 0) + (st.deep || 0) + (st.rem || 0) + (st.awake || 0) || 1;
  const rows = [['awake', 'Awake'], ['light', 'Light'], ['deep', 'SWS (deep)'], ['rem', 'REM']];
  let h = `<div class="kpi"><div><div class="caption caps">Hours of sleep</div><span class="big num">${hm(s.hours_asleep)}</span>${arrow(s.hours_asleep, a, true, 0.08)}</div><div class="kpi-r caption num">${a != null ? `${hm(a)}<br>30-day avg` : ''}</div></div>`;
  h += `<div class="tl" role="img" aria-label="Stage totals, ${fTime(s.start)} to ${fTime(s.end)}"><div class="tlbar">${rows.map(([k]) => st[k] ? `<span style="flex:${st[k]};background:${STC[k]}"></span>` : '').join('')}</div><div class="row caption"><span>${fTime(s.start)}</span><span>${fTime(s.end)}</span></div></div>
    <div class="caption">Stage totals, not a timeline. WHOOP's API reports how long you spent in each stage but not when, and it has no overnight heart-rate trace.</div>`;
  h += `<div class="hr"></div><div class="row caption caps"><span><i class="tyk"></i>Typical range · prior 30 days</span><span>In bed <b class="num" style="color:var(--txt)">${hm(inBed)}</b></span></div>`;
  for (const [k, l] of rows) {
    const v = st[k], ps = prior(x => (slp(x).stages || {})[k], d), ok = ps.length >= 7, lo = ok ? pctl(ps, 0.25) : null, hi = ok ? pctl(ps, 0.75) : null;
    const inR = ok && v != null ? (v < lo ? 'below typical' : v > hi ? 'above typical' : 'typical') : '';
    h += `<div class="stg"><div class="row"><span><b class="caps">${l}</b> <span class="num" style="color:${STC[k]}">${v != null ? Math.round(v / inBed * 100) : '–'}%</span>${inR ? ` <span class="caption">${inR}</span>` : ''}</span><b class="num">${hm(v)}</b></div>
      <div class="stgbar"><span style="width:${Math.min(100, (v || 0) / inBed * 100).toFixed(1)}%;background:${STC[k]}"></span>${ok ? `<i class="typ" style="left:${Math.min(98, lo / inBed * 100).toFixed(1)}%;width:${Math.max(1.5, (hi - lo) / inBed * 100).toFixed(1)}%" title="typical ${hm(lo)}–${hm(hi)}"></i>` : ''}</div>
      ${ok ? `<div class="caption num">typical ${hm(lo)}–${hm(hi)}</div>` : ''}</div>`;
  }
  const rest = restor(d), ra = avgPrior(restor, d);
  h += `<div class="hr"></div><div class="row"><span class="caps2"><span class="rsq"><i style="background:${STC.deep}"></i><i style="background:${STC.rem}"></i></span>Restorative sleep<br><small class="caption">SWS + REM</small></span><span class="num" style="text-align:right"><span class="vtop">${arrow(rest, ra, true, 0.08)}<b class="big2">${hm(rest)}</b></span><br><small class="caption">${ra != null ? hm(ra) + ' avg' : ''}</small></span></div>`;
  return card('', h);
}
function hvnCard(d, sub) {
  const s = slp(d), nb = s.need_breakdown || {}, need = s.need_hours, p = hvnPct(d), a = avgPrior(hvnPct, d);
  if (!need) return '';
  const segs = [['baseline', 'Healthy minimum', '#59626b'], ['strain', 'Recent strain', C.strain], ['debt', 'Sleep debt', '#d7dadd']];
  const gross = (nb.baseline || 0) + (nb.strain || 0) + (nb.debt || 0), tot = Math.max(gross, need, s.hours_asleep || 0) || 1;
  const h = `<div class="kpi"><div><span class="big num">${Math.round(p)}%</span>${arrow(p, a, true, 1)}</div><div class="kpi-r caption num">${a != null ? `${Math.round(a)}%<br>30-day avg` : ''}</div></div>
    <div class="hvn"><div class="row caption caps"><span>Hours of sleep</span><b class="num">${hm(s.hours_asleep)}</b></div><div class="hbar"><span style="width:${((s.hours_asleep || 0) / tot * 100).toFixed(1)}%;background:${C.sleep}"></span></div>
    <div class="hbar">${segs.map(([k, , c]) => nb[k] > 0 ? `<span style="width:${(nb[k] / tot * 100).toFixed(1)}%;background:${c}"></span>` : '').join('')}</div><div class="row caption caps"><span>Sleep needed</span><b class="num">${hm(need)}</b></div></div>
    <div class="brk">${segs.map(([k, l, c]) => `<div class="row"><span><i style="background:${c}"></i>${l}</span><b class="num">${k === 'baseline' ? '' : '+'}${hm(nb[k] || 0)}</b></div>`).join('')}${nb.nap ? `<div class="row"><span><i style="background:${C.green}"></i>Nap credit</span><b class="num">−${hm(nb.nap)}</b></div>` : ''}</div>`;
  return card('Hours vs. needed', h, {meta:sub ? '' : infoBtn(`sleep/${d}/hours`, 'hours vs. needed')});
}
function consCard(d, sub) {
  const s = slp(d), a = avgPrior(x => slp(x).consistency, d), days = daysEnd(d, 7);
  const lines = [days.map(x => median(prior(bedM, x, 14))), days.map(x => median(prior(wakeM, x, 14)))];
  return card('Sleep consistency', `<div class="kpi"><div><span class="big num">${s.consistency ?? '–'}%</span>${arrow(s.consistency, a, true, 1)}</div><div class="kpi-r caption num">${a != null ? `${Math.round(a)}%<br>30-day avg` : ''}</div></div>
    ${wchart(Object.assign({}, CH_DEF.time_in_bed, {days, sel:d, lines, page:x => 'sleep/' + x, label:'Bed and wake times, 7 days', h:230}))}
    <div class="legend"><span><i style="background:${C.sleep}"></i>In bed</span><span><i class="dash"></i>Your usual bed / wake (14-day median)</span></div>
    <div class="caption">WHOOP's consistency compares your timing with the previous four nights. Its "optimal" bed and wake lines come from a model the API doesn't expose, so the dashed lines here are your own 14-day medians.</div>`, {meta:sub ? '' : infoBtn(`sleep/${d}/consistency`, 'consistency')});
}
function effCard(d, sub) {
  const s = slp(d), st = s.stages || {}, a = avgPrior(x => slp(x).efficiency, d), ib = s.hours_in_bed || 1, awake = st.awake ?? (ib - (s.hours_asleep || 0));
  return card('Sleep efficiency', `<div class="kpi"><div><span class="big num">${n0(s.efficiency)}%</span>${arrow(s.efficiency, a, true, 1)}</div><div class="kpi-r caption num">${a != null ? `${Math.round(a)}%<br>30-day avg` : ''}</div></div>
    <div class="effbar"><span style="flex:${s.hours_asleep || 0};background:${C.sleep}"></span><span style="flex:${Math.max(0, awake)};background:${STC.awake}"></span></div>
    <div class="brk"><div class="row"><span><i style="background:${C.sleep}"></i>Asleep</span><b class="num">${hm(s.hours_asleep)}</b></div><div class="row"><span><i style="background:${STC.awake}"></i>Awake in bed</span><b class="num">${hm(awake)}</b></div>
    <div class="row"><span><i style="background:transparent"></i>Disturbances</span><b class="num">${s.disturbances ?? '–'}</b></div><div class="row"><span><i style="background:transparent"></i>Sleep cycles</span><b class="num">${s.cycles ?? '–'}</b></div></div>`, {meta:sub ? '' : infoBtn(`sleep/${d}/efficiency`, 'efficiency')});
}
function distCard(d, sub) {
  const s = slp(d), r = dph(s), a = avgPrior(x => slp(x).disturbances, d), ra = avgPrior(x => dph(slp(x)), d);
  return card('Disturbances', `<div class="kpi"><div><span class="big num">${s.disturbances ?? '–'}</span>${arrow(s.disturbances, a, false, 0.5)}</div><div class="kpi-r caption num">${a != null ? `${n1(a)}<br>30-day avg` : ''}</div></div>
    <dl class="kv"><dt>Per hour asleep</dt><dd>${n1(r)}${ra != null ? ` · avg ${n1(ra)}` : ''}</dd><dt>Level (ours)</dt><dd>${r == null ? '–' : r > BANDS.dph[1] ? 'High' : r > BANDS.dph[0] ? 'Medium' : 'Low'}</dd><dt>Respiratory rate</dt><dd>${n1(s.respiratory_rate)} rpm</dd><dt>Sleep cycles</dt><dd>${s.cycles ?? '–'}</dd></dl>
    <div class="caption">WHOOP's Sleep Stress score isn't available from its developer API. Wake events per hour are the closest honest stand-in.</div>`, {meta:sub ? '' : infoBtn(`sleep/${d}/disturbances`, 'disturbances')});
}
const SLEEP_TRENDS = ['sleep_perf', 'hvn_hours', 'hvn_pct', 'restorative', 'consistency', 'time_in_bed', 'efficiency', 'sleep_debt', 'disturbances'];
function pSleep(d) {
  const s = slp(d);
  if (s.performance == null && s.hours_asleep == null) return {title:ttl(d), body:empty('No scored sleep for this day.'), info:'info/sleep'};
  let h = bigRing((s.performance || 0) / 100, C.sleep, s.performance != null ? `${s.performance}<span class="bpc">%</span>` : '–', 'Sleep performance', seg3(lvl(s.performance, BANDS.perf)));
  h += `<div class="pop">${sleepScores(d).map(([k, i, l, , lv, txt]) => `<div class="vrow tap" data-page="sleep/${d}/${k}"${BTN}><span class="vi">${ic(i)}</span><span class="vl">${l}</span>${seg3(lv)}<b class="num vv1">${txt}</b>${chev}</div>`).join('')}${legend3()}</div>`;
  if (d === TODAY) h += bedCoach();
  h += sec2("Last night's sleep", `${dayLabel(d)} vs. prior 30 days`) + lastNight(d);
  h += hvnCard(d) + consCard(d) + effCard(d) + distCard(d);
  h += trendsSection(SLEEP_TRENDS, d);
  return {title:ttl(d), body:h, info:'info/sleep'};
}
/* ---------- pages: sleep sub-scores + explanations ---------- */
const SUB_INFO = {
  hours: {t:'Hours vs. needed', card:hvnCard, trends:['hvn_hours', 'hvn_pct', 'sleep_debt'], bands:'Poor under 70%, sufficient 70–84%, optimal 85%+ (WHOOP\u2019s sleep performance tiers).',
    what:'How much you slept compared with what WHOOP says you needed that night. Need = a healthy baseline, plus extra for recent strain, plus sleep debt from recent short nights, minus any nap credit.',
    tips:['Debt comes off over several nights: aim for 3–4 nights near the recommended bedtime.', 'Hard training days raise the strain part of tomorrow\u2019s need.', 'A 20–30 minute early-afternoon nap counts as nap credit.']},
  consistency: {t:'Sleep consistency', card:consCard, trends:['consistency', 'time_in_bed'], bands:'Poor under 70%, sufficient 70–79%, optimal 80%+ (ours).',
    what:'How closely your bed and wake times match the previous few nights. Regular timing keeps your body clock stable, which helps both how fast you fall asleep and how well you recover.',
    tips:['Keep the wake time fixed, weekends included.', 'Move bedtime in 15–30 minute steps rather than big jumps.', 'Morning light soon after waking anchors the body clock.']},
  efficiency: {t:'Sleep efficiency', card:effCard, trends:['efficiency'], bands:'Poor under 80%, sufficient 80–89%, optimal 90%+ (ours).',
    what:'The share of your time in bed that you were actually asleep. Long stretches awake in bed lower it.',
    tips:['Go to bed when sleepy rather than early and wide awake.', 'Keep the room cool, dark and quiet; no screens in bed.', 'Late caffeine, alcohol and big late meals fragment sleep.']},
  disturbances: {t:'Disturbances', card:distCard, trends:['disturbances'], bands:'Per hour asleep: low \u2264 1.2, medium \u2264 2.0, high above (ours).',
    what:'Wake events during the night, from WHOOP. Its Sleep Stress score isn\u2019t in the developer API, so this page uses disturbances per hour asleep instead and says so.',
    tips:['Alcohol is the most common cause of a fragmented second half of the night.', 'A cooler room and earlier last meal tend to reduce wake-ups.']},
};
function pSleepSub(d, k) {
  const m = SUB_INFO[k]; if (!m) return pSleep(d);
  const sc = sleepScores(d).find(x => x[0] === k);
  let h = `<div class="subhead"><div class="caption caps">${dayLabel(d)}</div>${seg3(sc[4])}<div class="caption">${sc[4] < 0 ? 'No data' : LVL[sc[4]]}</div></div>`;
  h += m.card(d, true);
  h += card('What it is', `<div class="sub">${m.what}</div><div class="caption" style="margin-top:10px">${m.bands}</div>`);
  h += card('How to improve it', `<ul class="tips">${m.tips.map(x => `<li>${x}</li>`).join('')}</ul>`);
  h += trendsSection(m.trends, d);
  return {title:m.t, body:h, info:'info/sleep'};
}
const INFO = {
  sleep: ['About sleep', `<p>Sleep performance is WHOOP's score for last night: mostly how much you slept compared with what you needed, plus consistency, efficiency and sleep stress. It's read from WHOOP's developer API.</p>
    <p>The 3-step bars (Poor / Sufficient / Optimal) use WHOOP's performance tiers for hours vs. needed (under 70%, 70–84%, 85%+). The consistency, efficiency and disturbance cut-offs are this app's, because WHOOP doesn't publish them.</p>
    <p>Not available from the API, so not shown: the stage-by-stage timeline, the overnight heart-rate trace and the Sleep Stress score. Disturbances per hour stand in for sleep stress, labeled as such.</p>
    <p>The bedtime plan is wake time minus need, divided by your 30-day efficiency, and it never suggests earlier than 8:30 PM.</p>`],
  recovery: ['About recovery', `<p>Recovery (0–100%) is WHOOP's morning score of how ready your body is. It's driven mostly by heart rate variability, then resting heart rate, sleep and respiratory rate. Green is 67%+, yellow 34–66%, red under 34%.</p>
    <p>Arrows compare today with your previous 30 days. For HRV, up is better; for resting heart rate, down is better. Respiratory rate, blood oxygen and skin temperature are neutral, and only unusual swings matter.</p>
    <p>Behavior insights compare next-morning recovery after days with and without each journal behavior. They're associations from your own data, not causes.</p>`],
  strain: ['About strain', `<p>Strain (0–21) is WHOOP's measure of cardiovascular load for the day. It's logarithmic, so going from 18 to 19 takes far more work than going from 8 to 9.</p>
    <p>The target band on the ring is this app's heuristic, not WHOOP's Strain Coach: 14–18 on green recovery, 10–14 on yellow and 6–10 on red.</p>
    <p>Heart-rate zone time comes from recorded activities only, because the API gives zones per workout rather than all day. Steps aren't in WHOOP's API, so they aren't shown. Calories are WHOOP's whole-day estimate (kcal = kJ ÷ 4.184).</p>`],
};
function pInfo(k) { const m = INFO[k]; if (!m) return null; return {title:m[0], body:card('', `<div class="md">${m[1]}</div>`)}; }
/* ---------- pages: recovery ---------- */
function behaviorStats() {
  const days = [...new Set(Object.keys(W).concat(Object.keys(D.journal), Object.keys(D.supplement_log)))], out = [];
  for (const [name, f, src] of behaviors()) {
    const yes = [], no = [];
    for (const d of days) { const b = f(d), nx = rec(add(d, 1)).score; if (b == null || nx == null) continue; (b ? yes : no).push(nx); }
    if (yes.length < 3 || no.length < 3) continue;
    const ay = avg(yes), an = avg(no), df = ay - an, se = Math.sqrt(sdev(yes) ** 2 / yes.length + sdev(no) ** 2 / no.length);
    out.push({name, f, src, ay, an, df, ny:yes.length, nn:no.length, flag:Math.min(yes.length, no.length) < 10 ? 'early' : Math.abs(df) < 2 * se ? 'within noise' : ''});
  }
  return out;
}
/* chips: behaviors you did the day before, with how next-day recovery has tended to move after them */
function chipsFor(d) { const y = add(d, -1); return behaviorStats().filter(b => b.f(y) === true).sort((a, b) => Math.abs(b.df) - Math.abs(a.df)); }
const chip = b => `<span class="bchip"><span class="arr ${b.df >= 0 ? 'good' : 'bad'}">${b.df >= 0 ? '▲' : '▼'}</span>${esc(b.name)}</span>`;
function chipsCard(d) {
  const cs = chipsFor(d);
  const body = cs.length ? `<div class="bchips">${cs.slice(0, 2).map(chip).join('')}${cs.length > 2 ? `<button class="bchip more" data-page="insights/${d}">+${cs.length - 2} more</button>` : ''}</div>`
    : `<div class="caption">No insights for ${dayLabel(add(d, -1)).toLowerCase() === 'yesterday' ? 'yesterday' : fShort(add(d, -1))} yet. A behavior appears once there are 3+ days with it and 3+ without, and you did it the day before.</div>`;
  return card('Behavior insights', body + '<div class="caption" style="margin-top:10px">Based on what you did the day before. Arrows show how your next-morning recovery has tended to move after it: associations from your data, not causes.</div>', {meta:`<button class="ibtn" data-page="insights/${d}" aria-label="All behavior insights">${chev}</button>`});
}
function pInsights(d) {
  const cs = chipsFor(d), all = behaviorStats();
  let h = cs.length ? card(`After ${dayLabel(add(d, -1)).toLowerCase()}`, `<div class="list">${cs.map(b => li(`<span class="arr ${b.df >= 0 ? 'good' : 'bad'}">${b.df >= 0 ? '▲' : '▼'}</span>`, esc(b.name), `${Math.round(b.ay)}% after vs ${Math.round(b.an)}% without · ${b.ny} yes / ${b.nn} no${b.flag ? ' · ' + b.flag : ''}`, `<span style="color:${b.df >= 0 ? C.green : C.orange}">${b.df >= 0 ? '+' : '−'}${Math.abs(Math.round(b.df))}</span><small>pts</small>`, '', true)).join('')}</div>`) : empty('No behaviors from the day before have enough data yet.');
  h += sec2('All behaviors', 'next-day recovery') + insightsCard();
  return {title:'Behavior insights', body:h + (all.length ? '' : '')};
}
const REC_ROWS = [['hrv', 'wave-sine', 'Heart rate variability', true, 2], ['rhr', 'heart', 'Resting heart rate', false, 1], ['resp', 'wind', 'Respiratory rate', null, 0.3]];
function recContrib(d) {
  const y = add(d, -1), r = rec(d), ry = rec(y);
  if (r.score == null || ry.score == null) return '';
  const rows = [['HRV', r.hrv, ry.hrv, true, n0, 'ms'], ['Resting HR', r.rhr, ry.rhr, false, n0, 'bpm'], ['Sleep performance', slp(d).performance, slp(y).performance, true, n0, '%'],
    ['Respiratory rate', slp(d).respiratory_rate, slp(y).respiratory_rate, null, n1, 'rpm'], ["Prior day's strain", cyc(y).strain, cyc(add(y, -1)).strain, false, n1, '']];
  const dd = r.score - ry.score;
  return card('What changed since yesterday', `<div class="sub" style="margin-bottom:10px">Recovery <b style="color:${recColor(r.score)}">${r.score}%</b>, ${dd === 0 ? 'same as' : `${dd > 0 ? 'up' : 'down'} ${Math.abs(dd)} from`} yesterday's <b style="color:${recColor(ry.score)}">${ry.score}%</b>.</div>
    <div class="ctab"><span class="caps caption">Input</span><span class="caps caption">Yday</span><span class="caps caption">Today</span><span></span>${rows.map(([l, v, p, gu, f, u]) => `<span>${l}</span><span class="num dim">${f(p)}</span><span class="num"><b>${f(v)}</b> <small class="caption">${u}</small></span>${arrow(v, p, gu, 0)}`).join('')}</div>
    <div class="caption" style="margin-top:10px">WHOOP doesn't publish its recovery formula. HRV carries the most weight, then resting heart rate, sleep and respiratory rate. A hard day before usually lowers the next morning's score.</div>`);
}
function pRecovery(d) {
  const r = rec(d), s = slp(d);
  if (r.score == null) return {title:ttl(d), body:empty('No recovery score for this day.'), info:'info/recovery'};
  const zi = r.score >= 67 ? 2 : r.score >= 34 ? 1 : 0;
  let h = bigRing(r.score / 100, recColor(r.score), `${r.score}<span class="bpc">%</span>`, 'Recovery', seg3(zi, ZONEC, ['Red', 'Yellow', 'Green']));
  if (r.calibrating) h += '<div class="caption" style="text-align:center">WHOOP is still calibrating this score.</div>';
  const rows = REC_ROWS.map(([k, icn, l, gu, tol]) => { const m = MON.find(x => x[0] === k), fn = m[3], v = fn(d), a = avgPrior(fn, d), f = m[4] ? n1 : n0;
    return vrow(icn, l, `${f(v)}<small> ${m[2]}</small>`, a != null ? `${f(a)} ${m[2]}` : '', arrow(v, a, gu, tol), `metric/${k}/${d}`); });
  const sa = avgPrior(x => slp(x).performance, d);
  rows.push(vrow('moon', 'Sleep performance', `${s.performance ?? '–'}<small>%</small>`, sa != null ? Math.round(sa) + '%' : '', arrow(s.performance, sa, true, 1), `sleep/${d}`));
  for (const k of ['spo2', 'skin']) { const m = MON.find(x => x[0] === k), v = m[3](d), a = avgPrior(m[3], d); rows.push(vrow(k === 'spo2' ? 'drop-half-bottom' : 'thermometer-simple', m[1], `${n1(v)}<small> ${m[2]}</small>`, a != null ? `${n1(a)} ${m[2]}` : '', arrow(v, a, null, m[5] / 3), `metric/${k}/${d}`)); }
  h += `<div class="pop">${vlegend}${rows.join('')}</div>`;
  h += chipsCard(d) + recContrib(d);
  h += trendsSection(['recovery', 'hrv', 'rhr', 'resp', 'rec_sleep'], d);
  return {title:ttl(d), body:h, info:'info/recovery'};
}
const METRIC_INFO = {
  hrv: 'Heart rate variability (RMSSD) measured during your last sleep. Higher than your normal usually means you are well recovered. It falls after hard training, alcohol, late meals, illness and stress.',
  rhr: 'Resting heart rate measured during sleep. A few beats above your normal often means incomplete recovery, heat, alcohol or an oncoming illness.',
  resp: 'Breaths per minute during sleep. It\u2019s very stable night to night, so a jump of 1+ rpm above your normal is worth noticing (illness is a common cause).',
  spo2: 'Blood oxygen saturation during sleep. Healthy values sit around 95–100%; isolated lower readings are often fit or position related.',
  skin: 'Skin temperature during sleep vs. your own normal. Rises often go with illness, heat or alcohol. WHOOP reports °C; shown here in °F.',
};
function pMetric(k, d) {
  const m = MON.find(x => x[0] === k); if (!m) return null;
  if (!isDate(d)) d = TODAY;
  const [, l, u, fn, dec, fl] = m, f = dec ? n1 : n0, v = fn(d), b = band(fn, d, fl), n = +prange, key = k === 'skin' ? 'skin' : k;
  const vals = daysEnd(d, n).map(x => [x, fn(x)]).filter(x => x[1] != null);
  let h = `<div class="mhead"><div class="caption caps">${dayLabel(d)}</div><div class="huge num">${f(v)}<span class="unit">${u}</span></div>
    <div class="sub">${b ? `30-day baseline ${f(b.m)} ${u} · normal ${f(b.lo)}–${f(b.hi)}` : 'Baseline needs 7+ days'}</div>
    ${b && v != null ? `<span class="pill" style="color:${v >= b.lo && v <= b.hi ? C.green : C.yellow}"><i></i>${v >= b.lo && v <= b.hi ? 'Within your normal range' : v > b.hi ? 'Above your normal range' : 'Below your normal range'}</span>` : ''}</div>`;
  h += rangeSeg() + `<div class="card">${wchart(Object.assign({}, CH_DEF[key], {days:daysEnd(d, n), sel:d, band:b, page:x => 'recovery/' + x, h:220, label:`${l}, ${n} days`}))}<div class="caption">Shaded: your normal range as of ${dayLabel(d).toLowerCase() === 'today' ? 'today' : fShort(d)}, the prior 30-day mean ± 1.5 SD (with a small minimum width). Dashed: the mean.</div></div>`;
  if (vals.length) { const vs = vals.map(x => x[1]), out = b ? vs.filter(x => x < b.lo || x > b.hi).length : null;
    h += card('This range', `<dl class="kv"><dt>Average</dt><dd>${f(avg(vs))} ${u}</dd><dt>Lowest</dt><dd>${f(Math.min(...vs))} ${u}</dd><dt>Highest</dt><dd>${f(Math.max(...vs))} ${u}</dd>${out != null ? `<dt>Outside today's band</dt><dd>${out} of ${vs.length} days</dd>` : ''}</dl>`); }
  h += card('About', `<div class="sub">${METRIC_INFO[k]}</div>`);
  return {title:l, body:h, info:'info/recovery'};
}
/* ---------- pages: strain + workouts ---------- */
const strainTarget = s => s == null ? [10, 14] : s >= 67 ? [14, 18] : s >= 34 ? [10, 14] : [6, 10];
const SPORT_IC = {weightlifting:'barbell', weightlifting_msk:'barbell', powerlifting:'barbell', 'functional-fitness':'barbell', crossfit:'barbell', running:'person-simple-run', rucking:'person-simple-walk',
  walking:'person-simple-walk', hiking:'person-simple-walk', stairmaster:'person-simple-walk', cycling:'bicycle', spin:'bicycle', sauna:'thermometer-hot', activity:'person-arms-spread', hiit:'lightning', yoga:'flower-lotus', meditation:'flower-lotus'};
/* WHOOP strength activities on a day, matched in order to that day's logged lift sessions */
const strengthIdx = d => (wd(d).workouts || []).map((w, i) => [w, i]).filter(([w]) => STRENGTH.has(w.sport)).map(x => x[1]);
const liftForWorkout = (d, i) => { const k = strengthIdx(d).indexOf(i); return k >= 0 ? (LIFTS[d] || [])[k] || null : null; };
const workoutForLift = (d, li) => { const i = strengthIdx(d)[li]; return i == null ? null : i; };
function actRow(d, w, i) {
  const lift = liftForWorkout(d, i);
  return `<div class="act tap" data-page="workout/${d}/${i}"${BTN}><span class="actb">${ic(SPORT_IC[w.sport] || 'person-arms-spread')}<b class="num">${w.strain != null ? n1(w.strain) : '–'}</b></span>
    <span class="actn"><b>${esc(title(w.sport))}</b><small>${lift ? `${esc(lift.type)} log · ${exCount(lift.exercises)}` : w.kcal != null ? n0(w.kcal) + ' kcal' : ''}</small></span><span class="actt num">${fTime(w.start)}<br>${fTime(w.end)}</span>${chev}</div>`;
}
function strainCoach(d) {
  const c = cyc(d), r = rec(d), [lo, hi] = strainTarget(r.score);
  if (c.strain == null) return '';
  const msg = c.strain < lo ? `You're at <b>${n1(c.strain)}</b>, under today's balanced range of <b>${lo}–${hi}</b> for a ${r.score ?? '–'}% recovery. ${d === TODAY ? 'There\u2019s room for a session if you feel good.' : 'A lighter day.'}`
    : c.strain <= hi ? `<b>${n1(c.strain)}</b> is inside the balanced range of <b>${lo}–${hi}</b> for a ${r.score ?? '–'}% recovery. Training load and recovery are in step.`
    : `<b>${n1(c.strain)}</b> is over the balanced range of <b>${lo}–${hi}</b> for a ${r.score ?? '–'}% recovery. ${d === TODAY ? 'Prioritize recovery: wind down early tonight and keep the rest of the day easy.' : 'Expect a lower recovery the next morning.'}`;
  return card('Balanced strain', `<div class="coach">${msg}</div><div class="caption">The range is this app's heuristic (green 14–18, yellow 10–14, red 6–10), not WHOOP's Strain Coach.</div>`, {cls:'coachcard'});
}
function pStrain(d) {
  const c = cyc(d), r = rec(d), tb = strainTarget(r.score), ww = wd(d).workouts || [];
  if (c.strain == null && !ww.length) return {title:ttl(d), body:empty('No strain data for this day.'), info:'info/strain'};
  let h = bigRing((c.strain || 0) / 21, C.strain, n1(c.strain), 'Strain', `<div class="caption num">target ${tb[0]}–${tb[1]}</div>`, [tb[0] / 21, tb[1] / 21]);
  const rows = [['heartbeat', 'HR zones 1–3', zsum(d, 1, 3), d2 => zsum(d2, 1, 3), true, 'z13'], ['lightning', 'HR zones 4–5', zsum(d, 4, 5), d2 => zsum(d2, 4, 5), true, 'z45'], ['barbell', 'Strength activity time', strengthMin(d), strengthMin, true, 'strength']];
  h += `<div class="pop">${vlegend}${rows.map(([icn, l, v, fn, gu, key]) => { const a = avgPrior(fn, d); return vrow(icn, l, mfmt(v), a != null ? mfmt(a) : '', arrow(v, a, gu, 2), `chart/${key}/${d}`); }).join('')}
    ${(() => { const a = avgPrior(x => cyc(x).kcal, d); return vrow('flame', 'Calories', `${n0(c.kcal)}<small> kcal</small>`, a != null ? n0(a) + ' kcal' : '', arrow(c.kcal, a, null, 50), `chart/calories/${d}`); })()}
    <div class="caption" style="margin-top:8px">Zone and strength time come from recorded activities. Steps aren't in WHOOP's API, so they aren't shown.</div></div>`;
  h += strainCoach(d);
  h += sec2(d === TODAY ? "Today's activities" : 'Activities', ww.length ? `${ww.length} recorded` : '') + (ww.length ? card('', `<div class="acts">${ww.map((w, i) => actRow(d, w, i)).join('')}</div>`) : empty('No activities recorded.'));
  const kj = c.kj ?? (c.kcal != null ? c.kcal * 4.184 : null), act = ww.reduce((t, w) => t + (w.kcal || 0), 0);
  h += card('Calories', `<div class="grid2">${tile('Whole day', n0(c.kcal), 'kcal')}${tile('Activities', n0(act), 'kcal')}</div><div class="caption" style="margin-top:10px">${n0(kj)} kJ${c.kj == null ? ' (from kcal × 4.184)' : ' from WHOOP'} · avg HR ${n0(c.avg_hr)} · max ${n0(c.max_hr)} bpm</div>`);
  h += card('Strain & recovery', srChart(d, x => 'strain/' + x), {meta:'7 days'});
  h += trendsSection(['strain', 'z13', 'z45', 'strength', 'calories'], d);
  return {title:ttl(d), body:h, info:'info/strain'};
}
const ZONE_RNG = ['< 50%', '50–60%', '60–70%', '70–80%', '80–90%', '90–100%'], ZONE_ALL = ['#5c6670'].concat(ZC);
function pWorkout(d, i) {
  const w = (wd(d).workouts || [])[i]; if (!w) return {title:'Activity', body:empty('Activity not found.')};
  const dur = durMin(w), mx = (D.wear.profile || {}).max_heart_rate, kj = w.kj ?? (w.kcal != null ? w.kcal * 4.184 : null), lift = liftForWorkout(d, i);
  let h = `<div class="wkhead"><span class="actb lg">${ic(SPORT_IC[w.sport] || 'person-arms-spread')}<b class="num">${w.strain != null ? n1(w.strain) : '–'}</b></span><div><div class="lt2">${esc(title(w.sport))}</div><div class="sub">${fMed(d)} · ${fTime(w.start)} – ${fTime(w.end)}</div></div></div>`;
  h += `<div class="grid3 wtiles">${tile('Duration', hm(dur / 60))}${tile('Strain', w.strain != null ? n1(w.strain) : '–', '', C.strain)}${tile('Calories', n0(w.kcal), 'kcal')}${tile('Avg HR', n0(w.avg_hr), 'bpm')}${tile('Max HR', n0(w.max_hr), 'bpm')}${tile('Energy', n0(kj), w.kj == null ? 'kJ est' : 'kJ')}
    ${w.distance_m ? tile('Distance', (w.distance_m / 1609.34).toFixed(2), 'mi') : ''}${w.altitude_gain_m ? tile('Climb', n0(w.altitude_gain_m * 3.281), 'ft') : ''}${mx && w.avg_hr ? tile('Avg % max', Math.round(w.avg_hr / mx * 100), '%') : ''}</div>`;
  if (w.zones_min) {
    const tot = w.zones_min.reduce((a, b) => a + (b || 0), 0) || 1, top = Math.max(...w.zones_min);
    h += card('Heart rate zones', `<div class="zrows">${w.zones_min.map((m, z) => `<div class="zr"><span class="zl"><b>Zone ${z}</b><small>${ZONE_RNG[z]}</small></span><span class="zb"><span style="width:${((m || 0) / (top || 1) * 100).toFixed(1)}%;background:${ZONE_ALL[z]}"></span></span><span class="zv num"><b>${Math.round((m || 0) / tot * 100)}%</b><small>${mfmt(m || 0)}</small></span></div>`).join('')}</div>
      <div class="caption">Zones are % of max heart rate${mx ? ` (${mx} bpm in WHOOP)` : ''}.${w.percent_recorded != null && w.percent_recorded < 1 ? ` ${Math.round(w.percent_recorded * 100)}% of this activity had heart-rate data.` : ''}</div>`);
  }
  if (lift) { const li = (LIFTS[d] || []).indexOf(lift); h += card(`${esc(lift.type)} log`, exGrid(lift.exercises, lift) + `<div class="sharerow">${shareBtn(d, li)}</div><button class="btn2" data-page="session/${d}/${li}">${ic('barbell')} Session & progression</button>`, {meta:exSummary(lift)}); }
  h += `<button class="btn2" data-page="strain/${d}">${ic('lightning')} Day strain</button>`;
  return {title:title(w.sport), body:h, info:'info/strain'};
}
/* ---------- pages: session, day, meals, Coach Age component ---------- */
function spark(vals, color = C.acc) {
  const v = vals.filter(x => x != null); if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), W2 = 90, H2 = 26, X = i => 3 + i * (W2 - 6) / (vals.length - 1), Y = x => hi === lo ? H2 / 2 : 3 + (hi - x) / (hi - lo) * (H2 - 6);
  return `<svg class="spark" viewBox="0 0 ${W2} ${H2}" aria-hidden="true"><path d="M${vals.map((x, i) => `${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(' L')}" fill="none" stroke="${color}" stroke-width="1.6"/><circle cx="${X(vals.length - 1).toFixed(1)}" cy="${Y(vals[vals.length - 1]).toFixed(1)}" r="2.6" fill="${color}"/></svg>`;
}
function pSession(d, li) {
  const l = (LIFTS[d] || [])[li]; if (!l) return {title:'Session', body:empty('Session not found.')};
  const wi = workoutForLift(d, li), w = wi != null ? wd(d).workouts[wi] : null;
  let h = `<div class="wkhead"><span class="actb lg">${ic('barbell')}<b class="num">${w && w.strain != null ? n1(w.strain) : '–'}</b></span><div><div class="lt2" style="color:${TYPE_C[l.type] || C.acc}">${esc(l.type)}</div><div class="sub">${fLong(d)} · ${exSummary(l)}</div>${l.sauna != null ? `<div style="margin-top:6px">${saunaTag(l)}</div>` : ''}</div></div>`;
  const rows = l.exercises.map(x => {
    if (x.text) return `<div class="exr"><div class="exn"><div class="sub">${esc(x.name)}</div></div></div>`;
    const hist = []; for (const s of D.workouts) if (s.date <= d) for (const e of s.exercises) if (x.key && e.key === x.key && e.weight != null) hist.push({d:s.date, e});
    hist.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
    const before = hist.filter(h2 => h2.d < d), prev = before[before.length - 1], best = before.length ? Math.max(...before.map(h2 => h2.e.weight)) : null;
    const dW = prev && x.weight != null ? x.weight - prev.e.weight : null, pr = best != null && x.weight != null && x.weight > best;
    const sub = prev ? `${dW > 0 ? `<span style="color:${C.green}">+${+dW.toFixed(1)} ${x.unit || U}</span>` : dW < 0 ? `<span style="color:${C.orange}">−${+Math.abs(dW).toFixed(1)} ${x.unit || U}</span>` : 'same weight'} vs ${fShort(prev.d)} (${wfmt(prev.e)}${prev.e.sets ? `, ${esc(setsStr(prev.e))}` : ''})` : 'First time logged';
    return `<div class="exr"><div class="exn"><b>${esc(x.name)}</b>${pr ? ' <span class="badge pr">PR</span>' : ''}<div class="caption">${sub}</div></div><div class="exw num"><b>${wfmt(x)}</b><small>${esc(setsStr(x))}</small>${x.note ? `<small>${esc(x.note)}</small>` : ''}${spark(hist.slice(-10).map(h2 => h2.e.weight))}</div></div>`;
  });
  h += shareBtn(d, li, 'wide');
  h += card('Exercises & progression', `<div class="exl">${rows.join('')}</div><div class="caption" style="margin-top:8px">Change is vs. the last time you logged the same exercise; the line is up to the last 10 sessions.</div>`);
  if (l.note) h += card('Notes', `<div class="sub">${esc(l.note)}</div>`);
  if (w) h += `<button class="btn2" data-page="workout/${d}/${wi}">${ic('heartbeat')} WHOOP activity · zones & HR</button>`;
  h += `<button class="btn2" data-page="day/${d}">${ic('calendar-blank')} Whole day</button>`;
  return {title:`${l.type} session`, body:h};
}
function pDay(d) {
  const r = rec(d), s = slp(d), c = cyc(d), ft = foodTot(d);
  let h = `<p class="sub" style="margin:0 0 14px;text-align:center">${fLong(d)} · ${dayType(d)} day${trained(d) ? ' · trained' : ''}</p>`;
  if (W[d]) {
    h += card('WHOOP', `<div class="rings3">
      <div class="dial" data-page="sleep/${d}"${BTN} aria-label="Sleep details">${ring((s.performance || 0) / 100, C.sleep, s.performance != null ? s.performance + '<span class="unit">%</span>' : '–', '', 88)}<div class="ring-lbl">Sleep${ic('caret-right', 0, 'lchev')}</div></div>
      <div class="dial" data-page="recovery/${d}"${BTN} aria-label="Recovery details">${ring((r.score || 0) / 100, recColor(r.score), r.score != null ? r.score + '<span class="unit">%</span>' : '–', '', 88)}<div class="ring-lbl">Recovery${ic('caret-right', 0, 'lchev')}</div></div>
      <div class="dial" data-page="strain/${d}"${BTN} aria-label="Strain details">${ring((c.strain || 0) / 21, C.strain, n1(c.strain), '', 88)}<div class="ring-lbl">Strain${ic('caret-right', 0, 'lchev')}</div></div></div>
      <div class="hr" style="margin:16px 0"></div>
      <dl class="kv"><dt>HRV</dt><dd>${n0(r.hrv)} ms</dd><dt>Resting HR</dt><dd>${n0(r.rhr)} bpm</dd><dt>Sleep</dt><dd>${hm(s.hours_asleep)} of ${hm(s.need_hours)} needed</dd><dt>SpO₂</dt><dd>${n1(r.spo2)}%</dd><dt>Skin temp</dt><dd>${r.skin_temp_c != null ? n1(fF(r.skin_temp_c)) : '–'} °F</dd>
      <dt>Calories</dt><dd>${n0(c.kcal)} kcal</dd>${c.start ? `<dt>Cycle</dt><dd>${fTime(c.start)} – ${c.end ? fTime(c.end) : 'ongoing'}</dd>` : ''}</dl>`);
    for (const nap of wd(d).naps || []) h += card('Nap', `<div class="sub">${fTime(nap.start)} – ${fTime(nap.end)} · ${hm(nap.hours_asleep)} asleep</div>`);
  }
  const lifts = LIFTS[d] || [], ww = wd(d).workouts || [];
  if (lifts.length || ww.length || GTG[d]) {
    let b = lifts.map((l, i) => `<div class="row tap srow" data-page="session/${d}/${i}"${BTN}><span class="pill" style="color:${TYPE_C[l.type] || C.acc}"><i></i>${esc(l.type)}</span><span class="caption">${exSummary(l)} ${chev}</span></div>${exGrid(l.exercises, l)}<div class="sharerow">${shareBtn(d, i)}</div>`).join('<div class="hr"></div>');
    if (ww.length) b += `${b ? '<div class="hr"></div>' : ''}<div class="acts">${ww.map((w, i) => actRow(d, w, i)).join('')}</div>`;
    if (GTG[d]) b += `${b ? '<div class="hr"></div>' : ''}<div class="sub">Grease the Groove: ${GTG[d].reduce((a, x) => a + x.reps, 0)} reps, ${GTG[d].reduce((a, x) => a + (x.negatives || 0), 0)} negatives</div>`;
    h += card('Training', b);
  }
  if (ft.n) h += card('Nutrition', `<div class="row sub"><span>${ft.n} meal${ft.n === 1 ? '' : 's'}</span><span class="num">${n0(ft.cal)} kcal · ${n0(ft.protein)} g protein</span></div>`, {attr:` data-page="meals/${d}"`, meta:chev});
  if (supps(d).length || saunaDay(d)) h += card('Habits', `<div class="list">${D.supplements.map(x => li(chk(supps(d).includes(x.id) || (x.id === 'sauna' && saunaDay(d))), esc(x.name), '', null, '', true)).join('')}</div>`);
  if (D.journal[d]) h += card('Journal', journalGrid(d, true), {attr:` data-journal="${d}"`});
  const wt = D.weights.find(x => x.date === d); if (wt) h += card('Weight', `<span class="big">${wt.value}</span><span class="unit">${U}</span>`);
  if (!W[d] && !lifts.length && !ft.n && !wt && !D.journal[d]) h += empty('Nothing logged on this day.');
  return {title:ttl(d), body:h};
}
function pMeals(d) {
  const t = D.targets, ft = foodTot(d), fs = FOOD[d] || [];
  let h = card('Totals', metric('Calories', ft.cal, t.calories, 'kcal', C.acc) + metric('Protein', ft.protein, t.protein_g, 'g', C.blue) + metric('Fat', ft.fat, t.fat_g, 'g', C.orange) + metric('Sugar', ft.sugar, t.sugar_g, 'g', C.pink), {meta:`${ft.n} meal${ft.n === 1 ? '' : 's'}`});
  h += fs.length ? card('Meals', `<div class="list">${fs.map(mealRow).join('')}</div>`) : empty('No meals logged.');
  h += `<button class="btn2" data-page="day/${d}">${ic('calendar-blank')} Whole day</button>`;
  return {title:`Meals · ${ttl(d)}`, body:h};
}
const CA_INFO = {
  sleep_regularity:'How regular your sleep timing is (WHOOP consistency). Irregular sleep timing is linked with higher mortality independent of sleep length.',
  body_mass_index:'Body mass index from your latest logged weight and WHOOP height. The risk curve is J-shaped, lowest around the low-to-mid 20s.',
  resting_hr:'Average resting heart rate from WHOOP. Each extra 10 bpm at rest is associated with higher all-cause mortality.',
  sleep_duration:'Average nightly sleep from WHOOP. Both short (under ~7 h) and very long sleep are associated with higher risk.',
  cardiorespiratory_fitness:'Estimated cardiorespiratory fitness (VO₂max, METs). Fitness is one of the strongest predictors of longevity.',
  hrv:'Heart rate variability vs. age norms. Low HRV is associated with higher cardiovascular risk.',
  aerobic_activity:'Weekly moderate-to-vigorous minutes from WHOOP heart-rate zones, vs. the 150–300 min guideline.',
  sauna:'Sauna sessions per week (WHOOP + habits). Frequent sauna use is associated with lower cardiovascular mortality in Finnish cohorts.',
  pullup_strength:'Strict pull-up max as a muscular-strength marker. Grip and upper-body strength track with lower mortality.',
  strength_training:'Muscle-strengthening sessions per week. 30–60 minutes a week is associated with the lowest risk.',
  alcohol:'Drinks per week from the journal. Risk rises with intake; there is no protective amount in recent analyses.',
  added_sugar:'Average daily sugar from the meal log. High added-sugar intake is associated with higher cardiometabolic risk.',
};
function pAge(id) {
  const ca = D.coach_age || {}, c = (ca.components || []).find(x => x.id === id); if (!c) return {title:'Coach Age', body:empty('Component not found.')};
  const ok = c.status === 'ok', sign = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + n1(Math.abs(v)), unit = (c.unit || '').replace('^2', '²');
  const val = c.value == null ? '–' : `${typeof c.value === 'number' ? +c.value.toFixed(1) : esc(c.value)} ${esc(unit)}`;
  let h = `<div class="mhead"><div class="caption caps">${esc(c.label)}</div><div class="huge num" style="color:${!ok ? 'var(--txt2)' : c.years > 0.05 ? '#ff5a68' : c.years < -0.05 ? C.green : 'var(--txt)'}">${ok ? sign(c.years) : '–'}<span class="unit">years</span></div>
    <div><span class="badge b-${c.badge}">${c.badge}</span></div></div>`;
  h += card('', `<dl class="kv"><dt>Your value</dt><dd>${ok ? val : `not enough data`}</dd>${c.referent != null ? `<dt>Reference</dt><dd>${typeof c.referent === 'number' ? +c.referent.toFixed(1) : esc(c.referent)} ${esc(unit)}</dd>` : ''}
    <dt>Data</dt><dd>${(c.n ?? 0) >= c.min_n ? `${c.n} days` : `${c.n ?? 0} of ${c.min_n} days needed`}</dd>${ok && c.se_years != null ? `<dt>Uncertainty</dt><dd>± ${n1(c.se_years)} years</dd>` : ''}${c.tier && String(c.tier).toLowerCase() !== String(c.badge).toLowerCase() ? `<dt>Evidence</dt><dd>${esc(c.tier)}</dd>` : ''}</dl>`);
  h += card('What it measures', `<div class="sub">${CA_INFO[id] || ''}</div>${c.note ? `<div class="caption" style="margin-top:8px">${esc(c.note)}</div>` : ''}`);
  if (c.source) h += card('Source', c.url ? `<a class="srclink" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.source)} ${ic('arrow-up-right')}</a>` : `<div class="sub">${esc(c.source)}</div>`);
  h += `<button class="btn2" data-method>${ic('book-open')} Method & sources</button><div class="caption ca-note">${CA_NOTE}</div>`;
  return {title:'Coach Age', body:h};
}
/* ---------- pages: stack + router ----------
   Each pushed page gets a history entry ({pages:[routes], ov}) and a hash (#/sleep/2026-10-08), so browser/iOS back,
   the back chevron, Esc and a swipe from the left edge all pop through history. Deep links rebuild the parent chain. */
const ROUTES = {
  sleep:a => a[1] ? pSleepSub(a[0], a[1]) : pSleep(a[0]), recovery:a => pRecovery(a[0]), strain:a => pStrain(a[0]),
  metric:a => pMetric(a[0], a[1]), workout:a => pWorkout(a[0], +a[1]), session:a => pSession(a[0], +a[1]), day:a => pDay(a[0]),
  meals:a => pMeals(a[0]), age:a => pAge(a[0]), chart:a => pChart(a[0], a[1]), insights:a => pInsights(a[0]), info:a => pInfo(a[0]),
};
const DATE_ARG = {sleep:0, recovery:0, strain:0, workout:0, session:0, day:0, meals:0, insights:0, metric:1, chart:1};
function normRoute(r) {
  const p = String(r || '').split('/').filter(Boolean); if (!ROUTES[p[0]]) return null;
  const k = DATE_ARG[p[0]]; if (k != null && !isDate(p[k + 1])) p[k + 1] = TODAY;
  return p.join('/');
}
function parentsOf(r) {
  const [k, ...a] = r.split('/');
  if (k === 'sleep' && a[1]) return ['sleep/' + a[0]];
  if (k === 'metric') return ['recovery/' + a[1]];
  if (k === 'workout') return ['strain/' + a[0]];
  if (k === 'insights') return ['recovery/' + a[0]];
  if (k === 'chart') { const g = (CH_DEF[a[0]] || {}).g; return g ? [g + '/' + a[1]] : []; }
  return [];
}
const baseTabOf = r => ({age:'health', session:'training', meals:'nutrition'})[r.split('/')[0]] || 'today';
const routesFromHash = () => { const h = location.hash; if (!h.startsWith('#/')) return []; const r = normRoute(decodeURIComponent(h.slice(2))); return r ? [...parentsOf(r), r] : []; };
const PG = [];
let pgOwn = 0;   // pages that own a history entry we pushed (popped with history.back)
const pstate = () => ({pages:PG.map(p => p.route), ov:OV.length});
function buildPage(route) {
  const [k, ...a] = route.split('/');
  let res = null;
  try { res = ROUTES[k](a); } catch (e) { console.error(e); }
  if (!res) res = {title:'Coach', body:empty('Couldn\u2019t open this page.')};
  const el = document.createElement('section');
  el.className = 'page'; el.dataset.route = route; el.setAttribute('aria-label', res.title);
  el.innerHTML = `<header class="phead"><button class="pback" data-back aria-label="Back">${ic('caret-left')}</button><h1 class="ptitle">${esc(res.title)}</h1>${res.info ? `<button class="pinfo" data-page="${res.info}" aria-label="About this page">${ic('info')}</button>` : '<span></span>'}</header><div class="pbody">${res.body}</div>`;
  brandDom(el);
  return el;
}
function setInert() {
  const locked = document.documentElement.classList.contains('locked');
  for (const id of ['view', 'topbar', 'mbar', 'searchview']) { const e = document.getElementById(id); if (!e) continue; if (PG.length || locked) e.setAttribute('inert', ''); else e.removeAttribute('inert'); }
  PG.forEach((p, i) => { if (i === PG.length - 1 && !locked) p.el.removeAttribute('inert'); else p.el.setAttribute('inert', ''); });
}
function pushPage(route, opt = {}) {
  route = normRoute(route); if (!route) return;
  if (SH.open && opt.hist !== false) { closeSheet(() => pushPage(route, opt)); return; }
  if (PG.length && PG[PG.length - 1].route === route) return;
  $('#tip').hidden = true;
  const host = $('#pages'), el = buildPage(route), prev = PG[PG.length - 1], anim = opt.anim !== false && !RM;
  host.hidden = false; host.appendChild(el);
  PG.push({route, el, ret:opt.hist === false ? null : document.activeElement});
  document.body.classList.add('paged');
  setInert(); bindCharts(el); animateRings(el);
  if (opt.hist !== false) { history.pushState(pstate(), '', '#/' + route); pgOwn++; }
  if (!anim) { el.classList.add('noanim', 'in'); if (prev) prev.el.classList.add('noanim', 'under'); void el.offsetWidth; el.classList.remove('noanim'); if (prev) prev.el.classList.remove('noanim'); }
  else requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('in'); if (prev) prev.el.classList.add('under'); }));
  if (opt.focus !== false) setTimeout(() => { if (el.isConnected) el.querySelector('.pback').focus({preventScroll:true}); }, anim ? 320 : 0);
}
function dropPage(anim = true) {
  const p = PG.pop(); if (!p) return;
  const prev = PG[PG.length - 1], a = anim && !RM;
  if (!a) p.el.classList.add('noanim');
  p.el.classList.remove('in'); p.el.style.transform = '';
  if (prev) { if (!a) prev.el.classList.add('noanim'); prev.el.classList.remove('under'); prev.el.style.transform = ''; if (!a) { void prev.el.offsetWidth; prev.el.classList.remove('noanim'); } }
  if (a) setTimeout(() => p.el.remove(), 340); else p.el.remove();
  if (!PG.length) { document.body.classList.remove('paged'); setTimeout(() => { if (!PG.length) $('#pages').hidden = true; }, a ? 340 : 0); }
  setInert();
  const r = p.ret; if (r && r.focus && document.contains(r) && !r.closest('[inert]')) r.focus({preventScroll:true});
}
function pageBack() {
  if (!PG.length) return;
  if (pgOwn > 0) { history.back(); return; }
  dropPage();
  const rs = PG.map(p => p.route);
  history.replaceState(rs.length ? pstate() : null, '', rs.length ? '#/' + rs[rs.length - 1] : '#' + tab);
}
/* bring the page stack in line with a history entry (back / forward / manual hash edit) */
function syncPages(target) {
  target = target.map(normRoute).filter(Boolean);
  let i = 0; while (i < PG.length && i < target.length && PG[i].route === target[i]) i++;
  const removed = PG.length - i;
  for (let k = 0; k < removed; k++) dropPage(k === 0);
  pgOwn = Math.max(0, pgOwn - removed);
  for (; i < target.length; i++) { pushPage(target[i], {hist:false, anim:i === target.length - 1}); pgOwn++; }
}
function refreshTop() {
  const p = PG[PG.length - 1];
  if (!p) { render(true); return; }
  const body = p.el.querySelector('.pbody'), y = body.scrollTop, [k, ...a] = p.route.split('/'), res = ROUTES[k](a);
  if (res) { body.innerHTML = res.body; brandDom(body); bindCharts(body); body.scrollTop = y; }
}
function wireEdgeSwipe() {
  const host = $('#pages');
  let x0 = null, y0 = 0, dx = 0, act = false, t0 = 0, el = null, under = null;
  host.addEventListener('touchstart', e => {
    if (!PG.length || e.touches.length !== 1 || e.touches[0].clientX > 28) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; act = false; t0 = performance.now(); el = PG[PG.length - 1].el; under = PG.length > 1 ? PG[PG.length - 2].el : null;
  }, {passive:true});
  host.addEventListener('touchmove', e => {
    if (x0 == null) return;
    const t = e.touches[0]; dx = t.clientX - x0; const dy = t.clientY - y0;
    if (!act) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; if (Math.abs(dy) > Math.abs(dx) || dx < 0) { x0 = null; return; } act = true; el.classList.add('drag'); if (under) under.classList.add('drag'); }
    if (e.cancelable) e.preventDefault();
    const d = Math.max(0, dx); el.style.transform = `translate3d(${d}px,0,0)`; if (under) under.style.transform = `translate3d(${(-22 + 22 * d / innerWidth).toFixed(2)}%,0,0)`;
  }, {passive:false});
  const end = () => {
    if (x0 == null) return; x0 = null; if (!act) return; act = false;
    el.classList.remove('drag'); if (under) under.classList.remove('drag');
    const v = dx / Math.max(1, performance.now() - t0);
    if (dx > innerWidth * 0.33 || (v > 0.45 && dx > 40)) pageBack(); else { el.style.transform = ''; if (under) under.style.transform = ''; }
  };
  host.addEventListener('touchend', end); host.addEventListener('touchcancel', end);
}

/* ---------- router ---------- */
const VIEWS = {today:vToday, health:vHealth, trends:vTrends, training:vTraining, more:vMore, nutrition:vNutrition, history:vHistory};
const TABOF = {nutrition:'more', history:'more'};   // sub-pages light up the More tab
const SECTIONS = {insights:'trends', stress:'health', monitor:'health', coachage:'health'};
function render(keepScroll) {
  const v = $('#view'), y = v.scrollTop;
  for (const k in CH) delete CH[k];
  v.innerHTML = VIEWS[tab](); brandDom(v);
  v.classList.remove('fadein'); void v.offsetWidth; if (!keepScroll) v.classList.add('fadein');
  document.querySelectorAll('.tabbar button').forEach(b => { const on = b.dataset.tab === (TABOF[tab] || tab); b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  bindCharts(v); animateRings(v);
  v.scrollTop = keepScroll ? y : 0;
  watchHero();
}
/* Navigate to a tab (or 'insights' / 'journal'), closing any open sheet or search first. */
function go(t) {
  closeAll(() => {
    if (t === 'journal') return openJournal(TODAY);
    const sec = SECTIONS[t] ? t : null; if (sec) t = SECTIONS[t];
    if (t !== tab || sec) { tab = t; history.replaceState(null, '', '#' + t); render(); }
    if (sec) { const el = document.getElementById(sec); if (el) el.scrollIntoView({block:'start'}); }
  });
}

function wire() {
  const V = $('#view'), q = $('#q');
  $('#tabbar').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (PG.length) { go(b.dataset.tab); return; } if (b.dataset.tab === tab && !SR.open) { if (tab === 'today' && dayView) { dayView = null; render(); } else V.scrollTo({top:0, behavior:RM ? 'auto' : 'smooth'}); } else go(b.dataset.tab); });
  document.addEventListener('click', e => {
    const t = e.target;
    const lbx = t.closest('[data-lightbox]'); if (lbx) { e.preventDefault(); e.stopPropagation(); openLightbox(lbx.dataset.lightbox, lbx); return; }
    const ml = t.closest('[data-meal]'); if (ml) { e.preventDefault(); e.stopPropagation(); openMeal(ml.dataset.meal, ml); return; }
    const shb = t.closest('[data-share]'); if (shb) { e.preventDefault(); e.stopPropagation(); openShare(shb.dataset.share, shb); return; }
    const shw = t.closest('[data-sharew]'); if (shw) { if (!shw.disabled) setShareWeights(shw.dataset.sharew === '1'); return; }
    if (t.closest('[data-sharego]')) { shareGo(); return; }
    const ths = t.closest('[data-theme-set]'); if (ths) { localStorage.setItem('coach.theme', ths.dataset.themeSet); applyTheme(ths.dataset.themeSet); render(true); return; }
    if (t.closest('[data-back]')) { pageBack(); return; }
    const pr = t.closest('[data-prange]'); if (pr) { prange = pr.dataset.prange; localStorage.setItem('coach.prange', prange); refreshTop(); return; }
    const rb = t.closest('[data-range]'); if (rb) { range = rb.dataset.range; localStorage.setItem('coach.range', range); render(true); return; }
    const lb = t.closest('[data-lift]'); if (lb) { liftKey = lb.dataset.lift; render(true); return; }
    const fb = t.closest('[data-filter]'); if (fb) { histFilter = fb.dataset.filter; histLimit = 21; render(true); return; }
    const mb = t.closest('[data-more]'); if (mb) { if (mb.dataset.more === 'hist') histLimit += 21; else logLimit += 10; render(true); return; }
    if (t.closest('.chart')) return;
    const sb = t.closest('[data-step]'); if (sb) { const nd = add(viewDay(), +sb.dataset.step); dayView = nd >= TODAY ? null : nd < firstDay() ? firstDay() : nd; render(true); return; }
    if (t.closest('[data-top]')) { V.scrollTo({top:0, behavior:RM ? 'auto' : 'smooth'}); return; }
    const mt = t.closest('[data-metric]'); if (mt) { openMetric(mt.dataset.metric); return; }
    const me = t.closest('[data-method]'); if (me) { openMethod(me); return; }
    if (t.closest('a[href]')) return;   // external citation links, sign out
    const pg = t.closest('[data-page]'); if (pg) { pushPage(pg.dataset.page); return; }
    const jb = t.closest('[data-journal]'); if (jb) { openJournal(jb.dataset.journal); return; }
    const db = t.closest('[data-day]'); if (db) { openDay(db.dataset.day); return; }
    const gb = t.closest('[data-go]'); if (gb) { go(gb.dataset.go); return; }
  });
  // keyboard activation for tappable cards / rows
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); }
  });
  // search
  const kb = on => document.body.classList.toggle('kb', on);
  q.addEventListener('focus', () => { document.body.classList.add('searching'); $('#qcancel').hidden = false; kb(true); });
  const endSearching = () => { if (!SR.open && !q.value) { document.body.classList.remove('searching'); $('#qcancel').hidden = true; } };
  q.addEventListener('blur', e => { kb(false); if (e.relatedTarget !== $('#qcancel')) endSearching(); setTimeout(() => scrollTo(0, 0), 0); });  // undo any iOS keyboard shift
  $('#qcancel').addEventListener('blur', e => { if (e.relatedTarget !== q) endSearching(); });
  q.addEventListener('input', () => { $('#qclear').hidden = !q.value; if (q.value.trim()) openSearch(); runSearch(q.value); });
  q.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); } if (e.key === 'Enter') q.blur(); });
  $('#qclear').addEventListener('click', e => { e.preventDefault(); q.value = ''; runSearch(''); $('#qclear').hidden = true; q.focus(); });
  $('#qcancel').addEventListener('click', () => { closeSearch(); q.blur(); document.body.classList.remove('searching'); $('#qcancel').hidden = true; });
  if (window.visualViewport) visualViewport.addEventListener('resize', () => kb(document.activeElement === q || visualViewport.height < document.documentElement.clientHeight * 0.75));
  // sheets
  $('#sheetclose').addEventListener('click', () => closeSheet()); $('#scrim').addEventListener('click', () => closeSheet());
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (SH.open) closeSheet(); else if (SR.open) closeSearch(); else if (PG.length) pageBack(); });
  addEventListener('popstate', e => {
    const st = e.state || {}, depth = st.ov || 0;
    while (OV.length > depth) OV.pop().close();
    syncPages(st.pages || routesFromHash());
    const a = afterPop; afterPop = null; if (a) a();
  });
  wireSheetDrag(); wireEdgeSwipe();
}

/* Live WHOOP refresh: /api/refresh (gated function) returns the last few days in the same shape as data.json; merge and re-render. */
const RF = {last:0, busy:false, tmr:null, y0:null};
function rfPill(msg, bad, ms) {
  const el = $('#rfpill'); if (!el) return; clearTimeout(RF.tmr);
  el.textContent = msg; el.hidden = false; el.classList.toggle('bad', !!bad); void el.offsetWidth; el.classList.add('on');
  if (ms) RF.tmr = setTimeout(() => { el.classList.remove('on'); setTimeout(() => { if (!el.classList.contains('on')) el.hidden = true; }, 300); }, ms);
}
const APPV = '2026-10-09.2';
const toLogin = () => location.replace('/login?next=' + encodeURIComponent(location.pathname + location.hash));
/* Re-fetch data.json (always revalidated: logged food, supplements, workouts, journal, weights, pull-ups come ONLY from here). */
async function reloadData() {
  const r = await fetch('/data.json', {credentials:'same-origin', cache:'no-cache'});
  if (r.status === 401 || r.redirected && /\/login/.test(r.url)) { toLogin(); throw new Error('login'); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const nd = await r.json(); if (!nd || !nd.wear || !nd.food) throw new Error('bad payload');
  RF.checked = new Date().toISOString();
  if (nd.generated_at === D.generated_at && nd.updated_at === D.updated_at) return false;
  D = nd; applyConfig(); Object.assign(W, D.wear.days || {});
  // live WHOOP days newer than the file's own sync stay on top (WHOOP fields only)
  if (RF.live && RF.liveAt && (!D.wear.synced_at || new Date(D.wear.synced_at) < new Date(RF.liveAt))) for (const d of Object.keys(RF.live)) { W[d] = Object.assign(W[d] || {}, RF.live[d]); D.wear.days[d] = W[d]; }
  derive(); return true;
}
async function reloadLive() {   // WHOOP-derived fields only, from the gated function
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch('/api/refresh', {credentials:'same-origin', cache:'no-store', signal:ctl.signal});
    if (r.status === 401 || r.redirected && /\/login/.test(r.url)) { toLogin(); throw new Error('login'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); if (!j || typeof j.days !== 'object') throw new Error('bad payload');
    RF.live = Object.assign(RF.live || {}, j.days); RF.liveAt = new Date().toISOString();
    for (const d of Object.keys(j.days)) { W[d] = Object.assign(W[d] || {}, j.days[d]); D.wear.days[d] = W[d]; }
    D.wear.live_at = RF.liveAt; return true;
  } finally { clearTimeout(to); }
}
const rfIdle = () => !PG.length && !OV.length && !(SR && SR.open) && !document.body.classList.contains('searching');
function rfPaint() { if (rfIdle()) { RF.dirty = false; render(true); } else RF.dirty = true; }
async function liveRefresh(manual) {
  if (RF.busy) return;
  const whoop = manual || Date.now() - RF.last >= 300000;
  RF.busy = true; if (whoop) RF.last = Date.now();
  const btn = $('#rfbtn'); if (btn) btn.classList.add('spin'); if (manual) rfPill('Refreshing\u2026', false, 0);
  try {
    const [a, b] = await Promise.allSettled([reloadData(), whoop ? reloadLive() : Promise.resolve(false)]);
    if (a.status === 'rejected' && b.status === 'rejected') { if (a.reason && a.reason.message === 'login') return; throw a.reason; }
    let changed = (a.status === 'fulfilled' && a.value) || (b.status === 'fulfilled' && b.value);
    if (TODAY !== ctToday()) { TODAY = ctToday(); changed = true; }
    if (changed) rfPaint();
    if (a.status === 'rejected') rfPill('Offline \u00b7 showing saved data', true, 4000);
    else if (b.status === 'rejected') rfPill(manual ? 'WHOOP offline \u00b7 logs updated' : 'Updated just now', b.status === 'rejected' && !!manual, 3000);
    else if (manual || changed) rfPill('Updated just now', false, 2600);
    else if (!manual) { const el = $('#rfpill'); if (el && el.classList.contains('bad')) { el.classList.remove('on'); } }
  } catch (e) { rfPill('Offline \u00b7 showing saved data', true, manual ? 4000 : 0); }
  finally { RF.busy = false; if (btn) btn.classList.remove('spin'); }
}
function wireRefresh() {
  const b = $('#rfbtn'); if (b) b.addEventListener('click', () => liveRefresh(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') liveRefresh(false); });
  addEventListener('focus', () => liveRefresh(false)); addEventListener('online', () => liveRefresh(false));
  setInterval(() => { if (document.visibilityState === 'visible') { liveRefresh(false); if (RF.dirty) rfPaint(); } }, 60000);
  setInterval(() => { if (RF.dirty) rfPaint(); }, 1000);
  addEventListener('pageshow', e => { if (e.persisted) liveRefresh(false); });
  const V = $('#view'); if (!V) return;   // pull down from the top of the page to refresh
  V.addEventListener('touchstart', e => { RF.y0 = (V.scrollTop <= 0 && !PG.length && !OV.length && e.touches.length === 1) ? e.touches[0].clientY : null; }, {passive:true});
  V.addEventListener('touchend', e => { const t = e.changedTouches[0]; if (RF.y0 != null && t && t.clientY - RF.y0 > 90 && V.scrollTop <= 0) liveRefresh(true); RF.y0 = null; }, {passive:true});
}
async function boot() {
  try {
    const r = await fetch('/data.json', {credentials:'same-origin'});
    if (r.status === 401 || r.redirected && /\/login/.test(r.url)) { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.hash)); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status); D = await r.json();  // server revalidates (max-age=0) RF.checked = new Date().toISOString();
    const months = await Promise.all((D.wear.months || []).map(m => fetch(`/wear/${m}.json`).then(x => x.ok ? x.json() : {}).catch(() => ({}))));
    for (const m of months) Object.assign(W, m);
    Object.assign(W, D.wear.days || {});
    TODAY = D.today; applyConfig(); derive();
    const h = location.hash.slice(1), deep = h[0] === '/' ? routesFromHash() : [];
    if (VIEWS[h]) tab = h;
    if (deep.length) tab = baseTabOf(deep[deep.length - 1]);
    else if (history.state && (history.state.ov || history.state.pages)) history.replaceState(null, '', VIEWS[h] ? location.hash : '#' + tab);  // reload while an overlay was open
    wire(); render(); wireRefresh(); liveRefresh(false);
    if (deep.length) {   // deep link: base tab underneath, parent pages without their own history entries, the target on top
      history.replaceState({pages:deep.slice(0, -1), ov:0}, '', '#/' + deep[deep.length - 1]);
      deep.slice(0, -1).forEach(r2 => pushPage(r2, {hist:false, anim:false, focus:false}));
      pushPage(deep[deep.length - 1], {hist:false, anim:false, focus:false});
      history.replaceState(pstate(), '', '#/' + deep[deep.length - 1]);
    }
    addEventListener('hashchange', () => { const t = location.hash.slice(1); if (VIEWS[t] && t !== tab) { tab = t; render(); } });
  } catch (e) {
    $('#view').innerHTML = `<div class="loading">Couldn't load data (${esc(e.message)}).</div>`;
  }
}
/* ---------- shareable workout card (client-side canvas, no network) ---------- */
const CARD_W = 1080, CARD_H = 1350, CARD_SCALE = 2;
const shareBtn = (d, li, cls = '') => `<button class="sharebtn${cls ? ' ' + cls : ''}" data-share="${d}/${li}" aria-label="Share workout card">${ic('share-network')}<span>Share</span></button>`;
const BRAND = () => String((D.config || {}).brand || (D.config || {}).site_title || 'Coach').toUpperCase();
const isTbd = s => /weight\s*tbd/i.test(s || '');
const intensity = v => v == null ? null : v >= 18 ? 'All out' : v >= 14 ? 'High' : v >= 10 ? 'Moderate' : 'Light';
function shareData(d, li) {
  const l = (LIFTS[d] || [])[li]; if (!l) return null;
  const wi = workoutForLift(d, li), w = wi != null ? (wd(d).workouts || [])[wi] : null;
  return {l, d, w, t:exTotals(l.exercises), n:(l.exercises || []).length, strain:w && w.strain != null ? w.strain : null, dur:w ? durMin(w) : 0};
}
function fmtDur(m) { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`; }
function shareText(s) {
  const bits = [plural(s.n, 'exercise')];
  if (s.t.s) bits.push(plural(s.t.s, 'set'), (s.t.exact ? '' : '≥') + plural(s.t.r, 'rep'));
  let txt = `${s.l.type} day done: ${bits.join(', ')}.`;
  if (s.strain != null) txt += ` WHOOP strain ${n1(s.strain)} (${intensity(s.strain).toLowerCase()}).`;
  return txt;
}
function drawCard(s, opt = {}) {
  const withW = opt.weights !== false;
  const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'system-ui,sans-serif';
  const cv = document.createElement('canvas'); cv.width = CARD_W * CARD_SCALE; cv.height = CARD_H * CARD_SCALE;
  const g = cv.getContext('2d'); g.scale(CARD_SCALE, CARD_SCALE);
  const f = (w, px) => { g.font = `${w} ${px}px ${FONT}`; };
  const ls = v => { if ('letterSpacing' in g) g.letterSpacing = v + 'px'; };
  const fit = (txt, max) => { if (g.measureText(txt).width <= max) return txt; while (txt.length > 1 && g.measureText(txt + '…').width > max) txt = txt.slice(0, -1); return txt.trimEnd() + '…'; };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
  const LT = THEME === 'light', GL = THEME === 'glass', GREEN = C.green, BLUE = LT ? '#0a84ff' : '#2fb2ff', T1 = LT ? '#0d0f12' : '#ffffff', T2 = ink(.64), T3 = ink(LT ? .48 : .40), SEP = ink(.08), CHIP = LT ? '#0a6b00' : '#c9f7c4';
  const P = 76, R = CARD_W - P;
  // background: deep base, green aurora top-right, cool glow bottom-left, fine vignette
  let gr = g.createLinearGradient(0, 0, 0, CARD_H); gr.addColorStop(0, LT ? '#ffffff' : GL ? '#141a33' : '#0d1112'); gr.addColorStop(1, LT ? '#eef1f4' : GL ? '#080a16' : '#070809'); g.fillStyle = gr; g.fillRect(0, 0, CARD_W, CARD_H);
  const glow = (x, y, r, c) => { const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, c); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(0, 0, CARD_W, CARD_H); };
  glow(CARD_W - 120, 180, 640, LT ? 'rgba(13,158,0,.10)' : 'rgba(22,236,6,.17)'); glow(CARD_W - 200, 260, 260, LT ? 'rgba(13,158,0,.05)' : 'rgba(22,236,6,.08)'); glow(-60, CARD_H + 40, 640, LT ? 'rgba(0,119,194,.08)' : 'rgba(0,147,231,.11)');
  if (GL) { glow(-80, 520, 720, 'rgba(110,90,255,.30)'); glow(CARD_W * .6, CARD_H + 60, 700, 'rgba(0,163,255,.22)'); }
  g.fillStyle = ink(.035); if (!LT && !GL) for (let y = 0; y < CARD_H; y += 6) g.fillRect(0, y, CARD_W, .5);  // subtle scanline texture
  // brand mark: ring glyph + wordmark
  const by = 104;
  g.lineCap = 'round'; g.lineWidth = 6; g.strokeStyle = LT ? 'rgba(13,158,0,.2)' : 'rgba(22,236,6,.25)'; g.beginPath(); g.arc(P + 17, by - 10, 15, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = GREEN; g.beginPath(); g.arc(P + 17, by - 10, 15, -Math.PI / 2, Math.PI * 1.05); g.stroke();
  f(800, 25); g.fillStyle = T1; ls(5); g.fillText(fit(BRAND(), 560), P + 48, by); ls(0);
  const dt = fd(s.d, {weekday:'short', month:'short', day:'numeric'}).toUpperCase();
  f(700, 21); ls(2.5); const dw = g.measureText(dt).width + 40; g.fillStyle = ink(.07); rr(R - dw, by - 37, dw, 46, 23); g.fill(); g.strokeStyle = ink(.10); g.lineWidth = 1.5; g.stroke();
  g.fillStyle = T2; g.textAlign = 'center'; g.fillText(dt, R - dw / 2, by - 6); g.textAlign = 'left'; ls(0);
  // hero: type + subtitle, strain ring on the right
  const ringR = 112, rcx = R - ringR - 6, rcy = 300, hasRing = s.strain != null;
  f(700, 26); g.fillStyle = GREEN; ls(4); g.fillText('STRENGTH SESSION', P, 222); ls(0);
  f(850, 176); g.fillStyle = T1; ls(-6); g.fillText(fit(String(s.l.type).toUpperCase(), (hasRing ? rcx - ringR - 30 : R) - P), P - 8, 382); ls(0);
  f(500, 30); g.fillStyle = T2; g.fillText(fd(s.d, {weekday:'long', month:'long', day:'numeric'}), P, 436);
  if (hasRing) {
    const fr = Math.max(0.02, Math.min(1, s.strain / 21)), a0 = -Math.PI / 2;
    g.lineWidth = 20; g.strokeStyle = 'rgba(47,178,255,.13)'; g.beginPath(); g.arc(rcx, rcy, ringR, 0, Math.PI * 2); g.stroke();
    const sg = g.createLinearGradient(rcx - ringR, rcy - ringR, rcx + ringR, rcy + ringR); sg.addColorStop(0, '#5fd0ff'); sg.addColorStop(1, '#0093e7');
    g.save(); g.shadowColor = 'rgba(47,178,255,.55)'; g.shadowBlur = 26; g.strokeStyle = sg; g.beginPath(); g.arc(rcx, rcy, ringR, a0, a0 + fr * Math.PI * 2); g.stroke(); g.restore();
    g.textAlign = 'center'; f(800, 70); g.fillStyle = T1; g.fillText(n1(s.strain), rcx, rcy + 14);
    f(700, 18); ls(3); g.fillStyle = BLUE; g.fillText('STRAIN', rcx, rcy + 48); ls(0);
    f(600, 22); g.fillStyle = T2; g.fillText(intensity(s.strain), rcx, rcy + ringR + 52); g.textAlign = 'left';
  }
  // stats panel
  const stats = [[String(s.n), s.n === 1 ? 'Exercise' : 'Exercises'], [String(s.t.s), s.t.s === 1 ? 'Set' : 'Sets'], [(s.t.exact ? '' : '≥') + s.t.r, s.t.r === 1 ? 'Rep' : 'Reps']];
  if (s.dur) stats.push([fmtDur(s.dur), 'Duration']);
  const py = 494, ph = 132, pw = R - P;
  g.fillStyle = ink(.05); rr(P, py, pw, ph, 28); g.fill(); g.strokeStyle = ink(.08); g.lineWidth = 1.5; g.stroke();
  const cw = pw / stats.length;
  stats.forEach(([v, k], i) => {
    const x = P + i * cw;
    if (i) { g.fillStyle = SEP; g.fillRect(x, py + 28, 1.5, ph - 56); }
    g.textAlign = 'center'; f(800, 50); g.fillStyle = T1; g.fillText(fit(v, cw - 24), x + cw / 2, py + 72);
    f(700, 17); ls(2.5); g.fillStyle = T3; g.fillText(k.toUpperCase(), x + cw / 2, py + 104); ls(0); g.textAlign = 'left';
  });
  // exercise rows
  const rows = (s.l.exercises || []).filter(x => !(x.text && isTbd(x.name)));
  const top = 712, bottom = CARD_H - 132, avail = bottom - top;
  f(700, 19); ls(3.5); g.fillStyle = T3; g.fillText('EXERCISES', P, top - 26); ls(0);
  g.textAlign = 'right'; g.fillText(withW ? 'WEIGHT · REPS PER SET' : 'REPS PER SET', R, top - 26); g.textAlign = 'left';
  const maxRows = Math.max(1, Math.floor(avail / 66)), rh = Math.min(100, avail / Math.max(1, Math.min(rows.length, maxRows)));
  const shown = rows.length > maxRows ? rows.slice(0, maxRows - 1) : rows, more = rows.length - shown.length;
  const chipsW = sets => { f(700, 22); return sets.reduce((a, v) => a + Math.max(44, g.measureText(String(v)).width + 22) + 8, -8); };
  const drawChips = (sets, xr, cy) => {
    f(700, 22); let x = xr;
    for (let k = sets.length - 1; k >= 0; k--) { const t = String(sets[k]), w = Math.max(44, g.measureText(t).width + 22); x -= w; g.fillStyle = LT ? 'rgba(13,158,0,.10)' : 'rgba(22,236,6,.10)'; rr(x, cy - 19, w, 38, 12); g.fill(); g.fillStyle = CHIP; g.textAlign = 'center'; g.fillText(t, x + w / 2, cy + 8); g.textAlign = 'left'; x -= 8; }
  };
  shown.forEach((x, i) => {
    const y = top + i * rh, mid = y + rh / 2;
    if (i) { g.fillStyle = SEP; g.fillRect(P + 56, y, R - P - 56, 1.5); }
    f(800, 22); g.fillStyle = LT ? GREEN : 'rgba(22,236,6,.85)'; g.fillText(String(i + 1).padStart(2, '0'), P, mid + 8);
    const nx = P + 56;
    if (x.text) { f(500, 27); g.fillStyle = T2; g.fillText(fit(x.name, R - nx), nx, mid + 9); return; }
    const sets = Array.isArray(x.sets) ? x.sets : [], useChips = sets.length && sets.length <= 6;
    const wt = withW && x.weight != null ? wfmt(x) : '', note = x.note && !isTbd(x.note) ? x.note : '';
    let rW = useChips ? chipsW(sets) : (f(600, 26), g.measureText(setsStr(x)).width);
    let wW = 0; if (wt) { f(800, 30); wW = g.measureText(wt).width + 22; }
    const nameMax = R - nx - rW - wW - 28;
    f(650, 32); g.fillStyle = T1; g.fillText(fit(x.name, nameMax), nx, note ? mid - 3 : mid + 11);
    if (note) { f(400, 21); g.fillStyle = T3; g.fillText(fit(note, nameMax), nx, mid + 26); }
    if (useChips) drawChips(sets, R, mid); else { f(600, 26); g.fillStyle = T2; g.textAlign = 'right'; g.fillText(setsStr(x), R, mid + 9); g.textAlign = 'left'; }
    if (wt) { f(800, 30); g.fillStyle = T1; g.textAlign = 'right'; g.fillText(wt, R - rW - 22, mid + 10); g.textAlign = 'left'; }
  });
  if (more) { f(500, 25); g.fillStyle = T3; g.fillText(`+ ${plural(more, 'more exercise')}`, P + 56, top + shown.length * rh + rh / 2 + 9); }
  // footer
  const fy = CARD_H - 70;
  gr = g.createLinearGradient(P, 0, R, 0); gr.addColorStop(0, LT ? 'rgba(13,158,0,.9)' : 'rgba(22,236,6,.9)'); gr.addColorStop(.35, LT ? 'rgba(13,158,0,.15)' : 'rgba(22,236,6,.15)'); gr.addColorStop(1, ink(.04)); g.fillStyle = gr; g.fillRect(P, fy - 44, R - P, 2);
  f(600, 22); g.fillStyle = T3; g.fillText(s.strain != null ? `Strain from ${WN}` : 'Logged with Coach', P, fy); g.textAlign = 'right'; f(700, 22); ls(2); g.fillStyle = T2; g.fillText(fit(BRAND(), 420), R, fy); ls(0); g.textAlign = 'left';
  return cv;
}
const SHR = {key:null, s:null, file:null, url:null, gen:0};
const shareWeights = () => localStorage.getItem('coach.shareWeights') !== '0';
function shareSheetBody(s) {
  const w = shareWeights(), anyW = (s.l.exercises || []).some(x => x.weight != null);
  return `<div class="shseg" role="radiogroup" aria-label="Card style">
      <button role="radio" data-sharew="1" aria-checked="${w}" class="${w ? 'on' : ''}"${anyW ? '' : ' disabled'}>${ic('barbell')}With weights</button>
      <button role="radio" data-sharew="0" aria-checked="${!w}" class="${w ? '' : 'on'}">${ic('eye-slash')}Without weights</button></div>
    <div class="shpv"><img id="sharepv" alt="${esc(s.l.type)} workout card preview"><div class="shspin">Rendering…</div></div>
    <div class="caption" style="margin:10px 2px 14px">Exercise names, sets and reps always show. No body weight, HRV or link is included.</div>
    <button class="sharebtn wide go" data-sharego>${ic('share-network')}<span>Share image</span></button>
    <div id="sharefb" hidden></div>`;
}
async function renderSharePreview() {
  const s = SHR.s, gen = ++SHR.gen; if (!s) return;
  const blob = await new Promise(r => drawCard(s, {weights:shareWeights()}).toBlob(r, 'image/png'));
  if (gen !== SHR.gen) return;
  if (SHR.url) URL.revokeObjectURL(SHR.url);
  SHR.url = URL.createObjectURL(blob);
  SHR.file = new File([blob], `coach-${s.l.type.toLowerCase()}-${s.d}${shareWeights() ? '' : '-reps'}.png`, {type:'image/png'});
  const im = $('#sharepv'); if (im) { im.src = SHR.url; im.parentNode.classList.add('ready'); }
}
function openShare(key, trigger) {
  const [d, li] = key.split('/'), s = shareData(d, +li); if (!s) return;
  if (!(s.l.exercises || []).some(x => x.weight != null)) localStorage.setItem('coach.shareWeights', '0');
  Object.assign(SHR, {key, s, file:null});
  openSheet('Share workout', shareSheetBody(s), 'day', trigger);
  renderSharePreview();
}
function setShareWeights(on) {
  localStorage.setItem('coach.shareWeights', on ? '1' : '0');
  document.querySelectorAll('[data-sharew]').forEach(b => { const v = b.dataset.sharew === '1'; b.classList.toggle('on', v === on); b.setAttribute('aria-checked', v === on); });
  const pv = $('.shpv'); if (pv) pv.classList.remove('ready');
  renderSharePreview();
}
async function shareGo() {
  const s = SHR.s, file = SHR.file; if (!s || !file) return;
  const text = shareText(s);
  if (navigator.canShare && navigator.canShare({files:[file]})) {
    try { await navigator.share({files:[file], text}); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = SHR.url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  const fb = $('#sharefb'); if (!fb) return;
  fb.hidden = false;
  fb.innerHTML = `<div class="caption" style="margin:12px 2px">Image downloaded. Attach it to your post.</div>
    <a class="btn2" href="${SHR.url}" download="${esc(file.name)}">${ic('download-simple')} Download PNG</a>
    <a class="btn2" href="${esc('https://x.com/intent/post?text=' + encodeURIComponent(text))}" target="_blank" rel="noopener">${ic('x-logo')} Post to X</a>`;
}
boot();
})();
