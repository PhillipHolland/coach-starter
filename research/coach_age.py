"""
Coach Age v1 / Pace of Aging: reference implementation.

Read coach_age_research.md and coach_age_spec.json first. Every coefficient below
is tagged either EVIDENCE (a published number, cited in the spec) or HEURISTIC
(our own modelling choice, clearly labeled; replace it when better data exists).

Core idea (the same "effective age" framework WHOOP uses; see Spiegelhalter 2016):
    years_delta_i = [ln HR_i(x) - ln HR_i(referent)] / G
where G is the Gompertz slope of adult all-cause mortality (per year of age).
Default G = 0.085/yr (mortality doubling time about 8.2 y, Finch et al. 1990).
WHOOP uses G = 0.1 (10%/yr, Spiegelhalter), which gives about 15% smaller deltas.

    Coach Age = chronological_age + sum_i( overlap_i * shrink_i * clip(years_delta_i) )

Public API
    compute(data, chronological_age, sex="male", as_of=None, window_days=30) -> dict
    pace_of_aging(data, chronological_age, sex="male", as_of=None, span_days=56) -> dict
    from_coach_data(raw_json) -> canonical `data` dict (adapter for /workspace/coach/data.json)

Canonical `data` (all fields optional):
{
  "profile": {"height_m": 1.88, "max_hr": 173, "vo2max_measured": None},
  "days": {"YYYY-MM-DD": {
        "worn": True, "rhr": 64, "hrv": 40.0, "sleep_hours": 6.7,
        "sleep_consistency": 80,                    # WHOOP %, 0 or None means missing
        "workouts": [{"sport": "running", "minutes": 30, "zones_min": [z0..z5]}]}},
  "weights_lb": [["YYYY-MM-DD", 180.0]],
  "pullups":    [["YYYY-MM-DD", 3]],
  "strength_logs": [["YYYY-MM-DD", 45]],            # minutes from manual logs
  "alcohol":    [["YYYY-MM-DD", drinks]],           # standard drinks/day, from the journal
  "sauna":      [["YYYY-MM-DD", sessions]],
  "food":       [["YYYY-MM-DD", kcal, sugar_g]]
}
"""
from __future__ import annotations

import datetime as dt
import math
import statistics as st
from typing import Any

# --------------------------------------------------------------------------------------
# Global constants
# --------------------------------------------------------------------------------------
GOMPERTZ_G = 0.085          # EVIDENCE-derived: MRDT ~8 y (Finch, Pike & Witten 1990) -> ln2/8.15
TOTAL_CAP = 15.0            # HEURISTIC: Coach Age is never more than 15 y from the calendar age
Z80, Z95 = 1.2816, 1.96

STRENGTH_SPORTS = {"weightlifting", "weightlifting_msk", "powerlifting", "functional fitness",
                   "functional_fitness", "strength_trainer", "crossfit", "pilates", "yoga",
                   "hot_yoga", "barre", "f45_training", "rucking_strength", "calisthenics"}
NON_AEROBIC = {"sauna", "meditation", "ice_bath", "massage"}

# FRIEND treadmill CPX 50th-percentile VO2max (mL/kg/min). EVIDENCE: Kaminsky 2015 Table 3.
# Decade bins mapped to their midpoints (HEURISTIC: linear interpolation between them).
FRIEND_P50 = {
    "male":   [(25, 48.0), (35, 42.4), (45, 37.8), (55, 32.6), (65, 28.2), (75, 24.4)],
    "female": [(25, 37.6), (35, 30.2), (45, 26.7), (55, 23.4), (65, 20.0), (75, 18.3)],
}
# WHOOP overnight RMSSD middle-50% bands (WHOOP Locker, 2026): 25 y M 50-100, 45 y M 35-60;
# F 45-90 and 30-55. Geometric mid-points used as the "typical" value (HEURISTIC), log-linear in age.
HRV_BANDS = {"male": {25: (50, 100), 45: (35, 60)}, "female": {25: (45, 90), 45: (30, 55)}}


def _interp(x: float, pts: list[tuple[float, float]]) -> float:
    pts = sorted(pts)
    if x <= pts[0][0]:
        (x0, y0), (x1, y1) = pts[0], pts[1]
    elif x >= pts[-1][0]:
        (x0, y0), (x1, y1) = pts[-2], pts[-1]
    else:
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if x0 <= x <= x1:
                break
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


def _interp_clamped(x: float, pts: list[tuple[float, float]]) -> float:
    pts = sorted(pts)
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    return _interp(x, pts)


def _d(s: str) -> dt.date:
    return dt.date.fromisoformat(s[:10])


