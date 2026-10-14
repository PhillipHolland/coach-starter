#!/usr/bin/env python3
"""Build the Coach PWA into dist/.

dist/ layout (same origin, no external requests):
  index.html, app.css, js/N.js, i/*.svg  static app shell (from app/; rarely change -> SHA-referenced on deploy)
  data.json                       everything that changes daily (compact JSON)
  wear/YYYY-MM.json               wearable days for completed months (immutable once the month is over)
  icons, manifest.json, robots.txt, vercel.json
"""
import html, json, os, re, shutil, struct
from html import escape as _esc
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "dist")
TZ = ZoneInfo("UTC")   # replaced in main() by data.json profile.timezone

from workout_parse import enrich as enrich_workout  # noqa: E402


DROP = {"id", "sleep_id", "cycle_id"}
# Closed-month archives keep the older, slimmer shape so their bytes (and Vercel SHAs) stay stable across deploys.
DROP_ARCHIVE = {"id", "state", "sleep_id", "cycle_id", "percent_recorded", "altitude_change_m", "user_calibrating", "kj", "tz", "no_data_hours", "calibrating"}


def slim_day(v, archive=False):
    """Drop fields the app never shows (ids) to keep the deploy payload small."""
    DROP = DROP_ARCHIVE if archive else globals()["DROP"]
    out = {}
    for k, x in v.items():
        if k == "naps":
            if x: out["naps"] = [{"hours_asleep": n.get("hours_asleep"), "start": n.get("start"), "end": n.get("end")} for n in x]
        elif k == "cycle" and isinstance(x, dict):
            out[k] = {kk: vv for kk, vv in x.items() if kk not in DROP and not (archive and kk in ("start", "end"))}
        elif k == "workouts":
            out[k] = [{kk: vv for kk, vv in w.items() if kk not in DROP and vv is not None} for w in x]
        elif isinstance(x, dict):
            out[k] = {kk: vv for kk, vv in x.items() if kk not in DROP}
        else:
            out[k] = x
    return out


def chrono_age(profile, today):
    b = profile.get("birth_date")
    if not b: return None
    y, m, dd = map(int, b.split("-"))
    return today.year - y - ((today.month, today.day) < (m, dd))


CA_LABELS = {"cardiorespiratory_fitness": "Cardio fitness (est. VO2max)", "resting_hr": "Resting heart rate", "hrv": "HRV",
             "sleep_regularity": "Sleep consistency", "sleep_duration": "Sleep duration", "aerobic_activity": "Aerobic activity",
             "strength_training": "Strength training", "pullup_strength": "Pull-up strength", "body_mass_index": "BMI",
             "alcohol": "Alcohol", "sauna": "Sauna", "added_sugar": "Added sugar"}


def _ca_source(c):
    """One-line source for a spec component: first of hr / curve / anchor / top-level / norm that names one."""
    cands = []
    for k in ("hr", "curve", "anchor"):
        v = c.get(k)
        if isinstance(v, dict):
            v = v if "source" in v else v.get("male") if isinstance(v.get("male"), dict) else {}
            cands.append((v.get("source"), v.get("url")))
    cands.append((c.get("source"), c.get("url")))
    if isinstance(c.get("norm"), dict): cands.append((c["norm"].get("source"), c["norm"].get("url")))
    src, url = next(((s_, u) for s_, u in cands if s_), ("", None))
    if src.upper().startswith("HEURISTIC:"):
        short = "Heuristic: " + src.split(":", 1)[1].strip()
    else:
        short = re.split(r"[:;]| \(|,? Tables? ", src)[0].strip()
    return short[:70], url


