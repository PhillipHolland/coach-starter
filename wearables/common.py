"""Shared plumbing for wearable adapters: paths, secrets, token storage, HTTP session, data.json merge.

Normalized day record (what every adapter returns and what the app reads), keyed by local date YYYY-MM-DD:
  recovery: {score 0-100 | None, hrv ms, rhr bpm, estimate: bool}      score = WHOOP recovery / Oura readiness / Fitbit estimate
  sleep:    {hours_asleep, hours_in_bed, performance 0-100, efficiency, stages {light,deep,rem,awake} h, need_hours, start, end}
  cycle:    {strain 0-21 (WHOOP only), activity_score 0-100 (Oura), steps, kcal, avg_hr, max_hr}
  workouts: [{sport, strain, kcal, avg_hr, max_hr, start, end, zones_min}]
Missing values are None or absent. Adapters never invent numbers; a computed value is flagged (estimate: true).
"""
import json, os, tempfile, time
from datetime import datetime
from zoneinfo import ZoneInfo

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(KIT, "data.json")
SECRETS = os.path.join(KIT, ".secrets")
UA = "CoachStarter/1.0"


class WearableError(Exception):
    pass


def atomic_write_json(path, obj, mode=None):
    d = os.path.dirname(path); os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
    try:
        if mode is not None: os.fchmod(fd, mode)
        with os.fdopen(fd, "w") as f:
            json.dump(obj, f, indent=2); f.write("\n"); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp): os.unlink(tmp)
        raise


def load_data():
    with open(DATA) as f:
        return json.load(f)


def tz():
    try:
        return ZoneInfo((load_data().get("profile") or {}).get("timezone") or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def secret_env(name):
    """Read a credential from the environment, else from .secrets/wearable.env (KEY=VALUE lines, mode 600). Never printed."""
    v = os.environ.get(name)
    if v: return v
    p = os.path.join(SECRETS, "wearable.env")
    if os.path.exists(p):
        for line in open(p):
            k, _, val = line.strip().partition("=")
            if k == name and val: return val.strip().strip('"')
    raise WearableError(f"{name} is not set (environment or .secrets/wearable.env)")


def tokens_path(source):
    return os.path.join(SECRETS, f"{source}_tokens.json")


def load_tokens(source):
    p = tokens_path(source)
    if not os.path.exists(p):
        raise WearableError(f"not connected: run python3 wearables/connect.py {source}")
    with open(p) as f:
        return json.load(f)


def save_tokens(source, tok):
    tok = dict(tok); tok["obtained_at"] = int(time.time())
    atomic_write_json(tokens_path(source), tok, mode=0o600)
    return tok


def expired(tok, margin=300):
    return tok.get("obtained_at", 0) + int(tok.get("expires_in", 0) or 0) - time.time() < margin


def session():
    import requests
    s = requests.Session(); s.headers.update({"User-Agent": UA, "Accept": "application/json"})
    return s


def merge(source, days, profile, keep_days=None, full=False):
    """Merge normalized days into data.json -> wear. Older days are kept; synced days replace stored ones."""
    data = load_data()
    w = data.get("wear") or {}
    if w.get("source") not in (None, source): w = {}   # switched wearable: start clean, never mix sources
    w["source"] = source
    all_days = w.setdefault("days", {})
    for d, v in days.items():
        all_days[d] = v
    w["days"] = dict(sorted(all_days.items()))
    w["first_day"] = min(w["days"]) if w["days"] else None
    if profile: w["profile"] = profile
    w["synced_at"] = datetime.now(tz()).isoformat(timespec="seconds")
    data["wear"] = w
    atomic_write_json(DATA, data)
    return w


def r1(x, n=1):
    if not isinstance(x, (int, float)) or isinstance(x, bool): return None
    return int(round(x)) if n == 0 else round(x, n)
