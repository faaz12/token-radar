# Evaluation Charter v1.4 — Token Radar (radar-11)

Locked **before** fitting radar-11. Any change after results creates a new
charter version and labels the prior results **exploratory**. Radar-10 numbers
were computed under charter v1.3; the evaluation procedure changed in v1.4
(outlier audit with with/without analysis, ranking-stability evaluation,
segmented OOD report, cap-as-risk-control stress test, outcome-vs-parameter
uncertainty split, launch-probability labeling, per-protocol decision trace,
single-final-artifact rerun, Gemini conditional-EV gate candidates (d)/(e),
and the Rain winsorization candidate tested prespecified), so radar-10
numbers are **exploratory under v1.4** and must not be quoted as v1.4
results. Radar-10 is frozen in `hidden_files/radar-10-freeze/` (board, data,
dossier, metrics, CHARTER-v1.3.md, FREEZE.md, snapshot sha256
42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393).

## Why v1.3 exists — the defect it fixes

Under v1.2 the adopted gate (variant a: mean EV > 0 AND P25 of the net
return > 0) farms 0 rows, while variant (b) farms all 151 positive-EV rows
with a maximum P(negative return) of 0.9293 — so the gate test says nothing
useful about which rows are actually worth farming, and the 0-farm board
fails the bounty's core requirement (a ranked list of protocols worth
farming). Two independent reviews of radar-9 (Q7) both said NO to
submitting it, and both diagnosed the same root causes:

1. **The P25 gate is structurally impossible for a call option.** P25 of
   the net return > 0 requires at least 75% of outcomes to be positive —
   a 25th percentile above zero is a statement about 75% of the
   distribution, not 25% (the v1.2 documentation misstates this). With
   launch odds p_L = 16.4%, P(net return > 0) ≤ p_L = 16.4% < 75%, so the
   gate cannot pass for ANY row under the base rate. It was testing an
   impossible condition, not a sign that rows are bad.
2. **The mean EV is driven by the uncapped lognormal right tail.**
   For Polymarket the conditional mean value is $894M against a median of
   $82.7M (a 10.8× ratio from σ = 0.948 dex): the "expected value" is a
   tail artifact, not a typical outcome, and no distribution sensitivity
   was ever shown. A farm verdict that rests on the uncapped tail alone is
   not a validated decision.
3. **The launch odds are a flat constant (16.4%) for every protocol**,
   and the seasoning curve does not beat it — so the board ranks on fitted
   value alone, and the EV's upside comes from the value tail, not from
   discriminating launch odds. Any attempt to improve the odds (a
   heuristic activity multiplier, a survival model) must beat the base
   rate out of sample before it touches the board.
4. **Valuation and farming were one undifferentiated output.** The
   valuation radar (conditional value + uncertainty) is useful even with
   0 farms; the farming decision engine (gate policies, EV, verdicts) is
   a separate function with separate validation. v1.3 splits them on the
   dashboard and validates each on its own terms. The farm count is never
   a target and never a reason to change a rule.

## Why v1.4 exists — the defect it fixes

Under v1.3 the board still hinges on one outlier (LOPO: dropping rain moves
a board row 0.68 dex; obol moves the slope 0.12), there is no evidence the
ranking is stable, the OOD validation is thin and unsegmented (n = 28, and
the in-distribution conformal slice is empty by construction), the cap is
not yet shown as a risk control separate from model selection, the EV
simulation does not separate outcome uncertainty from parameter/model
uncertainty, the 16.4% launch odds are shown as if they were per-protocol,
and no per-protocol decision trace exists. Two independent reviews of
radar-10 (Q8) split: Gemini said YES to submitting now (academic rigor and
audit transparency place it among the most mature entries if judges weigh
methodology, even with 0 farms) and proposed (1) a conditional-on-launch EV
gate as the primary hurdle with launch probability as risk-weighting, and
(2) winsorizing/capping rain at the 95th percentile (~$1B–$1.5B); ChatGPT
said NO (rain sensitivity, no ranking-stability evidence, limited/segmented
OOD validation) and named the minimum conditions to change its verdict:
finish the rain/obol audit, report ranking stability, state OOD honestly per
group, and add a complete decision trace. Both agreed 0 FARM can be the
honest output of the strict policy and that the policy must not be loosened
merely to produce a target number of farms. v1.4 does ChatGPT's minimum
conditions first and tests Gemini's two proposals as prespecified
candidates — adopted only if the prespecified rule says so, never to hit a
farm count.

## Question, target, grain, decision time

- **Question:** which pre-token protocols are worth farming for a token launch,
  and at what value if they launch?
- **Target — definition (v1.2, precise):** `log10(market cap in USD)` as
  recorded in the sealed snapshot at the snapshot date (`as_of` 2026-11-14).
  Market cap here means circulating-supply × price at the snapshot time, as
  recorded by the snapshot's own source (DefiLlama / CoinGecko as carried in
  the snapshot). It is a single-point snapshot value: no price history, no
  averaging window, no volume weighting.
- **FDV is a separate target, not this one.** Fully-diluted valuation (total
  supply × price) is a different number from market cap for every token whose
  circulating supply is below its total supply, and FDV-at-TGE or FDV-median-
  days-3–7 after TGE is a different observation window again. The snapshot
  carries **no FDV field and no price history**, so neither FDV target can be
  built or verified from this data, and market cap and FDV are **never merged**
  into one target. Any comparison of this model's error rate against another
  entry's error rate is valid only if target, dates, and error definition
  match; the radar-7 comparison of 2.77x against the leader's reported 3.21x
  is **not claimed** under v1.2 because that match has not been established.
- **Row grain:** one protocol. **Decision time T:** the snapshot date; every
  feature is the snapshot's own value at T.
