import { createPublicClient, http, defineChain, type Address, type PublicClient } from "viem";

/** Robinhood Chain — Arbitrum Orbit L2, chain id 4663. */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

/** Canonical Uniswap v4 + core contracts on Robinhood Chain. */
export const ADDRESSES = {
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  universalRouter: "0x8876789976DECBFcbBBe364623C63652dB8c0904",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const satisfies Record<string, Address>;

/**
 * Starter registry of known Robinhood Chain tokens. Not exhaustive — any token
 * address can be read directly. Stock tokens are ERC-8056 total-return tokens:
 * raw balanceOf is static; uiMultiplier() (1e18-scaled) grows with in-kind
 * dividend reinvestment and on splits.
 */
export const KNOWN_TOKENS: Record<string, Address> = {
  USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  NVDA: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
};

/** Server-only RPC endpoint. Never shipped to the browser. */
export function rpcUrl(): string {
  return process.env.RHC_RPC_URL || robinhoodChain.rpcUrls.default.http[0];
}

export function publicClient(): PublicClient {
  return createPublicClient({ chain: robinhoodChain, transport: http(rpcUrl()) });
}

/** Resolve a symbol from the starter registry, or accept a raw 0x address. */
export function resolveToken(symbolOrAddress: string): Address {
  const upper = symbolOrAddress.toUpperCase();
  if (KNOWN_TOKENS[upper]) return KNOWN_TOKENS[upper];
  if (/^0x[0-9a-fA-F]{40}$/.test(symbolOrAddress)) return symbolOrAddress as Address;
  throw new Error(
    `Unknown token "${symbolOrAddress}". Pass a 0x address or one of: ${Object.keys(KNOWN_TOKENS).join(", ")}`,
  );
}

export function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
