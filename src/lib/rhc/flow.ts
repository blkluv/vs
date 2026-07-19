import { formatUnits, getContract, parseAbiItem, type Address, type Hex } from "viem";
import { publicClient, ADDRESSES } from "./chain";
import { erc8056Abi } from "./abis";
import { isBlocked } from "./blocklist";
import { enrich } from "./tokenmeta";

const SWAP_EVENT = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
const INIT_EVENT = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);

const ZERO = "0x0000000000000000000000000000000000000000";
// A swap's non-coin leg. The "coin" (fighter) is whichever side ISN'T one of these.
const QUOTES = new Set(["ETH", "WETH", "USDG", "USDC"]);

// How many blocks back to scan when no cursor is supplied.
const DEFAULT_WINDOW = 400n;
const MAX_WINDOW = 1200n;
const MAX_EVENTS = 80;

export type FlowEvent = {
  poolId: string;
  coin: Address;
  symbol: string;
  side: "buy" | "sell";
  amount: number; // coin units
  quoteValue: number; // ETH or USD-ish size, for impact scaling
  block: string;
  tx: Hex;
};

export type Trending = {
  symbol: string;
  coin: Address;
  poolId: string;
  buys: number;
  sells: number;
  count: number;
  decimals: number;
  logo: string | null;
  mcap: number | null;
  supply: number | null;
};

type PoolMeta = {
  coin: Address;
  coinIndex: 0 | 1;
  symbol: string;
  coinDecimals: number;
  quoteDecimals: number;
} | null;

const metaCache = new Map<string, PoolMeta>();

async function tokenInfo(addr: Address): Promise<{ symbol: string; decimals: number }> {
  if (addr.toLowerCase() === ZERO) return { symbol: "ETH", decimals: 18 };
  const c = getContract({ address: addr, abi: erc8056Abi, client: publicClient() });
  const [symbol, decimals] = await Promise.all([
    c.read.symbol().catch(() => addr.slice(0, 8)),
    c.read.decimals().catch(() => 18),
  ]);
  return { symbol: symbol as string, decimals: decimals as number };
}

async function getPoolMeta(poolId: string, latest: bigint): Promise<PoolMeta> {
  if (metaCache.has(poolId)) return metaCache.get(poolId)!;

  let meta: PoolMeta = null;
  try {
    const inits = await publicClient().getLogs({
      address: ADDRESSES.poolManager,
      event: INIT_EVENT,
      args: { id: poolId as Hex },
      fromBlock: 0n,
      toBlock: latest,
    });
    if (inits.length) {
      const { currency0, currency1 } = inits[0].args as { currency0: Address; currency1: Address };
      const [t0, t1] = await Promise.all([tokenInfo(currency0), tokenInfo(currency1)]);
      const q0 = QUOTES.has(t0.symbol.toUpperCase());
      const q1 = QUOTES.has(t1.symbol.toUpperCase());

      if (!(q0 && q1)) {
        // coin = the non-quote side; if neither is a quote, default to currency1 as the coin.
        const coinIndex: 0 | 1 = q0 ? 1 : q1 ? 0 : 1;
        const coinT = coinIndex === 0 ? t0 : t1;
        const quoteT = coinIndex === 0 ? t1 : t0;
        meta = {
          coin: coinIndex === 0 ? currency0 : currency1,
          coinIndex,
          symbol: coinT.symbol,
          coinDecimals: coinT.decimals,
          quoteDecimals: quoteT.decimals,
        };
      }
    }
  } catch {
    meta = null;
  }
  metaCache.set(poolId, meta);
  return meta;
}

const abs = (n: bigint) => (n < 0n ? -n : n);

export async function getFlow(sinceArg?: bigint): Promise<{
  latestBlock: string;
  events: FlowEvent[];
  trending: Trending[];
}> {
  const client = publicClient();
  const latest = await client.getBlockNumber();
  let from = sinceArg ? sinceArg + 1n : latest - DEFAULT_WINDOW;
  if (latest - from > MAX_WINDOW) from = latest - MAX_WINDOW;
  if (from < 0n) from = 0n;

  const swaps = await client.getLogs({
    address: ADDRESSES.poolManager,
    event: SWAP_EVENT,
    fromBlock: from,
    toBlock: latest,
  });

  const events: FlowEvent[] = [];
  const tally = new Map<string, Trending>();

  for (const s of swaps) {
    const poolId = s.topics[1] as string;
    const meta = await getPoolMeta(poolId, latest);
    if (!meta) continue;
    if (isBlocked(meta.symbol)) continue; // keep slurs off the roster + out of fights

    const args = s.args as { amount0: bigint; amount1: bigint };
    const coinAmt = meta.coinIndex === 0 ? args.amount0 : args.amount1;
    const quoteAmt = meta.coinIndex === 0 ? args.amount1 : args.amount0;
    if (coinAmt === 0n) continue;

    const side: "buy" | "sell" = coinAmt > 0n ? "buy" : "sell";
    const amount = Number(formatUnits(abs(coinAmt), meta.coinDecimals));
    const quoteValue = Number(formatUnits(abs(quoteAmt), meta.quoteDecimals));

    events.push({
      poolId,
      coin: meta.coin,
      symbol: meta.symbol,
      side,
      amount,
      quoteValue,
      block: (s.blockNumber ?? 0n).toString(),
      tx: s.transactionHash as Hex,
    });

    const key = meta.symbol;
    const t =
      tally.get(key) ??
      ({ symbol: meta.symbol, coin: meta.coin, poolId, buys: 0, sells: 0, count: 0, decimals: meta.coinDecimals, logo: null, mcap: null, supply: null } as Trending & { decimals: number });
    t.count++;
    if (side === "buy") t.buys++;
    else t.sells++;
    tally.set(key, t);
  }

  const trending = [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 12);

  // enrich the roster with logo + market cap (DexScreener) + total supply (on-chain)
  try {
    const metas = await enrich(trending.map((t) => ({ address: t.coin, decimals: t.decimals })));
    for (const t of trending) {
      const m = metas.get(t.coin.toLowerCase());
      if (m) {
        t.logo = m.logo;
        t.mcap = m.mcap;
        t.supply = m.supply;
      }
    }
  } catch {
    /* enrichment is best-effort */
  }

  // keep only the most recent MAX_EVENTS, oldest-first so the client plays them in order
  const trimmed = events.slice(-MAX_EVENTS);

  return { latestBlock: latest.toString(), events: trimmed, trending };
}