# --------------------------------------------------------------------------------------
# Component definitions
# Each returns dict(value, referent, ln_hr, ln_hr_ref, se_years, n, detail)
# --------------------------------------------------------------------------------------
def _vo2_estimate(profile, rhr_mean, rhr_n, vig_min_wk, bmi, age, sex):
    """Return (vo2, sd, detail). Uth HR-ratio + Jackson 1990 BMI model, inverse-variance pooled."""
    est = []
    if profile.get("vo2max_measured"):
        return float(profile["vo2max_measured"]), 1.5, {"method": "measured"}
    hrmax = profile.get("max_hr")
    if hrmax and rhr_mean:
        # EVIDENCE: VO2max = 15.3 * HRmax/HRrest (Uth 2004); SEE 2.7 (measured HRmax) / 4.7
        # (age-predicted HRmax). HEURISTIC: SD inflated to 6.0 because (a) the 2021 validation in
        # middle-aged/older adults found poor agreement, and (b) WHOOP RHR is measured during sleep,
        # which runs lower than the seated/supine awake HRrest Uth used, so this formula overestimates.
        est.append(("uth", 15.3 * hrmax / rhr_mean, 6.0))
    if bmi:
        # EVIDENCE: Jackson 1990 BMI model, SEE ~5.6:
        # VO2 = 56.363 + 1.921*PAR - 0.381*age - 0.754*BMI + 10.987*(male)
        # HEURISTIC: PAR (0-7) approximated from weekly vigorous (>=60% HRR) aerobic minutes.
        par = _par_from_minutes(vig_min_wk)
        v = 56.363 + 1.921 * par - 0.381 * age - 0.754 * bmi + 10.987 * (1 if sex == "male" else 0)
        est.append(("jackson_bmi", v, 5.6))
    if not est:
        return None, None, {}
    w = [1 / s ** 2 for _, _, s in est]
    mean = sum(wi * v for wi, (_, v, _) in zip(w, est)) / sum(w)
    var = 1 / sum(w)
    if len(est) > 1:  # disagreement between methods widens the interval
        var += st.pvariance([v for _, v, _ in est])
    return mean, math.sqrt(var), {k: round(v, 1) for k, v, _ in est}


def _par_from_minutes(vig_min_wk):
    # HEURISTIC approximation of the NASA/JSC 0-7 physical-activity rating used by Jackson 1990.
    # Verify the anchors against the original scale before relying on this in production.
    if vig_min_wk is None:
        return 2.0
    if vig_min_wk < 10:
        return 2.0
    if vig_min_wk < 30:
        return 4.0
    if vig_min_wk < 60:
        return 5.0
    if vig_min_wk < 180:
        return 6.0
    return 7.0


def comp_crf(ctx):
    age, sex = ctx["age"], ctx["sex"]
    vo2, sd, det = _vo2_estimate(ctx["profile"], ctx["rhr_mean"], ctx["n_rhr"], ctx["vig_min_wk"],
                                 ctx["bmi"], age, sex)
    if vo2 is None:
        return None
    ref = _interp(age, FRIEND_P50[sex])
    # EVIDENCE: Kokkinos 2022, HR 0.86 (0.85-0.87) per +1 MET (3.5 mL/kg/min).
    b = math.log(1 / 0.86) / 3.5                 # ln-HR per mL/kg/min lower
    se_b = (math.log(1 / 0.85) - math.log(1 / 0.87)) / (2 * 1.96) / 3.5
    ln_hr = b * (ref - vo2)
    se_ln = math.hypot(b * sd, se_b * abs(ref - vo2))
    det.update({"vo2_est": round(vo2, 1), "vo2_sd": round(sd, 1)})
    return dict(value=round(vo2, 1), referent=round(ref, 1), unit="mL/kg/min", ln_hr=ln_hr,
                se_ln=se_ln, n=min(ctx["n_rhr"], 30), detail=det)


def comp_rhr(ctx):
    if not ctx["rhr_mean"]:
        return None
    ref = 60.0 if ctx["sex"] == "male" else 64.0   # WHOOP neutral sleep RHR (whitepaper)
    if ctx["sex"] == "male":
        # EVIDENCE: Jensen 2013 (Copenhagen Male Study), fitness-adjusted: +16% (10-22) per 10 bpm.
        hr, lo, hi = 1.16, 1.10, 1.22
    else:
        # EVIDENCE: Zhang 2016 CMAJ meta-analysis: RR 1.09 (1.07-1.12) per 10 bpm.
        hr, lo, hi = 1.09, 1.07, 1.12
    b = math.log(hr) / 10
    se_b = (math.log(hi) - math.log(lo)) / (2 * 1.96) / 10
    x = ctx["rhr_mean"]
    se_x = ctx["rhr_sd"] / math.sqrt(max(ctx["n_rhr"], 1))
    return dict(value=round(x, 1), referent=ref, unit="bpm (sleeping)", ln_hr=b * (x - ref),
                se_ln=math.hypot(b * se_x, se_b * abs(x - ref)), n=ctx["n_rhr"], detail={})


def _hrv_typical(age, sex):
    pts = [(a, 0.5 * (math.log(lo) + math.log(hi))) for a, (lo, hi) in HRV_BANDS[sex].items()]
    return math.exp(_interp(age, pts))   # log-linear extrapolation beyond 45 y (HEURISTIC)


