#!/usr/bin/env python3
"""Non-interactive setup: coach.config.json -> data.json (schema-valid seed), then validate.

  python3 setup.py --config coach.config.json            create data.json, or update its settings and keep every log
  python3 setup.py --config coach.config.json --check    validate only (config + existing data.json), write nothing
  python3 setup.py --validate                            validate data.json only
Exit 0 = OK. Exit 2 = bad input; every problem is printed as 'ERROR <field>: <reason>'.
"""
import argparse, json, os, re, sys, tempfile
from datetime import date, datetime
from zoneinfo import ZoneInfo, available_timezones

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data.json")
THEMES = ("recovery", "glass", "light")
WEARABLES = ("whoop", "oura", "fitbit", "none")
DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
DAY_TYPE = re.compile(r"^[A-Z][A-Z0-9 _-]{0,15}$")
TITLE = re.compile(r"^[A-Za-z0-9 .&'\u2019-]{1,30}$")      # also safe inside the login page's JS template
ID = re.compile(r"^[a-z][a-z0-9_-]{0,23}$")
LISTS = ("weights", "food", "supplement_log", "pullup_max", "gtg", "workouts", "journal")
ENV = {"whoop": ["WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET"], "oura": ["OURA_CLIENT_ID", "OURA_CLIENT_SECRET"],
       "fitbit": ["FITBIT_CLIENT_ID", "FITBIT_CLIENT_SECRET"], "none": []}


class Bad(Exception):
    pass


def num(errs, field, v, lo, hi, allow_none=True):
    if v is None:
        if not allow_none: errs.append(f"{field}: required")
        return
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        errs.append(f"{field}: must be a number between {lo} and {hi} (got {v!r})")


def validate_config(c):
    e = []
    if not isinstance(c, dict): raise Bad("config must be a JSON object")
    known = {"name", "site_title", "brand", "units", "timezone", "goal", "profile", "targets", "split", "supplements", "theme", "wearable", "features"}
    for k in c:
        if k not in known and not k.startswith("_"): e.append(f"{k}: unknown key (allowed: {', '.join(sorted(known))})")
    for k in ("site_title", "brand"):
        if c.get(k) is not None and (not isinstance(c[k], str) or not TITLE.match(c[k])):
            e.append(f"{k}: 1-30 chars of letters, digits, spaces and . & ' -")
    if not c.get("site_title"): e.append("site_title: required")
    if c.get("name") is not None and (not isinstance(c["name"], str) or len(c["name"]) > 40): e.append("name: string up to 40 chars")
    if c.get("units") not in ("lb", "kg"): e.append("units: 'lb' or 'kg'")
    if c.get("timezone") not in available_timezones(): e.append(f"timezone: IANA name like 'America/New_York' (got {c.get('timezone')!r})")
    if c.get("theme") not in THEMES: e.append(f"theme: one of {', '.join(THEMES)}")
    if c.get("wearable") not in WEARABLES: e.append(f"wearable: one of {', '.join(WEARABLES)}")
    if c.get("goal") is not None and (not isinstance(c["goal"], str) or len(c["goal"]) > 120): e.append("goal: string up to 120 chars")
    p = c.get("profile") or {}
    if not isinstance(p, dict): e.append("profile: object")
    else:
        if p.get("sex") not in (None, "male", "female"): e.append("profile.sex: 'male', 'female' or null")
        if p.get("birth_date") is not None:
            try:
                b = date.fromisoformat(p["birth_date"])
                if not 1900 < b.year < date.today().year - 12: e.append("profile.birth_date: implausible")
            except (TypeError, ValueError): e.append("profile.birth_date: YYYY-MM-DD or null")
        lo, hi = (30, 320) if c.get("units") == "kg" else (66, 700)
        num(e, "profile.start_weight", p.get("start_weight"), lo, hi); num(e, "profile.goal_weight", p.get("goal_weight"), lo, hi)
        num(e, "profile.height_cm", p.get("height_cm"), 100, 250)
        if p.get("wake_time") is not None and not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", str(p["wake_time"])): e.append("profile.wake_time: HH:MM")
    t = c.get("targets") or {}
    if not isinstance(t, dict): e.append("targets: object")
    else:
        num(e, "targets.kcal", t.get("kcal"), 800, 8000, allow_none=False); num(e, "targets.protein_g", t.get("protein_g"), 20, 500, allow_none=False)
        num(e, "targets.fat_g", t.get("fat_g"), 10, 400); num(e, "targets.sugar_g", t.get("sugar_g"), 0, 400); num(e, "targets.steps", t.get("steps"), 1000, 50000)
    s = c.get("split")
    if not isinstance(s, dict) or set(s) != set(DAYS): e.append(f"split: object with exactly {', '.join(DAYS)}")
    else:
        for k, v in s.items():
            if not isinstance(v, str) or not DAY_TYPE.match(v): e.append(f"split.{k}: UPPERCASE day type like PUSH, PULL, LEGS, RUN, REST")
    sp = c.get("supplements", [])
    if not isinstance(sp, list): e.append("supplements: list")
    else:
        seen = set()
        for i, x in enumerate(sp):
            if not isinstance(x, dict) or not isinstance(x.get("id"), str) or not ID.match(x["id"]): e.append(f"supplements[{i}].id: lowercase id like 'creatine'"); continue
            if x["id"] in seen: e.append(f"supplements[{i}].id: duplicate '{x['id']}'")
            seen.add(x["id"])
            if not isinstance(x.get("name"), str) or not 0 < len(x["name"]) <= 40: e.append(f"supplements[{i}].name: 1-40 chars")
            if x.get("kind") not in (None, "habit"): e.append(f"supplements[{i}].kind: 'habit' or omit")
    f = c.get("features") or {}
    if not isinstance(f, dict) or any(not isinstance(v, bool) for v in f.values()): e.append("features: object of booleans (e.g. {\"pullups\": false})")
    return e