def coach_age(d, today):
    """Coach Age from research/coach_age.py (compute(data, chronological_age), pace_of_aging, from_coach_data).
    Recomputed on every build/publish; what-ifs are re-run through the same model. Errors never break the build:
    the app then shows 'Coach Age: calculating, coming soon'."""
    import copy, importlib.util
    path = os.path.join(HERE, "research", "coach_age.py")
    prof = d.get("profile", {})
    if not os.path.exists(path):
        return {"status": "pending"}
    if not prof.get("birth_date"):
        return {"status": "needs_birth_date"}
    try:
        spec = importlib.util.spec_from_file_location("coach_age", path)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        try:
            meta = {c["id"]: c for c in json.load(open(os.path.join(HERE, "research", "coach_age_spec.json")))["components"]}
        except Exception:
            meta = {}
        T = today.isoformat()
        age = (today - date.fromisoformat(prof["birth_date"])).days / 365.2425
        sex = prof.get("sex", "male")
        canon = mod.from_coach_data(d)
        r = mod.compute(canon, age, sex, T)
        pace = mod.pace_of_aging(canon, age, sex, T)
        if pace.get("status") != "ok":   # each extra qualifying day needs a worn day, so the earliest unlock is today + missing points
            pace["unlock_date"] = (today + timedelta(days=max(0, pace.get("min_points", 21) - pace.get("points", 0)))).isoformat()

        def what_if(weight=None, consistency=None, sleep_h=None):
            c = copy.deepcopy(canon)
            if weight is not None:
                c["weights_lb"] = [w for w in c.get("weights_lb", []) if w[0] != T] + [[T, weight]]
            for v in c.get("days", {}).values():
                if sleep_h and v.get("sleep_hours"): v["sleep_hours"] = max(sleep_h, v["sleep_hours"])
                if consistency and v.get("sleep_consistency"): v["sleep_consistency"] = max(consistency, v["sleep_consistency"])
            return mod.compute(c, age, sex, T)["coach_age"]
        goal = prof.get("goal_weight")
        unit = prof.get("units", "lb")
        goal_lb = goal * 2.20462 if goal and unit == "kg" else goal
        whatifs = []
        if goal:
            whatifs.append({"label": f"At {goal:g} {unit} (goal weight)", "coach_age": what_if(weight=goal_lb)})
            whatifs.append({"label": f"At {goal:g} {unit}, 82% sleep consistency, 7.1 h sleep", "coach_age": what_if(goal_lb, 82, 7.1)})
        whatifs.append({"label": "82% sleep consistency and 7.1 h sleep", "coach_age": what_if(None, 82, 7.1)})

        comps = []
        for k, c in r["components"].items():
            m = meta.get(k, {}); src, url = _ca_source(m)
            tier = str(c.get("tier", ""))
            comps.append({"id": k, "label": CA_LABELS.get(k, k.replace("_", " ").capitalize()), "status": c["status"],
                          "value": c.get("value"), "unit": c.get("unit"), "referent": c.get("referent"),
                          "years": c.get("years", 0.0), "se_years": c.get("se_years"), "n": c.get("n"), "min_n": c.get("min_n"),
                          "badge": "evidence" if tier.startswith("evidence") else "estimate", "tier": tier,
                          "source": src, "url": url, "note": (c.get("detail") or {}).get("note")})
        comps.sort(key=lambda x: (x["status"] != "ok", -abs(x["years"] or 0)))
        out = {"status": "ok", "as_of": r["as_of"], "chronological_age": round(age, 1), "coach_age": r["coach_age"],
               "delta_years": r["delta_years"], "ci80": r["ci80"], "ci95": r["ci95"], "confidence": r["confidence"],
               "coverage": r["coverage"], "metabolic_age": r["metabolic_age"], "top_levers": r["top_levers"],
               "pace": pace, "components": comps, "whatifs": whatifs, "gompertz_g": r.get("gompertz_g")}
        return json.loads(json.dumps(out, default=str))
    except Exception as ex:   # keep publishing; show the pending card and log why
        print(f"WARN: coach_age failed: {type(ex).__name__}: {ex}")
        return {"status": "pending", "error": type(ex).__name__}


