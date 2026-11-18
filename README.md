# Launch Radar: comps-fitted value tested out of sample, every farm plan costed with a verdict

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faaz12/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faaz12/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry (radar-12 model, evaluation charter v1.5).
It reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that
record no token, and ranks them by what their launch would be worth — then
hands in a dashboard a reader can use: the board, a detail view for every
protocol, and a farm plan for each one, every plan costed with a verdict
(farm / marginal / skip) from its simulated expected net return, farm only
when the gate passes under conservative launch odds.

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
the snapshot (base launch rate 16.4%) — describes how the odds of ever
launching a token rise with age. Under charter v1.2 the curve is **diagnostic
only: the board uses the base rate (16.4%) for every row**, because the curve
does not beat the base rate on both Brier and log-loss on the untouched
chronological test set (see the launch-probability audit below), and its
improvement over the base rate is not statistically significant. A protocol
that has run two years with no token is still shown by the curve as a better
launch bet than one listed last month — but no verdict is priced on that
difference until a curve validates. The curve's out-of-sample scores are
audited in the dashboard (reliability bins, bootstrap intervals, ROC/PR AUC,
a Platt recalibration tested on an untouched chronological set, calibration
and discrimination reported separately per predictor).

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
3.21x is **not** claimed under charter v1.2: the targets are not the same
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
the established $25M. Re-run for radar-9 with the locked OLS fit and the
selection metric, the pooled error by floor is $0M 0.3242, $10M 0.3090,
**$25M 0.3203**, $50M 0.4191, $100M 0.6028: $10M wins by 0.011 dex, $100M
collapses, and choosing the floor inside the training folds ($25M, $50M,
$50M, $0M) scores 0.4191 pooled — worse than the locked $25M — so the floor
stays locked. The re-ranked boards stay close to the $25M board (Spearman ρ
0.974–0.995, top-20 overlap 18–20 of 20), so the floor moves the ranking
little even where it moves the fit. The nested folds at $25M (OLS, radar-8) are 0.2747 /
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
leader's reported 3.21x is not claimed under charter v1.2. And the training
set is survivors: 15 protocols in the snapshot hold a token with a zero
market cap and 14 more are listed on CoinGecko with no cap at all — the
visible dead — while tokens removed from the index entirely are invisible.
Failed launches never enter the training set, so the fitted values are
biased upward for the average protocol. The seasoning curve is calibrated on
the snapshot itself (actual vs predicted launch rate by age bin, raw curve:
0–90d 3.8% vs 2.4%, 90–180d 2.9% vs 5.2%, 180–365d 13.7% vs 8.6%,
365–730d 12.0% vs 14.1%, 730–1100d 17.1% vs 19.7%, 1100–1500d 26.4% vs
25.4%, 1500–2200d 33.9% vs 29.4%), and the dashboard shows the full table —
the curve under-predicts the 180–365d bin and over-predicts the 365–1100d
bins, and it is diagnostic only under v1.2.

## The launch-probability audit (charter v1.2)

No farm verdict depends on the seasoning curve any more — radar-9 audits it
and then sets it aside. On the 250 pooled fold-local predictions: ROC-AUC
0.5575, PR-AUC 0.24 against a base launch rate of 16.4% — the ranking signal
is weak. The improvement over predicting the base rate is **not
statistically significant**: the bootstrap 95% interval for the Brier
improvement is [−0.0067, +0.0025] and for log-loss [−0.0394, +0.0126] — both
straddle zero. The reliability bins show the curve under-predicts in its
biggest bin (predicted 5–10%, n=164: actual 14.0% vs predicted 7.5%). A Platt
recalibration (a = 0.5335, b = 1.0885) was fitted on fold-local predictions
from cutoffs 50/60/70 and tested on the untouched 80/90 set (n=100): it beats
the raw curve on both Brier (0.1144 vs 0.1170) and log-loss (0.3930 vs 0.4115)
— but it does **not** beat the base rate on both, so under the charter's
prespecified adoption rule it is **NOT adopted**. The base rate itself scores
Brier 0.1131 and log-loss 0.3864 on that untouched test set, better than both
the raw curve and the Platt curve. Calibration and discrimination, reported
separately on the same untouched rows: base rate ECE 0 / ROC-AUC 0.5; raw
curve ECE 0.0703 / ROC-AUC 0.6693; Platt curve ECE 0.0518 / ROC-AUC 0.6693 —
the curve discriminates a little (0.67 vs 0.5) but is worse calibrated and
worse scored overall than a constant. Verdict: the seasoning curve is
usable-with-caveats as a diagnostic (pooled Brier 0.1194 vs base 0.1233,
log-loss 0.4097 vs base 0.4164, ECE 0.0648), and the board prices every row
on the base rate until a better launch-probability model validates. The
conservative lower bound for the farm gate is the 2.5th percentile of a
2,000-resample bootstrap of the base rate over the 645 dated protocols
(seed 20261107): 13.64%.

## Farm verdicts and the EV audit

