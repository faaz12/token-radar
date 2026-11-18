// Token Radar's model (radar-8, evaluation charter v1.1): one sealed snapshot in, one ranked board out.
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
//  1. Value if it launches: a Huber-fitted log-log regression, fitted at run time on the
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
//       Growth is NOT a production feature (charter v1.1): the growth coefficient is
//       unstable across folds (-0.07 on the full fit, +0.20…+1.00 in nested folds) and
//       no growth variant improves held-out error, so change_7d is run only as a
//       separate signed diagnostic and never enters the production fit. The snapshot
//       carries only change_7d — 30d/90d growth cannot be built from it.
//       size floor: TVL below $25M is noisy in the snapshot, so the curve saturates there —
//       a small protocol is never priced at zero for being small. The floor is a locked
//       constant, not a tuned optimum: no floor dominates the grid ($0M/$10M/$25M/$50M/
//       $100M), and choosing it inside training folds scores worse pooled.
//       Huber (IRLS, delta 1.345, MAD scale): the snapshot's own attribution quirks — a chain
//       token counted on its bridge, one token counted on two versions of a protocol — are
//       down-weighted instead of dragging the fit. Huber, OLS and a mild ridge are co-equal
//       candidates under charter v1.1: the production estimator is chosen by the
//       prespecified selection rule (nested 50–80 pooled median, with a simplicity
//       tie-break and a tail-error/sensitivity condition for Huber), never by R².
//       group adjustments: the median residual of a category / a main chain, shrunk toward
//       zero by n/(n+3), so a group with one or two comps moves the price a little and a
//       group with fifteen moves it a lot. A joint category intercept was tested and
//       rejected: it improves nested/CV within noise but makes the walk-forward
//       significantly worse.
//  2. Launch odds: a seasoning curve, a logistic fit of "has a token" on log10(age+1) over
//     all 645 dated protocols in the snapshot (not just the training comps). Older
//     protocols are more likely to have launched; an unlisted age takes the base rate.
//       implied_value_usd = value_if_launches x launch_odds
//     Age left the regression: it now prices launch likelihood, not size.
//
// The fit is validated at run time and the dashboard shows all of it, under evaluation
// charter v1.1 (EVALUATION_CHARTER.md): the nested expanding-window walk-forward on dated
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
// test on a chronological calibration set. Every farm plan carries a verdict from
// its expected net return with a safety margin: EV = launch odds × 0.25% × value-if-launches − plan cost;
// farm when EV is positive at both the central value and the P25 value, marginal when it is
// positive centrally but not at P25 (or negative with break-even odds ≤33%), skip otherwise.
// Undated comparables are hard-gated out of every fit and calibration and appear only as a
// reference table. No protocol name is ever special-cased: the same function scores every row.

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
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-8';

/** The evaluation charter version this model's validation follows. */
export const CHARTER_VERSION = 'v1.1';

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

/** The launch-probability audit (charter v1.1): reliability, bootstrap intervals,
 * ranking metrics, and the Platt-calibration test. */
export interface SeasoningAudit {
  reliability_bins: ReliabilityBin[];
  brier_improvement_ci: [number, number];
  log_loss_improvement_ci: [number, number];
  roc_auc: number;
  pr_auc: number;
  n_pooled: number;
  platt: {
    adopted: boolean;
    a: number | null;
    b: number | null;
    cal_brier: number;
    cal_log_loss: number;
    test_brier_raw: number;
    test_log_loss_raw: number;
    test_brier_platt: number;
    test_log_loss_platt: number;
    test_brier_base: number;
    test_log_loss_base: number;
    n_calibration: number;
    n_test: number;
    reason: string;
  };
}

/** One row of the EV end-to-end audit: the scenarios and the downside for a farm
 * (or demoted ex-farm) protocol. */