def _inline_md(t):
    t = html.escape(t, quote=True)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<i>\1</i>", t)
    t = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', t)
    t = re.sub(r'(?<![="])(https?://[^\s<)]+[^\s<).,;])', r'<a href="\1" target="_blank" rel="noopener noreferrer">\1</a>', t)
    return t


def md_to_html(md):
    """Tiny, safe Markdown subset (headings, lists, tables, bold/italic/code, links) for the Method & sources sheet.
    All text is HTML-escaped first; only http(s) links are produced."""
    out, para, lst, tbl = [], [], None, []
    def flush():
        nonlocal para, lst, tbl
        if para: out.append("<p>" + _inline_md(" ".join(para)) + "</p>"); para = []
        if lst: out.append(f"<{lst[0]}>" + "".join(f"<li>{_inline_md(x)}</li>" for x in lst[1]) + f"</{lst[0]}>"); lst = None
        if tbl:
            rows = [[c.strip() for c in r.strip().strip("|").split("|")] for r in tbl if not re.match(r"^\s*\|?\s*:?-{3,}", r)]
            out.append('<div class="mdt"><table>' + "".join("<tr>" + "".join(f"<{'th' if i == 0 else 'td'}>{_inline_md(c)}</{'th' if i == 0 else 'td'}>" for c in r) + "</tr>" for i, r in enumerate(rows)) + "</table></div>"); tbl = []
    for line in md.splitlines():
        if not line.strip(): flush(); continue
        if line.lstrip().startswith("|"): (para and flush()); tbl.append(line); continue
        if tbl: flush()
        m = re.match(r"^(#{1,4})\s+(.*)", line)
        if m: flush(); lvl = min(4, len(m[1]) + 1); out.append(f"<h{lvl}>{_inline_md(m[2])}</h{lvl}>"); continue
        if re.match(r"^-{3,}\s*$", line): flush(); out.append("<hr>"); continue
        m = re.match(r"^\s*([*-]|\d+\.)\s+(.*)", line)
        if m:
            kind = "ol" if m[1][0].isdigit() else "ul"
            if para: flush()
            if lst and lst[0] != kind: flush()
            lst = lst or (kind, []); lst[1].append(m[2]); continue
        if lst and line.startswith("  "): lst[1][-1] += " " + line.strip(); continue
        if lst: flush()
        para.append(line.strip())
    flush()
    return "\n".join(out)


PUBLIC_CONFIG = ("site_title", "brand", "theme", "wearable", "units", "timezone", "goal", "features")


def payload(d, now):
    today = now.date()
    cur_month = today.strftime("%Y-%m")
    W = d.get("wear") or {}
    days = {k: slim_day(v, k[:7] < cur_month) for k, v in (W.get("days") or {}).items()}
    recent = {k: v for k, v in days.items() if k[:7] >= cur_month}
    months = {}
    for k, v in days.items():
        if k[:7] < cur_month: months.setdefault(k[:7], {})[k] = v
    workouts = []
    for w in d.get("workouts", []):
        workouts.append(enrich_workout(w, (d.get("profile") or {}).get("units", "lb")))
    p = {
        "v": 2, "generated_at": now.isoformat(timespec="seconds"), "today": today.isoformat(), "updated_at": d.get("updated_at"),
        "profile": {**d.get("profile", {}), "age": chrono_age(d.get("profile", {}), today)},
        "coach_age": coach_age(d, today), "targets": {k: v for k, v in d.get("targets", {}).items() if not k.startswith("_")},
        "supplements": d.get("supplements", []), "split": d.get("split", {}),
        "weights": d.get("weights", []), "food": d.get("food", []), "supplement_log": d.get("supplement_log", {}),
        "pullup_max": d.get("pullup_max", []), "pullup_context": d.get("pullup_context"), "gtg": d.get("gtg", []),
        "workouts": workouts, "journal": d.get("journal", {}),
        "config": {k: v for k, v in (d.get("config") or {}).items() if k in PUBLIC_CONFIG},
        "wear": {"source": W.get("source") or (d.get("config") or {}).get("wearable", "none"), "profile": W.get("profile", {}),
                 "synced_at": W.get("synced_at"), "first_day": W.get("first_day"), "days": recent, "months": sorted(months)},
    }
    return p, months