Every farm plan carries a **verdict** from its **expected net return**,
computed from **one seeded simulation array per protocol** (20,000 draws:
launch Bernoulli × lognormal value, σ from the 50% band / 0.6745, ×1.5 for
out-of-distribution rows). The mean of that array is the expected net
return — EV = p_L × 0.25% × E[value if it launches] − plan cost, for a
standard $10,000 deposit (plus seven transactions of gas and the opportunity
cost of locking the deposit for the hold window at 10% a year) — and the
P10/P25/P50/P75 and the probability of a negative return are quantiles of
the **same** array. The mean uses the lognormal MEAN of the value, not its
median: with σ ≈ 0.43–0.95 dex the mean sits far above the median, and the
mean is what an expected value is. Charter v1.2 adds a **stress test and a
gate: FARM only when the adopted gate passes under the CONSERVATIVE launch
odds** (the 13.64% bootstrap lower bound); marginal when the mean EV is
positive under the adopted odds but the gate fails the conservative test, or
negative with break-even odds at most 33%; skip otherwise. The audit table
in the dashboard shows, for every row with a positive mean EV, the mean EV
under all three launch-probability assumptions (base rate / Platt /
conservative), the P25 of the net return, P(negative) simulated and analytic,
and the gate flags. The assumptions are stated, not measured: farmer share
0.25% of the launch value (assumed, not verified from data); exit value =
snapshot market cap (no slippage, no liquidity, no lockup modeled — the
snapshot carries no unlock schedule, no order-book depth, and no fee data, so
none is invented); farming costs = gas per chain + opportunity cost of the
$10,000 deposit at 10% annual over the hold window (60 days < 180d age, 45
days < 365d, else 30 days); a non-launch loses the full plan cost.

**The radar-8 contradiction, and what caused it.** Radar-8 reported
Polymarket with "P25 EV +$22,148" and "P(negative) 59.2%" — mathematically
inconsistent: if 59.2% of outcomes are negative, the 25th percentile cannot
be positive. The cause was a mislabeled statistic: the "+$22,148" was the
expected value **at the P25 value conditional on launch** (p_L × 0.25% ×
V_P25 − cost), not a quantile of the net-return distribution, while P(neg)
was unconditional. Radar-9 fixes the math, not the label: every statistic
comes from the one simulation array. For Polymarket under the base rate the
corrected numbers are mean EV +$301,457, P25 of the net return −$10,084 (the
plan cost — 83.6% of draws are non-launches, a point mass at −cost), P50
−$10,084, P75 −$10,084, P90 +$93,013, P(negative) 84.9% simulated / 84.9%
analytic. Consistent at last: with 83.6% of the mass at −cost, the P25 must
be −cost, and the mean is positive only because the lognormal right tail is
enormous (E[value] ≈ $894M against a $82.7M median). The raw simulation
output for Polymarket is exported as `ev-simulation-polymarket.json` — the
full 20,000-draw array — so the contradiction can be checked draw by draw.
A leakage-injection check now enforces the consistency on all 198 rows
(monotone quantiles, P(neg) in [0, 1] and ≥ 1 − p_L, simulated vs analytic
P(neg) within 0.02).

**The gate test.** After the math was fixed, two candidate gates were tested
honestly on the corrected statistics with a rule prespecified before the
results were seen: adopt the variant that both fires (farms ≥ 1 row) and
filters (rejects ≥ 1 positive-mean-EV row through its additional condition);
if both qualify, the one with the lower maximum P(negative) among its farms;
if neither qualifies, keep the pre-existing rule (a) and report the farm
count as-is. Variant (a) — mean EV > 0 AND P25 of the net return > 0 —
farms **0** rows: with launch odds at the base rate (16.4%) the 25th
percentile of every row's net return is −cost. Variant (b) — the Gemini
proposal, mean EV > 0 AND the P50-to-P25 downside at most half the
P50-to-P75 upside — farms **all 151** positive-EV rows and filters nothing:
with launch odds below 50% the P50-to-P25 downside is exactly $0 (both
quantiles are −cost), so its additional condition never binds, and it would
farm rows with up to a 93% chance of loss. Neither variant both fires and
filters, so the prespecified rule keeps (a) and the board has **0 farms**.
That is the honest result of the base-rate model — a farm gate that cannot
fire while p_L stays below 25% — not a bug to engineer around.

On this snapshot: **0 farm / 151 marginal / 47 skip**. All 151
positive-mean-EV rows are marginal: the gate passes under the adopted odds
for none of them once the conservative test is applied, because every row's
P25 net return is −cost. The top 5 by implied value: polymarket-international
$13.6M (16.4% / 4.9%, EV +$301,457, P25 −$10,084, P(neg) 84.9%),
sentora-curator $10.3M (16.4% / 6.5%, EV +$61,769), predict-fun $6.9M
(16.4% / 9.6%, EV +$44,453), bittensor-dtao $5.8M (16.4% / 11.5%, EV
+$166,611), nonce-capital $5.2M (16.4% / 12.8%, EV +$154,849). The 16.4%
next to every row is its launch odds (p_L, the base rate), not its break-even
odds. The top 5 by expected return are NOT the same as the top 5 by implied
value — polymarket-international $301,457, bittensor-dtao $166,611,
nonce-capital $154,849, drakewell $114,387, veda $100,307 — because the mean
EV uses the lognormal mean, which grows with σ, and out-of-distribution rows
carry the ×1.5 wider band. Radar-8's single farm (Polymarket, on Platt odds
of 41.6%) is gone: under the base rate its P25 net return is −$10,084, so
the gate does not pass — not because the board got worse, but because the
verdict now has to survive its own downside, and the launch odds that
supported it did not validate.

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

## What radar-9 changed

