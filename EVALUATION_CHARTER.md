# Evaluation Charter v1.1 — Token Radar (radar-8)

Locked **before** fitting radar-8. Any change after results creates a new
charter version and labels the prior results **exploratory**. Radar-7 numbers
were computed under charter v1.0; the evaluation procedure changed in v1.1
(undated hard-gate, growth removed from the production features, EV safety
margin, prespecified model selection, launch-probability audit), so radar-7
numbers are **exploratory under v1.1** and must not be quoted as v1.1 results.

## Question, target, grain, decision time

- **Question:** which pre-token protocols are worth farming for a token launch,
  and at what value if they launch?
- **Target — definition (v1.1, precise):** `log10(market cap in USD)` as
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
  is **not claimed** under v1.1 because that match has not been established.
- **Row grain:** one protocol. **Decision time T:** the snapshot date; every
  feature is the snapshot's own value at T.
- **Eligible population (v1.1, hard-gated):** DATED live-token comparables
  only — a token trading, TVL and market cap positive, not a CEX, passing the
  board's rankability rule, AND with a recorded listing date. n = 70.
  The 22 UNDATED comparables are **physically excluded from every fitting,
  calibration, and validation split** (regression, group adjustments,
  cross-validation, conformal calibration, OLS/ridge baselines, bootstrap).
  They are scored only as a reference table with the dated-only full fit, and
  their error is a diagnostic, never a headline and never mixed into any
  fitted quantity.

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
  placed in a walk-forward test set — and under v1.1 it is in no training set
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
  nominal, P90 tail error on the selection folds.
- **Baselines:** the old OLS model on the same features and splits; a ridge
  baseline (fixed λ = 1.0 on the standardized log-TVL slope, see below — a
  mild shrinkage, not a tuned model); the base-rate launch rate for the
  seasoning curve.
- **Success rule:** nested pooled < 0.602 dex (4x) AND WF 70/30 < 0.602 dex,
  on dated comps. (Radar-7 under v1.0: nested 0.3728, WF 0.4427 — both passed;
  those numbers are exploratory under v1.1.)
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
  stability constant, not a tuned optimum. (v1.0 evidence stands.)
- **Growth carry: REMOVED from the production model (v1.1).** The production
  features are `[1, log10(TVL + $25M)]` only. Evidence: the growth
  coefficient is unstable across folds (signed: +0.73/+0.67/+0.84/+1.00/+0.19
  vs −0.07 full fit, radar-7), and no growth variant improves held-out error.
  A **growth diagnostic** is run separately and reported: a Huber fit with a
  signed `log(1 + winsor(change_7d, −50%, +200%))` term, no clamp, on the
  identical splits. Growth returns to production only if that diagnostic
  improves the selection metric by > 0.01 dex — it does not under v1.0
  evidence (signed: WF 0.4427 tie, nested 0.3728 tie, CV 0.5593 worse), so
  production has no growth term. 30d/90d growth cannot be built — the sealed
  snapshot carries only `change_7d`.
- **Category/chain adjustments: post-hoc shrunk median residuals
  (n/(n+3)), kept.** (v1.0 evidence stands; a joint category intercept was
  tested and rejected.)
- **Missingness: handling (d) — hard-gate (v1.1).** Undated comps are
  excluded from all fitting and calibration. Mechanism is structural/MNAR:
  undated comps are legacy protocols whose listing dates were never recorded;
  their median residual is −0.228 dex (systematically over-predicted) vs
  −0.021 for dated, and their stratified-test error was 0.6962 dex (4.97x)
  vs dated 0.5454 under v1.0. Under v1.1 they are scored only as a reference
  table with the dated-only full fit; the dated-only band's coverage on them
  is reported as a diagnostic with the bias analysis, not as a calibration
  result.
- **Value band: cross-conformal on dated-only CV residuals (70), not
  bootstrap-only.** Half-width = the finite-sample-corrected α quantile of
  absolute out-of-fold residuals from the 5-fold CV (dated only), k =
  ceil((n+1)·α). Nominal 50/80/90% with empirical coverage reported; the
  undated diagnostic coverage against the dated band is reported separately.
  A strict split-conformal check (train 70% / calibration 15% / test 15%,
  dated only, train purged) is reported as a secondary check. The old
  bootstrap SD stays as a diagnostic only.
