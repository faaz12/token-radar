# Launch Radar: comps-fitted value tested out of sample, every farm plan costed with a verdict

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faaz12/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faaz12/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry (radar-8 model, evaluation charter v1.1).
It reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that
record no token, and ranks them by what their launch would be worth — then
hands in a dashboard a reader can use: the board, a detail view for every
protocol, and a farm plan for each one, every plan costed with a verdict
(farm / marginal / skip) from its expected net return with a safety margin.

## The model

Implied value is fitted, not hand-set. A log-log regression is fitted at run
time on the snapshot's own live-token comparables — since radar-8, only the
**70 dated** comparables (token trading, TVL and market cap positive, CEX
excluded, and only protocols the board could rank: the board's own wrapped /
staked / bridged / versioned / exchange-product exclusions are applied to the
training set too, so the curve is fitted on the population it prices). The 22
undated comparables are hard-gated out of every fit and calibration (below).
Three estimators — OLS, Huber, ridge (λ = 1.0 on the standardized log-TVL
slope) — are fitted on identical rows and folds, and the charter's
prespecified selection rule picks one: best nested 50–80 pooled median wins,
a gap under 0.01 dex prefers the simpler model (OLS > ridge > Huber), Huber
needs a P90 tail better than OLS by > 0.05 dex AND a smaller drop-one slope
change. R² is never the criterion. On this snapshot the rule selects **OLS**
(ridge 0.3164, OLS 0.3203, Huber 0.3387 — best and second-best differ by
0.0039 dex, within noise, so the simpler model wins):

```
log10(value if it launches) = b0 + b1*log10(tvl_usd + $25M)
              + category adjustment + main-chain adjustment
implied = round(10^predicted) x launch odds, clamped to [1, $100B]
```

There is **no growth term** in production. Radar-7's clamped growth carry
was removed: its coefficient is unstable across folds (−0.07 full fit,
+0.20…+1.00 in folds) and it is only the 7-day change, not a growth rate. A
signed-growth diagnostic (no clamp) is still fitted on identical splits and
reported only: walk-forward 0.4427 dex, nested pooled 0.3728 dex, CV 0.4214
dex, full-fit coefficient 0.5297, selection metric 0.362 vs 0.3387 for Huber
without growth — no improvement beyond 0.01 dex, so growth stays out.

The **size floor** ($25M) keeps the curve from pricing a small protocol at
zero for being small: TVL below $25M is noisy in the snapshot. The floor was
re-grid-searched over $10M–$250M for radar-6 and no floor dominates (see the
floor grid below); $25M is kept as the established floor, best on the
stratified split and mid-pack on every other metric. The **group
adjustments** are the median residual of the category and of the main chain,
each shrunk toward zero by n/(n+3): a group with one or two comps moves a
price a little, a group with fifteen moves it a lot. Full-size adjustments
failed the walk-forward test; shrunk ones did not.

Age is not a regression term. A separate **seasoning curve** — a logistic
fit of "has a token" on log10(age+1), fitted on all 645 dated protocols in
the snapshot (base launch rate 16.4%) — prices the odds that a protocol of a
given age ever launches a token, and the fitted value is multiplied by those
odds. A protocol that has run two years with no token is priced as a better
launch bet than one listed last month, and an undated protocol uses the base
rate. The curve's out-of-sample scores are audited in the dashboard
(reliability bins, bootstrap intervals, ROC/PR AUC, a Platt recalibration
tested on an untouched chronological set) — see the seasoning section below.