- **Eligible population (v1.2, hard-gated):** DATED live-token comparables
  only — a token trading, TVL and market cap positive, not a CEX, passing the
  board's rankability rule, AND with a recorded listing date. n = 70.
  The 22 UNDATED comparables are **physically excluded from every fitting,
  calibration, and validation split** (regression, group adjustments,
  cross-validation, conformal calibration, OLS/ridge baselines, bootstrap).
  They are scored only as a reference table with the dated-only full fit, and
  their error is a diagnostic, never a headline and never mixed into any
  fitted quantity. When shown, undated rows are labeled **"unsupported
  estimates"**: no calibrated confidence band is attached to them, and no
  verdict is derived from them. (v1.3 adds the dated cohort dataset — see
  below — which records the same structural missingness as censoring, not
  as a modeling choice.)

## Splits, ordering, grouping, embargo

- **Primary split:** nested expanding-window walk-forward on dated comps only:
  train on the oldest 50/60/70/80/90%, test on the next 10% forward in time.
  Pooled median absolute log error is the **primary metric**.
- **Model-selection metric (prespecified):** the pooled median absolute log
  error over nested folds 50/60/70/80 only (28 test rows). The nested **90%
  fold (the newest 7 comps) is the untouched final test**: it is used for no
  selection, tuning, or fitting decision of any kind, and is reported
  separately from the selection folds.
- **Secondary splits:** walk-forward 70/30 dated-only; stratified 70/30
  (train on dated 70% only; test on dated 30% and, separately, undated 30%
  scored by the dated-only fit as a reference diagnostic); 5-fold CV with a
  fixed-seed shuffle (seed 20261118) on dated comps only.
- **Grouping:** one row per protocol; no protocol appears in both sides of any
  split. A protocol with no listing date has no position in time and is never
  placed in a walk-forward test set — and under v1.2 it is in no training set
  either.
- **Embargo / purge gap: 30 days.** Train rows listed within 30 days before a
  test window's start are dropped. Locked, not tuned per fold.
- **Minimum training history:** the first nested fold trains on 35 dated comps.

## Metrics, baselines, success rule

- **Primary metric:** nested WF pooled median absolute log error (dated only,
  selection folds 50–80 for choices; 90% fold reported untouched).
- **Secondary:** WF 70/30 dated, stratified dated / undated-reference, 5-fold
  CV, R², OLS and ridge baselines on identical rows and folds, seasoning
  Brier / log-loss / ECE (fold-local fits), conformal coverage at 50/80/90%
  nominal (plus the v1.3 conformal slices), P90 tail error on the selection
  folds, the EV simulation audit, the gate-policy test, the distribution
  tournament, the horizon cohort, the heuristic-multiplier test, the
  leave-one-protocol-out influence report, the OOD report, and the
  floor-sensitivity diagnostic.
- **Baselines:** the old OLS model on the same features and splits; a ridge
  baseline (fixed λ = 1.0 on the standardized log-TVL slope, see below — a
  mild shrinkage, not a tuned model); the base-rate launch rate for the
  seasoning curve.
- **Success rule:** nested pooled < 0.602 dex (4x) AND WF 70/30 < 0.602 dex,
  on dated comps.
- **Headline:** dated-only numbers are the headline. Undated is a reference
  diagnostic only.

## Locked model choices (tested, with evidence)

- **Estimator: chosen by the prespecified selection rule below, from three
  co-equal candidates — Huber (IRLS, delta 1.345, MAD scale), OLS (plain least
  squares), ridge (λ = 1.0 on the standardized log-TVL slope).** No candidate
  is the default. The rule:
  1. Compute the selection metric (nested 50–80 pooled median abs log error)
     for each candidate on identical rows and folds.
  2. If the best and second-best differ by < 0.01 dex, prefer the simpler
     model: OLS, then ridge, then Huber.
  3. Huber may be selected only if its P90 tail error on the selection folds
     beats OLS by > 0.05 dex AND its drop-one slope change (refit after
     dropping the single largest-|residual| comp, |Δcoef_log_tvl|) is smaller
     than OLS's. If Huber is best on the median but fails this condition, the
     best non-Huber candidate is selected.
  4. R² is never the selection criterion on its own.
  The selected estimator, the full candidate table, and the rule outcome are
  published in the validation. The production fit uses the selected estimator.
- **Size floor: $25M, locked.** No floor dominates the grid; the floor is a
  stability constant, not a tuned optimum. (v1.0 evidence stands; v1.2 adds a
  floor-sensitivity diagnostic — see below — which reports, but does not
  change, the floor.)
- **Growth carry: REMOVED from the production model (v1.1, carried).** The
  production features are `[1, log10(TVL + $25M)]` only. A **growth
  diagnostic** is run separately and reported: a Huber fit with a signed
  `log(1 + winsor(change_7d, −50%, +200%))` term, no clamp, on the identical
  splits. Growth returns to production only if that diagnostic improves the
  selection metric by > 0.01 dex. 30d/90d growth cannot be built — the sealed
  snapshot carries only `change_7d`.
- **Category/chain adjustments: post-hoc shrunk median residuals
  (n/(n+3)), kept.** (v1.0 evidence stands; a joint category intercept was
  tested and rejected.)
- **Missingness: handling (d) — hard-gate (v1.1, carried).** Undated comps are
  excluded from all fitting and calibration. Mechanism is structural/MNAR:
  undated comps are legacy protocols whose listing dates were never recorded;
  their median residual is −0.277 dex (systematically over-predicted) vs
  dated, and their stratified-test error was 0.6962 dex (4.97x) vs dated
  0.5454 under v1.0. Under v1.2 they are scored only as a reference table
  with the dated-only full fit, labeled "unsupported estimates"; the
  dated-only band's coverage on them is reported as a diagnostic with the
  bias analysis, not as a calibration result, and no calibrated band is
  attached to any undated row.
- **Value band: cross-conformal on dated-only CV residuals (70), not
  bootstrap-only.** Half-width = the finite-sample-corrected α quantile of
  absolute out-of-fold residuals from the 5-fold CV (dated only), k =
  ceil((n+1)·α). Nominal 50/80/90% with empirical coverage reported; the
  undated diagnostic coverage against the dated band is reported separately.
  A strict split-conformal check (train 70% / calibration 15% / test 15%,
  dated only, train purged) is reported as a secondary check. The old
  bootstrap SD stays as a diagnostic only.