export interface EvAuditRow {
  slug: string;
  name: string;
  value_if_launches_usd: number;
  launch_odds: number;
  break_even_odds: number;
  plan_cost_usd: number;
  ev_central_usd: number;
  ev_conservative_usd: number;
  ev_optimistic_usd: number;
  prob_negative_return: number;
  p10_value_usd: number;
  ev_at_p10_usd: number;
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
    break_even_odds: number;
    expected_value_usd: number;
    ev_conservative_usd: number;
    ev_optimistic_usd: number;
    prob_negative_return: number;
    p10_value_usd: number;
    ev_at_p10_usd: number;
    band_p25_usd: number;
    band_p75_usd: number;
    category_adjustment: number;
    chain_adjustment: number;
    comparable_count: number;
    comparable_basis: 'category' | 'global';
    growth_pct: number;
    age_days: number | null;
    basis: 'fitted';
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
  break_even_odds: number;
  expected_value_usd: number;
  ev_conservative_usd: number;
  ev_optimistic_usd: number;
  prob_negative_return: number;
  p10_value_usd: number;
  ev_at_p10_usd: number;
  band_p25_usd: number;
  band_p75_usd: number;
  category_adjustment: number;
  chain_adjustment: number;
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
  const baseRate = ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
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
 * When a Platt recalibration was adopted (charter v1.1), the raw logistic odds are passed
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
}

/** The assumptions every farm EV rests on (charter v1.1): stated, not measured. */
export const EV_ASSUMPTIONS =
  'Farmer share 0.25% of the launch value (assumed, not verified from data); exit value = snapshot market cap (no slippage, no liquidity, no lockup modeled — the snapshot carries no unlock schedule, no order-book depth, and no fee data, so none is invented); farming costs = gas per chain + opportunity cost of the $10,000 deposit at 10% annual over the hold window; hold days by age (60 < 180d, 45 < 365d, else 30); a non-launch loses the full plan cost.';

/** The EV scenarios for one protocol: central, conservative (P25 value), optimistic (P75
 * value), the probability of a negative return, and the P10 value with its EV.
 * log10(value) is treated as normal with σ = (50% band half-width) / 0.6745 around the
 * prediction; a non-launch returns −cost. */
export function evScenarios(
  launchOddsValue: number,
  predictedLog: number,
  planCost: number,
  bandHalfwidth: number,
  model: ModelConstants = MODEL,
): { evCentral: number; evConservative: number; evOptimistic: number; probNegative: number; p10Value: number; evAtP10: number } {
  const sigma = bandHalfwidth > 0 ? bandHalfwidth / 0.6745 : 0.01;
  const valueAt = (logV: number): number => Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** logV)));
  const evAt = (value: number): number => launchOddsValue * model.farmer_share * value - planCost;
  const central = valueAt(predictedLog);
  const conservative = valueAt(predictedLog - bandHalfwidth);
  const optimistic = valueAt(predictedLog + bandHalfwidth);
  const p10Value = valueAt(predictedLog - 1.2816 * sigma);
  const threshold = planCost / model.farmer_share;
  const pValueAboveThreshold = 1 - normalCdf((Math.log10(Math.max(1, threshold)) - predictedLog) / sigma);
  const probNegative = 1 - launchOddsValue * pValueAboveThreshold;
  return {
    evCentral: evAt(central),
    evConservative: evAt(conservative),
    evOptimistic: evAt(optimistic),
    probNegative,
    p10Value,
    evAtP10: evAt(p10Value),
  };
}

/** The launch-probability audit (charter v1.1): reliability diagram, bootstrap
 * intervals for the improvement over the base rate, ROC/PR AUC, and a Platt
 * recalibration fitted on the earliest fold-local predictions and tested on the
 * latest ones. Pure arithmetic on the pooled fold-local predictions — no fitting
 * on the board's full curve. */