The fit is validated **four ways** at run time, and the dashboard shows all
four: walk-forward on the dated comparables only (oldest 70% fit, newest 30%
tested), nested expanding-window walk-forward (train on the oldest
50/60/70/80/90%, test on the next 10% forward in time), stratified
walk-forward (dated and undated comps each split 70/30), and 5-fold
cross-validation (fixed-seed shuffle). The time-based splits use a **30-day
purge gap**: training rows listed within 30 days before a test window are
dropped, so no fold learns from a token's unstable first month. The value band
is **cross-conformal**: the nominal-coverage quantile of the absolute
out-of-fold residuals from the 5-fold CV (70 dated residuals, finite-sample
corrected), so a 50% band holds about 50% of the comparables by construction.
A 200-refit bootstrap (fixed seed) is kept as a diagnostic on the fitted
value's wobble only. On this snapshot, OLS on 70 dated comps: intercept
3.7686, slope 0.4105, R² 0.4236, walk-forward median error 0.5145 dex
(3.27x), nested pooled 0.3284 dex (2.13x), selection pooled (folds 50–80)
0.3203 dex, untouched 90% fold 0.4073 dex (2.56x — used for no choice),
stratified 0.6047 dex (dated 0.5044, undated 0.6391), 5-fold CV 0.4012 dex
(2.52x), bootstrap ±0.2665 dex, value band ±0.4262 dex holding 51.4% of
dated comparables (80% band ±0.9769 dex holding 81.4%, 90% band ±1.4768 dex
holding 91.3%). The nested 80% fold is a hard outlier (1.0483 dex) and is
diagnosed in the dashboard, not dropped. No protocol name is ever
special-cased. The radar-7 comparison of 2.77x vs the leader's reported
3.21x is **not** claimed under charter v1.1: the targets are not the same
(snapshot market cap vs median FDV days 3–7), so the numbers are not
comparable.

## The undated comparables — investigated, not dated, not dropped

The 32 undated comparables in radar-5 (22 of the 92 in radar-6 and radar-7) cannot be dated
from this snapshot: the snapshot carries exactly ten fields per protocol and no
price or listing history beyond `listed_at`, which is empty for them. All 32
carry a CoinGecko id, but a CoinGecko listing date is not in the snapshot, and
hand-researching 32 launch dates from the web would be unverifiable, would break
the sealed-snapshot determinism (one snapshot in, one board out, no network),
and would not fix the errors anyway: the undated comps are structurally hard,
not merely misplaced in time. They are legacy and bridge-heavy — aave-v2 (the
AAVE token counted on v2 while v3 holds the TVL), canonical bridges whose TVL
is bridged assets while their market cap is their chain's token (mantle-bridge,
polygon-bridge, starknet-bridge, xdai-stake-bridge), and near-dead tokens with
~$0.1M caps (kava-lend, bifi, acryptos). Their stratified-test error is 0.6962
dex (4.97x), against 0.5454 dex for the dated comps in the same split, and in
5-fold cross-validation their median error is 0.78 dex against 0.41 dex for
dated comps (offline replication; the runtime CV seed differs, so these two are
checks, not dashboard numbers).

So radar-8 hard-gates them. Charter v1.1 excludes the 22 undated
comparables from **every** regression fit, group adjustment, cross-validation
fold, conformal calibration, baseline and bootstrap resample. They are scored
only as a reference table with the dated-only full fit, and their error is a
diagnostic, never a headline and never mixed into any fitted quantity. The
dated-only headline is the walk-forward 0.5145 dex; the undated error is
reported on its own: median signed residual −0.2768 dex (systematically
over-predicted), median absolute residual 0.6313 dex, and the dated 50% band
covers only 27.3% of them (80% band 68.2%, 90% band 86.4%) — a bias + width
effect of a different population, not a failure of the dated band, which was
never fitted to them. The mechanism is structural, not random: undated comps
are legacy protocols whose listing dates were never recorded; they are
systematically smaller (median market cap $4.8M vs $9.0M dated) and
over-predicted (median residual −0.277 vs −0.021 dated), so the missingness
itself carries signal about size.

## Model selection: OLS, Huber and ridge as co-equal candidates

No estimator is the default. Huber, OLS and ridge are fitted on identical
rows and folds and scored on the same splits, so the comparison isolates the
fitting method, and the charter's prespecified rule decides. On this snapshot:

