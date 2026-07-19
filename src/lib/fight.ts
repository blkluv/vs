// Pure, framework-free fight engine. Deterministic given (events, clock) so it can
// be simulated headlessly to tune balance. The UI feeds it flow events + a clock and
// renders the resulting state; the arena plays the returned effects.

export type Side = "left" | "right";

export const CFG = {
  HP_MAX: 1400,
  ROUND_MS: 80_000,
  ROUNDS_TO_WIN: 2, // best of 3
  BASE_DMG: 8,
  CHIP_MULT: 0.3, // fully-guarded hit lands at this fraction
  CLEAN_MULT: 1.0,
  CRIT_MULT: 1.8,
  COMBO_STEPS: [1, 1.15, 1.25, 1.3, 1.35, 1.4],
  COMBO_WINDOW_MS: 4000,
  EXPOSE_MS: 4000,
  GUARD_MAX: 100,
  BLOCK_AT: 0.85, // show a "block" when guard fraction is at/above this (near-full)
  GUARD_ON_BUY: 5, // per unit power, restores your guard
  GUARD_ON_SELL: 34, // per unit power, drains your guard
  GUARD_REGEN_PER_S: 3,
  SELL_CHIP: 4, // per unit weight, self chip
  // supply-weighting: a trade's economic heft = fraction of total supply it moves.
  // REF fraction maps to weight 1.0; each 10x above/below shifts weight by K.
  SUPPLY_REF: 0.0001, // 0.01% of supply == baseline blow
  SUPPLY_K: 0.62,
  WEIGHT_MIN: 0.15,
  WEIGHT_MAX: 5,
  CRIT_WEIGHT: 2.2, // a heavy enough blow crits on an exposed foe
  // fallback when supply is unknown: normalize to the token's own recent median size
  POWER_MIN: 0.25,
  POWER_MAX: 4,
  ROLL_WINDOW: 24,
};

export type FighterState = {
  symbol: string;
  supply: number | null; // total supply (human units) — drives supply-weighted damage
  hp: number;
  guard: number;
  combo: number;
  comboExpiry: number;
  exposedUntil: number;
  roundsWon: number;
  sizes: number[]; // rolling recent trade sizes (fallback normalization only)
};

export type Phase = "intro" | "fight" | "roundEnd" | "matchEnd";

export type MatchState = {
  left: FighterState;
  right: FighterState;
  round: number; // 1-based
  roundEndsAt: number;
  phase: Phase;
  banner: string | null;
  matchWinner: Side | null;
  _introAt?: number;
};

export type Effect =
  | { type: "strike"; side: Side; power: number; crit: boolean; blocked: boolean; combo: number }
  | { type: "expose"; side: Side }
  | { type: "stagger"; side: Side }
  | { type: "ko"; loser: Side }
  | { type: "roundBanner"; text: string }
  | { type: "matchBanner"; text: string };

function newFighter(symbol: string, supply: number | null): FighterState {
  return { symbol, supply, hp: CFG.HP_MAX, guard: CFG.GUARD_MAX, combo: 0, comboExpiry: 0, exposedUntil: 0, roundsWon: 0, sizes: [] };
}

export function createMatch(
  leftSym: string,
  rightSym: string,
  now: number,
  supplies?: { left: number | null; right: number | null },
): MatchState {
  return {
    left: newFighter(leftSym, supplies?.left ?? null),
    right: newFighter(rightSym, supplies?.right ?? null),
    round: 1,
    roundEndsAt: now + CFG.ROUND_MS,
    phase: "intro",
    banner: "ROUND 1",
    matchWinner: null,
  };
}

const other = (s: Side): Side => (s === "left" ? "right" : "left");
const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * A trade's economic weight. Primary path: fraction of the token's TOTAL SUPPLY the
 * trade moves, log-scaled around SUPPLY_REF (0.01% of supply = weight 1.0). This is
 * what makes a whale move on a 1B-supply coin land differently than the same token
 * count on a 100B-supply coin. Fallback (supply unknown): normalize to the token's
 * own recent median trade size.
 */
function weightOf(f: FighterState, amount: number): number {
  if (f.supply && f.supply > 0) {
    const frac = Math.max(amount / f.supply, 1e-12);
    const w = 1 + Math.log10(frac / CFG.SUPPLY_REF) * CFG.SUPPLY_K;
    return Math.max(CFG.WEIGHT_MIN, Math.min(CFG.WEIGHT_MAX, w));
  }
  f.sizes.push(amount);
  if (f.sizes.length > CFG.ROLL_WINDOW) f.sizes.shift();
  const med = median(f.sizes);
  if (med <= 0) return 1;
  return Math.max(CFG.POWER_MIN, Math.min(CFG.POWER_MAX, amount / med));
}

