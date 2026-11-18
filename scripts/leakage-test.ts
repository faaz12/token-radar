// Leakage-injection self-test (radar-9, charter v1.2): verifies the pipeline catches
// doctored snapshots and that no feature or adjustment peeks past a fold's cutoff.
//
// Run from the entry directory:
//   node scripts/leakage-test.ts --input ../kit/token-radar-01-kit/input/snapshot.json
// Exit 0 iff every check passes; exit 1 naming the failing checks.
// scripts/ is not copied to /output, so this file never reaches the dossier.

import { readFileSync } from 'node:fs';
import { MODEL, ageDays, buildRadar, features, fitModel, fitRegression, liveComps, parseSnapshot, undatedComps, validateSnapshot } from '../lib/model.ts';
import type { Snapshot, SnapshotProtocol } from '../lib/model.ts';

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputFile = arg('input', '/input/snapshot.json');
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) process.stdout.write(`leakage-test: PASS ${name}${detail ? ` — ${detail}` : ''}\n`);
  else {
    failures.push(name);
    process.stdout.write(`leakage-test: FAIL ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
};
const clone = (s: Snapshot): Snapshot => JSON.parse(JSON.stringify(s)) as Snapshot;
const byDate = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
  a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;

// 1. The real snapshot: no validation errors, truncation audit passes.
const real = validateSnapshot(snapshot);
check('real snapshot has no validation errors', real.errors.length === 0, real.errors.join('; '));
const fitted = fitModel(snapshot);
check(
  'truncation audit passes on the real snapshot',
  fitted.validation.truncation_audit.passed,
  fitted.validation.truncation_audit.checks.join(' | '),
);

// 2. A protocol listed after the snapshot date is caught.
const future = clone(snapshot);
future.protocols[0]!.listed_at = '2027-01-01';
check('future-dated listing is caught', validateSnapshot(future).errors.some((e) => e.includes('after the snapshot date')));

// 3. A duplicate slug is caught.
const dup = clone(snapshot);
dup.protocols.push({ ...dup.protocols[0]! });
check('duplicate slug is caught', validateSnapshot(dup).errors.some((e) => e.includes('duplicate slug')));

// 4. A negative TVL is caught.
const negTvl = clone(snapshot);
negTvl.protocols[0]!.tvl_usd = -100;
check('negative TVL is caught', validateSnapshot(negTvl).errors.some((e) => e.includes('negative TVL')));

// 5. A negative market cap is caught.
const negMcap = clone(snapshot);
negMcap.protocols[1]!.mcap_usd = -100;
check('negative market cap is caught', validateSnapshot(negMcap).errors.some((e) => e.includes('negative market cap')));

// 6. A zero market cap warns but does not abort: a dead token still counts as has-token.
const zeroMcap = clone(snapshot);
zeroMcap.protocols[1]!.mcap_usd = 0;
const zeroCheck = validateSnapshot(zeroMcap);
check(
  'zero market cap warns without erroring',
  zeroCheck.errors.length === 0 && zeroCheck.warnings.some((w) => w.includes('zero market cap')),
);

// 7. Features are row-local: a row's features from the full snapshot equal its features
//    from a snapshot holding only that row — no global median, no floor fitted on the set.
const row = liveComps(snapshot)[0]!;
const solo: Snapshot = { ...snapshot, protocols: [row] };
const fullFeatures = features(row, snapshot.as_of);
const soloFeatures = features(row, solo.as_of);
check('features are row-local (truncation-invariant)', fullFeatures.every((f, i) => f === soloFeatures[i]!));

// 8. The size floor is a locked constant, not fitted on the snapshot.
check(
  'size floor is the locked $25M constant',
  MODEL.size_floor_usd === 25_000_000 && fitted.fit.size_floor_usd === 25_000_000,
);

// 9. A fold's adjustments exclude its test rows: the 50% fold's category adjustments
//    differ from the full-set adjustments, proving the fold fit is actually restricted.
const dated = [...liveComps(snapshot)].filter((p) => p.listed_at !== null).sort(byDate);
const nTr50 = Math.floor((dated.length * 50) / 100);
const testStart50 = dated[nTr50]!.listed_at!;
const foldTrain50 = dated
  .slice(0, nTr50)
  .filter((p) => (ageDays(testStart50, p.listed_at) ?? 0) >= MODEL.purge_gap_days);
const foldFit50 = fitRegression(foldTrain50, snapshot.as_of, MODEL, 'ols');
const fullFit = fitRegression(liveComps(snapshot), snapshot.as_of, MODEL, 'ols');
const foldDiffers = [...foldFit50.adj.entries()].some(([k, v]) => {
  const w = fullFit.adj.get(k);
  return !w || Math.abs(v.adjustment - w.adjustment) > 1e-9;
});
check('fold adjustments exclude test rows (differ from full-set adjustments)', foldDiffers);

// 10. Truncated refit reproduces the fold fit exactly, recomputed independently here:
//     the snapshot cut at the purge cutoff yields the same beta and adjustments.
const cutoffDate = new Date(Date.parse(`${testStart50}T00:00:00Z`) - MODEL.purge_gap_days * 86_400_000).toISOString().slice(0, 10);
const truncated: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at <= cutoffDate) };
const refit = fitRegression(liveComps(truncated), snapshot.as_of, MODEL, 'ols');
const betaSame = refit.beta.every((b, i) => Math.abs(b - foldFit50.beta[i]!) < 1e-9);
const adjSame = (a: Map<string, { adjustment: number; count: number }>, b: Map<string, { adjustment: number; count: number }>): boolean => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (!w || Math.abs(v.adjustment - w.adjustment) > 1e-9 || v.count !== w.count) return false;
  }
  return true;
};
check(
  'truncated refit reproduces the fold fit exactly',
  betaSame && adjSame(refit.adj, foldFit50.adj) && adjSame(refit.chainAdj, foldFit50.chainAdj),
  `cutoff ${cutoffDate}, ${liveComps(truncated).length} comps`,
);

// 11. Verdicts are EV-based under the charter v1.3 decision engine: a farm row passes
//     the ADOPTED gate under the CONSERVATIVE launch odds, and no marginal row does.
//     The farm count may legitimately be ZERO — the gate is not a quota, and this
//     check must never require >= 1 farm. No skip row has a positive mean EV. The
//     P25 > 0 requirement is policy-(a)-only: under (b) a farm needs conditional mean
//     EV > 3x plan cost, under (c) P(negative) <= 0.90 — so the farm-row check is
//     policy-aware, never hard-coded to (a).
const { board, radar } = buildRadar(snapshot);
const farmRows = board.filter((r) => r.verdict === 'farm');
const marginalRows = board.filter((r) => r.verdict === 'marginal');
const skipRows = board.filter((r) => r.verdict === 'skip');
check(
  'every farm row passes the adopted gate under the conservative launch odds',
  farmRows.every((r) => r.model.gate_pass_conservative && r.model.gate_pass_adopted && r.model.expected_value_usd > 0),
  `${farmRows.length} farm rows (0 is legitimate — the gate is not a quota)`,
);
check(
  'no marginal row passes the adopted gate under the conservative launch odds',
  marginalRows.every((r) => !r.model.gate_pass_conservative),
  `${marginalRows.length} marginal rows`,
);
check(
  'no skip row has a positive expected net return',
  skipRows.every((r) => r.model.expected_value_usd <= 0),
  `${skipRows.length} skip rows`,
);
// The gate-test table matches the board: the adopted variant's farm count under the
// adopted odds equals the rows whose adopted gate passes, and the board's farm count
// equals the rows whose conservative gate passes. (The gate test is computed in
// buildRadar, not fitModel — it needs the board.)
const gateTest = radar.validation.gate_test;
if (gateTest === null) throw new Error('gate test missing: buildRadar must set validation.gate_test');
const adoptedVariant =
  gateTest.adopted === 'a' ? gateTest.variant_a : gateTest.adopted === 'b' ? gateTest.variant_b : gateTest.variant_c;
check(
  'farm rows satisfy the adopted policy under the adopted odds',
  gateTest.adopted === 'a'
    ? farmRows.every((r) => r.model.ev_p25_usd > 0)
    : gateTest.adopted === 'b'
      ? farmRows.every((r) => r.model.ev_conditional_mean_usd > 3 * r.plan_cost_usd)
      : farmRows.every((r) => r.model.prob_negative_return <= 0.9),
  `adopted policy (${gateTest.adopted}), ${farmRows.length} farm rows`,
);
check(
  'gate-test table matches the board farms',
  adoptedVariant.farm_count === board.filter((r) => r.model.gate_pass_adopted).length &&
    farmRows.length === board.filter((r) => r.model.gate_pass_conservative).length,
  `variant (${gateTest.adopted}) farms ${adoptedVariant.farm_count} under adopted odds, board farms ${farmRows.length} under conservative odds`,
);

// 12. Undated comparables are hard-gated (charter v1.2): the fit uses exactly the 70
//     dated comps, liveComps contains no undated row, and the 22 undated rows exist
//     only as a reference table.
const live = liveComps(snapshot);
const undated = undatedComps(snapshot);
const liveSlugs = new Set(live.map((p) => p.slug));
check(
  'undated comparables are excluded from the fit (70 dated comps only)',
  fitted.fit.n_comps === 70 &&
    live.length === 70 &&
    live.every((p) => p.listed_at !== null) &&
    undated.length === 22 &&
    undated.every((p) => p.listed_at === null && !liveSlugs.has(p.slug)),
  `${live.length} live comps, ${undated.length} undated reference rows`,
);

// 13. Production has no growth term: the fitted growth coefficient is exactly zero.
check(
  'production growth coefficient is zero',
  fitted.fit.coef_growth === 0,
  `coef_growth ${fitted.fit.coef_growth}`,
);

// 14. Model selection follows the locked rule: OLS is selected on this snapshot
//     (ridge wins the metric by 0.0039 dex, under the 0.01 dex simplicity threshold).
check(
  'model selection picks OLS under the charter v1.3 rule',
  fitted.validation.model_selection.selected === 'ols',
  fitted.validation.model_selection.reason,
);

// 15. EV consistency (charter v1.3 — the radar-8 contradiction, caught here): every
//     statistic comes from ONE simulation array per protocol, so for every board row
//     the quantiles are monotone, P(negative) is in [0, 1] and at least the non-launch
//     mass (1 - p_L), and the simulated P(negative) agrees with the analytic one
//     within Monte Carlo error (0.02).
const evBad = board.filter((r) => {
  const m = r.model;
  const monotone =
    m.ev_p10_usd <= m.ev_p25_usd && m.ev_p25_usd <= m.ev_p50_usd && m.ev_p50_usd <= m.ev_p75_usd && m.ev_p75_usd <= m.ev_p90_usd;
  const pNegOk = m.prob_negative_return >= 0 && m.prob_negative_return <= 1 && m.prob_negative_return >= 1 - m.launch_odds - 1e-9;
  const simVsAnalytic = Math.abs(m.prob_negative_return - m.prob_negative_analytic) <= 0.02;
  return !(monotone && pNegOk && simVsAnalytic);
});
check(
  'EV statistics are consistent (monotone quantiles, P(neg) in range and >= 1-p_L, sim vs analytic within 0.02)',
  evBad.length === 0,
  evBad.length === 0 ? `${board.length} rows checked` : `inconsistent rows: ${evBad.map((r) => r.slug).join(', ')}`,
);
// With launch odds below 25%, the 25th percentile of the net-return mixture is the
// non-launch point mass (-cost): the old radar-8 "P25 EV +$22,148" cannot recur.
const lowOddsBad = board.filter((r) => r.model.launch_odds < 0.25 && Math.abs(r.model.ev_p25_usd + r.plan_cost_usd) > 1);
check(
  'P25 of the net return is -cost whenever launch odds are below 25%',
  lowOddsBad.length === 0,
  lowOddsBad.length === 0 ? `${board.filter((r) => r.model.launch_odds < 0.25).length} rows below 25% odds` : `violations: ${lowOddsBad.map((r) => r.slug).join(', ')}`,
);

// 16. Launch-odds decision (charter v1.3): the board uses the base rate for every row
//     until a better model validates — the seasoning curve is diagnostic only.
const lod = fitted.validation.launch_odds_decision;
check(
  'launch-odds decision is the base rate, applied to every board row',
  lod.source === 'base-rate' && board.every((r) => Math.abs(r.model.launch_odds - lod.base_rate) < 1e-9),
  `source ${lod.source}, base rate ${lod.base_rate}, conservative lower bound ${lod.conservative_lower_bound}`,
);

// 17. Nested reconciliation (charter v1.3): the two nested pooled numbers reproduce
//     exactly from the sealed snapshot, and the difference is labeled as a different
//     test set, not a different calculation.
check(
  'nested 0.3203 vs 0.3284 reconciles and reproduces',
  fitted.validation.nested_reconciliation.reproduces === true &&
    Math.abs(fitted.validation.nested_reconciliation.recomputed_selection_dex - 0.3203) < 1e-9 &&
    Math.abs(fitted.validation.nested_reconciliation.recomputed_all_folds_dex - 0.3284) < 1e-9,
  fitted.validation.nested_reconciliation.difference_explanation,
);

// 18. Out-of-distribution tiers (charter v1.3): every row carries an OOD report with
//     a tier. Partial rows (1 flag) get the validated band multiplier and the
//     "extrapolation" confidence; major rows (2+ flags, or unseen category AND unseen
//     chain) get "unsupported" and never farm; a row whose nearest comparable is more
//     than 0.5 dex away never farms; in-distribution rows get x1.0 and never the
//     "extrapolation" confidence. Polymarket is the labeled exploratory extrapolation.
const oodMult = fitted.validation.ood_multiplier_validation.adopted_multiplier;
const oodBad = board.filter((r) => {
  const o = r.model.ood;
  if (o.tier === 'major') return o.confidence !== 'unsupported' || r.verdict === 'farm';
  if (o.tier === 'partial') return o.band_multiplier !== oodMult || o.confidence !== 'extrapolation';
  return o.band_multiplier !== 1 || o.confidence === 'extrapolation';
});
check(
  'out-of-distribution tiers are enforced (partial = validated multiplier + extrapolation, major = unsupported + never farm)',
  oodBad.length === 0,
  `${board.filter((r) => r.model.ood.is_ood).length} of ${board.length} rows out-of-distribution, validated multiplier x${oodMult}`,
);
const farOodBad = board.filter((r) => r.model.ood.nearest_comp_distance_dex > 0.5 && r.verdict === 'farm');
check(
  'no row with a nearest comparable more than 0.5 dex away farms',
  farOodBad.length === 0,
  `${board.filter((r) => r.model.ood.nearest_comp_distance_dex > 0.5).length} rows beyond 0.5 dex`,
);
const poly = board.find((r) => r.slug === 'polymarket-international')!;
check(
  'Polymarket is a partial-OOD exploratory extrapolation, not a production farm',
  poly.model.ood.tier === 'partial' && poly.model.ood.confidence === 'extrapolation' && poly.verdict !== 'farm',
  `tier ${poly.model.ood.tier}, confidence ${poly.model.ood.confidence}, verdict ${poly.verdict}`,
);

// 19. TVL floor sensitivity (charter v1.3): the diagnostic covers all five floors and
//     the locked $25M row's selection metric equals the selection metric. The $10M
//     floor scores 0.3090 against $25M's 0.3203 — documented beside it, never selected.
const floors = fitted.validation.floor_sensitivity.rows;
check(
  'floor sensitivity covers $0M/$10M/$25M/$50M/$100M with the locked $25M metric matching selection',
  floors.length === 5 &&
    floors.map((f) => f.floor_usd).join(',') === '0,10000000,25000000,50000000,100000000' &&
    Math.abs(floors.find((f) => f.floor_usd === 25_000_000)!.selection_pooled_dex - fitted.validation.nested_selection_pooled) < 1e-9,
  `${floors.length} floors, locked $25M selection pooled ${floors.find((f) => f.floor_usd === 25_000_000)?.selection_pooled_dex} dex`,
);
check(
  'the $10M floor scores 0.3090 beside the locked $25M floor at 0.3203',
  Math.abs(floors.find((f) => f.floor_usd === 10_000_000)!.selection_pooled_dex - 0.309) < 1e-9 &&
    Math.abs(floors.find((f) => f.floor_usd === 25_000_000)!.selection_pooled_dex - 0.3203) < 1e-9,
  `$10M ${floors.find((f) => f.floor_usd === 10_000_000)?.selection_pooled_dex} vs $25M ${floors.find((f) => f.floor_usd === 25_000_000)?.selection_pooled_dex}`,
);

// 20. Distribution tournament (charter v1.3): six distributions (five + the P90-cap
//     sensitivity row) over the same audit rows; the capped mean is at most the
//     uncapped mean per row; the empirical conditional means agree within Monte Carlo
//     noise (the distribution ignores TVL, so the only spread is the per-row seed);
//     P95 >= P90 >= median per row; farm counts per policy exist.
const tourn = radar.validation.distribution_tournament!;
check(
  'distribution tournament covers six distributions over the audit rows',
  tourn.results.length === 6 &&
    tourn.results.map((r) => r.distribution).join(',') === 'lognormal,capped-lognormal,capped-p90-lognormal,empirical,bootstrap-residuals,student-t',
  `${tourn.results.length} distributions, production ${tourn.production_distribution}, cap kept ${tourn.cap_kept}`,
);
const tournBad = tourn.results
  .find((r) => r.distribution === 'capped-lognormal')!
  .rows.filter((row, i) => {
    const uncapped = tourn.results.find((r) => r.distribution === 'lognormal')!.rows[i]!;
    return row.conditional_mean_value_usd > uncapped.conditional_mean_value_usd + 1e-6;
  });
check(
  'capped lognormal mean is at most the uncapped mean on every row',
  tournBad.length === 0,
  `${tourn.results[0]!.n_rows} rows compared`,
);
const empRows = tourn.results.find((r) => r.distribution === 'empirical')!.rows;
const empPooled = tourn.results.find((r) => r.distribution === 'empirical')!.pooled_conditional_mean_value_usd;
check(
  'empirical conditional means agree within Monte Carlo noise (TVL-independent)',
  empRows.every((row) => Math.abs(row.conditional_mean_value_usd - empPooled) / empPooled <= 0.2),
  `empirical conditional means ${Math.min(...empRows.map((r) => r.conditional_mean_value_usd)).toFixed(0)}–${Math.max(...empRows.map((r) => r.conditional_mean_value_usd)).toFixed(0)} around pooled ${empPooled}`,
);
const tournQuantBad = tourn.results.flatMap((r) => r.rows).filter((row) => !(row.conditional_p95_value_usd >= row.conditional_p90_value_usd && row.conditional_p90_value_usd >= row.conditional_median_value_usd));
check(
  'tournament quantiles are ordered P95 >= P90 >= median on every row',
  tournQuantBad.length === 0,
  `${tourn.results.flatMap((r) => r.rows).length} row-distributions checked`,
);

// 21. Gate policy test (charter v1.3): three policies are present; the adopted policy
//     is eligible, or the adopted policy is (a) with a documented reason; the board's
//     farm count equals the conservative-gate pass count under the adopted policy.
const adoptedVariantObj = gateTest.adopted === 'a' ? gateTest.variant_a : gateTest.adopted === 'b' ? gateTest.variant_b : gateTest.variant_c;
check(
  'gate test covers three prespecified policies with an eligibility rule',
  gateTest.variant_a !== undefined &&
    gateTest.variant_b !== undefined &&
    gateTest.variant_c !== undefined &&
    (adoptedVariantObj.eligible || (gateTest.adopted === 'a' && gateTest.reason.length > 0)),
  `adopted (${gateTest.adopted}): (a) ${gateTest.variant_a.farm_count}, (b) ${gateTest.variant_b.farm_count}, (c) ${gateTest.variant_c.farm_count} farms`,
);
check(
  'board farm count equals the conservative-gate pass count under the adopted policy',
  farmRows.length === board.filter((r) => r.model.gate_pass_conservative).length,
  `${farmRows.length} farm rows`,
);

// 22. Horizon cohort (charter v1.3): status counts sum to the 645 dated protocols; the
//     risk-set rate is launched / risk set; the censored count is the tokenless
//     protocols listed under 12 months ago.
const cohort = fitted.validation.horizon_cohort;
const statusSum =
  cohort.status_counts.launched_timing_unknown +
  cohort.status_counts.failed +
  cohort.status_counts.disappeared +
  cohort.status_counts.tokenless_resolved +
  cohort.status_counts.tokenless_censored;
check(
  'horizon cohort status counts sum to the dated protocols and the risk-set rate reproduces',
  statusSum === cohort.n_dated_protocols &&
    cohort.n_dated_protocols === 645 &&
    Math.abs(cohort.risk_set_base_rate - Math.round((cohort.n_launched / cohort.n_risk_set) * 1e4) / 1e4) < 1e-9 &&
    cohort.n_censored === cohort.status_counts.tokenless_censored,
  `${statusSum} dated, risk set ${cohort.n_risk_set}, launched ${cohort.n_launched}, rate ${cohort.risk_set_base_rate} (upper bound)`,
);

// 23. Heuristic multiplier (charter v1.3): adopted only when it beats the flat base rate
//     on BOTH Brier and log-loss on the untouched test.
const heur = fitted.validation.seasoning_audit.heuristic_multiplier!;
check(
  'heuristic activity multiplier is adopted only if it beats the base rate on both Brier and log-loss',
  !heur.adopted || (heur.beats_base_brier && heur.beats_base_log_loss),
  `adopted ${heur.adopted}, Brier ${heur.test_brier_multiplier} vs ${heur.test_brier_base}, log-loss ${heur.test_log_loss_multiplier} vs ${heur.test_log_loss_base}`,
);

// 24. Leave-one-protocol-out influence (charter v1.3): the maximum board movement is
//     reported; exactly 70 distinct protocols, one observation each.
const lopo = fitted.validation.lopo_influence;
check(
  'LOPO covers 70 distinct protocols with one observation each and reports the maximum board movement',
  lopo.n_protocols === 70 &&
    lopo.observations_per_protocol === 1 &&
    lopo.most_influential.length === 5 &&
    Number.isFinite(lopo.max_abs_delta_predicted_log),
  `max |Δ predicted log| ${lopo.max_abs_delta_predicted_log} dex (dropped ${lopo.most_influential[0]!.slug})`,
);

// 25. Conformal slices (charter v1.3): every coverage is in [0, 1] and every slice's
//     counts sum to the calibration size.
const slices = fitted.validation.conformal_slices;
const allSlices = [...slices.by_regime, ...slices.by_tvl_band, ...slices.by_age_band, ...slices.by_ood];
check(
  'conformal slice coverages are in [0, 1] and slice counts sum to the calibration size',
  allSlices.every((s) => s.coverage_50 >= 0 && s.coverage_50 <= 1 && s.coverage_80 >= 0 && s.coverage_80 <= 1 && s.coverage_90 >= 0 && s.coverage_90 <= 1) &&
    slices.by_regime.reduce((n, s) => n + s.n, 0) === slices.calibration_n &&
    slices.by_tvl_band.reduce((n, s) => n + s.n, 0) === slices.calibration_n &&
    slices.by_age_band.reduce((n, s) => n + s.n, 0) === slices.calibration_n,
  `${allSlices.length} slices, calibration n = ${slices.calibration_n}`,
);

// 26. Capped simulation (charter v1.3): no row's simulated mean value if it launches
//     exceeds the production value cap.
const capUsd = tourn.cap_usd;
const capBad = board.filter((r) => r.model.mean_value_if_launches_usd > capUsd + 1e-6);
check(
  'no simulated mean launch value exceeds the production value cap',
  capBad.length === 0,
  `cap ${fmtCap(capUsd)}, ${board.length} rows checked`,
);
function fmtCap(n: number): string {
  return '$' + (n / 1e9).toFixed(2) + 'B';
}

if (failures.length > 0) {
  process.stderr.write(`leakage-test: ${failures.length} check${failures.length === 1 ? '' : 's'} failed: ${failures.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`leakage-test: all checks passed\n`);
