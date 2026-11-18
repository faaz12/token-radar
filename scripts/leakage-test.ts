// Leakage-injection self-test (radar-13, charter v1.6): verifies the pipeline catches
// doctored snapshots and that no feature or adjustment peeks past a fold's cutoff.
//
// Run from the entry directory:
//   node scripts/leakage-test.ts --input ../kit/token-radar-01-kit/input/snapshot.json
// Exit 0 iff every check passes; exit 1 naming the failing checks.
// scripts/ is not copied to /output, so this file never reaches the dossier.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EV_SIM_DRAWS, MODEL, ageDays, analyticGateStats, analyticLayerVerdict, borderlineInfo, buildRadar, features, fitModel, fitRegression, gatePasses, liveComps, nestedSelectionMetric, parseSnapshot, undatedComps, validateSnapshot, wilsonInterval } from '../lib/model.ts';
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

// 11. Verdicts are EV-based under the charter v1.6 decision engine: a farm row passes
//     the ADOPTED gate under the CONSERVATIVE launch odds (analytic statistics),
//     and no marginal row does unless it is OOD-blocked (major tier or nearest
//     comparable > 0.5 dex — 6 rows in radar-12) or demoted by a v1.6 guard
//     (BORDERLINE or UNSTABLE). The farm count may legitimately be ZERO — the gate is not
//     a quota, and this check must never require >= 1 farm. No skip row has a
//     positive ANALYTIC mean EV under the conservative odds or break-even odds
//     inside the marginal band (its adopted mean EV may be positive — that is
//     the adopted-marginal / conservative-skip case, and the production verdict
//     is skip by the frozen charter rule). The P25 > 0 requirement is
//     policy-(a)-only: under (b) a farm needs conditional mean EV > 3x plan cost,
//     under (c) P(negative) <= 0.90 — so the farm-row check is policy-aware,
//     never hard-coded to (a). The simulation no longer decides anything: the
//     analytic and simulated statistics describe the same distribution, and a
//     row sitting at the ceiling can pass one and miss the other by Monte Carlo
//     noise (radar-12: t3tris-finance passes (f) analytically under both layers
//     — adopted P(negative) 0.8765 vs ceiling 0.8768 — but its sim P(negative)
//     is 0.8771, 0.0003 over). Under v1.6 that row is BORDERLINE by the
//     prespecified rule, and the Wilson crosscheck bounds that class of
//     disagreement.
const { board, radar } = buildRadar(snapshot, MODEL, snapshotSha256);
const farmRows = board.filter((r) => r.verdict === 'farm');
const marginalRows = board.filter((r) => r.verdict === 'marginal');
const skipRows = board.filter((r) => r.verdict === 'skip');
// v1.6: the production verdict is the ANALYTIC verdict under the
// conservative odds, so every farm row's analytic conservative mean EV is
// positive (recomputed here from the closed form, not read off the sim).
const consOddsEarly = fitted.launchOddsDecision.conservative_lower_bound;
check(
  'every farm row passes the adopted gate under the conservative launch odds and has a positive analytic mean EV there',
  farmRows.every((r) => {
    const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
    const sC = analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, consOddsEarly, fitted.valueCapUsd, MODEL);
    return r.model.gate_pass_conservative && sC.evMean > 0;
  }),
  `${farmRows.length} farm rows (0 is legitimate — the gate is not a quota)`,
);
check(
  'no marginal row passes the adopted gate under the conservative launch odds unless OOD-blocked or demoted by a v1.6 guard',
  marginalRows.every(
    (r) =>
      !r.model.gate_pass_conservative ||
      r.model.ood.tier === 'major' ||
      r.model.ood.nearest_comp_distance_dex > 0.5 ||
      r.model.farm_demoted_reason !== null,
  ),
  `${marginalRows.length} marginal rows (${marginalRows.filter((r) => r.model.gate_pass_conservative).length} pass the gate but are OOD-blocked or guard-demoted to marginal)`,
);
// v1.6: a skip row is a row whose CONSERVATIVE verdict is skip — its
// analytic conservative mean EV is non-positive AND its break-even odds
// sit outside the marginal band. Its adopted mean EV may be positive:
// that is the adopted-marginal / conservative-skip case, and the
// production verdict is skip by the frozen charter rule.
check(
  'no skip row has a positive analytic expected net return under the conservative odds or break-even odds inside the marginal band',
  skipRows.every((r) => {
    const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
    const sC = analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, consOddsEarly, fitted.valueCapUsd, MODEL);
    return sC.evMean <= 0 && r.model.break_even_odds > MODEL.marginal_break_even;
  }),
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
              // conservative odds, and under v1.6 the verdict IS analytic — so
              // every farm row satisfies it EXACTLY (no Monte Carlo tolerance:
              // the simulation is only a cross-check now). Any exception is a
              // real gate failure.
              (() => {
                const consOdds = fitted.launchOddsDecision.conservative_lower_bound;
                const ceiling = 1 - 0.75 * consOdds;
                const perRow = farmRows.map((r) => {
                  const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
                  const sC = analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, consOdds, fitted.valueCapUsd, MODEL);
                  return { slug: r.slug, condOk: sC.conditionalMeanEv > 3 * r.plan_cost_usd, pnegGap: sC.probNegative - ceiling };
                });
                const exceptions = perRow.filter((x) => !x.condOk || x.pnegGap > 0);
                return exceptions.length === 0;
              })(),
  `adopted policy (${gateTest.adopted}), ${farmRows.length} farm rows`,
);
check(
  'gate-test table matches the board farms',
  adoptedVariant.farm_count === board.filter((r) => r.model.gate_pass_adopted).length &&
    farmRows.length ===
      board.filter((r) => r.model.gate_pass_conservative && r.model.ood.tier !== 'major' && r.model.ood.nearest_comp_distance_dex <= 0.5 && r.model.farm_demoted_reason === null).length,
  `variant (${gateTest.adopted}) farms ${adoptedVariant.farm_count} under adopted odds, board farms ${farmRows.length} under conservative odds after the OOD block and the v1.6 guards (${board.filter((r) => r.model.gate_pass_conservative).length} pass the conservative gate, ${board.filter((r) => r.model.gate_pass_conservative).length - farmRows.length} OOD-blocked or guard-demoted)`,
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
  'board farm count equals the conservative-gate pass count under the adopted policy, after the OOD block and the v1.6 guards',
  farmRows.length ===
    board.filter((r) => r.model.gate_pass_conservative && r.model.ood.tier !== 'major' && r.model.ood.nearest_comp_distance_dex <= 0.5 && r.model.farm_demoted_reason === null).length,
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

// 29. Ranking stability (charter v1.4, crosscheck charter v1.6): 70 LOPO rows
//     with Spearman in [-1, 1] and overlaps in range; 4 nested folds with a
//     pooled Spearman; the TVL perturbation covers both shocks; the analytic
//     verdict under the conservative odds IS the production verdict, so it
//     agrees with the board on every row except the BORDERLINE and stability
//     demotions — those disagreements are the guards working, and the set
//     of disagreements must equal exactly the set of guard-demoted rows.
//     The simulation cross-check is the Wilson containment: every row's
//     |sim − analytic| P(negative) gap is ≤ 0.02 on both layers, and the
//     Wilson miss count stays inside the binomial noise bound for a 95%
//     interval (mean 5% of 396 intervals; the 99.9% upper bound is 33).
//     NOTE: the charter's literal "every simulated P(negative) lies inside
//     its 95% Wilson interval" cannot hold for 396 intervals — a 95%
//     interval misses ~5% of rows by construction — so the check asserts
//     the statistically correct form (count within the binomial bound +
//     the 0.02 hard bound), not the literal wording.
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
const analyticDisagreements = board.filter((r) => {
  const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
  const vAnalytic = analyticLayerVerdict(r.model.predicted_log_value, sigma, r.plan_cost_usd, conservativeOdds, r.model.break_even_odds, gateTest.adopted, fitted.valueCapUsd, r.model.ood, MODEL);
  return vAnalytic !== r.verdict;
});
const guardDemoted = board.filter((r) => r.model.farm_demoted_reason !== null);
const wilsonMisses =
  board.filter((r) => {
    const [loA, hiA] = wilsonInterval(r.model.prob_negative_return, EV_SIM_DRAWS);
    return !(r.model.prob_negative_analytic >= loA && r.model.prob_negative_analytic <= hiA);
  }).length +
  board.filter((r) => {
    const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
    const sC = analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, conservativeOdds, fitted.valueCapUsd, MODEL);
    const [loC, hiC] = wilsonInterval(r.model.prob_negative_return_conservative, EV_SIM_DRAWS);
    return !(sC.probNegative >= loC && sC.probNegative <= hiC);
  }).length;