- **Seasoning (launch odds):** logistic fit of has-token on log10(age+1).
  Fold-local refits are used for validation; the full fit (all 645 dated
  protocols) is used for the board only. Audit (v1.1): a reliability diagram
  (fixed predicted-probability bins with n and actual launch rate per bin),
  a bootstrap 95% CI for the Brier and log-loss improvement over the base
  rate (2000 resamples, seed 20261107, resampling pooled test rows),
  ROC-AUC and PR-AUC on the pooled fold-local predictions, and per-fold
  mean-predicted vs actual rates. **Platt calibration:** a logistic
  recalibration (Platt scaling on logit(p)) is fitted on the fold-local
  predictions from cutoffs 50/60/70 (150 rows) and tested on cutoffs 80/90
  (100 rows, untouched for this decision). It is adopted **only if** it beats
  the uncalibrated curve on BOTH Brier and log-loss on that test; otherwise
  the raw curve stands and the failure is reported honestly — no added
  complexity without evidence. Caveat (unchanged): token status is measured
  at as_of for every protocol, so the curve is a cross-sectional association
  at as_of, not a true historical hazard — a protocol listed before a cutoff
  that launched after it counts as has-token in the training fit. Under v1.0
  the curve beat the base rate only slightly out of sample (pooled Brier
  0.1194 vs 0.1233, log-loss 0.4097 vs 0.4164, ECE 0.0648) — verdict
  usable-with-caveats, not well-calibrated.
- **Verdicts: expected net return with a safety margin (v1.1).**
  EV = p_L × 0.25% × value-if-launches − plan cost, where 0.25% is the
  farmer's assumed share of the launch value (an assumption, stated, not
  verified from data). **FARM iff EV at the central value > 0 AND EV at the
  P25 value > 0** (P25 = value at predictedLog − 50% band half-width: the
  farm must pay even at the lower quartile of the value band). **Marginal**
  iff EV central > 0 but EV P25 ≤ 0, or EV central ≤ 0 with break-even odds
  ≤ 33%. **Skip** otherwise. The old break-even-only rule and the v1.0
  EV>0-only rule both called rows FARM that the margin rule demotes; the
  demotions are listed in the EV audit table. Every FARM row carries an
  end-to-end audit: EV at conservative (P25) / central / optimistic (P75)
  value, probability of a negative return, P10 value and EV at P10, and the
  assumptions the EV rests on: 0.25% farmer share (assumed); exit value =
  snapshot market cap (no slippage, no liquidity, no lockup modeled — the
  snapshot carries no unlock schedule, no order-book depth, and no fee
  data, so none is invented); farming costs = gas per chain + opportunity
  cost of the deposit at 10% annual over the hold window; hold days by age
  (60 < 180d, 45 < 365d, else 30). Probability of a negative return assumes
  log10(value) is normal with σ = (50% band half-width) / 0.6745 around the
  prediction, and counts a non-launch as a full loss of the plan cost.

## Tuning boundary and final holdout

- The floor, the purge gap, the ridge λ, the verdict thresholds and the
  selection rule are locked constants, chosen on training-fold evidence only
  (or on principle, stated as such). No hyperparameter is selected on a test
  fold. The selection metric uses nested folds 50–80 only.
- **Untouched final test:** the nested 90% fold (newest 7 dated comps) is
  evaluated once, after every choice is frozen, and is never used to select
  or tune anything. There is no separate untouched holdout beyond it; the
  charter states this rather than pretending otherwise.
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
  row must have positive EV at both the central and the P25 value. All checks
  exit non-zero on failure.

## Per-fold reporting and slices

- Every validation number is reported per fold and pooled, never pooled-only.
- Slices: dated-only (headline); undated-only as a reference diagnostic.
- The nested 80% fold is diagnosed per fold, not dropped: a diagnostics table
  per fold (test window, n, median TVL, median age, category mix, unseen
  categories/chains, median signed error, median abs error, P90 error, and
  the per-row errors). Under v1.0 it was 1.0201 dex with the purge gap: its
  test window (2025-09 → 2026-02) holds the newest listings, including
  structural extremes — rain (Prediction Market, mcap/TVL 400x, error 2.91
  dex) and obol (Staking Pool, mcap/TVL 0.0006x, error 1.89 dex) — and 3 of
  its 7 rows are in categories with zero training comps (Prediction Market,
  Staking Pool, Decentralized AI) plus one unseen chain (Bittensor). Both
  Huber and OLS fail identically there, so it is the data, not the estimator.
  The fold is kept and reported, never deleted.

## Known limitations (stated, not hidden)

- Target = snapshot market cap; no price history; FDV-at-TGE unverifiable.
- Survivorship bias: 15 zero-mcap + 14 Gecko-no-cap dead records are visible;
  fully delisted tokens are invisible; fitted values bias upward.
- Undated comps (22/92) are a different, harder population; under v1.1 they
  are excluded from the fit entirely and reported as a reference only.
- The launch-odds curve beats the base rate only slightly out of sample; the
  EV of every farm verdict depends on that curve, so the verdicts inherit its
  calibration limits — the audit table shows the exposure.
- The 80% nested fold is the hard fold; its median is reported, not dropped.
- The 0.25% farmer share, the exit at snapshot market cap, and the absence of
  slippage, liquidity, and lockup modeling are assumptions, not measurements.