| metric | OLS (selected) | Huber | Ridge (λ=1.0) |
|---|---|---|---|
| R² (in-sample) | 0.4236 | — (not computed for candidates; R² is never the criterion) | 0.4235 |
| Walk-forward 70/30, dated only (dex) | 0.5145 (3.27x) | 0.5039 (3.19x) | 0.5211 (3.32x) |
| Stratified walk-forward (dex) | 0.6047 (4.02x) | — | — |
| 5-fold CV (dex) | 0.4012 (2.52x) | 0.4183 (2.62x) | 0.4002 (2.51x) |
| Nested walk-forward pooled (dex) | 0.3284 (2.13x) | 0.3387 (2.18x) | 0.3319 (2.15x) |
| Nested 50–80 pooled, selection metric (dex) | 0.3203 | 0.3387 | **0.3164** |
| Selection P90 (dex) | 1.4718 | 1.4701 | 1.4686 |
| Drop-one slope change | 0.0056 | 0.0029 | 0.0055 |

Ridge wins the selection metric outright, but by 0.0039 dex over OLS — under
the 0.01 dex rule that is within noise, so the simpler model wins and OLS is
selected. Huber does not meet its own bar either: its P90 (1.4701) is not
better than OLS (1.4718) by > 0.05 dex, so its smaller drop-one slope change
does not rescue it. Paired per-observation differences (Huber minus OLS, 2000
bootstrap resamples, same observations, same folds): walk-forward median diff
+0.0033 dex, 95% interval [−0.0107, +0.0156], Huber better on 10/21; nested
pooled −0.0027, [−0.0131, +0.0083], 15/28; 5-fold CV +0.0007, [−0.0126,
+0.0096], 33/70. Every interval straddles zero: the fitters are statistically
indistinguishable on every split, so the selection is a tie-break by the
locked rule, not a victory. The radar-3 OLS (no floor, no adjustments, age in
the regression) scored R² 0.2079 and walk-forward 0.8136 dex (6.5x); the
radar-8 features alone, fitted by OLS, already reach R² 0.4236 — most of the
gain is the features, the floor and the aligned training population, not the
robust fit.

The nested walk-forward (dated comparables only; train on the oldest
50/60/70/80/90%, test on the next 10% forward in time, 30-day purge gap) also
re-checked the TVL floor. Pooled median error by floor (radar-7 experiments,
with the purge gap): $0M 0.3885 (2.45x), $10M 0.3446 (2.21x), **$25M 0.3728
(2.36x)**, $50M 0.3835 (2.42x), $100M 0.3786 (2.39x). No floor dominates: $10M
wins nested, $25M wins the walk-forward (0.4427 vs 0.4553 at $10M) and the
stratified split, $100M wins cross-validation (0.5012 vs 0.5478 at $25M).
Choosing the floor inside the training folds scores worse pooled (0.3885 vs
fixed $25M 0.3728) and flips per fold ($100M, $100M, $0M, $0M, $0M), so the
floor is a locked stability constant, not a tuned optimum, and the model keeps
the established $25M. The nested folds at $25M (OLS, radar-8) are 0.2747 /
0.3121 / 0.2329 / 1.0483 / 0.4073 — the 80% fold (7 newest comps) is a hard
outlier fold, and the pooled median, not any single fold, is the reported
number. The 80% fold is diagnosed in the dashboard, not dropped: its test
window (2025-09-30 → 2026-02-03) holds the newest listings, including
structural extremes — rain (Prediction Market, error 2.56 dex, under-predicted)
and obol (Staking Pool, error 1.81 dex, over-predicted) — and 3 of its 7 rows
are in categories with zero training comps, plus one unseen chain (Bittensor);
median signed error +0.6825 dex, so the fold is systematically under-predicted,
median TVL $201M, median age 375 days. The fold is kept and reported: it is
the data, not the estimator. The 90% fold (0.4073 dex, the newest 7 comps) is
the untouched final test — it was used for no choice of any kind.

## Target definition and survivorship bias