def comp_hrv(ctx):
    if not ctx["hrv_vals"]:
        return None
    ref = _hrv_typical(ctx["age"], ctx["sex"])
    lnx = st.mean(math.log(v) for v in ctx["hrv_vals"] if v > 0)
    # HEURISTIC: between-person SD of ln(RMSSD) = 0.40, taken from the WHOOP 45-y IQR (35-60 ms)/1.349.
    z = (lnx - math.log(ref)) / 0.40
    # HEURISTIC built on EVIDENCE: Hillebrand 2013: low-vs-high HRV (SDNN) RR 1.35 (1.10-1.67)
    # for a FIRST CARDIOVASCULAR EVENT (not all-cause mortality). Spread over ~2.18 SD between
    # extreme-tertile means gives about 0.138 ln-HR per SD.
    b = math.log(1.35) / 2.18
    se_b = (math.log(1.67) - math.log(1.10)) / (2 * 1.96) / 2.18
    sd_ln = st.pstdev([math.log(v) for v in ctx["hrv_vals"] if v > 0]) if len(ctx["hrv_vals"]) > 1 else 0.3
    se_z = sd_ln / math.sqrt(len(ctx["hrv_vals"])) / 0.40
    return dict(value=round(math.exp(lnx), 1), referent=round(ref, 1), unit="ms RMSSD (geo-mean)",
                ln_hr=-b * z, se_ln=math.hypot(b * se_z, se_b * abs(z)), n=len(ctx["hrv_vals"]),
                detail={"z": round(z, 2)})


# Windred 2024 fully adjusted (Table 2/3), quintile medians from Table 1. EVIDENCE.
SRI_CURVE = [(65.1, 1.00), (75.6, 0.80), (81.0, 0.75), (85.2, 0.72), (89.8, 0.70)]
SRI_CI = {75.6: (0.69, 0.93), 81.0: (0.64, 0.88), 85.2: (0.61, 0.84), 89.8: (0.59, 0.83)}
DUR_CURVE = [(5.54, 1.00), (6.34, 0.82), (6.82, 0.83), (7.28, 0.76), (7.94, 0.76), (9.0, 0.76)]


def _ln_curve(x, curve):
    return _interp_clamped(x, [(a, math.log(h)) for a, h in curve])


def comp_sleep_reg(ctx):
    v = ctx["consistency_vals"]
    if not v:
        return None
    x = st.mean(v)
    ref = 81.0       # UK Biobank median SRI (Windred 2024)
    ln_hr = _ln_curve(x, SRI_CURVE) - _ln_curve(ref, SRI_CURVE)
    # HEURISTIC: WHOOP Sleep Consistency is treated as an SRI proxy. WHOOP says its metric runs
    # slightly lower than SRI, so this is conservative (it overstates irregularity). CI half-width ~0.13 ln.
    se_x = (st.pstdev(v) / math.sqrt(len(v))) if len(v) > 1 else 10
    slope = abs(_ln_curve(x + 1, SRI_CURVE) - _ln_curve(x - 1, SRI_CURVE)) / 2
    se_ln = math.hypot(slope * se_x, 0.08 * min(1.0, abs(ln_hr) / 0.36 + 0.3))
    return dict(value=round(x, 1), referent=ref, unit="% (WHOOP consistency ~ SRI)", ln_hr=ln_hr,
                se_ln=se_ln, n=len(v), detail={})


def comp_sleep_dur(ctx):
    v = ctx["sleep_vals"]
    if not v:
        return None
    x = st.mean(v)
    ref = 7.0
    # Above 9 h: flat (no credit, no penalty). Long-sleep risk in Cappuccio 2010 (RR 1.30) is
    # thought to largely reflect reverse causation; WHOOP takes the same stance.
    ln_hr = _ln_curve(x, DUR_CURVE) - _ln_curve(ref, DUR_CURVE)
    se_x = (st.pstdev(v) / math.sqrt(len(v))) if len(v) > 1 else 1
    slope = abs(_ln_curve(x + 0.25, DUR_CURVE) - _ln_curve(x - 0.25, DUR_CURVE)) / 0.5
    return dict(value=round(x, 2), referent=ref, unit="h asleep/night", ln_hr=ln_hr,
                se_ln=math.hypot(slope * se_x, 0.08), n=len(v), detail={})


# Lee 2022 Circulation, multivariable HRs for long-term leisure MPA (Table 3), bin mid-points. EVIDENCE.
MPA_CURVE = [(10, 1.00), (47, 0.91), (112, 0.84), (187, 0.80), (262, 0.79), (337, 0.74),
             (412, 0.74), (525, 0.69), (650, 0.68)]


def comp_activity(ctx):
    if ctx["covered_days"] < 1:
        return None
    x = ctx["mvpa_eq_wk"]
    ref = 150.0
    ln_hr = _ln_curve(x, MPA_CURVE) - _ln_curve(ref, MPA_CURVE)
    return dict(value=round(x), referent=ref, unit="MPA-equivalent min/wk (Z1 + 2x Z2-5, non-strength)",
                ln_hr=ln_hr, se_ln=0.04 + 0.15 * abs(ln_hr), n=ctx["covered_days"],
                detail={"moderate_min_wk": round(ctx["mod_min_wk"]), "vigorous_min_wk": round(ctx["vig_min_wk"])})


