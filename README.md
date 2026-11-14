# Token Radar — pre-token protocols ranked by implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faaz12/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faaz12/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry (radar-2 model). It reads a sealed DefiLlama
snapshot of 758 protocols, finds the ones that record no token, and ranks them
by what their launch would be worth — then hands in a dashboard a reader can
use: the board, a detail view for every protocol, and a farm plan for each one.

## The model

Implied value follows only from the snapshot's own figures:

```
implied = round(tvl_usd x category multiple
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4))
```

The **category multiple** is the median market-cap-to-TVL ratio of the
live-token protocols in the same category, computed from the snapshot at run
time. A category with fewer than 3 live comparables falls back to the global
median; every multiple is clamped to 0.05x–1.00x. No protocol name is ever
special-cased.

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
- `lib/model.ts` — the comparables model, the farm plans and the board checks.
- `dashboard/` — the static page (index.html, app.css, app.js). Renders with no network.
- `screenshots/` — the board, a protocol's detail view, a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored from the kit).

## Caveat

Implied value is a model, not a promise. A protocol "records no token" in the
snapshot; that is DefiLlama's record, not proof it has none.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