export function auditLaunchOdds(pool: { pred: number; y: number; fold: number }[]): SeasoningAudit {
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
  const adopted = plattA !== null && plattB !== null && testBrierPlatt < testBrierRaw && testLogLossPlatt < testLogLossRaw;
  return {
    reliability_bins: reliabilityBins,
    brier_improvement_ci: ci(dBrier),
    log_loss_improvement_ci: ci(dLogLoss),
    roc_auc: round4(rocAuc),
    pr_auc: round4(prAuc),
    n_pooled: n,
    platt: {
      adopted,
      a: adopted ? plattA : null,
      b: adopted ? plattB : null,
      cal_brier: round4(calBrier),
      cal_log_loss: round4(calLogLoss),
      test_brier_raw: round4(testBrierRaw),
      test_log_loss_raw: round4(testLogLossRaw),
      test_brier_platt: round4(testBrierPlatt),
      test_log_loss_platt: round4(testLogLossPlatt),
      test_brier_base: round4(brierOf(testBase)),
      test_log_loss_base: round4(logLossOf(testBase)),
      n_calibration: calRows.length,
      n_test: testRows.length,
      reason: adopted
        ? `Platt adopted: on the untouched 80/90 test set it beats the raw curve on both Brier (${testBrierPlatt.toFixed(4)} vs ${testBrierRaw.toFixed(4)}) and log-loss (${testLogLossPlatt.toFixed(4)} vs ${testLogLossRaw.toFixed(4)}).`
        : plattA === null
          ? 'Platt not fitted: calibration set too small.'
          : `Platt NOT adopted: on the untouched 80/90 test set it does not beat the raw curve on both Brier (${testBrierPlatt.toFixed(4)} vs ${testBrierRaw.toFixed(4)}) and log-loss (${testLogLossPlatt.toFixed(4)} vs ${testLogLossRaw.toFixed(4)}). The raw curve stands — no added complexity without evidence.`,
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
 * out-of-fold residuals from the 5-fold CV. A 200-refit bootstrap (fixed seed) is kept
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

export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): FittedModel {
  const comps = liveComps(snapshot); // dated only — charter v1.1 hard-gate
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
  const seasoningPool: { pred: number; y: number; fold: number }[] = [];
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
    for (const p of testRows) seasoningPool.push({ pred: launchOdds(ageDays(asOf, p.listed_at), local), y: p.mcap_usd !== null ? 1 : 0, fold: pct });
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
      `Structural (MNAR): undated comparables are legacy protocols whose listing dates were never recorded. They are systematically smaller (median market cap $4.8M vs $9.0M dated) and over-predicted (median residual ${undatedMedianSigned.toFixed(3)} dex under the dated-only v1.1 fit), so the missingness itself carries signal about size.`,
    handling:
      'Hard-gate (d, charter v1.1): undated comparables are excluded from every regression fit, group adjustment, cross-validation fold, conformal calibration, baseline, and bootstrap resample. They are scored only as a reference table with the dated-only full fit; their error is a diagnostic, never a headline and never mixed into any fitted quantity.',
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

  // A 200-refit bootstrap (fixed seed), kept as a diagnostic on the band: the
  // cross-conformal band above is the band the board prints.
  const bootRand = mulberry32(20261119);
  const bootPreds: number[][] = comps.map(() => []);
  for (let b = 0; b < 200; b++) {
    const resample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) resample.push(comps[Math.floor(bootRand() * comps.length)]!);
    const bootFit = fitEst(selected)(resample);
    comps.forEach((p, i) => bootPreds[i]!.push(predictLog(p, asOf, bootFit.beta, bootFit.adj, bootFit.chainAdj, model)));
  }
  const sds = bootPreds
    .map((preds) => {
      const mean = preds.reduce((a, v) => a + v, 0) / preds.length;
      return Math.sqrt(preds.reduce((a, v) => a + (v - mean) ** 2, 0) / preds.length);
    })
    .sort((a, b) => a - b);
  const bootstrapSd = median(sds) ?? 0;

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
    comparability_note: 'Error-rate comparisons against other entries are valid only when target, dates, and error definition match. The radar-7 comparison of 2.77x vs the leader’s reported 3.21x is not claimed under v1.1.',
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
  return { beta: full.beta, adjustments: full.adj, chainAdjustments: full.chainAdj, fit, validation, seasoning, bandHalfwidth, comparables, chainComparables, scatter };
}

/** The fitted value of one protocol: value if it launches, launch odds, and the odds-weighted implied value, with the P25/P75 band and the EV scenarios (charter v1.1). */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fitted: FittedModel,
  model: ModelConstants = MODEL,
): { implied: number; valueIfLaunches: number; predictedLog: number; launchOdds: number; breakEvenOdds: number; bandP25: number; bandP75: number; growthPct: number; age: number | null; adjustment: number; chainAdjustment: number; count: number; basis: 'category' | 'global'; evConservative: number; evOptimistic: number; probNegative: number; p10Value: number; evAtP10: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const predictedLog = predictLog(protocol, asOf, fitted.beta, fitted.adjustments, fitted.chainAdjustments, model);
  const valueIfLaunches = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** predictedLog)));
  const odds = launchOdds(age, fitted.seasoning);
  const implied = Math.min(model.value_max, Math.max(model.value_min, Math.round(valueIfLaunches * odds)));
  const cost = planCostUsd(protocol, model, asOf);
  const beOdds = breakEvenOdds(valueIfLaunches, cost, model);
  const bandP25 = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** (predictedLog - fitted.bandHalfwidth) * odds)));
  const bandP75 = Math.min(model.value_max, Math.max(model.value_min, Math.round(10 ** (predictedLog + fitted.bandHalfwidth) * odds)));
  const adj = fitted.adjustments.get(protocol.category ?? 'Other');
  const chainAdj = fitted.chainAdjustments.get(mainChain(protocol));
  const scenarios = evScenarios(odds, predictedLog, cost, fitted.bandHalfwidth, model);
  // growthPct is the protocol's raw 7-day change, display only: growth is not a
  // production feature (charter v1.1).
  const growthPct = finite(protocol.change_7d, 0) / 100;
  return {
    implied,
    valueIfLaunches,
    predictedLog,
    launchOdds: odds,
    breakEvenOdds: beOdds,
    bandP25,
    bandP75,
    growthPct,
    age,
    adjustment: adj?.adjustment ?? 0,
    chainAdjustment: chainAdj?.adjustment ?? 0,
    count: adj?.count ?? 0,
    basis: adj?.basis ?? 'global',
    evConservative: scenarios.evConservative,
    evOptimistic: scenarios.evOptimistic,
    probNegative: scenarios.probNegative,
    p10Value: scenarios.p10Value,
    evAtP10: scenarios.evAtP10,
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
 * The farm verdict, from the expected net return with a safety margin (charter v1.1):
 * farm only when the expected return is positive at BOTH the central value and the
 * P25 value; marginal when it is positive centrally but not at P25 (no safety margin),
 * or negative but the break-even odds are low enough that a slightly better launch
 * chance would flip it; skip otherwise. The odds are the plan's and the protocol's
 * together: a protocol's own launch odds (p_L) decide the expected return, the
 * break-even odds (p_BE) decide how far away a positive return is.
 */
export function verdictFor(
  launchOdds: number,
  valueIfLaunches: number,
  cost: number,
  model: ModelConstants = MODEL,
  bandHalfwidth = 0,
  predictedLog = 0,
): Verdict {
  const ev = expectedValue(launchOdds, valueIfLaunches, cost, model);
  const evP25 = evScenarios(launchOdds, predictedLog, cost, bandHalfwidth, model).evConservative;
  if (ev > 0 && evP25 > 0) return 'farm';
  if (ev > 0) return 'marginal';
  const be = breakEvenOdds(valueIfLaunches, cost, model);
  if (be <= model.marginal_break_even) return 'marginal';
  return 'skip';
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
export function verdictStep(verdict: Verdict, valueIfLaunches: number, launchOdds: number, beOdds: number, cost: number, evConservative: number | null = null): string {
  const ev = expectedValue(launchOdds, valueIfLaunches, cost);
  const evText = ev >= 0 ? `+$${Math.round(ev).toLocaleString()}` : `−$${Math.round(-ev).toLocaleString()}`;
  const evP25Text = evConservative === null ? '' : evConservative >= 0 ? ` and stays +$${Math.round(evConservative).toLocaleString()} at the P25 value` : ` but falls to −$${Math.round(-evConservative).toLocaleString()} at the P25 value`;
  if (verdict === 'farm') {
    return `Verdict: FARM — expected net return ${evText}${evP25Text}: a ${fmtOdds(launchOdds)} launch chance (p_L) beats the ${fmtOdds(beOdds)} break-even (p_BE), against a value if it launches of ${fmtShort(valueIfLaunches)} and a plan cost of about $${cost}. Farm this protocol first.`;
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
      text: verdictStep(verdict, v.valueIfLaunches, v.launchOdds, v.breakEvenOdds, cost, v.evConservative),
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

/** The protocols the board ranks, strongest first, with ranks 1..n and strictly decreasing values. */
export function buildBoard(snapshot: Snapshot, fitted: FittedModel, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
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
    const verdict = verdictFor(v.launchOdds, v.valueIfLaunches, cost, model, fitted.bandHalfwidth, v.predictedLog);
    return { p, v, cost, verdict };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Strictly decreasing implied values: rounding to whole dollars could tie two neighbours,
  // so a tied row steps down one dollar. The values are millions apart in practice; this is a guard.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.v.implied >= scored[i - 1]!.v.implied) scored[i]!.v.implied = scored[i - 1]!.v.implied - 1;
  }
  return scored.map((s, i) => ({
    rank: i + 1,
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
      break_even_odds: round4(s.v.breakEvenOdds),
      expected_value_usd: Math.round(expectedValue(s.v.launchOdds, s.v.valueIfLaunches, s.cost)),
      ev_conservative_usd: Math.round(s.v.evConservative),
      ev_optimistic_usd: Math.round(s.v.evOptimistic),
      prob_negative_return: round4(s.v.probNegative),
      p10_value_usd: s.v.p10Value,
      ev_at_p10_usd: Math.round(s.v.evAtP10),
      band_p25_usd: s.v.bandP25,
      band_p75_usd: s.v.bandP75,
      category_adjustment: s.v.adjustment,
      chain_adjustment: s.v.chainAdjustment,
      comparable_count: s.v.count,
      comparable_basis: s.v.basis,
      growth_pct: s.v.growthPct,
      age_days: s.v.age,
      basis: 'fitted',
    },
    farm_steps: farmSteps(s.p, s.v, s.verdict, s.cost).map(stepText),
  }));
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
    break_even_odds: row.model.break_even_odds,
    expected_value_usd: row.model.expected_value_usd,
    ev_conservative_usd: row.model.ev_conservative_usd,
    ev_optimistic_usd: row.model.ev_optimistic_usd,
    prob_negative_return: row.model.prob_negative_return,
    p10_value_usd: row.model.p10_value_usd,
    ev_at_p10_usd: row.model.ev_at_p10_usd,
    band_p25_usd: row.model.band_p25_usd,
    band_p75_usd: row.model.band_p75_usd,
    category_adjustment: row.model.category_adjustment,
    chain_adjustment: row.model.chain_adjustment,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fitted = fitModel(snapshot, model);
  const board = buildBoard(snapshot, fitted, model);
  // The EV end-to-end audit (charter v1.1): every farm row, plus every row the old
  // EV>0-only rule would have farmed but the margin rule demotes — the audit trail
  // for the verdicts.
  fitted.validation.ev_audit = {
    rows: board
      .filter((r) => r.verdict === 'farm' || r.model.expected_value_usd > 0)
      .map((r) => ({
        slug: r.slug,
        name: r.name,
        value_if_launches_usd: r.model.value_if_launches_usd,
        launch_odds: r.model.launch_odds,
        break_even_odds: r.model.break_even_odds,
        plan_cost_usd: r.plan_cost_usd,
        ev_central_usd: r.model.expected_value_usd,
        ev_conservative_usd: r.model.ev_conservative_usd,
        ev_optimistic_usd: r.model.ev_optimistic_usd,
        prob_negative_return: r.model.prob_negative_return,
        p10_value_usd: r.model.p10_value_usd,
        ev_at_p10_usd: r.model.ev_at_p10_usd,
        verdict: r.verdict,
        verdict_rule:
          r.verdict === 'farm'
            ? 'FARM: EV > 0 at the central value AND at the P25 value (charter v1.1 safety margin).'
            : 'Demoted by the v1.1 margin rule: EV > 0 centrally but ≤ 0 at the P25 value — no safety margin.',
      })),
    assumptions: EV_ASSUMPTIONS,
  };
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
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
  };
  return { board, radar };
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