const maxSimAnalyticGap = Math.max(
  ...board.map((r) => {
    const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
    const sC = analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, conservativeOdds, fitted.valueCapUsd, MODEL);
    return Math.max(Math.abs(r.model.prob_negative_return - r.model.prob_negative_analytic), Math.abs(r.model.prob_negative_return_conservative - sC.probNegative));
  }),
);
check(
  'analytic verdict equals the board verdict except exactly on the guard-demoted rows, and the simulation agrees with the analytic P(negative) within Wilson noise and the 0.02 bound',
  analyticDisagreements.length === guardDemoted.length &&
    analyticDisagreements.every((r) => r.model.farm_demoted_reason !== null) &&
    guardDemoted.every((r) => analyticDisagreements.some((x) => x.slug === r.slug)) &&
    rs.analytic_verdict_crosscheck.n_agree + rs.analytic_verdict_crosscheck.n_demoted_by_guards === board.length &&
    rs.analytic_verdict_crosscheck.n_demoted_by_guards === guardDemoted.length &&
    wilsonMisses <= 33 &&
    maxSimAnalyticGap <= 0.02 &&
    Math.abs(rs.analytic_verdict_crosscheck.max_abs_sim_analytic_gap - maxSimAnalyticGap) < 0.001 &&
    rs.analytic_verdict_crosscheck.wilson_n_inside_adopted + rs.analytic_verdict_crosscheck.wilson_n_inside_conservative === 2 * board.length - wilsonMisses,
  `crosscheck ${rs.analytic_verdict_crosscheck.n_agree}/${rs.analytic_verdict_crosscheck.n_rows} agree, ${guardDemoted.length} guard-demoted (${guardDemoted.filter((r) => r.model.farm_demoted_reason === 'borderline').length} borderline, ${guardDemoted.filter((r) => r.model.farm_demoted_reason === 'unstable').length} unstable), Wilson misses ${wilsonMisses}/396, max |sim − analytic| gap ${maxSimAnalyticGap.toFixed(4)}`,
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
//     (charter v1.5, counts charter v1.6): (d) farms 7 analytically (4 by
//     simulation) under the adopted odds and 0 under the conservative odds,
//     and the grid confirms it is structurally impossible there (required
//     launch success > 100%); (f) farms 64 analytically (61 by simulation)
//     under both layers with its worst farm's conservative P(negative) <=
//     0.90. The analytic and simulation counts differ by Monte Carlo noise
//     on rows at the ceiling and must never be asserted equal — the
//     analytic count is the decision, the simulation count the cross-check.
//     The grid's (3x, 0.85) cell is checked ONLY on the conservative count
//     (0 = 0) — the adopted count (7 analytic vs 4 simulation) differs by
//     Monte Carlo noise on rows at the ceiling and must never be asserted
//     equal.
const grid = radar.validation.gate_threshold_grid!;
const cell385 = grid.rows.find((c) => c.multiple === 3 && c.ceiling === 0.85);
check(
  'gate (d) farms 0 under the conservative odds structurally and gate (f) farms under both layers within the risk ceiling (analytic counts, simulation within noise)',
  gateTest.variant_d.farm_count === 7 &&
    gateTest.variant_d.farm_count_sim === 4 &&
    gateTest.variant_d.farm_count_conservative === 0 &&
    grid.d_impossible_under_conservative === true &&
    grid.required_launch_success_d_conservative > 1 &&
    grid.breakeven_multiple_conservative > grid.breakeven_multiple_adopted &&
    gateTest.variant_f.farm_count === 64 &&
    gateTest.variant_f.farm_count_sim === 61 &&
    gateTest.variant_f.farm_count_conservative === 64 &&
    gateTest.variant_f.farm_count_conservative_sim === 61 &&
    gateTest.variant_f.max_prob_negative_conservative !== null &&
    gateTest.variant_f.max_prob_negative_conservative <= 0.9 &&
    cell385 !== undefined &&
    cell385.farm_count_conservative === 0,
  `(d) analytic ${gateTest.variant_d.farm_count}/${gateTest.variant_d.farm_count_conservative} (sim ${gateTest.variant_d.farm_count_sim}/${gateTest.variant_d.farm_count_conservative_sim}), required success ${grid.required_launch_success_d_conservative}; (f) analytic ${gateTest.variant_f.farm_count}/${gateTest.variant_f.farm_count_conservative} (sim ${gateTest.variant_f.farm_count_sim}/${gateTest.variant_f.farm_count_conservative_sim}), worst P(neg) conservative ${gateTest.variant_f.max_prob_negative_conservative}; grid (3x, 0.85) conservative ${cell385 === undefined ? '?' : cell385.farm_count_conservative} (adopted ${cell385 === undefined ? '?' : cell385.farm_count_adopted} analytic, not asserted equal to sim)`,
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

// 41. Verdict stability (charter v1.5, demotions charter v1.6): per-row verdict
//     counts sum to the 70 refits, the agreeing count equals the main
//     verdict's count, rank ranges are ordered and contain the production
//     rank, and the moves reconcile with the most-frequent-moves table on
//     the LOPO basis (the verdict the refits were compared against —
//     'farm' for a stability-demoted row, the main verdict otherwise).
//     The % of (row, refit) pairs on the main verdict is recomputed from
//     the rows, and the stability threshold is 35/70 with the demotion
//     count reconciling against the board's farm_demoted_reason flags.
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
const boardBySlug = new Map(board.map((r) => [r.slug, r]));
const movesSumLopoBasis = vs.rows.reduce((a, r) => {
  const lopoVerdict = boardBySlug.get(r.slug)?.model.farm_demoted_reason === 'unstable' ? 'farm' : r.main_verdict;
  return a + (vs.n_refits - r.counts[lopoVerdict]);
}, 0);
const movesTableSum = vs.most_frequent_moves.reduce((a, m) => a + m.count, 0);
const pctRecomputed = vs.rows.reduce((a, r) => a + r.n_agreeing_refits, 0) / Math.max(1, vs.rows.length * vs.n_refits);
const unstableDemotedBoard = board.filter((r) => r.model.farm_demoted_reason === 'unstable');
check(
  'verdict-stability counts sum to 70 per row, rank ranges contain the production rank, moves reconcile on the LOPO basis, and the stability threshold is 35/70',
  vs.n_refits === 70 &&
    vsBad.length === 0 &&
    rankRangeBad.length === 0 &&
    movesSumLopoBasis === movesTableSum &&
    Math.abs(vs.pct_pairs_on_main_verdict - pctRecomputed) < 1e-4 &&
    vs.rows.filter((r) => r.n_agreeing_refits < vs.n_refits).length === vs.unique_rows_ever_flipped &&
    vs.stability_threshold === 35 &&
    vs.n_stability_demoted === unstableDemotedBoard.length &&
    unstableDemotedBoard.every((r) => {
      const s = vs.rows.find((x) => x.slug === r.slug)!;
      return s.counts.farm < 35 && r.verdict === 'marginal';
    }) &&
    board
      .filter((r) => r.verdict === 'farm')
      .every((r) => {
        const s = vs.rows.find((x) => x.slug === r.slug)!;
        return s.counts.farm >= 35;
      }),
  `${vs.unique_rows_ever_flipped} rows ever flipped, ${movesSumLopoBasis} total moves (LOPO basis), ${Math.round(vs.pct_pairs_on_main_verdict * 10000) / 100}% of (row, refit) pairs on the main verdict, ${vs.n_stability_demoted} farms demoted by the 35/70 stability guard`,
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

// 43. Reproducibility package (charter v1.6): the recorded snapshot hash is
//     the hash of the input file passed to this test (computed at build time
//     from the file, never typed by hand), the charter/model versions match
//     this build, and the locked constants record the adopted gate and the
//     fitted coefficients.
const repro = radar.reproducibility;
check(
  'reproducibility package records the input file hash, charter/model versions, adopted gate and fitted coefficients',
  repro !== null &&
    repro.snapshot_sha256 === snapshotSha256 &&
    repro.charter_version === 'v1.6' &&
    repro.model_version === 'radar-13' &&
    repro.constants['gate_adopted'] === gateTest.adopted &&
    Math.abs(Number(repro.constants['intercept']) - fitted.beta[0]!) < 1e-9 &&
    Math.abs(Number(repro.constants['coef_log_tvl']) - fitted.beta[1]!) < 1e-9,
  `sha256 ${String(repro.snapshot_sha256).slice(0, 12)}…, charter ${repro.charter_version}, model ${repro.model_version}, gate ${String(repro.constants['gate_adopted'])}`,
);

// 44. Two verdicts (charter v1.6): every row's adopted and conservative
//     verdicts recompute from the analytic statistics under the two odds
//     layers; the production verdict IS the conservative verdict except
//     for the recorded demotions; conditional_farm is true exactly when
//     the adopted verdict is farm and the conservative verdict is not.
const adoptedOdds = fitted.seasoning.base_rate;
const twoVerdictBad = board.filter((r) => {
  const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
  const vA = analyticLayerVerdict(r.model.predicted_log_value, sigma, r.plan_cost_usd, adoptedOdds, r.model.break_even_odds, gateTest.adopted, fitted.valueCapUsd, r.model.ood, MODEL);
  const vC = analyticLayerVerdict(r.model.predicted_log_value, sigma, r.plan_cost_usd, conservativeOdds, r.model.break_even_odds, gateTest.adopted, fitted.valueCapUsd, r.model.ood, MODEL);
  const expectedProduction = r.model.farm_demoted_reason !== null ? 'marginal' : vC;
  return (
    r.model.verdict_adopted !== vA ||
    r.model.verdict_conservative !== vC ||
    r.verdict !== expectedProduction ||
    r.model.conditional_farm !== (vA === 'farm' && vC !== 'farm')
  );
});
check(
  'two verdicts recompute from the analytic statistics and the production verdict is the conservative verdict except for the recorded demotions',
  twoVerdictBad.length === 0,
  twoVerdictBad.length === 0
    ? `${board.length} rows checked, ${board.filter((r) => r.model.conditional_farm).length} conditional farms, ${board.filter((r) => r.model.farm_demoted_reason !== null).length} guard-demoted`
    : `violations: ${twoVerdictBad.map((r) => r.slug).join(', ')}`,
);

// 45. BORDERLINE (charter v1.6): the borderline flag and reason recompute
//     from the prespecified rule (analytic P(negative) within ±0.01 of a
//     layer ceiling, or analytic/sim gate disagreement); every borderline
//     row is MARGINAL with a reason; no borderline row is FARM or SKIP;
//     tau-labs and t3tris-finance — the two rows ChatGPT named — are
//     borderline marginals under the rule, not hand-edited.
const borderlineBad = board.filter((r) => {
  const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
  const sA = analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, adoptedOdds, fitted.valueCapUsd, MODEL);
  const sC = analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, conservativeOdds, fitted.valueCapUsd, MODEL);
  const gAA = gatePasses(gateTest.adopted, sA, adoptedOdds);
  const gAC = gatePasses(gateTest.adopted, sC, conservativeOdds);
  const gSA = gatePasses(gateTest.adopted, { evMean: r.model.expected_value_usd, evP25: r.model.ev_p25_usd, evP50: r.model.ev_p50_usd, evP75: r.model.ev_p75_usd, conditionalMeanEv: r.model.ev_conditional_mean_usd, planCost: r.plan_cost_usd, probNegative: r.model.prob_negative_return }, adoptedOdds);
  const gSC = gatePasses(gateTest.adopted, { evMean: r.model.ev_mean_conservative_usd, evP25: r.model.ev_p25_conservative_usd, evP50: r.model.ev_p50_conservative_usd, evP75: r.model.ev_p75_conservative_usd, conditionalMeanEv: r.model.ev_conditional_mean_usd, planCost: r.plan_cost_usd, probNegative: r.model.prob_negative_return_conservative }, conservativeOdds);
  const bl = borderlineInfo(sA.probNegative, sC.probNegative, gAA, gAC, gSA, gSC, gateTest.adopted, adoptedOdds, conservativeOdds);
  return (
    r.model.borderline !== bl.borderline ||
    r.model.borderline_reason !== bl.reason ||
    (bl.borderline && (r.verdict !== 'marginal' || r.model.borderline_reason === null))
  );
});
const tauLabs = board.find((r) => r.slug === 'tau-labs')!;
const t3tris = board.find((r) => r.slug === 't3tris-finance')!;
check(
  'BORDERLINE recomputes from the prespecified rule, every borderline row is MARGINAL with a reason, and tau-labs / t3tris-finance are borderline marginals',
  borderlineBad.length === 0 &&
    board.filter((r) => r.model.borderline).every((r) => r.verdict === 'marginal') &&
    tauLabs.model.borderline === true &&
    tauLabs.verdict === 'marginal' &&
    t3tris.model.borderline === true &&
    t3tris.verdict === 'marginal',
  `${board.filter((r) => r.model.borderline).length} borderline rows, all marginal; tau-labs ${tauLabs.model.borderline_reason}; t3tris ${t3tris.model.borderline_reason}`,
);

// 46. Gate-test analytic/sim consistency (charter v1.6): the analytic farm
//     counts recompute from the board rows' predicted log, sigma and plan
//     cost under both layers; the simulation counts sit within Monte Carlo
//     noise of the analytic counts (≤ 6 per variant per layer — the observed
//     max difference is 4); the analytic counts decide, the simulation is
//     the cross-check.
const gateAnalyticBad: string[] = [];
for (const v of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
  const variant = gateTest[`variant_${v}`];
  let nA = 0;
  let nC = 0;
  for (const r of board) {
    const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
    if (gatePasses(v, analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, adoptedOdds, fitted.valueCapUsd, MODEL), adoptedOdds)) nA++;
    if (gatePasses(v, analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, conservativeOdds, fitted.valueCapUsd, MODEL), conservativeOdds)) nC++;
  }
  if (variant.farm_count !== nA || variant.farm_count_conservative !== nC) gateAnalyticBad.push(`${v}: table ${variant.farm_count}/${variant.farm_count_conservative} vs recomputed ${nA}/${nC}`);
  if (Math.abs(variant.farm_count - variant.farm_count_sim) > 6 || Math.abs(variant.farm_count_conservative - variant.farm_count_conservative_sim) > 6) {
    gateAnalyticBad.push(`${v}: sim ${variant.farm_count_sim}/${variant.farm_count_conservative_sim} more than 6 from analytic ${variant.farm_count}/${variant.farm_count_conservative}`);
  }
}
check(
  'gate-test analytic farm counts recompute from the board rows and the simulation counts sit within Monte Carlo noise (≤ 6)',
  gateAnalyticBad.length === 0,
  gateAnalyticBad.length === 0 ? `adopted (f) analytic ${gateTest.variant_f.farm_count} vs sim ${gateTest.variant_f.farm_count_sim}` : gateAnalyticBad.join('; '),
);

