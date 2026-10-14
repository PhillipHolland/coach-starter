"""WHOOP adapter (WHOOP Developer API v2, OAuth2 with rotating refresh tokens).

Token modes:
  broker (default when COACH_URL is set and .secrets/sync_secret exists): the deployed api/refresh.js owns the rotating
     refresh token (Vercel Blob) and hands this script a short-lived access token. Use this when live refresh is on.
  local (otherwise): this box owns the token in .secrets/whoop_tokens.json and refreshes it itself.
Never both: two owners of one rotating refresh token log each other out.
Env/secrets: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET (local mode); COACH_URL + .secrets/sync_secret (broker mode).
"""
import os, sys, time
from datetime import datetime, timedelta, timezone

from common import WearableError, SECRETS, load_tokens, save_tokens, expired, secret_env, session, tz, r1

NAME = "whoop"
API = "https://api.prod.whoop.com/developer"
AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
SCOPES = "offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement"
TZ = None
S = session()


def refresh(tok):
    r = S.post(TOKEN_URL, data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
                                "client_id": secret_env("WHOOP_CLIENT_ID"), "client_secret": secret_env("WHOOP_CLIENT_SECRET"),
                                "scope": "offline"}, timeout=30)
    if r.status_code != 200:
        raise WearableError(f"WHOOP token refresh failed: HTTP {r.status_code} (re-run wearables/connect.py whoop if 400/401)")
    new = r.json()
    if "access_token" not in new: raise WearableError("WHOOP token refresh: no access_token")
    new.setdefault("refresh_token", tok["refresh_token"])
    return save_tokens(NAME, new)


def broker_token(force=False):
    base = os.environ.get("COACH_URL", "").rstrip("/")
    key = open(os.path.join(SECRETS, "sync_secret")).read().strip()
    r = S.get(base + "/api/refresh", params={"mode": "token", **({"force": "1"} if force else {})}, timeout=45,
              headers={"Authorization": f"Bearer {key}"}, allow_redirects=False)
    if r.status_code != 200 or not r.json().get("access_token"):
        raise WearableError(f"token broker failed: HTTP {r.status_code}")
    return {"access_token": r.json()["access_token"]}


def use_broker():
    return bool(os.environ.get("COACH_URL")) and os.path.exists(os.path.join(SECRETS, "sync_secret"))


def ensure_token(force=False):
    if use_broker(): return broker_token(force)
    tok = load_tokens(NAME)
    return refresh(tok) if force or expired(tok) else tok


class Client:
    def __init__(self):
        self.tok = ensure_token()

    def get(self, path, params=None):
        for attempt in range(3):
            r = S.get(API + path, params=params, timeout=30, headers={"Authorization": f"Bearer {self.tok['access_token']}"})
            if r.status_code == 401 and attempt == 0:
                self.tok = ensure_token(force=True); continue
            if r.status_code == 429:
                time.sleep(int(r.headers.get("Retry-After", "5"))); continue
            if r.status_code != 200:
                raise WearableError(f"WHOOP GET {path}: HTTP {r.status_code}")
            return r.json()
        raise WearableError(f"WHOOP GET {path}: gave up")

    def collection(self, path, start, end):
        out, nxt = [], None
        while True:
            p = {"start": start, "end": end, "limit": 25}
            if nxt: p["nextToken"] = nxt
            j = self.get(path, p)
            out += j.get("records", [])
            nxt = j.get("next_token")
            if not nxt: return out


def ct(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ) if iso else None