def comp_strength_time(ctx):
    if ctx["covered_days"] < 1:
        return None
    x = ctx["strength_min_wk"]
    ref = 40.0
    # EVIDENCE: Momma 2022: J-shaped, nadir RR 0.83 (0.79-0.86) at 40 min/wk. Linear in ln between
    # 0 and 40 min; HEURISTIC: flat from 40 to 140 min, and no extra credit (and no penalty) above that.
    ln_x = math.log(0.83) * min(x, 40) / 40
    ln_hr = ln_x - math.log(0.83)
    return dict(value=round(x), referent=ref, unit="strength min/wk", ln_hr=ln_hr,
                se_ln=0.05 * min(x, 40) / 40 + 0.03, n=ctx["covered_days"], detail={})


def comp_pullup(ctx):
    p = ctx["pullup_latest"]
    if p is None:
        return None
    reps, age_days = p
    # HEURISTIC: no population pull-up norms or pull-up mortality HRs were found.
    # Referent of 5 reps for men 50-59 (2 for women) is our assumption. Shape: ln-scale, so
    # 0 reps -> +1.5 y and 15 reps -> about -1.5 y, anchored conceptually on grip-strength evidence
    # (Leong 2015: HR 1.16 per 5 kg lower grip) and push-up evidence (Yang 2019).
    ref = 5 if ctx["sex"] == "male" else 2
    if ctx["age"] < 40:
        ref += 3
    k = 0.84 * GOMPERTZ_G
    ln_hr = -k * math.log((reps + 1) / (ref + 1))
    return dict(value=reps, referent=ref, unit="strict pull-ups (max)", ln_hr=ln_hr,
                se_ln=0.5 * abs(ln_hr) + 0.02, n=1, detail={"test_age_days": age_days})


# Global BMI Mortality Collaboration 2016, category HRs (both sexes), category mid-points. EVIDENCE.
BMI_CURVE = [(16.75, 1.51), (19.25, 1.13), (21.25, 1.00), (23.75, 1.00), (26.25, 1.07),
             (28.75, 1.20), (32.5, 1.45), (37.5, 1.94), (50.0, 2.76)]


def comp_bmi(ctx):
    if not ctx["bmi"]:
        return None
    x = ctx["bmi"]
    ln_hr = _ln_curve(x, BMI_CURVE)
    if x > 25 and ctx["sex"] == "male":
        # EVIDENCE: per-5-unit HR above 25 is 1.51 in men vs 1.31 overall -> scale the ln-HR by 1.53.
        ln_hr *= math.log(1.51) / math.log(1.31)
    return dict(value=round(x, 1), referent="22.5-25", unit="kg/m^2", ln_hr=ln_hr,
                se_ln=0.03 + 0.1 * abs(ln_hr), n=ctx["n_weights"],
                detail={"weight_lb": ctx["weight_lb"], "note": "BMI can't tell muscle from fat; add waist or DXA when available"})


def comp_alcohol(ctx):
    if ctx["alcohol_days"] < 1:
        return None
    x = ctx["drinks_wk"]
    g_wk = x * 14.0   # US standard drink = 14 g
    # EVIDENCE: Wood 2018: all-cause mortality lowest at <=100 g/wk; no single per-100 g all-cause HR
    # was reported. HEURISTIC: no credit below 100 g/wk; +ln(1.10) per extra 100 g/wk above it.
    ln_hr = max(0.0, (g_wk - 100) / 100) * math.log(1.10)
    return dict(value=round(x, 1), referent="<=7 drinks/wk (100 g)", unit="drinks/wk", ln_hr=ln_hr,
                se_ln=0.5 * ln_hr + 0.01, n=ctx["alcohol_days"], detail={"g_per_wk": round(g_wk)})


def comp_sauna(ctx):
    if ctx["covered_days"] < 1:
        return None
    x = ctx["sauna_wk"]
    # EVIDENCE: Laukkanen 2015 (Finnish men): 2-3/wk HR 0.76; 4-7/wk HR 0.60 (0.46-0.80) vs 1/wk.
    # Referent = 1/wk. Bonus only; observational with likely healthy-user bias -> overlap 0.5.
    curve = [(1, 1.0), (2.5, 0.76), (5.5, 0.60)]
    ln_hr = _ln_curve(max(x, 1), curve) if x >= 1 else 0.0
    return dict(value=round(x, 1), referent=1, unit="sessions/wk", ln_hr=ln_hr,
                se_ln=0.07 + 0.3 * abs(ln_hr), n=ctx["covered_days"], detail={})