// 47. Ranking tournament (charter v1.6): the OLS row reproduces the nested
//     pooled ranking numbers exactly (the fit is unchanged); per-fold test
//     counts sum to 28; the OLS per-fold Spearman values match the nested
//     ranking rows; the adoption rule is applied correctly from the rows.
const tourney = radar.validation.ranking_tournament!;
const olsTourney = tourney.rows.find((r) => r.model === 'ols')!;
const tourneyBar = (r: (typeof tourney.rows)[number]): boolean =>
  r.pooled_spearman >= olsTourney.pooled_spearman + 0.1 && r.pooled_kendall >= olsTourney.pooled_kendall + 0.05 && r.pooled_top10_overlap >= olsTourney.pooled_top10_overlap;
const tourneyPassing = tourney.rows.filter((r) => r.model !== 'ols' && tourneyBar(r));
const tourneyAdoptedExpected =
  tourneyPassing.length > 0 ? [...tourneyPassing].sort((a, b) => b.pooled_spearman - a.pooled_spearman || b.pooled_kendall - a.pooled_kendall)[0]!.model : 'ols';
check(
  'ranking tournament OLS row reproduces the nested pooled ranking numbers and the adoption bar is applied correctly',
  Math.abs(olsTourney.pooled_spearman - rs.nested_pooled_spearman) < 1e-9 &&
    Math.abs(olsTourney.pooled_kendall - rs.nested_pooled_kendall) < 1e-9 &&
    olsTourney.pooled_top10_overlap === rs.nested_pooled_top10_overlap &&
    olsTourney.pooled_top20_overlap === rs.nested_pooled_top20_overlap &&
    olsTourney.per_fold.reduce((a, f) => a + f.n_test, 0) === 28 &&
    olsTourney.per_fold.every((f) => {
      const nested = rs.nested.find((n) => n.train_pct === f.train_pct)!;
      return Math.abs(f.spearman - nested.spearman_predicted_vs_actual) < 1e-9 && Math.abs(f.kendall - nested.kendall_predicted_vs_actual) < 1e-9;
    }) &&
    tourney.rows.every((r) => Math.abs(r.pooled_top10_precision - r.pooled_top10_overlap / 10) < 1e-9 && Math.abs(r.pooled_top20_precision - r.pooled_top20_overlap / 20) < 1e-9) &&
    tourney.adopted === tourneyAdoptedExpected &&
    tourney.benchmark === 'ols',
  `OLS pooled Spearman ${olsTourney.pooled_spearman} (nested ${rs.nested_pooled_spearman}), Kendall ${olsTourney.pooled_kendall}; challengers TVL-only ${tourney.rows.find((r) => r.model === 'tvl-only')!.pooled_spearman}, median-by-category ${tourney.rows.find((r) => r.model === 'median-by-category')!.pooled_spearman}, global-median ${tourney.rows.find((r) => r.model === 'global-median')!.pooled_spearman}; adopted ${tourney.adopted}`,
);

