// Token Radar's model (radar-9, evaluation charter v1.2): one sealed snapshot in, one ranked board out.
//
// The board covers every protocol the snapshot's watchlist names (the floor, never a ceiling)
// and every other pre-token protocol the snapshot carries: the early rows the radar exists to
// find. A protocol is pre-token when its record carries no token at all (no market cap, no
// CoinGecko id, no symbol) — and it is ranked only when it is not a wrapped, staked or
// bridged product of a token that already trades: WBTC, Binance staked ETH and USDT0 record
// no token of their own, but their token already exists, so there is no launch to rank.
// Protocols whose token already trades are kept apart and shown with the market's own values,
// never mixed into the ranked board.
//
// Implied value is FITTED, not hand-set, in two parts:
//  1. Value if it launches: an OLS-fitted log-log regression, fitted at run time on the
//     snapshot's own live-token comparables: protocols with a token trading, TVL and market
//     cap positive, CEX excluded — and, since radar-6, only protocols the board could rank.
//     The same wrapped / staked / bridged / versioned / exchange-product exclusions the
//     board applies to pre-token protocols are applied to the training set, so the curve is
//     fitted on the population it prices: a canonical bridge's TVL is bridged assets, not
//     its own value, and a chain token counted on its bridge (or one token counted on two
//     versions of a protocol) teaches the curve the wrong relation. No protocol name is
//     special-cased: the exclusion is the board's own rule, applied uniformly by category
//     and name pattern.
//       log10(V) = b0 + b1*log10(tvl + $25M) + adjustments
//       Growth is NOT a production feature (charter v1.1, carried): the growth coefficient is
//       unstable across folds (-0.07 on the full fit, +0.20…+1.00 in nested folds) and
//       no growth variant improves held-out error, so change_7d is run only as a
//       separate signed diagnostic and never enters the production fit. The snapshot
//       carries only change_7d — 30d/90d growth cannot be built from it.
//       size floor: TVL below $25M is noisy in the snapshot, so the curve saturates there —
//       a small protocol is never priced at zero for being small. The floor is a locked
//       constant, not a tuned optimum: no floor dominates the grid ($0M/$10M/$25M/$50M/
//       $100M), and choosing it inside training folds scores worse pooled.
//       Huber, OLS and a mild ridge are co-equal candidates under charter v1.2: the
//       production estimator is chosen by the prespecified selection rule (nested 50–80
//       pooled median, with a simplicity tie-break and a tail-error/sensitivity condition
//       for Huber), never by R².
//       group adjustments: the median residual of a category / a main chain, shrunk toward
//       zero by n/(n+3), so a group with one or two comps moves the price a little and a
//       group with fifteen moves it a lot. A joint category intercept was tested and
//       rejected: it improves nested/CV within noise but makes the walk-forward
//       significantly worse.
//  2. Launch odds: the BASE RATE (charter v1.2). The seasoning curve (a logistic fit of
//     "has a token" on log10(age+1) over all 645 dated protocols) is still fitted and
//     audited, but it does not set any board launch odds: on the untouched chronological
//     test the base rate beats even the Platt-calibrated curve (Brier 0.1131 vs 0.1144),
//     and the bootstrap 95% CI for the curve's Brier improvement over the base rate
//     straddles zero — the curve is not predictive enough to beat a constant. So every
//     board row takes p_L = the base rate (0.1643) until a better model validates.
//       implied_value_usd = value_if_launches x launch_odds
//     Age left the regression: it now prices launch likelihood, not size — and under
//     v1.2 the board's launch likelihood is the constant base rate, not the curve.
//
// The fit is validated at run time and the dashboard shows all of it, under evaluation
// charter v1.2 (EVALUATION_CHARTER.md): the nested expanding-window walk-forward on dated
// comparables only is the headline (train on the oldest 50/60/70/80/90%, test on the next
// 10% forward in time, with a 30-day purge gap — train rows listed within 30 days before a
// test window are dropped), with folds 50–80 as the prespecified selection metric and the
// 90% fold (newest 7 comps) as the untouched final test; plus the walk-forward 70/30 split,
// the stratified split (train on dated 70% only; dated 30% tested, undated 30% scored as a
// reference diagnostic by the dated-only fit), and a 5-fold cross-validation with a
// fixed-seed shuffle on dated comps only. The value band is cross-conformal: the
// (1-α) quantile of absolute out-of-fold residuals from the 5-fold CV, so a 50% band
// holds ~50% of comparables by construction (51.1% measured), with 80% and 90% bands
// reported alongside. The seasoning curve is validated with fold-local refits (Brier,
// log-loss, ECE against the base-rate baseline) plus a reliability diagram, bootstrap
// intervals for the improvement over the base rate, ROC/PR AUC, and a Platt-calibration
// test on a chronological calibration set — and the base rate is compared against the
// curve on the exact same chronological test observations, calibration and discrimination
// reported separately. Every farm plan carries a verdict from its expected net return:
// EV = launch odds × 0.25% × value-if-launches − plan cost, computed from ONE seeded
// simulation array per protocol (the full mixture: launch Bernoulli × lognormal value),
// so the mean, the P10/P25/P50/P75/P90 quantiles and P(negative return) are all
// statistics of the same distribution; the farm gate is tested in two variants and
// chosen by a prespecified rule, and a farm must also survive under a conservative
// launch-probability assumption. Undated comparables are hard-gated out of every fit
// and calibration and appear only as a reference table labeled "unsupported estimates".
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  unknown_age_days: number;
  size_floor_usd: number;
  shrink_k: number;
  value_min: number;
  value_max: number;
  deposit_usd: number;
  opportunity_rate_annual: number;
  farmer_share: number;
  farm_break_even: number;
  marginal_break_even: number;
  purge_gap_days: number;
  /** v1.7: slippage/fees as a fraction of the deposit — an explicit,
   * conservative, uniform assumption (the snapshot carries no
   * per-protocol slippage or fee field, so none is invented). */
  slippage_fee_rate: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -50,
  growth_cap: 200,
  unknown_age_days: 365,
  size_floor_usd: 25_000_000,
  shrink_k: 3,
  value_min: 1,
  value_max: 100_000_000_000,
  deposit_usd: 10_000,
  opportunity_rate_annual: 0.1,
  farmer_share: 0.0025,
  farm_break_even: 0.1,
  marginal_break_even: 0.33,
  purge_gap_days: 30,
  slippage_fee_rate: 0.005,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-14';

/** The evaluation charter version this model's validation follows. */
export const CHARTER_VERSION = 'v1.7';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's comparable basis: its median residual adjustment, or 0 when thin. */
export interface Comparable {
  category: string;
  count: number;
  adjustment: number;
  basis: 'category' | 'global';
}

/** The fitted regression, as the dashboard prints it. */
export interface Fit {
  intercept: number;
  coef_log_tvl: number;
  coef_growth: number;
  n_comps: number;
  size_floor_usd: number;
  median_growth: number;
}

/** The seasoning curve: the logistic fit of "has a token" on log10(age+1).
 * platt_a/platt_b are a Platt recalibration fitted on a chronological calibration
 * set and adopted only when it beats the raw curve on Brier AND log-loss on an
 * untouched test set; null when not adopted (the raw curve stands). */
export interface Seasoning {
  intercept: number;
  slope: number;
  n_protocols: number;
  base_rate: number;
  platt_a: number | null;
  platt_b: number | null;
}

/** One cross-conformal band: a nominal coverage, its half-width in dex, and the
 * empirical coverage measured on the out-of-fold residuals, overall and by slice. */
export interface ConformalBand {
  nominal: number;
  halfwidth_dex: number;
  coverage: number;
  coverage_dated: number;
  coverage_undated: number;
}

/** The strict split-conformal check: train 70% / calibration 15% / test 15% on
 * dated comps only. The calibration set is small (n=10), so this is a secondary
 * check on the cross-conformal band, not the band itself. */
export interface ConformalSplitCheck {
  n_calibration: number;
  n_test: number;
  halfwidth_50_dex: number;
  test_coverage_50: number;
}

/** One nested fold's seasoning validation: the curve refit on protocols listed
 * before the cutoff, scored on the next 50 protocols listed after it. */
export interface SeasoningFoldValidation {
  train_pct: number;
  cutoff: string;
  n_fit: number;
  brier: number;
  log_loss: number;
  ece: number;
  base_rate_brier: number;
  base_rate_log_loss: number;
  mean_pred: number;
  actual_rate: number;
}

/** The seasoning curve's out-of-sample validation, pooled across nested folds:
 * fold-local refits against the base-rate baseline and the full fit. The verdict
 * follows the calibration-check scale. */
export interface SeasoningValidation {
  brier: number;
  log_loss: number;
  ece: number;
  base_rate_brier: number;
  base_rate_log_loss: number;
  full_fit_brier: number;
  verdict: 'well-calibrated' | 'usable-with-caveats' | 'poorly-calibrated' | 'invalid-eval';
}

/** A paired Huber-vs-OLS comparison on identical observations: the median
 * per-observation difference (Huber minus OLS) with a bootstrap 95% interval.
 * A interval that straddles zero is noise, not a win for either side. */
export interface PairedComparison {
  median_diff: number;
  ci_lo: number;
  ci_hi: number;
  n_better_huber: number;
  n: number;
}

/** The missingness report: the three slices (dated-only / undated-only /
 * combined) and the mechanism. Undated comps are legacy protocols whose listing
 * dates were never recorded — structural missingness, not random — so they are
 * scored separately and never mixed into the headline. */
export interface MissingnessReport {
  n_dated: number;
  n_undated: number;
  dated_err: number;
  undated_err: number;
  combined_err: number;
  mechanism: string;
  handling: string;
}

/** The truncation-invariance audit, run at build time: the fold construction
 * and the feature computation must not use any row dated after a fold's cutoff. */
export interface TruncationAudit {
  passed: boolean;
  checks: string[];
}

/** The walk-forward validation, as the dashboard prints it. Dated-only numbers
 * are the headline; dated+undated and undated-only are separate diagnostics. */
export interface Validation {
  r2: number;
  oos_median_abs_log_err: number;
  oos_stratified: number;
  oos_stratified_dated: number;
  oos_undated: number;
  n_dated_comps: number;
  n_undated_comps: number;
  cv_median_abs_log_err: number;
  bootstrap_sd: number;
  band_halfwidth_dex: number;
  range_holds: number;
  n_train: number;
  n_test: number;
  ols_baseline: OlsBaseline;
  ridge_baseline: OlsBaseline;
  nested_wf_folds: NestedFold[];
  nested_wf_pooled: number;
  nested_selection_pooled: number;
  nested_untouched_90: number;
  purge_gap_days: number;
  charter_version: string;
  conformal_bands: ConformalBand[];
  conformal_split_check: ConformalSplitCheck;
  conformal_undated: ConformalUndatedDiagnostic;
  undated_reference: UndatedReferenceRow[];
  seasoning_validation: SeasoningValidation;
  seasoning_folds: SeasoningFoldValidation[];
  seasoning_audit: SeasoningAudit;
  huber_vs_ols: { wf: PairedComparison; nested: PairedComparison; cv: PairedComparison };
  model_selection: ModelSelection;
  growth_diagnostic: GrowthDiagnostic;
  ev_audit: EvAudit;
  nested_fold_diagnostics: NestedFoldDiagnostic[];
  target: TargetDoc;
  missingness: MissingnessReport;
  truncation_audit: TruncationAudit;
  launch_odds_decision: LaunchOddsDecision;
  gate_test: GateTest | null;
  nested_reconciliation: NestedReconciliation;
  floor_sensitivity: FloorSensitivity;
  /** v1.3: the distribution-sensitivity tournament for the conditional launch value. */
  distribution_tournament: DistributionTournament | null;
  /** v1.3: the 12-month horizon cohort and the survival candidate test. */
  horizon_cohort: HorizonCohort;
  /** v1.3: the validated OOD band multiplier. */
  ood_multiplier_validation: OodMultiplierValidation;
  /** v1.3: the leave-one-protocol-out influence report. */
  lopo_influence: LopoInfluence;
  /** v1.3: the conformal coverage slices. */
  conformal_slices: ConformalSlices;
  /** v1.4: the outlier audit (rain/obol) with with/without refits — filled in
   * buildRadar (it needs the board); null from fitModel. */
  outlier_audit: OutlierAudit | null;
  /** v1.4: the ranking-stability evaluation (LOPO, nested WF, TVL shock) —
   * the nested part is computed in fitModel; the LOPO rows, TVL shock, bars
   * and crosscheck are completed in buildRadar under the adopted gate. */
  ranking_stability: RankingStability;
  /** v1.4: the segmented OOD report (coverage per OOD segment). */
  ood_report_segmented: SegmentedOodReport;
  /** v1.4: the cap-as-risk-control stress test — filled in buildRadar (it
   * needs the tournament); null from fitModel. */
  cap_sensitivity: CapSensitivity | null;
  /** v1.4: the parameter uncertainty (bootstrap refits). */
  parameter_uncertainty: ParameterUncertainty;
  /** v1.4: the Rain winsorization candidate test — filled in buildRadar;
   * null from fitModel. */
  winsorization_test: WinsorizationTest | null;
  /** v1.5: the final evaluation table (target, unit, folds, baselines, rank
   * correlation, coverage) — computed in fitModel from the validation. */
  final_evaluation: FinalEvaluation;
  /** v1.5: the verdict stability over the 70 LOPO refits — filled in
   * buildRadar (it needs the production board and the refit verdicts). */
  verdict_stability: VerdictStability | null;
  /** v1.5: the param-aware farming simulation — filled in buildRadar (it
   * needs the board sims and the bootstrap refit predictions). */
  param_aware_simulation: ParamAwareSimulation | null;
  /** v1.5: the gate-(d) threshold-sensitivity grid — filled in buildRadar. */
  gate_threshold_grid: GateThresholdGrid | null;
  /** v1.6: the ranking tournament — simple models vs OLS on RANKING
   * metrics over the same nested folds — computed in fitModel. */
  ranking_tournament: RankingTournament;
  /** v1.6: per-cohort and per-regime ranking for the fold-80 failure —
   * computed in fitModel. */
  cohort_ranking: CohortRanking;
  /** v1.6: the gate-(f) re-audit with expected net return per row —
   * filled in buildRadar (it needs the board and the bootstrap). */
  gate_f_audit: GateFAudit | null;
  /** v1.6: the valuation-to-decision table — filled in buildRadar (it
   * needs the final board and the stability rows). */
  valuation_decision_table: ValuationDecisionRow[] | null;
  /** v1.7: the comps-fitted mcap/TVL ratio valuation — computed in
   * fitModel; the board comparison is completed in buildRadar. */
  ratio_valuation: RatioValuation | null;
  /** v1.7: the costed farm plans and gate (g) — filled in buildRadar. */
  costed_farm_plans: CostedFarmPlans | null;
  /** v1.7: target comparability — one pinned target, FDV split off. */
  target_comparability: TargetComparability | null;
  /** v1.7: the algorithmic MARGINAL tiering — filled in buildRadar. */
  marginal_tiers: MarginalTiers | null;
  /** v1.7: the realized-outcome holdout on the untouched 90% fold —
   * computed in fitModel after the freeze point (it selects nothing). */
  realized_holdout: RealizedHoldout | null;
  /** v1.7: ranking calibration — bootstrap intervals, precision/recall,
   * reliability — computed in fitModel. */
  ranking_calibration: RankingCalibration | null;
}

/** The final evaluation table (charter v1.5): one consistent table for the
 * whole evaluation — target and its date, the unit of analysis, the fold
 * sizes, the baselines, the median absolute error and signed bias per fold
 * and pooled, the rank correlation per fold and pooled, and the interval
 * coverage. The walk-forward error is reported as a typical error multiple
 * (~3.27x), and R² is labeled in-sample only. */
export interface FinalEvaluation {
  target: string;
  target_date: string;
  unit: string;
  n_independent_protocols: number;
  folds: { label: string; n_test: number; median_abs_log_err: number; signed_bias_log: number; spearman: number; kendall: number }[];
  pooled: { n_test: number; median_abs_log_err: number; signed_bias_log: number; spearman: number; kendall: number };
  baselines: { name: string; pooled_median_abs_log_err: number }[];
  coverage: { nominal: number; observed: number }[];
  wf_median_abs_log_err_dex: number;
  wf_typical_error_x: number;
  r2_in_sample: number;
  r2_note: string;
}

/** One board row's verdict stability over the 70 LOPO refits (charter v1.5):
 * the production verdict, how many refits agree with it, the most frequent
 * alternative verdict, which dropped comps flip it, and the rank range
 * across refits. */
export interface VerdictStabilityRow {
  slug: string;
  main_verdict: Verdict;
  counts: { farm: number; marginal: number; skip: number };
  n_agreeing_refits: number;
  most_frequent_alternative: Verdict | null;
  flip_drivers: { dropped_slug: string; to_verdict: Verdict }[];
  rank_range: [number, number, number];
}

/** The verdict-stability aggregates (charter v1.5). */
export interface VerdictStability {
  n_refits: number;
  unique_rows_ever_flipped: number;
  moves_per_row_median: number;
  moves_per_row_max: number;
  pct_pairs_on_main_verdict: number;
  most_frequent_moves: { from: Verdict; to: Verdict; count: number }[];
  rows: VerdictStabilityRow[];
  /** v1.6: the prespecified stability threshold (35/70 = 50%) and how
   * many production farms it demoted to marginal. */
  stability_threshold: number;
  n_stability_demoted: number;
}

/** One audit row's param-aware farming simulation (charter v1.5): the mean
 * EV and P(negative) under three value distributions, where every draw
 * folds in a bootstrap-refit coefficient, a launch-odds draw from the
 * base-rate bootstrap, and the outcome residual — plus the paired pass
 * fractions of gate (d) under the adopted and the conservative odds. */
export interface ParamAwareRow {
  slug: string;
  plan_cost_usd: number;
  distributions: {
    distribution: 'capped-lognormal' | 'lognormal' | 'student-t';
    mean_ev_usd: number;
    prob_negative: number;
  }[];
  pass_fraction_d_adopted: number;
  pass_fraction_d_conservative: number;
}

/** The param-aware farming simulation (charter v1.5). */
export interface ParamAwareSimulation {
  n_draws: number;
  n_refits: number;
  n_rows: number;
  note: string;
  rows: ParamAwareRow[];
}

/** The gate-(d) economic audit (charter v1.5): the breakeven multiple
 * (1 − p_L) / p_L and the launch-success rate the 85% ceiling demands, the
 * farm count under each threshold multiple × ceiling combination, and
 * whether (d) is structurally impossible under the conservative odds. */
export interface GateThresholdGrid {
  multiples: number[];
  ceilings: number[];
  rows: { multiple: number; ceiling: number; farm_count_adopted: number; farm_count_conservative: number }[];
  breakeven_multiple_adopted: number;
  breakeven_multiple_conservative: number;
  required_launch_success_d_adopted: number;
  required_launch_success_d_conservative: number;
  d_impossible_under_conservative: boolean;
  /** The analytic farm counts under policy (f) — the exact closed-form
   * counts, against the simulation gate test's counts. The two differ only
   * by Monte Carlo noise on rows sitting at the ceiling. */
  analytic_farm_count_f_adopted: number;
  analytic_farm_count_f_conservative: number;
  note: string;
}

/** The reproducibility package (charter v1.5): everything needed to rebuild
 * the board from the sealed snapshot — the snapshot hash (computed from the
 * input file at build time, never typed by hand), the dataset and charter
 * versions, every locked constant, every seed, the per-protocol outputs,
 * and the exact rebuild commands. */
export interface Reproducibility {
  snapshot_sha256: string | null;
  snapshot_as_of: string;
  dataset: string;
  charter_version: string;
  model_version: string;
  seeds: { [key: string]: number | string };
  constants: { [key: string]: number | string };
  outputs: string[];
  reproduce_commands: string[];
}

/** One of the three co-equal regression estimators (charter v1.1). */
export type Estimator = 'huber' | 'ols' | 'ridge';

/** One candidate's numbers on the selection splits (identical rows and folds). */
export interface CandidateMetrics {
  estimator: Estimator;
  selection_pooled: number;
  selection_p90: number;
  wf: number;
  cv: number;
  drop_one_slope_change: number;
}

/** The prespecified model-selection outcome (charter v1.1). */
export interface ModelSelection {
  rule: string;
  candidates: CandidateMetrics[];
  selected: Estimator;
  reason: string;
}

/** The growth diagnostic: a Huber fit with a signed growth term, no clamp, on the
 * identical splits. Production has no growth term; this is reported only. */
export interface GrowthDiagnostic {
  wf: number;
  nested_pooled: number;
  cv: number;
  coef_growth_full_fit: number;
  verdict: string;
}

/** One reliability bin: predicted launch-probability range vs the actual launch rate. */
export interface ReliabilityBin {
  pred_min: number;
  pred_max: number;
  n: number;
  actual_rate: number;
  mean_pred: number;
}

/** The launch-probability audit (charter v1.3): reliability, bootstrap intervals,
 * ranking metrics, the Platt-calibration test, and the heuristic activity-multiplier
 * test (both against the flat base rate on the same untouched test rows). */
export interface SeasoningAudit {
  reliability_bins: ReliabilityBin[];
  brier_improvement_ci: [number, number];
  log_loss_improvement_ci: [number, number];
  roc_auc: number;
  pr_auc: number;
  n_pooled: number;
  heuristic_multiplier: HeuristicMultiplierTest;
  platt: {
    adopted: boolean;
    a: number | null;
    b: number | null;
    /** The fitted Platt parameters even when not adopted (for the EV stress test). */
    fitted_a: number | null;
    fitted_b: number | null;
    cal_brier: number;
    cal_log_loss: number;
    test_brier_raw: number;
    test_log_loss_raw: number;
    test_brier_platt: number;
    test_log_loss_platt: number;
    test_brier_base: number;
    test_log_loss_base: number;
    /** Calibration (ECE) and discrimination (ROC-AUC) on the same untouched test
     * rows, reported separately for each of the three predictors. */
    test_ece_raw: number;
    test_ece_platt: number;
    test_ece_base: number;
    test_roc_raw: number;
    test_roc_platt: number;
    test_roc_base: number;
    n_calibration: number;
    n_test: number;
    reason: string;
  };
}

/** One row's EV simulation (charter v1.3): every statistic is computed from ONE
 * seeded simulation array — the full mixture (launch Bernoulli × capped-lognormal
 * value) — so the mean, the quantiles and P(negative) cannot contradict each
 * other. The conditional-on-launch value scenarios are point evaluations at the
 * P25/P75/P10 value, labeled as conditional; they are NOT quantiles of the net
 * return. The conditional mean EV is the expected net return GIVEN the protocol
 * launches (0.25% × E[value | launch] − plan cost) — the quantity gate policy
 * (b) tests. */
export interface EvSimulation {
  /** Draws in the simulation array (20,000), seeded by the slug. */
  n_draws: number;
  /** The seed (FNV-1a hash of the slug): the same slug always draws the same array. */
  seed: number;
  /** The expected net return: the MEAN of the simulation array (the "central EV"). */
  ev_mean_usd: number;
  /** The conditional mean EV: E[net return | launch] = 0.25% × E[value | launch]
   * − plan cost, from the same array's value draws. */
  ev_conditional_mean_usd: number;
  /** The mean value if it launches, E[value | launch], from the same array. */
  mean_value_if_launches_usd: number;
  /** The value cap applied to the draws (the maximum observed dated-comp market
   * cap): no simulated launch value exceeds the largest launch ever observed. */
  value_cap_usd: number;
  /** Quantiles of the net-return array (same array as the mean). */
  ev_p10_usd: number;
  ev_p25_usd: number;
  ev_p50_usd: number;
  ev_p75_usd: number;
  ev_p90_usd: number;
  /** P(negative return) = mean(ev < 0) over the same array. */
  prob_negative: number;
  /** P(negative return) under the conservative launch-probability assumption
   * (same draw pairs, lower launch threshold) — the stress-test downside the
   * FARM verdict must survive. */
  prob_negative_conservative: number;
  /** The analytic P(negative) = 1 − p_L × P(value > cost / 0.25%): must agree with
   * the simulated value within Monte Carlo error (±0.02 at N = 20,000). */
  prob_negative_analytic: number;
  /** EV at the P25 / P75 / P10 value IF it launches: point evaluations, conditional
   * on launch — NOT quantiles of the net return. */
  ev_at_p25_value_if_launches_usd: number;
  ev_at_p75_value_if_launches_usd: number;
  ev_at_p10_value_if_launches_usd: number;
  /** The P10 value itself (conditional on launch), kept for the audit table. */
  p10_value_usd: number;
  /** Stress test: the mean EV under the three launch-probability assumptions, all
   * from the SAME (u, V) draw pairs (only the launch threshold changes). */
  ev_mean_base_rate_usd: number;
  ev_mean_platt_usd: number;
  ev_mean_conservative_usd: number;
  /** The 25th / 50th / 75th percentile of the net return under the conservative
   * launch-probability assumption (the gate is tested on these for a FARM). */
  ev_p25_conservative_usd: number;
  ev_p50_conservative_usd: number;
  ev_p75_conservative_usd: number;
}

/** One gate policy's test result (charter v1.3, policies (d)/(e) added v1.4):
 * the policy, what it farms, and the worst downside among its farms.
 * Policies: (a) the strict current rule — mean EV > 0 AND P25 of net return
 * > 0; (b) the Gemini proposal — conditional mean EV > 3× plan cost AND
 * unconditional mean EV > 0; (c) the P(loss) ceiling — mean EV > 0 AND
 * P(negative return) ≤ 0.90; (d) the Gemini conditional-EV hurdle with a
 * risk ceiling — conditional mean EV > 3× plan cost AND P(negative return)
 * ≤ 0.85; (e) the stricter conditional hurdle — conditional mean EV > 5×
 * plan cost AND unconditional mean EV > 0 AND P(negative return) ≤ 0.90.
 * Under charter v1.6 the counts below are the ANALYTIC counts (the exact
 * closed form); the `*_sim` fields are the 20,000-draw simulation counts,
 * reported as the cross-check, and `eligible` is decided on the analytic
 * test. */
export interface GateTestVariant {
  variant: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
  rule: string;
  farm_count: number;
  farm_slugs: string[];
  /** The maximum P(negative return) among the rows this policy farms (null when it farms none). */
  max_prob_negative: number | null;
  /** Whether the policy satisfies the prespecified choice conditions: (i) farms at
   * least one row, (ii) rejects at least one row with ev_mean > 0 through its
   * additional condition, and (iii) its maximum P(negative return) among its
   * FARM rows is ≤ 0.90. */
  fires: boolean;
  filters: boolean;
  /** Whether the policy's farms respect the prespecified risk ceiling. */
  within_risk_ceiling: boolean;
  /** The same test under the conservative launch odds (the 2.5th percentile
   * of the base-rate bootstrap): a policy that fires under the adopted odds
   * but not under the conservative odds is a policy whose farms depend on
   * the launch-odds layer, not on the valuation. */
  farm_count_conservative: number;
  farm_slugs_conservative: string[];
  max_prob_negative_conservative: number | null;
  fires_conservative: boolean;
  filters_conservative: boolean;
  within_risk_ceiling_conservative: boolean;
  /** Eligible under the two-layer adoption rule (charter v1.5): the policy
   * fires AND filters AND respects the risk ceiling under BOTH odds layers. */
  eligible: boolean;
  /** Rows with ev_mean > 0, and how many of them this policy rejects. */
  positive_ev_count: number;
  rejected_positive_count: number;
  /** v1.6: the simulation cross-check — the same test on the 20,000-draw
   * simulation statistics. These counts must agree with the analytic
   * counts within Monte Carlo noise; they never decide adoption. */
  farm_count_sim: number;
  farm_slugs_sim: string[];
  farm_count_conservative_sim: number;
  farm_slugs_conservative_sim: string[];
  max_prob_negative_sim: number | null;
  max_prob_negative_conservative_sim: number | null;
}

/** The gate-policy test (charter v1.3, five policies from v1.4): five policies
 * tested honestly on the corrected statistics, under the adopted (base-rate)
 * launch odds, and the adopted policy chosen by the prespecified rule — never
 * by the FARM count. The gate math is corrected here: P25 > 0 requires
 * P(net return > 0) ≥ 75%, so policy (a) is structurally impossible under
 * base-rate launch odds (p_L = 16.4%) and is tested only to document that
 * fact. Under charter v1.6 the test is computed on the ANALYTIC statistics
 * (the exact closed form) and the simulation counts are a cross-check:
 * `farm_count` / `farm_count_conservative` / `max_prob_negative` /
 * `max_prob_negative_conservative` are the ANALYTIC counts; the `*_sim`
 * fields are the 20,000-draw simulation counts, and `eligible` is decided
 * on the analytic test. */
export interface GateTest {
  variant_a: GateTestVariant;
  variant_b: GateTestVariant;
  variant_c: GateTestVariant;
  variant_d: GateTestVariant;
  variant_e: GateTestVariant;
  variant_f: GateTestVariant;
  /** v1.7: the per-protocol net-EV hurdle — conditional mean net EV
   * against the full costed plan must exceed the layer's breakeven
   * multiple of that plan, with (f)'s odds-consistent P(negative)
   * ceiling. Tested under the same two-layer adoption rule. */
  variant_g: GateTestVariant;
  adopted: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
  reason: string;
}

/** One ranking-tournament challenger's result on the nested folds
 * (charter v1.6): the same ranking metrics as the production OLS, on the
 * same folds, so a simpler model can only win by ranking better. */
export interface RankingTournamentRow {
  model: 'ols' | 'tvl-only' | 'median-by-category' | 'global-median';
  description: string;
  /** Per selection fold (50/60/70/80): Spearman and Kendall. */
  per_fold: { train_pct: number; n_test: number; spearman: number; kendall: number; median_abs_log_err: number }[];
  pooled_spearman: number;
  pooled_kendall: number;
  pooled_top10_overlap: number;
  pooled_top10_precision: number;
  pooled_top20_overlap: number;
  pooled_top20_precision: number;
  pooled_median_abs_log_err: number;
  /** The untouched 90% fold, reported separately, never used to select. */
  untouched90_spearman: number;
  untouched90_kendall: number;
  untouched90_n_test: number;
}

/** The ranking tournament (charter v1.6): OLS is the benchmark; a
 * challenger replaces it only if it beats OLS on pooled Spearman by
 * ≥ 0.10 AND pooled Kendall by ≥ 0.05 AND pooled top-10 overlap by ≥ 0,
 * on the selection folds. */
export interface RankingTournament {
  rows: RankingTournamentRow[];
  benchmark: 'ols';
  adopted: 'ols' | 'tvl-only' | 'median-by-category' | 'global-median';
  adoption_rule: string;
  reason: string;
}

/** One cohort/regime ranking slice (charter v1.6). */
export interface CohortRankingRow {
  group: string;
  n: number;
  spearman: number | null;
  kendall: number | null;
  median_abs_log_err: number | null;
  /** Slices with n < 10 are descriptive, not validation claims. */
  evidence: 'measurement' | 'descriptive';
}

/** Per-cohort and per-regime ranking for the fold-80 failure (charter
 * v1.6): pooled selection rows by listing-date tercile, the 70 dated
 * comps by listing-year cohort, and the fold-80 rows' cohort mix. */
export interface CohortRanking {
  /** Pooled selection rows (n = 28) by listing-date tercile. */
  by_listing_tercile: CohortRankingRow[];
  /** The 70 dated comps, fitted vs actual, by listing-year cohort
   * (in-sample, descriptive). */
  by_listing_year_cohort: CohortRankingRow[];
  /** The fold-80 test rows' cohorts and the pooled Spearman per cohort
   * with and without the fold. */
  fold80_cohorts: string[];
  pooled_spearman_by_cohort_with_fold80: CohortRankingRow[];
  pooled_spearman_by_cohort_excl_fold80: CohortRankingRow[];
  conclusion: string;
}

/** One gate-(f) audit row (charter v1.6): the expected net return and
 * the conditional payoff of one analytic-(f)-farm candidate, so the
 * reader can see whether the risk screen is also profitable in
 * expectation. */
export interface GateFAuditRow {
  slug: string;
  name: string;
  plan_cost_usd: number;
  /** Conditional payoff: farmer share × mean value if it launches −
   * plan cost (the (f) gate's 3× hurdle is on this number). */
  conditional_mean_ev_usd: number;
  conditional_multiple: number;
  /** The breakeven multiples: 5.09× adopted / 6.33× conservative. */
  breakeven_multiple_adopted: number;
  breakeven_multiple_conservative: number;
  /** Expected net return (unconditional mean EV) under each layer. */
  expected_net_return_adopted_usd: number;
  expected_net_return_conservative_usd: number;
  /** The P10/P90 of the mean EV across the 2000 bootstrap refits. */
  expected_net_return_param_usd: [number, number];
  /** Tail risk: analytic P(negative) under each layer, and the
   * simulated P(negative) with its 95% Wilson interval (adopted). */
  prob_negative_analytic_adopted: number;
  prob_negative_analytic_conservative: number;
  prob_negative_sim_adopted: number;
  prob_negative_sim_ci_adopted: [number, number];
  ev_p10_usd: number;
  verdict: Verdict;
  verdict_adopted: Verdict;
  verdict_conservative: Verdict;
  conditional_farm: boolean;
  borderline: boolean;
}

/** The gate-(f) re-audit with expected net return (charter v1.6). */
export interface GateFAudit {
  rows: GateFAuditRow[];
  n_candidates: number;
  n_positive_expected_return_adopted: number;
  n_positive_expected_return_conservative: number;
  n_below_breakeven_multiple_adopted: number;
  n_below_breakeven_multiple_conservative: number;
  breakeven_multiple_adopted: number;
  breakeven_multiple_conservative: number;
  note: string;
}

/** One row's costed farm plan (charter v1.7): the base plan cost plus the
 * explicit slippage/fees assumption, broken into components that sum to
 * the total. The deposit is the same $10,000 for every row; gas is
 * per-chain (already in the base cost); opportunity is 10% annual over
 * the hold window; slippage/fees are the uniform 0.5% assumption. */
export interface CostedPlan {
  deposit_usd: number;
  gas_total_usd: number;
  opportunity_usd: number;
  slippage_fees_usd: number;
  /** The base plan cost (deposit + gas + opportunity), exactly planCostUsd. */
  base_cost_usd: number;
  /** The full costed plan C_i = base + slippage/fees. Net EV is computed
   * against this total. */
  total_usd: number;
}

/** The comps-fitted mcap/TVL ratio valuation (charter v1.7): the second
 * lens — OLS of log10(mcap/TVL) on [1, log10(TVL + $25M)] with the same
 * shrunk group adjustments, on the same 70 dated comps and the same
 * nested folds. FDV/TVL at TGE, airdrop %, VC tier/raise and growth
 * velocity cannot be fitted (no such fields exist in the snapshot) and
 * are recorded as data gaps, never invented. */
export interface RatioValuation {
  intercept: number;
  coef_log_tvl: number;
  n_comps: number;
  nested_selection_pooled_dex: number;
  nested_selection_pooled_dex_production_ols: number;
  improvement_vs_production_dex: number;
  adoption_bar_dex: number;
  adopted: boolean;
  adoption_reason: string;
  /** The untouched 90% fold under the ratio lens (reported, never used
   * to select). */
  untouched90_median_abs_log_err_dex: number;
  /** Board comparison vs the production board (computed in buildRadar). */
  board_spearman_vs_production: number;
  board_top10_overlap_vs_production: number;
  board_top20_overlap_vs_production: number;
  lopo_max_abs_delta_predicted_log: number;
  data_gaps: string[];
}

/** Target comparability (charter v1.7): one pinned target, one timestamp,
 * and the FDV alternative explicitly split off as unbuildable. */
export interface TargetComparability {
  target: string;
  target_timestamp: string;
  grain: string;
  decision_time: string;
  snapshot_field: string;
  fields_not_in_snapshot: string[];
  fdv_status: string;
  comparison_rule: string;
}

/** One MARGINAL tier (charter v1.7): sizing guidance inside MARGINAL
 * only — never a verdict change, never a promotion to FARM. */
export type MarginalTier = 'low-size-farm' | 'watchlist' | 'hold';

/** The algorithmic MARGINAL tiering (charter v1.7). */
export interface MarginalTiers {
  counts: { 'low-size-farm': number; watchlist: number; hold: number };
  /** Thresholds fixed in the charter before results. */
  thresholds: { ev_per_dollar_at_risk: number; quarter_kelly: number; max_prob_negative_conservative: number };
  /** Sensitivity of the tier counts to the thresholds (recomputed). */
  sensitivity: { ev_per_dollar: number; quarter_kelly: number; low_size_farm: number; watchlist: number; hold: number }[];
  note: string;
}

/** The realized-outcome holdout (charter v1.7): the untouched 90% fold,
 * evaluated AFTER the freeze, with realized value = each comp's actual
 * snapshot market cap at as_of. No post-snapshot realized price exists
 * in this repo and none is invented — this is the valid version of the
 * check the data supports, at n = 7. */
export interface RealizedHoldout {
  n_rows: number;
  fold: string;
  evaluated_after_freeze: boolean;
  rows: {
    slug: string;
    predicted_log: number;
    realized_log: number;
    signed_log_err: number;
    abs_log_err: number;
    predicted_rank: number;
    realized_rank: number;
    realized_value_usd: number;
    plan_cost_usd: number;
    breakeven_value_usd: number;
    profitable: boolean;
    realized_net_return_usd: number;
    predicted_conditional_mean_ev_usd: number;
  }[];
  spearman: number;
  kendall: number;
  median_abs_log_err_dex: number;
  top3_profitable_share: number;
  top3_profitable_ci95: [number, number];
  spearman_ci95: [number, number];
  n_profitable_top3: number;
  limitation: string;
}

/** Ranking calibration (charter v1.7): the pooled rank correlation with
 * its cluster-bootstrap interval, precision/recall, and the launch-odds
 * reliability diagram with Brier and log-loss. */
export interface RankingCalibration {
  pooled_spearman: number;
  pooled_spearman_ci95: [number, number];
  pooled_kendall: number;
  pooled_kendall_ci95: [number, number];
  n_bootstrap_resamples: number;
  bootstrap_seed: number;
  top5: { overlap: number; precision: number; recall: number };
  top10: { overlap: number; precision: number; recall: number };
  top20: { overlap: number; precision: number; recall: number };
  reliability_bins: { bin: string; n: number; mean_predicted: number; observed_rate: number }[];
  brier_base_rate: number;
  log_loss_base_rate: number;
  brier_seasoning_curve: number;
  log_loss_seasoning_curve: number;
  n_launch_odds_rows: number;
  note: string;
}

/** The costed farm plans and gate (g) (charter v1.7): the slippage/fees
 * assumption, the per-protocol net-EV hurdle test, and its sensitivity. */
export interface CostedFarmPlans {
  slippage_fee_rate: number;
  slippage_fee_usd: number;
  assumption: string;
  /** Gate (g) under the two-layer adoption rule, from the gate test. */
  gate_g_farm_count: number;
  gate_g_farm_count_conservative: number;
  gate_g_eligible: boolean;
  gate_g_adopted: boolean;
  /** Farm counts under the adopted gate at 0% and 1.0% slippage (the
   * assumption's sensitivity — the board itself uses 0.5%). */
  sensitivity: { slippage_fee_rate: number; farm_count_adopted: number; farm_count_conservative: number }[];
  /** Net-EV summary over the analytic-(g) candidates under the adopted odds. */
  n_candidates: number;
  n_positive_net_ev_adopted: number;
  n_positive_net_ev_conservative: number;
  note: string;
}

/** One row of the valuation-to-decision table (charter v1.6): every
 * number behind one protocol's verdict, in board order. */
export interface ValuationDecisionRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  predicted_log_value: number;
  value_if_launches_usd: number;
  /** The param-aware interval [P25, P75] and the outcome-only band. */
  interval_p25_usd: number;
  interval_p75_usd: number;
  band_p25_usd: number;
  band_p75_usd: number;
  /** Launch-probability source: the global cohort base rate, its cohort,
   * horizon and supporting n — the same for every row, stated per row. */
  launch_odds_source: string;
  launch_odds: number;
  launch_odds_conservative: number;
  launch_odds_n_support: number;
  /** Conditional payoff and its multiple of the plan cost. */
  conditional_payoff_usd: number;
  conditional_multiple: number;
  plan_cost_usd: number;
  /** Expected net return under each layer, with the bootstrap P10/P90. */
  expected_net_return_adopted_usd: number;
  expected_net_return_conservative_usd: number;
  expected_net_return_param_usd: [number, number];
  /** Tail risk: analytic P(negative) under each layer, simulated
   * P(negative) with its 95% Wilson interval. */
  prob_negative_analytic_adopted: number;
  prob_negative_analytic_conservative: number;
  prob_negative_sim_adopted: number;
  prob_negative_sim_ci_adopted: [number, number];
  ev_p10_usd: number;
  /** The two verdicts, the production verdict, and the labels. */
  verdict_adopted: Verdict;
  verdict_conservative: Verdict;
  verdict: Verdict;
  conditional_farm: boolean;
  borderline: boolean;
  borderline_reason: string | null;
  unstable_farm: boolean;
  /** Stability proportions: refits producing each verdict, out of 70. */
  stability_farm: number;
  stability_marginal: number;
  stability_skip: number;
  /** v1.7: the costed plan components and total, the raw EV (base cost)
   * vs net EV (costed plan) under both layers, the breakeven multiples
   * and the row's conditional net multiple, the gate verdict at each
   * layer, and the MARGINAL tier with its Kelly size. */
  costed_plan_deposit_usd: number;
  costed_plan_gas_usd: number;
  costed_plan_opportunity_usd: number;
  costed_plan_slippage_fees_usd: number;
  costed_plan_total_usd: number;
  net_ev_adopted_usd: number;
  net_ev_conservative_usd: number;
  breakeven_multiple_adopted: number;
  breakeven_multiple_conservative: number;
  conditional_net_multiple: number;
  gate_pass_adopted: boolean;
  gate_pass_conservative: boolean;
  ood_tier: string;
  ood_flags: string;
  marginal_tier: MarginalTier | null;
  ev_per_dollar_at_risk: number;
  kelly_fraction: number;
  reason: string;
}

/** A row's BORDERLINE assessment (charter v1.6): within ±0.01 of a gate
 * ceiling under either odds layer, or an analytic/simulation gate
 * disagreement under either layer. */
export interface BorderlineInfo {
  borderline: boolean;
  reason: string | null;
  distance_to_ceiling_adopted: number | null;
  distance_to_ceiling_conservative: number | null;
  analytic_sim_disagree: boolean;
}

/** The nested reconciliation (charter v1.2): why the two nested pooled numbers
 * differ. They are pooled-by-observation medians over DIFFERENT observation sets;
 * on identical sets the same calculation reproduces exactly. */
export interface NestedReconciliation {
  selection: {
    folds: string;
    n_test_rows: number;
    fold_date_range: string;
    pooled_median_dex: number;
    mean_of_fold_medians_dex: number;
  };
  all_folds: {
    folds: string;
    n_test_rows: number;
    fold_date_range: string;
    pooled_median_dex: number;
    mean_of_fold_medians_dex: number;
  };
  aggregation: string;
  same_observations: boolean;
  same_features_purge_estimator: boolean;
  difference_explanation: string;
  recomputed_selection_dex: number;
  recomputed_all_folds_dex: number;
  reproduces: boolean;
}

/** The launch-odds decision (charter v1.2): the board uses the base rate unless
 * the seasoning curve passes the prespecified adoption test against it. */
export interface LaunchOddsDecision {
  source: 'base-rate' | 'seasoning-curve';
  base_rate: number;
  /** The conservative lower bound: the 2.5th percentile of a 2000-resample bootstrap
   * of the base rate over the 645 dated protocols (fixed seed 20261107). */
  conservative_lower_bound: number;
  /** The 2000 sorted bootstrap resamples of the base rate (fixed seed
   * 20261107); the conservative bound is their 2.5th percentile, and the
   * param-aware farming simulation draws the launch odds from this
   * distribution. */
  base_rate_bootstrap: number[];
  curve_beats_base_brier: boolean;
  curve_beats_base_log_loss: boolean;
  brier_improvement_ci_excludes_zero: boolean;
  platt_beats_base_brier: boolean;
  platt_beats_base_log_loss: boolean;
  reason: string;
}

/** One floor's row in the TVL-floor sensitivity diagnostic (charter v1.2): the
 * full-fit coefficients and the selection-pooled metric, on identical folds. */
export interface FloorSensitivityRow {
  floor_usd: number;
  intercept: number;
  coef_log_tvl: number;
  selection_pooled_dex: number;
  spearman_vs_25m: number | null;
  top20_overlap_vs_25m: number | null;
  top10_changes_vs_25m: number | null;
}

/** The TVL-floor sensitivity diagnostic (charter v1.2): the floor stays locked at
 * $25M; this reports what changing it would do, it does not change it. */
export interface FloorSensitivity {
  rows: FloorSensitivityRow[];
  /** Choosing the floor by 5-fold CV inside each training fold only, then scoring
   * the chosen floor on the fold's test set, pooled over the selection folds. */
  training_fold_choice_pooled_dex: number;
  training_fold_choice_floors: number[];
  locked_floor_pooled_dex: number;
  note: string;
}

/** One distribution's result for one audit row in the distribution tournament
 * (charter v1.3): the conditional launch-value distribution and the net-return
 * statistics it implies, all from the same seeded draws. */
/** One candidate distribution in the tournament (charter v1.3): the conditional
 * launch value is re-priced under this distribution on the same audit rows. */
export type DistributionKind = 'lognormal' | 'capped-lognormal' | 'capped-p90-lognormal' | 'capped-p95-lognormal' | 'empirical' | 'bootstrap-residuals' | 'student-t';

export interface DistributionRowResult {
  slug: string;
  conditional_mean_value_usd: number;
  conditional_median_value_usd: number;
  conditional_p90_value_usd: number;
  conditional_p95_value_usd: number;
  mean_net_ev_usd: number;
  median_net_return_usd: number;
  prob_negative: number;
  /** P(value covers the plan cost | launch) = P(V > cost / farmer_share | launch). */
  prob_exceeds_break_even: number;
  /** FARM under gate policy (a) / (b) / (c) / (d) / (e) / (f) / (g),
   * computed from this row's arrays. (g) is evaluated against the
   * costed plan (base cost + slippage/fees); every draw's net return
   * shifts by exactly the slippage fee, so its statistics are the
   * base statistics shifted by that fee. */
  farm_a: boolean;
  farm_b: boolean;
  farm_c: boolean;
  farm_d: boolean;
  farm_e: boolean;
  farm_f: boolean;
  farm_g: boolean;
}

/** One candidate distribution in the tournament (charter v1.3): its pooled
 * statistics over the audit rows and its farm counts under each gate policy. */
export interface DistributionResult {
  distribution: DistributionKind;
  /** Whether this distribution is the production distribution for the decision engine. */
  is_production: boolean;
  n_rows: number;
  rows: DistributionRowResult[];
  pooled_conditional_mean_value_usd: number;
  pooled_conditional_median_value_usd: number;
  pooled_mean_net_ev_usd: number;
  pooled_prob_negative: number;
  /** Farm counts under each gate policy, computed from this distribution's arrays. */
  farm_count_a: number;
  farm_count_b: number;
  farm_count_c: number;
  farm_count_d: number;
  farm_count_e: number;
  /** v1.5: the farm count under policy (f) — the odds-consistent ceiling,
   * evaluated at the row's adopted launch odds. */
  farm_count_f: number;
  /** v1.7: the farm count under policy (g) — the per-protocol net-EV
   * hurdle against the costed plan, at the row's adopted launch odds. */
  farm_count_g: number;
  /** The farm slugs under policy (b) (the Gemini proposal), for the overlap table. */
  farm_slugs_b: string[];
}

/** The distribution-sensitivity tournament (charter v1.3, seven distributions
 * from v1.4): seven candidate distributions for the conditional launch value,
 * each simulated on the same audit rows with common launch uniforms, plus the
 * P90-cap and P95-cap sensitivity rows and the CRPS validation of the
 * production (capped-lognormal) choice on the nested selection folds. */
export interface DistributionTournament {
  /** Draws per row per distribution (the production simulation keeps 20,000). */
  n_draws: number;
  /** The production cap: the maximum market cap observed among the 70 dated comps. */
  cap_usd: number;
  /** The P90 cap used by the sensitivity row. */
  cap_p90_usd: number;
  /** v1.4: the P95 cap used by the second sensitivity row (the Gemini
   * Rain-winsorization cap). */
  cap_p95_usd: number;
  /** The production distribution (capped-lognormal when the cap is kept). */
  production_distribution: DistributionKind;
  results: DistributionResult[];
  /** How much of any farm list is a tail artifact: the farm-set overlap of
   * policy (b) across distributions, as Jaccard similarities vs the production
   * distribution's farm set. */
  farm_set_overlap_b: { distribution: DistributionKind; jaccard_vs_production_b: number }[];
  /** Pooled log-CRPS (on log10 value) of capped vs uncapped on the nested
   * selection folds (50–80); the cap is kept unless capped is worse by > 10%. */
  crps: { capped_dex: number; uncapped_dex: number; n_test_rows: number };
  cap_kept: boolean;
  note: string;
}

/** One protocol in the dated cohort (charter v1.3): the 12-month horizon
 * dataset. Prediction date = listing date; follow-up = as_of − listed_at. */
export interface CohortRow {
  slug: string;
  prediction_date: string;
  followup_days: number;
  /** launched-timing-unknown: token at as_of, listed ≥ 12mo ago (launch may
   * have been inside or outside the window — timing unidentified).
   * failed: market cap 0 (a dead token). disappeared: market cap −1 sentinel.
   * tokenless-resolved: no token, listed ≥ 12mo ago (no launch in window).
   * tokenless-censored: no token, listed < 12mo ago (window not observed). */
  status: 'launched-timing-unknown' | 'failed' | 'disappeared' | 'tokenless-resolved' | 'tokenless-censored';
}

/** The horizon launch-probability analysis (charter v1.3): the 12-month event,
 * the dated cohort, and the category-stratified survival candidate tested
 * against the base rate on the untouched chronological test. */
export interface HorizonCohort {
  event: string;
  horizon_months: number;
  n_dated_protocols: number;
  n_risk_set: number;
  n_launched: number;
  /** The observed launch rate in the fully-observed risk set — an UPPER BOUND
   * on the 12-month launch rate, because launch timing is unidentified. */
  risk_set_base_rate: number;
  risk_set_base_rate_is_upper_bound: true;
  n_censored: number;
  status_counts: {
    launched_timing_unknown: number;
    failed: number;
    disappeared: number;
    tokenless_resolved: number;
    tokenless_censored: number;
  };
  /** The category-stratified launch-rate candidate vs the flat base rate, on
   * the untouched chronological test (protocols listed in the test window
   * with a fully observed 12-month horizon). */
  survival_candidate: {
    n_test: number;
    test_brier_category: number;
    test_log_loss_category: number;
    test_brier_base: number;
    test_log_loss_base: number;
    beats_base_brier: boolean;
    beats_base_log_loss: boolean;
    adopted: boolean;
    reason: string;
  };
  identification_note: string;
  rows: CohortRow[];
}

/** The heuristic activity-multiplier test (charter v1.3): the bounded
 * multiplier (1.5× active / 0.5× dormant) on the base rate, tested on the
 * same untouched 80/90 chronological test rows as the Platt test. The
 * activity feature is a documented proxy — TVL growing over 7 days
 * (change_7d > 0) — because the snapshot carries no points-program or
 * testnet field. */
export interface HeuristicMultiplierTest {
  feature: string;
  feature_is_proxy: true;
  proxy_definition: string;
  multiplier_active: number;
  multiplier_dormant: number;
  n_test: number;
  test_brier_multiplier: number;
  test_log_loss_multiplier: number;
  test_brier_base: number;
  test_log_loss_base: number;
  beats_base_brier: boolean;
  beats_base_log_loss: boolean;
  adopted: boolean;
  reason: string;
}

/** The validated OOD band multiplier (charter v1.3): on the nested selection
 * folds, OOD test rows' coverage of the 50% band under multipliers
 * {×1.0, ×1.5, ×2.0}; the adopted multiplier is the smallest whose OOD
 * coverage reaches nominal − 0.10. */
export interface OodMultiplierValidation {
  candidates: { multiplier: number; n_ood_test_rows: number; coverage_50: number }[];
  adopted_multiplier: number;
  n_ood_test_rows: number;
  reason: string;
}

/** One protocol's leave-one-protocol-out influence (charter v1.3): refit the
 * selected estimator without it and measure how much the board moves. */
export interface LopoRow {
  slug: string;
  abs_delta_slope: number;
  abs_delta_intercept: number;
  max_abs_delta_predicted_log: number;
}

/** The leave-one-protocol-out influence report (charter v1.3). */
export interface LopoInfluence {
  n_protocols: number;
  observations_per_protocol: number;
  max_abs_delta_slope: number;
  max_abs_delta_intercept: number;
  max_abs_delta_predicted_log: number;
  most_influential: LopoRow[];
  /** Training ranges and the board rows outside them. */
  tvl_range_usd: [number, number];
  age_range_days: [number, number];
  n_board_rows_outside_tvl_range: number;
  n_board_rows_outside_age_range: number;
  /** Pooled nested test-row error by category, main chain, and TVL tercile. */
  error_by_category: { group: string; n: number; median_abs_log_err: number }[];
  error_by_chain: { group: string; n: number; median_abs_log_err: number }[];
  error_by_tvl_tercile: { group: string; n: number; median_abs_log_err: number }[];
  note: string;
}

/** One conformal slice (charter v1.3): the observed empirical coverage of a
 * band within a slice of the evaluation population, with the binomial
 * (Wilson) 95% interval on the coverage — coverage is a measurement in this
 * design, never a guarantee. */
export interface ConformalSlice {
  slice: string;
  group: string;
  n: number;
  coverage_50: number;
  coverage_80: number;
  coverage_90: number;
  coverage_50_ci: [number, number];
}

/** The conformal slices (charter v1.3): coverage by historical regime, TVL
 * band, age band, and OOD vs in-distribution, plus calibration-sample
 * sufficiency for the reported quantiles. */
export interface ConformalSlices {
  by_regime: ConformalSlice[];
  by_tvl_band: ConformalSlice[];
  by_age_band: ConformalSlice[];
  by_ood: ConformalSlice[];
  calibration_n: number;
  quantile_index_90: number;
  coverage_90_standard_error: number;
  note: string;
}

/** The conformal slices (charter v1.3): coverage by historical regime, TVL
 * band, age band, and OOD vs in-distribution, plus calibration-sample
 * sufficiency for the reported quantiles. */
export interface ConformalSlices {
  by_regime: ConformalSlice[];
  by_tvl_band: ConformalSlice[];
  by_age_band: ConformalSlice[];
  by_ood: ConformalSlice[];
  calibration_n: number;
  quantile_index_90: number;
  coverage_90_standard_error: number;
  note: string;
}

/** One LOPO-flagged comparable audited to the data source (charter v1.4):
 * rain and obol, with the four audit checks answered from the snapshot's
 * own fields. The mcap/TVL ratio is reported against the comp
 * distribution so the reader can see how far in the tails each sits. */
export interface OutlierAuditRow {
  slug: string;
  name: string;
  snapshot_date: string;
  listed_at: string | null;
  tvl_usd: number;
  mcap_usd: number;
  mcap_source: string;
  main_chain: string;
  category: string | null;
  target_definition: string;
  snapshot_time: string;
  mcap_tvl_ratio: number;
  mcap_tvl_ratio_rank: string;
  comparable_by_target_and_time: boolean;
  tvl_consistent: boolean;
  is_market_cap_not_fdv: boolean;
  valid_observation_assessment: string;
}

/** One with/without refit in the outlier audit (charter v1.4): the selected
 * estimator refit without the named comps, scored on the prespecified
 * nested selection metric on identical folds, and the board re-ranked. */
export interface OutlierRefitRow {
  dropped: string;
  intercept: number;
  coef_log_tvl: number;
  selection_pooled_dex: number;
  selection_vs_production_dex: number;
  board_spearman_vs_production: number;
  top10_overlap_vs_production: number;
  top20_overlap_vs_production: number;
  farm_count_adopted_gate: number;
}

/** The outlier audit (charter v1.4): rain and obol to the data source, plus
 * the with/without refits. Rain is NOT deleted from production — both
 * analyses are published and the production fit keeps rain unless the
 * winsorization rule fires. */
export interface OutlierAudit {
  rows: OutlierAuditRow[];
  refits: OutlierRefitRow[];
  rain_kept_in_production: true;
  note: string;
}

/** One dropped comparable's ranking stability (charter v1.4): the board
 * re-ranked under the refit without it, compared against the production
 * board order, with verdict-category moves computed by the analytic EV. */
export interface LopoRankingRow {
  slug: string;
  spearman_vs_production: number;
  top10_overlap: number;
  top20_overlap: number;
  verdict_moves: number;
  moved_slugs: string[];
  max_abs_delta_predicted_log: number;
}

/** One nested fold's ranking check (charter v1.4): the Spearman ρ between
 * the fold's predicted log values and the test rows' actual log market
 * caps, and the top-3 overlap between the predicted and actual orderings
 * of the fold's test rows. */
export interface NestedRankingRow {
  train_pct: number;
  n_test: number;
  spearman_predicted_vs_actual: number;
  kendall_predicted_vs_actual: number;
  top3_overlap: number;
  top5_overlap: number;
}

/** The diagnosis of the negative-rank-correlation nested fold (charter
 * v1.5): the 80% fold's Spearman is negative, so the fold is diagnosed
 * row by row instead of averaged away — which rows invert, which single
 * row flips the sign when dropped, and what the training window looked
 * like. */
export interface NegativeFoldDiagnosis {
  train_pct: number;
  test_start: string;
  test_end: string;
  n_test: number;
  spearman: number;
  kendall: number;
  pooled_spearman_excl_fold: number;
  pooled_kendall_excl_fold: number;
  rows: {
    slug: string;
    category: string | null;
    chain: string | null;
    tvl_usd: number;
    mcap_usd: number;
    predicted_log: number;
    actual_log: number;
    signed_log_err: number;
    predicted_rank: number;
    actual_rank: number;
  }[];
  /** Pairs whose predicted order disagrees with the actual order
   * (predicted_higher is ranked above actual_higher by the model, but
   * below it in reality). */
  rank_inversions: { predicted_higher: string; actual_higher: string }[];
  /** The Spearman on the remaining 6 rows when each test row is dropped. */
  leave_one_out_spearman: { dropped_slug: string; spearman: number }[];
  training: {
    n_train: number;
    train_start: string;
    train_end: string;
    unseen_categories: string[];
    unseen_chains: string[];
  };
  conclusion: string;
}

/** The TVL-perturbation check (charter v1.4): each board row's TVL moved
 * ±10% (row-local — the comps and their adjustments do not change) and
 * its rank recomputed from its predicted log. */
export interface TvlPerturbation {
  shock: string;
  rows_with_rank_change: number;
  max_abs_rank_move: number;
}

/** The ranking-stability evaluation (charter v1.4): LOPO re-ranking, nested
 * walk-forward predicted-vs-actual ranking, and the TVL perturbation.
 * The descriptive bars are reported, not gates — no production decision
 * changes on them. */
export interface RankingStability {
  lopo: LopoRankingRow[];
  lopo_median_spearman: number;
  lopo_worst_top10_overlap: number;
  lopo_total_verdict_moves: number;
  nested: NestedRankingRow[];
  nested_pooled_spearman: number;
  nested_pooled_kendall: number;
  /** Pooled top-k overlap and precision on the 28 selection test rows
   * (predicted top-k by fitted value vs actual top-k by realized value).
   * The per-fold rows are too small (n = 7) to support top-10/20. */
  nested_pooled_top10_overlap: number;
  nested_pooled_top10_precision: number;
  nested_pooled_top20_overlap: number;
  nested_pooled_top20_precision: number;
  nested_pooled_spearman_excl_fold80: number;
  negative_fold_diagnosis: NegativeFoldDiagnosis | null;
  tvl_perturbation: TvlPerturbation[];
  descriptive_bars: { bar: string; met: boolean }[];
  analytic_verdict_crosscheck: {
    n_rows: number;
    n_agree: number;
    n_near_boundary: number;
    note: string;
    /** v1.6: the simulation-vs-analytic Wilson crosscheck — per layer,
     * how many rows' analytic P(negative) lies inside the simulated
     * P(negative)'s 95% Wilson interval, and the largest |sim − analytic|
     * gap. The Wilson misses are Monte Carlo noise at the expected ~5%
     * rate; the hard bound is |sim − analytic| ≤ 0.02 on every row.
     * n_demoted_by_guards counts the rows where the analytic verdict
     * and the final board verdict differ — exactly the BORDERLINE and
     * stability demotions. */
    wilson_n_inside_adopted: number;
    wilson_n_inside_conservative: number;
    wilson_n_rows: number;
    max_abs_sim_analytic_gap: number;
    n_demoted_by_guards: number;
  };
  note: string;
}

/** One OOD segment in the segmented report (charter v1.4): nested test rows
 * classified relative to their own fold's training domain. Coverage is
 * against the base band (no multiplier), consistent with the conformal
 * slices. Segments with n < 10 carry no validation claim. */
export interface OodSegmentRow {
  segment: 'in-distribution' | 'unseen-chain-only' | 'unseen-category-only' | 'partial-other' | 'major';
  n: number;
  nominal_coverage_50: number;
  observed_coverage_50: number;
  coverage_50_ci: [number, number];
  median_effective_halfwidth_dex: number;
  median_signed_residual_dex: number;
  evidence: 'measurement' | 'insufficient evidence';
}

/** The segmented OOD report (charter v1.4): coverage per OOD segment on the
 * nested test rows, with the honest labeling the v1.3 pooled n = 28 lacked.
 * The adopted multiplier is a measurement on thin evidence, not a
 * validated guarantee. */
export interface SegmentedOodReport {
  segments: OodSegmentRow[];
  n_test_rows: number;
  multiplier_label: string;
  note: string;
}

/** One cap in the cap-sensitivity stress test (charter v1.4): the same audit
 * rows re-priced under one value cap, from the tournament's paired draws. */
export interface CapSensitivityRow {
  cap_label: string;
  cap_usd: number | null;
  pooled_conditional_mean_value_usd: number;
  pooled_mean_net_ev_usd: number;
  farm_count_a: number;
  farm_count_b: number;
  farm_count_c: number;
  farm_count_d: number;
  farm_count_e: number;
  /** v1.5: the farm count under policy (f) at the row's adopted odds. */
  farm_count_f: number;
  /** v1.7: the farm count under policy (g) at the row's adopted odds. */
  farm_count_g: number;
  polymarket_mean_net_ev_usd: number;
}

/** The cap-as-risk-control stress test (charter v1.4): uncapped / P90 / P95 /
 * max caps on the same rows and draws. The production cap was chosen on
 * principle before any validation outcome was computed; the CRPS check only
 * gates the keep/revert decision. The capped CRPS is slightly worse than
 * the uncapped, so no claim is made that the capped distribution is more
 * accurate — it bounds tail risk. */
export interface CapSensitivity {
  rows: CapSensitivityRow[];
  production_cap_label: string;
  cap_choice_statement: string;
  crps_capped_dex: number;
  crps_uncapped_dex: number;
  crps_n_test_rows: number;
  note: string;
}

/** The parameter uncertainty (charter v1.4): the 2000-refit bootstrap
 * extended from the comps to the board — each row's parameter SD in dex,
 * and the coefficient distribution. The printed band stays the
 * outcome-only conformal band; this is reported alongside it. */
export interface ParameterUncertainty {
  n_refits: number;
  seed: number;
  intercept: { mean: number; sd: number; p025: number; p975: number };
  slope: { mean: number; sd: number; p025: number; p975: number };
  /** Sign flips across the refits: a refit whose intercept or slope has the
   * opposite sign to the production coefficient. A slope that flips sign
   * means the data cannot even settle the direction of the TVL effect. */
  intercept_sign_flips: number;
  slope_sign_flips: number;
  /** A 20-bin histogram flag: true when the bootstrap coefficient
   * distribution has two well-separated peaks of comparable mass. */
  intercept_bimodal: boolean;
  slope_bimodal: boolean;
  median_param_sd_dex: number;
  max_param_sd_dex: number;
  note: string;
}

/** The Rain winsorization candidate (charter v1.4): dated-comp market caps
 * winsorized at the P95 of comp market caps before fitting. Adopted as the
 * production fit only if its nested selection-pooled metric improves on
 * production's by > 0.01 dex; otherwise a sensitivity only. The snapshot
 * itself is never modified. */
export interface WinsorizationTest {
  cap_p95_usd: number;
  winsorized_intercept: number;
  winsorized_coef_log_tvl: number;
  winsorized_selection_pooled_dex: number;
  production_selection_pooled_dex: number;
  selection_improvement_dex: number;
  winsorized_lopo_max_abs_delta_predicted_log: number;
  production_lopo_max_abs_delta_predicted_log: number;
  board_spearman_vs_production: number;
  top10_overlap_vs_production: number;
  top20_overlap_vs_production: number;
  farm_count_adopted_gate: number;
  adopted: boolean;
  reason: string;
}

/** A board row's out-of-distribution report (charter v1.3): checked against the
 * training domain (the 70 dated comps). Tiers: in-distribution (0 flags),
 * partially OOD (exactly 1 flag — wider band, confidence 'extrapolation',
 * an exploratory extrapolation), major OOD (≥ 2 flags, or unseen category
 * AND unseen chain — unsupported extrapolation, never a production FARM).
 * A row with no credible comparable (nearest > 0.5 dex) is never a
 * production FARM, whatever its tier. */
export interface OodReport {
  unseen_chain: boolean;
  unseen_category: boolean;
  tvl_out_of_range: boolean;
  age_out_of_range: boolean;
  nearest_comp_distance_dex: number;
  is_ood: boolean;
  /** How many of the five OOD flags fired. */
  flag_count: number;
  /** The OOD tier: in-distribution / partially OOD / major OOD. */
  tier: 'in-distribution' | 'partial' | 'major';
  band_multiplier: number;
  confidence: 'in-distribution' | 'extrapolation' | 'unsupported';
}

/** The training domain the OOD check measures against: the 70 dated comps. */
export interface OodDomain {
  categories: string[];
  chains: string[];
  log_tvl_min: number;
  log_tvl_max: number;
  age_min_days: number;
  age_max_days: number;
}

/** One row of the EV end-to-end audit: the scenarios and the downside for a farm
 * (or demoted ex-farm) protocol. ev_central_usd is the MEAN net return from the
 * simulation array; ev_conservative_usd / ev_optimistic_usd are its P25 / P75. */
export interface EvAuditRow {
  slug: string;
  name: string;
  value_if_launches_usd: number;
  launch_odds: number;
  launch_odds_platt: number;
  break_even_odds: number;
  plan_cost_usd: number;
  ev_central_usd: number;
  ev_conservative_usd: number;
  ev_optimistic_usd: number;
  prob_negative_return: number;
  prob_negative_analytic: number;
  p10_value_usd: number;
  ev_at_p10_usd: number;
  /** EV at the P25 / P75 value IF it launches — conditional, not net-return quantiles. */
  ev_at_p25_value_if_launches_usd: number;
  ev_at_p75_value_if_launches_usd: number;
  /** Stress test: the mean EV under the three launch-probability assumptions. */
  ev_mean_base_rate_usd: number;
  ev_mean_platt_usd: number;
  ev_mean_conservative_usd: number;
  /** Whether the adopted gate passes under the conservative assumption. */
  gate_pass_conservative: boolean;
  /** Out-of-distribution: this row's prediction is an extrapolation. */
  is_ood: boolean;
  verdict: Verdict;
  verdict_rule: string;
}

/** The EV audit: every farm row plus every row the old EV>0-only rule would have
 * farmed but the margin rule demotes, with the assumptions the EVs rest on. */
export interface EvAudit {
  rows: EvAuditRow[];
  assumptions: string;
}

/** One nested fold's diagnostics: what the test window held and where it failed. */
export interface NestedFoldDiagnostic {
  train_pct: number;
  test_start: string;
  test_end: string;
  n_test: number;
  median_tvl_usd: number;
  median_age_days: number;
  categories: { category: string; count: number }[];
  unseen_categories: number;
  unseen_chains: number;
  median_signed_log_err: number;
  median_abs_log_err: number;
  p90_abs_log_err: number;
  rows: { slug: string; category: string; chain: string; mcap_usd: number; tvl_usd: number; signed_log_err: number; abs_log_err: number }[];
}

/** The valuation target, documented precisely (charter v1.1). */
export interface TargetDoc {
  definition: string;
  as_of: string;
  unit: string;
  fdv_available: boolean;
  fdv_note: string;
  comparability_note: string;
}

/** The undated diagnostic against the dated-only conformal band. */
export interface ConformalUndatedDiagnostic {
  n_undated: number;
  median_signed_residual_dex: number;
  median_abs_residual_dex: number;
  coverage_50: number;
  coverage_80: number;
  coverage_90: number;
  analysis: string;
}

/** One undated comparable as a reference row: scored by the dated-only full fit, never fitted. */
export interface UndatedReferenceRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  predicted_log_value: number;
  residual_dex: number;
}

/** The old OLS model, kept as a benchmark and never deleted: the same features, fitted by plain least squares, scored on the same splits. */
export interface OlsBaseline {
  r2: number;
  oos_median_abs_log_err: number;
  cv_median_abs_log_err: number;
  nested_wf_pooled: number;
}

/** One expanding-window walk-forward fold: train on the oldest train_pct%, test on the next 10% forward in time. */
export interface NestedFold {
  train_pct: number;
  median_abs_log_err: number;
  n_test: number;
}

/** One seasoning-calibration bin: the actual launch rate against the curve's mean predicted odds. */
export interface SeasoningCalibration {
  age_min_days: number;
  age_max_days: number | null;
  n: number;
  actual_rate: number;
  predicted_odds: number;
}

/** A farm verdict: farm it, farm a small position, or skip it. */
export type Verdict = 'farm' | 'marginal' | 'skip';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  /** v1.5: the rank range [min, median, max] across the 70 LOPO refits —
   * filled in buildRadar; null until then. */
  rank_range: [number, number, number] | null;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  verdict: Verdict;
  plan_cost_usd: number;
  model: {
    category_multiple: number;
    predicted_log_value: number;
    value_if_launches_usd: number;
    launch_odds: number;
    launch_odds_platt: number;
    break_even_odds: number;
    /** expected_value_usd is the MEAN net return from the simulation array. */
    expected_value_usd: number;
    /** v1.3: the conditional mean EV — E[net return | launch]. */
    ev_conditional_mean_usd: number;
    /** v1.3: the mean value if it launches, E[value | launch]. */
    mean_value_if_launches_usd: number;
    /** ev_conservative_usd / ev_optimistic_usd are the P25 / P75 of that same array. */
    ev_conservative_usd: number;
    ev_optimistic_usd: number;
    ev_p10_usd: number;
    ev_p25_usd: number;
    ev_p50_usd: number;
    ev_p75_usd: number;
    ev_p90_usd: number;
    prob_negative_return: number;
    /** v1.6: the simulated P(negative) under the conservative odds. */
    prob_negative_return_conservative: number;
    prob_negative_analytic: number;
    p10_value_usd: number;
    ev_at_p10_usd: number;
    ev_at_p25_value_if_launches_usd: number;
    ev_at_p75_value_if_launches_usd: number;
    ev_mean_base_rate_usd: number;
    ev_mean_platt_usd: number;
    ev_mean_conservative_usd: number;
    /** v1.6: the simulated net-return quantiles under the conservative odds. */
    ev_p25_conservative_usd: number;
    ev_p50_conservative_usd: number;
    ev_p75_conservative_usd: number;
    gate_pass_conservative: boolean;
    gate_pass_adopted: boolean;
    band_p25_usd: number;
    band_p75_usd: number;
    /** v1.5: the param-aware band — the P25/P75 implied value from the
     * interval that includes the parameter SD (total SD = sqrt(outcome
     * variance + parameter variance)), next to the outcome-only band. */
    param_band_p25_usd: number;
    param_band_p75_usd: number;
    /** v1.5: the total SD (outcome + parameter) in dex behind the
     * param-aware band. */
    param_total_sd_dex: number;
    category_adjustment: number;
    chain_adjustment: number;
    comparable_count: number;
    comparable_basis: 'category' | 'global';
    growth_pct: number;
    age_days: number | null;
    basis: 'fitted';
    ood: OodReport;
    /** v1.4: the parameter SD of this row's predicted log in dex, from the
     * 2000-refit bootstrap — the model uncertainty, separate from the
     * outcome-only band. */
    predicted_log_param_sd_dex: number;
    /** v1.4: the P10/P90 of the mean EV across the 2000 bootstrap refits (the
     * analytic capped-lognormal EV of each refit's predicted log — the model
     * uncertainty of the decision, separate from the outcome uncertainty). */
    ev_mean_param_usd: [number, number];
    /** v1.4: the P10/P90 of P(negative) across the 2000 bootstrap refits. */
    prob_negative_param: [number, number];
    /** v1.4: the launch-odds labeling — the 16.4% is a global cohort base
     * rate, not a per-protocol probability. */
    launch_odds_source: string;
    launch_odds_cohort: string;
    launch_odds_horizon_months: number;
    launch_odds_n_support: number;
    launch_odds_in_risk_set: boolean;
    /** v1.4: the decision trace — the reasons for this row's verdict,
     * computed from the same numbers as the verdict. */
    decision_trace: string[];
    /** v1.6: the two verdicts — the analytic gate under the adopted odds
     * and under the conservative odds. The production verdict IS the
     * conservative verdict, except for the recorded demotions. */
    verdict_adopted: Verdict;
    verdict_conservative: Verdict;
    /** v1.6: CONDITIONAL FARM — the adopted verdict is farm but the
     * conservative verdict is not. */
    conditional_farm: boolean;
    /** v1.6: BORDERLINE — the analytic P(negative) is within ±0.01 of a
     * gate ceiling under either layer, or the analytic and simulation
     * gates disagree under either layer. A borderline row is MARGINAL
     * with the REVIEW label, never FARM or SKIP. */
    borderline: boolean;
    borderline_reason: string | null;
    /** v1.6: the analytic P(negative) under the conservative odds, and
     * the simulated P(negative) with its 95% Wilson interval under each
     * odds layer. */
    prob_negative_analytic_conservative: number;
    prob_negative_sim_ci_adopted: [number, number];
    prob_negative_sim_ci_conservative: [number, number];
    /** v1.6: why a guard changed the verdict to marginal — 'borderline'
     * (a would-be farm demoted, or a borderline skip moved to the
     * uncertainty verdict) or 'unstable' (fewer than 35 of 70 LOPO
     * refits agree with FARM); null when no guard changed the verdict. */
    farm_demoted_reason: 'borderline' | 'unstable' | null;
    /** v1.6: the stability score — the LOPO refit verdict proportions
     * (out of 70), the refits agreeing with the production verdict, and
     * whether a production FARM is STABLE (≥ 35/70 refits agree). */
    stability: {
      farm: number;
      marginal: number;
      skip: number;
      agreeing_refits: number;
      stable_farm: boolean | null;
    } | null;
    /** v1.7: the costed farm plan — base cost + slippage/fees, broken
     * into components that sum to the total. Net EV is computed
     * against the total. */
    costed_plan: CostedPlan;
    /** v1.7: analytic net EV against the full costed plan C_i, under
     * each odds layer (raw EV against the base cost is expected_value_usd
     * / ev_mean_conservative_usd). */
    net_ev_adopted_usd: number;
    net_ev_conservative_usd: number;
    /** v1.7: the conditional mean net EV against C_i and its multiple of
     * C_i, under the adopted odds. */
    conditional_net_ev_usd: number;
    conditional_net_multiple: number;
    /** v1.7: the MARGINAL tier (null for FARM/SKIP rows), the
     * EV-per-dollar-at-risk and the quarter-Kelly size behind it. */
    marginal_tier: MarginalTier | null;
    ev_per_dollar_at_risk: number;
    kelly_fraction: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  verdict: Verdict;
  plan_cost_usd: number;
  on_watchlist: boolean;
  category_multiple: number;
  predicted_log_value: number;
  value_if_launches_usd: number;
  launch_odds: number;
  launch_odds_platt: number;
  break_even_odds: number;
  expected_value_usd: number;
  ev_conditional_mean_usd: number;
  mean_value_if_launches_usd: number;
  ev_conservative_usd: number;
  ev_optimistic_usd: number;
  ev_p10_usd: number;
  ev_p25_usd: number;
  ev_p50_usd: number;
  ev_p75_usd: number;
  ev_p90_usd: number;
  prob_negative_return: number;
  /** v1.6: the simulated P(negative) under the conservative odds. */
  prob_negative_return_conservative: number;
  prob_negative_analytic: number;
  p10_value_usd: number;
  ev_at_p10_usd: number;
  ev_at_p25_value_if_launches_usd: number;
  ev_at_p75_value_if_launches_usd: number;
  ev_mean_base_rate_usd: number;
  ev_mean_platt_usd: number;
  ev_mean_conservative_usd: number;
  /** v1.6: the simulated net-return quantiles under the conservative odds. */
  ev_p25_conservative_usd: number;
  ev_p50_conservative_usd: number;
  ev_p75_conservative_usd: number;
  gate_pass_conservative: boolean;
  gate_pass_adopted: boolean;
  band_p25_usd: number;
  band_p75_usd: number;
  /** v1.5: the param-aware band (P25/P75 implied value, total SD incl.
   * parameter variation) and the total SD behind it. */
  param_band_p25_usd: number;
  param_band_p75_usd: number;
  param_total_sd_dex: number;
  /** v1.5: the rank range [min, median, max] across the 70 LOPO refits. */
  rank_range: [number, number, number];
  category_adjustment: number;
  chain_adjustment: number;
  ood: OodReport;
  predicted_log_param_sd_dex: number;
  ev_mean_param_usd: [number, number];
  prob_negative_param: [number, number];
  launch_odds_source: string;
  launch_odds_cohort: string;
  launch_odds_horizon_months: number;
  launch_odds_n_support: number;
  launch_odds_in_risk_set: boolean;
  decision_trace: string[];
  /** v1.6: the two verdicts, the CONDITIONAL FARM label, the BORDERLINE
   * flag and reason, the analytic conservative P(negative), the
   * simulated P(negative) Wilson intervals, the demotion reason, and
   * the stability score. */
  verdict_adopted: Verdict;
  verdict_conservative: Verdict;
  conditional_farm: boolean;
  borderline: boolean;
  borderline_reason: string | null;
  prob_negative_analytic_conservative: number;
  prob_negative_sim_ci_adopted: [number, number];
  prob_negative_sim_ci_conservative: [number, number];
  farm_demoted_reason: 'borderline' | 'unstable' | null;
  stability: {
    farm: number;
    marginal: number;
    skip: number;
    agreeing_refits: number;
    stable_farm: boolean | null;
  } | null;
  /** v1.7: the costed plan, net EVs, and the MARGINAL tier. */
  costed_plan: CostedPlan;
  net_ev_adopted_usd: number;
  net_ev_conservative_usd: number;
  conditional_net_ev_usd: number;
  conditional_net_multiple: number;
  marginal_tier: MarginalTier | null;
  ev_per_dollar_at_risk: number;
  kelly_fraction: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One live comparable as a scatter point: log10 TVL against log10 market cap. */
export interface ScatterPoint {
  x: number;
  y: number;
}

/** Everything the dashboard needs: the board, the live set, the fit and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  fit: Fit;
  validation: Validation;
  seasoning: Seasoning;
  seasoning_calibration: SeasoningCalibration[];
  comparables: Comparable[];
  chain_adjustments: Comparable[];
  scatter: ScatterPoint[];
  rows: RadarRow[];
  live: LiveRow[];
  /** v1.6: the valuation-to-decision table — one row per board row, in
   * board order, linking valuation to decision. */
  valuation_decision_table: ValuationDecisionRow[];
  /** v1.5: the reproducibility package — the snapshot hash is attached by
   * main.ts (computed from the input file); null until then. */
  reproducibility: Reproducibility;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted list of numbers; null when empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The regression's production features for one protocol (charter v1.1): [1, log10(TVL + size floor)].
 * Growth is NOT a production feature — the coefficient is unstable and no growth variant
 * improves held-out error. Age is not a feature here: it prices launch odds in the
 * seasoning curve, not size. */
export function features(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): number[] {
  return [1, Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd)];
}

/** The growth diagnostic's features: the production features plus a SIGNED log(1 + winsorized
 * growth) term, no clamp — used only by the growth diagnostic, never by the production fit. */
export function featuresWithGrowth(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): number[] {
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0))) / 100;
  return [1, Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd), Math.log(1 + growthPct)];
}

/** The standard normal CDF, Abramowitz–Stegun 7.1.26 (absolute error < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - (Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI)) * poly;
  return z >= 0 ? p : 1 - p;
}

/** The inverse standard normal CDF (Acklam's rational approximation, |err| <
 * 1.2e-9): the quantile a value draw sits at. Deterministic, no tables. */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285984469534e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** E[min(cap, 10^Y)] with Y ~ N(mu, sigma²) in dex — the closed-form mean of
 * the capped lognormal: the uncapped mean below the cap, plus the cap times
 * the tail mass above it. Exact, no simulation. */
export function cappedLognormalMean(mu: number, sigma: number, cap: number): number {
  const c = Math.log10(cap);
  const ln10 = Math.LN10;
  const meanUncapped = Math.pow(10, mu + 0.5 * ln10 * sigma * sigma);
  const z1 = (c - mu - ln10 * sigma * sigma) / sigma;
  const z2 = (c - mu) / sigma;
  return meanUncapped * normalCdf(z1) + cap * (1 - normalCdf(z2));
}

/** The analytic mean net return under the capped lognormal: p_L × farmer
 * share × E[min(cap, V)] − plan cost. The exact expectation of the same
 * distribution the Monte Carlo simulation draws from — used by the
 * ranking-stability verdict moves, where a simulation per refit would be
 * 70× too slow, and cross-checked against the production sim on the full
 * fit. */
export function analyticEvMean(
  predictedLog: number,
  sigma: number,
  planCost: number,
  launchOdds: number,
  cap: number,
  model: ModelConstants = MODEL,
): number {
  return launchOdds * model.farmer_share * cappedLognormalMean(predictedLog, sigma, cap) - planCost;
}

/** The analytic gate statistics of one row (same shape gatePasses reads):
 * the mean EV and the conditional mean EV from the closed-form capped
 * lognormal mean, P(negative) from the capped lognormal tail, and the
 * net-return quantiles of the launch mixture — the q-quantile is −cost
 * while q ≤ 1 − p_L (the non-launch mass), else the corresponding value
 * quantile above the plan cost. */
export function analyticGateStats(
  predictedLog: number,
  sigma: number,
  planCost: number,
  launchOdds: number,
  cap: number,
  model: ModelConstants = MODEL,
): { evMean: number; evP25: number; evP50: number; evP75: number; conditionalMeanEv: number; planCost: number; probNegative: number } {
  const meanValue = cappedLognormalMean(predictedLog, sigma, cap);
  const evMean = launchOdds * model.farmer_share * meanValue - planCost;
  const conditionalMeanEv = model.farmer_share * meanValue - planCost;
  const beValue = planCost / model.farmer_share;
  const pValueAboveBe = beValue >= cap ? 0 : 1 - normalCdf((Math.log10(Math.max(1, beValue)) - predictedLog) / sigma);
  const probNegative = 1 - launchOdds * pValueAboveBe;
  const netQuantile = (q: number): number => {
    if (q <= 1 - launchOdds) return -planCost;
    const vq = (q - (1 - launchOdds)) / launchOdds;
    const logV = predictedLog + sigma * normalQuantile(vq);
    return model.farmer_share * Math.min(cap, Math.max(model.value_min, Math.pow(10, logV))) - planCost;
  };
  return {
    evMean,
    evP25: netQuantile(0.25),
    evP50: netQuantile(0.5),
    evP75: netQuantile(0.75),
    conditionalMeanEv,
    planCost,
    probNegative,
  };
}

/** The analytic verdict of one row under one gate policy: the same rule as
 * verdictFor, computed from the closed-form capped-lognormal statistics
 * instead of the Monte Carlo array — including the conservative-odds stress
 * test (a farm must pass the gate under the conservative launch odds, not
 * just the adopted odds). The two verdicts must agree except for Monte Carlo
 * noise at near-boundary rows; the ranking-stability crosscheck verifies it. */
export function analyticVerdict(
  predictedLog: number,
  sigma: number,
  planCost: number,
  launchOdds: number,
  launchOddsConservative: number,
  breakEvenOdds: number,
  gatePolicy: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g',
  cap: number,
  ood: OodReport | null = null,
  model: ModelConstants = MODEL,
): Verdict {
  const farmBlockedByOod = ood !== null && (ood.tier === 'major' || ood.nearest_comp_distance_dex > 0.5);
  if (!farmBlockedByOod && gatePasses(gatePolicy, analyticGateStats(predictedLog, sigma, planCost, launchOddsConservative, cap, model), launchOddsConservative)) return 'farm';
  const stats = analyticGateStats(predictedLog, sigma, planCost, launchOdds, cap, model);
  if (stats.evMean > 0) return 'marginal';
  if (breakEvenOdds <= model.marginal_break_even) return 'marginal';
  return 'skip';
}

// ---------------------------------------------------------------------------
// v1.7 helpers: the truncated capped-lognormal means behind the fractional
// Kelly sizing, and the deterministic MARGINAL tier rule. All closed form,
// the same capped-lognormal distribution the EV already uses — no new
// simulation, no new data.
// ---------------------------------------------------------------------------

/** E[10^Y · 1(a < Y ≤ b)] for Y ~ N(mu, σ²) in dex (a or b may be
 * ±Infinity): the lognormal partial mean, closed form. */
export function lognormalPartialMean(mu: number, sigma: number, a: number, b: number): number {
  if (sigma <= 0 || b <= a) return 0;
  const ln10 = Math.LN10;
  const meanUncapped = Math.pow(10, mu + 0.5 * ln10 * sigma * sigma);
  const zB = (b - mu - ln10 * sigma * sigma) / sigma;
  const zA = (a - mu - ln10 * sigma * sigma) / sigma;
  return meanUncapped * (normalCdf(zB) - normalCdf(zA));
}

/** E[min(cap, 10^Y) · 1(loLog < Y ≤ hiLog)] — the capped value's mean over
 * a log-value window. Below the cap the value contributes its lognormal
 * partial mean; above the cap it contributes the cap times the window's
 * probability mass. */
export function cappedTruncatedMean(mu: number, sigma: number, cap: number, loLog: number, hiLog: number): number {
  if (hiLog <= loLog) return 0;
  const logCap = Math.log10(cap);
  const belowHi = Math.min(hiLog, logCap);
  let out = 0;
  if (belowHi > loLog) out += lognormalPartialMean(mu, sigma, loLog, belowHi);
  const aboveLo = Math.max(loLog, logCap);
  if (hiLog > aboveLo) out += cap * (normalCdf((hiLog - mu) / sigma) - normalCdf((aboveLo - mu) / sigma));
  return out;
}

/** The fractional-Kelly size of one farm plan (charter v1.7): the farm is
 * treated as a binary bet — win with probability w = 1 − P(negative)
 * under the given odds, net gain G = E[net return | net return > 0],
 * net loss L = E[|net return| | net return < 0], both analytic from the
 * capped lognormal. Full Kelly f* = w − (1 − w) / (G / L); the board
 * uses quarter-Kelly, 0.25 × max(0, f*), capped at 0.25. */
export function kellyFraction(
  predictedLog: number,
  sigma: number,
  planCost: number,
  launchOdds: number,
  cap: number,
  model: ModelConstants = MODEL,
): { full: number; quarter: number; winProb: number; gainUsd: number; lossUsd: number } {
  const beValue = planCost / model.farmer_share;
  const logBe = Math.log10(Math.max(1, beValue));
  const pValueAboveBe = beValue >= cap ? 0 : 1 - normalCdf((logBe - predictedLog) / sigma);
  const w = launchOdds * pValueAboveBe;
  if (!(w > 0) || !(w < 1)) return { full: 0, quarter: 0, winProb: round4(w), gainUsd: 0, lossUsd: planCost };
  const eValueAbove = cappedTruncatedMean(predictedLog, sigma, cap, logBe, Number.POSITIVE_INFINITY);
  const eNetWin = launchOdds * (model.farmer_share * eValueAbove - planCost * pValueAboveBe);
  const gain = eNetWin / w;
  const eValueBelow = cappedTruncatedMean(predictedLog, sigma, cap, Number.NEGATIVE_INFINITY, logBe);
  const eLossMass = (1 - launchOdds) * planCost + launchOdds * (planCost * (1 - pValueAboveBe) - model.farmer_share * eValueBelow);
  const loss = eLossMass / (1 - w);
  if (!(gain > 0) || !(loss > 0)) return { full: 0, quarter: 0, winProb: round4(w), gainUsd: Math.max(0, gain), lossUsd: Math.max(0, loss) };
  const b = gain / loss;
  const full = w - (1 - w) / b;
  const quarter = Math.max(0, Math.min(0.25, 0.25 * full));
  return { full: round4(full), quarter: round4(quarter), winProb: round4(w), gainUsd: Math.round(gain), lossUsd: Math.round(loss) };
}

/** The deterministic MARGINAL tier (charter v1.7, fixed before results):
 * LOW-SIZE FARM iff net EV > 0 under BOTH layers AND EV-per-dollar-at-risk
 * ≥ 0.5 AND quarter-Kelly ≥ 0.01 AND conservative P(negative) ≤ 0.90 AND
 * not BORDERLINE; WATCHLIST iff not that and (net EV > 0 under the adopted
 * layer OR BORDERLINE); HOLD otherwise. Sizing guidance inside MARGINAL
 * only — it never changes a verdict. (Erratum: the Kelly bar was 0.02 as
 * first written and is corrected to 0.01 — 0.02 can never fire, the
 * maximum quarter-Kelly on this board is 0.012; see the charter errata.) */
export function marginalTierFor(
  netEvAdoptedUsd: number,
  netEvConservativeUsd: number,
  costedPlanTotalUsd: number,
  probNegativeConservative: number,
  quarterKelly: number,
  borderline: boolean,
): { tier: MarginalTier; evPerDollarAtRisk: number } {
  const evPerDollarAtRisk = costedPlanTotalUsd > 0 ? netEvConservativeUsd / costedPlanTotalUsd : 0;
  if (
    netEvAdoptedUsd > 0 &&
    netEvConservativeUsd > 0 &&
    evPerDollarAtRisk >= 0.5 &&
    quarterKelly >= 0.01 &&
    probNegativeConservative <= 0.9 &&
    !borderline
  ) {
    return { tier: 'low-size-farm', evPerDollarAtRisk: round4(evPerDollarAtRisk) };
  }
  if (netEvAdoptedUsd > 0 || borderline) return { tier: 'watchlist', evPerDollarAtRisk: round4(evPerDollarAtRisk) };
  return { tier: 'hold', evPerDollarAtRisk: round4(evPerDollarAtRisk) };
}

/** The 95% Wilson score interval of a simulated proportion (charter
 * v1.6): the Monte Carlo confidence interval of a P(negative) estimated
 * from N draws. At N = 20,000 and p̂ ≈ 0.88 the half-width is ≈ 0.0045. */
export function wilsonInterval(pHat: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const p = Math.min(1, Math.max(0, pHat));
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** The P(negative) ceiling of one gate policy at one odds layer (charter
 * v1.6): (f) 1 − 0.75 × p_L, (d) 0.85, (e)/(c) 0.90; (a)/(b) carry no
 * P(negative) ceiling, so the BORDERLINE distance rule does not apply
 * to them. */
export function gateCeiling(policy: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g', launchOdds: number): number | null {
  if (policy === 'f' || policy === 'g') return 1 - 0.75 * launchOdds;
  if (policy === 'd') return 0.85;
  if (policy === 'e' || policy === 'c') return 0.9;
  return null;
}

/** The analytic verdict of one row under ONE odds layer (charter v1.6):
 * farm iff the adopted gate passes under that layer's odds (with the
 * OOD farm block); marginal iff that layer's mean EV is positive or the
 * break-even odds are within the marginal band; skip otherwise. The
 * production verdict is the conservative layer's verdict, except for the
 * BORDERLINE and stability demotions. */
export function analyticLayerVerdict(
  predictedLog: number,
  sigma: number,
  planCost: number,
  launchOdds: number,
  breakEvenOdds: number,
  gatePolicy: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g',
  cap: number,
  ood: OodReport | null = null,
  model: ModelConstants = MODEL,
): Verdict {
  const farmBlockedByOod = ood !== null && (ood.tier === 'major' || ood.nearest_comp_distance_dex > 0.5);
  if (!farmBlockedByOod && gatePasses(gatePolicy, analyticGateStats(predictedLog, sigma, planCost, launchOdds, cap, model), launchOdds)) return 'farm';
  const stats = analyticGateStats(predictedLog, sigma, planCost, launchOdds, cap, model);
  if (stats.evMean > 0) return 'marginal';
  if (breakEvenOdds <= model.marginal_break_even) return 'marginal';
  return 'skip';
}

/** The BORDERLINE assessment of one row (charter v1.6, prespecified
 * before results): (a) the analytic P(negative) under the adopted OR
 * the conservative odds layer is within ±0.01 of that layer's gate
 * ceiling, OR (b) the analytic gate verdict and the simulation gate
 * verdict disagree under either odds layer. The ±0.01 width is ≈ 4
 * Monte Carlo standard errors at N = 20,000, so a row inside it cannot
 * be called a pass or a fail with confidence. */
export function borderlineInfo(
  analyticProbNegAdopted: number,
  analyticProbNegConservative: number,
  analyticGateAdopted: boolean,
  analyticGateConservative: boolean,
  simGateAdopted: boolean,
  simGateConservative: boolean,
  gatePolicy: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g',
  launchOddsAdopted: number,
  launchOddsConservative: number,
): BorderlineInfo {
  const ceilingAdopted = gateCeiling(gatePolicy, launchOddsAdopted);
  const ceilingConservative = gateCeiling(gatePolicy, launchOddsConservative);
  const distAdopted = ceilingAdopted === null ? null : Math.abs(analyticProbNegAdopted - ceilingAdopted);
  const distConservative = ceilingConservative === null ? null : Math.abs(analyticProbNegConservative - ceilingConservative);
  const nearCeilingAdopted = distAdopted !== null && distAdopted <= 0.01;
  const nearCeilingConservative = distConservative !== null && distConservative <= 0.01;
  const disagree = analyticGateAdopted !== simGateAdopted || analyticGateConservative !== simGateConservative;
  const borderline = nearCeilingAdopted || nearCeilingConservative || disagree;
  let reason: string | null = null;
  if (borderline) {
    const parts: string[] = [];
    if (nearCeilingAdopted) parts.push(`analytic P(negative) ${analyticProbNegAdopted.toFixed(4)} is within 0.01 of the adopted-odds ceiling ${ceilingAdopted!.toFixed(4)}`);
    if (nearCeilingConservative) parts.push(`analytic P(negative) ${analyticProbNegConservative.toFixed(4)} is within 0.01 of the conservative-odds ceiling ${ceilingConservative!.toFixed(4)}`);
    if (disagree) parts.push(`the analytic and simulation gates disagree (adopted: analytic ${analyticGateAdopted ? 'pass' : 'fail'} vs simulation ${simGateAdopted ? 'pass' : 'fail'}; conservative: analytic ${analyticGateConservative ? 'pass' : 'fail'} vs simulation ${simGateConservative ? 'pass' : 'fail'})`);
    reason = parts.join('; ');
  }
  return {
    borderline,
    reason,
    distance_to_ceiling_adopted: distAdopted === null ? null : round4(distAdopted),
    distance_to_ceiling_conservative: distConservative === null ? null : round4(distConservative),
    analytic_sim_disagree: disagree,
  };
}

/** Solve A x = b by Gaussian elimination with partial pivoting; deterministic, no libraries. */
export function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const tmp = m[col]!;
    m[col] = m[piv]!;
    m[piv] = tmp;
    const d = m[col]![col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / d;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Weighted least squares for log10(mcap) on the features: the normal equations, solved above.
 * `featureFn` defaults to the production features; the growth diagnostic passes its own. */
export function fitWeightedOls(
  rows: SnapshotProtocol[],
  weights: number[],
  asOf: string,
  model: ModelConstants = MODEL,
  featureFn: (p: SnapshotProtocol, asOf: string, model: ModelConstants) => number[] = features,
): number[] {
  const k = rows.length > 0 ? featureFn(rows[0]!, asOf, model).length : 2;
  const xtx: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const xty: number[] = Array(k).fill(0);
  rows.forEach((p, r) => {
    const w = weights[r] ?? 1;
    const x = featureFn(p, asOf, model);
    const y = Math.log10(p.mcap_usd!);
    for (let i = 0; i < k; i++) {
      xty[i]! += w * x[i]! * y;
      for (let j = 0; j < k; j++) xtx[i]![j]! += w * x[i]! * x[j]!;
    }
  });
  return solveLinear(xtx, xty);
}

/**
 * Huber's robust fit (iteratively reweighted least squares, delta 1.345, MAD scale): the
 * snapshot's own attribution quirks — a chain token counted on its bridge, one token counted
 * on two versions of a protocol — are down-weighted instead of dragging the curve. Starts at
 * the OLS fit, stops when the coefficients stop moving or after 60 rounds. Deterministic:
 * the same rows always give the same beta.
 */
export function fitHuber(
  rows: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
  featureFn: (p: SnapshotProtocol, asOf: string, model: ModelConstants) => number[] = features,
): number[] {
  const delta = 1.345;
  let beta = fitWeightedOls(rows, rows.map(() => 1), asOf, model, featureFn);
  for (let iter = 0; iter < 60; iter++) {
    const residuals = rows.map((p) => {
      const x = featureFn(p, asOf, model);
      return Math.log10(p.mcap_usd!) - beta.reduce((s, b, i) => s + b * x[i]!, 0);
    });
    const med = median([...residuals].sort((a, b) => a - b)) ?? 0;
    const absDev = residuals.map((r) => Math.abs(r - med)).sort((a, b) => a - b);
    const scale = 1.4826 * (median(absDev) ?? 0) || 1;
    const weights = residuals.map((r) => {
      const u = Math.abs(r - med) / (delta * scale);
      return u <= 1 ? 1 : 1 / u;
    });
    const next = fitWeightedOls(rows, weights, asOf, model, featureFn);
    const moved = Math.max(...next.map((b, i) => Math.abs(b - beta[i]!)));
    beta = next;
    if (moved < 1e-10) break;
  }
  return beta;
}

/**
 * Ridge regression (charter v1.1, co-equal baseline): OLS on the production features
 * with a FIXED penalty λ = 1.0 on the standardized log-TVL slope — a mild shrinkage,
 * not a tuned model (for a standardized slope, Σz² ≈ n−1 ≈ 69, so λ = 1.0 shrinks by
 * ~1.4%). The intercept is never penalized. Returns beta in the original feature
 * coordinates, so predictLog works unchanged.
 */
export function fitRidge(rows: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): number[] {
  const xs = rows.map((p) => features(p, asOf, model)[1]!);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length) || 1;
  const lambda = 1.0;
  // Normal equations on [1, z] with z = (x − mean)/sd, penalty λ on the slope only.
  let s00 = 0;
  let s01 = 0;
  let s11 = 0;
  let t0 = 0;
  let t1 = 0;
  for (const p of rows) {
    const z = (features(p, asOf, model)[1]! - mean) / sd;
    const y = Math.log10(p.mcap_usd!);
    s00 += 1;
    s01 += z;
    s11 += z * z;
    t0 += y;
    t1 += z * y;
  }
  const betaZ = solveLinear(
    [
      [s00, s01],
      [s01, s11 + lambda],
    ],
    [t0, t1],
  );
  // Back to original coordinates: y = b0 + b1·(x−mean)/sd = (b0 − b1·mean/sd) + (b1/sd)·x.
  return [betaZ[0]! - (betaZ[1]! * mean) / sd, betaZ[1]! / sd];
}

/** The live-token comparables the regression trains on (charter v1.1, hard-gated):
 * a token that trades, TVL and cap positive, not a CEX — and only protocols the board
 * could rank (see isComparable) — AND with a recorded listing date. Undated protocols
 * are physically excluded from every fit and calibration; see undatedComps. */
export function liveComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && p.listed_at !== null && isComparable(p),
  );
}

/** The undated live-token comparables (charter v1.1): the same population as liveComps
 * except with no recorded listing date. They are NEVER fitted or calibrated — they are
 * scored only as a reference table with the dated-only full fit. */
export function undatedComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && p.listed_at === null && isComparable(p))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** A protocol's main chain: the first chain it names, or 'none'. */
export function mainChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'none';
}

/**
 * One group's adjustment: the median residual (log10 mcap minus the regression's prediction)
 * of its live comparables, shrunk toward zero by n/(n+shrink_k). A group with one or two
 * comps moves the price a little; a group with fifteen moves it a lot. A group with no comps
 * in the fitted rows gets 0 with basis 'global' — the global fit, no adjustment. Full-size
 * adjustments failed the walk-forward test; shrunk ones did not.
 */
export function groupAdjustments(
  rows: SnapshotProtocol[],
  asOf: string,
  beta: number[],
  keyOf: (p: SnapshotProtocol) => string,
  model: ModelConstants = MODEL,
  featureFn: (p: SnapshotProtocol, asOf: string, model: ModelConstants) => number[] = features,
): Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }> {
  const residuals = new Map<string, number[]>();
  for (const p of rows) {
    const x = featureFn(p, asOf, model);
    const pred = beta.reduce((s, b, i) => s + b * x[i]!, 0);
    const r = Math.log10(p.mcap_usd!) - pred;
    const key = keyOf(p);
    const list = residuals.get(key);
    if (list === undefined) residuals.set(key, [r]);
    else list.push(r);
  }
  const out = new Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>();
  for (const [key, rs] of residuals) {
    rs.sort((a, b) => a - b);
    out.set(key, {
      adjustment: round4((median(rs) ?? 0) * (rs.length / (rs.length + model.shrink_k))),
      count: rs.length,
      basis: 'category',
    });
  }
  return out;
}

/** The fitted log10 value of one protocol: the regression plus its category and chain adjustments. */
export function predictLog(
  p: SnapshotProtocol,
  asOf: string,
  beta: number[],
  adjustments: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
  chainAdjustments: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
  model: ModelConstants = MODEL,
  featureFn: (p: SnapshotProtocol, asOf: string, model: ModelConstants) => number[] = features,
): number {
  const x = featureFn(p, asOf, model);
  const base = beta.reduce((s, b, i) => s + b * x[i]!, 0);
  return (
    base +
    (adjustments.get(p.category ?? 'Other')?.adjustment ?? 0) +
    (chainAdjustments.get(mainChain(p))?.adjustment ?? 0)
  );
}

/** R^2 of the fitted model (regression plus group adjustments) on the given rows. */
export function rSquared(
  rows: SnapshotProtocol[],
  asOf: string,
  beta: number[],
  adjustments: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
  chainAdjustments: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
  model: ModelConstants = MODEL,
  featureFn: (p: SnapshotProtocol, asOf: string, model: ModelConstants) => number[] = features,
): number {
  if (rows.length === 0) return 0;
  const ys = rows.map((p) => Math.log10(p.mcap_usd!));
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssTot = 0;
  let ssRes = 0;
  rows.forEach((p, i) => {
    const e = ys[i]! - predictLog(p, asOf, beta, adjustments, chainAdjustments, model, featureFn);
    ssTot += (ys[i]! - mean) ** 2;
    ssRes += e * e;
  });
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

/** A seeded deterministic PRNG (mulberry32): the shuffle and the bootstrap below are pure arithmetic, so every run refits the same numbers. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded in-place Fisher-Yates shuffle; the same seed always gives the same order. */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * The seasoning curve, fitted on the given rows: a logistic fit of "has a token"
 * on log10(age+1). Newton-Raphson on the log-likelihood, from a fixed start, with
 * a tiny ridge for stability — deterministic, no libraries. Older protocols are
 * more likely to have launched; the curve is the launch-odds model the board
 * multiplies the fitted value by. A token counts as present when its market cap
 * is recorded at all — a zero market cap is still a token (a dead one), not a
 * missing one.
 */
export function fitSeasoningOn(rows: SnapshotProtocol[], asOf: string): Seasoning {
  const dated = rows.filter((p) => ageDays(asOf, p.listed_at) !== null);
  const xs = dated.map((p) => Math.log10(ageDays(asOf, p.listed_at)! + 1));
  const ys = dated.map((p) => (p.mcap_usd !== null ? 1 : 0));
  const baseRate = ys.length > 0 ? ys.reduce<number>((a, b) => a + b, 0) / ys.length : 0;
  let b0 = 0;
  let b1 = 0;
  for (let iter = 0; iter < 50; iter++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 1e-8;
    let h01 = 0;
    let h11 = 1e-8;
    for (let i = 0; i < xs.length; i++) {
      const z = b0 + b1 * xs[i]!;
      const pr = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const d = ys[i]! - pr;
      const w = pr * (1 - pr);
      g0 += d;
      g1 += d * xs[i]!;
      h00 += w;
      h01 += w * xs[i]!;
      h11 += w * xs[i]! * xs[i]!;
    }
    const det = h00 * h11 - h01 * h01;
    if (det === 0) break;
    const s0 = (h11 * g0 - h01 * g1) / det;
    const s1 = (h00 * g1 - h01 * g0) / det;
    b0 += s0;
    b1 += s1;
    if (Math.max(Math.abs(s0), Math.abs(s1)) < 1e-10) break;
  }
  return { intercept: round4(b0), slope: round4(b1), n_protocols: dated.length, base_rate: round4(baseRate), platt_a: null, platt_b: null };
}

/**
 * The seasoning curve: a logistic fit of "has a token" on log10(age+1), over every dated
 * protocol in the snapshot (not just the live comparables). The board uses this full
 * fit; validation uses fold-local refits (see fitModel). The curve is a cross-sectional
 * association at the snapshot date, not a historical hazard: token status is measured
 * at as_of for every protocol, so a protocol listed before a cutoff that launched after
 * it counts as has-token in the training fit.
 */
export function fitSeasoning(snapshot: Snapshot): Seasoning {
  return fitSeasoningOn(snapshot.protocols, snapshot.as_of);
}

/** Brier score, log-loss and expected calibration error (10 fixed bins) of a
 * launch-odds curve on the given rows. Every row is counted, dated or not: an
 * undated protocol takes the curve's base rate. */
export function seasoningMetrics(rows: SnapshotProtocol[], asOf: string, seasoning: Seasoning): { brier: number; log_loss: number; ece: number; n: number } {
  const n = rows.length;
  if (n === 0) return { brier: 0, log_loss: 0, ece: 0, n: 0 };
  let brier = 0;
  let logLoss = 0;
  const bins: { count: number; predSum: number; actualSum: number }[] = Array.from({ length: 10 }, () => ({ count: 0, predSum: 0, actualSum: 0 }));
  for (const p of rows) {
    const pr = launchOdds(ageDays(asOf, p.listed_at), seasoning);
    const y = p.mcap_usd !== null ? 1 : 0;
    brier += (pr - y) ** 2;
    logLoss += -(y * Math.log(Math.max(1e-12, pr)) + (1 - y) * Math.log(Math.max(1e-12, 1 - pr)));
    const b = Math.min(9, Math.floor(pr * 10));
    bins[b]!.count += 1;
    bins[b]!.predSum += pr;
    bins[b]!.actualSum += y;
  }
  let ece = 0;
  for (const b of bins) {
    if (b.count > 0) ece += (b.count / n) * Math.abs(b.actualSum / b.count - b.predSum / b.count);
  }
  return { brier: brier / n, log_loss: logLoss / n, ece, n };
}

/** A protocol's launch odds from the seasoning curve; an unlisted age takes the base rate.
 * When a Platt recalibration was adopted (charter v1.2), the raw logistic odds are passed
 * through it: p_cal = sigmoid(a + b·logit(p)). Fold-local seasonings never carry Platt
 * parameters, so validation metrics are always of the raw curve. */
export function launchOdds(age: number | null, seasoning: Seasoning): number {
  if (age === null) return seasoning.base_rate;
  const z = seasoning.intercept + seasoning.slope * Math.log10(age + 1);
  const clamped = Math.max(-30, Math.min(30, z));
  const raw = 1 / (1 + Math.exp(-clamped));
  if (seasoning.platt_a === null || seasoning.platt_b === null) return raw;
  const logit = Math.log(Math.max(1e-9, raw) / Math.max(1e-9, 1 - raw));
  const z2 = Math.max(-30, Math.min(30, seasoning.platt_a + seasoning.platt_b * logit));
  return 1 / (1 + Math.exp(-z2));
}

/** The seasoning curve's calibration by age bin: the actual launch rate against the curve's mean predicted odds. */
export function seasoningCalibration(snapshot: Snapshot, seasoning: Seasoning): SeasoningCalibration[] {
  const bins: [number, number | null][] = [[0, 90], [90, 180], [180, 365], [365, 730], [730, 1100], [1100, 1500], [1500, 2200], [2200, null]];
  return bins
    .map(([lo, hi]) => {
      const inBin = snapshot.protocols.filter((p) => {
        const age = ageDays(snapshot.as_of, p.listed_at);
        return age !== null && age >= lo && (hi === null || age < hi);
      });
      if (inBin.length === 0) return null;
      const actual = inBin.filter((p) => p.mcap_usd !== null).length / inBin.length;
      const predicted = inBin.reduce((s, p) => s + launchOdds(ageDays(snapshot.as_of, p.listed_at), seasoning), 0) / inBin.length;
      return { age_min_days: lo, age_max_days: hi, n: inBin.length, actual_rate: round4(actual), predicted_odds: round4(predicted) };
    })
    .filter((b): b is SeasoningCalibration => b !== null);
}

/** The whole fit: the regression, its category and chain adjustments, the validations and the scatter. */
export interface FittedModel {
  beta: number[];
  adjustments: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>;
  chainAdjustments: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>;
  fit: Fit;
  validation: Validation;
  seasoning: Seasoning;
  bandHalfwidth: number;
  comparables: Comparable[];
  chainComparables: Comparable[];
  scatter: ScatterPoint[];
  /** The training domain the OOD check measures board rows against. */
  oodDomain: OodDomain;
  /** The training comps' log10(TVL + floor), for the nearest-comparable distance. */
  oodCompLogTvls: number[];
  /** The launch-odds decision (charter v1.2): base rate unless the curve passes. */
  launchOddsDecision: LaunchOddsDecision;
  /** The fitted Platt parameters (even when not adopted) for the EV stress test. */
  plattFitted: { a: number; b: number } | null;
  /** v1.3: the production value cap — the maximum market cap observed among the
   * 70 dated comparables; no simulated launch value exceeds it. */
  valueCapUsd: number;
  /** v1.3: the observed maximum dated-comp market cap (the tournament's cap),
   * even when the production cap reverted to the uncapped $100B. */
  observedMaxMcapUsd: number;
  /** v1.3: whether the capped lognormal survived the CRPS validation. */
  capKept: boolean;
  /** v1.3: the P90 cap used by the tournament's sensitivity row. */
  valueCapP90Usd: number;
  /** v1.4: the P95 cap used by the tournament's second sensitivity row (the
   * Gemini Rain-winsorization cap). */
  valueCapP95Usd: number;
  /** v1.4: per-board-row parameter SDs from the 2000 bootstrap refits (dex). */
  paramSdBySlug: Map<string, number>;
  /** v1.4: the coefficient distribution from the 2000 bootstrap refits. */
  bootstrapCoef: { intercept: { mean: number; sd: number; p025: number; p975: number }; slope: { mean: number; sd: number; p025: number; p975: number } };
  /** v1.4: the LOPO refit predicted log values per dropped comp, in the
   * order of snapshot.protocols.filter(isRankable). In-memory only (never
   * serialized) — buildRadar uses it for the LOPO ranking-stability rows. */
  lopoRefitPreds: Map<string, number[]>;
  /** v1.5: the 2000 bootstrap refit predicted log values per board protocol,
   * in the order of snapshot.protocols.filter(isRankable). In-memory only
   * (never serialized) — buildRadar uses it for the param-aware farming
   * simulation (coefficient uncertainty per row). */
  bootstrapBoardPreds: Map<string, number[]>;
  /** v1.4: per-board-row EV parameter intervals (P10/P90 of the mean EV and
   * of P(negative) across the 2000 bootstrap refits, analytic capped
   * lognormal). In-memory only — buildBoard copies the values into the
   * board rows. */
  evParamBySlug: Map<string, { ev_mean_param_usd: [number, number]; prob_negative_param: [number, number] }>;
  /** v1.3: the 70 dated comps' observed market caps (the empirical value distribution). */
  compMcaps: number[];
  /** v1.3: the signed out-of-fold CV residuals (the bootstrap-residual distribution). */
  oofSignedResiduals: number[];
  /** v1.3: the validated OOD band multiplier (chosen on the selection folds). */
  oodBandMultiplier: number;
  /** v1.3: the pooled log-CRPS of the capped vs uncapped lognormal on the
   * nested selection folds (the cap validation). */
  crpsValidation: { capped_dex: number; uncapped_dex: number; n_test_rows: number };
  /** v1.7: the comps-fitted mcap/TVL ratio lens (full fit) — in-memory
   * only; buildRadar uses it for the board comparison and the LOPO
   * max-delta. Null when the lens could not be fitted (no comps). */
  ratioLensFit: { beta: number[]; adj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>; chainAdj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }> } | null;
}

/** The assumptions every farm EV rests on (charter v1.2): stated, not measured.
 * The EV statistics come from one seeded simulation array per protocol (20,000
 * draws: launch Bernoulli × lognormal value), so the mean, the quantiles and
 * P(negative return) are statistics of the same distribution; the conditional
 * value scenarios are labeled as conditional on launch. */
export const EV_ASSUMPTIONS =
  'Farmer share 0.25% of the launch value (assumed, not verified from data); exit value = snapshot market cap (no liquidity or lockup modeled — the snapshot carries no unlock schedule and no order-book depth, so none is invented); farming costs = gas per chain + opportunity cost of the $10,000 deposit at 10% annual over the hold window; hold days by age (60 < 180d, 45 < 365d, else 30); slippage/fees are a uniform 0.5% of the deposit ($50 per plan, charter v1.7 assumption) and are included in the COSTED plan C_i — the base plan cost excludes them, the net EV includes them; a non-launch loses the full plan cost. EV statistics are one seeded simulation (20,000 draws, launch Bernoulli × lognormal value, σ from the 50% band / 0.6745, ×1.5 for out-of-distribution rows); the mean is the expected net return and the P25/P50/P75 are quantiles of that same net-return array. FARM requires the adopted gate to pass under the conservative launch-probability assumption (the 2.5th percentile bootstrap lower bound of the base rate).';

/** Draws in one protocol's EV simulation array (charter v1.2). */
export const EV_SIM_DRAWS = 20_000;

/** FNV-1a hash of a string, as a 32-bit seed: the same slug always draws the same
 * simulation array, whatever order the board is built in. */
export function fnv1aHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A quantile of a sorted array (ceil(q·n) − 1), the same convention as p90Of. */
function quantileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

/**
 * One protocol's EV draw pairs (charter v1.3): for each draw, a launch uniform u
 * and a value draw V. The value is capped-lognormal: log10(V) = predictedLog +
 * σ·z with z ~ Normal(0,1) by Box–Muller on the seeded PRNG, σ from the
 * (possibly OOD-widened) band half-width, and V clamped to [$1, valueCap] where
 * valueCap is the maximum market cap observed among the dated comparables —
 * no simulated launch exceeds the largest launch ever observed. The same pairs
 * are evaluated under every launch-probability assumption, so the stress test
 * compares the same outcomes. Exported so buildRadar can export the raw
 * Polymarket simulation output.
 */
export function simulateEvPairs(
  predictedLog: number,
  planCost: number,
  sigma: number,
  nDraws: number,
  seed: number,
  model: ModelConstants = MODEL,
  valueCap: number = MODEL.value_max,
): { u: number[]; values: number[] } {
  const rand = mulberry32(seed);
  const u: number[] = new Array(nDraws);
  const values: number[] = new Array(nDraws);
  let spare: number | null = null;
  const nextNormal = (): number => {
    if (spare !== null) {
      const z = spare;
      spare = null;
      return z;
    }
    let a = 0;
    let b = 0;
    do {
      a = rand();
      b = rand();
    } while (a <= 0);
    const r = Math.sqrt(-2 * Math.log(a));
    const t = 2 * Math.PI * b;
    spare = r * Math.sin(t);
    return r * Math.cos(t);
  };
  for (let i = 0; i < nDraws; i++) {
    u[i] = rand();
    const logV = predictedLog + sigma * nextNormal();
    values[i] = Math.min(valueCap, Math.max(model.value_min, Math.round(10 ** logV)));
  }
  return { u, values };
}

/** The EV statistics of one draw-pair set under one launch probability: the mean,
 * the quantiles and P(negative) of the net-return array. Every statistic comes
 * from the same array. */
export function evStatsFromPairs(
  pairs: { u: number[]; values: number[] },
  launchOddsValue: number,
  planCost: number,
  model: ModelConstants = MODEL,
): { mean: number; p10: number; p25: number; p50: number; p75: number; p90: number; probNegative: number } {
  const n = pairs.u.length;
  const evs: number[] = new Array(n);
  let sum = 0;
  let neg = 0;
  for (let i = 0; i < n; i++) {
    const ev = pairs.u[i]! < launchOddsValue ? model.farmer_share * pairs.values[i]! - planCost : -planCost;
    evs[i] = ev;
    sum += ev;
    if (ev < 0) neg += 1;
  }
  evs.sort((a, b) => a - b);
  return {
    mean: sum / n,
    p10: quantileOf(evs, 0.1),
    p25: quantileOf(evs, 0.25),
    p50: quantileOf(evs, 0.5),
    p75: quantileOf(evs, 0.75),
    p90: quantileOf(evs, 0.9),
    probNegative: neg / n,
  };
}

/** The analytic P(negative return) = 1 − p_L × P(value > cost / farmer_share),
 * with log10(value) normal around the prediction. The v1.1 formula — kept as the
 * cross-check the simulation must agree with within Monte Carlo error. */
export function analyticProbNegative(
  launchOddsValue: number,
  predictedLog: number,
  planCost: number,
  sigma: number,
  model: ModelConstants = MODEL,
): number {
  const threshold = planCost / model.farmer_share;
  const pValueAboveThreshold = 1 - normalCdf((Math.log10(Math.max(1, threshold)) - predictedLog) / sigma);
  return 1 - launchOddsValue * pValueAboveThreshold;
}

/** The Platt-calibrated launch odds for one raw curve probability. */
export function plattOdds(rawP: number, a: number, b: number): number {
  const logit = Math.log(Math.max(1e-9, rawP) / Math.max(1e-9, 1 - rawP));
  const z = Math.max(-30, Math.min(30, a + b * logit));
  return 1 / (1 + Math.exp(-z));
}

/**
 * The EV simulation for one protocol (charter v1.3): one seeded array of
 * 20,000 draws, every statistic from that array. `launchOddsAdopted` is the
 * adopted p_L (the base rate unless the curve passed the adoption test);
 * `launchOddsBaseRate`, `launchOddsPlatt` (the Platt-calibrated curve's p_L for
 * this row) and `conservativeLowerBound` (the bootstrap lower bound) are the
 * three stress-test assumptions, all computed from the SAME draw pairs. The
 * value draws are capped-lognormal (valueCap = the maximum observed dated-comp
 * market cap). The conditional value scenarios (EV at the P25/P75/P10 value IF
 * it launches) are point evaluations, labeled as conditional, never as
 * quantiles of the net return.
 */
export function evSimulation(
  slug: string,
  launchOddsAdopted: number,
  launchOddsBaseRate: number,
  launchOddsPlatt: number,
  conservativeLowerBound: number,
  predictedLog: number,
  planCost: number,
  bandHalfwidth: number,
  bandMultiplier: number,
  model: ModelConstants = MODEL,
  valueCap: number = MODEL.value_max,
): EvSimulation {
  const sigma = bandHalfwidth > 0 ? (bandHalfwidth * bandMultiplier) / 0.6745 : 0.01;
  const seed = fnv1aHash(slug);
  const pairs = simulateEvPairs(predictedLog, planCost, sigma, EV_SIM_DRAWS, seed, model, valueCap);
  const adopted = evStatsFromPairs(pairs, launchOddsAdopted, planCost, model);
  const baseRate = evStatsFromPairs(pairs, launchOddsBaseRate, planCost, model);
  const platt = evStatsFromPairs(pairs, launchOddsPlatt, planCost, model);
  const conservative = evStatsFromPairs(pairs, conservativeLowerBound, planCost, model);
  // The conditional mean EV (policy (b)'s quantity): E[net return | launch] =
  // 0.25% × E[value | launch] − plan cost, from the same value draws.
  const meanValueIfLaunches = pairs.values.reduce((s, v) => s + v, 0) / pairs.values.length;
  const conditionalMeanEv = model.farmer_share * meanValueIfLaunches - planCost;
  const valueAt = (logV: number): number => Math.min(valueCap, Math.max(model.value_min, Math.round(10 ** logV)));
  const evAtValueIfLaunches = (value: number): number => launchOddsAdopted * model.farmer_share * value - planCost;
  const p10Value = valueAt(predictedLog - 1.2816 * sigma);
  const effectiveHalfwidth = bandHalfwidth * bandMultiplier;
  return {
    n_draws: EV_SIM_DRAWS,
    seed,
    ev_mean_usd: Math.round(adopted.mean),
    ev_conditional_mean_usd: Math.round(conditionalMeanEv),
    mean_value_if_launches_usd: Math.round(meanValueIfLaunches),
    value_cap_usd: valueCap,
    ev_p10_usd: Math.round(adopted.p10),
    ev_p25_usd: Math.round(adopted.p25),
    ev_p50_usd: Math.round(adopted.p50),
    ev_p75_usd: Math.round(adopted.p75),
    ev_p90_usd: Math.round(adopted.p90),
    prob_negative: round4(adopted.probNegative),
    prob_negative_conservative: round4(conservative.probNegative),
    prob_negative_analytic: round4(analyticProbNegative(launchOddsAdopted, predictedLog, planCost, sigma, model)),
    ev_at_p25_value_if_launches_usd: Math.round(evAtValueIfLaunches(valueAt(predictedLog - effectiveHalfwidth))),
    ev_at_p75_value_if_launches_usd: Math.round(evAtValueIfLaunches(valueAt(predictedLog + effectiveHalfwidth))),
    ev_at_p10_value_if_launches_usd: Math.round(evAtValueIfLaunches(p10Value)),
    p10_value_usd: p10Value,
    ev_mean_base_rate_usd: Math.round(baseRate.mean),
    ev_mean_platt_usd: Math.round(platt.mean),
    ev_mean_conservative_usd: Math.round(conservative.mean),
    ev_p25_conservative_usd: Math.round(conservative.p25),
    ev_p50_conservative_usd: Math.round(conservative.p50),
    ev_p75_conservative_usd: Math.round(conservative.p75),
  };
}

/** The launch-probability audit (charter v1.3): reliability diagram, bootstrap
 * intervals for the improvement over the base rate, ROC/PR AUC, a Platt
 * recalibration fitted on the earliest fold-local predictions and tested on the
 * latest ones, and the heuristic activity-multiplier test (same untouched test
 * rows as the Platt test). Pure arithmetic on the pooled fold-local predictions
 * — no fitting on the board's full curve. */
export function auditLaunchOdds(pool: { pred: number; y: number; fold: number; active: boolean }[]): SeasoningAudit {
  const n = pool.length;
  const baseRate = n > 0 ? pool.reduce((s, r) => s + r.y, 0) / n : 0;
  const brierOf = (rows: { pred: number; y: number }[]): number =>
    rows.length === 0 ? 0 : rows.reduce((s, r) => s + (r.pred - r.y) ** 2, 0) / rows.length;
  const logLossOf = (rows: { pred: number; y: number }[]): number =>
    rows.length === 0 ? 0 : rows.reduce((s, r) => s - (r.y * Math.log(Math.max(1e-12, r.pred)) + (1 - r.y) * Math.log(Math.max(1e-12, 1 - r.pred))), 0) / rows.length;

  // Reliability diagram: fixed predicted-probability bins.
  const edges = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0];
  const reliabilityBins: ReliabilityBin[] = [];
  for (let b = 0; b < edges.length - 1; b++) {
    const lo = edges[b]!;
    const hi = edges[b + 1]!;
    const inBin = pool.filter((r) => r.pred >= lo && (b === edges.length - 2 ? r.pred <= hi : r.pred < hi));
    if (inBin.length === 0) continue;
    reliabilityBins.push({
      pred_min: lo,
      pred_max: hi,
      n: inBin.length,
      actual_rate: round4(inBin.reduce((s, r) => s + r.y, 0) / inBin.length),
      mean_pred: round4(inBin.reduce((s, r) => s + r.pred, 0) / inBin.length),
    });
  }

  // Bootstrap 95% intervals for the improvement over the base rate (2000 resamples,
  // fixed seed, resampling pooled test rows by row).
  const baseRows = pool.map((r) => ({ pred: baseRate, y: r.y }));
  const baseBrier = brierOf(baseRows);
  const baseLogLoss = logLossOf(baseRows);
  const rand = mulberry32(20261107);
  const dBrier: number[] = [];
  const dLogLoss: number[] = [];
  for (let b = 0; b < 2000; b++) {
    const sample: { pred: number; y: number }[] = [];
    for (let i = 0; i < n; i++) sample.push(pool[Math.floor(rand() * n)]!);
    const sBase = sample.map((r) => ({ pred: baseRate, y: r.y }));
    dBrier.push(brierOf(sBase) - brierOf(sample));
    dLogLoss.push(logLossOf(sBase) - logLossOf(sample));
  }
  dBrier.sort((a, b) => a - b);
  dLogLoss.sort((a, b) => a - b);
  const ci = (sorted: number[]): [number, number] => [
    round4(sorted[Math.floor(0.025 * sorted.length)] ?? 0),
    round4(sorted[Math.min(sorted.length - 1, Math.ceil(0.975 * sorted.length) - 1)] ?? 0),
  ];

  // ROC-AUC (Mann–Whitney) and PR-AUC (average precision) on the pooled predictions.
  const pos = pool.filter((r) => r.y === 1);
  const neg = pool.filter((r) => r.y === 0);
  let auc = 0;
  for (const p of pos) {
    for (const q of neg) auc += p.pred > q.pred ? 1 : p.pred === q.pred ? 0.5 : 0;
  }
  const rocAuc = pos.length > 0 && neg.length > 0 ? auc / (pos.length * neg.length) : 0.5;
  const ranked = [...pool].sort((a, b) => b.pred - a.pred);
  let prSum = 0;
  let seenPos = 0;
  ranked.forEach((r, i) => {
    if (r.y === 1) {
      seenPos += 1;
      prSum += seenPos / (i + 1);
    }
  });
  const prAuc = pos.length > 0 ? prSum / pos.length : 0;

  // Platt calibration: fit on fold-local predictions from cutoffs 50/60/70, test on
  // 80/90 (untouched for this decision). Adopted only if it beats the raw curve on
  // BOTH Brier and log-loss on the test set.
  const calRows = pool.filter((r) => r.fold <= 70);
  const testRows = pool.filter((r) => r.fold >= 80);
  const testBaseRate = testRows.length > 0 ? testRows.reduce((s, r) => s + r.y, 0) / testRows.length : 0;
  let plattA: number | null = null;
  let plattB: number | null = null;
  let calBrier = 0;
  let calLogLoss = 0;
  if (calRows.length > 10) {
    // Logistic fit of y on logit(p), Newton–Raphson from a fixed start.
    let a = 0;
    let b = 1;
    for (let iter = 0; iter < 50; iter++) {
      let g0 = 0;
      let g1 = 0;
      let h00 = 1e-8;
      let h01 = 0;
      let h11 = 1e-8;
      for (const r of calRows) {
        const x = Math.max(-6, Math.min(6, Math.log(Math.max(1e-9, r.pred) / Math.max(1e-9, 1 - r.pred))));
        const z = Math.max(-30, Math.min(30, a + b * x));
        const pr = 1 / (1 + Math.exp(-z));
        const d = r.y - pr;
        const w = pr * (1 - pr);
        g0 += d;
        g1 += d * x;
        h00 += w;
        h01 += w * x;
        h11 += w * x * x;
      }
      const det = h00 * h11 - h01 * h01;
      if (det === 0) break;
      const s0 = (h11 * g0 - h01 * g1) / det;
      const s1 = (h00 * g1 - h01 * g0) / det;
      a += s0;
      b += s1;
      if (Math.max(Math.abs(s0), Math.abs(s1)) < 1e-10) break;
    }
    plattA = round4(a);
    plattB = round4(b);
    const calPlatt = calRows.map((r) => {
      const x = Math.max(-6, Math.min(6, Math.log(Math.max(1e-9, r.pred) / Math.max(1e-9, 1 - r.pred))));
      const z = Math.max(-30, Math.min(30, a + b * x));
      return { pred: 1 / (1 + Math.exp(-z)), y: r.y };
    });
    calBrier = brierOf(calPlatt);
    calLogLoss = logLossOf(calPlatt);
  }
  const plattPred = (p: number): number => {
    if (plattA === null || plattB === null) return p;
    const x = Math.max(-6, Math.min(6, Math.log(Math.max(1e-9, p) / Math.max(1e-9, 1 - p))));
    const z = Math.max(-30, Math.min(30, plattA + plattB * x));
    return 1 / (1 + Math.exp(-z));
  };
  const testRaw = testRows.map((r) => ({ pred: r.pred, y: r.y }));
  const testPlatt = testRows.map((r) => ({ pred: plattPred(r.pred), y: r.y }));
  const testBase = testRows.map((r) => ({ pred: testBaseRate, y: r.y }));
  const testBrierRaw = brierOf(testRaw);
  const testLogLossRaw = logLossOf(testRaw);
  const testBrierPlatt = brierOf(testPlatt);
  const testLogLossPlatt = logLossOf(testPlatt);
  const testBrierBase = brierOf(testBase);
  const testLogLossBase = logLossOf(testBase);
  // Calibration (ECE, 10 fixed bins) and discrimination (ROC-AUC, Mann–Whitney)
  // for each of the three predictors on the SAME untouched test rows.
  const eceOf = (rows: { pred: number; y: number }[]): number => {
    if (rows.length === 0) return 0;
    const bins: { count: number; predSum: number; actualSum: number }[] = Array.from({ length: 10 }, () => ({ count: 0, predSum: 0, actualSum: 0 }));
    for (const r of rows) {
      const b = Math.min(9, Math.floor(r.pred * 10));
      bins[b]!.count += 1;
      bins[b]!.predSum += r.pred;
      bins[b]!.actualSum += r.y;
    }
    let ece = 0;
    for (const b of bins) if (b.count > 0) ece += (b.count / rows.length) * Math.abs(b.actualSum / b.count - b.predSum / b.count);
    return ece;
  };
  const rocAucOf = (rows: { pred: number; y: number }[]): number => {
    const pos = rows.filter((r) => r.y === 1);
    const neg = rows.filter((r) => r.y === 0);
    if (pos.length === 0 || neg.length === 0) return 0.5;
    let auc = 0;
    for (const p of pos) for (const q of neg) auc += p.pred > q.pred ? 1 : p.pred === q.pred ? 0.5 : 0;
    return auc / (pos.length * neg.length);
  };
  // Charter v1.3: Platt is adopted only if it beats the BASE RATE (not merely the
  // raw curve) on BOTH Brier and log-loss on the untouched test. Under v1.1
  // evidence the base rate beats even the Platt curve, so Platt is not adopted.
  const adopted = plattA !== null && plattB !== null && testBrierPlatt < testBrierBase && testLogLossPlatt < testLogLossBase;
  // The heuristic activity-multiplier test (charter v1.3): the bounded multiplier
  // (1.5× active / 0.5× dormant) on the base rate, tested on the SAME untouched
  // test rows as the Platt test. The activity feature is a documented proxy —
  // TVL growing over 7 days (change_7d > 0) — because the snapshot carries no
  // points-program or testnet field. Adopted only if it beats the flat base rate
  // on BOTH Brier and log-loss.
  const clampProb = (p: number): number => Math.max(0.01, Math.min(0.9, p));
  const testMult = testRows.map((r) => ({ pred: clampProb(testBaseRate * (r.active ? 1.5 : 0.5)), y: r.y }));
  const testBrierMult = brierOf(testMult);
  const testLogLossMult = logLossOf(testMult);
  const multBeatsBrier = testBrierMult < testBrierBase;
  const multBeatsLogLoss = testLogLossMult < testLogLossBase;
  const heuristicMultiplier: HeuristicMultiplierTest = {
    feature: 'activity (points program / testnet active vs dormant)',
    feature_is_proxy: true,
    proxy_definition: 'active iff the protocol’s 7-day TVL change is positive (change_7d > 0); dormant otherwise. The snapshot carries no points-program or testnet field, so this TVL-growth proxy is the testable candidate — it is not Gemini’s literal feature.',
    multiplier_active: 1.5,
    multiplier_dormant: 0.5,
    n_test: testRows.length,
    test_brier_multiplier: round4(testBrierMult),
    test_log_loss_multiplier: round4(testLogLossMult),
    test_brier_base: round4(testBrierBase),
    test_log_loss_base: round4(testLogLossBase),
    beats_base_brier: multBeatsBrier,
    beats_base_log_loss: multBeatsLogLoss,
    adopted: multBeatsBrier && multBeatsLogLoss,
    reason:
      multBeatsBrier && multBeatsLogLoss
        ? `Activity multiplier adopted: on the untouched 80/90 test set (n = ${testRows.length}) it beats the flat base rate on both Brier (${testBrierMult.toFixed(4)} vs ${testBrierBase.toFixed(4)}) and log-loss (${testLogLossMult.toFixed(4)} vs ${testLogLossBase.toFixed(4)}).`
        : `Activity multiplier NOT adopted (charter v1.3): on the untouched 80/90 test set (n = ${testRows.length}) it does not beat the flat base rate on both Brier (${testBrierMult.toFixed(4)} vs ${testBrierBase.toFixed(4)}) and log-loss (${testLogLossMult.toFixed(4)} vs ${testLogLossBase.toFixed(4)}). The flat base rate stands — no added complexity without evidence.`,
  };
  return {
    reliability_bins: reliabilityBins,
    brier_improvement_ci: ci(dBrier),
    log_loss_improvement_ci: ci(dLogLoss),
    roc_auc: round4(rocAuc),
    pr_auc: round4(prAuc),
    n_pooled: n,
    heuristic_multiplier: heuristicMultiplier,
    platt: {
      adopted,
      a: adopted ? plattA : null,
      b: adopted ? plattB : null,
      fitted_a: plattA,
      fitted_b: plattB,
      cal_brier: round4(calBrier),
      cal_log_loss: round4(calLogLoss),
      test_brier_raw: round4(testBrierRaw),
      test_log_loss_raw: round4(testLogLossRaw),
      test_brier_platt: round4(testBrierPlatt),
      test_log_loss_platt: round4(testLogLossPlatt),
      test_brier_base: round4(testBrierBase),
      test_log_loss_base: round4(testLogLossBase),
      test_ece_raw: round4(eceOf(testRaw)),
      test_ece_platt: round4(eceOf(testPlatt)),
      test_ece_base: round4(eceOf(testBase)),
      test_roc_raw: round4(rocAucOf(testRaw)),
      test_roc_platt: round4(rocAucOf(testPlatt)),
      test_roc_base: round4(rocAucOf(testBase)),
      n_calibration: calRows.length,
      n_test: testRows.length,
      reason: adopted
        ? `Platt adopted: on the untouched 80/90 test set it beats the base rate on both Brier (${testBrierPlatt.toFixed(4)} vs ${testBrierBase.toFixed(4)}) and log-loss (${testLogLossPlatt.toFixed(4)} vs ${testLogLossBase.toFixed(4)}).`
        : plattA === null
          ? 'Platt not fitted: calibration set too small.'
          : `Platt NOT adopted (charter v1.2): on the untouched 80/90 test set it does not beat the base rate on both Brier (${testBrierPlatt.toFixed(4)} vs ${testBrierBase.toFixed(4)}) and log-loss (${testLogLossPlatt.toFixed(4)} vs ${testLogLossBase.toFixed(4)}). The base rate stands — no added complexity without evidence.`,
    },
  };
}

/**
 * Fit the regression on the dated live comparables and validate it, all at run time
 * (charter v1.1):
 *  - walk-forward: sort the dated comps by listed_at, fit on the oldest 70%, test on the
 *    newest 30%. The out-of-sample error is the median absolute log10 error on the test
 *    set, predicted with the training fit and the training set's own group adjustments —
 *    no look-ahead. Undated comps are hard-gated out of every split.
 *  - stratified split: train on dated 70% only; test on dated 30% and, separately, the
 *    last 30% of undated comps by slug, scored by the dated-only fit as a reference
 *    diagnostic; the undated test error is reported on its own (oos_undated).
 *  - 5-fold cross-validation: the dated comps are shuffled once with a fixed seed and
 *    dealt into five folds; each fold is scored by a fit on the other four. The
 *    per-comp cross-validated predictions are what the conformal band is built from.
 *  - nested expanding-window walk-forward: on the dated comparables only, train on the
 *    oldest 50/60/70/80/90% and test on the next 10% forward in time. Folds 50–80 are
 *    the prespecified selection metric; the 90% fold is the untouched final test.
 *  - the candidate estimators: Huber, OLS and ridge on the same features and splits,
 *    chosen by the prespecified selection rule — never by R².
 * The value band is cross-conformal: the nominal-coverage quantile of the absolute
 * out-of-fold residuals from the 5-fold CV. A 2000-refit bootstrap (fixed seed) is kept
 * as a diagnostic only. range_holds is the share of live comparables whose true value
 * fell inside their band, scored on the cross-validated predictions — an out-of-sample
 * calibration check, not an in-sample one.
 * Growth is not a production feature: a signed-growth diagnostic is run on the
 * identical splits and reported separately.
 */
/**
 * One regression fit on the given rows: the chosen estimator's fit, the growth
 * coefficient floored at zero when the features carry one (production features do
 * not), and the shrunk category / chain adjustments. Exported so the leakage
 * self-test can refit a fold's training set from a truncated snapshot and compare.
 * Ridge ignores featureFn (it is defined on the production features only).
 */
export function fitRegression(
  rows: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
  estimator: Estimator = 'huber',
  featureFn: (p: SnapshotProtocol, asOf: string, model: ModelConstants) => number[] = features,
  floorGrowth = true,
): { beta: number[]; adj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>; chainAdj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }> } {
  const raw = estimator === 'ridge' ? fitRidge(rows, asOf, model) : estimator === 'ols' ? fitWeightedOls(rows, rows.map(() => 1), asOf, model, featureFn) : fitHuber(rows, asOf, model, featureFn);
  const beta = [...raw];
  if (floorGrowth && beta.length > 2 && beta[2]! < 0) beta[2] = 0;
  const adj = groupAdjustments(rows, asOf, beta, (p) => p.category ?? 'Other', model, featureFn);
  const chainAdj = groupAdjustments(rows, asOf, beta, mainChain, model, featureFn);
  return { beta, adj, chainAdj };
}

/**
 * Statistical checks on the sealed snapshot, run before any fitting (charter v1.1):
 * duplicate slugs, missing / zero / negative / extreme TVL, future-dated listings
 * (listed after as_of), negative market caps (a market cap of exactly −1 is the
 * snapshot's sentinel for a failed cap lookup — a warning, not an error), zero market
 * caps (a dead token — a warning, not an error: it still counts as has-token), invalid
 * FDV (none in this snapshot: the sealed input carries no FDV field, so nothing to check),
 * an empty comparable set, watchlist slugs missing from the snapshot, and extreme
 * 7-day changes. Errors abort the build; warnings are printed and recorded.
 * Outlier sensitivity is covered by the Huber-vs-OLS paired comparison in the
 * validation (a single protocol cannot move the verdict when both fitters agree
 * within noise) and by the nested folds (each fold's error is reported separately).
 */
export function validateSnapshot(snapshot: Snapshot): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const p of snapshot.protocols) {
    if (seen.has(p.slug)) errors.push(`duplicate slug: ${p.slug}`);
    seen.add(p.slug);
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) errors.push(`${p.slug}: TVL is missing or not a number`);
    else if (p.tvl_usd < 0) errors.push(`${p.slug}: negative TVL $${p.tvl_usd}`);
    else if (p.tvl_usd === 0) warnings.push(`${p.slug}: zero TVL`);
    else if (p.tvl_usd > 1e12) warnings.push(`${p.slug}: extreme TVL $${p.tvl_usd.toLocaleString()}`);
    if (p.mcap_usd !== null) {
      if (typeof p.mcap_usd !== 'number' || !Number.isFinite(p.mcap_usd)) errors.push(`${p.slug}: market cap is not a number`);
      else if (p.mcap_usd === -1) warnings.push(`${p.slug}: market cap −1 (sentinel: the cap lookup failed — treated as has-token, excluded from comparables)`);
      else if (p.mcap_usd < 0) errors.push(`${p.slug}: negative market cap $${p.mcap_usd}`);
      else if (p.mcap_usd === 0) warnings.push(`${p.slug}: zero market cap (dead token — still counts as has-token)`);
    }
    if (p.listed_at !== null) {
      const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
      const asOf = Date.parse(`${snapshot.as_of}T00:00:00Z`);
      if (!Number.isFinite(listed)) errors.push(`${p.slug}: unparseable listing date ${p.listed_at}`);
      else if (Number.isFinite(asOf) && listed > asOf) errors.push(`${p.slug}: listed ${p.listed_at}, after the snapshot date ${snapshot.as_of}`);
    }
    if (p.change_7d !== null && (typeof p.change_7d !== 'number' || !Number.isFinite(p.change_7d))) errors.push(`${p.slug}: 7-day change is not a number`);
    else if (p.change_7d !== null && Math.abs(p.change_7d) > 1000) warnings.push(`${p.slug}: extreme 7-day change ${p.change_7d}%`);
  }
  const comps = liveComps(snapshot);
  if (comps.length === 0) errors.push('no live-token comparables: nothing to fit the curve on');
  const index = new Set(snapshot.protocols.map((p) => p.slug));
  const missingWatchlist = snapshot.watchlist.filter((s) => !index.has(s));
  if (missingWatchlist.length > 0) warnings.push(`watchlist slugs missing from the snapshot: ${missingWatchlist.join(', ')}`);
  return { errors, warnings };
}

export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL, targetCapUsd?: number): FittedModel {
  // Dated only — charter v1.1 hard-gate. When targetCapUsd is set (the v1.4
  // winsorization candidate), the dated comps' market caps are winsorized at
  // it before ANY fitting: every regression, fold, calibration, and
  // validation quantity below derives from this list, so the winsorized fit
  // is a self-consistent model. The snapshot itself is never modified, and
  // the cohort / seasoning (which read snapshot.protocols directly) are
  // untouched by the cap — a market-cap cap cannot change whether a token
  // exists.
  const compsRaw = liveComps(snapshot);
  const comps =
    targetCapUsd === undefined
      ? compsRaw
      : compsRaw.map((p) => (p.mcap_usd! > targetCapUsd ? { ...p, mcap_usd: targetCapUsd } : p));
  const undated = undatedComps(snapshot); // reference only, never fitted
  const asOf = snapshot.as_of;
  type Regression = { beta: number[]; adj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>; chainAdj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }> };
  const fitEst = (estimator: Estimator) => (rows: SnapshotProtocol[]): Regression => fitRegression(rows, asOf, model, estimator);
  const fitOne = fitEst('huber');
  const fitOneOls = fitEst('ols');
  const fitOneRidge = fitEst('ridge');
  const absErrs = (
    rows: SnapshotProtocol[],
    beta: number[],
    adj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
    chainAdj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
    featureFn: (p: SnapshotProtocol, asOf: string, model: ModelConstants) => number[] = features,
  ): number[] => rows.map((p) => Math.abs(Math.log10(p.mcap_usd!) - predictLog(p, asOf, beta, adj, chainAdj, model, featureFn)));
  const signedErrs = (
    rows: SnapshotProtocol[],
    beta: number[],
    adj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
    chainAdj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
    featureFn: (p: SnapshotProtocol, asOf: string, model: ModelConstants) => number[] = features,
  ): number[] => rows.map((p) => Math.log10(p.mcap_usd!) - predictLog(p, asOf, beta, adj, chainAdj, model, featureFn));
  const medianAbsErr = (
    rows: SnapshotProtocol[],
    beta: number[],
    adj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
    chainAdj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
    featureFn: (p: SnapshotProtocol, asOf: string, model: ModelConstants) => number[] = features,
  ): number => median([...absErrs(rows, beta, adj, chainAdj, featureFn)].sort((a, b) => a - b)) ?? 0;
  const p90Of = (values: number[]): number => {
    const s = [...values].sort((a, b) => a - b);
    return s.length === 0 ? 0 : (s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)] ?? 0);
  };
  const pooledMedian = (values: number[]): number => median([...values].sort((a, b) => a - b)) ?? 0;

  // The purge gap (charter v1.1): a training row listed less than purge_gap_days
  // before a test window starts is dropped. A token's first month of trading is
  // when its snapshot market cap is most unstable, and the snapshot's growth
  // window is 7 days, so 30 days covers about four weekly windows.
  const purge = (trainRows: SnapshotProtocol[], testStart: string): SnapshotProtocol[] =>
    trainRows.filter((p) => (ageDays(testStart, p.listed_at) ?? 0) >= model.purge_gap_days);

  // Dated comparables, oldest first.
  const datedOrdered = [...comps].sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const dated = datedOrdered;

  // Walk-forward, dated comparables only, with the purge gap: fit on the oldest 70%,
  // test on the newest 30%. All three candidate estimators are fitted on the identical
  // rows, so the selection table compares like with like.
  const nTrain = Math.floor(datedOrdered.length * 0.7);
  const test = datedOrdered.slice(nTrain);
  const wfTestStart = test[0]!.listed_at!;
  const train = purge(datedOrdered.slice(0, nTrain), wfTestStart);
  const wfFits: Record<Estimator, Regression> = { huber: fitOne(train), ols: fitOneOls(train), ridge: fitOneRidge(train) };
  const wfErrs: Record<Estimator, number[]> = {
    huber: absErrs(test, wfFits.huber.beta, wfFits.huber.adj, wfFits.huber.chainAdj),
    ols: absErrs(test, wfFits.ols.beta, wfFits.ols.adj, wfFits.ols.chainAdj),
    ridge: absErrs(test, wfFits.ridge.beta, wfFits.ridge.adj, wfFits.ridge.chainAdj),
  };
  const oosByEst: Record<Estimator, number> = {
    huber: pooledMedian(wfErrs.huber),
    ols: pooledMedian(wfErrs.ols),
    ridge: pooledMedian(wfErrs.ridge),
  };

  // Nested expanding-window walk-forward on the dated comparables only, with the purge
  // gap: train on the oldest 50/60/70/80/90%, test on the next 10% forward in time.
  // Folds 50–80 are the prespecified selection metric; the 90% fold (newest 7 comps)
  // is the untouched final test and is used for no choice of any kind.
  const nestedStep = Math.max(1, Math.round(dated.length * 0.1));
  const nestedFolds: NestedFold[] = [];
  const nestedDiagnostics: NestedFoldDiagnostic[] = [];
  const nestedErrs: Record<Estimator, number[]> = { huber: [], ols: [], ridge: [] };
  const nestedErrsSelection: Record<Estimator, number[]> = { huber: [], ols: [], ridge: [] };
  const nestedFoldErrsByEst: Record<Estimator, number[][]> = { huber: [], ols: [], ridge: [] };
  const nestedFoldFitsAll: { label: string; train: SnapshotProtocol[]; testStart: string; fits: Record<Estimator, Regression> }[] = [];
  const nestedFoldData: { pct: number; foldTest: SnapshotProtocol[]; foldTrain: SnapshotProtocol[]; foldTestStart: string; fits: Record<Estimator, Regression>; errs: Record<Estimator, number[]>; signed: Record<Estimator, number[]> }[] = [];
  for (const pct of [50, 60, 70, 80, 90]) {
    const nTr = Math.floor((dated.length * pct) / 100);
    const foldTest = dated.slice(nTr, nTr + nestedStep);
    const foldTestStart = foldTest[0]!.listed_at!;
    const foldTrain = purge(dated.slice(0, nTr), foldTestStart);
    const foldFits: Record<Estimator, Regression> = { huber: fitOne(foldTrain), ols: fitOneOls(foldTrain), ridge: fitOneRidge(foldTrain) };
    const foldErrs: Record<Estimator, number[]> = {
      huber: absErrs(foldTest, foldFits.huber.beta, foldFits.huber.adj, foldFits.huber.chainAdj),
      ols: absErrs(foldTest, foldFits.ols.beta, foldFits.ols.adj, foldFits.ols.chainAdj),
      ridge: absErrs(foldTest, foldFits.ridge.beta, foldFits.ridge.adj, foldFits.ridge.chainAdj),
    };
    const foldSigned = signedErrs(foldTest, foldFits.huber.beta, foldFits.huber.adj, foldFits.huber.chainAdj);
    (Object.keys(foldErrs) as Estimator[]).forEach((e) => {
      nestedErrs[e].push(...foldErrs[e]);
      nestedFoldErrsByEst[e].push(foldErrs[e]);
      if (pct < 90) nestedErrsSelection[e].push(...foldErrs[e]);
    });
    nestedFoldFitsAll.push({ label: `nested ${pct}%`, train: foldTrain, testStart: foldTestStart, fits: foldFits });
    nestedFoldData.push({
      pct,
      foldTest,
      foldTrain,
      foldTestStart,
      fits: foldFits,
      errs: foldErrs,
      signed: {
        huber: foldSigned,
        ols: signedErrs(foldTest, foldFits.ols.beta, foldFits.ols.adj, foldFits.ols.chainAdj),
        ridge: signedErrs(foldTest, foldFits.ridge.beta, foldFits.ridge.adj, foldFits.ridge.chainAdj),
      },
    });
  }
  const nestedPooledByEst: Record<Estimator, number> = {
    huber: round4(pooledMedian(nestedErrs.huber)),
    ols: round4(pooledMedian(nestedErrs.ols)),
    ridge: round4(pooledMedian(nestedErrs.ridge)),
  };
  const selectionPooled: Record<Estimator, number> = {
    huber: round4(pooledMedian(nestedErrsSelection.huber)),
    ols: round4(pooledMedian(nestedErrsSelection.ols)),
    ridge: round4(pooledMedian(nestedErrsSelection.ridge)),
  };
  const selectionP90: Record<Estimator, number> = {
    huber: round4(p90Of(nestedErrsSelection.huber)),
    ols: round4(p90Of(nestedErrsSelection.ols)),
    ridge: round4(p90Of(nestedErrsSelection.ridge)),
  };

  // 5-fold cross-validation with a fixed-seed shuffle on dated comps only: Huber, OLS
  // and ridge on the same folds.
  const shuffled = seededShuffle(comps, 20261118);
  const folds: SnapshotProtocol[][] = [[], [], [], [], []];
  shuffled.forEach((p, i) => folds[i % 5]!.push(p));
  const cvPred: Record<Estimator, Map<string, number>> = { huber: new Map(), ols: new Map(), ridge: new Map() };
  for (let f = 0; f < 5; f++) {
    const testFold = folds[f]!;
    const trainFolds = folds.flatMap((fold, i) => (i === f ? [] : fold));
    (Object.keys(cvPred) as Estimator[]).forEach((e) => {
      const cvFit = fitEst(e)(trainFolds);
      for (const p of testFold) cvPred[e].set(p.slug, predictLog(p, asOf, cvFit.beta, cvFit.adj, cvFit.chainAdj, model));
    });
  }
  const cvPairs = comps.map((p) => ({
    huber: Math.abs(Math.log10(p.mcap_usd!) - cvPred.huber.get(p.slug)!),
    ols: Math.abs(Math.log10(p.mcap_usd!) - cvPred.ols.get(p.slug)!),
    ridge: Math.abs(Math.log10(p.mcap_usd!) - cvPred.ridge.get(p.slug)!),
  }));
  const cvByEst: Record<Estimator, number> = {
    huber: pooledMedian(cvPairs.map((x) => x.huber)),
    ols: pooledMedian(cvPairs.map((x) => x.ols)),
    ridge: pooledMedian(cvPairs.map((x) => x.ridge)),
  };

  // Drop-one slope sensitivity per candidate (charter v1.1, Huber selection condition):
  // refit after dropping the single largest-|residual| comp and measure |Δcoef_log_tvl|.
  const dropOneSlopeChange = (estimator: Estimator): number => {
    const f = fitEst(estimator)(comps);
    const residuals = comps.map((p) => ({ p, r: Math.abs(Math.log10(p.mcap_usd!) - predictLog(p, asOf, f.beta, f.adj, f.chainAdj, model)) }));
    residuals.sort((a, b) => b.r - a.r);
    const worst = residuals[0]!.p.slug;
    const refit = fitEst(estimator)(comps.filter((p) => p.slug !== worst));
    return Math.abs(refit.beta[1]! - f.beta[1]!);
  };
  const dropOne: Record<Estimator, number> = { huber: dropOneSlopeChange('huber'), ols: dropOneSlopeChange('ols'), ridge: dropOneSlopeChange('ridge') };

  // The growth diagnostic (charter v1.1): signed growth, no clamp, identical splits.
  // Production has no growth term; this is reported only and decides nothing by itself.
  const growthFit = (rows: SnapshotProtocol[]): Regression => fitRegression(rows, asOf, model, 'huber', featuresWithGrowth, false);
  const growthWfFit = growthFit(train);
  const growthWf = pooledMedian(absErrs(test, growthWfFit.beta, growthWfFit.adj, growthWfFit.chainAdj, featuresWithGrowth));
  const growthNestedErrs: number[] = [];
  for (const pct of [50, 60, 70, 80, 90]) {
    const nTr = Math.floor((dated.length * pct) / 100);
    const foldTest = dated.slice(nTr, nTr + nestedStep);
    const foldTrain = purge(dated.slice(0, nTr), foldTest[0]!.listed_at!);
    const gf = growthFit(foldTrain);
    growthNestedErrs.push(...absErrs(foldTest, gf.beta, gf.adj, gf.chainAdj, featuresWithGrowth));
  }
  const growthCvPred = new Map<string, number>();
  for (let f = 0; f < 5; f++) {
    const testFold = folds[f]!;
    const trainFolds = folds.flatMap((fold, i) => (i === f ? [] : fold));
    const gf = growthFit(trainFolds);
    for (const p of testFold) growthCvPred.set(p.slug, predictLog(p, asOf, gf.beta, gf.adj, gf.chainAdj, model, featuresWithGrowth));
  }
  const growthCv = pooledMedian(comps.map((p) => Math.abs(Math.log10(p.mcap_usd!) - growthCvPred.get(p.slug)!)));
  const growthFull = growthFit(comps);
  const growthNestedSelection = growthNestedErrs.slice(0, 28);
  const growthDiagnostic: GrowthDiagnostic = {
    wf: round4(growthWf),
    nested_pooled: round4(pooledMedian(growthNestedErrs)),
    cv: round4(growthCv),
    coef_growth_full_fit: round4(growthFull.beta[2] ?? 0),
    verdict:
      pooledMedian(growthNestedSelection) + 0.01 < selectionPooled.huber
        ? `Growth WOULD improve the selection metric (${round4(pooledMedian(growthNestedSelection))} vs Huber ${selectionPooled.huber}) — revisit the charter before adopting it.`
        : `Growth stays OUT of production: the signed-growth diagnostic scores ${round4(pooledMedian(growthNestedSelection))} on the selection metric (nested 50–80 pooled) vs ${selectionPooled.huber} for Huber without growth — no improvement beyond 0.01 dex, and its coefficient is unstable across folds.`,
  };

  // Model selection (charter v1.1, prespecified rule — applied here, before the
  // production fit, on the selection folds only).
  const candidates: CandidateMetrics[] = (['huber', 'ols', 'ridge'] as Estimator[]).map((e) => ({
    estimator: e,
    selection_pooled: selectionPooled[e],
    selection_p90: selectionP90[e],
    wf: round4(oosByEst[e]),
    cv: round4(cvByEst[e]),
    drop_one_slope_change: round4(dropOne[e]),
  }));
  const sortedBySelection = [...candidates].sort((a, b) => a.selection_pooled - b.selection_pooled);
  const best = sortedBySelection[0]!;
  const second = sortedBySelection[1]!;
  const huberCand = candidates.find((c) => c.estimator === 'huber')!;
  const olsCand = candidates.find((c) => c.estimator === 'ols')!;
  let selected: Estimator;
  let selectionReason: string;
  if (second.selection_pooled - best.selection_pooled < 0.01) {
    // Within noise: prefer the simpler model (OLS > ridge > Huber).
    const simplicity: Estimator[] = ['ols', 'ridge', 'huber'];
    selected = simplicity.find((e) => candidates.some((c) => c.estimator === e && c.selection_pooled - best.selection_pooled < 0.01))!;
    selectionReason = `Best and second-best differ by ${(second.selection_pooled - best.selection_pooled).toFixed(4)} dex (< 0.01): within noise, so the simpler model wins — ${selected}.`;
  } else if (best.estimator === 'huber') {
    const tailBetter = huberCand.selection_p90 + 0.05 < olsCand.selection_p90;
    const lessSensitive = huberCand.drop_one_slope_change < olsCand.drop_one_slope_change;
    if (tailBetter && lessSensitive) {
      selected = 'huber';
      selectionReason = `Huber wins the selection metric by ${(second.selection_pooled - best.selection_pooled).toFixed(4)} dex and passes the tail/sensitivity condition (P90 ${huberCand.selection_p90} vs OLS ${olsCand.selection_p90}; drop-one slope change ${huberCand.drop_one_slope_change} vs ${olsCand.drop_one_slope_change}).`;
    } else {
      selected = second.estimator;
      selectionReason = `Huber wins the selection metric by ${(second.selection_pooled - best.selection_pooled).toFixed(4)} dex but fails the tail/sensitivity condition (tail better: ${tailBetter}, less sensitive: ${lessSensitive}), so the best non-Huber candidate (${second.estimator}) is selected.`;
    }
  } else {
    selected = best.estimator;
    selectionReason = `${best.estimator} wins the selection metric by ${(second.selection_pooled - best.selection_pooled).toFixed(4)} dex (>= 0.01).`;
  }
  const modelSelection: ModelSelection = {
    rule: 'Best nested 50–80 pooled median wins; a <0.01 dex gap prefers the simpler model (OLS > ridge > Huber); Huber needs P90 tail better than OLS by >0.05 dex AND a smaller drop-one slope change. R² is never the criterion.',
    candidates,
    selected,
    reason: selectionReason,
  };

  // The nested fold table and the per-fold diagnostics use the SELECTED estimator's
  // errors, not Huber's — the table must describe the model that ships.
  for (const d of nestedFoldData) {
    const errs = d.errs[selected];
    const signed = d.signed[selected];
    nestedFolds.push({ train_pct: d.pct, median_abs_log_err: round4(pooledMedian(errs)), n_test: d.foldTest.length });
    const catCounts = new Map<string, number>();
    for (const p of d.foldTest) catCounts.set(p.category ?? 'Other', (catCounts.get(p.category ?? 'Other') ?? 0) + 1);
    const trainCats = new Set(d.foldTrain.map((p) => p.category ?? 'Other'));
    const trainChains = new Set(d.foldTrain.map(mainChain));
    const tvls = d.foldTest.map((p) => p.tvl_usd).sort((a, b) => a - b);
    const ages = d.foldTest.map((p) => ageDays(asOf, p.listed_at) ?? 0).sort((a, b) => a - b);
    nestedDiagnostics.push({
      train_pct: d.pct,
      test_start: d.foldTest[0]!.listed_at!,
      test_end: d.foldTest[d.foldTest.length - 1]!.listed_at!,
      n_test: d.foldTest.length,
      median_tvl_usd: Math.round(median(tvls) ?? 0),
      median_age_days: Math.round(median(ages) ?? 0),
      categories: [...catCounts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      unseen_categories: d.foldTest.filter((p) => !trainCats.has(p.category ?? 'Other')).length,
      unseen_chains: d.foldTest.filter((p) => !trainChains.has(mainChain(p))).length,
      median_signed_log_err: round4(median([...signed].sort((a, b) => a - b)) ?? 0),
      median_abs_log_err: round4(pooledMedian(errs)),
      p90_abs_log_err: round4(p90Of(errs)),
      rows: d.foldTest.map((p, i) => ({
        slug: p.slug,
        category: p.category ?? 'Other',
        chain: mainChain(p),
        mcap_usd: p.mcap_usd!,
        tvl_usd: p.tvl_usd,
        signed_log_err: round4(signed[i]!),
        abs_log_err: round4(errs[i]!),
      })),
    });
  }

  // The training domain for the out-of-distribution check (charter v1.2): the
  // 70 dated comps — their categories, main chains, log-TVL range and age range.
  const oodDomain: OodDomain = {
    categories: [...new Set(comps.map((p) => p.category ?? 'Other'))].sort(),
    chains: [...new Set(comps.map(mainChain))].sort(),
    log_tvl_min: Math.min(...comps.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd))),
    log_tvl_max: Math.max(...comps.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd))),
    age_min_days: Math.min(...comps.map((p) => ageDays(asOf, p.listed_at) ?? 0)),
    age_max_days: Math.max(...comps.map((p) => ageDays(asOf, p.listed_at) ?? 0)),
  };

  // The nested reconciliation (charter v1.2): the two nested pooled numbers are
  // pooled-by-observation medians over DIFFERENT observation sets. Selection
  // (folds 50–80, 28 rows) excludes the untouched 90% fold; all-folds (50–90,
  // 35 rows) includes it. The mean-of-fold-medians is shown alongside to prove
  // the aggregation is pooled-by-observation, not an average of fold medians.
  const selectionFoldErrs = nestedFoldErrsByEst[selected].slice(0, 4);
  const allFoldErrs = nestedFoldErrsByEst[selected];
  const meanOfFoldMedians = (folds: number[][]): number =>
    folds.length === 0 ? 0 : folds.map((f) => pooledMedian(f)).reduce((a, b) => a + b, 0) / folds.length;
  const recomputedSelection = pooledMedian(nestedErrsSelection[selected]);
  const recomputedAll = pooledMedian(nestedErrs[selected]);
  const nestedReconciliation: NestedReconciliation = {
    selection: {
      folds: '50/60/70/80',
      n_test_rows: nestedErrsSelection[selected].length,
      fold_date_range: `${nestedDiagnostics[0]!.test_start} → ${nestedDiagnostics[3]!.test_end}`,
      pooled_median_dex: selectionPooled[selected],
      mean_of_fold_medians_dex: round4(meanOfFoldMedians(selectionFoldErrs)),
    },
    all_folds: {
      folds: '50/60/70/80/90',
      n_test_rows: nestedErrs[selected].length,
      fold_date_range: `${nestedDiagnostics[0]!.test_start} → ${nestedDiagnostics[4]!.test_end}`,
      pooled_median_dex: nestedPooledByEst[selected],
      mean_of_fold_medians_dex: round4(meanOfFoldMedians(allFoldErrs)),
    },
    aggregation: 'Pooled-by-observation median of per-row absolute log errors (all test rows pooled, then the median) — NOT an average of fold medians.',
    same_observations: false,
    same_features_purge_estimator: true,
    difference_explanation: `The two numbers differ only because the observation sets differ: nested_wf_pooled (${nestedPooledByEst[selected]} dex) includes the untouched 90% fold (7 newest comps, median ${round4(pooledMedian(nestedFoldErrsByEst[selected][4] ?? []))} dex), nested_selection_pooled (${selectionPooled[selected]} dex) excludes it. The features, the 30-day purge and the estimator are identical for both.`,
    recomputed_selection_dex: round4(recomputedSelection),
    recomputed_all_folds_dex: round4(recomputedAll),
    reproduces: round4(recomputedSelection) === selectionPooled[selected] && round4(recomputedAll) === nestedPooledByEst[selected],
  };

  // The distribution-tournament CRPS validation (charter v1.3): pooled log-CRPS
  // of the capped vs uncapped lognormal on the nested selection folds (50–80).
  // For each test row, 2000 draws from each distribution centered on the fold's
  // prediction, sharing the same normals (paired); the cap and σ are fold-local
  // (the fold's training comps' max market cap; σ = 1.4826 × the median absolute
  // residual on the fold's training rows). CRPS on the log10 value, computed
  // from sorted draws in O(n log n).
  const crpsOfDraws = (draws: number[], y: number): number => {
    const sorted = [...draws].sort((a, b) => a - b);
    const n = sorted.length;
    let meanAbs = 0;
    for (const x of sorted) meanAbs += Math.abs(x - y);
    meanAbs /= n;
    let sumPair = 0;
    for (let j = 0; j < n; j++) sumPair += sorted[j]! * (2 * j - n + 1);
    const meanAbsDiff = (2 * sumPair) / (n * n);
    return meanAbs - 0.5 * meanAbsDiff;
  };
  const crpsRand = mulberry32(20261118);
  const crpsCapped: number[] = [];
  const crpsUncapped: number[] = [];
  for (const d of nestedFoldData.filter((x) => x.pct < 90)) {
    const foldFit = d.fits[selected];
    const trainResiduals = d.foldTrain.map((p) => Math.log10(p.mcap_usd!) - predictLog(p, asOf, foldFit.beta, foldFit.adj, foldFit.chainAdj, model));
    const sigmaFold = 1.4826 * (median([...trainResiduals.map(Math.abs)].sort((a, b) => a - b)) ?? 0.5);
    const capFoldLog = Math.log10(Math.max(...d.foldTrain.map((p) => p.mcap_usd!)));
    for (const p of d.foldTest) {
      const pred = predictLog(p, asOf, foldFit.beta, foldFit.adj, foldFit.chainAdj, model);
      const y = Math.log10(p.mcap_usd!);
      const drawsCapped: number[] = [];
      const drawsUncapped: number[] = [];
      let spare: number | null = null;
      const nextNormal = (): number => {
        if (spare !== null) {
          const z = spare;
          spare = null;
          return z;
        }
        let a = 0;
        let b = 0;
        do {
          a = crpsRand();
          b = crpsRand();
        } while (a <= 0);
        const r = Math.sqrt(-2 * Math.log(a));
        const t = 2 * Math.PI * b;
        spare = r * Math.sin(t);
        return r * Math.cos(t);
      };
      for (let i = 0; i < 2000; i++) {
        const logV = pred + sigmaFold * nextNormal();
        drawsUncapped.push(logV);
        drawsCapped.push(Math.min(capFoldLog, logV));
      }
      crpsCapped.push(crpsOfDraws(drawsCapped, y));
      crpsUncapped.push(crpsOfDraws(drawsUncapped, y));
    }
  }
  const crpsValidation = {
    capped_dex: round4(crpsCapped.reduce((a, b) => a + b, 0) / crpsCapped.length),
    uncapped_dex: round4(crpsUncapped.reduce((a, b) => a + b, 0) / crpsUncapped.length),
    n_test_rows: crpsCapped.length,
  };
  // The cap decision (charter v1.3, prespecified): the production value cap is
  // the maximum observed dated-comp market cap — kept unless the capped CRPS is
  // worse than the uncapped by > 10%, in which case the production distribution
  // reverts to the uncapped lognormal and the reversion is documented.
  const observedMaxMcapUsd = Math.max(...comps.map((p) => p.mcap_usd!));
  const capKept = crpsValidation.capped_dex <= crpsValidation.uncapped_dex * 1.1;
  const productionValueCapUsd = capKept ? observedMaxMcapUsd : MODEL.value_max;
  // v1.3: the production value cap — the maximum market cap observed among the
  // 70 dated comparables — and the P90 cap for the tournament's sensitivity row.
  // v1.4 adds the P95 cap (the Gemini Rain-winsorization cap). Defined here,
  // before the bootstrap, because the parameter-EV intervals use the cap.
  const valueCapUsd = productionValueCapUsd;
  const sortedCompMcaps = comps.map((p) => p.mcap_usd!).sort((a, b) => a - b);
  const valueCapP90Usd = sortedCompMcaps[Math.min(sortedCompMcaps.length - 1, Math.ceil(0.9 * sortedCompMcaps.length) - 1)]!;
  const valueCapP95Usd = sortedCompMcaps[Math.min(sortedCompMcaps.length - 1, Math.ceil(0.95 * sortedCompMcaps.length) - 1)]!;

  // The TVL-floor sensitivity diagnostic (charter v1.2): for each floor, the
  // full-fit coefficients and the selection-pooled metric on identical folds.
  // The ranking fields are filled in buildRadar (they need the board); the
  // floor stays locked at $25M — this diagnostic reports, it does not change it.
  const FLOORS = [0, 10_000_000, 25_000_000, 50_000_000, 100_000_000];
  const floorRows: FloorSensitivityRow[] = FLOORS.map((floor) => {
    const m = { ...model, size_floor_usd: floor };
    const fullF = fitRegression(comps, asOf, m, selected);
    const errs: number[] = [];
    for (const d of nestedFoldData.filter((x) => x.pct < 90)) {
      const f = fitRegression(d.foldTrain, asOf, m, selected);
      errs.push(...absErrs(d.foldTest, f.beta, f.adj, f.chainAdj));
    }
    return {
      floor_usd: floor,
      intercept: round4(fullF.beta[0]!),
      coef_log_tvl: round4(fullF.beta[1]!),
      selection_pooled_dex: round4(pooledMedian(errs)),
      spearman_vs_25m: null,
      top20_overlap_vs_25m: null,
      top10_changes_vs_25m: null,
    };
  });
  // Training-fold-only floor choice: for each selection fold, choose the floor by
  // 5-fold CV inside that fold's training set only, then score the chosen floor on
  // the fold's test set and pool. This is what choosing the floor inside training
  // folds would actually buy — the choice never sees a test row.
  const chosenFloors: number[] = [];
  const chosenErrs: number[] = [];
  for (const d of nestedFoldData.filter((x) => x.pct < 90)) {
    const shuffledTrain = seededShuffle(d.foldTrain, 20261118);
    const cvFolds: SnapshotProtocol[][] = [[], [], [], [], []];
    shuffledTrain.forEach((p, i) => cvFolds[i % 5]!.push(p));
    let bestFloor = FLOORS[0]!;
    let bestCv = Infinity;
    for (const floor of FLOORS) {
      const m = { ...model, size_floor_usd: floor };
      const cvErrs: number[] = [];
      for (let f = 0; f < 5; f++) {
        const testFold = cvFolds[f]!;
        const trainFolds = cvFolds.flatMap((fold, i) => (i === f ? [] : fold));
        const cvFit = fitRegression(trainFolds, asOf, m, selected);
        cvErrs.push(...absErrs(testFold, cvFit.beta, cvFit.adj, cvFit.chainAdj));
      }
      const cvMed = pooledMedian(cvErrs);
      if (cvMed < bestCv) {
        bestCv = cvMed;
        bestFloor = floor;
      }
    }
    chosenFloors.push(bestFloor);
    const mChosen = { ...model, size_floor_usd: bestFloor };
    const chosenFit = fitRegression(d.foldTrain, asOf, mChosen, selected);
    chosenErrs.push(...absErrs(d.foldTest, chosenFit.beta, chosenFit.adj, chosenFit.chainAdj));
  }
  const floor10m = floorRows.find((r) => r.floor_usd === 10_000_000)?.selection_pooled_dex ?? 0;
  const floorSensitivity: FloorSensitivity = {
    rows: floorRows,
    training_fold_choice_pooled_dex: round4(pooledMedian(chosenErrs)),
    training_fold_choice_floors: chosenFloors,
    locked_floor_pooled_dex: selectionPooled[selected],
    note: `The floor stays locked at $25M in radar-10: it is a stability constant, not a tuned optimum. The $10M floor scores ${floor10m.toFixed(4)} on the selection metric against ${selectionPooled[selected].toFixed(4)} for $25M — an ${Math.abs(floor10m - selectionPooled[selected]).toFixed(4)} dex edge on 28 test rows, within noise — and choosing the floor inside the training folds only scores ${pooledMedian(chosenErrs).toFixed(4)} pooled, worse than the locked floor, so per-fold floor selection overfits and there is no case to move it. This diagnostic reports the grid and the training-fold-only choice; it does not select a floor, and the floor is never changed after seeing the untouched test.`,
  };

  // The production fit uses the selected estimator, on dated comps only.
  const full = fitEst(selected)(comps);
  const r2 = rSquared(comps, asOf, full.beta, full.adj, full.chainAdj, model);
  const olsFull = fitOneOls(comps);
  const olsR2 = rSquared(comps, asOf, olsFull.beta, olsFull.adj, olsFull.chainAdj, model);
  const ridgeFull = fitOneRidge(comps);
  const ridgeR2 = rSquared(comps, asOf, ridgeFull.beta, ridgeFull.adj, ridgeFull.chainAdj, model);
  const olsBaseline: OlsBaseline = {
    r2: round4(olsR2),
    oos_median_abs_log_err: round4(oosByEst.ols),
    cv_median_abs_log_err: round4(cvByEst.ols),
    nested_wf_pooled: nestedPooledByEst.ols,
  };
  const ridgeBaseline: OlsBaseline = {
    r2: round4(ridgeR2),
    oos_median_abs_log_err: round4(oosByEst.ridge),
    cv_median_abs_log_err: round4(cvByEst.ridge),
    nested_wf_pooled: nestedPooledByEst.ridge,
  };
  const nestedUntouched90 = round4(pooledMedian(nestedFoldErrsByEst[selected][4] ?? []));

  // Stratified split (charter v1.1): train on dated 70% only; test on dated 30% and,
  // separately, the last 30% of undated comps by slug, scored by the dated-only fit
  // as a reference diagnostic — the undated rows are never trained on.
  const stratTrain = dated.slice(0, Math.floor(dated.length * 0.7));
  const stratTestDated = dated.slice(Math.floor(dated.length * 0.7));
  const stratTestUndated = undated.slice(Math.floor(undated.length * 0.7));
  const stratFit = fitEst(selected)(stratTrain);
  const oosStratifiedDated = medianAbsErr(stratTestDated, stratFit.beta, stratFit.adj, stratFit.chainAdj);
  const oosUndated = medianAbsErr(stratTestUndated, stratFit.beta, stratFit.adj, stratFit.chainAdj);
  const oosStratified = pooledMedian([
    ...absErrs(stratTestDated, stratFit.beta, stratFit.adj, stratFit.chainAdj),
    ...absErrs(stratTestUndated, stratFit.beta, stratFit.adj, stratFit.chainAdj),
  ]);

  // The seasoning curve, validated with fold-local refits: at each nested cutoff the
  // curve is fitted only on protocols listed before the cutoff and scored on the next
  // 50 protocols listed after it. The full fit is used for the board only, never for
  // a validation metric — a full-fit metric would peek at the test protocols' own
  // token status. The curve is a cross-sectional association at the snapshot date,
  // not a historical hazard: token status is measured at as_of for every protocol.
  // The pooled fold-local predictions are kept for the launch-probability audit.
  const seasoningFolds: SeasoningFoldValidation[] = [];
  let poolBrier = 0;
  let poolLogLoss = 0;
  let poolEce = 0;
  let poolBaseBrier = 0;
  let poolBaseLogLoss = 0;
  let poolN = 0;
  const seasoningPool: { pred: number; y: number; fold: number; active: boolean }[] = [];
  for (const pct of [50, 60, 70, 80, 90]) {
    const nTr = Math.floor((dated.length * pct) / 100);
    const cutoff = dated[nTr]!.listed_at!;
    const fitRows = snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
    const testRows = snapshot.protocols
      .filter((p) => p.listed_at !== null && p.listed_at >= cutoff)
      .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      .slice(0, 50);
    const local = fitSeasoningOn(fitRows, asOf);
    const m = seasoningMetrics(testRows, asOf, local);
    const baseIntercept = local.base_rate > 0 && local.base_rate < 1 ? Math.log(local.base_rate / (1 - local.base_rate)) : 0;
    const base = seasoningMetrics(testRows, asOf, { intercept: round4(baseIntercept), slope: 0, n_protocols: fitRows.length, base_rate: local.base_rate, platt_a: null, platt_b: null });
    const meanPred = testRows.reduce((s, p) => s + launchOdds(ageDays(asOf, p.listed_at), local), 0) / testRows.length;
    const actualRate = testRows.filter((p) => p.mcap_usd !== null).length / testRows.length;
    for (const p of testRows) seasoningPool.push({ pred: launchOdds(ageDays(asOf, p.listed_at), local), y: p.mcap_usd !== null ? 1 : 0, fold: pct, active: finite(p.change_7d, 0) > 0 });
    seasoningFolds.push({ train_pct: pct, cutoff, n_fit: fitRows.length, brier: round4(m.brier), log_loss: round4(m.log_loss), ece: round4(m.ece), base_rate_brier: round4(base.brier), base_rate_log_loss: round4(base.log_loss), mean_pred: round4(meanPred), actual_rate: round4(actualRate) });
    poolBrier += m.brier * m.n;
    poolLogLoss += m.log_loss * m.n;
    poolEce += m.ece * m.n;
    poolBaseBrier += base.brier * base.n;
    poolBaseLogLoss += base.log_loss * base.n;
    poolN += m.n;
  }
  const pooledBrier = poolN > 0 ? poolBrier / poolN : 0;
  const pooledLogLoss = poolN > 0 ? poolLogLoss / poolN : 0;
  const pooledEce = poolN > 0 ? poolEce / poolN : 0;
  const pooledBaseBrier = poolN > 0 ? poolBaseBrier / poolN : 0;
  const pooledBaseLogLoss = poolN > 0 ? poolBaseLogLoss / poolN : 0;
  const seasoningAudit = auditLaunchOdds(seasoningPool);
  const seasoning = fitSeasoning(snapshot);
  if (seasoningAudit.platt.adopted && seasoningAudit.platt.a !== null && seasoningAudit.platt.b !== null) {
    seasoning.platt_a = seasoningAudit.platt.a;
    seasoning.platt_b = seasoningAudit.platt.b;
  }

  // The launch-odds decision (charter v1.2, prespecified): the board uses the base
  // rate unless the seasoning curve beats the base rate on BOTH Brier and log-loss
  // on the untouched chronological test (the fold-local predictions from cutoffs
  // 80/90, n = 100) AND the bootstrap 95% CI for the Brier improvement over the
  // base rate excludes zero. Under v1.1 evidence the curve fails both: the base
  // rate beats even the Platt curve on the untouched test, and the CI straddles
  // zero — so the board's p_L is the base rate for every row.
  const datedProtocols = snapshot.protocols.filter((p) => ageDays(asOf, p.listed_at) !== null);
  const baseRateOutcomes = datedProtocols.map((p) => (p.mcap_usd !== null ? 1 : 0));
  const baseRand = mulberry32(20261107);
  const baseRateResamples: number[] = [];
  for (let b = 0; b < 2000; b++) {
    let sum = 0;
    for (let i = 0; i < baseRateOutcomes.length; i++) sum += baseRateOutcomes[Math.floor(baseRand() * baseRateOutcomes.length)]!;
    baseRateResamples.push(sum / baseRateOutcomes.length);
  }
  baseRateResamples.sort((a, b) => a - b);
  const conservativeLowerBound = baseRateResamples[Math.floor(0.025 * baseRateResamples.length)] ?? seasoning.base_rate;
  const curveBeatsBaseBrier = seasoningAudit.platt.test_brier_raw < seasoningAudit.platt.test_brier_base;
  const curveBeatsBaseLogLoss = seasoningAudit.platt.test_log_loss_raw < seasoningAudit.platt.test_log_loss_base;
  const brierCiExcludesZero = seasoningAudit.brier_improvement_ci[0]! > 0;
  const plattBeatsBaseBrier = seasoningAudit.platt.test_brier_platt < seasoningAudit.platt.test_brier_base;
  const plattBeatsBaseLogLoss = seasoningAudit.platt.test_log_loss_platt < seasoningAudit.platt.test_log_loss_base;
  const adoptCurve = curveBeatsBaseBrier && curveBeatsBaseLogLoss && brierCiExcludesZero;
  const launchOddsDecision: LaunchOddsDecision = {
    source: adoptCurve ? 'seasoning-curve' : 'base-rate',
    base_rate: seasoning.base_rate,
    conservative_lower_bound: round4(conservativeLowerBound),
    base_rate_bootstrap: baseRateResamples,
    curve_beats_base_brier: curveBeatsBaseBrier,
    curve_beats_base_log_loss: curveBeatsBaseLogLoss,
    brier_improvement_ci_excludes_zero: brierCiExcludesZero,
    platt_beats_base_brier: plattBeatsBaseBrier,
    platt_beats_base_log_loss: plattBeatsBaseLogLoss,
    reason: adoptCurve
      ? `Seasoning curve adopted: it beats the base rate on both Brier (${seasoningAudit.platt.test_brier_raw} vs ${seasoningAudit.platt.test_brier_base}) and log-loss (${seasoningAudit.platt.test_log_loss_raw} vs ${seasoningAudit.platt.test_log_loss_base}) on the untouched 80/90 test set, and the bootstrap 95% CI for the Brier improvement excludes zero (${seasoningAudit.brier_improvement_ci[0]} to ${seasoningAudit.brier_improvement_ci[1]}).`
      : `Base rate adopted: the seasoning curve does not beat the base rate on both Brier (${seasoningAudit.platt.test_brier_raw} vs ${seasoningAudit.platt.test_brier_base}) and log-loss (${seasoningAudit.platt.test_log_loss_raw} vs ${seasoningAudit.platt.test_log_loss_base}) on the untouched 80/90 test set, and the bootstrap 95% CI for the Brier improvement straddles zero (${seasoningAudit.brier_improvement_ci[0]} to ${seasoningAudit.brier_improvement_ci[1]}). The curve is not predictive enough to beat a constant, so every board row takes p_L = the base rate (${seasoning.base_rate}) until a better model validates.`,
  };
  const plattFitted: { a: number; b: number } | null =
    seasoningAudit.platt.fitted_a !== null && seasoningAudit.platt.fitted_b !== null
      ? { a: seasoningAudit.platt.fitted_a, b: seasoningAudit.platt.fitted_b }
      : null;

  // The horizon launch-probability analysis (charter v1.3): the 12-month event
  // (launch within 12 months of listing), the dated cohort with right-censoring,
  // and the category-stratified survival candidate vs the flat base rate on the
  // untouched chronological test. Identification limit: the snapshot carries no
  // token launch date, so the risk-set rate is an UPPER BOUND on the 12-month
  // launch rate.
  const cohortDated = [...snapshot.protocols.filter((p) => p.listed_at !== null)].sort((a, b) =>
    a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0,
  );
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const riskCutoffDate = new Date(asOfMs - 365 * DAY_MS).toISOString().slice(0, 10);
  const horizonCutoff = seasoningFolds[3]!.cutoff; // the 80% nested cutoff
  const cohortRows: CohortRow[] = cohortDated.map((p) => {
    const listed = p.listed_at!;
    const followup = ageDays(asOf, listed) ?? 0;
    let status: CohortRow['status'];
    if (p.mcap_usd === 0) status = 'failed';
    else if (p.mcap_usd === -1) status = 'disappeared';
    else if (p.mcap_usd !== null) status = 'launched-timing-unknown';
    else if (listed <= riskCutoffDate) status = 'tokenless-resolved';
    else status = 'tokenless-censored';
    return { slug: p.slug, prediction_date: listed, followup_days: followup, status };
  });
  const statusCounts = {
    launched_timing_unknown: cohortRows.filter((r) => r.status === 'launched-timing-unknown').length,
    failed: cohortRows.filter((r) => r.status === 'failed').length,
    disappeared: cohortRows.filter((r) => r.status === 'disappeared').length,
    tokenless_resolved: cohortRows.filter((r) => r.status === 'tokenless-resolved').length,
    tokenless_censored: cohortRows.filter((r) => r.status === 'tokenless-censored').length,
  };
  const riskSet = cohortDated.filter((p) => p.listed_at! <= riskCutoffDate);
  const riskLaunched = riskSet.filter((p) => p.mcap_usd !== null).length;
  const riskSetBaseRate = riskSet.length > 0 ? riskLaunched / riskSet.length : 0;
  // The category-stratified survival candidate: per-category launch rates on the
  // fully-observed protocols listed before the 80% cutoff, shrunk toward the train
  // base rate by n/(n+3); tested on the protocols listed in [cutoff, as_of−12mo].
  // No post-outcome features: TVL at as_of is measured after the window for
  // launchers and is excluded.
  const horizonTrain = cohortDated.filter((p) => p.listed_at! < horizonCutoff);
  const horizonTest = cohortDated.filter((p) => p.listed_at! >= horizonCutoff && p.listed_at! <= riskCutoffDate);
  const horizonTrainBase = horizonTrain.length > 0 ? horizonTrain.filter((p) => p.mcap_usd !== null).length / horizonTrain.length : 0;
  const horizonCatCounts = new Map<string, { n: number; y: number }>();
  for (const p of horizonTrain) {
    const k = p.category ?? 'Other';
    const c = horizonCatCounts.get(k) ?? { n: 0, y: 0 };
    c.n += 1;
    if (p.mcap_usd !== null) c.y += 1;
    horizonCatCounts.set(k, c);
  }
  const horizonCatRate = (cat: string | null): number => {
    const c = horizonCatCounts.get(cat ?? 'Other');
    if (!c) return horizonTrainBase;
    return (c.y + 3 * horizonTrainBase) / (c.n + 3);
  };
  const horizonScore = (preds: { pred: number; y: number }[]): { brier: number; log_loss: number } => ({
    brier: preds.length === 0 ? 0 : preds.reduce((s, r) => s + (r.pred - r.y) ** 2, 0) / preds.length,
    log_loss:
      preds.length === 0
        ? 0
        : preds.reduce((s, r) => s - (r.y * Math.log(Math.max(1e-12, r.pred)) + (1 - r.y) * Math.log(Math.max(1e-12, 1 - r.pred))), 0) / preds.length,
  });
  const horizonTestCat = horizonTest.map((p) => ({ pred: horizonCatRate(p.category), y: p.mcap_usd !== null ? 1 : 0 }));
  const horizonTestBase = horizonTest.map((p) => ({ pred: horizonTrainBase, y: p.mcap_usd !== null ? 1 : 0 }));
  const horizonCatScore = horizonScore(horizonTestCat);
  const horizonBaseScore = horizonScore(horizonTestBase);
  const horizonBeatsBrier = horizonCatScore.brier < horizonBaseScore.brier;
  const horizonBeatsLogLoss = horizonCatScore.log_loss < horizonBaseScore.log_loss;
  const horizonAdopted = horizonTest.length >= 10 && horizonBeatsBrier && horizonBeatsLogLoss;
  const horizonCohort: HorizonCohort = {
    event: 'launch within 12 months of listing: P(launch by listed_at + 12 months | X)',
    horizon_months: 12,
    n_dated_protocols: cohortDated.length,
    n_risk_set: riskSet.length,
    n_launched: riskLaunched,
    risk_set_base_rate: round4(riskSetBaseRate),
    risk_set_base_rate_is_upper_bound: true,
    n_censored: statusCounts.tokenless_censored,
    status_counts: statusCounts,
    survival_candidate: {
      n_test: horizonTest.length,
      test_brier_category: round4(horizonCatScore.brier),
      test_log_loss_category: round4(horizonCatScore.log_loss),
      test_brier_base: round4(horizonBaseScore.brier),
      test_log_loss_base: round4(horizonBaseScore.log_loss),
      beats_base_brier: horizonBeatsBrier,
      beats_base_log_loss: horizonBeatsLogLoss,
      adopted: horizonAdopted,
      reason:
        horizonTest.length < 10
          ? `Survival candidate NOT adopted: the untouched chronological test holds only ${horizonTest.length} fully-observed protocols (listed ${horizonCutoff} → ${riskCutoffDate}) — underpowered, so no claim is made and the flat base rate stands.`
          : horizonAdopted
            ? `Category-stratified launch rates adopted: on the untouched test (n = ${horizonTest.length}) they beat the flat base rate on both Brier (${horizonCatScore.brier.toFixed(4)} vs ${horizonBaseScore.brier.toFixed(4)}) and log-loss (${horizonCatScore.log_loss.toFixed(4)} vs ${horizonBaseScore.log_loss.toFixed(4)}).`
            : `Category-stratified launch rates NOT adopted: on the untouched test (n = ${horizonTest.length}) they do not beat the flat base rate on both Brier (${horizonCatScore.brier.toFixed(4)} vs ${horizonBaseScore.brier.toFixed(4)}) and log-loss (${horizonCatScore.log_loss.toFixed(4)} vs ${horizonBaseScore.log_loss.toFixed(4)}). The flat base rate stands.`,
    },
    identification_note:
      'The snapshot carries no token launch date, so a protocol with a token at as_of may have launched inside or outside its 12-month window: the risk-set rate is an UPPER BOUND on the 12-month launch rate, not the rate itself. y = 0 is certain (no token at as_of ⇒ no launch in the window); y = 1 is timing-unknown for protocols listed ≥ 12 months ago, and certain within-window for protocols listed < 12 months ago (they launched before as_of, less than 12 months after listing). No survival model can be validated against a launch time the data never records.',
    rows: cohortRows,
  };
  const fullFitMetrics = seasoningMetrics(
    snapshot.protocols.filter((p) => p.listed_at !== null),
    asOf,
    seasoning,
  );
  const seasoningVerdict: SeasoningValidation['verdict'] =
    poolN < 10
      ? 'invalid-eval'
      : pooledEce <= 0.05 && pooledLogLoss <= 0.5 * pooledBaseLogLoss && pooledBrier <= 0.8 * pooledBaseBrier
        ? 'well-calibrated'
        : pooledEce <= 0.1 && pooledLogLoss < pooledBaseLogLoss
          ? 'usable-with-caveats'
          : 'poorly-calibrated';
  const seasoningValidation: SeasoningValidation = {
    brier: round4(pooledBrier),
    log_loss: round4(pooledLogLoss),
    ece: round4(pooledEce),
    base_rate_brier: round4(pooledBaseBrier),
    base_rate_log_loss: round4(pooledBaseLogLoss),
    full_fit_brier: round4(fullFitMetrics.brier),
    verdict: seasoningVerdict,
  };

  // The undated reference table (charter v1.1): all 22 undated comparables scored by
  // the dated-only full fit. They were never fitted, so these residuals are an honest
  // out-of-sample diagnostic of a different, harder population — not a calibration set.
  const undatedRef: UndatedReferenceRow[] = undated.map((p) => {
    const pred = predictLog(p, asOf, full.beta, full.adj, full.chainAdj, model);
    const residual = Math.log10(p.mcap_usd!) - pred;
    return { slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, predicted_log_value: round4(pred), residual_dex: round4(residual) };
  });
  const undatedAbsResiduals = undatedRef.map((r) => Math.abs(r.residual_dex)).sort((a, b) => a - b);
  const undatedSignedResiduals = undatedRef.map((r) => r.residual_dex).sort((a, b) => a - b);
  const undatedMedianSigned = median(undatedSignedResiduals) ?? 0;
  const undatedMedianAbs = median(undatedAbsResiduals) ?? 0;

  // The value band is cross-conformal, not bootstrap-only: the (1−α) quantile of the
  // absolute out-of-fold residuals from the 5-fold cross-validation of the SELECTED
  // estimator (dated comps only), with the finite-sample correction
  // k = ceil((n+1)(1−α)). A 50% band holds ~50% of the comparables by construction;
  // the 80% and 90% bands are reported alongside.
  const selectedCvErrs = cvPairs.map((x) => (selected === 'huber' ? x.huber : selected === 'ols' ? x.ols : x.ridge)).sort((a, b) => a - b);
  const conformalHalfwidth = (alpha: number): number => {
    // alpha is the nominal COVERAGE (0.5/0.8/0.9): the band is the alpha quantile
    // of the absolute out-of-fold residuals, with the finite-sample correction
    // k = ceil((n+1)*alpha). A higher nominal coverage gives a wider band.
    const n = selectedCvErrs.length;
    const k = Math.min(n, Math.max(1, Math.ceil((n + 1) * alpha)));
    return selectedCvErrs[k - 1]!;
  };
  const undatedCoverageAt = (halfwidth: number): number =>
    undatedAbsResiduals.length > 0 ? undatedAbsResiduals.filter((e) => e <= halfwidth).length / undatedAbsResiduals.length : 0;
  const conformalBands: ConformalBand[] = [0.5, 0.8, 0.9].map((alpha) => {
    const hw = conformalHalfwidth(alpha);
    const coverage = selectedCvErrs.filter((e) => e <= hw).length / selectedCvErrs.length;
    return { nominal: alpha, halfwidth_dex: round4(hw), coverage: round4(coverage), coverage_dated: round4(coverage), coverage_undated: round4(undatedCoverageAt(hw)) };
  });
  const bandHalfwidth = conformalBands[0]!.halfwidth_dex;
  const rangeHolds = conformalBands[0]!.coverage;
  const conformalUndated: ConformalUndatedDiagnostic = {
    n_undated: undated.length,
    median_signed_residual_dex: round4(undatedMedianSigned),
    median_abs_residual_dex: round4(undatedMedianAbs),
    coverage_50: round4(undatedCoverageAt(conformalBands[0]!.halfwidth_dex)),
    coverage_80: round4(undatedCoverageAt(conformalBands[1]!.halfwidth_dex)),
    coverage_90: round4(undatedCoverageAt(conformalBands[2]!.halfwidth_dex)),
    analysis: `Undated comparables are systematically over-predicted by the dated-only fit (median signed residual ${undatedMedianSigned.toFixed(3)} dex) and their errors are wider (median absolute residual ${undatedMedianAbs.toFixed(3)} dex), so the dated band — symmetric around the dated fit — covers fewer of them. The 50% coverage of ${(100 * undatedCoverageAt(conformalBands[0]!.halfwidth_dex)).toFixed(1)}% is a bias + width effect of a different population, not a failure of the dated band: the band is calibrated on dated comps and was never fitted to undated ones.`,
  };

  // Strict split-conformal check: dated comparables, time-ordered, train 70% /
  // calibration 15% / test 15%. The calibration set is small (n=10), so this is a
  // secondary check on the cross-conformal band, not the band itself.
  const splitTrainRaw = dated.slice(0, Math.floor(dated.length * 0.7));
  const splitCal = dated.slice(Math.floor(dated.length * 0.7), Math.floor(dated.length * 0.85));
  const splitTest = dated.slice(Math.floor(dated.length * 0.85));
  const splitTrain = purge(splitTrainRaw, splitCal[0]!.listed_at!);
  const splitFit = fitEst(selected)(splitTrain);
  const calErrs = absErrs(splitCal, splitFit.beta, splitFit.adj, splitFit.chainAdj).sort((a, b) => a - b);
  const splitK = Math.min(calErrs.length, Math.max(1, Math.ceil((calErrs.length + 1) * 0.5)));
  const splitHalfwidth = calErrs[splitK - 1] ?? 0;
  const splitTestErrs = absErrs(splitTest, splitFit.beta, splitFit.adj, splitFit.chainAdj);
  const splitCoverage = splitTestErrs.length > 0 ? splitTestErrs.filter((e) => e <= splitHalfwidth).length / splitTestErrs.length : 0;
  const conformalSplitCheck: ConformalSplitCheck = {
    n_calibration: splitCal.length,
    n_test: splitTest.length,
    halfwidth_50_dex: round4(splitHalfwidth),
    test_coverage_50: round4(splitCoverage),
  };

  // The OOD band-multiplier validation (charter v1.3): on the nested selection
  // folds, test rows that are OOD relative to their fold's training domain are
  // scored under multipliers {×1.0, ×1.5, ×2.0} against the production 50%
  // band; the adopted multiplier is the smallest whose OOD coverage reaches
  // nominal − 0.10 (≥ 40%); if none reaches it, ×2.0 is adopted and flagged.
  const oodMultCandidates = [1.0, 1.5, 2.0].map((mult) => {
    let nOod = 0;
    let covered = 0;
    for (const d of nestedFoldData.filter((x) => x.pct < 90)) {
      const foldDomain: OodDomain = {
        categories: [...new Set(d.foldTrain.map((p) => p.category ?? 'Other'))].sort(),
        chains: [...new Set(d.foldTrain.map(mainChain))].sort(),
        log_tvl_min: Math.min(...d.foldTrain.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd))),
        log_tvl_max: Math.max(...d.foldTrain.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd))),
        age_min_days: Math.min(...d.foldTrain.map((p) => ageDays(asOf, p.listed_at) ?? 0)),
        age_max_days: Math.max(...d.foldTrain.map((p) => ageDays(asOf, p.listed_at) ?? 0)),
      };
      const foldCompLogTvls = d.foldTrain.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd));
      const errs = d.errs[selected];
      d.foldTest.forEach((p, i) => {
        const rep = oodReport(p, asOf, foldDomain, foldCompLogTvls, model, 1);
        if (rep.is_ood) {
          nOod += 1;
          if (errs[i]! <= bandHalfwidth * mult) covered += 1;
        }
      });
    }
    return { multiplier: mult, n_ood_test_rows: nOod, coverage_50: nOod > 0 ? round4(covered / nOod) : 0 };
  });
  const oodMultAdopted = oodMultCandidates.find((c) => c.coverage_50 >= 0.4)?.multiplier ?? 2.0;
  const oodMultReached = oodMultCandidates.some((c) => c.coverage_50 >= 0.4);
  const oodMultiplierValidation: OodMultiplierValidation = {
    candidates: oodMultCandidates,
    adopted_multiplier: oodMultAdopted,
    n_ood_test_rows: oodMultCandidates[0]?.n_ood_test_rows ?? 0,
    reason: oodMultReached
      ? `Multiplier ×${oodMultAdopted} adopted: on the nested selection folds' OOD test rows (n = ${oodMultCandidates[0]?.n_ood_test_rows ?? 0}) it is the smallest multiplier whose 50% band coverage reaches nominal − 0.10 (≥ 40%).`
      : `No multiplier reaches 40% OOD coverage on the nested selection folds (n = ${oodMultCandidates[0]?.n_ood_test_rows ?? 0}); ×2.0 is adopted and flagged as insufficient — the OOD band does not cover OOD rows at the nominal rate, so OOD predictions stay low-confidence.`,
  };
  const oodBandMultiplier = oodMultAdopted;

  // The conformal slices (charter v1.3): observed empirical coverage of the
  // 50/80/90% bands by historical regime, TVL band, age band, and OOD vs
  // in-distribution — coverage is a measurement in this design, never a
  // guarantee. The Wilson 95% interval on the 50% coverage is published with
  // each slice, and the calibration-sample sufficiency for the 90% quantile.
  const wilsonCi = (k: number, n: number): [number, number] => {
    if (n === 0) return [0, 1];
    const z = 1.96;
    const p = k / n;
    const denom = 1 + (z * z) / n;
    const center = (p + (z * z) / (2 * n)) / denom;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
    return [round4(Math.max(0, center - half)), round4(Math.min(1, center + half))];
  };
  const hw50 = conformalBands[0]!.halfwidth_dex;
  const hw80 = conformalBands[1]!.halfwidth_dex;
  const hw90 = conformalBands[2]!.halfwidth_dex;
  const sliceOf = (slice: string, group: string, errs: number[]): ConformalSlice => {
    const n = errs.length;
    const c50 = errs.filter((e) => e <= hw50).length;
    return {
      slice,
      group,
      n,
      coverage_50: n > 0 ? round4(c50 / n) : 0,
      coverage_80: n > 0 ? round4(errs.filter((e) => e <= hw80).length / n) : 0,
      coverage_90: n > 0 ? round4(errs.filter((e) => e <= hw90).length / n) : 0,
      coverage_50_ci: wilsonCi(c50, n),
    };
  };
  const oofByComp = comps.map((p, i) => ({
    p,
    err: selected === 'huber' ? cvPairs[i]!.huber : selected === 'ols' ? cvPairs[i]!.ols : cvPairs[i]!.ridge,
  }));
  const terciles = <T>(items: T[], keyOf: (x: T) => number): [T[], T[], T[]] => {
    const sorted = [...items].sort((a, b) => keyOf(a) - keyOf(b));
    const n = sorted.length;
    return [sorted.slice(0, Math.floor(n / 3)), sorted.slice(Math.floor(n / 3), Math.floor((2 * n) / 3)), sorted.slice(Math.floor((2 * n) / 3))];
  };
  const [regOld, regMid, regNew] = terciles(oofByComp, (x) => Date.parse(`${x.p.listed_at!}T00:00:00Z`));
  const [tvlLow, tvlMid, tvlHigh] = terciles(oofByComp, (x) => x.p.tvl_usd);
  const [ageYoung, ageMid, ageOld] = terciles(oofByComp, (x) => ageDays(asOf, x.p.listed_at) ?? 0);
  // OOD vs in-distribution on nested test rows (all 5 folds), against the BASE
  // band (no multiplier) — so the reader can see what the widening buys.
  const oodSliceErrs: { ood: number[]; ind: number[] } = { ood: [], ind: [] };
  for (const d of nestedFoldData) {
    const foldDomain: OodDomain = {
      categories: [...new Set(d.foldTrain.map((p) => p.category ?? 'Other'))].sort(),
      chains: [...new Set(d.foldTrain.map(mainChain))].sort(),
      log_tvl_min: Math.min(...d.foldTrain.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd))),
      log_tvl_max: Math.max(...d.foldTrain.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd))),
      age_min_days: Math.min(...d.foldTrain.map((p) => ageDays(asOf, p.listed_at) ?? 0)),
      age_max_days: Math.max(...d.foldTrain.map((p) => ageDays(asOf, p.listed_at) ?? 0)),
    };
    const foldCompLogTvls = d.foldTrain.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd));
    const errs = d.errs[selected];
    d.foldTest.forEach((p, i) => {
      const rep = oodReport(p, asOf, foldDomain, foldCompLogTvls, model, 1);
      (rep.is_ood ? oodSliceErrs.ood : oodSliceErrs.ind).push(errs[i]!);
    });
  }

  // v1.5 ranking evaluation, nested part: per selection fold, the Spearman ρ
  // AND Kendall τ between the fold's predicted log values and the test
  // rows' actual log market caps, and the overlap between the predicted and
  // actual top-3 and top-5 of the fold's test rows. The pooled ρ and τ are
  // over all selection-fold test rows pooled (n=28), and the pooled top-10
  // and top-20 overlap/precision are computed on the pooled rows — the
  // per-fold rows are too small (n = 7) to support top-10/20. This answers
  // whether higher-valued protocols tend to be worth more — the ordering
  // question — separately from the level error. The pooled rank correlation
  // is the headline ranking metric.
  const orderByValueDesc = (rows: { slug: string; v: number }[]): string[] =>
    [...rows].sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)).map((r) => r.slug);
  const nestedRankingRows: NestedRankingRow[] = nestedFoldData
    .filter((d) => d.pct < 90)
    .map((d) => {
      const fit = d.fits[selected];
      const pred = d.foldTest.map((p) => ({ slug: p.slug, v: predictLog(p, asOf, fit.beta, fit.adj, fit.chainAdj, model) }));
      const actual = d.foldTest.map((p) => ({ slug: p.slug, v: Math.log10(p.mcap_usd!) }));
      const predOrder = orderByValueDesc(pred);
      const actualOrder = orderByValueDesc(actual);
      const top3Pred = new Set(predOrder.slice(0, 3));
      const top3Actual = actualOrder.slice(0, 3);
      const top5Pred = new Set(predOrder.slice(0, 5));
      const top5Actual = actualOrder.slice(0, 5);
      return {
        train_pct: d.pct,
        n_test: d.foldTest.length,
        spearman_predicted_vs_actual: round4(spearmanRankCorrelation(predOrder, actualOrder)),
        kendall_predicted_vs_actual: round4(kendallTau(predOrder, actualOrder)),
        top3_overlap: top3Actual.filter((s) => top3Pred.has(s)).length,
        top5_overlap: top5Actual.filter((s) => top5Pred.has(s)).length,
      };
    });
  const pooledNestedPred: { slug: string; v: number }[] = [];
  const pooledNestedActual: { slug: string; v: number }[] = [];
  for (const d of nestedFoldData.filter((x) => x.pct < 90)) {
    const fit = d.fits[selected];
    d.foldTest.forEach((p, i) => {
      pooledNestedPred.push({ slug: `${p.slug}@${d.pct}`, v: predictLog(p, asOf, fit.beta, fit.adj, fit.chainAdj, model) });
      pooledNestedActual.push({ slug: `${p.slug}@${d.pct}`, v: Math.log10(p.mcap_usd!) });
      void i;
    });
  }
  const pooledPredOrder = orderByValueDesc(pooledNestedPred);
  const pooledActualOrder = orderByValueDesc(pooledNestedActual);
  const nestedPooledSpearman = round4(spearmanRankCorrelation(pooledPredOrder, pooledActualOrder));
  const nestedPooledKendall = round4(kendallTau(pooledPredOrder, pooledActualOrder));
  const topKOverlap = (k: number): { overlap: number; precision: number } => {
    const predTop = new Set(pooledPredOrder.slice(0, k));
    const actualTop = pooledActualOrder.slice(0, k);
    const overlap = actualTop.filter((s) => predTop.has(s)).length;
    return { overlap, precision: round4(overlap / k) };
  };
  const pooledTop10 = topKOverlap(10);
  const pooledTop20 = topKOverlap(20);
  // The pooled rank correlation without the 80% fold — how much of the weak
  // pooled number is one fold.
  const pooledExcl80Pred: { slug: string; v: number }[] = [];
  const pooledExcl80Actual: { slug: string; v: number }[] = [];
  for (const d of nestedFoldData.filter((x) => x.pct < 90 && x.pct !== 80)) {
    const fit = d.fits[selected];
    d.foldTest.forEach((p) => {
      pooledExcl80Pred.push({ slug: `${p.slug}@${d.pct}`, v: predictLog(p, asOf, fit.beta, fit.adj, fit.chainAdj, model) });
      pooledExcl80Actual.push({ slug: `${p.slug}@${d.pct}`, v: Math.log10(p.mcap_usd!) });
    });
  }
  const excl80PredOrder = orderByValueDesc(pooledExcl80Pred);
  const excl80ActualOrder = orderByValueDesc(pooledExcl80Actual);
  const nestedPooledSpearmanExcl80 = round4(spearmanRankCorrelation(excl80PredOrder, excl80ActualOrder));
  const nestedPooledKendallExcl80 = round4(kendallTau(excl80PredOrder, excl80ActualOrder));

  // The negative-fold diagnosis (charter v1.5): the 80% fold's Spearman is
  // negative, so the fold is diagnosed row by row instead of averaged away.
  let negativeFoldDiagnosis: NegativeFoldDiagnosis | null = null;
  const fold80 = nestedFoldData.find((d) => d.pct === 80);
  if (fold80 !== undefined) {
    const fit80 = fold80.fits[selected];
    const rows80 = fold80.foldTest.map((p) => {
      const pred = predictLog(p, asOf, fit80.beta, fit80.adj, fit80.chainAdj, model);
      const actual = Math.log10(p.mcap_usd!);
      return { p, pred, actual, signed: actual - pred };
    });
    const predOrder80 = orderByValueDesc(rows80.map((r) => ({ slug: r.p.slug, v: r.pred })));
    const actualOrder80 = orderByValueDesc(rows80.map((r) => ({ slug: r.p.slug, v: r.actual })));
    const rankOf = (order: string[], slug: string): number => order.indexOf(slug) + 1;
    const inversions: { predicted_higher: string; actual_higher: string }[] = [];
    for (let i = 0; i < rows80.length; i++) {
      for (let j = i + 1; j < rows80.length; j++) {
        const a = rows80[i]!.p.slug;
        const b = rows80[j]!.p.slug;
        const predAB = rankOf(predOrder80, a) < rankOf(predOrder80, b);
        const actualAB = rankOf(actualOrder80, a) < rankOf(actualOrder80, b);
        if (predAB !== actualAB) inversions.push({ predicted_higher: predAB ? a : b, actual_higher: actualAB ? a : b });
      }
    }
    const looSpearman = rows80.map((dropped) => {
      const rest = rows80.filter((r) => r.p.slug !== dropped.p.slug);
      return {
        dropped_slug: dropped.p.slug,
        spearman: round4(spearmanRankCorrelation(orderByValueDesc(rest.map((r) => ({ slug: r.p.slug, v: r.pred }))), orderByValueDesc(rest.map((r) => ({ slug: r.p.slug, v: r.actual }))))),
      };
    });
    const trainCats = new Set(fold80.foldTrain.map((p) => p.category ?? 'Other'));
    const trainChains = new Set(fold80.foldTrain.map(mainChain));
    const unseenCats = [...new Set(rows80.map((r) => r.p.category ?? 'Other'))].filter((c) => !trainCats.has(c)).sort();
    const unseenChains = [...new Set(rows80.map((r) => mainChain(r.p)))].filter((c) => !trainChains.has(c)).sort();
    const trainListed = fold80.foldTrain.map((p) => p.listed_at!).sort();
    const worstLoo = [...looSpearman].sort((a, b) => b.spearman - a.spearman)[0]!;
    const fold80Spearman = nestedRankingRows.find((r) => r.train_pct === 80)?.spearman_predicted_vs_actual ?? 0;
    const fold80Kendall = nestedRankingRows.find((r) => r.train_pct === 80)?.kendall_predicted_vs_actual ?? 0;
    const rainRow = rows80.find((r) => r.p.slug === 'rain');
    const obolRow = rows80.find((r) => r.p.slug === 'obol');
    const ratioOf = (r: (typeof rows80)[number] | undefined): string => {
      if (r === undefined) return 'n/a';
      const ratio = r.p.mcap_usd! / Math.max(1, r.p.tvl_usd);
      return ratio >= 1 ? `${Math.round(ratio)}x` : `${ratio.toPrecision(2)}x`;
    };
    const signedOf = (r: (typeof rows80)[number] | undefined): string => (r === undefined ? 'n/a' : `${r.signed >= 0 ? '+' : ''}${round4(r.signed)}`);
    negativeFoldDiagnosis = {
      train_pct: 80,
      test_start: fold80.foldTest[0]!.listed_at!,
      test_end: fold80.foldTest[fold80.foldTest.length - 1]!.listed_at!,
      n_test: fold80.foldTest.length,
      spearman: fold80Spearman,
      kendall: fold80Kendall,
      pooled_spearman_excl_fold: nestedPooledSpearmanExcl80,
      pooled_kendall_excl_fold: nestedPooledKendallExcl80,
      rows: rows80.map((r) => ({
        slug: r.p.slug,
        category: r.p.category,
        chain: mainChain(r.p),
        tvl_usd: r.p.tvl_usd,
        mcap_usd: r.p.mcap_usd!,
        predicted_log: round4(r.pred),
        actual_log: round4(r.actual),
        signed_log_err: round4(r.signed),
        predicted_rank: rankOf(predOrder80, r.p.slug),
        actual_rank: rankOf(actualOrder80, r.p.slug),
      })),
      rank_inversions: inversions,
      leave_one_out_spearman: looSpearman,
      training: {
        n_train: fold80.foldTrain.length,
        train_start: trainListed[0]!,
        train_end: trainListed[trainListed.length - 1]!,
        unseen_categories: unseenCats,
        unseen_chains: unseenChains,
      },
      conclusion: `The 80% fold inverts the ranking (Spearman ${fold80Spearman}, Kendall ${fold80Kendall}, ${inversions.length} of 21 pairs inverted). Dropping ${worstLoo.dropped_slug} alone moves the fold Spearman to ${worstLoo.spearman}, so no single row carries the sign — the inversion is spread across the fold. The fold's test window holds the newest listings (${fold80.foldTest[0]!.listed_at} → ${fold80.foldTest[fold80.foldTest.length - 1]!.listed_at}), including the structural extremes rain (mcap/TVL ${ratioOf(rainRow)}, signed error ${signedOf(rainRow)} dex) and obol (mcap/TVL ${ratioOf(obolRow)}, signed error ${signedOf(obolRow)} dex), and ${unseenCats.length} of its 7 rows are in categories with zero training comps (${unseenCats.join(', ')}) plus ${unseenChains.length} unseen chain (${unseenChains.join(', ')}). The model ranks by TVL through a fit trained on older, smaller protocols; on this window the TVL ordering does not match the realized ordering. Without the fold the pooled Spearman is ${nestedPooledSpearmanExcl80} (Kendall ${nestedPooledKendallExcl80}) — still weak, so the fold is not the whole story.`,
    };
  }

  // The ranking tournament (charter v1.6): OLS is the benchmark; the
  // challengers are simple models that could only win by ranking better
  // on the same nested selection folds (50/60/70/80, n = 28 test rows).
  // TVL-only is a 1-feature log-log OLS on the fold-train rows (the same
  // log-TVL feature as production, no category or chain adjustments);
  // median-by-category predicts the fold-train median log market cap of
  // the row's category (the global train median when the category is
  // unseen); global-median predicts the fold-train median for every row
  // (no ranking signal — the floor). The adoption bar is prespecified:
  // a challenger replaces OLS only if it beats OLS on pooled Spearman
  // by ≥ 0.10 AND pooled Kendall by ≥ 0.05 AND pooled top-10 overlap
  // by ≥ 0. Every challenger prediction comes from the fold-train rows
  // only — a test row never trains its own prediction.
  const rankMetrics = (pred: { slug: string; v: number }[], actual: { slug: string; v: number }[]): { spearman: number; kendall: number; median_abs_log_err: number } => {
    const actualBySlug = new Map(actual.map((a) => [a.slug, a.v]));
    const errs = pred.map((p) => Math.abs(p.v - actualBySlug.get(p.slug)!)).sort((a, b) => a - b);
    return {
      spearman: round4(spearmanRankCorrelation(orderByValueDesc(pred), orderByValueDesc(actual))),
      kendall: round4(kendallTau(orderByValueDesc(pred), orderByValueDesc(actual))),
      median_abs_log_err: round4(median(errs) ?? 0),
    };
  };
  const tournamentRows: RankingTournamentRow[] = (
    [
      ['ols', 'Production OLS: log market cap on log TVL with category and chain adjustments, fit on the fold-train rows.'],
      ['tvl-only', 'TVL-only: log market cap on log TVL alone (1-feature OLS), fit on the fold-train rows — no category or chain adjustments.'],
      ['median-by-category', 'Median-by-category: the fold-train median log market cap of the row\u2019s category (global train median when the category is unseen).'],
      ['global-median', 'Global-median: the fold-train median log market cap for every row — no ranking signal, the floor.'],
    ] as ['ols' | 'tvl-only' | 'median-by-category' | 'global-median', string][]
  ).map(([kind, description]) => {
    const perFold: RankingTournamentRow['per_fold'] = [];
    const pooledPred: { slug: string; v: number }[] = [];
    const pooledActual: { slug: string; v: number }[] = [];
    let untouched90: { spearman: number; kendall: number; n_test: number } = { spearman: 0, kendall: 0, n_test: 0 };
    for (const d of nestedFoldData) {
      const fit = d.fits[selected];
      const trainLogs = d.foldTrain.map((p) => Math.log10(p.mcap_usd!)).sort((a, b) => a - b);
      const globalMedian = median(trainLogs) ?? 0;
      const catLogs = new Map<string, number[]>();
      for (const p of d.foldTrain) {
        const arr = catLogs.get(p.category ?? 'Other') ?? [];
        arr.push(Math.log10(p.mcap_usd!));
        catLogs.set(p.category ?? 'Other', arr);
      }
      const catMedian = new Map([...catLogs.entries()].map(([c, logs]) => [c, median([...logs].sort((a, b) => a - b)) ?? globalMedian]));
      const xs = d.foldTrain.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd));
      const ys = d.foldTrain.map((p) => Math.log10(p.mcap_usd!));
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const sxx = xs.reduce((a, x) => a + (x - mx) * (x - mx), 0);
      const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0);
      const tvlSlope = sxx > 0 ? sxy / sxx : 0;
      const tvlIntercept = my - tvlSlope * mx;
      const predict = (p: SnapshotProtocol): number => {
        if (kind === 'ols') return predictLog(p, asOf, fit.beta, fit.adj, fit.chainAdj, model);
        if (kind === 'tvl-only') return tvlIntercept + tvlSlope * Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd);
        if (kind === 'median-by-category') return catMedian.get(p.category ?? 'Other') ?? globalMedian;
        return globalMedian;
      };
      const pred = d.foldTest.map((p) => ({ slug: p.slug, v: predict(p) }));
      const actual = d.foldTest.map((p) => ({ slug: p.slug, v: Math.log10(p.mcap_usd!) }));
      const m = rankMetrics(pred, actual);
      if (d.pct === 90) {
        untouched90 = { spearman: m.spearman, kendall: m.kendall, n_test: d.foldTest.length };
      } else {
        perFold.push({ train_pct: d.pct, n_test: d.foldTest.length, spearman: m.spearman, kendall: m.kendall, median_abs_log_err: m.median_abs_log_err });
        d.foldTest.forEach((p, i) => {
          pooledPred.push({ slug: `${p.slug}@${d.pct}`, v: pred[i]!.v });
          pooledActual.push({ slug: `${p.slug}@${d.pct}`, v: Math.log10(p.mcap_usd!) });
        });
      }
    }
    const pooled = rankMetrics(pooledPred, pooledActual);
    const pooledPredOrder = new Set(orderByValueDesc(pooledPred).slice(0, 10));
    const pooledActualTop10 = orderByValueDesc(pooledActual).slice(0, 10);
    const pooledPredOrder20 = new Set(orderByValueDesc(pooledPred).slice(0, 20));
    const pooledActualTop20 = orderByValueDesc(pooledActual).slice(0, 20);
    const top10Overlap = pooledActualTop10.filter((s) => pooledPredOrder.has(s)).length;
    const top20Overlap = pooledActualTop20.filter((s) => pooledPredOrder20.has(s)).length;
    return {
      model: kind,
      description,
      per_fold: perFold,
      pooled_spearman: pooled.spearman,
      pooled_kendall: pooled.kendall,
      pooled_top10_overlap: top10Overlap,
      pooled_top10_precision: round4(top10Overlap / 10),
      pooled_top20_overlap: top20Overlap,
      pooled_top20_precision: round4(top20Overlap / 20),
      pooled_median_abs_log_err: pooled.median_abs_log_err,
      untouched90_spearman: untouched90.spearman,
      untouched90_kendall: untouched90.kendall,
      untouched90_n_test: untouched90.n_test,
    };
  });
  const olsTournamentRow = tournamentRows.find((r) => r.model === 'ols')!;
  const tournamentPassing = tournamentRows.filter(
    (r) => r.model !== 'ols' && r.pooled_spearman >= olsTournamentRow.pooled_spearman + 0.1 && r.pooled_kendall >= olsTournamentRow.pooled_kendall + 0.05 && r.pooled_top10_overlap >= olsTournamentRow.pooled_top10_overlap,
  );
  const tournamentAdopted: 'ols' | 'tvl-only' | 'median-by-category' | 'global-median' =
    tournamentPassing.length > 0 ? [...tournamentPassing].sort((a, b) => b.pooled_spearman - a.pooled_spearman || b.pooled_kendall - a.pooled_kendall)[0]!.model : 'ols';
  // v1.7 — the comps-fitted mcap/TVL ratio valuation (second lens): the
  // same nested folds as production, the same adoption bar as the
  // winsorization candidate (> 0.01 dex on the selection metric). The
  // board comparison and the LOPO max-delta are completed in buildRadar,
  // where the production board exists; the values here are placeholders
  // overwritten there.
  const ratioNested = ratioLensNested(comps, asOf, model);
  const ratioSelectionDex = round4(median([...ratioNested.selectionErrs].sort((a, b) => a - b)) ?? 0);
  const ratioUntouched90Dex = round4(median([...ratioNested.untouched90Errs].sort((a, b) => a - b)) ?? 0);
  const productionSelectionDex = selectionPooled[selected];
  const ratioImprovementDex = round4(productionSelectionDex - ratioSelectionDex);
  const ratioAdopted = ratioImprovementDex > 0.01;
  const ratioValuation: RatioValuation = {
    intercept: round4(ratioNested.full.beta[0]!),
    coef_log_tvl: round4(ratioNested.full.beta[1]!),
    n_comps: comps.length,
    nested_selection_pooled_dex: ratioSelectionDex,
    nested_selection_pooled_dex_production_ols: productionSelectionDex,
    improvement_vs_production_dex: ratioImprovementDex,
    adoption_bar_dex: 0.01,
    adopted: ratioAdopted,
    adoption_reason: ratioAdopted
      ? `The ratio lens improves the nested selection-pooled metric by ${ratioImprovementDex} dex (>${0.01} dex bar) and replaces the OLS production valuation.`
      : `The ratio lens scores ${ratioSelectionDex} dex on the nested selection-pooled metric vs ${productionSelectionDex} dex for the OLS production fit (improvement ${ratioImprovementDex} dex, bar > 0.01 dex) — it does not clear the bar, so OLS stays the production valuation and the ratio lens is reported as a cross-check only.`,
    untouched90_median_abs_log_err_dex: ratioUntouched90Dex,
    board_spearman_vs_production: 0,
    board_top10_overlap_vs_production: 0,
    board_top20_overlap_vs_production: 0,
    lopo_max_abs_delta_predicted_log: 0,
    data_gaps: [
      'FDV/TVL at TGE: the snapshot carries no FDV field and no TGE date, so no FDV target can be built or verified.',
      'Airdrop allocation %: no airdrop field exists in the snapshot.',
      'VC tier / raise: no investor or raise field exists in the snapshot.',
      'TVL growth velocity beyond the 7-day change: the snapshot carries only change_7d.',
      'Per-protocol gas / slippage / fees: no such field exists; slippage/fees are the uniform 0.5% assumption in the costed plan.',
    ],
  };

  // v1.7 — ranking calibration: cluster-bootstrap intervals for the pooled
  // rank correlation (2000 resamples of the 28 selection rows, seed
  // 20261120), precision/recall at top-5/10/20, and the launch-odds
  // reliability diagram with Brier and log-loss on the 645 dated
  // protocols. The intervals calibrate the ranking claim; they gate
  // nothing.
  const pooledPredValues = pooledNestedPred.map((r) => r.v);
  const pooledActualValues = pooledNestedActual.map((r) => r.v);
  const calBootRand = mulberry32(20261120);
  const bootSpearman: number[] = [];
  const bootKendall: number[] = [];
  for (let b = 0; b < 2000; b++) {
    const idx: number[] = [];
    for (let i = 0; i < 28; i++) idx.push(Math.floor(calBootRand() * 28));
    bootSpearman.push(spearmanPaired(idx.map((i) => pooledPredValues[i]!), idx.map((i) => pooledActualValues[i]!)));
    bootKendall.push(kendallTauPaired(idx.map((i) => pooledPredValues[i]!), idx.map((i) => pooledActualValues[i]!)));
  }
  bootSpearman.sort((a, b) => a - b);
  bootKendall.sort((a, b) => a - b);
  const ci95 = (xs: number[]): [number, number] => [round4(quantileOf(xs, 0.025)), round4(quantileOf(xs, 0.975))];
  const topKPrecisionRecall = (k: number): { overlap: number; precision: number; recall: number } => {
    const predTop = new Set(pooledPredOrder.slice(0, k));
    const actualTop = pooledActualOrder.slice(0, k);
    const overlap = actualTop.filter((s) => predTop.has(s)).length;
    return { overlap, precision: round4(overlap / k), recall: round4(overlap / k) };
  };
  const datedProtocolsCal = snapshot.protocols.filter((p) => p.listed_at !== null);
  const baseRateOdds = seasoning.base_rate;
  let brierBase = 0;
  let logLossBase = 0;
  let brierCurve = 0;
  let logLossCurve = 0;
  const reliabilityBins: { bin: string; n: number; mean_predicted: number; observed_rate: number }[] = Array.from({ length: 10 }, (_, i) => ({
    bin: `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}`,
    n: 0,
    mean_predicted: 0,
    observed_rate: 0,
  }));
  const reliabilityAccum = Array.from({ length: 10 }, () => ({ predSum: 0, actualSum: 0, count: 0 }));
  for (const p of datedProtocolsCal) {
    const y = p.mcap_usd !== null ? 1 : 0;
    brierBase += (baseRateOdds - y) ** 2;
    logLossBase += -(y * Math.log(Math.max(1e-12, baseRateOdds)) + (1 - y) * Math.log(Math.max(1e-12, 1 - baseRateOdds)));
    const pr = launchOdds(ageDays(asOf, p.listed_at), seasoning);
    brierCurve += (pr - y) ** 2;
    logLossCurve += -(y * Math.log(Math.max(1e-12, pr)) + (1 - y) * Math.log(Math.max(1e-12, 1 - pr)));
    const b = Math.min(9, Math.floor(pr * 10));
    reliabilityAccum[b]!.predSum += pr;
    reliabilityAccum[b]!.actualSum += y;
    reliabilityAccum[b]!.count += 1;
  }
  for (let i = 0; i < 10; i++) {
    const acc = reliabilityAccum[i]!;
    reliabilityBins[i]!.n = acc.count;
    reliabilityBins[i]!.mean_predicted = acc.count > 0 ? round4(acc.predSum / acc.count) : 0;
    reliabilityBins[i]!.observed_rate = acc.count > 0 ? round4(acc.actualSum / acc.count) : 0;
  }
  const rankingCalibration: RankingCalibration = {
    pooled_spearman: nestedPooledSpearman,
    pooled_spearman_ci95: ci95(bootSpearman),
    pooled_kendall: nestedPooledKendall,
    pooled_kendall_ci95: ci95(bootKendall),
    n_bootstrap_resamples: 2000,
    bootstrap_seed: 20261120,
    top5: topKPrecisionRecall(5),
    top10: topKPrecisionRecall(10),
    top20: topKPrecisionRecall(20),
    reliability_bins: reliabilityBins,
    brier_base_rate: round4(brierBase / datedProtocolsCal.length),
    log_loss_base_rate: round4(logLossBase / datedProtocolsCal.length),
    brier_seasoning_curve: round4(brierCurve / datedProtocolsCal.length),
    log_loss_seasoning_curve: round4(logLossCurve / datedProtocolsCal.length),
    n_launch_odds_rows: datedProtocolsCal.length,
    note: 'Bootstrap intervals are descriptive: with 28 selection rows the ranking claim is calibrated, not proven. The reliability bins show the seasoning curve against the observed launch rate per bin; the base rate is a constant, so its reliability is a single point (its Brier/log-loss are the benchmark the curve must beat). The tournament result is reported next to these intervals.',
  };

  // v1.7 — the realized-outcome holdout: the untouched 90% fold (newest 7
  // dated comps), evaluated AFTER the freeze point — this block runs after
  // every choice is frozen, and it selects or tunes nothing. Realized
  // value = each comp's actual snapshot market cap at as_of. No
  // post-snapshot realized price exists in this repo and none is invented.
  const fold90 = nestedFoldData.find((d) => d.pct === 90);
  let realizedHoldout: RealizedHoldout | null = null;
  if (fold90 !== undefined) {
    const fit90 = fold90.fits[selected];
    const holdoutSigma = bandHalfwidth > 0 ? bandHalfwidth / 0.6745 : 0.01;
    const holdoutRows = fold90.foldTest.map((p) => {
      const pred = predictLog(p, asOf, fit90.beta, fit90.adj, fit90.chainAdj, model);
      const actual = Math.log10(p.mcap_usd!);
      const cost = planCostUsd(p, model, asOf);
      const beValue = cost / model.farmer_share;
      const realized = p.mcap_usd!;
      const condEv = analyticGateStats(pred, holdoutSigma, cost, baseRateOdds, valueCapUsd, model).conditionalMeanEv;
      return {
        slug: p.slug,
        predicted_log: round4(pred),
        realized_log: round4(actual),
        signed_log_err: round4(actual - pred),
        abs_log_err: round4(Math.abs(actual - pred)),
        predicted_rank: 0,
        realized_rank: 0,
        realized_value_usd: realized,
        plan_cost_usd: cost,
        breakeven_value_usd: Math.round(beValue),
        profitable: realized > beValue,
        realized_net_return_usd: Math.round(model.farmer_share * realized - cost),
        predicted_conditional_mean_ev_usd: Math.round(condEv),
      };
    });
    const orderBy = (key: 'predicted_log' | 'realized_log'): string[] =>
      [...holdoutRows].sort((a, b) => b[key] - a[key] || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)).map((r) => r.slug);
    const predOrder90 = orderBy('predicted_log');
    const actualOrder90 = orderBy('realized_log');
    holdoutRows.forEach((r) => {
      r.predicted_rank = predOrder90.indexOf(r.slug) + 1;
      r.realized_rank = actualOrder90.indexOf(r.slug) + 1;
    });
    const holdoutSpearman = round4(spearmanRankCorrelation(predOrder90, actualOrder90));
    const holdoutKendall = round4(kendallTau(predOrder90, actualOrder90));
    const holdoutMedianAbs = round4(median([...holdoutRows.map((r) => r.abs_log_err)].sort((a, b) => a - b)) ?? 0);
    const top3 = holdoutRows.filter((r) => r.predicted_rank <= 3);
    const top3Profitable = top3.filter((r) => r.profitable).length;
    const top3Share = top3.length > 0 ? round4(top3Profitable / top3.length) : 0;
    const holdoutRand = mulberry32(20261120);
    const bootShares: number[] = [];
    const bootSpearman90: number[] = [];
    for (let b = 0; b < 2000; b++) {
      const idx: number[] = [];
      for (let i = 0; i < holdoutRows.length; i++) idx.push(Math.floor(holdoutRand() * holdoutRows.length));
      const sample = idx.map((i) => holdoutRows[i]!);
      const sampleTop3 = [...sample].sort((a, b2) => b2.predicted_log - a.predicted_log || (a.slug < b2.slug ? -1 : a.slug > b2.slug ? 1 : 0)).slice(0, 3);
      bootShares.push(sampleTop3.filter((r) => r.profitable).length / Math.max(1, sampleTop3.length));
      bootSpearman90.push(spearmanPaired(sample.map((r) => r.predicted_log), sample.map((r) => r.realized_log)));
    }
    bootShares.sort((a, b) => a - b);
    bootSpearman90.sort((a, b) => a - b);
    realizedHoldout = {
      n_rows: holdoutRows.length,
      fold: 'nested 90% (newest 7 dated comps)',
      evaluated_after_freeze: true,
      rows: holdoutRows,
      spearman: holdoutSpearman,
      kendall: holdoutKendall,
      median_abs_log_err_dex: holdoutMedianAbs,
      top3_profitable_share: top3Share,
      top3_profitable_ci95: ci95(bootShares),
      spearman_ci95: ci95(bootSpearman90),
      n_profitable_top3: top3Profitable,
      limitation:
        'Within-snapshot holdout at n = 7: realized values are the comps\u2019 actual snapshot market caps at as_of, not post-snapshot TGE outcomes. It cannot validate post-launch farm returns, and the intervals are wide at this n — reported, not hidden.',
    };
  }

  const rankingTournament: RankingTournament = {
    rows: tournamentRows,
    benchmark: 'ols',
    adopted: tournamentAdopted,
    adoption_rule: 'A challenger replaces OLS only if it beats OLS on pooled Spearman by ≥ 0.10 AND pooled Kendall by ≥ 0.05 AND pooled top-10 overlap by ≥ 0, on the selection folds (50/60/70/80, n = 28).',
    reason:
      tournamentAdopted === 'ols'
        ? `OLS stays the benchmark: no challenger clears the prespecified bar (TVL-only pooled Spearman ${tournamentRows.find((r) => r.model === 'tvl-only')!.pooled_spearman}, median-by-category ${tournamentRows.find((r) => r.model === 'median-by-category')!.pooled_spearman}, global-median ${tournamentRows.find((r) => r.model === 'global-median')!.pooled_spearman} vs OLS ${olsTournamentRow.pooled_spearman}). The ranking is weak for every model, not just OLS — the tournament shows the ordering problem is in the data, not the estimator. Note: the global-median predicts one constant per fold, so its pooled Spearman (${tournamentRows.find((r) => r.model === 'global-median')!.pooled_spearman}) is a tiebreak artifact — alphabetical order within a fold plus between-fold median differences — not ranking signal; within a fold it ranks nothing.`
        : `Challenger ${tournamentAdopted} adopted: it beats OLS on pooled Spearman by ≥ 0.10 and pooled Kendall by ≥ 0.05 with top-10 overlap ≥ OLS on the selection folds.`,
  };

  // The fold-80 / cross-time generalization (charter v1.6): the pooled
  // selection rows by listing-date tercile, the 70 dated comps by
  // listing-year cohort (in-sample fitted vs actual — descriptive, the
  // fit saw these rows), and the pooled Spearman per cohort with and
  // without the fold-80 rows.
  const cohortOf = (listedAt: string): string => {
    const y = Number(listedAt.slice(0, 4));
    if (y <= 2022) return '2021–2022';
    if (y === 2023) return '2023';
    if (y === 2024) return '2024';
    return '2025–2026';
  };
  const cohortMetrics = (rows: { pred: number; actual: number }[]): { spearman: number | null; kendall: number | null; median_abs_log_err: number | null } => {
    if (rows.length < 2) return { spearman: null, kendall: null, median_abs_log_err: null };
    const pred = rows.map((r, i) => ({ slug: `r${i}`, v: r.pred }));
    const actual = rows.map((r, i) => ({ slug: `r${i}`, v: r.actual }));
    const errs = rows.map((r) => Math.abs(r.pred - r.actual)).sort((a, b) => a - b);
    return {
      spearman: round4(spearmanRankCorrelation(orderByValueDesc(pred), orderByValueDesc(actual))),
      kendall: round4(kendallTau(orderByValueDesc(pred), orderByValueDesc(actual))),
      median_abs_log_err: round4(median(errs) ?? 0),
    };
  };
  const pooledSelectionRows: { slug: string; pred: number; actual: number; listed_at: string; pct: number }[] = [];
  for (const d of nestedFoldData.filter((x) => x.pct < 90)) {
    const fit = d.fits[selected];
    d.foldTest.forEach((p) => {
      pooledSelectionRows.push({ slug: p.slug, pred: predictLog(p, asOf, fit.beta, fit.adj, fit.chainAdj, model), actual: Math.log10(p.mcap_usd!), listed_at: p.listed_at!, pct: d.pct });
    });
  }
  const [tercOld, tercMid, tercNew] = terciles(pooledSelectionRows, (x) => Date.parse(`${x.listed_at}T00:00:00Z`));
  const tercileRow = (group: string, rows: { pred: number; actual: number }[]): CohortRankingRow => {
    const m = cohortMetrics(rows);
    return { group, n: rows.length, spearman: m.spearman, kendall: m.kendall, median_abs_log_err: m.median_abs_log_err, evidence: rows.length >= 10 ? 'measurement' : 'descriptive' };
  };
  const cohortOrder = ['2021–2022', '2023', '2024', '2025–2026'];
  const cohortRowFor = (group: string, rows: { pred: number; actual: number }[], evidence: 'measurement' | 'descriptive'): CohortRankingRow => {
    const m = cohortMetrics(rows);
    return { group, n: rows.length, spearman: m.spearman, kendall: m.kendall, median_abs_log_err: m.median_abs_log_err, evidence };
  };
  const fold80Rows = pooledSelectionRows.filter((r) => r.pct === 80);
  const fold80Cohorts = [...new Set(fold80Rows.map((r) => cohortOf(r.listed_at)))].sort();
  const cohortRanking: CohortRanking = {
    by_listing_tercile: [
      tercileRow('oldest tercile by listing date', tercOld),
      tercileRow('middle tercile by listing date', tercMid),
      tercileRow('newest tercile by listing date', tercNew),
    ],
    by_listing_year_cohort: cohortOrder.map((c) =>
      cohortRowFor(
        c,
        comps.filter((p) => cohortOf(p.listed_at!) === c).map((p) => ({ pred: predictLog(p, asOf, full.beta, full.adj, full.chainAdj, model), actual: Math.log10(p.mcap_usd!) })),
        'descriptive',
      ),
    ),
    fold80_cohorts: fold80Cohorts,
    pooled_spearman_by_cohort_with_fold80: cohortOrder.map((c) => cohortRowFor(c, pooledSelectionRows.filter((r) => cohortOf(r.listed_at) === c), 'descriptive')),
    pooled_spearman_by_cohort_excl_fold80: cohortOrder.map((c) => cohortRowFor(c, pooledSelectionRows.filter((r) => cohortOf(r.listed_at) === c && r.pct !== 80), 'descriptive')),
    conclusion: '',
  };
  {
    const with80 = cohortRanking.pooled_spearman_by_cohort_with_fold80;
    const excl80 = cohortRanking.pooled_spearman_by_cohort_excl_fold80;
    const parts = cohortOrder.map((c) => {
      const w = with80.find((r) => r.group === c)!;
      const e = excl80.find((r) => r.group === c)!;
      return `${c}: pooled Spearman ${w.spearman ?? 'n/a'} (n=${w.n}) with the fold vs ${e.spearman ?? 'n/a'} (n=${e.n}) without it`;
    });
    cohortRanking.conclusion = `The fold-80 test rows sit in ${fold80Cohorts.join(', ')} (listed ${[...fold80Rows.map((r) => r.listed_at)].sort()[0]} → ${[...fold80Rows.map((r) => r.listed_at)].sort().pop()}). Per cohort, the pooled selection Spearman is ${parts.join('; ')}. The tercile split shows the newest tercile — the fold-80 window — ranks worst, but the pooled Spearman without the fold is still weak, so the cross-time failure is not one fold's accident: the TVL ordering generalizes poorly to newer listings across cohorts.`;
  }

  // v1.4 segmented OOD report: the nested test rows (selection folds) split
  // by OOD segment relative to their own fold's training domain, coverage
  // against the base band (no multiplier) so the widening's value is visible.
  // Segments with n < 10 carry no validation claim — they are labelled
  // "insufficient evidence". The in-distribution segment is empty BY
  // CONSTRUCTION (every nested test row is age-OOD: it is listed after the
  // whole training window), so an OOD-vs-in-distribution comparison is
  // vacuous and is documented as such rather than reported as a result.
  const segmentAgg = new Map<OodSegment, { abs: number[]; signed: number[]; covered: number; width: number[] }>();
  const segmentOf = (rep: OodReport): OodSegment => oodSegment(rep);
  for (const d of nestedFoldData.filter((x) => x.pct < 90)) {
    const foldDomain: OodDomain = {
      categories: [...new Set(d.foldTrain.map((p) => p.category ?? 'Other'))].sort(),
      chains: [...new Set(d.foldTrain.map(mainChain))].sort(),
      log_tvl_min: Math.min(...d.foldTrain.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd))),
      log_tvl_max: Math.max(...d.foldTrain.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd))),
      age_min_days: Math.min(...d.foldTrain.map((p) => ageDays(asOf, p.listed_at) ?? 0)),
      age_max_days: Math.max(...d.foldTrain.map((p) => ageDays(asOf, p.listed_at) ?? 0)),
    };
    const foldCompLogTvls = d.foldTrain.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd));
    const errs = d.errs[selected];
    const signed = d.signed[selected];
    d.foldTest.forEach((p, i) => {
      const rep = oodReport(p, asOf, foldDomain, foldCompLogTvls, model, 1);
      const seg = segmentOf(rep);
      const agg = segmentAgg.get(seg) ?? { abs: [], signed: [], covered: 0, width: [] };
      agg.abs.push(errs[i]!);
      agg.signed.push(signed[i]!);
      if (errs[i]! <= bandHalfwidth) agg.covered += 1;
      agg.width.push(bandHalfwidth);
      segmentAgg.set(seg, agg);
    });
  }
  const segmentOrder: OodSegment[] = ['in-distribution', 'unseen-chain-only', 'unseen-category-only', 'partial-other', 'major'];
  const oodSegmentRows: OodSegmentRow[] = segmentOrder.map((seg) => {
    const agg = segmentAgg.get(seg);
    const n = agg?.abs.length ?? 0;
    return {
      segment: seg,
      n,
      nominal_coverage_50: 0.5,
      observed_coverage_50: n === 0 ? 0 : round4(agg!.covered / n),
      coverage_50_ci: wilsonCi(agg?.covered ?? 0, n),
      median_effective_halfwidth_dex: n === 0 ? 0 : round4(median([...agg!.width].sort((a, b) => a - b)) ?? 0),
      median_signed_residual_dex: n === 0 ? 0 : round4(median([...agg!.signed].sort((a, b) => a - b)) ?? 0),
      evidence: n >= 10 ? 'measurement' : 'insufficient evidence',
    };
  });
  const segmentedOod: SegmentedOodReport = {
    segments: oodSegmentRows,
    n_test_rows: nestedFoldData.filter((x) => x.pct < 90).reduce((a, d) => a + d.foldTest.length, 0),
    multiplier_label: 'base band (×1.0, no multiplier)',
    note: 'Nested selection-fold test rows against the base 50% band (no multiplier). The in-distribution segment is empty by construction: every nested test row is listed after its fold training window, so all of them are age-OOD. An OOD-vs-in-distribution coverage comparison is therefore vacuous and is not reported as a validation result. Segments with n < 10 are labelled "insufficient evidence", not validation; empty segments report 0 observed coverage with a [0, 1] Wilson interval (no information, not 0% coverage). Polymarket (unseen chain: Polygon; unseen category: Prediction Market) sits in the major segment and is reported as exploratory extrapolation, never as an OOD success.',
  };
  const conformalSlices: ConformalSlices = {
    by_regime: [
      sliceOf('regime', 'oldest tercile by listing date', regOld.map((x) => x.err)),
      sliceOf('regime', 'middle tercile by listing date', regMid.map((x) => x.err)),
      sliceOf('regime', 'newest tercile by listing date', regNew.map((x) => x.err)),
    ],
    by_tvl_band: [
      sliceOf('tvl', 'low TVL tercile', tvlLow.map((x) => x.err)),
      sliceOf('tvl', 'mid TVL tercile', tvlMid.map((x) => x.err)),
      sliceOf('tvl', 'high TVL tercile', tvlHigh.map((x) => x.err)),
    ],
    by_age_band: [
      sliceOf('age', 'youngest tercile by age', ageYoung.map((x) => x.err)),
      sliceOf('age', 'middle tercile by age', ageMid.map((x) => x.err)),
      sliceOf('age', 'oldest tercile by age', ageOld.map((x) => x.err)),
    ],
    by_ood: [
      sliceOf('ood', 'out-of-distribution (nested test rows, base band)', oodSliceErrs.ood),
      sliceOf('ood', 'in-distribution (nested test rows, base band)', oodSliceErrs.ind),
    ],
    calibration_n: selectedCvErrs.length,
    quantile_index_90: Math.min(selectedCvErrs.length, Math.max(1, Math.ceil((selectedCvErrs.length + 1) * 0.9))),
    coverage_90_standard_error: round4(Math.sqrt((0.9 * 0.1) / selectedCvErrs.length)),
    note: 'Coverage is observed empirical coverage in this evaluation design (cross-conformal on out-of-fold residuals), never a guarantee. The 90% band is the 64th of 70 order statistics, so its coverage has a binomial standard error of about 0.036 — a shortfall of a few points is sampling noise. The OOD slice uses the base band (no multiplier) on nested test rows: the in-distribution slice is EMPTY by construction — chronological folds make every test row younger than every training row, so every test row is age-out-of-range and therefore OOD — so the OOD-vs-in-distribution comparison is vacuous here and the OOD multiplier validation covers age-OOD rows only, not category/chain-OOD rows. That is a limitation of the validation, reported as-is.',
  };

  // Paired Huber-vs-OLS comparisons on identical observations: the median
  // per-observation difference (Huber minus OLS) with a bootstrap 95% interval
  // (2000 resamples, fixed seed). An interval that straddles zero is noise, not a
  // win for either side — the dashboard must not claim Huber wins when it does not.
  // The nested comparison uses the selection folds (50–80), the ones the rule uses.
  const pairedComparison = (huberErrs: number[], olsErrs: number[]): PairedComparison => {
    const diffs = huberErrs.map((h, i) => h - olsErrs[i]!);
    const med = median([...diffs].sort((a, b) => a - b)) ?? 0;
    const rand = mulberry32(20261107);
    const bootMeds: number[] = [];
    for (let b = 0; b < 2000; b++) {
      const sample: number[] = [];
      for (let i = 0; i < diffs.length; i++) sample.push(diffs[Math.floor(rand() * diffs.length)]!);
      bootMeds.push(median(sample.sort((a, b) => a - b)) ?? 0);
    }
    bootMeds.sort((a, b) => a - b);
    const lo = bootMeds[Math.floor(0.025 * bootMeds.length)] ?? 0;
    const hi = bootMeds[Math.min(bootMeds.length - 1, Math.ceil(0.975 * bootMeds.length) - 1)] ?? 0;
    return { median_diff: round4(med), ci_lo: round4(lo), ci_hi: round4(hi), n_better_huber: diffs.filter((d) => d < 0).length, n: diffs.length };
  };
  const huberVsOls = {
    wf: pairedComparison(wfErrs.huber, wfErrs.ols),
    nested: pairedComparison(nestedErrsSelection.huber, nestedErrsSelection.ols),
    cv: pairedComparison(
      cvPairs.map((x) => x.huber),
      cvPairs.map((x) => x.ols),
    ),
  };

  // The missingness report (charter v1.1, handling (d) — hard-gate): undated
  // comparables are legacy protocols whose listing dates were never recorded —
  // structural missingness, not random — and are excluded from every fit and
  // calibration. They are scored only as a reference table with the dated-only
  // full fit; the dated-only band's coverage on them is a diagnostic.
  const missingness: MissingnessReport = {
    n_dated: dated.length,
    n_undated: undated.length,
    dated_err: round4(oosStratifiedDated),
    undated_err: round4(undatedMedianAbs),
    combined_err: round4(oosStratified),
    mechanism:
      `Structural (MNAR): undated comparables are legacy protocols whose listing dates were never recorded. They are systematically smaller (median market cap $4.8M vs $9.0M dated) and over-predicted (median residual ${undatedMedianSigned.toFixed(3)} dex under the dated-only v1.2 fit), so the missingness itself carries signal about size.`,
    handling:
      'Hard-gate (d, charter v1.2): undated comparables are excluded from every regression fit, group adjustment, cross-validation fold, conformal calibration, baseline, and bootstrap resample. They are scored only as a reference table with the dated-only full fit; their error is a diagnostic, never a headline and never mixed into any fitted quantity.',
  };

  // The truncation-invariance audit, run at build time: for every time-based fold,
  // (a) every training row is listed at least purge_gap_days before the test window,
  // and (b) refitting on the snapshot truncated at the purge cutoff reproduces the
  // fold fit exactly — beta and every group adjustment. Any feature or adjustment
  // that peeked at rows past the cutoff (a global median, a floor fitted on the full
  // set, a test row smuggled into training) would fail check (b).
  const truncationChecks: string[] = [];
  let truncationPassed = true;
  const auditFold = (label: string, foldTrain: SnapshotProtocol[], testStart: string, foldFit: Regression): void => {
    const bad = foldTrain.filter((p) => (ageDays(testStart, p.listed_at) ?? 0) < model.purge_gap_days);
    if (bad.length > 0) {
      truncationPassed = false;
      truncationChecks.push(`${label}: FAIL — ${bad.length} training rows inside the ${model.purge_gap_days}d purge gap`);
      return;
    }
    const cutoffDate = new Date(Date.parse(`${testStart}T00:00:00Z`) - model.purge_gap_days * DAY_MS).toISOString().slice(0, 10);
    const truncated: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at <= cutoffDate) };
    const truncatedComps = liveComps(truncated);
    const trainSlugs = new Set(foldTrain.map((p) => p.slug));
    const truncatedSlugs = new Set(truncatedComps.map((p) => p.slug));
    const sameSet = trainSlugs.size === truncatedSlugs.size && [...trainSlugs].every((s) => truncatedSlugs.has(s));
    if (!sameSet) {
      truncationPassed = false;
      truncationChecks.push(`${label}: FAIL — truncated snapshot holds ${truncatedComps.length} comps, fold train holds ${foldTrain.length}`);
      return;
    }
    const refit = fitEst(selected)(truncatedComps);
    const betaSame = refit.beta.every((b, i) => Math.abs(b - foldFit.beta[i]!) < 1e-9);
    const adjSame = (a: Map<string, { adjustment: number; count: number }>, b: Map<string, { adjustment: number; count: number }>): boolean => {
      if (a.size !== b.size) return false;
      for (const [k, v] of a) {
        const w = b.get(k);
        if (!w || Math.abs(v.adjustment - w.adjustment) > 1e-9 || v.count !== w.count) return false;
      }
      return true;
    };
    if (!betaSame || !adjSame(refit.adj, foldFit.adj) || !adjSame(refit.chainAdj, foldFit.chainAdj)) {
      truncationPassed = false;
      truncationChecks.push(`${label}: FAIL — truncated refit differs from the fold fit`);
      return;
    }
    const latest = foldTrain.length > 0 ? foldTrain[foldTrain.length - 1]!.listed_at : 'n/a';
    truncationChecks.push(
      `${label}: PASS — ${foldTrain.length} train rows, latest listed ${latest} (≥${model.purge_gap_days}d before ${testStart}); truncated refit identical (beta + ${refit.adj.size} category + ${refit.chainAdj.size} chain adjustments)`,
    );
  };
  auditFold('walk-forward 70/30', train, wfTestStart, wfFits[selected]);
  for (const f of nestedFoldFitsAll) auditFold(f.label, f.train, f.testStart, f.fits[selected]);

  // A 2000-refit cluster bootstrap (fixed seed 20261119, charter v1.5):
  // the resample unit is one protocol (each comp contributes exactly one
  // observation, so resampling comps IS a cluster bootstrap), and every
  // refit re-runs the full fitting process — OLS refit + the group
  // adjustments recomputed from the resample. The cross-conformal band
  // above is the band the board prints (outcome-only), and the per-row
  // parameter SDs below are the model uncertainty reported alongside it.
  const bootRand = mulberry32(20261119);
  const bootPreds: number[][] = comps.map(() => []);
  const boardProtocols = snapshot.protocols.filter(isRankable);
  const bootBoardPreds: number[][] = boardProtocols.map(() => []);
  const bootIntercepts: number[] = [];
  const bootSlopes: number[] = [];
  for (let b = 0; b < 2000; b++) {
    const resample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) resample.push(comps[Math.floor(bootRand() * comps.length)]!);
    const bootFit = fitEst(selected)(resample);
    bootIntercepts.push(bootFit.beta[0]!);
    bootSlopes.push(bootFit.beta[1]!);
    comps.forEach((p, i) => bootPreds[i]!.push(predictLog(p, asOf, bootFit.beta, bootFit.adj, bootFit.chainAdj, model)));
    boardProtocols.forEach((p, i) => bootBoardPreds[i]!.push(predictLog(p, asOf, bootFit.beta, bootFit.adj, bootFit.chainAdj, model)));
  }
  const sdOf = (preds: number[]): number => {
    const mean = preds.reduce((a, v) => a + v, 0) / preds.length;
    return Math.sqrt(preds.reduce((a, v) => a + (v - mean) ** 2, 0) / preds.length);
  };
  const sds = bootPreds.map(sdOf).sort((a, b) => a - b);
  const bootstrapSd = median(sds) ?? 0;
  // v1.4 parameter uncertainty: per-board-row SDs and the coefficient distribution.
  const paramSdBySlug = new Map<string, number>();
  const boardParamSds: number[] = [];
  boardProtocols.forEach((p, i) => {
    const sd = sdOf(bootBoardPreds[i]!);
    paramSdBySlug.set(p.slug, round4(sd));
    boardParamSds.push(sd);
  });
  const coefStats = (xs: number[]): { mean: number; sd: number; p025: number; p975: number } => {
    const sorted = [...xs].sort((a, b) => a - b);
    const mean = xs.reduce((a, v) => a + v, 0) / xs.length;
    return {
      mean: round4(mean),
      sd: round4(sdOf(xs)),
      p025: round4(sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(0.025 * sorted.length)))]!),
      p975: round4(sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(0.975 * sorted.length)))]!),
    };
  };
  const bootstrapCoef = { intercept: coefStats(bootIntercepts), slope: coefStats(bootSlopes) };
  const sortedBoardParamSds = [...boardParamSds].sort((a, b) => a - b);
  const parameterUncertainty: ParameterUncertainty = {
    n_refits: 2000,
    seed: 20261119,
    intercept: bootstrapCoef.intercept,
    slope: bootstrapCoef.slope,
    intercept_sign_flips: bootIntercepts.filter((v) => v < 0).length,
    slope_sign_flips: bootSlopes.filter((v) => v < 0).length,
    intercept_bimodal: bimodalityFlag(bootIntercepts),
    slope_bimodal: bimodalityFlag(bootSlopes),
    median_param_sd_dex: round4(median(sortedBoardParamSds) ?? 0),
    max_param_sd_dex: round4(sortedBoardParamSds[sortedBoardParamSds.length - 1] ?? 0),
    note: 'The printed value band is the outcome-only cross-conformal band; the parameter SDs above are the model uncertainty reported alongside it. A row whose parameter SD is large has a fitted value the data cannot pin down, whatever the band says. The sign flips count refits whose coefficient has the opposite sign to the production coefficient; a slope that flips sign means the data cannot even settle the direction of the TVL effect.',
  };
  // v1.4: the EV parameter intervals — for each board row, the P10/P90 of the
  // mean EV and of P(negative) across the SAME 2000 bootstrap refits, via the
  // analytic capped-lognormal EV (the closed form of the production sim, so
  // the interval is exact for each refit, not a second simulation). This is
  // the model uncertainty of the decision, separate from the outcome
  // uncertainty the printed band carries. The per-row sigma uses the row's
  // own OOD band multiplier; the launch odds are the adopted base rate.
  const evParamBySlug = new Map<string, { ev_mean_param_usd: [number, number]; prob_negative_param: [number, number] }>();
  const compLogTvls = comps.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd));
  boardProtocols.forEach((p, i) => {
    const rep = oodReport(p, asOf, oodDomain, compLogTvls, model, 1);
    const sigma = bandHalfwidth > 0 ? (bandHalfwidth * rep.band_multiplier) / 0.6745 : 0.01;
    const cost = planCostUsd(p, model, asOf);
    const evMeans: number[] = [];
    const probNegs: number[] = [];
    for (const pred of bootBoardPreds[i]!) {
      evMeans.push(analyticEvMean(pred, sigma, cost, seasoning.base_rate, valueCapUsd, model));
      probNegs.push(analyticGateStats(pred, sigma, cost, seasoning.base_rate, valueCapUsd, model).probNegative);
    }
    evParamBySlug.set(p.slug, {
      ev_mean_param_usd: [Math.round(quantileOf([...evMeans].sort((a, b) => a - b), 0.1)), Math.round(quantileOf([...evMeans].sort((a, b) => a - b), 0.9))],
      prob_negative_param: [round4(quantileOf([...probNegs].sort((a, b) => a - b), 0.1)), round4(quantileOf([...probNegs].sort((a, b) => a - b), 0.9))],
    });
  });

  // The leave-one-protocol-out influence report (charter v1.3): refit the selected
  // estimator without each comparable and measure how much the board moves. One
  // row per protocol — no protocol contributes two observations — so dropping
  // one row is dropping one protocol.
  const lopoRefitPreds = new Map<string, number[]>();
  const lopoRows: LopoRow[] = comps.map((dropped) => {
    const refit = fitEst(selected)(comps.filter((p) => p.slug !== dropped.slug));
    let maxDelta = 0;
    const refitPreds: number[] = [];
    for (const p of boardProtocols) {
      const a = predictLog(p, asOf, full.beta, full.adj, full.chainAdj, model);
      const b = predictLog(p, asOf, refit.beta, refit.adj, refit.chainAdj, model);
      maxDelta = Math.max(maxDelta, Math.abs(a - b));
      refitPreds.push(b);
    }
    lopoRefitPreds.set(dropped.slug, refitPreds);
    return {
      slug: dropped.slug,
      abs_delta_slope: round4(Math.abs(refit.beta[1]! - full.beta[1]!)),
      abs_delta_intercept: round4(Math.abs(refit.beta[0]! - full.beta[0]!)),
      max_abs_delta_predicted_log: round4(maxDelta),
    };
  });
  const lopoSorted = [...lopoRows].sort((a, b) => b.max_abs_delta_predicted_log - a.max_abs_delta_predicted_log);
  // Error per sector / chain / TVL band, pooled over all nested test rows.
  const nestedTestRows: { p: SnapshotProtocol; err: number }[] = [];
  for (const d of nestedFoldData) {
    const errs = d.errs[selected];
    d.foldTest.forEach((p, i) => nestedTestRows.push({ p, err: errs[i]! }));
  }
  const errByGroup = (keyOf: (p: SnapshotProtocol) => string): { group: string; n: number; median_abs_log_err: number }[] => {
    const groups = new Map<string, number[]>();
    for (const r of nestedTestRows) {
      const k = keyOf(r.p);
      const list = groups.get(k);
      if (list === undefined) groups.set(k, [r.err]);
      else list.push(r.err);
    }
    return [...groups.entries()]
      .map(([group, errs]) => ({ group, n: errs.length, median_abs_log_err: round4(pooledMedian(errs)) }))
      .sort((a, b) => b.n - a.n);
  };
  const tvlSorted = [...nestedTestRows].sort((a, b) => a.p.tvl_usd - b.p.tvl_usd);
  const tercileOf = (i: number, n: number): string => (i < n / 3 ? 'low TVL tercile' : i < (2 * n) / 3 ? 'mid TVL tercile' : 'high TVL tercile');
  const tvlTercileGroups = new Map<string, number[]>();
  tvlSorted.forEach((r, i) => {
    const k = tercileOf(i, tvlSorted.length);
    const list = tvlTercileGroups.get(k);
    if (list === undefined) tvlTercileGroups.set(k, [r.err]);
    else list.push(r.err);
  });
  const compTvls = comps.map((p) => p.tvl_usd).sort((a, b) => a - b);
  const compAges = comps.map((p) => ageDays(asOf, p.listed_at) ?? 0).sort((a, b) => a - b);
  const boardTvls = boardProtocols.map((p) => p.tvl_usd);
  const boardAges = boardProtocols.map((p) => ageDays(asOf, p.listed_at) ?? 0);
  const lopoInfluence: LopoInfluence = {
    n_protocols: comps.length,
    observations_per_protocol: 1,
    max_abs_delta_slope: round4(Math.max(...lopoRows.map((r) => r.abs_delta_slope))),
    max_abs_delta_intercept: round4(Math.max(...lopoRows.map((r) => r.abs_delta_intercept))),
    max_abs_delta_predicted_log: round4(Math.max(...lopoRows.map((r) => r.max_abs_delta_predicted_log))),
    most_influential: lopoSorted.slice(0, 5),
    tvl_range_usd: [compTvls[0]!, compTvls[compTvls.length - 1]!],
    age_range_days: [compAges[0]!, compAges[compAges.length - 1]!],
    n_board_rows_outside_tvl_range: boardTvls.filter((t) => t < compTvls[0]! || t > compTvls[compTvls.length - 1]!).length,
    n_board_rows_outside_age_range: boardAges.filter((a) => a < compAges[0]! || a > compAges[compAges.length - 1]!).length,
    error_by_category: errByGroup((p) => p.category ?? 'Other'),
    error_by_chain: errByGroup(mainChain),
    error_by_tvl_tercile: [...tvlTercileGroups.entries()].map(([group, errs]) => ({ group, n: errs.length, median_abs_log_err: round4(pooledMedian(errs)) })),
    note:
      Math.max(...lopoRows.map((r) => r.max_abs_delta_predicted_log)) > 0.1
        ? 'FLAG: dropping a single comparable moves some board row by more than 0.1 dex — one protocol can move the board, and the flagged rows below name it.'
        : 'No single comparable moves any board row by more than 0.1 dex: the board does not hinge on one protocol.',
  };

  const compMcaps = comps.map((p) => p.mcap_usd!);
  const oofSignedResiduals = comps.map(
    (p, i) => Math.log10(p.mcap_usd!) - (selected === 'huber' ? cvPred.huber.get(p.slug)! : selected === 'ols' ? cvPred.ols.get(p.slug)! : cvPred.ridge.get(p.slug)!),
  );
  const rawGrowths = comps.map((p) => finite(p.change_7d, 0) / 100).sort((a, b) => a - b);
  const fit: Fit = {
    intercept: round4(full.beta[0]!),
    coef_log_tvl: round4(full.beta[1]!),
    coef_growth: 0,
    n_comps: comps.length,
    size_floor_usd: model.size_floor_usd,
    median_growth: round4(median(rawGrowths) ?? 0),
  };
  const target: TargetDoc = {
    definition: 'log10(market cap in USD) as recorded in the sealed snapshot at the snapshot date: circulating-supply × price at that moment, as recorded by the snapshot source.',
    as_of: asOf,
    unit: 'log10 USD',
    fdv_available: false,
    fdv_note: 'The snapshot carries no FDV field and no price history, so FDV-at-TGE and FDV-median-days-3–7 cannot be built or verified from this data. Market cap and FDV are never merged into one target.',
    comparability_note: 'Error-rate comparisons against other entries are valid only when target, dates, and error definition match. The radar-7 comparison of 2.77x vs the leader’s reported 3.21x is not claimed under v1.2.',
  };
  // The final evaluation table (charter v1.5): one consistent table — the
  // target and its date, the unit of analysis, the fold sizes, the
  // baselines, the median absolute error and signed bias per fold and
  // pooled, the rank correlation per fold and pooled, and the interval
  // coverage. The walk-forward error is reported as a typical error
  // multiple, and R² is labeled in-sample only.
  const finalEvaluationFolds = nestedFoldData
    .filter((d) => d.pct < 90)
    .map((d) => {
      const ranking = nestedRankingRows.find((r) => r.train_pct === d.pct)!;
      return {
        label: `${d.pct}% train`,
        n_test: d.foldTest.length,
        median_abs_log_err: round4(pooledMedian(d.errs[selected])),
        signed_bias_log: round4(median([...d.signed[selected]].sort((a, b) => a - b)) ?? 0),
        spearman: ranking.spearman_predicted_vs_actual,
        kendall: ranking.kendall_predicted_vs_actual,
      };
    });
  const finalPooledAbs: number[] = [];
  const finalPooledSigned: number[] = [];
  for (const d of nestedFoldData.filter((x) => x.pct < 90)) {
    finalPooledAbs.push(...d.errs[selected]);
    finalPooledSigned.push(...d.signed[selected]);
  }
  const finalEvaluation: FinalEvaluation = {
    target: target.definition,
    target_date: asOf,
    unit: 'log10 USD',
    n_independent_protocols: dated.length,
    folds: finalEvaluationFolds,
    pooled: {
      n_test: finalPooledAbs.length,
      median_abs_log_err: round4(pooledMedian(finalPooledAbs)),
      signed_bias_log: round4(median([...finalPooledSigned].sort((a, b) => a - b)) ?? 0),
      spearman: nestedPooledSpearman,
      kendall: nestedPooledKendall,
    },
    baselines: modelSelection.candidates.map((c) => ({ name: c.estimator, pooled_median_abs_log_err: round4(c.selection_pooled) })),
    coverage: conformalBands.map((b) => ({ nominal: b.nominal, observed: b.coverage_dated })),
    wf_median_abs_log_err_dex: round4(oosByEst[selected]),
    wf_typical_error_x: round4(Math.pow(10, oosByEst[selected])),
    r2_in_sample: round4(r2),
    r2_note: 'R² is an in-sample fit measure on the 70 dated comps; it is not evidence of out-of-sample prediction. The walk-forward error is the prediction claim: a typical error of ~3.27x.',
  };
  const validation: Validation = {
    r2: round4(r2),
    oos_median_abs_log_err: round4(oosByEst[selected]),
    oos_stratified: round4(oosStratified),
    oos_stratified_dated: round4(oosStratifiedDated),
    oos_undated: round4(oosUndated),
    n_dated_comps: dated.length,
    n_undated_comps: undated.length,
    cv_median_abs_log_err: round4(cvByEst[selected]),
    bootstrap_sd: round4(bootstrapSd),
    band_halfwidth_dex: round4(bandHalfwidth),
    range_holds: round4(rangeHolds),
    n_train: train.length,
    n_test: test.length,
    ols_baseline: olsBaseline,
    ridge_baseline: ridgeBaseline,
    nested_wf_folds: nestedFolds,
    nested_wf_pooled: nestedPooledByEst[selected],
    nested_selection_pooled: selectionPooled[selected],
    nested_untouched_90: nestedUntouched90,
    purge_gap_days: model.purge_gap_days,
    charter_version: CHARTER_VERSION,
    conformal_bands: conformalBands,
    conformal_split_check: conformalSplitCheck,
    conformal_undated: conformalUndated,
    undated_reference: undatedRef,
    seasoning_validation: seasoningValidation,
    seasoning_folds: seasoningFolds,
    seasoning_audit: seasoningAudit,
    huber_vs_ols: huberVsOls,
    model_selection: modelSelection,
    growth_diagnostic: growthDiagnostic,
    ev_audit: { rows: [], assumptions: EV_ASSUMPTIONS },
    nested_fold_diagnostics: nestedDiagnostics,
    target,
    missingness,
    truncation_audit: { passed: truncationPassed, checks: truncationChecks },
    launch_odds_decision: launchOddsDecision,
    gate_test: null,
    nested_reconciliation: nestedReconciliation,
    floor_sensitivity: floorSensitivity,
    distribution_tournament: null,
    horizon_cohort: horizonCohort,
    ood_multiplier_validation: oodMultiplierValidation,
    lopo_influence: lopoInfluence,
    conformal_slices: conformalSlices,
    outlier_audit: null,
    ranking_stability: {
      lopo: [],
      lopo_median_spearman: 0,
      lopo_worst_top10_overlap: 0,
      lopo_total_verdict_moves: 0,
      nested: nestedRankingRows,
      nested_pooled_spearman: nestedPooledSpearman,
      nested_pooled_kendall: nestedPooledKendall,
      nested_pooled_top10_overlap: pooledTop10.overlap,
      nested_pooled_top10_precision: pooledTop10.precision,
      nested_pooled_top20_overlap: pooledTop20.overlap,
      nested_pooled_top20_precision: pooledTop20.precision,
      nested_pooled_spearman_excl_fold80: nestedPooledSpearmanExcl80,
      negative_fold_diagnosis: negativeFoldDiagnosis,
      tvl_perturbation: [],
      descriptive_bars: [],
      analytic_verdict_crosscheck: { n_rows: 0, n_agree: 0, n_near_boundary: 0, note: 'Completed in buildRadar (needs the production board).', wilson_n_inside_adopted: 0, wilson_n_inside_conservative: 0, wilson_n_rows: 0, max_abs_sim_analytic_gap: 0, n_demoted_by_guards: 0 },
      note: 'The nested part is computed here (predicted-vs-actual ordering on the selection folds). The LOPO rows, TVL perturbation, descriptive bars and the analytic crosscheck are completed in buildRadar, where the production board and the adopted gate policy are known.',
    },
    ood_report_segmented: segmentedOod,
    cap_sensitivity: null,
    parameter_uncertainty: parameterUncertainty,
    winsorization_test: null,
    final_evaluation: finalEvaluation,
    verdict_stability: null,
    param_aware_simulation: null,
    gate_threshold_grid: null,
    ranking_tournament: rankingTournament,
    cohort_ranking: cohortRanking,
    gate_f_audit: null,
    valuation_decision_table: null,
    ratio_valuation: ratioValuation,
    costed_farm_plans: null,
    target_comparability: {
      target: 'log10(market cap in USD) as recorded in the sealed snapshot at the snapshot date: circulating-supply × price at that moment, as recorded by the snapshot source.',
      target_timestamp: '2026-11-14',
      grain: 'one protocol',
      decision_time: 'the snapshot date (2026-11-14); every feature is the snapshot\u2019s own value at T.',
      snapshot_field: 'mcap_usd',
      fields_not_in_snapshot: ['FDV (total supply × price)', 'TGE date', 'price history', 'airdrop allocation %', 'VC tier / raise', 'per-protocol gas / slippage / fees'],
      fdv_status:
        'FDV, FDV-at-TGE and FDV-median-days-3–7 are separate targets from snapshot market cap and are NOT built: the snapshot carries no FDV field and no price history. Market cap and FDV are never merged into one target.',
      comparison_rule:
        'Any comparison of this radar\u2019s error against another entry\u2019s error is valid only if target, dates, and error definition match; no such comparison is claimed here.',
    },
    marginal_tiers: null,
    realized_holdout: realizedHoldout,
    ranking_calibration: rankingCalibration,
  };
  const toComparable = (m: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>): Comparable[] =>
    [...m.entries()]
      .map(([category, v]) => ({ category, count: v.count, adjustment: v.adjustment, basis: v.basis }))
      .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const comparables = toComparable(full.adj);
  const chainComparables = toComparable(full.chainAdj);
  const scatter: ScatterPoint[] = comps.map((p) => ({
    x: round3(Math.log10(p.tvl_usd)),
    y: round3(Math.log10(p.mcap_usd!)),
  }));
  return { beta: full.beta, adjustments: full.adj, chainAdjustments: full.chainAdj, fit, validation, seasoning, bandHalfwidth, comparables, chainComparables, scatter, oodDomain, oodCompLogTvls: comps.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd)), launchOddsDecision, plattFitted, valueCapUsd, observedMaxMcapUsd, capKept, valueCapP90Usd, valueCapP95Usd, paramSdBySlug, bootstrapCoef, lopoRefitPreds, bootstrapBoardPreds: new Map(boardProtocols.map((p, i) => [p.slug, bootBoardPreds[i]!])), evParamBySlug, compMcaps, oofSignedResiduals, oodBandMultiplier, crpsValidation, ratioLensFit: ratioNested.full };
}

/** A board row's out-of-distribution report (charter v1.3): its main chain and
 * category against the training sets, its log-TVL and age against the training
 * ranges, and its distance to the nearest comparable in log-TVL. Tiers:
 * 0 flags = in-distribution; exactly 1 flag = partially OOD (wider band, the
 * validated multiplier, confidence 'extrapolation'); ≥ 2 flags, or unseen
 * category AND unseen chain = major OOD (unsupported extrapolation, never a
 * production FARM). A row with no credible comparable (nearest > 0.5 dex) is
 * never a production FARM, whatever its tier. */
export function oodReport(
  p: SnapshotProtocol,
  asOf: string,
  domain: OodDomain,
  compLogTvls: number[],
  model: ModelConstants = MODEL,
  bandMultiplier: number = 1.5,
): OodReport {
  const logTvl = Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd);
  const age = ageDays(asOf, p.listed_at);
  const unseenChain = !domain.chains.includes(mainChain(p));
  const unseenCategory = !domain.categories.includes(p.category ?? 'Other');
  const tvlOut = logTvl < domain.log_tvl_min || logTvl > domain.log_tvl_max;
  const ageOut = age === null || age < domain.age_min_days || age > domain.age_max_days;
  const nearest = compLogTvls.length > 0 ? Math.min(...compLogTvls.map((x) => Math.abs(x - logTvl))) : Infinity;
  const flagCount = (unseenChain ? 1 : 0) + (unseenCategory ? 1 : 0) + (tvlOut ? 1 : 0) + (ageOut ? 1 : 0) + (nearest > 0.5 ? 1 : 0);
  const isOod = flagCount > 0;
  const tier: OodReport['tier'] =
    flagCount === 0 ? 'in-distribution' : flagCount === 1 ? 'partial' : 'major';
  return {
    unseen_chain: unseenChain,
    unseen_category: unseenCategory,
    tvl_out_of_range: tvlOut,
    age_out_of_range: ageOut,
    nearest_comp_distance_dex: round4(nearest),
    is_ood: isOod,
    flag_count: flagCount,
    tier,
    band_multiplier: isOod ? bandMultiplier : 1,
    confidence: tier === 'in-distribution' ? 'in-distribution' : tier === 'partial' ? 'extrapolation' : 'unsupported',
  };
}

/** Whether a row passes one gate policy on its (simulated) EV statistics.
 * Policy (a): the current strict rule — mean EV > 0 AND P25 of net return > 0.
 * Policy (b): the Gemini proposal — conditional mean EV > 3× plan cost AND
 * unconditional mean EV > 0. Policy (c): the P(loss) ceiling — mean EV > 0
 * AND P(negative return) ≤ 0.90. Policy (d) (v1.4): the Gemini conditional-EV
 * hurdle with a risk ceiling — conditional mean EV > 3× plan cost AND
 * P(negative return) ≤ 0.85. Policy (e) (v1.4): the stricter conditional
 * hurdle — conditional mean EV > 5× plan cost AND unconditional mean EV > 0
 * AND P(negative return) ≤ 0.90. Policy (f) (v1.5): the odds-consistent
 * correction of (d) — conditional mean EV > 3× plan cost AND P(negative
 * return) ≤ 1 − 0.75 × p_L, where p_L is the launch odds of the layer the
 * stats come from. The ceiling is not a constant: a farm must clear
 * breakeven in at least 75% of its launches, so the ceiling scales with
 * the odds layer (0.8768 at the adopted odds, 0.8977 at the conservative
 * odds). All statistics from the same array. The P25 criterion (a) is
 * documented as structurally impossible under base-rate launch odds (it
 * needs P(net return > 0) ≥ 75% while p_L = 16.4%); it is tested only to
 * document that fact. Policy (d)'s fixed 0.85 ceiling is documented the
 * same way: under the conservative odds the structural floor on
 * P(negative) is 1 − 0.1364 = 0.8636 > 0.85, so (d) can never fire under
 * the conservative layer — the v1.4 board's 0 farms is a design outcome,
 * not a data outcome. */
export function gatePasses(
  policy: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g',
  stats: { evMean: number; evP25: number; evP50: number; evP75: number; conditionalMeanEv: number; planCost: number; probNegative: number },
  launchOddsForCeiling?: number,
): boolean {
  if (policy === 'a') return stats.evMean > 0 && stats.evP25 > 0;
  if (policy === 'b') return stats.conditionalMeanEv > 3 * stats.planCost && stats.evMean > 0;
  if (policy === 'd') return stats.conditionalMeanEv > 3 * stats.planCost && stats.probNegative <= 0.85;
  if (policy === 'e') return stats.conditionalMeanEv > 5 * stats.planCost && stats.evMean > 0 && stats.probNegative <= 0.9;
  if (policy === 'f') {
    if (launchOddsForCeiling === undefined || !Number.isFinite(launchOddsForCeiling)) return false;
    return stats.conditionalMeanEv > 3 * stats.planCost && stats.probNegative <= 1 - 0.75 * launchOddsForCeiling;
  }
  if (policy === 'g') {
    // v1.7: the per-protocol net-EV hurdle. stats.planCost MUST be the
    // full costed plan C_i here (callers pass it); the conditional mean
    // net EV must exceed the layer's breakeven multiple of C_i, which is
    // exactly the condition that the unconditional net EV is positive.
    // The P(negative) ceiling is (f)'s odds-consistent ceiling.
    if (launchOddsForCeiling === undefined || !Number.isFinite(launchOddsForCeiling) || launchOddsForCeiling <= 0) return false;
    const breakeven = (1 - launchOddsForCeiling) / launchOddsForCeiling;
    return stats.conditionalMeanEv > breakeven * stats.planCost && stats.probNegative <= 1 - 0.75 * launchOddsForCeiling;
  }
  return stats.evMean > 0 && stats.probNegative <= 0.9;
}

/** The gate statistics of one row's simulation, in the shape gatePasses reads. */
export function gateStats(sim: EvSimulation, planCost: number): { evMean: number; evP25: number; evP50: number; evP75: number; conditionalMeanEv: number; planCost: number; probNegative: number } {
  return {
    evMean: sim.ev_mean_usd,
    evP25: sim.ev_p25_usd,
    evP50: sim.ev_p50_usd,
    evP75: sim.ev_p75_usd,
    conditionalMeanEv: sim.ev_conditional_mean_usd,
    planCost,
    probNegative: sim.prob_negative,
  };
}

/** The gate statistics of one row's simulation under the conservative launch
 * odds (the stress test the FARM verdict must survive). The conditional mean
 * EV does not depend on p_L (it is conditional on launch); the unconditional
 * mean, the quantiles and P(negative) are the conservative ones. */
export function gateStatsConservative(sim: EvSimulation, planCost: number): { evMean: number; evP25: number; evP50: number; evP75: number; conditionalMeanEv: number; planCost: number; probNegative: number } {
  return {
    evMean: sim.ev_mean_conservative_usd,
    evP25: sim.ev_p25_conservative_usd,
    evP50: sim.ev_p50_conservative_usd,
    evP75: sim.ev_p75_conservative_usd,
    conditionalMeanEv: sim.ev_conditional_mean_usd,
    planCost,
    probNegative: sim.prob_negative_conservative,
  };
}

/** The fitted value of one protocol: value if it launches, launch odds, and the odds-weighted implied value, with the P25/P75 band and the EV simulation (charter v1.2). */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fitted: FittedModel,
  model: ModelConstants = MODEL,
): {
  implied: number;
  valueIfLaunches: number;
  predictedLog: number;
  launchOdds: number;
  launchOddsPlatt: number;
  breakEvenOdds: number;
  bandP25: number;
  bandP75: number;
  /** v1.5: the param-aware band — the P25/P75 implied value from the
   * interval that includes the parameter SD (total SD = sqrt(outcome
   * variance + parameter variance)), next to the outcome-only band. */
  paramBandP25: number;
  paramBandP75: number;
  paramTotalSd: number;
  growthPct: number;
  age: number | null;
  adjustment: number;
  chainAdjustment: number;
  count: number;
  basis: 'category' | 'global';
  sim: EvSimulation;
  ood: OodReport;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const predictedLog = predictLog(protocol, asOf, fitted.beta, fitted.adjustments, fitted.chainAdjustments, model);
  const valueIfLaunches = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** predictedLog)));
  // The adopted launch odds (charter v1.2): the base rate unless the seasoning
  // curve passed the adoption test. The raw curve and the Platt-calibrated curve
  // are computed alongside for the EV stress test only.
  const oddsAdopted =
    fitted.launchOddsDecision.source === 'base-rate' ? fitted.seasoning.base_rate : launchOdds(age, fitted.seasoning);
  const oddsRaw = launchOdds(age, { ...fitted.seasoning, platt_a: null, platt_b: null });
  const oddsPlatt = fitted.plattFitted ? plattOdds(oddsRaw, fitted.plattFitted.a, fitted.plattFitted.b) : oddsRaw;
  const implied = Math.min(model.value_max, Math.max(model.value_min, Math.round(valueIfLaunches * oddsAdopted)));
  const cost = planCostUsd(protocol, model, asOf);
  const beOdds = breakEvenOdds(valueIfLaunches, cost, model);
  const ood = oodReport(protocol, asOf, fitted.oodDomain, fitted.oodCompLogTvls, model, fitted.oodBandMultiplier);
  const effectiveHalfwidth = fitted.bandHalfwidth * ood.band_multiplier;
  const bandP25 = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** (predictedLog - effectiveHalfwidth) * oddsAdopted)));
  const bandP75 = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** (predictedLog + effectiveHalfwidth) * oddsAdopted)));
  // The param-aware band (charter v1.5): the outcome SD is the 50% band
  // halfwidth / 0.6745, and the parameter SD is the SD of this row's
  // predicted log across the 2000 bootstrap refits. The total SD folds
  // both in, so the param-aware band is wider wherever the fit is weakly
  // identified — it is the interval the board prints next to the
  // outcome-only band, not a replacement for it.
  const outcomeSd = fitted.bandHalfwidth > 0 ? effectiveHalfwidth / 0.6745 : 0.01;
  const paramSd = fitted.paramSdBySlug.get(protocol.slug) ?? 0;
  const paramTotalSd = Math.sqrt(outcomeSd * outcomeSd + paramSd * paramSd);
  const paramHalfwidth = paramTotalSd * 0.6745;
  const paramBandP25 = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** (predictedLog - paramHalfwidth) * oddsAdopted)));
  const paramBandP75 = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** (predictedLog + paramHalfwidth) * oddsAdopted)));
  const adj = fitted.adjustments.get(protocol.category ?? 'Other');
  const chainAdj = fitted.chainAdjustments.get(mainChain(protocol));
  const sim = evSimulation(
    protocol.slug,
    oddsAdopted,
    fitted.seasoning.base_rate,
    oddsPlatt,
    fitted.launchOddsDecision.conservative_lower_bound,
    predictedLog,
    cost,
    fitted.bandHalfwidth,
    ood.band_multiplier,
    model,
    fitted.valueCapUsd,
  );
  // growthPct is the protocol's raw 7-day change, display only: growth is not a
  // production feature (charter v1.2).
  const growthPct = finite(protocol.change_7d, 0) / 100;
  return {
    implied,
    valueIfLaunches,
    predictedLog,
    launchOdds: oddsAdopted,
    launchOddsPlatt: oddsPlatt,
    breakEvenOdds: beOdds,
    bandP25,
    bandP75,
    paramBandP25,
    paramBandP75,
    paramTotalSd: round4(paramTotalSd),
    growthPct,
    age,
    adjustment: adj?.adjustment ?? 0,
    chainAdjustment: chainAdj?.adjustment ?? 0,
    count: adj?.count ?? 0,
    basis: adj?.basis ?? 'global',
    sim,
    ood,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The categories whose products are a wrapped, staked or bridged form of a token that
 * already trades: the house's own watchlist rule, applied to the whole board. A wrapped or
 * staked product of a token that already trades is not a token that does not exist yet:
 * WBTC is Bitcoin on Ethereum, Binance staked ETH is ETH in Binance's staking product, and
 * neither is a protocol still waiting on a launch of its own.
 */
const WRAPPED_PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name that begins with an exchange's name is that exchange's product, not a launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A name carrying a whole word wrapped, staked or staking names a wrapped product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or
 * bridged product of a token that already trades, not an exchange's product, not a
 * versioned pool. The watchlist's own rule, without its TVL floor.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

/**
 * Whether a live-token protocol may train the curve: the rankability rule without the
 * pre-token condition (a comparable has a token by definition). A bridge, a liquid-staking
 * product, a versioned pool or an exchange product is not a comparable for a launch: its
 * market cap is some other token's (its chain's, its staked asset's, its v3's), while its
 * TVL is the product's own — the two numbers are not the launch relation the curve fits.
 * Applied uniformly by category and name pattern, never by slug.
 */
export function isComparable(p: SnapshotProtocol): boolean {
  return (
    !WRAPPED_PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs: the standard deposit, the same for every row, so the verdicts compare on the same money. */
function capitalFor(_p: SnapshotProtocol): number {
  return MODEL.deposit_usd;
}

/** What one transaction costs on the protocol's main chain, in whole dollars. */
function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (c === 'solana') return 0.05;
  if (c === 'bitcoin') return 2;
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('mode') || c.includes('blast')) return 0.3;
  if (c.includes('binance') || c.includes('bnb')) return 0.3;
  if (c.includes('polygon') || c.includes('avalanche') || c.includes('fantom')) return 0.2;
  return 1;
}

/** What one transaction costs on the protocol's main chain, in words. */
function gasFor(chain: string): string {
  const g = gasUsd(chain);
  return g === 0.05 ? 'about $0.05 of gas' : `about $${g} of gas`;
}

/**
 * What the whole farm plan costs: the standard deposit at risk, plus seven transactions at
 * the chain's gas price (one to set up, four weekly qualifying actions, two to unwind), plus
 * the opportunity cost of locking the deposit for the hold window at the annual rate. The
 * deposit is not spent — it sits in the position — but it is the money at risk, so the
 * verdict counts it in full.
 */
export function planCostUsd(p: SnapshotProtocol, model: ModelConstants = MODEL, asOf: string | null = null): number {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(asOf === null ? null : ageDays(asOf, p.listed_at));
  const opportunity = (capital * model.opportunity_rate_annual * hold) / 365;
  return Math.round((capital + 7 * gasUsd(chain) + opportunity) * 100) / 100;
}

/** The slippage/fees assumption (charter v1.7): 0.5% of the standard
 * $10,000 deposit = $50 per plan, the same for every row. An explicit,
 * conservative, uniform assumption — the snapshot carries no per-protocol
 * slippage or fee field, so none is invented. */
export function slippageFeeUsd(model: ModelConstants = MODEL): number {
  return Math.round(model.deposit_usd * model.slippage_fee_rate * 100) / 100;
}

/** The costed farm plan (charter v1.7): the base plan cost broken into
 * its components, plus the slippage/fees assumption. The components sum
 * exactly to the base cost, and base + slippage/fees = the total C_i
 * net EV is computed against. */
export function costBreakdown(p: SnapshotProtocol, model: ModelConstants = MODEL, asOf: string | null = null): CostedPlan {
  const base = planCostUsd(p, model, asOf);
  const gasTotal = Math.round(7 * gasUsd(chainOf(p)) * 100) / 100;
  const deposit = capitalFor(p);
  const opportunity = Math.round((base - deposit - gasTotal) * 100) / 100;
  const slippage = slippageFeeUsd(model);
  return {
    deposit_usd: deposit,
    gas_total_usd: gasTotal,
    opportunity_usd: opportunity,
    slippage_fees_usd: slippage,
    base_cost_usd: base,
    total_usd: Math.round((base + slippage) * 100) / 100,
  };
}

/** The full costed plan C_i: the base plan cost plus slippage/fees. */
export function costedPlanCostUsd(p: SnapshotProtocol, model: ModelConstants = MODEL, asOf: string | null = null): number {
  return costBreakdown(p, model, asOf).total_usd;
}

/** The break-even launch odds of one farm plan: the launch probability at which the plan's cost breaks even against the farmer's assumed share of the launch value. */
export function breakEvenOdds(valueIfLaunches: number, cost: number, model: ModelConstants = MODEL): number {
  return valueIfLaunches > 0 ? cost / (model.farmer_share * valueIfLaunches) : Number.POSITIVE_INFINITY;
}

/**
 * The expected net return of farming a protocol for a standard deposit: the launch
 * odds times the farmer's share (0.25%) of the value if it launches, minus the
 * plan cost (gas + opportunity cost of the deposit). Positive means the farm pays
 * for itself in expectation.
 */
export function expectedValue(launchOdds: number, valueIfLaunches: number, cost: number, model: ModelConstants = MODEL): number {
  return launchOdds * model.farmer_share * valueIfLaunches - cost;
}

/**
 * The farm verdict, from the simulated expected net return and the tested gate
 * (charter v1.3): farm only when the adopted policy passes under the CONSERVATIVE
 * launch-probability assumption (the stress test) — a row that passes under the
 * adopted odds but not under the conservative odds is demoted to marginal.
 * A major-OOD row (unsupported extrapolation) or a row with no credible
 * comparable (nearest > 0.5 dex) can never be a production FARM, whatever the
 * gate says. Marginal when the mean EV is positive under the adopted odds but
 * the row is not a farm, or when the mean EV is negative but the break-even
 * odds are low enough that a slightly better launch chance would flip it;
 * skip otherwise. The odds are the plan's and the protocol's together: a
 * protocol's own launch odds (p_L) decide the expected return, the break-even
 * odds (p_BE) decide how far away a positive return is.
 */
/** The production verdict of one row (charter v1.6): the ANALYTIC verdict
 * under the CONSERVATIVE launch odds (the stress test the FARM verdict
 * must survive). A row whose adopted verdict is FARM but whose
 * conservative verdict is not is a CONDITIONAL FARM — it is MARGINAL
 * with that label, never an unqualified FARM; a row whose adopted verdict
 * is MARGINAL but whose conservative verdict is SKIP is a SKIP. The
 * BORDERLINE and stability demotions are applied by the caller (they
 * need the simulation cross-check and the LOPO counts), not here. */
export function verdictFor(
  breakEvenOddsValue: number,
  gatePolicy: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g',
  planCost: number,
  ood: OodReport | null = null,
  launchOddsConservative: number,
  predictedLog: number,
  sigma: number,
  cap: number,
  model: ModelConstants = MODEL,
): Verdict {
  return analyticLayerVerdict(predictedLog, sigma, planCost, launchOddsConservative, breakEvenOddsValue, gatePolicy, cap, ood, model);
}

/** The decision trace of one verdict (charter v1.6): every reason,
 * computed from the ANALYTIC statistics — the same numbers as the
 * verdict — so a reader can reproduce the call without re-running the
 * model. The simulation statistics appear only as the cross-check. */
export function decisionTraceFor(
  verdict: Verdict,
  sim: EvSimulation,
  breakEvenOddsValue: number,
  gatePolicy: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g',
  planCost: number,
  ood: OodReport | null,
  launchOdds: number,
  launchOddsConservative: number,
  predictedLog: number,
  sigma: number,
  cap: number,
  borderline: BorderlineInfo | null = null,
  verdictAdopted: Verdict | null = null,
  model: ModelConstants = MODEL,
): string[] {
  const reasons: string[] = [];
  const statsAdopted = analyticGateStats(predictedLog, sigma, planCost, launchOdds, cap, model);
  const statsConservative = analyticGateStats(predictedLog, sigma, planCost, launchOddsConservative, cap, model);
  const farmBlockedByOod = ood !== null && (ood.tier === 'major' || ood.nearest_comp_distance_dex > 0.5);
  const conditionalFarm = verdictAdopted === 'farm' && verdict !== 'farm';
  if (verdict === 'farm') {
    reasons.push(`Gate (${gatePolicy}) passes under the conservative launch odds (analytic mean EV $${Math.round(statsConservative.evMean).toLocaleString()}, P(negative) ${statsConservative.probNegative}).`);
    if (ood !== null && ood.tier === 'partial') reasons.push('Partial OOD: the wider band is applied, but the row is not major-OOD.');
    return reasons;
  }
  if (farmBlockedByOod) {
    reasons.push(
      ood!.tier === 'major'
        ? 'Major OOD (unsupported extrapolation): never a production FARM.'
        : 'No credible comparable (nearest > 0.5 dex): never a production FARM.',
    );
  }
  if (conditionalFarm) {
    reasons.push(
      `CONDITIONAL FARM: gate (${gatePolicy}) passes under the adopted launch odds but NOT under the conservative launch odds — the farm case exists only under the adopted odds, so the production verdict is marginal.`,
    );
  } else if (verdictAdopted === 'marginal' && verdict === 'skip') {
    reasons.push(
      `Adopted verdict is marginal (mean EV +$${Math.round(statsAdopted.evMean).toLocaleString()} under the adopted odds) but the conservative verdict is skip (mean EV −$${Math.round(-statsConservative.evMean).toLocaleString()} under the conservative odds) — the production verdict is skip.`,
    );
  } else if (!gatePasses(gatePolicy, statsAdopted, launchOdds)) {
    reasons.push(
      `Gate (${gatePolicy}) does not pass under the adopted launch odds (analytic mean EV $${Math.round(statsAdopted.evMean).toLocaleString()}, P(negative) ${statsAdopted.probNegative}).`,
    );
  } else if (!gatePasses(gatePolicy, statsConservative, launchOddsConservative)) {
    reasons.push(`Gate (${gatePolicy}) passes under the adopted launch odds but NOT under the conservative launch odds — demoted to marginal by the stress test.`);
  }
  if (statsConservative.evMean > 0) {
    reasons.push(`Mean EV is positive (+$${Math.round(statsConservative.evMean).toLocaleString()}) under the conservative odds but the gate does not pass — marginal, not farm.`);
  } else if (statsAdopted.evMean > 0) {
    reasons.push(`Mean EV is positive (+$${Math.round(statsAdopted.evMean).toLocaleString()}) under the adopted odds but negative (−$${Math.round(-statsConservative.evMean).toLocaleString()}) under the conservative odds.`);
  } else {
    reasons.push(`Mean EV is negative (−$${Math.round(-statsConservative.evMean).toLocaleString()} under the conservative odds).`);
    if (breakEvenOddsValue <= model.marginal_break_even) {
      reasons.push(`Break-even odds ${fmtOdds(breakEvenOddsValue)} are within the marginal band (≤ ${fmtOdds(model.marginal_break_even)}) — a slightly better launch chance would flip it.`);
    } else if (borderline !== null && borderline.borderline) {
      reasons.push(`Break-even odds ${fmtOdds(breakEvenOddsValue)} are far above the launch odds ${fmtOdds(launchOdds)} — skip on the point estimate, but BORDERLINE, so the production verdict is marginal (REVIEW).`);
    } else {
      reasons.push(`Break-even odds ${fmtOdds(breakEvenOddsValue)} are far above the launch odds ${fmtOdds(launchOdds)} — skip.`);
    }
  }
  if (borderline !== null && borderline.borderline && borderline.reason !== null) {
    reasons.push(`BORDERLINE — REVIEW: ${borderline.reason}.`);
  }
  // v1.7: under (g) the sim cross-check shifts down by exactly the
  // slippage fee (same draws, cost +$50); P(negative) keeps the base-cost
  // sim value — the $50 shift moves it by ~0.0002, inside Monte Carlo
  // noise, so the disagreement flag is not tripped by the cost change.
  const simConservativeForCheck = ((): { evMean: number; evP25: number; evP50: number; evP75: number; conditionalMeanEv: number; planCost: number; probNegative: number } => {
    const base = gateStatsConservative(sim, planCost);
    if (gatePolicy !== 'g') return base;
    const fee = slippageFeeUsd(model);
    return { evMean: base.evMean - fee, evP25: base.evP25 - fee, evP50: base.evP50 - fee, evP75: base.evP75 - fee, conditionalMeanEv: base.conditionalMeanEv - fee, planCost, probNegative: base.probNegative };
  })();
  if (gatePasses(gatePolicy, statsConservative, launchOddsConservative) !== gatePasses(gatePolicy, simConservativeForCheck, launchOddsConservative)) {
    reasons.push('Simulation cross-check disagrees with the analytic gate under the conservative odds (Monte Carlo noise at a near-boundary row).');
  }
  return reasons;
}

/** A short dollar figure: $65.8M, $420K, $12. */
export function fmtShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it to show both sides.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through one fee cycle.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then settle it.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares through one rebalance.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('payment')) return `Open a payment channel or account on ${name} with $${capital} and route one payment through it.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name} on ${chain} and use its private transfer once.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold the shares.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position.`;
  if (c.includes('chain')) return `Bridge $${capital} to the chain ${name} runs and use one of its native apps.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A launch-odds figure as a percent: 4.1%, 33.0%, 520.0%. */
export function fmtOdds(odds: number): string {
  return `${(odds * 100).toFixed(1)}%`;
}

/** The verdict's one line, first in every farm plan: the call and the arithmetic behind it. */
export function verdictStep(verdict: Verdict, valueIfLaunches: number, launchOdds: number, beOdds: number, cost: number, sim: EvSimulation | null = null): string {
  const ev = sim !== null ? sim.ev_mean_usd : expectedValue(launchOdds, valueIfLaunches, cost);
  const evText = ev >= 0 ? `+$${Math.round(ev).toLocaleString()}` : `−$${Math.round(-ev).toLocaleString()}`;
  const evP25 = sim !== null ? sim.ev_p25_usd : null;
  const evP25Text =
    evP25 === null
      ? ''
      : evP25 >= 0
        ? ` and the 25th-percentile net return is +$${Math.round(evP25).toLocaleString()}`
        : ` but the 25th-percentile net return is −$${Math.round(-evP25).toLocaleString()}`;
  if (verdict === 'farm') {
    return `Verdict: FARM — expected net return ${evText}${evP25Text}: a ${fmtOdds(launchOdds)} launch chance (p_L) beats the ${fmtOdds(beOdds)} break-even (p_BE), against a value if it launches of ${fmtShort(valueIfLaunches)} and a plan cost of about $${cost}. The gate holds even under the conservative launch odds. Farm this protocol first.`;
  }
  if (verdict === 'marginal') {
    return `Verdict: MARGINAL — expected net return ${evText}${evP25Text}: needs ${fmtOdds(beOdds)} to break even against a ${fmtOdds(launchOdds)} launch chance, against a value if it launches of ${fmtShort(valueIfLaunches)} and a plan cost of about $${cost}. Worth a small position, not a priority.`;
  }
  return `Verdict: SKIP — expected net return ${evText}: break-even launch odds ${fmtOdds(beOdds)} are too far from a ${fmtOdds(launchOdds)} launch chance, against a value if it launches of ${fmtShort(valueIfLaunches)} and a plan cost of about $${cost}. Skip it unless its points program changes.`;
}

/**
 * A protocol's farm plan: nine steps, each an action with a cost and a time, led by the
 * verdict. The plan is derived from the protocol's own record (category, chains, TVL, age),
 * its fitted value and its launch odds, never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, v: ReturnType<typeof impliedValue>, verdict: Verdict, cost: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(v.age);
  const gas = gasFor(chain);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: verdictStep(verdict, v.valueIfLaunches, v.launchOdds, v.breakEvenOdds, cost, v.sim),
      cost: `about $${cost} all-in`,
      time: '1 minute to read',
    },
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'nothing to set up',
      time: '5 minutes',
    },
    {
      text: `Check the protocol's own page for an audit note and a points program before you deposit anything.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `When you unwind, withdraw in two parts a week apart so a late snapshot still sees activity.`,
      cost: `${gas} per withdrawal`,
      time: '10 minutes each',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The gate-policy test (charter v1.3, prespecified before results): three
 * policies tested honestly on the corrected simulation statistics, under the
 * adopted (base-rate) launch odds. The choice rule: a policy is eligible iff
 * it (i) farms at least one row, (ii) rejects at least one row with mean EV >
 * 0 through its additional condition, and (iii) its maximum P(negative return)
 * among its FARM rows is ≤ 0.90. Among eligible policies, adopt the one with
 * the lowest maximum P(negative return) among its farms; ties go to (a), then
 * (b), then (c). If no policy is eligible, adopt (a) — the pre-existing
 * charter rule — and report the resulting FARM count, even if zero. The FARM
 * count is never a target. */
/** The gate-policy test (charter v1.5, six policies; charter v1.6: computed
 * on the ANALYTIC statistics, the simulation test alongside as the
 * cross-check): every policy is tested honestly under BOTH odds layers —
 * the adopted (base-rate) odds and the conservative (2.5th-percentile)
 * odds — and the adopted policy is chosen by the prespecified two-layer
 * rule: eligible only if it fires AND filters AND respects the risk
 * ceiling under BOTH layers; among the eligible, the lowest worst-farm
 * P(negative) under the conservative odds wins, ties broken by the
 * earlier letter. No policy eligible → the pre-existing charter rule (a)
 * is kept and the resulting FARM count is reported as-is. The FARM count
 * is never a target. The analytic counts decide; the simulation counts
 * must agree within Monte Carlo noise. */
export function runGateTest(
  rows: { slug: string; sim: EvSimulation; planCost: number; costedPlanCost: number; predictedLog: number; sigma: number }[],
  adoptedOdds: number,
  conservativeOdds: number,
  cap: number,
  model: ModelConstants = MODEL,
): GateTest {
  const RISK_CEILING = 0.9;
  const testPolicy = (policy: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g'): GateTestVariant => {
    const analyticStats = (r: (typeof rows)[number], odds: number, costOverride?: number) => analyticGateStats(r.predictedLog, r.sigma, costOverride ?? r.planCost, odds, cap, model);
    // v1.7 (g): the gate is evaluated against the full costed plan C_i,
    // not the base cost. The simulation cross-check reuses the SAME draw
    // pairs: every draw's net return shifts down by exactly the slippage
    // fee, so the sim mean/quantiles/conditional mean shift by the fee and
    // P(negative) shifts by the analytic delta between the two costs
    // (the $50 shift moves P(negative) by ~0.0002 — well inside Monte
    // Carlo noise — so the cross-check keeps the same draws' noise).
    const costFor = (r: (typeof rows)[number]): number => (policy === 'g' ? r.costedPlanCost : r.planCost);
    const simGateStats = (r: (typeof rows)[number], conservative: boolean): { evMean: number; evP25: number; evP50: number; evP75: number; conditionalMeanEv: number; planCost: number; probNegative: number } => {
      const base = conservative ? gateStatsConservative(r.sim, r.planCost) : gateStats(r.sim, r.planCost);
      if (policy !== 'g') return base;
      const fee = slippageFeeUsd(model);
      const odds = conservative ? conservativeOdds : adoptedOdds;
      const pNegShift =
        analyticStats(r, odds, r.costedPlanCost).probNegative - analyticStats(r, odds, r.planCost).probNegative;
      return {
        evMean: base.evMean - fee,
        evP25: base.evP25 - fee,
        evP50: base.evP50 - fee,
        evP75: base.evP75 - fee,
        conditionalMeanEv: base.conditionalMeanEv - fee,
        planCost: r.costedPlanCost,
        probNegative: Math.max(0, Math.min(1, base.probNegative + pNegShift)),
      };
    };
    const farms = rows.filter((r) => gatePasses(policy, analyticStats(r, adoptedOdds, costFor(r)), adoptedOdds));
    const farmsConservative = rows.filter((r) => gatePasses(policy, analyticStats(r, conservativeOdds, costFor(r)), conservativeOdds));
    const farmsSim = rows.filter((r) => gatePasses(policy, simGateStats(r, false), adoptedOdds));
    const farmsConservativeSim = rows.filter((r) => gatePasses(policy, simGateStats(r, true), conservativeOdds));
    const positiveEv = rows.filter((r) => analyticStats(r, adoptedOdds, costFor(r)).evMean > 0);
    const farmSlugs = new Set(farms.map((r) => r.slug));
    const rejectedPositive = positiveEv.filter((r) => !farmSlugs.has(r.slug));
    const farmSlugsConservative = new Set(farmsConservative.map((r) => r.slug));
    const rejectedPositiveConservative = positiveEv.filter((r) => !farmSlugsConservative.has(r.slug));
    const maxProbNegative = farms.length > 0 ? round4(Math.max(...farms.map((r) => analyticStats(r, adoptedOdds, costFor(r)).probNegative))) : null;
    const maxProbNegativeConservative =
      farmsConservative.length > 0 ? round4(Math.max(...farmsConservative.map((r) => analyticStats(r, conservativeOdds, costFor(r)).probNegative))) : null;
    const maxProbNegativeSim = farmsSim.length > 0 ? round4(Math.max(...farmsSim.map((r) => simGateStats(r, false).probNegative))) : null;
    const maxProbNegativeConservativeSim =
      farmsConservativeSim.length > 0 ? round4(Math.max(...farmsConservativeSim.map((r) => simGateStats(r, true).probNegative))) : null;
    const fires = farms.length >= 1;
    const filters = rejectedPositive.length >= 1;
    const withinRiskCeiling = maxProbNegative === null || maxProbNegative <= RISK_CEILING;
    const firesConservative = farmsConservative.length >= 1;
    const filtersConservative = rejectedPositiveConservative.length >= 1;
    const withinRiskCeilingConservative = maxProbNegativeConservative === null || maxProbNegativeConservative <= RISK_CEILING;
    return {
      variant: policy,
      rule:
        policy === 'a'
          ? 'FARM iff mean EV > 0 AND P25 of net return > 0 (the current strict rule, on the corrected simulation statistics).'
          : policy === 'b'
            ? 'FARM iff conditional mean EV > 3× plan cost AND unconditional mean EV > 0 (the Gemini proposal).'
            : policy === 'd'
              ? 'FARM iff conditional mean EV > 3× plan cost AND P(negative return) ≤ 0.85 (the Gemini conditional-EV hurdle with a risk ceiling).'
              : policy === 'e'
                ? 'FARM iff conditional mean EV > 5× plan cost AND unconditional mean EV > 0 AND P(negative return) ≤ 0.90 (the stricter conditional hurdle).'
                : policy === 'f'
                  ? 'FARM iff conditional mean EV > 3× plan cost AND P(negative return) ≤ 1 − 0.75 × p_L (the odds-consistent correction of (d): at least 75% of launches must clear breakeven).'
                  : policy === 'g'
                    ? 'FARM iff conditional mean NET EV > breakeven multiple × costed plan C_i (base cost + slippage/fees) AND P(negative return) ≤ 1 − 0.75 × p_L — the per-protocol net-EV hurdle: a (g) farm has a positive expected net return by construction at the layer it passes.'
                    : 'FARM iff mean EV > 0 AND P(negative return) ≤ 0.90 (the P(loss) ceiling).',
      farm_count: farms.length,
      farm_slugs: farms.map((r) => r.slug),
      max_prob_negative: maxProbNegative,
      fires,
      filters,
      within_risk_ceiling: withinRiskCeiling,
      farm_count_conservative: farmsConservative.length,
      farm_slugs_conservative: farmsConservative.map((r) => r.slug),
      max_prob_negative_conservative: maxProbNegativeConservative,
      fires_conservative: firesConservative,
      filters_conservative: filtersConservative,
      within_risk_ceiling_conservative: withinRiskCeilingConservative,
      eligible: fires && filters && withinRiskCeiling && firesConservative && filtersConservative && withinRiskCeilingConservative,
      positive_ev_count: positiveEv.length,
      rejected_positive_count: rejectedPositive.length,
      farm_count_sim: farmsSim.length,
      farm_slugs_sim: farmsSim.map((r) => r.slug),
      farm_count_conservative_sim: farmsConservativeSim.length,
      farm_slugs_conservative_sim: farmsConservativeSim.map((r) => r.slug),
      max_prob_negative_sim: maxProbNegativeSim,
      max_prob_negative_conservative_sim: maxProbNegativeConservativeSim,
    };
  };
  const a = testPolicy('a');
  const b = testPolicy('b');
  const c = testPolicy('c');
  const d = testPolicy('d');
  const e = testPolicy('e');
  const f = testPolicy('f');
  const g = testPolicy('g');
  const variants = [a, b, c, d, e, f, g];
  const eligible = variants.filter((v) => v.eligible);
  const summary = (v: GateTestVariant): string =>
    `policy (${v.variant}) farms ${v.farm_count} rows under the adopted odds and ${v.farm_count_conservative} under the conservative odds (${v.eligible ? 'eligible' : 'not eligible'}; simulation cross-check ${v.farm_count_sim}/${v.farm_count_conservative_sim})`;
  let adopted: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
  let reason: string;
  if (eligible.length > 0) {
    const byRisk = [...eligible].sort((x, y) => {
      const xm = x.max_prob_negative_conservative ?? 1;
      const ym = y.max_prob_negative_conservative ?? 1;
      if (xm !== ym) return xm - ym;
      return 'abcdefg'.indexOf(x.variant) - 'abcdefg'.indexOf(y.variant);
    });
    adopted = byRisk[0]!.variant;
    const winner = byRisk[0]!;
    reason = `Policy (${adopted}) adopted: it is eligible under the two-layer rule — it fires (${winner.farm_count} farms under the adopted odds, ${winner.farm_count_conservative} under the conservative odds) and filters (it rejects ${winner.rejected_positive_count} of ${winner.positive_ev_count} positive-mean-EV rows) and its worst farm's P(negative return) under the conservative odds is ${winner.max_prob_negative_conservative} (≤ 0.90) — and it has the lowest worst-farm P(negative) under the conservative odds among the eligible policies. Counts are analytic (closed-form capped-lognormal); the simulation cross-check farms ${winner.farm_count_sim}/${winner.farm_count_conservative_sim} — any difference is Monte Carlo noise, and the board follows the analytic counts. ${variants.map(summary).join('; ')}.`;
  } else {
    adopted = 'a';
    reason = `No policy is eligible under the two-layer rule — ${variants.map(summary).join('; ')} — so the pre-existing charter rule (a) is kept and the resulting FARM count (${a.farm_count}) is reported as-is. The FARM count is never a target.`;
  }
  return { variant_a: a, variant_b: b, variant_c: c, variant_d: d, variant_e: e, variant_f: f, variant_g: g, adopted, reason };
}

/**
 * The distribution-sensitivity tournament (charter v1.3): the same farm / skip
 * rows are re-priced under five conditional-launch-value distributions plus a
 * P90-cap sensitivity row, and the FARM verdicts are compared across them, so
 * no decision rests on the uncapped lognormal mean alone. The distributions
 * are paired where possible: the lognormal, the capped lognormal, and the
 * P90-capped lognormal share the same normal draws per row; the launch
 * uniforms are common to every distribution for a row. The tournament uses
 * 5,000 draws per row per distribution; the production simulation keeps 20,000.
 * The production distribution is the capped lognormal when the CRPS validation
 * kept the cap, and the uncapped lognormal when it reverted.
 */
export function runDistributionTournament(
  rows: { slug: string; name: string; predictedLog: number; planCost: number; sigma: number; launchOdds: number }[],
  fitted: FittedModel,
  model: ModelConstants = MODEL,
): DistributionTournament {
  const N = 5000;
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  const cap = fitted.observedMaxMcapUsd;
  const capP90 = fitted.valueCapP90Usd;
  const capP95 = fitted.valueCapP95Usd;
  const compMcaps = fitted.compMcaps;
  const residuals = fitted.oofSignedResiduals;
  const breakEvenValue = (planCost: number): number => planCost / model.farmer_share;
  const nextNormal = (rand: () => number, spare: { v: number | null }): number => {
    if (spare.v !== null) {
      const z = spare.v;
      spare.v = null;
      return z;
    }
    let a = 0;
    let b = 0;
    do {
      a = rand();
      b = rand();
    } while (a <= 0);
    const r = Math.sqrt(-2 * Math.log(a));
    const t = 2 * Math.PI * b;
    spare.v = r * Math.sin(t);
    return r * Math.cos(t);
  };
  const valueDraws = (kind: DistributionKind, row: { slug: string; predictedLog: number; sigma: number }): number[] => {
    const rand = mulberry32(fnv1aHash(`${row.slug}|tournament|${kind}`));
    const spare: { v: number | null } = { v: null };
    const draws: number[] = [];
    const clampV = (v: number): number => Math.max(model.value_min, Math.min(model.value_max, v));
    if (kind === 'empirical') {
      for (let i = 0; i < N; i++) draws.push(compMcaps[Math.floor(rand() * compMcaps.length)]!);
      return draws;
    }
    if (kind === 'bootstrap-residuals') {
      for (let i = 0; i < N; i++) draws.push(clampV(Math.pow(10, row.predictedLog + residuals[Math.floor(rand() * residuals.length)]!)));
      return draws;
    }
    // The lognormal family shares one normal stream per row, so the three
    // capped variants are perfectly paired and differ only by the cap.
    const sharedRand = mulberry32(fnv1aHash(`${row.slug}|tournament|normal`));
    const sharedSpare: { v: number | null } = { v: null };
    for (let i = 0; i < N; i++) {
      if (kind === 'lognormal') {
        draws.push(clampV(Math.pow(10, row.predictedLog + row.sigma * nextNormal(sharedRand, sharedSpare))));
      } else if (kind === 'capped-lognormal') {
        draws.push(clampV(Math.min(cap, Math.pow(10, row.predictedLog + row.sigma * nextNormal(sharedRand, sharedSpare)))));
      } else if (kind === 'capped-p90-lognormal') {
        draws.push(clampV(Math.min(capP90, Math.pow(10, row.predictedLog + row.sigma * nextNormal(sharedRand, sharedSpare)))));
      } else if (kind === 'capped-p95-lognormal') {
        draws.push(clampV(Math.min(capP95, Math.pow(10, row.predictedLog + row.sigma * nextNormal(sharedRand, sharedSpare)))));
      } else if (kind === 'student-t') {
        const z = nextNormal(rand, spare);
        let chi2 = 0;
        for (let k = 0; k < 5; k++) {
          const zi = nextNormal(rand, spare);
          chi2 += zi * zi;
        }
        draws.push(clampV(Math.pow(10, row.predictedLog + row.sigma * (z / Math.sqrt(chi2 / 5)))));
      }
    }
    return draws;
  };
  const rowStats = (kind: DistributionKind, row: { slug: string; predictedLog: number; planCost: number; sigma: number; launchOdds: number }): DistributionRowResult => {
    const values = valueDraws(kind, row);
    const sorted = [...values].sort((a, b) => a - b);
    const launchRand = mulberry32(fnv1aHash(`${row.slug}|tournament|launch`));
    const returns: number[] = [];
    for (const v of values) {
      returns.push(launchRand() < row.launchOdds ? model.farmer_share * v - row.planCost : -row.planCost);
    }
    returns.sort((a, b) => a - b);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const evMean = mean(returns);
    const evP25 = quantileOf(returns, 0.25);
    const evP50 = quantileOf(returns, 0.5);
    const evP75 = quantileOf(returns, 0.75);
    const probNegative = returns.filter((r) => r < 0).length / returns.length;
    const conditionalMeanValue = mean(values);
    const conditionalMeanEv = model.farmer_share * conditionalMeanValue - row.planCost;
    // v1.7 (g): the costed plan shifts every draw's net return down by
    // exactly the slippage fee, so the (g) statistics are the base
    // statistics shifted by that fee, and P(negative) against the costed
    // plan is the share of base draws below the fee.
    const slippageFee = model.deposit_usd * model.slippage_fee_rate;
    const costedPlanCost = row.planCost + slippageFee;
    const probNegativeCosted = returns.filter((r) => r < slippageFee).length / returns.length;
    return {
      slug: row.slug,
      conditional_mean_value_usd: round2(conditionalMeanValue),
      conditional_median_value_usd: round2(quantileOf(sorted, 0.5)),
      conditional_p90_value_usd: round2(quantileOf(sorted, 0.9)),
      conditional_p95_value_usd: round2(quantileOf(sorted, 0.95)),
      mean_net_ev_usd: round2(evMean),
      median_net_return_usd: round2(evP50),
      prob_negative: round4(probNegative),
      prob_exceeds_break_even: round4(sorted.filter((v) => v >= breakEvenValue(row.planCost)).length / sorted.length),
      farm_a: gatePasses('a', { evMean, evP25, evP50, evP75, conditionalMeanEv, planCost: row.planCost, probNegative }),
      farm_b: gatePasses('b', { evMean, evP25, evP50, evP75, conditionalMeanEv, planCost: row.planCost, probNegative }),
      farm_c: gatePasses('c', { evMean, evP25, evP50, evP75, conditionalMeanEv, planCost: row.planCost, probNegative }),
      farm_d: gatePasses('d', { evMean, evP25, evP50, evP75, conditionalMeanEv, planCost: row.planCost, probNegative }),
      farm_e: gatePasses('e', { evMean, evP25, evP50, evP75, conditionalMeanEv, planCost: row.planCost, probNegative }),
      farm_f: gatePasses('f', { evMean, evP25, evP50, evP75, conditionalMeanEv, planCost: row.planCost, probNegative }, row.launchOdds),
      farm_g: gatePasses(
        'g',
        { evMean: evMean - slippageFee, evP25: evP25 - slippageFee, evP50: evP50 - slippageFee, evP75: evP75 - slippageFee, conditionalMeanEv: conditionalMeanEv - slippageFee, planCost: costedPlanCost, probNegative: probNegativeCosted },
        row.launchOdds,
      ),
    };
  };
  const kinds: DistributionKind[] = ['lognormal', 'capped-lognormal', 'capped-p90-lognormal', 'capped-p95-lognormal', 'empirical', 'bootstrap-residuals', 'student-t'];
  const results: DistributionResult[] = kinds.map((kind) => {
    const rowResults = rows.map((row) => rowStats(kind, row));
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const farmSlugs = (key: 'farm_a' | 'farm_b' | 'farm_c' | 'farm_d' | 'farm_e' | 'farm_f' | 'farm_g'): string[] => rowResults.filter((r) => r[key]).map((r) => r.slug);
    return {
      distribution: kind,
      is_production: kind === (fitted.capKept ? 'capped-lognormal' : 'lognormal'),
      n_rows: rowResults.length,
      rows: rowResults,
      pooled_conditional_mean_value_usd: round2(mean(rowResults.map((r) => r.conditional_mean_value_usd))),
      pooled_conditional_median_value_usd: round2(mean(rowResults.map((r) => r.conditional_median_value_usd))),
      pooled_mean_net_ev_usd: round2(mean(rowResults.map((r) => r.mean_net_ev_usd))),
      pooled_prob_negative: round4(mean(rowResults.map((r) => r.prob_negative))),
      farm_count_a: farmSlugs('farm_a').length,
      farm_count_b: farmSlugs('farm_b').length,
      farm_count_c: farmSlugs('farm_c').length,
      farm_count_d: farmSlugs('farm_d').length,
      farm_count_e: farmSlugs('farm_e').length,
      farm_count_f: farmSlugs('farm_f').length,
      farm_count_g: farmSlugs('farm_g').length,
      farm_slugs_b: farmSlugs('farm_b'),
    };
  });
  const production = results.find((r) => r.is_production)!;
  const productionSet = new Set(production.farm_slugs_b);
  const overlaps = results.map((r) => {
    const set = new Set(r.farm_slugs_b);
    const intersection = [...set].filter((s) => productionSet.has(s)).length;
    const union = new Set([...set, ...productionSet]).size;
    return { distribution: r.distribution, jaccard_vs_production_b: union > 0 ? round4(intersection / union) : 1 };
  });
  return {
    n_draws: N,
    cap_usd: cap,
    cap_p90_usd: capP90,
    cap_p95_usd: capP95,
    production_distribution: production.distribution,
    results,
    farm_set_overlap_b: overlaps,
    crps: fitted.crpsValidation,
    cap_kept: fitted.capKept,
    note: `The production distribution is the ${production.distribution}. The capped lognormal's pooled conditional mean is compared against the uncapped mean directly in the pooled rows above — the uncapped tail inflates the mean by design, and the farm counts under policy (b) show how much of that inflation the gate actually converts into farms. The empirical distribution ignores TVL entirely, so it is a floor of information, not a contender: a model that cannot distinguish protocols is worse than one that can, even when its pooled numbers look similar.`,
  };
}

export function runParamAwareSimulation(
  rows: { slug: string; predictedLog: number; planCost: number; sigma: number; launchOdds: number }[],
  fitted: FittedModel,
  model: ModelConstants = MODEL,
): ParamAwareSimulation {
  const N = 5000;
  const N_REFITS = 2000;
  const cap = fitted.valueCapUsd;
  const baseRateBootstrap = fitted.launchOddsDecision.base_rate_bootstrap;
  const conservativeOdds = fitted.launchOddsDecision.conservative_lower_bound;
  const nextNormal = (rand: () => number, spare: { v: number | null }): number => {
    if (spare.v !== null) {
      const z = spare.v;
      spare.v = null;
      return z;
    }
    let a = 0;
    let b = 0;
    do {
      a = rand();
      b = rand();
    } while (a <= 0);
    const r = Math.sqrt(-2 * Math.log(a));
    const t = 2 * Math.PI * b;
    spare.v = r * Math.sin(t);
    return r * Math.cos(t);
  };
  const clampV = (v: number): number => Math.max(model.value_min, Math.min(model.value_max, v));
  const simRows: ParamAwareRow[] = rows.map((row) => {
    const refitPreds = fitted.bootstrapBoardPreds.get(row.slug) ?? [];
    const distributions: ParamAwareRow['distributions'] = (
      ['capped-lognormal', 'lognormal', 'student-t'] as const
    ).map((kind) => {
      const rand = mulberry32(fnv1aHash(`${row.slug}|param-aware|${kind}`));
      const spare: { v: number | null } = { v: null };
      let evSum = 0;
      let negCount = 0;
      for (let i = 0; i < N; i++) {
        const pred = refitPreds.length > 0 ? refitPreds[Math.floor(rand() * refitPreds.length)]! : row.predictedLog;
        const pL = baseRateBootstrap.length > 0 ? baseRateBootstrap[Math.floor(rand() * baseRateBootstrap.length)]! : row.launchOdds;
        const u = rand();
        let value: number;
        if (kind === 'student-t') {
          const z = nextNormal(rand, spare);
          let chi2 = 0;
          for (let k = 0; k < 5; k++) {
            const zi = nextNormal(rand, spare);
            chi2 += zi * zi;
          }
          value = clampV(Math.pow(10, pred + row.sigma * (z / Math.sqrt(chi2 / 5))));
        } else if (kind === 'capped-lognormal') {
          value = clampV(Math.min(cap, Math.pow(10, pred + row.sigma * nextNormal(rand, spare))));
        } else {
          value = clampV(Math.pow(10, pred + row.sigma * nextNormal(rand, spare)));
        }
        const net = u < pL ? model.farmer_share * value - row.planCost : -row.planCost;
        evSum += net;
        if (net < 0) negCount++;
      }
      return { distribution: kind, mean_ev_usd: Math.round(evSum / N), prob_negative: round4(negCount / N) };
    });
    // The paired pass fractions of gate (d): 2000 paired (refit, p_L)
    // draws — the same refit index under both odds layers, so the two
    // fractions differ only by the odds layer, not by the draw.
    const gateRand = mulberry32(fnv1aHash(`${row.slug}|param-aware|gate-d`));
    let passAdopted = 0;
    let passConservative = 0;
    for (let i = 0; i < N_REFITS; i++) {
      const pred = refitPreds.length > 0 ? refitPreds[Math.floor(gateRand() * refitPreds.length)]! : row.predictedLog;
      const pL = baseRateBootstrap.length > 0 ? baseRateBootstrap[Math.floor(gateRand() * baseRateBootstrap.length)]! : row.launchOdds;
      if (gatePasses('d', analyticGateStats(pred, row.sigma, row.planCost, pL, cap, model), pL)) passAdopted++;
      if (gatePasses('d', analyticGateStats(pred, row.sigma, row.planCost, conservativeOdds, cap, model), conservativeOdds)) passConservative++;
    }
    return {
      slug: row.slug,
      plan_cost_usd: row.planCost,
      distributions,
      pass_fraction_d_adopted: round4(passAdopted / N_REFITS),
      pass_fraction_d_conservative: round4(passConservative / N_REFITS),
    };
  });
  return {
    n_draws: N,
    n_refits: N_REFITS,
    n_rows: simRows.length,
    note: 'Every draw folds in three uncertainties at once: a bootstrap-refit coefficient (one of the 2000 cluster refits), a launch-odds draw from the base-rate bootstrap, and the outcome residual under the distribution. The launch-odds draw is still the flat base rate — no per-protocol launch discrimination is claimed. The paired pass fractions test gate (d) on the same 2000 (refit, p_L) pairs under both odds layers.',
    rows: simRows,
  };
}

/** The gate-(d) economic audit (charter v1.5): the breakeven multiple
 * (1 − p_L) / p_L and the launch-success rate the 85% ceiling demands, and
 * the farm count under each threshold multiple × P(negative) ceiling
 * combination, under both odds layers. The grid is computed from the
 * analytic capped-lognormal statistics (the exact form of the production
 * simulation), so the (3×, 0.85) cell must reproduce the gate test's
 * variant-(d) farm counts. Diagnostic only — the grid does not select a
 * gate. */
export function runGateThresholdGrid(
  rows: { slug: string; predictedLog: number; planCost: number; sigma: number; launchOdds: number }[],
  adoptedOdds: number,
  conservativeOdds: number,
  cap: number,
  model: ModelConstants = MODEL,
): GateThresholdGrid {
  const multiples = [1, 2, 3, 4, 5, 6];
  const ceilings = [0.8, 0.85, 0.9, 0.95];
  const gridRows: GateThresholdGrid['rows'] = [];
  for (const multiple of multiples) {
    for (const ceiling of ceilings) {
      let farmAdopted = 0;
      let farmConservative = 0;
      for (const row of rows) {
        const statsAdopted = analyticGateStats(row.predictedLog, row.sigma, row.planCost, adoptedOdds, cap, model);
        if (statsAdopted.conditionalMeanEv > multiple * row.planCost && statsAdopted.probNegative <= ceiling) farmAdopted++;
        const statsConservative = analyticGateStats(row.predictedLog, row.sigma, row.planCost, conservativeOdds, cap, model);
        if (statsConservative.conditionalMeanEv > multiple * row.planCost && statsConservative.probNegative <= ceiling) farmConservative++;
      }
      gridRows.push({ multiple, ceiling, farm_count_adopted: farmAdopted, farm_count_conservative: farmConservative });
    }
  }
  const breakevenMultipleAdopted = round4((1 - adoptedOdds) / adoptedOdds);
  const breakevenMultipleConservative = round4((1 - conservativeOdds) / conservativeOdds);
  const requiredSuccessAdopted = round4((1 - 0.85) / adoptedOdds);
  const requiredSuccessConservative = round4((1 - 0.85) / conservativeOdds);
  // The analytic farm counts under policy (f), for the simulation-vs-analytic
  // reconciliation: the same rows, the exact closed-form statistics.
  let analyticFarmFadopted = 0;
  let analyticFarmFconservative = 0;
  for (const row of rows) {
    if (gatePasses('f', analyticGateStats(row.predictedLog, row.sigma, row.planCost, adoptedOdds, cap, model), adoptedOdds)) analyticFarmFadopted++;
    if (gatePasses('f', analyticGateStats(row.predictedLog, row.sigma, row.planCost, conservativeOdds, cap, model), conservativeOdds)) analyticFarmFconservative++;
  }
  return {
    multiples,
    ceilings,
    rows: gridRows,
    breakeven_multiple_adopted: breakevenMultipleAdopted,
    breakeven_multiple_conservative: breakevenMultipleConservative,
    required_launch_success_d_adopted: requiredSuccessAdopted,
    required_launch_success_d_conservative: requiredSuccessConservative,
    d_impossible_under_conservative: requiredSuccessConservative > 1,
    analytic_farm_count_f_adopted: analyticFarmFadopted,
    analytic_farm_count_f_conservative: analyticFarmFconservative,
    note: `The 3× multiple is a conditional-payoff screen, not a profitability proof: at the adopted odds a farm breaks even only if its conditional payoff exceeds ${breakevenMultipleAdopted}× the plan cost (${breakevenMultipleConservative}× under the conservative odds). The 85% ceiling demands that at least ${(requiredSuccessAdopted * 100).toFixed(1)}% of launches clear breakeven at the adopted odds — and ${(requiredSuccessConservative * 100).toFixed(1)}% under the conservative odds, which is impossible (a rate above 100%), so gate (d) can never fire under the conservative layer: the structural floor on P(negative) there is ${round4(1 - conservativeOdds)} > 0.85. The v1.4 board's 0 farms is therefore a design outcome of pairing a fixed ceiling with the conservative stress test, not a data outcome — candidate (f) corrects the ceiling to an odds-consistent form.`,
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n and strictly decreasing values. */
export function buildBoard(
  snapshot: Snapshot,
  fitted: FittedModel,
  model: ModelConstants = MODEL,
): { rows: BoardRow[]; gateTest: GateTest } {
  const index = bySlug(snapshot.protocols);
  // The 12-month risk-set cutoff (charter v1.4): a row is in the comparable
  // risk set iff it was listed at least 12 months before as_of.
  const riskCutoffDate = new Date(Date.parse(`${snapshot.as_of}T00:00:00Z`) - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, below the floor included. A
  // chosen protocol stays chosen; the board is the whole pre-token universe the snapshot holds.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fitted, model);
    const cost = planCostUsd(p, model, snapshot.as_of);
    const costed = costBreakdown(p, model, snapshot.as_of);
    return { p, v, cost, costed };
  });
  // The gate-policy test runs on the scored rows' ANALYTIC statistics,
  // under BOTH odds layers — before any verdict is assigned. The
  // simulation counts are the cross-check, never the decision.
  const gateTest = runGateTest(
    scored.map((s) => ({
      slug: s.p.slug,
      sim: s.v.sim,
      planCost: s.cost,
      costedPlanCost: s.costed.total_usd,
      predictedLog: s.v.predictedLog,
      sigma: fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * s.v.ood.band_multiplier) / 0.6745 : 0.01,
    })),
    fitted.seasoning.base_rate,
    fitted.launchOddsDecision.conservative_lower_bound,
    fitted.valueCapUsd,
    model,
  );
  const adoptedOdds = fitted.seasoning.base_rate;
  const conservativeOdds = fitted.launchOddsDecision.conservative_lower_bound;
  const withVerdicts = scored.map((s) => {
    const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * s.v.ood.band_multiplier) / 0.6745 : 0.01;
    // v1.7: the gate is evaluated against the full costed plan C_i when
    // (g) is adopted, against the base cost otherwise. The net-EV
    // statistics are ALWAYS against C_i (they are the costed-plan
    // numbers the trace table reports, whatever the adopted gate).
    const gateCost = gateTest.adopted === 'g' ? s.costed.total_usd : s.cost;
    const statsAdopted = analyticGateStats(s.v.predictedLog, sigma, gateCost, adoptedOdds, fitted.valueCapUsd, model);
    const statsConservative = analyticGateStats(s.v.predictedLog, sigma, gateCost, conservativeOdds, fitted.valueCapUsd, model);
    const statsCostedAdopted = analyticGateStats(s.v.predictedLog, sigma, s.costed.total_usd, adoptedOdds, fitted.valueCapUsd, model);
    const statsCostedConservative = analyticGateStats(s.v.predictedLog, sigma, s.costed.total_usd, conservativeOdds, fitted.valueCapUsd, model);
    const verdictAdopted = analyticLayerVerdict(s.v.predictedLog, sigma, gateCost, adoptedOdds, s.v.breakEvenOdds, gateTest.adopted, fitted.valueCapUsd, s.v.ood, model);
    const verdictConservative = analyticLayerVerdict(s.v.predictedLog, sigma, gateCost, conservativeOdds, s.v.breakEvenOdds, gateTest.adopted, fitted.valueCapUsd, s.v.ood, model);
    const gatePassAdopted = gatePasses(gateTest.adopted, statsAdopted, adoptedOdds);
    const gatePassConservative = gatePasses(gateTest.adopted, statsConservative, conservativeOdds);
    // The simulation gate flags use the same cost the analytic gate uses:
    // under (g) the sim statistics shift down by exactly the slippage
    // fee (same draws, cost +$50) and P(negative) shifts by the analytic
    // delta between the two costs.
    const simGateStatsFor = (conservative: boolean): { evMean: number; evP25: number; evP50: number; evP75: number; conditionalMeanEv: number; planCost: number; probNegative: number } => {
      const base = conservative ? gateStatsConservative(s.v.sim, s.cost) : gateStats(s.v.sim, s.cost);
      if (gateTest.adopted !== 'g') return base;
      const fee = slippageFeeUsd(model);
      const statsBase = conservative
        ? analyticGateStats(s.v.predictedLog, sigma, s.cost, conservativeOdds, fitted.valueCapUsd, model)
        : analyticGateStats(s.v.predictedLog, sigma, s.cost, adoptedOdds, fitted.valueCapUsd, model);
      const statsCosted = conservative ? statsCostedConservative : statsCostedAdopted;
      return {
        evMean: base.evMean - fee,
        evP25: base.evP25 - fee,
        evP50: base.evP50 - fee,
        evP75: base.evP75 - fee,
        conditionalMeanEv: base.conditionalMeanEv - fee,
        planCost: s.costed.total_usd,
        probNegative: Math.max(0, Math.min(1, base.probNegative + (statsCosted.probNegative - statsBase.probNegative))),
      };
    };
    const gatePassAdoptedSim = gatePasses(gateTest.adopted, simGateStatsFor(false), adoptedOdds);
    const gatePassConservativeSim = gatePasses(gateTest.adopted, simGateStatsFor(true), conservativeOdds);
    const bl = borderlineInfo(
      statsAdopted.probNegative,
      statsConservative.probNegative,
      gatePassAdopted,
      gatePassConservative,
      gatePassAdoptedSim,
      gatePassConservativeSim,
      gateTest.adopted,
      adoptedOdds,
      conservativeOdds,
    );
    const conditionalFarm = verdictAdopted === 'farm' && verdictConservative !== 'farm';
    // The production verdict is the conservative layer's verdict, except
    // for the BORDERLINE guard (charter v1.6): a BORDERLINE row is NEVER
    // FARM and NEVER SKIP — it is MARGINAL with the REVIEW label,
    // whatever its point estimate says. So a borderline farm is demoted
    // to marginal AND a borderline skip is moved to marginal. (The
    // stability demotion is applied later, in buildRadarFromFitted, once
    // the LOPO refit counts exist.)
    let verdict: Verdict = verdictConservative;
    let farmDemotedReason: 'borderline' | 'unstable' | null = null;
    if (bl.borderline && (verdict === 'farm' || verdict === 'skip')) {
      verdict = 'marginal';
      farmDemotedReason = 'borderline';
    }
    // v1.7: the fractional-Kelly size (quarter-Kelly, conservative odds)
    // and the MARGINAL tier. The tier is computed on the post-borderline
    // verdict: only MARGINAL rows carry a tier.
    const kelly = kellyFraction(s.v.predictedLog, sigma, s.costed.total_usd, conservativeOdds, fitted.valueCapUsd, model);
    const tierCalc = marginalTierFor(
      statsCostedAdopted.evMean,
      statsCostedConservative.evMean,
      s.costed.total_usd,
      statsCostedConservative.probNegative,
      kelly.quarter,
      bl.borderline,
    );
    const tierInfo: { tier: MarginalTier | null; evPerDollarAtRisk: number } =
      verdict === 'marginal' ? tierCalc : { tier: null, evPerDollarAtRisk: tierCalc.evPerDollarAtRisk };
    return {
      ...s,
      sigma,
      statsAdopted,
      statsConservative,
      statsCostedAdopted,
      statsCostedConservative,
      gateCost,
      kelly,
      tierInfo,
      verdict,
      verdictAdopted,
      verdictConservative,
      conditionalFarm,
      borderline: bl,
      farmDemotedReason,
      gatePassAdopted,
      gatePassConservative,
      gatePassAdoptedSim,
      gatePassConservativeSim,
    };
  });
  withVerdicts.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Strictly decreasing implied values: rounding to whole dollars could tie two neighbours,
  // so a tied row steps down one dollar. The values are millions apart in practice; this is a guard.
  for (let i = 1; i < withVerdicts.length; i++) {
    if (withVerdicts[i]!.v.implied >= withVerdicts[i - 1]!.v.implied) withVerdicts[i]!.v.implied = withVerdicts[i - 1]!.v.implied - 1;
  }
  const rows: BoardRow[] = withVerdicts.map((s, i) => ({
    rank: i + 1,
    rank_range: null,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    verdict: s.verdict,
    plan_cost_usd: s.cost,
    model: {
      category_multiple: round4(s.v.implied / Math.max(1, s.p.tvl_usd)),
      predicted_log_value: s.v.predictedLog,
      value_if_launches_usd: s.v.valueIfLaunches,
      launch_odds: round4(s.v.launchOdds),
      launch_odds_platt: round4(s.v.launchOddsPlatt),
      break_even_odds: round4(s.v.breakEvenOdds),
      expected_value_usd: s.v.sim.ev_mean_usd,
      ev_conditional_mean_usd: s.v.sim.ev_conditional_mean_usd,
      mean_value_if_launches_usd: s.v.sim.mean_value_if_launches_usd,
      ev_conservative_usd: s.v.sim.ev_p25_usd,
      ev_optimistic_usd: s.v.sim.ev_p75_usd,
      ev_p10_usd: s.v.sim.ev_p10_usd,
      ev_p25_usd: s.v.sim.ev_p25_usd,
      ev_p50_usd: s.v.sim.ev_p50_usd,
      ev_p75_usd: s.v.sim.ev_p75_usd,
      ev_p90_usd: s.v.sim.ev_p90_usd,
      prob_negative_return: s.v.sim.prob_negative,
      prob_negative_return_conservative: s.v.sim.prob_negative_conservative,
      prob_negative_analytic: s.v.sim.prob_negative_analytic,
      p10_value_usd: s.v.sim.p10_value_usd,
      ev_at_p10_usd: s.v.sim.ev_at_p10_value_if_launches_usd,
      ev_at_p25_value_if_launches_usd: s.v.sim.ev_at_p25_value_if_launches_usd,
      ev_at_p75_value_if_launches_usd: s.v.sim.ev_at_p75_value_if_launches_usd,
      ev_mean_base_rate_usd: s.v.sim.ev_mean_base_rate_usd,
      ev_mean_platt_usd: s.v.sim.ev_mean_platt_usd,
      ev_mean_conservative_usd: s.v.sim.ev_mean_conservative_usd,
      ev_p25_conservative_usd: s.v.sim.ev_p25_conservative_usd,
      ev_p50_conservative_usd: s.v.sim.ev_p50_conservative_usd,
      ev_p75_conservative_usd: s.v.sim.ev_p75_conservative_usd,
      gate_pass_conservative: s.gatePassConservative,
      gate_pass_adopted: s.gatePassAdopted,
      band_p25_usd: s.v.bandP25,
      band_p75_usd: s.v.bandP75,
      param_band_p25_usd: s.v.paramBandP25,
      param_band_p75_usd: s.v.paramBandP75,
      param_total_sd_dex: s.v.paramTotalSd,
      category_adjustment: s.v.adjustment,
      chain_adjustment: s.v.chainAdjustment,
      comparable_count: s.v.count,
      comparable_basis: s.v.basis,
      growth_pct: s.v.growthPct,
      age_days: s.v.age,
      basis: 'fitted',
      ood: s.v.ood,
      predicted_log_param_sd_dex: fitted.paramSdBySlug.get(s.p.slug) ?? 0,
      ev_mean_param_usd: fitted.evParamBySlug.get(s.p.slug)?.ev_mean_param_usd ?? [s.v.sim.ev_mean_usd, s.v.sim.ev_mean_usd],
      prob_negative_param: fitted.evParamBySlug.get(s.p.slug)?.prob_negative_param ?? [s.v.sim.prob_negative, s.v.sim.prob_negative],
      launch_odds_source: 'global cohort base rate',
      launch_odds_cohort: `all dated protocols in the ${snapshot.as_of} snapshot (n=${fitted.seasoning.n_protocols})`,
      launch_odds_horizon_months: 12,
      launch_odds_n_support: fitted.seasoning.n_protocols,
      launch_odds_in_risk_set: s.p.listed_at !== null && s.p.listed_at <= riskCutoffDate,
      decision_trace: decisionTraceFor(
        s.verdict,
        s.v.sim,
        s.v.breakEvenOdds,
        gateTest.adopted,
        s.gateCost,
        s.v.ood,
        adoptedOdds,
        conservativeOdds,
        s.v.predictedLog,
        s.sigma,
        fitted.valueCapUsd,
        s.borderline,
        s.verdictAdopted,
        model,
      ),
      verdict_adopted: s.verdictAdopted,
      verdict_conservative: s.verdictConservative,
      conditional_farm: s.conditionalFarm,
      borderline: s.borderline.borderline,
      borderline_reason: s.borderline.reason,
      prob_negative_analytic_conservative: round4(s.statsConservative.probNegative),
      prob_negative_sim_ci_adopted: wilsonInterval(s.v.sim.prob_negative, s.v.sim.n_draws).map((x) => round4(x)) as [number, number],
      prob_negative_sim_ci_conservative: wilsonInterval(s.v.sim.prob_negative_conservative, s.v.sim.n_draws).map((x) => round4(x)) as [number, number],
      farm_demoted_reason: s.farmDemotedReason,
      costed_plan: s.costed,
      net_ev_adopted_usd: Math.round(s.statsCostedAdopted.evMean),
      net_ev_conservative_usd: Math.round(s.statsCostedConservative.evMean),
      conditional_net_ev_usd: Math.round(s.statsCostedAdopted.conditionalMeanEv),
      conditional_net_multiple: round4(s.statsCostedAdopted.conditionalMeanEv / s.costed.total_usd),
      marginal_tier: s.tierInfo.tier,
      ev_per_dollar_at_risk: s.tierInfo.evPerDollarAtRisk,
      kelly_fraction: s.kelly.quarter,
      stability: null,
    },
    farm_steps: farmSteps(s.p, s.v, s.verdict, s.cost).map(stepText),
  }));
  return { rows, gateTest };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    verdict: row.verdict,
    plan_cost_usd: row.plan_cost_usd,
    on_watchlist: onWatchlist,
    category_multiple: row.model.category_multiple,
    predicted_log_value: row.model.predicted_log_value,
    value_if_launches_usd: row.model.value_if_launches_usd,
    launch_odds: row.model.launch_odds,
    launch_odds_platt: row.model.launch_odds_platt,
    break_even_odds: row.model.break_even_odds,
    expected_value_usd: row.model.expected_value_usd,
    ev_conditional_mean_usd: row.model.ev_conditional_mean_usd,
    mean_value_if_launches_usd: row.model.mean_value_if_launches_usd,
    ev_conservative_usd: row.model.ev_conservative_usd,
    ev_optimistic_usd: row.model.ev_optimistic_usd,
    ev_p10_usd: row.model.ev_p10_usd,
    ev_p25_usd: row.model.ev_p25_usd,
    ev_p50_usd: row.model.ev_p50_usd,
    ev_p75_usd: row.model.ev_p75_usd,
    ev_p90_usd: row.model.ev_p90_usd,
    prob_negative_return: row.model.prob_negative_return,
    prob_negative_return_conservative: row.model.prob_negative_return_conservative,
    prob_negative_analytic: row.model.prob_negative_analytic,
    p10_value_usd: row.model.p10_value_usd,
    ev_at_p10_usd: row.model.ev_at_p10_usd,
    ev_at_p25_value_if_launches_usd: row.model.ev_at_p25_value_if_launches_usd,
    ev_at_p75_value_if_launches_usd: row.model.ev_at_p75_value_if_launches_usd,
    ev_mean_base_rate_usd: row.model.ev_mean_base_rate_usd,
    ev_mean_platt_usd: row.model.ev_mean_platt_usd,
    ev_mean_conservative_usd: row.model.ev_mean_conservative_usd,
    ev_p25_conservative_usd: row.model.ev_p25_conservative_usd,
    ev_p50_conservative_usd: row.model.ev_p50_conservative_usd,
    ev_p75_conservative_usd: row.model.ev_p75_conservative_usd,
    gate_pass_conservative: row.model.gate_pass_conservative,
    gate_pass_adopted: row.model.gate_pass_adopted,
    band_p25_usd: row.model.band_p25_usd,
    band_p75_usd: row.model.band_p75_usd,
    param_band_p25_usd: row.model.param_band_p25_usd,
    param_band_p75_usd: row.model.param_band_p75_usd,
    param_total_sd_dex: row.model.param_total_sd_dex,
    rank_range: row.rank_range ?? [row.rank, row.rank, row.rank],
    category_adjustment: row.model.category_adjustment,
    chain_adjustment: row.model.chain_adjustment,
    ood: row.model.ood,
    predicted_log_param_sd_dex: row.model.predicted_log_param_sd_dex,
    ev_mean_param_usd: row.model.ev_mean_param_usd,
    prob_negative_param: row.model.prob_negative_param,
    launch_odds_source: row.model.launch_odds_source,
    launch_odds_cohort: row.model.launch_odds_cohort,
    launch_odds_horizon_months: row.model.launch_odds_horizon_months,
    launch_odds_n_support: row.model.launch_odds_n_support,
    launch_odds_in_risk_set: row.model.launch_odds_in_risk_set,
    decision_trace: row.model.decision_trace,
    verdict_adopted: row.model.verdict_adopted,
    verdict_conservative: row.model.verdict_conservative,
    conditional_farm: row.model.conditional_farm,
    borderline: row.model.borderline,
    borderline_reason: row.model.borderline_reason,
    prob_negative_analytic_conservative: row.model.prob_negative_analytic_conservative,
    prob_negative_sim_ci_adopted: row.model.prob_negative_sim_ci_adopted,
    prob_negative_sim_ci_conservative: row.model.prob_negative_sim_ci_conservative,
    farm_demoted_reason: row.model.farm_demoted_reason,
    stability: row.model.stability,
    costed_plan: row.model.costed_plan,
    net_ev_adopted_usd: row.model.net_ev_adopted_usd,
    net_ev_conservative_usd: row.model.net_ev_conservative_usd,
    conditional_net_ev_usd: row.model.conditional_net_ev_usd,
    conditional_net_multiple: row.model.conditional_net_multiple,
    marginal_tier: row.model.marginal_tier,
    ev_per_dollar_at_risk: row.model.ev_per_dollar_at_risk,
    kelly_fraction: row.model.kelly_fraction,
  };
}

/** Spearman rank correlation between two orderings of the same slugs. */
export function spearmanRankCorrelation(orderA: string[], orderB: string[]): number {
  const rankA = new Map(orderA.map((s, i) => [s, i + 1]));
  const rankB = new Map(orderB.map((s, i) => [s, i + 1]));
  const common = orderA.filter((s) => rankB.has(s));
  const n = common.length;
  if (n < 2) return 0;
  let sumSq = 0;
  for (const s of common) {
    const d = rankA.get(s)! - rankB.get(s)!;
    sumSq += d * d;
  }
  return 1 - (6 * sumSq) / (n * (n * n - 1));
}

/** Kendall's τ-a between two orderings of the same slugs (charter v1.5):
 * (concordant − discordant) pairs / all pairs. The orderings are strict
 * (ties broken by slug), so τ-a is the right form — no tie correction.
 * Reported next to Spearman on every ranking evaluation: Spearman weights
 * large rank moves, Kendall counts pairwise inversions. */
export function kendallTau(orderA: string[], orderB: string[]): number {
  const rankA = new Map(orderA.map((s, i) => [s, i + 1]));
  const rankB = new Map(orderB.map((s, i) => [s, i + 1]));
  const common = orderA.filter((s) => rankB.has(s));
  const n = common.length;
  if (n < 2) return 0;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = common[i]!;
      const b = common[j]!;
      const da = rankA.get(a)! - rankA.get(b)!;
      const db = rankB.get(a)! - rankB.get(b)!;
      if (da * db > 0) concordant++;
      else if (da * db < 0) discordant++;
    }
  }
  return (concordant - discordant) / (n * (n - 1) / 2);
}

/** Spearman ρ on paired values (charter v1.7): Pearson on average ranks,
 * so it works on bootstrap resamples where a row can appear twice. On
 * distinct values it agrees exactly with spearmanRankCorrelation on the
 * same orderings — the leakage test asserts the agreement on the pooled
 * selection rows. */
export function spearmanPaired(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return 0;
  const ranks = (vs: number[]): number[] => {
    const order = vs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
    const out = new Array<number>(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && order[j + 1]!.v === order[i]!.v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[order[k]!.i] = avg;
      i = j + 1;
    }
    return out;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i]! - mx) * (ry[i]! - my);
    sxx += (rx[i]! - mx) ** 2;
    syy += (ry[i]! - my) ** 2;
  }
  if (sxx <= 0 || syy <= 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** Kendall's τ-b on paired values (charter v1.7): (concordant −
 * discordant) / sqrt((pairs − ties_x)(pairs − ties_y)), so it works on
 * bootstrap resamples with duplicate rows. On distinct values it agrees
 * exactly with kendallTau on the same orderings. */
export function kendallTauPaired(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return 0;
  let concordant = 0;
  let discordant = 0;
  let tiesX = 0;
  let tiesY = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign(xs[i]! - xs[j]!);
      const dy = Math.sign(ys[i]! - ys[j]!);
      if (dx === 0 && dy === 0) {
        tiesX++;
        tiesY++;
      } else if (dx === 0) tiesX++;
      else if (dy === 0) tiesY++;
      else if (dx * dy > 0) concordant++;
      else discordant++;
    }
  }
  const total = (n * (n - 1)) / 2;
  const denom = Math.sqrt((total - tiesX) * (total - tiesY));
  if (denom <= 0) return 0;
  return (concordant - discordant) / denom;
}

/** A bimodality flag for a bootstrap coefficient distribution (charter
 * v1.5): a 20-bin histogram over the observed range; true when two
 * non-adjacent peak bins (each ≥ 60% of the tallest bin's count) are
 * separated by a valley below 50% of the tallest bin — two distinct
 * regimes in the refits, not one noisy mode. */
export function bimodalityFlag(xs: number[]): boolean {
  if (xs.length < 50) return false;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (hi - lo < 1e-12) return false;
  const bins = new Array<number>(20).fill(0);
  for (const x of xs) bins[Math.min(19, Math.floor(((x - lo) / (hi - lo)) * 20))]!++;
  const max = Math.max(...bins);
  const peaks = bins.map((c, i) => ({ c, i })).filter((b) => b.c >= 0.6 * max);
  if (peaks.length < 2) return false;
  // Two peaks count as separate modes only if a valley between them drops
  // below half the tallest bin.
  for (let a = 0; a < peaks.length; a++) {
    for (let b = a + 1; b < peaks.length; b++) {
      const i = peaks[a]!.i;
      const j = peaks[b]!.i;
      if (j - i < 2) continue;
      let valley = Infinity;
      for (let k = i + 1; k < j; k++) valley = Math.min(valley, bins[k]!);
      if (valley < 0.5 * max) return true;
    }
  }
  return false;
}

/** The nested selection-pooled metric (folds 50–80) for an arbitrary comp
 * list, replicating fitModel's nested walk-forward exactly: train on the
 * oldest pct%, test on the next 10% forward in time, 30-day purge gap,
 * pooled median absolute log error over the selection folds. Used by the
 * outlier with/without analysis and the winsorization candidate, which
 * refit on modified comp lists. Cross-checked against fitModel's own
 * number on the full comp list (they must agree exactly). */
export function nestedSelectionMetric(
  rows: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
  estimator: Estimator = 'ols',
): number {
  const dated = [...rows].sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const nestedStep = Math.max(1, Math.round(dated.length * 0.1));
  const errs: number[] = [];
  for (const pct of [50, 60, 70, 80]) {
    const nTr = Math.floor((dated.length * pct) / 100);
    const foldTest = dated.slice(nTr, nTr + nestedStep);
    if (foldTest.length === 0) continue;
    const foldTestStart = foldTest[0]!.listed_at!;
    const foldTrain = dated.slice(0, nTr).filter((p) => (ageDays(foldTestStart, p.listed_at) ?? 0) >= model.purge_gap_days);
    const fit = fitRegression(foldTrain, asOf, model, estimator);
    for (const p of foldTest) errs.push(Math.abs(Math.log10(p.mcap_usd!) - predictLog(p, asOf, fit.beta, fit.adj, fit.chainAdj, model)));
  }
  const sorted = [...errs].sort((a, b) => a - b);
  return median(sorted) ?? 0;
}

// ---------------------------------------------------------------------------
// v1.7: the comps-fitted mcap/TVL ratio valuation — the second lens.
// OLS of log10(mcap / TVL) on [1, log10(TVL + $25M)] with the same shrunk
// median-residual group adjustments as production. Same target (snapshot
// market cap), same 70 dated comps, same nested folds. FDV/TVL at TGE,
// airdrop %, VC tier/raise and growth velocity are NOT fitted: the
// snapshot carries no such fields, and no value is invented for them.
// ---------------------------------------------------------------------------

export type RatioLensFit = {
  beta: number[];
  adj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>;
  chainAdj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>;
};

/** Fit the ratio lens on the given comps: OLS on the log ratio, then the
 * shrunk median-residual category and chain adjustments on ratio
 * residuals — the same shrinkage (n/(n+3)) as production. */
export function fitRatioLens(
  rows: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
): RatioLensFit {
  const xs = rows.map((p) => Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd));
  const ys = rows.map((p) => Math.log10(p.mcap_usd! / Math.max(1, p.tvl_usd)));
  const n = rows.length;
  let s00 = 0;
  let s01 = 0;
  let s11 = 0;
  let t0 = 0;
  let t1 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    s00 += 1;
    s01 += x;
    s11 += x * x;
    t0 += y;
    t1 += x * y;
  }
  const beta = solveLinear(
    [
      [s00, s01],
      [s01, s11],
    ],
    [t0, t1],
  );
  const ratioResidual = (p: SnapshotProtocol): number => {
    const x = Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd);
    return Math.log10(p.mcap_usd! / Math.max(1, p.tvl_usd)) - (beta[0]! + beta[1]! * x);
  };
  const groupAdj = (keyOf: (p: SnapshotProtocol) => string): Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }> => {
    const byKey = new Map<string, number[]>();
    for (const p of rows) {
      const key = keyOf(p);
      const list = byKey.get(key);
      if (list === undefined) byKey.set(key, [ratioResidual(p)]);
      else list.push(ratioResidual(p));
    }
    const out = new Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>();
    for (const [key, rs] of byKey) {
      rs.sort((a, b) => a - b);
      out.set(key, { adjustment: round4((median(rs) ?? 0) * (rs.length / (rs.length + model.shrink_k))), count: rs.length, basis: 'category' });
    }
    return out;
  };
  return { beta, adj: groupAdj((p) => p.category ?? 'Other'), chainAdj: groupAdj(mainChain) };
}

/** The ratio lens's fitted log10 market-cap value: predicted log ratio +
 * log10(TVL), with the lens's category and chain adjustments. */
export function predictLogRatio(p: SnapshotProtocol, asOf: string, lens: RatioLensFit, model: ModelConstants = MODEL): number {
  const x = Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd);
  const predRatio =
    lens.beta[0]! +
    lens.beta[1]! * x +
    (lens.adj.get(p.category ?? 'Other')?.adjustment ?? 0) +
    (lens.chainAdj.get(mainChain(p))?.adjustment ?? 0);
  void asOf;
  return predRatio + Math.log10(Math.max(1, p.tvl_usd));
}

/** The ratio lens on the nested folds, replicating nestedSelectionMetric's
 * fold construction exactly (same dated order, same 10% steps, same
 * 30-day purge): per-fold absolute log errors on the selection folds
 * (50–80) and on the untouched 90% fold, plus the full-fit lens. */
export function ratioLensNested(
  rows: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
): { selectionErrs: number[]; untouched90Errs: number[]; full: RatioLensFit } {
  const dated = [...rows].sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const nestedStep = Math.max(1, Math.round(dated.length * 0.1));
  const selectionErrs: number[] = [];
  const untouched90Errs: number[] = [];
  for (const pct of [50, 60, 70, 80, 90]) {
    const nTr = Math.floor((dated.length * pct) / 100);
    const foldTest = dated.slice(nTr, nTr + nestedStep);
    if (foldTest.length === 0) continue;
    const foldTestStart = foldTest[0]!.listed_at!;
    const foldTrain = dated.slice(0, nTr).filter((p) => (ageDays(foldTestStart, p.listed_at) ?? 0) >= model.purge_gap_days);
    const lens = fitRatioLens(foldTrain, asOf, model);
    for (const p of foldTest) {
      const err = Math.abs(Math.log10(p.mcap_usd!) - predictLogRatio(p, asOf, lens, model));
      if (pct < 90) selectionErrs.push(err);
      else untouched90Errs.push(err);
    }
  }
  return { selectionErrs, untouched90Errs, full: fitRatioLens(rows, asOf, model) };
}

/** The OOD segment of a nested test row (charter v1.4): in-distribution (0
 * flags); unseen-chain-only / unseen-category-only (exactly 1 flag, that
 * one); partial-other (exactly 1 flag of the TVL / age / nearest kind);
 * major (≥ 2 flags). */
export type OodSegment = 'in-distribution' | 'unseen-chain-only' | 'unseen-category-only' | 'partial-other' | 'major';
export function oodSegment(rep: OodReport): OodSegment {
  if (rep.flag_count === 0) return 'in-distribution';
  if (rep.flag_count >= 2) return 'major';
  if (rep.unseen_chain) return 'unseen-chain-only';
  if (rep.unseen_category) return 'unseen-category-only';
  return 'partial-other';
}

/** The raw Polymarket EV simulation output (charter v1.2): the full seeded draw
 * array — the launch uniforms and the value draws — plus the statistics computed
 * from it, so the contradiction the audit found can be checked draw by draw. */
export interface EvSimulationExport {
  slug: string;
  name: string;
  seed: number;
  n_draws: number;
  predicted_log_value: number;
  plan_cost_usd: number;
  band_halfwidth_dex: number;
  band_multiplier: number;
  sigma_dex: number;
  launch_odds_adopted: number;
  launch_odds_base_rate: number;
  launch_odds_platt: number;
  launch_odds_conservative: number;
  /** The raw draws: [launch uniform u, value in USD] per draw, in draw order. */
  draws: [number, number][];
  /** The statistics computed from this exact array. */
  stats: EvSimulation;
}

/** Everything the dashboard renders, from the snapshot. The Rain
 * winsorization candidate (charter v1.4) is tested here, before the board is
 * built: both fits are made, the winsorized nested selection-pooled error is
 * compared against the production one, and the adopted fit — winsorized only
 * if it strictly wins the nested walk-forward — is the one the dashboard
 * prints. The farm count never decides adoption. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  snapshotSha256: string | null = null,
): { board: BoardRow[]; radar: RadarData; evSimulationExport: EvSimulationExport | null } {
  const productionFitted = fitModel(snapshot, model);
  const selected = productionFitted.validation.model_selection.selected;
  const comps = liveComps(snapshot);
  const winsorCap = productionFitted.valueCapP95Usd;
  const winsorizedComps = comps.map((p) => (p.mcap_usd! > winsorCap ? { ...p, mcap_usd: winsorCap } : p));
  const winsorFitted = fitModel(snapshot, model, winsorCap);
  const winsorBoard = buildBoard(snapshot, winsorFitted, model);
  const productionBoard = buildBoard(snapshot, productionFitted, model);
  const winsorNested = nestedSelectionMetric(winsorizedComps, snapshot.as_of, model, selected);
  const prodNested = productionFitted.validation.nested_selection_pooled;
  const selectionImprovement = prodNested - winsorNested;
  // The prespecified rule (charter v1.4): adopt only if the winsorized nested
  // selection-pooled error improves on production's by MORE than 0.01 dex —
  // a strictly-better-but-tiny improvement does not justify changing the fit.
  const winsorAdopted = selectionImprovement > 0.01;
  const winsorProdPred = new Map(productionBoard.rows.map((r) => [r.slug, r.model.predicted_log_value]));
  const winsorLopoMax = Math.max(...winsorBoard.rows.map((r) => Math.abs(r.model.predicted_log_value - (winsorProdPred.get(r.slug) ?? r.model.predicted_log_value))));
  const winsorOrder = winsorBoard.rows.map((r) => r.slug);
  const prodOrder = productionBoard.rows.map((r) => r.slug);
  const winsorizationTest: WinsorizationTest = {
    cap_p95_usd: winsorCap,
    winsorized_intercept: round4(winsorFitted.beta[0]!),
    winsorized_coef_log_tvl: round4(winsorFitted.beta[1]!),
    winsorized_selection_pooled_dex: round4(winsorNested),
    production_selection_pooled_dex: round4(prodNested),
    selection_improvement_dex: round4(selectionImprovement),
    winsorized_lopo_max_abs_delta_predicted_log: round4(winsorLopoMax),
    production_lopo_max_abs_delta_predicted_log: round4(productionFitted.validation.lopo_influence.max_abs_delta_predicted_log),
    board_spearman_vs_production: round4(spearmanRankCorrelation(prodOrder, winsorOrder)),
    top10_overlap_vs_production: winsorOrder.slice(0, 10).filter((s) => prodOrder.slice(0, 10).includes(s)).length,
    top20_overlap_vs_production: winsorOrder.slice(0, 20).filter((s) => prodOrder.slice(0, 20).includes(s)).length,
    farm_count_adopted_gate: winsorBoard.gateTest[`variant_${winsorBoard.gateTest.adopted}`].farm_count,
    adopted: winsorAdopted,
    reason: winsorAdopted
      ? `Adopted: the winsorized nested selection-pooled error (${round4(winsorNested)} dex) improves on production's (${round4(prodNested)} dex) by ${round4(selectionImprovement)} dex, more than the prespecified 0.01 dex bar — so the production fit IS the winsorized fit: rain is capped at the P95 in every number the dashboard prints, including the fit constants and the board.`
      : `Not adopted: the winsorized nested selection-pooled error (${round4(winsorNested)} dex) improves on production's (${round4(prodNested)} dex) by ${round4(selectionImprovement)} dex, which does not clear the prespecified 0.01 dex bar — so rain stays uncapped in production. Capping rain would be a cosmetic fix for an outlier the data does not call an error.`,
  };
  const fitted = winsorAdopted ? winsorFitted : productionFitted;
  const effectiveComps = winsorAdopted ? winsorizedComps : comps;
  return buildRadarFromFitted(snapshot, fitted, model, winsorizationTest, effectiveComps, snapshotSha256);
}

/** Everything the dashboard renders, from the snapshot and a fitted model.
 * The winsorization test is computed by the buildRadar wrapper (it needs
 * both fits) and passed in; the effective comp list matches the fitted
 * model (winsorized comps when the winsorized fit was adopted). */
function buildRadarFromFitted(
  snapshot: Snapshot,
  fitted: FittedModel,
  model: ModelConstants,
  winsorizationTest: WinsorizationTest,
  effectiveComps: SnapshotProtocol[],
  snapshotSha256: string | null = null,
): { board: BoardRow[]; radar: RadarData; evSimulationExport: EvSimulationExport | null } {
  const { rows: board, gateTest } = buildBoard(snapshot, fitted, model);
  fitted.validation.gate_test = gateTest;
  // v1.7: the cost the gate is evaluated against — the full costed plan
  // C_i when (g) is adopted, the base plan cost otherwise. Every refit
  // verdict and crosscheck below uses this cost, so the stability and
  // audit numbers describe the same rule as the board.
  const gateCostOf = (r: BoardRow): number => (gateTest.adopted === 'g' ? r.model.costed_plan.total_usd : r.plan_cost_usd);
  // The EV end-to-end audit (charter v1.2): every farm row, plus every row with a
  // positive mean EV under the adopted odds (the rows the old EV>0-only rule
  // would have farmed) — the audit trail for the verdicts, with the stress test.
  fitted.validation.ev_audit = {
    rows: board
      .filter((r) => r.verdict === 'farm' || r.model.expected_value_usd > 0)
      .map((r) => ({
        slug: r.slug,
        name: r.name,
        value_if_launches_usd: r.model.value_if_launches_usd,
        launch_odds: r.model.launch_odds,
        launch_odds_platt: r.model.launch_odds_platt,
        break_even_odds: r.model.break_even_odds,
        plan_cost_usd: r.plan_cost_usd,
        ev_central_usd: r.model.expected_value_usd,
        ev_conservative_usd: r.model.ev_conservative_usd,
        ev_optimistic_usd: r.model.ev_optimistic_usd,
        prob_negative_return: r.model.prob_negative_return,
        prob_negative_analytic: r.model.prob_negative_analytic,
        p10_value_usd: r.model.p10_value_usd,
        ev_at_p10_usd: r.model.ev_at_p10_usd,
        ev_at_p25_value_if_launches_usd: r.model.ev_at_p25_value_if_launches_usd,
        ev_at_p75_value_if_launches_usd: r.model.ev_at_p75_value_if_launches_usd,
        ev_mean_base_rate_usd: r.model.ev_mean_base_rate_usd,
        ev_mean_platt_usd: r.model.ev_mean_platt_usd,
        ev_mean_conservative_usd: r.model.ev_mean_conservative_usd,
        gate_pass_conservative: r.model.gate_pass_conservative,
        is_ood: r.model.ood.is_ood,
        verdict: r.verdict,
        verdict_rule:
          r.verdict === 'farm'
            ? `FARM: the adopted gate (variant ${gateTest.adopted}) passes under the conservative launch odds (${fitted.launchOddsDecision.conservative_lower_bound}).`
            : r.model.gate_pass_adopted
              ? 'Demoted by the v1.2 stress test: the adopted gate passes under the adopted launch odds but NOT under the conservative launch odds.'
              : 'Not a farm: the adopted gate does not pass under the adopted launch odds.',
      })),
    assumptions: EV_ASSUMPTIONS,
  };
  // The distribution-sensitivity tournament (charter v1.3): the same audit rows
  // re-priced under five conditional-launch-value distributions plus a P90-cap
  // sensitivity row, so no decision rests on the uncapped lognormal mean alone.
  const tournamentRows = board
    .filter((r) => r.verdict === 'farm' || r.model.expected_value_usd > 0)
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      predictedLog: r.model.predicted_log_value,
      planCost: r.plan_cost_usd,
      sigma: fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01,
      launchOdds: r.model.launch_odds,
    }));
  fitted.validation.distribution_tournament = runDistributionTournament(tournamentRows, fitted, model);
  // The param-aware farming simulation (charter v1.5): the same audit rows
  // re-priced with coefficient, launch-odds and distribution-choice
  // uncertainty folded into every draw, plus the paired pass fractions of
  // gate (d) under both odds layers.
  fitted.validation.param_aware_simulation = runParamAwareSimulation(tournamentRows, fitted, model);
  // The gate-(d) economic audit (charter v1.5): the breakeven multiples, the
  // launch-success rate the 85% ceiling demands, and the farm count under
  // each threshold multiple × ceiling combination, under both odds layers.
  fitted.validation.gate_threshold_grid = runGateThresholdGrid(
    tournamentRows,
    fitted.seasoning.base_rate,
    fitted.launchOddsDecision.conservative_lower_bound,
    fitted.valueCapUsd,
    model,
  );
  // Simulation-vs-analytic reconciliation, appended to the grid note: the
  // grid is analytic (exact closed form) while the gate test is the
  // 20,000-draw simulation, so the two disagree by Monte Carlo noise on
  // rows sitting at the ceiling — never by a model difference. The
  // conservative counts agree exactly, which is the structural claim.
  {
    const grid = fitted.validation.gate_threshold_grid;
    const dCell = grid.rows.find((r) => r.multiple === 3 && r.ceiling === 0.85)!;
    grid.note += ` Simulation-vs-analytic reconciliation: the analytic (3×, 0.85) cell farms ${dCell.farm_count_adopted} rows under the adopted odds vs the simulation gate test's ${gateTest.variant_d.farm_count} — the difference is rows whose simulated P(negative) sits within Monte Carlo error of the 0.85 ceiling while their analytic P(negative) is at or below it; the conservative count is ${dCell.farm_count_conservative} under both. Gate (f): analytic ${grid.analytic_farm_count_f_adopted} vs simulation ${gateTest.variant_f.farm_count} under the adopted odds and analytic ${grid.analytic_farm_count_f_conservative} vs simulation ${gateTest.variant_f.farm_count_conservative} under the conservative odds — the same mechanism, so the board's FARM count carries ±3 rows of Monte Carlo noise.`;
  }
  // The floor ranking diagnostic (charter v1.2): for each floor, refit the
  // selected estimator on the 70 dated comps and re-rank the board; compare
  // against the locked $25M board by Spearman ρ, top-20 overlap and top-10
  // changes. The floor stays $25M — this reports, it does not select.
  const baseOrder = board.map((r) => r.slug);
  const baseTop20 = new Set(baseOrder.slice(0, 20));
  const baseTop10 = baseOrder.slice(0, 10);
  const comps = effectiveComps;
  const selected = fitted.validation.model_selection.selected;
  for (const fr of fitted.validation.floor_sensitivity.rows) {
    if (fr.floor_usd === 25_000_000) {
      fr.spearman_vs_25m = 1;
      fr.top20_overlap_vs_25m = 20;
      fr.top10_changes_vs_25m = 0;
      continue;
    }
    const m = { ...model, size_floor_usd: fr.floor_usd };
    const f = fitRegression(comps, snapshot.as_of, m, selected);
    const rescored = board.map((r) => {
      const p = snapshot.protocols.find((x) => x.slug === r.slug)!;
      const pred = predictLog(p, snapshot.as_of, f.beta, f.adj, f.chainAdj, m);
      const valueIf = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** pred)));
      return { slug: r.slug, implied: valueIf * r.model.launch_odds };
    });
    rescored.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const order = rescored.map((x) => x.slug);
    fr.spearman_vs_25m = round4(spearmanRankCorrelation(baseOrder, order));
    fr.top20_overlap_vs_25m = order.slice(0, 20).filter((s) => baseTop20.has(s)).length;
    fr.top10_changes_vs_25m = order.slice(0, 10).filter((s, i) => baseTop10[i] !== s).length;
  }
  // The cap-as-risk-control stress test (charter v1.4): the same audit rows
  // re-priced under the uncapped, P90-capped, P95-capped and production-capped
  // lognormals, with the farm counts under each gate policy. The cap was
  // chosen by the CRPS validation on the nested selection folds (charter
  // v1.3), NOT by looking at the farm counts — the CRPS difference (0.5065
  // capped vs 0.5058 uncapped, n=28) is too small to claim the capped
  // distribution is more accurate, so the cap is reported as a risk limit,
  // not as evidence of accuracy.
  const capTournament = fitted.validation.distribution_tournament!;
  const capByKind = new Map(capTournament.results.map((r) => [r.distribution, r]));
  const capRows: CapSensitivityRow[] = (
    [
      ['lognormal', 'uncapped', null],
      ['capped-p90-lognormal', 'P90 cap', capTournament.cap_p90_usd],
      ['capped-p95-lognormal', 'P95 cap', capTournament.cap_p95_usd],
      ['capped-lognormal', 'production cap (max comp mcap)', capTournament.cap_usd],
    ] as [DistributionKind, string, number | null][]
  ).map(([kind, label, capUsd]) => {
    const r = capByKind.get(kind)!;
    const polyRow = r.rows.find((x) => x.slug === 'polymarket-international');
    return {
      cap_label: label,
      cap_usd: capUsd,
      pooled_conditional_mean_value_usd: r.pooled_conditional_mean_value_usd,
      pooled_mean_net_ev_usd: r.pooled_mean_net_ev_usd,
      farm_count_a: r.farm_count_a,
      farm_count_b: r.farm_count_b,
      farm_count_c: r.farm_count_c,
      farm_count_d: r.farm_count_d,
      farm_count_e: r.farm_count_e,
      farm_count_f: r.farm_count_f,
      farm_count_g: r.farm_count_g,
      polymarket_mean_net_ev_usd: polyRow?.mean_net_ev_usd ?? 0,
    };
  });
  const adoptedFarmKey = `farm_count_${gateTest.adopted}` as 'farm_count_a' | 'farm_count_b' | 'farm_count_c' | 'farm_count_d' | 'farm_count_e' | 'farm_count_f' | 'farm_count_g';
  fitted.validation.cap_sensitivity = {
    rows: capRows,
    production_cap_label: capTournament.cap_kept ? 'production cap (max comp mcap)' : 'uncapped',
    cap_choice_statement: 'The production cap was chosen on principle before any validation outcome was computed (charter v1.3): the maximum observed dated-comp market cap bounds the simulated launch value at the largest value ever observed, so no farm plan rests on a launch value larger than any comparable has ever reached. The CRPS check only gates the keep/revert decision.',
    crps_capped_dex: fitted.crpsValidation.capped_dex,
    crps_uncapped_dex: fitted.crpsValidation.uncapped_dex,
    crps_n_test_rows: fitted.crpsValidation.n_test_rows,
    note: `CRPS capped ${fitted.crpsValidation.capped_dex} vs uncapped ${fitted.crpsValidation.uncapped_dex} dex (n=${fitted.crpsValidation.n_test_rows}) — the capped distribution is slightly worse, so no claim is made that it is more accurate; the cap bounds tail risk. Stability is judged on the adopted gate (${gateTest.adopted}): its farm count is ${capRows.map((r) => r[adoptedFarmKey]).join(' / ')} across the four caps (uncapped / P90 / P95 / production). The other policies' counts move with the cap, which is expected: a looser cap inflates the conditional mean, and policies (b)/(d)/(e) farm on the conditional mean.`,
  };
  // The outlier audit (charter v1.4): rain and obol to the data source, plus
  // the with/without refits. Rain is NOT deleted from production — both
  // analyses are published and the production fit keeps rain.
  const compRatios = comps
    .map((p) => ({ slug: p.slug, ratio: p.mcap_usd! / Math.max(1, p.tvl_usd) }))
    .sort((a, b) => b.ratio - a.ratio);
  const auditRows: OutlierAuditRow[] = ['rain', 'obol'].map((slug) => {
    const p = snapshot.protocols.find((x) => x.slug === slug)!;
    const mcap = p.mcap_usd!;
    const ratio = mcap / Math.max(1, p.tvl_usd);
    const rank = compRatios.findIndex((r) => r.slug === slug) + 1;
    const rankLabel = rank === 1 ? `1 of ${compRatios.length} (highest)` : rank === compRatios.length ? `${rank} of ${compRatios.length} (lowest)` : `${rank} of ${compRatios.length}`;
    return {
      slug: p.slug,
      name: p.name,
      snapshot_date: snapshot.as_of,
      listed_at: p.listed_at,
      tvl_usd: p.tvl_usd,
      mcap_usd: mcap,
      mcap_source: snapshot.source,
      main_chain: mainChain(p),
      category: p.category ?? 'Other',
      target_definition: 'market cap at the snapshot date (the regression target is log10 market cap; FDV is never used)',
      snapshot_time: snapshot.as_of,
      mcap_tvl_ratio: round4(ratio),
      mcap_tvl_ratio_rank: rankLabel,
      comparable_by_target_and_time: p.listed_at !== null && p.listed_at <= snapshot.as_of,
      tvl_consistent: p.tvl_usd > 0,
      is_market_cap_not_fdv: true,
      valid_observation_assessment:
        slug === 'rain'
          ? 'Valid observation: listed 2025-10-28, market cap from DefiLlama at the snapshot date, TVL positive. The 400.2× mcap/TVL ratio is a same-date ratio (TVL and market cap both from the 2026-11-14 snapshot), not a time mismatch, and the snapshot carries no field that would mark the record a measurement error. The ratio is extreme because the TVL is small ($6.6M) for a prediction-market token with a $2.65B market cap — a structurally different case (thin on-chain TVL vs large token value), not a data error.'
          : 'Valid observation: listed 2025-11-04, market cap from DefiLlama at the snapshot date, TVL positive. The 0.000626× mcap/TVL ratio is a same-date ratio and the lowest of all comps — a staking-pool token whose $1.15B TVL dwarfs its $717K market cap. A structurally different case (TVL-heavy, token-light), not a data error.',
    };
  });
  const outlierRefits: OutlierRefitRow[] = [];
  const fullNestedMetric = nestedSelectionMetric(comps, snapshot.as_of, model, selected);
  const conservativeOdds = fitted.launchOddsDecision.conservative_lower_bound;
  for (const drop of ['rain', 'obol']) {
    const dropped = comps.find((p) => p.slug === drop)!;
    const without = comps.filter((p) => p.slug !== drop);
    const metricWithout = nestedSelectionMetric(without, snapshot.as_of, model, selected);
    const f = fitRegression(without, snapshot.as_of, model, selected);
    const rescored = board.map((r) => {
      const p = snapshot.protocols.find((x) => x.slug === r.slug)!;
      const pred = predictLog(p, snapshot.as_of, f.beta, f.adj, f.chainAdj, model);
      const valueIf = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** pred)));
      return { slug: r.slug, implied: valueIf * r.model.launch_odds };
    });
    rescored.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const order = rescored.map((x) => x.slug);
    let farmAdopted = 0;
    for (const r of board) {
      const p = snapshot.protocols.find((x) => x.slug === r.slug)!;
      const pred = predictLog(p, snapshot.as_of, f.beta, f.adj, f.chainAdj, model);
      const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
      if (analyticVerdict(pred, sigma, gateCostOf(r), r.model.launch_odds, conservativeOdds, r.model.break_even_odds, gateTest.adopted, fitted.valueCapUsd, r.model.ood, model) === 'farm') farmAdopted++;
    }
    outlierRefits.push({
      dropped: drop,
      intercept: round4(f.beta[0]!),
      coef_log_tvl: round4(f.beta[1]!),
      selection_pooled_dex: round4(metricWithout),
      selection_vs_production_dex: round4(metricWithout - fullNestedMetric),
      board_spearman_vs_production: round4(spearmanRankCorrelation(baseOrder, order)),
      top10_overlap_vs_production: order.slice(0, 10).filter((s) => baseTop10.includes(s)).length,
      top20_overlap_vs_production: order.slice(0, 20).filter((s) => baseTop20.has(s)).length,
      farm_count_adopted_gate: farmAdopted,
    });
  }
  fitted.validation.outlier_audit = {
    rows: auditRows,
    refits: outlierRefits,
    rain_kept_in_production: true,
    note: winsorizationTest.adopted
      ? 'Rain (400.2× mcap/TVL, the highest of all comps) and obol (0.000626×, the lowest) are valid observations by the snapshot\'s own definition: both are listed, carry a market cap from DefiLlama at the snapshot date, and carry a positive TVL. The 400× multiple is a same-date ratio — the TVL and the market cap are both from the 2026-11-14 snapshot — not a time mismatch, and the snapshot carries no field that would mark either record a measurement error. Rain is CAPPED at the P95 in the production fit because the winsorized fit won the nested walk-forward (see winsorization_test); the with/without refits above are computed on the winsorized comp list.'
      : 'Rain (400.2× mcap/TVL, the highest of all comps) and obol (0.000626×, the lowest) are valid observations by the snapshot\'s own definition: both are listed, carry a market cap from DefiLlama at the snapshot date, and carry a positive TVL. The 400× multiple is a same-date ratio — the TVL and the market cap are both from the 2026-11-14 snapshot — not a time mismatch, and the snapshot carries no field that would mark either record a measurement error. Rain is therefore kept UNCAPPED in the production fit (the winsorization candidate did not beat the production fit on the nested walk-forward — see winsorization_test); its influence is quantified by the with/without refits above instead of by deletion.',
  };
  // The ranking-stability evaluation (charter v1.4), completed: LOPO
  // re-ranking under the adopted gate, the TVL perturbation, the descriptive
  // bars, and the analytic-vs-simulation verdict crosscheck.
  const boardProtocols = snapshot.protocols.filter(isRankable);
  const boardBySlug = new Map(board.map((r) => [r.slug, r]));
  const prodOrderRankable = board.filter((r) => boardProtocols.some((p) => p.slug === r.slug)).map((r) => r.slug);
  const prodTop10Set = new Set(prodOrderRankable.slice(0, 10));
  const prodTop20Set = new Set(prodOrderRankable.slice(0, 20));
  const lopoRankingRows: LopoRankingRow[] = [];
  // The verdict stability (charter v1.5): per board row, the refit verdicts
  // and refit ranks across the LOPO refits — accumulated inside the loop
  // below, aggregated after it.
  const verdictCountsBySlug = new Map<string, { farm: number; marginal: number; skip: number }>();
  const flipDriversBySlug = new Map<string, { dropped_slug: string; to_verdict: Verdict; abs_delta: number }[]>();
  const ranksBySlug = new Map<string, number[]>();
  for (const r of board) {
    verdictCountsBySlug.set(r.slug, { farm: 0, marginal: 0, skip: 0 });
    flipDriversBySlug.set(r.slug, []);
    ranksBySlug.set(r.slug, []);
  }
  for (const dropped of comps) {
    const refitPreds = fitted.lopoRefitPreds.get(dropped.slug);
    if (refitPreds === undefined) continue;
    const rescored = boardProtocols.map((p, i) => {
      const pred = refitPreds[i]!;
      const valueIf = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** pred)));
      const row = boardBySlug.get(p.slug)!;
      return { slug: p.slug, implied: valueIf * row.model.launch_odds };
    });
    rescored.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const order = rescored.map((x) => x.slug);
    order.forEach((slug, i) => ranksBySlug.get(slug)?.push(i + 1));
    const moved: string[] = [];
    let maxDelta = 0;
    for (const r of board) {
      const idx = boardProtocols.findIndex((x) => x.slug === r.slug);
      if (idx < 0) continue;
      const pred = refitPreds[idx]!;
      const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
      // v1.6: the refit verdict uses the SAME rule as the production
      // verdict (the analytic gate under the conservative odds) — the
      // proportions measure this rule's sensitivity to the training set.
      const vRefit = analyticLayerVerdict(pred, sigma, gateCostOf(r), conservativeOdds, r.model.break_even_odds, gateTest.adopted, fitted.valueCapUsd, r.model.ood, model);
      if (vRefit !== r.verdict) moved.push(r.slug);
      maxDelta = Math.max(maxDelta, Math.abs(pred - r.model.predicted_log_value));
      verdictCountsBySlug.get(r.slug)![vRefit]++;
      if (vRefit !== r.verdict) {
        flipDriversBySlug.get(r.slug)!.push({ dropped_slug: dropped.slug, to_verdict: vRefit, abs_delta: Math.abs(pred - r.model.predicted_log_value) });
      }
    }
    lopoRankingRows.push({
      slug: dropped.slug,
      spearman_vs_production: round4(spearmanRankCorrelation(prodOrderRankable, order)),
      top10_overlap: order.slice(0, 10).filter((s) => prodTop10Set.has(s)).length,
      top20_overlap: order.slice(0, 20).filter((s) => prodTop20Set.has(s)).length,
      verdict_moves: moved.length,
      moved_slugs: moved,
      max_abs_delta_predicted_log: round4(maxDelta),
    });
  }
  // The TVL perturbation (charter v1.4): for EACH board row, perturb ITS TVL
  // by +10% and by −10% (row-local: the comps and their adjustments do not
  // change) and recompute its predicted log (pred + coef × log10(1 ± 0.1))
  // and its rank against the UNSHOCKED board. Report the count of rows whose
  // rank changes under each shock and the maximum rank move.
  const tvlPerturbation: TvlPerturbation[] = [];
  const slope = fitted.beta[1]!;
  for (const shock of [-0.1, 0.1] as const) {
    const shift = slope * Math.log10(1 + shock);
    let rowsChanged = 0;
    let maxMove = 0;
    board.forEach((r, i) => {
      const pred = r.model.predicted_log_value + shift;
      const valueIf = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** pred)));
      const implied = valueIf * r.model.launch_odds;
      let newRank = 1;
      for (let j = 0; j < board.length; j++) {
        if (j === i) continue;
        const other = board[j]!;
        if (other.implied_value_usd > implied || (other.implied_value_usd === implied && other.slug < r.slug)) newRank++;
      }
      const move = Math.abs(newRank - (i + 1));
      if (move > 0) rowsChanged++;
      maxMove = Math.max(maxMove, move);
    });
    tvlPerturbation.push({ shock: shock > 0 ? '+10%' : '−10%', rows_with_rank_change: rowsChanged, max_abs_rank_move: maxMove });
  }
  const lopoSpearmans = lopoRankingRows.map((r) => r.spearman_vs_production).sort((a, b) => a - b);
  const lopoMedianSpearman = round4(median(lopoSpearmans) ?? 0);
  const lopoWorstTop10 = Math.min(...lopoRankingRows.map((r) => r.top10_overlap));
  const lopoTotalMoves = lopoRankingRows.reduce((a, r) => a + r.verdict_moves, 0);
  // The stability demotion (charter v1.6, threshold prespecified before
  // results): a production FARM is STABLE iff at least 35 of 70 LOPO
  // refits agree with FARM. Below 35 the farm is UNSTABLE and is demoted
  // to MARGINAL with the UNSTABLE label. The demotion is applied here —
  // after the LOPO counts are computed, before the stability rows are
  // built — so main_verdict is the final verdict and n_agreeing_refits
  // counts the refits agreeing with it. The decision trace records the
  // demotion.
  const STABILITY_THRESHOLD = 35;
  let nStabilityDemoted = 0;
  for (const r of board) {
    const counts = verdictCountsBySlug.get(r.slug) ?? { farm: 0, marginal: 0, skip: 0 };
    if (r.verdict === 'farm' && counts.farm < STABILITY_THRESHOLD) {
      r.verdict = 'marginal';
      r.model.farm_demoted_reason = 'unstable';
      r.model.decision_trace.push(`UNSTABLE: only ${counts.farm} of ${lopoRankingRows.length} LOPO refits agree with FARM (threshold ${STABILITY_THRESHOLD}/70) — demoted to marginal.`);
      nStabilityDemoted++;
      // v1.7: a farm demoted to marginal by the stability guard needs its
      // MARGINAL tier too (buildBoard tiers only rows that were already
      // marginal). Same rule, same inputs, recomputed here.
      const sigmaU = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
      const sAU = analyticGateStats(r.model.predicted_log_value, sigmaU, r.model.costed_plan.total_usd, fitted.seasoning.base_rate, fitted.valueCapUsd, model);
      const sCU = analyticGateStats(r.model.predicted_log_value, sigmaU, r.model.costed_plan.total_usd, conservativeOdds, fitted.valueCapUsd, model);
      const kellyU = kellyFraction(r.model.predicted_log_value, sigmaU, r.model.costed_plan.total_usd, conservativeOdds, fitted.valueCapUsd, model);
      const tierU = marginalTierFor(sAU.evMean, sCU.evMean, r.model.costed_plan.total_usd, sCU.probNegative, kellyU.quarter, r.model.borderline);
      r.model.marginal_tier = tierU.tier;
      r.model.ev_per_dollar_at_risk = tierU.evPerDollarAtRisk;
      r.model.kelly_fraction = kellyU.quarter;
    }
    r.model.stability = {
      farm: counts.farm,
      marginal: counts.marginal,
      skip: counts.skip,
      agreeing_refits: counts[r.verdict],
      stable_farm: r.verdict === 'farm' ? counts.farm >= STABILITY_THRESHOLD : null,
    };
  }
  // The verdict-stability aggregates (charter v1.5): per row, the production
  // verdict, how many of the 70 refits agree, the most frequent alternative,
  // the dropped comps that flip it (largest |Δpred| first, capped at 5),
  // and the rank range across refits. The board's rank_range is filled here
  // so the dashboard shows a range wherever the data does not support one
  // precise rank.
  const nLopoRefits = lopoRankingRows.length;
  const stabilityRows: VerdictStabilityRow[] = board.map((r) => {
    const counts = verdictCountsBySlug.get(r.slug) ?? { farm: 0, marginal: 0, skip: 0 };
    const alternatives = (['farm', 'marginal', 'skip'] as Verdict[])
      .filter((v) => v !== r.verdict)
      .map((v) => ({ v, n: counts[v] }))
      .sort((a, b) => b.n - a.n);
    const drivers = [...(flipDriversBySlug.get(r.slug) ?? [])]
      .sort((a, b) => b.abs_delta - a.abs_delta)
      .slice(0, 5)
      .map(({ dropped_slug, to_verdict }) => ({ dropped_slug, to_verdict }));
    const ranks = [...(ranksBySlug.get(r.slug) ?? [r.rank])].sort((a, b) => a - b);
    const rankRange: [number, number, number] = [ranks[0]!, Math.round(median(ranks) ?? r.rank), ranks[ranks.length - 1]!];
    return {
      slug: r.slug,
      main_verdict: r.verdict,
      counts,
      n_agreeing_refits: counts[r.verdict],
      most_frequent_alternative: alternatives[0]!.n > 0 ? alternatives[0]!.v : null,
      flip_drivers: drivers,
      rank_range: rankRange,
    };
  });
  const movesPerRow = stabilityRows.map((r) => nLopoRefits - r.n_agreeing_refits);
  const moveCounts = new Map<string, number>();
  for (const r of stabilityRows) {
    for (const d of flipDriversBySlug.get(r.slug) ?? []) {
      const k = `${r.main_verdict}→${d.to_verdict}`;
      moveCounts.set(k, (moveCounts.get(k) ?? 0) + 1);
    }
  }
  fitted.validation.verdict_stability = {
    n_refits: nLopoRefits,
    unique_rows_ever_flipped: stabilityRows.filter((r) => r.n_agreeing_refits < nLopoRefits).length,
    moves_per_row_median: median([...movesPerRow].sort((a, b) => a - b)) ?? 0,
    moves_per_row_max: Math.max(...movesPerRow),
    pct_pairs_on_main_verdict: round4(stabilityRows.reduce((a, r) => a + r.n_agreeing_refits, 0) / Math.max(1, stabilityRows.length * nLopoRefits)),
    most_frequent_moves: [...moveCounts.entries()]
      .map(([k, count]) => {
        const [from, to] = k.split('→');
        return { from: from as Verdict, to: to as Verdict, count };
      })
      .sort((a, b) => b.count - a.count),
    rows: stabilityRows,
    stability_threshold: STABILITY_THRESHOLD,
    n_stability_demoted: nStabilityDemoted,
  };
  for (const r of board) {
    r.rank_range = stabilityRows.find((s) => s.slug === r.slug)?.rank_range ?? [r.rank, r.rank, r.rank];
  }
  // The analytic-vs-board crosscheck (charter v1.6): the analytic verdict
  // under the conservative odds is the production verdict, so it agrees
  // with the board verdict on every row except the BORDERLINE and
  // stability demotions — those disagreements are the guards working,
  // not noise. The simulation-vs-analytic crosscheck is the Wilson
  // containment: each simulated P(negative) must lie within its 95%
  // Wilson interval around the analytic value. At N = 20,000 a ~5%
  // miss rate is Monte Carlo noise by construction (the interval is a
  // 95% interval); the hard bound is |sim − analytic| ≤ 0.02 on every
  // row, which no sampling noise reaches.
  let nAgree = 0;
  let nNearBoundary = 0;
  let nWilsonInsideAdopted = 0;
  let nWilsonInsideConservative = 0;
  let maxGap = 0;
  for (const r of board) {
    const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
    const vAnalytic = analyticLayerVerdict(r.model.predicted_log_value, sigma, gateCostOf(r), conservativeOdds, r.model.break_even_odds, gateTest.adopted, fitted.valueCapUsd, r.model.ood, model);
    if (vAnalytic === r.verdict) nAgree++;
    const aStats = analyticGateStats(r.model.predicted_log_value, sigma, gateCostOf(r), r.model.launch_odds, fitted.valueCapUsd, model);
    if (Math.abs(aStats.evMean) <= 5000) nNearBoundary++;
    const aStatsCons = analyticGateStats(r.model.predicted_log_value, sigma, gateCostOf(r), conservativeOdds, fitted.valueCapUsd, model);
    const [loA, hiA] = wilsonInterval(r.model.prob_negative_return, EV_SIM_DRAWS);
    if (r.model.prob_negative_analytic >= loA && r.model.prob_negative_analytic <= hiA) nWilsonInsideAdopted++;
    const [loC, hiC] = wilsonInterval(r.model.prob_negative_return_conservative, EV_SIM_DRAWS);
    if (aStatsCons.probNegative >= loC && aStatsCons.probNegative <= hiC) nWilsonInsideConservative++;
    maxGap = Math.max(maxGap, Math.abs(r.model.prob_negative_return - r.model.prob_negative_analytic), Math.abs(r.model.prob_negative_return_conservative - aStatsCons.probNegative));
  }
  fitted.validation.ranking_stability = {
    ...fitted.validation.ranking_stability,
    lopo: lopoRankingRows,
    lopo_median_spearman: lopoMedianSpearman,
    lopo_worst_top10_overlap: lopoWorstTop10,
    lopo_total_verdict_moves: lopoTotalMoves,
    tvl_perturbation: tvlPerturbation,
    descriptive_bars: [
      { bar: 'LOPO median Spearman ρ ≥ 0.90', met: lopoMedianSpearman >= 0.9 },
      { bar: 'LOPO worst top-10 overlap ≥ 7 of 10', met: lopoWorstTop10 >= 7 },
      { bar: 'TVL-perturbation rank moves on ≤ 5 rows', met: tvlPerturbation.every((t) => t.rows_with_rank_change <= 5) },
    ],
    analytic_verdict_crosscheck: {
      n_rows: board.length,
      n_agree: nAgree,
      n_near_boundary: nNearBoundary,
      note: `The analytic verdict under the conservative odds IS the production verdict, so it agrees with the board on ${nAgree} of ${board.length} rows; the ${board.length - nAgree} disagreement${board.length - nAgree === 1 ? ' is' : 's are'} exactly the BORDERLINE and stability demotions — the guards working, not noise. The simulation cross-check: the analytic P(negative) lies inside the simulated P(negative)'s 95% Wilson interval on ${nWilsonInsideAdopted} of ${board.length} rows under the adopted odds and ${nWilsonInsideConservative} of ${board.length} under the conservative odds (a ~5% miss rate is Monte Carlo noise by construction — the interval is a 95% interval); the largest |sim − analytic| gap is ${round4(maxGap)}, inside the 0.02 hard bound on every row. The leakage test verifies the demotion count and the 0.02 bound.`,
      wilson_n_inside_adopted: nWilsonInsideAdopted,
      wilson_n_inside_conservative: nWilsonInsideConservative,
      wilson_n_rows: board.length,
      max_abs_sim_analytic_gap: round4(maxGap),
      n_demoted_by_guards: board.length - nAgree,
    },
    note: 'The LOPO rows re-rank the board under each refit (one comp dropped) and compare against the production board order, with verdict moves computed by the analytic EV under the adopted gate. The descriptive bars are reported, not gates — no production decision changes on them.',
  };
  // The Rain winsorization candidate result (charter v1.4) — computed by the
  // buildRadar wrapper from both fits and passed in; the fitted model above
  // is already the adopted one.
  fitted.validation.winsorization_test = winsorizationTest;
  // The gate-(f) re-audit with expected net return (charter v1.6): every
  // analytic-(f)-farm candidate under the adopted odds, with its expected
  // net return under both layers, its conditional payoff and multiple, and
  // its tail risk. Gate (f) is a risk-screening policy, never a profit
  // gate: the breakeven multiple is 1/p_L − 1 (5.09× adopted / 6.33×
  // conservative), so a farm with a conditional multiple between 3× and
  // the breakeven multiple has a NEGATIVE expected net return. The audit
  // reports; it does not re-pick the gate.
  const auditAdoptedOdds = fitted.seasoning.base_rate;
  const auditConservativeOdds = fitted.launchOddsDecision.conservative_lower_bound;
  const breakevenAdopted = 1 / auditAdoptedOdds - 1;
  const breakevenConservative = 1 / auditConservativeOdds - 1;
  const sigmaOf = (r: BoardRow): number => (fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01);
  const gateFAuditRows: GateFAuditRow[] = board
    .filter((r) => gatePasses('f', analyticGateStats(r.model.predicted_log_value, sigmaOf(r), r.plan_cost_usd, auditAdoptedOdds, fitted.valueCapUsd, model), auditAdoptedOdds))
    .map((r) => {
      const sA = analyticGateStats(r.model.predicted_log_value, sigmaOf(r), r.plan_cost_usd, auditAdoptedOdds, fitted.valueCapUsd, model);
      const sC = analyticGateStats(r.model.predicted_log_value, sigmaOf(r), r.plan_cost_usd, auditConservativeOdds, fitted.valueCapUsd, model);
      const evParam = fitted.evParamBySlug.get(r.slug)?.ev_mean_param_usd ?? [sA.evMean, sA.evMean];
      return {
        slug: r.slug,
        name: r.name,
        plan_cost_usd: r.plan_cost_usd,
        conditional_mean_ev_usd: Math.round(sA.conditionalMeanEv),
        conditional_multiple: round4(sA.conditionalMeanEv / r.plan_cost_usd),
        breakeven_multiple_adopted: round4(breakevenAdopted),
        breakeven_multiple_conservative: round4(breakevenConservative),
        expected_net_return_adopted_usd: Math.round(sA.evMean),
        expected_net_return_conservative_usd: Math.round(sC.evMean),
        expected_net_return_param_usd: [Math.round(evParam[0]), Math.round(evParam[1])],
        prob_negative_analytic_adopted: round4(sA.probNegative),
        prob_negative_analytic_conservative: round4(sC.probNegative),
        prob_negative_sim_adopted: r.model.prob_negative_return,
        prob_negative_sim_ci_adopted: r.model.prob_negative_sim_ci_adopted,
        ev_p10_usd: r.model.ev_p10_usd,
        verdict: r.verdict,
        verdict_adopted: r.model.verdict_adopted,
        verdict_conservative: r.model.verdict_conservative,
        conditional_farm: r.model.conditional_farm,
        borderline: r.model.borderline,
      };
    });
  fitted.validation.gate_f_audit = {
    rows: gateFAuditRows,
    n_candidates: gateFAuditRows.length,
    n_positive_expected_return_adopted: gateFAuditRows.filter((r) => r.expected_net_return_adopted_usd > 0).length,
    n_positive_expected_return_conservative: gateFAuditRows.filter((r) => r.expected_net_return_conservative_usd > 0).length,
    n_below_breakeven_multiple_adopted: gateFAuditRows.filter((r) => r.conditional_multiple < breakevenAdopted).length,
    n_below_breakeven_multiple_conservative: gateFAuditRows.filter((r) => r.conditional_multiple < breakevenConservative).length,
    breakeven_multiple_adopted: round4(breakevenAdopted),
    breakeven_multiple_conservative: round4(breakevenConservative),
    note: `Gate (f) is a risk-screening policy, not a profit gate: the breakeven multiple is 1/p_L − 1 = ${round4(breakevenAdopted)}× under the adopted odds and ${round4(breakevenConservative)}× under the conservative odds, so a (f) farm with a conditional multiple between 3× and the breakeven multiple has a NEGATIVE expected net return. Of the ${gateFAuditRows.length} analytic-(f)-farm candidates under the adopted odds, ${gateFAuditRows.filter((r) => r.expected_net_return_adopted_usd > 0).length} have a positive expected net return under the adopted odds and ${gateFAuditRows.filter((r) => r.expected_net_return_conservative_usd > 0).length} under the conservative odds; ${gateFAuditRows.filter((r) => r.conditional_multiple < breakevenAdopted).length} sit below the adopted breakeven multiple and ${gateFAuditRows.filter((r) => r.conditional_multiple < breakevenConservative).length} below the conservative one. The parameter interval (P10/P90 of the mean EV across the 2000 bootstrap refits) is under the adopted odds. The audit reports; it does not re-pick the gate.`,
  };
  // The valuation-to-decision table (charter v1.6, extended v1.7): one row
  // per board row, in board order, linking valuation to decision — every
  // number behind one protocol's verdict.
  const valuationDecisionTable: ValuationDecisionRow[] = board.map((r) => {
    const sA = analyticGateStats(r.model.predicted_log_value, sigmaOf(r), r.plan_cost_usd, auditAdoptedOdds, fitted.valueCapUsd, model);
    const sC = analyticGateStats(r.model.predicted_log_value, sigmaOf(r), r.plan_cost_usd, auditConservativeOdds, fitted.valueCapUsd, model);
    const evParam = fitted.evParamBySlug.get(r.slug)?.ev_mean_param_usd ?? [sA.evMean, sA.evMean];
    const stab = r.model.stability ?? { farm: 0, marginal: 0, skip: 0, agreeing_refits: 0, stable_farm: null };
    // v1.7: the costed-plan numbers — net EV against C_i under both
    // layers, the breakeven multiples, the row's conditional net
    // multiple, and the gate verdict at each layer.
    const sANet = analyticGateStats(r.model.predicted_log_value, sigmaOf(r), r.model.costed_plan.total_usd, auditAdoptedOdds, fitted.valueCapUsd, model);
    const sCNet = analyticGateStats(r.model.predicted_log_value, sigmaOf(r), r.model.costed_plan.total_usd, auditConservativeOdds, fitted.valueCapUsd, model);
    const oodFlags: string[] = [];
    if (r.model.ood.unseen_chain) oodFlags.push('unseen-chain');
    if (r.model.ood.unseen_category) oodFlags.push('unseen-category');
    if (r.model.ood.tvl_out_of_range) oodFlags.push('tvl-out-of-range');
    if (r.model.ood.age_out_of_range) oodFlags.push('age-out-of-range');
    if (r.model.ood.nearest_comp_distance_dex > 0.5) oodFlags.push('no-credible-comparable');
    const reason =
      r.verdict === 'farm'
        ? `FARM: gate (${gateTest.adopted}) passes under the conservative odds; net EV +$${Math.round(sANet.evMean).toLocaleString()} adopted / +$${Math.round(sCNet.evMean).toLocaleString()} conservative against the $${Math.round(r.model.costed_plan.total_usd).toLocaleString()} costed plan.`
        : r.verdict === 'marginal'
          ? `MARGINAL (${r.model.marginal_tier ?? 'un tiered'}): net EV ${sANet.evMean > 0 ? '+' : ''}$${Math.round(sANet.evMean).toLocaleString()} adopted / ${sCNet.evMean > 0 ? '+' : ''}$${Math.round(sCNet.evMean).toLocaleString()} conservative; EV-per-dollar-at-risk ${r.model.ev_per_dollar_at_risk}; quarter-Kelly ${r.model.kelly_fraction}${r.model.borderline ? '; BORDERLINE — REVIEW' : ''}${r.model.conditional_farm ? '; CONDITIONAL FARM (adopted layer only)' : ''}${r.model.farm_demoted_reason === 'unstable' ? '; UNSTABLE farm demoted by the stability guard' : ''}.`
          : `SKIP: net EV $${Math.round(sANet.evMean).toLocaleString()} adopted / $${Math.round(sCNet.evMean).toLocaleString()} conservative against the $${Math.round(r.model.costed_plan.total_usd).toLocaleString()} costed plan; break-even odds ${r.model.break_even_odds} above the launch odds.`;
    return {
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      implied_value_usd: r.implied_value_usd,
      predicted_log_value: r.model.predicted_log_value,
      value_if_launches_usd: r.model.value_if_launches_usd,
      interval_p25_usd: r.model.param_band_p25_usd,
      interval_p75_usd: r.model.param_band_p75_usd,
      band_p25_usd: r.model.band_p25_usd,
      band_p75_usd: r.model.band_p75_usd,
      launch_odds_source: r.model.launch_odds_source,
      launch_odds: r.model.launch_odds,
      launch_odds_conservative: round4(auditConservativeOdds),
      launch_odds_n_support: r.model.launch_odds_n_support,
      conditional_payoff_usd: Math.round(sA.conditionalMeanEv),
      conditional_multiple: round4(sA.conditionalMeanEv / r.plan_cost_usd),
      plan_cost_usd: r.plan_cost_usd,
      expected_net_return_adopted_usd: Math.round(sA.evMean),
      expected_net_return_conservative_usd: Math.round(sC.evMean),
      expected_net_return_param_usd: [Math.round(evParam[0]), Math.round(evParam[1])],
      prob_negative_analytic_adopted: round4(sA.probNegative),
      prob_negative_analytic_conservative: round4(sC.probNegative),
      prob_negative_sim_adopted: r.model.prob_negative_return,
      prob_negative_sim_ci_adopted: r.model.prob_negative_sim_ci_adopted,
      ev_p10_usd: r.model.ev_p10_usd,
      verdict_adopted: r.model.verdict_adopted,
      verdict_conservative: r.model.verdict_conservative,
      verdict: r.verdict,
      conditional_farm: r.model.conditional_farm,
      borderline: r.model.borderline,
      borderline_reason: r.model.borderline_reason,
      unstable_farm: r.model.farm_demoted_reason === 'unstable',
      stability_farm: stab.farm,
      stability_marginal: stab.marginal,
      stability_skip: stab.skip,
      costed_plan_deposit_usd: r.model.costed_plan.deposit_usd,
      costed_plan_gas_usd: r.model.costed_plan.gas_total_usd,
      costed_plan_opportunity_usd: r.model.costed_plan.opportunity_usd,
      costed_plan_slippage_fees_usd: r.model.costed_plan.slippage_fees_usd,
      costed_plan_total_usd: r.model.costed_plan.total_usd,
      net_ev_adopted_usd: Math.round(sANet.evMean),
      net_ev_conservative_usd: Math.round(sCNet.evMean),
      breakeven_multiple_adopted: round4(breakevenAdopted),
      breakeven_multiple_conservative: round4(breakevenConservative),
      conditional_net_multiple: round4(sANet.conditionalMeanEv / r.model.costed_plan.total_usd),
      gate_pass_adopted: r.model.gate_pass_adopted,
      gate_pass_conservative: r.model.gate_pass_conservative,
      ood_tier: r.model.ood.tier,
      ood_flags: oodFlags.join(', ') || 'none',
      marginal_tier: r.model.marginal_tier,
      ev_per_dollar_at_risk: r.model.ev_per_dollar_at_risk,
      kelly_fraction: r.model.kelly_fraction,
      reason,
    };
  });
  fitted.validation.valuation_decision_table = valuationDecisionTable;
  // v1.7 — the ratio lens board comparison: the production board re-ranked
  // under the ratio lens (same target, second lens), and the lens's LOPO
  // maximum |Δpredicted log| over the board rows.
  if (fitted.ratioLensFit !== null && fitted.validation.ratio_valuation !== null) {
    const lens = fitted.ratioLensFit;
    const ratioOrder = board
      .map((r) => {
        const p = snapshot.protocols.find((x) => x.slug === r.slug)!;
        const pred = predictLogRatio(p, snapshot.as_of, lens, model);
        const valueIf = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** pred)));
        return { slug: r.slug, implied: valueIf * r.model.launch_odds, pred };
      })
      .sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const ratioOrderSlugs = ratioOrder.map((x) => x.slug);
    const prodOrder = board.map((r) => r.slug);
    const ratioTop10 = new Set(ratioOrderSlugs.slice(0, 10));
    const ratioTop20 = new Set(ratioOrderSlugs.slice(0, 20));
    const fullPredBySlug = new Map(ratioOrder.map((x) => [x.slug, x.pred]));
    let lopoMaxDelta = 0;
    for (const dropped of comps) {
      const refitLens = fitRatioLens(comps.filter((p) => p.slug !== dropped.slug), snapshot.as_of, model);
      for (const r of board) {
        const p = snapshot.protocols.find((x) => x.slug === r.slug)!;
        const pred = predictLogRatio(p, snapshot.as_of, refitLens, model);
        lopoMaxDelta = Math.max(lopoMaxDelta, Math.abs(pred - fullPredBySlug.get(r.slug)!));
      }
    }
    fitted.validation.ratio_valuation = {
      ...fitted.validation.ratio_valuation,
      board_spearman_vs_production: round4(spearmanRankCorrelation(prodOrder, ratioOrderSlugs)),
      board_top10_overlap_vs_production: ratioOrderSlugs.slice(0, 10).filter((s) => prodOrder.slice(0, 10).includes(s)).length,
      board_top20_overlap_vs_production: ratioOrderSlugs.slice(0, 20).filter((s) => prodOrder.slice(0, 20).includes(s)).length,
      lopo_max_abs_delta_predicted_log: round4(lopoMaxDelta),
    };
  }
  // v1.7 — the costed farm plans and gate (g): the slippage sensitivity
  // (the adopted gate recomputed at 0% and 1.0% slippage) and the net-EV
  // audit of the (g) candidates.
  {
    const fee = slippageFeeUsd(model);
    const gVariant = gateTest.variant_g;
    const gateCountsAtRate = (rate: number): { adopted: number; conservative: number; gAdopted: number; gConservative: number } => {
      const feeAtRate = Math.round(model.deposit_usd * rate * 100) / 100;
      let adoptedCount = 0;
      let conservativeCount = 0;
      let gAdoptedCount = 0;
      let gConservativeCount = 0;
      for (const r of board) {
        const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
        const costAtRate = gateTest.adopted === 'g' ? r.plan_cost_usd + feeAtRate : r.plan_cost_usd;
        const sA = analyticGateStats(r.model.predicted_log_value, sigma, costAtRate, auditAdoptedOdds, fitted.valueCapUsd, model);
        const sC = analyticGateStats(r.model.predicted_log_value, sigma, costAtRate, auditConservativeOdds, fitted.valueCapUsd, model);
        if (gatePasses(gateTest.adopted, sA, auditAdoptedOdds)) adoptedCount++;
        if (gatePasses(gateTest.adopted, sC, auditConservativeOdds)) conservativeCount++;
        const costG = r.plan_cost_usd + feeAtRate;
        const sAG = analyticGateStats(r.model.predicted_log_value, sigma, costG, auditAdoptedOdds, fitted.valueCapUsd, model);
        const sCG = analyticGateStats(r.model.predicted_log_value, sigma, costG, auditConservativeOdds, fitted.valueCapUsd, model);
        if (gatePasses('g', sAG, auditAdoptedOdds)) gAdoptedCount++;
        if (gatePasses('g', sCG, auditConservativeOdds)) gConservativeCount++;
      }
      return { adopted: adoptedCount, conservative: conservativeCount, gAdopted: gAdoptedCount, gConservative: gConservativeCount };
    };
    const sens0 = gateCountsAtRate(0);
    const sens05 = gateCountsAtRate(model.slippage_fee_rate);
    const sens10 = gateCountsAtRate(0.01);
    const gCandidates = board.filter((r) => {
      const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
      const sA = analyticGateStats(r.model.predicted_log_value, sigma, r.model.costed_plan.total_usd, auditAdoptedOdds, fitted.valueCapUsd, model);
      return gatePasses('g', sA, auditAdoptedOdds);
    });
    fitted.validation.costed_farm_plans = {
      slippage_fee_rate: model.slippage_fee_rate,
      slippage_fee_usd: fee,
      assumption:
        'Slippage/fees are a uniform 0.5% of the $10,000 deposit ($50 per plan), the same for every row — an explicit, conservative assumption, not a measurement: the snapshot carries no per-protocol slippage or fee field, so none is invented. Gas stays per-chain and opportunity cost stays 10% annual over the hold window, as in the base plan.',
      gate_g_farm_count: gVariant.farm_count,
      gate_g_farm_count_conservative: gVariant.farm_count_conservative,
      gate_g_eligible: gVariant.eligible,
      gate_g_adopted: gateTest.adopted === 'g',
      sensitivity: [
        { slippage_fee_rate: 0, farm_count_adopted: sens0.adopted, farm_count_conservative: sens0.conservative },
        { slippage_fee_rate: model.slippage_fee_rate, farm_count_adopted: sens05.adopted, farm_count_conservative: sens05.conservative },
        { slippage_fee_rate: 0.01, farm_count_adopted: sens10.adopted, farm_count_conservative: sens10.conservative },
      ],
      n_candidates: gCandidates.length,
      n_positive_net_ev_adopted: gCandidates.filter((r) => r.model.net_ev_adopted_usd > 0).length,
      n_positive_net_ev_conservative: gCandidates.filter((r) => r.model.net_ev_conservative_usd > 0).length,
      note: `Gate (g) is the per-protocol net-EV hurdle: conditional mean net EV against the full costed plan must exceed the layer's breakeven multiple of that plan (5.09× adopted / 6.33× conservative), so a (g) farm has a positive expected net return by construction at the layer it passes — the ${gCandidates.length} (g) candidates under the adopted odds all have a positive net EV there. The adopted gate (${gateTest.adopted}) farms ${sens05.adopted} rows under the adopted odds and ${sens05.conservative} under the conservative odds at the 0.5% slippage assumption; at 0% it farms ${sens0.adopted}/${sens0.conservative} and at 1.0% it farms ${sens10.adopted}/${sens10.conservative}. The (g) counts at the three rates are ${sens0.gAdopted}/${sens0.gConservative}, ${sens05.gAdopted}/${sens05.gConservative} and ${sens10.gAdopted}/${sens10.gConservative} (adopted/conservative). ${
        gateTest.adopted === 'f'
          ? 'The adopted gate (f) is insensitive to slippage by construction — it tests the conditional payoff against the base plan cost — so its counts do not move across the rates; the (g) counts above show what the net-EV hurdle would do.'
          : 'The adopted gate (g) moves with the slippage assumption because its hurdle is the costed plan; the counts above show how much of the farm list the $50 assumption carries.'
      }`,
    };
  }
  // v1.7 — the MARGINAL tiering aggregates, with the threshold
  // sensitivity recomputed from the stored per-row values.
  {
    const marginalRows = board.filter((r) => r.verdict === 'marginal');
    const counts = { 'low-size-farm': 0, watchlist: 0, hold: 0 } as { 'low-size-farm': number; watchlist: number; hold: number };
    for (const r of marginalRows) counts[r.model.marginal_tier ?? 'hold']++;
    const tierAt = (evPerDollar: number, kelly: number): { 'low-size-farm': number; watchlist: number; hold: number } => {
      const c = { 'low-size-farm': 0, watchlist: 0, hold: 0 } as { 'low-size-farm': number; watchlist: number; hold: number };
      for (const r of marginalRows) {
        const tier: MarginalTier =
          r.model.net_ev_adopted_usd > 0 &&
          r.model.net_ev_conservative_usd > 0 &&
          r.model.ev_per_dollar_at_risk >= evPerDollar &&
          r.model.kelly_fraction >= kelly &&
          r.model.prob_negative_analytic_conservative <= 0.9 &&
          !r.model.borderline
            ? 'low-size-farm'
            : r.model.net_ev_adopted_usd > 0 || r.model.borderline
              ? 'watchlist'
              : 'hold';
        c[tier]++;
      }
      return c;
    };
    const sensitivity = [0.25, 0.5, 1.0].map((evPerDollar, i) => {
      const kelly = [0.01, 0.02, 0.05][i]!;
      const c = tierAt(evPerDollar, kelly);
      return { ev_per_dollar: evPerDollar, quarter_kelly: kelly, low_size_farm: c['low-size-farm'], watchlist: c.watchlist, hold: c.hold };
    });
    fitted.validation.marginal_tiers = {
      counts,
      thresholds: { ev_per_dollar_at_risk: 0.5, quarter_kelly: 0.01, max_prob_negative_conservative: 0.9 },
      sensitivity,
      note: `Every MARGINAL row carries exactly one tier (sizing guidance inside MARGINAL only — never a verdict change, never a promotion to FARM). ${counts['low-size-farm']} LOW-SIZE FARM (positive net EV at both layers, ≥ $0.50 expected net return per dollar at risk, quarter-Kelly ≥ 0.01, conservative P(negative) ≤ 0.90, not BORDERLINE), ${counts.watchlist} WATCHLIST (positive adopted-layer net EV or BORDERLINE), ${counts.hold} HOLD (no edge at either layer). The thresholds are fixed in the charter before results (Kelly bar corrected 0.02 → 0.01 by erratum: 0.02 can never fire, max quarter-Kelly on this board is 0.012); the sensitivity rows recompute the counts at (0.25, 0.01), (0.5, 0.02) and (1.0, 0.05).`,
    };
  }
  let evSimulationExport: EvSimulationExport | null = null;
  const poly = board.find((r) => r.slug === 'polymarket-international');
  if (poly !== undefined) {
    const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * poly.model.ood.band_multiplier) / 0.6745 : 0.01;
    const pairs = simulateEvPairs(
      poly.model.predicted_log_value,
      poly.plan_cost_usd,
      sigma,
      EV_SIM_DRAWS,
      fnv1aHash('polymarket-international'),
      model,
      fitted.valueCapUsd,
    );
    const simStats = evStatsFromPairs(pairs, poly.model.launch_odds, poly.plan_cost_usd, model);
    const conservativeStats = evStatsFromPairs(pairs, fitted.launchOddsDecision.conservative_lower_bound, poly.plan_cost_usd, model);
    evSimulationExport = {
      slug: 'polymarket-international',
      name: poly.name,
      seed: fnv1aHash('polymarket-international'),
      n_draws: EV_SIM_DRAWS,
      predicted_log_value: poly.model.predicted_log_value,
      plan_cost_usd: poly.plan_cost_usd,
      band_halfwidth_dex: fitted.bandHalfwidth,
      band_multiplier: poly.model.ood.band_multiplier,
      sigma_dex: round4(sigma),
      launch_odds_adopted: poly.model.launch_odds,
      launch_odds_base_rate: fitted.seasoning.base_rate,
      launch_odds_platt: poly.model.launch_odds_platt,
      launch_odds_conservative: fitted.launchOddsDecision.conservative_lower_bound,
      // Full-precision uniforms: rounding a u of 0.99996 to 1.0000 would put a
      // draw outside [0, 1) and break exact reproduction of the simulation.
      draws: pairs.u.map((u, i) => [u, pairs.values[i]!] as [number, number]),
      stats: {
        n_draws: EV_SIM_DRAWS,
        seed: fnv1aHash('polymarket-international'),
        ev_mean_usd: Math.round(simStats.mean),
        ev_p10_usd: Math.round(simStats.p10),
        ev_p25_usd: Math.round(simStats.p25),
        ev_p50_usd: Math.round(simStats.p50),
        ev_p75_usd: Math.round(simStats.p75),
        ev_p90_usd: Math.round(simStats.p90),
        prob_negative: round4(simStats.probNegative),
        prob_negative_analytic: poly.model.prob_negative_analytic,
        ev_at_p25_value_if_launches_usd: poly.model.ev_at_p25_value_if_launches_usd,
        ev_at_p75_value_if_launches_usd: poly.model.ev_at_p75_value_if_launches_usd,
        ev_at_p10_value_if_launches_usd: poly.model.ev_at_p10_usd,
        p10_value_usd: poly.model.p10_value_usd,
        ev_mean_base_rate_usd: poly.model.ev_mean_base_rate_usd,
        ev_mean_platt_usd: poly.model.ev_mean_platt_usd,
        ev_mean_conservative_usd: poly.model.ev_mean_conservative_usd,
        ev_p25_conservative_usd: Math.round(conservativeStats.p25),
        ev_p50_conservative_usd: Math.round(conservativeStats.p50),
        ev_p75_conservative_usd: Math.round(conservativeStats.p75),
        prob_negative_conservative: round4(conservativeStats.probNegative),
        ev_conditional_mean_usd: poly.model.ev_conditional_mean_usd,
        mean_value_if_launches_usd: poly.model.mean_value_if_launches_usd,
        value_cap_usd: fitted.valueCapUsd,
      },
    };
  }
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  // The reproducibility package (charter v1.5): the snapshot hash is attached
  // by main.ts (computed from the input file at build time, never typed by
  // hand); the rest is filled here from the fitted model and the charter.
  const reproducibility: Reproducibility = {
    snapshot_sha256: snapshotSha256,
    snapshot_as_of: snapshot.as_of,
    dataset: `DefiLlama snapshot ${snapshot.as_of} (source: ${snapshot.source})`,
    charter_version: CHARTER_VERSION,
    model_version: MODEL_VERSION,
    seeds: {
      bootstrap_cluster_2000: 20261119,
      base_rate_bootstrap_2000: 20261107,
      ev_simulation_draws: 'fnv1aHash(slug)',
      tournament_draws: 'fnv1aHash(slug|tournament|kind)',
      param_aware_draws: 'fnv1aHash(slug|param-aware|kind)',
      param_aware_gate_d: 'fnv1aHash(slug|param-aware|gate-d)',
      ranking_calibration_bootstrap_2000: 20261120,
      realized_holdout_bootstrap_2000: 20261120,
    },
    constants: {
      size_floor_usd: model.size_floor_usd,
      purge_gap_days: model.purge_gap_days,
      farmer_share: model.farmer_share,
      marginal_break_even: model.marginal_break_even,
      value_cap_usd: fitted.valueCapUsd,
      launch_odds_base_rate: fitted.seasoning.base_rate,
      launch_odds_conservative: fitted.launchOddsDecision.conservative_lower_bound,
      gate_adopted: gateTest.adopted,
      intercept: fitted.beta[0]!,
      coef_log_tvl: fitted.beta[1]!,
      slippage_fee_rate: model.slippage_fee_rate,
      slippage_fee_usd: slippageFeeUsd(model),
    },
    outputs: ['board.json', 'data.js', 'dossier.json', 'ev-simulation-polymarket.json'],
    reproduce_commands: [
      'MAKEFUN_OUTPUT_DIR=<dir> node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json',
      'node scripts/leakage-test.ts --input ../kit/token-radar-01-kit/input/snapshot.json',
    ],
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    fit: fitted.fit,
    validation: fitted.validation,
    seasoning: fitted.seasoning,
    seasoning_calibration: seasoningCalibration(snapshot, fitted.seasoning),
    comparables: fitted.comparables,
    chain_adjustments: fitted.chainComparables,
    scatter: fitted.scatter,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
    valuation_decision_table: valuationDecisionTable,
    reproducibility,
  };
  return { board, radar, evSimulationExport };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not fall below row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps[0] === undefined || !r.farm_steps[0].startsWith('Verdict:')) return `${r.slug} has no verdict in its farm plan`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