- **Seasoning (launch odds) — v1.3: the base rate is the board's default.**
  The seasoning curve (logistic fit of has-token on log10(age+1), 645 dated
  protocols) is validated with fold-local refits exactly as in v1.1, and its
  audit (reliability bins, bootstrap CIs, ROC/PR AUC, Platt test) is still
  published — but it does **not** set any board launch odds unless it passes
  the prespecified adoption test below. The adoption test (prespecified,
  before results): the curve is adopted for the board **only if** it beats
  the base rate on **both** Brier and log-loss on the untouched chronological
  test (the fold-local predictions from cutoffs 80/90, n = 100) **and** the
  bootstrap 95% CI for the Brier improvement over the base rate excludes
  zero. Under v1.1 evidence the curve fails both: on the untouched test the
  base rate beats even the Platt-calibrated curve (Brier 0.1131 vs 0.1144,
  log-loss 0.3864 vs 0.3930), and the Brier-improvement CI is [−0.0067,
  +0.0025], straddling zero — so the curve is **not predictive enough to
  beat a constant**, and the board uses the base rate (0.1643) as p_L for
  every row until a better model validates. The Platt recalibration is
  adopted only if it beats the **base rate** (not merely the raw curve) on
  both Brier and log-loss on that same untouched test; under v1.1 evidence it
  does not, so no Platt parameters are applied to the board. The curve is
  kept as a diagnostic because it ranks by age where a constant cannot, not
  because it beats the base rate on the latest period. Caveat (unchanged):
  token status is measured at as_of for every protocol, so the curve is a
  cross-sectional association at as_of, not a true historical hazard.
- **Verdicts: expected net return from ONE simulation array, with a stress
  test and a tested gate (v1.3).** For each board row, one seeded simulation
  (N = 20,000 draws; seed = FNV-1a hash of the slug, so the draws are
  deterministic and order-independent) produces the net-return array: each
  draw takes u ~ Uniform(0,1) and a value draw V; the protocol launches iff
  u < p_L; if it launches, the draw's net return is
  0.25% × V − plan cost, else −plan cost. **The value distribution is the
  capped lognormal (v1.3, production):** log10(V) = predictedLog + σ·z with
  z ~ Normal(0,1), σ = bandHalfwidth / 0.6745 (× the OOD band multiplier —
  see below), and V clamped to [$1, cap] where cap = the maximum market cap
  observed among the 70 dated comparables ($2,646,363,290 on this snapshot,
  computed at runtime, never hardcoded). The cap is data-justified: no
  launch value in the training population ever exceeded it, so the
  simulation never prices a launch above the largest launch ever observed.
  The uncapped lognormal is kept only as one candidate in the distribution
  tournament (below) — the production EV never rests on the uncapped tail
  alone. **Every** EV statistic is computed from that one array: ev_mean
  (the expected net return — the "central EV"), ev_p10 / ev_p25 / ev_p50 /
  ev_p75 / ev_p90, and p_negative = mean(ev < 0). The **conditional mean
  EV** is also reported per row: E[net return | launch] = 0.25% × mean(V
  over draws) − plan cost — the expected return given the protocol
  launches, the quantity policy (b) tests. Expected value and median value
  are different numbers and are labeled as such; the central EV **is** the
  mean. The conditional-on-launch value scenarios are reported separately and
  labeled explicitly as conditional — "EV at the P25 value IF it launches"
  is a point evaluation at the P25 value, **not** the 25th percentile of the
  net return — and are never presented next to p_negative as if they shared
  a distribution. The analytic p_negative from v1.1 (1 − p_L × P(value >
  cost / 0.25%)) is reported as a cross-check and must agree with the
  simulated p_negative within Monte Carlo error (±0.02 at N = 20,000).
  - **Stress test (v1.2):** every EV-audit row carries ev_mean under three
    launch-probability assumptions, all from the **same** (u, V) draw pairs
    (only the launch threshold changes): (1) base-rate (the adopted p_L),
    (2) Platt-calibrated seasoning curve (the v1.1 model assumption, for
    comparison only), (3) conservative lower-bound = the 2.5th percentile of
    a 2000-resample bootstrap of the base rate over the 645 dated protocols
    (fixed seed 20261107). **FARM requires the adopted gate to pass under
    the conservative assumption**; a row that passes under the base rate but
    not under the conservative assumption is demoted to MARGINAL.
  - **Gate test (v1.3, prespecified before results): the gate math,
    corrected.** Three criteria, each with its exact meaning — the v1.2
    documentation misstated the P25 criterion, and v1.3 corrects it here:
    (1) positive EV (mean EV > 0) is a **mean criterion**: the average
    outcome is positive. It says nothing about the typical outcome. (2)
    positive median (P50 of net return > 0) is a **typical-outcome
    criterion**: the median outcome is positive. (3) positive P25 (P25 of
    net return > 0) is a **downside criterion**, and it is far stronger
    than its name suggests: P25 > 0 requires P(net return > 0) ≥ 75% —
    three quarters of outcomes positive. With launch odds p_L = 16.4%,
    P(net return > 0) ≤ p_L < 75% for every row, so the P25 gate is
    **structurally impossible** under the base rate: it cannot pass for
    any row, however good the protocol. A gate that cannot pass is not a
    filter; it is a dead rule, and v1.3 tests it only to document that
    fact. The three prespecified policies, all computed from the same
    simulation arrays under the capped-lognormal production distribution
    (see the distribution tournament) and under the adopted (base-rate)
    launch odds:
    (a) the current strict rule — FARM iff mean EV > 0 **and** P25 of net
    return > 0;
    (b) the Gemini proposal — FARM iff **conditional mean EV > 3× plan
    cost** AND unconditional mean EV > 0, where conditional mean EV =
    0.25% × E[value | launch] − plan cost (the expected net return given
    the protocol launches);
    (c) the P(loss) ceiling — FARM iff mean EV > 0 **and**
    P(negative return) ≤ 0.90.
    (d) the Gemini conditional-EV hurdle with a risk ceiling (v1.4) —
    FARM iff **conditional mean EV > 3× plan cost** AND
    P(negative return) ≤ 0.85. The launch probability is a constant
    (16.4%) for every row, so it cannot discriminate rows as a
    risk-weighting; the discriminating risk term in (d) is P(negative
    return), tightened to 0.85 from (c)'s 0.90. Policy (d) drops (b)'s
    unconditional-mean-EV > 0 condition: a row whose conditional value is
    large enough can farm even when its unconditional mean EV is negative
    — that is exactly the conditional-on-launch definition Gemini
    proposed, tested honestly with a real risk filter.
    (e) the stricter conditional hurdle (v1.4) — FARM iff **conditional
    mean EV > 5× plan cost** AND unconditional mean EV > 0 AND
    P(negative return) ≤ 0.90.
    **Choice rule (prespecified, documented before the policy test runs):**
    a policy is eligible iff it (i) farms at least one row, (ii) rejects
    at least one row with mean EV > 0 through its additional condition
    (the gate must be a real filter — it must both fire and filter), and
    (iii) its maximum P(negative return) among its FARM rows is ≤ 0.90
    (a prespecified risk ceiling: a farm must be at most 90% likely to
    lose money). Among eligible policies, adopt the one with the **lowest
    maximum P(negative return)** among its FARM rows; ties go to (a),
    then (b), then (c), then (d), then (e). If **no** policy is eligible, adopt (a) — the
    pre-existing rule — and report the resulting FARM count, even if
    zero. The FARM count is never a target and never a reason to change
    the rule. The policy-test table (all five policies, FARM counts,
    maximum P(negative) among FARM rows, rows farmed, eligibility) is
    published in the validation, together with the farm counts under each
    of the tournament distributions, so the reader can see how much
    of any farm list is a tail artifact.
  - **Marginal** iff the row is not FARM but ev_mean > 0 under the adopted
    p_L, or ev_mean ≤ 0 with break-even odds ≤ 33%. **Skip** otherwise. The
    0.25% farmer share, the exit at snapshot market cap, and the absence of
    slippage, liquidity, and lockup modeling are assumptions, not
    measurements (unchanged from v1.1).
