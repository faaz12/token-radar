# Launch Radar: comps-fitted value tested out of sample, every farm plan costed with a verdict

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faaz12/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faaz12/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry (radar-4 model). It reads a sealed DefiLlama
snapshot of 758 protocols, finds the ones that record no token, and ranks them
by what their launch would be worth — then hands in a dashboard a reader can
use: the board, a detail view for every protocol, and a farm plan for each one,
every plan costed with a verdict (farm / marginal / skip).

## The model

Implied value is fitted, not hand-set. A Huber-fitted log-log regression is
fitted at run time on the snapshot's own live-token comparables (119 protocols
with a token trading, TVL and market cap positive, CEX excluded):

```
log10(mcap) = b0 + b1*log10(tvl_usd + $100M) + b2*clamp(change_7d, -60, 120)
              + b3*log10(age_days + 1) + category adjustment + main-chain adjustment
implied = round(10^predicted), clamped to [1, $100B]
```

The **size floor** ($100M) keeps the curve from pricing a small protocol at
zero for being small: TVL below $100M is noisy in the snapshot. **Huber**
(IRLS, delta 1.345, MAD scale) down-weights the snapshot's own attribution
quirks — a chain token counted on its bridge, one token counted on two
versions of a protocol — instead of letting them drag the curve. The **group
adjustments** are the median residual of the category and of the main chain,
each shrunk toward zero by n/(n+3): a group with one or two comps moves a
price a little, a group with fifteen moves it a lot. Full-size adjustments
failed the walk-forward test; shrunk ones did not.

The fit is validated **three ways** at run time, and the dashboard shows all
three: walk-forward (oldest 70% fit, newest 30% tested), stratified
walk-forward (dated and undated comps each split 70/30), and 5-fold
cross-validation (fixed-seed shuffle). A 200-refit bootstrap (fixed seed)
gives the 1-sigma band on a predicted log value. On this snapshot:
R² 0.4108, walk-forward median error 0.6648 dex, stratified 0.6320 dex,
5-fold CV 0.5307 dex, bootstrap ±0.3207 dex — against radar-3's R² 0.2079
and walk-forward error 0.8136 dex. No protocol name is ever special-cased.

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
