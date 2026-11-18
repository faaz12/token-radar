# Launch Radar: comps-fitted value tested out of sample, every farm plan costed with a verdict

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faaz12/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faaz12/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry (radar-5 model). It reads a sealed DefiLlama
snapshot of 758 protocols, finds the ones that record no token, and ranks them
by what their launch would be worth — then hands in a dashboard a reader can
use: the board, a detail view for every protocol, and a farm plan for each one,
every plan costed with a verdict (farm / marginal / skip).

## The model

Implied value is fitted, not hand-set. A Huber-fitted log-log regression is
fitted at run time on the snapshot's own live-token comparables (119 protocols
with a token trading, TVL and market cap positive, CEX excluded):

```
log10(value if it launches) = b0 + b1*log10(tvl_usd + $25M) + b2*log(1 + clamp(change_7d, -50%, +200%)/100)
              + category adjustment + main-chain adjustment   (b2 forced >= 0: a down week never subtracts value)
implied = round(10^predicted) x launch odds, clamped to [1, $100B]
```

The **size floor** ($25M) keeps the curve from pricing a small protocol at
zero for being small: TVL below $25M is noisy in the snapshot. The floor was
grid-searched over $10M–$250M on walk-forward cross-validation; $25M gave the
best walk-forward and 5-fold errors. **Huber**
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
three: walk-forward (oldest 70% fit, newest 30% tested), stratified
walk-forward (dated and undated comps each split 70/30), and 5-fold
cross-validation (fixed-seed shuffle). A 200-refit bootstrap (fixed seed)
gives the 1-sigma band on a predicted log value, and the value band combines
it with the out-of-sample miss: ±0.6745*sqrt(bootstrap_sd² + oos²) dex. On
this snapshot:
R² 0.4107, walk-forward median error 0.6574 dex, stratified 0.6638 dex,
5-fold CV 0.5316 dex, bootstrap ±0.2908 dex, value band ±0.4849 dex holding
47.9% of comparables in cross-validation — against radar-3's R² 0.2079
and walk-forward error 0.8136 dex. No protocol name is ever special-cased.

## The OLS benchmark and the nested walk-forward

The old least-squares model is kept as a benchmark, never deleted: the same
features, fitted by plain OLS, scored on the same splits at run time, so the
comparison isolates the fitting method. On this snapshot:

| metric | Huber (radar-5) | OLS benchmark |
|---|---|---|
| R² (in-sample) | 0.4107 | 0.4092 |
| Walk-forward 70/30 (dex) | 0.6574 (4.54x) | 0.6604 (4.57x) |
| 5-fold CV (dex) | 0.5316 (3.40x) | 0.4902 (3.09x) |
| Nested walk-forward pooled (dex) | 0.5255 (3.35x) | 0.5155 (3.28x) |

Huber wins the in-sample fit and the walk-forward split; OLS wins
cross-validation and the nested walk-forward. The gaps are 0.00–0.04 dex on
test sets of 9 to 36 protocols, so neither fit dominates — Huber stays the
model because it down-weights the snapshot's attribution quirks instead of
letting them drag the curve. The radar-3 OLS (no floor, no adjustments, age
in the regression) scored R² 0.2079 and walk-forward 0.8136 dex (6.5x); the
radar-5 features alone, fitted by OLS, already reach R² 0.4092 — most of the
gain is the features and the floor, not the robust fit.

The nested walk-forward (dated comparables only; train on the oldest
50/60/70/80/90%, test on the next 10% forward in time) also settled the TVL
floor. Pooled median error by floor (offline grid search; the dashboard's
runtime value at $25M is 0.5255): $10M 0.5335 (3.42x), **$25M 0.5294
(3.38x)**, $50M 0.5428 (3.49x), $100M 0.5525 (3.57x), $250M 0.5556 (3.59x).
The $100M floor was tested and lost on every metric (walk-forward 0.6648,
CV 0.5634, nested 0.5525), so the model keeps $25M. Both floors sit inside
the 3.2–3.6x nested target band; $25M is best on all four metrics. The
standard 70/30 walk-forward stays above 4x (0.6574 dex) because its test set
is dominated by the 32 undated comparables, which no regression change fixes;
on dated protocols only, the error is ~3.2–3.4x.

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
skip otherwise. On this snapshot: 8 farm / 45 marginal / 145 skip.

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