function comboMult(f: FighterState): number {
  const i = Math.min(f.combo, CFG.COMBO_STEPS.length - 1);
  return CFG.COMBO_STEPS[Math.max(0, i)];
}

/** Feed one classified flow event. Returns visual effects. Mutates state. */
export function applyFlow(
  state: MatchState,
  ev: { symbol: string; side: "buy" | "sell"; amount: number; quoteValue?: number },
  now: number,
): Effect[] {
  if (state.phase !== "fight") return [];
  const side: Side | null =
    ev.symbol === state.left.symbol ? "left" : ev.symbol === state.right.symbol ? "right" : null;
  if (!side) return [];

  const me = state[side];
  const foe = state[other(side)];
  const weight = weightOf(me, ev.amount); // supply-weighted economic heft
  const effects: Effect[] = [];

  if (ev.side === "buy") {
    // buying me restores my guard (scaled by heft), and I strike the opponent
    me.guard = Math.min(CFG.GUARD_MAX, me.guard + CFG.GUARD_ON_BUY * weight);
    me.combo = now < me.comboExpiry ? me.combo + 1 : 0;
    me.comboExpiry = now + CFG.COMBO_WINDOW_MS;

    // Continuous guard mitigation: full guard softens to chip, empty guard lands clean.
    // A recent sell (exposed) ignores guard entirely and a heavy blow crits.
    const exposed = now < foe.exposedUntil;
    const gf = foe.guard / CFG.GUARD_MAX; // 0..1
    let landMult: number;
    let crit = false;
    if (exposed) {
      crit = me.combo >= 2 || weight > CFG.CRIT_WEIGHT;
      landMult = crit ? CFG.CRIT_MULT : CFG.CLEAN_MULT;
    } else {
      landMult = CFG.CHIP_MULT + (CFG.CLEAN_MULT - CFG.CHIP_MULT) * (1 - gf);
    }
    const dmg = CFG.BASE_DMG * weight * landMult * comboMult(me);
    foe.hp = Math.max(0, foe.hp - dmg);
    const blocked = !exposed && gf >= CFG.BLOCK_AT;
    effects.push({ type: "strike", side, power: weight, crit, blocked, combo: me.combo });
  } else {
    // selling me drains my guard and EXPOSES me (opponent's next strike lands clean/crit).
    // A sell never damages HP directly — all HP loss comes from the opponent striking.
    me.guard = Math.max(0, me.guard - CFG.GUARD_ON_SELL * weight);
    me.exposedUntil = now + CFG.EXPOSE_MS;
    me.combo = 0;
    effects.push({ type: "stagger", side });
    effects.push({ type: "expose", side });
  }

  return effects;
}

/** Advance clocks: guard regen, KO / round-timer resolution, round & match transitions. */
export function tick(state: MatchState, now: number, dtMs: number): Effect[] {
  const effects: Effect[] = [];
  if (state.phase === "intro") {
    // brief intro then fight
    if (!state._introAt) state._introAt = now;
    if (now - state._introAt > 1400) {
      state.phase = "fight";
      state.banner = null;
      state.roundEndsAt = now + CFG.ROUND_MS;
    }
    return effects;
  }
  if (state.phase !== "fight") return effects;

  const dt = dtMs / 1000;
  for (const s of ["left", "right"] as Side[]) {
    const f = state[s];
    if (now >= f.exposedUntil) f.guard = Math.min(CFG.GUARD_MAX, f.guard + CFG.GUARD_REGEN_PER_S * dt);
    if (now >= f.comboExpiry) f.combo = 0;
  }

  const koSide: Side | null = state.left.hp <= 0 ? "left" : state.right.hp <= 0 ? "right" : null;
  const timeUp = now >= state.roundEndsAt;

  if (koSide || timeUp) {
    let winner: Side;
    if (koSide) {
      winner = other(koSide);
      effects.push({ type: "ko", loser: koSide });
    } else {
      winner = state.left.hp >= state.right.hp ? "left" : "right";
    }
    state[winner].roundsWon += 1;

    if (state[winner].roundsWon >= CFG.ROUNDS_TO_WIN) {
      state.phase = "matchEnd";
      state.matchWinner = winner;
      state.banner = `${state[winner].symbol} WINS`;
      effects.push({ type: "matchBanner", text: `${state[winner].symbol} WINS` });
    } else {
      state.round += 1;
      state.phase = "intro";
      state._introAt = undefined;
      state.banner = `ROUND ${state.round}`;
      effects.push({ type: "roundBanner", text: `ROUND ${state.round}` });
      // reset fighters' hp/guard for next round, keep roundsWon + rolling sizes
      for (const s of ["left", "right"] as Side[]) {
        state[s].hp = CFG.HP_MAX;
        state[s].guard = CFG.GUARD_MAX;
        state[s].combo = 0;
        state[s].exposedUntil = 0;
      }
    }
  }
  return effects;
}
