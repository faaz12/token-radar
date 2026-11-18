# Evaluation Charter v1.6 — Token Radar (radar-13)

Locked **before** fitting radar-13. Any change after results creates a new
charter version and labels the prior results **exploratory**. Radar-12 numbers
were computed under charter v1.5; the evaluation procedure changed in v1.6
(analytic-first decisions with Monte Carlo confidence intervals and
BORDERLINE/REVIEW labels, gate (f) re-audit with expected net return per
row and the "risk-screening policy" name, two verdicts per protocol
(adopted + conservative) with CONDITIONAL FARM, per-row stability scores
with a prespecified 50% threshold, a ranking tournament of simple models
against OLS on ranking metrics, per-cohort and per-regime ranking
evaluation for the fold-80 failure, and one valuation-to-decision table
for all 198 rows), so radar-12 numbers are **exploratory under
v1.6** and must not be quoted as v1.6 results. Radar-12 is frozen in
`hidden_files/radar-12-freeze/` (board, data, dossier, metrics,
CHARTER-v1.5.md, FREEZE.md, snapshot sha256
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

## Why v1.5 exists — the defect it fixes

Under v1.4 the valuation ranking is weak out of sample (pooled nested
Spearman 0.2895, with the 80% fold NEGATIVE at −0.2857), the regression
parameters are weakly identified (intercept bootstrap 95% CI [1.13, 6.40];
median parameter SD 0.2163 dex), and verdicts/rankings are sensitive to
input changes and refits (543 verdict moves across 70 LOPO refits; TVL
±10% moves 177–178 of 198 rankings) — while the EV simulation still holds
the fitted coefficients FIXED (outcome uncertainty only), and gate (d),
adopted in v1.4, fires 4 candidates under the adopted odds but none
survives the conservative-odds stress test, with no economic justification
for its 3× / 85% thresholds on record. Two independent reviews of
radar-11 (Q9) split again: Gemini said YES to submitting now (no further
code or model changes — the peak of quantitative research in this
hackathon; 0 farms only a cosmetic/product flaw); ChatGPT said NO (the
three blockers above) and named the top priorities: negative-fold
diagnosis, cluster bootstrap, and a farming simulation that includes
parameter uncertainty. Both agreed rain and obol are valid observations
that must not be deleted, and that the gate threshold must not be lowered
merely to produce FARM verdicts. v1.5 does ChatGPT's priorities first —
diagnosis before any model change — and audits gate (d) economically,
testing an odds-consistent candidate only under a prespecified rule that
cannot be chosen after seeing farm counts.

## Why v1.6 exists — the defect it fixes

Under v1.5 the production verdict is decided by ONE 20,000-draw Monte
Carlo point estimate, so rows sitting at the gate ceiling flip on
simulation noise: tau-labs has an analytic P(negative) of 0.8989 against
the (f) ceiling of 0.8977 — it should have failed, but it farmed because
the simulation drew 0.8976; t3tris-finance analytically passes (0.8765
vs 0.8768) but its simulation flag failed at 0.8771, 0.0003 over the
ceiling. The board's FARM count carries ±3 rows of Monte Carlo noise
(analytic (f) 64 vs simulation 61). Gate (f) is presented as a farm
gate while its 3× conditional payoff sits BELOW the breakeven multiples
(5.09× adopted / 6.33× conservative) — it is a risk screen, not a
profit proof, and no row's expected net return is audited against it.
Only one verdict is shown per protocol although the adopted and
conservative layers disagree (gate (d) candidates pass 44–66% under
adopted odds, 0% under conservative). The LOPO stability counts exist
but no stability threshold is set, so tau-labs (production FARM,
MARGINAL in 69 of 70 refits) looks identical to a FARM 69/70 on the
board. The ranking evaluation never tests whether a simpler model
(TVL-only, median-by-category) beats OLS on RANKING. The fold-80
inversion (Spearman −0.2857) is diagnosed but cross-time generalization
is not tested per cohort or regime. And no single table links each
protocol's valuation estimate, interval, launch-probability source and
conditional payoff to its decision. Two independent reviews of radar-12
(Q10) split again: Gemini said YES to submitting now (no changes);
ChatGPT said NO (the seven blockers above, in order: uncertainty-aware
decisions; gate (f) re-audit with expected net return; adopted vs
conservative verdicts split; per-row stability scores; ranking-model
tournament; fold-80 cross-time generalization; one valuation-to-decision
table). v1.6 does ChatGPT's blockers in that order — decisions that
reproduce when the simulation is repeated, parameters are bootstrapped,
and assumptions change — and the target is NOT "more farms" or "a higher
leaderboard score". The fit is unchanged unless a prespecified ranking
improvement is demonstrated; rain and obol stay in the fit; no threshold
is moved after seeing a farm count.

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
  seasoning curve; and the v1.6 ranking-tournament challengers
  (TVL-only, median-by-category, global-median) on the same nested folds
  and the same ranking metrics as OLS.
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
validation. v1.4 segments the nested test rows (the selection folds
50–80, 28 rows — the v1.4 text that said "all 5 folds, 35 rows" was a
mistake, corrected in v1.5: the 90% fold is the untouched final test and
is excluded from every selection metric),
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

## Negative-fold diagnosis (v1.5) — why the 80% fold ranks backwards

The pooled nested Spearman ρ (0.2895 in v1.4) is the headline ranking
metric: it answers whether protocols the model values more highly
actually turn out to be worth more, pooled over the 28 selection-fold
test rows. One fold — the 80% fold — is NEGATIVE (−0.2857). A negative
fold is diagnosed, never dropped and never averaged away:

- The fold's diagnostics table (already in `nested_fold_diagnostics`):
  test window, n, median TVL, median age, category mix, unseen
  categories/chains, median signed error, median absolute error, P90
  error, and the per-row errors.
- **Rank inversions:** the pairs (predicted order vs actual order) that
  flip inside the fold, and which rows drive them — the signed errors of
  the flipped rows, named.
- **Leave-one-row-out Spearman inside the fold:** drop each of the
  fold's 7 test rows in turn and recompute the fold Spearman on the
  remaining 6 — reported per dropped row, so the reader sees whether the
  negative sign survives the removal of any single row or is carried by
  one row.
- **Training-window summary:** n train, date range, categories and
  chains present, and which of the test rows' categories/chains are
  unseen in training.
- **Pooled sensitivity:** the pooled selection-fold Spearman with the
  80% fold excluded, reported next to the headline pooled number — a
  sensitivity, not a replacement: the headline stays pooled over all 28
  rows.

## Ranking evaluation, completed (v1.5) — Spearman and Kendall, per fold and pooled

v1.4 reported Spearman per fold and pooled, and top-3 overlap per fold.
v1.5 completes the ranking evaluation before any model change:

- **Kendall τ** (predicted vs actual) per fold and pooled over the 28
  selection rows — a second rank correlation that penalizes discordant
  pairs directly, reported next to Spearman; the two must be read
  together, never averaged into one number.
- **Top-k overlap and precision, pooled:** top-10 and top-20 overlap
  and precision on the 28 pooled selection rows (the predicted top-10
  against the actual top-10, and the same for top-20). Per-fold top-k
  is reported as top-3 and top-5 overlap only — a 7-row test set cannot
  support a top-10 or top-20 overlap (all 7 rows are inside any top-10),
  so per-fold top-10/top-20 numbers would be vacuous and are not
  reported.
- **Pooled rank correlation is the main metric.** LOPO Spearman
  (0.9981 in v1.4) measures stability of the order under a refit, NOT
  predictive accuracy — a model can be perfectly stable and still rank
  badly. The dashboard never presents LOPO Spearman as evidence that
  the ranking predicts value; the pooled nested Spearman and Kendall
  are the predictive ranking evidence.
- **No claim before the ranking improves.** The radar does not claim to
  find the best protocols until the pooled out-of-sample rank
  correlation is reported honestly per fold and pooled; a weak pooled
  ρ is stated as a weak ranking, not hidden behind the level error.

## Cluster bootstrap (v1.5) — 2000 refits, protocol as the resample unit

The v1.4 bootstrap (200 refits, seed 20261119) becomes a **cluster
bootstrap per protocol with 2000 refits** (same seed 20261119 — the
mulberry32 stream is prefix-stable, so the first 200 refits are
identical to v1.4's). The resample unit is the PROTOCOL: each protocol
contributes exactly one comparable row (duplicate slugs are rejected by
the snapshot validation, and `lopo_influence.observations_per_protocol`
is 1), so a protocol-cluster bootstrap is the row bootstrap here — the
equivalence is stated and checked, not assumed. Each refit redoes the
whole fitting process (coefficients AND category/chain group
adjustments, via `fitRegression` on the resampled rows) — a bootstrap
that reuses the production adjustments would understate the uncertainty.
Reported:

- The coefficient distribution (intercept and slope: mean, SD, 95%
  interval) on 2000 refits, with the production fit inside the
  intervals.
- **Slope sign flips:** the count of refits whose slope is ≤ 0, and
  **intercept sign flips:** the count whose intercept is ≤ 0 — a
  slope that flips sign under resampling is not identified.
- **Multimodality flag:** a 20-bin histogram of each coefficient; let
  the two highest non-adjacent peaks be p1, p2 (peak = bin count) and
  the valley v be the lowest bin count between them. Flag "bimodal" if
  v < 0.5 × min(p1, p2) AND the peaks are more than 1 SD apart. The
  flag is descriptive — it reports shape, it gates nothing.
- **Parameter-aware band:** per board row, the total SD
  √(σ² + paramSD²) (outcome σ from the conformal band, paramSD from
  the bootstrap) and the P25/P75 implied value under that total SD,
  reported next to the outcome-only band. The printed band stays
  outcome-only (the v1.4 decision); the param-aware band is the honest
  interval for a reader who wants the model's own uncertainty included.
  A simulation that holds the parameters fixed and randomizes only
  launch and value is outcome uncertainty only, and the dashboard
  labels which is which.

## Parameter uncertainty in the farming simulation (v1.5)

The v1.4 EV simulation holds the fitted coefficients fixed and
randomizes only launch and value. v1.5 adds a **parameter-aware
simulation** for every audit row (farm rows plus every row with a
positive mean EV under the adopted odds — the same 96 rows as the
distribution tournament), 5000 draws per row, same seeds, same paired
structure:

- Each draw combines (i) a **coefficient draw** — one of the 2000
  bootstrap refits, chosen by a seeded PRNG, whose predicted log is
  the row's value center for that draw (this IS the parameter
  uncertainty; the per-row paramSD is NOT added again — adding it
  would double-count); (ii) a **launch-odds draw** — one of the 2000
  base-rate bootstrap resamples (seed 20261107, the same resamples
  whose 2.5th percentile is the conservative lower bound), chosen by
  a seeded PRNG; (iii) a **value draw** — the production distribution
  (capped lognormal) centered on the refit's predicted log with the
  row's outcome σ.
- **Distribution choice** is folded in as a sensitivity: the same
  5000-draw param-aware simulation is run under three distributions —
  the production capped lognormal, the uncapped lognormal, and the
  Student-t — and the mean EV and P(negative) are reported per
  distribution. A decision that flips across distributions is
  distribution-sensitive and the report says so.
- Per audit row, reported: param-aware mean EV and P(negative) under
  each of the three distributions; and, for the gate-(d) candidates,
  the **paired pass fractions** — over 2000 paired (bootstrap refit,
  base-rate resample) draws, the fraction in which the row passes gate
  (d) under the adopted odds and under the conservative odds, computed
  with the analytic closed-form gate statistics from each refit's
  predicted log. A candidate whose pass fraction collapses under
  parameter + launch-odds uncertainty is not a reliable FARM, however
  it looks at the point estimate.

## Gate (d) economic audit (v1.5) — what 3× and 85% actually mean

Gate (d) — conditional mean EV > 3× plan cost AND P(negative return)
≤ 0.85 — was adopted in v1.4 on the prespecified eligibility rule
(fires + filters under the adopted odds, lowest worst-farm P(negative)
among eligible policies). v1.5 audits the thresholds economically,
before any further gate change:

- **The breakeven multiple.** Unconditional mean EV > 0 requires
  conditional mean EV > (1 − p_L) / p_L × plan cost: **5.09×** at the
  adopted odds (p_L = 16.43%) and **6.33×** at the conservative odds
  (p_L = 13.64%). The 3× hurdle is BELOW the breakeven multiple at
  either odds — so 3× is a **conditional-payoff screen** (a launch
  must pay at least 3× the plan cost to be worth the operational
  effort, fees and slippage), NOT a standalone profitability proof.
  A 3×-passing row can still have a negative unconditional mean EV;
  the P(negative) ceiling and the conservative-odds stress test carry
  the risk control, and the audit says so plainly.
- **The 85% ceiling, in launch-success terms.** P(negative) =
  1 − p_L × P(value clears breakeven | launch), so P(negative) ≤ 0.85
  at the adopted odds means **at least 91.3% of launches must clear
  breakeven** (0.15 / 0.1643). Under the conservative odds the
  structural floor is 1 − 0.1364 = **0.8636 > 0.85** — the ceiling
  demands a launch-success rate of 0.15 / 0.1364 = **110%**, which is
  impossible. **Gate (d) + the conservative-odds stress test makes
  FARM structurally impossible by construction**, for every row, on
  any data. The v1.4 board's 0 farms is therefore a design outcome of
  the (d) ceiling under the stress test, not a data outcome — and the
  audit documents the inconsistency instead of hiding it behind the
  farm count.
- **Threshold-sensitivity grid (diagnostic, not a selection device).**
  The (d)-shape policy is swept over conditional-mean multiples
  {1×, 2×, 3×, 4×, 5×, 6×} × P(negative) ceilings
  {0.80, 0.85, 0.90, 0.95}, with farm counts under the adopted odds
  AND under the conservative odds. Ceilings above 1 − p_L are
  infeasible under that odds layer (the floor) and the grid shows
  0s there — the feasible region is visible, not assumed. The grid
  reports; it does not select.
- **Candidate (f) — the odds-consistent ceiling.** Conditional mean EV
  > 3× plan cost AND P(negative return) ≤ 1 − 0.75 × p_L, where p_L is
  the odds of the layer the gate is evaluated under (adopted: ceiling
  0.8768; conservative: ceiling 0.8977). The ceiling now means "at
  least 75% of launches clear breakeven" at whatever odds are used —
  odds-consistent by construction, so a (f) farm is possible under
  both layers. (f) is a **correction of an odds-inconsistent
  constant**, not a loosening to hit a farm count: the 3× multiple is
  unchanged, and the ceiling is derived from a stated launch-success
  rate (75%), not from looking at farm counts.
- **Two-layer adoption rule (v1.5, prespecified before results).** A
  policy is eligible only if it **fires AND filters under BOTH the
  adopted odds and the conservative odds**, and its worst farm's
  P(negative return) under the conservative layer is ≤ 0.90 (the risk
  ceiling). Among eligible policies, adopt the one with the **lowest
  worst-farm P(negative) under the conservative layer**; ties go to
  the earlier letter. Policies (a)–(e) are re-tested under this rule
  alongside (f). If no policy is eligible, keep (a) and report the
  resulting FARM count as-is — the farm count is never a target, and
  the rule is never re-chosen after seeing which policy farms most.
  The gate test and the board verdict are now consistent: a policy
  that cannot farm on the board cannot be adopted as the farm policy.

## Verdict stability (v1.5) — how often does a verdict survive a refit?

The v1.4 LOPO verdict moves (543 across 70 refits) count moves per
dropped comp. v1.5 reports the other axis — per board row, across the
70 LOPO refits (analytic verdicts under the adopted gate and the
conservative odds):

- Per row: the main (production) verdict; the count of refits
  producing each verdict (farm / marginal / skip); the number of
  refits agreeing with the main verdict; the most frequent alternative
  verdict; and the flip drivers — the dropped comps whose refits flip
  this row, with the flip direction.
- Aggregates: the number of unique protocols that ever change verdict;
  moves per protocol (median and max); the percentage of (row, refit)
  pairs staying on the main verdict; and the most frequent
  cross-category moves (e.g. marginal→skip: n).
- **Rank ranges.** Per row, the min / median / max rank across the 70
  LOPO refits. The dashboard shows a row's rank as a RANGE where the
  range is non-trivial (min ≠ max) — a single precise rank is not
  forced where the data does not support one. The production rank is
  always inside its own range; a range that excludes it fails the
  build.

## Final evaluation table (v1.5) — one table, every headline number

One structured table assembles the headline evaluation from the same
validation numbers, with no new fitting: target and target date; unit
of analysis (one protocol); the number of independent protocols (70
dated comps; one observation per protocol); the number of folds and
the size of each fold (nested 50/60/70/80/90, 7 test rows each; 5-fold
CV, 14 rows each; walk-forward 70/30, 21 test rows); the comparison
baseline (OLS on identical rows and folds; ridge λ = 1.0; base-rate
launch odds); median absolute error and median signed bias, per fold
and pooled (selection folds 50–80 and all folds 50–90, separately);
rank correlation (Spearman and Kendall, per fold and pooled over the
28 selection rows); and interval coverage (50/80/90% nominal vs
observed). The walk-forward error (0.5145 dex) is a typical error of
~3.27× and is stated as such; R² (0.4236) is an in-sample fit measure,
never presented as out-of-sample evidence. No error is summarized into
a single winning number.

## Reproducibility package (v1.5)

The build ships a reproducibility record (in `data.js` and in
`REPRODUCE.md` at the entry root): the snapshot's sha256 (computed at
build time from the input file, never typed by hand); the dataset
version (snapshot `as_of` + source); the charter version; the model
version; every locked constant (TVL floor, purge gap, ridge λ, verdict
thresholds, gate policies, seeds); the per-protocol outputs
(`board.json`, `data.js`); and the exact commands to rebuild from the
sealed snapshot, run the leakage tests, and verify byte-identical
determinism (two builds, `diff -r` clean) and the frozen benchmark
(the radar-11 freeze in `hidden_files/radar-11-freeze/`). A build
whose numbers cannot be reproduced from the sealed snapshot and the
recorded seeds fails the charter.

