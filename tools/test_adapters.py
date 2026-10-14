#!/usr/bin/env python3
"""Offline adapter tests: feed each wearable adapter canned API responses shaped like the vendors' documented payloads
(mock HTTP, temp data.json, fake tokens) and check the normalized output. No network, no accounts. Run: python3 tools/test_adapters.py"""
import json, os, shutil, sys, tempfile, time
from datetime import date, timedelta

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(KIT, "wearables"))
import common  # noqa: E402

tmp = tempfile.mkdtemp(); common.DATA = os.path.join(tmp, "data.json"); common.SECRETS = os.path.join(tmp, ".secrets")
os.makedirs(common.SECRETS)
json.dump({"profile": {"timezone": "America/New_York"}, "config": {}}, open(common.DATA, "w"))
for s in ("whoop", "oura", "fitbit"):
    json.dump({"access_token": "x", "refresh_token": "y", "expires_in": 3600, "obtained_at": int(time.time())}, open(common.tokens_path(s), "w"))
os.environ.update(WHOOP_CLIENT_ID="i", WHOOP_CLIENT_SECRET="s", OURA_CLIENT_ID="i", OURA_CLIENT_SECRET="s", FITBIT_CLIENT_ID="i", FITBIT_CLIENT_SECRET="s")


class R:
    def __init__(self, j, code=200): self._j, self.status_code, self.headers = j, code, {}
    def json(self): return self._j


def mock(mod, routes):
    def get(url, params=None, **k):
        for frag, j in routes.items():
            if frag in url: return R(j(params) if callable(j) else j)
        raise AssertionError("unexpected GET " + url)
    mod.S.get = get


ok = 0
def check(cond, msg):
    global ok
    if not cond: print("FAIL", msg); sys.exit(1)
    ok += 1

# ---- WHOOP
import whoop  # noqa: E402
mock(whoop, {"/v2/cycle": {"records": [{"id": 1, "start": "2026-10-12T04:10:00Z", "end": "2026-10-13T04:00:00Z", "score_state": "SCORED", "score": {"strain": 11.84, "kilojoule": 9000, "average_heart_rate": 70, "max_heart_rate": 150}}]},
             "/v2/activity/sleep": {"records": [{"id": "s1", "start": "2026-10-12T03:30:00Z", "end": "2026-10-12T11:00:00Z", "nap": False, "score_state": "SCORED", "score": {"sleep_performance_percentage": 88, "stage_summary": {"total_in_bed_time_milli": 27000000, "total_light_sleep_time_milli": 12000000, "total_slow_wave_sleep_time_milli": 5400000, "total_rem_sleep_time_milli": 6000000}, "sleep_needed": {"baseline_milli": 27000000}}}]},
             "/v2/recovery": {"records": [{"sleep_id": "s1", "cycle_id": 1, "score_state": "SCORED", "score": {"recovery_score": 71, "hrv_rmssd_milli": 48.3, "resting_heart_rate": 54}}]},
             "/v2/activity/workout": {"records": [{"start": "2026-10-12T12:11:00Z", "end": "2026-10-12T12:59:00Z", "sport_name": "weightlifting", "score": {"strain": 11.8, "kilojoule": 1078}}]},
             "/v2/user/profile/basic": {"first_name": "SHOULD-NOT-BE-STORED"}, "/v2/user/measurement/body": {"max_heart_rate": 180, "height_meter": 1.8, "weight_kilogram": 80}})
d, prof = whoop.fetch(7)
v = d["2026-10-12"]
check(v["recovery"]["score"] == 71 and v["recovery"]["hrv"] == 48.3, "whoop recovery")
check(v["sleep"]["performance"] == 88 and abs(v["sleep"]["hours_asleep"] - 6.5) < 0.01, "whoop sleep")
check(v["cycle"]["strain"] == 11.8 and v["workouts"][0]["sport"] == "weightlifting", "whoop strain/workout")
check("first_name" not in prof and "SHOULD-NOT" not in json.dumps(d) + json.dumps(prof), "whoop name not stored")

