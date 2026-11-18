# Launch Radar: comps-fitted value tested out of sample, every farm plan costed with a verdict

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faaz12/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faaz12/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry (radar-6 model). It reads a sealed DefiLlama
snapshot of 758 protocols, finds the ones that record no token, and ranks them
by what their launch would be worth — then hands in a dashboard a reader can
use: the board, a detail view for every protocol, and a farm plan for each one,
every plan costed with a verdict (farm / marginal / skip).

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

The fit is validated **three ways** at run time, and the dashboard shows all
three: walk-forward on the dated comparables only (oldest 70% fit, newest 30%
tested), stratified walk-forward (dated and undated comps each split 70/30),
and 5-fold cross-validation (fixed-seed shuffle). A 200-refit bootstrap (fixed
seed) gives the 1-sigma band on a predicted log value, and the value band
combines it with the stratified out-of-sample miss — the miss measured on the
whole comparable population, dated and undated — so the band printed on every
row, undated rows included, is calibrated on the population it covers:
±0.6745*sqrt(bootstrap_sd² + stratified_oos²) dex. On this snapshot:
R² 0.4386, walk-forward median error 0.4435 dex (2.78x), stratified 0.6084 dex,
5-fold CV 0.5478 dex (3.53x), bootstrap ±0.3075 dex, value band ±0.4598 dex
holding 45.7% of comparables in cross-validation — against radar-5's R² 0.4107
and walk-forward error 0.6574 dex (4.54x). No protocol name is ever special-cased.

## The undated comparables — investigated, not dated, not dropped

The 32 undated comparables in radar-5 (22 of the 92 in radar-6) cannot be dated
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
dex (4.97x), against 0.5520 dex for the dated comps in the same split (offline
replication of the runtime split), and in 5-fold cross-validation their median
error is 0.78 dex against 0.41 dex for dated comps (same offline replication;
the runtime CV seed differs, so these two are checks, not dashboard numbers).

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
fit, and their 4.97x stratified error is printed next to the 2.78x walk-forward.

## The OLS benchmark and the nested walk-forward

The old least-squares model is kept as a benchmark, never deleted: the same
features, fitted by plain OLS, scored on the same splits at run time, so the
comparison isolates the fitting method. On this snapshot:

| metric | Huber (radar-6) | OLS benchmark |
|---|---|---|
| R² (in-sample) | 0.4386 | 0.4371 |
| Walk-forward 70/30, dated only (dex) | 0.4435 (2.78x) | 0.4721 (2.97x) |
| Stratified walk-forward (dex) | 0.6084 (4.06x) | — |
| 5-fold CV (dex) | 0.5478 (3.53x) | 0.5698 (3.71x) |
| Nested walk-forward pooled (dex) | 0.3857 (2.43x) | 0.3377 (2.18x) |

Huber wins the in-sample fit, the walk-forward split and cross-validation; OLS
wins only the nested walk-forward. The gaps are 0.01–0.05 dex on test sets of 7
to 21 protocols, so neither fit dominates — Huber stays the model because it
down-weights the snapshot's attribution quirks instead of letting them drag the
curve. The radar-3 OLS (no floor, no adjustments, age in the regression) scored
R² 0.2079 and walk-forward 0.8136 dex (6.5x); the radar-6 features alone, fitted
by OLS, already reach R² 0.4371 — most of the gain is the features, the floor
and the aligned training population, not the robust fit.

The nested walk-forward (dated comparables only; train on the oldest
50/60/70/80/90%, test on the next 10% forward in time) also re-checked the TVL
floor, on the radar-6 comparables. Pooled median error by floor (runtime grid):
$10M 0.3718 (2.35x), **$25M 0.3857 (2.43x)**, $50M 0.3967 (2.49x), $100M
0.3915 (2.46x), $250M 0.3484 (2.23x). No floor dominates: $10M wins the
walk-forward (0.4327 vs 0.4435 at $25M) and $100M/$250M win cross-validation
(0.5012/0.5007 vs 0.5478 at $25M), while $25M wins the stratified split
(0.6084, best of the five) and sits mid-pack everywhere else. The gaps are
0.01–0.03 dex on test sets of 7–21 protocols — noise, not a signal — so the
model keeps the established $25M floor rather than re-tuning on noise. The
$100M floor was tested and does not win: it loses the walk-forward (0.5031 vs
0.4435) and the stratified split (0.6201 vs 0.6084) and only wins CV. The
nested folds at $25M are 0.2679 / 0.3779 / 0.1783 / 1.0102 / 0.5414 — the 80%
fold (7 newest comps) is a hard outlier fold, and the pooled median, not any
single fold, is the reported number.

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

Every farm plan carries a **verdict** from the break-even launch odds
against a standard $10,000 deposit (plus seven transactions of gas and the
opportunity cost of locking the deposit for the hold window at 10% a year):
farm when the break-even odds are at most 10%, marginal when at most 33%,
skip otherwise. On this snapshot: 6 farm / 42 marginal / 150 skip. The top of
the board: polymarket-international $20.2M (odds 31%), sentora-curator $12.4M,
steakhouse-financial $8.1M, predict-fun $6.4M, gauntlet $6.0M.

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
output directory. Run it twice: both runs write the same bytes.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes the board, data, dashboard, screenshots and dossier.
- `lib/model.ts` — the fitted regression, the walk-forward validation, the farm plans with verdicts, and the board checks.
- `dashboard/` — the static page (index.html, app.css, app.js). Renders with no network.
- `screenshots/` — the board, a protocol's detail view, a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored from the kit).

## Caveat

Implied value is a model, not a promise. A protocol "records no token" in the
snapshot; that is DefiLlama's record, not proof it has none.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