def seed(c, old=None):
    """Build data.json from config. With old data, keep every log/wearable day and only replace settings."""
    old = old or {}
    p = c.get("profile") or {}
    prof = {"name": c.get("name") or "", "timezone": c["timezone"], "units": c["units"], "sex": p.get("sex"),
            "birth_date": p.get("birth_date"), "start_weight": p.get("start_weight"), "goal_weight": p.get("goal_weight"),
            "start_date": (old.get("profile") or {}).get("start_date") or datetime.now(ZoneInfo(c["timezone"])).date().isoformat(),
            "height_cm": p.get("height_cm"), "wake_time": p.get("wake_time")}
    t = c["targets"]
    d = {
        "config": {"site_title": c["site_title"], "brand": c.get("brand") or c["site_title"], "theme": c["theme"], "wearable": c["wearable"],
                   "units": c["units"], "timezone": c["timezone"], "goal": c.get("goal") or "", "features": c.get("features") or {}},
        "profile": prof,
        "targets": {"calories": t["kcal"], "protein_g": t["protein_g"], "fat_g": t.get("fat_g"), "sugar_g": t.get("sugar_g"), "steps": t.get("steps")},
        "supplements": [{k: v for k, v in x.items() if k in ("id", "name", "detail", "kind")} for x in c.get("supplements", [])],
        "split": {k: c["split"][k] for k in DAYS},
    }
    for k in LISTS:
        d[k] = old.get(k, {} if k in ("supplement_log", "journal") else [])
    w = old.get("wear") or {}
    d["wear"] = w if w.get("source") == c["wearable"] else {"source": c["wearable"], "days": {}, "profile": {}, "synced_at": None, "first_day": None}
    d["pullup_context"] = old.get("pullup_context")
    d["updated_at"] = datetime.now(ZoneInfo(c["timezone"])).isoformat(timespec="seconds")
    return d