| change | what was tested | outcome |
|---|---|---|
| Radar-8 frozen as v1.1 before any fitting | two builds byte-identical; tag `radar-8-v1.1` on 44dba0e; freeze dir with board, data, dossier, metrics, charter v1.1 | frozen; radar-8 numbers are exploratory under charter v1.2 |
| Charter bumped to v1.2, locked before fitting | — | `EVALUATION_CHARTER.md` v1.2: one-simulation EV, base-rate fallback, stress test, gate test, nested reconciliation, OOD detection, floor sensitivity, undated "unsupported estimates" |
| EV contradiction resolved | raw Polymarket simulation exported (`ev-simulation-polymarket.json`, full 20,000-draw array); all statistics recomputed from the one array | cause found: radar-8's "P25 EV +$22,148" was the EV at the P25 value conditional on launch, mislabeled as a net-return quantile. Corrected: P25 net return −$10,084, P(neg) 84.9% sim / 84.9% analytic — consistent |
| Platt replaced by base-rate fallback | base rate vs raw curve vs Platt on the same untouched 80/90 test rows; calibration (ECE) and discrimination (ROC-AUC) reported separately | **base rate adopted (16.4%)**: Brier 0.1131 / log-loss 0.3864 / ECE 0 / ROC 0.5 beats raw (0.1170 / 0.4115 / 0.0703 / 0.6693) and Platt (0.1144 / 0.3930 / 0.0518 / 0.6693) on both scoring rules; all 198 EVs recomputed |
| EV stress test | mean EV under base rate / Platt / conservative lower bound (13.64%); FARM only under the conservative assumption | 0 farms: every row's P25 net return is −cost under base-rate odds, so the conservative gate passes for no row |
| Gate test (two variants, prespecified rule) | (a) mean EV > 0 AND P25 > 0; (b) mean EV > 0 AND P50-to-P25 downside ≤ 50% of P50-to-P75 upside; adopt the variant that both fires and filters | neither fires and filters: (a) farms 0, (b) farms all 151 and filters nothing (its downside is $0 when p_L < 50%) — prespecified rule keeps (a); 0 farm / 151 marginal / 47 skip |
| Nested reconciliation | selection pooled (0.3203) vs all-folds pooled (0.3284) with exact observation sets, fold dates, aggregation rule | reconciled: the 0.0081 dex gap is the untouched 90% fold (7 newest comps, 0.4073 dex) included in one number and excluded from the other; both reproduce exactly |
| Out-of-distribution detection | chain / category seen in training, TVL / age in training range, nearest-comp distance, per row | **104 of 198 rows OOD** (54 unseen chain, 35 unseen category, 1 TVL out, 30 age out); OOD rows get a ×1.5 wider band and "extrapolation" confidence, never in-distribution confidence |
| TVL floor sensitivity | $0M/$10M/$25M/$50M/$100M with the selected estimator on the same 70 dated comps; floor chosen inside training folds only | $25M stays locked: selection pooled $0M 0.3242, $10M 0.3090, $25M 0.3203, $50M 0.4191, $100M 0.6028; per-fold floor choice scores 0.4191 pooled, worse than locked $25M; Spearman vs $25M board 0.974–0.995 |
| Undated labeled "unsupported estimates" | reference table kept, no calibrated bands | undated rows carry no verdict and no confidence band; error/coverage reported separately (dated-only 0.5044 dex, undated-only 0.6313 dex, 50% band covers 27.3% of undated) |
| Dashboard reworked to v1.2 | sandbox verdicts recomputed with the analytic equivalent of the simulation gate (closed-form lognormal mean + mixture quantiles, no Monte Carlo) | lede, model panel, seasoning (diagnostic), launch-odds decision, gate test, nested reconciliation, OOD, floor sensitivity, EV audit and detail view all show v1.2 numbers; sandbox re-ranks with the same gate |
| Leakage tests updated to v1.2 | EV consistency (monotone quantiles, P(neg) ≥ 1 − p_L, sim vs analytic ≤ 0.02), P25 = −cost below 25% odds, base-rate decision, nested reconciliation, OOD flags, floor grid, gate-test match | 24 checks pass (see `scripts/leakage-test.ts`); farm-count checks never require ≥ 1 farm |

The board covers all 198 rankable pre-token protocols: the 40-protocol
watchlist (TVL ≥ $50M, no token on record) plus every other pre-token
protocol in the snapshot. Wrapped, staked and bridged products of tokens that
already trade (WBTC, Binance staked ETH, USDT0 and the like) are set aside,
not ranked: their token already exists, so there is no launch to price.
Protocols whose token already trades are set aside
with their market caps shown — the comparables the board is priced on.

## What radar-10 changed

Radar-9 is frozen before any radar-10 fitting (`~/workspace/goals/make-fun-masuk-top-10-leaderboard/hidden_files/radar-9-freeze/`, commit `d44874b`, tag `radar-9-v1.2`). The valuation model is UNCHANGED — OLS 3.7686 / 0.4105, nested 0.3284, selection 0.3203, walk-forward 0.5145, CV 0.4012, R² 0.4236, untouched 90% fold 0.4073, all byte-identical to radar-9. What changed is the decision engine around it, under charter v1.3 (locked before fitting): both reviewer AIs said NO to submitting radar-9, for different reasons, and radar-10 reconciles them honestly — it validates first, and adopts nothing that does not beat the baseline out of sample.

