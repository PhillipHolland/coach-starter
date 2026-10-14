# Coach Age v1 and Pace of Aging: research and design

*Prepared 2026-10-08. Companion files: `coach_age_spec.json` (implementation spec) and `coach_age.py` (reference implementation with self-test).*

Every number below is either **[E] evidence**, quoted from the cited source, or **[H] heuristic**, our own modelling choice, labelled as such. We didn't make up any coefficients. Where a coefficient couldn't be found, we say so.

---

## 1. How WHOOP Age, Healthspan and Pace of Aging work (reverse-engineered)

The primary source is the WHOOP Healthspan white paper (rev. 2025-09-04), written with the Buck Institute [1], plus WHOOP's Locker pages [2,3].

* **Not Dunedin PACE, not a methylation clock.** WHOOP Age is an **"effective age"** built from published **all-cause-mortality hazard ratios** (Spiegelhalter 2016 framework [4]). The white paper gives the conversion as *t = ln(HR)/ln(e^c) = ln(HR)/0.1 = 10·ln(HR)*, which assumes risk rises about 10% per year of age. It cites Gompertz (doubling every 8–10 y) [1].
* **Nine inputs in three domains:** sleep consistency, sleep duration, steps, HR-zone 1–3 minutes, HR-zone 4–5 minutes, strength-activity time, VO2max, resting HR, and lean-body-mass %. WHOOP Age is "the sum of the Age Impacts" of the contributors, computed over **6 months** of data [1].
* **Referent = "health-optimised" targets, not population averages.** Published neutral points [1]:
  * sleep consistency ≥70%
  * 7–9 h of sleep (small credit; no effect above 9 h)
  * steps ≥8,000 for younger adults and ~5,600 for older adults
  * Z1–3 ≥70–100 min/wk and Z4–5 ≥7–10 min/wk (both decrease with age)
  * strength ≥40 min/wk (no extra benefit above 2 h)
  * a VO2max table (e.g. male 50 y = 36, 55 y = 34)
  * RHR ~60 bpm for men and ~64 bpm for women
  * lean mass ≥80% for a 30-y-old man (no effect if not entered)
* **Weights and overlap:** WHOOP doesn't publish weights. A **structural equation model** fitted on member covariance produces "adjustment factors" applied to each HR to avoid double counting (e.g. RHR vs VO2max) [1]. Those factors aren't published, so WHOOP Age **can't be fully reproduced**.
* **Some HRs are age-varying.** For example, steps and zone time matter more after 60 [1].
* **Pace of Aging:** WHOOP projects WHOOP Age assuming the last 30 days of averages hold for 6 months, then compares the result with the current WHOOP Age. Pace = 1 if WHOOP Age grows exactly 0.5 y in 6 months. The scale runs −1.0x to 3.0x and updates weekly [1,3].
* **Validation offered:** the WHOOP Age delta grades with self-rated health (poor +5.96 y … excellent −5.05 y, n≈23k) and with chronic disease (type 2 diabetes +3.75 y). That evidence is cross-sectional only, with no mortality follow-up [1].
* **Typical values:** a U.S. 30-y-old man is about +6 y and the median WHOOP member about −1.6 y [1].
* **Evidence WHOOP cites per input** [1]:
  * Windred 2024 (sleep regularity)
  * Itani 2017 and Cappuccio 2010 (sleep duration)
  * Lee 2022 (PA intensity)
  * Momma 2022 and Shailendra 2022 (strength)
  * Paluch 2022 and Sheng 2021 (steps)
  * Mandsager 2018 (VO2max)
  * Zhang 2016 and Jensen 2013 (RHR)
  * Jayedi 2022 (body fat: +11% mortality per +10% fat)

## 2. Evidence base