- **Out-of-distribution policy (v1.3, strict tiers):** every board
  prediction is checked against the training domain (the 70 dated comps):
  the set of categories, the set of main chains, the [min, max] range of
  log10(TVL + $25M), and the [min, max] range of age in days. A row is
  flagged out-of-distribution iff any of: its main chain never appears in
  training, its category never appears in training, its log10(TVL + $25M)
  is outside the training range, its age is outside the training range (or
  unknown), or its nearest comparable is more than 0.5 dex away in
  log10(TVL + $25M). The flags put the row in a tier:
  - **In-distribution** (0 flags): a normal estimate, confidence
    'in-distribution', band multiplier ×1.0.
  - **Partially OOD** (exactly 1 flag): a wider value band (the validated
    multiplier below) and confidence 'extrapolation' — the estimate is
    shown as an **exploratory extrapolation**, never with the same
    confidence as an in-distribution one. Polymarket is partially OOD
    (unseen chain) and is labeled exploratory extrapolation on the
    dashboard.
  - **Major OOD** (≥ 2 flags, or unseen category AND unseen chain):
    **unsupported extrapolation** — the prediction is shown with no
    calibrated band and the row can never be a production FARM.
  - **No credible comparable** (nearest comparable > 0.5 dex away):
    no production FARM, whatever the tier.
  The band multiplier is **validated, not assumed**: on the nested
  selection folds (50–80), test rows that are OOD relative to their fold's
  training domain are scored under multipliers {×1.0, ×1.5, ×2.0}; the
  adopted multiplier is the smallest whose OOD coverage of the 50% band
  reaches nominal − 0.10 (≥ 40% coverage); if none reaches it, ×2.0 is
  adopted and flagged as insufficient. The multiplier is chosen on the
  selection folds only and reported with its n.
- **TVL floor sensitivity (v1.3, diagnostic — the floor stays locked):** for
  each floor in {$0M, $10M, $25M, $50M, $100M}, report the full-fit
  coefficients (intercept, coef_log_tvl) on the 70 comps with the selected
  estimator, the selection-pooled metric (nested 50–80, identical folds),
  and the board ranking change vs the $25M board (Spearman ρ on implied
  value, top-20 overlap, top-10 changes). Also report a training-fold-only
  choice test: for each nested fold, choose the floor by 5-fold CV **within
  that fold's training set only**, evaluate the chosen floor on the fold's
  test set, and pool — this is what choosing the floor inside training folds
  would actually buy. The floor is **not** changed by this diagnostic in
  radar-10: it stays $25M, a stability constant. The numbers are stated
  plainly: the $10M floor scores 0.3090 on the selection metric against
  0.3203 for $25M — an 0.0113 dex edge on 28 test rows, within noise — and
  the training-fold-only choice test scores 0.4191 pooled, **worse** than
  the locked $25M floor, so per-fold floor selection overfits and there is
  no case to move the floor. The floor is never changed after seeing the
  untouched test.

## Distribution tournament (v1.3) — how much of a farm is a tail artifact

The production EV uses the capped lognormal (above). The tournament asks
how the answer changes if the value distribution is different, on the
same rows and the same launch odds. Seven candidate distributions for the
conditional launch value V, all centered on the fitted predictedLog with
σ from the band (× the OOD multiplier), all simulated with common launch
uniforms (the same u per draw) so the comparison is paired:

1. **lognormal** (the v1.2 distribution): log10(V) ~ N(predictedLog, σ²),
   clamped to [$1, $100B]. The uncapped tail.
