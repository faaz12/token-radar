# Evaluation Charter v1.2 — Token Radar (radar-9)

Locked **before** fitting radar-9. Any change after results creates a new
charter version and labels the prior results **exploratory**. Radar-8 numbers
were computed under charter v1.1; the evaluation procedure changed in v1.2
(simulation-based EV, base-rate fallback for launch odds, gate test, OOD
detection, nested reconciliation, floor-sensitivity diagnostic), so radar-8
numbers are **exploratory under v1.2** and must not be quoted as v1.2 results.
Radar-8 is frozen in `hidden_files/radar-8-freeze/` (board, data, dossier,
metrics, CHARTER-v1.1.md, FREEZE.md, snapshot sha256
42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393).

## Why v1.2 exists — the defect it fixes

Under v1.1 the EV audit mixed two different distributions and presented them
as one. For Polymarket the audit showed "EV at P25 value" +$22,148 next to
"P(negative return)" 59.2%. Both numbers were computed correctly, but they were
not statistics of the same distribution: the P25 figure was the EV at the 25th
percentile of the *value* distribution **conditional on launch**, while the
59.2% was the *unconditional* probability of a negative net return, dominated
by the 58.4% non-launch mass (1 − p_L, p_L = 0.4161). If 59.2% of outcomes are
negative, the 25th percentile of the net-return distribution must be negative —
so one of the two statistics was mislabeled. The P(negative) was right; the
"P25 EV" was mislabeled. v1.2 recomputes **every** EV statistic from **one**
seeded simulation array per protocol (the full mixture: launch Bernoulli ×
lognormal value), and labels conditional-on-launch value scenarios explicitly
as conditional, never as quantiles of the net return.

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
  verdict is derived from them.

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
  nominal, P90 tail error on the selection folds, the EV simulation audit,
  the gate test, the OOD report, and the floor-sensitivity diagnostic.
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
- **Seasoning (launch odds) — v1.2: the base rate is the board's default.**
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
  test and a tested gate (v1.2).** For each board row, one seeded simulation
  (N = 20,000 draws; seed = FNV-1a hash of the slug, so the draws are
  deterministic and order-independent) produces the net-return array: each
  draw takes u ~ Uniform(0,1) and z ~ Normal(0,1); the protocol launches iff
  u < p_L; if it launches, log10(value) = predictedLog + σ·z with
  σ = bandHalfwidth / 0.6745 (×1.5 for out-of-distribution rows — see below)
  and value clamped to [$1, $100B]; the draw's net return is
  0.25% × value − plan cost if it launches, else −plan cost. **Every** EV
  statistic is computed from that one array: ev_mean (the expected net
  return — the "central EV"), ev_p10 / ev_p25 / ev_p50 / ev_p75 / ev_p90,
  and p_negative = mean(ev < 0). Expected value and median value are
  different numbers and are labeled as such; the central EV **is** the mean.
  The conditional-on-launch value scenarios are reported separately and
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
  - **Gate test (v1.2, prespecified before results):** two gate variants are
    tested honestly on the corrected statistics, both under the adopted
    (base-rate) p_L:
    (a) the current rule — FARM iff ev_mean > 0 **and** ev_p25 > 0;
    (b) the Gemini proposal — FARM iff ev_mean > 0 **and**
    (ev_p50 − ev_p25) ≤ 0.5 × (ev_p75 − ev_p50), all from the same array.
    **Choice rule (prespecified, documented before the gate test runs):**
    adopt the variant that (i) farms at least one row **and** (ii) rejects at
    least one row with ev_mean > 0 through its additional condition (the gate
    must be a real filter — it must both fire and filter). If exactly one
    variant satisfies (i) and (ii), adopt it. If both satisfy (i) and (ii),
    adopt the one with the lower maximum P(negative) among its FARM rows. If
    **neither** satisfies (i) and (ii), adopt variant (a) — the pre-existing
    charter rule — and report the resulting FARM count, even if zero. The
    FARM count is never a target and never a reason to change the rule. The
    gate-test table (both variants, FARM counts, maximum P(negative) among
    FARM rows, rows farmed) is published in the validation.
  - **Marginal** iff the row is not FARM but ev_mean > 0 under the adopted
    p_L, or ev_mean ≤ 0 with break-even odds ≤ 33%. **Skip** otherwise. The
    0.25% farmer share, the exit at snapshot market cap, and the absence of
    slippage, liquidity, and lockup modeling are assumptions, not
    measurements (unchanged from v1.1).
- **Out-of-distribution detection (v1.2):** every board prediction is checked
  against the training domain (the 70 dated comps): the set of categories,
  the set of main chains, the [min, max] range of log10(TVL + $25M), and the
  [min, max] range of age in days. A row is flagged out-of-distribution iff
  any of: its main chain never appears in training, its category never
  appears in training, its log10(TVL + $25M) is outside the training range,
  its age is outside the training range (or unknown), or its nearest
  comparable is more than 0.5 dex away in log10(TVL + $25M). An
  out-of-distribution row gets an **extrapolation warning**, a band half-width
  **×1.5** for its EV simulation (a wider band, not a different model), and
  confidence label **'extrapolation'** (never 'in-distribution'). No
  out-of-distribution prediction carries the same confidence as an
  in-distribution one.
- **TVL floor sensitivity (v1.2, diagnostic — the floor stays locked):** for
  each floor in {$0M, $10M, $25M, $50M, $100M}, report the full-fit
  coefficients (intercept, coef_log_tvl) on the 70 comps with the selected
  estimator, the selection-pooled metric (nested 50–80, identical folds),
  and the board ranking change vs the $25M board (Spearman ρ on implied
  value, top-20 overlap, top-10 changes). Also report a training-fold-only
  choice test: for each nested fold, choose the floor by 5-fold CV **within
  that fold's training set only**, evaluate the chosen floor on the fold's
  test set, and pool — this is what choosing the floor inside training folds
  would actually buy. The floor is **not** changed by this diagnostic in
  radar-9: it stays $25M, a stability constant.

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
  warning and a ×1.5 band; their predictions are less trustworthy than
  in-distribution ones.