def comp_sugar(ctx):
    if ctx["food_days"] < 1:
        return None
    pct = ctx["sugar_pct_kcal"]
    # EVIDENCE (CVD mortality, not all-cause): Yang 2014: added sugar 10-24.9% kcal HR 1.30;
    # >=25% HR 2.75 vs <10%. HEURISTIC: logged TOTAL sugar used as an upper bound for ADDED sugar.
    curve = [(10, 1.0), (17.5, 1.30), (25, 2.75)]
    ln_hr = _ln_curve(pct, curve) if pct > 10 else 0.0
    return dict(value=round(pct, 1), referent="<10% kcal", unit="% kcal from sugar", ln_hr=ln_hr,
                se_ln=0.1 + 0.3 * ln_hr, n=ctx["food_days"], detail={})


# name: (fn, overlap, cap(lo,hi), shrink_k, min_n, prior_sd_years, evidence_tier, domain)
COMPONENTS = {
    "cardiorespiratory_fitness": (comp_crf, 1.00, (-8, 8), 14, 14, 3.0, "evidence (estimated input)", "fitness"),
    "resting_hr":           (comp_rhr, 0.50, (-3, 3), 7, 7, 1.0, "evidence", "fitness"),
    "hrv":                  (comp_hrv, 0.50, (-2, 2), 7, 7, 0.7, "heuristic", "recovery"),
    "sleep_regularity":     (comp_sleep_reg, 0.844, (-3, 3), 7, 7, 1.5, "evidence", "sleep"),
    "sleep_duration":       (comp_sleep_dur, 0.635, (-2.5, 2.5), 7, 7, 1.0, "evidence", "sleep"),
    "aerobic_activity":     (comp_activity, 0.70, (-3, 3), 14, 14, 1.5, "evidence", "activity"),
    "strength_training":    (comp_strength_time, 1.00, (-0.5, 2.5), 14, 14, 1.0, "evidence", "activity"),
    "pullup_strength":      (comp_pullup, 0.50, (-1.5, 1.5), 0, 1, 0.8, "heuristic", "strength"),
    "body_mass_index":      (comp_bmi, 0.70, (-2, 6), 0, 1, 1.5, "evidence", "body"),
    "alcohol":              (comp_alcohol, 1.00, (0, 3), 14, 7, 0.5, "heuristic (evidence-anchored)", "lifestyle"),
    "sauna":                (comp_sauna, 0.50, (-1.5, 0), 14, 14, 0.4, "evidence (weak, observational)", "lifestyle"),
    "added_sugar":          (comp_sugar, 0.50, (0, 2), 14, 7, 0.5, "heuristic (evidence-anchored)", "nutrition"),
}
METABOLIC_SET = {"cardiorespiratory_fitness", "resting_hr", "body_mass_index", "aerobic_activity",
                 "added_sugar", "strength_training"}


# --------------------------------------------------------------------------------------
# Context building
# --------------------------------------------------------------------------------------
def _latest(series, as_of, max_age_days=None):
    best = None
    for row in series or []:
        d = _d(row[0])
        if d <= as_of and (best is None or d > best[0]):
            best = (d, row[1:])
    if best is None:
        return None
    age = (as_of - best[0]).days
    if max_age_days is not None and age > max_age_days:
        return None
    return best[1], age