def validate_data(d):
    """Schema check for data.json (also used by build.py). Returns a list of problems."""
    e = []
    if not isinstance(d, dict): return ["data.json: must be an object"]
    for k in ("config", "profile", "targets", "split", "wear"):
        if not isinstance(d.get(k), dict): e.append(f"{k}: missing or not an object")
    for k in ("supplements", "weights", "food", "pullup_max", "gtg", "workouts"):
        if not isinstance(d.get(k), list): e.append(f"{k}: missing or not a list")
    for k in ("supplement_log", "journal"):
        if not isinstance(d.get(k), dict): e.append(f"{k}: missing or not an object")
    if e: return e
    e += [f"config.{x}" for x in validate_config({**{k: v for k, v in d["config"].items() if k in ("site_title", "brand", "theme", "wearable", "units", "timezone", "goal", "features")},
          "targets": {"kcal": d["targets"].get("calories"), "protein_g": d["targets"].get("protein_g")}, "split": d["split"], "supplements": d["supplements"]})]
    isodate = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    for k in ("weights", "food", "pullup_max", "gtg", "workouts"):
        for i, x in enumerate(d[k]):
            if not isinstance(x, dict) or not isodate.match(str(x.get("date", ""))): e.append(f"{k}[{i}]: needs date YYYY-MM-DD")
    for i, x in enumerate(d["weights"]):
        if not isinstance(x.get("value"), (int, float)): e.append(f"weights[{i}].value: number")
    for i, x in enumerate(d["workouts"]):
        if not isinstance(x.get("type"), str): e.append(f"workouts[{i}].type: string")
    if d["wear"].get("source") not in WEARABLES: e.append("wear.source: unknown")
    if not isinstance(d["wear"].get("days", {}), dict): e.append("wear.days: object")
    return e


def write(path, obj):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False); f.write("\n")
    os.replace(tmp, path)


def fail(errs):
    for x in errs: print("ERROR " + x, file=sys.stderr)
    sys.exit(2)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config"); ap.add_argument("--check", action="store_true"); ap.add_argument("--validate", action="store_true")
    ap.add_argument("--data", default=DATA, help=argparse.SUPPRESS)
    a = ap.parse_args()
    if a.validate:
        try: d = json.load(open(a.data))
        except (OSError, ValueError) as ex: fail([f"data.json: {ex}"])
        errs = validate_data(d)
        fail(errs) if errs else print("data.json OK"); return
    if not a.config: fail(["--config: required (or --validate)"])
    try: c = json.load(open(a.config))
    except OSError as ex: fail([f"config: cannot read {a.config}: {ex.strerror}"])
    except ValueError as ex: fail([f"config: invalid JSON: {ex}"])
    try: errs = validate_config(c)
    except Bad as ex: errs = [str(ex)]
    if errs: fail(errs)
    old = None
    if os.path.exists(a.data):
        try: old = json.load(open(a.data))
        except ValueError as ex: fail([f"data.json: exists but is not valid JSON ({ex}); move it away first"])
    d = seed(c, old)
    errs = validate_data(d)
    if errs: fail(errs)
    if a.check:
        print("config OK (check only, nothing written)"); return
    write(a.data, d)
    logs = sum(len(d[k]) for k in LISTS)
    print(f"data.json {'updated' if old else 'created'}: theme={c['theme']} wearable={c['wearable']} units={c['units']} tz={c['timezone']} ({logs} log entries kept)")
    need = ["COACH_PASSWORD", "COACH_SESSION_SECRET"] + (["SYNC_SHARED_SECRET", "BLOB_READ_WRITE_TOKEN", "WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET", "WHOOP_REFRESH_TOKEN_SEED"] if c["wearable"] == "whoop" else [])
    print("Vercel env vars to set (secure form, never in chat): " + ", ".join(need))
    if ENV[c["wearable"]]: print("Box secrets for the wearable sync (.secrets/wearable.env, mode 600): " + ", ".join(ENV[c["wearable"]]))


if __name__ == "__main__":
    main()
