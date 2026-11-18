# Reproduce this board (radar-12, charter v1.5)

Everything needed to rebuild the board from the sealed snapshot. No network,
no credentials, no GPU.

## Inputs

| item | value |
|---|---|
| Dataset | DefiLlama snapshot, as of 2026-11-14 (`../kit/token-radar-01-kit/input/snapshot.json`) |
| Snapshot sha256 | `42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393` (computed from the input file at build time, never typed by hand) |
| Charter | `EVALUATION_CHARTER.md` v1.5 (locked before fitting) |
| Model | radar-12 — OLS fit, intercept 3.7686, slope log-TVL 0.4105, floor $25M, n = 70 dated comps |
| Gate | (f) — conditional mean EV > 3× plan cost AND P(negative) ≤ 1 − 0.75 × p_L, under both the adopted (16.4%) and conservative (13.64%) launch odds |

## Locked constants

| constant | value |
|---|---|
| size floor | $25,000,000 |
| purge gap | 30 days |
| farmer share | 0.0025 |
| marginal break-even | 0.33 |
| value cap | $2,646,363,290 (max observed dated-comp market cap — rain) |
| launch odds, base rate | 0.1643 |
| launch odds, conservative | 0.1364 (2.5th percentile of the base-rate bootstrap) |
| gate adopted | f |
| intercept | 3.7686061920609664 |
| coef log-TVL | 0.41049277045375987 |

## Seeds

| process | seed |
|---|---|
| cluster bootstrap (2000 refits) | 20261119 |
| base-rate bootstrap (2000 resamples) | 20261107 |
| EV simulation draws | fnv1aHash(slug) |
| tournament draws | fnv1aHash(slug\|tournament\|kind) |
| param-aware draws | fnv1aHash(slug\|param-aware\|kind) |
| param-aware gate (d) | fnv1aHash(slug\|param-aware\|gate-d) |

## Rebuild

```sh
# from the entry directory (~/workspace/makefun/token-radar/entry/)
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json
```

Node 24 (type stripping) required, standard library only. The program writes
`board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the
output directory, plus `ev-simulation-polymarket.json` (the full 20,000-draw
array behind Polymarket's EV statistics).

Verify the rebuild:

```sh
# determinism: build twice into two directories and diff — must be byte-identical
mkdir -p out2 && MAKEFUN_OUTPUT_DIR=out2 node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json
diff -r out out2

# leakage self-test (58 checks; ~1–2 min, the 2000-refit bootstrap is the slow part)
node scripts/leakage-test.ts --input ../kit/token-radar-01-kit/input/snapshot.json
```

## Outputs

| file | contents |
|---|---|
| `board.json` | 198 rows, verdicts 55 farm / 41 marginal / 102 skip |
| `data.js` | the full validation object (`window.RADAR`), incl. `reproducibility` |
| `dashboard/` | `index.html`, `app.js`, `style.css` — open `index.html` in a browser |
| `screenshots/` | 1-board + 2-detail at 1440×900, 3-filtered at 1440×1250 |
| `dossier.json` | the submission dossier text (65,536-byte cap) |
| `ev-simulation-polymarket.json` | Polymarket's 20,000-draw simulation array |

## What to check first

- `data.js` → `reproducibility.snapshot_sha256` must equal the hash above.
- `board.json` → 55 farm / 41 marginal / 102 skip; top 3 polymarket / sentora / predict-fun.
- `data.js` → `validation.ranking_stability.nested_pooled_spearman` = 0.2895,
  `nested_pooled_kendall` = 0.2063; `validation.final_evaluation.pooled` reconciles
  with the nested, walk-forward, R² and conformal numbers.
- `data.js` → `validation.gate_test.adopted` = 'f'; variant (f) 61/61 adopted/conservative,
  variant (d) 4/0.
