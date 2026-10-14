/* Coach live wearable refresh (Vercel Node function). Implemented for WEARABLE=whoop; for oura / fitbit / none it answers
   {days:{}, unsupported:true} (the box sync + publish keeps those current; see README).
   - Auth: valid coach_session cookie (same HMAC format as middleware.js) OR "Authorization: Bearer <SYNC_SHARED_SECRET>" (box sync).
   - This function is the single owner of the rotating WHOOP refresh token. It lives in the private Blob store
     (path whoop/state.json); WHOOP_REFRESH_TOKEN_SEED is only used when the blob does not exist yet.
   - GET /api/refresh            -> {days:{...}, synced_at, ...}  (last ~4 days, same shape/transforms as whoop/sync.py)
   - GET /api/refresh?mode=token -> {access_token, expires_at}  (bearer only; for sync.py on the box)
   Nothing secret is ever logged or returned except the short-lived access token to the bearer-authenticated box. */
const crypto = require('crypto');
const API = 'https://api.prod.whoop.com/developer';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const UA = 'CoachDashboard/1.0';
const TZ = process.env.COACH_TZ || 'UTC';   // set to the config timezone (README: env vars)
const STATE_PATH = 'whoop/state.json';

const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function cookieOk(req) {
  const secret = process.env.COACH_SESSION_SECRET; if (!secret) return false;
  const m = /(?:^|;\s*)coach_session=v1\.(\d{10})\.([A-Za-z0-9_-]{43})/.exec(req.headers.cookie || '');
  if (!m || +m[1] < Date.now() / 1000) return false;
  const sig = crypto.createHmac('sha256', secret).update('v1.' + m[1]).digest('base64url');
  return eq(sig, m[2]);
}
function bearerOk(req) {
  const s = process.env.SYNC_SHARED_SECRET; const h = req.headers.authorization || '';
  return !!s && s.length >= 20 && h.startsWith('Bearer ') && eq(h.slice(7), s);
}

// ---- Blob (private store, REST) ----
const blobTok = () => process.env.BLOB_READ_WRITE_TOKEN;
const storeId = () => (blobTok() || '').split('_')[3] || '';
async function blobGet() {
  const r = await fetch(`https://${storeId()}.private.blob.vercel-storage.com/${STATE_PATH}?cache=0`, { headers: { authorization: 'Bearer ' + blobTok() } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('blob read ' + r.status);
  return r.json();
}
async function blobPut(obj) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://vercel.com/api/blob/?pathname=' + encodeURIComponent(STATE_PATH), { method: 'PUT', body: JSON.stringify(obj), headers: {
        authorization: 'Bearer ' + blobTok(), 'x-api-version': '12', 'x-vercel-blob-store-id': storeId(), 'x-vercel-blob-access': 'private',
        'x-allow-overwrite': '1', 'x-add-random-suffix': '0', 'x-content-type': 'application/json', 'x-cache-control-max-age': '60' } });
      if (r.ok) return; last = 'blob write ' + r.status;
    } catch (e) { last = 'blob write network'; }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(last);
}

// ---- WHOOP token (rotating) ----
async function whoopRefresh(rt) {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA, accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: process.env.WHOOP_CLIENT_ID || '', client_secret: process.env.WHOOP_CLIENT_SECRET || '', scope: 'offline' }) });
  if (!r.ok) { const e = new Error('token refresh HTTP ' + r.status); e.status = r.status; throw e; }
  const j = await r.json();
  if (!j.access_token) throw new Error('token refresh: no access_token');
  return { access_token: j.access_token, refresh_token: j.refresh_token || rt, expires_at: Math.floor(Date.now() / 1000) + (+j.expires_in || 3600) };
}
async function getAccess(force) {
  let st = await blobGet();
  if (st && st.access_token && !force && st.expires_at - Date.now() / 1000 > 300) return st;
  const rt = (st && st.refresh_token) || process.env.WHOOP_REFRESH_TOKEN_SEED;
  if (!rt) throw new Error('no refresh token available');
  let fresh;
  try { fresh = await whoopRefresh(rt); }
  catch (e) {
    // Lost a race with a concurrent refresh? Re-read the blob: if someone else already rotated, use their result.
    const again = await blobGet();
    if (again && again.refresh_token !== rt && again.expires_at - Date.now() / 1000 > 60) return again;
    throw e;
  }
  await blobPut(fresh);   // persist the rotated token BEFORE doing anything else with it
  return fresh;
}
async function wget(path, params, tok) {
  const u = new URL(API + path); for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  for (let a = 0; a < 3; a++) {
    const r = await fetch(u, { headers: { authorization: 'Bearer ' + tok.access_token, 'user-agent': UA, accept: 'application/json' } });
    if (r.status === 429) { await new Promise(s => setTimeout(s, 1500)); continue; }
    if (r.status === 401) { const e = new Error('whoop 401'); e.status = 401; throw e; }
    if (!r.ok) throw new Error(`whoop ${path} ${r.status}`);
    return r.json();
  }
  throw new Error('whoop rate limited');
}
async function collection(path, start, end, tok) {
  const out = []; let nxt;
  for (let i = 0; i < 20; i++) {
    const p = { start, end, limit: '25' }; if (nxt) p.nextToken = nxt;
    const j = await wget(path, p, tok); out.push(...(j.records || [])); nxt = j.next_token; if (!nxt) break;
  }
  return out;
}

