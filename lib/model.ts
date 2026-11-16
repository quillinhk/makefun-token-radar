// Token Radar — value model (radar-2).
//
// Every number in the board comes from the sealed snapshot alone. A protocol's
// implied value is its TVL scaled by four multipliers that the snapshot itself
// supplies: which TVL tier it sits in, how its TVL moved over seven days, how
// long it has run with no token recorded, and how many chains it runs on. No
// protocol name is ever consulted; the same formula ranks all 758 protocols,
// and the board is whatever falls out of it.
//
// The model lives here so main.ts stays a thin runner: it parses the snapshot,
// asks this module for the board and the dashboard data, validates the result,
// and writes the output directory.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's knobs, all in one place so the dashboard can show them. */
export interface ModelParams {
  tier5b: number;
  tier1b: number;
  tier100m: number;
  tierBelow: number;
  cut5b: number;
  cut1b: number;
  cut100m: number;
  growthWeight: number;
  growthFloor: number;
  growthCap: number;
  maturityFloor: number;
  maturityRange: number;
  maturityDays: number;
  unknownAgeDays: number;
  breadthPerChain: number;
  breadthMaxChains: number;
}

export const MODEL: ModelParams = {
  tier5b: 0.18,
  tier1b: 0.22,
  tier100m: 0.28,
  tierBelow: 0.35,
  cut5b: 5_000_000_000,
  cut1b: 1_000_000_000,
  cut100m: 100_000_000,
  growthWeight: 0.6,
  growthFloor: -60,
  growthCap: 120,
  maturityFloor: 0.6,
  maturityRange: 0.4,
  maturityDays: 1095,
  unknownAgeDays: 365,
  breadthPerChain: 0.03,
  breadthMaxChains: 5,
};

export const MODEL_VERSION = 'radar-2';

/** Clamp a number into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Days between two YYYY-MM-DD dates, or null when the second is unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** The TVL tier multiple: bigger protocols earn a smaller multiple. */
export function tierFor(tvl: number, m: ModelParams = MODEL): number {
  if (tvl >= m.cut5b) return m.tier5b;
  if (tvl >= m.cut1b) return m.tier1b;
  if (tvl >= m.cut100m) return m.tier100m;
  return m.tierBelow;
}

/** One protocol's full valuation, with every multiplier exposed. */
export interface Valuation {
  implied: number;
  tier: number;
  growthPct: number;
  growthMult: number;
  age: number | null;
  maturityMult: number;
  breadthMult: number;
}

export function valueOf(p: SnapshotProtocol, asOf: string, m: ModelParams = MODEL): Valuation {
  const tier = tierFor(p.tvl_usd, m);
  const growthPct = p.change_7d === null ? 0 : p.change_7d;
  const growthMult = 1 + (clamp(growthPct, m.growthFloor, m.growthCap) / 100) * m.growthWeight;
  const rawAge = ageDays(asOf, p.listed_at);
  const age = rawAge === null ? m.unknownAgeDays : rawAge;
  const maturityMult = m.maturityFloor + (Math.min(age, m.maturityDays) / m.maturityDays) * m.maturityRange;
  const breadthMult = 1 + m.breadthPerChain * Math.min(Math.max(p.chains.length - 1, 0), m.breadthMaxChains);
  const implied = Math.round(p.tvl_usd * tier * growthMult * maturityMult * breadthMult);
  return { implied, tier, growthPct, growthMult, age: rawAge, maturityMult, breadthMult };
}

/** A protocol records no token when DefiLlama carries neither id nor symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// ---------------------------------------------------------------------------
// The rankable screen.
//
// A board row goes to a pre-token protocol that is not a wrapped, staked or
// bridged product of a protocol whose token already trades. The screen mirrors
// the house watchlist rule, so the watchlist is always a subset of the board:
// the watchlist is the floor, never the ceiling, and the board reaches below
// it to the early protocols the radar exists to find.
// ---------------------------------------------------------------------------

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** True when the name ends in a version marker like "V2", "v2" or "2.0". */
function hasVersionSuffix(name: string): boolean {
  return /\s(v\d+(?:\.\d+)?|V\d+(?:\.\d+)?|\d+\.\d+)$/.test(name);
}

/** True when the name carries a whole word wrapped, staked or staking. */
function hasWrappedWord(name: string): boolean {
  return /\b(wrapped|staked|staking)\b/i.test(name);
}