def phosphor(html, js):
    """Write dist/i/<name>.svg (one <symbol id="i"> each) for only the Phosphor icons (MIT, app/phosphor/) that
    index.html and app.js reference. Small separate files keep connector deploys verifiable file-by-file."""
    reg, fil = set(), set()
    for m in re.finditer(r"/i/([a-z0-9-]+)\.svg#i", html):
        (fil.add(m[1][:-5]) if m[1].endswith("-fill") else reg.add(m[1]))
    for m in re.finditer(r"\bic\('([a-z0-9-]+)'(?:,\s*(\d))?", js):
        (fil if m[2] == "1" else reg).add(m[1])
    for m in re.finditer(r"/\* icons used dynamically: ([^*]+)\*/", js):
        reg.update(m[1].split())
    os.makedirs(os.path.join(OUT, "i"), exist_ok=True)
    for weight, names in (("regular", reg), ("fill", fil)):
        for n in sorted(names):
            nm = n + ("-fill" if weight == "fill" else "")
            fn = os.path.join(HERE, "app", "phosphor", weight, nm + ".svg")
            if not os.path.exists(fn):
                raise SystemExit(f"missing Phosphor icon {weight}/{n} (copy it from @phosphor-icons/core into app/phosphor/)")
            with open(fn) as f:
                inner = re.sub(r"^.*?<svg[^>]*>|</svg>\s*$", "", f.read().strip(), flags=re.S)
            with open(os.path.join(OUT, "i", nm + ".svg"), "w") as f:
                f.write(f'<svg xmlns="http://www.w3.org/2000/svg"><symbol id="i" viewBox="0 0 256 256">{inner}</symbol></svg>\n')
    return len(reg) + len(fil)


def split_js(js, limit=12000):
    """Split app.js (one IIFE) into dist/js/N.js at its '/* ---------- section ---------- */' markers.
    Classic deferred scripts run in order and share one global lexical scope, so this is equivalent;
    smaller files make each connector upload easy to verify by SHA. Returns the script paths."""
    body = js.strip()
    assert body.splitlines()[1].strip() == "(() => {" and body.endswith("})();"), "app.js must be a single IIFE"
    lines = body.splitlines()[2:-1]
    secs, cur = [], []
    for ln in lines:
        if ln.startswith("/* ---------- ") and cur:
            secs.append("\n".join(cur)); cur = []
        cur.append(ln)
    secs.append("\n".join(cur))
    parts, buf = [], ""
    for sec in secs:
        if buf and len(buf) + len(sec) > limit:
            parts.append(buf); buf = ""
        buf += sec + "\n"
    parts.append(buf)
    os.makedirs(os.path.join(OUT, "js"), exist_ok=True)
    out = []
    for i, p in enumerate(parts, 1):
        p = p if p.lstrip().startswith("'use strict'") else "'use strict';\n" + p
        with open(os.path.join(OUT, "js", f"{i}.js"), "w") as f:
            f.write(f"/* Coach PWA part {i}/{len(parts)} (built from app/app.js) */\n" + p)
        out.append(f"/js/{i}.js")
    return out


def minify():
    """Shrink app.js (terser, if installed in tools/) and app.css (comment/whitespace strip). Sources stay readable in app/."""
    import subprocess
    terser = os.path.join(HERE, "tools", "node_modules", ".bin", "terser")
    if os.environ.get("MINIFY") != "1": return  # off by default: dist matches app/ so connector deploys are easy to verify
    import glob
    for js in glob.glob(os.path.join(OUT, "js", "*.js")) if os.path.exists(terser) else []:
        r = subprocess.run([terser, js, "-c", "-m", "-o", js], capture_output=True, text=True)
        if r.returncode: print("terser failed, shipping unminified", js, r.stderr[:200])
    css = os.path.join(OUT, "app.css")
    with open(css) as f: s = f.read()
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    with open(css, "w") as f: f.write(s)


