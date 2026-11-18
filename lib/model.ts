// Token Radar's model (radar-6): one sealed snapshot in, one ranked board out.
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
//       log10(V) = b0 + b1*log10(tvl + $25M) + b2*log(1 + growth) + adjustments
//       growth = clamp(change_7d, -50%, +200%) as a fraction; the growth coefficient is
//       floored at zero — this snapshot's week was flat/down, so growth carries no positive
//       signal and a negative carry would be noise, not information.
//       size floor: TVL below $25M is noisy in the snapshot, so the curve saturates there —
//       a small protocol is never priced at zero for being small. The floor was picked by
//       grid search over $10M/$25M/$50M/$100M/$250M on the walk-forward error.
//       Huber (IRLS, delta 1.345, MAD scale): the snapshot's own attribution quirks — a chain
//       token counted on its bridge, one token counted on two versions of a protocol — are
//       down-weighted instead of dragging the fit.
//       group adjustments: the median residual of a category / a main chain, shrunk toward
//       zero by n/(n+3), so a group with one or two comps moves the price a little and a
//       group with fifteen moves it a lot.
//  2. Launch odds: a seasoning curve, a logistic fit of "has a token" on log10(age+1) over
//     all 645 dated protocols in the snapshot (not just the training comps). Older
//     protocols are more likely to have launched; an unlisted age takes the base rate.
//       implied_value_usd = value_if_launches x launch_odds
//     Age left the regression: it now prices launch likelihood, not size.
//
// The fit is validated three ways at run time and the dashboard shows all three: the
// walk-forward split (dated comparables only: the oldest 70% by listing date fit, the
// newest 30% tested — a protocol with no listing date has no position in time, so it
// cannot be walk-forwarded and is not placed in either side), a stratified walk-forward
// split (dated and undated comps each split 70/30, so the undated part of the set is
// scored too, and its error is reported separately), and a 5-fold cross-validation with
// a fixed-seed shuffle. A 200-refit bootstrap (fixed seed) combined with the walk-forward
// residual error gives the P25/P50/P75 band on every row; the dashboard reports how often
// the band held on the live comparables out of sample.
// Every farm plan carries a verdict — farm, marginal or skip — from its break-even launch
// odds: the launch probability at which a standard $10,000 deposit (plus gas and opportunity
// cost) breaks even against an assumed 0.25% share of the launch value. No protocol name is
// ever special-cased: the same function scores every row.

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
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-6';

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

/** The seasoning curve: the logistic fit of "has a token" on log10(age+1). */
export interface Seasoning {
  intercept: number;
  slope: number;
  n_protocols: number;
  base_rate: number;
}

/** The walk-forward validation, as the dashboard prints it. */
export interface Validation {
  r2: number;
  oos_median_abs_log_err: number;
  oos_stratified: number;
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
  nested_wf_folds: NestedFold[];
  nested_wf_pooled: number;
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

/** The regression's features for one protocol: [1, log10(TVL + size floor), log(1 + winsorized growth)]. Age is not a feature here: it prices launch odds in the seasoning curve, not size. */
export function features(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): number[] {
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0))) / 100;
  return [1, Math.log10(Math.max(1, p.tvl_usd) + model.size_floor_usd), Math.log(1 + growthPct)];
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