/** True when the protocol is rankable: pre-token and not an excluded product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (hasVersionSuffix(p.name)) return false;
  if (hasWrappedWord(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Farm plans.
//
// Each row carries seven concrete steps. They are built from the protocol's
// own data — its category, its chains, its TVL tier and its age — so two
// protocols in different categories or on different chains get different
// plans. Every step names what to do, what it costs and how long it takes.
// ---------------------------------------------------------------------------

/** What the core position is called for a category. */
const CORE_POSITION: Record<string, string> = {
  'Risk Curators': 'curated vault',
  'Dexs': 'liquidity pool',
  'Onchain Capital Allocator': 'strategy vault',
  RWA: 'tokenized real-world asset position',
  Lending: 'lending market',
  Yield: 'yield vault',
  Derivatives: 'hedged derivatives position',
  CDP: 'collateralized debt position',
  'Yield Aggregator': 'auto-compounding vault',
  'Basis Trading': 'delta-neutral basis position',
  Chain: 'native ecosystem position',
  'Staking Pool': 'staking pool',
  'Liquidity Manager': 'managed liquidity position',
  'Leveraged Farming': 'leveraged farm position',
  Restaking: 'restaking position',
};

/** The second qualifying action for a category. */
const SECOND_ACTION: Record<string, string> = {
  'Risk Curators': 'allocate to a second vault run by a different curator',
  Dexs: 'swap through the router once a week so the wallet shows trading volume',
  'Onchain Capital Allocator': 'join a second strategy with a different risk profile',
  RWA: 'hold the position through a full monthly settlement cycle',
  Lending: 'borrow a small amount against the supplied collateral',
  Yield: 'claim and restake the yield instead of letting it sit idle',
  Derivatives: 'place a small hedge on the opposite side of the book',
  CDP: 'repay part of the minted debt and re-mint it to show active management',
  'Yield Aggregator': 'move part of the deposit into a second vault in the same aggregator',
  'Basis Trading': 'roll the basis position into the next funding period',
  Chain: 'use a second native app on the chain, such as its main exchange or lending market',
  'Staking Pool': 'delegate a second, smaller stake to a different validator set',
  'Liquidity Manager': 'rebalance the managed position when its range drifts',
  'Leveraged Farming': 'open a second farm with a different pair to spread the exposure',
  Restaking: 'restake through a second operator to diversify the delegation',
};

/** Typical gas for one transaction on a chain, as a short phrase. */
const GAS_BY_CHAIN: Record<string, string> = {
  Ethereum: 'about $8',
  Arbitrum: 'about $0.50',
  Optimism: 'about $0.50',
  Base: 'about $0.30',
  Solana: 'about $0.05',
  Binance: 'about $0.30',
  Avalanche: 'about $0.40',
  Polygon: 'about $0.10',
  Monad: 'about $0.10',
  'Hyperliquid L1': 'about $0.10',
  Berachain: 'about $0.20',
  Plasma: 'about $0.20',
  'Robinhood Chain': 'about $0.10',
};

/** The farming capital for a TVL tier, in whole dollars. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 100_000_000) return 150;
  if (tvl >= 25_000_000) return 100;
  return 50;
}

function corePosition(category: string | null): string {
  if (category !== null && CORE_POSITION[category] !== undefined) return CORE_POSITION[category];
  return 'core product';
}

function secondAction(category: string | null): string {
  if (category !== null && SECOND_ACTION[category] !== undefined) return SECOND_ACTION[category];
  return 'use a second feature of the protocol so the wallet shows more than one interaction';
}

function gasFor(chain: string): string {
  return GAS_BY_CHAIN[chain] ?? 'about $1';
}

/** Seven farm steps for one protocol, each 20 to 600 characters. */
export function farmSteps(p: SnapshotProtocol, v: Valuation): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(chain);
  const core = corePosition(p.category);
  const second = secondAction(p.category);
  const holdDays = v.age !== null && v.age > 730 ? '60' : '30';
  return [
    `Open a $${capital} position in ${p.name}'s ${core} on ${chain}. Deposit through the protocol's own page, not a third-party aggregator, so the wallet is recorded as a direct user. Expect ${gas} in gas for the deposit.`,
    `Add a second qualifying action: ${second} on ${chain} with another $${Math.max(25, Math.round(capital / 2))}. A wallet with two kinds of interaction usually scores above one with a single deposit.`,
    `Come back once a week and repeat the core action with a small top-up of $${Math.max(10, Math.round(capital / 5))}. Airdrop snapshots usually reward wallets active across many weeks, not a single burst of activity.`,
    `Leave the position untouched for at least ${holdDays} days. Withdrawing early can reset the holding time that most points systems count, so treat the ${capital} as locked for the full period.`,
    `Check ${p.name}'s points or rewards page every week and confirm the position is tracked. If a step does not register within a few days, redo it before the next snapshot rather than waiting.`,
    `Keep a small ${chain} balance for fees: each transaction costs ${gas} on ${chain}, so the whole eight-week plan runs roughly $${Math.max(2, Math.round(8 * parseFloat(gas.replace(/[^0-9.]/g, '')) * 10) / 10)} in gas. Never let the fee balance hit zero mid-plan.`,
    `Keep a farm log with the date, amount and transaction hash of every step. If ${p.name} issues a token, that log is the evidence for any claim, support ticket or manual review.`,
  ];
}

