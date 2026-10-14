#!/usr/bin/env python3
"""End-to-end matrix: every theme x every wearable mode in a throwaway copy of the kit.
setup.py -> real log.py commands -> (wearable modes) a SYNTHETIC test fixture merged through wearables/common.merge
-> build.py -> headless screenshots into shots/. The fixture exists only in the temp copy; nothing is shipped or deployed.
Run: python3 tools/test_matrix.py   (needs Chrome + puppeteer-core; PUPPETEER=/path/to/puppeteer-core)"""
import json, os, random, shutil, socket, subprocess, sys, tempfile, time
from datetime import date, timedelta, datetime

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(KIT, "shots"); os.makedirs(SHOTS, exist_ok=True)
THEMES, WEARS = ("recovery", "glass", "light"), ("whoop", "oura", "fitbit", "none")


def fixture(source, n=21, seed=7):
    """Clearly synthetic days (test only) in each source's normalized shape."""
    rnd = random.Random(seed); out = {}; today = date.today()
    for i in range(n):
        d = (today - timedelta(days=n - 1 - i)).isoformat()
        hrv, rhr = round(45 + rnd.gauss(0, 6), 1), int(56 + rnd.gauss(0, 2))
        sl = {"hours_asleep": round(6.6 + rnd.random(), 2), "hours_in_bed": 8.0, "performance": rnd.randint(70, 95), "efficiency": rnd.randint(85, 95),
              "stages": {"light": 3.6, "deep": 1.4, "rem": 1.7, "awake": 0.6}, "need_hours": 7.8 if source == "whoop" else None,
              "start": f"{d}T23:00", "end": f"{d}T07:00"}
        v = {"recovery": {"score": rnd.randint(40, 92), "hrv": hrv, "rhr": rhr, "estimate": source == "fitbit"}, "sleep": sl, "workouts": []}
        if source == "whoop": v["cycle"] = {"strain": round(8 + rnd.random() * 7, 1), "kcal": 2400}
        elif source == "oura": v["cycle"] = {"strain": None, "activity_score": rnd.randint(55, 95), "steps": rnd.randint(5000, 12000)}
        else: v["cycle"] = {"strain": None, "steps": rnd.randint(5000, 12000)}
        if i == n - 1 and source == "whoop":
            v["workouts"].append({"sport": "weightlifting", "strain": 11.8, "kcal": 258, "avg_hr": 114, "max_hr": 153, "start": f"{d}T07:11-04:00", "end": f"{d}T07:59-04:00"})
        out[d] = v
    return out


def port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def run(cmd, cwd, **kw):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, **kw)
    if r.returncode: print(r.stdout, r.stderr); raise SystemExit(f"FAILED: {' '.join(cmd)}")
    return r.stdout


results = []
for theme in THEMES:
    for wear in WEARS:
        tmp = tempfile.mkdtemp(prefix="coachkit-")
        shutil.copytree(KIT, tmp, dirs_exist_ok=True, ignore=shutil.ignore_patterns("shots", "dist", "data.json", "deploy*", "node_modules", "*.tar.gz"))
        cfg = json.load(open(os.path.join(KIT, "coach.config.json")))
        cfg.update(theme=theme, wearable=wear, site_title="Coach", brand="Coach", units="kg" if wear == "oura" else "lb")
        cfg["profile"].update(goal_weight=78 if wear == "oura" else 175, start_weight=84 if wear == "oura" else 186)
        json.dump(cfg, open(os.path.join(tmp, "c.json"), "w"))
        run([sys.executable, "setup.py", "--config", "c.json"], tmp)
        u = "kg" if wear == "oura" else "lb"
        L = lambda *a: run([sys.executable, "log.py", *a], tmp)
        L("weight", "82.4" if u == "kg" else "183.2")
        L("workout", "PULL", "--note", "Pull-ups 5/4/4 · Barbell row 60 lb 10/10/8 · DB curls 15s 12/10/10 · Face pulls (weight TBD) 15/15/12" if u == "lb" else "Pull-ups 5/4/4 · Barbell row 40 kg 10/10/8 · DB curls 7.5s 12/10/10 · Face pulls (weight TBD) 15/15/12")
        L("food", "--cal", "620", "--protein", "48", "--note", "test meal")
        L("supp", "creatine")
        if wear == "none": L("checkin", "--sleep", "7.25", "--energy", "4", "--soreness", "2")
        else:
            sys.path.insert(0, os.path.join(tmp, "wearables"))
            import importlib, common; importlib.reload(common)
            common.DATA = os.path.join(tmp, "data.json"); common.merge(wear, fixture(wear), {"max_heart_rate": 185})
            sys.path.pop(0)
        run([sys.executable, "setup.py", "--validate"], tmp)
        out = run([sys.executable, "build.py"], tmp).strip()
        pt = port(); srv = subprocess.Popen([sys.executable, "tools/serve.py", str(pt)], cwd=tmp); time.sleep(0.8)
        try:
            flags = (["share", "more"] if wear == "whoop" else [])
            r = run(["node", os.path.join(KIT, "tools", "shoot_kit.js"), f"http://127.0.0.1:{pt}/", os.path.join(SHOTS, f"today-{theme}-{wear}"), *flags], tmp)
            info = json.loads(r.strip().splitlines()[-1])
        finally:
            srv.terminate()
        ok = info["theme"] == theme and not info["errs"] and (info["checkin"] if wear == "none" else info["rings"]) and (wear == "whoop" or not info["whoopText"])
        results.append((theme, wear, ok, info))
        print(f"{theme:9s} {wear:7s} {'PASS' if ok else 'FAIL'} {json.dumps(info)}", flush=True)
        shutil.rmtree(tmp)
sys.exit(0 if all(r[2] for r in results) else 1)