| change | what was tested | outcome |
|---|---|---|
| Charter bumped to v1.3, locked before fitting | — | `EVALUATION_CHARTER.md` v1.3: distribution tournament, horizon launch probability with censoring, three prespecified gate policies with a risk ceiling, heuristic multiplier test, strict OOD tiers, validated band multiplier, LOPO influence, conformal slices, two-functions split (valuation radar vs farming decision engine), floor documentation |
| Distribution tournament (6 distributions, 5,000 draws each, paired) | lognormal, capped-lognormal (production), capped-P90-lognormal, empirical comparable values, bootstrap comparable residuals, Student-t (df=5); per row + pooled: conditional mean/median/P90/P95 value, mean net EV, median net return, P(negative), P(exceeds break-even); farm counts per policy per distribution | pooled conditional mean: lognormal $45.2M, capped $44.6M, P90-cap $31.5M, empirical $84.5M, bootstrap $131.1M, Student-t $245.6M. Policy (a) farms 0 under EVERY distribution; (b)/(c) farm 65–96 depending on distribution. The 0-farm result is not an artifact of one tail choice |
| Capped lognormal production distribution | cap = max observed dated-comp market cap ($2.65B, rain); CRPS on nested selection folds: capped 0.5065 vs uncapped 0.5058 dex on 28 test rows | cap kept (within the 10% tolerance). Polymarket's conditional mean value: $216M in radar-10's production simulation vs ~$894M in radar-9's uncapped, ×1.5-widened simulation |
| Gate test: three prespecified policies + risk ceiling | (a) strict: mean EV > 0 AND P25 > 0; (b) Gemini: conditional mean EV > 3× plan cost AND unconditional mean EV > 0; (c) P(loss) ceiling: mean EV > 0 AND P(negative) ≤ 0.90. Eligible iff fires AND filters AND worst farm's P(negative) ≤ 0.90; lowest max P(negative) wins, ties (a)→(b)→(c); none eligible → keep (a) | (a) 0 farms, (b) 96, (c) 96 — of 96 positive-EV rows. (b) and (c) fire but filter nothing; (a) never fires. None eligible → (a) kept, board 0 farm / 96 marginal / 102 skip (was 0 / 151 / 47 — the cap moved 55 rows from marginal to skip). P25 math corrected: P25 > 0 needs P(net return > 0) ≥ 75%, impossible at the 16.4% base rate |
| Horizon launch probability + survival test | event = launch within 12 months of listing; dated cohort 645 (launched 95, failed 11, disappeared 0, tokenless-resolved 392, tokenless-censored 147); risk set 485, rate 19.2% = UPPER BOUND (no launch date in snapshot); category-stratified survival candidate vs flat base rate on untouched chronological test (n=31) | NOT adopted: Brier 0.1407 vs 0.1363, log-loss 0.4646 vs 0.4454 — the flat base rate stands |
| Heuristic activity multiplier test | 1.5× active / 0.5× dormant, active = 7-day TVL change > 0 (documented proxy — the snapshot carries no points-program/testnet field); untouched 80/90 test (n=100) | NOT adopted: Brier 0.1181 vs 0.1131, log-loss 0.4133 vs 0.3864 — the flat base rate stands |
| OOD band multiplier validated | nested selection folds, OOD test rows (n=28), multipliers {×1.0, ×1.5, ×2.0}, smallest with 50% coverage ≥ 40% | ×1.0 adopted (53.6% coverage) — radar-9's ×1.5 widening was never validated and the data does not support it. OOD tiers: partial (1 flag) = extrapolation, major (2+ flags) = unsupported, never a production FARM; Polymarket is partial (unseen chain) |
| LOPO influence analysis | refit without each of 70 comps; max |Δ predicted log| over the board; error by category/chain/TVL tercile | FLAG: dropping rain moves some board row by 0.68 dex; obol moves the slope by 0.12. The board hinges on the rain outlier ($2.65B mcap, 400× TVL) |
| Conformal slices | coverage 50/80/90% by regime, TVL band, age band, OOD vs in-distribution, with Wilson 95% CIs; 90% quantile = 64th of 70, SE ≈ 0.036 | regime 43–61%, TVL 39–63%, age 46–57% at 50% — all within CI of nominal. The in-distribution OOD slice is EMPTY by construction (chronological folds make every test row age-OOD), so the OOD-vs-in-distribution comparison is vacuous and the multiplier validation covers age-OOD rows only — documented as a limitation |
| Two functions split on the dashboard | valuation radar (conditional value + uncertainty) vs farming decision engine | the radar ranks 198 protocols identically under every distribution; the engine reports 0 farms and never lowers a threshold to look active |
| Floor documented, unchanged | $10M 0.3090 vs $25M 0.3203 on the selection metric; per-fold floor choice 0.4191 pooled | $25M stays locked — the 0.0113 dex edge on 28 rows is within noise |
| Leakage tests updated to v1.3 | policy-aware farm check, 3-policy gate test, tournament invariants, horizon cohort, multiplier adoption rule, LOPO, conformal slices, capped sim, OOD tiers | 39 checks pass (see `scripts/leakage-test.ts`); farm-count checks never require ≥ 1 farm |
| Dashboard reworked to v1.3 | analytic EV now uses the capped lognormal mean (closed form) + capped quantiles; analytic gate implements all three v1.3 policies; new sections for the tournament, horizon cohort, multiplier tests, LOPO, conformal slices | lede, model panel, gate test, OOD, EV audit and detail view all show v1.3 numbers; sandbox re-ranks with the same capped gate |
| Screenshots regenerated | headless Chromium, 1-board + 2-detail at 1440×900, 3-filtered at 1440×1250 | all three < 512 KiB; visual check passed, no overlap or broken text |