2. **capped lognormal** (PRODUCTION): as (1), clamped to [$1, cap] with
   cap = the maximum market cap observed among the 70 dated comparables.
3. **empirical comparable-value distribution**: V drawn uniformly from the
   70 dated comps' observed market caps — a stress case: what if launch
   value does not depend on TVL at all.
4. **bootstrap comparable residuals**: log10(V) = predictedLog + r, with r
   resampled uniformly from the 70 signed out-of-fold CV residuals.
5. **Student-t residual model**: log10(V) = predictedLog + σ·t, t ~
   Student-t with df = 5 (prespecified), the same scale as the lognormal
   but heavier tails.

A sensitivity row is reported alongside: the capped lognormal with cap =
the P90 of comp market caps. **v1.4 adds a second sensitivity row: the
capped lognormal with cap = the P95 of comp market caps** — the cap
Gemini proposed for rain (~$1B–$1.5B is the P95 band on this snapshot) —
so the cap-sensitivity stress test (below) covers uncapped / P90 / P95 /
max on the same rows and draws. For each distribution, per audit row and
pooled over the audit rows: conditional mean value E[V | launch],
conditional median value, P90/P95 value, mean net EV, median net return,
P(negative return), and P(value covers plan cost | launch) = P(V >
cost / 0.25% | launch). Farm verdicts are compared across distributions
under each gate policy (farm count + farm-set overlap), so the reader can
see whether a farm list survives a change of tail. **No decision rests on
the uncapped lognormal mean alone.** The production choice is validated,
not assumed: the pooled log-CRPS (continuous ranked probability score on
the log10 value, 2000 draws per test row, centered on the fold's
prediction) of the capped vs the uncapped lognormal is computed on the
nested selection folds (50–80); the cap is kept unless the capped CRPS is
worse than the uncapped by > 10%, in which case the production
distribution reverts to the uncapped lognormal and the reversion is
documented. The tournament never selects a distribution on the untouched
90% fold.

## Horizon launch probability (v1.3) — a 12-month event, honestly censored

- **Event (defined precisely):** launch within 12 months of listing —
  P(launch by listed_at + 12 months | X). The prediction date is the
  listing date; the follow-up is min(12 months, as_of − listed_at).
- **Identification limit (stated, not hidden):** the sealed snapshot
  carries **no token launch date** — only whether a token exists at
  as_of. A protocol with a token at as_of may have launched inside or
  outside its 12-month window, so the observed launch rate in the
  fully-observed risk set (protocols listed ≥ 12 months before as_of) is
  an **upper bound** on the 12-month launch rate, not the rate itself.
  y = 0 is certain (no token at as_of ⇒ no launch in the window); y = 1
  is timing-unknown. No survival model can be validated against a launch
  time the data never records, and v1.3 does not pretend otherwise.
- **Cohort dataset (published):** for every dated protocol — prediction
  date (listed_at), follow-up days (as_of − listed_at), and status:
  launched-timing-unknown (token at as_of — for protocols listed ≥ 12mo ago
  the launch may have been inside or outside the window, timing unknown; for
  protocols listed < 12mo ago the launch is necessarily inside the window,
  since it happened before as_of, less than 12 months after listing), failed
  (market cap 0 — a dead token), disappeared (market cap −1 sentinel),
  tokenless-resolved (no token, listed ≥ 12mo ago — did not launch in
  its window), tokenless-censored (no token, listed < 12mo ago — the
  window is not yet observed; right-censored). Counts per status are
  reported, and the risk-set base rate (has-token / risk set, the same
  outcome definition as the seasoning base rate, including dead tokens) is
  reported as an upper bound with its censoring caveat.
- **Survival candidate vs baseline:** a logistic model on category/chain
  only (no post-outcome features — TVL at as_of is measured after the
  window for launchers and is excluded) is tested against the base rate
  on the same untouched 80/90 chronological test as the Platt test, on
  Brier AND log-loss. It is adopted only if it beats the base rate on
  both. The base rate stays the benchmark; Platt stays out until it beats
  the base rate on the untouched chronological test (unchanged from v1.2).

## Heuristic activity multiplier (v1.3) — a proxy, tested, not adopted blind

Gemini proposed a bounded launch-probability multiplier (1.5× when a
points program / testnet is active, 0.5× when dormant). **The sealed
snapshot carries no points-program or testnet field**, so the literal
feature cannot be built or validated from this data. The testable
candidate is a documented proxy: **active** iff the protocol's 7-day TVL
change is positive (change_7d > 0), dormant otherwise — labeled as a
proxy everywhere it appears, never as the real feature. The multiplier is
1.5× active / 0.5× dormant, applied to the base rate and clamped to
[0.01, 0.90]. It is tested on the same untouched 80/90 chronological
test rows as the Platt test (Brier and log-loss vs the flat base rate) and
adopted only if it beats the base rate on **both**. If it does not beat
the base rate, the board keeps the flat base rate and the test is
reported as a failed candidate.

## Leave-one-protocol-out influence (v1.3)

For each of the 70 dated comparables: refit the selected estimator
without it and record |Δslope|, |Δintercept|, and the maximum
|Δpredicted log10 value| over the 198 board rows. The five most
influential comps and the maxima are published. The report also states:
the distinct protocol count (70, one row per protocol — no protocol
contributes two observations), the TVL range and age range of the
training set, the board rows outside each range (count and the furthest
rows), and the error per sector / chain / TVL band (pooled nested test
rows: median absolute log error by category, by main chain, and by TVL
tercile). A single protocol must not be able to move the board: if the
maximum |Δpredicted log| over board rows exceeds 0.1 dex for any
dropped comp, the report flags it.

## Conformal slices (v1.3)

