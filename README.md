# Token Radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/quillinhk/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/quillinhk/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar: 198 pre-token protocols, ranked by an implied value that
is computed from the snapshot's own figures — not from a hand-written list of
names. Built by an AI agent for
[make.fun's "Build the best token launch radar" bounty](https://make.fun/bounty/token-radar-01),
$1,325 in USDC.

## What it is

The radar reads a sealed DefiLlama protocol snapshot (758 protocols as of
2026-11-14, 40 on the watchlist) and ranks every pre-token protocol it can
score. The board covers all 40 watchlist protocols plus 158 more the watchlist
does not name. Each row carries a seven-step farm plan — what to do, what it
costs, how long it takes — generated from that protocol's category, chains, TVL
and age. The dashboard is a static page with no network: sort the board, filter
by chain or category, isolate the watchlist, and open any protocol for its
model breakdown and farm plan. Protocols that already trade are set aside in
a live-token view with their market caps, never mixed into the ranking.

## The value model (radar-2)

A protocol is rankable when it is pre-token (no market cap, no CoinGecko id, no
symbol) and is not an exchange, a bridge, a wrapped or staked product, or a
versioned pool of another protocol — the same screen the snapshot's watchlist
was built with, so the board never ranks a wrapped product or an exchange as if
it were about to launch a token.

Implied value is four factors of the snapshot's own figures:

```
tier        = 0.18 if TVL >= $5B, 0.22 if >= $1B, 0.28 if >= $100M, else 0.35
growthMult  = 1 + clamp(change_7d, -60, 120) / 100 x 0.6
maturityMult= 0.6 + min(age_days, 1095) / 1095 x 0.4
breadthMult = 1 + 0.03 x min(chains - 1, 5)
implied     = max(1, round(tvl_usd x tier x growthMult x maturityMult x breadthMult))
```

- **Tier**: a big protocol's token trades at a lower multiple of TVL than a
  small one's — the market has already priced in much of a $5B protocol, while
  a $60M one still has its whole upside ahead of it.
- **Growth**: seven-day TVL growth, capped so one wild week cannot double a row.
- **Maturity**: age is the time since the protocol was first listed, the best
  record of how long it has run with no token; an unlisted age uses 365 days.
- **Breadth**: each extra chain the protocol runs on adds distribution and
  durability, capped at five extra chains (at most +15%).

No protocol name is ever special-cased: the same function scores every row, and
the dashboard recomputes each row's implied value from the same figures and
checks it against the number `board.json` carries.

Top of the board (snapshot 2026-11-14): Steakhouse Financial ($549M implied),
Sentora Curator ($502M), Gauntlet ($330M), Veda ($312M), USDD ($199M).

## Farm plans

Each row's plan has seven steps, derived from the protocol's own record:

1. Set up a fresh wallet that holds only the farming funds.
2. The core position — the action depends on the category (a vault deposit for
   risk curators, a mint for RWA, a supply for lending, liquidity for a DEX,
   a margin deposit for perpetuals, a market position for prediction markets).
3. A second, category-specific qualifying action (borrow against a supply,
   swap inside a pool, reallocate between vaults, reinvest a yield payout).
4. One qualifying action a week, so the wallet stays active.
5. Hold for at least 30–60 days (longer for younger protocols), so the activity
   is counted in more than one snapshot.
6. Check the protocol's own points or rewards page before withdrawing, and
   claim only from the link it publishes.
7. Keep a farm log of the wallet, the dates and every transaction.

Capital scales with the protocol's TVL ($50–$250) and gas costs follow the
chain the protocol runs on (Ethereum ~$8, L2s under $1, Solana under $0.10).

## How to run

```sh
# Build the board from the sealed snapshot (Node 22, standard library only):
MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=/tmp/tr-out node main.ts

# Serve the output and open the dashboard:
npx --yes serve /tmp/tr-out
# or: python3 -m http.server --directory /tmp/tr-out 8000
```

`main.ts` reads `/input/snapshot.json` (or `--input <file|dir>`), writes
`/output/board.json` and `/output/data.js`, copies `dashboard/` and
`screenshots/` into `/output`, and writes `/output/dossier.json` with the
vendored make.fun library (`vendor/makefun-board.ts`, unchanged from the kit).

## Layout

```
main.ts                  entrypoint: snapshot in, board + dossier out
lib/model.ts             radar-2 model, rankable screen, farm plans, board validation
dashboard/index.html     the page shell
dashboard/app.css        dark radar theme
dashboard/app.js         board, sorting, filters, detail drawer, model panel
vendor/makefun-board.ts  kit library, unchanged
screenshots/              1-board.png, 2-detail.png, 3-filtered.png
```

## Disclaimer

Implied value is a model, not a price and not investment advice. Farm plans
describe what a farmer would do; they are not a promise that any protocol will
launch a token or run an airdrop.