## Uncertainty-aware decisions (v1.6) — analytic first, simulation as cross-check, BORDERLINE is a verdict

The production verdict is decided by the ANALYTIC gate statistics
(closed-form capped-lognormal: `analyticGateStats` — the exact mean EV,
conditional mean EV, net-return quantiles and P(negative) of the same
distribution the Monte Carlo draws from), NOT by the 20,000-draw
simulation. The simulation is a cross-check: its P(negative) must agree
with the analytic value within its Monte Carlo confidence interval, and
its farm counts are reported next to the analytic counts, never instead
of them. The gate-policy test is computed on the analytic statistics
under both odds layers; the simulation gate test is reported alongside
as the cross-check. The analytic and simulated statistics describe the
same distribution — a disagreement is Monte Carlo noise, and the build
treats it as noise, not as a model difference.

- **Monte Carlo confidence intervals.** Every simulated proportion
  (P(negative) under each odds layer, each gate pass fraction) carries
  its 95% Wilson score interval from its draw count N (20,000 for the
  production simulation, 5,000 for the tournament and param-aware
  simulations). At N = 20,000 the standard error of P(negative) near
  0.88 is ≈ 0.0023. A simulated P(negative) whose Wilson interval does
  not contain the analytic value fails the build.
- **BORDERLINE (prespecified before results).** A row is BORDERLINE
  when EITHER (a) its analytic P(negative) under the adopted OR the
  conservative odds layer is within ±0.01 of that layer's gate ceiling
  (for gate (f): 1 − 0.75 × p_L, i.e. 0.8768 adopted / 0.8977
  conservative), OR (b) its analytic gate verdict and its simulation
  gate verdict disagree under either odds layer (one passes, the other
  fails). The ±0.01 width is fixed before results: ≈ 4 Monte Carlo
  standard errors, so a row inside it cannot be called a pass or a fail
  with confidence. The marginal/skip boundary needs no borderline band:
  it is the sign of the analytic mean EV, which is deterministic given
  the fit (no simulation noise); its parameter uncertainty is reported
  separately via the bootstrap P10/P90 of the mean EV and the stability
  proportions below.