# ---- Oura
import oura  # noqa: E402
mock(oura, {"daily_readiness": {"data": [{"day": "2026-10-12", "score": 82}]},
            "daily_sleep": {"data": [{"day": "2026-10-12", "score": 79}]},
            "/sleep": {"data": [{"day": "2026-10-12", "type": "long_sleep", "total_sleep_duration": 25200, "time_in_bed": 28800, "efficiency": 88, "light_sleep_duration": 14400, "deep_sleep_duration": 5400, "rem_sleep_duration": 5400, "awake_time": 3600, "bedtime_start": "2026-10-11T23:00:00-04:00", "bedtime_end": "2026-10-12T07:00:00-04:00", "average_hrv": 52, "lowest_heart_rate": 51}]},
            "daily_activity": {"data": [{"day": "2026-10-12", "score": 74, "steps": 9120, "total_calories": 2600}]},
            "workout": {"data": [{"day": "2026-10-12", "activity": "strength_training", "calories": 210, "start_datetime": "2026-10-12T08:00:00-04:00", "end_datetime": "2026-10-12T08:50:00-04:00"}]}})
d, _ = oura.fetch(7)
v = d["2026-10-12"]
check(v["recovery"] == {"score": 82, "hrv": 52, "rhr": 51, "estimate": False}, f"oura readiness {v.get('recovery')}")
check(v["sleep"]["performance"] == 79 and v["sleep"]["hours_asleep"] == 7.0, "oura sleep")
check(v["cycle"]["activity_score"] == 74 and v["cycle"]["steps"] == 9120 and v["cycle"]["strain"] is None, "oura activity, no strain")

# ---- Fitbit (needs 14+ baseline days for the readiness estimate)
import fitbit  # noqa: E402
today = date.today()
ds = [(today - timedelta(days=i)).isoformat() for i in range(40)][::-1]
mock(fitbit, {"/sleep/": {"sleep": [{"dateOfSleep": ds[-1], "isMainSleep": True, "minutesAsleep": 420, "timeInBed": 470, "efficiency": 91, "startTime": ds[-2] + "T23:10:00.000", "endTime": ds[-1] + "T07:00:00.000", "levels": {"summary": {"deep": {"minutes": 80}, "light": {"minutes": 250}, "rem": {"minutes": 90}, "wake": {"minutes": 50}}}}]},
              "/hrv/": {"hrv": [{"dateTime": x, "value": {"dailyRmssd": 40 + (i % 5)}} for i, x in enumerate(ds)]},
              "/activities/heart/": {"activities-heart": [{"dateTime": x, "value": {"restingHeartRate": 58 - (i % 3)}} for i, x in enumerate(ds)]},
              "/activities/steps/": {"activities-steps": [{"dateTime": x, "value": "8000"} for x in ds]}})
d, _ = fitbit.fetch(7)
v = d[ds[-1]]
check(v["recovery"]["estimate"] is True and isinstance(v["recovery"]["score"], int) and 1 <= v["recovery"]["score"] <= 99, f"fitbit estimate {v.get('recovery')}")
check(v["sleep"]["hours_asleep"] == 7.0 and v["sleep"]["efficiency"] == 91 and v["cycle"]["steps"] == 8000, "fitbit sleep/steps")
few = {x: {"recovery": {"hrv": 40, "rhr": 55, "score": None}} for x in ds[:5]}; fitbit.estimate_readiness(few)
check(all(v["recovery"]["score"] is None for v in few.values()), "fitbit: no estimate without 14 baseline days")

# ---- merge + none
w = common.merge("oura", {"2026-10-12": {"recovery": {"score": 1}}}, {})
check(w["source"] == "oura" and w["first_day"] == "2026-10-12", "merge")
w = common.merge("fitbit", {}, {})
check(w["days"] == {}, "switching wearable never mixes sources")
import none  # noqa: E402
check(none.fetch() == ({}, {}), "none")
shutil.rmtree(tmp)
print(f"adapter tests OK ({ok} checks: whoop, oura, fitbit, none, merge)")