Two limits, stated plainly. The target is the market cap on the snapshot
date (2026-11-14), not a day-3-to-7 median FDV: the snapshot carries no price
history, so that definition cannot be verified or built from this data. If
the launch value is judged on a day-3-to-7 median instead, these numbers are
not that target. Market cap and FDV are never merged into one target, and
error-rate comparisons against other entries are valid only when target,
dates, and error definition match — the radar-7 comparison of 2.77x vs the
leader's reported 3.21x is not claimed under charter v1.1. And the training
set is survivors: 15 protocols in the snapshot hold a token with a zero
market cap and 14 more are listed on CoinGecko with no cap at all — the
visible dead — while tokens removed from the index entirely are invisible.
Failed launches never enter the training set, so the fitted values are
biased upward for the average protocol. The seasoning curve is calibrated on
the snapshot itself (actual vs predicted launch rate by age bin, Platt
adjusted: 0–90d 3.8% vs 2.9%, 90–180d 2.9% vs 6.8%, 180–365d 13.7% vs 11.6%,
365–730d 12.0% vs 19.2%, 730–1100d 17.1% vs 27.0%, 1100–1500d 26.4% vs 34.5%,
1500–2200d 33.9% vs 39.7%), and the dashboard shows the full table — note the
curve now over-predicts in the middle age bins after Platt recalibration.

## The launch-probability audit (charter v1.1)

Every farm verdict depends on the seasoning curve, so radar-8 audits it
instead of trusting it. On the 250 pooled fold-local predictions: ROC-AUC
0.5575, PR-AUC 0.24 against a base launch rate of 16.4% — the ranking signal
is weak. The improvement over predicting the base rate is **not
statistically significant**: the bootstrap 95% interval for the Brier
improvement is [−0.0067, +0.0025] and for log-loss [−0.0394, +0.0126] — both
straddle zero. The reliability bins show the curve under-predicts in its
biggest bin (predicted 5–10%, n=164: actual 14.0% vs predicted 7.5%). A Platt
recalibration (a = 0.5335, b = 1.0885) was adopted under the charter's
prespecified rule: fitted on fold-local predictions from cutoffs 50/60/70 and
tested on the untouched 80/90 set, it beats the raw curve on both Brier
(0.1144 vs 0.1170) and log-loss (0.3930 vs 0.4115). Honestly, though: on that
same untouched test set the **base rate itself** scores Brier 0.1131 and
log-loss 0.3864 — better than both the raw curve and the Platt curve. The
curve is kept because it ranks protocols by age where the base rate cannot,
not because it beats the base rate on the latest period. Verdict: the
seasoning curve is usable-with-caveats (pooled Brier 0.1194 vs base 0.1233,
log-loss 0.4097 vs base 0.4164, ECE 0.0648), and every farm EV inherits its
limits — the EV audit below shows the exposure.

## Farm verdicts and the EV audit

Every farm plan carries a **verdict** from its **expected net return**:
EV = launch odds × 0.25% × value-if-launches − plan cost, for a standard
$10,000 deposit (plus seven transactions of gas and the opportunity cost of
locking the deposit for the hold window at 10% a year). Charter v1.1 adds a
**safety margin: FARM only when EV is positive at BOTH the central value and
the P25 value**; marginal when EV is positive centrally but not at P25, or
negative with break-even odds at most 33%; skip otherwise. The audit table in
the dashboard shows, for the farm row and every row demoted by the margin
rule, the central / P25 / P75 EVs, the probability of a negative return, and
the P10 value with its EV. The assumptions are verified, not invented: farmer
share 0.25% of the launch value (assumed, not verified from data); exit value
= snapshot market cap (no slippage, no liquidity, no lockup modeled — the
snapshot carries no unlock schedule, no order-book depth, and no fee data, so
none is invented); farming costs = gas per chain + opportunity cost of the
$10,000 deposit at 10% annual over the hold window (60 days < 180d age, 45
days < 365d, else 30 days); a non-launch loses the full plan cost.

On this snapshot: **1 farm / 47 marginal / 150 skip**. The margin rule
demotes 16 rows that are EV-positive centrally: predict-fun, sentora-curator,
apex-omni, bitfi-basis, usdd, lofty, steakhouse-financial, veda,
estate-protocol, opentrade, symbiotic, b14g, hive-protocol, plume-vaults,
gauntlet, cian-yield-layer. The single farm is **polymarket-international**:
implied $34.4M (value if it launches $82.7M), launch odds 41.6% (Platt
adjusted), break-even 4.9%, EV central +$75,914, EV at P25 +$22,148, EV at P75
+$219,365, probability of a negative return 59.2%, P10 value $12.8M with EV
at P10 +$3,242. The top 5 by implied value: polymarket-international $34.4M
(41.6% / 4.9%, EV +$75,914), predict-fun $10.6M (25.3% / 9.6%, EV +$16,407,
P25 −$156 — marginal), sentora-curator $9.9M (15.8% / 6.5%, EV +$14,531),
apex-omni $6.7M (26.8% / 16.1%, EV +$6,694), bitfi-basis $6.6M (21.8% /
13.3%, EV +$6,418). The 41.6% next to Polymarket is its launch odds (p_L),
not its break-even odds (p_BE 4.9%). The top 5 by expected return are the
same as the top 5 by implied value. Radar-7's 11 farms shrank to 1 because
the margin rule and the dated-only OLS fit moved the numbers — not because
the board got worse, but because the verdict now has to survive its own
downside.