- **A BORDERLINE row is NEVER FARM and NEVER SKIP.** It is MARGINAL
  with the label REVIEW, whatever its point estimate says — the middle
  verdict is the uncertainty verdict. The board shows the borderline
  reason (which leg, which layer, and the distance to the ceiling) and
  the analytic and simulated P(negative) side by side, so the reader
  can see the row is a coin flip, not a call.
- **The two named rows are handled by the rule, not by hand.** Under
  v1.5 tau-labs farmed on simulation noise (analytic 0.8989 vs ceiling
  0.8977, 0.0012 over) and t3tris-finance's simulation flag failed while
  it analytically passes (0.8765 vs 0.8768, 0.0003 under). Under v1.6
  both are BORDERLINE by clause (a) — and tau-labs additionally by
  clause (b) — and both are MARGINAL + REVIEW. No row is hand-edited;
  the rule decides.

## Gate (f) re-audit with expected net return (v1.6) — a risk-screening policy, not a profit gate

Gate (f) — conditional mean EV > 3× plan cost AND P(negative return)
≤ 1 − 0.75 × p_L — is renamed everywhere (dashboard, README, charter)
a **risk-screening policy**, never a profit gate, until expected net
return and tail risk are proven adequate. The 3× conditional payoff is
a screen for operational effort (a launch must pay at least 3× the plan
cost to be worth the effort, fees and slippage), NOT breakeven: the
breakeven multiples are **5.09×** at the adopted odds and **6.33×** at
the conservative odds, so a (f) farm with a conditional multiple
between 3× and 5.09× has a NEGATIVE expected net return. The audit
makes that visible per row instead of hiding it behind the farm count:

- For every protocol (all 198, in the valuation-to-decision table):
  expected net return after plan cost under the adopted odds AND under
  the conservative odds, the P10/P90 of the mean EV across the 2000
  bootstrap refits (parameter uncertainty), the conditional payoff
  (farmer share × mean value if it launches − plan cost) and its
  multiple of the plan cost, and the tail risk (analytic P(negative)
  under both layers, P10 net return).
- The gate (f) audit table lists every analytic-(f)-farm candidate
  under the adopted odds with those numbers, and reports the aggregates:
  how many (f) farms have a positive expected net return under the
  adopted odds, how many under the conservative odds, and how many have
  a conditional multiple below the breakeven multiple at each layer.
- The audit reports; it does not re-pick the gate. The farm rule stays
  (f) plus the v1.6 BORDERLINE and stability guards — the charter is
  never re-chosen after seeing which rows the audit embarrasses.

## Two verdicts per protocol (v1.6) — adopted vs conservative, CONDITIONAL FARM

Every board row carries TWO verdicts, computed from the same analytic
statistics under the two odds layers:

- `verdict_adopted` — the analytic gate under the adopted (base-rate)
  launch odds, with the OOD farm block.
- `verdict_conservative` — the analytic gate under the conservative
  (2.5th-percentile) launch odds, with the OOD farm block.