// 48. Cohort ranking (charter v1.6): the listing-date terciles sum to the 28
//     pooled selection rows; the listing-year cohorts sum to the 70 dated
//     comps; the fold-80 cohorts match the negative-fold diagnosis rows'
//     cohorts; the 2025–2026 cohort's pooled Spearman drops when the
//     fold-80 rows are included (the fold's failure is concentrated there).
const cohortRanking = radar.validation.cohort_ranking!;
const cohortOfTest = (listedAt: string): string => {
  const y = Number(listedAt.slice(0, 4));
  if (y <= 2022) return '2021–2022';
  if (y === 2023) return '2023';
  if (y === 2024) return '2024';
  return '2025–2026';
};
const diagCohorts = [...new Set((rs.negative_fold_diagnosis?.rows ?? []).map((r) => cohortOfTest(snapshot.protocols.find((pp) => pp.slug === r.slug)!.listed_at!)))].sort();
const cohort2025With = cohortRanking.pooled_spearman_by_cohort_with_fold80.find((r) => r.group === '2025–2026')!;
const cohort2025Excl = cohortRanking.pooled_spearman_by_cohort_excl_fold80.find((r) => r.group === '2025–2026')!;
check(
  'cohort ranking terciles sum to 28, year cohorts sum to 70, fold-80 cohorts match the diagnosis, and the 2025–2026 Spearman drops with the fold',
  cohortRanking.by_listing_tercile.reduce((a, r) => a + r.n, 0) === 28 &&
    cohortRanking.by_listing_year_cohort.reduce((a, r) => a + r.n, 0) === 70 &&
    JSON.stringify(cohortRanking.fold80_cohorts) === JSON.stringify(diagCohorts) &&
    cohortRanking.pooled_spearman_by_cohort_with_fold80.reduce((a, r) => a + r.n, 0) === 28 &&
    cohortRanking.pooled_spearman_by_cohort_excl_fold80.reduce((a, r) => a + r.n, 0) === 21 &&
    cohort2025With.spearman !== null &&
    cohort2025Excl.spearman !== null &&
    cohort2025With.spearman < cohort2025Excl.spearman,
  `terciles ${cohortRanking.by_listing_tercile.map((r) => `${r.group.split(' ')[0]}:${r.spearman}`).join(', ')}; fold-80 cohorts ${cohortRanking.fold80_cohorts.join(', ')}; 2025–2026 pooled Spearman ${cohort2025With.spearman} with fold vs ${cohort2025Excl.spearman} without`,
);