Coverage of the 50/80/90% cross-conformal bands is reported sliced by:
historical regime (nested fold / listing-year tercile), TVL band (terciles
of comparable TVL), age band (terciles of comparable age), and OOD vs
in-distribution (on nested test rows, OOD relative to each fold's own
training domain). Coverage is described as **observed empirical coverage
in this evaluation design** (cross-conformal on CV residuals), never as a
guarantee. Calibration-sample sufficiency is reported: with n = 70
out-of-fold residuals, the 90% band's quantile index is
k = ceil(71 × 0.9) = 64, and the binomial 95% interval on the observed
coverage is published alongside each band — the reader can see how much
of a coverage shortfall is sampling noise. Undated comparables stay
unsupported: no calibrated band is attached to them, and their coverage
against the dated band is a diagnostic only.

## Two functions, split on the dashboard (v1.3)

The dashboard separates what the model does into two functions with
separate validation:
1. **Valuation radar** — the conditional value if a protocol launches,
   with its uncertainty band. Useful even with 0 farms: it ranks
   protocols by fitted launch value and says how uncertain each value is.
2. **Farming decision engine** — the gate policies, the EV simulation,
   and the verdicts. Its inputs are the radar's values plus the launch
   odds; its outputs are farm / marginal / skip. The engine never lowers
   a threshold to look active: a 0-farm engine is reported as 0 farms,
   with the policy test showing why.

## Outlier audit (v1.4) — rain and obol, to the data source

The two LOPO-flagged comparables are audited to the data source, not
merely labeled outliers. The audit table records, for each of rain and
obol: slug, name, snapshot date (as_of 2026-11-14), listed_at, TVL in
USD, market cap in USD, market-cap source (the snapshot's own source:
DefiLlama, fetched 2026-11-14T01:18:33.201Z), main chain, category, the
target definition (snapshot market cap = circulating-supply × price at
the snapshot time), and the snapshot time. Four checks are answered from
that table: (a) comparable by target definition and snapshot time — the
protocol is listed before as_of and its market cap is recorded at as_of;
(b) TVL consistent — TVL is positive, finite, and not a sentinel; (c)
market cap, not FDV — the snapshot carries a market-cap field and no FDV
field, so no FDV value can have entered the target; (d) valid
observation vs measurement error or a structurally different case — the
mcap/TVL ratio against the comp distribution (rain 400×, the highest of
all comps; obol 0.0006×, the lowest), with the protocol's own facts
stated (rain: Prediction Market on Arbitrum, listed 2025-10-28, TVL
$6.6M against a $2.65B market cap; obol: Staking Pool on Ethereum,
listed 2025-11-04, TVL $1.15B against a $0.72M market cap).
**Rain is not deleted.** The with/without analysis refits the selected
estimator without rain, without obol, and without both, and reports for
each: the full-fit coefficients, the nested selection-pooled metric, the
board Spearman ρ against the production board, the top-10/top-20 overlap,
and the farm counts under the adopted gate. Both analyses are published;
the production fit keeps rain unless the winsorization rule below fires.

## Ranking stability (v1.4) — does the ranking survive a refit?

A radar ranks; its error metrics are prediction metrics, not ranking
evidence. v1.4 reports ranking stability on three axes, all from
prespecified computations on the same splits:

1. **Leave-one-protocol-out ranking:** for each of the 70 dropped
   comparables, refit the selected estimator and re-rank the board by
   implied value. Report per dropped comp and pooled: Spearman ρ against
   the production board order, top-10 overlap, top-20 overlap, and
   verdict-category moves (farm / marginal / skip changes). Verdict moves
   are computed with the analytic EV — the closed-form mean of the capped
   lognormal (see the parameter-uncertainty section) under the refit's
   predicted logs — and the analytic verdict is cross-checked against the
   production Monte Carlo verdict on the full fit: it must agree on every
   board row, or disagree only where the analytic mean EV is within $5,000
   of zero (Monte Carlo noise at a near-boundary row — the analytic and
   simulated statistics describe the same distribution, and 20,000 draws
   cannot resolve a sign that close to zero). A disagreement outside that
   tolerance fails the build.
2. **Nested walk-forward ranking:** for each nested fold (50–90), the
   Spearman ρ between the fold's predicted log values and the test rows'
   actual log market caps, and the top-3 overlap between the predicted
   and actual orderings of the fold's 7 test rows; pooled across folds.
   This answers whether protocols the model values more highly actually
   turn out to be worth more.
3. **TVL perturbation:** for each board row, perturb its TVL by +10% and
   by −10% (row-local: the comps and their adjustments do not change) and
   recompute its predicted log (pred + coef × log10(1.1) and pred +
   coef × log10(0.9)) and its rank. Report the count of rows whose rank
   changes under each shock and the maximum rank move.

Descriptive bars (reported, not gates — no production decision changes on
them): LOPO median Spearman ≥ 0.90, worst LOPO top-10 overlap ≥ 7 of 10,
and TVL-perturbation rank moves on ≤ 5 rows. The numbers are published
whether or not the bars are met.

## Segmented OOD report (v1.4) — coverage per group, honestly labeled

The v1.3 OOD multiplier validation pooled all OOD test rows (n = 28) and
called ×1.0 "validated" — on 28 rows that is a measurement, not a
validation. v1.4 segments the nested test rows (all 5 folds, 35 rows),
each classified relative to its own fold's training domain, into:
in-distribution (0 flags); unseen-chain-only (only the chain flag);
unseen-category-only (only the category flag); partial-other (exactly 1
flag of the TVL / age / nearest-comparable kind); major (≥ 2 flags).
For each segment: n, nominal 50% coverage, observed 50% coverage against
the base band (no multiplier, consistent with the conformal slices),
median effective band halfwidth in dex, and median signed residual in
dex. **Segments with n < 10 are labeled "insufficient evidence — no
validation claim"**, never described as validated. The adopted OOD
multiplier stays ×1.0 under the v1.3 prespecified rule (the smallest
multiplier whose OOD coverage reaches nominal − 0.10 on the selection
folds), and its label is corrected: it is the smallest multiplier
meeting the prespecified bar on the available n = 28 OOD test rows, with
a wide Wilson interval — a measurement, not a validated guarantee.
Polymarket stays exploratory extrapolation (partial OOD, unseen chain),
never an OOD success example.