- The production `verdict` IS the conservative verdict, except for the
  v1.6 guards: a would-be farm that is BORDERLINE or UNSTABLE (below)
  is demoted to MARGINAL, and the demotion reason is recorded.
- **CONDITIONAL FARM.** When `verdict_adopted` is farm and
  `verdict_conservative` is not, the row is labeled CONDITIONAL FARM
  (production verdict MARGINAL) — it farms only on the adopted odds,
  not under the stress test, and the dashboard shows it as such instead
  of an unqualified FARM. A row that passes both layers and survives
  the guards is an unqualified FARM; anything else that says FARM is a
  mislabel.
- The decision trace of every row names both layers (which layer
  passes, which fails, by how much) so the reader can reproduce the
  call without re-running the model.

## Stability score (v1.6) — proportions per row, threshold fixed before results

The v1.5 LOPO verdict counts are promoted to a per-row stability
score, shown on the dashboard for every row: the proportion of the 70
LOPO refits producing FARM / MARGINAL / SKIP (e.g. FARM 69/70), the
number of refits agreeing with the production verdict, and the most
frequent alternative verdict. The refit verdicts are the analytic gate
verdicts (same rule as production, without the BORDERLINE demotion —
the proportions measure the gate's sensitivity to the training set,
while BORDERLINE guards the production call).