def fetch(days=30, full=False):
    """-> (days, profile) in the normalized shape (see common.py). WHOOP is the reference shape."""
    global TZ
    TZ = tz()
    c = Client()
    now = datetime.now(timezone.utc)
    start_dt = datetime(2012, 1, 1, tzinfo=timezone.utc) if full else now - timedelta(days=days + 1)
    start = start_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end = (now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    cycles = c.collection("/v2/cycle", start, end)
    sleeps = c.collection("/v2/activity/sleep", start, end)
    recs = c.collection("/v2/recovery", start, end)
    works = c.collection("/v2/activity/workout", start, end)
    out = {}
    day = lambda d: out.setdefault(d, {"workouts": []})

    # Cycle "day" = CT date of (cycle start + 12 h): a cycle that begins at bedtime belongs to the next day,
    # matching how the WHOOP app labels days.
    cyc_date = {}
    for cy in cycles:
        st = ct(cy["start"]); d = (st + timedelta(hours=12)).date().isoformat(); cyc_date[cy["id"]] = d
        sc = cy.get("score") or {}
        day(d)["cycle"] = {"strain": r1(sc.get("strain")), "kj": r1(sc.get("kilojoule"), 0), "kcal": r1((sc.get("kilojoule") or 0) / 4.184, 0) if sc.get("kilojoule") is not None else None,
                           "avg_hr": sc.get("average_heart_rate"), "max_hr": sc.get("max_heart_rate"),
                           "start": st.isoformat(timespec="minutes"), "end": ct(cy.get("end")).isoformat(timespec="minutes") if cy.get("end") else None,
                           "state": cy.get("score_state"), "id": cy["id"]}
    # Sleep: main sleeps keyed by the CT date you woke up; naps listed separately.
    sleep_date = {}
    for sl in sleeps:
        en = ct(sl["end"]); d = en.date().isoformat(); sleep_date[sl["id"]] = d
        sc = sl.get("score") or {}; ss = sc.get("stage_summary") or {}
        # Whole minutes the way the WHOOP app shows them: floor each part and give the rounding remainder to the
        # base part (light sleep = asleep - SWS - REM, awake = in bed - asleep, baseline = need - debt - strain - nap),
        # so 5:58 asleep, 3:18 light, 1:21 SWS and 7:27 + 2:07 + 0:09 = 9:43 match the app to the minute.
        fm = lambda v: int((v or 0) / 60000)
        m_in = fm(ss.get("total_in_bed_time_milli")); m_deep = fm(ss.get("total_slow_wave_sleep_time_milli")); m_rem = fm(ss.get("total_rem_sleep_time_milli"))
        m_asleep = fm(sum(ss.get(k) or 0 for k in ("total_light_sleep_time_milli", "total_slow_wave_sleep_time_milli", "total_rem_sleep_time_milli")))
        stm = {"light": max(0, m_asleep - m_deep - m_rem), "deep": m_deep, "rem": m_rem, "awake": max(0, m_in - m_asleep)}
        asleep = m_asleep * 60000
        h = lambda m: round(m / 60, 4)
        need = sc.get("sleep_needed") or {}
        nd = {k: fm(need.get(k)) for k in ("need_from_sleep_debt_milli", "need_from_recent_strain_milli", "need_from_recent_nap_milli")}
        m_need = fm((need.get("baseline_milli") or 0) + (need.get("need_from_sleep_debt_milli") or 0) + (need.get("need_from_recent_strain_milli") or 0) + (need.get("need_from_recent_nap_milli") or 0))
        need_h = m_need / 60
        rec = {"performance": r1(sc.get("sleep_performance_percentage"), 0), "hours_asleep": h(m_asleep) if m_asleep else None,
               "hours_in_bed": h(m_in) or None,
               "no_data_hours": r1((ss.get("total_no_data_time_milli") or 0) / 3.6e6, 2),
               "efficiency": r1(sc.get("sleep_efficiency_percentage")), "consistency": r1(sc.get("sleep_consistency_percentage"), 0),
               "respiratory_rate": r1(sc.get("respiratory_rate")),
               "stages": {k: h(v) for k, v in stm.items()},
               "disturbances": ss.get("disturbance_count"), "cycles": ss.get("sleep_cycle_count"),
               "need_hours": h(m_need) if m_need else None,
               "need_breakdown": {"baseline": h(max(0, m_need - nd["need_from_sleep_debt_milli"] - nd["need_from_recent_strain_milli"] - nd["need_from_recent_nap_milli"])),
                                  "debt": h(nd["need_from_sleep_debt_milli"]), "strain": h(nd["need_from_recent_strain_milli"]), "nap": h(nd["need_from_recent_nap_milli"])} if need else None,
               "start": ct(sl["start"]).isoformat(timespec="minutes"), "end": en.isoformat(timespec="minutes"), "state": sl.get("score_state")}
        if sl.get("nap"):
            day(d).setdefault("naps", []).append(rec)
        else:
            prev = day(d).get("sleep")
            if not prev or (rec["hours_in_bed"] or 0) > (prev.get("hours_in_bed") or 0):
                day(d)["sleep"] = rec
    for rc in recs:
        d = sleep_date.get(rc.get("sleep_id")) or cyc_date.get(rc.get("cycle_id"))
        if not d: continue
        sc = rc.get("score") or {}
        day(d)["recovery"] = {"score": r1(sc.get("recovery_score"), 0), "hrv": r1(sc.get("hrv_rmssd_milli")),
                              "rhr": r1(sc.get("resting_heart_rate"), 0), "spo2": r1(sc.get("spo2_percentage")),
                              "skin_temp_c": r1(sc.get("skin_temp_celsius")), "calibrating": sc.get("user_calibrating"),
                              "state": rc.get("score_state")}
    for w in sorted(works, key=lambda w: w["start"]):
        st, en = ct(w["start"]), ct(w["end"]); sc = w.get("score") or {}
        day(st.date().isoformat())["workouts"].append({
            "sport": w.get("sport_name") or str(w.get("sport_id", "activity")), "strain": r1(sc.get("strain")),
            "avg_hr": sc.get("average_heart_rate"), "max_hr": sc.get("max_heart_rate"),
            "kcal": r1(sc["kilojoule"] / 4.184, 0) if sc.get("kilojoule") is not None else None, "kj": r1(sc.get("kilojoule"), 0),
            "tz": w.get("timezone_offset"),
            "start": st.isoformat(timespec="minutes"), "end": en.isoformat(timespec="minutes"), "state": w.get("score_state"),
            "distance_m": r1(sc.get("distance_meter"), 0), "altitude_gain_m": r1(sc.get("altitude_gain_meter"), 0),
            "altitude_change_m": r1(sc.get("altitude_change_meter"), 0), "percent_recorded": r1(sc.get("percent_recorded"), 0),
            "zones_min": [r1((z.get(f"zone_{n}_milli") or 0) / 60000, 1) for n in ("zero", "one", "two", "three", "four", "five")]
                         if (z := sc.get("zone_durations")) else None})

    profile = {}
    try:
        p = c.get("/v2/user/profile/basic"); _ = p  # name not stored (privacy)
        b = c.get("/v2/user/measurement/body"); profile["max_heart_rate"] = b.get("max_heart_rate")
        profile["height_m"] = b.get("height_meter"); profile["weight_kg"] = b.get("weight_kilogram")
        profile["weight_lb"] = r1(b["weight_kilogram"] * 2.20462) if b.get("weight_kilogram") else None
    except WearableError as ex:
        print(f"note: profile/body skipped ({ex})", file=sys.stderr)

    return out, profile
