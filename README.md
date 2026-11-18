# Launch Radar: comps-fitted value tested out of sample, every farm plan costed with a verdict

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faaz12/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faaz12/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry (radar-3 model). It reads a sealed DefiLlama
snapshot of 758 protocols, finds the ones that record no token, and ranks them
by what their launch would be worth — then hands in a dashboard a reader can
use: the board, a detail view for every protocol, and a farm plan for each one,
every plan costed with a verdict (farm / marginal / skip).

## The model

Implied value is fitted, not hand-set. An OLS log-log regression is fitted at
run time on the snapshot's own live-token comparables (119 protocols with a
token trading, TVL and market cap positive, CEX excluded):

```
log10(mcap) = b0 + b1*log10(tvl_usd) + b2*clamp(change_7d, -60, 120)
              + b3*log10(age_days + 1) + category adjustment
implied = round(10^predicted), clamped to [1, $100B]
```

The **category adjustment** is the median residual of the category's live
comparables; a category with fewer than 3 comps gets 0 (the global fit).
The fit is validated **walk-forward** at run time: the comps are sorted by
`listed_at`, the oldest 70% fit the model and the newest 30% test it. The
dashboard shows the fitted coefficients, the in-sample R² and the
out-of-sample median absolute log10 error, plus a scatter of the live comps
against the fitted line. No protocol name is ever special-cased.

Every farm plan carries a **verdict** from the fitted value against the plan's
own cost (capital deployed plus seven transactions of gas): farm when the value
is at least $20M and at least 100,000x the cost, skip when the value is under
$2M or under 10,000x the cost, marginal in between.

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