- **Stability threshold (prespecified before results): a production
  FARM is STABLE iff at least 35 of 70 refits (50%) agree with FARM.**
  Below 50% the farm is UNSTABLE and is demoted to MARGINAL with the
  UNSTABLE label and the proportions shown. The threshold is fixed
  here, before any v1.6 result exists, and is never moved to preserve
  a farm count.
- A production FARM with 0/70 agreeing refits (tau-labs under v1.5)
  must not look the same as a FARM 69/70 on the board: the dashboard
  shows the proportions next to every verdict, and the state file
  reports the distribution of stability scores across the farm rows.
- The aggregates are reported as before (unique rows ever flipped,
  moves per protocol, % of (row, refit) pairs on the main verdict,
  most frequent cross-category moves), plus the count of farms demoted
  by the stability guard.

## Ranking tournament (v1.6) — simple models vs OLS on RANKING, not on error

The ranking evaluation is completed by testing whether a simpler model
beats OLS on the ORDERING, not on the level error. The challengers are
evaluated on the SAME nested walk-forward folds as the production fit
(50/60/70/80 selection folds + the 90% untouched fold) with the SAME
ranking metrics (Spearman, Kendall, pooled top-10/top-20
overlap/precision on the pooled selection rows):

- **OLS** (production fit, benchmark) — the fitted log-log regression.
- **TVL-only** — predicted log value = log10(TVL + floor): the ranking
  by TVL alone, no fitted coefficients.
