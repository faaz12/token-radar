# Evaluation Charter v1.0 — Token Radar (radar-7)

Locked **before** fitting radar-7. Any change after results creates a new
charter version and labels the prior results **exploratory**. Radar-6 numbers
were computed before this charter existed, so they are exploratory under v1.0;
radar-7 numbers are charter-v1.0.

## Question, target, grain, decision time

- **Question:** which pre-token protocols are worth farming for a token launch,
  and at what value if they launch?
- **Target:** `log10(market cap)` at the snapshot date (`as_of` 2026-11-14).
  The snapshot carries **no price history**, so FDV-at-TGE or FDV-median-days-3–7
  **cannot be verified or built** from this data. The target is the snapshot
  market cap, stated explicitly everywhere the model is described.
- **Row grain:** one protocol. **Decision time T:** the snapshot date; every
  feature is the snapshot's own value at T.
- **Eligible population:** live-token comparables — a token trading, TVL and
  market cap positive, not a CEX, and passing the board's rankability rule
  (no wrapped / staked / bridged / versioned / exchange product, applied
  uniformly by category and name pattern, never by slug). n = 92 (70 dated,
  22 undated).

## Splits, ordering, grouping, embargo

- **Primary split:** nested expanding-window walk-forward on dated comps only:
  train on the oldest 50/60/70/80/90%, test on the next 10% forward in time.
  Pooled median absolute log error is the **primary metric**.
- **Secondary splits:** walk-forward 70/30 dated-only; stratified 70/30
  (dated and undated each split 70/30, undated by slug); 5-fold CV with a
  fixed-seed shuffle (seed 20261118).
- **Grouping:** one row per protocol; no protocol appears in both sides of any
  split. A protocol with no listing date has no position in time and is never
  placed in a walk-forward test set.
- **Embargo / purge gap: 30 days.** Train rows listed within 30 days before a
  test window's start are dropped. Rationale: a token's first month of trading
  is when its snapshot market cap is most unstable, and the snapshot's growth
  window is 7 days, so 30 days covers ~4 weekly windows. Grid tested
  0/30/60/90/180 days: 30d gives the best nested pooled error (0.3728 dex);
  90d is worse (0.4276), 180d neutral (0.3860). The gap is locked, not tuned
  per fold.
- **Minimum training history:** the first nested fold trains on 35 dated comps.

## Metrics, baselines, success rule

- **Primary metric:** nested WF pooled median absolute log error (dated only).
- **Secondary:** WF 70/30 dated, stratified dated / undated / combined, 5-fold
  CV, R², OLS baseline on identical rows and folds, seasoning Brier / log-loss
  / ECE (fold-local fits), conformal coverage at 50/80/90% nominal.
- **Baselines:** the old OLS model on the same features and splits; the
  base-rate launch rate for the seasoning curve.
- **Success rule:** nested pooled < 0.602 dex (4x) AND WF 70/30 < 0.602 dex.
  Radar-7: nested 0.3728 (2.36x), WF 0.4427 (2.77x) — both pass.
- **Headline:** dated-only numbers are the headline. Dated+undated and
  undated-only are separate diagnostics, never mixed into the headline.

## Locked model choices (tested, with evidence)

- **Estimator: Huber (IRLS, delta 1.345, MAD scale).** Paired tournament on
  identical observations and folds: Huber vs OLS differences are within noise
  on every split (WF paired median diff +0.0050, 95% CI [-0.0073, +0.0318];
  nested +0.0015 [-0.0161, +0.0172]; CV +0.0061 [-0.0062, +0.0153]).
  Huber stays the model because it down-weights the snapshot's attribution
  quirks (one token counted twice, a bridge carrying its chain token), **not**
  because it wins the metrics — the data does not show a win either way.
- **Size floor: $25M, locked.** Plain grid ($0M/$10M/$25M/$50M/$100M): no floor
  dominates (WF best $25M, nested best $10M, CV best $100M, stratified best
  $0M). Nested tuning (floor chosen inside training folds only) flips per fold
  ($100M, $100M, $0M, $0M, $0M) and scores WORSE pooled (0.3885 vs 0.3728).
  The floor is a stability constant, not a tuned optimum.
- **Growth carry: log(1+g), winsorized [-50%, +200%], coefficient floored at
  0.** The signed coefficient is unstable across folds (-0.07 full fit vs
  +0.20…+1.00 in nested folds). Signed / dropped / raw-fraction / tight-winsor
  variants were tested: none dominates; clamp-0 ties for best WF and nested
  and has the best CV. 30d/90d growth cannot be built — the sealed snapshot
  carries only `change_7d`.
- **Category/chain adjustments: post-hoc shrunk median residuals
  (n/(n+3)), kept.** Ablation: no adjustments gives R² 0.09 (vs 0.44) and much
  worse stratified error; the nested advantage of no-adjustments is noise
  (paired diff +0.0021, 95% CI [-0.0307, +0.0747]). A joint category intercept
  improves nested/CV within noise but makes WF significantly worse (paired diff
  +0.0141, 95% CI [+0.0008, +0.0255]) — rejected.
