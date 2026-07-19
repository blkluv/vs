import { formatUnits, getContract, type Address } from "viem";
import { publicClient } from "./chain";
import { erc8056Abi } from "./abis";

export type TokenMeta = {
  logo: string | null;
  priceUsd: number | null;
  mcap: number | null; // market cap or FDV (USD)
  liq: number | null; // pool liquidity (USD)
  supply: number | null; // total supply, human units (for the engine's supply-weighting)
};

const cache = new Map<string, { meta: TokenMeta; ts: number }>();
const TTL = 60_000;

// DexScreener indexes Robinhood Chain (chainId "robinhood"); its batch endpoint
// caps at 30 addresses, so chunk.
async function fetchDexBatch(addrs: Address[]): Promise<Map<string, Partial<TokenMeta>>> {
  const out = new Map<string, Partial<TokenMeta>>();
  const chunks: Address[][] = [];
  for (let i = 0; i < addrs.length; i += 30) chunks.push(addrs.slice(i, i + 30));

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`, {
          headers: { "user-agent": "pit/1.0 (+jumpbox.tech)" },
        });
        const j = (await res.json()) as { pairs?: any[] };
        const byToken = new Map<string, any[]>();
        for (const p of j.pairs ?? []) {
          const a = p.baseToken?.address?.toLowerCase();
          if (!a) continue;
          (byToken.get(a) ?? byToken.set(a, []).get(a)!).push(p);
        }
        for (const [a, pairs] of byToken) {
          const best = pairs.sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0))[0];
          out.set(a, {
            logo: best.info?.imageUrl ?? null,
            priceUsd: best.priceUsd ? Number(best.priceUsd) : null,
            mcap: best.marketCap ?? best.fdv ?? null,
            liq: best.liquidity?.usd ?? null,
          });
        }
      } catch {
        /* DexScreener transient — supply still comes from chain */
      }
    }),
  );
  return out;
}

/** Enrich tokens with logo + market cap (DexScreener) and total supply (on-chain). Cached. */
export async function enrich(
  tokens: { address: Address; decimals: number }[],
): Promise<Map<string, TokenMeta>> {
  const now = Date.now();
  const need = tokens.filter((t) => {
    const c = cache.get(t.address.toLowerCase());
    return !c || now - c.ts > TTL;
  });

  if (need.length) {
    const dex = await fetchDexBatch(need.map((t) => t.address));
    await Promise.all(
      need.map(async (t) => {
        const key = t.address.toLowerCase();
        let supply: number | null = null;
        try {
          const ts = (await getContract({ address: t.address, abi: erc8056Abi, client: publicClient() }).read.totalSupply()) as bigint;
          supply = Number(formatUnits(ts, t.decimals));
        } catch {
          /* keep null */
        }
        const d = dex.get(key) ?? {};
        cache.set(key, {
          meta: { logo: d.logo ?? null, priceUsd: d.priceUsd ?? null, mcap: d.mcap ?? null, liq: d.liq ?? null, supply },
          ts: now,
        });
      }),
    );
  }

  const result = new Map<string, TokenMeta>();
  for (const t of tokens) {
    const c = cache.get(t.address.toLowerCase());
    if (c) result.set(t.address.toLowerCase(), c.meta);
  }
  return result;
}