- **Median-by-category** — predicted log value = the median log market
  cap of the fold's training comps in the row's category (global median
  when the category has fewer than 3 training comps). Category medians
  are computed on the fold's training rows only — never on the test
  rows, never on the full set.
- **Global-median** — predicted log value = the median log market cap
  of all the fold's training comps (a constant: Spearman 0 by
  construction, the null control that proves the tournament can see a
  model that ranks nothing).
- **Adoption rule (prespecified):** a challenger replaces OLS only if
  it beats OLS on pooled Spearman by ≥ 0.10 AND on pooled Kendall by
  ≥ 0.05 AND on pooled top-10 overlap by ≥ 0 (at least ties), on the
  selection folds (50–80). Otherwise OLS stays. The tournament reports;
  it does not select by farm count, and a challenger that wins on
  level error but loses on ranking does not win.

## Fold 80 / cross-time generalization (v1.6) — per cohort and per regime

The fold-80 inversion is tested for cohort and regime dependence
instead of being left as one diagnosed fold:

- **Per-cohort ranking:** the pooled selection rows (n = 28) split by
  listing-date tercile (oldest / middle / newest) — Spearman, Kendall
  and median absolute error per tercile, with n reported. Terciles with
  n < 10 are descriptive, not validation claims.
- **Per-regime ranking:** listing-year cohorts (2021–2022, 2023, 2024,
  2025–2026) on the 70 dated comps — fitted-vs-actual Spearman and
  Kendall per cohort (in-sample, descriptive) plus the pooled
  out-of-sample selection rows per cohort where n allows.
- **Fold-80 composition:** which cohorts and regimes its 7 test rows
  belong to, and whether the inversion is cohort-specific — the pooled
  Spearman excluding fold 80, reported per cohort, against the pooled
  Spearman with it. If the inversion is confined to one cohort, the
  charter says so; if every cohort ranks weakly, the charter says that
  instead. The fold is kept and reported, never deleted.

## Valuation-to-decision table (v1.6) — one table, every protocol, valuation to verdict

One structured table links the valuation to the decision for all 198
protocols, in board order, from the same build (no hand-typed numbers):
slug and name; valuation estimate (implied value, predicted log value,
value if it launches); the param-aware interval [P25, P75] and the
outcome-only band; the launch-probability source (global cohort base
rate 16.43%, cohort, 12-month horizon, supporting n) and the odds used
at each layer; the conditional payoff (farmer share × mean value if it
launches − plan cost) and its multiple of the plan cost; the expected
net return under the adopted odds and under the conservative odds, with
the bootstrap P10/P90; the tail risk (analytic P(negative) under both
layers, simulated P(negative) with its Wilson interval, P10 net
return); the two verdicts (adopted / conservative), the production
verdict, and the labels (CONDITIONAL FARM, BORDERLINE/REVIEW, UNSTABLE);
and the stability proportions (FARM / MARGINAL / SKIP out of 70 refits).
The table is shipped in `data.js` and rendered on the dashboard as a
sortable view next to the board, so a reader can audit any verdict
from its valuation without re-running the model.

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

- **v1.5 checks (run at build time, fail the build):** the pooled
  top-10/top-20 overlap is computed on the 28 pooled selection rows
  and never exceeds 10 / 20; the negative-fold diagnosis reproduces
  the 80% fold's Spearman (−0.2857) and its leave-one-row-out
  Spearman values; the cluster bootstrap runs 2000 refits, every
  coefficient is finite, and the slope/intercept sign-flip counts are
  reported; the param-aware simulation's P(negative) stays in [0, 1]
  and its paired pass fractions stay in [0, 1]; gate (d) farms 0 rows
  under the conservative odds (the structural floor 1 − 0.1364 =
  0.8636 exceeds the 0.85 ceiling — asserted, not assumed); the
  candidate (f) ceiling scales with the odds layer (0.8768 adopted,
  0.8977 conservative); the two-layer adoption rule adopts a policy
  only if it fires and filters under BOTH odds layers, or falls back
  to (a) with a stated reason; every board row's verdict-stability
  refit counts sum to 70 and the production rank lies inside its own
  rank range; the final evaluation table's pooled numbers reconcile
  with the validation (median absolute error, Spearman, Kendall);
  the reproducibility record's snapshot sha256 equals the input
  file's hash.