### 2.1 Gompertz conversion from HR to years
* The adult mortality-rate doubling time is about 8 y (Finch, Pike & Witten 1990) [5], so G = ln2/8.15 ≈ **0.085 /y [E-derived]**.
* Spiegelhalter uses about 10% per year (ln 1.1 = 0.095) [4]. WHOOP uses 0.1 [1].
* Formula: **years = ln(HR)/G**. With G = 0.085, HR 1.10 → +1.12 y, HR 1.5 → +4.8 y and HR 0.5 → −8.2 y. With G = 0.1, every delta is about 15% smaller. The code takes G as a parameter.
* **Caveats:** the conversion assumes proportional hazards and a log-linear baseline hazard. It also doesn't predict life expectancy (Pang & Hanley 2021, cited in [1]).

### 2.2 Cardiorespiratory fitness (strongest single input)
| Source | Effect |
|---|---|
| Mandsager 2018, 122,007 treadmill patients [6] | Elite vs low: HR 0.20 (0.16–0.24); low vs elite: HR 5.04; below- vs above-average: HR 1.41 (1.34–1.49). No upper limit of benefit. |
| Kokkinos 2022, 750,302 veterans [7] | **HR 0.86 (0.85–0.87) per +1 MET**; least fit vs extremely fit: HR 4.09; nadir at ~14 METs. |
| FRIEND norms (Kaminsky 2015) [8] | Male p50 VO2max: 48.0 (20s), 42.4, 37.8, **32.6 (50s)**, 28.2, 24.4 (70s); decline ~10%/decade. |

* **Fitness age (Nes/HUNT):** the age at which the reference curve equals your estimated VO2peak [9,10].