## What radar-7 changed

| change | what was tested | outcome |
|---|---|---|
| 30-day purge gap on time-based splits | 0/30/60/90/180 days on nested + walk-forward | 30d kept: nested 0.3728 (was 0.3857), WF 0.4427 (was 0.4435); 90d loses badly (0.4276) |
| Evaluation charter v1.0 locked before fitting | — | `EVALUATION_CHARTER.md`: question, target, population, splits, success rule, tuning boundary; radar-6 numbers are exploratory under it |
| Cross-conformal value band | bootstrap-only vs cross-conformal 50/80/90% | conformal kept: 50% ±0.5479 dex holds 51.1% (dated 55.7%, undated 36.4%); 80% ±1.0753 holds 81.5%; 90% ±1.4462 holds 91.3%; strict split-conformal (n=10 cal) secondary: ±0.4279 holds 36.4% |
| Seasoning validation (fold-local refits) | fold-local vs full fit; Brier / log-loss / ECE vs base rate | pooled Brier 0.1194 (base 0.1233), log-loss 0.4097 (base 0.4164), ECE 0.0648 → **usable-with-caveats**; the curve beats the base rate only slightly out of sample |
| EV verdicts | break-even-only vs EV = p_L × 0.25% × V − cost | EV kept: 11 farm / 37 marginal / 150 skip (was 6/42/150); 2 false farms fixed, 0 missed farms |
| Paired Huber-vs-OLS tournament | paired per-observation diffs, 2000 bootstrap resamples, identical folds | indistinguishable on every split (all 95% CIs straddle zero); Huber kept on robustness, not on metrics |
| Missingness handlings | (a) status quo, (b) impute 365d + indicator, (c) indicator-only | (a) kept: (b) loses (nested 0.4307), (c) ties primary, mixed elsewhere |
| Growth carry variants | clamp-0, signed, drop, raw fraction, tight winsor | clamp-0 kept: wins WF + CV, ties nested; coefficient unstable across folds (−0.07 full fit, +0.20…+1.00 in folds); 30d/90d growth untestable (snapshot carries only change_7d) |
| Shrunk category intercept | joint intercept vs post-hoc shrunk adjustments | post-hoc kept: joint improves nested/CV within noise but makes WF significantly worse (+0.0141, CI [+0.0008, +0.0255]) |
| Floor sensitivity + nested tuning | $0M/$10M/$25M/$50M/$100M, fixed vs tuned inside folds | $25M kept, locked: no floor dominates; nested tuning flips per fold and scores worse pooled |
| Statistical checks + leakage-injection tests | `validateSnapshot` + `scripts/leakage-test.ts` | 12 checks pass: future-dated, duplicate slug, negative TVL/mcap caught; features row-local; truncated refit identical; EV verdicts consistent |
| Truncation-invariance audit at build time | refit on snapshot truncated at each fold's purge cutoff | PASS on all 6 time-based folds (WF + 5 nested): beta + every group adjustment identical |

The seasoning audit also corrected an earlier experiment: its lower numbers
(Brier 0.055–0.101) against a 0.5 coin-flip baseline (Brier 0.25) could not be
reproduced under the charter's definition in three independent checks, so they
are discarded; the TypeScript numbers above stand, and the base-rate baseline
is the fit's own base rate, not a coin flip.

## What radar-8 changed