## What radar-11 changed

Radar-10 is frozen before any radar-11 fitting (`~/workspace/goals/make-fun-masuk-top-10-leaderboard/hidden_files/radar-10-freeze/`, commit `49f2739`, tag `radar-10-v1.3`). The valuation model is UNCHANGED — OLS 3.7686 / 0.4105, nested 0.3284, selection 0.3203, walk-forward 0.5145, CV 0.4012, R² 0.4236, untouched 90% fold 0.4073, all byte-identical to radar-10. What changed is the evaluation around it, under charter v1.4 (locked before fitting): both reviewer AIs said NO to submitting radar-10 — Gemini flipped to YES only in a later message, ChatGPT stayed NO — and radar-11 answers ChatGPT's minimum: a finished outlier audit, reported ranking stability, honestly segmented OOD, the cap separated from model selection, parameter uncertainty, launch-odds labeling, and a decision trace per protocol. It also tests Gemini's two candidates under prespecified rules.

| change | what was tested | outcome |
|---|---|---|
| Charter bumped to v1.4, locked before fitting | — | `EVALUATION_CHARTER.md` v1.4: outlier audit, ranking stability, segmented OOD report, cap sensitivity, parameter uncertainty, launch-odds labels, decision traces, five prespecified gate policies, winsorization test |
| Outlier audit: rain and obol traced to source | protocol, snapshot date, TVL, market cap, market-cap source, chain, category, target definition, snapshot time; comparable by target/time, TVL consistency, market cap vs FDV | Both are VALID observations: market cap from DefiLlama at the 2026-11-14 snapshot date, positive TVL, same-date ratios — rain 400.2× (highest of 70), obol 0.000626× (lowest). Structurally different cases (thin TVL vs large token value; TVL-heavy vs token-light), not data errors. Rain is kept UNCAPPED in production. With/without refits: without rain intercept 3.2699 / slope 0.4689, nested 0.3203 (Δ 0), board Spearman 0.9788, top-10 6/10, farms 0; without obol intercept 2.8471 / slope 0.5305, nested 0.3203 (Δ 0), Spearman 0.9684, top-10 8/10, farms 0 |
| Ranking stability | nested walk-forward Spearman predicted-vs-actual per fold + pooled; LOPO over all 70 comps (Spearman, top-10/20 overlap, verdict moves); per-row ±10% TVL perturbation; analytic-vs-simulation verdict crosscheck | Nested pooled Spearman 0.2895 — a higher fitted value only weakly predicts a higher realised value (fold 80: −0.2857). LOPO median Spearman 0.9981, worst top-10 overlap 6 (rain) — the ORDER is stable, but VERDICTS flip: 543 verdict moves across 70 refits, because rows sit near the gate. ±10% TVL moves 177–178 of 198 rows' ranks (max 13 places) — the board is dense. Descriptive bars: 1 of 3 met. Analytic crosscheck: 192/198 agree, 6 disagreements all within the $5,000 near-boundary tolerance; 132 of 198 rows are near-boundary |
| Segmented OOD report | nested selection-fold test rows (n=28) vs the base 50% band, per segment: in-distribution, unseen-chain-only, unseen-category-only, partial-other, major; nominal vs observed coverage, Wilson 95% CI, halfwidth, signed residual | Partial-other n=12: observed 50%, CI [25.4%, 74.6%], signed residual +0.2806. Major n=16: 56.25%, CI [33.2%, 76.9%], +0.1516. In-distribution / unseen-chain-only / unseen-category-only: n=0 — "insufficient evidence", NOT validation. All 28 test rows are OOD by construction, so no OOD-vs-in-distribution comparison is possible (vacuous, documented). Polymarket sits in the major segment: exploratory extrapolation, never an OOD success |
| Cap sensitivity: cap as risk control | uncapped / P90 cap ($147.6M) / P95 cap ($190.6M) / production cap ($2.65B); pooled conditional mean, pooled mean EV, farm counts per policy, Polymarket mean EV; CRPS capped vs uncapped | Cap chosen on principle before any validation outcome; CRPS capped 0.5065 vs uncapped 0.5058 dex (n=28) — capped is slightly WORSE, so no accuracy claim is made for it. Adopted gate (d) farm count is 7 / 7 / 7 / 7 across all four caps — STABLE. (a) 0 everywhere; (b)/(c) 65–89; (e) 63–86 |
| Parameter uncertainty | 200 bootstrap refits (seed 20261119): intercept/slope mean, SD, 95% CI; per-row parameter SD of the predicted log value; P10/P90 of mean EV and P(negative) across refits | Intercept mean 3.6204, SD 1.4114, 95% CI [1.1345, 6.4028] — weakly identified; slope mean 0.4294, SD 0.1774, CI [0.0859, 0.7487]. Median parameter SD 0.2163 dex, max 0.5241 dex. Simulation intervals are outcome-only; the fit's own uncertainty is reported alongside, never folded into the band silently |
| Launch-odds labels | every row carries source, cohort, horizon, supporting observations, in-risk-set flag | 16.4% is labeled the global cohort base rate: all dated protocols in the 2026-11-14 snapshot (n=645), 12-month horizon, n_support 645 — a cohort rate, never an individual probability |
| Decision trace per protocol | every verdict states its reasons | e.g. Polymarket: "Gate (d) passes under the adopted launch odds but NOT under the conservative launch odds — demoted to marginal by the stress test. Mean EV is positive (+$76,057) but the gate does not pass — marginal, not farm." Shown in each row's detail view |
| Gate test: five prespecified policies | (a) strict; (b) conditional mean EV > 3× cost AND mean EV > 0; (c) mean EV > 0 AND P(negative) ≤ 0.90; (d) Gemini candidate: conditional mean EV > 3× cost AND P(negative) ≤ 0.85; (e) conditional mean EV > 5× cost AND mean EV > 0 AND P(negative) ≤ 0.90. Same eligibility + adoption rule | (a) 0, (b) 96, (c) 96, **(d) 4 — fires AND filters (rejects 92 of 96), max P(negative) 85% — ELIGIBLE and ADOPTED**, (e) 93. Board still 0 farms: all 4 of (d)'s farms fail the conservative-odds stress test (Polymarket P(negative) 83.8% → 86.6% > 0.85 ceiling). The gate can now fire and filter; the stress test is what keeps the board at 0 |
| Distribution tournament (7 distributions) | added capped-P95-lognormal; farm counts for all five policies per distribution | (a) 0 under EVERY distribution — the 0-farm result is not a tail artifact. Pooled conditional means: lognormal $45.2M, capped $44.6M, P90-cap $31.5M, P95-cap $33.7M, empirical $84.5M, bootstrap $131.1M, Student-t $245.6M. (d) 7 under every distribution in the tournament (vs 4 in the 20,000-draw gate test — Monte Carlo noise on near-boundary rows, documented) |
| Winsorization test: capping rain at P95 | cap dated comps' market caps at the 95th percentile ($190.6M — verified from the live comps, not the ~$1B–$1.5B guess) before ANY fitting; adopt only if nested selection-pooled error improves by > 0.01 dex | NOT adopted: winsorized nested 0.3203 vs production 0.3203 — improvement exactly 0 dex. Winsorized fit intercept 3.6229 / slope 0.425; winsorized LOPO max |Δ| 0.2981 vs production 0.6778; board Spearman 0.9971, top-10 9/10, farms 4 under the adopted gate. Rain stays uncapped — capping it would be a cosmetic fix for an outlier the data does not call an error |
| Leakage tests updated to v1.4 | 5-policy gate test, 7-distribution tournament, outlier audit, ranking stability incl. analytic crosscheck, segmented OOD, cap sensitivity, parameter uncertainty, winsorization rule + adopted-fit constants, decision traces + launch-odds labels | 49 checks pass (see `scripts/leakage-test.ts`); farm-count checks never require ≥ 1 farm |
| Dashboard reworked to v1.4 | lede + fact row (5 gate variants), gate section (5 policies, (d) adopted), tournament (7 distributions, 5 farm columns), detail view (parameter SD, EV/P(negative) param intervals, launch-odds labels, decision trace), six new sections (outlier audit, ranking stability, segmented OOD, cap sensitivity, parameter uncertainty, winsorization); analytic gate now implements all five policies; detail dialog widened to 600px so long values no longer clip | lede, model panel, gate test, OOD, EV audit and detail view all show v1.4 numbers; sandbox re-ranks with the same capped gate |
| Screenshots regenerated | headless Chromium, 1-board + 2-detail at 1440×900, 3-filtered at 1440×1250 | all three < 512 KiB; visual check passed, no overlap or broken text |

