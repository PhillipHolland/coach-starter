"""Oura adapter (Oura API v2, OAuth2 authorization code). UNTESTED without an Oura account: endpoints and field names
follow https://cloud.ouraring.com/v2/docs (usercollection: daily_readiness, daily_sleep, sleep, daily_activity, workout).
Mapping: readiness score -> recovery.score (labeled "Readiness" in the app), sleep score -> sleep.performance,
long_sleep average_hrv / lowest_heart_rate -> recovery.hrv / rhr, activity score + steps -> cycle. No strain (WHOOP-only).
Env/secrets: OURA_CLIENT_ID, OURA_CLIENT_SECRET. Tokens: .secrets/oura_tokens.json (refresh tokens are single-use).
"""
from datetime import datetime, timedelta

from common import WearableError, load_tokens, save_tokens, expired, secret_env, session, tz, r1

NAME = "oura"
API = "https://api.ouraring.com/v2/usercollection"
AUTH_URL = "https://cloud.ouraring.com/oauth/authorize"
TOKEN_URL = "https://api.ouraring.com/oauth/token"
SCOPES = "daily heartrate workout personal"
S = session()


def refresh(tok):
    r = S.post(TOKEN_URL, data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
                                "client_id": secret_env("OURA_CLIENT_ID"), "client_secret": secret_env("OURA_CLIENT_SECRET")}, timeout=30)
    if r.status_code != 200:
        raise WearableError(f"Oura token refresh failed: HTTP {r.status_code} (re-run wearables/connect.py oura)")
    new = r.json(); new.setdefault("refresh_token", tok["refresh_token"])
    return save_tokens(NAME, new)


def _get(tok, path, start, end):
    out, nxt = [], None
    while True:
        p = {"start_date": start, "end_date": end}
        if nxt: p["next_token"] = nxt
        r = S.get(f"{API}/{path}", params=p, timeout=30, headers={"Authorization": f"Bearer {tok['access_token']}"})
        if r.status_code == 401: raise WearableError("oura 401")
        if r.status_code != 200: raise WearableError(f"Oura GET {path}: HTTP {r.status_code}")
        j = r.json(); out += j.get("data", []); nxt = j.get("next_token")
        if not nxt: return out


def _iso(s, TZ):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(TZ).isoformat(timespec="minutes") if s else None


def fetch(days=30, full=False):
    TZ = tz()
    tok = load_tokens(NAME)
    if expired(tok): tok = refresh(tok)
    today = datetime.now(TZ).date()
    start = (today - timedelta(days=(3650 if full else days + 1))).isoformat(); end = (today + timedelta(days=1)).isoformat()
    try:
        pull = {k: _get(tok, k, start, end) for k in ("daily_readiness", "daily_sleep", "sleep", "daily_activity", "workout")}
    except WearableError as ex:
        if "401" not in str(ex): raise
        tok = refresh(tok); pull = {k: _get(tok, k, start, end) for k in ("daily_readiness", "daily_sleep", "sleep", "daily_activity", "workout")}
    out = {}
    day = lambda d: out.setdefault(d, {"workouts": []})
    for x in pull["daily_readiness"]:
        day(x["day"])["recovery"] = {"score": x.get("score"), "hrv": None, "rhr": None, "estimate": False}
    h = lambda s: round(s / 3600, 4) if isinstance(s, (int, float)) else None
    for x in pull["sleep"]:
        if x.get("type") not in ("long_sleep", None): continue
        d = x.get("day"); v = day(d)
        prev = v.get("sleep")
        if prev and (prev.get("hours_in_bed") or 0) >= (h(x.get("time_in_bed")) or 0): continue
        v["sleep"] = {"hours_asleep": h(x.get("total_sleep_duration")), "hours_in_bed": h(x.get("time_in_bed")),
                      "efficiency": x.get("efficiency"), "performance": (v.get("sleep") or {}).get("performance"),
                      "stages": {"light": h(x.get("light_sleep_duration")), "deep": h(x.get("deep_sleep_duration")),
                                 "rem": h(x.get("rem_sleep_duration")), "awake": h(x.get("awake_time"))},
                      "need_hours": None, "start": _iso(x.get("bedtime_start"), TZ), "end": _iso(x.get("bedtime_end"), TZ)}
        rec = v.setdefault("recovery", {"score": None, "estimate": False})
        rec["hrv"] = r1(x.get("average_hrv")); rec["rhr"] = r1(x.get("lowest_heart_rate"), 0)
    for x in pull["daily_sleep"]:
        v = day(x["day"]); v.setdefault("sleep", {})["performance"] = x.get("score")
    for x in pull["daily_activity"]:
        day(x["day"])["cycle"] = {"strain": None, "activity_score": x.get("score"), "steps": x.get("steps"),
                                  "kcal": x.get("total_calories") or x.get("active_calories")}
    for x in pull["workout"]:
        d = x.get("day") or (x.get("start_datetime") or "")[:10]
        day(d)["workouts"].append({"sport": (x.get("activity") or "activity").lower(), "strain": None,
                                   "kcal": r1(x.get("calories"), 0), "start": _iso(x.get("start_datetime"), TZ),
                                   "end": _iso(x.get("end_datetime"), TZ), "intensity": x.get("intensity")})
    return out, {}
