#!/usr/bin/env python3
"""One-time OAuth connect for whoop | oura | fitbit. Runs a callback server on 127.0.0.1:8765 and writes
.secrets/<source>_tokens.json (mode 600). Never prints tokens.

Usage: python3 wearables/connect.py <source> [--port 8765]
  1. Register a developer app with redirect URI http://localhost:8765/callback (WHOOP: developer.whoop.com,
     Oura: cloud.ouraring.com/oauth/applications, Fitbit: dev.fitbit.com/apps, type "Personal").
  2. Put the client id/secret in .secrets/wearable.env (e.g. OURA_CLIENT_ID=..., OURA_CLIENT_SECRET=...), mode 600.
  3. Run this; open the printed URL in the box browser, where the user signs in and approves. The script exits when done.
"""
import argparse, base64, hashlib, http.server, importlib, json, os, secrets, sys, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import save_tokens, secret_env, UA   # noqa: E402


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("source", choices=("whoop", "oura", "fitbit")); ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    mod = importlib.import_module(a.source)
    up = a.source.upper()
    cid, cs = secret_env(f"{up}_CLIENT_ID"), secret_env(f"{up}_CLIENT_SECRET")
    redirect = f"http://localhost:{a.port}/callback"
    state = secrets.token_urlsafe(16)
    q = {"response_type": "code", "client_id": cid, "redirect_uri": redirect, "scope": mod.SCOPES, "state": state}
    verifier = None
    if getattr(mod, "PKCE", False):
        verifier = secrets.token_urlsafe(64)
        q.update(code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode(), code_challenge_method="S256")
    url = mod.AUTH_URL + "?" + urllib.parse.urlencode(q)
    print(f"Open this URL in the box browser and approve access:\n{url}", flush=True)
    done = {}

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            p = urllib.parse.urlparse(self.path); qs = urllib.parse.parse_qs(p.query)
            if p.path != "/callback": self.send_response(404); self.end_headers(); return
            if qs.get("state", [""])[0] != state or "code" not in qs:
                self.send_response(400); self.end_headers(); self.wfile.write(b"Bad state or missing code"); return
            body = {"grant_type": "authorization_code", "code": qs["code"][0], "redirect_uri": redirect}
            hdr = {"Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA}
            if a.source == "fitbit":
                hdr["Authorization"] = "Basic " + base64.b64encode(f"{cid}:{cs}".encode()).decode(); body["client_id"] = cid
            else:
                body.update(client_id=cid, client_secret=cs)
            if verifier: body["code_verifier"] = verifier
            try:
                r = urllib.request.urlopen(urllib.request.Request(mod.TOKEN_URL, data=urllib.parse.urlencode(body).encode(), headers=hdr), timeout=30)
                save_tokens(a.source, json.load(r)); done["ok"] = True; msg = f"Connected to {a.source}. You can close this tab.".encode()
            except Exception as ex:
                done["ok"] = False; msg = f"Token exchange failed ({type(ex).__name__}).".encode()
            self.send_response(200 if done["ok"] else 500); self.end_headers(); self.wfile.write(msg)

        def log_message(self, *x): pass

    srv = http.server.HTTPServer(("127.0.0.1", a.port), H)
    while "ok" not in done: srv.handle_request()
    print("connected" if done["ok"] else "failed"); sys.exit(0 if done["ok"] else 1)


if __name__ == "__main__":
    main()
