#!/usr/bin/env python3
"""Log fitness data into data.json (next to this file).

Examples:
  log.py weight 182.4
  log.py supp creatine            (ids from data.json supplements, or all)
  log.py supp creatine --undo
  log.py food --cal 450 --protein 40 --fat 12 --sugar 10 --note "eggs"
  log.py food --cal 620 --protein 45 --fat 22 --carbs 55 --sugar 8 --note "chicken bowl" \
             --photo /path/meal.jpg --score 8 --tip "swap white rice for half cauliflower rice"
                                  (photo: resized to 800 px long edge, JPEG q70, EXIF/GPS stripped,
                                   stored in meals/ and shipped behind the password gate)
  log.py meal-photo /path/meal.jpg [--entry N | --match TEXT] [--score N --tip TEXT]
                                  (attach/replace the photo on an EXISTING meal of --date; default: the day's last meal;
                                   --entry is 1-based within that day; --match picks the last meal whose note contains TEXT)
  log.py pullup-max 4
  log.py gtg 2 --neg 1
  log.py workout PULL
  log.py target calories 2200     (calories | protein | fat | sugar; 'none' clears)
  log.py undo food                (remove the most recent entry of a list)
  log.py today                    (print today's summary)
  log.py journal alcohol 2        (journal answers; see JOURNAL_KEYS. Booleans take yes/no)
  log.py journal stress 3
  log.py journal caffeine 2 --last 14:30
  log.py journal note "slept badly, neighbor's dog"
  log.py journal show             (print the day's journal)
  log.py checkin --sleep 7.5 --energy 4 --soreness 2   (morning check-in; used when wearable = none)
Every command accepts --date YYYY-MM-DD (default: today in the configured timezone).
"""
import argparse, json, os, sys, tempfile
from datetime import datetime, date
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data.json")
MEALS = os.path.join(HERE, "meals")   # meal photos: <id>.jpg (800 px) + <id>-t.jpg (thumb); build.py copies referenced ones into dist/m/. Never committed (.gitignore).
TZ = ZoneInfo("UTC")   # replaced by data.json profile.timezone in main()
TARGET_KEYS = {"calories": "calories", "cal": "calories", "protein": "protein_g",
               "fat": "fat_g", "sugar": "sugar_g"}
# key: (type, description). bool = yes/no, int/float = amount, scale = 1-5, time = HH:MM, text = free text
JOURNAL_KEYS = {
    "alcohol": ("int", "drinks"), "caffeine": ("int", "servings"), "caffeine_last": ("time", "last caffeine"),
    "late_meal": ("bool", "ate within 2-3h of bed"), "screen_in_bed": ("bool", "screen use in bed"),
    "stress": ("scale", "stress 1-5"), "hydration": ("float", "water oz"), "sauna": ("bool", "sauna"),
    "cold": ("bool", "cold exposure"), "intimacy": ("bool", "intimacy"), "reading": ("bool", "reading before bed"),
    "meditation": ("bool", "meditation / breathwork"), "sunlight": ("bool", "morning sunlight"),
    "energy": ("scale", "energy 1-5"), "mood": ("scale", "mood 1-5"), "soreness": ("scale", "soreness 1-5"),
    "illness": ("text", "illness / injury notes"), "note": ("text", "notes"), "sleep_hours": ("float", "hours slept (check-in)"),
}
JOURNAL_ALIASES = {"drinks": "alcohol", "coffee": "caffeine", "screens": "screen_in_bed", "screen": "screen_in_bed",
                   "water": "hydration", "cold_exposure": "cold", "plunge": "cold", "sex": "intimacy", "read": "reading",
                   "meditate": "meditation", "breathwork": "meditation", "sun": "sunlight", "sore": "soreness",
                   "injury": "illness", "notes": "note", "sleep": "sleep_hours", "latemeal": "late_meal", "late-meal": "late_meal"}


def parse_journal_value(key, raw):
    typ = JOURNAL_KEYS[key][0]
    v = raw.strip()
    if typ == "bool":
        if v.lower() in ("y", "yes", "true", "1"): return True
        if v.lower() in ("n", "no", "false", "0"): return False
        raise SystemExit(f"{key} expects yes/no")
    if typ == "scale":
        n = int(v)
        if not 1 <= n <= 5: raise SystemExit(f"{key} expects 1-5")
        return n
    if typ == "int": return int(v)
    if typ == "float": return float(v)
    if typ == "time":
        datetime.strptime(v, "%H:%M"); return v
    return v