// 49. Valuation-to-decision table (charter v1.6): 198 rows in board order,
//     and every number reconciles with board.json / data.js — implied
//     value, predicted log, both verdicts, borderline flag, stability
//     proportions, analytic P(negative) and the Wilson interval.
const valTable = radar.valuation_decision_table!;
const valBad = valTable.filter((t, i) => {
  const r = board[i]!;
  return (
    t.slug !== r.slug ||
    t.implied_value_usd !== r.implied_value_usd ||
    Math.abs(t.predicted_log_value - r.model.predicted_log_value) > 1e-9 ||
    t.verdict !== r.verdict ||
    t.verdict_adopted !== r.model.verdict_adopted ||
    t.verdict_conservative !== r.model.verdict_conservative ||
    t.conditional_farm !== r.model.conditional_farm ||
    t.borderline !== r.model.borderline ||
    t.borderline_reason !== r.model.borderline_reason ||
    t.stability_farm !== r.model.stability!.farm ||
    t.stability_marginal !== r.model.stability!.marginal ||
    t.stability_skip !== r.model.stability!.skip ||
    Math.abs(t.prob_negative_analytic_adopted - r.model.prob_negative_analytic) > 1e-9 ||
    t.prob_negative_sim_ci_adopted[0] !== r.model.prob_negative_sim_ci_adopted[0] ||
    t.prob_negative_sim_ci_adopted[1] !== r.model.prob_negative_sim_ci_adopted[1]
  );
});
check(
  'valuation-to-decision table has 198 rows in board order reconciling with the board on every field',
  valTable.length === 198 && valTable.length === board.length && valBad.length === 0,
  valBad.length === 0 ? `${valTable.length} rows, board order, all fields reconcile` : `violations: ${valBad.map((t) => t.slug).join(', ')}`,
);