def _build_ctx(data, age, sex, as_of, window_days):
    start = as_of - dt.timedelta(days=window_days - 1)
    days = {k: v for k, v in (data.get("days") or {}).items() if start <= _d(k) <= as_of}
    covered = [v for v in days.values() if v.get("worn", True)]
    rhr = [v["rhr"] for v in covered if v.get("rhr")]
    hrv = [v["hrv"] for v in covered if v.get("hrv")]
    slp = [v["sleep_hours"] for v in covered if v.get("sleep_hours")]
    cons = [v["sleep_consistency"] for v in covered if v.get("sleep_consistency")]  # 0 = not computed
    mod = vig = strength = sauna = 0.0
    strength_by_day: dict[str, float] = {}
    for k, v in days.items():
        for w in v.get("workouts", []):
            sport = (w.get("sport") or "").lower()
            if sport == "sauna":
                sauna += 1
                continue
            if sport in STRENGTH_SPORTS:
                strength_by_day[k] = strength_by_day.get(k, 0) + (w.get("minutes") or 0)
                continue
            if sport in NON_AEROBIC:
                continue
            z = w.get("zones_min") or []
            if len(z) >= 6:
                # ACSM (Garber 2011): moderate 40-59% HRR = WHOOP zone 1; vigorous >=60% HRR = zones 2-5.
                mod += z[1]
                vig += sum(z[2:6])
    for d_, m in data.get("strength_logs", []) or []:
        if start <= _d(d_) <= as_of:
            strength_by_day[d_] = max(strength_by_day.get(d_, 0), m)
    for d_, n in data.get("sauna", []) or []:
        if start <= _d(d_) <= as_of and not any((w.get("sport") == "sauna") for w in days.get(d_, {}).get("workouts", [])):
            sauna += n
    strength = sum(strength_by_day.values())
    ncov = len(covered)
    per_wk = (7.0 / ncov) if ncov else 0.0
    # weight / BMI: latest weigh-in within 60 d
    w = _latest(data.get("weights_lb"), as_of, 60)
    h = (data.get("profile") or {}).get("height_m")
    bmi = (w[0][0] * 0.45359237) / h ** 2 if (w and h) else None
    n_weights = sum(1 for r in data.get("weights_lb", []) or [] if start <= _d(r[0]) <= as_of)
    p = _latest(data.get("pullups"), as_of, 120)
    alc = [r[1] for r in data.get("alcohol", []) or [] if start <= _d(r[0]) <= as_of]
    food: dict[str, list[float]] = {}
    for r in data.get("food", []) or []:
        if start <= _d(r[0]) <= as_of:
            f = food.setdefault(r[0][:10], [0.0, 0.0])
            f[0] += r[1] or 0
            f[1] += r[2] or 0
    kcal = sum(f[0] for f in food.values())
    sugar = sum(f[1] for f in food.values())
    return {
        "age": age, "sex": sex, "profile": data.get("profile") or {},
        "covered_days": ncov,
        "rhr_mean": st.mean(rhr) if rhr else None, "rhr_sd": st.pstdev(rhr) if len(rhr) > 1 else 5.0,
        "n_rhr": len(rhr), "hrv_vals": hrv, "sleep_vals": slp, "consistency_vals": cons,
        "mod_min_wk": mod * per_wk, "vig_min_wk": vig * per_wk,
        "mvpa_eq_wk": (mod + 2 * vig) * per_wk,     # EVIDENCE: 2018 PAG 150 MPA ~ 75 VPA equivalence
        "strength_min_wk": strength * per_wk, "sauna_wk": sauna * per_wk,
        "bmi": bmi, "weight_lb": w[0][0] if w else None, "n_weights": max(n_weights, 1 if w else 0),
        "pullup_latest": (p[0][0], p[1]) if p else None,
        "alcohol_days": len(alc), "drinks_wk": (sum(alc) / len(alc) * 7) if alc else 0.0,
        "food_days": len(food), "sugar_pct_kcal": (sugar * 4 / kcal * 100) if kcal > 0 else 0.0,
    }


# --------------------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------------------
def compute(data: dict, chronological_age: float, sex: str = "male", as_of: str | None = None,
            window_days: int = 30, gompertz_g: float = GOMPERTZ_G) -> dict:
    sex = "female" if str(sex).lower().startswith("f") else "male"
    if as_of is None:
        all_days = sorted((data.get("days") or {}).keys())
        as_of_d = _d(all_days[-1]) if all_days else dt.date.today()
    else:
        as_of_d = _d(as_of)
    ctx = _build_ctx(data, chronological_age, sex, as_of_d, window_days)
    comps, total, var = {}, 0.0, 0.0
    meta_total, meta_var = 0.0, 0.0
    for name, (fn, overlap, (lo, hi), k, min_n, prior_sd, tier, domain) in COMPONENTS.items():
        r = fn(ctx)
        if r is None or r["n"] < min_n:
            comps[name] = {"status": "insufficient_data", "n": (r or {}).get("n", 0), "min_n": min_n,
                           "years": 0.0, "tier": tier, "domain": domain,
                           "value": (r or {}).get("value"), "referent": (r or {}).get("referent")}
            var += prior_sd ** 2          # missing data widens the interval
            if name in METABOLIC_SET:
                meta_var += prior_sd ** 2
            continue
        raw = r["ln_hr"] / gompertz_g
        se_raw = r["se_ln"] / gompertz_g
        shrink = r["n"] / (r["n"] + k) if k else 1.0
        if name == "pullup_strength":                     # stale strength tests decay (HEURISTIC)
            shrink = 0.5 ** (r["detail"].get("test_age_days", 0) / 90)
        yrs = max(lo, min(hi, raw)) * overlap * shrink
        # Posterior-ish variance: measured part shrinks; the unmeasured part reverts to the prior.
        v = (se_raw * overlap * shrink) ** 2 + (prior_sd * (1 - shrink)) ** 2
        var += v
        total += yrs
        if name in METABOLIC_SET:
            meta_total += yrs
            meta_var += v
        comps[name] = {"status": "ok", "value": r["value"], "referent": r["referent"], "unit": r["unit"],
                       "hazard_ratio_vs_referent": round(math.exp(r["ln_hr"]), 3),
                       "years_raw": round(raw, 2), "overlap": overlap, "shrink": round(shrink, 2),
                       "cap": [lo, hi], "years": round(yrs, 2), "se_years": round(math.sqrt(v), 2),
                       "n": r["n"], "min_n": min_n, "tier": tier, "domain": domain,
                       "detail": r.get("detail", {})}
    total = max(-TOTAL_CAP, min(TOTAL_CAP, total))
    sd = math.sqrt(var)
    coach_age = chronological_age + total
    n_ok = sum(1 for c in comps.values() if c["status"] == "ok")
    cov = ctx["covered_days"] / window_days
    crf_measured = bool((data.get("profile") or {}).get("vo2max_measured"))
    # HEURISTIC confidence tiers. "high" needs >=80% wear coverage, a measured VO2max and SD < 2 y.
    confidence = ("high" if sd < 2.0 and n_ok >= 8 and cov >= 0.8 and crf_measured
                  else "medium" if sd < 3.5 and n_ok >= 5 and cov >= 0.5 else "low")
    actionable = sorted(((c["years"], n) for n, c in comps.items() if c["status"] == "ok"), reverse=True)
    return {
        "as_of": as_of_d.isoformat(), "window_days": window_days, "chronological_age": chronological_age,
        "sex": sex, "coach_age": round(coach_age, 1), "delta_years": round(total, 2),
        "ci80": [round(coach_age - Z80 * sd, 1), round(coach_age + Z80 * sd, 1)],
        "ci95": [round(coach_age - Z95 * sd, 1), round(coach_age + Z95 * sd, 1)],
        "sd_years": round(sd, 2), "confidence": confidence,
        "coverage": {"days_with_whoop": ctx["covered_days"], "window_days": window_days,
                     "components_ok": n_ok, "components_total": len(COMPONENTS)},
        "metabolic_age": {
            "value": round(chronological_age + meta_total, 1), "delta_years": round(meta_total, 2),
            "ci80": [round(chronological_age + meta_total - Z80 * math.sqrt(meta_var), 1),
                     round(chronological_age + meta_total + Z80 * math.sqrt(meta_var), 1)],
            "components": sorted(METABOLIC_SET)},
        "top_levers": [n for y, n in actionable if y > 0][:3],
        "components": comps, "gompertz_g": gompertz_g,
    }


