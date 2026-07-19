// Keep slurs / hateful token symbols off a jumpbox-branded page. The trenches mint
// anything; this is a defensive substring filter over symbols (leet-normalized).
// Not exhaustive by design — err toward hiding. Applied to roster AND fight events.

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t", "8": "b", "9": "g", "$": "s", "@": "a", "!": "i",
};

function normalize(sym: string): string {
  return sym
    .toLowerCase()
    .split("")
    .map((c) => LEET[c] ?? c)
    .join("")
    .replace(/[^a-z]/g, "");
}

// Slur / hate roots (substring match after normalization). Intentionally terse.
const ROOTS = [
  "nigg", "nigr", "negr0", "kike", "kyke", "spic", "chink", "gook", "wetback", "beaner",
  "paki", "coon", "tranny", "trannie", "faggot", "fagot", "fgt", "dyke", "retard", "tard",
  "rape", "rapist", "nazi", "hitler", "kkk", "whitepower", "heil", "jewd", "goyim",
  "molest", "pedo", "pedophile", "cripple", "sandnigg",
];

export function isBlocked(symbol: string): boolean {
  if (!symbol) return false;
  const n = normalize(symbol);
  if (!n) return false;
  return ROOTS.some((r) => n.includes(r));
}