// 50. Gate (f) audit (charter v1.6): the breakeven multiples recompute to
//     5.09× adopted / 6.33× conservative from the layer odds (1/p_L − 1);
//     the aggregates reconcile with the rows; a row's conditional multiple
//     above the breakeven multiple is exactly a positive expected net
//     return at that layer.
const gateFAudit = radar.validation.gate_f_audit!;
const beA = 1 / adoptedOdds - 1;
const beC = 1 / conservativeOdds - 1;
const gateFBad = gateFAudit.rows.filter((r) => {
  const aboveA = r.conditional_multiple > gateFAudit.breakeven_multiple_adopted;
  const aboveC = r.conditional_multiple > gateFAudit.breakeven_multiple_conservative;
  // The multiple is round4 and the EV is rounded to whole dollars, so a row
  // within $1 of zero may flip sign between the two; outside $1 they must agree.
  return (
    Math.abs(r.breakeven_multiple_adopted - gateFAudit.breakeven_multiple_adopted) > 1e-9 ||
    Math.abs(r.breakeven_multiple_conservative - gateFAudit.breakeven_multiple_conservative) > 1e-9 ||
    (aboveA && r.expected_net_return_adopted_usd < -1) ||
    (!aboveA && r.expected_net_return_adopted_usd > 1) ||
    (aboveC && r.expected_net_return_conservative_usd < -1) ||
    (!aboveC && r.expected_net_return_conservative_usd > 1) ||
    !(r.expected_net_return_param_usd[0] <= r.expected_net_return_param_usd[1])
  );
});
check(
  'gate (f) audit breakeven multiples recompute to 5.09×/6.33× and the aggregates reconcile with the rows',
  Math.abs(gateFAudit.breakeven_multiple_adopted - 5.09) < 0.005 &&
    Math.abs(gateFAudit.breakeven_multiple_conservative - 6.33) < 0.005 &&
    Math.abs(gateFAudit.breakeven_multiple_adopted - beA) < 0.001 &&
    Math.abs(gateFAudit.breakeven_multiple_conservative - beC) < 0.001 &&
    gateFAudit.n_candidates === gateFAudit.rows.length &&
    gateFAudit.n_positive_expected_return_adopted === gateFAudit.rows.filter((r) => r.expected_net_return_adopted_usd > 0).length &&
    gateFAudit.n_positive_expected_return_conservative === gateFAudit.rows.filter((r) => r.expected_net_return_conservative_usd > 0).length &&
    gateFAudit.n_below_breakeven_multiple_adopted === gateFAudit.rows.filter((r) => r.conditional_multiple < gateFAudit.breakeven_multiple_adopted).length &&
    gateFAudit.n_below_breakeven_multiple_conservative === gateFAudit.rows.filter((r) => r.conditional_multiple < gateFAudit.breakeven_multiple_conservative).length &&
    gateFBad.length === 0,
  `${gateFAudit.n_candidates} (f) candidates, ${gateFAudit.n_positive_expected_return_adopted} positive expected net return adopted / ${gateFAudit.n_positive_expected_return_conservative} conservative, ${gateFAudit.n_below_breakeven_multiple_adopted} below the adopted breakeven / ${gateFAudit.n_below_breakeven_multiple_conservative} below the conservative breakeven`,
);

