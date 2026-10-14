"""Fitbit adapter (Fitbit Web API, OAuth2 authorization code + PKCE). UNTESTED without a Fitbit account: endpoints follow
https://dev.fitbit.com/build/reference/web-api/ (sleep 1.2, hrv, activities/heart, activities/steps).
Fitbit has no readiness score in its public API, so recovery.score is an ESTIMATE computed here from your own baseline
(see estimate_readiness) and flagged estimate: true; the app labels it "Readiness*" with an explanation. Needs 14+ days.
Env/secrets: FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET. Tokens: .secrets/fitbit_tokens.json (refresh tokens are single-use).
"""
import base64, statistics
from datetime import datetime, timedelta

from common import WearableError, load_tokens, save_tokens, expired, secret_env, session, tz, r1

NAME = "fitbit"
API = "https://api.fitbit.com"
AUTH_URL = "https://www.fitbit.com/oauth2/authorize"
TOKEN_URL = "https://api.fitbit.com/oauth2/token"
SCOPES = "sleep heartrate activity profile"
PKCE = True
S = session()


def _basic():
    return "Basic " + base64.b64encode(f"{secret_env('FITBIT_CLIENT_ID')}:{secret_env('FITBIT_CLIENT_SECRET')}".encode()).decode()


def refresh(tok):
    r = S.post(TOKEN_URL, data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"]},
               headers={"Authorization": _basic()}, timeout=30)
    if r.status_code != 200:
        raise WearableError(f"Fitbit token refresh failed: HTTP {r.status_code} (re-run wearables/connect.py fitbit)")
    return save_tokens(NAME, r.json())


def _get(tok, path):
    r = S.get(API + path, timeout=30, headers={"Authorization": f"Bearer {tok['access_token']}"})
    if r.status_code == 401: raise WearableError("fitbit 401")
    if r.status_code == 429: raise WearableError("Fitbit rate limit (150 requests/hour); try again later")
    if r.status_code != 200: raise WearableError(f"Fitbit GET {path}: HTTP {r.status_code}")
    return r.json()


def estimate_readiness(days):
    """Readiness ESTIMATE 0-100 from overnight HRV (up is good) and resting HR (down is good) vs your trailing 30-day
    baseline: 50 + 12*z(HRV) - 12*z(RHR), clamped to 1-99. Only when 14+ baseline days exist; otherwise None.
    This is a transparent heuristic, not a Fitbit or WHOOP score."""
    ds = sorted(days)
    for i, d in enumerate(ds):
        rec = days[d].get("recovery") or {}
        base = [days[x].get("recovery") or {} for x in ds[max(0, i - 30):i]]
        hv = [b["hrv"] for b in base if b.get("hrv")]; rh = [b["rhr"] for b in base if b.get("rhr")]
        if rec.get("hrv") is None or rec.get("rhr") is None or len(hv) < 14 or len(rh) < 14: continue
        z = lambda v, a: (v - statistics.mean(a)) / (statistics.pstdev(a) or 1)
        rec["score"] = int(max(1, min(99, round(50 + 12 * z(rec["hrv"], hv) - 12 * z(rec["rhr"], rh)))))
        rec["estimate"] = True


def fetch(days=30, full=False):
    TZ = tz()
    tok = load_tokens(NAME)
    if expired(tok): tok = refresh(tok)
    today = datetime.now(TZ).date()
    n = min(100 if full else days + 31, 100)   # Fitbit date ranges are capped (sleep: 100 days); +31 = readiness baseline
    start, end = (today - timedelta(days=n)).isoformat(), today.isoformat()
    paths = {"sleep": f"/1.2/user/-/sleep/date/{start}/{end}.json", "hrv": f"/1/user/-/hrv/date/{start}/{end}.json",
             "heart": f"/1/user/-/activities/heart/date/{start}/{end}.json", "steps": f"/1/user/-/activities/steps/date/{start}/{end}.json"}
    try:
        pull = {k: _get(tok, p) for k, p in paths.items()}
    except WearableError as ex:
        if "401" not in str(ex): raise
        tok = refresh(tok); pull = {k: _get(tok, p) for k, p in paths.items()}
    out = {}
    day = lambda d: out.setdefault(d, {"workouts": []})
    for s in pull["sleep"].get("sleep", []):
        if not s.get("isMainSleep"): continue
        st = (s.get("levels") or {}).get("summary") or {}
        m = lambda k: round((st.get(k) or {}).get("minutes", 0) / 60, 4) if k in st else None
        day(s["dateOfSleep"])["sleep"] = {"hours_asleep": round(s.get("minutesAsleep", 0) / 60, 4) or None,
            "hours_in_bed": round(s.get("timeInBed", 0) / 60, 4) or None, "efficiency": s.get("efficiency"),
            "performance": None, "stages": {"light": m("light"), "deep": m("deep"), "rem": m("rem"), "awake": m("wake")},
            "need_hours": None, "start": s.get("startTime"), "end": s.get("endTime")}
    for x in pull["hrv"].get("hrv", []):
        day(x["dateTime"]).setdefault("recovery", {"score": None, "estimate": True})["hrv"] = r1((x.get("value") or {}).get("dailyRmssd"))
    for x in pull["heart"].get("activities-heart", []):
        rhr = (x.get("value") or {}).get("restingHeartRate")
        if rhr: day(x["dateTime"]).setdefault("recovery", {"score": None, "estimate": True})["rhr"] = rhr
    for x in pull["steps"].get("activities-steps", []):
        day(x["dateTime"])["cycle"] = {"strain": None, "steps": int(x["value"]) if str(x.get("value", "")).isdigit() else None}
    for v in out.values():
        if "recovery" in v: v["recovery"].setdefault("hrv", None); v["recovery"].setdefault("rhr", None)
    estimate_readiness(out)
    keep = (today - timedelta(days=(n if full else days))).isoformat()
    return {d: v for d, v in out.items() if d >= keep}, {}