**Non-exercise VO2max estimators (we can't measure VO2max directly):**
* **Uth–Sørensen heart-rate-ratio method** [11]: VO2max = 15.3·HRmax/HRrest.
  * SEE 2.7 mL/kg/min (4.5%) with measured HRmax; 4.7 (7.8%) with age-predicted HRmax.
  * Derived in **46 well-trained men**. In middle-aged and older adults it showed poor agreement (rc ≤ 0.40) and bias [12].
  * Uth used awake HRrest; WHOOP's RHR is measured during sleep (lower), so the method may overestimate. **[H]** We inflate its SD to 6.
* **Jackson 1990** [13]: VO2 = 56.363 + 1.921·PAR − 0.381·age − 0.754·BMI + 10.987·male.
  * SEE 5.6 (BMI model). A %fat model also exists (SEE 5.3).
  * **[H]** We approximate PAR from vigorous minutes.
* **HUNT/Nes 2011** [9]:
  * men: 100.27 − 0.296·age − 0.369·waist − 0.155·RHR + 0.226·PA-index
  * women: 74.74 − 0.247·age − 0.259·waist − 0.114·RHR + 0.198·PA-index
  * SEE 5.70/5.14; R² 0.61/0.56
  * **Needs waist circumference.** Logging it would unlock the best-validated estimator.

### 2.3 Resting heart rate
* **Jensen 2013**, Copenhagen Male Study, 2,798 men followed 16 y [14]:
  * **+16% (10–22%) mortality per +10 bpm**, *adjusted for measured VO2max*
  * >90 vs ≤50 bpm: HR 3.06 (1.97–4.75)
* **Zhang 2016** CMAJ meta-analysis [15]: RR 1.09 (1.07–1.12) per +10 bpm.

### 2.4 HRV (RMSSD) norms
* **Nunan 2010** review [16]: short-term RMSSD mean 42 ms (range 19–75) in healthy adults. Values depend heavily on the method.
* **Fitbit, 8.2 M users** [17]: RMSSD declines with age faster than SDRR. There's no sex difference in RMSSD. Benchmark tables are in the paper, but we didn't extract per-age RMSSD values.
* **WHOOP member overnight RMSSD**, middle 50% [18]: men 50–100 ms at 25 y and 35–60 ms at 45 y; women 45–90 and 30–55. Means are 65 (M) and 62 (F).
* **[H]** Our referent is the geometric mid-point, log-linear in age. Extrapolated to 52 y this gives **~39 ms** for men.
* **Mortality link:** we didn't find a general-population all-cause HR for RMSSD. The closest is Hillebrand 2013 [19]: lowest vs highest HRV (SDNN), **first CV event RR 1.35 (1.10–1.67)**. So HRV is a **heuristic, low-weight** component.

### 2.5 Sleep
* **Windred 2024**, UK Biobank, n = 60,977, actigraphy [20]. SRI quintile medians were 65.1/75.6/81.0/85.2/89.8.
  * Fully adjusted HRs vs the least-regular quintile: 0.80, 0.75, 0.72, **0.70 (0.59–0.83)**. Minimally adjusted: down to 0.52.
  * Duration quintiles (5.5/6.3/6.8/7.3/7.9 h) fully adjusted: 0.82/0.83/0.76/0.76.
  * With both in one model, SRI stayed significant and duration added little (LRT p = 0.14–0.20).
  * The attenuation ratios give our **evidence-based overlap factors: 0.844 (SRI) and 0.635 (duration)**.
  * Practical note: the top-SRI group slept and woke within ~1-h windows; the bottom group within ~3-h windows.
* **Cappuccio 2010** meta-analysis [21]: short sleep RR 1.12 (1.06–1.18) and long sleep RR 1.30 (1.22–1.38) vs 7–8 h. The long-sleep risk is likely reverse causation, so we don't penalise long sleep (WHOOP does the same).

### 2.6 Activity, steps and strength
* **Lee 2022** Circulation, 116k adults, 30 y follow-up [22]. Long-term MPA HRs: 0–19 min 1.00; 20–74 0.91; 75–149 0.84; **150–224 0.80**; 225–299 0.79; 300–374 0.74; 450–599 0.69; ≥600 0.68.
  * VPA 75–149 min: 0.81; 150–299 min: 0.77–0.79; no further benefit at ≥300.
  * Zone mapping per ACSM (Garber 2011) [23]: moderate = 40–59% HRR, which matches WHOOP Z1; vigorous = 60–89% HRR, which matches WHOOP Z2–5. (WHOOP labels Z2–3 "moderate".)
* **Paluch 2022**, steps, 15 cohorts [24]: Q2 (5,801) 0.60, Q3 (7,842) 0.55, Q4 (10,901) **0.47** vs Q1 (3,553). Benefits plateau at 6–8k steps (≥60 y) and 8–10k (<60 y).
  * *The WHOOP v2 API has no step count*, so steps aren't scored until another source is added.
* **Momma 2022** BJSM [25]:
  * any muscle-strengthening: RR 0.85 (0.79–0.93)
  * J-shaped, with the **lowest RR 0.83 (0.79–0.86) at 40 min/wk**
  * RR stays below 1 up to ~130–140 min/wk; benefit beyond that is unclear
* **Strength capacity:**
  * grip: **HR 1.16 (1.13–1.20) per 5 kg lower** (PURE, Leong 2015) [26]
  * push-ups: >40 vs <10 → CVD IRR 0.04 (0.01–0.36) (Yang 2019, firefighters) [27]
  * **We found no population pull-up norms or pull-up mortality HRs** [28], so the pull-up component is **[H]**.

### 2.7 Body composition
* **Global BMI Mortality Collaboration 2016**, 10.6 M participants [29]: mortality is lowest at 20–25. HRs vs 22.5–25:
  * 25–27.5: 1.07
  * 27.5–30: 1.20
  * 30–35: 1.45
  * 35–40: 1.94
  * 18.5–20: 1.13
  * Per +5 above 25: **1.51 for men** vs 1.30 for women.
* Body fat: +11% mortality per +10% fat (Jayedi 2022, as cited by WHOOP [1]).
* BMI misclassifies muscular people. Adding waist circumference or DXA would be a real upgrade.

### 2.8 Nutrition and lifestyle (WHOOP doesn't score these)
* **Alcohol:** risk is lowest at ≤100 g/wk (Wood 2018) [30]. We found no single all-cause per-100 g HR, so the slope is **[H]**.
* **Added sugar:** CVD mortality HR 1.30 at 10–24.9% kcal and 2.75 at ≥25% (Yang 2014) [31]. That's CVD mortality, not all-cause, and we log total sugar, not added sugar, so this is **[H]-anchored**.
* **Sauna:** 4–7/wk HR 0.60 (0.46–0.80) vs 1/wk (Laukkanen 2015) [32]. It's a single cohort with likely healthy-user bias, so we give it overlap 0.5.
* **Protein, stress and caffeine:** we found no HR suitable for a years delta, so they're displayed but not scored.

### 2.9 Biological-age methods
* **Klemera–Doubal (2006):** biological age is the age at which a biomarker profile is typical, combining marker-on-age regressions weighted by their residual error [33]. Coach Age borrows its idea of age-normed markers.
* **PhenoAge (Levine 2018):** nine blood markers plus age go into a Gompertz mortality model, inverted to an age: PhenoAge = 141.50 + ln(−0.00553·ln(1−M))/0.090165 [34,35]. Note the implied Gompertz slope of 0.090/y, close to our 0.085. It needs labs we don't have.
* **DunedinPACE (Belsky 2022):** a methylation estimate of the *rate* of aging; 1.0 means one biological year per calendar year (cohort mean 1.0, SD 0.29) [36]. Our Pace of Aging copies this *unit* (years per year), not the method.

### 2.10 "Metabolic age"
Scale-reported "metabolic age" is a proprietary, BMR-derived bioimpedance output. It has only cross-sectional associations with metabolic-risk scores, and BIA has individual-level bias against DXA [37,38,39]. **We found no mortality validation; it's essentially a marketing number.** Instead we offer a **Cardiometabolic Age**: the same HR→years engine restricted to CRF, RHR, BMI, aerobic activity, strength time and added sugar.

## 3. Coach Age v1 design

**Formula.** `CoachAge = age + clip(Σ_i overlap_i · shrink_i · clip(years_i, cap_i), ±15)`, where `years_i = [ln HR_i(x) − ln HR_i(ref_i)]/0.085`.

**Referent.** Physiology is compared with the healthy age- and sex-typical value (FRIEND p50 VO2max, RHR 60/64, median SRI 81). Behaviours are compared with guideline minimums (150 MPA-eq min/wk, 40 strength min/wk, 7 h sleep). So Coach Age = age means "typical healthy, guideline-meeting peer." That's somewhat more lenient than WHOOP's optimised targets for physiology and similar for behaviours.

| Component | HR source | Referent | Cap (y) | Overlap | k / min n | Tier |
|---|---|---|---|---|---|---|
| CRF (est. VO2max) | Kokkinos 0.86/MET | FRIEND p50 | ±8 | 1.0 | 14/14 | E (input estimated) |
| Resting HR | Jensen 1.16/10 bpm (M), Zhang 1.09 (F) | 60/64 | ±3 | 0.5 [H] | 7/7 | E |
| HRV | Hillebrand 1.35 (CV events) | WHOOP band mid | ±2 | 0.5 | 7/7 | **H** |
| Sleep regularity | Windred quintiles | SRI 81 | ±3 | 0.844 [E] | 7/7 | E (WHOOP%≈SRI is H) |
| Sleep duration | Windred quintiles | 7.0 h | ±2.5 | 0.635 [E] | 7/7 | E |
| Aerobic activity | Lee 2022 MPA curve | 150 min/wk | ±3 | 0.7 [H] | 14/14 | E |
| Strength time | Momma 0.83 @40 min | 40 min/wk | −0.5/+2.5 | 1.0 | 14/14 | E |
| Pull-ups | (grip/push-up anchors) | 5 reps (M 50s) | ±1.5 | 0.5 | test ≤120 d | **H** |
| BMI | GBMC categories, ×1.53 men | 22.5–25 | −2/+6 | 0.7 [H] | 1 | E |
| Alcohol | Wood threshold | ≤100 g/wk | 0/+3 | 1.0 | 14/7 | H (anchored) |
| Sauna | Laukkanen | 1/wk | −1.5/0 | 0.5 | 14/14 | E (weak) |
| Added sugar | Yang 2014 (CVD) | <10% kcal | 0/+2 | 0.5 | 14/7 | H (anchored) |

**Shrinkage, minimum data and uncertainty:**
* Each component is shrunk by n/(n+k) toward its referent (0 y).
* A component below its minimum n contributes 0 y but adds its prior SD² to the variance, so missing data widens the interval rather than biasing the estimate.
* Per-component variance combines the HR's 95% CI (as a log SE), the sampling SE of the 30-day mean, and for VO2max the estimator SEE plus between-method disagreement.
* We report CI80 and CI95.
* Confidence is **high** only with ≥80% wear coverage, a measured VO2max and SD < 2 y.
* SpO2, skin temperature and respiratory rate aren't scored. They're for illness flags (freeze updates on flagged days).

**Smoothing.** Rolling 30-day window, recomputed daily.

**Pace of Aging:**
* pace = 1 + slope of the daily Coach-Age delta (years/year).
* Theil–Sen slope over 56 days (8 weeks), shrunk by slope²/(slope² + SE²).
* SE is inflated for autocorrelation of the overlapping windows (n_eff = span/15) **[H]**.
* Clipped to −1…3 (WHOOP-compatible).
* Needs ≥21 daily points, each of which needs ≥14 worn days in its own window.

### Why it's better than WHOOP Age
1. **Transparent.** Every HR, referent, cap and overlap factor is published in the spec. WHOOP's SEM adjustment factors and per-metric curves aren't.
2. **Uncertainty is shown.** There are CI80/CI95, a confidence tier and per-component SEs, and sparse data visibly shrinks the estimate and widens the interval. WHOOP shows a point estimate only.
3. **Strength capacity, not just time.** It includes pull-ups as a heuristic proxy until grip or other strength tests are added.
4. **Nutrition and lifestyle are included:** alcohol, sugar and sauna. WHOOP explicitly omits nutrition [1].
5. **Evidence-derived overlap factors where possible** (the Windred sleep attenuations), and heuristics are labelled.
6. **Each component is individually actionable,** expressed in years and ranked as "top levers".
7. **The slope-based Pace has error bars**, rather than a single projection.

**Limitations.** All inputs are observational associations. VO2max is *estimated* (±~4–6 mL/kg/min ≈ ±2–3 y). BMI isn't body composition. WHOOP consistency isn't SRI. HR-zone minutes aren't the self-reported leisure-time PA used in Lee 2022. There are no steps.

## 4. Citations
1. WHOOP. *The WHOOP Healthspan Feature* (white paper, rev. 2025-09-04). https://assets.ctfassets.net/rbzqg6pelgqa/3ONehqJslbqxI7CQlwGjfT/36429d6f66940e1fd866a772ed5bfc93/WHOOP_2025_White_Paper_Healthspan__6_.pdf
2. WHOOP. Healthspan White Paper summary. https://www.whoop.com/us/en/thelocker/Healthspan-Data-Meets-Longevity/
3. WHOOP. How Healthspan helps you optimize longevity. https://www.whoop.com/us/en/thelocker/how-healthspan-on-whoop-helps-you-optimize-longevity/
4. Spiegelhalter D. How old are you, really? BMC Med Inform Decis Mak 2016. https://pubmed.ncbi.nlm.nih.gov/27496144/
5. Finch CE, Pike MC, Witten M. Slow mortality rate accelerations… Science 1990. https://www.science.org/doi/10.1126/science.2392680
6. Mandsager K et al. JAMA Netw Open 2018. https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2707428
7. Kokkinos P et al. JACC 2022. https://www.jacc.org/doi/10.1016/j.jacc.2022.05.031
8. Kaminsky LA et al. FRIEND reference standards. Mayo Clin Proc 2015. https://pmc.ncbi.nlm.nih.gov/articles/PMC4919021/
9. Nes BM et al. Estimating VO2peak from a nonexercise prediction model: HUNT. MSSE 2011. https://journals.lww.com/acsm-msse/fulltext/2011/11000/estimating_v_o2peak_from_a_nonexercise_prediction.2.aspx
10. Estimated CRF and CV mortality, HUNT. https://pubmed.ncbi.nlm.nih.gov/27866655/ ; NYT explainer of fitness age: https://archive.nytimes.com/well.blogs.nytimes.com/2013/10/31/how-old-is-your-health/
11. Uth N et al. Heart Rate Ratio Method. Eur J Appl Physiol 2004. https://pure.au.dk/portal/en/publications/estimation-of-vo2max-from-the-ratio-between-hrmax-and-hrrest-the-/
12. HRRM in middle-aged/older adults (2021). https://pubmed.ncbi.nlm.nih.gov/34495410/
13. Jackson AS et al. Prediction of functional aerobic capacity without exercise testing. MSSE 1990. https://ntrs.nasa.gov/citations/20050017669
14. Jensen MT et al. Heart 2013. https://heart.bmj.com/content/99/12/882
15. Zhang D et al. CMAJ 2016. https://www.cmaj.ca/content/188/3/E53
16. Nunan D et al. PACE 2010. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-8159.2010.02841.x
17. Natarajan A et al. Lancet Digit Health 2020. https://www.thelancet.com/journals/landig/article/PIIS2589-7500%2820%2930246-6/fulltext
18. WHOOP. Normal HRV range by age and gender. https://www.whoop.com/us/en/thelocker/normal-hrv-range-age-gender/
19. Hillebrand S et al. Europace 2013. https://pubmed.ncbi.nlm.nih.gov/23370966/
20. Windred DP et al. Sleep 2024. https://pmc.ncbi.nlm.nih.gov/articles/PMC10782501/
21. Cappuccio FP et al. Sleep 2010. https://pmc.ncbi.nlm.nih.gov/articles/PMC2864873/
22. Lee DH et al. Circulation 2022. https://pmc.ncbi.nlm.nih.gov/articles/PMC9378548/
23. Garber CE et al. ACSM Position Stand 2011. https://europepmc.org/article/med/21694556
24. Paluch AE et al. Lancet Public Health 2022. https://pubmed.ncbi.nlm.nih.gov/35247352/
25. Momma H et al. BJSM 2022. https://bjsm.bmj.com/content/56/13/755
26. Leong DP et al. Lancet 2015 (PURE). https://pubmed.ncbi.nlm.nih.gov/25982160/
27. Yang J et al. JAMA Netw Open 2019. https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2724778
28. Norwegian adult musculoskeletal fitness norms (no pull-up norms by age). https://link.springer.com/article/10.1186/s13102-016-0059-4
29. Global BMI Mortality Collaboration. Lancet 2016. https://pmc.ncbi.nlm.nih.gov/articles/PMC4995441/
30. Wood AM et al. Lancet 2018. https://pubmed.ncbi.nlm.nih.gov/29676281/
31. Yang Q et al. JAMA Intern Med 2014. https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/1819573
32. Laukkanen T et al. JAMA Intern Med 2015. https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/2130724
33. Kwon D, Belsky DW. BioAge toolkit (KDM, PhenoAge). https://pmc.ncbi.nlm.nih.gov/articles/PMC8602613/
34. Levine ME et al. Aging 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC5940111/
35. PhenoAge formula supplement. https://rcastoragev2.blob.core.windows.net/4fd48550790076952a31ff48e5500b2b/aging-10-101414-s001.pdf
36. Belsky DW et al. DunedinPACE. eLife 2022. https://pmc.ncbi.nlm.nih.gov/articles/PMC8853656/
37. Metabolic age (BMR-based) and metabolic syndrome. https://pubmed.ncbi.nlm.nih.gov/33666897/
38. Bioimpedance metabolic age and insulin-resistance scales. https://www.mdpi.com/2072-6643/17/6/945
39. BIA vs DXA in UK Biobank. https://www.sciencedirect.com/science/article/abs/pii/S2405457724001864