// 51. Gate (f) audit rows are exactly the analytic-(f)-farm candidates
//     under the adopted odds: the audit set equals the gate test's (f)
//     farm set, recomputed from the board rows.
const auditSlugs = new Set(gateFAudit.rows.map((r) => r.slug));
const analyticFCandidates = board.filter((r) => {
  const sigma = fitted.bandHalfwidth > 0 ? (fitted.bandHalfwidth * r.model.ood.band_multiplier) / 0.6745 : 0.01;
  return gatePasses('f', analyticGateStats(r.model.predicted_log_value, sigma, r.plan_cost_usd, adoptedOdds, fitted.valueCapUsd, MODEL), adoptedOdds);
});
check(
  'gate (f) audit lists exactly the analytic-(f)-farm candidates under the adopted odds',
  auditSlugs.size === analyticFCandidates.length &&
    analyticFCandidates.every((r) => auditSlugs.has(r.slug)) &&
    gateFAudit.n_candidates === gateTest.variant_f.farm_count,
  `${gateFAudit.n_candidates} audit rows = gate (f) analytic farm count ${gateTest.variant_f.farm_count}`,
);

// 52. Board stability fields reconcile with the verdict-stability rows:
//     every board row's stability proportions equal its stability row's
//     counts, and stable_farm is true exactly for a production farm with
//     ≥ 35/70 refits agreeing.
const stabBad = board.filter((r) => {
  const s = vs.rows.find((x) => x.slug === r.slug)!;
  const m = r.model.stability!;
  return (
    m.farm !== s.counts.farm ||
    m.marginal !== s.counts.marginal ||
    m.skip !== s.counts.skip ||
    m.agreeing_refits !== s.n_agreeing_refits ||
    m.stable_farm !== (r.verdict === 'farm' ? s.counts.farm >= 35 : null)
  );
});
check(
  'board stability fields reconcile with the verdict-stability rows and stable_farm follows the 35/70 rule',
  stabBad.length === 0,
  stabBad.length === 0 ? `${board.length} rows checked, ${board.filter((r) => r.verdict === 'farm').length} farms all stable (≥ 35/70)` : `violations: ${stabBad.map((r) => r.slug).join(', ')}`,
);

function fmtCap(n: number): string {
  return '$' + (n / 1e9).toFixed(2) + 'B';
}

if (failures.length > 0) {
  process.stderr.write(`leakage-test: ${failures.length} check${failures.length === 1 ? '' : 's'} failed: ${failures.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`leakage-test: all checks passed\n`);
