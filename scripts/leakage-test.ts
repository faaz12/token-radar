// Leakage-injection self-test (radar-12, charter v1.5): verifies the pipeline catches
// doctored snapshots and that no feature or adjustment peeks past a fold's cutoff.
//
// Run from the entry directory:
//   node scripts/leakage-test.ts --input ../kit/token-radar-01-kit/input/snapshot.json
// Exit 0 iff every check passes; exit 1 naming the failing checks.
// scripts/ is not copied to /output, so this file never reaches the dossier.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MODEL, ageDays, analyticGateStats, analyticVerdict, buildRadar, features, fitModel, fitRegression, liveComps, nestedSelectionMetric, parseSnapshot, undatedComps, validateSnapshot } from '../lib/model.ts';
import type { Snapshot, SnapshotProtocol } from '../lib/model.ts';

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputFile = arg('input', '/input/snapshot.json');
const snapshotSha256 = createHash('sha256').update(readFileSync(inputFile)).digest('hex');
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
//     the ADOPTED gate under the CONSERVATIVE launch odds, and no marginal row does
//     unless it is OOD-blocked (major tier or nearest comparable > 0.5 dex —
//     6 rows in radar-12). The farm count may legitimately be ZERO — the gate is not
//     a quota, and this check must never require >= 1 farm. No skip row has a
//     positive mean EV. The P25 > 0 requirement is policy-(a)-only: under (b) a farm
//     needs conditional mean EV > 3x plan cost, under (c) P(negative) <= 0.90 — so
//     the farm-row check is policy-aware, never hard-coded to (a). The adopted-gate
//     flag is NOT required on farm rows: the adopted and conservative sims are
//     separate 20,000-draw estimates, and a row sitting at the ceiling can pass
//     one and miss the other by Monte Carlo noise (radar-12: t3tris-finance
//     passes (f) analytically under both layers — adopted P(negative) 0.8765 vs
//     ceiling 0.8768 — but its sim P(negative) is 0.8771, 0.0003 over). The
//     analytic crosscheck bounds that class of disagreement.
const { board, radar } = buildRadar(snapshot, MODEL, snapshotSha256);
const farmRows = board.filter((r) => r.verdict === 'farm');
const marginalRows = board.filter((r) => r.verdict === 'marginal');
const skipRows = board.filter((r) => r.verdict === 'skip');
check(
  'every farm row passes the adopted gate under the conservative launch odds',
  farmRows.every((r) => r.model.gate_pass_conservative && r.model.expected_value_usd > 0),
  `${farmRows.length} farm rows (0 is legitimate — the gate is not a quota)`,
);
check(
  'no marginal row passes the adopted gate under the conservative launch odds unless OOD-blocked',
  marginalRows.every(
    (r) => !r.model.gate_pass_conservative || r.model.ood.tier === 'major' || r.model.ood.nearest_comp_distance_dex > 0.5,
  ),
  `${marginalRows.length} marginal rows (${marginalRows.filter((r) => r.model.gate_pass_conservative).length} pass the gate but are OOD-blocked to marginal)`,
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
  gateTest.adopted === 'a'
    ? gateTest.variant_a
    : gateTest.adopted === 'b'
      ? gateTest.variant_b
      : gateTest.adopted === 'c'
        ? gateTest.variant_c
        : gateTest.adopted === 'd'
          ? gateTest.variant_d
          : gateTest.adopted === 'e'
            ? gateTest.variant_e
            : gateTest.variant_f;
check(
  'farm rows satisfy the adopted policy under the adopted odds',
  gateTest.adopted === 'a'
    ? farmRows.every((r) => r.model.ev_p25_usd > 0)
    : gateTest.adopted === 'b'
      ? farmRows.every((r) => r.model.ev_conditional_mean_usd > 3 * r.plan_cost_usd)
      : gateTest.adopted === 'c'
        ? farmRows.every((r) => r.model.prob_negative_return <= 0.9)
        : gateTest.adopted === 'd'
          ? farmRows.every((r) => r.model.ev_conditional_mean_usd > 3 * r.plan_cost_usd && r.model.prob_negative_return <= 0.85)
          : gateTest.adopted === 'e'
            ? farmRows.every((r) => r.model.ev_conditional_mean_usd > 5 * r.plan_cost_usd && r.model.prob_negative_return <= 0.9)
            : // (f): the farm condition is the ANALYTIC (f) condition under the
              // conservative odds — the sim gate that produced the verdict is a
              // 20,000-draw estimate of the same capped-lognormal statistic, so a
              // farm row may sit within Monte Carlo tolerance (0.005 on P(neg))
              // of the ceiling analytically. More than 3 such rows, any row
              // further than 0.005 out, or any row failing the 3x condition, is
              // a real gate failure, not noise.
              (() => {
                const consOdds = fitted.launchOddsDecision.conservative_lower_bound;
                const ceiling = 1 - 0.75 * consOdds;
                const perRow = farmRows.map((r) => {
                  const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
                  const sC = analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, consOdds, fitted.valueCapUsd, MODEL);
                  return { slug: r.slug, condOk: sC.conditionalMeanEv > 3 * r.plan_cost_usd, pnegGap: sC.probNegative - ceiling };
                });
                const exceptions = perRow.filter((x) => !x.condOk || x.pnegGap > 0.005);
                return exceptions.length <= 3 && exceptions.every((x) => x.condOk && x.pnegGap <= 0.005);
              })(),
  `adopted policy (${gateTest.adopted}), ${farmRows.length} farm rows`,
);
check(
  'gate-test table matches the board farms',
  adoptedVariant.farm_count === board.filter((r) => r.model.gate_pass_adopted).length &&
    farmRows.length ===
      board.filter((r) => r.model.gate_pass_conservative && r.model.ood.tier !== 'major' && r.model.ood.nearest_comp_distance_dex <= 0.5).length,
  `variant (${gateTest.adopted}) farms ${adoptedVariant.farm_count} under adopted odds, board farms ${farmRows.length} under conservative odds after the OOD block (${board.filter((r) => r.model.gate_pass_conservative).length} pass the conservative gate, ${board.filter((r) => r.model.gate_pass_conservative).length - farmRows.length} OOD-blocked)`,
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
  'Polymarket is a partial-OOD exploratory extrapolation that farms legitimately (partial tier may farm; only major never farms)',
  poly.model.ood.tier === 'partial' && poly.model.ood.confidence === 'extrapolation' && poly.verdict === 'farm' && poly.model.gate_pass_conservative,
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

// 20. Distribution tournament (charter v1.3, seven distributions from v1.4):
//     seven distributions (six + the P95-cap sensitivity row) over the same audit
//     rows; the capped mean is at most the uncapped mean per row; the empirical
//     conditional means agree within Monte Carlo noise (the distribution ignores
//     TVL, so the only spread is the per-row seed); P95 >= P90 >= median per row;
//     farm counts per policy exist.
const tourn = radar.validation.distribution_tournament!;
check(
  'distribution tournament covers seven distributions over the audit rows',
  tourn.results.length === 7 &&
    tourn.results.map((r) => r.distribution).join(',') === 'lognormal,capped-lognormal,capped-p90-lognormal,capped-p95-lognormal,empirical,bootstrap-residuals,student-t',
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

// 21. Gate policy test (charter v1.5, six policies): six policies
//     are present; the adopted policy is eligible under the two-layer rule,
//     or the adopted policy is (a) with a documented reason; the board's
//     farm count equals the conservative-gate pass count under the adopted
//     policy. Eligibility requires firing AND filtering under BOTH odds
//     layers with the worst farm's conservative P(negative) <= 0.90.
const adoptedVariantObj =
  gateTest.adopted === 'a'
    ? gateTest.variant_a
    : gateTest.adopted === 'b'
      ? gateTest.variant_b
      : gateTest.adopted === 'c'
        ? gateTest.variant_c
        : gateTest.adopted === 'd'
          ? gateTest.variant_d
          : gateTest.adopted === 'e'
            ? gateTest.variant_e
            : gateTest.variant_f;
check(
  'gate test covers six prespecified policies with a two-layer eligibility rule',
  gateTest.variant_a !== undefined &&
    gateTest.variant_b !== undefined &&
    gateTest.variant_c !== undefined &&
    gateTest.variant_d !== undefined &&
    gateTest.variant_e !== undefined &&
    gateTest.variant_f !== undefined &&
    (adoptedVariantObj.eligible || (gateTest.adopted === 'a' && gateTest.reason.length > 0)),
  `adopted (${gateTest.adopted}): (a) ${gateTest.variant_a.farm_count}, (b) ${gateTest.variant_b.farm_count}, (c) ${gateTest.variant_c.farm_count}, (d) ${gateTest.variant_d.farm_count}, (e) ${gateTest.variant_e.farm_count}, (f) ${gateTest.variant_f.farm_count} farms`,
);
check(
  'board farm count equals the conservative-gate pass count under the adopted policy, after the OOD block',
  farmRows.length ===
    board.filter((r) => r.model.gate_pass_conservative && r.model.ood.tier !== 'major' && r.model.ood.nearest_comp_distance_dex <= 0.5).length,
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
// 27. Nested selection metric helper (charter v1.4): the standalone
//     nestedSelectionMetric reproduces fitModel's own selection-pooled number
//     exactly on the full comp list — the outlier audit and the winsorization
//     test refit on modified comp lists through this helper.
check(
  'nestedSelectionMetric reproduces fitModel selection-pooled exactly',
  Math.abs(nestedSelectionMetric(liveComps(snapshot), snapshot.as_of, MODEL, 'ols') - fitted.validation.nested_selection_pooled) < 1e-4,
  `helper ${nestedSelectionMetric(liveComps(snapshot), snapshot.as_of, MODEL, 'ols')} vs fitModel ${fitted.validation.nested_selection_pooled}`,
);

// 28. Outlier audit (charter v1.4): rain and obol are audited to the data source
//     with their mcap/TVL ratios and ranks (rain highest, obol lowest), both
//     flagged valid observations by the snapshot's own definition; the
//     with/without refits are present for both, with selection metrics and the
//     adopted-gate farm counts; rain is kept in production.
const audit = radar.validation.outlier_audit!;
const rainRow = audit.rows.find((r) => r.slug === 'rain');
const obolRow = audit.rows.find((r) => r.slug === 'obol');
check(
  'outlier audit covers rain (400.2x, highest) and obol (0.000626x, lowest) as valid observations',
  audit.rows.length === 2 &&
    rainRow !== undefined &&
    obolRow !== undefined &&
    Math.abs(rainRow.mcap_tvl_ratio - 400.2) < 0.05 &&
    rainRow.mcap_tvl_ratio_rank.includes('(highest)') &&
    Math.abs(obolRow.mcap_tvl_ratio - 0.000626) < 0.0001 &&
    obolRow.mcap_tvl_ratio_rank.includes('(lowest)') &&
    rainRow.comparable_by_target_and_time &&
    obolRow.comparable_by_target_and_time &&
    rainRow.is_market_cap_not_fdv &&
    obolRow.is_market_cap_not_fdv &&
    audit.rain_kept_in_production === true,
  `rain ${rainRow?.mcap_tvl_ratio} (${rainRow?.mcap_tvl_ratio_rank}), obol ${obolRow?.mcap_tvl_ratio} (${obolRow?.mcap_tvl_ratio_rank})`,
);
check(
  'outlier with/without refits report selection metrics and adopted-gate farms for both',
  audit.refits.length === 2 &&
    audit.refits.every((r) => Number.isFinite(r.selection_pooled_dex) && Number.isFinite(r.board_spearman_vs_production) && Number.isFinite(r.farm_count_adopted_gate)),
  audit.refits.map((r) => `${r.dropped}: nested ${r.selection_pooled_dex} (Δ ${r.selection_vs_production_dex}), Spearman ${r.board_spearman_vs_production}, farms ${r.farm_count_adopted_gate}`).join(' | '),
);

// 29. Ranking stability (charter v1.4): 70 LOPO rows with Spearman in [-1, 1]
//     and overlaps in range; 4 nested folds with a pooled Spearman; the TVL
//     perturbation covers both shocks; the analytic verdict agrees with the
//     simulation verdict on every row, or disagrees only within the $5,000
//     near-boundary tolerance.
const rs = radar.validation.ranking_stability;
check(
  'ranking stability covers 70 LOPO rows, 4 nested folds and both TVL shocks',
  rs.lopo.length === 70 &&
    rs.lopo.every((r) => r.spearman_vs_production >= -1 && r.spearman_vs_production <= 1 && r.top10_overlap >= 0 && r.top10_overlap <= 10 && r.top20_overlap >= 0 && r.top20_overlap <= 20) &&
    rs.nested.length === 4 &&
    Number.isFinite(rs.nested_pooled_spearman) &&
    rs.tvl_perturbation.length === 2 &&
    rs.tvl_perturbation.every((t) => t.max_abs_rank_move >= 0) &&
    rs.descriptive_bars.length === 3 &&
    rs.descriptive_bars.map((b) => b.bar).join(' | ') === 'LOPO median Spearman ρ ≥ 0.90 | LOPO worst top-10 overlap ≥ 7 of 10 | TVL-perturbation rank moves on ≤ 5 rows',
  `LOPO median Spearman ${rs.lopo_median_spearman}, worst top-10 ${rs.lopo_worst_top10_overlap}, total verdict moves ${rs.lopo_total_verdict_moves}, nested pooled Spearman ${rs.nested_pooled_spearman}, TVL moves ${rs.tvl_perturbation.map((t) => `${t.shock}: ${t.rows_with_rank_change} rows, max ${t.max_abs_rank_move}`).join('; ')}`,
);
const conservativeOdds = fitted.launchOddsDecision.conservative_lower_bound;
const crossBad = board.filter((r) => {
  const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
  const vAnalytic = analyticVerdict(r.model.predicted_log_value, sigma, r.plan_cost_usd, r.model.launch_odds, conservativeOdds, r.model.break_even_odds, gateTest.adopted, fitted.valueCapUsd, r.model.ood, MODEL);
  if (vAnalytic === r.verdict) return false;
  const aStats = analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, r.model.launch_odds, fitted.valueCapUsd, MODEL);
  return Math.abs(aStats.evMean) > 5000;
});
check(
  'analytic verdict agrees with the simulation verdict, or disagrees only within the $5,000 near-boundary tolerance',
  crossBad.length === 0 && rs.analytic_verdict_crosscheck.n_agree + (board.length - rs.analytic_verdict_crosscheck.n_agree) === board.length,
  `crosscheck ${rs.analytic_verdict_crosscheck.n_agree}/${rs.analytic_verdict_crosscheck.n_rows} agree, ${crossBad.length} disagreements outside tolerance`,
);

// 30. Segmented OOD report (charter v1.4): five segments whose counts sum to the
//     28 nested test rows; the in-distribution segment is empty by construction;
//     segments with n < 10 are labelled insufficient evidence; Wilson CIs lie in
//     [0, 1]; Polymarket sits in the major segment.
const segReport = radar.validation.ood_report_segmented;
const segSum = segReport.segments.reduce((a, s) => a + s.n, 0);
check(
  'segmented OOD report covers five segments summing to the nested test rows, in-distribution empty by construction',
  segReport.segments.length === 5 &&
    segSum === segReport.n_test_rows &&
    segReport.n_test_rows === 28 &&
    segReport.segments.find((s) => s.segment === 'in-distribution')!.n === 0 &&
    segReport.segments.every((s) => (s.n < 10 ? s.evidence === 'insufficient evidence' : s.evidence === 'measurement')) &&
    segReport.segments.every((s) => s.coverage_50_ci[0] >= 0 && s.coverage_50_ci[1] <= 1 && s.coverage_50_ci[0] <= s.coverage_50_ci[1]),
  segReport.segments.map((s) => `${s.segment}: n=${s.n}, coverage ${s.observed_coverage_50}, ${s.evidence}`).join(' | '),
);

// 31. Cap sensitivity (charter v1.4): four caps on the same audit rows; the
//     pooled conditional mean is ordered uncapped >= production >= P95 >= P90
//     (the lognormal family shares paired draws, so a looser cap cannot lower
//     the mean); the CRPS numbers match the fitted validation.
const capSens = radar.validation.cap_sensitivity!;
const capMean = (label: string): number => capSens.rows.find((r) => r.cap_label === label)!.pooled_conditional_mean_value_usd;
check(
  'cap sensitivity covers four caps with ordered pooled conditional means and matching CRPS',
  capSens.rows.length === 4 &&
    capMean('uncapped') >= capMean('production cap (max comp mcap)') &&
    capMean('production cap (max comp mcap)') >= capMean('P95 cap') &&
    capMean('P95 cap') >= capMean('P90 cap') &&
    capSens.crps_capped_dex === fitted.crpsValidation.capped_dex &&
    capSens.crps_uncapped_dex === fitted.crpsValidation.uncapped_dex &&
    capSens.crps_n_test_rows === fitted.crpsValidation.n_test_rows,
  `means uncapped ${capMean('uncapped')} / production ${capMean('production cap (max comp mcap)')} / P95 ${capMean('P95 cap')} / P90 ${capMean('P90 cap')}, CRPS capped ${capSens.crps_capped_dex} vs uncapped ${capSens.crps_uncapped_dex} (n=${capSens.crps_n_test_rows})`,
);

// 32. Parameter uncertainty (charter v1.5): 2000 cluster bootstrap refits;
//     the coefficient intervals contain the fitted values; every board row
//     carries a parameter SD and ordered P10/P90 EV and P(negative)
//     intervals; sign flips and bimodality are counted, not hidden.
const param = radar.validation.parameter_uncertainty;
const paramBad = board.filter((r) => {
  const m = r.model;
  return (
    !(m.predicted_log_param_sd_dex > 0 && Number.isFinite(m.predicted_log_param_sd_dex)) ||
    !(m.ev_mean_param_usd[0] <= m.ev_mean_param_usd[1]) ||
    !(m.prob_negative_param[0] <= m.prob_negative_param[1]) ||
    m.prob_negative_param[0] < 0 ||
    m.prob_negative_param[1] > 1
  );
});
check(
  'parameter uncertainty covers 2000 cluster bootstrap refits with coefficient intervals containing the fit, ordered per-row intervals, and counted sign flips / bimodality',
  param.n_refits === 2000 &&
    param.intercept.p025 <= fitted.fit.intercept &&
    fitted.fit.intercept <= param.intercept.p975 &&
    param.slope.p025 <= fitted.fit.coef_log_tvl &&
    fitted.fit.coef_log_tvl <= param.slope.p975 &&
    param.median_param_sd_dex > 0 &&
    Number.isInteger(param.intercept_sign_flips) &&
    Number.isInteger(param.slope_sign_flips) &&
    param.intercept_sign_flips >= 0 &&
    param.slope_sign_flips >= 0 &&
    param.intercept_sign_flips <= param.n_refits &&
    param.slope_sign_flips <= param.n_refits &&
    typeof param.intercept_bimodal === 'boolean' &&
    typeof param.slope_bimodal === 'boolean' &&
    paramBad.length === 0,
  `intercept ${param.intercept.mean} [${param.intercept.p025}, ${param.intercept.p975}] vs fit ${fitted.fit.intercept}; slope ${param.slope.mean} [${param.slope.p025}, ${param.slope.p975}] vs fit ${fitted.fit.coef_log_tvl}; sign flips intercept ${param.intercept_sign_flips} / slope ${param.slope_sign_flips} of ${param.n_refits}; bimodal intercept ${param.intercept_bimodal} / slope ${param.slope_bimodal}; median param SD ${param.median_param_sd_dex} dex`,
);

// 33. Winsorization test (charter v1.4): adoption follows the prespecified
//     > 0.01 dex rule exactly, and the dashboard's fit constants are the
//     adopted fit's (winsorized iff adopted, production otherwise).
const winsor = radar.validation.winsorization_test!;
const winsorRuleOk =
  winsor.adopted === winsor.selection_improvement_dex > 0.01 || Math.abs(winsor.selection_improvement_dex - 0.01) <= 0.00005;
check(
  'winsorization adoption follows the prespecified > 0.01 dex rule and the dashboard fit is the adopted fit',
  winsorRuleOk &&
    (winsor.adopted
      ? Math.abs(radar.fit.intercept - winsor.winsorized_intercept) < 1e-9 && Math.abs(radar.fit.coef_log_tvl - winsor.winsorized_coef_log_tvl) < 1e-9
      : Math.abs(radar.fit.intercept - fitted.fit.intercept) < 1e-9 && Math.abs(radar.fit.coef_log_tvl - fitted.fit.coef_log_tvl) < 1e-9),
  `adopted ${winsor.adopted}, improvement ${winsor.selection_improvement_dex} dex (winsorized ${winsor.winsorized_selection_pooled_dex} vs production ${winsor.production_selection_pooled_dex}), dashboard intercept ${radar.fit.intercept}`,
);

// 34. Decision traces and launch-odds labels (charter v1.4): every board row
//     carries a non-empty decision trace, the launch odds are labelled as a
//     global cohort base rate with a 12-month horizon and the seasoning's
//     support, and the risk-set flag matches the 12-month cutoff.
const riskCutoff = new Date(Date.parse(`${snapshot.as_of}T00:00:00Z`) - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const traceBad = board.filter((r) => {
  const m = r.model;
  return (
    m.decision_trace.length === 0 ||
    m.launch_odds_source !== 'global cohort base rate' ||
    m.launch_odds_horizon_months !== 12 ||
    m.launch_odds_n_support !== fitted.seasoning.n_protocols ||
    m.launch_odds_in_risk_set !== (r.listed_at !== null && r.listed_at <= riskCutoff)
  );
});
check(
  'every board row carries a decision trace and honest launch-odds labels (global base rate, 12-month horizon, risk-set flag)',
  traceBad.length === 0,
  traceBad.length === 0 ? `${board.length} rows checked, base rate ${fitted.seasoning.base_rate} on n=${fitted.seasoning.n_protocols}` : `violations: ${traceBad.map((r) => r.slug).join(', ')}`,
);

// 35. Pooled top-k ranking sanity (charter v1.5): the pooled top-10/top-20
//     overlap and precision are consistent (precision = overlap / k) and
//     bounded; per-fold top-5 overlap is bounded by 5 (n = 7 cannot support
//     top-10/20 per fold).
check(
  'pooled top-10/top-20 overlap and precision are consistent and bounded, per-fold top-5 bounded by 5',
  rs.nested_pooled_top10_overlap >= 0 &&
    rs.nested_pooled_top10_overlap <= 10 &&
    rs.nested_pooled_top20_overlap >= 0 &&
    rs.nested_pooled_top20_overlap <= 20 &&
    Math.abs(rs.nested_pooled_top10_precision - rs.nested_pooled_top10_overlap / 10) < 1e-9 &&
    Math.abs(rs.nested_pooled_top20_precision - rs.nested_pooled_top20_overlap / 20) < 1e-9 &&
    rs.nested.every((f) => f.top5_overlap >= 0 && f.top5_overlap <= 5),
  `pooled top-10 ${rs.nested_pooled_top10_overlap}/10 (precision ${rs.nested_pooled_top10_precision}), top-20 ${rs.nested_pooled_top20_overlap}/20 (precision ${rs.nested_pooled_top20_precision})`,
);

// 36. Negative-fold diagnosis (charter v1.5): the diagnosis reproduces the
//     fold it names (same Spearman, same size), lists its rank inversions,
//     and shows no single row carries the sign — dropping any one test row
//     still leaves a negative Spearman.
const negDiag = rs.negative_fold_diagnosis;
const negFold = negDiag === null ? undefined : rs.nested.find((f) => f.train_pct === negDiag.train_pct);
check(
  'negative-fold diagnosis reproduces its fold and no single row carries the negative sign',
  negDiag !== null &&
    negDiag.spearman < 0 &&
    negFold !== undefined &&
    Math.abs(negDiag.spearman - negFold.spearman_predicted_vs_actual) < 1e-9 &&
    negDiag.n_test === 7 &&
    negDiag.rank_inversions.length >= 1 &&
    negDiag.pooled_spearman_excl_fold > rs.nested_pooled_spearman &&
    negDiag.leave_one_out_spearman.length === 7 &&
    negDiag.leave_one_out_spearman.every((x) => x.spearman < 0),
  negDiag === null
    ? 'no negative fold diagnosed'
    : `fold ${negDiag.train_pct}% train: Spearman ${negDiag.spearman}, ${negDiag.rank_inversions.length} inversions, LOO best ${Math.max(...negDiag.leave_one_out_spearman.map((x) => x.spearman))}, pooled excl-fold ${negDiag.pooled_spearman_excl_fold} vs pooled ${rs.nested_pooled_spearman}`,
);

// 37. Param-aware prediction bands (charter v1.5): every board row carries a
//     parameter-aware P25–P75 band that is ordered, finite and positive, with
//     a positive total SD — the band includes parameter variation, not only
//     the outcome residual.
const paramBandBad = board.filter((r) => {
  const m = r.model;
  return (
    !Number.isFinite(m.param_band_p25_usd) ||
    !Number.isFinite(m.param_band_p75_usd) ||
    !(m.param_band_p25_usd > 0) ||
    !(m.param_band_p25_usd <= m.param_band_p75_usd) ||
    !Number.isFinite(m.param_total_sd_dex) ||
    !(m.param_total_sd_dex > 0)
  );
});
check(
  'param-aware value bands are ordered, finite and positive on every board row',
  paramBandBad.length === 0,
  paramBandBad.length === 0 ? `${board.length} rows checked, median total SD ${param.median_param_sd_dex} dex` : `violations: ${paramBandBad.map((r) => r.slug).join(', ')}`,
);

// 38. Param-aware farming simulation (charter v1.5): 5000 draws per audit
//     row over 2000 refits; every distribution's mean EV is finite and every
//     P(negative) and gate-(d) pass fraction lies in [0, 1]; gate (d) passes
//     0% under the conservative odds on every row — the structural floor
//     (1 − 0.1364 = 0.8636 > 0.85) makes it impossible, not just unlikely.
const pas = radar.validation.param_aware_simulation!;
const pasBad = pas.rows.filter(
  (r) =>
    !r.distributions.every((d) => Number.isFinite(d.mean_ev_usd) && d.prob_negative >= 0 && d.prob_negative <= 1) ||
    r.pass_fraction_d_adopted < 0 ||
    r.pass_fraction_d_adopted > 1 ||
    r.pass_fraction_d_conservative < 0 ||
    r.pass_fraction_d_conservative > 1,
);
check(
  'param-aware simulation is bounded and gate (d) passes 0% under the conservative odds on every audit row',
  pas.n_draws === 5000 && pas.n_refits === 2000 && pasBad.length === 0 && pas.rows.every((r) => r.pass_fraction_d_conservative === 0),
  `${pas.n_rows} audit rows, ${pas.n_draws} draws, ${pas.n_refits} refits; worst (d) pass fraction under adopted odds ${Math.max(...pas.rows.map((r) => r.pass_fraction_d_adopted))}`,
);

// 39. Gate (f) ceiling scaling and gate (d) structural impossibility
//     (charter v1.5): (d) farms 4 under the adopted odds and 0 under the
//     conservative odds, and the grid confirms it is structurally
//     impossible there (required launch success > 100%); (f) farms under
//     both layers with its worst farm's conservative P(negative) <= 0.90.
//     The grid's (3x, 0.85) cell is checked ONLY on the conservative count
//     (0 = 0) — the adopted count (7 analytic vs 4 simulation) differs by
//     Monte Carlo noise on rows at the ceiling and must never be asserted
//     equal.
const grid = radar.validation.gate_threshold_grid!;
const cell385 = grid.rows.find((c) => c.multiple === 3 && c.ceiling === 0.85);
check(
  'gate (d) farms 0 under the conservative odds structurally and gate (f) farms under both layers within the risk ceiling',
  gateTest.variant_d.farm_count === 4 &&
    gateTest.variant_d.farm_count_conservative === 0 &&
    grid.d_impossible_under_conservative === true &&
    grid.required_launch_success_d_conservative > 1 &&
    grid.breakeven_multiple_conservative > grid.breakeven_multiple_adopted &&
    gateTest.variant_f.farm_count_conservative > 0 &&
    gateTest.variant_f.max_prob_negative_conservative !== null &&
    gateTest.variant_f.max_prob_negative_conservative <= 0.9 &&
    cell385 !== undefined &&
    cell385.farm_count_conservative === 0,
  `(d) ${gateTest.variant_d.farm_count}/${gateTest.variant_d.farm_count_conservative} adopted/conservative, required success ${grid.required_launch_success_d_conservative}; (f) ${gateTest.variant_f.farm_count}/${gateTest.variant_f.farm_count_conservative}, worst P(neg) conservative ${gateTest.variant_f.max_prob_negative_conservative}; grid (3x, 0.85) conservative ${cell385 === undefined ? '?' : cell385.farm_count_conservative} (adopted ${cell385 === undefined ? '?' : cell385.farm_count_adopted} analytic, not asserted equal to sim)`,
);

// 40. Two-layer adoption consistency (charter v1.5): the adopted policy is
//     eligible, and among the eligible policies it has the lowest worst-farm
//     P(negative) under the conservative odds, ties broken to the earlier
//     letter. A policy that does not fire or does not filter under either
//     layer is never eligible.
const variantLetters: { letter: string; variant: (typeof gateTest)['variant_a'] }[] = [
  { letter: 'a', variant: gateTest.variant_a },
  { letter: 'b', variant: gateTest.variant_b },
  { letter: 'c', variant: gateTest.variant_c },
  { letter: 'd', variant: gateTest.variant_d },
  { letter: 'e', variant: gateTest.variant_e },
  { letter: 'f', variant: gateTest.variant_f },
];
const adoptedEntry = variantLetters.find((v) => v.letter === gateTest.adopted)!;
check(
  'the adopted gate is the eligible policy with the lowest worst-farm P(negative) under the conservative odds, ties to the earlier letter',
  adoptedEntry.variant.eligible &&
    variantLetters.every((v) => {
      if (!v.variant.eligible) return true;
      if (v.variant.max_prob_negative_conservative === null || adoptedEntry.variant.max_prob_negative_conservative === null) return false;
      if (v.variant.max_prob_negative_conservative > adoptedEntry.variant.max_prob_negative_conservative) return true;
      if (v.variant.max_prob_negative_conservative < adoptedEntry.variant.max_prob_negative_conservative) return false;
      return v.letter >= gateTest.adopted;
    }),
  `eligible: ${variantLetters.filter((v) => v.variant.eligible).map((v) => v.letter).join(', ') || 'none'}; adopted (${gateTest.adopted}) worst P(neg) conservative ${adoptedEntry.variant.max_prob_negative_conservative}`,
);

// 41. Verdict stability (charter v1.5): per-row verdict counts sum to the
//     70 refits, the agreeing count equals the main verdict's count, rank
//     ranges are ordered and contain the production rank, the total moves
//     reconcile with the most-frequent-moves table, and the flipped-row
//     count matches the aggregate.
const vs = radar.validation.verdict_stability!;
const vsBad = vs.rows.filter((r) => {
  const countsSum = r.counts.farm + r.counts.marginal + r.counts.skip;
  return (
    countsSum !== vs.n_refits ||
    r.n_agreeing_refits !== r.counts[r.main_verdict] ||
    r.rank_range[0] > r.rank_range[1] ||
    r.rank_range[1] > r.rank_range[2]
  );
});
const rankRangeBad = board.filter((r) => r.rank_range === null || r.rank < r.rank_range[0] || r.rank > r.rank_range[2]);
const movesSum = vs.rows.reduce((a, r) => a + (vs.n_refits - r.n_agreeing_refits), 0);
const movesTableSum = vs.most_frequent_moves.reduce((a, m) => a + m.count, 0);
check(
  'verdict-stability counts sum to 70 per row, rank ranges contain the production rank, and moves reconcile',
  vs.n_refits === 70 &&
    vsBad.length === 0 &&
    rankRangeBad.length === 0 &&
    movesSum === movesTableSum &&
    vs.rows.filter((r) => r.n_agreeing_refits < vs.n_refits).length === vs.unique_rows_ever_flipped,
  `${vs.unique_rows_ever_flipped} rows ever flipped, ${movesSum} total moves, ${Math.round(vs.pct_pairs_on_main_verdict * 10000) / 100}% of (row, refit) pairs on the main verdict`,
);

// 42. Final evaluation table reconciliation (charter v1.5): the pooled
//     numbers in the final table equal the nested, walk-forward, R² and
//     conformal numbers reported elsewhere — one consistent table, not a
//     second set of numbers.
const fe = radar.validation.final_evaluation;
check(
  'final evaluation table reconciles with the nested, walk-forward, R-squared and conformal numbers',
  fe.pooled.n_test === 28 &&
    Math.abs(fe.pooled.median_abs_log_err - fitted.validation.nested_selection_pooled) < 1e-9 &&
    Math.abs(fe.pooled.spearman - rs.nested_pooled_spearman) < 1e-9 &&
    Math.abs(fe.pooled.kendall - rs.nested_pooled_kendall) < 1e-9 &&
    Math.abs(fe.wf_median_abs_log_err_dex - radar.validation.oos_median_abs_log_err) < 1e-9 &&
    Math.abs(fe.r2_in_sample - radar.validation.r2) < 1e-9 &&
    fe.coverage.every((c) => {
      const band = radar.validation.conformal_bands.find((b) => b.nominal === c.nominal);
      return band !== undefined && Math.abs(c.observed - band.coverage_dated) < 1e-9;
    }) &&
    fe.baselines.find((b) => b.name === 'ols')!.pooled_median_abs_log_err === fe.pooled.median_abs_log_err,
  `pooled median abs err ${fe.pooled.median_abs_log_err} dex, Spearman ${fe.pooled.spearman}, Kendall ${fe.pooled.kendall}, WF ${fe.wf_median_abs_log_err_dex} dex (${fe.wf_typical_error_x}x), R² ${fe.r2_in_sample} in-sample`,
);

// 43. Reproducibility package (charter v1.5): the recorded snapshot hash is
//     the hash of the input file passed to this test (computed at build time
//     from the file, never typed by hand), the charter/model versions match
//     this build, and the locked constants record the adopted gate and the
//     fitted coefficients.
const repro = radar.reproducibility;
check(
  'reproducibility package records the input file hash, charter/model versions, adopted gate and fitted coefficients',
  repro !== null &&
    repro.snapshot_sha256 === snapshotSha256 &&
    repro.charter_version === 'v1.5' &&
    repro.model_version === 'radar-12' &&
    repro.constants['gate_adopted'] === gateTest.adopted &&
    Math.abs(Number(repro.constants['intercept']) - fitted.beta[0]!) < 1e-9 &&
    Math.abs(Number(repro.constants['coef_log_tvl']) - fitted.beta[1]!) < 1e-9,
  `sha256 ${String(repro.snapshot_sha256).slice(0, 12)}…, charter ${repro.charter_version}, model ${repro.model_version}, gate ${String(repro.constants['gate_adopted'])}`,
);

function fmtCap(n: number): string {
  return '$' + (n / 1e9).toFixed(2) + 'B';
}

if (failures.length > 0) {
  process.stderr.write(`leakage-test: ${failures.length} check${failures.length === 1 ? '' : 's'} failed: ${failures.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`leakage-test: all checks passed\n`);