- **v1.6 checks (run at build time, fail the build):** the production
  verdict is decided by the analytic gate statistics — every board row's
  analytic gate pass/fail under each odds layer is recomputed from its
  predicted log, sigma, plan cost and the layer's launch odds, and must
  match the recorded verdict (up to the BORDERLINE and stability
  demotions, which are themselves recomputed); every simulated
  P(negative) lies inside its 95% Wilson interval around the analytic
  value, and |simulated − analytic| ≤ 0.02; every BORDERLINE row is
  MARGINAL with the REVIEW label and a recorded borderline reason, and
  no BORDERLINE row is FARM or SKIP; the two verdicts are consistent —
  the production verdict equals the conservative verdict except for the
  recorded demotions, and `conditional_farm` is true exactly when the
  adopted verdict is farm and the conservative verdict is not; the
  stability proportions per row sum to 70 and the stability threshold
  is 35/70 (50%), applied before results; the ranking tournament's OLS
  pooled Spearman reproduces 0.2895 (the fit is unchanged) and every
  challenger is recomputed from the fold training rows only; the
  valuation-to-decision table has 198 rows, one per board row, in board
  order, and every number in it reconciles with `board.json` and
  `data.js`; the gate (f) audit's breakeven multiples recompute to
  5.09× adopted / 6.33× conservative; charter version v1.6 and model
  version radar-13 are recorded in the reproducibility package.

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
- **v1.5 additions:** the pooled out-of-sample rank correlation is
  weak (Spearman 0.2895; the 80% fold is negative at −0.2857) and is
  reported as the headline ranking metric, not hidden behind the level
  error; the regression parameters are weakly identified (intercept
  95% CI [1.13, 6.40] on the 2000-refit cluster bootstrap) and the
  prediction intervals that include parameter variation are reported
  next to the outcome-only band; the param-aware farming simulation
  folds coefficient, launch-odds and distribution-choice uncertainty
  into the audit rows, but the launch-odds draw still comes from the
  flat base-rate bootstrap — no per-protocol launch discrimination is
  claimed; gate (d)'s 85% P(negative) ceiling is structurally
  impossible under the conservative odds (floor 0.8636 > 0.85), so the
  v1.4 board's 0 farms is a design outcome, and the v1.5 candidate
  (f) corrects the ceiling to an odds-consistent form under a
  prespecified two-layer adoption rule; verdicts flip often under
  LOPO refits (543 moves) and ranks are shown as ranges where the
  data does not support a single precise rank.
- **v1.6 additions:** the production verdict is decided by the analytic
  gate statistics, with the simulation as a cross-check — the board's
  FARM count is therefore the analytic count, and the simulation's
  ±3-row Monte Carlo noise no longer moves verdicts; rows within
  ±0.01 of a gate ceiling, or where the analytic and simulated gates
  disagree, are BORDERLINE and land in MARGINAL with a REVIEW label,
  never FARM or SKIP; gate (f) is a risk-screening policy, not a profit
  gate — its 3× conditional payoff is below the 5.09×/6.33× breakeven
  multiples, so some (f) farms have a negative expected net return and
  the audit says which ones; every row shows two verdicts (adopted and
  conservative) and a CONDITIONAL FARM label when only the adopted
  layer passes; a production FARM is STABLE only when at least 35 of
  70 LOPO refits agree with it, and the proportions are shown next to
  every verdict; the ranking tournament tests TVL-only,
  median-by-category and global-median against OLS on ranking metrics,
  and OLS stays unless a challenger clears the prespecified
  +0.10 Spearman / +0.05 Kendall / top-10 tie bar; the fold-80
  inversion is tested per listing-date tercile and per listing-year
  cohort, and the per-cohort numbers are descriptive at n < 10.
