# Launch Radar: comps-fitted value tested out of sample, every farm plan costed with a verdict

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faaz12/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faaz12/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry (radar-7 model, evaluation charter v1.0).
It reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that
record no token, and ranks them by what their launch would be worth — then
hands in a dashboard a reader can use: the board, a detail view for every
protocol, and a farm plan for each one, every plan costed with a verdict
(farm / marginal / skip) from its expected net return.

## The model

Implied value is fitted, not hand-set. A Huber-fitted log-log regression is
fitted at run time on the snapshot's own live-token comparables (92 protocols
with a token trading, TVL and market cap positive, CEX excluded — and, since
radar-6, only protocols the board could rank: the board's own wrapped / staked
/ bridged / versioned / exchange-product exclusions are applied to the training
set too, so the curve is fitted on the population it prices):

```
log10(value if it launches) = b0 + b1*log10(tvl_usd + $25M) + b2*log(1 + clamp(change_7d, -50%, +200%)/100)
              + category adjustment + main-chain adjustment   (b2 forced >= 0: a down week never subtracts value)
implied = round(10^predicted) x launch odds, clamped to [1, $100B]
```

The **size floor** ($25M) keeps the curve from pricing a small protocol at
zero for being small: TVL below $25M is noisy in the snapshot. The floor was
re-grid-searched over $10M–$250M for radar-6 and no floor dominates (see the
floor grid below); $25M is kept as the established floor, best on the
stratified split and mid-pack on every other metric. **Huber**
(IRLS, delta 1.345, MAD scale) down-weights the snapshot's own attribution
quirks — a chain token counted on its bridge, one token counted on two
versions of a protocol — instead of letting them drag the curve. The **group
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
rate. **Growth** is winsorized to [-50%, +200%] and enters as log(1+g) with
its coefficient forced non-negative, so a down week never subtracts value.

The fit is validated **four ways** at run time, and the dashboard shows all
four: walk-forward on the dated comparables only (oldest 70% fit, newest 30%
tested), nested expanding-window walk-forward (train on the oldest
50/60/70/80/90%, test on the next 10% forward in time), stratified
walk-forward (dated and undated comps each split 70/30), and 5-fold
cross-validation (fixed-seed shuffle). The time-based splits use a **30-day
purge gap**: training rows listed within 30 days before a test window are
dropped, so no fold learns from a token's unstable first month. The value band
is **cross-conformal**: the nominal-coverage quantile of the absolute
out-of-fold residuals from the 5-fold CV (92 residuals, finite-sample
corrected), so a 50% band holds about 50% of the comparables by construction.
A 200-refit bootstrap (fixed seed) is kept as a diagnostic on the fitted
value's wobble only. On this snapshot: R² 0.4386, walk-forward median error
0.4427 dex (2.77x), nested pooled 0.3728 dex (2.36x), stratified 0.6084 dex,
5-fold CV 0.5478 dex (3.53x), bootstrap ±0.3075 dex, value band ±0.5479 dex
holding 51.1% of comparables (80% band ±1.0753 dex holding 81.5%, 90% band
±1.4462 dex holding 91.3%). The point values are unchanged from radar-6 —
the full fit does not use the purge gap — but the band and the verdicts are
new. No protocol name is ever special-cased.

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

So radar-6 does two honest things instead of dating them. First, the
walk-forward is redefined as dated-only: a protocol with no listing date has no
position in time, so it cannot be walk-forwarded — radar-5's nulls-last ordering
put all 32 undated comps whole into its test set, so its 4.54x "walk-forward"
error was really the undated error. Undated comps are still scored, in the
stratified split and in cross-validation, and their error is reported on its own
in the dashboard rather than hidden inside the walk-forward. Second, the
training population is aligned with the ranked population (above): bridges,
liquid-staking products, versioned pools and exchange products are excluded
from the fit by the board's own rule, applied uniformly — that is what removes
the worst attribution artifacts (aave-v2, the canonical bridges) from training.
No undated comp was deleted to flatter a metric: 22 undated comps remain in the
fit, and their 4.97x stratified error is printed next to the 2.77x walk-forward.

Radar-7 tested the three remaining handlings on the nested walk-forward and
kept the status quo: imputing a listing date of 365 days plus a missingness
indicator loses on the dated holdout, and indicator-only ties the primary
metric while mixing the other splits (tested on the radar-6 setup, before the
purge gap: status quo nested 0.3857, imputation 0.4307, indicator-only 0.3857).
The mechanism is structural, not random: undated comps are legacy protocols
whose listing dates were never recorded; they are systematically smaller
(median market cap $4.8M vs $9.0M dated) and over-predicted (median residual
−0.228 vs −0.021 dated), so the missingness itself carries signal about size.

## The OLS benchmark and the nested walk-forward

The old least-squares model is kept as a benchmark, never deleted: the same
features, fitted by plain OLS, scored on the same splits at run time, so the
comparison isolates the fitting method. On this snapshot:

| metric | Huber (radar-7) | OLS benchmark |
|---|---|---|
| R² (in-sample) | 0.4386 | 0.4371 |
| Walk-forward 70/30, dated only (dex) | 0.4427 (2.77x) | 0.4611 (2.89x) |
| Stratified walk-forward (dex) | 0.6084 (4.06x) | — |
| 5-fold CV (dex) | 0.5478 (3.53x) | 0.5698 (3.71x) |
| Nested walk-forward pooled (dex) | 0.3728 (2.36x) | 0.3346 (2.16x) |

Paired per-observation differences (Huber minus OLS, 2000 bootstrap
resamples, same observations, same folds): walk-forward median diff +0.0050
dex, 95% interval [−0.0073, +0.0318], Huber better on 9/21; nested pooled
+0.0015, [−0.0161, +0.0172], 17/35; 5-fold CV +0.0061, [−0.0062, +0.0153],
42/92. Every interval straddles zero: the two fitters are statistically
indistinguishable on every split, so neither fit dominates — Huber stays the
model on the robustness principle (it down-weights the snapshot's attribution
quirks instead of letting them drag the curve), not because it wins the
metrics. The radar-3 OLS (no floor, no adjustments, age in the regression)
scored R² 0.2079 and walk-forward 0.8136 dex (6.5x); the radar-7 features
alone, fitted by OLS, already reach R² 0.4371 — most of the gain is the
features, the floor and the aligned training population, not the robust fit.

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
the established $25M. The nested folds at $25M are 0.2854 / 0.3728 / 0.1666 /
1.0201 / 0.5537 — the 80% fold (7 newest comps) is a hard outlier fold, and the
pooled median, not any single fold, is the reported number. The 80% fold is
diagnosed in the dashboard, not dropped: its test window (2025-09 → 2026-02)
holds the newest listings, including structural extremes — rain (Prediction
Market, market cap $2.65B on TVL $6.6M, a 400x multiple, error 2.91 dex) and
obol (Staking Pool, market cap $717K on TVL $1.15B, a 0.0006x multiple, error
1.89 dex) — and 3 of its 7 rows are in categories with zero training comps,
plus one unseen chain (Bittensor). Both Huber and OLS fail identically there,
so it is the data, not the estimator.

## Target definition and survivorship bias

Two limits, stated plainly. The target is the market cap on the snapshot
date (2026-11-14), not a day-3-to-7 median FDV: the snapshot carries no price
history, so that definition cannot be verified or built from this data. If
the launch value is judged on a day-3-to-7 median instead, these numbers are
not that target. And the training set is survivors: 15 protocols in the
snapshot hold a token with a zero market cap and 14 more are listed on
CoinGecko with no cap at all — the visible dead — while tokens removed from
the index entirely are invisible. Failed launches never enter the training
set, so the fitted values are biased upward for the average protocol. The
seasoning curve is calibrated on the snapshot itself (actual vs predicted
launch rate by age bin: 0–90d 3.8% vs 2.4%, 90–180d 2.9% vs 5.2%, 180–365d
13.7% vs 8.6%, 365–730d 12.0% vs 14.0%, 730–1100d 17.1% vs 19.7%,
1100–1500d 26.4% vs 25.4%, 1500–2200d 33.9% vs 29.4%), and the dashboard
shows the full table.

Every farm plan carries a **verdict** from its **expected net return**:
EV = launch odds × 0.25% × value-if-launches − plan cost, for a standard
$10,000 deposit (plus seven transactions of gas and the opportunity cost of
locking the deposit for the hold window at 10% a year). Farm when EV is
positive; marginal when EV is negative but the break-even odds are at most
33%; skip otherwise. The old break-even-only rule called two rows FARM with
negative expected return (bittensor-dtao EV −$6,944, nonce-capital −$7,826;
both 45–56 days old, launch odds 2–3% vs break-even 8–9%) — they are marginal
under the EV rule. On this snapshot: **11 farm / 37 marginal / 150 skip**.
The top of the board: polymarket-international $20.2M (launch odds 31%,
break-even 6.2%, EV +$40,508), sentora-curator $12.4M (12%, 3.8%,
+$20,901), steakhouse-financial $8.1M (14%, 7.1%, +$10,156), predict-fun
$6.4M (18%, 11.7%, +$5,824), gauntlet $6.0M (14%, 9.6%, +$4,942). The 31%
next to Polymarket is its launch odds (p_L), not its break-even odds (p_BE
6.2%). The top 5 by expected return are the same as the top 5 by implied
value.

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
- `EVALUATION_CHARTER.md` — the locked evaluation charter (v1.0): question, target, population, splits, success rule, tuning boundary, leakage checks.
- `scripts/leakage-test.ts` — the leakage-injection self-test (12 checks; not copied to /output).
- `dashboard/` — the static page (index.html, app.css, app.js). Renders with no network.
- `screenshots/` — the board, a protocol's detail view, a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored from the kit).

## Caveat

Implied value is a model, not a promise. A protocol "records no token" in the
snapshot; that is DefiLlama's record, not proof it has none.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