## What radar-12 changed

Radar-11 is frozen before any radar-12 fitting (`~/workspace/goals/make-fun-masuk-top-10-leaderboard/hidden_files/radar-11-freeze/`, commit `2afd3d8`, tag `radar-11-v1.4`). The valuation model is UNCHANGED — OLS 3.7686 / 0.4105, nested 0.3284, selection 0.3203, walk-forward 0.5145, CV 0.4012, R² 0.4236, untouched 90% fold 0.4073, all byte-identical to radar-11. What changed is the evaluation around it, under charter v1.5 (locked before fitting): ChatGPT said NO to submitting radar-11 on three blockers — the pooled out-of-sample Spearman is only 0.2895 with one negative fold, the regression parameters are weakly identified, and verdicts/rankings are sensitive to input changes and refits — and radar-12 answers all three in ChatGPT's own order: diagnose the negative fold first, complete the ranking evaluation, strengthen the bootstrap, fold parameter uncertainty into the farming simulation, audit gate (d) economically, and report verdict stability. Gemini said YES to radar-11; radar-12 does not re-litigate that, it does the work ChatGPT asked for.

| change | what was tested | outcome |
|---|---|---|
| Charter bumped to v1.5, locked before fitting | — | `EVALUATION_CHARTER.md` v1.5: negative-fold diagnosis, completed ranking evaluation, cluster bootstrap (2000 refits), parameter uncertainty in the farming simulation, gate (d) economic audit + threshold grid + candidate (f), verdict stability, final evaluation table, reproducibility package. One v1.4 defect fixed: the charter's OOD note said "(all 5 folds, 35 rows)" — the implementation uses the 4 selection folds, 28 rows |
| Negative-fold diagnosis | the 80% fold (Spearman −0.2857): TVL range, categories, chains, residuals, leave-one-out influence per comp, training window, unseen categories/chains | The fold inverts: 13 of 21 pairs inverted, Kendall −0.2381. No single row carries the sign — dropping any one test row still leaves a negative Spearman (best: rain, −0.0286). The two outliers pull in opposite directions on the same fold: rain (Prediction Market / Arbitrum, TVL $6.6M, mcap $2.65B, signed +2.5644, predicted rank 1, actual 1) and obol (Staking Pool / Ethereum, TVL $1.15B, mcap $717K, signed −1.8051, predicted 2, actual 7). Window 2025-09-30 → 2026-02-03; 3 unseen categories (Decentralized AI, Prediction Market, Staking Pool) + 1 unseen chain (Bittensor). Excluding the fold, pooled Spearman rises to 0.4922 — still weak, so the fold is not the whole story. The diagnosis is computed from the fold data, not asserted |
| Ranking evaluation completed | Spearman + Kendall per fold and pooled; pooled top-10/top-20 overlap + precision; per-fold top-3/top-5 (n = 7 cannot support top-10/20 per fold) | Per-fold Spearman 0.5714 / 0.4643 / 0.8571 / −0.2857; Kendall 0.4286 / 0.4286 / 0.7143 / −0.2381. Pooled Spearman 0.2895, Kendall 0.2063. Pooled top-10 overlap 4/10 (precision 0.4), top-20 15/20 (0.75). Per-fold top-3 2/2/3/1, top-5 4/4/4/3. Headline: the radar ranks weakly out of sample — a higher fitted value only weakly predicts a higher realised value, and the dashboard no longer claims otherwise |
| Cluster bootstrap: 2000 refits | protocol = resample unit (1 observation per protocol), full refit incl. group adjustments per refit, seed 20261119; coefficient distributions checked for multimodality (20-bin histogram) and sign flips; prediction bands now include parameter variation | Intercept mean 3.7797, SD 1.4849, 95% CI [1.0796, 6.8863]; slope mean 0.4088, SD 0.1872, CI [0.0188, 0.7537]. Sign flips: intercept 8, slope 40 (2%) of 2000. Neither distribution bimodal. Median parameter SD 0.2253 dex, max 0.552 dex. Param-aware band: total SD = √(outcome σ² + param SD²), P25–P75 widened accordingly on every row. The parameters are weakly identified — reported, not hidden |
| Parameter uncertainty in the farming simulation | 5000 draws per audit row × 3 distributions (capped-lognormal / lognormal / Student-t df=5); every draw folds a bootstrap-refit coefficient, a launch-odds draw from the 2000 base-rate bootstrap resamples, and the outcome residual; paired pass fractions for gate (d) over 2000 paired (refit, p_L) draws under both odds layers | Gate-(d) candidates pass 44–66% under the adopted odds (Polymarket 60.5%, sentora 65.9%, predict-fun 49.1%, bittensor-dtao 44.3%, nonce-capital 49.4%) and **0% under the conservative odds** — structural, as the audit predicts. Polymarket param-aware mean EV: capped-lognormal +$100,472 (P(neg) 0.848), lognormal +$124,628 (0.845), Student-t +$513,436 (0.840) — the heavy tail inflates the mean while P(neg) barely moves (set by the launch odds, not the tail). Production sim Polymarket EV was +$76,057; param-aware is higher because the refit-prediction distribution is convex in log space (Jensen) and p_L is drawn from the bootstrap |
| Gate (d) economic audit | why 3× cost and 85% downside; breakeven multiple (1 − p_L) / p_L per odds layer; required launch-success rate for the ceiling; threshold-sensitivity grid (multiples 1–6 × ceilings 0.80–0.95) under both layers; candidate (f) | The 3× multiple is a conditional-payoff screen, NOT a profitability proof: at the adopted odds a farm breaks even only if its conditional payoff exceeds **5.09×** the plan cost (**6.33×** under the conservative odds). The 85% ceiling demands ≥91.3% of launches clear breakeven at the adopted odds — and **110.0% under the conservative odds, which is impossible** (a rate above 100%): the structural floor on P(negative) there is 1 − 0.1364 = 0.8636 > 0.85. **The v1.4 board's 0 farms was a design outcome of pairing a fixed ceiling with the conservative stress test, not a data outcome.** Candidate (f) corrects the ceiling to 1 − 0.75 × p_L ("at least 75% of launches must clear breakeven") — adopted ceiling 0.8768, conservative 0.8977 — an odds-consistent correction, NOT a loosening to hit a farm count. Grid: (3×, 0.85) farms 7 analytic / 4 simulation under adopted odds (Monte Carlo noise at the ceiling — never asserted equal), 0 under conservative under both |
| Gate test: six policies, two-layer rule | (a)–(e) as before plus (f); every policy tested under BOTH odds layers; eligible iff fires AND filters under BOTH layers AND worst farm's conservative P(negative) ≤ 0.90; adopt the lowest worst-farm conservative P(negative), ties → earlier letter; none eligible → keep (a) | (a) 0/0, (b) 96/67, (c) 96/66, **(d) 4/0 — does not fire under the conservative odds → NOT eligible**, (e) 93/66 eligible, **(f) 61/61 eligible — ADOPTED** (worst farm's conservative P(negative) 0.8976 vs (e)'s 0.9000). Board: **55 farm / 41 marginal / 102 skip** (61 (f) farms under the conservative odds minus 6 OOD-blocked rows). The board's FARM count carries ±3 rows of Monte Carlo noise: analytic (f) farms 64 vs simulation 61 under both layers |
| Verdict stability | per row across the 70 LOPO refits: main verdict, counts per verdict, # agreeing refits, most frequent alternative, flip drivers; aggregates; rank ranges (min–median–max) per row, shown on the board and in the detail view | **72 unique rows ever flipped** (of 198); moves per row median 0, max 70; **93.39%** of (row, refit) pairs on the main verdict; most frequent moves: marginal→skip 377, marginal→farm 262, skip→marginal 151, farm→marginal 111, farm→skip 9, skip→farm 6; total moves 916 (was 543 under gate (a) — the increase is because gate (f) farms 55 rows, so many more rows sit near the farm boundary). Flippiest: waterline (marginal production, farm in 69/70 refits), tau-labs (farm production, marginal in 69/70 — its production verdict agrees with ZERO refits), communityv3 (marginal production, skip in 70/70 — mean EV +$618, barely positive). Rank ranges, top 5: polymarket [1,1,18], sentora [1,2,3], predict-fun [2,3,83], bittensor-dtao [2,4,15], nonce-capital [3,5,11]. LOPO median Spearman 0.9981, worst top-10 overlap 6; descriptive bars 1 of 3 met |
| Final evaluation table | target + target date, unit, independent protocols, folds + sizes, baselines, median absolute error + signed bias per fold + pooled, Spearman + Kendall per fold + pooled, coverage 50/80/90 nominal vs observed | Target: market cap at the 2026-11-14 snapshot (DefiLlama), unit = one protocol, 70 independent protocols, folds 50/60/70/80% train (7 test rows each) + pooled (28). Median abs err 0.2747 / 0.3121 / 0.2329 / 1.0483; signed bias −0.2621 / +0.2666 / +0.2329 / +0.6825; Spearman 0.5714 / 0.4643 / 0.8571 / −0.2857; Kendall 0.4286 / 0.4286 / 0.7143 / −0.2381. Pooled: median abs **0.3203**, signed bias **+0.1927**, Spearman 0.2895, Kendall 0.2063. Baselines (pooled nested): huber 0.3387, ols 0.3203, ridge 0.3164. Coverage nominal→observed: 50%→51.4%, 80%→81.4%, 90%→91.4%. WF 0.5145 dex = **~3.27× typical error**; R² 0.4236 is in-sample only, not out-of-sample evidence |
| Reproducibility package | dataset version, charter version, configuration, seeds, per-protocol outputs, rebuild instructions (`REPRODUCE.md` at the entry root) | `data.js` carries `reproducibility`: snapshot sha256 `42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393` — computed from the input file at build time, never typed by hand — charter v1.5, model radar-12, gate 'f', intercept 3.7686, coef 0.4105, value cap $2.65B; seeds: cluster bootstrap 20261119, base-rate bootstrap 20261107, ev/tournament/param-aware draws fnv1aHash(slug…); outputs board.json / data.js / dossier.json / ev-simulation-polymarket.json; exact rebuild commands |
| Cap sensitivity + tournament under (f) | (f) farm count across the four caps; tournament (f) counts per distribution | (f) farm count **66 / 66 / 66 / 66** across uncapped / P90 / P95 / production caps — stable. Tournament (f): lognormal 66, capped-lognormal 66, capped-P90 66, capped-P95 66, empirical 24, bootstrap-residuals 73, student-t 56. Tournament (d) production capped = 7 (vs gate-test sim 4 — same Monte Carlo mechanism). Winsorization still NOT adopted (improvement 0 dex); winsorized board farms 66 under gate (f) |
| Leakage tests updated to v1.5 | six-policy gate test + two-layer adoption, 2000-refit bootstrap, param-aware sim bounds, gate (f) ceiling scaling + (d) conservative 0, verdict-stability reconciliation, final-table reconciliation, reproducibility hash, negative-fold diagnosis, pooled top-k sanity | 58 checks pass (see `scripts/leakage-test.ts`); farm-count checks never require ≥ 1 farm; the (f) farm-row check allows at most 3 analytic exceptions within 0.005 of the ceiling (Monte Carlo tolerance — tau-labs is one: analytic P(negative) 0.8989 vs ceiling 0.8977); the grid check asserts the conservative (3×, 0.85) count is 0 under both, never the adopted count |
| Dashboard reworked to v1.5 | lede (gate (f) farms 61 under both layers), gate test (6 policies, two odds layers), tournament + cap sensitivity ((f) column), ranking stability (Kendall, pooled top-10/20, negative-fold diagnosis), parameter uncertainty (sign flips, bimodality, param-aware band), five new sections (final evaluation table, param-aware farming simulation, gate (d) economic audit, verdict stability, reproducibility), board rank ranges, detail drawer (param-aware band, verdict stability, gate-(d) pass fractions, rank range) | lede, model panel, gate test, OOD, EV audit and detail view all show v1.5 numbers; sandbox re-ranks with the same capped gate |
| Screenshots regenerated | headless Chromium, 1-board + 2-detail at 1440×900, 3-filtered at 1440×1250 | all three < 512 KiB; visual check passed, no overlap or broken text |

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
- `EVALUATION_CHARTER.md` — the locked evaluation charter (v1.4): question, target, population, splits, success rule, tuning boundary, leakage checks. Radar-10's v1.3 charter is preserved in the radar-10 freeze; radar-9's v1.2 charter in the radar-9 freeze; radar-8's v1.1 charter in the radar-8 freeze.
- `scripts/leakage-test.ts` — the leakage-injection self-test (49 checks; not copied to /output).
- `dashboard/` — the static page (index.html, app.css, app.js). Renders with no network.
- `screenshots/` — the board, a protocol's detail view, a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored from the kit).

## Caveat

Implied value is a model, not a promise. A protocol "records no token" in the
snapshot; that is DefiLlama's record, not proof it has none.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
