/* Coach password gate (Vercel Routing Middleware, Web APIs only; runs before every request, static files included).
   Secrets live only in Vercel project env vars: COACH_PASSWORD and COACH_SESSION_SECRET. Nothing secret is in this file.
   Session cookie = "v1.<expiry-seconds>.<base64url HMAC-SHA256(secret, 'v1.'+expiry)>", HttpOnly, Secure, SameSite=Lax, 1 year. */
export const config = { matcher: '/:path*' };

const COOKIE = 'coach_session';
const MAX_AGE = 365 * 24 * 3600;
// Public: the login/logout endpoints plus what iOS needs for Add to Home Screen (manifest, app icons, favicon).
// Icons are real static PNG files in the deploy (c5-*.png, apple-touch-icon*.png, favicon.ico); this file only lets them through the gate.
const PUBLIC = /^\/(login|logout|manifest\.json|robots\.txt|favicon\.ico|apple-touch-icon(-precomposed)?\.png|c[0-9]+-[a-z0-9-]+\.(png|svg))$/;
const enc = new TextEncoder();

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(msg));
}
function same(a, b) {   // constant-time compare of two equal-length byte arrays
  const x = new Uint8Array(a), y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const cookieOf = (req, name) => {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
};
async function valid(token, secret) {
  if (!token) return false;
  const m = /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m || +m[1] < Date.now() / 1000) return false;
  return same(enc.encode(b64u(await hmac(secret, 'v1.' + m[1]))), enc.encode(m[2]));
}
const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') && !n.startsWith('/login')) ? n : '/';
const next = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

const LOGIN_CSP = "default-src 'none'; script-src 'sha256-5jFG4LI8YIlsBoJMjM4XG4WbwE1TdX2Vm86bdVLt/2U='; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
function page(err, nxt, status = 200) {
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0b0b0b"><meta name="color-scheme" content="dark"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="__SITE_TITLE__">
<link rel="apple-touch-icon" sizes="180x180" href="/c5-180.png"><link rel="icon" type="image/png" sizes="32x32" href="/c5-32.png"><link rel="manifest" href="/manifest.json?v=5">
<title>__SITE_TITLE__ · Sign in</title><style>
*{box-sizing:border-box;margin:0}html,body{height:100%;overflow-x:hidden;max-width:100vw;-webkit-text-size-adjust:100%;touch-action:manipulation;overscroll-behavior-x:none;background:#0b0b0b;color:#fff;font:15px/20px -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body{display:grid;place-items:center;padding:calc(env(safe-area-inset-top) + 24px) 24px calc(env(safe-area-inset-bottom) + 24px)}
form{width:100%;max-width:360px;background:#1a1d21;border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:28px 20px}
img{display:block;width:64px;height:64px;border-radius:15px;margin:0 auto 16px}
h1{font-weight:800;font-size:22px;line-height:28px;letter-spacing:.08em;text-transform:uppercase;text-align:center}
p{color:#9ba1a6;text-align:center;margin:6px 0 22px;font-size:13px}
label{display:block;font-weight:600;font-size:11px;line-height:14px;letter-spacing:.12em;text-transform:uppercase;color:#9ba1a6;margin-bottom:8px}
input{font-family:inherit;width:100%;height:48px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0f1113;color:#fff;font-size:17px;padding:0 14px;outline:none}
input:focus{border-color:#00a3ff}
button{width:100%;height:48px;margin-top:16px;border:0;border-radius:24px;background:#fff;color:#000;font-family:inherit;font-weight:700;font-size:13px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
.err{color:#ff5a68;text-align:center;margin:14px 0 0;font-size:13px;min-height:18px}
</style></head><body><form method="post" action="/login" autocomplete="on">
<img src="/c5-180.png" alt=""><h1>__SITE_TITLE__</h1><p>Private dashboard. Sign in once on each device.</p>
<input type="text" name="username" value="coach" autocomplete="username" hidden aria-hidden="true">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus enterkeyhint="go">
<input type="hidden" name="next" value="${esc(nxt)}">
<button type="submit">Sign in</button><div class="err" role="alert">${err ? 'Incorrect password.' : ''}</div></form>
<script>var n=document.querySelector('input[name=next]');if(location.hash&&n.value.indexOf('#')<0)n.value+=location.hash;</script></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': LOGIN_CSP, 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
}

export default async function middleware(req) {
  const url = new URL(req.url), path = url.pathname;
  const PW = process.env.COACH_PASSWORD, SECRET = process.env.COACH_SESSION_SECRET;
  if (!PW || !SECRET) return new Response('Coach is locked: server password not configured.', { status: 503, headers: { 'cache-control': 'no-store' } });

  if (path === '/logout') {
    return new Response(null, { status: 303, headers: { location: '/login', 'cache-control': 'no-store',
      'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (path === '/login') {
    if (req.method === 'POST') {
      let pw = '', nxt = '/';
      try { const f = await req.formData(); pw = String(f.get('password') || ''); nxt = safeNext(String(f.get('next') || '/')); } catch (e) { /* bad body */ }
      // Compare HMACs of both strings (fixed 32-byte length) so timing doesn't leak length or prefix.
      const ok = same(await hmac(SECRET, 'pw:' + pw), await hmac(SECRET, 'pw:' + PW));
      if (!ok) { await new Promise(r => setTimeout(r, 900)); return page(true, nxt, 401); }
      const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
      const token = `v1.${exp}.${b64u(await hmac(SECRET, 'v1.' + exp))}`;
      return new Response(null, { status: 303, headers: { location: nxt, 'cache-control': 'no-store',
        'set-cookie': `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax` } });
    }
    if (await valid(cookieOf(req, COOKIE), SECRET)) return Response.redirect(new URL(safeNext(url.searchParams.get('next')), url), 303);
    return page(false, safeNext(url.searchParams.get('next')));
  }
  if (PUBLIC.test(path)) return next();
  if (await valid(cookieOf(req, COOKIE), SECRET)) return next();
  // Machine auth for the box's wearable sync: /api/* may pass with a Bearer header; api/refresh.js verifies it against SYNC_SHARED_SECRET (else 401).
  if (path.startsWith('/api/') && (req.headers.get('authorization') || '').startsWith('Bearer ')) return next();
  const wantsHtml = (req.headers.get('accept') || '').includes('text/html');
  if (req.method === 'GET' && wantsHtml) {
    return new Response(null, { status: 302, headers: { location: '/login?next=' + encodeURIComponent(path + url.search), 'cache-control': 'no-store' } });
  }
  return new Response('Unauthorized', { status: 401, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' } });
}