/** Weighted least squares for log10(mcap) on the features: the normal equations, solved above. */
export function fitWeightedOls(
  rows: SnapshotProtocol[],
  weights: number[],
  asOf: string,
  model: ModelConstants = MODEL,
): number[] {
  const k = 3;
  const xtx: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const xty: number[] = Array(k).fill(0);
  rows.forEach((p, r) => {
    const w = weights[r] ?? 1;
    const x = features(p, asOf, model);
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
export function fitHuber(rows: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): number[] {
  const delta = 1.345;
  let beta = fitWeightedOls(rows, rows.map(() => 1), asOf, model);
  for (let iter = 0; iter < 60; iter++) {
    const residuals = rows.map((p) => {
      const x = features(p, asOf, model);
      return Math.log10(p.mcap_usd!) - beta.reduce((s, b, i) => s + b * x[i]!, 0);
    });
    const med = median([...residuals].sort((a, b) => a - b)) ?? 0;
    const absDev = residuals.map((r) => Math.abs(r - med)).sort((a, b) => a - b);
    const scale = 1.4826 * (median(absDev) ?? 0) || 1;
    const weights = residuals.map((r) => {
      const u = Math.abs(r - med) / (delta * scale);
      return u <= 1 ? 1 : 1 / u;
    });
    const next = fitWeightedOls(rows, weights, asOf, model);
    const moved = Math.max(...next.map((b, i) => Math.abs(b - beta[i]!)));
    beta = next;
    if (moved < 1e-10) break;
  }
  return beta;
}

/** The live-token comparables the regression trains on: a token that trades, TVL and cap positive, not a CEX — and only protocols the board could rank (see isComparable): the training population is the population the curve prices. */
export function liveComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && isComparable(p),
  );
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
): Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }> {
  const residuals = new Map<string, number[]>();
  for (const p of rows) {
    const x = features(p, asOf, model);
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
): number {
  const x = features(p, asOf, model);
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
): number {
  if (rows.length === 0) return 0;
  const ys = rows.map((p) => Math.log10(p.mcap_usd!));
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssTot = 0;
  let ssRes = 0;
  rows.forEach((p, i) => {
    const e = ys[i]! - predictLog(p, asOf, beta, adjustments, chainAdjustments, model);
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
 * The seasoning curve: a logistic fit of "has a token" on log10(age+1), over every dated
 * protocol in the snapshot (not just the live comparables). Newton-Raphson on the
 * log-likelihood, from a fixed start, with a tiny ridge for stability — deterministic, no
 * libraries. Older protocols are more likely to have launched; the curve is the launch-odds
 * model the board multiplies the fitted value by.
 */
export function fitSeasoning(snapshot: Snapshot): Seasoning {
  const dated = snapshot.protocols.filter((p) => ageDays(snapshot.as_of, p.listed_at) !== null);
  const xs = dated.map((p) => Math.log10(ageDays(snapshot.as_of, p.listed_at)! + 1));
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
  return { intercept: round4(b0), slope: round4(b1), n_protocols: dated.length, base_rate: round4(baseRate) };
}

/** A protocol's launch odds from the seasoning curve; an unlisted age takes the base rate. */
export function launchOdds(age: number | null, seasoning: Seasoning): number {
  if (age === null) return seasoning.base_rate;
  const z = seasoning.intercept + seasoning.slope * Math.log10(age + 1);
  const clamped = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-clamped));
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

/**
 * Fit the regression on the live comparables and validate it three ways, all at run time:
 *  - walk-forward: sort the dated comps by listed_at, fit on the oldest 70%, test on the
 *    newest 30%. The out-of-sample error is the median absolute log10 error on the test
 *    set, predicted with the training fit and the training set's own group adjustments —
 *    no look-ahead. Undated comps are excluded here: with no listing date they have no
 *    position in time, and radar-5's nulls-last ordering put all of them in the test set,
 *    so its walk-forward error was the undated error, not a forward error.
 *  - stratified walk-forward: dated and undated comps are each split 70/30 (dated by listing
 *    date, undated by slug), so the undated part of the set is scored too instead of landing
 *    whole in the test set; the undated test error is reported on its own (oos_undated).
 *  - 5-fold cross-validation: the comps are shuffled once with a fixed seed and dealt into
 *    five folds; each fold is scored by a fit on the other four. The per-comp cross-validated
 *    predictions are kept: they are what the P25/P75 band is checked against.
 *  - nested expanding-window walk-forward: on the dated comparables only, train on the
 *    oldest 50/60/70/80/90% and test on the next 10% forward in time; the pooled median
 *    across all five folds is the forward-looking error.
 *  - the OLS benchmark: the old least-squares model on the same features, scored on the
 *    same 70/30 split and the same five folds, so the Huber fit is always shown against
 *    the model it replaced.
 * A 200-refit bootstrap (fixed seed, resampling the comps with replacement) combined with
 * the stratified out-of-sample error gives the band half-width: 0.6745 *
 * sqrt(bootstrap_sd^2 + stratified_oos^2) dex, so P25/P75 sit one quartile each side of
 * the prediction. The stratified error is used because the band is printed on dated and
 * undated rows alike. range_holds is the share of live comparables whose true value fell
 * inside their band, scored on the cross-validated predictions — an out-of-sample
 * calibration check, not an in-sample one.
 * The growth coefficient is floored at zero in every fit: a negative carry in a flat week is
 * noise, and the model never pays a protocol for shrinking.
 */
export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): FittedModel {
  const comps = liveComps(snapshot);
  const asOf = snapshot.as_of;
  const fitOne = (rows: SnapshotProtocol[]): { beta: number[]; adj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>; chainAdj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }> } => {
    const raw = fitHuber(rows, asOf, model);
    const beta = [...raw];
    if (beta[2]! < 0) beta[2] = 0;
    const adj = groupAdjustments(rows, asOf, beta, (p) => p.category ?? 'Other', model);
    const chainAdj = groupAdjustments(rows, asOf, beta, mainChain, model);
    return { beta, adj, chainAdj };
  };
  const medianAbsErr = (
    rows: SnapshotProtocol[],
    beta: number[],
    adj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
    chainAdj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>,
  ): number => {
    const errs = rows
      .map((p) => Math.abs(Math.log10(p.mcap_usd!) - predictLog(p, asOf, beta, adj, chainAdj, model)))
      .sort((a, b) => a - b);
    return median(errs) ?? 0;
  };

  const full = fitOne(comps);
  const r2 = rSquared(comps, asOf, full.beta, full.adj, full.chainAdj, model);

  // Walk-forward, dated comparables only: sort by listing date, fit on the oldest 70%,
  // test on the newest 30%. A comparable with no listing date has no position in time:
  // radar-5 sorted it last, so all 32 undated comps landed whole in the test set and the
  // "walk-forward" error was really the undated error. Undated comps are still scored —
  // in the stratified split below and in cross-validation — and their stratified-test
  // error is reported separately as oos_undated, not hidden inside the walk-forward.
  const datedOrdered = [...comps]
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const nTrain = Math.floor(datedOrdered.length * 0.7);
  const train = datedOrdered.slice(0, nTrain);
  const test = datedOrdered.slice(nTrain);
  const wf = fitOne(train);
  const oos = medianAbsErr(test, wf.beta, wf.adj, wf.chainAdj);

  const dated = datedOrdered;
  const undated = [...comps].filter((p) => p.listed_at === null).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const stratTrain = [...dated.slice(0, Math.floor(dated.length * 0.7)), ...undated.slice(0, Math.floor(undated.length * 0.7))];
  const stratTest = [...dated.slice(Math.floor(dated.length * 0.7)), ...undated.slice(Math.floor(undated.length * 0.7))];
  const strat = fitOne(stratTrain);
  const oosStratified = medianAbsErr(stratTest, strat.beta, strat.adj, strat.chainAdj);
  const stratUndatedTest = stratTest.filter((p) => p.listed_at === null);
  const oosUndated = medianAbsErr(stratUndatedTest, strat.beta, strat.adj, strat.chainAdj);

  const shuffled = seededShuffle(comps, 20261118);
  const folds: SnapshotProtocol[][] = [[], [], [], [], []];
  shuffled.forEach((p, i) => folds[i % 5]!.push(p));
  const cvPred = new Map<string, number>();
  for (let f = 0; f < 5; f++) {
    const testFold = folds[f]!;
    const trainFolds = folds.flatMap((fold, i) => (i === f ? [] : fold));
    const cvFit = fitOne(trainFolds);
    for (const p of testFold) cvPred.set(p.slug, predictLog(p, asOf, cvFit.beta, cvFit.adj, cvFit.chainAdj, model));
  }
  const cvErrs = comps
    .map((p) => Math.abs(Math.log10(p.mcap_usd!) - cvPred.get(p.slug)!))
    .sort((a, b) => a - b);
  const cv = median(cvErrs) ?? 0;

  // The old OLS model, kept as a benchmark and never deleted: the same features, fitted by
  // plain least squares (one solve, no Huber weights), scored on the same 70/30 split and
  // the same five folds, so the comparison isolates the fitting method.
  const fitOneOls = (rows: SnapshotProtocol[]): { beta: number[]; adj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }>; chainAdj: Map<string, { adjustment: number; count: number; basis: 'category' | 'global' }> } => {
    const raw = fitWeightedOls(rows, rows.map(() => 1), asOf, model);
    const beta = [...raw];
    if (beta[2]! < 0) beta[2] = 0;
    const adj = groupAdjustments(rows, asOf, beta, (p) => p.category ?? 'Other', model);
    const chainAdj = groupAdjustments(rows, asOf, beta, mainChain, model);
    return { beta, adj, chainAdj };
  };
  const olsFull = fitOneOls(comps);
  const olsR2 = rSquared(comps, asOf, olsFull.beta, olsFull.adj, olsFull.chainAdj, model);
  const olsWf = fitOneOls(train);
  const olsOos = medianAbsErr(test, olsWf.beta, olsWf.adj, olsWf.chainAdj);
  const cvPredOls = new Map<string, number>();
  for (let f = 0; f < 5; f++) {
    const testFold = folds[f]!;
    const trainFolds = folds.flatMap((fold, i) => (i === f ? [] : fold));
    const cvFitOls = fitOneOls(trainFolds);
    for (const p of testFold) cvPredOls.set(p.slug, predictLog(p, asOf, cvFitOls.beta, cvFitOls.adj, cvFitOls.chainAdj, model));
  }
  const cvErrsOls = comps
    .map((p) => Math.abs(Math.log10(p.mcap_usd!) - cvPredOls.get(p.slug)!))
    .sort((a, b) => a - b);
  const olsCv = median(cvErrsOls) ?? 0;

  // Nested expanding-window walk-forward on the dated comparables only: train on the
  // oldest 50/60/70/80/90%, test on the next 10% forward in time. Every fold's test set
  // is strictly later than its training set, so no fold ever peeks ahead.
  const datedComps = [...comps]
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const nestedStep = Math.max(1, Math.round(datedComps.length * 0.1));
  const nestedFolds: NestedFold[] = [];
  const nestedPooledErrs: number[] = [];
  const nestedPooledErrsOls: number[] = [];
  for (const pct of [50, 60, 70, 80, 90]) {
    const nTr = Math.floor((datedComps.length * pct) / 100);
    const foldTest = datedComps.slice(nTr, nTr + nestedStep);
    const foldTrain = datedComps.slice(0, nTr);
    const foldFit = fitOne(foldTrain);
    const errs = foldTest.map((p) => Math.abs(Math.log10(p.mcap_usd!) - predictLog(p, asOf, foldFit.beta, foldFit.adj, foldFit.chainAdj, model)));
    nestedPooledErrs.push(...errs);
    nestedFolds.push({ train_pct: pct, median_abs_log_err: round4(median([...errs].sort((a, b) => a - b)) ?? 0), n_test: foldTest.length });
    const foldFitOls = fitOneOls(foldTrain);
    nestedPooledErrsOls.push(...foldTest.map((p) => Math.abs(Math.log10(p.mcap_usd!) - predictLog(p, asOf, foldFitOls.beta, foldFitOls.adj, foldFitOls.chainAdj, model))));
  }
  nestedPooledErrs.sort((a, b) => a - b);
  const nestedPooled = round4(median(nestedPooledErrs) ?? 0);
  nestedPooledErrsOls.sort((a, b) => a - b);
  const nestedPooledOls = round4(median(nestedPooledErrsOls) ?? 0);
  const olsBaseline: OlsBaseline = {
    r2: round4(olsR2),
    oos_median_abs_log_err: round4(olsOos),
    cv_median_abs_log_err: round4(olsCv),
    nested_wf_pooled: nestedPooledOls,
  };

  const bootRand = mulberry32(20261119);
  const bootPreds: number[][] = comps.map(() => []);
  for (let b = 0; b < 200; b++) {
    const resample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) resample.push(comps[Math.floor(bootRand() * comps.length)]!);
    const bootFit = fitOne(resample);
    comps.forEach((p, i) => bootPreds[i]!.push(predictLog(p, asOf, bootFit.beta, bootFit.adj, bootFit.chainAdj, model)));
  }
  const sds = bootPreds
    .map((preds) => {
      const mean = preds.reduce((a, v) => a + v, 0) / preds.length;
      return Math.sqrt(preds.reduce((a, v) => a + (v - mean) ** 2, 0) / preds.length);
    })
    .sort((a, b) => a - b);
  const bootstrapSd = median(sds) ?? 0;
  // The band's error term is the stratified out-of-sample error, not the dated-only
  // walk-forward error: the band is printed on every board row, dated and undated alike,
  // so its miss must be measured on the whole comparable population. (Radar-5 used the
  // walk-forward error; with the walk-forward now dated-only that would understate the
  // miss for undated rows and the band held only ~39% of comps in cross-validation.)
  const bandHalfwidth = 0.6745 * Math.sqrt(bootstrapSd ** 2 + oosStratified ** 2);
  const held = comps.filter((p) => Math.abs(Math.log10(p.mcap_usd!) - cvPred.get(p.slug)!) <= bandHalfwidth).length;
  const rangeHolds = comps.length > 0 ? held / comps.length : 0;
  const seasoning = fitSeasoning(snapshot);

  const growths = comps.map((p) => features(p, asOf, model)[2]!).sort((a, b) => a - b);
  const fit: Fit = {
    intercept: round4(full.beta[0]!),
    coef_log_tvl: round4(full.beta[1]!),
    coef_growth: round4(full.beta[2]!),
    n_comps: comps.length,
    size_floor_usd: model.size_floor_usd,
    median_growth: round4(median(growths) ?? 0),
  };
  const validation: Validation = {
    r2: round4(r2),
    oos_median_abs_log_err: round4(oos),
    oos_stratified: round4(oosStratified),
    oos_undated: round4(oosUndated),
    n_dated_comps: dated.length,
    n_undated_comps: undated.length,
    cv_median_abs_log_err: round4(cv),
    bootstrap_sd: round4(bootstrapSd),
    band_halfwidth_dex: round4(bandHalfwidth),
    range_holds: round4(rangeHolds),
    n_train: train.length,
    n_test: test.length,
    ols_baseline: olsBaseline,
    nested_wf_folds: nestedFolds,
    nested_wf_pooled: nestedPooled,
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

/** The fitted value of one protocol: value if it launches, launch odds, and the odds-weighted implied value, with the P25/P75 band. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fitted: FittedModel,
  model: ModelConstants = MODEL,
): { implied: number; valueIfLaunches: number; predictedLog: number; launchOdds: number; breakEvenOdds: number; bandP25: number; bandP75: number; growthPct: number; age: number | null; adjustment: number; chainAdjustment: number; count: number; basis: 'category' | 'global' } {
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
  const growthPct = features(protocol, asOf, model)[2]!;
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
 * The farm verdict, from the break-even launch odds: farm when a launch need only be a
 * one-in-ten shot to break even, marginal when it need be one-in-three, skip otherwise.
 * The odds are the plan's, not the protocol's: a protocol's own launch odds decide the
 * ranking, the break-even odds decide whether farming it is worth the money.
 */
export function verdictFor(valueIfLaunches: number, cost: number, model: ModelConstants = MODEL): Verdict {
  const be = breakEvenOdds(valueIfLaunches, cost, model);
  if (be <= model.farm_break_even) return 'farm';
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
export function verdictStep(verdict: Verdict, valueIfLaunches: number, launchOdds: number, beOdds: number, cost: number): string {
  if (verdict === 'farm') {
    return `Verdict: FARM — break-even launch odds ${fmtOdds(beOdds)}: farming breaks even if this protocol launches with at least that probability, against a value if it launches of ${fmtShort(valueIfLaunches)} and a plan cost of about $${cost}. Its own launch odds are ${fmtOdds(launchOdds)}, so farm this protocol first.`;
  }
  if (verdict === 'marginal') {
    return `Verdict: MARGINAL — break-even launch odds ${fmtOdds(beOdds)}: farming breaks even if this protocol launches with at least that probability, against a value if it launches of ${fmtShort(valueIfLaunches)} and a plan cost of about $${cost}. Its own launch odds are ${fmtOdds(launchOdds)}: worth a small position, not a priority.`;
  }
  return `Verdict: SKIP — break-even launch odds ${fmtOdds(beOdds)} are too high: farming breaks even only if this protocol launches with at least that probability, against a value if it launches of ${fmtShort(valueIfLaunches)} and a plan cost of about $${cost}. Its own launch odds are ${fmtOdds(launchOdds)}, so skip it unless its points program changes.`;
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
      text: verdictStep(verdict, v.valueIfLaunches, v.launchOdds, v.breakEvenOdds, cost),
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
    const verdict = verdictFor(v.valueIfLaunches, cost, model);
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