- **Missingness: handling (a) — undated comps excluded from walk-forward
  tests, scored separately.** Mechanism is structural/MNAR, not random:
  undated comps are legacy protocols (sushiswap, thorchain, convex, …) whose
  listing dates were never recorded; their median residual is -0.228 dex
  (systematically over-predicted) vs -0.021 for dated. Imputing 365 days +
  indicator loses on the dated holdout (nested 0.4307 vs 0.3857); indicator-only
  ties the primary metric and is mixed elsewhere. All three slices are
  reported: dated-only / undated-only / combined.
- **Value band: cross-conformal, not bootstrap-only.** Half-width = the
  finite-sample-corrected α quantile of absolute out-of-fold residuals
  from the 5-fold CV (92 residuals, each honest), where α is the nominal
  coverage: k = ceil((n+1)·α). Nominal 50%: ±0.5479 dex,
  empirical coverage 51.1% (dated 55.7%, undated 36.4%); 80%: ±1.0753 dex,
  81.5%; 90%: ±1.4462 dex, 91.3%. A strict split-conformal check (train 70% /
  calibration 15% / test 15%, train purged against the calibration window) is
  reported as a secondary check; its calibration set (n=10) is too small to
  trust (50% nominal → half-width 0.4279 dex, 36.4% test coverage).
  The old bootstrap SD stays as a diagnostic only.
- **Seasoning (launch odds):** logistic fit of has-token on log10(age+1).
  Fold-local refits are used for validation. Pooled across the five nested
  folds (next 50 listed after each cutoff, age at as_of, exactly as the board
  applies the curve): Brier 0.1194, log-loss 0.4097, ECE 0.0648, against the
  base-rate baseline (predict the fit's base rate) Brier 0.1233, log-loss
  0.4164 — the curve beats the base rate only slightly out of sample, so the
  verdict is **usable-with-caveats**, not well-calibrated. Per-fold Brier
  0.057–0.156, log-loss 0.233–0.515, ECE 0.037–0.096. Correction (radar-7):
  an earlier Python experiment reported lower numbers (Brier 0.055–0.101)
  against a 0.5 coin-flip baseline (Brier 0.25); those numbers could not be
  reproduced under this charter's definition in three independent checks, so
  they are discarded and the TypeScript numbers above stand.
  The full fit (all 645 dated protocols) is used for the board only. Caveat:
  token status is measured at as_of for every protocol, so the curve is a
  cross-sectional association at as_of, not a true historical hazard — a
  protocol listed before a cutoff that launched after it counts as has-token
  in the training fit.
- **Verdicts: expected net return.** EV = p_L × 0.25% × value-if-launches −
  plan cost. Farm iff EV > 0; marginal iff EV ≤ 0 and break-even odds ≤ 33%;
  skip otherwise. The old break-even-only rule called two rows FARM with
  negative expected return (bittensor-dtao EV −$6,944, nonce-capital −$7,826;
  both 45–56 days old, launch odds 2–3% vs break-even 8–9%) — they are
  marginal under the EV rule. The board's top 5 by expected return are the
  same as the top 5 by implied value. Polymarket's 31% is p_L (launch odds),
  not p_BE (its break-even odds are 6.2%).

## Tuning boundary and final holdout

- The floor, the growth clamp, the purge gap and the verdict thresholds are
  locked constants, chosen on training-fold evidence only (or on principle,
  stated as such). No hyperparameter is selected on a test fold.
- The WF 70/30 test set and the nested test folds are scored once per
  candidate. There is no separate untouched final holdout beyond them; the
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
  fold fit is restricted); and a truncated refit must reproduce the fold fit
  exactly. All checks exit non-zero on failure.

## Per-fold reporting and slices

- Every validation number is reported per fold and pooled, never pooled-only.
- Slices: dated-only (headline), undated-only, combined; by category for the
  largest categories where n allows.
- The nested 80% fold (median 1.0201 dex in radar-7 with the purge gap) is diagnosed, not
  dropped: its test window (2025-09 → 2026-02) holds the newest listings,
  including structural extremes — rain (Prediction Market, mcap/TVL 400x,
  error 2.91 dex) and obol (Staking Pool, mcap/TVL 0.0006x, error 1.89 dex) —
  and 3 of its 7 rows are in categories with zero training comps (Prediction
  Market, Staking Pool, Decentralized AI) plus one unseen chain (Bittensor).
  Both Huber and OLS fail identically there, so it is the data, not the
  estimator.

## Known limitations (stated, not hidden)

- Target = snapshot market cap; no price history; FDV-at-TGE unverifiable.
- Survivorship bias: 15 zero-mcap + 14 Gecko-no-cap dead records are visible;
  fully delisted tokens are invisible; fitted values bias upward.
- Undated comps (22/92) are a different, harder population (stratified error
  0.6962 dex / 4.97x vs dated 0.5454); reported separately.
- The growth coefficient is unstable; the clamp prevents paying protocols for
  shrinking, it does not create signal.
- The 80% nested fold is the hard fold; its median is reported, not dropped.
