#!/usr/bin/env bash
# Coach starter: sync the wearable, rebuild dist/, and write Vercel connector payloads. No team or project is hardcoded.
#
#   ./publish.sh                 sync (if connected) + build + deploy-payload.json / deploy-payload-lite.json, exit 0
#   ./publish.sh --build         build + payloads only (no wearable sync)
#   ./publish.sh --mark-deployed after a READY deploy: remember dist/ SHA-1s so the next lite payload references them
#   ./publish.sh --verify        fetch every dist/ file from the live URL (deploy.json "url") and compare SHA-1s
#
# deploy.json (written by the bot after the first deploy; never shipped): {"project": "<vercel project name>", "url": "https://..."}
# The payload's project name comes from deploy.json, else COACH_PROJECT, else "coach-dashboard" (the first deploy creates it).
set -euo pipefail
cd "$(dirname "$0")"
exec 9>.publish.lock
flock -w 120 9 || { echo "another publish is running" >&2; exit 1; }
cfgval() { python3 -c 'import json,sys,os; d=json.load(open("deploy.json")) if os.path.exists("deploy.json") else {}; print(d.get(sys.argv[1]) or "")' "$1"; }
PROJECT="$(cfgval project)"; PROJECT="${PROJECT:-${COACH_PROJECT:-coach-dashboard}}"
PROD_URL="$(cfgval url)"; PROD_URL="${PROD_URL:-${COACH_URL:-}}"

if [[ "${1:-}" == "--mark-deployed" ]]; then
  # Record the SHA-1s of everything in dist/ as already stored on Vercel (run after a successful deploy),
  # so the next deploy-payload-lite.json references them by sha instead of inlining them.
  python3 - <<'PY'
import hashlib, json, os
p = ".vercel-known-shas.json"
known = set(json.load(open(p))) if os.path.exists(p) else set()
for root, dirs, files in os.walk("dist"):
    dirs[:] = [d for d in dirs if not d.startswith(".")]
    for n in files:
        if not n.startswith("."): known.add(hashlib.sha1(open(os.path.join(root, n), "rb").read()).hexdigest())
json.dump(sorted(known), open(p, "w"), indent=1); print(f"{len(known)} shas known")
PY
  exit 0
fi

if [[ "${1:-}" == "--verify" ]]; then
  [[ -n "$PROD_URL" ]] || { echo "no URL: write deploy.json {\"project\":..., \"url\":...} or set COACH_URL" >&2; exit 1; }
  [[ -f .secrets/session_secret ]] || { echo "missing .secrets/session_secret (same value as the COACH_SESSION_SECRET env var)" >&2; exit 1; }
  python3 - "$PROD_URL" <<'PY'
import hashlib, os, subprocess, sys, urllib.request
base, bad, n = sys.argv[1], [], 0
# The site is behind the password-gate middleware: authenticate with a short-lived session cookie minted from
# .secrets/session_secret (box-only; never deployed). Also confirm anonymous requests get no data.
cookie = subprocess.run([sys.executable, "tools/coach_cookie.py"], capture_output=True, text=True, check=True).stdout.strip()
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
import struct, zlib
MW_ICONS = set()
def pixels(b):
    if b[:4] == b"\x00\x00\x01\x00": b = b[22:]   # .ico wrapping one PNG
    if b[:8] != b"\x89PNG\r\n\x1a\n": return None
    i, ihdr, idat = 8, b"", b""
    while i < len(b):
        n, t = struct.unpack(">I4s", b[i:i + 8]); d = b[i + 8:i + 8 + n]; i += 12 + n
        if t == b"IHDR": ihdr = d
        elif t == b"IDAT": idat += d
    return ihdr, zlib.decompress(idat)
_m = sorted(os.listdir("dist/m"))[:1] if os.path.isdir("dist/m") else []   # meal photos must be gated too
for path in ("/", "/data.json", "/js/1.js", *["/m/" + x for x in _m]):
    try:
        r = urllib.request.build_opener(NoRedirect).open(urllib.request.Request(base + path, headers={"User-Agent": "CoachVerify/1.0"}), timeout=20)
        bad.append(f"gate: anonymous {path} returned {r.status}")
    except urllib.error.HTTPError as e:
        if e.code not in (302, 303, 401): bad.append(f"gate: anonymous {path} returned {e.code}")