// ---------------------------------------------------------------------------
// The board.
//
// Rankable protocols are valued, sorted by implied value, and given ranks
// 1..N. Ties are broken by nudging the lower row down one dollar so the
// implied values are strictly decreasing and every rank is earned, never
// shared. The watchlist is always inside the board by construction.
// ---------------------------------------------------------------------------

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  tvl_usd: number;
  change_7d: number | null;
  category: string | null;
  chains: string[];
  age_days: number | null;
  tier: number;
  growth_mult: number;
  maturity_mult: number;
  breadth_mult: number;
  on_watchlist: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  tvl_usd: number;
  change_7d: number | null;
  category: string | null;
  chains: string[];
  mcap_usd: number | null;
  symbol: string | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  watchlist_size: number;
  watchlist_slugs: string[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** Build the ranked board: every rankable protocol, valued and ordered. */
export function buildBoard(snapshot: Snapshot, m: ModelParams = MODEL): BoardRow[] {
  const onWatch = new Set(snapshot.watchlist);
  const valued = snapshot.protocols
    .filter((p) => isRankable(p))
    .map((p) => ({ p, v: valueOf(p, snapshot.as_of, m) }))
    .sort((a, b) => b.v.implied - a.v.implied || a.p.slug.localeCompare(b.p.slug));
  // Make implied values strictly decreasing so no two rows share a value.
  let prev = Number.POSITIVE_INFINITY;
  const rows: BoardRow[] = valued.map(({ p, v }, i) => {
    let implied = v.implied;
    if (implied >= prev) implied = prev - 1;
    if (implied < 1) implied = 1;
    prev = implied;
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: implied,
      farm_steps: farmSteps(p, v),
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      category: p.category,
      chains: p.chains,
      age_days: v.age,
      tier: v.tier,
      growth_mult: v.growthMult,
      maturity_mult: v.maturityMult,
      breadth_mult: v.breadthMult,
      on_watchlist: onWatch.has(p.slug),
    };
  });
  return rows;
}

/** The live-token protocols, largest first, for the dashboard's live tab. */
export function liveRows(snapshot: Snapshot, limit = 24): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      category: p.category,
      chains: p.chains,
      mcap_usd: p.mcap_usd,
      symbol: p.symbol,
    }));
}

/** The whole radar: the board, the live list, and the model that made them. */
export function buildRadar(snapshot: Snapshot, m: ModelParams = MODEL): RadarData {
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: m,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist],
    rows: buildBoard(snapshot, m),
    live: liveRows(snapshot),
  };
}

/** The dashboard's data file: one script that sets window.RADAR. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Check a board against the gate's rules; null when it passes. */
export function validateBoard(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) {
    return `board holds ${rows.length} rows, outside 100 to 4000`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seenSlugs = new Set<string>();
  const seenRanks = new Set<number>();
  let prevValue = Number.POSITIVE_INFINITY;
  let allEqual = rows.length > 1;
  let firstValue: number | null = null;
  for (const row of rows) {
    if (!known.has(row.slug)) return `row names unknown slug ${row.slug}`;
    if (seenSlugs.has(row.slug)) return `slug ${row.slug} appears twice`;
    seenSlugs.add(row.slug);
    if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank > rows.length) {
      return `row ${row.slug} has rank ${row.rank}, outside 1 to ${rows.length}`;
    }
    if (seenRanks.has(row.rank)) return `rank ${row.rank} appears twice`;
    seenRanks.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} has implied value ${row.implied_value_usd}, outside the allowed range`;
    }
    if (firstValue === null) firstValue = row.implied_value_usd;
    if (row.implied_value_usd !== firstValue) allEqual = false;
    if (row.implied_value_usd > prevValue) return `implied value rises at rank ${row.rank}`;
    prevValue = row.implied_value_usd;
    if (!row.name || row.name.trim().length === 0) return `row ${row.slug} has no name`;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${Array.isArray(row.farm_steps) ? row.farm_steps.length : 0} farm steps, outside 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} has a farm step of ${len} characters, outside 20 to 600`;
    }
  }
  for (let r = 1; r <= rows.length; r++) {
    if (!seenRanks.has(r)) return `rank ${r} is missing`;
  }
  if (allEqual) return 'every row carries the same implied value, so the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seenSlugs.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

/** Parse and shape-check the snapshot text. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (typeof data.as_of !== 'string' || !Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error('snapshot is not shaped like { as_of, source, floor_usd, protocols, watchlist }');
  }
  return data;
}