LISTS = {"weight": "weights", "food": "food", "pullup-max": "pullup_max", "gtg": "gtg", "workout": "workouts"}


def now_ct():
    return datetime.now(TZ)


def load():
    with open(DATA) as f:
        return json.load(f)


def save(d):
    d["updated_at"] = now_ct().isoformat(timespec="seconds")
    fd, tmp = tempfile.mkstemp(dir=HERE, suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
    os.replace(tmp, DATA)


def save_photo(src, day):
    """Resize/compress a meal photo and return its id. Re-encoding from pixels drops EXIF/GPS and all other metadata."""
    import secrets
    from PIL import Image, ImageOps
    if not os.path.isfile(src): raise SystemExit(f"photo not found: {src}")
    try:
        im = Image.open(src); im = ImageOps.exif_transpose(im)
    except Exception as e:
        raise SystemExit(f"can't read photo {src}: {e}")
    if im.mode != "RGB":
        bg = Image.new("RGB", im.size, (0, 0, 0))
        bg.paste(im.convert("RGBA"), mask=im.convert("RGBA").split()[-1]); im = bg
    os.makedirs(MEALS, exist_ok=True)
    pid = f"{day}-{secrets.token_hex(6)}"
    for suffix, edge, q in (("", 800, 70), ("-t", 160, 68)):
        c = im.copy(); c.thumbnail((edge, edge), Image.LANCZOS)
        c.save(os.path.join(MEALS, pid + suffix + ".jpg"), "JPEG", quality=q, optimize=True, progressive=True)
    return pid


def drop_photo(entry):
    pid = isinstance(entry, dict) and entry.get("photo")
    if pid:
        for suffix in ("", "-t"):
            try: os.unlink(os.path.join(MEALS, pid + suffix + ".jpg"))
            except FileNotFoundError: pass


def valid_date(s):
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        raise argparse.ArgumentTypeError("date must be YYYY-MM-DD")


def main(argv=None):
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--date", type=valid_date, help="YYYY-MM-DD (default: today in the configured timezone)")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("weight", parents=[common]); s.add_argument("value", type=float, help="body weight in the configured unit")
    s = sub.add_parser("supp", parents=[common]); s.add_argument("ids", nargs="+"); s.add_argument("--undo", action="store_true")
    s = sub.add_parser("food", parents=[common])
    s.add_argument("--cal", type=float, default=0); s.add_argument("--protein", type=float, default=0)
    s.add_argument("--fat", type=float, default=0); s.add_argument("--sugar", type=float, default=0)
    s.add_argument("--carbs", type=float, default=None); s.add_argument("--note", default="")
    s.add_argument("--photo", metavar="PATH", help="meal photo to attach (jpg/png/webp)")
    s.add_argument("--score", type=int, metavar="N", help="Macro Score 1-10")
    s.add_argument("--tip", default="", metavar="TEXT", help="one-line swap tip")
    s = sub.add_parser("meal-photo", parents=[common]); s.add_argument("photo", metavar="PATH")
    s.add_argument("--entry", type=int, help="1-based meal number within the day"); s.add_argument("--match", help="note substring")
    s.add_argument("--score", type=int, metavar="N"); s.add_argument("--tip", default="", metavar="TEXT")
    s = sub.add_parser("pullup-max", parents=[common]); s.add_argument("reps", type=int)
    s = sub.add_parser("gtg", parents=[common]); s.add_argument("reps", type=int, nargs="?", default=0)
    s.add_argument("--neg", type=int, default=0, help="negatives")
    s = sub.add_parser("workout", parents=[common]); s.add_argument("type", type=str.upper)
    s.add_argument("--note", default="")
    s = sub.add_parser("target"); s.add_argument("key", choices=sorted(TARGET_KEYS)); s.add_argument("value")
    s = sub.add_parser("undo"); s.add_argument("what", choices=sorted(LISTS))
    sub.add_parser("today", parents=[common])
    s = sub.add_parser("journal", parents=[common])
    s.add_argument("key", help="journal key (or 'show'); keys: " + ", ".join(JOURNAL_KEYS))
    s.add_argument("value", nargs="?", help="value; 'clear' removes the answer")
    s.add_argument("--last", help="with caffeine: time of last caffeine HH:MM")
    s = sub.add_parser("checkin", parents=[common], help="morning check-in (wearable = none)")
    s.add_argument("--sleep", type=float, help="hours slept"); s.add_argument("--energy", type=int, help="1-5")
    s.add_argument("--soreness", type=int, help="1-5")

    a = p.parse_args(argv)
    d = load()
    global TZ
    TZ = ZoneInfo((d.get("profile") or {}).get("timezone") or "UTC")
    unit = (d.get("profile") or {}).get("units", "lb")
    SUPP_ALIASES = {x["id"].lower(): x["id"] for x in d.get("supplements", [])}
    SUPP_ALIASES.update({x["name"].lower(): x["id"] for x in d.get("supplements", []) if x.get("name")})
    day = getattr(a, "date", None) or now_ct().date().isoformat()
    ts = now_ct().isoformat(timespec="seconds")

    if a.cmd == "weight":
        d["weights"] = [w for w in d["weights"] if w["date"] != day]  # one weigh-in per day; latest wins
        if not 20 <= a.value <= 700: sys.exit(f"weight {a.value} {unit} looks wrong")
        d["weights"].append({"date": day, "value": a.value}); d["weights"].sort(key=lambda w: w["date"])
        msg = f"weight {a.value} {unit} on {day}"
    elif a.cmd == "supp":
        ids = [x["id"] for x in d.get("supplements", [])] if a.ids == ["all"] else []
        for i in a.ids:
            if i == "all": continue
            if i.lower() not in SUPP_ALIASES:
                sys.exit(f"unknown supplement '{i}'. Use: {', '.join(sorted(set(SUPP_ALIASES)))} or all")
            ids.append(SUPP_ALIASES[i.lower()])
        taken = set(d["supplement_log"].get(day, []))
        taken = taken - set(ids) if a.undo else taken | set(ids)
        order = [x["id"] for x in d["supplements"]]
        d["supplement_log"][day] = [x for x in order if x in taken]
        msg = f"supplements {day}: {len(taken)}/{len(order)} ({', '.join(d['supplement_log'][day]) or 'none'})"
    elif a.cmd == "food":
        if a.score is not None and not 1 <= a.score <= 10: sys.exit("--score expects 1-10")
        e = {"date": day, "time": ts, "cal": a.cal, "protein": a.protein, "fat": a.fat, "sugar": a.sugar, "note": a.note}
        if a.carbs is not None: e["carbs"] = a.carbs
        if a.score is not None: e["score"] = a.score
        if a.tip.strip(): e["tip"] = a.tip.strip()
        if a.photo: e["photo"] = save_photo(a.photo, day)
        d["food"].append(e)
        tot = sum(f["cal"] for f in d["food"] if f["date"] == day)
        pro = sum(f["protein"] for f in d["food"] if f["date"] == day)
        msg = f"food logged. {day} totals: {tot:.0f} kcal, {pro:.0f} g protein"
    elif a.cmd == "meal-photo":
        meals = [f for f in d["food"] if f["date"] == day]
        if a.match: meals = [f for f in meals if a.match.lower() in (f.get("note") or "").lower()]
        if not meals: sys.exit(f"no matching meal on {day}")
        if a.entry is not None and not 1 <= a.entry <= len(meals): sys.exit(f"--entry must be 1-{len(meals)}")
        e = meals[a.entry - 1] if a.entry else meals[-1]
        if a.score is not None and not 1 <= a.score <= 10: sys.exit("--score expects 1-10")
        new = save_photo(a.photo, day); drop_photo(e); e["photo"] = new
        if a.score is not None: e["score"] = a.score
        if a.tip.strip(): e["tip"] = a.tip.strip()
        msg = f"photo attached to {day} meal: {e.get('note') or 'Meal'}"
    elif a.cmd == "pullup-max":
        d["pullup_max"] = [x for x in d["pullup_max"] if x["date"] != day]
        d["pullup_max"].append({"date": day, "reps": a.reps}); d["pullup_max"].sort(key=lambda x: x["date"])
        msg = f"strict pull-up max {a.reps} on {day}"
    elif a.cmd == "gtg":
        d["gtg"].append({"date": day, "time": ts, "reps": a.reps, "negatives": a.neg})
        r = sum(x["reps"] for x in d["gtg"] if x["date"] == day)
        n = sum(x["negatives"] for x in d["gtg"] if x["date"] == day)
        msg = f"GtG {day}: {r} reps, {n} negatives today"
    elif a.cmd == "workout":
        from workout_parse import enrich
        w = enrich({"date": day, "type": a.type, "note": a.note, "time": ts}, unit)
        d["workouts"].append(w)
        msg = f"workout {a.type} logged on {day}: {len(w['exercises'])} exercise{'' if len(w['exercises']) == 1 else 's'}" + ("" if w.get("sauna") is not False else ", no sauna")
    elif a.cmd == "checkin":
        if a.sleep is None and a.energy is None and a.soreness is None: sys.exit("give at least one of --sleep --energy --soreness")
        entry = d.setdefault("journal", {}).setdefault(day, {})
        if a.sleep is not None:
            if not 0 <= a.sleep <= 16: sys.exit("--sleep expects hours 0-16")
            entry["sleep_hours"] = a.sleep
        for k in ("energy", "soreness"):
            v = getattr(a, k)
            if v is not None:
                if not 1 <= v <= 5: sys.exit(f"--{k} expects 1-5")
                entry[k] = v
        msg = f"check-in {day}: " + ", ".join(f"{k}={entry[k]}" for k in ("sleep_hours", "energy", "soreness") if k in entry)
    elif a.cmd == "target":
        v = None if a.value.lower() in ("none", "null", "-") else float(a.value)
        d["targets"][TARGET_KEYS[a.key]] = v
        msg = f"target {TARGET_KEYS[a.key]} = {v}"
    elif a.cmd == "undo":
        lst = d[LISTS[a.what]]
        if not lst: sys.exit(f"nothing to undo in {a.what}")
        gone = lst.pop(); drop_photo(gone)
        msg = f"removed {gone}"
    elif a.cmd == "journal":
        J = d.setdefault("journal", {})
        if a.key == "show":
            print(json.dumps(J.get(day, {}), indent=2)); return
        key = JOURNAL_ALIASES.get(a.key.lower(), a.key.lower())
        if key not in JOURNAL_KEYS:
            sys.exit(f"unknown journal key '{a.key}'. Keys: {', '.join(JOURNAL_KEYS)}")
        if a.value is None:
            sys.exit("value required")
        entry = J.setdefault(day, {})
        if a.value.lower() == "clear":
            entry.pop(key, None); msg = f"journal {day}: cleared {key}"
        else:
            entry[key] = parse_journal_value(key, a.value)
            if key == "caffeine" and a.last:
                entry["caffeine_last"] = parse_journal_value("caffeine_last", a.last)
            if key == "sauna" and entry[key] is True and "sauna" in [x["id"] for x in d.get("supplements", [])]:  # keep the habits checklist in sync
                lst = d["supplement_log"].setdefault(day, [])
                if "sauna" not in lst: lst.append("sauna")
            msg = f"journal {day}: {key} = {entry[key]}"
        if not entry: J.pop(day, None)
    elif a.cmd == "today":
        f = [x for x in d["food"] if x["date"] == day]
        print(json.dumps({
            "date": day,
            "calories": sum(x["cal"] for x in f), "protein": sum(x["protein"] for x in f),
            "fat": sum(x["fat"] for x in f), "sugar": sum(x["sugar"] for x in f),
            "supplements": d["supplement_log"].get(day, []),
            "gtg_reps": sum(x["reps"] for x in d["gtg"] if x["date"] == day),
            "gtg_negatives": sum(x["negatives"] for x in d["gtg"] if x["date"] == day),
            "workouts": [x["type"] for x in d["workouts"] if x["date"] == day],
        }, indent=2))
        return
    save(d)
    print(msg)
    print("Run ./publish.sh to update the dashboard.")


if __name__ == "__main__":
    main()