for root, dirs, files in os.walk("dist"):
    dirs[:] = [d for d in dirs if not d.startswith(".")]
    for f in files:
        if f.startswith(".") or f in ("vercel.json", "middleware.js") or root.endswith("api"): continue   # api/ = function source, not served as a file
        rel = os.path.relpath(os.path.join(root, f), "dist"); n += 1
        try:
            req = urllib.request.Request(f"{base}/{rel}", headers={"User-Agent": "CoachVerify/1.0", "Cache-Control": "no-cache", "Cookie": cookie})
            live = urllib.request.urlopen(req, timeout=20).read()
        except Exception as ex:
            bad.append(f"{rel}: {ex}"); continue
        local = open(os.path.join(root, f), "rb").read()
        if rel in MW_ICONS:   # middleware-drawn icon: compression may differ, so compare decoded pixels
            if pixels(live) != pixels(local): bad.append(f"{rel}: icon pixels differ")
        elif hashlib.sha1(live).digest() != hashlib.sha1(local).digest(): bad.append(f"{rel}: sha mismatch")
print(f"verified {n - len([b for b in bad if not b.startswith('gate')])}/{n} files at {base}; gate {'FAIL' if any(b.startswith('gate') for b in bad) else 'ok (anonymous requests blocked)'}"); [print("  " + b) for b in bad]; sys.exit(1 if bad else 0)
PY
  exit $?
fi

# Step 1: pull fresh wearable data (never fails the publish; SKIP_SYNC=1 or --build skips it).
if [[ -z "${SKIP_SYNC:-}" && "${1:-}" != "--build" ]]; then
  timeout 120 python3 wearables/sync.py --quiet || echo "WARN: wearable sync failed or not connected; publishing the last synced data" >&2
fi
python3 setup.py --validate
# Coach Age: self-test the research model, then build.py recomputes it (plus pace and what-ifs) into dist/data.json
if [[ -f research/coach_age.py ]]; then
  timeout 60 python3 research/coach_age.py >/dev/null || echo "WARN: coach_age.py self-test failed; the app will show 'calculating' if compute() errors" >&2
fi
MINIFY="${MINIFY:-1}" python3 build.py   # minified by default so daily rebuilds reproduce the deployed JS/CSS SHAs (only data.json changes)
python3 -c 'import json,sys; c=json.load(open("dist/data.json")).get("coach_age",{}); print("Coach Age:", c.get("coach_age","(%s)" % c.get("status")), "| 80%", c.get("ci80"), "|", c.get("confidence"))'
PROJECT="$PROJECT" python3 - <<'PY'
import base64, hashlib, json, os
TEXT = (".html", ".txt", ".json", ".css", ".js", ".svg")
known = set(json.load(open(".vercel-known-shas.json"))) if os.path.exists(".vercel-known-shas.json") else set()
full, lite, missing = [], [], []
names = []
for root, dirs, files in os.walk("dist"):
    dirs[:] = [d for d in dirs if not d.startswith(".")]
    names += [os.path.relpath(os.path.join(root, n), "dist") for n in files if not n.startswith(".")]
MW_ICONS = set()
for name in sorted(names):
    if name in MW_ICONS: continue   # drawn and served by middleware.js; not deployed as files
    raw = open(os.path.join("dist", name), "rb").read()
    sha = hashlib.sha1(raw).hexdigest()
    inline = ({"file": name, "data": raw.decode(), "encoding": "utf-8"} if name.endswith(TEXT)
              else {"file": name, "data": base64.b64encode(raw).decode(), "encoding": "base64"})
    full.append(inline)
    if sha in known:
        lite.append({"file": name, "sha": sha, "size": len(raw)})
    else:
        lite.append(inline); missing.append(name)
def body(files):
    proj = os.environ["PROJECT"]
    return {"requestBody": {"name": proj, "project": proj, "target": "production",
            "files": files, "projectSettings": {"framework": None, "buildCommand": None,
            "installCommand": None, "outputDirectory": None}}, "forceNew": "1", "skipAutoDetectionConfirmation": "1"}
json.dump(body(full), open("deploy-payload.json", "w"))
json.dump(body(lite), open("deploy-payload-lite.json", "w"))
print(f"wrote deploy-payload.json ({os.path.getsize('deploy-payload.json')} B) and "
      f"deploy-payload-lite.json ({os.path.getsize('deploy-payload-lite.json')} B; inlined: {', '.join(missing) or 'none'})")
PY

echo "ready: send deploy-payload-lite.json (first deploy: deploy-payload.json) via the Vercel connector create_deployment"
echo "  (production, project $PROJECT, no teamId unless the user has several teams), wait for READY, then"
echo "  ./publish.sh --mark-deployed && ./publish.sh --verify"