## Cap as risk control (v1.4) — separated from model selection

The production cap (the maximum market cap observed among the 70 dated
comparables, $2,646,363,290 on this snapshot) was chosen on principle
**before any validation outcome was computed**: it is a property of the
training population, not of a test result. The CRPS check came after and
did not select the cap — it only gates the keep/revert decision (revert
to the uncapped lognormal if the capped CRPS is worse than the uncapped
by > 10%). The cap is a **risk control**, not a model-selection claim:
the capped CRPS (0.5065 dex) is slightly **worse** than the uncapped
(0.5058 dex) on n = 28, so no claim is made that the capped distribution
is more accurate — only that it bounds the tail risk the farm decision
rests on. The stress test reports, on the same audit rows and the same
draws: uncapped / P90-cap / P95-cap / max-cap — pooled conditional mean
value, pooled mean net EV, farm counts under each of the five gate
policies, and Polymarket's central EV per cap. If the farm counts move
materially across caps, the farm list is cap-sensitive and the report
says so.

## Parameter uncertainty (v1.4) — outcome vs model uncertainty, split

The printed value band is the outcome-only cross-conformal band: it
covers the residual of one draw, not the uncertainty in the model
itself. v1.4 measures the model uncertainty separately and reports it
alongside, never merged into the printed band. Method: the existing
200-refit bootstrap (fixed seed 20261119, resampling the 70 dated comps
with replacement, refitting the selected estimator) is extended from the
comps to the board — for each refit, every board row is re-predicted, so
each row carries a **parameter SD in dex** (the standard deviation of its
predicted log across the 200 refits), and the coefficient distribution
(intercept and slope: mean, SD, 95% interval) is published. For the EV
audit rows, a second simulation folds the parameter uncertainty into the
value draw: log10(V) = pred + paramSD·w + σ·z with w, z independent
standard normals, so the total value SD is √(σ² + paramSD²) — exact for
the lognormal family, same seed, same launch uniforms — reporting
ev_mean_param_usd and prob_negative_param_usd next to the outcome-only
numbers. The closed form used by the ranking-stability verdict moves is
E[min(cap, 10^Y)] with Y ~ N(μ, σ²) in dex: 10^(μ + ½·ln10·σ²) ·
Φ((log10(cap) − μ − ln10·σ²)/σ) + cap · (1 − Φ((log10(cap) − μ)/σ)).
**Outcome-only intervals are not full uncertainty**: a simulation that
holds the parameters fixed and randomizes only launch and value cannot
be read as the total uncertainty of the farm decision, and the dashboard
labels which is which.

## Launch-probability labeling (v1.4) — a base rate, labeled as one

The 16.4% launch odds are a **global cohort base rate**, not a
per-protocol probability. Every board row now carries its labeling:
probability source ("global_base_rate"), cohort ("all 645 dated
protocols at as_of"), prediction horizon (12 months), the number of
observations supporting the rate (645), and whether the row's protocol
is in the fully-observed 12-month risk set (listed ≥ 12 months before
as_of; 485 protocols, launch rate 19.2% — an upper bound, since launch
timing is unidentified). The label appears wherever the odds appear
(board detail, EV audit, dashboard). Small-sample caveat, stated: the
survival candidate (n = 31) and the heuristic multiplier (n = 100) tests
are underpowered — in the available evaluation sample they did not beat
the baseline, and the sample is too small to conclude the models are
useless.

## Decision trace (v1.4) — every verdict explains itself

Every board row carries a decision trace — the reasons for its verdict,
computed from the same numbers as the verdict (no separate logic), in
fixed order: the sign of the mean EV; the conditional mean EV against
the 3× plan-cost hurdle; the P25 gate (which always fails, with the
structural reason: P25 > 0 needs P(net return > 0) ≥ 75% while p_L =
16.4%); the P(negative return) value; the OOD tier and which flags
fired; the conservative-gate result; and the verdict with its rule. The
trace is shown in the detail drawer and in the EV audit rows. A row
whose verdict cannot be reconstructed from its trace fails the build.

## Winsorization candidate (v1.4) — tested prespecified, adopted only on evidence

Gemini proposed winsorizing/capping rain at the 95th percentile
(~$1B–$1.5B). The candidate: winsorize the dated comparables' market
caps at the P95 of comp market caps before fitting (each comp's mcap
capped at P95; the snapshot itself is never modified — the winsorized
fit is a candidate computed from the sealed snapshot, not a new input).
Report: the winsorized full fit (intercept, slope), its nested
selection-pooled metric on identical folds, its LOPO maximum
|Δpredicted log|, the board Spearman ρ and top-10/top-20 overlap
against the production board, and the farm counts under the adopted
gate. **Adoption rule (prespecified, before results): the winsorized fit
becomes the production fit only if its nested selection-pooled metric
improves on production's by > 0.01 dex.** Otherwise production stays
unwinsorized and the winsorized variant is reported as a sensitivity
only. The valuation fit stays OLS 3.7686/0.4105 unless this rule fires.

## Single final artifact (v1.4)

board.json, data.js, the dashboard, the screenshots, dossier.json, and
ev-simulation-polymarket.json all come from **one** buildRadar call on
the same sealed snapshot and the same seeds. The build is run twice and
must be byte-identical; any post-build edit re-runs the whole build.
No number in the state file, the README, or the dashboard is typed by
hand — all are read from the build output.

## Tuning boundary and final holdout

- The floor, the purge gap, the ridge λ, the verdict thresholds and the
  selection rule are locked constants, chosen on training-fold evidence only
  (or on principle, stated as such). No hyperparameter is selected on a test
  fold. The selection metric uses nested folds 50–80 only.
- **Untouched final test:** the nested 90% fold (newest 7 dated comps) is
  evaluated once, after every choice is frozen, and is never used to select
  or tune anything. There is no separate untouched holdout beyond it; the
  charter states this rather than pretending otherwise. **New claims in
  v1.3** (distribution-tournament CRPS, gate policies, the activity
  multiplier, the OOD multiplier) are validated on the selection folds
  (50–80) and reported on the 90% fold as a check where applicable; no
  decision-engine component is selected on the 90% fold. Board-level farm
  counts are descriptive of the production population, not test-set claims.
- If the charter changes, version it and label prior results exploratory.

## Required leakage checks (run at build time, fail the build)

- **Statistical checks:** duplicate slugs; missing / zero / negative / extreme
  TVL; future-dated `listed_at` (after as_of); invalid market cap (negative);
  an empty comparable set; watchlist slugs missing from the snapshot.
- **Truncation invariance:** at every nested-fold cutoff, the features and
  group adjustments computed on the snapshot truncated at the cutoff must equal
  those computed on the fold's training rows; and max(train listed_at) must be
  below min(test listed_at) minus the purge gap. A mismatch fails the build.
- **Leakage-injection tests** (`scripts/leakage-test.ts`): a doctored snapshot
  with a future-dated protocol, a duplicate slug, a negative TVL, or a negative
  market cap must each be caught by the statistical checks; features must be
  row-local (identical on the full snapshot and on a one-row snapshot); a
  fold's adjustments must differ from the full-set adjustments (proving the
  fold fit is restricted); a truncated refit must reproduce the fold fit
  exactly; undated comparables must not appear in the fitted set; every FARM
  row must pass the adopted gate under the conservative launch-probability
  assumption; EV statistics must be internally consistent (ev_p10 ≤ ev_p25 ≤
  ev_p50 ≤ ev_p75 ≤ ev_p90, 0 ≤ p_negative ≤ 1, p_negative ≥ 1 − p_L, and the
  simulated p_negative must agree with the analytic value within 0.02).
  All checks exit non-zero on failure.