def pace_of_aging(data, chronological_age, sex="male", as_of=None, span_days=56, window_days=30):
    """Pace = 1 + d(delta)/dt (years of Coach Age per calendar year), from a Theil-Sen slope of
    daily Coach-Age deltas over `span_days`, then shrunk toward 0 by its uncertainty, clipped to [-1, 3]."""
    all_days = sorted((data.get("days") or {}).keys())
    end = _d(as_of) if as_of else _d(all_days[-1])
    pts = []
    for i in range(span_days):
        d = end - dt.timedelta(days=span_days - 1 - i)
        if d.isoformat() not in (data.get("days") or {}):
            continue
        r = compute(data, chronological_age, sex, d.isoformat(), window_days)
        if r["coverage"]["days_with_whoop"] >= 14:
            pts.append((i, r["delta_years"]))
    if len(pts) < 21:
        return {"pace": None, "status": "insufficient_data", "points": len(pts), "min_points": 21}
    slopes = sorted((y2 - y1) / (x2 - x1) for (x1, y1), (x2, y2) in
                    ((a, b) for j, a in enumerate(pts) for b in pts[j + 1:]) if x2 != x1)
    slope = slopes[len(slopes) // 2] * 365.25           # years of delta per year
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    xm, ym = st.mean(xs), st.mean(ys)
    resid = [y - (ym + slope / 365.25 * (x - xm)) for x, y in pts]
    sxx = sum((x - xm) ** 2 for x in xs)
    span = xs[-1] - xs[0]
    n_eff = max(2.0, span / 15.0)   # HEURISTIC: 30-d windows overlap, so the effective n is small
    se = (st.pstdev(resid) / math.sqrt(sxx) * math.sqrt(len(pts) / n_eff) * 365.25) if sxx else float("inf")
    shrunk = slope * slope ** 2 / (slope ** 2 + se ** 2) if se < float("inf") else 0.0
    pace = max(-1.0, min(3.0, 1.0 + shrunk))
    return {"pace": round(pace, 2), "raw_pace": round(1 + slope, 2), "slope_se": round(se, 2),
            "ci80": [round(max(-1, min(3, 1 + shrunk - Z80 * se)), 2), round(max(-1, min(3, 1 + shrunk + Z80 * se)), 2)],
            "points": len(pts), "span_days": span, "status": "ok"}


# --------------------------------------------------------------------------------------
# Adapter for the starter kit data.json (read-only)
# --------------------------------------------------------------------------------------
def from_coach_data(raw: dict) -> dict:
    W = raw.get("wear") or raw.get("whoop") or {}
    wd = W.get("days") or {}
    prof = W.get("profile") or {}
    to_lb = 2.20462 if (raw.get("profile") or {}).get("units") == "kg" else 1.0
    days = {}
    for k, v in wd.items():
        rec, slp = v.get("recovery") or {}, v.get("sleep") or {}
        wos = []
        for w in v.get("workouts") or []:
            try:
                mins = (dt.datetime.fromisoformat(w["end"]) - dt.datetime.fromisoformat(w["start"])).total_seconds() / 60
            except Exception:
                mins = sum(w.get("zones_min") or []) or 0
            wos.append({"sport": w.get("sport"), "minutes": mins, "zones_min": w.get("zones_min")})
        days[k] = {"worn": bool(v.get("cycle") or rec), "rhr": rec.get("rhr"), "hrv": rec.get("hrv"),
                   "sleep_hours": slp.get("hours_asleep"),
                   "sleep_consistency": slp.get("consistency") or None, "workouts": wos}
    weights = [[w["date"], w["value"] * to_lb] for w in raw.get("weights", [])]
    if not weights and prof.get("weight_lb"):
        weights = [[(W.get("synced_at") or "")[:10], prof["weight_lb"]]]
    journal = raw.get("journal") or {}
    return {
        "profile": {"height_m": prof.get("height_m"), "max_hr": prof.get("max_heart_rate")},
        "days": days,
        "weights_lb": weights,
        "pullups": [[p["date"], p["reps"]] for p in raw.get("pullup_max", [])],
        # HEURISTIC: manual PUSH/PULL log without a duration counts as 45 min
        "strength_logs": [[w["date"], 45] for w in raw.get("workouts", []) if str(w.get("type", "")).upper() in ("PUSH", "PULL", "LEGS", "STRENGTH")],
        "alcohol": [[d, j.get("alcohol", 0)] for d, j in journal.items() if "alcohol" in j],
        "sauna": [[d, j.get("sauna", 0)] for d, j in journal.items() if j.get("sauna")],
        "food": [[f["date"], f.get("cal", 0), f.get("sugar", 0)] for f in raw.get("food", [])],
    }


# --------------------------------------------------------------------------------------
# Self-test on synthetic data
# --------------------------------------------------------------------------------------
def _synthetic(fit: bool, n_days=90, gap=None, trend=0.0, seed=1):
    import random
    rnd = random.Random(seed)
    end = dt.date(2026, 10, 8)
    days = {}
    for i in range(n_days):
        d = end - dt.timedelta(days=n_days - 1 - i)
        if gap and gap[0] <= i < gap[1]:
            continue
        f = i / n_days
        rhr = (52 if fit else 72) - trend * 8 * f + rnd.gauss(0, 2)
        wos = []
        if i % 2 == 0:
            wos.append({"sport": "running", "minutes": 45,
                        "zones_min": [2, 10, 15, 12, 6, 0] if fit else [5, 6, 2, 0, 0, 0]})
        if fit and i % 3 == 0:
            wos.append({"sport": "weightlifting", "minutes": 40, "zones_min": [10, 20, 8, 2, 0, 0]})
        days[d.isoformat()] = {"rhr": rhr, "hrv": (70 if fit else 25) * math.exp(rnd.gauss(0, .15) + trend * .3 * f),
                               "sleep_hours": (7.5 if fit else 5.8) + trend * f + rnd.gauss(0, .4),
                               "sleep_consistency": (88 if fit else 55) + trend * 20 * f + rnd.gauss(0, 5),
                               "workouts": wos}
    return {"profile": {"height_m": 1.80, "max_hr": 180 if fit else 170}, "days": days,
            "weights_lb": [[end.isoformat(), 172 if fit else 240]],
            "pullups": [[end.isoformat(), 14 if fit else 0]],
            "alcohol": [[(end - dt.timedelta(days=i)).isoformat(), 0 if fit else 3] for i in range(20)]}


def self_test(verbose=True):
    fit = compute(_synthetic(True), 45)
    unfit = compute(_synthetic(False), 45)
    sparse = compute(_synthetic(True, gap=(62, 86)), 45)
    assert fit["coach_age"] < 45 < unfit["coach_age"], (fit["coach_age"], unfit["coach_age"])
    assert sparse["sd_years"] > fit["sd_years"], "sparse data must widen the interval"
    assert abs(sparse["delta_years"]) < abs(fit["delta_years"]), "sparse data must shrink toward the referent"
    assert compute(_synthetic(True), 45, gompertz_g=0.1)["delta_years"] > fit["delta_years"], "G=0.1 gives smaller |delta|"
    imp = pace_of_aging(_synthetic(False, trend=1.0), 45)
    flat = pace_of_aging(_synthetic(False, trend=0.0, seed=3), 45)
    assert imp["status"] == "ok" and imp["pace"] < flat["pace"], (imp, flat)
    assert -1 <= imp["pace"] <= 3
    if verbose:
        for lbl, r in (("fit", fit), ("unfit", unfit), ("sparse-fit", sparse)):
            print(f"{lbl:11s} CoachAge {r['coach_age']:5.1f} (80% {r['ci80']}) conf={r['confidence']}")
        print(f"pace improving={imp['pace']} flat={flat['pace']}")
        print("self-test OK")
    return True


if __name__ == "__main__":
    import json
    import sys
    self_test()
    if len(sys.argv) > 2:
        raw = json.load(open(sys.argv[1]))
        data = from_coach_data(raw)
        age = float(sys.argv[2])
        out = compute(data, age)
        out["pace_of_aging"] = pace_of_aging(data, age)
        print(json.dumps(out, indent=2))