def dump(path, obj):
    """Compact JSON, but one top-level key (and one WHOOP day) per line so files stay diff/read friendly."""
    c = lambda o: json.dumps(o, separators=(",", ":"), ensure_ascii=False)
    def block(d):
        return "{\n" + ",\n".join(f"{c(k)}:{c(v)}" for k, v in d.items()) + "\n}"
    parts = []
    for k, v in obj.items():
        if k == "wear" and isinstance(v, dict) and "days" in v:
            inner = [f"{c(kk)}:{block(vv) if kk == 'days' else c(vv)}" for kk, vv in v.items()]
            parts.append(f"{c(k)}:{{" + ",\n".join(inner) + "}")
        else:
            parts.append(f"{c(k)}:{c(v)}")
    with open(path, "w") as f:
        f.write("{\n" + ",\n".join(parts) + "\n}\n")


def main():
    global TZ
    with open(os.path.join(HERE, "data.json")) as f:
        d = json.load(f)
    from setup import validate_data
    errs = validate_data(d)
    if errs:
        raise SystemExit("data.json is invalid (run: python3 setup.py --validate):\n  " + "\n  ".join(errs))
    TZ = ZoneInfo((d.get("profile") or {}).get("timezone") or "UTC")
    cfg = d.get("config") or {}
    title = cfg.get("site_title") or "Coach"
    now = datetime.now(TZ)
    p, months = payload(d, now)
    if os.path.isdir(OUT):
        for n in os.listdir(OUT):
            if n.startswith("."): continue  # keep .vercel/ (CLI link)
            fp = os.path.join(OUT, n)
            shutil.rmtree(fp) if os.path.isdir(fp) else os.unlink(fp)
    os.makedirs(os.path.join(OUT, "wear"), exist_ok=True)
    dump(os.path.join(OUT, "data.json"), p)
    for m, v in months.items():
        dump(os.path.join(OUT, "wear", f"{m}.json"), v)
    rmd = os.path.join(HERE, "research", "coach_age_research.md")
    if os.path.exists(rmd):   # Method & sources sheet (fetched on demand)
        with open(rmd) as f, open(os.path.join(OUT, "coach-age-method.html"), "w") as g:
            g.write(md_to_html(f.read()))
    # Meal photos (log.py food --photo): only those referenced by a food entry ship, as dist/m/<id>.jpg + <id>-t.jpg.
    # They are ordinary static files, so the password-gate middleware covers them like data.json. Ids are random, and a
    # photo never changes once written, so after the first deploy the lite payload references it by SHA (no re-upload).
    shipped = 0
    for f in d.get("food", []):
        pid = f.get("photo")
        if not pid or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{12}", pid): continue
        for sfx in ("", "-t"):
            src = os.path.join(HERE, "meals", pid + sfx + ".jpg")
            if os.path.exists(src):
                os.makedirs(os.path.join(OUT, "m"), exist_ok=True)
                shutil.copyfile(src, os.path.join(OUT, "m", pid + sfx + ".jpg")); shipped += 1
    if shipped: print(f"meal photos: {shipped} files")
    shutil.copyfile(os.path.join(HERE, "app", "app.css"), os.path.join(OUT, "app.css"))
    # Password gate: Vercel Routing Middleware (secrets only in project env vars COACH_PASSWORD / COACH_SESSION_SECRET)
    with open(os.path.join(HERE, "app", "middleware.js")) as f, open(os.path.join(OUT, "middleware.js"), "w") as g:
        g.write(f.read().replace("__SITE_TITLE__", _esc(title)))
    os.makedirs(os.path.join(OUT, "api"), exist_ok=True)   # gated Node function: live WHOOP refresh + token broker for the box sync
    with open(os.path.join(HERE, "api", "refresh.js")) as f, open(os.path.join(OUT, "api", "refresh.js"), "w") as g:   # bake in tz + wearable
        g.write(f.read().replace("process.env.COACH_TZ || 'UTC'", json.dumps(d["profile"].get("timezone") or "UTC"))
                .replace("(process.env.WEARABLE || 'whoop')", json.dumps(cfg.get("wearable", "none"))))
    with open(os.path.join(HERE, "app", "app.js")) as f:
        js = f.read()
    with open(os.path.join(HERE, "app", "index.html")) as f:
        html = f.read()
    phosphor(html, js)
    tag = '<script src="/app.js" defer></script>'
    assert tag in html
    scripts = "\n".join(f'<script src="{p}" defer></script>' for p in split_js(js))
    theme = cfg.get("theme") if cfg.get("theme") in ("recovery", "glass", "light") else "recovery"
    page = (html.replace(tag, scripts).replace("__SITE_TITLE__", _esc(title)).replace('<html lang="en">', f'<html lang="en" data-theme="{theme}">')
            .replace('content="#0b0b0b"', 'content="%s"' % {"light": "#f2f3f5", "glass": "#0a0d1a"}.get(theme, "#0b0b0b")))
    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(page)
    minify()
    icons = os.path.join(HERE, "icons")
    shutil.copyfile(os.path.join(icons, "icon-favicon.svg"), os.path.join(OUT, "c4-favicon.svg"))
    # Home Screen / favicon icons are REAL static files (never drawn by the middleware). iOS fetches these without a cookie,
    # so the gate lets them through (see PUBLIC in middleware.js). c5-* are the versioned URLs the HTML and manifest use.
    for _n in sorted(os.listdir(os.path.join(icons, "static"))):
        shutil.copyfile(os.path.join(icons, "static", _n), os.path.join(OUT, _n))
    for _n in ("apple-touch-icon.png", "apple-touch-icon-precomposed.png"):   # iOS probes these paths directly
        shutil.copyfile(os.path.join(icons, "static", "c5-180.png"), os.path.join(OUT, _n))
    _png = open(os.path.join(icons, "static", "c5-32.png"), "rb").read()   # favicon.ico = ICO container holding the 32 px PNG
    _hdr = struct.pack("<HHHBBBBHHII", 0, 1, 1, 32, 32, 0, 0, 1, 32, len(_png), 22)
    with open(os.path.join(OUT, "favicon.ico"), "wb") as f: f.write(_hdr + _png)
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump({"id": "/", "name": title, "short_name": title[:12], "description": "Training, recovery and nutrition dashboard",
                   "start_url": "/", "scope": "/", "display": "standalone",
                   "background_color": "#0b0b0b", "theme_color": "#0b0b0b",
                   "icons": [{"src": "/c5-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                             {"src": "/c5-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"}]}, f, indent=2)
    with open(os.path.join(OUT, "robots.txt"), "w") as f: f.write("User-agent: *\nDisallow: /\n")
    with open(os.path.join(OUT, "vercel.json"), "w") as f:
        json.dump({"functions": {"api/refresh.js": {"maxDuration": 30}}, "headers": [{"source": "/(.*)", "headers": [
            {"key": "X-Robots-Tag", "value": "noindex, nofollow, noarchive"},
            {"key": "Cache-Control", "value": "private, no-cache, max-age=0, must-revalidate"},
            {"key": "Referrer-Policy", "value": "no-referrer"},
            {"key": "X-Content-Type-Options", "value": "nosniff"},
            {"key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()"},
            {"key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}]}]}, f, indent=2)
    print(f"built dist/ (data.json {os.path.getsize(os.path.join(OUT, 'data.json'))} B, {len(months)} wearable month files, wearable={p['wear']['source']}, theme={cfg.get('theme', 'recovery')})")


if __name__ == "__main__":
    main()