// ---- Transforms: a line-for-line port of whoop/sync.py ----
const dtf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset' });
function ctw(iso) {   // CT wall-clock fields + UTC offset for an ISO instant
  if (!iso) return null;
  const p = {}; for (const x of dtf.formatToParts(new Date(iso))) p[x.type] = x.value;
  const m = /GMT([+-])(\d\d):(\d\d)/.exec(p.timeZoneName || '');
  const off = m ? (m[1] === '-' ? '-' : '+') + m[2] + ':' + m[3] : '+00:00';
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, off };
}
const pad = n => String(n).padStart(2, '0');
const dateOf = w => `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
const isoMin = w => `${dateOf(w)}T${pad(w.h)}:${pad(w.mi)}${w.off}`;
function plus12h(w) { const t = new Date(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) + 12 * 3600e3); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; }
function pyRound(x, n) {   // Python round(): exact-decimal rounding, exact binary ties go to even
  const f = Math.pow(10, n), t = Math.pow(2, n);
  if (Number.isInteger(x * 2 * t) && !Number.isInteger(x * t)) { const y = x * f, r = Math.floor(y); return (r % 2 === 0 ? r : r + 1) / f; }
  return Number(x.toFixed(n));
}
const r1 = (x, n = 1) => (typeof x !== 'number' || !isFinite(x)) ? null : pyRound(x, n);
const fm = v => Math.trunc((v || 0) / 60000);
const nz = v => v === undefined ? null : v;

function transform(cycles, sleeps, recs, works) {
  const out = {}; const day = d => out[d] || (out[d] = { workouts: [] });
  const cycDate = {};
  for (const cy of cycles) {
    const st = ctw(cy.start), d = plus12h(st); cycDate[cy.id] = d; const sc = cy.score || {};
    day(d).cycle = { strain: r1(sc.strain), kj: r1(sc.kilojoule, 0), kcal: sc.kilojoule != null ? r1(sc.kilojoule / 4.184, 0) : null,
      avg_hr: nz(sc.average_heart_rate), max_hr: nz(sc.max_heart_rate), start: isoMin(st), end: cy.end ? isoMin(ctw(cy.end)) : null,
      state: nz(cy.score_state), id: cy.id };
  }
  const sleepDate = {};
  for (const sl of sleeps) {
    const en = ctw(sl.end), d = dateOf(en); sleepDate[sl.id] = d; const sc = sl.score || {}, ss = sc.stage_summary || {};
    const mIn = fm(ss.total_in_bed_time_milli), mDeep = fm(ss.total_slow_wave_sleep_time_milli), mRem = fm(ss.total_rem_sleep_time_milli);
    const mAsleep = fm((ss.total_light_sleep_time_milli || 0) + (ss.total_slow_wave_sleep_time_milli || 0) + (ss.total_rem_sleep_time_milli || 0));
    const stm = { light: Math.max(0, mAsleep - mDeep - mRem), deep: mDeep, rem: mRem, awake: Math.max(0, mIn - mAsleep) };
    const h = m => pyRound(m / 60, 4); const need = sc.sleep_needed || {};
    const nd = {}; for (const k of ['need_from_sleep_debt_milli', 'need_from_recent_strain_milli', 'need_from_recent_nap_milli']) nd[k] = fm(need[k]);
    const mNeed = fm((need.baseline_milli || 0) + (need.need_from_sleep_debt_milli || 0) + (need.need_from_recent_strain_milli || 0) + (need.need_from_recent_nap_milli || 0));
    const hasNeed = Object.keys(need).length > 0;
    const stages = {}; for (const [k, v] of Object.entries(stm)) stages[k] = h(v);
    const rec = { performance: r1(sc.sleep_performance_percentage, 0), hours_asleep: mAsleep ? h(mAsleep) : null, hours_in_bed: h(mIn) || null,
      no_data_hours: r1((ss.total_no_data_time_milli || 0) / 3.6e6, 2), efficiency: r1(sc.sleep_efficiency_percentage), consistency: r1(sc.sleep_consistency_percentage, 0),
      respiratory_rate: r1(sc.respiratory_rate), stages, disturbances: nz(ss.disturbance_count), cycles: nz(ss.sleep_cycle_count),
      need_hours: mNeed ? h(mNeed) : null,
      need_breakdown: hasNeed ? { baseline: h(Math.max(0, mNeed - nd.need_from_sleep_debt_milli - nd.need_from_recent_strain_milli - nd.need_from_recent_nap_milli)),
        debt: h(nd.need_from_sleep_debt_milli), strain: h(nd.need_from_recent_strain_milli), nap: h(nd.need_from_recent_nap_milli) } : null,
      start: isoMin(ctw(sl.start)), end: isoMin(en), state: nz(sl.score_state) };
    if (sl.nap) (day(d).naps || (day(d).naps = [])).push(rec);
    else { const prev = day(d).sleep; if (!prev || (rec.hours_in_bed || 0) > (prev.hours_in_bed || 0)) day(d).sleep = rec; }
  }
  for (const rc of recs) {
    const d = sleepDate[rc.sleep_id] || cycDate[rc.cycle_id]; if (!d) continue; const sc = rc.score || {};
    day(d).recovery = { score: r1(sc.recovery_score, 0), hrv: r1(sc.hrv_rmssd_milli), rhr: r1(sc.resting_heart_rate, 0), spo2: r1(sc.spo2_percentage),
      skin_temp_c: r1(sc.skin_temp_celsius), calibrating: nz(sc.user_calibrating), state: nz(rc.score_state) };
  }
  for (const w of [...works].sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0)) {
    const st = ctw(w.start), en = ctw(w.end), sc = w.score || {}, z = sc.zone_durations;
    day(dateOf(st)).workouts.push({ sport: w.sport_name || String(w.sport_id != null ? w.sport_id : 'activity'), strain: r1(sc.strain),
      avg_hr: nz(sc.average_heart_rate), max_hr: nz(sc.max_heart_rate), kcal: sc.kilojoule != null ? r1(sc.kilojoule / 4.184, 0) : null, kj: r1(sc.kilojoule, 0),
      tz: nz(w.timezone_offset), start: isoMin(st), end: isoMin(en), state: nz(w.score_state),
      distance_m: r1(sc.distance_meter, 0), altitude_gain_m: r1(sc.altitude_gain_meter, 0), altitude_change_m: r1(sc.altitude_change_meter, 0), percent_recorded: r1(sc.percent_recorded, 0),
      zones_min: z ? ['zero', 'one', 'two', 'three', 'four', 'five'].map(n => r1((z[`zone_${n}_milli`] || 0) / 60000, 1)) : null });
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store'); res.setHeader('x-robots-tag', 'noindex');
  const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
  if (req.method !== 'GET') return send(405, { error: 'method' });
  const isBearer = bearerOk(req);
  if (!isBearer && !cookieOk(req)) return send(401, { error: 'unauthorized' });
  const q = new URL(req.url, 'http://x').searchParams;
  if ((process.env.WEARABLE || 'whoop') !== 'whoop') return send(200, { days: {}, unsupported: true });
  try {
    if (q.get('mode') === 'token') {
      if (!isBearer) return send(403, { error: 'forbidden' });
      const t = await getAccess(q.get('force') === '1');
      return send(200, { access_token: t.access_token, expires_at: t.expires_at });
    }
    let tok = await getAccess(false);
    const now = Date.now(), fmt = d => d.toISOString().replace(/\.\d+Z$/, '.000Z');
    const start = fmt(new Date(now - 4 * 86400e3)), end = fmt(new Date(now + 3600e3));
    const pull = async () => Promise.all([collection('/v2/cycle', start, end, tok), collection('/v2/activity/sleep', start, end, tok),
      collection('/v2/recovery', start, end, tok), collection('/v2/activity/workout', start, end, tok)]);
    let got;
    try { got = await pull(); } catch (e) { if (e.status !== 401) throw e; tok = await getAccess(true); got = await pull(); }
    const days = transform(...got);
    const cutoff = (() => { const w = ctw(new Date(now - 2 * 86400e3).toISOString()); return dateOf(w); })();
    for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
    return send(200, { days, cutoff, server_time: new Date(now).toISOString() });
  } catch (e) {
    console.error('refresh failed:', String(e && e.message || e).replace(/[A-Za-z0-9_\-\.]{30,}/g, '[x]'));
    return send(502, { error: 'upstream' });
  }
};