| change | what was tested | outcome |
|---|---|---|
| Radar-7 frozen as v1.0 before any fitting | two builds byte-identical; tag `radar-7-v1.0` on cd77d23; freeze dir with board, data, dossier, metrics, charter v1.0 | frozen; radar-7 numbers are exploratory under charter v1.1 |
| Charter bumped to v1.1, locked before fitting | — | `EVALUATION_CHARTER.md` v1.1: undated hard-gate, growth removed from production, EV safety margin, Platt rule, model-selection rule, untouched 90% fold |
| Undated comparables hard-gated | 22 undated excluded from every fit, adjustment, CV fold, conformal calibration, baseline, bootstrap | dated-only headline: WF 0.5145, nested 0.3284, CV 0.4012; undated reference table only (median signed residual −0.277 dex) |
| Model selection: OLS / Huber / ridge co-equal | prespecified rule on nested 50–80 pooled; <0.01 dex prefers simpler | **OLS selected** (ridge 0.3164, OLS 0.3203, Huber 0.3387; gap 0.0039 < 0.01) |
| Growth removed from production | signed-growth diagnostic (no clamp) on identical splits | stays out: selection metric 0.362 vs 0.3387 Huber-without-growth; coefficient unstable |
| Launch-probability audit | reliability bins, bootstrap CIs, ROC/PR AUC, Platt on chronological calibration set, untouched 80/90 test | Platt adopted (beats raw on both metrics on untouched test) — but base rate beats even Platt there (Brier 0.1131 vs 0.1144); reported honestly |
| EV safety margin | FARM iff EV > 0 at central AND P25 value | 1 farm / 47 marginal / 150 skip (was 11/37/150); 16 rows demoted; EV audit table with scenarios + P(negative return) + P10 |
| Nested 80% fold diagnostics | per-fold table: window, median TVL/age, unseen categories/chains, signed/abs/P90 error | 80% fold: 2025-09-30 → 2026-02-03, median signed +0.6825 (systematically under-predicted), rain 2.56 dex / obol 1.81 dex, 3 unseen categories + 1 unseen chain — kept, not deleted |
| Conformal subgroup coverage | dated vs undated at 50/80/90% | 50% ±0.4262 holds 51.4% dated / 27.3% undated; 80% ±0.9769 holds 81.4% / 68.2%; 90% ±1.4768 holds 91.4% / 86.4% |
| Target documented precisely | snapshot market cap defined; FDV as separate target, not available | 2.77x vs 3.21x comparison NOT claimed under v1.1 |
| Untouched final test | nested 90% fold (newest 7 comps), used for no choice | 0.4073 dex (2.56x) |
| Leakage tests updated | undated-exclusion + coef_growth === 0 + EV margin rule | 15 checks pass (see `scripts/leakage-test.ts`) |

The board covers all 198 rankable pre-token protocols: the 40-protocol
watchlist (TVL ≥ $50M, no token on record) plus every other pre-token
protocol in the snapshot. Wrapped, staked and bridged products of tokens that
already trade (WBTC, Binance staked ETH, USDT0 and the like) are set aside,
not ranked: their token already exists, so there is no launch to price.
Protocols whose token already trades are set aside
with their market caps shown — the comparables the board is priced on.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ required, standard library only, no network. The program writes
`board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the
output directory. Run it twice: both runs write the same bytes. The
leakage-injection self-test runs separately and exits non-zero on failure:

```sh
node scripts/leakage-test.ts --input <snapshot.json>
```

## Layout

- `main.ts` — entrypoint: reads the snapshot, validates it, writes the board, data, dashboard, screenshots and dossier.
- `lib/model.ts` — the fitted regression, the walk-forward validation, the farm plans with verdicts, and the board checks.
- `EVALUATION_CHARTER.md` — the locked evaluation charter (v1.1): question, target, population, splits, success rule, tuning boundary, leakage checks. Radar-7's v1.0 charter is preserved in the radar-7 freeze.
- `scripts/leakage-test.ts` — the leakage-injection self-test (11 checks; not copied to /output).
- `dashboard/` — the static page (index.html, app.css, app.js). Renders with no network.
- `screenshots/` — the board, a protocol's detail view, a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored from the kit).

## Caveat

Implied value is a model, not a promise. A protocol "records no token" in the
snapshot; that is DefiLlama's record, not proof it has none.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