## Per-fold reporting and slices

- Every validation number is reported per fold and pooled, never pooled-only.
- Slices: dated-only (headline); undated-only as a reference diagnostic,
  labeled "unsupported estimates".
- **Nested reconciliation (v1.2):** the two nested pooled numbers are
  reconciled in a table — `nested_selection_pooled` (folds 50–80, 28 test
  rows) vs `nested_wf_pooled` (folds 50–90, 35 test rows, including the
  untouched 90% fold). For each: the folds included, the exact test-row
  count, the fold date ranges, the aggregation (pooled-by-observation median
  of per-row absolute log errors — **not** an average of fold medians), and
  whether the observation set, the features, the purge, and the estimator are
  identical. The two numbers differ **only** because the observation sets
  differ (the 90% fold's 7 rows); on identical observation sets the same
  calculation reproduces exactly, and the reconciliation asserts that by
  recomputation.
- The nested 80% fold is diagnosed per fold, not dropped: a diagnostics table
  per fold (test window, n, median TVL, median age, category mix, unseen
  categories/chains, median signed error, median abs error, P90 error, and
  the per-row errors). Under v1.1 it was 1.0483 dex with the purge gap: its
  test window (2025-09 → 2026-02) holds the newest listings, including
  structural extremes — rain (Prediction Market, mcap/TVL 400x, error 2.56
  dex) and obol (Staking Pool, mcap/TVL 0.0006x, error 1.81 dex) — and 3 of
  its 7 rows are in categories with zero training comps (Prediction Market,
  Staking Pool, Decentralized AI) plus one unseen chain (Bittensor). Both
  Huber and OLS fail identically there, so it is the data, not the estimator.
  The fold is kept and reported, never deleted.

## Known limitations (stated, not hidden)

- Target = snapshot market cap; no price history; FDV-at-TGE unverifiable.
- Survivorship bias: 15 zero-mcap + 14 Gecko-no-cap dead records are visible;
  fully delisted tokens are invisible; fitted values bias upward.
- Undated comps (22/92) are a different, harder population; under v1.2 they
  are excluded from the fit entirely and reported as a reference only,
  labeled "unsupported estimates".
- **The launch-odds model is not predictive enough to beat a constant:**
  ROC-AUC 0.5575, the Brier-improvement CI over the base rate straddles zero,
  and the base rate beats even the Platt-calibrated curve on the untouched
  chronological test. The board therefore uses the base rate (0.1643) as p_L
  for every row. Every farm EV inherits this: the launch probability is a
  constant, so the board ranks on fitted value, and the EV's upside comes
  from the lognormal value tail, not from discriminating launch odds.
- **The median farming outcome is a loss on this population:** every board
  row's launch odds are below 0.5 (base rate 0.1643; the best Platt row is
  0.4161), so the 25th — and usually the 50th — percentile of the net-return
  distribution is the full plan cost lost. Positive mean EVs come from the
  right tail of the value distribution. The gate test in v1.2 exists to say
  plainly whether any row survives a risk-aware rule under that fact.
- The 80% nested fold is the hard fold; its median is reported, not dropped.
- The 0.25% farmer share, the exit at snapshot market cap, and the absence of
  slippage, liquidity, and lockup modeling are assumptions, not measurements.
- Out-of-distribution rows (unseen chain/category, TVL or age outside the
  training range, nearest comparable > 0.5 dex away) carry an extrapolation
  warning and a validated band multiplier; major-OOD rows are unsupported
  extrapolations and can never be a production FARM.
- **v1.4 additions:** the outlier audit reports rain and obol with and
  without the outlier, and rain stays in the production fit unless the
  prespecified winsorization rule fires; ranking stability is reported
  on three axes with descriptive bars, not gates; the OOD multiplier
  ×1.0 is a measurement on n = 28, not a validated guarantee, and
  segments with n < 10 carry no validation claim; the cap is a risk
  control, not a model-selection claim — the capped CRPS is slightly
  worse than the uncapped, so the cap bounds tail risk without claiming
  better accuracy; the printed band is outcome-only and the parameter
  uncertainty is reported alongside it; the 16.4% launch odds are a
  global cohort base rate, labeled with cohort, horizon, and supporting
  n on every row; every verdict carries a decision trace.
